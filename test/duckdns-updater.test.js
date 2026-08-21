'use strict';
// The updater had no tests at all, which is how it kept four separate faults
// at once. Each block below pins one of them, and the names say which.
//
// Nothing here touches the network: every test injects `httpGet` and `resolveA`,
// so a run in CI with no route to duckdns.org behaves exactly like a run at a
// desk with one.

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const duckdns = require('../duckdns.js');

const ROOT = path.join(__dirname, '..');
const quiet = () => {};

/** A config row shaped like the one db.getDuckdnsCfg hands out. */
function cfgRow(over) {
  return Object.assign(
    { enabled: true, domain: 'example-host', token: 'a0b1c2d3-0000-0000-0000-000000000000', lastIp: null },
    over
  );
}

/** A dbApi stand-in that records what the updater wrote. */
function fakeDb(over) {
  const writes = [];
  return {
    writes,
    getDuckdnsCfg: () => cfgRow(over),
    updateDuckdnsStatus: (_d, fields) => writes.push(fields)
  };
}

/** Poll until `fn()` is truthy, so no test depends on a fixed sleep. */
async function waitFor(fn, ms = 2000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('parseUpdate — DuckDNS said OK, or it did not', () => {
  it('reads the documented four-line reply', () => {
    const r = duckdns.parseUpdate('OK\n203.0.113.7\n\nUPDATED\n');
    assert.equal(r.ok, true);
    assert.equal(r.ip, '203.0.113.7');
    assert.equal(r.changed, true);
  });

  it('tells NOCHANGE from UPDATED', () => {
    assert.equal(duckdns.parseUpdate('OK\n203.0.113.7\n\nNOCHANGE').changed, false);
  });

  it('survives CRLF — the old check compared the raw line against OK', () => {
    const r = duckdns.parseUpdate('OK\r\n203.0.113.7\r\n\r\nUPDATED\r\n');
    assert.equal(r.ok, true, 'a carriage return must not read as a refused token');
    assert.equal(r.ip, '203.0.113.7');
  });

  it('treats KO as a failure and keeps the reason', () => {
    const r = duckdns.parseUpdate('KO');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'KO');
    assert.equal(r.ip, null);
  });

  it('treats an empty body as a failure rather than a silent success', () => {
    assert.equal(duckdns.parseUpdate('').ok, false);
    assert.equal(duckdns.parseUpdate('').reason, 'empty response');
    assert.equal(duckdns.parseUpdate(null).ok, false);
  });

  it('truncates an error page instead of carrying it into a log line', () => {
    const r = duckdns.parseUpdate('<html>' + 'x'.repeat(5000));
    assert.equal(r.ok, false);
    assert.ok(r.reason.length <= 80);
  });

  it('reports no address when the reply had none', () => {
    assert.equal(duckdns.parseUpdate('OK\n\n\nNOCHANGE').ip, null);
  });
});

describe('nextDelay — a failure must cost less than a full cycle', () => {
  it('uses the healthy cadence when nothing has failed', () => {
    assert.equal(duckdns.nextDelay(0), duckdns.OK_INTERVAL_MS);
    assert.equal(duckdns.nextDelay(undefined), duckdns.OK_INTERVAL_MS);
  });

  it('retries the first failure long before the next scheduled tick', () => {
    // This is the whole fault: the tick after the line comes back is the one
    // most likely to fail, and it used to buy another five minutes of silence.
    assert.ok(duckdns.nextDelay(1) < duckdns.OK_INTERVAL_MS);
    assert.equal(duckdns.nextDelay(1), duckdns.RETRY_BASE_MS);
  });

  it('doubles, then stops at the healthy cadence', () => {
    assert.equal(duckdns.nextDelay(2), duckdns.RETRY_BASE_MS * 2);
    assert.equal(duckdns.nextDelay(3), duckdns.RETRY_BASE_MS * 4);
    assert.equal(duckdns.nextDelay(99), duckdns.RETRY_MAX_MS);
  });

  it('never backs off slower than a working updater checks in', () => {
    for (let i = 0; i < 40; i++) assert.ok(duckdns.nextDelay(i) <= duckdns.OK_INTERVAL_MS);
  });
});

describe('staleness — the state the green banner used to hide', () => {
  const now = Date.parse('2026-08-21T12:00:00.000Z');

  it('counts a recent success as fresh', () => {
    const r = duckdns.staleness('2026-08-21T11:58:00.000Z', now);
    assert.equal(r.stale, false);
    assert.equal(r.ageMs, 2 * 60 * 1000);
  });

  it('counts a long silence as stale', () => {
    assert.equal(duckdns.staleness('2026-08-21T09:00:00.000Z', now).stale, true);
  });

  it('counts never having succeeded as stale, not as unknown', () => {
    assert.equal(duckdns.staleness(null, now).stale, true);
    assert.equal(duckdns.staleness(null, now).ageMs, null);
    assert.equal(duckdns.staleness('not a date', now).stale, true);
  });

  it('does not report a negative age when the clock moved backwards', () => {
    assert.equal(duckdns.staleness('2026-08-21T12:05:00.000Z', now).ageMs, 0);
  });
});

describe('local address signature — the DHCP change nothing was watching', () => {
  const ifaces = (list) => ({ en0: list });

  it('ignores loopback and IPv6', () => {
    const sig = duckdns.localIpv4Signature({
      lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      en0: [
        { family: 'IPv6', address: 'fe80::1', internal: false },
        { family: 'IPv4', address: '192.168.1.20', internal: false }
      ]
    });
    assert.equal(sig, '192.168.1.20');
  });

  it('does not change when the interface order does', () => {
    const a = duckdns.localIpv4Signature(
      ifaces([
        { family: 'IPv4', address: '10.0.0.2', internal: false },
        { family: 'IPv4', address: '10.0.0.9', internal: false }
      ])
    );
    const b = duckdns.localIpv4Signature(
      ifaces([
        { family: 'IPv4', address: '10.0.0.9', internal: false },
        { family: 'IPv4', address: '10.0.0.2', internal: false }
      ])
    );
    assert.equal(a, b);
  });

  it('changes when the lease does', () => {
    const a = duckdns.localIpv4Signature(ifaces([{ family: 'IPv4', address: '10.0.0.2', internal: false }]));
    const b = duckdns.localIpv4Signature(ifaces([{ family: 'IPv4', address: '10.0.0.3', internal: false }]));
    assert.notEqual(a, b);
  });
});

describe('zoneOf — which nameservers are the right ones to ask', () => {
  it('strips the host label, so a duckdns name asks the duckdns servers', () => {
    assert.equal(duckdns.zoneOf('example-host.duckdns.org'), 'duckdns.org');
  });

  it('does not stop at two labels', () => {
    // Taking the last two would have asked one.one about one.one.one.one —
    // a real zone, real nameservers, and no authority over the name being
    // looked up. Its "no such name" then reads as "the record is gone", which
    // is the one answer that must never be guessed: it sends a correction, then
    // another, and ends in a conflict that was never there.
    assert.equal(duckdns.zoneOf('one.one.one.one'), 'one.one.one');
  });

  it('leaves a bare zone alone', () => {
    assert.equal(duckdns.zoneOf('duckdns.org'), 'duckdns.org');
    assert.equal(duckdns.zoneOf(''), '');
  });
});

describe('clockJumped — a timer that slept through the address change', () => {
  it('ignores ordinary lateness on a busy machine', () => {
    assert.equal(duckdns.clockJumped(duckdns.HEARTBEAT_MS, duckdns.HEARTBEAT_MS + 2000), false);
  });

  it('spots a suspend', () => {
    assert.equal(duckdns.clockJumped(duckdns.HEARTBEAT_MS, 8 * 60 * 60 * 1000), true);
  });
});

describe('the URLs we send', () => {
  const domain = 'example-host';
  const token = 'a0b1c2d3-0000-0000-0000-000000000000';

  it('never sends an ip parameter — DuckDNS must detect the public side itself', () => {
    assert.ok(!/[?&]ip=/.test(duckdns.updateUrl(domain, token)));
  });

  it('escapes what it interpolates', () => {
    assert.ok(duckdns.updateUrl('a b', token).includes('domains=a%20b'));
  });

  it('clearing the TXT record does not send clear=true', async () => {
    // The regression this guards is the reason the whole file exists. DuckDNS
    // documents clear=true as clearing "both your records" on the address
    // update and as clearing the value on a TXT update — same endpoint, and the
    // combination the old code sent is documented nowhere. It ran from the
    // final callback of the certificate routine, which fires after a *failed*
    // renewal too and retries every twelve hours, so a wiped address record
    // would come back round on its own.
    const seen = [];
    await duckdns.clearTxt(
      { domain, token },
      { httpGet: (u) => (seen.push(u), Promise.resolve({ status: 200, body: 'OK\n\n\nUPDATED' })) }
    );
    assert.equal(seen.length, 1);
    assert.ok(!seen[0].includes('clear=true'), 'clear=true must never ride along with a TXT wipe');
    assert.ok(seen[0].includes('&txt=&'), 'an empty txt value is what empties the record');
  });

  it('clearing never rejects — cleanup must not fail a finished cert run', async () => {
    const ok = await duckdns.clearTxt({ domain, token }, { httpGet: () => Promise.reject(new Error('offline')) });
    assert.equal(ok, false);
  });

  it('setting the TXT record carries the challenge value and throws on refusal', async () => {
    const seen = [];
    await duckdns.setTxt(
      { domain, token, value: 'abc123' },
      { httpGet: (u) => (seen.push(u), Promise.resolve({ status: 200, body: 'OK\n\n\nUPDATED' })) }
    );
    assert.ok(seen[0].includes('txt=abc123'));
    await assert.rejects(
      () =>
        duckdns.setTxt({ domain, token, value: 'x' }, { httpGet: () => Promise.resolve({ status: 200, body: 'KO' }) }),
      /TXT update failed: KO/
    );
  });
});

describe('updateIp', () => {
  it('does not parse the body of a non-2xx reply as a DuckDNS answer', async () => {
    // An error page from the load balancer in front of duckdns.org is not a
    // refused token, and saying so is the difference between an admin checking
    // their token and an admin checking their line.
    const r = await duckdns.updateIp(cfgRow(), {
      httpGet: () => Promise.resolve({ status: 502, body: '<html>OK</html>' })
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'HTTP 502');
  });

  it('passes a good reply through', async () => {
    const r = await duckdns.updateIp(cfgRow(), {
      httpGet: () => Promise.resolve({ status: 200, body: 'OK\n203.0.113.7\n\nUPDATED' })
    });
    assert.deepEqual([r.ok, r.ip, r.changed], [true, '203.0.113.7', true]);
  });
});

describe('the loop', () => {
  afterEach(() => duckdns.stop());

  it('stays out of the way in a worktree', () => {
    const started = duckdns.start({ database: {}, dbApi: fakeDb(), log: quiet, skip: true });
    assert.equal(started, false);
    assert.equal(duckdns.status(null).running, false);
  });

  it('records a failure instead of swallowing it, and stays armed', async () => {
    duckdns.start({
      database: {},
      dbApi: fakeDb(),
      log: quiet,
      deps: { httpGet: () => Promise.reject(new Error('ENETUNREACH')) }
    });
    await waitFor(() => duckdns.status(null).failures > 0);
    const s = duckdns.status(null);
    assert.equal(s.lastError, 'ENETUNREACH');
    assert.equal(s.running, true, 'a failed attempt must not end the loop');
  });

  it('writes the address it got back', async () => {
    const dbApi = fakeDb();
    duckdns.start({
      database: {},
      dbApi,
      log: quiet,
      deps: {
        httpGet: () => Promise.resolve({ status: 200, body: 'OK\n203.0.113.7\n\nNOCHANGE' }),
        resolveA: () => Promise.resolve(['203.0.113.7'])
      }
    });
    await waitFor(() => dbApi.writes.length > 0);
    assert.equal(dbApi.writes[0].lastIp, '203.0.113.7');
  });

  it('does nothing at all while DuckDNS is switched off', async () => {
    let calls = 0;
    duckdns.start({
      database: {},
      dbApi: fakeDb({ enabled: false }),
      log: quiet,
      deps: { httpGet: () => (calls++, Promise.resolve({ status: 200, body: 'OK\n1.2.3.4\n\nNOCHANGE' })) }
    });
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(calls, 0);
    // Still armed, though — the old version decided once at boot and a config
    // that became valid later stayed dormant until somebody restarted.
    assert.equal(duckdns.status(null).running, true);
  });

  it('confirms a matching record against the nameservers', async () => {
    duckdns.start({
      database: {},
      dbApi: fakeDb(),
      log: quiet,
      deps: {
        httpGet: () => Promise.resolve({ status: 200, body: 'OK\n203.0.113.7\n\nUPDATED' }),
        resolveA: () => Promise.resolve(['203.0.113.7'])
      }
    });
    await waitFor(() => duckdns.status(null).verifyOk === true);
    assert.equal(duckdns.status(null).observedIp, '203.0.113.7');
  });

  it('notices a record that serves somebody else and corrects it', async () => {
    let calls = 0;
    duckdns.start({
      database: {},
      dbApi: fakeDb(),
      log: quiet,
      deps: {
        httpGet: () => (calls++, Promise.resolve({ status: 200, body: 'OK\n203.0.113.7\n\nUPDATED' })),
        resolveA: () => Promise.resolve(['198.51.100.4'])
      }
    });
    await waitFor(() => duckdns.status(null).verifyOk === false);
    assert.equal(duckdns.status(null).observedIp, '198.51.100.4');
    // The correction has to actually reach the timer. It used to be scheduled
    // and then cancelled one line later by the healthy cadence.
    await waitFor(() => calls >= 2);
  });

  it('notices a record that serves nothing at all', async () => {
    duckdns.start({
      database: {},
      dbApi: fakeDb(),
      log: quiet,
      deps: {
        httpGet: () => Promise.resolve({ status: 200, body: 'OK\n203.0.113.7\n\nUPDATED' }),
        resolveA: () => Promise.resolve([])
      }
    });
    await waitFor(() => duckdns.status(null).verifyOk === false);
    assert.equal(duckdns.status(null).observedIp, null);
  });

  it('stops correcting once it is clear something else owns the name', async () => {
    // Two updaters on one token is not a race more updates will win. Say it
    // once and stop, or this becomes a request every few milliseconds forever.
    let calls = 0;
    duckdns.start({
      database: {},
      dbApi: fakeDb(),
      log: quiet,
      deps: {
        httpGet: () => (calls++, Promise.resolve({ status: 200, body: 'OK\n203.0.113.7\n\nUPDATED' })),
        resolveA: () => Promise.resolve(['198.51.100.4'])
      }
    });
    await waitFor(() => duckdns.status(null).conflict === true);
    const settled = calls;
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(calls - settled <= 1, 'a conflict must not turn into an update storm');
  });

  it('does not let a failed verification lookup count as a failed update', async () => {
    duckdns.start({
      database: {},
      dbApi: fakeDb(),
      log: quiet,
      deps: {
        httpGet: () => Promise.resolve({ status: 200, body: 'OK\n203.0.113.7\n\nUPDATED' }),
        resolveA: () => Promise.reject(new Error('SERVFAIL'))
      }
    });
    await waitFor(() => duckdns.status(null).lastAttempt !== null);
    await new Promise((r) => setTimeout(r, 40));
    const s = duckdns.status(null);
    assert.equal(s.failures, 0, 'our resolver failing says nothing about the record');
    assert.equal(s.verifyOk, null);
  });

  it('keeps the address update when writing our own note about it fails', async () => {
    const dbApi = fakeDb();
    dbApi.updateDuckdnsStatus = () => {
      throw new Error('SQLITE_BUSY');
    };
    duckdns.start({
      database: {},
      dbApi,
      log: quiet,
      deps: {
        httpGet: () => Promise.resolve({ status: 200, body: 'OK\n203.0.113.7\n\nNOCHANGE' }),
        resolveA: () => Promise.resolve(['203.0.113.7'])
      }
    });
    await waitFor(() => duckdns.status(null).lastAttempt !== null);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(duckdns.status(null).failures, 0);
  });

  it('survives a config read that throws', async () => {
    const dbApi = fakeDb();
    dbApi.getDuckdnsCfg = () => {
      throw new Error('locked');
    };
    duckdns.start({ database: {}, dbApi, log: quiet, deps: { httpGet: () => Promise.reject(new Error('unused')) } });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(duckdns.status(null).running, true);
  });

  it('stop() disarms it', async () => {
    duckdns.start({
      database: {},
      dbApi: fakeDb(),
      log: quiet,
      deps: { httpGet: () => Promise.resolve({ status: 200, body: 'OK\n1.2.3.4\n\nNOCHANGE' }) }
    });
    duckdns.stop();
    assert.equal(duckdns.status(null).running, false);
  });
});

describe('updateNow — the admin button and the post-certificate re-assert', () => {
  afterEach(() => duckdns.stop());

  it('refuses in a worktree rather than fighting production for the record', async () => {
    const r = await duckdns.updateNow({ database: {}, dbApi: fakeDb(), log: quiet, skip: true });
    assert.deepEqual(r, { ok: false, reason: 'worktree mode' });
  });

  it('says so when DuckDNS is not configured', async () => {
    const r = await duckdns.updateNow({ database: {}, dbApi: fakeDb({ token: '' }), log: quiet });
    assert.equal(r.reason, 'not configured');
  });

  it('reports the refusal reason rather than a generic failure', async () => {
    const r = await duckdns.updateNow({
      database: {},
      dbApi: fakeDb(),
      log: quiet,
      deps: { httpGet: () => Promise.resolve({ status: 200, body: 'KO' }) }
    });
    assert.deepEqual(r, { ok: false, reason: 'KO' });
  });

  it('writes the address through on success', async () => {
    const dbApi = fakeDb();
    const r = await duckdns.updateNow({
      database: {},
      dbApi,
      log: quiet,
      deps: { httpGet: () => Promise.resolve({ status: 200, body: 'OK\n203.0.113.7\n\nUPDATED' }) }
    });
    assert.equal(r.ok, true);
    assert.equal(dbApi.writes[0].lastIp, '203.0.113.7');
  });
});

describe('server wiring', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  it('has no second copy of the updater left behind in server.js', () => {
    for (const gone of [
      'function updateDuckdnsIP',
      'duckdnsInterval',
      'function setDuckdnsTxt',
      'function clearDuckdnsTxt'
    ]) {
      assert.ok(!server.includes(gone), gone + ' should live in duckdns.js now');
    }
  });

  it('never sends clear=true from any code path in the tree', () => {
    // Belt and braces: the parameter is a footgun wherever it appears, not just
    // in the function that used to send it. Comments are exempt — the two
    // files that still say the words are the ones explaining why not to.
    const code = (src) =>
      src
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join('\n');
    for (const f of ['server.js', 'duckdns.js']) {
      assert.ok(!code(fs.readFileSync(path.join(ROOT, f), 'utf8')).includes('clear=true'), f);
    }
  });

  it('builds no URL that carries clear=true, whatever the caller asks for', () => {
    const d = 'example-host';
    const tok = 'a0b1c2d3-0000-0000-0000-000000000000';
    for (const url of [
      duckdns.updateUrl(d, tok),
      duckdns.updateUrl(d, tok, '&txt=abc'),
      duckdns.updateUrl(d, tok, '&txt=')
    ]) {
      assert.ok(!url.includes('clear'), url);
    }
  });

  it('re-asserts the address after a certificate run clears the challenge', () => {
    const i = server.indexOf('.clearTxt(');
    assert.ok(i > 0, 'the cert routine should clear the challenge record');
    assert.ok(server.slice(i, i + 400).includes('updateNow'), 'and put the address back afterwards');
  });

  it('reports updater health to the admin UI', () => {
    assert.ok(server.includes('duckdns.status(cfg.lastIpUpdate)'));
    assert.ok(server.includes('updaterRunning: health.running'));
  });

  it('stops the loop before the shutdown drain window', () => {
    assert.ok(server.includes('duckdns.stop();'));
  });
});

describe('admin UI', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const banner = app.slice(
    app.indexOf('function paintDuckdnsBanner'),
    app.indexOf('async function refreshDuckdnsStatus')
  );

  it('has a banner that reads health rather than only the last address', () => {
    assert.ok(banner.length > 0, 'paintDuckdnsBanner should exist');
    assert.ok(banner.includes('h.stale'));
    assert.ok(banner.includes('h.running'));
    assert.ok(banner.includes('h.conflict'));
  });

  it('paints a stale record red, which is what nobody could see before', () => {
    const stale = banner.slice(banner.indexOf('if (h.stale)'));
    assert.ok(stale.slice(0, 200).includes('red()'));
  });

  it('escapes the error text it puts into the banner', () => {
    assert.ok(banner.includes("esc(t('duckdns.lastError'"));
  });
});
