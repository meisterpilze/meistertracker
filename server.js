const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile, spawn } = require('child_process');
const db = require('./db.js');
const ship = require('./shipping.js');
const { createMcpServer } = require('./mcp-server.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

// ── CONFIGURATION ────────────────────────────────────────────
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      fs.readFileSync(envPath, 'utf8')
        .split('\n')
        .forEach((line) => {
          const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
          if (match) {
            let val = match[2];
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
              val = val.slice(1, -1);
            if (!process.env[match[1]]) process.env[match[1]] = val;
          }
        });
    }
  } catch (e) {
    /* .env is optional */
  }
}
loadEnv();

// ── STRUCTURED LOGGING ───────────────────────────────────────
// Outputs JSON lines for structured log aggregation (PM2, journald, etc.)
// Falls back to human-readable format when LOG_FORMAT=text
const LOG_FORMAT = process.env.LOG_FORMAT || 'json';
function log(level, msg, meta) {
  const ts = new Date().toISOString();
  if (LOG_FORMAT === 'json') {
    const entry = JSON.stringify({ time: ts, level: level.toUpperCase(), msg, ...meta });
    if (level === 'error') console.error(entry);
    else console.log(entry);
  } else {
    const entry = `${ts} [${level.toUpperCase()}] ${msg}`;
    if (level === 'error') console.error(entry, meta || '');
    else console.log(entry, meta ? JSON.stringify(meta) : '');
  }
}

const PORT_RAW = parseInt(process.env.PORT, 10) || 3000;
if (PORT_RAW < 1 || PORT_RAW > 65535) {
  log('error', 'Invalid PORT, using default 3000', { value: PORT_RAW });
}
const PORT = PORT_RAW >= 1 && PORT_RAW <= 65535 ? PORT_RAW : 3000;
// Set by update_server.sh / START.bat when launched from inside a git worktree.
// Surfaced via /api/health so the UI can render a "this is not production"
// banner — prevents people from confidently entering real data into a feature
// branch instance running alongside prod.
const WORKTREE_MODE = process.env.WORKTREE_MODE === '1' || process.env.WORKTREE_MODE === 'true';
const DIR = __dirname;
const CERT_KEY = path.join(DIR, 'certs', 'server.key');
const CERT_CRT = path.join(DIR, 'certs', 'server.crt');
const DB_FILE = path.join(DIR, 'meistertracker.db');
const CAL_DIR = path.join(DIR, 'calendars');

// Windows printer name — must match exactly what shows in Devices and Printers
// Validated to prevent command injection via PowerShell/WMI
const PRINTER_NAME_RAW = process.env.PRINTER_NAME || 'ZDesigner GK420d';
if (!/^[\w\s.\-()]+$/u.test(PRINTER_NAME_RAW)) {
  log('error', 'PRINTER_NAME contains unsafe characters, falling back to default', { value: PRINTER_NAME_RAW });
}
const PRINTER_NAME = /^[\w\s.\-()]+$/u.test(PRINTER_NAME_RAW) ? PRINTER_NAME_RAW : 'ZDesigner GK420d';

// PM2 process name — used by the GitHub-webhook auto-deploy chain
// (`pm2 restart <name>` after `git pull`). Forks running PM2 with a
// different process name should set PM2_PROCESS_NAME in their env so
// the auto-deploy lands on the right process. Validated to a strict
// charset before any shell interpolation.
const PM2_PROCESS_NAME_RAW = process.env.PM2_PROCESS_NAME || 'meisterpilze';
const PM2_PROCESS_NAME = /^[A-Za-z0-9_\-]{1,64}$/.test(PM2_PROCESS_NAME_RAW) ? PM2_PROCESS_NAME_RAW : 'meisterpilze';
if (PM2_PROCESS_NAME !== PM2_PROCESS_NAME_RAW) {
  log('error', 'PM2_PROCESS_NAME contains unsafe characters, falling back to default', {
    value: PM2_PROCESS_NAME_RAW
  });
}

// ZPL label dimensions in dots. Default 400×240 = 50×30mm at 203dpi
// (Zebra GK420d / ZD420 standard small label). Forks with different
// label stock can override via env, but note the field positions in
// app.js and mcp-server.js itemsToZPL() are laid out for 400 dots
// wide — significantly different sizes will need layout tweaks too.
function _intEnv(name, def, min, max) {
  const v = parseInt(process.env[name], 10);
  if (Number.isFinite(v) && v >= min && v <= max) return v;
  return def;
}
const LABEL_WIDTH_DOTS = _intEnv('LABEL_WIDTH_DOTS', 400, 100, 4000);
const LABEL_HEIGHT_DOTS = _intEnv('LABEL_HEIGHT_DOTS', 240, 100, 4000);

// Optional Windows print bridge (scripts/print-bridge.ps1). When configured,
// the server forwards print + status calls to this URL instead of running
// PowerShell locally. Required for label printing when the server runs on
// Linux while the Zebra is attached to a Windows PC on the LAN.
//
// The env vars are a fallback for the DB-stored config (Settings → Drucker)
// so existing .env-based setups keep working untouched. UI-saved values
// take precedence over env values when present.
const PRINT_BRIDGE_URL_ENV = (process.env.PRINT_BRIDGE_URL || '').replace(/\/+$/, '');
const PRINT_BRIDGE_TOKEN_ENV = process.env.PRINT_BRIDGE_TOKEN || '';

const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5 MB max request body
const SESSION_TTL_SECONDS = db.SESSION_TTL_MS / 1000; // keep in sync with db.js
const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

function getClientIP(req) {
  const fwd = TRUST_PROXY ? req.headers['x-forwarded-for'] : null;
  return (fwd ? fwd.split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

let database = db.openDb(DB_FILE);
let protocol = 'http'; // set to 'https' at startup if TLS certs are found
// I-17: serialize backup restores. Two admins kicking off concurrent
// /api/backup/restore requests would race on the close→rename→reopen path
// against the same DB file, leaving a corrupt or wrong-version DB. The
// flag is process-local (good enough — only one node process owns the DB).
let restoreInProgress = false;
if (!fs.existsSync(CAL_DIR)) fs.mkdirSync(CAL_DIR);

// ── First-run setup token (S-06) ───────────────────────────
// On a fresh deployment with zero users, the operator must either:
//   1) call /api/auth/setup from loopback (default for the START.bat flow), or
//   2) call /api/auth/setup with header `X-Setup-Token: <generated>`.
// The token is process-lifetime only (never persisted) and printed via the
// structured logger so PM2/journald operators can copy it. Once setup
// completes, the in-memory value is cleared so a stolen log line can't be
// reused.
let SETUP_TOKEN = null;
try {
  if (db.countUsers(database) === 0) {
    SETUP_TOKEN = crypto.randomBytes(32).toString('hex');
    log('warn', 'SETUP TOKEN: ' + SETUP_TOKEN, {
      hint: 'send X-Setup-Token header to POST /api/auth/setup, or call from localhost'
    });
  }
} catch (e) {
  log('error', 'countUsers failed at startup', { error: e.message });
}

// ── Constant-time login dummy hash (defense against username enumeration) ──
// If a login request hits a non-existent username, we still run a full scrypt
// against this throwaway hash so the response time matches a real user with
// a wrong password. Without this, attackers could enumerate valid accounts
// by measuring 10 ms (no scrypt) vs 50-200 ms (real scrypt) responses.
// Salt+hash are randomized per process, never persisted.
const DUMMY_PASSWORD_SALT = crypto.randomBytes(16).toString('hex');
const DUMMY_PASSWORD_HASH = crypto.scryptSync('', DUMMY_PASSWORD_SALT, 64).toString('hex');

// ── MCP (Model Context Protocol) server ────────────────────
// Each session gets its own McpServer + transport (SDK requires one server per transport).
const mcpSessions = new Map(); // sessionId → { transport, server, lastActive }
const MCP_SESSION_TTL = 30 * 60 * 1000; // 30 minutes
// Tear down all live MCP sessions. Each session's server captured the `database`
// handle at creation time; after a restore swaps `database`, those captured
// handles are closed/stale, so the sessions must be dropped and the clients
// forced to re-initialize against the new database.
function closeAllMcpSessions() {
  for (const session of mcpSessions.values()) {
    try {
      session.server.close();
    } catch (e) {
      /* best-effort */
    }
  }
  mcpSessions.clear();
}
setInterval(
  () => {
    const now = Date.now();
    for (const [sid, s] of mcpSessions) {
      if (now - s.lastActive > MCP_SESSION_TTL) {
        s.server.close().catch(() => {});
        mcpSessions.delete(sid);
      }
    }
  },
  5 * 60 * 1000
); // check every 5 minutes
// Clean up expired OAuth codes and revoked tokens every hour
setInterval(
  () => {
    try {
      db.deleteExpiredOAuthData(database);
    } catch (e) {
      log('error', 'OAuth cleanup failed', { error: e.message });
    }
  },
  60 * 60 * 1000
);

// S-01: returns { userId, role } on success, null on failure.
//   - Legacy static MCP token → role: 'admin' (preserves historical
//     behaviour; the static token has always granted full access).
//   - OAuth access token → role looked up from the OAuth user.
// S-08: passes `touchLastUsed:true` to bump the static token's
// audit timestamp on each verification, and uses Buffer.from(..., 'hex')
// explicitly so the encoding is unambiguous.
function checkMcpAuth(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const hash = crypto.createHash('sha256').update(token).digest('hex');

  // Try legacy static API token
  const stored = db.getMcpToken(database, { touchLastUsed: true });
  if (stored) {
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(stored, 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { userId: null, role: 'admin' };
    }
  }

  // Try OAuth access token — look up the user's current role.
  const oauthToken = db.getOAuthAccessToken(database, hash);
  if (oauthToken) {
    let role = 'user';
    try {
      const user = database.prepare('SELECT role FROM users WHERE id = ?').get(oauthToken.userId);
      if (user && user.role) role = user.role;
    } catch (_) {
      // best effort — fall through with role: 'user' (least privilege)
    }
    return { userId: oauthToken.userId, role };
  }

  return null;
}

// Simple sliding-window rate limiter (shared for MCP + OAuth endpoints)
const MCP_RATE_WINDOW = 60 * 1000;
const rateLimits = new Map(); // ip → { timestamps[] }
function checkRate(req, limit) {
  // R-08: respect TRUST_PROXY so the rate-limit key is the real client IP
  // when running behind a reverse proxy (otherwise everyone shares the
  // proxy's loopback address and trips the limit collectively).
  const ip = getClientIP(req);
  const now = Date.now();
  let bucket = rateLimits.get(ip);
  if (!bucket) {
    bucket = { timestamps: [] };
    rateLimits.set(ip, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < MCP_RATE_WINDOW);
  if (bucket.timestamps.length >= limit) return false;
  bucket.timestamps.push(now);
  return true;
}
function checkMcpRate(req) {
  return checkRate(req, 60);
} // 60 req/min for MCP
function checkOAuthRate(req) {
  return checkRate(req, 20);
} // 20 req/min for OAuth endpoints
// Evict stale IPs every 10 minutes
setInterval(
  () => {
    const cutoff = Date.now() - MCP_RATE_WINDOW;
    for (const [ip, bucket] of rateLimits) {
      if (bucket.timestamps.every((ts) => ts < cutoff)) rateLimits.delete(ip);
    }
  },
  10 * 60 * 1000
);

// ── SSE (Server-Sent Events) for real-time multi-client sync ──
// Uses a Set for O(1) add/delete instead of array splice.
const sseClients = new Set();
function broadcastSSE(excludeRes) {
  const msg = 'data: {"type":"data-changed"}\n\n';
  for (const c of sseClients) {
    if (c === excludeRes) continue;
    try {
      c.write(msg);
    } catch {
      sseClients.delete(c);
    }
  }
}
setInterval(() => {
  const hb = 'data: {"type":"heartbeat"}\n\n';
  for (const c of sseClients) {
    try {
      c.write(hb);
    } catch {
      sseClients.delete(c);
    }
  }
}, 15000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

// ── P-01: Pre-compressed static assets ─────────────────────────
// Pre-gzip + pre-brotli text/JS/CSS/HTML/JSON assets at startup so each
// request just streams the cached bytes. Skip images / favicon / PDFs:
// already-compressed payloads can't be gzipped meaningfully and brotli
// makes them slightly larger. Recompresses only when the source mtime
// is newer than the cached .gz/.br (avoid touching disk on every boot).
const COMPRESSIBLE_EXT = new Set(['.html', '.js', '.css', '.json', '.svg']);
function precompressOne(file) {
  if (!fs.existsSync(file)) return;
  const ext = path.extname(file).toLowerCase();
  if (!COMPRESSIBLE_EXT.has(ext)) return;
  const stat = fs.statSync(file);
  const data = fs.readFileSync(file);
  // gzip
  const gzPath = file + '.gz';
  const gzStale = !fs.existsSync(gzPath) || fs.statSync(gzPath).mtimeMs < stat.mtimeMs;
  if (gzStale) {
    try {
      fs.writeFileSync(gzPath, zlib.gzipSync(data, { level: 9 }));
    } catch (e) {
      log('warn', 'gzip precompress failed', { file, error: e.message });
    }
  }
  // brotli (Node 11+)
  if (typeof zlib.brotliCompressSync === 'function') {
    const brPath = file + '.br';
    const brStale = !fs.existsSync(brPath) || fs.statSync(brPath).mtimeMs < stat.mtimeMs;
    if (brStale) {
      try {
        fs.writeFileSync(
          brPath,
          zlib.brotliCompressSync(data, {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
              [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length
            }
          })
        );
      } catch (e) {
        log('warn', 'brotli precompress failed', { file, error: e.message });
      }
    }
  }
}
function precompressStaticAssets() {
  const root = DIR;
  const files = ['app.js', 'styles.css', 'index.html', 'login.html', 'login.js', 'manifest.json'];
  for (const f of files) precompressOne(path.join(root, f));
  // lib/* — recurse one level
  const libDir = path.join(root, 'lib');
  if (fs.existsSync(libDir)) {
    for (const entry of fs.readdirSync(libDir)) {
      if (entry.endsWith('.gz') || entry.endsWith('.br')) continue;
      precompressOne(path.join(libDir, entry));
    }
  }
  // lang/* — pre-compress the per-locale files (added by P-03)
  const langDir = path.join(root, 'lang');
  if (fs.existsSync(langDir)) {
    for (const entry of fs.readdirSync(langDir)) {
      if (entry.endsWith('.gz') || entry.endsWith('.br')) continue;
      precompressOne(path.join(langDir, entry));
    }
  }
}
// Pick the best encoding based on Accept-Encoding. Returns { encoding, path }
// or null if the client doesn't accept any pre-compressed variant or the
// compressed file is missing on disk.
function pickEncoding(acceptEncoding, filePath) {
  if (!acceptEncoding) return null;
  const ae = String(acceptEncoding).toLowerCase();
  if (ae.includes('br') && fs.existsSync(filePath + '.br')) {
    return { encoding: 'br', path: filePath + '.br' };
  }
  if (ae.includes('gzip') && fs.existsSync(filePath + '.gz')) {
    return { encoding: 'gzip', path: filePath + '.gz' };
  }
  return null;
}

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const i of ifaces) if (i.family === 'IPv4' && !i.internal) return i.address;
  return 'localhost';
}

function readData() {
  return db.readAll(database, { inventoryLogLimit: 500 });
}

function writeData(data) {
  db.writeAll(database, data);
}

function jsonBody(req, res, cb) {
  let body = '';
  let sz = 0;
  let aborted = false;
  req.on('data', (c) => {
    sz += c.length;
    if (sz > MAX_BODY_SIZE) {
      aborted = true;
      jsonErr(res, 413, 'Payload too large');
      req.destroy();
      return;
    }
    body += c;
  });
  req.on('end', () => {
    if (aborted) return;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"bad json"}');
      return;
    }
    cb(null, parsed);
  });
}
function formBody(req, res, cb) {
  let body = '';
  let sz = 0;
  let aborted = false;
  req.on('data', (c) => {
    sz += c.length;
    if (sz > MAX_BODY_SIZE) {
      aborted = true;
      jsonErr(res, 413, 'Payload too large');
      req.destroy();
      return;
    }
    body += c;
  });
  req.on('end', () => {
    if (aborted) return;
    let parsed;
    try {
      const params = new URLSearchParams(body);
      parsed = Object.fromEntries(params.entries());
    } catch (e) {
      jsonErr(res, 400, 'bad form data');
      return;
    }
    cb(null, parsed);
  });
}

function verifyPkce(codeVerifier, storedCodeChallenge) {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url') === storedCodeChallenge;
}

// Track whether we've already warned about a missing PUBLIC_HOSTNAME so the
// log line doesn't repeat on every request.
let _hostHeaderWarned = false;
function getBaseUrl(req) {
  const reqHost = req.headers.host || 'localhost:' + PORT;
  const expected = (process.env.PUBLIC_HOSTNAME || '').trim();
  if (expected) {
    // PUBLIC_HOSTNAME may be host or host:port — normalise both sides for
    // comparison. If the request's Host header doesn't match, return the
    // configured hostname instead of reflecting attacker-controlled input
    // into OAuth issuer metadata. We don't 502 because legitimate
    // localhost-from-LAN access still has to work.
    const reqHostName = reqHost.split(':')[0].toLowerCase();
    const expHostName = expected.split(':')[0].toLowerCase();
    if (reqHostName !== expHostName) {
      return protocol + '://' + expected;
    }
    return protocol + '://' + reqHost;
  }
  if (!_hostHeaderWarned) {
    _hostHeaderWarned = true;
    log('warn', 'PUBLIC_HOSTNAME not configured — Host header reflected into OAuth metadata', {});
  }
  return protocol + '://' + reqHost;
}

function jsonOk(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data || { ok: true }));
}
function jsonErr(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}
// Safe error response: log internals, send generic message to client for
// unexpected errors. R-23: classifier lives in db.js (db.isSafeError) since
// the allowlist is fundamentally a registry of every validator message db.js
// emits — keeping it next to the throw sites makes drift easier to catch.
function safeErr(res, err) {
  const msg = String((err && err.message) || '');
  if (db.isSafeError(msg)) {
    jsonErr(res, 400, msg);
  } else {
    log('error', 'Unexpected error', { error: msg, stack: err && err.stack });
    jsonErr(res, 500, 'Internal server error');
  }
}

// ── REQUEST VALIDATION ──────────────────────────────────────
// Returns null if valid, or an error string if invalid.
function validateRequired(data, fields) {
  if (!data || typeof data !== 'object') return 'Request body must be a JSON object';
  for (const f of fields) {
    if (data[f] === undefined || data[f] === null || data[f] === '') return 'Missing required field: ' + f;
  }
  return null;
}
function validateTypes(data, schema) {
  for (const [field, type] of Object.entries(schema)) {
    if (data[field] === undefined || data[field] === null) continue;
    if (type === 'number' && typeof data[field] !== 'number') return field + ' must be a number';
    if (type === 'string' && typeof data[field] !== 'string') return field + ' must be a string';
    if (type === 'boolean' && typeof data[field] !== 'boolean') return field + ' must be a boolean';
    if (type === 'array' && !Array.isArray(data[field])) return field + ' must be an array';
  }
  return null;
}
// Validate numeric ranges: {field: {min, max}} — skips null/undefined fields
function validateRanges(data, ranges) {
  for (const [field, { min, max }] of Object.entries(ranges)) {
    const v = data[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) return field + ' must be a finite number';
    if (min !== undefined && v < min) return field + ' must be >= ' + min;
    if (max !== undefined && v > max) return field + ' must be <= ' + max;
  }
  return null;
}
// Validate string max lengths: {field: maxLen}
function validateLengths(data, limits) {
  for (const [field, maxLen] of Object.entries(limits)) {
    const v = data[field];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.length > maxLen) return field + ' exceeds max length of ' + maxLen;
  }
  return null;
}
// Validate ISO date strings (YYYY-MM-DD or full ISO)
function validateDate(value, fieldName) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return fieldName + ' is not a valid date';
  return null;
}
// Validate 24-hour time strings in HH:MM format
function validateTimeOfDay(value, fieldName) {
  if (!value) return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return fieldName + ' must be a HH:MM time';
  }
  return null;
}
// Validate enum membership
function validateEnum(value, allowed, fieldName) {
  if (value === undefined || value === null) return null;
  if (!allowed.includes(value)) return fieldName + ' must be one of: ' + allowed.join(', ');
  return null;
}
// Defense-in-depth content validation. Server-rendered fields elsewhere (and
// some innerHTML interpolations on the client) trust these strings, so we
// pin the character set + length up-front. Mirrors the batchId regex used
// by /api/batches.
const ID_CHARSET_RE = /^[A-Za-z0-9_\-@.:]+$/;
function validateMushroomStrain(data) {
  if (!data || typeof data !== 'object') return 'Request body must be a JSON object';
  if (data.name !== undefined && data.name !== null) {
    if (typeof data.name !== 'string') return 'name must be a string';
    if (data.name.length > 200) return 'name exceeds max length of 200';
  }
  if (data.kuerzel !== undefined && data.kuerzel !== null) {
    if (typeof data.kuerzel !== 'string') return 'kuerzel must be a string';
    if (data.kuerzel.length > 16) return 'kuerzel exceeds max length of 16';
    if (data.kuerzel.length > 0 && !/^[A-Za-z0-9_\-]+$/.test(data.kuerzel)) {
      return 'kuerzel must be alphanumeric with - or _';
    }
  }
  if (data.description !== undefined && data.description !== null) {
    if (typeof data.description !== 'string') return 'description must be a string';
    if (data.description.length > 2000) return 'description exceeds max length of 2000';
  }
  return null;
}
const SCAN_ACTIONS = ['ADD', 'MOVE', 'MOVE_BATCH', 'REMOVE', 'CONTAM'];
function validateScanEntries(entries) {
  if (!Array.isArray(entries)) return 'entries must be an array';
  if (entries.length > 1000) return 'too many entries (max 1000 per request)';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== 'object') return 'entry[' + i + '] must be an object';
    if (!SCAN_ACTIONS.includes(e.action)) {
      return 'entry[' + i + '].action must be one of: ' + SCAN_ACTIONS.join(', ');
    }
    if (!e.time || typeof e.time !== 'string' || isNaN(new Date(e.time).getTime())) {
      return 'entry[' + i + '].time must be an ISO timestamp';
    }
    // Optional ID-like fields — pin charset + length to prevent stored XSS via
    // raw rendering in the client.
    for (const f of ['batch', 'bag', 'from', 'to', 'expected_current_zone']) {
      const v = e[f];
      if (v === undefined || v === null || v === '') continue;
      if (typeof v !== 'string') return 'entry[' + i + '].' + f + ' must be a string';
      if (v.length > 100) return 'entry[' + i + '].' + f + ' exceeds max length of 100';
      if (!ID_CHARSET_RE.test(v)) {
        return 'entry[' + i + '].' + f + ' must be alphanumeric with - _ @ . :';
      }
    }
    // Free-text-ish fields — only length-capped.
    for (const [f, max] of [
      ['species', 200],
      ['strain', 200],
      ['reason', 2000]
    ]) {
      const v = e[f];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'string') return 'entry[' + i + '].' + f + ' must be a string';
      if (v.length > max) return 'entry[' + i + '].' + f + ' exceeds max length of ' + max;
    }
    if (e.client_uuid !== undefined && e.client_uuid !== null && e.client_uuid !== '') {
      if (typeof e.client_uuid !== 'string') return 'entry[' + i + '].client_uuid must be a string';
      if (e.client_uuid.length > 64) return 'entry[' + i + '].client_uuid exceeds max length of 64';
      if (!/^[A-Za-z0-9_\-]+$/.test(e.client_uuid)) {
        return 'entry[' + i + '].client_uuid must be alphanumeric with - or _';
      }
    }
  }
  return null;
}
// Admin-only guard — returns true if blocked (response already sent)
function requireAdmin(req, res) {
  if (!req.authUser || req.authUser.role !== 'admin') {
    jsonErr(res, 403, 'admin required');
    return true;
  }
  return false;
}

// ── Contamination-photo storage ─────────────────────────────
// The client compresses photos to ~200 KB JPEGs (canvas re-encode at 1280 px /
// quality 0.8) plus a ~15 KB thumbnail and sends both as base64 data URLs in
// the report POST body. Server validates magic bytes, sha256s, and writes to
// data/photos/{YYYY}/{MM}/{report_id}/{uuid}{,_thumb}.jpg.
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_THUMB_MAX_BYTES = 200 * 1024;

// R-15: total-size cap on data/photos/. Without it, a stuck offsite-sync or
// pathological client can fill the disk and wedge the whole server. Default
// 10 GB; override with PHOTO_DIR_MAX_GB. Logic lives in scripts/photo-cap.js
// so the regression test can exercise it directly.
const photoCap = require('./scripts/photo-cap.js');
const PHOTO_DIR_MAX_BYTES = (() => {
  const raw = parseFloat(process.env.PHOTO_DIR_MAX_GB);
  const gb = Number.isFinite(raw) && raw > 0 ? raw : 10;
  return Math.round(gb * 1024 * 1024 * 1024);
})();
const PHOTO_DIR = path.join(DIR, 'data', 'photos');
const PHOTO_SIZE_REFRESH_MS = 5 * 60 * 1000; // recompute every 5 min
let _photoDirSizeBytes = 0;
let _photoDirSizeStaleAt = 0;
function _ensurePhotoDirSize(force) {
  const now = Date.now();
  if (force || now > _photoDirSizeStaleAt) {
    try {
      _photoDirSizeBytes = photoCap.computePhotoDirSize(PHOTO_DIR);
    } catch (e) {
      log('warn', 'Failed to scan photo dir for size', { error: e.message });
    }
    _photoDirSizeStaleAt = now + PHOTO_SIZE_REFRESH_MS;
    if (_photoDirSizeBytes > PHOTO_DIR_MAX_BYTES * 0.9) {
      log('warn', 'Photo directory near cap', {
        usedMB: Math.round(_photoDirSizeBytes / 1e6),
        capMB: Math.round(PHOTO_DIR_MAX_BYTES / 1e6)
      });
    }
  }
  return _photoDirSizeBytes;
}

function _parseImageDataUrl(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  try {
    return Buffer.from(m[1], 'base64');
  } catch {
    return null;
  }
}
function _isJpegMagic(buf) {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}
// R-15: PhotoCapError reused from scripts/photo-cap.js so the test and the
// server share the same error class.
function savePhotoToDisk(reportId, photo, authUser) {
  if (!photo || typeof photo !== 'object') return null;
  const main = _parseImageDataUrl(photo.data_url);
  if (!main) throw new Error('photo: invalid data_url (must be data:image/jpeg;base64,...)');
  if (!_isJpegMagic(main)) throw new Error('photo: payload is not a JPEG');
  if (main.length > PHOTO_MAX_BYTES) throw new Error('photo: too large (max 5 MB)');
  const thumb = _parseImageDataUrl(photo.thumb_data_url || photo.data_url);
  if (!thumb) throw new Error('photo: invalid thumb_data_url');
  if (!_isJpegMagic(thumb)) throw new Error('photo: thumb is not a JPEG');
  if (thumb.length > PHOTO_THUMB_MAX_BYTES) throw new Error('photo: thumb too large (max 200 KB)');

  // R-15: enforce the photo-directory size cap before writing. The cached
  // total is refreshed every 5 minutes; we add the about-to-be-written
  // bytes to compare against the cap, then update the cache after the
  // successful write so the next call sees the new total.
  // TODO(R-15): orphan-photo cleanup is out of scope for this PR — once it
  // lands, the cap will breathe in normal operation rather than just stop
  // accepting writes when full.
  const currentSize = _ensurePhotoDirSize(false);
  photoCap.enforceCap(currentSize, main.length + thumb.length, PHOTO_DIR_MAX_BYTES);

  const uuid = crypto.randomUUID();
  const sha = crypto.createHash('sha256').update(main).digest('hex');
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const absDir = path.join(DIR, 'data', 'photos', yyyy, mm, String(reportId));
  fs.mkdirSync(absDir, { recursive: true });
  const relPath = `photos/${yyyy}/${mm}/${reportId}/${uuid}.jpg`;
  const thumbPath = `photos/${yyyy}/${mm}/${reportId}/${uuid}_thumb.jpg`;
  fs.writeFileSync(path.join(DIR, 'data', relPath), main);
  fs.writeFileSync(path.join(DIR, 'data', thumbPath), thumb);
  // Update the cached total so consecutive writes in the same 5-min window
  // are bounded correctly without re-scanning.
  _photoDirSizeBytes += main.length + thumb.length;

  return {
    uuid,
    rel_path: relPath,
    thumb_path: thumbPath,
    width: typeof photo.width === 'number' ? photo.width : null,
    height: typeof photo.height === 'number' ? photo.height : null,
    bytes: main.length,
    sha256: sha,
    uploaded_at: now.toISOString(),
    uploaded_by: authUser ? authUser.user_id : null
  };
}

// ── AUTH HELPERS ─────────────────────────────────────────────
// Session cookie name varies by transport:
//   - HTTPS → "__Host-session" (the __Host- prefix forces the browser to
//     reject any cookie that lacks Secure / Path=/ or that includes a
//     Domain attribute, blocking sibling-subdomain fixation attacks).
//   - HTTP  → "session"          (the __Host- prefix REQUIRES Secure, so
//     it cannot be used over plaintext; we keep the unprefixed name there).
// We always parse BOTH names on incoming requests so a session minted
// before the protocol changed (e.g. cert renewal cycle) still resolves.
function sessionCookieName() {
  return protocol === 'https' ? '__Host-session' : 'session';
}

function getSessionToken(req) {
  const cookies = req.headers.cookie || '';
  // Prefer the prefixed name, fall back to plain — covers both transports
  // and clients that sent a stale cookie from an earlier session.
  const m1 = cookies.match(/(?:^|;\s*)__Host-session=([a-f0-9]+)/);
  if (m1) return m1[1];
  const m2 = cookies.match(/(?:^|;\s*)session=([a-f0-9]+)/);
  return m2 ? m2[1] : null;
}

function checkAuth(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  return db.getSession(database, token) || null;
}

function sendUnauthorized(res, isApi) {
  if (isApi) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
  } else {
    res.writeHead(302, { Location: '/login.html' });
    res.end();
  }
}

function cookieFlags() {
  return 'HttpOnly; SameSite=Strict; Path=/;' + (protocol === 'https' ? ' Secure;' : '');
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    sessionCookieName() + '=' + token + '; ' + cookieFlags() + ' Max-Age=' + SESSION_TTL_SECONDS
  );
}

function clearSessionCookie(res) {
  // Clear both names — if we previously set a __Host-session cookie and
  // are now over HTTP, only clearing "session" would leave the prefixed
  // cookie behind (and vice versa). Most browsers ignore the second
  // header line if it duplicates the first so emit them as a single
  // multi-value array instead.
  res.setHeader('Set-Cookie', [
    'session=; ' + cookieFlags() + ' Max-Age=0',
    '__Host-session=; ' + cookieFlags() + ' Max-Age=0'
  ]);
}

// Clean expired sessions + OAuth data on startup and hourly
db.deleteExpiredSessions(database);
db.deleteExpiredOAuthData(database);
setInterval(
  () => {
    db.deleteExpiredSessions(database);
    db.deleteExpiredOAuthData(database);
  },
  60 * 60 * 1000
);

// R-10: periodic cleanup of expired sessions + read notifications. The
// session table also has lazy/hourly cleanup above, but the dedicated
// helpers return a row count so we can log how much we GC'd, and the
// notifications table had no GC at all before this. Runs every 6h plus
// once at startup so a server that's been stopped a long time doesn't
// accumulate forever.
function runPeriodicCleanup() {
  try {
    const sessions = db.cleanupExpiredSessions(database);
    const notifications = db.cleanupOldNotifications(database);
    if (sessions > 0 || notifications > 0) {
      log('info', 'Periodic cleanup', { sessions, notifications });
    }
  } catch (e) {
    log('warn', 'Periodic cleanup failed', { error: e.message });
  }
}
runPeriodicCleanup();
setInterval(runPeriodicCleanup, 6 * 60 * 60 * 1000);

// ── DAILY AUTO-BACKUP ────────────────────────────────────────
// Every day at 00:00 writes a dated backup to /backups/
const BACKUP_DIR = path.join(DIR, 'backups');
const BACKUP_STATUS_FILE = path.join(BACKUP_DIR, '.backup-status.json');
const OFFSITE_MARKER_FILE = path.join(BACKUP_DIR, '.offsite-sync.json');
// R-14: webhook auto-deploy reliability — record each attempt + outcome to
// a sentinel JSON file so an admin can see whether the last `git fetch && npm
// install && pm2 restart` chain actually finished without scraping logs.
// The deploy chain itself writes the success/fail variant; this server only
// writes `in_progress` before kicking off the spawn.
const DEPLOY_STATE_FILE = path.join(DIR, 'data', 'deploy-state.json');
// R-01: rotation only touches files matching this pattern, so manual backups
// (`meistertracker_*.db`) and any other artefact in the directory stay put.
// See scripts/rotate-backups.js for the helper.
const { rotateAutoBackups, BACKUP_PREFIX } = require('./scripts/rotate-backups.js');
const AUTO_BACKUP_RETENTION_DAYS = 30;
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { mode: 0o700 });
// Clean up orphaned temp files from interrupted backup operations.
// R-13: also picks up `.backup-status.json.tmp.<hex>` leftovers if a process
// crashed between writeFileSync and renameSync.
try {
  fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('_') || /^\.backup-status\.json\.tmp\./.test(f))
    .forEach((f) => {
      try {
        fs.unlinkSync(path.join(BACKUP_DIR, f));
      } catch (e) {
        log('warn', 'Failed to clean orphaned temp file', { file: f, error: e.message });
      }
    });
} catch (e) {
  log('warn', 'Failed to scan backup dir for orphans', { error: e.message });
}

function readBackupStatus() {
  try {
    if (!fs.existsSync(BACKUP_STATUS_FILE)) return {};
    const raw = fs.readFileSync(BACKUP_STATUS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    log('warn', 'Could not read backup status file', { error: e.message });
    return {};
  }
}

// R-14: deploy-state sentinel I/O. Best-effort — we don't want a
// transient filesystem hiccup to break the webhook.
function readDeployState() {
  try {
    if (!fs.existsSync(DEPLOY_STATE_FILE)) return null;
    const raw = fs.readFileSync(DEPLOY_STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}
function writeDeployState(patch) {
  try {
    const dataDir = path.dirname(DEPLOY_STATE_FILE);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const tmp = DEPLOY_STATE_FILE + '.tmp.' + crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(tmp, JSON.stringify(patch, null, 2));
    fs.renameSync(tmp, DEPLOY_STATE_FILE);
  } catch (e) {
    log('warn', 'Could not write deploy-state file', { error: e.message });
  }
}

function writeBackupStatus(patch) {
  try {
    const current = readBackupStatus();
    const next = Object.assign({}, current, patch);
    // Atomic write: write to temp then rename. R-13: random tmp suffix so
    // two concurrent writers don't truncate each other's tmp file before
    // either rename completes (e.g. backup completes at the same instant
    // an offsite-sync status update fires).
    const tmp = BACKUP_STATUS_FILE + '.tmp.' + crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, BACKUP_STATUS_FILE);
  } catch (e) {
    log('warn', 'Could not write backup status file', { error: e.message });
  }
}

// Verify a freshly-written backup file on disk has the SQLite magic header
// and a plausible size. Returns null on success, an error string on failure.
function verifyBackupFile(dest) {
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(dest).size;
  } catch (e) {
    return 'stat failed: ' + e.message;
  }
  if (sizeBytes < 1024) return 'backup file suspiciously small: ' + sizeBytes + ' bytes';
  try {
    const fd = fs.openSync(dest, 'r');
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
      return 'backup file missing SQLite magic header';
    }
  } catch (e) {
    return 'verify read failed: ' + e.message;
  }
  return null;
}

function runDailyBackup() {
  const startedAt = Date.now();
  const startedIso = new Date(startedAt).toISOString();
  try {
    // Snapshot KPIs before backup — always overwrite today's snapshot
    // so it captures the latest state (bags created after server start, etc.)
    try {
      const snapResult = db.snapshotDailyKPIs(database, { force: true });
      log('info', 'KPI snapshot', snapResult);
    } catch (e) {
      log('warn', 'KPI snapshot failed (backup continues)', { error: e.message });
    }
    const d = new Date();
    const stamp =
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const dest = path.join(BACKUP_DIR, BACKUP_PREFIX + stamp + '.db');
    if (fs.existsSync(dest)) {
      // Already have today's backup — record lastAttempt but don't overwrite.
      writeBackupStatus({ lastAttempt: { time: startedIso, success: true, skipped: 'already-exists' } });
      return;
    }
    // R-01: rotate BEFORE writing today's file so the new file is never a
    // candidate for deletion in the same pass. The 60s mtime guard inside
    // rotateAutoBackups is belt + suspenders against a future ordering
    // regression.
    try {
      const rot = rotateAutoBackups(BACKUP_DIR, AUTO_BACKUP_RETENTION_DAYS);
      log('info', 'Auto-backup rotation', {
        kept: rot.kept.length,
        deleted: rot.deleted,
        skipped: rot.skipped
      });
    } catch (e) {
      log('warn', 'Backup rotation failed', { error: e.message });
    }
    db.backupDb(database, dest)
      .then(() => {
        let sizeBytes = 0;
        try {
          sizeBytes = fs.statSync(dest).size;
        } catch {}
        const durationMs = Date.now() - startedAt;
        log('info', 'Auto-backup saved', { path: dest, sizeBytes, durationMs });
        // Sanity-check the written file before marking lastSuccess.
        const verifyError = verifyBackupFile(dest);
        if (verifyError) {
          log('error', 'Auto-backup verify failed', { path: dest, error: verifyError });
          writeBackupStatus({
            lastAttempt: { time: startedIso, success: false },
            lastFailure: { time: new Date().toISOString(), error: verifyError, path: dest }
          });
          return;
        }
        writeBackupStatus({
          lastAttempt: { time: startedIso, success: true },
          lastSuccess: {
            time: new Date().toISOString(),
            path: dest,
            sizeBytes,
            durationMs,
            verified: true
          }
        });
      })
      .catch((e) => {
        log('error', 'Auto-backup failed', { error: e.message });
        writeBackupStatus({
          lastAttempt: { time: startedIso, success: false },
          lastFailure: { time: new Date().toISOString(), error: e.message, path: dest }
        });
      });
  } catch (e) {
    log('error', 'Auto-backup failed', { error: e.message });
    writeBackupStatus({
      lastAttempt: { time: startedIso, success: false },
      lastFailure: { time: new Date().toISOString(), error: e.message }
    });
  }
}

function scheduleDailyBackup() {
  // Run one immediately on startup if today's doesn't exist yet
  runDailyBackup();
  // Schedule next at midnight
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0); // next midnight
  const msUntil = next - now;
  log('info', 'Next auto-backup scheduled', { at: next.toISOString() });
  setTimeout(() => {
    runDailyBackup();
    setInterval(runDailyBackup, 24 * 60 * 60 * 1000); // then every 24h
  }, msUntil);
  // Refresh KPI snapshot every 4 hours so data stays current throughout the day
  setInterval(
    () => {
      try {
        db.snapshotDailyKPIs(database, { force: true });
      } catch (e) {
        /* ignore */
      }
    },
    4 * 60 * 60 * 1000
  );
}
scheduleDailyBackup();

// ── DUCKDNS IP UPDATE ──────────────────────────────────────
let duckdnsInterval = null;

function updateDuckdnsIP(callback) {
  const cfg = db.getDuckdnsCfg(database);
  if (!cfg.enabled || !cfg.domain || !cfg.token) {
    if (callback) callback(null);
    return;
  }

  const url =
    'https://www.duckdns.org/update?domains=' +
    encodeURIComponent(cfg.domain) +
    '&token=' +
    encodeURIComponent(cfg.token) +
    '&verbose=true';

  const ddReq = https
    .get(url, (resp) => {
      let data = '';
      resp.on('data', (c) => {
        data += c;
      });
      resp.on('end', () => {
        const lines = data.trim().split('\n');
        const ok = lines[0] === 'OK';
        const ip = lines.length > 1 ? lines[1] : null;
        if (ok) {
          db.updateDuckdnsStatus(database, {
            lastIpUpdate: new Date().toISOString(),
            lastIp: ip || cfg.lastIp
          });
          log('info', 'DuckDNS IP updated', { domain: cfg.domain, ip });
        } else {
          log('warn', 'DuckDNS update failed', { domain: cfg.domain, response: data.trim() });
        }
        if (callback) callback(ok ? null : new Error('DuckDNS returned: ' + lines[0]));
      });
    })
    .on('error', (e) => {
      log('error', 'DuckDNS update error', { error: e.message });
      if (callback) callback(e);
    });
  // Match the ACME helper's 30 s timeout so a stalled duckdns.org connection
  // can't hang /api/duckdns/* or a cert-renewal step indefinitely.
  ddReq.setTimeout(30000, () => ddReq.destroy(new Error('DuckDNS request timed out')));
}

function startDuckdnsUpdater() {
  if (duckdnsInterval) {
    clearInterval(duckdnsInterval);
    duckdnsInterval = null;
  }
  // A worktree instance shares the parent repo's settings DB only when it
  // points at the same file — but even with separate DBs the same DuckDNS
  // creds often get copied in. Skip the updater entirely so the worktree
  // never fights prod over the external A record.
  if (WORKTREE_MODE) {
    log('info', 'DuckDNS updater skipped (worktree mode)');
    return;
  }
  const cfg = db.getDuckdnsCfg(database);
  if (cfg.enabled && cfg.domain && cfg.token) {
    updateDuckdnsIP();
    duckdnsInterval = setInterval(updateDuckdnsIP, 5 * 60 * 1000);
    log('info', 'DuckDNS updater started', { domain: cfg.domain + '.duckdns.org' });
  }
}

startDuckdnsUpdater();

// ── LET'S ENCRYPT CERT MANAGEMENT (native ACME v2) ─────────
// Pure Node.js — no bash, curl, or acme.sh required.
// Uses built-in crypto + https for ACME v2 (RFC 8555) with DNS-01 challenge.

const ACME_DIR_URL = 'https://acme-v02.api.letsencrypt.org/directory';
const ACME_ACCOUNT_KEY_PATH = path.join(DIR, 'certs', 'acme-account-key.pem');

function base64url(data) {
  return (Buffer.isBuffer(data) ? data : Buffer.from(data)).toString('base64url');
}

// ── DER / ASN.1 encoding helpers ──
function derLen(len) {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, len >> 8, len & 0xff]);
}
function derWrap(tag, buf) {
  return Buffer.concat([Buffer.from([tag]), derLen(buf.length), buf]);
}
function derSeq(...items) {
  return derWrap(0x30, Buffer.concat(items));
}
function derSet(...items) {
  return derWrap(0x31, Buffer.concat(items));
}
function derOid(bytes) {
  return derWrap(0x06, Buffer.from(bytes));
}
function derUtf8(str) {
  return derWrap(0x0c, Buffer.from(str, 'utf8'));
}
function derBitStr(buf) {
  return derWrap(0x03, Buffer.concat([Buffer.from([0x00]), buf]));
}
function derOctStr(buf) {
  return derWrap(0x04, buf);
}
function derInt(n) {
  return derWrap(0x02, Buffer.from([n]));
}

// ── HTTPS JSON request helper ──
function _acmeHttps(method, url, body, extraHeaders, callback) {
  if (typeof extraHeaders === 'function') {
    callback = extraHeaders;
    extraHeaders = {};
  }
  const u = new URL(url);
  const opts = {
    hostname: u.hostname,
    port: u.port || 443,
    path: u.pathname + u.search,
    method,
    headers: Object.assign({}, extraHeaders)
  };
  let bodyStr = null;
  if (body) {
    bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/jose+json';
    opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
  }
  const req = https.request(opts, (res) => {
    let raw = '';
    res.on('data', (c) => {
      raw += c;
    });
    res.on('end', () => {
      let json = null;
      if (raw)
        try {
          json = JSON.parse(raw);
        } catch (_) {}
      callback(null, res.statusCode, res.headers, json || raw);
    });
  });
  req.on('error', (err) => {
    if (err.code === 'ENOTFOUND')
      return callback(new Error('Server hat keinen Internetzugang (DNS-Auflösung fehlgeschlagen)'));
    if (err.code === 'ECONNREFUSED') return callback(new Error('Verbindung zum ACME-Server abgelehnt'));
    if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT')
      return callback(new Error('Zeitüberschreitung bei Verbindung zum ACME-Server'));
    callback(err);
  });
  req.setTimeout(30000, () => req.destroy(new Error('ACME request timeout')));
  if (bodyStr) req.write(bodyStr);
  req.end();
}

// ── Sequential async helper ──
function waterfall(fns, done) {
  let i = 0;
  (function next(err) {
    if (err || i >= fns.length) return done(err);
    try {
      fns[i++](next);
    } catch (e) {
      done(e);
    }
  })(null);
}

// ── ECDSA P-256 account key (persists in certs/) ──
function loadOrCreateAccountKey() {
  if (fs.existsSync(ACME_ACCOUNT_KEY_PATH)) {
    return crypto.createPrivateKey(fs.readFileSync(ACME_ACCOUNT_KEY_PATH));
  }
  log('info', 'Generating ACME account key...');
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const dir = path.dirname(ACME_ACCOUNT_KEY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ACME_ACCOUNT_KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return privateKey;
}

function getAccountJwk(key) {
  const j = crypto.createPublicKey(key).export({ format: 'jwk' });
  return { crv: j.crv, kty: j.kty, x: j.x, y: j.y };
}

function getJwkThumbprint(jwk) {
  const ordered = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return base64url(crypto.createHash('sha256').update(ordered).digest());
}

// ── JWS signing ──
function signJws(key, protectedHeader, payload) {
  const protB64 = base64url(JSON.stringify(protectedHeader));
  const payB64 = payload === '' ? '' : base64url(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(protB64 + '.' + payB64), {
    key,
    dsaEncoding: 'ieee-p1363'
  });
  return JSON.stringify({ protected: protB64, payload: payB64, signature: base64url(sig) });
}

// ── DuckDNS TXT record helpers ──
function setDuckdnsTxt(domain, token, value, callback) {
  const url =
    'https://www.duckdns.org/update?domains=' +
    encodeURIComponent(domain) +
    '&token=' +
    encodeURIComponent(token) +
    '&txt=' +
    encodeURIComponent(value) +
    '&verbose=true';
  const txtReq = https
    .get(url, (resp) => {
      let data = '';
      resp.on('data', (c) => {
        data += c;
      });
      resp.on('end', () => {
        data.trim().startsWith('OK')
          ? callback(null)
          : callback(new Error('DuckDNS TXT update failed: ' + data.trim()));
      });
    })
    .on('error', callback);
  txtReq.setTimeout(30000, () => txtReq.destroy(new Error('DuckDNS TXT request timed out')));
}

function clearDuckdnsTxt(domain, token) {
  const url =
    'https://www.duckdns.org/update?domains=' +
    encodeURIComponent(domain) +
    '&token=' +
    encodeURIComponent(token) +
    '&txt=&clear=true&verbose=true';
  const clrReq = https.get(url, () => {}).on('error', () => {});
  clrReq.setTimeout(30000, () => clrReq.destroy());
}

// ── PKCS#10 CSR construction ──
function buildCsr(domain) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  // Subject: CN=domain
  const subject = derSeq(derSet(derSeq(derOid([0x55, 0x04, 0x03]), derUtf8(domain))));

  // SAN extension in extensionRequest attribute
  const dnsName = Buffer.concat([
    Buffer.from([0x82]),
    derLen(Buffer.byteLength(domain, 'ascii')),
    Buffer.from(domain, 'ascii')
  ]);
  const sanExt = derSeq(derOid([0x55, 0x1d, 0x11]), derOctStr(derSeq(dnsName)));
  const extReq = derSeq(derOid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x0e]), derSet(derSeq(sanExt)));
  const attrs = derWrap(0xa0, extReq);

  // CertificationRequestInfo
  const reqInfo = derSeq(derInt(0), subject, spki, attrs);
  const sig = crypto.sign('sha256', reqInfo, privateKey);
  const sigAlg = derSeq(derOid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]), Buffer.from([0x05, 0x00]));

  return { der: derSeq(reqInfo, sigAlg, derBitStr(sig)), privateKey };
}

// ── Main certificate request orchestrator ──
function requestLetsEncryptCert(callback) {
  const cfg = db.getDuckdnsCfg(database);
  if (!cfg.domain || !cfg.token) {
    return callback(new Error('DuckDNS domain and token required'));
  }

  const fullDomain = cfg.domain + '.duckdns.org';
  let accountKey, jwk, thumbprint;
  let acmeDir, accountUrl, nonce;
  let order, orderUrl, challenge, certPem, domainKey;

  // Signed ACME POST with nonce tracking + badNonce retry
  function acmePost(url, payload, useJwk, cb) {
    let retries = 0;
    (function attempt() {
      const hdr = { alg: 'ES256', nonce, url };
      if (useJwk) hdr.jwk = jwk;
      else hdr.kid = accountUrl;
      const body = signJws(accountKey, hdr, payload);
      _acmeHttps('POST', url, body, (err, status, headers, data) => {
        if (err) return cb(err);
        nonce = headers['replay-nonce'] || nonce;
        if (data && data.type === 'urn:ietf:params:acme:error:badNonce' && ++retries < 3) {
          return attempt();
        }
        if (status >= 400) {
          const detail = data && data.detail ? data.detail : JSON.stringify(data);
          return cb(new Error('ACME error (' + status + '): ' + detail));
        }
        cb(null, status, headers, data);
      });
    })();
  }

  // Poll until target status
  function poll(url, target, maxAttempts, cb) {
    let attempts = 0;
    (function check() {
      acmePost(url, '', false, (err, _s, _h, data) => {
        if (err) return cb(err);
        if (data.status === target) return cb(null, data);
        if (data.status === 'invalid') {
          const msg = (data.challenges || [])
            .map((c) => c.error && c.error.detail)
            .filter(Boolean)
            .join('; ');
          return cb(new Error('Validation failed: ' + (msg || JSON.stringify(data))));
        }
        if (++attempts >= maxAttempts) return cb(new Error('ACME polling timed out'));
        setTimeout(check, 3000);
      });
    })();
  }

  log('info', "Requesting Let's Encrypt certificate...", { domain: fullDomain });

  waterfall(
    [
      // 1. Load/create account key
      (next) => {
        try {
          accountKey = loadOrCreateAccountKey();
        } catch (e) {
          return next(e);
        }
        jwk = getAccountJwk(accountKey);
        thumbprint = getJwkThumbprint(jwk);
        next(null);
      },
      // 2. Fetch ACME directory
      (next) => {
        _acmeHttps('GET', ACME_DIR_URL, null, (err, _s, _h, data) => {
          if (err) return next(err);
          acmeDir = data;
          next(null);
        });
      },
      // 3. Get initial nonce
      (next) => {
        _acmeHttps('HEAD', acmeDir.newNonce, null, (err, _s, headers) => {
          if (err) return next(err);
          nonce = headers['replay-nonce'];
          next(null);
        });
      },
      // 4. Create or find account
      (next) => {
        acmePost(acmeDir.newAccount, { termsOfServiceAgreed: true }, true, (err, _s, headers) => {
          if (err) return next(err);
          accountUrl = headers.location;
          log('info', 'ACME account ready', { url: accountUrl });
          next(null);
        });
      },
      // 5. Create order
      (next) => {
        acmePost(
          acmeDir.newOrder,
          {
            identifiers: [{ type: 'dns', value: fullDomain }]
          },
          false,
          (err, _s, headers, data) => {
            if (err) return next(err);
            order = data;
            orderUrl = headers.location;
            next(null);
          }
        );
      },
      // 6. Get authorization + dns-01 challenge
      (next) => {
        acmePost(order.authorizations[0], '', false, (err, _s, _h, data) => {
          if (err) return next(err);
          challenge = (data.challenges || []).find((c) => c.type === 'dns-01');
          if (!challenge) return next(new Error('No dns-01 challenge offered'));
          next(null);
        });
      },
      // 7. Set TXT record via DuckDNS
      (next) => {
        const keyAuth = challenge.token + '.' + thumbprint;
        const dns01 = base64url(crypto.createHash('sha256').update(keyAuth).digest());
        log('info', 'Setting DuckDNS TXT record...', { domain: cfg.domain });
        setDuckdnsTxt(cfg.domain, cfg.token, dns01, next);
      },
      // 8. Wait for DNS propagation
      (next) => {
        log('info', 'Waiting for DNS propagation (15s)...');
        setTimeout(next, 15000);
      },
      // 9. Respond to challenge
      (next) => {
        acmePost(challenge.url, {}, false, (err) => next(err));
      },
      // 10. Poll authorization until valid
      (next) => {
        poll(order.authorizations[0], 'valid', 40, (err) => {
          if (err) return next(err);
          log('info', 'DNS-01 challenge validated');
          next(null);
        });
      },
      // 11. Build CSR and finalize order
      (next) => {
        const csr = buildCsr(fullDomain);
        domainKey = csr.privateKey;
        acmePost(order.finalize, { csr: base64url(csr.der) }, false, (err) => next(err));
      },
      // 12. Poll order until cert ready
      (next) => {
        poll(orderUrl, 'valid', 20, (err, data) => {
          if (err) return next(err);
          order = data;
          next(null);
        });
      },
      // 13. Download certificate
      (next) => {
        acmePost(order.certificate, '', false, (err, _s, _h, data) => {
          if (err) return next(err);
          certPem = typeof data === 'string' ? data : '';
          if (!certPem || !certPem.includes('BEGIN CERTIFICATE')) {
            return next(new Error('Invalid certificate response'));
          }
          next(null);
        });
      },
      // 14. Save certificate and key
      (next) => {
        try {
          const certsDir = path.dirname(CERT_KEY);
          if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir, { recursive: true });
          fs.writeFileSync(CERT_CRT, certPem);
          fs.writeFileSync(CERT_KEY, domainKey.export({ type: 'pkcs8', format: 'pem' }));
        } catch (e) {
          return next(e);
        }
        next(null);
      }
    ],
    (err) => {
      clearDuckdnsTxt(cfg.domain, cfg.token);
      if (err) {
        log('error', "Let's Encrypt request failed", { error: err.message });
        return callback(err);
      }
      const now = new Date();
      const expiry = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      db.updateDuckdnsStatus(database, {
        leLastRenewal: now.toISOString(),
        leExpiry: expiry.toISOString()
      });
      reloadTlsCerts();
      log('info', "Let's Encrypt cert installed", { domain: fullDomain, expiry: expiry.toISOString() });
      callback(null, { domain: fullDomain, expiry: expiry.toISOString() });
    }
  );
}

function checkCertRenewal() {
  // Worktree instance must not race prod for the ACME challenge: both
  // would try to bind port 80 for http-01 and hammer the LE rate limit
  // on the same hostname. Cert files live in this worktree's certs/
  // (per-directory) so the renewal would be lost anyway.
  if (WORKTREE_MODE) return;
  const cfg = db.getDuckdnsCfg(database);
  if (!cfg.leEnabled || !cfg.domain || !cfg.token) return;
  if (!cfg.leExpiry) return;

  const expiry = new Date(cfg.leExpiry);
  const daysLeft = (expiry - Date.now()) / (24 * 60 * 60 * 1000);

  if (daysLeft < 30) {
    log('info', "Let's Encrypt cert expires in " + Math.round(daysLeft) + ' days, renewing...');
    requestLetsEncryptCert((err, result) => {
      if (err) log('error', 'Auto-renewal failed', { error: err.message });
      else log('info', 'Auto-renewal succeeded', result);
    });
  }
}

checkCertRenewal();
setInterval(checkCertRenewal, 12 * 60 * 60 * 1000);

// Short-lived cache for printer availability check (5 seconds)
let _printerStatusCache = null;
let _printerStatusCacheTime = 0;
// R-20: cached count of stuck print-spooler jobs (Paused/Error/Blocked/etc).
// queueStuck > 0 is a degraded signal even when the printer reports online.
let _printerQueueStuckCache = 0;

// Read the effective bridge configuration. DB values (Settings → Drucker)
// take precedence over env vars (PRINT_BRIDGE_URL/PRINT_BRIDGE_TOKEN), so a
// user can configure the bridge from the UI without restarting the server.
// Returns null if neither is configured — callers should treat that as
// "no bridge available" and fall back to the local PowerShell path.
function getEffectiveBridgeConfig() {
  try {
    const cfg = db.getPrintBridgeCfg(database);
    if (cfg.enabled && cfg.url) {
      return { url: cfg.url.replace(/\/+$/, ''), token: cfg.token || '', source: 'db' };
    }
  } catch (e) {
    log('warn', 'Failed to read print_bridge_config', { error: e.message });
  }
  if (PRINT_BRIDGE_URL_ENV) {
    return { url: PRINT_BRIDGE_URL_ENV, token: PRINT_BRIDGE_TOKEN_ENV, source: 'env' };
  }
  return null;
}

// Make an HTTPS request to the print bridge with a 5s timeout.
// callback(err, { statusCode, body, raw }) — body is parsed JSON or null.
//
// The bridge ships with a self-signed cert generated by `print-bridge.ps1
// -Install`. We can't validate its chain (no CA), but the connection is
// still encrypted, so the X-Bridge-Token header and the ZPL payload don't
// travel in cleartext over the LAN. HTTP URLs are still tolerated for
// backwards compatibility with .env-based setups predating the TLS switch
// — they log a warning every request so the operator notices.
function _bridgeRequest(method, urlPath, body, callback) {
  const cfg = getEffectiveBridgeConfig();
  if (!cfg) {
    return callback(new Error('No print bridge configured'));
  }
  let target;
  try {
    target = new URL(urlPath, cfg.url + '/');
  } catch (e) {
    return callback(new Error('Invalid bridge URL: ' + e.message));
  }
  const isHttps = target.protocol === 'https:';
  if (!isHttps) {
    log('warn', 'Print bridge using cleartext HTTP — re-run print-bridge.ps1 -Install on Windows to upgrade to TLS', {
      bridge: cfg.url
    });
  }
  const lib = isHttps ? https : http;
  const headers = {};
  if (cfg.token) headers['X-Bridge-Token'] = cfg.token;
  const bodyBuf = body == null ? null : Buffer.from(body, 'utf8');
  if (bodyBuf) {
    headers['Content-Type'] = 'text/plain; charset=utf-8';
    headers['Content-Length'] = bodyBuf.length;
  }
  const reqOpts = { method, headers, timeout: 5000 };
  if (isHttps) {
    // Bridge cert is self-signed. We trade chain validation for an
    // encrypted channel + token auth, which is the right call on a
    // trusted LAN. Future enhancement: pin to a stored fingerprint.
    reqOpts.rejectUnauthorized = false;
  }
  const req = lib.request(target, reqOpts, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (c) => (data += c));
    res.on('end', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(data);
      } catch {
        /* not JSON — leave parsed null */
      }
      callback(null, { statusCode: res.statusCode, body: parsed, raw: data });
    });
  });
  req.on('timeout', () => {
    req.destroy(new Error('Bridge timeout'));
  });
  req.on('error', (err) => callback(err));
  if (bodyBuf) req.write(bodyBuf);
  req.end();
}

// Returns a rich status object describing whether label printing is currently
// possible. State values:
//   'online'              — printer reachable and ready to receive ZPL
//   'printer_offline'     — bridge reachable but the printer is not connected
//   'bridge_unreachable'  — bridge configured but did not respond (Windows
//                           PC off, network issue)
//   'no_bridge'           — server is non-Windows and no bridge is
//                           configured; clients should use the ZPL-download
//                           flow
//   'local_unavailable'   — Windows-local PowerShell path could not find
//                           the printer
function getPrinterStatus(callback) {
  const cfg = getEffectiveBridgeConfig();
  if (cfg) {
    return _bridgeRequest('GET', 'status', null, (err, resp) => {
      if (err) {
        return callback(null, {
          state: 'bridge_unreachable',
          name: PRINTER_NAME,
          online: false,
          queueStuck: 0,
          bridge: cfg.url,
          error: err.message
        });
      }
      const printer = resp && resp.body && resp.body.printer;
      // R-20: pass queueStuck through unchanged. Bridge versions that
      // pre-date the audit will return undefined — coerce to 0 so consumers
      // can rely on the field being a number.
      const queueStuck = resp && resp.body && Number.isFinite(resp.body.queueStuck) ? resp.body.queueStuck : 0;
      if (resp && resp.statusCode === 200 && resp.body && resp.body.ok && printer && printer.online) {
        return callback(null, {
          state: 'online',
          name: printer.name || PRINTER_NAME,
          online: true,
          queueStuck
        });
      }
      return callback(null, {
        state: 'printer_offline',
        name: (printer && printer.name) || PRINTER_NAME,
        online: false,
        queueStuck,
        error: (resp && resp.body && resp.body.error) || null
      });
    });
  }
  if (process.platform !== 'win32') {
    return callback(null, { state: 'no_bridge', name: PRINTER_NAME, online: false, queueStuck: 0 });
  }
  execFile(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-Printer -Name "${PRINTER_NAME.replace(/"/g, '')}" | Select-Object -Property Name,PrinterStatus | ConvertTo-Json`
    ],
    // Timeout so a hung spooler/PowerShell can't leave /api/printer-status and
    // any /api/print waiting on checkPrinterAvailable hanging forever (the
    // bridge and the print path already cap at 5 s / 15 s). On timeout execFile
    // kills the child and calls back with an error → local_unavailable below.
    { timeout: 10000, windowsHide: true },
    (err, stdout) => {
      if (err || !stdout.includes(PRINTER_NAME)) {
        return callback(null, { state: 'local_unavailable', name: PRINTER_NAME, online: false, queueStuck: 0 });
      }
      callback(null, { state: 'online', name: PRINTER_NAME, online: true, queueStuck: 0 });
    }
  );
}

function checkPrinterAvailable(callback) {
  const now = Date.now();
  if (_printerStatusCache !== null && now - _printerStatusCacheTime < 5000) {
    return callback(null, _printerStatusCache);
  }
  getPrinterStatus((err, status) => {
    const available = !err && status && status.state === 'online';
    _printerStatusCache = available;
    _printerQueueStuckCache = status && Number.isFinite(status.queueStuck) ? status.queueStuck : 0;
    _printerStatusCacheTime = Date.now();
    callback(null, available);
  });
}

// Send raw ZPL to the Zebra GK420d. Routes through the print bridge if one
// is configured (DB or env), otherwise prints locally via PowerShell
// (Windows-only — fails on Linux servers without a bridge).
function printZPL(zplData, callback) {
  if (getEffectiveBridgeConfig()) return _printViaBridge(zplData, callback);
  return _printViaPowerShell(zplData, callback);
}

function _printViaBridge(zplData, callback) {
  const zplFixed = zplData.replace(/\r?\n/g, '\r\n');
  _bridgeRequest('POST', 'print', zplFixed, (err, resp) => {
    if (err) {
      const cfg = getEffectiveBridgeConfig();
      log('error', 'Print bridge unreachable', { error: err.message, bridge: cfg && cfg.url });
      return callback('Print bridge unreachable: ' + err.message);
    }
    if (!resp || resp.statusCode !== 200 || !resp.body || !resp.body.ok) {
      const reason = (resp && resp.body && resp.body.error) || 'HTTP ' + (resp && resp.statusCode);
      log('error', 'Bridge print failed', { reason });
      return callback('Bridge print failed: ' + reason);
    }
    log('info', 'Print via bridge OK', { bytes: resp.body.bytes });
    callback(null);
  });
}

function _printViaPowerShell(zplData, callback) {
  // I-18: rapid-fire prints (label batch on a single click) can land in the
  // same millisecond, so two callers would share `mp_label_<ms>.zpl` and
  // overwrite each other. Random suffix keeps each call's tempfile unique.
  const tmp = path.join(os.tmpdir(), 'mp_label_' + crypto.randomBytes(8).toString('hex') + '.zpl');
  const zplFixed = zplData.replace(/\r?\n/g, '\r\n');

  fs.writeFile(tmp, zplFixed, 'binary', (err) => {
    if (err) return callback('Could not write temp file: ' + err.message);

    const ps = `
$printerName = "${PRINTER_NAME}"
$filePath = "${tmp.replace(/\\/g, '\\\\')}"
Try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [DllImport("winspool.drv", EntryPoint="OpenPrinterA", SetLastError=true)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterA", SetLastError=true)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="WritePrinter", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
public class DOCINFO {
  [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
  [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
  [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
}
"@
  $bytes = [System.IO.File]::ReadAllBytes($filePath)
  $hPrinter = [IntPtr]::Zero
  $di = New-Object DOCINFO
  $di.pDocName = "ZPL Label"
  $di.pOutputFile = $null
  $di.pDataType = "RAW"
  if (![RawPrinter]::OpenPrinter($printerName, [ref]$hPrinter, [IntPtr]::Zero)) { throw "Cannot open printer: $printerName" }
  if ([RawPrinter]::StartDocPrinter($hPrinter, 1, $di) -eq 0) { [RawPrinter]::ClosePrinter($hPrinter); throw "StartDocPrinter failed" }
  [RawPrinter]::StartPagePrinter($hPrinter) | Out-Null
  $ptrBytes = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptrBytes, $bytes.Length)
  $written = 0
  [RawPrinter]::WritePrinter($hPrinter, $ptrBytes, $bytes.Length, [ref]$written) | Out-Null
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrBytes)
  [RawPrinter]::EndPagePrinter($hPrinter) | Out-Null
  [RawPrinter]::EndDocPrinter($hPrinter) | Out-Null
  [RawPrinter]::ClosePrinter($hPrinter) | Out-Null
  Write-Output "OK:$written bytes sent"
} Catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim();

    // R-11: Phase 2 I-18 fixed Date.now() in the .zpl tempfile but missed
    // this .ps1 sibling. Two concurrent print calls would step on the same
    // tempfile and one would lose its script.
    const psTmp = path.join(os.tmpdir(), 'mp_print_' + crypto.randomBytes(8).toString('hex') + '.ps1');
    fs.writeFile(psTmp, ps, 'utf8', (err2) => {
      if (err2) {
        fs.unlink(tmp, () => {});
        return callback('Could not write PS script: ' + err2.message);
      }

      const cleanup = () => {
        fs.unlink(tmp, (e) => {
          if (e) log('warn', 'Failed to delete temp ZPL file', { error: e.message });
        });
        fs.unlink(psTmp, (e) => {
          if (e) log('warn', 'Failed to delete temp PS1 file', { error: e.message });
        });
      };

      const child = execFile(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psTmp],
        (e, stdout, stderr) => {
          cleanup();
          if (e) {
            log('error', 'PowerShell print error', { error: stderr || e.message });
            callback('Print failed: ' + (stderr || e.message).trim());
          } else {
            log('info', 'Print OK', { output: stdout.trim() });
            callback(null);
          }
        }
      );

      const timeout = setTimeout(() => {
        child.kill();
        cleanup();
        log('warn', 'PowerShell print process timed out and was killed');
        callback('Print failed: PowerShell process timed out');
      }, 15000);

      child.on('close', () => clearTimeout(timeout));
    });
  });
}

// ══════════════════════════════════════════════════════════════
// ── BUILT-IN CalDAV SERVER ───────────────────────────────────
// ══════════════════════════════════════════════════════════════
// Serves VTODO calendars at /caldav/ — compatible with any
// CalDAV client (Apple Calendar, Thunderbird, DAVx5, etc.)
// Data stored in /calendars/<cal-name>/<uid>.ics
// No npm dependencies — pure Node.js

// RFC 5545 §3.1: fold content lines longer than 75 octets
function foldIcsLines(icsText) {
  return icsText
    .split('\r\n')
    .map((line) => {
      if (Buffer.byteLength(line, 'utf8') <= 75) return line;
      const parts = [];
      let remaining = line;
      let first = true;
      while (Buffer.byteLength(remaining, 'utf8') > 75) {
        const limit = first ? 75 : 74; // subsequent lines have leading space
        let cut = limit;
        while (cut > 0 && Buffer.byteLength(remaining.slice(0, cut), 'utf8') > limit) cut--;
        parts.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut);
        first = false;
      }
      if (remaining) parts.push(remaining);
      return parts.join('\r\n ');
    })
    .join('\r\n');
}

// Unfold RFC 5545 §3.1 folded lines (CRLF + space/tab → join)
function unfoldIcs(text) {
  return text.replace(/\r?\n[ \t]/g, '');
}

function generateUID() {
  return 'mp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Read only the first N bytes of a file (for orphan cleanup — avoids reading entire ICS)
function readFileHead(filePath, bytes) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const bytesRead = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

// Escape iCalendar TEXT values per RFC 5545 §3.3.11
function escapeIcsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// I-15: build a single-line RRULE property from our internal recurrence enum.
// Returns null when recurrence is unset or unsupported (so the caller can omit
// the property entirely). UNTIL is encoded in UTC RFC-5545 form
// (YYYYMMDDTHHMMSSZ) when `until` is provided as an ISO date / datetime.
function buildRRuleLine(recurrence, until) {
  const freqMap = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
  const freq = freqMap[String(recurrence || '').toLowerCase()];
  if (!freq) return null;
  let line = 'RRULE:FREQ=' + freq;
  if (until) {
    // Accept "YYYY-MM-DD" or full ISO; emit UTC "YYYYMMDDTHHMMSSZ".
    const d = new Date(until);
    if (!isNaN(d.getTime())) {
      const u = d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
      line += ';UNTIL=' + u;
    }
  }
  return line;
}

// I-15: format a single EXDATE value to match the event's DTSTART encoding.
// `dateStr` is whatever the JSON-array column holds — typically YYYY-MM-DD or
// a full ISO datetime. `dtstartIsAllDay` controls whether we emit a date-only
// value (VALUE=DATE) or a TZID-qualified local datetime.
function formatExceptionDate(dateStr, dtstartIsAllDay, dtstartTime) {
  if (!dateStr) return null;
  const trimmed = String(dateStr).trim();
  if (!trimmed) return null;
  if (dtstartIsAllDay) {
    // Date-only: strip any time portion, emit YYYYMMDD.
    const dateOnly = trimmed.slice(0, 10).replace(/-/g, '');
    if (!/^\d{8}$/.test(dateOnly)) return null;
    return dateOnly;
  }
  // Datetime: combine the exception date with the original event time so the
  // EXDATE matches the DTSTART instance exactly. dtstartTime is "HH:MM".
  const dateOnly = trimmed.slice(0, 10).replace(/-/g, '');
  if (!/^\d{8}$/.test(dateOnly)) return null;
  const hhmm = (dtstartTime || '00:00').replace(':', '') + '00';
  return dateOnly + 'T' + hhmm;
}

// I-15: render the full EXDATE line(s) for an event. CalDAV clients accept a
// single EXDATE with comma-separated values. Returns null when there are no
// exceptions so the caller can skip pushing the property.
function buildExdateLine(exceptionDates, dtstartIsAllDay, dtstartTime, tzid) {
  if (!Array.isArray(exceptionDates) || !exceptionDates.length) return null;
  const formatted = exceptionDates.map((d) => formatExceptionDate(d, dtstartIsAllDay, dtstartTime)).filter(Boolean);
  if (!formatted.length) return null;
  if (dtstartIsAllDay) return 'EXDATE;VALUE=DATE:' + formatted.join(',');
  return 'EXDATE;TZID=' + (tzid || 'Europe/Berlin') + ':' + formatted.join(',');
}

// Sanitize URL path parts to prevent directory traversal attacks.
// Platform-independent: rejects every byte that could mean "another path
// component" (forward slash, backslash, NUL) regardless of whether the
// process is running on POSIX or Windows. Also rejects empty / dot / dot-dot.
function sanitizePart(s) {
  if (typeof s !== 'string' || !s) return null;
  // Reject explicit traversal characters and dotfile names
  if (/[\/\\\0]/.test(s)) return null;
  if (s === '.' || s === '..') return null;
  return s;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Extract username from Basic auth header (without verifying password)
function extractBasicAuthUsername(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Basic ')) return null;
  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
  const idx = decoded.indexOf(':');
  return idx >= 0 ? decoded.slice(0, idx) : null;
}

// Check CalDAV basic auth against user accounts.
// Handles charset mismatches: iOS/Safari may send Basic Auth as ISO-8859-1
// (latin1) when the WWW-Authenticate header lacks charset="UTF-8".
// Also tries case-insensitive username lookup as fallback.
function checkCaldavAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Basic ')) return false;
  const raw = Buffer.from(authHeader.slice(6), 'base64');

  // Try UTF-8 first (standard), then latin1 (legacy Basic Auth default per RFC 2617)
  for (const encoding of ['utf8', 'latin1']) {
    const decoded = raw.toString(encoding);
    const idx = decoded.indexOf(':');
    if (idx < 0) continue;
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);

    // Try exact username match, then case-insensitive fallback
    const account = db.getUserByUsername(database, user) || db.getUserByUsernameCaseInsensitive(database, user);
    if (!account) continue;
    if (db.verifyPassword(account.hash, account.salt, pass)) return account;
  }
  return false;
}

// ── CalDAV category calendars with colors matching web calendar ──
const CALDAV_CATEGORY_CALS = {
  meisterpilze: { displayName: 'Meisterpilze (Aufgaben)', color: '#16a34a' },
  faelligkeiten: { displayName: 'Fälligkeiten', color: '#ef4444' },
  aufgaben: { displayName: 'Aufgaben', color: '#3b82f6' },
  'eigene-termine': { displayName: 'Eigene Termine', color: '#22c55e' },
  meetings: { displayName: 'Meetings', color: '#8b5cf6' },
  lieferungen: { displayName: 'Lieferungen', color: '#14b8a6' },
  wartung: { displayName: 'Wartung', color: '#64748b' }
};
const CALDAV_EVENT_CATEGORY_MAP = {
  custom: 'eigene-termine',
  meeting: 'meetings',
  delivery: 'lieferungen',
  maintenance: 'wartung'
};
const USER_CALENDAR_COLORS = ['#f97316', '#ec4899', '#eab308', '#6366f1', '#06b6d4', '#84cc16', '#d946ef'];

// Compute dominant batch location from scan log (server-side equivalent of web getBatchLoc)
function getBatchLocServer(batch, scanLog) {
  const locs = {};
  (batch.bags || []).forEach((bag) => {
    const last = [...scanLog].reverse().find((e) => (e.bag || '').toUpperCase() === bag.toUpperCase());
    if (last && last.action !== 'REMOVE' && last.to) locs[last.to] = (locs[last.to] || 0) + 1;
  });
  const entries = Object.entries(locs);
  if (!entries.length) return '';
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

// Per-calendar access control: personal calendars are only accessible by that user (or admins)
// Shared 'meisterpilze' calendar is accessible by all authenticated users
function checkCalendarAccess(req, calName) {
  if (CALDAV_CATEGORY_CALS[calName]) return true;
  if (req.caldavUser.role === 'admin') return true;
  return req.caldavUserSlug === calName;
}

// Get display name and color for a calendar
function getCalDisplayInfo(calName) {
  if (CALDAV_CATEGORY_CALS[calName]) {
    return { displayName: CALDAV_CATEGORY_CALS[calName].displayName, color: CALDAV_CATEGORY_CALS[calName].color };
  }
  const users = db.listUsers(database);
  const userIdx = users.findIndex((u) => u.username.toLowerCase().replace(/[^a-z0-9]+/g, '-') === calName);
  if (userIdx >= 0) {
    return { displayName: users[userIdx].username, color: USER_CALENDAR_COLORS[userIdx % USER_CALENDAR_COLORS.length] };
  }
  return { displayName: calName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), color: null };
}

// Ensure a calendar directory exists
function ensureCalDir(calName) {
  const dir = path.join(CAL_DIR, calName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// List all calendar directories
function listCalendars() {
  if (!fs.existsSync(CAL_DIR)) return [];
  return fs.readdirSync(CAL_DIR).filter((f) => {
    return fs.statSync(path.join(CAL_DIR, f)).isDirectory();
  });
}

// List all .ics files in a calendar
function listIcsFiles(calName) {
  const dir = path.join(CAL_DIR, calName);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.ics'));
}

// CTag cache — avoids filesystem scan on every PROPFIND poll
const ctagCache = new Map();
// ETag cache — avoids stat() on every PROPFIND/REPORT item
const etagCache = new Map();

function invalidateCalendarCache(calName) {
  ctagCache.delete(calName);
  // Clear all etags for this calendar
  const prefix = calName + '/';
  for (const key of etagCache.keys()) {
    if (key.startsWith(prefix)) etagCache.delete(key);
  }
}

function invalidateCtag(calName) {
  invalidateCalendarCache(calName);
}

function getEtag(calName, fileName) {
  const key = calName + '/' + fileName;
  if (etagCache.has(key)) return etagCache.get(key);
  try {
    const stat = fs.statSync(path.join(CAL_DIR, calName, fileName));
    const etag = '"' + stat.mtimeMs.toString(36) + '"';
    etagCache.set(key, etag);
    return etag;
  } catch {
    return null;
  }
}

// ── RFC 6578 sync-token tracking ──
const syncTokens = new Map(); // calName → current monotonic counter
const changeLog = new Map(); // calName → Map<fileName, {action:'changed'|'deleted', token}>
const CHANGE_LOG_MAX = 1000; // max entries per calendar before trimming

function bumpSyncToken(calName) {
  const next = (syncTokens.get(calName) || 0) + 1;
  syncTokens.set(calName, next);
  return next;
}

function recordChange(calName, fileName, action) {
  const token = bumpSyncToken(calName);
  if (!changeLog.has(calName)) changeLog.set(calName, new Map());
  const log = changeLog.get(calName);
  log.set(fileName, { action, token });
  // Trim oldest entries if over limit
  if (log.size > CHANGE_LOG_MAX) {
    const entries = [...log.entries()].sort((a, b) => a[1].token - b[1].token);
    while (log.size > CHANGE_LOG_MAX) log.delete(entries.shift()[0]);
  }
}

function getSyncToken(calName) {
  return syncTokens.get(calName) || 0;
}

// Write an .ics file and invalidate caches / record change
function writeIcsFile(calName, fileName, content) {
  const dir = ensureCalDir(calName);
  fs.writeFileSync(path.join(dir, fileName), content, 'utf8');
  invalidateCtag(calName);
  recordChange(calName, fileName, 'changed');
}

// Delete an .ics file and invalidate caches / record change
function deleteIcsFile(calName, fileName) {
  const filePath = path.join(CAL_DIR, calName, fileName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    invalidateCtag(calName);
    recordChange(calName, fileName, 'deleted');
  }
}

// Compute a stable ctag for a calendar based on file contents (cached)
function computeCtag(calName) {
  if (ctagCache.has(calName)) return ctagCache.get(calName);
  const dir = path.join(CAL_DIR, calName);
  if (!fs.existsSync(dir)) return '0';
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ics'))
    .sort();
  const hash = crypto.createHash('md5');
  for (const f of files) {
    const stat = fs.statSync(path.join(dir, f));
    hash.update(f + ':' + stat.mtimeMs + ':' + stat.size + '\n');
  }
  const ctag = hash.digest('hex').slice(0, 16);
  ctagCache.set(calName, ctag);
  return ctag;
}

// CalDAV event color map — matches CATEGORY_COLORS in app.js
const CALDAV_CATEGORY_COLORS = { custom: '#16a34a', meeting: '#8b5cf6', delivery: '#14b8a6', maintenance: '#64748b' };

// RFC 5545 PRIORITY → app priority mapping (1=highest, 9=lowest, 0=undefined)
const CALDAV_PRIO_MAP = {
  1: 'high',
  2: 'high',
  3: 'high',
  4: 'high',
  5: 'med',
  6: 'low',
  7: 'low',
  8: 'low',
  9: 'low',
  0: 'med'
};

// Known calendar event categories
const KNOWN_CATEGORIES = { custom: 1, meeting: 1, delivery: 1, maintenance: 1 };

// Supported CalDAV report set XML (used in PROPFIND responses)
const SUPPORTED_REPORT_SET =
  '<d:supported-report-set><d:supported-report><d:report><c:calendar-multiget/></d:report></d:supported-report><d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report><d:supported-report><d:report><d:sync-collection/></d:report></d:supported-report></d:supported-report-set>';

// Extract the VEVENT block from ICS content (avoids parsing VTIMEZONE properties)
function extractVeventBlock(ics) {
  const m = ics.match(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/);
  return m ? m[1] : '';
}

// Convert a task object to VTODO .ics content
function taskToVTODO(task) {
  const uid = task.caldavUid || generateUID();
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const created = task.created ? new Date(task.created).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '') : now;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meisterpilze Lab Tracker//EN',
    'BEGIN:VTODO',
    'UID:' + uid,
    'DTSTAMP:' + now,
    'CREATED:' + created,
    'LAST-MODIFIED:' + now,
    // I-15: SEQUENCE counter (RFC 5545 §3.8.7.4) — CalDAV clients use this
    // to detect that an event/todo has been updated. Bumped on every
    // meaningful edit by db.updateTaskById.
    'SEQUENCE:' + (Number(task.sequence) || 0),
    'SUMMARY:' + escapeIcsText(task.text || '')
  ];
  if (task.dueDate) {
    const d = new Date(task.dueDate).toISOString().replace(/[-:]/g, '').split('T')[0];
    if (task.dueTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(task.dueTime)) {
      // Floating local-time DUE so CalDAV clients render it at the wall-clock
      lines.push('DUE:' + d + 'T' + task.dueTime.replace(':', '') + '00');
    } else {
      lines.push('DUE;VALUE=DATE:' + d);
    }
  }
  // I-15: emit RRULE (RFC 5545 §3.8.5.3) when the task is recurring. UNTIL is
  // expressed in UTC RFC-5545 form (YYYYMMDDTHHMMSSZ) for time-bounded series.
  const rruleLine = buildRRuleLine(task.recurrence, task.recurrenceUntil);
  if (rruleLine) lines.push(rruleLine);
  const prioMap = { high: 1, med: 5, low: 9 };
  lines.push('PRIORITY:' + (prioMap[task.priority] || 0));
  lines.push('STATUS:' + (task.done ? 'COMPLETED' : 'NEEDS-ACTION'));
  if (task.done) lines.push('PERCENT-COMPLETE:100');
  lines.push('X-MEISTERPILZE-TYPE:task');
  if (task.assignee) lines.push('X-MEISTERPILZE-ASSIGNEE:' + task.assignee);
  if (task.description) lines.push('DESCRIPTION:' + escapeIcsText(task.description));
  lines.push('COLOR:#3b82f6');
  lines.push('END:VTODO', 'END:VCALENDAR');
  return { uid, ics: foldIcsLines(lines.join('\r\n')) };
}

// Write a task as .ics file to the appropriate calendar
function writeTaskToCalendar(task, calName) {
  calName = calName || 'meisterpilze';
  if (!task.caldavUid) task.caldavUid = generateUID();
  const { uid, ics } = taskToVTODO(task);
  writeIcsFile(calName, uid + '.ics', ics);
  task.caldavSynced = new Date().toISOString();
  return uid;
}

// YYYYMMDD of `date` in Europe/Berlin (the .ics TZID), independent of the
// server's own timezone. Deriving an all-day date via toISOString() (UTC)
// shifts it a day earlier for a due date stored as Berlin local midnight.
function _berlinDateCompact(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .format(date)
    .replace(/-/g, '');
}

// Convert a batch to VEVENT .ics content (all-day event for due date)
function batchToVEVENT(batch, scanLog) {
  const uid = 'batch-' + batch.batchId + '@meisterpilze';
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const dueDate = _berlinDateCompact(new Date(batch.due));
  // DTEND is next day for all-day events per RFC 5545
  const endDate = _berlinDateCompact(new Date(new Date(batch.due).getTime() + 86400000));
  const loc = scanLog ? getBatchLocServer(batch, scanLog) : '';
  const summary = escapeIcsText(batch.batchId + (loc ? ' — ' + loc : ''));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meisterpilze Lab Tracker//EN',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + now,
    // I-15: SEQUENCE on batch-due VEVENTs. Batches don't have an in-DB
    // sequence column (the iCal artifact is one-shot per due-date), but
    // emitting 0 for completeness keeps client validators quiet.
    'SEQUENCE:0',
    'DTSTART;VALUE=DATE:' + dueDate,
    'DTEND;VALUE=DATE:' + endDate,
    'SUMMARY:' + summary,
    'CATEGORIES:Fälligkeiten'
  ];
  if (loc) lines.push('LOCATION:' + escapeIcsText(loc));
  // Prefer the joined mushroom_strains values; fall back to legacy free-text
  // fields for historical batches without a strain_id.
  const descName = batch.strainName || batch.species || '';
  const descKuerzel = batch.strainKuerzel || batch.strain || '';
  const descText = descName + (descKuerzel ? ' (' + descKuerzel + ')' : '');
  lines.push(
    'DESCRIPTION:' + escapeIcsText(descText),
    'TRANSP:TRANSPARENT',
    'X-MEISTERPILZE-TYPE:batch-due',
    'X-MEISTERPILZE-BATCH:' + batch.batchId,
    'COLOR:#ef4444',
    'END:VEVENT',
    'END:VCALENDAR'
  );
  return { uid, ics: foldIcsLines(lines.join('\r\n')) };
}

// Convert a task with due date to VEVENT .ics content
function taskDueToVEVENT(task) {
  const uid = (task.caldavUid || generateUID()) + '-event';
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const dueDate = new Date(task.dueDate).toISOString().replace(/[-:]/g, '').split('T')[0];
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  const hasTime = task.dueTime && timeRe.test(task.dueTime);
  let dtStartLine, dtEndLine;
  if (hasTime) {
    const startRaw = dueDate + 'T' + task.dueTime.replace(':', '') + '00';
    let endRaw;
    if (task.dueEndTime && timeRe.test(task.dueEndTime) && task.dueEndTime > task.dueTime) {
      endRaw = dueDate + 'T' + task.dueEndTime.replace(':', '') + '00';
    } else {
      // Default to 1h slot if no end given
      const [sh, sm] = task.dueTime.split(':').map(Number);
      const eh = String(Math.min(23, sh + 1)).padStart(2, '0');
      endRaw = dueDate + 'T' + eh + String(sm).padStart(2, '0') + '00';
    }
    dtStartLine = 'DTSTART:' + startRaw;
    dtEndLine = 'DTEND:' + endRaw;
  } else {
    const endDate = new Date(new Date(task.dueDate).getTime() + 86400000)
      .toISOString()
      .replace(/[-:]/g, '')
      .split('T')[0];
    dtStartLine = 'DTSTART;VALUE=DATE:' + dueDate;
    dtEndLine = 'DTEND;VALUE=DATE:' + endDate;
  }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meisterpilze Lab Tracker//EN',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + now,
    // I-15: SEQUENCE — bumped by db.updateTaskById on meaningful edits.
    'SEQUENCE:' + (Number(task.sequence) || 0),
    dtStartLine,
    dtEndLine,
    'SUMMARY:' + escapeIcsText(task.text || ''),
    'CATEGORIES:Aufgaben',
    'STATUS:' + (task.done ? 'CANCELLED' : 'CONFIRMED'),
    'TRANSP:TRANSPARENT',
    'X-MEISTERPILZE-TYPE:task-due',
    'COLOR:#3b82f6'
  ];
  // I-15: emit RRULE for recurring tasks rendered as VEVENT.
  const rruleLine = buildRRuleLine(task.recurrence, task.recurrenceUntil);
  if (rruleLine) lines.push(rruleLine);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return { uid, ics: foldIcsLines(lines.join('\r\n')) };
}

// Convert a custom calendar event to VEVENT .ics content
function customEventToVEVENT(event) {
  const uid = event.caldavUid || 'cev-' + event.id + '@meisterpilze';
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  let dtstart, dtend;
  if (event.allDay || !event.startTime) {
    const d = new Date(event.startDate).toISOString().replace(/[-:]/g, '').split('T')[0];
    dtstart = 'DTSTART;VALUE=DATE:' + d;
    const endD = event.endDate
      ? new Date(new Date(event.endDate).getTime() + 86400000).toISOString().replace(/[-:]/g, '').split('T')[0]
      : new Date(new Date(event.startDate).getTime() + 86400000).toISOString().replace(/[-:]/g, '').split('T')[0];
    dtend = 'DTEND;VALUE=DATE:' + endD;
  } else {
    const d = event.startDate.replace(/-/g, '');
    // Use endDate for the DTEND day so a timed event spanning multiple days
    // isn't collapsed to its start day (which also produced DTEND < DTSTART when
    // endTime < startTime). Falls back to startDate for same-day events.
    const dEnd = (event.endDate || event.startDate).replace(/-/g, '');
    const st = (event.startTime || '09:00').replace(':', '') + '00';
    const et = (event.endTime || '10:00').replace(':', '') + '00';
    dtstart = 'DTSTART;TZID=Europe/Berlin:' + d + 'T' + st;
    dtend = 'DTEND;TZID=Europe/Berlin:' + dEnd + 'T' + et;
  }
  const needsTZ = dtstart.includes('TZID=');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Meisterpilze Lab Tracker//EN'];
  if (needsTZ) {
    lines.push(
      'BEGIN:VTIMEZONE',
      'TZID:Europe/Berlin',
      'BEGIN:STANDARD',
      'DTSTART:19701025T030000',
      'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0100',
      'TZNAME:CET',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700329T020000',
      'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0200',
      'TZNAME:CEST',
      'END:DAYLIGHT',
      'END:VTIMEZONE'
    );
  }
  lines.push(
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + now,
    // I-15: SEQUENCE counter (RFC 5545 §3.8.7.4) — bumped by db.updateCalendarEvent.
    'SEQUENCE:' + (Number(event.sequence) || 0),
    dtstart,
    dtend,
    'SUMMARY:' + escapeIcsText(event.title || ''),
    'CATEGORIES:' + (event.category || 'Benutzerdefiniert'),
    'TRANSP:TRANSPARENT',
    'X-MEISTERPILZE-TYPE:custom-event'
  );
  // I-15: emit RRULE when the event is recurring.
  const rruleLine = buildRRuleLine(event.recurrence, event.recurrenceUntil);
  if (rruleLine) lines.push(rruleLine);
  // I-15: emit EXDATE for per-occurrence cancellations. Format must match
  // DTSTART (date-only vs datetime). exceptionDates may arrive as a JSON
  // string (from older code paths) or as a parsed array.
  let exDates = event.exceptionDates;
  if (typeof exDates === 'string') {
    try {
      exDates = JSON.parse(exDates);
    } catch {
      exDates = exDates
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  const exdateLine = buildExdateLine(
    exDates,
    event.allDay || !event.startTime,
    event.startTime || '00:00',
    'Europe/Berlin'
  );
  if (exdateLine) lines.push(exdateLine);
  if (event.description) lines.push('DESCRIPTION:' + escapeIcsText(event.description));
  if (event.assignees && event.assignees.length) {
    for (const a of event.assignees) lines.push('ATTENDEE;CN=' + (a.username || a) + ':mailto:noreply@localhost');
  }
  lines.push('COLOR:' + (event.color || CALDAV_CATEGORY_COLORS[event.category] || '#16a34a'));
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return { uid, ics: foldIcsLines(lines.join('\r\n')) };
}

// Delete a task's .ics file
function deleteTaskFromCalendar(uid, calName) {
  calName = calName || 'meisterpilze';
  deleteIcsFile(calName, uid + '.ics');
}

// ── Auto CalDAV sync helpers ───────────────────────────────
// Push a batch due-date VEVENT to CalDAV (server-side, called after mutations)
function autoPushBatchCaldav(batch) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    if (!batch || !batch.due) return;
    const data = readData();
    const { uid, ics } = batchToVEVENT(batch, data.scanLog || []);
    writeIcsFile('faelligkeiten', uid + '.ics', ics);
    // Clean from old meisterpilze location
    deleteIcsFile('meisterpilze', uid + '.ics');
  } catch (e) {
    log('error', 'autoPushBatchCaldav failed', { error: e.message });
  }
}

// Remove a batch's CalDAV .ics file
function autoDeleteBatchCaldav(batchId) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    const uid = 'batch-' + batchId + '@meisterpilze';
    for (const cal of ['faelligkeiten', 'meisterpilze']) deleteIcsFile(cal, uid + '.ics');
  } catch (e) {
    log('error', 'autoDeleteBatchCaldav failed', { error: e.message });
  }
}

// Push a task's VTODO + due-date VEVENT to CalDAV
function autoPushTaskCaldav(task) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    const isPrivate = task.private === 1 || task.private === true;
    // Shared calendar: all non-private tasks
    if (!isPrivate) {
      writeTaskToCalendar(task, 'meisterpilze');
    }
    // Per-person calendar: if assigned
    if (task.assignee) {
      const slug = task.assignee.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      writeTaskToCalendar(task, slug);
    }
    // Due-date VEVENT → aufgaben calendar: respect privacy
    if (task.dueDate && !isPrivate) {
      const { uid, ics } = taskDueToVEVENT(task);
      writeIcsFile('aufgaben', uid + '.ics', ics);
      deleteIcsFile('meisterpilze', uid + '.ics');
    }
  } catch (e) {
    log('error', 'autoPushTaskCaldav failed', { error: e.message });
  }
}

// Remove a task's CalDAV files (VTODO + VEVENT) from all calendars
// Pass task object (with caldavUid/assignee) BEFORE deleting from DB
function autoDeleteTaskCaldav(task) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    if (!task || !task.caldavUid) return;
    // Remove from shared calendar
    deleteTaskFromCalendar(task.caldavUid, 'meisterpilze');
    // Remove from personal calendar if assigned
    if (task.assignee) {
      const slug = task.assignee.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      deleteTaskFromCalendar(task.caldavUid, slug);
    }
    // Also remove VEVENT for due date (check aufgaben + legacy meisterpilze)
    for (const cal of ['aufgaben', 'meisterpilze']) deleteIcsFile(cal, task.caldavUid + '-event.ics');
  } catch (e) {
    log('error', 'autoDeleteTaskCaldav failed', { error: e.message });
  }
}

// Push a custom calendar event to CalDAV
function autoSyncCalendarEvent(ev) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    if (!ev.startDate && !ev.start_date) return;
    const normalized = {
      id: ev.id,
      title: ev.title,
      startDate: ev.startDate || ev.start_date,
      endDate: ev.endDate || ev.end_date,
      allDay: ev.allDay != null ? ev.allDay : ev.all_day,
      startTime: ev.startTime || ev.start_time,
      endTime: ev.endTime || ev.end_time,
      category: ev.category,
      description: ev.description,
      caldavUid: ev.caldavUid || ev.caldav_uid
    };
    const aMap = db.getAllCalendarEventAssignees(database);
    normalized.assignees = aMap.get(ev.id) || [];
    const calSlug = CALDAV_EVENT_CATEGORY_MAP[normalized.category] || 'eigene-termine';
    const { uid, ics } = customEventToVEVENT(normalized);
    writeIcsFile(calSlug, uid + '.ics', ics);
    // Clean from other category calendars in case category changed
    for (const other of ['eigene-termine', 'meetings', 'lieferungen', 'wartung', 'meisterpilze']) {
      if (other !== calSlug) deleteIcsFile(other, uid + '.ics');
    }
  } catch (e) {
    log('error', 'autoSyncCalendarEvent failed', { error: e.message });
  }
}

// Resolve a list of usernames to user IDs. Unknown names are dropped silently.
// Note: the users table column is `id`, not `user_id` (sessions/authUser use
// `user_id` because they JOIN through sessions).
function resolveUsernamesToIds(names) {
  if (!Array.isArray(names) || !names.length) return [];
  const ids = [];
  for (const name of names) {
    if (!name || typeof name !== 'string') continue;
    const u = db.getUserByUsernameCaseInsensitive(database, name.trim());
    if (u && typeof u.id === 'number' && !ids.includes(u.id)) ids.push(u.id);
  }
  return ids;
}

// Single source of truth: given a calendar-event request body, return the
// user IDs that should be written to calendar_event_assignees. Prefer explicit
// `assignees` (already-resolved IDs); fall back to deriving them from
// `teamAssignees` names. Returns null if neither field is present so callers
// can distinguish "not provided" from "empty array".
function deriveEffectiveAssignees(data) {
  if (Array.isArray(data.assignees)) return data.assignees;
  if (Array.isArray(data.teamAssignees)) return resolveUsernamesToIds(data.teamAssignees);
  return null;
}

// Best-effort notifications when a task gains new assignees. Notifies the
// actor too — self-assignments still produce an inbox entry.
function notifyTaskAssignees(task, userIds, actor) {
  if (!Array.isArray(userIds) || !userIds.length) return;
  const actorName = (actor && actor.username) || 'Jemand';
  const title = task.text || 'Aufgabe';
  const dateStr = task.dueDate || task.due_date || '';
  const body = actorName + (dateStr ? ' · ' + dateStr : '');
  for (const uid of userIds) {
    if (typeof uid !== 'number') continue;
    try {
      db.createNotification(database, {
        userId: uid,
        type: 'task_assignment',
        title,
        body,
        linkType: 'task',
        linkId: String(task.id)
      });
    } catch (e) {
      log('warn', 'notifyTaskAssignees failed', { userId: uid, taskId: task.id, error: e.message });
    }
  }
}

// Parse a task.assignee CSV ("Alice,Bob") into an array of trimmed names.
function parseTaskAssigneeCsv(s) {
  if (!s || typeof s !== 'string') return [];
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

// Create notification rows for each assignee who was added to a calendar event.
// Best-effort: failures are logged but do not block the primary request.
function notifyCalendarAssignees(ev, assigneeIds, actor) {
  if (!Array.isArray(assigneeIds) || !assigneeIds.length) return;
  const actorName = (actor && actor.username) || 'Jemand';
  const title = ev.title || 'Termin';
  // Body: creator + date range for quick context in the dropdown
  const dateStr = ev.startDate || ev.start_date || '';
  const body = actorName + (dateStr ? ' · ' + dateStr : '');
  for (const uid of assigneeIds) {
    if (typeof uid !== 'number') continue;
    try {
      db.createNotification(database, {
        userId: uid,
        type: 'calendar_assignment',
        title,
        body,
        linkType: 'calendar_event',
        linkId: ev.id
      });
    } catch (e) {
      log('warn', 'notifyCalendarAssignees failed', { userId: uid, eventId: ev.id, error: e.message });
    }
  }
}

// Remove a custom calendar event's CalDAV file (search all category calendars)
function autoDeleteCalendarEventCaldav(eventId, caldavUid) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    const uid = caldavUid || 'cev-' + eventId + '@meisterpilze';
    for (const cal of ['eigene-termine', 'meetings', 'lieferungen', 'wartung', 'meisterpilze']) {
      deleteIcsFile(cal, uid + '.ics');
    }
  } catch (e) {
    log('error', 'autoDeleteCalendarEventCaldav failed', { error: e.message });
  }
}

// CalDAV sync mutex — serializes sync operations to prevent concurrent file writes.
// Uses a queue with setImmediate to avoid re-entrant calls from the finally block.
let caldavSyncRunning = false;
let caldavSyncQueued = null;

function autoSyncAllCaldav(data) {
  if (caldavSyncRunning) {
    caldavSyncQueued = data; // queue latest, discard stale
    return;
  }
  caldavSyncRunning = true;
  try {
    _doAutoSyncAllCaldav(data);
  } catch (e) {
    log('error', 'CalDAV auto-sync failed', { error: e.message });
  } finally {
    const queued = caldavSyncQueued;
    caldavSyncQueued = null;
    caldavSyncRunning = false;
    // Defer queued sync to next tick to prevent re-entrant race
    if (queued) setImmediate(() => autoSyncAllCaldav(queued));
  }
}
function _doAutoSyncAllCaldav(data) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    const scanLog = data.scanLog || [];

    // Ensure all category calendars exist
    for (const calSlug of Object.keys(CALDAV_CATEGORY_CALS)) ensureCalDir(calSlug);

    // Track written UIDs per calendar for orphan cleanup
    const writtenPerCal = {};
    for (const calSlug of Object.keys(CALDAV_CATEGORY_CALS)) writtenPerCal[calSlug] = new Set();

    // Batch due dates → faelligkeiten calendar
    for (const b of data.batches || []) {
      if (!b.due) continue;
      try {
        const { uid, ics } = batchToVEVENT(b, scanLog);
        writeIcsFile('faelligkeiten', uid + '.ics', ics);
        writtenPerCal['faelligkeiten'].add(uid + '.ics');
      } catch (e) {
        log('warn', 'CalDAV: failed to write batch event', { batchId: b.batchId, error: e.message });
      }
    }
    // Track written UIDs per personal calendar for orphan cleanup
    const personalWrittenUids = new Map(); // calSlug → Set<filename>
    // Task VTODOs → meisterpilze + personal calendars
    for (const t of data.manualTasks || []) {
      try {
        const isPriv = t.private === 1 || t.private === true;
        if (!isPriv) {
          writeTaskToCalendar(t, 'meisterpilze');
        }
        if (t.assignee) {
          const slug = t.assignee.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          writeTaskToCalendar(t, slug);
          if (t.caldavUid) {
            if (!personalWrittenUids.has(slug)) personalWrittenUids.set(slug, new Set());
            personalWrittenUids.get(slug).add(t.caldavUid + '.ics');
          }
        }
      } catch (e) {
        log('warn', 'CalDAV: failed to write task VTODO', { taskText: t.text?.slice(0, 50), error: e.message });
      }
    }
    // Task due dates → aufgaben calendar (respect privacy)
    for (const t of data.manualTasks || []) {
      if (!t.dueDate) continue;
      const isPrivate = t.private === 1 || t.private === true;
      if (isPrivate) continue;
      try {
        const { uid, ics } = taskDueToVEVENT(t);
        writeIcsFile('aufgaben', uid + '.ics', ics);
        writtenPerCal['aufgaben'].add(uid + '.ics');
      } catch (e) {
        log('warn', 'CalDAV: failed to write task due event', { taskText: t.text?.slice(0, 50), error: e.message });
      }
    }
    // Custom events → category-specific calendars
    for (const ev of data.calendarEvents || []) {
      const calSlug = CALDAV_EVENT_CATEGORY_MAP[ev.category] || 'eigene-termine';
      try {
        const { uid, ics } = customEventToVEVENT(ev);
        writeIcsFile(calSlug, uid + '.ics', ics);
        if (writtenPerCal[calSlug]) writtenPerCal[calSlug].add(uid + '.ics');
      } catch (e) {
        log('warn', 'CalDAV: failed to write calendar event', { eventId: ev.id, error: e.message });
      }
    }
    // Clean orphaned meisterpilze-generated files in all category calendars
    for (const calSlug of Object.keys(CALDAV_CATEGORY_CALS)) {
      const dir = path.join(CAL_DIR, calSlug);
      if (!fs.existsSync(dir)) continue;
      const written = writtenPerCal[calSlug] || new Set();
      try {
        const existing = fs.readdirSync(dir).filter((f) => f.endsWith('.ics'));
        for (const f of existing) {
          const filePath = path.join(dir, f);
          const head = readFileHead(filePath, 500);
          if (head.includes('X-MEISTERPILZE-TYPE') && !written.has(f)) {
            fs.unlinkSync(filePath);
            invalidateCtag(calSlug);
            recordChange(calSlug, f, 'deleted');
          }
        }
      } catch (e) {
        log('warn', 'CalDAV: failed to clean orphaned files', { calendar: calSlug, error: e.message });
      }
    }
    // Clean old events from meisterpilze that were moved to category calendars
    try {
      const sharedDir = path.join(CAL_DIR, 'meisterpilze');
      if (fs.existsSync(sharedDir)) {
        for (const f of fs.readdirSync(sharedDir).filter((f) => f.endsWith('.ics'))) {
          const head = readFileHead(path.join(sharedDir, f), 500);
          if (
            head.includes('X-MEISTERPILZE-TYPE:batch-due') ||
            head.includes('X-MEISTERPILZE-TYPE:task-due') ||
            head.includes('X-MEISTERPILZE-TYPE:custom-event')
          ) {
            fs.unlinkSync(path.join(sharedDir, f));
            invalidateCtag('meisterpilze');
            recordChange('meisterpilze', f, 'deleted');
          }
        }
      }
    } catch (e) {
      log('warn', 'CalDAV: failed to clean migrated events from meisterpilze', { error: e.message });
    }
    // Clean orphaned VTODOs in personal calendars
    const categoryCals = new Set(Object.keys(CALDAV_CATEGORY_CALS));
    categoryCals.add('meisterpilze');
    try {
      const allCals = listCalendars();
      for (const cal of allCals) {
        if (categoryCals.has(cal)) continue; // already handled above
        const calDir = path.join(CAL_DIR, cal);
        const written = personalWrittenUids.get(cal) || new Set();
        const files = fs.readdirSync(calDir).filter((f) => f.endsWith('.ics'));
        for (const f of files) {
          if (written.has(f)) continue;
          const head = readFileHead(path.join(calDir, f), 500);
          if (head.includes('PRODID:-//Meisterpilze')) {
            fs.unlinkSync(path.join(calDir, f));
            invalidateCtag(cal);
            recordChange(cal, f, 'deleted');
          }
        }
      }
    } catch (e) {
      log('warn', 'CalDAV: failed to clean orphaned personal files', { error: e.message });
    }
  } catch (e) {
    log('error', 'autoSyncAllCaldav failed', { error: e.message });
  }
}

// Full sync: write all tasks to calendar directories
function syncAllTasksLocal(data) {
  const tasks = data.manualTasks || [];
  const results = { pushed: 0, errors: 0, calendarsCreated: 0 };
  const scanLog = data.scanLog || [];

  // Ensure all category calendars + user calendars exist
  for (const calSlug of Object.keys(CALDAV_CATEGORY_CALS)) ensureCalDir(calSlug);
  const users = db.listUsers(database);
  for (const u of users) {
    const slug = u.username.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    ensureCalDir(slug);
  }

  // Track written UIDs per calendar
  const writtenPerCal = {};
  for (const calSlug of Object.keys(CALDAV_CATEGORY_CALS)) writtenPerCal[calSlug] = new Set();

  // Write each task as VTODO
  for (const task of tasks) {
    try {
      const isPrivate = task.private === 1 || task.private === true;
      if (!isPrivate) writeTaskToCalendar(task, 'meisterpilze');
      if (task.assignee) {
        const slug = task.assignee.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        writeTaskToCalendar(task, slug);
      }
      results.pushed++;
    } catch (e) {
      results.errors++;
    }
  }

  // Batch due dates → faelligkeiten calendar
  const batches = data.batches || [];
  for (const b of batches) {
    if (!b.due) continue;
    try {
      const { uid, ics } = batchToVEVENT(b, scanLog);
      writeIcsFile('faelligkeiten', uid + '.ics', ics);
      writtenPerCal['faelligkeiten'].add(uid + '.ics');
      results.pushed++;
    } catch (e) {
      results.errors++;
    }
  }

  // Task due dates → aufgaben calendar (respect privacy)
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const isPrivate = task.private === 1 || task.private === true;
    if (isPrivate) continue;
    try {
      const { uid, ics } = taskDueToVEVENT(task);
      writeIcsFile('aufgaben', uid + '.ics', ics);
      writtenPerCal['aufgaben'].add(uid + '.ics');
      results.pushed++;
    } catch (e) {
      results.errors++;
    }
  }

  // Custom calendar events → category-specific calendars
  const customEvents = data.calendarEvents || [];
  for (const ev of customEvents) {
    const calSlug = CALDAV_EVENT_CATEGORY_MAP[ev.category] || 'eigene-termine';
    try {
      const { uid, ics } = customEventToVEVENT(ev);
      writeIcsFile(calSlug, uid + '.ics', ics);
      if (writtenPerCal[calSlug]) writtenPerCal[calSlug].add(uid + '.ics');
      results.pushed++;
    } catch (e) {
      results.errors++;
    }
  }

  // Clean up orphaned .ics files in all category calendars
  for (const calSlug of Object.keys(CALDAV_CATEGORY_CALS)) {
    const dir = path.join(CAL_DIR, calSlug);
    if (!fs.existsSync(dir)) continue;
    const written = writtenPerCal[calSlug] || new Set();
    try {
      const existing = fs.readdirSync(dir).filter((f) => f.endsWith('.ics'));
      for (const f of existing) {
        const head = readFileHead(path.join(dir, f), 500);
        if (head.includes('X-MEISTERPILZE-TYPE') && !written.has(f)) {
          fs.unlinkSync(path.join(dir, f));
          invalidateCtag(calSlug);
          recordChange(calSlug, f, 'deleted');
        }
      }
    } catch (e) {
      /* ignore cleanup errors */
    }
  }
  // Clean old events from meisterpilze that were moved to category calendars
  try {
    const sharedDir = path.join(CAL_DIR, 'meisterpilze');
    if (fs.existsSync(sharedDir)) {
      for (const f of fs.readdirSync(sharedDir).filter((f) => f.endsWith('.ics'))) {
        const head = readFileHead(path.join(sharedDir, f), 500);
        if (
          head.includes('X-MEISTERPILZE-TYPE:batch-due') ||
          head.includes('X-MEISTERPILZE-TYPE:task-due') ||
          head.includes('X-MEISTERPILZE-TYPE:custom-event')
        ) {
          fs.unlinkSync(path.join(sharedDir, f));
          invalidateCtag('meisterpilze');
          recordChange('meisterpilze', f, 'deleted');
        }
      }
    }
  } catch (e) {
    /* ignore cleanup errors */
  }

  return results;
}

// ── CalDAV HTTP handler ─────────────────────────────────────
// Handles requests under /caldav/
function handleCaldav(req, res) {
  // Reject requests if CalDAV is not enabled in config
  const caldavCfg = db.readCaldavConfig(database);
  if (!caldavCfg.enabled) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('CalDAV is not enabled');
    return;
  }

  // DAV headers for all CalDAV responses (no CORS — CalDAV clients don't need it)
  res.setHeader('DAV', '1, 2, 3, calendar-access, extended-mkcol');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR, OPTIONS, PROPPATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Depth, Authorization, If-Match, If-None-Match');

  // Reject Basic auth over plain HTTP (except localhost) to prevent credential sniffing
  if (!req.socket.encrypted) {
    const host = (req.headers.host || '').replace(/:.*$/, '');
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
      res.writeHead(403);
      res.end('CalDAV requires HTTPS');
      return;
    }
  }

  // Brute-force protection for CalDAV basic auth
  const caldavIP = getClientIP(req);
  const caldavUsername = extractBasicAuthUsername(req);
  if (caldavUsername) {
    const caldavUserKey = caldavUsername.toLowerCase();
    const caldavThrottleKey = caldavUserKey + '@' + caldavIP;
    if (!checkLoginAllowed(caldavThrottleKey) || !checkLoginAllowedPerUser(caldavUserKey)) {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Too many login attempts. Try again later.');
      return;
    }
  }

  // Auth check — returns user account object or false
  const caldavUser = checkCaldavAuth(req);
  if (!caldavUser) {
    if (caldavUsername) {
      const caldavUserKey = caldavUsername.toLowerCase();
      recordLoginFailure(caldavUserKey + '@' + caldavIP);
      recordLoginFailurePerUser(caldavUserKey);
    }
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Meisterpilze CalDAV", charset="UTF-8"' });
    res.end('Unauthorized');
    return;
  }
  // Clear attempts on successful auth
  const successKey = caldavUser.username.toLowerCase();
  clearLoginAttempts(successKey + '@' + caldavIP);
  clearLoginAttemptsPerUser(successKey);
  req.caldavUser = caldavUser;
  req.caldavUserSlug = caldavUser.username.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const method = req.method;
  // Normalize path: /caldav/calendars/calname/file.ics
  let rawPath;
  try {
    rawPath = decodeURIComponent(req.url.split('?')[0]).replace(/\/+/g, '/');
  } catch (e) {
    res.writeHead(400);
    res.end('Bad Request: malformed URL encoding');
    return;
  }
  const parts = rawPath
    .replace(/^\/caldav\/?/, '')
    .replace(/\/$/, '')
    .split('/')
    .filter(Boolean);
  // parts: [] = root, ['calendars'] = calendar-home, ['calendars','name'] = calendar, ['calendars','name','file.ics'] = item

  // Validate root path segment
  if (parts.length > 0 && parts[0] !== 'calendars' && parts[0] !== 'principal') {
    res.writeHead(400);
    res.end('Invalid path');
    return;
  }

  // Sanitize path parts to prevent directory traversal
  for (let i = 1; i < parts.length; i++) {
    const clean = sanitizePart(parts[i]);
    if (!clean) {
      res.writeHead(400);
      res.end('Invalid path');
      return;
    }
    parts[i] = clean;
  }

  if (method === 'OPTIONS') {
    res.writeHead(200, {
      Allow: 'OPTIONS, GET, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR, PROPPATCH'
    });
    res.end();
    return;
  }

  // Collect request body
  let body = '';
  let bodySize = 0;
  req.on('data', (c) => {
    bodySize += c.length;
    if (bodySize > MAX_BODY_SIZE) {
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('Request body too large');
      req.destroy();
      return;
    }
    body += c;
  });
  req.on('end', () => {
    try {
      if (method === 'PROPFIND') return handlePropfind(parts, body, req, res);
      if (method === 'REPORT') {
        // R-09: handleReport is now async — surface async rejections to the
        // same error path and avoid an unhandledRejection on disk failures.
        return Promise.resolve(handleReport(parts, body, req, res)).catch((e) => {
          log('error', 'CalDAV request error', { error: e.message });
          if (!res.writableEnded) {
            res.writeHead(500);
            res.end('Internal server error');
          }
        });
      }
      if (method === 'MKCALENDAR') return handleMkcalendar(parts, body, req, res);
      if (method === 'PUT') return handlePut(parts, body, req, res);
      if (method === 'GET') return handleGet(parts, req, res);
      if (method === 'DELETE') return handleDelete(parts, req, res);
      if (method === 'PROPPATCH') return handleProppatch(parts, body, req, res);
      res.writeHead(405);
      res.end('Method not allowed');
    } catch (e) {
      log('error', 'CalDAV request error', { error: e.message });
      res.writeHead(500);
      res.end('Internal server error');
    }
  });
}

function handlePropfind(parts, body, req, res) {
  const depth = req.headers['depth'] || '1';

  // Root /caldav/ — principal discovery
  if (parts.length === 0) {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:response>
    <d:href>/caldav/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:current-user-principal><d:href>/caldav/principal/</d:href></d:current-user-principal>
        <d:displayname>Meisterpilze</d:displayname>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xml);
    return;
  }

  // /caldav/principal/ — user principal resource (returns calendar-home-set)
  if (parts.length === 1 && parts[0] === 'principal') {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:response>
    <d:href>/caldav/principal/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><d:principal/></d:resourcetype>
        <d:current-user-principal><d:href>/caldav/principal/</d:href></d:current-user-principal>
        <d:principal-URL><d:href>/caldav/principal/</d:href></d:principal-URL>
        <c:calendar-home-set><d:href>/caldav/calendars/</d:href></c:calendar-home-set>
        <d:displayname>${escapeXml(req.caldavUser.username)}</d:displayname>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xml);
    return;
  }

  // /caldav/calendars/ — list all calendars
  if (parts.length === 1 && parts[0] === 'calendars') {
    const cals = listCalendars().filter((c) => checkCalendarAccess(req, c));
    let responses = `<d:response>
    <d:href>/caldav/calendars/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:displayname>Calendars</d:displayname>
        <d:current-user-principal><d:href>/caldav/principal/</d:href></d:current-user-principal>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;

    if (depth !== '0') {
      for (const cal of cals) {
        const { displayName, color } = getCalDisplayInfo(cal);
        const colorProp = color
          ? '\n        <x:calendar-color xmlns:x="http://apple.com/ns/ical/">' + color + '</x:calendar-color>'
          : '';
        responses += `\n  <d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(cal)}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>${escapeXml(displayName)}</d:displayname>
        <c:supported-calendar-component-set><c:comp name="VTODO"/><c:comp name="VEVENT"/></c:supported-calendar-component-set>${colorProp}
        <cs:getctag>${computeCtag(cal)}</cs:getctag>
        <d:sync-token>http://meisterpilze/sync/${getSyncToken(cal)}</d:sync-token>
        ${SUPPORTED_REPORT_SET}
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;
      }
    }

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  ${responses}
</d:multistatus>`;
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xml);
    return;
  }

  // /caldav/calendars/<cal>/ — list items in a calendar
  if (parts.length === 2 && parts[0] === 'calendars') {
    const calName = parts[1];
    if (!checkCalendarAccess(req, calName)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const calDir = path.join(CAL_DIR, calName);
    if (!fs.existsSync(calDir)) {
      res.writeHead(404);
      res.end('Calendar not found');
      return;
    }
    const { displayName, color } = getCalDisplayInfo(calName);
    const colorProp2 = color
      ? '\n        <x:calendar-color xmlns:x="http://apple.com/ns/ical/">' + color + '</x:calendar-color>'
      : '';
    let responses = `<d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(calName)}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>${escapeXml(displayName)}</d:displayname>
        <c:supported-calendar-component-set><c:comp name="VTODO"/><c:comp name="VEVENT"/></c:supported-calendar-component-set>${colorProp2}
        <cs:getctag>${computeCtag(calName)}</cs:getctag>
        <d:sync-token>http://meisterpilze/sync/${getSyncToken(calName)}</d:sync-token>
        ${SUPPORTED_REPORT_SET}
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;

    if (depth !== '0') {
      const files = listIcsFiles(calName);
      for (const f of files) {
        const etag = getEtag(calName, f);
        if (!etag) continue;
        let fileSize = 0;
        try {
          fileSize = fs.statSync(path.join(CAL_DIR, calName, f)).size;
        } catch {}
        responses += `\n  <d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(calName)}/${encodeURIComponent(f)}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>${etag}</d:getetag>
        <d:getcontenttype>text/calendar; charset=utf-8</d:getcontenttype>
        <d:getcontentlength>${fileSize}</d:getcontentlength>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;
      }
    }

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  ${responses}
</d:multistatus>`;
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xml);
    return;
  }

  // /caldav/calendars/<cal>/<file>.ics — single item props
  if (parts.length === 3 && parts[0] === 'calendars' && parts[2].endsWith('.ics')) {
    if (!checkCalendarAccess(req, parts[1])) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const filePath = path.join(CAL_DIR, parts[1], parts[2]);
    const etag = getEtag(parts[1], parts[2]);
    if (!etag) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    let fileSize = 0;
    try {
      fileSize = fs.statSync(filePath).size;
    } catch {}
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>${etag}</d:getetag>
        <d:getcontenttype>text/calendar; charset=utf-8</d:getcontenttype>
        <d:getcontentlength>${fileSize}</d:getcontentlength>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xml);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

async function handleReport(parts, body, req, res) {
  // calendar-multiget: client requests specific .ics files with their data
  if (parts.length === 2 && parts[0] === 'calendars') {
    const calName = parts[1];
    if (!checkCalendarAccess(req, calName)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const calDir = path.join(CAL_DIR, calName);
    if (!fs.existsSync(calDir)) {
      res.writeHead(404);
      res.end('Calendar not found');
      return;
    }

    // ── RFC 6578 sync-collection REPORT ──
    if (body.includes('sync-collection')) {
      const tokenMatch = body.match(/<d:sync-token>([^<]*)<\/d:sync-token>/i);
      const tokenStr = tokenMatch ? tokenMatch[1].trim() : '';
      const reqToken = parseInt((tokenStr.match(/\/sync\/(\d+)$/) || [])[1] || '0', 10);

      // Validate token — if stale or unknown, tell client to do full sync (RFC 6578 §3)
      const currentToken = getSyncToken(calName);
      const clog = changeLog.get(calName);
      if (reqToken > 0) {
        const invalid = !clog || (clog.size > 0 && reqToken < Math.min(...[...clog.values()].map((e) => e.token)));
        if (invalid) {
          const errXml = `<?xml version="1.0" encoding="utf-8"?>
<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>`;
          res.writeHead(403, { 'Content-Type': 'application/xml; charset=utf-8' });
          res.end(errXml);
          return;
        }
      }

      let responses = '';
      if (reqToken === 0) {
        // Initial sync — return all items
        const files = listIcsFiles(calName);
        for (const f of files) {
          const etag = getEtag(calName, f);
          if (!etag) continue;
          responses += `\n  <d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(calName)}/${encodeURIComponent(f)}</d:href>
    <d:propstat>
      <d:prop><d:getetag>${etag}</d:getetag></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;
        }
      } else {
        // Incremental sync — only items changed since reqToken
        for (const [fileName, entry] of clog.entries()) {
          if (entry.token <= reqToken) continue;
          if (entry.action === 'deleted') {
            responses += `\n  <d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(calName)}/${encodeURIComponent(fileName)}</d:href>
    <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:response>`;
          } else {
            const etag = getEtag(calName, fileName);
            if (etag) {
              responses += `\n  <d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(calName)}/${encodeURIComponent(fileName)}</d:href>
    <d:propstat>
      <d:prop><d:getetag>${etag}</d:getetag></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;
            }
          }
        }
      }

      const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:sync-token>http://meisterpilze/sync/${currentToken}</d:sync-token>${responses}
</d:multistatus>`;
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(xml);
      return;
    }

    // Parse requested hrefs from the XML body — handle any namespace prefix (d:href, D:href, href, etc.)
    const hrefMatches = body.match(/<(?:[a-zA-Z0-9]+:)?href(?:\s[^>]*)?>([^<]+)<\/(?:[a-zA-Z0-9]+:)?href>/gi) || [];
    let responses = '';

    // If calendar-multiget with specific hrefs
    if (hrefMatches.length > 0) {
      // R-09: parallelize disk reads. Build the work list first, then read
      // all files concurrently with Promise.all so a 100-item REPORT runs at
      // the speed of one read instead of N.
      const targets = [];
      for (const hrefTag of hrefMatches) {
        const href = hrefTag.replace(/<\/?(?:[a-zA-Z0-9]+:)?href(?:\s[^>]*)?>/gi, '');
        const filename = sanitizePart(decodeURIComponent(href.split('/').pop()));
        if (!filename) continue;
        const filePath = path.join(calDir, filename);
        if (fs.existsSync(filePath) && filename.endsWith('.ics')) {
          targets.push({ href, filename, filePath });
        }
      }
      const reads = await Promise.all(targets.map((t) => fs.promises.readFile(t.filePath, 'utf8').catch(() => null)));
      for (let i = 0; i < targets.length; i++) {
        const content = reads[i];
        if (content == null) continue; // file vanished between exists() and read()
        const t = targets[i];
        const etag = getEtag(calName, t.filename);
        responses += `\n  <d:response>
    <d:href>${escapeXml(t.href)}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>${etag}</d:getetag>
        <c:calendar-data>${escapeXml(content)}</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;
      }
    } else {
      // calendar-query: return all items
      const files = listIcsFiles(calName);
      const reads = await Promise.all(
        files.map((f) => fs.promises.readFile(path.join(calDir, f), 'utf8').catch(() => null))
      );
      for (let i = 0; i < files.length; i++) {
        const content = reads[i];
        if (content == null) continue;
        const f = files[i];
        const etag = getEtag(calName, f);
        responses += `\n  <d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(calName)}/${encodeURIComponent(f)}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>${etag}</d:getetag>
        <c:calendar-data>${escapeXml(content)}</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;
      }
    }

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  ${responses}
</d:multistatus>`;
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xml);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

function handleMkcalendar(parts, body, req, res) {
  if (req.caldavUser.role !== 'admin') {
    res.writeHead(403);
    res.end('Forbidden: only admins can create calendars');
    return;
  }
  if (parts.length === 2 && parts[0] === 'calendars') {
    const calName = parts[1];
    // Block UUID-like calendar names (auto-created by CalDAV clients like iOS)
    const stripped = calName.replace(/-/g, '');
    if (/^[0-9a-f]{32}$/i.test(stripped)) {
      log('info', 'CalDAV: blocked MKCALENDAR for UUID-like name', { name: calName, actor: req.caldavUser.username });
      res.writeHead(201); // Return 201 to avoid client retries
      res.end();
      return;
    }
    if (!checkCalendarAccess(req, calName)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    ensureCalDir(calName);
    res.writeHead(201);
    res.end();
    log('info', 'CalDAV calendar created', { name: calName, actor: req.caldavUser.username });
    return;
  }
  res.writeHead(403);
  res.end('Forbidden');
}

function handlePut(parts, body, req, res) {
  // PUT /caldav/calendars/<cal>/<uid>.ics
  if (parts.length === 3 && parts[0] === 'calendars' && parts[2].endsWith('.ics')) {
    const calName = parts[1];
    if (!checkCalendarAccess(req, calName)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const fileName = parts[2];
    const dir = ensureCalDir(calName);
    const filePath = path.join(dir, fileName);
    const existed = fs.existsSync(filePath);

    // If-None-Match: * means "create only, fail if exists"
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === '*' && existed) {
      res.writeHead(412);
      res.end('Precondition Failed');
      return;
    }

    // If-Match: check etag matches current version (conflict detection)
    const ifMatch = req.headers['if-match'];
    if (ifMatch && existed) {
      const stat = fs.statSync(filePath);
      const currentEtag = '"' + stat.mtimeMs.toString(36) + '"';
      if (ifMatch !== currentEtag) {
        res.writeHead(412);
        res.end('Precondition Failed');
        return;
      }
    }

    fs.writeFileSync(filePath, body, 'utf8');
    invalidateCtag(calName);
    recordChange(calName, fileName, 'changed');

    // Bidirectional sync: parse incoming content and update DB
    const unfolded = unfoldIcs(body);

    // ── VTODO sync-back: task text, priority, completion, due date ──
    if (unfolded.includes('VTODO')) {
      try {
        const uidMatch = unfolded.match(/UID:(.*)/);
        if (uidMatch) {
          const uid = uidMatch[1].trim();
          if (/^[A-Za-z0-9\-_.@]+$/.test(uid)) {
            const task = db.readTaskByCaldavUid(database, uid);
            if (task) {
              const fields = {};
              const sumMatch = unfolded.match(/SUMMARY:(.*)/);
              if (sumMatch) {
                const t = sumMatch[1].trim().replace(/\\n/g, '\n');
                if (t !== task.text) fields.text = t;
              }
              const prioMatch = unfolded.match(/PRIORITY:(\d+)/);
              if (prioMatch) {
                const p = CALDAV_PRIO_MAP[prioMatch[1]] || 'med';
                if (p !== task.priority) fields.priority = p;
              }
              const statusMatch = unfolded.match(/STATUS:(.*)/);
              if (statusMatch) {
                const done = statusMatch[1].trim() === 'COMPLETED';
                if (done !== task.done) fields.done = done;
              }
              const dueDateTimeMatch = unfolded.match(/DUE(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/);
              const dueMatch = unfolded.match(/DUE;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
              if (dueDateTimeMatch) {
                const d = dueDateTimeMatch[1] + '-' + dueDateTimeMatch[2] + '-' + dueDateTimeMatch[3];
                const t = dueDateTimeMatch[4] + ':' + dueDateTimeMatch[5];
                if (d !== (task.dueDate || '').slice(0, 10)) fields.dueDate = d;
                if (t !== (task.dueTime || '')) fields.dueTime = t;
              } else if (dueMatch) {
                const d = dueMatch[1] + '-' + dueMatch[2] + '-' + dueMatch[3];
                if (d !== (task.dueDate || '').slice(0, 10)) fields.dueDate = d;
                if (task.dueTime) {
                  fields.dueTime = null;
                  fields.dueEndTime = null;
                }
              } else if (!unfolded.includes('DUE') && task.dueDate) {
                fields.dueDate = null;
                if (task.dueTime) {
                  fields.dueTime = null;
                  fields.dueEndTime = null;
                }
              }
              const descMatch = unfolded.match(/DESCRIPTION:(.*)/);
              if (descMatch) {
                const d = descMatch[1].trim().replace(/\\n/g, '\n');
                if (d !== (task.description || '')) fields.description = d;
              }
              const assigneeMatch = unfolded.match(/X-MEISTERPILZE-ASSIGNEE:(.*)/);
              if (assigneeMatch) {
                const a = assigneeMatch[1].trim();
                if (a !== (task.assignee || '')) fields.assignee = a;
              }

              if (Object.keys(fields).length > 0) {
                db.updateTaskById(database, task.id, fields);
                // Re-read and push to all calendars for consistency
                const updated = db.readTaskById(database, task.id);
                if (updated) autoPushTaskCaldav(updated);
                broadcastSSE();
              }
            } else {
              // New task created from external CalDAV client
              const sumMatch = unfolded.match(/SUMMARY:(.*)/);
              const text = sumMatch ? sumMatch[1].trim().replace(/\\n/g, '\n') : '(kein Titel)';
              const prioMatch = unfolded.match(/PRIORITY:(\d+)/);
              const priority = prioMatch ? CALDAV_PRIO_MAP[prioMatch[1]] || 'med' : 'med';
              const statusMatch = unfolded.match(/STATUS:(.*)/);
              const done = statusMatch ? statusMatch[1].trim() === 'COMPLETED' : false;
              const dueDateTimeMatch2 = unfolded.match(/DUE(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/);
              const dueMatch = unfolded.match(/DUE;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
              let dueDate = null;
              let dueTime = null;
              if (dueDateTimeMatch2) {
                dueDate = dueDateTimeMatch2[1] + '-' + dueDateTimeMatch2[2] + '-' + dueDateTimeMatch2[3];
                dueTime = dueDateTimeMatch2[4] + ':' + dueDateTimeMatch2[5];
              } else if (dueMatch) {
                dueDate = dueMatch[1] + '-' + dueMatch[2] + '-' + dueMatch[3];
              }
              const descMatch = unfolded.match(/DESCRIPTION:(.*)/);
              const description = descMatch ? descMatch[1].trim().replace(/\\n/g, '\n') : null;
              db.insertTask(database, {
                text,
                priority,
                done,
                created: new Date().toISOString(),
                dueDate,
                dueTime,
                description,
                caldavUid: uid,
                caldavSynced: new Date().toISOString()
              });
              broadcastSSE();
            }
          }
        }
      } catch (e) {
        log('error', 'CalDAV VTODO bidirectional sync error', { error: e.message });
      }
    }

    // ── VEVENT sync-back: batch due dates, task due dates, custom events ──
    if (unfolded.includes('VEVENT')) {
      try {
        const veventBlock = extractVeventBlock(unfolded);
        const typeMatch = veventBlock.match(/X-MEISTERPILZE-TYPE:(.*)/);
        const evType = typeMatch ? typeMatch[1].trim() : null;

        if (evType === 'batch-due' || evType === 'task-due') {
          const dtMatch = veventBlock.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
          if (dtMatch) {
            const newDate = dtMatch[1] + '-' + dtMatch[2] + '-' + dtMatch[3];
            if (evType === 'batch-due') {
              const batchMatch = veventBlock.match(/X-MEISTERPILZE-BATCH:(.*)/);
              if (batchMatch) {
                const batchId = batchMatch[1].trim();
                if (/^[A-Za-z0-9\-_.]+$/.test(batchId)) {
                  db.updateBatchDue(database, batchId, newDate + 'T12:00:00.000Z');
                  broadcastSSE();
                } else {
                  log('warn', 'CalDAV PUT rejected invalid batchId', { batchId });
                }
              }
            } else {
              const uidMatch = veventBlock.match(/UID:(.*)/);
              if (uidMatch) {
                const taskUid = uidMatch[1].trim().replace(/-event$/, '');
                if (/^[A-Za-z0-9\-_.@]+$/.test(taskUid)) {
                  db.updateTaskDueDate(database, taskUid, newDate);
                  broadcastSSE();
                } else {
                  log('warn', 'CalDAV PUT rejected invalid taskUid', { taskUid });
                }
              }
            }
          }
        } else if (evType === 'custom-event') {
          // Custom event edited from external CalDAV client
          const uidMatch = veventBlock.match(/UID:(.*)/);
          if (uidMatch) {
            const uid = uidMatch[1].trim();
            const idMatch = uid.match(/^cev-(.+)@meisterpilze$/);
            if (idMatch) {
              const fields = {};
              const sumMatch = veventBlock.match(/SUMMARY:(.*)/);
              if (sumMatch) fields.title = sumMatch[1].trim().replace(/\\n/g, '\n');
              const descMatch = veventBlock.match(/DESCRIPTION:(.*)/);
              if (descMatch) fields.description = descMatch[1].trim().replace(/\\n/g, '\n');
              const catMatch = veventBlock.match(/CATEGORIES:(.*)/);
              if (catMatch) {
                const cat = catMatch[1].trim().toLowerCase();
                if (KNOWN_CATEGORIES[cat]) fields.category = cat;
              }
              // Parse DTSTART from VEVENT block only (avoids VTIMEZONE false matches)
              const dtAllDay = veventBlock.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
              const dtTimed = veventBlock.match(/DTSTART(?:;TZID=[^:]+)?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
              if (dtAllDay) {
                fields.startDate = dtAllDay[1] + '-' + dtAllDay[2] + '-' + dtAllDay[3];
                fields.allDay = true;
                fields.startTime = null;
              } else if (dtTimed) {
                fields.startDate = dtTimed[1] + '-' + dtTimed[2] + '-' + dtTimed[3];
                fields.startTime = dtTimed[4] + ':' + dtTimed[5];
                fields.allDay = false;
              }
              // Parse DTEND from VEVENT block only
              const deAllDay = veventBlock.match(/DTEND;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
              const deTimed = veventBlock.match(/DTEND(?:;TZID=[^:]+)?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
              if (deAllDay) {
                // RFC 5545: DTEND for all-day is exclusive, subtract one day
                const d = new Date(deAllDay[1] + '-' + deAllDay[2] + '-' + deAllDay[3]);
                d.setDate(d.getDate() - 1);
                fields.endDate = d.toISOString().split('T')[0];
                fields.endTime = null;
              } else if (deTimed) {
                fields.endDate = deTimed[1] + '-' + deTimed[2] + '-' + deTimed[3];
                fields.endTime = deTimed[4] + ':' + deTimed[5];
              }
              if (Object.keys(fields).length > 0) {
                db.updateCalendarEvent(database, idMatch[1], fields);
                broadcastSSE();
              }
            }
          }
        } else if (!evType && calName === 'meisterpilze') {
          // New VEVENT from external CalDAV client — create as calendar event
          const uidMatch = veventBlock.match(/UID:(.*)/);
          if (uidMatch) {
            const uid = uidMatch[1].trim();
            // Check it doesn't already exist in DB
            const existing = db.readCalendarEventByCaldavUid(database, uid);
            if (!existing) {
              const sumMatch = veventBlock.match(/SUMMARY:(.*)/);
              const title = sumMatch ? sumMatch[1].trim().replace(/\\n/g, '\n') : '(kein Titel)';
              const descMatch = veventBlock.match(/DESCRIPTION:(.*)/);
              const description = descMatch ? descMatch[1].trim().replace(/\\n/g, '\n') : null;
              const catMatch = veventBlock.match(/CATEGORIES:(.*)/);
              let category = 'custom';
              if (catMatch) {
                const c = catMatch[1].trim().toLowerCase();
                if (KNOWN_CATEGORIES[c]) category = c;
              }

              let startDate = null,
                endDate = null,
                startTime = null,
                endTime = null,
                allDay = true;
              const dtAllDay = veventBlock.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
              const dtTimed = veventBlock.match(/DTSTART(?:;TZID=[^:]+)?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
              if (dtAllDay) {
                startDate = dtAllDay[1] + '-' + dtAllDay[2] + '-' + dtAllDay[3];
              } else if (dtTimed) {
                startDate = dtTimed[1] + '-' + dtTimed[2] + '-' + dtTimed[3];
                startTime = dtTimed[4] + ':' + dtTimed[5];
                allDay = false;
              }
              if (!startDate) startDate = new Date().toISOString().split('T')[0];

              const deAllDay = veventBlock.match(/DTEND;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
              const deTimed = veventBlock.match(/DTEND(?:;TZID=[^:]+)?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
              if (deAllDay) {
                const d = new Date(deAllDay[1] + '-' + deAllDay[2] + '-' + deAllDay[3]);
                d.setDate(d.getDate() - 1);
                endDate = d.toISOString().split('T')[0];
              } else if (deTimed) {
                endDate = deTimed[1] + '-' + deTimed[2] + '-' + deTimed[3];
                endTime = deTimed[4] + ':' + deTimed[5];
              }

              const eventId = 'cev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
              const caldavUid = uid;
              db.insertCalendarEvent(
                database,
                {
                  id: eventId,
                  title,
                  description,
                  startDate,
                  endDate,
                  allDay,
                  startTime,
                  endTime,
                  category,
                  caldavUid,
                  caldavSynced: new Date().toISOString()
                },
                null
              );
              // Re-write .ics with X-MEISTERPILZE-TYPE marker so future syncs recognize it
              const ev = db.readCalendarEventByCaldavUid(database, caldavUid);
              if (ev) {
                ev.assignees = [];
                const { ics } = customEventToVEVENT(ev);
                fs.writeFileSync(filePath, ics, 'utf8');
                invalidateCtag(calName);
                recordChange(calName, fileName, 'changed');
              }
              broadcastSSE();
            }
          }
        }
      } catch (e) {
        log('error', 'CalDAV VEVENT bidirectional sync error', { error: e.message });
      }
    }

    const stat = fs.statSync(filePath);
    const etag = '"' + stat.mtimeMs.toString(36) + '"';
    res.writeHead(existed ? 204 : 201, { ETag: etag });
    res.end();
    return;
  }
  res.writeHead(403);
  res.end('Forbidden');
}

function handleGet(parts, req, res) {
  // GET /caldav/calendars/<cal>/<uid>.ics
  if (parts.length === 3 && parts[0] === 'calendars' && parts[2].endsWith('.ics')) {
    if (!checkCalendarAccess(req, parts[1])) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const filePath = path.join(CAL_DIR, parts[1], parts[2]);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const etag = getEtag(parts[1], parts[2]);
    res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      ETag: etag
    });
    res.end(content);
    return;
  }

  // GET on a calendar collection — return empty (clients use PROPFIND/REPORT)
  if (parts.length <= 2) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Meisterpilze CalDAV Server');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

function handleDelete(parts, req, res) {
  // DELETE /caldav/calendars/<cal>/<uid>.ics
  if (parts.length === 3 && parts[0] === 'calendars' && parts[2].endsWith('.ics')) {
    const calName = parts[1];
    const fileName = parts[2];
    if (!checkCalendarAccess(req, calName)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    // Only allow deleting from own calendar or shared calendar if admin
    const userSlug = req.caldavUserSlug;
    if (calName !== userSlug && calName !== 'meisterpilze' && req.caldavUser.role !== 'admin') {
      res.writeHead(403);
      res.end("Forbidden: cannot delete from other users' calendars");
      return;
    }
    if (calName === 'meisterpilze' && req.caldavUser.role !== 'admin') {
      res.writeHead(403);
      res.end('Forbidden: only admins can delete from shared calendar');
      return;
    }
    const filePath = path.join(CAL_DIR, calName, fileName);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // Read content before deleting to sync back to DB
    let content = '';
    try {
      content = unfoldIcs(fs.readFileSync(filePath, 'utf8'));
    } catch {}

    const typeMatch = content.match(/X-MEISTERPILZE-TYPE:(.*)/);
    const evType = typeMatch ? typeMatch[1].trim() : null;

    if (evType === 'batch-due') {
      // Batch due dates are mandatory — ignore delete, autoSync will recreate the file
    } else if (evType === 'task-due') {
      // Clear task due date (don't delete the task)
      const uidMatch = content.match(/UID:(.*)/);
      if (uidMatch) {
        const taskUid = uidMatch[1].trim().replace(/-event$/, '');
        if (/^[A-Za-z0-9\-_.@]+$/.test(taskUid)) {
          try {
            db.updateTaskDueDate(database, taskUid, null);
            broadcastSSE();
          } catch (e) {
            log('warn', 'CalDAV DELETE task-due sync failed', { taskUid, error: e.message });
          }
        }
      }
    } else if (evType === 'custom-event') {
      // Delete custom calendar event from DB
      const uidMatch = content.match(/UID:(.*)/);
      if (uidMatch) {
        const uid = uidMatch[1].trim();
        const idMatch = uid.match(/^cev-(.+)@meisterpilze$/);
        if (idMatch) {
          try {
            db.deleteCalendarEvent(database, idMatch[1]);
            broadcastSSE();
          } catch (e) {
            log('warn', 'CalDAV DELETE custom-event sync failed', { uid, error: e.message });
          }
        }
      }
    } else if (!evType && content.includes('VTODO')) {
      // Task VTODO — delete the task from DB
      const uidMatch = content.match(/UID:(.*)/);
      if (uidMatch) {
        const uid = uidMatch[1].trim();
        const task = db.readTaskByCaldavUid(database, uid);
        if (task) {
          try {
            db.deleteTaskById(database, task.id);
            // Clean up companion due-date VEVENT (check aufgaben + legacy meisterpilze)
            for (const cal of ['aufgaben', 'meisterpilze']) deleteIcsFile(cal, uid + '-event.ics');
            // Clean up mirror in shared/personal calendar
            if (calName !== 'meisterpilze') {
              deleteIcsFile('meisterpilze', uid + '.ics');
            }
            if (task.assignee) {
              const slug = task.assignee.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              if (calName !== slug) {
                deleteIcsFile(slug, uid + '.ics');
              }
            }
            broadcastSSE();
          } catch (e) {
            log('warn', 'CalDAV DELETE VTODO sync failed', { uid, error: e.message });
          }
        }
      }
    }
    // External events (no X-MEISTERPILZE-TYPE, no VTODO) — just delete file

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      invalidateCtag(calName);
      recordChange(calName, fileName, 'deleted');
    }
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(403);
  res.end('Forbidden');
}

function handleProppatch(parts, body, req, res) {
  // Minimal PROPPATCH support — just acknowledge
  const href = '/caldav/' + parts.join('/') + (parts.length > 0 ? '/' : '');
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${escapeXml(href)}</d:href>
    <d:propstat>
      <d:prop/>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
  res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(xml);
}

// ══════════════════════════════════════════════════════════════
// ── HTTP SERVER ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

// ── RATE LIMITING ────────────────────────────────────────────
const RATE_WINDOW_MS = 60000;
const RATE_MAX_REQUESTS = 300;
const httpRateLimits = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = httpRateLimits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    entry = { start: now, count: 0 };
    httpRateLimits.set(ip, entry);
  }
  entry.count++;
  return entry.count <= RATE_MAX_REQUESTS;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of httpRateLimits) {
    if (now - entry.start > RATE_WINDOW_MS) httpRateLimits.delete(ip);
  }
}, RATE_WINDOW_MS);

// ── LOGIN BRUTE-FORCE PROTECTION ────────────────────────────
const LOGIN_MAX_ATTEMPTS = 5; // per username+IP
const LOGIN_MAX_PER_USER = 20; // per username across all IPs
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const loginAttempts = new Map(); // username@IP → { count, firstAttempt, lockedUntil }
const loginAttemptsPerUser = new Map(); // username → { count, firstAttempt, lockedUntil }

function checkLoginAllowed(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return true;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return false;
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    loginAttempts.delete(key);
    return true;
  }
  return true;
}

function checkLoginAllowedPerUser(username) {
  const entry = loginAttemptsPerUser.get(username);
  if (!entry) return true;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return false;
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    loginAttemptsPerUser.delete(username);
    return true;
  }
  return true;
}

function recordLoginFailure(key) {
  const now = Date.now();
  let entry = loginAttempts.get(key);
  if (!entry) {
    entry = { count: 0, firstAttempt: now, lockedUntil: null };
    loginAttempts.set(key, entry);
  }
  entry.count++;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
    log('warn', 'Login locked due to too many failed attempts', { key, attempts: entry.count });
  }
}

function recordLoginFailurePerUser(username) {
  const now = Date.now();
  let entry = loginAttemptsPerUser.get(username);
  if (!entry) {
    entry = { count: 0, firstAttempt: now, lockedUntil: null };
    loginAttemptsPerUser.set(username, entry);
  }
  entry.count++;
  if (entry.count >= LOGIN_MAX_PER_USER) {
    entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
    log('warn', 'Login locked (per-user) due to too many failed attempts', { username, attempts: entry.count });
  }
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}
function clearLoginAttemptsPerUser(username) {
  loginAttemptsPerUser.delete(username);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts) {
    if (entry.lockedUntil && now >= entry.lockedUntil) loginAttempts.delete(key);
    else if (now - entry.firstAttempt > LOGIN_LOCKOUT_MS) loginAttempts.delete(key);
  }
  for (const [key, entry] of loginAttemptsPerUser) {
    if (entry.lockedUntil && now >= entry.lockedUntil) loginAttemptsPerUser.delete(key);
    else if (now - entry.firstAttempt > LOGIN_LOCKOUT_MS) loginAttemptsPerUser.delete(key);
  }
}, 60000);

// R-18: opt-in access logging. Default OFF — logs are noisy and we already
// have structured logs for everything that matters. Operators flip
// LOG_ACCESS=true when they need a request trail (incident response,
// debugging a misbehaving client). Skips SSE long-pollers and unauth health
// probes so we don't drown the log file.
const LOG_ACCESS = process.env.LOG_ACCESS === 'true' || process.env.LOG_ACCESS === '1';
function handleRequest(req, res) {
  const clientIP = getClientIP(req);
  if (!checkRateLimit(clientIP)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end('{"error":"Too many requests"}');
    return;
  }

  // R-18: optional access logging — wires up at request entry so we capture
  // the round-trip even when downstream code throws before res.end().
  if (LOG_ACCESS) {
    const reqStart = Date.now();
    res.once('finish', () => {
      try {
        const url = req.url || '';
        // Skip SSE long-polls (would log once per 30 min connection close)
        // and skip unauth /api/health probes (every prober hits this every
        // few seconds).
        if (url.startsWith('/api/events')) return;
        const isAuthed = !!req.authUser;
        if (url === '/api/health' && !isAuthed) return;
        log('info', 'http', {
          method: req.method,
          url,
          status: res.statusCode,
          ms: Date.now() - reqStart,
          user: req.authUser ? req.authUser.username : null,
          ip: clientIP
        });
      } catch (_) {
        /* never let access logging break a response */
      }
    });
  }

  // ── Security headers ──
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; report-uri /api/csp-reports"
  );
  if (protocol === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions-Policy: explicitly drop powerful APIs the app doesn't use.
  // camera=(self) is required for the html5-qrcode scanner; fullscreen=(self)
  // is left open for any future scanner-fullscreen UI. Everything else is
  // off — closes attack-surface that a future XSS could otherwise pivot
  // into (e.g. exfiltrating geolocation, capturing the microphone).
  res.setHeader(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), midi=(), autoplay=(), fullscreen=(self)'
  );

  // ── Well-known CalDAV discovery (RFC 6764) ──
  // Use 308 (Permanent Redirect) instead of 301 so that iOS/CalDAV clients
  // preserve the PROPFIND method across the redirect (301 allows changing to GET).
  if (req.url.startsWith('/.well-known/caldav')) {
    res.writeHead(308, { Location: '/caldav/' });
    res.end();
    return;
  }

  // ── CalDAV requests ──
  if (req.url.startsWith('/caldav')) {
    return handleCaldav(req, res);
  }

  // ── OAuth 2.0 well-known endpoints (public, no auth) ──
  // CORS preflight for well-known endpoints (MCP clients send MCP-Protocol-Version header)
  if (req.method === 'OPTIONS' && req.url.startsWith('/.well-known/oauth-')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Protocol-Version');
    res.writeHead(204);
    res.end();
    return;
  }
  // RFC 9728: serve protected resource metadata at both path-aware and root URLs
  const MCP_SCOPE = 'mcp:full';
  if (
    req.method === 'GET' &&
    (req.url === '/.well-known/oauth-protected-resource/mcp' || req.url === '/.well-known/oauth-protected-resource')
  ) {
    const base = getBaseUrl(req);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Protocol-Version');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        resource: base + '/mcp',
        authorization_servers: [base],
        bearer_methods_supported: ['header'],
        scopes_supported: [MCP_SCOPE]
      })
    );
    return;
  }
  if (req.method === 'GET' && req.url === '/.well-known/oauth-authorization-server') {
    const base = getBaseUrl(req);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Protocol-Version');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        issuer: base,
        authorization_endpoint: base + '/oauth/authorize',
        token_endpoint: base + '/oauth/token',
        registration_endpoint: base + '/oauth/register',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [MCP_SCOPE]
      })
    );
    return;
  }

  // ── OAuth 2.0 endpoints (before auth gate) ──
  if (req.url.startsWith('/oauth/')) {
    // CORS for token + register endpoints
    if (req.url === '/oauth/token' || req.url === '/oauth/register') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // Dynamic Client Registration (RFC 7591) — required by MCP OAuth spec
    if (req.method === 'POST' && req.url === '/oauth/register') {
      if (!checkOAuthRate(req)) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end('{"error":"too_many_requests"}');
        return;
      }
      jsonBody(req, res, (e, data) => {
        if (e) return;
        try {
          const redirectUris = data.redirect_uris;
          if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end('{"error":"invalid_client_metadata","error_description":"redirect_uris required"}');
            return;
          }
          // Validate redirect URIs. RFC 8252 (OAuth 2.0 for Native Apps):
          // public clients must use https:// or loopback http://. Plain http
          // to a public host would let an attacker register a phishing
          // redirect — PKCE alone does not prevent that since the attacker
          // *is* the registered client. Accept exactly:
          //   - https://...   (any host)
          //   - http://127.0.0.1[:port][/...]
          //   - http://[::1][:port][/...]
          //   - http://localhost[:port][/...]   (dev convenience)
          for (const uri of redirectUris) {
            let u;
            try {
              u = new URL(uri);
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end('{"error":"invalid_client_metadata","error_description":"invalid redirect_uri"}');
              return;
            }
            const isHttps = u.protocol === 'https:';
            const isLoopbackHttp =
              u.protocol === 'http:' &&
              (u.hostname === '127.0.0.1' ||
                u.hostname === '[::1]' ||
                u.hostname === '::1' ||
                u.hostname === 'localhost');
            if (!isHttps && !isLoopbackHttp) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                '{"error":"invalid_client_metadata","error_description":"redirect_uri must be https:// or http://(127.0.0.1|[::1]|localhost) per RFC 8252"}'
              );
              return;
            }
            if (u.hash) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                '{"error":"invalid_client_metadata","error_description":"redirect_uri must not contain a fragment"}'
              );
              return;
            }
          }
          const clientId = crypto.randomUUID();
          const clientName = typeof data.client_name === 'string' ? data.client_name : '';
          db.registerOAuthClient(database, { clientId, clientName, redirectUris });
          log('info', 'OAuth client registered via DCR', { clientId, clientName });
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              client_id: clientId,
              client_name: clientName,
              redirect_uris: redirectUris,
              grant_types: data.grant_types || ['authorization_code', 'refresh_token'],
              response_types: data.response_types || ['code'],
              token_endpoint_auth_method: 'none'
            })
          );
        } catch (err) {
          safeErr(res, err);
        }
      });
      return;
    }

    // Token endpoint — public
    if (req.method === 'POST' && req.url === '/oauth/token') {
      if (!checkOAuthRate(req)) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end('{"error":"too_many_requests"}');
        return;
      }
      const ct = (req.headers['content-type'] || '').split(';')[0].trim();
      const parser = ct === 'application/json' ? jsonBody : formBody;
      parser(req, res, (e, data) => {
        if (e) return;
        try {
          // Validate client_secret if client has one
          const tokenClient = db.getOAuthClient(database, data.client_id);
          if (!tokenClient) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end('{"error":"invalid_client"}');
            return;
          }
          if (tokenClient.hasSecret) {
            if (!data.client_secret) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end('{"error":"invalid_client","error_description":"client_secret required"}');
              return;
            }
            if (!db.verifyOAuthClientSecret(database, data.client_id, data.client_secret)) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end('{"error":"invalid_client"}');
              return;
            }
          }

          if (data.grant_type === 'authorization_code') {
            if (!data.code || !data.code_verifier || !data.client_id || !data.redirect_uri) {
              return jsonErr(res, 400, 'missing required parameters');
            }
            const codeHash = crypto.createHash('sha256').update(data.code).digest('hex');
            const codeRow = db.getOAuthCode(database, codeHash);
            if (!codeRow) {
              log('warn', 'OAuth token failed: invalid code', { clientId: data.client_id });
              return jsonErr(res, 400, 'invalid_grant');
            }
            if (codeRow.clientId !== data.client_id) {
              log('warn', 'OAuth token failed: client mismatch', { clientId: data.client_id });
              return jsonErr(res, 400, 'invalid_grant');
            }
            if (codeRow.redirectUri !== data.redirect_uri) {
              log('warn', 'OAuth token failed: redirect mismatch', { clientId: data.client_id });
              return jsonErr(res, 400, 'invalid_grant');
            }
            if (!verifyPkce(data.code_verifier, codeRow.codeChallenge)) {
              log('warn', 'OAuth token failed: PKCE mismatch', { clientId: data.client_id });
              return jsonErr(res, 400, 'invalid_grant');
            }
            // RFC 8707: validate resource indicator if both sides provided one
            if (data.resource && codeRow.resource && data.resource !== codeRow.resource) {
              log('warn', 'OAuth token failed: resource mismatch', {
                clientId: data.client_id,
                expected: codeRow.resource,
                got: data.resource
              });
              return jsonErr(res, 400, 'invalid_grant');
            }

            const accessToken = crypto.randomBytes(32).toString('hex');
            const refreshToken = crypto.randomBytes(32).toString('hex');
            const accessHash = crypto.createHash('sha256').update(accessToken).digest('hex');
            const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

            // I-08: atomic exchange — burn the auth code and issue both tokens in one txn
            // so a failed INSERT can't leave the code unusable while the access/refresh
            // tokens are missing (or vice versa).
            database.exec('BEGIN');
            try {
              db.markOAuthCodeUsed(database, codeHash);
              db.createOAuthToken(database, {
                token: accessHash,
                tokenType: 'access',
                clientId: data.client_id,
                userId: codeRow.userId,
                expiresInSeconds: 3600,
                refreshTokenRef: refreshHash
              });
              db.createOAuthToken(database, {
                token: refreshHash,
                tokenType: 'refresh',
                clientId: data.client_id,
                userId: codeRow.userId,
                expiresInSeconds: 30 * 24 * 3600
              });
              database.exec('COMMIT');
            } catch (txErr) {
              database.exec('ROLLBACK');
              throw txErr;
            }

            log('info', 'OAuth token issued', { clientId: data.client_id });
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(
              JSON.stringify({
                access_token: accessToken,
                token_type: 'bearer',
                expires_in: 3600,
                refresh_token: refreshToken
              })
            );
          } else if (data.grant_type === 'refresh_token') {
            if (!data.refresh_token || !data.client_id) return jsonErr(res, 400, 'missing required parameters');
            const refreshHash = crypto.createHash('sha256').update(data.refresh_token).digest('hex');
            const refreshRow = db.getOAuthRefreshToken(database, refreshHash);
            if (!refreshRow) return jsonErr(res, 400, 'invalid_grant');
            if (refreshRow.clientId !== data.client_id) return jsonErr(res, 400, 'invalid_grant');

            const newAccessToken = crypto.randomBytes(32).toString('hex');
            const newRefreshToken = crypto.randomBytes(32).toString('hex');
            const newAccessHash = crypto.createHash('sha256').update(newAccessToken).digest('hex');
            const newRefreshHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

            // I-08: atomic rotation — revoke previous pair and issue new pair in one txn
            // so a failed INSERT can't leave the user without working tokens.
            database.exec('BEGIN');
            try {
              db.revokeOAuthTokensByRefresh(database, refreshHash);
              db.createOAuthToken(database, {
                token: newAccessHash,
                tokenType: 'access',
                clientId: data.client_id,
                userId: refreshRow.userId,
                expiresInSeconds: 3600,
                refreshTokenRef: newRefreshHash
              });
              db.createOAuthToken(database, {
                token: newRefreshHash,
                tokenType: 'refresh',
                clientId: data.client_id,
                userId: refreshRow.userId,
                expiresInSeconds: 30 * 24 * 3600
              });
              database.exec('COMMIT');
            } catch (txErr) {
              database.exec('ROLLBACK');
              throw txErr;
            }

            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(
              JSON.stringify({
                access_token: newAccessToken,
                token_type: 'bearer',
                expires_in: 3600,
                refresh_token: newRefreshToken
              })
            );
          } else {
            jsonErr(res, 400, 'unsupported_grant_type');
          }
        } catch (err) {
          safeErr(res, err);
        }
      });
      return;
    }

    // Authorization endpoint — requires session cookie
    if (req.url.startsWith('/oauth/authorize')) {
      const parsedUrl = new URL(req.url, 'http://localhost');
      if (req.method === 'GET') {
        const authUser = checkAuth(req);
        if (!authUser) {
          res.writeHead(302, { Location: '/login.html?redirect=' + encodeURIComponent(req.url) });
          res.end();
          return;
        }
        const clientId = parsedUrl.searchParams.get('client_id') || '';
        const redirectUri = parsedUrl.searchParams.get('redirect_uri') || '';
        const state = parsedUrl.searchParams.get('state') || '';
        const codeChallenge = parsedUrl.searchParams.get('code_challenge') || '';
        const codeChallengeMethod = parsedUrl.searchParams.get('code_challenge_method') || '';
        const responseType = parsedUrl.searchParams.get('response_type') || '';
        const resource = parsedUrl.searchParams.get('resource') || '';

        if (responseType !== 'code') {
          jsonErr(res, 400, 'unsupported_response_type');
          return;
        }
        if (codeChallengeMethod !== 'S256') {
          jsonErr(res, 400, 'invalid code_challenge_method');
          return;
        }
        if (!codeChallenge) {
          jsonErr(res, 400, 'code_challenge required');
          return;
        }

        const client = db.getOAuthClient(database, clientId);
        if (!client) {
          jsonErr(res, 400, 'invalid client_id');
          return;
        }
        if (!client.redirectUris.includes(redirectUri)) {
          jsonErr(res, 400, 'invalid redirect_uri');
          return;
        }

        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const clientName = client.clientName || clientId;
        log('info', 'OAuth consent shown', { clientId, clientName, user: authUser.username });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize – Meistertracker</title><link rel="icon" href="/favicon.ico">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;font-size:15px;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:36px;width:100%;max-width:420px;margin:16px;box-shadow:0 4px 6px -1px rgba(0,0,0,.07)}
.logo{text-align:center;margin-bottom:8px;color:#16a34a}
h1{font-size:20px;font-weight:700;margin-bottom:4px;text-align:center}
.sub{color:#64748b;font-size:14px;text-align:center;margin-bottom:24px}
.client{font-weight:600;color:#1e293b}
.perms{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin-bottom:24px;font-size:13px;color:#166534}
.perms li{margin:4px 0;list-style:disc inside}
.btns{display:flex;gap:12px}
.btn{flex:1;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .15s}
.btn-allow{background:#16a34a;color:#fff}.btn-allow:hover{background:#15803d}
.btn-deny{background:#e2e8f0;color:#475569}.btn-deny:hover{background:#cbd5e1}
</style></head><body>
<div class="card">
  <div class="logo"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="5"/><path d="M12 13v5M8 21h8M9 3c0 0-2-2-2-3M15 3c0 0 2-2 2-3"/></svg></div>
  <h1>Authorize Access</h1>
  <p class="sub"><span class="client">${esc(clientName)}</span> wants to access<br>Meistertracker</p>
  <ul class="perms">
    <li>Read batches, tasks, calendar, inventory</li>
    <li>Create and update batches, tasks, events</li>
    <li>Log harvests and bag movements</li>
  </ul>
  <form method="POST" action="/oauth/authorize">
    <input type="hidden" name="client_id" value="${esc(clientId)}">
    <input type="hidden" name="redirect_uri" value="${esc(redirectUri)}">
    <input type="hidden" name="state" value="${esc(state)}">
    <input type="hidden" name="code_challenge" value="${esc(codeChallenge)}">
    <input type="hidden" name="code_challenge_method" value="${esc(codeChallengeMethod)}">
    <input type="hidden" name="response_type" value="code">
    <input type="hidden" name="resource" value="${esc(resource)}">
    <div class="btns">
      <button type="submit" name="action" value="deny" class="btn btn-deny">Deny</button>
      <button type="submit" name="action" value="allow" class="btn btn-allow">Allow</button>
    </div>
  </form>
</div></body></html>`);
        return;
      }

      if (req.method === 'POST') {
        const authUser = checkAuth(req);
        if (!authUser) {
          jsonErr(res, 401, 'unauthorized');
          return;
        }
        formBody(req, res, (e, data) => {
          if (e) return;
          try {
            const redirectUri = data.redirect_uri || '';
            const state = data.state || '';
            const clientId = data.client_id || '';

            // Validate client and redirect_uri BEFORE any redirect (prevents open redirect)
            const client = db.getOAuthClient(database, clientId);
            if (!client || !client.redirectUris.includes(redirectUri)) {
              jsonErr(res, 400, 'invalid client or redirect_uri');
              return;
            }

            if (data.action === 'deny') {
              const sep = redirectUri.includes('?') ? '&' : '?';
              res.writeHead(302, {
                Location:
                  redirectUri + sep + 'error=access_denied' + (state ? '&state=' + encodeURIComponent(state) : '')
              });
              res.end();
              return;
            }

            log('info', 'OAuth authorization granted', { clientId, user: authUser.username });
            const code = crypto.randomBytes(32).toString('hex');
            const codeHash = crypto.createHash('sha256').update(code).digest('hex');
            db.createOAuthCode(database, {
              code: codeHash,
              clientId,
              userId: authUser.user_id,
              redirectUri,
              codeChallenge: data.code_challenge || '',
              codeChallengeMethod: data.code_challenge_method || 'S256',
              resource: data.resource || ''
            });

            const sep = redirectUri.includes('?') ? '&' : '?';
            res.writeHead(302, {
              Location:
                redirectUri +
                sep +
                'code=' +
                encodeURIComponent(code) +
                (state ? '&state=' + encodeURIComponent(state) : '')
            });
            res.end();
          } catch (err) {
            log('error', 'OAuth authorize POST failed', { error: err.message });
            safeErr(res, err);
          }
        });
        return;
      }
    }

    // Unknown /oauth/ endpoint
    jsonErr(res, 404, 'not found');
    return;
  }

  // ── MCP endpoint (own CORS + bearer auth, before cookie auth gate) ──
  if (req.url === '/mcp' || req.url.startsWith('/mcp?')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const mcpCfg = db.getMcpCfg(database);
    if (!mcpCfg.enabled) {
      res.writeHead(404);
      res.end();
      return;
    }
    const mcpAuth = checkMcpAuth(req);
    if (!mcpAuth) {
      const base = getBaseUrl(req);
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate':
          'Bearer resource_metadata="' + base + '/.well-known/oauth-protected-resource/mcp", scope="mcp:full"'
      });
      res.end('{"error":"unauthorized"}');
      return;
    }
    if (!checkMcpRate(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      res.end('{"error":"rate limit exceeded"}');
      return;
    }
    const sessionId = req.headers['mcp-session-id'];
    if (req.method === 'POST') {
      jsonBody(req, res, async (e, body) => {
        if (e) return;
        try {
          let session = sessionId ? mcpSessions.get(sessionId) : null;
          if (!session) {
            // S-01: pass the caller's auth context (userId, role) into
            // the MCP server so destructive tools can require admin role.
            const server = createMcpServer(database, () => broadcastSSE(null), {
              printZPL,
              checkPrinterAvailable,
              auth: mcpAuth
            });
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => crypto.randomUUID(),
              onsessioninitialized: (sid) => {
                mcpSessions.set(sid, { transport, server, lastActive: Date.now() });
              }
            });
            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid) mcpSessions.delete(sid);
              server.close().catch(() => {});
            };
            await server.connect(transport);
            session = { transport, server, lastActive: Date.now() };
          } else {
            session.lastActive = Date.now();
          }
          await session.transport.handleRequest(req, res, body);
        } catch (err) {
          // Without this, a rejection from server.connect()/handleRequest()
          // becomes an unhandledRejection and the client never gets a response.
          log('error', 'MCP request handling failed', { error: err && err.message });
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end('{"error":"internal error"}');
          } else {
            res.destroy();
          }
        }
      });
      return;
    }
    if (req.method === 'GET') {
      const session = sessionId ? mcpSessions.get(sessionId) : null;
      if (!session) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"no session"}');
        return;
      }
      session.lastActive = Date.now();
      session.transport.handleRequest(req, res);
      return;
    }
    if (req.method === 'DELETE') {
      const session = sessionId ? mcpSessions.get(sessionId) : null;
      if (!session) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"no session"}');
        return;
      }
      session.transport.handleRequest(req, res);
      return;
    }
    res.writeHead(405);
    res.end();
    return;
  }

  // CORS — only allow same-origin requests (no cross-origin API access)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  // ── Auth endpoints (public) ───────────────────────────────
  if (url === '/api/auth/setup-required' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ setupRequired: db.countUsers(database) === 0 }));
    return;
  }

  if (url === '/api/auth/setup' && req.method === 'POST') {
    if (db.countUsers(database) > 0) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'setup already completed' }));
      return;
    }
    // Defence: a fresh public-facing deployment should not allow ANY
    // remote unauthenticated caller to claim admin. Two acceptable paths:
    //   1. The request originates from loopback (operator on the box).
    //   2. The request carries the in-memory setup token printed to logs
    //      on first start (operator who can read PM2/journald).
    const ip = req.socket.remoteAddress || '';
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    const presentedToken = req.headers['x-setup-token'] || '';
    let tokenOk = false;
    if (SETUP_TOKEN && typeof presentedToken === 'string' && presentedToken.length === SETUP_TOKEN.length) {
      try {
        tokenOk = crypto.timingSafeEqual(Buffer.from(presentedToken, 'utf8'), Buffer.from(SETUP_TOKEN, 'utf8'));
      } catch (_) {
        tokenOk = false;
      }
    }
    if (!isLoopback && !tokenOk) {
      log('warn', 'Remote setup attempt rejected', { ip });
      jsonErr(res, 403, 'setup must run from localhost or with a valid X-Setup-Token header');
      return;
    }
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        const { username, password } = data;
        if (!username || !password || password.length < 8) {
          jsonErr(res, 400, 'Username and password (min 8 chars) required');
          return;
        }
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) {
          jsonErr(res, 400, 'username must be alphanumeric with . _ - (max 64 chars)');
          return;
        }
        const user = db.createUser(database, username, password, 'admin');
        const dbUser = db.getUserByUsername(database, username);
        const token = db.createSession(database, dbUser.id);
        setSessionCookie(res, token);
        // Setup completed — invalidate the in-memory token so a stolen
        // log line can't be reused after the admin is created.
        SETUP_TOKEN = null;
        jsonOk(res, { username: user.username, role: 'admin' });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  if (url === '/api/auth/login' && req.method === 'POST') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        const { username, password } = data;
        if (!username || !password) {
          jsonErr(res, 400, 'Username and password required');
          return;
        }
        const userKey = username.toLowerCase();
        const throttleKey = userKey + '@' + clientIP;
        if (!checkLoginAllowed(throttleKey) || !checkLoginAllowedPerUser(userKey)) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Too many login attempts. Try again in 15 minutes.' }));
          return;
        }
        const user = db.getUserByUsernameCaseInsensitive(database, username);
        // Constant-time login: always run scrypt, even when the username is
        // unknown — falling back to a process-local dummy hash keeps the
        // response time independent of whether the account exists. The
        // !user check below still rejects unknown accounts, but does so at
        // the same latency as a real user with a wrong password.
        const candidateHash = user ? user.hash : DUMMY_PASSWORD_HASH;
        const candidateSalt = user ? user.salt : DUMMY_PASSWORD_SALT;
        const passwordOk = db.verifyPassword(candidateHash, candidateSalt, password);
        if (!user || !passwordOk) {
          recordLoginFailure(throttleKey);
          recordLoginFailurePerUser(userKey);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid credentials' }));
          return;
        }
        clearLoginAttempts(throttleKey);
        clearLoginAttemptsPerUser(userKey);
        // Rotate: invalidate any pre-existing session token presented in
        // the request before minting a new one. Defends against stolen
        // pre-auth cookies surviving the legitimate user's login.
        const oldToken = getSessionToken(req);
        if (oldToken) {
          try {
            db.deleteSession(database, oldToken);
          } catch (_) {
            /* best effort — token may not exist anymore */
          }
        }
        const token = db.createSession(database, user.id);
        setSessionCookie(res, token);
        jsonOk(res, { username: user.username, role: user.role });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  if (url === '/api/auth/logout' && req.method === 'POST') {
    const token = getSessionToken(req);
    if (token) db.deleteSession(database, token);
    clearSessionCookie(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url === '/api/auth/me' && req.method === 'GET') {
    const session = checkAuth(req);
    if (!session) {
      sendUnauthorized(res, true);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ userId: session.user_id, username: session.username, role: session.role }));
    return;
  }

  // ── Auth gate ─────────────────────────────────────────────
  const isLoginPage = url === '/login.html';
  const isPublicAsset = !!url.match(/^\/(login\.js|icon-\d+\.png|favicon\.ico|icon\.svg|manifest\.json|sw\.js)$/);
  // The GitHub webhook authenticates itself via an HMAC signature; GitHub
  // cannot send a session cookie, so leaving it behind the session gate made
  // every delivery 401 (the whole auto-deploy chain was dead code). Its own
  // handler verifies GITHUB_WEBHOOK_SECRET + signature and refuses in worktree
  // mode, so it is safe to exempt here.
  const isWebhook = req.method === 'POST' && url === '/api/webhook/github';

  if (!isLoginPage && !isPublicAsset && !isWebhook) {
    if (db.countUsers(database) === 0) {
      if (url.startsWith('/api/')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'setup_required' }));
      } else {
        res.writeHead(302, { Location: '/login.html' });
        res.end();
      }
      return;
    }
    const authUser = checkAuth(req);
    if (!authUser) {
      sendUnauthorized(res, url.startsWith('/api/'));
      return;
    }
    req.authUser = authUser;
  }

  // ── Username list (any authenticated user) ────────────────
  if (url === '/api/usernames' && req.method === 'GET') {
    const users = db.listUsers(database).map((u) => ({ id: u.id, username: u.username }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(users));
    return;
  }

  // ── User management (admin only) ──────────────────────────
  if (url === '/api/users' && req.method === 'GET') {
    if (!req.authUser || req.authUser.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'admin required' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.listUsers(database)));
    return;
  }

  if (url === '/api/users' && req.method === 'POST') {
    if (!req.authUser || req.authUser.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'admin required' }));
      return;
    }
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        const { username, password, role } = data;
        if (!username || !password || password.length < 8) {
          jsonErr(res, 400, 'Username and password (min 8 chars) required');
          return;
        }
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) {
          jsonErr(res, 400, 'username must be alphanumeric with . _ - (max 64 chars)');
          return;
        }
        const user = db.createUser(database, username, password, role || 'user');
        log('info', 'User created', { actor: req.authUser.username, newUser: username, role: role || 'user' });
        jsonOk(res, user);
      } catch (e) {
        safeErr(res, e);
      }
    });
    return;
  }

  if (url.match(/^\/api\/users\/\d+$/) && req.method === 'DELETE') {
    if (!req.authUser || req.authUser.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'admin required' }));
      return;
    }
    const userId = parseInt(url.split('/').pop());
    if (userId === req.authUser.user_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cannot delete yourself' }));
      return;
    }
    db.deleteUser(database, userId);
    log('info', 'User deleted', { actor: req.authUser.username, deletedUserId: userId });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // PATCH /api/auth/password — change own password (any authenticated user)
  if (url === '/api/auth/password' && req.method === 'PATCH') {
    const session = checkAuth(req);
    if (!session) {
      sendUnauthorized(res, true);
      return;
    }
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      if (!data || !data.currentPassword || !data.newPassword) {
        jsonErr(res, 400, 'currentPassword and newPassword required');
        return;
      }
      if (data.newPassword.length < 8) {
        jsonErr(res, 400, 'New password must be at least 8 characters');
        return;
      }
      const user = db.getUserByUsername(database, session.username);
      if (!user) {
        jsonErr(res, 404, 'User not found');
        return;
      }
      if (!db.verifyPassword(user.hash, user.salt, data.currentPassword)) {
        jsonErr(res, 401, 'Current password is incorrect');
        return;
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(data.newPassword, salt, 64).toString('hex');
      db.updateUserPassword(database, user.id, hash, salt);
      // Invalidate all existing sessions, issue a fresh one for current user
      db.deleteSessionsByUserId(database, user.id);
      const newToken = db.createSession(database, user.id);
      setSessionCookie(res, newToken);
      jsonOk(res);
    });
    return;
  }

  // PATCH /api/users/:id/password — admin reset any user's password
  if (url.match(/^\/api\/users\/\d+\/password$/) && req.method === 'PATCH') {
    if (requireAdmin(req, res)) return;
    const userId = parseInt(url.split('/')[3]);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      if (!data || !data.newPassword) {
        jsonErr(res, 400, 'newPassword required');
        return;
      }
      if (data.newPassword.length < 8) {
        jsonErr(res, 400, 'New password must be at least 8 characters');
        return;
      }
      db.resetUserPassword(database, userId, data.newPassword);
      // Invalidate all sessions for the affected user
      db.deleteSessionsByUserId(database, userId);
      jsonOk(res);
    });
    return;
  }

  // POST /api/csp-reports — log CSP violations. Public endpoint (the
  // browser sends these without credentials), so we hard-cap body, rate-
  // limit per IP, and never echo the body in errors.
  if (req.method === 'POST' && req.url === '/api/csp-reports') {
    if (!checkRate(req, 30)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      res.end('{"error":"too_many_requests"}');
      return;
    }
    const CSP_BODY_MAX = 10000;
    let body = '';
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      // Reject BEFORE appending so a single oversized chunk can't land
      // in memory just to be discarded.
      if (body.length + c.length > CSP_BODY_MAX) {
        aborted = true;
        try {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end('{"error":"payload_too_large"}');
        } catch (_) {
          /* response may already be in flight */
        }
        req.destroy();
        return;
      }
      body += c;
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const report = JSON.parse(body);
        log('warn', 'CSP violation', report['csp-report'] || report);
      } catch (e) {}
      res.writeHead(204);
      res.end();
    });
    return;
  }

  // GET /api/health
  if (req.method === 'GET' && req.url === '/api/health') {
    let dbOk = false;
    try {
      database.prepare('SELECT 1').get();
      dbOk = true;
    } catch (e) {
      log('error', 'Health check: database unreachable', { error: e.message });
    }
    const mem = process.memoryUsage();
    // Public: minimal status only. Detailed info (Node version, platform,
    // memory, backup status) is admin-only — workers don't need to know
    // exact Node versions to triage their own work, and that detail aids
    // targeted exploitation if a CVE later hits a specific version.
    const authUser = checkAuth(req);
    const health = {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'connected' : 'error',
      uptime: Math.round(process.uptime()),
      version: require('./package.json').version,
      worktree: WORKTREE_MODE
    };
    if (authUser && authUser.role === 'admin') {
      health.platform = process.platform;
      health.nodeVersion = process.version;
      health.sseClients = sseClients.size;
      health.memory = {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024)
      };
      // Backup freshness — degraded if last successful backup is older than
      // 26h or if the most recent attempt failed.
      const backupStatus = readBackupStatus();
      const hasSuccess = backupStatus.lastSuccess && backupStatus.lastSuccess.time;
      let ageHours = null;
      let fresh = false;
      if (hasSuccess) {
        ageHours = (Date.now() - new Date(backupStatus.lastSuccess.time).getTime()) / 3600000;
        fresh = ageHours < 26;
      }
      const lastAttemptOk = !backupStatus.lastAttempt || backupStatus.lastAttempt.success !== false;
      health.backup = {
        status: fresh && lastAttemptOk ? 'ok' : 'stale',
        lastSuccess: backupStatus.lastSuccess || null,
        lastFailure: backupStatus.lastFailure || null,
        lastAttempt: backupStatus.lastAttempt || null,
        ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10
      };
      // R-06: surface the off-site sync marker so external monitors can flag
      // a stale off-site copy. The marker is written by the rsync cron (see
      // DEPLOYMENT.md → Off-site backups). Missing marker = "unknown" — the
      // operator may not have configured off-site sync yet.
      const offSite = { lastSync: null, ageMinutes: null, target: null, bytes: null };
      try {
        if (fs.existsSync(OFFSITE_MARKER_FILE)) {
          const parsed = JSON.parse(fs.readFileSync(OFFSITE_MARKER_FILE, 'utf8'));
          if (parsed && parsed.time) {
            offSite.lastSync = parsed.time;
            offSite.ageMinutes = Math.round((Date.now() - new Date(parsed.time).getTime()) / 60000);
            offSite.target = parsed.target || null;
            offSite.bytes = typeof parsed.bytes === 'number' ? parsed.bytes : null;
          }
        }
      } catch (e) {
        log('warn', 'Could not read off-site sync marker', { error: e.message });
      }
      health.backup.offSite = offSite;
      if (health.backup.status !== 'ok' && health.status === 'ok') {
        health.status = 'degraded';
      }
      // Off-site marker > 26h old (or missing) is a soft degraded signal —
      // we still surface it but only flip top-level status if backups themselves
      // are otherwise OK. If backups are already stale, the existing status
      // already reflects that.
      if (offSite.ageMinutes !== null && offSite.ageMinutes > 26 * 60 && health.status === 'ok') {
        health.status = 'degraded';
      }
    }
    res.writeHead(dbOk ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
    return;
  }

  // R-17: GET /api/health/full — admin-only ops dashboard payload.
  // Each section is wrapped in try/catch so a single broken probe (e.g.
  // statfsSync on Windows) doesn't blow up the whole endpoint; the field
  // becomes null instead. Public /api/health stays minimal.
  if (req.method === 'GET' && req.url === '/api/health/full') {
    if (requireAdmin(req, res)) return;
    const out = {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      version: require('./package.json').version,
      nodeVersion: process.version,
      platform: process.platform,
      timestamp: new Date().toISOString()
    };

    // disk: backup dir + photos dir free/used MB
    out.disk = (() => {
      const probe = (dir) => {
        try {
          if (!fs.existsSync(dir)) return null;
          const stats = fs.statfsSync(dir);
          const free = Number(stats.bavail) * Number(stats.bsize);
          const total = Number(stats.blocks) * Number(stats.bsize);
          return {
            freeMB: Math.round(free / 1e6),
            totalMB: Math.round(total / 1e6),
            usedMB: Math.round((total - free) / 1e6)
          };
        } catch (e) {
          return { error: e.message };
        }
      };
      let photoUsed = null;
      try {
        photoUsed = Math.round(_ensurePhotoDirSize(false) / 1e6);
      } catch (_) {
        /* ignore */
      }
      return {
        backups: probe(BACKUP_DIR),
        photos: probe(PHOTO_DIR),
        photosUsedMB: photoUsed,
        photosCapMB: Math.round(PHOTO_DIR_MAX_BYTES / 1e6)
      };
    })();

    // db: file size, WAL size, last vacuum age
    out.db = (() => {
      try {
        const dbStats = fs.statSync(DB_FILE);
        let walMB = null;
        try {
          walMB = Math.round(fs.statSync(DB_FILE + '-wal').size / 1e6);
        } catch (_) {
          /* WAL file may have been checkpointed away */
        }
        const backupStatus = readBackupStatus();
        const lastVacuum = backupStatus.lastSuccess && backupStatus.lastSuccess.time;
        const lastVacuumAgeHours = lastVacuum
          ? Math.round(((Date.now() - new Date(lastVacuum).getTime()) / 3600000) * 10) / 10
          : null;
        return {
          sizeMB: Math.round(dbStats.size / 1e6),
          walMB,
          lastVacuum: lastVacuum || null,
          lastVacuumAgeHours,
          ok: true
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })();

    // backup: reuse the same shape as /api/health
    out.backup = (() => {
      try {
        const bs = readBackupStatus();
        const hasSuccess = bs.lastSuccess && bs.lastSuccess.time;
        const ageHours = hasSuccess
          ? Math.round(((Date.now() - new Date(bs.lastSuccess.time).getTime()) / 3600000) * 10) / 10
          : null;
        let offSite = null;
        if (fs.existsSync(OFFSITE_MARKER_FILE)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(OFFSITE_MARKER_FILE, 'utf8'));
            if (parsed && parsed.time) {
              offSite = {
                lastSync: parsed.time,
                ageMinutes: Math.round((Date.now() - new Date(parsed.time).getTime()) / 60000),
                target: parsed.target || null,
                bytes: typeof parsed.bytes === 'number' ? parsed.bytes : null
              };
            }
          } catch (_) {
            /* corrupted marker; ignore */
          }
        }
        return {
          lastSuccess: bs.lastSuccess || null,
          lastFailure: bs.lastFailure || null,
          lastAttempt: bs.lastAttempt || null,
          ageHours,
          offSite
        };
      } catch (e) {
        return { error: e.message };
      }
    })();

    // tls: certificate expiry parsed from certs/server.crt
    out.tls = (() => {
      try {
        if (!fs.existsSync(CERT_CRT)) return { configured: false };
        const certPem = fs.readFileSync(CERT_CRT, 'utf8');
        const x509 = new crypto.X509Certificate(certPem);
        const validTo = x509.validTo;
        const expiryMs = new Date(validTo).getTime();
        const daysLeft = Number.isFinite(expiryMs) ? Math.round((expiryMs - Date.now()) / 86400000) : null;
        const isLE = certPem.includes("Let's Encrypt") || /CN=R\d+|CN=E\d+/.test(certPem);
        return { configured: true, expiry: validTo, daysLeft, type: isLE ? 'lets-encrypt' : 'self-signed' };
      } catch (e) {
        return { error: e.message };
      }
    })();

    // printBridge: configured flag + last-known cached printer state.
    // R-20: also surface queueStuck so monitors can flag spooler stalls
    // (paper out, jam, paused job, OfflineLogonRequired) even when the
    // printer itself reports online.
    out.printBridge = (() => {
      try {
        const cfg = getEffectiveBridgeConfig();
        const queueStuck = Number.isFinite(_printerQueueStuckCache) ? _printerQueueStuckCache : 0;
        return {
          configured: !!cfg,
          source: cfg ? cfg.source : null,
          lastReachable: _printerStatusCacheTime > 0 ? new Date(_printerStatusCacheTime).toISOString() : null,
          printerOnline: _printerStatusCache === true,
          queueStuck
        };
      } catch (e) {
        return { error: e.message };
      }
    })();
    // R-20: queueStuck > 0 is a degraded signal — paper out / jam / blocked
    // job all sit silently in the spooler with PrinterStatus still reporting
    // online. Only flip when the bridge is actually configured (otherwise
    // queueStuck stays 0 and this branch never fires).
    if (
      out.printBridge &&
      out.printBridge.configured &&
      Number.isFinite(out.printBridge.queueStuck) &&
      out.printBridge.queueStuck > 0 &&
      out.status === 'ok'
    ) {
      out.status = 'degraded';
    }

    // caldav: filesystem-based — count calendars + best-effort last-sync
    out.caldav = (() => {
      try {
        const cals = listCalendars();
        let lastSync = null;
        try {
          const row = database
            .prepare('SELECT MAX(caldav_synced) AS m FROM manual_tasks WHERE caldav_synced IS NOT NULL')
            .get();
          if (row && row.m) lastSync = row.m;
        } catch (_) {
          /* schema variation; ignore */
        }
        return { calendars: cals.length, lastSync };
      } catch (e) {
        return { error: e.message };
      }
    })();

    // mcp: live session count
    out.mcp = (() => {
      try {
        return { sessions: mcpSessions.size };
      } catch (e) {
        return { error: e.message };
      }
    })();

    // notifications: backlog + how many older-than-30d unread
    out.notifications = (() => {
      try {
        const total = database.prepare('SELECT COUNT(*) AS c FROM notifications').get();
        const oldUnread = database
          .prepare("SELECT COUNT(*) AS c FROM notifications WHERE read = 0 AND created < datetime('now', '-30 days')")
          .get();
        return {
          total: total ? total.c : 0,
          unreadOlderThan30d: oldUnread ? oldUnread.c : 0
        };
      } catch (e) {
        return { error: e.message };
      }
    })();

    // auth: active lockouts + expired-session count
    out.auth = (() => {
      try {
        const now = Date.now();
        let activeLockouts = 0;
        for (const entry of loginAttempts.values()) {
          if (entry.lockedUntil && entry.lockedUntil > now) activeLockouts++;
        }
        for (const entry of loginAttemptsPerUser.values()) {
          if (entry.lockedUntil && entry.lockedUntil > now) activeLockouts++;
        }
        const expiredRow = database.prepare("SELECT COUNT(*) AS c FROM sessions WHERE expires < datetime('now')").get();
        const totalSessions = database.prepare('SELECT COUNT(*) AS c FROM sessions').get();
        return {
          activeLockouts,
          expiredSessions: expiredRow ? expiredRow.c : 0,
          totalSessions: totalSessions ? totalSessions.c : 0
        };
      } catch (e) {
        return { error: e.message };
      }
    })();

    // deploy: last webhook auto-deploy attempt sentinel (R-14)
    try {
      const dep = readDeployState();
      if (dep) out.deploy = dep;
    } catch (_) {
      /* ignore */
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
    return;
  }

  // SSE endpoint for real-time sync
  if (req.method === 'GET' && req.url === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('data: {"type":"connected"}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // POST /api/internal/notify — MCP server triggers SSE broadcast, localhost only
  if (req.method === 'POST' && url === '/api/internal/notify') {
    const ip = req.socket.remoteAddress;
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      res.writeHead(403);
      res.end();
      return;
    }
    broadcastSSE(null);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // GET /api/data
  if (req.method === 'GET' && url === '/api/data') {
    // P-04: ETag short-circuit. The DB already maintains a monotonic
    // data_version counter (db.incrementDataVersion is fired on every write).
    // We expose it as ETag "v<n>" and honor If-None-Match so phones polling
    // every 30 s skip the entire readAll + JSON.stringify when nothing changed.
    // The notification unread count is per-user and not part of data_version,
    // so we mix the user_id and the unread count into the ETag to keep it
    // accurate per client. (Otherwise a notification arriving for user A
    // would be missed by user B's still-cached response.)
    let unread = 0;
    try {
      unread = db.countUnreadNotifications(database, req.authUser.user_id);
    } catch {
      /* meta absent — fall through to 0 */
    }
    let version = 0;
    try {
      version = db.getDataVersion(database);
    } catch {
      /* meta absent — fall through to 0 */
    }
    const etag = '"v' + version + '-u' + (req.authUser.user_id || 0) + '-n' + unread + '"';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, no-cache' });
      res.end();
      return;
    }
    const payload = readData();
    // Per-user unread notification count so the bell badge can update
    // on every sync without a separate request.
    payload.notifications = { unread };
    // Expose label dimensions so the client's ZPL builder can adapt
    // without a separate round-trip. Static for the process lifetime.
    payload.labelDims = { widthDots: LABEL_WIDTH_DOTS, heightDots: LABEL_HEIGHT_DOTS };
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ETag: etag,
      'Cache-Control': 'private, no-cache'
    });
    res.end(JSON.stringify(payload));
    return;
  }

  // GET /api/scan-log — paginated scan log history
  if (req.method === 'GET' && url === '/api/scan-log') {
    const params = new URL(req.url, 'http://x').searchParams;
    const limit = Math.max(1, Math.min(parseInt(params.get('limit'), 10) || 200, 1000));
    const offset = Math.max(0, parseInt(params.get('offset'), 10) || 0);
    const batch = params.get('batch') || null;
    const action = params.get('action') || null;
    let where = '1=1';
    const args = [];
    if (batch) {
      where += ' AND s.batch=?';
      args.push(batch);
    }
    if (action) {
      where += ' AND s.action=?';
      args.push(action);
    }
    const total = database.prepare('SELECT COUNT(*) as total FROM scan_log s WHERE ' + where).get(...args).total;
    const rows = database
      .prepare(
        'SELECT s.*, u.username FROM scan_log s LEFT JOIN users u ON s.user_id=u.id WHERE ' +
          where +
          ' ORDER BY s.id DESC LIMIT ? OFFSET ?'
      )
      .all(...args, limit, offset);
    jsonOk(res, {
      items: rows.map((r) => ({
        id: r.id,
        time: r.time,
        action: r.action,
        batch: r.batch,
        bag: r.bag,
        from: r.from,
        to: r.to,
        species: r.species,
        strain: r.strain,
        userId: r.user_id,
        user: r.username || null
      })),
      total,
      limit,
      offset
    });
    return;
  }

  // GET /api/harvests — paginated harvest history
  if (req.method === 'GET' && url === '/api/harvests') {
    const params = new URL(req.url, 'http://x').searchParams;
    const limit = Math.max(1, Math.min(parseInt(params.get('limit'), 10) || 200, 1000));
    const offset = Math.max(0, parseInt(params.get('offset'), 10) || 0);
    const batch = params.get('batch') || null;
    let where = '1=1';
    const args = [];
    if (batch) {
      where += ' AND batch=?';
      args.push(batch);
    }
    const total = database.prepare('SELECT COUNT(*) as total FROM harvests WHERE ' + where).get(...args).total;
    const rows = database
      .prepare('SELECT * FROM harvests WHERE ' + where + ' ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(...args, limit, offset);
    jsonOk(res, {
      items: rows.map((r) => ({
        id: r.id,
        time: r.time,
        batch: r.batch,
        bag: r.bag,
        species: r.species,
        strain: r.strain,
        grams: r.grams,
        flush: r.flush
      })),
      total,
      limit,
      offset
    });
    return;
  }

  // GET /api/kpi-snapshots — historical KPI data for trend analysis
  if (req.method === 'GET' && url === '/api/kpi-snapshots') {
    const params = new URL(req.url, 'http://x').searchParams;
    const limit = params.get('limit') ? Math.max(1, Math.min(parseInt(params.get('limit'), 10) || 90, 365)) : null;
    const rows = db.getKpiSnapshots(database, limit);
    jsonOk(res, { items: rows });
    return;
  }

  // POST /api/kpi-snapshots/now — manually trigger a KPI snapshot for today
  if (req.method === 'POST' && url === '/api/kpi-snapshots/now') {
    if (requireAdmin(req, res)) return;
    try {
      const result = db.snapshotDailyKPIs(database, { force: true });
      jsonOk(res, result);
    } catch (e) {
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // POST /api/data — full-state save (used by client saveData())
  if (req.method === 'POST' && url === '/api/data') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        writeData(data);
        const version = db.getDataVersion(database);
        broadcastSSE(res);
        jsonOk(res, { version });
        try {
          autoSyncAllCaldav(data);
        } catch (ce) {
          log('error', 'CalDAV auto-sync failed', { error: ce.message });
        }
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // ── ATOMIC REST ENDPOINTS ────────────────────────────────────

  // -- Mushroom Strains --
  if (req.method === 'GET' && url === '/api/mushroom-strains') {
    try {
      jsonOk(res, db.listMushroomStrains(database));
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'POST' && url === '/api/mushroom-strains') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['name', 'kuerzel']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      const vs = validateMushroomStrain(data);
      if (vs) {
        jsonErr(res, 400, vs);
        return;
      }
      try {
        const id = db.createMushroomStrain(database, data);
        broadcastSSE(res);
        jsonOk(res, { id });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const msMatch = url.match(/^\/api\/mushroom-strains\/(\d+)$/);
  if (req.method === 'PATCH' && msMatch) {
    const id = parseInt(msMatch[1], 10);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vs = validateMushroomStrain(data);
      if (vs) {
        jsonErr(res, 400, vs);
        return;
      }
      try {
        db.updateMushroomStrain(database, id, data);
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'DELETE' && msMatch) {
    if (requireAdmin(req, res)) return;
    const id = parseInt(msMatch[1], 10);
    try {
      db.deleteMushroomStrain(database, id);
      broadcastSSE(res);
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- Batches --
  if (req.method === 'POST' && req.url === '/api/batches') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      // strainId replaces species+strain; species still required when no strainId
      const requiredFields = data.strainId
        ? ['batchId', 'qty', 'days', 'created', 'due']
        : ['batchId', 'species', 'qty', 'days', 'created', 'due'];
      const vr = validateRequired(data, requiredFields);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      const vt = validateTypes(data, {
        qty: 'number',
        days: 'number',
        batchId: 'string',
        ...(data.species ? { species: 'string' } : {})
      });
      if (vt) {
        jsonErr(res, 400, vt);
        return;
      }
      const vrng = validateRanges(data, { qty: { min: 1, max: 10000 }, days: { min: 1, max: 3650 } });
      if (vrng) {
        jsonErr(res, 400, vrng);
        return;
      }
      const vlen = validateLengths(data, { batchId: 100, species: 200, strain: 200, notes: 10000, strainText: 200 });
      if (vlen) {
        jsonErr(res, 400, vlen);
        return;
      }
      if (!/^[A-Za-z0-9_\-@.:]{1,100}$/.test(data.batchId)) {
        jsonErr(res, 400, 'batchId must be alphanumeric with - _ @ . : (max 100 chars)');
        return;
      }
      let vd = validateDate(data.created, 'created');
      if (vd) {
        jsonErr(res, 400, vd);
        return;
      }
      vd = validateDate(data.due, 'due');
      if (vd) {
        jsonErr(res, 400, vd);
        return;
      }
      // Validate optional inventory deltas — applied atomically with the batch.
      // Shape: [{ mat: 'hardwood'|'wheatbran'|'gypsum'|'grain', deltaKg: number, type?: string, ref?: string }, ...]
      let deltas = null;
      if (data.deltas != null) {
        if (!Array.isArray(data.deltas)) {
          jsonErr(res, 400, 'deltas must be an array');
          return;
        }
        for (const d of data.deltas) {
          if (!d || typeof d !== 'object') {
            jsonErr(res, 400, 'deltas entries must be objects');
            return;
          }
          if (!['hardwood', 'wheatbran', 'gypsum', 'grain', 'coir'].includes(d.mat)) {
            jsonErr(res, 400, 'deltas[].mat must be hardwood/wheatbran/gypsum/grain/coir');
            return;
          }
          if (typeof d.deltaKg !== 'number' || !Number.isFinite(d.deltaKg)) {
            jsonErr(res, 400, 'deltas[].deltaKg must be a finite number');
            return;
          }
        }
        deltas = data.deltas;
      }
      try {
        // I-22: thread the authenticated user_id so inventory_log rows record the actor.
        const userId = req.authUser ? req.authUser.user_id : null;
        const result = db.insertBatch(database, data, deltas, userId);
        autoPushBatchCaldav(data);
        broadcastSSE(res);
        jsonOk(res, { ok: true, bagBarcodes: result ? result.bagBarcodes : {} });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const batchMatch = req.url.match(/^\/api\/batches\/([^/]+)\/bags$/);
  if (req.method === 'PATCH' && batchMatch) {
    const id = decodeURIComponent(batchMatch[1]);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        // I-22 + I-23: thread user_id and let addBagsToBatch deduct inventory
        // for the new bags inside the same transaction.
        const userId = req.authUser ? req.authUser.user_id : null;
        const result = db.addBagsToBatch(database, id, data.add || [], data.newQty, undefined, userId);
        broadcastSSE(res);
        jsonOk(res, { ok: true, bagBarcodes: result ? result.bagBarcodes : {} });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const batchIdMatch = req.url.match(/^\/api\/batches\/([^/]+)$/);
  if (req.method === 'PATCH' && batchIdMatch) {
    const id = decodeURIComponent(batchIdMatch[1]);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        db.updateBatchField(database, id, data);
        if (data.due) {
          const b = db.readBatchById(database, id);
          if (b) autoPushBatchCaldav(b);
        }
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'DELETE' && batchIdMatch) {
    if (requireAdmin(req, res)) return;
    const id = decodeURIComponent(batchIdMatch[1]);
    try {
      // I-22: forward acting user so the inventory_log credit-back records the actor.
      db.deleteBatchById(database, id, req.authUser ? req.authUser.user_id : null);
      try {
        autoDeleteBatchCaldav(id);
      } catch (ce) {
        log('warn', 'CalDAV cleanup failed after batch delete', { batchId: id, error: ce.message });
      }
      broadcastSSE(res);
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  const batchRenameMatch = req.url.match(/^\/api\/batches\/([^/]+)\/rename$/);
  if (req.method === 'POST' && batchRenameMatch) {
    if (requireAdmin(req, res)) return;
    const oldId = decodeURIComponent(batchRenameMatch[1]);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const newId = (data.newId || '').trim();
      if (!newId) {
        jsonErr(res, 400, 'newId is required');
        return;
      }
      if (!/^[A-Za-z0-9_\-@.:]{1,100}$/.test(newId)) {
        jsonErr(res, 400, 'newId must be alphanumeric with - _ @ . : (max 100 chars)');
        return;
      }
      try {
        db.renameBatch(database, oldId, newId);
        broadcastSSE(res);
        jsonOk(res, { ok: true, oldId, newId });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // -- Scan Log --
  if (req.method === 'POST' && req.url === '/api/scan-log') {
    const sess = checkAuth(req);
    const userId = sess ? sess.user_id : null;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        const entries = data.entries || [];
        const ve = validateScanEntries(entries);
        if (ve) {
          jsonErr(res, 400, ve);
          return;
        }
        // I-12: optimistic concurrency for offline-queue replays. If a MOVE
        // entry was queued offline based on a stale view (the bag has since
        // been moved by another user), reject the whole POST with 409 so the
        // client can discard the queued entry rather than trampling the more
        // recent move. expected_current_zone is OPTIONAL — entries without
        // it skip the check (preserves backward compat with older clients).
        for (const e of entries) {
          if (e.action !== 'MOVE' && e.action !== 'MOVE_BATCH') continue;
          if (!e.expected_current_zone) continue;
          if (!e.bag) continue;
          const last = database
            .prepare(
              "SELECT action, \"to\" FROM scan_log WHERE bag = ? AND action IN ('ADD', 'MOVE', 'MOVE_BATCH', 'REMOVE') ORDER BY id DESC LIMIT 1"
            )
            .get(e.bag);
          // currentZone = the zone of the last placement. last.to may be a
          // rack id (underscores, e.g. INC_R1) — resolve it back to its zone
          // so it matches the client's toZone(expected_current_zone). A plain
          // split(':') would leave the rack id intact and 409 every rack move.
          let currentZone = null;
          if (last && last.action !== 'REMOVE' && last.to) {
            currentZone = db.zoneIdOfLocation(database, last.to);
          }
          if (currentZone !== e.expected_current_zone) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'zone_mismatch',
                bag: e.bag,
                current_zone: currentZone,
                expected: e.expected_current_zone
              })
            );
            return;
          }
        }
        const ids = db.appendScanEntries(database, entries, userId);
        broadcastSSE(res);
        jsonOk(res, { ids });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const scanLastMatch = req.url.match(/^\/api\/scan-log\/last\/(\d+)$/);
  if (req.method === 'DELETE' && scanLastMatch) {
    if (requireAdmin(req, res)) return;
    try {
      db.deleteLastScanEntries(database, parseInt(scanLastMatch[1]));
      broadcastSSE(res);
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  const scanIdMatch = req.url.match(/^\/api\/scan-log\/(\d+)$/);
  if (req.method === 'DELETE' && scanIdMatch) {
    // S-03: workers should be able to undo their own scans, but
    // not delete scans authored by other users. Owner-or-admin ACL,
    // mirroring the contamination-report pattern. The user_id column on
    // scan_log is nullable for legacy rows — only enforce ownership when
    // the column is set; otherwise fall back to admin-only.
    const id = parseInt(scanIdMatch[1]);
    try {
      const entry = db.getScanEntryById(database, id);
      if (!entry) {
        jsonErr(res, 404, 'not found');
        return;
      }
      const isAdmin = req.authUser && req.authUser.role === 'admin';
      const ownerKnown = entry.user_id !== null && entry.user_id !== undefined;
      const isOwner = ownerKnown && req.authUser && entry.user_id === req.authUser.user_id;
      if (!isAdmin && ownerKnown && !isOwner) {
        jsonErr(res, 403, 'forbidden');
        return;
      }
      if (!isAdmin && !ownerKnown) {
        jsonErr(res, 403, 'forbidden');
        return;
      }
      const ok = db.deleteScanEntryById(database, id);
      broadcastSSE(res);
      jsonOk(res, { deleted: ok });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'DELETE' && req.url === '/api/scan-log') {
    if (requireAdmin(req, res)) return;
    try {
      db.clearScanLog(database);
      broadcastSSE(res);
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- Contamination reports --
  if (req.method === 'GET' && req.url === '/api/contamination-types') {
    try {
      jsonOk(res, db.listContaminationTypes(database));
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/contamination-reports') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['type_id']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      const vt = validateTypes(data, { type_id: 'number', photos: 'array' });
      if (vt) {
        jsonErr(res, 400, vt);
        return;
      }
      const ve = validateEnum(data.severity, ['minor', 'major', 'lost'], 'severity');
      if (ve) {
        jsonErr(res, 400, ve);
        return;
      }
      const vl = validateLengths(data, { notes: 2000, bag_id: 100, batch_id: 100, zone_id: 100 });
      if (vl) {
        jsonErr(res, 400, vl);
        return;
      }
      // Track disk-side photo files written so we can best-effort delete them
      // if the surrounding DB transaction rolls back. Disk writes themselves
      // are not transactional, so on rollback we accept that orphaned files
      // may remain — TODO: write to a temp staging dir and atomically move on
      // commit if this becomes load-bearing.
      const writtenPhotoFiles = [];
      let reportId = null;
      const photoIds = [];
      let autoMovedScanId = null;
      try {
        database.exec('BEGIN');
        try {
          reportId = db.createContaminationReport(database, {
            ...data,
            user_id: req.authUser ? req.authUser.user_id : null
          });
          const photos = Array.isArray(data.photos) ? data.photos.slice(0, 4) : [];
          for (const p of photos) {
            const saved = savePhotoToDisk(reportId, p, req.authUser);
            if (saved) {
              writtenPhotoFiles.push(path.join(DIR, 'data', saved.rel_path));
              writtenPhotoFiles.push(path.join(DIR, 'data', saved.thumb_path));
              photoIds.push(db.addContaminationPhoto(database, reportId, saved));
            }
          }
          // Auto-MOVE-to-CONTAM lifecycle: when severity is major/lost (and the
          // client didn't explicitly opt out), insert a MOVE scan-log entry that
          // moves the bag to the first zone with role='contaminated'. Stamps
          // contamination_reports.scan_log_id to link the two records together.
          // Skipped silently when (a) auto_move is false, (b) severity is minor,
          // (c) no bag_id (whole-batch report), (d) no contam zone configured.
          const wantAutoMove = data.auto_move !== false && (data.severity === 'major' || data.severity === 'lost');
          if (wantAutoMove && data.bag_id) {
            const contamZone = database
              .prepare("SELECT id FROM zones WHERE role = 'contaminated' ORDER BY sort_order, id LIMIT 1")
              .get();
            if (contamZone) {
              const lastLoc = database
                .prepare(
                  "SELECT \"to\" AS toLoc FROM scan_log WHERE bag = ? AND action IN ('ADD','MOVE') ORDER BY id DESC LIMIT 1"
                )
                .get(data.bag_id);
              const typeRow = database.prepare('SELECT key FROM contamination_types WHERE id = ?').get(data.type_id);
              const reasonKey = typeRow ? 'contam_' + typeRow.key : 'contam_unknown';
              // Use the no-txn variant so this insert is part of the surrounding transaction.
              const ids = db.appendScanEntriesNoTxn(
                database,
                [
                  {
                    time: new Date().toISOString(),
                    action: 'MOVE',
                    batch: data.batch_id || null,
                    bag: data.bag_id,
                    from: lastLoc ? lastLoc.toLoc : null,
                    to: contamZone.id,
                    reason: reasonKey
                  }
                ],
                req.authUser ? req.authUser.user_id : null
              );
              if (ids && ids.length) {
                autoMovedScanId = ids[0];
                db.setContaminationReportScanLogId(database, reportId, autoMovedScanId);
              }
            }
          }
          database.exec('COMMIT');
        } catch (innerErr) {
          database.exec('ROLLBACK');
          // appendScanEntriesNoTxn above mutated the in-memory bag-zone cache;
          // the rollback undid the scan rows but not the cache — rebuild on next read.
          db.invalidateBagZoneCache(database);
          // Best-effort cleanup of disk files written during the failed transaction.
          for (const f of writtenPhotoFiles) {
            try {
              fs.unlinkSync(f);
            } catch {
              /* ignore — file already gone or never existed */
            }
          }
          throw innerErr;
        }
        broadcastSSE(res);
        jsonOk(res, { id: reportId, photoIds, autoMovedScanId });
      } catch (err) {
        // R-15: photo-cap errors map to 507 Insufficient Storage so the
        // client can display a useful "directory full" message instead of a
        // generic 400.
        if (err && err.name === 'PhotoCapError') {
          jsonErr(res, 507, err.message);
        } else {
          safeErr(res, err);
        }
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/api/contamination-reports')) {
    const photoMatch = req.url.match(/^\/api\/contamination-reports\/(\d+)\/photos\/([a-f0-9-]+)(?:\?.*)?$/);
    if (photoMatch) {
      const reportId = parseInt(photoMatch[1], 10);
      const uuid = photoMatch[2];
      const wantThumb = /[?&]thumb=1/.test(req.url);
      try {
        const photo = db.getContaminationPhotoByUuid(database, uuid);
        if (!photo || photo.report_id !== reportId) {
          jsonErr(res, 404, 'photo not found');
          return;
        }
        const rel = wantThumb ? photo.thumb_path : photo.rel_path;
        const abs = path.join(DIR, 'data', rel);
        // Defence-in-depth: refuse to serve anything that isn't a child of data/photos
        if (!abs.startsWith(path.join(DIR, 'data', 'photos') + path.sep)) {
          jsonErr(res, 400, 'invalid path');
          return;
        }
        if (!fs.existsSync(abs)) {
          jsonErr(res, 404, 'photo file missing');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'private, max-age=31536000, immutable'
        });
        // pipe() does not forward the read stream's 'error' (e.g. a concurrent
        // report DELETE unlinking the file after the existsSync check), which
        // would otherwise leave the response hanging forever. Headers are
        // already sent, so just tear down the socket.
        const photoStream = fs.createReadStream(abs);
        photoStream.on('error', (e) => {
          log('warn', 'Photo stream error', { error: e.message });
          res.destroy();
        });
        photoStream.pipe(res);
      } catch (err) {
        safeErr(res, err);
      }
      return;
    }
    const singleMatch = req.url.match(/^\/api\/contamination-reports\/(\d+)$/);
    if (singleMatch) {
      try {
        const r = db.getContaminationReportById(database, parseInt(singleMatch[1], 10));
        if (!r) {
          jsonErr(res, 404, 'not found');
          return;
        }
        jsonOk(res, r);
      } catch (err) {
        safeErr(res, err);
      }
      return;
    }
    if (req.url === '/api/contamination-reports' || req.url.startsWith('/api/contamination-reports?')) {
      try {
        const u = new URL(req.url, 'http://x');
        const filters = {
          batchId: u.searchParams.get('batchId') || undefined,
          bagId: u.searchParams.get('bagId') || undefined,
          typeId: u.searchParams.get('typeId') ? parseInt(u.searchParams.get('typeId'), 10) : undefined,
          severity: u.searchParams.get('severity') || undefined,
          zoneId: u.searchParams.get('zoneId') || undefined,
          startDate: u.searchParams.get('start') || undefined,
          endDate: u.searchParams.get('end') || undefined,
          status: u.searchParams.get('status') || undefined,
          limit: u.searchParams.get('limit') ? parseInt(u.searchParams.get('limit'), 10) : undefined
        };
        jsonOk(res, db.listContaminationReports(database, filters));
      } catch (err) {
        safeErr(res, err);
      }
      return;
    }
  }
  // Resolve / reopen — sets or clears resolved_at, resolved_by, resolution.
  // Reporter or admin only (mirror delete ACL).
  const contamResolveMatch = req.url.match(/^\/api\/contamination-reports\/(\d+)\/resolve$/);
  if (req.method === 'PATCH' && contamResolveMatch) {
    const reportId = parseInt(contamResolveMatch[1], 10);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        const existing = db.getContaminationReportById(database, reportId);
        if (!existing) {
          jsonErr(res, 404, 'not found');
          return;
        }
        const isOwner = req.authUser && existing.user_id === req.authUser.user_id;
        const isAdmin = req.authUser && req.authUser.role === 'admin';
        if (!isOwner && !isAdmin) {
          jsonErr(res, 403, 'forbidden');
          return;
        }
        if (data && data.resolution) {
          const ve = validateEnum(data.resolution, ['autoclaved', 'discarded', 'recovered', 'other'], 'resolution');
          if (ve) {
            jsonErr(res, 400, ve);
            return;
          }
          db.resolveContaminationReport(
            database,
            reportId,
            req.authUser ? req.authUser.user_id : null,
            data.resolution
          );
        } else {
          // Empty/null resolution = reopen
          db.unresolveContaminationReport(database, reportId);
        }
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const contamDeleteMatch = req.url.match(/^\/api\/contamination-reports\/(\d+)$/);
  if (req.method === 'DELETE' && contamDeleteMatch) {
    const reportId = parseInt(contamDeleteMatch[1], 10);
    try {
      const existing = db.getContaminationReportById(database, reportId);
      if (!existing) {
        jsonErr(res, 404, 'not found');
        return;
      }
      // Reporter or admin can delete (mirror manual-tasks ACL)
      const isOwner = req.authUser && existing.user_id === req.authUser.user_id;
      const isAdmin = req.authUser && req.authUser.role === 'admin';
      if (!isOwner && !isAdmin) {
        jsonErr(res, 403, 'forbidden');
        return;
      }
      const photoPaths = db.deleteContaminationReport(database, reportId);
      // Best-effort unlink — DB is the source of truth, orphan files are harmless
      for (const p of photoPaths) {
        for (const rel of [p.rel_path, p.thumb_path]) {
          const abs = path.join(DIR, 'data', rel);
          if (abs.startsWith(path.join(DIR, 'data', 'photos') + path.sep)) {
            try {
              fs.unlinkSync(abs);
            } catch (e) {
              /* ignore — file may already be gone */
            }
          }
        }
      }
      broadcastSSE(res);
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- Harvests --
  if (req.method === 'POST' && req.url === '/api/harvests') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['time', 'grams']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      const vt = validateTypes(data, { grams: 'number', flush: 'number' });
      if (vt) {
        jsonErr(res, 400, vt);
        return;
      }
      const vrng = validateRanges(data, { grams: { min: 0, max: 1000000 }, flush: { min: 1, max: 100 } });
      if (vrng) {
        jsonErr(res, 400, vrng);
        return;
      }
      const vd = validateDate(data.time, 'time');
      if (vd) {
        jsonErr(res, 400, vd);
        return;
      }
      try {
        const id = db.insertHarvest(database, data);
        broadcastSSE(res);
        jsonOk(res, { id });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // -- Cultures --
  if (req.method === 'POST' && req.url === '/api/cultures') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        const arr = data.cultures || [];
        for (const c of arr) {
          const vr = validateRequired(c, ['id', 'type', 'created']);
          if (vr) {
            jsonErr(res, 400, vr);
            return;
          }
          if (typeof c.id !== 'string' || !/^[A-Za-z0-9_\-@.:]{1,200}$/.test(c.id)) {
            jsonErr(res, 400, 'culture id must be alphanumeric with - _ @ . : (max 200 chars)');
            return;
          }
        }
        const result = db.insertCultures(database, arr);
        broadcastSSE(res);
        jsonOk(res, { ok: true, cultureBarcodes: result ? result.cultureBarcodes : {} });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const cultureRenameMatch = req.url.match(/^\/api\/cultures\/([^/]+)\/rename$/);
  if (req.method === 'POST' && cultureRenameMatch) {
    const oldId = decodeURIComponent(cultureRenameMatch[1]);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const newId = (data.newId || '').trim();
      if (!newId) {
        jsonErr(res, 400, 'newId is required');
        return;
      }
      if (!/^[A-Za-z0-9_\-@.:]{1,200}$/.test(newId)) {
        jsonErr(res, 400, 'newId must be alphanumeric with - _ @ . : (max 200 chars)');
        return;
      }
      try {
        db.renameCulture(database, oldId, newId);
        broadcastSSE(res);
        jsonOk(res, { ok: true, oldId, newId });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const cultureMatch = req.url.match(/^\/api\/cultures\/([^/]+)$/);
  if (req.method === 'PATCH' && cultureMatch) {
    const id = decodeURIComponent(cultureMatch[1]);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        db.updateCulture(database, id, data);
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'DELETE' && cultureMatch) {
    // S-03: deleting a culture orphans batches.source_id and
    // contradicts the README role model (workers may create cultures
    // but only admins remove them).
    if (requireAdmin(req, res)) return;
    const id = decodeURIComponent(cultureMatch[1]);
    try {
      const deleted = db.deleteCulture(database, id);
      broadcastSSE(res);
      jsonOk(res, { deleted });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // ── Order hub (Phase 0): orders, products, demand, customers ──────────────
  // Auth is enforced by the global gate above (req.authUser is always set here).
  // Operational reads/writes = any authed user; catalog/mapping/merge = admin.

  // Orders — list (?status= &channel= &limit=)
  if (req.method === 'GET' && url === '/api/orders') {
    try {
      const params = new URL(req.url, 'http://x').searchParams;
      jsonOk(res, {
        items: db.listOrders(database, {
          status: params.get('status') || undefined,
          channel: params.get('channel') || undefined,
          limit: parseInt(params.get('limit'), 10) || 200
        })
      });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // Orders — production-demand rollup (must precede /api/orders/:id)
  if (req.method === 'GET' && url === '/api/orders/demand') {
    try {
      jsonOk(res, { items: db.computeProductionDemand(database) });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // Orders — manual / CSV import (single object, or {orders:[...]}, or [...])
  if (req.method === 'POST' && url === '/api/orders/import') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        const incoming = Array.isArray(data) ? data : Array.isArray(data && data.orders) ? data.orders : [data];
        const ids = [];
        for (const o of incoming) {
          if (!o || !o.channel || o.channelOrderId == null) {
            jsonErr(res, 400, 'each order needs channel + channelOrderId');
            return;
          }
          ids.push(db.upsertOrder(database, o));
        }
        broadcastSSE(res);
        jsonOk(res, { imported: ids.length, ids });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // Orders — reserve demand against a batch ({batchId, allocations:[{orderItemId, qty}]})
  if (req.method === 'POST' && url === '/api/orders/reserve') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        db.reserveDemand(database, { batchId: data.batchId || null, allocations: data.allocations || [] });
        broadcastSSE(res);
        jsonOk(res, { ok: true });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // Orders — detail / set status
  const orderMatch = url.match(/^\/api\/orders\/(\d+)$/);
  if (req.method === 'GET' && orderMatch) {
    try {
      const o = db.getOrder(database, parseInt(orderMatch[1], 10));
      if (!o) {
        jsonErr(res, 404, 'not found');
        return;
      }
      jsonOk(res, o);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'PATCH' && orderMatch) {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const allowed = ['new', 'in_production', 'ready', 'shipped', 'cancelled'];
      if (!allowed.includes(data.status)) {
        jsonErr(res, 400, 'invalid status');
        return;
      }
      try {
        const changed = db.setOrderStatus(database, parseInt(orderMatch[1], 10), data.status);
        broadcastSSE(res);
        jsonOk(res, { changed });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // Products — unmapped queue (must precede /api/products/:id) + list
  if (req.method === 'GET' && url === '/api/products/unmapped') {
    try {
      jsonOk(res, { items: db.listUnmappedItems(database) });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'GET' && url === '/api/products') {
    try {
      const params = new URL(req.url, 'http://x').searchParams;
      jsonOk(res, { items: db.listProducts(database, { activeOnly: params.get('active') === '1' }) });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // Products — create (admin)
  if (req.method === 'POST' && url === '/api/products') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['name']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      try {
        const id = db.upsertProduct(database, data);
        broadcastSSE(res);
        jsonOk(res, { id });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // Products — map a channel listing → internal product (admin)
  if (req.method === 'POST' && url === '/api/products/map') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['channel', 'productId']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      try {
        db.mapListing(database, data);
        broadcastSSE(res);
        jsonOk(res, { ok: true });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // Products — detail (authed) / update + delete (admin)
  const productMatch = url.match(/^\/api\/products\/(\d+)$/);
  if (req.method === 'GET' && productMatch) {
    try {
      const p = db.getProduct(database, parseInt(productMatch[1], 10));
      if (!p) {
        jsonErr(res, 404, 'not found');
        return;
      }
      jsonOk(res, p);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'PATCH' && productMatch) {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['name']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      try {
        const id = db.upsertProduct(database, { ...data, id: parseInt(productMatch[1], 10) });
        broadcastSSE(res);
        jsonOk(res, { id });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'DELETE' && productMatch) {
    if (requireAdmin(req, res)) return;
    try {
      const deleted = db.deleteProduct(database, parseInt(productMatch[1], 10));
      broadcastSSE(res);
      jsonOk(res, { deleted });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // Customers — list (authed) / merge two records (admin)
  if (req.method === 'GET' && url === '/api/customers') {
    try {
      const params = new URL(req.url, 'http://x').searchParams;
      jsonOk(res, { items: db.listCustomers(database, { limit: parseInt(params.get('limit'), 10) || 200 }) });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'POST' && url === '/api/customers/merge') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['primaryId', 'secondaryId']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      try {
        db.mergeCustomers(database, data.primaryId, data.secondaryId);
        broadcastSSE(res);
        jsonOk(res, { ok: true });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // -- Tasks --
  if (req.method === 'POST' && req.url === '/api/tasks') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['text', 'created']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      const vt = validateTypes(data, {
        text: 'string',
        priority: 'string',
        assignee: 'string',
        description: 'string',
        recurrence: 'string'
      });
      if (vt) {
        jsonErr(res, 400, vt);
        return;
      }
      const vlen = validateLengths(data, { text: 2000, description: 10000, assignee: 200 });
      if (vlen) {
        jsonErr(res, 400, vlen);
        return;
      }
      const ve = validateEnum(data.priority, ['low', 'med', 'high'], 'priority');
      if (ve) {
        jsonErr(res, 400, ve);
        return;
      }
      if (data.recurrence) {
        const vr2 = validateEnum(data.recurrence, ['daily', 'weekly', 'monthly'], 'recurrence');
        if (vr2) {
          jsonErr(res, 400, vr2);
          return;
        }
      }
      if (data.dueDate) {
        const vd = validateDate(data.dueDate, 'dueDate');
        if (vd) {
          jsonErr(res, 400, vd);
          return;
        }
      }
      if (data.dueTime) {
        const vt2 = validateTimeOfDay(data.dueTime, 'dueTime');
        if (vt2) {
          jsonErr(res, 400, vt2);
          return;
        }
      }
      if (data.dueEndTime) {
        const vt2 = validateTimeOfDay(data.dueEndTime, 'dueEndTime');
        if (vt2) {
          jsonErr(res, 400, vt2);
          return;
        }
      }
      if (data.recurrenceUntil) {
        const vd = validateDate(data.recurrenceUntil, 'recurrenceUntil');
        if (vd) {
          jsonErr(res, 400, vd);
          return;
        }
      }
      try {
        const id = db.insertTask(database, data);
        if (data.dueDate) {
          const t = db.readTaskById(database, id);
          if (t) autoPushTaskCaldav(t);
        }
        const assigneeIds = resolveUsernamesToIds(parseTaskAssigneeCsv(data.assignee));
        if (assigneeIds.length) {
          notifyTaskAssignees({ id, text: data.text, dueDate: data.dueDate }, assigneeIds, req.authUser);
        }
        broadcastSSE(res);
        jsonOk(res, { id });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const taskMatch = req.url.match(/^\/api\/tasks\/(\d+)$/);
  if (req.method === 'PATCH' && taskMatch) {
    const id = parseInt(taskMatch[1]);
    const isAdmin = req.authUser && req.authUser.role === 'admin';
    if (!db.canUserModifyTask(database, req.authUser && req.authUser.username, id, isAdmin)) {
      jsonErr(res, 403, 'You are not allowed to modify this task');
      return;
    }
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        const prevTask = db.readTaskById(database, id);
        const prevAssigneeIds = prevTask ? resolveUsernamesToIds(parseTaskAssigneeCsv(prevTask.assignee)) : [];
        db.updateTaskById(database, id, data);
        const t = db.readTaskById(database, id);
        if (t) autoPushTaskCaldav(t);
        if (Object.prototype.hasOwnProperty.call(data, 'assignee') && t) {
          const newIds = resolveUsernamesToIds(parseTaskAssigneeCsv(t.assignee));
          const prevSet = new Set(prevAssigneeIds);
          const added = newIds.filter((uid) => !prevSet.has(uid));
          if (added.length) notifyTaskAssignees(t, added, req.authUser);
        }
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'DELETE' && taskMatch) {
    const id = parseInt(taskMatch[1]);
    const isAdmin = req.authUser && req.authUser.role === 'admin';
    if (!db.canUserModifyTask(database, req.authUser && req.authUser.username, id, isAdmin)) {
      jsonErr(res, 403, 'You are not allowed to delete this task');
      return;
    }
    try {
      const task = db.readTaskById(database, id);
      db.deleteTaskById(database, id);
      try {
        autoDeleteTaskCaldav(task);
      } catch (ce) {
        log('warn', 'CalDAV cleanup failed after task delete', { taskId: id, error: ce.message });
      }
      broadcastSSE(res);
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- Team Members --
  if (req.method === 'POST' && req.url === '/api/team') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['name']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      const vt = validateTypes(data, { name: 'string', role: 'string' });
      if (vt) {
        jsonErr(res, 400, vt);
        return;
      }
      const vlen = validateLengths(data, { name: 100, role: 100 });
      if (vlen) {
        jsonErr(res, 400, vlen);
        return;
      }
      try {
        const id = db.insertMember(database, data);
        broadcastSSE(res);
        jsonOk(res, { id });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const teamMatch = req.url.match(/^\/api\/team\/(\d+)$/);
  if (req.method === 'DELETE' && teamMatch) {
    if (requireAdmin(req, res)) return;
    const id = parseInt(teamMatch[1]);
    try {
      db.deleteMember(database, id);
      broadcastSSE(res);
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- Assets --
  if (req.method === 'POST' && req.url === '/api/assets') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['assetId', 'name', 'category', 'entryDate', 'purchasePrice', 'usefulLife']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      const vt = validateTypes(data, { purchasePrice: 'number', usefulLife: 'number' });
      if (vt) {
        jsonErr(res, 400, vt);
        return;
      }
      // S-03: cap reduced from 100,000,000 to 1,000,000 to prevent
      // accidental fraud / fat-finger entries by workers without making
      // asset entry admin-only (matches the README role model).
      const vrng = validateRanges(data, {
        purchasePrice: { min: 0, max: 1000000 },
        usefulLife: { min: 1, max: 100 }
      });
      if (vrng) {
        jsonErr(res, 400, vrng);
        return;
      }
      const vlen = validateLengths(data, { assetId: 200, name: 500, category: 200, supplier: 500, notes: 10000 });
      if (vlen) {
        jsonErr(res, 400, vlen);
        return;
      }
      if (!/^[A-Za-z0-9_\-@.:]{1,200}$/.test(data.assetId)) {
        jsonErr(res, 400, 'assetId must be alphanumeric with - _ @ . : (max 200 chars)');
        return;
      }
      const ve = validateEnum(data.depreciationMethod, ['linear'], 'depreciationMethod');
      if (ve) {
        jsonErr(res, 400, ve);
        return;
      }
      let vd = validateDate(data.entryDate, 'entryDate');
      if (vd) {
        jsonErr(res, 400, vd);
        return;
      }
      if (data.exitDate) {
        vd = validateDate(data.exitDate, 'exitDate');
        if (vd) {
          jsonErr(res, 400, vd);
          return;
        }
      }
      try {
        const result = db.upsertAsset(database, data);
        broadcastSSE(res);
        jsonOk(res, { ok: true, barcode: result ? result.barcode : null });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const assetMatch = req.url.match(/^\/api\/assets\/([^/]+)$/);
  if (req.method === 'DELETE' && assetMatch) {
    if (requireAdmin(req, res)) return;
    const id = decodeURIComponent(assetMatch[1]);
    try {
      db.deleteAssetById(database, id);
      broadcastSSE(res);
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- Zones --
  if (req.method === 'POST' && req.url === '/api/zones') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['id', 'name', 'role', 'color']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      const vlen = validateLengths(data, { name: 50 });
      if (vlen) {
        jsonErr(res, 400, vlen);
        return;
      }
      if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(data.id)) {
        jsonErr(res, 400, 'Zone ID must be uppercase letters/digits/underscore, 1-20 chars');
        return;
      }
      const ve = validateEnum(data.role, ['spawn', 'incubation', 'fruiting', 'contaminated'], 'role');
      if (ve) {
        jsonErr(res, 400, ve);
        return;
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(data.color)) {
        jsonErr(res, 400, 'Invalid color');
        return;
      }
      if (data.racks && Array.isArray(data.racks)) {
        for (const r of data.racks) {
          if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(r)) {
            jsonErr(res, 400, 'Invalid rack ID: ' + r);
            return;
          }
        }
      }
      if (data.maxCapacity !== undefined && data.maxCapacity !== null) {
        data.maxCapacity = parseInt(data.maxCapacity, 10);
        if (!Number.isFinite(data.maxCapacity) || data.maxCapacity < 1) {
          jsonErr(res, 400, 'maxCapacity must be a positive integer');
          return;
        }
      }
      try {
        db.insertZone(database, data);
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/zones/reorder') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      if (!Array.isArray(data.order)) {
        jsonErr(res, 400, 'order must be an array of zone IDs');
        return;
      }
      try {
        db.reorderZones(database, data.order);
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const zoneMatch = req.url.match(/^\/api\/zones\/([^/]+)$/);
  if (req.method === 'DELETE' && zoneMatch) {
    if (requireAdmin(req, res)) return;
    const id = decodeURIComponent(zoneMatch[1]);
    if (!db.zoneExists(database, id)) {
      jsonErr(res, 404, 'Zone not found');
      return;
    }
    try {
      db.deleteZone(database, id);
      broadcastSSE(res);
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  // PATCH /api/zones/:id/name — rename zone display name only (ID unchanged)
  const zoneNameMatch = req.url.match(/^\/api\/zones\/([^/]+)\/name$/);
  if (req.method === 'PATCH' && zoneNameMatch) {
    if (requireAdmin(req, res)) return;
    const id = decodeURIComponent(zoneNameMatch[1]);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      if (!data.name || !data.name.trim()) {
        jsonErr(res, 400, 'name is required');
        return;
      }
      if (data.name.length > 50) {
        jsonErr(res, 400, 'Zone name too long (max 50 chars)');
        return;
      }
      try {
        db.renameZoneName(database, id, data.name);
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const zoneRackMatch = req.url.match(/^\/api\/zones\/([^/]+)\/racks$/);
  if (req.method === 'POST' && zoneRackMatch) {
    if (requireAdmin(req, res)) return;
    const zoneId = decodeURIComponent(zoneRackMatch[1]);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      if (!data.id || !/^[A-Z][A-Z0-9_]{0,29}$/.test(data.id)) {
        jsonErr(res, 400, 'Invalid rack ID');
        return;
      }
      if (!db.zoneExists(database, zoneId)) {
        jsonErr(res, 404, 'Zone not found');
        return;
      }
      try {
        db.insertRack(database, { id: data.id, zoneId, sortOrder: data.sortOrder || 0 });
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const rackMatch = req.url.match(/^\/api\/racks\/([^/]+)$/);
  if (req.method === 'DELETE' && rackMatch) {
    if (requireAdmin(req, res)) return;
    const id = decodeURIComponent(rackMatch[1]);
    try {
      db.deleteRack(database, id);
      broadcastSSE(res);
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- CalDAV Config --
  if (req.method === 'POST' && req.url === '/api/caldav/config') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        const wasBefore = db.readCaldavConfig(database);
        db.updateCaldavCfg(database, data);
        log('info', 'CalDAV config updated', { actor: req.authUser.username });
        // Trigger full sync when CalDAV is newly enabled
        if (data.enabled && !wasBefore.enabled) {
          try {
            autoSyncAllCaldav(readData());
            log('info', 'CalDAV initial sync triggered on enable');
          } catch (ce) {
            log('error', 'CalDAV initial sync failed', { error: ce.message });
          }
        }
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // -- Shipping (Versand / Phase 4) --
  // Config (provider keys + defaults) is admin-only; the secret is masked on GET
  // and preserved on PATCH when the field is left blank (mirrors DuckDNS).
  if (req.method === 'GET' && req.url === '/api/ship/config') {
    if (requireAdmin(req, res)) return;
    try {
      const cfg = db.getShippingConfig(database);
      jsonOk(res, {
        provider: cfg.provider,
        enabled: cfg.enabled,
        mode: cfg.mode,
        publicKey: cfg.publicKey,
        hasSecret: !!cfg.secretKey,
        senderAddressId: cfg.senderAddressId,
        defaultMethod: cfg.defaultMethod,
        defaultWeightG: cfg.defaultWeightG
      });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'PATCH' && req.url === '/api/ship/config') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        // Blank secret = keep the stored one (GET never reveals it).
        if (data.secretKey === '' || data.secretKey == null) delete data.secretKey;
        db.updateShippingConfig(database, data);
        broadcastSSE(res);
        const cfg = db.getShippingConfig(database);
        jsonOk(res, {
          provider: cfg.provider,
          enabled: cfg.enabled,
          mode: cfg.mode,
          publicKey: cfg.publicKey,
          hasSecret: !!cfg.secretKey,
          defaultMethod: cfg.defaultMethod,
          defaultWeightG: cfg.defaultWeightG
        });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/api/ship/test') {
    if (requireAdmin(req, res)) return;
    (async () => {
      try {
        const cfg = db.getShippingConfig(database);
        if (!cfg.publicKey || !cfg.secretKey) {
          jsonErr(res, 400, 'Keine API-Keys konfiguriert');
          return;
        }
        const r = await ship.getProvider(cfg).testConnection(cfg);
        jsonOk(res, r);
      } catch (err) {
        jsonErr(res, 502, err.message || 'connection failed');
      }
    })();
    return;
  }
  // GET /api/ship/methods?country=DE&weight=1000
  if (req.method === 'GET' && req.url.startsWith('/api/ship/methods')) {
    (async () => {
      try {
        const cfg = db.getShippingConfig(database);
        if (!cfg.publicKey || !cfg.secretKey) {
          jsonErr(res, 400, 'Versand nicht konfiguriert');
          return;
        }
        const q = new URL(req.url, 'http://x').searchParams;
        const toCountry = (q.get('country') || 'DE').toUpperCase();
        const weightG = parseInt(q.get('weight') || '', 10) || undefined;
        const methods = await ship.getProvider(cfg).listMethods(cfg, { toCountry, weightG });
        jsonOk(res, { methods });
      } catch (err) {
        jsonErr(res, 502, err.message || 'methods failed');
      }
    })();
    return;
  }
  // POST /api/ship/label { orderId, methodId, weightG, address:{...} } — buys a label.
  if (req.method === 'POST' && req.url === '/api/ship/label') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      (async () => {
        try {
          const cfg = db.getShippingConfig(database);
          if (!cfg.publicKey || !cfg.secretKey) {
            jsonErr(res, 400, 'Versand nicht konfiguriert');
            return;
          }
          const orderId = parseInt(data.orderId, 10);
          if (!orderId) {
            jsonErr(res, 400, 'orderId required');
            return;
          }
          if (!data.methodId) {
            jsonErr(res, 400, 'methodId required');
            return;
          }
          if (data.address && typeof data.address === 'object') {
            db.updateOrderShipAddress(database, orderId, data.address);
          }
          const order = db.getOrderForShipping(database, orderId);
          if (!order) {
            jsonErr(res, 404, 'order not found');
            return;
          }
          const weightG = parseInt(data.weightG, 10) || order.shipWeightG || cfg.defaultWeightG;
          const result = await ship.getProvider(cfg).buyLabel(cfg, { order, methodId: data.methodId, weightG });
          const id = db.insertShipment(database, {
            orderId,
            provider: cfg.provider,
            methodId: data.methodId,
            ...result
          });
          // Buying a label = the order is going out.
          try {
            database
              .prepare("UPDATE orders SET status='shipped', updated=? WHERE id=?")
              .run(new Date().toISOString(), orderId);
          } catch (e2) {
            /* status is best-effort */
          }
          broadcastSSE(res);
          jsonOk(res, { id, ...result });
        } catch (err) {
          jsonErr(res, 502, err.message || 'label failed');
        }
      })();
    });
    return;
  }
  // GET /api/ship/shipments?orderId=
  if (req.method === 'GET' && req.url.startsWith('/api/ship/shipments')) {
    try {
      const orderId = new URL(req.url, 'http://x').searchParams.get('orderId');
      const shipments = db.listShipments(database, orderId ? { orderId: parseInt(orderId, 10) } : {});
      jsonOk(res, { shipments });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  // GET /api/ship/label/:id/pdf — proxy the carrier label PDF (keeps API keys server-side).
  const shipPdfMatch = req.url.match(/^\/api\/ship\/label\/(\d+)\/pdf$/);
  if (req.method === 'GET' && shipPdfMatch) {
    (async () => {
      try {
        const cfg = db.getShippingConfig(database);
        const sh = db.getShipmentById(database, parseInt(shipPdfMatch[1], 10));
        if (!sh || !sh.labelUrl) {
          jsonErr(res, 404, 'label not found');
          return;
        }
        const buf = await ship.getProvider(cfg).fetchLabelPdf(cfg, sh.labelUrl);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="label-' + sh.id + '.pdf"'
        });
        res.end(buf);
      } catch (err) {
        jsonErr(res, 502, err.message || 'pdf failed');
      }
    })();
    return;
  }

  // -- DuckDNS Config --
  if (req.method === 'POST' && req.url === '/api/duckdns/config') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      if (data.domain && !/^[a-zA-Z0-9-]+$/.test(data.domain)) {
        jsonErr(res, 400, 'Domain must contain only letters, numbers, and hyphens');
        return;
      }
      if (data.token && !/^[a-f0-9-]+$/i.test(data.token)) {
        jsonErr(res, 400, 'Invalid DuckDNS token format');
        return;
      }
      try {
        if (!data.token) {
          const existing = db.getDuckdnsCfg(database);
          data.token = existing.token || '';
        }
        db.updateDuckdnsCfg(database, data);
        startDuckdnsUpdater();
        log('info', 'DuckDNS config updated', { actor: req.authUser.username });
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/api/duckdns/config') {
    if (requireAdmin(req, res)) return;
    try {
      const cfg = db.getDuckdnsCfg(database);
      cfg.hasToken = !!cfg.token;
      delete cfg.token;
      jsonOk(res, cfg);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/duckdns/update-ip') {
    if (requireAdmin(req, res)) return;
    updateDuckdnsIP((err) => {
      if (err) jsonErr(res, 500, err.message);
      else {
        const cfg = db.getDuckdnsCfg(database);
        jsonOk(res, { lastIp: cfg.lastIp, lastIpUpdate: cfg.lastIpUpdate });
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/duckdns/request-cert') {
    if (requireAdmin(req, res)) return;
    requestLetsEncryptCert((err, result) => {
      if (err) jsonErr(res, 500, err.message);
      else jsonOk(res, result);
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/api/duckdns/status') {
    if (requireAdmin(req, res)) return;
    try {
      const cfg = db.getDuckdnsCfg(database);
      let certInfo = { type: 'none', exists: false };
      try {
        if (fs.existsSync(CERT_CRT)) {
          const certPem = fs.readFileSync(CERT_CRT, 'utf8');
          const isLE =
            certPem.includes("Let's Encrypt") ||
            certPem.includes('R3') ||
            certPem.includes('R10') ||
            certPem.includes('R11');
          certInfo = { type: isLE ? 'letsencrypt' : 'self-signed', exists: true };
        }
      } catch (e) {
        /* ignore */
      }
      jsonOk(res, {
        enabled: cfg.enabled,
        domain: cfg.domain ? cfg.domain + '.duckdns.org' : null,
        lastIpUpdate: cfg.lastIpUpdate,
        lastIp: cfg.lastIp,
        leEnabled: cfg.leEnabled,
        leExpiry: cfg.leExpiry,
        cert: certInfo,
        updaterRunning: !!duckdnsInterval
      });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- MCP Config API --
  if (req.method === 'GET' && req.url === '/api/mcp/config') {
    if (requireAdmin(req, res)) return;
    try {
      const cfg = db.getMcpCfg(database);
      const host = req.headers.host || 'localhost:' + PORT;
      const connectorUrl = (protocol === 'https' ? 'https' : 'http') + '://' + host + '/mcp';
      jsonOk(res, { enabled: cfg.enabled, hasToken: cfg.hasToken, connectorUrl });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/mcp/config') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        db.updateMcpCfg(database, { enabled: !!data.enabled });
        log('info', 'MCP config updated', { actor: req.authUser.username, enabled: !!data.enabled });
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/mcp/generate-token') {
    if (requireAdmin(req, res)) return;
    try {
      const token = db.generateMcpToken(database);
      log('info', 'MCP API token generated', { actor: req.authUser.username });
      jsonOk(res, { token });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  // Revoke the static MCP API token. Soft-revoke: keeps the row+hash for
  // audit history (created_at, last_used_at) but flips revoked_at, which
  // causes db.getMcpToken to return '' so verifyMcpToken cannot match.
  // After this call /api/mcp/generate-token can mint a fresh token.
  if (req.method === 'DELETE' && req.url === '/api/mcp/token') {
    if (requireAdmin(req, res)) return;
    try {
      db.revokeMcpToken(database);
      log('info', 'MCP API token revoked', { actor: req.authUser.username });
      jsonOk(res, { ok: true });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'GET' && req.url === '/api/mcp/status') {
    if (requireAdmin(req, res)) return;
    try {
      const cfg = db.getMcpCfg(database);
      jsonOk(res, { enabled: cfg.enabled, hasToken: cfg.hasToken, activeSessions: mcpSessions.size });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- MCP Diagnostics --
  if (req.method === 'GET' && req.url === '/api/mcp/diagnostics') {
    if (requireAdmin(req, res)) return;
    try {
      const cfg = db.getMcpCfg(database);
      const base = getBaseUrl(req);
      const clients = db.listOAuthClients(database);
      const autoClients = clients.filter((c) => c.autoRegistered);
      const manualClients = clients.filter((c) => !c.autoRegistered);

      // Check TLS
      const hasTls = protocol === 'https';

      // Check discovery endpoints return correct data
      const prm = {
        resource: base + '/mcp',
        authorization_servers: [base],
        bearer_methods_supported: ['header'],
        scopes_supported: ['mcp:full']
      };
      const asm = {
        issuer: base,
        authorization_endpoint: base + '/oauth/authorize',
        token_endpoint: base + '/oauth/token',
        registration_endpoint: base + '/oauth/register'
      };

      const diag = {
        mcpEnabled: cfg.enabled,
        hasApiToken: cfg.hasToken,
        protocol,
        baseUrl: base,
        connectorUrl: base + '/mcp',
        tls: hasTls,
        tlsRequired: 'OAuth requires HTTPS — Claude Desktop will not connect over plain HTTP',
        oauthClients: { auto: autoClients.length, manual: manualClients.length },
        activeSessions: mcpSessions.size,
        protectedResourceMetadata: prm,
        authServerMetadata: asm,
        checks: {
          mcpEnabled: cfg.enabled ? 'PASS' : 'FAIL — enable MCP in settings',
          httpsActive: hasTls ? 'PASS' : 'FAIL — no TLS certificates found, OAuth requires HTTPS',
          registrationEndpoint: 'PASS — /oauth/register available',
          discoveryEndpoints:
            'PASS — /.well-known/oauth-protected-resource/mcp and /.well-known/oauth-authorization-server available'
        },
        hint: !hasTls
          ? "Claude Desktop requires HTTPS. Configure Let's Encrypt via DuckDNS or add TLS certificates."
          : autoClients.length === 0
            ? 'No auto-registered clients yet. Claude Desktop will auto-register when it connects. Make sure the connector URL is reachable from your machine.'
            : 'Server looks configured correctly. If Claude still fails, check: 1) DuckDNS domain resolves to this server, 2) Port is reachable, 3) No firewall blocking.'
      };
      jsonOk(res, diag);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- OAuth Client Management API --
  if (req.method === 'GET' && req.url === '/api/mcp/oauth-clients') {
    if (requireAdmin(req, res)) return;
    try {
      const clients = db.listOAuthClients(database);
      jsonOk(res, { clients });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'DELETE' && req.url.startsWith('/api/mcp/oauth-clients/')) {
    if (requireAdmin(req, res)) return;
    try {
      const clientId = decodeURIComponent(req.url.split('/').pop());
      const deleted = db.deleteOAuthClient(database, clientId);
      if (deleted === 0) {
        jsonErr(res, 404, 'client not found');
        return;
      }
      log('info', 'OAuth client deleted', { actor: req.authUser.username, clientId });
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- Server Restart --
  if (req.method === 'POST' && req.url === '/api/server/restart') {
    if (requireAdmin(req, res)) return;
    log('info', 'Server restart requested via web UI', { actor: req.authUser.username });
    jsonOk(res, { ok: true, message: 'Server is restarting...' });
    setTimeout(() => {
      const scriptDir = path.resolve(__dirname);
      if (process.platform === 'win32') {
        spawn('cmd.exe', ['/c', 'START.bat'], { cwd: scriptDir, detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('bash', ['update_server.sh'], { cwd: scriptDir, detached: true, stdio: 'ignore' }).unref();
      }
    }, 500);
    return;
  }

  // -- GitHub Webhook (auto-restart on push to main) --
  if (req.method === 'POST' && req.url === '/api/webhook/github') {
    // In worktree mode the auto-deploy chain would run `git fetch && git reset
    // --hard origin/main` in this worktree's directory and obliterate the
    // feature-branch commits a developer is iterating on. The webhook URL is
    // configured once per repo in GitHub, so this only fires here if the
    // worktree is reachable on the same hostname — but if someone tunnels in
    // for testing, the destructive reset is silent. Refuse it.
    if (WORKTREE_MODE) {
      jsonOk(res, { ok: true, msg: 'ignored: worktree mode' });
      return;
    }
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      jsonErr(res, 500, 'webhook secret not configured');
      return;
    }
    let raw = '';
    let whSize = 0;
    let whAborted = false;
    req.on('data', (c) => {
      whSize += c.length;
      if (whSize > MAX_BODY_SIZE) {
        // Cap the body before buffering — the HMAC check only runs on 'end',
        // so without this an unbounded payload could exhaust memory first.
        whAborted = true;
        jsonErr(res, 413, 'Payload too large');
        req.destroy();
        return;
      }
      raw += c;
    });
    req.on('end', () => {
      if (whAborted) return;
      // Defence in depth: any throw inside this async callback would otherwise
      // bubble to `uncaughtException` and terminate the process.
      try {
        const sig = req.headers['x-hub-signature-256'];
        if (!sig) {
          jsonErr(res, 401, 'missing signature');
          return;
        }
        const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
        // Length check first — timingSafeEqual throws RangeError on mismatched
        // byte lengths, and the attacker controls the X-Hub-Signature-256
        // header. Without this guard a single bad-length signature crashes
        // the server (S-02).
        const sigBuf = Buffer.from(sig);
        const expBuf = Buffer.from(expected);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
          log('warn', 'GitHub webhook signature mismatch');
          jsonErr(res, 401, 'bad signature');
          return;
        }
        const event = req.headers['x-github-event'];
        if (event === 'ping') {
          jsonOk(res, { ok: true, msg: 'pong' });
          return;
        }
        if (event !== 'push') {
          jsonOk(res, { ok: true, msg: 'ignored event: ' + event });
          return;
        }
        let body;
        try {
          body = JSON.parse(raw);
        } catch (_) {
          jsonErr(res, 400, 'bad json');
          return;
        }
        if (body.ref !== 'refs/heads/main') {
          jsonOk(res, { ok: true, msg: 'ignored ref: ' + body.ref });
          return;
        }
        log('info', 'GitHub webhook: push to main, restarting server', {
          sender: body.sender && body.sender.login
        });
        jsonOk(res, { ok: true, message: 'Restarting...' });
        setTimeout(() => {
          const scriptDir = path.resolve(__dirname);
          // R-14: write a deploy-state sentinel before spawning the chain.
          // The chain itself overwrites it with success/fail after each step
          // (or on the next attempt) so an admin can see what happened
          // without scraping logs. Failure is implied if a fresh attempt
          // overwrites without a prior `success`.
          // Defense-in-depth: even though the webhook is HMAC-verified, pin
          // the SHA to a strict hex whitelist before it ever reaches the
          // `bash -c "..."` interpolation below. If the GITHUB_WEBHOOK_SECRET
          // ever leaks, an attacker still cannot smuggle shell metacharacters
          // through `body.after`.
          const rawSha = body.after || (body.head_commit && body.head_commit.id) || '';
          const targetSha = /^[a-f0-9]{7,40}$/i.test(rawSha) ? rawSha.slice(0, 40) : 'unknown';
          const startedAt = new Date().toISOString();
          try {
            writeDeployState({
              status: 'in_progress',
              sha: targetSha,
              started: startedAt,
              sender: body.sender && body.sender.login
            });
          } catch (e) {
            log('warn', 'Could not write deploy-state sentinel', { error: e.message });
          }
          const stateFileEsc = DEPLOY_STATE_FILE;
          // Use a lightweight update script instead of interactive START.bat.
          // Sequence: git pull → npm install → pm2 restart. We append
          // success/failure JSON to the state file so the next /api/health
          // call can surface it.
          const successJson = JSON.stringify({
            status: 'success',
            sha: targetSha,
            started: startedAt
          }).replace(/"/g, '\\"');
          const failJson = JSON.stringify({
            status: 'failed',
            sha: targetSha,
            started: startedAt
          }).replace(/"/g, '\\"');
          const script =
            process.platform === 'win32'
              ? [
                  'cmd.exe',
                  [
                    '/c',
                    'cd /d "' +
                      scriptDir +
                      '" &&' +
                      ' git fetch origin && git reset --hard origin/main &&' +
                      ' npm install --omit=dev &&' +
                      ' (echo {"status":"success","sha":"' +
                      targetSha +
                      '","started":"' +
                      startedAt +
                      '","completed":"' +
                      // cmd has no native ISO date; the JSON is best-effort, the
                      // mtime of the file gives the actual completion time too.
                      '"} > "' +
                      stateFileEsc +
                      '") &&' +
                      ' pm2 restart ' +
                      PM2_PROCESS_NAME +
                      ' --update-env ||' +
                      ' (echo {"status":"failed","sha":"' +
                      targetSha +
                      '","started":"' +
                      startedAt +
                      '"} > "' +
                      stateFileEsc +
                      '")'
                  ]
                ]
              : [
                  'bash',
                  [
                    '-c',
                    'cd "' +
                      scriptDir +
                      '" && {' +
                      ' git fetch origin && git reset --hard origin/main &&' +
                      ' npm install --omit=dev; } && {' +
                      " printf '%s' \"" +
                      successJson.replace(/\\"/g, '\\\\"') +
                      '" > "' +
                      stateFileEsc +
                      '";' +
                      ' pm2 restart ' +
                      PM2_PROCESS_NAME +
                      ' --update-env;' +
                      " } || { printf '%s' \"" +
                      failJson.replace(/\\"/g, '\\\\"') +
                      '" > "' +
                      stateFileEsc +
                      '"; }'
                  ]
                ];
          const child = spawn(script[0], script[1], { cwd: scriptDir, detached: true, stdio: 'ignore' });
          child.unref();
        }, 500);
      } catch (err) {
        log('error', 'GitHub webhook handler crashed', { error: err.message });
        try {
          jsonErr(res, 500, 'internal');
        } catch (_) {
          /* response may already have been sent */
        }
      }
    });
    return;
  }

  // -- Notifications (per-user) --
  if (req.method === 'GET' && url === '/api/notifications') {
    try {
      const items = db.listNotifications(database, req.authUser.user_id);
      const unread = db.countUnreadNotifications(database, req.authUser.user_id);
      jsonOk(res, { items, unread });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'POST' && url === '/api/notifications/read') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        let changed;
        if (data && data.all === true) {
          changed = db.markNotificationsRead(database, req.authUser.user_id, null);
        } else if (data && Array.isArray(data.ids)) {
          const ids = data.ids.filter((n) => typeof n === 'number' && Number.isInteger(n));
          changed = db.markNotificationsRead(database, req.authUser.user_id, ids);
        } else {
          jsonErr(res, 400, 'body must be { all: true } or { ids: [int, ...] }');
          return;
        }
        broadcastSSE(res);
        jsonOk(res, { changed });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // -- Calendar Events --
  if (req.method === 'POST' && req.url === '/api/calendar-events') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['id', 'title', 'startDate']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      const vt = validateTypes(data, { id: 'string', title: 'string', startDate: 'string', description: 'string' });
      if (vt) {
        jsonErr(res, 400, vt);
        return;
      }
      const vlen = validateLengths(data, { id: 200, title: 500, description: 10000 });
      if (vlen) {
        jsonErr(res, 400, vlen);
        return;
      }
      if (!/^[A-Za-z0-9_\-@.:]{1,200}$/.test(data.id)) {
        jsonErr(res, 400, 'id must be alphanumeric with - _ @ . : (max 200 chars)');
        return;
      }
      let vd = validateDate(data.startDate, 'startDate');
      if (vd) {
        jsonErr(res, 400, vd);
        return;
      }
      if (data.endDate) {
        vd = validateDate(data.endDate, 'endDate');
        if (vd) {
          jsonErr(res, 400, vd);
          return;
        }
      }
      if (Array.isArray(data.assignees)) {
        for (const uid of data.assignees) {
          if (typeof uid !== 'number' || !Number.isInteger(uid)) {
            jsonErr(res, 400, 'assignees must be integer user IDs');
            return;
          }
        }
      }
      if (data.recurrence != null && !['weekly', 'monthly', 'daily', ''].includes(data.recurrence)) {
        jsonErr(res, 400, 'recurrence must be daily, weekly or monthly');
        return;
      }
      if (data.recurrenceUntil) {
        const vd = validateDate(data.recurrenceUntil, 'recurrenceUntil');
        if (vd) {
          jsonErr(res, 400, vd);
          return;
        }
      }
      if (data.teamAssignees != null && !Array.isArray(data.teamAssignees)) {
        jsonErr(res, 400, 'teamAssignees must be an array of names');
        return;
      }
      try {
        const assignees = deriveEffectiveAssignees(data);
        db.insertCalendarEvent(database, data, assignees);
        autoSyncCalendarEvent(data);
        if (assignees && assignees.length) {
          notifyCalendarAssignees(data, assignees, req.authUser);
        }
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const calEvMatch = req.url.split('?')[0].match(/^\/api\/calendar-events\/([^/]+)$/);
  if (req.method === 'PATCH' && calEvMatch) {
    const id = decodeURIComponent(calEvMatch[1]);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        // Atomically update the event row + refresh the assignees junction
        // table so the two can't drift apart on a mid-operation crash.
        const effectiveAssignees = deriveEffectiveAssignees(data);
        const prevAssignees = db.getCalendarEventAssignees(database, id);
        const applyUpdate = database.transaction(() => {
          db.updateCalendarEvent(database, id, data);
          if (effectiveAssignees) {
            db.setCalendarEventAssignees(database, id, effectiveAssignees);
          }
        });
        applyUpdate();
        let newlyAdded = null;
        if (effectiveAssignees) {
          const prevSet = new Set(prevAssignees);
          newlyAdded = effectiveAssignees.filter((uid) => !prevSet.has(uid));
        }
        const fullEv = db.getCalendarEventById(database, id);
        if (fullEv) autoSyncCalendarEvent(fullEv);
        if (newlyAdded && newlyAdded.length && fullEv) {
          notifyCalendarAssignees(fullEv, newlyAdded, req.authUser);
        }
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'DELETE' && calEvMatch) {
    if (requireAdmin(req, res)) return;
    const id = decodeURIComponent(calEvMatch[1]);
    try {
      const ev = db.getCalendarEventById(database, id);
      if (!ev) {
        jsonErr(res, 404, 'event not found');
        return;
      }
      // Optional ?occurrence=YYYY-MM-DD — when present and the event is recurring,
      // add an exception for just that date instead of deleting the series.
      const urlObj = new URL(req.url, 'http://x');
      const occurrence = urlObj.searchParams.get('occurrence');
      if (occurrence) {
        const vd = validateDate(occurrence, 'occurrence');
        if (vd) {
          jsonErr(res, 400, vd);
          return;
        }
        if (ev.recurrence) {
          db.addCalendarEventException(database, id, occurrence);
          broadcastSSE(res);
          jsonOk(res);
          return;
        }
      }
      db.deleteCalendarEvent(database, id);
      try {
        autoDeleteCalendarEventCaldav(id, ev && ev.caldav_uid);
      } catch (ce) {
        log('warn', 'CalDAV cleanup failed after event delete', { eventId: id, error: ce.message });
      }
      broadcastSSE(res);
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- Inventory Delta --
  if (req.method === 'POST' && req.url === '/api/inventory/delta') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['mat', 'deltaKg']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      const vt = validateTypes(data, { mat: 'string', deltaKg: 'number' });
      if (vt) {
        jsonErr(res, 400, vt);
        return;
      }
      const vrng = validateRanges(data, { deltaKg: { min: -100000, max: 100000 } });
      if (vrng) {
        jsonErr(res, 400, vrng);
        return;
      }
      try {
        // I-22: record the acting user on every inventory delta.
        const userId = req.authUser ? req.authUser.user_id : null;
        const val = db.applyInventoryDelta(
          database,
          data.mat,
          data.deltaKg,
          data.type || null,
          data.ref || null,
          userId
        );
        broadcastSSE(res);
        jsonOk(res, { value: val });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/inventory/set') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['mat', 'value']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      const vt = validateTypes(data, { mat: 'string', value: 'number' });
      if (vt) {
        jsonErr(res, 400, vt);
        return;
      }
      const vrng = validateRanges(data, { value: { min: 0, max: 1000000 } });
      if (vrng) {
        jsonErr(res, 400, vrng);
        return;
      }
      try {
        // I-22: record the acting user on absolute inventory sets too.
        const userId = req.authUser ? req.authUser.user_id : null;
        const val = db.setInventoryAbsolute(
          database,
          data.mat,
          data.value,
          data.type || null,
          data.ref || null,
          userId
        );
        broadcastSSE(res);
        jsonOk(res, { value: val });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/inventory/config') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        db.updateInventoryConfig(database, data.thresholds, data.avgComposition);
        log('info', 'Inventory config updated', { actor: req.authUser.username });
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // -- Lab Thresholds --
  if (req.method === 'POST' && req.url === '/api/lab-thresholds') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        db.updateLabThresholds(database, data.labThresholds);
        log('info', 'Lab thresholds updated', { actor: req.authUser.username });
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // -- Suppliers CRUD --
  if (req.method === 'GET' && req.url === '/api/suppliers') {
    try {
      jsonOk(res, db.listSuppliers(database));
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/suppliers') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      if (!data.mat || !data.name) {
        jsonErr(res, 400, 'mat and name required');
        return;
      }
      try {
        const id = db.upsertSupplier(database, data);
        broadcastSSE(res);
        jsonOk(res, { id });
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const supDelMatch = req.method === 'DELETE' && req.url.match(/^\/api\/suppliers\/(\d+)$/);
  if (supDelMatch) {
    if (requireAdmin(req, res)) return;
    try {
      db.deleteSupplier(database, parseInt(supDelMatch[1]));
      broadcastSSE(res);
      jsonOk(res, { ok: true });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // -- Backup Download (encrypted .db) --
  // S-04: format upgraded.
  //   v2 layout: magic(4) + version(1) + salt(32) + iv(12) + tag(16) + ciphertext
  //     - magic   = "MPLZ" (Meisterpilze)
  //     - version = 0x02
  //     - scrypt  = N=131072, r=8, p=4 (≈1s on a modern server)
  //     - no outer HMAC: GCM auth tag is already AEAD over salt+iv+ct
  //   Old format (no magic prefix) still decrypts via the legacy path on
  //   restore so existing .enc files keep working.
  if (req.method === 'POST' && req.url === '/api/backup/download') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      let tmpDest;
      try {
        if (!data || !data.password || data.password.length < 12) {
          jsonErr(res, 400, 'Password required (min 12 characters)');
          return;
        }
        // Create a fresh VACUUM INTO temp file for a consistent snapshot.
        // R-12: random suffix avoids collisions if two admins click download
        // in the same millisecond — Date.now() ms granularity is not enough.
        tmpDest = path.join(BACKUP_DIR, '_download_tmp_' + crypto.randomBytes(8).toString('hex') + '.db');
        db.backupDb(database, tmpDest);
        const plain = fs.readFileSync(tmpDest);
        try {
          fs.unlinkSync(tmpDest);
        } catch (e) {
          log('warn', 'Failed to clean backup temp file', { error: e.message });
        }
        tmpDest = null;
        const salt = crypto.randomBytes(32);
        const key = crypto.scryptSync(data.password, salt, 32, {
          N: 131072,
          r: 8,
          p: 4,
          maxmem: 256 * 1024 * 1024
        });
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
        const tag = cipher.getAuthTag();
        const magic = Buffer.from('MPLZ', 'ascii');
        const version = Buffer.from([0x02]);
        const out = Buffer.concat([magic, version, salt, iv, tag, enc]);
        const stamp = new Date().toISOString().slice(0, 10);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="' + BACKUP_PREFIX + stamp + '.enc"',
          'Content-Length': out.length
        });
        res.end(out);
        log('info', 'Backup downloaded', { actor: req.authUser.username, format: 'v2' });
      } catch (err) {
        if (tmpDest)
          try {
            fs.unlinkSync(tmpDest);
          } catch (e) {
            log('warn', 'Failed to clean backup temp after error', { error: e.message });
          }
        log('error', 'Backup download failed', { error: err.message });
        jsonErr(res, 500, 'Backup download failed');
      }
    });
    return;
  }

  // -- Backup Restore (encrypted .db) --
  if (req.method === 'POST' && req.url.startsWith('/api/backup/restore')) {
    if (requireAdmin(req, res)) return;
    // I-17: bail out early if another restore is in flight. Without this,
    // two admins racing on the close→rename→reopen sequence below could
    // corrupt the DB file or leave the process holding a stale handle.
    if (restoreInProgress) {
      jsonErr(res, 503, 'Another restore is in progress; please retry shortly.');
      return;
    }
    restoreInProgress = true;
    const chunks = [];
    let sz = 0;
    let aborted = false;
    let ended = false;
    const MAX_BACKUP = 50 * 1024 * 1024; // 50 MB limit for backup files
    // I-17b: if the client drops the connection mid-upload, 'end' never fires,
    // so neither the oversize branch nor the 'end' finally releases the mutex —
    // every later restore would 503 forever. Release it on close when the 'end'
    // handler never ran. (No-op once a restore has completed.)
    req.on('close', () => {
      if (!ended) restoreInProgress = false;
    });
    req.on('data', (c) => {
      sz += c.length;
      if (sz > MAX_BACKUP) {
        aborted = true;
        jsonErr(res, 413, 'Backup file too large');
        req.destroy();
        restoreInProgress = false;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      ended = true;
      if (aborted) {
        restoreInProgress = false;
        return;
      }
      let tmpPath;
      try {
        const raw = Buffer.concat(chunks);
        const password = req.headers['x-backup-password'] || '';
        if (!password) {
          jsonErr(res, 400, 'Password required');
          return;
        }
        // S-04: detect format by magic prefix.
        //   v2 (new): "MPLZ" + 0x02 + salt(32) + iv(12) + tag(16) + ct
        //   v1 (legacy): salt(32) + iv(12) + tag(16) + ct [+ hmac(32)]
        const MAGIC = Buffer.from('MPLZ', 'ascii');
        const isV2 = raw.length >= 5 && raw.subarray(0, 4).equals(MAGIC) && raw[4] === 0x02;
        let plain = null;
        if (isV2) {
          // v2: 4 (magic) + 1 (version) + 32 (salt) + 12 (iv) + 16 (tag) + ct
          if (raw.length < 4 + 1 + 32 + 12 + 16) {
            jsonErr(res, 400, 'File too small to be a valid backup');
            return;
          }
          const salt = raw.subarray(5, 37);
          const iv = raw.subarray(37, 49);
          const tag = raw.subarray(49, 65);
          const cipherText = raw.subarray(65);
          const key = crypto.scryptSync(password, salt, 32, {
            N: 131072,
            r: 8,
            p: 4,
            maxmem: 256 * 1024 * 1024
          });
          try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            plain = Buffer.concat([decipher.update(cipherText), decipher.final()]);
          } catch (_) {
            plain = null;
          }
        } else {
          // Legacy v1 path (no magic prefix) — kept verbatim so existing
          // backups still restore. tryDecrypt(true) handles backups that
          // include the redundant outer HMAC; tryDecrypt(false) handles
          // backups from before the HMAC was added.
          if (raw.length < 60 + 16) {
            jsonErr(res, 400, 'File too small to be a valid backup');
            return;
          }
          const salt = raw.subarray(0, 32);
          const iv = raw.subarray(32, 44);
          const key = crypto.scryptSync(password, salt, 32, {
            N: 32768,
            r: 8,
            p: 1,
            maxmem: 64 * 1024 * 1024
          });
          function tryDecrypt(withHmac) {
            const payload = withHmac ? raw.subarray(0, raw.length - 32) : raw;
            const pTag = payload.subarray(44, 60);
            const pCipher = payload.subarray(60);
            if (withHmac) {
              const storedHmac = raw.subarray(raw.length - 32);
              const expectedHmac = crypto.createHmac('sha256', key).update(payload).digest();
              if (!crypto.timingSafeEqual(storedHmac, expectedHmac)) return null;
            }
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(pTag);
            try {
              return Buffer.concat([decipher.update(pCipher), decipher.final()]);
            } catch (e) {
              return null;
            }
          }
          plain = tryDecrypt(true) || tryDecrypt(false);
        }
        if (!plain) {
          jsonErr(res, 401, 'Wrong password or corrupted file');
          return;
        }
        // Validate SQLite header
        if (plain.length < 16 || plain.toString('utf8', 0, 15) !== 'SQLite format 3') {
          jsonErr(res, 400, 'Decrypted file is not a valid database');
          return;
        }
        // Write to temp with restrictive permissions, validate schema.
        // Random suffix instead of Date.now() — predictable timestamps would
        // collide if two admins restored concurrently and the path-derived
        // race is benign but easy to remove (audit Section 3.3).
        tmpPath = path.join(BACKUP_DIR, '_restore_tmp_' + crypto.randomBytes(8).toString('hex') + '.db');
        fs.writeFileSync(tmpPath, plain, { mode: 0o600 });
        let tmpDb;
        try {
          tmpDb = db.openDb(tmpPath); // validates schema + runs migrations
          tmpDb.close();
        } catch (valErr) {
          try {
            fs.unlinkSync(tmpPath);
          } catch (e) {
            log('warn', 'Failed to clean temp after validation error', { error: e.message });
          }
          log('error', 'Backup validation failed', { error: valErr.message });
          jsonErr(res, 400, 'Database validation failed');
          return;
        }
        // Atomic swap: backup current db, replace, reopen — rollback on failure
        const bakPath = DB_FILE + '.pre-restore.bak';
        try {
          database.close();
        } catch (e) {
          log('warn', 'Failed to close database before restore', { error: e.message });
        }
        // Drop live MCP sessions — their captured DB handle is now closed and
        // every reopen path below rebinds `database` to a new handle.
        closeAllMcpSessions();
        try {
          fs.copyFileSync(DB_FILE, bakPath);
        } catch (e) {
          log('warn', 'Failed to create pre-restore backup', { error: e.message });
        } // keep old db as safety net
        try {
          fs.renameSync(tmpPath, DB_FILE);
        } catch (renameErr) {
          // The swap failed (e.g. Windows EBUSY/EPERM). The original DB_FILE is
          // untouched, but we already closed `database` above — reopen it so the
          // server keeps serving instead of throwing on every request against a
          // closed handle.
          log('error', 'Failed to swap in restored database, reopening original', { error: renameErr.message });
          try {
            database = db.openDb(DB_FILE);
          } catch (reErr) {
            log('error', 'Failed to reopen original database after swap failure', { error: reErr.message });
          }
          try {
            fs.unlinkSync(tmpPath);
          } catch (e) {
            log('warn', 'Failed to clean restore temp after swap failure', { error: e.message });
          }
          tmpPath = null;
          jsonErr(res, 500, 'Restore failed, previous data has been preserved');
          return;
        }
        tmpPath = null;
        try {
          database = db.openDb(DB_FILE);
        } catch (openErr) {
          // Rollback: restore the old database
          log('error', 'Failed to open restored database, rolling back', { error: openErr.message });
          try {
            fs.copyFileSync(bakPath, DB_FILE);
          } catch (e) {
            log('error', 'Rollback copy also failed', { error: e.message });
          }
          database = db.openDb(DB_FILE);
          jsonErr(res, 500, 'Restore failed, previous data has been preserved');
          return;
        }
        // Cleanup backup of old db
        try {
          fs.unlinkSync(bakPath);
        } catch (e) {
          log('warn', 'Failed to clean pre-restore backup', { error: e.message });
        }
        // Trigger auto-sync of CalDAV after restore
        try {
          autoSyncAllCaldav(readData());
        } catch (ce) {
          log('error', 'CalDAV post-restore sync failed', { error: ce.message });
        }
        log('info', 'Backup restored successfully', { actor: req.authUser.username });
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        if (tmpPath)
          try {
            fs.unlinkSync(tmpPath);
          } catch (e) {
            log('warn', 'Failed to clean restore temp after error', { error: e.message });
          }
        log('error', 'Backup restore failed', { error: err.message });
        jsonErr(res, 500, 'Backup restore failed');
      } finally {
        // I-17: always release the mutex, even on early returns (decryption
        // fail / rollback / unexpected throw).
        restoreInProgress = false;
      }
    });
    return;
  }

  // POST /api/print  —  body: { zpl: "^XA...^XZ" }
  if (req.method === 'POST' && req.url === '/api/print') {
    let body = '';
    let bodySize = 0;
    let aborted = false;
    req.on('data', (c) => {
      bodySize += c.length;
      if (bodySize > MAX_BODY_SIZE) {
        aborted = true;
        jsonErr(res, 413, 'Payload too large');
        req.destroy();
        return;
      }
      body += c;
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const { zpl } = JSON.parse(body);
        if (!zpl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"no zpl"}');
          return;
        }
        checkPrinterAvailable((_, found) => {
          if (!found) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'Printer not found. Please check that the Zebra printer is connected and powered on.'
              })
            );
            return;
          }
          printZPL(zpl, (err) => {
            if (err) {
              log('error', 'Print error', { error: err.message || err });
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end('{"ok":true,"labels":"printed"}');
            }
          });
        });
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"bad json"}');
      }
    });
    return;
  }

  // POST /api/caldav/sync — write all tasks to local calendar files
  // Reads all data from DB only — ignores request body to prevent client-supplied data injection
  if (req.method === 'POST' && req.url === '/api/caldav/sync') {
    try {
      const data = readData();
      const result = syncAllTasksLocal(data);
      writeData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      log('error', 'CalDAV sync error', { error: e.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // POST /api/caldav/push-one — write a single task to calendar file
  if (req.method === 'POST' && req.url === '/api/caldav/push-one') {
    let body = '';
    let bodySize = 0;
    let aborted = false;
    req.on('data', (c) => {
      bodySize += c.length;
      if (bodySize > MAX_BODY_SIZE) {
        aborted = true;
        jsonErr(res, 413, 'Payload too large');
        req.destroy();
        return;
      }
      body += c;
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const { task } = JSON.parse(body);
        const isPrivate = task.private === 1 || task.private === true;
        let uid;
        // Shared calendar: all non-private tasks
        if (!isPrivate) {
          uid = writeTaskToCalendar(task, 'meisterpilze');
        }
        // Personal calendar: if assigned
        if (task.assignee) {
          const slug = task.assignee.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          uid = writeTaskToCalendar(task, slug);
        }
        // Private + unassigned: no calendar to write to, just generate a UID
        if (!uid) {
          if (!task.caldavUid) task.caldavUid = generateUID();
          uid = task.caldavUid;
        }
        const synced = task.caldavSynced || new Date().toISOString();
        db.updateTaskCaldavUid(database, task.text, task.created, uid, synced);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, uid }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // POST /api/caldav/push-event — write a single custom event to calendar file
  if (req.method === 'POST' && req.url === '/api/caldav/push-event') {
    let body = '';
    let bodySize = 0;
    let aborted = false;
    req.on('data', (c) => {
      bodySize += c.length;
      if (bodySize > MAX_BODY_SIZE) {
        aborted = true;
        jsonErr(res, 413, 'Payload too large');
        req.destroy();
        return;
      }
      body += c;
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const { event } = JSON.parse(body);
        const { uid, ics } = customEventToVEVENT(event);
        writeIcsFile('meisterpilze', uid + '.ics', ics);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, uid }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // POST /api/caldav/push-batch — write a single batch due date to calendar file
  if (req.method === 'POST' && req.url === '/api/caldav/push-batch') {
    let body = '';
    let bodySize = 0;
    let aborted = false;
    req.on('data', (c) => {
      bodySize += c.length;
      if (bodySize > MAX_BODY_SIZE) {
        aborted = true;
        jsonErr(res, 413, 'Payload too large');
        req.destroy();
        return;
      }
      body += c;
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const { batch } = JSON.parse(body);
        const data = readData();
        const { uid, ics } = batchToVEVENT(batch, data.scanLog || []);
        writeIcsFile('faelligkeiten', uid + '.ics', ics);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, uid }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // GET /api/caldav/import — read external events from calendar files
  if (req.method === 'GET' && req.url === '/api/caldav/import') {
    try {
      const imported = [];
      // Determine which calendar directories the caller may see.
      // Shared category calendars are visible to everyone, the user's own
      // slug is always visible, and admins see everything.
      const isAdmin = req.authUser && req.authUser.role === 'admin';
      const callerSlug = req.authUser
        ? String(req.authUser.username)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
        : null;
      const canSeeDir = (dir) => {
        if (CALDAV_CATEGORY_CALS[dir]) return true;
        if (isAdmin) return true;
        return dir === callerSlug;
      };
      if (fs.existsSync(CAL_DIR)) {
        const dirs = fs
          .readdirSync(CAL_DIR)
          .filter((d) => fs.statSync(path.join(CAL_DIR, d)).isDirectory())
          .filter(canSeeDir);
        for (const dir of dirs) {
          const files = fs.readdirSync(path.join(CAL_DIR, dir)).filter((f) => f.endsWith('.ics'));
          for (const f of files) {
            try {
              const content = fs.readFileSync(path.join(CAL_DIR, dir, f), 'utf8');
              // Skip meistertracker-generated events
              if (content.includes('X-MEISTERPILZE-TYPE')) continue;
              if (!content.includes('VEVENT') && !content.includes('VTODO')) continue;
              const uid = (content.match(/UID:(.*)/) || [])[1]?.trim() || f;
              const summary = (content.match(/SUMMARY:(.*)/) || [])[1]?.trim() || '(kein Titel)';
              const dtRaw = (content.match(/DTSTART[^:]*:([\dT]+)/) || [])[1] || '';
              let date = '',
                startTime = null,
                allDay = true;
              if (dtRaw.length === 8) {
                date = dtRaw.slice(0, 4) + '-' + dtRaw.slice(4, 6) + '-' + dtRaw.slice(6, 8);
              } else if (dtRaw.length >= 15) {
                date = dtRaw.slice(0, 4) + '-' + dtRaw.slice(4, 6) + '-' + dtRaw.slice(6, 8);
                startTime = dtRaw.slice(9, 11) + ':' + dtRaw.slice(11, 13);
                allDay = false;
              }
              if (!date) continue;
              const dtEndRaw = (content.match(/DTEND[^:]*:([\dT]+)/) || [])[1] || '';
              let endTime = null;
              if (dtEndRaw.length >= 15) {
                endTime = dtEndRaw.slice(9, 11) + ':' + dtEndRaw.slice(11, 13);
              }
              const desc = (content.match(/DESCRIPTION:(.*)/) || [])[1]?.trim() || null;
              imported.push({
                uid,
                summary: summary.replace(/\\n/g, ' '),
                date,
                startTime,
                endTime,
                allDay,
                description: desc,
                calendar: dir
              });
            } catch (e) {
              /* skip broken files */
            }
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(imported));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // GET /api/printer-status — returns rich state plus legacy `found` boolean
  if (req.method === 'GET' && req.url === '/api/printer-status') {
    getPrinterStatus((err, status) => {
      const out = status || { state: 'unknown', name: PRINTER_NAME, online: false };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...out, found: out.state === 'online' }));
    });
    return;
  }

  // GET /api/printer/config — admin: full printer + bridge config for the
  // Settings → Drucker tab. Token is masked; only hasToken is exposed.
  if (req.method === 'GET' && req.url === '/api/printer/config') {
    if (requireAdmin(req, res)) return;
    try {
      const dbCfg = db.getPrintBridgeCfg(database);
      const effective = getEffectiveBridgeConfig();
      jsonOk(res, {
        platform: process.platform,
        printerName: PRINTER_NAME,
        bridge: {
          enabled: dbCfg.enabled,
          url: dbCfg.url,
          hasToken: !!dbCfg.token,
          envUrl: PRINT_BRIDGE_URL_ENV || null,
          envHasToken: !!PRINT_BRIDGE_TOKEN_ENV,
          effectiveUrl: effective ? effective.url : null,
          effectiveSource: effective ? effective.source : null
        }
      });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  // POST /api/printer/config — admin: save bridge config to DB.
  if (req.method === 'POST' && req.url === '/api/printer/config') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        const url = (data.url || '').trim();
        if (data.enabled && !url) {
          jsonErr(res, 400, 'URL required when enabled');
          return;
        }
        // Require https:// — the bridge installer (print-bridge.ps1 -Install)
        // sets up a self-signed TLS cert on the Windows side automatically.
        // Plain http:// is rejected so users don't accidentally send tokens
        // and label data in cleartext over the LAN.
        if (url && !/^https:\/\//i.test(url)) {
          jsonErr(res, 400, 'Bridge URL must start with https:// (the installer sets up TLS)');
          return;
        }
        db.updatePrintBridgeCfg(database, {
          enabled: !!data.enabled,
          url,
          token: data.token || ''
        });
        log('info', 'Print bridge config updated', {
          actor: req.authUser.username,
          enabled: !!data.enabled,
          url,
          hasToken: !!data.token
        });
        // Invalidate the printer-status cache so the UI sees the new state
        // immediately.
        _printerStatusCache = null;
        _printerQueueStuckCache = 0;
        _printerStatusCacheTime = 0;
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }

  // POST /api/printer/test — admin: send a small test ZPL through the
  // current effective config. Same code path as a real label print, so a
  // success here means the next real print will also succeed.
  if (req.method === 'POST' && req.url === '/api/printer/test') {
    if (requireAdmin(req, res)) return;
    const testZpl =
      '^XA\n' +
      '^FO50,40^A0N,30,30^FDMeisterTracker^FS\n' +
      '^FO50,80^A0N,22,22^FDPrint bridge test^FS\n' +
      '^FO50,120^A0N,18,18^FD' +
      new Date().toISOString().replace('T', ' ').slice(0, 19) +
      '^FS\n' +
      '^XZ';
    printZPL(testZpl, (err) => {
      if (err) {
        log('warn', 'Print bridge test failed', { error: err, actor: req.authUser && req.authUser.username });
        jsonErr(res, 502, err);
      } else {
        jsonOk(res);
      }
    });
    return;
  }

  // GET /api/printer/bridge-script — admin: download the print-bridge.ps1 file
  // bundled with this deployment, so the user does not have to fetch it from
  // GitHub manually. Same source on both platforms (path.join makes it
  // portable). Always serves the version that ships with the running server,
  // so the bridge stays in sync with the server's protocol.
  if (req.method === 'GET' && req.url === '/api/printer/bridge-script') {
    if (requireAdmin(req, res)) return;
    const scriptPath = path.join(DIR, 'scripts', 'print-bridge.ps1');
    fs.readFile(scriptPath, 'utf8', (err, content) => {
      if (err) {
        log('error', 'Bridge script read failed', { error: err.message, path: scriptPath });
        jsonErr(res, 404, 'Bridge script not found in deployment');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="print-bridge.ps1"',
        'Content-Length': Buffer.byteLength(content, 'utf8'),
        'Cache-Control': 'no-store'
      });
      res.end(content);
    });
    return;
  }

  // ── Camera dashboard (admin-only WIP) ─────────────────────────────────────
  // Surfaces the data that the Python `mushroom_camera` module writes into
  // `camera_*` SQLite tables, plus admin-editable calibration values used by
  // that module. The Python module currently reads its calibration from env
  // vars; storing them here is a forward-compatible step so the dashboard can
  // become the source of truth without restarting the camera service.
  if (req.method === 'GET' && req.url === '/api/camera/dashboard') {
    if (requireAdmin(req, res)) return;
    try {
      jsonOk(res, {
        stats: db.getCameraDashboardStats(database),
        cameras: db.listCameras(database),
        flags: db.listOpenCameraFlags(database),
        calibration: db.getCameraCalibration(database),
        recentMeasurements: db.listRecentCameraMeasurements(database, 25)
      });
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/camera/cameras') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        const id = db.insertCamera(database, {
          name: data.name,
          rtspUrl: data.rtspUrl,
          zoneId: data.zoneId,
          enabled: data.enabled !== false
        });
        log('info', 'Camera added', { actor: req.authUser.username, id, name: data.name });
        jsonOk(res, { id });
      } catch (err) {
        jsonErr(res, 400, err.message);
      }
    });
    return;
  }

  const camMatch = req.url.match(/^\/api\/camera\/cameras\/(\d+)$/);
  if (camMatch && req.method === 'PUT') {
    if (requireAdmin(req, res)) return;
    const id = parseInt(camMatch[1], 10);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        db.updateCamera(database, id, data);
        log('info', 'Camera updated', { actor: req.authUser.username, id });
        jsonOk(res);
      } catch (err) {
        jsonErr(res, 400, err.message);
      }
    });
    return;
  }
  if (camMatch && req.method === 'DELETE') {
    if (requireAdmin(req, res)) return;
    const id = parseInt(camMatch[1], 10);
    try {
      db.deleteCamera(database, id);
      log('info', 'Camera deleted', { actor: req.authUser.username, id });
      jsonOk(res);
    } catch (err) {
      safeErr(res, err);
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/camera/calibration') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        db.updateCameraCalibration(database, data || {});
        log('info', 'Camera calibration updated', { actor: req.authUser.username });
        jsonOk(res, db.getCameraCalibration(database));
      } catch (err) {
        jsonErr(res, 400, err.message);
      }
    });
    return;
  }

  const flagMatch = req.url.match(/^\/api\/camera\/flags\/(harvest|fruiting)\/(\d+)\/resolve$/);
  if (flagMatch && req.method === 'POST') {
    if (requireAdmin(req, res)) return;
    try {
      db.resolveCameraFlag(database, flagMatch[1], parseInt(flagMatch[2], 10));
      jsonOk(res);
    } catch (err) {
      jsonErr(res, 400, err.message);
    }
    return;
  }

  // Static files
  let filePath;
  if (url === '/' || url === '/index.html') filePath = path.join(DIR, 'index.html');
  else if (url === '/login.html') filePath = path.join(DIR, 'login.html');
  else if (url === '/login.js') filePath = path.join(DIR, 'login.js');
  else if (url === '/styles.css') filePath = path.join(DIR, 'styles.css');
  else if (url === '/app.js') filePath = path.join(DIR, 'app.js');
  else if (url === '/sw.js') filePath = path.join(DIR, 'sw.js');
  else if (url === '/manifest.json') filePath = path.join(DIR, 'manifest.json');
  else if (url.startsWith('/lib/')) filePath = path.join(DIR, 'lib', path.basename(url));
  else if (url.startsWith('/lang/') && /^\/lang\/[a-zA-Z-]+\.js$/.test(url))
    filePath = path.join(DIR, 'lang', path.basename(url));
  else if (url.match(/^\/(icon-\d+\.png|favicon\.ico|icon\.svg)$/)) filePath = path.join(DIR, url.slice(1));
  else {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  // Path traversal protection — ensure resolved path stays within project dir
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(DIR))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  // P-01: serve pre-compressed variant when client accepts it. Skip images
  // (already compressed) and any extension we didn't precompute (e.g. .ico).
  const acceptEncoding = req.headers['accept-encoding'];
  const compressible = COMPRESSIBLE_EXT.has(ext);
  const picked = compressible ? pickEncoding(acceptEncoding, filePath) : null;
  const sendPath = picked ? picked.path : filePath;

  fs.readFile(sendPath, (err, data) => {
    if (err) {
      // Compressed file disappeared mid-flight — fall back to raw
      if (picked) {
        fs.readFile(filePath, (err2, raw) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          writeStaticResponse(res, raw, filePath, ext, url, null);
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    writeStaticResponse(res, data, filePath, ext, url, picked && picked.encoding);
  });
}

function writeStaticResponse(res, data, filePath, ext, url, encoding) {
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  // Cache immutable vendor libs and per-locale lang files aggressively;
  // cache HTML/CSS/SW short-term.
  if (WORKTREE_MODE) {
    // Test/worktree instance: never cache static assets, so code changes show
    // up on a plain reload without service-worker / HTTP-cache gymnastics.
    headers['Cache-Control'] = 'no-store';
  } else if (url === '/sw.js') {
    // The service worker is the killswitch path — must always revalidate
    // so a bad SW build can be rolled back within one navigation rather
    // than waiting up to 5 min + the browser's own 24 h SW-bypass cache.
    headers['Cache-Control'] = 'no-cache';
  } else if (url.startsWith('/lib/') || url.startsWith('/lang/')) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  } else if (ext === '.png' || ext === '.ico' || ext === '.svg') {
    headers['Cache-Control'] = 'public, max-age=86400';
  } else if (ext === '.css' || ext === '.js') {
    headers['Cache-Control'] = 'public, max-age=300';
  } else {
    headers['Cache-Control'] = 'no-cache';
  }
  // Vary on Accept-Encoding so caches don't mix gzip / br / raw responses.
  if (COMPRESSIBLE_EXT.has(ext)) {
    headers['Vary'] = 'Accept-Encoding';
  }
  if (encoding) {
    headers['Content-Encoding'] = encoding;
  }
  res.writeHead(200, headers);
  res.end(data);
}

// ── TLS HOT-RELOAD ──────────────────────────────────────────
function reloadTlsCerts() {
  if (protocol !== 'https' || !server) return;
  try {
    const newKey = fs.readFileSync(CERT_KEY);
    const newCert = fs.readFileSync(CERT_CRT);
    server.setSecureContext({ key: newKey, cert: newCert });
    log('info', 'TLS certificates reloaded');
  } catch (e) {
    log('error', 'Failed to reload TLS certificates', { error: e.message });
  }
}

// P-01: pre-compress static assets at startup (gzip + brotli) so each
// request just streams cached bytes — no per-request CPU spent on zlib.
try {
  precompressStaticAssets();
  log('info', 'Static asset precompression complete');
} catch (e) {
  log('warn', 'Static asset precompression failed', { error: e.message });
}

// ── SERVER CREATION (HTTPS with HTTP→HTTPS redirect, HTTP fallback if no certs) ──
let server; // HTTPS (or plain HTTP in fallback) — keeps setSecureContext working for cert hot-reload
let listenServer; // The listener actually bound to PORT — a TCP mux in HTTPS mode, else === server
let legacyRedirectServer; // Port-80 redirect server (HTTPS mode only)
if (fs.existsSync(CERT_KEY) && fs.existsSync(CERT_CRT)) {
  const tlsOpts = { key: fs.readFileSync(CERT_KEY), cert: fs.readFileSync(CERT_CRT), minVersion: 'TLSv1.2' };
  server = https.createServer(tlsOpts, handleRequest);
  protocol = 'https';

  // Same-port HTTP handler: any plain-HTTP request arriving on PORT is 301-redirected to its HTTPS equivalent.
  // This is what makes `http://host:3000` automatically upgrade to `https://host:3000` in a browser.
  const samePortRedirect = http.createServer((req, res) => {
    const host = (req.headers.host || 'localhost').replace(/:.*$/, '');
    const target = 'https://' + host + (PORT === 443 ? '' : ':' + PORT) + req.url;
    res.writeHead(301, { Location: target });
    res.end();
  });

  // TCP multiplexer: sniff the first byte of each connection.
  // 0x16 = TLS ClientHello record type → forward to the HTTPS server.
  // Anything else → forward to the plain-HTTP redirect server.
  // This lets PORT accept both HTTP and HTTPS so users who type `http://` don't hit a broken TLS handshake.
  listenServer = net.createServer((socket) => {
    socket.once('data', (buf) => {
      socket.pause();
      socket.unshift(buf);
      const target = buf[0] === 0x16 ? server : samePortRedirect;
      target.emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
    socket.on('error', () => {});
  });

  // Legacy redirect on port 80 so users who type `http://host` (no port) still get forwarded to HTTPS.
  legacyRedirectServer = http.createServer((req, res) => {
    const host = (req.headers.host || '').replace(/:.*$/, '');
    // Allow localhost HTTP for local development
    if (host === 'localhost' || host === '127.0.0.1') {
      handleRequest(req, res);
      return;
    }
    const target = 'https://' + host + (PORT === 443 ? '' : ':' + PORT) + req.url;
    res.writeHead(301, { Location: target });
    res.end();
  });
  const HTTP_REDIRECT_PORT = parseInt(process.env.HTTP_REDIRECT_PORT, 10) || 80;
  legacyRedirectServer
    .listen(HTTP_REDIRECT_PORT, '0.0.0.0', () => {
      log('info', 'HTTP→HTTPS redirect active on port ' + HTTP_REDIRECT_PORT);
    })
    .on('error', (e) => {
      if (e.code === 'EACCES' || e.code === 'EADDRINUSE') {
        log(
          'warn',
          'Could not start HTTP redirect on port ' + HTTP_REDIRECT_PORT + ' (' + e.code + ') — HTTPS-only mode'
        );
      }
    });
} else {
  log('warn', 'TLS certificates not found — falling back to HTTP. Run: bash gen-cert.sh');
  server = http.createServer(handleRequest);
  protocol = 'http';
  listenServer = server;
}

listenServer.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('  Meistertracker is running!');
  console.log('');
  console.log('  Open on this PC:      ' + protocol + '://localhost:' + PORT);
  console.log('  Open on phone/tablet: ' + protocol + '://' + ip + ':' + PORT);
  if (protocol === 'http') {
    console.log('');
    console.log('  ⚠ WARNING: Running without HTTPS — iOS camera will not work.');
    console.log('  Run "bash gen-cert.sh" and restart to enable HTTPS.');
  }
  console.log('');
  console.log('  CalDAV server:        ' + protocol + '://' + ip + ':' + PORT + '/caldav/calendars/');
  console.log('');
  console.log('  Printer: ' + PRINTER_NAME);
  console.log('  Printing via Windows spooler — works from any browser.');
  console.log('');
  console.log('  Data saved to: ' + DB_FILE);
  console.log('  Press Ctrl+C to stop.');

  // Auto-sync CalDAV on startup if enabled
  try {
    const cfg = db.readCaldavConfig(database);
    if (cfg.enabled) {
      log('info', 'CalDAV sync enabled — running initial sync...');
      autoSyncAllCaldav(readData());
      log('info', 'CalDAV initial sync complete');
    }
  } catch (e) {
    log('error', 'CalDAV startup sync failed', { error: e.message });
  }
});

// ── GRACEFUL SHUTDOWN ────────────────────────────────────────
function shutdown(signal) {
  log('info', 'Received ' + signal + ', shutting down...');
  // End all long-lived SSE responses first. server.close() waits for open
  // connections to finish, but SSE streams never finish on their own
  // (heartbeats keep them active), so without this the close callbacks never
  // fire and every shutdown hits the 5 s force-exit(1) — making PM2/systemd
  // treat each routine stop as a failed shutdown.
  for (const c of sseClients) {
    try {
      c.end();
    } catch (e) {
      /* ignore */
    }
  }
  sseClients.clear();
  const servers = [listenServer];
  if (listenServer !== server) servers.push(server);
  if (legacyRedirectServer) servers.push(legacyRedirectServer);
  let remaining = servers.length;
  servers.forEach((s) => {
    s.close(() => {
      if (--remaining === 0) {
        database.close();
        log('info', 'Server closed');
        process.exit(0);
      }
    });
  });
  setTimeout(() => {
    database.close();
    process.exit(1);
  }, 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// R-07: warn-only on both uncaughtException and unhandledRejection.
// Rationale: uncaught exceptions in async paths are usually narrow correctness
// bugs (e.g. malformed user input that escaped validation), and crash-looping
// the whole server amplifies the damage. PM2 still catches genuinely fatal
// errors (segfaults, OOM) via process exit codes — those bypass this handler.
// SIGTERM/SIGINT keep their graceful-shutdown behaviour above.
process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception (continuing)', {
    error: err.message,
    stack: err.stack
  });
});

process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});
