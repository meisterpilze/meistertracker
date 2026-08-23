// Cache version — bump this when deploying new static assets
// Prod uses stale-while-revalidate (instant nav + offline fallback); the
// worktree/test instance (port 3001) is forced network-first below so code
// changes always show on reload. Bumping this version evicts the old cache.
const CACHE = 'meistertracker-v41';

// Test/worktree instance detection. The worktree server runs on port 3001
// (prod is 3000 / 443). On the worktree we never serve static assets from
// cache — otherwise a code change requires SW-unregister gymnastics to show
// up. self.location is the SW script URL, so .port is reliable here.
const IS_WORKTREE = self.location.port === '3001';
const ASSETS = [
  '/',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  // Vendor libs — pre-cached so the scanner and dashboard chart work on first
  // offline navigation (sw fetch handler is network-first, so without explicit
  // pre-caching these wouldn't be in the cache until they'd been fetched once).
  // P-02: app.js no longer eager-loads these via <script> tags; the in-app
  // loadVendorLibs() helper injects them on demand. They stay in the SW
  // pre-cache so the first offline use of the scanner / charts / labels
  // still finds them.
  '/lib/jsbarcode.min.js',
  '/lib/qrcode.min.js',
  '/lib/chart.min.js',
  '/lib/html5-qrcode.min.js',
  // P-03: per-locale language files. Pre-cache the default 'de' so first
  // load offline still has translations; en/pt are fetched on demand.
  '/lang/de.js'
];

// ── IndexedDB offline queues ────────────────────────────────
// Two stores under the same DB:
//   pending-scans         — POSTs to /api/scan-log (since v1)
//   pending-contam-reports — POSTs to /api/contamination-reports (added v2)
// Both queue the JSON body; replay POSTs it untouched. Schema change requires
// IDB_VERSION bump so onupgradeneeded fires for existing installs.
const IDB_NAME = 'meister-offline';
const IDB_VERSION = 2;
const STORE_SCANS = 'pending-scans';
const STORE_CONTAM = 'pending-contam-reports';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SCANS)) {
        db.createObjectStore(STORE_SCANS, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_CONTAM)) {
        db.createObjectStore(STORE_CONTAM, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function _idbAdd(store, body) {
  return openIDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).add({ body, queuedAt: new Date().toISOString() });
        tx.oncomplete = () => {
          resolve();
          notifyClients();
        };
        tx.onerror = () => reject(tx.error);
      })
  );
}
// Overwrite an existing queued record in place (keyPath id preserved on the
// object). Used to remove one entry from a multi-entry queued POST without
// dropping the whole record — see dropQueuedScan.
function _idbPut(store, record) {
  return openIDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}
function _idbGetAll(store) {
  return openIDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}
function _idbDelete(store, id) {
  return openIDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

// R-21: cap the scan queue. A 12-hour offline window with one rapid scanner
// can pile thousands of entries into IndexedDB; the IDB quota then rejects
// adds silently with no notification, and reconnect blasts the server with
// sequential POSTs (Phase 2 idempotency prevents duplicate writes but the
// server is unhappy). 500 ≈ 2× a typical lab-day scan count. Drop oldest on
// overflow (FIFO) — the user is offline anyway and the oldest scans are the
// least likely to still be relevant.
const SCAN_QUEUE_MAX = 500;

async function queuePendingScan(body) {
  const all = await getPendingScans();
  if (all.length >= SCAN_QUEUE_MAX) {
    const dropCount = all.length - SCAN_QUEUE_MAX + 1;
    for (let i = 0; i < dropCount; i++) {
      try {
        await deletePendingScan(all[i].id);
      } catch {
        /* best-effort eviction */
      }
    }
    self.clients.matchAll().then((clients) => {
      for (const c of clients) {
        c.postMessage({ type: 'scan-queue-overflow', dropped: dropCount, max: SCAN_QUEUE_MAX });
      }
    });
  }
  return _idbAdd(STORE_SCANS, body);
}
const getPendingScans = () => _idbGetAll(STORE_SCANS);
const deletePendingScan = (id) => _idbDelete(STORE_SCANS, id);

const queuePendingContam = (body) => _idbAdd(STORE_CONTAM, body);
const getPendingContams = () => _idbGetAll(STORE_CONTAM);
const deletePendingContam = (id) => _idbDelete(STORE_CONTAM, id);

async function _replayQueue(store, getAll, del, url) {
  const pending = await getAll();
  // R-22: track whether we hit a server-side failure (5xx) so the caller
  // can apply exponential backoff. Network errors and 401s are NOT server
  // failures — they don't deserve a long cooldown.
  let serverFailure = false;
  for (const item of pending) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', // Include session cookie for user attribution
        body: JSON.stringify(item.body)
      });
      if (resp.ok) {
        await del(item.id);
      } else if (resp.status === 401) {
        // Session expired — keep queued, notify client to re-auth
        notifyClients();
        return;
      } else if (resp.status === 409) {
        // Conflict (I-12): server rejected the entry because state
        // changed since it was queued (e.g. an admin moved the bag to a
        // different zone via the web UI before this offline scan replayed).
        // Retrying can't help — drop the entry and surface the rejection so
        // the user can reconcile manually.
        let detail = null;
        try {
          detail = await resp.json();
        } catch {
          /* ignore body parse errors */
        }
        await del(item.id);
        self.clients.matchAll().then((clients) => {
          for (const c of clients) {
            c.postMessage({ type: 'scan-replay-rejected', reason: 'zone_mismatch', detail });
          }
        });
      } else if (resp.status >= 500) {
        // R-22: 5xx — the server is unhealthy. Stop replay and signal the caller
        // so it can apply exponential backoff before retrying.
        serverFailure = true;
        break;
      } else {
        // Any other 4xx: the server has judged this specific entry unacceptable
        // (400 from validateScanEntries, 413 oversize, 507 photo store full).
        // Retrying cannot change that, so drop it and tell the client — exactly
        // as the 409 branch does.
        //
        // Previously this fell into the 5xx branch, which broke WITHOUT deleting
        // and without setting serverFailure. _replayQueue then returned normally,
        // so replayAll() resolved and reset _replayFailureCount/_replayCooldownUntil
        // — the failure actively cleared the backoff it should have triggered.
        // With scheduleReplay() firing on every asset fetch behind a 1 s debounce,
        // one 507'd 1.2 MB contamination report re-uploaded itself about once a
        // second for as long as the user browsed, and everything queued behind it
        // was stuck for good with no operator-visible signal.
        let detail = null;
        try {
          detail = await resp.json();
        } catch {
          /* ignore body parse errors */
        }
        await del(item.id);
        self.clients.matchAll().then((clients) => {
          for (const c of clients) {
            c.postMessage({ type: 'scan-replay-rejected', reason: 'rejected_' + resp.status, detail });
          }
        });
      }
    } catch {
      break; // Still offline — stop replay (no backoff; network errors retry naturally)
    }
  }
  notifyClients();
  if (serverFailure) {
    throw new Error('replay-server-failure');
  }
}

const replayPendingScans = () => _replayQueue(STORE_SCANS, getPendingScans, deletePendingScan, '/api/scan-log');
const replayPendingContams = () =>
  _replayQueue(STORE_CONTAM, getPendingContams, deletePendingContam, '/api/contamination-reports');

// R-22: every successful asset fetch in the SW's stale-while-revalidate
// branch was triggering replayAll(), so a single page load with 50 assets
// fired 50 replays in quick succession. Phase 2 idempotency prevents
// duplicate writes but the server gets flogged. Solution:
//   1. 1-second debounce — collapse bursts.
//   2. On 5xx response, set a cooldown 30s in the future; back off
//      exponentially up to 5 minutes after consecutive failures.
//   3. Reset failure count on first successful replay.
let _replayDebounceTimer = null;
let _replayCooldownUntil = 0;
let _replayFailureCount = 0;

function scheduleReplay() {
  if (_replayDebounceTimer) return;
  if (Date.now() < _replayCooldownUntil) return;
  _replayDebounceTimer = setTimeout(() => {
    _replayDebounceTimer = null;
    replayAll().catch(() => {});
  }, 1000);
}

async function replayAll() {
  try {
    await replayPendingScans();
    await replayPendingContams();
    // First successful pass after a streak of failures clears the backoff.
    _replayFailureCount = 0;
    _replayCooldownUntil = 0;
  } catch (e) {
    _replayFailureCount++;
    const cooldownSec = Math.min(30 * Math.pow(2, _replayFailureCount - 1), 300);
    _replayCooldownUntil = Date.now() + cooldownSec * 1000;
    throw e;
  }
}

function notifyClients() {
  self.clients.matchAll().then((clients) => {
    Promise.all([getPendingScans().catch(() => []), getPendingContams().catch(() => [])])
      .then(([scans, contams]) => {
        const msg = {
          type: 'offline-queue-update',
          // Existing clients read pendingCount as the total — keep that contract.
          pendingCount: scans.length + contams.length,
          pendingScans: scans.length,
          pendingContams: contams.length
        };
        clients.forEach((c) => c.postMessage(msg));
      })
      .catch(() => {});
  });
}

// ── Service Worker lifecycle ────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Precache each asset independently rather than via the atomic
      // cache.addAll(): one missing asset (e.g. a 404 icon) shouldn't drop the
      // whole set. Critically, skip any response that came via a redirect.
      // The app shell (/, /app.js, /styles.css, /lang/de.js) sits behind the
      // session auth gate; if install runs while the session is invalid those
      // requests 302 to /login.html, which fetch() transparently follows to a
      // 200. Caching that login HTML under an asset key poisons the cache —
      // the browser then parses the login page as CSS (unstyled UI) and as a
      // script (i18n dictionary never loads → raw keys like dash.zoneTent1).
      // res.redirected is true for exactly that followed-302 case, so it's the
      // precise guard. A poisoned entry only clears on a CACHE version bump.
      Promise.all(
        ASSETS.map((url) =>
          fetch(url, { credentials: 'same-origin' })
            .then((res) => {
              if (res.ok && !res.redirected) return cache.put(url, res);
            })
            .catch(() => {})
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Evict all caches that don't match the current version
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'replay-pending') {
    scheduleReplay();
  }
  if (e.data && e.data.type === 'get-pending-count') {
    notifyClients();
  }
  // Undo of a scan that is still sitting in the offline queue. The page cannot
  // DELETE it server-side — the server has never seen it — so the only way to
  // honour the undo is to drop it here before replay. Without this the entry
  // replayed after reconnect and the "undone" scan came back on the next poll,
  // silently removing the bag again.
  if (e.data && e.data.type === 'drop-queued-scan' && e.data.clientUuid) {
    e.waitUntil(dropQueuedScan(e.data.clientUuid));
  }
});

// Remove any queued scan-log entry carrying this client_uuid. Entries are stored
// as the whole POST body ({entries: [...]}), so an entry may be one of several in
// a batch — drop just that one, and the record only when it empties.
async function dropQueuedScan(clientUuid) {
  try {
    const pending = await getPendingScans();
    for (const item of pending) {
      const list = (item.body && item.body.entries) || [];
      const keep = list.filter((x) => x && x.client_uuid !== clientUuid);
      if (keep.length === list.length) continue;
      if (keep.length === 0) await deletePendingScan(item.id);
      else await _idbPut(STORE_SCANS, Object.assign({}, item, { body: { entries: keep } }));
    }
    notifyClients();
  } catch (err) {
    /* best-effort: a failure here leaves the entry queued, which is the old behaviour */
  }
}

// A request that failed while the browser believed it was online, said once.
//
// Once, because a dead API means every poll, every SSE retry and every save
// takes this path — a line per request buries the one line that explains it.
// And said at all, because the alternative is what happened: the only trace of
// a TLS failure was a 503 the worker invented, indistinguishable in the network
// panel from a server that was genuinely down.
// What a failed API request should say it was. Pure, so it can be tested
// without a network, a certificate or a browser.
//
// `online` is navigator.onLine, which is only trustworthy in the negative:
// false means there is genuinely no connection; true means the browser has an
// interface up and nothing more. So false is the only thing that earns the word
// "offline", and everything else is "unreachable" — carrying the real reason,
// because that is the sentence that was missing.
function _apiFailureBody(err, online, url) {
  const reason = (err && (err.message || err.name)) || 'fetch failed';
  return {
    error: online ? 'unreachable' : 'offline',
    reason: online ? reason : 'no network connection',
    url: url
  };
}

const _unreachableSeen = new Set();
function _warnUnreachable(url, reason) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = url;
  }
  if (_unreachableSeen.has(origin)) return;
  _unreachableSeen.add(origin);
  console.error(
    '[meistertracker sw] cannot reach ' +
      origin +
      ' — ' +
      reason +
      '. The browser reports it is online, so this is not an offline device: a certificate that does not ' +
      'cover this hostname, a stopped server, or a blocked port. A page can carry a click-through ' +
      'certificate exception; this worker cannot, so the app will look disconnected until it is fixed.'
  );
}

// ── Fetch handler ───────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  // API calls
  if (e.request.url.includes('/api/')) {
    // Special: queue scan-log POSTs when offline
    if (e.request.method === 'POST' && e.request.url.includes('/api/scan-log')) {
      e.respondWith(
        fetch(e.request.clone()).catch(async () => {
          const body = await e.request.json();
          await queuePendingScan(body);
          return new Response(JSON.stringify({ ok: true, queued: true }), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
      );
      return;
    }
    // Special: queue contamination-report POSTs when offline. The body carries
    // the report JSON + base64-encoded photos; cap the queue at 20 items so
    // a sustained outage doesn't blow IndexedDB quota (each report is up to
    // ~1.2 MB in the worst case of 4 photos, so 20 ≈ 24 MB).
    if (e.request.method === 'POST' && /\/api\/contamination-reports(\?|$)/.test(e.request.url)) {
      e.respondWith(
        fetch(e.request.clone()).catch(async () => {
          try {
            const body = await e.request.json();
            const existing = await getPendingContams();
            if (existing.length >= 20) {
              return new Response(JSON.stringify({ error: 'queue_full' }), {
                status: 507,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            await queuePendingContam(body);
            return new Response(JSON.stringify({ queued: true, photoIds: [] }), {
              headers: { 'Content-Type': 'application/json' }
            });
          } catch {
            return new Response(JSON.stringify({ error: 'offline_queue_failed' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        })
      );
      return;
    }
    // All other API calls: network only. A failure here is reported as what it
    // actually was, which used to be a single word: "offline".
    //
    // fetch() rejects for reasons that have nothing to do with the network. The
    // one that cost a day: a Let's Encrypt certificate covers the public
    // hostname and cannot cover localhost, so the moment the server restarted
    // onto a renewed cert, every request to https://localhost:PORT failed the
    // hostname check. A page can carry a click-through exception; a service
    // worker cannot. So the worker's fetch died on TLS, this line called it
    // "offline", and an app whose server was healthy the whole time reported
    // itself disconnected — with the real reason visible nowhere.
    //
    // navigator.onLine is the only thing that actually knows about the network,
    // and it is only trustworthy in the negative: false means there is no
    // connection, true means little. That asymmetry is the whole distinction —
    // say "offline" when the browser says so, and "unreachable" plus the
    // underlying message when it does not.
    e.respondWith(
      fetch(e.request).catch((err) => {
        const body = _apiFailureBody(err, self.navigator.onLine, e.request.url);
        if (body.error === 'unreachable') _warnUnreachable(e.request.url, body.reason);
        return new Response(JSON.stringify(body), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }
  // Worktree/test instance: network-first for every non-API request so a code
  // change always shows up on a plain reload. Falls back to cache only when
  // truly offline (localhost rarely is). Prod keeps stale-while-revalidate
  // below for fast navigation + offline PWA use.
  if (IS_WORKTREE) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Compute the pathname once — used by the login guard and the app-shell
  // network-first branch below. Comparing pathname (not the full URL) means a
  // query string such as /login.html?redirect=… still matches the guard.
  const path = new URL(e.request.url).pathname;
  // Login page: network only — never serve stale login form from cache
  if (path === '/login.html' || e.request.url.endsWith('/login.js')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // App shell — navigations (/, /index.html), /app.js AND /lang/*.js:
  // network-first with a short timeout so a fresh deploy replaces stale app code
  // on the next reload instead of serving the previous build from cache. On
  // success, cache the clone and return it; on timeout/offline, fall back to the
  // cached copy. Mirrors the IS_WORKTREE network-first branch above, but keeps
  // the cache write so offline navigation still works.
  //
  // The lang files MUST travel with app.js: t() falls back to printing the raw
  // key, so a fresh app.js paired with a stale cached locale renders new strings
  // as "zoneCheck.btn" instead of the translation.
  //
  // styles.css travels with them for the same reason, one layer over: its URL
  // carries no version either, it changes on every deploy that touches a rule,
  // and app.js writes markup that expects the rules of its own build. Left on
  // stale-while-revalidate it arrived one reload late — new markup laid out by
  // the previous stylesheet, which reads as a broken page rather than an old
  // one. Vendor libs and icons keep stale-while-revalidate below: /lib/ is
  // pinned and genuinely immutable, icons do not pair with anything.
  if (
    path === '/' ||
    path === '/index.html' ||
    path === '/app.js' ||
    path === '/styles.css' ||
    path.startsWith('/lang/')
  ) {
    e.respondWith(
      fetch(e.request, { signal: AbortSignal.timeout(3000) })
        .then((res) => {
          // !res.redirected: never cache a followed auth redirect (a lapsed
          // session 302s to /login.html); returning it is fine, but caching
          // it under the shell key would poison the cache until the next bump.
          if (res && res.ok && !res.redirected) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          scheduleReplay();
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // Everything else — stale-while-revalidate. Serve cache instantly (so
  // navigation never waits for the network on flaky lab WiFi), then refresh
  // the cache in the background. The CACHE version bump on activate purges
  // stale caches across deploys, so users still see new builds within one
  // page reload after deploy.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const networked = fetch(e.request)
        .then((res) => {
          // !res.redirected: never overwrite a real asset with a followed
          // auth redirect. When the session lapses, an asset fetch 302s to
          // /login.html and fetch() follows it to a 200 — caching that under
          // the asset key would serve login HTML as CSS/JS (unstyled UI +
          // untranslated i18n keys) until the next CACHE bump.
          if (res && res.ok && !res.redirected) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          // Opportunistically replay queued scans + contam reports when network
          // comes back. Cheap when the queues are empty. R-22: scheduleReplay
          // debounces bursts (asset fetches during a page load can fire 50+
          // times in quick succession) and applies exponential backoff on
          // server errors so we don't flog a struggling server.
          scheduleReplay();
          return res;
        })
        .catch(() => null);
      // If we have a cached copy, serve it immediately and let the network
      // refresh happen in the background. Otherwise wait for the network.
      return cached || networked;
    })
  );
});
