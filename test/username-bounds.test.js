'use strict';
// Where an unvalidated username ends up.
//
// /api/auth/setup and POST /api/users both pinned the username to
// ^[A-Za-z0-9._-]{1,64}$. The login handler enforced nothing:
//
//     const { username, password } = data;
//     if (!username || !password) { ... }
//     const userKey = username.toLowerCase();
//     const throttleKey = userKey + '@' + clientIP;
//
// userKey and throttleKey become keys in loginAttempts and
// loginAttemptsPerUser, and jsonBody accepts a 5 MB body. The sweep runs every
// 60 seconds but only evicts entries older than LOGIN_LOCKOUT_MS, so a failed
// login with a multi-megabyte username is *retained* for fifteen minutes. A
// single source cycling unique giant usernames parks memory at a rate the
// lockout cannot touch, because it never reaches the attempt threshold that
// would lock anything.
//
// createUser is the only writer of the users table — restore does not carry
// users — so a name failing this regex cannot belong to an account, and
// rejecting it at the door locks nobody out. The CalDAV path builds the same
// throttle keys out of the Basic auth header; bounded by maxHeaderSize there,
// but the same shape, so it gets the same check.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const USERNAME_RE = new RegExp(SRC.match(/const USERNAME_RE = \/(.+?)\/;/)[1]);

describe('USERNAME_RE', () => {
  it('accepts the names accounts are actually created with', () => {
    for (const u of ['admin', 'anna.mueller', 'anna_mueller', 'anna-mueller', 'a', 'A1', 'x'.repeat(64)]) {
      assert.equal(USERNAME_RE.test(u), true, u + ' should be accepted');
    }
  });

  it('rejects the oversized one this is about', () => {
    assert.equal(USERNAME_RE.test('x'.repeat(65)), false);
    assert.equal(USERNAME_RE.test('x'.repeat(5 * 1024 * 1024)), false);
  });

  it('rejects empty, whitespace and the usual injection shapes', () => {
    for (const u of ['', ' ', 'a b', 'a@b', 'a/b', 'a:b', '../etc', 'a\nb', '__proto__!', 'ü']) {
      assert.equal(USERNAME_RE.test(u), false, JSON.stringify(u) + ' should be rejected');
    }
  });

  it('is anchored at both ends', () => {
    assert.equal(USERNAME_RE.test('good\nbad'), false, 'an unanchored regex would pass this');
    assert.equal(USERNAME_RE.test('x'.repeat(64) + '!'), false);
  });

  it('does not take exponential time on a long non-match', () => {
    // The regex has no nested quantifier, but a length cap is only a real cap
    // if testing the oversized input is itself cheap.
    const t0 = process.hrtime.bigint();
    USERNAME_RE.test('a'.repeat(1e6) + '!');
    assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 200);
  });
});

describe('the login handler checks before it builds a throttle key', () => {
  const handler = (() => {
    const at = SRC.indexOf("url === '/api/auth/login'");
    assert.ok(at > 0, 'the login route has moved');
    return SRC.slice(at, SRC.indexOf("url === '/api/auth/logout'", at));
  })();

  it('validates the username at all', () => {
    assert.match(handler, /USERNAME_RE\.test\(username\)/);
  });

  it('does so before userKey and throttleKey exist', () => {
    assert.ok(
      handler.indexOf('USERNAME_RE.test(username)') < handler.indexOf('const userKey'),
      'the check has to run before the string can become a Map key'
    );
  });

  it('answers exactly as a wrong password does', () => {
    const rejection = handler.slice(handler.indexOf('USERNAME_RE.test(username)'), handler.indexOf('const userKey'));
    assert.match(rejection, /401/);
    assert.match(rejection, /Invalid credentials/);
  });

  it('records nothing against the throttle maps on that path', () => {
    const start = handler.indexOf('USERNAME_RE.test(username)');
    const end = handler.indexOf('const userKey');
    assert.equal(/recordLoginFailure/.test(handler.slice(start, end)), false);
  });
});

describe('the CalDAV path bounds the same keys', () => {
  it('extractBasicAuthUsername returns null for a name no account can have', () => {
    const fn = new Function(
      'USERNAME_RE',
      SRC.match(/function extractBasicAuthUsername\(req\) \{[\s\S]*?\n\}/)[0] + '\nreturn extractBasicAuthUsername;'
    )(USERNAME_RE);
    const basic = (s) => ({ headers: { authorization: 'Basic ' + Buffer.from(s).toString('base64') } });

    assert.equal(fn(basic('anna.mueller:pw')), 'anna.mueller');
    assert.equal(fn(basic('x'.repeat(500) + ':pw')), null);
    assert.equal(fn(basic('a b:pw')), null);
    assert.equal(fn(basic('nocolon')), null);
    assert.equal(fn({ headers: {} }), null);
    assert.equal(fn({ headers: { authorization: 'Bearer xyz' } }), null);
  });

  it('checkCaldavAuth skips the lookup for an impossible name', () => {
    const fn = SRC.match(/function checkCaldavAuth\(req\) \{[\s\S]*?\n\}/)[0];
    assert.match(fn, /USERNAME_RE\.test\(user\)/);
    assert.ok(
      fn.indexOf('USERNAME_RE.test(user)') < fn.indexOf('caldavAuthCacheKey(user, pass)'),
      'no cache entry should be built for a name that cannot be an account'
    );
  });
});

describe('the creation sites use the same constant', () => {
  it('no route carries its own copy of the regex any more', () => {
    assert.equal(
      /\/\^\[A-Za-z0-9\._-\]\{1,64\}\$\/\.test/.test(SRC),
      false,
      'an inline duplicate will drift away from USERNAME_RE'
    );
    assert.ok((SRC.match(/USERNAME_RE\.test/g) || []).length >= 5);
  });
});
