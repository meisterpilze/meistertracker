'use strict';
// What an anonymous caller may make the login page compute.
//
// finishLogin runs a full scrypt whether or not the account exists — it has to,
// or the response time answers "does this user exist". S-14 then raised the
// cost to N=2^17, which is right for a stolen database and expensive here:
// ~276 ms of *synchronous* work on the only thread the server has.
//
// Both throttle tiers that existed keyed on a string the caller chooses —
// loginAttempts on username@IP, loginAttemptsPerUser on the username. A fresh
// username per request lands in a fresh bucket every time, so neither counter
// ever reached its threshold and every request bought a full hash. At the
// 300-requests-a-minute ceiling that is 82 s of CPU demanded of every 60 s, and
// the queue behind it never drains: the scanners, CalDAV, and the harvest
// feed's own setInterval all stop, which is how a login page ends up stopping
// the shop from being told what is in stock.
//
// The obvious repair — delay the source instead of locking it — does not hold,
// and the arithmetic for why is asserted below rather than argued in prose: a
// delay that still ends in a hash only queues the work. So the two guards here
// both refuse rather than defer, and the test is written against the numbers,
// so it fails if someone later tunes them into something that no longer bounds
// anything.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// Measured on the S-14 parameters (db.js SCRYPT_PARAMS). Used as an order of
// magnitude, not a promise about any particular machine.
const HASH_SEKUNDEN = 0.276;

function loadThrottle() {
  const start = SRC.indexOf('const LOGIN_MAX_ATTEMPTS');
  const endMarker = 'function clearLoginAttemptsPerUser(username) {\n  loginAttemptsPerUser.delete(username);\n}';
  const end = SRC.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, 'the login throttle block has moved');
  const logs = [];
  const api = new Function(
    'log',
    SRC.slice(start, end + endMarker.length) +
      '\nreturn { checkLoginSourceAllowed, recordLoginFailurePerSource, clearLoginAttemptsPerSource,' +
      ' takeLoginKdfToken, refundLoginKdfToken, LOGIN_SOURCE_MAX_FAILURES, LOGIN_KDF_BURST,' +
      ' LOGIN_KDF_REFILL_MS, LOGIN_DELAY_MAX_PENDING, LOGIN_DELAY_MAX_MS, LOGIN_LOCKOUT_MS };'
  )((...a) => logs.push(a));
  return { ...api, logs };
}

let t;
beforeEach(() => {
  t = loadThrottle();
});

describe('a source cannot rename its way past the counter', () => {
  it('lets an honest run of typos through', () => {
    for (let i = 0; i < t.LOGIN_SOURCE_MAX_FAILURES - 1; i++) {
      assert.ok(t.checkLoginSourceAllowed('203.0.113.9'), 'typo ' + i + ' must still be answered');
      t.recordLoginFailurePerSource('203.0.113.9');
    }
    assert.ok(t.checkLoginSourceAllowed('203.0.113.9'), 'the threshold itself is still free');
  });

  it('refuses the address once it is past the threshold, whatever name it types', () => {
    for (let i = 0; i < t.LOGIN_SOURCE_MAX_FAILURES; i++) t.recordLoginFailurePerSource('198.51.100.4');
    assert.equal(t.checkLoginSourceAllowed('198.51.100.4'), false);
    // The point of the tier: the username is not part of the key, so there is
    // nothing left for the caller to vary.
    assert.ok(t.checkLoginSourceAllowed('198.51.100.5'), 'a different address is unaffected');
  });

  it('says so once in the log, not once per attempt', () => {
    for (let i = 0; i < t.LOGIN_SOURCE_MAX_FAILURES + 5; i++) t.recordLoginFailurePerSource('198.51.100.7');
    assert.equal(t.logs.filter((l) => /one address/.test(l[1])).length, 1);
  });

  it('forgets the address once the window has passed', () => {
    for (let i = 0; i < t.LOGIN_SOURCE_MAX_FAILURES; i++) t.recordLoginFailurePerSource('198.51.100.8');
    assert.equal(t.checkLoginSourceAllowed('198.51.100.8'), false);
    t.clearLoginAttemptsPerSource('198.51.100.8');
    assert.ok(t.checkLoginSourceAllowed('198.51.100.8'), 'a correct password clears it');
  });

  it('bounds one address to a few seconds of hashing per window', () => {
    const proFenster = t.LOGIN_SOURCE_MAX_FAILURES * HASH_SEKUNDEN;
    const fensterSek = t.LOGIN_LOCKOUT_MS / 1000;
    assert.ok(
      proFenster / fensterSek < 0.02,
      'one address may hold ' + (proFenster / fensterSek).toFixed(3) + ' of a thread — too much'
    );
  });
});

describe('the budget in front of the KDF', () => {
  it('allows a burst, then refuses instead of queueing', () => {
    const jetzt = Date.now();
    for (let i = 0; i < t.LOGIN_KDF_BURST; i++) {
      assert.ok(t.takeLoginKdfToken(jetzt), 'burst token ' + i);
    }
    assert.equal(t.takeLoginKdfToken(jetzt), false, 'past the burst there is no token, so no hash');
  });

  it('refills at its stated rate and no faster', () => {
    // Offsets from the real clock: the bucket stamps itself with Date.now() at
    // load, and an invented small number is *behind* that, which reads as a
    // negative refill rather than as the fast-forward it was meant to be.
    const jetzt = Date.now() + 60_000;
    for (let i = 0; i < t.LOGIN_KDF_BURST; i++) t.takeLoginKdfToken(jetzt);
    assert.equal(t.takeLoginKdfToken(jetzt + t.LOGIN_KDF_REFILL_MS - 1), false, 'not a millisecond early');
    assert.ok(t.takeLoginKdfToken(jetzt + t.LOGIN_KDF_REFILL_MS), 'one token per interval');
    assert.equal(t.takeLoginKdfToken(jetzt + t.LOGIN_KDF_REFILL_MS), false, 'and only one');
  });

  it('never refills past the burst, so an idle hour is not a stored-up flood', () => {
    const jetzt = Date.now() + 120_000;
    t.takeLoginKdfToken(jetzt);
    for (let i = 0; i < t.LOGIN_KDF_BURST; i++) {
      assert.ok(t.takeLoginKdfToken(jetzt + 3_600_000), 'token ' + i + ' after an idle hour');
    }
    assert.equal(t.takeLoginKdfToken(jetzt + 3_600_000), false, 'the ceiling is the burst, not the wait');
  });

  it('gives the token back for a correct password, so honest logins cost nothing', () => {
    const jetzt = Date.now() + 180_000;
    for (let i = 0; i < t.LOGIN_KDF_BURST; i++) t.takeLoginKdfToken(jetzt);
    assert.equal(t.takeLoginKdfToken(jetzt), false);
    t.refundLoginKdfToken(); // what finishLogin does when the password was right
    assert.ok(t.takeLoginKdfToken(jetzt), 'a successful login leaves the budget where it was');
  });

  it('holds the sustained cost of a distributed flood under a third of the thread', () => {
    const proSekunde = 1000 / t.LOGIN_KDF_REFILL_MS;
    const anteil = proSekunde * HASH_SEKUNDEN;
    assert.ok(anteil < 0.34, 'a flood may hold ' + anteil.toFixed(2) + ' of the thread — too much');
  });
});

describe('why a per-source wait would not have been enough', () => {
  it('shows that deferring the hash still overloads the thread', () => {
    // The shape that was proposed first: delay the source, then hash anyway.
    // The pending delays release together once the ceiling is reached.
    const stau = t.LOGIN_DELAY_MAX_PENDING * HASH_SEKUNDEN;
    const fenster = t.LOGIN_DELAY_MAX_MS / 1000;
    assert.ok(
      stau / fenster > 1,
      'if this ever drops below 1 the comment in server.js about queueing is stale and should be rewritten'
    );
  });
});

describe('the login route asks before it hashes', () => {
  const route = SRC.slice(
    SRC.indexOf("if (url === '/api/auth/login'"),
    SRC.indexOf("if (url === '/api/auth/login'") + 6000
  );

  it('refuses the address before finishLogin is ever scheduled', () => {
    assert.ok(
      route.indexOf('checkLoginSourceAllowed') < route.indexOf('afterLoginDelay'),
      'the source check must sit in front of the hash, not behind it'
    );
  });

  it('takes a budget token before scheduling and hands it back when nothing was hashed', () => {
    assert.ok(route.indexOf('takeLoginKdfToken') < route.indexOf('afterLoginDelay'));
    assert.match(route, /if \(!accepted\) \{[\s\S]{0,200}refundLoginKdfToken\(\)/);
  });

  it('caps the password before it can become the work', () => {
    assert.ok(route.indexOf('PASSWORD_MAX_LENGTH') < route.indexOf('takeLoginKdfToken'));
  });

  it('applies that same cap where a password is chosen', () => {
    // A cap only the login knows about locks out whoever set a longer one.
    assert.equal((SRC.match(/PASSWORD_MAX_LENGTH/g) || []).length >= 6, true, 'set and checked in both places');
  });
});
