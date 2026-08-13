'use strict';
// Outbound harvest feed: config validation, what the payload does and does not
// contain, the HMAC construction, and the retry/abort behaviour of the POST.
//
// No network. `post()` takes an injected fetch so the transport can be exercised
// without one — a test that needs a receiver is a test nobody runs.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
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

/**
 * A due date the way the application actually writes it.
 *
 * ⚠️ `batches.due` is stored with `toISOString()` — a full timestamp, not a
 * plain date. The fixture used to write 'YYYY-MM-DD', which no code path in the
 * app produces, and that is exactly why a crash on real data passed every test
 * here: the feed appended 'T00:00:00Z' to the stored value, which is harmless
 * for a bare date and produces an invalid Date for a timestamp.
 *
 * A fixture in a format production never emits tests a program that does not
 * exist.
 */
function dueAt(n) {
  const d = new Date(NOW.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
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

  // URL.hostname keeps the brackets on an IPv6 literal, so a check written
  // against the bare '::1' silently rejected the one address it meant to allow.
  it('allows plain http to IPv6 loopback, brackets and all', () => {
    const cfg = feed.readConfig({ HARVEST_WEBHOOK_URL: 'http://[::1]:8787/x', HARVEST_WEBHOOK_SECRET: 'k' });
    assert.equal(cfg.url, 'http://[::1]:8787/x');
  });

  // Credentials in the URL get stored in the config row and logged with it, so
  // a password smuggled in this way undoes the care taken to keep the secret
  // out of the logs. The receiver authenticates the HMAC and never needs them.
  it('refuses credentials in the URL', () => {
    assert.throws(
      () => feed.readConfig({ HARVEST_WEBHOOK_URL: 'https://user:pw@a.test/x', HARVEST_WEBHOOK_SECRET: 'k' }),
      /credentials/
    );
  });

  it('refuses a URL that carries only a username', () => {
    assert.throws(
      () => feed.readConfig({ HARVEST_WEBHOOK_URL: 'https://user@a.test/x', HARVEST_WEBHOOK_SECRET: 'k' }),
      /credentials/
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
    block(d, 'P1', 'Lion', 'LM1', dueAt(6), ['P1-01']);
    block(d, 'P2', 'Oyster', 'Blue', dueAt(90), ['P2-01']);
    block(d, 'P3', 'Oyster', 'Blue', dueAt(4), ['P3-01']);
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

  it('asks fetch not to follow redirects at all', async () => {
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
    assert.equal(seen.redirect, 'manual');
  });

  it('gives up at once on a 308 — a receiver pointing elsewhere does not fix itself', async () => {
    let calls = 0;
    const res = await feed.post(
      cfg,
      {},
      {
        fetch: async () => {
          calls++;
          return { ok: false, status: 308 };
        },
        sleep: async () => {}
      }
    );
    assert.equal(res.ok, false);
    assert.equal(calls, 1, 'no retry — each attempt is another copy aimed at a URL nobody vetted');
    assert.match(res.error, /redirect refused/);
  });

  // The promise this feed makes is "push-only, and to exactly the configured
  // address". fetch follows redirects by default, and only Authorization and
  // Cookie are stripped when the origin changes — X-Meistertracker-Signature
  // and the body are not. So before this was pinned down, a receiver could
  // answer 308 and have every later report delivered, intact and signed, to a
  // host nobody configured and checkUrl never saw. Two loopback servers and the
  // real fetch, because an injected one cannot prove what the real one does.
  it('does not let the receiver redirect the report to another host', async () => {
    const collected = [];
    const collector = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        collected.push({ method: req.method, body });
        res.writeHead(200);
        res.end('ok');
      });
    });
    await new Promise((r) => collector.listen(0, '127.0.0.1', r));
    const collectorPort = collector.address().port;

    const receiver = http.createServer((req, res) => {
      res.writeHead(308, { Location: 'http://127.0.0.1:' + collectorPort + '/collect' });
      res.end();
    });
    await new Promise((r) => receiver.listen(0, '127.0.0.1', r));

    try {
      const res = await feed.post(
        { ...CFG, url: 'http://127.0.0.1:' + receiver.address().port + '/feed', timeoutMs: 2000 },
        { harvested: [{ species: 'Austernpilz', grams: 4200 }] },
        { sleep: async () => {} }
      );
      assert.equal(res.ok, false, 'a redirect is a failed delivery, not a successful one');
      assert.match(res.error, /redirect refused/);
      assert.deepEqual(collected, [], 'the report must never reach a host the configuration never named');
    } finally {
      collector.close();
      receiver.close();
    }
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

// ── Stored config ────────────────────────────────────────────────────────────
//
// The feed shipped as environment variables only, which meant a shell on the
// server and a restart. Everything else here is configured in Settings, so it
// is now too — and the two sources have to stay unambiguous.
describe('stored config', () => {
  let t;
  before(() => {
    t = tmpDb();
  });
  after(() => {
    t.db.close();
    for (const s of ['', '-shm', '-wal']) fs.rmSync(t.path + s, { force: true });
  });

  it('starts off, so an upgrade never begins posting on its own', () => {
    const cfg = db.getHarvestFeedCfg(t.db);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.url, '');
    assert.equal(feed.storedConfig(cfg), null);
  });

  it('survives a round trip through the database', () => {
    db.updateHarvestFeedCfg(t.db, {
      enabled: true,
      url: 'https://receiver.test/harvest',
      secret: 'shared',
      intervalMin: 30,
      freshDays: 2,
      plannedDays: 14,
      leadDays: 4,
      strain: false,
      site: 'north shed'
    });
    const cfg = feed.storedConfig(db.getHarvestFeedCfg(t.db));
    assert.equal(cfg.url, 'https://receiver.test/harvest');
    assert.equal(cfg.secret, 'shared');
    assert.equal(cfg.intervalMs, 30 * 60 * 1000);
    assert.equal(cfg.freshDays, 2);
    assert.equal(cfg.plannedDays, 14);
    assert.equal(cfg.leadDays, 4);
    assert.equal(cfg.strain, false);
    assert.equal(cfg.site, 'north shed');
    assert.equal(cfg.source, 'db');
  });

  it('refuses to send unsigned, exactly like the env path', () => {
    db.updateHarvestFeedCfg(t.db, { enabled: true, url: 'https://receiver.test/x', secret: '' });
    assert.throws(() => feed.storedConfig(db.getHarvestFeedCfg(t.db)), /secret/);
  });

  it('refuses plain http to anywhere but loopback', () => {
    db.updateHarvestFeedCfg(t.db, { enabled: true, url: 'http://receiver.test/x', secret: 'k' });
    assert.throws(() => feed.storedConfig(db.getHarvestFeedCfg(t.db)), /https/);
    db.updateHarvestFeedCfg(t.db, { enabled: true, url: 'http://localhost:8787/x', secret: 'k' });
    assert.equal(feed.storedConfig(db.getHarvestFeedCfg(t.db)).url, 'http://localhost:8787/x');
  });

  // Which source is in charge has to be answerable by looking at one screen.
  // Merging the two — URL from the form, secret from the environment — is how a
  // feed ends up posting somewhere nobody can account for.
  it('lets the stored config win when it is on', () => {
    db.updateHarvestFeedCfg(t.db, { enabled: true, url: 'https://from-db.test/x', secret: 'db-secret' });
    const cfg = feed.resolveConfig({
      database: t.db,
      dbApi: db,
      env: { HARVEST_WEBHOOK_URL: 'https://from-env.test/x', HARVEST_WEBHOOK_SECRET: 'env-secret' }
    });
    assert.equal(cfg.url, 'https://from-db.test/x');
    assert.equal(cfg.source, 'db');
  });

  it('falls back to the environment when the stored config is off', () => {
    db.updateHarvestFeedCfg(t.db, { enabled: false, url: 'https://from-db.test/x', secret: 'db-secret' });
    const cfg = feed.resolveConfig({
      database: t.db,
      dbApi: db,
      env: { HARVEST_WEBHOOK_URL: 'https://from-env.test/x', HARVEST_WEBHOOK_SECRET: 'env-secret' }
    });
    assert.equal(cfg.url, 'https://from-env.test/x');
    assert.equal(cfg.source, 'env');
  });

  it('is off when neither source says otherwise', () => {
    db.updateHarvestFeedCfg(t.db, { enabled: false, url: '', secret: '' });
    assert.equal(feed.resolveConfig({ database: t.db, dbApi: db, env: {} }), null);
  });

  // A feed that quietly stopped delivering looks exactly like one that works,
  // unless the last outcome is written down where the settings screen can show
  // it.
  it('records how the last attempt went', () => {
    db.updateHarvestFeedStatus(t.db, { at: '2026-07-30T10:00:00.000Z', ok: true });
    let cfg = db.getHarvestFeedCfg(t.db);
    assert.equal(cfg.lastOk, true);
    assert.equal(cfg.lastAt, '2026-07-30T10:00:00.000Z');
    assert.equal(cfg.lastError, null);

    db.updateHarvestFeedStatus(t.db, { at: '2026-07-30T10:15:00.000Z', ok: false, error: 'HTTP 503' });
    cfg = db.getHarvestFeedCfg(t.db);
    assert.equal(cfg.lastOk, false);
    assert.equal(cfg.lastError, 'HTTP 503');
  });

  it('caps a runaway error message instead of storing a whole response body', () => {
    db.updateHarvestFeedStatus(t.db, { ok: false, error: 'x'.repeat(5000) });
    assert.equal(db.getHarvestFeedCfg(t.db).lastError.length, 500);
  });
});

// ── One entry per offer, not one per batch ───────────────────────────────────
//
// The planned list is what a shop shows as "coming soon". It carries a species,
// maybe a strain, and a date — deliberately no amount, because a yield estimate
// reaches a customer as a promise.
//
// Without grouping, each batch produced its own entry, so four blocks of one
// species due the same day published four identical lines. That let anyone
// reading the feed count batches. It is a cadence signal rather than a volume
// one — batch sizes differ severalfold — but it is a number nobody meant to
// publish, and the receiver renders the same offer four times.
describe('planned entries are per offer', () => {
  let t;
  before(() => {
    t = tmpDb();
    // Three blocks, same species, same strain, same due date.
    block(t.db, 'P1', 'Oyster', 'Blue', dueAt(6), ['P1-01']);
    block(t.db, 'P2', 'Oyster', 'Blue', dueAt(6), ['P2-01', 'P2-02', 'P2-03', 'P2-04', 'P2-05']);
    block(t.db, 'P3', 'Oyster', 'Blue', dueAt(6), ['P3-01', 'P3-02']);
    // Same species and day, different strain — two offers while strain names
    // are on, one once they are switched off.
    block(t.db, 'P4', 'Oyster', 'Pink', dueAt(6), ['P4-01']);
    // Same species, a different day: genuinely a separate offer.
    block(t.db, 'P5', 'Oyster', 'Blue', dueAt(9), ['P5-01']);
  });
  after(() => {
    t.db.close();
    for (const s of ['', '-shm', '-wal']) fs.rmSync(t.path + s, { force: true });
  });

  it('collapses several batches of one species due the same day', () => {
    const out = feed.buildPayload(t.db, CFG, NOW);
    const blue = out.planned.filter((e) => e.strain === 'Blue' && e.expectedFrom === daysFromNow(6));
    assert.equal(blue.length, 1, 'three batches, one offer — the count must not leak the batch count');
  });

  it('still keeps genuinely different offers apart', () => {
    const out = feed.buildPayload(t.db, CFG, NOW);
    assert.equal(out.planned.filter((e) => e.strain === 'Pink').length, 1, 'a different strain is its own offer');
    assert.equal(
      out.planned.filter((e) => e.expectedFrom === daysFromNow(9)).length,
      1,
      'a different date is its own offer'
    );
    assert.equal(out.planned.length, 3);
  });

  // Grouping in SQL alone does not cover this: the two strains are distinct
  // rows and only collapse once the name is dropped on the way out.
  it('does not republish the same entry twice when strain names are off', () => {
    const out = feed.buildPayload(t.db, { ...CFG, strain: false }, NOW);
    const sameDay = out.planned.filter((e) => e.expectedFrom === daysFromNow(6));
    assert.equal(sameDay.length, 1, 'Blue and Pink are one entry once the strain is dropped');
    assert.equal('strain' in sameDay[0], false);
  });
});

// ── Due dates as the application really stores them ──────────────────────────
//
// Found in production on the first real run: "Last attempt failed — Invalid
// time value". `batches.due` holds a full ISO timestamp, the feed appended
// 'T00:00:00Z' to it, and the resulting Date was invalid. One planned batch was
// enough to take the whole payload down — including the harvested half, which
// has nothing to do with dates.
describe('due dates', () => {
  let t;
  before(() => {
    t = tmpDb();
    db.insertHarvest(t.db, {
      time: daysFromNow(0) + 'T07:00:00',
      batch: 'H1',
      species: 'Oyster',
      strain: 'Blue',
      grams: 2000
    });
  });
  after(() => {
    t.db.close();
    for (const s of ['', '-shm', '-wal']) fs.rmSync(t.path + s, { force: true });
  });

  it('reads a full timestamp and reports the date part', () => {
    block(t.db, 'D1', 'Lion', 'LM1', dueAt(5), ['D1-01']);
    const out = feed.buildPayload(t.db, CFG, NOW);
    assert.equal(out.planned.find((e) => e.species === 'Lion').expectedFrom, daysFromNow(5));
  });

  // The window used to be compared against the raw column, and a timestamp on
  // the final day sorts after the bare date — so the last day of the look-ahead
  // silently fell out.
  it('includes a batch due on the very last day of the window', () => {
    block(t.db, 'D2', 'Shiitake', 'S1', dueAt(CFG.plannedDays), ['D2-01']);
    const out = feed.buildPayload(t.db, CFG, NOW);
    assert.ok(
      out.planned.some((e) => e.species === 'Shiitake'),
      'a batch due exactly plannedDays out must still be reported'
    );
  });

  // A single unreadable row is a data problem, not a reason to publish nothing.
  // The harvested half is the half people sell against.
  it('survives an unreadable due date instead of losing the whole payload', () => {
    block(t.db, 'D3', 'Enoki', 'E1', 'sometime next week', ['D3-01']);
    const out = feed.buildPayload(t.db, CFG, NOW);
    assert.equal(out.harvested.length, 1, 'the harvested half must still be there');
    assert.ok(!out.planned.some((e) => e.species === 'Enoki'));
  });
});

// ── Release for sale ─────────────────────────────────────────────────────────
//
// `harvested` says what came off the racks. It only ever grows, so it stops
// being the truth the moment anything is sold anywhere else — and at a market
// stand nobody records sales. Release mode replaces the published figure with
// an amount someone deliberately set aside, which no cash sale can reach.
describe('release for sale', () => {
  let d, p;
  const REL = { ...CFG, releaseMode: true };

  before(() => {
    ({ db: d, path: p } = tmpDb());
    db.insertHarvest(d, {
      time: daysFromNow(-1) + 'T08:00:00',
      batch: 'B1',
      species: 'Oyster',
      strain: 'Blue',
      grams: 6200
    });
  });
  after(() => {
    try {
      fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  });

  it('changes nothing while it is off', () => {
    db.setHarvestRelease(d, { species: 'Oyster', grams: 2000, validUntil: null });
    const out = feed.buildPayload(d, CFG, NOW);
    assert.equal(out.version, 1, 'a lab not using releases must keep sending fassung 1');
    assert.ok(!('released' in out), 'no list, no version bump, no surprise for an existing receiver');
  });

  it('sends the released amount under its own key, and bumps the version', () => {
    const out = feed.buildPayload(d, REL, NOW);
    assert.equal(out.version, 2, 'a receiver must be able to tell that `harvested` is no longer the sellable figure');
    assert.deepEqual(out.released, [{ species: 'Oyster', grams: 2000 }]);
    // The production fact stays untouched next to it: 6.2 kg were harvested,
    // 2 kg may be sold. Merging the two would destroy the more useful one.
    assert.equal(out.harvested[0].grams, 6200);
  });

  it('keeps a release that has outlived its harvest window', () => {
    // Set two kilos aside on Monday for Saturday's market and by Thursday the
    // harvest has aged out of freshDays — while the crate is still standing
    // there. The person who put it there is the better source than the window.
    const later = new Date(NOW.getTime() + 10 * 86400000);
    const out = feed.buildPayload(d, REL, later);
    assert.equal(out.harvested.length, 0, 'the harvest itself is long out of the window');
    assert.deepEqual(out.released, [{ species: 'Oyster', grams: 2000 }]);
  });

  it('drops a release that has run out', () => {
    db.setHarvestRelease(d, { species: 'Oyster', grams: 2000, validUntil: daysFromNow(-1) });
    const out = feed.buildPayload(d, REL, NOW);
    assert.deepEqual(out.released, [], 'yesterday cannot still be selling today');
  });

  it('counts the last day as still valid', () => {
    // Off-by-one in the wrong direction here means the market Saturday is over
    // before it starts.
    db.setHarvestRelease(d, { species: 'Oyster', grams: 2000, validUntil: daysFromNow(0) });
    const out = feed.buildPayload(d, REL, NOW);
    assert.equal(out.released.length, 1, 'valid *until* today includes today');
    assert.equal(out.released[0].validUntil, daysFromNow(0), 'the receiver needs the date to expire it as well');
  });

  it('leaves out an amount of zero rather than reporting it as zero', () => {
    // "Released, none left" and "not released" mean different things to a shop,
    // and only one of them is a number worth publishing.
    db.setHarvestRelease(d, { species: 'Oyster', grams: 0, validUntil: null });
    const out = feed.buildPayload(d, REL, NOW);
    assert.deepEqual(out.released, []);
  });

  it('expires at the end of the local day, not the UTC one', () => {
    // East of Greenwich the UTC day ends first: at 00:30 in Berlin it is still
    // yesterday in UTC, and a release valid "until yesterday" would go on
    // selling for another two hours. The direction of that error is what
    // decides this — the other way round costs nobody anything.
    const tz = process.env.TZ;
    try {
      process.env.TZ = 'Europe/Berlin';
      const justAfterMidnightInBerlin = new Date('2026-07-30T22:30:00.000Z');
      db.setHarvestRelease(d, { species: 'Oyster', grams: 2000, validUntil: '2026-07-30' });
      const out = feed.buildPayload(d, REL, justAfterMidnightInBerlin);
      assert.deepEqual(out.released, [], 'it is already the 31st where the mushrooms are');
    } finally {
      process.env.TZ = tz;
    }
  });
});

// ── Releasing straight from the scale ────────────────────────────────────────
//
// The settings table replaces a number; this one adds to it. That difference is
// the whole reason the function exists: two harvests in one afternoon go into the
// same crate, and the person typing the second number is looking at a bag rather
// than at the table.
describe('adding to a release', () => {
  let d, p;
  // Every call carries a permitted actor, so a missing-permission throw can never
  // be what makes one of these pass. The permission itself is exercised below.
  const ADMIN = { role: 'admin' };

  // Local, not UTC — the same clock addHarvestRelease reads. A test that builds
  // its expected date in UTC passes in London and fails in Berlin after 22:00,
  // which is the least useful kind of red.
  function localDay(at) {
    const q = (n) => String(n).padStart(2, '0');
    return `${at.getFullYear()}-${q(at.getMonth() + 1)}-${q(at.getDate())}`;
  }
  function daysFrom(at, n) {
    const q = new Date(at.getTime());
    q.setDate(q.getDate() + n);
    return localDay(q);
  }

  before(() => {
    ({ db: d, path: p } = tmpDb());
    // The gate lives in addHarvestRelease, so it has to be open for the rest of
    // this block. Everything else here is the default config.
    db.updateHarvestFeedCfg(d, { releaseMode: true, freshDays: 3 });
  });
  after(() => {
    try {
      fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  });

  it('refuses while release mode is off', () => {
    // The gate belongs to the writer and not to the route: whoever records a
    // harvest next inherits it instead of having to remember it.
    const { db: off, path: offPath } = tmpDb();
    try {
      assert.throws(
        () => db.addHarvestRelease(off, { species: 'Oyster', grams: 100, actor: ADMIN }),
        /release mode is off/
      );
      assert.deepEqual(db.listHarvestReleases(off), [], 'and nothing is written');
    } finally {
      off.close();
      try {
        fs.unlinkSync(offPath);
      } catch {
        /* best effort */
      }
    }
  });

  it('creates the row and dates it freshDays out', () => {
    const r = db.addHarvestRelease(d, { species: 'Oyster', grams: 1500, days: 3, actor: ADMIN }, NOW);
    assert.equal(r.grams, 1500);
    assert.equal(r.fresh, true, 'the caller needs to know this started an episode');
    assert.equal(r.validUntil, daysFrom(NOW, 3), 'produce that stops counting as fresh stops being sellable');
  });

  it('adds to a running release instead of replacing it', () => {
    const r = db.addHarvestRelease(d, { species: 'Oyster', grams: 500, days: 3, actor: ADMIN }, NOW);
    assert.equal(r.grams, 2000, 'two bags into one crate is 2 kg, not the second bag');
    assert.equal(r.fresh, false);
  });

  it('leaves a running release its own expiry', () => {
    // A crate that should be empty on Wednesday does not become fresher because
    // something was added to it on Wednesday. Extending is a decision and belongs
    // in the table, where it is visible.
    const later = new Date(NOW.getTime() + 2 * 86400000);
    const r = db.addHarvestRelease(d, { species: 'Oyster', grams: 100, days: 3, actor: ADMIN }, later);
    assert.equal(r.validUntil, daysFrom(NOW, 3), 'not pushed out to later + 3');
    assert.equal(r.grams, 2100);
  });

  it('starts over on an expired row rather than adding behind a past date', () => {
    // The bug this prevents: grams land on a row whose date is already gone, so
    // nothing publishes them and nothing says why. An expired release is a crate
    // that is gone — the next one is a new crate.
    db.setHarvestRelease(d, { species: 'Shiitake', grams: 800, validUntil: daysFrom(NOW, -1) });
    const r = db.addHarvestRelease(d, { species: 'Shiitake', grams: 300, days: 3, actor: ADMIN }, NOW);
    assert.equal(r.grams, 300, 'not 1100 — yesterday is not part of today');
    assert.equal(r.fresh, true);
    assert.equal(r.validUntil, daysFrom(NOW, 3));
  });

  it('starts over on a row sitting at zero', () => {
    // Zero is how the table says "sold out / never mind". Adding to it should
    // begin an episode, not resurrect the old date.
    db.setHarvestRelease(d, { species: 'Chestnut', grams: 0, validUntil: daysFrom(NOW, 30) });
    const r = db.addHarvestRelease(d, { species: 'Chestnut', grams: 400, days: 3, actor: ADMIN }, NOW);
    assert.equal(r.grams, 400);
    assert.equal(r.fresh, true);
    assert.equal(r.validUntil, daysFrom(NOW, 3), 'the stale 30-day date does not survive');
  });

  it('treats freshDays 0 as expiring tonight, not as never expiring', () => {
    // The dangerous reading of 0 is "no window", because the likely error is the
    // forgotten release and an open-ended crate is what the date exists to prevent.
    // 0 means only today's harvests count as fresh — so the release ends with today.
    const r = db.addHarvestRelease(d, { species: 'Reishi', grams: 250, days: 0, actor: ADMIN }, NOW);
    assert.equal(r.validUntil, localDay(NOW), 'not null — an unbounded release is the one outcome to avoid');
  });

  it('falls back to the configured window when days is not given', () => {
    // The route no longer passes freshDays, so the default has to come from here or
    // every caller has to remember it.
    const r = db.addHarvestRelease(d, { species: 'Enoki', grams: 300, actor: ADMIN }, NOW);
    assert.equal(r.validUntil, daysFrom(NOW, 3), 'freshDays 3 from the stored config');
  });

  it('stamps `updated` from the injected clock, not the wall clock', () => {
    // A back-dated release whose `updated` says "now" is a row that contradicts its
    // own window, and listHarvestReleases shows both in the settings table.
    db.addHarvestRelease(d, { species: 'Maitake', grams: 700, actor: ADMIN }, NOW);
    const row = db.listHarvestReleases(d).find((x) => x.species === 'Maitake');
    assert.equal(row.updated, NOW.toISOString());
  });

  it('refuses what cannot be a crate', () => {
    assert.throws(
      () => db.addHarvestRelease(d, { species: '', grams: 100, days: 3, actor: ADMIN }),
      /species required/
    );
    assert.throws(() => db.addHarvestRelease(d, { species: 'Oyster', grams: 0, days: 3, actor: ADMIN }), /> 0/);
    assert.throws(() => db.addHarvestRelease(d, { species: 'Oyster', grams: -5, days: 3, actor: ADMIN }), /> 0/);
    assert.throws(() => db.addHarvestRelease(d, { species: 'Oyster', grams: 'lots', days: 3, actor: ADMIN }), /> 0/);
  });

  it('reaches the feed as one line per species', () => {
    // The end of the chain, and the reason B1 in the receiver's review mattered:
    // two lines for one species make two cards with separate amounts, and a stock
    // cap downstream then reads the last instead of the sum.
    const out = feed.buildPayload(d, { ...CFG, releaseMode: true }, NOW);
    const arten = out.released.map((r) => r.species);
    assert.deepEqual(arten, [...new Set(arten)].sort(), 'one line per species, sorted');
    assert.equal(out.released.find((r) => r.species === 'Oyster').grams, 2100);
  });
});

// ── The two guards the route used to hold inline ──────────────────────────────
//
// Extracted so they can be tested at all: this repo has no HTTP-level harness, so
// as long as these lived inside the request handler, inverting either comparison
// stayed green. They are the guards against the two failure modes the field was
// built for — a slipped comma, and a release with nothing to key it to.
describe('releaseProblem', () => {
  it('says nothing when there is no release to check', () => {
    // Absent, zero and negative all mean "this harvest sets nothing aside", and
    // none of them should produce a complaint about grams or species.
    for (const release of [undefined, null, 0, -1]) {
      assert.equal(feed.releaseProblem({ release, grams: 500 }), null, String(release));
    }
  });

  it('passes a release that fits, with a species', () => {
    assert.equal(feed.releaseProblem({ release: 500, grams: 3000, species: 'Oyster' }), null);
    assert.equal(feed.releaseProblem({ release: 3000, grams: 3000, species: 'Oyster' }), null, 'all of it is fine');
  });

  it('rejects more released than weighed, fatally', () => {
    // Fatal because the harvest itself is wrong: 200 g weighed and 2000 g released
    // is a slipped comma, and storing it would publish produce nobody has.
    const p = feed.releaseProblem({ release: 2000, grams: 200, species: 'Oyster' });
    assert.equal(p.reason, 'release must be <= grams');
    assert.equal(p.fatal, true, 'a bad request — the harvest must not be stored either');
  });

  it('reports a missing species without condemning the harvest', () => {
    // Not fatal: a weighed harvest is a fact whatever happens to the release, and
    // losing it over a missing species name would be the worse trade.
    for (const species of [undefined, null, '']) {
      const p = feed.releaseProblem({ release: 500, grams: 3000, species });
      assert.equal(p.reason, 'species required to release');
      assert.equal(p.fatal, false, 'the harvest is still stored, the release is reported next to it');
    }
  });

  it('checks the amount before the species', () => {
    // Both wrong at once has to answer with the fatal one, or a slipped comma gets
    // stored while the reply talks about a species name.
    const p = feed.releaseProblem({ release: 2000, grams: 200, species: '' });
    assert.equal(p.fatal, true);
  });
});

// ── Who may set produce aside ─────────────────────────────────────────────────
//
// The hole this closes: POST /api/harvests is open to every authenticated user by
// design — weighing bags is what a lab does all day — while every other write to
// harvest_release sits behind requireAdmin. Without a check, the harvest route was
// a way around that boundary, and what lands on the far side of it is the quantity
// a shop publicly offers.
//
// Not requireAdmin, though: the point of releasing at the scale is that the person
// holding the bag does it, and that person is usually not an admin. So a capability
// an admin grants, exactly like can_ship.
describe('release permission', () => {
  let d, p;

  before(() => {
    ({ db: d, path: p } = tmpDb());
    db.updateHarvestFeedCfg(d, { releaseMode: true, freshDays: 3 });
  });
  after(() => {
    d.close();
    try {
      fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  });

  it('lets an admin through', () => {
    assert.equal(db.mayRelease({ role: 'admin' }), true);
    assert.equal(db.mayRelease({ role: 'admin', can_release: 0 }), true, 'the role wins over the column');
  });

  it('lets a granted user through', () => {
    assert.equal(db.mayRelease({ role: 'user', can_release: 1 }), true);
  });

  it('refuses everyone else', () => {
    // The default. A user created without the grant has can_release 0, and that is
    // what the migration leaves behind for existing accounts too.
    assert.equal(db.mayRelease({ role: 'user', can_release: 0 }), false);
    assert.equal(db.mayRelease({ role: 'user' }), false, 'absent is not permitted');
    assert.equal(db.mayRelease(null), false);
    assert.equal(db.mayRelease(undefined), false, 'a forgotten actor is refused, not waved through');
    // Truthiness would be the tempting shortcut and the wrong one: a string from a
    // JSON body must not buy the capability.
    assert.equal(db.mayRelease({ role: 'user', can_release: '1' }), false);
    assert.equal(db.mayRelease({ role: 'admin ' }), false, 'no fuzzy role matching');
  });

  it('refuses to write without a permitted actor, and writes nothing', () => {
    assert.throws(
      () => db.addHarvestRelease(d, { species: 'Oyster', grams: 2000, actor: { role: 'user' } }),
      /not allowed to release/
    );
    assert.throws(() => db.addHarvestRelease(d, { species: 'Oyster', grams: 2000 }), /not allowed to release/);
    assert.deepEqual(db.listHarvestReleases(d), [], 'a refused release leaves no row behind');
  });

  it('checks the permission before the release mode', () => {
    // Order matters for what the operator reads back. Someone without the grant
    // should be told that, not sent to look at a feed setting they cannot see.
    const { db: off, path: offPath } = tmpDb();
    try {
      assert.throws(
        () => db.addHarvestRelease(off, { species: 'Oyster', grams: 100, actor: { role: 'user' } }),
        /not allowed to release/
      );
    } finally {
      off.close();
      try {
        fs.unlinkSync(offPath);
      } catch {
        /* best effort */
      }
    }
  });

  it('writes once the grant is there', () => {
    const r = db.addHarvestRelease(d, { species: 'Oyster', grams: 2000, actor: { role: 'user', can_release: 1 } }, NOW);
    assert.equal(r.grams, 2000);
  });

  it('grants and revokes through setUserCanRelease', () => {
    // createUser returns {username, role, created} and no id, so the row is looked
    // up rather than assumed — listUsers is also what the admin screen reads.
    db.createUser(d, 'worker', 'pw-for-a-test-only', 'user');
    const row = () => db.listUsers(d).find((x) => x.username === 'worker');
    const id = row().id;
    assert.equal(row().can_release, 0, 'nobody starts with it');
    db.setUserCanRelease(d, id, true);
    assert.equal(row().can_release, 1);
    db.setUserCanRelease(d, id, false);
    assert.equal(row().can_release, 0, 'and it can be taken back');
  });
});
