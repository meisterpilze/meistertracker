const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const db = require('./db.js');
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
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5 MB max request body
const SESSION_TTL_SECONDS = db.SESSION_TTL_MS / 1000; // keep in sync with db.js
const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

function getClientIP(req) {
  const fwd = TRUST_PROXY ? req.headers['x-forwarded-for'] : null;
  return (fwd ? fwd.split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

let database = db.openDb(DB_FILE);
let protocol = 'http'; // set to 'https' at startup if TLS certs are found
if (!fs.existsSync(CAL_DIR)) fs.mkdirSync(CAL_DIR);

// ── MCP (Model Context Protocol) server ────────────────────
// Each session gets its own McpServer + transport (SDK requires one server per transport).
const mcpSessions = new Map(); // sessionId → { transport, server, lastActive }
const MCP_SESSION_TTL = 30 * 60 * 1000; // 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of mcpSessions) {
    if (now - s.lastActive > MCP_SESSION_TTL) {
      s.server.close().catch(() => {});
      mcpSessions.delete(sid);
    }
  }
}, 5 * 60 * 1000); // check every 5 minutes

function checkMcpAuth(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  const hash = crypto.createHash('sha256').update(token).digest('hex');

  // Try legacy static API token
  const stored = db.getMcpToken(database);
  if (stored && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(stored))) {
    return true;
  }

  // Try OAuth access token
  const oauthToken = db.getOAuthAccessToken(database, hash);
  if (oauthToken) return true;

  return false;
}

// Simple sliding-window rate limiter for MCP endpoint (60 requests/minute)
const MCP_RATE_LIMIT = 60;
const MCP_RATE_WINDOW = 60 * 1000;
const mcpRateMap = new Map(); // ip → { timestamps[] }
function checkMcpRate(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = mcpRateMap.get(ip);
  if (!bucket) { bucket = { timestamps: [] }; mcpRateMap.set(ip, bucket); }
  bucket.timestamps = bucket.timestamps.filter(ts => now - ts < MCP_RATE_WINDOW);
  if (bucket.timestamps.length >= MCP_RATE_LIMIT) return false;
  bucket.timestamps.push(now);
  return true;
}

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
    try {
      cb(null, JSON.parse(body));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"bad json"}');
    }
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
    try {
      const params = new URLSearchParams(body);
      cb(null, Object.fromEntries(params.entries()));
    } catch (e) {
      jsonErr(res, 400, 'bad form data');
    }
  });
}

function verifyPkce(codeVerifier, storedCodeChallenge) {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url') === storedCodeChallenge;
}

function getBaseUrl(req) {
  const host = req.headers.host || 'localhost:' + PORT;
  return protocol + '://' + host;
}

function jsonOk(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data || { ok: true }));
}
function jsonErr(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}
// Safe error response: log internals, send generic message to client for unexpected errors
function safeErr(res, err) {
  const msg = err.message || '';
  // Known validation errors from db.js are safe to expose
  const safe = /required|invalid|must be|not found|already|duplicate|too short|too long|cannot|constraint/i.test(msg);
  if (safe) {
    jsonErr(res, 400, msg);
  } else {
    log('error', 'Unexpected error', { error: msg, stack: err.stack });
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
// Validate enum membership
function validateEnum(value, allowed, fieldName) {
  if (value === undefined || value === null) return null;
  if (!allowed.includes(value)) return fieldName + ' must be one of: ' + allowed.join(', ');
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

// ── AUTH HELPERS ─────────────────────────────────────────────
function getSessionToken(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/(?:^|;\s*)session=([a-f0-9]+)/);
  return match ? match[1] : null;
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
  res.setHeader('Set-Cookie', 'session=' + token + '; ' + cookieFlags() + ' Max-Age=' + SESSION_TTL_SECONDS);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; ' + cookieFlags() + ' Max-Age=0');
}

// Clean expired sessions + OAuth data on startup and hourly
db.deleteExpiredSessions(database);
db.deleteExpiredOAuthData(database);
setInterval(() => {
  db.deleteExpiredSessions(database);
  db.deleteExpiredOAuthData(database);
}, 60 * 60 * 1000);

// ── DAILY AUTO-BACKUP ────────────────────────────────────────
// Every day at 00:00 writes a dated backup to /backups/
const BACKUP_DIR = path.join(DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { mode: 0o700 });
// Clean up orphaned temp files from interrupted backup operations
try {
  fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('_'))
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

function runDailyBackup() {
  try {
    const d = new Date();
    const stamp =
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const dest = path.join(BACKUP_DIR, 'meisterpilze_backup_' + stamp + '.db');
    if (!fs.existsSync(dest)) {
      db.backupDb(database, dest)
        .then(() => {
          log('info', 'Auto-backup saved', { path: dest });
          // Keep last 30 daily backups
          const files = fs
            .readdirSync(BACKUP_DIR)
            .filter((f) => f.endsWith('.db'))
            .sort();
          if (files.length > 30) {
            files.slice(0, files.length - 30).forEach((f) => {
              fs.unlinkSync(path.join(BACKUP_DIR, f));
              log('info', 'Old backup removed', { file: f });
            });
          }
        })
        .catch((e) => log('error', 'Auto-backup failed', { error: e.message }));
    }
  } catch (e) {
    log('error', 'Auto-backup failed', { error: e.message });
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

  https
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
}

function startDuckdnsUpdater() {
  if (duckdnsInterval) {
    clearInterval(duckdnsInterval);
    duckdnsInterval = null;
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
        } catch (_) {} // eslint-disable-line no-empty
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
  https
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
}

function clearDuckdnsTxt(domain, token) {
  const url =
    'https://www.duckdns.org/update?domains=' +
    encodeURIComponent(domain) +
    '&token=' +
    encodeURIComponent(token) +
    '&txt=&clear=true&verbose=true';
  https.get(url, () => {}).on('error', () => {});
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

// Send raw ZPL to the GK420d via Windows
function printZPL(zplData, callback) {
  const tmp = path.join(os.tmpdir(), 'mp_label_' + Date.now() + '.zpl');
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

    const psTmp = path.join(os.tmpdir(), 'mp_print_' + Date.now() + '.ps1');
    fs.writeFile(psTmp, ps, 'utf8', (err2) => {
      if (err2) {
        fs.unlink(tmp, () => {});
        return callback('Could not write PS script: ' + err2.message);
      }

      execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psTmp], (e, stdout, stderr) => {
        fs.unlink(tmp, () => {});
        fs.unlink(psTmp, () => {});
        if (e) {
          log('error', 'PowerShell print error', { error: stderr || e.message });
          callback('Print failed: ' + (stderr || e.message).trim());
        } else {
          log('info', 'Print OK', { output: stdout.trim() });
          callback(null);
        }
      });
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

// Sanitize URL path parts to prevent directory traversal attacks
function sanitizePart(s) {
  const clean = path.basename(s);
  if (!clean || clean === '.' || clean === '..') return null;
  return clean;
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

// Check CalDAV basic auth against user accounts
function checkCaldavAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Basic ')) return false;
  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  const account = db.getUserByUsername(database, user);
  if (!account) return false;
  if (!db.verifyPassword(account.hash, account.salt, pass)) return false;
  return account; // Return user object so handler knows who is authenticated
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
    'SUMMARY:' + escapeIcsText(task.text || '')
  ];
  if (task.dueDate) {
    const d = new Date(task.dueDate).toISOString().replace(/[-:]/g, '').split('T')[0];
    lines.push('DUE;VALUE=DATE:' + d);
  }
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

// Convert a batch to VEVENT .ics content (all-day event for due date)
function batchToVEVENT(batch, scanLog) {
  const uid = 'batch-' + batch.batchId + '@meisterpilze';
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const dueDate = new Date(batch.due).toISOString().replace(/[-:]/g, '').split('T')[0];
  // DTEND is next day for all-day events per RFC 5545
  const endDate = new Date(new Date(batch.due).getTime() + 86400000).toISOString().replace(/[-:]/g, '').split('T')[0];
  const loc = scanLog ? getBatchLocServer(batch, scanLog) : '';
  const summary = escapeIcsText(batch.batchId + (loc ? ' — ' + loc : ''));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meisterpilze Lab Tracker//EN',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + now,
    'DTSTART;VALUE=DATE:' + dueDate,
    'DTEND;VALUE=DATE:' + endDate,
    'SUMMARY:' + summary,
    'CATEGORIES:Fälligkeiten'
  ];
  if (loc) lines.push('LOCATION:' + escapeIcsText(loc));
  lines.push(
    'DESCRIPTION:' + escapeIcsText((batch.species || '') + (batch.strain ? ' (' + batch.strain + ')' : '')),
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
  const endDate = new Date(new Date(task.dueDate).getTime() + 86400000)
    .toISOString()
    .replace(/[-:]/g, '')
    .split('T')[0];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meisterpilze Lab Tracker//EN',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + now,
    'DTSTART;VALUE=DATE:' + dueDate,
    'DTEND;VALUE=DATE:' + endDate,
    'SUMMARY:' + escapeIcsText(task.text || ''),
    'CATEGORIES:Aufgaben',
    'STATUS:' + (task.done ? 'CANCELLED' : 'CONFIRMED'),
    'TRANSP:TRANSPARENT',
    'X-MEISTERPILZE-TYPE:task-due',
    'COLOR:#3b82f6',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
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
    const st = (event.startTime || '09:00').replace(':', '') + '00';
    const et = (event.endTime || '10:00').replace(':', '') + '00';
    dtstart = 'DTSTART;TZID=Europe/Berlin:' + d + 'T' + st;
    dtend = 'DTEND;TZID=Europe/Berlin:' + d + 'T' + et;
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
    dtstart,
    dtend,
    'SUMMARY:' + escapeIcsText(event.title || ''),
    'CATEGORIES:' + (event.category || 'Benutzerdefiniert'),
    'TRANSP:TRANSPARENT',
    'X-MEISTERPILZE-TYPE:custom-event'
  );
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
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Meisterpilze CalDAV"' });
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

  // Per-calendar access control: personal calendars are only accessible by that user (or admins)
  // Shared 'meisterpilze' calendar is accessible by all authenticated users
  function checkCalendarAccess(calName) {
    if (calName === 'meisterpilze') return true;
    if (req.caldavUser.role === 'admin') return true;
    return req.caldavUserSlug === calName;
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
      req.destroy();
      return;
    }
    body += c;
  });
  req.on('end', () => {
    try {
      if (method === 'PROPFIND') return handlePropfind(parts, body, req, res);
      if (method === 'REPORT') return handleReport(parts, body, req, res);
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
    const cals = listCalendars().filter((c) => checkCalendarAccess(c));
    let responses = `<d:response>
    <d:href>/caldav/calendars/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:displayname>Calendars</d:displayname>
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
    if (!checkCalendarAccess(calName)) {
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
        responses += `\n  <d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(calName)}/${encodeURIComponent(f)}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>${etag}</d:getetag>
        <d:getcontenttype>text/calendar; charset=utf-8</d:getcontenttype>
        <d:getcontentlength>${stat.size}</d:getcontentlength>
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
    if (!checkCalendarAccess(parts[1])) {
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
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>${etag}</d:getetag>
        <d:getcontenttype>text/calendar; charset=utf-8</d:getcontenttype>
        <d:getcontentlength>${stat.size}</d:getcontentlength>
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

function handleReport(parts, body, req, res) {
  // calendar-multiget: client requests specific .ics files with their data
  if (parts.length === 2 && parts[0] === 'calendars') {
    const calName = parts[1];
    if (!checkCalendarAccess(calName)) {
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
      const log = changeLog.get(calName);
      if (reqToken > 0) {
        const invalid = !log || (log.size > 0 && reqToken < Math.min(...[...log.values()].map((e) => e.token)));
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
        for (const [fileName, entry] of log.entries()) {
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
      for (const hrefTag of hrefMatches) {
        const href = hrefTag.replace(/<\/?(?:[a-zA-Z0-9]+:)?href(?:\s[^>]*)?>/gi, '');
        const filename = sanitizePart(decodeURIComponent(href.split('/').pop()));
        if (!filename) continue;
        const filePath = path.join(calDir, filename);
        if (fs.existsSync(filePath) && filename.endsWith('.ics')) {
          const content = fs.readFileSync(filePath, 'utf8');
          const etag = getEtag(calName, filename);
          responses += `\n  <d:response>
    <d:href>${escapeXml(href)}</d:href>
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
    } else {
      // calendar-query: return all items
      const files = listIcsFiles(calName);
      for (const f of files) {
        const filePath = path.join(calDir, f);
        const content = fs.readFileSync(filePath, 'utf8');
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
    if (!checkCalendarAccess(calName)) {
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
    if (!checkCalendarAccess(calName)) {
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
              const dueMatch = unfolded.match(/DUE;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
              if (dueMatch) {
                const d = dueMatch[1] + '-' + dueMatch[2] + '-' + dueMatch[3];
                if (d !== (task.dueDate || '').slice(0, 10)) fields.dueDate = d;
              } else if (!unfolded.includes('DUE') && task.dueDate) {
                fields.dueDate = null;
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
              const dueMatch = unfolded.match(/DUE;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
              const dueDate = dueMatch ? dueMatch[1] + '-' + dueMatch[2] + '-' + dueMatch[3] : null;
              const descMatch = unfolded.match(/DESCRIPTION:(.*)/);
              const description = descMatch ? descMatch[1].trim().replace(/\\n/g, '\n') : null;
              db.insertTask(database, {
                text,
                priority,
                done,
                created: new Date().toISOString(),
                dueDate,
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
                const { uid: newUid, ics } = customEventToVEVENT(ev);
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
    if (!checkCalendarAccess(parts[1])) {
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
    const etag = getEtag(calName, parts[2]);
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
    if (!checkCalendarAccess(calName)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    // Only allow deleting from own calendar or shared calendar if admin
    const userSlug = req.caldavUserSlug;
    if (calName !== userSlug && calName !== 'meisterpilze' && req.caldavUser.role !== 'admin') {
      res.writeHead(403);
      res.end('Forbidden: cannot delete from other users\' calendars');
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
const rateLimits = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    entry = { start: now, count: 0 };
    rateLimits.set(ip, entry);
  }
  entry.count++;
  return entry.count <= RATE_MAX_REQUESTS;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now - entry.start > RATE_WINDOW_MS) rateLimits.delete(ip);
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

function handleRequest(req, res) {
  const clientIP = getClientIP(req);
  if (!checkRateLimit(clientIP)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end('{"error":"Too many requests"}');
    return;
  }

  // ── Security headers ──
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; report-uri /api/csp-reports"
  );
  if (protocol === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // ── Well-known CalDAV discovery (RFC 6764) ──
  if (req.url.startsWith('/.well-known/caldav')) {
    res.writeHead(301, { Location: '/caldav/' });
    res.end();
    return;
  }

  // ── CalDAV requests ──
  if (req.url.startsWith('/caldav')) {
    return handleCaldav(req, res);
  }

  // ── OAuth 2.0 well-known endpoints (public, no auth) ──
  if (req.method === 'GET' && req.url === '/.well-known/oauth-protected-resource') {
    const base = getBaseUrl(req);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      resource: base,
      authorization_servers: [base],
      bearer_methods_supported: ['header']
    }));
    return;
  }
  if (req.method === 'GET' && req.url === '/.well-known/oauth-authorization-server') {
    const base = getBaseUrl(req);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      issuer: base,
      authorization_endpoint: base + '/oauth/authorize',
      token_endpoint: base + '/oauth/token',
      registration_endpoint: base + '/oauth/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256']
    }));
    return;
  }

  // ── OAuth 2.0 endpoints (before auth gate) ──
  if (req.url.startsWith('/oauth/')) {
    // CORS for token + register endpoints
    if (req.url === '/oauth/token' || req.url === '/oauth/register') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    }

    // Dynamic Client Registration (RFC 7591) — public
    if (req.method === 'POST' && req.url === '/oauth/register') {
      jsonBody(req, res, (e, data) => {
        if (e) return;
        try {
          const clientId = data.client_id || crypto.randomUUID();
          const redirectUris = data.redirect_uris || [];
          if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
            return jsonErr(res, 400, 'redirect_uris required');
          }
          for (const uri of redirectUris) {
            if (typeof uri !== 'string') return jsonErr(res, 400, 'redirect_uris must be strings');
            let parsed;
            try { parsed = new URL(uri); } catch { return jsonErr(res, 400, 'invalid redirect_uri: ' + uri); }
            if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
              return jsonErr(res, 400, 'redirect_uri must use HTTPS (except localhost)');
            }
          }
          const client = db.registerOAuthClient(database, {
            clientId,
            clientName: data.client_name || '',
            redirectUris
          });
          jsonOk(res, {
            client_id: client.client_id,
            client_name: client.client_name,
            redirect_uris: JSON.parse(client.redirect_uris || '[]'),
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code']
          });
        } catch (err) { safeErr(res, err); }
      });
      return;
    }

    // Token endpoint — public
    if (req.method === 'POST' && req.url === '/oauth/token') {
      const ct = (req.headers['content-type'] || '').split(';')[0].trim();
      const parser = ct === 'application/json' ? jsonBody : formBody;
      parser(req, res, (e, data) => {
        if (e) return;
        try {
          if (data.grant_type === 'authorization_code') {
            if (!data.code || !data.code_verifier || !data.client_id || !data.redirect_uri) {
              return jsonErr(res, 400, 'missing required parameters');
            }
            const codeHash = crypto.createHash('sha256').update(data.code).digest('hex');
            const codeRow = db.getOAuthCode(database, codeHash);
            if (!codeRow) return jsonErr(res, 400, 'invalid_grant');
            if (codeRow.clientId !== data.client_id) return jsonErr(res, 400, 'invalid_grant');
            if (codeRow.redirectUri !== data.redirect_uri) return jsonErr(res, 400, 'invalid_grant');
            if (!verifyPkce(data.code_verifier, codeRow.codeChallenge)) return jsonErr(res, 400, 'invalid_grant');

            db.markOAuthCodeUsed(database, codeHash);

            const accessToken = crypto.randomBytes(32).toString('hex');
            const refreshToken = crypto.randomBytes(32).toString('hex');
            const accessHash = crypto.createHash('sha256').update(accessToken).digest('hex');
            const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

            db.createOAuthToken(database, { token: accessHash, tokenType: 'access', clientId: data.client_id, userId: codeRow.userId, expiresInSeconds: 3600, refreshTokenRef: refreshHash });
            db.createOAuthToken(database, { token: refreshHash, tokenType: 'refresh', clientId: data.client_id, userId: codeRow.userId, expiresInSeconds: 30 * 24 * 3600 });

            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ access_token: accessToken, token_type: 'bearer', expires_in: 3600, refresh_token: refreshToken }));
          } else if (data.grant_type === 'refresh_token') {
            if (!data.refresh_token || !data.client_id) return jsonErr(res, 400, 'missing required parameters');
            const refreshHash = crypto.createHash('sha256').update(data.refresh_token).digest('hex');
            const refreshRow = db.getOAuthRefreshToken(database, refreshHash);
            if (!refreshRow) return jsonErr(res, 400, 'invalid_grant');
            if (refreshRow.clientId !== data.client_id) return jsonErr(res, 400, 'invalid_grant');

            // Revoke old tokens (rotation)
            db.revokeOAuthTokensByRefresh(database, refreshHash);

            const newAccessToken = crypto.randomBytes(32).toString('hex');
            const newRefreshToken = crypto.randomBytes(32).toString('hex');
            const newAccessHash = crypto.createHash('sha256').update(newAccessToken).digest('hex');
            const newRefreshHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

            db.createOAuthToken(database, { token: newAccessHash, tokenType: 'access', clientId: data.client_id, userId: refreshRow.userId, expiresInSeconds: 3600, refreshTokenRef: newRefreshHash });
            db.createOAuthToken(database, { token: newRefreshHash, tokenType: 'refresh', clientId: data.client_id, userId: refreshRow.userId, expiresInSeconds: 30 * 24 * 3600 });

            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ access_token: newAccessToken, token_type: 'bearer', expires_in: 3600, refresh_token: newRefreshToken }));
          } else {
            jsonErr(res, 400, 'unsupported_grant_type');
          }
        } catch (err) { safeErr(res, err); }
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

        if (responseType !== 'code') { jsonErr(res, 400, 'unsupported_response_type'); return; }
        if (codeChallengeMethod !== 'S256') { jsonErr(res, 400, 'invalid code_challenge_method'); return; }
        if (!codeChallenge) { jsonErr(res, 400, 'code_challenge required'); return; }

        const client = db.getOAuthClient(database, clientId);
        if (!client) { jsonErr(res, 400, 'invalid client_id'); return; }
        if (!client.redirectUris.includes(redirectUri)) { jsonErr(res, 400, 'invalid redirect_uri'); return; }

        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const clientName = client.clientName || clientId;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize – Meisterpilze</title><link rel="icon" href="/favicon.ico">
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
  <p class="sub"><span class="client">${esc(clientName)}</span> wants to access<br>Meisterpilze Lab Tracker</p>
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
        if (!authUser) { jsonErr(res, 401, 'unauthorized'); return; }
        formBody(req, res, (e, data) => {
          if (e) return;
          const redirectUri = data.redirect_uri || '';
          const state = data.state || '';

          if (data.action === 'deny') {
            const sep = redirectUri.includes('?') ? '&' : '?';
            res.writeHead(302, { Location: redirectUri + sep + 'error=access_denied' + (state ? '&state=' + encodeURIComponent(state) : '') });
            res.end();
            return;
          }

          const clientId = data.client_id || '';
          const client = db.getOAuthClient(database, clientId);
          if (!client || !client.redirectUris.includes(redirectUri)) {
            jsonErr(res, 400, 'invalid client or redirect_uri');
            return;
          }

          const code = crypto.randomBytes(32).toString('hex');
          const codeHash = crypto.createHash('sha256').update(code).digest('hex');
          db.createOAuthCode(database, {
            code: codeHash,
            clientId,
            userId: authUser.id,
            redirectUri,
            codeChallenge: data.code_challenge || '',
            codeChallengeMethod: data.code_challenge_method || 'S256'
          });

          const sep = redirectUri.includes('?') ? '&' : '?';
          res.writeHead(302, { Location: redirectUri + sep + 'code=' + encodeURIComponent(code) + (state ? '&state=' + encodeURIComponent(state) : '') });
          res.end();
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
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
    if (!checkMcpAuth(req)) {
      const base = getBaseUrl(req);
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer, resource_metadata="' + base + '/.well-known/oauth-protected-resource"'
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
        let session = sessionId ? mcpSessions.get(sessionId) : null;
        if (!session) {
          const server = createMcpServer(database, () => broadcastSSE(null));
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
        session.transport.handleRequest(req, res, body);
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
        const user = db.createUser(database, username, password, 'admin');
        const dbUser = db.getUserByUsername(database, username);
        const token = db.createSession(database, dbUser.id);
        setSessionCookie(res, token);
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
        const user = db.getUserByUsername(database, username);
        if (!user || !db.verifyPassword(user.hash, user.salt, password)) {
          recordLoginFailure(throttleKey);
          recordLoginFailurePerUser(userKey);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid credentials' }));
          return;
        }
        clearLoginAttempts(throttleKey);
        clearLoginAttemptsPerUser(userKey);
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
    res.end(JSON.stringify({ username: session.username, role: session.role }));
    return;
  }

  // ── Auth gate ─────────────────────────────────────────────
  const isLoginPage = url === '/login.html';
  const isPublicAsset = !!url.match(/^\/(login\.js|icon-\d+\.png|favicon\.ico|icon\.svg|manifest\.json|sw\.js)$/);

  if (!isLoginPage && !isPublicAsset) {
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
      if (e) { jsonErr(res, 400, e.message); return; }
      try {
        const { username, password, role } = data;
        if (!username || !password || password.length < 8) {
          jsonErr(res, 400, 'Username and password (min 8 chars) required');
          return;
        }
        const user = db.createUser(database, username, password, role || 'user');
        log('info', 'User created', { actor: req.authUser.username, newUser: username, role: role || 'user' });
        jsonOk(res, user);
      } catch (e) { safeErr(res, e); }
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

  // POST /api/csp-reports — log CSP violations
  if (req.method === 'POST' && req.url === '/api/csp-reports') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 10000) {
        req.destroy();
      }
    });
    req.on('end', () => {
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
    // Public: minimal status only. Detailed info requires auth.
    const authUser = checkAuth(req);
    const health = {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'connected' : 'error',
      uptime: Math.round(process.uptime()),
      version: require('./package.json').version
    };
    if (authUser) {
      health.platform = process.platform;
      health.nodeVersion = process.version;
      health.sseClients = sseClients.size;
      health.memory = {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024)
      };
    }
    res.writeHead(dbOk ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(readData()));
    return;
  }

  // GET /api/scan-log — paginated scan log history
  if (req.method === 'GET' && url === '/api/scan-log') {
    const params = new URL(req.url, 'http://x').searchParams;
    const limit = Math.min(parseInt(params.get('limit')) || 200, 1000);
    const offset = parseInt(params.get('offset')) || 0;
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
    const limit = Math.min(parseInt(params.get('limit')) || 200, 1000);
    const offset = parseInt(params.get('offset')) || 0;
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

  // -- Batches --
  if (req.method === 'POST' && req.url === '/api/batches') {
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      const vr = validateRequired(data, ['batchId', 'species', 'qty', 'days', 'created', 'due']);
      if (vr) {
        jsonErr(res, 400, vr);
        return;
      }
      const vt = validateTypes(data, { qty: 'number', days: 'number', species: 'string', batchId: 'string' });
      if (vt) {
        jsonErr(res, 400, vt);
        return;
      }
      const vrng = validateRanges(data, { qty: { min: 1, max: 10000 }, days: { min: 1, max: 3650 } });
      if (vrng) {
        jsonErr(res, 400, vrng);
        return;
      }
      const vlen = validateLengths(data, { batchId: 100, species: 200, strain: 200, notes: 10000 });
      if (vlen) {
        jsonErr(res, 400, vlen);
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
      try {
        db.insertBatch(database, data);
        autoPushBatchCaldav(data);
        broadcastSSE(res);
        jsonOk(res);
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
        db.addBagsToBatch(database, id, data.add || [], data.newQty);
        broadcastSSE(res);
        jsonOk(res);
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
      db.deleteBatchById(database, id);
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
        const ids = db.appendScanEntries(database, data.entries || [], userId);
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
    if (requireAdmin(req, res)) return;
    try {
      const ok = db.deleteScanEntryById(database, parseInt(scanIdMatch[1]));
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
      let vd = validateDate(data.time, 'time');
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
        db.insertCultures(database, data.cultures || []);
        broadcastSSE(res);
        jsonOk(res);
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
      const vt = validateTypes(data, { text: 'string', priority: 'string', assignee: 'string', description: 'string' });
      if (vt) {
        jsonErr(res, 400, vt);
        return;
      }
      const vlen = validateLengths(data, { text: 2000, description: 10000, assignee: 200 });
      if (vlen) {
        jsonErr(res, 400, vlen);
        return;
      }
      let ve = validateEnum(data.priority, ['low', 'med', 'high'], 'priority');
      if (ve) {
        jsonErr(res, 400, ve);
        return;
      }
      if (data.dueDate) {
        const vd = validateDate(data.dueDate, 'dueDate');
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
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        db.updateTaskById(database, id, data);
        const t = db.readTaskById(database, id);
        if (t) autoPushTaskCaldav(t);
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
      const vrng = validateRanges(data, {
        purchasePrice: { min: 0, max: 100000000 },
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
        db.upsertAsset(database, data);
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const assetMatch = req.url.match(/^\/api\/assets\/([^/]+)$/);
  if (req.method === 'DELETE' && assetMatch) {
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
      cfg.hasToken = !!(cfg.token);
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
      try {
        db.insertCalendarEvent(database, data, Array.isArray(data.assignees) ? data.assignees : null);
        autoSyncCalendarEvent(data);
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  const calEvMatch = req.url.match(/^\/api\/calendar-events\/([^/]+)$/);
  if (req.method === 'PATCH' && calEvMatch) {
    const id = decodeURIComponent(calEvMatch[1]);
    jsonBody(req, res, (e, data) => {
      if (e) {
        jsonErr(res, 400, e.message);
        return;
      }
      try {
        db.updateCalendarEvent(database, id, data);
        if (data.assignees !== undefined && Array.isArray(data.assignees)) {
          db.setCalendarEventAssignees(database, id, data.assignees);
        }
        autoSyncCalendarEvent(Object.assign({ id }, data));
        broadcastSSE(res);
        jsonOk(res);
      } catch (err) {
        safeErr(res, err);
      }
    });
    return;
  }
  if (req.method === 'DELETE' && calEvMatch) {
    const id = decodeURIComponent(calEvMatch[1]);
    try {
      const ev = db.getCalendarEventById(database, id);
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
        const val = db.applyInventoryDelta(database, data.mat, data.deltaKg, data.type || null, data.ref || null);
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
        const val = db.setInventoryAbsolute(database, data.mat, data.value, data.type || null, data.ref || null);
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

  // -- Backup Download (encrypted .db) --
  if (req.method === 'POST' && req.url === '/api/backup/download') {
    if (requireAdmin(req, res)) return;
    jsonBody(req, res, (e, data) => {
      let tmpDest;
      try {
        if (!data || !data.password || data.password.length < 8) {
          jsonErr(res, 400, 'Password required (min 8 characters)');
          return;
        }
        // Create a fresh VACUUM INTO temp file for a consistent snapshot
        tmpDest = path.join(BACKUP_DIR, '_download_tmp_' + Date.now() + '.db');
        db.backupDb(database, tmpDest);
        const plain = fs.readFileSync(tmpDest);
        try {
          fs.unlinkSync(tmpDest);
        } catch (e) {
          log('warn', 'Failed to clean backup temp file', { error: e.message });
        }
        tmpDest = null;
        // Encrypt: salt(32) + iv(12) + authTag(16) + ciphertext
        const salt = crypto.randomBytes(32);
        const key = crypto.scryptSync(data.password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
        const tag = cipher.getAuthTag();
        const payload = Buffer.concat([salt, iv, tag, enc]);
        const hmac = crypto.createHmac('sha256', key).update(payload).digest();
        const out = Buffer.concat([payload, hmac]);
        const stamp = new Date().toISOString().slice(0, 10);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="meisterpilze_backup_' + stamp + '.enc"',
          'Content-Length': out.length
        });
        res.end(out);
        log('info', 'Backup downloaded', { actor: req.authUser.username });
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
    const chunks = [];
    let sz = 0;
    let aborted = false;
    const MAX_BACKUP = 50 * 1024 * 1024; // 50 MB limit for backup files
    req.on('data', (c) => {
      sz += c.length;
      if (sz > MAX_BACKUP) {
        aborted = true;
        jsonErr(res, 413, 'Backup file too large');
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      let tmpPath;
      try {
        const raw = Buffer.concat(chunks);
        const password = req.headers['x-backup-password'] || '';
        if (!password) {
          jsonErr(res, 400, 'Password required');
          return;
        }
        // Decrypt: salt(32) + iv(12) + authTag(16) + ciphertext [+ hmac(32)]
        if (raw.length < 60 + 16) {
          jsonErr(res, 400, 'File too small to be a valid backup');
          return;
        }
        const salt = raw.subarray(0, 32);
        const iv = raw.subarray(32, 44);
        const key = crypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
        // Try with HMAC first (current format), fall back to legacy (no HMAC)
        let plain;
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
        if (!plain) {
          jsonErr(res, 401, 'Wrong password or corrupted file');
          return;
        }
        // Validate SQLite header
        if (plain.length < 16 || plain.toString('utf8', 0, 15) !== 'SQLite format 3') {
          jsonErr(res, 400, 'Decrypted file is not a valid database');
          return;
        }
        // Write to temp with restrictive permissions, validate schema
        tmpPath = path.join(BACKUP_DIR, '_restore_tmp_' + Date.now() + '.db');
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
        try {
          fs.copyFileSync(DB_FILE, bakPath);
        } catch (e) {
          log('warn', 'Failed to create pre-restore backup', { error: e.message });
        } // keep old db as safety net
        fs.renameSync(tmpPath, DB_FILE);
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
          res.writeHead(400);
          res.end('{"error":"no zpl"}');
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
      } catch {
        res.writeHead(400);
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
      if (fs.existsSync(CAL_DIR)) {
        const dirs = fs.readdirSync(CAL_DIR).filter((d) => fs.statSync(path.join(CAL_DIR, d)).isDirectory());
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

  // GET /api/printer-status
  if (req.method === 'GET' && req.url === '/api/printer-status') {
    execFile(
      'wmic',
      ['printer', 'where', "Name='" + PRINTER_NAME + "'", 'get', 'Name,PrinterStatus', '/format:csv'],
      (err, stdout) => {
        const found = !err && stdout.includes(PRINTER_NAME);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ found, name: PRINTER_NAME }));
      }
    );
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

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // Cache immutable vendor libs aggressively; cache HTML/CSS/SW short-term
    if (url.startsWith('/lib/')) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    } else if (ext === '.png' || ext === '.ico' || ext === '.svg') {
      headers['Cache-Control'] = 'public, max-age=86400';
    } else if (ext === '.css' || ext === '.js') {
      headers['Cache-Control'] = 'public, max-age=300';
    } else {
      headers['Cache-Control'] = 'no-cache';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
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

// ── SERVER CREATION (HTTPS with HTTP→HTTPS redirect, HTTP fallback if no certs) ──
let server;
if (fs.existsSync(CERT_KEY) && fs.existsSync(CERT_CRT)) {
  const tlsOpts = { key: fs.readFileSync(CERT_KEY), cert: fs.readFileSync(CERT_CRT), minVersion: 'TLSv1.2' };
  server = https.createServer(tlsOpts, handleRequest);
  protocol = 'https';

  // HTTP→HTTPS redirect server: redirect all non-localhost requests to HTTPS
  const redirectServer = http.createServer((req, res) => {
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
  redirectServer
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
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('  Meisterpilze Lab Tracker is running!');
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
  server.close(() => {
    database.close();
    log('info', 'Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    database.close();
    process.exit(1);
  }, 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});
