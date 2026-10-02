'use strict';
// Getting data back off a stick: checking it, the photos, the database. And
// the script as a whole, the way someone at a new PC would run it.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const usbStick = require('../scripts/usb-stick.js');
const backupCrypto = require('../scripts/backup-crypto.js');
const restore = require('../scripts/usb-restore.js');

// scrypt at the format's real cost is a second per key; see usb-stick.test.js.
backupCrypto.KDF.N = 1024;

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt_restore_' + name + '_'));
}
function put(dir, rel, content) {
  const abs = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

describe('usb-restore', () => {
  const key = usbStick.generateRecoveryKey();
  let root;
  let photos;
  let db;

  before(async () => {
    root = tmp('stick');
    photos = tmp('photos');
    put(photos, '2026/10/exp-1/a.jpg', crypto.randomBytes(800));
    put(photos, '2026/10/exp-1/a_thumb.jpg', crypto.randomBytes(80));
    put(photos, '2026/09/7/c.jpg', crypto.randomBytes(400));
    // A real database: the restore runs SQLite's quick check on it.
    const snapshot = path.join(tmp('snap'), 'snap.db');
    const quelle = new DatabaseSync(snapshot);
    quelle.exec("CREATE TABLE t(x TEXT); INSERT INTO t VALUES('from the backup')");
    quelle.close();
    db = fs.readFileSync(snapshot);
    const stick = await usbStick.initStick(root, key);
    await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: snapshot });
  });

  it('finds the stick from the drive or from its folder', () => {
    assert.equal(restore.resolveStick(root), root);
    assert.equal(restore.resolveStick(path.join(root, usbStick.STICK_DIR)), root);
    assert.throws(() => restore.resolveStick(photos), { code: 'NO_STICK' });
  });

  it('verifies every photo and the newest database without writing', async () => {
    const r = await restore.verify({ root, key });
    assert.equal(r.photos.ok, 3);
    assert.deepEqual(r.photos.bad, []);
    assert.equal(r.db.ok, true);
    assert.equal(r.db.count, 1);
  });

  it('brings the photos back to where they were, byte for byte', async () => {
    const target = tmp('target');
    const r = await restore.restorePhotos({ root, key, target });
    assert.equal(r.restored, 3);
    for (const rel of ['2026/10/exp-1/a.jpg', '2026/10/exp-1/a_thumb.jpg', '2026/09/7/c.jpg']) {
      const a = fs.readFileSync(path.join(photos, ...rel.split('/')));
      const b = fs.readFileSync(path.join(target, ...rel.split('/')));
      assert.ok(a.equals(b), rel);
    }
    const again = await restore.restorePhotos({ root, key, target });
    assert.equal(again.restored, 0);
    assert.equal(again.skipped, 3, 'what is there is left alone');
  });

  it('waits out a photo a virus scanner holds, and leaves no temporary file in the photo folder', async () => {
    const target = tmp('held');
    const rename = fs.promises.rename;
    let left = 1;
    fs.promises.rename = async (from, to) => {
      if (left-- > 0) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      return rename(from, to);
    };
    try {
      const r = await restore.restorePhotos({ root, key, target });
      assert.equal(r.restored, 3);
      assert.deepEqual(r.bad, []);
    } finally {
      fs.promises.rename = rename;
    }
    const names = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name));
        else names.push(e.name);
      }
    })(target);
    assert.equal(names.length, 3);
    assert.ok(!names.some((n) => n.includes('.tmp-')), names.join(', '));
  });

  it('brings the database back, and will not overwrite one without --force', async () => {
    const target = path.join(tmp('db'), 'meistertracker.db');
    const r = await restore.restoreDb({ root, key, target });
    assert.ok(fs.readFileSync(target).equals(db));
    assert.match(r.file, usbStick.DB_NAME);
    assert.deepEqual(r.movedAside, []);
    await assert.rejects(restore.restoreDb({ root, key, target }), { code: 'EXISTS' });
    await restore.restoreDb({ root, key, target, force: true });
    await assert.rejects(
      restore.restoreDb({ root, key, target, force: true, from: 'meistertracker_999999_20990101T000000Z.enc' }),
      { code: 'NO_DB' }
    );
  });

  it('moves the old database and its WAL aside, so SQLite cannot replay the old log onto the backup', async () => {
    const dir = tmp('wal');
    const target = path.join(dir, 'meistertracker.db');
    // What a server killed without closing leaves: the database, its log and
    // the shared-memory index, the log holding rows the file does not.
    const alt = new DatabaseSync(target);
    alt.exec('PRAGMA journal_mode = WAL');
    alt.exec("CREATE TABLE t(x TEXT); INSERT INTO t VALUES('the old live row')");
    alt.close();
    fs.writeFileSync(target + '-wal', 'a log that belongs to the old file');
    fs.writeFileSync(target + '-shm', 'its index');

    await assert.rejects(restore.restoreDb({ root, key, target }), { code: 'EXISTS' });
    const r = await restore.restoreDb({ root, key, target, force: true, now: new Date('2026-10-01T12:00:00Z') });
    assert.deepEqual(
      r.movedAside.map((p) => path.basename(p)).sort(),
      ['meistertracker.db', 'meistertracker.db-shm', 'meistertracker.db-wal']
        .map((n) => n + '.before-restore-20261001T120000Z')
        .sort()
    );
    assert.equal(fs.existsSync(target + '-wal'), false);
    assert.equal(fs.existsSync(target + '-shm'), false);
    const neu = new DatabaseSync(target);
    assert.deepEqual(
      neu
        .prepare('SELECT x FROM t')
        .all()
        .map((z) => z.x),
      ['from the backup']
    );
    assert.equal(neu.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    neu.close();
  });

  it('puts everything back and says so when the database cannot be replaced', async () => {
    const dir = tmp('busy');
    const target = path.join(dir, 'meistertracker.db');
    fs.writeFileSync(target, 'the live database');
    fs.writeFileSync(target + '-wal', 'its log');
    const rename = fs.promises.rename;
    // The server on Windows holds the file open; renaming it fails.
    fs.promises.rename = async (a, b) => {
      if (a === target + '-wal') {
        const e = new Error('resource busy or locked');
        e.code = 'EBUSY';
        throw e;
      }
      return rename(a, b);
    };
    try {
      await assert.rejects(restore.restoreDb({ root, key, target, force: true }), { code: 'IN_USE' });
    } finally {
      fs.promises.rename = rename;
    }
    assert.equal(fs.readFileSync(target, 'utf8'), 'the live database', 'moved back');
    assert.equal(fs.readFileSync(target + '-wal', 'utf8'), 'its log');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['meistertracker.db', 'meistertracker.db-wal'], 'no temp file left');
  });

  it("refuses a snapshot that does not pass SQLite's quick check", async () => {
    const kaputt = tmp('kaputt');
    const k = usbStick.generateRecoveryKey();
    const s2 = await usbStick.initStick(kaputt, k);
    const falsch = put(
      tmp('falsch'),
      'x.db',
      Buffer.concat([Buffer.from('SQLite format 3\0'), crypto.randomBytes(500)])
    );
    await usbStick.writeBackup({ stick: s2, photoDir: photos, dbSnapshot: falsch });
    const target = path.join(tmp('t3'), 'meistertracker.db');
    await assert.rejects(restore.restoreDb({ root: kaputt, key: k, target }), { code: 'CORRUPT' });
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readdirSync(path.dirname(target)), []);
  });

  it('refuses a snapshot the app cannot open, before anything is moved', async () => {
    const r2 = tmp('notapp');
    const stick = await usbStick.initStick(r2, key);
    // A real SQLite file, fine by its own check, whose tables do not fit
    // this app: the server would fail on it at the next start.
    const p = path.join(tmp('wrongdb'), 'w.db');
    const w = new DatabaseSync(p);
    w.exec('CREATE TABLE batches(x TEXT)');
    w.close();
    await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: p });
    const target = path.join(tmp('live'), 'meistertracker.db');
    fs.writeFileSync(target, 'the live database');
    await assert.rejects(restore.restoreDb({ root: r2, key, target, force: true }), { code: 'CORRUPT' });
    assert.equal(fs.readFileSync(target, 'utf8'), 'the live database', 'left in place');
    assert.deepEqual(fs.readdirSync(path.dirname(target)), ['meistertracker.db'], 'and nothing left beside it');
  });

  it('refuses another key', async () => {
    await assert.rejects(restore.verify({ root, key: usbStick.generateRecoveryKey() }), { code: 'WRONG_KEY' });
  });

  it('reports a damaged photo and a photo renamed on the stick, and restores the rest', async () => {
    const copy = tmp('copy');
    fs.cpSync(root, copy, { recursive: true });
    const base = path.join(copy, usbStick.STICK_DIR, usbStick.PHOTO_DIR);
    const damaged = path.join(base, '2026', '09', '7', 'c.jpg.enc');
    const buf = fs.readFileSync(damaged);
    buf[buf.length - 1] ^= 0xff;
    fs.writeFileSync(damaged, buf);
    // A file moved to another photo's name: the header inside says otherwise.
    fs.copyFileSync(
      path.join(base, '2026', '10', 'exp-1', 'a.jpg.enc'),
      path.join(base, '2026', '10', 'exp-1', 'z.jpg.enc')
    );

    const r = await restore.restorePhotos({ root: copy, key, target: tmp('t2') });
    assert.equal(r.restored, 2);
    assert.deepEqual(r.bad.map((b) => b.rel + ':' + b.error).sort(), [
      '2026/09/7/c.jpg:AUTH',
      '2026/10/exp-1/z.jpg:BAD_FILE'
    ]);
  });

  it('counts a link on the stick as bad instead of following it', async () => {
    const r2 = tmp('linked');
    const stick = await usbStick.initStick(r2, key);
    await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null });
    const outside = tmp('outside');
    fs.symlinkSync(outside, path.join(stick.dir, usbStick.PHOTO_DIR, 'ext'), 'dir');
    const r = await restore.verify({ root: r2, key });
    assert.equal(r.photos.ok, 3);
    assert.deepEqual(r.photos.bad, [{ rel: 'ext', error: 'LINK' }]);
  });

  it('counts a folder on the stick it cannot read as bad, so the check fails', async () => {
    const r2 = tmp('unreadable');
    const stick = await usbStick.initStick(r2, key);
    await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null });
    const folder = path.join(stick.dir, usbStick.PHOTO_DIR, '2026', '10');
    fs.chmodSync(folder, 0o000);
    try {
      const r = await restore.verify({ root: r2, key });
      assert.equal(r.photos.ok, 1, 'only the photo outside that folder');
      assert.deepEqual(r.photos.bad, [{ rel: '2026/10', error: 'UNREADABLE' }]);
      const back = await restore.restorePhotos({ root: r2, key, target: tmp('back') });
      assert.deepEqual(back.bad, [{ rel: '2026/10', error: 'UNREADABLE' }]);
    } finally {
      fs.chmodSync(folder, 0o700);
    }
  });

  it('runs as a script with the key from the environment', () => {
    const target = tmp('cli');
    // Photos only: the database snapshot was encrypted at this process's
    // lowered cost, which the backup format does not record, so a child
    // process at the real cost could not read it. The stick's own key
    // parameters are in stick.json, so the photos open anywhere.
    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, '..', 'scripts', 'usb-restore.js'), root, '--photos', target],
      { env: Object.assign({}, process.env, { USB_BACKUP_KEY: key.toLowerCase() }), encoding: 'utf8' }
    );
    assert.match(out, /Photos: 3 restored, 0 already there, 0 bad/);
    assert.ok(fs.existsSync(path.join(target, '2026', '10', 'exp-1', 'a.jpg')));
  });

  it('runs every command DEPLOYMENT.md gives, as the Windows command prompt passes it', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'DEPLOYMENT.md'), 'utf8');
    const lines = doc.split('\n').filter((l) => l.startsWith('node scripts/usb-restore.js '));
    assert.ok(lines.length >= 4, 'the restore commands are documented');
    for (const line of lines) {
      // cmd.exe splits on spaces and knows no comments or backslash escapes.
      const args = line.split(/\s+/).slice(2);
      const a = restore.parseArgs(args);
      assert.ok(a.stick && (a.verify || a.db || a.photos), line);
      assert.ok(!/[<>|&]/.test(line), 'nothing cmd would take for a redirection: ' + line);
    }
  });

  it('fails, rather than ending quietly, when no key comes', () => {
    const { spawnSync } = require('node:child_process');
    const env = Object.assign({}, process.env);
    delete env.USB_BACKUP_KEY;
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'usb-restore.js'), root, '--verify'], {
      input: '',
      env,
      encoding: 'utf8'
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no recovery key/);
  });

  it('parses its arguments and refuses unknown ones', () => {
    assert.deepEqual(restore.parseArgs(['E:\\', '--db', 'x.db', '--force']), {
      stick: 'E:\\',
      verify: false,
      photos: null,
      db: 'x.db',
      from: null,
      overwrite: false,
      force: true
    });
    assert.throws(() => restore.parseArgs(['E:\\', '--everything']), /unknown argument/);
  });
});
