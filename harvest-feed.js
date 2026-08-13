'use strict';
// Outbound harvest feed — push a summary of what has been harvested and what is
// coming to a URL you configure. One direction only: this module opens
// connections, it never accepts any.
//
// Why a lab might want this: the harvest numbers already live here, and the
// places that need them (your own website, a CSA/box scheme, a co-op listing, a
// chat bot answering "what do you have today?") are somewhere else. Copying them
// by hand goes stale within a day. Pointing those systems at this server instead
// would mean exposing the lab machine to the internet — the wrong trade for a
// handful of numbers.
//
//     lab machine  ──POST(signed)──▶  whatever you run  ──▶  customers
//
// Nothing reaches back. If this machine is off, the receiver keeps the last
// payload it got; its consumers see older numbers instead of an outage.
//
// ── What leaves the building ─────────────────────────────────────────────────
//
// Species, optionally strain, gram totals, and dates. No batch ids, no bag ids,
// no customers, no scan history, no notes. The payload is small on purpose:
// anything that leaves is something you have to reason about, and a summary is
// far easier to reason about than a dump.
//
// ── What this module deliberately does NOT do ────────────────────────────────
//
// It does not estimate yields. Planned entries carry a species and a date, never
// an amount: how much a block will actually give varies too much between flushes
// to put a number on it, and a number that arrives at a customer becomes a
// promise. Recorded harvests are measured, so those carry grams.
//
// It does not subtract reservations. A lab that has promised half its Thursday
// harvest to a restaurant should publish the remainder, not the total — but what
// counts as promised is a business rule that differs per lab and is not tracked
// here. Do that subtraction in the receiving system, where the commitments live.
//
// ── Configuration ────────────────────────────────────────────────────────────
//
// Normally: Settings → Harvest feed, in the browser. That writes one row and
// restarts the timer; nothing needs a shell or a restart of the server.
//
// The environment variables below still work and are the fallback whenever the
// stored config is off. They exist for installs where the configuration is baked
// into an image or handled by whatever starts the process — there, a value that
// can be changed through the web UI is the wrong shape.
//
// One place wins at a time, and which one is visible in Settings. Splitting a
// single setting across two sources is how you end up with a feed pointing
// somewhere nobody can find.
//
//   HARVEST_WEBHOOK_URL           where to POST. Required — unset means off.
//   HARVEST_WEBHOOK_SECRET        HMAC key. Required; see "Signature" below.
//   HARVEST_WEBHOOK_INTERVAL_MIN  how often, in minutes (default 15, min 1).
//   HARVEST_WEBHOOK_FRESH_DAYS    how far back a harvest still counts as
//                                 available (default 3). Fresh produce; set it
//                                 to what your product actually keeps.
//   HARVEST_WEBHOOK_PLANNED_DAYS  how far ahead to report upcoming batches
//                                 (default 28). 0 turns the planned block off.
//   HARVEST_WEBHOOK_LEAD_DAYS     days between a batch's due date (end of
//                                 incubation) and the first expected flush
//                                 (default 0). Species-dependent; yours is
//                                 whatever your records show.
//   HARVEST_WEBHOOK_STRAIN        1 (default) includes strain names, 0 sends
//                                 only the species.
//   HARVEST_WEBHOOK_SITE          free-form label, passed through untouched.
//                                 Useful when several sites post to one
//                                 receiver.
//   HARVEST_WEBHOOK_TIMEOUT_MS    per attempt (default 15000).
//
// ── Signature ────────────────────────────────────────────────────────────────
//
// Every request carries:
//
//   X-Meistertracker-Timestamp: <unix seconds>
//   X-Meistertracker-Signature: sha256=<hex>
//
// where the hex is HMAC-SHA256 over `${timestamp}.${body}` using the shared
// secret. Signing the timestamp *with* the body is what makes a captured request
// useless later: the receiver rejects anything older than its own tolerance, and
// the timestamp cannot be edited without breaking the signature. Same
// construction as this server's own GitHub webhook check, in the other
// direction.
//
// The secret is not optional. An unsigned feed is one anyone can forge, and a
// forged "we have 40 kg" is worse than no feed at all.

const crypto = require('crypto');

// Guard against a hung POST stacking up behind a short interval. One in flight
// at a time; a skipped tick is harmless because the next one carries the same
// (or fresher) numbers — this is a snapshot, not an event log.
let inFlight = false;
let timer = null;

// Fassung 1 carries `harvested`, and a receiver is free to publish it. Fassung 2
// says a `released` list is present and that it, not `harvested`, is what may be
// offered for sale. Ignoring that difference means publishing produce the grower
// deliberately kept back, so it is a version bump and not a new optional field —
// and it is only sent when release mode is actually on, so receivers of labs
// that do not use it never see a version they were not built for.
const VERSION = 1;
const VERSION_RELEASE = 2;
const ATTEMPTS = 3;

/**
 * The URL check, shared by both config sources.
 *
 * Plain HTTP would put the payload and the signature on the wire in clear.
 * Loopback stays allowed so the thing can be tried out against a local receiver
 * before a certificate exists.
 */
function checkUrl(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(label + ' is not a URL: ' + url);
  }
  // Credentials in the URL would be copied into the config row and, from there,
  // into every "Harvest feed started" log line. The secret is deliberately kept
  // out of the logs; a password smuggled in via the URL would walk straight
  // back in. The receiver authenticates the HMAC, so it never needs these.
  if (parsed.username || parsed.password)
    throw new Error(label + ' must not carry credentials in the URL — the feed authenticates with the shared secret');
  // URL.hostname keeps the brackets on an IPv6 literal ('[::1]', not '::1'), so
  // comparing against the bare form never matched and http://[::1]:PORT/ was
  // rejected as "not https" — the one loopback address this is meant to allow.
  const host = parsed.hostname;
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
    throw new Error(label + ' must be https (http is allowed for localhost only): ' + url);
}

/** Read config from an env-like object. Returns null when the feed is off. */
function readConfig(env) {
  const url = String(env.HARVEST_WEBHOOK_URL || '').trim();
  if (!url) return null;

  const secret = String(env.HARVEST_WEBHOOK_SECRET || '').trim();
  if (!secret)
    throw new Error('HARVEST_WEBHOOK_URL is set but HARVEST_WEBHOOK_SECRET is not — refusing to send unsigned');

  checkUrl(url, 'HARVEST_WEBHOOK_URL');

  return {
    url,
    secret,
    intervalMs: Math.max(1, num(env.HARVEST_WEBHOOK_INTERVAL_MIN, 15)) * 60 * 1000,
    freshDays: Math.max(0, num(env.HARVEST_WEBHOOK_FRESH_DAYS, 3)),
    plannedDays: Math.max(0, num(env.HARVEST_WEBHOOK_PLANNED_DAYS, 28)),
    leadDays: Math.max(0, num(env.HARVEST_WEBHOOK_LEAD_DAYS, 0)),
    // Strain names are a competitive detail for some labs and the whole point of
    // the listing for others ("Blue oyster" is not "oyster"). Default on,
    // because a receiver can always drop a field it does not want, while it
    // cannot invent one it never got.
    strain: String(env.HARVEST_WEBHOOK_STRAIN ?? '1') !== '0',
    site: String(env.HARVEST_WEBHOOK_SITE || '').trim(),
    // Default off. On, the feed reports only what has been explicitly released
    // for sale — which is nothing at all until someone enters the first amount.
    // A silent switch to "nothing available" on upgrade would be worse than the
    // problem it solves.
    releaseMode: String(env.HARVEST_WEBHOOK_RELEASE_MODE || '0') === '1',
    timeoutMs: Math.max(1000, num(env.HARVEST_WEBHOOK_TIMEOUT_MS, 15000)),
    source: 'env'
  };
}

/** Turn a stored row (db.getHarvestFeedCfg) into the same shape. */
function storedConfig(row) {
  if (!row || !row.enabled) return null;
  const url = String(row.url || '').trim();
  if (!url) throw new Error('Harvest feed is enabled but no URL is set');
  const secret = String(row.secret || '').trim();
  if (!secret) throw new Error('Harvest feed is enabled but no secret is set — refusing to send unsigned');
  checkUrl(url, 'Harvest feed URL');

  return {
    url,
    secret,
    intervalMs: Math.max(1, Number(row.intervalMin) || 15) * 60 * 1000,
    freshDays: Math.max(0, Number(row.freshDays) || 0),
    plannedDays: Math.max(0, Number(row.plannedDays) || 0),
    leadDays: Math.max(0, Number(row.leadDays) || 0),
    strain: row.strain !== false,
    site: String(row.site || '').trim(),
    releaseMode: row.releaseMode === true,
    timeoutMs: 15000,
    source: 'db'
  };
}

/**
 * Which config actually applies.
 *
 * Stored config wins when it is on, environment otherwise. Not merged: a URL
 * from one place and a secret from the other is a configuration nobody can read
 * off a single screen, and the failure mode is a feed posting to a stale
 * receiver with nothing in the UI to explain it.
 */
function resolveConfig({ database, env, dbApi }) {
  if (database && dbApi && typeof dbApi.getHarvestFeedCfg === 'function') {
    const fromDb = storedConfig(dbApi.getHarvestFeedCfg(database));
    if (fromDb) return fromDb;
  }
  return readConfig(env || process.env);
}

function num(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** YYYY-MM-DD, `days` away from `from`. Dates only — no clock, no timezone. */
function shiftDate(from, days) {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Today, in the machine's own timezone. Twin of localDay() in db.js.
 *
 * Deliberately not the UTC day the window arithmetic above uses. A window that
 * ends two hours early costs nothing; a release does not expire until the end of
 * the day someone typed, and east of Greenwich the UTC day ends first — "valid
 * until Saturday" would keep selling into Sunday morning. The direction of the
 * error is what decides this, not tidiness.
 */
function localDay(at) {
  const p = (n) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
}

/**
 * The payload, built straight from the database.
 *
 * Split in two on purpose, and the two halves mean different things:
 *
 *   harvested — weighed and recorded. A number you can sell against.
 *   planned   — a batch whose incubation ends soon. A hint, with no amount.
 *
 * Anything that blurs the two ends up promising produce that does not exist yet.
 */
function buildPayload(database, cfg, now) {
  const at = now || new Date();
  const since = shiftDate(at, -cfg.freshDays) + 'T00:00:00';

  // Aggregate in SQL rather than pulling every harvest row into JS: on a server
  // with years of records that is the difference between a few rows and all of
  // them, every interval.
  const harvested = database
    .prepare(
      `SELECT species, strain, SUM(grams) AS grams, MAX(time) AS last
         FROM harvests
        WHERE time >= ? AND species IS NOT NULL AND species <> ''
        GROUP BY species, strain
        HAVING SUM(grams) > 0
        ORDER BY species, strain`
    )
    .all(since)
    .map((r) =>
      trim({
        species: r.species,
        strain: cfg.strain ? r.strain || null : null,
        grams: Math.round(r.grams),
        lastHarvest: r.last || null
      })
    );

  const planned = [];
  if (cfg.plannedDays > 0) {
    const today = at.toISOString().slice(0, 10);
    // `due` is the end of incubation, not the harvest — hence leadDays. Compare
    // against the un-shifted window and shift the reported date, so a lead time
    // never silently widens how far ahead we look.
    const until = shiftDate(at, cfg.plannedDays);
    // ⚠️ `date(b.due)`, not `b.due`. The column holds a full timestamp — it is
    // written with toISOString() — so `b.due + 'T00:00:00Z'` produced
    // "2026-08-05T14:23:11.123ZT00:00:00Z", an invalid Date, and the
    // toISOString() below threw "Invalid time value". That took the *whole*
    // payload down: one planned batch and the harvested half never left either.
    //
    // Normalising in SQL fixes two things at once. Rows whose date cannot be
    // read yield NULL and drop out instead of throwing, and `BETWEEN` on a
    // plain date stops cutting the last day short — a timestamp on the final
    // day sorts after the bare date and was silently excluded.
    // GROUP BY, because one entry per batch is a different statement than one
    // entry per offer. Four blocks of the same species due the same day used to
    // produce four identical entries, so anyone reading the feed could count
    // batches — and this feed deliberately reports no amounts at all. It is a
    // cadence signal rather than a volume one (batch sizes differ severalfold),
    // but it is still a number nobody meant to publish, and on the receiving
    // end it lists the same offer four times.
    //
    // `harvested` already draws this line: one entry per species, on the
    // grounds that splitting by batch would "split one offer in two".
    const rows = database
      .prepare(
        `SELECT b.species, b.strain, date(b.due) AS due_date
           FROM batches b
          WHERE b.batch_type = 'block'
            AND date(b.due) BETWEEN ? AND ?
            AND b.species IS NOT NULL AND b.species <> ''
            AND EXISTS (SELECT 1 FROM bags g WHERE g.batch_id = b.batch_id)
            AND NOT EXISTS (SELECT 1 FROM harvests h WHERE h.batch = b.batch_id)
          GROUP BY b.species, b.strain, date(b.due)
          ORDER BY date(b.due), b.species`
      )
      .all(today, until);
    const seen = new Set();
    for (const r of rows) {
      // Belt and braces: date() already filtered the unreadable ones, and a
      // single bad row must never cost the whole feed.
      const tag = new Date(r.due_date + 'T00:00:00Z');
      if (Number.isNaN(tag.getTime())) continue;
      const entry = trim({
        species: r.species,
        strain: cfg.strain ? r.strain || null : null,
        expectedFrom: shiftDate(tag, cfg.leadDays)
      });
      // The SQL grouping is not enough on its own: with strain names switched
      // off, two strains of one species collapse into the same entry only after
      // the name is dropped here. Dedupe on what actually goes out.
      const key = JSON.stringify(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      planned.push(entry);
    }
  }

  const payload = {
    version: cfg.releaseMode ? VERSION_RELEASE : VERSION,
    generatedAt: at.toISOString(),
    freshDays: cfg.freshDays,
    harvested,
    planned
  };

  if (cfg.releaseMode) {
    // A separate list, not a field on `harvested`. The two answer different
    // questions — what came off the racks, and what may be sold — and only the
    // first is production data. Keeping them apart also lets a release outlive
    // its harvest window: set two kilos aside on Monday for a Saturday market
    // and by Thursday the harvest has aged out of `freshDays`, while the crate
    // is still standing there. The human who put it there is the better source.
    payload.released = database
      .prepare(
        `SELECT species, grams, valid_until AS validUntil
           FROM harvest_release
          WHERE grams > 0 AND (valid_until IS NULL OR valid_until >= ?)
          ORDER BY species`
      )
      .all(localDay(at))
      .map((r) => trim({ species: r.species, grams: Math.round(r.grams), validUntil: r.validUntil || null }));
  }

  if (cfg.site) payload.site = cfg.site;
  return payload;
}

/** Drop null fields so the receiver never has to distinguish absent from null. */
function trim(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

/** `sha256=<hex>` over `${timestamp}.${body}` — see "Signature" up top. */
function sign(secret, timestamp, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * POST once, with retries. Resolves to {ok, status, attempts}; never throws —
 * a feed that crashes the timer it runs on takes the whole feature down until
 * the next restart.
 */
async function post(cfg, payload, deps) {
  const doFetch = (deps && deps.fetch) || globalThis.fetch;
  const sleep = (deps && deps.sleep) || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const body = JSON.stringify(payload);
  let last = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    // A fresh timestamp per attempt: a retry after a 30 s backoff must not
    // arrive already outside the receiver's replay window.
    const timestamp = Math.floor(Date.now() / 1000);
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await doFetch(cfg.url, {
        method: 'POST',
        // The receiver does not get to choose where the report actually lands.
        // Without this, fetch defaults to `follow`: a 308 from the receiver
        // re-sends the POST — body and X-Meistertracker-Signature intact, since
        // only Authorization/Cookie are stripped on an origin change — to
        // whatever host Location names, plain-HTTP hosts on the LAN included.
        // checkUrl only ever runs when the config is saved, so a redirect
        // target is a target nobody vetted. "Push-only, and to exactly the
        // configured address" is the promise; following a hop breaks it.
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'meistertracker-harvest-feed/' + VERSION,
          'X-Meistertracker-Timestamp': String(timestamp),
          'X-Meistertracker-Signature': sign(cfg.secret, timestamp, body)
        },
        body,
        signal: controller.signal
      });
      if (res.ok) return { ok: true, status: res.status, attempts: attempt };
      // With redirect:'manual' a 3xx arrives here instead of being chased.
      // Retrying cannot help — the receiver is pointing somewhere else and will
      // keep doing so — and each retry is another copy of the payload aimed at
      // an unvetted URL. Stop, and say what to fix.
      if (res.status >= 300 && res.status < 400) {
        return {
          ok: false,
          error: 'HTTP ' + res.status + ' redirect refused — set the feed URL to the receiver’s final address',
          attempts: attempt
        };
      }
      last = 'HTTP ' + res.status;
      // 4xx means the receiver understood us and said no — a bad secret, a
      // wrong path, a payload it rejects. Retrying hammers it without ever
      // changing the outcome. 408 and 429 are the two that do pass with time.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)
        return { ok: false, error: last, attempts: attempt };
    } catch (e) {
      last = e.name === 'AbortError' ? `timeout after ${cfg.timeoutMs} ms` : e.message;
    } finally {
      clearTimeout(abort);
    }
    if (attempt < ATTEMPTS) await sleep(attempt * 5000);
  }
  return { ok: false, error: last, attempts: ATTEMPTS };
}

/** Build and send once. Returns the same shape as post(), plus the payload. */
async function sendOnce(database, cfg, deps) {
  const payload = buildPayload(database, cfg, deps && deps.now);
  const result = await post(cfg, payload, deps);
  return { ...result, payload };
}

/**
 * Start the timer. Safe to call when the feature is off (no URL) — it says so
 * once and does nothing. Returns true when a timer is running.
 *
 * `skip` exists for the same reason the DuckDNS updater has one: a worktree or
 * staging copy usually inherits the production .env, and two servers posting
 * contradictory snapshots to one receiver is worse than one posting none.
 */
function start({ database, env, log, skip, dbApi }) {
  stop();
  let cfg;
  try {
    cfg = resolveConfig({ database, env, dbApi });
  } catch (e) {
    log('error', 'Harvest feed misconfigured — not started', { error: e.message });
    return false;
  }
  if (!cfg) return false;
  if (skip) {
    log('info', 'Harvest feed skipped', { reason: 'worktree mode' });
    return false;
  }

  // Write the outcome where Settings can show it. A log line only helps someone
  // who already suspects a problem; "last delivery: 3 days ago" on the screen is
  // what makes a feed that quietly stopped visible at all.
  const note = (ok, error) => {
    if (!database || !dbApi || typeof dbApi.updateHarvestFeedStatus !== 'function') return;
    try {
      dbApi.updateHarvestFeedStatus(database, { at: new Date().toISOString(), ok, error });
    } catch {
      // Recording the outcome must never take the timer down with it.
    }
  };

  const tick = async () => {
    if (inFlight) {
      log('warn', 'Harvest feed still sending — tick skipped');
      return;
    }
    inFlight = true;
    try {
      const r = await sendOnce(database, cfg);
      if (r.ok)
        log('info', 'Harvest feed sent', {
          harvested: r.payload.harvested.length,
          planned: r.payload.planned.length,
          attempts: r.attempts
        });
      else log('warn', 'Harvest feed failed', { error: r.error, attempts: r.attempts });
      note(r.ok, r.error);
    } catch (e) {
      // buildPayload can throw if the schema is mid-migration. Log, keep the
      // timer.
      log('error', 'Harvest feed error', { error: e.message });
      note(false, e.message);
    } finally {
      inFlight = false;
    }
  };

  timer = setInterval(tick, cfg.intervalMs);
  if (timer.unref) timer.unref();
  // The URL is logged, the secret never is.
  log('info', 'Harvest feed started', { url: cfg.url, everyMin: cfg.intervalMs / 60000 });
  tick();
  return true;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * May this harvest carry the release it claims? `null` if it may, a reason if not.
 *
 * Pure, and that is the point: the two guards here are the ones the field exists
 * to protect — a slipped comma, and a release with no species to key it to — and
 * this repo has no HTTP-level harness that could pin them inside a route handler.
 * Inverting either comparison would otherwise stay green.
 *
 * `fatal` says which side of the harvest the answer falls on, because the two are
 * not the same kind of wrong. More released than weighed is a bad request and the
 * harvest never happened. A missing species is reported *next to* a stored
 * harvest: a weighed harvest is a fact either way, and losing it to a quibble
 * about the release would be the worse trade.
 */
function releaseProblem({ release, grams, species }) {
  if (!(Number(release) > 0)) return null;
  if (Number(release) > Number(grams)) return { reason: 'release must be <= grams', fatal: true };
  if (!species) return { reason: 'species required to release', fatal: false };
  return null;
}

module.exports = {
  readConfig,
  storedConfig,
  resolveConfig,
  buildPayload,
  releaseProblem,
  sign,
  post,
  sendOnce,
  start,
  stop,
  VERSION,
  VERSION_RELEASE
};

// ── CLI ──────────────────────────────────────────────────────────────────────
// `node harvest-feed.js --dry-run` prints exactly what would be posted, without
// posting it. That is the answer to "is this thing going to leak something?" —
// look at it before you turn it on.
//
//     node harvest-feed.js --dry-run     # print the payload, send nothing
//     node harvest-feed.js --once        # build, sign, POST, print the result
//     node harvest-feed.js --dry-run --db /path/to/other.db
if (require.main === module) {
  const path = require('path');
  const fs = require('fs');
  const db = require('./db.js');

  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  }

  const dry = process.argv.includes('--dry-run');
  if (!dry && !process.argv.includes('--once')) {
    console.error('usage: node harvest-feed.js [--dry-run | --once] [--db <path>]');
    process.exit(2);
  }
  // `--db` so a dry run can be aimed at a copy — reviewing what would leave the
  // building is exactly the moment you do not want to touch the live file.
  const dbFlag = process.argv.indexOf('--db');
  const dbPath =
    dbFlag !== -1 && process.argv[dbFlag + 1] ? process.argv[dbFlag + 1] : path.join(__dirname, 'meistertracker.db');

  let cfg;
  try {
    cfg = readConfig(process.env);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (!cfg) {
    // A dry run should work before anything is configured — that is when you
    // most want to see the payload.
    if (!dry) {
      console.error('HARVEST_WEBHOOK_URL is not set — nothing to send.');
      process.exit(2);
    }
    cfg = { freshDays: 3, plannedDays: 28, leadDays: 0, strain: true, site: '' };
  }

  const database = db.openDb(dbPath);
  if (dry) {
    console.log(JSON.stringify(buildPayload(database, cfg), null, 2));
    process.exit(0);
  }
  sendOnce(database, cfg).then((r) => {
    console.log(JSON.stringify(r.payload, null, 2));
    console.log(r.ok ? `\nOK (HTTP ${r.status}, ${r.attempts} attempt(s))` : `\nFAILED: ${r.error}`);
    process.exit(r.ok ? 0 : 1);
  });
}
