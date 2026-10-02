'use strict';
// The app's side of the USB stick backup: which sticks belong to this
// installation, noticing when one is plugged in, running the backup, and what
// the reminder on the start screen says.
//
// The routine it serves: the start screen tells an admin once a day that
// today's backup is still missing. They plug in a stick that was set up for
// this installation; the app recognises it within seconds, writes the backup
// on its own, and says when the stick can come out again. Nobody has to find a
// button, and the stick does not stay in the PC.
//
// What is kept, in data/usb-backup.json (never served, never committed):
// the recovery key, so a backup can run unattended, and the registered sticks
// with their last result. The key on this disk is no weaker than the data on
// this disk; the stick is what leaves the building.

const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const usbStick = require('./usb-stick.js');
const { writeFileAtomic } = require('./atomic-file.js');

const SCAN_MS = 15 * 1000;
// A failure that may pass by itself is tried again after this long.
const RETRY_MS = 10 * 60 * 1000;
const RETRY_CODES = ['GONE', 'FAILED', 'HELD'];
const PROGRESS_MS = 1000;
const LABEL_MAX = 40;

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// What a failed run tells the person in front of it. The codes are what the
// interface translates; the message stays in the log.
function describeError(e) {
  const code = (e && e.code) || '';
  // Something on the PC failed (its disk, its database copy, a photo it could
  // not read). Telling someone their stick is full or pulled would send them
  // looking in the wrong place.
  if (e && e.where === 'pc') return { code: 'FAILED', message: e.message };
  // A file on the stick that another program (a virus scanner, the indexer)
  // still held after the retries: the stick is fine, the next try gets
  // through. Reported as write-protected, it waited for a person for nothing.
  if (e && e.held) return { code: 'HELD', message: e.message };
  if (code === 'ENOSPC') return { code: 'FULL', message: e.message };
  if (['EROFS', 'EACCES', 'EPERM'].includes(code)) return { code: 'READ_ONLY', message: e.message };
  if (['ENOENT', 'EIO', 'ENODEV', 'ENXIO', 'EBUSY'].includes(code)) return { code: 'GONE', message: e.message };
  if (['WRONG_KEY', 'NO_STICK', 'FORMAT', 'BAD_KEY', 'SHRUNK', 'DAMAGED', 'STATE'].includes(code)) {
    return { code, message: e.message };
  }
  return { code: 'FAILED', message: (e && e.message) || String(e) };
}

function createUsbBackup({
  stateFile,
  photoDir,
  appDir,
  markerFile,
  snapshotDb,
  log = () => {},
  now = () => new Date(),
  roots = () => usbStick.candidateRoots(),
  onChange = () => {},
  scanMs = SCAN_MS,
  retryMs = RETRY_MS,
  // false for a server nobody can plug a stick into (USB_BACKUP=off): no
  // looking for sticks, and no reminder that asks for one every day.
  enabled = true
}) {
  // Set when data/usb-backup.json is there but neither it nor its last copy
  // can be read. Nothing that writes the file runs until it reads again:
  // taken for a fresh install, the next setup created a second key and wrote
  // it over the only copy of the first on this PC, and the old sticks were
  // locked out of the app for good.
  let stateError = null;
  // Set when a save failed, or the state came from its copy: the next look
  // saves again.
  let unsaved = false;
  const state = load();
  let present = [];
  let run = null;
  let timer = null;
  let scanning = false;
  // One change to the sticks at a time: two setups racing for the same stick
  // was the way to a stick whose key data and photos disagree.
  let op = null;
  const opened = new Map();
  // A stick whose run failed is not tried again at once: a full stick would
  // otherwise fail every fifteen seconds. Pulling it out and back in, or
  // "Try again", clears this. Failures that may pass by themselves (the stick
  // gone for a moment, the PC busy) are tried again after RETRY_MS anyway: a
  // stick pulled and put back between two looks is never seen missing.
  // Failures that need a person (full, write-protected, far less than last
  // time, the wrong key) wait for one, but not for ever: a stick that stays
  // plugged in gets one more try each day, so a cause fixed on the PC (the
  // photos restored after a SHRUNK stop) does not leave it unused until
  // someone thinks of pulling it out.
  const failed = new Map();

  function emptyState() {
    return { version: 1, recoveryKey: null, keyId: null, keyConfirmed: false, firstRunPending: false, sticks: [] };
  }
  function readState(file) {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw usbStick.codeError('EBADSTATE', 'no state in ' + file);
    return {
      version: 1,
      recoveryKey: usbStick.canonicalKey(s.recoveryKey) || null,
      keyId: typeof s.keyId === 'string' ? s.keyId : null,
      keyConfirmed: s.keyConfirmed === true,
      firstRunPending: s.firstRunPending === true,
      sticks: Array.isArray(s.sticks) ? s.sticks.filter((x) => x && typeof x.id === 'string') : []
    };
  }

  // No file is a fresh install. A file that does not read (half written when
  // the power went, held by another program at start-up) is not: then the
  // copy the last save kept (.bak) is used, and if that does not read either,
  // stateError stops everything that would write over it.
  function load() {
    try {
      return readState(stateFile);
    } catch (e) {
      if (e.code === 'ENOENT') return emptyState();
      log('error', 'USB backup state unreadable', { error: e.message });
      try {
        const copy = readState(stateFile + '.bak');
        log('warn', 'USB backup state taken from the copy of the last save', {});
        unsaved = true;
        return copy;
      } catch {
        stateError = e.code || 'EBADSTATE';
        return emptyState();
      }
    }
  }
  // While the file does not read, every look tries again: a file that was
  // only held at start-up reads a moment later.
  function retryLoad() {
    try {
      Object.assign(state, readState(stateFile));
      stateError = null;
      log('info', 'USB backup state readable again', {});
      onChange();
    } catch {
      /* still not; the card says so */
    }
  }
  function refuseWithoutState() {
    if (stateError) {
      throw usbStick.codeError('STATE', 'data/usb-backup.json cannot be read (' + stateError + ')');
    }
  }

  // Written to a temporary file, flushed to the disk, then renamed over the
  // old one; the old one, if it reads, is kept as .bak first. Windows lets a
  // virus scanner or the search indexer hold a file that was just written; a
  // rename onto it fails for a moment (EPERM, EBUSY, EACCES). A few tries a
  // moment apart get through. A save that still fails leaves `unsaved` set,
  // and the next scan tries again.
  //
  // A save that fails is the PC's trouble, never the stick's: it comes back
  // as STATE, with the cause in the log. Taken through describeError as a
  // plain errno, a full or locked PC disk was reported as "The stick is full"
  // or "The stick cannot be written to".
  function save() {
    refuseWithoutState();
    try {
      saveNow();
    } catch (e) {
      log('error', 'Could not save the USB backup state', { error: e.message });
      const err = usbStick.codeError('STATE', 'data/usb-backup.json could not be saved (' + (e.code || 'error') + ')');
      err.cause = e;
      throw err;
    }
  }
  function saveNow() {
    const tmp = stateFile + '.tmp-' + crypto.randomBytes(4).toString('hex');
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(state, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      readState(stateFile);
      fs.copyFileSync(stateFile, stateFile + '.bak');
      fs.chmodSync(stateFile + '.bak', 0o600);
    } catch {
      /* nothing there yet, or nothing worth keeping */
    }
    for (let i = 0; ; i++) {
      try {
        fs.renameSync(tmp, stateFile);
        unsaved = false;
        return;
      } catch (e) {
        if (i < 4 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * 2 ** i);
          continue;
        }
        fs.rmSync(tmp, { force: true });
        throw e;
      }
    }
  }
  // A change an admin asked for is kept only if it reaches the disk. Kept in
  // memory after a failed save, the app said one thing until the next
  // restart and the file another after it: a forgotten stick came back, a
  // confirmed key was asked for again.
  function change(mutate) {
    const before = JSON.stringify(state);
    mutate();
    try {
      save();
    } catch (e) {
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, JSON.parse(before));
      throw e;
    }
  }

  // For the places where a failed save must not undo what happened: a backup
  // that is on the stick is a backup, whether or not this file said so yet.
  function saveOrLater() {
    try {
      save();
    } catch (e) {
      unsaved = true;
      log('error', 'Could not save the USB backup state; trying again later', { error: e.message });
    }
  }

  function stickState(id) {
    return state.sticks.find((s) => s.id === id) || null;
  }

  function latestSuccess() {
    let best = null;
    for (const s of state.sticks) {
      if (s.lastSuccess && (!best || s.lastSuccess.time > best.time)) {
        best = Object.assign({ stickId: s.id, label: s.label }, s.lastSuccess);
      }
    }
    return best;
  }

  function backedUpToday(id) {
    const s = stickState(id);
    return !!(s && s.lastSuccess && sameDay(new Date(s.lastSuccess.time), now()));
  }

  function publicRun() {
    if (!run) return null;
    const { state: st, stickId, label, auto, startedAt, finishedAt, phase, done, total, bytesDone, bytesTotal } = run;
    return {
      state: st,
      incomplete: !!run.incomplete,
      stickId,
      label,
      auto,
      startedAt,
      finishedAt: finishedAt || null,
      phase,
      done,
      total,
      bytesDone,
      bytesTotal,
      error: run.error ? { code: run.error.code } : null,
      summary: run.summary || null
    };
  }

  // Photos on the PC the last backup could not read, and so did not copy.
  function incomplete(last) {
    return !!(last && (last.skipped || last.unreadable));
  }

  // What the start screen shows about the backup, in order of what matters
  // most right now. An unconfirmed recovery key is said on a line of its own
  // (status().keyConfirmed): as one of these, it hid a failed backup, the
  // daily "plug in the stick" and the "Back up anyway" button for as long as
  // nobody ticked the box.
  //   running  a backup is being written
  //   state    this PC's record of the backup cannot be read
  //   setup    no stick set up
  //   first    a stick was connected on this PC; its first backup waits for
  //            a person (restore first)
  //   error    today's run failed; the stick may still be in
  //   gaps     done for today, but photos on the PC could not be read
  //   remove   done for today and a stick is still plugged in: take it out
  //   due      no backup today yet: plug in a stick
  //   null     done for today, nothing plugged in
  function reminder(last, today) {
    if (!enabled) return null;
    if (run && run.state === 'running') return 'running';
    if (stateError) return 'state';
    if (!state.recoveryKey || !state.sticks.length) return 'setup';
    if (state.firstRunPending) return 'first';
    // A failure stays on the screen for the day it happened, and for as long
    // as the stick it happened on is still in and has not been backed up
    // since. Dropped at midnight, the next morning told the admin to plug in
    // a stick that was plugged in, and the reason was gone.
    if (run && run.state === 'error' && (sameDay(new Date(run.finishedAt), now()) || failed.has(run.stickId))) {
      return 'error';
    }
    if (today && incomplete(last)) return 'gaps';
    if (today) return present.some((p) => p.registered && !p.sameDisk) ? 'remove' : null;
    return 'due';
  }

  function status() {
    const last = latestSuccess();
    const today = !!last && sameDay(new Date(last.time), now());
    return {
      enabled,
      configured: !!state.recoveryKey,
      keyConfirmed: !!state.recoveryKey && state.keyConfirmed,
      firstRunPending: !!state.firstRunPending,
      stateError: !!stateError,
      sticks: state.sticks.map((s) => ({
        id: s.id,
        label: s.label,
        registered: s.registered,
        lastSuccess: s.lastSuccess || null,
        lastError: s.lastError || null,
        present: present.some((p) => p.id === s.id && !p.sameDisk)
      })),
      present: present.map((p) => ({
        root: p.root,
        id: p.id,
        label: p.label,
        registered: p.registered,
        otherKey: p.otherKey,
        supported: p.supported,
        sameDisk: p.sameDisk
      })),
      run: publicRun(),
      lastSuccess: last,
      today,
      reminder: reminder(last, today)
    };
  }

  async function writeMarker(label, summary, finishedAt) {
    if (!markerFile) return;
    try {
      const marker = {
        time: finishedAt,
        bytes: summary.bytesWritten,
        target: 'USB stick: ' + label,
        durationSeconds: Math.round(summary.durationMs / 1000),
        // Copied, but not all of it: photos the PC could not read are missing.
        incomplete: summary.skipped.length + summary.unreadable.length > 0
      };
      await writeFileAtomic(markerFile, JSON.stringify(marker, null, 2));
    } catch (e) {
      log('warn', 'Could not write the off-site marker', { error: e.message });
    }
  }

  async function openStick(root, id) {
    const cached = opened.get(id);
    if (cached && cached.root === root) return cached;
    const stick = await usbStick.openStick(root, state.recoveryKey);
    if (stick.info.id !== id) throw usbStick.codeError('NO_STICK', 'another stick is in that drive now');
    opened.set(id, stick);
    return stick;
  }

  // force: the person pressed "back up anyway" after a SHRUNK stop.
  function startRun(p, { auto = false, force = false } = {}) {
    if (run && run.state === 'running') return publicRun();
    const s = stickState(p.id);
    const current = {
      state: 'running',
      stickId: p.id,
      label: s ? s.label : p.label,
      root: p.root,
      auto,
      startedAt: now().toISOString(),
      phase: 'start',
      done: 0,
      total: 0,
      bytesDone: 0,
      bytesTotal: 0
    };
    run = current;
    onChange();
    current.promise = (async () => {
      let snapshot = null;
      try {
        const stick = await openStick(p.root, p.id);
        current.phase = 'db';
        snapshot = await snapshotDb().catch((e) => {
          throw Object.assign(e, { where: 'pc' });
        });
        let lastEmit = 0;
        const summary = await usbStick.writeBackup({
          stick,
          photoDir,
          dbSnapshot: snapshot,
          now: now(),
          guard: !force,
          onProgress: (pr) => {
            Object.assign(current, pr);
            const t = Date.now();
            if (t - lastEmit >= PROGRESS_MS) {
              lastEmit = t;
              onChange();
            }
          }
        });
        // Photos the PC could not read are not on the stick. The run is done,
        // and the next one tries them again, but it is not called complete:
        // a photo that stays unreadable would otherwise be missing from the
        // only copy that leaves the building, with every sign saying all is well.
        const gaps = summary.skipped.length + summary.unreadable.length;
        current.state = 'done';
        current.incomplete = gaps > 0;
        current.summary = summary;
        current.finishedAt = now().toISOString();
        const st = stickState(p.id);
        if (st) {
          st.lastSuccess = {
            time: current.finishedAt,
            photos: summary.photos,
            photosNew: summary.photosNew,
            bytesWritten: summary.bytesWritten,
            durationMs: summary.durationMs,
            dbFile: summary.dbFile,
            skipped: summary.skipped.length,
            unreadable: summary.unreadable.length,
            missing: summary.skipped
              .map((x) => x.rel)
              .concat(summary.unreadable)
              .slice(0, 5)
          };
          st.lastError = null;
          saveOrLater();
        }
        failed.delete(p.id);
        await writeMarker(current.label, summary, current.finishedAt);
        log(gaps || summary.pruneFailed.length ? 'warn' : 'info', 'USB backup finished', {
          stick: p.id,
          photosNew: summary.photosNew,
          bytesWritten: summary.bytesWritten,
          durationMs: summary.durationMs,
          // Not on the stick yet; the next run tries them again.
          skipped: summary.skipped.slice(0, 20),
          unreadable: summary.unreadable.slice(0, 20),
          // Old photos the stick would not delete; still marked for removal.
          pruneFailed: summary.pruneFailed.slice(0, 20)
        });
      } catch (e) {
        current.state = 'error';
        current.finishedAt = now().toISOString();
        current.error = describeError(e);
        opened.delete(p.id);
        failed.set(p.id, { at: now().getTime(), code: current.error.code });
        const st = stickState(p.id);
        if (st) {
          st.lastError = { time: current.finishedAt, code: current.error.code };
          saveOrLater();
        }
        log('error', 'USB backup failed', { stick: p.id, code: current.error.code, error: current.error.message });
      } finally {
        if (snapshot) await fsp.rm(snapshot, { force: true }).catch(() => {});
        onChange();
      }
    })();
    return publicRun();
  }

  // A plugged-in stick a backup may be written to.
  function usable(p) {
    return p.registered && !p.otherKey && p.supported && !p.sameDisk;
  }

  function mayRetry(id) {
    const f = failed.get(id);
    if (!f) return true;
    if (RETRY_CODES.includes(f.code)) return now().getTime() - f.at >= retryMs;
    return !sameDay(new Date(f.at), now());
  }

  // Whether a stick folder sits on the app's own disk, per drive, worked out
  // when it appears: on Windows that asks WMI, which is too slow for every
  // look. A stick is recognised by the id in its stick.json, so a copy of
  // the stick folder on C: or D: looks like the stick itself; checked only
  // at setup, the daily backups went into that copy from then on, the real
  // stick was skipped as done, and every sign said the backup had left the
  // building.
  const diskOf = new Map();
  async function sameDiskOf(found) {
    for (const root of [...diskOf.keys()]) if (!found.some((x) => x.root === root)) diskOf.delete(root);
    const fresh = found.filter(({ root, info }) => !diskOf.has(root) || diskOf.get(root).id !== info.id);
    if (!fresh.length) return;
    const list = await usbStick.listDrives(
      fresh.map((x) => x.root),
      appDir
    );
    for (const { root, info } of fresh) {
      const d = list.find((x) => x.root === root);
      // A drive that could not be looked at is not written to either.
      diskOf.set(root, { id: info.id, sameDisk: d ? d.sameDisk : true });
    }
  }

  async function scan() {
    const found = await usbStick.findSticks(roots());
    await sameDiskOf(found);
    const next = found.map(({ root, info }) => ({
      root,
      id: info.id,
      label: info.label || '',
      registered: !!stickState(info.id),
      otherKey: !!state.keyId && info.keyId !== state.keyId,
      supported: info.supported,
      sameDisk: diskOf.get(root).sameDisk
    }));
    for (const id of [...failed.keys()]) if (!next.some((p) => p.id === id)) failed.delete(id);
    for (const id of [...opened.keys()]) if (!next.some((p) => p.id === id)) opened.delete(id);
    const changed = JSON.stringify(next) !== JSON.stringify(present);
    present = next;
    return changed;
  }

  // One look at the drives, and a backup if a registered stick that has none
  // from today is plugged in.
  async function tick() {
    if (scanning) return;
    scanning = true;
    try {
      if (stateError) retryLoad();
      if (unsaved) saveOrLater();
      const changed = await scan();
      if (changed) onChange();
      if (stateError || !state.recoveryKey || state.firstRunPending || op || (run && run.state === 'running')) return;
      const due = present.find((p) => usable(p) && mayRetry(p.id) && !backedUpToday(p.id));
      if (due) startRun(due, { auto: true });
    } catch (e) {
      log('warn', 'USB stick scan failed', { error: e.message });
    } finally {
      scanning = false;
    }
  }

  async function checkRoot(root) {
    if (typeof root !== 'string' || !roots().includes(root)) {
      throw usbStick.codeError('NOT_A_DRIVE', 'not one of the drives the app looks at');
    }
    const [drive] = await usbStick.listDrives([root], appDir);
    if (!drive) throw usbStick.codeError('NOT_A_DRIVE', 'drive not available');
    if (drive.sameDisk) throw usbStick.codeError('SAME_DISK', 'that is the disk the app runs on');
    return drive;
  }

  function cleanLabel(label) {
    return String(label || '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, LABEL_MAX);
  }

  function nextLabel() {
    let n = 0;
    for (const s of state.sticks) {
      const m = /^Stick (\d+)$/.exec(s.label || '');
      if (m) n = Math.max(n, Number(m[1]));
    }
    return 'Stick ' + Math.max(n + 1, state.sticks.length + 1);
  }

  function register(info, label) {
    if (!stickState(info.id)) {
      state.sticks.push({
        id: info.id,
        label: label || info.label || nextLabel(),
        registered: now().toISOString(),
        lastSuccess: null,
        lastError: null
      });
    }
  }

  function busy() {
    if (op) throw usbStick.codeError('BUSY', 'another change to the sticks is in progress');
    if (run && run.state === 'running') throw usbStick.codeError('BUSY', 'a backup is running');
  }
  async function exclusive(fn) {
    busy();
    op = fn();
    try {
      return await op;
    } finally {
      op = null;
    }
  }

  // Set up the stick in `root`, or take an existing one of this installation
  // back on. The first stick creates the recovery key. It is returned with
  // every setup until someone confirms it has been put away (confirmKey):
  // returned only once, a first setup that failed half-way — the key saved,
  // the stick write-protected — would have lost it for good.
  function setup(args) {
    return exclusive(() => setupNow(args));
  }
  async function setupNow({ root, label } = {}) {
    refuseWithoutState();
    await checkRoot(root);
    const existing = await usbStick.readStickInfo(root);
    let created = null;
    let stick;
    if (existing) {
      if (!state.recoveryKey) throw usbStick.codeError('NEEDS_KEY', 'stick from another installation');
      stick = await usbStick.openStick(root, state.recoveryKey);
      change(() => register(stick.info, cleanLabel(label)));
    } else {
      if (!state.recoveryKey) {
        created = usbStick.generateRecoveryKey();
        // The key is on disk before anything is encrypted with it.
        change(() => {
          state.recoveryKey = created;
          state.keyId = usbStick.keyId(created);
          state.keyConfirmed = false;
        });
      }
      const name = cleanLabel(label) || nextLabel();
      stick = await usbStick.initStick(root, state.recoveryKey, { label: name, now: now() });
      // Should this save fail, the stick is set up but not registered: it
      // shows as a stick of this installation, and setting it up again takes
      // it on.
      change(() => register(stick.info, name));
    }
    opened.set(stick.info.id, stick);
    await scan();
    startRun({ root, id: stick.info.id, label: stick.info.label }, { auto: false });
    return {
      stick: status().sticks.find((s) => s.id === stick.info.id),
      recoveryKey: state.keyConfirmed ? null : state.recoveryKey,
      newKey: !!created
    };
  }

  // Someone has put the key away; it stops being shown with every setup and
  // the start screen stops asking.
  function confirmKey() {
    if (!state.recoveryKey) return false;
    if (!state.keyConfirmed) {
      // Saved, or not confirmed: a confirmation that lived only in memory
      // made a second "Done" answer yes without saving anything, and was
      // gone after the next restart.
      change(() => {
        state.keyConfirmed = true;
      });
      onChange();
    }
    return true;
  }

  // A stick from an earlier installation, opened with the key that was noted
  // down back then. Only while this installation has no key of its own: two
  // keys in one installation would mean sticks that cannot be read with the
  // key someone wrote down.
  //
  // This is a new PC, or one that lost its state, and most likely one whose
  // data is not restored yet. So nothing is written to the stick until a
  // person starts the first backup (runNow). Backed up at once, a small
  // installation's empty database became the newest snapshot on the stick,
  // the one a restore takes by default: the SHRUNK guard only tells "far
  // less" from "less" above a few megabytes and twenty photos.
  function connect(args) {
    return exclusive(() => connectNow(args));
  }
  async function connectNow({ root, recoveryKey } = {}) {
    refuseWithoutState();
    if (state.recoveryKey) throw usbStick.codeError('HAS_KEY', 'this installation already has a key');
    await checkRoot(root);
    const key = usbStick.canonicalKey(recoveryKey);
    if (!key) throw usbStick.codeError('BAD_KEY', 'not a recovery key');
    const stick = await usbStick.openStick(root, key);
    change(() => {
      state.recoveryKey = key;
      state.keyId = usbStick.keyId(key);
      // Whoever typed it has it.
      state.keyConfirmed = true;
      state.firstRunPending = true;
      register(stick.info);
    });
    opened.set(stick.info.id, stick);
    await scan();
    onChange();
    return { stick: status().sticks.find((s) => s.id === stick.info.id) };
  }

  async function runNow(id, { force = false } = {}) {
    busy();
    await scan();
    const p = present.find((x) => usable(x) && (!id || x.id === id));
    if (!p) {
      if (present.some((x) => x.registered && x.sameDisk && (!id || x.id === id))) {
        throw usbStick.codeError('SAME_DISK', 'that stick folder is on the disk the app runs on');
      }
      throw usbStick.codeError('NOT_PRESENT', 'no registered stick plugged in');
    }
    failed.delete(p.id);
    if (state.firstRunPending) {
      // Someone has said the data is there: from now on, every day by itself.
      state.firstRunPending = false;
      saveOrLater();
    }
    return startRun(p, { auto: false, force });
  }

  // A stick that is lost or retired. Nothing on it is touched; it just stops
  // being one of ours.
  function forget(id) {
    busy();
    if (!stickState(id)) return false;
    change(() => {
      state.sticks = state.sticks.filter((s) => s.id !== id);
    });
    opened.delete(id);
    failed.delete(id);
    // Its last failure goes with it: kept, the start screen said "Stick
    // backup failed" until midnight about a stick that is no longer ours.
    if (run && run.stickId === id && run.state === 'error') run = null;
    present = present.map((p) => (p.id === id ? Object.assign({}, p, { registered: false }) : p));
    onChange();
    return true;
  }

  async function drives() {
    const list = await usbStick.listDrives(roots(), appDir);
    return list.map((d) => ({
      root: d.root,
      sameDisk: d.sameDisk,
      free: d.free,
      total: d.total,
      stick: d.stick
        ? {
            id: d.stick.id,
            label: d.stick.label || '',
            registered: !!stickState(d.stick.id),
            otherKey: !!state.keyId && d.stick.keyId !== state.keyId,
            supported: d.stick.supported
          }
        : null
    }));
  }

  function health() {
    const last = latestSuccess();
    return {
      configured: !!state.recoveryKey,
      stateError: !!stateError,
      sticks: state.sticks.length,
      lastSuccess: last ? last.time : null,
      today: !!last && sameDay(new Date(last.time), now()),
      incomplete: incomplete(last)
    };
  }

  function start() {
    if (timer || !enabled) return;
    timer = setInterval(() => tick(), scanMs);
    if (timer.unref) timer.unref();
    setTimeout(() => tick(), 2000).unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    status,
    health,
    tick,
    setup,
    connect,
    runNow,
    forget,
    drives,
    revealKey: () => state.recoveryKey,
    confirmKey,
    start,
    stop,
    // For tests: the run in progress, to await it.
    _running: () => (run && run.promise) || Promise.resolve()
  };
}

module.exports = { createUsbBackup, describeError, SCAN_MS };
