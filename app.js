// ══════════════════════════════════════════════════════════════
// Active frontend — uses atomic REST endpoints (apiPost/apiPatch/apiDelete).
// ══════════════════════════════════════════════════════════════

// ─── P-02: lazy vendor-lib loader ────────────────────────────
// The four vendor libs (jsbarcode, qrcode, chart, html5-qrcode) total
// ~660 KB raw / ~195 KB gzip. Loading them as eager <script defer> tags
// in index.html still costs parse+compile time on every page load, even
// for phones that never open the camera or print labels.
//
// Strategy (fallback per the audit's punch-list — full async wiring of
// every callsite was scoped down): inject them *after* DOMContentLoaded
// when the browser is idle. Critical-path JS (login, dashboard render,
// scan log replay) doesn't depend on these libs, so deferring them
// doesn't change any user-visible flow except on a *very* fresh first
// load when a user instantly taps the camera FAB before idle fires —
// the loader synchronously promotes to active loading in that case.
const _loadedScripts = new Map();
function loadScript(src) {
  if (_loadedScripts.has(src)) return _loadedScripts.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
  _loadedScripts.set(src, p);
  return p;
}
let _vendorLibsReady = null;
function loadVendorLibs() {
  if (_vendorLibsReady) return _vendorLibsReady;
  _vendorLibsReady = Promise.all([
    loadScript('/lib/jsbarcode.min.js'),
    loadScript('/lib/qrcode.min.js'),
    loadScript('/lib/chart.min.js'),
    loadScript('/lib/html5-qrcode.min.js')
  ]);
  return _vendorLibsReady;
}
// Kick off the idle preload once the DOM is ready. Never blocks the main
// render path. Falls back to setTimeout on browsers without
// requestIdleCallback.
function _kickIdleVendorPreload() {
  const ric = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
  ric(() => {
    loadVendorLibs().catch((err) => console.warn('Vendor lib preload failed:', err));
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _kickIdleVendorPreload, { once: true });
} else {
  _kickIdleVendorPreload();
}

// ─── I18N ────────────────────────────────────────────────────
let currentLang = localStorage.getItem('mp-lang') || 'de';
const LOCALE_MAP = { en: 'en-GB', de: 'de-DE', pt: 'pt-BR' };
function loc() {
  return LOCALE_MAP[currentLang];
}
function fmtDt(d) {
  if (!(d instanceof Date)) d = new Date(d);
  const dd = String(d.getDate()).padStart(2, '0'),
    mm = String(d.getMonth() + 1).padStart(2, '0'),
    yy = String(d.getFullYear()).slice(-2);
  return dd + '.' + mm + '.' + yy;
}
function fmtDtTime(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return fmtDt(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function fmtDtShort(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
}
function isoWeekNumber(d) {
  if (!(d instanceof Date)) d = new Date(d);
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp - yearStart) / 864e5 + 1) / 7);
}
function t(key, params) {
  const str = (LANG[currentLang] && LANG[currentLang][key]) || (LANG['en'] && LANG['en'][key]) || key;
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : '{' + k + '}'));
}
function tp(key, n) {
  return t(key + (n === 1 ? '.one' : '.other'), { n });
}
function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('mp-lang', lang);
  document.getElementById('lang-sel').value = lang;
  // P-03: lazy-load the new locale on switch. The first switch fetches the
  // file; subsequent switches reuse the cached translations.
  loadLang(lang)
    .then(() => {
      translatePage();
      refresh();
    })
    .catch((err) => console.error('Locale load failed:', err));
}
function translatePage() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
  document.documentElement.lang = currentLang;
}
// P-03: i18n strings live in /lang/<code>.js. Loaded on demand by `loadLang`
// (kicked off at startup with the user's current locale, and again whenever
// `setLang` switches locales). Bundling all three locales in app.js used to
// add ~174 KB raw / ~52 KB gzip to every page load — now only the active
// locale's bytes are fetched and parsed. Other locales are pulled lazily
// the first time the user picks them.
//
// `window.LANG` is populated by each lang/<code>.js file (each file does
// `window.LANG['<code>'] = { ... }`). The `LANG` reference below is just
// a stable handle for `t()` / `tp()` / `translatePage()` — it points at the
// same object, so once a locale file has loaded its strings are visible
// here without any additional plumbing.
const LANG = (window.LANG = window.LANG || {});
const _langPromises = new Map();
function loadLang(code) {
  if (LANG[code]) return Promise.resolve();
  let p = _langPromises.get(code);
  if (p) return p;
  // ?v=2 is a one-time cache-buster. /lang/*.js was served
  // "max-age=31536000, immutable" against an unversioned URL, so any client that
  // had fetched a locale kept it for a year and never saw newly added keys —
  // t() then printed the raw key. The header is now max-age=300, but a client
  // already holding the immutable copy would never ask again; a different URL is
  // the only thing that reaches it. Future string changes need no bump.
  p = loadScript('/lang/' + code + '.js?v=2');
  _langPromises.set(code, p);
  return p;
}

// ─── CONSTANTS ───────────────────────────────────────────────
const ACTIONS = ['ADD', 'MOVE', 'MOVE_BATCH', 'REMOVE', 'HARVEST', 'CONTAM'];
let ZONES = [],
  ALL_RACKS = [],
  LOCS = [],
  RACK_ZONE = {},
  // id -> full zone object. Built once per applyData / zone edit so callers
  // that need .role / .color / etc. can do an O(1) lookup instead of zones.find().
  // Hot path: dashboard contam-rate (renderOverviewKPIs) iterated all scan-log
  // entries x zones.find() = O(scanLog * zones).
  ZONE_BY_ID = {};
// batchId -> batch. Same reasoning as ZONE_BY_ID: the dashboard resolved a batch
// per task row with batches.find(), which is ~100 rows x ~140 batches of string
// comparison on every render, every 30s poll and every tab tap.
//
// Revalidated on length rather than rebuilt at each write site: createBatch and
// createGrainBatch push optimistically and splice back on failure, so a map built
// only in applyData would miss a just-created batch until the next sync. Length is
// the only thing those paths change, and a push-then-splice rollback moves it
// twice, so both directions self-correct.
let _batchById = new Map();
function batchById(id) {
  if (_batchById.size !== batches.length) _batchById = new Map(batches.map((b) => [b.batchId, b]));
  return _batchById.get(id);
}
const toZone = (loc) => {
  if (!loc) return loc;
  if (RACK_ZONE[loc]) return RACK_ZONE[loc];
  if (ZONES.includes(loc)) return loc;
  const z = ZONES.find((z) => loc.startsWith(z + '_'));
  return z || loc;
};
// ABBR removed — kuerzel comes from mushroomStrains (Pilzsorten) now.
// Fallback ramp for species with no entry in SP_REAL below.
const SP_COLORS = [
  '#e11d48',
  '#0284c7',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#0d9488',
  '#ea580c',
  '#db2777',
  '#0891b2',
  '#65a30d'
];
// Species colours approximate what the mushroom actually looks like, so the dot
// is recognisable instead of decorative. Keyed on the species name with any
// " (KUERZEL)" suffix stripped — batches carry both "Blue Oyster" and
// "Blue Oyster (BO)", which the old raw-string key treated as two species and
// coloured differently.
//
// Realism is bent where it would cost legibility: Shiitake, Chestnut, Pioppino
// and Maitake are all brown in life, which at a 10px dot is four of the same
// colour. They are spread across hue and roughly 25 / 40 / 65 / 85 lightness so
// no two read alike — chestnut pushed orange, pioppino cooled to olive, maitake
// taken fully grey. Phoenix is nudged toward salmon so it parts from King Oyster
// tan, and Pearl Oyster to blue-grey so it parts from Maitake.
// Growth stages, in order. The split-batch card colours by stage, taking the hue
// from the operator's own zone config so it matches the Zonen page and the
// pipeline KPI strip; the fallbacks are the KPI defaults.
const STAGE_SEQ = ['spawn', 'incubation', 'fruiting'];
const STAGE_FALLBACK = { spawn: '#a855f7', incubation: '#0ea5e9', fruiting: '#10b981' };
function stageColor(role) {
  const z = zones.find((x) => x.role === role && x.color);
  return (z && z.color) || STAGE_FALLBACK[role] || '#888888';
}
const SP_REAL = {
  'pink oyster': '#E8618C',
  'blue oyster': '#4A7FB5',
  'yellow oyster': '#E8B92E',
  cordyceps: '#E8701A',
  chestnut: '#C8721F',
  reishi: '#8E2B20',
  shiitake: '#4A2E18',
  pioppino: '#6E6046',
  'king oyster': '#C8A275',
  'phoenix oyster': '#D9A08A',
  'phoenix oyster mushroom': '#D9A08A',
  maitake: '#A9A49B',
  'pearl oyster': '#8FA3B0',
  'lions mane': '#EDE7DA',
  "lion's mane": '#EDE7DA',
  'black pearl king oyster': '#2B2F36'
};
let REF_GROUPS = [];
// ZPL label dimensions in dots, populated from /api/data labelDims
// (server reads LABEL_WIDTH_DOTS / LABEL_HEIGHT_DOTS env). Default
// 400×240 = 50×30mm at 203dpi (Zebra GK420d small label).
const labelDims = { widthDots: 400, heightDots: 240 };
// Whether the harvest feed reports releases, from /api/data harvestRelease.
// Default off, so a server that does not send the flag hides the field rather
// than offering one that goes nowhere.
const harvestRelease = { on: false };
const KNOWN_ZONE_I18N = {
  SPAWN: 'dash.zoneSpawn',
  INC: 'dash.zoneInc',
  TENT1: 'dash.zoneTent1',
  TENT2: 'dash.zoneTent2',
  TENT3: 'dash.zoneTent3',
  CONTAM: 'dash.zoneContam'
};
function zoneDisplayName(id) {
  if (!id) return id;
  if (KNOWN_ZONE_I18N[id]) return t(KNOWN_ZONE_I18N[id]);
  const z = zones.find((x) => x.id === id);
  if (z) return z.name;
  // Try as rack ID: find parent zone and return "ZoneName / rackSuffix"
  for (const zone of zones) {
    const rack = zone.racks.find((r) => r.id === id);
    if (rack) return (zone.name || zone.id) + '/' + (id.slice(zone.id.length + 1) || id);
  }
  return id;
}
function zoneByRole(role) {
  return zones.filter((z) => z.role === role);
}
function rebuildZoneConstants() {
  ZONES = zones.map((z) => z.id);
  ALL_RACKS = zones.flatMap((z) => z.racks.map((r) => r.id));
  LOCS = [...ZONES, ...ALL_RACKS];
  RACK_ZONE = {};
  ZONE_BY_ID = {};
  zones.forEach((z) => {
    ZONE_BY_ID[z.id] = z;
    z.racks.forEach((r) => {
      RACK_ZONE[r.id] = z.id;
    });
  });
  ZONE_LABELS = {};
  ZONE_COLORS = {};
  zones.forEach((z) => {
    ZONE_LABELS[z.id] = KNOWN_ZONE_I18N[z.id] || z.name;
    ZONE_COLORS[z.id] = z.color;
  });
  locColor = { ...ZONE_COLORS };
  // Actions + Quantities stay as text barcodes; Zones + Racks use numeric barcodes
  REF_GROUPS = [
    {
      g: 'Actions',
      items: ['ADD', 'MOVE', 'MOVE_BATCH', 'REMOVE', 'HARVEST', 'CONTAM'].map((a) => ({ val: a, label: a }))
    }
  ];
  REF_GROUPS.push({
    g: 'Zones',
    items: ZONES.map((z) => {
      const bc = barcodeByEntity.get('zone:' + z);
      return { val: bc ? String(bc) : z, label: z };
    })
  });
  zones
    .filter((z) => z.racks.length > 0)
    .forEach((z) => {
      const rIds = z.racks.map((r) => r.id);
      for (let i = 0; i < rIds.length; i += 5) {
        const chunk = rIds.slice(i, i + 5);
        const label = z.name + ' Racks ' + (i + 1) + '–' + (i + chunk.length);
        REF_GROUPS.push({
          g: label,
          items: chunk.map((r) => {
            const bc = barcodeByEntity.get('rack:' + r);
            return { val: bc ? String(bc) : r, label: r };
          })
        });
      }
    });
}

// ─── DATA ────────────────────────────────────────────────────
let mushroomStrains = [],
  batches = [],
  scanLog = [],
  movements = [],
  manualTasks = [],
  harvests = [],
  cultures = [],
  inventory = {},
  teamMembers = [],
  caldav = {},
  duckdns = {},
  zones = [],
  suppliers = [],
  weekRhythm = {},
  rhythmTasks = [];
// Numeric barcode registry: Map<number, {type, id}> and reverse Map<string, number>
let barcodeRegistry = new Map(),
  barcodeByEntity = new Map();
let appUsers = [];
let calEvSelectedAssignees = [];
let calTaskSelectedAssignees = [];
let scan = { action: null, from: null, to: null, count: 0, harvestBag: null };
let confirmCb = null,
  noteId = null,
  saving = false,
  lastHash = '';
const spMap = {};
// "Blue Oyster (BO)" and "Blue Oyster" must land on the same key, or the same
// mushroom gets two colours — which is what happened, since batches store both.
function _spKey(s) {
  return String(s || '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    .toLowerCase();
}
// Anything outside SP_REAL is coloured from a hash of its own name, so it is at
// least STABLE. The previous code indexed the ramp by insertion order
// (SP_COLORS[Object.keys(spMap).length % …]), so a species took whatever colour
// was next when it happened to be drawn first — different per card, different
// after a reload.
function _spHashColor(k) {
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return SP_COLORS[h % SP_COLORS.length];
}
const spColor = (s) => {
  const k = _spKey(s);
  if (!k) return '#888888';
  if (!spMap[k]) spMap[k] = SP_REAL[k] || _spHashColor(k);
  return spMap[k];
};
const spDot = (s) => `<span class="sp-dot" style="background:${spColor(s)}"></span>`;

// ─── HTML ESCAPING ──────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Parse a user-entered decimal that may use a German comma as the decimal
// separator ("1,5" → 1.5, "1.234,5" → 1234.5). The app's default language is
// German and the quantity inputs are type=text inputmode=decimal, so mobile
// keyboards offer a comma — plain parseFloat('847,5') silently returns 847.
// Returns NaN for unparseable input; callers apply `|| 0` / Number.isFinite
// exactly as before.
function parseDecimal(v) {
  if (v == null) return NaN;
  let s = String(v).trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(s);
}
// Record a scan entry's server-side id once its POST resolves. If the user
// undid the entry before the POST landed (no _serverId yet → the undo set
// _undoPending), delete the now-known row so it doesn't resurface on the next
// sync.
function setEntryServerId(entry, id) {
  if (!entry || !id) return;
  entry._serverId = id;
  if (entry._undoPending) apiDelete('/api/scan-log/' + id);
}
// Undo an entry the server has never seen because it is still in the service
// worker's offline queue. A DELETE would 404 — the only way to honour the undo
// is to drop it from the queue before it replays.
function dropQueuedScanEntry(entry) {
  if (!entry || !entry.client_uuid) return false;
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return false;
  navigator.serviceWorker.controller.postMessage({ type: 'drop-queued-scan', clientUuid: entry.client_uuid });
  return true;
}
function safeHref(url) {
  if (!url) return '';
  const u = String(url).trim();
  return /^https?:\/\//i.test(u) ? esc(u) : '';
}
function safeColor(c, fallback) {
  if (!c) return fallback || '#16a34a';
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback || '#16a34a';
}

// ─── AUTH ────────────────────────────────────────────────────
let currentUser = null;
let dashMode = localStorage.getItem('mp-dash-mode') || 'farm';
let ovPeriod = localStorage.getItem('mp-ov-period') || 'week';
async function authFetch(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 401) {
    window.location.href = '/login.html';
    throw new Error('unauthorized');
  }
  return r;
}
function _apiCall(method, path, body) {
  _mutating++;
  setSyncStatus('busy', 'Saving...');
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return authFetch(path, opts)
    .then((r) => {
      return r
        .json()
        .catch(() => ({}))
        .then((d) => {
          _mutating--;
          if (!r.ok) {
            const msg = d.error || 'HTTP ' + r.status;
            setSyncStatus('err', msg);
            return d.error ? d : { error: msg };
          }
          if (_mutating === 0) setSyncStatus('ok', 'Saved · gerade eben');
          return d;
        });
    })
    .catch((e) => {
      _mutating--;
      setSyncStatus('err', 'Save error: ' + (e.message || 'check server'));
      console.error('API error:', method, path, e);
      return { error: e.message || 'Network error' };
    });
}
function apiPost(path, body) {
  return _apiCall('POST', path, body);
}
function apiPatch(path, body) {
  return _apiCall('PATCH', path, body);
}
function apiPut(path, body) {
  return _apiCall('PUT', path, body);
}
function apiDelete(path) {
  return _apiCall('DELETE', path);
}
// Lightweight GET for reads — doesn't toggle the mutating/sync indicator.
async function apiGet(path) {
  const r = await authFetch(path);
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || 'HTTP ' + r.status);
  }
  return r.json();
}
async function invDelta(mat, deltaKg, type, ref) {
  return apiPost('/api/inventory/delta', { mat, deltaKg, type, ref });
}
async function invDeltas(deltas) {
  for (const d of deltas) await invDelta(d.mat, d.deltaKg, d.type, d.ref);
}
async function invSetAbsolute(mat, value, type, ref) {
  return apiPost('/api/inventory/set', { mat, value, type, ref });
}
async function saveInvConfig() {
  return apiPost('/api/inventory/config', {
    thresholds: inventory.thresholds,
    avgComposition: inventory.avgComposition
  });
}
async function saveLabThresholds() {
  return apiPost('/api/lab-thresholds', { labThresholds: inventory.labThresholds });
}
async function loadCurrentUser() {
  try {
    const r = await authFetch('/api/auth/me');
    currentUser = await r.json();
  } catch (e) {
    if (e.message !== 'unauthorized') console.error('Auth check failed:', e);
  }
  showServerTab();
  showMcpTab();
  showCameraTab();
  showAdminNav();
}
function showAdminNav() {
  const btn = document.getElementById('n-settings');
  if (btn && currentUser && currentUser.role === 'admin') btn.style.display = '';
}

// ─── SYNC ────────────────────────────────────────────────────
async function loadData() {
  setSyncStatus('busy', 'Syncing...');
  try {
    const d = await authFetch('/api/data').then((r) => r.json());
    lastHash = JSON.stringify(d);
    applyData(d);
    lastSyncTime = Date.now();
    setSyncStatus('ok', t('sync.syncedAt', { time: formatRelativeTime(lastSyncTime) }));
    refresh();
  } catch (e) {
    if (e.message !== 'unauthorized') setSyncStatus('err', 'Sync error');
  }
}
// Last-scan-per-bag lookup. The four hot spots that need it (dashboard
// harvest tasks, batch-row bag chips, bag-info modal, getBatchLoc) all
// previously did `[...scanLog].reverse().find(...)` once per bag — O(N×M)
// for N bags and M scan-log entries. Building this map once per call site
// turns the per-bag work into a single O(1) Map.get(). Iterating forward
// and overwriting means the last entry for a given bag wins, equivalent
// to the original `reverse().find()`. Cheap to build, so we don't bother
// with global memoisation + invalidation across the 14 scanLog mutation
// sites.
function buildLastScanByBag() {
  const m = new Map();
  for (const e of scanLog) {
    const k = (e.bag || '').toUpperCase();
    if (k) m.set(k, e);
  }
  return m;
}
function applyData(d) {
  // P-05: invalidate per-batch status cache. scanLog is replaced wholesale,
  // so the lazy rebuild on next getStatus() will pick up the new state.
  _statusByBatch = null;
  _hasScanByBatch = null;
  mushroomStrains = d.mushroomStrains || [];
  batches = d.batches || [];
  scanLog = d.scanLog || [];
  movements = d.movements || d.scanLog || [];
  manualTasks = d.manualTasks || [];
  harvests = d.harvests || [];
  cultures = d.cultures || [];
  inventory = d.inventory || defaultInventory();
  teamMembers = d.teamMembers || [];
  caldav = d.caldav || {};
  duckdns = d.duckdns || {};
  calendarEvents = d.calendarEvents || [];
  zones = d.zones || [];
  suppliers = d.suppliers || [];
  weekRhythm = d.weekRhythm || {};
  rhythmTasks = d.rhythmTasks || [];
  // Build barcode registry from server data
  barcodeRegistry = new Map();
  barcodeByEntity = new Map();
  for (const bc of d.barcodes || []) {
    barcodeRegistry.set(bc.barcode, { type: bc.entity_type, id: bc.entity_id });
    barcodeByEntity.set(bc.entity_type + ':' + bc.entity_id, bc.barcode);
  }
  rebuildZoneConstants();
  // ZPL label dimensions (set by server from LABEL_WIDTH_DOTS / LABEL_HEIGHT_DOTS
  // env vars). Fall back to the default 50×30mm @ 203dpi if missing.
  if (d.labelDims && typeof d.labelDims.widthDots === 'number' && typeof d.labelDims.heightDots === 'number') {
    labelDims.widthDots = d.labelDims.widthDots;
    labelDims.heightDots = d.labelDims.heightDots;
  }
  batches.forEach((b) => spColor(b.species));
  cultures.forEach((c) => spColor(c.species));
  fillStrainSelects();
  fillCultureSelect('nb-culture', ['PD', 'LC', 'G2G', 'GS']);
  fillCultureSelect('gs-culture', ['PD', 'LC']);
  updateTodoBadge();
  if (typeof fillCalendarUserFilter === 'function') fillCalendarUserFilter();
  if (d.notifications && typeof d.notifications.unread === 'number') {
    renderNotifBadge(d.notifications.unread);
  }
  harvestRelease.on = !!(d.harvestRelease && d.harvestRelease.on);
}
function defaultInventory() {
  return {
    stock: { hardwood: 0, wheatbran: 0, gypsum: 0, grain: 0 },
    thresholds: { hardwood: { minKg: 50 }, wheatbran: { minKg: 20 }, gypsum: { minKg: 5 }, grain: { minKg: 10 } },
    // Average substrate composition used for "~X bags" estimates
    // These are editable in the Inventory → Stock tab
    avgComposition: { hwPct: 75, wbPct: 25, rhPct: 63, bagKg: 3, grainBagKg: 1, grainRhPct: 52 },
    labThresholds: { MC: 0, PD: 0, LC: 0, G2G: 0, GS: 0 },
    log: []
  };
}
// saveData() removed — all mutations now use atomic REST endpoints (apiPost/apiPatch/apiDelete)
let _mutating = 0; // tracks in-flight mutations to block pollSync from overwriting
let lastSyncTime = null;
function formatRelativeTime(ts) {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 5) return t('time.justNow');
  if (sec < 60) return t('time.secsAgo', { n: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t('time.minsAgo', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('time.hoursAgo', { n: hr });
  return t('time.daysAgo', { n: Math.floor(hr / 24) });
}
// ─── NOTIFICATIONS ──────────────────────────────────────────
let _notifOpen = false;
let _notifItems = [];
let _notifOutsideHandler = null;

function renderNotifBadge(count) {
  const n = typeof count === 'number' && count > 0 ? count : 0;
  const text = n > 99 ? '99+' : String(n);
  for (const id of ['bell-badge', 'bell-badge-m']) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (n > 0) {
      el.textContent = text;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }
}

async function openNotifDropdown(anchorEl) {
  if (_notifOpen) return closeNotifDropdown();
  const dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  // Load items
  try {
    const r = await authFetch('/api/notifications');
    const data = await r.json();
    _notifItems = Array.isArray(data.items) ? data.items : [];
    if (typeof data.unread === 'number') renderNotifBadge(data.unread);
  } catch (e) {
    _notifItems = [];
  }
  renderNotifList(_notifItems);
  positionNotifDropdown(dd, anchorEl);
  dd.hidden = false;
  _notifOpen = true;
  // Outside-click to close (captured on next tick so the opening click doesn't fire it)
  setTimeout(() => {
    _notifOutsideHandler = (e) => {
      if (!dd.contains(e.target) && !e.target.closest('#n-notif') && !e.target.closest('#n-notif-m')) {
        closeNotifDropdown();
      }
    };
    document.addEventListener('click', _notifOutsideHandler);
  }, 0);
}

function positionNotifDropdown(dd, anchorEl) {
  // On mobile the CSS already pins it to the top-right of the viewport.
  // On desktop, anchor it to the sidebar bell: the CSS default covers this.
  // If the user clicks the mobile bell we let CSS handle positioning.
  if (!anchorEl) return;
  // No JS positioning needed; CSS handles both the sidebar and mobile cases.
}

function closeNotifDropdown() {
  const dd = document.getElementById('notif-dropdown');
  if (dd) dd.hidden = true;
  _notifOpen = false;
  if (_notifOutsideHandler) {
    document.removeEventListener('click', _notifOutsideHandler);
    _notifOutsideHandler = null;
  }
}

function renderNotifList(items) {
  const list = document.getElementById('notif-list');
  const empty = document.getElementById('notif-empty');
  if (!list || !empty) return;
  if (!items.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = items
    .map((it) => {
      const ts = it.created ? new Date(it.created).getTime() : Date.now();
      const rel = formatRelativeTime(ts);
      const unreadCls = it.read ? '' : 'unread';
      // esc() is the existing HTML-escape helper used throughout app.js
      return (
        '<button type="button" class="notif-item ' +
        unreadCls +
        '" data-nid="' +
        it.id +
        '" data-link-type="' +
        esc(it.linkType || '') +
        '" data-link-id="' +
        esc(it.linkId || '') +
        '">' +
        '<div class="notif-item-title">' +
        esc(it.title || '') +
        '</div>' +
        (it.body ? '<div class="notif-item-body">' + esc(it.body) + '</div>' : '') +
        '<div class="notif-item-time">' +
        esc(rel) +
        '</div>' +
        '</button>'
      );
    })
    .join('');
  // Wire click handlers on each item
  for (const el of list.querySelectorAll('.notif-item')) {
    el.addEventListener('click', onNotifItemClick);
  }
}

function onNotifItemClick(e) {
  const el = e.currentTarget;
  const id = parseInt(el.getAttribute('data-nid'), 10);
  const linkType = el.getAttribute('data-link-type');
  const linkId = el.getAttribute('data-link-id');
  // Optimistic: mark this single item as read so the badge drops instantly
  if (!Number.isNaN(id)) {
    apiPost('/api/notifications/read', { ids: [id] }).catch(() => {});
    const badge = document.getElementById('bell-badge');
    const n = badge && !badge.hidden ? Math.max(0, parseInt(badge.textContent, 10) - 1) : 0;
    renderNotifBadge(n);
  }
  closeNotifDropdown();
  if (linkType === 'calendar_event' && linkId) {
    // Navigate to the calendar tab, then open the event detail modal
    go('cal', 'n-cal');
    const ce = calendarEvents.find((x) => x.id === linkId);
    if (ce) {
      // openEventDetail accepts a simplified occurrence object; match its shape
      openEventDetail({ type: 'custom', id: ce.id, date: ce.startDate });
    }
  } else if (linkType === 'task' && linkId) {
    // Tasks in the calendar are keyed by their `created` timestamp, so look
    // the task up by its numeric DB id first, then dispatch to the detail
    // modal using the timestamp — same shape clicking the task tile produces.
    go('cal', 'n-cal');
    const tid = parseInt(linkId, 10);
    const tk = manualTasks.find((x) => x.id === tid);
    if (tk) openEventDetail({ type: 'task-due', id: tk.created, date: tk.dueDate });
  } else if (linkType === 'customer' && linkId) {
    // An eBay account-closure request. The server records it and raises this
    // notification but deliberately never erases on its own, so this alert is the
    // whole trail — and clicking it used to fall through every branch after
    // marking it read, so the only pointer to the request destroyed itself and
    // the admin landed nowhere. Take them to the Kunden table with the row
    // highlighted, which is where the erase actually happens.
    go('orders', 'n-orders');
    openStab('orders', 'customers');
    _ohHighlightCustomer = parseInt(linkId, 10) || null;
    renderOrdersCustomers();
  }
}

async function markAllNotifRead() {
  try {
    await apiPost('/api/notifications/read', { all: true });
  } catch (e) {
    /* ignore */
  }
  renderNotifBadge(0);
  // Update local list to reflect read state
  _notifItems = _notifItems.map((it) => ({ ...it, read: 1 }));
  renderNotifList(_notifItems);
}

function setSyncStatus(cls, msg) {
  document.getElementById('sync-dot').className = 'sync-dot ' + cls;
  document.getElementById('sync-label').textContent = msg;
  const m = document.getElementById('sync-dot-m');
  if (m) m.className = 'sync-dot ' + cls;
  if (cls === 'ok') lastSyncTime = Date.now();
}
// Update relative time display every 5 seconds
setInterval(() => {
  if (!lastSyncTime) return;
  const dot = document.getElementById('sync-dot');
  if (!dot || !dot.classList.contains('ok')) return;
  document.getElementById('sync-label').textContent = t('sync.syncedAt', { time: formatRelativeTime(lastSyncTime) });
}, 5000);
let _polling = false;
let _lastEtag = null;
async function pollSync() {
  if (_mutating > 0 || _polling) return;
  _polling = true;
  try {
    // P-04: send If-None-Match so the server can short-circuit with 304
    // when nothing has changed. Server sets ETag from the monotonic
    // data_version counter, so a cached version is authoritative.
    const headers = _lastEtag ? { 'If-None-Match': _lastEtag } : undefined;
    const r = await authFetch('/api/data', headers ? { headers } : undefined);
    if (r.status === 304) {
      // No change — keep the existing data, just refresh the "synced at" time.
      lastSyncTime = lastSyncTime || Date.now();
      setSyncStatus('ok', t('sync.syncedAt', { time: formatRelativeTime(lastSyncTime) }));
      return;
    }
    const newEtag = r.headers && r.headers.get ? r.headers.get('ETag') : null;
    const d = await r.json();
    const h = JSON.stringify(d);
    if (h !== lastHash) {
      lastHash = h;
      _lastEtag = newEtag;
      applyData(d);
      lastSyncTime = Date.now();
      setSyncStatus('ok', t('sync.syncedAt', { time: formatRelativeTime(lastSyncTime) }));
      refresh();
    } else {
      // Body unchanged but ETag may have advanced (e.g. mutation that
      // reverted to the same content). Track the new ETag so the next poll
      // can still 304 cleanly.
      if (newEtag) _lastEtag = newEtag;
      lastSyncTime = lastSyncTime || Date.now();
    }
  } catch (e) {
    if (e.message !== 'unauthorized') setSyncStatus('err', 'Sync error');
  } finally {
    _polling = false;
  }
}

// Coalesce SSE-triggered reconciliation polls. Every scan (by any client)
// broadcasts a data-changed event; without coalescing, a burst of scans fires
// one full /api/data refetch per scan — the dominant cause of scan sluggishness
// as history grows. The scanning client already applies its own scan locally
// (optimistic update), so the authoritative reconcile can be deferred and
// folded into a single poll per window.
let _ssePollTimer = null;
function scheduleSsePoll() {
  if (_ssePollTimer) return; // a poll is already queued — fold this event into it
  _ssePollTimer = setTimeout(function () {
    _ssePollTimer = null;
    // If a local mutation is mid-flight, its own flow keeps the UI correct;
    // retry shortly so we still pick up other clients' interleaved changes.
    if (_mutating > 0 || _polling) {
      scheduleSsePoll();
      return;
    }
    pollSync();
  }, 500);
}

// ── SSE real-time sync (replaces 5s polling for connected clients) ──
let _sse = null;
let _sseReconnectTimer = null;
let _sseRetryDelay = 1000;
function connectSSE() {
  if (_sse) return;
  try {
    _sse = new EventSource('/api/events');
    _sse.onopen = function () {
      _sseRetryDelay = 1000; // Reset backoff on successful connection
      setSyncStatus('ok', 'Connected');
    };
    _sse.onmessage = function (ev) {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'data-changed') scheduleSsePoll();
        if (msg.type === 'connected') setSyncStatus('ok', 'Connected');
      } catch (e) {
        /* ignore parse errors */
      }
    };
    _sse.onerror = function () {
      _sse.close();
      _sse = null;
      setSyncStatus('err', 'Connection lost');
      // Exponential backoff reconnect, capped at 30s
      if (!_sseReconnectTimer) {
        _sseReconnectTimer = setTimeout(
          () => {
            _sseReconnectTimer = null;
            connectSSE();
          },
          Math.min(_sseRetryDelay, 30000)
        );
        _sseRetryDelay = Math.min(_sseRetryDelay * 2, 30000);
      }
    };
  } catch (e) {
    /* SSE not supported — polling fallback active */
  }
}
function disconnectSSE() {
  if (_sse) {
    _sse.close();
    _sse = null;
  }
  if (_sseReconnectTimer) {
    clearTimeout(_sseReconnectTimer);
    _sseReconnectTimer = null;
  }
  _sseRetryDelay = 1000;
}

// ─── SIDEBAR ────────────────────────────────────────────────
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sb-overlay');
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sb.classList.toggle('sb-open');
    ov.classList.toggle('sb-show');
    document.body.classList.toggle('sb-mobile-open');
  } else {
    sb.classList.toggle('sb-collapsed');
    document.body.classList.toggle('sb-is-collapsed');
  }
}
// Close sidebar on mobile when navigating
function sbCloseMobile() {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('sb-open');
    document.getElementById('sb-overlay').classList.remove('sb-show');
    document.body.classList.remove('sb-mobile-open');
  }
}

// ─── NAV ─────────────────────────────────────────────────────
const PAGES = {
  dash: 'n-dash',
  batch: 'n-batch',
  lab: 'n-lab',
  print: 'n-print',
  cal: 'n-cal',
  settings: 'n-settings',
  strains: 'n-strains',
  orders: 'n-orders-inbox',
  pickups: 'n-pickups'
};
function go(page, btnId) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.sb-nav .sb-btn, .sb-footer .sb-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById('p-' + page).classList.add('active');
  document.getElementById(btnId).classList.add('active');
  // Mirror active state onto the mobile bottom nav for the four pages it covers.
  const bnBtn = document.querySelector('.bottom-nav-btn[data-page="' + page + '"]');
  if (bnBtn) bnBtn.classList.add('active');
  if (page === 'dash') {
    renderDashAlerts();
    renderDashBatchTasks();
  }
  // The pipeline strip and the "where is everything" list live on the Chargen
  // page now, and lab stock on Labor — each section carries its own overview
  // instead of the dashboard carrying all of them. renderStatus fills both
  // #metrics and #dash-locations, so it belongs with the page that shows them.
  if (page === 'batch') {
    renderStatus();
    renderBatches();
  }
  if (page === 'lab') {
    renderDashLabStock();
    renderCultures();
    renderGrainBatches();
  }
  if (page === 'inv') {
    renderInvStock();
  }
  if (page === 'zones') renderZones();
  if (page === 'print') {
    fillBatchSelect();
    renderLabList();
    refreshPrinterStatus();
  }
  if (page === 'cal') {
    renderCalendar();
    loadCalDAVImports().then(() => renderCalendar());
  }
  if (page === 'settings') renderLog();
  if (page === 'strains') renderStrains();
  if (page === 'orders') renderOrders();
  if (page === 'pickups') renderPickups();
  updateTodoBadge();
  sbCloseMobile();
}
function openStab(page, sub) {
  document.querySelectorAll(`#p-${page} .stab`).forEach((b) => b.classList.remove('active'));
  document.querySelectorAll(`#p-${page} .sp`).forEach((p) => p.classList.remove('active'));
  const stEl = document.getElementById(`st-${page}-${sub}`);
  if (stEl) stEl.classList.add('active');
  const spEl = document.getElementById(`sp-${page}-${sub}`);
  if (spEl) spEl.classList.add('active');
  if (page === 'batch' && sub === 'list') renderBatches();
  if (page === 'batch' && sub === 'new') {
    _fillNbProducts();
    if (!_nbDefaultsApplied) {
      nbApplyDefaults();
      _nbDefaultsApplied = true;
    }
    // Refill every time: bags get consumed and created between visits.
    inocRender('nb');
  }
  if (page === 'batch' && sub === 'harvest') renderHarvests();
  if (page === 'lab' && sub === 'cultures') renderCultures();
  if (page === 'lab' && sub === 'work') {
    lwUpdate();
    renderLabLog();
  }
  if (page === 'lab' && sub === 'lineage') fillLineageSelect();
  if (page === 'lab' && sub === 'contam') renderContamReports();
  if (page === 'inv' && sub === 'stock') renderInvStock();
  if (page === 'inv' && sub === 'delivery') {
    delMatChange();
    adjMatChange();
  }
  if (page === 'inv' && sub === 'log') renderInvLog();
  if (page === 'print' && sub === 'bags') fillBatchSelect();
  if (page === 'print' && sub === 'lab') {
    renderLabList();
    renderLabPreview();
  }
  if (page === 'print' && sub === 'ref') renderRefBarcodes();
  if (page === 'cal' && sub === 'cal') {
    loadCalDAVImports().then(() => renderCalendar());
  }
  if (page === 'settings' && sub === 'caldav') loadCaldavSettings();
  if (page === 'settings' && sub === 'duckdns') loadDuckdnsSettings();
  if (page === 'settings' && sub === 'harvestfeed') loadHarvestFeedSettings();
  if (page === 'settings' && sub === 'versand') loadShipSettings();
  if (page === 'settings' && sub === 'channels') loadChannelsSettings();
  if (page === 'settings' && sub === 'mcp') loadMcpSettings();
  if (page === 'settings' && sub === 'log') renderLog();
  if (page === 'orders' && sub === 'inbox') renderOrders();
  if (page === 'orders' && sub === 'tomake') renderOrdersDemand();
  if (page === 'orders' && sub === 'mapping') renderOrdersMapping();
  if (page === 'orders' && sub === 'customers') renderOrdersCustomers();
  if (page === 'orders' && sub === 'versand') renderOrdersVersand();
}
function refresh() {
  // P-05: invalidate the per-batch status cache before each render. This is
  // belt-and-braces — applyData() also clears it on incoming data — but
  // covers local mutation paths (push to scanLog, removeBag, etc.) that
  // don't go through applyData. The cache is rebuilt lazily on first
  // getStatus() call within this render pass, then reused for the rest.
  _statusByBatch = null;
  _hasScanByBatch = null;
  const active = document.querySelector('.page.active');
  if (!active) return;
  const id = active.id.replace('p-', '');
  if (id === 'dash') {
    renderDashAlerts();
    renderDashBatchTasks();
  }
  if (id === 'batch') {
    renderStatus();
    renderBatches();
  }
  if (id === 'lab') {
    renderDashLabStock();
    renderCultures();
    renderGrainBatches();
  }
  if (id === 'inv') renderInvStock();
  if (id === 'zones') renderZones();
  if (id === 'cal') renderCalendar();
  if (id === 'strains') renderStrains();
  if (id === 'orders') _refreshOrdersActive();
  // Pickups arrive on the feed's own schedule, not on any action taken here, so
  // this page has no other way to notice that something changed.
  if (id === 'pickups') renderPickups();
  updateTodoBadge();
}

// ═══ ORDER HUB (Phase 0) ═══════════════════════════════════════════════════
// Sales orders → products → production demand. Fetched on demand from the
// dedicated /api/orders, /api/products, /api/customers endpoints (not the
// /api/data full-state blob). See ORDERS_HUB_DESIGN.md.
//
// Module-level DOM helper: the app's main `$` is declared local to
// initEventListeners, so these top-level render functions need their own.
const $ = (id) => document.getElementById(id);
let _ordersCache = [];
let _ordersFilter = '';

function _ohEmpty(cols, msg) {
  return `<tr><td colspan="${cols}" style="text-align:center;padding:16px;color:var(--c-text-muted)">${esc(msg)}</td></tr>`;
}
function _ohChannel(ch) {
  const label =
    ch === 'manual' ? t('orders.manual') : ch === 'ebay' ? 'eBay' : ch ? ch.charAt(0).toUpperCase() + ch.slice(1) : '—';
  return `<span class="oh-ch oh-ch-${esc(ch || 'manual')}">${esc(label)}</span>`;
}
function _ohStatus(st) {
  return `<span class="oh-st oh-st-${esc(st)}">${esc(t('orders.status.' + st))}</span>`;
}
function _refreshOrdersActive() {
  const active = document.querySelector('#p-orders .sp.active');
  const id = active ? active.id : 'sp-orders-inbox';
  if (id === 'sp-orders-tomake') renderOrdersDemand();
  else if (id === 'sp-orders-mapping') renderOrdersMapping();
  else if (id === 'sp-orders-customers') renderOrdersCustomers();
  else if (id === 'sp-orders-versand') renderOrdersVersand();
  else renderOrders();
}

function renderOrders() {
  const body = $('orders-body');
  if (!body) return;
  apiGet('/api/orders?limit=500')
    .then((d) => {
      _ordersCache = d.items || [];
      _renderOrdersInbox();
    })
    .catch(() => {
      body.innerHTML = _ohEmpty(6, t('common.error'));
    });
  apiGet('/api/products/unmapped')
    .then((d) => {
      const items = d.items || [];
      const banner = $('orders-unmapped-banner');
      if (banner) banner.style.display = items.length ? 'flex' : 'none';
      const cnt = $('orders-unmapped-count');
      if (cnt) cnt.textContent = items.length;
    })
    .catch(() => {});
}

function _renderOrdersInbox() {
  const body = $('orders-body');
  if (!body) return;
  const rows = _ordersCache.filter((o) => !_ordersFilter || o.status === _ordersFilter);
  if (!rows.length) {
    body.innerHTML = _ohEmpty(6, t('orders.none'));
    return;
  }
  body.innerHTML = rows
    .map(
      (o) =>
        `<tr><td>${_ohChannel(o.channel)}</td>` +
        `<td style="font-family:monospace;font-size:11px">${esc(o.channelOrderId)}</td>` +
        `<td>${esc(o.customerName || '—')}</td>` +
        `<td>${o.itemCount || 0}${o.unmappedCount ? ` <span class="oh-warn" title="${esc(t('orders.unmappedLines'))}">⚠︎</span>` : ''}</td>` +
        `<td style="font-size:11px">${o.shipBy ? esc(fmtDt(o.shipBy)) : '—'}</td>` +
        `<td>${_ohStatus(o.status)}</td></tr>`
    )
    .join('');
}

function setOrdersFilter(f) {
  _ordersFilter = f;
  document
    .querySelectorAll('#sp-orders-inbox .oh-fchip')
    .forEach((c) => c.classList.toggle('active', (c.dataset.filter || '') === f));
  _renderOrdersInbox();
}

function renderOrdersDemand() {
  const body = $('demand-body');
  if (!body) return;
  body.innerHTML = _ohEmpty(6, t('common.loading'));
  apiGet('/api/orders/demand')
    .then((d) => {
      const rows = d.items || [];
      if (!rows.length) {
        body.innerHTML = _ohEmpty(5, t('orders.demandNone'));
        return;
      }
      body.innerHTML = rows
        .map((r) => {
          const comps = (r.components || []).length
            ? r.components
                .map(
                  (c) =>
                    `<span style="display:inline-block;margin-right:10px;${c.short > 0 ? 'color:var(--c-red-dark);font-weight:600' : 'color:var(--c-text-muted)'}">` +
                    `${esc(_ohMatName(c.mat))} ${_ohN(c.need)}${esc(c.unit || '')}${c.short > 0 ? ' (−' + _ohN(c.short) + ')' : ' ✓'}</span>`
                )
                .join('')
            : '<span class="muted">—</span>';
          const produce =
            r.toProduce > 0
              ? `<strong>${r.toProduce}</strong>${r.componentsShort ? ` <span class="oh-warn" title="${esc(t('orders.componentsShort'))}">⚠︎</span>` : ''}`
              : r.backorder > 0
                ? `<span class="oh-st oh-st-cancelled">${r.backorder} ${esc(t('orders.backorder'))}</span>`
                : '<span class="muted">0</span>';
          return (
            `<tr><td><strong>${esc(r.product)}</strong> <span class="muted" style="font-size:11px">${esc(r.category || '')}</span></td>` +
            `<td>${r.demand}</td><td>${r.fromStock}</td><td>${produce}</td>` +
            `<td style="font-size:11px">${r.startBy ? esc(r.startBy) : '—'}</td>` +
            `<td style="font-size:11px">${comps}</td></tr>`
          );
        })
        .join('');
    })
    .catch(() => {
      body.innerHTML = _ohEmpty(5, t('common.error'));
    });
}

function renderOrdersMapping() {
  renderInventoryCard();
  const left = $('orders-unmapped-list');
  if (!left) return;
  Promise.all([apiGet('/api/products/unmapped'), apiGet('/api/products')])
    .then(([u, p]) => {
      const products = p.items || [];
      const opts = products.map((pr) => `<option value="${pr.id}">${esc(pr.name)}</option>`).join('');
      const items = u.items || [];
      left.innerHTML = items.length
        ? items
            .map(
              (it) =>
                `<div class="oh-maprow">${_ohChannel(it.channel)}` +
                `<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">${esc(it.title || it.channelSku || it.listingId || '—')}</div>` +
                `<div class="muted" style="font-size:11px;font-family:monospace">${esc(it.channelSku || it.listingId || '')} · ${it.qty || 0}×</div></div>` +
                `<select class="oh-mapsel" data-channel="${esc(it.channel)}" data-sku="${esc(it.channelSku || '')}" data-listing="${esc(it.listingId || '')}" data-title="${esc(it.title || '')}" style="width:auto;font-size:12px">` +
                `<option value="">— ${esc(t('orders.choose'))} —</option>${opts}</select>` +
                `<button class="btn btn-sm btn-p" data-action="oh-map">${esc(t('orders.assign'))}</button></div>`
            )
            .join('')
        : `<div style="padding:14px;color:var(--c-text-muted)">${esc(t('orders.allMapped'))}</div>`;
      const cat = $('orders-catalog-body');
      if (cat) {
        cat.innerHTML = products.length
          ? products
              .map(
                (pr) =>
                  `<tr><td><strong>${esc(pr.name)}</strong></td><td>${esc(pr.category || '—')}</td>` +
                  `<td class="muted" style="font-size:11px">${esc(pr.sku || '')}</td>` +
                  `<td><button class="btn btn-sm" data-action="oh-prod-edit" data-id="${pr.id}">${esc(t('orders.edit'))}</button></td></tr>`
              )
              .join('')
          : _ohEmpty(4, t('orders.noProducts'));
      }
    })
    .catch(() => {
      left.innerHTML = `<div style="padding:14px;color:var(--c-text-muted)">${esc(t('common.error'))}</div>`;
    });
}

// Set when an eBay account-closure notification is clicked, so the row that the
// request is about is findable in a 200-row table. Cleared on the next render.
let _ohHighlightCustomer = null;
function renderOrdersCustomers() {
  const body = $('orders-customers-body');
  if (!body) return;
  // /api/customers is behind requireShipping, not requireAdmin, so packers load
  // this table too. Gate the header with the cells — otherwise they get a titled,
  // permanently empty column stealing width on a table already wide enough to
  // need horizontal scrolling on a phone. Same pattern as showAdminNav().
  const isAdmin = !!(currentUser && currentUser.role === 'admin');
  const privacyTh = document.getElementById('orders-customers-privacy-th');
  if (privacyTh) privacyTh.hidden = !isAdmin;
  const cols = isAdmin ? 7 : 6;
  body.innerHTML = _ohEmpty(cols, t('common.loading'));
  apiGet('/api/customers')
    .then((d) => {
      const rows = d.items || [];
      if (!rows.length) {
        body.innerHTML = _ohEmpty(cols, t('orders.noCustomers'));
        return;
      }
      body.innerHTML = rows
        .map((c) => {
          const chans = (c.channels || '').split(',').filter(Boolean).map(_ohChannel).join(' ');
          const ltv = c.totalSpent != null ? Number(c.totalSpent).toFixed(2) : '0.00';
          // Ask the server, do not infer. `!c.name && !c.email` looked equivalent
          // but was wrong for exactly the population this feature serves: eBay
          // masks the buyer email and carries identity in customer_identities, so
          // those customers have neither column and were never erased — yet they
          // rendered as "already erased" while their shipping address, phone and
          // raw payload sat in orders, with no way to run the erasure. Manual
          // entry and CSV import without those columns produce the same shape.
          // erased_at is written only by eraseCustomer.
          const erased = !!c.erasedAt;
          // btn-r is the repo's destructive style (delete batch, remove member,
          // delete camera). No inline padding: it would override the coarse-pointer
          // rule that gives every .btn-sm a 44px target, which is not something the
          // most destructive control in the app should opt out of.
          const privacy = !isAdmin
            ? ''
            : erased
              ? `<span style="font-size:11px;color:var(--c-text-muted)">${esc(t('orders.erased'))}</span>`
              : `<button type="button" class="btn btn-sm btn-r" data-action="oh-erase-customer" data-id="${esc(String(c.id))}" data-name="${esc(c.name || c.email || String(c.id))}">${esc(t('orders.erase'))}</button>`;
          // Arrived here from an account-closure notification: mark the row the
          // request is about, otherwise it is one of up to 200 and the admin has
          // only an id to go on.
          const hit = _ohHighlightCustomer && c.id === _ohHighlightCustomer;
          return (
            `<tr${hit ? ' style="outline:2px solid var(--c-red-dark);outline-offset:-2px"' : ''}>` +
            `<td><strong>${esc(c.name || c.email || '—')}</strong></td>` +
            `<td>${chans}</td><td>${c.orderCount || 0}</td>` +
            `<td><strong>${ltv} ${esc(c.currency || '€')}</strong></td>` +
            `<td style="font-size:11px">${c.lastOrder ? esc(fmtDt(c.lastOrder)) : '—'}</td>` +
            `<td>${(c.orderCount || 0) > 1 ? `<span class="oh-st oh-st-ready">${esc(t('orders.repeat'))}</span>` : ''}</td>` +
            (isAdmin ? `<td>${privacy}</td>` : '') +
            '</tr>'
          );
        })
        .join('');
      // Consumed by this render; a later visit must not re-highlight whatever
      // row now holds that id.
      _ohHighlightCustomer = null;
    })
    .catch(() => {
      body.innerHTML = _ohEmpty(cols, t('common.error'));
    });
}
// ═══ PICKUPS ═══════════════════════════════════════════════════════════════
// Collection slots the harvest-feed receiver reported back in its reply. Every
// value on this page came from outside this machine, so every value goes
// through esc() — including the ones that "obviously" cannot contain markup,
// because the reason they cannot is a validation rule in another file that
// somebody may relax later.
//
// Read-only by design. The receiver took the booking and repeats each open
// pickup until this end confirms it; an edit here would be overwritten by the
// next reply that carried the same id.

/**
 * The window, as the customer was told it.
 *
 * slotText is the receiver's own wording and wins whenever it is there — it
 * already reads the way the confirmation email did. The fallback assembles
 * from/to, which are LOCAL wall-clock at the pickup place: printed as they
 * arrived, never parsed into a Date. Feeding them to the browser's clock would
 * reinterpret them in whoever-is-looking's timezone and silently move a 9 a.m.
 * pickup by an hour or two.
 */
function _pickupWhen(p) {
  if (p.slotText) return esc(p.slotText);
  if (!p.from) return '—';
  const day = p.from.slice(0, 10);
  const fromTime = p.from.slice(11, 16);
  const toTime = p.to ? p.to.slice(11, 16) : '';
  return esc(day + ' ' + fromTime + (toTime ? '–' + toTime : ''));
}

function renderPickups() {
  // The upper half of the page. Not awaited: the two halves come from different
  // routes and neither needs the other, so making the bookings wait on the
  // release table would only add a stall to the half people open this page for.
  loadHarvestReleases();

  const body = $('pickups-body');
  if (!body) return;
  const count = $('pickups-count');
  body.innerHTML = _ohEmpty(5, t('common.loading'));
  apiGet('/api/pickups')
    .then((d) => {
      const rows = d.items || [];
      if (count) count.textContent = rows.length ? t('pickups.count', { n: rows.length }) : '';
      if (!rows.length) {
        body.innerHTML = _ohEmpty(5, t('pickups.none'));
        return;
      }
      body.innerHTML = rows
        .map((p) => {
          const items = (p.items || [])
            .map((it) => esc(it.kind) + ' ' + Math.round(it.grams) + ' g')
            .join('<br>');
          // The zone belongs next to the time or the time means nothing. A
          // pickup in another country is exactly when the label earns its width.
          const zone = p.zone ? `<div style="font-size:11px;color:var(--c-text-muted)">${esc(p.zone)}</div>` : '';
          // Two different states, and only one of them is a problem. Overbooked
          // is the receiver saying it sold more of that slot than it should
          // have; unconfirmed just means the next push has not gone out yet.
          const state = p.overbooked
            ? `<span class="oh-st oh-st-over">${esc(t('pickups.overbooked'))}</span>`
            : p.acked
              ? `<span class="oh-st oh-st-ready">${esc(t('pickups.confirmed'))}</span>`
              : `<span style="font-size:11px;color:var(--c-text-muted)">${esc(t('pickups.pending'))}</span>`;
          return (
            '<tr>' +
            `<td><strong>${_pickupWhen(p)}</strong>${zone}</td>` +
            `<td>${esc(p.place || '—')}</td>` +
            `<td>${esc(p.order || '—')}</td>` +
            `<td style="font-size:12px">${items || '—'}</td>` +
            `<td>${state}</td>` +
            '</tr>'
          );
        })
        .join('');
    })
    .catch(() => {
      body.innerHTML = _ohEmpty(5, t('common.error'));
    });
}

// Carry out a marketplace account-closure request. This is the authenticated
// counterpart to the eBay deletion endpoint, which records such requests and
// notifies admins but never erases on its own — that endpoint is unauthenticated
// by necessity, so anyone able to reach the host would otherwise be able to
// destroy a customer's order history with one request.
//
// Irreversible: the server NULLs the customer's name and email, every ship_*
// field on their orders, and the raw_json that could have restored them. The
// order rows themselves survive, so revenue history stays intact.
function eraseCustomer(id, name) {
  confirm2(t('orders.eraseTitle'), t('orders.eraseMsg', { name }), t('orders.eraseYes'), () => {
    apiPost('/api/customers/erase', { customerId: Number(id) }).then((r) => {
      if (r && r.error) {
        setFb('err', r.error);
        return;
      }
      setFb('ok', t('orders.eraseDone', { name, n: (r && r.orders) || 0 }));
      renderOrdersCustomers();
    });
  });
}

// ── Versand: order list + buy-label modal ──
function renderOrdersVersand() {
  const body = $('versand-orders-body');
  if (!body) return;
  body.innerHTML = _ohEmpty(5, t('common.loading'));
  authFetch('/api/ship/config')
    .then((r) => r.json())
    .then((cfg) => {
      const warn = $('versand-config-warn');
      if (warn) warn.style.display = cfg && cfg.enabled && cfg.publicKey ? 'none' : 'block';
    })
    .catch(() => {});
  apiGet('/api/orders?limit=500')
    .then((d) => {
      const rows = (d.items || []).filter((o) => o.status !== 'cancelled');
      if (!rows.length) {
        body.innerHTML = _ohEmpty(5, t('orders.none'));
        return;
      }
      body.innerHTML = rows
        .map((o) => {
          const btn =
            o.status === 'shipped'
              ? `<button class="btn btn-sm" data-action="oh-ship-open" data-order-id="${o.id}">${t('versand.relabel')}</button>`
              : `<button class="btn btn-sm btn-p" data-action="oh-ship-open" data-order-id="${o.id}">${t('versand.shipBtn')}</button>`;
          return (
            `<tr><td>${_ohChannel(o.channel)}</td>` +
            `<td style="font-family:monospace;font-size:11px">${esc(o.channelOrderId)}</td>` +
            `<td>${esc(o.customerName || '—')}</td>` +
            `<td>${_ohStatus(o.status)}</td>` +
            `<td style="white-space:nowrap">${btn}</td></tr>`
          );
        })
        .join('');
    })
    .catch(() => {
      body.innerHTML = _ohEmpty(5, t('common.error'));
    });
}

function shipModalClose() {
  const m = $('ship-modal');
  if (m) m.style.display = 'none';
}
function shipModalOpen(orderId) {
  if (!orderId) return;
  const m = $('ship-modal');
  if (!m) return;
  $('ship-m-orderid').value = orderId;
  $('ship-m-result').textContent = '';
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v == null ? '' : v;
  };
  // Prefill from the stored order (ship_* filled by a prior label or channel sync).
  apiGet('/api/ship/order/' + orderId)
    .then((o) => {
      if (!o || o.error) o = {};
      $('ship-m-sub').textContent = (o.channel ? o.channel + ' · ' : '') + (o.channelOrderId || '#' + orderId);
      set('ship-m-name', o.shipName || o.customerName || '');
      set('ship-m-company', o.shipCompany);
      set('ship-m-street', o.shipStreet);
      set('ship-m-house', o.shipHouse);
      set('ship-m-address2', o.shipAddress2);
      set('ship-m-postal', o.shipPostal);
      set('ship-m-city', o.shipCity);
      set('ship-m-country', (o.shipCountry || 'DE').toUpperCase());
      set('ship-m-phone', o.shipPhone);
      set('ship-m-weight', o.shipWeightG || 1000);
      shipLoadMethods();
    })
    .catch(() => shipLoadMethods());
  m.style.display = 'flex';
}
function shipLoadMethods() {
  const sel = $('ship-m-method');
  if (!sel) return;
  const country = ($('ship-m-country').value || 'DE').toUpperCase();
  const weight = parseInt($('ship-m-weight').value, 10) || 1000;
  sel.innerHTML = `<option value="">${esc(t('versand.loadingMethods'))}</option>`;
  apiGet('/api/ship/methods?country=' + encodeURIComponent(country) + '&weight=' + weight)
    .then((d) => {
      const methods = (d && d.methods) || [];
      sel.innerHTML = methods.length
        ? methods.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')
        : `<option value="">${esc(t('versand.noMethods'))}</option>`;
    })
    .catch(() => {
      sel.innerHTML = `<option value="">${esc(t('common.error'))}</option>`;
    });
}
function shipBuyLabel() {
  const orderId = parseInt($('ship-m-orderid').value, 10);
  const methodId = $('ship-m-method').value;
  if (!orderId) return;
  if (!methodId) {
    setFb('err', t('versand.pickMethod'));
    return;
  }
  const v = (id) => ($(id) ? $(id).value.trim() : '');
  const weightG = parseInt($('ship-m-weight').value, 10) || 1000;
  const address = {
    shipName: v('ship-m-name'),
    shipCompany: v('ship-m-company'),
    shipStreet: v('ship-m-street'),
    shipHouse: v('ship-m-house'),
    shipAddress2: v('ship-m-address2'),
    shipPostal: v('ship-m-postal'),
    shipCity: v('ship-m-city'),
    shipCountry: (v('ship-m-country') || 'DE').toUpperCase(),
    shipPhone: v('ship-m-phone'),
    shipWeightG: weightG
  };
  const res = $('ship-m-result');
  if (res) res.textContent = t('common.loading');
  apiPost('/api/ship/label', { orderId, methodId, weightG, address })
    .then((r) => {
      if (!r || r.error) {
        if (res) res.textContent = '⚠ ' + ((r && r.error) || t('common.error'));
        return;
      }
      if (r.test) {
        // Test mode announced the parcel without buying a billable label.
        if (res) res.textContent = '✓ ' + t('versand.testAnnounced');
        setFb('ok', t('versand.testAnnounced'));
        renderOrdersVersand();
        return;
      }
      const pdf = '/api/ship/label/' + r.id + '/pdf';
      const pushMsg = r.channelPushed
        ? '<br>↪ ' + esc(t('versand.pushedToChannel'))
        : r.pushError
          ? '<br>⚠ ' + esc(t('versand.pushFailed')) + ': ' + esc(r.pushError)
          : '';
      if (res)
        res.innerHTML =
          '✓ ' +
          esc(t('versand.bought')) +
          (r.trackingNumber ? ' · ' + esc(r.trackingNumber) : '') +
          ` · <a href="${pdf}" target="_blank" rel="noopener">${esc(t('versand.openLabel'))}</a>` +
          pushMsg;
      setFb('ok', t('versand.bought'));
      renderOrdersVersand();
    })
    .catch(() => {
      if (res) res.textContent = '⚠ ' + t('common.error');
    });
}

function ordersActionHandler(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'oh-erase-customer') {
    eraseCustomer(btn.dataset.id, btn.dataset.name);
  } else if (action === 'oh-filter') {
    setOrdersFilter(btn.dataset.filter || '');
  } else if (action === 'oh-goto-mapping') {
    openStab('orders', 'mapping');
  } else if (action === 'oh-manual-toggle') {
    const p = $('orders-manual-panel');
    if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
  } else if (action === 'oh-import-csv') {
    const f = $('orders-csv-file');
    if (f) f.click();
  } else if (action === 'oh-manual-submit') {
    _ordersManualSubmit();
  } else if (action === 'oh-map') {
    const row = btn.closest('.oh-maprow');
    const sel = row && row.querySelector('.oh-mapsel');
    if (!sel || !sel.value) {
      setFb('err', t('orders.choose'));
      return;
    }
    apiPost('/api/products/map', {
      channel: sel.dataset.channel,
      channelSku: sel.dataset.sku || null,
      listingId: sel.dataset.listing || null,
      title: sel.dataset.title || null,
      productId: parseInt(sel.value, 10)
    }).then((r) => {
      if (r && r.error) {
        setFb('err', r.error);
        return;
      }
      setFb('ok', t('orders.mapped'));
      renderOrdersMapping();
    });
  } else if (action === 'oh-prod-new') {
    _ohProductForm(null);
  } else if (action === 'oh-prod-cancel') {
    const f = $('orders-prod-form');
    if (f) f.style.display = 'none';
  } else if (action === 'oh-prod-edit') {
    apiGet('/api/products/' + btn.dataset.id)
      .then((p) => _ohProductForm(p))
      .catch(() => setFb('err', t('common.error')));
  } else if (action === 'oh-prod-save') {
    _ohProductSave();
  } else if (action === 'oh-prod-delete') {
    _ohProductDelete();
  } else if (action === 'oh-inv-set') {
    const row = btn.closest('tr');
    const inp = row && row.querySelector('.oh-inv-input');
    if (!inp) return;
    const val = parseFloat(inp.value);
    if (!(val >= 0)) {
      setFb('err', t('orders.invBadValue'));
      return;
    }
    invSetAbsolute(btn.dataset.mat, val, 'manual', 'order-hub').then((r) => {
      if (r && r.error) {
        setFb('err', r.error);
        return;
      }
      setFb('ok', t('orders.invSaved'));
      if (inventory && inventory.stock) inventory.stock[btn.dataset.mat] = val;
      renderInventoryCard();
    });
  } else if (action === 'oh-ship-open') {
    shipModalOpen(parseInt(btn.dataset.orderId, 10));
  } else if (action === 'oh-ship-buy') {
    shipBuyLabel();
  } else if (action === 'oh-ship-close') {
    shipModalClose();
  }
}

function _ordersManualSubmit() {
  const oid = ($('oh-m-oid').value || '').trim();
  if (!oid) {
    setFb('err', t('orders.needOrderId'));
    return;
  }
  const order = {
    channel: $('oh-m-channel').value || 'manual',
    channelOrderId: oid,
    customerName: ($('oh-m-cust').value || '').trim() || null,
    customerEmail: ($('oh-m-email').value || '').trim() || null,
    shipBy: $('oh-m-shipby').value || null,
    items: [
      {
        channelSku: ($('oh-m-sku').value || '').trim() || null,
        title: ($('oh-m-title').value || '').trim() || null,
        qty: parseInt($('oh-m-qty').value, 10) || 1
      }
    ]
  };
  apiPost('/api/orders/import', order).then((r) => {
    if (r && r.error) {
      setFb('err', r.error);
      return;
    }
    setFb('ok', t('orders.added'));
    ['oh-m-oid', 'oh-m-cust', 'oh-m-email', 'oh-m-sku', 'oh-m-title', 'oh-m-shipby'].forEach((id) => {
      const el = $(id);
      if (el) el.value = '';
    });
    const q = $('oh-m-qty');
    if (q) q.value = '1';
    renderOrders();
  });
}

function _ordersImportCsv(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const lines = String(reader.result || '')
        .split(/\r?\n/)
        .filter((l) => l.trim());
      if (lines.length < 2) {
        setFb('err', t('orders.csvEmpty'));
        return;
      }
      const splitRow = (l) => l.split(/[,;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
      const head = splitRow(lines[0]).map((h) => h.toLowerCase());
      const col = (names) => {
        for (const n of names) {
          const i = head.indexOf(n);
          if (i >= 0) return i;
        }
        return -1;
      };
      const ci = {
        channel: col(['channel', 'kanal']),
        oid: col(['order_id', 'order id', 'channel_order_id', 'bestellnummer', 'order']),
        name: col(['customer_name', 'customer', 'name', 'kunde']),
        email: col(['customer_email', 'email', 'e-mail']),
        shipby: col(['ship_by', 'ship by', 'liefern bis', 'deliver_by']),
        sku: col(['sku', 'channel_sku', 'artikelnummer']),
        title: col(['title', 'item', 'artikel', 'produkt']),
        qty: col(['qty', 'quantity', 'menge', 'anzahl'])
      };
      if (ci.oid < 0) {
        setFb('err', t('orders.csvNoOrderId'));
        return;
      }
      const byId = new Map();
      for (let i = 1; i < lines.length; i++) {
        const cells = splitRow(lines[i]);
        const oid = cells[ci.oid];
        if (!oid) continue;
        const channel = (ci.channel >= 0 && cells[ci.channel]) || 'manual';
        const key = channel + '|' + oid;
        if (!byId.has(key)) {
          byId.set(key, {
            channel,
            channelOrderId: oid,
            customerName: ci.name >= 0 ? cells[ci.name] || null : null,
            customerEmail: ci.email >= 0 ? cells[ci.email] || null : null,
            shipBy: ci.shipby >= 0 ? cells[ci.shipby] || null : null,
            items: []
          });
        }
        byId.get(key).items.push({
          channelSku: ci.sku >= 0 ? cells[ci.sku] || null : null,
          title: ci.title >= 0 ? cells[ci.title] || null : null,
          qty: ci.qty >= 0 ? parseInt(cells[ci.qty], 10) || 1 : 1
        });
      }
      const orders = [...byId.values()];
      if (!orders.length) {
        setFb('err', t('orders.csvEmpty'));
        return;
      }
      apiPost('/api/orders/import', { orders }).then((r) => {
        if (r && r.error) {
          setFb('err', r.error);
          return;
        }
        setFb('ok', t('orders.imported', { n: r.imported != null ? r.imported : orders.length }));
        renderOrders();
      });
    } catch (err) {
      setFb('err', t('common.error'));
    }
  };
  reader.readAsText(file);
}

// ── Product catalog editor ──
const _OH_MAT_KEY = {
  grain: 'inv.grain',
  hardwood: 'inv.hardwood',
  wheatbran: 'inv.wheatBran',
  gypsum: 'inv.gypsum',
  coir: 'inv.coir'
};
function _ohMatName(mat) {
  return t(_OH_MAT_KEY[mat] || mat);
}
function _ohN(x) {
  return Math.round((x || 0) * 100) / 100;
}

// ── Hydration math: the ONE client-side source of truth ──────────────────────
// "Wet" substrate/grain weights include soak water; raw-material need is the dry
// matter left after removing rh% water. The SERVER (db.js computeBatchMaterialDeltas
// / computeProductMaterialNeed) is authoritative for inventory — these mirror it,
// so if the formula ever changes, KEEP db.js AND this in sync.
function mtGrainFactor(rhPct) {
  const rh = Number(rhPct) || 0;
  return rh > 0 ? 1 - rh / 100 : 1;
}
function mtDryKg(wetKg, rhPct) {
  return (Number(wetKg) || 0) * mtGrainFactor(rhPct);
}

// Per-unit raw-material need (dry kg) — mirrors db.computeProductMaterialNeed
// so the editor preview matches the demand board exactly.
function _ohProdNeedCompute(spec) {
  const need = { grain: 0, hardwood: 0, wheatbran: 0, gypsum: 0, coir: 0 };
  const num = (v) => (isFinite(+v) ? +v : 0);
  const type = spec.prodType || 'buy';
  if (type === 'block' || type === 'allinone') {
    const bagKg = num(spec.prodBagKg);
    const rh = num(spec.prodRhPct);
    const dry = mtDryKg(bagKg, rh);
    if ((spec.prodSubstrate || 'holzkleie') === 'cvg') {
      need.coir += dry * ((num(spec.prodCoirPct) || 100) / 100);
    } else {
      need.hardwood += dry * (num(spec.prodHardwoodPct) / 100);
      need.wheatbran += dry * (num(spec.prodWheatbranPct) / 100);
    }
    if (spec.prodGypsum) need.gypsum += dry * 0.01;
  }
  if (type === 'grain' || type === 'allinone') {
    const gKg = num(spec.prodGrainKg);
    const gRh = spec.prodGrainRhPct != null && spec.prodGrainRhPct !== '' ? num(spec.prodGrainRhPct) : 52;
    need.grain += mtDryKg(gKg, gRh);
  }
  return need;
}

function _ohReadProdForm() {
  return {
    prodType: $('oh-p-prodtype').value || 'buy',
    prodSubstrate: $('oh-p-substrate').value || 'holzkleie',
    prodBagKg: $('oh-p-bagkg').value,
    prodRhPct: $('oh-p-rh').value,
    prodHardwoodPct: $('oh-p-hw').value,
    prodWheatbranPct: $('oh-p-wb').value,
    prodCoirPct: $('oh-p-coir').value,
    prodGypsum: $('oh-p-gyp').checked ? 1 : 0,
    prodGrainKg: $('oh-p-grainkg').value,
    prodGrainRhPct: $('oh-p-grainrh').value
  };
}

function _ohProdTypeChange() {
  const type = $('oh-p-prodtype').value || 'buy';
  const sub = $('oh-p-substrate').value || 'holzkleie';
  const set = (id, disp) => {
    const el = $(id);
    if (el) el.style.display = disp;
  };
  set('oh-p-subgroup', type === 'block' || type === 'allinone' ? 'block' : 'none');
  set('oh-p-graingroup', type === 'grain' || type === 'allinone' ? 'block' : 'none');
  set('oh-p-holzgroup', sub === 'holzkleie' ? 'grid' : 'none');
  set('oh-p-coirgroup', sub === 'cvg' ? 'grid' : 'none');
  _ohProdNeed();
}

function _ohProdNeed() {
  const el = $('oh-p-need');
  if (!el) return;
  const need = _ohProdNeedCompute(_ohReadProdForm());
  const parts = Object.keys(need)
    .filter((m) => need[m] > 0)
    .map((m) => `${esc(_ohMatName(m))} ${_ohN(need[m])} kg`);
  el.textContent = parts.length ? t('orders.p.needPrefix') + ' ' + parts.join(' · ') : '';
}

function _ohProductForm(p) {
  const f = $('orders-prod-form');
  if (!f) return;
  f.style.display = 'block';
  $('oh-p-id').value = p && p.id ? p.id : '';
  $('oh-p-name').value = p ? p.name || '' : '';
  $('oh-p-sku').value = p ? p.sku || '' : '';
  $('oh-p-category').value = p ? p.category || 'all-in-one' : 'all-in-one';
  $('oh-p-stock').value = p && p.stock != null ? p.stock : 0;
  $('oh-p-lead').value = p && p.leadDays != null ? p.leadDays : 0;
  $('oh-p-prodtype').value = (p && p.prodType) || 'buy';
  $('oh-p-substrate').value = (p && p.prodSubstrate) || 'holzkleie';
  $('oh-p-bagkg').value = p && p.prodBagKg != null ? p.prodBagKg : 0;
  $('oh-p-rh').value = p && p.prodRhPct != null ? p.prodRhPct : 0;
  $('oh-p-hw').value = p && p.prodHardwoodPct != null ? p.prodHardwoodPct : 0;
  $('oh-p-wb').value = p && p.prodWheatbranPct != null ? p.prodWheatbranPct : 0;
  $('oh-p-coir').value = p && p.prodCoirPct != null ? p.prodCoirPct : 100;
  $('oh-p-gyp').checked = !!(p && p.prodGypsum);
  $('oh-p-grainkg').value = p && p.prodGrainKg != null ? p.prodGrainKg : 0;
  $('oh-p-grainrh').value = p && p.prodGrainRhPct != null ? p.prodGrainRhPct : 52;
  $('oh-p-prodtype').onchange = _ohProdTypeChange;
  $('oh-p-substrate').onchange = _ohProdTypeChange;
  f.oninput = _ohProdNeed;
  _ohProdTypeChange();
  const del = $('oh-p-delete');
  if (del) del.style.display = p && p.id ? 'inline-flex' : 'none';
}

function _ohProductSave() {
  const name = ($('oh-p-name').value || '').trim();
  if (!name) {
    setFb('err', t('orders.needName'));
    return;
  }
  const spec = _ohReadProdForm();
  const id = $('oh-p-id').value;
  const payload = {
    name,
    sku: ($('oh-p-sku').value || '').trim() || null,
    category: $('oh-p-category').value || null,
    stock: parseFloat($('oh-p-stock').value) || 0,
    leadDays: parseInt($('oh-p-lead').value, 10) || 0,
    prodType: spec.prodType,
    prodSubstrate: spec.prodSubstrate,
    prodBagKg: parseFloat(spec.prodBagKg) || 0,
    prodRhPct: parseFloat(spec.prodRhPct) || 0,
    prodHardwoodPct: parseFloat(spec.prodHardwoodPct) || 0,
    prodWheatbranPct: parseFloat(spec.prodWheatbranPct) || 0,
    prodCoirPct: parseFloat(spec.prodCoirPct) || 0,
    prodGypsum: spec.prodGypsum,
    prodGrainKg: parseFloat(spec.prodGrainKg) || 0,
    prodGrainRhPct: parseFloat(spec.prodGrainRhPct) || 52
  };
  const req = id ? apiPatch('/api/products/' + id, payload) : apiPost('/api/products', payload);
  req.then((r) => {
    if (r && r.error) {
      setFb('err', r.error);
      return;
    }
    setFb('ok', t('orders.productSaved'));
    const f = $('orders-prod-form');
    if (f) f.style.display = 'none';
    renderOrdersMapping();
  });
}

// ── Raw-material inventory (shared ledger) ──
function renderInventoryCard() {
  const body = $('orders-rawstock-body');
  if (!body) return;
  const stock = (inventory && inventory.stock) || {};
  const thr = (inventory && inventory.thresholds) || {};
  const mats = ['grain', 'hardwood', 'wheatbran', 'gypsum', 'coir'];
  body.innerHTML = mats
    .map((m) => {
      const have = stock[m] || 0;
      const min = (thr[m] && thr[m].minKg) || 0;
      const low = min > 0 && have <= min;
      return (
        `<tr><td><strong>${esc(_ohMatName(m))}</strong></td>` +
        `<td>${_ohN(have)}${low ? ' <span class="oh-warn">⚠︎</span>' : ''}</td>` +
        `<td style="white-space:nowrap"><input class="oh-inv-input" data-mat="${m}" type="number" min="0" step="0.1" value="${_ohN(have)}" style="width:80px" /> ` +
        `<button class="btn btn-sm" data-action="oh-inv-set" data-mat="${m}">${esc(t('orders.set'))}</button></td></tr>`
      );
    })
    .join('');
}
function _ohProductDelete() {
  const id = $('oh-p-id').value;
  if (!id) return;
  confirm2(t('common.delete'), t('orders.confirmDelete'), t('common.delete'), () => {
    apiDelete('/api/products/' + id).then((r) => {
      if (r && r.error) {
        setFb('err', r.error);
        return;
      }
      setFb('ok', t('orders.productDeleted'));
      const f = $('orders-prod-form');
      if (f) f.style.display = 'none';
      renderOrdersMapping();
    });
  });
}

// ─── MODALS ──────────────────────────────────────────────────
function confirm2(title, body, label, cb) {
  document.getElementById('m-title').textContent = title;
  document.getElementById('m-body').textContent = body;
  document.getElementById('m-ok').textContent = label || 'Confirm';
  confirmCb = cb;
  document.getElementById('m-confirm').classList.add('open');
}
function closeConfirm() {
  document.getElementById('m-confirm').classList.remove('open');
  confirmCb = null;
}
document.getElementById('m-ok').onclick = () => {
  if (confirmCb) confirmCb();
  closeConfirm();
};
document.getElementById('m-confirm').addEventListener('click', (e) => {
  if (e.target.id === 'm-confirm') closeConfirm();
});

let confirm3CbA = null;
let confirm3CbB = null;
function confirm3(title, body, labelA, labelB, cbA, cbB) {
  document.getElementById('m-title3').textContent = title;
  document.getElementById('m-body3').textContent = body;
  document.getElementById('m-ok3a').textContent = labelA;
  document.getElementById('m-ok3b').textContent = labelB;
  confirm3CbA = cbA;
  confirm3CbB = cbB;
  document.getElementById('m-confirm3').classList.add('open');
}
function closeConfirm3() {
  document.getElementById('m-confirm3').classList.remove('open');
  confirm3CbA = null;
  confirm3CbB = null;
}
document.getElementById('m-ok3a').onclick = () => {
  const cb = confirm3CbA;
  closeConfirm3();
  if (cb) cb();
};
document.getElementById('m-ok3b').onclick = () => {
  const cb = confirm3CbB;
  closeConfirm3();
  if (cb) cb();
};
document.getElementById('m-cancel3').onclick = closeConfirm3;
document.getElementById('m-confirm3').addEventListener('click', (e) => {
  if (e.target.id === 'm-confirm3') closeConfirm3();
});
let promptCb = null;
function prompt2(title, placeholder, cb) {
  document.getElementById('m-pr-title').textContent = title;
  const inp = document.getElementById('m-pr-input');
  inp.value = '';
  inp.placeholder = placeholder || '';
  promptCb = cb;
  document.getElementById('m-prompt').classList.add('open');
  setTimeout(() => inp.focus(), 80);
}
function closePrompt() {
  document.getElementById('m-prompt').classList.remove('open');
  promptCb = null;
}
document.getElementById('m-pr-ok').onclick = () => {
  if (promptCb) promptCb(document.getElementById('m-pr-input').value.trim());
  closePrompt();
};
document.getElementById('m-pr-cancel').onclick = closePrompt;
document.getElementById('m-prompt').addEventListener('click', (e) => {
  if (e.target.id === 'm-prompt') closePrompt();
});
document.getElementById('m-pr-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('m-pr-ok').click();
  }
});
function openNote(id) {
  const b = batches.find((x) => x.batchId === id);
  if (!b) return;
  noteId = id;
  document.getElementById('m-note-title').textContent = t('note.prefix') + id;
  document.getElementById('m-note-text').value = b.notes || '';
  document.getElementById('m-note').classList.add('open');
  setTimeout(() => document.getElementById('m-note-text').focus(), 80);
}
function closeNote() {
  document.getElementById('m-note').classList.remove('open');
  noteId = null;
}
function saveNote() {
  const b = batches.find((x) => x.batchId === noteId);
  if (b) {
    b.notes = document.getElementById('m-note-text').value.trim();
    apiPatch('/api/batches/' + encodeURIComponent(noteId), { notes: b.notes });
    renderBatches();
  }
  closeNote();
}
document.getElementById('m-note').addEventListener('click', (e) => {
  if (e.target.id === 'm-note') closeNote();
});

// Batch-add modal
function openBatchAdd() {
  const bs = document.getElementById('ba-batch');
  bs.innerHTML =
    '<option value="">— choose batch —</option>' +
    batches
      .map((b) => {
        const kz = b.strainKuerzel || b.strain || '';
        const name = b.strainName || b.species || '';
        const st = (b.strainText || '').trim();
        const label = (kz ? '[' + esc(kz) + '] ' : '') + esc(b.batchId) + ' — ' + esc(name) + (st ? ' ' + esc(st) : '');
        return `<option value="${esc(b.batchId)}">${label}</option>`;
      })
      .join('');
  const ls = document.getElementById('ba-loc');
  ls.innerHTML = [...ZONES, ...ALL_RACKS].map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  bs.onchange = baPreview;
  ls.onchange = baPreview;
  document.getElementById('m-batchadd').classList.add('open');
}
function closeBatchAdd() {
  document.getElementById('m-batchadd').classList.remove('open');
}
function baPreview() {
  const id = document.getElementById('ba-batch').value,
    loc = document.getElementById('ba-loc').value,
    b = batches.find((x) => x.batchId === id);
  document.getElementById('ba-prev').textContent = b ? `Will log ${b.bags.length} bags → ${loc}` : '';
}
document.getElementById('m-batchadd').addEventListener('click', (e) => {
  if (e.target.id === 'm-batchadd') closeBatchAdd();
});
function confirmBatchAdd() {
  const id = document.getElementById('ba-batch').value,
    loc = document.getElementById('ba-loc').value,
    batch = batches.find((x) => x.batchId === id);
  if (!id || !batch) {
    alert(t('batchadd.selectBatch'));
    return;
  }
  if (!loc) {
    alert(t('batchadd.selectLoc'));
    return;
  }
  const now = new Date().toISOString();
  const entries = [];
  batch.bags.forEach((bagId) => {
    const tempId = 's' + ++_scanTempIdCounter;
    const entry = {
      time: now,
      action: 'ADD',
      batch: id,
      bag: bagId,
      from: null,
      to: loc,
      species: batch.species,
      strain: batch.strain,
      user: currentUser?.username || null,
      client_uuid: newScanUuid(),
      _tempId: tempId
    };
    scanLog.push(entry);
    movements.push(entry);
    if (!sessionStartTime) sessionStartTime = Date.now();
    sessionEntries.push(entry);
    scan.count++;
    entries.push(entry);
  });
  apiPost('/api/scan-log', { entries }).then(function (r) {
    if (r && r.ids)
      entries.forEach((e, i) => {
        setEntryServerId(e, r.ids[i]);
      });
  });
  updateSD();
  setFb('ok', `Batch ADD: ${batch.bags.length} bags → ${loc}`);
  closeBatchAdd();
}

// ─── HELPERS ─────────────────────────────────────────────────
const abbrev = (s) => {
  if (!s) return 'BAGX';
  const ms = mushroomStrains.find((x) => x.name.toLowerCase() === s.toLowerCase());
  if (ms && ms.kuerzel) return ms.kuerzel;
  return s.replace(/\s+/g, '').slice(0, 4).toUpperCase().padEnd(4, 'X');
};
const todayStr = () => {
  const d = new Date();
  return (
    String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()).slice(2)
  );
};
const genBatchId = (sp) => {
  const ab = abbrev(sp),
    dt = todayStr(),
    n = batches.filter((b) => b.batchId.startsWith(ab + '-' + dt)).length;
  return ab + '-' + dt + '-' + String(n + 1).padStart(2, '0');
};
const sbadge = (s) => {
  const m = {
    INCUBATING: 'b-inc',
    FRUITING: 'b-tent',
    'SPAWN RUN': 'b-spawn',
    CONTAM: 'b-contam',
    DONE: 'b-done',
    EMPTY: 'b-done'
  };
  return `<span class="badge ${m[s] || 'b-done'}">${s}</span>`;
};

// ─── STATUS CALC ─────────────────────────────────────────────
// I-10/I-14/I-21: derive zone counts from the *last* event per bag instead
// of incrementally counting deltas. This naturally handles out-of-order
// scan replays (e.g. an offline REMOVE that arrives after a fresh ADD): the
// latest scan-log entry by id always wins, so a stale event can't push a
// bag's tracked count below zero or above one.
//
// P-05: getStatus(id) used to walk the entire scanLog per call, and was
// invoked from inside the renderBatches fingerprint loop AND the body
// `.map`. With 200 batches × 50K scans that was ~10M comparisons per
// render. We now build a per-batch lookup map once per applyData() and
// invalidate it whenever scanLog mutates (set _statusByBatch = null).
let _statusByBatch = null;
let _hasScanByBatch = null; // batch -> true (used for the EMPTY-vs-DONE branch)
function _emptyStatus() {
  const c = {};
  if (Array.isArray(ZONES)) ZONES.forEach((z) => (c[z] = 0));
  return { c, total: 0, status: 'EMPTY', action: '' };
}
// Which growth stage a bag of `batchType` is in while it sits in a zone of
// `role`. The room alone cannot answer this: grain spawn lives in the aircon
// incubation room whenever the spawn tent runs too hot, and finished blocks get
// parked in the spawn tent — so keying off the room called grain "incubating"
// and called blocks a "spawn run". A fruiting or contamination room still wins
// outright (that genuinely IS a stage change); anywhere else the batch decides.
function stageOf(role, batchType) {
  if (role === 'fruiting' || role === 'contaminated') return role;
  return batchType === 'grain' ? 'spawn' : 'incubation';
}
function _statusFromCounts(c, hasScans, batchType) {
  let total = 0;
  for (const k in c) total += c[k];
  const byRole = {};
  for (const z of zones) {
    const st = stageOf(z.role, batchType);
    if (!byRole[st]) byRole[st] = 0;
    byRole[st] += c[z.id] || 0;
  }
  let status = 'EMPTY',
    action = '';
  if (byRole.fruiting > 0) {
    status = 'FRUITING';
    action = t('status.action.harvest');
  } else if (byRole.incubation > 0) {
    status = 'INCUBATING';
    action = t('status.action.moveTent');
  } else if (byRole.spawn > 0) {
    status = 'SPAWN RUN';
    action = t('status.action.monitorSpawn');
  } else if (byRole.contaminated > 0) {
    status = 'CONTAM';
    action = t('status.action.discard');
  } else if (total === 0 && hasScans) {
    // Scan events exist for this batch but no remaining bags — DONE
    status = 'DONE';
  }
  return { c, total, status, action };
}
function _buildStatusByBatch() {
  // For each batch, find the last scan-log event per bag. Pre-bucket by
  // batch so we never iterate scanLog more than once. scanLog is ordered
  // by server id (see db.js getScanLog ORDER BY s.id), so a simple
  // forward iteration makes the highest-id entry win for each bag.
  const lastByBatchBag = new Map(); // batchId -> Map<bagKey, event>
  const hasByBatch = new Map();
  for (const e of scanLog) {
    if (!e.batch) continue;
    hasByBatch.set(e.batch, true);
    let m = lastByBatchBag.get(e.batch);
    if (!m) {
      m = new Map();
      lastByBatchBag.set(e.batch, m);
    }
    const key = e.bag || `__batch__:${e.batch}`;
    m.set(key, e);
  }
  // batch -> type, so stageOf() can tell grain from a block without a lookup
  // inside the per-zone loop.
  const typeById = new Map();
  for (const b of batches) typeById.set(b.batchId, b.batchType);
  const out = new Map();
  for (const [batchId, m] of lastByBatchBag) {
    const c = {};
    if (Array.isArray(ZONES)) ZONES.forEach((z) => (c[z] = 0));
    for (const e of m.values()) {
      if (e.action === 'REMOVE') continue;
      const tz = toZone(e.to);
      if (tz && c[tz] !== undefined) c[tz]++;
    }
    out.set(batchId, _statusFromCounts(c, true, typeById.get(batchId)));
  }
  _hasScanByBatch = hasByBatch;
  return out;
}
function getStatus(id) {
  if (!_statusByBatch) _statusByBatch = _buildStatusByBatch();
  const cached = _statusByBatch.get(id);
  if (cached) return cached;
  // No scan events for this batch yet — return EMPTY.
  return _emptyStatus();
}
const getHarvested = (id) => harvests.filter((h) => h.batch === id).reduce((s, h) => s + (h.grams || 0), 0);

// ─── DASHBOARD ───────────────────────────────────────────────
let batchYieldInst = null,
  timelineInst = null;

// True iff the batch's due date is strictly before today (local-midnight comparison).
// Both sides are normalized to local midnight so the answer doesn't flip partway
// through the day in non-UTC timezones — b.due is stored as toISOString() (UTC),
// so comparing it against "now" would otherwise drift by the local offset.
function isBatchOverdue(b, now) {
  const today = now ? new Date(now) : new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(b.due);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

function renderPipelineKPIs(tot, spawn, inc, tent, done, contam) {
  const el = document.getElementById('metrics');
  if (!el) return;
  // Pick up zone colors if configured
  const zSpawn = zones.find((z) => z.role === 'spawn');
  const zInc = zones.find((z) => z.role === 'incubation');
  const zTent = zones.find((z) => z.role === 'fruiting');
  const zContam = zones.find((z) => z.role === 'contaminated');
  const stages = [
    {
      label: 'SPAWN',
      value: spawn,
      color: zSpawn?.color || '#a855f7',
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="10" ry="6"/><line x1="12" y1="6" x2="12" y2="18"/></svg>`
    },
    {
      label: 'INC',
      value: inc,
      color: zInc?.color || '#0ea5e9',
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
    },
    {
      label: 'TENT',
      value: tent,
      color: zTent?.color || '#10b981',
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>`
    },
    {
      label: 'DONE',
      value: done,
      color: '#64748b',
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`
    },
    {
      label: 'CONTAM',
      value: contam,
      color: zContam?.color || '#ef4444',
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
    }
  ];
  const totalRow = `<div class="metrics-total-row"><span class="metrics-total-label">${t('dash.totalBatches')}</span><span class="metrics-total-value">${tot}</span></div>`;
  el.innerHTML =
    totalRow +
    `<div class="g5 metrics-pipeline">${stages.map((s) => `<div class="met" style="border-left-color:${s.color}"><div class="met-l"><span style="display:inline-flex;vertical-align:middle;margin-right:6px;color:${s.color}">${s.icon}</span>${s.label}</div><div class="met-v" style="color:${s.value > 0 ? s.color : 'var(--c-text-muted)'}">${s.value}</div></div>`).join('')}</div>`;
}

function renderOverviewKPIs() {
  if (dashMode !== 'overview') return;
  const weekEl = document.getElementById('ov-kpi-week');
  const substratesEl = document.getElementById('ov-kpi-substrates');
  const qualEl = document.getElementById('ov-kpi-quality');
  if (!weekEl || !qualEl) return;

  applyOvPeriod();

  const now = Date.now();
  const nowDate = new Date();

  // Period start based on selected period
  let periodStart;
  if (ovPeriod === 'week') {
    // Monday of the current week (Mon–Sun)
    periodStart = new Date(nowDate);
    periodStart.setDate(periodStart.getDate() - ((periodStart.getDay() + 6) % 7));
    periodStart.setHours(0, 0, 0, 0);
  } else if (ovPeriod === 'month') periodStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
  else periodStart = new Date(nowDate.getFullYear(), 0, 1);

  // ── PRODUCTION ─────────────────────────────────────────────
  // 1. Bags created
  const bagsCreated = batches.filter((b) => new Date(b.created) >= periodStart).reduce((s, b) => s + (b.qty || 0), 0);

  // 2. Grain used (kg) — from inventory log
  const grainUsed = (inventory.log || [])
    .filter((e) => e.mat === 'grain' && e.type === 'batch' && new Date(e.time) >= periodStart)
    .reduce((s, e) => s + Math.abs(e.deltaKg || 0), 0);

  // 3. Harvest (kg)
  const periodHarvests = harvests.filter((h) => new Date(h.time) >= periodStart);
  const periodHarvestKg = periodHarvests.reduce((s, h) => s + (h.grams || 0), 0) / 1000;

  // 4. Substrate used (kg) — hardwood and wheat bran tracked separately
  let hardwoodUsed = 0,
    wheatbranUsed = 0;
  (inventory.log || []).forEach((e) => {
    if (e.type !== 'batch' || new Date(e.time) < periodStart) return;
    if (e.mat === 'hardwood') hardwoodUsed += Math.abs(e.deltaKg || 0);
    else if (e.mat === 'wheatbran') wheatbranUsed += Math.abs(e.deltaKg || 0);
  });

  // ── QUALITY & EFFICIENCY ──────────────────────────────────
  // 5. Avg yield per bag (g) — all-time + period comparison
  const uniqueHarvestedBags = new Set(harvests.map((h) => h.bag)).size;
  const avgYield =
    uniqueHarvestedBags > 0 ? Math.round(harvests.reduce((s, h) => s + (h.grams || 0), 0) / uniqueHarvestedBags) : 0;
  // Period yield: avg grams per unique bag harvested in selected period
  const periodBags = new Set(periodHarvests.map((h) => h.bag));
  const periodYield =
    periodBags.size > 0 ? Math.round(periodHarvests.reduce((s, h) => s + (h.grams || 0), 0) / periodBags.size) : 0;
  const yieldDelta = avgYield > 0 && periodYield > 0 ? periodYield - avgYield : null;
  // periodSub = label for the selected period ("This week"/"This month"/…).
  // Declared here (not further down) because yieldSub below references it —
  // a later `const` would throw a temporal-dead-zone ReferenceError and abort
  // the whole render whenever there is a harvest in the period.
  const periodSub = t('dash.ov.period' + ovPeriod.charAt(0).toUpperCase() + ovPeriod.slice(1));
  let yieldSub = t('dash.ov.perBag');
  if (periodYield > 0) {
    const arrow = yieldDelta > 0 ? '↑' : yieldDelta < 0 ? '↓' : '=';
    const color = yieldDelta > 0 ? 'var(--c-green-dark)' : yieldDelta < 0 ? 'var(--c-red-dark)' : '';
    yieldSub = periodSub + ': ' + periodYield + 'g <span style="color:' + color + '">' + arrow + '</span>';
  }

  // 6. Contamination rate (%)
  // I-13: numerator must be a subset of the denominator. addedBags is the
  // set of bags that ever had an ADD; contamBagSet only counts bags that
  // both had an ADD AND were moved to a contaminated zone. Without this
  // intersection a MOVE-only contaminated bag (e.g. an auto-MOVE from a
  // contamination report on a bag that pre-dated explicit ADD tracking)
  // would push the percentage above 100.
  const addedBags = new Set(scanLog.filter((e) => e.action === 'ADD' && e.bag).map((e) => e.bag));
  const allBagsPlaced = addedBags.size;
  const contamBagSet = new Set();
  scanLog.forEach((e) => {
    if (!e.to || !e.bag) return;
    if (!addedBags.has(e.bag)) return;
    const z = ZONE_BY_ID[toZone(e.to)];
    if (z && z.role === 'contaminated') contamBagSet.add(e.bag);
  });
  const contamRate = allBagsPlaced > 0 ? +((contamBagSet.size / allBagsPlaced) * 100).toFixed(1) : 0;
  const contamColor = contamRate === 0 ? 'var(--c-green)' : contamRate <= 5 ? 'var(--c-amber)' : 'var(--c-red)';
  const contamBg =
    contamRate === 0 ? 'var(--c-green-light)' : contamRate <= 5 ? 'var(--c-amber-light)' : 'var(--c-red-light)';

  // 7. Days without contamination (streak)
  const contamEvents = scanLog.filter((e) => {
    if (!e.to || !e.bag) return false;
    const z = ZONE_BY_ID[toZone(e.to)];
    return z && z.role === 'contaminated';
  });
  let daysSinceContam = null,
    daysSinceLabel = '';
  if (contamEvents.length === 0) {
    daysSinceContam = batches.length > 0 ? Math.floor((now - new Date(batches[0].created)) / 864e5) : null;
    daysSinceLabel = t('dash.ov.neverContam');
  } else {
    daysSinceContam = Math.floor((now - new Date(contamEvents[contamEvents.length - 1].time)) / 864e5);
    daysSinceLabel = daysSinceContam === 1 ? t('dash.ov.dayAgo') : t('dash.ov.daysAgo', { n: daysSinceContam });
  }
  const streakColor =
    daysSinceContam === null
      ? 'var(--c-text-muted)'
      : daysSinceContam >= 14
        ? 'var(--c-green)'
        : daysSinceContam >= 7
          ? 'var(--c-amber)'
          : 'var(--c-red)';
  const streakBg =
    daysSinceContam === null
      ? 'var(--c-bg)'
      : daysSinceContam >= 14
        ? 'var(--c-green-light)'
        : daysSinceContam >= 7
          ? 'var(--c-amber-light)'
          : 'var(--c-red-light)';

  // 8. Flush 2+ bags (bags that have had ≥2 harvests logged)
  const bagFlushMax = {};
  harvests.forEach((h) => {
    if (!bagFlushMax[h.bag] || h.flush > bagFlushMax[h.bag]) bagFlushMax[h.bag] = h.flush || 1;
  });
  const flush2Plus = Object.values(bagFlushMax).filter((f) => f >= 2).length;

  // ── HELPER ────────────────────────────────────────────────
  function card(icon, value, label, sub, accentColor, accentBg) {
    return `<div class="ov-kpi-card">
      <div class="ov-kpi-icon" style="color:${accentColor};background:${accentBg}">${icon}</div>
      <div class="ov-kpi-body">
        <div class="ov-kpi-value" style="color:${accentColor}">${value}</div>
        <div class="ov-kpi-label">${label}</div>
        ${sub ? `<div class="ov-kpi-sub">${sub}</div>` : ''}
      </div>
    </div>`;
  }

  const fmtKg = (v) => (v >= 10 ? Math.round(v) + 'kg' : v.toFixed(1) + 'kg');

  // Icons
  const iconBag = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>`;
  const iconGrain = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 110 20A10 10 0 0112 2z"/><path d="M12 6v12M8 8l4 4 4-4M8 16l4-4 4 4"/></svg>`;
  const iconHarvest = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;
  const iconSubstrate = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>`;
  const iconYield = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`;
  const iconContam = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  const iconStreak = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
  const iconFlush = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>`;

  const periodLabel = document.getElementById('ov-period-label');
  if (periodLabel) periodLabel.textContent = periodSub;

  weekEl.innerHTML = [
    card(iconBag, bagsCreated || '0', t('dash.ov.bagsCreated'), periodSub, '#2d6a4f', '#e6f2ec'),
    card(
      iconHarvest,
      periodHarvestKg > 0 ? fmtKg(periodHarvestKg) : '—',
      t('dash.ov.harvestThisWeek'),
      periodHarvests.length + ' ' + t('dash.ov.harvests'),
      '#c2703e',
      '#faf0e6'
    ),
    card(iconFlush, flush2Plus || '0', t('dash.ov.flush2Plus'), t('dash.ov.bagsOnSecondFlush'), '#3a7d7b', '#e6f2f1'),
    card(iconYield, avgYield > 0 ? avgYield + 'g' : '—', t('dash.ov.avgYield'), yieldSub, '#5a8a32', '#eef4e5')
  ].join('');

  if (substratesEl)
    substratesEl.innerHTML = [
      card(
        iconGrain,
        grainUsed > 0 ? fmtKg(grainUsed) : '—',
        t('dash.ov.grainUsed'),
        t('dash.ov.fromBatches'),
        '#6b7c3f',
        '#f0f2e6'
      ),
      card(
        iconSubstrate,
        hardwoodUsed > 0 ? fmtKg(hardwoodUsed) : '—',
        t('dash.ov.hardwoodUsed'),
        t('dash.ov.fromBatches'),
        '#8b5e3c',
        '#f5ede6'
      ),
      card(
        iconSubstrate,
        wheatbranUsed > 0 ? fmtKg(wheatbranUsed) : '—',
        t('dash.ov.wheatbranUsed'),
        t('dash.ov.fromBatches'),
        '#c9a227',
        '#faf5e0'
      )
    ].join('');

  qualEl.innerHTML = [
    card(
      iconContam,
      contamRate + '%',
      t('dash.ov.contamRate'),
      contamBagSet.size + ' / ' + allBagsPlaced + ' ' + t('dash.ov.bags'),
      contamColor,
      contamBg
    ),
    card(
      iconStreak,
      daysSinceContam !== null ? daysSinceContam : t('dash.ov.na'),
      t('dash.ov.daysSinceContam'),
      daysSinceLabel,
      streakColor,
      streakBg
    )
  ].join('');

  renderOverviewCharts(periodStart);
}

let ovChartHarvestInst = null,
  ovChartSpeciesInst = null,
  ovChartSubstrateInst = null,
  ovChartBagsInst = null;

function renderOverviewCharts(periodStart) {
  // P-02: Chart.js is lazy-loaded. If the idle preload hasn't fired yet,
  // skip this render and re-fire once the lib is ready. The page is fully
  // usable in the meantime — just no charts. (renderOverviewCharts is
  // already a no-op when the canvases aren't in the DOM, so callers don't
  // need their own guard.)
  if (typeof Chart === 'undefined') {
    loadVendorLibs().then(() => renderOverviewCharts(periodStart));
    return;
  }
  const nowDate = new Date();
  const periodHarvests = harvests.filter((h) => new Date(h.time) >= periodStart);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ── Helpers: build time buckets depending on period ──────
  function buildTimeBuckets() {
    if (ovPeriod === 'week') {
      // Full week Mon–Sun (7 days)
      const days = [];
      const cur = new Date(periodStart);
      for (let i = 0; i < 7; i++) {
        days.push(localDateStr(cur));
        cur.setDate(cur.getDate() + 1);
      }
      const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
      return { keys: days, label: (k, i) => dayNames[i] + ' ' + fmtDtShort(k), groupKey: (d) => localDateStr(d) };
    }
    if (ovPeriod === 'month') {
      // Full month 1st to last day
      const days = [];
      const cur = new Date(periodStart);
      const lastDay = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0);
      while (cur <= lastDay) {
        days.push(localDateStr(cur));
        cur.setDate(cur.getDate() + 1);
      }
      return { keys: days, label: (k) => fmtDtShort(k), groupKey: (d) => localDateStr(d) };
    }
    // year — monthly buckets Jan–Dec
    const mKeys = Array.from({ length: 12 }, (_, i) => `${nowDate.getFullYear()}-${String(i + 1).padStart(2, '0')}`);
    return {
      keys: mKeys,
      label: (k) => monthNames[parseInt(k.split('-')[1]) - 1],
      groupKey: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    };
  }
  const { keys, label, groupKey } = buildTimeBuckets();

  // ── Chart titles ─────────────────────────────────────────
  const harvestLabel = document.getElementById('ov-chart-harvest-label');
  const speciesLabel = document.getElementById('ov-chart-species-label');
  const substrateLabel = document.getElementById('ov-chart-substrate-label');
  const bagsLabel = document.getElementById('ov-chart-bags-label');
  if (ovPeriod === 'week') {
    if (harvestLabel) harvestLabel.textContent = t('dash.ov.dailyHarvest') || 'Daily harvest';
    if (substrateLabel) substrateLabel.textContent = t('dash.ov.weeklySubstrate') || 'Substrate usage';
    if (bagsLabel) bagsLabel.textContent = t('dash.ov.bagsCreated') || 'Bags created';
  } else if (ovPeriod === 'month') {
    if (harvestLabel) harvestLabel.textContent = t('dash.ov.dailyHarvest') || 'Daily harvest';
    if (substrateLabel) substrateLabel.textContent = t('dash.ov.weeklySubstrate') || 'Substrate by week';
    if (bagsLabel) bagsLabel.textContent = t('dash.ov.bagsCreated') || 'Bags created';
  } else {
    if (harvestLabel) harvestLabel.textContent = t('dash.ov.monthlyHarvest') || 'Monthly harvest';
    if (substrateLabel) substrateLabel.textContent = t('dash.ov.weeklySubstrate') || 'Substrate by month';
    if (bagsLabel) bagsLabel.textContent = t('dash.ov.monthlyBags') || 'Bags created by month';
  }
  if (speciesLabel) speciesLabel.textContent = t('dash.harvestBySpecies') || 'Harvest by species (kg)';

  // ── 1. Harvest over time ─────────────────────────────────
  const c1 = document.getElementById('ov-chart-harvest');
  if (c1) {
    const harvestMap = {};
    periodHarvests.forEach((h) => {
      const k = groupKey(new Date(h.time));
      harvestMap[k] = (harvestMap[k] || 0) + (h.grams || 0);
    });
    if (ovChartHarvestInst) {
      ovChartHarvestInst.destroy();
      ovChartHarvestInst = null;
    }
    const ctx = c1.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 180);
    grad.addColorStop(0, 'rgba(194,112,62,0.25)');
    grad.addColorStop(1, 'rgba(194,112,62,0.02)');
    const useBar = ovPeriod === 'year';
    ovChartHarvestInst = new Chart(c1, {
      type: useBar ? 'bar' : 'line',
      data: {
        labels: keys.map((k, i) => label(k, i)),
        datasets: [
          {
            data: keys.map((k) => +((harvestMap[k] || 0) / 1000).toFixed(2)),
            fill: !useBar,
            backgroundColor: useBar
              ? keys.map((k, i) =>
                  ovPeriod === 'year' && i === nowDate.getMonth() ? '#c2703e' : 'rgba(194,112,62,0.55)'
                )
              : grad,
            borderColor: '#c2703e',
            borderWidth: 2,
            pointRadius: keys.length > 20 ? 0 : 3,
            pointBackgroundColor: '#c2703e',
            borderRadius: useBar ? 6 : 0,
            tension: 0.35
          }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.y.toFixed(2) + 'kg' } } },
        scales: {
          y: { ticks: { callback: (v) => v + 'kg', color: '#94a3b8' }, grid: { color: '#e2e8f0' }, beginAtZero: true },
          x: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 14 }, grid: { display: false } }
        }
      }
    });
  }

  // ── 2. Harvest by species ────────────────────────────────
  const c2 = document.getElementById('ov-chart-species');
  if (c2) {
    const bySpecies = {};
    periodHarvests.forEach((h) => {
      bySpecies[h.species] = (bySpecies[h.species] || 0) + (h.grams || 0);
    });
    const spLabels = Object.keys(bySpecies);
    const spData = spLabels.map((s) => bySpecies[s] / 1000);
    if (ovChartSpeciesInst) {
      ovChartSpeciesInst.destroy();
      ovChartSpeciesInst = null;
    }
    if (!spLabels.length) {
      const ctx = c2.getContext('2d');
      ctx.clearRect(0, 0, c2.width, c2.height);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(t('harvest.noData'), c2.width / 2, 80);
    } else {
      const fmtKg = (v) => Math.round(v * 100) / 100 + 'kg';
      const ctx = c2.getContext('2d');
      const bgColors = spLabels.map((s) => {
        const g = ctx.createLinearGradient(0, 0, 0, c2.clientHeight || 180);
        g.addColorStop(0, spColor(s) + 'ee');
        g.addColorStop(1, spColor(s) + '55');
        return g;
      });
      const dataLabelPlugin = {
        id: 'harvestDataLabels',
        afterDatasetsDraw(chart) {
          const { ctx: cc, data } = chart;
          chart.getDatasetMeta(0).data.forEach((bar, i) => {
            const val = data.datasets[0].data[i];
            if (!val) return;
            cc.save();
            cc.fillStyle = '#475569';
            cc.font = 'bold 11px system-ui';
            cc.textAlign = 'center';
            cc.textBaseline = 'bottom';
            cc.fillText(fmtKg(val), bar.x, bar.y - 4);
            cc.restore();
          });
        }
      };
      ovChartSpeciesInst = new Chart(c2, {
        type: 'bar',
        plugins: [dataLabelPlugin],
        data: {
          labels: spLabels,
          datasets: [
            {
              data: spData,
              backgroundColor: bgColors,
              borderColor: spLabels.map((s) => spColor(s)),
              borderWidth: 1.5,
              borderRadius: 8,
              borderSkipped: false
            }
          ]
        },
        options: {
          responsive: true,
          layout: { padding: { top: 22 } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtKg(c.parsed.y) } } },
          scales: {
            y: {
              ticks: { callback: (v) => fmtKg(v), color: '#94a3b8' },
              grid: { color: '#e2e8f0' },
              beginAtZero: true
            },
            x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
          }
        }
      });
    }
  }

  // ── 3. Substrate usage ───────────────────────────────────
  const c3 = document.getElementById('ov-chart-substrate');
  if (c3) {
    const hwMap = {},
      wbMap = {},
      grMap = {};
    (inventory.log || []).forEach((e) => {
      if (e.type !== 'batch') return;
      if (e.mat !== 'hardwood' && e.mat !== 'wheatbran' && e.mat !== 'grain') return;
      const d = new Date(e.time);
      if (d < periodStart) return;
      let k;
      if (ovPeriod === 'year') {
        k = groupKey(d);
      } else {
        // group by week (Monday)
        const mon = new Date(d);
        mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        k = localDateStr(mon);
      }
      if (e.mat === 'hardwood') hwMap[k] = (hwMap[k] || 0) + Math.abs(e.deltaKg || 0);
      else if (e.mat === 'wheatbran') wbMap[k] = (wbMap[k] || 0) + Math.abs(e.deltaKg || 0);
      else if (e.mat === 'grain') grMap[k] = (grMap[k] || 0) + Math.abs(e.deltaKg || 0);
    });
    let subKeys, subLabels;
    if (ovPeriod === 'year') {
      subKeys = keys;
      subLabels = keys.map((k, i) => label(k, i));
    } else {
      subKeys = [...new Set([...Object.keys(hwMap), ...Object.keys(wbMap), ...Object.keys(grMap)])].sort();
      subLabels = subKeys.map((k) => 'KW ' + isoWeekNumber(k));
    }
    if (ovChartSubstrateInst) {
      ovChartSubstrateInst.destroy();
      ovChartSubstrateInst = null;
    }
    if (!subKeys.length) {
      const ctx = c3.getContext('2d');
      ctx.clearRect(0, 0, c3.width, c3.height);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(t('dash.noHarvestData'), c3.width / 2, 60);
    } else {
      ovChartSubstrateInst = new Chart(c3, {
        type: 'bar',
        data: {
          labels: subLabels,
          datasets: [
            {
              label: t('dash.ov.grain'),
              data: subKeys.map((k) => +(grMap[k] || 0).toFixed(1)),
              backgroundColor: '#6b7c3f',
              borderRadius: 5
            },
            {
              label: t('dash.ov.hardwood'),
              data: subKeys.map((k) => +(hwMap[k] || 0).toFixed(1)),
              backgroundColor: '#8b5e3c',
              borderRadius: 5
            },
            {
              label: t('dash.ov.wheatbran'),
              data: subKeys.map((k) => +(wbMap[k] || 0).toFixed(1)),
              backgroundColor: '#c9a227',
              borderRadius: 5
            }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
            tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + c.parsed.y.toFixed(1) + 'kg' } }
          },
          scales: {
            y: {
              ticks: { callback: (v) => v + 'kg', color: '#94a3b8' },
              grid: { color: '#e2e8f0' },
              beginAtZero: true
            },
            x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
          }
        }
      });
    }
  }

  // ── 4. Bags created ──────────────────────────────────────
  const c4 = document.getElementById('ov-chart-bags');
  if (c4) {
    const bagMap = {};
    batches
      .filter((b) => new Date(b.created) >= periodStart)
      .forEach((b) => {
        const k = groupKey(new Date(b.created));
        bagMap[k] = (bagMap[k] || 0) + (b.qty || 0);
      });
    if (ovChartBagsInst) {
      ovChartBagsInst.destroy();
      ovChartBagsInst = null;
    }
    ovChartBagsInst = new Chart(c4, {
      type: 'bar',
      data: {
        labels: keys.map((k, i) => label(k, i)),
        datasets: [
          {
            data: keys.map((k) => bagMap[k] || 0),
            backgroundColor: keys.map((k, i) =>
              ovPeriod === 'year' && i === nowDate.getMonth() ? '#2d6a4f' : 'rgba(45,106,79,0.55)'
            ),
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => c.parsed.y + ' ' + t('dash.ov.bags') } }
        },
        scales: {
          y: { ticks: { color: '#94a3b8' }, grid: { color: '#e2e8f0' }, beginAtZero: true },
          x: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 14 }, grid: { display: false } }
        }
      }
    });
  }
}

// ── KPI History (daily snapshot trend charts) ───────────────
let kpiHistoryData = null;
let ovHistHarvestInst = null,
  ovHistPipelineInst = null,
  ovHistContamInst = null,
  ovHistStockInst = null;

async function loadKpiHistory() {
  try {
    const r = await fetch('/api/kpi-snapshots?limit=90');
    if (!r.ok) return;
    const j = await r.json();
    kpiHistoryData = j.items || [];
    renderKpiHistory();
  } catch (e) {
    console.warn('KPI history load failed', e);
  }
}

function renderKpiHistory() {
  const wrap = document.getElementById('ov-kpi-history');
  const emptyEl = document.getElementById('ov-history-empty');
  const chartsEl = document.getElementById('ov-history-charts');
  if (!wrap) return;
  if (dashMode !== 'overview') {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  // P-02: Chart.js may not be loaded yet (idle preload). Defer.
  if (typeof Chart === 'undefined') {
    loadVendorLibs().then(() => renderKpiHistory());
    return;
  }

  if (!kpiHistoryData || kpiHistoryData.length < 2) {
    if (emptyEl) emptyEl.style.display = '';
    if (chartsEl) chartsEl.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (chartsEl) chartsEl.style.display = '';

  // Filter snapshots by the selected overview period + build fixed date range
  const nowDate = new Date();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let periodStart;
  if (ovPeriod === 'week') {
    periodStart = new Date(nowDate);
    periodStart.setDate(periodStart.getDate() - ((periodStart.getDay() + 6) % 7));
    periodStart.setHours(0, 0, 0, 0);
  } else if (ovPeriod === 'month') {
    periodStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
  } else {
    periodStart = new Date(nowDate.getFullYear(), 0, 1);
  }
  const periodKey = localDateStr(periodStart);
  const filtered = kpiHistoryData.filter((s) => s.date >= periodKey);
  if (!filtered.length) {
    if (emptyEl) emptyEl.style.display = '';
    if (chartsEl) chartsEl.style.display = 'none';
    return;
  }

  // Build lookup + fixed date keys so x-axis always covers the full period
  const snapshotMap = {};
  filtered.forEach((s) => {
    snapshotMap[s.date] = s;
  });

  const histKeys = []; // date keys for x-axis
  const histLabels = []; // display labels
  if (ovPeriod === 'week') {
    // Mon–Sun (7 days)
    const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    const cur = new Date(periodStart);
    for (let i = 0; i < 7; i++) {
      histKeys.push(localDateStr(cur));
      histLabels.push(dayNames[i] + ' ' + fmtDtShort(cur));
      cur.setDate(cur.getDate() + 1);
    }
  } else if (ovPeriod === 'month') {
    // 1st to last day of month
    const cur = new Date(periodStart);
    const lastDay = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0);
    while (cur <= lastDay) {
      histKeys.push(localDateStr(cur));
      histLabels.push(fmtDtShort(cur));
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    // Year — Jan to Dec monthly buckets, use last snapshot per month
    for (let m = 0; m < 12; m++) {
      histKeys.push(`${nowDate.getFullYear()}-${String(m + 1).padStart(2, '0')}`);
      histLabels.push(monthNames[m]);
    }
    // Build monthly lookup: last snapshot of each month
    const monthSnap = {};
    filtered.forEach((s) => {
      const mk = s.date.slice(0, 7);
      monthSnap[mk] = s;
    });
    // Override snapshotMap for monthly access
    histKeys.forEach((mk) => {
      if (monthSnap[mk]) snapshotMap[mk] = monthSnap[mk];
    });
  }

  const snapVal = (key, field) => {
    const s = snapshotMap[key];
    return s ? s[field] || 0 : null;
  };

  const chartOpts = (yLabel, cb, extraOpts) => ({
    responsive: true,
    plugins: {
      legend: { display: true, labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: cb || undefined } },
      ...((extraOpts && extraOpts.plugins) || {})
    },
    scales: {
      y: {
        ticks: { color: '#94a3b8', callback: (v) => v + yLabel },
        grid: { color: '#e2e8f0' },
        beginAtZero: true,
        ...(extraOpts && extraOpts.yMax ? { max: extraOpts.yMax } : {})
      },
      x: {
        ticks: { color: '#94a3b8', maxRotation: 45, font: { size: 9 } },
        grid: { display: false },
        ...(extraOpts && extraOpts.xStacked ? { stacked: true } : {})
      }
    }
  });
  const lineDs = (label, data, color, fill) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: fill || color + '33',
    tension: 0.35,
    pointRadius: 2,
    pointBackgroundColor: color,
    fill: !!fill,
    spanGaps: true
  });

  // 1. Harvest chart
  const c1 = document.getElementById('ov-history-harvest-chart');
  if (c1) {
    if (ovHistHarvestInst) {
      ovHistHarvestInst.destroy();
      ovHistHarvestInst = null;
    }
    ovHistHarvestInst = new Chart(c1, {
      type: 'line',
      data: {
        labels: histLabels,
        datasets: [
          lineDs(
            t('dash.ov.harvestThisWeek'),
            histKeys.map((k) => {
              const v = snapVal(k, 'harvest_kg');
              return v !== null ? +v.toFixed(2) : null;
            }),
            '#c2703e',
            'rgba(194,112,62,0.10)'
          )
        ]
      },
      options: chartOpts('kg', (c) => c.parsed.y.toFixed(2) + 'kg')
    });
  }

  // 2. Pipeline chart — stacked area showing bag counts through stages
  const c3 = document.getElementById('ov-history-pipeline-chart');
  if (c3) {
    if (ovHistPipelineInst) {
      ovHistPipelineInst.destroy();
      ovHistPipelineInst = null;
    }
    const pipeStages = ['bags_spawn', 'bags_incubation', 'bags_fruiting', 'bags_contaminated'];
    const pipeFills = [
      'rgba(124,82,149,0.45)',
      'rgba(74,127,165,0.45)',
      'rgba(61,122,74,0.45)',
      'rgba(176,80,64,0.25)'
    ];
    const pipeBorders = ['#7c5295', '#4a7fa5', '#3d7a4a', '#b05040'];
    const pipeNames = [t('dash.ov.spawn'), t('dash.ov.incubation'), t('dash.ov.fruiting'), t('dash.ov.contaminated')];
    // Compute absolute bag counts + total line
    const pipeAbsData = pipeStages.map((stage) =>
      histKeys.map((k) => {
        const s = snapshotMap[k];
        return s ? s[stage] || 0 : null;
      })
    );
    const totalData = histKeys.map((k) => {
      const s = snapshotMap[k];
      if (!s) return null;
      return (s.bags_spawn || 0) + (s.bags_incubation || 0) + (s.bags_fruiting || 0) + (s.bags_contaminated || 0);
    });
    ovHistPipelineInst = new Chart(c3, {
      type: 'line',
      data: {
        labels: histLabels,
        datasets: [
          ...pipeStages.map((_, i) => ({
            label: pipeNames[i],
            data: pipeAbsData[i],
            borderColor: pipeBorders[i],
            backgroundColor: pipeFills[i],
            borderWidth: 1.5,
            fill: 'origin',
            tension: 0.35,
            pointRadius: 0,
            spanGaps: true,
            order: pipeStages.length - i
          })),
          {
            label: 'Total',
            data: totalData,
            borderColor: '#555',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 3],
            tension: 0.35,
            pointRadius: 2,
            pointBackgroundColor: '#555',
            fill: false,
            spanGaps: true,
            order: 0
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true, labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            mode: 'index',
            callbacks: {
              label: (c) => c.dataset.label + ': ' + c.parsed.y + ' ' + t('dash.ov.bags'),
              footer: (items) => {
                const total = items.find((i) => i.dataset.label === 'Total');
                return total ? '─── Total: ' + total.parsed.y + ' bags' : '';
              }
            }
          }
        },
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { stacked: false, ticks: { color: '#94a3b8' }, grid: { color: '#e2e8f0' }, beginAtZero: true },
          x: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { display: false } }
        }
      }
    });
  }

  // 4. Contamination rate chart
  const c4 = document.getElementById('ov-history-contam-chart');
  if (c4) {
    if (ovHistContamInst) {
      ovHistContamInst.destroy();
      ovHistContamInst = null;
    }
    ovHistContamInst = new Chart(c4, {
      type: 'line',
      data: {
        labels: histLabels,
        datasets: [
          lineDs(
            t('dash.ov.contamRate'),
            histKeys.map((k) => {
              const v = snapVal(k, 'contam_rate_pct');
              return v !== null ? +v.toFixed(1) : null;
            }),
            '#b05040',
            'rgba(176,80,64,0.08)'
          )
        ]
      },
      options: chartOpts('%', (c) => c.parsed.y.toFixed(1) + '%')
    });
  }

  // 5. Stock levels chart
  const c5 = document.getElementById('ov-history-stock-chart');
  if (c5) {
    if (ovHistStockInst) {
      ovHistStockInst.destroy();
      ovHistStockInst = null;
    }
    ovHistStockInst = new Chart(c5, {
      type: 'line',
      data: {
        labels: histLabels,
        datasets: [
          lineDs(
            t('dash.ov.hardwoodUsed').replace(/ .*/, ''),
            histKeys.map((k) => {
              const v = snapVal(k, 'stock_hardwood_kg');
              return v !== null ? +v.toFixed(1) : null;
            }),
            '#8b5e3c'
          ),
          lineDs(
            t('dash.ov.wheatbranUsed').replace(/ .*/, ''),
            histKeys.map((k) => {
              const v = snapVal(k, 'stock_wheatbran_kg');
              return v !== null ? +v.toFixed(1) : null;
            }),
            '#c9a227'
          ),
          lineDs(
            t('dash.ov.grain'),
            histKeys.map((k) => {
              const v = snapVal(k, 'stock_grain_kg');
              return v !== null ? +v.toFixed(1) : null;
            }),
            '#6b7c3f'
          )
        ]
      },
      options: chartOpts('kg', (c) => c.parsed.y.toFixed(1) + 'kg')
    });
  }
}

async function takeKpiSnapshot() {
  try {
    const r = await fetch('/api/kpi-snapshots/now', { method: 'POST' });
    if (r.status === 401 || r.status === 403) {
      alert(t('dash.ov.snapshotAuthErr') || 'Admin login required');
      return;
    }
    if (!r.ok) throw new Error('Failed');
    await loadKpiHistory();
  } catch (e) {
    console.error('Snapshot failed', e);
    alert(t('dash.ov.snapshotErr') || 'Snapshot failed');
  }
}

function _kpiGroupKey(dateStr, period) {
  const d = new Date(dateStr + 'T00:00:00');
  if (period === 'monthly') return dateStr.slice(0, 7);
  if (period === 'weekly') {
    // Thursday of this week determines the ISO week-year. Reuse the correct
    // isoWeekNumber() helper — the previous ad-hoc formula used a Sunday-based
    // getDay() and was off by one week for every date in 2024 and 2025.
    const thu = new Date(d);
    thu.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
    return thu.getFullYear() + '-W' + String(isoWeekNumber(thu)).padStart(2, '0');
  }
  return dateStr;
}

function _kpiAggregate(rows, period) {
  if (period === 'daily') return rows;
  const sumF = ['bags_created', 'grain_used_kg', 'harvest_kg', 'hardwood_used_kg', 'wheatbran_used_kg'];
  const lastF = [
    'avg_yield_g',
    'contam_rate_pct',
    'contam_bags',
    'total_bags_placed',
    'days_since_contam',
    'flush_2plus',
    'bags_spawn',
    'bags_incubation',
    'bags_fruiting',
    'bags_contaminated',
    'total_batches',
    'stock_hardwood_kg',
    'stock_wheatbran_kg',
    'stock_grain_kg'
  ];
  const groups = {};
  const order = [];
  rows.forEach((r) => {
    const k = _kpiGroupKey(r.date, period);
    if (!groups[k]) {
      groups[k] = { key: k, rows: [] };
      order.push(k);
    }
    groups[k].rows.push(r);
  });
  return order.map((k) => {
    const g = groups[k];
    const last = g.rows[g.rows.length - 1];
    const agg = { date: g.key + ' (' + g.rows[0].date + ' \u2013 ' + last.date + ')' };
    sumF.forEach((f) => {
      agg[f] = +g.rows.reduce((s, r) => s + (r[f] || 0), 0).toFixed(2);
    });
    lastF.forEach((f) => {
      agg[f] = last[f];
    });
    return agg;
  });
}

async function exportKpiCSV() {
  try {
    const r = await fetch('/api/kpi-snapshots');
    if (!r.ok) throw new Error('Failed');
    const j = await r.json();
    const raw = j.items || [];
    if (!raw.length) {
      alert(t('dash.ov.historyNoData'));
      return;
    }
    const period = (document.getElementById('kpi-csv-period') || {}).value || 'weekly';
    const rows = _kpiAggregate(raw, period);
    const hdr = [
      'Period',
      'Bags created',
      'Grain used (kg)',
      'Harvest (kg)',
      'Hardwood used (kg)',
      'Wheat bran used (kg)',
      'Avg yield (g)',
      'Contam rate (%)',
      'Contam bags',
      'Total bags placed',
      'Days since contam',
      'Flush 2+',
      'Bags spawn',
      'Bags incubation',
      'Bags fruiting',
      'Bags contaminated',
      'Total batches',
      'Stock hardwood (kg)',
      'Stock wheat bran (kg)',
      'Stock grain (kg)'
    ];
    const csvRows = rows.map((s) => [
      s.date,
      s.bags_created,
      s.grain_used_kg,
      s.harvest_kg,
      s.hardwood_used_kg,
      s.wheatbran_used_kg,
      s.avg_yield_g,
      s.contam_rate_pct,
      s.contam_bags,
      s.total_bags_placed,
      s.days_since_contam,
      s.flush_2plus,
      s.bags_spawn,
      s.bags_incubation,
      s.bags_fruiting,
      s.bags_contaminated,
      s.total_batches,
      s.stock_hardwood_kg,
      s.stock_wheatbran_kg,
      s.stock_grain_kg
    ]);
    const csv =
      '\uFEFF' +
      [hdr, ...csvRows]
        .map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';'))
        .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kpi_' + period + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  } catch (e) {
    console.error('KPI CSV export failed', e);
  }
}

function exportOverviewCSV() {
  const nowDate = new Date();
  const now = Date.now();
  let periodStart, periodLabel;
  if (ovPeriod === 'week') {
    periodStart = new Date(nowDate);
    periodStart.setDate(periodStart.getDate() - ((periodStart.getDay() + 6) % 7));
    periodStart.setHours(0, 0, 0, 0);
    periodLabel = 'KW ' + isoWeekNumber(nowDate);
  } else if (ovPeriod === 'month') {
    periodStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
    periodLabel = String(nowDate.getMonth() + 1).padStart(2, '0') + '.' + nowDate.getFullYear();
  } else {
    periodStart = new Date(nowDate.getFullYear(), 0, 1);
    periodLabel = String(nowDate.getFullYear());
  }

  // Bags created
  const bagsCreated = batches.filter((b) => new Date(b.created) >= periodStart).reduce((s, b) => s + (b.qty || 0), 0);

  // Materials
  let grainUsed = 0,
    hardwoodUsed = 0,
    wheatbranUsed = 0;
  (inventory.log || []).forEach((e) => {
    if (e.type !== 'batch' || new Date(e.time) < periodStart) return;
    if (e.mat === 'grain') grainUsed += Math.abs(e.deltaKg || 0);
    else if (e.mat === 'hardwood') hardwoodUsed += Math.abs(e.deltaKg || 0);
    else if (e.mat === 'wheatbran') wheatbranUsed += Math.abs(e.deltaKg || 0);
  });

  // Harvests
  const periodHarvests = harvests.filter((h) => new Date(h.time) >= periodStart);
  const harvestKg = periodHarvests.reduce((s, h) => s + (h.grams || 0), 0) / 1000;

  // Harvest by species
  const bySpecies = {};
  periodHarvests.forEach((h) => {
    bySpecies[h.species] = (bySpecies[h.species] || 0) + (h.grams || 0);
  });

  // Harvest by day
  const byDay = {};
  periodHarvests.forEach((h) => {
    const key = localDateStr(new Date(h.time));
    byDay[key] = (byDay[key] || 0) + (h.grams || 0);
  });

  // Build CSV rows
  const rows = [];
  rows.push(['Overview Export — ' + periodLabel]);
  rows.push([]);
  rows.push(['KPI', 'Value']);
  rows.push(['Bags created', bagsCreated]);
  rows.push(['Grain used (kg)', +grainUsed.toFixed(2)]);
  rows.push(['Harvest (kg)', +harvestKg.toFixed(2)]);
  rows.push(['Hardwood used (kg)', +hardwoodUsed.toFixed(2)]);
  rows.push(['Wheat bran used (kg)', +wheatbranUsed.toFixed(2)]);
  rows.push(['Harvests logged', periodHarvests.length]);
  rows.push([]);

  // Harvest by species
  rows.push(['Harvest by species', 'kg']);
  Object.keys(bySpecies)
    .sort()
    .forEach((sp) => {
      rows.push([sp, +(bySpecies[sp] / 1000).toFixed(2)]);
    });
  rows.push([]);

  // Harvest by day
  const dayKeys = Object.keys(byDay).sort();
  if (dayKeys.length) {
    rows.push(['Date', 'Harvest (kg)']);
    dayKeys.forEach((k) => {
      rows.push([fmtDtShort(k) + '.' + new Date(k).getFullYear(), +(byDay[k] / 1000).toFixed(2)]);
    });
  }

  // KPI History snapshots for this period
  if (kpiHistoryData && kpiHistoryData.length) {
    const periodKey = localDateStr(periodStart);
    const snaps = kpiHistoryData.filter((s) => s.date >= periodKey);
    if (snaps.length) {
      rows.push([]);
      rows.push(['KPI History (daily snapshots)']);
      rows.push([
        'Date',
        'Bags created',
        'Harvest (kg)',
        'Grain (kg)',
        'Hardwood (kg)',
        'Wheat bran (kg)',
        'Contam rate (%)',
        'Spawn',
        'Incubation',
        'Fruiting',
        'Contaminated',
        'Stock HW (kg)',
        'Stock WB (kg)',
        'Stock Grain (kg)'
      ]);
      snaps.forEach((s) => {
        rows.push([
          fmtDtShort(s.date) + '.' + s.date.slice(0, 4),
          s.bags_created || 0,
          +(s.harvest_kg || 0).toFixed(2),
          +(s.grain_used_kg || 0).toFixed(2),
          +(s.hardwood_used_kg || 0).toFixed(2),
          +(s.wheatbran_used_kg || 0).toFixed(2),
          +(s.contam_rate_pct || 0).toFixed(1),
          s.bags_spawn || 0,
          s.bags_incubation || 0,
          s.bags_fruiting || 0,
          s.bags_contaminated || 0,
          +(s.stock_hardwood_kg || 0).toFixed(1),
          +(s.stock_wheatbran_kg || 0).toFixed(1),
          +(s.stock_grain_kg || 0).toFixed(1)
        ]);
      });
    }
  }

  const csv =
    '\uFEFF' +
    rows.map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'overview_' + ovPeriod + '_' + nowDate.toISOString().slice(0, 10) + '.csv';
  a.click();
}

const CHEVRON_SVG =
  '<svg class="location-section-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
let ZONE_LABELS = {};
let ZONE_COLORS = {};
function rackLabel(id) {
  const m = id.match(/\d+$/);
  return m ? t('dash.rackN', { n: m[0] }) : id.replace(/_/g, ' ');
}

function renderStatus() {
  const q = (document.getElementById('status-q')?.value || '').toLowerCase();
  const el = document.getElementById('dash-locations');
  if (!el) return;
  if (!zones.length) {
    el.innerHTML = '<div class="empty">' + t('dash.noZones') + '</div>';
    renderPipelineKPIs(0, 0, 0, 0, 0, 0);
    renderOverviewKPIs();
    if (dashMode === 'overview') renderOverviewKPIs();
    applyDashMode();
    return;
  }
  if (!batches.length) {
    el.innerHTML = '<div class="empty">' + t('dash.noBatches') + '</div>';
    renderPipelineKPIs(0, 0, 0, 0, 0, 0);
    renderOverviewKPIs();
    if (dashMode === 'overview') renderOverviewKPIs();
    applyDashMode();
    return;
  }

  // Compute per-batch status
  let tspawn = 0,
    ti = 0,
    tt = 0,
    tc = 0;
  const batchData = batches.map((b) => {
    const { c, total, status } = getStatus(b.batchId);
    zones.forEach((z) => {
      if (z.role === 'spawn') tspawn += c[z.id] || 0;
      if (z.role === 'incubation') ti += c[z.id] || 0;
      if (z.role === 'fruiting') tt += c[z.id] || 0;
      if (z.role === 'contaminated') tc += c[z.id] || 0;
    });
    const harv = getHarvested(b.batchId);
    const due = new Date(b.due);
    const ov =
      isBatchOverdue(b) && zones.some((z) => (z.role === 'incubation' || z.role === 'spawn') && (c[z.id] || 0) > 0);
    return { b, c, total, status, harv, due, ov };
  });

  // Filter by search
  const filtered = batchData.filter(
    (d) =>
      !q ||
      d.b.batchId.toLowerCase().includes(q) ||
      (d.b.species || '').toLowerCase().includes(q) ||
      (d.b.strain || '').toLowerCase().includes(q) ||
      (d.b.strainName || '').toLowerCase().includes(q)
  );

  // One sort control above all the rooms, not one per room — the question
  // "what am I looking at first" has the same answer in every tent.
  let html = locSortControlHtml();
  // Render zones dynamically by role
  const fruitingZones = zones.filter((z) => z.role === 'fruiting');
  const contamZones = zones.filter((z) => z.role === 'contaminated');
  zones
    .filter((z) => z.role !== 'fruiting' && z.role !== 'contaminated')
    .forEach((z) => {
      if (z.racks.length > 0)
        html += renderRackSection(
          z.id,
          z.racks.map((r) => r.id),
          filtered
        );
      else html += renderSimpleZoneSection(z, filtered);
    });
  if (fruitingZones.length) html += renderFruitingSection(fruitingZones, filtered);
  contamZones.forEach((z) => {
    const contamBags = getZoneBags(z.id);
    if (Object.keys(contamBags).length > 0) html += renderContamSection(z, filtered);
  });

  el.innerHTML = html;
  const tdone = batchData.filter((d) => d.status === 'DONE').length;
  renderPipelineKPIs(batches.length, tspawn, ti, tt, tdone, tc);
  renderOverviewKPIs();
  applyDashMode();
  updateActionBar();
}

function renderRackSection(zone, racks, filtered) {
  const color = ZONE_COLORS[zone];
  const zoneObj = zones.find((z) => z.id === zone);
  const cap = zoneObj ? zoneObj.maxCapacity : null;
  let totalBags = 0;
  racks.forEach((r) => (totalBags += Object.keys(getRackBags(r)).length));
  const q = (document.getElementById('status-q')?.value || '').toLowerCase();

  const rackCards = racks
    .map((rackId) => {
      const bags = getRackBags(rackId);
      const count = Object.keys(bags).length;
      const byBatch = {};
      Object.entries(bags).forEach(([bagId, d]) => {
        if (!byBatch[d.batchId]) byBatch[d.batchId] = { sp: d.species, st: d.strain, bags: [] };
        byBatch[d.batchId].bags.push({ id: bagId, loc: rackId });
      });
      // Filter batches by search
      const batchEntries = sortZoneBatches(Object.entries(byBatch)).filter(
        ([bid, d]) =>
          !q || bid.toLowerCase().includes(q) || d.sp.toLowerCase().includes(q) || d.st.toLowerCase().includes(q)
      );

      let batchHtml = batchEntries
        .map(([bid, d]) => {
          const bd = filtered.find((f) => f.b.batchId === bid);
          const ov = bd ? bd.ov : false;
          d.bags.sort((a, b) => (parseInt(a.id.split('-').pop()) || 0) - (parseInt(b.id.split('-').pop()) || 0));
          return `<div class="batch-card${ov ? ' batch-overdue' : ''}" style="--sp-color:${spColor(d.sp)}" onclick="this.classList.toggle('expanded')">
        <div class="batch-card-header">
          <span class="batch-card-species">${esc(d.sp)}</span>
          <span class="batch-card-count">${d.bags.length}</span>
        </div>
        <div class="batch-card-meta">
          <span style="font-family:monospace;font-size:10px">${esc(bid)}</span>
          <span>${esc(d.st)}</span>
          ${bd && bd.ov ? `<span class="overdue-text">${t('dash.overdue')}</span>` : ''}
        </div>
        <div class="batch-card-chips">${d.bags
          .map((bg) => {
            const sel = selectedLocBags.has(bg.id);
            return `<span class="bag-chip${sel ? ' selected' : ''}" data-bag="${esc(bg.id)}" data-batch="${esc(bid)}" data-loc="${esc(bg.loc)}">${bg.id.split('-').pop()}</span>`;
          })
          .join('')}</div>
      </div>`;
        })
        .join('');
      if (!batchEntries.length && !count)
        batchHtml = `<div style="font-size:11px;color:var(--c-text-muted);font-style:italic">${t('dash.empty')}</div>`;

      return `<div class="rack-card-new">
      <div class="rack-card-header">
        <span class="rack-card-name">${rackLabel(rackId)}</span>
        <span class="rack-card-count">${tp('dash.bags', count)}</span>
      </div>
      <div class="rack-card-bar"><div class="rack-card-bar-fill" style="background:${color};width:${Math.min(100, Math.round((count / 20) * 100))}%"></div></div>
      <div class="rack-card-batches">${batchHtml}</div>
    </div>`;
    })
    .join('');

  const rackCount = racks.length;
  const gridClass = rackCount > 4 ? 'rack-grid rack-grid-5col' : 'rack-grid';
  const capHtml = cap
    ? `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
      <div style="flex:1;height:6px;background:var(--c-bg);border-radius:3px;overflow:hidden"><div style="height:100%;background:${totalBags > cap ? '#ef4444' : color};width:${Math.min(100, Math.round((totalBags / cap) * 100))}%;border-radius:3px"></div></div>
      <span style="font-size:11px;color:${totalBags > cap ? '#ef4444' : 'var(--c-text-muted)'};white-space:nowrap">${Math.round((totalBags / cap) * 100)}%</span>
    </div>`
    : '';
  const zoneHasUrgent = filtered.some(
    (d) => d.ov && Object.keys(d.c).some((zid) => zid === zone || racks.includes(zid))
  );
  const sectionClass = 'location-section' + (dashMode === 'farm' && zoneHasUrgent ? '' : ' collapsed');
  return `<div class="${sectionClass}" data-zone="${esc(zone)}">
    <div class="location-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
      <div class="location-section-title">${CHEVRON_SVG}<span class="zone-dot" style="background:${color}"></span>${esc(zoneDisplayName(zone))}</div>
      <span class="location-section-count">${cap ? totalBags + ' / ' + cap + ' Bags' : tp('dash.bags', totalBags)}</span>
      <button type="button" data-zone-check="${esc(zone)}" style="margin-left:8px;flex:none;font-size:11px;font-weight:600;padding:5px 10px;border-radius:8px;border:1px solid var(--c-border);background:var(--c-card);cursor:pointer">${esc(t('zoneCheck.btn'))}</button>
    </div>
    <div class="location-section-body">${capHtml}
      <div class="${gridClass}">${rackCards}</div>
    </div>
  </div>`;
}

function renderFruitingSection(fruitingZones, filtered) {
  let totalBags = 0;
  fruitingZones.forEach((z) => (totalBags += Object.keys(getZoneBags(z.id)).length));
  const q = (document.getElementById('status-q')?.value || '').toLowerCase();
  const color = fruitingZones[0]?.color || '#22c55e';

  const tentCols = fruitingZones
    .map((z) => {
      const bags = getZoneBags(z.id);
      const entries = Object.entries(bags);
      const byBatch = {};
      entries.forEach(([bagId, d]) => {
        if (!byBatch[d.batchId]) byBatch[d.batchId] = { sp: d.species, st: d.strain, bags: [] };
        byBatch[d.batchId].bags.push({ id: bagId, loc: d.loc });
      });
      const batchEntries = sortZoneBatches(Object.entries(byBatch)).filter(
        ([bid, d]) =>
          !q || bid.toLowerCase().includes(q) || d.sp.toLowerCase().includes(q) || d.st.toLowerCase().includes(q)
      );

      if (!batchEntries.length) {
        return `<div class="tent-column">
        <div class="tent-column-header">${esc(zoneDisplayName(z.id))}</div>
        <div class="tent-column-empty">${t('dash.empty')}</div>
      </div>`;
      }
      const cards = batchEntries
        .map(([bid, d]) => {
          const bd = filtered.find((f) => f.b.batchId === bid);
          const harv = bd ? bd.harv : 0;
          const due = bd ? bd.due : null;
          const ov = bd ? bd.ov : false;
          d.bags.sort((a, b) => (parseInt(a.id.split('-').pop()) || 0) - (parseInt(b.id.split('-').pop()) || 0));
          return `<div class="batch-card${ov ? ' batch-overdue' : ''}" style="--sp-color:${spColor(d.sp)}" onclick="this.classList.toggle('expanded')">
        <div class="batch-card-header">
          <span class="batch-card-species">${esc(d.sp)}</span>
          <span class="batch-card-count">${d.bags.length}</span>
        </div>
        <div class="batch-card-meta">
          <span style="font-family:monospace;font-size:10px">${esc(bid)}</span>
          <span>${esc(d.st)}</span>
          ${harv > 0 ? `<span style="color:var(--c-amber-dark);font-weight:500">${t('dash.harvested')}: ${harv}g</span>` : ''}
          ${due ? `<span style="color:${ov ? 'var(--c-red-dark)' : 'var(--c-text-muted)'}">${t('dash.due')}: ${fmtDt(due)}${ov ? ' \u26a0' : ''}</span>` : ''}
        </div>
        <div class="batch-card-chips">${d.bags
          .map((bg) => {
            const sel = selectedLocBags.has(bg.id);
            return `<span class="bag-chip${sel ? ' selected' : ''}" data-bag="${esc(bg.id)}" data-batch="${esc(bid)}" data-loc="${esc(bg.loc)}">${bg.id.split('-').pop()}</span>`;
          })
          .join('')}</div>
      </div>`;
        })
        .join('');
      const cap = z.maxCapacity;
      const capBar = cap
        ? `<div style="display:flex;align-items:center;gap:6px;margin:4px 0">
        <div style="flex:1;height:5px;background:var(--c-bg);border-radius:3px;overflow:hidden"><div style="height:100%;background:${entries.length > cap ? '#ef4444' : z.color || color};width:${Math.min(100, Math.round((entries.length / cap) * 100))}%;border-radius:3px"></div></div>
        <span style="font-size:10px;color:${entries.length > cap ? '#ef4444' : 'var(--c-text-muted)'}">${Math.round((entries.length / cap) * 100)}%</span>
      </div>`
        : '';
      return `<div class="tent-column">
      <div class="tent-column-header">${esc(zoneDisplayName(z.id))} <span style="font-size:11px;font-weight:400;color:var(--c-text-muted)">(${cap ? entries.length + '/' + cap : entries.length})</span></div>${capBar}
      ${cards}
    </div>`;
    })
    .join('');

  const fruitSectionClass = 'location-section' + (dashMode === 'farm' && totalBags > 0 ? '' : ' collapsed');
  return `<div class="${fruitSectionClass}" data-zone="fruiting">
    <div class="location-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
      <div class="location-section-title">${CHEVRON_SVG}<span class="zone-dot" style="background:${color}"></span>${t('dash.fruitingTents')}</div>
      <span class="location-section-count">${tp('dash.bags', totalBags)}</span>
    </div>
    <div class="location-section-body">
      <div class="tent-columns">${tentCols}</div>
    </div>
  </div>`;
}

// The room lists came out in scan-log insertion order — effectively the order
// bags happened to be added, which is no order at all once a tent holds twenty
// batches. One sort, shared by the simple, rack and fruiting renderers so a
// room never sorts differently from the room next to it.
const LOC_SORTS = ['due', 'species', 'bags', 'id'];
const LOC_SORT_LABEL = { due: 'th.due', species: 'th.species', bags: 'worklist.bags', id: 'th.batchId' };
let _locSortKey = null;
function locSortKey() {
  if (_locSortKey === null) {
    // Guarded like the other stored preferences: storage revoked mid-session
    // must not throw inside a render.
    try {
      _locSortKey = localStorage.getItem('mp-loc-sort') || '';
    } catch (e) {
      _locSortKey = '';
    }
  }
  // Due date is the default because it is the one that says what to do next.
  return LOC_SORTS.includes(_locSortKey) ? _locSortKey : 'due';
}
function setLocSort(key) {
  if (!LOC_SORTS.includes(key)) return;
  _locSortKey = key;
  try {
    localStorage.setItem('mp-loc-sort', key);
  } catch (e) {
    /* storage disabled — the choice just won't survive a reload */
  }
  renderStatus();
}
function locSortControlHtml() {
  const cur = locSortKey();
  return (
    '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:8px">' +
    '<span style="font-size:11px;color:var(--c-text-muted);flex-shrink:0">' +
    esc(t('sort.by')) +
    '</span>' +
    LOC_SORTS.map((k) => {
      const on = k === cur;
      return (
        '<button type="button" data-action="loc-sort" data-key="' +
        esc(k) +
        '" aria-pressed="' +
        on +
        '" style="font-size:10.5px;padding:3px 8px;border-radius:11px;cursor:pointer;font-family:inherit;border:1px solid ' +
        (on ? 'var(--c-accent)' : 'var(--c-border)') +
        ';background:' +
        (on ? 'var(--c-accent)' : 'transparent') +
        ';color:' +
        (on ? '#fff' : 'var(--c-text-sec)') +
        '">' +
        esc(t(LOC_SORT_LABEL[k])) +
        '</button>'
      );
    }).join('') +
    '</div>'
  );
}
// batchEntries is [batchId, {sp, st, bags}] in all three renderers, so they can
// share this. Ties break on the batch id, which keeps the order stable rather
// than reshuffling equal rows on every re-render.
function sortZoneBatches(batchEntries) {
  const key = locSortKey();
  const dueOf = (bid) => {
    const b = batchById(bid);
    return b ? b.due : null;
  };
  return [...batchEntries].sort((x, y) => {
    if (key === 'species') return sortCmp(x[1].sp, y[1].sp) || sortCmp(x[0], y[0]);
    // Most bags first: "where is the bulk of the work" is the question here.
    if (key === 'bags') return y[1].bags.length - x[1].bags.length || sortCmp(x[0], y[0]);
    if (key === 'id') return sortCmp(x[0], y[0]);
    // sortCmp already sinks null to the end, so an undated batch lands last
    // rather than pretending to be the most urgent thing in the room.
    return sortCmp(dueOf(x[0]), dueOf(y[0])) || sortCmp(x[0], y[0]);
  });
}
function renderSimpleZoneSection(zone, filtered) {
  const bags = getZoneBags(zone.id);
  const entries = Object.entries(bags);
  const q = (document.getElementById('status-q')?.value || '').toLowerCase();
  const byBatch = {};
  entries.forEach(([bagId, d]) => {
    if (!byBatch[d.batchId]) byBatch[d.batchId] = { sp: d.species, st: d.strain, bags: [] };
    byBatch[d.batchId].bags.push({ id: bagId, loc: d.loc });
  });
  const batchEntries = sortZoneBatches(Object.entries(byBatch)).filter(
    ([bid, d]) =>
      !q || bid.toLowerCase().includes(q) || d.sp.toLowerCase().includes(q) || d.st.toLowerCase().includes(q)
  );
  const cards = batchEntries
    .map(([bid, d]) => {
      d.bags.sort((a, b) => (parseInt(a.id.split('-').pop()) || 0) - (parseInt(b.id.split('-').pop()) || 0));
      return `<div class="batch-card" style="--sp-color:${spColor(d.sp)}" onclick="this.classList.toggle('expanded')">
      <div class="batch-card-header"><span class="batch-card-species">${esc(d.sp)}</span><span class="batch-card-count">${d.bags.length}</span></div>
      <div class="batch-card-meta"><span style="font-family:monospace;font-size:10px">${esc(bid)}</span><span>${esc(d.st)}</span></div>
      <div class="batch-card-chips">${d.bags
        .map((bg) => {
          const sel = selectedLocBags.has(bg.id);
          return `<span class="bag-chip${sel ? ' selected' : ''}" data-bag="${esc(bg.id)}" data-batch="${esc(bid)}" data-loc="${esc(bg.loc)}">${bg.id.split('-').pop()}</span>`;
        })
        .join('')}</div>
    </div>`;
    })
    .join('');
  if (!cards) return '';
  const cap = zone.maxCapacity;
  const capHtml = cap
    ? `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
      <div style="flex:1;height:6px;background:var(--c-bg);border-radius:3px;overflow:hidden"><div style="height:100%;background:${entries.length > cap ? '#ef4444' : zone.color};width:${Math.min(100, Math.round((entries.length / cap) * 100))}%;border-radius:3px"></div></div>
      <span style="font-size:11px;color:${entries.length > cap ? '#ef4444' : 'var(--c-text-muted)'};white-space:nowrap">${Math.round((entries.length / cap) * 100)}%</span>
    </div>`
    : '';
  return `<div class="location-section">
    <div class="location-section-header">
      <div class="location-section-title"><span class="zone-dot" style="background:${zone.color}"></span>${esc(zoneDisplayName(zone.id))}</div>
      <span class="location-section-count">${cap ? entries.length + ' / ' + cap + ' Bags' : tp('dash.bags', entries.length)}</span>
    </div>${capHtml}
    <div style="display:flex;flex-direction:column;gap:6px">${cards}</div>
  </div>`;
}

function renderContamSection(zone, filtered) {
  const bags = getZoneBags(zone.id);
  const entries = Object.entries(bags);
  const q = (document.getElementById('status-q')?.value || '').toLowerCase();
  const byBatch = {};
  entries.forEach(([bagId, d]) => {
    if (!byBatch[d.batchId]) byBatch[d.batchId] = { sp: d.species, st: d.strain, bags: [] };
    byBatch[d.batchId].bags.push({ id: bagId, loc: d.loc });
  });
  const batchEntries = sortZoneBatches(Object.entries(byBatch)).filter(
    ([bid, d]) =>
      !q || bid.toLowerCase().includes(q) || d.sp.toLowerCase().includes(q) || d.st.toLowerCase().includes(q)
  );
  if (!batchEntries.length) return '';

  const cards = batchEntries
    .map(([bid, d]) => {
      d.bags.sort((a, b) => (parseInt(a.id.split('-').pop()) || 0) - (parseInt(b.id.split('-').pop()) || 0));
      return `<div class="batch-card" style="--sp-color:${spColor(d.sp)}" onclick="this.classList.toggle('expanded')">
      <div class="batch-card-header">
        <span class="batch-card-species">${esc(d.sp)}</span>
        <span class="batch-card-count">${d.bags.length}</span>
      </div>
      <div class="batch-card-meta">
        <span style="font-family:monospace;font-size:10px">${esc(bid)}</span>
        <span>${esc(d.st)}</span>
      </div>
      <div class="batch-card-chips">${d.bags
        .map((bg) => {
          const sel = selectedLocBags.has(bg.id);
          return `<span class="bag-chip${sel ? ' selected' : ''}" data-bag="${esc(bg.id)}" data-batch="${esc(bid)}" data-loc="${esc(bg.loc)}">${bg.id.split('-').pop()}</span>`;
        })
        .join('')}</div>
    </div>`;
    })
    .join('');

  return `<div class="location-section contam-section">
    <div class="location-section-header">
      <div class="location-section-title"><span class="zone-dot" style="background:${zone.color}"></span>\u26a0 ${esc(zoneDisplayName(zone.id))}</div>
      <span class="location-section-count">${tp('dash.bags', entries.length)}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">${cards}</div>
  </div>`;
}

function updateActionBar() {
  const bar = document.getElementById('loc-action-bar');
  if (!bar) return;
  const n = selectedLocBags.size;
  if (n > 0) {
    bar.style.display = 'flex';
    bar.innerHTML = `<span class="action-bar-count">${tp('dash.bagsSelected', n)}</span><span style="flex:1"></span>
      <button class="btn btn-sm" onclick="locSelectAllVisible()" style="font-size:11px">${t('dash.selectAll')}</button>
      <button class="btn btn-sm" onclick="selectedLocBags.clear();renderStatus()" style="font-size:11px">${t('dash.clear')}</button>
      <button class="btn btn-sm btn-p" onclick="openLocMovePopup()" style="font-size:11px">${t('dash.move')}</button>
      <button class="btn btn-sm btn-r" onclick="locRemoveSelected()" style="font-size:11px">${t('dash.remove')}</button>`;
  } else {
    bar.style.display = 'none';
  }
}

function locSelectAllVisible() {
  const q = (document.getElementById('status-q')?.value || '').toLowerCase();
  ZONES.forEach((z) => {
    const bags = getZoneBags(z);
    Object.entries(bags).forEach(([bagId, d]) => {
      if (
        !q ||
        bagId.toLowerCase().includes(q) ||
        (d.batchId || '').toLowerCase().includes(q) ||
        (d.species || '').toLowerCase().includes(q) ||
        (d.strain || '').toLowerCase().includes(q)
      )
        selectedLocBags.set(bagId, { batchId: d.batchId, loc: d.loc });
    });
  });
  renderStatus();
}
function setDashMode(mode) {
  dashMode = mode;
  localStorage.setItem('mp-dash-mode', mode);
  applyDashMode();
  renderStatus();
}
function applyDashMode() {
  const farmBtn = document.getElementById('dash-view-farm');
  const ovBtn = document.getElementById('dash-view-overview');
  const charts = document.getElementById('dash-charts-section');
  const farmSection = document.getElementById('dash-farm-section');
  if (farmBtn) farmBtn.classList.toggle('active', dashMode === 'farm');
  if (ovBtn) ovBtn.classList.toggle('active', dashMode === 'overview');
  if (charts) charts.style.display = dashMode === 'overview' ? '' : 'none';
  if (farmSection) farmSection.style.display = dashMode === 'farm' ? '' : 'none';
  const histWrap = document.getElementById('ov-kpi-history');
  if (histWrap) histWrap.style.display = dashMode === 'overview' ? '' : 'none';
  if (dashMode === 'overview' && !kpiHistoryData) loadKpiHistory();
}
function setOvPeriod(p) {
  ovPeriod = p;
  localStorage.setItem('mp-ov-period', p);
  renderOverviewKPIs();
  renderKpiHistory();
}
function applyOvPeriod() {
  ['week', 'month', 'year'].forEach((p) => {
    const btn = document.getElementById('ov-p-' + p);
    if (btn) btn.classList.toggle('active', ovPeriod === p);
  });
}

// ─── WORK LIST (pick / walk sheet) ──────────────────────────
// Tapping a summary chip opens a findable, printable list of the batches that
// need moving / harvesting, grouped by their CURRENT location so a worker can
// walk zone by zone. Print goes to a normal browser printer (e.g. a Canon),
// separate from the Zebra label printer.
let _workListData = null;
let _workListMode = localStorage.getItem('mp-wl-group') === 'batch' ? 'batch' : 'location';
function _batchZoneCounts(batch, lastByBag) {
  const counts = {};
  (batch.bags || []).forEach((bag) => {
    const last = lastByBag.get(bag.toUpperCase());
    if (!last || last.action === 'REMOVE' || !last.to) return;
    const z = toZone(last.to);
    counts[z] = (counts[z] || 0) + 1;
  });
  return counts;
}
// Flattens the move/harvest tasks into (batch, zone, count) rows. The same rows
// then group either by zone or by batch (see _groupWorkList). total is the
// distinct batch count, so the title matches the dashboard summary chip.
function buildWorkList(kind) {
  const lastByBag = buildLastScanByBag();
  const rows = [];
  const pushRows = (batchId, species, strain, note) => {
    const b = batches.find((x) => x.batchId === batchId);
    if (!b) return;
    const counts = _batchZoneCounts(b, lastByBag);
    Object.keys(counts).forEach((z) =>
      rows.push({
        batchId,
        species: species || b.species,
        strain: (strain || '').trim(),
        zone: z,
        zoneName: zoneDisplayName(z),
        count: counts[z],
        note: note || ''
      })
    );
  };
  if (kind === 'move') {
    buildAutoTasks()
      .filter((tk) => tk.taskAction === 'move' && tk.ready)
      .forEach((tk) => {
        const b = batches.find((x) => x.batchId === tk.batchId);
        pushRows(tk.batchId, b && b.species, b && (b.strainText || b.strain), tk.detail);
      });
  } else if (kind === 'harvest') {
    buildHarvestTasks().forEach((tk) => pushRows(tk.batchId, tk.species, tk.strain, tp('harvest.daysFruiting', tk.daysFruiting)));
  }
  return {
    kind,
    title: kind === 'move' ? t('dash.sumMove') : t('dash.sumHarvest'),
    rows,
    total: new Set(rows.map((r) => r.batchId)).size
  };
}
// Groups the flat rows for one of the two views. 'location' → a card per zone
// listing its batches (walk the room zone by zone); 'batch' → a card per batch
// listing where that batch's bags currently sit.
function _groupWorkList(rows, mode) {
  const byKey = new Map();
  rows.forEach((r) => {
    const key = mode === 'batch' ? r.batchId : r.zone;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        batchId: r.batchId,
        name: mode === 'batch' ? r.batchId : r.zoneName,
        sub: mode === 'batch' ? r.species + (r.strain ? ' · ' + r.strain : '') : '',
        bags: 0,
        items: []
      });
    }
    const g = byKey.get(key);
    g.items.push(r);
    g.bags += r.count;
  });
  const list = [...byKey.values()];
  list.sort((a, b) => a.name.localeCompare(b.name));
  list.forEach((g) =>
    g.items.sort((a, b) => (mode === 'batch' ? a.zoneName.localeCompare(b.zoneName) : a.batchId.localeCompare(b.batchId)))
  );
  return list;
}
function openWorkList(kind) {
  _workListData = buildWorkList(kind);
  renderWorkList();
  document.getElementById('m-worklist').classList.add('open');
}
// Renders the open work list for the current _workListMode: title count, the
// Ort/Charge toggle's active state, and the grouped body. Split from
// openWorkList so flipping the toggle can re-render without rebuilding tasks.
function renderWorkList() {
  const data = _workListData;
  if (!data) return;
  const mode = _workListMode;
  const bags = esc(t('worklist.bags'));
  document.getElementById('wl-title').textContent = data.title + ' (' + data.total + ')';
  document.querySelectorAll('#wl-group [data-wl-group]').forEach((b) => {
    const on = b.dataset.wlGroup === mode;
    b.style.background = on ? 'var(--c-primary, #16a34a)' : 'transparent';
    b.style.color = on ? '#fff' : 'var(--c-text-sec)';
    b.style.borderColor = on ? 'var(--c-primary, #16a34a)' : 'var(--c-border)';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const body = document.getElementById('wl-body');
  const groups = _groupWorkList(data.rows, mode);
  if (!groups.length) {
    body.innerHTML =
      '<div style="color:var(--c-text-muted);font-style:italic;padding:14px 0">' + esc(t('worklist.empty')) + '</div>';
    return;
  }
  body.innerHTML = groups
    .map((g) => {
      if (mode === 'batch') {
        const zoneRows = g.items
          .map(
            (it) =>
              `<div style="display:flex;align-items:center;gap:10px;padding:8px 6px 8px 14px;border-bottom:0.5px solid var(--c-border)">` +
              `<span style="flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.zoneName)}</span>` +
              `<span style="font-size:14px;font-weight:600;white-space:nowrap">${it.count} ${bags}</span>` +
              `</div>`
          )
          .join('');
        return (
          `<div data-wl-batch="${esc(g.batchId)}" style="margin-bottom:14px;cursor:pointer">` +
          `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:6px 4px;border-bottom:2px solid var(--c-border)">` +
          `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span style="font-family:monospace;font-size:13px;font-weight:700">${esc(g.batchId)}</span>${g.sub ? `<span style="font-size:12px;color:var(--c-text-sec)"> · ${esc(g.sub)}</span>` : ''}</span>` +
          `<span style="font-size:12px;color:var(--c-text-muted);white-space:nowrap">${g.bags} ${bags}</span></div>` +
          zoneRows +
          `</div>`
        );
      }
      const batchRows = g.items
        .map(
          (it) =>
            `<div data-wl-batch="${esc(it.batchId)}" style="display:flex;align-items:center;gap:10px;padding:10px 6px;border-bottom:0.5px solid var(--c-border);cursor:pointer">` +
            `<span style="font-family:monospace;font-size:13px;font-weight:600">${esc(it.batchId)}</span>` +
            `<span style="flex:1;min-width:0;font-size:12px;color:var(--c-text-sec);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.species)}${it.strain ? ' · ' + esc(it.strain) : ''}</span>` +
            `<span style="font-size:14px;font-weight:600;white-space:nowrap">${it.count} ${bags}</span>` +
            `</div>`
        )
        .join('');
      return (
        '<div style="margin-bottom:14px">' +
        `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 4px;border-bottom:2px solid var(--c-border)"><span style="font-size:13px;font-weight:700">${esc(g.name)}</span><span style="font-size:12px;color:var(--c-text-muted)">${g.bags} ${bags}</span></div>` +
        batchRows +
        '</div>'
      );
    })
    .join('');
}
function setWorkListMode(mode) {
  const m = mode === 'batch' ? 'batch' : 'location';
  if (m === _workListMode) return;
  _workListMode = m;
  localStorage.setItem('mp-wl-group', m);
  renderWorkList();
}
function printWorkList() {
  const d = _workListData;
  if (!d) return;
  const rows = _groupWorkList(d.rows, _workListMode)
    .flatMap((g) => g.items)
    .map(
      (it) =>
        `<tr><td class="c">&#9744;</td><td>${esc(it.zoneName)}</td><td class="m">${esc(it.batchId)}</td><td>${esc(it.species)}${it.strain ? ' · ' + esc(it.strain) : ''}</td><td class="n">${it.count}</td></tr>`
    )
    .join('');
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><title>' +
    esc(d.title) +
    '</title><style>body{font-family:Arial,Helvetica,sans-serif;margin:18px;color:#000}h1{font-size:18px;margin:0 0 2px}.s{color:#555;font-size:12px;margin-bottom:14px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #ccc}th{border-bottom:2px solid #000;font-size:11px;text-transform:uppercase}.c{width:22px;font-size:16px}.m{font-family:monospace}.n{text-align:right;width:56px;font-weight:bold}</style></head><body>' +
    '<h1>' +
    esc(d.title) +
    '</h1><div class="s">' +
    esc(localDateStr(new Date())) +
    ' · ' +
    d.total +
    ' ' +
    esc(t('worklist.batches')) +
    '</div><table><thead><tr><th></th><th>' +
    esc(t('worklist.location')) +
    '</th><th>' +
    esc(t('worklist.batchCol')) +
    '</th><th>' +
    esc(t('batch.species')) +
    '</th><th style="text-align:right">' +
    esc(t('worklist.bags')) +
    '</th></tr></thead><tbody>' +
    rows +
    '</tbody></table><scr' +
    'ipt>window.onload=function(){window.print()}<\/scr' +
    'ipt></body></html>';
  const win = window.open('', '_blank');
  if (!win) {
    alert(t('worklist.popupBlocked'));
    return;
  }
  win.document.write(html);
  win.document.close();
}
// "+ Ernte erfassen" from the speed-dial. Harvests used to have their own card;
// they are rows in the day plan now, so this opens the day they sit on and
// flashes the card holding it rather than pointing at a card that is gone.
function dashGoHarvest() {
  const card = document.getElementById('dash-batch-tasks-card');
  const week = buildWeekPlan();
  const day = week.findIndex((d) => d.items.some((i) => i.kind === 'harvest'));
  if (!card || day < 0) {
    setFb('info', t('dash.harvestNoFruiting'));
    return;
  }
  setDashDay(day);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const prev = card.style.boxShadow;
  card.style.transition = 'box-shadow 0.3s ease';
  card.style.boxShadow = '0 0 0 3px var(--c-amber, #f59e0b)';
  setTimeout(() => {
    card.style.boxShadow = prev || '';
  }, 1500);
}
// Warnungen is for problems you can't see anywhere else on the dashboard: low
// stock, lab issues, zones at capacity. It deliberately does NOT restate
// due-today / overdue batches — those are already the "zu verschieben" chip and
// the Chargen-Aufgaben list directly above, and repeating them as two more lines
// said nothing new while burying the alerts that only appear here.
function renderDashAlerts() {
  const invAlerts = getInvAlerts().map((a) => ({ ...a, goPage: 'inv', goBtn: 'n-inv' }));
  // Zone capacity warnings (≥90%)
  const capAlerts = [];
  zones.forEach((z) => {
    if (!z.maxCapacity) return;
    let cnt = 0;
    if (z.racks && z.racks.length) z.racks.forEach((r) => (cnt += Object.keys(getRackBags(r.id)).length));
    else cnt = Object.keys(getZoneBags(z.id)).length;
    const pct = Math.round((cnt / z.maxCapacity) * 100);
    if (pct >= 90)
      capAlerts.push({
        text: zoneDisplayName(z.id) + ': ' + cnt + '/' + z.maxCapacity + ' bags (' + pct + '% full)',
        urgent: pct >= 100,
        goPage: 'zones',
        goBtn: 'n-zones'
      });
  });
  const labAlerts = getLabAlerts().map((a) => ({ ...a, goPage: 'lab', goBtn: 'n-lab' }));
  const allAlerts = [...invAlerts, ...labAlerts, ...capAlerts];
  const card = document.getElementById('dash-alerts-card');
  const el = document.getElementById('dash-alerts');
  if (!allAlerts.length) {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';
  el.innerHTML = allAlerts
    .map((a) => {
      const btn = a.attentionKey
        ? `<button class="btn btn-sm" data-action="go-attention" data-key="${esc(a.attentionKey)}" style="font-size:11px;padding:2px 8px;white-space:nowrap;flex-shrink:0;background:${a.urgent ? '#dc2626' : '#ea580c'};color:#fff;border-color:transparent">${t('dash.view')}</button>`
        : `<button class="btn btn-sm" data-action="go-page" data-page="${esc(a.goPage)}" data-btn="${esc(a.goBtn)}" style="font-size:11px;padding:2px 8px;white-space:nowrap;flex-shrink:0;background:${a.urgent ? '#dc2626' : '#ea580c'};color:#fff;border-color:transparent">${t('dash.view')}</button>`;
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;border-radius:6px;margin-bottom:4px;background:${a.urgent ? '#fca5a5' : '#fed7aa'};border-left:4px solid ${a.urgent ? '#dc2626' : '#ea580c'};color:${a.urgent ? '#7f1d1d' : '#7c2d12'};font-weight:500"><div style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(a.text)}</div>${btn}</div>`;
    })
    .join('');
}
// Split-batch detection: flag batches whose active bags straddle multiple
// production stages ({spawn, incubation, fruiting}). Harvested, removed, and
// contaminated bags are excluded so deliberate placements don't trigger alerts.
// lastByBag is optional: the dashboard has already built this index by the time
// it calls us, and rebuilding it walked the whole scan log a second time.
function getSplitBatches(sharedLastByBag) {
  const STAGE_ORDER = { spawn: 1, incubation: 2, fruiting: 3 };
  const zoneRole = {};
  zones.forEach((z) => (zoneRole[z.id] = z.role));
  const harvestedBags = new Set();
  harvests.forEach((h) => h && h.bag && harvestedBags.add(String(h.bag).toUpperCase()));
  // Reuse the caller's index when it passes one — the dashboard has already built
  // exactly this map by the time it calls us. Only the per-batch last-move time
  // still needs a pass of its own, and that one allocates nothing per entry.
  const own = sharedLastByBag ? null : new Map();
  const lastMoveTimeByBatch = {};
  scanLog.forEach((e) => {
    if (own && e.bag) own.set(String(e.bag).toUpperCase(), e);
    if (e.batch && (e.action === 'ADD' || e.action === 'MOVE' || e.action === 'MOVE_BATCH')) {
      const cur = lastMoveTimeByBatch[e.batch];
      if (!cur || (e.time && e.time > cur)) lastMoveTimeByBatch[e.batch] = e.time;
    }
  });
  const lastByBag = sharedLastByBag || own;
  const now = Date.now();
  const STALE_HOURS = 24;
  const out = [];
  batches.forEach((b) => {
    const bags = b.bags || [];
    if (!bags.length) return;
    const zoneCounts = {};
    const stageCounts = {};
    bags.forEach((bag) => {
      const key = String(bag).toUpperCase();
      if (harvestedBags.has(key)) return;
      const last = lastByBag.get(key);
      if (!last || last.action === 'REMOVE' || !last.to) return;
      const z = toZone(last.to);
      const role = zoneRole[z];
      if (!role || role === 'contaminated') return;
      // Stage comes from the batch, not the room — see stageOf(). Without it,
      // grain cooling off in the aircon room read as "incubation" and blocks
      // parked in the spawn tent read as "spawn", so batches were reported split
      // across stages when every bag was really at the same one.
      const stage = stageOf(role, b.batchType);
      if (!STAGE_ORDER[stage]) return;
      zoneCounts[z] = (zoneCounts[z] || 0) + 1;
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    });
    const stages = Object.keys(stageCounts);
    if (stages.length < 2) return;
    const behindStage = stages.reduce((a, c) => (STAGE_ORDER[c] < STAGE_ORDER[a] ? c : a));
    const behindCount = stageCounts[behindStage];
    const entries = Object.keys(zoneCounts).map((z) => ({
      zone: z,
      role: stageOf(zoneRole[z], b.batchType),
      count: zoneCounts[z],
      behind: stageOf(zoneRole[z], b.batchType) === behindStage
    }));
    entries.sort((a, c) => (STAGE_ORDER[a.role] || 99) - (STAGE_ORDER[c.role] || 99));
    const lastTime = lastMoveTimeByBatch[b.batchId];
    const ageHours = lastTime ? (now - new Date(lastTime).getTime()) / 3600000 : STALE_HOURS + 1;
    const urgent = ageHours > STALE_HOURS;
    out.push({
      batchId: b.batchId,
      species: b.species || '',
      strain: b.strain || b.species || '',
      behindStage,
      behindCount,
      entries,
      // Per stage, not per zone: two incubation rooms are one stage, and the
      // card is about how far along the bags are, not which room they sit in.
      stages: Object.keys(stageCounts)
        .sort((a, c) => (STAGE_ORDER[a] || 99) - (STAGE_ORDER[c] || 99))
        .map((role) => ({ role, count: stageCounts[role], behind: role === behindStage })),
      urgent
    });
  });
  out.sort((a, c) => {
    if (a.urgent !== c.urgent) return a.urgent ? -1 : 1;
    return (c.behindCount || 0) - (a.behindCount || 0);
  });
  return out;
}
// Preferred one-tap fruiting destination: the most recently used fruiting
// zone/rack (matches how it's actually done — nearly always the same tent),
// else the first zone tagged role 'fruiting'. Null if no fruiting zone exists.
function _fruitingDest() {
  const isFruiting = (id) => {
    const z = ZONE_BY_ID[toZone(id)];
    return z && z.role === 'fruiting';
  };
  for (let i = scanLog.length - 1; i >= 0; i--) {
    const e = scanLog[i];
    if ((e.action === 'MOVE' || e.action === 'MOVE_BATCH') && e.to && isFruiting(e.to)) return e.to;
  }
  const first = zones.find((z) => z.role === 'fruiting');
  return first ? first.id : null;
}
// One-tap whole-batch move to fruiting for the dashboard "needs to move" cards.
// Same move semantics as the Verschieben picker (moveBatchTo skips bags that
// are unplaced/removed or already there) — just with the destination preset.
// ── Undo for bag moves ──────────────────────────────────────
// A "Rückgängig" snackbar reverses a move: we snapshot each bag's location
// before it, then move the exact same bags back on undo (a compensating MOVE,
// so the scan history stays honest). Used by every whole-batch move path —
// one-tap → Fruchtung, the per-zone bulk, the Verschieben picker and the
// scan action sheet — so a mistap costs one tap to reverse wherever it happens.
// Bags that were not placed before the move are absent from the snapshot and
// stay where they were put: there is no prior location to restore them to.
let _undoTimer = null;
function showUndoBar(msg, undoCb) {
  const bar = document.getElementById('undo-bar');
  if (!bar) return;
  document.getElementById('undo-msg').textContent = msg;
  const btn = document.getElementById('undo-btn');
  btn.textContent = t('dash.undo');
  btn.style.display = '';
  btn.onclick = () => {
    clearTimeout(_undoTimer);
    hideUndoBar();
    if (undoCb) undoCb();
  };
  bar.classList.add('show');
  clearTimeout(_undoTimer);
  _undoTimer = setTimeout(hideUndoBar, 8000);
}
function flashUndoBar(msg) {
  const bar = document.getElementById('undo-bar');
  if (!bar) return;
  document.getElementById('undo-msg').textContent = msg;
  document.getElementById('undo-btn').style.display = 'none';
  bar.classList.add('show');
  clearTimeout(_undoTimer);
  _undoTimer = setTimeout(hideUndoBar, 2500);
}
function hideUndoBar() {
  const bar = document.getElementById('undo-bar');
  if (bar) bar.classList.remove('show');
}
function _snapshotBeforeMove(batchList, dest, lastByBag) {
  const snap = [];
  const d = dest.toUpperCase();
  batchList.forEach((b) => {
    (b.bags || []).forEach((bag) => {
      const last = lastByBag.get(bag.toUpperCase());
      if (!last || last.action === 'REMOVE' || !last.to) return;
      if (last.to.toUpperCase() === d) return; // already there → won't move
      snap.push({ batch: b, bag, from: last.to });
    });
  });
  return snap;
}
function _undoMove(snap) {
  if (!snap || !snap.length) return;
  const groups = new Map();
  snap.forEach((s) => {
    const key = s.batch.batchId + '|' + s.from;
    if (!groups.has(key)) groups.set(key, { batch: s.batch, dest: s.from, bags: [] });
    groups.get(key).bags.push(s.bag);
  });
  let back = 0;
  groups.forEach((g) => moveBagsTo(g.batch, g.bags, g.dest, (m) => (back += m || 0)));
  updateSD();
  renderBatches();
  renderStatus();
  renderDashBatchTasks();
  flashUndoBar(t('dash.undone', { n: back }));
}
function moveBatchToFruiting(batchId) {
  const b = batches.find((x) => x.batchId === batchId);
  if (!b) return;
  const dest = fruitingTarget();
  if (!dest) {
    setFb('err', t('dash.noFruitingZone'));
    return;
  }
  const snap = _snapshotBeforeMove([b], dest, buildLastScanByBag());
  moveBatchTo(b, dest, function (moved, skipped) {
    updateSD();
    renderBatches();
    renderStatus();
    renderDashBatchTasks();
    if (!moved) {
      setFb(
        'ok',
        skipped ? t('batch.allAlreadyAt', { n: skipped, loc: zoneDisplayName(dest) }) : t('batch.noBagsToMove')
      );
    } else {
      showUndoBar(b.batchId + ': ' + moved + ' → ' + zoneDisplayName(dest), () => _undoMove(snap));
    }
  });
}
// One-tap action button(s) for a single batch-tasks row.
function dashTaskBtn(tk) {
  const id = esc(tk.batchId);
  if (tk.taskAction === 'inoculate') {
    // Colonised grain: the useful next step is making blocks from it, so go
    // straight to the create dialog rather than offering a move.
    return `<button class="btn btn-sm btn-p" data-action="inoculate-from" data-batch="${id}" style="font-size:11px;padding:3px 10px;flex-shrink:0">${esc(t('dash.doInoculate'))}</button>`;
  }
  if (tk.taskAction === 'move' && tk.ready) {
    // One-tap \u2192 Fruchtung (the dominant move) as the primary action; the
    // Verschieben picker stays for any other destination. Only offer it for
    // batches actually in incubation \u2014 never for SPAWN RUN, where jumping
    // grain spawn straight to a fruiting tent skips a whole growth stage.
    //
    // tk.ready gates both: a batch 3-7 days out is listed so the week ahead is
    // visible, but offering a one-tap move for it ends incubation early, and the
    // only way back is an 8-second undo snackbar. Not ready \u2014 falls through to
    // the passive "Ansehen" button below, which is what it did before the tabs.
    const canFruit = getStatus(tk.batchId).status === 'INCUBATING' && zones.some((z) => z.role === 'fruiting');
    const toFruiting = canFruit
      ? `<button class="btn btn-sm btn-p" data-action="move-to-fruiting" data-batch="${id}" style="font-size:11px;padding:3px 10px;flex-shrink:0">\u2192 ${esc(t('dash.toFruiting'))}</button>`
      : '';
    return (
      toFruiting +
      `<button class="btn btn-sm" data-action="open-move-modal" data-batch="${id}" style="font-size:11px;padding:3px 10px;flex-shrink:0;margin-left:${toFruiting ? '4px' : '0'}">${t('dash.move')}</button>`
    );
  }
  return `<button class="btn btn-sm" data-action="go-to-batch" data-batch="${id}" style="font-size:11px;padding:3px 10px;flex-shrink:0">${t('dash.view')}</button>`;
}
// The urgency sections of the batch-tasks card, in the order a worker triages:
// what is late, what is due today, what is coming, and what got left behind.
// 'left' is not date-driven — it is bags of a batch still sitting a stage behind
// the rest of it (see getSplitBatches), which is why it sits below the dated
// sections instead of being forced into "today".
const DASH_SECTIONS = ['overdue', 'today', 'week', 'left'];
// Which fruiting tent the one-tap moves target, remembered across reloads.
//
// This used to be _fruitingDest() alone: whichever tent something was last moved
// into. With one tent that is always right. With several it is a hidden global —
// move one batch into tent 3 by hand and every "→ Fruchtung" on the card silently
// retargets to tent 3, with nothing on screen saying so. Worse, a tent that has
// never received a move is unreachable from the card entirely.
//
// So the choice is explicit and visible. _fruitingDest() stays as the seed for a
// user who has never picked one, which keeps the single-tent case zero-effort.
function fruitingZones() {
  return zones.filter((z) => z.role === 'fruiting');
}
let _fruitingTargetKey = null;
function fruitingTarget() {
  const avail = fruitingZones();
  if (!avail.length) return null;
  if (_fruitingTargetKey === null) {
    // Guarded like _dashTab: storage revoked mid-session (site data blocked,
    // partitioned context, a backgrounded PWA evicted by iOS) must not throw
    // inside a render and abort everything queued behind it.
    try {
      _fruitingTargetKey = localStorage.getItem('mp-fruiting-target') || '';
    } catch (e) {
      _fruitingTargetKey = '';
    }
  }
  // The stored tent can have been deleted, renamed to another id, or had its
  // role changed since it was picked — never move bags at a stale target.
  if (_fruitingTargetKey && avail.some((z) => z.id === _fruitingTargetKey)) return _fruitingTargetKey;
  return _fruitingDest();
}
function setFruitingTarget(id) {
  if (!fruitingZones().some((z) => z.id === id)) return;
  _fruitingTargetKey = id;
  try {
    localStorage.setItem('mp-fruiting-target', id);
  } catch (e) {
    /* storage disabled — the choice just won't survive a reload */
  }
  renderDashBatchTasks();
}
// How full a tent is, and whether this many more bags would overflow it.
// max_capacity is optional and unset by default: with no capacity recorded there
// is nothing to warn about, and the (linear) getZoneBags walk is skipped
// entirely. Reuses getZoneBags rather than re-deriving occupancy, so the
// same-zone-move rule it encodes cannot drift out of sync here.
function fruitingFill(zoneId, incoming) {
  const z = zones.find((x) => x.id === zoneId);
  const cap = z && z.maxCapacity ? z.maxCapacity : 0;
  if (!cap) return null;
  const used = Object.keys(getZoneBags(zoneId)).length;
  return { used, cap, incoming: incoming || 0, over: used + (incoming || 0) > cap };
}
// How many rows the open day shows. Six leaves the whole week on one screen
// with a day open; the rest is one tap away rather than pushed off the bottom.
const DASH_DAY_CAP = 6;
const _dashRoomOpen = {};
function toggleDashRoom(key) {
  _dashRoomOpen[key] = !_dashRoomOpen[key];
  renderDashBatchTasks();
}
// Which day of the week strip is open, as an offset from today rather than a
// weekday number — a stored weekday would silently point at a different day
// after midnight, and 0 always means "today" no matter when it is read.
let _dashDayOffset = 0;
function setDashDay(off) {
  const n = Number(off);
  if (!Number.isInteger(n) || n < 0 || n > 6) return;
  _dashDayOffset = n;
  renderDashBatchTasks();
}
// The theme for a weekday, and whether it is the farm's decision or only this
// card's guess from history. Showing "no theme" on a card whose whole purpose
// is to give the week a shape was the worst possible default; a labelled guess
// is honest and useful, and the editor turns it into a decision.
let _rhythmGuess = null;
function themeFor(weekday) {
  const set = themeOf(weekday);
  if (set) return { theme: set, suggested: false };
  if (Object.keys(weekRhythm).length) return { theme: '', suggested: false };
  if (!_rhythmGuess) _rhythmGuess = suggestWeekRhythm();
  return { theme: _rhythmGuess[weekday] || '', suggested: true };
}
// ─── Weekly rhythm ──────────────────────────────────────────
// Must stay in step with WEEK_THEMES in db.js, which rejects anything else.
const WEEK_THEMES = ['substrate', 'grain', 'fruiting', 'harvest', 'lab', 'free'];
// Weekdays in the order a working week reads, not the order getDay() numbers
// them — Monday first, Sunday last, while the stored keys stay 0 = Sunday.
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0];
function weekThemeLabel(theme) {
  return theme ? t('rhythm.theme.' + theme) : t('rhythm.theme.none');
}
// Which theme a given weekday carries, or '' if the farm has not said.
// The whole entry for a weekday: {theme, targetQty, strainId, note}. A day the
// farm has not set returns null. Older payloads stored a bare theme string, so
// one is normalised rather than left to blow up on .theme.
function rhythmOf(weekday) {
  const v = weekRhythm[weekday] || weekRhythm[String(weekday)] || null;
  if (!v) return null;
  return typeof v === 'string' ? { theme: v, targetQty: null, strainId: null, note: null } : v;
}
function themeOf(weekday) {
  const r = rhythmOf(weekday);
  return r ? r.theme || '' : '';
}
function _ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
// The tracked job for a date, if one was planned. Past days and today are
// snapshots taken when they arrived; a future day has none yet, so it is read
// from the template and marked as still only a plan.
function rhythmTaskOn(date) {
  const key = _ymd(date);
  const row = rhythmTasks.find((x) => x.date === key);
  if (row) return row;
  const r = rhythmOf(date.getDay());
  if (!r || r.theme === 'free' || !r.targetQty) return null;
  return {
    date: key,
    weekday: date.getDay(),
    theme: r.theme,
    targetQty: r.targetQty,
    strainId: r.strainId,
    note: r.note,
    doneQty: 0,
    planned: true
  };
}
// Everything asked for before today and not finished. This is the point of
// tracking at all: 45 planned for Monday with 30 made means Tuesday still owes
// 15. Without it the shortfall simply vanished and the same 45 came round again
// the following week as though nothing had been missed.
function rhythmArrears(today) {
  const cut = _ymd(today);
  return rhythmTasks
    .filter((x) => x.date < cut && x.targetQty && (x.doneQty || 0) < x.targetQty)
    .map((x) => Object.assign({}, x, { outstanding: x.targetQty - (x.doneQty || 0) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
// The recipe behind the plan, for the day that is actually open. Empty when no
// Sorte is chosen or that Sorte carries no substrate recipe.
function rhythmMixText(weekday) {
  const r = rhythmOf(weekday);
  if (!r || !r.strainId) return '';
  const ms = mushroomStrains.find((m) => m.id === r.strainId);
  if (!ms) return '';
  const bits = [];
  if (ms.recBagKg) bits.push(ms.recBagKg + ' kg');
  if (ms.recHardwoodPct) bits.push('HW ' + ms.recHardwoodPct + '%');
  if (ms.recWheatbranPct) bits.push('WB ' + ms.recWheatbranPct + '%');
  // recGypsum is a flag ("add gypsum"), not a percentage — the app labels it
  // "Gips (~1%)" everywhere else, so printing the flag as a number would invent
  // a figure the recipe never held.
  if (ms.recGypsum) bits.push(t('inv.gypsum'));
  return bits.join(' · ');
}
// Propose a rhythm from what the farm already does, so the editor opens on a
// draft to correct rather than seven empty rows to invent.
//
// Picking the busiest activity per day would just print "substrate" on every
// weekday — blocks outnumber grain 1179 to 81, so they win everywhere. What
// makes a day *characteristic* is the share of an activity that lands on it:
// half of all grain runs happen on one weekday even though grain is rare. So
// each day takes the activity most concentrated on it, and a day that holds no
// meaningful share of anything is offered as free rather than mislabelled.
function suggestWeekRhythm() {
  const KINDS = ['substrate', 'grain', 'fruiting'];
  const byDay = {};
  const totals = { substrate: 0, grain: 0, fruiting: 0 };
  for (let d = 0; d < 7; d++) byDay[d] = { substrate: 0, grain: 0, fruiting: 0 };
  const typeOf = {};
  for (const b of batches) typeOf[b.batchId] = b.batchType;
  for (const e of scanLog) {
    if (!e || !e.time) continue;
    const dt = new Date(e.time);
    if (isNaN(dt)) continue;
    const d = dt.getDay();
    let kind = null;
    if (e.action === 'ADD') kind = typeOf[e.batch] === 'grain' ? 'grain' : 'substrate';
    else if (e.action === 'MOVE' || e.action === 'MOVE_BATCH') {
      const z = ZONE_BY_ID[toZone(e.to)];
      if (z && z.role === 'fruiting') kind = 'fruiting';
    }
    if (!kind) continue;
    byDay[d][kind]++;
    totals[kind]++;
  }
  // Share alone over-rewards rare work. Moves into a tent number 69 against
  // 1179 block builds, so a Tuesday holding 20 moves scores a higher share
  // (0.29) than the 314 blocks built the same day (0.27) — and Tuesday would be
  // labelled a fruiting day when 94% of what happens on it is substrate.
  //
  // So share only decides when it decides clearly. A kind must lead the
  // runner-up by half again to name the day; otherwise the day is named by what
  // there is simply most of. That keeps Wednesday as grain day, where grain is
  // genuinely concentrated (0.51 against 0.22), without letting a thin margin
  // rename a day around twenty events.
  const MARGIN = 1.5;
  // A day holding almost nothing all year is offered as free rather than being
  // given a theme on the strength of a handful of entries.
  const QUIET = 0.1;
  const dayTotal = (d) => KINDS.reduce((n, k) => n + byDay[d][k], 0);
  let busiest = 0;
  for (let d = 0; d < 7; d++) busiest = Math.max(busiest, dayTotal(d));

  const out = {};
  for (let d = 0; d < 7; d++) {
    if (!busiest || dayTotal(d) < QUIET * busiest) {
      out[d] = 'free';
      continue;
    }
    const shares = KINDS.map((k) => ({ k, share: totals[k] ? byDay[d][k] / totals[k] : 0, n: byDay[d][k] })).sort(
      (a, b) => b.share - a.share
    );
    const runnerUp = shares[1] ? shares[1].share : 0;
    if (shares[0].share > 0 && shares[0].share >= runnerUp * MARGIN) out[d] = shares[0].k;
    else out[d] = KINDS.reduce((best, k) => (byDay[d][k] > byDay[d][best] ? k : best), KINDS[0]);
  }
  return out;
}
// The next seven days, starting today, each with the work that lands on it.
//
// A rolling window rather than Monday-to-Sunday: a calendar week spends part of
// itself in the past, and the first question this card exists to answer is what
// to do now. Every weekday still appears exactly once, so the rhythm is just as
// visible — today is simply the one at the top.
//
// Overdue work folds onto today. It is not Tuesday's job any more; it is this
// morning's, and leaving it on the day it was missed would show an empty today
// beside a backlog nobody is looking at.
function buildWeekPlan() {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const lastByBag = buildLastScanByBag();
  const days = [];
  for (let off = 0; off < 7; off++) {
    const date = new Date(midnight.getTime() + off * 864e5);
    days.push({ offset: off, date, weekday: date.getDay(), theme: themeOf(date.getDay()), items: [] });
  }
  const put = (off, item) => days[Math.max(0, Math.min(6, off))].items.push(item);
  const biggestZone = (counts) => {
    let top = '';
    for (const z in counts) if (!top || counts[z] > counts[top]) top = z;
    return top;
  };

  for (const tk of buildAutoTasks()) {
    const place = _dashTaskPlace(tk.batchId, lastByBag);
    put(Math.max(0, tk.dueIn), {
      kind: tk.taskAction === 'inoculate' ? 'grain' : 'fruiting',
      batchId: tk.batchId,
      species: tk.species,
      label: tk.batchId,
      detail: tk.detail,
      bags: place.bags,
      zone: biggestZone(place.counts),
      overdue: tk.dueIn < 0,
      ready: tk.ready,
      // Carry the task itself so the row reuses dashTaskBtn, which already
      // encodes every guard: never offer a tent to grain spawn, never offer a
      // one-tap move to a batch that is not due yet, fall back to "Ansehen".
      task: tk
    });
  }
  for (const h of buildHarvestTasks()) {
    // remaining > 0 means it is still filling out; anything at or past its target
    // is work for today. No target at all means judge it by eye, so it is listed.
    const off = h.remaining == null ? 0 : Math.max(0, h.remaining);
    if (off > 6) continue;
    put(off, {
      kind: 'harvest',
      batchId: h.batchId,
      species: h.species,
      label: h.batchId,
      detail: h.target ? t('todo.dueIn', { n: Math.max(0, h.remaining) }) : '',
      bags: h.bagsInTent,
      zone: (h.zoneIds && h.zoneIds[0]) || '',
      overdue: h.target ? h.remaining < 0 : false,
      ready: true,
      task: h
    });
  }
  // Bags a split left a stage behind: not dated, but they are not going to fix
  // themselves either, so they belong in today's work rather than nowhere.
  for (const r of _dashLeftBehindRows(getSplitBatches(lastByBag))) {
    put(0, {
      kind: 'left',
      batchId: r.batchId,
      species: r.species,
      label: r.batchId,
      // These rows carry an instruction ("still in incubation") rather than a
      // due date, and offer no one-tap move — the split has to be looked at.
      detail: r.instruction || r.detail || '',
      bags: r.bags || 0,
      zone: '',
      overdue: false,
      ready: false,
      task: null
    });
  }
  for (const mt of manualTasks) {
    if (!mt || mt.done || !mt.dueDate) continue;
    const due = new Date(mt.dueDate);
    if (isNaN(due)) continue;
    due.setHours(0, 0, 0, 0);
    const off = Math.round((due - midnight) / 864e5);
    if (off > 6) continue;
    put(Math.max(0, off), {
      kind: 'manual',
      taskId: mt.id,
      label: mt.text || '',
      detail: '',
      bags: 0,
      zone: '',
      overdue: off < 0,
      ready: true,
      task: mt
    });
  }
  return days;
}
// How much of today is already behind you. Generated work vanishes as it is
// done — a moved batch simply stops being a task — so a bare "N left" can only
// ever shrink and never reads as progress. Counting what was actually recorded
// today gives the denominator something to move against.
function todayProgress(todayItems) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  let done = 0;
  for (const e of scanLog) {
    if (!e || !e.time) continue;
    const dt = new Date(e.time);
    if (isNaN(dt) || dt < midnight) continue;
    if (e.action === 'ADD') done++;
    else if ((e.action === 'MOVE' || e.action === 'MOVE_BATCH') && e.to) {
      const z = ZONE_BY_ID[toZone(e.to)];
      if (z && z.role === 'fruiting') done++;
    }
  }
  for (const h of harvests) {
    if (!h || !h.time) continue;
    const dt = new Date(h.time);
    if (!isNaN(dt) && dt >= midnight) done++;
  }
  for (const mt of manualTasks) if (mt && mt.done && mt.dueDate) done++;
  return { done, total: done + todayItems.length };
}
// The editor works on a draft rather than straight off the DOM. Changing a
// theme has to redraw the row — a free day carries no target — and redrawing
// off the DOM would discard whatever else was half-typed. The draft holds the
// answer; the form is only ever a view of it.
let _rhythmDraft = null;
function _rhythmSyncFromForm() {
  const rows = document.getElementById('rhythm-rows');
  if (!rows || !_rhythmDraft) return;
  rows.querySelectorAll('select[data-rhythm-day]').forEach((s) => {
    const d = s.getAttribute('data-rhythm-day');
    const e = (_rhythmDraft[d] = _rhythmDraft[d] || {});
    e.theme = s.value;
  });
  rows.querySelectorAll('[data-rhythm-qty]').forEach((i) => {
    const e = _rhythmDraft[i.getAttribute('data-rhythm-qty')];
    if (e) e.targetQty = i.value === '' ? null : Number(i.value);
  });
  rows.querySelectorAll('[data-rhythm-strain]').forEach((i) => {
    const e = _rhythmDraft[i.getAttribute('data-rhythm-strain')];
    if (e) e.strainId = i.value === '' ? null : Number(i.value);
  });
  rows.querySelectorAll('[data-rhythm-note]').forEach((i) => {
    const e = _rhythmDraft[i.getAttribute('data-rhythm-note')];
    if (e) e.note = i.value.trim() || null;
  });
}
function _renderRhythmRows() {
  const rows = document.getElementById('rhythm-rows');
  if (!rows || !_rhythmDraft) return;
  // '' is a real choice: a day can have a target without naming a Sorte.
  const strainOpts = (sel) =>
    '<option value="">—</option>' +
    [...mushroomStrains]
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((m) => '<option value="' + m.id + '"' + (m.id === sel ? ' selected' : '') + '>' + esc(m.name) + '</option>')
      .join('');
  rows.innerHTML = WEEK_DAYS.map((d) => {
    const cur = _rhythmDraft[d] || {};
    const sel = cur.theme || 'free';
    const opts = WEEK_THEMES.map(
      (k) => '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(weekThemeLabel(k)) + '</option>'
    ).join('');
    // A free day takes no target, so it is not asked for one.
    const detail =
      sel === 'free'
        ? ''
        : '<div style="display:flex;gap:6px;margin:0 0 5px 46px">' +
          '<input type="number" min="0" step="1" data-rhythm-qty="' +
          d +
          '" value="' +
          esc(cur.targetQty == null ? '' : String(cur.targetQty)) +
          '" placeholder="' +
          esc(t('rhythm.qtyPh')) +
          '" style="width:70px;padding:4px" />' +
          '<select data-rhythm-strain="' +
          d +
          '" style="flex:1;min-width:0;padding:4px">' +
          strainOpts(cur.strainId || 0) +
          '</select></div>' +
          '<div style="margin:0 0 9px 46px"><input type="text" maxlength="200" data-rhythm-note="' +
          d +
          '" value="' +
          esc(cur.note || '') +
          '" placeholder="' +
          esc(t('rhythm.notePh')) +
          '" style="width:100%;padding:4px" /></div>';
    return (
      '<label style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
      '<span style="width:38px;flex-shrink:0;font-size:13px">' +
      esc(t('rhythm.day.' + d)) +
      '</span><select data-rhythm-day="' +
      d +
      '" style="flex:1;padding:5px">' +
      opts +
      '</select></label>' +
      detail
    );
  }).join('');
  rows.querySelectorAll('select[data-rhythm-day]').forEach((s) => {
    s.addEventListener('change', () => {
      _rhythmSyncFromForm();
      _renderRhythmRows();
    });
  });
}
// Opens on the saved week, or — the first time, when nothing has been saved —
// on the one derived from the farm's own history, so the first interaction is
// correcting a draft rather than filling in seven blanks. A suggestion can only
// guess the theme; the target and the Sorte are the farm's call.
function openRhythmEditor() {
  const modal = document.getElementById('m-rhythm');
  const hint = document.getElementById('rhythm-hint');
  if (!modal) return;
  const saved = Object.keys(weekRhythm).length > 0;
  const guess = saved ? null : suggestWeekRhythm();
  _rhythmDraft = {};
  for (const d of WEEK_DAYS) {
    const cur = rhythmOf(d);
    _rhythmDraft[d] = saved
      ? { theme: (cur && cur.theme) || 'free', targetQty: (cur && cur.targetQty) || null, strainId: (cur && cur.strainId) || null, note: (cur && cur.note) || null }
      : { theme: guess[d] || 'free', targetQty: null, strainId: null, note: null };
  }
  if (hint) hint.textContent = saved ? '' : t('rhythm.suggested');
  _renderRhythmRows();
  // .modal-bg is display:none and only .modal-bg.open is display:flex, so
  // clearing the hidden attribute alone leaves the dialog invisible.
  modal.hidden = false;
  modal.classList.add('open');
}
function closeRhythmEditor() {
  const m = document.getElementById('m-rhythm');
  if (m) m.classList.remove('open');
  _rhythmDraft = null;
}
function saveRhythmEditor() {
  _rhythmSyncFromForm();
  if (!_rhythmDraft) return;
  const map = {};
  // 'free' is stored, not omitted: a day deliberately kept clear is a real
  // answer, and dropping it would look identical to never having decided —
  // which is what makes the editor offer a suggestion again.
  for (const d of WEEK_DAYS) {
    const e = _rhythmDraft[d] || {};
    map[d] =
      e.theme === 'free'
        ? { theme: 'free' }
        : { theme: e.theme || 'free', targetQty: e.targetQty, strainId: e.strainId, note: e.note };
  }
  apiPut('/api/week-rhythm', { rhythm: map }).then((res) => {
    if (res && res.error) {
      alert(res.error);
      return;
    }
    weekRhythm = map;
    closeRhythmEditor();
    setFb('ok', t('rhythm.saved'));
    renderDashBatchTasks();
  });
}
// Bags of this batch that are actually placed somewhere, plus the per-zone
// breakdown the row label needs. Returns counts rather than a formatted room so
// the (linear) zoneDisplayName lookup happens only for the rows actually shown.
function _dashTaskPlace(batchId, lastByBag) {
  const b = batchById(batchId);
  const counts = b ? _batchZoneCounts(b, lastByBag) : {};
  let bags = 0;
  for (const z in counts) bags += counts[z];
  return { bags, counts };
}
// Turns the "bags left behind" splits into rows shaped like every other row, so
// the section reads the same way: N bags of a batch, still one stage back, with
// the rest of the batch noted in the meta line.
function _dashLeftBehindRows(splits) {
  return splits.map((s) => {
    // behindStage / behindCount are already computed by getSplitBatches \u2014 do not
    // re-derive them, and never fabricate a fallback stage the batch is not in.
    const rest = s.stages
      .filter((x) => !x.behind)
      .map((x) => x.count + ' ' + t('dash.splitBatches.in') + ' ' + t('stage.' + x.role))
      .join(' \u00b7 ');
    return {
      batchId: s.batchId,
      species: s.species,
      bags: s.behindCount,
      instruction: t('dash.stillIn', { stage: t('stage.' + s.behindStage) }),
      where: rest ? '(' + rest + ')' : '',
      detail: s.urgent ? t('dash.splitBatches.stale') : '',
      // s.urgent means "unmoved for over 24h", which is a warning, not an overdue
      // date \u2014 it drives the orange dot. warn is also what keeps --sp-color live,
      // see the .todo-row rules in styles.css.
      warn: s.urgent,
      taskAction: 'view',
      bucket: 'left'
    };
  });
}
function renderDashBatchTasks() {
  const el = document.getElementById('dash-batch-tasks');
  if (!el) return;
  const week = buildWeekPlan();
  const anyWork = week.some((d) => d.items.length);
  const hasRhythm = Object.keys(weekRhythm).length > 0;
  if (!anyWork && !hasRhythm) {
    el.innerHTML =
      '<div class="empty" style="padding:12px;text-align:center;color:var(--c-text-muted);font-size:13px">' +
      esc(t('dash.noUrgent')) +
      '</div>' +
      _rhythmEditLink();
    return;
  }
  const sel = _dashDayOffset >= 0 && _dashDayOffset < 7 ? _dashDayOffset : 0;
  // Every day renders its own work, every time. On a wide screen all seven
  // columns are readable at once, which is the point of showing a week; on a
  // phone the CSS keeps the header strip and opens only the chosen day. One
  // render, two layouts — the alternative was emitting the open day twice.
  el.innerHTML =
    '<div class="wk">' +
    week.map((d, i) => _weekHeadHtml(d, i, i === sel)).join('') +
    week.map((d, i) => _weekColBodyHtml(d, i, i === sel)).join('') +
    '</div>' +
    _rhythmEditLink();
}
function _weekHeadHtml(d, off, sel) {
  const isToday = off === 0;
  const th = themeFor(d.weekday);
  const task = rhythmTaskOn(d.date);
  // The number is the day's own load: what the rhythm asks for if it asks for
  // anything, otherwise how much generated work landed on it.
  const n = task && task.targetQty ? task.targetQty : d.items.length;
  const short = th.theme && th.theme !== 'free' ? weekThemeLabel(th.theme) : '';
  return (
    '<button type="button" role="tab" data-action="dash-day" data-off="' +
    off +
    '" aria-selected="' +
    sel +
    '" class="wk-h' +
    (sel ? ' sel' : '') +
    '" style="--col:' +
    (off + 1) +
    '" title="' +
    esc(t('rhythm.day.' + d.weekday) + (short ? ' · ' + short : '')) +
    '">' +
    '<span style="display:block;font-size:13px;font-weight:700;color:' +
    (n ? (sel ? 'var(--c-accent)' : 'var(--c-text)') : 'var(--c-text-muted)') +
    '">' +
    (n || '·') +
    '</span>' +
    '<span style="display:block;font-size:9.5px;font-weight:' +
    (isToday ? '700' : '600') +
    ';color:' +
    (isToday ? 'var(--c-accent)' : 'var(--c-text-sec)') +
    '">' +
    esc(t('rhythm.day.' + d.weekday)) +
    '</span>' +
    // Clipped rather than wrapped: a wrapped word would push the columns to
    // different heights and the strip would stop reading as a row.
    '<span style="display:block;font-size:8.5px;color:var(--c-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    esc(short || '·') +
    '</span></button>'
  );
}
// One column's work. Narrow by design — on a wide screen this is a seventh of
// the card, so rows are stripped to the batch and its count, with the detail
// on the open day only.
function _weekColBodyHtml(d, off, sel) {
  return (
    '<div class="wk-b' +
    (sel ? ' sel' : '') +
    '" style="--col:' +
    (off + 1) +
    '">' +
    // The chosen day gets the full run sheet — rooms, buttons, progress. The
    // other six get a preview: a seventh of the card is not enough width for an
    // action button, and a truncated one is worse than none.
    (sel ? _weekDayBodyHtml(d, off, off === 0) : _weekColPreviewHtml(d)) +
    '</div>'
  );
}
// What a row actually asks you to do, which is not the same as what it is. A
// colonised grain jar and a rhythm target both mean "make blocks today", so
// they belong together even though one is a batch and the other is a plan.
const PLAN_CATS = ['create', 'move', 'harvest', 'other'];
const PLAN_CAT_LABEL = { create: 'cat.create', move: 'cat.move', harvest: 'cat.harvest', other: 'rhythm.other' };
const PLAN_CAT_COLOR = {
  create: 'var(--c-accent)',
  move: 'var(--c-blue-dark, var(--c-accent))',
  harvest: 'var(--c-amber-dark)',
  other: 'var(--c-text-muted)'
};
function planCategory(it) {
  if (it.kind === 'grain') return 'create';
  if (it.kind === 'fruiting') return 'move';
  if (it.kind === 'harvest') return 'harvest';
  return 'other';
}
function countByCategory(items) {
  const c = {};
  for (const it of items) c[planCategory(it)] = (c[planCategory(it)] || 0) + 1;
  return c;
}
// A column's work at a glance: what, and how much. No actions — this is for
// reading the week; the day you want to act on is one click away.
//
// Counts per category rather than a list of ids. In a 170px column four
// truncated batch ids say almost nothing; "3 Umziehen · 2 Ernten" says what the
// day is. The ids are in the open day, where there is room for them.
// The one control for changing what a day asks for, used everywhere the amount
// is shown. Carries its affordance with it: a dashed underline and a pencil, so
// it reads as something you can change rather than a number somebody decided.
function _rhythmTargetBtn(date, target, label) {
  return (
    '<button type="button" data-action="rhythm-target" data-date="' +
    esc(date) +
    '" data-target="' +
    target +
    '" title="' +
    esc(t('rhythm.targetEdit')) +
    '" style="display:block;max-width:100%;text-align:left;border:0;background:none;padding:0;cursor:pointer;font-family:inherit;font-size:inherit;font-weight:600;color:inherit;' +
    'border-bottom:1px dashed var(--c-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    esc(label) +
    ' <span aria-hidden="true" style="color:var(--c-text-muted);font-weight:400">✎</span></button>'
  );
}
function _weekColPreviewHtml(d) {
  const task = rhythmTaskOn(d.date);
  let html = '';
  // The amount is editable on every day it appears, not only the open one. It
  // used to be plain text here and a borderless button there, so it read as a
  // fixed number in both places — an edit nobody can find is the same as no
  // edit at all.
  if (task && task.targetQty) {
    const ms = task.strainId ? mushroomStrains.find((m) => m.id === task.strainId) : null;
    html +=
      '<div style="padding:3px 2px;border-left:2px solid var(--c-accent);margin-bottom:3px">' +
      _rhythmTargetBtn(task.date, task.targetQty, task.targetQty + (ms ? '× ' + ms.name : '')) +
      '</div>';
  } else if (themeFor(d.weekday).theme && themeFor(d.weekday).theme !== 'free') {
    // A themed day with no amount yet still needs a way in, or the first number
    // can only ever be set through the recurring editor.
    html +=
      '<div style="padding:3px 2px;margin-bottom:3px">' +
      _rhythmTargetBtn(_ymd(d.date), 0, t('rhythm.setQty')) +
      '</div>';
  }
  if (!d.items.length && !html) {
    return '<div style="padding:3px 2px;color:var(--c-text-muted);font-size:10px">' + esc(t('rhythm.nothing')) + '</div>';
  }
  const counts = countByCategory(d.items);
  const overdue = d.items.filter((i) => i.overdue).length;
  for (const cat of PLAN_CATS) {
    if (!counts[cat]) continue;
    html +=
      '<div style="display:flex;align-items:baseline;gap:5px;padding:2px;border-left:2px solid ' +
      PLAN_CAT_COLOR[cat] +
      ';margin-bottom:2px;font-size:10px">' +
      '<span style="font-weight:700;flex-shrink:0">' +
      counts[cat] +
      '</span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--c-text-sec)">' +
      esc(t(PLAN_CAT_LABEL[cat])) +
      '</span></div>';
  }
  // Late work is the one thing that should pull the eye across the week.
  if (overdue) {
    html +=
      '<div style="font-size:10px;color:var(--c-red-dark);padding:1px 2px">' +
      esc(t('cat.overdue', { n: overdue })) +
      '</div>';
  }
  return html;
}
// The open day, flat and dense. The room is a label on the row rather than a
// heading of its own — the headings were most of the old view's height, and the
// rows are still ordered by the walk, so the list reads as a route without
// costing a line per room. Expanding shows the rest of the same list.
function _weekDayBodyHtml(d, off, isToday) {
  let html = '<div style="padding:2px 0 8px 4px">';
  const mix = rhythmMixText(d.weekday);
  const r = rhythmOf(d.weekday);
  // The column strip is too narrow to say a theme is only a guess, so the open
  // day says it. An unconfirmed suggestion must never read as a decision.
  const th = themeFor(d.weekday);
  const bits = [th.suggested && th.theme ? weekThemeLabel(th.theme) + ' (' + t('rhythm.guess') + ')' : '', mix, r && r.note];
  const line = bits.filter(Boolean).join(' · ');
  if (line) html += '<div style="font-size:10.5px;color:var(--c-text-muted);margin:0 0 5px">' + esc(line) + '</div>';
  // The day's own planned job, and — on today only — whatever earlier days
  // still owe. Arrears belong on today because that is when they can be done.
  const own = rhythmTaskOn(d.date);
  if (own) html += _rhythmTaskRowHtml(own, 0);
  if (isToday) for (const late of rhythmArrears(d.date)) html += _rhythmTaskRowHtml(late, late.outstanding);
  if (isToday) {
    const prog = todayProgress(d.items);
    if (prog.total) {
      const pct = Math.round((prog.done / prog.total) * 100);
      html +=
        '<div style="display:flex;align-items:center;gap:6px;margin:0 0 6px">' +
        '<div style="flex:1;height:4px;border-radius:2px;background:var(--c-border);overflow:hidden">' +
        '<div style="width:' +
        pct +
        '%;height:100%;background:var(--action-color,var(--c-accent))"></div></div>' +
        '<span style="font-size:11px;color:var(--c-text-muted);flex-shrink:0">' +
        prog.done +
        '/' +
        prog.total +
        '</span></div>';
    }
  }
  if (!d.items.length) {
    return html + '<div style="font-size:11.5px;color:var(--c-text-muted)">' + esc(t('rhythm.nothing')) + '</div></div>';
  }
  html += _fruitingTargetHtml(d.items);

  // Ordered by the walk, so the flat list still reads as a route.
  const order = {};
  zones.forEach((z, i) => (order[z.id] = typeof z.sortOrder === 'number' ? z.sortOrder : i));
  const rank = (it) => (it.zone && order[it.zone] != null ? order[it.zone] : 999);
  const items = [...d.items].sort((a, b) => rank(a) - rank(b));
  const openKey = 'day' + off;
  const full = !!_dashRoomOpen[openKey];
  const shown = full ? items : items.slice(0, DASH_DAY_CAP);
  // Grouped by what you would be doing, in the order the day runs: make blocks,
  // move what is ready, harvest what is out. Within a category the rows keep
  // their walking order, so the route survives the grouping.
  let lastCat = '';
  for (const it of PLAN_CATS.flatMap((c) => shown.filter((x) => planCategory(x) === c))) {
    const cat = planCategory(it);
    if (cat !== lastCat) {
      lastCat = cat;
      html +=
        '<div style="display:flex;align-items:baseline;gap:5px;font-size:10.5px;font-weight:600;color:var(--c-text-sec);margin:7px 0 2px">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' +
        PLAN_CAT_COLOR[cat] +
        ';flex-shrink:0"></span>' +
        esc(t(PLAN_CAT_LABEL[cat])) +
        '</div>';
    }
    html += _dashPlanRowHtml(it, true);
  }
  const hidden = items.length - shown.length;
  if (hidden > 0 || full) {
    html +=
      '<button type="button" data-action="dash-room-more" data-room="' +
      esc(openKey) +
      '" aria-expanded="' +
      full +
      '" style="border:0;background:none;padding:3px 0;cursor:pointer;font-family:inherit;font-size:11.5px;color:var(--c-text-sec)">' +
      esc(hidden > 0 ? '+ ' + t('dash.moreRows', { n: hidden }) : '− ' + t('dash.fewerRows')) +
      '</button>';
  }
  return html + '</div>';
}
// A planned job as a row you can act on: what was asked for, how much of it is
// done, and a button to record the rest. `outstanding` is set for a job carried
// over from an earlier day, which is shown by its date rather than pretending
// it belongs to today.
function _rhythmTaskRowHtml(task, outstanding) {
  const ms = task.strainId ? mushroomStrains.find((m) => m.id === task.strainId) : null;
  const done = task.doneQty || 0;
  const target = task.targetQty || 0;
  const late = outstanding > 0;
  const label = (ms ? target + '× ' + ms.name : String(target)) + ' · ' + weekThemeLabel(task.theme);
  const meta = late
    ? t('rhythm.carriedFrom', { date: fmtDt(task.date), n: outstanding })
    : done
      ? t('rhythm.done', { done, total: target })
      : task.planned
        ? t('rhythm.planned')
        : t('rhythm.done', { done: 0, total: target });
  return (
    '<div class="todo-row" style="display:flex;align-items:center;gap:8px;padding:4px 0;--sp-color:' +
    (late ? 'var(--c-red-dark)' : ms ? spColor(ms.name) : 'var(--c-accent)') +
    '">' +
    // The amount is the thing that changes week to week, so it is the thing you
    // can tap. Editing it here changes this date only — the recurring rhythm is
    // the usual amount, and one busy Monday must not rewrite every Monday after.
    '<div style="flex:1;min-width:0;font-size:12px">' +
    _rhythmTargetBtn(task.date, target, label) +
    '<div style="font-size:11px;color:' +
    (late ? 'var(--c-red-dark)' : 'var(--c-text-muted)') +
    '">' +
    esc(meta) +
    '</div></div>' +
    // A future day cannot be logged against — it has no snapshot yet, and
    // recording work before the day arrives would be recording a guess.
    (task.planned
      ? ''
      : '<button class="btn btn-sm btn-p" data-action="rhythm-log" data-date="' +
        esc(task.date) +
        '" data-target="' +
        target +
        '" data-done="' +
        done +
        '" style="font-size:11px;padding:3px 10px;flex-shrink:0">' +
        esc(t('rhythm.log')) +
        '</button>') +
    '</div>'
  );
}
// Change what this one date is asking for. The recurring rhythm is the usual
// amount; this is the week that differs. Says so explicitly, because "45" being
// editable in two places is exactly the kind of thing that gets misread.
function editRhythmTarget(date, target) {
  if (!date) return;
  prompt2(t('rhythm.targetPrompt', { date: fmtDt(date) }), String(target || ''), function (raw) {
    if (raw === null || raw === undefined) return;
    const s = String(raw).trim();
    if (s === '') return;
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) {
      setFb('err', t('rhythm.logBad'));
      return;
    }
    apiPost('/api/rhythm-task', { date, targetQty: n }).then((res) => {
      if (res && res.error) {
        alert(res.error);
        return;
      }
      const row = rhythmTasks.find((x) => x.date === date);
      if (row) row.targetQty = n;
      // A future date had no row until now; the server just made one, and the
      // next load will bring it. Re-render from what we know meanwhile.
      else rhythmTasks.push({ date, weekday: new Date(date).getDay(), theme: '', targetQty: n, doneQty: 0 });
      setFb('ok', t('rhythm.targetSaved'));
      renderDashBatchTasks();
    });
  });
}
// Ask how many were actually made, and send the absolute figure. Pre-filled
// with the target rather than 0: the common answer is "all of them", and the
// common answer should be one tap away.
function logRhythmProgress(date, target, done) {
  if (!date) return;
  prompt2(t('rhythm.logPrompt', { total: target }), String(done || target || ''), function (raw) {
    if (raw === null || raw === undefined) return;
    const s = String(raw).trim();
    if (s === '') return;
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) {
      setFb('err', t('rhythm.logBad'));
      return;
    }
    apiPost('/api/rhythm-task', { date, doneQty: n }).then((res) => {
      if (res && res.error) {
        alert(res.error);
        return;
      }
      // Update in place so the row reflects the new figure without waiting for
      // the next poll; the server is the source of truth on the next load.
      const row = rhythmTasks.find((x) => x.date === date);
      if (row) row.doneQty = n;
      else rhythmTasks.push({ date, weekday: new Date(date).getDay(), theme: '', targetQty: target, doneQty: n });
      setFb('ok', t('rhythm.logged'));
      renderDashBatchTasks();
    });
  });
}
function _rhythmEditLink() {
  return (
    '<div style="margin-top:8px;padding-top:8px;border-top:0.5px solid var(--c-border)">' +
    '<button type="button" data-action="edit-rhythm" style="border:0;background:none;padding:0;cursor:pointer;font-family:inherit;font-size:11px;color:var(--c-text-sec)">' +
    esc(t('rhythm.edit')) +
    '</button></div>'
  );
}
// withRoom folds the room into the row's meta line. The flat day list has no
// room headings — they were most of its height — so the row has to say where
// to walk, or the list stops being a route.
function _dashPlanRowHtml(it, withRoom) {
  const btn = _planBtn(it);
  const room = withRoom && it.zone ? zoneDisplayName(it.zone) : '';
  const meta = [room, it.bags ? tp('dash.bags', it.bags) : '', it.detail].filter(Boolean).join(' · ');
  return (
    // The left edge carries the species colour, as it did before the redesign —
    // it is how a row is recognised at a glance without reading the id. Overdue
    // still overrides it: being late outranks knowing which mushroom it is.
    '<div class="todo-row" style="display:flex;align-items:center;gap:8px;padding:4px 0;--sp-color:' +
    (it.overdue ? 'var(--c-red-dark)' : spColor(it.species)) +
    '">' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    esc(it.label) +
    '</div>' +
    (meta ? '<div style="font-size:11px;color:var(--c-text-muted)">' + esc(meta) + '</div>' : '') +
    '</div>' +
    btn +
    '</div>'
  );
}
// Which tent today's moves are heading for, stated once above the rows and
// switchable. Only shown when something on the day can actually move there, and
// never on a day that also holds grain rows — naming a tent beside grain invites
// sending it there, which skips a growth stage.
function _fruitingTargetHtml(items) {
  const dest = fruitingTarget();
  const movable = items.filter((x) => x.kind === 'fruiting' && x.ready);
  const hasGrain = items.some((x) => x.kind === 'grain');
  if (!dest || hasGrain || !movable.length) return '';
  const tents = fruitingZones();
  let incoming = 0;
  for (const m of movable) incoming += m.bags || 0;
  const fill = fruitingFill(dest, incoming);
  const warn =
    fill && fill.over
      ? '<div style="font-size:10.5px;color:var(--c-red-dark);margin-bottom:4px">⚠ ' +
        esc(t('dash.destFull', { zone: zoneDisplayName(dest), n: fill.used + fill.incoming, cap: fill.cap })) +
        '</div>'
      : '';
  if (tents.length < 2) {
    return (
      '<div style="font-size:10.5px;color:var(--c-text-muted);margin:6px 0 2px">→ ' +
      esc(zoneDisplayName(dest)) +
      (fill ? ' ' + fill.used + '/' + fill.cap : '') +
      '</div>' +
      warn
    );
  }
  // Wraps rather than scrolls: four tents overflow a phone, and a tent pushed
  // off-screen is a tent nobody picks.
  const chips = tents
    .map((z) => {
      const on = z.id === dest;
      const zf = z.maxCapacity ? fruitingFill(z.id, on ? incoming : 0) : null;
      return (
        '<button type="button" data-action="dash-dest" data-zone="' +
        esc(z.id) +
        '" aria-pressed="' +
        on +
        '" title="' +
        esc(z.name) +
        '" style="flex:0 0 auto;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;padding:3px 8px;border-radius:11px;cursor:pointer;font-family:inherit;border:1px solid ' +
        (on ? 'var(--c-accent)' : 'var(--c-border)') +
        ';background:' +
        (on ? 'var(--c-accent)' : 'transparent') +
        ';color:' +
        (on ? '#fff' : 'var(--c-text-sec)') +
        '">' +
        esc(z.name) +
        (zf ? '<span style="opacity:.75"> ' + zf.used + '/' + zf.cap + '</span>' : '') +
        '</button>'
      );
    })
    .join('');
  return (
    '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0 2px">' +
    '<span style="font-size:10.5px;color:var(--c-text-muted);flex-shrink:0">' +
    esc(t('dash.destLabel')) +
    '</span>' +
    '<span role="group" aria-label="' +
    esc(t('dash.destLabel')) +
    '" style="display:flex;flex-wrap:wrap;gap:4px;min-width:0">' +
    chips +
    '</span>' +
    _bulkPillHtml(movable) +
    '</div>' +
    warn
  );
}
// "Alle → Fruchtung" for today, kept from the old card. Only when there is more
// than one, and only on today: a one-tap that moves a whole backlog is undoable
// for eight seconds and no longer. bulkSectionToFruiting('today') already sweeps
// overdue in with today, which is exactly how the week plan buckets them.
function _bulkPillHtml(movable) {
  if (movable.length < 2) return '';
  return (
    '<button type="button" class="btn btn-sm btn-p" data-action="bulk-fruiting" data-bucket="today" ' +
    'style="font-size:11px;padding:3px 10px;white-space:nowrap;flex-shrink:0;margin-left:auto">' +
    esc(t('dash.bulkFruiting')) +
    '</button>'
  );
}
// Each kind keeps the button it already had elsewhere on the dashboard, rather
// than a new one invented for this card. Batch work goes through dashTaskBtn so
// its guards travel with it; a harvest opens the batch where the flush is
// logged; a manual task toggles done.
function _planBtn(it) {
  const id = esc(it.batchId || '');
  if (it.kind === 'fruiting' || it.kind === 'grain') return it.task ? dashTaskBtn(it.task) : '';
  if (it.kind === 'harvest') {
    return (
      '<button class="btn btn-sm" data-action="go-to-batch" data-batch="' +
      id +
      '" style="font-size:11px;padding:3px 10px;flex-shrink:0;background:var(--c-amber-light);color:var(--c-amber-dark);border-color:var(--c-amber-border)">' +
      esc(t('harvest.logHarvest')) +
      '</button>'
    );
  }
  if (it.kind === 'manual') {
    return (
      '<button class="btn btn-sm" data-action="toggle-task" data-id="' +
      esc(String(it.taskId || '')) +
      '" style="font-size:11px;padding:3px 10px;flex-shrink:0">' +
      esc(t('calDetail.markDone')) +
      '</button>'
    );
  }
  return (
    '<button class="btn btn-sm" data-action="go-to-batch" data-batch="' +
    id +
    '" style="font-size:11px;padding:3px 10px;flex-shrink:0">' +
    esc(t('dash.view')) +
    '</button>'
  );
}
// One-tap: move every incubation-ready batch in one urgency section to fruiting.
// Confirms once, then reuses the same moveBatchTo path as the per-row button.
// Sections run most-urgent-first, and a batch can only ever become MORE urgent
// while the card sits on screen. So a tap is honoured for its own section or any
// more urgent one: without this, a pill rendered at 23:50 on "Heute" matched
// nothing at 00:05, because buildAutoTasks had re-bucketed those batches as
// "overdue" \u2014 and the button did nothing at all, with no confirm and no error.
function _bucketRank(key) {
  const i = DASH_SECTIONS.indexOf(key);
  return i < 0 ? 99 : i;
}
// One-tap: move every incubation-ready batch in one urgency section to fruiting.
// Confirms once, then reuses the same moveBatchTo path as the per-row button.
function bulkSectionToFruiting(bucket) {
  const dest = fruitingTarget();
  if (!dest) {
    setFb('err', t('dash.noFruitingZone'));
    return;
  }
  const lastByBag = buildLastScanByBag();
  const targets = [];
  let bags = 0;
  const rank = _bucketRank(bucket);
  buildAutoTasks()
    .filter((tk) => tk.taskAction === 'move' && tk.ready && _bucketRank(tk.bucket) <= rank)
    .forEach((tk) => {
      const b = batchById(tk.batchId);
      if (!b) return;
      if (getStatus(tk.batchId).status !== 'INCUBATING') return;
      targets.push(b);
      bags += _dashTaskPlace(tk.batchId, lastByBag).bags;
    });
  if (!targets.length) {
    // Say so rather than looking broken: the data moved on under the button.
    flashUndoBar(t('dash.nothingToMove'));
    renderDashBatchTasks();
    return;
  }
  confirm2(
    t('dash.bulkFruitingTitle'),
    t('dash.bulkFruitingMsg', { n: bags, zone: t('dash.sec.' + bucket), dest: zoneDisplayName(dest) }),
    t('dash.move'),
    () => {
      // moveBatchTo moves each target's ENTIRE bag set, which is what the "N
      // Beutel" on the section header now counts too — the section is a set of
      // whole batches, not a room. snap records every bag that actually moves,
      // so Undo restores them all exactly.
      const snap = _snapshotBeforeMove(targets, dest, buildLastScanByBag());
      let moved = 0;
      targets.forEach((b) => moveBatchTo(b, dest, (m) => (moved += m || 0)));
      updateSD();
      renderBatches();
      renderStatus();
      renderDashBatchTasks();
      showUndoBar(t('dash.bulkFruitingDone', { n: moved, dest: zoneDisplayName(dest) }), () => _undoMove(snap));
    }
  );
}
// Colonised grain → make blocks from it. Opens the same quick-create dialog as
// the dashboard's "Neue Charge" with this grain's Sorte preselected, so the
// recipe is already right. The grain itself is then picked under "Beimpft mit":
// that list is per bag, not per batch, so a multi-bag grain batch has no single
// bag we could honestly preselect — the worker scans the one they opened.
function inoculateFromBatch(batchId) {
  const b = batches.find((x) => x.batchId === batchId);
  const ms = b && b.strainId ? mushroomStrains.find((x) => x.id === b.strainId) : null;
  if (ms && ms.recBatchType) msQuickOpen('charge', ms);
  else msQuickChargeNew();
}
// Collapsible dashboard reference sections (KPIs / Live status / Lab). No saved
// choice → open on desktop, collapsed on phones (less scrolling); each toggle
// is remembered per section under mp-dash-collapse.
function initDashCollapse() {
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem('mp-dash-collapse') || '{}') || {};
    } catch (e) {
      return {};
    }
  };
  const store = read();
  const desktop = window.matchMedia('(min-width: 769px)').matches;
  ['dc-kpi', 'dc-status', 'dc-lab'].forEach((id) => {
    const d = document.getElementById(id);
    if (!d) return;
    const initial = store[id] === undefined ? desktop : store[id] === 'open';
    d.open = initial;
    // Track the believed state so the toggle fired by the initial open= set above
    // (desktop first load) isn't mistaken for a user choice and persisted — that
    // would leak the desktop default onto a later phone visit.
    let last = initial;
    d.addEventListener('toggle', () => {
      if (d.open === last) return;
      last = d.open;
      const cur = read();
      cur[id] = d.open ? 'open' : 'closed';
      localStorage.setItem('mp-dash-collapse', JSON.stringify(cur));
    });
  });
}

// Attention filter: temporarily restrict the batches list to a subset (due today, overdue, ...)
// Set by dashboard View buttons; cleared by a banner in the batches list.
let batchAttentionFilter = null; // { pred: (batch) => boolean, label: string } | null

const BATCH_ATTENTION_PRESETS = {
  dueToday: {
    labelKey: 'alert.filterDueToday',
    pred: (b) => {
      const { status } = getStatus(b.batchId);
      // FRUITING/CONTAM are tracked elsewhere
      // (Ready-to-harvest / Contamination reports), not as due-today work.
      if (['DONE', 'EMPTY', 'FRUITING', 'CONTAM'].includes(status)) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const due = new Date(b.due);
      due.setHours(0, 0, 0, 0);
      const dl = Math.round((due - today) / 864e5);
      return dl <= 0;
    }
  },
  overdue: {
    labelKey: 'alert.filterOverdue',
    pred: (b) => {
      const { status } = getStatus(b.batchId);
      if (['DONE', 'EMPTY', 'FRUITING', 'CONTAM'].includes(status)) return false;
      return isBatchOverdue(b);
    }
  }
};

function goToBatchesAttention(key) {
  const preset = BATCH_ATTENTION_PRESETS[key];
  if (!preset) return;
  batchAttentionFilter = { pred: preset.pred, label: t(preset.labelKey) };
  const input = document.getElementById('batch-q');
  if (input) input.value = '';
  go('batch', 'n-batch');
  openStab('batch', 'list');
}

function clearBatchAttentionFilter() {
  batchAttentionFilter = null;
  renderBatches();
}

function renderBatchAttentionBanner() {
  const card = document.getElementById('sp-batch-list')?.querySelector('.card');
  if (!card) return;
  let banner = document.getElementById('batch-attention-banner');
  if (!batchAttentionFilter) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'batch-attention-banner';
    banner.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:6px 10px;margin-bottom:8px;background:#fed7aa;border-left:4px solid #ea580c;border-radius:6px;font-size:12px;color:#7c2d12;font-weight:500';
    card.insertBefore(banner, card.firstChild);
  }
  banner.innerHTML =
    `<div style="flex:1">${esc(batchAttentionFilter.label)}</div>` +
    `<button class="btn btn-sm" data-action="clear-attention" style="font-size:11px;padding:2px 8px;background:#ea580c;color:#fff;border-color:transparent">${t('alert.filterShowAll')}</button>`;
}

// Navigate to a specific batch: filter the batches list, expand its bags row, and scroll it into view.
function goToBatch(batchId) {
  batchAttentionFilter = null;
  const input = document.getElementById('batch-q');
  if (input) input.value = batchId;
  go('batch', 'n-batch');
  openStab('batch', 'list');
  setTimeout(() => {
    if (!document.getElementById('brow-' + batchId)) {
      const togBefore = document.getElementById('btog-' + batchId);
      if (togBefore) toggleBatchBags(batchId);
    }
    const row = document.getElementById('btog-' + batchId)?.closest('tr');
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('batch-row-flash');
      setTimeout(() => row.classList.remove('batch-row-flash'), 1500);
    }
  }, 80);
}

// ─── DASHBOARD READY-TO-HARVEST ─────────────────────────────
// Fruiting batches live here (not in Batch tasks) so they don't crowd out
// Move/Discard urgency — fruiting can stretch over weeks/flushes.
function buildHarvestTasks() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Placement entries only (ADD/MOVE/REMOVE): a HARVEST entry must not be read
  // as "this bag left the tent" \u2014 logging a flush does not move anything.
  const lastByBag = buildLastPlacementByBag();
  const isFruitingZone = (loc) => {
    const z = ZONE_BY_ID[toZone(loc)];
    return !!(z && z.role === 'fruiting');
  };
  return batches
    .filter((b) => getStatus(b.batchId).status === 'FRUITING')
    .map((b) => {
      const zoneCounts = {};
      let activeBags = 0,
        bagsInTent = 0,
        enteredTent = null;
      b.bags.forEach((bag) => {
        const last = lastByBag.get(bag.toUpperCase());
        if (!last || last.action === 'REMOVE' || !last.to) return;
        activeBags++;
        const z = toZone(last.to);
        zoneCounts[z] = (zoneCounts[z] || 0) + 1;
        if (!isFruitingZone(last.to)) return;
        bagsInTent++;
        // The placement entry that put this bag where it now is IS its arrival
        // in the tent. The oldest such arrival is when this batch started
        // fruiting \u2014 which is what "days in the tent" should mean. The previous
        // code used the incubation due date instead, so the figure drifted by
        // however early or late the move happened (up to 18 days in practice)
        // and clamped to 0 for anything moved in ahead of its due date.
        if (!enteredTent || last.time < enteredTent) enteredTent = last.time;
      });
      const zoneIds = Object.keys(zoneCounts).sort((a, z) => zoneCounts[z] - zoneCounts[a]);
      const zoneLabel = zoneIds.length ? zoneIds.map((z) => zoneDisplayName(z)).join(', ') : '\u2014';
      const harvTotal = harvests.filter((h) => h.batch === b.batchId).reduce((s, h) => s + (h.grams || 0), 0);
      let daysInTent = 0;
      if (enteredTent) {
        const t0 = new Date(enteredTent);
        t0.setHours(0, 0, 0, 0);
        daysInTent = Math.max(0, Math.round((today - t0) / 864e5));
      }
      // Expected tent time comes from the Sorte's recipe, read live rather than
      // frozen onto the batch, so batches already fruiting get a target too.
      // 0 / no recipe \u2192 no target, just show the elapsed days.
      const ms = b.strainId ? mushroomStrains.find((x) => x.id === b.strainId) : null;
      const target = ms && ms.recFruitDays > 0 ? ms.recFruitDays : 0;
      return {
        batchId: b.batchId,
        species: b.species,
        strain: b.strain,
        activeBags,
        bagsInTent,
        elsewhere: activeBags - bagsInTent,
        zoneLabel,
        // Already computed for the label; exposed so the day plan can group a
        // harvest under the room you actually walk to rather than re-deriving it.
        zoneIds,
        daysInTent,
        target,
        remaining: target ? target - daysInTent : null,
        harvTotal
      };
    })
    .filter((t) => t.bagsInTent > 0)
    .sort((a, z) => {
      // Most overdue first; batches without a target fall to the end, oldest
      // first, so they still read as a sensible list rather than random order.
      if (a.target && z.target) return a.remaining - z.remaining;
      if (a.target) return -1;
      if (z.target) return 1;
      return z.daysInTent - a.daysInTent;
    });
}


// ─── DASHBOARD LAB STOCK ────────────────────────────────────
const LAB_TYPES = ['MC', 'PD', 'LC', 'G2G', 'GS'];
const LAB_LABELS = { MC: 'Mother cultures', PD: 'Petri dishes', LC: 'Liquid cultures', G2G: 'G2G', GS: null };
function getLabLabel(type) {
  if (type === 'GS') return t('lab.gsLabel');
  return LAB_LABELS[type] || type;
}
function getLabStockCounts() {
  const counts = { MC: 0, PD: 0, LC: 0, G2G: 0, GS: 0 };
  cultures
    .filter((c) => c.status === 'active')
    .forEach((c) => {
      if (counts[c.type] !== undefined) counts[c.type]++;
    });
  // Grain spawn = total bags across active grain batches
  batches
    .filter((b) => b.batchType === 'grain')
    .forEach((b) => {
      const { status } = getStatus(b.batchId);
      if (!['DONE', 'EMPTY', 'CONTAM'].includes(status)) {
        counts.GS += b.qty || 0;
      }
    });
  return counts;
}
function getLabStrainBreakdown() {
  const breakdown = { MC: {}, PD: {}, LC: {}, G2G: {}, GS: {} };
  cultures
    .filter((c) => c.status === 'active')
    .forEach((c) => {
      if (!breakdown[c.type]) return;
      const name = c.strainName || c.species || 'Unknown';
      const kz = c.strainKuerzel || c.strain || '';
      const desc = c.strainDescriptor || '';
      const key = name + '|' + kz;
      if (!breakdown[c.type][key]) breakdown[c.type][key] = { name, kz, desc, count: 0, color: spColor(name) };
      breakdown[c.type][key].count++;
    });
  batches
    .filter((b) => b.batchType === 'grain')
    .forEach((b) => {
      const { status } = getStatus(b.batchId);
      if (['DONE', 'EMPTY', 'CONTAM'].includes(status)) return;
      const name = b.strainName || b.species || 'Unknown';
      const kz = b.strainKuerzel || b.strain || '';
      const desc = b.strainDescriptor || '';
      const key = name + '|' + kz;
      if (!breakdown.GS[key]) breakdown.GS[key] = { name, kz, desc, count: 0, color: spColor(name) };
      if (b.bagWeights && Object.keys(b.bagWeights).length) {
        breakdown.GS[key].count += Object.values(b.bagWeights).reduce((s, w) => s + (w || 1), 0);
      } else {
        breakdown.GS[key].count += (b.qty || 0) * (b.bagKg || 1);
      }
    });
  return breakdown;
}
const LAB_TYPE_COLORS = {
  MC: { bg: '#f3e8ff', fg: '#6b21a8', accent: '#a855f7' },
  PD: { bg: '#dbeafe', fg: '#1e40af', accent: '#3b82f6' },
  LC: { bg: '#dcfce7', fg: '#166534', accent: '#22c55e' },
  G2G: { bg: '#fef3c7', fg: '#92400e', accent: '#f59e0b' },
  GS: { bg: '#fce4ec', fg: '#880e4f', accent: '#e91e63' }
};
function renderDashLabStock() {
  const el = document.getElementById('dash-lab-stock');
  if (!el) return;
  if (!inventory.labThresholds) inventory.labThresholds = { MC: 0, PD: 0, LC: 0, G2G: 0, GS: 0 };
  const counts = getLabStockCounts();
  const breakdown = getLabStrainBreakdown();
  el.innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:10px">' +
    LAB_TYPES.map((type) => {
      const count = counts[type] || 0;
      const min = inventory.labThresholds[type] || 0;
      const label = getLabLabel(type);
      const tc = LAB_TYPE_COLORS[type];
      const strains = Object.values(breakdown[type] || {}).sort((a, b) => b.count - a.count);
      const strainTotal = strains.reduce((sum, s) => sum + s.count, 0);
      // For GS, low = any strain below min kg; for others, low = total count below min
      const low = type === 'GS' ? min > 0 && strains.some((s) => s.count < min) : min > 0 && count < min;
      const strainRows = strains
        .map((s) => {
          const pct =
            (type === 'GS' ? strainTotal : count) > 0
              ? Math.round((s.count / (type === 'GS' ? strainTotal : count)) * 100)
              : 0;
          const strainLow = type === 'GS' && min > 0 && s.count < min;
          return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
        <span style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0"></span>
        <span style="flex:1;font-size:11px;color:var(--c-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(s.kz || s.name)}${s.desc ? ' ' + esc(s.desc) : ''}">${esc(s.kz || s.name)}${s.desc ? ' <span style="color:var(--c-text-muted);font-size:10px">' + esc(s.desc) + '</span>' : ''}</span>
        <span style="font-size:11px;font-weight:600;color:${strainLow ? 'var(--c-red-dark)' : 'var(--c-text)'};min-width:18px;text-align:right">${type === 'GS' ? (Number.isInteger(s.count) ? s.count : s.count.toFixed(1)) + ' kg' : s.count}</span>
        <div style="width:40px;height:5px;background:var(--c-bg);border-radius:3px;overflow:hidden;flex-shrink:0"><div style="height:100%;width:${pct}%;background:${strainLow ? 'var(--c-red)' : s.color};border-radius:3px"></div></div>
      </div>`;
        })
        .join('');
      const emptyMsg =
        count === 0
          ? `<div style="font-size:11px;color:var(--c-text-muted);font-style:italic;padding:4px 0">\u2014</div>`
          : '';
      return `<div style="background:var(--c-bg);border:1px solid ${low ? 'var(--c-red)' : 'var(--c-border)'};border-radius:12px;padding:14px 16px;transition:box-shadow .15s;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${low ? 'var(--c-red)' : tc.accent}"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;margin-top:2px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:12px;font-weight:700;color:${tc.fg};background:${tc.bg};padding:2px 8px;border-radius:6px">${esc(type)}</span>
          <span style="font-size:11px;color:var(--c-text-sec)">${esc(label)}</span>
        </div>
        ${low ? '<span style="font-size:9px;background:var(--c-red-light);color:var(--c-red-dark);padding:1px 6px;border-radius:99px;font-weight:700">' + t('lab.lowStock') + '</span>' : ''}
      </div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:${strains.length ? '8' : '2'}px">
        <span style="font-size:28px;font-weight:800;color:${low ? 'var(--c-red-dark)' : 'var(--c-text)'};line-height:1">${count}</span>
        <span style="font-size:11px;color:var(--c-text-muted)">${min > 0 ? '/ min ' + min + (type === 'GS' ? ' kg per strain' : '') : ''}</span>
      </div>
      ${strains.length ? '<div style="border-top:1px solid var(--c-border);padding-top:6px">' + strainRows + (type === 'GS' ? '<div style="border-top:1px solid var(--c-border);margin-top:4px;padding-top:4px;display:flex;justify-content:space-between;font-size:11px;font-weight:700;color:var(--c-text)"><span>Total</span><span>' + (Number.isInteger(strainTotal) ? strainTotal : strainTotal.toFixed(1)) + ' kg</span></div>' : '') + '</div>' : emptyMsg}
      <button class="btn btn-sm" onclick="setLabMin('${type}')" style="margin-top:8px;font-size:10px;padding:2px 8px">${t('lab.setMinimum')}</button>
    </div>`;
    }).join('') +
    '</div>';
}
function setLabMin(type) {
  if (!inventory.labThresholds) inventory.labThresholds = { MC: 0, PD: 0, LC: 0, G2G: 0, GS: 0 };
  const cur = inventory.labThresholds[type] || 0;
  const hint = type === 'GS' ? ' (kg per strain)' : '';
  const val = prompt(t('lab.setMinimum') + ' \u2014 ' + getLabLabel(type) + hint, cur);
  if (val === null) return;
  inventory.labThresholds[type] = parseDecimal(val) || 0;
  saveLabThresholds();
  renderDashLabStock();
  renderDashAlerts();
}

// ─── RACKS ───────────────────────────────────────────────────
function getRackBags(rackId) {
  const bags = {};
  scanLog.forEach((e) => {
    if (e.action === 'ADD' && e.to === rackId && e.bag)
      bags[e.bag] = { batchId: e.batch, species: e.species, strain: e.strain };
    if (e.action === 'MOVE' || e.action === 'MOVE_BATCH') {
      if (e.to === rackId && e.bag) bags[e.bag] = { batchId: e.batch, species: e.species, strain: e.strain };
      if (e.from === rackId && e.bag) delete bags[e.bag];
    }
    if (e.action === 'REMOVE' && e.from === rackId && e.bag) delete bags[e.bag];
  });
  return bags;
}
// ─── LOCATION BAG INTERACTIONS ──────────────────────────────
const selectedLocBags = new Map(); // bagId → {batchId, loc}
function getZoneBags(zone) {
  const bags = {};
  scanLog.forEach((e) => {
    const tz = toZone(e.to),
      fz = toZone(e.from);
    if (e.action === 'ADD' && tz === zone && e.bag)
      bags[e.bag] = { batchId: e.batch, species: e.species, strain: e.strain, loc: e.to };
    if (e.action === 'MOVE' || e.action === 'MOVE_BATCH') {
      if (tz === zone && e.bag) bags[e.bag] = { batchId: e.batch, species: e.species, strain: e.strain, loc: e.to };
      // fz !== tz: a move WITHIN this zone (rack to rack — 'INC' to 'INC_R1',
      // which toZone() maps back to 'INC') inserted the bag and then deleted it
      // on the very next line, so the zone card, the fruiting summary and the
      // dashboard zone count all read 0 right after a successful move. It also
      // emptied the stocktake's expected list, so every bag scanned on the walk
      // was judged "recorded elsewhere" and got a spurious correcting MOVE.
      if (fz === zone && fz !== tz && e.bag) delete bags[e.bag];
    }
    if (e.action === 'REMOVE' && fz === zone && e.bag) delete bags[e.bag];
  });
  return bags;
}
function toggleLocBag(bagId, batchId, loc) {
  if (selectedLocBags.has(bagId)) selectedLocBags.delete(bagId);
  else selectedLocBags.set(bagId, { batchId, loc });
  // Toggle chip class
  const el = document.querySelector(`.bag-chip[data-bag="${CSS.escape(bagId)}"]`);
  if (el) el.classList.toggle('selected', selectedLocBags.has(bagId));
  updateActionBar();
}
function locSelectAll() {
  locSelectAllVisible();
}
// Most-recently-used move/placement destinations, newest-first and de-duped,
// so the common moves (Inkubation → Fruchtung / Kontamination) are one tap
// instead of a scroll through every zone + rack. Sourced from scanLog, which
// already records every move — no schema change or extra request. The last
// pick is persisted so it survives a reload and leads even on a fresh log.
// Recent destinations for the picker shortcut row. Defaults to actual moves
// (MOVE/MOVE_BATCH), seeded by the persisted last move destination — ADD is
// excluded there because initial placement is nearly always Inkubation and
// would bury the real move targets (Fruchtung / Kontam). The placement picker
// passes { actions: ['ADD'], lastKey: null } to get placement history instead.
function recentDestinations(limit, opts) {
  limit = limit || 4;
  opts = opts || {};
  const actions = opts.actions || ['MOVE', 'MOVE_BATCH'];
  const lastKey = 'lastKey' in opts ? opts.lastKey : 'mp-last-dest';
  const seen = new Set();
  const out = [];
  if (lastKey) {
    let last = null;
    try {
      last = localStorage.getItem(lastKey);
    } catch (e) {
      /* storage disabled (private mode) — fall back to scanLog only */
    }
    if (last && LOCS.includes(last)) {
      seen.add(last);
      out.push(last);
    }
  }
  for (let i = scanLog.length - 1; i >= 0 && out.length < limit; i--) {
    const e = scanLog[i];
    if (!actions.includes(e.action)) continue;
    const to = e.to;
    if (!to || seen.has(to) || !LOCS.includes(to)) continue;
    seen.add(to);
    out.push(to);
  }
  return out;
}
function rememberDest(loc) {
  if (!loc) return;
  try {
    localStorage.setItem('mp-last-dest', loc);
  } catch (e) {
    /* storage disabled — recents still work from scanLog */
  }
}
// Destination picker for the bags selected on the dashboard. Uses the shared
// _openZonePicker (same list as the batch-move and placement pickers) instead of
// the old bespoke grid + two-step confirm: picking a destination moves straight
// away, and the Undo in the feedback bar covers a mistap. Destinations the
// selected bags already sit at are dropped from the shortcut row (no-op moves).
function openLocMovePopup() {
  if (!selectedLocBags.size) return;
  const srcLocs = new Set([...selectedLocBags.values()].map((d) => d.loc));
  _openZonePicker(t('dash.moveBags', { n: selectedLocBags.size }), (dest) => locMoveTo(dest), {
    excludeLocs: srcLocs
  });
}
// Event delegation for bag chip clicks
document.getElementById('dash-locations').addEventListener('click', function (e) {
  // The sort chips sit above the zones, so handle them before anything that
  // treats a click as landing inside a room.
  const ls = e.target.closest('[data-action="loc-sort"]');
  if (ls) {
    e.preventDefault();
    e.stopPropagation();
    setLocSort(ls.dataset.key);
    return;
  }
  // Stocktake button sits inside the zone header, whose own click toggles the
  // section — stop the event so opening the check doesn't also collapse it.
  const zc = e.target.closest('[data-zone-check]');
  if (zc) {
    e.preventDefault();
    e.stopPropagation();
    openZoneCheck(zc.dataset.zoneCheck);
    return;
  }
  const chip = e.target.closest('.bag-chip[data-bag]');
  if (!chip) return;
  e.preventDefault();
  e.stopPropagation();
  toggleLocBag(chip.dataset.bag, chip.dataset.batch, chip.dataset.loc);
});
let lastLocUndoEntries = [];
function locMoveTo(toLoc) {
  if (!selectedLocBags.size) return;
  rememberDest(toLoc);
  const now = new Date().toISOString();
  const n = selectedLocBags.size;
  const entries = [];
  selectedLocBags.forEach((d, bagId) => {
    const b = batches.find((x) => x.batchId === d.batchId);
    const entry = {
      time: now,
      action: 'MOVE',
      batch: d.batchId,
      bag: bagId,
      from: d.loc,
      to: toLoc,
      species: b?.species || null,
      strain: b?.strain || null,
      user: currentUser?.username || null,
      client_uuid: newScanUuid(),
      // I-12: optimistic concurrency snapshot for offline-queue replays.
      expected_current_zone: d.loc ? toZone(d.loc) : null
    };
    scanLog.push(entry);
    movements.push(entry);
    entries.push(entry);
    scan.count++;
  });
  lastLocUndoEntries = entries;
  selectedLocBags.clear();
  document.getElementById('m-locmove').classList.remove('open');
  postScanEntries(entries); // I-12 zone check applies: these are MOVEs
  updateSD();
  renderStatus();
  setLocFb(t('scanFb.moved', { n: n, loc: toLoc }));
}
// ─── ZONE CHECK (stocktake) ─────────────────────────────────
// Bag locations are derived from the scan log, so if bags get moved without
// being scanned the records drift silently and there is no way to notice. This
// walks one zone: it lists what the app still expects to be there, you tick off
// what you actually find, and whatever is left over is the drift. The leftovers
// feed the normal move/remove flows (via selectedLocBags) so they reuse the same
// scan entries, undo and sync as every other correction.
let _zcZone = null;
let _zcMode = 'zone'; // 'zone' = bags in a zone, 'culture' = lab cultures
let _zcScanMode = false;
let _zcMoved = 0; // bags found here that the records had somewhere else
const _zcFound = new Set();
// Camera stocktake: keep the scanner open and walk the zone bag by bag. Each
// scan ticks the bag off; a bag that is here but recorded elsewhere is corrected
// to this zone on the spot (the drift the expected-list alone can never see).
// Closing the camera returns to the check sheet — see closeCamScan.
function zoneCheckStartScan() {
  if (_zcMode === 'zone' && !_zcZone) return;
  _zcScanMode = true;
  document.getElementById('m-zonecheck').classList.remove('open');
  scan.action = null;
  scan.to = null;
  scan.from = null;
  scan.harvestBag = null;
  updateSD();
  openCamScan();
}
// Deliberately lighter than setFb: a stocktake fires one of these per bag, and
// setFb also writes a scan-log entry and re-renders the success list, which is
// wasted work here. Flash the camera view (the scan-overlay flash is invisible
// behind the camera), beep, and drop a one-line HUD toast — no window.
function _zcFeedback(type, msg) {
  const el = document.getElementById('m-camscan');
  if (el) {
    el.classList.remove('cam-flash-ok', 'cam-flash-err');
    void el.offsetWidth; // restart the animation for back-to-back scans
    el.classList.add(type === 'ok' ? 'cam-flash-ok' : 'cam-flash-err');
  }
  if (type === 'ok') _scanBeepOk();
  else _scanBeepErr();
  _showCamHudToast(type, msg);
}
function zoneCheckScanned(bagId, batchId) {
  const expected = getZoneBags(_zcZone);
  const total = Object.keys(expected).length;
  if (expected[bagId]) {
    if (_zcFound.has(bagId)) {
      _zcFeedback('info', t('zoneCheck.scanDup', { bag: bagId }));
      return;
    }
    _zcFound.add(bagId);
    _zcFeedback('ok', t('zoneCheck.scanOk', { found: _zcFound.size, total: total }));
    return;
  }
  // Not expected here, but it is physically in the zone — correct the record.
  const b = batches.find((x) => x.batchId && x.batchId.toUpperCase() === (batchId || '').toUpperCase());
  if (!b) {
    _zcFeedback('err', t('zoneCheck.scanUnknown', { bag: bagId }));
    return;
  }
  moveBagsTo(b, [bagId], _zcZone, function (moved) {
    if (!moved) {
      _zcFeedback('err', t('zoneCheck.scanUnknown', { bag: bagId }));
      return;
    }
    _zcFound.add(bagId);
    _zcMoved++;
    _zcFeedback('ok', t('zoneCheck.scanMoved', { bag: bagId, zone: zoneDisplayName(_zcZone) }));
  });
}
function openZoneCheck(zoneId) {
  _zcMode = 'zone';
  _zcZone = zoneId;
  _zcFound.clear();
  _zcMoved = 0;
  renderZoneCheck();
  document.getElementById('m-zonecheck').classList.add('open');
}
// Lab stocktake. Cultures have no location, so "expected" means every culture
// the records still say you hold (aktiv / eingelagert). Scan what is really on
// the shelf; whatever is left over is gone and gets marked aufgebraucht.
function openLabCheck() {
  _zcMode = 'culture';
  _zcZone = null;
  _zcFound.clear();
  _zcMoved = 0;
  renderZoneCheck();
  document.getElementById('m-zonecheck').classList.add('open');
}
function _zcExpected() {
  if (_zcMode === 'culture') {
    return cultures
      .filter((c) => c.status === 'active' || c.status === 'stored')
      .map((c) => [c.id, { batchId: (c.species || '') + (c.strainText ? ' · ' + c.strainText : '') }])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }
  return Object.entries(getZoneBags(_zcZone)).sort((a, b) => a[0].localeCompare(b[0]));
}
function renderZoneCheck() {
  const expected = _zcExpected();
  document.getElementById('zc-title').textContent =
    _zcMode === 'culture' ? t('labCheck.title') : t('zoneCheck.title', { zone: zoneDisplayName(_zcZone) });
  document.getElementById('zc-count').textContent =
    t('zoneCheck.count', { found: _zcFound.size, total: expected.length }) +
    (_zcMoved ? ' · ' + t('zoneCheck.corrected', { n: _zcMoved }) : '');
  const body = document.getElementById('zc-body');
  if (!expected.length) {
    body.innerHTML =
      '<div style="color:var(--c-text-muted);font-style:italic;padding:14px 0">' + esc(t('zoneCheck.empty')) + '</div>';
    document.getElementById('zc-foot').innerHTML = '';
    return;
  }
  body.innerHTML = expected
    .map(([bagId, d]) => {
      const on = _zcFound.has(bagId);
      return (
        `<div data-zc-bag="${esc(bagId)}" style="display:flex;align-items:center;gap:10px;padding:11px 8px;border-bottom:0.5px solid var(--c-border);cursor:pointer;${on ? 'opacity:.5' : ''}">` +
        `<span style="width:22px;height:22px;flex:none;border-radius:6px;border:2px solid ${on ? 'var(--c-primary,#16a34a)' : 'var(--c-border)'};background:${on ? 'var(--c-primary,#16a34a)' : 'transparent'};color:#fff;display:grid;place-items:center;font-size:14px;font-weight:700">${on ? '✓' : ''}</span>` +
        `<span style="font-family:monospace;font-size:13px;font-weight:600;${on ? 'text-decoration:line-through' : ''}">${esc(bagId)}</span>` +
        `<span style="flex:1;min-width:0;font-size:12px;color:var(--c-text-sec);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.batchId || '')}</span>` +
        `</div>`
      );
    })
    .join('');
  const missing = expected.length - _zcFound.size;
  const btn =
    'flex:1;min-width:130px;padding:11px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid var(--c-border)';
  // Scanning is the primary way to work through a zone; tapping rows is the
  // fallback for a bag whose label won't read.
  const scanBtn = `<button type="button" data-zc-act="scan" style="${btn};flex-basis:100%;background:var(--c-primary,#16a34a);color:#fff;border-color:transparent;font-size:15px;padding:13px">📷 ${esc(t('zoneCheck.scanBtn'))}</button>`;
  const missingBtns =
    _zcMode === 'culture'
      ? `<button type="button" data-zc-act="used" style="${btn};background:var(--c-surface);color:var(--c-red-dark)">${esc(t('labCheck.missingUsed', { n: missing }))}</button>`
      : `<button type="button" data-zc-act="move" style="${btn};background:var(--c-primary,#16a34a);color:#fff;border-color:transparent">${esc(t('zoneCheck.missingMove', { n: missing }))}</button>` +
        `<button type="button" data-zc-act="remove" style="${btn};background:var(--c-surface);color:var(--c-red-dark)">${esc(t('zoneCheck.missingRemove', { n: missing }))}</button>`;
  document.getElementById('zc-foot').innerHTML =
    scanBtn +
    (missing
      ? missingBtns
      : `<div style="flex:1;text-align:center;padding:10px;font-size:13px;font-weight:600;color:var(--c-primary,#16a34a)">${esc(t('zoneCheck.allFound'))}</div>`);
}
// A culture scanned during a lab check is physically on the shelf: tick it off,
// and if the records had already written it off (aufgebraucht/kontaminiert),
// put it back to aktiv — the same "found where the records didn't expect it"
// correction the zone check does for bags.
function labCheckScanned(cultureId) {
  const c = cultures.find((x) => x.id && x.id.toUpperCase() === cultureId.toUpperCase());
  if (!c) {
    _zcFeedback('err', t('labCheck.scanUnknown', { id: cultureId }));
    return;
  }
  if (_zcFound.has(c.id)) {
    _zcFeedback('info', t('zoneCheck.scanDup', { bag: c.id }));
    return;
  }
  const total = _zcExpected().length;
  if (c.status === 'active' || c.status === 'stored') {
    _zcFound.add(c.id);
    _zcFeedback('ok', t('zoneCheck.scanOk', { found: _zcFound.size, total: total }));
    return;
  }
  setCultureStatus(c.id, 'active');
  _zcFound.add(c.id);
  _zcMoved++;
  _zcFeedback('ok', t('labCheck.scanRevived', { id: c.id }));
}
// Mark every culture that wasn't found as used up.
function _zcMarkMissingUsed() {
  const missing = _zcExpected()
    .map(([id]) => id)
    .filter((id) => !_zcFound.has(id));
  if (!missing.length) return;
  confirm2(t('labCheck.confirmTitle'), t('labCheck.confirmMsg', { n: missing.length }), t('lab.usedUp'), () => {
    missing.forEach((id) => setCultureStatus(id, 'used'));
    document.getElementById('m-zonecheck').classList.remove('open');
    setFb('ok', t('labCheck.done', { n: missing.length }));
  });
}
// Load the not-found bags into the shared selection, then hand off to the normal
// move picker / remove flow so the correction is an ordinary scan entry.
function _zcSelectMissing() {
  selectedLocBags.clear();
  _zcExpected().forEach(([bagId, d]) => {
    if (!_zcFound.has(bagId)) selectedLocBags.set(bagId, { batchId: d.batchId, loc: d.loc });
  });
  document.getElementById('m-zonecheck').classList.remove('open');
  return selectedLocBags.size;
}
function locRemoveSelected() {
  if (!selectedLocBags.size) return;
  const n = selectedLocBags.size;
  if (!confirm(t('scanFb.confirmRemove', { n: n }))) return;
  const now = new Date().toISOString();
  const entries = [];
  selectedLocBags.forEach((d, bagId) => {
    const b = batches.find((x) => x.batchId === d.batchId);
    const entry = {
      time: now,
      action: 'REMOVE',
      batch: d.batchId,
      bag: bagId,
      from: d.loc,
      to: null,
      species: b?.species || null,
      strain: b?.strain || null,
      user: currentUser?.username || null,
      client_uuid: newScanUuid()
    };
    scanLog.push(entry);
    movements.push(entry);
    entries.push(entry);
    scan.count++;
  });
  lastLocUndoEntries = entries;
  selectedLocBags.clear();
  document.getElementById('m-locmove').classList.remove('open');
  apiPost('/api/scan-log', { entries }).then(function (r) {
    if (r && r.ids)
      entries.forEach((e, i) => {
        setEntryServerId(e, r.ids[i]);
      });
  });
  updateSD();
  renderStatus();
  setLocFb(t('scanFb.removed', { n: n }));
}
function setLocFb(msg) {
  const el = document.getElementById('scan-toast');
  el.className = 'scan-toast fb-ok visible';
  el.innerHTML =
    msg +
    ' <button onclick="locUndo()" style="margin-left:8px;font-size:11px;padding:2px 10px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer;font-weight:600;pointer-events:auto">Undo</button>';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('visible'), 5000);
}
function locUndo() {
  if (!lastLocUndoEntries.length) return;
  const toUndo = lastLocUndoEntries;
  lastLocUndoEntries = [];
  // Remove exactly these entries by identity — NOT by position. A background
  // pollSync may have appended other users' rows since the move, so
  // splice(length - n, n) could drop the wrong local entries.
  for (const e of toUndo) {
    const si = scanLog.indexOf(e);
    if (si !== -1) scanLog.splice(si, 1);
    const mi = movements.indexOf(e);
    if (mi !== -1) movements.splice(mi, 1);
  }
  updateSD();
  renderStatus();
  // Delete each persisted row by its own id (owner-or-admin ACL) instead of the
  // admin-only DELETE /scan-log/last/N, which 403'd for workers (yet still
  // showed "success") and for admins deleted the globally-newest N rows —
  // possibly another user's scans. Report the real outcome.
  Promise.all(
    toUndo.map((e) =>
      e._serverId ? apiDelete('/api/scan-log/' + e._serverId).then((r) => !!r && !r.error) : Promise.resolve(false)
    )
  ).then((results) => {
    if (results.length && results.every(Boolean)) {
      setFb('ok', t('scanFb.undoOk'));
    } else {
      setFb('err', t('scanFb.undoFail'));
      refresh(); // re-sync so the UI reflects what actually persisted
    }
  });
}

// ─── BATCHES ─────────────────────────────────────────────────
function nbTypeChange() {
  nbPreview();
}
function setBagWeight(kg) {
  document.getElementById('nb-weight').value = kg;
  // Highlight the active button
  ['wbtn-3', 'wbtn-5'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const btnKg = parseFloat(btn.textContent);
    btn.className = 'btn btn-sm' + (btnKg === kg ? ' btn-p' : '');
  });
  nbPreview();
}
// Charge form ← product: fill the substrate/grain fields from a saved product
// spec so a charge can be made straight from "what was ordered". The product
// drives an internally-block batch that also deducts coir + raw grain.
let _nbProducts = [];
function _fillNbProducts() {
  const sel = document.getElementById('nb-product');
  if (!sel) return;
  apiGet('/api/products?active=1')
    .then((d) => {
      _nbProducts = (d.items || []).filter((p) => (p.prodType || 'buy') !== 'buy');
      const cur = sel.value;
      sel.innerHTML =
        `<option value="">${esc(t('batch.noProduct'))}</option>` +
        _nbProducts.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
      sel.value = cur;
    })
    .catch(() => {});
}
function _nbProductChanged() {
  const sel = document.getElementById('nb-product');
  const id = sel && sel.value ? parseInt(sel.value, 10) : null;
  if (!id) {
    nbPreview();
    return;
  }
  apiGet('/api/products/' + id)
    .then((p) => {
      if (!p || p.error) return;
      const set = (eid, val) => {
        const el = document.getElementById(eid);
        if (el) el.value = val;
      };
      const isCvg = (p.prodSubstrate || 'holzkleie') === 'cvg';
      if (p.prodBagKg != null) set('nb-weight', p.prodBagKg);
      set('nb-rh', p.prodRhPct != null ? p.prodRhPct : 0);
      set('nb-hw', isCvg ? 0 : p.prodHardwoodPct || 0);
      set('nb-wb', isCvg ? 0 : p.prodWheatbranPct || 0);
      set('nb-coir', isCvg ? p.prodCoirPct || 100 : 0);
      set('nb-grainkg', p.prodGrainKg || 0);
      set('nb-grainrh', p.prodGrainRhPct != null ? p.prodGrainRhPct : 52);
      const gyp = document.getElementById('nb-gyp');
      if (gyp) gyp.checked = !!p.prodGypsum;
      nbSubSum();
    })
    .catch(() => {});
}
function nbPreview() {
  const strainSel = document.getElementById('nb-strain-sel');
  const strainId = strainSel ? parseInt(strainSel.value) || null : null;
  const ms = strainId ? mushroomStrains.find((x) => x.id === strainId) : null;
  const sp = ms ? ms.name : '',
    st = ms ? ms.kuerzel : '';
  const qty = parseInt(document.getElementById('nb-qty').value) || 0;
  document.getElementById('nb-prev').textContent = sp && st ? genBatchId(sp) + ' (' + qty + ' bags)' : '—';
  const bagKg = parseDecimal(document.getElementById('nb-weight').value) || 0;
  if (!qty || !bagKg) {
    document.getElementById('nb-mat-preview').style.display = 'none';
    return;
  }
  const lines = [];
  {
    const hw = parseDecimal(document.getElementById('nb-hw').value) || 0;
    const wb = parseDecimal(document.getElementById('nb-wb').value) || 0;
    const coir = parseDecimal((document.getElementById('nb-coir') || {}).value) || 0;
    const rh = parseDecimal(document.getElementById('nb-rh').value) || 0;
    const gyp = document.getElementById('nb-gyp').checked;
    const grainKg = parseDecimal((document.getElementById('nb-grainkg') || {}).value) || 0;
    const grainRh = parseDecimal((document.getElementById('nb-grainrh') || {}).value) || 0;
    if (hw || wb || coir) {
      // Correct calculation: subtract water first, then split dry matter
      // dryKg = bagKg × (1 - rh/100)
      const dryKg = mtDryKg(bagKg, rh);
      const hwKg = qty * dryKg * (hw / 100);
      const wbKg = qty * dryKg * (wb / 100);
      const coirKg = qty * dryKg * (coir / 100);
      const gypKg = gyp ? qty * dryKg * 0.01 : 0;
      const hwStock = inventory.stock?.hardwood || 0;
      const wbStock = inventory.stock?.wheatbran || 0;
      const coirStock = inventory.stock?.coir || 0;
      const gypStock = inventory.stock?.gypsum || 0;
      if (rh > 0)
        lines.push(
          `<strong>Bag:</strong> ${bagKg}kg total → ${dryKg.toFixed(3)}kg dry matter per bag (${rh}% water removed)`
        );
      if (hw)
        lines.push(
          `<strong>Hardwood (${hw}%):</strong> ${hwKg.toFixed(3)} kg needed — ${hwStock.toFixed(2)} kg in stock ${hwStock >= hwKg ? '✓' : '⚠ short by ' + (hwKg - hwStock).toFixed(2) + 'kg'}`
        );
      if (wb)
        lines.push(
          `<strong>Wheat bran (${wb}%):</strong> ${wbKg.toFixed(3)} kg needed — ${wbStock.toFixed(2)} kg in stock ${wbStock >= wbKg ? '✓' : '⚠ short by ' + (wbKg - wbStock).toFixed(2) + 'kg'}`
        );
      if (coir)
        lines.push(
          `<strong>Kokos/CVG (${coir}%):</strong> ${coirKg.toFixed(3)} kg needed — ${coirStock.toFixed(2)} kg in stock ${coirStock >= coirKg ? '✓' : '⚠ short by ' + (coirKg - coirStock).toFixed(2) + 'kg'}`
        );
      if (gyp)
        lines.push(
          `<strong>Gypsum (~1%):</strong> ${gypKg.toFixed(3)} kg needed — ${gypStock.toFixed(2)} kg in stock ${gypStock >= gypKg ? '✓' : '⚠'}`
        );
      lines.push(`<strong>Total dry matter per bag:</strong> ${dryKg.toFixed(3)} kg`);
    }
    if (grainKg > 0) {
      const grainUsed = qty * mtDryKg(grainKg, grainRh);
      const grainStock = inventory.stock?.grain || 0;
      lines.push(
        `<strong>Grain:</strong> ${grainUsed.toFixed(3)} kg needed — ${grainStock.toFixed(2)} kg in stock ${grainStock >= grainUsed ? '✓' : '⚠ short by ' + (grainUsed - grainStock).toFixed(2) + 'kg'}`
      );
    }
  }
  const el = document.getElementById('nb-mat-preview');
  if (lines.length) {
    el.innerHTML = lines.join('<br>');
    el.style.display = 'block';
  } else el.style.display = 'none';
}
// ── "Beimpft mit" — what a new batch was inoculated from ─────
// One list for both kinds of inoculant, because the worker does not care which
// table it lives in: cultures (MC/PD/LC/G2G/GS) sit in `cultures`, grain spawn
// sits in `batches` as G-… with barcoded bags. Two separate fields asked them to
// know the difference; scanning does not.
//
// Nothing is consumed automatically. A liquid culture or petri normally survives
// many inoculations, and even a grain bag makes 5-15 blocks, so whether it is
// spent is a question only the operator can answer — asked once after the batch
// saves. Answer no and it stays in inventory.
// [{ kind: 'culture' | 'bag', id }]
let _inoc = [];
function inocAvailable() {
  const out = cultures
    .filter((c) => c.status === 'active' || c.status === 'stored')
    .map((c) => ({
      kind: 'culture',
      id: c.id,
      label: c.id + ' — ' + (c.strainName || c.species || '') + ' (' + c.type + ')'
    }));
  nbAvailableSpawnBags().forEach((b) =>
    out.push({ kind: 'bag', id: b.bag, label: b.bag + ' — ' + b.species + ' (' + zoneDisplayName(b.loc) + ')' })
  );
  return out;
}
// null when accepted, else the reason. Accepts a culture id or a grain bag id in
// any case, which is what a scanner hands over.
function inocAdd(rawId) {
  const id = String(rawId || '').trim();
  if (!id) return t('inoc.notUsable', { id: rawId });
  if (_inoc.some((x) => x.id.toUpperCase() === id.toUpperCase())) return t('inoc.already', { id });
  const hit = inocAvailable().find((x) => x.id.toUpperCase() === id.toUpperCase());
  if (!hit) {
    // Distinguish "known but spent" from "never heard of it" — the first is a
    // real answer, the second is probably a mis-scan.
    const c = cultures.find((x) => x.id.toUpperCase() === id.toUpperCase());
    if (c) return t('scanFb.cultureNotUsable', { id: c.id, status: c.status });
    return t('inoc.notUsable', { id });
  }
  _inoc.push({ kind: hit.kind, id: hit.id });
  return null;
}
function inocRemove(id) {
  _inoc = _inoc.filter((x) => x.id !== id);
}
// A batch's source_id column takes a culture. Grain bags are not cultures and are
// recorded in the scan log instead (nbConsumeSpawnBags), so only the first culture
// in the list lands there — the full list still drives what gets written off.
function inocCultureId() {
  const c = _inoc.find((x) => x.kind === 'culture');
  return c ? c.id : '';
}
// Renders chips + the fallback picker into whichever prefix is on screen.
function inocRender(prefix) {
  const chips = document.getElementById(prefix + '-inoc-chips');
  if (chips)
    chips.innerHTML = _inoc
      .map(
        (x) =>
          `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-family:monospace;background:var(--c-bg);border:1px solid var(--c-border);border-radius:5px;padding:2px 4px 2px 7px">${esc(x.id)}<button type="button" data-action="inoc-drop" data-id="${esc(x.id)}" style="border:0;background:none;cursor:pointer;font-size:13px;line-height:1;padding:0 3px;color:var(--c-text-muted)">✕</button></span>`
      )
      .join('');
  const sel = document.getElementById(prefix + '-inoc-pick');
  if (sel) {
    const free = inocAvailable().filter((x) => !_inoc.some((y) => y.id === x.id));
    sel.innerHTML =
      `<option value="">${esc(t('inoc.pick'))}</option>` +
      free.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('');
    sel.value = '';
  }
}
function inocPicked(prefix) {
  const sel = document.getElementById(prefix + '-inoc-pick');
  if (!sel || !sel.value) return;
  const err = inocAdd(sel.value);
  if (err) setFb('err', err, { noModal: true });
  inocRender(prefix);
}
// After the batch is safely saved: was the inoculant used up? Yes writes it off,
// no leaves it exactly where it was.
function inocAskConsume(batchObj, list) {
  if (!list.length) return;
  const names = list.map((x) => x.id).join(', ');
  // OK writes it off; Cancel is the "no, still have some" answer and leaves
  // everything untouched — which is what Cancel already means, so no custom
  // button label is needed.
  confirm2(t('inoc.spentTitle'), t('inoc.spentMsg', { names, id: batchObj.batchId }), t('inoc.spentYes'), () =>
    inocConsume(batchObj, list)
  );
}
function inocConsume(batchObj, list) {
  const bags = list.filter((x) => x.kind === 'bag').map((x) => x.id);
  if (bags.length) nbConsumeSpawnBags(batchObj, bags);
  list
    .filter((x) => x.kind === 'culture')
    .forEach((x) => {
      const c = cultures.find((y) => y.id === x.id);
      if (c && c.status !== 'used') setCultureStatus(c.id, 'used');
    });
}
// ── Grain spawn consumed by a new block batch ────────────────
// Grain spawn lives in `batches` (G-… with barcoded bags), never in `cultures`,
// so nb-culture — which lists PD/LC/G2G/GS cultures — can never reference one.
// That left the grain generation missing from every lineage. Bags picked here are
// written off on create: a REMOVE carrying reason "spawn:<new batch id>", so the
// link lives in the scan log rather than needing a column, and it is naturally
// multi-valued (a 20-bag batch may take two grain bags).
// Which UI prefix ('nb' | 'ms-q') has the camera open for a "Beimpft mit" scan,
// so the read lands in that field instead of opening the bag sheet or the lineage
// view. Cleared when the camera closes, or every later scan would be swallowed by
// a form the worker has moved on from.
let _inocScanPrefix = null;
// A grain bag is available if it belongs to a grain batch and is still placed.
function nbAvailableSpawnBags() {
  const placed = buildLastPlacementByBag();
  const out = [];
  batches.forEach((b) => {
    if (b.batchType !== 'grain') return;
    (b.bags || []).forEach((bag) => {
      const last = placed.get(String(bag).toUpperCase());
      if (!last || last.action === 'REMOVE' || !last.to) return;
      out.push({ bag, loc: last.to, species: b.strainName || b.species || '' });
    });
  });
  return out.sort((a, z) => a.bag.localeCompare(z.bag));
}
// Write off each grain bag consumed by `batchObj`. from = its current location so
// the zone counts drop, and reason ties it to the batch it became.
function nbConsumeSpawnBags(batchObj, bags) {
  if (!bags.length) return;
  const placed = buildLastPlacementByBag();
  const now = new Date().toISOString();
  const entries = [];
  bags.forEach((bag) => {
    const last = placed.get(String(bag).toUpperCase());
    if (!last || last.action === 'REMOVE') return;
    const src = batches.find((b) => (b.bags || []).some((x) => x.toUpperCase() === bag.toUpperCase()));
    const entry = {
      time: now,
      action: 'REMOVE',
      batch: src ? src.batchId : null,
      bag,
      from: last.to || null,
      to: null,
      species: src ? src.species : null,
      strain: src ? src.strain : null,
      reason: 'spawn:' + batchObj.batchId,
      user: currentUser?.username || null,
      client_uuid: newScanUuid(),
      _tempId: 's' + ++_scanTempIdCounter
    };
    scanLog.push(entry);
    movements.push(entry);
    entries.push(entry);
  });
  if (!entries.length) return;
  _statusByBatch = null; // the grain batch may now be DONE
  postScanEntries(entries, { zoneCheck: false });
  setFb('ok', t('batch.spawnConsumed', { n: entries.length, id: batchObj.batchId }), { noModal: true });
}
// Grain bags written off for a batch, read back out of the scan log.
function spawnSourceFor(batchId) {
  const key = 'spawn:' + batchId;
  return scanLog.filter((e) => e.action === 'REMOVE' && e.reason === key && e.bag).map((e) => e.bag);
}
function nbSubSum() {
  const hw = parseDecimal(document.getElementById('nb-hw').value) || 0,
    wb = parseDecimal(document.getElementById('nb-wb').value) || 0,
    s = hw + wb;
  document.getElementById('nb-subsum').textContent =
    hw || wb ? 'Total: ' + s + '%' + (s !== 100 ? ' — should add up to 100%' : '') : '';
  // Mirror the composition into the collapsed summary. Empty inputs read as 0
  // and deduct nothing, which is invisible with the section closed — so say so
  // there rather than letting the placeholders imply a value is set.
  const head = document.getElementById('nb-sub-head');
  if (head) {
    const coir = parseDecimal((document.getElementById('nb-coir') || {}).value) || 0;
    const rh = parseDecimal((document.getElementById('nb-rh') || {}).value) || 0;
    if (coir) head.textContent = '— CVG ' + coir + '%' + (rh ? ' @ ' + rh + '% RH' : '');
    else if (hw || wb) head.textContent = '— ' + hw + '/' + wb + (rh ? ' @ ' + rh + '% RH' : '');
    else head.textContent = '— ' + t('batch.noDeduction');
  }
  nbPreview();
}
// Remember the reusable new-batch inputs across batches and reloads, so a
// Charge opens with the same bag count / incubation days / weight / substrate
// mix instead of retyping them. Strain, culture and notes are intentionally
// NOT remembered — they are per-batch decisions and a stale strain carried
// over would be a silent mislabel.
let _nbDefaultsApplied = false;
function nbSaveDefaults() {
  try {
    const g = (id) => (document.getElementById(id) || {}).value;
    localStorage.setItem(
      'mp-nb-defaults',
      JSON.stringify({
        qty: g('nb-qty'),
        days: g('nb-days'),
        weight: g('nb-weight'),
        hw: g('nb-hw'),
        wb: g('nb-wb'),
        coir: g('nb-coir'),
        rh: g('nb-rh'),
        grainkg: g('nb-grainkg'),
        grainrh: g('nb-grainrh'),
        gyp: !!(document.getElementById('nb-gyp') || {}).checked
      })
    );
  } catch (e) {
    /* storage disabled — nothing persisted, form just keeps HTML defaults */
  }
}
// Strip keys whose stored value is empty/null so they fall through to the seed
// below rather than blanking a field that has a sensible default.
function _dropEmpty(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  });
  return out;
}
function nbApplyDefaults() {
  let d = null;
  try {
    d = JSON.parse(localStorage.getItem('mp-nb-defaults') || 'null');
  } catch (e) {
    d = null;
  }
  // The composition inputs carry only placeholders, never a value attribute, so
  // an untouched form reads as 0/0 — and createBatch treats "no composition" as
  // "consumes no material" and silently deducts nothing. Seed them from the
  // configured average composition so a fresh device (or a cleared storage)
  // starts from the real recipe instead of blank. Saved values still win; the
  // seed only fills what is missing or was stored empty.
  const _avg = getAvgComp();
  const seeded = { hw: _avg.hwPct, wb: _avg.wbPct, rh: _avg.rhPct, grainrh: _avg.grainRhPct };
  d = d ? Object.assign(seeded, _dropEmpty(d)) : seeded;
  const put = (id, v) => {
    if (v === undefined || v === null || v === '') return;
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  put('nb-qty', d.qty);
  put('nb-days', d.days);
  put('nb-weight', d.weight);
  put('nb-hw', d.hw);
  put('nb-wb', d.wb);
  put('nb-coir', d.coir);
  put('nb-rh', d.rh);
  put('nb-grainkg', d.grainkg);
  put('nb-grainrh', d.grainrh);
  const gyp = document.getElementById('nb-gyp');
  if (gyp) gyp.checked = !!d.gyp;
  renderNbGrainBanner();
  nbSubSum(); // also refreshes the material preview
}
function createBatch() {
  const strainSel = document.getElementById('nb-strain-sel');
  const strainId = strainSel ? parseInt(strainSel.value) || null : null;
  const ms = strainId ? mushroomStrains.find((x) => x.id === strainId) : null;
  if (!strainId || !ms) {
    if (!mushroomStrains.length) {
      confirm2(t('strains.noStrainsHint'), '', t('strains.createNow'), goCreateStrain);
    } else {
      alert(t('strains.noStrainsHint'));
    }
    return;
  }
  const sp = ms.name + ' (' + ms.kuerzel + ')';
  const strainText = (document.getElementById('nb-strain-text') || {}).value?.trim() || '';
  const st = strainText || 'XXX';
  const qty = parseInt(document.getElementById('nb-qty').value) || 0,
    days = parseInt(document.getElementById('nb-days').value) || 14;
  const bagKg = parseDecimal(document.getElementById('nb-weight').value) || 0;
  if (qty < 1) {
    alert(t('batch.fillQty'));
    return;
  }
  if (!bagKg) {
    alert(t('batch.enterWeight'));
    return;
  }
  const hw = parseDecimal(document.getElementById('nb-hw').value) || 0,
    wb = parseDecimal(document.getElementById('nb-wb').value) || 0;
  // All-in-One / CVG fields (0 for plain holz+kleie blocks → no effect).
  const coir = parseDecimal((document.getElementById('nb-coir') || {}).value) || 0;
  const grainKg = parseDecimal((document.getElementById('nb-grainkg') || {}).value) || 0;
  const grainRh = parseDecimal((document.getElementById('nb-grainrh') || {}).value) || 0;
  // I-19: substrate must total exactly 100% (within rounding). Previously the
  // check only fired on > 100; a 70/20 split silently consumed 90% of the dry
  // mass and the remaining 10% went unaccounted. Now we reject any drift in
  // either direction. Skip when both fields are zero (no substrate composition,
  // e.g. grain-spawn batches or batches that opt out of detailed tracking).
  // coir counts toward the same 100%. It is deducted alongside hardwood and
  // wheatbran below, but was left out of this sum — and nb-coir persists across
  // batches (nbSaveDefaults/nbApplyDefaults, and createBatch keeps the fields
  // populated after submit). So after one CVG batch left coir at 100, entering a
  // normal 70/30 block passed the check and then deducted 70% hardwood + 30%
  // wheatbran + 100% coir: 222 kg of raw material booked against 111 kg of actual
  // dry substrate. The mirror case (0/0/50) skipped the check entirely and
  // under-deducted by half.
  const subTotal = hw + wb + coir;
  if ((hw || wb || coir) && Math.abs(subTotal - 100) > 0.01) {
    alert(t('batch.substrateExceeds', { sum: subTotal }));
    return;
  }
  // Nothing to deduct at all: the substrate block below is skipped and the batch
  // consumes no material on paper. That is a legitimate choice for batches that
  // opt out of material tracking, but it used to be indistinguishable from an
  // untouched form — the inputs only carry placeholders, so a collapsed
  // "Substrat" section read as 70/30 while actually submitting 0/0, and stock
  // drifted with no signal. Make the no-op explicit instead of silent.
  if (!hw && !wb && !coir && !grainKg && !window.confirm(t('batch.noSubstrateWarn'))) return;
  const substrate =
    hw || wb || coir
      ? {
          hardwood: hw,
          wheatbran: wb,
          coir,
          rh: parseDecimal(document.getElementById('nb-rh').value) || null,
          gypsum: document.getElementById('nb-gyp').checked
        }
      : null;
  // Pre-flight inventory check — warn before silently draining substrate.
  // The deduction code below uses Math.max(0, stock - used), which means an
  // over-commit silently clamps to zero with no signal to the worker. They
  // walk away thinking everything's fine, then run out mid-week. Prompt
  // first so they can either top up before submitting or knowingly proceed.
  {
    const _rhPct = (substrate && substrate.rh) || 0;
    const _dryKg = mtDryKg(bagKg, _rhPct);
    const _hwUsed = qty * _dryKg * (hw / 100);
    const _wbUsed = qty * _dryKg * (wb / 100);
    const _coirUsed = qty * _dryKg * (coir / 100);
    const _gypUsed = substrate && substrate.gypsum ? qty * _dryKg * 0.01 : 0;
    const _grainUsed = grainKg > 0 ? qty * mtDryKg(grainKg, grainRh) : 0;
    const _stock = inventory.stock || {};
    const _shortages = [];
    if (_hwUsed > (_stock.hardwood || 0))
      _shortages.push(
        'Hardwood: ' + (_stock.hardwood || 0).toFixed(1) + ' kg vorhanden, ' + _hwUsed.toFixed(1) + ' kg nötig'
      );
    if (_wbUsed > (_stock.wheatbran || 0))
      _shortages.push(
        'Wheat bran: ' + (_stock.wheatbran || 0).toFixed(1) + ' kg vorhanden, ' + _wbUsed.toFixed(1) + ' kg nötig'
      );
    if (_coirUsed > (_stock.coir || 0))
      _shortages.push(
        'Kokos/CVG: ' + (_stock.coir || 0).toFixed(1) + ' kg vorhanden, ' + _coirUsed.toFixed(1) + ' kg nötig'
      );
    if (_gypUsed > (_stock.gypsum || 0))
      _shortages.push(
        'Gypsum: ' + (_stock.gypsum || 0).toFixed(1) + ' kg vorhanden, ' + _gypUsed.toFixed(1) + ' kg nötig'
      );
    if (_grainUsed > (_stock.grain || 0))
      _shortages.push(
        'Grain: ' + (_stock.grain || 0).toFixed(1) + ' kg vorhanden, ' + _grainUsed.toFixed(1) + ' kg nötig'
      );
    if (
      _shortages.length &&
      !window.confirm(t('inv.shortageWarn') + '\n\n' + _shortages.join('\n') + '\n\n' + t('inv.shortageProceed'))
    ) {
      return;
    }
  }
  const batchId = genBatchId(ms.name);
  spColor(ms.name);
  const due = new Date();
  due.setDate(due.getDate() + days);
  const bags = Array.from({ length: qty }, (_, i) => batchId + '-' + String(i + 1).padStart(2, '0'));
  const batchType = 'block';
  batches.push({
    batchId,
    species: sp,
    strain: st,
    strainId,
    strainName: ms.name,
    strainKuerzel: ms.kuerzel,
    qty,
    days,
    substrate,
    bagKg,
    batchType,
    grainKg,
    grainRh,
    sourceId: inocCultureId() || document.getElementById('nb-culture').value || null,
    notes: document.getElementById('nb-notes').value.trim(),
    strainText,
    created: new Date().toISOString(),
    due: due.toISOString(),
    bags
  });

  // Compute inventory deltas up front so they can travel with the POST and be
  // applied atomically on the server (I-02).
  if (!inventory.stock) inventory.stock = { hardwood: 0, wheatbran: 0, gypsum: 0, grain: 0, coir: 0 };
  const deltas = [];
  const stockSnapshot = { ...inventory.stock };
  if (substrate) {
    const rh = parseDecimal(document.getElementById('nb-rh').value) || 0;
    const dryKgPerBag = mtDryKg(bagKg, rh);
    const hwUsed = qty * dryKgPerBag * (hw / 100);
    const wbUsed = qty * dryKgPerBag * (wb / 100);
    const coirUsed = qty * dryKgPerBag * (coir / 100);
    if (hwUsed > 0) {
      inventory.stock.hardwood = Math.max(0, inventory.stock.hardwood - hwUsed);
      deltas.push({ mat: 'hardwood', deltaKg: -hwUsed, type: 'batch', ref: batchId });
    }
    if (wbUsed > 0) {
      inventory.stock.wheatbran = Math.max(0, inventory.stock.wheatbran - wbUsed);
      deltas.push({ mat: 'wheatbran', deltaKg: -wbUsed, type: 'batch', ref: batchId });
    }
    if (coirUsed > 0) {
      inventory.stock.coir = Math.max(0, (inventory.stock.coir || 0) - coirUsed);
      deltas.push({ mat: 'coir', deltaKg: -coirUsed, type: 'batch', ref: batchId });
    }
    if (substrate.gypsum) {
      const gypUsed = qty * dryKgPerBag * 0.01;
      inventory.stock.gypsum = Math.max(0, inventory.stock.gypsum - gypUsed);
      deltas.push({ mat: 'gypsum', deltaKg: -gypUsed, type: 'batch', ref: batchId });
    }
  }
  // All-in-One raw-grain portion mixed into the block (independent of substrate).
  if (grainKg > 0) {
    const grainUsed = qty * mtDryKg(grainKg, grainRh);
    if (grainUsed > 0) {
      inventory.stock.grain = Math.max(0, (inventory.stock.grain || 0) - grainUsed);
      deltas.push({ mat: 'grain', deltaKg: -grainUsed, type: 'batch', ref: batchId });
    }
  }

  // Save batch + inventory deltas atomically on the server
  const batchObj = batches[batches.length - 1];
  // Snapshot the grain bags now: the form is cleared below, well before the POST
  // resolves, and they are only written off once the batch is known to be saved.
  let _inocUsed = _inoc.slice();
  const createBtn = document.getElementById('btn-24');
  if (createBtn) createBtn.disabled = true;
  apiPost('/api/batches', { ...batchObj, deltas })
    .then((r) => {
      if (r && r.error) {
        // Rollback local state so UI reflects server truth (e.g. duplicate batchId)
        const i = batches.findIndex((b) => b.batchId === batchObj.batchId);
        if (i >= 0) batches.splice(i, 1);
        // Roll back the optimistic stock mutation too — server didn't apply the deltas.
        inventory.stock = stockSnapshot;
        alert(t('batch.saveFailed') + r.error);
        renderBatches();
        renderStatus();
        return;
      }
      // Register new barcode numbers from server response
      if (r && r.bagBarcodes) {
        for (const [id, bc] of Object.entries(r.bagBarcodes)) {
          barcodeRegistry.set(bc, { type: 'bag', id });
          barcodeByEntity.set('bag:' + id, bc);
        }
      }
      // Grain bag (G2G/GS) is fully consumed by one inoculation — mark it used
      if (batchObj.sourceId) {
        const src = cultures.find((c) => c.id === batchObj.sourceId);
        if (src && (src.type === 'G2G' || src.type === 'GS') && src.status !== 'used') {
          setCultureStatus(src.id, 'used');
        }
      }
      // Same idea for real grain-spawn bags, which are batches rather than
      // cultures. Only after the batch is known to have saved — writing the bags
      // off first would strip spawn inventory for a batch that then failed.
      inocAskConsume(batchObj, _inocUsed);
      _inocUsed = [];
      renderBatches();
      renderStatus();
    })
    .finally(() => {
      if (createBtn) createBtn.disabled = false;
    });
  nbSaveDefaults();
  if (document.getElementById('nb-strain-sel')) document.getElementById('nb-strain-sel').value = '';
  const nbStrainTextEl = document.getElementById('nb-strain-text');
  if (nbStrainTextEl) nbStrainTextEl.value = '';
  const nbCultureEl = document.getElementById('nb-culture');
  if (nbCultureEl) nbCultureEl.value = '';
  _inoc = [];
  inocRender('nb');
  renderNbGrainBanner();
  // qty/days/weight/substrate intentionally kept (persisted via nbSaveDefaults
  // above) so the next batch reuses them; only per-batch fields are cleared.
  document.getElementById('nb-notes').value = '';
  document.getElementById('nb-mat-preview').style.display = 'none';
  nbPreview();
  updateTodoBadge();
  // Show zone picker — required before print
  openZonePickModal(batchObj, bags, function () {
    document.getElementById('nb-bags').innerHTML = bags
      .map(
        (b) =>
          `<span style="font-size:10px;font-family:monospace;background:var(--c-bg);padding:2px 6px;border-radius:4px;color:var(--c-text-sec)">${esc(b)}</span>`
      )
      .join('');
    const _res = document.getElementById('nb-result');
    _res.dataset.batchId = batchObj.batchId;
    _res.style.display = 'block';
    _res.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}
// Print all labels for the just-created batch straight from the success panel,
// so the common "create → print everything" path skips the hop to the Print
// page. Uses the current default label mode + QR from the Print controls; the
// "Druckoptionen…" button still opens the full Print page for ranges/formats.
// Falls back to a ZPL download (same as printBagLabels) when the printer is
// unreachable.
async function printBatchLabelsInline() {
  const res = document.getElementById('nb-result');
  const id = res ? res.dataset.batchId : null;
  const b = batches.find((x) => x.batchId === id) || batches[batches.length - 1];
  if (!b) {
    alert(t('print.selectBatchFirst'));
    return;
  }
  const modeEl = document.getElementById('print-mode');
  const qrEl = document.getElementById('bag-qr');
  const zpl = makeBagZPL(b.bags, b, modeEl ? modeEl.value : 'full', qrEl ? qrEl.checked : true);
  if (!zpl || !zpl.includes('^XA')) {
    alert(t('print.noLabels'));
    return;
  }
  const err = await sendToPrinter(zpl);
  if (err) {
    const blob = new Blob([zpl], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = b.batchId + '_labels.zpl';
    a.click();
  } else {
    setFb('ok', t('print.printedBatch', { n: b.bags.length, id: b.batchId }));
  }
}
function goToPrintBatch() {
  go('print', 'n-print');
  setTimeout(() => {
    openStab('print', 'bags');
    document.getElementById('print-batch-search').value = '';
    fillBatchSelect('');
    const s = document.getElementById('print-batch'),
      last = batches[batches.length - 1];
    if (last) {
      s.value = last.batchId;
      renderBagPreview();
    }
  }, 100);
}
// Move a specific set of bags in a batch to a destination zone/rack.
// Skips bags that are unplaced, removed, or already at the destination.
// Calls back with (movedCount, skippedCount) when done.
// Persist a batch of scan entries, retrying once after 3s on server error.
// Every entry carries a stable client_uuid and the server upserts on the unique
// index, so replaying the POST is safe. opts.zoneCheck === false skips the I-12
// optimistic-concurrency handling for ADD, which has no expected zone and can
// never 409. Extracted because moveBagsTo, addBagsToLocation and locMoveTo each
// carried their own copy of this block — the drift between those copies is what
// let the grain path lose its inventory rollback.
function postScanEntries(entries, opts) {
  const zoneCheck = !(opts && opts.zoneCheck === false);
  const settle = (r, isRetry) => {
    if (zoneCheck && handleZoneMismatch(r, entries)) return;
    if (r && r.ids) {
      entries.forEach((e, i) => setEntryServerId(e, r.ids[i]));
      return;
    }
    // The service worker queued this offline: HTTP 200 {ok:true, queued:true},
    // no ids and no error. Without this branch settle() fell through both arms,
    // no _serverId ever arrived, and an undo could only set _undoPending — which
    // setEntryServerId is the sole consumer of, so the DELETE never fired. The
    // scan replayed on reconnect and the "undone" entry came back on the next
    // poll. Mark it so the undo path can pull it out of the queue instead.
    if (r && r.queued) {
      entries.forEach((e) => (e._queued = true));
      return;
    }
    if (r && r.error) {
      if (isRetry) {
        setFb('err', 'Scan gespeichert lokal, Server-Sync fehlgeschlagen: ' + r.error);
        return;
      }
      console.warn('Scan log POST failed, retrying:', r.error);
      setTimeout(function () {
        apiPost('/api/scan-log', { entries }).then((r2) => settle(r2, true));
      }, 3000);
    }
  };
  apiPost('/api/scan-log', { entries }).then((r) => settle(r, false));
}
// bag → its last placement-relevant entry (ADD / MOVE / REMOVE). Built once per
// caller: the previous shape reverse-copied the entire scan log for every bag,
// so placing a 20-bag batch against a long log did 20 full array copies.
function buildLastPlacementByBag() {
  const m = new Map();
  for (const e of scanLog) {
    if (e.action !== 'ADD' && e.action !== 'MOVE' && e.action !== 'REMOVE') continue;
    const k = (e.bag || '').toUpperCase();
    if (k) m.set(k, e);
  }
  return m;
}
function moveBagsTo(batch, bagIds, dest, cb) {
  rememberDest(dest);
  const now = new Date().toISOString();
  const entries = [];
  let skipped = 0;
  const lastPlacement = buildLastPlacementByBag();
  bagIds.forEach((bagId) => {
    const bagLast = lastPlacement.get(bagId.toUpperCase());
    if (!bagLast || bagLast.action === 'REMOVE') return;
    const curLoc = bagLast.to || null;
    if (curLoc && curLoc.toUpperCase() === dest.toUpperCase()) {
      skipped++;
      return;
    }
    const tempId = 's' + ++_scanTempIdCounter;
    const entry = {
      time: now,
      action: 'MOVE',
      batch: batch.batchId,
      bag: bagId,
      from: curLoc,
      to: dest,
      species: batch.species,
      strain: batch.strain,
      user: currentUser?.username || null,
      client_uuid: newScanUuid(),
      // I-12: optimistic concurrency snapshot for offline-queue replays.
      expected_current_zone: curLoc ? toZone(curLoc) : null,
      _tempId: tempId
    };
    scanLog.push(entry);
    movements.push(entry);
    entries.push(entry);
    if (!sessionStartTime) sessionStartTime = Date.now();
    sessionEntries.push(entry);
  });
  if (!entries.length) {
    if (cb) cb(0, skipped);
    return;
  }
  if (scanChannel)
    entries.forEach((e) =>
      scanChannel.postMessage({ type: 'scan-entry', entry: { bag: e.bag, batch: e.batch, action: e.action, to: e.to } })
    );
  postScanEntries(entries); // I-12 zone check applies: these are MOVEs
  if (cb) cb(entries.length, skipped);
}

// Move all active bags in a batch to a destination zone/rack.
// Shared by the scan engine (MOVE_BATCH action) and the batch list dropdown.
// Bags that were never placed (no ADD/MOVE/REMOVE in the log) are ADDed at the
// destination instead of being skipped. Without this a batch whose placement
// picker was dismissed had no scan entries at all, so every move path reported
// "no bags to move" and the batch could not be recovered from the UI at all.
// Placing them here is also what the worker means: a whole-batch move to a zone
// says "this batch is now there", however it got created.
function moveBatchTo(batch, dest, cb) {
  const lastPlacement = buildLastPlacementByBag();
  const unplaced = (batch.bags || []).filter((id) => !lastPlacement.get(id.toUpperCase()));
  if (!unplaced.length) return moveBagsTo(batch, batch.bags, dest, cb);
  const placed = (batch.bags || []).filter((id) => lastPlacement.get(id.toUpperCase()));
  addBagsToLocation(batch, unplaced, dest, function (added) {
    if (!placed.length) {
      if (cb) cb(added, 0);
      return;
    }
    moveBagsTo(batch, placed, dest, function (moved, skipped) {
      if (cb) cb(added + moved, skipped);
    });
  });
}

// Add all bags in bagIds to a location (initial placement — ADD action, from=null).
function addBagsToLocation(batch, bagIds, dest, cb) {
  const now = new Date().toISOString();
  const entries = [];
  bagIds.forEach((bagId) => {
    const tempId = 's' + ++_scanTempIdCounter;
    const entry = {
      time: now,
      action: 'ADD',
      batch: batch.batchId,
      bag: bagId,
      from: null,
      to: dest,
      species: batch.species,
      strain: batch.strain,
      user: currentUser?.username || null,
      client_uuid: newScanUuid(),
      _tempId: tempId
    };
    scanLog.push(entry);
    movements.push(entry);
    entries.push(entry);
    if (!sessionStartTime) sessionStartTime = Date.now();
    sessionEntries.push(entry);
  });
  if (!entries.length) {
    if (cb) cb(0);
    return;
  }
  if (scanChannel)
    entries.forEach((e) =>
      scanChannel.postMessage({ type: 'scan-entry', entry: { bag: e.bag, batch: e.batch, action: e.action, to: e.to } })
    );
  // ADD never triggers a zone_mismatch (from=null), so no 409 handling here.
  postScanEntries(entries, { zoneCheck: false });
  if (cb) cb(entries.length);
}

// Zone picker modal — shown after batch creation, user must pick a destination.
// onDone() is called after a zone is picked so the caller can show print panel.
// After batch creation: pick where the new bags go. Delegates to the shared
// zone picker so placement uses the exact same flat zone/rack list as moving,
// with placement (ADD) history as the shortcut row (new batches nearly always
// go to Inkubation). Replaces the old bespoke zone-buttons + rack-dropdown UI;
// the m-zone-pick modal is now unused.
function openZonePickModal(batch, bags, onDone) {
  _openZonePicker(
    t('batch.whereGoInfo', { id: batch.batchId, n: bags.length }),
    function (dest) {
      addBagsToLocation(batch, bags, dest, function (added) {
        setFb('ok', batch.batchId + ': ' + added + ' Bags \u2192 ' + zoneDisplayName(dest), { noModal: true });
        updateSD();
        renderBatches();
        renderStatus();
      });
      if (onDone) onDone();
    },
    { recentOpts: { actions: ['ADD'], lastKey: null }, mandatory: true }
  );
}

// True while the zone picker is up as a mandatory placement gate — the cancel
// button, backdrop click and Escape key all consult this before dismissing.
function _zpMandatory() {
  const m = document.getElementById('m-move-batch');
  return !!(m && m.classList.contains('open') && m.dataset.mandatory === '1');
}
// Render zone/rack picker inside the m-move-batch modal.
// title: string shown at the top; onPick(destId): called when a zone or rack is chosen.
function _openZonePicker(title, onPick, opts) {
  opts = opts || {};
  const m = document.getElementById('m-move-batch');
  if (!m) return;
  // opts.mandatory: this picker is a gate, not an option — used for placing a
  // freshly created batch, where dismissing left the batch with no scan entry
  // at all. Such a batch is EMPTY for getStatus, hidden from the dashboard, and
  // its bags are skipped by every move path, so it could not be recovered from
  // the UI. Suppress all three dismiss routes (cancel button, backdrop, Escape)
  // while it is up; _zpMandatory() is what the handlers consult.
  // Never gate when there is nothing to pick — with no zones configured the
  // worker would be locked into a modal with no way out.
  const mandatory = !!opts.mandatory && zones.length > 0;
  m.dataset.mandatory = mandatory ? '1' : '';
  const cancelBtn = document.getElementById('mb-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = mandatory ? 'none' : '';
  // Close + hand the destination to the caller. Clears the gate flag first so a
  // later non-mandatory picker is dismissible again.
  const pick = (dest) => {
    m.dataset.mandatory = '';
    m.classList.remove('open');
    onPick(dest);
  };
  document.getElementById('mb-title').textContent = title;
  const container = document.getElementById('mb-zones');
  container.innerHTML = '';
  // Shortcut row: most-recent destinations first, one tap each. moveBagsTo
  // already skips bags that are already at the chosen destination. The
  // placement caller passes recentOpts to surface ADD (placement) history.
  // opts.excludeLocs: destinations to drop from the shortcut row — the caller's
  // bags are already there, so offering them as a one-tap would be a no-op move.
  const _recents = recentDestinations(4, opts.recentOpts).filter(
    (loc) => !(opts.excludeLocs && opts.excludeLocs.has(loc))
  );
  if (_recents.length) {
    const hdr = document.createElement('div');
    hdr.style.cssText =
      'font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:.05em;padding:4px 10px 2px';
    hdr.textContent = t('dash.recentDests');
    container.appendChild(hdr);
    _recents.forEach((loc) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText =
        'display:block;width:100%;text-align:left;background:var(--c-bg);border:0;padding:8px 10px;font:inherit;cursor:pointer;font-size:13px;font-weight:600;border-radius:6px;margin-bottom:2px;border-left:3px solid ' +
        ((ZONE_BY_ID[toZone(loc)] && ZONE_BY_ID[toZone(loc)].color) || '#888');
      row.textContent = '★ ' + zoneDisplayName(loc);
      row.addEventListener('click', () => pick(loc));
      container.appendChild(row);
    });
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:var(--c-border);margin:6px 0';
    container.appendChild(sep);
  }
  if (!zones.length) {
    container.innerHTML =
      '<div style="padding:8px 0;color:var(--c-text-muted);font-style:italic">' +
      esc(t('batch.noLocations')) +
      '</div>';
  } else {
    zones.forEach((z) => {
      const zRow = document.createElement('button');
      zRow.type = 'button';
      zRow.style.cssText =
        'display:block;width:100%;text-align:left;background:none;border:0;padding:8px 10px;font:inherit;cursor:pointer;font-size:13px;font-weight:600;border-radius:6px;border-left:3px solid ' +
        (z.color || '#888');
      zRow.textContent = z.name || z.id;
      zRow.addEventListener('mouseenter', () => {
        zRow.style.background = 'var(--c-bg)';
      });
      zRow.addEventListener('mouseleave', () => {
        zRow.style.background = 'none';
      });
      zRow.addEventListener('click', () => pick(z.id));
      container.appendChild(zRow);
      (z.racks || []).forEach((r) => {
        const rRow = document.createElement('button');
        rRow.type = 'button';
        rRow.style.cssText =
          'display:block;width:100%;text-align:left;background:none;border:0;padding:5px 10px 5px 22px;font:inherit;cursor:pointer;font-size:12px;font-family:monospace;border-radius:6px;color:var(--c-text-sec)';
        rRow.textContent = r.id.slice(z.id.length + 1) || r.id;
        rRow.title = r.id;
        rRow.addEventListener('mouseenter', () => {
          rRow.style.background = 'var(--c-bg)';
        });
        rRow.addEventListener('mouseleave', () => {
          rRow.style.background = 'none';
        });
        rRow.addEventListener('click', () => pick(r.id));
        container.appendChild(rRow);
      });
    });
  }
  m.classList.add('open');
}

// Move-batch modal — select destination for an entire batch from Alle Chargen.
function openMoveBatchModal(batchId) {
  const b = batches.find((x) => x.batchId === batchId);
  if (!b) return;
  _openZonePicker(t('batch.moveMenuTitle', { id: batchId }), function (dest) {
    const snap = _snapshotBeforeMove([b], dest, buildLastScanByBag());
    moveBatchTo(b, dest, function (moved, skipped) {
      if (!moved) {
        if (skipped > 0) {
          setFb('ok', t('batch.allAlreadyAt', { n: skipped, loc: zoneDisplayName(dest) }));
        } else {
          setFb('err', t('batch.noBagsToMove'));
        }
        return;
      }
      setFb(
        'ok',
        b.batchId +
          ': ' +
          moved +
          ' Bags \u2192 ' +
          zoneDisplayName(dest) +
          (skipped ? ' (' + skipped + ' \u00fcbersprungen)' : '')
      );
      updateSD();
      renderBatches();
      renderStatus();
      renderDashBatchTasks();
      // Same one-tap reversal the \u2192 Fruchtung buttons offer. Skipped when the
      // snapshot is empty (nothing had a prior location to restore).
      if (snap.length) showUndoBar(b.batchId + ': ' + moved + ' \u2192 ' + zoneDisplayName(dest), () => _undoMove(snap));
    });
  });
}

// Persisted so a chosen column/direction survives a reload instead of
// resetting every time the batches (or cultures) list is reopened.
// Every sortable table, and the tbody its rows land in. Adding a table here plus
// data-sort on its headers is the whole job — the click wiring, the arrows and
// the persistence are shared rather than copied per table, which is how batches
// and cultures ended up with two near-identical listeners.
const SORT_TABLES = { batches: 'batches-body', cultures: 'cultures-body', harvests: 'harvest-body', grain: 'grain-body' };
const tableSort = (() => {
  const empty = {};
  for (const k in SORT_TABLES) empty[k] = null;
  try {
    const s = JSON.parse(localStorage.getItem('mp-table-sort') || 'null');
    // Keep whatever was stored for a table still known; ignore the rest, so a
    // renamed or removed table cannot resurrect a sort nothing can clear.
    if (s && typeof s === 'object') for (const k in SORT_TABLES) empty[k] = s[k] || null;
  } catch (e) {
    /* storage disabled — fall back to no saved sort */
  }
  return empty;
})();
function sortCmp(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}
function applyTableSort(rows, state, keyFn) {
  if (!state) return rows;
  const sign = state.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => sign * sortCmp(keyFn(a, state.key), keyFn(b, state.key)));
}
function cycleTableSort(table, key) {
  const cur = tableSort[table];
  tableSort[table] = !cur || cur.key !== key ? { key, dir: 'asc' } : cur.dir === 'asc' ? { key, dir: 'desc' } : null;
  try {
    localStorage.setItem('mp-table-sort', JSON.stringify(tableSort));
  } catch (e) {
    /* storage disabled — sort still works for this session */
  }
}
function updateSortIndicators(table, activeState) {
  // Was a two-way ternary, so any third table silently got the cultures header
  // row and wrote its arrows into the wrong table.
  const bodyId = SORT_TABLES[table];
  if (!bodyId) return;
  const body = document.getElementById(bodyId);
  if (!body) return;
  const thead = body.closest('table').tHead;
  if (!thead) return;
  thead.querySelectorAll('th[data-sort]').forEach((th) => {
    const active = activeState && activeState.key === th.dataset.sort;
    th.classList.toggle('active', !!active);
    let arrow = th.querySelector('.arrow');
    if (!arrow) {
      arrow = document.createElement('span');
      arrow.className = 'arrow';
      th.appendChild(arrow);
    }
    arrow.textContent = active ? (activeState.dir === 'asc' ? ' \u25B2' : ' \u25BC') : ' \u21C5';
  });
}
// Guard renderBatches against unnecessary work. The dashboard polls
// /api/data on every SSE event and re-runs renderBatches each time;
// without this, a 200-batch table got fully regenerated (~80 ms on
// low-end Android per the audit) even when nothing visible changed.
// The fingerprint covers every input the row HTML depends on: filter
// state, sort state, language, and per-batch fields (incl. the scan-
// log-derived status). When it matches the last render, we skip the
// rebuild entirely.
let _rbLastRenderFp = null;
// Archived = terminal/wrapped-up states. CONTAM lands here once bags are moved
// to the contam zone (worker has acted; resolution is tracked in Contamination
// reports). DONE/EMPTY = no active bags left. Pipeline KPIs still count these
// — only the Batches list view filters them out by default.
const ARCHIVED_STATUSES = ['DONE', 'EMPTY', 'CONTAM'];
const isArchivedStatus = (s) => ARCHIVED_STATUSES.includes(s);

// The batch list was one flat run of every row in due-date order, which is fine
// for finding a known id and useless for "how much is in incubation". Grouped by
// stage it reads like the pipeline strip above it, and a stage you are not
// working on folds away.
const BATCH_GROUP_ORDER = ['SPAWN RUN', 'INCUBATING', 'FRUITING', '__archived'];
const BATCH_GROUP_LABEL = {
  'SPAWN RUN': 'stage.spawn',
  INCUBATING: 'stage.incubation',
  FRUITING: 'stage.fruiting',
  __archived: 'batch.filterArchived'
};
// Collapsed state per group. Archived starts closed — it is history, and on this
// farm it is a third of the rows; everything else starts open.
const _batchGroupClosed = { __archived: true };
function toggleBatchGroup(key) {
  _batchGroupClosed[key] = !_batchGroupClosed[key];
  renderBatches();
}
function _batchGroupKey(status) {
  return isArchivedStatus(status) ? '__archived' : status;
}
function _groupBatchRows(rows) {
  if (!rows.length) return '';
  const groups = {};
  for (const r of rows) (groups[_batchGroupKey(r.status)] = groups[_batchGroupKey(r.status)] || []).push(r);
  // Known stages in pipeline order, then anything unexpected rather than
  // dropping it — a row nobody planned for must still be reachable.
  const keys = BATCH_GROUP_ORDER.filter((k) => groups[k]).concat(
    Object.keys(groups).filter((k) => !BATCH_GROUP_ORDER.includes(k))
  );
  let out = '';
  for (const k of keys) {
    const closed = !!_batchGroupClosed[k];
    const label = BATCH_GROUP_LABEL[k] ? t(BATCH_GROUP_LABEL[k]) : k;
    out +=
      '<tr class="batch-group-row"><td colspan="12" style="padding:0;background:var(--c-bg)">' +
      '<button type="button" data-action="batch-group" data-key="' +
      esc(k) +
      '" aria-expanded="' +
      !closed +
      '" style="width:100%;text-align:left;border:0;background:none;padding:6px 8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;color:var(--c-text-sec);display:flex;align-items:center;gap:6px">' +
      '<span style="font-size:10px">' +
      (closed ? '▸' : '▾') +
      '</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      esc(label) +
      '</span><span style="color:var(--c-text-muted);font-weight:400">' +
      groups[k].length +
      '</span></button></td></tr>';
    if (!closed) for (const r of groups[k]) out += r.html;
  }
  return out;
}

// One row of the batch table. Extracted from renderBatches so the grain list
// in Labor renders identical rows rather than a divergent copy — and so this
// template can be edited without splicing into the middle of a 3,000-character
// literal, which is how it got corrupted once before.
function batchRowHtml(b) {
      const { status } = getStatus(b.batchId);
      const sub = b.substrate
        ? [
            `<span class="sub-tag">HW ${b.substrate.hardwood}% WB ${b.substrate.wheatbran}%</span>`,
            b.substrate.rh ? `<span class="sub-tag">RH ${b.substrate.rh}%</span>` : '',
            b.substrate.gypsum
              ? `<span class="sub-tag" style="background:var(--c-primary-light);color:var(--c-green-dark)">Gypsum</span>`
              : ''
          ].join('')
        : '<span style="color:#ccc;font-size:11px">—</span>';
      // Source is two things now: the culture on the batch row, and any grain
      // bags written off for it (recorded in the scan log, not on the batch).
      const _spawn = spawnSourceFor(b.batchId);
      const _srcParts = [];
      if (b.sourceId)
        _srcParts.push(`<span style="font-family:monospace;font-size:10px;color:var(--c-purple-dark)">${esc(b.sourceId)}</span>`);
      if (_spawn.length)
        _srcParts.push(
          `<span style="font-family:monospace;font-size:10px;color:var(--c-text-sec)" title="${esc(_spawn.join(', '))}">${esc(_spawn[0])}${_spawn.length > 1 ? ' +' + (_spawn.length - 1) : ''}</span>`
        );
      const src = _srcParts.length
        ? _srcParts.join('<br>')
        : '<span style="color:#ccc;font-size:11px">—</span>';
      const note = b.notes
        ? `<span style="font-size:11px;color:var(--c-text-sec);cursor:pointer" data-action="open-note" data-batch="${esc(b.batchId)}">${esc(b.notes.length > 22 ? b.notes.slice(0, 22) + '\u2026' : b.notes)}</span>`
        : `<span style="font-size:11px;color:#bbb;cursor:pointer;font-style:italic" data-action="open-note" data-batch="${esc(b.batchId)}">${t('batch.addNote')}</span>`;
      const bst = (b.strainText || '').trim();
      const strainDisplay = bst ? esc(bst) : !b.strainId && b.strain ? esc(b.strain) : '—';
      const canMove = status !== 'DONE';
      const moveBtn = canMove
        ? `<button class="btn btn-sm" data-action="open-move-modal" data-batch="${esc(b.batchId)}" style="margin-right:3px">&#10554; ${t('batch.moveTo')}</button>`
        : '';
      // data-mlabel attrs are surfaced as ::before labels in the mobile
      // card layout (styles.css "Batches table — mobile card mode").
      return {
        status,
        html: `<tr><td data-mlabel="${esc(t('th.batchId'))}" class="bt-id" style="font-family:monospace;font-size:10px"><span data-action="toggle-bags" data-batch="${esc(b.batchId)}" style="cursor:pointer;user-select:none" id="btog-${esc(b.batchId)}">&#9654;</span> ${esc(b.batchId)}</td><td data-mlabel="${esc(t('th.species'))}" class="bt-species">${spDot(b.species)}${esc(b.species)}</td><td data-mlabel="${esc(t('th.strain'))}">${strainDisplay}</td><td data-mlabel="${esc(t('th.qty'))}">${b.qty}</td><td data-mlabel="${esc(t('th.inc'))}">${b.days}d</td><td data-mlabel="${esc(t('th.substrate'))}">${sub}</td><td data-mlabel="${esc(t('th.source'))}">${src}</td><td data-mlabel="${esc(t('th.created'))}" style="font-size:10px;color:var(--c-text-muted)">${fmtDt(b.created)}</td><td data-mlabel="${esc(t('th.due'))}" style="font-size:10px;color:var(--c-text-muted)">${fmtDt(b.due)}</td><td data-mlabel="${esc(t('th.status'))}" class="bt-status">${sbadge(status)}</td><td data-mlabel="${esc(t('th.notes'))}">${note}</td><td class="bt-actions" style="white-space:nowrap">${moveBtn}<button class="btn btn-sm" data-action="add-bags" data-batch="${esc(b.batchId)}" style="margin-right:3px">${t('batch.addBags')}</button><button class="btn btn-sm btn-r" data-action="del-batch" data-batch="${esc(b.batchId)}">${t('batch.del')}</button></td></tr>`
      };
}

// Grain spawn, listed in Labor. Same rows as the batch table — it is the same
// kind of object — but its own list, because making spawn is lab work and
// mixing 22 jars into 116 blocks made both harder to read.
function renderGrainBatches() {
  const body = document.getElementById('grain-body');
  if (!body) return;
  const q = (document.getElementById('grain-q')?.value || '').toLowerCase();
  const rows = batches.filter((b) => {
    if (b.batchType !== 'grain') return false;
    return (
      !q ||
      b.batchId.toLowerCase().includes(q) ||
      (b.species || '').toLowerCase().includes(q) ||
      (b.strain || '').toLowerCase().includes(q)
    );
  });
  updateSortIndicators('grain', tableSort.grain);
  const sorted = applyTableSort(rows, tableSort.grain, (b, k) => {
    if (k === 'status') return getStatus(b.batchId).status;
    if (k === 'qty') return Number(b.qty) || 0;
    return b[k];
  });
  // Grouped by stage like the batch list, so a jar still colonising and one
  // ready to use are not read as the same thing.
  body.innerHTML =
    _groupBatchRows(sorted.map((b) => batchRowHtml(b))) ||
    '<tr><td colspan="12" class="empty">' + t('dash.noMatches') + '</td></tr>';
}
function renderBatches() {
  const q = (document.getElementById('batch-q').value || '').toLowerCase(),
    body = document.getElementById('batches-body');
  // Archive filter: 'active' (default) hides DONE/EMPTY/CONTAM, 'archived' shows
  // only those, 'all' shows everything. A search query bypasses the filter so
  // direct lookups (incl. goToBatch) always find the batch regardless of state.
  const archiveFilter = document.getElementById('batch-archive-filter')?.value || 'active';
  updateSortIndicators('batches', tableSort.batches);
  renderBatchAttentionBanner();
  if (!batches.length) {
    if (_rbLastRenderFp !== 'no-batches') {
      body.innerHTML = '<tr><td colspan="12" class="empty">' + t('dash.noBatches') + '</td></tr>';
      _rbLastRenderFp = 'no-batches';
    }
    return;
  }
  const filtered = batches.filter((b) => {
    // Grain spawn is lab work, not production — it lives under Labor now, so
    // Chargen shows blocks only and stops being 22 rows of jars mixed in with
    // 116 rows of blocks.
    if (b.batchType === 'grain') return false;
    const matchesQ =
      !q ||
      b.batchId.toLowerCase().includes(q) ||
      (b.species || '').toLowerCase().includes(q) ||
      (b.strain || '').toLowerCase().includes(q) ||
      (b.strainName || '').toLowerCase().includes(q);
    if (!matchesQ) return false;
    if (batchAttentionFilter && !batchAttentionFilter.pred(b)) return false;
    // Skip archive filter when searching — explicit lookup wins over the toggle.
    if (!q && archiveFilter !== 'all') {
      const archived = isArchivedStatus(getStatus(b.batchId).status);
      if (archiveFilter === 'active' && archived) return false;
      if (archiveFilter === 'archived' && !archived) return false;
    }
    return true;
  });
  const sorted = applyTableSort(filtered, tableSort.batches, (b, k) => {
    if (k === 'strain') return (b.strainText || '').trim() || (!b.strainId && b.strain ? b.strain : '');
    if (k === 'status') return getStatus(b.batchId).status;
    if (k === 'qty' || k === 'days') return Number(b[k]) || 0;
    return b[k];
  });
  // Fingerprint: filter state + per-batch fields + status.  /  are
  // unlikely to appear in real data so they're safe field/row separators.
  const renderFp =
    q +
    '|' +
    currentLang +
    '|' +
    archiveFilter +
    '|' +
    // Which stage groups are folded is part of what is on screen — leave it out
    // and the early return below swallows every expand and collapse.
    JSON.stringify(_batchGroupClosed) +
    '|' +
    JSON.stringify(tableSort.batches || null) +
    '|' +
    (batchAttentionFilter ? batchAttentionFilter.label || 'flt' : '') +
    '|' +
    sorted
      .map((b) => {
        const s = getStatus(b.batchId).status;
        const sub = b.substrate
          ? b.substrate.hardwood +
            ',' +
            b.substrate.wheatbran +
            ',' +
            b.substrate.rh +
            ',' +
            (b.substrate.gypsum ? 1 : 0)
          : '';
        return [
          b.batchId,
          b.species,
          b.qty,
          b.days,
          b.notes || '',
          b.due,
          b.created,
          s,
          b.strain || '',
          b.strainId || '',
          b.strainName || '',
          b.strainText || '',
          b.bagKg || '',
          b.batchType || '',
          b.sourceId || '',
          sub
        ].join('');
      })
      .join('');
  if (renderFp === _rbLastRenderFp) return;
  _rbLastRenderFp = renderFp;
  // Each row is returned with its status so _groupBatchRows can bucket it by
  // stage; the row markup itself is unchanged.
  const _rowsByStage = sorted.map((b) => batchRowHtml(b));
  body.innerHTML = _groupBatchRows(_rowsByStage) || '<tr><td colspan="12" class="empty">' + t('dash.noMatches') + '</td></tr>';
}
let locColor = {};
function toggleBatchBags(batchId) {
  const existing = document.getElementById('brow-' + batchId);
  if (existing) {
    existing.remove();
    document.getElementById('btog-' + batchId).innerHTML = '&#9654;';
    return;
  }
  const b = batches.find((x) => x.batchId === batchId);
  if (!b) return;
  document.getElementById('btog-' + batchId).innerHTML = '&#9660;';
  const parentRow = document.getElementById('btog-' + batchId).closest('tr');
  const tr = document.createElement('tr');
  tr.id = 'brow-' + batchId;
  const td = document.createElement('td');
  td.colSpan = 12;
  td.style.cssText = 'background:var(--c-bg);padding:8px 12px';
  const lastByBag = buildLastScanByBag();
  td.innerHTML =
    '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
    b.bags
      .map((bag) => {
        const last = lastByBag.get(bag.toUpperCase());
        let loc = '—',
          color = '#aaa';
        if (last) {
          if (last.action === 'REMOVE') {
            loc = t('bagInfo.removed');
            color = '#999';
          } else if (last.to) {
            loc = zoneDisplayName(last.to);
            const z = toZone(last.to);
            color = locColor[z] || '#888';
          }
        }
        const num = bag.split('-').pop();
        // Show per-bag weight if batch has mixed weights
        const bw = b.bagWeights ? b.bagWeights[bag] : null;
        const wVals = b.bagWeights ? new Set(Object.values(b.bagWeights)) : new Set();
        const showW = bw != null && wVals.size > 1;
        const wTag = showW ? `<span style="font-size:8px;color:#888;margin-left:1px">${esc(bw)}kg</span>` : '';
        return `<span style="font-size:10px;font-family:monospace;padding:3px 7px;border-radius:5px;background:#fff;border:1px solid var(--c-border);display:inline-flex;align-items:center;gap:3px${last && last.action === 'REMOVE' ? ';text-decoration:line-through;opacity:.5' : ''}">
      ${esc(num)}${wTag} <span style="font-size:9px;color:${color};font-weight:600">${esc(loc)}</span>
    </span>`;
      })
      .join('') +
    '</div>';
  tr.appendChild(td);
  parentRow.after(tr);
}
let addBagsBatchId = null;
let _lastNewBags = [];
function openAddBags(batchId) {
  const b = batches.find((x) => x.batchId === batchId);
  if (!b) return;
  addBagsBatchId = batchId;
  document.getElementById('ab-phase-input').style.display = '';
  document.getElementById('ab-phase-result').style.display = 'none';
  document.getElementById('m-addbags-title').textContent = t('addBags.title');
  document.getElementById('ab-info').textContent = t('addBags.info', {
    id: batchId,
    n: b.bags.length,
    last: b.bags[b.bags.length - 1]
  });
  document.getElementById('ab-qty').value = 1;
  document.getElementById('ab-preview').style.display = 'none';
  document.getElementById('m-addbags').classList.add('open');
  setTimeout(() => document.getElementById('ab-qty').focus(), 80);
}
function confirmAddBags() {
  const b = batches.find((x) => x.batchId === addBagsBatchId);
  if (!b) return;
  const qty = parseInt(document.getElementById('ab-qty').value) || 0;
  if (qty < 1) {
    alert(t('addBags.enterQty'));
    return;
  }
  const confirmBtn = document.getElementById('addbags-confirm-btn');
  if (confirmBtn) confirmBtn.disabled = true;
  const prevBags = b.bags.slice();
  const prevQty = b.qty;
  const lastNum = parseInt(b.bags[b.bags.length - 1].split('-').pop()) || b.bags.length;
  const newBags = Array.from({ length: qty }, (_, i) => b.batchId + '-' + String(lastNum + 1 + i).padStart(2, '0'));
  b.bags = [...b.bags, ...newBags];
  b.qty = b.bags.length;
  _lastNewBags = newBags;
  apiPatch('/api/batches/' + encodeURIComponent(b.batchId) + '/bags', { add: newBags, newQty: b.qty })
    .then((r) => {
      if (r && r.error) {
        b.bags = prevBags;
        b.qty = prevQty;
        setFb('err', t('common.error') + ': ' + r.error);
        document.getElementById('ab-phase-input').style.display = '';
        document.getElementById('ab-phase-result').style.display = 'none';
        return;
      }
      if (r && r.bagBarcodes) {
        for (const [id, bc] of Object.entries(r.bagBarcodes)) {
          barcodeRegistry.set(bc, { type: 'bag', id });
          barcodeByEntity.set('bag:' + id, bc);
        }
      }
    })
    .finally(() => {
      if (confirmBtn) confirmBtn.disabled = false;
    });
  // Switch to result phase
  document.getElementById('ab-phase-input').style.display = 'none';
  document.getElementById('m-addbags-title').textContent = t('addBags.addedTitle');
  document.getElementById('ab-result-info').textContent = t('addBags.added', {
    qty: qty,
    id: b.batchId,
    total: b.bags.length
  });
  document.getElementById('ab-new-bags').innerHTML = newBags
    .map(
      (id) =>
        '<span style="font-size:10px;font-family:monospace;background:var(--c-bg);padding:2px 6px;border-radius:4px;color:var(--c-text-sec)">' +
        esc(id) +
        '</span>'
    )
    .join('');
  document.getElementById('ab-phase-result').style.display = '';
  renderBatches();
}
async function printNewBags() {
  const b = batches.find((x) => x.batchId === addBagsBatchId);
  if (!b || !_lastNewBags.length) return;
  const zpl = makeBagZPL(_lastNewBags, b, 'full');
  const err = await sendToPrinter(zpl);
  if (err) {
    const blob = new Blob([zpl], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = b.batchId + '_new_labels.zpl';
    a.click();
  } else {
    setFb('ok', t('addBags.printed', { n: _lastNewBags.length, id: b.batchId }));
  }
  document.getElementById('m-addbags').classList.remove('open');
}
document.getElementById('m-addbags').addEventListener('click', (e) => {
  if (e.target.id === 'm-addbags') document.getElementById('m-addbags').classList.remove('open');
});

function delBatch(id) {
  confirm2(t('batch.deleteBatch', { id: id }), t('batch.deleteMsg'), t('batch.deleteBtn'), async () => {
    // Server-first: only apply local changes after the server confirms the delete.
    // Prevents a silent divergence where the batch reappears on next page load.
    const r = await apiDelete('/api/batches/' + encodeURIComponent(id));
    if (r && r.error) {
      setFb('err', t('common.error') + ': ' + r.error);
      return;
    }
    const b = batches.find((x) => x.batchId === id);
    // Reverse inventory deductions locally
    if (b && inventory.stock) {
      // Sum per-bag weights from bagWeights map, or fall back to qty * bagKg
      const totalBagKg =
        b.bagWeights && Object.keys(b.bagWeights).length
          ? Object.values(b.bagWeights).reduce((s, w) => s + (w || b.bagKg || 3), 0)
          : b.qty * (b.bagKg || 3);
      if (b.batchType === 'grain') {
        inventory.stock.grain = (inventory.stock.grain || 0) + totalBagKg;
      } else if (b.substrate) {
        const rh = b.substrate.rh || 0;
        const totalDryKg = mtDryKg(totalBagKg, rh);
        if (b.substrate.hardwood)
          inventory.stock.hardwood = (inventory.stock.hardwood || 0) + totalDryKg * (b.substrate.hardwood / 100);
        if (b.substrate.wheatbran)
          inventory.stock.wheatbran = (inventory.stock.wheatbran || 0) + totalDryKg * (b.substrate.wheatbran / 100);
        if (b.substrate.coir)
          inventory.stock.coir = (inventory.stock.coir || 0) + totalDryKg * (b.substrate.coir / 100);
        if (b.substrate.gypsum) inventory.stock.gypsum = (inventory.stock.gypsum || 0) + totalDryKg * 0.01;
      }
      // All-in-One raw-grain portion mixed into a block batch (credit it back too).
      if (b.batchType !== 'grain' && b.grainKg) {
        const grh = b.grainRh || 0;
        inventory.stock.grain = (inventory.stock.grain || 0) + b.qty * b.grainKg * (grh > 0 ? 1 - grh / 100 : 1);
      }
    }
    batches = batches.filter((x) => x.batchId !== id);
    scanLog = scanLog.filter((x) => x.batch !== id);
    harvests = harvests.filter((x) => x.batch !== id);
    renderBatches();
    renderStatus();
  });
}

// ─── HARVESTS ────────────────────────────────────────────────
function showHarvestPanel(bagId, batchId) {
  const b = batches.find((x) => x.batchId === batchId);
  scan.harvestBag = { bagId, batchId, species: b?.species, strain: b?.strain };
  document.getElementById('hp-lbl').textContent = t('harvest.logHarvest') + ' \u2014 ' + bagId;
  document.getElementById('hp-bag').value = bagId;
  document.getElementById('hp-grams').value = '';
  // Never carried over from the last bag. A weight gets re-typed every time, but
  // a release that looks already-filled gets confirmed by reflex — and that sets
  // the same produce aside twice.
  document.getElementById('hp-release').value = '';
  // Hidden unless the feed actually reports releases. A field that takes a number
  // and does nothing with it is worse than no field: the crate gets packed and
  // nothing publishes it.
  document.getElementById('hp-release-wrap').style.display = harvestRelease.on ? '' : 'none';
  closeCamScan();
  closeScanModal();
  document.getElementById('harvest-panel').style.display = 'block';
  setTimeout(() => document.getElementById('hp-grams').focus(), 80);
  setFb('harvest', t('harvest.bagScanned', { bag: bagId }), { noModal: true });
}
function confirmHarvest(keepScanning) {
  const g = parseDecimal(document.getElementById('hp-grams').value),
    f = parseInt(document.getElementById('hp-flush').value) || 1;
  if (!g || g <= 0) {
    alert(t('harvest.enterWeight'));
    return;
  }
  // Only when the field is on screen. Reading it regardless would send whatever
  // a previous session left in the DOM.
  const rel = harvestRelease.on ? parseDecimal(document.getElementById('hp-release').value) || 0 : 0;
  // Caught here as well as on the server, because here it is still fixable: the
  // panel stays open with the number in it. The server rejecting it after the
  // scan modal has moved on is a message about a bag that is already back on the
  // shelf.
  if (rel > g) {
    alert(t('harvest.releaseTooHigh'));
    return;
  }
  const p = scan.harvestBag;
  const tempId = 's' + ++_scanTempIdCounter;
  const hEntry = {
    time: new Date().toISOString(),
    batch: p.batchId,
    bag: p.bagId,
    species: p.species,
    strain: p.strain,
    grams: g,
    flush: f
  };
  harvests.push(hEntry);
  // `release` travels in the request but not in `hEntry`: the local array mirrors
  // the harvests table, and a field that exists on the client's copy and not in
  // the database is how the two quietly drift apart.
  apiPost('/api/harvests', rel > 0 ? { ...hEntry, release: rel } : hEntry).then((r) => {
    if (r && r.error) {
      // Roll back local state so user sees accurate harvest totals
      const i = harvests.lastIndexOf(hEntry);
      if (i >= 0) harvests.splice(i, 1);
      setFb('err', t('common.error') + ': ' + r.error);
      renderHarvests();
      updateSD();
      return;
    }
    // The harvest is stored either way — only the release failed. Saying so
    // matters because the crate is already packed: without this the produce sits
    // there and the shop never hears about it.
    //
    // `noModal: true` on both, like the five other call sites that fire from a
    // callback. Without it setFb() runs openScanModal(), and by the time this
    // resolves the worker has usually scanned the next bag — so the overlay would
    // reopen over a panel already being typed into, and on a phone it would leave
    // body.overflow pinned to hidden.
    //
    // The message names the bag and calls the figure a total, because the number
    // that comes back is the whole crate and not this bag's contribution: 500 g on
    // top of 2 kg answers "2.5 kg", and read as "just released" that looks like a
    // slipped comma.
    if (r && r.releaseError)
      setFb('err', t('harvest.releaseFailed', { bag: p.bagId }) + ': ' + r.releaseError, { noModal: true });
    else if (r && r.released)
      setFb('ok', t('harvest.releasedTotal', { bag: p.bagId, kg: (r.released.grams / 1000).toFixed(2) }), {
        noModal: true
      });
  });
  // Track in sessionEntries so session summary counts HARVEST and it appears in the log
  const sEntry = {
    time: hEntry.time,
    action: 'HARVEST',
    batch: p.batchId,
    bag: p.bagId,
    from: null,
    to: null,
    species: p.species,
    strain: p.strain,
    grams: g,
    flush: f,
    _tempId: tempId
  };
  if (!sessionStartTime) sessionStartTime = Date.now();
  sessionEntries.push(sEntry);
  scan.harvestBag = null;
  scan.count++;
  document.getElementById('harvest-panel').style.display = 'none';
  setFb('ok', t('harvest.logged', { bag: p.bagId, g: g, f: f }), sEntry);
  updateSD();
  // Chain: reopen the scanner so the next bag flows straight into a fresh
  // harvest panel (scan.action stays HARVEST) instead of ejecting the worker
  // and making them re-open the scanner between every bag.
  if (keepScanning) openScanModal();
}
function cancelHarvest() {
  scan.harvestBag = null;
  document.getElementById('harvest-panel').style.display = 'none';
  setFb('info', t('harvest.cancelled'));
}
document.getElementById('hp-grams').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmHarvest();
});
function renderHarvests() {
  const q = (document.getElementById('harvest-q').value || '').toLowerCase(),
    body = document.getElementById('harvest-body');
  // P-02: Chart.js is lazy-loaded. If it isn't ready yet, defer the entire
  // render until it is. The user briefly sees the previous tab render until
  // the lib finishes loading; in practice this is sub-100ms because either
  // the SW pre-cache has the lib, or the idle preload kicked off long ago.
  if (typeof Chart === 'undefined') {
    loadVendorLibs().then(() => renderHarvests());
    return;
  }
  // Newest first by default; a chosen column overrides it. The 200-row cap is
  // applied AFTER sorting, so sorting by grams shows the biggest harvests rather
  // than the biggest of the 200 most recent.
  const matching = [...harvests]
    .reverse()
    .filter((h) => !q || h.batch.toLowerCase().includes(q) || (h.species || '').toLowerCase().includes(q));
  updateSortIndicators('harvests', tableSort.harvests);
  const items = applyTableSort(matching, tableSort.harvests, (h, k) => {
    if (k === 'grams' || k === 'flush') return Number(h[k]) || 0;
    return h[k];
  }).slice(0, 200);
  body.innerHTML = items.length
    ? items
        .map(
          (h) =>
            `<tr><td data-mlabel="${esc(t('th.date'))}" class="hv-date" style="font-size:10px;color:var(--c-text-muted)">${fmtDtTime(h.time)}</td><td data-mlabel="${esc(t('th.batch'))}" style="font-family:monospace;font-size:10px">${esc(h.batch) || '\u2014'}</td><td data-mlabel="${esc(t('th.bag'))}" style="font-family:monospace;font-size:10px">${esc(h.bag) || '\u2014'}</td><td data-mlabel="${esc(t('th.species'))}">${h.species ? spDot(h.species) + esc(h.species) : '\u2014'}</td><td data-mlabel="${esc(t('th.strain'))}">${esc(h.strain) || '\u2014'}</td><td data-mlabel="${esc(t('th.flush'))}">${h.flush || 1}</td><td data-mlabel="${esc(t('th.grams'))}" class="hv-grams" style="font-weight:500;color:var(--c-amber-dark)">${h.grams}g</td></tr>`
        )
        .join('')
    : '<tr><td colspan="7" class="empty">' + t('harvest.noHarvests') + '</td></tr>';

  const byBatch = {};
  harvests.forEach((h) => {
    if (!byBatch[h.batch]) byBatch[h.batch] = { total: 0, flushes: {}, species: h.species };
    byBatch[h.batch].total += h.grams;
    byBatch[h.batch].flushes[h.flush] = (byBatch[h.batch].flushes[h.flush] || 0) + h.grams;
  });
  const ids = Object.keys(byBatch).sort((a, b) => byBatch[b].total - byBatch[a].total);
  const tot = harvests.reduce((s, h) => s + h.grams, 0);
  document.getElementById('harvest-metrics').innerHTML = ids.length
    ? [
        [t('harvest.totalHarvested'), tot >= 1000 ? (tot / 1000).toFixed(1) + 'kg' : tot + 'g'],
        [t('harvest.batchesWithYield'), ids.length],
        [t('harvest.topBatch'), ids[0] ? byBatch[ids[0]].total + 'g' : '\u2014']
      ]
        .map(
          ([l, v]) =>
            `<div class="met"><div class="met-l">${l}</div><div class="met-v" style="font-size:16px;color:var(--c-amber-dark)">${v}</div></div>`
        )
        .join('')
    : '';

  if (!ids.length) {
    document.getElementById('harvest-totals').innerHTML = '<div class="empty">' + t('harvest.noData') + '</div>';
    return;
  }

  // Bar chart: yield per batch
  const batchYieldCanvas = document.getElementById('batch-yield-chart');
  if (batchYieldCanvas) {
    if (batchYieldInst) {
      batchYieldInst.destroy();
      batchYieldInst = null;
    }
    batchYieldInst = new Chart(batchYieldCanvas, {
      type: 'bar',
      data: {
        labels: ids.slice(0, 12),
        datasets: [
          {
            label: 'Grams',
            data: ids.slice(0, 12).map((id) => byBatch[id].total),
            backgroundColor: ids.slice(0, 12).map((id) => spColor(byBatch[id].species)),
            borderRadius: 5,
            borderSkipped: false
          }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.y + 'g' } } },
        scales: {
          y: { ticks: { callback: (v) => v + 'g' }, grid: { color: '#f0ede8' } },
          x: { ticks: { font: { size: 9 } }, grid: { display: false } }
        }
      }
    });
  }

  // Line chart: harvest over time by week
  const byWeek = {};
  harvests.forEach((h) => {
    const d = new Date(h.time);
    const mon = new Date(d);
    // (getDay()+6)%7 puts Monday at offset 0 … Sunday at 6; the old
    // `- getDay() + 1` bucketed Sunday into the *next* week. Key by the local
    // date, not toISOString() (which shifts a local-midnight Monday to Sunday
    // in CEST and splits one local week across two buckets).
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = localDateStr(mon);
    byWeek[key] = (byWeek[key] || 0) + h.grams;
  });
  const weekKeys = Object.keys(byWeek).sort();
  const timelineCanvas = document.getElementById('harvest-timeline-chart');
  if (timelineCanvas) {
    if (timelineInst) {
      timelineInst.destroy();
      timelineInst = null;
    }
    timelineInst = new Chart(timelineCanvas, {
      type: 'line',
      data: {
        labels: weekKeys.map((k) => {
          const d = new Date(k);
          return fmtDtShort(d);
        }),
        datasets: [
          {
            label: 'g/week',
            data: weekKeys.map((k) => byWeek[k]),
            fill: true,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245,158,11,.12)',
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: '#f59e0b'
          }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.y + 'g' } } },
        scales: {
          y: { ticks: { callback: (v) => v + 'g' }, grid: { color: '#f0ede8' } },
          x: { ticks: { font: { size: 9 }, maxRotation: 0 }, grid: { display: false } }
        }
      }
    });
  }

  // Per-batch totals with flush breakdown
  const max = byBatch[ids[0]].total;
  document.getElementById('harvest-totals').innerHTML = ids
    .map((id) => {
      const d = byBatch[id],
        pct = Math.round((d.total / max) * 100);
      return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px"><span style="font-size:12px;font-weight:500">${spDot(d.species)}${esc(id)}</span><span style="font-size:13px;font-weight:600;color:var(--c-amber-dark)">${d.total}g</span></div><div class="harvest-bar"><div class="harvest-bar-fill" style="width:${pct}%"></div></div><div style="font-size:10px;color:var(--c-text-muted);margin-top:2px">${Object.entries(
        d.flushes
      )
        .map(([f, g]) => `Flush ${f}: ${g}g`)
        .join(' · ')}</div></div>`;
    })
    .join('');
}

// ─── TO-DO ───────────────────────────────────────────────────
function buildAutoTasks() {
  const tasks = [],
    today = new Date();
  today.setHours(0, 0, 0, 0);
  batches.forEach((b) => {
    const { status } = getStatus(b.batchId);
    // Only the two growing states produce work here. FRUITING has its own
    // Ready-to-harvest card; CONTAM is tracked via Contamination reports (resolve
    // as Discarded/Autoclaved/etc.) \u2014 once bags are in the contam zone the worker
    // has already acted, no need to nag here; DONE/EMPTY are terminal.
    if (status !== 'INCUBATING' && status !== 'SPAWN RUN') return;
    const due = new Date(b.due);
    due.setHours(0, 0, 0, 0);
    const dl = Math.round((due - today) / 864e5);
    // A missing or unparseable due date makes dl NaN, which fails every
    // comparison below \u2014 so it would fall through as "due this week" and render
    // an actionable row reading "F\u00e4llig in NaN Tag(en)". Reject it explicitly.
    if (!Number.isFinite(dl) || dl > 7) return; // only show tasks due this week
    // Two states, two different instructions \u2014 so two task kinds. A block that
    // finished incubation goes to a fruiting tent. Grain that finished its spawn
    // run is not "monitor it": it is ready to be used, and sending it to a tent
    // would skip a whole growth stage.
    const urgent = dl < 0;
    tasks.push({
      // dl === 0 gets its own string: "F\u00e4llig in 0 Tag(en)" is how a machine
      // says "today", and it reads that way on the card and the work list alike.
      detail: urgent ? t('todo.dueAgo', { n: -dl }) : dl === 0 ? t('todo.dueToday') : t('todo.dueIn', { n: dl }),
      urgent,
      // warn keeps its old meaning (due within two days) so the dashboard badge
      // and the orange dot behave exactly as before.
      warn: !urgent && dl <= 2,
      // Is it actually due? A batch 3-7 days out belongs on the card so the week
      // ahead is visible, but moving it now ends incubation early. So it is listed
      // and NOT offered a move. This is exactly the old taskAction!==null boundary,
      // kept as its own flag: taskAction says WHAT the job is, ready says whether
      // it is due yet. Every reader that meant "actionable move" tests both.
      ready: dl <= 2,
      species: b.species,
      batchId: b.batchId,
      taskAction: status === 'SPAWN RUN' ? 'inoculate' : 'move',
      // Which urgency section the row lands in \u2014 see renderDashBatchTasks.
      bucket: urgent ? 'overdue' : dl === 0 ? 'today' : 'week',
      dueIn: dl
    });
  });
  return tasks;
}
function toggleTask(id) {
  const t = manualTasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.caldavSynced = null;
  apiPatch('/api/tasks/' + id, { done: t.done, caldavSynced: null });
  renderCalendar();
  updateTodoBadge();
  if (caldav.enabled && t.caldavUid) pushTaskCaldav(t);
}
function deleteTask(id) {
  const tk = manualTasks.find((x) => x.id === id);
  if (!tk) return;
  confirm2(t('task.deleteTitle'), t('task.deleteMsg'), t('common.delete'), () => {
    manualTasks = manualTasks.filter((x) => x.id !== id);
    apiDelete('/api/tasks/' + id);
    renderCalendar();
    updateTodoBadge();
  });
}
function updateTodoBadge() {
  const n = manualTasks.filter((t) => !t.done).length;
  const el = document.getElementById('n-cal');
  if (el) el.classList.toggle('alert', n > 0);
  const bd = buildAutoTasks().filter((t) => t.urgent || t.warn).length + getInvAlerts().length;
  const de = document.getElementById('n-dash');
  if (de) de.classList.toggle('alert', bd > 0);
}

// ─── TEAM MEMBERS ───────────────────────────────────────────
function renderTeam() {
  const el = document.getElementById('team-list');
  if (typeof fillCalendarUserFilter === 'function') fillCalendarUserFilter();
  if (!el) return;
  if (!teamMembers.length) {
    el.innerHTML = '<div class="empty" style="padding:1rem">' + t('team.empty') + '</div>';
    return;
  }
  el.innerHTML = teamMembers
    .map(
      (m) =>
        `<div class="member-row"><span class="name">${esc(m.name)}</span>${m.role ? `<span style="font-size:11px;color:var(--c-text-muted)">${esc(m.role)}</span>` : ''}<button class="btn btn-sm btn-r" onclick="removeMember(${m.id})">×</button></div>`
    )
    .join('');
}
function addMember() {
  const name = document.getElementById('member-name').value.trim();
  if (!name) return;
  const role = document.getElementById('member-role').value.trim();
  if (teamMembers.some((m) => m.name.toLowerCase() === name.toLowerCase())) return;
  const member = { name, role: role || null, added: new Date().toISOString() };
  teamMembers.push(member);
  document.getElementById('member-name').value = '';
  document.getElementById('member-role').value = '';
  apiPost('/api/team', member).then((r) => {
    if (r && r.id) member.id = r.id;
    renderTeam();
  });
}
function removeMember(id) {
  const m = teamMembers.find((x) => x.id === id);
  if (!m) return;
  confirm2(
    'Remove member?',
    'Remove ' + m.name + ' from the team. Their existing task assignments remain.',
    'Remove',
    () => {
      teamMembers = teamMembers.filter((x) => x.id !== id);
      apiDelete('/api/team/' + id);
      renderTeam();
    }
  );
}

// ─── CalDAV SYNC ────────────────────────────────────────────
function loadCaldavSettings() {
  // Show the CalDAV URL for this server
  const url = location.protocol + '//' + location.hostname + ':' + location.port + '/caldav/calendars/';
  document.getElementById('caldav-url-display').textContent = url;
  document.getElementById('caldav-enabled').checked = !!caldav.enabled;
}
function saveCaldavSettings() {
  caldav.enabled = document.getElementById('caldav-enabled').checked;
  apiPost('/api/caldav/config', caldav).then((r) => {
    if (r.error) {
      showCaldavStatus(r.error, 'var(--c-red-dark)');
    } else {
      showCaldavStatus(t('caldav.settingsSaved'), 'var(--c-green-dark)');
    }
  });
}
function showCaldavStatus(msg, color) {
  const el = document.getElementById('caldav-status');
  el.style.display = 'block';
  el.style.color = color || '#888';
  el.textContent = msg;
  setTimeout(() => {
    el.style.display = 'none';
  }, 8000);
}
async function syncCaldavNow() {
  if (!caldav.enabled) {
    showCaldavStatus('Enable sync first, then save settings.', '#92400e');
    return;
  }
  const btn = document.getElementById('caldav-sync-btn');
  btn.disabled = true;
  btn.textContent = t('caldav.syncing');
  showCaldavStatus('Writing tasks to calendar files...', '#888');
  try {
    const r = await authFetch('/api/caldav/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caldav, teamMembers, manualTasks })
    }).then((r) => r.json());
    if (r.error) {
      showCaldavStatus('Sync failed: ' + r.error, 'var(--c-red-dark)');
    } else {
      showCaldavStatus(
        `Done! ${r.pushed} tasks written to calendar.${r.errors ? ' (' + r.errors + ' errors)' : ''}  Calendar clients can now see them via CalDAV.`,
        r.errors ? 'var(--c-amber-dark)' : 'var(--c-green-dark)'
      );
      // Selective refresh: only reload tasks to get updated caldavUid/caldavSynced
      // instead of loadData() which would overwrite ALL local state
      try {
        const td = await authFetch('/api/data').then((r) => r.json());
        if (td.manualTasks) manualTasks = td.manualTasks;
        if (td.calendarEvents) calendarEvents = td.calendarEvents;
      } catch {}
      renderCalendar();
    }
  } catch (e) {
    showCaldavStatus('Sync error: ' + e.message, 'var(--c-red-dark)');
  } finally {
    btn.disabled = false;
    btn.textContent = t('caldav.syncNow');
  }
}
async function pushTaskCaldav(task) {
  if (!caldav.enabled) return;
  try {
    const r = await authFetch('/api/caldav/push-one', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task })
    }).then((r) => r.json());
    if (r.ok && r.uid) {
      task.caldavUid = r.uid;
      task.caldavSynced = new Date().toISOString();
      apiPatch('/api/tasks/' + task.id, { caldavUid: task.caldavUid, caldavSynced: task.caldavSynced });
      renderCalendar();
    }
  } catch (e) {
    console.error('CalDAV push error:', e);
  }
}

// ─── DUCKDNS ────────────────────────────────────────────────
// ── Versand (Sendcloud) config (Admin → Settings → Versand) ──
async function loadShipSettings() {
  try {
    const r = await authFetch('/api/ship/config');
    const cfg = await r.json();
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v;
    };
    const en = document.getElementById('versand-enabled');
    if (en) en.checked = !!cfg.enabled;
    set('versand-public', cfg.publicKey || '');
    set('versand-secret', '');
    const sec = document.getElementById('versand-secret');
    if (sec) sec.placeholder = cfg.hasSecret ? t('versand.secretSet') : 'Secret Key';
    set('versand-mode', cfg.mode || 'test');
    set('versand-weight', cfg.defaultWeightG != null ? cfg.defaultWeightG : 1000);
  } catch (e) {
    /* not configured yet */
  }
}
async function saveShipSettings() {
  const cfg = {
    enabled: document.getElementById('versand-enabled').checked,
    publicKey: (document.getElementById('versand-public').value || '').trim(),
    secretKey: (document.getElementById('versand-secret').value || '').trim(),
    mode: document.getElementById('versand-mode').value || 'test',
    defaultWeightG: parseInt(document.getElementById('versand-weight').value, 10) || 1000
  };
  try {
    const r = await apiPatch('/api/ship/config', cfg);
    if (r && r.error) {
      setFb('err', r.error);
      return;
    }
    setFb('ok', t('versand.saved'));
    loadShipSettings();
  } catch (e) {
    setFb('err', t('common.error'));
  }
}
async function testShipConnection() {
  const el = document.getElementById('versand-test-result');
  if (el) {
    el.style.display = 'block';
    el.textContent = t('common.loading');
  }
  try {
    const r = await authFetch('/api/ship/test');
    const d = await r.json();
    if (!r.ok || d.error) {
      if (el) el.textContent = '⚠ ' + (d.error || 'HTTP ' + r.status);
      return;
    }
    let carriers = '';
    try {
      const mr = await authFetch('/api/ship/methods');
      const md = await mr.json();
      if (mr.ok && md.methods) carriers = [...new Set(md.methods.map((m) => m.carrier))].join(', ');
    } catch (e2) {
      /* methods are a bonus */
    }
    if (el) el.textContent = '✓ ' + t('versand.connected', { account: d.account || 'ok' }) + (carriers ? ' — ' + carriers : '');
  } catch (e) {
    if (el) el.textContent = '⚠ ' + t('common.error');
  }
}

// ── Sales channels (Admin → Settings → Kanäle) ──
async function loadChannelsSettings() {
  try {
    const r = await authFetch('/api/channels');
    const d = await r.json();
    const wix = (d.channels || []).find((c) => c.channel === 'wix') || {};
    const en = document.getElementById('wix-enabled');
    if (en) en.checked = !!wix.enabled;
    const sid = document.getElementById('wix-siteid');
    if (sid) sid.value = wix.siteId || '';
    const aid = document.getElementById('wix-accountid');
    if (aid) aid.value = wix.clientId || '';
    const ak = document.getElementById('wix-apikey');
    if (ak) {
      ak.value = '';
      ak.placeholder = wix.hasApiKey ? t('channels.keySet') : 'API-Key';
    }
    const st = document.getElementById('wix-status');
    if (st && wix.lastSync) {
      st.style.display = 'block';
      st.textContent = wix.lastError ? '⚠ ' + wix.lastError : '✓ ' + t('channels.lastSync', { time: fmtDt(wix.lastSync) });
    }
    // eBay + Etsy (OAuth): client_id / secret / RuName + connection status.
    const fillOauth = (prefix, ch) => {
      const en = document.getElementById(prefix + '-enabled');
      if (en) en.checked = !!ch.enabled;
      const cid = document.getElementById(prefix + '-clientid');
      if (cid) cid.value = ch.clientId || '';
      const sid = document.getElementById(prefix + '-siteid');
      if (sid) sid.value = ch.siteId || '';
      const sec = document.getElementById(prefix + '-secret');
      if (sec) {
        sec.value = '';
        sec.placeholder = ch.hasClientSecret ? t('channels.keySet') : 'Cert-ID';
      }
      const st2 = document.getElementById(prefix + '-status');
      if (st2) {
        const bits = [ch.connected ? '✓ ' + t('channels.linked') : t('channels.notLinked')];
        if (ch.lastError) bits.push('⚠ ' + ch.lastError);
        else if (ch.lastSync) bits.push(t('channels.lastSync', { time: fmtDt(ch.lastSync) }));
        st2.style.display = 'block';
        st2.textContent = bits.join(' · ');
      }
    };
    fillOauth('ebay', (d.channels || []).find((c) => c.channel === 'ebay') || {});
    fillOauth('etsy', (d.channels || []).find((c) => c.channel === 'etsy') || {});
    // eBay account-deletion setup: never echo the stored token back, and show the
    // endpoint URL the server actually hashes so it can be copied into the portal.
    const ebay = (d.channels || []).find((c) => c.channel === 'ebay') || {};
    const vt = document.getElementById('ebay-verifytoken');
    if (vt) {
      vt.value = '';
      vt.placeholder = ebay.hasWebhookSecret ? t('channels.keySet') : t('channels.ebayVerifyToken');
    }
    const du = document.getElementById('ebay-deletion-url');
    if (du) du.textContent = (d.urls && d.urls.ebayDeletion) || '';
  } catch (e) {
    /* not configured yet */
  }
}
async function saveChannel(channel) {
  let body;
  if (channel === 'wix') {
    body = {
      enabled: document.getElementById('wix-enabled').checked,
      apiKey: (document.getElementById('wix-apikey').value || '').trim(),
      siteId: (document.getElementById('wix-siteid').value || '').trim(),
      clientId: (document.getElementById('wix-accountid').value || '').trim()
    };
  } else if (channel === 'ebay') {
    body = {
      enabled: document.getElementById('ebay-enabled').checked,
      clientId: (document.getElementById('ebay-clientid').value || '').trim(), // App-ID
      clientSecret: (document.getElementById('ebay-secret').value || '').trim(), // Cert-ID (blank = keep)
      siteId: (document.getElementById('ebay-siteid').value || '').trim(), // RuName
      // Account-deletion verification token (blank = keep the stored one). Read
      // defensively so a cached older index.html can still save the other fields.
      webhookSecret: ((document.getElementById('ebay-verifytoken') || {}).value || '').trim()
    };
  } else if (channel === 'etsy') {
    body = {
      enabled: document.getElementById('etsy-enabled').checked,
      clientId: (document.getElementById('etsy-clientid').value || '').trim() // Keystring
    };
  } else {
    return false;
  }
  try {
    const r = await apiPatch('/api/channels/' + channel, body);
    if (r && r.error) {
      setFb('err', r.error);
      return false;
    }
    setFb('ok', t('channels.saved'));
    loadChannelsSettings();
    return true;
  } catch (e) {
    setFb('err', t('common.error'));
    return false;
  }
}
// Start the OAuth login: persist creds first (so the server has client_id / RuName),
// then redirect the browser to the provider's authorize page. The provider sends the
// user back to the public callback, which stores the tokens.
async function connectChannel(channel) {
  const ok = await saveChannel(channel);
  if (ok === false) return;
  try {
    const r = await authFetch('/api/channels/' + channel + '/oauth/start');
    const d = await r.json();
    if (d && d.url) {
      window.location.href = d.url;
      return;
    }
    setFb('err', (d && d.error) || t('common.error'));
  } catch (e) {
    if (e.message !== 'unauthorized') setFb('err', t('common.error'));
  }
}
async function testChannel(channel) {
  const st = document.getElementById(channel + '-status');
  if (st) {
    st.style.display = 'block';
    st.textContent = t('common.loading');
  }
  try {
    const r = await apiPost('/api/channels/' + channel + '/test', {});
    if (st) st.textContent = r && r.error ? '⚠ ' + r.error : '✓ ' + t('channels.connected');
  } catch (e) {
    if (st) st.textContent = '⚠ ' + t('common.error');
  }
}
async function syncChannel(channel) {
  const st = document.getElementById(channel + '-status');
  if (st) {
    st.style.display = 'block';
    st.textContent = t('channels.syncing');
  }
  try {
    const r = await apiPost('/api/channels/' + channel + '/sync', {});
    if (r && r.error) {
      if (st) st.textContent = '⚠ ' + r.error;
      return;
    }
    if (st) st.textContent = '✓ ' + t('channels.synced', { n: r.imported || 0 });
    setFb('ok', t('channels.synced', { n: r.imported || 0 }));
  } catch (e) {
    if (st) st.textContent = '⚠ ' + t('common.error');
  }
}

async function loadDuckdnsSettings() {
  try {
    const r = await authFetch('/api/duckdns/config');
    if (!r.ok) return;
    const cfg = await r.json();
    document.getElementById('duckdns-enabled').checked = !!cfg.enabled;
    document.getElementById('duckdns-domain').value = cfg.domain || '';
    const tokenEl = document.getElementById('duckdns-token');
    tokenEl.value = '';
    tokenEl.placeholder = cfg.hasToken ? '••••••••••' : '';
    document.getElementById('duckdns-le-enabled').checked = !!cfg.leEnabled;
  } catch (e) {
    /* non-admin */
  }
  await refreshDuckdnsStatus();
}
async function refreshDuckdnsStatus() {
  try {
    const r = await authFetch('/api/duckdns/status');
    if (!r.ok) return;
    const s = await r.json();
    const banner = document.getElementById('duckdns-status-banner');
    if (s.enabled && s.domain) {
      banner.style.display = 'block';
      if (s.lastIp) {
        banner.style.background = 'var(--c-primary-light)';
        banner.style.border = '1px solid var(--c-green-border)';
        banner.style.color = 'var(--c-green-dark)';
        banner.innerHTML =
          '<strong>' +
          s.domain +
          '</strong> &rarr; ' +
          s.lastIp +
          (s.lastIpUpdate ? ' <span style="color:var(--c-text-muted)">(' + fmtDtTime(s.lastIpUpdate) + ')</span>' : '');
      } else {
        banner.style.background = 'var(--c-amber-light)';
        banner.style.border = '1px solid var(--c-amber-border)';
        banner.style.color = 'var(--c-amber-dark)';
        banner.textContent = t('duckdns.noUpdateYet');
      }
    } else {
      banner.style.display = 'none';
    }
    const certEl = document.getElementById('le-cert-status');
    if (s.cert && s.cert.exists) {
      certEl.style.display = 'block';
      if (s.cert.type === 'letsencrypt' && s.leExpiry) {
        const daysLeft = Math.round((new Date(s.leExpiry) - Date.now()) / 86400000);
        const ok = daysLeft > 30,
          warn = daysLeft > 7;
        certEl.style.background = ok ? 'var(--c-primary-light)' : warn ? 'var(--c-amber-light)' : 'var(--c-red-light)';
        certEl.style.border =
          '1px solid ' + (ok ? 'var(--c-green-border)' : warn ? 'var(--c-amber-border)' : 'var(--c-red-border)');
        certEl.style.color = ok ? 'var(--c-green-dark)' : warn ? 'var(--c-amber-dark)' : 'var(--c-red-dark)';
        certEl.innerHTML =
          t('le.certActive') + '. ' + t('le.certIssued', { domain: s.domain || '', date: fmtDt(s.leExpiry) });
      } else {
        certEl.style.background = 'var(--c-blue-light)';
        certEl.style.border = '1px solid var(--c-blue-border)';
        certEl.style.color = 'var(--c-blue-dark)';
        certEl.textContent = t('duckdns.currentCert') + s.cert.type;
      }
    } else {
      certEl.style.display = 'none';
    }
  } catch (e) {
    /* non-admin */
  }
}
// ── Harvest feed ─────────────────────────────────────────────────────────────
async function loadHarvestFeedSettings() {
  try {
    const r = await authFetch('/api/harvest-feed/config');
    if (!r.ok) return;
    const cfg = await r.json();
    document.getElementById('harvestfeed-enabled').checked = !!cfg.enabled;
    document.getElementById('harvestfeed-url').value = cfg.url || '';
    document.getElementById('harvestfeed-interval').value = cfg.intervalMin ?? 15;
    document.getElementById('harvestfeed-fresh').value = cfg.freshDays ?? 3;
    document.getElementById('harvestfeed-planned').value = cfg.plannedDays ?? 28;
    document.getElementById('harvestfeed-lead').value = cfg.leadDays ?? 0;
    document.getElementById('harvestfeed-strain').checked = cfg.strain !== false;
    document.getElementById('harvestfeed-site').value = cfg.site || '';
    const sec = document.getElementById('harvestfeed-secret');
    sec.value = '';
    // A stored secret is never sent back to the page. The placeholder says one
    // exists; leaving the field empty on save keeps it.
    sec.placeholder = cfg.hasSecret ? '••••••••••' : '';
    renderHarvestFeedBanner(cfg);
  } catch (e) {
    /* non-admin */
  }
}

// ── Released for sale ────────────────────────────────────────────────────────
//
// One row per species: how much of it the feed may offer. The rows are not only
// the ones already released — species harvested inside the fresh window are
// listed too, at zero, because "what did we harvest that nobody has released
// yet" is the question this screen exists to answer, and it cannot be answered
// by a list that only shows what has already been decided.
async function loadHarvestReleases() {
  const body = document.getElementById('harvestrelease-body');
  if (!body) return;
  const karte = document.getElementById('harvestrelease-card');
  try {
    const r = await authFetch('/api/harvest-feed/release');
    if (!r.ok) return;
    const data = await r.json();
    if (karte) karte.style.display = '';
    const rows = new Map();
    for (const rec of data.recent || []) rows.set(rec.species, { species: rec.species, harvested: rec.grams });
    for (const rel of data.releases || []) {
      const row = rows.get(rel.species) || { species: rel.species, harvested: null };
      rows.set(rel.species, { ...row, ...rel });
    }
    renderHarvestReleases([...rows.values()].sort((a, b) => a.species.localeCompare(b.species)));
    knownSpecies = data.known || [];
    fillHarvestReleasePicker();
  } catch (e) {
    /* non-admin */
  }
}

// The species this database knows, verbatim. Held so the picker can be refilled
// after every render without another round trip — adding a row changes what is
// left to offer, and that has to be visible immediately or the same species can
// be added twice.
let knownSpecies = [];

function fillHarvestReleasePicker() {
  const wahl = document.getElementById('harvestrelease-new');
  if (!wahl) return;
  const body = document.getElementById('harvestrelease-body');
  const drin = new Set([...body.querySelectorAll('tr[data-species]')].map((tr) => tr.dataset.species));
  const offen = knownSpecies.filter((s) => !drin.has(s));
  // Disabled with a reason beats an empty list that looks broken. "Nothing left
  // to add" and "this database has no species yet" are different situations and
  // the person in front of it can only act on one of them.
  wahl.disabled = offen.length === 0;
  wahl.innerHTML =
    '<option value="">' +
    esc(t(offen.length ? 'harvestFeed.addSpecies' : knownSpecies.length ? 'harvestFeed.allListed' : 'harvestFeed.noSpecies')) +
    '</option>' +
    offen.map((s) => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
}

function renderHarvestReleases(rows) {
  const body = document.getElementById('harvestrelease-body');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" style="color:var(--c-text-muted)">' + esc(t('harvestFeed.noRelease')) + '</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((row) => {
      // Kilograms in the form, grams on the wire. The scale reads grams and the
      // feed carries grams; a shop lists kilos. Converting in one place beats a
      // unit that changes meaning halfway through the stack.
      const kg = row.grams ? (row.grams / 1000).toFixed(2) : '';
      const harvested = row.harvested == null ? '—' : (row.harvested / 1000).toFixed(2) + ' kg';
      const warn = row.expired ? ' style="color:var(--c-red-dark)"' : '';
      return (
        '<tr data-species="' +
        esc(row.species) +
        '" data-harvested="' +
        (row.harvested == null ? '' : row.harvested) +
        // What was loaded, so saving can tell an edit from an untouched row.
        '" data-was-kg="' +
        kg +
        '" data-was-until="' +
        esc(row.validUntil || '') +
        '"><td>' +
        esc(row.species) +
        (row.expired ? ' <span' + warn + '>(' + esc(t('harvestFeed.expired')) + ')</span>' : '') +
        '</td><td style="color:var(--c-text-muted)">' +
        harvested +
        '</td><td><input type="number" class="hr-kg" step="0.01" min="0" style="width:90px" value="' +
        kg +
        '"></td><td><input type="date" class="hr-until" style="width:150px" value="' +
        esc(row.validUntil || '') +
        '"></td><td><button class="btn btn-sm hr-clear" data-i18n="harvestFeed.clear">' +
        esc(t('harvestFeed.clear')) +
        '</button></td></tr>'
      );
    })
    .join('');
  body.querySelectorAll('.hr-clear').forEach((b) =>
    b.addEventListener('click', () => {
      const tr = b.closest('tr');
      tr.querySelector('.hr-kg').value = '';
      tr.querySelector('.hr-until').value = '';
    })
  );
}

function showHarvestReleaseResult(msg, color) {
  const el = document.getElementById('harvestrelease-result');
  el.style.display = 'block';
  el.style.color = color || 'var(--c-text-muted)';
  el.textContent = msg;
}

async function saveHarvestReleases() {
  const rows = [...document.querySelectorAll('#harvestrelease-body tr[data-species]')];
  const bad = rows.find((tr) => {
    const v = tr.querySelector('.hr-kg').value.trim();
    return v !== '' && !(Number(v) >= 0);
  });
  if (bad) {
    showHarvestReleaseResult(t('harvestFeed.badAmount'), 'var(--c-red-dark)');
    return;
  }
  // Only the rows somebody actually touched. Posting all of them would stamp
  // `updated` on decisions nobody revisited — and it would create a zero row for
  // every species ever harvested, turning the table into a list of everything
  // that was never released.
  const changed = rows.filter((tr) => {
    const kg = tr.querySelector('.hr-kg').value.trim();
    const until = tr.querySelector('.hr-until').value;
    return kg !== tr.dataset.wasKg || until !== tr.dataset.wasUntil;
  });
  if (!changed.length) {
    showHarvestReleaseResult(t('harvestFeed.nothingChanged'), 'var(--c-text-muted)');
    return;
  }
  showHarvestReleaseResult(t('harvestFeed.saving'), 'var(--c-text-muted)');
  try {
    for (const tr of changed) {
      const raw = tr.querySelector('.hr-kg').value.trim();
      await apiPost('/api/harvest-feed/release', {
        species: tr.dataset.species,
        grams: raw === '' ? 0 : Math.round(Number(raw) * 1000),
        validUntil: tr.querySelector('.hr-until').value || null
      });
    }
    showHarvestReleaseResult(t('harvestFeed.saved'), 'var(--c-green-dark)');
    loadHarvestReleases();
  } catch (e) {
    showHarvestReleaseResult(t('common.error') + ': ' + e.message, 'var(--c-red-dark)');
  }
}

function addHarvestReleaseRow() {
  const input = document.getElementById('harvestrelease-new');
  const species = input.value;
  if (!species) return;
  const body = document.getElementById('harvestrelease-body');
  if (body.querySelector('tr[data-species="' + CSS.escape(species) + '"]')) {
    showHarvestReleaseResult(t('harvestFeed.alreadyListed'), 'var(--c-amber-dark)');
    return;
  }
  // Straight into the table rather than straight to the server: an empty row
  // that is never saved costs nothing, and until the amount is filled in there
  // is nothing to save.
  const existing = [...body.querySelectorAll('tr[data-species]')].map((tr) => ({
    species: tr.dataset.species,
    // Carried in the row rather than refetched: re-rendering must not quietly
    // turn every "2.40 kg harvested" into a dash.
    harvested: tr.dataset.harvested === '' ? null : Number(tr.dataset.harvested),
    grams: Math.round(Number(tr.querySelector('.hr-kg').value || 0) * 1000),
    validUntil: tr.querySelector('.hr-until').value || null
  }));
  existing.push({ species, harvested: null, grams: 0, validUntil: null });
  renderHarvestReleases(existing.sort((a, b) => a.species.localeCompare(b.species)));
  fillHarvestReleasePicker();
}

function renderHarvestFeedBanner(cfg) {
  const banner = document.getElementById('harvestfeed-status-banner');
  // Configured through the environment: the form below is not what is running,
  // and saying so beats an empty form on a server that is busily posting.
  if (cfg.envActive) {
    banner.style.display = 'block';
    banner.style.background = 'var(--c-amber-light)';
    banner.style.border = '1px solid var(--c-amber-border)';
    banner.style.color = 'var(--c-amber-dark)';
    banner.textContent = t('harvestFeed.envActive');
    return;
  }
  if (!cfg.enabled) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'block';
  if (cfg.lastOk === true) {
    banner.style.background = 'var(--c-primary-light)';
    banner.style.border = '1px solid var(--c-green-border)';
    banner.style.color = 'var(--c-green-dark)';
    banner.textContent = t('harvestFeed.lastOk') + ' ' + (cfg.lastAt ? fmtDtTime(cfg.lastAt) : '');
  } else if (cfg.lastOk === false) {
    banner.style.background = 'var(--c-red-light)';
    banner.style.border = '1px solid var(--c-red-border)';
    banner.style.color = 'var(--c-red-dark)';
    banner.textContent =
      t('harvestFeed.lastFailed') +
      ' ' +
      (cfg.lastAt ? fmtDtTime(cfg.lastAt) : '') +
      (cfg.lastError ? ' — ' + cfg.lastError : '');
  } else {
    banner.style.background = 'var(--c-amber-light)';
    banner.style.border = '1px solid var(--c-amber-border)';
    banner.style.color = 'var(--c-amber-dark)';
    banner.textContent = t('harvestFeed.neverSent');
  }
}

function showHarvestFeedResult(msg, color) {
  const el = document.getElementById('harvestfeed-result');
  el.style.display = 'block';
  el.style.color = color || '#888';
  el.textContent = msg;
}

function generateHarvestFeedSecret() {
  // 32 random bytes as hex. Generated here rather than asked for, because a
  // secret someone thinks up is a secret someone can guess — and this one is
  // copied into another system once and then never typed again.
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const hex = Array.from(raw)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const el = document.getElementById('harvestfeed-secret');
  el.type = 'text';
  el.value = hex;
  showHarvestFeedResult(t('harvestFeed.generated'), 'var(--c-amber-dark)');
}

async function saveHarvestFeedSettings() {
  const secret = document.getElementById('harvestfeed-secret').value.trim();
  const cfg = {
    enabled: document.getElementById('harvestfeed-enabled').checked,
    url: document.getElementById('harvestfeed-url').value.trim(),
    intervalMin: parseInt(document.getElementById('harvestfeed-interval').value, 10),
    freshDays: parseInt(document.getElementById('harvestfeed-fresh').value, 10),
    plannedDays: parseInt(document.getElementById('harvestfeed-planned').value, 10),
    leadDays: parseInt(document.getElementById('harvestfeed-lead').value, 10),
    strain: document.getElementById('harvestfeed-strain').checked,
    site: document.getElementById('harvestfeed-site').value.trim()
  };
  if (secret) cfg.secret = secret;
  try {
    const r = await apiPost('/api/harvest-feed/config', cfg);
    if (r.error) {
      showHarvestFeedResult(t('common.error') + ': ' + r.error, 'var(--c-red-dark)');
      return;
    }
    showHarvestFeedResult(t('harvestFeed.saved'), 'var(--c-green-dark)');
    document.getElementById('harvestfeed-secret').type = 'password';
    loadHarvestFeedSettings();
  } catch (e) {
    showHarvestFeedResult(t('common.error') + ': ' + e.message, 'var(--c-red-dark)');
  }
}

/**
 * `previewOnly` goes to a different endpoint, not a different flag on the same
 * one. "Show what would be sent" that sends is a button whose label is a lie,
 * and this is the button people press when they are not yet sure they want the
 * feed on at all.
 */
async function testHarvestFeed(previewOnly) {
  const pre = document.getElementById('harvestfeed-payload');
  showHarvestFeedResult(t(previewOnly ? 'harvestFeed.building' : 'harvestFeed.sending'), 'var(--c-text-muted)');
  try {
    const r = await apiPost(previewOnly ? '/api/harvest-feed/preview' : '/api/harvest-feed/test', {});
    if (r.error) {
      showHarvestFeedResult(t('common.error') + ': ' + r.error, 'var(--c-red-dark)');
      pre.style.display = 'none';
      return;
    }
    if (r.payload) {
      pre.style.display = 'block';
      pre.textContent = JSON.stringify(r.payload, null, 2);
    }
    if (previewOnly) {
      showHarvestFeedResult(t('harvestFeed.previewOk') + ' ' + r.harvested + ' / ' + r.planned, 'var(--c-text-muted)');
      return;
    }
    if (r.ok) {
      showHarvestFeedResult(t('harvestFeed.testOk') + ' ' + r.harvested + ' / ' + r.planned, 'var(--c-green-dark)');
    } else {
      showHarvestFeedResult(t('harvestFeed.testFailed') + ': ' + (r.error || ''), 'var(--c-red-dark)');
    }
    loadHarvestFeedSettings();
  } catch (e) {
    showHarvestFeedResult(t('common.error') + ': ' + e.message, 'var(--c-red-dark)');
  }
}

function showDuckdnsStatus(msg, color) {
  const el = document.getElementById('duckdns-ip-status');
  el.style.display = 'block';
  el.style.color = color || '#888';
  el.textContent = msg;
  setTimeout(() => {
    el.style.display = 'none';
  }, 8000);
}
function showLeStatus(msg, color) {
  const el = document.getElementById('le-status');
  el.style.display = 'block';
  el.style.color = color || '#888';
  el.textContent = msg;
  setTimeout(() => {
    el.style.display = 'none';
  }, 15000);
}
async function saveDuckdnsSettings() {
  const tokenVal = document.getElementById('duckdns-token').value.trim();
  const cfg = {
    enabled: document.getElementById('duckdns-enabled').checked,
    domain: document.getElementById('duckdns-domain').value.trim().toLowerCase(),
    leEnabled: document.getElementById('duckdns-le-enabled').checked
  };
  if (tokenVal) cfg.token = tokenVal;
  if (cfg.enabled && !cfg.domain) {
    showDuckdnsStatus(t('duckdns.subdomainRequired'), 'var(--c-red-dark)');
    return;
  }
  if (cfg.enabled && !tokenVal && !document.getElementById('duckdns-token').placeholder) {
    showDuckdnsStatus(t('duckdns.tokenRequired'), 'var(--c-red-dark)');
    return;
  }
  try {
    const r = await apiPost('/api/duckdns/config', cfg);
    if (r.error) {
      showDuckdnsStatus(t('common.error') + ': ' + r.error, 'var(--c-red-dark)');
    } else {
      showDuckdnsStatus(t('duckdns.saved'), 'var(--c-green-dark)');
      refreshDuckdnsStatus();
    }
  } catch (e) {
    showDuckdnsStatus('Fehler: ' + e.message, 'var(--c-red-dark)');
  }
}
async function triggerDuckdnsUpdate() {
  const btn = document.getElementById('duckdns-update-btn');
  btn.disabled = true;
  btn.textContent = t('duckdns.updating');
  showDuckdnsStatus(t('duckdns.sendingIp'), '#888');
  try {
    const r = await authFetch('/api/duckdns/update-ip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await r.json();
    if (data.error) {
      showDuckdnsStatus(t('common.error') + ': ' + data.error, 'var(--c-red-dark)');
    } else {
      showDuckdnsStatus(t('duckdns.ipUpdated'), 'var(--c-green-dark)');
      refreshDuckdnsStatus();
    }
  } catch (e) {
    showDuckdnsStatus(t('common.error') + ': ' + e.message, 'var(--c-red-dark)');
  } finally {
    btn.disabled = false;
    btn.textContent = t('duckdns.updateNow');
  }
}
async function requestLeCert() {
  const btn = document.getElementById('le-request-btn');
  btn.disabled = true;
  btn.textContent = t('le.requesting');
  showLeStatus(t('le.certRequesting'), '#888');
  try {
    const r = await authFetch('/api/duckdns/request-cert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await r.json();
    if (data.error) {
      showLeStatus(t('common.error') + ': ' + data.error, 'var(--c-red-dark)');
    } else {
      showLeStatus(t('le.certIssued', { domain: data.domain, date: fmtDt(data.expiry) }), 'var(--c-green-dark)');
      refreshDuckdnsStatus();
    }
  } catch (e) {
    showLeStatus(t('common.error') + ': ' + e.message, 'var(--c-red-dark)');
  } finally {
    btn.disabled = false;
    btn.textContent = t('le.requestNow');
  }
}

// ─── MCP TAB (admin-only) ───────────────────────────────────
function showMcpTab() {
  const btn = document.getElementById('st-settings-mcp');
  if (btn && currentUser && currentUser.role === 'admin') btn.style.display = '';
}

// ─── CAMERA TAB (admin-only WIP) ─────────────────────────────
// Surfaces what the Python mushroom_camera module writes into camera_* tables
// and lets admins edit calibration values + manage the cameras list. The
// detection/measurement loop is external; this dashboard does not run it.
const _cam = {
  calibration: null,
  cameras: [],
  editingId: null,
  pxDistance: null
};

const CAM_CALIB_FIELDS = [
  ['pxPerMm', 'cam.pxPerMm', 'real'],
  ['incubationBagRadiusPx', 'cam.incubationBagRadiusPx', 'int'],
  ['qrAssignRadiusPx', 'cam.qrAssignRadiusPx', 'int'],
  ['yoloConfThreshold', 'cam.yoloConfThreshold', 'real'],
  ['pinMaxAreaRatio', 'cam.pinMaxAreaRatio', 'real'],
  ['harvestGrowthThresholdPct', 'cam.harvestGrowthThresholdPct', 'real'],
  ['harvestStallReadings', 'cam.harvestStallReadings', 'int'],
  ['colonisationScoreThreshold', 'cam.colonisationScoreThreshold', 'real'],
  ['colonisationMinFraction', 'cam.colonisationMinFraction', 'real'],
  ['unseenBagAlertHours', 'cam.unseenBagAlertHours', 'int'],
  ['contamConfThreshold', 'cam.contamConfThreshold', 'real']
];

function showCameraTab() {
  const btn = document.getElementById('st-settings-camera');
  if (btn && currentUser && currentUser.role === 'admin') btn.style.display = '';
}

async function loadCameraTab() {
  if (!currentUser || currentUser.role !== 'admin') return;
  let data;
  try {
    const r = await authFetch('/api/camera/dashboard');
    data = await r.json();
  } catch (e) {
    document.getElementById('cam-stats').textContent = t('common.error') + ': ' + (e.message || '');
    return;
  }
  _cam.calibration = data.calibration;
  _cam.cameras = data.cameras || [];
  renderCameraStats(data.stats);
  renderCameraList(_cam.cameras);
  renderCameraCalibForm(_cam.calibration);
  renderCameraFlags(data.flags);
  renderCameraRecent(data.recentMeasurements || []);
}

function renderCameraStats(s) {
  const el = document.getElementById('cam-stats');
  if (!el) return;
  if (!s) {
    el.textContent = t('common.error');
    return;
  }
  const cell = (label, value) =>
    `<div class="card" style="padding:10px;margin:0">
      <div style="font-size:11px;color:var(--c-text-muted)">${esc(label)}</div>
      <div style="font-size:18px;font-weight:600;color:var(--c-text)">${esc(String(value))}</div>
    </div>`;
  el.innerHTML =
    cell(t('cam.statCameras'), s.enabledCameras + ' / ' + s.cameras) +
    cell(t('cam.statMeasurements7d'), s.measurementsLast7) +
    cell(t('cam.statSnapshots7d'), s.snapshotsLast7) +
    cell(t('cam.statOpenHarvest'), s.openHarvestFlags) +
    cell(t('cam.statOpenFruiting'), s.openFruitingFlags) +
    cell(t('cam.statLabelled'), s.labelledSamples);
}

function renderCameraList(list) {
  const el = document.getElementById('cam-list');
  if (!el) return;
  if (!list.length) {
    el.innerHTML =
      '<div style="font-size:13px;color:var(--c-text-muted);padding:8px 0">' + esc(t('cam.noCameras')) + '</div>';
    return;
  }
  const rows = list
    .map((c) => {
      const zone = c.zoneId ? esc(zoneDisplayName(c.zoneId)) : '<span style="color:var(--c-text-muted)">—</span>';
      const masked = maskRtspUrl(c.rtspUrl);
      const stateBadge = c.enabled
        ? `<span class="badge" style="background:#dcfce7;color:#166534">${esc(t('cam.enabled'))}</span>`
        : `<span class="badge" style="background:#fef3c7;color:#92400e">${esc(t('cam.disabled'))}</span>`;
      return `<div class="card" style="padding:10px;margin-bottom:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <div style="font-weight:600">${esc(c.name)} ${stateBadge}</div>
            <div style="font-size:11px;color:var(--c-text-muted);font-family:monospace;word-break:break-all">${esc(masked)}</div>
            <div style="font-size:11px;color:var(--c-text-muted)">${esc(t('cam.fieldZone'))}: ${zone}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm" data-cam-edit="${c.id}" data-i18n="cam.edit">Edit</button>
            <button class="btn btn-sm btn-r" data-cam-delete="${c.id}" data-i18n="cam.delete">Delete</button>
          </div>
        </div>`;
    })
    .join('');
  el.innerHTML = rows;
  el.querySelectorAll('[data-cam-edit]').forEach((b) =>
    b.addEventListener('click', () => openCameraEdit(parseInt(b.dataset.camEdit, 10)))
  );
  el.querySelectorAll('[data-cam-delete]').forEach((b) =>
    b.addEventListener('click', () => deleteCamera(parseInt(b.dataset.camDelete, 10)))
  );
}

function maskRtspUrl(url) {
  // Hide credentials (rtsp://user:pass@host -> rtsp://***@host) so admins
  // sharing screenshots don't leak passwords.
  if (!url) return '';
  return url.replace(/^(rtsp?:\/\/)([^:]+):([^@]+)@/i, '$1***:***@');
}

function renderCameraCalibForm(c) {
  const wrap = document.getElementById('cam-calib-form');
  if (!wrap) return;
  if (!c) {
    wrap.textContent = t('common.error');
    return;
  }
  wrap.innerHTML = CAM_CALIB_FIELDS.map(([key, label, kind]) => {
    const step = kind === 'int' ? '1' : '0.01';
    const val = c[key] != null ? c[key] : '';
    return `<div>
        <label style="font-size:12px;font-weight:600;display:block" data-i18n="${label}">${esc(key)}</label>
        <input type="number" step="${step}" min="0" data-cam-calib="${key}" value="${esc(String(val))}" style="width:100%" />
      </div>`;
  }).join('');
  translatePage();
  const ts = c.updatedAt ? new Date(c.updatedAt).toLocaleString(loc()) : '—';
  document.getElementById('cam-calib-status').textContent = t('cam.lastUpdated') + ': ' + ts;
}

async function saveCameraCalibration() {
  const inputs = document.querySelectorAll('[data-cam-calib]');
  const patch = {};
  for (const el of inputs) {
    const v = el.value.trim();
    if (v === '') continue;
    const num = Number(v);
    if (!Number.isFinite(num) || num < 0) {
      document.getElementById('cam-calib-status').textContent = t('cam.invalidValue') + ': ' + el.dataset.camCalib;
      return;
    }
    patch[el.dataset.camCalib] = num;
  }
  try {
    const r = await authFetch('/api/camera/calibration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      document.getElementById('cam-calib-status').textContent = t('common.error') + ': ' + (err.error || r.status);
      return;
    }
    const updated = await r.json();
    _cam.calibration = updated;
    renderCameraCalibForm(updated);
    document.getElementById('cam-calib-status').textContent = t('cam.saved');
  } catch (e) {
    document.getElementById('cam-calib-status').textContent = t('common.error') + ': ' + (e.message || '');
  }
}

function renderCameraFlags(flags) {
  const el = document.getElementById('cam-flags');
  if (!el) return;
  if (!flags || ((!flags.harvest || !flags.harvest.length) && (!flags.fruiting || !flags.fruiting.length))) {
    el.innerHTML = '<div style="font-size:13px;color:var(--c-text-muted)">' + esc(t('cam.noOpenFlags')) + '</div>';
    return;
  }
  const row = (kind, f) => {
    const ago = f.flaggedAt ? new Date(f.flaggedAt).toLocaleString(loc()) : '—';
    const extra =
      kind === 'harvest'
        ? f.predictedHarvestAt
          ? esc(t('cam.predicted')) + ': ' + new Date(f.predictedHarvestAt).toLocaleString(loc())
          : ''
        : f.peakScore != null
          ? esc(t('cam.peakScore')) + ': ' + Number(f.peakScore).toFixed(2)
          : '';
    return `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--c-border)">
        <div style="flex:1;min-width:180px">
          <div><b>${esc(f.bagId)}</b> <span style="color:var(--c-text-muted)">${esc(f.batchId || '')}</span></div>
          <div style="font-size:11px;color:var(--c-text-muted)">${esc(ago)}${extra ? ' · ' + extra : ''}</div>
        </div>
        <button class="btn btn-sm" data-cam-resolve="${kind}:${f.id}" data-i18n="cam.resolve">Resolve</button>
      </div>`;
  };
  let html = '';
  if (flags.harvest && flags.harvest.length) {
    html +=
      '<div style="font-weight:600;margin-bottom:4px">' +
      esc(t('cam.harvestFlags')) +
      '</div>' +
      flags.harvest.map((f) => row('harvest', f)).join('');
  }
  if (flags.fruiting && flags.fruiting.length) {
    html +=
      '<div style="font-weight:600;margin:10px 0 4px">' +
      esc(t('cam.fruitingFlags')) +
      '</div>' +
      flags.fruiting.map((f) => row('fruiting', f)).join('');
  }
  el.innerHTML = html;
  translatePage();
  el.querySelectorAll('[data-cam-resolve]').forEach((b) =>
    b.addEventListener('click', async () => {
      const [kind, id] = b.dataset.camResolve.split(':');
      try {
        const r = await authFetch('/api/camera/flags/' + kind + '/' + id + '/resolve', { method: 'POST' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
        loadCameraTab();
      } catch (e) {
        alert(t('common.error') + ': ' + (e.message || ''));
      }
    })
  );
}

function renderCameraRecent(rows) {
  const el = document.getElementById('cam-recent');
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = '<div style="color:var(--c-text-muted)">' + esc(t('cam.noRecent')) + '</div>';
    return;
  }
  const head = `<thead><tr>
      <th>${esc(t('cam.colTime'))}</th>
      <th>${esc(t('cam.colBag'))}</th>
      <th>${esc(t('cam.colDiameter'))}</th>
      <th>${esc(t('cam.colCount'))}</th>
      <th>${esc(t('cam.colConf'))}</th>
    </tr></thead>`;
  const body = rows
    .map((m) => {
      const dt = m.capturedAt ? new Date(m.capturedAt).toLocaleString(loc()) : '—';
      const dia = m.capDiameterMm != null ? Number(m.capDiameterMm).toFixed(1) + ' mm' : '—';
      const conf = m.detectionConf != null ? (Number(m.detectionConf) * 100).toFixed(0) + '%' : '—';
      return `<tr>
          <td>${esc(dt)}</td>
          <td>${esc(m.bagId)}</td>
          <td>${esc(dia)}</td>
          <td>${esc(String(m.mushroomCount || 0))}</td>
          <td>${esc(conf)}</td>
        </tr>`;
    })
    .join('');
  el.innerHTML = '<div style="overflow-x:auto"><table>' + head + '<tbody>' + body + '</tbody></table></div>';
}

function openCameraEdit(id) {
  _cam.editingId = id || null;
  const cam = id ? _cam.cameras.find((c) => c.id === id) : null;
  document.getElementById('cam-edit-title').textContent = id ? t('cam.editCamera') : t('cam.addCamera');
  document.getElementById('cam-edit-name').value = cam ? cam.name : '';
  document.getElementById('cam-edit-rtsp').value = cam ? cam.rtspUrl : '';
  document.getElementById('cam-edit-enabled').checked = cam ? !!cam.enabled : true;
  document.getElementById('cam-edit-status').textContent = '';
  // Populate zone dropdown from existing zones
  const sel = document.getElementById('cam-edit-zone');
  sel.innerHTML =
    `<option value="">${esc(t('cam.zoneNone'))}</option>` +
    zones.map((z) => `<option value="${esc(z.id)}">${esc(z.name || z.id)}</option>`).join('');
  sel.value = cam && cam.zoneId ? cam.zoneId : '';
  document.getElementById('m-cam-edit').classList.add('open');
  setTimeout(() => document.getElementById('cam-edit-name').focus(), 0);
}

function closeCameraEdit() {
  document.getElementById('m-cam-edit').classList.remove('open');
  _cam.editingId = null;
}

async function saveCameraEdit() {
  const payload = {
    name: document.getElementById('cam-edit-name').value.trim(),
    rtspUrl: document.getElementById('cam-edit-rtsp').value.trim(),
    zoneId: document.getElementById('cam-edit-zone').value || null,
    enabled: document.getElementById('cam-edit-enabled').checked
  };
  if (!payload.name) {
    document.getElementById('cam-edit-status').textContent = t('cam.fieldName') + ': ' + t('common.required');
    return;
  }
  if (!payload.rtspUrl) {
    document.getElementById('cam-edit-status').textContent = t('cam.fieldRtsp') + ': ' + t('common.required');
    return;
  }
  try {
    const url = _cam.editingId ? '/api/camera/cameras/' + _cam.editingId : '/api/camera/cameras';
    const method = _cam.editingId ? 'PUT' : 'POST';
    const r = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      document.getElementById('cam-edit-status').textContent = err.error || 'HTTP ' + r.status;
      return;
    }
    closeCameraEdit();
    loadCameraTab();
  } catch (e) {
    document.getElementById('cam-edit-status').textContent = e.message || t('common.error');
  }
}

async function deleteCamera(id) {
  const cam = _cam.cameras.find((c) => c.id === id);
  if (!cam) return;
  if (!confirm(t('cam.confirmDelete', { name: cam.name }))) return;
  try {
    const r = await authFetch('/api/camera/cameras/' + id, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    loadCameraTab();
  } catch (e) {
    alert(t('common.error') + ': ' + (e.message || ''));
  }
}

// Pixel calibration helper: load image into canvas, click two endpoints,
// compute pixel distance, divide by user-entered mm to get px/mm.
function initCameraPxCalib() {
  const fileInput = document.getElementById('cam-calib-image');
  const canvas = document.getElementById('cam-calib-canvas');
  const pxLabel = document.getElementById('cam-calib-px');
  const mmInput = document.getElementById('cam-calib-mm');
  const applyBtn = document.getElementById('cam-calib-apply');
  if (!fileInput || !canvas || !pxLabel || !mmInput || !applyBtn) return;
  const ctx = canvas.getContext('2d');
  let img = null;
  let p1 = null;
  let p2 = null;

  function redraw() {
    if (!img) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    function dot(p, color) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (p1) dot(p1, '#ea580c');
    if (p2) dot(p2, '#0284c7');
    if (p1 && p2) {
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  }

  function updatePx() {
    if (p1 && p2) {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const px = Math.sqrt(dx * dx + dy * dy);
      _cam.pxDistance = px;
      pxLabel.style.display = '';
      pxLabel.textContent = t('cam.pxMeasured', { px: px.toFixed(1) });
      applyBtn.disabled = false;
    } else {
      _cam.pxDistance = null;
      pxLabel.style.display = 'none';
      applyBtn.disabled = true;
    }
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const im = new Image();
      im.onload = () => {
        // Cap canvas at 800px wide so it fits on small screens
        const maxW = 800;
        const scale = im.width > maxW ? maxW / im.width : 1;
        canvas.width = Math.round(im.width * scale);
        canvas.height = Math.round(im.height * scale);
        canvas.style.display = '';
        img = im;
        p1 = null;
        p2 = null;
        updatePx();
        redraw();
      };
      im.src = e.target.result;
    };
    reader.readAsDataURL(f);
  });

  canvas.addEventListener('click', (e) => {
    if (!img) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    if (!p1 || (p1 && p2)) {
      p1 = { x, y };
      p2 = null;
    } else {
      p2 = { x, y };
    }
    updatePx();
    redraw();
  });

  applyBtn.addEventListener('click', () => {
    if (!_cam.pxDistance) return;
    const mm = parseDecimal(mmInput.value);
    if (!Number.isFinite(mm) || mm <= 0) {
      alert(t('cam.invalidMm'));
      return;
    }
    const ratio = _cam.pxDistance / mm;
    const inp = document.querySelector('[data-cam-calib="pxPerMm"]');
    if (inp) {
      inp.value = ratio.toFixed(3);
      inp.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      document.getElementById('cam-calib-status').textContent = t('cam.calibratedFromImage', {
        ratio: ratio.toFixed(3)
      });
    }
  });
}

// ─── SERVER TAB ─────────────────────────────────────────────
function showServerTab() {
  const btn = document.getElementById('st-settings-server');
  if (btn && currentUser && currentUser.role === 'admin') btn.style.display = '';
}
async function loadServerTab() {
  const el = document.getElementById('server-info');
  if (!el) return;
  if (!currentUser || currentUser.role !== 'admin') {
    el.textContent = t('server.adminRequired');
    return;
  }
  try {
    const r = await authFetch('/api/health');
    const h = await r.json();
    const uptimeH = Math.floor(h.uptime / 3600);
    const uptimeM = Math.floor((h.uptime % 3600) / 60);
    const platLabel = h.platform === 'win32' ? 'Windows' : h.platform === 'darwin' ? 'macOS' : 'Linux';
    el.innerHTML =
      '<div><b>' +
      t('server.statusLabel') +
      ':</b> ' +
      esc(h.status) +
      '</div>' +
      '<div><b>' +
      t('server.versionLabel') +
      ':</b> ' +
      esc(h.version) +
      '</div>' +
      '<div><b>' +
      t('server.platformLabel') +
      ':</b> ' +
      platLabel +
      '</div>' +
      '<div><b>' +
      t('server.nodeLabel') +
      ':</b> ' +
      esc(h.nodeVersion || '–') +
      '</div>' +
      '<div><b>' +
      t('server.uptimeLabel') +
      ':</b> ' +
      uptimeH +
      'h ' +
      uptimeM +
      'm</div>' +
      '<div><b>' +
      t('server.sseLabel') +
      ':</b> ' +
      h.sseClients +
      '</div>' +
      (h.memory ? '<div><b>' + t('server.ramLabel') + ':</b> ' + h.memory.rss + ' MB</div>' : '');
  } catch (e) {
    el.textContent = t('server.loadError');
  }
}
async function runBatchIdMigration() {
  const renames = [];
  batches.forEach((b) => {
    // Use strainKuerzel stored on the batch itself (set at creation time).
    // Fall back to a strain lookup only if strainKuerzel is missing (e.g. very old batches).
    const kuerzel = b.strainKuerzel || (mushroomStrains.find((s) => s.id === b.strainId) || {}).kuerzel;
    if (!kuerzel) return;
    const isGrain = b.batchType === 'grain';
    const parts = b.batchId.split('-');
    if (parts.length < 2) return;
    // Detect the type prefix (if any) and extract kuerzel + date suffix.
    // Formats handled:
    //   block (new/current): SHII-100426-01       → no prefix
    //   grain (new):         G-SHII-100426-01     → parts[0]='G'
    //   grain (old, no sep): GSHII-100426-01      → parts[0] starts with 'G' and length>1
    let currentKuerzel, datePart, correctFormat;
    if (isGrain && parts[0] === 'G') {
      // New G- style
      currentKuerzel = parts[1];
      datePart = parts.slice(2).join('-');
      correctFormat = true;
    } else if (isGrain) {
      // Old style without separator: GSHII-... → strip leading G
      currentKuerzel = parts[0].slice(1);
      datePart = parts.slice(1).join('-');
      correctFormat = false;
    } else {
      currentKuerzel = parts[0];
      datePart = parts.slice(1).join('-');
      correctFormat = true;
    }
    if (currentKuerzel === kuerzel && correctFormat) return; // already correct
    const newId = isGrain ? 'G-' + kuerzel + '-' + datePart : kuerzel + '-' + datePart;
    renames.push({ oldId: b.batchId, newId });
  });
  // ── Culture kuerzel renames ──
  const cultureRenames = [];
  cultures.forEach((c) => {
    const kuerzel = c.strainKuerzel || (mushroomStrains.find((s) => s.id === c.strainId) || {}).kuerzel;
    if (!kuerzel) return;
    const parts = c.id.split('-');
    // Format: TYPE-KUERZEL-[STRAINTEXT-]DDMMYY-NN → parts[1] is always kuerzel
    if (parts.length < 3) return;
    const currentKuerzel = parts[1];
    if (currentKuerzel === kuerzel) return; // already correct
    const newId = parts[0] + '-' + kuerzel + '-' + parts.slice(2).join('-');
    cultureRenames.push({ oldId: c.id, newId });
  });

  if (!renames.length && !cultureRenames.length) {
    alert(t('migrate.alreadyCurrent'));
    return;
  }
  let preview = '';
  if (renames.length)
    preview += '── Batches (' + renames.length + ') ──\n' + renames.map((r) => `${r.oldId}  →  ${r.newId}`).join('\n');
  if (renames.length && cultureRenames.length) preview += '\n\n';
  if (cultureRenames.length)
    preview +=
      '── Cultures (' +
      cultureRenames.length +
      ') ──\n' +
      cultureRenames.map((r) => `${r.oldId}  →  ${r.newId}`).join('\n');
  if (!confirm(t('migrate.confirm') + '\n\n' + preview)) return;
  let done = 0,
    failed = 0,
    failedList = [];
  // Hold _mutating elevated for the whole loop so SSE-triggered pollSync cannot
  // overwrite in-memory state between individual rename requests.
  // apiPost internally does its own _mutating++/--, so the net value stays ≥1 throughout.
  _mutating++;
  try {
    for (const { oldId, newId } of renames) {
      try {
        const r = await apiPost('/api/batches/' + encodeURIComponent(oldId) + '/rename', { newId });
        if (!r || r.error) {
          failed++;
          failedList.push(oldId + ': ' + ((r && r.error) || 'unknown error'));
          continue;
        }
        batches.forEach((b) => {
          if (b.batchId === oldId) {
            const oldBags = b.bags || [];
            b.batchId = newId;
            b.bags = oldBags.map((bag) => bag.replace(oldId, newId));
            // Update barcode registry: re-key renamed bags
            oldBags.forEach((oldBag, i) => {
              const newBag = b.bags[i];
              const bc = barcodeByEntity.get('bag:' + oldBag);
              if (bc != null) {
                barcodeByEntity.delete('bag:' + oldBag);
                barcodeByEntity.set('bag:' + newBag, bc);
                barcodeRegistry.set(bc, { type: 'bag', id: newBag });
              }
            });
          }
        });
        scanLog.forEach((e) => {
          if (e.batch === oldId) {
            e.batch = newId;
            if (e.bag) e.bag = e.bag.replace(oldId, newId);
          }
        });
        movements.forEach((e) => {
          if (e.batch === oldId) {
            e.batch = newId;
            if (e.bag) e.bag = e.bag.replace(oldId, newId);
          }
        });
        harvests.forEach((h) => {
          if (h.batch === oldId) {
            h.batch = newId;
            if (h.bag) h.bag = h.bag.replace(oldId, newId);
          }
        });
        done++;
      } catch (e) {
        failed++;
        failedList.push(oldId + ': ' + e.message);
      }
    }
    // Rename cultures
    for (const { oldId, newId } of cultureRenames) {
      try {
        const r = await apiPost('/api/cultures/' + encodeURIComponent(oldId) + '/rename', { newId });
        if (!r || r.error) {
          failed++;
          failedList.push(oldId + ': ' + ((r && r.error) || 'unknown error'));
          continue;
        }
        cultures.forEach((c) => {
          if (c.id === oldId) c.id = newId;
          if (c.parentId === oldId) c.parentId = newId;
        });
        batches.forEach((b) => {
          if (b.sourceId === oldId) b.sourceId = newId;
        });
        const bc = barcodeByEntity.get('culture:' + oldId);
        if (bc != null) {
          barcodeByEntity.delete('culture:' + oldId);
          barcodeByEntity.set('culture:' + newId, bc);
          barcodeRegistry.set(bc, { type: 'culture', id: newId });
        }
        done++;
      } catch (e) {
        failed++;
        failedList.push(oldId + ': ' + e.message);
      }
    }
  } finally {
    _mutating--;
  }
  renderBatches();
  renderCultures();
  renderStatus();
  if (failed) {
    alert(t('migrate.complete') + done + ' renamed, ' + failed + ' errors:\n\n' + failedList.join('\n'));
  } else {
    const total = renames.length + cultureRenames.length;
    alert(t('migrate.success') + total + ' IDs renamed.');
  }
}

async function runStrainTextMigration() {
  // ── Batch renames ──
  const batchRenames = [];
  batches.forEach((b) => {
    const st = (b.strainText || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!st) return;
    const kuerzel = b.strainKuerzel || b.strain || '';
    if (!kuerzel) return;
    const isGrain = b.batchType === 'grain';
    const parts = b.batchId.split('-');
    if (b.batchId.toUpperCase().includes('-' + st + '-')) return;
    let newId;
    if (isGrain && parts[0] === 'G' && parts.length >= 4) {
      newId = parts[0] + '-' + parts[1] + '-' + st + '-' + parts.slice(2).join('-');
    } else if (!isGrain && parts.length >= 3) {
      newId = parts[0] + '-' + st + '-' + parts.slice(1).join('-');
    } else {
      return;
    }
    batchRenames.push({ oldId: b.batchId, newId });
  });

  // ── Culture renames ──
  const cultureRenames = [];
  cultures.forEach((c) => {
    const st = (c.strainText || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!st) return;
    const parts = c.id.split('-');
    // Format: TYPE-ABBREV-DDMMYY-NN (4 parts)
    if (parts.length < 4) return;
    if (c.id.toUpperCase().includes('-' + st + '-')) return;
    // TYPE-ABBREV-STRAIN-DDMMYY-NN
    const newId = parts[0] + '-' + parts[1] + '-' + st + '-' + parts.slice(2).join('-');
    cultureRenames.push({ oldId: c.id, newId });
  });

  if (!batchRenames.length && !cultureRenames.length) {
    alert('All IDs are already up to date — nothing to migrate.');
    return;
  }
  let preview = '';
  if (batchRenames.length)
    preview +=
      '── Batches (' +
      batchRenames.length +
      ') ──\n' +
      batchRenames.map((r) => r.oldId + '  →  ' + r.newId).join('\n') +
      '\n\n';
  if (cultureRenames.length)
    preview +=
      '── Cultures (' +
      cultureRenames.length +
      ') ──\n' +
      cultureRenames.map((r) => r.oldId + '  →  ' + r.newId).join('\n');
  const total = batchRenames.length + cultureRenames.length;
  if (!confirm(total + ' IDs will be renamed.\nBarcodes will NOT be changed.\n\n' + preview)) return;

  let done = 0,
    failed = 0,
    failedList = [];
  _mutating++;
  try {
    // Rename batches
    for (const { oldId, newId } of batchRenames) {
      try {
        const r = await apiPost('/api/batches/' + encodeURIComponent(oldId) + '/rename', { newId });
        if (!r || r.error) {
          failed++;
          failedList.push(oldId + ': ' + ((r && r.error) || 'unknown error'));
          continue;
        }
        batches.forEach((b) => {
          if (b.batchId === oldId) {
            const oldBags = b.bags || [];
            b.batchId = newId;
            b.bags = oldBags.map((bag) => bag.replace(oldId, newId));
            oldBags.forEach((oldBag, i) => {
              const newBag = b.bags[i];
              const bc = barcodeByEntity.get('bag:' + oldBag);
              if (bc != null) {
                barcodeByEntity.delete('bag:' + oldBag);
                barcodeByEntity.set('bag:' + newBag, bc);
                barcodeRegistry.set(bc, { type: 'bag', id: newBag });
              }
            });
          }
        });
        scanLog.forEach((e) => {
          if (e.batch === oldId) {
            e.batch = newId;
            if (e.bag) e.bag = e.bag.replace(oldId, newId);
          }
        });
        movements.forEach((e) => {
          if (e.batch === oldId) {
            e.batch = newId;
            if (e.bag) e.bag = e.bag.replace(oldId, newId);
          }
        });
        harvests.forEach((h) => {
          if (h.batch === oldId) {
            h.batch = newId;
            if (h.bag) h.bag = h.bag.replace(oldId, newId);
          }
        });
        done++;
      } catch (e) {
        failed++;
        failedList.push(oldId + ': ' + e.message);
      }
    }
    // Rename cultures
    for (const { oldId, newId } of cultureRenames) {
      try {
        const r = await apiPost('/api/cultures/' + encodeURIComponent(oldId) + '/rename', { newId });
        if (!r || r.error) {
          failed++;
          failedList.push(oldId + ': ' + ((r && r.error) || 'unknown error'));
          continue;
        }
        cultures.forEach((c) => {
          if (c.id === oldId) c.id = newId;
          if (c.parentId === oldId) c.parentId = newId;
        });
        batches.forEach((b) => {
          if (b.sourceId === oldId) b.sourceId = newId;
        });
        // Update barcode registry for the culture
        const bc = barcodeByEntity.get('culture:' + oldId);
        if (bc != null) {
          barcodeByEntity.delete('culture:' + oldId);
          barcodeByEntity.set('culture:' + newId, bc);
          barcodeRegistry.set(bc, { type: 'culture', id: newId });
        }
        done++;
      } catch (e) {
        failed++;
        failedList.push(oldId + ': ' + e.message);
      }
    }
  } finally {
    _mutating--;
  }
  renderBatches();
  renderCultures();
  renderStatus();
  if (failed) {
    alert('Done: ' + done + ' renamed, ' + failed + ' errors:\n\n' + failedList.join('\n'));
  } else {
    alert('Done: ' + done + ' IDs updated with strain text.');
  }
}

function restartServer() {
  confirm2(t('server.restartTitle'), t('server.restartMsg'), t('server.restartConfirm'), async () => {
    const btn = document.getElementById('btn-server-restart');
    const status = document.getElementById('server-restart-status');
    btn.disabled = true;
    btn.textContent = t('server.restarting');
    status.style.display = 'block';
    status.style.color = 'var(--c-text-muted)';
    status.textContent = t('server.updateStatus');
    try {
      await authFetch('/api/server/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      status.textContent = t('server.waitReconnect');
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch('/api/health');
          if (r.ok) {
            clearInterval(poll);
            window.location.reload();
          }
        } catch (e) {
          /* still down */
        }
        if (attempts > 60) {
          clearInterval(poll);
          status.textContent = t('server.noResponse');
          status.style.color = 'var(--c-red-dark)';
          btn.disabled = false;
          btn.textContent = t('server.updateBtn');
        }
      }, 3000);
    } catch (e) {
      status.textContent = t('common.error') + ': ' + e.message;
      status.style.color = 'var(--c-red-dark)';
      btn.disabled = false;
      btn.textContent = t('server.updateBtn');
    }
  });
}

// ─── MCP SETTINGS ───────────────────────────────────────────
let _mcpToken = '';
async function loadMcpSettings() {
  try {
    const r = await authFetch('/api/mcp/config');
    if (!r.ok) return;
    const cfg = await r.json();
    document.getElementById('mcp-enabled').checked = cfg.enabled;
    document.getElementById('mcp-url').value = cfg.connectorUrl || '';
    toggleMcpSections(cfg.enabled);
    const banner = document.getElementById('mcp-status-banner');
    if (cfg.enabled) {
      banner.style.display = 'block';
      banner.style.background = 'var(--c-primary-light)';
      banner.style.border = '1px solid var(--c-green-border)';
      banner.style.color = 'var(--c-green-dark)';
      banner.textContent = t('mcp.active');
    } else {
      banner.style.display = 'none';
    }
    const statusR = await authFetch('/api/mcp/status');
    if (statusR.ok) {
      const st = await statusR.json();
      if (st.activeSessions > 0) {
        banner.style.display = 'block';
        banner.style.background = 'var(--c-primary-light)';
        banner.style.border = '1px solid var(--c-green-border)';
        banner.style.color = 'var(--c-green-dark)';
        banner.textContent = t('mcp.sessions').replace('{n}', st.activeSessions);
      }
    }
    if (cfg.enabled) loadOAuthClients();
  } catch (e) {
    /* non-admin */
  }
}
function toggleMcpSections(enabled) {
  document.getElementById('mcp-url-section').style.display = enabled ? 'block' : 'none';
  document.getElementById('mcp-token-section').style.display = enabled ? 'block' : 'none';
  document.getElementById('mcp-guide-card').style.display = enabled ? 'block' : 'none';
  document.getElementById('mcp-diag-card').style.display = enabled ? 'block' : 'none';
  document.getElementById('mcp-oauth-card').style.display = enabled ? 'block' : 'none';
}
function showMcpStatus(msg, color) {
  const el = document.getElementById('mcp-status');
  el.style.display = 'block';
  el.style.color = color || '#888';
  el.textContent = msg;
  setTimeout(() => {
    el.style.display = 'none';
  }, 8000);
}
async function saveMcpSettings() {
  try {
    const r = await apiPost('/api/mcp/config', { enabled: document.getElementById('mcp-enabled').checked });
    if (r.error) {
      showMcpStatus(t('mcp.error').replace('{msg}', r.error), 'var(--c-red-dark)');
    } else {
      showMcpStatus(t('mcp.saved'), 'var(--c-green-dark)');
      loadMcpSettings();
    }
  } catch (e) {
    showMcpStatus(t('mcp.error').replace('{msg}', e.message), 'var(--c-red-dark)');
  }
}
async function generateMcpToken() {
  try {
    const r = await authFetch('/api/mcp/generate-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await r.json();
    if (data.error) {
      showMcpStatus(t('mcp.error').replace('{msg}', data.error), 'var(--c-red-dark)');
      return;
    }
    _mcpToken = data.token;
    document.getElementById('mcp-token-display').textContent = data.token;
    document.getElementById('mcp-token-display').style.display = 'block';
    document.getElementById('mcp-copy-token-btn').style.display = 'inline-flex';
    showMcpStatus(t('mcp.keyGenerated'), 'var(--c-green-dark)');
  } catch (e) {
    showMcpStatus(t('mcp.error').replace('{msg}', e.message), 'var(--c-red-dark)');
  }
}
async function revokeMcpToken() {
  if (!confirm(t('mcp.revokeKeyConfirm'))) return;
  try {
    const r = await authFetch('/api/mcp/token', { method: 'DELETE' });
    const data = await r.json();
    if (data.error) {
      showMcpStatus(t('mcp.error').replace('{msg}', data.error), 'var(--c-red-dark)');
      return;
    }
    _mcpToken = null;
    document.getElementById('mcp-token-display').textContent = '';
    document.getElementById('mcp-token-display').style.display = 'none';
    document.getElementById('mcp-copy-token-btn').style.display = 'none';
    showMcpStatus(t('mcp.keyRevoked'), 'var(--c-green-dark)');
  } catch (e) {
    showMcpStatus(t('mcp.error').replace('{msg}', e.message), 'var(--c-red-dark)');
  }
}

async function runMcpDiagnostics() {
  const el = document.getElementById('mcp-diag-result');
  el.innerHTML = '<p style="color:var(--c-text-muted)">' + t('mcp.diagRunning') + '</p>';
  try {
    const r = await authFetch('/api/mcp/diagnostics');
    if (!r.ok) {
      el.innerHTML = '<p style="color:var(--c-red-dark)">' + t('mcp.diagFailed') + '</p>';
      return;
    }
    const d = await r.json();
    let html = '<table style="width:100%;font-size:12px;border-collapse:collapse">';
    const row = (label, val, color) =>
      '<tr><td style="padding:4px 8px;font-weight:600;white-space:nowrap;vertical-align:top">' +
      label +
      '</td><td style="padding:4px 8px;color:' +
      (color || '#333') +
      '">' +
      val +
      '</td></tr>';
    const checks = d.checks || {};
    for (const [k, v] of Object.entries(checks)) {
      const pass = v.startsWith('PASS');
      html += row(k, esc(v), pass ? 'var(--c-green-dark)' : 'var(--c-red-dark)');
    }
    html += row('Protocol', esc(d.protocol));
    html += row(
      'Base URL',
      '<code style="font-size:11px;background:#f1f5f9;padding:1px 4px;border-radius:3px">' +
        esc(d.connectorUrl) +
        '</code>'
    );
    html += row(t('mcp.diagAutoClients'), String(d.oauthClients?.auto || 0));
    html += row(t('mcp.diagManualClients'), String(d.oauthClients?.manual || 0));
    html += row(t('mcp.diagSessions'), String(d.activeSessions || 0));
    html += '</table>';
    if (d.hint)
      html +=
        '<div style="margin-top:8px;padding:8px 10px;border-radius:6px;font-size:11px;background:var(--c-primary-light);border:1px solid var(--c-green-border);color:var(--c-green-dark)">' +
        esc(d.hint) +
        '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<p style="color:var(--c-red-dark)">Error: ' + esc(e.message) + '</p>';
  }
}

// ─── OAUTH CLIENT MANAGEMENT ────────────────────────────────
function showOAuthStatus(msg, color) {
  const el = document.getElementById('oauth-client-status');
  el.style.display = 'block';
  el.style.color = color || '#888';
  el.textContent = msg;
  setTimeout(() => {
    el.style.display = 'none';
  }, 8000);
}
async function loadOAuthClients() {
  try {
    const r = await authFetch('/api/mcp/oauth-clients');
    if (!r.ok) return;
    const data = await r.json();
    const list = document.getElementById('oauth-client-list');
    if (!list) return;
    if (!data.clients || data.clients.length === 0) {
      list.innerHTML = '<p style="color:var(--c-text-muted);font-size:12px">' + t('mcp.noClients') + '</p>';
      return;
    }
    list.innerHTML =
      '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>' +
      '<th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">' +
      t('mcp.clientName') +
      '</th>' +
      '<th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">Client ID</th>' +
      '<th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">' +
      t('mcp.created') +
      '</th>' +
      '<th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">' +
      t('mcp.activeSessions') +
      '</th>' +
      '<th style="padding:6px;border-bottom:1px solid var(--c-border)"></th></tr></thead><tbody>' +
      data.clients
        .map((c) => {
          const name = c.clientName || t('mcp.unnamed');
          return (
            '<tr>' +
            '<td style="padding:6px">' +
            esc(name) +
            '</td>' +
            '<td style="padding:6px;font-family:monospace">' +
            esc(c.clientId.slice(0, 8)) +
            '…</td>' +
            '<td style="padding:6px">' +
            esc(c.created ? c.created.slice(0, 10) : '') +
            '</td>' +
            '<td style="padding:6px;text-align:center">' +
            c.activeSessions +
            '</td>' +
            '<td style="padding:6px"><button class="btn btn-sm" style="font-size:11px;padding:2px 8px;color:var(--c-red-dark)" data-oauth-action="delete" data-client-id="' +
            esc(c.clientId) +
            '" data-auto="' +
            (c.autoRegistered ? 1 : 0) +
            '">' +
            t('mcp.deleteClient') +
            '</button></td></tr>'
          );
        })
        .join('') +
      '</tbody></table>';
    list.onclick = function (e) {
      const btn = e.target.closest('[data-oauth-action="delete"]');
      if (!btn) return;
      deleteOAuthClient(btn.dataset.clientId, btn.dataset.auto === '1');
    };
  } catch (e) {
    console.error('loadOAuthClients:', e);
  }
}
async function deleteOAuthClient(clientId, isAuto) {
  if (!confirm(isAuto ? t('mcp.confirmDeleteAuto') : t('mcp.confirmDelete'))) return;
  try {
    const r = await authFetch('/api/mcp/oauth-clients/' + encodeURIComponent(clientId), { method: 'DELETE' });
    const data = await r.json();
    if (data.error) {
      showOAuthStatus(t('mcp.error').replace('{msg}', data.error), 'var(--c-red-dark)');
      return;
    }
    showOAuthStatus(t('mcp.clientDeleted'), 'var(--c-green-dark)');
    loadOAuthClients();
  } catch (e) {
    showOAuthStatus(t('mcp.error').replace('{msg}', e.message), 'var(--c-red-dark)');
  }
}

// ─── SCAN LOG ────────────────────────────────────────────────
let logSortCol = 'time',
  logSortDir = 'desc',
  logDisplayLimit = 200;
function toggleLogSort(col) {
  if (logSortCol === col) logSortDir = logSortDir === 'desc' ? 'asc' : 'desc';
  else {
    logSortCol = col;
    logSortDir = 'desc';
  }
  renderLog();
}
function renderLog() {
  const q = (document.getElementById('log-q').value || '').toLowerCase();
  const actionF = document.getElementById('log-action-filter').value;
  const dateFrom = document.getElementById('log-date-from').value;
  const dateTo = document.getElementById('log-date-to').value;
  const body = document.getElementById('log-body');
  let items = [...scanLog];
  // Filters
  if (q) items = items.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
  if (actionF) items = items.filter((e) => e.action === actionF);
  if (dateFrom) items = items.filter((e) => e.time >= dateFrom);
  if (dateTo) items = items.filter((e) => e.time < dateTo + 'T23:59:59');
  // Sort
  const dir = logSortDir === 'desc' ? -1 : 1;
  items.sort((a, b) => {
    const av = a[logSortCol] || '',
      bv = b[logSortCol] || '';
    return av < bv ? -dir : av > bv ? dir : 0;
  });
  // Sort indicators
  document.querySelectorAll('[id^="log-sort-"]').forEach((el) => (el.textContent = ''));
  const si = document.getElementById('log-sort-' + logSortCol);
  if (si) si.textContent = logSortDir === 'desc' ? '▼' : '▲';
  // Count display
  const total = scanLog.length,
    filtered = items.length;
  const countEl = document.getElementById('log-count');
  if (countEl)
    countEl.textContent =
      filtered === total ? t('log.entries', { n: total }) : t('log.entriesFiltered', { n: filtered, total: total });
  // Paginate
  const hasMore = items.length > logDisplayLimit;
  items = items.slice(0, logDisplayLimit);
  const now = Date.now(),
    h24 = 24 * 60 * 60 * 1000;
  body.innerHTML = items.length
    ? items
        .map((e) => {
          const isRecent = now - new Date(e.time).getTime() < h24;
          return `<tr><td data-mlabel="${esc(t('settings.time'))}" class="lg-time" style="font-size:10px;color:var(--c-text-muted)">${fmtDtTime(e.time)}</td><td data-mlabel="${esc(t('settings.user'))}" style="font-size:11px">${esc(e.user) || '\u2014'}</td><td data-mlabel="${esc(t('settings.action'))}"><span class="badge ${e.action === 'ADD' ? 'b-add' : e.action === 'REMOVE' ? 'b-remove' : e.action === 'HARVEST' ? 'b-harvest' : 'b-move'}">${esc(e.action)}</span></td><td data-mlabel="${esc(t('batch.batchId'))}" style="font-family:monospace;font-size:10px">${esc(e.batch) || '\u2014'}</td><td data-mlabel="${esc(t('settings.bag'))}" style="font-family:monospace;font-size:10px">${esc(e.bag) || '\u2014'}</td><td data-mlabel="${esc(t('settings.from'))}">${esc(e.from) || '\u2014'}</td><td data-mlabel="${esc(t('settings.to'))}">${esc(e.to) || '\u2014'}</td><td data-mlabel="${esc(t('batch.species'))}">${e.species ? spDot(e.species) + esc(e.species) : '\u2014'}</td><td class="lg-actions">${isRecent ? '<button class="btn-xs" style="padding:2px 6px;font-size:10px" onclick="deleteLogEntry(this,\'' + esc(e.time) + "','" + esc(e.batch) + "','" + esc(e.action) + "','" + esc(e.bag || '') + '\')" title="' + t('common.delete') + '">✕</button>' : ''}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="9" class="empty">' + t('settings.noScans') + '</td></tr>';
  const loadMore = document.getElementById('log-load-more');
  if (loadMore) loadMore.style.display = hasMore ? 'block' : 'none';
}
function deleteLogEntry(btn, time, batch, action, bag) {
  confirm2(
    t('log.deleteEntry'),
    t('log.deleteEntryMsg', { action: action, batch: batch, time: fmtDtTime(time) }),
    t('common.delete'),
    () => {
      // Match on bag too: a bulk ADD/MOVE writes the same time+batch+action to
      // every bag, so without the bag the ✕ on one row deleted the first
      // matching row (and its server id) instead of the clicked one.
      const match = (e) => e.time === time && e.batch === batch && e.action === action && (e.bag || '') === bag;
      const idx = scanLog.findIndex(match);
      if (idx === -1) return;
      const entry = scanLog[idx];
      scanLog.splice(idx, 1);
      const mi = movements.findIndex(match);
      if (mi !== -1) movements.splice(mi, 1);
      const serverId = entry._serverId || entry.id;
      if (serverId) apiDelete('/api/scan-log/' + serverId);
      renderLog();
      renderStatus();
    }
  );
}
function clearLog() {
  confirm2(
    t('settings.clearLog'),
    t('settings.clearLogMsg', { n: scanLog.length }),
    t('settings.clearLogBtn'),
    async () => {
      await apiDelete('/api/scan-log');
      scanLog = [];
      renderLog();
    }
  );
}

// ─── INVENTORY ───────────────────────────────────────────────
const MAT_LABELS = { hardwood: 'Hardwood pellets', wheatbran: 'Wheat bran', gypsum: 'Gypsum', grain: 'Grain' };
const MAT_COLORS = { hardwood: '#92400e', wheatbran: '#166534', gypsum: '#1e40af', grain: '#6b21a8' };
const MAT_BG = { hardwood: '#fff7ed', wheatbran: '#f0fdf4', gypsum: '#eff6ff', grain: '#faf5ff' };
const MAT_BORDER = { hardwood: '#fed7aa', wheatbran: '#bbf7d0', gypsum: '#bfdbfe', grain: '#e9d5ff' };

function invLog(mat, deltaKg, type, ref, time) {
  if (!inventory.log) inventory.log = [];
  const running = inventory.stock[mat] || 0;
  inventory.log.push({ time: time || new Date().toISOString(), mat, deltaKg, running, type, ref });
}

function getAvgComp() {
  // Returns the average composition settings, with fallback defaults
  const a = inventory.avgComposition || {};
  return {
    hwPct: a.hwPct ?? 75,
    wbPct: a.wbPct ?? 25,
    rhPct: a.rhPct ?? 63,
    bagKg: a.bagKg ?? 3,
    grainBagKg: a.grainBagKg ?? 1,
    grainRhPct: a.grainRhPct ?? 52
  };
}

function estBagsFromMat(mat, stockKg) {
  // Estimate how many fruiting blocks (or grain bags) can be made from this material
  // For HW/WB: dry matter per bag = bagKg × (1 − rh/100), split by avg %
  // For grain: dry grain per bag = grainBagKg × (1 − grainRhPct/100); stock is dry.
  const c = getAvgComp();
  if (mat === 'grain') {
    const dryPerGrainBag = c.grainBagKg * (c.grainRhPct > 0 ? 1 - c.grainRhPct / 100 : 1);
    return {
      bags: dryPerGrainBag > 0 ? Math.floor(stockKg / dryPerGrainBag) : 0,
      bagKg: c.grainBagKg,
      isGrain: true
    };
  }
  const dryPerBag = mtDryKg(c.bagKg, c.rhPct); // dry matter per bag
  let matPerBag = 0;
  if (mat === 'hardwood') matPerBag = dryPerBag * (c.hwPct / 100);
  if (mat === 'wheatbran') matPerBag = dryPerBag * (c.wbPct / 100);
  if (mat === 'gypsum') matPerBag = dryPerBag * 0.01;
  const bags = matPerBag > 0 ? Math.floor(stockKg / matPerBag) : 0;
  return { bags, matPerBag, bagKg: c.bagKg, isGrain: false };
}

function renderInvStock() {
  if (!inventory.stock) inventory.stock = { hardwood: 0, wheatbran: 0, gypsum: 0, grain: 0 };
  if (!inventory.thresholds)
    inventory.thresholds = {
      hardwood: { minKg: 50 },
      wheatbran: { minKg: 20 },
      gypsum: { minKg: 5 },
      grain: { minKg: 10 }
    };
  if (!inventory.avgComposition)
    inventory.avgComposition = { hwPct: 75, wbPct: 25, rhPct: 63, bagKg: 3, grainBagKg: 1, grainRhPct: 52 };

  const cards = document.getElementById('inv-cards');
  cards.innerHTML = Object.keys(MAT_LABELS)
    .map((mat) => {
      const stock = inventory.stock[mat] || 0;
      const thresh = inventory.thresholds[mat] || { minKg: 0 };
      const low = thresh.minKg > 0 && stock < thresh.minKg;
      const { bags, bagKg, matPerBag, isGrain } = estBagsFromMat(mat, stock);
      const pct =
        thresh.minKg > 0
          ? Math.min(100, Math.round((stock / Math.max(stock, thresh.minKg * 3)) * 100))
          : Math.min(100, Math.round((stock / Math.max(stock, 100)) * 100));
      const estNote = isGrain
        ? t('inv.grainBagsEst', { n: bags, kg: bagKg })
        : t('inv.blocksEst', { n: '<strong>' + bags + '</strong>', kg: bagKg }) +
          ' <span style="font-size:10px;color:var(--c-text-muted)">' +
          t('inv.avgEstimate') +
          '</span>';
      return `<div style="background:${MAT_BG[mat]};border:1px solid ${low ? 'var(--c-red)' : MAT_BORDER[mat]};border-radius:10px;padding:14px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:12px;font-weight:600;color:${MAT_COLORS[mat]}">${MAT_LABELS[mat]}</div>
        ${low ? `<span style="font-size:10px;background:var(--c-red-light);color:var(--c-red-dark);padding:2px 7px;border-radius:99px;font-weight:600">${t('inv.lowStock')}</span>` : ''}
      </div>
      <div style="font-size:26px;font-weight:700;color:var(--c-text);margin-bottom:2px">${stock.toFixed(1)} <span style="font-size:14px;font-weight:400;color:var(--c-text-muted)">kg</span></div>
      <div style="height:5px;border-radius:3px;background:rgba(0,0,0,.08);overflow:hidden;margin-bottom:8px">
        <div style="height:100%;border-radius:3px;background:${low ? 'var(--c-red)' : MAT_COLORS[mat]};width:${pct}%;transition:width .3s"></div>
      </div>
      <div style="font-size:12px;color:var(--c-text-sec);line-height:1.6">${estNote}</div>
      ${thresh.minKg > 0 ? `<div style="font-size:11px;color:${low ? 'var(--c-red-dark)' : 'var(--c-text-muted)'};margin-top:2px">${t('inv.alertBelow', { n: thresh.minKg })}</div>` : ''}
      <button class="btn btn-sm" onclick="openStab('inv','delivery')" style="margin-top:8px;font-size:11px">${t('inv.logDelivery')}</button>
      ${(() => {
        const sups = getSuppliersForMat(mat);
        if (!sups.length) return '';
        return `<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(0,0,0,.06);font-size:11px;color:var(--c-text-sec)">
          <span style="font-weight:600;color:${low ? 'var(--c-red-dark)' : 'var(--c-text-muted)'}">${low ? t('inv.reorderFrom') : t('inv.suppliers')}:</span>
          ${sups.map((s) => (safeHref(s.url) ? `<a href="${safeHref(s.url)}" target="_blank" rel="noopener" style="color:var(--c-blue);margin-left:4px">${esc(s.name)}</a>` : `<span style="margin-left:4px">${esc(s.name)}</span>`)).join(',')}
        </div>`;
      })()}
    </div>`;
    })
    .join('');
  renderThresholds();
}

function renderThresholds() {
  const el = document.getElementById('inv-thresholds');
  if (!el) return;
  const c = getAvgComp();

  // Per-material alert thresholds
  const threshHtml = `<div style="overflow-x:auto;margin-bottom:16px"><table>
    <thead><tr><th>${t('inv.thMaterial')}</th><th>${t('inv.thInStock')}</th><th>${t('inv.thAlertBelow')}</th><th>${t('inv.thEstBags')}</th></tr></thead>
    <tbody>
    ${Object.keys(MAT_LABELS)
      .map((mat) => {
        const stock = inventory.stock[mat] || 0;
        const t = inventory.thresholds[mat] || { minKg: 0 };
        const { bags } = estBagsFromMat(mat, stock);
        return `<tr>
        <td style="font-weight:500;color:${MAT_COLORS[mat]}">${MAT_LABELS[mat]}</td>
        <td style="font-weight:600">${stock.toFixed(2)} kg</td>
        <td><input type="text" inputmode="decimal" value="${esc(t.minKg)}" style="width:80px;font-size:12px;padding:3px 6px" onchange="updateThreshold('${mat}','minKg',this.value)" /></td>
        <td style="font-size:12px;color:var(--c-text-sec)">~${bags} bags <span style="font-size:10px;color:var(--c-text-muted)">(avg)</span></td>
      </tr>`;
      })
      .join('')}
    </tbody>
  </table></div>`;

  // Average composition settings
  const compHtml = `<div style="background:var(--c-bg);border-radius:8px;padding:12px">
    <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">
      ${t('inv.avgCompTitle')}
    </div>
    <p style="font-size:12px;color:var(--c-text-muted);margin-bottom:10px;line-height:1.6">
      ${t('inv.avgCompDesc')}
    </p>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">
      <div><label style="font-size:11px">${t('inv.hwPct')}</label>
        <input type="text" inputmode="decimal" value="${esc(c.hwPct)}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('hwPct',this.value)" /></div>
      <div><label style="font-size:11px">${t('inv.wbPct')}</label>
        <input type="text" inputmode="decimal" value="${esc(c.wbPct)}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('wbPct',this.value)" /></div>
      <div><label style="font-size:11px">${t('inv.waterPct')}</label>
        <input type="text" inputmode="decimal" value="${esc(c.rhPct)}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('rhPct',this.value)" /></div>
      <div><label style="font-size:11px">${t('inv.blockWeight')}</label>
        <input type="text" inputmode="decimal" value="${esc(c.bagKg)}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('bagKg',this.value)" /></div>
      <div><label style="font-size:11px">${t('inv.grainBagWeight')}</label>
        <input type="text" inputmode="decimal" value="${esc(c.grainBagKg)}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('grainBagKg',this.value)" /></div>
      <div><label style="font-size:11px">${t('inv.grainWaterPct')}</label>
        <input type="text" inputmode="decimal" value="${esc(c.grainRhPct)}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('grainRhPct',this.value)" /></div>
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--c-text-muted)">
      With these settings: 1 × ${c.bagKg}kg block uses ~${(mtDryKg(c.bagKg, c.rhPct) * (c.hwPct / 100)).toFixed(3)}kg hardwood + ~${(mtDryKg(c.bagKg, c.rhPct) * (c.wbPct / 100)).toFixed(3)}kg wheat bran (dry weights after removing ${c.rhPct}% water). 1 × ${c.grainBagKg}kg grain bag uses ~${(mtDryKg(c.grainBagKg, c.grainRhPct)).toFixed(3)}kg dry grain (after removing ${c.grainRhPct}% water).
    </div>
  </div>`;

  el.innerHTML = threshHtml + compHtml;
}

function updateAvgComp(key, val) {
  if (!inventory.avgComposition)
    inventory.avgComposition = { hwPct: 75, wbPct: 25, rhPct: 63, bagKg: 3, grainBagKg: 1, grainRhPct: 52 };
  inventory.avgComposition[key] = parseDecimal(val) || 0;
  saveInvConfig();
  renderInvStock();
}

function updateThreshold(mat, key, val) {
  if (!inventory.thresholds) inventory.thresholds = {};
  if (!inventory.thresholds[mat]) inventory.thresholds[mat] = { minKg: 0 };
  inventory.thresholds[mat][key] = parseDecimal(val) || 0;
  saveInvConfig();
  renderInvStock();
}

function delMatChange() {
  const mat = document.getElementById('del-mat').value;
  const stock = inventory.stock?.[mat] || 0;
  document.getElementById('del-current').textContent = t('inv.currentStock', { n: stock.toFixed(2) });
  document.getElementById('del-kg').value = '';
  document.getElementById('del-preview').style.display = 'none';
}
function delPreview() {
  const mat = document.getElementById('del-mat').value;
  const kg = parseDecimal(document.getElementById('del-kg').value) || 0;
  const el = document.getElementById('del-preview');
  if (!kg) {
    el.style.display = 'none';
    return;
  }
  const cur = inventory.stock?.[mat] || 0;
  el.innerHTML =
    t('inv.afterDeliveryLabel') +
    '<strong>' +
    (cur + kg).toFixed(2) +
    ' kg</strong> (' +
    cur.toFixed(2) +
    ' + ' +
    kg +
    ' kg)';
  el.style.display = 'block';
}
function adjMatChange() {
  const mat = document.getElementById('adj-mat').value;
  const stock = inventory.stock?.[mat] || 0;
  document.getElementById('adj-current').textContent = t('inv.currentStock', { n: stock.toFixed(2) });
  document.getElementById('adj-absolute').value = '';
  document.getElementById('adj-delta').value = '';
  document.getElementById('adj-preview').style.display = 'none';
}
function adjPreview(mode) {
  const mat = document.getElementById('adj-mat').value;
  const cur = inventory.stock?.[mat] || 0;
  const el = document.getElementById('adj-preview');
  let newVal, diff;
  if (mode === 'absolute') {
    const abs = parseDecimal(document.getElementById('adj-absolute').value);
    if (isNaN(abs)) {
      el.style.display = 'none';
      return;
    }
    document.getElementById('adj-delta').value = '';
    newVal = Math.max(0, abs);
    diff = newVal - cur;
    el.innerHTML =
      t('inv.setToLabel') +
      '<strong>' +
      newVal.toFixed(2) +
      ' kg</strong> ' +
      (diff >= 0 ? '+' : '') +
      diff.toFixed(2) +
      t('inv.kgFromCurrent');
  } else {
    const delta = parseDecimal(document.getElementById('adj-delta').value);
    if (isNaN(delta)) {
      el.style.display = 'none';
      return;
    }
    document.getElementById('adj-absolute').value = '';
    newVal = Math.max(0, cur + delta);
    diff = delta;
    el.innerHTML =
      t('inv.newTotalLabel') +
      '<strong>' +
      newVal.toFixed(2) +
      ' kg</strong> (' +
      (diff >= 0 ? '+' : '') +
      diff.toFixed(2) +
      ' kg)';
  }
  el.style.display = 'block';
}
function logDelivery() {
  const mat = document.getElementById('del-mat').value;
  const kg = parseDecimal(document.getElementById('del-kg').value) || 0;
  const note = document.getElementById('del-note').value.trim();
  if (kg <= 0) {
    alert(t('inv.enterQty'));
    return;
  }
  if (!inventory.stock) inventory.stock = { hardwood: 0, wheatbran: 0, gypsum: 0, grain: 0 };
  const prev = inventory.stock[mat] || 0;
  inventory.stock[mat] = prev + kg;
  document.getElementById('del-kg').value = '';
  document.getElementById('del-note').value = '';
  document.getElementById('del-preview').style.display = 'none';
  openStab('inv', 'stock');
  renderInvStock();
  // Confirm only once the server has it. /api/inventory/delta is NOT in the
  // service worker's offline queue (that covers scan-log and contamination
  // reports only), so an offline booking is simply lost — and the optimistic
  // local number is overwritten by the next poll. Reporting success for a
  // delivery that never landed is how stock silently drifts from the floor.
  invDelta(mat, kg, 'delivery', note || 'delivery').then((r) => {
    if (r && r.error) {
      inventory.stock[mat] = prev;
      renderInvStock();
      setFb('err', t('inv.deliveryFailed', { err: r.error }));
      return;
    }
    setFb(
      'ok',
      'Delivery logged: +' + kg + 'kg ' + MAT_LABELS[mat] + ' now ' + inventory.stock[mat].toFixed(2) + 'kg total'
    );
  });
}
function logAdjustment() {
  const mat = document.getElementById('adj-mat').value;
  const absVal = document.getElementById('adj-absolute').value;
  const deltaVal = document.getElementById('adj-delta').value;
  const reason = document.getElementById('adj-reason').value.trim() || 'Manual adjustment';
  if (!inventory.stock) inventory.stock = { hardwood: 0, wheatbran: 0, gypsum: 0, grain: 0 };
  const cur = inventory.stock[mat] || 0;
  let newStock, delta;
  if (absVal !== '') {
    newStock = Math.max(0, parseDecimal(absVal) || 0);
    delta = newStock - cur;
  } else if (deltaVal !== '') {
    delta = parseDecimal(deltaVal) || 0;
    newStock = Math.max(0, cur + delta);
  } else {
    alert(t('inv.enterAmount'));
    return;
  }
  const prevStock = inventory.stock[mat] || 0;
  inventory.stock[mat] = newStock;
  document.getElementById('adj-absolute').value = '';
  document.getElementById('adj-delta').value = '';
  document.getElementById('adj-reason').value = '';
  document.getElementById('adj-preview').style.display = 'none';
  openStab('inv', 'stock');
  renderInvStock();
  // Same as logDelivery: /api/inventory/set has no offline queue, so confirm
  // only after the server accepts it. A stocktake correction reported as saved
  // and then silently reverted by the next poll is worse than an error.
  invSetAbsolute(mat, newStock, 'adjustment', reason).then((r) => {
    if (r && r.error) {
      inventory.stock[mat] = prevStock;
      renderInvStock();
      setFb('err', t('inv.adjustFailed', { err: r.error }));
      return;
    }
    setFb(
      'ok',
      'Adjusted ' +
        MAT_LABELS[mat] +
        ': ' +
        (delta >= 0 ? '+' : '') +
        delta.toFixed(2) +
        'kg now ' +
        newStock.toFixed(2) +
        'kg'
    );
  });
}

function renderInvLog() {
  const filter = document.getElementById('inv-log-filter').value;
  const body = document.getElementById('inv-log-body');
  if (!inventory.log || !inventory.log.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">' + t('inv.noUsageHistory') + '</td></tr>';
    return;
  }
  const rows = [...inventory.log]
    .reverse()
    .filter((e) => filter === 'all' || e.mat === filter)
    .slice(0, 200);
  // Build running totals per material going forwards for display
  body.innerHTML = rows
    .map(
      (e) => `<tr>
    <td style="font-size:10px;color:var(--c-text-muted)">${fmtDtTime(e.time)}</td>
    <td style="color:${MAT_COLORS[e.mat]};font-weight:500">${MAT_LABELS[e.mat]}</td>
    <td style="font-weight:600;color:${e.deltaKg < 0 ? 'var(--c-red-dark)' : 'var(--c-green-dark)'}">${e.deltaKg > 0 ? '+' : ''}${e.deltaKg.toFixed(2)} kg</td>
    <td style="font-size:11px">${(e.running || 0).toFixed(1)} kg</td>
    <td><span class="badge ${e.type === 'delivery' ? 'b-add' : e.type === 'adjustment' ? 'b-move' : 'b-harvest'}">${esc(e.type)}</span></td>
    <td style="font-size:11px;color:var(--c-text-sec)">${esc(e.ref) || '—'}</td>
  </tr>`
    )
    .join('');
}

// Show low-stock alerts in dashboard
function getInvAlerts() {
  if (!inventory.stock || !inventory.thresholds) return [];
  return Object.keys(MAT_LABELS)
    .filter((mat) => {
      const stock = inventory.stock[mat] || 0;
      const thresh = (inventory.thresholds[mat] || {}).minKg || 0;
      return thresh > 0 && stock < thresh;
    })
    .map((mat) => {
      const stock = inventory.stock[mat] || 0;
      const thresh = inventory.thresholds[mat].minKg;
      const { bags } = estBagsFromMat(mat, stock);
      const sups = getSuppliersForMat(mat);
      const supNote = sups.length ? ` — ${t('inv.reorderFrom')}: ${sups.map((s) => s.name).join(', ')}` : '';
      return {
        text: `Low stock: ${MAT_LABELS[mat]}`,
        detail: `${stock.toFixed(1)} kg remaining (≈${bags} bags) — below ${thresh}kg threshold${supNote}`,
        urgent: stock < thresh * 0.5,
        warn: true,
        species: null
      };
    });
}

// Show low lab stock alerts in dashboard
function getLabAlerts() {
  if (!inventory.labThresholds) return [];
  const counts = getLabStockCounts();
  const breakdown = getLabStrainBreakdown();
  const alerts = [];
  LAB_TYPES.forEach((type) => {
    const min = inventory.labThresholds[type] || 0;
    if (min <= 0) return;
    if (type === 'GS') {
      // Per-strain kg check for grain spawn
      const strains = Object.values(breakdown.GS || {});
      const lowStrains = strains.filter((s) => s.count < min);
      if (lowStrains.length) {
        const label = getLabLabel(type);
        const names = lowStrains.map((s) => s.kz || s.name).join(', ');
        alerts.push({
          text: t('lab.lowLabAlert', { type: label }) + ': ' + names,
          detail: names + ' below ' + min + ' kg',
          urgent: lowStrains.some((s) => s.count === 0),
          warn: true
        });
      }
    } else {
      const count = counts[type] || 0;
      if (count < min) {
        const label = getLabLabel(type);
        alerts.push({
          text: t('lab.lowLabAlert', { type: label }),
          detail: t('lab.belowMin', { n: count, min: min }),
          urgent: count === 0,
          warn: true
        });
      }
    }
  });
  return alerts;
}

// ─── SUPPLIERS ───────────────────────────────────────────────
function renderSuppliers() {
  const el = document.getElementById('suppliers-list');
  if (!el) return;
  if (!suppliers.length) {
    el.innerHTML = `<p style="color:var(--c-text-muted);font-size:13px">${t('inv.noSuppliers')}</p>`;
    return;
  }
  const grouped = {};
  Object.keys(MAT_LABELS).forEach((m) => (grouped[m] = []));
  suppliers.forEach((s) => {
    if (grouped[s.mat]) grouped[s.mat].push(s);
  });
  el.innerHTML = Object.keys(MAT_LABELS)
    .map((mat) => {
      const list = grouped[mat];
      if (!list.length) return '';
      return `<div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:${MAT_COLORS[mat]};margin-bottom:6px">${MAT_LABELS[mat]}</div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>${t('inv.supplierName')}</th><th>${t('inv.supplierUrl')}</th><th>${t('inv.supplierPhone')}</th><th>${t('inv.supplierNotes')}</th><th></th></tr></thead>
        <tbody>${list
          .map(
            (s) => `<tr>
          <td style="font-weight:500">${esc(s.name)}</td>
          <td>${safeHref(s.url) ? `<a href="${safeHref(s.url)}" target="_blank" rel="noopener" style="color:var(--c-blue);font-size:12px">${esc(s.url)}</a>` : esc(s.url) || '-'}</td>
          <td style="font-size:12px">${s.phone ? esc(s.phone) : '-'}</td>
          <td style="font-size:12px;color:var(--c-text-sec)">${s.notes ? esc(s.notes) : '-'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm" onclick="editSupplier(${s.id})" style="font-size:11px">${t('inv.editSupplier')}</button>
            <button class="btn btn-sm" onclick="removeSupplier(${s.id})" style="font-size:11px;color:var(--c-red-dark)">${t('inv.deleteSupplier')}</button>
          </td>
        </tr>`
          )
          .join('')}</tbody>
      </table></div>
    </div>`;
    })
    .join('');
}

function editSupplier(id) {
  const existing = id ? suppliers.find((s) => s.id === id) : null;
  const matOpts = Object.keys(MAT_LABELS)
    .map((m) => `<option value="${m}"${existing && existing.mat === m ? ' selected' : ''}>${MAT_LABELS[m]}</option>`)
    .join('');
  const html = `<div style="display:flex;flex-direction:column;gap:10px">
    <div><label>${t('inv.material')}</label><select id="sup-mat">${matOpts}</select></div>
    <div><label>${t('inv.supplierName')}</label><input type="text" id="sup-name" value="${existing ? esc(existing.name) : ''}" placeholder="e.g. Agrobs GmbH" /></div>
    <div><label>${t('inv.supplierUrl')}</label><input type="text" id="sup-url" value="${existing && existing.url ? esc(existing.url) : ''}" placeholder="https://..." /></div>
    <div><label>${t('inv.supplierPhone')}</label><input type="text" id="sup-phone" value="${existing && existing.phone ? esc(existing.phone) : ''}" placeholder="+49..." /></div>
    <div><label>${t('inv.supplierNotes')}</label><input type="text" id="sup-notes" value="${existing && existing.notes ? esc(existing.notes) : ''}" placeholder="e.g. order number, contact person" /></div>
  </div>`;
  document.getElementById('m-title').textContent = existing ? t('inv.editSupplier') : t('inv.addSupplier');
  document.getElementById('m-body').innerHTML = html;
  document.getElementById('m-ok').textContent = existing ? t('inv.editSupplier') : t('inv.addSupplier');
  confirmCb = async () => {
    const s = {
      mat: document.getElementById('sup-mat').value,
      name: document.getElementById('sup-name').value.trim(),
      url: document.getElementById('sup-url').value.trim(),
      phone: document.getElementById('sup-phone').value.trim(),
      notes: document.getElementById('sup-notes').value.trim()
    };
    if (!s.name) {
      alert(t('zones.nameRequired'));
      return;
    }
    if (existing) s.id = existing.id;
    const r = await apiPost('/api/suppliers', s);
    if (r && r.id && !existing) {
      s.id = r.id;
      suppliers.push(s);
    } else if (existing) {
      Object.assign(existing, s);
    }
    renderSuppliers();
    renderInvStock();
    setFb('ok', t('inv.supplierSaved'));
  };
  document.getElementById('m-confirm').classList.add('open');
}

async function removeSupplier(id) {
  const s = suppliers.find((x) => x.id === id);
  if (!s) return;
  confirm2(
    t('inv.deleteSupplier'),
    'Remove ' + s.name + ' (' + MAT_LABELS[s.mat] + ')?',
    t('inv.deleteSupplier'),
    async () => {
      const r = await apiDelete('/api/suppliers/' + id);
      if (r && r.error) {
        setFb('err', t('common.error') + ': ' + r.error);
        return;
      }
      suppliers = suppliers.filter((x) => x.id !== id);
      renderSuppliers();
      renderInvStock();
      setFb('ok', t('inv.supplierDeleted'));
    }
  );
}

function getSuppliersForMat(mat) {
  return suppliers.filter((s) => s.mat === mat);
}

// ─── BACKUP ──────────────────────────────────────────────────
function setStatus(el, msg, ok) {
  el.style.color = ok ? 'var(--c-green-dark)' : 'var(--c-red-dark)';
  el.textContent = msg;
}
async function downloadBackup() {
  const pw = document.getElementById('backup-dl-pw').value;
  const st = document.getElementById('backup-dl-status');
  if (!pw || pw.length < 8) {
    setStatus(st, t('users.minPw'), false);
    return;
  }
  setStatus(st, 'Preparing backup…', true);
  try {
    const r = await authFetch('/api/backup/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      setStatus(st, e.error || 'Download failed', false);
      return;
    }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const cd = r.headers.get('content-disposition') || '';
    const m = cd.match(/filename="(.+?)"/);
    a.download = m ? m[1] : 'meistertracker_backup.enc';
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(st, 'Backup downloaded.', true);
    document.getElementById('backup-dl-pw').value = '';
  } catch (err) {
    setStatus(st, 'Download failed', false);
  }
}
// Clean-slate reset. Deliberately awkward to fire: you pick the categories, type
// the confirmation phrase, and still get a summary dialog naming what goes. The
// server writes a verified backup before deleting anything.
const RESET_CONFIRM_PHRASE = 'ALLES LOESCHEN';
async function runCleanReset() {
  const st = document.getElementById('reset-status');
  const scopes = {
    growing: document.getElementById('reset-growing').checked,
    orders: document.getElementById('reset-orders').checked,
    planning: document.getElementById('reset-planning').checked,
    stock: document.getElementById('reset-stock').checked
  };
  if (!scopes.growing && !scopes.orders && !scopes.planning && !scopes.stock) {
    setStatus(st, t('reset.errNoScope'), false);
    return;
  }
  const typed = (document.getElementById('reset-confirm').value || '').trim().toUpperCase();
  if (typed !== RESET_CONFIRM_PHRASE) {
    setStatus(st, t('reset.errPhrase', { phrase: RESET_CONFIRM_PHRASE }), false);
    return;
  }
  const parts = [];
  if (scopes.growing) parts.push(t('reset.scopeGrowing'));
  if (scopes.orders) parts.push(t('reset.scopeOrders'));
  if (scopes.planning) parts.push(t('reset.scopePlanning'));
  if (scopes.stock) parts.push(t('reset.scopeStock'));
  confirm2(t('reset.confirmTitle'), t('reset.confirmMsg', { what: parts.join(' · ') }), t('reset.btn'), async () => {
    setStatus(st, t('reset.running'), true);
    const r = await apiPost('/api/admin/reset', { ...scopes, confirm: RESET_CONFIRM_PHRASE });
    if (!r || r.error) {
      setStatus(st, t('reset.failed', { err: (r && r.error) || '?' }), false);
      return;
    }
    const rows = Object.values(r.counts || {}).reduce((s, n) => s + n, 0);
    setStatus(st, t('reset.done', { rows: rows, backup: r.backup }), true);
    document.getElementById('reset-confirm').value = '';
    await loadData(); // re-renders via refresh()
  });
}
function restoreBackup() {
  const file = document.getElementById('restore-file').files[0];
  const pw = document.getElementById('backup-restore-pw').value;
  const st = document.getElementById('backup-restore-status');
  if (!file) {
    setStatus(st, 'Select a .enc backup file.', false);
    return;
  }
  if (!pw) {
    setStatus(st, 'Enter the decryption password.', false);
    return;
  }
  confirm2(
    t('settings.restoreBackup') || 'Restore this backup?',
    t('settings.restoreMsg') || 'Replaces ALL data on the server for all users. Cannot be undone.',
    t('settings.restoreConfirm') || 'Yes, restore',
    async () => {
      setStatus(st, 'Restoring…', true);
      try {
        const buf = await file.arrayBuffer();
        const r = await authFetch('/api/backup/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'x-backup-password': pw },
          body: buf
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          setStatus(st, e.error || 'Restore failed', false);
          return;
        }
        setStatus(st, 'Restored successfully. Reloading…', true);
        document.getElementById('backup-restore-pw').value = '';
        setTimeout(() => window.location.reload(), 1500);
      } catch (err) {
        setStatus(st, 'Restore failed', false);
      }
    }
  );
}

// ─── ZONES (Location Management) ────────────────────────────
const ROLE_LABELS = {
  spawn: 'zones.roleSpawn',
  incubation: 'zones.roleIncubation',
  fruiting: 'zones.roleFruiting',
  contaminated: 'zones.roleContaminated'
};
const ROLE_ORDER = ['spawn', 'incubation', 'fruiting', 'contaminated'];
function renderZones() {
  const el = document.getElementById('zones-list');
  if (!el) return;
  if (!zones.length) {
    el.innerHTML = '<div class="empty">' + esc(t('zones.empty')) + '</div>';
    return;
  }
  // Group zones by role in canonical order; unknown roles go last.
  const groups = {};
  ROLE_ORDER.forEach((r) => {
    groups[r] = [];
  });
  const extraRoles = [];
  zones.forEach((z) => {
    if (groups[z.role]) groups[z.role].push(z);
    else {
      if (!groups[z.role]) {
        groups[z.role] = [];
        extraRoles.push(z.role);
      }
      groups[z.role].push(z);
    }
  });
  // Within each group: sort by sortOrder (fallback to name for stability).
  Object.keys(groups).forEach((role) => {
    groups[role].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name));
  });
  const renderZone = (z) => {
    const zoneBags = getZoneBags(z.id);
    const bagCount = Object.keys(zoneBags).length;
    const rackIds = new Set(z.racks.map((r) => r.id));
    const directCount = Object.values(zoneBags).filter((b) => !rackIds.has(b.loc)).length;
    const rackHtml = z.racks.length
      ? z.racks
          .map((r) => {
            const rBags = Object.keys(getRackBags(r.id)).length;
            return `<span class="zone-rack-chip">${esc(r.id)} <span style="color:var(--c-text-muted)">(${rBags})</span>${rBags === 0 ? `<button class="btn btn-sm btn-r zone-rack-del" data-action="del-rack" data-rack="${esc(r.id)}" title="${esc(t('zones.delete'))}">&times;</button>` : ''}</span>`;
          })
          .join('')
      : '<span style="color:var(--c-text-muted);font-size:11px">' + t('zones.noRacks') + '</span>';
    return `<div class="zone-row" data-zone-id="${esc(z.id)}" data-zone-role="${esc(z.role)}" style="border-left:4px solid ${safeColor(z.color)}">
      <div class="zone-row-header">
        <span class="zone-drag-handle" draggable="true" title="${esc(t('zones.dragToReorder'))}" aria-label="${esc(t('zones.dragToReorder'))}">\u22ee\u22ee</span>
        <span class="zone-row-name">${esc(z.name)}</span>
        <span class="badge">${esc(t(ROLE_LABELS[z.role]) || z.role)}</span>
        <span style="font-size:11px;color:var(--c-text-muted)">${z.maxCapacity ? bagCount + ' / ' + z.maxCapacity + ' Bags' : tp('dash.bags', bagCount)}</span>
        ${directCount > 0 ? `<span class="badge zone-direct-badge" title="${esc(t('zones.directBagsHint'))}">\u26a0 ${esc(t('zones.directBags', { count: directCount }))}</span>` : ''}
        ${directCount > 0 && z.racks.length ? `<button class="btn btn-sm" data-action="bulk-move" data-zone="${esc(z.id)}" style="font-size:10px;color:var(--c-red-dark);font-weight:600">${esc(t('zones.moveToRack'))}</button>` : ''}
        <span style="flex:1"></span>
        <button class="btn btn-sm" data-action="rename-zone" data-zone="${esc(z.id)}" style="font-size:11px">${esc(t('batch.zones.rename'))}</button>
        <button class="btn btn-sm" data-action="zone-capacity" data-zone="${esc(z.id)}" title="${esc(z.maxCapacity ? z.name + ': ' + bagCount + ' / ' + z.maxCapacity : t('zones.capacityNone'))}" style="font-size:11px">${esc(t('zones.capacity'))}</button>
        <button class="btn btn-sm" data-action="add-rack" data-zone="${esc(z.id)}" style="font-size:11px">${esc(t('zones.addRack'))}</button>
        <button class="btn btn-sm" data-action="toggle-qr" data-zone="${esc(z.id)}" style="font-size:11px">${esc(t('zones.showQr'))}</button>
        <button class="btn btn-sm" data-action="print-zone-qr" data-zone="${esc(z.id)}" style="font-size:11px">${esc(t('zones.printQr'))}</button>
        ${
          bagCount === 0
            ? `<button class="btn btn-sm btn-r" data-action="del-zone" data-zone="${esc(z.id)}" style="font-size:11px">${t('zones.delete')}</button>`
            : `<button class="btn btn-sm btn-r" disabled title="${esc(t('zones.hasBags', { count: bagCount }))}" style="font-size:11px;opacity:.45;cursor:not-allowed">${t('zones.delete')}</button>`
        }
      </div>
      <div class="zone-row-racks">${rackHtml}</div>
      <div class="zone-qr-panel" id="zone-qr-${esc(z.id)}" style="display:none"></div>
    </div>`;
  };
  const orderedRoles = [...ROLE_ORDER, ...extraRoles];
  el.innerHTML = orderedRoles
    .map((role) => {
      const zs = groups[role];
      if (!zs || !zs.length) return '';
      const label = esc(t(ROLE_LABELS[role]) || role);
      const header = `<div class="zone-group-header">${label}</div>`;
      return header + zs.map(renderZone).join('');
    })
    .join('');
}
// Drag-and-drop state for zone reordering.
let draggedZoneId = null;
let draggedZoneRole = null;
function clearZoneDropHints() {
  document.querySelectorAll('.zone-row.zone-drop-before,.zone-row.zone-drop-after').forEach((r) => {
    r.classList.remove('zone-drop-before', 'zone-drop-after');
  });
}
function onZoneDragStart(e) {
  const handle = e.target.closest('.zone-drag-handle');
  if (!handle) {
    return;
  }
  const row = handle.closest('.zone-row');
  if (!row) {
    return;
  }
  draggedZoneId = row.dataset.zoneId;
  draggedZoneRole = row.dataset.zoneRole;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', draggedZoneId);
    } catch (_) {}
    try {
      const rect = row.getBoundingClientRect();
      e.dataTransfer.setDragImage(row, e.clientX - rect.left, e.clientY - rect.top);
    } catch (_) {}
  }
  // Delay the dragging class so the browser snapshots the row before we dim it.
  setTimeout(() => {
    row.classList.add('zone-dragging');
  }, 0);
}
function onZoneDragOver(e) {
  if (!draggedZoneId) return;
  const row = e.target.closest('.zone-row');
  if (!row || row.dataset.zoneRole !== draggedZoneRole || row.dataset.zoneId === draggedZoneId) {
    clearZoneDropHints();
    return;
  }
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const rect = row.getBoundingClientRect();
  const before = e.clientY - rect.top < rect.height / 2;
  clearZoneDropHints();
  row.classList.add(before ? 'zone-drop-before' : 'zone-drop-after');
}
function onZoneDrop(e) {
  if (!draggedZoneId) return;
  const row = e.target.closest('.zone-row');
  if (!row || row.dataset.zoneRole !== draggedZoneRole || row.dataset.zoneId === draggedZoneId) {
    clearZoneDropHints();
    return;
  }
  e.preventDefault();
  const rect = row.getBoundingClientRect();
  const before = e.clientY - rect.top < rect.height / 2;
  const targetId = row.dataset.zoneId;
  const sourceId = draggedZoneId;
  const role = draggedZoneRole;
  clearZoneDropHints();
  reorderZoneWithinRole(sourceId, targetId, before, role);
}
function onZoneDragEnd() {
  document.querySelectorAll('.zone-row.zone-dragging').forEach((r) => r.classList.remove('zone-dragging'));
  clearZoneDropHints();
  draggedZoneId = null;
  draggedZoneRole = null;
}
async function reorderZoneWithinRole(sourceId, targetId, before, role) {
  const sameRole = zones
    .filter((x) => x.role === role)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name));
  const srcIdx = sameRole.findIndex((x) => x.id === sourceId);
  if (srcIdx < 0) return;
  const [src] = sameRole.splice(srcIdx, 1);
  const tgtIdx = sameRole.findIndex((x) => x.id === targetId);
  if (tgtIdx < 0) sameRole.push(src);
  else sameRole.splice(before ? tgtIdx : tgtIdx + 1, 0, src);
  // Build full order: roles in canonical order + any extras, each group in its new local order.
  const groups = {};
  ROLE_ORDER.forEach((r) => {
    groups[r] = [];
  });
  const extra = [];
  zones.forEach((x) => {
    if (x.role === role) return;
    if (!groups[x.role]) {
      groups[x.role] = [];
      extra.push(x.role);
    }
    groups[x.role].push(x);
  });
  groups[role] = sameRole;
  Object.keys(groups).forEach((r) => {
    if (r !== role) groups[r].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name));
  });
  const fullOrder = [...ROLE_ORDER, ...extra].flatMap((r) => groups[r] || []).map((x) => x.id);
  // Optimistic local update so the UI moves immediately.
  fullOrder.forEach((id, idx) => {
    const zz = zones.find((x) => x.id === id);
    if (zz) zz.sortOrder = idx + 1;
  });
  renderZones();
  try {
    const res = await apiPost('/api/zones/reorder', { order: fullOrder });
    if (res && res.error) {
      alert(res.error);
      await loadData();
    }
  } catch (err) {
    console.error('reorder zones error:', err);
    alert(t('zones.errorReorder', { err: err.message || 'unknown error' }));
    await loadData();
  }
}
async function addZone() {
  const nameRaw = document.getElementById('zone-name').value.trim();
  // ID is derived from uppercase version for stability; display name keeps user casing
  const id = nameRaw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!id || id.length < 2) {
    alert(t('zones.errShort'));
    return;
  }
  if (nameRaw.length > 50) {
    alert(t('zones.errLong'));
    return;
  }
  if (!/^[A-Z]/.test(id)) {
    alert(t('zones.errIdStart'));
    return;
  }
  const dup = zones.find((z) => z.id === id);
  if (dup) {
    alert(t('zones.errExists') + ' (' + dup.name + ')');
    return;
  }
  const role = document.getElementById('zone-role').value;
  const color = document.getElementById('zone-color').value;
  const racksRaw = document.getElementById('zone-racks').value.trim();
  const racks = racksRaw
    ? [
        ...new Set(
          racksRaw
            .split(',')
            .map(
              (r) =>
                id +
                '_' +
                r
                  .trim()
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
            )
            .filter((r) => r !== id + '_')
        )
      ]
    : [];
  if (racks.some((r) => r === id + '_' || r.length <= id.length + 1)) {
    alert(t('zones.errRackEmpty'));
    return;
  }
  if (racks.length > 50) {
    alert(t('zones.errTooManyRacks'));
    return;
  }
  const capVal = document.getElementById('zone-capacity').value.trim();
  const maxCapacity = capVal ? parseInt(capVal, 10) : null;
  if (maxCapacity !== null && (!Number.isFinite(maxCapacity) || maxCapacity < 1)) {
    alert(t('zones.errCapacity'));
    return;
  }
  try {
    const now = new Date().toISOString();
    const res = await apiPost('/api/zones', {
      id,
      name: nameRaw,
      role,
      color,
      sortOrder: zones.length + 1,
      racks,
      maxCapacity,
      created: now
    });
    if (res.error) {
      alert(res.error);
      return;
    }
    zones.push({
      id,
      name: nameRaw,
      role,
      color,
      sortOrder: zones.length + 1,
      maxCapacity,
      racks: racks.map((r, i) => ({ id: r, sortOrder: i + 1 }))
    });
    rebuildZoneConstants();
    renderZones();
    renderStatus();
    document.getElementById('zone-name').value = '';
    document.getElementById('zone-racks').value = '';
    document.getElementById('zone-color').value = '#10b981';
    document.getElementById('zone-role').value = 'fruiting';
    document.getElementById('zone-capacity').value = '';
  } catch (e) {
    console.error('addZone error:', e);
    alert(t('zones.errorCreate', { err: e.message || 'unknown error' }));
  }
}
function renameZone(id) {
  const z = zones.find((x) => x.id === id);
  if (!z) return;
  prompt2(t('batch.zones.renamePrompt', { old: z.name }), z.name, function (newName) {
    if (!newName || !newName.trim()) return;
    newName = newName.trim();
    if (newName === z.name) return;
    apiPatch('/api/zones/' + encodeURIComponent(id) + '/name', { name: newName }).then((res) => {
      if (res && res.error) {
        alert(res.error);
        return;
      }
      z.name = newName;
      renderZones();
      renderStatus();
      renderBatches();
    });
  });
}
// Capacity could be set when a zone was created and never again, so a tent whose
// real limit only became clear in use was stuck at whatever was guessed on day
// one — or at nothing. Empty clears the limit rather than meaning zero.
function editZoneCapacity(id) {
  const z = zones.find((x) => x.id === id);
  if (!z) return;
  prompt2(t('zones.capacityPrompt', { zone: z.name }), z.maxCapacity ? String(z.maxCapacity) : '', function (raw) {
    if (raw === null || raw === undefined) return;
    const s = String(raw).trim();
    // '' clears; anything else must be a whole, non-negative number. Number('')
    // is 0, so the empty case is taken first and never reads as a limit of zero.
    let cap;
    if (s === '') cap = null;
    else {
      const n = Number(s);
      if (!Number.isInteger(n) || n < 0) {
        setFb('err', t('zones.capacityBad'));
        return;
      }
      cap = n === 0 ? null : n;
    }
    if ((z.maxCapacity || null) === cap) return;
    apiPatch('/api/zones/' + encodeURIComponent(id) + '/capacity', { maxCapacity: cap }).then((res) => {
      if (res && res.error) {
        alert(res.error);
        return;
      }
      z.maxCapacity = cap;
      setFb('ok', t('zones.capacitySaved'));
      renderZones();
      renderStatus();
      renderDashBatchTasks();
    });
  });
}
function removeZone(id) {
  const z = zones.find((x) => x.id === id);
  if (!z) return;
  confirm2(t('zones.deleteTitle'), t('zones.deleteMsg', { name: z.name }), t('zones.delete'), async () => {
    const res = await apiDelete('/api/zones/' + encodeURIComponent(id));
    if (res.error) {
      alert(res.error);
      return;
    }
    zones = zones.filter((x) => x.id !== id);
    rebuildZoneConstants();
    renderZones();
    renderStatus();
  });
}
function addRackToZone(zoneId) {
  prompt2(t('zones.rackPrompt'), 'R3', function (name) {
    if (!name) return;
    const rackId =
      zoneId +
      '_' +
      name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
    if (ALL_RACKS.includes(rackId)) {
      alert(t('zones.errRackExists'));
      return;
    }
    apiPost('/api/zones/' + encodeURIComponent(zoneId) + '/racks', { id: rackId }).then((res) => {
      if (res.error) {
        alert(res.error);
        return;
      }
      const zone = zones.find((z) => z.id === zoneId);
      if (zone) zone.racks.push({ id: rackId, sortOrder: zone.racks.length + 1 });
      rebuildZoneConstants();
      renderZones();
      renderStatus();
    });
  });
}
function removeRack(rackId) {
  confirm2(t('zones.rackDeleteTitle'), t('zones.rackDeleteMsg', { name: rackId }), t('zones.delete'), () => {
    apiDelete('/api/racks/' + encodeURIComponent(rackId)).then((res) => {
      if (res.error) {
        alert(res.error);
        return;
      }
      zones.forEach((z) => {
        z.racks = z.racks.filter((r) => r.id !== rackId);
      });
      rebuildZoneConstants();
      renderZones();
      renderStatus();
    });
  });
}
function bulkMoveToRack(zoneId) {
  const z = zones.find((x) => x.id === zoneId);
  if (!z || !z.racks.length) return;
  const zoneBags = getZoneBags(zoneId);
  const rackIds = new Set(z.racks.map((r) => r.id));
  const directBags = Object.entries(zoneBags).filter(([, b]) => !rackIds.has(b.loc));
  if (!directBags.length) return;
  const m = document.getElementById('m-locmove');
  document.getElementById('lm-title').textContent = t('zones.moveToRackTitle', { count: directBags.length });
  document.getElementById('lm-info').textContent = zoneDisplayName(zoneId);
  document.getElementById('lm-confirm').style.display = 'none';
  const grid = document.getElementById('lm-grid');
  grid.style.display = 'flex';
  grid.innerHTML = z.racks
    .map((r) => {
      const rBags = Object.keys(getRackBags(r.id)).length;
      return `<button class="btn btn-sm" data-action="bulk-rack-target" data-zone="${esc(zoneId)}" data-rack="${esc(r.id)}" style="font-size:12px;padding:8px 12px">${esc(r.id)} (${rBags})</button>`;
    })
    .join('');
  m.classList.add('open');
}
async function executeBulkMoveToRack(zoneId, rackId) {
  const z = zones.find((x) => x.id === zoneId);
  if (!z) return;
  const zoneBags = getZoneBags(zoneId);
  const rackIds = new Set(z.racks.map((r) => r.id));
  const directBags = Object.entries(zoneBags).filter(([, b]) => !rackIds.has(b.loc));
  if (!directBags.length) return;
  const entries = directBags.map(([bagId, b]) => ({
    action: 'MOVE',
    batch: b.batchId,
    bag: bagId,
    from: b.loc,
    to: rackId,
    species: b.species,
    strain: b.strain,
    time: new Date().toISOString(),
    client_uuid: newScanUuid(),
    // I-12: optimistic concurrency snapshot for offline-queue replays.
    expected_current_zone: b.loc ? toZone(b.loc) : null
  }));
  const res = await apiPost('/api/scan-log', { entries });
  if (handleZoneMismatch(res, entries)) return; // I-12
  if (res.error) {
    alert(res.error);
    return;
  }
  entries.forEach((e) => scanLog.push(e));
  document.getElementById('m-locmove').classList.remove('open');
  renderZones();
  renderStatus();
  setFb('ok', t('zones.movedToRack', { count: directBags.length, rack: rackId }));
}

// ─── ZONE QR CODES ──────────────────────────────────────────
async function renderZoneQrPanel(zoneId) {
  const panel = document.getElementById('zone-qr-' + zoneId);
  if (!panel) return;
  // Toggle if already loaded
  if (panel.dataset.loaded) {
    const show = panel.style.display === 'none';
    panel.style.display = show ? '' : 'none';
    const btn = panel.closest('.zone-row').querySelector('[data-action="toggle-qr"]');
    if (btn) btn.textContent = show ? t('zones.hideQr') : t('zones.showQr');
    return;
  }
  panel.style.display = '';
  panel.dataset.loaded = '1';
  const btn = panel.closest('.zone-row').querySelector('[data-action="toggle-qr"]');
  if (btn) btn.textContent = t('zones.hideQr');
  const z = zones.find((x) => x.id === zoneId);
  if (!z) return;
  const items = [zoneId, ...z.racks.map((r) => r.id)];
  const grid = document.createElement('div');
  grid.className = 'zone-qr-grid';
  for (const val of items) {
    const cell = document.createElement('div');
    cell.className = 'zone-qr-cell';
    const img = await makeQR(val);
    if (img) {
      img.style.cssText = 'width:80px;height:80px';
      cell.appendChild(img);
    }
    const lbl = document.createElement('div');
    lbl.className = 'zone-qr-label';
    lbl.textContent = val;
    cell.appendChild(lbl);
    grid.appendChild(cell);
  }
  panel.innerHTML = '';
  panel.appendChild(grid);
}

async function printZoneQrBrowser(zoneId) {
  const z = zones.find((x) => x.id === zoneId);
  if (!z) return;
  const items = [zoneId, ...z.racks.map((r) => r.id)];
  await printQrSheet(items, z.name);
}

async function printAllZoneQrBrowser() {
  const items = [...ZONES, ...ALL_RACKS];
  await printQrSheet(items, 'All Zones');
}

async function printQrSheet(items, title) {
  const sheet = document.getElementById('ref-print-sheet');
  sheet.innerHTML = '';
  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-family:Arial,sans-serif;font-size:15px;font-weight:bold;margin-bottom:12px;padding:8px';
  hdr.textContent = 'QR Codes: ' + title;
  sheet.appendChild(hdr);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:0 8px';
  for (const val of items) {
    const cell = document.createElement('div');
    cell.style.cssText =
      'border:1px solid var(--c-border);border-radius:5px;padding:5px 7px;text-align:center;background:var(--c-surface);page-break-inside:avoid';
    const img = await makeQR(val);
    if (img) {
      img.style.width = '80px';
      img.style.height = '80px';
      cell.appendChild(img);
    }
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:10px;font-weight:bold;font-family:Arial,sans-serif';
    lbl.textContent = val;
    cell.appendChild(lbl);
    row.appendChild(cell);
  }
  sheet.appendChild(row);
  setTimeout(() => window.print(), 600);
}

// ─── MUSHROOM STRAINS ────────────────────────────────────────
function fillStrainSelects() {
  const opts =
    '<option value="">' +
    t('strains.selectPlaceholder') +
    '</option>' +
    mushroomStrains.map((ms) => `<option value="${ms.id}">${esc(ms.name)} (${esc(ms.kuerzel)})</option>`).join('');
  const hint = mushroomStrains.length === 0;
  ['nb-strain-sel', 'lw-st'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    // Skip rewrite when options are unchanged: SSE-pushed re-syncs (any other
    // user moving bags / scanning / harvesting) would otherwise clobber the
    // <select> mid-tap, which on Android closes the native picker and drops
    // the selection.
    if (el.innerHTML === opts) return;
    const cur = el.value;
    el.innerHTML = opts;
    if (cur) el.value = cur;
  });
  const nbHint = document.getElementById('nb-no-strains-hint');
  if (nbHint) nbHint.style.display = hint ? 'block' : 'none';
}

// Navigate to the Pilzsorten page and focus the name input so the user can
// create a strain without hunting for it. Called from the "Create now →"
// shortcut in the new-batch form and from createBatch / createGrainBatch
// when no strains are defined yet.
function goCreateStrain() {
  go('strains', 'n-strains');
  setTimeout(() => {
    const el = document.getElementById('ms-name');
    if (el) el.focus();
  }, 60);
}

function renderStrains() {
  const body = document.getElementById('strains-body');
  if (!body) return;
  _msFillRecCopyOptions(parseInt((document.getElementById('ms-edit-id') || {}).value, 10) || null);
  if (!mushroomStrains.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">' + t('strains.empty') + '</td></tr>';
    return;
  }
  // Count usage
  const batchCount = (id) => batches.filter((b) => b.strainId === id).length;
  const cultureCount = (id) => cultures.filter((c) => c.strainId === id).length;
  body.innerHTML = mushroomStrains
    .map((ms) => {
      const bc = batchCount(ms.id),
        cc = cultureCount(ms.id);
      const inUse = bc > 0 || cc > 0;
      const usageParts = [];
      if (bc > 0) usageParts.push(bc + ' ' + t('strains.batches'));
      if (cc > 0) usageParts.push(cc + ' ' + t('strains.cultures'));
      const usageText = usageParts.join(', ') || '—';
      // Quick-create straight from this Sorte. "+ Charge" needs a recipe;
      // "+ Labor" only needs the Sorte (cultures carry no substrate recipe).
      const chargeBtn = ms.recBatchType
        ? `<button class="btn btn-sm btn-p" onclick="msQuickCharge(${ms.id})" style="padding:2px 7px" title="${t('strains.addChargeHint')}">${t('strains.addCharge')}</button> `
        : '';
      return `<tr>
      <td style="font-weight:500">${esc(ms.name)}</td>
      <td><span style="font-family:monospace;font-size:12px;background:var(--c-bg);padding:2px 7px;border-radius:4px">${esc(ms.kuerzel)}</span></td>
      <td style="font-size:12px;color:var(--c-text-sec)">${ms.description ? esc(ms.description) : '<span style="color:var(--c-text-muted)">—</span>'}</td>
      <td style="font-size:12px;color:var(--c-text-sec)">${msRecipeSummary(ms)}</td>
      <td style="font-size:12px;color:var(--c-text-sec)">${esc(usageText)}</td>
      <td style="white-space:nowrap">
        ${chargeBtn}<button class="btn btn-sm" onclick="msQuickLabor(${ms.id})" style="padding:2px 7px" title="${t('strains.addLaborHint')}">${t('strains.addLabor')}</button>
        <button class="btn btn-sm" onclick="editMStrain(${ms.id})" style="padding:2px 7px">${t('strains.editBtn')}</button>
        <button class="btn btn-sm btn-r" onclick="deleteMStrain(${ms.id})" ${inUse ? 'disabled title="' + t('strains.deleteProtected') + '"' : ''} style="padding:2px 7px">&#x2715;</button>
      </td>
    </tr>`;
    })
    .join('');
}

function saveMStrain() {
  const name = document.getElementById('ms-name').value.trim();
  const kuerzel = document.getElementById('ms-kuerzel').value.trim().toUpperCase();
  const desc = document.getElementById('ms-desc').value.trim();
  const editId = document.getElementById('ms-edit-id').value;
  if (!name || !kuerzel) {
    alert(t('strains.required'));
    return;
  }
  if (kuerzel.length < 2 || kuerzel.length > 4) {
    alert(t('strains.kuerzelLength'));
    return;
  }
  const rec = _msReadRecipe();
  const payload = { name, kuerzel, description: desc, ...rec };
  const num = (v, d) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);
  const recLocal = {
    recBatchType: rec.recBatchType || '',
    recSubstrate: rec.recSubstrate || 'holzkleie',
    recBagKg: num(rec.recBagKg, 0),
    recRhPct: num(rec.recRhPct, 0),
    recHardwoodPct: num(rec.recHardwoodPct, 0),
    recWheatbranPct: num(rec.recWheatbranPct, 0),
    recCoirPct: num(rec.recCoirPct, 0),
    recGypsum: !!rec.recGypsum,
    recGrainKg: num(rec.recGrainKg, 0),
    recGrainRhPct: num(rec.recGrainRhPct, 52),
    recIncDays: num(rec.recIncDays, 14)
  };
  const req = editId ? apiPatch('/api/mushroom-strains/' + editId, payload) : apiPost('/api/mushroom-strains', payload);
  req.then((r) => {
    if (r && r.error) {
      alert(t('common.error') + ': ' + r.error);
      return;
    }
    if (!editId && r && r.id) {
      mushroomStrains.push({
        id: r.id,
        name,
        kuerzel,
        description: desc,
        created: new Date().toISOString(),
        ...recLocal
      });
    } else if (editId) {
      const ms = mushroomStrains.find((x) => x.id === parseInt(editId));
      if (ms) {
        ms.name = name;
        ms.kuerzel = kuerzel;
        ms.description = desc;
        Object.assign(ms, recLocal);
      }
    }
    mushroomStrains.sort((a, b) => a.name.localeCompare(b.name));
    fillStrainSelects();
    renderStrains();
    cancelMStrain();
  });
}

function editMStrain(id) {
  const ms = mushroomStrains.find((x) => x.id === id);
  if (!ms) return;
  document.getElementById('ms-name').value = ms.name;
  document.getElementById('ms-kuerzel').value = ms.kuerzel;
  document.getElementById('ms-desc').value = ms.description || '';
  document.getElementById('ms-edit-id').value = id;
  const sv = (eid, val) => {
    const el = document.getElementById(eid);
    if (el) el.value = val;
  };
  sv('ms-rec-type', ms.recBatchType || '');
  sv('ms-rec-substrate', ms.recSubstrate || 'holzkleie');
  sv('ms-rec-bagkg', ms.recBagKg || 0);
  sv('ms-rec-rh', ms.recRhPct || 0);
  sv('ms-rec-hw', ms.recHardwoodPct || 0);
  sv('ms-rec-wb', ms.recWheatbranPct || 0);
  sv('ms-rec-coir', ms.recCoirPct || 0);
  const gyp = document.getElementById('ms-rec-gyp');
  if (gyp) gyp.checked = !!ms.recGypsum;
  sv('ms-rec-grainkg', ms.recGrainKg || 0);
  sv('ms-rec-grainrh', ms.recGrainRhPct != null ? ms.recGrainRhPct : 52);
  sv('ms-rec-days', ms.recIncDays != null ? ms.recIncDays : 14);
  sv('ms-rec-fruitdays', ms.recFruitDays || 0);
  msRecTypeChange();
  _msFillRecCopyOptions(id);
  document.getElementById('ms-save-btn').textContent = t('strains.saveChanges');
  document.getElementById('ms-cancel-btn').style.display = '';
  document.getElementById('ms-name').focus();
}

function cancelMStrain() {
  document.getElementById('ms-name').value = '';
  document.getElementById('ms-kuerzel').value = '';
  document.getElementById('ms-desc').value = '';
  document.getElementById('ms-edit-id').value = '';
  document.getElementById('ms-save-btn').setAttribute('data-i18n', 'strains.save');
  document.getElementById('ms-save-btn').textContent = t('strains.save');
  document.getElementById('ms-cancel-btn').style.display = 'none';
  const sv = (eid, val) => {
    const el = document.getElementById(eid);
    if (el) el.value = val;
  };
  sv('ms-rec-type', '');
  sv('ms-rec-substrate', 'holzkleie');
  sv('ms-rec-bagkg', 0);
  sv('ms-rec-rh', 0);
  sv('ms-rec-hw', 75);
  sv('ms-rec-wb', 25);
  sv('ms-rec-coir', 100);
  const gyp = document.getElementById('ms-rec-gyp');
  if (gyp) gyp.checked = false;
  sv('ms-rec-grainkg', 0);
  sv('ms-rec-grainrh', 52);
  sv('ms-rec-days', 14);
  sv('ms-rec-fruitdays', 0);
  msRecTypeChange();
  _msFillRecCopyOptions(null);
}

function deleteMStrain(id) {
  const ms = mushroomStrains.find((x) => x.id === id);
  if (!ms) return;
  confirm2(t('strains.deleteTitle'), t('strains.deleteMsg', { name: ms.name }), t('strains.delete'), () => {
    apiDelete('/api/mushroom-strains/' + id).then((r) => {
      if (r && r.error) {
        alert(t('common.error') + ': ' + r.error);
        return;
      }
      mushroomStrains = mushroomStrains.filter((x) => x.id !== id);
      fillStrainSelects();
      renderStrains();
    });
  });
}

// ── Sorte production recipe (rec_*) — editor toggle + per-bag need preview ───
function _msReadRecipe() {
  const v = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : '';
  };
  const chk = (id) => {
    const el = document.getElementById(id);
    return el && el.checked ? 1 : 0;
  };
  return {
    recBatchType: v('ms-rec-type') || '',
    recSubstrate: v('ms-rec-substrate') || 'holzkleie',
    recBagKg: v('ms-rec-bagkg'),
    recRhPct: v('ms-rec-rh'),
    recHardwoodPct: v('ms-rec-hw'),
    recWheatbranPct: v('ms-rec-wb'),
    recCoirPct: v('ms-rec-coir'),
    recGypsum: chk('ms-rec-gyp'),
    recGrainKg: v('ms-rec-grainkg'),
    recGrainRhPct: v('ms-rec-grainrh'),
    recIncDays: v('ms-rec-days'),
    recFruitDays: v('ms-rec-fruitdays')
  };
}
// Map a recipe (rec_*) onto the product spec shape so we can reuse the shared
// _ohProdNeedCompute charge math (same hydration formula as the Charge form).
function _msRecipeToProd(rec) {
  return {
    prodType: rec.recBatchType || 'buy',
    prodSubstrate: rec.recSubstrate,
    prodBagKg: rec.recBagKg,
    prodRhPct: rec.recRhPct,
    prodHardwoodPct: rec.recHardwoodPct,
    prodWheatbranPct: rec.recWheatbranPct,
    prodCoirPct: rec.recCoirPct,
    prodGypsum: rec.recGypsum,
    prodGrainKg: rec.recGrainKg,
    prodGrainRhPct: rec.recGrainRhPct
  };
}
function _msStrainToRecipe(ms) {
  return {
    recBatchType: ms.recBatchType,
    recSubstrate: ms.recSubstrate,
    recBagKg: ms.recBagKg,
    recRhPct: ms.recRhPct,
    recHardwoodPct: ms.recHardwoodPct,
    recWheatbranPct: ms.recWheatbranPct,
    recCoirPct: ms.recCoirPct,
    recGypsum: ms.recGypsum,
    recGrainKg: ms.recGrainKg,
    recGrainRhPct: ms.recGrainRhPct
  };
}
const _MS_MAT_KEY = {
  grain: 'inv.grain',
  hardwood: 'inv.hardwood',
  wheatbran: 'inv.wheatBran',
  gypsum: 'inv.gypsum',
  coir: 'inv.coir'
};
function _msNeedParts(rec, mult) {
  const fmt = (n) => (Math.round(n * 1000) / 1000).toString();
  const need = _ohProdNeedCompute(_msRecipeToProd(rec));
  const m = mult || 1;
  return Object.keys(need)
    .filter((k) => need[k] > 0)
    .map((k) => `${esc(t(_MS_MAT_KEY[k] || k))} ${fmt(need[k] * m)} kg`);
}
function msRecTypeChange() {
  const type = (document.getElementById('ms-rec-type') || {}).value || '';
  const sub = (document.getElementById('ms-rec-substrate') || {}).value || 'holzkleie';
  const set = (id, disp) => {
    const el = document.getElementById(id);
    if (el) el.style.display = disp;
  };
  set('ms-rec-subgroup', type === 'block' || type === 'allinone' ? 'block' : 'none');
  set('ms-rec-graingroup', type === 'grain' || type === 'allinone' ? 'block' : 'none');
  set('ms-rec-holzgroup', sub === 'holzkleie' ? 'grid' : 'none');
  set('ms-rec-coirgroup', sub === 'cvg' ? 'grid' : 'none');
  set('ms-rec-daysrow', type ? 'grid' : 'none');
  msRecNeed();
}
function msRecNeed() {
  const el = document.getElementById('ms-rec-need');
  if (!el) return;
  const rec = _msReadRecipe();
  if (!rec.recBatchType) {
    el.textContent = '';
    return;
  }
  const parts = _msNeedParts(rec, 1);
  el.textContent = parts.length ? t('orders.p.needPrefix') + ' ' + parts.join(' · ') : '';
}
// Populate the "copy recipe from another Sorte" dropdown with Sorten that have a
// recipe (excluding the one being edited).
function _msFillRecCopyOptions(excludeId) {
  const sel = document.getElementById('ms-rec-copy');
  if (!sel) return;
  const list = mushroomStrains
    .filter((x) => x.recBatchType && x.id !== excludeId)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  sel.innerHTML =
    '<option value="">' +
    esc(t('strains.recCopyNone')) +
    '</option>' +
    list.map((x) => `<option value="${x.id}">${esc(x.name)}${x.kuerzel ? ' (' + esc(x.kuerzel) + ')' : ''}</option>`).join('');
  sel.value = '';
}
// Copy another Sorte's recipe into the form (most Sorten share the same recipe).
function msRecCopyFrom() {
  const sel = document.getElementById('ms-rec-copy');
  if (!sel || !sel.value) return;
  const src = mushroomStrains.find((x) => x.id === parseInt(sel.value, 10));
  if (!src) return;
  const sv = (eid, val) => {
    const el = document.getElementById(eid);
    if (el) el.value = val;
  };
  sv('ms-rec-type', src.recBatchType || '');
  sv('ms-rec-substrate', src.recSubstrate || 'holzkleie');
  sv('ms-rec-bagkg', src.recBagKg || 0);
  sv('ms-rec-rh', src.recRhPct || 0);
  sv('ms-rec-hw', src.recHardwoodPct || 0);
  sv('ms-rec-wb', src.recWheatbranPct || 0);
  sv('ms-rec-coir', src.recCoirPct || 0);
  const gyp = document.getElementById('ms-rec-gyp');
  if (gyp) gyp.checked = !!src.recGypsum;
  sv('ms-rec-grainkg', src.recGrainKg || 0);
  sv('ms-rec-grainrh', src.recGrainRhPct != null ? src.recGrainRhPct : 52);
  sv('ms-rec-days', src.recIncDays != null ? src.recIncDays : 14);
  sv('ms-rec-fruitdays', src.recFruitDays || 0);
  sel.value = '';
  msRecTypeChange();
}
function msRecipeSummary(ms) {
  const type = ms.recBatchType || '';
  if (!type) return '<span style="color:var(--c-text-muted)">—</span>';
  const typeLabel =
    { block: t('strains.recBlock'), allinone: t('strains.recAllinone'), grain: t('strains.recGrain') }[type] || type;
  const parts = [esc(typeLabel)];
  if (type === 'block' || type === 'allinone') {
    if ((ms.recSubstrate || 'holzkleie') === 'cvg') parts.push(esc(t('orders.sub.cvg')));
    else parts.push('HW' + (ms.recHardwoodPct || 0) + '/WB' + (ms.recWheatbranPct || 0));
    if (ms.recBagKg) parts.push((ms.recBagKg || 0) + ' kg');
  }
  if ((type === 'allinone' || type === 'grain') && ms.recGrainKg) parts.push('Grain ' + ms.recGrainKg + ' kg');
  return '<span style="font-size:11px">' + parts.join(' · ') + '</span>';
}
function msRecipeSummaryText(ms) {
  // Plain-text variant of msRecipeSummary for the quick-create modal subtitle.
  const div = document.createElement('div');
  div.innerHTML = msRecipeSummary(ms);
  return div.textContent || '';
}

// ── Quick-create: spin a Charge or Laborarbeit straight from a Sorte recipe ──
let _msQuickCtx = null;

function msQuickCharge(id) {
  const ms = mushroomStrains.find((x) => x.id === id);
  if (!ms) return;
  if (!ms.recBatchType) {
    alert(t('msq.noRecipe'));
    return;
  }
  msQuickOpen('charge', ms);
}
function msQuickLabor(id) {
  const ms = mushroomStrains.find((x) => x.id === id);
  if (!ms) return;
  msQuickOpen('labor', ms);
}
// Dashboard entry points: open the dialog with a Sorte dropdown (none preselected),
// so "Neue Charge" / "Laborarbeit" go straight to the create dialog instead of the
// Pilzsorten list. The recipe still comes from whichever Sorte is then chosen.
function msQuickChargeNew() {
  msQuickOpen('charge', null);
}
function msQuickLaborNew() {
  msQuickOpen('labor', null);
}
// Last quantity used per quick-create mode, so the dialog reopens on the batch
// size actually being run instead of 1. Stored per mode: a Charge is typically
// tens of bags, a Laborarbeit a handful.
function _msqLastQty(mode) {
  try {
    const s = JSON.parse(localStorage.getItem('mp-msq-qty') || '{}');
    const n = parseInt(s[mode], 10);
    if (n > 0) return n;
  } catch (e) {
    /* storage disabled — fall back to 1 */
  }
  return 1;
}
function _msqSaveQty(mode, qty) {
  if (!(qty > 0)) return;
  try {
    const s = JSON.parse(localStorage.getItem('mp-msq-qty') || '{}');
    s[mode] = qty;
    localStorage.setItem('mp-msq-qty', JSON.stringify(s));
  } catch (e) {
    /* storage disabled — next open just starts at 1 */
  }
}
// Why a recipe can't be turned into a Charge, or null if it can.
// A recipe only needs rec_batch_type to qualify for the picker, but the columns
// behind it all default to 0 — so a Sorte could be offered here and then be
// rejected by createBatch for a missing bag weight or a substrate split that
// doesn't total 100. Those rejections fire after msQuickClose(), i.e. against a
// modal that is already gone, discarding whatever was typed. Catch it up front
// and keep the reason on screen instead.
function _msRecipeProblem(ms) {
  const type = ms.recBatchType || '';
  if (!type) return t('msq.noRecipe');
  if (type === 'block' || type === 'allinone') {
    if (!(ms.recBagKg > 0)) return t('msq.recNoBagKg');
    if ((ms.recSubstrate || 'holzkleie') === 'cvg') {
      if (!(ms.recCoirPct > 0)) return t('msq.recNoCoir');
    } else {
      const sum = (ms.recHardwoodPct || 0) + (ms.recWheatbranPct || 0);
      if (Math.abs(sum - 100) > 0.01) return t('msq.recBadSplit', { sum });
    }
  }
  if ((type === 'grain' || type === 'allinone') && !(ms.recGrainKg > 0)) return t('msq.recNoGrainKg');
  return null;
}
// Shared opener. ms === null → show the Sorte picker (charge mode lists only Sorten
// that have a recipe, since a Charge needs one).
function msQuickOpen(mode, ms) {
  _msQuickCtx = { mode, ms: ms || null };
  // Fresh dialog, fresh inoculant list — one left over from an abandoned dialog
  // would otherwise be offered up for the next batch.
  _inoc = [];
  const cSel = document.getElementById('ms-q-culture');
  if (cSel) {
    cSel.value = '';
    cSel.style.display = 'none';
  }
  const wrap = document.getElementById('ms-q-sorte-wrap');
  const sel = document.getElementById('ms-q-sorte');
  if (!ms && wrap && sel) {
    let list = mushroomStrains.slice();
    if (mode === 'charge') list = list.filter((x) => x.recBatchType);
    // No Sorte has a production recipe yet: the dialog would open on an empty
    // dropdown with Anlegen disabled and no hint why. Point at the page where a
    // recipe is actually defined instead of opening a dead end.
    if (mode === 'charge' && !list.length) {
      _msQuickCtx = null;
      confirm2(t('msq.noRecipesTitle'), t('msq.noRecipesMsg'), t('msq.noRecipesGo'), goCreateStrain);
      return;
    }
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    sel.innerHTML =
      '<option value="">' +
      esc(t('msq.pickSortePrompt')) +
      '</option>' +
      list.map((x) => `<option value="${x.id}">${esc(x.name)}${x.kuerzel ? ' (' + esc(x.kuerzel) + ')' : ''}</option>`).join('');
    sel.value = '';
    wrap.style.display = '';
  } else if (wrap) {
    wrap.style.display = 'none';
  }
  // qty/strain reset only on open (not when the Sorte changes). qty restores the
  // last value used in this mode rather than snapping back to 1: batch size is
  // the one number the recipe cannot supply, it barely changes between runs, and
  // stepping it back up to 20 costs 19 taps on a phone. The manual form already
  // persists its qty the same way (nbSaveDefaults).
  const qtyEl = document.getElementById('ms-q-qty');
  if (qtyEl) qtyEl.value = _msqLastQty(mode);
  const strainEl = document.getElementById('ms-q-strain');
  if (strainEl) strainEl.value = '';
  msQuickRender();
  document.getElementById('ms-quick-modal').style.display = 'flex';
}
// Render the modal for the current ctx. Safe when no Sorte is chosen yet (picker
// mode): shows a prompt and disables "Anlegen" until one is selected.
function msQuickRender() {
  if (!_msQuickCtx) return;
  const mode = _msQuickCtx.mode;
  const ms = _msQuickCtx.ms;
  const titleEl = document.getElementById('ms-q-title');
  const subEl = document.getElementById('ms-q-sub');
  const goEl = document.getElementById('ms-q-go');
  if (titleEl) titleEl.textContent = mode === 'charge' ? t('msq.chargeTitle') : t('msq.laborTitle');
  const lt = document.getElementById('ms-q-labtype-wrap');
  if (lt) lt.style.display = mode === 'labor' ? '' : 'none';
  // Grain spawn is a Charge in everything but name: it is weighed, incubates,
  // and produces barcoded bags. So it wants the days and kg fields that the
  // count-based culture types don't.
  const isKb = _msqIsGrainspawn();
  const dw = document.getElementById('ms-q-days-wrap');
  if (dw) dw.style.display = mode === 'charge' || isKb ? '' : 'none';
  const gw = document.getElementById('ms-q-grainkg-wrap');
  if (gw) gw.style.display = isKb ? '' : 'none';
  if (!ms) {
    if (subEl) subEl.textContent = t('msq.pickSortePrompt');
    if (goEl) goEl.disabled = true;
    const prev = document.getElementById('ms-q-preview');
    if (prev) prev.textContent = '';
    const cw = document.getElementById('ms-q-culture-wrap');
    if (cw) cw.style.display = 'none';
    return;
  }
  // An incomplete recipe is rejected downstream by createBatch, long after this
  // dialog has closed — so block it here, while the reason is still readable.
  const problem = mode === 'charge' ? _msRecipeProblem(ms) : null;
  if (goEl) goEl.disabled = !!problem;
  if (subEl)
    subEl.textContent =
      ms.name + (ms.kuerzel ? ' (' + ms.kuerzel + ')' : '') + (mode === 'charge' ? ' — ' + msRecipeSummaryText(ms) : '');
  if (mode === 'charge') {
    const d = document.getElementById('ms-q-days');
    if (d) d.value = ms.recIncDays || 14;
  } else if (isKb) {
    // No block recipe carries a spawn-bag weight, so seed both from the
    // inventory averages the grain form already uses.
    const d = document.getElementById('ms-q-days');
    if (d && !(parseInt(d.value, 10) > 0)) d.value = 14;
    const g = document.getElementById('ms-q-grainkg');
    if (g && !(parseDecimal(g.value) > 0)) g.value = getAvgComp().grainBagKg;
  }
  msQuickPreview();
  msQuickFillCulture();
  inocRender('ms-q');
  if (problem) {
    const prev = document.getElementById('ms-q-preview');
    if (prev) {
      prev.textContent = '⚠ ' + problem;
      prev.style.color = 'var(--c-red-dark)';
    }
  }
}
// True when the quick dialog is in Laborarbeit mode with Grainspawn selected.
// Grain spawn (KB) is not a culture: it goes through createGrainBatch, not
// logLabWork, and produces G-prefixed barcoded bags.
function _msqIsGrainspawn() {
  if (!_msQuickCtx || _msQuickCtx.mode !== 'labor') return false;
  const el = document.getElementById('ms-q-labtype');
  return !!el && el.value === 'KB';
}
function msQuickLabTypeChanged() {
  // Full re-render, not just the culture list: switching to Grainspawn shows
  // the days + kg fields and switching away hides them again.
  msQuickRender();
}
function msQuickSorteChanged() {
  if (!_msQuickCtx) return;
  const id = parseInt(document.getElementById('ms-q-sorte').value, 10);
  _msQuickCtx.ms = mushroomStrains.find((x) => x.id === id) || null;
  msQuickRender();
}
function msQuickClose() {
  _msQuickCtx = null;
  _inocScanPrefix = null;
  // Drop the inoculant list. Abandoning the dialog must not leave it armed for
  // whatever batch is created next. The confirm path closes the dialog before
  // createBatch runs, so it carries the list across itself — see msQuickConfirm.
  _inoc = [];
  const m = document.getElementById('ms-quick-modal');
  if (m) m.style.display = 'none';
}
function msqQtyStep(d) {
  const el = document.getElementById('ms-q-qty');
  if (!el) return;
  el.value = Math.max(1, (parseInt(el.value, 10) || 0) + d);
  msQuickPreview();
}
function msQuickPreview() {
  const el = document.getElementById('ms-q-preview');
  if (!el) return;
  el.style.color = ''; // clear the recipe-problem styling from a previous render
  if (!_msQuickCtx || !_msQuickCtx.ms) {
    el.textContent = '';
    return;
  }
  const qty = parseInt(document.getElementById('ms-q-qty').value) || 0;
  if (_msQuickCtx.mode === 'charge') {
    const parts = qty > 0 ? _msNeedParts(_msStrainToRecipe(_msQuickCtx.ms), qty) : [];
    el.textContent = parts.length ? t('orders.p.needPrefix') + ' ' + parts.join(' · ') : '';
  } else if (_msqIsGrainspawn()) {
    // Only dry grain is deducted, so show the hydrated→dry figure the grain
    // form and createGrainBatch both use rather than the wet bag weight.
    const kg = parseDecimal((document.getElementById('ms-q-grainkg') || {}).value) || 0;
    const dry = qty * mtDryKg(kg, getAvgComp().grainRhPct);
    el.textContent =
      qty > 0 && kg > 0
        ? t('msq.grainPreview', { n: qty }) + ' — ' + t('orders.p.needPrefix') + ' ' + Math.round(dry * 1000) / 1000 + ' kg'
        : '';
  } else {
    el.textContent = qty > 0 ? t('msq.laborPreview', { n: qty }) : '';
  }
}
// Populate the modal's source-culture select, reusing the same culture filter the
// old forms use (none for a new MC isolation). Re-runs when the lab type changes.
function msQuickFillCulture() {
  const wrap = document.getElementById('ms-q-culture-wrap');
  const sel = document.getElementById('ms-q-culture');
  if (!wrap || !sel || !_msQuickCtx || !_msQuickCtx.ms) {
    if (wrap) wrap.style.display = 'none';
    return;
  }
  let types;
  if (_msQuickCtx.mode === 'charge') {
    types = _msQuickCtx.ms.recBatchType === 'grain' ? ['PD', 'LC'] : ['PD', 'LC', 'G2G', 'GS'];
  } else {
    const lt = document.getElementById('ms-q-labtype').value;
    // KB matches the full grain form, which inoculates from a PD or LC.
    types =
      lt === 'PD' ? ['MC', 'PD', 'LC'] : lt === 'LC' ? ['MC', 'PD'] : lt === 'KB' ? ['PD', 'LC'] : null; // MC = new isolation
  }
  if (!types) {
    sel.value = '';
    wrap.style.display = 'none';
    return;
  }
  // The hidden select still carries a culture through to nb-culture/gs-culture.
  fillCultureSelect('ms-q-culture', types);
  wrap.style.display = '';
  inocRender('ms-q');
}
// The camera modal is z-index 200 and this dialog is 1200, so the camera would
// open behind it. Hide the dialog for the duration and put it back on close —
// _msQuickCtx survives, so nothing typed is lost. _inocScanPrefix doubles as the
// record of who opened the camera, so 'ms-q' is what says to restore.
function msqOpenScan(prefix) {
  _inocScanPrefix = prefix;
  const m = document.getElementById('ms-quick-modal');
  if (m) m.style.display = 'none';
  scan.action = null;
  scan.to = null;
  scan.from = null;
  updateSD();
  openCamScan();
}
// Takes the prefix as an argument because closeCamScan clears _inocScanPrefix,
// and reading it here after that would always see null.
function msqRestoreAfterScan(prefix) {
  if (prefix !== 'ms-q') return;
  if (!_msQuickCtx) return; // confirmed or dismissed while the camera was up
  const m = document.getElementById('ms-quick-modal');
  if (m) m.style.display = 'flex';
  msQuickRender();
}
function msQuickConfirm() {
  if (!_msQuickCtx) return;
  if (!_msQuickCtx.ms) {
    alert(t('msq.pickSortePrompt'));
    return;
  }
  const ms = _msQuickCtx.ms;
  const mode = _msQuickCtx.mode;
  const qty = parseInt(document.getElementById('ms-q-qty').value) || 0;
  if (qty < 1) {
    alert(t('batch.fillQty'));
    return;
  }
  _msqSaveQty(mode, qty);
  const strainText = (document.getElementById('ms-q-strain').value || '').trim();
  const setv = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  const setchk = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };
  const sourceCulture =
    (document.getElementById('ms-q-culture') && document.getElementById('ms-q-culture').value) || '';
  if (mode === 'labor') {
    const labType = document.getElementById('ms-q-labtype').value || 'MC';
    // Grainspawn is not a culture: it is weighed, incubates and yields
    // G-prefixed barcoded bags, so it goes through createGrainBatch like the
    // full Körnerbrut form rather than logLabWork.
    if (labType === 'KB') {
      const grainKg = parseDecimal((document.getElementById('ms-q-grainkg') || {}).value) || 0;
      // Validate before closing: gsReadLines drops zero-weight rows, so a 0 here
      // would reach createGrainBatch as "no lines" and alert against a dialog
      // that is already gone, discarding everything typed.
      if (grainKg <= 0) {
        alert(t('batch.enterWeight'));
        return;
      }
      setv('lw-st', ms.id);
      setv('lw-strain-text', strainText);
      if (typeof gsResetLines === 'function') gsResetLines();
      const row = document.querySelector('.gs-wline');
      if (row) {
        const kgEl = row.querySelector('.gs-line-kg');
        const qtyEl = row.querySelector('.gs-line-qty');
        if (kgEl) kgEl.value = grainKg;
        if (qtyEl) qtyEl.value = qty;
      }
      setv('gs-days', parseInt(document.getElementById('ms-q-days').value) || 14);
      setv('gs-rh', getAvgComp().grainRhPct);
      fillCultureSelect('gs-culture', ['PD', 'LC']);
      const gsc = document.getElementById('gs-culture');
      if (gsc) gsc.value = sourceCulture;
      setv('lw-notes', '');
      msQuickClose();
      createGrainBatch();
      return;
    }
    setv('lw-type', labType);
    setv('lw-st', ms.id);
    setv('lw-strain-text', strainText);
    setv('lw-qty', qty);
    setv('lw-source', '');
    setv('lw-notes', '');
    msQuickClose();
    go('lab', 'n-lab');
    openStab('lab', 'work'); // populates lw-parent via lwUpdate()
    const parent = document.getElementById('lw-parent');
    if (parent) parent.value = sourceCulture; // valid: the modal used the same culture types
    logLabWork();
    return;
  }
  // Charge: prefill the existing Charge form from the recipe and reuse its
  // create logic (validation, inventory deduction, zone picker, barcodes).
  const days = parseInt(document.getElementById('ms-q-days').value) || ms.recIncDays || 14;
  if (ms.recBatchType === 'grain') {
    setv('lw-st', ms.id);
    setv('lw-strain-text', strainText);
    if (typeof gsResetLines === 'function') gsResetLines();
    const row = document.querySelector('.gs-wline');
    if (row) {
      const kgEl = row.querySelector('.gs-line-kg');
      const qtyEl = row.querySelector('.gs-line-qty');
      if (kgEl) kgEl.value = ms.recGrainKg || 1;
      if (qtyEl) qtyEl.value = qty;
    }
    setv('gs-days', days);
    setv('gs-rh', ms.recGrainRhPct != null ? ms.recGrainRhPct : 52);
    fillCultureSelect('gs-culture', ['PD', 'LC']);
    const gsc = document.getElementById('gs-culture');
    if (gsc) gsc.value = sourceCulture;
    setv('lw-notes', '');
    msQuickClose();
    createGrainBatch();
    return;
  }
  // block / all-in-one
  // msQuickClose clears the grain-bag selection so an abandoned dialog cannot
  // leak into the next batch — so carry it over the close explicitly.
  const _inocPicked = _inoc.slice();
  // Land on the Charge page BEFORE prefilling. createBatch's success panel
  // (nb-result, with the print buttons) lives inside sp-batch-new, so creating
  // from the dashboard shortcut used to reveal it on a page the worker was not
  // looking at — the batch appeared, the labels did not. Order matters: opening
  // the sub-tab can run nbApplyDefaults() on first visit, which would overwrite
  // every field the recipe is about to set.
  msQuickClose();
  go('batch', 'n-batch');
  openStab('batch', 'new');
  const isCvg = (ms.recSubstrate || 'holzkleie') === 'cvg';
  setv('nb-strain-sel', ms.id);
  setv('nb-strain-text', strainText);
  setv('nb-qty', qty);
  setv('nb-days', days);
  setv('nb-weight', ms.recBagKg || 0);
  setv('nb-rh', ms.recRhPct || 0);
  setv('nb-hw', isCvg ? 0 : ms.recHardwoodPct || 0);
  setv('nb-wb', isCvg ? 0 : ms.recWheatbranPct || 0);
  setv('nb-coir', isCvg ? ms.recCoirPct || 100 : 0);
  setv('nb-grainkg', ms.recBatchType === 'allinone' ? ms.recGrainKg || 0 : 0);
  setv('nb-grainrh', ms.recGrainRhPct != null ? ms.recGrainRhPct : 52);
  setchk('nb-gyp', ms.recGypsum);
  fillCultureSelect('nb-culture', ['PD', 'LC', 'G2G', 'GS']);
  const nbc = document.getElementById('nb-culture');
  if (nbc) nbc.value = sourceCulture;
  setv('nb-notes', '');
  _inoc = _inocPicked;
  inocRender('nb');
  createBatch();
}

function nbStrainChanged() {
  nbPreview();
}
function renderNbGrainBanner() {
  const banner = document.getElementById('nb-source-banner');
  if (!banner) return;
  const sel = document.getElementById('nb-culture');
  const id = sel ? sel.value : '';
  if (!id) {
    banner.style.display = 'none';
    banner.textContent = '';
    return;
  }
  const c = cultures.find((x) => x.id === id);
  if (!c) {
    banner.style.display = 'none';
    return;
  }
  const isGrain = c.type === 'G2G' || c.type === 'GS';
  const base = t('scanFb.cultureAutofilled', { id: c.id });
  const suffix = isGrain ? ' \u2014 ' + t('batch.willMarkUsed') : '';
  banner.textContent = base + suffix;
  banner.style.display = '';
}

// ─── CULTURES ────────────────────────────────────────────────
// The class comes from a lookup, so it is safe by construction — the label does
// not. Both of these render a value straight from the cultures table, and both
// go into the page via innerHTML, so an unescaped label is stored XSS that
// fires on render with no click involved. Escaping here rather than at the
// call sites covers all of them at once, and covers rows already in the
// database, which validating new writes cannot.
const ctBadge = (t) => {
  const m = { MC: 'badge-mc', PD: 'badge-pd', LC: 'badge-lc', G2G: 'badge-g2g' };
  return `<span class="badge ${m[t] || ''}">${esc(t)}</span>`;
};
const csBadge = (s) => {
  const m = { active: 'badge-active', stored: 'badge-stored', used: 'badge-used', contam: 'badge-contam' };
  return `<span class="badge ${m[s] || ''}">${esc(s)}</span>`;
};
// Culture strain display: show only explicit strainText,
// fall back to legacy free-text strain field for historical rows without strain_id.
function cultureStrainDisplay(c) {
  const st = (c.strainText || '').trim();
  if (st) return esc(st);
  if (!c.strainId && c.strain) return esc(c.strain);
  return '\u2014';
}
function fillCultureSelect(id, types) {
  const s = document.getElementById(id);
  if (!s) return;
  const opts =
    '<option value="">— none —</option>' +
    cultures
      .filter((c) => (c.status === 'active' || c.status === 'stored') && (!types || types.includes(c.type)))
      .map((c) => {
        const kz = c.strainKuerzel || c.strain || '';
        const name = c.strainName || c.species || '';
        const st = (c.strainText || '').trim();
        const label =
          (kz ? '[' + esc(kz) + '] ' : '') +
          esc(c.id) +
          ' — ' +
          esc(name) +
          (st ? ' ' + esc(st) : '') +
          ' (' +
          esc(c.type) +
          ')';
        return `<option value="${esc(c.id)}">${label}</option>`;
      })
      .join('');
  // Skip rewrite when options are unchanged — see fillStrainSelects for why.
  if (s.innerHTML === opts) return;
  const cur = s.value;
  s.innerHTML = opts;
  if (cur) s.value = cur;
}
function renderCultures() {
  const type = document.getElementById('cult-type').value,
    stat = document.getElementById('cult-stat').value,
    body = document.getElementById('cultures-body');
  const activeState = tableSort.cultures || { key: 'created', dir: 'desc' };
  updateSortIndicators('cultures', activeState);
  const filtered = cultures.filter((c) => (type === 'all' || c.type === type) && (stat === 'all' || c.status === stat));
  const rows = applyTableSort(filtered, activeState, (c, k) => {
    if (k === 'strain') return (c.strainText || '').trim() || (!c.strainId && c.strain ? c.strain : '');
    return c[k];
  });
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9" class="empty">' + t('lab.noCultures') + '</td></tr>';
    return;
  }
  // data-mlabel attrs are rendered as ::before labels in the mobile card layout
  // (styles.css "Cultures table \u2014 mobile card mode"); class hooks pin the ID
  // header, status badge row, and action row in card mode.
  body.innerHTML = rows
    .map(
      (c) =>
        `<tr><td data-mlabel="${esc(t('th.id'))}" class="cu-id" style="font-family:monospace;font-size:11px;font-weight:500">${esc(c.id)}</td><td data-mlabel="${esc(t('th.type'))}">${ctBadge(c.type)}</td><td data-mlabel="${esc(t('th.species'))}">${spDot(c.species)}${esc(c.species)}</td><td data-mlabel="${esc(t('th.strain'))}">${cultureStrainDisplay(c)}</td><td data-mlabel="${esc(t('th.parent'))}" style="font-family:monospace;font-size:10px;color:var(--c-text-muted)">${esc(c.parentId) || '\u2014'}</td><td data-mlabel="${esc(t('th.created'))}" style="font-size:10px;color:var(--c-text-muted)">${fmtDt(c.created)}</td><td data-mlabel="${esc(t('th.status'))}" class="cu-status">${csBadge(c.status)}</td><td data-mlabel="${esc(t('th.notes'))}" style="font-size:11px;color:var(--c-text-sec);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.notes) || '\u2014'}</td><td class="cu-actions" style="white-space:nowrap"><select onchange="setCultureStatus('${esc(c.id)}',this.value)" style="width:auto;font-size:11px;padding:2px 5px"><option value="active" ${c.status === 'active' ? 'selected' : ''}>${t('lab.active')}</option><option value="stored" ${c.status === 'stored' ? 'selected' : ''}>${t('lab.stored')}</option><option value="used" ${c.status === 'used' ? 'selected' : ''}>${t('lab.usedUp')}</option><option value="contam" ${c.status === 'contam' ? 'selected' : ''}>${t('lab.contaminated')}</option></select> <button class="btn btn-sm" onclick="quickPrintCulture('${esc(c.id)}')" title="${t('lab.print')}" style="padding:2px 6px">${t('lab.print')}</button> <button class="btn btn-sm btn-r" onclick="deleteCulture('${esc(c.id)}')" title="${t('lab.deleteCulture')}" style="padding:2px 6px">\u2715</button></td></tr>`
    )
    .join('');
}
function setCultureStatus(id, status) {
  const c = cultures.find((x) => x.id === id);
  if (!c) return;
  const prev = c.status;
  c.status = status;
  renderCultures();
  apiPatch('/api/cultures/' + encodeURIComponent(id), { status }).then((r) => {
    if (r && r.error) {
      c.status = prev;
      renderCultures();
      setFb('err', t('common.error') + ': ' + r.error);
    }
  });
}
function deleteCulture(id) {
  const c = cultures.find((x) => x.id === id);
  if (!c) return;
  const childCount = cultures.filter((x) => x.parentId === id).length;
  const batchCount = batches.filter((b) => b.sourceId === id).length;
  let warning = '';
  if (childCount || batchCount) {
    const parts = [];
    if (childCount) parts.push(t('lab.deleteChildren', { n: childCount }));
    if (batchCount) parts.push(t('lab.deleteBatches', { n: batchCount }));
    warning = ' \u26A0 ' + parts.join(' ') + ' ' + t('lab.deleteRefWarn');
  }
  confirm2(
    t('lab.deleteCultureTitle'),
    t('lab.deleteCultureMsg', { id: id }) + warning,
    t('lab.deleteCulture'),
    async () => {
      const r = await apiDelete('/api/cultures/' + encodeURIComponent(id));
      if (r && r.error) {
        setFb('err', t('common.error') + ': ' + r.error);
        return;
      }
      cultures = cultures.filter((x) => x.id !== id);
      renderCultures();
      renderLabLog();
      fillCultureSelect('nb-culture', ['PD', 'LC', 'G2G', 'GS']);
      fillCultureSelect('gs-culture', ['PD', 'LC']);
    }
  );
}

// ─── LAB WORK ────────────────────────────────────────────────
function lwUpdate() {
  const type = document.getElementById('lw-type').value;
  const pr = document.getElementById('lw-parent-row'),
    sr = document.getElementById('lw-source-row'),
    ql = document.getElementById('lw-qty-lbl');
  const kbRows = document.getElementById('lw-kb-rows'),
    qtyRow = document.getElementById('lw-qty-row');
  const strainTextRow = document.getElementById('lw-strain-text-row');
  const gsResult = document.getElementById('gs-result');
  const lwResult = document.getElementById('lw-result');
  // Hide result cards when switching work type
  if (type !== 'KB' && gsResult) gsResult.style.display = 'none';
  if (lwResult) lwResult.style.display = 'none';
  if (type === 'KB') {
    pr.style.display = 'none';
    sr.style.display = 'none';
    if (qtyRow) qtyRow.style.display = 'none';
    if (kbRows) kbRows.style.display = 'flex';
    if (strainTextRow) strainTextRow.style.display = 'block';
    document.getElementById('lw-prev-box').style.display = 'none';
    fillCultureSelect('gs-culture', ['PD', 'LC']);
    // Prefill grain hydration % from current inventory default
    const gsRh = document.getElementById('gs-rh');
    if (gsRh) gsRh.value = getAvgComp().grainRhPct;
    gsPreview();
  } else {
    if (kbRows) kbRows.style.display = 'none';
    if (strainTextRow) strainTextRow.style.display = type === 'G2G' ? 'none' : 'block';
    if (qtyRow) qtyRow.style.display = 'block';
    if (type === 'MC') {
      pr.style.display = 'none';
      sr.style.display = 'block';
      ql.textContent = t('lab.qtyTubes');
    } else if (type === 'PD') {
      pr.style.display = 'block';
      document.getElementById('lw-parent-lbl').textContent = t('lab.parentMcPdLc');
      fillParentSelect(['MC', 'PD', 'LC']);
      sr.style.display = 'none';
      ql.textContent = t('lab.qtyDishes');
    } else if (type === 'LC') {
      pr.style.display = 'block';
      document.getElementById('lw-parent-lbl').textContent = t('lab.sourcePdMc');
      fillParentSelect(['MC', 'PD']);
      sr.style.display = 'none';
      ql.textContent = t('lab.qtyFlasks');
    } else {
      pr.style.display = 'none';
      sr.style.display = 'none';
      ql.textContent = t('lab.qtyBags');
    }
    lwPreview();
  }
}
function fillParentSelect(types) {
  const s = document.getElementById('lw-parent');
  const cur = s.value;
  s.innerHTML =
    '<option value="">' +
    t('lab.noneNewIsolation') +
    '</option>' +
    cultures
      .filter((c) => (c.status === 'active' || c.status === 'stored') && types.includes(c.type))
      .map((c) => {
        const kz = c.strainKuerzel || c.strain || '';
        const name = c.strainName || c.species || '';
        const st = (c.strainText || '').trim();
        const label = (kz ? '[' + esc(kz) + '] ' : '') + esc(c.id) + ' — ' + esc(name) + (st ? ' ' + esc(st) : '');
        return `<option value="${esc(c.id)}">${label}</option>`;
      })
      .join('');
  if (cur) s.value = cur;
}
// Highest numeric suffix currently in use for a culture-id prefix. Generating
// the next id from this (not from the count) means deleting an earlier culture
// and creating a new one can't reuse an id — the server's
// INSERT … ON CONFLICT(id) DO UPDATE would otherwise silently overwrite the
// surviving culture's data.
function maxCultureSuffix(prefix) {
  return cultures.reduce((mx, c) => {
    if (!c.id || !c.id.startsWith(prefix)) return mx;
    const n = parseInt(c.id.slice(prefix.length), 10);
    return Number.isFinite(n) && n > mx ? n : mx;
  }, 0);
}
function lwPreview() {
  const type = document.getElementById('lw-type').value;
  const strainId = parseInt(document.getElementById('lw-st')?.value) || null;
  const ms = strainId ? mushroomStrains.find((x) => x.id === strainId) : null;
  const sp = ms ? ms.name : '';
  const qty = parseInt(document.getElementById('lw-qty').value) || 1;
  const box = document.getElementById('lw-prev-box'),
    prev = document.getElementById('lw-prev');
  if (!sp || type === 'G2G' || type === 'KB') {
    box.style.display = 'none';
    return;
  }
  const stRaw = (document.getElementById('lw-strain-text')?.value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const prefix = type + '-' + abbrev(sp) + (stRaw ? '-' + stRaw : '') + '-' + todayStr() + '-';
  const base = maxCultureSuffix(prefix);
  prev.textContent = Array.from({ length: qty }, (_, i) => prefix + String(base + i + 1).padStart(2, '0')).join('\n');
  box.style.display = 'block';
}
// lw-st change and lw-qty input listeners live in initEventListeners()
function logLabWork() {
  const type = document.getElementById('lw-type').value;
  const strainSel = document.getElementById('lw-st');
  const strainId = strainSel ? parseInt(strainSel.value) || null : null;
  const ms = strainId ? mushroomStrains.find((x) => x.id === strainId) : null;
  if (!ms) {
    alert(t('lab.selectPilzsorte'));
    return;
  }
  const sp = ms.name,
    st = ms.kuerzel;
  const parentId = document.getElementById('lw-parent')?.value || null,
    qty = parseInt(document.getElementById('lw-qty').value) || 1;
  if (type === 'G2G') {
    alert(t('lab.g2gNote'));
    return;
  }
  const lwStrainText = (document.getElementById('lw-strain-text')?.value || '').trim();
  const stId = lwStrainText.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const prefix = type + '-' + abbrev(sp) + (stId ? '-' + stId : '') + '-' + todayStr() + '-';
  const base = maxCultureSuffix(prefix);
  const newC = Array.from({ length: qty }, (_, i) => ({
    id: prefix + String(base + i + 1).padStart(2, '0'),
    type,
    species: sp,
    strain: st || '',
    strainId,
    strainName: sp,
    strainKuerzel: st || null,
    strainText: lwStrainText,
    parentId: parentId || null,
    source: document.getElementById('lw-source')?.value.trim() || null,
    status: 'active',
    notes: document.getElementById('lw-notes').value.trim(),
    created: new Date().toISOString()
  }));
  cultures.push(...newC);
  apiPost('/api/cultures', { cultures: newC }).then((r) => {
    if (r && r.cultureBarcodes) {
      for (const [id, bc] of Object.entries(r.cultureBarcodes)) {
        barcodeRegistry.set(bc, { type: 'culture', id });
        barcodeByEntity.set('culture:' + id, bc);
      }
    }
  });
  document.getElementById('lw-notes').value = '';
  document.getElementById('lw-qty').value = '1';
  if (document.getElementById('lw-source')) document.getElementById('lw-source').value = '';
  renderLabLog();
  fillCultureSelect('nb-culture', ['PD', 'LC', 'G2G', 'GS']);
  fillCultureSelect('gs-culture', ['PD', 'LC']);
  lwPreview();
  // Show result card with created IDs and print button
  lastCreatedCultureIds = newC.map((c) => c.id);
  document.getElementById('lw-ids').innerHTML = lastCreatedCultureIds
    .map(
      (id) =>
        `<span style="font-size:10px;font-family:monospace;background:var(--c-card);padding:2px 6px;border-radius:4px;color:var(--c-text-sec)">${esc(id)}</span>`
    )
    .join('');
  document.getElementById('lw-result').style.display = 'block';
}
function renderLabLog() {
  const body = document.getElementById('lab-log-body');
  const rows = [...cultures].sort((a, b) => b.created.localeCompare(a.created)).slice(0, 50);
  body.innerHTML = rows.length
    ? rows
        .map((c) => {
          const name = c.strainName || c.species || '';
          const kz = c.strainKuerzel || c.strain || '';
          return `<tr><td style="font-size:10px;color:var(--c-text-muted)">${fmtDt(c.created)}</td><td>${ctBadge(c.type)}</td><td style="font-family:monospace;font-size:11px">${esc(c.id)}</td><td style="font-family:monospace;font-size:10px;color:var(--c-text-muted)">${esc(c.parentId) || '\u2014'}</td><td>${spDot(name)}${esc(name)}${kz ? ' / ' + esc(kz) : ''}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="5" class="empty">' + t('lab.noLabWork') + '</td></tr>';
}

// ─── GRAIN SPAWN (Lab tab) ──────────────────────────────────
const genGrainBatchId = (sp, strainText) => {
  const ab = abbrev(sp),
    dt = todayStr(),
    st = (strainText || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const prefix = 'G-' + ab + (st ? '-' + st : '') + '-' + dt;
  const n = batches.filter((b) => b.batchId.startsWith(prefix + '-')).length;
  return prefix + '-' + String(n + 1).padStart(2, '0');
};
/** Read all weight-line rows from the grain spawn form */
function gsReadLines() {
  const lines = [];
  for (const row of document.querySelectorAll('.gs-wline')) {
    const kg = parseDecimal(row.querySelector('.gs-line-kg').value) || 0;
    const qty = parseInt(row.querySelector('.gs-line-qty').value) || 0;
    if (kg > 0 && qty > 0) lines.push({ kg, qty });
  }
  return lines;
}
/** Set weight for a specific weight-line row and highlight its preset button */
function gsLineSetWeight(row, kg) {
  row.querySelector('.gs-line-kg').value = kg;
  row.querySelectorAll('.gs-wbtn').forEach((btn) => {
    btn.className = 'btn btn-sm gs-wbtn' + (parseFloat(btn.dataset.kg) === kg ? ' btn-p' : '');
  });
  gsPreview();
}
/** Add a new weight line to the grain spawn form */
function gsAddLine() {
  const container = document.getElementById('gs-weight-lines');
  const first = container.querySelector('.gs-wline');
  const clone = first.cloneNode(true);
  clone.querySelector('.gs-line-kg').value = '1';
  clone.querySelector('.gs-line-qty').value = '10';
  clone.querySelectorAll('.gs-wbtn').forEach((btn) => {
    btn.className = 'btn btn-sm gs-wbtn' + (parseFloat(btn.dataset.kg) === 1 ? ' btn-p' : '');
  });
  container.appendChild(clone);
  gsUpdateRemoveButtons();
  gsPreview();
}
/** Remove a weight line */
function gsRemoveLine(row) {
  row.remove();
  gsUpdateRemoveButtons();
  gsPreview();
}
/** Show/hide remove buttons based on line count */
function gsUpdateRemoveButtons() {
  const rows = document.querySelectorAll('.gs-wline');
  const multi = rows.length > 1;
  rows.forEach((r) => {
    r.querySelector('.gs-line-rm').style.display = multi ? '' : 'none';
  });
}
/** Reset grain spawn form to single default line */
function gsResetLines() {
  const container = document.getElementById('gs-weight-lines');
  const rows = container.querySelectorAll('.gs-wline');
  for (let i = rows.length - 1; i > 0; i--) rows[i].remove();
  const first = container.querySelector('.gs-wline');
  first.querySelector('.gs-line-kg').value = '1';
  first.querySelector('.gs-line-qty').value = '10';
  first.querySelectorAll('.gs-wbtn').forEach((btn) => {
    btn.className = 'btn btn-sm gs-wbtn' + (parseFloat(btn.dataset.kg) === 1 ? ' btn-p' : '');
  });
  gsUpdateRemoveButtons();
}
function gsPreview() {
  const strainSel = document.getElementById('lw-st');
  const strainId = strainSel ? parseInt(strainSel.value) || null : null;
  const ms = strainId ? mushroomStrains.find((x) => x.id === strainId) : null;
  const sp = ms ? ms.name : '';
  const lines = gsReadLines();
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const totalWet = lines.reduce((s, l) => s + l.kg * l.qty, 0);
  const grainRhInput = document.getElementById('gs-rh');
  const defaultGrainRh = getAvgComp().grainRhPct;
  const grainRh = grainRhInput ? parseDecimal(grainRhInput.value) || 0 : defaultGrainRh;
  const hydrationFactor = mtGrainFactor(grainRh);
  const totalDry = totalWet * hydrationFactor;
  const lwStrainText = (document.getElementById('lw-strain-text')?.value || '').trim();
  document.getElementById('gs-prev').textContent = sp
    ? genGrainBatchId(sp, lwStrainText) + ' (' + totalQty + ' bags)'
    : '\u2014';
  const el = document.getElementById('gs-mat-preview');
  if (!totalQty || !totalWet) {
    el.style.display = 'none';
    return;
  }
  const breakdown = lines.map((l) => l.qty + ' \u00d7 ' + l.kg + ' kg').join(' + ');
  const avail = inventory.stock?.grain || 0;
  const enough = avail >= totalDry;
  const hydrationNote =
    grainRh > 0
      ? ` <span style="font-size:11px;color:var(--c-text-muted)">(${totalWet.toFixed(2)} kg wet − ${grainRh}% water)</span>`
      : '';
  el.innerHTML = `<strong>${t('batch.grainNeeded')}</strong> ${totalDry.toFixed(2)} kg dry${hydrationNote} (${breakdown})<br>${t('batch.inStock')} ${avail.toFixed(2)} kg \u2192 ${enough ? '\u2713 ' + t('batch.sufficient') : '\u26A0 ' + t('batch.notEnough')}`;
  el.style.display = 'block';
}
function createGrainBatch() {
  const strainSel = document.getElementById('lw-st');
  const strainId = strainSel ? parseInt(strainSel.value) || null : null;
  const ms = strainId ? mushroomStrains.find((x) => x.id === strainId) : null;
  if (!strainId || !ms) {
    if (!mushroomStrains.length) {
      confirm2(t('strains.noStrainsHint'), '', t('strains.createNow'), goCreateStrain);
    } else {
      alert(t('strains.noStrainsHint'));
    }
    return;
  }
  const sp = ms.name,
    st = ms.kuerzel;
  const lines = gsReadLines();
  if (!lines.length) {
    alert(t('batch.fillQty'));
    return;
  }
  const days = parseInt(document.getElementById('gs-days').value) || 14;
  const grainRhInput = document.getElementById('gs-rh');
  const defaultGrainRh = getAvgComp().grainRhPct;
  const grainRh = grainRhInput ? parseDecimal(grainRhInput.value) || 0 : defaultGrainRh;
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const lwStrainText = (document.getElementById('lw-strain-text') || {}).value?.trim() || '';
  const batchId = genGrainBatchId(sp, lwStrainText);
  spColor(sp);
  const due = new Date();
  due.setDate(due.getDate() + days);
  // Generate bags with per-bag weight
  const bags = [];
  const bagWeights = {};
  let idx = 1;
  for (const line of lines) {
    for (let i = 0; i < line.qty; i++) {
      const bagId = batchId + '-' + String(idx).padStart(2, '0');
      bags.push({ id: bagId, bagKg: line.kg });
      bagWeights[bagId] = line.kg;
      idx++;
    }
  }
  const bagIds = bags.map((b) => b.id);
  // Determine batch-level bagKg: single weight if uniform, null if mixed
  const uniqueWeights = new Set(lines.map((l) => l.kg));
  const batchBagKg = uniqueWeights.size === 1 ? lines[0].kg : null;
  batches.push({
    batchId,
    species: sp,
    strain: st,
    strainId,
    strainName: ms.name,
    strainKuerzel: ms.kuerzel,
    qty: totalQty,
    days,
    substrate: null,
    bagKg: batchBagKg,
    batchType: 'grain',
    grainRh,
    sourceId: inocCultureId() || document.getElementById('gs-culture').value || null,
    notes: document.getElementById('lw-notes').value.trim(),
    strainText: lwStrainText,
    created: new Date().toISOString(),
    due: due.toISOString(),
    bags: bagIds,
    bagWeights
  });
  const batchObj = batches[batches.length - 1];
  // Deduct grain from inventory — apply hydration so only dry grain is subtracted
  // (wet bag weight includes water added during soaking, typically ~52% for wheat).
  // Computed up front so the delta travels with the POST and the server applies
  // it atomically, exactly like createBatch (I-02). The previous shape fired
  // invDeltas separately and unconditionally after the POST, so a rejected batch
  // (duplicate id, server error) still drained grain for a batch that never
  // existed — and nothing rolled the local stock back either.
  if (!inventory.stock) inventory.stock = { hardwood: 0, wheatbran: 0, gypsum: 0, grain: 0, coir: 0 };
  const stockSnapshot = { ...inventory.stock };
  const hydrationFactor = mtGrainFactor(grainRh);
  const grainUsed = lines.reduce((s, l) => s + l.kg * l.qty * hydrationFactor, 0);
  const deltas = [];
  if (grainUsed > 0) {
    inventory.stock.grain = Math.max(0, (inventory.stock.grain || 0) - grainUsed);
    deltas.push({ mat: 'grain', deltaKg: -grainUsed, type: 'batch', ref: batchId });
  }
  // Send bags as [{id, bagKg}] to the server
  const apiPayload = Object.assign({}, batchObj, { bags, deltas });
  // Disable while in flight: genGrainBatchId numbers off the local batches array,
  // which already holds this batch, so a double-tap creates a second distinct
  // batch and deducts the grain twice.
  const createBtn = document.getElementById('btn-26');
  if (createBtn) createBtn.disabled = true;
  // Snapshot the inoculant list: the form is cleared below, before the POST
  // resolves, and nothing is written off until the batch is known to have saved.
  const _inocUsed = _inoc.slice();
  apiPost('/api/batches', apiPayload)
    .then((r) => {
      if (r && r.error) {
        const i = batches.findIndex((b) => b.batchId === batchObj.batchId);
        if (i >= 0) batches.splice(i, 1);
        // Roll back the optimistic stock mutation — server didn't apply the deltas.
        inventory.stock = stockSnapshot;
        alert(t('batch.saveFailed') + r.error);
        renderBatches();
        renderStatus();
        return;
      }
      if (r && r.bagBarcodes) {
        for (const [id, bc] of Object.entries(r.bagBarcodes)) {
          barcodeRegistry.set(bc, { type: 'bag', id });
          barcodeByEntity.set('bag:' + id, bc);
        }
      }
      // Grain spawn is usually made from a liquid culture that survives many
      // uses, so ask rather than assume.
      inocAskConsume(batchObj, _inocUsed);
    })
    .finally(() => {
      if (createBtn) createBtn.disabled = false;
    });
  _inoc = [];
  inocRender('nb');
  inocRender('ms-q');
  if (strainSel) strainSel.value = '';
  const lwStrainEl = document.getElementById('lw-strain-text');
  if (lwStrainEl) lwStrainEl.value = '';
  gsResetLines();
  document.getElementById('gs-days').value = '14';
  document.getElementById('lw-notes').value = '';
  document.getElementById('gs-mat-preview').style.display = 'none';
  gsPreview();
  updateTodoBadge();
  renderBatches();
  // Show zone picker — required before print
  openZonePickModal(batchObj, bagIds, function () {
    document.getElementById('gs-bags').innerHTML = bagIds
      .map(
        (b) =>
          `<span style="font-size:10px;font-family:monospace;background:var(--c-bg);padding:2px 6px;border-radius:4px;color:var(--c-text-sec)">${esc(b)}</span>`
      )
      .join('');
    document.getElementById('gs-result').style.display = 'block';
    goToPrintGrainBatch();
  });
}
function goToPrintGrainBatch() {
  go('print', 'n-print');
  setTimeout(() => {
    openStab('print', 'bags');
    document.getElementById('print-batch-search').value = '';
    fillBatchSelect('');
    const last = batches[batches.length - 1];
    if (last) {
      const s = document.getElementById('print-batch');
      s.value = last.batchId;
      renderBagPreview();
    }
  }, 100);
}

// ─── LINEAGE ─────────────────────────────────────────────────
// Lineage intentionally uses the legacy c.species / c.strain fields so that
// historical rows without a strain_id still render with their original
// species/kuerzel values. Do not swap to strainName here — old lineage nodes
// would lose their labels.
function fillLineageSelect() {
  const s = document.getElementById('lineage-sel');
  const cur = s.value;
  s.innerHTML =
    '<option value="">' +
    t('lab.selectCultureBatch') +
    '</option>' +
    (cultures.length
      ? `<optgroup label="Cultures">${cultures.map((c) => `<option value="C:${esc(c.id)}">${esc(c.id)} (${esc(c.type)} — ${esc(c.species)})</option>`).join('')}</optgroup>`
      : '') +
    (batches.length
      ? `<optgroup label="Batches">${batches.map((b) => `<option value="B:${esc(b.batchId)}">${esc(b.batchId)} (${esc(b.species)})</option>`).join('')}</optgroup>`
      : '');
  if (cur) s.value = cur;
}
function buildTree(rootId, rootType) {
  const seen = new Set();
  const getAnc = (id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const c = cultures.find((x) => x.id === id);
    if (!c) return [];
    const node = { id: c.id, type: c.type, species: c.species, strain: c.strain, status: c.status, created: c.created };
    if (c.parentId) {
      const p = cultures.find((x) => x.id === c.parentId);
      if (p) return [...getAnc(c.parentId), node];
    }
    return [node];
  };
  const getDesc = (id, depth) => {
    if (depth > 6) return [];
    const ch = [];
    cultures
      .filter((c) => c.parentId === id)
      .forEach((c) => ch.push({ ...c, harvest: 0, children: getDesc(c.id, depth + 1) }));
    batches
      .filter((b) => b.sourceId === id)
      .forEach((b) => {
        const { status } = getStatus(b.batchId);
        ch.push({
          id: b.batchId,
          type: 'BATCH',
          species: b.species,
          strain: b.strain,
          status,
          harvest: getHarvested(b.batchId),
          created: b.created,
          children: []
        });
      });
    return ch;
  };
  if (rootType === 'C') {
    const anc = getAnc(rootId);
    const c = cultures.find((x) => x.id === rootId);
    if (!c) return null;
    const root = {
      ...(anc[anc.length - 1] || {
        id: c.id,
        type: c.type,
        species: c.species,
        strain: c.strain,
        status: c.status,
        created: c.created
      })
    };
    root.children = getDesc(rootId, 0);
    if (anc.length > 1) {
      let tree = anc[0],
        cur = tree;
      for (let i = 1; i < anc.length; i++) {
        anc[i].children = i === anc.length - 1 ? root.children : [];
        cur.children = [anc[i]];
        cur = anc[i];
      }
      return tree;
    }
    return root;
  } else {
    const b = batches.find((x) => x.batchId === rootId);
    if (!b) return null;
    const { status } = getStatus(b.batchId);
    const bn = {
      id: b.batchId,
      type: 'BATCH',
      species: b.species,
      strain: b.strain,
      status,
      harvest: getHarvested(b.batchId),
      created: b.created,
      children: []
    };
    if (b.sourceId) {
      const anc = getAnc(b.sourceId);
      if (anc.length) {
        let tree = anc[0],
          cur = tree;
        for (let i = 1; i < anc.length; i++) {
          anc[i].children = [];
          cur.children = [anc[i]];
          cur = anc[i];
        }
        cur.children = [bn];
        return tree;
      }
    }
    return bn;
  }
}
const NODE_BG = { MC: '#f3e8ff', PD: '#dbeafe', LC: '#dcfce7', BATCH: '#fff7ed' };
const NODE_BD = { MC: '#c084fc', PD: '#93c5fd', LC: '#86efac', BATCH: '#fdba74' };
function treeHtml(node, depth) {
  const ch = node.children?.length
    ? `<div style="margin-left:${depth ? 20 : 0}px;padding-left:16px;border-left:2px solid var(--c-border);margin-top:5px">${node.children.map((c) => treeHtml(c, depth + 1)).join('')}</div>`
    : '';
  const harv = node.harvest > 0 ? `<span class="badge b-harvest" style="margin-left:4px">${node.harvest}g</span>` : '';
  return `<div style="margin-bottom:5px"><div style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;background:${NODE_BG[node.type] || '#f5f4f0'};border:1px solid ${NODE_BD[node.type] || '#e5e3dd'};border-radius:7px;padding:5px 10px"><span style="font-size:10px;font-weight:600;color:var(--c-text-sec)">${esc(node.type)}</span><span style="font-family:monospace;font-size:12px;font-weight:600">${esc(node.id)}</span><span style="font-size:11px;color:var(--c-text-sec)">${esc(node.species) || ''}${node.strain ? ' / ' + esc(node.strain) : ''}</span><span style="font-size:10px;color:var(--c-text-muted)">${esc(node.status) || ''}</span>${harv}<span style="font-size:10px;color:var(--c-text-muted)">${node.created ? fmtDt(node.created) : ''}</span></div>${ch}</div>`;
}
function renderLineage() {
  const val = document.getElementById('lineage-sel').value,
    body = document.getElementById('lineage-body');
  if (!val) {
    body.innerHTML = '<div class="empty">' + t('lab.selectAbove') + '</div>';
    return;
  }
  const [type, id] = val.split(':');
  const tree = buildTree(id, type);
  body.innerHTML = tree
    ? `<div style="padding:4px 0">${treeHtml(tree, 0)}</div>`
    : '<div class="empty">' + t('lab.noLineageData') + '</div>';
}

// ─── BAG INFO MODAL ──────────────────────────────────────────
let biBagId = null,
  biBatchId = null;
function openBagInfo(bagId, batchId, batch) {
  biBagId = bagId;
  biBatchId = batchId;
  const b = batch || batches.find((x) => x.batchId.toUpperCase() === batchId.toUpperCase());
  const el = document.getElementById('bi-body');
  if (!b) {
    el.innerHTML = '<p style="color:var(--c-red-dark)">' + t('batch.notFound') + ': ' + esc(batchId) + '</p>';
    document.getElementById('bi-actions').innerHTML = '';
    document.getElementById('m-baginfo').classList.add('open');
    return;
  }
  document.getElementById('bi-title').textContent = bagId;
  // Current location
  const bagLogs = scanLog.filter((e) => (e.bag || '').toUpperCase() === bagId.toUpperCase());
  let currentLoc = t('bagInfo.notPlaced');
  if (bagLogs.length) {
    const last = bagLogs[bagLogs.length - 1];
    if (last.action === 'REMOVE') currentLoc = t('bagInfo.removed');
    else if (last.action === 'ADD' || last.action === 'MOVE') currentLoc = last.to || 'Unknown';
  }
  // Harvests for this bag
  const bagHarvests = harvests.filter((h) => (h.bag || '').toUpperCase() === bagId.toUpperCase());
  const totalHarv = bagHarvests.reduce((s, h) => s + (h.grams || 0), 0);
  // Pre-build last-scan-per-bag map so the bag-chip render below is O(1)/bag
  // instead of O(M)/bag for an M-length scan log.
  const lastByBag = buildLastScanByBag();
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="met"><div class="met-l">${t('batch.species')}</div><div style="font-size:15px;font-weight:600">${spDot(b.species)}${esc(b.species)}</div></div>
      <div class="met"><div class="met-l">${t('batch.strain')}</div><div style="font-size:15px;font-weight:600">${(b.strainText || '').trim() ? esc(b.strainText.trim()) : !b.strainId && b.strain ? esc(b.strain) : '\u2014'}</div></div>
      <div class="met"><div class="met-l">${t('bagInfo.currentLocation')}</div><div style="font-size:15px;font-weight:600;color:var(--c-blue-dark)">${esc(currentLoc)}</div></div>
      <div class="met"><div class="met-l">${t('dash.totalHarvested')}</div><div style="font-size:15px;font-weight:600;color:var(--c-amber-dark)">${totalHarv > 0 ? totalHarv + 'g' : t('bagInfo.noneYet')}</div></div>
    </div>
    <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${t('batch.batchId')} ${esc(b.batchId)} \u2014 ${t('bagInfo.allBags')}</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;max-height:120px;overflow-y:auto">
      ${b.bags
        .map((bag) => {
          const isThis = bag.toUpperCase() === bagId.toUpperCase();
          const bagNum = bag.split('-').pop();
          const bagLast = lastByBag.get(bag.toUpperCase());
          const loc = !bagLast ? '—' : bagLast.action === 'REMOVE' ? '✗' : bagLast.to || '?';
          return `<span style="font-size:11px;font-family:monospace;padding:3px 8px;border-radius:5px;background:${isThis ? 'var(--c-text)' : 'var(--c-bg)'};color:${isThis ? '#fff' : 'var(--c-text-sec)'};border:1px solid ${isThis ? 'var(--c-text)' : 'var(--c-border)'}" title="${esc(loc)}">
          ${esc(bagNum)} <span style="font-size:9px;color:${isThis ? 'var(--c-text-muted)' : 'var(--c-border)'}">${esc(loc)}</span>
        </span>`;
        })
        .join('')}
    </div>
    ${bagHarvests.length ? `<div style="margin-top:10px;font-size:12px;color:var(--c-amber-dark)"><strong>${t('harvest.log')}:</strong> ${bagHarvests.map((h) => `Flush ${h.flush}: ${h.grams}g`).join(' \u00b7 ')}</div>` : ''}
  `;
  closeCamScan();
  closeScanModal();
  biWholeBatch = false;
  renderBiActions();
  document.getElementById('m-baginfo').classList.add('open');
  setFb('info', t('scanFb.bagInfo', { bag: bagId }), { noModal: true });
}
// Scope of a sheet move action: false = just the scanned bag, true = whole batch.
let biWholeBatch = false;
// Where is the scanned bag right now, and is it still placed?
function _biBagCurrentLoc() {
  const logs = scanLog.filter((e) => (e.bag || '').toUpperCase() === (biBagId || '').toUpperCase());
  if (!logs.length) return { loc: null, removed: false };
  const last = logs[logs.length - 1];
  if (last.action === 'REMOVE') return { loc: null, removed: true };
  if (last.action === 'ADD' || last.action === 'MOVE') return { loc: last.to || null, removed: false };
  return { loc: null, removed: false };
}
// The heart of the idiot-proof flow: render big, context-aware action buttons
// for the scanned bag. The primary action follows where the bag is now — in
// incubation/spawn it's "→ Fruchtung", in a fruiting tent it's "Ernten" — so
// the worker never picks a mode. Everything else (move elsewhere, contam,
// discard) is one tap below. The move actions honour the single/whole-batch
// toggle.
function renderBiActions() {
  const el = document.getElementById('bi-actions');
  if (!el) return;
  const b = batches.find((x) => x.batchId && x.batchId.toUpperCase() === (biBatchId || '').toUpperCase());
  if (!b) {
    el.innerHTML = '';
    return;
  }
  const cur = _biBagCurrentLoc();
  const role = cur.loc && ZONE_BY_ID[toZone(cur.loc)] ? ZONE_BY_ID[toZone(cur.loc)].role : null;
  const nBags = (b.bags || []).length;
  const hasFruiting = !!_fruitingDest();
  const big =
    'width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:15px;border-radius:12px;border:0;font-size:17px;font-weight:600;margin-bottom:8px;cursor:pointer';
  let html = '';
  if (nBags > 1) {
    const seg = 'flex:1;text-align:center;padding:10px;font-size:13px;cursor:pointer;border:0';
    html +=
      '<div style="display:flex;border:1px solid var(--c-border);border-radius:10px;overflow:hidden;margin-bottom:10px">' +
      `<button type="button" data-bi="scope-single" style="${seg};${!biWholeBatch ? 'background:var(--c-text);color:#fff' : 'background:transparent;color:var(--c-text-sec)'}">${esc(t('bagInfo.scopeSingle'))}</button>` +
      `<button type="button" data-bi="scope-batch" style="${seg};border-left:1px solid var(--c-border);${biWholeBatch ? 'background:var(--c-text);color:#fff' : 'background:transparent;color:var(--c-text-sec)'}">${esc(t('bagInfo.scopeBatch', { n: nBags }))}</button>` +
      '</div>';
  }
  if (!cur.removed && (role === 'incubation' || role === 'spawn') && hasFruiting) {
    html += `<button type="button" data-bi="fruchtung" style="${big};background:var(--c-primary);color:#fff">→ ${esc(t('dash.toFruiting'))}</button>`;
  } else if (!cur.removed && role === 'fruiting') {
    html += `<button type="button" data-bi="harvest" style="${big};background:var(--c-amber-dark);color:#fff">✂ ${esc(t('bagInfo.harvest'))}</button>`;
  }
  const sec =
    'flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:13px;border-radius:10px;font-size:15px;cursor:pointer;background:var(--c-surface);border:1px solid var(--c-border)';
  html +=
    '<div style="display:flex;gap:8px;margin-bottom:8px">' +
    `<button type="button" data-bi="move" style="${sec};color:var(--c-text);font-weight:600">${esc(t('bagInfo.moveElsewhere'))}</button>` +
    `<button type="button" data-bi="remove" style="${sec};color:var(--c-text-sec)">${esc(t('bagInfo.discard'))}</button>` +
    '</div>';
  html += `<button type="button" data-bi="contam" style="${big};font-size:15px;padding:13px;background:var(--c-red-light);color:var(--c-red-dark);border:1px solid var(--c-red-border)">⚠ ${esc(t('bagInfo.reportContam'))}</button>`;
  el.innerHTML = html;
}
// Move the scanned bag (or whole batch, per the toggle) to dest, then drop the
// worker straight back into the camera for the next bag. moveBagsTo/moveBatchTo
// call back synchronously, so re-opening the camera stays inside the tap
// gesture (iOS requires that to start the camera).
function biMoveTo(dest) {
  const b = batches.find((x) => x.batchId && x.batchId.toUpperCase() === (biBatchId || '').toUpperCase());
  if (!b || !dest) return;
  document.getElementById('m-baginfo').classList.remove('open');
  // Re-open the camera BEFORE the move so its confirmation shows as a brief,
  // auto-dismissing toast over the live camera (setFb routes to the camera HUD
  // when the scanner is active). If we moved first, setFb would instead pop the
  // scan-log overlay, which the worker then has to close before scanning again.
  biRearmScanner();
  // Snapshot before the move so a mistap here is as reversible as one on the
  // dashboard. The undo bar sits at z-index 900, above the camera modal, so it
  // stays reachable while scanning continues.
  const snapBags = biWholeBatch ? [b] : [{ ...b, bags: [biBagId] }];
  const snap = _snapshotBeforeMove(snapBags, dest, buildLastScanByBag());
  const cb = function (moved, skipped) {
    if (!moved) {
      setFb(
        'ok',
        skipped ? t('batch.allAlreadyAt', { n: skipped, loc: zoneDisplayName(dest) }) : t('batch.noBagsToMove')
      );
    } else {
      setFb('ok', b.batchId + ': ' + moved + ' Bags → ' + zoneDisplayName(dest));
      if (snap.length) showUndoBar(b.batchId + ': ' + moved + ' → ' + zoneDisplayName(dest), () => _undoMove(snap));
    }
    updateSD();
    renderBatches();
    renderStatus();
  };
  if (biWholeBatch) moveBatchTo(b, dest, cb);
  else moveBagsTo(b, [biBagId], dest, cb);
}
// Return to a clean scan state and re-open the camera, so scanning the next bag
// opens its sheet again (no action armed).
function biRearmScanner() {
  scan.action = null;
  scan.to = null;
  scan.from = null;
  scan.harvestBag = null;
  updateSD();
  openCamScan();
}
function biOpenHarvest() {
  if (!biBagId || !biBatchId) return;
  document.getElementById('m-baginfo').classList.remove('open');
  scan.action = 'HARVEST';
  scan.from = null;
  scan.to = null;
  scan.harvestBag = null;
  updateSD();
  showHarvestPanel(biBagId, biBatchId);
}

// Log a REMOVE entry after the confirmation dialog was accepted.
function biPerformRemove() {
  if (!biBagId) return;
  document.getElementById('m-baginfo').classList.remove('open');
  const bagLast = [...scanLog]
    .reverse()
    .find((e) => (e.bag || '').toUpperCase() === biBagId.toUpperCase() && (e.action === 'ADD' || e.action === 'MOVE'));
  const fromLoc = bagLast ? bagLast.to : null;
  const b = batches.find((x) => x.batchId.toUpperCase() === (biBatchId || '').toUpperCase());
  const tempId = 's' + ++_scanTempIdCounter;
  const entry = {
    time: new Date().toISOString(),
    action: 'REMOVE',
    batch: biBatchId,
    bag: biBagId,
    from: fromLoc,
    to: null,
    species: b?.species || null,
    strain: b?.strain || null,
    user: currentUser?.username || null,
    client_uuid: newScanUuid(),
    _tempId: tempId
  };
  scanLog.push(entry);
  movements.push(entry);
  if (!sessionStartTime) sessionStartTime = Date.now();
  sessionEntries.push(entry);
  scan.count++;
  apiPost('/api/scan-log', { entries: [entry] }).then(function (r) {
    if (r && r.ids && r.ids[0]) setEntryServerId(entry, r.ids[0]);
  });
  updateSD();
  const msg = fromLoc
    ? t('scanFb.removeFromLogged', { bag: biBagId, loc: zoneDisplayName(fromLoc) })
    : t('scanFb.removeLogged', { bag: biBagId });
  setFb('ok', msg, entry);
}

function biConfirmRemove() {
  if (!biBagId) return;
  const bagLast = [...scanLog]
    .reverse()
    .find((e) => (e.bag || '').toUpperCase() === biBagId.toUpperCase() && (e.action === 'ADD' || e.action === 'MOVE'));
  const fromLoc = bagLast ? bagLast.to : null;
  const body = fromLoc
    ? t('bagInfo.confirmRemoveBody', { bag: biBagId, loc: zoneDisplayName(fromLoc) })
    : t('bagInfo.confirmRemoveBodyNoLoc', { bag: biBagId });
  confirm2(t('bagInfo.confirmRemoveTitle'), body, t('bagInfo.confirmRemoveOk'), biPerformRemove);
}
document.getElementById('m-baginfo').addEventListener('click', (e) => {
  if (e.target.id === 'm-baginfo') document.getElementById('m-baginfo').classList.remove('open');
});

// ─── CONTAMINATION REPORT MODAL ──────────────────────────────
// MVP from audit Section 2 / PR 7. Captures bag/batch + type + severity +
// notes + up to 4 photos (compressed client-side to ~200 KB JPEG / ~15 KB
// thumb), POSTs to /api/contamination-reports.
let _crBagId = null;
let _crBatchId = null;
let _crZoneId = null;
let _crTypes = null; // lazily loaded from /api/contamination-types
let _crSelectedTypeId = null;
// Last type reported this session — pre-selected on the next report so a whole
// shelf of the same contamination (e.g. a Trichoderma row) is just tap-Senden
// per bag. Session-scoped (resets on reload) to avoid carrying a stale type
// across days. Pairs with the scanner's "stay in CONTAM mode" chaining.
let _crLastTypeId = null;
let _crSeverity = 'minor';
let _crPhotos = []; // [{ data_url, thumb_data_url, width, height }]
const CR_MAX_PHOTOS = 4;

function biReportContam() {
  if (!biBagId) return;
  document.getElementById('m-baginfo').classList.remove('open');
  openContamReport(biBagId, biBatchId, null);
}

function openContamReport(bagId, batchId, zoneId) {
  _crBagId = bagId || null;
  _crBatchId = batchId || null;
  _crZoneId = zoneId || null;
  _crSelectedTypeId = _crLastTypeId;
  _crSeverity = 'minor';
  _crPhotos = [];
  // Reset form
  document.getElementById('cr-notes').value = '';
  document.getElementById('cr-photo-status').textContent = '';
  document.getElementById('cr-target').textContent = bagId
    ? t('contam.targetBag', { bag: bagId, batch: batchId || '—' })
    : t('contam.targetBatch', { batch: batchId || '—' });
  // Reset severity buttons to 'minor' active
  document.querySelectorAll('#cr-severity-row .contam-sev-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.sev === 'minor');
  });
  // Auto-MOVE default tracks severity: off for minor, on for major/lost.
  // Worker can still toggle it manually before submit.
  const autoMoveEl = document.getElementById('cr-auto-move');
  if (autoMoveEl) autoMoveEl.checked = false;
  _renderCrPhotos();
  // Lazy-load types on first open; refresh on later opens to pick up admin edits
  apiGet('/api/contamination-types')
    .then((types) => {
      _crTypes = Array.isArray(types) ? types : [];
      // Drop a remembered pre-selection if that type was since deleted/renamed.
      if (_crSelectedTypeId != null && !_crTypes.some((tp) => tp.id === _crSelectedTypeId)) _crSelectedTypeId = null;
      _renderCrTypeGrid();
    })
    .catch(() => {
      _crTypes = [];
      _renderCrTypeGrid();
    });
  document.getElementById('m-contam-report').classList.add('open');
}

function closeContamReport() {
  document.getElementById('m-contam-report').classList.remove('open');
  _crPhotos = [];
}

function _crLocalizedName(t) {
  if (currentLang === 'de') return t.name_de;
  if (currentLang === 'pt') return t.name_pt;
  return t.name_en;
}

function _renderCrTypeGrid() {
  const grid = document.getElementById('cr-type-grid');
  if (!_crTypes || !_crTypes.length) {
    grid.innerHTML =
      '<div style="font-size:12px;color:var(--c-text-muted);grid-column:1/-1">' + t('contam.noTypes') + '</div>';
    return;
  }
  grid.innerHTML = _crTypes
    .map((tp) => {
      const isActive = _crSelectedTypeId === tp.id;
      return `<button type="button" class="contam-type-btn${isActive ? ' active' : ''}" data-type-id="${tp.id}" style="color:${esc(tp.color)}">
        <span class="contam-type-dot" style="background:${esc(tp.color)}"></span>
        <span style="color:var(--c-text)">${esc(_crLocalizedName(tp))}</span>
      </button>`;
    })
    .join('');
}

async function _crCompressFile(file) {
  // Decode → resize to 1280px long edge / quality 0.8 → also a 200px thumb.
  // Canvas re-encode strips EXIF (incl. GPS) automatically — privacy win.
  const img = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => {
      URL.revokeObjectURL(url);
      resolve(i);
    };
    i.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    i.src = url;
  });
  function draw(maxEdge, quality) {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      c.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('encode failed'));
            return;
          }
          const fr = new FileReader();
          fr.onload = () => resolve({ data_url: fr.result, width: w, height: h });
          fr.onerror = () => reject(new Error('read failed'));
          fr.readAsDataURL(blob);
        },
        'image/jpeg',
        quality
      );
    });
  }
  const main = await draw(1280, 0.8);
  const thumb = await draw(200, 0.7);
  return {
    data_url: main.data_url,
    width: main.width,
    height: main.height,
    thumb_data_url: thumb.data_url
  };
}

async function _crAddFiles(fileList) {
  const status = document.getElementById('cr-photo-status');
  const files = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith('image/'));
  if (!files.length) return;
  for (const file of files) {
    if (_crPhotos.length >= CR_MAX_PHOTOS) {
      status.textContent = t('contam.photoLimit', { n: CR_MAX_PHOTOS });
      break;
    }
    status.textContent = t('contam.compressing', { name: file.name });
    try {
      const photo = await _crCompressFile(file);
      _crPhotos.push(photo);
      _renderCrPhotos();
    } catch (e) {
      console.error('photo compress failed', e);
      status.textContent = t('contam.compressErr');
      return;
    }
  }
  status.textContent = '';
}

function _renderCrPhotos() {
  const tiles = document.getElementById('cr-photo-tiles');
  const tilesHtml = _crPhotos
    .map(
      (p, i) =>
        `<div class="contam-photo-tile" data-cr-edit="${i}" title="${esc(t('contam.annotateHint'))}"><img src="${esc(p.thumb_data_url)}" alt=""><span class="annot-hint" aria-hidden="true">✏︎</span><button type="button" class="remove" data-cr-remove="${i}" aria-label="Remove">&times;</button></div>`
    )
    .join('');
  const addTile =
    _crPhotos.length < CR_MAX_PHOTOS
      ? `<button type="button" id="cr-add-photo" class="contam-photo-tile add" aria-label="${esc(t('contam.addPhoto'))}">+</button>`
      : '';
  tiles.innerHTML = tilesHtml + addTile;
}

function _crSelectType(typeId) {
  _crSelectedTypeId = typeId;
  _renderCrTypeGrid();
}

// ─── PHOTO ANNOTATION ─────────────────────────────────────────
// Tap a photo tile in the contamination capture modal to open a drawing
// surface over it. Workers circle / mark the contamination spot with a
// finger, hit Done, and the strokes get baked into the JPEG before submit.
// "Trichoderma along the lid seam" is much easier to communicate visually
// than in notes.
let _paIdx = -1;
let _paImg = null; // HTMLImageElement of the photo's full-res copy
let _paDrawing = false;
let _paStrokeWidth = 0;
function openAnnotate(idx) {
  if (idx < 0 || idx >= _crPhotos.length) return;
  _paIdx = idx;
  const photo = _crPhotos[idx];
  const canvas = document.getElementById('pa-canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  _paImg = img;
  img.onload = function () {
    // Fit canvas to image's natural pixels so strokes composite at the
    // same scale on submit (no resampling distortion).
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    // Stroke width scaled to image size — ~1% of the long edge feels
    // right on phone. Applied via lineWidth at draw time.
    _paStrokeWidth = Math.max(4, Math.round(Math.max(img.naturalWidth, img.naturalHeight) / 100));
    document.getElementById('m-photo-annotate').classList.add('open');
  };
  img.onerror = function () {
    setFb('err', t('contam.annotateLoadErr'));
  };
  img.src = photo.data_url;
}
function closeAnnotate() {
  document.getElementById('m-photo-annotate').classList.remove('open');
  _paIdx = -1;
  _paImg = null;
  _paDrawing = false;
}
function _paClear() {
  if (!_paImg) return;
  const canvas = document.getElementById('pa-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(_paImg, 0, 0);
}
function _paPos(e) {
  const canvas = document.getElementById('pa-canvas');
  const r = canvas.getBoundingClientRect();
  // Translate page coords -> canvas coords (canvas is rendered at scaled
  // CSS size but its drawing space matches naturalWidth/Height).
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
}
function _paStart(e) {
  if (_paIdx < 0) return;
  e.preventDefault();
  const canvas = document.getElementById('pa-canvas');
  if (canvas.setPointerCapture && e.pointerId !== undefined) {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (er) {
      /* ignore — some pointer types reject capture */
    }
  }
  const ctx = canvas.getContext('2d');
  const p = _paPos(e);
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = _paStrokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  _paDrawing = true;
}
function _paMove(e) {
  if (!_paDrawing) return;
  e.preventDefault();
  const ctx = document.getElementById('pa-canvas').getContext('2d');
  const p = _paPos(e);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
}
function _paEnd(e) {
  if (!_paDrawing) return;
  _paDrawing = false;
  e.preventDefault();
}
async function _paDone() {
  if (_paIdx < 0 || !_paImg) {
    closeAnnotate();
    return;
  }
  const canvas = document.getElementById('pa-canvas');
  // Re-encode the annotated full image at the same compression as the
  // original (1280 px long edge, q=0.8) so the photo size budget stays
  // honest and the server-side magic-byte check still sees JPEG.
  const longEdge = Math.max(canvas.width, canvas.height);
  const scale = Math.min(1, 1280 / longEdge);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(canvas, 0, 0, w, h);
  const dataUrl = await new Promise((resolve) => {
    out.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(blob);
      },
      'image/jpeg',
      0.8
    );
  });
  if (!dataUrl) {
    setFb('err', t('contam.annotateSaveErr'));
    closeAnnotate();
    return;
  }
  // New thumbnail (200 px) from the same annotated canvas.
  const tScale = Math.min(1, 200 / longEdge);
  const tw = Math.max(1, Math.round(canvas.width * tScale));
  const th = Math.max(1, Math.round(canvas.height * tScale));
  const thumb = document.createElement('canvas');
  thumb.width = tw;
  thumb.height = th;
  thumb.getContext('2d').drawImage(canvas, 0, 0, tw, th);
  const thumbUrl = await new Promise((resolve) => {
    thumb.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(blob);
      },
      'image/jpeg',
      0.7
    );
  });
  // Save back to the photo entry. Width/height update to the resized
  // canvas dims so they stay consistent with what the server sees.
  _crPhotos[_paIdx] = {
    data_url: dataUrl,
    thumb_data_url: thumbUrl || _crPhotos[_paIdx].thumb_data_url,
    width: w,
    height: h
  };
  closeAnnotate();
  _renderCrPhotos();
}

async function _crSubmit() {
  if (!_crSelectedTypeId) {
    setFb('err', t('contam.errNoType'));
    return;
  }
  const submitBtn = document.getElementById('cr-submit');
  submitBtn.disabled = true;
  try {
    const body = {
      bag_id: _crBagId,
      batch_id: _crBatchId,
      zone_id: _crZoneId,
      type_id: _crSelectedTypeId,
      severity: _crSeverity,
      notes: document.getElementById('cr-notes').value.trim(),
      photos: _crPhotos,
      auto_move: !!document.getElementById('cr-auto-move')?.checked,
      report_uuid: newScanUuid()
    };
    const r = await apiPost('/api/contamination-reports', body);
    if (r && r.error) {
      setFb('err', t('contam.errSave', { err: r.error }));
      return;
    }
    _crLastTypeId = _crSelectedTypeId; // pre-select this type on the next report
    closeContamReport();
    if (r && r.queued) {
      // Service worker queued the report because the network was unreachable.
      // The browse list won't have this entry yet — replayed when WiFi returns.
      setFb('warn', t('contam.reportQueued'));
    } else {
      // If the server actually moved the bag to CONTAM, surface that in the
      // toast so the worker isn't surprised by the new scan-log entry.
      const msgKey = r.autoMovedScanId ? 'contam.reportSavedAutoMoved' : 'contam.reportSaved';
      setFb('ok', t(msgKey, { id: r.id, photos: (r.photoIds || []).length }));
      // Refresh browse view if it's the active sub-tab
      if (document.getElementById('sp-lab-contam')?.classList.contains('active')) {
        renderContamReports();
      }
    }
  } catch (e) {
    setFb('err', t('contam.errSave', { err: e.message || 'unknown' }));
  } finally {
    submitBtn.disabled = false;
  }
}

// ─── CONTAMINATION REPORTS — BROWSE / DRILL-DOWN ──────────────
// Lab → Kontaminationen sub-tab. Lists reports as cards, click opens
// the drill-down modal with full-size photos and delete action.
let _clReports = [];
let _cdReportId = null;

function _clTypeName(r) {
  if (currentLang === 'de') return r.name_de;
  if (currentLang === 'pt') return r.name_pt;
  return r.name_en;
}

function _clRelTime(iso) {
  const d = new Date(iso);
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return t('time.justNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('time.minsAgo', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('time.hoursAgo', { n: hr });
  return t('time.daysAgo', { n: Math.floor(hr / 24) });
}

async function _clEnsureTypesLoaded() {
  if (_crTypes && _crTypes.length) return;
  try {
    _crTypes = await apiGet('/api/contamination-types');
  } catch {
    _crTypes = [];
  }
  // Populate the type filter dropdown if it exists
  const sel = document.getElementById('cl-type-filter');
  if (sel && sel.options.length <= 1) {
    for (const tp of _crTypes) {
      const o = document.createElement('option');
      o.value = String(tp.id);
      o.textContent = _clTypeName(tp);
      sel.appendChild(o);
    }
  }
}

async function renderContamReports() {
  await _clEnsureTypesLoaded();
  const list = document.getElementById('contam-list');
  const count = document.getElementById('contam-list-count');
  if (!list) return;
  list.innerHTML = '<div class="empty">' + t('contam.loading') + '</div>';
  const params = new URLSearchParams();
  const typeId = document.getElementById('cl-type-filter')?.value;
  const sev = document.getElementById('cl-sev-filter')?.value;
  const status = document.getElementById('cl-status-filter')?.value;
  const since = document.getElementById('cl-since-filter')?.value;
  if (typeId) params.set('typeId', typeId);
  if (sev) params.set('severity', sev);
  if (status) params.set('status', status);
  if (since) params.set('start', since);
  try {
    _clReports = await apiGet('/api/contamination-reports' + (params.toString() ? '?' + params.toString() : ''));
  } catch (e) {
    list.innerHTML =
      '<div class="empty" style="color:var(--c-red-dark)">' +
      t('contam.errLoad', { err: e.message || 'unknown' }) +
      '</div>';
    return;
  }
  if (!_clReports.length) {
    list.innerHTML = '<div class="empty">' + t('contam.empty') + '</div>';
    count.textContent = '';
    return;
  }
  count.textContent = t('contam.count', { n: _clReports.length });
  list.innerHTML = _clReports
    .map((r) => {
      const sevKey = r.severity === 'major' ? 'sevMajor' : r.severity === 'lost' ? 'sevLost' : 'sevMinor';
      const typeName = esc(_clTypeName(r));
      // first_photo_uuid is included in the list response so we can render a
      // real thumb without a second round-trip. Fall back to a placeholder
      // glyph when the report has no photos at all (rare — usually 1+).
      const thumbHtml = r.first_photo_uuid
        ? `<img src="/api/contamination-reports/${r.id}/photos/${esc(r.first_photo_uuid)}?thumb=1" alt="" loading="lazy">`
        : `<div style="font-size:18px">—</div>`;
      const target = r.bag_id
        ? `<span class="contam-list-bag">${esc(r.bag_id)}</span><span class="contam-list-batch">${esc(r.batch_id || '')}</span>`
        : `<span class="contam-list-bag">${esc(r.batch_id || '—')}</span>`;
      const notes = r.notes ? `<div class="contam-list-notes">${esc(r.notes)}</div>` : '';
      const resolvedClass = r.resolved_at ? ' is-resolved' : '';
      const resolvedBadge = r.resolved_at
        ? `<span class="contam-resolved-badge">✓ ${esc(t('contam.res.' + r.resolution) || '')}</span>`
        : '';
      return `<div class="contam-list-card${resolvedClass}" data-cl-id="${r.id}">
        <div class="contam-list-thumb">${thumbHtml}</div>
        <div class="contam-list-meta">
          <div class="contam-list-row">${target}<span class="contam-list-when">${esc(_clRelTime(r.reported_at))}</span></div>
          <div class="contam-list-row">
            <span class="contam-type-badge"><span class="dot" style="background:${esc(r.type_color || '#888')}"></span>${typeName}</span>
            <span class="contam-sev-badge sev-${esc(r.severity)}">${esc(t('contam.' + sevKey))}</span>
            ${resolvedBadge}
            ${(r.photo_count || 0) > 0 ? `<span style="font-size:11px;color:var(--c-text-muted)">${r.photo_count} 📷</span>` : ''}
          </div>
          ${notes}
        </div>
      </div>`;
    })
    .join('');
}

async function openContamDetail(id) {
  _cdReportId = id;
  const body = document.getElementById('cd-body');
  body.innerHTML = '<div class="empty">' + t('contam.loading') + '</div>';
  document.getElementById('m-contam-detail').classList.add('open');
  let r;
  try {
    r = await apiGet('/api/contamination-reports/' + id);
  } catch (e) {
    body.innerHTML =
      '<div class="empty" style="color:var(--c-red-dark)">' +
      t('contam.errLoad', { err: e.message || 'unknown' }) +
      '</div>';
    return;
  }
  const typeName = esc(_clTypeName(r));
  const sevKey = r.severity === 'major' ? 'sevMajor' : r.severity === 'lost' ? 'sevLost' : 'sevMinor';
  const photos = Array.isArray(r.photos) ? r.photos : [];
  const photosHtml = photos.length
    ? `<div class="cd-photos">${photos
        .map(
          (p) =>
            `<a class="cd-photo" href="/api/contamination-reports/${r.id}/photos/${esc(p.uuid)}" target="_blank" rel="noopener"><img src="/api/contamination-reports/${r.id}/photos/${esc(p.uuid)}?thumb=1" alt="" loading="lazy"></a>`
        )
        .join('')}</div>`
    : `<div class="empty" style="margin:8px 0 14px">${t('contam.noPhotos')}</div>`;
  const notesHtml = r.notes ? `<div class="cd-notes">${esc(r.notes)}</div>` : '';
  // Resolution status — when set, show the resolution + when in the metadata
  // grid and offer a Reopen action. When unset, render four resolve-action
  // buttons (Autoclaved / Discarded / Recovered / Other) below the metadata.
  const isResolved = !!r.resolved_at;
  const resolutionLabel = r.resolution ? esc(t('contam.res.' + r.resolution)) : '';
  const statusCell = isResolved
    ? `<div><div class="label">${esc(t('contam.statusLabel'))}</div><div><span class="contam-resolved-badge">✓ ${resolutionLabel}</span><div style="font-size:11px;color:var(--c-text-muted);margin-top:2px">${esc(fmtDtTime(r.resolved_at))}</div></div></div>`
    : `<div><div class="label">${esc(t('contam.statusLabel'))}</div><div><span class="contam-open-badge">${esc(t('contam.statusOpen'))}</span></div></div>`;
  const resolveActions = isResolved
    ? `<div class="cd-resolve-row"><button id="cd-reopen" type="button" class="btn btn-sm" data-i18n="contam.reopen">Wieder öffnen</button></div>`
    : `<div class="cd-resolve-row">
        <span class="cr-label" style="margin:0 8px 0 0">${esc(t('contam.resolveAs'))}</span>
        <button type="button" class="btn btn-sm" data-cd-resolve="autoclaved" data-i18n="contam.res.autoclaved">Autoklaviert</button>
        <button type="button" class="btn btn-sm" data-cd-resolve="discarded" data-i18n="contam.res.discarded">Entsorgt</button>
        <button type="button" class="btn btn-sm" data-cd-resolve="recovered" data-i18n="contam.res.recovered">Gerettet</button>
        <button type="button" class="btn btn-sm" data-cd-resolve="other" data-i18n="contam.res.other">Sonstiges</button>
      </div>`;
  body.innerHTML = `
    ${photosHtml}
    <div class="cd-meta-grid">
      <div><div class="label">${esc(t('contam.type'))}</div><div><span class="contam-type-badge"><span class="dot" style="background:${esc(r.type_color || '#888')}"></span>${typeName}</span></div></div>
      <div><div class="label">${esc(t('contam.severity'))}</div><div><span class="contam-sev-badge sev-${esc(r.severity)}">${esc(t('contam.' + sevKey))}</span></div></div>
      <div><div class="label">${esc(t('contam.bag'))}</div><div style="font-family:monospace">${esc(r.bag_id || '—')}</div></div>
      <div><div class="label">${esc(t('contam.batch'))}</div><div style="font-family:monospace">${esc(r.batch_id || '—')}</div></div>
      <div><div class="label">${esc(t('contam.reportedBy'))}</div><div>${esc(r.reporter || '—')}</div></div>
      <div><div class="label">${esc(t('contam.reportedAt'))}</div><div>${esc(fmtDtTime(r.reported_at))}</div></div>
      ${statusCell}
    </div>
    ${notesHtml}
    ${resolveActions}
  `;
}

async function _cdResolve(resolution) {
  if (!_cdReportId) return;
  const id = _cdReportId;
  try {
    const r = await apiPatch('/api/contamination-reports/' + id + '/resolve', { resolution });
    if (r && r.error) {
      setFb('err', t('contam.errResolve', { err: r.error }));
      return;
    }
    setFb('ok', t('contam.resolved'));
    await openContamDetail(id); // re-render with resolved state
    renderContamReports();
  } catch (e) {
    setFb('err', t('contam.errResolve', { err: e.message || 'unknown' }));
  }
}

async function _cdReopen() {
  if (!_cdReportId) return;
  const id = _cdReportId;
  try {
    const r = await apiPatch('/api/contamination-reports/' + id + '/resolve', {});
    if (r && r.error) {
      setFb('err', t('contam.errResolve', { err: r.error }));
      return;
    }
    setFb('ok', t('contam.reopened'));
    await openContamDetail(id);
    renderContamReports();
  } catch (e) {
    setFb('err', t('contam.errResolve', { err: e.message || 'unknown' }));
  }
}

function closeContamDetail() {
  document.getElementById('m-contam-detail').classList.remove('open');
  _cdReportId = null;
}

function _cdDelete() {
  if (!_cdReportId) return;
  const id = _cdReportId;
  confirm2(t('contam.confirmDeleteTitle'), t('contam.confirmDeleteBody'), t('contam.delete'), async () => {
    try {
      const r = await apiDelete('/api/contamination-reports/' + id);
      if (r && r.error) {
        setFb('err', t('contam.errDelete', { err: r.error }));
        return;
      }
      setFb('ok', t('contam.deleted'));
      closeContamDetail();
      renderContamReports();
    } catch (e) {
      setFb('err', t('contam.errDelete', { err: e.message || 'unknown' }));
    }
  });
}

// ─── BAG-SELECT MODAL (subset-of-batch move) ─────────────────
// State: which batch we're selecting from, and which bag IDs are chosen.
let bsBatchId = null;
let bsSelected = new Set();

function openBagSelectModal(initialBagId, batchId) {
  const b = batches.find((x) => x.batchId.toUpperCase() === (batchId || '').toUpperCase());
  if (!b) return;
  bsBatchId = b.batchId;
  bsSelected = new Set();
  // Pre-select the scanned bag if it's a real bag in this batch and still movable.
  if (initialBagId) {
    const canonical = b.bags.find((x) => x.toUpperCase() === initialBagId.toUpperCase());
    if (canonical) {
      const last = [...scanLog]
        .reverse()
        .find(
          (e) =>
            (e.bag || '').toUpperCase() === canonical.toUpperCase() &&
            (e.action === 'ADD' || e.action === 'MOVE' || e.action === 'REMOVE')
        );
      if (last && last.action !== 'REMOVE') bsSelected.add(canonical);
    }
  }
  renderBagSelect();
  closeCamScan();
  closeScanModal();
  document.getElementById('m-baginfo').classList.remove('open');
  document.getElementById('m-bagselect').classList.add('open');
}

function renderBagSelect() {
  const b = batches.find((x) => x.batchId === bsBatchId);
  if (!b) return;
  document.getElementById('bs-subtitle').textContent = t('bagSelect.subtitle', {
    id: b.batchId,
    n: bsSelected.size,
    total: b.bags.length
  });
  document.getElementById('bs-count').textContent = t('bagSelect.countSelected', { n: bsSelected.size });
  const continueBtn = document.getElementById('bs-continue');
  if (continueBtn) {
    continueBtn.disabled = bsSelected.size === 0;
    continueBtn.style.opacity = bsSelected.size === 0 ? '0.4' : '1';
    continueBtn.style.cursor = bsSelected.size === 0 ? 'not-allowed' : 'pointer';
  }
  const container = document.getElementById('bs-bags');
  container.innerHTML = '';
  b.bags.forEach((bag) => {
    const bagNum = bag.split('-').pop();
    const last = [...scanLog]
      .reverse()
      .find(
        (e) =>
          (e.bag || '').toUpperCase() === bag.toUpperCase() &&
          (e.action === 'ADD' || e.action === 'MOVE' || e.action === 'REMOVE')
      );
    const isRemoved = last && last.action === 'REMOVE';
    const isUnplaced = !last;
    const loc = isUnplaced ? '\u2014' : isRemoved ? '\u2717' : last.to || '?';
    const isSelected = bsSelected.has(bag);
    const disabled = isRemoved || isUnplaced;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.disabled = disabled;
    btn.title = disabled ? (isRemoved ? t('bagInfo.removed') : t('bagInfo.notPlaced')) : loc;
    btn.innerHTML =
      '<div style="font-size:14px;font-weight:700;font-family:monospace">' +
      esc(bagNum) +
      '</div>' +
      '<div style="font-size:10px;margin-top:2px;opacity:0.85">' +
      esc(loc) +
      '</div>';
    btn.style.cssText =
      'min-width:56px;padding:8px 10px;border-radius:8px;text-align:center;cursor:' +
      (disabled ? 'not-allowed' : 'pointer') +
      ';opacity:' +
      (disabled ? '0.35' : '1') +
      ';background:' +
      (isSelected ? 'var(--c-blue-dark, #1e6dd8)' : 'var(--c-bg)') +
      ';color:' +
      (isSelected ? '#fff' : 'var(--c-text)') +
      ';border:2px solid ' +
      (isSelected ? 'var(--c-blue-dark, #1e6dd8)' : 'var(--c-border)') +
      ';';
    if (!disabled) {
      btn.addEventListener('click', () => bsToggleBag(bag));
    }
    container.appendChild(btn);
  });
}

// Toggle a bag in the selection (called from clicks and from scans).
// Returns {toggled: true, added: boolean} if the bag belongs to the current batch.
function bsToggleBag(bag) {
  const b = batches.find((x) => x.batchId === bsBatchId);
  if (!b) return { toggled: false };
  const canonical = b.bags.find((x) => x.toUpperCase() === bag.toUpperCase());
  if (!canonical) return { toggled: false };
  const last = [...scanLog]
    .reverse()
    .find(
      (e) =>
        (e.bag || '').toUpperCase() === canonical.toUpperCase() &&
        (e.action === 'ADD' || e.action === 'MOVE' || e.action === 'REMOVE')
    );
  if (!last || last.action === 'REMOVE') return { toggled: false };
  let added;
  if (bsSelected.has(canonical)) {
    bsSelected.delete(canonical);
    added = false;
  } else {
    bsSelected.add(canonical);
    added = true;
  }
  renderBagSelect();
  return { toggled: true, added: added, bag: canonical };
}

function bsConfirm() {
  const b = batches.find((x) => x.batchId === bsBatchId);
  if (!b) return;
  if (bsSelected.size === 0) {
    setFb('err', t('bagSelect.noneSelected'));
    return;
  }
  const selected = Array.from(bsSelected);
  bsClose();
  _openZonePicker(t('bagSelect.moveMenuTitle', { n: selected.length }), function (dest) {
    moveBagsTo(b, selected, dest, function (moved, skipped) {
      if (!moved) {
        if (skipped > 0) {
          setFb('ok', t('batch.allAlreadyAt', { n: skipped, loc: zoneDisplayName(dest) }));
        } else {
          setFb('err', t('batch.noBagsToMove'));
        }
        return;
      }
      setFb(
        'ok',
        b.batchId +
          ': ' +
          moved +
          ' Bags \u2192 ' +
          zoneDisplayName(dest) +
          (skipped ? ' (' + skipped + ' \u00fcbersprungen)' : '')
      );
      scan.count += moved;
      updateSD();
      renderBatches();
    });
  });
}

// Close the bag-select modal AND reset its module-level state so future scans
// don't get misrouted by stale bsBatchId / bsSelected values.
function bsClose() {
  document.getElementById('m-bagselect').classList.remove('open');
  bsBatchId = null;
  bsSelected = new Set();
}

document.getElementById('m-bagselect').addEventListener('click', (e) => {
  if (e.target.id === 'm-bagselect') bsClose();
});

// ─── PRINT — BAG LABELS ──────────────────────────────────────
// ─── PRINT via server → ZPL → Windows spooler → GK420d ──────
// Correct size/orientation automatically — no browser dialog issues.
// Hyphens encoded as underscores in barcode to fix German keyboard scanning.

// Legacy species abbreviation (only used for scanning old barcode labels).
function spAbbrev(species) {
  if (!species) return 'XX';
  const words = species.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
// Calculate Code 128 module width + centered x-offset for ZPL labels.
// Label is 400 dots wide; need 20-dot quiet zone each side → 360 usable dots.
// Code 128 symbol ≈ (35 + chars*11) modules. Use mw=2 if it fits, else mw=1.
// Returns {mw, x} where x centers the barcode horizontally with minimum quiet zones.
// Code 128 quiet zone = 10× module width. Try mw=3, then 2, then 1.
// qzMult: quiet zone multiplier (default 10). Use 5 for lab labels to allow wider bars.
function bcParams(val, qzMult) {
  const mods = 35 + val.length * 11;
  let mw = 3;
  qzMult = qzMult || 10;
  const qz = (m) => m * qzMult;
  while (mw > 1 && mods * mw + 2 * qz(mw) > 400) mw--;
  const w = mods * mw;
  return { mw, x: Math.max(qz(mw), Math.round((400 - w) / 2)) };
}

// ─── Unified label layout: SINGLE SOURCE OF TRUTH for ZPL + preview ───
// Canvas is 400×240 dots (50×30mm @ 203dpi). bagLabelItems/labLabelItems
// describe one label as a plain array of items in that coordinate system;
// itemsToZPL turns them into printer output and buildPreviewCell renders
// the same items as an SVG with viewBox="0 0 400 240". Because both come
// from the same items array the preview cannot drift from what prints.
// Item shapes:
//   {type:'barcode', x, y, w, h, val, mw}
//   {type:'text',    x?, y, blockW?, fontH, fontW?, text, bold?}
//   {type:'qr',      x, y, size, val}

// Sanitize a string for use inside a ZPL ^FD...^FS field.
// ^ starts ZPL commands and ~ starts ZPL control sequences — both must be removed
// so user-supplied text (species names, notes, IDs) cannot inject ZPL commands.
function zplText(s) {
  return String(s || '').replace(/[\^~]/g, '');
}

function itemsToZPL(items) {
  // Label size from server config (LABEL_WIDTH_DOTS / LABEL_HEIGHT_DOTS env).
  // Default 400×240 dots = 50×30mm at 203dpi. Field positions in the
  // callers assume 400 dots wide; significantly different sizes need
  // their own layout.
  // ^LT0/^LS0 reset stored offsets, ^PON/^FWN force normal orientation.
  let z = '^XA^PW' + labelDims.widthDots + '^LL' + labelDims.heightDots + '^CI28^LH0,0^LT0^LS0^PON^FWN';
  for (const it of items) {
    if (it.type === 'barcode') {
      z +=
        '^FO' +
        it.x +
        ',' +
        it.y +
        '^BY' +
        it.mw +
        ',2.0,' +
        it.h +
        '^BCN,' +
        it.h +
        ',N,N,N^FD' +
        zplText(it.val) +
        '^FS';
    } else if (it.type === 'text') {
      const fw = it.fontW || it.fontH;
      const bw = it.blockW || 400;
      const bx = it.x || 0;
      z +=
        '^FO' + bx + ',' + it.y + '^FB' + bw + ',1,0,C^A0N,' + it.fontH + ',' + fw + '^FD' + zplText(it.text) + '^FS';
      // ZPL has no bold flag; double-draw at x+1 thickens strokes.
      if (it.bold)
        z +=
          '^FO' +
          (bx + 1) +
          ',' +
          it.y +
          '^FB' +
          bw +
          ',1,0,C^A0N,' +
          it.fontH +
          ',' +
          fw +
          '^FD' +
          zplText(it.text) +
          '^FS';
    } else if (it.type === 'qr') {
      // Reset label home immediately before QR to ensure ^FO works from true origin.
      z += '^LH0,0^FO' + it.x + ',' + it.y + '^BQN,2,' + (it.mag || 4) + '^FDMA,' + zplText(it.val) + '^FS';
    }
  }
  return z + '^XZ';
}

// Builds one preview cell as an SVG. Returns {cell, deferred} — insert cell
// into the DOM first, then call renderPreviewDeferred(deferred) to attach
// JsBarcode/QRCode content to the live nodes.
function buildPreviewCell(items) {
  const cell = document.createElement('div');
  cell.style.cssText =
    'position:relative;border:1px solid var(--c-border);border-radius:5px;background:#fff;overflow:hidden;aspect-ratio:5/3';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 400 240');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  cell.appendChild(svg);
  const deferred = [];
  for (const it of items) {
    if (it.type === 'barcode') {
      const inner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      inner.setAttribute('x', it.x);
      inner.setAttribute('y', it.y);
      inner.setAttribute('width', it.w);
      inner.setAttribute('height', it.h);
      svg.appendChild(inner);
      deferred.push({ kind: 'bc', el: inner, val: it.val, mw: it.mw, w: it.w, h: it.h });
    } else if (it.type === 'text') {
      const bw = it.blockW || 400;
      const cx = (it.x || 0) + bw / 2;
      // ZPL A0 font height ≈ character height; baseline ≈ 82% from top.
      const by = it.y + it.fontH * 0.82;
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', cx);
      t.setAttribute('y', by);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-family', 'Helvetica,Arial,sans-serif');
      t.setAttribute('font-size', it.fontH);
      t.setAttribute('fill', '#000');
      if (it.bold) t.setAttribute('font-weight', 'bold');
      t.textContent = it.text;
      svg.appendChild(t);
    } else if (it.type === 'qr') {
      // QR as HTML overlay positioned with % from ZPL coords (qrcode.js → img/canvas).
      const qrDiv = document.createElement('div');
      const L = ((it.x / 400) * 100).toFixed(2);
      const T = ((it.y / 240) * 100).toFixed(2);
      const W = ((it.size / 400) * 100).toFixed(2);
      qrDiv.style.cssText =
        'position:absolute;left:' + L + '%;top:' + T + '%;width:' + W + '%;aspect-ratio:1;background:#fff';
      cell.appendChild(qrDiv);
      deferred.push({ kind: 'qr', el: qrDiv, val: it.val });
    }
  }
  return { cell, deferred };
}

function renderPreviewDeferred(deferred, baseDelay) {
  baseDelay = baseDelay || 20;
  // P-02: JsBarcode + QRCode are lazy-loaded. Wait for them before rendering
  // any deferred items. The setTimeout chain that staggered rendering is
  // preserved; we just delay the whole chain until the libs land.
  if (typeof JsBarcode === 'undefined' || typeof QRCode === 'undefined') {
    loadVendorLibs().then(() => renderPreviewDeferred(deferred, baseDelay));
    return;
  }
  deferred.forEach((d, i) => {
    setTimeout(
      () => {
        if (d.kind === 'bc') {
          try {
            JsBarcode(d.el, d.val, {
              format: 'CODE128',
              width: d.mw,
              height: d.h,
              displayValue: false,
              margin: 0,
              background: '#fff',
              lineColor: '#000'
            });
            // JsBarcode rewrites width/height on the svg; capture those as a
            // viewBox and restore our (x,y,w,h) so bars stretch to our cell.
            const w = parseFloat(d.el.getAttribute('width')) || d.w;
            const h = parseFloat(d.el.getAttribute('height')) || d.h;
            d.el.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
            d.el.setAttribute('width', d.w);
            d.el.setAttribute('height', d.h);
            d.el.setAttribute('preserveAspectRatio', 'none');
          } catch {}
        } else if (d.kind === 'qr') {
          try {
            new QRCode(d.el, {
              text: d.val,
              width: 64,
              height: 64,
              colorDark: '#000',
              colorLight: '#fff',
              correctLevel: QRCode.CorrectLevel.L
            });
            const img = d.el.querySelector('img') || d.el.querySelector('canvas');
            if (img) {
              img.style.cssText = 'display:block;width:100%;height:100%';
            }
          } catch {}
        }
      },
      baseDelay + i * 12
    );
  });
}

// detail levels for bag labels:
//   'minimal' — barcode + Line 1 (bag ID) only
//   'sorte'   — + Line 2 (Pilzsorte written out + notes)
//   'full'    — + Line 3 (Fälligkeit)
// No label carries a spelled-out type word. The only band one fitted in was the
// top edge, which this stock clips, and every ID already opens with its type
// (MC-/PD-/LC-/G-) — so it cost a row and told nobody anything.
// Batch size in the bottom-right corner. Which bag this is was already on the
// label — it is the ID's last segment — so only the total was missing: move 9
// of 10 and nothing said one was still out there. Set apart in its own corner
// rather than folded into a line of text, so it reads at arm's length.
// The slash is deliberate: a bare "10" next to bag …-06 invites being read as
// the bag number. "/10" cannot be.
const _BADGE = { w: 72, h: 30 };
function _bagTotalBadge(batch) {
  const total = (batch.bags || []).length;
  if (!total) return null;
  const x = 400 - _BADGE.w - 6; // 322
  const y = 240 - _BADGE.h - 8; // 202 → occupies 202..232
  return {
    x,
    y,
    h: _BADGE.h,
    items: [{ type: 'text', x, y, blockW: _BADGE.w, fontH: 28, text: '/' + total, bold: true }]
  };
}
// Width a centred text line may use. The bottom-right badge sits over the band
// the last line(s) occupy, so any line overlapping it vertically is narrowed to
// stop short — the text re-centres in the space left rather than running under
// the box. Lines clear of the badge keep the full width they always had.
function _lineBlockW(y, fontH, badge) {
  return badge && y < badge.y + badge.h && badge.y < y + fontH ? badge.x - 6 : 400;
}
function bagLabelItems(bagId, batch, detail, _legacyFallbackIds, qr, bagKg) {
  const items = [];
  // Numeric barcode: lookup from barcode registry, fall back to legacy encoding
  const numBc = barcodeByEntity.get('bag:' + bagId);
  let bcVal;
  if (numBc) {
    bcVal = String(numBc);
  } else {
    // Legacy fallback for bags without barcode assignment
    if (_legacyFallbackIds) _legacyFallbackIds.push(bagId);
    const isGrain = batch.batchType === 'grain';
    const parts = bagId.split('-');
    if (parts.length === 4) {
      const kz = (batch.strainKuerzel || batch.strain || 'BAGX').toUpperCase();
      const mmdd = parts[1].slice(2, 4) + parts[1].slice(0, 2);
      const bagNum = parseInt(parts[3], 10);
      bcVal = (isGrain ? 'G' : '') + kz + '_' + mmdd + '_' + bagNum;
    } else {
      bcVal = bagId.replace(/-/g, '_');
    }
  }
  // Bag labels carry no type word. Grainspawn had one, but the ID already opens
  // with G- and the top of the label is where this printer clips, so it cost a
  // line and printed cut off. Cultures keep theirs (see labLabelItems).
  const _badge = _bagTotalBadge(batch);
  if (_badge) _badge.items.forEach((i) => items.push(i));
  if (qr) {
    // QR mode: QR top-left, text centered full-width below.
    // mag=5 → ~125×125 dots for version-2 QR (25 modules × 5).
    items.push({ type: 'qr', x: 0, y: 10, size: 125, mag: 5, val: bcVal });
    items.push({ type: 'text', y: 155, blockW: _lineBlockW(155, 28, _badge), fontH: 28, text: bagId });
    if (detail === 'sorte' || detail === 'full') {
      const species = batch.strainName || batch.species || '';
      const strainTxt = (batch.strainText || '').trim();
      const rawNotes = (batch.notes || '').trim();
      const notes = rawNotes.length > 13 ? rawNotes.slice(0, 13) + '\u2026' : rawNotes;
      const parts = [species];
      if (bagKg != null) parts.push(bagKg + 'kg');
      if (strainTxt) parts.push(strainTxt);
      if (notes) parts.push(notes);
      const line2 = parts.join(' \u2013 ');
      if (line2) items.push({ type: 'text', y: 185, blockW: _lineBlockW(185, 24, _badge), fontH: 24, text: line2 });
    }
    if (detail === 'full' && batch.due) {
      const line3 = (batch.created ? fmtDt(batch.created) + ' - ' : '') + fmtDt(batch.due);
      items.push({ type: 'text', y: 215, blockW: _lineBlockW(215, 24, _badge), fontH: 24, text: line3, bold: true });
    }
  } else {
    // Barcode mode: barcode top-center, text lines below.
    // How many lines print depends on the mode, so a fixed top margin leaves a
    // "minimal" label (barcode + ID only) hugging the top with dead space under
    // it. Centre the block for what is actually on it, but never above y=40 —
    // this printer clips the very top of the stock.
    const species0 = batch.strainName || batch.species || '';
    const hasLine2 = (detail === 'sorte' || detail === 'full') && !!(species0 || bagKg != null || batch.strainText || batch.notes);
    const hasLine3 = detail === 'full' && !!batch.due;
    const bcH = 90;
    const blockH = bcH + 6 + 24 + (hasLine2 ? 28 : 0) + (hasLine3 ? 28 : 0);
    const bcY = Math.max(40, Math.round((240 - blockH) / 2));
    const bc = bcParams(bcVal);
    items.push({ type: 'barcode', x: bc.x, y: bcY, w: 400 - 2 * bc.x, h: bcH, val: bcVal, mw: bc.mw });
    const line1Y = bcY + bcH + 6;
    items.push({ type: 'text', y: line1Y, blockW: _lineBlockW(line1Y, 24, _badge), fontH: 24, text: bagId });
    if (detail === 'sorte' || detail === 'full') {
      const species = batch.strainName || batch.species || '';
      const strainTxt = (batch.strainText || '').trim();
      const rawNotes = (batch.notes || '').trim();
      const notes = rawNotes.length > 13 ? rawNotes.slice(0, 13) + '\u2026' : rawNotes;
      const parts = [species];
      if (bagKg != null) parts.push(bagKg + 'kg');
      if (strainTxt) parts.push(strainTxt);
      if (notes) parts.push(notes);
      const line2 = parts.join(' \u2013 ');
      if (line2)
        items.push({ type: 'text', y: line1Y + 28, blockW: _lineBlockW(line1Y + 28, 24, _badge), fontH: 24, text: line2 });
    }
    if (detail === 'full' && batch.due) {
      const line3 = (batch.created ? fmtDt(batch.created) + ' - ' : '') + fmtDt(batch.due);
      items.push({
        type: 'text',
        y: line1Y + 56,
        blockW: _lineBlockW(line1Y + 56, 28, _badge),
        fontH: 28,
        text: line3,
        bold: true
      });
    }
  }
  return items;
}

function labLabelItems(id, c, detail, qr) {
  const items = [];
  // Build info line matching batch label pattern: strainName – strainText – notes(13)
  const species = c.strainName || c.species || '';
  const strainTxt = (c.strainText || '').trim();
  const rawNotes = (c.notes || '').trim();
  const notes = rawNotes.length > 13 ? rawNotes.slice(0, 13) + '\u2026' : rawNotes;
  const spParts = [species];
  if (strainTxt) spParts.push(strainTxt);
  if (notes) spParts.push(notes);
  const sp = spParts.join(' \u2013 ');
  const ds = fmtDt(c.created);
  // Numeric barcode: lookup from registry, fall back to legacy encoding
  const numBc = barcodeByEntity.get('culture:' + id);
  const bcVal = numBc ? String(numBc) : id.replace(/-/g, '_');
  // No type word: the ID already opens with MC-/PD-/LC-, and the only place one
  // fitted was the top edge, which this label stock clips.
  if (qr) {
    // QR mode: QR top-left, text centered full-width below.
    items.push({ type: 'qr', x: 0, y: 10, size: 125, mag: 5, val: bcVal });
    const line1Text = c.parentId ? id + ' \u2190 ' + c.parentId : id;
    items.push({ type: 'text', y: 155, blockW: 400, fontH: 28, text: line1Text });
    if (detail === 'sorte' || detail === 'full') {
      if (sp) items.push({ type: 'text', y: 185, blockW: 400, fontH: 24, text: sp });
    }
    if (detail === 'full' && c.created) {
      const line3Y = sp ? 215 : 185;
      items.push({ type: 'text', y: line3Y, blockW: 400, fontH: 24, text: ds, bold: true });
    }
  } else {
    // Barcode mode: barcode top-center, text lines below. Centred on whichever
    // lines the print mode actually emits, same as bag labels, and floored at 40
    // because this stock clips above that.
    const hasSp = (detail === 'sorte' || detail === 'full') && !!sp;
    const hasDs = detail === 'full' && !!c.created;
    const bcH = 90;
    const blockH = bcH + 6 + 24 + (hasSp ? 28 : 0) + (hasDs ? 28 : 0);
    const bcY = Math.max(40, Math.round((240 - blockH) / 2));
    const bc = bcParams(bcVal);
    items.push({ type: 'barcode', x: bc.x, y: bcY, w: 400 - 2 * bc.x, h: bcH, val: bcVal, mw: bc.mw });
    const line1Y = bcY + bcH + 6;
    const line1Text = c.parentId ? id + ' \u2190 ' + c.parentId : id;
    items.push({ type: 'text', x: 0, y: line1Y, blockW: 400, fontH: 24, text: line1Text });
    if (detail === 'sorte' || detail === 'full') {
      if (sp) items.push({ type: 'text', x: 0, y: line1Y + 28, blockW: 400, fontH: 24, text: sp });
    }
    if (detail === 'full' && c.created) {
      const line3Y = line1Y + (sp ? 56 : 28);
      items.push({ type: 'text', x: 0, y: line3Y, blockW: 400, fontH: 28, text: ds, bold: true });
    }
  }
  return items;
}

function makeBagZPL(bags, batch, detail, qr) {
  const legacyFallbackIds = [];
  // Pass per-bag weight to label items when batch has mixed weights
  const wVals = batch.bagWeights ? new Set(Object.values(batch.bagWeights)) : new Set();
  const mixed = wVals.size > 1;
  const zpl = bags
    .map((bagId) => {
      const bk = mixed && batch.bagWeights ? batch.bagWeights[bagId] : null;
      return itemsToZPL(bagLabelItems(bagId, batch, detail, legacyFallbackIds, qr, bk));
    })
    .join('\n');
  if (legacyFallbackIds.length) {
    console.warn('makeBagZPL: numeric barcodes not found for bags, used legacy fallback:', legacyFallbackIds);
    alert(t('print.warnNumericBarcodes', { list: legacyFallbackIds.join(', ') }));
  }
  return zpl;
}

function makeLabZPL(ids, detail, qr) {
  return ids
    .map((id) => {
      const c = cultures.find((x) => x.id === id);
      return c ? itemsToZPL(labLabelItems(id, c, detail, qr)) : '';
    })
    .filter(Boolean)
    .join('\n');
}

function toggleBagRange() {
  document.getElementById('bag-range-inputs').style.display =
    document.getElementById('print-range').value === 'range' ? 'inline-flex' : 'none';
}

async function printBagLabels() {
  const b = batches.find((x) => x.batchId === document.getElementById('print-batch').value);
  if (!b) {
    alert(t('print.selectBatchFirst'));
    return;
  }
  let bags = b.bags;
  if (document.getElementById('print-range').value === 'range') {
    const from = parseInt(document.getElementById('bag-from').value) || 1;
    const to = parseInt(document.getElementById('bag-to').value) || b.bags.length;
    bags = b.bags.filter((bagId) => {
      const n = parseInt(bagId.split('-').pop());
      return n >= from && n <= to;
    });
    if (!bags.length) {
      alert(t('print.noBagsInRange'));
      return;
    }
  }
  const zpl = makeBagZPL(
    bags,
    b,
    document.getElementById('print-mode').value,
    document.getElementById('bag-qr').checked
  );
  if (!zpl || !zpl.includes('^XA')) {
    alert(t('print.noLabels'));
    return;
  }
  const err = await sendToPrinter(zpl);
  if (err) {
    const blob = new Blob([zpl], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = b.batchId + '_labels.zpl';
    a.click();
  } else {
    setFb('ok', 'Printed ' + bags.length + ' labels for ' + b.batchId);
  }
}

async function printLabLabels() {
  const ids = [...selectedLabIds];
  if (!ids.length) {
    alert(t('print.selectCulture'));
    return;
  }
  const zpl = makeLabZPL(ids, document.getElementById('lab-mode').value, document.getElementById('lab-qr').checked);
  if (!zpl || !zpl.includes('^XA')) {
    alert(t('print.noLabels'));
    return;
  }
  const err = await sendToPrinter(zpl);
  if (err) {
    const blob = new Blob([zpl], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lab_labels.zpl';
    a.click();
  } else {
    setFb('ok', 'Printed ' + ids.length + ' lab label' + (ids.length !== 1 ? 's' : ''));
  }
}

async function quickPrintCulture(id) {
  const zpl = makeLabZPL([id], 'full', false);
  const err = await sendToPrinter(zpl);
  if (err) {
    // fallback: download ZPL
    const blob = new Blob([zpl], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = id + '_label.zpl';
    a.click();
  }
}

async function sendToPrinter(zpl) {
  try {
    const r = await authFetch('/api/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zpl })
    });
    const d = await r.json();
    if (d.ok) return null;
    refreshPrinterStatus();
    return d.error || 'Print failed';
  } catch (e) {
    refreshPrinterStatus();
    return 'Could not reach server: ' + e.message;
  }
}

// Reflect /api/printer-status into the Print-tab status banner. Called when
// the page is opened, when the banner is clicked, and after each print
// attempt so the user sees if the bridge / printer state changed.
const PRINTER_STATUS_STYLES = {
  online: {
    key: 'print.status.online',
    bg: 'var(--c-primary-light)',
    border: 'var(--c-green-border)',
    color: 'var(--c-green-dark)'
  },
  printer_offline: { key: 'print.status.printerOffline', bg: '#fef3c7', border: '#fbbf24', color: '#92400e' },
  bridge_unreachable: { key: 'print.status.bridgeUnreachable', bg: '#fee2e2', border: '#fca5a5', color: '#991b1b' },
  no_bridge: { key: 'print.status.noBridge', bg: '#dbeafe', border: '#93c5fd', color: '#1e40af' },
  local_unavailable: { key: 'print.status.localUnavailable', bg: '#fee2e2', border: '#fca5a5', color: '#991b1b' }
};
async function refreshPrinterStatus() {
  const banner = document.getElementById('printer-status-banner');
  const text = document.getElementById('printer-status-text');
  const detail = document.getElementById('printer-status-detail');
  if (!banner || !text) return;
  let payload;
  try {
    const r = await authFetch('/api/printer-status');
    payload = await r.json();
  } catch (e) {
    text.textContent = t('print.status.checkFailed');
    if (detail) detail.textContent = e.message || '';
    return;
  }
  const style = PRINTER_STATUS_STYLES[payload.state] || PRINTER_STATUS_STYLES.printer_offline;
  banner.style.background = style.bg;
  banner.style.borderColor = style.border;
  text.style.color = style.color;
  text.textContent = t(style.key, { name: payload.name || '' });
  if (detail) detail.textContent = payload.error || '';
}

// ── Settings → Drucker tab ──────────────────────────────────────────────
async function renderPrinterSettings() {
  const platformEl = document.getElementById('printer-cfg-platform');
  const nameEl = document.getElementById('printer-cfg-printername');
  const sourceEl = document.getElementById('printer-cfg-source');
  const enabledEl = document.getElementById('printer-bridge-enabled');
  const urlEl = document.getElementById('printer-bridge-url');
  const tokenEl = document.getElementById('printer-bridge-token');
  if (!platformEl) return;
  let cfg;
  try {
    const r = await authFetch('/api/printer/config');
    cfg = await r.json();
  } catch (e) {
    setPrinterCfgStatus('error', e.message || 'Failed to load printer config');
    return;
  }
  platformEl.textContent = cfg.platform || '—';
  nameEl.textContent = cfg.printerName || '—';
  const sourceKey =
    cfg.bridge.effectiveSource === 'db'
      ? 'printer.sourceDb'
      : cfg.bridge.effectiveSource === 'env'
        ? 'printer.sourceEnv'
        : 'printer.sourceNone';
  sourceEl.textContent = t(sourceKey);
  enabledEl.checked = !!cfg.bridge.enabled;
  urlEl.value = cfg.bridge.url || '';
  tokenEl.value = '';
  tokenEl.placeholder = cfg.bridge.hasToken ? '••••• ' + t('printer.tokenPlaceholder') : t('printer.tokenPlaceholder');
}

function setPrinterCfgStatus(kind, msg) {
  const el = document.getElementById('printer-cfg-status');
  if (!el) return;
  el.style.display = msg ? 'block' : 'none';
  el.textContent = msg || '';
  if (kind === 'ok') {
    el.style.background = 'var(--c-primary-light)';
    el.style.color = 'var(--c-green-dark)';
    el.style.border = '1px solid var(--c-green-border)';
  } else if (kind === 'error') {
    el.style.background = '#fee2e2';
    el.style.color = '#991b1b';
    el.style.border = '1px solid #fca5a5';
  }
}

async function savePrinterSettings() {
  const enabled = document.getElementById('printer-bridge-enabled').checked;
  const url = document.getElementById('printer-bridge-url').value.trim();
  const tokenInput = document.getElementById('printer-bridge-token').value;
  const body = { enabled, url };
  // Only send token field if user typed something — otherwise the server
  // would clear the existing token.
  if (tokenInput.length > 0) body.token = tokenInput;
  try {
    const r = await authFetch('/api/printer/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      setPrinterCfgStatus('error', err.error || 'Save failed');
      return;
    }
    setPrinterCfgStatus('ok', t('printer.saved'));
    await renderPrinterSettings();
    refreshPrinterStatus();
  } catch (e) {
    setPrinterCfgStatus('error', e.message);
  }
}

async function testPrintBridge() {
  setPrinterCfgStatus('', '');
  try {
    const r = await authFetch('/api/printer/test', { method: 'POST' });
    const d = await r.json();
    if (r.ok && d.ok) {
      setPrinterCfgStatus('ok', t('printer.testOk'));
    } else {
      setPrinterCfgStatus('error', t('printer.testFail', { err: d.error || 'Unknown error' }));
    }
    refreshPrinterStatus();
  } catch (e) {
    setPrinterCfgStatus('error', t('printer.testFail', { err: e.message }));
  }
}

async function downloadBridgeScript() {
  try {
    const r = await authFetch('/api/printer/bridge-script');
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      setPrinterCfgStatus('error', t('printer.downloadFailed', { err: err.error || 'HTTP ' + r.status }));
      return;
    }
    const text = await r.text();
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'print-bridge.ps1';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    setPrinterCfgStatus('error', t('printer.downloadFailed', { err: e.message }));
  }
}

function copyToClipboardWithFeedback(text, btn) {
  const restore = btn.textContent;
  navigator.clipboard
    .writeText(text)
    .then(() => {
      btn.textContent = t('printer.copied');
      setTimeout(() => {
        btn.textContent = restore;
      }, 1200);
    })
    .catch(() => {
      btn.textContent = '!';
      setTimeout(() => {
        btn.textContent = restore;
      }, 1200);
    });
}

function batchOptionLabel(b) {
  const kz = b.strainKuerzel || b.strain || '';
  const name = b.strainName || b.species || '';
  const st = (b.strainText || '').trim();
  return (kz ? '[' + esc(kz) + '] ' : '') + esc(b.batchId) + ' — ' + esc(name) + (st ? ' ' + esc(st) : '');
}
function fillBatchSelect(filter) {
  const s = document.getElementById('print-batch');
  const cur = s.value;
  const searchInput = document.getElementById('print-batch-search');
  const q = (filter != null ? filter : searchInput ? searchInput.value : '').toLowerCase().trim();
  // Newest first; when no search, limit to 50 most recent
  let list = [...batches].reverse();
  if (q) {
    list = list.filter((b) => batchOptionLabel(b).toLowerCase().includes(q));
  } else {
    list = list.slice(0, 50);
  }
  s.innerHTML =
    '<option value="">— ' +
    t('print.chooseBatch') +
    ' —</option>' +
    list.map((b) => `<option value="${esc(b.batchId)}">${batchOptionLabel(b)}</option>`).join('');
  if (cur) s.value = cur;
}

function renderBagPreview() {
  const id = document.getElementById('print-batch').value;
  const el = document.getElementById('bag-preview');
  const mode = document.getElementById('print-mode').value;
  const qr = document.getElementById('bag-qr').checked;
  if (!id) {
    el.innerHTML = '<div class="empty">' + t('print.selectBatchAbove') + '</div>';
    return;
  }
  const batch = batches.find((b) => b.batchId === id);
  if (!batch) return;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px';
  const allDeferred = [];
  const wVals = batch.bagWeights ? new Set(Object.values(batch.bagWeights)) : new Set();
  const mixed = wVals.size > 1;
  batch.bags.forEach((bagId) => {
    const bk = mixed && batch.bagWeights ? batch.bagWeights[bagId] : null;
    const { cell, deferred } = buildPreviewCell(bagLabelItems(bagId, batch, mode, null, qr, bk));
    wrap.appendChild(cell);
    allDeferred.push(...deferred);
  });
  el.innerHTML = '';
  el.appendChild(wrap);
  renderPreviewDeferred(allDeferred, 30);
}

let selectedLabIds = new Set();
let lastCreatedCultureIds = [];
function goToPrintLabCulture() {
  selectedLabIds = new Set(lastCreatedCultureIds);
  go('print', 'n-print');
  setTimeout(() => {
    openStab('print', 'lab');
    renderLabList();
    renderLabPreview();
  }, 150);
}
function renderLabList() {
  const filter = document.getElementById('lab-filter').value,
    el = document.getElementById('lab-list'),
    today = todayStr();
  const rows = cultures
    .filter((c) => {
      if (filter === 'all') return c.status === 'active' || c.status === 'stored';
      if (filter === 'today') {
        const d = new Date(c.created);
        // Must match todayStr()'s DDMMYY order — building YYMMDD here made the
        // "today" filter match only when day-of-month equalled the 2-digit year.
        return (
          String(d.getDate()).padStart(2, '0') +
            String(d.getMonth() + 1).padStart(2, '0') +
            String(d.getFullYear()).slice(2) ===
          today
        );
      }
      return c.type === filter;
    })
    .sort((a, b) => b.created.localeCompare(a.created));
  el.innerHTML = rows.length
    ? rows
        .map(
          (c) =>
            `<label style="display:flex;align-items:center;gap:7px;padding:4px 0;cursor:pointer;font-size:12px;border-bottom:0.5px solid #f0ede8"><input type="checkbox" ${selectedLabIds.has(c.id) ? 'checked' : ''} onchange="toggleLabId('${esc(c.id)}',this.checked)" style="width:14px;height:14px;margin:0" /><span style="font-family:monospace;font-weight:500">${esc(c.id)}</span><span class="badge ${c.type === 'MC' ? 'badge-mc' : c.type === 'PD' ? 'badge-pd' : 'badge-lc'}">${esc(c.type)}</span><span style="color:var(--c-text-muted)">${esc(c.species)}${c.strain ? ' / ' + esc(c.strain) : ''}</span></label>`
        )
        .join('')
    : '<div style="font-size:12px;color:var(--c-text-muted);padding:6px">No cultures match.</div>';
}
function toggleLabId(id, on) {
  if (on) selectedLabIds.add(id);
  else selectedLabIds.delete(id);
  renderLabPreview();
}
function renderLabPreview() {
  const el = document.getElementById('lab-preview');
  const ids = [...selectedLabIds];
  if (!ids.length) {
    el.innerHTML = '<div class="empty">' + t('print.tickCulturesPreview') + '</div>';
    return;
  }
  const detail = document.getElementById('lab-mode').value;
  const qr = document.getElementById('lab-qr').checked;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px';
  const allDeferred = [];
  ids.forEach((id) => {
    const c = cultures.find((x) => x.id === id);
    if (!c) return;
    const { cell, deferred } = buildPreviewCell(labLabelItems(id, c, detail, qr));
    wrap.appendChild(cell);
    allDeferred.push(...deferred);
  });
  el.innerHTML = '';
  el.appendChild(wrap);
  renderPreviewDeferred(allDeferred, 30);
}

// ─── REF BARCODES ────────────────────────────────────────────
async function makeQR(val) {
  // P-02: QRCode is lazy-loaded.
  if (typeof QRCode === 'undefined') await loadVendorLibs();
  return new Promise((resolve) => {
    const div = document.createElement('div');
    div.style.cssText = 'display:inline-block';
    try {
      new QRCode(div, {
        text: val,
        width: 120,
        height: 120,
        colorDark: '#000',
        colorLight: '#fff',
        correctLevel: QRCode.CorrectLevel.L
      });
      setTimeout(() => {
        const img = div.querySelector('img') || div.querySelector('canvas');
        if (img) {
          img.style.cssText = 'display:block;width:100%;height:auto';
          resolve(img);
        } else resolve(null);
      }, 100);
    } catch {
      resolve(null);
    }
  });
}

async function renderRefBarcodes() {
  // P-02: JsBarcode + QRCode are lazy-loaded.
  if (typeof JsBarcode === 'undefined' || typeof QRCode === 'undefined') await loadVendorLibs();
  const grid = document.getElementById('ref-grid');
  grid.innerHTML = '';
  const useQR = document.getElementById('ref-qr').checked;
  for (const group of REF_GROUPS) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="sec">${group.g}</div>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:20px;margin-top:12px;align-items:flex-end';
    for (const item of group.items) {
      const val = item.val,
        label = item.label;
      const cell = document.createElement('div');
      cell.className = 'bc-cell';
      cell.style.cssText =
        'min-width:140px;text-align:center;padding:8px 12px;border:1px solid var(--c-border);border-radius:6px;background:var(--c-surface)';
      if (useQR) {
        const img = await makeQR(val);
        if (img) cell.appendChild(img);
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:12px;font-weight:700;color:var(--c-text-sec);margin-top:5px';
        lbl.textContent = label;
        cell.appendChild(lbl);
      } else {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = 'display:block';
        cell.appendChild(svg);
        setTimeout(() => {
          try {
            JsBarcode(svg, val, {
              format: 'CODE128',
              width: 2,
              height: 60,
              displayValue: false,
              margin: 14,
              background: '#fff',
              lineColor: '#000'
            });
          } catch {}
        }, 20);
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:12px;font-weight:700;color:var(--c-text-sec);margin-top:5px;text-align:center';
        lbl.textContent = label;
        cell.appendChild(lbl);
      }
      row.appendChild(cell);
    }
    card.appendChild(row);
    grid.appendChild(card);
  }
}
async function printRef() {
  // P-02: JsBarcode + QRCode are lazy-loaded.
  if (typeof JsBarcode === 'undefined' || typeof QRCode === 'undefined') await loadVendorLibs();
  const sheet = document.getElementById('ref-print-sheet');
  sheet.innerHTML = '';
  const useQR = document.getElementById('ref-qr').checked;
  const title = document.createElement('div');
  title.style.cssText = 'font-family:Arial,sans-serif;font-size:15px;font-weight:bold;margin-bottom:12px;padding:8px';
  title.textContent = 'Reference ' + (useQR ? 'QR Codes' : 'Barcodes');
  sheet.appendChild(title);
  let delay = 0;
  for (const group of REF_GROUPS) {
    const sec = document.createElement('div');
    sec.style.cssText =
      'font-family:Arial,sans-serif;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;color:var(--c-text-muted);margin:14px 8px 8px';
    sec.textContent = group.g;
    sheet.appendChild(sec);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:20px;padding:0 8px';
    for (const item of group.items) {
      const val = item.val,
        label = item.label;
      const cell = document.createElement('div');
      cell.style.cssText =
        'border:1px solid var(--c-border);border-radius:6px;padding:12px 16px;text-align:center;background:var(--c-surface);page-break-inside:avoid';
      if (useQR) {
        const img = await makeQR(val);
        if (img) {
          img.style.width = '90px';
          img.style.height = '90px';
          cell.appendChild(img);
        }
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:11px;font-weight:bold;font-family:Arial,sans-serif;margin-top:5px';
        lbl.textContent = label;
        cell.appendChild(lbl);
      } else {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        cell.appendChild(svg);
        setTimeout(() => {
          try {
            JsBarcode(svg, val, {
              format: 'CODE128',
              width: 2,
              height: 60,
              displayValue: false,
              margin: 14,
              background: '#fff',
              lineColor: '#000'
            });
          } catch {}
        }, delay);
        delay += 25;
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:11px;font-weight:bold;font-family:Arial,sans-serif;margin-top:5px';
        lbl.textContent = label;
        cell.appendChild(lbl);
      }
      row.appendChild(cell);
    }
    sheet.appendChild(row);
  }
  setTimeout(() => window.print(), useQR ? 800 : delay + 200);
}

// ─── GLOBAL SCAN ENGINE ──────────────────────────────────────
// Session tracking
let sessionEntries = [];
let sessionStartTime = null;
let sessionErrors = 0;
let _lastScanVal = null;
// Audio feedback
let _scanAudioCtx = null;
let scanAudioEnabled = true;
// iOS requires AudioContext creation during a user gesture; call this from gesture handlers
function _initScanAudio() {
  if (!_scanAudioCtx) {
    try {
      _scanAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {}
  }
  if (_scanAudioCtx && _scanAudioCtx.state === 'suspended') _scanAudioCtx.resume().catch(function () {});
}
function _scanBeep(freq, dur) {
  if (!scanAudioEnabled) return;
  try {
    _initScanAudio();
    if (!_scanAudioCtx) return;
    const o = _scanAudioCtx.createOscillator();
    const g = _scanAudioCtx.createGain();
    o.connect(g);
    g.connect(_scanAudioCtx.destination);
    o.frequency.value = freq;
    g.gain.value = 0.15;
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, _scanAudioCtx.currentTime + dur / 1000);
    o.stop(_scanAudioCtx.currentTime + dur / 1000);
  } catch {}
}
// Pleasant success chirp: 880Hz sine, 120ms with soft attack/release envelope
function _scanBeepOk() {
  if (!scanAudioEnabled) return;
  try {
    _initScanAudio();
    if (!_scanAudioCtx) return;
    const ctx = _scanAudioCtx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, now);
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.22, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.start(now);
    o.stop(now + 0.13);
  } catch {}
}
// Sharp error buzz: two dissonant square waves (280Hz + 350Hz), 350ms with gap
function _scanBeepErr() {
  if (!scanAudioEnabled) return;
  try {
    _initScanAudio();
    if (!_scanAudioCtx) return;
    const ctx = _scanAudioCtx;
    const t0 = ctx.currentTime;
    function tone(start, dur) {
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const g = ctx.createGain();
      o1.type = 'square';
      o2.type = 'square';
      o1.frequency.setValueAtTime(280, start);
      o2.frequency.setValueAtTime(350, start);
      o1.connect(g);
      o2.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
      g.gain.setValueAtTime(0.18, start + dur - 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o1.start(start);
      o2.start(start);
      o1.stop(start + dur);
      o2.stop(start + dur);
    }
    tone(t0, 0.14);
    tone(t0 + 0.21, 0.14);
  } catch {}
}
// Tab navigation for 3-tab scan modal
function switchScanTab(tab) {
  const tabs = document.querySelectorAll('.scan-tab');
  const panels = document.querySelectorAll('.scan-tab-panel');
  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i];
    if (t.getAttribute('data-scan-tab') === tab) t.classList.add('active');
    else t.classList.remove('active');
  }
  for (let j = 0; j < panels.length; j++) {
    const p = panels[j];
    if (p.getAttribute('data-scan-panel') === tab) p.classList.add('active');
    else p.classList.remove('active');
  }
}
// Render the "Letzte Erfolge" tab from sessionEntries (session successes)
function renderScanSuccesses() {
  const list = document.getElementById('scan-successes-list');
  if (!list) return;
  list.innerHTML = '';
  const succ = (sessionEntries || []).filter(function (e) {
    return e && e.action && (e.batch || e.bag);
  });
  const cnt = document.getElementById('scan-tab-succ-count');
  if (cnt) cnt.textContent = String(succ.length);
  // Newest first
  for (let i = succ.length - 1; i >= 0; i--) {
    const e = succ[i];
    const row = document.createElement('div');
    row.className = 'scan-success-row';
    if (e._tempId) row.setAttribute('data-succ-id', e._tempId);
    const tm = e.time ? new Date(e.time) : new Date();
    const timeStr =
      tm.getHours().toString().padStart(2, '0') +
      ':' +
      tm.getMinutes().toString().padStart(2, '0') +
      ':' +
      tm.getSeconds().toString().padStart(2, '0');
    const label = e.bag || e.batch || '';
    const locStr =
      e.action === 'MOVE'
        ? (e.from || '?') + ' → ' + (e.to || '?')
        : e.action === 'ADD'
          ? '→ ' + (e.to || '')
          : e.action === 'REMOVE'
            ? '✕ ' + (e.from || '')
            : e.action === 'HARVEST'
              ? '🍄'
              : '';
    row.innerHTML =
      '<span class="scan-success-time">' +
      timeStr +
      '</span>' +
      '<span class="badge b-' +
      esc((e.action || '').toLowerCase()) +
      '">' +
      esc(e.action || '') +
      '</span>' +
      '<span class="scan-success-body"><b>' +
      esc(label) +
      '</b>' +
      (locStr ? ' <span class="scan-success-loc">' + esc(locStr) + '</span>' : '') +
      '</span>' +
      '<button class="scan-success-undo" onclick="undoSuccessRow(this)" title="Undo">↩ Undo</button>';
    list.appendChild(row);
  }
}
// Undo from "Letzte Erfolge" tab row
function undoSuccessRow(btn) {
  const row = btn.closest('.scan-success-row');
  const tempId = row ? row.getAttribute('data-succ-id') : null;
  if (!tempId) return;
  // Delegate to existing undoScanEntry via a matching log-entry button, or perform undo directly
  const logBtn = document.querySelector('.scan-log-entry[data-scan-id="' + tempId + '"] .sle-undo');
  if (logBtn) {
    undoScanEntry(logBtn);
    renderScanSuccesses();
    return;
  }
  // Fallback: mirror undoScanEntry logic for entries not in the visible log
  const idx = sessionEntries.findIndex(function (e) {
    return e._tempId === tempId;
  });
  if (idx === -1) return;
  const entry = sessionEntries[idx];
  const si = scanLog.findIndex(function (e) {
    return e._tempId === tempId;
  });
  if (si !== -1) scanLog.splice(si, 1);
  const mi = movements.findIndex(function (e) {
    return e._tempId === tempId;
  });
  if (mi !== -1) movements.splice(mi, 1);
  sessionEntries.splice(idx, 1);
  if (entry._serverId) apiDelete('/api/scan-log/' + entry._serverId);
  // _queued: the SW holds it offline, so there is no server row to DELETE and
  // none is coming until replay — pull it out of the queue instead.
  else if (entry._queued && dropQueuedScanEntry(entry)) entry._queued = false;
  else entry._undoPending = true; // POST not resolved yet — delete once its id arrives
  scan.count = Math.max(0, scan.count - 1);
  _scanBeep(400, 100);
  setFb('info', 'Undo: ' + entry.action + ' ' + (entry.bag || entry.batch));
  updateSD();
  renderStatus();
  renderScanSuccesses();
}
// Transient overlay background flash to reinforce feedback
var _scanBgFlashTimer = null;
function _flashScanBg(type) {
  const ov = document.getElementById('scan-overlay');
  if (!ov) return;
  ov.classList.remove('scan-bg-ok', 'scan-bg-err');
  if (type === 'ok') ov.classList.add('scan-bg-ok');
  else if (type === 'err') ov.classList.add('scan-bg-err');
  else return;
  clearTimeout(_scanBgFlashTimer);
  _scanBgFlashTimer = setTimeout(function () {
    ov.classList.remove('scan-bg-ok', 'scan-bg-err');
  }, 800);
}
// Multi-tab scan dedup via BroadcastChannel
const scanChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('meister-scans') : null;
if (scanChannel) {
  scanChannel.onmessage = function (ev) {
    if (ev.data && ev.data.type === 'scan-entry') {
      // Add to sessionEntries for dedup checking across tabs
      sessionEntries.push(ev.data.entry);
    }
  };
}
// Duplicate detection
let _pendingDupe = null;
let _pendingDupeTimer = null;
// Remove confirmation
let _pendingRemove = null;
let _pendingRemoveTimer = null;

function openScanModal() {
  document.getElementById('scan-overlay').classList.add('open');
  if (window.innerWidth <= 768) document.body.style.overflow = 'hidden';
}
function closeScanModal() {
  document.getElementById('scan-overlay').classList.remove('open');
  document.body.style.overflow = '';
}
function _addLogEntry(type, msg, entryData) {
  const log = document.getElementById('scan-modal-log');
  const el = document.createElement('div');
  el.className = 'scan-log-entry log-' + type;
  if (entryData && entryData._tempId) el.setAttribute('data-scan-id', entryData._tempId);
  const tm = new Date();
  const timeStr =
    tm.getHours().toString().padStart(2, '0') +
    ':' +
    tm.getMinutes().toString().padStart(2, '0') +
    ':' +
    tm.getSeconds().toString().padStart(2, '0');
  if (entryData && entryData.action && entryData.batch) {
    const sp = entryData.species || '';
    const bagLabel = entryData.bag || entryData.batch;
    const locStr =
      entryData.action === 'MOVE'
        ? entryData.from + ' → ' + entryData.to
        : entryData.action === 'ADD'
          ? '→ ' + entryData.to
          : entryData.action === 'REMOVE'
            ? '✕ ' + (entryData.from || '')
            : entryData.action === 'HARVEST'
              ? entryData.grams
                ? entryData.grams + 'g (Flush ' + (entryData.flush || 1) + ')'
                : ''
              : '';
    // Harvest entries are not undoable via the scan-log endpoint (harvests live in a separate table)
    const canUndo = entryData.action !== 'HARVEST';
    el.innerHTML =
      '<span class="sle-time">' +
      timeStr +
      '</span>' +
      '<span class="badge b-' +
      esc(entryData.action.toLowerCase()) +
      '">' +
      esc(entryData.action) +
      '</span> ' +
      '<span class="sle-msg"><b>' +
      esc(bagLabel) +
      '</b>' +
      (sp ? ' <span style="color:var(--c-text-muted);font-size:10px">' + esc(sp) + '</span>' : '') +
      (locStr ? ' <span style="color:var(--c-text-muted)">' + esc(locStr) + '</span>' : '') +
      '</span>' +
      (canUndo ? '<button class="sle-undo" onclick="undoScanEntry(this)" title="Undo">↩</button>' : '');
  } else {
    el.innerHTML = '<span class="sle-time">' + timeStr + '</span><span class="sle-msg">' + esc(msg) + '</span>';
  }
  log.prepend(el);
  while (log.children.length > 80) log.lastChild.remove();
}
let _toastTimer = null;
let _camHudToastTimer = null;
function setFb(type, msg, opts) {
  const entryData = opts && opts._tempId ? opts : null;
  // When camera is active, show feedback on camera HUD instead of scan overlay
  if (_camScanner && (!opts || !opts.noModal)) {
    _showCamHudToast(type, msg);
    updateCamHud();
  } else {
    if (!opts || !opts.noModal) openScanModal();
  }
  // Always update scan overlay toast + log (for when user opens it later)
  const el = document.getElementById('scan-toast');
  el.className = 'scan-toast-inline fb-' + type;
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('visible'));
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('visible'), type === 'err' ? 4000 : 3000);
  if (type === 'err') sessionErrors++;
  if (type === 'ok') {
    _scanBeepOk();
    _flashScanBg('ok');
    if (typeof switchScanTab === 'function') switchScanTab('current');
  } else if (type === 'err') {
    _scanBeepErr();
    _flashScanBg('err');
    if (typeof switchScanTab === 'function') switchScanTab('current');
  }
  _addLogEntry(type, msg, entryData);
  if (type === 'ok' && typeof renderScanSuccesses === 'function') renderScanSuccesses();
}
function _showCamHudToast(type, msg) {
  const el = document.getElementById('cam-hud-toast');
  el.className = 'cam-hud-toast ht-' + type;
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('visible'));
  clearTimeout(_camHudToastTimer);
  _camHudToastTimer = setTimeout(() => el.classList.remove('visible'), type === 'err' ? 4000 : 3000);
}
function updateCamHud() {
  document.getElementById('ch-action').textContent = scan.action || '—';
  document.getElementById('ch-from').textContent = scan.from || '—';
  document.getElementById('ch-to').textContent = scan.to || '—';
  document.getElementById('ch-count').textContent = scan.count;
  // Action chip color
  const actionChip = document.getElementById('cam-chip-action');
  actionChip.className = 'cam-chip' + (scan.action ? ' ch-set ch-' + scan.action.toLowerCase() : '');
  // Show/hide from/arrow chips based on action
  const fromChip = document.getElementById('cam-chip-from');
  const arrowChip = document.getElementById('cam-chip-arrow');
  const toChip = document.getElementById('cam-chip-to');
  // MOVE no longer needs FROM — FROM is auto-derived per bag
  fromChip.style.display = 'none';
  arrowChip.style.display = 'none';
  // MOVE_BATCH needs a destination too, so show the chip for it as well —
  // otherwise the HUD hides the one field the worker still has to fill (and
  // with it the tap target that opens the destination picker).
  const wantsTo = scan.action === 'ADD' || scan.action === 'MOVE' || scan.action === 'MOVE_BATCH';
  toChip.className = 'cam-chip' + (wantsTo && scan.to ? ' ch-set' : '');
  toChip.style.display = wantsTo ? '' : 'none';
  const toPulse = wantsTo && !scan.to;
  toChip.classList.toggle('ch-pulse', toPulse);
  // Count chip highlight
  const countChip = document.getElementById('cam-chip-count');
  countChip.className = 'cam-chip' + (scan.count > 0 ? ' ch-set' : '');
}
function updateSD() {
  document.getElementById('s-action').textContent = scan.action || '—';
  document.getElementById('s-from').textContent = scan.from || '—';
  document.getElementById('s-to').textContent = scan.to || '—';
  document.getElementById('s-count').textContent = scan.count;
  // Action-colored header
  const modal = document.getElementById('scan-modal');
  modal.className = 'scan-modal' + (scan.action ? ' scan-action-' + scan.action.toLowerCase() : '');
  // MOVE: hide FROM chip — FROM is auto-derived per bag
  const fromChip = document.getElementById('chip-from');
  fromChip.style.display = scan.action === 'MOVE' || scan.action === 'MOVE_BATCH' ? 'none' : '';
  // Chip pulse hints
  const chipTo = document.getElementById('chip-to');
  const toPulse =
    (scan.action === 'ADD' && !scan.to) ||
    (scan.action === 'MOVE' && !scan.to) ||
    (scan.action === 'MOVE_BATCH' && !scan.to);
  chipTo.classList.toggle('chip-pulse', toPulse);
  // Last scan chip
  const lastChip = document.getElementById('chip-last');
  if (_lastScanVal) {
    lastChip.style.display = '';
    document.getElementById('s-last').textContent = _lastScanVal;
  }
  // Count bump animation
  const countChip = document.getElementById('chip-count');
  countChip.classList.remove('count-bump');
  void countChip.offsetWidth;
  if (scan.count > 0) countChip.classList.add('count-bump');
  // Session end button
  document.getElementById('btn-end-session').style.display = sessionEntries.length > 0 ? '' : 'none';
  // Also sync camera HUD if it exists
  updateCamHud();
}
// Tap the To chip (scan modal or camera HUD) to set the destination by hand.
// Normally it comes from scanning a location barcode, but a shelf label can be
// missing, damaged or out of reach — this opens the same zone picker the other
// move flows use, so the scanner is no longer barcode-only. Mirrors what
// scanning a location does: sets the target for ADD/MOVE/MOVE_BATCH, and with
// no action chosen yet it starts a MOVE to that destination.
function scanPickDestination() {
  const act = scan.action;
  if (act && act !== 'ADD' && act !== 'MOVE' && act !== 'MOVE_BATCH') return;
  _openZonePicker(t('scan.pickDest'), function (dest) {
    if (!scan.action) {
      scan.action = 'MOVE';
      scan.from = null;
      scan.harvestBag = null;
      _pendingDupe = null;
      _pendingRemove = null;
      clearTimeout(_pendingDupeTimer);
      clearTimeout(_pendingRemoveTimer);
    }
    scan.to = dest;
    updateSD();
    setFb('ok', t('scanFb.to', { loc: dest }));
  });
}
function resetScan() {
  scan = { action: null, from: null, to: null, count: scan.count, harvestBag: null };
  document.getElementById('harvest-panel').style.display = 'none';
  _pendingDupe = null;
  _pendingRemove = null;
  clearTimeout(_pendingDupeTimer);
  clearTimeout(_pendingRemoveTimer);
  updateSD();
  setFb('info', t('scanFb.setAction'));
}
// Undo a single scan entry by clicking the ↩ button
function undoScanEntry(btn) {
  const row = btn.closest('.scan-log-entry');
  const tempId = row ? row.getAttribute('data-scan-id') : null;
  if (!tempId) return;
  const idx = sessionEntries.findIndex((e) => e._tempId === tempId);
  if (idx === -1) return;
  const entry = sessionEntries[idx];
  // Remove from scanLog + movements
  const si = scanLog.findIndex((e) => e._tempId === tempId);
  if (si !== -1) scanLog.splice(si, 1);
  const mi = movements.findIndex((e) => e._tempId === tempId);
  if (mi !== -1) movements.splice(mi, 1);
  sessionEntries.splice(idx, 1);
  // Delete from server
  if (entry._serverId) apiDelete('/api/scan-log/' + entry._serverId);
  // _queued: the SW holds it offline, so there is no server row to DELETE and
  // none is coming until replay — pull it out of the queue instead.
  else if (entry._queued && dropQueuedScanEntry(entry)) entry._queued = false;
  else entry._undoPending = true; // POST not resolved yet — delete once its id arrives
  // Remove DOM row
  if (row) row.remove();
  scan.count = Math.max(0, scan.count - 1);
  _scanBeep(400, 100);
  setFb('info', 'Undo: ' + entry.action + ' ' + (entry.bag || entry.batch));
  updateSD();
  renderStatus();
  if (typeof renderScanSuccesses === 'function') renderScanSuccesses();
}
// Ctrl+Z undo support
let _ctrlZPending = false;
let _ctrlZTimer = null;
document.addEventListener('keydown', function (e) {
  if (!document.getElementById('scan-overlay').classList.contains('open')) return;
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    if (sessionEntries.length === 0) {
      setFb('info', 'Nichts zum Rückgängig machen');
      return;
    }
    if (!_ctrlZPending) {
      _ctrlZPending = true;
      setFb('info', 'Ctrl+Z nochmal drücken zum Bestätigen');
      _ctrlZTimer = setTimeout(() => {
        _ctrlZPending = false;
      }, 2000);
      return;
    }
    _ctrlZPending = false;
    clearTimeout(_ctrlZTimer);
    // Walk backwards to find the most recent undoable entry (skip HARVEST)
    let lastUndoable = null;
    for (let i = sessionEntries.length - 1; i >= 0; i--) {
      if (sessionEntries[i].action !== 'HARVEST') {
        lastUndoable = sessionEntries[i];
        break;
      }
    }
    if (!lastUndoable) {
      setFb('info', 'Keine Scans zum Rückgängig machen');
      return;
    }
    const btn = document.querySelector('[data-scan-id="' + lastUndoable._tempId + '"] .sle-undo');
    if (btn) undoScanEntry(btn);
  }
});
// End session → show summary
function endScanSession() {
  if (sessionEntries.length === 0) return;
  // Summary lives in the "current" tab panel — make sure it's visible
  if (typeof switchScanTab === 'function') switchScanTab('current');
  const sumEl = document.getElementById('scan-session-summary');
  // Hide log, show summary
  document.getElementById('scan-modal-log').style.display = 'none';
  document.getElementById('scan-toast').style.display = 'none';
  sumEl.style.display = 'block';
  const dur = sessionStartTime ? Math.round((Date.now() - sessionStartTime) / 60000) : 0;
  const startStr = sessionStartTime
    ? new Date(sessionStartTime).toLocaleTimeString('de', { hour: '2-digit', minute: '2-digit' })
    : '';
  const endStr = new Date().toLocaleTimeString('de', { hour: '2-digit', minute: '2-digit' });
  // Count by action
  const counts = { ADD: 0, MOVE: 0, REMOVE: 0, HARVEST: 0 };
  const touchedBatches = new Map();
  sessionEntries.forEach((e) => {
    if (counts[e.action] !== undefined) counts[e.action]++;
    if (e.batch && !touchedBatches.has(e.batch)) touchedBatches.set(e.batch, e.species || '');
  });
  // Location summary
  const locSummary = [];
  if (counts.ADD > 0) {
    const locs = {};
    sessionEntries
      .filter((e) => e.action === 'ADD')
      .forEach((e) => {
        locs[e.to] = (locs[e.to] || 0) + 1;
      });
    Object.entries(locs).forEach(([l, n]) => locSummary.push(n + ' Bags → ' + esc(l)));
  }
  if (counts.MOVE > 0) {
    const moves = {};
    sessionEntries
      .filter((e) => e.action === 'MOVE')
      .forEach((e) => {
        const k = esc(e.from) + ' → ' + esc(e.to);
        moves[k] = (moves[k] || 0) + 1;
      });
    Object.entries(moves).forEach(([k, n]) => locSummary.push(n + ' Bags ' + k));
  }
  let batchHtml = '';
  touchedBatches.forEach((sp, bid) => {
    batchHtml += '<span>' + esc(bid) + (sp ? ' (' + esc(sp) + ')' : '') + '</span>';
  });
  sumEl.innerHTML =
    '<h3>' +
    t('scan.sessionSummary') +
    '</h3>' +
    '<div class="scan-summary-grid">' +
    '<div class="scan-summary-stat"><div class="ss-num">' +
    scan.count +
    '</div><div class="ss-lbl">' +
    t('scan.totalCount') +
    '</div></div>' +
    (counts.ADD
      ? '<div class="scan-summary-stat" style="border-top:3px solid #86efac"><div class="ss-num">' +
        counts.ADD +
        '</div><div class="ss-lbl">ADD</div></div>'
      : '') +
    (counts.MOVE
      ? '<div class="scan-summary-stat" style="border-top:3px solid #93c5fd"><div class="ss-num">' +
        counts.MOVE +
        '</div><div class="ss-lbl">MOVE</div></div>'
      : '') +
    (counts.REMOVE
      ? '<div class="scan-summary-stat" style="border-top:3px solid #fca5a5"><div class="ss-num">' +
        counts.REMOVE +
        '</div><div class="ss-lbl">REMOVE</div></div>'
      : '') +
    (counts.HARVEST
      ? '<div class="scan-summary-stat" style="border-top:3px solid #fcd34d"><div class="ss-num">' +
        counts.HARVEST +
        '</div><div class="ss-lbl">HARVEST</div></div>'
      : '') +
    (sessionErrors
      ? '<div class="scan-summary-stat" style="border-top:3px solid #fca5a5"><div class="ss-num">' +
        sessionErrors +
        '</div><div class="ss-lbl">' +
        t('scan.sessionErrors') +
        '</div></div>'
      : '') +
    '</div>' +
    '<div style="font-size:12px;color:var(--c-text-muted);margin-bottom:8px">' +
    t('scan.duration') +
    ': ' +
    dur +
    ' Min' +
    (startStr ? ' (' + startStr + ' – ' + endStr + ')' : '') +
    '</div>' +
    (batchHtml ? '<div class="scan-summary-batches">' + t('scan.batches') + ': ' + batchHtml + '</div>' : '') +
    (locSummary.length ? '<div style="font-size:12px;margin-bottom:12px">' + locSummary.join(' · ') + '</div>' : '') +
    '<div class="scan-summary-actions">' +
    '<button class="btn-xs" onclick="closeScanSession()">' +
    t('scan.close') +
    '</button>' +
    '<button class="btn-xs green" onclick="newScanSession()">' +
    t('scan.newSession') +
    '</button>' +
    '</div>';
}
function closeScanSession() {
  document.getElementById('scan-session-summary').style.display = 'none';
  document.getElementById('scan-modal-log').style.display = '';
  document.getElementById('scan-toast').style.display = '';
  closeScanModal();
}
function newScanSession() {
  document.getElementById('scan-session-summary').style.display = 'none';
  document.getElementById('scan-modal-log').style.display = '';
  document.getElementById('scan-toast').style.display = '';
  document.getElementById('scan-modal-log').innerHTML = '';
  sessionEntries = [];
  sessionStartTime = null;
  sessionErrors = 0;
  _lastScanVal = null;
  scan.count = 0;
  if (typeof renderScanSuccesses === 'function') renderScanSuccesses();
  resetScan();
}
let _scanTempIdCounter = 0;

// I-12: handle a 409 zone_mismatch response from POST /api/scan-log. The server
// rejected the MOVE because another user moved the bag while this client's
// view was stale (typical flow: offline scan that replayed after the bag was
// moved by someone else online). We discard the local in-memory entry and
// surface a toast so the user knows their MOVE didn't apply.
function handleZoneMismatch(r, entries) {
  if (!r || r.error !== 'zone_mismatch') return false;
  const list = Array.isArray(entries) ? entries : [entries];
  // The server rejects the ENTIRE POST on a single conflict, so none of these
  // entries persisted. Drop them all from local state — not just the offending
  // bag — or the other N-1 entries of a bulk move linger as phantom moves on
  // the dashboard until the next resync silently reverts them.
  for (const e of list) {
    if (!e) continue;
    const i = scanLog.lastIndexOf(e);
    if (i >= 0) scanLog.splice(i, 1);
    const j = movements.lastIndexOf(e);
    if (j >= 0) movements.splice(j, 1);
  }
  const cur = r.current_zone ? zoneDisplayName(r.current_zone) : 'unbekannt';
  const msg = `MOVE rejected: bag ${r.bag} was moved by another user. Current zone: ${cur}`;
  if (typeof setFb === 'function') setFb('err', msg);
  if (typeof renderStatus === 'function') renderStatus();
  if (typeof updateSD === 'function') updateSD();
  return true;
}

// I-11: idempotency key for scan-log POSTs. The offline queue (sw.js) replays
// queued POSTs verbatim; without a stable per-entry key, a network partition
// that times out on the client but succeeds on the server would leave the
// entry queued and replay it next time, creating a duplicate. The server
// upserts on client_uuid (UNIQUE INDEX), so retries are safe.
// crypto.randomUUID is available in all modern browsers and Node 16+; the
// fallback covers very old browsers (no offline support there anyway).
function newScanUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: 16 random bytes formatted as UUID v4. Not cryptographically
  // strong, but the only consumer is the unique index; sufficient for dedup.
  const r = Math.random;
  const hex = (n) =>
    Math.floor(r() * 16 ** n)
      .toString(16)
      .padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(r() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

function processScan(raw) {
  // Underscore/hyphen convention:
  // - Location barcodes use UNDERSCORES (e.g. INC_BUERO_01, SPAWN_R1) — kept as-is
  // - Action commands use UNDERSCORES — kept as-is
  // - Bag/batch IDs use HYPHENS internally (e.g. BLUES-260327-01-06)
  // German HID barcode scanners send underscores for hyphens, so we convert
  // only for non-location, non-action values. Adding new location formats that
  // use hyphens would break this logic — always use underscores for locations.
  let val = raw.trim().toUpperCase();
  if (!val) return;

  // ── Numeric barcode lookup (new system: 7+ digit numbers) ──
  const numVal = parseInt(val, 10);
  if (/^\d{7,}$/.test(val) && numVal >= 1000000) {
    const entry = barcodeRegistry.get(numVal);
    if (!entry) {
      setFb('err', 'Unbekannter Barcode: ' + val);
      return;
    }
    if (entry.type === 'bag') {
      val = entry.id; // e.g. "SHI-260327-01-06"
      setFb('info', t('scanFb.matched', { val: val, batch: val.split('-').slice(0, -1).join('-') }));
    } else if (entry.type === 'culture') {
      val = entry.id; // e.g. "MC-SHI-260327-01"
    } else if (entry.type === 'zone' || entry.type === 'rack') {
      val = entry.id; // e.g. "INC" or "INC_R1"
    }
  } else {
    // ── Legacy barcode fallback ──
    if (ACTIONS.includes(val) || LOCS.includes(val)) {
      /* keep underscores */
    } else {
      val = val.replace(/_/g, '-');
    } // German HID keyboard fix for bag IDs
    // Decode barcode → full bag ID.
    // Current format: KUERZEL_MMDD_N → 3 parts after underscore→hyphen conversion.
    // Legacy format:  SP_ST_MMDD_N  → 4 parts (old hardcoded spAbbrev + strain prefix).
    const parts = val.split('-');
    let matchBatch = null,
      scannedBag = '';
    if (parts.length === 3 && /^\d{4}$/.test(parts[1]) && /^\d{1,2}$/.test(parts[2])) {
      const scannedKz = parts[0];
      const scannedMmdd = parts[1];
      scannedBag = parts[2].padStart(2, '0');
      matchBatch = batches.find((b) => {
        const bKz = (b.strainKuerzel || b.strain || '').toUpperCase();
        const bDateParts = b.batchId.split('-');
        const bMmdd = bDateParts[1] ? bDateParts[1].slice(2, 4) + bDateParts[1].slice(0, 2) : '';
        return bKz === scannedKz && bMmdd === scannedMmdd;
      });
    } else if (parts.length === 4 && /^\d{4}$/.test(parts[2]) && /^\d{1,2}$/.test(parts[3])) {
      const scannedSp = parts[0];
      const scannedSt = parts[1];
      const scannedMmdd = parts[2];
      scannedBag = parts[3].padStart(2, '0');
      matchBatch = batches.find((b) => {
        const bSp = spAbbrev(b.species);
        const bSt = (b.strain || '000').slice(0, 3).toUpperCase();
        const bDateParts = b.batchId.split('-');
        const bMmdd = bDateParts[1] ? bDateParts[1].slice(2, 4) + bDateParts[1].slice(0, 2) : '';
        return bSp === scannedSp && bSt === scannedSt && bMmdd === scannedMmdd;
      });
    }
    if (
      (parts.length === 3 && /^\d{4}$/.test(parts[1]) && /^\d{1,2}$/.test(parts[2])) ||
      (parts.length === 4 && /^\d{4}$/.test(parts[2]) && /^\d{1,2}$/.test(parts[3]))
    ) {
      if (matchBatch) {
        val = matchBatch.batchId + '-' + scannedBag;
        setFb('info', t('scanFb.matched', { val: val, batch: matchBatch.batchId }));
      } else {
        setFb('err', t('scanFb.noBatchFound', { val: val }));
        return;
      }
    }
  }
  if (ACTIONS.includes(val)) {
    const keepTo = val === scan.action && scan.to;
    scan.action = val;
    scan.from = null;
    scan.to = keepTo ? scan.to : null;
    scan.harvestBag = null;
    document.getElementById('harvest-panel').style.display = 'none';
    _pendingDupe = null;
    _pendingRemove = null;
    clearTimeout(_pendingDupeTimer);
    clearTimeout(_pendingRemoveTimer);
    updateSD();
    setFb(
      'ok',
      {
        ADD: t('scanFb.actionAdd'),
        MOVE: t('scanFb.actionMove'),
        MOVE_BATCH: 'MOVE BATCH — Ziel scannen',
        REMOVE: t('scanFb.actionRemove'),
        HARVEST: t('scanFb.actionHarvest'),
        CONTAM: t('scanFb.actionContam')
      }[val]
    );
    return;
  }
  if (LOCS.includes(val)) {
    // Warn if scanning a zone that has racks — suggest using a rack instead
    const zoneObj = zones.find((z) => z.id === val);
    const isZoneWithRacks = zoneObj && zoneObj.racks.length > 0;
    if (scan.action === 'ADD') {
      scan.to = val;
      updateSD();
      setFb(
        isZoneWithRacks ? 'warn' : 'ok',
        isZoneWithRacks
          ? t('scanFb.preferRack', { loc: val, example: zoneObj.racks[0].id })
          : t('scanFb.location', { loc: val })
      );
      return;
    }
    if ((scan.action === 'MOVE' || scan.action === 'MOVE_BATCH') && !scan.to) {
      scan.to = val;
      updateSD();
      setFb(
        isZoneWithRacks ? 'warn' : 'ok',
        isZoneWithRacks
          ? t('scanFb.preferRack', { loc: val, example: zoneObj.racks[0].id })
          : t('scanFb.to', { loc: val })
      );
      return;
    }
    // No action set? Auto-set to MOVE with this location as destination
    if (!scan.action) {
      scan.action = 'MOVE';
      scan.to = val;
      scan.from = null;
      scan.harvestBag = null;
      _pendingDupe = null;
      _pendingRemove = null;
      clearTimeout(_pendingDupeTimer);
      clearTimeout(_pendingRemoveTimer);
      updateSD();
      setFb(
        isZoneWithRacks ? 'warn' : 'ok',
        isZoneWithRacks
          ? t('scanFb.preferRack', { loc: val, example: zoneObj.racks[0].id })
          : 'MOVE → ' + val + ' — jetzt Bags scannen'
      );
      return;
    }
    setFb('err', t('scanFb.setAction'));
    return;
  }
  // Culture ID scan → auto-fill parent (lab work) or source (new batch), else open lineage
  if (/^(MC|PD|LC|G2G|GS)-[A-Z0-9]+-\d{6}-\d{2}$/.test(val)) {
    // Lab stocktake: a scan means "this culture is on the shelf in front of me",
    // so it ticks the check list rather than running the normal culture flow.
    // Checked before the used/contam guard below — finding a written-off culture
    // is exactly the correction the check exists to make.
    if (_zcScanMode && _zcMode === 'culture') {
      labCheckScanned(val);
      return;
    }
    // Quick dialog asked for a source culture: take it there instead of opening
    // the lineage view. Refused if it is not a type this dialog state accepts.
    if (_inocScanPrefix) {
      const hit = cultures.find((x) => x.id.toUpperCase() === val);
      if (!hit) {
        _scanBeep(300, 150);
        setFb('err', t('scanFb.unknown', { val }));
        return;
      }
      if (hit.status === 'used' || hit.status === 'contam') {
        _scanBeep(300, 150);
        setFb('err', t('scanFb.cultureNotUsable', { id: hit.id, status: hit.status }));
        return;
      }
      const addErr = inocAdd(hit.id);
      if (addErr) {
        _scanBeep(300, 150);
        setFb('err', addErr);
        return;
      }
      inocRender(_inocScanPrefix);
      _scanBeep(800, 60);
      setFb('ok', t('scanFb.cultureAutofilled', { id: hit.id }));
      closeCamScan();
      return;
    }
    const c = cultures.find((x) => x.id.toUpperCase() === val);
    if (c) {
      if (c.status === 'used' || c.status === 'contam') {
        setFb('err', t('scanFb.cultureNotUsable', { id: c.id, status: c.status }));
        return;
      }
      closeCamScan();
      // If new-batch form is visible, auto-fill source + strain
      const nbPanel = document.getElementById('sp-batch-new');
      if (nbPanel && nbPanel.classList.contains('active')) {
        const cultureSel = document.getElementById('nb-culture');
        if (cultureSel) cultureSel.value = c.id;
        if (c.strainId) document.getElementById('nb-strain-sel').value = String(c.strainId);
        const nbStInput = document.getElementById('nb-strain-text');
        if (nbStInput && c.strainText) nbStInput.value = c.strainText;
        renderNbGrainBanner();
        setFb('ok', t('scanFb.cultureAutofilled', { id: c.id }));
        return;
      }
      // If lab work form is visible, auto-fill parent instead of opening lineage
      const lwPanel = document.getElementById('sp-lab-work');
      const parentSel = document.getElementById('lw-parent');
      const parentRow = document.getElementById('lw-parent-row');
      if (lwPanel && lwPanel.classList.contains('active') && parentRow && parentRow.style.display !== 'none') {
        parentSel.value = c.id;
        if (c.strainId) document.getElementById('lw-st').value = String(c.strainId);
        const stInput = document.getElementById('lw-strain-text');
        if (stInput && c.strainText) stInput.value = c.strainText;
        lwPreview();
        setFb('ok', 'Parent gesetzt: ' + c.id);
        return;
      }
      go('lab', 'n-lab');
      openStab('lab', 'lineage');
      setTimeout(() => {
        document.getElementById('lineage-sel').value = 'C:' + c.id;
        renderLineage();
      }, 100);
      setFb('ok', t('scanFb.cultureScanned', { val: val }));
      return;
    }
  }
  const isBag = /-\d{2}$/.test(val);
  const batchId = isBag ? val.split('-').slice(0, -1).join('-') : val;
  const batch = batches.find((b) => b.batchId.toUpperCase() === batchId.toUpperCase());
  // When the bag-select modal is open and we scan a bag, toggle it in the selection
  // instead of opening a new bag-info modal.
  if (
    isBag &&
    bsBatchId &&
    document.getElementById('m-bagselect').classList.contains('open') &&
    batchId.toUpperCase() === bsBatchId.toUpperCase()
  ) {
    const res = bsToggleBag(val);
    if (res.toggled) {
      _scanBeep(800, 60);
      setFb(
        'ok',
        t('bagSelect.toggled', { bag: val, action: res.added ? t('bagSelect.added') : t('bagSelect.removed') })
      );
    } else {
      _scanBeep(300, 150);
      setFb('err', t('scanFb.bagNotPlaced', { bag: val }));
    }
    return;
  }
  // Scan belongs to a different batch while the select modal is open: warn.
  if (
    isBag &&
    bsBatchId &&
    document.getElementById('m-bagselect').classList.contains('open') &&
    batchId.toUpperCase() !== bsBatchId.toUpperCase()
  ) {
    _scanBeep(300, 150);
    setFb('err', t('bagSelect.notInBatch', { bag: val, id: bsBatchId }));
    return;
  }
  if (batch || isBag) {
    // Stocktake: a scan means "this bag is physically in front of me", so it
    // ticks off the check list instead of running the normal action flow.
    if (_zcScanMode && isBag) {
      zoneCheckScanned(val, batchId);
      return;
    }
    // A "Beimpft mit" field has the camera: the worker is naming the grain bag
    // they inoculated from, not asking about the bag. Only with no action armed,
    // so an explicit MOVE/REMOVE still wins. Closing the camera is what brings
    // the quick dialog back into view (it steps aside for the camera).
    if (isBag && !scan.action && _inocScanPrefix) {
      const err = inocAdd(val);
      if (err) {
        _scanBeep(300, 150);
        setFb('err', err);
        return;
      }
      inocRender(_inocScanPrefix);
      _scanBeep(800, 60);
      setFb('ok', t('inoc.added', { id: val }));
      closeCamScan();
      return;
    }
    if (!scan.action) {
      openBagInfo(val, batchId, batch);
      return;
    }
    if (scan.action === 'HARVEST') {
      showHarvestPanel(isBag ? val : batchId, batchId);
      return;
    }
    if (scan.action === 'CONTAM') {
      // Stay in CONTAM mode after the modal opens — workers reporting a row of
      // contaminated bags can keep scanning without re-arming the action.
      openContamReport(isBag ? val : null, batchId, null);
      return;
    }
    if (scan.action === 'ADD' && !scan.to) {
      setFb('err', t('scanFb.scanLocFirst'));
      return;
    }
    if ((scan.action === 'MOVE' || scan.action === 'MOVE_BATCH') && !scan.to) {
      setFb('err', t('scanFb.scanToFirst'));
      return;
    }
    // MOVE_BATCH: scan any bag or batch ID → move entire batch
    if (scan.action === 'MOVE_BATCH' && batch) {
      moveBatchTo(batch, scan.to, function (moved, skipped) {
        if (!moved) {
          _scanBeep(500, 120);
          setFb(
            'err',
            'Batch ' +
              batch.batchId +
              ': keine Bags zum Verschieben' +
              (skipped ? ' (' + skipped + ' bereits in ' + scan.to + ')' : '')
          );
          updateSD();
          return;
        }
        setFb(
          'ok',
          'MOVE BATCH ' +
            batch.batchId +
            ': ' +
            moved +
            ' Bags → ' +
            scan.to +
            (skipped ? ' (' + skipped + ' übersprungen)' : '')
        );
        scan.count += moved;
        updateSD();
      });
      return;
    }
    // MOVE: auto-derive FROM from bag's last known location
    if (scan.action === 'MOVE') {
      const bagLast = [...scanLog]
        .reverse()
        .find(
          (e) =>
            (e.bag || '').toUpperCase() === val.toUpperCase() &&
            (e.action === 'ADD' || e.action === 'MOVE' || e.action === 'REMOVE')
        );
      if (!bagLast) {
        _scanBeep(300, 150);
        setFb('err', t('scanFb.bagNotPlaced', { bag: val }));
        return;
      }
      if (bagLast.action === 'REMOVE') {
        _scanBeep(300, 150);
        setFb('err', t('scanFb.bagRemoved', { bag: val }));
        return;
      }
      const curLoc = bagLast.to || null;
      if (curLoc && curLoc.toUpperCase() === scan.to.toUpperCase()) {
        _scanBeep(500, 120);
        setFb('err', t('scanFb.bagAlreadyAt', { bag: val, loc: scan.to }));
        return;
      }
      scan.from = curLoc;
    }
    // REMOVE: auto-derive FROM from bag's last known location
    if (scan.action === 'REMOVE') {
      const bagLastR = [...scanLog]
        .reverse()
        .find((e) => (e.bag || '').toUpperCase() === val.toUpperCase() && (e.action === 'ADD' || e.action === 'MOVE'));
      scan.from = bagLastR ? bagLastR.to : null;
    }
    // REMOVE confirmation: require scanning same bag twice within 5s
    if (scan.action === 'REMOVE') {
      if (_pendingRemove && _pendingRemove.val === val) {
        clearTimeout(_pendingRemoveTimer);
        _pendingRemove = null;
        // Confirmed — fall through to log it
      } else {
        _pendingRemove = { val };
        clearTimeout(_pendingRemoveTimer);
        _pendingRemoveTimer = setTimeout(() => {
          _pendingRemove = null;
        }, 5000);
        _scanBeep(300, 150);
        setFb('err', 'REMOVE ' + val + '? Nochmal scannen zum Bestätigen.');
        return;
      }
    }
    // Duplicate detection: warn if same bag+action+to already in session
    const dupeKey = val + '|' + scan.action + '|' + scan.to;
    if (scan.action !== 'REMOVE') {
      const hasDupe = sessionEntries.some((e) => (e.bag || e.batch) + '|' + e.action + '|' + e.to === dupeKey);
      if (hasDupe) {
        if (_pendingDupe === dupeKey) {
          clearTimeout(_pendingDupeTimer);
          _pendingDupe = null;
          // Confirmed duplicate — fall through
        } else {
          _pendingDupe = dupeKey;
          clearTimeout(_pendingDupeTimer);
          _pendingDupeTimer = setTimeout(() => {
            _pendingDupe = null;
          }, 3000);
          _scanBeep(500, 120);
          setFb(
            'err',
            val +
              ' bereits gescannt als ' +
              scan.action +
              (scan.to ? ' → ' + scan.to : '') +
              '. Nochmal scannen zum Bestätigen.'
          );
          return;
        }
      }
    }
    const tempId = 's' + ++_scanTempIdCounter;
    const isMove = scan.action === 'MOVE' || scan.action === 'MOVE_BATCH';
    const entry = {
      time: new Date().toISOString(),
      action: scan.action,
      batch: batchId,
      bag: isBag ? val : null,
      from: scan.from,
      to: scan.to,
      species: batch?.species,
      strain: batch?.strain,
      user: currentUser?.username || null,
      client_uuid: newScanUuid(),
      // I-12: optimistic concurrency snapshot for offline-queue replays.
      // Only meaningful for MOVE/MOVE_BATCH (ADD has no expected zone).
      expected_current_zone: isMove && scan.from ? toZone(scan.from) : null,
      _tempId: tempId
    };
    scanLog.push(entry);
    movements.push(entry);
    if (!sessionStartTime) sessionStartTime = Date.now();
    sessionEntries.push(entry);
    if (scanChannel)
      scanChannel.postMessage({
        type: 'scan-entry',
        entry: { bag: entry.bag, batch: entry.batch, action: entry.action, to: entry.to }
      });
    scan.count++;
    // I-12 applies: on a zone_mismatch the server rejected the MOVE because the
    // bag has since been moved by someone else — postScanEntries drops the local
    // entry and toasts, without retrying into the same 409.
    postScanEntries([entry]);
    _lastScanVal = isBag ? val : batchId;
    const fbTo =
      scan.action === 'MOVE' && scan.from
        ? ' ' + scan.from + ' \u2192 ' + scan.to
        : scan.to
          ? ' \u2192 ' + scan.to
          : '';
    setFb('ok', t('scanFb.logged', { action: scan.action, val: val, to: fbTo, n: scan.count }), entry);
    updateSD();
    return;
  }
  // URL QR codes: inform user instead of showing "unknown"
  if (/^https?:\/\//i.test(raw.trim())) {
    setFb('info', 'QR-Code enthält URL: ' + raw.trim().slice(0, 80) + (raw.trim().length > 80 ? '…' : ''));
    return;
  }
  setFb('err', t('scanFb.unknown', { val: val }));
}
// ─── GLOBAL BARCODE BUFFER (timing-based scanner detection) ──
const _scanBuf = { chars: [], timer: null };
const SCAN_MAX_GAP = 50;
const SCAN_MIN_LEN = 3;

function isKnownBarcode(val) {
  val = val.toUpperCase();
  // Numeric barcode (new system)
  if (/^\d{7,}$/.test(val) && parseInt(val, 10) >= 1000000) return true;
  // Check actions/locations with underscores intact (barcode locations use underscores)
  if (ACTIONS.includes(val)) return true;
  if (LOCS.includes(val)) return true;
  // For bag/batch patterns, convert underscores to hyphens
  const h = val.replace(/_/g, '-');
  if (/^[A-Z]{2,6}-[A-Z]{2,6}-\d{4}-\d{1,2}$/.test(h)) return true;
  if (/^(MC|PD|LC)-[A-Z]+-\d{6}-\d{2}$/.test(h)) return true;
  if (/^[A-Z]+-\d{6}-\d{2}-\d{2}$/.test(h)) return true;
  if (/^[A-Z]+-\d{6}-\d{2}$/.test(h)) return true;
  return false;
}

function _flushScanBuf() {
  const raw = _scanBuf.chars.map((c) => c.ch).join('');
  _scanBuf.chars = [];
  if (raw.length < SCAN_MIN_LEN) return;
  const cleaned = raw.trim().toUpperCase();
  if (!isKnownBarcode(cleaned)) {
    setFb(
      'err',
      t('scanFb.unknownFormat', { val: cleaned }) || 'Unbekanntes Format: ' + cleaned + ' — Barcode prüfen.'
    );
    return;
  }
  processScan(raw);
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Ignore keystrokes while user is typing in form fields — prevents the scan buffer
  // from swallowing Enter on form submits or mis-firing on fast typing in search boxes.
  // The scan modal and camera modal are exceptions: keep the buffer active there.
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) {
    const scanOpen = document.getElementById('scan-overlay')?.classList.contains('open');
    const camOpen = document.getElementById('m-camscan')?.classList.contains('open');
    if (!scanOpen && !camOpen) {
      _scanBuf.chars = [];
      clearTimeout(_scanBuf.timer);
      return;
    }
  }
  const now = performance.now();
  if (e.key === 'Enter') {
    if (_scanBuf.chars.length >= SCAN_MIN_LEN) {
      clearTimeout(_scanBuf.timer);
      const allFast = _scanBuf.chars.every((c, i) => i === 0 || c.t - _scanBuf.chars[i - 1].t < SCAN_MAX_GAP);
      if (allFast) {
        e.preventDefault();
        e.stopPropagation();
        _flushScanBuf();
        return;
      }
    }
    _scanBuf.chars = [];
    clearTimeout(_scanBuf.timer);
    return;
  }
  if (e.key.length !== 1) return;
  if (_scanBuf.chars.length > 0 && now - _scanBuf.chars[_scanBuf.chars.length - 1].t > SCAN_MAX_GAP) {
    _scanBuf.chars = [];
  }
  _scanBuf.chars.push({ ch: e.key, t: now });
  clearTimeout(_scanBuf.timer);
  _scanBuf.timer = setTimeout(() => {
    _scanBuf.chars = [];
  }, SCAN_MAX_GAP * 2);
});

// ─── USER MANAGEMENT ─────────────────────────────────────────
async function doLogout() {
  try {
    await authFetch('/api/auth/logout', { method: 'POST' });
  } catch {}
  window.location.href = '/login.html';
}

async function loadUsersTab() {
  const c = document.getElementById('sp-settings-users');
  if (!c) return;
  const acct = document.getElementById('users-account');
  if (acct && currentUser)
    acct.innerHTML =
      t('users.loggedInAs', { user: esc(currentUser.username), role: esc(currentUser.role) }) +
      ` <button class="btn" style="font-size:11px;padding:2px 8px;margin-left:8px" onclick="showChangePasswordModal()">${t('chpw.title')}</button>`;
  if (!currentUser || currentUser.role !== 'admin') {
    const tbl = document.getElementById('users-table');
    if (tbl) tbl.innerHTML = '<p style="color:var(--c-text-muted)">' + t('users.adminRequiredManage') + '</p>';
    return;
  }
  try {
    const r = await authFetch('/api/users');
    const users = await r.json();
    const tbl = document.getElementById('users-table');
    if (!tbl) return;
    tbl.innerHTML =
      '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">Username</th><th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">Role</th><th style="text-align:center;padding:6px;border-bottom:1px solid var(--c-border)" title="Darf Labels kaufen + Versanddaten sehen">Versand</th><th style="text-align:center;padding:6px;border-bottom:1px solid var(--c-border)" title="Darf Ernte für den Verkauf freigeben — die Menge, die der Shop anbietet">Freigabe</th><th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">Created</th><th style="padding:6px;border-bottom:1px solid var(--c-border)"></th></tr></thead><tbody>' +
      users
        .map(
          (u) =>
            `<tr><td style="padding:6px">${esc(u.username)}</td><td style="padding:6px">${esc(u.role)}</td><td style="padding:6px;text-align:center">${u.role === 'admin' ? '<input type="checkbox" checked disabled title="Admins dürfen immer versenden">' : `<input type="checkbox" data-action="toggle-ship" data-user-id="${esc(u.id)}" ${u.can_ship ? 'checked' : ''}>`}</td><td style="padding:6px;text-align:center">${u.role === 'admin' ? '<input type="checkbox" checked disabled title="Admins dürfen immer freigeben">' : `<input type="checkbox" data-action="toggle-release" data-user-id="${esc(u.id)}" ${u.can_release ? 'checked' : ''}>`}</td><td style="padding:6px">${u.created ? fmtDt(u.created) : ''}</td><td style="padding:6px">${u.username !== currentUser.username ? `<button class="btn btn-r" style="font-size:11px;padding:2px 8px" data-action="delete-user" data-user-id="${esc(u.id)}">Delete</button>` : ''}</td></tr>`
        )
        .join('') +
      '</tbody></table>';
    tbl.onclick = onUsersTableClick;
  } catch (e) {
    console.error('Failed to load users:', e);
  }
}

function onUsersTableClick(e) {
  const ship = e.target.closest('input[data-action="toggle-ship"]');
  if (ship) {
    const sid = parseInt(ship.dataset.userId, 10);
    if (Number.isFinite(sid)) toggleUserShip(sid, ship.checked);
    return;
  }
  const rel = e.target.closest('input[data-action="toggle-release"]');
  if (rel) {
    const rid = parseInt(rel.dataset.userId, 10);
    if (Number.isFinite(rid)) toggleUserRelease(rid, rel.checked);
    return;
  }
  const btn = e.target.closest('button[data-action="delete-user"]');
  if (!btn) return;
  const id = parseInt(btn.dataset.userId, 10);
  if (Number.isFinite(id)) deleteUser(id);
}
// Grant/revoke the shipping capability for a non-admin user. Reloads to reflect
// the server's truth (and revert the checkbox if the PATCH failed).
async function toggleUserShip(id, canShip) {
  try {
    const r = await authFetch('/api/users/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canShip })
    });
    if (!r.ok) {
      const d = await r.json();
      alert(d.error || 'Failed');
    }
  } catch (e) {
    alert(e.message);
  }
  loadUsersTab();
}

// Grant/revoke the release capability. Same shape as toggleUserShip, and the
// reload matters for the same reason: the checkbox must end up showing what the
// server stored, not what was clicked.
async function toggleUserRelease(id, canRelease) {
  try {
    const r = await authFetch('/api/users/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canRelease })
    });
    if (!r.ok) {
      const d = await r.json();
      alert(d.error || 'Failed');
    }
  } catch (e) {
    alert(e.message);
  }
  loadUsersTab();
}

async function addUser() {
  const u = document.getElementById('new-username').value.trim();
  const p = document.getElementById('new-password').value;
  const role = document.getElementById('new-role').value;
  if (!u || !p) {
    alert(t('users.required'));
    return;
  }
  if (p.length < 8) {
    alert(t('users.minPw'));
    return;
  }
  try {
    const r = await authFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p, role })
    });
    if (!r.ok) {
      const d = await r.json();
      alert(d.error || 'Failed');
      return;
    }
    document.getElementById('new-username').value = '';
    document.getElementById('new-password').value = '';
    loadUsersTab();
  } catch (e) {
    alert(e.message);
  }
}

async function deleteUser(id) {
  if (!confirm(t('users.deleteConfirm'))) return;
  try {
    const r = await authFetch('/api/users/' + id, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json();
      alert(d.error || 'Failed');
      return;
    }
    loadUsersTab();
  } catch (e) {
    alert(e.message);
  }
}

function showChangePasswordModal() {
  const m = document.getElementById('change-pw-modal');
  if (m) {
    m.style.display = 'flex';
    document.getElementById('chpw-current').value = '';
    document.getElementById('chpw-new').value = '';
    document.getElementById('chpw-status').textContent = '';
    // Populate the hidden username companion so iOS Keychain knows which
    // credential entry this dialog is updating.
    const helper = document.getElementById('chpw-username-helper');
    if (helper && currentUser && currentUser.username) helper.value = currentUser.username;
  }
}
function hideChangePasswordModal() {
  const m = document.getElementById('change-pw-modal');
  if (m) m.style.display = 'none';
}
async function submitChangePassword() {
  const cur = document.getElementById('chpw-current').value;
  const nw = document.getElementById('chpw-new').value;
  const st = document.getElementById('chpw-status');
  if (!cur || !nw) {
    st.textContent = t('chpw.required');
    st.style.color = 'red';
    return;
  }
  if (nw.length < 8) {
    st.textContent = t('chpw.minLength');
    st.style.color = 'red';
    return;
  }
  try {
    const r = await authFetch('/api/auth/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: cur, newPassword: nw })
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      st.textContent = d.error || 'Failed';
      st.style.color = 'red';
      return;
    }
    st.textContent = t('chpw.success');
    st.style.color = 'green';
    setTimeout(() => hideChangePasswordModal(), 1500);
  } catch (e) {
    st.textContent = t('common.error') + ': ' + e.message;
    st.style.color = 'red';
  }
}

// ─── INIT ────────────────────────────────────────────────────
// Set initial language
// P-03: locale files are loaded on demand. The user's saved choice (or
// default 'de') is fetched up front; until it lands, translatePage() will
// no-op gracefully (`t()` falls back to the key when no locale is loaded).
// We translate again as soon as the locale resolves.
const _allowedLangs = ['en', 'de', 'pt'];
const savedLang = localStorage.getItem('mp-lang');
if (savedLang && _allowedLangs.indexOf(savedLang) !== -1) currentLang = savedLang;
document.getElementById('lang-sel').value = currentLang;
loadLang(currentLang)
  .then(() => translatePage())
  .catch((err) => console.error('Initial locale load failed:', err));

// ─── CALENDAR ───────────────────────────────────────────────
if (typeof calendarEvents === 'undefined') var calendarEvents = [];
if (typeof MS_PER_DAY === 'undefined') var MS_PER_DAY = 86400000;
let calYear = new Date().getFullYear(),
  calMonth = new Date().getMonth(),
  calView = 'month';
let calSelectedDate = new Date(),
  caldavImports = [];
function calDays() {
  return (t('cal.days') || 'Mo,Di,Mi,Do,Fr,Sa,So').split(',');
}
function calMonths() {
  return (
    t('cal.months') || 'Januar,Februar,März,April,Mai,Juni,Juli,August,September,Oktober,November,Dezember'
  ).split(',');
}
const CAL_HOURS_START = 6,
  CAL_HOURS_END = 22;

function fmtDate(y, m, d) {
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseDateStr(s) {
  const p = s.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function getBatchLoc(b, lastByBag) {
  const locs = {};
  // Caller (e.g. collectCalendarEvents) can pass in a pre-built map to avoid
  // O(N×M) when this is called per-batch in a loop.
  const map = lastByBag || buildLastScanByBag();
  b.bags.forEach((bag) => {
    const last = map.get(bag.toUpperCase());
    if (last && last.action !== 'REMOVE' && last.to) locs[last.to] = (locs[last.to] || 0) + 1;
  });
  const entries = Object.entries(locs);
  if (!entries.length) return '';
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}
function getCalendarRange() {
  // Window for expanding recurring events — covers any visible view with margin
  const y = calYear,
    m = calMonth;
  const start = new Date(y, m - 2, 1);
  const end = new Date(y, m + 3, 0);
  return { start, end };
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
// Add n months to `base`, clamping the day to the target month's last day
// (Jan 31 + 1 → Feb 28/29). MUST be computed from the original base each time,
// NOT cumulatively from the previous occurrence — setMonth overflows (Feb 31 →
// Mar 3), which both skips February and permanently shifts every later
// occurrence onto the 3rd.
function addMonthsClamped(base, n) {
  const m = base.getMonth() + n;
  const y = base.getFullYear() + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const day = Math.min(base.getDate(), new Date(y, tm + 1, 0).getDate());
  const r = new Date(base);
  r.setFullYear(y, tm, day);
  return r;
}
function expandRecurringEvent(ev) {
  const out = [];
  if (!ev.recurrence) {
    out.push(ev.startDate);
    return out;
  }
  const exceptions = new Set(Array.isArray(ev.exceptionDates) ? ev.exceptionDates : []);
  const { start: winStart, end: winEnd } = getCalendarRange();
  const base = parseDateStr(ev.startDate);
  const hardEnd = ev.recurrenceUntil ? parseDateStr(ev.recurrenceUntil) : null;
  let cur = new Date(base);
  let guard = 0;
  let monthIdx = 0;
  while (guard++ < 500) {
    if (hardEnd && cur > hardEnd) break;
    if (cur > winEnd) break;
    if (cur >= winStart || cur.getTime() === base.getTime()) {
      const ds = localDateStr(cur);
      if (!exceptions.has(ds)) out.push(ds);
    }
    if (ev.recurrence === 'daily') cur = addDays(cur, 1);
    else if (ev.recurrence === 'weekly') cur = addDays(cur, 7);
    else if (ev.recurrence === 'monthly') cur = addMonthsClamped(base, ++monthIdx);
    else break;
  }
  return out;
}
function expandRecurringTaskDates(task) {
  const out = [];
  const startStr = task.dueDate ? task.dueDate.split('T')[0] : null;
  if (!startStr) return out;
  if (!task.recurrence) {
    out.push(startStr);
    return out;
  }
  const { start: winStart, end: winEnd } = getCalendarRange();
  const base = parseDateStr(startStr);
  const hardEnd = task.recurrenceUntil ? parseDateStr(task.recurrenceUntil) : null;
  let cur = new Date(base);
  let guard = 0;
  let monthIdx = 0;
  while (guard++ < 500) {
    if (hardEnd && cur > hardEnd) break;
    if (cur > winEnd) break;
    if (cur >= winStart || cur.getTime() === base.getTime()) {
      out.push(localDateStr(cur));
    }
    if (task.recurrence === 'daily') cur = addDays(cur, 1);
    else if (task.recurrence === 'weekly') cur = addDays(cur, 7);
    else if (task.recurrence === 'monthly') cur = addMonthsClamped(base, ++monthIdx);
    else break;
  }
  return out;
}
function collectCalendarEvents() {
  const events = [];
  const lastByBag = buildLastScanByBag();
  batches.forEach((b) => {
    if (!b.due) return;
    const d = new Date(b.due);
    const loc = getBatchLoc(b, lastByBag);
    events.push({
      date: localDateStr(d),
      label: b.batchId + (loc ? ' — ' + loc : ''),
      type: 'batch-due',
      id: b.batchId,
      draggable: true,
      allDay: true,
      color: '#ef4444',
      species: b.species
    });
  });
  manualTasks.forEach((t) => {
    if (!t.dueDate) return;
    const dates = expandRecurringTaskDates(t);
    const hasTime = !!t.dueTime;
    dates.forEach((ds, idx) => {
      // Only the base occurrence is draggable; recurring instances are locked
      const isBase = idx === 0 && ds === t.dueDate.split('T')[0];
      events.push({
        date: ds,
        label: t.text,
        type: 'task-due',
        id: t.created,
        draggable: !t.done && !t.recurrence && isBase,
        allDay: !hasTime,
        startTime: hasTime ? t.dueTime : undefined,
        endTime: hasTime ? t.dueEndTime || undefined : undefined,
        color: '#3b82f6',
        recurrence: t.recurrence || null
      });
    });
  });
  harvests.forEach((h) => {
    if (!h.time) return;
    const d = new Date(h.time);
    events.push({
      date: localDateStr(d),
      label: (h.batch || '?') + ' ' + h.grams + 'g',
      type: 'harvest',
      id: null,
      draggable: false,
      allDay: true,
      color: '#f59e0b',
      species: h.species
    });
  });
  const filterName = document.getElementById('cal-filter-user')?.value || '';
  calendarEvents.forEach((ev) => {
    const teamList = Array.isArray(ev.teamAssignees) ? ev.teamAssignees : [];
    if (filterName && teamList.length && !teamList.includes(filterName)) return;
    const dates = expandRecurringEvent(ev);
    const displayAssignees = teamList.map((n) => ({ userId: 0, username: n }));
    dates.forEach((ds) => {
      events.push({
        date: ds,
        label: ev.title,
        type: 'custom',
        id: ev.id,
        draggable: !ev.recurrence,
        allDay: ev.allDay,
        startTime: ev.startTime,
        endTime: ev.endTime,
        color: CATEGORY_COLORS[ev.category] || ev.color || '#16a34a',
        description: ev.description,
        assignees: displayAssignees,
        recurrence: ev.recurrence || null
      });
    });
  });
  caldavImports.forEach((ev) => {
    events.push({
      date: ev.date,
      label: ev.summary,
      type: 'caldav-import',
      id: ev.uid,
      draggable: false,
      allDay: ev.allDay !== false,
      startTime: ev.startTime,
      endTime: ev.endTime,
      color: '#6366f1'
    });
  });
  return events;
}

function renderCalendar() {
  const title = document.getElementById('cal-title');
  if (!title) return;
  document.querySelectorAll('.cal-vbtn').forEach((b) => b.classList.remove('active'));
  const btn = document.getElementById('cv-' + calView);
  if (btn) btn.classList.add('active');
  if (calView === 'month') renderCalMonth();
  else if (calView === 'week') renderCalWeek();
  else if (calView === 'day') renderCalDay();
}

function setCalView(v) {
  calView = v;
  renderCalendar();
}
function calToday() {
  calYear = new Date().getFullYear();
  calMonth = new Date().getMonth();
  calSelectedDate = new Date();
  renderCalendar();
}

function calNav(delta) {
  if (calView === 'month') {
    calMonth += delta;
    if (calMonth < 0) {
      calMonth = 11;
      calYear--;
    }
    if (calMonth > 11) {
      calMonth = 0;
      calYear++;
    }
  } else if (calView === 'week') {
    calSelectedDate.setDate(calSelectedDate.getDate() + delta * 7);
    calYear = calSelectedDate.getFullYear();
    calMonth = calSelectedDate.getMonth();
  } else if (calView === 'day') {
    calSelectedDate.setDate(calSelectedDate.getDate() + delta);
    calYear = calSelectedDate.getFullYear();
    calMonth = calSelectedDate.getMonth();
  }
  renderCalendar();
}

function printCalendar() {
  const modal = document.getElementById('m-cal-print');
  if (!modal) return;
  modal.classList.add('open');
}
function closeCalPrintModal() {
  const m = document.getElementById('m-cal-print');
  if (m) m.classList.remove('open');
}

function printCalendarTaskList(range) {
  const sheet = document.getElementById('print-sheet');
  if (!sheet) return;

  const MONTHS = calMonths(),
    DAYS = calDays();

  // Determine date range — rolling window anchored on today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let startDate, endDate, rangeLabel;
  if (range === 'week') {
    startDate = new Date(today);
    endDate = new Date(today);
    endDate.setDate(today.getDate() + 6);
  } else {
    startDate = new Date(today);
    endDate = new Date(today);
    endDate.setDate(today.getDate() + 29);
  }
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const rangePrefix = range === 'week' ? t('cal.weekShort') : t('cal.monthShort');
  rangeLabel =
    rangePrefix +
    ': ' +
    startDate.getDate() +
    '. ' +
    MONTHS[startDate.getMonth()] +
    (sameYear ? '' : ' ' + startDate.getFullYear()) +
    ' – ' +
    endDate.getDate() +
    '. ' +
    MONTHS[endDate.getMonth()] +
    ' ' +
    endDate.getFullYear();

  // Collect and filter events in range
  const allEvents = collectCalendarEvents();
  const startStr = fmtDate(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endStr = fmtDate(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const eventsInRange = allEvents.filter((e) => e.date >= startStr && e.date <= endStr);

  // Group by date
  const byDate = {};
  eventsInRange.forEach((e) => {
    (byDate[e.date] = byDate[e.date] || []).push(e);
  });

  // Type label map
  const typeLabels = {
    'batch-due': t('cal.legend.batches'),
    'task-due': t('calDetail.taskDue'),
    harvest: t('cal.legend.harvests'),
    custom: t('calEntry.cat.custom'),
    'caldav-import': t('calDetail.external')
  };

  // Build day list
  const days = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const ds = fmtDate(d.getFullYear(), d.getMonth(), d.getDate());
    const dayName = DAYS[(d.getDay() + 6) % 7];
    const dayEvents = (byDate[ds] || []).slice().sort((a, b) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return (a.startTime || '').localeCompare(b.startTime || '');
    });
    days.push({ ds, dayName, date: new Date(d), events: dayEvents });
  }

  // Render HTML
  const todayStr = localDateStr(new Date());
  let bodyHtml = '';
  days.forEach((day) => {
    const isToday = day.ds === todayStr;
    bodyHtml += '<div class="cal-print-day' + (isToday ? ' today' : '') + '">';
    bodyHtml +=
      '<div class="cal-print-day-hdr">' +
      day.dayName +
      ', ' +
      day.date.getDate() +
      '. ' +
      MONTHS[day.date.getMonth()] +
      ' ' +
      day.date.getFullYear() +
      '</div>';
    if (day.events.length === 0) {
      bodyHtml += '<div class="cal-print-empty">— ' + t('cal.noTasks') + ' —</div>';
    } else {
      bodyHtml += '<ul class="cal-print-list">';
      day.events.forEach((e) => {
        const time = e.allDay ? t('cal.allDay') : (e.startTime || '') + (e.endTime ? ' – ' + e.endTime : '');
        const typeLbl = typeLabels[e.type] || '';
        const dotColor = safeColor(e.color || '#64748b');
        const assigneeStr =
          e.assignees && e.assignees.length
            ? ' <span class="cal-print-assignees">(' + e.assignees.map((a) => esc(a.username)).join(', ') + ')</span>'
            : '';
        const desc = e.description ? '<div class="cal-print-desc">' + esc(e.description) + '</div>' : '';
        bodyHtml +=
          '<li class="cal-print-item">' +
          '<span class="cal-print-dot" style="background:' +
          dotColor +
          '"></span>' +
          '<span class="cal-print-time">' +
          esc(time) +
          '</span>' +
          '<span class="cal-print-type">' +
          typeLbl +
          '</span>' +
          '<span class="cal-print-label">' +
          esc(e.label) +
          assigneeStr +
          desc +
          '</span>' +
          '</li>';
      });
      bodyHtml += '</ul>';
    }
    bodyHtml += '</div>';
  });

  const totalEvents = eventsInRange.length;
  sheet.innerHTML =
    '<div class="cal-print-page cal-print-tasklist">' +
    '<div class="cal-print-header">' +
    '<div style="font-size:20px;font-weight:800;color:#111">' +
    esc(t('cal.taskListTitle')) +
    '</div>' +
    '<div style="font-size:13px;color:#444;margin-top:2px">' +
    esc(rangeLabel) +
    '</div>' +
    '<div style="font-size:11px;color:#666;margin-top:2px">' +
    totalEvents +
    ' ' +
    t('cal.entries') +
    ' — ' +
    t('cal.printed') +
    ' ' +
    new Date().toLocaleDateString(loc()) +
    '</div>' +
    '</div>' +
    '<div class="cal-print-body">' +
    bodyHtml +
    '</div>' +
    '</div>';

  closeCalPrintModal();
  setTimeout(() => window.print(), 150);
}

// ── Month View ──
function renderCalMonth() {
  const container = document.getElementById('cal-container');
  const title = document.getElementById('cal-title');
  const months = calMonths(),
    days2 = calDays();
  title.textContent = months[calMonth] + ' ' + calYear;
  const firstDay = new Date(calYear, calMonth, 1);
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const startDow = (firstDay.getDay() + 6) % 7;
  const prevLast = new Date(calYear, calMonth, 0).getDate();
  const events = collectCalendarEvents();
  const todayStr = localDateStr(new Date());
  const totalCells = startDow + daysInMonth;
  const rows = Math.max(6, Math.ceil(totalCells / 7));
  const trailing = rows * 7 - totalCells;

  let html = '<div class="cal-grid" id="cal-grid">';
  html += days2.map((d) => '<div class="cal-hdr">' + d + '</div>').join('');

  function eventsForDate(ds) {
    const de = events.filter((e) => e.date === ds);
    const mx = 3;
    let o = de
      .slice(0, mx)
      .map((e) => {
        const drag = e.draggable ? 'draggable="true"' : '';
        const cls = e.draggable ? 'cal-event' : 'cal-event no-drag';
        const bg = e.color ? 'style="background:' + safeColor(e.color) + '"' : '';
        const assigneeStr =
          e.assignees && e.assignees.length
            ? ' <span class="cal-ev-assignees">' + e.assignees.map((a) => esc(a.username)).join(', ') + '</span>'
            : '';
        const dot = e.species ? spDot(e.species) : '';
        return (
          '<div class="' +
          cls +
          '" ' +
          drag +
          ' data-type="' +
          esc(e.type) +
          '" data-id="' +
          esc(e.id || '') +
          '" title="' +
          esc(e.label) +
          '" ' +
          bg +
          '>' +
          dot +
          esc(e.label) +
          assigneeStr +
          '</div>'
        );
      })
      .join('');
    if (de.length > mx)
      o +=
        '<div class="cal-more" onclick="event.stopPropagation();calGotoDay(\'' +
        ds +
        '\')">+' +
        (de.length - mx) +
        ' ' +
        t('cal.more') +
        '</div>';
    return o;
  }

  for (let i = startDow - 1; i >= 0; i--) {
    const day = prevLast - i,
      m = calMonth === 0 ? 11 : calMonth - 1,
      y = calMonth === 0 ? calYear - 1 : calYear,
      ds = fmtDate(y, m, day);
    html +=
      '<div class="cal-cell other" data-date="' +
      ds +
      '" onclick="calCellClick(event,\'' +
      ds +
      '\')"><div class="cal-day" onclick="event.stopPropagation();calGotoDay(\'' +
      ds +
      '\')">' +
      day +
      '</div>' +
      eventsForDate(ds) +
      '</div>';
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = fmtDate(calYear, calMonth, d),
      cls = ds === todayStr ? 'cal-cell today' : 'cal-cell';
    html +=
      '<div class="' +
      cls +
      '" data-date="' +
      ds +
      '" onclick="calCellClick(event,\'' +
      ds +
      '\')"><div class="cal-day" onclick="event.stopPropagation();calGotoDay(\'' +
      ds +
      '\')">' +
      d +
      '</div>' +
      eventsForDate(ds) +
      '</div>';
  }
  for (let d = 1; d <= trailing; d++) {
    const m = calMonth === 11 ? 0 : calMonth + 1,
      y = calMonth === 11 ? calYear + 1 : calYear,
      ds = fmtDate(y, m, d);
    html +=
      '<div class="cal-cell other" data-date="' +
      ds +
      '" onclick="calCellClick(event,\'' +
      ds +
      '\')"><div class="cal-day" onclick="event.stopPropagation();calGotoDay(\'' +
      ds +
      '\')">' +
      d +
      '</div>' +
      eventsForDate(ds) +
      '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
  initCalDragDrop(container);
}
function calCellClick(e, ds) {
  if (e.target.closest('.cal-event') || e.target.closest('.cal-more')) return;
  openEventModal(ds);
}
function calGotoDay(ds) {
  calSelectedDate = parseDateStr(ds);
  calYear = calSelectedDate.getFullYear();
  calMonth = calSelectedDate.getMonth();
  setCalView('day');
}

// ── Week View ──
function getWeekStart(d) {
  const dt = new Date(d);
  const dow = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - dow);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function renderCalWeek() {
  const container = document.getElementById('cal-container');
  const title = document.getElementById('cal-title');
  const ws = getWeekStart(calSelectedDate);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws);
    d.setDate(ws.getDate() + i);
    days.push(d);
  }
  const todayStr = localDateStr(new Date());
  const MONTHS = calMonths(),
    DAYS = calDays();
  title.textContent =
    days[0].getDate() +
    '. ' +
    (days[0].getMonth() !== days[6].getMonth()
      ? MONTHS[days[0].getMonth()] + ' — ' + days[6].getDate() + '. ' + MONTHS[days[6].getMonth()]
      : ' — ' + days[6].getDate() + '. ' + MONTHS[days[0].getMonth()]) +
    ' ' +
    days[6].getFullYear();
  const events = collectCalendarEvents();
  const dayStrs = days.map((d) => localDateStr(d));

  let html = '<div class="cal-week">';
  html += '<div class="cal-week-hdr"><div class="cal-week-hdr-cell"></div>';
  days.forEach((d, i) => {
    const ds = dayStrs[i];
    html +=
      '<div class="cal-week-hdr-cell' +
      (ds === todayStr ? ' today-col' : '') +
      '" onclick="calGotoDay(\'' +
      ds +
      '\')">' +
      DAYS[i] +
      '<span class="wk-day-num">' +
      d.getDate() +
      '</span></div>';
  });
  html += '</div>';
  html += '<div class="cal-week-allday"><div class="cal-week-allday-label">' + t('cal.allDayShort') + '</div>';
  days.forEach((d, i) => {
    const ds = dayStrs[i];
    const de = events.filter((e) => e.date === ds && e.allDay);
    html += '<div class="cal-week-allday-cell" data-date="' + ds + '">';
    de.forEach((e) => {
      const cls = e.draggable ? 'cal-event' : 'cal-event no-drag';
      const bg = e.color ? 'style="background:' + safeColor(e.color) + '"' : '';
      const dot = e.species ? spDot(e.species) : '';
      html +=
        '<div class="' +
        cls +
        '" ' +
        (e.draggable ? 'draggable="true"' : '') +
        ' data-type="' +
        esc(e.type) +
        '" data-id="' +
        esc(e.id || '') +
        '" title="' +
        esc(e.label) +
        '" ' +
        bg +
        '>' +
        dot +
        esc(e.label) +
        '</div>';
    });
    html += '</div>';
  });
  html += '</div>';
  html += '<div class="cal-week-body">';
  for (let h = CAL_HOURS_START; h <= CAL_HOURS_END; h++) {
    html += '<div class="cal-week-time">' + String(h).padStart(2, '0') + ':00</div>';
    days.forEach((d, i) => {
      const ds = dayStrs[i];
      html +=
        '<div class="cal-week-slot' +
        (ds === todayStr ? ' today-col' : '') +
        '" data-date="' +
        ds +
        '" data-hour="' +
        h +
        '" onclick="openEventModal(\'' +
        ds +
        "','" +
        String(h).padStart(2, '0') +
        ':00\')"></div>';
    });
  }
  html += '</div></div>';
  container.innerHTML = html;

  const body = container.querySelector('.cal-week-body');
  if (body) {
    days.forEach((d, i) => {
      const ds = dayStrs[i];
      const timed = events.filter((e) => e.date === ds && !e.allDay && e.startTime);
      timed.forEach((e) => {
        const [sh, sm] = (e.startTime || '09:00').split(':').map(Number);
        const [eh, em] = (e.endTime || String(sh + 1).padStart(2, '0') + ':00').split(':').map(Number);
        const top = (sh - CAL_HOURS_START) * 48 + (sm / 60) * 48;
        const height = Math.max(24, (eh - sh) * 48 + ((em - sm) / 60) * 48);
        const col = i + 2;
        const el = document.createElement('div');
        el.className = 'cal-week-ev';
        el.style.cssText =
          'top:' + top + 'px;height:' + height + 'px;background:' + safeColor(e.color) + ';grid-column:' + col;
        const wkDot = e.species ? spDot(e.species) : '';
        let wkContent = wkDot + esc(e.label);
        if (e.assignees && e.assignees.length)
          wkContent +=
            ' <span class="cal-ev-assignees">' + e.assignees.map((a) => esc(a.username)).join(', ') + '</span>';
        if (height >= 48 && e.startTime)
          wkContent +=
            '<div style="opacity:.8;font-size:10px">' + e.startTime + (e.endTime ? ' — ' + e.endTime : '') + '</div>';
        if (height >= 72 && e.description)
          wkContent += '<div style="opacity:.7;font-size:10px;margin-top:1px">' + esc(e.description) + '</div>';
        el.innerHTML = wkContent;
        el.title = e.label;
        el.dataset.type = e.type;
        el.dataset.id = e.id || '';
        el.dataset.date = ds;
        el.onclick = function () {
          if (!el._dragged) onCalEventClick(e);
        };
        if (e.type === 'custom') {
          const rh = document.createElement('div');
          rh.className = 'ev-resize';
          el.appendChild(rh);
          initEventDrag(el, body, 'week', dayStrs);
          initEventResize(el, rh, body, 'week');
        }
        body.appendChild(el);
      });
    });
    const now = new Date();
    const nowDs = localDateStr(now);
    const todayIdx = dayStrs.indexOf(nowDs);
    if (todayIdx >= 0) {
      const nowH = now.getHours(),
        nowM = now.getMinutes();
      if (nowH >= CAL_HOURS_START && nowH <= CAL_HOURS_END) {
        const top = (nowH - CAL_HOURS_START) * 48 + (nowM / 60) * 48;
        const line = document.createElement('div');
        line.className = 'cal-week-now-line';
        line.style.top = top + 'px';
        body.appendChild(line);
        body.scrollTop = Math.max(0, top - 150);
      }
    }
  }
  initCalDragDrop(container);
}

// ── Day View ──
function renderCalDay() {
  const container = document.getElementById('cal-container');
  const title = document.getElementById('cal-title');
  const d = calSelectedDate;
  const ds = localDateStr(d);
  const DAYS = calDays(),
    MONTHS = calMonths();
  const dayName = DAYS[(d.getDay() + 6) % 7];
  title.textContent = dayName + ', ' + d.getDate() + '. ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  const events = collectCalendarEvents();
  const dayEvents = events.filter((e) => e.date === ds);
  const allDay = dayEvents.filter((e) => e.allDay);
  const timed = dayEvents.filter((e) => !e.allDay && e.startTime);

  let html = '<div class="cal-day-view">';
  html += '<div class="cal-day-allday"><div class="sec">' + t('cal.allDay') + '</div>';
  if (allDay.length) {
    allDay.forEach((e) => {
      const cls = e.draggable ? 'cal-event' : 'cal-event no-drag';
      const bg = e.color ? 'style="background:' + safeColor(e.color) + '"' : '';
      const dot = e.species ? spDot(e.species) : '';
      html +=
        '<div class="' +
        cls +
        '" ' +
        (e.draggable ? 'draggable="true"' : '') +
        ' data-type="' +
        esc(e.type) +
        '" data-id="' +
        esc(e.id || '') +
        '" title="' +
        esc(e.label) +
        '" ' +
        bg +
        '>' +
        dot +
        esc(e.label) +
        '</div>';
    });
  } else {
    html += '<div class="cal-day-allday-empty">' + t('cal.noAllDay') + '</div>';
  }
  html += '</div>';
  html += '<div class="cal-day-body">';
  for (let h = CAL_HOURS_START; h <= CAL_HOURS_END; h++) {
    html += '<div class="cal-day-time">' + String(h).padStart(2, '0') + ':00</div>';
    html +=
      '<div class="cal-day-slot" data-date="' +
      ds +
      '" data-hour="' +
      h +
      '" onclick="openEventModal(\'' +
      ds +
      "','" +
      String(h).padStart(2, '0') +
      ':00\')"></div>';
  }
  html += '</div></div>';
  container.innerHTML = html;

  const body = container.querySelector('.cal-day-body');
  if (body) {
    timed.forEach((e) => {
      const [sh, sm] = (e.startTime || '09:00').split(':').map(Number);
      const [eh, em] = (e.endTime || String(sh + 1).padStart(2, '0') + ':00').split(':').map(Number);
      const top = (sh - CAL_HOURS_START) * 48 + (sm / 60) * 48;
      const height = Math.max(24, (eh - sh) * 48 + ((em - sm) / 60) * 48);
      const el = document.createElement('div');
      el.className = 'cal-day-ev';
      el.style.cssText =
        'top:' + top + 'px;height:' + height + 'px;background:' + safeColor(e.color) + ';grid-column:2';
      const dayDot = e.species ? spDot(e.species) : '';
      let dayContent = dayDot + '<strong>' + esc(e.label) + '</strong>';
      if (e.assignees && e.assignees.length)
        dayContent +=
          ' <span class="cal-ev-assignees">' + e.assignees.map((a) => esc(a.username)).join(', ') + '</span>';
      if (e.startTime)
        dayContent +=
          '<div style="opacity:.8;font-size:11px;margin-top:2px">' +
          e.startTime +
          (e.endTime ? ' — ' + e.endTime : '') +
          '</div>';
      if (height >= 72 && e.description)
        dayContent += '<div style="opacity:.7;font-size:10px;margin-top:2px">' + esc(e.description) + '</div>';
      el.innerHTML = dayContent;
      el.title = e.label;
      el.dataset.type = e.type;
      el.dataset.id = e.id || '';
      el.dataset.date = ds;
      el.onclick = function () {
        if (!el._dragged) onCalEventClick(e);
      };
      if (e.type === 'custom') {
        const rh = document.createElement('div');
        rh.className = 'ev-resize';
        el.appendChild(rh);
        initEventDrag(el, body, 'day', null);
        initEventResize(el, rh, body, 'day');
      }
      body.appendChild(el);
    });
    const now = new Date();
    const nowDs = localDateStr(now);
    if (ds === nowDs) {
      const nowH = now.getHours(),
        nowM = now.getMinutes();
      if (nowH >= CAL_HOURS_START && nowH <= CAL_HOURS_END) {
        const top = (nowH - CAL_HOURS_START) * 48 + (nowM / 60) * 48;
        const line = document.createElement('div');
        line.className = 'cal-day-now-line';
        line.style.top = top + 'px';
        body.appendChild(line);
        body.scrollTop = Math.max(0, top - 150);
      }
    }
  }
  initCalDragDrop(container);
}

// ── Calendar Drag-and-Drop ──
function initCalDragDrop(root) {
  if (!root) return;
  root.onclick = function (e) {
    const ev = e.target.closest('.cal-event');
    if (!ev) return;
    e.stopPropagation();
    onCalMonthEventClick(ev.dataset.type, ev.dataset.id);
  };
  root.ondragstart = function (e) {
    const ev = e.target.closest('.cal-event');
    if (!ev || ev.classList.contains('no-drag')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', ev.dataset.type + '|' + ev.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    ev.style.opacity = '0.4';
  };
  root.ondragend = function (e) {
    const ev = e.target.closest('.cal-event');
    if (ev) ev.style.opacity = '1';
    root.querySelectorAll('.drag-over').forEach((c) => c.classList.remove('drag-over'));
  };
  root.ondragover = function (e) {
    const cell = e.target.closest('[data-date]');
    if (!cell) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    root.querySelectorAll('.drag-over').forEach((c) => c.classList.remove('drag-over'));
    cell.classList.add('drag-over');
  };
  root.ondragleave = function (e) {
    const cell = e.target.closest('[data-date]');
    if (cell) cell.classList.remove('drag-over');
  };
  root.ondrop = function (e) {
    e.preventDefault();
    root.querySelectorAll('.drag-over').forEach((c) => c.classList.remove('drag-over'));
    const cell = e.target.closest('[data-date]');
    if (!cell || !cell.dataset.date) return;
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    const [type, id] = data.split('|');
    handleCalendarDrop(type, id, cell.dataset.date);
  };
}

function handleCalendarDrop(type, id, newDateStr) {
  if (type === 'batch-due') {
    const b = batches.find((x) => x.batchId === id);
    if (!b) return;
    const newDue = new Date(newDateStr + 'T12:00:00');
    b.due = newDue.toISOString();
    const created = new Date(b.created);
    b.days = Math.max(1, Math.round((newDue - created) / MS_PER_DAY));
    apiPatch('/api/batches/' + encodeURIComponent(id), { due: b.due, days: b.days });
    renderCalendar();
    pushBatchCaldav(b);
  } else if (type === 'task-due') {
    const t = manualTasks.find((x) => x.created === id);
    if (!t) return;
    t.dueDate = newDateStr;
    t.caldavSynced = null;
    apiPatch('/api/tasks/' + t.id, { dueDate: newDateStr, caldavSynced: null });
    renderCalendar();
    if (caldav.enabled && t.caldavUid && typeof pushTaskCaldav === 'function') pushTaskCaldav(t);
  } else if (type === 'custom') {
    const ev = calendarEvents.find((x) => x.id === id);
    if (!ev) return;
    ev.startDate = newDateStr;
    ev.caldavSynced = null;
    apiPatch('/api/calendar-events/' + encodeURIComponent(ev.id), { startDate: newDateStr, caldavSynced: null });
    renderCalendar();
    if (typeof pushEventCaldav === 'function') pushEventCaldav(ev);
  }
}

// ── Time-based Drag & Resize for Week/Day views ──
function pxToTime(px) {
  const totalMin = (px / 48) * 60;
  let h = CAL_HOURS_START + Math.floor(totalMin / 60);
  let m = Math.round((totalMin % 60) / 15) * 15;
  if (m >= 60) {
    h++;
    m = 0;
  }
  h = Math.max(CAL_HOURS_START, Math.min(CAL_HOURS_END, h));
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function snapPx(px) {
  return Math.round(px / 12) * 12;
}

function updateEventTime(id, newStart, newEnd, newDate) {
  const ev = calendarEvents.find((x) => x.id === id);
  if (!ev) return;
  if (newStart) ev.startTime = newStart;
  if (newEnd) ev.endTime = newEnd;
  if (newDate) ev.startDate = newDate;
  ev.caldavSynced = null;
  const patch = { caldavSynced: null };
  if (newStart) patch.startTime = newStart;
  if (newEnd) patch.endTime = newEnd;
  if (newDate) patch.startDate = newDate;
  apiPatch('/api/calendar-events/' + encodeURIComponent(id), patch);
  renderCalendar();
  if (typeof pushEventCaldav === 'function') pushEventCaldav(ev);
}

function initEventDrag(el, body, viewType, dayStrs) {
  function startDrag(clientX, clientY) {
    if (el._resizing) return;
    const startY = clientY,
      startX = clientX;
    const origTop = parseFloat(el.style.top);
    let dragging = false;
    el._dragged = false;
    const onMove = function (cx, cy) {
      const dy = cy - startY;
      const dx = cx - startX;
      if (!dragging && Math.abs(dy) < 4 && Math.abs(dx) < 4) return;
      dragging = true;
      el._dragged = true;
      el.style.top = snapPx(origTop + dy) + 'px';
      el.style.opacity = '0.7';
      el.style.zIndex = '10';
      if (viewType === 'week' && dayStrs) {
        const bodyRect = body.getBoundingClientRect();
        const timeColW = 56;
        const colW = (bodyRect.width - timeColW) / 7;
        const relX = cx - bodyRect.left - timeColW;
        const newColIdx = Math.max(0, Math.min(6, Math.floor(relX / colW)));
        el.style.gridColumn = String(newColIdx + 2);
      }
    };
    const onUp = function () {
      document.removeEventListener('mousemove', mmh);
      document.removeEventListener('mouseup', muh);
      document.removeEventListener('touchmove', tmh);
      document.removeEventListener('touchend', teh);
      el.style.opacity = '';
      el.style.zIndex = '';
      if (!dragging) return;
      const newTop = Math.max(0, snapPx(parseFloat(el.style.top)));
      const evId = el.dataset.id;
      const newStart = pxToTime(newTop);
      const ce = calendarEvents.find((x) => x.id === evId);
      if (!ce) return;
      const [osh, osm] = (ce.startTime || '09:00').split(':').map(Number);
      const [oeh, oem] = (ce.endTime || '10:00').split(':').map(Number);
      const durMin = oeh * 60 + oem - (osh * 60 + osm);
      const [nsh, nsm] = newStart.split(':').map(Number);
      const endMin = nsh * 60 + nsm + durMin;
      const neh = Math.min(CAL_HOURS_END, Math.floor(endMin / 60));
      const nem = endMin % 60;
      const newEnd = String(neh).padStart(2, '0') + ':' + String(nem).padStart(2, '0');
      let newDate = el.dataset.date;
      if (viewType === 'week' && dayStrs) {
        const newColIdx = parseInt(el.style.gridColumn) - 2;
        if (newColIdx >= 0 && newColIdx < dayStrs.length) newDate = dayStrs[newColIdx];
      }
      updateEventTime(evId, newStart, newEnd, newDate);
    };
    const mmh = function (e) {
      onMove(e.clientX, e.clientY);
    };
    const muh = function () {
      onUp();
    };
    const tmh = function (e) {
      e.preventDefault();
      const t = e.touches[0];
      onMove(t.clientX, t.clientY);
    };
    const teh = function () {
      onUp();
    };
    document.addEventListener('mousemove', mmh);
    document.addEventListener('mouseup', muh);
    document.addEventListener('touchmove', tmh, { passive: false });
    document.addEventListener('touchend', teh);
  }
  el.addEventListener('mousedown', function (e) {
    if (e.target.classList.contains('ev-resize')) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
  });
  el.addEventListener(
    'touchstart',
    function (e) {
      if (e.target.classList.contains('ev-resize')) return;
      const t = e.touches[0];
      startDrag(t.clientX, t.clientY);
    },
    { passive: true }
  );
}

function initEventResize(el, handle, body, viewType) {
  function startResize(clientY) {
    el._resizing = true;
    const startY = clientY;
    const origHeight = parseFloat(el.style.height);
    let resizing = false;
    const onMove = function (cy) {
      const dy = cy - startY;
      if (!resizing && Math.abs(dy) < 4) return;
      resizing = true;
      el._dragged = true;
      const newH = Math.max(12, snapPx(origHeight + dy));
      el.style.height = newH + 'px';
    };
    const onUp = function () {
      document.removeEventListener('mousemove', mmh);
      document.removeEventListener('mouseup', muh);
      document.removeEventListener('touchmove', tmh);
      document.removeEventListener('touchend', teh);
      el._resizing = false;
      if (!resizing) return;
      const evId = el.dataset.id;
      const newHeight = Math.max(12, parseFloat(el.style.height));
      const topPx = parseFloat(el.style.top);
      const endPx = topPx + newHeight;
      const newEnd = pxToTime(endPx);
      const newStart = pxToTime(topPx);
      updateEventTime(evId, newStart, newEnd, null);
    };
    const mmh = function (e) {
      onMove(e.clientY);
    };
    const muh = function () {
      onUp();
    };
    const tmh = function (e) {
      e.preventDefault();
      onMove(e.touches[0].clientY);
    };
    const teh = function () {
      onUp();
    };
    document.addEventListener('mousemove', mmh);
    document.addEventListener('mouseup', muh);
    document.addEventListener('touchmove', tmh, { passive: false });
    document.addEventListener('touchend', teh);
  }
  handle.addEventListener('mousedown', function (e) {
    e.preventDefault();
    e.stopPropagation();
    startResize(e.clientY);
  });
  handle.addEventListener(
    'touchstart',
    function (e) {
      e.stopPropagation();
      startResize(e.touches[0].clientY);
    },
    { passive: true }
  );
}

// ── Calendar Event Click ──
function onCalEventClick(ev) {
  if (ev.type === 'harvest') return;
  openEventDetail(ev);
}

function openEventDetail(ev) {
  const titleEl = document.getElementById('cal-detail-title');
  const metaEl = document.getElementById('cal-detail-meta');
  const badgesEl = document.getElementById('cal-detail-badges');
  const assignEl = document.getElementById('cal-detail-assignee');
  const descEl = document.getElementById('cal-detail-desc');
  const btnsEl = document.getElementById('cal-detail-btns');

  if (ev.type === 'custom') {
    const ce = calendarEvents.find((x) => x.id === ev.id);
    if (!ce) return;
    titleEl.textContent = ce.title;
    const occDate = ev.date || ce.startDate;
    let meta = new Date(occDate).toLocaleDateString(loc(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    if (!ce.allDay && ce.startTime) meta += ', ' + ce.startTime + (ce.endTime ? ' — ' + ce.endTime : '');
    if (ce.endDate && ce.endDate !== ce.startDate)
      meta +=
        ' ' +
        t('calEntry.until') +
        ' ' +
        new Date(ce.endDate).toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' });
    metaEl.textContent = meta;
    const catLabels = {
      custom: t('calEntry.cat.custom'),
      meeting: t('calEntry.cat.meeting'),
      delivery: t('calEntry.cat.delivery'),
      maintenance: t('calEntry.cat.maintenance')
    };
    const recLabels = {
      daily: t('calEntry.rec.daily'),
      weekly: t('calEntry.rec.weekly'),
      monthly: t('calEntry.rec.monthly')
    };
    let badges =
      '<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:' +
      (CATEGORY_COLORS[ce.category] || safeColor(ce.color)) +
      ';color:#fff">' +
      esc(catLabels[ce.category] || ce.category) +
      '</span>';
    if (ce.recurrence)
      badges +=
        '<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:var(--c-text-muted);color:#fff">🔁 ' +
        esc(recLabels[ce.recurrence] || ce.recurrence) +
        '</span>';
    badgesEl.innerHTML = badges;
    const teamList = Array.isArray(ce.teamAssignees) ? ce.teamAssignees : [];
    assignEl.innerHTML =
      t('calDetail.assignedTo') +
      ': <strong>' +
      (teamList.length ? teamList.map((n) => esc(n)).join(', ') : esc(t('calDetail.everyone'))) +
      '</strong>';
    descEl.textContent = ce.description || '';
    descEl.style.display = ce.description ? '' : 'none';
    btnsEl.innerHTML =
      '<button class="btn btn-r" data-cal-action="delete-event" data-cal-id="' +
      esc(ce.id) +
      '" data-cal-date="' +
      esc(occDate || '') +
      '">' +
      esc(t('calEntry.delete')) +
      '</button><span style="flex:1"></span><button class="btn" data-cal-action="close">' +
      esc(t('calDetail.close')) +
      '</button><button class="btn btn-p" data-cal-action="edit-event" data-cal-id="' +
      esc(ce.id) +
      '">' +
      esc(t('calDetail.edit')) +
      '</button>';
  } else if (ev.type === 'task-due') {
    const tk = manualTasks.find((x) => x.created === ev.id);
    if (!tk) return;
    titleEl.textContent = tk.text;
    let meta = t('calDetail.taskDue');
    if (tk.dueDate)
      meta +=
        ' — ' +
        t('calDetail.dueLabel') +
        ': ' +
        new Date(tk.dueDate).toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' });
    if (tk.dueTime) meta += ', ' + tk.dueTime + (tk.dueEndTime ? ' — ' + tk.dueEndTime : '');
    metaEl.textContent = meta;
    const prioLabels = {
      high: t('calEntry.prio.high'),
      med: t('calEntry.prio.med'),
      medium: t('calEntry.prio.med'),
      low: t('calEntry.prio.low')
    };
    const prioColors = { high: '#ef4444', med: '#f59e0b', medium: '#f59e0b', low: '#22c55e' };
    const recLabels2 = {
      daily: t('calEntry.rec.daily'),
      weekly: t('calEntry.rec.weekly'),
      monthly: t('calEntry.rec.monthly')
    };
    let tBadges =
      '<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:var(--c-blue);color:#fff">' +
      esc(t('calDetail.taskDue')) +
      '</span>';
    if (tk.priority)
      tBadges +=
        '<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:' +
        (prioColors[tk.priority] || '#888') +
        ';color:#fff">' +
        esc(prioLabels[tk.priority] || tk.priority) +
        '</span>';
    if (tk.recurrence)
      tBadges +=
        '<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:var(--c-text-muted);color:#fff">🔁 ' +
        esc(recLabels2[tk.recurrence] || tk.recurrence) +
        '</span>';
    badgesEl.innerHTML = tBadges;
    const assigneeList = parseTaskAssignees(tk.assignee);
    assignEl.innerHTML =
      t('calDetail.assignedTo') +
      ': <strong>' +
      (assigneeList.length ? assigneeList.map((n) => esc(n)).join(', ') : esc(t('calDetail.everyone'))) +
      '</strong>';
    descEl.textContent = tk.description || '';
    descEl.style.display = tk.description ? '' : 'none';
    const doneLabel = tk.done ? t('calDetail.markUndone') : t('calDetail.markDone');
    btnsEl.innerHTML =
      '<button class="btn btn-r" data-cal-action="delete-task" data-cal-id="' +
      esc(ev.id) +
      '">' +
      esc(t('calEntry.delete')) +
      '</button><button class="btn' +
      (tk.done ? '' : ' btn-p') +
      '" data-cal-action="toggle-task" data-cal-id="' +
      esc(ev.id) +
      '">' +
      esc(doneLabel) +
      '</button><span style="flex:1"></span><button class="btn" data-cal-action="close">' +
      esc(t('calDetail.close')) +
      '</button><button class="btn btn-p" data-cal-action="edit-task" data-cal-id="' +
      esc(ev.id) +
      '">' +
      esc(t('calDetail.edit')) +
      '</button>';
  } else if (ev.type === 'batch-due') {
    titleEl.textContent = ev.label;
    const b = batches.find((x) => x.batchId === ev.id);
    let meta = t('calDetail.batchDue');
    if (b && b.due)
      meta += ' — ' + new Date(b.due).toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' });
    metaEl.textContent = meta;
    badgesEl.innerHTML =
      '<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:var(--c-red);color:#fff">' +
      esc(t('calDetail.batchDue')) +
      '</span>';
    const curDate = b && b.due ? b.due.slice(0, 10) : '';
    assignEl.innerHTML =
      '<label style="font-size:12px;color:var(--c-text-sec)">' +
      esc(t('calDetail.changeDate')) +
      '</label> <input type="date" id="cal-detail-batch-date" value="' +
      curDate +
      '" style="margin-left:8px;font-size:13px;padding:4px 8px;border:1px solid var(--c-border);border-radius:4px;background:var(--c-bg);color:var(--c-text)">';
    assignEl._currentBatchId = ev.id;
    descEl.textContent = b ? b.species + (b.strain ? ' (' + b.strain + ')' : '') : '';
    descEl.style.display = '';
    btnsEl.innerHTML =
      '<span style="flex:1"></span><button class="btn" data-cal-action="close">' +
      esc(t('calDetail.close')) +
      '</button><button class="btn btn-p" data-cal-action="save-batch-due" data-cal-id="' +
      esc(ev.id) +
      '">' +
      esc(t('calEntry.save')) +
      '</button>';
  } else if (ev.type === 'caldav-import') {
    titleEl.textContent = ev.label;
    let meta = t('calDetail.external');
    if (ev.date)
      meta += ' — ' + new Date(ev.date).toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' });
    if (ev.startTime) meta += ', ' + ev.startTime + (ev.endTime ? ' — ' + ev.endTime : '');
    metaEl.textContent = meta;
    badgesEl.innerHTML =
      '<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:var(--c-indigo);color:#fff">' +
      esc(t('calDetail.external')) +
      '</span>';
    assignEl.innerHTML = '';
    descEl.textContent = ev.description || '';
    descEl.style.display = ev.description ? '' : 'none';
    btnsEl.innerHTML = '<button class="btn" data-cal-action="close">' + esc(t('calDetail.close')) + '</button>';
  }
  document.getElementById('m-cal-detail').classList.add('open');
}

function closeEventDetail() {
  document.getElementById('m-cal-detail').classList.remove('open');
}

// Delegated click handler for calendar detail buttons (avoids inline onclick XSS).
document.getElementById('cal-detail-btns').addEventListener('click', function (e) {
  const btn = e.target.closest('[data-cal-action]');
  if (!btn) return;
  const action = btn.dataset.calAction;
  const id = btn.dataset.calId;
  const date = btn.dataset.calDate || '';
  if (action === 'close') return closeEventDetail();
  if (action === 'delete-event') return deleteCalEventFromDetail(id, date);
  if (action === 'edit-event') return editEventFromDetail(id);
  if (action === 'delete-task') return deleteTaskFromCalendar(id);
  if (action === 'toggle-task') return toggleTaskFromCalendar(id);
  if (action === 'edit-task') return editTaskFromCalendar(id);
  if (action === 'save-batch-due') return saveBatchDueFromDetail(id);
});

// Change handler for batch due-date picker in detail modal.
document.getElementById('cal-detail-assignee').addEventListener('change', function (e) {
  if (e.target.id !== 'cal-detail-batch-date') return;
  const newDate = e.target.value;
  if (!newDate) return;
  const batchId = this._currentBatchId;
  if (!batchId) return;
  handleCalendarDrop('batch-due', batchId, newDate);
  closeEventDetail();
});

function editEventFromDetail(id) {
  closeEventDetail();
  const ce = calendarEvents.find((x) => x.id === id);
  if (ce) openEventModal(ce.startDate, ce.startTime, ce);
}

function saveBatchDueFromDetail(id) {
  const picker = document.getElementById('cal-detail-batch-date');
  if (!picker || !picker.value) return;
  const b = batches.find((x) => x.batchId === id);
  if (!b) return;
  const newDue = new Date(picker.value + 'T12:00:00');
  b.due = newDue.toISOString();
  const created = new Date(b.created);
  b.days = Math.max(1, Math.round((newDue - created) / MS_PER_DAY));
  apiPatch('/api/batches/' + encodeURIComponent(id), { due: b.due, days: b.days });
  renderCalendar();
  pushBatchCaldav(b);
  closeEventDetail();
}

function findSameTitleEvents(ce) {
  if (!ce || !ce.title) return [];
  return calendarEvents.filter((x) => x.id !== ce.id && !x.recurrence && x.title === ce.title);
}

function deleteAllSameTitle(ids) {
  const idSet = new Set(ids);
  calendarEvents = calendarEvents.filter((x) => !idSet.has(x.id));
  renderCalendar();
  ids.forEach((eid) => apiDelete('/api/calendar-events/' + encodeURIComponent(eid)));
}

function deleteCalEventFromDetail(id, date) {
  closeEventDetail();
  const ce = calendarEvents.find((x) => x.id === id);
  const isRecurring = !!(ce && ce.recurrence);
  if (isRecurring && date) {
    confirm3(
      t('calEntry.deleteRecurTitle'),
      t('calEntry.deleteRecurMsg'),
      t('calEntry.deleteOccurrence'),
      t('calEntry.deleteSeries'),
      () => {
        if (!Array.isArray(ce.exceptionDates)) ce.exceptionDates = [];
        if (!ce.exceptionDates.includes(date)) ce.exceptionDates.push(date);
        renderCalendar();
        apiDelete('/api/calendar-events/' + encodeURIComponent(id) + '?occurrence=' + encodeURIComponent(date));
      },
      () => {
        calendarEvents = calendarEvents.filter((x) => x.id !== id);
        renderCalendar();
        apiDelete('/api/calendar-events/' + encodeURIComponent(id));
      }
    );
    return;
  }
  if (!isRecurring) {
    const dups = findSameTitleEvents(ce);
    if (dups.length) {
      confirm3(
        t('calEntry.deleteDupTitle'),
        t('calEntry.deleteDupMsg', { n: dups.length }),
        t('calEntry.deleteOnlyThis'),
        t('calEntry.deleteAllSameTitle', { n: dups.length + 1 }),
        () => {
          calendarEvents = calendarEvents.filter((x) => x.id !== id);
          renderCalendar();
          apiDelete('/api/calendar-events/' + encodeURIComponent(id));
        },
        () => deleteAllSameTitle([id, ...dups.map((d) => d.id)])
      );
      return;
    }
  }
  confirm2(t('calEntry.deleteEvent'), t('calEntry.deleteEventMsg'), t('calEntry.delete'), () => {
    calendarEvents = calendarEvents.filter((x) => x.id !== id);
    renderCalendar();
    apiDelete('/api/calendar-events/' + encodeURIComponent(id));
  });
}

function toggleTaskFromCalendar(taskId) {
  const t = manualTasks.find((t) => t.created === taskId);
  if (!t) return;
  toggleTask(t.id);
  renderCalendar();
  closeEventDetail();
}

function deleteTaskFromCalendar(taskId) {
  closeEventDetail();
  confirm2(t('calEntry.deleteTask'), t('calEntry.deleteTaskMsg'), t('calEntry.delete'), () => {
    const tk = manualTasks.find((x) => x.created === taskId);
    if (!tk) return;
    manualTasks = manualTasks.filter((x) => x.id !== tk.id);
    apiDelete('/api/tasks/' + tk.id);
    renderCalendar();
    updateTodoBadge();
  });
}

// ─── UNIFIED CALENDAR ENTRY MODAL ─────────────────────────────
const CATEGORY_COLORS = { custom: '#16a34a', meeting: '#8b5cf6', delivery: '#14b8a6', maintenance: '#64748b' };
let calEntryType = 'task';

function setEntryType(type) {
  const isTask = type === 'task';
  calEntryType = isTask ? 'task' : 'event';
  document.getElementById('cal-entry-type-select').value = type;
  document.getElementById('cal-entry-enddate-wrap').style.display = isTask ? 'none' : '';
  document.getElementById('cal-entry-allday-wrap').style.display = '';
  document.getElementById('cal-entry-prio-wrap').style.display = isTask ? '' : 'none';
  document.getElementById('cal-entry-task-assign-wrap').style.display = isTask ? '' : 'none';
  document.getElementById('cal-entry-ev-assign-wrap').style.display = isTask ? 'none' : '';
  document.getElementById('cal-entry-private-wrap').style.display = isTask ? 'flex' : 'none';
  const recWrap = document.getElementById('cal-entry-recurrence-wrap');
  if (recWrap) recWrap.style.display = 'grid';
  document.getElementById('cal-entry-name').placeholder = isTask ? t('calEntry.namePhTask') : t('calEntry.namePhEvent');
  toggleEntryTimeInputs();
  toggleRecurrenceUntil();
}
function toggleRecurrenceUntil() {
  const sel = document.getElementById('cal-entry-recurrence');
  const wrap = document.getElementById('cal-entry-recurrence-until-wrap');
  if (sel && wrap) wrap.style.display = sel.value ? '' : 'none';
}

function openEntryModal(type, date, time, existing) {
  const modal = document.getElementById('m-cal-entry');
  const isEdit = !!existing;
  document.getElementById('cal-entry-name').disabled = false;
  document.getElementById('cal-entry-desc').closest('div').style.display = '';
  document.getElementById('cal-entry-type-select').closest('.g2').style.display = '';
  document.getElementById('cal-entry-type-select').disabled = isEdit;
  setEntryType(type || 'task');
  if (type === 'task' && existing) {
    document.getElementById('cal-entry-title').textContent = t('calEntry.titleEdit');
    document.getElementById('cal-entry-mode').value = 'edit';
    document.getElementById('cal-entry-id').value = existing.id;
    document.getElementById('cal-entry-name').value = existing.text;
    document.getElementById('cal-entry-date').value = existing.dueDate ? existing.dueDate.split('T')[0] : '';
    document.getElementById('cal-entry-allday').checked = !existing.dueTime;
    document.getElementById('cal-entry-start-time').value = existing.dueTime || '09:00';
    document.getElementById('cal-entry-end-time').value = existing.dueEndTime || '10:00';
    document.getElementById('cal-entry-prio').value = existing.priority || 'med';
    calTaskSelectedAssignees = parseTaskAssignees(existing.assignee);
    renderTaskAssigneePicker();
    document.getElementById('cal-entry-desc').value = existing.description || '';
    document.getElementById('cal-entry-private').checked = !!existing.private;
    document.getElementById('cal-entry-recurrence').value = existing.recurrence || '';
    document.getElementById('cal-entry-recurrence-until').value = existing.recurrenceUntil || '';
    toggleRecurrenceUntil();
    document.getElementById('cal-entry-del-btn').style.display = '';
  } else if (type === 'event' && existing) {
    document.getElementById('cal-entry-title').textContent = t('calEntry.titleEdit');
    document.getElementById('cal-entry-mode').value = 'edit';
    document.getElementById('cal-entry-id').value = existing.id;
    document.getElementById('cal-entry-name').value = existing.title;
    document.getElementById('cal-entry-date').value = existing.startDate;
    document.getElementById('cal-entry-end-date').value = existing.endDate || '';
    document.getElementById('cal-entry-allday').checked = existing.allDay;
    document.getElementById('cal-entry-start-time').value = existing.startTime || '09:00';
    document.getElementById('cal-entry-end-time').value = existing.endTime || '10:00';
    setEntryType(existing.category || 'custom');
    document.getElementById('cal-entry-desc').value = existing.description || '';
    calEvSelectedAssignees = Array.isArray(existing.teamAssignees) ? existing.teamAssignees.slice() : [];
    renderAssigneePicker();
    document.getElementById('cal-entry-recurrence').value = existing.recurrence || '';
    document.getElementById('cal-entry-recurrence-until').value = existing.recurrenceUntil || '';
    toggleRecurrenceUntil();
    document.getElementById('cal-entry-del-btn').style.display = '';
  } else {
    document.getElementById('cal-entry-title').textContent = t('calEntry.titleNew');
    document.getElementById('cal-entry-mode').value = 'create';
    document.getElementById('cal-entry-id').value = '';
    document.getElementById('cal-entry-name').value = '';
    document.getElementById('cal-entry-date').value = date || localDateStr(new Date());
    document.getElementById('cal-entry-end-date').value = '';
    document.getElementById('cal-entry-allday').checked = !time;
    document.getElementById('cal-entry-start-time').value = time || '09:00';
    const endH = time ? String(Math.min(23, parseInt(time) + 1)).padStart(2, '0') + ':00' : '10:00';
    document.getElementById('cal-entry-end-time').value = endH;
    document.getElementById('cal-entry-prio').value = 'med';
    calTaskSelectedAssignees = [];
    renderTaskAssigneePicker();
    document.getElementById('cal-entry-desc').value = '';
    document.getElementById('cal-entry-private').checked = false;
    calEvSelectedAssignees = [];
    renderAssigneePicker();
    document.getElementById('cal-entry-recurrence').value = '';
    document.getElementById('cal-entry-recurrence-until').value = '';
    toggleRecurrenceUntil();
    document.getElementById('cal-entry-del-btn').style.display = 'none';
  }
  document.getElementById('cal-ev-assignee-dropdown').style.display = 'none';
  const tdd = document.getElementById('cal-task-assignee-dropdown');
  if (tdd) tdd.style.display = 'none';
  toggleEntryTimeInputs();
  modal.classList.add('open');
  if (!existing) setTimeout(() => document.getElementById('cal-entry-name').focus(), 50);
}

function parseTaskAssignees(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.slice();
  // Split comma-separated for backward compat with old single-assignee strings
  return String(val)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function openEventModal(date, time, existing) {
  openEntryModal(existing ? 'event' : 'custom', date, time, existing);
}
function openTaskModal(date, existing) {
  openEntryModal('task', date, null, existing);
}

function closeEntryModal() {
  document.getElementById('m-cal-entry').classList.remove('open');
  const idEl = document.getElementById('cal-entry-id');
  idEl.dataset.moveType = '';
  idEl.dataset.moveId = '';
}
function closeEventModal() {
  closeEntryModal();
}
function closeCalTaskModal() {
  closeEntryModal();
}

function toggleEntryTimeInputs() {
  const timesEl = document.getElementById('cal-entry-times');
  timesEl.style.display = document.getElementById('cal-entry-allday').checked ? 'none' : 'grid';
}

// Normalize a user-entered time string to 24h HH:MM, or '' if invalid.
// Accepts "9", "9:5", "930", "0930", "9:30", "09:30", etc.
function normalizeTimeInput(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  let h, m;
  if (digits.length <= 2) {
    h = parseInt(digits, 10);
    m = 0;
  } else if (digits.length === 3) {
    h = parseInt(digits.slice(0, 1), 10);
    m = parseInt(digits.slice(1), 10);
  } else {
    h = parseInt(digits.slice(0, 2), 10);
    m = parseInt(digits.slice(2, 4), 10);
  }
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  if (h < 0 || h > 23 || m < 0 || m > 59) return '';
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function wireTimeInput(el) {
  if (!el || el.dataset.timeWired) return;
  el.dataset.timeWired = '1';
  el.addEventListener('blur', () => {
    const n = normalizeTimeInput(el.value);
    if (n) el.value = n;
  });
}

function saveEntry() {
  const mode = document.getElementById('cal-entry-mode').value;
  if (mode === 'move') {
    const idEl = document.getElementById('cal-entry-id');
    const moveType = idEl.dataset.moveType;
    const moveId = idEl.dataset.moveId;
    const newDate = document.getElementById('cal-entry-date').value;
    if (newDate && moveType) handleCalendarDrop(moveType, moveId, newDate);
    closeEntryModal();
    return;
  }
  if (calEntryType === 'task') saveEntryTask();
  else saveEntryEvent();
}

function saveEntryTask() {
  const mode = document.getElementById('cal-entry-mode').value;
  const text = document.getElementById('cal-entry-name').value.trim();
  if (!text) return;
  const prio = document.getElementById('cal-entry-prio').value;
  const due = document.getElementById('cal-entry-date').value || null;
  const allDay = document.getElementById('cal-entry-allday').checked;
  const dueTime =
    !allDay && due ? normalizeTimeInput(document.getElementById('cal-entry-start-time').value) || null : null;
  let dueEndTime =
    !allDay && due ? normalizeTimeInput(document.getElementById('cal-entry-end-time').value) || null : null;
  if (dueTime && dueEndTime && dueEndTime <= dueTime) dueEndTime = null;
  const assignee = calTaskSelectedAssignees.length ? calTaskSelectedAssignees.join(',') : null;
  const desc = document.getElementById('cal-entry-desc').value.trim() || null;
  const priv = document.getElementById('cal-entry-private').checked;
  const recurrence = document.getElementById('cal-entry-recurrence').value || null;
  const recurrenceUntil = recurrence ? document.getElementById('cal-entry-recurrence-until').value || null : null;
  if (mode === 'edit') {
    const id = parseInt(document.getElementById('cal-entry-id').value);
    const tk = manualTasks.find((x) => x.id === id);
    if (!tk) {
      closeEntryModal();
      return;
    }
    tk.text = text;
    tk.priority = prio;
    tk.dueDate = due;
    tk.dueTime = dueTime;
    tk.dueEndTime = dueEndTime;
    tk.assignee = assignee;
    tk.description = desc;
    tk.private = priv;
    tk.recurrence = recurrence;
    tk.recurrenceUntil = recurrenceUntil;
    tk.caldavSynced = null;
    apiPatch('/api/tasks/' + id, {
      text: tk.text,
      priority: tk.priority,
      dueDate: tk.dueDate,
      dueTime: tk.dueTime,
      dueEndTime: tk.dueEndTime,
      assignee: tk.assignee,
      description: tk.description,
      private: priv ? 1 : 0,
      recurrence,
      recurrenceUntil,
      caldavSynced: null
    });
    if (caldav.enabled && tk.caldavUid) pushTaskCaldav(tk);
  } else {
    const task = {
      text,
      priority: prio,
      done: false,
      created: new Date().toISOString(),
      assignee,
      dueDate: due,
      dueTime,
      dueEndTime,
      description: desc,
      caldavUid: null,
      caldavSynced: null,
      private: priv,
      recurrence,
      recurrenceUntil
    };
    manualTasks.push(task);
    apiPost('/api/tasks', task).then((r) => {
      if (r && r.id) {
        task.id = r.id;
        if (caldav.enabled && due) pushTaskCaldav(task);
      }
      renderCalendar();
      updateTodoBadge();
    });
  }
  closeEntryModal();
  if (document.getElementById('cal-entry-id').value) {
    renderCalendar();
    updateTodoBadge();
  }
}

function saveEntryEvent() {
  const mode = document.getElementById('cal-entry-mode').value;
  const name = document.getElementById('cal-entry-name').value.trim();
  if (!name) return;
  const allDay = document.getElementById('cal-entry-allday').checked;
  const category = document.getElementById('cal-entry-type-select').value;
  const recurrence = document.getElementById('cal-entry-recurrence').value || null;
  const recurrenceUntil = recurrence ? document.getElementById('cal-entry-recurrence-until').value || null : null;
  const teamAssignees = calEvSelectedAssignees.slice();
  const ev = {
    id:
      mode === 'edit'
        ? document.getElementById('cal-entry-id').value
        : 'cev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: name,
    description: document.getElementById('cal-entry-desc').value.trim() || null,
    startDate: document.getElementById('cal-entry-date').value,
    endDate: document.getElementById('cal-entry-end-date').value || null,
    allDay: allDay,
    startTime: allDay ? null : normalizeTimeInput(document.getElementById('cal-entry-start-time').value) || null,
    endTime: allDay ? null : normalizeTimeInput(document.getElementById('cal-entry-end-time').value) || null,
    category: category,
    color: CATEGORY_COLORS[category] || '#16a34a',
    caldavUid: null,
    caldavSynced: null,
    created: new Date().toISOString(),
    recurrence: recurrence,
    recurrenceUntil: recurrenceUntil,
    teamAssignees: teamAssignees,
    assignees: []
  };
  if (mode === 'edit') {
    const idx = calendarEvents.findIndex((x) => x.id === ev.id);
    if (idx >= 0) {
      ev.caldavUid = calendarEvents[idx].caldavUid;
      ev.created = calendarEvents[idx].created;
      calendarEvents[idx] = ev;
    }
    apiPatch('/api/calendar-events/' + encodeURIComponent(ev.id), {
      title: ev.title,
      description: ev.description,
      startDate: ev.startDate,
      endDate: ev.endDate,
      allDay: ev.allDay,
      startTime: ev.startTime,
      endTime: ev.endTime,
      category: ev.category,
      color: ev.color,
      recurrence: ev.recurrence,
      recurrenceUntil: ev.recurrenceUntil,
      teamAssignees: ev.teamAssignees
    });
  } else {
    calendarEvents.push(ev);
    apiPost('/api/calendar-events', ev).then((r) => {
      if (r && r.id) ev.id = r.id;
    });
  }
  renderCalendar();
  closeEntryModal();
  if (caldav.enabled && typeof pushEventCaldav === 'function') pushEventCaldav(ev);
}

function deleteEntry() {
  if (calEntryType === 'task') {
    const id = parseInt(document.getElementById('cal-entry-id').value);
    if (!id) {
      closeEntryModal();
      return;
    }
    closeEntryModal();
    confirm2(t('calEntry.deleteTask'), t('calEntry.deleteTaskMsg'), t('calEntry.delete'), () => {
      manualTasks = manualTasks.filter((x) => x.id !== id);
      apiDelete('/api/tasks/' + id);
      renderCalendar();
      updateTodoBadge();
    });
  } else {
    const id = document.getElementById('cal-entry-id').value;
    if (!id) return;
    const ce = calendarEvents.find((x) => x.id === id);
    const isRecurring = !!(ce && ce.recurrence);
    closeEntryModal();
    if (!isRecurring) {
      const dups = findSameTitleEvents(ce);
      if (dups.length) {
        confirm3(
          t('calEntry.deleteDupTitle'),
          t('calEntry.deleteDupMsg', { n: dups.length }),
          t('calEntry.deleteOnlyThis'),
          t('calEntry.deleteAllSameTitle', { n: dups.length + 1 }),
          () => {
            calendarEvents = calendarEvents.filter((x) => x.id !== id);
            apiDelete('/api/calendar-events/' + encodeURIComponent(id));
            renderCalendar();
          },
          () => deleteAllSameTitle([id, ...dups.map((d) => d.id)])
        );
        return;
      }
    }
    const title = isRecurring ? t('calEntry.deleteRecurTitle') : t('calEntry.deleteEvent');
    const body = isRecurring ? t('calEntry.deleteSeriesMsg') : t('calEntry.deleteEventMsg');
    confirm2(title, body, t('calEntry.delete'), () => {
      calendarEvents = calendarEvents.filter((x) => x.id !== id);
      apiDelete('/api/calendar-events/' + encodeURIComponent(id));
      renderCalendar();
    });
  }
}

function editTaskFromCalendar(taskId) {
  closeEventDetail();
  const tk = manualTasks.find((x) => x.created === taskId);
  if (tk) openEntryModal('task', tk.dueDate, null, tk);
}

function onCalMonthEventClick(type, id) {
  if (!type || !id) return;
  const events = collectCalendarEvents();
  const ev = events.find((e) => e.type === type && String(e.id) === String(id));
  if (ev) onCalEventClick(ev);
}

function openEventMoveModal(ev) {
  document.getElementById('cal-entry-title').textContent = t('calEntry.moveTitle');
  document.getElementById('cal-entry-id').value = '';
  document.getElementById('cal-entry-mode').value = 'move';
  document.getElementById('cal-entry-name').value = ev.label;
  document.getElementById('cal-entry-name').disabled = true;
  document.getElementById('cal-entry-date').value = ev.date;
  document.getElementById('cal-entry-enddate-wrap').style.display = 'none';
  document.getElementById('cal-entry-allday-wrap').style.display = 'none';
  document.getElementById('cal-entry-times').style.display = 'none';
  document.getElementById('cal-entry-prio-wrap').style.display = 'none';
  document.getElementById('cal-entry-desc').closest('div').style.display = 'none';
  document.getElementById('cal-entry-task-assign-wrap').style.display = 'none';
  document.getElementById('cal-entry-ev-assign-wrap').style.display = 'none';
  const recWrapMove = document.getElementById('cal-entry-recurrence-wrap');
  if (recWrapMove) recWrapMove.style.display = 'none';
  document.getElementById('cal-entry-private-wrap').style.display = 'none';
  document.getElementById('cal-entry-del-btn').style.display = 'none';
  document.getElementById('cal-entry-type-select').closest('.g2').style.display = 'none';
  document.getElementById('cal-entry-id').dataset.moveType = ev.type;
  document.getElementById('cal-entry-id').dataset.moveId = ev.id;
  document.getElementById('m-cal-entry').classList.add('open');
}

async function pushEventCaldav(ev) {
  if (!caldav.enabled) return;
  try {
    const r = await authFetch('/api/caldav/push-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: ev })
    }).then((r) => r.json());
    if (r.ok && r.uid) {
      ev.caldavUid = r.uid;
      ev.caldavSynced = new Date().toISOString();
      apiPatch('/api/calendar-events/' + encodeURIComponent(ev.id), {
        caldavUid: ev.caldavUid,
        caldavSynced: ev.caldavSynced
      });
    }
  } catch (e) {
    console.error('CalDAV event push error:', e);
  }
}

// ── User list + Assignee picker ──
async function loadAppUsers() {
  try {
    const r = await authFetch('/api/usernames');
    if (r.ok) appUsers = await r.json();
    fillCalendarUserFilter();
  } catch {
    appUsers = [];
  }
}
// Combined list of selectable people: registered users + manually-added team members (deduped)
function getSelectableAssignees() {
  const names = new Set();
  const out = [];
  (appUsers || []).forEach((u) => {
    if (u && u.username && !names.has(u.username)) {
      names.add(u.username);
      out.push(u.username);
    }
  });
  (teamMembers || []).forEach((m) => {
    if (m && m.name && !names.has(m.name)) {
      names.add(m.name);
      out.push(m.name);
    }
  });
  return out;
}
function fillCalendarUserFilter() {
  const sel = document.getElementById('cal-filter-user');
  if (!sel) return;
  const cur = sel.value;
  const names = getSelectableAssignees();
  sel.innerHTML =
    '<option value="">' +
    esc(t('calEntry.assignTo.all')) +
    '</option>' +
    names.map((n) => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
  sel.value = cur;
}
function renderAssigneePicker() {
  const box = document.getElementById('cal-ev-assignees');
  if (!box) return;
  const dd = document.getElementById('cal-ev-assignee-dropdown');
  if (!calEvSelectedAssignees.length) {
    box.innerHTML =
      '<span style="color:var(--c-text-muted);font-size:12px">' + esc(t('calEntry.allClickToSelect')) + '</span>';
  } else {
    box.innerHTML = calEvSelectedAssignees
      .map(
        (name) =>
          '<span class="assignee-chip">' +
          esc(name) +
          ' <button data-assignee-remove="' +
          esc(name) +
          '">×</button></span>'
      )
      .join('');
  }
  if (dd) {
    const names = getSelectableAssignees();
    if (!names.length) {
      dd.innerHTML =
        '<div style="padding:8px;font-size:12px;color:var(--c-text-muted)">' + esc(t('calEntry.noMembers')) + '</div>';
    } else {
      dd.innerHTML = names
        .map((n) => {
          const checked = calEvSelectedAssignees.includes(n);
          return (
            '<label style="display:flex;align-items:center;padding:6px 8px;cursor:pointer;font-size:12px;' +
            (checked ? 'background:#e8f5e9' : '') +
            '" data-assignee-toggle="' +
            esc(n) +
            '"><input type="checkbox" ' +
            (checked ? 'checked' : '') +
            ' style="width:auto;margin-right:6px" data-assignee-checkbox>' +
            esc(n) +
            '</label>'
          );
        })
        .join('');
    }
  }
}
function toggleAssigneeDropdown() {
  const dd = document.getElementById('cal-ev-assignee-dropdown');
  if (!dd) return;
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}
function toggleAssignee(name) {
  const i = calEvSelectedAssignees.indexOf(name);
  if (i >= 0) calEvSelectedAssignees.splice(i, 1);
  else calEvSelectedAssignees.push(name);
  renderAssigneePicker();
}
function getSelectedAssigneeIds() {
  return calEvSelectedAssignees.slice();
}
// Delegated click handlers for assignee picker (avoids inline onclick XSS)
(function () {
  const box = document.getElementById('cal-ev-assignees');
  if (box) {
    box.addEventListener('click', function (e) {
      const rm = e.target.closest('[data-assignee-remove]');
      if (!rm) return;
      e.stopPropagation();
      toggleAssignee(rm.dataset.assigneeRemove);
    });
  }
  const dd = document.getElementById('cal-ev-assignee-dropdown');
  if (dd) {
    dd.addEventListener('click', function (e) {
      const lbl = e.target.closest('[data-assignee-toggle]');
      if (!lbl) return;
      e.stopPropagation();
      e.preventDefault();
      toggleAssignee(lbl.dataset.assigneeToggle);
    });
  }
})();

// ── Task assignee picker (multi-select) ──
function renderTaskAssigneePicker() {
  const box = document.getElementById('cal-task-assignees');
  if (!box) return;
  const dd = document.getElementById('cal-task-assignee-dropdown');
  if (!calTaskSelectedAssignees.length) {
    box.innerHTML =
      '<span style="color:var(--c-text-muted);font-size:12px">' + esc(t('calEntry.allClickToSelect')) + '</span>';
  } else {
    box.innerHTML = calTaskSelectedAssignees
      .map(
        (name) =>
          '<span class="assignee-chip">' +
          esc(name) +
          ' <button data-task-assignee-remove="' +
          esc(name) +
          '">×</button></span>'
      )
      .join('');
  }
  if (dd) {
    const names = getSelectableAssignees();
    if (!names.length) {
      dd.innerHTML =
        '<div style="padding:8px;font-size:12px;color:var(--c-text-muted)">' + esc(t('calEntry.noMembers')) + '</div>';
    } else {
      dd.innerHTML = names
        .map((n) => {
          const checked = calTaskSelectedAssignees.includes(n);
          return (
            '<label style="display:flex;align-items:center;padding:6px 8px;cursor:pointer;font-size:12px;' +
            (checked ? 'background:#e8f5e9' : '') +
            '" data-task-assignee-toggle="' +
            esc(n) +
            '"><input type="checkbox" ' +
            (checked ? 'checked' : '') +
            ' style="width:auto;margin-right:6px" data-assignee-checkbox>' +
            esc(n) +
            '</label>'
          );
        })
        .join('');
    }
  }
}
function toggleTaskAssigneeDropdown() {
  const dd = document.getElementById('cal-task-assignee-dropdown');
  if (!dd) return;
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}
function toggleTaskAssignee(name) {
  const i = calTaskSelectedAssignees.indexOf(name);
  if (i >= 0) calTaskSelectedAssignees.splice(i, 1);
  else calTaskSelectedAssignees.push(name);
  renderTaskAssigneePicker();
}
// Delegated click handlers for task assignee picker (avoids inline onclick XSS)
(function () {
  const box = document.getElementById('cal-task-assignees');
  if (box) {
    box.addEventListener('click', function (e) {
      const rm = e.target.closest('[data-task-assignee-remove]');
      if (!rm) return;
      e.stopPropagation();
      toggleTaskAssignee(rm.dataset.taskAssigneeRemove);
    });
  }
  const dd = document.getElementById('cal-task-assignee-dropdown');
  if (dd) {
    dd.addEventListener('click', function (e) {
      const lbl = e.target.closest('[data-task-assignee-toggle]');
      if (!lbl) return;
      e.stopPropagation();
      e.preventDefault();
      toggleTaskAssignee(lbl.dataset.taskAssigneeToggle);
    });
  }
})();

async function loadCalDAVImports() {
  try {
    const r = await authFetch('/api/caldav/import');
    if (r.ok) caldavImports = await r.json();
  } catch (e) {
    caldavImports = [];
  }
}

// A plain declaration, like every other function here. It used to be
// `if (typeof pushBatchCaldav === 'undefined') window.pushBatchCaldav = ...`,
// guarding against a redefinition that never existed — nothing else in the repo
// defines this name. Its two call sites guarded in the same spirit
// (`if (typeof pushBatchCaldav === 'function')`), which meant that if this block
// ever failed to run, CalDAV push degraded to a silent no-op: batches would stop
// appearing in the shared calendar with no error and no failed request to notice.
// Declared normally it hoists, so the call sites can just call it — and ESLint can
// now see the binding, which is how this was found.
async function pushBatchCaldav(batch) {
  if (!caldav.enabled) return;
  try {
    await authFetch('/api/caldav/push-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch })
    });
  } catch (e) {
    console.warn('CalDAV push failed:', e.message);
  }
}

// All .modal-bg elements ship with a `hidden` attribute in index.html so the
// app degrades gracefully when styles.css fails to load (otherwise every modal
// renders as a visible block — the partner saw this when an SW-cached bad
// styles.css served on Android). The CSS rule .modal-bg.open { display:flex }
// already wins over UA [hidden] visually, but `hidden` also makes the element
// inert for keyboard + screen-reader users. This observer keeps the attribute
// in sync with the .open class so an opened modal is actually interactable.
(function syncModalHiddenWithOpen() {
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      const el = m.target;
      if (el.classList.contains('open')) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    }
  });
  document.querySelectorAll('.modal-bg').forEach((el) => {
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
})();

// Escape key closes the topmost open modal. Ordered by z-index (top → bottom):
// m-confirm is z-index 210, everything else is 200 — so m-confirm must come first
// so that a stacked confirm (e.g. bag-info → Remove → confirm) closes before the
// modal underneath.
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  const modals = [
    'm-confirm',
    'm-camscan',
    'm-cal-entry',
    'm-cal-detail',
    'm-locmove',
    'm-bagselect',
    'm-baginfo',
    'm-addbags',
    'm-batchadd',
    'm-note',
    'm-prompt',
    // m-move-batch before the two list modals below: the zone picker opens on
    // top of them, so Escape should dismiss it first.
    'm-move-batch',
    'm-zonecheck',
    'm-worklist'
  ];
  for (const id of modals) {
    const el = document.getElementById(id);
    if (el && el.classList.contains('open')) {
      // Placement gate: Escape must not strand a freshly created batch.
      if (id === 'm-move-batch' && _zpMandatory()) return;
      if (id === 'm-bagselect') bsClose();
      // closeCamScan() stops the MediaStream + decode loop; just removing the
      // 'open' class would leave the camera live (LED on, battery drain,
      // barcodes still firing processScan) behind a hidden modal.
      else if (id === 'm-camscan') closeCamScan();
      else el.classList.remove('open');
      return;
    }
  }
});

initEventListeners();
loadCurrentUser();
loadAppUsers();
loadData();
// Primary: SSE for instant updates. Fallback: poll every 30s (was 5s) for stale detection.
connectSSE();
setInterval(pollSync, 30000);

// Register service worker for PWA / offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'offline-queue-update') {
      updateOfflineBadge(e.data.pendingCount);
    }
    // I-12: SW dropped a queued MOVE because the server returned 409
    // (the bag was moved by another user while this entry was offline).
    // Surface a toast so the user knows their MOVE didn't apply.
    if (e.data && e.data.type === 'scan-replay-rejected') {
      const cur = e.data.current_zone ? zoneDisplayName(e.data.current_zone) : 'unbekannt';
      const bag = e.data.bag || '';
      try {
        if (typeof setFb === 'function') {
          setFb('err', `MOVE rejected: bag ${bag} was moved by another user. Current zone: ${cur}`);
        }
      } catch {
        /* setFb not yet wired — drop silently */
      }
    }
    // R-21: SW dropped the oldest scans because the offline queue hit its cap.
    // Surface a toast so the user knows some scans were lost and can re-scan
    // critical bags if needed before going back online.
    if (e.data && e.data.type === 'scan-queue-overflow') {
      const dropped = e.data.dropped || 0;
      const max = e.data.max || 0;
      try {
        if (typeof setFb === 'function') {
          setFb('err', t('sw.scanQueueOverflow', { dropped, max }));
        }
      } catch {
        /* setFb not yet wired — drop silently */
      }
    }
  });
  window.addEventListener('online', () => {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'replay-pending' });
    }
  });
}

function updateOfflineBadge(count) {
  let badge = document.getElementById('offline-badge');
  if (count === 0) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'offline-badge';
    badge.style.cssText =
      'display:inline-block;background:var(--c-red);color:#fff;font-size:10px;padding:2px 6px;border-radius:8px;margin-left:6px;font-weight:600';
    const syncEl = document.getElementById('sync-label');
    if (syncEl) syncEl.parentNode.appendChild(badge);
    else document.querySelector('.topbar')?.appendChild(badge);
  }
  badge.textContent = t('offline.queued', { n: count });
}

// ─── EVENT LISTENERS (CSP-safe, no inline handlers) ─────────────
// Camera lifecycle state machine. Was two booleans (_camScanner !== null +
// _camClosing) which left a sliver between "closed" and "ready-to-reopen"
// where Html5Qrcode raced on the underlying MediaStream — workers reported
// intermittent "camera already in use" errors. Explicit states make the
// transition order obvious and let callers (closeCamScan, flipCamera,
// visibilitychange) bail out cleanly if they're already in a transition.
const CAM_IDLE = 'idle';
const CAM_OPENING = 'opening';
const CAM_OPEN = 'open';
const CAM_CLOSING = 'closing';
let _camState = CAM_IDLE;
let _camScanner = null;
// Dedup window: if the same barcode is decoded again within this many ms,
// the second read is silently dropped. Stops a 1D-barcode that's still in
// frame after the resume from immediately re-firing the same scan.
const SCAN_DEDUP_MS = 3000;
// Pause between accepting consecutive scans. The old 1.5 s value was
// generous safety margin against double-reads; with the dedup window above,
// 800 ms is plenty and lets workers scan a row of 20 bags ~14 s faster.
const SCAN_PAUSE_MS = 800;
// Stocktake pause: every bag is a distinct code and the dedup window above
// already blocks re-reads of the same label, so this only needs to be long
// enough to move the phone to the next bag.
const ZC_SCAN_PAUSE_MS = 250;
let _camLastDecoded = '';
let _camLastDecodedAt = 0;
// Persisted between sessions so workers who flipped to the front camera once
// (e.g. to scan a label they were holding up to themselves) don't have to flip
// every time. Falls back to 'environment' (rear) for first-time / desktop use.
let _camFacingMode = (function () {
  try {
    const v = localStorage.getItem('mp-cam-facing');
    return v === 'user' || v === 'environment' ? v : 'environment';
  } catch {
    return 'environment';
  }
})();
let _camTorchOn = false;
// Returns the active video MediaStreamTrack from the html5-qrcode reader, or
// null if the camera hasn't attached one yet.
function _camActiveTrack() {
  const video = document.querySelector('#cam-reader video');
  if (!video || !video.srcObject) return null;
  const tracks = video.srcObject.getVideoTracks();
  return tracks && tracks.length ? tracks[0] : null;
}
// After scanner.start resolves, html5-qrcode may take a moment to attach the
// <video> element. Poll briefly, then show the torch button if the track
// reports torch capability. Most desktop webcams and the front camera do not.
function _detectTorchSupport() {
  let attempts = 0;
  function check() {
    const track = _camActiveTrack();
    if (!track || !track.getCapabilities) {
      if (attempts++ < 10) setTimeout(check, 100);
      return;
    }
    let caps;
    try {
      caps = track.getCapabilities();
    } catch (e) {
      return;
    }
    const btn = document.getElementById('btn-cam-torch');
    if (btn) btn.hidden = !caps || !caps.torch;
  }
  check();
}
function toggleTorch() {
  const track = _camActiveTrack();
  if (!track || !track.applyConstraints) return;
  const newState = !_camTorchOn;
  track
    .applyConstraints({ advanced: [{ torch: newState }] })
    .then(function () {
      _camTorchOn = newState;
      const btn = document.getElementById('btn-cam-torch');
      if (btn) btn.classList.toggle('torch-on', _camTorchOn);
    })
    .catch(function (err) {
      console.error('Torch toggle failed:', err);
    });
}
function openCamScan() {
  _initScanAudio(); // Init AudioContext during user gesture (required by iOS)
  document.getElementById('m-camscan').classList.add('open');
  updateCamHud(); // Sync HUD with current scan state
  // Anything other than idle is an in-flight transition; the modal is already
  // open visually so this no-op is fine (e.g. user double-tapped the FAB).
  if (_camState !== CAM_IDLE) return;
  _camState = CAM_OPENING;
  // P-02: html5-qrcode is now lazy-loaded. If the idle-time preload hasn't
  // finished yet (user tapped scan within the first ~500 ms of page load),
  // fetch it now. Falls back to synchronous behaviour the moment the
  // promise resolves — which is usually instant because either the idle
  // preload already kicked it off, or the SW has it pre-cached.
  if (typeof Html5Qrcode === 'undefined') {
    loadVendorLibs().then(() => {
      // Re-enter so the scanner state machine sees a proper state transition.
      _camState = CAM_IDLE;
      openCamScan();
    });
    return;
  }
  _camScanner = new Html5Qrcode('cam-reader');
  const scanner = _camScanner;
  scanner
    .start(
      { facingMode: _camFacingMode },
      {
        fps: 10,
        qrbox: function (vw, vh) {
          // Wide-short rectangle — fits 1D barcodes (EAN/Code128) without clipping,
          // and QR codes still sit comfortably inside the width. Bumped from
          // 0.88×0.38 to 0.95×0.45 so 1D barcodes printed at 50×30 mm aren't a
          // hit-or-miss target on phones held at typical reading distance
          // (audit Section 1.5 — scan target was <44 mm wide on screen).
          const w = Math.floor(Math.min(vw, vh) * 0.95);
          const h = Math.max(80, Math.floor(w * 0.45));
          return { width: w, height: h };
        },
        aspectRatio: 1.0
      },
      function (decoded) {
        if (scanner !== _camScanner) return;
        // Dedup: same code re-decoded inside the dedup window is silently
        // dropped. Workers running through 20 bags don't see ghost re-fires
        // when a 1D label lingers in frame across the pause boundary.
        const now = Date.now();
        if (decoded === _camLastDecoded && now - _camLastDecodedAt < SCAN_DEDUP_MS) {
          return;
        }
        _camLastDecoded = decoded;
        _camLastDecodedAt = now;
        scanner.pause(true);
        processScan(decoded);
        // Stocktake runs bag-to-bag at pace, and every bag is a different code,
        // so the 3 s dedup window already covers double-reads — a long pause on
        // top of it just makes the walk feel sluggish.
        const pauseMs = _zcScanMode ? ZC_SCAN_PAUSE_MS : SCAN_PAUSE_MS;
        setTimeout(function () {
          // Only resume if we're still the active scanner AND the state hasn't
          // moved to closing in the meantime.
          if (scanner === _camScanner && _camState === CAM_OPEN) {
            try {
              scanner.resume();
            } catch (e) {}
          }
        }, pauseMs);
      },
      function () {}
    )
    .then(function () {
      // If the modal was closed (or re-opened) while start() was still pending,
      // this scanner is orphaned: closeCamScan ran before the stream existed, so
      // its stop() no-op'd and the camera is now live with no owner. Stop it and
      // don't clobber _camState (which would strand the next openCamScan).
      if (scanner !== _camScanner) {
        try {
          scanner
            .stop()
            .then(function () {
              try {
                scanner.clear();
              } catch (e) {}
            })
            .catch(function () {});
        } catch (e) {}
        return;
      }
      _camState = CAM_OPEN;
      _detectTorchSupport();
    })
    .catch(function (err) {
      _camState = CAM_IDLE;
      _camScanner = null;
      console.error('Camera start failed:', err);
      const s = String(err);
      // Permission-denied is its own path because workers on a brand-new phone
      // see only a one-shot toast and have no idea how to recover. Show the
      // platform-specific recovery steps as a confirm-style modal that stays
      // on screen until they tap OK.
      if (/NotAllowedError|Permission/.test(s)) {
        closeCamScan();
        confirm2(t('cam.permDeniedTitle'), t('cam.permDeniedHelp'), t('common.ok'), function () {});
        return;
      }
      let msg;
      if (/NotFoundError/.test(s)) msg = t('cam.notFound');
      else if (/NotReadableError|TrackStartError/.test(s)) msg = t('cam.inUse');
      else msg = t('cam.unknownError', { err: err });
      setFb('err', msg);
      closeCamScan();
    });
}
function closeCamScan() {
  document.getElementById('m-camscan').classList.remove('open');
  // Closing the camera ends inoculant-picking; without this every later bag scan
  // would keep feeding a form the worker has already left. Captured first — the
  // restore below needs to know who opened the camera, and clearing it before
  // asking would always read as "nobody".
  const _wasScanning = _inocScanPrefix;
  _inocScanPrefix = null;
  // Bring the quick dialog back if it stepped aside for the camera.
  msqRestoreAfterScan(_wasScanning);
  // Finishing a stocktake scan drops you back on the check sheet, with whatever
  // you scanned already ticked off and the leftovers ready to resolve.
  if (_zcScanMode) {
    _zcScanMode = false;
    renderZoneCheck();
    document.getElementById('m-zonecheck').classList.add('open');
  }
  // Reset torch state and visual: the next openCamScan call will re-detect
  // capability on a fresh track. Keeping torch-on style across closes would
  // lie about the actual hardware state.
  _camTorchOn = false;
  const torchBtn = document.getElementById('btn-cam-torch');
  if (torchBtn) {
    torchBtn.classList.remove('torch-on');
    torchBtn.hidden = true;
  }
  // Already closed (or in the middle of closing) — nothing to do.
  if (_camState === CAM_IDLE || _camState === CAM_CLOSING) return;
  if (!_camScanner) {
    _camState = CAM_IDLE;
    return;
  }
  const scanner = _camScanner;
  _camScanner = null;
  _camState = CAM_CLOSING;
  scanner
    .stop()
    .then(function () {
      scanner.clear();
    })
    .catch(function () {
      // Force-stop media tracks if library cleanup fails (iOS Safari)
      const vids = document.getElementById('cam-reader').querySelectorAll('video');
      vids.forEach(function (v) {
        if (v.srcObject)
          v.srcObject.getTracks().forEach(function (t) {
            t.stop();
          });
      });
      try {
        scanner.clear();
      } catch (e) {}
    })
    .finally(function () {
      _camState = CAM_IDLE;
    });
}
// Stop camera when tab is hidden (saves battery, prevents "camera in use" on other apps)
document.addEventListener('visibilitychange', function () {
  if (document.hidden && _camState !== CAM_IDLE) closeCamScan();
});
function flipCamera() {
  _camFacingMode = _camFacingMode === 'environment' ? 'user' : 'environment';
  try {
    localStorage.setItem('mp-cam-facing', _camFacingMode);
  } catch {
    /* ignore — quota or private mode */
  }
  // Only re-open the modal if the camera is currently visible/running.
  // CAM_OPENING is included so a quick double-flip while opening still
  // restarts with the new facing mode once it lands.
  if (_camState === CAM_OPEN || _camState === CAM_OPENING) {
    closeCamScan();
    setTimeout(openCamScan, 300);
  }
}
// Undo the most recent non-HARVEST scan from inside the camera HUD.
// Reuses undoScanEntry via the hidden scan-log row (created on every successful scan).
function camUndoLastScan() {
  if (!sessionEntries || sessionEntries.length === 0) {
    _showCamHudToast('info', t('cam.nothingToUndo'));
    return;
  }
  let last = null;
  for (let i = sessionEntries.length - 1; i >= 0; i--) {
    if (sessionEntries[i].action !== 'HARVEST') {
      last = sessionEntries[i];
      break;
    }
  }
  if (!last) {
    _showCamHudToast('info', t('cam.nothingToUndo'));
    return;
  }
  const btn = document.querySelector('[data-scan-id="' + last._tempId + '"] .sle-undo');
  if (btn) undoScanEntry(btn);
}
function copyCalDavUrl() {
  const url = document.getElementById('caldav-url-display').textContent;
  navigator.clipboard
    .writeText(url)
    .then(() => {
      const b = document.getElementById('btn-45');
      b.textContent = t('common.copied');
      setTimeout(() => {
        b.textContent = t('common.copy');
      }, 2000);
    })
    .catch(() => {});
}

function initEventListeners() {
  const $ = (id) => document.getElementById(id);

  // Modals
  $('addbags-cancel-btn').addEventListener('click', () => {
    document.getElementById('m-addbags').classList.remove('open');
  });
  $('addbags-confirm-btn').addEventListener('click', confirmAddBags);
  $('ab-done-btn').addEventListener('click', () => {
    document.getElementById('m-addbags').classList.remove('open');
  });
  $('ab-print-btn').addEventListener('click', printNewBags);
  $('m-cancel').addEventListener('click', closeConfirm);
  $('change-pw-modal').addEventListener('click', function (e) {
    if (e.target === this) hideChangePasswordModal();
  });
  $('btn-1').addEventListener('click', hideChangePasswordModal);
  $('act-2').addEventListener('click', submitChangePassword);
  $('cls-3').addEventListener('click', closeNote);
  $('act-4').addEventListener('click', saveNote);
  $('m-cal-detail').addEventListener('click', function (e) {
    if (e.target === this) closeEventDetail();
  });
  $('ba-batch').addEventListener('change', baPreview);
  $('ba-loc').addEventListener('change', baPreview);
  $('cls-7').addEventListener('click', closeBatchAdd);
  $('act-8').addEventListener('click', confirmBatchAdd);
  $('m-locmove').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('open');
  });
  $('cls-9').addEventListener('click', () => {
    document.getElementById('m-locmove').classList.remove('open');
  });
  // Move-batch modal
  $('mb-cancel-btn').addEventListener('click', () => {
    if (_zpMandatory()) return;
    document.getElementById('m-move-batch').classList.remove('open');
  });
  $('m-move-batch').addEventListener('click', function (e) {
    if (e.target === this && !_zpMandatory()) this.classList.remove('open');
  });
  // Delegated actions for the m-locmove modal. The dashboard bag-move picker no
  // longer uses it (it shares _openZonePicker now); the Zonen page still reuses
  // this modal for its "move loose bags into a rack" grid.
  document.getElementById('m-locmove').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'bulk-rack-target':
        executeBulkMoveToRack(btn.dataset.zone, btn.dataset.rack);
        break;
    }
  });
  $('btn-10').addEventListener('click', locRemoveSelected);
  $('cls-11').addEventListener('click', () => {
    document.getElementById('m-baginfo').classList.remove('open');
  });
  $('bi-actions').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-bi]');
    if (!btn) return;
    const a = btn.dataset.bi;
    if (a === 'scope-single') {
      biWholeBatch = false;
      renderBiActions();
      return;
    }
    if (a === 'scope-batch') {
      biWholeBatch = true;
      renderBiActions();
      return;
    }
    if (!biBatchId) return;
    if (a === 'harvest') return biOpenHarvest();
    if (a === 'contam') return biReportContam();
    if (a === 'remove') return biConfirmRemove();
    // Same explicit target as the dashboard one-tap — this button names no tent
    // either, so it must not resolve to a different one.
    if (a === 'fruchtung') return biMoveTo(fruitingTarget());
    if (a === 'move') {
      document.getElementById('m-baginfo').classList.remove('open');
      _openZonePicker(t('batch.moveTo') + ' — ' + biBagId, function (dest) {
        biMoveTo(dest);
      });
    }
  });
  $('bs-cancel').addEventListener('click', bsClose);
  $('bs-continue').addEventListener('click', () => {
    bsConfirm();
  });

  // Contamination report modal wiring
  $('cls-cr').addEventListener('click', closeContamReport);
  $('cr-cancel').addEventListener('click', closeContamReport);
  $('cr-submit').addEventListener('click', _crSubmit);
  document.getElementById('m-contam-report').addEventListener('click', (e) => {
    if (e.target.id === 'm-contam-report') closeContamReport();
  });
  // Type picker — event delegation since the grid is re-rendered on selection
  $('cr-type-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.contam-type-btn');
    if (!btn) return;
    const id = parseInt(btn.dataset.typeId, 10);
    if (!isNaN(id)) _crSelectType(id);
  });
  $('cr-severity-row').addEventListener('click', (e) => {
    const btn = e.target.closest('.contam-sev-btn');
    if (!btn) return;
    _crSeverity = btn.dataset.sev;
    document.querySelectorAll('#cr-severity-row .contam-sev-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    // Update auto-MOVE checkbox to the recommended default for this severity.
    // Worker can still override before submit. Don't override an already-set
    // explicit choice — only flip if the previous default matches current state.
    const autoMoveEl = document.getElementById('cr-auto-move');
    if (autoMoveEl) {
      const recommended = _crSeverity === 'major' || _crSeverity === 'lost';
      autoMoveEl.checked = recommended;
    }
  });
  // Photo tiles — add tile triggers file input; remove buttons splice the photo;
  // tile body taps open the annotation editor (draw on the photo before submit).
  $('cr-photo-tiles').addEventListener('click', (e) => {
    if (e.target.closest('#cr-add-photo')) {
      $('cr-file-input').click();
      return;
    }
    const rm = e.target.closest('[data-cr-remove]');
    if (rm) {
      const idx = parseInt(rm.dataset.crRemove, 10);
      if (!isNaN(idx)) {
        _crPhotos.splice(idx, 1);
        _renderCrPhotos();
      }
      return;
    }
    const editTile = e.target.closest('[data-cr-edit]');
    if (editTile) {
      const idx = parseInt(editTile.dataset.crEdit, 10);
      if (!isNaN(idx)) openAnnotate(idx);
    }
  });
  $('cr-file-input').addEventListener('change', (e) => {
    _crAddFiles(e.target.files);
    e.target.value = ''; // allow picking the same file twice
  });
  // Photo annotation modal wiring
  const _paCanvas = $('pa-canvas');
  if (_paCanvas) {
    _paCanvas.addEventListener('pointerdown', _paStart);
    _paCanvas.addEventListener('pointermove', _paMove);
    _paCanvas.addEventListener('pointerup', _paEnd);
    _paCanvas.addEventListener('pointercancel', _paEnd);
    _paCanvas.addEventListener('pointerleave', _paEnd);
  }
  $('pa-clear').addEventListener('click', _paClear);
  $('pa-cancel').addEventListener('click', closeAnnotate);
  $('pa-done').addEventListener('click', _paDone);
  // Backdrop tap dismisses (treat as cancel)
  document.getElementById('m-photo-annotate').addEventListener('click', (e) => {
    if (e.target.id === 'm-photo-annotate') closeAnnotate();
  });
  $('m-camscan').addEventListener('click', function (e) {
    if (e.target === this) closeCamScan();
  });
  $('cls-16').addEventListener('click', closeCamScan);
  $('btn-flip-cam').addEventListener('click', flipCamera);
  $('btn-cam-torch').addEventListener('click', toggleTorch);
  $('btn-cam-undo').addEventListener('click', camUndoLastScan);
  $('btn-cam-reset').addEventListener('click', function () {
    resetScan();
    _showCamHudToast('info', t('cam.scanCleared'));
  });

  // Sidebar navigation
  $('sb-toggle').addEventListener('click', toggleSidebar);
  $('n-dash').addEventListener('click', () => {
    go('dash', 'n-dash');
  });
  $('n-cal').addEventListener('click', () => {
    go('cal', 'n-cal');
  });
  // Notifications bell (desktop + mobile share the same dropdown)
  const notifBtn = $('n-notif');
  if (notifBtn) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openNotifDropdown(notifBtn);
    });
  }
  const notifBtnM = $('n-notif-m');
  if (notifBtnM) {
    notifBtnM.addEventListener('click', (e) => {
      e.stopPropagation();
      openNotifDropdown(notifBtnM);
    });
  }
  const notifMarkRead = $('notif-mark-read');
  if (notifMarkRead) {
    notifMarkRead.addEventListener('click', (e) => {
      e.stopPropagation();
      markAllNotifRead();
    });
  }
  $('n-batch').addEventListener('click', () => {
    batchAttentionFilter = null;
    go('batch', 'n-batch');
  });
  $('n-lab').addEventListener('click', () => {
    go('lab', 'n-lab');
  });
  // Mobile bottom-nav buttons delegate to their sidebar counterparts so any
  // side effects (e.g. n-batch resetting batchAttentionFilter) stay in one place.
  ['bn-dash', 'bn-batch', 'bn-lab', 'bn-cal'].forEach((bnId) => {
    const sidebarId = 'n-' + bnId.slice(3);
    const btn = $(bnId);
    if (btn) btn.addEventListener('click', () => $(sidebarId).click());
  });
  $('n-inv').addEventListener('click', () => {
    go('inv', 'n-inv');
  });
  $('n-zones').addEventListener('click', () => {
    go('zones', 'n-zones');
  });
  $('n-strains').addEventListener('click', () => {
    go('strains', 'n-strains');
    renderStrains();
  });
  $('n-pickups').addEventListener('click', () => {
    go('pickups', 'n-pickups');
  });
  // "Verkauf" group: four top-level entries that open the orders page at the
  // matching view (the sub-tab bar is hidden; openStab still fires the render).
  $('n-orders-inbox').addEventListener('click', () => {
    go('orders', 'n-orders-inbox');
    openStab('orders', 'inbox');
  });
  $('n-orders-demand').addEventListener('click', () => {
    go('orders', 'n-orders-demand');
    openStab('orders', 'tomake');
  });
  $('n-orders-mapping').addEventListener('click', () => {
    go('orders', 'n-orders-mapping');
    openStab('orders', 'mapping');
  });
  $('n-orders-customers').addEventListener('click', () => {
    go('orders', 'n-orders-customers');
    openStab('orders', 'customers');
  });
  $('n-orders-versand').addEventListener('click', () => {
    go('orders', 'n-orders-versand');
    openStab('orders', 'versand');
  });
  $('st-orders-inbox').addEventListener('click', () => openStab('orders', 'inbox'));
  $('st-orders-tomake').addEventListener('click', () => openStab('orders', 'tomake'));
  $('st-orders-mapping').addEventListener('click', () => openStab('orders', 'mapping'));
  $('st-orders-customers').addEventListener('click', () => openStab('orders', 'customers'));
  $('st-orders-versand').addEventListener('click', () => openStab('orders', 'versand'));
  $('p-orders').addEventListener('click', ordersActionHandler);
  const _ohCsv = $('orders-csv-file');
  if (_ohCsv)
    _ohCsv.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) _ordersImportCsv(f);
      e.target.value = '';
    });
  $('btn-add-zone').addEventListener('click', addZone);
  $('rhythm-cancel').addEventListener('click', closeRhythmEditor);
  $('rhythm-save').addEventListener('click', saveRhythmEditor);
  $('btn-print-all-zone-qr').addEventListener('click', printAllZoneQrBrowser);
  $('zone-role').addEventListener('change', function () {
    const c = { spawn: '#a855f7', incubation: '#0ea5e9', fruiting: '#10b981', contaminated: '#ef4444' }[this.value];
    if (c) document.getElementById('zone-color').value = c;
  });
  // Zone list event delegation (CSP blocks inline onclick)
  $('zones-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'del-zone') removeZone(btn.dataset.zone);
    else if (action === 'rename-zone') renameZone(btn.dataset.zone);
    else if (action === 'zone-capacity') editZoneCapacity(btn.dataset.zone);
    else if (action === 'add-rack') addRackToZone(btn.dataset.zone);
    else if (action === 'del-rack') removeRack(btn.dataset.rack);
    else if (action === 'toggle-qr') renderZoneQrPanel(btn.dataset.zone);
    else if (action === 'print-zone-qr') printZoneQrBrowser(btn.dataset.zone);
    else if (action === 'bulk-move') bulkMoveToRack(btn.dataset.zone);
  });
  // Drag-and-drop zone reordering.
  const zonesList = $('zones-list');
  zonesList.addEventListener('dragstart', onZoneDragStart);
  zonesList.addEventListener('dragover', onZoneDragOver);
  zonesList.addEventListener('drop', onZoneDrop);
  zonesList.addEventListener('dragend', onZoneDragEnd);
  zonesList.addEventListener('dragleave', (e) => {
    // Clear hints only when leaving the list entirely, not when moving between rows.
    if (!zonesList.contains(e.relatedTarget)) clearZoneDropHints();
  });
  $('n-print').addEventListener('click', () => {
    go('print', 'n-print');
  });
  $('n-settings').addEventListener('click', () => {
    go('settings', 'n-settings');
  });
  $('sync-dot').addEventListener('click', loadData);
  $('lang-sel').addEventListener('change', function () {
    setLang(this.value);
  });
  $('tgl-17').addEventListener('click', toggleSidebar);
  $('sync-dot-m').addEventListener('click', loadData);
  $('sb-overlay').addEventListener('click', toggleSidebar);

  // Scan modal
  $('scan-overlay').addEventListener('click', closeScanModal);
  $('scan-modal').addEventListener('click', (e) => e.stopPropagation());
  $('cls-18').addEventListener('click', closeScanModal);
  $('set-19').addEventListener('click', resetScan);
  $('btn-20').addEventListener('click', openBatchAdd);
  $('btn-end-session').addEventListener('click', endScanSession);
  // Destination chips are tappable — pick a target when its barcode can't be scanned.
  $('chip-to').addEventListener('click', scanPickDestination);
  $('cam-chip-to').addEventListener('click', scanPickDestination);
  $('chip-to').title = t('scan.pickDest');
  $('cam-chip-to').title = t('scan.pickDest');
  $('btn-scan-cam').addEventListener('click', function () {
    openCamScan();
  });
  $('btn-scan-audio').addEventListener('click', function () {
    scanAudioEnabled = !scanAudioEnabled;
    this.style.opacity = scanAudioEnabled ? 1 : 0.4;
  });
  // Scan modal tab navigation
  document.querySelectorAll('.scan-tab').forEach(function (tabBtn) {
    tabBtn.addEventListener('click', function () {
      const name = this.getAttribute('data-scan-tab');
      switchScanTab(name);
      if (name === 'successes') renderScanSuccesses();
    });
  });

  // Harvest panel
  $('act-21').addEventListener('click', () => confirmHarvest(false));
  $('hp-next').addEventListener('click', () => confirmHarvest(true));
  $('btn-22').addEventListener('click', cancelHarvest);

  // Dashboard
  $('status-q').addEventListener('input', renderStatus);
  // Delegated clicks for Batch tasks + Ready-to-harvest cards
  function dashTaskCardClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'dash-dest') {
      setFruitingTarget(el.dataset.zone);
      return;
    }
    if (action === 'edit-rhythm') {
      openRhythmEditor();
      return;
    }
    if (action === 'rhythm-log') {
      logRhythmProgress(el.dataset.date, Number(el.dataset.target), Number(el.dataset.done));
      return;
    }
    if (action === 'rhythm-target') {
      editRhythmTarget(el.dataset.date, Number(el.dataset.target));
      return;
    }
    if (action === 'dash-print') {
      // 'move' is the walk this card is mostly about; the modal has its own
      // group switcher for the rest.
      openWorkList('move');
      return;
    }
    if (action === 'dash-room-more') {
      toggleDashRoom(el.dataset.room);
      return;
    }
    if (action === 'dash-day') {
      setDashDay(el.dataset.off);
      return;
    }
    if (action === 'bulk-fruiting') {
      bulkSectionToFruiting(el.dataset.bucket);
      return;
    }
    const batch = el.dataset.batch;
    if (!batch) return;
    switch (action) {
      case 'go-to-batch':
        goToBatch(batch);
        break;
      case 'open-move-modal':
        openMoveBatchModal(batch);
        break;
      case 'move-to-fruiting':
        moveBatchToFruiting(batch);
        break;
      case 'inoculate-from':
        inoculateFromBatch(batch);
        break;
    }
  }
  $('dash-batch-tasks').addEventListener('click', dashTaskCardClick);
  $('wl-close').addEventListener('click', () => document.getElementById('m-worklist').classList.remove('open'));
  $('wl-print').addEventListener('click', printWorkList);
  $('m-worklist').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('open');
    const seg = e.target.closest('[data-wl-group]');
    if (seg) {
      setWorkListMode(seg.dataset.wlGroup);
      return;
    }
    const row = e.target.closest('[data-wl-batch]');
    if (row) {
      this.classList.remove('open');
      goToBatch(row.dataset.wlBatch);
    }
  });
  $('dash-alerts').addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'go-attention':
        goToBatchesAttention(el.dataset.key);
        break;
      case 'go-page':
        go(el.dataset.page, el.dataset.btn);
        break;
    }
  });
  // The two creation flows keep one-tap buttons on the dashboard; the speed-dial
  // FAB carries the same actions for every other page.
  $('dash-act-newbatch').addEventListener('click', msQuickChargeNew);
  $('dash-act-labwork').addEventListener('click', msQuickLaborNew);
  applyDashMode();
  initDashCollapse();

  // Batches — delegated actions for dynamically rendered rows + attention banner (CSP-safe)
  $('sp-batch-list').addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const batch = el.dataset.batch;
    switch (el.dataset.action) {
      case 'batch-group':
        toggleBatchGroup(el.dataset.key);
        break;
      case 'toggle-bags':
        toggleBatchBags(batch);
        break;
      case 'open-note':
        openNote(batch);
        break;
      case 'add-bags':
        openAddBags(batch);
        break;
      case 'del-batch':
        delBatch(batch);
        break;
      case 'open-move-modal':
        openMoveBatchModal(batch);
        break;
      case 'clear-attention':
        clearBatchAttentionFilter();
        break;
    }
  });
  $('st-batch-list').addEventListener('click', () => {
    openStab('batch', 'list');
  });
  $('st-batch-new').addEventListener('click', () => openStab('batch', 'new'));
  $('st-batch-harvest').addEventListener('click', () => {
    openStab('batch', 'harvest');
  });
  $('batch-q').addEventListener('input', renderBatches);
  $('batch-archive-filter').addEventListener('change', renderBatches);
  // One listener per registered sortable table, wired the same way, so a new
  // table needs only its entry in SORT_TABLES and data-sort on its headers.
  const SORT_RERENDER = { batches: renderBatches, cultures: renderCultures, harvests: renderHarvests, grain: renderGrainBatches };
  for (const table in SORT_TABLES) {
    const body = document.getElementById(SORT_TABLES[table]);
    const thead = body && body.closest('table') ? body.closest('table').tHead : null;
    if (!thead) continue;
    thead.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      cycleTableSort(table, th.dataset.sort);
      const redraw = SORT_RERENDER[table];
      if (redraw) redraw();
    });
  }
  $('wbtn-3').addEventListener('click', () => {
    setBagWeight(3);
  });
  $('wbtn-5').addEventListener('click', () => {
    setBagWeight(5);
  });
  $('nb-weight').addEventListener('input', nbPreview);
  $('nb-strain-sel').addEventListener('change', nbPreview);
  $('nb-qty').addEventListener('input', nbPreview);
  $('nb-hw').addEventListener('input', nbSubSum);
  $('nb-wb').addEventListener('input', nbSubSum);
  $('nb-rh').addEventListener('input', nbPreview);
  $('ms-save-btn').addEventListener('click', saveMStrain);
  $('ms-cancel-btn').addEventListener('click', cancelMStrain);
  $('btn-24').addEventListener('click', createBatch);
  // "Beimpft mit" — one control, two places. The quick dialog hides itself for
  // the camera (msqOpenScan); the manual form just arms and opens.
  $('ms-q-inoc-scan').addEventListener('click', () => msqOpenScan('ms-q'));
  $('nb-inoc-scan').addEventListener('click', () => {
    _inocScanPrefix = 'nb';
    scan.action = null;
    scan.to = null;
    scan.from = null;
    updateSD();
    openCamScan();
  });
  ['nb', 'ms-q'].forEach((prefix) => {
    const chips = document.getElementById(prefix + '-inoc-chips');
    if (!chips) return;
    chips.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="inoc-drop"]');
      if (!btn) return;
      inocRemove(btn.dataset.id);
      inocRender(prefix);
    });
  });
  const strainShortcut = document.getElementById('nb-create-strain-btn');
  if (strainShortcut) strainShortcut.addEventListener('click', goCreateStrain);
  $('prt-25').addEventListener('click', printBatchLabelsInline);
  $('prt-25-opts').addEventListener('click', goToPrintBatch);
  $('harvest-q').addEventListener('input', renderHarvests);

  // Lab
  $('st-lab-cultures').addEventListener('click', () => {
    openStab('lab', 'cultures');
  });
  $('st-lab-grain').addEventListener('click', () => {
    openStab('lab', 'grain');
    renderGrainBatches();
  });
  $('grain-q').addEventListener('input', renderGrainBatches);
  $('st-lab-work').addEventListener('click', () => msQuickLaborNew());
  $('st-lab-lineage').addEventListener('click', () => {
    openStab('lab', 'lineage');
  });
  $('st-lab-contam').addEventListener('click', () => {
    openStab('lab', 'contam');
  });
  // Contamination list filters + drill-down + delete
  ['cl-type-filter', 'cl-sev-filter', 'cl-status-filter', 'cl-since-filter'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('change', renderContamReports);
  });
  $('cl-reset').addEventListener('click', () => {
    $('cl-type-filter').value = '';
    $('cl-sev-filter').value = '';
    $('cl-status-filter').value = '';
    $('cl-since-filter').value = '';
    renderContamReports();
  });
  $('contam-list').addEventListener('click', (e) => {
    const card = e.target.closest('[data-cl-id]');
    if (!card) return;
    const id = parseInt(card.dataset.clId, 10);
    if (!isNaN(id)) openContamDetail(id);
  });
  $('cls-cd').addEventListener('click', closeContamDetail);
  $('cd-close').addEventListener('click', closeContamDetail);
  $('cd-delete').addEventListener('click', _cdDelete);
  // Resolve buttons + Reopen are rendered inside cd-body so they're delegated
  // off the body container — refreshes after each action keep wiring intact.
  $('cd-body').addEventListener('click', (e) => {
    const resolveBtn = e.target.closest('[data-cd-resolve]');
    if (resolveBtn) {
      _cdResolve(resolveBtn.dataset.cdResolve);
      return;
    }
    if (e.target.closest('#cd-reopen')) _cdReopen();
  });
  document.getElementById('m-contam-detail').addEventListener('click', (e) => {
    if (e.target.id === 'm-contam-detail') closeContamDetail();
  });
  // Grain spawn weight-lines: event delegation
  $('gs-weight-lines').addEventListener('click', (e) => {
    const btn = e.target.closest('.gs-wbtn');
    if (btn) {
      gsLineSetWeight(btn.closest('.gs-wline'), parseFloat(btn.dataset.kg));
      return;
    }
    const rm = e.target.closest('.gs-line-rm');
    if (rm) {
      gsRemoveLine(rm.closest('.gs-wline'));
      return;
    }
  });
  $('gs-weight-lines').addEventListener('input', gsPreview);
  $('gs-add-line').addEventListener('click', gsAddLine);
  if ($('gs-rh')) $('gs-rh').addEventListener('input', gsPreview);
  $('prt-gs').addEventListener('click', goToPrintGrainBatch);
  $('prt-lw').addEventListener('click', goToPrintLabCulture);
  $('cult-type').addEventListener('change', renderCultures);
  $('cult-stat').addEventListener('change', renderCultures);
  $('lw-type').addEventListener('change', lwUpdate);
  $('lw-st').addEventListener('change', () => {
    const type = document.getElementById('lw-type').value;
    if (type === 'KB') gsPreview();
    else lwPreview();
  });
  $('lw-qty').addEventListener('input', lwPreview);
  $('lw-strain-text').addEventListener('input', () => {
    const type = document.getElementById('lw-type').value;
    if (type === 'KB') gsPreview();
    else lwPreview();
  });
  $('lw-parent').addEventListener('change', () => {
    const parentId = document.getElementById('lw-parent').value;
    if (!parentId) return;
    const parent = cultures.find((c) => c.id === parentId);
    if (!parent) return;
    if (parent.strainId) {
      document.getElementById('lw-st').value = String(parent.strainId);
    }
    const stInput = document.getElementById('lw-strain-text');
    if (stInput && parent.strainText) stInput.value = parent.strainText;
    lwPreview();
  });
  $('nb-culture').addEventListener('change', () => {
    const id = document.getElementById('nb-culture').value;
    if (id) {
      const c = cultures.find((x) => x.id === id);
      if (c) {
        if (c.strainId) document.getElementById('nb-strain-sel').value = String(c.strainId);
        const stInput = document.getElementById('nb-strain-text');
        if (stInput && c.strainText) stInput.value = c.strainText;
        nbPreview();
      }
    }
    renderNbGrainBanner();
  });
  $('btn-26').addEventListener('click', () => {
    const type = document.getElementById('lw-type').value;
    if (type === 'KB') createGrainBatch();
    else logLabWork();
  });
  $('lineage-sel').addEventListener('change', renderLineage);

  // Print
  $('st-print-bags').addEventListener('click', () => {
    openStab('print', 'bags');
  });
  $('st-print-lab').addEventListener('click', () => {
    openStab('print', 'lab');
  });
  $('st-print-ref').addEventListener('click', () => {
    openStab('print', 'ref');
  });
  $('print-batch-search').addEventListener('input', () => fillBatchSelect());
  $('print-batch').addEventListener('change', renderBagPreview);
  $('print-mode').addEventListener('change', renderBagPreview);
  $('bag-qr').addEventListener('change', renderBagPreview);
  $('print-range').addEventListener('change', toggleBagRange);
  $('prt-27').addEventListener('click', printBagLabels);
  $('printer-status-banner').addEventListener('click', refreshPrinterStatus);
  $('lab-filter').addEventListener('change', renderLabList);
  $('lab-mode').addEventListener('change', renderLabPreview);
  $('lab-qr').addEventListener('change', renderLabPreview);
  $('prt-28').addEventListener('click', printLabLabels);
  $('ref-qr').addEventListener('change', renderRefBarcodes);
  $('prt-29').addEventListener('click', printRef);

  // Calendar
  $('btn-33').addEventListener('click', calToday);
  $('btn-34').addEventListener('click', () => {
    calNav(-1);
  });
  $('btn-35').addEventListener('click', () => {
    calNav(1);
  });
  $('cal-filter-user').addEventListener('change', renderCalendar);
  $('cv-month').addEventListener('click', () => {
    setCalView('month');
  });
  $('cv-week').addEventListener('click', () => {
    setCalView('week');
  });
  $('cv-day').addEventListener('click', () => {
    setCalView('day');
  });
  // Unified calendar entry modal
  $('btn-cal-print').addEventListener('click', printCalendar);
  $('m-cal-print-week').addEventListener('click', () => printCalendarTaskList('week'));
  $('m-cal-print-month').addEventListener('click', () => printCalendarTaskList('month'));
  $('m-cal-print-cancel').addEventListener('click', closeCalPrintModal);
  $('m-cal-print').addEventListener('click', (e) => {
    if (e.target.id === 'm-cal-print') closeCalPrintModal();
  });
  $('btn-cal-add').addEventListener('click', () => openEntryModal());
  $('cal-entry-cancel-btn').addEventListener('click', closeEntryModal);
  $('cal-entry-save-btn').addEventListener('click', saveEntry);
  $('cal-entry-del-btn').addEventListener('click', deleteEntry);
  $('cal-entry-allday').addEventListener('change', toggleEntryTimeInputs);
  wireTimeInput($('cal-entry-start-time'));
  wireTimeInput($('cal-entry-end-time'));
  $('cal-entry-type-select').addEventListener('change', function () {
    setEntryType(this.value);
  });
  $('cal-entry-recurrence').addEventListener('change', toggleRecurrenceUntil);
  $('m-cal-entry').addEventListener('click', (e) => {
    if (e.target.id === 'm-cal-entry') closeEntryModal();
  });
  $('cal-ev-assignees').addEventListener('click', toggleAssigneeDropdown);
  const taBox = $('cal-task-assignees');
  if (taBox) taBox.addEventListener('click', toggleTaskAssigneeDropdown);

  // Settings
  $('st-settings-log').addEventListener('click', () => {
    openStab('settings', 'log');
  });
  $('st-settings-backup').addEventListener('click', () => {
    openStab('settings', 'backup');
  });
  $('st-settings-users').addEventListener('click', () => {
    openStab('settings', 'users');
    loadUsersTab();
  });
  $('st-settings-caldav').addEventListener('click', () => {
    openStab('settings', 'caldav');
  });
  $('st-settings-duckdns').addEventListener('click', () => {
    openStab('settings', 'duckdns');
  });
  // openStab() already dispatches loadHarvestFeedSettings() for this sub-tab —
  // calling it here as well would fetch the config twice on every click.
  $('st-settings-harvestfeed').addEventListener('click', () => {
    openStab('settings', 'harvestfeed');
  });
  $('st-settings-printer').addEventListener('click', () => {
    openStab('settings', 'printer');
    renderPrinterSettings();
  });
  $('st-settings-versand').addEventListener('click', () => {
    openStab('settings', 'versand');
  });
  $('versand-save-btn').addEventListener('click', saveShipSettings);
  $('versand-test-btn').addEventListener('click', testShipConnection);
  $('st-settings-channels').addEventListener('click', () => {
    openStab('settings', 'channels');
  });
  $('wix-save-btn').addEventListener('click', () => saveChannel('wix'));
  $('wix-test-btn').addEventListener('click', () => testChannel('wix'));
  $('wix-sync-btn').addEventListener('click', () => syncChannel('wix'));
  $('ebay-save-btn').addEventListener('click', () => saveChannel('ebay'));
  $('ebay-connect-btn').addEventListener('click', () => connectChannel('ebay'));
  $('ebay-test-btn').addEventListener('click', () => testChannel('ebay'));
  $('ebay-sync-btn').addEventListener('click', () => syncChannel('ebay'));
  $('etsy-save-btn').addEventListener('click', () => saveChannel('etsy'));
  $('etsy-connect-btn').addEventListener('click', () => connectChannel('etsy'));
  $('etsy-test-btn').addEventListener('click', () => testChannel('etsy'));
  $('etsy-sync-btn').addEventListener('click', () => syncChannel('etsy'));
  $('printer-save-btn').addEventListener('click', savePrinterSettings);
  $('printer-test-btn').addEventListener('click', testPrintBridge);
  $('printer-refresh-btn').addEventListener('click', () => {
    renderPrinterSettings();
    refreshPrinterStatus();
  });
  $('printer-download-script').addEventListener('click', downloadBridgeScript);
  $('printer-copy-cmd-1').addEventListener('click', (e) => {
    copyToClipboardWithFeedback(document.getElementById('printer-setup-cmd-1').textContent, e.currentTarget);
  });
  $('st-settings-mcp').addEventListener('click', () => {
    openStab('settings', 'mcp');
  });
  $('st-settings-camera').addEventListener('click', () => {
    openStab('settings', 'camera');
    loadCameraTab();
  });
  $('cam-calib-save').addEventListener('click', saveCameraCalibration);
  $('cam-calib-reload').addEventListener('click', loadCameraTab);
  $('cam-add-btn').addEventListener('click', () => openCameraEdit(null));
  $('cam-edit-cancel').addEventListener('click', closeCameraEdit);
  $('cam-edit-save').addEventListener('click', saveCameraEdit);
  document.getElementById('m-cam-edit').addEventListener('click', (e) => {
    if (e.target.id === 'm-cam-edit') closeCameraEdit();
  });
  initCameraPxCalib();
  $('st-settings-server').addEventListener('click', () => {
    openStab('settings', 'server');
    loadServerTab();
  });
  $('btn-server-restart').addEventListener('click', restartServer);
  $('btn-migrate-batch-ids').addEventListener('click', runBatchIdMigration);
  $('btn-migrate-strain-text').addEventListener('click', runStrainTextMigration);
  $('duckdns-save-btn').addEventListener('click', saveDuckdnsSettings);
  $('harvestfeed-save-btn').addEventListener('click', saveHarvestFeedSettings);
  $('harvestfeed-gen-btn').addEventListener('click', generateHarvestFeedSecret);
  $('harvestfeed-test-btn').addEventListener('click', () => testHarvestFeed(false));
  $('harvestfeed-preview-btn').addEventListener('click', () => testHarvestFeed(true));
  $('harvestrelease-save-btn').addEventListener('click', saveHarvestReleases);
  $('harvestrelease-add-btn').addEventListener('click', addHarvestReleaseRow);
  $('harvestrelease-new').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addHarvestReleaseRow();
  });
  $('duckdns-update-btn').addEventListener('click', triggerDuckdnsUpdate);
  $('le-request-btn').addEventListener('click', requestLeCert);
  $('mcp-save-btn').addEventListener('click', saveMcpSettings);
  $('mcp-gen-token-btn').addEventListener('click', generateMcpToken);
  $('mcp-revoke-token-btn').addEventListener('click', revokeMcpToken);
  $('mcp-enabled').addEventListener('change', function () {
    toggleMcpSections(this.checked);
  });
  $('mcp-copy-url-btn').addEventListener('click', () => {
    navigator.clipboard.writeText($('mcp-url').value);
    showMcpStatus(t('mcp.urlCopied'), 'var(--c-green-dark)');
  });
  $('mcp-diag-btn').addEventListener('click', runMcpDiagnostics);
  $('mcp-copy-token-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(_mcpToken);
    showMcpStatus(t('mcp.keyCopied'), 'var(--c-green-dark)');
  });
  $('log-action-filter').addEventListener('change', renderLog);
  $('log-date-from').addEventListener('change', renderLog);
  $('log-date-to').addEventListener('change', renderLog);
  $('log-q').addEventListener('input', renderLog);
  $('btn-37').addEventListener('click', clearLog);
  $('tgl-38').addEventListener('click', () => {
    toggleLogSort('time');
  });
  $('tgl-39').addEventListener('click', () => {
    toggleLogSort('action');
  });
  $('ctl-40').addEventListener('click', () => {
    logDisplayLimit += 200;
    renderLog();
  });
  $('btn-41').addEventListener('click', downloadBackup);
  $('btn-42').addEventListener('click', restoreBackup);
  $('reset-go').addEventListener('click', runCleanReset);
  $('lab-check-btn').addEventListener('click', openLabCheck);
  $('zc-close').addEventListener('click', () => document.getElementById('m-zonecheck').classList.remove('open'));
  $('m-zonecheck').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('open');
    const row = e.target.closest('[data-zc-bag]');
    if (row) {
      const id = row.dataset.zcBag;
      if (_zcFound.has(id)) _zcFound.delete(id);
      else _zcFound.add(id);
      renderZoneCheck();
      return;
    }
    const act = e.target.closest('[data-zc-act]');
    if (!act) return;
    if (act.dataset.zcAct === 'scan') {
      zoneCheckStartScan();
      return;
    }
    if (act.dataset.zcAct === 'used') {
      _zcMarkMissingUsed();
      return;
    }
    if (!_zcSelectMissing()) return;
    if (act.dataset.zcAct === 'move') openLocMovePopup();
    else locRemoveSelected();
  });
  $('btn-43').addEventListener('click', doLogout);
  $('btn-44').addEventListener('click', addUser);
  $('btn-45').addEventListener('click', copyCalDavUrl);
  $('caldav-enabled').addEventListener('change', saveCaldavSettings);
  $('act-46').addEventListener('click', saveCaldavSettings);
  $('caldav-sync-btn').addEventListener('click', syncCaldavNow);

  // Inventory
  $('st-inv-stock').addEventListener('click', () => {
    openStab('inv', 'stock');
  });
  $('st-inv-delivery').addEventListener('click', () => {
    openStab('inv', 'delivery');
  });
  $('st-inv-log').addEventListener('click', () => {
    openStab('inv', 'log');
  });
  $('st-inv-suppliers').addEventListener('click', () => {
    openStab('inv', 'suppliers');
    renderSuppliers();
  });
  $('del-mat').addEventListener('change', delMatChange);
  $('del-kg').addEventListener('input', delPreview);
  $('btn-47').addEventListener('click', logDelivery);
  $('adj-mat').addEventListener('change', adjMatChange);
  $('adj-absolute').addEventListener('input', () => {
    adjPreview('absolute');
  });
  $('adj-delta').addEventListener('input', () => {
    adjPreview('delta');
  });
  $('btn-48').addEventListener('click', logAdjustment);
  $('inv-log-filter').addEventListener('change', renderInvLog);
}

// Camera FAB is in the HTML *after* the <script> tag, so it doesn't exist
// when initEventListeners() runs. Bind it once the full DOM is ready.
document.addEventListener('DOMContentLoaded', function () {
  const fab = document.getElementById('cam-fab');
  if (fab)
    fab.addEventListener('click', function () {
      // Front-door scan: always start neutral so scanning a bag opens its
      // action sheet, never a leftover armed mode from an earlier session.
      scan.action = null;
      scan.to = null;
      scan.from = null;
      scan.harvestBag = null;
      updateSD();
      openCamScan();
    });

  // PWA shortcuts (manifest.json -> shortcuts[]) launch with ?action=...
  // Wait until the rest of the app has had a chance to fetch data + render
  // before dispatching, so go() / openCamScan find the elements they need.
  try {
    const actionParam = new URLSearchParams(window.location.search).get('action');
    if (actionParam) {
      window.setTimeout(function () {
        if (actionParam === 'scan') {
          if (typeof openCamScan === 'function') openCamScan();
        } else if (actionParam === 'newbatch') {
          // Old New-batch form is hidden; open the Sorte-driven create dialog directly.
          if (typeof msQuickChargeNew === 'function') msQuickChargeNew();
        } else if (actionParam === 'dash') {
          if (typeof go === 'function') go('dash', 'n-dash');
        }
        // Clean up the URL so a refresh doesn't re-trigger the action.
        try {
          window.history.replaceState({}, '', window.location.pathname);
        } catch (e) {
          /* ignore */
        }
      }, 400);
    }
  } catch (e) {
    /* ignore — bad URL or no URLSearchParams */
  }

  // Action speed-dial FAB — toggles a 3-button menu (New batch / Lab work /
  // Log harvest). This is the single home for the creation flows on every page.
  const afab = document.getElementById('action-fab');
  const afabMenu = document.getElementById('action-fab-menu');
  const afabWrap = document.getElementById('action-fab-wrap');
  function setAfabOpen(open) {
    if (!afab || !afabMenu) return;
    afab.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) afabMenu.removeAttribute('hidden');
    else afabMenu.setAttribute('hidden', '');
  }
  if (afab) {
    afab.addEventListener('click', function (e) {
      e.stopPropagation();
      const open = afab.getAttribute('aria-expanded') === 'true';
      setAfabOpen(!open);
    });
  }
  // The speed-dial is now the single home for the creation flows (the duplicate
  // dashboard button row is gone), so these call the flows directly.
  [
    // Guided, recipe-driven create dialog (pick Sorte → substrate auto-filled
    // from its recipe → zone pick → print). The old full form is still reachable
    // via Chargen → Neue Charge for advanced/recipe-less cases.
    ['action-fab-newbatch', msQuickChargeNew],
    ['action-fab-labwork', msQuickLaborNew],
    ['action-fab-harvest', dashGoHarvest]
  ].forEach(function (pair) {
    const src = document.getElementById(pair[0]);
    if (!src) return;
    src.addEventListener('click', function () {
      pair[1]();
      setAfabOpen(false);
    });
  });
  // Close on outside tap (backdrop dismiss). Don't close when the user
  // taps inside the wrap — they may be aiming at a menu item.
  document.addEventListener('click', function (e) {
    if (!afabWrap || afab.getAttribute('aria-expanded') !== 'true') return;
    if (!afabWrap.contains(e.target)) setAfabOpen(false);
  });
});
