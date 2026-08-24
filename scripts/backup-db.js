#!/usr/bin/env node
'use strict';

// A snapshot that includes the WAL, taken with the engine the app already runs on.
//
// START.bat preferred the sqlite3 CLI for this and fell back to `copy` when it
// was missing. On Windows it is missing: the comment above the fallback said
// "Git for Windows ships sqlite3 in PATH", and it does not. So the fallback was
// never a fallback — it was the path that always ran.
//
// `copy` takes meistertracker.db and nothing else. In WAL mode the database file
// is only as current as the last checkpoint, and everything committed since then
// lives in meistertracker.db-wal. On the machine this was found on that was
// 4.1 MB of WAL against a 1.3 MB database, and five snapshots taken across one
// afternoon were byte-identical: same size, same mtime, all holding the state of
// the last checkpoint hours earlier. `copy` preserves the source mtime, which is
// why they all looked like they had been written at midday. Nothing failed, and
// nothing said anything.
//
// node is not an optional dependency here — it is what runs the server, so it is
// always present — and node:sqlite reads through the WAL exactly as the CLI would.
// VACUUM INTO is the operation of record: it produces a compact, fully consistent
// copy from a live database without stopping the writer.

const fs = require('fs');
const path = require('path');
const { DatabaseSync: Database } = require('node:sqlite');
const { backupDb } = require('../db.js');

function fail(msg) {
  process.stderr.write('backup-db: ' + msg + '\n');
  process.exit(1);
}

const [, , srcArg, destArg] = process.argv;
if (!srcArg || !destArg) {
  fail('usage: node scripts/backup-db.js <source.db> <dest.db>');
}

const src = path.resolve(srcArg);
const dest = path.resolve(destArg);

if (!fs.existsSync(src)) fail('source database not found: ' + src);
if (fs.existsSync(dest)) fail('refusing to overwrite an existing snapshot: ' + dest);

const destDir = path.dirname(dest);
if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });

let db;
try {
  // Deliberately not openDb(): that runs migrations, and a backup is the last
  // moment at which the database should be written to. A bare handle reads the
  // WAL the same way and changes nothing.
  db = new Database(src);
  // backupDb() checks the destination path and the free space before it runs.
  // It reads the source size off this property, which only openDb() sets, so a
  // bare handle would silently skip the disk-space pre-flight.
  Object.defineProperty(db, '_mpDbPath', { value: src, enumerable: false, writable: false });
  backupDb(db, dest);
} catch (e) {
  // A half-written target is worse than none: START.bat falls back to `copy` on
  // a non-zero exit, and it refuses to overwrite a file that already exists.
  try {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  } catch {
    /* the report below is what matters */
  }
  fail(e && e.message ? e.message : String(e));
} finally {
  try {
    if (db) db.close();
  } catch {
    /* closing a handle we are done with cannot change the result */
  }
}

if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
  fail('snapshot was not written: ' + dest);
}

process.stdout.write('backup-db: ' + dest + ' (' + fs.statSync(dest).size + ' bytes, WAL included)\n');
