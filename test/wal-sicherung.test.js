'use strict';
// The startup backup has to include the WAL.
//
// START.bat preferred `sqlite3 .backup` and fell back to `copy`. The sqlite3 CLI
// is not on PATH on a normal Windows box, so the fallback was the branch that
// always ran — and `copy` takes the .db file on its own. In WAL mode that file is
// only as current as the last checkpoint, so the snapshots quietly held stale
// state. A snapshot taken that way could be missing, for example, a few
// inventory_log rows and a whole substrate_batches row.
//
// The first test is the one that matters: it fails if the raw copy ever stops
// being lossy, which would mean the fixture no longer reproduces the bug and the
// second test is proving nothing.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { DatabaseSync: Database } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'backup-db.js');

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

  it('exits non-zero when the source is missing, so START.bat and update_server.sh fall back', () => {
    assert.throws(() => runBackup(path.join(dir, 'nope.db'), path.join(dir, 'out.db')));
  });
});

// update_server.sh had the same bug: sqlite3 if it was installed, `cp` if not, and
// the server setup in DEPLOYMENT.md never installs the sqlite3 CLI. It now takes
// the snapshot the way START.bat does.
describe('update_server.sh takes the same snapshot', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'update_server.sh'), 'utf8');
  const start = sh.indexOf('backup_data() {');
  const fn = sh.slice(start, sh.indexOf('\n}\n', start) + 2);
  // The comment above the attempts names all three tools as well; only the code
  // counts for the order.
  const code = fn
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('tries backup-db.js first, then sqlite3, and a raw copy only last', () => {
    const viaNode = code.search(/node .*scripts\/backup-db\.js meistertracker\.db "\$snapshot"/);
    const viaCli = code.search(/sqlite3 meistertracker\.db "\.backup '\$snapshot'"/);
    const raw = code.search(/cp meistertracker\.db "\$snapshot"/);
    assert.ok(viaNode >= 0, 'backup_data should take the snapshot with scripts/backup-db.js');
    assert.ok(viaCli > viaNode, 'the sqlite3 CLI is the fallback, not the first choice');
    assert.ok(raw > viaCli, 'the raw copy is the last resort');
    assert.match(code.slice(raw), /WARNING/, 'a raw copy has to say what it is missing');
  });

  describe('run the way do_update runs it', { skip: process.platform === 'win32' && 'needs bash' }, () => {
    let dir;
    let live;

    before(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-update-'));
      // backup_data calls `node scripts/backup-db.js` relative to the checkout.
      // The link stands in for it; node resolves it, so db.js is found as well.
      fs.symlinkSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'));
      live = new Database(path.join(dir, 'meistertracker.db'));
      live.exec('PRAGMA journal_mode = WAL');
      live.exec('CREATE TABLE ansatz (id INTEGER PRIMARY KEY, rh REAL)');
      // Held open and never checkpointed, as in the suite above.
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

    // Under `set -e`, as do_update calls it, with every command named in
    // `failing` replaced by one that exits 1.
    function backupData(failing) {
      const backups = path.join(dir, 'backups');
      fs.rmSync(backups, { recursive: true, force: true });
      const bin = fs.mkdtempSync(path.join(dir, 'bin-'));
      for (const cmd of failing) fs.writeFileSync(path.join(bin, cmd), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      const r = spawnSync('bash', ['-c', 'set -e\n' + fn + '\nbackup_data\n'], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter) }
      });
      const files = fs.existsSync(backups) ? fs.readdirSync(backups) : [];
      const snapshot = files.length === 1 ? path.join(backups, files[0]) : null;
      return { status: r.status, out: r.stdout + r.stderr, files, snapshot };
    }

    it('backup-db.js takes it, WAL included, under the name the backup tooling looks for', () => {
      const r = backupData(['sqlite3', 'cp']);
      assert.equal(r.status, 0, r.out);
      assert.equal(r.files.length, 1, r.out);
      assert.match(r.files[0], /^meistertracker_\d{8}_\d{6}\.db$/);
      assert.equal(countRows(r.snapshot), 25);
      assert.doesNotMatch(r.out, /WARNING/);
    });

    const noCli = spawnSync('sh', ['-c', 'command -v sqlite3'], { stdio: 'ignore' }).status !== 0;
    it('falls back to the sqlite3 CLI, which reads the WAL too', { skip: noCli && 'no sqlite3 CLI here' }, () => {
      const r = backupData(['node', 'cp']);
      assert.equal(r.status, 0, r.out);
      assert.equal(countRows(r.snapshot), 25);
      assert.match(r.out, /via sqlite3/);
    });

    it('makes the raw copy only when both fail, says so, and carries on', () => {
      const r = backupData(['node', 'sqlite3']);
      assert.equal(r.status, 0, 'a failed attempt must not end the update under set -e\n' + r.out);
      assert.equal(r.files.length, 1, r.out);
      assert.match(r.out, /WARNING: raw file copy only/);
    });

    it('stops the update when not even the copy can be written', () => {
      const r = backupData(['node', 'sqlite3', 'cp']);
      assert.notEqual(r.status, 0, r.out);
      assert.match(r.out, /ABORTED/);
    });
  });
});
