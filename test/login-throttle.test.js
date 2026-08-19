'use strict';
// Brute-force protection that cannot be turned around on the user.
//
// There were two tiers. Per source (username@IP): five failures, hard lock for
// fifteen minutes. Per account, across every source: twenty failures, hard lock
// for fifteen minutes. The first tier is fine — an attacker can only ever aim a
// per-source lock at their own address.
//
// The second tier is protection and a weapon at once. Twenty wrong guesses
// against a username somebody knows — "admin" is a good guess — keep that
// account out for fifteen minutes, and repeating it costs four requests a
// minute spread over as many addresses as the attacker cares to use. The
// locked-out admin has no self-service way back in; the account is simply gone
// for as long as somebody keeps typing.
//
// It is an escalating wait now. Spraying one account still collapses — each
// failure past the threshold doubles the delay to a five-second ceiling — but
// whoever knows the password always gets in, and one correct login clears the
// counter. The wait itself is bounded: pending delays are counted, and past the
// cap the answer is an immediate 429 that clears when the flood stops, rather
// than a lock that outlives it by a quarter of an hour.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// server.js listens on require, so the throttle block is lifted whole — from
// the first constant to the last helper — and given a log of its own.
function loadThrottle() {
  const start = SRC.indexOf('const LOGIN_MAX_ATTEMPTS');
  const endMarker = 'function clearLoginAttemptsPerUser(username) {\n  loginAttemptsPerUser.delete(username);\n}';
  const end = SRC.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, 'the login throttle block has moved');
  const block = SRC.slice(start, end + endMarker.length);
  const logs = [];
  const api = new Function(
    'log',
    block +
      '\nreturn { loginDelayForUser, afterLoginDelay, recordLoginFailure, recordLoginFailurePerUser,' +
      ' checkLoginAllowed, clearLoginAttempts, clearLoginAttemptsPerUser, loginAttemptsPerUser,' +
      ' LOGIN_DELAY_AFTER, LOGIN_DELAY_MAX_MS, LOGIN_DELAY_STEP_MS, LOGIN_DELAY_MAX_PENDING,' +
      ' LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS };'
  )((...a) => logs.push(a));
  return { ...api, logs };
}

describe('the per-account tier is a wait, not a lock', () => {
  let t;
  beforeEach(() => {
    t = loadThrottle();
  });

  const failTimes = (n, who = 'admin') => {
    for (let i = 0; i < n; i++) t.recordLoginFailurePerUser(who);
  };

  it('costs nothing until the threshold', () => {
    for (let i = 0; i < t.LOGIN_DELAY_AFTER; i++) {
      assert.equal(t.loginDelayForUser('admin'), 0, 'failure ' + i + ' should still be free');
      t.recordLoginFailurePerUser('admin');
    }
    assert.equal(t.loginDelayForUser('admin'), 0, 'the threshold itself is still free');
  });

  it('doubles past it', () => {
    failTimes(t.LOGIN_DELAY_AFTER + 1);
    assert.equal(t.loginDelayForUser('admin'), t.LOGIN_DELAY_STEP_MS);
    t.recordLoginFailurePerUser('admin');
    assert.equal(t.loginDelayForUser('admin'), t.LOGIN_DELAY_STEP_MS * 2);
    t.recordLoginFailurePerUser('admin');
    assert.equal(t.loginDelayForUser('admin'), t.LOGIN_DELAY_STEP_MS * 4);
  });

  it('stops doubling at the ceiling, and never becomes a lock', () => {
    failTimes(500);
    assert.equal(t.loginDelayForUser('admin'), t.LOGIN_DELAY_MAX_MS);
    // The property that matters: whatever an attacker does, the answer is a
    // finite wait. There is no state in which the account cannot be reached.
    assert.ok(Number.isFinite(t.loginDelayForUser('admin')));
    assert.ok(t.loginDelayForUser('admin') <= 5000);
  });

  it('one correct login clears it', () => {
    failTimes(100);
    assert.ok(t.loginDelayForUser('admin') > 0);
    t.clearLoginAttemptsPerUser('admin');
    assert.equal(t.loginDelayForUser('admin'), 0);
  });

  it('penalises only the account it was aimed at', () => {
    failTimes(100, 'admin');
    assert.ok(t.loginDelayForUser('admin') > 0);
    assert.equal(t.loginDelayForUser('anna.mueller'), 0);
  });

  it('forgets a stale run of failures', () => {
    failTimes(100);
    const entry = t.loginAttemptsPerUser.get('admin');
    entry.firstAttempt = Date.now() - t.LOGIN_LOCKOUT_MS - 1000;
    assert.equal(t.loginDelayForUser('admin'), 0);
    assert.equal(t.loginAttemptsPerUser.has('admin'), false, 'the entry should be dropped, not just ignored');
  });

  it('says something once, when the wait starts', () => {
    failTimes(50);
    const warnings = t.logs.filter((l) => l[0] === 'warn');
    assert.equal(warnings.length, 1, 'one line per spray, not one per attempt');
    assert.match(warnings[0][1], /Repeated failed logins/);
  });

  it('carries no lockedUntil any more', () => {
    failTimes(100);
    assert.equal('lockedUntil' in t.loginAttemptsPerUser.get('admin'), false);
  });
});

describe('the per-source tier keeps its hard lock', () => {
  // An attacker cannot aim this at anyone else: the key contains their own IP.
  it('locks after the threshold and refuses until it expires', () => {
    const t = loadThrottle();
    const key = 'admin@203.0.113.9';
    assert.equal(t.checkLoginAllowed(key), true);
    for (let i = 0; i < t.LOGIN_MAX_ATTEMPTS; i++) t.recordLoginFailure(key);
    assert.equal(t.checkLoginAllowed(key), false);
    t.clearLoginAttempts(key);
    assert.equal(t.checkLoginAllowed(key), true);
  });
});

describe('afterLoginDelay', () => {
  it('runs straight through when nothing is owed', () => {
    const t = loadThrottle();
    let ran = false;
    assert.equal(
      t.afterLoginDelay('admin', () => {
        ran = true;
      }),
      true
    );
    assert.equal(ran, true, 'an unthrottled login must not be deferred at all');
  });

  it('defers when something is owed, and still runs', async () => {
    const t = loadThrottle();
    for (let i = 0; i < t.LOGIN_DELAY_AFTER + 1; i++) t.recordLoginFailurePerUser('admin');
    let ran = false;
    const started = Date.now();
    const accepted = t.afterLoginDelay('admin', () => {
      ran = true;
    });
    assert.equal(accepted, true);
    assert.equal(ran, false, 'it should not have run yet');
    await new Promise((r) => setTimeout(r, t.LOGIN_DELAY_STEP_MS + 120));
    assert.equal(ran, true);
    assert.ok(Date.now() - started >= t.LOGIN_DELAY_STEP_MS);
  });

  it('refuses past the pending cap instead of pinning sockets open', () => {
    const t = loadThrottle();
    // One step past the threshold, so the timers this leaves behind are 250 ms
    // rather than the five-second ceiling — the cap is a count, not a duration.
    for (let i = 0; i < t.LOGIN_DELAY_AFTER + 1; i++) t.recordLoginFailurePerUser('admin');
    let accepted = 0;
    for (let i = 0; i < t.LOGIN_DELAY_MAX_PENDING + 10; i++) {
      if (t.afterLoginDelay('admin', () => {})) accepted++;
    }
    assert.equal(accepted, t.LOGIN_DELAY_MAX_PENDING);
    // And the refusal is transient: once the waits drain, it accepts again.
    assert.equal(
      t.afterLoginDelay('anna', () => {}),
      true,
      'an unthrottled account is never refused'
    );
  });
});

describe('both entry points go through it', () => {
  it('the hard per-account lock is gone from the source', () => {
    assert.equal(/checkLoginAllowedPerUser/.test(SRC), false, 'the per-account lock is back');
    assert.equal(/LOGIN_MAX_PER_USER/.test(SRC), false);
  });

  it('the login route waits, then verifies', () => {
    const at = SRC.indexOf("url === '/api/auth/login'");
    const route = SRC.slice(at, SRC.indexOf("url === '/api/auth/logout'", at));
    assert.match(route, /afterLoginDelay\(userKey,/);
    assert.match(route, /checkLoginAllowed\(throttleKey\)/, 'the per-source lock must stay');
    assert.ok(route.indexOf('afterLoginDelay') < route.indexOf('finishLogin'), 'the wait comes before the check');
    assert.match(route, /429/);
  });

  it('the CalDAV path uses the same counters', () => {
    const at = SRC.indexOf("req.url.startsWith('/caldav')");
    const block = SRC.slice(at, at + 800);
    assert.match(block, /afterLoginDelay\(caldavUser\.toLowerCase\(\)/);
    assert.match(block, /429/);
  });
});
