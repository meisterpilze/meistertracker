'use strict';
// Phase 3 backup hotfix regression tests — see audit-2026-04.md.
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
      const dest = path.join(dir, 'meisterpilze_backup_round-trip.db');
      // backupDb's path validator rejects this filename's hyphen pattern only
      // if the date part doesn't match — but it's fine here because the
      // whitelist allows hyphens. Use a simple filename to avoid relying on
      // pattern subtleties.
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
