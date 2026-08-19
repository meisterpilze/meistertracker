'use strict';
// A calendar subscription should not be a copy of the account password.
//
// CalDAV authenticates with HTTP Basic against the app's own accounts, so
// subscribing a phone meant typing the password that also opens the web UI —
// as an admin, if that is the account — into iOS or Thunderbird. The client
// keeps it: in a keychain, in a cloud backup, on a device that may outlive its
// owner's employment. One credential carrying every capability, and no way to
// take it back that does not change the password for everything else too.
//
// App passwords are the containment. Each one opens calendars and nothing else,
// is bound to the account that made it, and is revocable on its own.
//
// Two design points worth pinning:
//
//   - The value is hashed with a plain SHA-256, not scrypt. It is 25 characters
//     of CSPRNG output, so there is nothing to guess and a KDF would add only
//     cost — and CalDAV re-authenticates on *every* request, which is the whole
//     reason the account-password path needed a cache.
//
//   - A password change deletes them. They are deliberately independent day to
//     day, but a password change is the answer to "this account may be
//     compromised", and somebody who had the account could have minted one.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

describe('minting and using an app password', () => {
  let d, p, anna, bob;

  before(() => {
    p = path.join(os.tmpdir(), 'mt_apppw_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    const mk = (name) => {
      db.createUser(d, name, 'a reasonable password for ' + name, 'user');
      return db.getUserByUsername(d, name).id;
    };
    anna = mk('anna');
    bob = mk('bob');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });
  beforeEach(() => {
    d.prepare('DELETE FROM caldav_app_passwords').run();
  });

  it('produces something a person can type off a screen', () => {
    const { password } = db.createCaldavAppPassword(d, anna, 'iPhone');
    // Five groups of five, from an alphabet with no 0/O and no 1/I/l.
    assert.match(password, /^[A-Z2-9]{5}(-[A-Z2-9]{5}){4}$/);
    assert.equal(/[01OIL]/.test(password.replace(/-/g, '')), false, 'ambiguous characters are a typing trap');
  });

  it('is long enough that guessing is not a strategy', () => {
    // Read out of db.js rather than assumed: the choice to hash these with a
    // plain SHA-256 rather than scrypt rests entirely on this number.
    const DB = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
    const alphabet = DB.match(/const CALDAV_PW_ALPHABET = '([^']+)'/)[1];
    const groups = Number(DB.match(/const CALDAV_PW_GROUPS = (\d+)/)[1]);
    const len = Number(DB.match(/const CALDAV_PW_GROUP_LEN = (\d+)/)[1]);
    assert.equal(new Set(alphabet).size, alphabet.length, 'a repeated symbol would skew the distribution');
    const bits = groups * len * Math.log2(alphabet.length);
    assert.ok(bits > 100, 'only ' + Math.round(bits) + ' bits of entropy');
  });

  it('never stores the value it handed out', () => {
    const { password } = db.createCaldavAppPassword(d, anna, 'iPhone');
    const row = d.prepare('SELECT hash FROM caldav_app_passwords').get();
    assert.notEqual(row.hash, password);
    assert.equal(row.hash, crypto.createHash('sha256').update(password.replace(/-/g, '')).digest('hex'));
    assert.equal(JSON.stringify(db.listCaldavAppPasswords(d, anna)).includes('hash'), false);
    assert.equal(JSON.stringify(db.listCaldavAppPasswords(d, anna)).includes(password), false);
  });

  it('is a fresh value every time', () => {
    const a = db.createCaldavAppPassword(d, anna, 'iPhone').password;
    const b = db.createCaldavAppPassword(d, anna, 'iPad').password;
    assert.notEqual(a, b);
  });

  it('is found however the person retyped it', () => {
    const { password, id } = db.createCaldavAppPassword(d, anna, 'iPhone');
    for (const variant of [password, password.replace(/-/g, ''), password.toLowerCase(), ' ' + password + ' ']) {
      const found = db.findCaldavAppPassword(d, variant);
      assert.ok(found, JSON.stringify(variant) + ' was not recognised');
      assert.equal(found.id, id);
      assert.equal(found.userId, anna);
    }
  });

  it('is not found when it is wrong', () => {
    db.createCaldavAppPassword(d, anna, 'iPhone');
    for (const wrong of ['AAAAA-BBBBB-CCCCC-DDDDD-EEEEE', '', null, undefined, 'short', 'x'.repeat(200)]) {
      assert.equal(db.findCaldavAppPassword(d, wrong), null, JSON.stringify(wrong) + ' was accepted');
    }
  });

  it('does not stamp last-used on a lookup — only a successful auth does', () => {
    // S-17 again: an audit column that records attempts tells the admin the
    // opposite of what they are looking for.
    const { password, id } = db.createCaldavAppPassword(d, anna, 'iPhone');
    db.findCaldavAppPassword(d, password);
    assert.equal(db.listCaldavAppPasswords(d, anna)[0].lastUsedAt, null);
    db.touchCaldavAppPassword(d, id);
    assert.ok(db.listCaldavAppPasswords(d, anna)[0].lastUsedAt);
  });

  it('lists only your own', () => {
    db.createCaldavAppPassword(d, anna, 'iPhone');
    db.createCaldavAppPassword(d, bob, 'Thunderbird');
    assert.deepEqual(
      db.listCaldavAppPasswords(d, anna).map((i) => i.label),
      ['iPhone']
    );
  });

  it('revokes one device without touching the others', () => {
    const phone = db.createCaldavAppPassword(d, anna, 'iPhone');
    const pad = db.createCaldavAppPassword(d, anna, 'iPad');
    assert.equal(db.deleteCaldavAppPassword(d, anna, phone.id), true);
    assert.equal(db.findCaldavAppPassword(d, phone.password), null);
    assert.ok(db.findCaldavAppPassword(d, pad.password), 'the other device should still work');
  });

  it("will not let one user revoke another user's device", () => {
    const bobs = db.createCaldavAppPassword(d, bob, 'Thunderbird');
    assert.equal(db.deleteCaldavAppPassword(d, anna, bobs.id), false);
    assert.ok(db.findCaldavAppPassword(d, bobs.password), 'it should still work');
  });

  it('insists on a device name, and a sane one', () => {
    assert.throws(() => db.createCaldavAppPassword(d, anna, ''), /name for the device/);
    assert.throws(() => db.createCaldavAppPassword(d, anna, '   '), /name for the device/);
    assert.throws(() => db.createCaldavAppPassword(d, anna, 'x'.repeat(61)), /too long/);
    assert.throws(() => db.createCaldavAppPassword(d, null, 'iPhone'), /userId required/);
    // Trimmed, so the list does not show ragged labels.
    assert.equal(db.createCaldavAppPassword(d, anna, '  iPhone  ').label, 'iPhone');
  });

  it('caps how many one account can hold', () => {
    for (let i = 0; i < 20; i++) db.createCaldavAppPassword(d, anna, 'device ' + i);
    assert.throws(() => db.createCaldavAppPassword(d, anna, 'one too many'), /too many app passwords/);
    // Per account, not globally.
    assert.ok(db.createCaldavAppPassword(d, bob, 'Thunderbird'));
  });

  it('surfaces its errors to the user rather than as a 500', () => {
    for (const msg of [
      'caldav: a name for the device is required',
      'caldav: too many app passwords (revoke one first)'
    ]) {
      assert.equal(db.isSafeError(msg), true, msg + ' would come back as "Internal server error"');
    }
  });
});

describe('a password change takes them with it', () => {
  it('revokeUserCredentials clears the app passwords too', () => {
    const p = path.join(os.tmpdir(), 'mt_apppw2_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    const d = db.openDb(p);
    try {
      db.createUser(d, 'anna', 'a reasonable password', 'user');
      db.createUser(d, 'bob', 'another reasonable password', 'user');
      const anna = db.getUserByUsername(d, 'anna').id;
      const bob = db.getUserByUsername(d, 'bob').id;
      const hers = db.createCaldavAppPassword(d, anna, 'iPhone');
      const his = db.createCaldavAppPassword(d, bob, 'Thunderbird');

      db.revokeUserCredentials(d, anna);

      assert.equal(db.findCaldavAppPassword(d, hers.password), null, 'an attacker could have minted this one');
      assert.ok(db.findCaldavAppPassword(d, his.password), 'and nobody else is affected');
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });

  it('deleting the account takes them as well', () => {
    const p = path.join(os.tmpdir(), 'mt_apppw3_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    const d = db.openDb(p);
    try {
      db.createUser(d, 'anna', 'a reasonable password', 'user');
      const anna = db.getUserByUsername(d, 'anna').id;
      const hers = db.createCaldavAppPassword(d, anna, 'iPhone');
      db.deleteUser(d, anna);
      assert.equal(db.findCaldavAppPassword(d, hers.password), null);
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });
});

describe('checkCaldavAuth', () => {
  const fn = SRC.match(/function checkCaldavAuth\(req\) \{[\s\S]*?\n\}/)[0];

  it('tries the app password before the account password', () => {
    // Not just for speed: the account path costs a full scrypt, which is why it
    // needed a cache in the first place.
    assert.match(fn, /db\.findCaldavAppPassword\(database, pass\)/);
    assert.ok(
      fn.indexOf('findCaldavAppPassword') < fn.indexOf('db.verifyPassword'),
      'the cheap check has to come first'
    );
  });

  it('requires the presented username to be the owner', () => {
    // Otherwise an app password would authenticate as whoever typed it, and the
    // CalDAV path derives the calendar from the username.
    assert.match(fn, /owner && owner\.id === appPw\.userId/);
  });

  it('records the use only after accepting it', () => {
    const touch = fn.indexOf('db.touchCaldavAppPassword');
    assert.ok(touch > fn.indexOf('owner.id === appPw.userId'), 'the stamp belongs inside the accepted branch');
  });

  it('needs no cache entry for that path', () => {
    const appBlock = fn.slice(fn.indexOf('findCaldavAppPassword'), fn.indexOf('const cacheKey'));
    assert.equal(/caldavAuthCache\.set/.test(appBlock), false, 'a SHA-256 lookup does not need caching');
  });

  it('still accepts the account password', () => {
    // Removing it would strand every existing subscription on deploy.
    assert.match(fn, /db\.verifyPassword\(account\.hash, account\.salt, pass\)/);
  });
});

describe('the routes', () => {
  const block = SRC.slice(
    SRC.indexOf('// ── CalDAV app-specific passwords'),
    SRC.indexOf("req.url === '/api/caldav/config'")
  );

  it('scope every operation to the caller', () => {
    assert.ok(block.length > 200, 'the app-password routes have moved');
    for (const m of block.matchAll(/db\.(list|create|delete)CaldavAppPassword[s]?\(database, ([^,)]+)/g)) {
      assert.equal(m[2].trim(), 'req.authUser.user_id', m[1] + ' is not scoped to the caller');
    }
  });

  it('drop the auth cache when one is revoked', () => {
    const del = block.slice(block.indexOf('caldavPwMatch && req.method'));
    assert.match(del, /clearCaldavAuthCache\(\)/, 'a revoked device could keep syncing for the cache TTL');
  });

  it("answer 404 rather than 403 for somebody else's id", () => {
    // deleteCaldavAppPassword is already scoped, so a foreign id simply is not
    // there — and saying "not found" tells the caller nothing about it.
    assert.match(block, /if \(!gone\) \{\s*\n\s*jsonErr\(res, 404, 'not found'\);/);
  });

  it('return the plaintext from the create route and nowhere else', () => {
    assert.equal((SRC.match(/created\.label/g) || []).length, 1);
    assert.equal(/password:/.test(block), false, 'the value comes straight from db.createCaldavAppPassword');
  });
});
