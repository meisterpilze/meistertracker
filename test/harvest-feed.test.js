'use strict';
// Outbound harvest feed: config validation, what the payload does and does not
// contain, the HMAC construction, and the retry/abort behaviour of the POST.
//
// No network. `post()` takes an injected fetch so the transport can be exercised
// without one — a test that needs a receiver is a test nobody runs.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const feed = require('../harvest-feed.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_feed_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

const NOW = new Date('2026-07-30T12:00:00.000Z');
function daysFromNow(n) {
  const d = new Date(NOW.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const CFG = {
  url: 'https://example.test/feed',
  secret: 's3cret',
  intervalMs: 900000,
  freshDays: 3,
  plannedDays: 28,
  leadDays: 0,
  strain: true,
  site: '',
  timeoutMs: 15000
};

function block(d, id, species, strain, due, bags) {
  db.insertBatch(
    d,
    {
      batchId: id,
      species,
      strain,
      qty: bags.length,
      days: 14,
      substrate: { hardwood: 80, wheatbran: 20, rh: 0, gypsum: false },
      bagKg: 3,
      batchType: 'block',
      grainRh: 0,
      grainKg: 0,
      created: NOW.toISOString(),
      due,
      bags
    },
    [],
    null
  );
}

describe('harvest feed config', () => {
  it('is off when no URL is set', () => {
    assert.equal(feed.readConfig({}), null);
  });

  it('refuses to send unsigned', () => {
    assert.throws(() => feed.readConfig({ HARVEST_WEBHOOK_URL: 'https://a.test/x' }), /SECRET/);
  });

  it('refuses plain http to a remote host', () => {
    assert.throws(
      () => feed.readConfig({ HARVEST_WEBHOOK_URL: 'http://a.test/x', HARVEST_WEBHOOK_SECRET: 'k' }),
      /https/
    );
  });

  it('allows plain http to loopback, so it can be tried out locally', () => {
    const cfg = feed.readConfig({ HARVEST_WEBHOOK_URL: 'http://localhost:8787/x', HARVEST_WEBHOOK_SECRET: 'k' });
    assert.equal(cfg.url, 'http://localhost:8787/x');
  });

  it('rejects something that is not a URL at all', () => {
    assert.throws(
      () => feed.readConfig({ HARVEST_WEBHOOK_URL: 'not a url', HARVEST_WEBHOOK_SECRET: 'k' }),
      /not a URL/
    );
  });

  it('clamps the interval to at least a minute', () => {
    const cfg = feed.readConfig({
      HARVEST_WEBHOOK_URL: 'https://a.test/x',
      HARVEST_WEBHOOK_SECRET: 'k',
      HARVEST_WEBHOOK_INTERVAL_MIN: '0'
    });
    assert.equal(cfg.intervalMs, 60000);
  });

  it('takes the documented defaults', () => {
    const cfg = feed.readConfig({ HARVEST_WEBHOOK_URL: 'https://a.test/x', HARVEST_WEBHOOK_SECRET: 'k' });
    assert.equal(cfg.freshDays, 3);
    assert.equal(cfg.plannedDays, 28);
    assert.equal(cfg.leadDays, 0);
    assert.equal(cfg.strain, true);
    assert.equal(cfg.timeoutMs, 15000);
  });
});

describe('harvest feed payload', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());

    // Recorded harvests: two of the same species+strain inside the window, one
    // of another species, one too old to still be on offer.
    db.insertHarvest(d, {
      time: daysFromNow(-1) + 'T08:00:00',
      batch: 'B1',
      species: 'Oyster',
      strain: 'Blue',
      grams: 2400
    });
    db.insertHarvest(d, {
      time: daysFromNow(0) + 'T07:30:00',
      batch: 'B1',
      species: 'Oyster',
      strain: 'Blue',
      grams: 1800
    });
    db.insertHarvest(d, {
      time: daysFromNow(-2) + 'T09:00:00',
      batch: 'B2',
      species: 'Shiitake',
      strain: null,
      grams: 900
    });
    db.insertHarvest(d, {
      time: daysFromNow(-9) + 'T09:00:00',
      batch: 'B3',
      species: 'Lion',
      strain: null,
      grams: 5000
    });

    // Upcoming: a block batch inside the window, one far beyond it, a grain
    // batch (never harvested), and one that has already produced.
    block(d, 'P1', 'Lion', 'LM1', daysFromNow(6), ['P1-01']);
    block(d, 'P2', 'Oyster', 'Blue', daysFromNow(90), ['P2-01']);
    block(d, 'P3', 'Oyster', 'Blue', daysFromNow(4), ['P3-01']);
    db.insertHarvest(d, {
      time: daysFromNow(-1) + 'T10:00:00',
      batch: 'P3',
      species: 'Oyster',
      strain: 'Blue',
      grams: 500
    });
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('sums recorded harvests per species and strain, across batches', () => {
    const out = feed.buildPayload(d, CFG, NOW);
    const oyster = out.harvested.find((h) => h.species === 'Oyster');
    // 2400 + 1800 from B1, plus P3's first flush of 500. A customer asks for a
    // species, not for a batch — grouping by batch would split one offer in two.
    assert.equal(oyster.grams, 4700);
    assert.equal(oyster.strain, 'Blue');
    assert.equal(out.harvested.filter((h) => h.species === 'Oyster').length, 1);
  });

  it('drops harvests older than the freshness window', () => {
    const out = feed.buildPayload(d, CFG, NOW);
    assert.equal(
      out.harvested.some((h) => h.species === 'Lion'),
      false
    );
  });

  it('widens with freshDays — the same rows, a longer window', () => {
    const out = feed.buildPayload(d, { ...CFG, freshDays: 30 }, NOW);
    assert.equal(out.harvested.find((h) => h.species === 'Lion').grams, 5000);
  });

  it('lists an upcoming block batch, with a date and no amount', () => {
    const out = feed.buildPayload(d, CFG, NOW);
    const p1 = out.planned.find((e) => e.species === 'Lion');
    assert.equal(p1.expectedFrom, daysFromNow(6));
    // A yield estimate would arrive at a customer as a promise. There is none.
    assert.equal('grams' in p1, false);
    assert.equal('menge' in p1, false);
  });

  it('skips batches beyond the planning window', () => {
    const out = feed.buildPayload(d, CFG, NOW);
    assert.equal(
      out.planned.some((e) => e.expectedFrom === daysFromNow(90)),
      false
    );
  });

  it('skips batches that have already been harvested', () => {
    const out = feed.buildPayload(d, CFG, NOW);
    assert.equal(
      out.planned.some((e) => e.expectedFrom === daysFromNow(4)),
      false
    );
  });

  it('shifts the expected date by the lead time, without widening the window', () => {
    const out = feed.buildPayload(d, { ...CFG, leadDays: 10 }, NOW);
    assert.equal(out.planned.find((e) => e.species === 'Lion').expectedFrom, daysFromNow(16));
    // P2 is due in 90 days: a lead time must not pull it into a 28-day window.
    assert.equal(out.planned.length, 1);
  });

  it('turns the planned block off at zero', () => {
    assert.deepEqual(feed.buildPayload(d, { ...CFG, plannedDays: 0 }, NOW).planned, []);
  });

  it('omits strain names when asked to', () => {
    const out = feed.buildPayload(d, { ...CFG, strain: false }, NOW);
    assert.equal(
      out.harvested.every((h) => !('strain' in h)),
      true
    );
    assert.equal(
      out.planned.every((e) => !('strain' in e)),
      true
    );
  });

  it('carries nothing that identifies a batch, a bag or a person', () => {
    const raw = JSON.stringify(feed.buildPayload(d, CFG, NOW));
    for (const leak of ['B1', 'B2', 'P1-01', 'batch', 'bag', 'notes', 'quality'])
      assert.equal(raw.includes(leak), false, `payload contains ${leak}`);
  });

  it('carries the site label only when one is configured', () => {
    assert.equal('site' in feed.buildPayload(d, CFG, NOW), false);
    assert.equal(feed.buildPayload(d, { ...CFG, site: 'north' }, NOW).site, 'north');
  });

  it('is valid JSON with a version, so a receiver can refuse what it cannot read', () => {
    const out = feed.buildPayload(d, CFG, NOW);
    assert.equal(out.version, feed.VERSION);
    assert.equal(out.generatedAt, NOW.toISOString());
    assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
  });
});

describe('harvest feed signature', () => {
  it('signs timestamp and body together, so a captured request cannot be replayed later', () => {
    const body = '{"a":1}';
    const sig = feed.sign('k', 1700000000, body);
    const expected =
      'sha256=' +
      crypto
        .createHmac('sha256', 'k')
        .update('1700000000.' + body)
        .digest('hex');
    assert.equal(sig, expected);
    // Same body, different minute → different signature.
    assert.notEqual(feed.sign('k', 1700000060, body), sig);
  });
});

describe('harvest feed transport', () => {
  const cfg = { ...CFG, timeoutMs: 50 };

  it('sends the signature over the exact bytes it posts', async () => {
    let seen = null;
    const res = await feed.post(
      cfg,
      { hello: 'world' },
      {
        fetch: async (url, init) => {
          seen = { url, init };
          return { ok: true, status: 202 };
        }
      }
    );
    assert.equal(res.ok, true);
    assert.equal(seen.url, cfg.url);
    const ts = seen.init.headers['X-Meistertracker-Timestamp'];
    assert.equal(seen.init.headers['X-Meistertracker-Signature'], feed.sign(cfg.secret, Number(ts), seen.init.body));
    assert.equal(seen.init.body, '{"hello":"world"}');
  });

  it('never puts the secret in a header or the body', async () => {
    let seen = null;
    await feed.post(
      cfg,
      { a: 1 },
      {
        fetch: async (url, init) => {
          seen = init;
          return { ok: true, status: 200 };
        }
      }
    );
    assert.equal(JSON.stringify(seen).includes(cfg.secret), false);
  });

  it('retries a 500 and reports how often it tried', async () => {
    let calls = 0;
    const res = await feed.post(
      cfg,
      {},
      {
        fetch: async () => {
          calls++;
          return { ok: false, status: 500 };
        },
        sleep: async () => {}
      }
    );
    assert.equal(res.ok, false);
    assert.equal(calls, 3);
    assert.equal(res.attempts, 3);
  });

  it('gives up at once on a 401 — a wrong secret does not fix itself', async () => {
    let calls = 0;
    const res = await feed.post(
      cfg,
      {},
      {
        fetch: async () => {
          calls++;
          return { ok: false, status: 401 };
        },
        sleep: async () => {}
      }
    );
    assert.equal(calls, 1);
    assert.equal(res.error, 'HTTP 401');
  });

  it('keeps retrying a 429 — that one does pass with time', async () => {
    let calls = 0;
    await feed.post(
      cfg,
      {},
      {
        fetch: async () => {
          calls++;
          return { ok: false, status: 429 };
        },
        sleep: async () => {}
      }
    );
    assert.equal(calls, 3);
  });

  it('succeeds on a later attempt without complaining about the earlier ones', async () => {
    let calls = 0;
    const res = await feed.post(
      cfg,
      {},
      {
        fetch: async () => (++calls < 3 ? { ok: false, status: 503 } : { ok: true, status: 200 }),
        sleep: async () => {}
      }
    );
    assert.equal(res.ok, true);
    assert.equal(res.attempts, 3);
  });

  it('aborts a hanging receiver instead of holding the timer open', async () => {
    const res = await feed.post(
      cfg,
      {},
      {
        fetch: (url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              const e = new Error('aborted');
              e.name = 'AbortError';
              reject(e);
            });
          }),
        sleep: async () => {}
      }
    );
    assert.equal(res.ok, false);
    assert.match(res.error, /timeout/);
  });

  it('reports a transport error as text rather than throwing', async () => {
    const res = await feed.post(
      cfg,
      {},
      {
        fetch: async () => {
          throw new Error('ECONNREFUSED');
        },
        sleep: async () => {}
      }
    );
    assert.equal(res.ok, false);
    assert.equal(res.error, 'ECONNREFUSED');
  });
});

describe('harvest feed lifecycle', () => {
  const quiet = () => {};
  after(() => feed.stop());

  it('stays off when nothing is configured', () => {
    assert.equal(feed.start({ database: null, env: {}, log: quiet }), false);
  });

  it('stays off — loudly — when the config is broken', () => {
    const lines = [];
    const ok = feed.start({
      database: null,
      env: { HARVEST_WEBHOOK_URL: 'https://a.test/x' },
      log: (level, msg) => lines.push([level, msg])
    });
    assert.equal(ok, false);
    assert.equal(lines[0][0], 'error');
  });

  it('stays off in worktree mode, so two servers cannot contradict each other', () => {
    const ok = feed.start({
      database: null,
      env: { HARVEST_WEBHOOK_URL: 'https://a.test/x', HARVEST_WEBHOOK_SECRET: 'k' },
      log: quiet,
      skip: true
    });
    assert.equal(ok, false);
  });
});
