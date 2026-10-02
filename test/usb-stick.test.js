'use strict';
// The backup stick: its key, its format, and what one backup writes onto it.
//
// Deriving a key at the format's real cost takes about a second, and these
// tests derive a good number of them. Cheaper scrypt parameters change nothing
// about what is checked here; test/backup-crypto.test.js runs at the real
// cost. A stick records its parameters in stick.json, so it opens with the
// ones it was made with.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const usbStick = require('../scripts/usb-stick.js');
const backupCrypto = require('../scripts/backup-crypto.js');
const { parseRemoved, MIN_SEEN_DAYS } = require('../scripts/photo-mirror.js');

backupCrypto.KDF.N = 1024;

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt_usb_' + name + '_'));
}
function put(dir, rel, content) {
  const abs = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
function onStick(root, rel) {
  return path.join(root, usbStick.STICK_DIR, usbStick.PHOTO_DIR, ...(rel + '.enc').split('/'));
}

describe('recovery key', () => {
  it('is 32 characters of Crockford base32 in groups of four', () => {
    const k = usbStick.generateRecoveryKey();
    assert.match(k, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
    assert.notEqual(usbStick.generateRecoveryKey(), k);
  });

  it('is recognised however it is typed', () => {
    const k = usbStick.generateRecoveryKey();
    assert.equal(usbStick.canonicalKey(k), k);
    assert.equal(usbStick.canonicalKey(k.toLowerCase()), k);
    assert.equal(usbStick.canonicalKey(k.replace(/-/g, '')), k);
    assert.equal(usbStick.canonicalKey(' ' + k.replace(/-/g, ' ') + '\n'), k);
  });

  it('reads O as 0 and I or L as 1, as Crockford intends', () => {
    const k = '0000-1111-2222-3333-4444-5555-6666-7777';
    assert.equal(usbStick.canonicalKey('OOOO-IIII-2222-3333-4444-5555-6666-7777'), k);
    assert.equal(usbStick.canonicalKey('oooo-llll-2222-3333-4444-5555-6666-7777'), k);
  });

  it('refuses what is not a key', () => {
    assert.equal(usbStick.canonicalKey('short'), null);
    assert.equal(usbStick.canonicalKey('UUUU-1111-2222-3333-4444-5555-6666-7777'), null, 'U is not in the alphabet');
    assert.equal(usbStick.canonicalKey('0000-1111-2222-3333-4444-5555-6666-777'), null);
    assert.equal(usbStick.canonicalKey(null), null);
    assert.equal(usbStick.canonicalKey('correct horse battery staple'), null);
  });

  it('has an id that names it without revealing it', () => {
    const k = usbStick.generateRecoveryKey();
    assert.equal(usbStick.keyId(k), usbStick.keyId(k));
    assert.notEqual(usbStick.keyId(k), usbStick.keyId(usbStick.generateRecoveryKey()));
    assert.match(usbStick.keyId(k), /^[0-9a-f]{16}$/);
  });
});

describe('a stick', () => {
  const key = usbStick.generateRecoveryKey();
  let root;
  let stick;

  before(async () => {
    root = tmp('stick');
    stick = await usbStick.initStick(root, key.toLowerCase(), {
      label: 'Stick A',
      now: new Date('2026-10-01T08:00:00Z')
    });
  });

  it('carries a plain stick.json that holds nothing secret', async () => {
    const raw = fs.readFileSync(path.join(root, usbStick.STICK_DIR, usbStick.STICK_FILE), 'utf8');
    const info = JSON.parse(raw);
    assert.equal(info.app, 'meistertracker');
    assert.equal(info.label, 'Stick A');
    assert.equal(info.keyId, usbStick.keyId(key));
    assert.ok(!raw.includes(key) && !raw.includes(key.replace(/-/g, '')), 'the key itself is not on the stick');
    assert.equal((await usbStick.readStickInfo(root)).id, stick.info.id);
  });

  it('is not set up twice', async () => {
    await assert.rejects(usbStick.initStick(root, key), { code: 'EXISTS' });
  });

  it('opens with its key, typed any way', async () => {
    const again = await usbStick.openStick(root, key.replace(/-/g, '').toLowerCase());
    assert.equal(again.info.id, stick.info.id);
    assert.ok(again.key.equals(stick.key));
  });

  it('does not open with another key, and says so without deriving one', async () => {
    const scrypt = crypto.scrypt;
    let calls = 0;
    crypto.scrypt = (...a) => {
      calls++;
      return scrypt(...a);
    };
    try {
      await assert.rejects(usbStick.openStick(root, usbStick.generateRecoveryKey()), { code: 'WRONG_KEY' });
    } finally {
      crypto.scrypt = scrypt;
    }
    assert.equal(calls, 0, 'told by the key id, before the second scrypt costs at full strength');
  });

  it('is told apart from a folder that is no stick', async () => {
    await assert.rejects(usbStick.openStick(tmp('empty'), key), { code: 'NO_STICK' });
    assert.equal(await usbStick.readStickInfo(tmp('empty')), null);
  });

  describe('a backup onto it', () => {
    let photos;
    let first;

    before(async () => {
      photos = tmp('photos');
      put(photos, '2026/09/1/a.jpg', crypto.randomBytes(3000));
      put(photos, '2026/09/1/a_thumb.jpg', crypto.randomBytes(300));
      put(photos, '2026/10/exp-4/b.jpg', crypto.randomBytes(5000));
      const snapshot = put(
        tmp('snap'),
        'snap.db',
        Buffer.concat([Buffer.from('SQLite format 3\0'), crypto.randomBytes(2048)])
      );
      const seen = [];
      first = await usbStick.writeBackup({
        stick,
        photoDir: photos,
        dbSnapshot: snapshot,
        now: new Date('2026-10-01T09:00:00Z'),
        onProgress: (p) => seen.push(Object.assign({}, p))
      });
      first.seen = seen;
      first.snapshot = fs.readFileSync(snapshot);
    });

    it('writes every photo and the database', () => {
      assert.equal(first.photos, 3);
      assert.equal(first.photosNew, 3);
      for (const rel of ['2026/09/1/a.jpg', '2026/09/1/a_thumb.jpg', '2026/10/exp-4/b.jpg']) {
        assert.ok(fs.existsSync(onStick(root, rel)), rel);
      }
      assert.match(first.dbFile, usbStick.DB_NAME);
    });

    it('reports progress up to the last photo', () => {
      const last = first.seen[first.seen.length - 1];
      assert.equal(last.phase, 'photos');
      assert.equal(last.done, 3);
      assert.equal(last.total, 3);
      assert.equal(last.bytesDone, last.bytesTotal);
      assert.ok(first.seen.some((p) => p.phase === 'db'));
    });

    it('stores the database in the format Settings → Backup restores, under the recovery key', () => {
      const raw = fs.readFileSync(path.join(root, usbStick.STICK_DIR, usbStick.DB_DIR, first.dbFile));
      assert.ok(backupCrypto.isEncryptedBackup(raw));
      assert.ok(backupCrypto.decryptBackup(raw, key).equals(first.snapshot));
    });

    it('stores photos that only the key opens, each carrying its name and checksum', () => {
      const original = fs.readFileSync(path.join(photos, '2026', '10', 'exp-4', 'b.jpg'));
      const sealed = fs.readFileSync(onStick(root, '2026/10/exp-4/b.jpg'));
      assert.ok(!sealed.includes(original.subarray(0, 64)), 'not in the clear');
      const { meta, data } = usbStick.openPhoto(stick.key, sealed);
      assert.ok(data.equals(original));
      assert.equal(meta.rel, '2026/10/exp-4/b.jpg');
      assert.equal(meta.sha256, crypto.createHash('sha256').update(original).digest('hex'));
    });

    it('notices a changed byte', () => {
      const sealed = Buffer.from(fs.readFileSync(onStick(root, '2026/09/1/a.jpg')));
      sealed[sealed.length - 10] ^= 1;
      assert.throws(() => usbStick.openPhoto(stick.key, sealed), { code: 'AUTH' });
    });

    it('writes nothing again the second time', async () => {
      const second = await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null });
      assert.equal(second.photosNew, 0);
      assert.equal(second.photos, 3);
    });

    it('writes only what is new', async () => {
      put(photos, '2026/10/exp-4/c.jpg', crypto.randomBytes(700));
      const r = await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null });
      assert.equal(r.photosNew, 1);
      assert.ok(fs.existsSync(onStick(root, '2026/10/exp-4/c.jpg')));
    });

    it('cleans up after a run that was cut off', async () => {
      const left = onStick(root, '2026/10/exp-4/d.jpg') + '.tmp-0badf00d';
      fs.writeFileSync(left, 'half a file');
      put(photos, '2026/10/exp-4/d.jpg', crypto.randomBytes(100));
      const r = await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null });
      assert.equal(fs.existsSync(left), false);
      assert.equal(r.photosNew, 1);
    });

    it('keeps a photo the app deleted for the grace period, then lets it go', async () => {
      fs.rmSync(path.join(photos, '2026', '09', '1', 'a_thumb.jpg'));
      const record = () =>
        parseRemoved(JSON.parse(fs.readFileSync(path.join(root, usbStick.STICK_DIR, usbStick.REMOVED_FILE), 'utf8')));
      // The runs above went on the real clock, and the record keeps the last
      // of them. A clock behind a recorded run is taken for a wrong one, so this
      // day has to come after it; the fixed date it used to be only did until
      // that date had passed. Noon, so the six daily runs below land on six
      // different days even across a change of summer time.
      const last = new Date(record().lastRun);
      const day = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1, 12);
      const kept = await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null, now: day });
      assert.equal(kept.pruned, 0);
      assert.equal(kept.pendingRemoval, 1);
      assert.ok(fs.existsSync(onStick(root, '2026/09/1/a_thumb.jpg')));
      const { removed } = record();
      assert.equal(removed['2026/09/1/a_thumb.jpg'].since, day.toISOString());
      // Plugged in on six more days.
      for (let d = 1; d < MIN_SEEN_DAYS; d++) {
        await usbStick.writeBackup({
          stick,
          photoDir: photos,
          dbSnapshot: null,
          now: new Date(day.getTime() + d * 86400000)
        });
      }

      const later = new Date(day.getTime() + (usbStick.REMOVED_GRACE_DAYS + 1) * 86400000);
      const gone = await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null, now: later });
      assert.equal(gone.pruned, 1);
      assert.equal(fs.existsSync(onStick(root, '2026/09/1/a_thumb.jpg')), false);
      assert.ok(fs.existsSync(onStick(root, '2026/09/1/a.jpg')), 'its neighbour stays');
    });

    it('takes a missing photo folder for a missing folder, not for deleted photos', async () => {
      const r = await usbStick.writeBackup({ stick, photoDir: path.join(photos, 'nowhere'), dbSnapshot: null });
      assert.equal(r.photos, 0);
      assert.equal(r.pendingRemoval, 0);
      assert.ok(fs.existsSync(onStick(root, '2026/10/exp-4/b.jpg')));
    });

    it('numbers the database snapshots, keeps the newest and drops the oldest', async () => {
      const dbDir = path.join(root, usbStick.STICK_DIR, usbStick.DB_DIR);
      assert.match(first.dbFile, /^meistertracker_000001_20261001T090000Z\.enc$/);
      fs.writeFileSync(path.join(dbDir, 'notes.txt'), 'not a snapshot');
      const snapshot = put(tmp('snap2'), 'snap.db', 'SQLite format 3\0');
      const zwei = await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: snapshot, guard: false });
      const drei = await usbStick.writeBackup({
        stick,
        photoDir: photos,
        dbSnapshot: snapshot,
        keepDb: 2,
        guard: false,
        now: new Date('2026-10-03T09:00:00Z')
      });
      assert.match(zwei.dbFile, /^meistertracker_000002_/);
      assert.match(drei.dbFile, /^meistertracker_000003_20261003T090000Z\.enc$/);
      assert.deepEqual(fs.readdirSync(dbDir).sort(), [zwei.dbFile, drei.dbFile, 'notes.txt'].sort());
    });

    it('keeps the snapshot just written, and calls it the newest, whatever the PC clock says', async () => {
      const dbDir = path.join(root, usbStick.STICK_DIR, usbStick.DB_DIR);
      const snapshot = put(tmp('snap3'), 'snap.db', 'SQLite format 3\0');
      // A dead CMOS battery: the clock is years behind.
      const r = await usbStick.writeBackup({
        stick,
        photoDir: photos,
        dbSnapshot: snapshot,
        keepDb: 1,
        guard: false,
        now: new Date('2020-01-01T00:00:00Z')
      });
      assert.deepEqual(
        fs.readdirSync(dbDir).filter((n) => usbStick.DB_NAME.test(n)),
        [r.dbFile]
      );
      assert.match(r.dbFile, /^meistertracker_000004_20200101T000000Z\.enc$/);
    });

    it('leaves a readable note of the last run', () => {
      const last = JSON.parse(fs.readFileSync(path.join(root, usbStick.STICK_DIR, usbStick.LAST_FILE), 'utf8'));
      assert.equal(typeof last.photosNew, 'number');
      assert.ok(last.time);
    });
  });
});

describe('setting a stick up safely', () => {
  it('lets only one of two setups racing for the same stick win', async () => {
    const root = tmp('race');
    const [a, b] = await Promise.allSettled([
      usbStick.initStick(root, usbStick.generateRecoveryKey(), { label: 'A' }),
      usbStick.initStick(root, usbStick.generateRecoveryKey(), { label: 'B' })
    ]);
    const won = [a, b].filter((x) => x.status === 'fulfilled');
    const lost = [a, b].filter((x) => x.status === 'rejected');
    assert.equal(won.length, 1);
    assert.equal(lost[0].reason.code, 'EXISTS');
    assert.equal((await usbStick.readStickInfo(root)).id, won[0].value.info.id, 'stick.json is the winner’s');
    assert.deepEqual(fs.readdirSync(path.join(root, usbStick.STICK_DIR)), [usbStick.STICK_FILE], 'no temp file left');
  });

  it('refuses a folder that holds backups but lost its stick.json', async () => {
    const root = tmp('lost');
    fs.mkdirSync(path.join(root, usbStick.STICK_DIR, usbStick.PHOTO_DIR), { recursive: true });
    await assert.rejects(usbStick.initStick(root, usbStick.generateRecoveryKey()), { code: 'NOT_EMPTY' });
  });

  it('replaces half a stick.json from a setup that was cut off, in an otherwise empty folder', async () => {
    const root = tmp('half');
    fs.mkdirSync(path.join(root, usbStick.STICK_DIR));
    fs.writeFileSync(path.join(root, usbStick.STICK_DIR, usbStick.STICK_FILE), '{"app":"meistertr');
    const s = await usbStick.initStick(root, usbStick.generateRecoveryKey());
    assert.equal((await usbStick.readStickInfo(root)).id, s.info.id);
  });

  it('will not add photos to a stick whose photos do not open with its key', async () => {
    const photos = tmp('p');
    put(photos, '2026/10/1/a.jpg', crypto.randomBytes(100));
    put(photos, '2026/10/1/b.jpg', crypto.randomBytes(100));
    const alt = await usbStick.initStick(tmp('alt'), usbStick.generateRecoveryKey());
    await usbStick.writeBackup({ stick: alt, photoDir: photos, dbSnapshot: null });
    // Another stick's photos under this stick's key data.
    const neu = await usbStick.initStick(tmp('neu'), usbStick.generateRecoveryKey());
    fs.cpSync(path.join(alt.dir, usbStick.PHOTO_DIR), path.join(neu.dir, usbStick.PHOTO_DIR), { recursive: true });
    put(photos, '2026/10/1/c.jpg', crypto.randomBytes(100));
    await assert.rejects(usbStick.writeBackup({ stick: neu, photoDir: photos, dbSnapshot: null }), {
      code: 'WRONG_KEY'
    });
    assert.equal(fs.existsSync(onStick(neu.root, '2026/10/1/c.jpg')), false, 'nothing was added');
  });
});

describe('links on a stick', () => {
  async function stickWithPhoto() {
    const photos = tmp('lp');
    put(photos, '2026/10/x/a.jpg', crypto.randomBytes(40));
    const root = tmp('ls');
    const stick = await usbStick.initStick(root, usbStick.generateRecoveryKey());
    await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null });
    return { photos, root, stick };
  }

  it('are refused, and nothing behind them is deleted or written', async () => {
    const { photos, stick } = await stickWithPhoto();
    const outside = tmp('outside');
    put(outside, 'm.enc', 'not the backup’s');
    // A junction on an NTFS stick, pointing at a folder on the PC.
    fs.symlinkSync(outside, path.join(stick.dir, usbStick.PHOTO_DIR, 'ext'), 'dir');
    put(photos, '2026/10/x/b.jpg', crypto.randomBytes(40));
    const later = new Date(Date.now() + 400 * 86400000);
    await assert.rejects(usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null, now: later }), {
      code: 'DAMAGED'
    });
    assert.deepEqual(fs.readdirSync(outside), ['m.enc'], 'left exactly as it was');
  });

  it('are refused where the stick’s own folders should be', async () => {
    const { photos, stick } = await stickWithPhoto();
    const outside = tmp('elsewhere');
    fs.rmSync(path.join(stick.dir, usbStick.PHOTO_DIR), { recursive: true });
    fs.symlinkSync(outside, path.join(stick.dir, usbStick.PHOTO_DIR), 'dir');
    await assert.rejects(usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null }), { code: 'DAMAGED' });
    assert.deepEqual(fs.readdirSync(outside), [], 'no photo written through it');
  });
});

describe('a folder on the stick that cannot be read', () => {
  it('stops the run before anything is written', async () => {
    const photos = tmp('up');
    put(photos, '2026/10/x/a.jpg', crypto.randomBytes(40));
    put(photos, '2026/09/y/b.jpg', crypto.randomBytes(40));
    const stick = await usbStick.initStick(tmp('us'), usbStick.generateRecoveryKey());
    await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null });
    const folder = path.join(stick.dir, usbStick.PHOTO_DIR, '2026', '10');
    const lastFile = path.join(stick.dir, usbStick.LAST_FILE);
    const before = fs.readFileSync(lastFile, 'utf8');
    fs.chmodSync(folder, 0o000);
    try {
      await assert.rejects(usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null }), { code: 'DAMAGED' });
    } finally {
      fs.chmodSync(folder, 0o700);
    }
    assert.equal(fs.readFileSync(lastFile, 'utf8'), before, 'not even the note of the run');
  });
});

describe('runs that keep failing after the database', () => {
  it('push no older snapshot off the stick, and leave at most one of their own', async () => {
    const photos = tmp('rp');
    put(photos, '2026/10/x/a.jpg', crypto.randomBytes(40));
    const stick = await usbStick.initStick(tmp('rs'), usbStick.generateRecoveryKey());
    const snap = put(tmp('rdb'), 'x.db', 'SQLite format 3\0' + 'x'.repeat(50));
    const dbDir = path.join(stick.dir, usbStick.DB_DIR);
    const snapshots = () => fs.readdirSync(dbDir).filter((n) => usbStick.DB_NAME.test(n));
    for (let d = 1; d <= 3; d++) {
      await usbStick.writeBackup({
        stick,
        photoDir: photos,
        dbSnapshot: snap,
        keepDb: 3,
        now: new Date(2026, 9, d, 9)
      });
    }
    const good = snapshots();
    assert.equal(good.length, 3);

    // A new photo on a failing sector of the PC's disk: every run fails after
    // the database is written, and is tried again ten minutes later.
    const failing = put(photos, '2026/10/x/b.jpg', crypto.randomBytes(40));
    const readFile = fs.promises.readFile;
    fs.promises.readFile = async (p, ...rest) => {
      if (p === failing) throw Object.assign(new Error('i/o error'), { code: 'EIO' });
      return readFile(p, ...rest);
    };
    try {
      for (let i = 0; i < 10; i++) {
        await assert.rejects(
          usbStick.writeBackup({
            stick,
            photoDir: photos,
            dbSnapshot: snap,
            keepDb: 3,
            now: new Date(2026, 9, 4, 9, i * 10)
          }),
          { code: 'EIO' }
        );
      }
    } finally {
      fs.promises.readFile = readFile;
    }
    const after = snapshots();
    assert.ok(
      good.every((n) => after.includes(n)),
      'the good snapshots are all still there'
    );
    assert.equal(after.length, 4, 'and one from the failing runs, the newest');

    // Once a run finishes, the stick is back to its 30 (here: 3).
    await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: snap, keepDb: 3, now: new Date(2026, 9, 5, 9) });
    assert.equal(snapshots().length, 3);
    assert.equal(fs.existsSync(path.join(dbDir, '.unfinished')), false);
  });
});

describe('photos on the stick that cannot be read during the key check', () => {
  async function stickWithPhotos() {
    const photos = tmp('kp');
    for (const n of ['a', 'b', 'c', 'd']) put(photos, '2026/10/x/' + n + '.jpg', crypto.randomBytes(40));
    const stick = await usbStick.initStick(tmp('ks'), usbStick.generateRecoveryKey());
    await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null });
    put(photos, '2026/10/x/e.jpg', crypto.randomBytes(40));
    return { photos, stick };
  }

  it('are not taken for the wrong key when the stick is failing', async () => {
    const { photos, stick } = await stickWithPhotos();
    const readFile = fs.promises.readFile;
    fs.promises.readFile = async (p, ...rest) => {
      if (String(p).endsWith('.enc')) throw Object.assign(new Error('i/o error'), { code: 'EIO' });
      return readFile(p, ...rest);
    };
    try {
      await assert.rejects(usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null }), { code: 'EIO' });
    } finally {
      fs.promises.readFile = readFile;
    }
  });

  it('are reported as a damaged stick when they may not be read', async () => {
    const { photos, stick } = await stickWithPhotos();
    const dir = path.join(stick.dir, usbStick.PHOTO_DIR, '2026', '10', 'x');
    const files = fs.readdirSync(dir).map((n) => path.join(dir, n));
    for (const f of files) fs.chmodSync(f, 0o000);
    try {
      await assert.rejects(usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null }), { code: 'DAMAGED' });
    } finally {
      for (const f of files) fs.chmodSync(f, 0o600);
    }
  });
});

describe('an old photo the stick will not delete', () => {
  it('fails nothing: it stays marked, and goes on a later run', async () => {
    const photos = tmp('pp');
    put(photos, '2026/10/x/a.jpg', crypto.randomBytes(40));
    put(photos, '2026/10/x/b.jpg', crypto.randomBytes(40));
    const stick = await usbStick.initStick(tmp('ps'), usbStick.generateRecoveryKey());
    const day = (d) => new Date(2026, 9, d, 9);
    await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null, now: day(1) });
    fs.rmSync(path.join(photos, '2026', '10', 'x', 'b.jpg'));
    for (let d = 2; d < 2 + MIN_SEEN_DAYS - 1; d++) {
      await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null, now: day(d), graceDays: 0 });
    }
    const held = onStick(stick.root, '2026/10/x/b.jpg');
    const rm = fs.promises.rm;
    fs.promises.rm = async (p, ...rest) => {
      if (p === held) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      return rm(p, ...rest);
    };
    let r;
    try {
      r = await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null, now: day(20), graceDays: 0 });
    } finally {
      fs.promises.rm = rm;
    }
    assert.equal(r.pruned, 0);
    assert.deepEqual(r.pruneFailed, [{ rel: '2026/10/x/b.jpg', code: 'EPERM' }]);
    assert.equal(r.pendingRemoval, 1, 'still marked');
    const later = await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null, now: day(21), graceDays: 0 });
    assert.equal(later.pruned, 1);
    assert.equal(fs.existsSync(held), false);
  });
});

describe('a run that would back up far less than last time', () => {
  async function stickMit(fotos, dbBytes) {
    const photos = tmp('viele');
    for (let i = 0; i < fotos; i++) put(photos, '2026/10/1/f' + i + '.jpg', crypto.randomBytes(20));
    const stick = await usbStick.initStick(tmp('g'), usbStick.generateRecoveryKey());
    const snap = dbBytes ? put(tmp('db'), 'x.db', Buffer.alloc(dbBytes, 1)) : null;
    await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: snap });
    return { stick, photos };
  }

  it('stops when less than half the photos are there, and leaves the stick as it was', async () => {
    const { stick, photos } = await stickMit(30, 0);
    for (let i = 0; i < 20; i++) fs.rmSync(path.join(photos, '2026', '10', '1', 'f' + i + '.jpg'));
    await assert.rejects(usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null }), { code: 'SHRUNK' });
    const record = JSON.parse(fs.readFileSync(path.join(stick.dir, usbStick.REMOVED_FILE), 'utf8'));
    assert.deepEqual(parseRemoved(record).removed, {}, 'nothing marked for removal');
    const r = await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null, guard: false });
    assert.equal(r.pendingRemoval, 20, 'meant, so counted down');
  });

  it('stops for a missing photo folder on a stick that had photos', async () => {
    const { stick, photos } = await stickMit(25, 0);
    await assert.rejects(usbStick.writeBackup({ stick, photoDir: path.join(photos, 'nowhere'), dbSnapshot: null }), {
      code: 'SHRUNK'
    });
  });

  it('stops when the database is under a fifth of the last one', async () => {
    const { stick, photos } = await stickMit(0, 2 * 1024 * 1024);
    const klein = put(tmp('k'), 'k.db', Buffer.alloc(100 * 1024, 1));
    await assert.rejects(usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: klein }), { code: 'SHRUNK' });
    const dbs = fs.readdirSync(path.join(stick.dir, usbStick.DB_DIR));
    assert.equal(dbs.length, 1, 'the small one was not written');
  });

  it('leaves small installations and normal days alone', async () => {
    const { stick, photos } = await stickMit(10, 0);
    for (let i = 0; i < 8; i++) fs.rmSync(path.join(photos, '2026', '10', '1', 'f' + i + '.jpg'));
    await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null });
    const groesser = await stickMit(30, 0);
    for (let i = 0; i < 10; i++) fs.rmSync(path.join(groesser.photos, '2026', '10', '1', 'f' + i + '.jpg'));
    await usbStick.writeBackup({ stick: groesser.stick, photoDir: groesser.photos, dbSnapshot: null });
  });
});

describe('a file held for a moment', () => {
  it('is renamed into place once it is let go', async () => {
    const photos = tmp('held');
    put(photos, '2026/10/1/a.jpg', crypto.randomBytes(30));
    const stick = await usbStick.initStick(tmp('h'), usbStick.generateRecoveryKey());
    const rename = fs.promises.rename;
    let left = 2;
    fs.promises.rename = async (a, b) => {
      if (left > 0 && b.endsWith('a.jpg.enc')) {
        left--;
        const e = new Error('operation not permitted');
        e.code = 'EPERM';
        throw e;
      }
      return rename(a, b);
    };
    try {
      const r = await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null });
      assert.equal(r.photosNew, 1);
    } finally {
      fs.promises.rename = rename;
    }
    assert.ok(fs.existsSync(onStick(stick.root, '2026/10/1/a.jpg')));
  });
});

describe('trouble on the PC during a run', () => {
  it('skips a photo it cannot read, finishes, and gets it on the next run', async () => {
    const photos = tmp('busy');
    put(photos, '2026/10/1/a.jpg', crypto.randomBytes(50));
    const locked = put(photos, '2026/10/1/b.jpg', crypto.randomBytes(50));
    put(photos, '2026/10/1/c.jpg', crypto.randomBytes(50));
    const stick = await usbStick.initStick(tmp('s'), usbStick.generateRecoveryKey());
    const readFile = fs.promises.readFile;
    fs.promises.readFile = async (p, ...rest) => {
      if (p === locked) {
        const e = new Error('resource busy or locked');
        e.code = 'EBUSY';
        throw e;
      }
      return readFile(p, ...rest);
    };
    let r;
    try {
      r = await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null });
    } finally {
      fs.promises.readFile = readFile;
    }
    assert.equal(r.photosNew, 2);
    assert.deepEqual(r.skipped, [{ rel: '2026/10/1/b.jpg', code: 'EBUSY' }]);
    const next = await usbStick.writeBackup({ stick, photoDir: photos, dbSnapshot: null });
    assert.equal(next.photosNew, 1);
    assert.deepEqual(next.skipped, []);
  });

  it('carries on when a photo is deleted while the run goes on', async () => {
    const photos = tmp('gone');
    for (const n of ['a', 'b', 'c']) put(photos, '2026/10/1/' + n + '.jpg', crypto.randomBytes(50));
    const stick = await usbStick.initStick(tmp('s2'), usbStick.generateRecoveryKey());
    const r = await usbStick.writeBackup({
      stick,
      photoDir: photos,
      dbSnapshot: null,
      onProgress: (p) => {
        if (p.phase === 'photos' && p.done === 1) fs.rmSync(path.join(photos, '2026', '10', '1', 'c.jpg'));
      }
    });
    assert.equal(r.photosNew, 2);
    assert.deepEqual(r.skipped, [{ rel: '2026/10/1/c.jpg', code: 'ENOENT' }]);
  });

  it('marks what failed on the PC, so it is not blamed on the stick', async () => {
    const stick = await usbStick.initStick(tmp('s3'), usbStick.generateRecoveryKey());
    await assert.rejects(
      usbStick.writeBackup({ stick, photoDir: tmp('p'), dbSnapshot: path.join(tmp('x'), 'missing.db') }),
      (e) => e.code === 'ENOENT' && e.where === 'pc'
    );
  });
});

describe('two partitions of one disk', () => {
  it('reads which disk each drive letter lives on from WMI', () => {
    const text = ['C:=Disk #0, Partition #2', 'D:=Disk #0, Partition #3', 'e:=Disk #1, Partition #0', 'junk', ''].join(
      '\r\n'
    );
    assert.deepEqual(
      [...usbStick.parseDiskNumbers(text)],
      [
        ['C', 0],
        ['D', 0],
        ['E', 1]
      ]
    );
    assert.equal(usbStick.parseDiskNumbers('').size, 0);
  });

  it('takes a second partition of the app’s disk for the same disk, and a letter it knows nothing of for another', () => {
    const disks = new Map([
      ['C', 0],
      ['D', 0],
      ['E', 1]
    ]);
    assert.equal(usbStick.onSameDisk('C:\\meistertracker', 'D:\\', disks), true);
    assert.equal(usbStick.onSameDisk('C:\\meistertracker', 'E:\\', disks), false);
    assert.equal(usbStick.onSameDisk('C:\\meistertracker', 'F:\\', disks), false);
    assert.equal(usbStick.onSameDisk('/srv/meistertracker', '/media/stick', disks), false);
  });

  it('asks nothing of WMI off Windows', async () => {
    const d = tmp('nowin');
    const drives = await usbStick.listDrives([d], tmp('app'), { platform: 'darwin' });
    assert.equal(drives.length, 1);
  });
});

describe('paths from inside a backup', () => {
  it('are let through only when they stay inside', () => {
    assert.equal(usbStick.safeRel('2026/10/exp-4/b.jpg'), '2026/10/exp-4/b.jpg');
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\b', 'a//b', '', './a', 'a/./b']) {
      assert.equal(usbStick.safeRel(bad), null, bad);
    }
  });
});

describe('finding sticks', () => {
  it('looks at every drive letter on Windows, and where USB_BACKUP_ROOTS says if set', () => {
    const win = usbStick.candidateRoots({ platform: 'win32', env: {} });
    assert.equal(win[0], 'C:\\');
    assert.equal(win[win.length - 1], 'Z:\\');
    assert.equal(win.length, 24);
    const set = usbStick.candidateRoots({
      platform: 'win32',
      env: { USB_BACKUP_ROOTS: ['x', 'y'].join(path.delimiter) }
    });
    assert.deepEqual(set, ['x', 'y']);
  });

  it('finds the stick among the drives and tells the app disk from the others', async () => {
    const drive = tmp('drive');
    const other = tmp('other');
    const key = usbStick.generateRecoveryKey();
    const s = await usbStick.initStick(drive, key, { label: 'B' });
    const found = await usbStick.findSticks([other, drive, path.join(other, 'missing')]);
    assert.equal(found.length, 1);
    assert.equal(found[0].info.id, s.info.id);

    const drives = await usbStick.listDrives([drive, other, path.join(other, 'missing')], drive);
    assert.equal(drives.length, 2);
    assert.equal(drives[0].stick.id, s.info.id);
    assert.equal(drives[0].sameDisk, true, 'the temp folder is on the disk the "app" is on');
    assert.equal(drives[1].stick, null);
  });
});
