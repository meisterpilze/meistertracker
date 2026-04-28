// Cache version — bump this when deploying new static assets
// The SW uses network-first so cached assets only serve as offline fallback.
// Changing this version forces the old cache to be evicted on activation.
const CACHE = 'meisterpilze-v17';
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

// ── IndexedDB helpers for offline scan queue ────────────────
const IDB_NAME = 'meister-offline';
const IDB_VERSION = 1;
const STORE_NAME = 'pending-scans';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queuePendingScan(body) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({ body, queuedAt: new Date().toISOString() });
    tx.oncomplete = () => {
      resolve();
      notifyClients();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function getPendingScans() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deletePendingScan(id) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function replayPendingScans() {
  const pending = await getPendingScans();
  for (const item of pending) {
    try {
      const resp = await fetch('/api/scan-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', // Include session cookie for user attribution
        body: JSON.stringify(item.body)
      });
      if (resp.ok) {
        await deletePendingScan(item.id);
      } else if (resp.status === 401) {
        // Session expired — keep scans queued, notify client to re-auth
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

function notifyClients() {
  self.clients.matchAll().then((clients) => {
    getPendingScans()
      .then((pending) => {
        const msg = { type: 'offline-queue-update', pendingCount: pending.length };
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
    replayPendingScans();
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
  // Everything else — network first, fall back to cache for offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        // Opportunistically replay queued scans when network is available
        replayPendingScans();
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
