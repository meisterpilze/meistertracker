'use strict';
// Phase 3 backup hotfix regression tests.
//
// R-01: rotation must not delete today's auto-backup when manual backups
//       sort lexicographically AFTER it.
// R-02: openDb() must succeed against a pre-v39 SQLite file (the partial
//       UNIQUE INDEX on scan_log.client_uuid lived in SCHEMA, which runs
//       BEFORE migrations — so a backup that pre-dated the column would
//       crash with `no such column: client_uuid`).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync: Database } = require('node:sqlite');

const db = require('../db.js');
const { rotateAutoBackups, AUTO_BACKUP_FILENAME } = require('../scripts/rotate-backups.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt-backup-test-'));
}

function ageBackdate(filePath, days) {
  // Backdate mtime to (now - days). Use a fractional offset so rotateAutoBackups'
  // 60-second guard never trips on legitimate test fixtures.
  const t = (Date.now() - days * 24 * 60 * 60 * 1000) / 1000;
  fs.utimesSync(filePath, t, t);
}

describe('R-01 — auto-backup rotation', () => {
  let dir;
  before(() => {
    dir = tmpDir();
  });
  after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('AUTO_BACKUP_FILENAME matches only the canonical pattern', () => {
    assert.ok(AUTO_BACKUP_FILENAME.test('meisterpilze_backup_2026-04-29.db'));
    assert.ok(!AUTO_BACKUP_FILENAME.test('meistertracker_20260429_123456.db'));
    assert.ok(!AUTO_BACKUP_FILENAME.test('meisterpilze_backup_2026-04-29.db.bak'));
    assert.ok(!AUTO_BACKUP_FILENAME.test('.backup-status.json'));
  });

  it('keeps fresh auto-backups, deletes only old ones, leaves manual backups untouched', () => {
    // 5 auto-backups at varied ages. The 1d and 25d ones should survive a
    // 30-day retention window; 35d / 100d / 200d should be deleted.
    const autos = [
      { name: 'meisterpilze_backup_2026-04-29.db', ageDays: 1 },
      { name: 'meisterpilze_backup_2026-04-05.db', ageDays: 25 },
      { name: 'meisterpilze_backup_2026-03-26.db', ageDays: 35 },
      { name: 'meisterpilze_backup_2026-01-20.db', ageDays: 100 },
      { name: 'meisterpilze_backup_2025-10-12.db', ageDays: 200 }
    ];
    for (const a of autos) {
      const p = path.join(dir, a.name);
      fs.writeFileSync(p, 'fake-sqlite-content'.repeat(64));
      ageBackdate(p, a.ageDays);
    }
    // 30 manual backups, all at varied ages including very old ones (197d).
    // Lexicographically these sort AFTER the auto-backups — that's the
    // ordering bug we're guarding against.
    const manualNames = [];
    for (let i = 0; i < 30; i++) {
      // Filename pattern that update_server.sh / START.bat produce.
      const stamp = '2026' + String((i % 12) + 1).padStart(2, '0') + String((i % 28) + 1).padStart(2, '0');
      const time = String((i * 17) % 24).padStart(2, '0') + String((i * 31) % 60).padStart(2, '0') + '00';
      const name = 'meistertracker_' + stamp + '_' + time + '_' + i + '.db';
      manualNames.push(name);
      const p = path.join(dir, name);
      fs.writeFileSync(p, 'fake-sqlite-content'.repeat(64));
      // Ages vary from 5h to 197d.
      ageBackdate(p, 0.2 + (i / 30) * 197);
    }
    // A non-backup file that must not be touched.
    fs.writeFileSync(path.join(dir, '.backup-status.json'), '{}');

    const result = rotateAutoBackups(dir, 30);
    assert.equal(result.error, undefined, 'rotation should succeed');
    assert.equal(result.deleted.length, 3, 'three auto-backups (35d, 100d, 200d) should be deleted');
    assert.deepEqual(
      result.deleted.sort(),
      [
        'meisterpilze_backup_2025-10-12.db',
        'meisterpilze_backup_2026-01-20.db',
        'meisterpilze_backup_2026-03-26.db'
      ].sort()
    );
    assert.equal(result.kept.length, 2, 'two auto-backups (1d, 25d) should be kept');
    assert.deepEqual(result.kept.sort(), ['meisterpilze_backup_2026-04-05.db', 'meisterpilze_backup_2026-04-29.db']);

    // Critical: every manual backup must still exist on disk, regardless of age.
    for (const name of manualNames) {
      assert.ok(fs.existsSync(path.join(dir, name)), 'manual backup unexpectedly deleted: ' + name);
    }
    // The status file is still there too.
    assert.ok(fs.existsSync(path.join(dir, '.backup-status.json')));
  });

  it('refuses to delete files newer than 60 seconds (defensive guard)', () => {
    const dir2 = tmpDir();
    try {
      // A "today's auto-backup" that's only seconds old AND a stale one.
      const today = path.join(dir2, 'meisterpilze_backup_2026-04-30.db');
      fs.writeFileSync(today, 'fake');
      // Some file systems / OS combos report a future-rounded mtime when a
      // file is just written (FAT/exFAT 2-second resolution can land mtime
      // slightly ahead of Date.now() reads from a different clock). Pin it
      // to "5 seconds ago" so we are unambiguously inside the 60s guard.
      const fiveSecAgo = (Date.now() - 5_000) / 1000;
      fs.utimesSync(today, fiveSecAgo, fiveSecAgo);
      // Stale file beyond retention.
      const stale = path.join(dir2, 'meisterpilze_backup_2025-01-01.db');
      fs.writeFileSync(stale, 'fake');
      ageBackdate(stale, 200);

      // Pretend we're running rotation with a 0-day retention so the new
      // file would normally be a candidate. The 60s guard should still
      // refuse to delete it.
      const result = rotateAutoBackups(dir2, 0);
      assert.ok(fs.existsSync(today), 'fresh file deleted in spite of 60s guard');
      // The 60s-young file is reported in `skipped`, not `deleted`.
      const skippedNames = result.skipped.map((s) => s.file);
      assert.ok(
        skippedNames.includes('meisterpilze_backup_2026-04-30.db'),
        'expected fresh file in skipped, got ' + JSON.stringify(result)
      );
      // The genuinely old file IS deleted.
      assert.ok(!fs.existsSync(stale), 'stale file should have been deleted');
      assert.ok(result.deleted.includes('meisterpilze_backup_2025-01-01.db'));
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('returns gracefully on a missing directory', () => {
    const result = rotateAutoBackups(path.join(os.tmpdir(), 'mt-no-such-dir-' + Date.now()));
    assert.ok(result.error, 'should return an error string');
    assert.equal(result.kept.length, 0);
    assert.equal(result.deleted.length, 0);
  });
});

// START.bat, update_server.sh and the webhook deploy each leave a
// meistertracker_YYYYMMDD_HHMMSS.db behind before new code starts. The webhook
// runs on every push to main, so these are now rotated by count, in the order
// the rotation first saw them.
describe('pre-update snapshot rotation', () => {
  const {
    rotatePreUpdateSnapshots,
    PRE_UPDATE_LEDGER,
    PRE_UPDATE_SNAPSHOT_FILENAME,
    PRE_UPDATE_SNAPSHOT_KEEP,
    MIN_FILE_AGE_MS
  } = require('../scripts/rotate-backups.js');
  const DAY = 24 * 60 * 60 * 1000;

  // A snapshot named after `stamp`, whose mtime is `mtimeAgoMs` old.
  function snap(dir, stamp, mtimeAgoMs = DAY) {
    const name = 'meistertracker_' + stamp + '.db';
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'fake-sqlite-content');
    const t = (Date.now() - mtimeAgoMs) / 1000;
    fs.utimesSync(p, t, t);
    return name;
  }
  const sept = (day) => '202609' + String(day).padStart(2, '0') + '_120000';

  // A directory the rotation has already run in once, so what is written from
  // here on is new to it.
  function withLedger(fn) {
    const dir = tmpDir();
    try {
      const first = rotatePreUpdateSnapshots(dir);
      assert.equal(first.ledger, 'created');
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const ledgerOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, PRE_UPDATE_LEDGER), 'utf8'));

  it('matches the name the three writers use, and nothing else', () => {
    assert.ok(PRE_UPDATE_SNAPSHOT_FILENAME.test('meistertracker_20261001_093000.db'));
    for (const other of [
      'meistertracker_20261001_093000_3.db',
      'meistertracker_backup.db',
      'meistertracker_2026101_093000.db',
      'meistertracker_20261001_093000.db.enc',
      'meistertracker_20261001_093000.db-wal',
      'meisterpilze_backup_2026-10-01.db',
      'meisterpilze_backup_2026-10-01.enc',
      'photos_20261001_093000.zip'
    ]) {
      assert.ok(!PRE_UPDATE_SNAPSHOT_FILENAME.test(other), other + ' must not be a candidate');
    }
  });

  // Defined once, beside the pattern: a webhook snapshot the pattern did not
  // match would never be deleted, and every test would stay green.
  it('builds names the rotation counts, at any time of the year', () => {
    const { preUpdateSnapshotName } = require('../scripts/rotate-backups.js');
    for (const d of [
      new Date(2026, 0, 1, 0, 0, 0),
      new Date(2026, 11, 31, 23, 59, 59),
      new Date(2026, 9, 2, 9, 5, 7)
    ]) {
      const name = preUpdateSnapshotName(d);
      assert.ok(PRE_UPDATE_SNAPSHOT_FILENAME.test(name), name + ' would never be rotated');
    }
    assert.equal(preUpdateSnapshotName(new Date(2026, 9, 2, 9, 5, 7)), 'meistertracker_20261002_090507.db');
  });

  it('keeps a named number of them, at least one', () => {
    assert.ok(Number.isInteger(PRE_UPDATE_SNAPSHOT_KEEP) && PRE_UPDATE_SNAPSHOT_KEEP >= 1);
  });

  // Until this rotation existed the docs said these "are NOT rotated", and the
  // first start after an upgrade would have deleted every one of them past ten.
  it('leaves every snapshot that was there before its first run alone, for good', () => {
    const dir = tmpDir();
    try {
      const old = [];
      for (let day = 1; day <= PRE_UPDATE_SNAPSHOT_KEEP + 4; day++) old.push(snap(dir, sept(day), (40 - day) * DAY));
      const first = rotatePreUpdateSnapshots(dir);
      assert.equal(first.ledger, 'created');
      assert.deepEqual(first.deleted, []);
      assert.deepEqual(first.legacy.sort(), old.slice().sort());
      // Then a whole rotation's worth of new ones, and one more.
      const fresh = [];
      for (let i = 0; i <= PRE_UPDATE_SNAPSHOT_KEEP; i++) {
        fresh.push(snap(dir, '202610' + String(i + 1).padStart(2, '0') + '_120000'));
        rotatePreUpdateSnapshots(dir);
      }
      for (const n of old) assert.ok(fs.existsSync(path.join(dir, n)), n + ' was deleted');
      assert.ok(!fs.existsSync(path.join(dir, fresh[0])), 'the oldest new one goes');
      for (const n of fresh.slice(1)) assert.ok(fs.existsSync(path.join(dir, n)), n + ' was deleted');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('after that, keeps the newest by the order it first saw them', () => {
    withLedger((dir) => {
      const names = [];
      for (let day = 1; day <= PRE_UPDATE_SNAPSHOT_KEEP + 3; day++) {
        names.push(snap(dir, sept(day)));
        const r = rotatePreUpdateSnapshots(dir);
        assert.equal(r.error, undefined);
      }
      for (const n of names.slice(0, 3)) assert.ok(!fs.existsSync(path.join(dir, n)), n + ' should be gone');
      for (const n of names.slice(3)) assert.ok(fs.existsSync(path.join(dir, n)), n + ' was deleted');
      assert.deepEqual(Object.keys(ledgerOf(dir).seen).sort(), names.slice(3).sort(), 'the ledger forgets the deleted');
    });
  });

  // Every writer names its snapshot after the PC's clock. Ranked by that name, a
  // clock that ran ahead for a few days left ten snapshots that stayed "the
  // newest", and the one an update had just written was the one to go.
  it('cannot be made to delete the snapshot just written by a clock that ran ahead', () => {
    withLedger((dir) => {
      const ahead = [];
      for (let day = 1; day <= 10; day++) {
        ahead.push(snap(dir, '202710' + String(day).padStart(2, '0') + '_120000'));
        rotatePreUpdateSnapshots(dir, 10);
      }
      const justWritten = snap(dir, '20261002_120000', 2 * 60 * 1000);
      const r = rotatePreUpdateSnapshots(dir, 10);
      assert.ok(fs.existsSync(path.join(dir, justWritten)), 'the snapshot just written was deleted');
      assert.deepEqual(r.deleted, [ahead[0]], 'the first one seen goes, whatever its name says');
    });
  });

  it('nor by a clock that runs behind, after a dead CMOS battery', () => {
    withLedger((dir) => {
      const real = [];
      for (let day = 1; day <= 10; day++) {
        real.push(snap(dir, sept(day)));
        rotatePreUpdateSnapshots(dir, 10);
      }
      const justWritten = snap(dir, '20000101_000300', 2 * 60 * 1000);
      const r = rotatePreUpdateSnapshots(dir, 10);
      assert.ok(fs.existsSync(path.join(dir, justWritten)), 'the snapshot just written was deleted');
      assert.deepEqual(r.deleted, [real[0]]);
    });
  });

  it('orders snapshots that turn up together by their names', () => {
    withLedger((dir) => {
      const earlier = snap(dir, sept(1));
      const later = snap(dir, sept(2));
      const r = rotatePreUpdateSnapshots(dir, 1);
      assert.deepEqual(r.kept, [later]);
      assert.deepEqual(r.deleted, [earlier]);
    });
  });

  it('deletes nothing when its ledger cannot be read, and starts over', () => {
    withLedger((dir) => {
      for (let day = 1; day <= 3; day++) {
        snap(dir, sept(day));
        rotatePreUpdateSnapshots(dir);
      }
      fs.writeFileSync(path.join(dir, PRE_UPDATE_LEDGER), '{ not json');
      for (let day = 4; day <= 12; day++) snap(dir, sept(day));
      const r = rotatePreUpdateSnapshots(dir, 2);
      assert.equal(r.ledger, 'unreadable, started over');
      assert.deepEqual(r.deleted, []);
      assert.equal(r.legacy.length, 12);
      assert.equal(ledgerOf(dir).next, 1, 'a fresh ledger was written');
    });
  });

  it('never deletes a file younger than MIN_FILE_AGE_MS, even past the count', () => {
    withLedger((dir) => {
      assert.ok(5_000 < MIN_FILE_AGE_MS);
      const young = snap(dir, sept(1), 5_000);
      rotatePreUpdateSnapshots(dir, 1);
      const newest = snap(dir, sept(2));
      const r = rotatePreUpdateSnapshots(dir, 1);
      assert.deepEqual(r.kept, [newest]);
      assert.deepEqual(r.deleted, []);
      assert.deepEqual(
        r.skipped.map((s) => s.file),
        [young]
      );
      assert.ok(fs.existsSync(path.join(dir, young)));
    });
  });

  it('keeps the newest whatever `keep` says', () => {
    for (const keep of [0, -3, NaN, 'none']) {
      withLedger((dir) => {
        snap(dir, sept(1));
        rotatePreUpdateSnapshots(dir, keep);
        const newest = snap(dir, sept(2));
        const r = rotatePreUpdateSnapshots(dir, keep);
        assert.deepEqual(r.kept, [newest], 'keep=' + String(keep));
        assert.ok(fs.existsSync(path.join(dir, newest)));
      });
    }
  });

  it('leaves every other file in the directory alone', () => {
    withLedger((dir) => {
      const others = [
        'meisterpilze_backup_2025-01-01.db',
        'meisterpilze_backup_2025-01-01.enc',
        'meistertracker_20250101_000000.db.enc',
        'meistertracker_20250101_000000_7.db',
        'meistertracker_backup.db',
        'photos_20250101_000000.zip',
        'photos_20250101_000000.tar.gz',
        '.backup-status.json'
      ];
      for (const f of others) {
        fs.writeFileSync(path.join(dir, f), 'x');
        ageBackdate(path.join(dir, f), 300);
      }
      const real = snap(dir, sept(1));
      const r = rotatePreUpdateSnapshots(dir, 1);
      assert.deepEqual(r.deleted, []);
      assert.deepEqual(r.kept, [real]);
      for (const f of others) assert.ok(fs.existsSync(path.join(dir, f)), f + ' was touched');
    });
  });

  // Named like a snapshot, and newer by name than the real one beside it: if it
  // counted, it would take the only slot and push the real snapshot out.
  it('does not count a directory with a snapshot name', () => {
    withLedger((dir) => {
      const real = snap(dir, sept(1));
      fs.mkdirSync(path.join(dir, 'meistertracker_20991231_000000.db'));
      const r = rotatePreUpdateSnapshots(dir, 1);
      assert.deepEqual(r.kept, [real]);
      assert.deepEqual(r.deleted, []);
      assert.ok(fs.existsSync(path.join(dir, real)));
      assert.ok(fs.statSync(path.join(dir, 'meistertracker_20991231_000000.db')).isDirectory());
    });
  });

  it('returns gracefully on a missing directory', () => {
    const result = rotatePreUpdateSnapshots(path.join(os.tmpdir(), 'mt-no-such-dir-' + Date.now()));
    assert.ok(result.error);
    assert.deepEqual(result.deleted, []);
  });

  // runDailyBackup returns early on a day that already has its auto-backup,
  // and a restart after an update is usually such a day.
  it('runs on every backup run, before the early return, and right after the webhook’s snapshot', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const fn = src.slice(src.indexOf('function runDailyBackup()'), src.indexOf('function scheduleDailyBackup()'));
    const call = fn.indexOf('rotatePreUpdate()');
    assert.ok(call > 0, 'runDailyBackup must rotate the pre-update snapshots');
    assert.ok(call < fn.indexOf("'already-exists'"), 'and before it returns early');
    assert.match(src, /function rotatePreUpdate\(\) \{[\s\S]{0,80}rotatePreUpdateSnapshots\(BACKUP_DIR\)/);
    assert.match(src, /createDeployRunner\(\{[\s\S]*?rotate: rotatePreUpdate,/, 'the deploy runner rotates too');
  });
});

describe('R-02 — openDb works against a pre-v39 SQLite file', () => {
  let preV39Path;

  before(() => {
    // Build a SQLite file that simulates the pre-v39 schema: scan_log without
    // the `client_uuid` column and without the partial unique index. We do
    // this by hand-crafting the table — running the real migrations through
    // v38 is brittle because new migrations land on top.
    const dir = tmpDir();
    preV39Path = path.join(dir, 'pre-v39.db');
    const raw = new Database(preV39Path);
    raw.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied TEXT NOT NULL, description TEXT);
      INSERT INTO schema_version(version, applied, description) VALUES
        (1, '2024-01-01', 'pre-v39 baseline');
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
        password_hash TEXT, salt TEXT, role TEXT, created TEXT, last_login TEXT,
        password_reset_token TEXT, password_reset_expires TEXT, must_change_password INTEGER DEFAULT 0
      );
      -- scan_log WITHOUT client_uuid — that's the whole point of this fixture.
      CREATE TABLE scan_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time TEXT NOT NULL,
        action TEXT NOT NULL,
        batch TEXT, bag TEXT, "from" TEXT, "to" TEXT,
        species TEXT, strain TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      -- A row with a NULL batch survives migration v29, which scrubs orphaned
      -- scan_log rows whose batch column references a non-existent batch_id.
      INSERT INTO scan_log(time, action, batch) VALUES('2024-01-01', 'ADD', NULL);
    `);
    raw.close();
  });

  after(() => {
    if (preV39Path && fs.existsSync(preV39Path)) {
      try {
        fs.unlinkSync(preV39Path);
      } catch (_) {}
      try {
        fs.rmdirSync(path.dirname(preV39Path));
      } catch (_) {}
    }
  });

  it('opens a pre-v39 file without throwing (regression test)', () => {
    // Before R-02, this would throw `no such column: client_uuid` because
    // SCHEMA's `CREATE UNIQUE INDEX ... ON scan_log(client_uuid)` ran before
    // migration v39 added the column.
    const opened = db.openDb(preV39Path);
    assert.ok(opened, 'openDb should succeed on a pre-v39 file');
    try {
      // After migrations the column exists.
      const cols = opened
        .prepare("SELECT name FROM pragma_table_info('scan_log')")
        .all()
        .map((r) => r.name);
      assert.ok(cols.includes('client_uuid'), 'migration v39 should have added client_uuid');

      // The partial unique index now exists.
      const idx = opened
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_scanlog_client_uuid'")
        .get();
      assert.ok(idx, 'idx_scanlog_client_uuid should exist after migrations');

      // Pre-existing data survives.
      const n = opened.prepare('SELECT COUNT(*) AS n FROM scan_log').get().n;
      assert.equal(n, 1, 'pre-v39 row should still be present');
    } finally {
      opened.close();
    }
  });

  it('rotateAutoBackups + db.backupDb survive a real round-trip', async () => {
    // Sanity: take a backup of the pre-v39 file (after openDb ran the
    // migrations on it once), open the backup, confirm the index is there.
    const dir = tmpDir();
    try {
      const src = db.openDb(preV39Path);
      const simpleDest = path.join(dir, 'roundtrip.db');
      await db.backupDb(src, simpleDest);
      src.close();

      const reopened = db.openDb(simpleDest);
      try {
        const integrity = reopened.prepare('PRAGMA integrity_check').get();
        assert.equal(integrity && integrity.integrity_check, 'ok');
        const idx = reopened
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_scanlog_client_uuid'")
          .get();
        assert.ok(idx, 'idx_scanlog_client_uuid present in backup copy');
      } finally {
        reopened.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The target used to be spliced into the SQL behind a whitelist of plain ASCII,
// which refused every installation whose path had an umlaut, a bracket or an
// ampersand in it: the nightly backup failed there every night.
describe('backupDb writes wherever the installation lives', () => {
  it('to a path with an umlaut, brackets, an ampersand and a quote', async () => {
    const dir = tmpDir();
    try {
      const odd = path.join(dir, "Pilzgärtnerei Mustermann (neu) & Co's");
      fs.mkdirSync(odd);
      const src = db.openDb(path.join(odd, 'meistertracker.db'));
      db.createUser(src, 'admin.one', 'a reasonable password', 'admin');
      const dest = path.join(odd, 'backups', "meisterpilze_backup_2026-10-02 (copy) 'x'.db");
      fs.mkdirSync(path.dirname(dest));
      await db.backupDb(src, dest);
      src.close();
      const copy = new Database(dest, { readOnly: true });
      try {
        assert.equal(copy.prepare('SELECT COUNT(*) AS c FROM users').get().c, 1);
      } finally {
        copy.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('and treats a quote in the name as part of the name, not as SQL', async () => {
    const dir = tmpDir();
    try {
      const src = db.openDb(path.join(dir, 'meistertracker.db'));
      const dest = path.join(dir, "x'; DROP TABLE users; --.db");
      await db.backupDb(src, dest);
      assert.ok(fs.existsSync(dest), 'the file is named exactly what was asked for');
      assert.ok(src.prepare("SELECT name FROM sqlite_master WHERE name = 'users'").get(), 'users still exists');
      src.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
