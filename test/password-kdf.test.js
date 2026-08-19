'use strict';
// How hard an account password is to crack, and what that costs at the door.
//
// createUser, resetUserPassword and verifyPassword all called
// crypto.scryptSync(password, salt, 64) with no options — Node's defaults,
// N=16384, roughly 16 MB and 30-50 ms. Four hundred lines away in server.js the
// *backup file* KDF used N=131072 with maxmem 256 MB. So the account passwords,
// which is what an attacker with a stolen database actually goes after, had the
// weakest KDF in the codebase and the backup archive had the strongest.
//
// Raising it is easy; not locking anybody out while doing so is the part that
// needs care. The parameters travel in the salt column — "s2$" prefix for the
// current cost, bare hex for anything written before — so both formats verify,
// and a row is re-hashed the next time its owner logs in. That is the only
// moment the plaintext exists, so it is the only chance.
//
// The knock-on effect is CalDAV: it re-verifies HTTP Basic auth on *every*
// request, so the new cost would put ~300 ms of CPU behind each PROPFIND. The
// cache in checkCaldavAuth exists for that, and it caches only the outcome of
// the password check — never the account row, so permissions stay live.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

describe('scrypt parameters', () => {
  it('meets the OWASP floor of N=2^17, r=8, p=1', () => {
    const dbSrc = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
    const m = dbSrc.match(/const SCRYPT_PARAMS = \{([^}]*)\}/);
    assert.ok(m, 'SCRYPT_PARAMS is gone from db.js');
    const params = Function('return {' + m[1] + '}')();
    assert.ok(params.N >= 131072, 'N is ' + params.N + ', below 2^17');
    assert.equal(params.r, 8);
    assert.ok(params.p >= 1);
    // 128 * N * r is 128 MB here; scryptSync throws rather than degrading if
    // maxmem is left at Node's 32 MB default.
    assert.ok(params.maxmem >= 128 * params.N * params.r, 'maxmem is below what these parameters need');
  });

  it('actually costs what it claims to', () => {
    const { salt, hash } = db.hashPassword('correct horse battery staple');
    const t0 = process.hrtime.bigint();
    assert.equal(db.verifyPassword(hash, salt, 'correct horse battery staple'), true);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    // Deliberately loose — this is a smoke test against silently falling back
    // to the defaults on a slow CI box, not a benchmark.
    assert.ok(ms > 60, 'a verify took ' + Math.round(ms) + ' ms, which is default-cost territory');
  });
});

describe('hashPassword / verifyPassword', () => {
  it('marks the salt so the row describes its own parameters', () => {
    const { salt } = db.hashPassword('pw');
    assert.match(salt, /^s2\$[0-9a-f]{32}$/);
  });

  it('round-trips, and rejects the wrong password', () => {
    const { salt, hash } = db.hashPassword('pw');
    assert.equal(db.verifyPassword(hash, salt, 'pw'), true);
    assert.equal(db.verifyPassword(hash, salt, 'pW'), false);
    assert.equal(db.verifyPassword(hash, salt, ''), false);
  });

  it('uses a fresh salt every time', () => {
    assert.notEqual(db.hashPassword('pw').salt, db.hashPassword('pw').salt);
  });

  it('still verifies a hash written before the change', () => {
    // Exactly what is in the users table on a host running the old code.
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('legacy pw', salt, 64).toString('hex');
    assert.equal(db.verifyPassword(hash, salt, 'legacy pw'), true, 'existing users must not be locked out');
    assert.equal(db.verifyPassword(hash, salt, 'wrong'), false);
  });

  it('flags the old format for upgrade and the new one as done', () => {
    assert.equal(db.passwordNeedsUpgrade(crypto.randomBytes(16).toString('hex')), true);
    assert.equal(db.passwordNeedsUpgrade(db.hashPassword('pw').salt), false);
    assert.equal(db.passwordNeedsUpgrade(null), true);
    assert.equal(db.passwordNeedsUpgrade(undefined), true);
  });
});

describe('accounts on disk', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_kdf_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('createUser writes the current parameters', () => {
    db.createUser(d, 'fresh', 'a good password', 'user');
    const row = db.getUserByUsername(d, 'fresh');
    assert.equal(db.passwordNeedsUpgrade(row.salt), false);
    assert.equal(db.verifyPassword(row.hash, row.salt, 'a good password'), true);
  });

  it('resetUserPassword writes the current parameters', () => {
    db.createUser(d, 'reset-me', 'the old password', 'user');
    const before = db.getUserByUsername(d, 'reset-me');
    // Force the row back to the legacy shape, as an existing install has it.
    const legacySalt = crypto.randomBytes(16).toString('hex');
    d.prepare('UPDATE users SET hash=?, salt=? WHERE id=?').run(
      crypto.scryptSync('the old password', legacySalt, 64).toString('hex'),
      legacySalt,
      before.id
    );
    assert.equal(db.passwordNeedsUpgrade(db.getUserByUsername(d, 'reset-me').salt), true, 'precondition');

    db.resetUserPassword(d, before.id, 'the new password');
    const after = db.getUserByUsername(d, 'reset-me');
    assert.equal(db.passwordNeedsUpgrade(after.salt), false);
    assert.equal(db.verifyPassword(after.hash, after.salt, 'the new password'), true);
    assert.equal(db.verifyPassword(after.hash, after.salt, 'the old password'), false);
  });

  it('a legacy row verifies, then upgrades in place the way login does it', () => {
    db.createUser(d, 'oldtimer', 'unchanged password', 'user');
    const u = db.getUserByUsername(d, 'oldtimer');
    const legacySalt = crypto.randomBytes(16).toString('hex');
    d.prepare('UPDATE users SET hash=?, salt=? WHERE id=?').run(
      crypto.scryptSync('unchanged password', legacySalt, 64).toString('hex'),
      legacySalt,
      u.id
    );

    const stale = db.getUserByUsername(d, 'oldtimer');
    assert.equal(db.verifyPassword(stale.hash, stale.salt, 'unchanged password'), true);
    assert.equal(db.passwordNeedsUpgrade(stale.salt), true);

    const upgraded = db.hashPassword('unchanged password');
    db.updateUserPassword(d, u.id, upgraded.hash, upgraded.salt);

    const now = db.getUserByUsername(d, 'oldtimer');
    assert.equal(db.passwordNeedsUpgrade(now.salt), false);
    // Same password, still works — the point of the exercise.
    assert.equal(db.verifyPassword(now.hash, now.salt, 'unchanged password'), true);
  });
});

describe('the login path upgrades and the dummy keeps up', () => {
  it('re-hashes on a successful login', () => {
    assert.match(SRC, /db\.passwordNeedsUpgrade\(user\.salt\)/);
    assert.match(SRC, /db\.updateUserPassword\(database, user\.id, upgraded\.hash, upgraded\.salt\)/);
  });

  it('the constant-time dummy is minted with the same parameters', () => {
    // A dummy left on the old cost would answer measurably faster than a real
    // account and re-open the enumeration channel it exists to close.
    assert.match(SRC, /db\.hashPassword\(\s*crypto\.randomBytes\(32\)\.toString\('hex'\)\s*\)/);
    assert.equal(/DUMMY_PASSWORD_HASH = crypto\.scryptSync/.test(SRC), false);
  });

  it('no route hashes a password by hand any more', () => {
    // Every remaining scryptSync in server.js belongs to the backup archive KDF,
    // which has its own (higher) parameters and its own format.
    for (const line of SRC.split('\n').filter((l) => l.includes('scryptSync'))) {
      assert.match(line, /32,\s*\{|maxmem|N:/, 'unexpected bare scryptSync: ' + line.trim());
    }
  });
});

describe('the CalDAV credential cache', () => {
  it('caches the check, not the account', () => {
    // The re-read is what keeps a role change or a deleted account immediate.
    assert.match(SRC, /const cached = caldavAuthCache\.get\(cacheKey\);/);
    assert.match(SRC, /db\.getUserByUsername\(database, cached\.username\)/);
  });

  it('never caches a failed verification', () => {
    const fn = SRC.match(/function checkCaldavAuth\(req\) \{[\s\S]*?\n\}/)[0];
    const set = fn.indexOf('caldavAuthCache.set');
    const verify = fn.indexOf('db.verifyPassword');
    assert.ok(verify >= 0 && set > verify, 'the cache write has to sit inside the success branch');
    assert.equal((fn.match(/caldavAuthCache\.set/g) || []).length, 1);
  });

  it('is bounded, and evicts oldest-first', () => {
    assert.match(SRC, /caldavAuthCache\.size >= CALDAV_AUTH_CACHE_MAX/);
    assert.match(SRC, /caldavAuthCache\.delete\(caldavAuthCache\.keys\(\)\.next\(\)\.value\)/);
  });

  it('keys are peppered per process, so they mean nothing elsewhere', () => {
    const fn = SRC.match(/function caldavAuthCacheKey\(user, pass\) \{[\s\S]*?\n\}/)[0];
    assert.match(fn, /CALDAV_AUTH_PEPPER/);
    assert.match(fn, /\\u0000/, 'user and password need a separator that cannot appear in either');
  });

  it('is dropped whenever a password changes or an account goes away', () => {
    const clears = SRC.match(/clearCaldavAuthCache\(\);/g) || [];
    assert.ok(clears.length >= 3, 'expected the two password paths and the delete path, found ' + clears.length);
    for (const call of ['db.deleteUser(database, userId);', 'db.revokeUserCredentials(database, user.id);']) {
      const at = SRC.indexOf(call);
      assert.ok(at >= 0, call + ' has moved');
      assert.match(SRC.slice(at, at + 200), /clearCaldavAuthCache\(\)/, 'no cache clear after ' + call);
    }
  });
});
