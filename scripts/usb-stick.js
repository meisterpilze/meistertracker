'use strict';
// What is on the backup stick, and how it gets there.
//
// The stick is the copy that survives the PC: a dead disk, a theft, water,
// malware. Everything else in backups/ sits on the same disk as the data. It
// is meant to be plugged in, written to, and taken away again — so it will be
// lost one day, and nothing on it may be readable without the recovery key.
//
// Layout, below MEISTERTRACKER-BACKUP/ on the stick:
//
//   stick.json        who this stick is: id, label, which key, the KDF salt.
//                     Plain text; it holds nothing secret and is how the app
//                     recognises the stick when it is plugged in.
//   db/*.enc          database snapshots in the format Settings → Backup
//                     downloads (scripts/backup-crypto.js), encrypted with the
//                     recovery key. The newest DB_KEEP stay.
//   photos/<path>.enc every photo, once. <path> is its path below data/photos,
//                     so a photo already on the stick is never written again:
//                     a backup after the first copies what is new and nothing
//                     else.
//   removed.json      photos the app no longer has, since when, and on how
//                     many days a run found them missing. After
//                     REMOVED_GRACE_DAYS, seen on a week of different days,
//                     they are deleted here too (scripts/photo-mirror.js).
//   last-backup.json  what the last run did. Plain text.
//
// The recovery key is 32 characters (160 random bits), shown once when the
// first stick is set up and kept by the app so it can back up unattended. It
// has to be kept somewhere else as well: if the PC dies, the stick is
// unreadable without it. Each stick derives its own encryption key from it
// with its own salt.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const backupCrypto = require('./backup-crypto.js');
const {
  listFiles,
  fromRel,
  trackRemoved,
  parseRemoved,
  serializeRemoved,
  removeEmptyDirs,
  GRACE_DAYS
} = require('./photo-mirror.js');
const { writeFileAtomic, LEFTOVER } = require('./atomic-file.js');

const STICK_DIR = 'MEISTERTRACKER-BACKUP';
const STICK_FILE = 'stick.json';
const FORMAT = 1;
const DB_DIR = 'db';
const PHOTO_DIR = 'photos';
const REMOVED_FILE = 'removed.json';
const LAST_FILE = 'last-backup.json';
const DB_PREFIX = 'meistertracker_';
// meistertracker_<number>_<UTC time>.enc. The number counts up with every
// snapshot written to this stick and is what orders them; the time is for
// people. Ordered by the PC's clock, a clock running behind deleted the
// snapshot just written, and one running ahead left a snapshot that stayed
// "the newest" for good.
const DB_NAME = /^meistertracker_(\d{6})_\d{8}T\d{6}Z\.enc$/;
const DB_KEEP = 30;
const REMOVED_GRACE_DAYS = GRACE_DAYS;

const PHOTO_MAGIC = Buffer.from('MTPH', 'ascii');
const PHOTO_VERSION = 1;
const PHOTO_PREFIX = Buffer.concat([PHOTO_MAGIC, Buffer.from([PHOTO_VERSION])]);
const CHECK_TEXT = 'meistertracker usb backup';

// Crockford's base32: no I, L, O or U, so nothing on the printout can be
// misread as something else. 20 bytes are exactly 32 characters.
const KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_BYTES = 20;

function codeError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

// ── Recovery key ─────────────────────────────────────────────

function groupKey(s) {
  return s.match(/.{4}/g).join('-');
}

function generateRecoveryKey() {
  let out = '';
  let value = 0;
  let bits = 0;
  for (const b of crypto.randomBytes(KEY_BYTES)) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += KEY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return groupKey(out);
}

// The key as the stick uses it, from however it was typed: case, spaces and
// dashes do not matter, and O, I and L are read as 0, 1 and 1, as Crockford
// intends. Anything that is not 32 characters of the alphabet is not a key.
function canonicalKey(input) {
  if (typeof input !== 'string') return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 32) return null;
  for (const c of s) if (!KEY_ALPHABET.includes(c)) return null;
  return groupKey(s);
}

// Which key a stick belongs to, without the second of scrypt that opening it
// costs. A hash of a 160-bit random key gives nothing away.
function keyId(key) {
  return crypto
    .createHash('sha256')
    .update('meistertracker usb key id\n' + key)
    .digest('hex')
    .slice(0, 16);
}

function deriveStickKey(key, kdf) {
  const N = Number(kdf && kdf.N);
  const r = Number(kdf && kdf.r);
  const p = Number(kdf && kdf.p);
  // The parameters come off the stick. Bounded, so a stick cannot make the
  // server spend minutes or gigabytes on it.
  if (!(N >= 2 && N <= 1 << 20 && (N & (N - 1)) === 0 && r >= 1 && r <= 16 && p >= 1 && p <= 16)) {
    return Promise.reject(codeError('FORMAT', 'unusable key parameters on the stick'));
  }
  const salt = Buffer.from(String(kdf.salt || ''), 'base64');
  if (salt.length < 16) return Promise.reject(codeError('FORMAT', 'salt missing on the stick'));
  return new Promise((resolve, reject) => {
    crypto.scrypt(key, salt, 32, { N, r, p, maxmem: backupCrypto.KDF.maxmem }, (err, k) =>
      err ? reject(err) : resolve(k)
    );
  });
}

// ── Encrypted pieces ─────────────────────────────────────────

function seal(stickKey, plain, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', stickKey, iv);
  if (aad) cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function unseal(stickKey, buf, aad) {
  if (buf.length < 28) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', stickKey, buf.subarray(0, 12));
    if (aad) d.setAAD(aad);
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
  } catch {
    return null;
  }
}

// A photo on the stick: "MTPH", version, then iv, tag and the encrypted
// [header length][header JSON][photo]. The header (path, size, SHA-256) is
// inside the encryption, so a file carries its own name and checksum, and a
// file moved to another name on the stick is noticed when it is read back.
function sealPhoto(stickKey, data, meta) {
  const header = Buffer.from(JSON.stringify(meta), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  return Buffer.concat([PHOTO_PREFIX, seal(stickKey, Buffer.concat([len, header, data]), PHOTO_PREFIX)]);
}

function openPhoto(stickKey, buf) {
  if (!Buffer.isBuffer(buf) || buf.length < PHOTO_PREFIX.length + 28 + 4) throw codeError('BAD_FILE');
  if (!buf.subarray(0, 4).equals(PHOTO_MAGIC)) throw codeError('BAD_FILE');
  if (buf[4] !== PHOTO_VERSION) throw codeError('FORMAT');
  const plain = unseal(stickKey, buf.subarray(PHOTO_PREFIX.length), PHOTO_PREFIX);
  if (!plain) throw codeError('AUTH', 'wrong key or damaged file');
  const n = plain.readUInt32BE(0);
  if (4 + n > plain.length) throw codeError('BAD_FILE');
  let meta;
  try {
    meta = JSON.parse(plain.subarray(4, 4 + n).toString('utf8'));
  } catch {
    throw codeError('BAD_FILE');
  }
  return { meta, data: plain.subarray(4 + n) };
}

// ── Files ────────────────────────────────────────────────────

// Files on the stick are written with writeFileAtomic (scripts/atomic-file.js):
// a stick pulled half-way leaves a .tmp file, which the next run removes; it
// never leaves a short file under the real name, which the next run would take
// for a finished one and skip.

async function removeLeftovers(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let n = 0;
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) n += await removeLeftovers(abs);
    else if (LEFTOVER.test(e.name)) {
      await fsp.rm(abs, { force: true });
      n++;
    }
  }
  return n;
}

function stamp(now) {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

// A path from inside the backup, before it becomes a path on disk: relative,
// forward slashes, no way up or out.
function safeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 400) return null;
  if (rel.startsWith('/') || rel.includes('\\') || rel.includes('\0') || /^[A-Za-z]:/.test(rel)) return null;
  if (rel.split('/').some((p) => p === '' || p === '.' || p === '..')) return null;
  return rel;
}

// ── The stick ────────────────────────────────────────────────

function stickDir(root) {
  return path.join(root, STICK_DIR);
}

// What stick.json says, or null when the folder holds no stick of ours.
// Asynchronous on purpose: this runs every few seconds against every drive,
// and a USB hard disk that has gone to sleep takes seconds to answer. Read
// synchronously, that would be seconds in which the app answers nobody.
async function readStickInfo(root) {
  try {
    const info = JSON.parse(await fsp.readFile(path.join(stickDir(root), STICK_FILE), 'utf8'));
    if (!info || info.app !== 'meistertracker' || typeof info.id !== 'string') return null;
    return Object.assign({}, info, { supported: info.format === FORMAT });
  } catch {
    return null;
  }
}

// Created exclusively: if two setups race, or a stick.json appears while the
// key is being derived, the second one fails instead of replacing the first.
// A replaced stick.json means a new salt, and every photo already written
// with the old one could never be opened again. A hard link is the atomic
// exclusive create; FAT and exFAT have none, so there an exclusive copy.
async function createExclusive(file, data) {
  const tmp = file + '.tmp-' + crypto.randomBytes(4).toString('hex');
  const fh = await fsp.open(tmp, 'wx');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    try {
      await fsp.link(tmp, file);
    } catch (e) {
      if (e.code === 'EEXIST') throw e;
      await fsp.copyFile(tmp, file, fs.constants.COPYFILE_EXCL);
      const fh2 = await fsp.open(file, 'r+');
      try {
        await fh2.sync();
      } finally {
        await fh2.close();
      }
    }
  } catch (e) {
    if (e.code === 'EEXIST') throw codeError('EXISTS', 'this stick is already set up');
    throw e;
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

// What is in the folder besides a stick.json and leftovers of a write. A
// folder with photos or snapshots but no stick.json lost its key data; set up
// anew, it would get a new salt, the old files would be skipped as present and
// never be readable. It is refused instead.
async function contentsBesidesStickFile(dir) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n !== STICK_FILE && !LEFTOVER.test(n));
}

async function initStick(root, recoveryKey, { label = '', now = new Date() } = {}) {
  const key = canonicalKey(recoveryKey);
  if (!key) throw codeError('BAD_KEY', 'not a recovery key');
  const dir = stickDir(root);
  const file = path.join(dir, STICK_FILE);
  if (fs.existsSync(file)) {
    // Half a stick.json from a setup that was cut off, in an otherwise empty
    // folder, is no stick: it goes. A readable one, or one next to backups,
    // stays and the setup is refused.
    const lesbar = await readStickInfo(root);
    if (lesbar || (await contentsBesidesStickFile(dir)).length) {
      throw codeError('EXISTS', 'this stick is already set up');
    }
    await fsp.rm(file, { force: true });
  }
  if ((await contentsBesidesStickFile(dir)).length) {
    throw codeError('NOT_EMPTY', 'the backup folder holds files but no stick.json');
  }
  await fsp.mkdir(dir, { recursive: true });
  const kdf = {
    alg: 'scrypt',
    salt: crypto.randomBytes(32).toString('base64'),
    N: backupCrypto.KDF.N,
    r: backupCrypto.KDF.r,
    p: backupCrypto.KDF.p
  };
  const stickKey = await deriveStickKey(key, kdf);
  const id = crypto.randomBytes(8).toString('hex');
  const info = {
    app: 'meistertracker',
    format: FORMAT,
    id,
    label: String(label || '').slice(0, 60),
    created: now.toISOString(),
    keyId: keyId(key),
    kdf,
    check: seal(stickKey, Buffer.from(CHECK_TEXT + '\n' + id), null).toString('base64')
  };
  await createExclusive(file, JSON.stringify(info, null, 2) + '\n');
  return { root, dir, info: Object.assign({}, info, { supported: true }), key: stickKey, recoveryKey: key };
}

async function openStick(root, recoveryKey) {
  const info = await readStickInfo(root);
  if (!info) throw codeError('NO_STICK', 'no backup stick here');
  if (!info.supported) throw codeError('FORMAT', 'stick written by a newer version');
  const key = canonicalKey(recoveryKey);
  if (!key) throw codeError('BAD_KEY', 'not a recovery key');
  if (info.keyId !== keyId(key)) throw codeError('WRONG_KEY', 'this stick belongs to another key');
  const stickKey = await deriveStickKey(key, info.kdf);
  const check = unseal(stickKey, Buffer.from(String(info.check || ''), 'base64'), null);
  if (!check || check.toString() !== CHECK_TEXT + '\n' + info.id) throw codeError('WRONG_KEY', 'key does not open it');
  return { root, dir: stickDir(root), info, key: stickKey, recoveryKey: key };
}

async function dbSnapshots(dbDir) {
  return (await fsp.readdir(dbDir)).filter((n) => DB_NAME.test(n)).sort();
}
async function nextDbNumber(dbDir) {
  const names = await dbSnapshots(dbDir);
  return names.length ? Number(DB_NAME.exec(names[names.length - 1])[1]) + 1 : 1;
}
// The snapshot of a run that has not finished yet. Rotation only happens at
// the end of a run that finished, and a run that writes a snapshot replaces
// the one an unfinished run left. Rotated as soon as it was written, a run
// that failed after the database step and was tried again every ten minutes
// (a photo on a failing disk, a stick that drops writes) pushed every older
// snapshot off the stick within five hours — the good restore points, just
// when a failing disk makes them matter.
const UNFINISHED = '.unfinished';
async function readUnfinished(dbDir) {
  try {
    const name = (await fsp.readFile(path.join(dbDir, UNFINISHED), 'utf8')).trim();
    return DB_NAME.test(name) ? name : null;
  } catch {
    return null;
  }
}

// The snapshot just written is never one of those that go.
async function rotateDb(dbDir, keep, justWritten) {
  const others = (await dbSnapshots(dbDir)).filter((n) => n !== justWritten);
  const drop = others.slice(0, Math.max(0, others.length - Math.max(0, keep - 1)));
  for (const n of drop) await fsp.rm(path.join(dbDir, n), { force: true });
  return drop.length;
}

// Errors from the PC's side of a run carry where: 'pc', so they are not
// reported as a stick that was pulled out or is write-protected. Everything
// else in a run is the stick's.
function onPc(promise) {
  return promise.catch((e) => {
    throw Object.assign(e, { where: 'pc' });
  });
}
function skippable(e) {
  return ['ENOENT', 'EBUSY', 'EPERM', 'EACCES'].includes(e && e.code);
}

// What the app has now, against what the last backup on this stick found. A
// new PC before its restore, an emptied photo folder, a database that lost
// most of itself: backed up as they are, they become the newest snapshot, the
// photo removals start counting down, and thirty days later the good
// snapshots have rotated out. So a run that finds less than half the photos,
// or a database under a fifth of the last one, stops and asks (SHRUNK);
// someone who means it backs up with the guard off.
const SHRINK_MIN_PHOTOS = 20;
const SHRINK_MIN_DB = 1024 * 1024;
async function checkNotShrunk(dir, photos, dbBytes) {
  let last;
  try {
    last = JSON.parse(await fsp.readFile(path.join(dir, LAST_FILE), 'utf8'));
  } catch {
    return;
  }
  const fewerPhotos = last.photos >= SHRINK_MIN_PHOTOS && photos < last.photos / 2;
  const smallerDb = dbBytes !== null && last.dbBytes >= SHRINK_MIN_DB && dbBytes < last.dbBytes / 5;
  if (fewerPhotos || smallerDb) {
    throw codeError(
      'SHRUNK',
      'less than last time: ' +
        photos +
        ' of ' +
        last.photos +
        ' photos, database ' +
        dbBytes +
        ' of ' +
        last.dbBytes +
        ' bytes'
    );
  }
}

// A few photos already on the stick must open with its key before more are
// added. Photos are skipped by name, so if the key data were ever replaced,
// every later run would "succeed" while nothing on the stick could be read.
// One file can be damaged; all three failing is the wrong key.
const SAMPLE = 3;
async function checkSample(stick, base, rels) {
  if (!rels.length) return;
  const sorted = rels.slice().sort();
  const pick = [...new Set([sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]])].slice(
    0,
    SAMPLE
  );
  let bad = 0;
  for (const rel of pick) {
    // A file that cannot be read says nothing about the key. Counted as
    // "does not open", a stick pulled during the check, or one whose flash
    // is failing, was reported as the wrong key, which is never tried again
    // by itself.
    let buf;
    try {
      buf = await fsp.readFile(fromRel(base, rel + '.enc'));
    } catch (e) {
      if (['EACCES', 'EPERM'].includes(e.code)) {
        throw codeError('DAMAGED', 'a photo on the stick cannot be read: ' + rel + ' (' + e.code + ')');
      }
      throw e;
    }
    try {
      const { meta } = openPhoto(stick.key, buf);
      if (meta.rel !== rel) bad++;
    } catch {
      bad++;
    }
  }
  if (bad === pick.length) throw codeError('WRONG_KEY', 'the photos on this stick do not open with its key');
}

// The stick's own folders must be folders on the stick. A link in their place
// (a junction on an NTFS stick) would send everything written "to the stick"
// somewhere else, the PC's disk included.
async function noLinkDirs(dirs) {
  for (const d of dirs) {
    let st;
    try {
      st = await fsp.lstat(d);
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    if (st.isSymbolicLink()) throw codeError('DAMAGED', d + ' is a link');
  }
}

// One backup onto an opened stick: the database snapshot, the photos it does
// not have yet, and the bookkeeping. `dbSnapshot` is a consistent copy the
// caller made (VACUUM INTO); it is read, not moved.
//
// onProgress gets { phase, done, total, bytesDone, bytesTotal } and is called
// often; throttle in the caller.
async function writeBackup({
  stick,
  photoDir,
  dbSnapshot,
  now = new Date(),
  keepDb = DB_KEEP,
  graceDays = REMOVED_GRACE_DAYS,
  guard = true,
  onProgress = () => {}
}) {
  const started = Date.now();
  const dir = stick.dir;
  const photosOnStick = path.join(dir, PHOTO_DIR);
  await noLinkDirs([dir, path.join(dir, DB_DIR), photosOnStick]);
  await fsp.mkdir(path.join(dir, DB_DIR), { recursive: true });
  await fsp.mkdir(photosOnStick, { recursive: true });
  await removeLeftovers(dir);

  // No photo folder means no photos to compare with, not that every photo on
  // the stick was deleted. Nothing is marked for removal in that case.
  const source = fs.existsSync(photoDir) ? await onPc(listFiles(photoDir)) : null;
  const plainDb = dbSnapshot ? await onPc(fsp.readFile(dbSnapshot)) : null;
  if (guard) await checkNotShrunk(dir, source ? source.size : 0, plainDb ? plainDb.length : null);

  // What the stick already has, before anything is written to it. Links on
  // the stick are not walked: one would let a prune delete files off the
  // stick, and new photos be written through it onto the PC.
  const onStick = await listFiles(photosOnStick, { followLinks: false });
  if (onStick.links.length) {
    throw codeError('DAMAGED', 'links on the stick: ' + onStick.links.slice(0, 3).join(', '));
  }
  // A folder on the stick that cannot be read: its photos would be taken for
  // missing and written again into a folder that is failing, and their
  // removal dates dropped. The stick needs a look first.
  if (onStick.unreadable.length) {
    throw codeError('DAMAGED', 'folders on the stick cannot be read: ' + onStick.unreadable.slice(0, 3).join(', '));
  }
  const have = new Set();
  for (const rel of onStick.keys()) if (rel.endsWith('.enc')) have.add(rel.slice(0, -4));

  let bytesWritten = 0;
  let dbFile = null;
  const dbDir = path.join(dir, DB_DIR);
  if (plainDb) {
    onProgress({ phase: 'db', done: 0, total: 0, bytesDone: 0, bytesTotal: 0 });
    const enc = await backupCrypto.encryptBackupAsync(plainDb, stick.recoveryKey);
    const nummer = await nextDbNumber(dbDir);
    dbFile = DB_PREFIX + String(nummer).padStart(6, '0') + '_' + stamp(now) + '.enc';
    const before = await readUnfinished(dbDir);
    await writeFileAtomic(path.join(dbDir, dbFile), enc);
    bytesWritten += enc.length;
    await writeFileAtomic(path.join(dbDir, UNFINISHED), dbFile + '\n');
    // An earlier run that got this far and no further: this snapshot is newer.
    if (before && before !== dbFile) await fsp.rm(path.join(dbDir, before), { force: true });
  }

  await checkSample(stick, photosOnStick, [...have]);
  const todo = [];
  const skipped = [];
  let bytesTotal = 0;
  if (source) {
    for (const [rel, abs] of source) {
      if (have.has(rel)) continue;
      let st;
      try {
        st = await fsp.stat(abs);
      } catch (e) {
        if (skippable(e)) {
          skipped.push({ rel, code: e.code });
          continue;
        }
        throw Object.assign(e, { where: 'pc' });
      }
      todo.push({ rel, abs, size: st.size, mtime: st.mtime.toISOString() });
      bytesTotal += st.size;
    }
  }
  let done = 0;
  let written = 0;
  let bytesDone = 0;
  onProgress({ phase: 'photos', done, total: todo.length, bytesDone, bytesTotal });
  for (const f of todo) {
    // A photo deleted while the run went on (a report removed, an upload
    // rolled back), or one a virus scanner holds: not the stick's fault and no
    // reason to stop. It is not on the stick, so the next run tries again.
    let data;
    try {
      data = await fsp.readFile(f.abs);
    } catch (e) {
      if (skippable(e)) {
        skipped.push({ rel: f.rel, code: e.code });
        done++;
        bytesDone += f.size;
        continue;
      }
      throw Object.assign(e, { where: 'pc' });
    }
    const meta = {
      rel: f.rel,
      bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
      mtime: f.mtime
    };
    const target = fromRel(photosOnStick, f.rel + '.enc');
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const sealed = sealPhoto(stick.key, data, meta);
    await writeFileAtomic(target, sealed);
    bytesWritten += sealed.length;
    written++;
    done++;
    bytesDone += f.size;
    onProgress({ phase: 'photos', done, total: todo.length, bytesDone, bytesTotal });
  }

  let pruned = 0;
  let pending = 0;
  const pruneFailed = [];
  if (source) {
    const removedFile = path.join(dir, REMOVED_FILE);
    let record = null;
    try {
      record = JSON.parse(await fsp.readFile(removedFile, 'utf8'));
    } catch {
      record = null;
    }
    const { removed, lastRun } = parseRemoved(record);
    const r = trackRemoved({
      existing: have,
      source: new Set(source.keys()),
      removed,
      lastRun,
      now,
      graceDays,
      unreadable: source.unreadable
    });
    for (const rel of r.prune) {
      // One old file the stick will not let go of is no reason to fail a run
      // whose snapshot and photos are already written: it stays marked, and
      // the next run tries again. Thrown, it failed every run on that stick,
      // and left last-backup.json, removed.json and the run's record behind.
      try {
        await fsp.rm(fromRel(photosOnStick, rel + '.enc'), { force: true });
        pruned++;
      } catch (e) {
        r.removed[rel] = removed[rel];
        pruneFailed.push({ rel, code: e.code || 'ERROR' });
      }
    }
    pending = Object.keys(r.removed).length;
    if (r.changed) await writeFileAtomic(removedFile, serializeRemoved(r.removed, r.lastRun));
    if (pruned) await removeEmptyDirs(photosOnStick);
  }

  const summary = {
    skipped,
    // Folders under the photo folder the run could not open: whatever is in
    // them is not on the stick either.
    unreadable: source ? source.unreadable.slice() : [],
    time: now.toISOString(),
    dbFile,
    dbBytes: plainDb ? plainDb.length : null,
    photos: source ? source.size : 0,
    photosNew: written,
    bytesWritten,
    pruned,
    pruneFailed,
    pendingRemoval: pending,
    durationMs: Date.now() - started
  };
  await writeFileAtomic(path.join(dir, LAST_FILE), JSON.stringify(summary, null, 2) + '\n');
  if (dbFile) {
    await rotateDb(dbDir, keepDb, dbFile);
    await fsp.rm(path.join(dbDir, UNFINISHED), { force: true });
  }
  return summary;
}

// ── Finding sticks ───────────────────────────────────────────

function listDirs(base) {
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => path.join(base, e.name));
  } catch {
    return [];
  }
}

// Where a plugged-in stick can show up. On Windows every drive letter from C:
// (a second internal disk is a fair target too); the app's own disk is ruled
// out later by device, not by letter. Elsewhere the usual mount folders.
// USB_BACKUP_ROOTS replaces the list, separated like PATH.
function candidateRoots({ platform = process.platform, env = process.env } = {}) {
  if (env.USB_BACKUP_ROOTS) {
    return env.USB_BACKUP_ROOTS.split(path.delimiter)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (platform === 'win32') return 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => l + ':\\');
  if (platform === 'darwin') return listDirs('/Volumes');
  const out = [];
  for (const base of ['/media', '/run/media']) {
    for (const d of listDirs(base)) out.push(d, ...listDirs(d));
  }
  return out.concat(listDirs('/mnt'));
}

async function deviceOf(p) {
  try {
    return (await fsp.stat(p, { bigint: true })).dev;
  } catch {
    return null;
  }
}

// The drives that could take a stick, for setting one up: free space, whether
// it is the app's own disk, and whether it already carries a stick. The app's
// own disk is told by device, not by name: a backup there is no backup.
// On Windows a drive letter is a volume, and two letters can be two
// partitions of one disk: a backup on D: goes with C: when the disk dies. WMI
// knows which disk each letter is on (Win32_LogicalDiskToPartition, readable
// without administrator rights). Best effort: without an answer, the volume
// check is all there is. Returns a Map of letter → disk number.
function parseDiskNumbers(text) {
  const out = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([A-Za-z]):=Disk #(\d+),/.exec(line.trim());
    if (m) out.set(m[1].toUpperCase(), Number(m[2]));
  }
  return out;
}
function windowsDiskNumbers() {
  const { execFile } = require('child_process');
  const script =
    'Get-CimInstance Win32_LogicalDiskToPartition | ForEach-Object { ' +
    "'{0}={1}' -f $_.Dependent.DeviceID, $_.Antecedent.DeviceID }";
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15000, windowsHide: true },
      (err, stdout) => resolve(err ? new Map() : parseDiskNumbers(stdout))
    );
  });
}
function driveLetter(p) {
  const m = /^([A-Za-z]):/.exec(String(p || ''));
  return m ? m[1].toUpperCase() : null;
}
// Both letters known, both on the same disk number.
function onSameDisk(appDir, root, diskOf) {
  const a = diskOf.get(driveLetter(appDir));
  return a !== undefined && a === diskOf.get(driveLetter(root));
}

async function listDrives(roots, appDir, { platform = process.platform, disks = null } = {}) {
  const appDev = await deviceOf(appDir);
  const diskOf = platform === 'win32' ? disks || (await windowsDiskNumbers()) : new Map();
  const out = [];
  for (const root of roots) {
    let st;
    try {
      st = await fsp.stat(root, { bigint: true });
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const sameDisk = (appDev !== null && st.dev === appDev) || onSameDisk(appDir, root, diskOf);
    const drive = { root, sameDisk, free: null, total: null };
    try {
      const s = await fsp.statfs(root);
      drive.free = Number(s.bavail) * Number(s.bsize);
      drive.total = Number(s.blocks) * Number(s.bsize);
    } catch {
      /* not every platform answers this for every mount */
    }
    drive.stick = await readStickInfo(root);
    out.push(drive);
  }
  return out;
}

// The sticks plugged in right now.
async function findSticks(roots) {
  const out = [];
  for (const root of roots) {
    const info = await readStickInfo(root);
    if (info) out.push({ root, info });
  }
  return out;
}

module.exports = {
  STICK_DIR,
  STICK_FILE,
  DB_DIR,
  PHOTO_DIR,
  REMOVED_FILE,
  LAST_FILE,
  DB_KEEP,
  DB_NAME,
  REMOVED_GRACE_DAYS,
  codeError,
  generateRecoveryKey,
  canonicalKey,
  keyId,
  sealPhoto,
  openPhoto,
  safeRel,
  stickDir,
  readStickInfo,
  initStick,
  openStick,
  writeBackup,
  candidateRoots,
  listDrives,
  parseDiskNumbers,
  onSameDisk,
  findSticks,
  deviceOf
};
