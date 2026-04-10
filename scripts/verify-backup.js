#!/usr/bin/env node
// Verify backup + restore end-to-end against the live production database.
// Safe to run while the server is up: opens a read-only connection, writes to
// a scratch path, re-opens the copy, counts rows, then deletes the copy.
//
// Usage: node scripts/verify-backup.js [path-to-prod-db]

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../db.js');

const PROD_DB =
  process.argv[2] || path.join(path.dirname(path.dirname(path.dirname(path.dirname(__dirname)))), 'meistertracker.db');

function log(msg) {
  process.stdout.write('[verify-backup] ' + msg + '\n');
}

function fail(msg, e) {
  process.stderr.write('[verify-backup] FAIL: ' + msg + (e ? ' — ' + e.message : '') + '\n');
  process.exit(1);
}

async function main() {
  log('Prod DB: ' + PROD_DB);
  if (!fs.existsSync(PROD_DB)) fail('Prod DB not found at ' + PROD_DB);

  const prodSize = fs.statSync(PROD_DB).size;
  log('Prod DB size: ' + prodSize + ' bytes');

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-backup-verify-'));
  const scratchPath = path.join(scratchDir, 'backup.db');
  log('Scratch path: ' + scratchPath);

  let src;
  try {
    src = db.openDb(PROD_DB);
  } catch (e) {
    fail('Could not open prod DB (is another writer blocking?)', e);
  }

  // Take a baseline row count from a well-known table (batches is always present).
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

  // SQLite file magic bytes: "SQLite format 3\000"
  const header = Buffer.alloc(16);
  const fd = fs.openSync(scratchPath, 'r');
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  if (header.toString('utf8', 0, 15) !== 'SQLite format 3')
    fail('Backup file does not have SQLite magic header — corrupt');
  log('Backup file has valid SQLite magic header');

  // Re-open the backup and verify row counts match the source
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

  // Clean up scratch files
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    log('Scratch directory removed');
  } catch (e) {
    log('WARN: could not remove scratch dir — ' + e.message);
  }

  log('PASS — backup + restore-verify cycle succeeded');
}

main().catch((e) => fail('unexpected error', e));
