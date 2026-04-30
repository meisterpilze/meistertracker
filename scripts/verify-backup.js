#!/usr/bin/env node
// Verify backup + restore end-to-end.
//
// Modes:
//   1. Default (no args): opens the live production database, takes a fresh
//      backup into a scratch dir, re-opens the copy, compares row counts,
//      runs PRAGMA integrity_check, then deletes. Exercises the
//      backup-then-restore round-trip but does NOT test any backup file
//      already on disk.
//
//   2. --restore-test <path>: copies <path> to a scratch location and opens
//      it through the same `openDb` codepath used by `/api/backup/restore`,
//      so any schema-ordering bug (e.g. R-02) is exposed. Use this to
//      verify a specific backup file before swapping it into place.
//
//   3. --latest: picks the most recent file in BACKUP_DIR matching either
//      the auto-backup pattern (`meisterpilze_backup_*`) or the manual
//      pattern (`meistertracker_*`) and runs --restore-test against it.
//      This is what an operator should run nightly.
//
// Usage:
//   node scripts/verify-backup.js
//   node scripts/verify-backup.js --restore-test backups/meisterpilze_backup_2026-04-29.db
//   node scripts/verify-backup.js --latest [--backup-dir backups]
//   node scripts/verify-backup.js [path-to-prod-db]   # legacy positional arg
//   node scripts/verify-backup.js -h | --help

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../db.js');

function log(msg) {
  process.stdout.write('[verify-backup] ' + msg + '\n');
}

function fail(msg, e) {
  process.stderr.write('[verify-backup] FAIL: ' + msg + (e ? ' — ' + e.message : '') + '\n');
  process.exit(1);
}

function printUsage() {
  process.stdout.write(
    [
      'Usage: node scripts/verify-backup.js [options] [path-to-prod-db]',
      '',
      'Modes:',
      '  (default)                  Round-trip backup + reopen of the live DB.',
      '  --restore-test <file>      Open <file> via the restore codepath.',
      '  --latest                   Pick the newest auto- or manual-backup',
      '                             from --backup-dir and run --restore-test.',
      '',
      'Options:',
      '  --backup-dir <path>        Backup directory (default: ./backups).',
      '  -h, --help                 Show this help.',
      ''
    ].join('\n')
  );
}

const AUTO_BACKUP_PREFIX = 'meisterpilze_backup_';
const MANUAL_BACKUP_PREFIX = 'meistertracker_';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--restore-test' && argv[i + 1]) {
      out.restoreTest = argv[++i];
    } else if (a === '--latest') {
      out.latest = true;
    } else if (a === '--backup-dir' && argv[i + 1]) {
      out.backupDir = argv[++i];
    } else if (a === '-h' || a === '--help') {
      out.help = true;
    } else if (!a.startsWith('--') && !out.prodDbArg) {
      out.prodDbArg = a;
    }
  }
  return out;
}

function findLatestBackup(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    fail('Could not read backup directory ' + dir, e);
  }
  const candidates = entries
    .filter((f) => f.endsWith('.db') && (f.startsWith(AUTO_BACKUP_PREFIX) || f.startsWith(MANUAL_BACKUP_PREFIX)))
    .map((f) => {
      const full = path.join(dir, f);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch (_) {
        return null;
      }
      return { file: f, full, mtimeMs: stat.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (candidates.length === 0) fail('No auto- or manual-backups found in ' + dir);
  return candidates[0];
}

function copyToScratch(srcPath) {
  if (!fs.existsSync(srcPath)) fail('Backup file not found: ' + srcPath);
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-backup-verify-'));
  const scratchPath = path.join(scratchDir, 'backup.db.tmp');
  fs.copyFileSync(srcPath, scratchPath);
  return { scratchDir, scratchPath };
}

function checkSqliteHeader(filePath) {
  const header = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
    fail('File does not have SQLite magic header — corrupt: ' + filePath);
  }
}

async function runRestoreTest(srcPath) {
  log('Restore-test target: ' + srcPath);
  const srcSize = fs.statSync(srcPath).size;
  log('Source size: ' + srcSize + ' bytes');
  if (srcSize < 1024) fail('Source file suspiciously small (< 1 KB): ' + srcSize + ' bytes');

  checkSqliteHeader(srcPath);
  log('Source has valid SQLite magic header');

  const { scratchDir, scratchPath } = copyToScratch(srcPath);
  log('Scratch path: ' + scratchPath);

  let opened;
  try {
    // Use the same openDb path as /api/backup/restore so any schema-ordering
    // bug (R-02 class) is exposed here too.
    opened = db.openDb(scratchPath);
  } catch (e) {
    try {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    } catch (_) {}
    fail('openDb() failed on backup file', e);
  }

  try {
    const integrity = opened.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') fail('integrity_check failed: ' + JSON.stringify(integrity));
    log('PRAGMA integrity_check: ok');

    const counts = {};
    for (const t of ['batches', 'users', 'scan_log', 'harvests', 'cultures']) {
      try {
        counts[t] = opened.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n;
      } catch (e) {
        counts[t] = 'err:' + e.message;
      }
    }
    let dataVersion = 'n/a';
    try {
      const v = opened.prepare('SELECT value FROM meta WHERE key = ?').get('data_version');
      if (v) dataVersion = v.value;
    } catch (_) {}
    log(
      'Row counts: ' +
        Object.keys(counts)
          .map((k) => k + '=' + counts[k])
          .join(' ') +
        ' data_version=' +
        dataVersion
    );
  } finally {
    try {
      opened.close();
    } catch (_) {}
    try {
      fs.rmSync(scratchDir, { recursive: true, force: true });
      log('Scratch directory removed');
    } catch (e) {
      log('WARN: could not remove scratch dir — ' + e.message);
    }
  }

  log('PASS — restore-test succeeded for ' + srcPath);
}

async function runRoundTrip(prodDbPath) {
  log('Prod DB: ' + prodDbPath);
  if (!fs.existsSync(prodDbPath)) fail('Prod DB not found at ' + prodDbPath);

  const prodSize = fs.statSync(prodDbPath).size;
  log('Prod DB size: ' + prodSize + ' bytes');

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-backup-verify-'));
  const scratchPath = path.join(scratchDir, 'backup.db');
  log('Scratch path: ' + scratchPath);

  let src;
  try {
    src = db.openDb(prodDbPath);
  } catch (e) {
    fail('Could not open prod DB (is another writer blocking?)', e);
  }

  let srcBatches, srcUsers, srcScans, srcVersion;
  try {
    srcBatches = src.prepare('SELECT COUNT(*) AS n FROM batches').get().n;
    srcUsers = src.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    srcScans = src.prepare('SELECT COUNT(*) AS n FROM scan_log').get().n;
    srcVersion = src.prepare('SELECT value FROM meta WHERE key = ?').get('data_version');
  } catch (e) {
    fail('Could not read baseline row counts from prod DB', e);
  }
  log(
    'Prod baseline: batches=' +
      srcBatches +
      ' users=' +
      srcUsers +
      ' scans=' +
      srcScans +
      ' data_version=' +
      (srcVersion ? srcVersion.value : 'n/a')
  );

  const tStart = Date.now();
  try {
    await db.backupDb(src, scratchPath);
  } catch (e) {
    fail('db.backupDb() threw', e);
  }
  const elapsedMs = Date.now() - tStart;
  log('Backup completed in ' + elapsedMs + ' ms');

  if (!fs.existsSync(scratchPath)) fail('Backup file was not created');
  const backupSize = fs.statSync(scratchPath).size;
  log('Backup file size: ' + backupSize + ' bytes');
  if (backupSize < 1024) fail('Backup file suspiciously small (< 1 KB)');

  checkSqliteHeader(scratchPath);
  log('Backup file has valid SQLite magic header');

  let dst;
  try {
    dst = db.openDb(scratchPath);
  } catch (e) {
    fail('Could not open backup file', e);
  }
  try {
    const integrity = dst.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') fail('integrity_check failed: ' + JSON.stringify(integrity));
    log('PRAGMA integrity_check: ok');

    const dstBatches = dst.prepare('SELECT COUNT(*) AS n FROM batches').get().n;
    const dstUsers = dst.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const dstScans = dst.prepare('SELECT COUNT(*) AS n FROM scan_log').get().n;
    const dstVersion = dst.prepare('SELECT value FROM meta WHERE key = ?').get('data_version');
    log(
      'Backup counts: batches=' +
        dstBatches +
        ' users=' +
        dstUsers +
        ' scans=' +
        dstScans +
        ' data_version=' +
        (dstVersion ? dstVersion.value : 'n/a')
    );

    if (dstBatches !== srcBatches) fail('batches row count mismatch: src=' + srcBatches + ' dst=' + dstBatches);
    if (dstUsers !== srcUsers) fail('users row count mismatch: src=' + srcUsers + ' dst=' + dstUsers);
    if (dstScans !== srcScans) fail('scan_log row count mismatch: src=' + srcScans + ' dst=' + dstScans);
    log('All row counts match between prod and backup');
  } finally {
    try {
      dst.close();
    } catch (_) {}
    try {
      src.close();
    } catch (_) {}
  }

  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    log('Scratch directory removed');
  } catch (e) {
    log('WARN: could not remove scratch dir — ' + e.message);
  }

  log('PASS — backup + restore-verify cycle succeeded');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // --latest implies --restore-test against the newest file in --backup-dir.
  if (args.latest) {
    const dir = args.backupDir || path.join(__dirname, '..', 'backups');
    log('Backup dir: ' + dir);
    const latest = findLatestBackup(dir);
    log('Latest backup: ' + latest.file + ' (mtime ' + new Date(latest.mtimeMs).toISOString() + ')');
    await runRestoreTest(latest.full);
    return;
  }

  if (args.restoreTest) {
    await runRestoreTest(args.restoreTest);
    return;
  }

  // Default: round-trip against prod DB.
  const prodDbPath =
    args.prodDbArg || path.join(path.dirname(path.dirname(path.dirname(path.dirname(__dirname)))), 'meistertracker.db');
  await runRoundTrip(prodDbPath);
}

main().catch((e) => fail('unexpected error', e));
