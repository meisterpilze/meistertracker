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
//   HARVEST_WEBHOOK_PACK_SIZES    the portions you hand a release out in, in
//                                 grams: "250,500,1000". One ladder for every
//                                 species — see `packSizes` below. Unset means
//                                 no instruction, and the receiver decides.
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

// Fassung 1 carried `harvested`, and a receiver was free to publish it. Fassung 2
// says a `released` list is present and that it, not `harvested`, is what may be
// offered for sale. Ignoring that difference means publishing produce the grower
// deliberately kept back, so it is a version bump and not a new optional field.
//
// ⚠️ **Fassung 1 is no longer sent.** It used to be the default, with release
// mode as a switch, and that switch was the bug: a harvest total is a number
// that stops being true the moment something is sold at the stall, and no
// setting makes it true again. Worse, it was the *quiet* option — a lab that
// never found the checkbox published raw stock and looked fine doing it. What
// may be sold is now always a decision somebody made by hand, and an empty
// `released` list means exactly that: nothing is for sale yet.
//
// `VERSION` stays as the number Fassung 1 carried, so a receiver reading old
// records still knows what it is looking at.
const VERSION = 1;
const VERSION_RELEASE = 2;
const ATTEMPTS = 3;

// ── Pack sizes ───────────────────────────────────────────────────────────────
//
// `released` says how much may be sold. `packSizes` says in what portions it is
// handed over: [250, 500, 1000] — grams, ascending, one ladder for every
// species.
//
// It is a separate statement because it answers a different question, and the
// far end was answering it alone. A shop has to offer *some* amount, so without
// this it invents a ladder — ours guessed 250 g and multiples of it. That is a
// fair guess and still a guess: a farm packing 400 g trays had no way to say so.
//
// **One list, not one per species.** Portioning follows the packing bench —
// which trays are on the shelf, what the scale steps in — not the mushroom in
// the tray. Per species it would be a field to fill in for every new Sorte, for
// an answer that is the same every time, and the first one forgotten would be a
// species a shop quietly offers in the wrong sizes.
//
// **Absent means absent.** No sizes set, no field in the payload, and the
// receiver keeps doing what it did before. This is not the release list, where
// silence had to be given a meaning because publishing raw stock was the
// dangerous reading — here the worst case is a shop using its own ladder, which
// is exactly today's behaviour.
//
// Not a version bump: a receiver that ignores the field is correct, only less
// specific. Fassung 2 stays Fassung 2.
const PACK_MIN_G = 25;
const PACK_MAX_G = 25_000;
const PACK_MAX_COUNT = 8;

/**
 * The canonical form of a pack-size list: ascending, deduplicated, in range.
 *
 * Takes what a form, an environment variable or an API body might hold — an
 * array, "250,500,1000", a single number — and returns integers. The one place
 * that decides what a size may be; everything else stores or sends the result.
 *
 * Silent about what it drops, on purpose. This runs on the way in from a UI
 * that shows the result back, and on every read of a stored row where throwing
 * would take the settings page down over a stray comma.
 */
function packSizes(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const out = [];
  for (const part of parts) {
    // Number and not parseInt. parseInt('500g') is 500 and parseInt('2 kg') is
    // 2 — it reads until it stops understanding and keeps what it had, which
    // turns a unit somebody typed out of habit into a portion size two grams
    // large. Number says NaN to both, and NaN is dropped.
    const n = Number(String(part).trim());
    if (!Number.isInteger(n) || n < PACK_MIN_G || n > PACK_MAX_G) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b).slice(0, PACK_MAX_COUNT);
}

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
    packSizes: packSizes(env.HARVEST_WEBHOOK_PACK_SIZES),
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
    // Re-checked, not trusted. The stored text is canonical when it was written
    // through the settings page, and this file must still be right for a row
    // somebody edited with sqlite3.
    packSizes: packSizes(row.packSizes),
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

// How far ahead pickup windows are published. Not configurable, unlike the
// harvest horizons: those answer "how much of our production do we show", which
// is a business decision per lab. This one answers "how far ahead can somebody
// book", and four weeks is long enough for any market rhythm while keeping a
// recurring block from expanding into thousands of rows.
const PICKUP_WINDOW_DAYS = 28;
// A market lab has a handful of windows a week; four weeks of six-a-day is 168.
// Anything past this is a runaway recurrence rather than a real schedule.
const MAX_PICKUP_WINDOWS = 500;
// The zone the calendar's timed events are written in — see customEventToVEVENT,
// which hardcodes the same one on every VEVENT. Sent explicitly so the receiver
// never has to guess: "09:00" without a zone is not a time, and a window that
// silently moves by an hour in October is a missed handover.
const PICKUP_TZ = 'Europe/Berlin';

/** Comma-separated exception dates, as stored. Twin of db.parseExceptionDates. */
function exceptionSet(raw) {
  if (!raw) return new Set();
  return new Set(
    String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/** UTC-only date arithmetic: YYYY-MM-DD in, YYYY-MM-DD out. */
function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * n months after `base`, clamping to the target month's last day.
 *
 * ⚠️ Computed from the base every time, never cumulatively from the previous
 * occurrence: adding a month to 31 January overflows to 3 March, which both
 * skips February and shifts every later occurrence onto the 3rd. Twin of
 * addMonthsClamped() in app.js, which carries the same warning.
 */
function addMonthsStr(baseStr, n) {
  const base = new Date(baseStr + 'T00:00:00Z');
  const m = base.getUTCMonth() + n;
  const y = base.getUTCFullYear() + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, tm + 1, 0)).getUTCDate();
  const day = Math.min(base.getUTCDate(), lastDay);
  return new Date(Date.UTC(y, tm, day)).toISOString().slice(0, 10);
}

/**
 * The dates a calendar event actually falls on, inside [from, until].
 *
 * A recurring block is one row with many occurrences, and `exception_dates`
 * means "this one does not exist" — a holiday, or a market that was cancelled.
 */
function occurrenceDates(ev, from, until) {
  const skip = exceptionSet(ev.exception_dates);
  const out = [];
  if (!ev.recurrence) {
    if (ev.start_date >= from && ev.start_date <= until && !skip.has(ev.start_date)) out.push(ev.start_date);
    return out;
  }
  const hardEnd = ev.recurrence_until || null;
  let cur = ev.start_date;
  let monthIdx = 0;
  let guard = 0;
  while (guard++ < 1000) {
    if (cur > until) break;
    if (hardEnd && cur > hardEnd) break;
    if (cur >= from && !skip.has(cur)) out.push(cur);
    if (ev.recurrence === 'daily') cur = addDaysStr(cur, 1);
    else if (ev.recurrence === 'weekly') cur = addDaysStr(cur, 7);
    else if (ev.recurrence === 'monthly') cur = addMonthsStr(ev.start_date, ++monthIdx);
    else break;
  }
  return out;
}

/**
 * The id one window is known by, on both sides, for good.
 *
 * ⚠️ Event id **plus occurrence date**. A recurring block is a single row, so
 * keying on the row alone makes every Friday the same window — one booking then
 * occupies all of them, and the mistake only shows up at a handover point.
 *
 * Kept inside `[A-Za-z0-9_-]{1,64}`, which is the narrowest charset any receiver
 * is likely to impose (the one this feed is built against does). Ids from
 * imported CalDAV events can carry `@` and `.`, so they are folded — and folding
 * two different ids onto the same string would silently merge two windows, hence
 * the digest tail whenever anything had to change.
 */
function windowId(eventId, date) {
  const raw = String(eventId);
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, '-');
  if (safe === raw && safe.length <= 43) return safe + '_' + date;
  const digest = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return safe.slice(0, 34) + '-' + digest + '_' + date;
}

/**
 * When goods can be collected — the lab's opening times, stated positively.
 *
 * ⚠️ **Title and description are not read here, and must not be.** They are free
 * text in an internal tool and will end up holding staff notes ("Anna covers,
 * Bernd is off"). What leaves is the shape of the window: when, where, how many.
 * A receiver composes its own label from that.
 *
 * The list is complete for its horizon and replaces whatever the receiver holds
 * — it is not a set of changes. Empty therefore means "nothing bookable", which
 * is a real answer and must survive the trip; the field is always present.
 */
function buildPickupWindows(database, at) {
  const rows = collectPickupWindows(database, at);
  if (rows === null) return null;
  // Named one by one rather than spread with the internal fields removed. This
  // is the boundary the whole feature is careful about, and an allow-list keeps
  // it careful: a field added upstream has to be added here on purpose before it
  // can leave the building. `event` is the one dropped today — the lab's own
  // screens key on it (see pickupWindowIndex), and it is nobody else's business.
  return rows.map((w) =>
    trim({
      id: w.id,
      date: w.date,
      from: w.from,
      to: w.to,
      tz: w.tz,
      place: w.place ?? null,
      capacity: w.capacity ?? null
    })
  );
}

/**
 * The same windows, with the row each one came from.
 *
 * For this end only. The warning before a booked window is moved has to find
 * the bookings, and a booking names the window by the id below — so the mapping
 * from "calendar event on this date" to "that id" must exist exactly once, and
 * this is it.
 */
function pickupWindowIndex(database, at) {
  return collectPickupWindows(database, at) || [];
}

function collectPickupWindows(database, at) {
  const from = localDay(at);
  const until = addDaysStr(from, PICKUP_WINDOW_DAYS);
  let rows;
  try {
    rows = database
      .prepare(
        `SELECT e.id, e.start_date, e.start_time, e.end_time, e.all_day,
                e.recurrence, e.recurrence_until, e.exception_dates, e.pickup_capacity,
                l.name AS place
           FROM calendar_events e
           LEFT JOIN pickup_locations l ON l.id = e.location_id
          WHERE e.category = 'pickup'
          ORDER BY e.start_date, e.start_time`
      )
      .all();
  } catch {
    // A database that predates the pickup columns. The harvest numbers are the
    // point of this payload and must still go out.
    return null;
  }

  const windows = [];
  for (const ev of rows) {
    // A window without a clock is not a window: "Saturday" cannot be booked
    // into, and inventing 00:00–23:59 would publish an opening time nobody
    // stated. The editor keeps a pickup entry from being all-day; this is the
    // guard for rows that predate it or arrived over CalDAV.
    if (ev.all_day === 1 || !ev.start_time || !ev.end_time) continue;
    for (const date of occurrenceDates(ev, from, until)) {
      windows.push(
        trim({
          id: windowId(ev.id, date),
          event: ev.id,
          date,
          from: ev.start_time,
          to: ev.end_time,
          tz: PICKUP_TZ,
          // The name alone. The address stays in the building — it is on the
          // location row for the lab's own calendar clients, not for this.
          place: ev.place || null,
          // Absent means uncapped. 0 is a different answer — the window exists
          // and takes nobody — and survives trim() because only null does not.
          capacity: ev.pickup_capacity === null || ev.pickup_capacity === undefined ? null : ev.pickup_capacity
        })
      );
      if (windows.length >= MAX_PICKUP_WINDOWS) break;
    }
    if (windows.length >= MAX_PICKUP_WINDOWS) break;
  }
  windows.sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from) || a.id.localeCompare(b.id));
  return windows;
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
    version: VERSION_RELEASE,
    generatedAt: at.toISOString(),
    freshDays: cfg.freshDays,
    harvested,
    planned,
    // A separate list, not a field on `harvested`. The two answer different
    // questions — what came off the racks, and what may be sold — and only the
    // first is production data. Keeping them apart also lets a release outlive
    // its harvest window: set two kilos aside on Monday for a Saturday market
    // and by Thursday the harvest has aged out of `freshDays`, while the crate
    // is still standing there. The human who put it there is the better source.
    //
    // Always present, empty list included: "nobody has released anything" is an
    // answer, and a receiver has to be able to tell it apart from "this lab does
    // not do releases". The second reading is what let raw harvest totals reach
    // a shop window.
    released: database
      .prepare(
        `SELECT species, grams, valid_until AS validUntil
           FROM harvest_release
          WHERE grams > 0 AND (valid_until IS NULL OR valid_until >= ?)
          ORDER BY species`
      )
      .all(localDay(at))
      .map((r) => trim({ species: r.species, grams: Math.round(r.grams), validUntil: r.validUntil || null }))
  };

  // Alongside `released`, never inside it: the same ladder for every species is
  // the whole point, and a copy per entry invites a receiver to read the two as
  // independent. Omitted when nothing is set — see "Pack sizes" up top.
  const sizes = packSizes(cfg.packSizes);
  if (sizes.length) payload.packSizes = sizes;

  // When goods can be collected. Always present once this build can compute it,
  // empty list included: that is what tells a receiver the difference between
  // "this lab publishes no windows" and "this lab's software cannot state any",
  // and only the second one justifies falling back to a hand-kept list.
  //
  // No version bump for it. Fassung 2 changed what an existing field *meant*, so
  // ignoring it was unsafe; a new field is not, and bumping would have made the
  // receiver's deployment a flag day — it rejects versions it does not know.
  const windows = buildPickupWindows(database, at);
  if (windows) payload.pickupWindows = windows;

  // The ids we hold and have not confirmed yet, so the receiver can stop
  // repeating them. Omitted entirely when there is nothing to confirm: a
  // receiver that knows nothing about pickups should never see the field, and
  // an empty array is a claim ("I have none") where absence is silence.
  //
  // Bookings and withdrawals go in the same list. From the receiver's side
  // there is one question — did the other end take this in? — and it has to
  // stop repeating either kind on the same answer.
  //
  // Sending is not confirming. These are marked as confirmed only after a push
  // carrying them actually succeeded — see receive().
  //
  // ⚠️ Twin of db.unackedPickupIds(). A test asserts the two agree; changing
  // what counts as unconfirmed means changing it in both.
  try {
    const done = database
      .prepare(
        `SELECT id FROM (
             SELECT id, received AS ord FROM pickups WHERE acked_at IS NULL
             UNION ALL
             SELECT id, at AS ord FROM pickup_cancellations WHERE acked_at IS NULL
           ) ORDER BY ord LIMIT ?`
      )
      .all(MAX_ACK_PER_PUSH)
      .map((r) => r.id);
    if (done.length) payload.pickupsDone = [...new Set(done)];
  } catch {
    // No pickups tables yet — a database mid-migration, or one this feature has
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
// Withdrawals are bare ids, so a reply can hold as many as it has bookings —
// the whole open list could be cancelled at once.
const MAX_CANCELLED = 200;
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
  const empty = { pickups: [], cancelled: [], dropped: 0 };
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

  // The two lists are read independently and neither can take the other down
  // with it. They say different things — this is open, this is withdrawn — and
  // a receiver that garbles one has still told the truth with the other.
  const problems = [];
  let dropped = 0;

  const pickups = [];
  // No pickups field at all is the ordinary case: every receiver written before
  // this existed answers that way, and it is not an error.
  if (raw.pickups !== undefined && raw.pickups !== null) {
    if (!Array.isArray(raw.pickups)) problems.push('pickups is not a list');
    else {
      // Entries past the cap are never examined, only counted.
      const over = Math.max(0, raw.pickups.length - MAX_PICKUPS);
      if (over) problems.push(`reply carried more than ${MAX_PICKUPS} pickups`);
      dropped += over;
      const seen = new Set();
      for (const entry of raw.pickups.slice(0, MAX_PICKUPS)) {
        const p = onePickup(entry);
        if (!p) {
          dropped++;
          continue;
        }
        // The same id twice in one reply: first wins, so which one that is does
        // not depend on the order rows happen to be written in.
        if (seen.has(p.id)) {
          dropped++;
          continue;
        }
        seen.add(p.id);
        pickups.push(p);
      }
    }
  }

  // Withdrawals: a bare list of ids, nothing else. There is nothing to describe
  // about a pickup that is no longer happening.
  const cancelled = [];
  if (raw.pickupsCancelled !== undefined && raw.pickupsCancelled !== null) {
    if (!Array.isArray(raw.pickupsCancelled)) problems.push('pickupsCancelled is not a list');
    else {
      const over = Math.max(0, raw.pickupsCancelled.length - MAX_CANCELLED);
      if (over) problems.push(`reply carried more than ${MAX_CANCELLED} cancellations`);
      dropped += over;
      const seen = new Set();
      for (const entry of raw.pickupsCancelled.slice(0, MAX_CANCELLED)) {
        // Numbers, objects and nulls are not ids. Same shape as everywhere else
        // — an id that would be refused as a booking cannot be honoured as a
        // withdrawal either.
        const id = typeof entry === 'string' ? entry.trim() : '';
        if (!ID_RE.test(id) || seen.has(id)) {
          dropped++;
          continue;
        }
        seen.add(id);
        cancelled.push(id);
      }
    }
  }

  const out = { pickups, cancelled, dropped };
  if (problems.length) out.error = problems.join('; ');
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

    // Withdrawals last, and that ordering is a decision rather than an
    // accident. Should one reply somehow name the same id in both lists, the
    // withdrawal is the statement that has to survive: packing a crate for a
    // cancelled order costs produce, and not packing one for an order that is
    // still live costs a phone call.
    //
    // Applied to the database before it can appear in `pickupsDone` — same
    // ordering as a booking, same reason. Confirming a withdrawal this end has
    // not carried out means the receiver stops repeating it while the pickup is
    // still sitting in the list.
    let withdrawn = { removed: 0, recorded: 0, skipped: 0 };
    if (reply.cancelled && reply.cancelled.length && typeof dbApi.cancelPickups === 'function') {
      try {
        withdrawn = dbApi.cancelPickups(database, reply.cancelled);
      } catch (e) {
        log('warn', 'Pickup withdrawals not applied', { error: e.message });
      }
    }

    // Silence when nothing moved: this runs every quarter of an hour and a
    // receiver repeats its open pickups every single time. A withdrawal that
    // removed nothing is the same non-event — the id was never here, which the
    // receiver cannot know and reports anyway.
    if (fresh || withdrawn.removed)
      log('info', 'Pickups received', {
        stored: fresh,
        of: reply.pickups.length,
        withdrawn: withdrawn.removed
      });
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
  buildPickupWindows,
  pickupWindowIndex,
  windowId,
  releaseProblem,
  packSizes,
  PACK_MIN_G,
  PACK_MAX_G,
  PACK_MAX_COUNT,
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
  MAX_PICKUPS,
  MAX_CANCELLED
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
