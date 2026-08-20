'use strict';
// What an unauthenticated caller may make this process compute.
//
// finishLogin runs a full scrypt whether or not the account exists — it has to,
// or the response time answers "does this user exist" — and S-14 raised that to
// N=2^17: ~276 ms of synchronous work on the only thread the server has. Both
// older tiers key on a string the caller chooses (loginAttempts on username@IP,
// loginAttemptsPerUser on the username), so a fresh username per request landed
// in a fresh bucket and every request bought a hash. At the 300-a-minute ceiling
// that is 82 s of CPU demanded of every 60 s of wall clock, from one address,
// with no account — and the scanners, CalDAV and the harvest feed's own timer
// stop behind it.
//
// This file pins the shape of the answer, because two earlier shapes were wrong
// in ways that only arithmetic or a second reader caught:
//
//   A delay does not work. A wait that still ends in a hash only queues the
//   work — 64 pending delays releasing 17 s of hashing every 5 s is the same
//   overload with extra steps. Asserted below rather than argued.
//
//   A hard lock does not work. It repeats S-19's mistake one level down: an
//   address is shared by an office NAT, a mobile carrier, and the documented
//   Path B nginx, where every request arrives from one address. And it could
//   not be cleared, because the refusal ran before the success path.
//
//   One global pot does not work. It turns a CPU exhaustion into a login
//   outage: a flood that keeps the shared bucket empty costs the attacker
//   nothing and locks out everyone arriving without a session.
//
// What is left is a rate per address, refilling on its own, refunded on success.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// Measured against the S-14 parameters (db.js SCRYPT_PARAMS) — an order of
// magnitude, not a promise about any particular machine.
const HASH_SEKUNDEN = 0.276;

let kehrbesen = null;

function laden() {
  const start = SRC.indexOf('const LOGIN_MAX_ATTEMPTS');
  const endMarker = 'function clearLoginAttemptsPerUser(username) {\n  loginAttemptsPerUser.delete(username);\n}';
  const end = SRC.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, 'the login throttle block has moved');
  const logs = [];
  const api = new Function(
    'log',
    'setInterval',
    SRC.slice(start, end + endMarker.length) +
      '\nreturn { takeLoginKdfToken, refundLoginKdfToken, loginKdfTokens, LOGIN_KDF_BURST,' +
      ' LOGIN_KDF_REFILL_MS, LOGIN_KDF_MAX_QUELLEN, LOGIN_DELAY_MAX_PENDING, LOGIN_DELAY_MAX_MS };'
  )(
    (...a) => logs.push(a),
    // The sweeper is wired with .unref() in the real process; the lifted copy
    // must not leave a live timer behind in the test runner — and the callback
    // is kept so it can be run on demand rather than waited for.
    (fn) => {
      kehrbesen = fn;
      return { unref: () => {} };
    }
  );
  return { ...api, logs };
}

let t;
beforeEach(() => {
  t = laden();
});

describe('the budget belongs to one address', () => {
  it('allows a burst, then refuses — and a refusal hashes nothing', () => {
    const jetzt = Date.now();
    for (let i = 0; i < t.LOGIN_KDF_BURST; i++) {
      assert.ok(t.takeLoginKdfToken('203.0.113.9', jetzt), 'burst token ' + i);
    }
    assert.equal(t.takeLoginKdfToken('203.0.113.9', jetzt), false);
  });

  it('cannot be spent on somebody else — which is the whole property', () => {
    // This is what a single global pot got wrong: a flood that empties it locks
    // out everyone arriving without a session, and costs the attacker nothing.
    const jetzt = Date.now();
    for (let i = 0; i < t.LOGIN_KDF_BURST * 3; i++) t.takeLoginKdfToken('198.51.100.4', jetzt);
    assert.equal(t.takeLoginKdfToken('198.51.100.4', jetzt), false, 'the flooder is out');
    assert.ok(t.takeLoginKdfToken('203.0.113.9', jetzt), 'the colleague still gets in');
  });

  it('refills on its own, so the worst case is a wait and not a lockout', () => {
    // The version before this one was a fifteen-minute hard lock that could not
    // be cleared: the refusal ran before the success path, so "one correct
    // login clears it" was unreachable once tripped.
    const jetzt = Date.now();
    for (let i = 0; i < t.LOGIN_KDF_BURST; i++) t.takeLoginKdfToken('203.0.113.9', jetzt);
    assert.equal(t.takeLoginKdfToken('203.0.113.9', jetzt + t.LOGIN_KDF_REFILL_MS - 1), false);
    assert.ok(t.takeLoginKdfToken('203.0.113.9', jetzt + t.LOGIN_KDF_REFILL_MS), 'one per interval');
    assert.equal(t.takeLoginKdfToken('203.0.113.9', jetzt + t.LOGIN_KDF_REFILL_MS), false, 'and only one');
  });

  it('never refills past the burst, so an idle hour is not a stored-up flood', () => {
    const jetzt = Date.now();
    t.takeLoginKdfToken('203.0.113.9', jetzt);
    for (let i = 0; i < t.LOGIN_KDF_BURST; i++) {
      assert.ok(t.takeLoginKdfToken('203.0.113.9', jetzt + 3_600_000), 'token ' + i);
    }
    assert.equal(t.takeLoginKdfToken('203.0.113.9', jetzt + 3_600_000), false);
  });

  it('gives the token back for a correct password, so honest use costs nothing', () => {
    const jetzt = Date.now();
    for (let i = 0; i < t.LOGIN_KDF_BURST; i++) t.takeLoginKdfToken('203.0.113.9', jetzt);
    assert.equal(t.takeLoginKdfToken('203.0.113.9', jetzt), false);
    t.refundLoginKdfToken('203.0.113.9', jetzt);
    assert.ok(t.takeLoginKdfToken('203.0.113.9', jetzt));
  });

  it('does not let a refund on a fresh address mint extra hashes', () => {
    const jetzt = Date.now();
    for (let i = 0; i < 10; i++) t.refundLoginKdfToken('neu.example', jetzt);
    let n = 0;
    while (t.takeLoginKdfToken('neu.example', jetzt)) n++;
    assert.equal(n, t.LOGIN_KDF_BURST, 'the ceiling is the burst, whatever was refunded');
  });

  it('bounds one address to a small share of the thread', () => {
    const proSekunde = 1000 / t.LOGIN_KDF_REFILL_MS;
    const anteil = proSekunde * HASH_SEKUNDEN;
    assert.ok(anteil < 0.1, 'one address may hold ' + anteil.toFixed(3) + ' of the thread — too much');
  });

  it('actually forgets an address that stopped asking', () => {
    // ⚠️ The first version read e.tokens straight out of the entry, and that
    // number is only brought up to date by a call. An address that spent one
    // token and never came back therefore sat at burst-1 for ever and was never
    // swept — so this cleaned nothing at all, and the map only shrank through
    // the LRU eviction that exists as a backstop. Green, silent, and useless.
    const jetzt = Date.now();
    for (let i = 0; i < 50; i++) t.takeLoginKdfToken('alt-' + i, jetzt - 3_600_000);
    assert.equal(t.loginKdfTokens.size, 50);
    assert.ok(typeof kehrbesen === 'function', 'the sweeper is not registered any more');
    kehrbesen();
    assert.equal(t.loginKdfTokens.size, 0, 'an hour-old address must be gone');
  });

  it('keeps an address that is still spending', () => {
    const jetzt = Date.now();
    // Drained just now: it has an empty budget and must not be forgotten, or
    // forgetting would hand it a fresh one.
    for (let i = 0; i < t.LOGIN_KDF_BURST; i++) t.takeLoginKdfToken('aktiv', jetzt);
    kehrbesen();
    assert.equal(t.loginKdfTokens.has('aktiv'), true, 'a drained address must survive the sweep');
    assert.equal(t.takeLoginKdfToken('aktiv', jetzt), false, 'and keep its empty budget');
  });

  it('keeps the table of addresses bounded', () => {
    // Otherwise this is a memory leak with a rate limiter in front of it.
    const jetzt = Date.now();
    for (let i = 0; i < t.LOGIN_KDF_MAX_QUELLEN + 500; i++) t.takeLoginKdfToken('addr-' + i, jetzt);
    assert.ok(t.loginKdfTokens.size <= t.LOGIN_KDF_MAX_QUELLEN, 'size ' + t.loginKdfTokens.size);
  });
});

describe('why a delay would not have been enough', () => {
  it('shows that deferring the hash still overloads the thread', () => {
    const stau = t.LOGIN_DELAY_MAX_PENDING * HASH_SEKUNDEN;
    const fenster = t.LOGIN_DELAY_MAX_MS / 1000;
    assert.ok(stau / fenster > 1, 'if this drops below 1 the reasoning in server.js is stale');
  });
});

describe('both doors to the same KDF', () => {
  it('the login route asks before it hashes, and hands the token back if it did not', () => {
    const route = SRC.slice(
      SRC.indexOf("if (url === '/api/auth/login'"),
      SRC.indexOf("if (url === '/api/auth/logout'")
    );
    const nimm = route.indexOf('takeLoginKdfToken(clientIP)');
    const warte = route.indexOf('afterLoginDelay');
    assert.ok(nimm >= 0 && warte >= 0, 'the route has moved');
    assert.ok(nimm < warte, 'the budget is asked before the hash is scheduled');
    assert.match(route, /if \(!accepted\) \{[\s\S]{0,200}refundLoginKdfToken\(clientIP\)/);
  });

  it('the CalDAV route does too — it reaches the same KDF, twice per request', () => {
    // checkCaldavAuth runs db.verifyPassword inside a loop over two decodings,
    // so a request there costs two hashes. Guarding only /api/auth/login left
    // the more expensive door open, and CalDAV is on by default (migration v10).
    const i = SRC.indexOf('const caldavUser = checkCaldavAuth(req);');
    assert.ok(i > 0, 'the CalDAV auth call has moved');
    const davor = SRC.slice(i - 1200, i);
    assert.match(davor, /takeLoginKdfToken\(caldavIP\)/, 'the budget is not asked before the CalDAV hash');
    assert.match(SRC.slice(i, i + 1200), /refundLoginKdfToken\(caldavIP\)/, 'a correct CalDAV login must cost nothing');
  });

  it('caps the password before it can become the work, at login and at every setter', () => {
    const route = SRC.slice(
      SRC.indexOf("if (url === '/api/auth/login'"),
      SRC.indexOf("if (url === '/api/auth/logout'")
    );
    assert.ok(route.indexOf('PASSWORD_MAX_LENGTH') < route.indexOf('takeLoginKdfToken(clientIP)'));
    // A cap only the login knows about locks out whoever set a longer one.
    assert.ok((SRC.match(/PASSWORD_MAX_LENGTH/g) || []).length >= 6, 'set and checked in both places');
  });
});

describe('the address a limit is keyed on', () => {
  it('is not one the caller can prepend to', () => {
    // nginx's $proxy_add_x_forwarded_for APPENDS the real peer to whatever the
    // client sent, so X-Forwarded-For[0] is attacker-supplied — this file says
    // so itself, in the reason setupFromLoopback gives for not using
    // getClientIP. Every throttle here keys on that value.
    const fn = SRC.match(/function getClientIP\(req\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'getClientIP has moved');
    assert.equal(/x-forwarded-for/.test(fn[0]), false, 'X-Forwarded-For must not be read here');
    assert.match(fn[0], /x-real-ip/, 'X-Real-IP is single-valued and set by the proxy');
  });

  it('says so in the key when a proxy sent no X-Real-IP, instead of silently sharing one', () => {
    const fn = SRC.match(/function getClientIP\(req\) \{[\s\S]*?\n\}/);
    assert.match(fn[0], /proxy-ohne-real-ip/);
  });
});
