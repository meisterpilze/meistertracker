'use strict';
// How often the Billbee stock push may be in the air, and what happens when
// nobody is watching it fail.
//
// Two properties the harvest feed has had from the start and this road did not.
//
// **One push at a time.** Billbee is called through a single queue that spaces
// calls 550 ms apart, and a 429 retry re-enters that queue at the back. With two
// runs overlapping, the older run's chunk can therefore land *after* the newer
// one's and republish the figure somebody has just corrected downwards — which is
// the dangerous direction, and the reason the release hooks exist at all.
//
// **A heartbeat.** The hooks fire once. If Billbee is unreachable for the half
// minute in which a release is lowered, the warning goes to the log and every
// shop Billbee feeds keeps offering the old figure until a human next edits a
// release — days later, or never.
//
// server.js starts a listener on require, so the function under test is lifted
// out of the source and run against stubs. That is one step past the
// read-the-source assertions elsewhere in this suite, and it buys the thing those
// cannot have: the shipped code actually executes here.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

/** The text of one top-level function, by brace matching from its signature. */
function extract(name) {
  const at = SRC.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name + ' is still called that in server.js');
  let depth = 0;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(at, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

/** Run the real pushBillbeeStockNow against a stubbed push and log. */
function sandbox(push, { worktree = false } = {}) {
  const body = `
    const WORKTREE_MODE = ${worktree};
    let _billbeeStockInFlight = false;
    let _billbeeStockPending = null;
    const log = () => {};
    ${extract('pushBillbeeStockNow')}
    return pushBillbeeStockNow;
  `;
  return new Function('pushBillbeeStock', body)(push);
}

/** Let the .catch().finally() chain settle. */
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
};

describe('Billbee stock push: one at a time', () => {
  function deferredPush() {
    const calls = [];
    let release = null;
    const push = (why) => {
      calls.push(why);
      return new Promise((resolve) => (release = resolve));
    };
    return { push, calls, finish: () => release && release({}) };
  }

  it('folds every push that arrives mid-run into one follow-up', async () => {
    const { push, calls, finish } = deferredPush();
    const now = sandbox(push);
    now('release set');
    now('release lowered');
    now('release removed');
    assert.deepEqual(calls, ['release set'], 'the second and third must not overtake the first');
    finish();
    await settle();
    // One follow-up, not two: it reads the levels fresh when it starts, so the
    // last state is what goes out either way.
    assert.equal(calls.length, 2);
    assert.equal(calls[1], 'release removed');
  });

  it('starts nothing more once the queue has drained', async () => {
    const { push, calls, finish } = deferredPush();
    const now = sandbox(push);
    now('a');
    now('b');
    finish();
    await settle();
    finish();
    await settle();
    assert.equal(calls.length, 2, 'two runs, then quiet');
  });

  it('does not wedge when a push fails', async () => {
    const calls = [];
    const now = sandbox((why) => {
      calls.push(why);
      return Promise.reject(new Error('Billbee down'));
    });
    now('first');
    await settle();
    now('second');
    await settle();
    // A rejected push must clear the flag. Leaving it set would silence every
    // later release change for the lifetime of the server.
    assert.deepEqual(calls, ['first', 'second']);
  });

  it('sends nothing at all from a worktree copy', async () => {
    const calls = [];
    const now = sandbox(
      (why) => {
        calls.push(why);
        return Promise.resolve({});
      },
      { worktree: true }
    );
    now('release set');
    await settle();
    assert.deepEqual(calls, [], 'a stale copy of the database must not write to the live account');
  });
});

describe('Billbee stock push: the heartbeat', () => {
  it('has a timer, and the timer goes through the same guard', () => {
    const starter = extract('startBillbeeStockTimer');
    assert.match(starter, /setInterval\(/, 'a failed push is otherwise never retried');
    assert.match(
      starter,
      /pushBillbeeStockNow\('timer'\)/,
      'through the guard, so a tick cannot overlap a release push'
    );
    assert.match(starter, /WORKTREE_MODE/, 'and not from a worktree copy');
    assert.match(starter, /unref/, 'a heartbeat must not hold the process open');
  });

  it('ticks often enough to heal a missed push the same day', () => {
    const m = SRC.match(/const BILLBEE_STOCK_INTERVAL_MS = ([^;]+);/);
    assert.ok(m, 'the interval is a named constant');
    const ms = new Function('return ' + m[1])();
    assert.ok(ms >= 60_000, 'not a hot loop against a 2-calls-per-second API');
    assert.ok(ms <= 60 * 60_000, 'stale stock in every connected shop is the thing this exists to end');
  });

  it('is started, not merely defined', () => {
    assert.match(SRC, /\nstartBillbeeStockTimer\(\);/, 'a starter nobody calls heals nothing');
  });
});
