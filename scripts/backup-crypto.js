'use strict';
// The encrypted database backup, as Settings → Backup downloads and restores it.
//
// Layout ("v2"): "MPLZ" | 0x02 | salt (32) | iv (12) | GCM tag (16) | ciphertext.
// The key is scrypt(password, salt) with the parameters below.
//
// It lived inline in the download and restore routes. It moved here because a
// second writer appeared: the USB stick backup stores its database snapshots in
// exactly this format, so that a snapshot taken off the stick restores through
// the same button as a downloaded one. Two copies of a file format drift; the
// first byte that differs is found on the day someone needs the backup.
//
// The legacy v1 reader (no magic prefix) stays in the restore route. Nothing
// writes v1 any more, and nothing outside that route reads it.

const crypto = require('crypto');

const MAGIC = Buffer.from('MPLZ', 'ascii');
const VERSION = 0x02;
const SALT_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN;

// scrypt at N = 2^17 needs 128 MB; maxmem leaves room for Node's own overhead.
// These numbers are part of the format: a file written with other ones cannot
// be read back with these, so they never change for v2.
const KDF = { N: 131072, r: 8, p: 4, maxmem: 256 * 1024 * 1024 };

function isEncryptedBackup(raw) {
  return Buffer.isBuffer(raw) && raw.length >= 5 && raw.subarray(0, 4).equals(MAGIC) && raw[4] === VERSION;
}

function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, 32, KDF);
}

// The same derivation without blocking the event loop for the second or so it
// takes. The routes use the synchronous one, as they always have; the USB
// backup runs while the app is in use and must not freeze it.
function deriveKeyAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, KDF, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function seal(plain, key, salt) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, cipher.getAuthTag(), enc]);
}

function encryptBackup(plain, password) {
  const salt = crypto.randomBytes(SALT_LEN);
  return seal(plain, deriveKey(password, salt), salt);
}

async function encryptBackupAsync(plain, password) {
  const salt = crypto.randomBytes(SALT_LEN);
  return seal(plain, await deriveKeyAsync(password, salt), salt);
}

function parts(raw) {
  if (!isEncryptedBackup(raw)) throw new Error('not an encrypted backup');
  if (raw.length < HEADER_LEN) throw new Error('file too small to be a valid backup');
  let at = MAGIC.length + 1;
  const salt = raw.subarray(at, (at += SALT_LEN));
  const iv = raw.subarray(at, (at += IV_LEN));
  const tag = raw.subarray(at, (at += TAG_LEN));
  return { salt, iv, tag, cipherText: raw.subarray(at) };
}

function open(p, key) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, p.iv);
    decipher.setAuthTag(p.tag);
    return Buffer.concat([decipher.update(p.cipherText), decipher.final()]);
  } catch {
    return null;
  }
}

// null for a wrong password or a damaged file: GCM cannot tell the two apart,
// and the caller says "wrong password or corrupted file" either way. A file that
// is not this format at all throws, because that is a different message.
function decryptBackup(raw, password) {
  const p = parts(raw);
  return open(p, deriveKey(password, p.salt));
}

async function decryptBackupAsync(raw, password) {
  const p = parts(raw);
  return open(p, await deriveKeyAsync(password, p.salt));
}

module.exports = {
  MAGIC,
  VERSION,
  HEADER_LEN,
  KDF,
  isEncryptedBackup,
  encryptBackup,
  encryptBackupAsync,
  decryptBackup,
  decryptBackupAsync,
  deriveKeyAsync
};
