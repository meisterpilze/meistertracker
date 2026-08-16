'use strict';
// Outbound harvest feed: config validation, what the payload does and does not
// contain, the HMAC construction, and the retry/abort behaviour of the POST.
//
// No network. `post()` takes an injected fetch so the transport can be exercised
// without one — a test that needs a receiver is a test nobody runs.
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
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

// The list behind the release picker. It replaced a text field, and the text
// field cost a real sale: "Lions Mane" was typed where the batch says "Lions
// Mane (LM)", so the release matched nothing at the receiving end and the shop
// went on showing an empty shelf — no error on either side.
describe('known species', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    db.insertHarvest(d, { time: daysFromNow(-1) + 'T08:00:00', batch: 'B1', species: 'Oyster (OY)', grams: 1000 });
    // Planned only, never harvested — the case that matters. Produce is set
    // aside before it comes off the rack all the time.
    block(d, 'B9', 'Lions Mane (LM)', 'XXX', dueAt(4), ['B9-1']);
  });
  after(() => {
    d.close();
    try {
      fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  });

  it('offers what a batch plans, not only what a scale has seen', () => {
    assert.deepEqual(db.listKnownSpecies(d), ['Lions Mane (LM)', 'Oyster (OY)']);
  });

  it('offers the species verbatim, because the receiver matches on it literally', () => {
    const alle = db.listKnownSpecies(d);
    assert.ok(alle.includes('Lions Mane (LM)'), 'the code in brackets is part of the key, not decoration');
    assert.ok(!alle.includes('Lions Mane'), 'the bare name is a different string and matches nothing');
  });

  it('says nothing twice, however many harvests a species has', () => {
    db.insertHarvest(d, { time: daysFromNow(0) + 'T09:00:00', batch: 'B1', species: 'Oyster (OY)', grams: 500 });
    assert.deepEqual(db.listKnownSpecies(d), ['Lions Mane (LM)', 'Oyster (OY)']);
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
    assert.equal(out.version, feed.VERSION_RELEASE);
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
  const REL = { ...CFG };

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

  it('carries the list even when nobody has released anything', () => {
    // The empty list is the point. It used to be an absent field, and an absent
    // field reads as "this lab does not do releases" — which is how a harvest
    // total ends up in a shop window. Present and empty says "nothing is for
    // sale yet", and there is no way to configure that back into silence.
    const leer = tmpDb();
    try {
      const out = feed.buildPayload(leer.db, CFG, NOW);
      assert.equal(out.version, 2, 'there is no fassung 1 left to fall back to');
      assert.deepEqual(out.released, [], 'a statement, not a gap');
    } finally {
      leer.db.close();
      try {
        fs.unlinkSync(leer.path);
      } catch {
        /* best effort */
      }
    }
  });

  it('reports the released amount without being switched on first', () => {
    db.setHarvestRelease(d, { species: 'Oyster', grams: 2000, validUntil: null });
    const out = feed.buildPayload(d, CFG, NOW);
    assert.deepEqual(
      out.released,
      [{ species: 'Oyster', grams: 2000 }],
      'CFG is the plain default config — entering an amount is the whole act'
    );
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

// ── Pack sizes ───────────────────────────────────────────────────────────────
//
// `released` says how much may be sold; this says in what portions it is handed
// over. Without it the far end has to invent a ladder, because a shop cannot
// display "somewhere between nothing and 2 kg" — ours guessed multiples of
// 250 g, which is a fair guess and still a guess.
//
// One list for every species on purpose: portioning follows the packing bench,
// not the mushroom. The tests below hold the two halves of that — the list is
// canonical whatever it is typed as, and silence stays silence.
describe('pack sizes', () => {
  it('sorts, deduplicates and drops what is not a portion', () => {
    assert.deepEqual(feed.packSizes([1000, 250, 250, 500]), [250, 500, 1000]);
    assert.deepEqual(feed.packSizes('500, 250 ,1000'), [250, 500, 1000], 'a string is the stored shape');
    assert.deepEqual(feed.packSizes([250.5, -250, 0, 'nonsense', null]), [], 'half a gram is not a tray');
    assert.deepEqual(feed.packSizes([10, 30000]), [], 'below a portion and above a pallet');
  });

  it('reads a unit somebody typed out of habit as no number at all', () => {
    // parseInt('500g') is 500, and parseInt('2 kg') is 2 — it keeps whatever it
    // understood before it stopped. That second one is the dangerous half: a
    // two-gram portion looks like a number and would be published as one.
    assert.deepEqual(feed.packSizes('500g,2 kg'), []);
  });

  it('stops at eight, so a paste cannot become the ladder', () => {
    const many = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    assert.deepEqual(feed.packSizes(many), [100, 200, 300, 400, 500, 600, 700, 800]);
  });

  it('travels in the payload beside the release, not inside it', () => {
    // Inside each entry it would read as a per-species figure, and the whole
    // point is that it is not one.
    const t = tmpDb();
    try {
      db.setHarvestRelease(t.db, { species: 'Oyster', grams: 2000, validUntil: null });
      const out = feed.buildPayload(t.db, { ...CFG, packSizes: [500, 250] }, NOW);
      assert.deepEqual(out.packSizes, [250, 500]);
      assert.deepEqual(out.released, [{ species: 'Oyster', grams: 2000 }]);
      assert.equal('packSizes' in out.released[0], false);
      assert.equal(out.version, 2, 'an added field is not a new fassung');
    } finally {
      t.db.close();
      fs.rmSync(t.path, { force: true });
    }
  });

  it('says nothing when nothing is chosen', () => {
    // Deliberately unlike `released`, which is present and empty. There an
    // absent field meant "this lab does not do releases" and let raw stock
    // reach a shop window; here it means "no preference", and the receiver
    // keeps the ladder it already had.
    const t = tmpDb();
    try {
      for (const cfg of [CFG, { ...CFG, packSizes: [] }, { ...CFG, packSizes: ['x'] }]) {
        assert.equal('packSizes' in feed.buildPayload(t.db, cfg, NOW), false);
      }
    } finally {
      t.db.close();
      fs.rmSync(t.path, { force: true });
    }
  });

  it('survives a round trip through the database', () => {
    const t = tmpDb();
    try {
      db.updateHarvestFeedCfg(t.db, {
        enabled: true,
        url: 'https://receiver.test/x',
        secret: 'k',
        packSizes: [1000, 250, 500]
      });
      assert.deepEqual(db.getHarvestFeedCfg(t.db).packSizes, [1000, 250, 500], 'stored as given');
      assert.deepEqual(feed.storedConfig(db.getHarvestFeedCfg(t.db)).packSizes, [250, 500, 1000]);
    } finally {
      t.db.close();
      fs.rmSync(t.path, { force: true });
    }
  });

  it('shrugs off a row somebody edited by hand', () => {
    // A settings page that will not open is worse than a portion size that is
    // ignored, and this column is one `sqlite3` session away from anything.
    //
    // The two layers do different jobs here, and the split is deliberate: the
    // database reads the column, the feed decides what a portion may be. Only
    // one of them holds the limits, so there is only one to change.
    const t = tmpDb();
    try {
      t.db.exec(
        "UPDATE harvest_feed_config SET enabled=1, url='https://r.test/x', secret='k', pack_sizes='250,,x,9e9'"
      );
      const cfg = db.getHarvestFeedCfg(t.db);
      assert.deepEqual(cfg.packSizes, [250, 9e9], 'a split, not a check — but nothing unreadable comes through');
      assert.deepEqual(feed.packSizes(cfg.packSizes), [250], 'what the settings page is offered');
      assert.deepEqual(feed.storedConfig(cfg).packSizes, [250], 'and what actually goes out');
    } finally {
      t.db.close();
      fs.rmSync(t.path, { force: true });
    }
  });

  it('can be set from the environment, like every other feed option', () => {
    const cfg = feed.readConfig({
      HARVEST_WEBHOOK_URL: 'https://r.test/x',
      HARVEST_WEBHOOK_SECRET: 'k',
      HARVEST_WEBHOOK_PACK_SIZES: '250, 1000'
    });
    assert.deepEqual(cfg.packSizes, [250, 1000]);
    assert.deepEqual(
      feed.readConfig({ HARVEST_WEBHOOK_URL: 'https://r.test/x', HARVEST_WEBHOOK_SECRET: 'k' }).packSizes,
      [],
      'unset is a real answer'
    );
  });
});

// ── The reply ────────────────────────────────────────────────────────────────
//
// The reply body is the only path in this program where data from the far end
// reaches the database, so it carries the most tests in this file. Two
// properties matter more than all the rest, and each has cases of its own:
//
//   A bad reply never fails a good push. The payload is out; what came back is
//   a second and separate question, and answering it badly must not rewrite the
//   answer to the first one.
//
//   Storing the same pickup twice leaves one row. The receiver repeats every
//   open pickup on every push until it is confirmed, so this is the ordinary
//   path through the code and not an edge case.

/** A response the way fetch actually produces one — real headers, real stream. */
function jsonReply(body, extraHeaders) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'content-type': 'application/json', ...(extraHeaders || {}) }
  });
}

// ⚠️ **Kein festes Datum in einer Abholung.** Die Vorlage stand auf
// `2026-08-15`, und seit `listPickups()` voreingestellt nur noch Kommendes
// zeigt (Befund V5), wurde daraus eine Zeitbombe: Am Nachmittag des 15. waren
// alle Tests grün, um 03:05 des 16. fielen vierzehn durch. Ein Datum, das
// gestern noch heute war, prüft heute etwas anderes.
//
// Deshalb relativ zur Uhr, wie `ebenAngekommen()` es auf der Gegenseite tut.
// Wer die Vergangenheit braucht, sagt es mit einer negativen Zahl.
function tagIn(tage) {
  const d = new Date();
  d.setDate(d.getDate() + tage);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const ABHOLTAG = tagIn(3);

const PICKUP = {
  id: `p_${ABHOLTAG}-0900_1042`,
  order: '#1042',
  slot: `${ABHOLTAG}-0900`,
  slotText: '9–10 Uhr',
  place: 'Marktstand',
  from: `${ABHOLTAG}T09:00`,
  to: `${ABHOLTAG}T10:00`,
  zone: 'Europe/Berlin',
  items: [{ kind: 'Austernpilz', grams: 2000 }],
  overbooked: false
};

describe('feed reply – validation', () => {
  it('keeps a well-formed pickup whole', () => {
    const r = feed.parseReply(JSON.stringify({ ok: true, pickups: [PICKUP] }));
    assert.equal(r.dropped, 0);
    assert.deepEqual(r.pickups[0], PICKUP);
  });

  it('drops fields nobody asked for', () => {
    // Rebuilt field by field rather than filtered, so something nobody thought
    // of cannot ride along to whatever reads this next.
    const r = feed.parseReply(
      JSON.stringify({ pickups: [{ ...PICKUP, note: 'hi', price: 9.9, customer: 'Anna Meier' }] })
    );
    assert.deepEqual(Object.keys(r.pickups[0]).sort(), Object.keys(PICKUP).sort());
    assert.equal(r.pickups[0].customer, undefined);
    assert.equal(r.pickups[0].price, undefined);
  });

  it('throws away a pickup with no usable id — the id is what makes a repeat safe', () => {
    const r = feed.parseReply(
      JSON.stringify({
        pickups: [
          { ...PICKUP, id: '' },
          { ...PICKUP, id: 'has spaces' },
          { ...PICKUP, id: 42 }
        ]
      })
    );
    assert.deepEqual(r.pickups, []);
    assert.equal(r.dropped, 3, 'dropping without counting looks like a receiver with nothing to say');
  });

  it('keeps the first of a repeated id, so the winner does not depend on order', () => {
    const r = feed.parseReply(
      JSON.stringify({
        pickups: [
          { ...PICKUP, place: 'first' },
          { ...PICKUP, place: 'second' }
        ]
      })
    );
    assert.equal(r.pickups.length, 1);
    assert.equal(r.pickups[0].place, 'first');
    assert.equal(r.dropped, 1);
  });

  it('survives a body that is not JSON at all', () => {
    const r = feed.parseReply('<html><body>502 Bad Gateway</body></html>');
    assert.deepEqual(r.pickups, []);
    assert.match(r.error, /not JSON/);
  });

  it('survives a body that is JSON but not an object', () => {
    assert.match(feed.parseReply('[1,2,3]').error, /not an object/);
    assert.match(feed.parseReply('"nope"').error, /not an object/);
  });

  it('treats a reply with no pickups field as silence, not as an error', () => {
    // Every receiver written before this feature existed answers exactly this
    // way, and none of them should start producing warnings because of it.
    const r = feed.parseReply(JSON.stringify({ ok: true }));
    assert.deepEqual(r.pickups, []);
    assert.equal(r.error, undefined);
  });

  it('refuses a pickups field that is not a list', () => {
    assert.match(feed.parseReply(JSON.stringify({ pickups: { a: 1 } })).error, /not a list/);
  });

  it('caps how many pickups one reply may carry, and says so', () => {
    const many = Array.from({ length: feed.MAX_PICKUPS + 50 }, (_, i) => ({ ...PICKUP, id: 'p_' + i }));
    const r = feed.parseReply(JSON.stringify({ pickups: many }));
    assert.equal(r.pickups.length, feed.MAX_PICKUPS);
    assert.equal(r.dropped, 50);
    assert.match(r.error, /more than/);
  });

  it('drops item lines that are not usable and keeps the ones that are', () => {
    const r = feed.parseReply(
      JSON.stringify({
        pickups: [
          {
            ...PICKUP,
            items: [
              { kind: 'Austernpilz', grams: 2000 },
              { kind: '', grams: 500 },
              { kind: 'Negative', grams: -5 },
              { kind: 'Absurd', grams: 99999999999 },
              { kind: 'NotANumber', grams: 'lots' },
              'not an object',
              null
            ]
          }
        ]
      })
    );
    assert.deepEqual(r.pickups[0].items, [{ kind: 'Austernpilz', grams: 2000 }]);
  });

  it('refuses a from/to that carries its own offset', () => {
    // The whole point of shipping `zone` separately is that these are local
    // wall-clock. A value that looks like an instant invites exactly the
    // conversion that must not happen, so it is not stored at all.
    const r = feed.parseReply(
      JSON.stringify({ pickups: [{ ...PICKUP, from: `${ABHOLTAG}T09:00+02:00`, to: `${ABHOLTAG}T08:00:00Z` }] })
    );
    assert.equal(r.pickups[0].from, undefined);
    assert.equal(r.pickups[0].to, undefined);
    assert.equal(r.pickups[0].id, PICKUP.id, 'a bad time is not a reason to throw the pickup away');
  });

  it('refuses a zone that is not a zone', () => {
    const r = feed.parseReply(JSON.stringify({ pickups: [{ ...PICKUP, zone: '../../etc/passwd' }] }));
    assert.equal(r.pickups[0].zone, undefined);
  });

  it('strips control characters out of anything that will be displayed', () => {
    const r = feed.parseReply(JSON.stringify({ pickups: [{ ...PICKUP, place: 'Markt\u001b[31mstand\u0000' }] }));
    assert.doesNotMatch(r.pickups[0].place, /[\u0000-\u001f\u007f]/);
  });

  it('bounds every string, so one field cannot become a megabyte', () => {
    const r = feed.parseReply(
      JSON.stringify({ pickups: [{ ...PICKUP, place: 'x'.repeat(50000), order: 'y'.repeat(50000) }] })
    );
    assert.ok(r.pickups[0].place.length <= 120);
    assert.ok(r.pickups[0].order.length <= 64);
  });

  it('takes overbooked only from a real boolean', () => {
    const truthy = feed.parseReply(JSON.stringify({ pickups: [{ ...PICKUP, overbooked: 'yes' }] }));
    assert.equal(truthy.pickups[0].overbooked, false);
    const real = feed.parseReply(JSON.stringify({ pickups: [{ ...PICKUP, overbooked: true }] }));
    assert.equal(real.pickups[0].overbooked, true);
  });
});

describe('feed reply – over the wire', () => {
  const cfg = { ...CFG, timeoutMs: 200 };

  it('carries a valid reply back with the result', async () => {
    const r = await feed.post(cfg, {}, { fetch: async () => jsonReply({ ok: true, pickups: [PICKUP] }) });
    assert.equal(r.ok, true);
    assert.equal(r.reply.pickups.length, 1);
  });

  it('a broken reply body leaves the push successful', async () => {
    // The single most important case in this file. The numbers reached the
    // receiver; whether it managed to answer in JSON has nothing to do with
    // that, and reporting a delivered feed as failed would have somebody
    // chasing a receiver that is working perfectly well.
    const r = await feed.post(cfg, {}, { fetch: async () => jsonReply('{"pickups": [{"id": ') });
    assert.equal(r.ok, true, 'a delivered payload must not be reported as failed');
    assert.equal(r.status, 200);
    assert.match(r.reply.error, /not JSON/);
  });

  it('refuses an oversized body, and still calls the push a success', async () => {
    const huge = JSON.stringify({ pickups: [{ id: 'p_1', place: 'x'.repeat(feed.REPLY_MAX_BYTES + 1024) }] });
    const r = await feed.post(cfg, {}, { fetch: async () => jsonReply(huge) });
    assert.equal(r.ok, true);
    assert.deepEqual(r.reply.pickups, []);
    assert.match(r.reply.error, /exceeded/);
  });

  it('refuses a declared length over the cap without reading a byte', async () => {
    // The cheapest guard there is: the receiver said how big it is, and it is
    // too big, so nothing needs reading at all.
    let read = false;
    const r = await feed.post(
      cfg,
      {},
      {
        fetch: async () => ({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json', 'content-length': '99999999' }),
          text: async () => {
            read = true;
            return '{}';
          }
        })
      }
    );
    assert.equal(r.ok, true);
    assert.match(r.reply.error, /declared/);
    assert.equal(read, false, 'the body was pulled despite the receiver saying how big it was');
  });

  it('refuses a body that does not claim to be JSON', async () => {
    // A receiver answering an API call with an HTML error page is the everyday
    // shape of a misconfigured proxy.
    const res = new Response('<html>Gateway Timeout</html>', { headers: { 'content-type': 'text/html' } });
    const r = await feed.post(cfg, {}, { fetch: async () => res });
    assert.equal(r.ok, true);
    assert.match(r.reply.error, /text\/html/);
  });

  it('treats a reply with no content type as silence', async () => {
    const r = await feed.post(cfg, {}, { fetch: async () => ({ ok: true, status: 204 }) });
    assert.equal(r.ok, true);
    assert.deepEqual(r.reply.pickups, []);
    assert.equal(r.reply.error, undefined);
  });

  it('reads no reply at all from a push that failed', async () => {
    // Nothing was delivered, so there is nothing this end is entitled to act on.
    const r = await feed.post(
      cfg,
      {},
      { fetch: async () => new Response('{}', { status: 500 }), sleep: async () => {} }
    );
    assert.equal(r.ok, false);
    assert.equal(r.reply, undefined);
  });
});

// ── The round trip ───────────────────────────────────────────────────────────
//
// build → push → store → confirm on the next push, against a real database and
// through deliver(), which is the same function the timer calls.
describe('pickups round trip', () => {
  let t;
  const quiet = () => {};
  const cfg = { ...CFG, plannedDays: 0, timeoutMs: 200 };

  beforeEach(() => {
    t = tmpDb();
  });
  afterEach(() => {
    t.db.close();
    for (const s of ['', '-shm', '-wal']) fs.rmSync(t.path + s, { force: true });
  });

  /** Push once against a receiver answering with `pickups`, keeping what we sent. */
  async function push(pickups, sentBodies) {
    return feed.deliver({
      database: t.db,
      cfg,
      dbApi: db,
      log: quiet,
      deps: {
        fetch: async (_url, init) => {
          if (sentBodies) sentBodies.push(JSON.parse(init.body));
          return jsonReply({ ok: true, pickups });
        },
        sleep: async () => {}
      }
    });
  }

  it('stores a reported pickup, field for field', async () => {
    await push([PICKUP]);
    const rows = db.listPickups(t.db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, PICKUP.id);
    assert.equal(rows[0].order, '#1042');
    assert.equal(rows[0].place, 'Marktstand');
    assert.deepEqual(rows[0].items, [{ kind: 'Austernpilz', grams: 2000 }]);
    assert.equal(rows[0].overbooked, false);
  });

  it('leaves the local times exactly as they arrived', async () => {
    // Not converted, not normalised, not round-tripped through a Date. The zone
    // travels with them so the far end's wall-clock stays readable here, and
    // "9–10" is what the customer was told.
    await push([PICKUP]);
    const row = db.listPickups(t.db)[0];
    assert.equal(row.from, `${ABHOLTAG}T09:00`);
    assert.equal(row.to, `${ABHOLTAG}T10:00`);
    assert.equal(row.zone, 'Europe/Berlin');
  });

  it('the same pickup reported three times is one row', async () => {
    // The ordinary path, not an edge case: the receiver repeats every open
    // pickup on every push until this end confirms it.
    await push([PICKUP]);
    await push([PICKUP]);
    await push([PICKUP]);
    assert.equal(db.listPickups(t.db).length, 1);
  });

  it('an updated pickup overwrites rather than duplicating', async () => {
    await push([PICKUP]);
    await push([{ ...PICKUP, place: 'Hofladen', slotText: 'Sa 15.08., 10–11 Uhr' }]);
    const rows = db.listPickups(t.db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].place, 'Hofladen');
  });

  it('sends the stored ids back on the next push, and not on the first', async () => {
    const sent = [];
    await push([PICKUP], sent);
    assert.equal(sent[0].pickupsDone, undefined, 'nothing was stored yet, so there is nothing to confirm');
    await push([], sent);
    assert.deepEqual(sent[1].pickupsDone, [PICKUP.id]);
  });

  it('stops sending an id once the receiver has heard it', async () => {
    const sent = [];
    await push([PICKUP], sent); // arrives
    await push([], sent); // confirmed on this one
    await push([], sent); // nothing left to say
    assert.deepEqual(sent[1].pickupsDone, [PICKUP.id]);
    assert.equal(sent[2].pickupsDone, undefined);
    assert.equal(db.countPickups(t.db).unconfirmed, 0);
  });

  it('confirms nothing when the push did not get through', async () => {
    // Confirming what a failed push carried is how a pickup goes missing on
    // both sides at once: the receiver never heard, drops it from its next
    // reply anyway, and then neither side has it.
    await push([PICKUP]);
    await feed.deliver({
      database: t.db,
      cfg,
      dbApi: db,
      log: quiet,
      deps: { fetch: async () => ({ ok: false, status: 503 }), sleep: async () => {} }
    });
    assert.deepEqual(db.unackedPickupIds(t.db), [PICKUP.id], 'a failed push must not count as heard');
  });

  it('confirms again when a pickup arrives after it was already confirmed', async () => {
    // Still being sent means the confirmation never registered at the far end.
    // Saying it again is cheap; the alternative is a pickup that repeats for
    // ever because this end decided once that it had already answered.
    const sent = [];
    await push([PICKUP], sent);
    await push([PICKUP], sent);
    assert.deepEqual(sent[1].pickupsDone, [PICKUP.id]);
    await push([], sent);
    assert.deepEqual(sent[2].pickupsDone, [PICKUP.id], 'the repeat re-armed the confirmation');
  });

  it('a broken reply costs the pickups, not the push and not the harvest numbers', async () => {
    const r = await feed.deliver({
      database: t.db,
      cfg,
      dbApi: db,
      log: quiet,
      deps: { fetch: async () => jsonReply('not json at all'), sleep: async () => {} }
    });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.payload.harvested), 'the payload still went out');
    assert.equal(db.listPickups(t.db).length, 0);
  });

  it('keeps the good pickups out of a reply that also carries junk', async () => {
    await push([PICKUP, { id: '' }, { nope: 1 }, { ...PICKUP, id: 'p_second' }]);
    assert.deepEqual(
      db
        .listPickups(t.db)
        .map((r) => r.id)
        .sort(),
      [PICKUP.id, 'p_second'].sort()
    );
  });
});

// ── Withdrawals ──────────────────────────────────────────────────────────────
//
// A customer cancels after the pickup was already stored here. The receiver
// cannot reach in and delete it — there is no route to this machine, which is
// the entire point — so it names the id in its next reply instead.
//
// The failure this prevents is concrete: without it the pickup stands in the
// list for ever and somebody packs a crate for nobody.
describe('feed reply – withdrawals', () => {
  it('reads a plain list of ids', () => {
    const r = feed.parseReply(JSON.stringify({ ok: true, pickupsCancelled: ['p_1', 'p_2'] }));
    assert.deepEqual(r.cancelled, ['p_1', 'p_2']);
    assert.equal(r.error, undefined);
  });

  it('holds the same ids to the same shape a booking has to meet', () => {
    // An id that would be refused as a booking cannot be honoured as a
    // withdrawal either, or the two lists disagree about what an id is.
    const r = feed.parseReply(
      JSON.stringify({ pickupsCancelled: [42, {}, null, 'has spaces', 'x'.repeat(200), '', 'p_good'] })
    );
    assert.deepEqual(r.cancelled, ['p_good']);
    assert.equal(r.dropped, 6);
  });

  it('collapses a repeated id', () => {
    const r = feed.parseReply(JSON.stringify({ pickupsCancelled: ['p_a', 'p_a', 'p_a'] }));
    assert.deepEqual(r.cancelled, ['p_a']);
  });

  it('caps how many one reply may carry', () => {
    const many = Array.from({ length: feed.MAX_CANCELLED + 60 }, (_, i) => 'p_' + i);
    const r = feed.parseReply(JSON.stringify({ pickupsCancelled: many }));
    assert.equal(r.cancelled.length, feed.MAX_CANCELLED);
    assert.equal(r.dropped, 60);
    assert.match(r.error, /more than/);
  });

  it('refuses a field that is not a list, without touching the pickups beside it', () => {
    const r = feed.parseReply(JSON.stringify({ pickups: [PICKUP], pickupsCancelled: 'p_1' }));
    assert.equal(r.pickups.length, 1, 'a garbled withdrawal list must not cost the bookings');
    assert.deepEqual(r.cancelled, []);
    assert.match(r.error, /pickupsCancelled is not a list/);
  });

  it('survives the mirror case — broken pickups, usable withdrawals', () => {
    const r = feed.parseReply(JSON.stringify({ pickups: 'nope', pickupsCancelled: ['p_1'] }));
    assert.deepEqual(r.cancelled, ['p_1']);
    assert.match(r.error, /pickups is not a list/);
  });

  it('reports both problems when both lists are garbage', () => {
    const r = feed.parseReply(JSON.stringify({ pickups: 7, pickupsCancelled: 9 }));
    assert.match(r.error, /pickups is not a list/);
    assert.match(r.error, /pickupsCancelled is not a list/);
  });

  it('is silent about a reply that carries no withdrawals at all', () => {
    const r = feed.parseReply(JSON.stringify({ pickups: [PICKUP] }));
    assert.deepEqual(r.cancelled, []);
    assert.equal(r.error, undefined);
  });
});

describe('pickups round trip – withdrawals', () => {
  let t;
  const quiet = () => {};
  const cfg = { ...CFG, plannedDays: 0, timeoutMs: 200 };

  beforeEach(() => {
    t = tmpDb();
  });
  afterEach(() => {
    t.db.close();
    for (const s of ['', '-shm', '-wal']) fs.rmSync(t.path + s, { force: true });
  });

  /** Push once against a receiver answering with `body`, keeping what we sent. */
  async function push(body, sentBodies) {
    return feed.deliver({
      database: t.db,
      cfg,
      dbApi: db,
      log: quiet,
      deps: {
        fetch: async (_url, init) => {
          if (sentBodies) sentBodies.push(JSON.parse(init.body));
          return jsonReply({ ok: true, ...body });
        },
        sleep: async () => {}
      }
    });
  }

  it('a withdrawal removes the stored pickup', async () => {
    await push({ pickups: [PICKUP] });
    assert.equal(db.listPickups(t.db).length, 1);
    await push({ pickupsCancelled: [PICKUP.id] });
    assert.deepEqual(db.listPickups(t.db), [], 'the crate must stop being on the list');
  });

  it('a withdrawal for an id that never arrived does nothing and does not throw', async () => {
    // The ordinary case, not an error. The receiver reports a withdrawal
    // whether or not its earlier reply got through, because it cannot tell.
    await push({ pickups: [PICKUP] });
    const r = await push({ pickupsCancelled: ['p_never_seen_here'] });
    assert.equal(r.ok, true);
    assert.equal(db.listPickups(t.db).length, 1, 'the pickup that was here is untouched');
    assert.equal(db.listPickups(t.db)[0].id, PICKUP.id);
  });

  it('withdrawing twice is the same as withdrawing once', async () => {
    await push({ pickups: [PICKUP] });
    await push({ pickupsCancelled: [PICKUP.id] });
    const r = await push({ pickupsCancelled: [PICKUP.id] });
    assert.equal(r.ok, true);
    assert.equal(db.listPickups(t.db).length, 0);
    assert.equal(db.countPickups(t.db).withdrawn, 1, 'one withdrawal, however often it is repeated');
  });

  it('confirms a withdrawal through the same list a booking uses', async () => {
    const sent = [];
    await push({ pickups: [PICKUP] }, sent);
    await push({}, sent); // confirms the booking
    await push({ pickupsCancelled: [PICKUP.id] }, sent);
    await push({}, sent);
    assert.deepEqual(sent[3].pickupsDone, [PICKUP.id], 'the receiver stops repeating only once it hears this');
  });

  it('stops naming a withdrawal once the receiver has heard it', async () => {
    const sent = [];
    await push({ pickupsCancelled: [PICKUP.id] }, sent);
    await push({}, sent); // confirms the withdrawal
    await push({}, sent);
    assert.deepEqual(sent[1].pickupsDone, [PICKUP.id]);
    assert.equal(sent[2].pickupsDone, undefined);
    assert.equal(db.countPickups(t.db).unconfirmed, 0);
  });

  it('confirms a withdrawal for an id it never held, or the receiver repeats for ever', async () => {
    const sent = [];
    await push({ pickupsCancelled: ['p_never_seen_here'] }, sent);
    await push({}, sent);
    assert.deepEqual(sent[1].pickupsDone, ['p_never_seen_here']);
  });

  it('confirms nothing about a withdrawal when the push did not get through', async () => {
    await push({ pickupsCancelled: [PICKUP.id] });
    await feed.deliver({
      database: t.db,
      cfg,
      dbApi: db,
      log: quiet,
      deps: { fetch: async () => ({ ok: false, status: 503 }), sleep: async () => {} }
    });
    assert.deepEqual(db.unackedPickupIds(t.db), [PICKUP.id]);
  });

  it('takes bookings and withdrawals out of one and the same reply', async () => {
    await push({ pickups: [PICKUP, { ...PICKUP, id: 'p_second' }] });
    await push({ pickups: [{ ...PICKUP, id: 'p_third' }], pickupsCancelled: [PICKUP.id] });
    assert.deepEqual(
      db
        .listPickups(t.db)
        .map((r) => r.id)
        .sort(),
      ['p_second', 'p_third']
    );
  });

  it('lets the withdrawal win when one reply says both about the same id', async () => {
    // Packing a crate for a cancelled order costs produce; not packing one for
    // an order that is still live costs a phone call. The cheaper mistake wins.
    await push({ pickups: [PICKUP], pickupsCancelled: [PICKUP.id] });
    assert.deepEqual(db.listPickups(t.db), []);
  });

  it('a later booking reopens a withdrawn id, and clears the stale receipt', async () => {
    const sent = [];
    await push({ pickupsCancelled: [PICKUP.id] }, sent);
    await push({ pickups: [PICKUP] }, sent);
    assert.equal(db.listPickups(t.db).length, 1, 'the newest statement about an id is the one that holds');
    assert.equal(
      db.countPickups(t.db).withdrawn,
      0,
      'the receipt would otherwise confirm a withdrawal that was undone'
    );
  });

  it('a garbled withdrawal list costs neither the push nor the bookings beside it', async () => {
    const r = await feed.deliver({
      database: t.db,
      cfg,
      dbApi: db,
      log: quiet,
      deps: {
        fetch: async () => jsonReply({ ok: true, pickups: [PICKUP], pickupsCancelled: { nope: 1 } }),
        sleep: async () => {}
      }
    });
    assert.equal(r.ok, true);
    assert.equal(db.listPickups(t.db).length, 1);
  });

  it('a giant withdrawal list is capped rather than swallowed whole', async () => {
    await push({ pickups: [PICKUP] });
    const many = Array.from({ length: 5000 }, (_, i) => 'p_bulk_' + i);
    const r = await push({ pickupsCancelled: many });
    assert.equal(r.ok, true);
    assert.ok(db.countPickups(t.db).withdrawn <= feed.MAX_CANCELLED);
  });

  it('agrees with db.unackedPickupIds about what is still outstanding', async () => {
    // buildPayload runs its own SQL rather than calling the helper, so the two
    // can drift. They are twins by comment; this makes them twins by test.
    const sent = [];
    await push({ pickups: [PICKUP, { ...PICKUP, id: 'p_second' }] }, sent);
    // This one confirms both bookings and takes a withdrawal for an id that was
    // never here — so what is outstanding afterwards is a mixture of the two
    // tables, which is exactly where the two queries could disagree.
    await push({ pickupsCancelled: ['p_third_never_seen'] }, sent);

    const fromDb = db.unackedPickupIds(t.db).slice().sort();
    await push({}, sent);
    const fromPayload = (sent[2].pickupsDone || []).slice().sort();
    assert.deepEqual(fromPayload, fromDb);
    assert.deepEqual(fromDb, ['p_third_never_seen'], 'the bookings were confirmed by the push that carried them');
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
    // freshDays decides the date a release is stamped with, so the rest of this
    // block needs it fixed. Everything else here is the default config.
    db.updateHarvestFeedCfg(d, { freshDays: 3 });
  });
  after(() => {
    try {
      fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  });

  it('works on an untouched database, with nothing to switch on first', () => {
    // There used to be a mode gate here, and it was the reason a release could
    // be entered at the scale and silently go nowhere. Nothing stands between
    // the amount and the feed any more except the permission.
    const { db: frisch, path: frischPath } = tmpDb();
    try {
      const r = db.addHarvestRelease(frisch, { species: 'Oyster', grams: 100, actor: ADMIN }, NOW);
      assert.equal(r.grams, 100);
      assert.deepEqual(
        db.listHarvestReleases(frisch).map((x) => x.species),
        ['Oyster']
      );
    } finally {
      frisch.close();
      try {
        fs.unlinkSync(frischPath);
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
    const out = feed.buildPayload(d, CFG, NOW);
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
    db.updateHarvestFeedCfg(d, { freshDays: 3 });
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

// ── Saving the config: what an omitted field means ───────────────────────────
//
// The settings route builds one object out of the request body and the stored
// row, and two of its fields are not simply "take what was sent". `secret` has
// always been one: loading the form and pressing Save must not blank it, since
// the page never gets the stored value back to send.
//
// `packSizes` is the second, and it earns it the hard way. An empty list is a
// decision — with no sizes a shop takes no orders at all — so a client that has
// never heard of the field must not be able to make that decision by leaving it
// out. Anything that saved this config before the field existed, or a curl
// one-liner nudging the interval, would otherwise clear the sizes and take the
// order button off the shop with it.
//
// server.js starts a server on require, so the object is lifted out of the
// source and built on its own — the same approach test/setup-guard.test.js
// takes for the setup predicate.
describe('harvest feed config — what a save keeps', () => {
  let baueNext;
  before(() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const körper = src.match(/const next = \{[\s\S]*?\n {8}\};/);
    assert.ok(körper, 'the config object is gone from server.js — has the route been rewritten?');
    const clamp = src.match(/^function clampInt\(raw, min, max, fallback\) \{[\s\S]*?\n\}/m);
    assert.ok(clamp, 'clampInt is gone from server.js');
    const fn = new Function('data', 'current', 'harvestFeed', clamp[0] + '\n' + körper[0] + '\nreturn next;');
    baueNext = (data, current) => fn(data, current, feed);
  });

  const gespeichert = { secret: 'k', packSizes: [250, 500], site: '', url: 'https://r.test/x' };

  it('keeps the stored sizes when the body does not mention them', () => {
    assert.deepEqual(baueNext({ url: 'https://r.test/x' }, gespeichert).packSizes, [250, 500]);
  });

  it('clears them for a body that says so', () => {
    // The one way to end up with none, and it takes saying it.
    assert.deepEqual(baueNext({ packSizes: [] }, gespeichert).packSizes, []);
  });

  it('takes a new list as sent, canonical', () => {
    assert.deepEqual(baueNext({ packSizes: [1000, 250, 250] }, gespeichert).packSizes, [250, 1000]);
  });

  it('does the same for the secret, which is the older half of this rule', () => {
    assert.equal(baueNext({}, gespeichert).secret, 'k');
    assert.equal(baueNext({ secret: 'neu' }, gespeichert).secret, 'neu');
  });

  it('keeps the farm name short and on one line', () => {
    // It goes out in every payload and a receiver matches it literally, so a
    // newline pasted in from a spreadsheet is a different farm over there —
    // and nothing on this side would have said so.
    assert.equal(baueNext({ site: '  hof-nord\n ' }, gespeichert).site, 'hof-nord');
    assert.equal(baueNext({ site: 'hof\tnord' }, gespeichert).site, 'hof nord');
    assert.equal(baueNext({ site: 'x'.repeat(200) }, gespeichert).site.length, 64);
  });
});

// ── V1/V2/V5: Freigabe und Abholungen auf einem Schirm ───────────────────────
//
// Drei Befunde vom 2026-08-15, die alle auf derselben Seite landen: Die
// Freigabetabelle kannte die Vormerkungen nicht, die beiden Namen ließen sich
// nicht verbinden, und die Liste wuchs, bis sie die kommenden Termine verdeckte.
describe('pickups: what they say about a release', () => {
  let t;
  beforeEach(() => {
    t = tmpDb();
  });
  afterEach(() => {
    t.db.close();
    for (const s of ['', '-shm', '-wal']) fs.rmSync(t.path + s, { force: true });
  });

  const abholung = (id, tag, posten) => ({
    id,
    order: '#' + id,
    slot: 'w-' + tag,
    slotText: tag + ', 10–12 Uhr',
    place: 'Hofladen',
    from: tag + 'T10:00',
    to: tag + 'T12:00',
    zone: 'Europe/Berlin',
    items: posten
  });

  const tagVersetzt = (tage) => {
    const d = new Date();
    d.setDate(d.getDate() + tage);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  it('lets the lab name through the reply boundary', () => {
    // ⚠️ **Durch parseReply und nicht an ihm vorbei.** Genau dort steht die
    // Erlaubnisliste, die jede Position neu aufbaut — ein Feld, das dort nicht
    // genannt ist, kommt nie in der Datenbank an. Ein Test, der storePickup
    // direkt ruft, prüft diese Grenze nicht und bleibt auch dann grün, wenn sie
    // das Feld verschluckt.
    const r = feed.parseReply(
      JSON.stringify({
        ok: true,
        pickups: [{ ...PICKUP, items: [{ kind: 'Igelstachelbart', species: 'Lion (LM)', grams: 800 }] }]
      })
    );
    assert.deepEqual(r.pickups[0].items, [{ kind: 'Igelstachelbart', species: 'Lion (LM)', grams: 800 }]);
  });

  it('stores a position without the lab name as it always did', () => {
    // Additiv: Ein Empfänger, der älter ist als das Feld, ist nicht falsch.
    const r = feed.parseReply(
      JSON.stringify({ ok: true, pickups: [{ ...PICKUP, items: [{ kind: 'Austernpilz', grams: 500 }] }] })
    );
    assert.deepEqual(r.pickups[0].items, [{ kind: 'Austernpilz', grams: 500 }]);
  });

  it('adds up what is promised, per species', () => {
    db.storePickup(
      t.db,
      abholung('a1', tagVersetzt(1), [{ kind: 'Igelstachelbart', species: 'Lion (LM)', grams: 800 }])
    );
    db.storePickup(
      t.db,
      abholung('a2', tagVersetzt(4), [{ kind: 'Igelstachelbart', species: 'Lion (LM)', grams: 500 }])
    );
    db.storePickup(t.db, abholung('a3', tagVersetzt(2), [{ kind: 'Austernpilz', species: 'Oyster (OY)', grams: 250 }]));
    const { bySpecies, unattributed } = db.pickupGramsBySpecies(t.db);
    assert.deepEqual(bySpecies, { 'Lion (LM)': 1300, 'Oyster (OY)': 250 });
    assert.equal(unattributed, 0);
  });

  it('stops counting a pickup whose day has passed', () => {
    db.storePickup(
      t.db,
      abholung('alt', tagVersetzt(-3), [{ kind: 'Igelstachelbart', species: 'Lion (LM)', grams: 800 }])
    );
    assert.deepEqual(db.pickupGramsBySpecies(t.db).bySpecies, {});
  });

  it('reports a line it cannot attribute instead of dropping it', () => {
    // Zu wenig „vorgemerkt" heißt zu viel „frei", und das ist die Richtung, die
    // Ware kostet. Betrifft Abholungen von vor dem 2026-08-15.
    db.storePickup(t.db, abholung('alt', tagVersetzt(1), [{ kind: 'Igelstachelbart', grams: 300 }]));
    const { bySpecies, unattributed } = db.pickupGramsBySpecies(t.db);
    assert.deepEqual(bySpecies, {});
    assert.equal(unattributed, 300);
  });
});

describe('pickups: the list stops burying next week under last year', () => {
  let t;
  beforeEach(() => {
    t = tmpDb();
  });
  afterEach(() => {
    t.db.close();
    for (const s of ['', '-shm', '-wal']) fs.rmSync(t.path + s, { force: true });
  });

  const tagVersetzt = (tage) => {
    const d = new Date();
    d.setDate(d.getDate() + tage);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const abholung = (id, tag) => ({
    id,
    order: '#' + id,
    slot: 'w-' + id,
    from: tag + 'T10:00',
    to: tag + 'T12:00',
    zone: 'Europe/Berlin',
    items: [{ kind: 'Austernpilz', species: 'Oyster (OY)', grams: 500 }]
  });

  it('shows next week even behind 250 finished collections', () => {
    // ⚠️ Genau der gemessene Fall: Bei 251 Zeilen endete die Seite im Juli 2025
    // und der Termin für nächste Woche stand gar nicht mehr darauf.
    for (let i = 1; i <= 250; i++) db.storePickup(t.db, abholung('alt-' + i, tagVersetzt(-i)));
    db.storePickup(t.db, abholung('NEU', tagVersetzt(7)));
    const offen = db.listPickups(t.db);
    assert.equal(offen.length, 1, 'nur das, was noch aussteht');
    assert.equal(offen[0].id, 'NEU');
  });

  it('keeps the finished ones reachable, newest first', () => {
    for (let i = 1; i <= 3; i++) db.storePickup(t.db, abholung('alt-' + i, tagVersetzt(-i)));
    const vorbei = db.listPickups(t.db, { past: true });
    assert.equal(vorbei.length, 3);
    assert.equal(vorbei[0].id, 'alt-1', 'der jüngste vergangene zuerst');
  });

  it('treats a pickup with no time at all as still upcoming', () => {
    // Sie lässt sich nicht als vorbei nachweisen, und „nicht nachweisbar vorbei"
    // gehört auf die Seite mit der Arbeit.
    db.storePickup(t.db, { id: 'ohne-zeit', order: '#9', items: [{ kind: 'Austernpilz', grams: 100 }] });
    assert.equal(db.listPickups(t.db).length, 1);
    assert.equal(db.listPickups(t.db, { past: true }).length, 0);
  });

  it('prunes long-finished collections, but only once they are acknowledged', () => {
    // ⚠️ Eine unquittierte Zeile wird noch in jeder Antwort wiederholt — sie
    // hier zu löschen, hieße, dass beide Seiten auseinanderlaufen und nichts
    // mehr sie zusammenbringt.
    db.storePickup(t.db, abholung('quittiert', tagVersetzt(-200)));
    db.storePickup(t.db, abholung('offen', tagVersetzt(-200)));
    db.storePickup(t.db, abholung('neulich', tagVersetzt(-2)));
    db.ackPickups(t.db, ['quittiert', 'neulich']);
    assert.equal(db.prunePickups(t.db, { days: 90 }), 1);
    const uebrig = db
      .listPickups(t.db, { past: true })
      .map((p) => p.id)
      .sort();
    assert.deepEqual(uebrig, ['neulich', 'offen']);
  });
});

describe('the immediate push shares the timer guard', () => {
  let t;
  beforeEach(() => {
    t = tmpDb();
  });
  afterEach(() => {
    t.db.close();
    for (const s of ['', '-shm', '-wal']) fs.rmSync(t.path + s, { force: true });
  });

  const quiet = () => {};
  const umgebung = {
    HARVEST_WEBHOOK_URL: 'https://receiver.test/ernte',
    HARVEST_WEBHOOK_SECRET: 'geheim',
    HARVEST_WEBHOOK_PLANNED_DAYS: '0'
  };

  it('does not start a second push while one is in the air', async () => {
    // ⚠️ **The reason pushNow() exists instead of a deliver() call.** Two pushes
    // in the air share a unix-second timestamp, the receiver's replay guard
    // rejects the second, and note() writes that 409 down as a failed push — so
    // a delivery that worked would leave "the shop has not heard this" on the
    // Pickups page. That display exists to be right about exactly this.
    let laufend = 0;
    let gleichzeitig = 0;
    let loesen;
    const haengt = new Promise((f) => {
      loesen = f;
    });
    const deps = {
      fetch: async () => {
        laufend++;
        gleichzeitig = Math.max(gleichzeitig, laufend);
        await haengt;
        laufend--;
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
      },
      sleep: async () => {}
    };

    const erste = feed.pushNow({ database: t.db, env: umgebung, log: quiet, dbApi: db, deps });
    // Die zweite kommt, während die erste noch am Draht hängt.
    const zweite = await feed.pushNow({ database: t.db, env: umgebung, log: quiet, dbApi: db, deps });
    assert.equal(zweite, 'busy', 'die zweite Sendung wird gefaltet, nicht gestartet');
    loesen();
    assert.equal(await erste, 'sent');
    assert.equal(gleichzeitig, 1, 'nie zwei Sendungen gleichzeitig am Draht');
  });

  it('frees the guard again afterwards, even when the push fails', async () => {
    // Sonst wäre eine einzige gescheiterte Sofort-Sendung das Ende des Feeds:
    // Der Takt prüft dieselbe Sperre.
    const kaputt = { fetch: async () => ({ ok: false, status: 500, text: async () => '' }), sleep: async () => {} };
    await feed.pushNow({ database: t.db, env: umgebung, log: quiet, dbApi: db, deps: kaputt });
    const gut = {
      fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) }),
      sleep: async () => {}
    };
    assert.equal(await feed.pushNow({ database: t.db, env: umgebung, log: quiet, dbApi: db, deps: gut }), 'sent');
  });

  it('says nothing and does nothing when the feed is off', async () => {
    assert.equal(await feed.pushNow({ database: t.db, env: {}, log: quiet, dbApi: db }), 'off');
  });

  it('stays out of the way in worktree mode', async () => {
    assert.equal(await feed.pushNow({ database: t.db, env: umgebung, log: quiet, dbApi: db, skip: true }), 'skipped');
  });
});
