'use strict';
// The encrypted backup file Settings → Backup downloads and restores, now in
// scripts/backup-crypto.js because the USB stick writes it too.
//
// The point of these tests is that moving it changed nothing: a file written
// by the code as it stood inline in server.js opens with the module, and a
// file the module writes opens with that code. Both directions, because a
// backup downloaded last month has to restore next month.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const backupCrypto = require('../scripts/backup-crypto.js');

// The download route before the move, verbatim in what it computed.
function oldEncrypt(plain, password) {
  const salt = crypto.randomBytes(32);
  const key = crypto.scryptSync(password, salt, 32, { N: 131072, r: 8, p: 4, maxmem: 256 * 1024 * 1024 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('MPLZ', 'ascii'), Buffer.from([0x02]), salt, iv, tag, enc]);
}

// The v2 branch of the restore route before the move.
function oldDecrypt(raw, password) {
  const salt = raw.subarray(5, 37);
  const iv = raw.subarray(37, 49);
  const tag = raw.subarray(49, 65);
  const key = crypto.scryptSync(password, salt, 32, { N: 131072, r: 8, p: 4, maxmem: 256 * 1024 * 1024 });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(raw.subarray(65)), decipher.final()]);
}

const PLAIN = Buffer.concat([Buffer.from('SQLite format 3\0'), crypto.randomBytes(4096)]);

describe('backup-crypto', () => {
  it('opens a file the old download route wrote', () => {
    assert.ok(
      backupCrypto.decryptBackup(oldEncrypt(PLAIN, 'a long enough password'), 'a long enough password').equals(PLAIN)
    );
  });

  it('writes a file the old restore route opens', () => {
    assert.ok(
      oldDecrypt(backupCrypto.encryptBackup(PLAIN, 'a long enough password'), 'a long enough password').equals(PLAIN)
    );
  });

  it('does the same without blocking, in both directions', async () => {
    const enc = await backupCrypto.encryptBackupAsync(PLAIN, 'pw pw pw pw pw');
    assert.ok(backupCrypto.isEncryptedBackup(enc));
    assert.ok((await backupCrypto.decryptBackupAsync(enc, 'pw pw pw pw pw')).equals(PLAIN));
  });

  it('answers a wrong password with null, and a foreign file with an error', () => {
    const enc = backupCrypto.encryptBackup(PLAIN, 'right password!');
    assert.equal(backupCrypto.decryptBackup(enc, 'wrong password!'), null);
    assert.throws(() => backupCrypto.decryptBackup(Buffer.from('not a backup at all'), 'x'), /not an encrypted backup/);
    assert.throws(() => backupCrypto.decryptBackup(enc.subarray(0, 40), 'x'), /too small/);
  });
});

describe('the routes use it', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  function route(marker, end) {
    const a = SRC.indexOf(marker);
    assert.ok(a > 0, marker);
    return SRC.slice(a, SRC.indexOf(end, a));
  }

  it('download encrypts through the module', () => {
    const r = route("req.url === '/api/backup/download'", '// -- Backup Restore');
    assert.match(r, /backupCrypto\.encryptBackup\(plain, data\.password\)/);
    assert.doesNotMatch(r, /createCipheriv/);
  });

  it('restore reads v2 through the module and keeps the v1 reader', () => {
    const r = route("req.url.startsWith('/api/backup/restore')", '// POST /api/print');
    assert.match(r, /backupCrypto\.isEncryptedBackup\(raw\)/);
    assert.match(r, /backupCrypto\.decryptBackup\(raw, password\)/);
    assert.match(r, /N: 32768/, 'the legacy v1 KDF is still there');
  });
});
