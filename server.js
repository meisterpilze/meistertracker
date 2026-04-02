const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');
const db = require('./db.js');

// ── CONFIGURATION ────────────────────────────────────────────
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
      });
    }
  } catch (e) { /* .env is optional */ }
}
loadEnv();

// ── LOGGING ──────────────────────────────────────────────────
function log(level, msg, meta) {
  const ts = new Date().toISOString();
  const entry = `${ts} [${level.toUpperCase()}] ${msg}`;
  if (level === 'error') console.error(entry, meta || '');
  else console.log(entry, meta ? JSON.stringify(meta) : '');
}

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || 3443;
const DIR = __dirname;
const CERT_KEY = path.join(DIR, 'certs', 'server.key');
const CERT_CRT = path.join(DIR, 'certs', 'server.crt');
const DB_FILE = path.join(DIR, 'meistertracker.db');
const CAL_DIR = path.join(DIR, 'calendars');

// Windows printer name — must match exactly what shows in Devices and Printers
const PRINTER_NAME = process.env.PRINTER_NAME || 'ZDesigner GK420d';
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5 MB max request body

const database = db.openDb(DB_FILE);
if (!fs.existsSync(CAL_DIR)) fs.mkdirSync(CAL_DIR);

const MIME = {
  '.html':'text/html; charset=utf-8','.json':'application/json',
  '.js':'application/javascript','.css':'text/css; charset=utf-8',
  '.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml',
};

function getLocalIP(){
  for(const ifaces of Object.values(os.networkInterfaces()))
    for(const i of ifaces)
      if(i.family==='IPv4'&&!i.internal)return i.address;
  return 'localhost';
}

function readData(){
  return db.readAll(database);
}

function writeData(data){
  db.writeAll(database, data);
}

// ── AUTH HELPERS ─────────────────────────────────────────────
function getSessionToken(req){
  const cookies=req.headers.cookie||'';
  const match=cookies.match(/(?:^|;\s*)session=([a-f0-9]+)/);
  return match?match[1]:null;
}

function checkAuth(req){
  const token=getSessionToken(req);
  if(!token)return null;
  return db.getSession(database,token)||null;
}

function sendUnauthorized(res,isApi){
  if(isApi){
    res.writeHead(401,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'unauthorized'}));
  }else{
    res.writeHead(302,{'Location':'/login.html'});
    res.end();
  }
}

function setSessionCookie(res,token){
  res.setHeader('Set-Cookie','session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000');
}

function clearSessionCookie(res){
  res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}

// Clean expired sessions on startup and hourly
db.deleteExpiredSessions(database);
setInterval(()=>db.deleteExpiredSessions(database),60*60*1000);

// ── DAILY AUTO-BACKUP ────────────────────────────────────────
// Every day at 00:00 writes a dated backup to /backups/
const BACKUP_DIR = path.join(DIR, 'backups');
if(!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

function runDailyBackup(){
  try{
    const d=new Date();
    const stamp=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const dest=path.join(BACKUP_DIR,'meisterpilze_backup_'+stamp+'.db');
    if(!fs.existsSync(dest)){
      db.backupDb(database, dest).then(()=>{
        console.log('  Auto-backup saved: '+dest);
        // Keep last 30 daily backups
        const files=fs.readdirSync(BACKUP_DIR).filter(f=>f.endsWith('.db')).sort();
        if(files.length>30){
          files.slice(0,files.length-30).forEach(f=>{
            fs.unlinkSync(path.join(BACKUP_DIR,f));
            console.log('  Old backup removed: '+f);
          });
        }
      }).catch(e=>console.error('Auto-backup failed:',e.message));
    }
  }catch(e){console.error('Auto-backup failed:',e.message);}
}

function scheduleDailyBackup(){
  // Run one immediately on startup if today's doesn't exist yet
  runDailyBackup();
  // Schedule next at midnight
  const now=new Date();
  const next=new Date(now);
  next.setHours(24,0,0,0); // next midnight
  const msUntil=next-now;
  console.log('  Next auto-backup: '+next.toLocaleString('de-DE'));
  setTimeout(()=>{
    runDailyBackup();
    setInterval(runDailyBackup, 24*60*60*1000); // then every 24h
  }, msUntil);
}
scheduleDailyBackup();

// Send raw ZPL to the GK420d via Windows
function printZPL(zplData, callback){
  const tmp=path.join(os.tmpdir(),'mp_label_'+Date.now()+'.zpl');
  const zplFixed = zplData.replace(/\r?\n/g, '\r\n');

  fs.writeFile(tmp, zplFixed, 'binary', err=>{
    if(err)return callback('Could not write temp file: '+err.message);

    const ps = `
$printerName = "${PRINTER_NAME}"
$filePath = "${tmp.replace(/\\/g,'\\\\')}"
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

    const psTmp=path.join(os.tmpdir(),'mp_print_'+Date.now()+'.ps1');
    fs.writeFile(psTmp, ps, 'utf8', err2=>{
      if(err2){fs.unlink(tmp,()=>{});return callback('Could not write PS script: '+err2.message);}

      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psTmp}"`, (e, stdout, stderr)=>{
        fs.unlink(tmp,()=>{});
        fs.unlink(psTmp,()=>{});
        if(e){
          console.error('PowerShell print error:', stderr||e.message);
          callback('Print failed: '+(stderr||e.message).trim());
        }else{
          console.log('Print OK:', stdout.trim());
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

function generateUID() {
  return 'mp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Sanitize URL path parts to prevent directory traversal attacks
function sanitizePart(s) {
  const clean = path.basename(s);
  if (!clean || clean === '.' || clean === '..') return null;
  return clean;
}

function escapeXml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Check CalDAV basic auth against stored credentials
function checkCaldavAuth(req) {
  const cfg = db.readCaldavConfig(database);
  // If no credentials configured, allow all (open access on local network)
  if (!cfg.caldavUsername) return true;
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Basic ')) return false;
  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
  const [user, pass] = decoded.split(':');
  return user === cfg.caldavUsername && pass === cfg.caldavPassword;
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
  return fs.readdirSync(CAL_DIR).filter(f => {
    return fs.statSync(path.join(CAL_DIR, f)).isDirectory();
  });
}

// List all .ics files in a calendar
function listIcsFiles(calName) {
  const dir = path.join(CAL_DIR, calName);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.ics'));
}

// Compute a stable ctag for a calendar based on file contents
function computeCtag(calName) {
  const dir = path.join(CAL_DIR, calName);
  if (!fs.existsSync(dir)) return '0';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.ics')).sort();
  const hash = crypto.createHash('md5');
  for (const f of files) {
    const stat = fs.statSync(path.join(dir, f));
    hash.update(f + ':' + stat.mtimeMs + ':' + stat.size + '\n');
  }
  return hash.digest('hex').slice(0, 16);
}

// Convert a task object to VTODO .ics content
function taskToVTODO(task) {
  const uid = task.caldavUid || generateUID();
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const created = task.created
    ? new Date(task.created).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
    : now;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meisterpilze Lab Tracker//EN',
    'BEGIN:VTODO',
    'UID:' + uid,
    'DTSTAMP:' + now,
    'CREATED:' + created,
    'LAST-MODIFIED:' + now,
    'SUMMARY:' + (task.text || '').replace(/\n/g, '\\n'),
  ];
  if (task.dueDate) {
    const d = new Date(task.dueDate).toISOString().replace(/[-:]/g, '').split('T')[0];
    lines.push('DUE;VALUE=DATE:' + d);
  }
  const prioMap = { high: 1, med: 5, low: 9 };
  lines.push('PRIORITY:' + (prioMap[task.priority] || 0));
  lines.push('STATUS:' + (task.done ? 'COMPLETED' : 'NEEDS-ACTION'));
  if (task.done) lines.push('PERCENT-COMPLETE:100');
  if (task.assignee) lines.push('X-MEISTERPILZE-ASSIGNEE:' + task.assignee);
  if (task.description) lines.push('DESCRIPTION:' + task.description.replace(/\n/g, '\\n'));
  lines.push('END:VTODO', 'END:VCALENDAR');
  return { uid, ics: lines.join('\r\n') };
}

// Write a task as .ics file to the appropriate calendar
function writeTaskToCalendar(task, calName) {
  calName = calName || 'meisterpilze-tasks';
  const dir = ensureCalDir(calName);
  if (!task.caldavUid) task.caldavUid = generateUID();
  const { uid, ics } = taskToVTODO(task);
  fs.writeFileSync(path.join(dir, uid + '.ics'), ics, 'utf8');
  task.caldavSynced = new Date().toISOString();
  return uid;
}

// Delete a task's .ics file
function deleteTaskFromCalendar(uid, calName) {
  calName = calName || 'meisterpilze-tasks';
  const file = path.join(CAL_DIR, calName, uid + '.ics');
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// Full sync: write all tasks to calendar directories
function syncAllTasksLocal(data) {
  const cfg = data.caldav || {};
  const tasks = data.manualTasks || [];
  const teamMembers = data.teamMembers || [];
  const results = { pushed: 0, errors: 0, calendarsCreated: 0 };

  // Ensure base calendar
  ensureCalDir('meisterpilze-tasks');

  // Per-person calendars
  const personCals = {};
  if (cfg.perPersonCalendars && teamMembers.length > 0) {
    for (const m of teamMembers) {
      const slug = m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const calName = 'meisterpilze-' + slug;
      ensureCalDir(calName);
      personCals[m.name] = calName;
    }
  }

  // Write each task
  for (const task of tasks) {
    try {
      let calName = 'meisterpilze-tasks';
      if (cfg.perPersonCalendars && task.assignee && personCals[task.assignee]) {
        calName = personCals[task.assignee];
      }
      writeTaskToCalendar(task, calName);
      results.pushed++;
    } catch (e) {
      results.errors++;
    }
  }
  return results;
}

// ── CalDAV HTTP handler ─────────────────────────────────────
// Handles requests under /caldav/
function handleCaldav(req, res) {
  // CORS + DAV headers for all CalDAV responses
  res.setHeader('DAV', '1, 2, 3, calendar-access');
  const caldavOrigin = req.headers.origin; if (caldavOrigin) res.setHeader('Access-Control-Allow-Origin', caldavOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR, OPTIONS, PROPPATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Depth, Authorization, If-Match, If-None-Match');

  // Auth check
  if (!checkCaldavAuth(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Meisterpilze CalDAV"' });
    res.end('Unauthorized');
    return;
  }

  const method = req.method;
  // Normalize path: /caldav/calendars/calname/file.ics
  const rawPath = decodeURIComponent(req.url.split('?')[0]).replace(/\/+/g, '/');
  const parts = rawPath.replace(/^\/caldav\/?/, '').replace(/\/$/, '').split('/').filter(Boolean);
  // parts: [] = root, ['calendars'] = calendar-home, ['calendars','name'] = calendar, ['calendars','name','file.ics'] = item

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
      'Allow': 'OPTIONS, GET, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR, PROPPATCH',
    });
    res.end();
    return;
  }

  // Collect request body
  let body='';let bodySize=0;
  req.on('data',c=>{bodySize+=c.length;if(bodySize>MAX_BODY_SIZE){req.destroy();return}body+=c});
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
      console.error('CalDAV error:', e);
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
        <d:current-user-principal><d:href>/caldav/</d:href></d:current-user-principal>
        <c:calendar-home-set><d:href>/caldav/calendars/</d:href></c:calendar-home-set>
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

  // /caldav/calendars/ — list all calendars
  if (parts.length === 1 && parts[0] === 'calendars') {
    const cals = listCalendars();
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
        const displayName = cal.replace(/^meisterpilze-/, 'Meisterpilze ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        responses += `\n  <d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(cal)}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>${escapeXml(displayName)}</d:displayname>
        <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
        <cs:getctag>${computeCtag(cal)}</cs:getctag>
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
    const calDir = path.join(CAL_DIR, calName);
    if (!fs.existsSync(calDir)) {
      res.writeHead(404);
      res.end('Calendar not found');
      return;
    }
    const displayName = calName.replace(/^meisterpilze-/, 'Meisterpilze ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    let responses = `<d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(calName)}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>${escapeXml(displayName)}</d:displayname>
        <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
        <cs:getctag>${computeCtag(calName)}</cs:getctag>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;

    if (depth !== '0') {
      const files = listIcsFiles(calName);
      for (const f of files) {
        const fPath = path.join(calDir, f);
        const stat = fs.statSync(fPath);
        const etag = '"' + stat.mtimeMs.toString(36) + '"';
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
    const filePath = path.join(CAL_DIR, parts[1], parts[2]);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const stat = fs.statSync(filePath);
    const etag = '"' + stat.mtimeMs.toString(36) + '"';
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
    const calDir = path.join(CAL_DIR, calName);
    if (!fs.existsSync(calDir)) {
      res.writeHead(404);
      res.end('Calendar not found');
      return;
    }

    // Parse requested hrefs from the XML body
    const hrefMatches = body.match(/<d:href>([^<]+)<\/d:href>/gi) || [];
    let responses = '';

    // If calendar-multiget with specific hrefs
    if (hrefMatches.length > 0) {
      for (const hrefTag of hrefMatches) {
        const href = hrefTag.replace(/<\/?d:href>/gi, '');
        const filename = sanitizePart(decodeURIComponent(href.split('/').pop()));
        if (!filename) continue;
        const filePath = path.join(calDir, filename);
        if (fs.existsSync(filePath) && filename.endsWith('.ics')) {
          const content = fs.readFileSync(filePath, 'utf8');
          const stat = fs.statSync(filePath);
          const etag = '"' + stat.mtimeMs.toString(36) + '"';
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
        const stat = fs.statSync(filePath);
        const etag = '"' + stat.mtimeMs.toString(36) + '"';
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
  if (parts.length === 2 && parts[0] === 'calendars') {
    const calName = parts[1];
    ensureCalDir(calName);
    res.writeHead(201);
    res.end();
    console.log('  CalDAV: Calendar created:', calName);
    return;
  }
  res.writeHead(403);
  res.end('Forbidden');
}

function handlePut(parts, body, req, res) {
  // PUT /caldav/calendars/<cal>/<uid>.ics
  if (parts.length === 3 && parts[0] === 'calendars' && parts[2].endsWith('.ics')) {
    const calName = parts[1];
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
    const stat = fs.statSync(filePath);
    const etag = '"' + stat.mtimeMs.toString(36) + '"';
    res.writeHead(existed ? 204 : 201, { 'ETag': etag });
    res.end();
    return;
  }
  res.writeHead(403);
  res.end('Forbidden');
}

function handleGet(parts, req, res) {
  // GET /caldav/calendars/<cal>/<uid>.ics
  if (parts.length === 3 && parts[0] === 'calendars' && parts[2].endsWith('.ics')) {
    const filePath = path.join(CAL_DIR, parts[1], parts[2]);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const stat = fs.statSync(filePath);
    const etag = '"' + stat.mtimeMs.toString(36) + '"';
    res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'ETag': etag,
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
    const filePath = path.join(CAL_DIR, parts[1], parts[2]);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    fs.unlinkSync(filePath);
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

function handleRequest(req,res){
  const clientIP = req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIP)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end('{"error":"Too many requests"}');
    return;
  }
  // ── Well-known CalDAV discovery (RFC 6764) ──
  if(req.url.startsWith('/.well-known/caldav')){
    res.writeHead(301,{'Location':'/caldav/'});
    res.end();return;
  }

  // ── CalDAV requests ──
  if(req.url.startsWith('/caldav')){
    return handleCaldav(req,res);
  }

  const origin = req.headers.origin; if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}

  const url=req.url.split('?')[0];

  // ── Auth endpoints (public) ───────────────────────────────
  if(url==='/api/auth/setup-required'&&req.method==='GET'){
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({setupRequired:db.countUsers(database)===0}));return;
  }

  if(url==='/api/auth/setup'&&req.method==='POST'){
    if(db.countUsers(database)>0){
      res.writeHead(403,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'setup already completed'}));return;
    }
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      try{
        const{username,password}=JSON.parse(body);
        if(!username||!password||password.length<4){
          res.writeHead(400,{'Content-Type':'application/json'});
          res.end(JSON.stringify({error:'Username and password (min 4 chars) required'}));return;
        }
        const user=db.createUser(database,username,password,'admin');
        const dbUser=db.getUserByUsername(database,username);
        const token=db.createSession(database,dbUser.id);
        setSessionCookie(res,token);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true,username:user.username,role:'admin'}));
      }catch(e){
        res.writeHead(400,{'Content-Type':'application/json'});
        res.end(JSON.stringify({error:e.message}));
      }
    });return;
  }

  if(url==='/api/auth/login'&&req.method==='POST'){
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      try{
        const{username,password}=JSON.parse(body);
        const user=db.getUserByUsername(database,username);
        if(!user||!db.verifyPassword(user.hash,user.salt,password)){
          res.writeHead(401,{'Content-Type':'application/json'});
          res.end(JSON.stringify({error:'Invalid credentials'}));return;
        }
        const token=db.createSession(database,user.id);
        setSessionCookie(res,token);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true,username:user.username,role:user.role}));
      }catch(e){
        res.writeHead(400,{'Content-Type':'application/json'});
        res.end(JSON.stringify({error:e.message}));
      }
    });return;
  }

  if(url==='/api/auth/logout'&&req.method==='POST'){
    const token=getSessionToken(req);
    if(token)db.deleteSession(database,token);
    clearSessionCookie(res);
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:true}));return;
  }

  if(url==='/api/auth/me'&&req.method==='GET'){
    const session=checkAuth(req);
    if(!session){sendUnauthorized(res,true);return;}
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({username:session.username,role:session.role}));return;
  }

  // ── Auth gate ─────────────────────────────────────────────
  const isLoginPage=(url==='/login.html');
  const isPublicAsset=!!url.match(/^\/(icon-\d+\.png|favicon\.ico|icon\.svg|manifest\.json|sw\.js)$/);

  if(!isLoginPage&&!isPublicAsset){
    if(db.countUsers(database)===0){
      if(url.startsWith('/api/')){
        res.writeHead(401,{'Content-Type':'application/json'});
        res.end(JSON.stringify({error:'setup_required'}));
      }else{
        res.writeHead(302,{'Location':'/login.html'});
        res.end();
      }
      return;
    }
    const authUser=checkAuth(req);
    if(!authUser){
      sendUnauthorized(res,url.startsWith('/api/'));
      return;
    }
    req.authUser=authUser;
  }

  // ── User management (admin only) ──────────────────────────
  if(url==='/api/users'&&req.method==='GET'){
    if(!req.authUser||req.authUser.role!=='admin'){
      res.writeHead(403,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'admin required'}));return;
    }
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(db.listUsers(database)));return;
  }

  if(url==='/api/users'&&req.method==='POST'){
    if(!req.authUser||req.authUser.role!=='admin'){
      res.writeHead(403,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'admin required'}));return;
    }
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      try{
        const{username,password,role}=JSON.parse(body);
        if(!username||!password||password.length<4){
          res.writeHead(400,{'Content-Type':'application/json'});
          res.end(JSON.stringify({error:'Username and password (min 4 chars) required'}));return;
        }
        const user=db.createUser(database,username,password,role||'user');
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify(user));
      }catch(e){
        res.writeHead(400,{'Content-Type':'application/json'});
        res.end(JSON.stringify({error:e.message}));
      }
    });return;
  }

  if(url.match(/^\/api\/users\/\d+$/)&&req.method==='DELETE'){
    if(!req.authUser||req.authUser.role!=='admin'){
      res.writeHead(403,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'admin required'}));return;
    }
    const userId=parseInt(url.split('/').pop());
    if(userId===req.authUser.user_id){
      res.writeHead(400,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'Cannot delete yourself'}));return;
    }
    db.deleteUser(database,userId);
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:true}));return;
  }

  // GET /api/health
  if(req.method==='GET'&&req.url==='/api/health'){
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({status:'ok',uptime:process.uptime(),version:require('./package.json').version}));
    return;
  }

  // GET /api/data
  if(req.method==='GET'&&req.url==='/api/data'){
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(readData()));return;
  }

  // POST /api/data
  if(req.method==='POST'&&req.url==='/api/data'){
    let body='';let bodySize=0;
    req.on('data',c=>{bodySize+=c.length;if(bodySize>MAX_BODY_SIZE){req.destroy();return}body+=c});
    req.on('end',()=>{
      try{
        const incoming=JSON.parse(body);
        if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"Expected a JSON object"}');
          return;
        }
        // Safety: never overwrite existing data with empty/smaller arrays
        // (protects against stale browser cache sending blank state)
        const existing=readData();
        const checks=[
          ['batches', existing.batches, incoming.batches],
          ['scanLog', existing.scanLog, incoming.scanLog],
          ['harvests', existing.harvests, incoming.harvests],
          ['cultures', existing.cultures, incoming.cultures],
          ['assets', existing.assets, incoming.assets],
        ];
        for(const [name, old, inc] of checks){
          if(old && old.length > 0 && (!inc || inc.length === 0)){
            console.log('  BLOCKED: save rejected — would erase '+old.length+' '+name+' entries');
            res.writeHead(409,{'Content-Type':'application/json'});
            res.end(JSON.stringify({error:'blocked',reason:'Would erase existing '+name+'. Refresh your browser (Ctrl+Shift+R).'}));
            return;
          }
        }
        writeData(incoming);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end('{"ok":true}');
      }catch{res.writeHead(400);res.end('{"error":"bad json"}');}
    });return;
  }

  // POST /api/print  —  body: { zpl: "^XA...^XZ" }
  if(req.method==='POST'&&req.url==='/api/print'){
    let body='';let bodySize=0;
    req.on('data',c=>{bodySize+=c.length;if(bodySize>MAX_BODY_SIZE){req.destroy();return}body+=c});
    req.on('end',()=>{
      try{
        const{zpl}=JSON.parse(body);
        if(!zpl){res.writeHead(400);res.end('{"error":"no zpl"}');return;}
        printZPL(zpl,err=>{
          if(err){
            console.error('Print error:',err);
            res.writeHead(500,{'Content-Type':'application/json'});
            res.end(JSON.stringify({error:err}));
          }else{
            res.writeHead(200,{'Content-Type':'application/json'});
            res.end('{"ok":true,"labels":"printed"}');
          }
        });
      }catch{res.writeHead(400);res.end('{"error":"bad json"}');}
    });return;
  }

  // POST /api/caldav/sync — write all tasks to local calendar files
  if(req.method==='POST'&&req.url==='/api/caldav/sync'){
    let body='';let bodySize=0;
    req.on('data',c=>{bodySize+=c.length;if(bodySize>MAX_BODY_SIZE){req.destroy();return}body+=c});
    req.on('end',()=>{
      try{
        const data=readData();
        const incoming=JSON.parse(body);
        if(incoming.caldav) data.caldav=incoming.caldav;
        if(incoming.teamMembers) data.teamMembers=incoming.teamMembers;
        if(incoming.manualTasks) data.manualTasks=incoming.manualTasks;

        const result=syncAllTasksLocal(data);
        writeData(data);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify(result));
      }catch(e){
        console.error('CalDAV sync error:',e);
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false,error:e.message}));
      }
    });return;
  }

  // POST /api/caldav/push-one — write a single task to calendar file
  if(req.method==='POST'&&req.url==='/api/caldav/push-one'){
    let body='';let bodySize=0;
    req.on('data',c=>{bodySize+=c.length;if(bodySize>MAX_BODY_SIZE){req.destroy();return}body+=c});
    req.on('end',()=>{
      try{
        const{task}=JSON.parse(body);
        const data=readData();
        const cfg=data.caldav||{};
        let calName='meisterpilze-tasks';
        if(cfg.perPersonCalendars&&task.assignee){
          const slug=task.assignee.toLowerCase().replace(/[^a-z0-9]+/g,'-');
          calName='meisterpilze-'+slug;
        }
        const uid=writeTaskToCalendar(task,calName);
        const synced=task.caldavSynced||new Date().toISOString();
        db.updateTaskCaldavUid(database,task.text,task.created,uid,synced);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true,uid}));
      }catch(e){
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false,error:e.message}));
      }
    });return;
  }

  // GET /api/printer-status
  if(req.method==='GET'&&req.url==='/api/printer-status'){
    exec(`wmic printer where "Name='${PRINTER_NAME}'" get Name,PrinterStatus /format:csv`,(err,stdout)=>{
      const found=!err&&stdout.includes(PRINTER_NAME);
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({found,name:PRINTER_NAME}));
    });return;
  }

  // Static files
  let filePath;
  if(url==='/'||url==='/index.html')filePath=path.join(DIR,'index.html');
  else if(url==='/login.html')filePath=path.join(DIR,'login.html');
  else if(url==='/styles.css')filePath=path.join(DIR,'styles.css');
  else if(url==='/app.js')filePath=path.join(DIR,'app.js');
  else if(url==='/sw.js')filePath=path.join(DIR,'sw.js');
  else if(url==='/manifest.json')filePath=path.join(DIR,'manifest.json');
  else if(url.startsWith('/lib/'))filePath=path.join(DIR,'lib',path.basename(url));
  else if(url.match(/^\/(icon-\d+\.png|favicon\.ico|icon\.svg)$/))filePath=path.join(DIR,url.slice(1));
  else{res.writeHead(404);res.end('Not found');return;}

  fs.readFile(filePath,(err,data)=>{
    if(err){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(filePath)]||'application/octet-stream'});
    res.end(data);
  });
}

const server=http.createServer(handleRequest);

// ── HTTPS SERVER (for iOS camera support) ───────────────────
let httpsServer=null;
if(fs.existsSync(CERT_KEY)&&fs.existsSync(CERT_CRT)){
  const tlsOpts={key:fs.readFileSync(CERT_KEY),cert:fs.readFileSync(CERT_CRT)};
  httpsServer=https.createServer(tlsOpts,handleRequest);
}

server.listen(PORT,'0.0.0.0',()=>{
  const ip=getLocalIP();
  console.log('');
  console.log('  Meisterpilze Lab Tracker is running!');
  console.log('');
  console.log('  HTTP:');
  console.log('    Open on this PC:      http://localhost:'+PORT);
  console.log('    Open on phone/tablet: http://'+ip+':'+PORT);
  if(httpsServer){
    httpsServer.listen(HTTPS_PORT,'0.0.0.0',()=>{
      console.log('');
      console.log('  HTTPS (required for iOS camera):');
      console.log('    Open on phone/tablet: https://'+ip+':'+HTTPS_PORT);
    });
  }else{
    console.log('');
    console.log('  HTTPS: not available (run bash gen-cert.sh to enable)');
  }
  console.log('');
  console.log('  CalDAV server:        http://'+ip+':'+PORT+'/caldav/calendars/');
  console.log('');
  console.log('  Printer: '+PRINTER_NAME);
  console.log('  Printing via Windows spooler — works from any browser.');
  console.log('');
  console.log('  Data saved to: '+DB_FILE);
  console.log('  Press Ctrl+C to stop.');
});

// ── GRACEFUL SHUTDOWN ────────────────────────────────────────
function shutdown(signal) {
  log('info', 'Received ' + signal + ', shutting down...');
  if(httpsServer)httpsServer.close();
  server.close(() => {
    database.close();
    log('info', 'Server closed');
    process.exit(0);
  });
  setTimeout(() => { database.close(); process.exit(1); }, 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
