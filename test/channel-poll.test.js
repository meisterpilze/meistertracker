'use strict';
// When a sales channel's orders actually arrive.
//
// Until this timer existed, a channel was pulled only when somebody opened
// Settings and pressed "Jetzt synchronisieren". The production planning
// therefore knew about an order when a human remembered to ask — and the one
// channel the lab was given for exactly this purpose, Billbee, was the one
// nobody would think to press a button for on a Sunday.
//
// server.js opens a listener on require, so the two functions are lifted out of
// the source and run against stubs. The shipped code executes here.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

/** The text of one top-level function, by brace matching from its signature. */
function extract(name) {
  const at = SRC.search(new RegExp('(async )?function ' + name + '\\('));
  assert.notEqual(at, -1, name + ' is still called that in server.js');
  let depth = 0;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(at, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

/** Run the real pollSalesChannels against stubbed channels and a stubbed sync. */
function sandbox(channels, syncChannelOrders, { worktree = false } = {}) {
  const body = `
    const WORKTREE_MODE = ${worktree};
    let _channelPollBusy = false;
    const log = () => {};
    const database = {};
    const db = { listChannelConfigs: () => channels };
    ${extract('pollSalesChannels')}
    return pollSalesChannels;
  `;
  return new Function('channels', 'syncChannelOrders', body)(channels, syncChannelOrders);
}

/**
 * The real syncChannelOrders against stubs, for the one path that returns before
 * any network call. `calls.token` counts the reach for a provider: the whole
 * point of the guard is that it never happens.
 */
function syncSandbox(channels, prev = {}) {
  const calls = { token: 0, state: [] };
  const dbStub = {
    listChannelConfigs: () => channels,
    getChannelConfig: () => ({ lastSync: null, lastCursor: null, lastError: null, ...prev }),
    setChannelSyncState: (_d, channel, s) => calls.state.push({ channel, ...s }),
    upsertOrder: () => 1
  };
  const body = `
    const log = () => {};
    const database = { exec() {} };
    const broadcastSSE = () => {};
    const withFreshChannelToken = async () => { calls.token++; throw new Error('reached the provider'); };
    ${extract('syncChannelOrders')}
    return syncChannelOrders;
  `;
  return { sync: new Function('db', 'calls', body)(dbStub, calls), calls };
}

describe('the sales-channel poll', () => {
  const on = (channel) => ({ channel, enabled: true, connected: true });

  it('fetches every channel that is switched on and connected', async () => {
    const seen = [];
    const poll = sandbox(
      [on('billbee'), { channel: 'wix', enabled: false, connected: true }, on('etsy')],
      async (c) => {
        seen.push(c);
        return { imported: 1, error: null };
      }
    );
    await poll();
    assert.deepEqual(seen, ['billbee', 'etsy'], 'a switched-off channel is not asked');
  });

  it('leaves a configured-but-unconnected channel alone', async () => {
    const seen = [];
    const poll = sandbox([{ channel: 'ebay', enabled: true, connected: false }], async (c) => {
      seen.push(c);
      return { imported: 0, error: null };
    });
    await poll();
    // Calling it would only produce a 401 every quarter of an hour and stamp
    // lastError over whatever the real reason was that it is not connected.
    assert.deepEqual(seen, []);
  });

  it('runs them one after another, not all at once', async () => {
    let running = 0;
    let peak = 0;
    const poll = sandbox([on('billbee'), on('etsy'), on('ebay')], async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setImmediate(r));
      running--;
      return { imported: 0, error: null };
    });
    await poll();
    // They share one outbound connection, and Billbee's throttle is per account:
    // two at once buys nothing and earns a 429.
    assert.equal(peak, 1);
  });

  it('keeps going when one channel fails', async () => {
    const seen = [];
    const poll = sandbox([on('billbee'), on('etsy')], async (c) => {
      seen.push(c);
      return c === 'billbee' ? { imported: 0, error: 'Billbee HTTP 502' } : { imported: 3, error: null };
    });
    await poll();
    assert.deepEqual(seen, ['billbee', 'etsy'], 'one dead channel must not silence the others');
  });

  it('does not start a second round while one is still running', async () => {
    let starts = 0;
    let release = null;
    const poll = sandbox([on('billbee')], async () => {
      starts++;
      await new Promise((r) => (release = r));
      return { imported: 0, error: null };
    });
    const first = poll();
    await new Promise((r) => setImmediate(r));
    await poll();
    assert.equal(starts, 1, 'a slow sync must not have a second one piling up behind it');
    release();
    await first;
  });

  it('leaves the channels Billbee stands in for alone', async () => {
    const seen = [];
    const poll = sandbox(
      [on('billbee'), { ...on('wix'), supersededBy: 'billbee' }, { ...on('etsy'), supersededBy: 'billbee' }],
      async (c) => {
        seen.push(c);
        return { imported: 1, error: null };
      }
    );
    await poll();
    // Otherwise every quarter of an hour the same sale arrives twice: once from
    // Billbee under its own id, once from the shop under the marketplace's.
    assert.deepEqual(seen, ['billbee'], 'the hub pulls, the shops it covers do not');
  });

  it('starts no timer in a worktree copy — the button still works there', () => {
    // The pull only reads from the channel and writes into its own database, so a
    // developer pressing "Jetzt synchronisieren" in a second copy harms nobody.
    // What must not happen is a second copy quietly polling the same account on a
    // timer for ever, competing with the real server for a throttle measured in
    // two calls a second.
    const run = (worktree) =>
      new Function(
        'setIntervalStub',
        `
        const WORKTREE_MODE = ${worktree};
        const CHANNEL_POLL_MS = 900000;
        const setInterval = setIntervalStub;
        const pollSalesChannels = async () => {};
        const log = () => {};
        let _channelPollTimer = null;
        ${extract('startChannelPoll')}
        return startChannelPoll();
      `
      )(() => ({ unref() {} }));
    assert.equal(run(true), false, 'no timer in a worktree');
    assert.equal(run(false), true, 'a timer on the real server');
  });

  it('is wired to a timer that is started and does not hold the process open', () => {
    const starter = extract('startChannelPoll');
    assert.match(starter, /setInterval\(/);
    assert.match(starter, /pollSalesChannels\(\)/);
    assert.match(starter, /unref/);
    assert.match(SRC, /\nstartChannelPoll\(\);/, 'a starter nobody calls fetches nothing');
    const m = SRC.match(/const CHANNEL_POLL_MS = ([^;]+);/);
    assert.ok(m, 'the interval is a named constant');
    const ms = new Function('return ' + m[1])();
    assert.ok(ms >= 60_000 && ms <= 60 * 60_000, 'often enough to be useful, rare enough to be polite');
  });
});

// The poll skipping them is convenience; this is the actual lock. Both the timer
// and the "Jetzt synchronisieren" button go through syncChannelOrders, so a
// button that could still import the doubles the timer avoids would be a hole in
// the shape of a person having a bad day.
describe('a superseded channel does not sync', () => {
  const on = (channel, extra) => ({ channel, enabled: true, connected: true, supersededBy: null, ...extra });

  it('refuses before it reaches the provider', async () => {
    const { sync, calls } = syncSandbox([on('billbee'), on('wix', { supersededBy: 'billbee' })]);
    const r = await sync('wix');
    assert.equal(calls.token, 0, 'no credential is even fetched, let alone a request sent');
    assert.equal(r.imported, 0);
    assert.equal(r.supersededBy, 'billbee');
    assert.match(r.error, /Billbee/);
  });

  it('says why on the channel, without overwriting when it last really synced', async () => {
    const { sync, calls } = syncSandbox([on('billbee'), on('etsy', { supersededBy: 'billbee' })], {
      lastSync: '2026-08-01T09:00:00Z',
      lastCursor: 'page-3'
    });
    await sync('etsy');
    assert.equal(calls.state.length, 1);
    const [s] = calls.state;
    assert.equal(s.channel, 'etsy');
    assert.match(s.lastError, /Billbee/);
    // setChannelSyncState writes null for anything left undefined, so the two it
    // does not mean to touch have to be handed back explicitly. Stamping
    // "zuletzt: jetzt" on a sync that never ran would be a lie the operator
    // reads as proof the channel is fine.
    assert.equal(s.lastSync, '2026-08-01T09:00:00Z');
    assert.equal(s.lastCursor, 'page-3');
  });

  it('lets an unsuperseded channel through to the provider', async () => {
    const { sync, calls } = syncSandbox([on('billbee'), on('wix')]);
    const r = await sync('wix');
    assert.equal(calls.token, 1, 'the guard must not stop a channel Billbee is not carrying');
    assert.equal(r.supersededBy, undefined);
    assert.match(r.error, /reached the provider/);
  });

  it('never stands the hub itself down', async () => {
    const { sync, calls } = syncSandbox([on('billbee'), on('wix', { supersededBy: 'billbee' })]);
    await sync('billbee');
    assert.equal(calls.token, 1);
  });
});
