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

let database = db.openDb(DB_FILE);
if (!fs.existsSync(CAL_DIR)) fs.mkdirSync(CAL_DIR);

// ── SSE (Server-Sent Events) for real-time multi-client sync ──
const sseClients = [];
function broadcastSSE(excludeRes) {
  const msg = 'data: {"type":"data-changed"}\n\n';
  for (let i = sseClients.length - 1; i >= 0; i--) {
    const c = sseClients[i];
    if (c === excludeRes) continue;
    try { c.write(msg); } catch { sseClients.splice(i, 1); }
  }
}
setInterval(() => {
  const hb = 'data: {"type":"heartbeat"}\n\n';
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try { sseClients[i].write(hb); } catch { sseClients.splice(i, 1); }
  }
}, 15000);

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

function jsonBody(req, res, cb) {
  let body='';let sz=0;
  req.on('data',c=>{sz+=c.length;if(sz>MAX_BODY_SIZE){req.destroy();return}body+=c});
  req.on('end',()=>{try{cb(null,JSON.parse(body))}catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end('{"error":"bad json"}')}});
}
function jsonOk(res, data) { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(data||{ok:true})); }
function jsonErr(res, code, msg) { res.writeHead(code,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:msg})); }

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
if(!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, {mode:0o700});
// Clean up orphaned temp files from interrupted backup operations
try{fs.readdirSync(BACKUP_DIR).filter(f=>f.startsWith('_')).forEach(f=>{try{fs.unlinkSync(path.join(BACKUP_DIR,f))}catch(e){}})}catch(e){}

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

// RFC 5545 §3.1: fold content lines longer than 75 octets
function foldIcsLines(icsText) {
  return icsText.split('\r\n').map(line => {
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
  }).join('\r\n');
}

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
  return { uid, ics: foldIcsLines(lines.join('\r\n')) };
}

// Write a task as .ics file to the appropriate calendar
function writeTaskToCalendar(task, calName) {
  calName = calName || 'meisterpilze';
  const dir = ensureCalDir(calName);
  if (!task.caldavUid) task.caldavUid = generateUID();
  const { uid, ics } = taskToVTODO(task);
  fs.writeFileSync(path.join(dir, uid + '.ics'), ics, 'utf8');
  task.caldavSynced = new Date().toISOString();
  return uid;
}

// Convert a batch to VEVENT .ics content (all-day event for due date)
function batchToVEVENT(batch) {
  const uid = 'batch-' + batch.batchId + '@meisterpilze';
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const dueDate = new Date(batch.due).toISOString().replace(/[-:]/g, '').split('T')[0];
  // DTEND is next day for all-day events per RFC 5545
  const endDate = new Date(new Date(batch.due).getTime() + 86400000).toISOString().replace(/[-:]/g, '').split('T')[0];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meisterpilze Lab Tracker//EN',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + now,
    'DTSTART;VALUE=DATE:' + dueDate,
    'DTEND;VALUE=DATE:' + endDate,
    'SUMMARY:' + (batch.batchId + ' — ' + (batch.species || '') + ' fällig').replace(/\n/g, '\\n'),
    'CATEGORIES:Fälligkeiten',
    'TRANSP:TRANSPARENT',
    'X-MEISTERPILZE-TYPE:batch-due',
    'X-MEISTERPILZE-BATCH:' + batch.batchId,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return { uid, ics: foldIcsLines(lines.join('\r\n')) };
}

// Convert a task with due date to VEVENT .ics content
function taskDueToVEVENT(task) {
  const uid = (task.caldavUid || generateUID()) + '-event';
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const dueDate = new Date(task.dueDate).toISOString().replace(/[-:]/g, '').split('T')[0];
  const endDate = new Date(new Date(task.dueDate).getTime() + 86400000).toISOString().replace(/[-:]/g, '').split('T')[0];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meisterpilze Lab Tracker//EN',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + now,
    'DTSTART;VALUE=DATE:' + dueDate,
    'DTEND;VALUE=DATE:' + endDate,
    'SUMMARY:' + (task.text || '').replace(/\n/g, '\\n'),
    'CATEGORIES:Aufgaben',
    'STATUS:' + (task.done ? 'CANCELLED' : 'CONFIRMED'),
    'TRANSP:TRANSPARENT',
    'X-MEISTERPILZE-TYPE:task-due',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return { uid, ics: foldIcsLines(lines.join('\r\n')) };
}

// Convert a custom calendar event to VEVENT .ics content
function customEventToVEVENT(event) {
  const uid = event.caldavUid || ('cev-' + event.id + '@meisterpilze');
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
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meisterpilze Lab Tracker//EN',
  ];
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
  lines.push('BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + now,
    dtstart,
    dtend,
    'SUMMARY:' + (event.title || '').replace(/\n/g, '\\n'),
    'CATEGORIES:' + (event.category || 'Benutzerdefiniert'),
    'TRANSP:TRANSPARENT',
    'X-MEISTERPILZE-TYPE:custom-event',
  );
  if (event.description) lines.push('DESCRIPTION:' + event.description.replace(/\n/g, '\\n'));
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return { uid, ics: foldIcsLines(lines.join('\r\n')) };
}

// Delete a task's .ics file
function deleteTaskFromCalendar(uid, calName) {
  calName = calName || 'meisterpilze';
  const file = path.join(CAL_DIR, calName, uid + '.ics');
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ── Auto CalDAV sync helpers ───────────────────────────────
// Push a batch due-date VEVENT to CalDAV (server-side, called after mutations)
function autoPushBatchCaldav(batch) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    if (!batch || !batch.due) return;
    const dir = ensureCalDir('meisterpilze');
    const { uid, ics } = batchToVEVENT(batch);
    fs.writeFileSync(path.join(dir, uid + '.ics'), ics, 'utf8');
  } catch (e) { console.error('autoPushBatchCaldav error:', e.message); }
}

// Remove a batch's CalDAV .ics file
function autoDeleteBatchCaldav(batchId) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    const uid = 'batch-' + batchId + '@meisterpilze';
    const file = path.join(CAL_DIR, 'meisterpilze', uid + '.ics');
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) { console.error('autoDeleteBatchCaldav error:', e.message); }
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
    // Due-date VEVENT: respect privacy — only shared if not private
    if (task.dueDate && !isPrivate) {
      const dir = ensureCalDir('meisterpilze');
      const { uid, ics } = taskDueToVEVENT(task);
      fs.writeFileSync(path.join(dir, uid + '.ics'), ics, 'utf8');
    }
  } catch (e) { console.error('autoPushTaskCaldav error:', e.message); }
}

// Remove a task's CalDAV files (VTODO + VEVENT) from all calendars
function autoDeleteTaskCaldav(taskId) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    const task = db.readTaskById(database, taskId);
    if (task && task.caldavUid) {
      // Remove from shared calendar
      deleteTaskFromCalendar(task.caldavUid, 'meisterpilze');
      // Remove from personal calendar if assigned
      if (task.assignee) {
        const slug = task.assignee.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        deleteTaskFromCalendar(task.caldavUid, slug);
      }
      // Also remove VEVENT for due date
      const eventFile = path.join(CAL_DIR, 'meisterpilze', task.caldavUid + '-event.ics');
      if (fs.existsSync(eventFile)) fs.unlinkSync(eventFile);
    }
  } catch (e) { console.error('autoDeleteTaskCaldav error:', e.message); }
}

// Push a custom calendar event to CalDAV
function autoSyncCalendarEvent(ev) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    if (!ev.startDate && !ev.start_date) return;
    const normalized = { id: ev.id, title: ev.title, startDate: ev.startDate || ev.start_date, endDate: ev.endDate || ev.end_date, allDay: ev.allDay != null ? ev.allDay : ev.all_day, startTime: ev.startTime || ev.start_time, endTime: ev.endTime || ev.end_time, category: ev.category, description: ev.description, caldavUid: ev.caldavUid || ev.caldav_uid };
    const dir = ensureCalDir('meisterpilze');
    const { uid, ics } = customEventToVEVENT(normalized);
    fs.writeFileSync(path.join(dir, uid + '.ics'), ics, 'utf8');
  } catch (e) { console.error('autoSyncCalendarEvent error:', e.message); }
}

// Remove a custom calendar event's CalDAV file
function autoDeleteCalendarEventCaldav(eventId) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    const uid = 'cev-' + eventId + '@meisterpilze';
    const file = path.join(CAL_DIR, 'meisterpilze', uid + '.ics');
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) { console.error('autoDeleteCalendarEventCaldav error:', e.message); }
}

// Lightweight CalDAV sync after full-state save — writes all due dates & events
function autoSyncAllCaldav(data) {
  try {
    const cfg = db.readCaldavConfig(database);
    if (!cfg.enabled) return;
    const sharedDir = ensureCalDir('meisterpilze');
    const writtenUids = new Set();
    // Batch due dates → shared calendar
    for (const b of (data.batches || [])) {
      if (!b.due) continue;
      try { const { uid, ics } = batchToVEVENT(b); fs.writeFileSync(path.join(sharedDir, uid + '.ics'), ics, 'utf8'); writtenUids.add(uid + '.ics'); } catch (e) { /* skip */ }
    }
    // Task VTODOs → shared + personal calendars
    for (const t of (data.manualTasks || [])) {
      try {
        const isPriv = t.private === 1 || t.private === true;
        if (!isPriv) { writeTaskToCalendar(t, 'meisterpilze'); }
        if (t.assignee) {
          const slug = t.assignee.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          writeTaskToCalendar(t, slug);
        }
      } catch (e) { /* skip */ }
    }
    // Task due dates → shared calendar (respect privacy)
    for (const t of (data.manualTasks || [])) {
      if (!t.dueDate) continue;
      const isPrivate = t.private === 1 || t.private === true;
      if (isPrivate) continue;
      try { const { uid, ics } = taskDueToVEVENT(t); fs.writeFileSync(path.join(sharedDir, uid + '.ics'), ics, 'utf8'); writtenUids.add(uid + '.ics'); } catch (e) { /* skip */ }
    }
    // Custom events → shared calendar
    for (const ev of (data.calendarEvents || [])) {
      try { const { uid, ics } = customEventToVEVENT(ev); fs.writeFileSync(path.join(sharedDir, uid + '.ics'), ics, 'utf8'); writtenUids.add(uid + '.ics'); } catch (e) { /* skip */ }
    }
    // Clean orphaned meisterpilze-generated files in shared calendar
    try {
      const existing = fs.readdirSync(sharedDir).filter(f => f.endsWith('.ics'));
      for (const f of existing) {
        const filePath = path.join(sharedDir, f);
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('X-MEISTERPILZE-TYPE') && !writtenUids.has(f)) fs.unlinkSync(filePath);
      }
    } catch (e) { /* ignore */ }
  } catch (e) { console.error('autoSyncAllCaldav error:', e.message); }
}

// Full sync: write all tasks to calendar directories
function syncAllTasksLocal(data) {
  const cfg = data.caldav || {};
  const tasks = data.manualTasks || [];
  const results = { pushed: 0, errors: 0, calendarsCreated: 0 };

  // Ensure shared calendar
  const sharedDir = ensureCalDir('meisterpilze');

  // Create per-user calendars for all users with accounts
  const users = db.listUsers(database);
  for (const u of users) {
    const slug = u.username.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    ensureCalDir(slug);
  }

  // Write each task as VTODO
  for (const task of tasks) {
    try {
      const isPrivate = task.private === 1 || task.private === true;
      // Shared calendar: all non-private tasks
      if (!isPrivate) {
        writeTaskToCalendar(task, 'meisterpilze');
      }
      // Personal calendar: if assigned to someone
      if (task.assignee) {
        const slug = task.assignee.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        writeTaskToCalendar(task, slug);
      }
      results.pushed++;
    } catch (e) {
      results.errors++;
    }
  }

  // Write due dates & events as VEVENTs to shared calendar
  const batches = data.batches || [];
  const writtenUids = new Set();

  // Batch due dates
  for (const b of batches) {
    if (!b.due) continue;
    try {
      const { uid, ics } = batchToVEVENT(b);
      fs.writeFileSync(path.join(sharedDir, uid + '.ics'), ics, 'utf8');
      writtenUids.add(uid + '.ics');
      results.pushed++;
    } catch (e) { results.errors++; }
  }

  // Task due dates as events (respect privacy)
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const isPrivate = task.private === 1 || task.private === true;
    if (isPrivate) continue;
    try {
      const { uid, ics } = taskDueToVEVENT(task);
      fs.writeFileSync(path.join(sharedDir, uid + '.ics'), ics, 'utf8');
      writtenUids.add(uid + '.ics');
      results.pushed++;
    } catch (e) { results.errors++; }
  }

  // Custom calendar events
  const customEvents = data.calendarEvents || [];
  for (const ev of customEvents) {
    try {
      const { uid, ics } = customEventToVEVENT(ev);
      fs.writeFileSync(path.join(sharedDir, uid + '.ics'), ics, 'utf8');
      writtenUids.add(uid + '.ics');
      results.pushed++;
    } catch (e) { results.errors++; }
  }

  // Clean up orphaned .ics files in shared calendar
  try {
    const existing = fs.readdirSync(sharedDir).filter(f => f.endsWith('.ics'));
    for (const f of existing) {
      const filePath = path.join(sharedDir, f);
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('X-MEISTERPILZE-TYPE') && !writtenUids.has(f)) fs.unlinkSync(filePath);
    }
  } catch (e) { /* ignore cleanup errors */ }

  return results;
}

// ── CalDAV HTTP handler ─────────────────────────────────────
// Handles requests under /caldav/
function handleCaldav(req, res) {
  // DAV headers for all CalDAV responses (no CORS — CalDAV clients don't need it)
  res.setHeader('DAV', '1, 2, 3, calendar-access');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR, OPTIONS, PROPPATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Depth, Authorization, If-Match, If-None-Match');

  // Auth check — returns user account object or false
  const caldavUser = checkCaldavAuth(req);
  if (!caldavUser) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Meisterpilze CalDAV"' });
    res.end('Unauthorized');
    return;
  }
  req.caldavUser = caldavUser;

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
        const displayName = cal === 'meisterpilze' ? 'Meisterpilze (Betrieb)' : cal.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const compType = 'VTODO';
        const compType2v = 'VEVENT';
        const colorProp = cal === 'meisterpilze' ? '\n        <x:calendar-color xmlns:x="http://apple.com/ns/ical/">#22c55e</x:calendar-color>' : '';
        responses += `\n  <d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(cal)}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>${escapeXml(displayName)}</d:displayname>
        <c:supported-calendar-component-set><c:comp name="${compType}"/><c:comp name="${compType2v}"/></c:supported-calendar-component-set>${colorProp}
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
    const displayName = calName === 'meisterpilze' ? 'Meisterpilze (Betrieb)' : calName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const compType2 = 'VTODO';
    const compType2ev = 'VEVENT';
    const colorProp2 = calName === 'meisterpilze' ? '\n        <x:calendar-color xmlns:x="http://apple.com/ns/ical/">#22c55e</x:calendar-color>' : '';
    let responses = `<d:response>
    <d:href>/caldav/calendars/${encodeURIComponent(calName)}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>${escapeXml(displayName)}</d:displayname>
        <c:supported-calendar-component-set><c:comp name="${compType2}"/><c:comp name="${compType2ev}"/></c:supported-calendar-component-set>${colorProp2}
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

    // Bidirectional sync: if a VEVENT in shared calendar is updated via CalDAV client, update DB
    if (calName === 'meisterpilze' && body.includes('VEVENT')) {
      try {
        const dtMatch = body.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
        const typeMatch = body.match(/X-MEISTERPILZE-TYPE:(.*)/);
        const batchMatch = body.match(/X-MEISTERPILZE-BATCH:(.*)/);
        if (dtMatch && typeMatch) {
          const newDate = dtMatch[1] + '-' + dtMatch[2] + '-' + dtMatch[3];
          const evType = typeMatch[1].trim();
          if (evType === 'batch-due' && batchMatch) {
            const batchId = batchMatch[1].trim();
            db.updateBatchDue(database, batchId, newDate + 'T12:00:00.000Z');
          } else if (evType === 'task-due') {
            const uidMatch = body.match(/UID:(.*)/);
            if (uidMatch) {
              const taskUid = uidMatch[1].trim().replace(/-event$/, '');
              db.updateTaskDueDate(database, taskUid, newDate);
            }
          }
        }
      } catch (e) { console.error('CalDAV VEVENT bidirectional sync error:', e); }
    }

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

  // ── Security headers ──
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // ── Well-known CalDAV discovery (RFC 6764) ──
  if(req.url.startsWith('/.well-known/caldav')){
    res.writeHead(301,{'Location':'/caldav/'});
    res.end();return;
  }

  // ── CalDAV requests ──
  if(req.url.startsWith('/caldav')){
    return handleCaldav(req,res);
  }

  // CORS — only allow same-origin requests (no cross-origin API access)
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
        if(!username||!password||password.length<8){
          res.writeHead(400,{'Content-Type':'application/json'});
          res.end(JSON.stringify({error:'Username and password (min 8 chars) required'}));return;
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
        if(!username||!password||password.length<8){
          res.writeHead(400,{'Content-Type':'application/json'});
          res.end(JSON.stringify({error:'Username and password (min 8 chars) required'}));return;
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
    let dbOk=false;
    try{database.prepare('SELECT 1').get();dbOk=true;}catch(e){}
    const status=dbOk?'ok':'degraded';
    res.writeHead(dbOk?200:503,{'Content-Type':'application/json'});
    res.end(JSON.stringify({status,db:dbOk?'connected':'error',uptime:process.uptime(),version:require('./package.json').version}));
    return;
  }

  // SSE endpoint for real-time sync
  if(req.method==='GET'&&req.url==='/api/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
    res.write('data: {"type":"connected"}\n\n');
    sseClients.push(res);
    req.on('close',()=>{const i=sseClients.indexOf(res);if(i>=0)sseClients.splice(i,1)});
    return;
  }

  // GET /api/data
  if(req.method==='GET'&&req.url==='/api/data'){
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(readData()));return;
  }

  // POST /api/data — full-state save (used by client saveData())
  if(req.method==='POST'&&req.url==='/api/data'){
    jsonBody(req,res,(e,data)=>{
      if(e){jsonErr(res,400,e.message);return}
      try{writeData(data);const version=db.getDataVersion(database);broadcastSSE(res);jsonOk(res,{version});try{autoSyncAllCaldav(data)}catch(ce){console.error('CalDAV auto-sync:',ce.message)}}catch(err){jsonErr(res,400,err.message)}
    });return;
  }

  // ── ATOMIC REST ENDPOINTS ────────────────────────────────────

  // -- Batches --
  if(req.method==='POST'&&req.url==='/api/batches'){
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{db.insertBatch(database,data);autoPushBatchCaldav(data);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}});return;
  }
  const batchMatch=req.url.match(/^\/api\/batches\/([^/]+)\/bags$/);
  if(req.method==='PATCH'&&batchMatch){
    const id=decodeURIComponent(batchMatch[1]);
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{db.addBagsToBatch(database,id,data.add||[],data.newQty);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}});return;
  }
  const batchIdMatch=req.url.match(/^\/api\/batches\/([^/]+)$/);
  if(req.method==='PATCH'&&batchIdMatch){
    const id=decodeURIComponent(batchIdMatch[1]);
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{db.updateBatchField(database,id,data);if(data.due){const b=db.readBatchById(database,id);if(b)autoPushBatchCaldav(b)}broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}});return;
  }
  if(req.method==='DELETE'&&batchIdMatch){
    const id=decodeURIComponent(batchIdMatch[1]);
    try{autoDeleteBatchCaldav(id);db.deleteBatchById(database,id);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}return;
  }

  // -- Scan Log --
  if(req.method==='POST'&&req.url==='/api/scan-log'){
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{const ids=db.appendScanEntries(database,data.entries||[]);broadcastSSE(res);jsonOk(res,{ids})}catch(err){jsonErr(res,400,err.message)}});return;
  }
  const scanLastMatch=req.url.match(/^\/api\/scan-log\/last\/(\d+)$/);
  if(req.method==='DELETE'&&scanLastMatch){
    try{db.deleteLastScanEntries(database,parseInt(scanLastMatch[1]));broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}return;
  }
  const scanIdMatch=req.url.match(/^\/api\/scan-log\/(\d+)$/);
  if(req.method==='DELETE'&&scanIdMatch){
    try{db.deleteScanEntryById(database,parseInt(scanIdMatch[1]));broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}return;
  }
  if(req.method==='DELETE'&&req.url==='/api/scan-log'){
    try{db.clearScanLog(database);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}return;
  }

  // -- Harvests --
  if(req.method==='POST'&&req.url==='/api/harvests'){
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{const id=db.insertHarvest(database,data);broadcastSSE(res);jsonOk(res,{id})}catch(err){jsonErr(res,400,err.message)}});return;
  }

  // -- Cultures --
  if(req.method==='POST'&&req.url==='/api/cultures'){
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{db.insertCultures(database,data.cultures||[]);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}});return;
  }
  const cultureMatch=req.url.match(/^\/api\/cultures\/([^/]+)$/);
  if(req.method==='PATCH'&&cultureMatch){
    const id=decodeURIComponent(cultureMatch[1]);
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{db.updateCulture(database,id,data);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}});return;
  }

  // -- Tasks --
  if(req.method==='POST'&&req.url==='/api/tasks'){
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{const id=db.insertTask(database,data);if(data.dueDate){const t=db.readTaskById(database,id);if(t)autoPushTaskCaldav(t)}broadcastSSE(res);jsonOk(res,{id})}catch(err){jsonErr(res,400,err.message)}});return;
  }
  const taskMatch=req.url.match(/^\/api\/tasks\/(\d+)$/);
  if(req.method==='PATCH'&&taskMatch){
    const id=parseInt(taskMatch[1]);
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{db.updateTaskById(database,id,data);const t=db.readTaskById(database,id);if(t)autoPushTaskCaldav(t);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}});return;
  }
  if(req.method==='DELETE'&&taskMatch){
    const id=parseInt(taskMatch[1]);
    try{autoDeleteTaskCaldav(id);db.deleteTaskById(database,id);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}return;
  }

  // -- Team Members --
  if(req.method==='POST'&&req.url==='/api/team'){
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{const id=db.insertMember(database,data);broadcastSSE(res);jsonOk(res,{id})}catch(err){jsonErr(res,400,err.message)}});return;
  }
  const teamMatch=req.url.match(/^\/api\/team\/(\d+)$/);
  if(req.method==='DELETE'&&teamMatch){
    const id=parseInt(teamMatch[1]);
    try{db.deleteMember(database,id);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}return;
  }

  // -- Assets --
  if(req.method==='POST'&&req.url==='/api/assets'){
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{db.upsertAsset(database,data);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}});return;
  }
  const assetMatch=req.url.match(/^\/api\/assets\/([^/]+)$/);
  if(req.method==='DELETE'&&assetMatch){
    const id=decodeURIComponent(assetMatch[1]);
    try{db.deleteAssetById(database,id);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}return;
  }

  // -- CalDAV Config --
  if(req.method==='POST'&&req.url==='/api/caldav/config'){
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{db.updateCaldavCfg(database,data);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}});return;
  }

  // -- Calendar Events --
  if(req.method==='POST'&&req.url==='/api/calendar-events'){
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{db.insertCalendarEvent(database,data);autoSyncCalendarEvent(data);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}});return;
  }
  const calEvMatch=req.url.match(/^\/api\/calendar-events\/([^/]+)$/);
  if(req.method==='PATCH'&&calEvMatch){
    const id=decodeURIComponent(calEvMatch[1]);
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{db.updateCalendarEvent(database,id,data);autoSyncCalendarEvent(Object.assign({id},data));broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}});return;
  }
  if(req.method==='DELETE'&&calEvMatch){
    const id=decodeURIComponent(calEvMatch[1]);
    try{autoDeleteCalendarEventCaldav(id);db.deleteCalendarEvent(database,id);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}return;
  }

  // -- Inventory Delta --
  if(req.method==='POST'&&req.url==='/api/inventory/delta'){
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{const val=db.applyInventoryDelta(database,data.mat,data.deltaKg,data.type||null,data.ref||null);broadcastSSE(res);jsonOk(res,{value:val})}catch(err){jsonErr(res,400,err.message)}});return;
  }
  if(req.method==='POST'&&req.url==='/api/inventory/set'){
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{const val=db.setInventoryAbsolute(database,data.mat,data.value,data.type||null,data.ref||null);broadcastSSE(res);jsonOk(res,{value:val})}catch(err){jsonErr(res,400,err.message)}});return;
  }
  if(req.method==='POST'&&req.url==='/api/inventory/config'){
    jsonBody(req,res,(e,data)=>{if(e){jsonErr(res,400,e.message);return}try{db.updateInventoryConfig(database,data.thresholds,data.avgComposition);broadcastSSE(res);jsonOk(res)}catch(err){jsonErr(res,400,err.message)}});return;
  }

  // -- Backup Download (encrypted .db) --
  if(req.method==='POST'&&req.url==='/api/backup/download'){
    jsonBody(req,res,(e,data)=>{
      let tmpDest;
      try{
        if(!data||!data.password||data.password.length<8){jsonErr(res,400,'Password required (min 8 characters)');return}
        // Create a fresh VACUUM INTO temp file for a consistent snapshot
        tmpDest=path.join(BACKUP_DIR,'_download_tmp_'+Date.now()+'.db');
        db.backupDb(database,tmpDest);
        const plain=fs.readFileSync(tmpDest);
        try{fs.unlinkSync(tmpDest)}catch(e){}
        tmpDest=null;
        // Encrypt: salt(32) + iv(12) + authTag(16) + ciphertext
        const salt=crypto.randomBytes(32);
        const key=crypto.scryptSync(data.password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
        const iv=crypto.randomBytes(12);
        const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
        const enc=Buffer.concat([cipher.update(plain),cipher.final()]);
        const tag=cipher.getAuthTag();
        const out=Buffer.concat([salt,iv,tag,enc]);
        const stamp=new Date().toISOString().slice(0,10);
        res.writeHead(200,{
          'Content-Type':'application/octet-stream',
          'Content-Disposition':'attachment; filename="meisterpilze_backup_'+stamp+'.enc"',
          'Content-Length':out.length
        });
        res.end(out);
      }catch(err){
        if(tmpDest)try{fs.unlinkSync(tmpDest)}catch(e){}
        log('error','Backup download failed',{error:err.message});
        jsonErr(res,500,'Backup download failed');
      }
    });return;
  }

  // -- Backup Restore (encrypted .db) --
  if(req.method==='POST'&&req.url==='/api/backup/restore'){
    const chunks=[];let sz=0;const MAX_BACKUP=50*1024*1024; // 50 MB limit for backup files
    req.on('data',c=>{sz+=c.length;if(sz>MAX_BACKUP){req.destroy();return}chunks.push(c)});
    req.on('end',()=>{
      let tmpPath;
      try{
        const raw=Buffer.concat(chunks);
        const password=req.headers['x-backup-password']||'';
        if(!password){jsonErr(res,400,'Password required');return}
        // Decrypt: salt(32) + iv(12) + authTag(16) + ciphertext
        if(raw.length<60+16){jsonErr(res,400,'File too small to be a valid backup');return}
        const salt=raw.subarray(0,32);
        const iv=raw.subarray(32,44);
        const tag=raw.subarray(44,60);
        const ciphertext=raw.subarray(60);
        const key=crypto.scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
        const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
        decipher.setAuthTag(tag);
        let plain;
        try{plain=Buffer.concat([decipher.update(ciphertext),decipher.final()])}
        catch(decErr){jsonErr(res,401,'Wrong password or corrupted file');return}
        // Validate SQLite header
        if(plain.length<16||plain.toString('utf8',0,15)!=='SQLite format 3'){jsonErr(res,400,'Decrypted file is not a valid database');return}
        // Write to temp with restrictive permissions, validate schema
        tmpPath=path.join(BACKUP_DIR,'_restore_tmp_'+Date.now()+'.db');
        fs.writeFileSync(tmpPath,plain,{mode:0o600});
        let tmpDb;
        try{
          tmpDb=db.openDb(tmpPath); // validates schema + runs migrations
          tmpDb.close();
        }catch(valErr){
          try{fs.unlinkSync(tmpPath)}catch(e){}
          log('error','Backup validation failed',{error:valErr.message});
          jsonErr(res,400,'Database validation failed');return;
        }
        // Atomic swap: backup current db, replace, reopen — rollback on failure
        const bakPath=DB_FILE+'.pre-restore.bak';
        try{database.close()}catch(e){}
        try{fs.copyFileSync(DB_FILE,bakPath)}catch(e){} // keep old db as safety net
        fs.renameSync(tmpPath,DB_FILE);
        tmpPath=null;
        try{
          database=db.openDb(DB_FILE);
        }catch(openErr){
          // Rollback: restore the old database
          log('error','Failed to open restored database, rolling back',{error:openErr.message});
          try{fs.copyFileSync(bakPath,DB_FILE)}catch(e){}
          database=db.openDb(DB_FILE);
          jsonErr(res,500,'Restore failed, previous data has been preserved');return;
        }
        // Cleanup backup of old db
        try{fs.unlinkSync(bakPath)}catch(e){}
        // Trigger auto-sync of CalDAV after restore
        try{autoSyncAllCaldav(readData())}catch(ce){console.error('CalDAV post-restore sync:',ce.message)}
        broadcastSSE(res);
        jsonOk(res);
      }catch(err){
        if(tmpPath)try{fs.unlinkSync(tmpPath)}catch(e){}
        log('error','Backup restore failed',{error:err.message});
        jsonErr(res,500,'Backup restore failed');
      }
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
        const isPrivate=task.private===1||task.private===true;
        let uid;
        // Shared calendar: all non-private tasks
        if(!isPrivate){
          uid=writeTaskToCalendar(task,'meisterpilze');
        }
        // Personal calendar: if assigned
        if(task.assignee){
          const slug=task.assignee.toLowerCase().replace(/[^a-z0-9]+/g,'-');
          uid=writeTaskToCalendar(task,slug);
        }
        if(!uid) uid=writeTaskToCalendar(task,'meisterpilze'); // fallback if private + unassigned
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

  // POST /api/caldav/push-event — write a single custom event to calendar file
  if(req.method==='POST'&&req.url==='/api/caldav/push-event'){
    let body='';let bodySize=0;
    req.on('data',c=>{bodySize+=c.length;if(bodySize>MAX_BODY_SIZE){req.destroy();return}body+=c});
    req.on('end',()=>{
      try{
        const{event}=JSON.parse(body);
        const dir=ensureCalDir('meisterpilze');
        const{uid,ics}=customEventToVEVENT(event);
        fs.writeFileSync(path.join(dir,uid+'.ics'),ics,'utf8');
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true,uid}));
      }catch(e){
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false,error:e.message}));
      }
    });return;
  }

  // POST /api/caldav/push-batch — write a single batch due date to calendar file
  if(req.method==='POST'&&req.url==='/api/caldav/push-batch'){
    let body='';let bodySize=0;
    req.on('data',c=>{bodySize+=c.length;if(bodySize>MAX_BODY_SIZE){req.destroy();return}body+=c});
    req.on('end',()=>{
      try{
        const{batch}=JSON.parse(body);
        const dir=ensureCalDir('meisterpilze');
        const{uid,ics}=batchToVEVENT(batch);
        fs.writeFileSync(path.join(dir,uid+'.ics'),ics,'utf8');
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true,uid}));
      }catch(e){
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false,error:e.message}));
      }
    });return;
  }

  // GET /api/caldav/import — read external events from calendar files
  if(req.method==='GET'&&req.url==='/api/caldav/import'){
    try{
      const imported=[];
      if(fs.existsSync(CAL_DIR)){
        const dirs=fs.readdirSync(CAL_DIR).filter(d=>fs.statSync(path.join(CAL_DIR,d)).isDirectory());
        for(const dir of dirs){
          const files=fs.readdirSync(path.join(CAL_DIR,dir)).filter(f=>f.endsWith('.ics'));
          for(const f of files){
            try{
              const content=fs.readFileSync(path.join(CAL_DIR,dir,f),'utf8');
              // Skip meistertracker-generated events
              if(content.includes('X-MEISTERPILZE-TYPE'))continue;
              if(!content.includes('VEVENT')&&!content.includes('VTODO'))continue;
              const uid=(content.match(/UID:(.*)/)||[])[1]?.trim()||f;
              const summary=(content.match(/SUMMARY:(.*)/)||[])[1]?.trim()||'(kein Titel)';
              const dtRaw=(content.match(/DTSTART[^:]*:([\dT]+)/)||[])[1]||'';
              let date='',startTime=null,allDay=true;
              if(dtRaw.length===8){date=dtRaw.slice(0,4)+'-'+dtRaw.slice(4,6)+'-'+dtRaw.slice(6,8)}
              else if(dtRaw.length>=15){date=dtRaw.slice(0,4)+'-'+dtRaw.slice(4,6)+'-'+dtRaw.slice(6,8);startTime=dtRaw.slice(9,11)+':'+dtRaw.slice(11,13);allDay=false}
              if(!date)continue;
              const dtEndRaw=(content.match(/DTEND[^:]*:([\dT]+)/)||[])[1]||'';
              let endTime=null;
              if(dtEndRaw.length>=15){endTime=dtEndRaw.slice(9,11)+':'+dtEndRaw.slice(11,13)}
              const desc=(content.match(/DESCRIPTION:(.*)/)||[])[1]?.trim()||null;
              imported.push({uid,summary:summary.replace(/\\n/g,' '),date,startTime,endTime,allDay,description:desc,calendar:dir});
            }catch(e){/* skip broken files */}
          }
        }
      }
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify(imported));
    }catch(e){
      res.writeHead(500,{'Content-Type':'application/json'});
      res.end(JSON.stringify([]));
    }
    return;
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

  // Path traversal protection — ensure resolved path stays within project dir
  const resolved = path.resolve(filePath);
  if(!resolved.startsWith(path.resolve(DIR))){
    res.writeHead(403);res.end('Forbidden');return;
  }

  fs.readFile(filePath,(err,data)=>{
    if(err){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(filePath)]||'application/octet-stream'});
    res.end(data);
  });
}

// ── SERVER CREATION (HTTPS-only, HTTP fallback if no certs) ──
let server;
let protocol;
if(fs.existsSync(CERT_KEY)&&fs.existsSync(CERT_CRT)){
  const tlsOpts={key:fs.readFileSync(CERT_KEY),cert:fs.readFileSync(CERT_CRT)};
  server=https.createServer(tlsOpts,handleRequest);
  protocol='https';
}else{
  log('warn','TLS certificates not found — falling back to HTTP. Run: bash gen-cert.sh');
  server=http.createServer(handleRequest);
  protocol='http';
}

server.listen(PORT,'0.0.0.0',()=>{
  const ip=getLocalIP();
  console.log('');
  console.log('  Meisterpilze Lab Tracker is running!');
  console.log('');
  console.log('  Open on this PC:      '+protocol+'://localhost:'+PORT);
  console.log('  Open on phone/tablet: '+protocol+'://'+ip+':'+PORT);
  if(protocol==='http'){
    console.log('');
    console.log('  ⚠ WARNING: Running without HTTPS — iOS camera will not work.');
    console.log('  Run "bash gen-cert.sh" and restart to enable HTTPS.');
  }
  console.log('');
  console.log('  CalDAV server:        '+protocol+'://'+ip+':'+PORT+'/caldav/calendars/');
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
  server.close(() => {
    database.close();
    log('info', 'Server closed');
    process.exit(0);
  });
  setTimeout(() => { database.close(); process.exit(1); }, 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
