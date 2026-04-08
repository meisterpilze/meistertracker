'use strict';
const { DatabaseSync: Database } = require('node:sqlite');
const crypto = require('crypto');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — keep in sync with server.js cookie Max-Age
const MAX_SESSIONS_PER_USER = 10;

// ── Schema ───────────────────────────────────────────────────
const SCHEMA = `
CREATE TABLE IF NOT EXISTS batches (
  batch_id      TEXT PRIMARY KEY,
  species       TEXT NOT NULL,
  strain        TEXT,
  qty           INTEGER NOT NULL,
  days          INTEGER NOT NULL,
  sub_hardwood  REAL DEFAULT 0,
  sub_wheatbran REAL DEFAULT 0,
  sub_rh        REAL DEFAULT 0,
  sub_gypsum    INTEGER DEFAULT 0,
  bag_kg        REAL DEFAULT 3,
  batch_type    TEXT DEFAULT 'block',
  source_id     TEXT,
  notes         TEXT DEFAULT '',
  created       TEXT NOT NULL,
  due           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bags (
  bag_id   TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bags_batch ON bags(batch_id);

CREATE TABLE IF NOT EXISTS scan_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  time    TEXT NOT NULL,
  action  TEXT NOT NULL,
  batch   TEXT,
  bag     TEXT,
  "from"  TEXT,
  "to"    TEXT,
  species TEXT,
  strain  TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_scanlog_time ON scan_log(time);

CREATE TABLE IF NOT EXISTS harvests (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  time    TEXT NOT NULL,
  batch   TEXT,
  bag     TEXT,
  species TEXT,
  strain  TEXT,
  grams   REAL NOT NULL,
  flush   INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_harvests_batch ON harvests(batch);

CREATE TABLE IF NOT EXISTS cultures (
  id        TEXT PRIMARY KEY,
  type      TEXT NOT NULL,
  species   TEXT,
  strain    TEXT,
  parent_id TEXT,
  source    TEXT,
  status    TEXT DEFAULT 'active',
  notes     TEXT DEFAULT '',
  created   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  text          TEXT NOT NULL,
  priority      TEXT DEFAULT 'med',
  done          INTEGER DEFAULT 0,
  created       TEXT NOT NULL,
  assignee      TEXT,
  due_date      TEXT,
  description   TEXT,
  caldav_uid    TEXT,
  caldav_synced TEXT,
  private       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS team_members (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  role  TEXT,
  added TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  stock_hardwood   REAL DEFAULT 0,
  stock_wheatbran  REAL DEFAULT 0,
  stock_gypsum     REAL DEFAULT 0,
  stock_grain      REAL DEFAULT 0,
  thresh_hardwood  REAL DEFAULT 50,
  thresh_wheatbran REAL DEFAULT 20,
  thresh_gypsum    REAL DEFAULT 5,
  thresh_grain     REAL DEFAULT 10,
  avg_hw_pct       REAL DEFAULT 75,
  avg_wb_pct       REAL DEFAULT 25,
  avg_rh_pct       REAL DEFAULT 63,
  avg_bag_kg       REAL DEFAULT 3,
  avg_grain_bag_kg REAL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS inventory_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  time     TEXT NOT NULL,
  mat      TEXT NOT NULL,
  delta_kg REAL NOT NULL,
  running  REAL DEFAULT 0,
  type     TEXT,
  ref      TEXT
);
CREATE INDEX IF NOT EXISTS idx_invlog_time ON inventory_log(time);

CREATE TABLE IF NOT EXISTS caldav_config (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  enabled              INTEGER DEFAULT 1,
  caldav_username      TEXT DEFAULT '',
  caldav_password      TEXT DEFAULT '',
  per_person_calendars INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS duckdns_config (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  enabled         INTEGER DEFAULT 0,
  domain          TEXT DEFAULT '',
  token           TEXT DEFAULT '',
  last_ip_update  TEXT,
  last_ip         TEXT,
  le_enabled      INTEGER DEFAULT 0,
  le_last_renewal TEXT,
  le_expiry       TEXT
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  all_day     INTEGER DEFAULT 1,
  start_time  TEXT,
  end_time    TEXT,
  category    TEXT DEFAULT 'custom',
  color       TEXT,
  caldav_uid  TEXT,
  caldav_synced TEXT,
  created     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_event_assignees (
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS users (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  hash     TEXT NOT NULL,
  salt     TEXT NOT NULL,
  role     TEXT DEFAULT 'user',
  created  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token   TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created TEXT NOT NULL,
  expires TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);

CREATE TABLE IF NOT EXISTS assets (
  asset_id            TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL,
  entry_date          TEXT NOT NULL,
  exit_date           TEXT,
  purchase_price      REAL NOT NULL,
  useful_life         INTEGER NOT NULL,
  depreciation_method TEXT DEFAULT 'linear',
  supplier            TEXT,
  invoice_number      TEXT,
  serial_number       TEXT,
  location            TEXT,
  status              TEXT DEFAULT 'aktiv',
  notes               TEXT DEFAULT '',
  created             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

// ── Schema Migrations ───────────────────────────────────────
// Each migration runs exactly once, tracked by schema_version.
// To add a new migration: append an entry to MIGRATIONS array.
const MIGRATIONS = [
  // v1: baseline — all tables already created via SCHEMA DDL
  { version: 2, description: 'Add private flag to manual_tasks for CalDAV visibility', fn(db) {
    const has = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('manual_tasks') WHERE name='private'").get();
    if (!has.c) db.exec('ALTER TABLE manual_tasks ADD COLUMN private INTEGER DEFAULT 0');
  }},
  { version: 3, description: 'Add user_id to scan_log for user tracking', fn(db) {
    const has = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('scan_log') WHERE name='user_id'").get();
    if (!has.c) db.exec('ALTER TABLE scan_log ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
  }},
  { version: 4, description: 'Add calendar_event_assignees junction table', fn(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS calendar_event_assignees (
      event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (event_id, user_id)
    )`);
  }},
  { version: 5, description: 'Add performance indexes for multi-user workloads', fn(db) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_scanlog_batch  ON scan_log(batch);
      CREATE INDEX IF NOT EXISTS idx_scanlog_bag    ON scan_log(bag);
      CREATE INDEX IF NOT EXISTS idx_scanlog_user   ON scan_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_harvests_bag   ON harvests(bag);
      CREATE INDEX IF NOT EXISTS idx_cultures_parent ON cultures(parent_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON manual_tasks(assignee);
      CREATE INDEX IF NOT EXISTS idx_tasks_due      ON manual_tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_calevents_start ON calendar_events(start_date);
      CREATE INDEX IF NOT EXISTS idx_calassign_user ON calendar_event_assignees(user_id);
    `);
  }},
  { version: 6, description: 'Add unique constraints on caldav_uid columns', fn(db) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_caldav_uid ON manual_tasks(caldav_uid) WHERE caldav_uid IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_calevents_caldav_uid ON calendar_events(caldav_uid) WHERE caldav_uid IS NOT NULL;
    `);
  }},
  { version: 7, description: 'Add zones and racks tables for dynamic location management', fn(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS zones (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        role       TEXT NOT NULL,
        color      TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS racks (
        id         TEXT PRIMARY KEY,
        zone_id    TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
        sort_order INTEGER DEFAULT 0,
        created    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_racks_zone ON racks(zone_id);
    `);
    // Seed default zones
    const now = new Date().toISOString();
    const insZ = db.prepare('INSERT OR IGNORE INTO zones(id,name,role,color,sort_order,created) VALUES(?,?,?,?,?,?)');
    insZ.run('SPAWN', 'Spawn Run', 'spawn', '#a855f7', 1, now);
    insZ.run('INC',   'Inkubation', 'incubation', '#0ea5e9', 2, now);
    insZ.run('TENT1', 'Zelt 1', 'fruiting', '#10b981', 3, now);
    insZ.run('TENT2', 'Zelt 2', 'fruiting', '#10b981', 4, now);
    insZ.run('TENT3', 'Zelt 3', 'fruiting', '#10b981', 5, now);
    insZ.run('CONTAM','Kontamination', 'contaminated', '#ef4444', 99, now);
    // Seed default racks
    const insR = db.prepare('INSERT OR IGNORE INTO racks(id,zone_id,sort_order,created) VALUES(?,?,?,?)');
    insR.run('SPAWN_R1', 'SPAWN', 1, now);
    insR.run('SPAWN_R2', 'SPAWN', 2, now);
    for (let i = 1; i <= 10; i++) insR.run('INC_R' + i, 'INC', i, now);
  }},
  { version: 8, description: 'Add optional max_capacity to zones', fn(db) {
    db.exec('ALTER TABLE zones ADD COLUMN max_capacity INTEGER DEFAULT NULL');
  }},
  { version: 9, description: 'Add duckdns_config table for DuckDNS and Let\'s Encrypt', fn(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS duckdns_config (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      enabled         INTEGER DEFAULT 0,
      domain          TEXT DEFAULT '',
      token           TEXT DEFAULT '',
      last_ip_update  TEXT,
      last_ip         TEXT,
      le_enabled      INTEGER DEFAULT 0,
      le_last_renewal TEXT,
      le_expiry       TEXT
    )`);
  }},
  { version: 10, description: 'Enable CalDAV sync by default', fn(db) {
    db.prepare('UPDATE caldav_config SET enabled = 1 WHERE id = 1').run();
  }},
];

function runMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied TEXT NOT NULL, description TEXT)');
  const applied = new Set(db.prepare('SELECT version FROM schema_version').all().map(r => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    try {
      db.exec('BEGIN');
      if (m.fn) m.fn(db); else db.exec(m.sql);
      db.prepare('INSERT INTO schema_version(version, applied, description) VALUES(?, ?, ?)').run(m.version, new Date().toISOString(), m.description || '');
      db.exec('COMMIT');
      console.log(`  Migration v${m.version} applied: ${m.description || ''}`);
    } catch (e) {
      db.exec('ROLLBACK');
      // Tolerate "duplicate column" errors — column may already exist from initial schema
      if (e.message && e.message.includes('duplicate column')) {
        db.exec('BEGIN');
        db.prepare('INSERT INTO schema_version(version, applied, description) VALUES(?, ?, ?)').run(m.version, new Date().toISOString(), m.description + ' (already exists)');
        db.exec('COMMIT');
        console.log(`  Migration v${m.version} skipped (already applied): ${m.description || ''}`);
      } else {
        throw new Error(`Migration v${m.version} failed: ${e.message}`);
      }
    }
  }
}

// ── Open / Init ──────────────────────────────────────────────
function openDb(dbPath) {
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA wal_autocheckpoint = 1000");
  db.exec(SCHEMA);
  runMigrations(db);
  // Ensure singleton rows exist
  db.prepare(`INSERT OR IGNORE INTO inventory(id) VALUES(1)`).run();
  db.prepare(`INSERT OR IGNORE INTO caldav_config(id) VALUES(1)`).run();
  db.prepare(`INSERT OR IGNORE INTO duckdns_config(id) VALUES(1)`).run();
  return db;
}

// ── Read All (assembles the JSON shape the client expects) ───
function readAll(db, opts = {}) {
  // Batches + bags
  const batchRows = db.prepare('SELECT * FROM batches ORDER BY created').all();
  const bagStmt = db.prepare('SELECT bag_id FROM bags WHERE batch_id = ? ORDER BY bag_id');
  const batches = batchRows.map(r => ({
    batchId: r.batch_id,
    species: r.species,
    strain: r.strain,
    qty: r.qty,
    days: r.days,
    substrate: {
      hardwood: r.sub_hardwood,
      wheatbran: r.sub_wheatbran,
      rh: r.sub_rh,
      gypsum: r.sub_gypsum === 1 ? true : false
    },
    bagKg: r.bag_kg,
    batchType: r.batch_type,
    sourceId: r.source_id,
    notes: r.notes,
    created: r.created,
    due: r.due,
    bags: bagStmt.all(r.batch_id).map(b => b.bag_id)
  }));

  // Scan log — include id for PATCH/DELETE targeting, join username
  const scanLog = db.prepare('SELECT s.*, u.username FROM scan_log s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.id').all().map(r => ({
    id: r.id,
    time: r.time,
    action: r.action,
    batch: r.batch,
    bag: r.bag,
    from: r.from,
    to: r.to,
    species: r.species,
    strain: r.strain,
    userId: r.user_id,
    user: r.username || null
  }));

  // Harvests — include id for targeting
  const harvests = db.prepare('SELECT * FROM harvests ORDER BY id').all().map(r => ({
    id: r.id,
    time: r.time,
    batch: r.batch,
    bag: r.bag,
    species: r.species,
    strain: r.strain,
    grams: r.grams,
    flush: r.flush
  }));

  // Cultures
  const cultures = db.prepare('SELECT * FROM cultures ORDER BY created').all().map(r => ({
    id: r.id,
    type: r.type,
    species: r.species,
    strain: r.strain,
    parentId: r.parent_id,
    source: r.source,
    status: r.status,
    notes: r.notes,
    created: r.created
  }));

  // Manual tasks — include id for PATCH/DELETE targeting
  const manualTasks = db.prepare('SELECT * FROM manual_tasks ORDER BY id').all().map(r => ({
    id: r.id,
    text: r.text,
    priority: r.priority,
    done: r.done === 1 ? true : false,
    created: r.created,
    assignee: r.assignee,
    dueDate: r.due_date,
    description: r.description,
    caldavUid: r.caldav_uid,
    caldavSynced: r.caldav_synced,
    private: r.private === 1 ? true : false
  }));

  // Team members — include id for DELETE targeting
  const teamMembers = db.prepare('SELECT * FROM team_members ORDER BY id').all().map(r => ({
    id: r.id,
    name: r.name,
    role: r.role,
    added: r.added
  }));

  // Inventory (singleton)
  const inv = db.prepare('SELECT * FROM inventory WHERE id = 1').get();
  const invLogLimit = opts.inventoryLogLimit;
  const invLogRaw = invLogLimit
    ? db.prepare('SELECT * FROM inventory_log ORDER BY id DESC LIMIT ?').all(invLogLimit).reverse()
    : db.prepare('SELECT * FROM inventory_log ORDER BY id').all();
  const invLog = invLogRaw.map(r => ({
    time: r.time,
    mat: r.mat,
    deltaKg: r.delta_kg,
    running: r.running,
    type: r.type,
    ref: r.ref
  }));
  const inventory = {
    stock: {
      hardwood: inv.stock_hardwood,
      wheatbran: inv.stock_wheatbran,
      gypsum: inv.stock_gypsum,
      grain: inv.stock_grain
    },
    thresholds: {
      hardwood: { minKg: inv.thresh_hardwood },
      wheatbran: { minKg: inv.thresh_wheatbran },
      gypsum: { minKg: inv.thresh_gypsum },
      grain: { minKg: inv.thresh_grain }
    },
    avgComposition: {
      hwPct: inv.avg_hw_pct,
      wbPct: inv.avg_wb_pct,
      rhPct: inv.avg_rh_pct,
      bagKg: inv.avg_bag_kg,
      grainBagKg: inv.avg_grain_bag_kg
    },
    log: invLog
  };

  // CalDAV config
  const cal = db.prepare('SELECT * FROM caldav_config WHERE id = 1').get();
  const caldav = {
    enabled: cal.enabled === 1 ? true : false
  };

  // DuckDNS config (expose hasToken flag, never the actual token)
  const ddns = db.prepare('SELECT * FROM duckdns_config WHERE id = 1').get();
  const duckdns = {
    enabled: ddns.enabled === 1,
    domain: ddns.domain || '',
    hasToken: !!(ddns.token),
    lastIpUpdate: ddns.last_ip_update || null,
    lastIp: ddns.last_ip || null,
    leEnabled: ddns.le_enabled === 1,
    leLastRenewal: ddns.le_last_renewal || null,
    leExpiry: ddns.le_expiry || null
  };

  // Assets
  const assets = db.prepare('SELECT * FROM assets ORDER BY asset_id').all().map(r => ({
    assetId: r.asset_id,
    name: r.name,
    category: r.category,
    entryDate: r.entry_date,
    exitDate: r.exit_date,
    purchasePrice: r.purchase_price,
    usefulLife: r.useful_life,
    depreciationMethod: r.depreciation_method,
    supplier: r.supplier,
    invoiceNumber: r.invoice_number,
    serialNumber: r.serial_number,
    location: r.location,
    status: r.status,
    notes: r.notes,
    created: r.created
  }));

  // Calendar events
  const assigneeMap = getAllCalendarEventAssignees(db);
  const calendarEvents = db.prepare('SELECT * FROM calendar_events ORDER BY start_date').all().map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    startDate: r.start_date,
    endDate: r.end_date,
    allDay: r.all_day === 1,
    startTime: r.start_time,
    endTime: r.end_time,
    category: r.category,
    color: r.color,
    caldavUid: r.caldav_uid,
    caldavSynced: r.caldav_synced,
    created: r.created,
    assignees: assigneeMap.get(r.id) || []
  }));

  // Zones + Racks
  const zoneRows = db.prepare('SELECT * FROM zones ORDER BY sort_order, id').all();
  const rackStmt = db.prepare('SELECT id, zone_id, sort_order, created FROM racks WHERE zone_id = ? ORDER BY sort_order, id');
  const zones = zoneRows.map(z => ({
    id: z.id,
    name: z.name,
    role: z.role,
    color: z.color,
    sortOrder: z.sort_order,
    maxCapacity: z.max_capacity || null,
    created: z.created,
    racks: rackStmt.all(z.id).map(r => ({ id: r.id, sortOrder: r.sort_order, created: r.created }))
  }));

  const version = getDataVersion(db);
  return { batches, scanLog, manualTasks, harvests, cultures, inventory, teamMembers, caldav, duckdns, assets, calendarEvents, zones, version };
}

// ── Data Versioning ─────────────────────────────────────────
function getDataVersion(db) {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get('data_version');
  return row ? parseInt(row.value, 10) : 0;
}
function incrementDataVersion(db) {
  const v = getDataVersion(db) + 1;
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('data_version', String(v));
  return v;
}

// ── Write All (diff incoming JSON against DB, apply changes) ─
// Used by backup/restore only — normal mutations use atomic functions below
function writeAll(db, incoming) {
  db.exec('BEGIN');
  try {
    // ── Batches ──
    if (incoming.batches) {
      const existingIds = new Set(db.prepare('SELECT batch_id FROM batches').all().map(r => r.batch_id));
      const incomingIds = new Set(incoming.batches.map(b => b.batchId));

      for (const id of existingIds) {
        if (!incomingIds.has(id)) {
          db.prepare('DELETE FROM batches WHERE batch_id = ?').run(id);
        }
      }

      const upsertBatch = db.prepare(`
        INSERT INTO batches(batch_id, species, strain, qty, days, sub_hardwood, sub_wheatbran, sub_rh, sub_gypsum, bag_kg, batch_type, source_id, notes, created, due)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(batch_id) DO UPDATE SET
          species=excluded.species, strain=excluded.strain, qty=excluded.qty, days=excluded.days,
          sub_hardwood=excluded.sub_hardwood, sub_wheatbran=excluded.sub_wheatbran,
          sub_rh=excluded.sub_rh, sub_gypsum=excluded.sub_gypsum,
          bag_kg=excluded.bag_kg, batch_type=excluded.batch_type,
          source_id=excluded.source_id, notes=excluded.notes,
          created=excluded.created, due=excluded.due
      `);
      const deleteBags = db.prepare('DELETE FROM bags WHERE batch_id = ?');
      const insertBag = db.prepare('INSERT INTO bags(bag_id, batch_id) VALUES(?, ?)');

      for (const b of incoming.batches) {
        const sub = b.substrate || {};
        upsertBatch.run(
          b.batchId, b.species, b.strain || null, b.qty, b.days,
          sub.hardwood || 0, sub.wheatbran || 0, sub.rh || 0, sub.gypsum ? 1 : 0,
          b.bagKg || 3, b.batchType || 'block', b.sourceId || null,
          b.notes || '', b.created, b.due
        );
        deleteBags.run(b.batchId);
        for (const bagId of (b.bags || [])) {
          insertBag.run(bagId, b.batchId);
        }
      }
    }

    // ── Scan Log (replace all) ──
    if (incoming.scanLog) {
      db.prepare('DELETE FROM scan_log').run();
      const ins = db.prepare('INSERT INTO scan_log(time, action, batch, bag, "from", "to", species, strain) VALUES(?, ?, ?, ?, ?, ?, ?, ?)');
      for (const e of incoming.scanLog) {
        ins.run(e.time, e.action, e.batch || null, e.bag || null, e.from || null, e.to || null, e.species || null, e.strain || null);
      }
    }

    // ── Harvests (replace all) ──
    if (incoming.harvests) {
      db.prepare('DELETE FROM harvests').run();
      const ins = db.prepare('INSERT INTO harvests(time, batch, bag, species, strain, grams, flush) VALUES(?, ?, ?, ?, ?, ?, ?)');
      for (const h of incoming.harvests) {
        ins.run(h.time, h.batch || null, h.bag || null, h.species || null, h.strain || null, h.grams, h.flush || 1);
      }
    }

    // ── Cultures ──
    if (incoming.cultures) {
      const existingIds = new Set(db.prepare('SELECT id FROM cultures').all().map(r => r.id));
      const incomingIds = new Set(incoming.cultures.map(c => c.id));

      for (const id of existingIds) {
        if (!incomingIds.has(id)) {
          db.prepare('DELETE FROM cultures WHERE id = ?').run(id);
        }
      }

      const upsert = db.prepare(`
        INSERT INTO cultures(id, type, species, strain, parent_id, source, status, notes, created)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type=excluded.type, species=excluded.species, strain=excluded.strain,
          parent_id=excluded.parent_id, source=excluded.source, status=excluded.status,
          notes=excluded.notes, created=excluded.created
      `);
      for (const c of incoming.cultures) {
        upsert.run(c.id, c.type, c.species || null, c.strain || null,
          c.parentId || null, c.source || null, c.status || 'active',
          c.notes || '', c.created);
      }
    }

    // ── Manual Tasks (replace all) ──
    if (incoming.manualTasks) {
      db.prepare('DELETE FROM manual_tasks').run();
      const ins = db.prepare('INSERT INTO manual_tasks(text, priority, done, created, assignee, due_date, description, caldav_uid, caldav_synced) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const t of incoming.manualTasks) {
        ins.run(t.text, t.priority || 'med', t.done ? 1 : 0, t.created,
          t.assignee || null, t.dueDate || null, t.description || null,
          t.caldavUid || null, t.caldavSynced || null);
      }
    }

    // ── Team Members ──
    if (incoming.teamMembers) {
      db.prepare('DELETE FROM team_members').run();
      const ins = db.prepare('INSERT INTO team_members(name, role, added) VALUES(?, ?, ?)');
      for (const m of incoming.teamMembers) {
        ins.run(m.name, m.role || null, m.added);
      }
    }

    // ── Inventory (config only — stock is managed via delta endpoints) ──
    if (incoming.inventory) {
      const inv = incoming.inventory;
      const thresh = inv.thresholds || {};
      const avg = inv.avgComposition || {};
      db.prepare(`
        UPDATE inventory SET
          thresh_hardwood=?, thresh_wheatbran=?, thresh_gypsum=?, thresh_grain=?,
          avg_hw_pct=?, avg_wb_pct=?, avg_rh_pct=?, avg_bag_kg=?, avg_grain_bag_kg=?
        WHERE id=1
      `).run(
        (thresh.hardwood && thresh.hardwood.minKg) || 50,
        (thresh.wheatbran && thresh.wheatbran.minKg) || 20,
        (thresh.gypsum && thresh.gypsum.minKg) || 5,
        (thresh.grain && thresh.grain.minKg) || 10,
        avg.hwPct || 75, avg.wbPct || 25, avg.rhPct || 63,
        avg.bagKg || 3, avg.grainBagKg || 1
      );
    }

    // ── Assets ──
    if (incoming.assets) {
      const existingIds = new Set(db.prepare('SELECT asset_id FROM assets').all().map(r => r.asset_id));
      const incomingIds = new Set(incoming.assets.map(a => a.assetId));

      for (const id of existingIds) {
        if (!incomingIds.has(id)) {
          db.prepare('DELETE FROM assets WHERE asset_id = ?').run(id);
        }
      }

      const upsert = db.prepare(`
        INSERT INTO assets(asset_id, name, category, entry_date, exit_date, purchase_price, useful_life,
          depreciation_method, supplier, invoice_number, serial_number, location, status, notes, created)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
          name=excluded.name, category=excluded.category, entry_date=excluded.entry_date,
          exit_date=excluded.exit_date, purchase_price=excluded.purchase_price,
          useful_life=excluded.useful_life, depreciation_method=excluded.depreciation_method,
          supplier=excluded.supplier, invoice_number=excluded.invoice_number,
          serial_number=excluded.serial_number, location=excluded.location,
          status=excluded.status, notes=excluded.notes, created=excluded.created
      `);
      for (const a of incoming.assets) {
        upsert.run(a.assetId, a.name, a.category, a.entryDate, a.exitDate || null,
          a.purchasePrice, a.usefulLife, a.depreciationMethod || 'linear',
          a.supplier || null, a.invoiceNumber || null, a.serialNumber || null,
          a.location || null, a.status || 'aktiv', a.notes || '', a.created);
      }
    }

    // ── Calendar Events ──
    if (incoming.calendarEvents) {
      const existingIds = new Set(db.prepare('SELECT id FROM calendar_events').all().map(r => r.id));
      const incomingIds = new Set(incoming.calendarEvents.map(e => e.id));

      for (const id of existingIds) {
        if (!incomingIds.has(id)) {
          db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
        }
      }

      const upsert = db.prepare(`
        INSERT INTO calendar_events(id, title, description, start_date, end_date, all_day,
          start_time, end_time, category, color, caldav_uid, caldav_synced, created)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, description=excluded.description, start_date=excluded.start_date,
          end_date=excluded.end_date, all_day=excluded.all_day, start_time=excluded.start_time,
          end_time=excluded.end_time, category=excluded.category, color=excluded.color,
          caldav_uid=excluded.caldav_uid, caldav_synced=excluded.caldav_synced, created=excluded.created
      `);
      for (const e of incoming.calendarEvents) {
        upsert.run(e.id, e.title, e.description || null, e.startDate, e.endDate || null,
          e.allDay ? 1 : 0, e.startTime || null, e.endTime || null,
          e.category || 'custom', e.color || null,
          e.caldavUid || null, e.caldavSynced || null, e.created);
      }
      // Sync assignees
      db.prepare('DELETE FROM calendar_event_assignees').run();
      const insAssignee = db.prepare('INSERT OR IGNORE INTO calendar_event_assignees(event_id, user_id) VALUES(?, ?)');
      for (const e of incoming.calendarEvents) {
        if (e.assignees && e.assignees.length) {
          for (const a of e.assignees) insAssignee.run(e.id, a.userId);
        }
      }
    }

    // ── Zones & Racks ──
    if (incoming.zones) {
      const existingZoneIds = new Set(db.prepare('SELECT id FROM zones').all().map(r => r.id));
      const existingRackIds = new Set(db.prepare('SELECT id FROM racks').all().map(r => r.id));
      const incomingZoneIds = new Set(incoming.zones.map(z => z.id));
      const incomingRackIds = new Set(incoming.zones.flatMap(z => (z.racks || []).map(r => r.id)));

      // Delete racks removed from zones that still exist
      for (const id of existingRackIds) {
        if (!incomingRackIds.has(id)) {
          db.prepare('DELETE FROM racks WHERE id = ?').run(id);
        }
      }
      // Delete zones missing from incoming (cascades remaining racks)
      for (const id of existingZoneIds) {
        if (!incomingZoneIds.has(id)) {
          db.prepare('DELETE FROM zones WHERE id = ?').run(id);
        }
      }

      const upsertZone = db.prepare(`
        INSERT INTO zones(id, name, role, color, sort_order, created)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, role=excluded.role, color=excluded.color,
          sort_order=excluded.sort_order, created=excluded.created
      `);
      for (const z of incoming.zones) {
        upsertZone.run(z.id, z.name, z.role, z.color, z.sortOrder || 0,
          z.created || new Date().toISOString());
      }

      const upsertRack = db.prepare(`
        INSERT INTO racks(id, zone_id, sort_order, created)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          zone_id=excluded.zone_id, sort_order=excluded.sort_order, created=excluded.created
      `);
      for (const z of incoming.zones) {
        for (const r of (z.racks || [])) {
          upsertRack.run(r.id, z.id, r.sortOrder || 0,
            r.created || new Date().toISOString());
        }
      }
    }

    // ── CalDAV Config ──
    if (incoming.caldav) {
      const c = incoming.caldav;
      db.prepare(`UPDATE caldav_config SET enabled=? WHERE id=1`).run(c.enabled ? 1 : 0);
    }
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ── Backup ───────────────────────────────────────────────────
function backupDb(db, destPath) {
  const escaped = destPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return Promise.resolve();
}

// ── Update CalDAV UID on a task after sync ──
function updateTaskCaldavUid(db, text, created, uid, synced) {
  db.prepare(
    'UPDATE manual_tasks SET caldav_uid = ?, caldav_synced = ? WHERE text = ? AND created = ?'
  ).run(uid, synced, text, created);
  incrementDataVersion(db);
}

// ── Update batch due date (for calendar drag or CalDAV bidirectional sync) ──
function updateBatchDue(db, batchId, newDueISO) {
  const batch = db.prepare('SELECT created FROM batches WHERE batch_id = ?').get(batchId);
  if (!batch) return;
  const created = new Date(batch.created);
  const newDue = new Date(newDueISO);
  const newDays = Math.max(1, Math.round((newDue - created) / 86400000));
  db.prepare('UPDATE batches SET due = ?, days = ? WHERE batch_id = ?').run(newDueISO, newDays, batchId);
  incrementDataVersion(db);
}

// ── Update task due date (for calendar drag or CalDAV bidirectional sync) ──
function updateTaskDueDate(db, caldavUid, newDueDate) {
  db.prepare('UPDATE manual_tasks SET due_date = ?, caldav_synced = NULL WHERE caldav_uid = ?').run(newDueDate, caldavUid);
  incrementDataVersion(db);
}

// ── Read only CalDAV config (lightweight, for auth checks) ──
function readCaldavConfig(db) {
  const cal = db.prepare('SELECT * FROM caldav_config WHERE id = 1').get();
  return {
    enabled: cal.enabled === 1
  };
}

// ── Auth helpers ────────────────────────────────────────────
function createUser(db, username, password, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const created = new Date().toISOString();
  db.prepare('INSERT INTO users(username, hash, salt, role, created) VALUES(?, ?, ?, ?, ?)')
    .run(username, hash, salt, role || 'user', created);
  return { username, role: role || 'user', created };
}

function getUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function verifyPassword(storedHash, salt, password) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(hash, 'hex'));
}

function createSession(db, userId) {
  // Enforce session limit per user — evict oldest when at cap
  const count = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?').get(userId).count;
  if (count >= MAX_SESSIONS_PER_USER) {
    db.prepare(`DELETE FROM sessions WHERE token IN (
      SELECT token FROM sessions WHERE user_id = ? ORDER BY created ASC LIMIT ?
    )`).run(userId, count - MAX_SESSIONS_PER_USER + 1);
  }
  const token = crypto.randomBytes(32).toString('hex');
  const created = new Date().toISOString();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions(token, user_id, created, expires) VALUES(?, ?, ?, ?)')
    .run(token, userId, created, expires);
  return token;
}

function getSession(db, token) {
  return db.prepare(
    `SELECT s.token, s.user_id, s.expires, u.username, u.role
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.token = ? AND s.expires > datetime('now')`
  ).get(token);
}

function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function deleteSessionsByUserId(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function deleteExpiredSessions(db) {
  db.prepare("DELETE FROM sessions WHERE expires < datetime('now')").run();
}

function countUsers(db) {
  return db.prepare('SELECT COUNT(*) as count FROM users').get().count;
}

function listUsers(db) {
  return db.prepare('SELECT id, username, role, created FROM users ORDER BY id').all();
}

function deleteUser(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

function updateUserPassword(db, userId, hash, salt) {
  db.prepare('UPDATE users SET hash = ?, salt = ? WHERE id = ?').run(hash, salt, userId);
}

function resetUserPassword(db, userId, newPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(newPassword, salt, 64).toString('hex');
  db.prepare('UPDATE users SET hash = ?, salt = ? WHERE id = ?').run(hash, salt, userId);
}

// ── Atomic CRUD functions ───────────────────────────────────

// -- Batches --
function insertBatch(db, b) {
  if (!Number.isFinite(b.qty) || b.qty < 1) throw new Error('qty must be >= 1');
  if (!Number.isFinite(b.days) || b.days < 1) throw new Error('days must be >= 1');
  db.exec('BEGIN');
  try {
    const sub = b.substrate || {};
    db.prepare(`INSERT INTO batches(batch_id,species,strain,qty,days,sub_hardwood,sub_wheatbran,sub_rh,sub_gypsum,bag_kg,batch_type,source_id,notes,created,due) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(b.batchId, b.species, b.strain||null, b.qty, b.days, sub.hardwood||0, sub.wheatbran||0, sub.rh||0, sub.gypsum?1:0, b.bagKg||3, b.batchType||'block', b.sourceId||null, b.notes||'', b.created, b.due);
    const ins = db.prepare('INSERT INTO bags(bag_id,batch_id) VALUES(?,?)');
    for (const bagId of (b.bags||[])) ins.run(bagId, b.batchId);
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}

function updateBatchField(db, batchId, fields) {
  const allowed = ['notes','species','strain','qty','days','due'];
  const cols = Object.keys(fields).filter(k => allowed.includes(k));
  if (!cols.length) return;
  db.exec('BEGIN');
  try {
    const sets = cols.map(c => `${c}=?`).join(',');
    db.prepare(`UPDATE batches SET ${sets} WHERE batch_id=?`).run(...cols.map(c=>fields[c]), batchId);
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}

function addBagsToBatch(db, batchId, newBags, newQty) {
  db.exec('BEGIN');
  try {
    const ins = db.prepare('INSERT OR IGNORE INTO bags(bag_id,batch_id) VALUES(?,?)');
    for (const id of newBags) ins.run(id, batchId);
    if (newQty != null) db.prepare('UPDATE batches SET qty=? WHERE batch_id=?').run(newQty, batchId);
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}

function deleteBatchById(db, batchId) {
  db.prepare('DELETE FROM batches WHERE batch_id=?').run(batchId);
  incrementDataVersion(db);
}

// -- Scan Log --
function appendScanEntries(db, entries, userId) {
  const ins = db.prepare('INSERT INTO scan_log(time,action,batch,bag,"from","to",species,strain,user_id) VALUES(?,?,?,?,?,?,?,?,?)');
  const ids = [];
  for (const e of entries) {
    const r = ins.run(e.time, e.action, e.batch||null, e.bag||null, e.from||null, e.to||null, e.species||null, e.strain||null, userId||null);
    ids.push(r.lastInsertRowid);
  }
  incrementDataVersion(db);
  return ids;
}

function deleteLastScanEntries(db, n) {
  db.prepare('DELETE FROM scan_log WHERE id IN (SELECT id FROM scan_log ORDER BY id DESC LIMIT ?)').run(n);
  incrementDataVersion(db);
}

function deleteScanEntryById(db, id) {
  const info = db.prepare('DELETE FROM scan_log WHERE id = ?').run(id);
  return info.changes > 0;
}

function clearScanLog(db) {
  db.prepare('DELETE FROM scan_log').run();
  incrementDataVersion(db);
}

// -- Harvests --
function insertHarvest(db, h) {
  if (!Number.isFinite(h.grams) || h.grams < 0) throw new Error('grams must be >= 0');
  const r = db.prepare('INSERT INTO harvests(time,batch,bag,species,strain,grams,flush) VALUES(?,?,?,?,?,?,?)').run(h.time, h.batch||null, h.bag||null, h.species||null, h.strain||null, h.grams, h.flush||1);
  incrementDataVersion(db);
  return r.lastInsertRowid;
}

// -- Cultures --
function insertCultures(db, cultures) {
  const ins = db.prepare('INSERT INTO cultures(id,type,species,strain,parent_id,source,status,notes,created) VALUES(?,?,?,?,?,?,?,?,?)');
  for (const c of cultures) {
    ins.run(c.id, c.type, c.species||null, c.strain||null, c.parentId||null, c.source||null, c.status||'active', c.notes||'', c.created);
  }
  incrementDataVersion(db);
}

function updateCulture(db, id, fields) {
  const allowed = ['status','notes','species','strain','source'];
  const cols = Object.keys(fields).filter(k => allowed.includes(k));
  if (!cols.length) return;
  const sets = cols.map(c => `${c}=?`).join(',');
  db.prepare(`UPDATE cultures SET ${sets} WHERE id=?`).run(...cols.map(c=>fields[c]), id);
  incrementDataVersion(db);
}

// -- Tasks --
function insertTask(db, t) {
  const r = db.prepare('INSERT INTO manual_tasks(text,priority,done,created,assignee,due_date,description,caldav_uid,caldav_synced,private) VALUES(?,?,?,?,?,?,?,?,?,?)').run(t.text, t.priority||'med', t.done?1:0, t.created, t.assignee||null, t.dueDate||null, t.description||null, t.caldavUid||null, t.caldavSynced||null, t.private?1:0);
  incrementDataVersion(db);
  return r.lastInsertRowid;
}

function updateTaskById(db, id, fields) {
  const map = {done:'done',caldavUid:'caldav_uid',caldavSynced:'caldav_synced',text:'text',priority:'priority',assignee:'assignee',dueDate:'due_date',description:'description','private':'private'};
  const entries = Object.entries(fields).filter(([k])=>map[k]);
  if (!entries.length) return;
  const sets = entries.map(([k])=>`${map[k]}=?`).join(',');
  const vals = entries.map(([k,v])=>(k==='done'||k==='private')?(v?1:0):v);
  db.prepare(`UPDATE manual_tasks SET ${sets} WHERE id=?`).run(...vals, id);
  incrementDataVersion(db);
}

function readTaskById(db, id) {
  const r = db.prepare('SELECT * FROM manual_tasks WHERE id=?').get(id);
  if (!r) return null;
  return { id: r.id, text: r.text, priority: r.priority, done: r.done===1, created: r.created, assignee: r.assignee, dueDate: r.due_date, description: r.description, caldavUid: r.caldav_uid, caldavSynced: r.caldav_synced, private: r.private===1 };
}

function readBatchById(db, batchId) {
  const r = db.prepare('SELECT * FROM batches WHERE batch_id=?').get(batchId);
  if (!r) return null;
  return { batchId: r.batch_id, species: r.species, strain: r.strain, qty: r.qty, days: r.days, due: r.due, created: r.created, notes: r.notes };
}

function deleteTaskById(db, id) {
  db.prepare('DELETE FROM manual_tasks WHERE id=?').run(id);
  incrementDataVersion(db);
}

// -- Team Members --
function insertMember(db, m) {
  const r = db.prepare('INSERT INTO team_members(name,role,added) VALUES(?,?,?)').run(m.name, m.role||null, m.added);
  incrementDataVersion(db);
  return r.lastInsertRowid;
}

function deleteMember(db, id) {
  db.prepare('DELETE FROM team_members WHERE id=?').run(id);
  incrementDataVersion(db);
}

// -- Assets --
function upsertAsset(db, a) {
  db.prepare(`INSERT INTO assets(asset_id,name,category,entry_date,exit_date,purchase_price,useful_life,depreciation_method,supplier,invoice_number,serial_number,location,status,notes,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET name=excluded.name,category=excluded.category,entry_date=excluded.entry_date,exit_date=excluded.exit_date,purchase_price=excluded.purchase_price,useful_life=excluded.useful_life,depreciation_method=excluded.depreciation_method,supplier=excluded.supplier,invoice_number=excluded.invoice_number,serial_number=excluded.serial_number,location=excluded.location,status=excluded.status,notes=excluded.notes,created=excluded.created`)
    .run(a.assetId, a.name, a.category, a.entryDate, a.exitDate||null, a.purchasePrice, a.usefulLife, a.depreciationMethod||'linear', a.supplier||null, a.invoiceNumber||null, a.serialNumber||null, a.location||null, a.status||'aktiv', a.notes||'', a.created);
  incrementDataVersion(db);
}

function deleteAssetById(db, id) {
  db.prepare('DELETE FROM assets WHERE asset_id=?').run(id);
  incrementDataVersion(db);
}

// -- CalDAV Config --
function updateCaldavCfg(db, c) {
  db.prepare('UPDATE caldav_config SET enabled=? WHERE id=1').run(c.enabled?1:0);
  incrementDataVersion(db);
}

// -- DuckDNS Config --
function getDuckdnsCfg(db) {
  const row = db.prepare('SELECT * FROM duckdns_config WHERE id = 1').get();
  return {
    enabled: row.enabled === 1,
    domain: row.domain || '',
    token: row.token || '',
    lastIpUpdate: row.last_ip_update || null,
    lastIp: row.last_ip || null,
    leEnabled: row.le_enabled === 1,
    leLastRenewal: row.le_last_renewal || null,
    leExpiry: row.le_expiry || null
  };
}

function updateDuckdnsCfg(db, cfg) {
  db.prepare(`UPDATE duckdns_config SET enabled=?, domain=?, token=?, le_enabled=? WHERE id=1`).run(
    cfg.enabled ? 1 : 0,
    cfg.domain || '',
    cfg.token || '',
    cfg.leEnabled ? 1 : 0
  );
  incrementDataVersion(db);
}

function updateDuckdnsStatus(db, fields) {
  const sets = [];
  const vals = [];
  if (fields.lastIpUpdate !== undefined) { sets.push('last_ip_update=?'); vals.push(fields.lastIpUpdate); }
  if (fields.lastIp !== undefined) { sets.push('last_ip=?'); vals.push(fields.lastIp); }
  if (fields.leLastRenewal !== undefined) { sets.push('le_last_renewal=?'); vals.push(fields.leLastRenewal); }
  if (fields.leExpiry !== undefined) { sets.push('le_expiry=?'); vals.push(fields.leExpiry); }
  if (sets.length) db.prepare('UPDATE duckdns_config SET ' + sets.join(',') + ' WHERE id=1').run(...vals);
}

// -- Inventory Delta --
const VALID_MATS = ['hardwood','wheatbran','gypsum','grain'];

function applyInventoryDelta(db, mat, deltaKg, type, ref) {
  if (!VALID_MATS.includes(mat)) throw new Error('invalid material: ' + mat);
  const col = 'stock_' + mat;
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE inventory SET ${col} = MAX(0, ${col} + ?) WHERE id=1`).run(deltaKg);
    const row = db.prepare(`SELECT ${col} as val FROM inventory WHERE id=1`).get();
    db.prepare('INSERT INTO inventory_log(time,mat,delta_kg,running,type,ref) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(), mat, deltaKg, row.val, type||null, ref||null);
    incrementDataVersion(db);
    db.exec('COMMIT');
    return row.val;
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}

function setInventoryAbsolute(db, mat, value, type, ref) {
  if (!VALID_MATS.includes(mat)) throw new Error('invalid material: ' + mat);
  const col = 'stock_' + mat;
  db.exec('BEGIN');
  try {
    const old = db.prepare(`SELECT ${col} as val FROM inventory WHERE id=1`).get().val;
    const delta = value - old;
    db.prepare(`UPDATE inventory SET ${col}=? WHERE id=1`).run(value);
    db.prepare('INSERT INTO inventory_log(time,mat,delta_kg,running,type,ref) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(), mat, delta, value, type||null, ref||null);
    incrementDataVersion(db);
    db.exec('COMMIT');
    return value;
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}

function updateInventoryConfig(db, thresholds, avgComposition) {
  const t = thresholds || {};
  const a = avgComposition || {};
  db.prepare(`UPDATE inventory SET thresh_hardwood=?,thresh_wheatbran=?,thresh_gypsum=?,thresh_grain=?,avg_hw_pct=?,avg_wb_pct=?,avg_rh_pct=?,avg_bag_kg=?,avg_grain_bag_kg=? WHERE id=1`).run(
    (t.hardwood&&t.hardwood.minKg)||50, (t.wheatbran&&t.wheatbran.minKg)||20,
    (t.gypsum&&t.gypsum.minKg)||5, (t.grain&&t.grain.minKg)||10,
    a.hwPct||75, a.wbPct||25, a.rhPct||63, a.bagKg||3, a.grainBagKg||1
  );
  incrementDataVersion(db);
}

// ── Calendar Event CRUD ─────────────────────────────────────
function insertCalendarEvent(db, ev, assigneeIds) {
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO calendar_events(id, title, description, start_date, end_date, all_day,
      start_time, end_time, category, color, caldav_uid, caldav_synced, created)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      ev.id, ev.title, ev.description || null, ev.startDate, ev.endDate || null,
      ev.allDay ? 1 : 0, ev.startTime || null, ev.endTime || null,
      ev.category || 'custom', ev.color || null, ev.caldavUid || null,
      ev.caldavSynced || null, ev.created || new Date().toISOString()
    );
    if (assigneeIds && assigneeIds.length) {
      const ins = db.prepare('INSERT INTO calendar_event_assignees(event_id, user_id) VALUES(?, ?)');
      for (const uid of assigneeIds) ins.run(ev.id, uid);
    }
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}

function updateCalendarEvent(db, id, fields) {
  const allowed = ['title','description','start_date','end_date','all_day','start_time','end_time','category','color','caldav_uid','caldav_synced'];
  const map = {startDate:'start_date',endDate:'end_date',allDay:'all_day',startTime:'start_time',endTime:'end_time',caldavUid:'caldav_uid',caldavSynced:'caldav_synced'};
  const sets = []; const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = map[k] || k;
    if (!allowed.includes(col)) continue;
    sets.push(col + '=?');
    vals.push(col === 'all_day' ? (v ? 1 : 0) : (v ?? null));
  }
  if (!sets.length) return;
  vals.push(id);
  db.prepare('UPDATE calendar_events SET ' + sets.join(',') + ' WHERE id=?').run(...vals);
  incrementDataVersion(db);
}

function deleteCalendarEvent(db, id) {
  db.prepare('DELETE FROM calendar_events WHERE id=?').run(id);
  incrementDataVersion(db);
}

function setCalendarEventAssignees(db, eventId, userIds) {
  db.prepare('DELETE FROM calendar_event_assignees WHERE event_id=?').run(eventId);
  const ins = db.prepare('INSERT INTO calendar_event_assignees(event_id, user_id) VALUES(?, ?)');
  for (const uid of userIds) ins.run(eventId, uid);
  incrementDataVersion(db);
}

function getAllCalendarEventAssignees(db) {
  const rows = db.prepare(`
    SELECT cea.event_id, cea.user_id, u.username
    FROM calendar_event_assignees cea
    JOIN users u ON u.id = cea.user_id
    ORDER BY cea.event_id, u.username
  `).all();
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.event_id)) map.set(r.event_id, []);
    map.get(r.event_id).push({ userId: r.user_id, username: r.username });
  }
  return map;
}

// -- Zones & Racks --
function insertZone(db, z) {
  if (db.prepare('SELECT 1 FROM zones WHERE id=?').get(z.id)) throw new Error('Zone already exists: ' + z.id);
  if (z.racks && z.racks.length) {
    const existing = db.prepare('SELECT id FROM racks WHERE id IN (' + z.racks.map(() => '?').join(',') + ')').all(...z.racks);
    if (existing.length) throw new Error('Rack already exists: ' + existing.map(r => r.id).join(', '));
  }
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO zones(id,name,role,color,sort_order,max_capacity,created) VALUES(?,?,?,?,?,?,?)').run(
      z.id, z.name, z.role, z.color, z.sortOrder || 0, z.maxCapacity || null, z.created || new Date().toISOString()
    );
    if (z.racks && z.racks.length) {
      const ins = db.prepare('INSERT INTO racks(id,zone_id,sort_order,created) VALUES(?,?,?,?)');
      z.racks.forEach((rId, i) => ins.run(rId, z.id, i + 1, z.created || new Date().toISOString()));
    }
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}


function zoneBagCount(db, zoneId) {
  // Get all rack ids for this zone
  const rackIds = db.prepare('SELECT id FROM racks WHERE zone_id=?').all(zoneId).map(r => r.id);
  const allLocs = [zoneId, ...rackIds];
  // Replay scan_log to count bags currently in this zone
  const placeholders = allLocs.map(() => '?').join(',');
  const rows = db.prepare(`SELECT bag, action, "from", "to" FROM scan_log WHERE bag IS NOT NULL AND ("to" IN (${placeholders}) OR "from" IN (${placeholders})) ORDER BY id`).all(...allLocs, ...allLocs);
  const bags = new Set();
  for (const r of rows) {
    if ((r.action === 'ADD' || r.action === 'MOVE') && allLocs.includes(r.to)) bags.add(r.bag);
    if ((r.action === 'MOVE' || r.action === 'REMOVE') && allLocs.includes(r.from)) bags.delete(r.bag);
  }
  return bags.size;
}

function deleteZone(db, id) {
  const count = zoneBagCount(db, id);
  if (count > 0) throw new Error('Zone has ' + count + ' bags — remove them first');
  db.prepare('DELETE FROM zones WHERE id=?').run(id);
  incrementDataVersion(db);
}

function insertRack(db, r) {
  db.prepare('INSERT INTO racks(id,zone_id,sort_order,created) VALUES(?,?,?,?)').run(
    r.id, r.zoneId, r.sortOrder || 0, r.created || new Date().toISOString()
  );
  incrementDataVersion(db);
}

function rackBagCount(db, rackId) {
  const rows = db.prepare('SELECT bag, action, "from", "to" FROM scan_log WHERE bag IS NOT NULL AND ("to"=? OR "from"=?) ORDER BY id').all(rackId, rackId);
  const bags = new Set();
  for (const r of rows) {
    if ((r.action === 'ADD' || r.action === 'MOVE') && r.to === rackId) bags.add(r.bag);
    if ((r.action === 'MOVE' || r.action === 'REMOVE') && r.from === rackId) bags.delete(r.bag);
  }
  return bags.size;
}

function deleteRack(db, id) {
  if (!db.prepare('SELECT 1 FROM racks WHERE id=?').get(id)) throw new Error('Rack not found: ' + id);
  const count = rackBagCount(db, id);
  if (count > 0) throw new Error('Rack has ' + count + ' bags — remove them first');
  db.prepare('DELETE FROM racks WHERE id=?').run(id);
  incrementDataVersion(db);
}

function zoneExists(db, id) {
  return !!db.prepare('SELECT 1 FROM zones WHERE id=?').get(id);
}

module.exports = {
  openDb, readAll, writeAll, backupDb, getDataVersion, readCaldavConfig, updateTaskCaldavUid,
  updateBatchDue, updateTaskDueDate,
  createUser, getUserByUsername, verifyPassword, createSession, getSession,
  deleteSession, deleteSessionsByUserId, deleteExpiredSessions, countUsers, listUsers, deleteUser,
  SESSION_TTL_MS,
  updateUserPassword, resetUserPassword,
  insertBatch, updateBatchField, addBagsToBatch, deleteBatchById,
  appendScanEntries, deleteLastScanEntries, deleteScanEntryById, clearScanLog,
  insertHarvest, insertCultures, updateCulture,
  insertTask, updateTaskById, deleteTaskById, readTaskById, readBatchById,
  insertMember, deleteMember,
  upsertAsset, deleteAssetById,
  updateCaldavCfg,
  getDuckdnsCfg, updateDuckdnsCfg, updateDuckdnsStatus,
  applyInventoryDelta, setInventoryAbsolute, updateInventoryConfig,
  insertCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
  setCalendarEventAssignees, getAllCalendarEventAssignees,
  insertZone, deleteZone, insertRack, deleteRack, zoneExists
};
