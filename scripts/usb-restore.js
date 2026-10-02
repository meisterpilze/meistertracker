#!/usr/bin/env node
'use strict';
// Getting the data back off a backup stick.
//
//   node scripts/usb-restore.js <stick> --verify
//   node scripts/usb-restore.js <stick> --photos <folder> [--overwrite]
//   node scripts/usb-restore.js <stick> --db <file> [--from <name.enc>] [--force]
//
// <stick> is the drive (E:\, /media/…) or the MEISTERTRACKER-BACKUP folder on
// it. The recovery key is read from USB_BACKUP_KEY, or asked for.
//
// The database also goes back through Settings → Backup → Restore: choose a
// file from db/ on the stick and type the recovery key as the password. This
// script is for when there is no running app to do that in — a new PC — and
// for the photos, which that page does not bring back.
//
// --verify reads every photo and the newest database snapshot, decrypts them
// and checks their checksums, and writes nothing. A backup that has never been
// read back is a hope, not a backup; run this now and then.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const backupCrypto = require('./backup-crypto.js');
const usbStick = require('./usb-stick.js');
const { listFiles, fromRel } = require('./photo-mirror.js');
const { writeFileAtomic } = require('./atomic-file.js');

// The drive, or the folder on it.
function resolveStick(p) {
  const abs = path.resolve(p);
  if (fs.existsSync(path.join(abs, usbStick.STICK_DIR, usbStick.STICK_FILE))) return abs;
  if (path.basename(abs) === usbStick.STICK_DIR && fs.existsSync(path.join(abs, usbStick.STICK_FILE))) {
    return path.dirname(abs);
  }
  throw usbStick.codeError('NO_STICK', 'no backup stick at ' + abs);
}

async function listDbFiles(root) {
  try {
    return (await fsp.readdir(path.join(usbStick.stickDir(root), usbStick.DB_DIR)))
      .filter((n) => usbStick.DB_NAME.test(n))
      .sort();
  } catch {
    return [];
  }
}

// Every photo on the stick, decrypted and checked. `each` gets the path, the
// header and the bytes of every good one.
async function eachPhoto(stick, each) {
  const base = path.join(stick.dir, usbStick.PHOTO_DIR);
  const bad = [];
  let ok = 0;
  // Only what is really on the stick: a link there is no photo of the backup,
  // and following it would read (or, restoring, trust) files from elsewhere.
  const files = await listFiles(base, { followLinks: false });
  for (const link of files.links) bad.push({ rel: link, error: 'LINK' });
  // A folder that cannot be read holds photos nobody can count: every one of
  // them would be missing from the check and from the restore without a word.
  for (const folder of files.unreadable) bad.push({ rel: folder, error: 'UNREADABLE' });
  for (const [name, abs] of files) {
    if (!name.endsWith('.enc')) continue;
    const rel = name.slice(0, -4);
    try {
      const { meta, data } = usbStick.openPhoto(stick.key, await fsp.readFile(abs));
      // The header is inside the encryption; the file name is not. A photo
      // renamed on the stick would otherwise come back in someone else's place.
      if (meta.rel !== rel || !usbStick.safeRel(meta.rel)) throw usbStick.codeError('BAD_FILE', 'name does not match');
      if (crypto.createHash('sha256').update(data).digest('hex') !== meta.sha256) {
        throw usbStick.codeError('CHECKSUM', 'checksum does not match');
      }
      await each(rel, meta, data);
      ok++;
    } catch (e) {
      bad.push({ rel, error: e.code || e.message });
    }
  }
  return { ok, bad };
}

async function verify({ root, key }) {
  const stick = await usbStick.openStick(root, key);
  const photos = await eachPhoto(stick, async () => {});
  const dbFiles = await listDbFiles(root);
  let db = null;
  if (dbFiles.length) {
    const newest = dbFiles[dbFiles.length - 1];
    const raw = await fsp.readFile(path.join(stick.dir, usbStick.DB_DIR, newest));
    const plain = await backupCrypto.decryptBackupAsync(raw, stick.recoveryKey);
    db = { file: newest, ok: !!plain && plain.toString('utf8', 0, 15) === 'SQLite format 3', count: dbFiles.length };
  }
  return { stick: stick.info.label || stick.info.id, photos, db };
}

async function restorePhotos({ root, key, target, overwrite = false }) {
  const stick = await usbStick.openStick(root, key);
  let restored = 0;
  let skipped = 0;
  const result = await eachPhoto(stick, async (rel, meta, data) => {
    const dest = fromRel(target, rel);
    if (!overwrite && fs.existsSync(dest)) {
      skipped++;
      return;
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    // Into the live photo folder, while a virus scanner may be looking at
    // every new file: a rename it holds is waited out, and one that fails for
    // good takes its temporary file with it.
    await writeFileAtomic(dest, data);
    const mtime = new Date(meta.mtime);
    if (!isNaN(mtime)) await fsp.utimes(dest, mtime, mtime).catch(() => {});
    restored++;
  });
  return { restored, skipped, bad: result.bad };
}

// The files SQLite keeps beside a database. A -wal left over from the old
// database is applied to whatever file carries the name next: a restored
// snapshot with the old WAL beside it opens as the old data, or as a damaged
// mix of both. So all of them go aside together, renamed, never deleted.
const SIDECARS = ['', '-wal', '-shm', '-journal'];

function stampOf(now) {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

// SQLite's own quick check of the decrypted snapshot, before it replaces
// anything.
function quickCheck(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('PRAGMA quick_check').get();
    return row && Object.values(row)[0] === 'ok';
  } finally {
    db.close();
  }
}

// Opened the way the server opens its database at start-up (schema and
// migrations), as Settings → Backup → Restore does before it swaps a file
// in. A file that passes SQLite's own check but not this one used to be put
// in place after the live database was moved aside, and the server then
// failed at its next start. The check runs on a copy, so the restored file
// stays byte for byte the snapshot; the migrations' own lines are kept off
// the screen, since they are about the copy.
function opensAsAppDb(file) {
  const appDb = require(path.join(__dirname, '..', 'db.js'));
  const copy = file + '.check';
  fs.copyFileSync(file, copy);
  const say = console.log;
  console.log = () => {};
  try {
    appDb.openDb(copy).close();
  } catch (e) {
    throw usbStick.codeError('CORRUPT', 'the snapshot does not open as this app’s database: ' + e.message);
  } finally {
    console.log = say;
    for (const p of [copy, copy + '-wal', copy + '-shm']) fs.rmSync(p, { force: true });
  }
}

async function restoreDb({ root, key, target, from, force = false, now = new Date() }) {
  const stick = await usbStick.openStick(root, key);
  const files = await listDbFiles(root);
  const file = from || files[files.length - 1];
  if (!file || !files.includes(file)) throw usbStick.codeError('NO_DB', 'no such database snapshot on the stick');
  const present = SIDECARS.map((s) => target + s).filter((p) => fs.existsSync(p));
  if (present.length && !force) {
    throw usbStick.codeError('EXISTS', present.join(', ') + ' exist; --force moves them aside');
  }
  const plain = await backupCrypto.decryptBackupAsync(
    await fsp.readFile(path.join(stick.dir, usbStick.DB_DIR, file)),
    stick.recoveryKey
  );
  if (!plain || plain.toString('utf8', 0, 15) !== 'SQLite format 3') {
    throw usbStick.codeError('AUTH', 'snapshot does not decrypt to a database');
  }
  const tmp = target + '.tmp-' + crypto.randomBytes(4).toString('hex');
  await fsp.writeFile(tmp, plain, { mode: 0o600 });
  try {
    if (!quickCheck(tmp)) throw usbStick.codeError('CORRUPT', "the snapshot fails SQLite's quick check");
    opensAsAppDb(tmp);
  } catch (e) {
    for (const p of [tmp, tmp + '-wal', tmp + '-shm']) await fsp.rm(p, { force: true });
    throw e.code === 'CORRUPT'
      ? e
      : usbStick.codeError('CORRUPT', 'the snapshot is not a usable database: ' + e.message);
  }
  const aside = '.before-restore-' + stampOf(now);
  const moved = [];
  try {
    // The database first: on Windows a running server holds it open, the
    // rename fails, and nothing has been touched yet.
    for (const p of present) {
      await fsp.rename(p, p + aside);
      moved.push(p);
    }
    await fsp.rename(tmp, target);
  } catch (e) {
    for (const p of moved.reverse()) await fsp.rename(p + aside, p).catch(() => {});
    await fsp.rm(tmp, { force: true });
    if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) {
      throw usbStick.codeError('IN_USE', target + ' is in use; stop the server first');
    }
    throw e;
  }
  return { file, bytes: plain.length, movedAside: moved.map((p) => p + aside) };
}

function parseArgs(argv) {
  const out = { stick: null, verify: false, photos: null, db: null, from: null, overwrite: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verify') out.verify = true;
    else if (a === '--photos') out.photos = argv[++i];
    else if (a === '--db') out.db = argv[++i];
    else if (a === '--from') out.from = argv[++i];
    else if (a === '--overwrite') out.overwrite = true;
    else if (a === '--force') out.force = true;
    else if (!a.startsWith('--') && !out.stick) out.stick = a;
    else throw new Error('unknown argument: ' + a);
  }
  return out;
}

// Asked on the terminal when USB_BACKUP_KEY is not set. Input that ends
// before a line (an empty pipe, a scheduled task, Ctrl+D or Ctrl+C) is no
// key: readline never answers the question then, and the script used to end
// with exit code 0 having done nothing, so a scripted --verify "passed".
function askKey() {
  return new Promise((resolve, reject) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stderr });
    let answered = false;
    rl.on('close', () => {
      if (!answered)
        reject(usbStick.codeError('BAD_KEY', 'no recovery key: USB_BACKUP_KEY is not set and none was typed'));
    });
    rl.question('Recovery key: ', (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(e.message + '\n');
    args = null;
  }
  if (!args || !args.stick || (!args.verify && !args.photos && !args.db)) {
    process.stderr.write(
      'usage: node scripts/usb-restore.js <stick> --verify\n' +
        '       node scripts/usb-restore.js <stick> --photos <folder> [--overwrite]\n' +
        '       node scripts/usb-restore.js <stick> --db <file> [--from <name.enc>] [--force]\n'
    );
    process.exitCode = 2;
    return;
  }
  try {
    const root = resolveStick(args.stick);
    const key = usbStick.canonicalKey(process.env.USB_BACKUP_KEY || (await askKey()));
    if (!key) throw usbStick.codeError('BAD_KEY', 'that is not a recovery key');
    let failed = false;
    if (args.verify) {
      const r = await verify({ root, key });
      console.log('Stick: ' + r.stick);
      console.log('Photos: ' + r.photos.ok + ' good, ' + r.photos.bad.length + ' bad');
      for (const b of r.photos.bad) console.log('  bad: ' + b.rel + ' (' + b.error + ')');
      if (r.db)
        console.log(
          'Database: ' + r.db.count + ' snapshots, newest ' + r.db.file + (r.db.ok ? ' reads' : ' DOES NOT READ')
        );
      else console.log('Database: no snapshot on the stick');
      failed = r.photos.bad.length > 0 || !r.db || !r.db.ok;
    }
    if (args.db) {
      const r = await restoreDb({ root, key, target: path.resolve(args.db), from: args.from, force: args.force });
      console.log('Database ' + r.file + ' → ' + path.resolve(args.db) + ' (' + r.bytes + ' bytes)');
      for (const p of r.movedAside) console.log('  moved aside: ' + p);
    }
    if (args.photos) {
      const r = await restorePhotos({ root, key, target: path.resolve(args.photos), overwrite: args.overwrite });
      console.log('Photos: ' + r.restored + ' restored, ' + r.skipped + ' already there, ' + r.bad.length + ' bad');
      for (const b of r.bad) console.log('  bad: ' + b.rel + ' (' + b.error + ')');
      if (r.bad.length) failed = true;
    }
    // exitCode, not exit(): exit() ends the process before output to a pipe
    // has drained, and a long list of bad files lost its tail.
    process.exitCode = failed ? 1 : 0;
  } catch (e) {
    process.stderr.write('usb-restore: ' + (e.code ? e.code + ': ' : '') + e.message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { resolveStick, listDbFiles, verify, restorePhotos, restoreDb, parseArgs };

if (require.main === module) main();
