'use strict';

// ── DuckDNS: keeping one A record honest ─────────────────────────────────────
//
// This machine is reachable from outside under a name, and that name is worth
// exactly as much as the A record behind it. The record is not a setting. It is
// a claim about where the server is right now, and it goes stale the moment the
// ISP hands out a different address — which, on a German consumer line, is
// roughly every night.
//
// The version this replaces sent one HTTP request every five minutes and
// believed whatever came back. That is not enough, for four separate reasons,
// and each one of them showed up as the same symptom: the server was sometimes
// not reachable and nothing anywhere said why.
//
// **A failed attempt used to cost a full interval.** The tick that matters is
// the first one after the line comes back up, and that is precisely the tick
// most likely to fail — the PPPoE re-dial is still in progress, the resolver is
// not answering yet. One `warn` line later the updater went back to sleep for
// another five minutes. So the failure was not random: it was reliably
// triggered by the very event it existed to handle. Now a failure backs off
// from 30 s rather than waiting out the full cadence, and gives up to the
// normal interval only after it has actually been failing for a while.
//
// **Success used to mean "DuckDNS said OK".** It does not. DuckDNS echoing an
// address back proves the request arrived, nothing more. It cannot tell you
// that the record it wrote is the record the world sees, that some other
// updater — a router with the same token, a second copy of this server — has
// not overwritten it since, or that the address it detected is the one your
// port forward actually lives behind. So after an update we ask the
// authoritative nameservers what they are serving, and compare. That check is
// the only thing here that can catch a wrong record, as opposed to an old one.
//
// **Nothing was watching for the events that change an address.** A fixed
// timer is blind to suspend/resume and to the interface coming back with a new
// lease. Worse, Node's timers run on a clock that does not advance while the
// machine is asleep, so on a box that sleeps the tick after waking is *late* —
// exactly when the address is most likely to be new. A cheap 30-second
// heartbeat watches the wall clock and the local interfaces and pulls the
// update forward when either jumps.
//
// **A dead updater looked identical to a healthy one.** The status the UI got
// was the last address DuckDNS ever confirmed, with no notion of how long ago
// that was. Everything below that reports state reports enough to tell "fresh"
// from "frozen": when we last tried, when we last succeeded, what the last
// error was, and what the nameservers are actually serving.
//
// One thing deliberately absent: this never writes an `ip=` parameter. DuckDNS
// detects the source address of the request, and that is the address we want —
// the one traffic from outside will arrive on. A locally-discovered address
// would be the LAN side of the NAT and would point the record at nothing.

const https = require('https');
const dns = require('dns');
const os = require('os');

// Cadence when things are working. DuckDNS serves these records with a short
// TTL, so five minutes is the dominant term in how long a changed address stays
// wrong — not the DNS caching underneath it.
const OK_INTERVAL_MS = 5 * 60 * 1000;

// First retry after a failure, then doubling. 30 s is chosen to be longer than
// a PPPoE re-dial and shorter than anyone's patience.
const RETRY_BASE_MS = 30 * 1000;

// Backoff ceiling. Never slower than the healthy cadence — a failing updater
// that checks in less often than a working one has the incentive backwards.
const RETRY_MAX_MS = OK_INTERVAL_MS;

// Matches the ACME helper. A stalled connection to duckdns.org must not hold
// the scheduler, an admin's "update now" click, or a cert renewal step.
const REQUEST_TIMEOUT_MS = 30 * 1000;

// The heartbeat that notices suspend/resume and interface changes. Cheap: it
// reads the clock and the interface list, and touches the network only when one
// of them has moved.
const HEARTBEAT_MS = 30 * 1000;

// How far the wall clock may run past the heartbeat before we call it a
// suspend. Generous, because a loaded box can genuinely be a few seconds late
// and we do not want an update storm out of ordinary timer jitter.
const CLOCK_JUMP_MS = 90 * 1000;

// How old the last *successful* update may be before the state we report counts
// as stale. Three healthy cycles plus room for a round of backoff.
const STALE_AFTER_MS = 20 * 60 * 1000;

// When the out-of-process fallback (scripts/duckdns-fallback.js) decides this
// server has stopped updating its own record and takes over.
//
// Everything above only runs while the server does. The case it cannot cover is
// the server being down — a failed deploy, a reboot where pm2 never came back —
// because that is precisely when nothing in this file is executing, and the
// record then points at wherever the line used to be until somebody notices.
//
// Two missed cycles plus slack: long enough that an ordinary restart or a round
// of backoff does not wake it, short enough to land *before* STALE_AFTER_MS.
// That ordering is the point — if the fallback fired later than the UI turns
// red, the red would be telling the truth about a gap the fallback was supposed
// to have covered. test/duckdns-fallback.test.js pins it.
const FALLBACK_AFTER_MS = 12 * 60 * 1000;

// Verify against the nameservers every N successful updates — and always right
// after DuckDNS reports it changed something, which is when a wrong write would
// happen. Six ticks is about half an hour of steady state.
const VERIFY_EVERY_TICKS = 6;

// A record that stays wrong after this many corrections is not a race we are
// going to win by trying harder — it is two updaters fighting over one name.
// Say so once and stop hammering; the state we report keeps the evidence.
const MAX_CORRECTIONS = 3;

// c-ares settings for our own lookups. The default resolver has no timeout we
// can set, and a DNS check that can hang is a DNS check that can wedge the
// scheduler.
const DNS_TIMEOUT_MS = 5000;
const DNS_TRIES = 2;

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * DuckDNS' verbose reply, as a decided answer.
 *
 * The documented shape is four lines: OK or KO, the IPv4 address, the IPv6
 * address, and UPDATED or NOCHANGE. Every line is trimmed before it is read.
 * The version this replaces compared the raw first line against 'OK', so a
 * trailing carriage return — or an HTML error page from the load balancer in
 * front of duckdns.org — was indistinguishable from a refused token.
 *
 * `reason` is truncated because the body on a bad day is a whole error page and
 * this string ends up in a log line and in the admin UI.
 */
function parseUpdate(body) {
  const lines = String(body == null ? '' : body)
    .split('\n')
    .map((l) => l.trim());
  const ok = lines[0] === 'OK';
  return {
    ok,
    ip: ok && lines[1] ? lines[1] : null,
    ipv6: ok && lines[2] ? lines[2] : null,
    changed: lines[3] === 'UPDATED',
    reason: ok ? null : (lines[0] || 'empty response').slice(0, 80)
  };
}

/**
 * How long to wait before the next attempt, given how many have failed in a row.
 *
 * Zero failures is the healthy cadence. After that, 30 s doubling to a ceiling
 * of the healthy cadence: 30 s, 60 s, 120 s, 240 s, 300 s, 300 s…
 */
function nextDelay(failures) {
  if (!failures || failures <= 0) return OK_INTERVAL_MS;
  return Math.min(RETRY_BASE_MS * Math.pow(2, failures - 1), RETRY_MAX_MS);
}

/**
 * How old the last successful update is, and whether that counts as stale.
 *
 * Never having succeeded is stale — an updater that has been enabled since boot
 * and has nothing to show for it is exactly the case the old UI painted green.
 */
function staleness(lastIpUpdate, now) {
  const at = lastIpUpdate ? Date.parse(lastIpUpdate) : NaN;
  if (!Number.isFinite(at)) return { ageMs: null, stale: true };
  const ageMs = Math.max(0, now - at);
  return { ageMs, stale: ageMs > STALE_AFTER_MS };
}

/**
 * The non-loopback IPv4 addresses this machine currently holds, as one
 * comparable string.
 *
 * Not what we send — DuckDNS detects the public address itself, and this is the
 * LAN side. It is a *change signal*: when the interface list moves, the lease
 * was renewed or the link came back, and the public address has very likely
 * moved with it.
 */
function localIpv4Signature(interfaces) {
  const list = interfaces || os.networkInterfaces() || {};
  const out = [];
  for (const ifaces of Object.values(list)) {
    for (const i of ifaces || []) {
      if (i && i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out.sort().join(',');
}

/**
 * Did the wall clock run further than the timer that was supposed to bound it?
 *
 * That gap is a suspend. Node schedules timers on a clock that stops while the
 * machine is asleep, so the wall clock is the only one of the two that saw the
 * missing hours.
 */
function clockJumped(expectedMs, actualMs) {
  return actualMs - expectedMs > CLOCK_JUMP_MS;
}

function updateUrl(domain, token, extra) {
  return (
    'https://www.duckdns.org/update?domains=' +
    encodeURIComponent(domain) +
    '&token=' +
    encodeURIComponent(token) +
    (extra || '') +
    '&verbose=true'
  );
}

// ── Network ──────────────────────────────────────────────────────────────────

/**
 * One GET, with a timeout that survives a socket that never says anything.
 *
 * `deps.httpGet` is the seam the tests use; nothing here reaches the network
 * when one is supplied.
 */
function httpGet(url, deps) {
  if (deps && deps.httpGet) return deps.httpGet(url);
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, (resp) => {
        let data = '';
        resp.setEncoding('utf8');
        resp.on('data', (c) => {
          // A body this size is not a DuckDNS reply, it is an error page. Read
          // enough to report it and stop.
          if (data.length < 4096) data += c;
        });
        resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
        resp.on('error', reject);
      })
      .on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('DuckDNS request timed out')));
  });
}

/**
 * What the authoritative nameservers are serving for this name, right now.
 *
 * Deliberately not the system resolver: the answer we want is the one that has
 * not been through anybody's cache, because a cached answer cannot distinguish
 * "the record is wrong" from "the record was wrong five minutes ago". So we ask
 * the zone's own nameservers, and only fall back to a plain lookup when that
 * chain does not come together.
 *
 * An empty array is a real answer and not an error — it means the name resolves
 * to nothing, which is the single worst state this record can be in and the one
 * we most need to be able to see.
 */
function zoneOf(fullDomain) {
  const labels = String(fullDomain || '').split('.');
  return labels.length > 2 ? labels.slice(1).join('.') : labels.join('.');
}

function resolveAuthoritative(fullDomain, deps) {
  if (deps && deps.resolveA) return deps.resolveA(fullDomain);

  const missing = (e) => e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA');
  const opts = { timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES };

  const recursive = () =>
    new Promise((resolve, reject) => {
      new dns.Resolver(opts).resolve4(fullDomain, (e, addrs) => {
        if (e) return missing(e) ? resolve([]) : reject(e);
        resolve(addrs || []);
      });
    });

  const nameserver = () =>
    new Promise((resolve) => {
      new dns.Resolver(opts).resolveNs(zoneOf(fullDomain), (nsErr, servers) => {
        if (nsErr || !servers || !servers.length) return resolve(null);
        new dns.Resolver(opts).resolve4(servers[0], (aErr, addrs) => {
          resolve(aErr || !addrs || !addrs.length ? null : addrs[0]);
        });
      });
    });

  return nameserver().then((server) => {
    if (!server) return recursive();
    return new Promise((resolve, reject) => {
      const r = new dns.Resolver(opts);
      try {
        r.setServers([server]);
      } catch {
        return recursive().then(resolve, reject);
      }
      r.resolve4(fullDomain, (e, addrs) => {
        // A server answering "no such name" is not the same as the name having
        // none. It also answers that way when it is simply not the right server
        // to ask — and a false "missing" is the expensive mistake here: it sends
        // a correction, then another, and ends up reporting a conflict that does
        // not exist. So a missing answer has to be confirmed by an ordinary
        // recursive lookup, which reaches whichever server really is
        // authoritative. Addresses, by contrast, are believed immediately: they
        // came from the source and have not sat in anybody's cache.
        if (e || !addrs || !addrs.length) return recursive().then(resolve, reject);
        resolve(addrs);
      });
    });
  });
}

/**
 * Send the address update. Resolves to the parsed reply; rejects only on a
 * transport failure.
 *
 * A non-2xx status is reported as its own reason rather than being parsed,
 * because the body in that case belongs to whatever answered instead of
 * DuckDNS.
 */
async function updateIp({ domain, token }, deps) {
  const { status, body } = await httpGet(updateUrl(domain, token), deps);
  if (status && (status < 200 || status >= 300)) {
    return { ok: false, ip: null, ipv6: null, changed: false, reason: 'HTTP ' + status };
  }
  return parseUpdate(body);
}

/**
 * Write the ACME challenge value into the name's TXT record.
 */
async function setTxt({ domain, token, value }, deps) {
  const { body } = await httpGet(updateUrl(domain, token, '&txt=' + encodeURIComponent(value)), deps);
  const r = parseUpdate(body);
  if (!r.ok) throw new Error('DuckDNS TXT update failed: ' + r.reason);
  return r;
}

/**
 * Empty the TXT record after a certificate run.
 *
 * ⚠️ **No `clear=true` here, and that is the whole point of this function.**
 * DuckDNS documents that parameter twice: on the address update it "clears both
 * your records", and on a TXT update it clears the TXT value. It is the same
 * endpoint, and what the combination `txt=` *and* `clear=true` does is not
 * documented anywhere. The old code sent exactly that combination, from the
 * final callback of the certificate routine — which runs on failure as well as
 * on success, and which retries every twelve hours for as long as a renewal
 * keeps failing. If that call was clearing the address records, the name went
 * to nothing until the next update tick, and duckdns.org's zone caches a
 * negative answer for ten minutes on top of that.
 *
 * Sending an empty `txt` empties the TXT value without ever naming the
 * parameter that can take the address with it. The caller re-asserts the
 * address immediately afterwards regardless, so a stale record cannot outlive
 * a cert run under any reading of the API.
 *
 * Never rejects. This is cleanup on a path that has already decided its own
 * outcome, and a failure to tidy up must not turn a successful renewal into a
 * failed one — a leftover challenge value is harmless, since the next run
 * overwrites it and nothing else reads it.
 */
async function clearTxt({ domain, token }, deps) {
  try {
    await httpGet(updateUrl(domain, token, '&txt='), deps);
    return true;
  } catch {
    return false;
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let timer = null;
let heartbeat = null;
let inFlight = false;

// Everything the status endpoint reports beyond what the database already
// holds. In memory on purpose: it describes this process's run, and a restart
// both clears it and performs an immediate update, so there is no window where
// a stale value here could be mistaken for a current one.
let state = null;

function freshState() {
  return {
    running: false,
    lastAttempt: null,
    lastSuccess: null,
    lastError: null,
    failures: 0,
    ticks: 0,
    observedIp: null,
    lastVerify: null,
    verifyOk: null,
    corrections: 0,
    conflict: false
  };
}

/**
 * The state the UI needs to tell a working updater from a frozen one.
 *
 * `stale` is computed against the database's own last-successful timestamp
 * rather than this process's, so an updater that has been failing since before
 * the last restart still reads as stale.
 */
function status(lastIpUpdate, now) {
  const s = state || freshState();
  const age = staleness(lastIpUpdate, typeof now === 'number' ? now : Date.now());
  return {
    running: !!timer && s.running,
    lastAttempt: s.lastAttempt,
    lastError: s.lastError,
    failures: s.failures,
    observedIp: s.observedIp,
    lastVerify: s.lastVerify,
    verifyOk: s.verifyOk,
    conflict: s.conflict,
    ageMs: age.ageMs,
    stale: age.stale
  };
}

function stop() {
  if (timer) clearTimeout(timer);
  if (heartbeat) clearInterval(heartbeat);
  timer = null;
  heartbeat = null;
  if (state) state.running = false;
}

/**
 * Start the loop, and keep it started.
 *
 * Armed whenever this is not a worktree — *including* when DuckDNS is currently
 * switched off. The old version decided once, at boot, and never looked again,
 * so a configuration that became valid afterwards (a restored backup, a row
 * edited directly) stayed dormant until somebody restarted the server. A tick
 * with nothing to do costs a database read.
 */
function start({ database, dbApi, log, skip, deps }) {
  stop();
  state = freshState();
  if (skip) {
    log('info', 'DuckDNS updater skipped', { reason: 'worktree mode' });
    return false;
  }
  state.running = true;

  const now = () => (deps && deps.now ? deps.now() : Date.now());
  let lastBeat = now();
  let lastSignature = localIpv4Signature(deps && deps.interfaces && deps.interfaces());

  const schedule = (ms) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
    if (timer.unref) timer.unref();
  };

  async function run(forced) {
    // Returning bare here would end the loop: this timer has already fired, and
    // nothing else is holding a reference to the next one. Come back shortly
    // instead — whatever is in flight is either the admin's button or a
    // correction, and both finish in seconds.
    if (inFlight) {
      schedule(RETRY_BASE_MS);
      return;
    }
    let cfg;
    try {
      cfg = dbApi.getDuckdnsCfg(database);
    } catch (e) {
      // Mid-migration, or the file is momentarily locked. Keep the loop.
      log('warn', 'DuckDNS config unreadable', { error: e.message });
      schedule(OK_INTERVAL_MS);
      return;
    }
    if (!cfg.enabled || !cfg.domain || !cfg.token) {
      schedule(OK_INTERVAL_MS);
      return;
    }

    inFlight = true;
    state.lastAttempt = new Date(now()).toISOString();
    try {
      const r = await updateIp(cfg, deps);
      if (!r.ok) throw new Error('DuckDNS returned: ' + r.reason);

      state.failures = 0;
      state.lastError = null;
      state.lastSuccess = state.lastAttempt;
      state.ticks++;
      try {
        dbApi.updateDuckdnsStatus(database, {
          lastIpUpdate: state.lastSuccess,
          lastIp: r.ip || cfg.lastIp
        });
      } catch (e) {
        // The address is updated where it counts. Failing to write our own note
        // about it is not a reason to treat the update as failed.
        log('warn', 'DuckDNS status write failed', { error: e.message });
      }
      if (r.changed || forced) log('info', 'DuckDNS IP updated', { ip: r.ip, forced: !!forced });

      // Verify after a change, on the slow rota otherwise — and always while a
      // correction is outstanding. Without that last clause a correction is
      // sent and never checked: DuckDNS answers NOCHANGE because *its* copy of
      // the record was right all along, the rota is 30 minutes away, and the
      // case this is here to catch — somebody else writing to the same name —
      // never gets counted and never gets reported.
      let correcting = false;
      if (r.changed || state.corrections > 0 || state.ticks % VERIFY_EVERY_TICKS === 1) {
        correcting = await verify(cfg, r.ip);
      }
      // A correction is a request for the *next* tick to happen now. It has to
      // be the last word on the timer, or the healthy cadence below silently
      // cancels it and the wrong record stands for another five minutes.
      schedule(correcting ? 0 : nextDelay(0));
    } catch (e) {
      state.failures++;
      state.lastError = e.message;
      const wait = nextDelay(state.failures);
      log('warn', 'DuckDNS update failed', { error: e.message, attempt: state.failures, retryInSec: wait / 1000 });
      schedule(wait);
    } finally {
      inFlight = false;
    }
  }

  /**
   * Ask the nameservers what they are serving and correct them if it is wrong.
   *
   * A mismatch buys exactly one immediate re-update. If the record is still
   * wrong after a few of those, something else is writing to this name and
   * another round of updates will not settle it — so we stop correcting, mark
   * the conflict, and let the status endpoint carry the evidence.
   *
   * Returns whether the caller should pull the next tick forward. It does not
   * touch the timer itself: the caller schedules last, and two writers on one
   * timer is how the correction got lost the first time.
   */
  async function verify(cfg, reportedIp) {
    const fullDomain = cfg.domain + '.duckdns.org';
    let served;
    try {
      served = await resolveAuthoritative(fullDomain, deps);
    } catch (e) {
      // Our own resolver failing says nothing about the record. Not a failure
      // of the update, so it must not feed the backoff.
      state.verifyOk = null;
      log('warn', 'DuckDNS verification lookup failed', { error: e.message });
      return false;
    }
    state.lastVerify = new Date(now()).toISOString();
    state.observedIp = served.length ? served.join(',') : null;

    const matches = reportedIp ? served.includes(reportedIp) : served.length > 0;
    state.verifyOk = matches;
    if (matches) {
      state.corrections = 0;
      state.conflict = false;
      return false;
    }

    if (state.corrections >= MAX_CORRECTIONS) {
      if (!state.conflict) {
        state.conflict = true;
        log('error', 'DuckDNS record keeps disagreeing after corrections — another updater may share this token', {
          expected: reportedIp,
          served: state.observedIp,
          corrections: state.corrections
        });
      }
      return false;
    }
    state.corrections++;
    log('warn', served.length ? 'DuckDNS record does not match — correcting' : 'DuckDNS record missing — restoring', {
      expected: reportedIp,
      served: state.observedIp
    });
    return true;
  }

  // The heartbeat exists for the two things a fixed timer cannot see: the
  // machine having been asleep, and the interface having come back with a
  // different lease. Both mean the public address is probably new, and both
  // would otherwise wait out the remainder of a five-minute tick that is
  // already running late.
  heartbeat = setInterval(() => {
    const t = now();
    const elapsed = t - lastBeat;
    lastBeat = t;
    const signature = localIpv4Signature(deps && deps.interfaces && deps.interfaces());
    const moved = signature !== lastSignature;
    const woke = clockJumped(HEARTBEAT_MS, elapsed);
    if (!moved && !woke) return;
    lastSignature = signature;
    log('info', 'DuckDNS update pulled forward', { reason: woke ? 'clock jump' : 'local address changed' });
    schedule(0);
  }, HEARTBEAT_MS);
  if (heartbeat.unref) heartbeat.unref();

  log('info', 'DuckDNS updater started');
  schedule(0);
  return true;
}

/**
 * Update now, for the admin's button and for the moment a cert run finishes.
 *
 * Bypasses the scheduler's backoff on purpose — somebody asked — but respects
 * the in-flight guard so a held button cannot stack requests.
 */
async function updateNow({ database, dbApi, log, skip, deps }) {
  if (skip) return { ok: false, reason: 'worktree mode' };
  const cfg = dbApi.getDuckdnsCfg(database);
  if (!cfg.enabled || !cfg.domain || !cfg.token) return { ok: false, reason: 'not configured' };
  if (inFlight) return { ok: false, reason: 'busy' };
  inFlight = true;
  const s = state || (state = freshState());
  s.lastAttempt = new Date(Date.now()).toISOString();
  try {
    const r = await updateIp(cfg, deps);
    if (!r.ok) {
      s.failures++;
      s.lastError = r.reason;
      return { ok: false, reason: r.reason };
    }
    s.failures = 0;
    s.lastError = null;
    s.lastSuccess = s.lastAttempt;
    try {
      dbApi.updateDuckdnsStatus(database, { lastIpUpdate: s.lastSuccess, lastIp: r.ip || cfg.lastIp });
    } catch (e) {
      log('warn', 'DuckDNS status write failed', { error: e.message });
    }
    return { ok: true, ip: r.ip, changed: r.changed };
  } catch (e) {
    s.failures++;
    s.lastError = e.message;
    return { ok: false, reason: e.message };
  } finally {
    inFlight = false;
  }
}

module.exports = {
  parseUpdate,
  nextDelay,
  staleness,
  localIpv4Signature,
  clockJumped,
  updateUrl,
  zoneOf,
  resolveAuthoritative,
  updateIp,
  setTxt,
  clearTxt,
  start,
  stop,
  status,
  updateNow,
  OK_INTERVAL_MS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  STALE_AFTER_MS,
  FALLBACK_AFTER_MS,
  HEARTBEAT_MS,
  CLOCK_JUMP_MS,
  VERIFY_EVERY_TICKS,
  MAX_CORRECTIONS
};
