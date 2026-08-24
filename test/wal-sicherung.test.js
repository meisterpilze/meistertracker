'use strict';
// The startup backup has to include the WAL.
//
// START.bat preferred `sqlite3 .backup` and fell back to `copy`. The sqlite3 CLI
// is not on PATH on a normal Windows box, so the fallback was the branch that
// always ran — and `copy` takes the .db file on its own. In WAL mode that file is
// only as current as the last checkpoint, so the snapshots quietly held stale
// state. On the machine this was found on, a snapshot taken at 19:30 was missing
// three inventory_log rows and a whole substrate_batches row.
//
// The first test is the one that matters: it fails if the raw copy ever stops
// being lossy, which would mean the fixture no longer reproduces the bug and the
// second test is proving nothing.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync: Database } = require('node:sqlite');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'backup-db.js');

// null means the table is not in this file at all. A raw copy of a database whose
// WAL has never been checkpointed is missing the CREATE TABLE as well as the rows,
// so "no such table" is a legitimate answer here rather than a broken test.
function countRows(file) {
  const d = new Database(file, { readOnly: true });
  try {
    return d.prepare('SELECT COUNT(*) AS c FROM ansatz').get().c;
  } catch (e) {
    if (/no such table/.test(e.message)) return null;
    throw e;
  } finally {
    d.close();
  }
}

function runBackup(src, dest) {
  return execFileSync(process.execPath, ['--no-warnings', SCRIPT, src, dest], { encoding: 'utf8' });
}

describe('startup backup captures the WAL', () => {
  let dir;
  let src;
  let live;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-wal-'));
    src = path.join(dir, 'meistertracker.db');
    live = new Database(src);
    live.exec('PRAGMA journal_mode = WAL');
    live.exec('CREATE TABLE ansatz (id INTEGER PRIMARY KEY, rh REAL)');
    // Committed, but deliberately never checkpointed: the connection stays open
    // for the whole suite, which is what keeps these rows in the -wal file and
    // out of the .db. Closing it would checkpoint and destroy the fixture.
    for (let i = 0; i < 25; i++) live.prepare('INSERT INTO ansatz(rh) VALUES(?)').run(60 + i);
  });

  after(() => {
    try {
      live.close();
    } catch {
      /* the temp dir goes either way */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the fixture really does hold rows only in the WAL', () => {
    assert.ok(fs.existsSync(src + '-wal'), 'no -wal file: the fixture is not in WAL mode');
    const rawCopy = path.join(dir, 'raw.db');
    fs.copyFileSync(src, rawCopy);
    // Not 25, and in practice null: with nothing checkpointed the raw copy has
    // neither the rows nor the table they live in.
    assert.notEqual(countRows(rawCopy), 25, 'a raw copy picked the rows up — fixture no longer reproduces the bug');
  });

  it('the script writes a snapshot that has them', () => {
    const dest = path.join(dir, 'snapshot.db');
    runBackup(src, dest);
    assert.equal(countRows(dest), 25);
  });

  it('refuses to overwrite an existing snapshot', () => {
    const dest = path.join(dir, 'twice.db');
    runBackup(src, dest);
    const before = fs.readFileSync(dest);
    assert.throws(() => runBackup(src, dest), /refusing to overwrite|Command failed/);
    assert.deepEqual(fs.readFileSync(dest), before, 'the existing snapshot was touched');
  });

  it('exits non-zero when the source is missing, so START.bat falls back', () => {
    assert.throws(() => runBackup(path.join(dir, 'nope.db'), path.join(dir, 'out.db')));
  });
});
