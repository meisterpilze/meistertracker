'use strict';
// Auto-backup rotation helper. Lives in scripts/ so it can be required by
// server.js AND imported into the test suite without booting the whole
// HTTP server.

const fs = require('fs');
const path = require('path');
const { tmpName } = require('./atomic-file.js');

// Auto-backup filename prefix. Default 'meisterpilze_backup_' for
// backwards compatibility with existing prod backup directories.
// Forks can override via env to brand their own deployment, but note
// existing files keep the old prefix and won't be rotated by the new
// pattern — pick a prefix BEFORE the first auto-backup runs, or
// rename existing files to match.
function _backupPrefix() {
  const v = process.env.BACKUP_FILENAME_PREFIX;
  if (v && /^[A-Za-z0-9_\-]+_$/.test(v)) return v;
  return 'meisterpilze_backup_';
}
const BACKUP_PREFIX = _backupPrefix();
function _escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Filenames matching this pattern are considered auto-backups and ARE
// candidates for rotation. Manual / encrypted backups and any other
// file in the directory are explicitly NOT candidates.
const AUTO_BACKUP_FILENAME = new RegExp('^' + _escapeRegex(BACKUP_PREFIX) + '\\d{4}-\\d{2}-\\d{2}\\.db$');

// Files newer than this threshold are NEVER deleted, regardless of retention
// policy. This is belt + suspenders against a future ordering regression
// where rotation runs AFTER writing today's file (the original R-01 bug).
const MIN_FILE_AGE_MS = 60_000;

// Rotate auto-backups in `dir`, keeping only files whose age is within
// `retentionDays`. Returns { kept, deleted, skipped, error? } so the caller
// can log the decision and tests can assert on it.
//
// Three guardrails:
//   1. Filter on AUTO_BACKUP_FILENAME so manual backups stay put.
//   2. Sort by mtime (newest first) — alphabetic sort happens to work for
//      the current ISO-date filename pattern but couples behaviour to the
//      filename, which is fragile.
//   3. Refuse to delete files whose mtime is < 60 seconds old.
function rotateAutoBackups(dir, retentionDays = 30) {
  const result = { kept: [], deleted: [], skipped: [] };
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return Object.assign(result, { error: 'readdir failed: ' + e.message });
  }
  const now = Date.now();
  const cutoffMs = retentionDays * 24 * 60 * 60 * 1000;
  const candidates = [];
  for (const f of entries) {
    if (!AUTO_BACKUP_FILENAME.test(f)) continue;
    const full = path.join(dir, f);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (e) {
      result.skipped.push({ file: f, reason: 'stat failed: ' + e.message });
      continue;
    }
    candidates.push({ file: f, full, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const c of candidates) {
    const ageMs = now - c.mtimeMs;
    if (ageMs <= cutoffMs) {
      result.kept.push(c.file);
      continue;
    }
    if (ageMs < MIN_FILE_AGE_MS) {
      result.skipped.push({ file: c.file, reason: 'mtime too recent (' + ageMs + 'ms ago)' });
      continue;
    }
    try {
      fs.unlinkSync(c.full);
      result.deleted.push(c.file);
    } catch (e) {
      result.skipped.push({ file: c.file, reason: 'unlink failed: ' + e.message });
    }
  }
  return result;
}

// Pre-update snapshots: the copy START.bat, update_server.sh and the GitHub
// webhook deploy (scripts/deploy-chain.js) each take right before new code,
// and its migrations, start. The digits are the PC's clock at that moment.
const PRE_UPDATE_SNAPSHOT_FILENAME = /^meistertracker_\d{8}_\d{6}\.db$/;

// The name the webhook deploy gives its snapshot (scripts/deploy-runner.js),
// from the PC's clock: local time, to the second. START.bat and
// update_server.sh build the same name in their own languages. It is defined
// here, beside the pattern above, because a name the rotation did not match
// would never be deleted: test/backup.test.js runs one through it.
function preUpdateSnapshotName(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    'meistertracker_' +
    String(date.getFullYear()) +
    p(date.getMonth() + 1) +
    p(date.getDate()) +
    '_' +
    p(date.getHours()) +
    p(date.getMinutes()) +
    p(date.getSeconds()) +
    '.db'
  );
}

// How many pre-update snapshots to keep. They used to be kept forever, which
// was harmless while an update meant someone running a script; the webhook
// deploys on every push to main, several times on a busy day, and each run
// leaves a full copy of the database behind. A snapshot is there to undo the
// update right after it, and the 30 days of auto-backups above carry the
// longer history.
const PRE_UPDATE_SNAPSHOT_KEEP = 10;

// What the rotation remembers between runs, beside the snapshots: every one it
// has seen, numbered in the order it first saw them. 0 marks a snapshot that
// was already there before the rotation existed.
const PRE_UPDATE_LEDGER = '.pre-update-snapshots.json';

function readLedger(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { missing: e.code === 'ENOENT', ledger: null };
  }
  try {
    const parsed = JSON.parse(raw);
    const valid =
      parsed &&
      Number.isInteger(parsed.next) &&
      parsed.next >= 1 &&
      parsed.seen &&
      typeof parsed.seen === 'object' &&
      Object.values(parsed.seen).every((n) => Number.isInteger(n) && n >= 0 && n < parsed.next);
    return { missing: false, ledger: valid ? parsed : null };
  } catch {
    return { missing: false, ledger: null };
  }
}

function writeLedger(file, ledger) {
  // The temporary name atomic-file.js uses, so the clean-up at start-up
  // recognises one a crash left behind.
  const tmp = tmpName(file);
  try {
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* the report below is what matters */
    }
    throw e;
  }
}

// Keep the newest `keep` pre-update snapshots in `dir` and delete the rest.
// Returns { kept, deleted, skipped, legacy, ledger?, error? }.
//
// "Newest" is the order the rotation first saw a snapshot in, kept in a ledger
// beside them, not a clock reading. Every writer names its snapshot after the
// PC's clock, and a clock that ran ahead for a while (or one that runs behind,
// after a dead CMOS battery) would make the snapshot just written look older
// than the rest and be the one to go. The rotation runs at every start-up, the
// moment after an update has written one, so it meets each new snapshot first
// as the newest: it was written since the last run. Snapshots that turn up
// together are ordered by their names, the best hint there is.
//
// Guardrails:
//   1. Only names that match PRE_UPDATE_SNAPSHOT_FILENAME exactly, and only
//      files. Auto-backups, .enc downloads, photo archives,
//      `meistertracker_backup.db` (START.bat's name when it cannot read the
//      clock) and anything renamed by hand are not candidates.
//   2. Snapshots that were there before the first run are left alone for good.
//      They used to be kept forever, and the docs said so; nothing deletes
//      them now without someone deciding to. A ledger that cannot be read
//      starts over the same way: everything present becomes one of these.
//   3. At least one is always kept, whatever `keep` says.
//   4. A file whose mtime is under MIN_FILE_AGE_MS old is never deleted, as
//      in rotateAutoBackups.
function rotatePreUpdateSnapshots(dir, keep = PRE_UPDATE_SNAPSHOT_KEEP) {
  const result = { kept: [], deleted: [], skipped: [], legacy: [] };
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return Object.assign(result, { error: 'readdir failed: ' + e.message });
  }
  const now = Date.now();
  const limit = Math.max(1, Math.floor(Number(keep)) || 1);
  const candidates = [];
  for (const f of entries) {
    if (!PRE_UPDATE_SNAPSHOT_FILENAME.test(f)) continue;
    const full = path.join(dir, f);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (e) {
      result.skipped.push({ file: f, reason: 'stat failed: ' + e.message });
      continue;
    }
    if (!stat.isFile()) continue;
    candidates.push({ file: f, full, mtimeMs: stat.mtimeMs });
  }

  const ledgerFile = path.join(dir, PRE_UPDATE_LEDGER);
  const read = readLedger(ledgerFile);
  const starting = !read.ledger;
  if (starting) result.ledger = read.missing ? 'created' : 'unreadable, started over';
  const seen = {};
  let next = starting ? 1 : read.ledger.next;
  const present = new Set(candidates.map((c) => c.file));
  // What the ledger knew and is still there; the rest is gone.
  if (!starting) {
    for (const [f, n] of Object.entries(read.ledger.seen)) if (present.has(f)) seen[f] = n;
  }
  // What is new since the last run, in name order.
  for (const c of candidates.filter((c) => !(c.file in seen)).sort((a, b) => (a.file < b.file ? -1 : 1))) {
    seen[c.file] = starting ? 0 : next++;
  }

  const rotated = [];
  for (const c of candidates) {
    if (seen[c.file] === 0) result.legacy.push(c.file);
    else rotated.push(c);
  }
  rotated.sort((a, b) => seen[b.file] - seen[a.file]);
  rotated.forEach((c, i) => {
    if (i < limit) {
      result.kept.push(c.file);
      return;
    }
    const ageMs = now - c.mtimeMs;
    if (ageMs < MIN_FILE_AGE_MS) {
      result.skipped.push({ file: c.file, reason: 'mtime too recent (' + ageMs + 'ms ago)' });
      return;
    }
    try {
      fs.unlinkSync(c.full);
      result.deleted.push(c.file);
      delete seen[c.file];
    } catch (e) {
      result.skipped.push({ file: c.file, reason: 'unlink failed: ' + e.message });
    }
  });

  try {
    writeLedger(ledgerFile, { next, seen });
  } catch (e) {
    result.error = 'ledger not written: ' + e.message;
  }
  return result;
}

module.exports = {
  AUTO_BACKUP_FILENAME,
  BACKUP_PREFIX,
  MIN_FILE_AGE_MS,
  PRE_UPDATE_LEDGER,
  PRE_UPDATE_SNAPSHOT_FILENAME,
  PRE_UPDATE_SNAPSHOT_KEEP,
  preUpdateSnapshotName,
  rotateAutoBackups,
  rotatePreUpdateSnapshots
};
