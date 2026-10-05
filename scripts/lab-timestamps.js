'use strict';
// The daily outside timestamp over the lab history's hash chain.
//
// db.js keeps a hash chain over lab_history ("Pruefkette"): every entry's link
// is the SHA-256 of the link before it and the entry itself. The chain shows
// an entry that was changed in the file afterwards, but someone who changes an
// entry and recomputes every link after it would leave a consistent chain.
// What stops that is a timestamp from an authority outside, over a link: it
// says that this hash existed at that time, so the entries up to that link
// can no longer be rewritten without the stamp no longer matching.
//
// Once an hour this checks whether there is anything new since the last
// stamp, and if the last one is older than STALE_MS (about a day), asks the
// TSA for one over the newest link. Only the hash leaves the machine
// (scripts/rfc3161.js). A failure is logged and kept for /api/health; the
// next hour tries again. An admin can ask for one at once.
const { stamp: requestStamp } = require('./rfc3161.js');

// A free public RFC 3161 service over HTTPS, so nobody on the way can slip in
// an answer; its tokens check against the usual root certificates. Sectigo
// asks automated clients for at least 15 seconds between requests; this sends
// one a day. LAB_TSA_URL replaces it, and "off" turns stamping off.
const DEFAULT_TSA = 'https://timestamp.sectigo.com';
const EVERY_MS = 60 * 60 * 1000;
const FIRST_MS = 2 * 60 * 1000;
const STALE_MS = 20 * 60 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;

// Which TSA, from the environment. A worktree instance does not stamp unless
// told to: it is a copy for development, and its history is not the lab's.
// The TSA as it is stored with every stamp and shown in the app and on paper:
// scheme, host and path. A user name, password or query in the setting would
// otherwise end up in front of everyone who prints the lab book.
function shownTsa(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return String(url);
  }
}

function tsaFromEnv(env, worktree) {
  const v = String((env && env.LAB_TSA_URL) || '').trim();
  if (v.toLowerCase() === 'off') return null;
  if (v) return v;
  return worktree ? null : DEFAULT_TSA;
}

// o.getDb()   the open database (a restore replaces it, so ask each time)
// o.dbApi     db.js
// o.url       the TSA, or null for off
// o.log       the server's log(level, msg, meta)
// o.request   for tests: (url, hashHex) => Promise<{ token, genTime, serial }>
// o.now       for tests: () => milliseconds
function createLabTimestamps(o) {
  const request = o.request || requestStamp;
  const now = o.now || Date.now;
  const log = o.log || (() => {});
  const everyMs = o.everyMs || EVERY_MS;
  const firstMs = o.firstMs == null ? FIRST_MS : o.firstMs;
  const staleMs = o.staleMs || STALE_MS;
  const cooldownMs = o.cooldownMs == null ? COOLDOWN_MS : o.cooldownMs;
  let busy = false;
  let lastTry = 0;
  let lastError = null;
  let first = null;
  let timer = null;

  // force: an admin asked; skip the waiting for a day, but not the cooldown,
  // and still nothing if nothing is new.
  async function run(opts = {}) {
    if (!o.url) return { status: 'off' };
    if (busy) return { status: 'busy' };
    if (opts.force && now() - lastTry < cooldownMs) return { status: 'wait' };
    const database = o.getDb();
    const head = o.dbApi.labChainHead(database);
    if (!head) return { status: 'empty' };
    const last = o.dbApi.lastLabTimestamp(database);
    // Gleich, nicht groesser oder gleich: ein Stempel auf einem Glied, dessen
    // Eintrag es nicht mehr gibt, haelt den Kopf nicht fuer gestempelt.
    if (last && last.historyId === head.historyId) return { status: 'current', stamp: last };
    if (!opts.force && last && now() - Date.parse(last.requested) < staleMs) return { status: 'later' };
    busy = true;
    lastTry = now();
    const requested = new Date(lastTry).toISOString();
    try {
      const r = await request(o.url, head.hash);
      // A restore may have replaced the database while the TSA answered.
      const current = o.getDb();
      const id = o.dbApi.insertLabTimestamp(current, {
        historyId: head.historyId,
        hash: head.hash,
        tsa: shownTsa(o.url),
        requested,
        genTime: r.genTime,
        serial: r.serial,
        token: r.token
      });
      if (id == null) {
        log('warn', 'Lab history timestamp no longer matches the chain, not kept', { historyId: head.historyId });
        return { status: 'stale' };
      }
      lastError = null;
      log('info', 'Lab history timestamped', { historyId: head.historyId, genTime: r.genTime });
      if (o.onChange) o.onChange();
      return { status: 'stamped', stamp: o.dbApi.lastLabTimestamp(current) };
    } catch (e) {
      lastError = { at: requested, message: e.message };
      log('warn', 'Lab history timestamp failed', { tsa: shownTsa(o.url), error: e.message });
      return { status: 'error', error: e.message };
    } finally {
      busy = false;
    }
  }

  function tick() {
    run().catch((e) => log('warn', 'Lab history timestamp check failed', { error: e.message }));
  }

  return {
    run,
    start() {
      if (!o.url || timer || first) return;
      first = setTimeout(() => {
        first = null;
        tick();
        timer = setInterval(tick, everyMs);
        if (timer.unref) timer.unref();
      }, firstMs);
      if (first.unref) first.unref();
    },
    stop() {
      clearTimeout(first);
      clearInterval(timer);
      first = null;
      timer = null;
    },
    health() {
      return { tsa: o.url ? shownTsa(o.url) : null, busy, lastError };
    }
  };
}

module.exports = { createLabTimestamps, tsaFromEnv, shownTsa, DEFAULT_TSA, STALE_MS };
