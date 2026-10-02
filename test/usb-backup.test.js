'use strict';
// The app's side of the stick backup: setting a stick up, noticing it, the
// automatic run once a day, and what the start screen is told.
//
// "Plugging in" is a folder appearing in the list of drives the service looks
// at; the clock is injected. Temp folders all sit on one disk, so the service
// gets no app folder to compare with, except in the test about exactly that.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { createUsbBackup } = require('../scripts/usb-backup.js');
const usbStick = require('../scripts/usb-stick.js');
const backupCrypto = require('../scripts/backup-crypto.js');
const atomicFile = require('../scripts/atomic-file.js');

// scrypt at the format's real cost is a second per key; see usb-stick.test.js.
backupCrypto.KDF.N = 1024;

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt_usbsvc_' + name + '_'));
}
function put(dir, rel, content) {
  const abs = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function fixture() {
  const base = tmp('app');
  const f = {
    base,
    photoDir: path.join(base, 'data', 'photos'),
    stateFile: path.join(base, 'data', 'usb-backup.json'),
    markerFile: path.join(base, 'backups', '.offsite-sync.json'),
    drives: [tmp('stickA'), tmp('stickB')],
    plugged: new Set(),
    clock: new Date(2026, 9, 1, 9, 0, 0),
    changes: 0,
    logs: [],
    snapshotFails: false
  };
  fs.mkdirSync(path.dirname(f.stateFile), { recursive: true });
  fs.mkdirSync(path.dirname(f.markerFile), { recursive: true });
  put(f.photoDir, '2026/10/exp-1/a.jpg', crypto.randomBytes(500));
  f.make = () =>
    createUsbBackup({
      stateFile: f.stateFile,
      photoDir: f.photoDir,
      appDir: null,
      markerFile: f.markerFile,
      snapshotDb: async () => {
        if (f.snapshotFails) throw Object.assign(new Error('disk full on the PC'), { code: f.snapshotCode });
        const p = path.join(base, 'snap-' + crypto.randomBytes(4).toString('hex') + '.db');
        fs.writeFileSync(p, 'SQLite format 3\0' + 'x'.repeat(100));
        return p;
      },
      log: (level, msg, meta) => f.logs.push({ level, msg, meta }),
      now: () => f.clock,
      roots: () => f.drives.filter((d) => f.plugged.has(d)),
      onChange: () => f.changes++
    });
  return f;
}

describe('USB backup service', () => {
  let f;
  let svc;
  beforeEach(() => {
    f = fixture();
    svc = f.make();
  });

  it('asks to be set up before anything else', () => {
    const s = svc.status();
    assert.equal(s.configured, false);
    assert.equal(s.reminder, 'setup');
    assert.deepEqual(s.sticks, []);
  });

  it('sets up the first stick, hands out the key until it is confirmed, and backs up straight away', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    const r = await svc.setup({ root: a, label: '  Blue\u0007 stick ' });
    assert.ok(usbStick.canonicalKey(r.recoveryKey), 'a recovery key comes back');
    assert.equal(r.newKey, true);
    assert.equal(r.stick.label, 'Blue stick');
    assert.equal(svc.status().reminder, 'running');
    await svc._running();
    assert.equal(svc.status().keyConfirmed, false, 'until someone says the key is put away');
    assert.equal(svc.status().reminder, 'remove', 'which does not hide what the backup did');
    assert.equal(svc.confirmKey(), true);

    const s = svc.status();
    assert.equal(s.keyConfirmed, true);
    assert.equal(s.run.state, 'done');
    assert.equal(s.run.summary.photosNew, 1);
    assert.equal(s.today, true);
    assert.equal(s.reminder, 'remove', 'done, and the stick is still in');
    assert.equal(s.sticks[0].present, true);
    assert.ok(s.sticks[0].lastSuccess.time);

    // The key never travels in a status answer.
    assert.ok(!JSON.stringify(s).includes(r.recoveryKey));
    assert.equal(svc.revealKey(), r.recoveryKey);
    // It is kept in the state file, readable by the owner only.
    assert.ok(fs.readFileSync(f.stateFile, 'utf8').includes(r.recoveryKey));
    if (process.platform !== 'win32') assert.equal(fs.statSync(f.stateFile).mode & 0o077, 0);

    // The off-site marker /api/health reads.
    const marker = JSON.parse(fs.readFileSync(f.markerFile, 'utf8'));
    assert.equal(marker.target, 'USB stick: Blue stick');
    assert.equal(marker.time, s.run.finishedAt);
  });

  it('goes quiet when the stick comes out, and reminds again the next day', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    f.plugged.delete(a);
    await svc.tick();
    assert.equal(svc.status().reminder, null);

    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    assert.equal(svc.status().reminder, 'due');
    assert.equal(svc.status().today, false);
  });

  it('backs up on its own when a registered stick is plugged in, once a day', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    f.plugged.delete(a);
    await svc.tick();

    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    put(f.photoDir, '2026/10/exp-1/b.jpg', crypto.randomBytes(300));
    f.plugged.add(a);
    await svc.tick();
    assert.equal(svc.status().reminder, 'running');
    await svc._running();
    assert.equal(svc.status().run.summary.photosNew, 1, 'only the new photo');
    assert.equal(svc.status().reminder, 'remove');

    // Still in, same day: no second run.
    const before = svc.status().run.startedAt;
    await svc.tick();
    assert.equal(svc.status().run.startedAt, before);
  });

  it('calls a backup that could not read every photo incomplete, until one is complete again', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    const locked = put(f.photoDir, '2026/10/exp-1/locked.jpg', crypto.randomBytes(50));
    put(f.photoDir, '2026/11/exp-2/c.jpg', crypto.randomBytes(50));
    const folder = path.join(f.photoDir, '2026', '11');
    fs.chmodSync(locked, 0o000);
    fs.chmodSync(folder, 0o000);
    try {
      await svc.tick();
      await svc._running();
    } finally {
      fs.chmodSync(locked, 0o600);
      fs.chmodSync(folder, 0o700);
    }
    let s = svc.status();
    assert.equal(s.run.state, 'done', 'what could be read is on the stick');
    assert.equal(s.run.incomplete, true);
    assert.equal(s.reminder, 'gaps', 'not "the stick can come out" as if all were well');
    assert.equal(s.lastSuccess.skipped, 1);
    assert.equal(s.lastSuccess.unreadable, 1);
    assert.deepEqual(s.lastSuccess.missing, ['2026/10/exp-1/locked.jpg', '2026/11']);
    assert.equal(svc.health().incomplete, true);
    assert.equal(JSON.parse(fs.readFileSync(f.markerFile, 'utf8')).incomplete, true);
    assert.ok(f.logs.some((l) => l.level === 'warn' && l.msg === 'USB backup finished'));

    f.clock = new Date(2026, 9, 3, 8, 0, 0);
    await svc.tick();
    await svc._running();
    s = svc.status();
    assert.equal(s.run.incomplete, false);
    assert.equal(s.lastSuccess.skipped, 0);
    assert.equal(s.reminder, 'remove');
    assert.equal(svc.health().incomplete, false);
  });

  it('still says a backup failed, or is due, while the key is not confirmed', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    f.plugged.delete(a);
    await svc.tick();
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    assert.equal(svc.status().keyConfirmed, false);
    assert.equal(svc.status().reminder, 'due');
    f.plugged.add(a);
    f.snapshotFails = true;
    await svc.tick();
    await svc._running();
    assert.equal(svc.status().reminder, 'error');
  });

  it('remembers its sticks across a restart of the app', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    const { recoveryKey } = await svc.setup({ root: a });
    await svc._running();
    const again = f.make();
    assert.equal(again.status().configured, true);
    assert.equal(again.status().sticks.length, 1);
    assert.equal(again.revealKey(), recoveryKey);
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    await again.tick();
    await again._running();
    assert.equal(again.status().run.state, 'done');
  });

  it('falls back on the copy of the last save when the state file comes back garbled', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    const { recoveryKey } = await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    // The power went while the file was being written.
    fs.writeFileSync(f.stateFile, Buffer.alloc(300));
    const again = f.make();
    assert.equal(again.status().configured, true);
    assert.equal(again.revealKey(), recoveryKey);
    assert.ok(f.logs.some((l) => l.level === 'warn' && /copy of the last save/.test(l.msg)));
    await again.tick();
    assert.equal(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).recoveryKey, recoveryKey, 'written back whole');
  });

  it('writes nothing over a state file that does not read at all, and carries on once it does', async () => {
    const [a, b] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    const good = fs.readFileSync(f.stateFile);
    fs.writeFileSync(f.stateFile, '{"recoveryKey": "cut off');
    fs.writeFileSync(f.stateFile + '.bak', '');
    const again = f.make();
    let s = again.status();
    assert.equal(s.stateError, true);
    assert.equal(s.reminder, 'state');
    f.plugged.add(b);
    await assert.rejects(again.setup({ root: b }), { code: 'STATE' });
    await assert.rejects(again.connect({ root: a, recoveryKey: usbStick.generateRecoveryKey() }), { code: 'STATE' });
    assert.equal(fs.readFileSync(f.stateFile, 'utf8'), '{"recoveryKey": "cut off', 'not a byte written');
    assert.equal(await usbStick.readStickInfo(b), null, 'and nothing on the stick');

    fs.writeFileSync(f.stateFile, good);
    await again.tick();
    s = again.status();
    assert.equal(s.stateError, false);
    assert.equal(s.configured, true);
    assert.equal(again.health().stateError, false);
  });

  it('gives a second stick the same key and hands out no new one', async () => {
    const [a, b] = f.drives;
    f.plugged.add(a);
    const first = await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    f.plugged.add(b);
    const second = await svc.setup({ root: b });
    assert.equal(second.recoveryKey, null, 'confirmed, so not handed out again');
    assert.equal(second.newKey, false);
    await svc._running();
    assert.equal(second.stick.label, 'Stick 2');
    const infoB = await usbStick.readStickInfo(b);
    assert.equal(infoB.keyId, usbStick.keyId(first.recoveryKey));
  });

  it('does not retry a failed run while the stick stays in, but does on request', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    f.snapshotFails = true;
    await svc.tick();
    await svc._running();
    let s = svc.status();
    assert.equal(s.run.state, 'error');
    assert.equal(s.run.error.code, 'FAILED');
    assert.equal(s.reminder, 'error');
    assert.equal(s.sticks[0].lastError.code, 'FAILED');
    assert.ok(!JSON.stringify(s).includes('disk full on the PC'), 'the raw message stays in the log');
    assert.ok(f.logs.some((l) => l.level === 'error' && l.meta.error === 'disk full on the PC'));

    await svc.tick();
    assert.equal(svc.status().run.state, 'error', 'no new run by itself');

    f.snapshotFails = false;
    await svc.runNow();
    await svc._running();
    s = svc.status();
    assert.equal(s.run.state, 'done');
    assert.equal(s.sticks[0].lastError, null);
    assert.equal(s.reminder, 'remove');
  });

  it('tries again after ten minutes when the failure may pass by itself, even if the stick never looked missing', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    f.snapshotFails = true;
    await svc.tick();
    await svc._running();
    assert.equal(svc.status().run.error.code, 'FAILED');
    f.snapshotFails = false;
    f.clock = new Date(2026, 9, 2, 8, 5, 0);
    await svc.tick();
    assert.equal(svc.status().run.state, 'error', 'not yet');
    f.clock = new Date(2026, 9, 2, 8, 11, 0);
    await svc.tick();
    await svc._running();
    assert.equal(svc.status().run.state, 'done');
  });

  it('takes a file the stick could not let go of for something that passes, and tries again by itself', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    const rename = fs.promises.rename;
    // No waiting in the test: the retries are atomic-file's own business.
    const waits = atomicFile.RETRY_WAITS.splice(0);
    fs.promises.rename = async (from, to) => {
      if (to.startsWith(a)) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      return rename(from, to);
    };
    try {
      await svc.tick();
      await svc._running();
    } finally {
      fs.promises.rename = rename;
      atomicFile.RETRY_WAITS.push(...waits);
    }
    assert.equal(svc.status().run.error.code, 'HELD', 'not READ_ONLY: the stick takes writes');
    f.clock = new Date(2026, 9, 2, 8, 11, 0);
    await svc.tick();
    await svc._running();
    assert.equal(svc.status().run.state, 'done');
  });

  it('waits for a person when the failure needs one', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    for (let i = 0; i < 30; i++) put(f.photoDir, '2026/10/exp-1/w' + i + '.jpg', crypto.randomBytes(20));
    await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    fs.rmSync(f.photoDir, { recursive: true });
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    await svc.tick();
    await svc._running();
    assert.equal(svc.status().run.error.code, 'SHRUNK');
    f.clock = new Date(2026, 9, 2, 12, 0, 0);
    await svc.tick();
    assert.equal(svc.status().run.state, 'error', 'hours later, still waiting');
  });

  it('keeps saying why the next day while the stick is still in, and tries once more that day', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    for (let i = 0; i < 30; i++) put(f.photoDir, '2026/10/exp-1/w' + i + '.jpg', crypto.randomBytes(20));
    await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    const saved = path.join(f.base, 'saved-photos');
    fs.renameSync(f.photoDir, saved);
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    await svc.tick();
    await svc._running();
    assert.equal(svc.status().run.error.code, 'SHRUNK');

    // The next morning, before the first look: the failure, not "plug it in".
    f.clock = new Date(2026, 9, 3, 0, 0, 5);
    assert.equal(svc.status().reminder, 'error');
    // Overnight the photos came back; the day's one try goes through.
    fs.renameSync(saved, f.photoDir);
    await svc.tick();
    await svc._running();
    assert.equal(svc.status().run.state, 'done');
    assert.equal(svc.status().reminder, 'remove');
  });

  it('does not call a finished backup failed because its record could not be saved yet', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    const renameSync = fs.renameSync;
    let blocked = true;
    // The indexer holds the state file for longer than the retries wait.
    fs.renameSync = (from, to) => {
      if (blocked && to === f.stateFile) {
        const e = new Error('operation not permitted');
        e.code = 'EPERM';
        throw e;
      }
      return renameSync(from, to);
    };
    try {
      await svc.tick();
      await svc._running();
      const s = svc.status();
      assert.equal(s.run.state, 'done', 'the backup is on the stick');
      assert.equal(s.today, true);
      assert.ok(f.logs.some((l) => l.level === 'error' && /trying again later/.test(l.msg)));
      blocked = false;
      await svc.tick();
    } finally {
      fs.renameSync = renameSync;
    }
    const saved = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
    assert.equal(saved.sticks[0].lastSuccess.time, svc.status().run.finishedAt, 'saved on the next look');
  });

  it('gets through a state file held for a moment', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    const renameSync = fs.renameSync;
    let left = 2;
    fs.renameSync = (from, to) => {
      if (to === f.stateFile && left > 0) {
        left--;
        const e = new Error('resource busy or locked');
        e.code = 'EBUSY';
        throw e;
      }
      return renameSync(from, to);
    };
    try {
      await svc.setup({ root: a });
      await svc._running();
    } finally {
      fs.renameSync = renameSync;
    }
    assert.equal(left, 0);
    assert.ok(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).recoveryKey);
  });

  it('does not blame the stick for a file the PC could not find', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    f.snapshotFails = true;
    f.snapshotCode = 'ENOENT';
    await svc.tick();
    await svc._running();
    assert.equal(svc.status().run.error.code, 'FAILED', 'not GONE: the stick was never the problem');
  });

  it('keeps handing out the key after a first setup that failed half-way', async () => {
    const [a, b] = f.drives;
    f.plugged.add(a);
    f.plugged.add(b);
    // The key is saved, then the stick refuses to be written: write-protected.
    fs.chmodSync(a, 0o500);
    try {
      await assert.rejects(svc.setup({ root: a }), (e) => ['EACCES', 'EPERM', 'EROFS'].includes(e.code));
    } finally {
      fs.chmodSync(a, 0o700);
    }
    const s = svc.status();
    assert.equal(s.configured, true);
    assert.equal(s.keyConfirmed, false);
    assert.equal(s.reminder, 'setup', 'no stick is set up yet');
    const zweiter = await svc.setup({ root: b });
    assert.ok(usbStick.canonicalKey(zweiter.recoveryKey), 'the key nobody saw comes back');
    assert.equal(zweiter.newKey, false);
    assert.equal(zweiter.recoveryKey, svc.revealKey());
    await svc._running();
  });

  describe('when this PC cannot save its own record', () => {
    function diskFull(fn) {
      const renameSync = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (to === f.stateFile) throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
        return renameSync(from, to);
      };
      return Promise.resolve()
        .then(fn)
        .finally(() => {
          fs.renameSync = renameSync;
        });
    }

    it('says so instead of blaming the stick, and forgets nothing it could not save', async () => {
      const [a] = f.drives;
      f.plugged.add(a);
      const { stick } = await svc.setup({ root: a });
      await svc._running();
      svc.confirmKey();
      await diskFull(() => assert.throws(() => svc.forget(stick.id), { code: 'STATE' }));
      assert.equal(svc.status().sticks.length, 1, 'still listed, as on disk');
      assert.equal(f.make().status().sticks.length, 1, 'and after a restart');
    });

    it('leaves a second stick set up but not registered, and takes it on the next time', async () => {
      const [a, b] = f.drives;
      f.plugged.add(a);
      f.plugged.add(b);
      await svc.setup({ root: a });
      await svc._running();
      svc.confirmKey();
      await diskFull(() => assert.rejects(svc.setup({ root: b }), { code: 'STATE' }));
      assert.equal(svc.status().sticks.length, 1);
      assert.ok(await usbStick.readStickInfo(b), 'the stick itself is set up');
      await svc.setup({ root: b });
      await svc._running();
      assert.equal(svc.status().sticks.length, 2);
    });

    it('confirms the key only once that is saved', async () => {
      const [a] = f.drives;
      f.plugged.add(a);
      await svc.setup({ root: a });
      await svc._running();
      await diskFull(() => assert.throws(() => svc.confirmKey(), { code: 'STATE' }));
      assert.equal(svc.status().keyConfirmed, false, 'not confirmed in memory either');
      assert.equal(svc.confirmKey(), true);
      assert.equal(f.make().status().keyConfirmed, true);
    });

    it('connects nothing it could not save', async () => {
      const [a] = f.drives;
      f.plugged.add(a);
      const { recoveryKey } = await svc.setup({ root: a });
      await svc._running();
      fs.rmSync(f.stateFile);
      const fresh = f.make();
      await diskFull(() => assert.rejects(fresh.connect({ root: a, recoveryKey }), { code: 'STATE' }));
      assert.equal(fresh.status().configured, false);
      assert.equal(fresh.revealKey(), null);
    });
  });

  it('takes one change to the sticks at a time', async () => {
    const [a, b] = f.drives;
    f.plugged.add(a);
    f.plugged.add(b);
    const first = svc.setup({ root: a });
    await assert.rejects(svc.setup({ root: b }), { code: 'BUSY' });
    await first;
    await svc._running();
    assert.equal(svc.status().sticks.length, 1);
  });

  it('only writes to drives it found itself, and never to its own disk', async () => {
    await assert.rejects(svc.setup({ root: '/etc' }), { code: 'NOT_A_DRIVE' });
    const [a] = f.drives;
    f.plugged.add(a);
    const own = createUsbBackup({
      stateFile: path.join(tmp('own'), 'usb-backup.json'),
      photoDir: f.photoDir,
      appDir: a,
      snapshotDb: async () => null,
      roots: () => [a]
    });
    await assert.rejects(own.setup({ root: a }), { code: 'SAME_DISK' });
    assert.equal(await usbStick.readStickInfo(a), null, 'nothing was written');
  });

  it('never backs up into a copy of the stick folder on its own disk, by itself or on request', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    // The same state, and a "stick" on the disk the app runs on: what a copy
    // of MEISTERTRACKER-BACKUP on C: looks like.
    const own = createUsbBackup({
      stateFile: f.stateFile,
      photoDir: f.photoDir,
      appDir: a,
      markerFile: f.markerFile,
      snapshotDb: async () => {
        throw new Error('no run may start');
      },
      now: () => f.clock,
      roots: () => [a]
    });
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    await own.tick();
    await own._running();
    const s = own.status();
    assert.equal(s.run, null, 'no run');
    assert.equal(s.present[0].sameDisk, true);
    assert.equal(s.sticks[0].present, false, 'not called plugged in');
    assert.equal(s.reminder, 'due', 'not "the stick can come out"');
    await assert.rejects(own.runNow(), { code: 'SAME_DISK' });
  });

  it('takes back a stick from an earlier installation with its key', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    const { recoveryKey } = await svc.setup({ root: a });
    await svc._running();

    // A new PC: no state, the same stick.
    fs.rmSync(f.stateFile);
    const fresh = f.make();
    await assert.rejects(fresh.setup({ root: a }), { code: 'NEEDS_KEY' });
    await assert.rejects(fresh.connect({ root: a, recoveryKey: usbStick.generateRecoveryKey() }), {
      code: 'WRONG_KEY'
    });
    await fresh.connect({ root: a, recoveryKey: recoveryKey.toLowerCase() });
    assert.equal(fresh.status().keyConfirmed, true, 'whoever typed the key has it');
    assert.equal(fresh.revealKey(), recoveryKey);
    await assert.rejects(fresh.connect({ root: a, recoveryKey }), { code: 'HAS_KEY' });

    // Nothing is written until a person starts the first backup: the data of
    // a new PC is restored first.
    assert.equal(fresh.status().run, null);
    assert.equal(fresh.status().reminder, 'first');
    assert.equal(fresh.status().firstRunPending, true);
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    await fresh.tick();
    assert.equal(fresh.status().run, null, 'not by itself either, the next day');
    await fresh.runNow();
    await fresh._running();
    assert.equal(fresh.status().run.state, 'done');
    assert.equal(fresh.status().firstRunPending, false);
    assert.equal(f.make().status().firstRunPending, false, 'and that is remembered');
  });

  it('will not let a new PC back up its empty state over a stick until someone says so', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    for (let i = 0; i < 30; i++) put(f.photoDir, '2026/10/exp-1/n' + i + '.jpg', crypto.randomBytes(30));
    const { recoveryKey } = await svc.setup({ root: a });
    await svc._running();

    // The PC is replaced; the stick is connected before anything is restored.
    fs.rmSync(f.stateFile);
    fs.rmSync(f.photoDir, { recursive: true });
    const neu = f.make();
    await neu.connect({ root: a, recoveryKey });
    assert.equal(neu.status().run, null, 'connecting writes nothing');
    // Pressed "Back up now" without restoring: the guard still stops it.
    await neu.runNow();
    await neu._running();
    let s = neu.status();
    assert.equal(s.run.state, 'error');
    assert.equal(s.run.error.code, 'SHRUNK');
    assert.equal(s.reminder, 'error');
    assert.equal(fs.readdirSync(path.join(a, usbStick.STICK_DIR, usbStick.DB_DIR)).length, 1, 'no empty snapshot');

    // Pressed "back up anyway".
    await neu.runNow(null, { force: true });
    await neu._running();
    s = neu.status();
    assert.equal(s.run.state, 'done');
  });

  it('lists the drives for setup, with what is on them', async () => {
    const [a, b] = f.drives;
    f.plugged.add(a);
    f.plugged.add(b);
    await svc.setup({ root: a });
    await svc._running();
    const drives = await svc.drives();
    assert.equal(drives.length, 2);
    const da = drives.find((d) => d.root === a);
    assert.equal(da.stick.registered, true);
    assert.equal(da.stick.otherKey, false);
    assert.equal(drives.find((d) => d.root === b).stick, null);
  });

  it('forgets a lost stick without touching it', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    const { stick } = await svc.setup({ root: a });
    await svc._running();
    assert.equal(svc.forget(stick.id), true);
    assert.equal(svc.status().sticks.length, 0);
    assert.ok(await usbStick.readStickInfo(a), 'the stick itself is unchanged');
    assert.equal(svc.forget('nope'), false);
    // Plugged in again it is a known-key stick that is not registered: it is
    // not backed up until someone sets it up again.
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    await svc.tick();
    assert.equal(svc.status().run.state, 'done', 'the old run, no new one');
    assert.equal(svc.status().present[0].registered, false);
  });

  it('drops the failure of a stick it forgets', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    const { stick } = await svc.setup({ root: a });
    await svc._running();
    svc.confirmKey();
    f.clock = new Date(2026, 9, 2, 8, 0, 0);
    f.snapshotFails = true;
    await svc.tick();
    await svc._running();
    assert.equal(svc.status().reminder, 'error');
    svc.forget(stick.id);
    f.plugged.delete(a);
    await svc.tick();
    assert.notEqual(svc.status().reminder, 'error', 'no failure of a stick that is not ours any more');
  });

  it('asks for nothing on a server where it is switched off', async () => {
    const off = createUsbBackup({
      stateFile: f.stateFile,
      photoDir: f.photoDir,
      appDir: null,
      snapshotDb: async () => null,
      now: () => f.clock,
      roots: () => [],
      enabled: false
    });
    assert.equal(off.status().reminder, null, 'no "set up the USB backup" every day');
    assert.equal(off.status().enabled, false);
    off.start();
    off.stop();
  });

  it('reports a missing stick on request', async () => {
    const [a] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    f.plugged.delete(a);
    await assert.rejects(svc.runNow(), { code: 'NOT_PRESENT' });
  });

  it('tells health whether today is covered', async () => {
    assert.deepEqual(svc.health(), {
      configured: false,
      stateError: false,
      sticks: 0,
      lastSuccess: null,
      today: false,
      incomplete: false
    });
    const [a] = f.drives;
    f.plugged.add(a);
    await svc.setup({ root: a });
    await svc._running();
    const h = svc.health();
    assert.equal(h.configured, true);
    assert.equal(h.sticks, 1);
    assert.equal(h.today, true);
  });
});
