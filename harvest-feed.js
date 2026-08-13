'use strict';
// Outbound harvest feed — push a summary of what has been harvested and what is
// coming to a URL you configure. This module opens connections; it never accepts
// any. No inbound endpoint, no open port, no certificate on this side.
//
// Why a lab might want this: the harvest numbers already live here, and the
// places that need them (your own website, a CSA/box scheme, a co-op listing, a
// chat bot answering "what do you have today?") are somewhere else. Copying them
// by hand goes stale within a day. Pointing those systems at this server instead
// would mean exposing the lab machine to the internet — the wrong trade for a
// handful of numbers.
//
//     lab machine  ──POST(signed)──▶  whatever you run  ──▶  customers
//                  ◀──── reply ─────
//
// If this machine is off, the receiver keeps the last payload it got; its
// consumers see older numbers instead of an outage.
//
// ── What comes back ──────────────────────────────────────────────────────────
//
// The reply to that POST, and nothing else. It may carry `pickups` — collection
// slots the receiver has taken bookings for — which are stored here and shown
// on the Pickups page. Note what this does and does not change:
//
//   still true   nothing can reach this machine unbidden. There is no listener,
//                no port and no route in; the reply exists only because this
//                side asked a question and is still holding the socket open.
//   now false    "nothing comes back". Data from the far end does reach the
//                database, which makes the reply a trust boundary — see "The
//                reply" further down for what that costs and what it buys.
//
// A push is finished the moment the receiver answers 2xx. Whatever is in the
// body is a second, separate question, and a bad answer to it never turns a
// delivered payload into a failed one.
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
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
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
    const rows = database
      .prepare(
        `SELECT b.batch_id, b.species, b.strain, date(b.due) AS due_date
           FROM batches b
          WHERE b.batch_type = 'block'
            AND date(b.due) BETWEEN ? AND ?
            AND b.species IS NOT NULL AND b.species <> ''
            AND EXISTS (SELECT 1 FROM bags g WHERE g.batch_id = b.batch_id)
            AND NOT EXISTS (SELECT 1 FROM harvests h WHERE h.batch = b.batch_id)
          ORDER BY date(b.due), b.species`
      )
      .all(today, until);
    for (const r of rows) {
      // Belt and braces: date() already filtered the unreadable ones, and a
      // single bad row must never cost the whole feed.
      const tag = new Date(r.due_date + 'T00:00:00Z');
      if (Number.isNaN(tag.getTime())) continue;
      planned.push(
        trim({
          species: r.species,
          strain: cfg.strain ? r.strain || null : null,
          expectedFrom: shiftDate(tag, cfg.leadDays)
        })
      );
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

  // The ids we hold and have not confirmed yet, so the receiver can stop
  // repeating them. Omitted entirely when there is nothing to confirm: a
  // receiver that knows nothing about pickups should never see the field, and
  // an empty array is a claim ("I have none") where absence is silence.
  //
  // Sending is not confirming. These are marked as confirmed only after a push
  // carrying them actually succeeded — see acknowledge() in start().
  try {
    const done = database
      .prepare('SELECT id FROM pickups WHERE acked_at IS NULL ORDER BY received LIMIT ?')
      .all(MAX_ACK_PER_PUSH)
      .map((r) => r.id);
    if (done.length) payload.pickupsDone = done;
  } catch {
    // No pickups table yet — a database mid-migration, or one this feature has
    // never run against. The harvest numbers are the point of this payload and
    // they must still go out.
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

// ── The reply ────────────────────────────────────────────────────────────────
//
// Everything above this line goes out. What follows comes back, and it is the
// only place in this program where data from the far end travels towards the
// lab machine — so it is treated as hostile until every field has proven
// otherwise. Four rules, in order of how much they save you:
//
//   1. A push that got a 2xx has succeeded. What is in the body is a second and
//      separate question, and no answer to it may turn a delivered payload into
//      a failed one. The numbers are out; that was the job.
//   2. The body is capped *before* it is read, not measured after. A receiver
//      that answers with a gigabyte should cost a few kilobytes and a log line.
//   3. Anything not named below is dropped — not stored-and-ignored, dropped.
//   4. Every length and every count is bounded, because "the receiver would not
//      do that" is not a property of a network.

const REPLY_MAX_BYTES = 64 * 1024;
const MAX_PICKUPS = 200;
const MAX_ITEMS_PER_PICKUP = 50;
// How many confirmations ride along on one push. A backlog larger than this
// drains over the following ticks rather than inflating a single request.
const MAX_ACK_PER_PUSH = 500;
// The receiver assigns these. Narrow on purpose: an id is a key, not a label,
// and this covers what a key needs while leaving nothing to escape into.
const ID_RE = /^[A-Za-z0-9_.:@#/+-]{1,128}$/;
// Local wall-clock — no offset, no Z. The zone travels in its own field, and a
// value that looks like an instant would invite exactly the conversion that
// must not happen.
const LOCAL_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
// "Europe/Berlin", "UTC".
const ZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

/** A bounded string, or null. Control characters never make it through. */
function str(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/**
 * One pickup, rebuilt field by field from an untrusted object.
 *
 * Rebuilt, not filtered: the result is a fresh object holding only what was
 * recognised, so a field nobody thought about cannot ride along to whatever
 * reads this next. Returns null when the entry is unusable, which for anything
 * without a valid id it is — the id is what makes storing it twice safe.
 */
function onePickup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!ID_RE.test(id)) return null;

  const out = { id, overbooked: raw.overbooked === true };
  const order = str(raw.order, 64);
  if (order) out.order = order;
  const slot = str(raw.slot, 64);
  if (slot) out.slot = slot;
  const slotText = str(raw.slotText, 120);
  if (slotText) out.slotText = slotText;
  const place = str(raw.place, 120);
  if (place) out.place = place;

  const from = str(raw.from, 32);
  if (from && LOCAL_TIME_RE.test(from)) out.from = from;
  const to = str(raw.to, 32);
  if (to && LOCAL_TIME_RE.test(to)) out.to = to;
  const zone = str(raw.zone, 64);
  if (zone && ZONE_RE.test(zone)) out.zone = zone;

  const items = [];
  if (Array.isArray(raw.items)) {
    for (const it of raw.items.slice(0, MAX_ITEMS_PER_PICKUP)) {
      if (!it || typeof it !== 'object') continue;
      const kind = str(it.kind, 80);
      // A line with no name is not a line, and a weight that is negative or
      // measured in tonnes is a bug at the far end. Either would end up on a
      // picking list, so neither is stored.
      if (!kind) continue;
      const grams = Number(it.grams);
      if (!Number.isFinite(grams) || grams < 0 || grams > 10_000_000) continue;
      items.push({ kind, grams: Math.round(grams) });
    }
  }
  if (items.length) out.items = items;
  return out;
}

/**
 * Validate a reply body. Never throws; returns whatever survived.
 *
 * `dropped` is not decoration for a diagnostics screen. A receiver whose
 * pickups all fail validation looks exactly like a receiver that has none, and
 * those two need very different fixing.
 */
function parseReply(text) {
  const empty = { pickups: [], dropped: 0 };
  if (!text) return empty;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    // Not repeated into the log: a body that is not JSON is frequently an HTML
    // error page, and the interesting part is that it was not JSON.
    return { ...empty, error: 'reply is not JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...empty, error: 'reply is not an object' };
  // No pickups field at all is the ordinary case — every receiver written
  // before this existed answers that way, and it is not an error.
  if (raw.pickups === undefined || raw.pickups === null) return empty;
  if (!Array.isArray(raw.pickups)) return { ...empty, error: 'pickups is not a list' };

  const seen = new Set();
  const pickups = [];
  let dropped = 0;
  // Entries past the cap are never examined, only counted.
  const over = Math.max(0, raw.pickups.length - MAX_PICKUPS);
  for (const entry of raw.pickups.slice(0, MAX_PICKUPS)) {
    const p = onePickup(entry);
    if (!p) {
      dropped++;
      continue;
    }
    // The same id twice in one reply: first wins, so which one that is does not
    // depend on the order rows happen to be written in.
    if (seen.has(p.id)) {
      dropped++;
      continue;
    }
    seen.add(p.id);
    pickups.push(p);
  }
  const out = { pickups, dropped: dropped + over };
  if (over) out.error = `reply carried more than ${MAX_PICKUPS} pickups`;
  return out;
}

/**
 * Read at most REPLY_MAX_BYTES, and stop pulling the moment that is passed.
 *
 * Deliberately not res.text(): that reads whatever arrives and only then lets
 * you measure it, which is the wrong order when the point of the measurement is
 * to not have the thing in memory.
 */
async function readCapped(res) {
  const stream = res.body;
  if (stream && typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > REPLY_MAX_BYTES) {
          // Hang up rather than drain politely. Whatever is still coming is
          // going to be discarded anyway.
          await reader.cancel().catch(() => {});
          return { tooBig: true };
        }
        chunks.push(value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // cancel() already released it.
      }
    }
    return { text: Buffer.concat(chunks).toString('utf8') };
  }
  // No stream to meter: a response with no body, or a stand-in in a test.
  if (typeof res.text === 'function') {
    const text = await res.text();
    return text.length > REPLY_MAX_BYTES ? { tooBig: true } : { text };
  }
  return { text: null };
}

/**
 * The whole reply path: content type, size, JSON, fields.
 *
 * Content-Type has to say JSON before a single byte of body is pulled. A
 * receiver answering an API call with an HTML error page is the everyday shape
 * of a misconfigured proxy, and handing that to a parser wastes time at best.
 * A reply with no content type at all is silence, not an error — that is what
 * every receiver written before this feature existed sends back.
 */
async function readReply(res) {
  const headers = res && res.headers;
  const get = headers && typeof headers.get === 'function' ? (k) => headers.get(k) : () => null;
  const ctype = get('content-type');
  if (!ctype) return { pickups: [], dropped: 0 };
  if (!/^application\/(json|[\w.+-]+\+json)\s*(;|$)/i.test(ctype.trim()))
    return { pickups: [], dropped: 0, error: 'reply is ' + str(ctype.split(';')[0], 60) + ', not JSON' };

  const declared = Number(get('content-length'));
  // The cheapest guard there is: the receiver said how big it is, and it is too
  // big, so nothing needs reading.
  if (Number.isFinite(declared) && declared > REPLY_MAX_BYTES)
    return { pickups: [], dropped: 0, error: `reply declared ${declared} bytes, over the ${REPLY_MAX_BYTES} limit` };

  const body = await readCapped(res);
  if (body.tooBig) return { pickups: [], dropped: 0, error: `reply exceeded ${REPLY_MAX_BYTES} bytes` };
  return parseReply(body.text);
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
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'meistertracker-harvest-feed/' + VERSION,
          'X-Meistertracker-Timestamp': String(timestamp),
          'X-Meistertracker-Signature': sign(cfg.secret, timestamp, body)
        },
        body,
        signal: controller.signal
      });
      if (res.ok) {
        const out = { ok: true, status: res.status, attempts: attempt };
        // Rule 1 up in "The reply", made concrete: the payload is delivered the
        // moment the receiver says 2xx, so reading what it sent back gets its
        // own try/catch and there is no path from in here to ok:false.
        try {
          out.reply = await readReply(res);
        } catch (e) {
          out.reply = { pickups: [], dropped: 0, error: e.message };
        }
        return out;
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
 * Write the outcome where Settings can show it.
 *
 * A log line only helps someone who already suspects a problem; "last delivery:
 * 3 days ago" on the screen is what makes a feed that quietly stopped visible
 * at all. Recording it must never take the caller down with it.
 */
function note(database, dbApi, ok, error) {
  if (!database || !dbApi || typeof dbApi.updateHarvestFeedStatus !== 'function') return;
  try {
    dbApi.updateHarvestFeedStatus(database, { at: new Date().toISOString(), ok, error });
  } catch {
    // Bookkeeping around a push that already happened.
  }
}

/**
 * Take delivery of whatever came back, and confirm what went out.
 *
 * Order matters and only one order is right. Confirming comes first, and covers
 * exactly the ids a *successful* push carried: those the receiver has now
 * definitely heard about. Anything arriving after that genuinely is a repeat,
 * and re-arms itself in storePickup().
 *
 * Confirming what a failed push carried would be the bug this ordering exists
 * to prevent — the receiver never heard, drops the pickup from its next reply
 * anyway, and the two sides quietly disagree with nothing left to reconcile
 * them.
 *
 * Best-effort throughout, like note(): the push has happened, and none of this
 * may throw its way out to the timer.
 */
function receive(database, dbApi, log, r) {
  if (!database || !dbApi || typeof dbApi.storePickup !== 'function') return;
  try {
    if (r.ok && Array.isArray(r.payload.pickupsDone) && r.payload.pickupsDone.length)
      dbApi.ackPickups(database, r.payload.pickupsDone);

    const reply = r.reply;
    if (!reply) return;
    if (reply.error) log('warn', 'Harvest feed reply not usable', { error: reply.error, dropped: reply.dropped });
    if (!reply.pickups.length) return;

    let fresh = 0;
    for (const p of reply.pickups) {
      // One unusable row must not cost the other nineteen. A full table throws
      // here, which is the one case worth a line of its own.
      try {
        if (dbApi.storePickup(database, p) !== 'unchanged') fresh++;
      } catch (e) {
        log('warn', 'Pickup rejected', { id: p.id, error: e.message });
      }
    }
    // Silence when nothing moved: this runs every quarter of an hour and a
    // receiver repeats its open pickups every single time.
    if (fresh) log('info', 'Pickups received', { stored: fresh, of: reply.pickups.length });
  } catch (e) {
    log('warn', 'Harvest feed reply not stored', { error: e.message });
  }
}

/**
 * One complete exchange: build, send, record the outcome, take delivery.
 *
 * The timer calls this and so do the tests, so the confirmation ordering that
 * receive() describes is exercised by the same code path that runs in
 * production rather than by a reimplementation of it.
 */
async function deliver({ database, cfg, dbApi, log, deps }) {
  const r = await sendOnce(database, cfg, deps);
  if (r.ok)
    log('info', 'Harvest feed sent', {
      harvested: r.payload.harvested.length,
      planned: r.payload.planned.length,
      attempts: r.attempts
    });
  else log('warn', 'Harvest feed failed', { error: r.error, attempts: r.attempts });
  note(database, dbApi, r.ok, r.error);
  receive(database, dbApi, log, r);
  return r;
}

/**
 * Start the timer. Safe to call when the feature is off (no URL) — it says so
 * once and does nothing. Returns true when a timer is running.
 *
 * `skip` exists for the same reason the DuckDNS updater has one: a worktree or
 * staging copy usually inherits the production .env, and two servers posting
 * contradictory snapshots to one receiver is worse than one posting none.
 */
function start({ database, env, log, skip, dbApi, deps }) {
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

  const tick = async () => {
    if (inFlight) {
      log('warn', 'Harvest feed still sending — tick skipped');
      return;
    }
    inFlight = true;
    try {
      await deliver({ database, cfg, dbApi, log, deps });
    } catch (e) {
      // buildPayload can throw if the schema is mid-migration. Log, keep the
      // timer.
      log('error', 'Harvest feed error', { error: e.message });
      note(database, dbApi, false, e.message);
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

module.exports = {
  readConfig,
  storedConfig,
  resolveConfig,
  buildPayload,
  sign,
  post,
  sendOnce,
  deliver,
  parseReply,
  readReply,
  start,
  stop,
  VERSION,
  VERSION_RELEASE,
  REPLY_MAX_BYTES,
  MAX_PICKUPS
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
