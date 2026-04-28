// Cache version — bump this when deploying new static assets
// The SW uses network-first so cached assets only serve as offline fallback.
// Changing this version forces the old cache to be evicted on activation.
const CACHE = 'meisterpilze-v19';
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
  '/lib/jsbarcode.min.js',
  '/lib/qrcode.min.js',
  '/lib/chart.min.js',
  '/lib/html5-qrcode.min.js'
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

const queuePendingScan = (body) => _idbAdd(STORE_SCANS, body);
const getPendingScans = () => _idbGetAll(STORE_SCANS);
const deletePendingScan = (id) => _idbDelete(STORE_SCANS, id);

const queuePendingContam = (body) => _idbAdd(STORE_CONTAM, body);
const getPendingContams = () => _idbGetAll(STORE_CONTAM);
const deletePendingContam = (id) => _idbDelete(STORE_CONTAM, id);

async function _replayQueue(store, getAll, del, url) {
  const pending = await getAll();
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
      } else {
        break; // Server error — stop replay, retry later
      }
    } catch {
      break; // Still offline — stop replay
    }
  }
  notifyClients();
}

const replayPendingScans = () => _replayQueue(STORE_SCANS, getPendingScans, deletePendingScan, '/api/scan-log');
const replayPendingContams = () =>
  _replayQueue(STORE_CONTAM, getPendingContams, deletePendingContam, '/api/contamination-reports');
async function replayAll() {
  await replayPendingScans();
  await replayPendingContams();
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
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .catch(() => {})
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
    replayAll();
  }
  if (e.data && e.data.type === 'get-pending-count') {
    notifyClients();
  }
});

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
    // All other API calls: network only, offline error fallback
    e.respondWith(
      fetch(e.request).catch(
        () => new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }
  // Login page: network only — never serve stale login form from cache
  if (e.request.url.endsWith('/login.html') || e.request.url.endsWith('/login.js')) {
    e.respondWith(fetch(e.request));
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
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          // Opportunistically replay queued scans + contam reports when network
          // comes back. Cheap when the queues are empty.
          replayAll();
          return res;
        })
        .catch(() => null);
      // If we have a cached copy, serve it immediately and let the network
      // refresh happen in the background. Otherwise wait for the network.
      return cached || networked;
    })
  );
});
