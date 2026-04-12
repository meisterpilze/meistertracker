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
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  text             TEXT NOT NULL,
  priority         TEXT DEFAULT 'med',
  done             INTEGER DEFAULT 0,
  created          TEXT NOT NULL,
  assignee         TEXT,
  due_date         TEXT,
  due_time         TEXT,
  due_end_time     TEXT,
  description      TEXT,
  caldav_uid       TEXT,
  caldav_synced    TEXT,
  private          INTEGER DEFAULT 0,
  recurrence       TEXT,
  recurrence_until TEXT
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

CREATE TABLE IF NOT EXISTS suppliers (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  mat   TEXT NOT NULL,
  name  TEXT NOT NULL,
  url   TEXT,
  phone TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS caldav_config (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  enabled              INTEGER DEFAULT 0,
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
  created     TEXT NOT NULL,
  recurrence       TEXT,
  recurrence_until TEXT,
  team_assignees   TEXT
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
  {
    version: 2,
    description: 'Add private flag to manual_tasks for CalDAV visibility',
    fn(db) {
      const has = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('manual_tasks') WHERE name='private'").get();
      if (!has.c) db.exec('ALTER TABLE manual_tasks ADD COLUMN private INTEGER DEFAULT 0');
    }
  },
  {
    version: 3,
    description: 'Add user_id to scan_log for user tracking',
    fn(db) {
      const has = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('scan_log') WHERE name='user_id'").get();
      if (!has.c) db.exec('ALTER TABLE scan_log ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
    }
  },
  {
    version: 4,
    description: 'Add calendar_event_assignees junction table',
    fn(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS calendar_event_assignees (
      event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (event_id, user_id)
    )`);
    }
  },
  {
    version: 5,
    description: 'Add performance indexes for multi-user workloads',
    fn(db) {
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
    }
  },
  {
    version: 6,
    description: 'Add unique constraints on caldav_uid columns',
    fn(db) {
      db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_caldav_uid ON manual_tasks(caldav_uid) WHERE caldav_uid IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_calevents_caldav_uid ON calendar_events(caldav_uid) WHERE caldav_uid IS NOT NULL;
    `);
    }
  },
  {
    version: 7,
    description: 'Add zones and racks tables for dynamic location management',
    fn(db) {
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
      insZ.run('INC', 'Inkubation', 'incubation', '#0ea5e9', 2, now);
      insZ.run('TENT1', 'Zelt 1', 'fruiting', '#10b981', 3, now);
      insZ.run('TENT2', 'Zelt 2', 'fruiting', '#10b981', 4, now);
      insZ.run('TENT3', 'Zelt 3', 'fruiting', '#10b981', 5, now);
      insZ.run('CONTAM', 'Kontamination', 'contaminated', '#ef4444', 99, now);
      // Seed default racks
      const insR = db.prepare('INSERT OR IGNORE INTO racks(id,zone_id,sort_order,created) VALUES(?,?,?,?)');
      insR.run('SPAWN_R1', 'SPAWN', 1, now);
      insR.run('SPAWN_R2', 'SPAWN', 2, now);
      for (let i = 1; i <= 10; i++) insR.run('INC_R' + i, 'INC', i, now);
    }
  },
  {
    version: 8,
    description: 'Add optional max_capacity to zones',
    fn(db) {
      db.exec('ALTER TABLE zones ADD COLUMN max_capacity INTEGER DEFAULT NULL');
    }
  },
  {
    version: 9,
    description: "Add duckdns_config table for DuckDNS and Let's Encrypt",
    fn(db) {
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
    }
  },
  {
    version: 10,
    description: 'Enable CalDAV sync by default',
    fn(db) {
      db.prepare('UPDATE caldav_config SET enabled = 1 WHERE id = 1').run();
    }
  },
  {
    version: 11,
    description: 'Add mcp_config table for MCP server settings',
    fn(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS mcp_config (
      id        INTEGER PRIMARY KEY CHECK (id = 1),
      enabled   INTEGER DEFAULT 0,
      api_token TEXT DEFAULT ''
    )`);
    }
  },
  {
    version: 12,
    description: 'Drop unused caldav_username/caldav_password columns (rebuild caldav_config)',
    fn(db) {
      const row = db.prepare('SELECT enabled, per_person_calendars FROM caldav_config WHERE id = 1').get();
      db.exec('DROP TABLE IF EXISTS caldav_config');
      db.exec(`CREATE TABLE caldav_config (
        id                   INTEGER PRIMARY KEY CHECK (id = 1),
        enabled              INTEGER DEFAULT 0,
        per_person_calendars INTEGER DEFAULT 0
      )`);
      if (row) {
        db.prepare('INSERT INTO caldav_config (id, enabled, per_person_calendars) VALUES (1, ?, ?)').run(
          row.enabled || 0,
          row.per_person_calendars || 0
        );
      }
    }
  },
  {
    version: 13,
    description: 'Add OAuth 2.0 tables for MCP authentication',
    fn(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id     TEXT PRIMARY KEY,
        client_name   TEXT DEFAULT '',
        redirect_uris TEXT NOT NULL DEFAULT '[]',
        created       TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS oauth_codes (
        code                  TEXT PRIMARY KEY,
        client_id             TEXT NOT NULL,
        user_id               INTEGER NOT NULL,
        redirect_uri          TEXT NOT NULL,
        code_challenge        TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL DEFAULT 'S256',
        expires               TEXT NOT NULL,
        used                  INTEGER DEFAULT 0
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS oauth_tokens (
        token             TEXT PRIMARY KEY,
        token_type        TEXT NOT NULL,
        client_id         TEXT NOT NULL,
        user_id           INTEGER NOT NULL,
        expires           TEXT NOT NULL,
        revoked           INTEGER DEFAULT 0,
        created           TEXT NOT NULL DEFAULT (datetime('now')),
        refresh_token_ref TEXT
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires ON oauth_tokens(expires)`);
    }
  },
  {
    version: 14,
    description: 'Add client_secret_hash and revoked to oauth_clients for admin-managed OAuth',
    fn(db) {
      db.exec(`ALTER TABLE oauth_clients ADD COLUMN client_secret_hash TEXT DEFAULT NULL`);
      db.exec(`ALTER TABLE oauth_clients ADD COLUMN revoked INTEGER DEFAULT 0`);
    }
  },
  {
    version: 15,
    description: 'Add resource column to oauth_codes for RFC 8707 resource indicator support',
    fn(db) {
      db.exec(`ALTER TABLE oauth_codes ADD COLUMN resource TEXT DEFAULT ''`);
    }
  },
  {
    version: 16,
    description: 'Add recurrence + team_assignees to calendar_events',
    fn(db) {
      const addCol = (col, def) => {
        const has = db.prepare(`SELECT COUNT(*) as c FROM pragma_table_info('calendar_events') WHERE name='${col}'`).get();
        if (!has.c) db.exec(`ALTER TABLE calendar_events ADD COLUMN ${col} ${def}`);
      };
      addCol('recurrence', 'TEXT');
      addCol('recurrence_until', 'TEXT');
      addCol('team_assignees', 'TEXT');
    }
  },
  {
    version: 17,
    description: 'Add recurrence columns to manual_tasks',
    fn(db) {
      const addCol = (col, def) => {
        const has = db.prepare(`SELECT COUNT(*) as c FROM pragma_table_info('manual_tasks') WHERE name='${col}'`).get();
        if (!has.c) db.exec(`ALTER TABLE manual_tasks ADD COLUMN ${col} ${def}`);
      };
      addCol('recurrence', 'TEXT');
      addCol('recurrence_until', 'TEXT');
    }
  },
  {
    version: 18,
    description: 'Add due_time/due_end_time to manual_tasks for time-slot scheduling',
    fn(db) {
      const addCol = (col, def) => {
        const has = db.prepare(`SELECT COUNT(*) as c FROM pragma_table_info('manual_tasks') WHERE name='${col}'`).get();
        if (!has.c) db.exec(`ALTER TABLE manual_tasks ADD COLUMN ${col} ${def}`);
      };
      addCol('due_time', 'TEXT');
      addCol('due_end_time', 'TEXT');
    }
  },
  {
    version: 19,
    description: 'Add mushroom_strains table and migrate existing strain data',
    fn(db) {
      const now = new Date().toISOString();

      db.exec(`CREATE TABLE IF NOT EXISTS mushroom_strains (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE,
        kuerzel     TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        created     TEXT NOT NULL,
        updated     TEXT
      )`);

      const hasBatch = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('batches') WHERE name='strain_id'").get();
      if (!hasBatch.c) db.exec('ALTER TABLE batches ADD COLUMN strain_id INTEGER REFERENCES mushroom_strains(id)');

      const hasCulture = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('cultures') WHERE name='strain_id'").get();
      if (!hasCulture.c) db.exec('ALTER TABLE cultures ADD COLUMN strain_id INTEGER REFERENCES mushroom_strains(id)');

      // Collect unique (species, strain) pairs from existing batches + cultures
      const pairs = new Map();
      const batchRows = db.prepare("SELECT DISTINCT species, strain FROM batches WHERE strain IS NOT NULL AND TRIM(strain) != ''").all();
      const cultureRows = db.prepare("SELECT DISTINCT species, strain FROM cultures WHERE strain IS NOT NULL AND TRIM(strain) != ''").all();
      for (const row of [...batchRows, ...cultureRows]) {
        const key = (row.species || '').toLowerCase() + '|' + row.strain.toLowerCase();
        if (!pairs.has(key)) pairs.set(key, { species: (row.species || '').trim(), strain: row.strain.trim() });
      }

      // Generate unique name + kuerzel for each pair
      const kuerzelUsed = new Set();
      const nameUsed = new Set();
      const pairToId = new Map();
      const insMS = db.prepare('INSERT INTO mushroom_strains(name,kuerzel,description,created) VALUES(?,?,?,?)');

      for (const [key, { species, strain }] of pairs) {
        // Name: use species if unique, else append strain to distinguish
        let name = species || strain;
        if (nameUsed.has(name.toLowerCase())) name = (species ? species + ' ' : '') + strain;
        let nameSuffix = 2;
        let finalName = name;
        while (nameUsed.has(finalName.toLowerCase())) { finalName = name + ' ' + nameSuffix; nameSuffix++; }
        nameUsed.add(finalName.toLowerCase());

        // Kuerzel: up to 6 chars from strain, alphanumeric+hyphen, deduplicated
        let kuerzel = strain.slice(0, 6).toUpperCase().replace(/[^A-Z0-9\-]/g, '') || 'UNK';
        const kuerzelBase = kuerzel.slice(0, 5);
        let kuerzelSuffix = 1;
        while (kuerzelUsed.has(kuerzel)) { kuerzel = kuerzelBase + kuerzelSuffix; kuerzelSuffix++; }
        kuerzelUsed.add(kuerzel);

        const result = insMS.run(finalName, kuerzel, '', now);
        pairToId.set(key, result.lastInsertRowid);
      }

      // Link existing batches to their mushroom_strain
      const updateBatch = db.prepare('UPDATE batches SET strain_id=? WHERE batch_id=?');
      for (const b of db.prepare("SELECT batch_id, species, strain FROM batches WHERE strain IS NOT NULL AND TRIM(strain) != ''").all()) {
        const key = (b.species || '').toLowerCase() + '|' + b.strain.toLowerCase();
        const id = pairToId.get(key);
        if (id) updateBatch.run(id, b.batch_id);
      }

      // Link existing cultures to their mushroom_strain
      const updateCulture = db.prepare('UPDATE cultures SET strain_id=? WHERE id=?');
      for (const c of db.prepare("SELECT id, species, strain FROM cultures WHERE strain IS NOT NULL AND TRIM(strain) != ''").all()) {
        const key = (c.species || '').toLowerCase() + '|' + c.strain.toLowerCase();
        const id = pairToId.get(key);
        if (id) updateCulture.run(id, c.id);
      }
    }
  },
  {
    version: 20,
    description: 'Add barcodes table — numeric barcode registry for all entities',
    fn(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS barcodes (
        barcode     INTEGER PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id   TEXT NOT NULL,
        created     TEXT NOT NULL
      )`);
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_barcodes_entity ON barcodes(entity_type, entity_id)');

      const now = new Date().toISOString();
      let nextBarcode = 1000000;
      const ins = db.prepare('INSERT INTO barcodes(barcode, entity_type, entity_id, created) VALUES(?,?,?,?)');

      // Assign barcodes to all existing bags
      for (const r of db.prepare('SELECT bag_id FROM bags ORDER BY bag_id').all()) {
        ins.run(nextBarcode++, 'bag', r.bag_id, now);
      }
      // Assign barcodes to all existing cultures
      for (const r of db.prepare('SELECT id FROM cultures ORDER BY created, id').all()) {
        ins.run(nextBarcode++, 'culture', r.id, now);
      }
      // Assign barcodes to all existing assets
      for (const r of db.prepare('SELECT asset_id FROM assets ORDER BY asset_id').all()) {
        ins.run(nextBarcode++, 'asset', r.asset_id, now);
      }
      // Assign barcodes to all existing zones
      for (const r of db.prepare('SELECT id FROM zones ORDER BY sort_order, id').all()) {
        ins.run(nextBarcode++, 'zone', r.id, now);
      }
      // Assign barcodes to all existing racks
      for (const r of db.prepare('SELECT id FROM racks ORDER BY zone_id, sort_order, id').all()) {
        ins.run(nextBarcode++, 'rack', r.id, now);
      }
    }
  },
  {
    version: 21,
    description: 'Add strain_text column to batches for free-text strain annotation',
    fn(db) {
      const has = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('batches') WHERE name='strain_text'").get();
      if (!has.c) db.exec("ALTER TABLE batches ADD COLUMN strain_text TEXT DEFAULT ''");
    }
  },
  {
    version: 22,
    description: 'Add kpi_snapshots table for daily KPI history',
    fn(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS kpi_snapshots (
          date           TEXT PRIMARY KEY,
          bags_created   INTEGER DEFAULT 0,
          grain_used_kg  REAL DEFAULT 0,
          harvest_kg     REAL DEFAULT 0,
          hardwood_used_kg REAL DEFAULT 0,
          wheatbran_used_kg REAL DEFAULT 0,
          avg_yield_g    REAL DEFAULT 0,
          contam_rate_pct REAL DEFAULT 0,
          contam_bags    INTEGER DEFAULT 0,
          total_bags_placed INTEGER DEFAULT 0,
          days_since_contam INTEGER,
          flush_2plus    INTEGER DEFAULT 0,
          bags_spawn     INTEGER DEFAULT 0,
          bags_incubation INTEGER DEFAULT 0,
          bags_fruiting  INTEGER DEFAULT 0,
          bags_contaminated INTEGER DEFAULT 0,
          total_batches  INTEGER DEFAULT 0,
          stock_hardwood_kg REAL DEFAULT 0,
          stock_wheatbran_kg REAL DEFAULT 0,
          stock_grain_kg REAL DEFAULT 0
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_kpi_date ON kpi_snapshots(date)');
    }
  }
];

function runMigrations(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied TEXT NOT NULL, description TEXT)'
  );
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_version')
      .all()
      .map((r) => r.version)
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    try {
      db.exec('BEGIN');
      if (m.fn) m.fn(db);
      else db.exec(m.sql);
      db.prepare('INSERT INTO schema_version(version, applied, description) VALUES(?, ?, ?)').run(
        m.version,
        new Date().toISOString(),
        m.description || ''
      );
      db.exec('COMMIT');
      console.log(`  Migration v${m.version} applied: ${m.description || ''}`);
    } catch (e) {
      db.exec('ROLLBACK');
      // Tolerate "duplicate column" errors — column may already exist from initial schema
      if (e.message && e.message.includes('duplicate column')) {
        db.exec('BEGIN');
        db.prepare('INSERT INTO schema_version(version, applied, description) VALUES(?, ?, ?)').run(
          m.version,
          new Date().toISOString(),
          m.description + ' (already exists)'
        );
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
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA wal_autocheckpoint = 1000');
  db.exec(SCHEMA);
  runMigrations(db);
  // Ensure singleton rows exist
  db.prepare(`INSERT OR IGNORE INTO inventory(id) VALUES(1)`).run();
  db.prepare(`INSERT OR IGNORE INTO caldav_config(id) VALUES(1)`).run();
  db.prepare(`INSERT OR IGNORE INTO duckdns_config(id) VALUES(1)`).run();
  db.prepare(`INSERT OR IGNORE INTO mcp_config(id) VALUES(1)`).run();
  return db;
}

// ── Barcode Registry ────────────────────────────────────────
function nextBarcodeNumber(db) {
  const row = db.prepare('SELECT MAX(barcode) as m FROM barcodes').get();
  return (row && row.m != null) ? row.m + 1 : 1000000;
}

function assignBarcode(db, entityType, entityId) {
  // Return existing barcode if already assigned
  const existing = db.prepare('SELECT barcode FROM barcodes WHERE entity_type=? AND entity_id=?').get(entityType, entityId);
  if (existing) return existing.barcode;
  const num = nextBarcodeNumber(db);
  db.prepare('INSERT INTO barcodes(barcode, entity_type, entity_id, created) VALUES(?,?,?,?)').run(
    num, entityType, entityId, new Date().toISOString()
  );
  return num;
}

function assignBarcodes(db, entityType, entityIds) {
  const result = {};
  const existing = db.prepare('SELECT barcode, entity_id FROM barcodes WHERE entity_type=? AND entity_id IN (' + entityIds.map(() => '?').join(',') + ')').all(entityType, ...entityIds);
  for (const r of existing) result[r.entity_id] = r.barcode;
  const missing = entityIds.filter(id => !(id in result));
  if (missing.length) {
    let num = nextBarcodeNumber(db);
    const ins = db.prepare('INSERT INTO barcodes(barcode, entity_type, entity_id, created) VALUES(?,?,?,?)');
    const now = new Date().toISOString();
    for (const id of missing) {
      ins.run(num, entityType, id, now);
      result[id] = num++;
    }
  }
  return result;
}

function lookupBarcode(db, barcode) {
  return db.prepare('SELECT entity_type, entity_id FROM barcodes WHERE barcode=?').get(barcode) || null;
}

function getBarcodeForEntity(db, entityType, entityId) {
  const row = db.prepare('SELECT barcode FROM barcodes WHERE entity_type=? AND entity_id=?').get(entityType, entityId);
  return row ? row.barcode : null;
}

function getAllBarcodes(db) {
  return db.prepare('SELECT barcode, entity_type, entity_id FROM barcodes ORDER BY barcode').all();
}

// ── Read All (assembles the JSON shape the client expects) ───
function readAll(db, opts = {}) {
  // Mushroom strains
  const mushroomStrains = listMushroomStrains(db);
  const msById = new Map(mushroomStrains.map((ms) => [ms.id, ms]));

  // Batches + bags
  const batchRows = db.prepare('SELECT * FROM batches ORDER BY created').all();
  const bagStmt = db.prepare('SELECT bag_id FROM bags WHERE batch_id = ? ORDER BY bag_id');
  const batches = batchRows.map((r) => {
    const ms = r.strain_id ? msById.get(r.strain_id) : null;
    return {
      batchId: r.batch_id,
      species: r.species,
      strain: r.strain,
      strainId: r.strain_id || null,
      strainName: ms ? ms.name : null,
      strainKuerzel: ms ? ms.kuerzel : null,
      strainDescriptor: ms ? (ms.description || null) : null,
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
      strainText: r.strain_text || '',
      created: r.created,
      due: r.due,
      bags: bagStmt.all(r.batch_id).map((b) => b.bag_id)
    };
  });

  // Scan log — include id for PATCH/DELETE targeting, join username
  const scanLog = db
    .prepare('SELECT s.*, u.username FROM scan_log s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.id')
    .all()
    .map((r) => ({
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
  const harvests = db
    .prepare('SELECT * FROM harvests ORDER BY id')
    .all()
    .map((r) => ({
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
  const cultures = db
    .prepare('SELECT * FROM cultures ORDER BY created')
    .all()
    .map((r) => {
      const ms = r.strain_id ? msById.get(r.strain_id) : null;
      return {
        id: r.id,
        type: r.type,
        species: r.species,
        strain: r.strain,
        strainId: r.strain_id || null,
        strainName: ms ? ms.name : null,
        strainKuerzel: ms ? ms.kuerzel : null,
        strainDescriptor: ms ? (ms.description || null) : null,
        parentId: r.parent_id,
        source: r.source,
        status: r.status,
        notes: r.notes,
        created: r.created
      };
    });

  // Manual tasks — include id for PATCH/DELETE targeting
  const manualTasks = db
    .prepare('SELECT * FROM manual_tasks ORDER BY id')
    .all()
    .map((r) => ({
      id: r.id,
      text: r.text,
      priority: r.priority,
      done: r.done === 1 ? true : false,
      created: r.created,
      assignee: r.assignee,
      dueDate: r.due_date,
      dueTime: r.due_time,
      dueEndTime: r.due_end_time,
      description: r.description,
      caldavUid: r.caldav_uid,
      caldavSynced: r.caldav_synced,
      private: r.private === 1 ? true : false,
      recurrence: r.recurrence || null,
      recurrenceUntil: r.recurrence_until || null
    }));

  // Team members — include id for DELETE targeting
  const teamMembers = db
    .prepare('SELECT * FROM team_members ORDER BY id')
    .all()
    .map((r) => ({
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
  const invLog = invLogRaw.map((r) => ({
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
    hasToken: !!ddns.token,
    lastIpUpdate: ddns.last_ip_update || null,
    lastIp: ddns.last_ip || null,
    leEnabled: ddns.le_enabled === 1,
    leLastRenewal: ddns.le_last_renewal || null,
    leExpiry: ddns.le_expiry || null
  };

  // Assets
  const assets = db
    .prepare('SELECT * FROM assets ORDER BY asset_id')
    .all()
    .map((r) => ({
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
  const calendarEvents = db
    .prepare('SELECT * FROM calendar_events ORDER BY start_date')
    .all()
    .map((r) => ({
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
      recurrence: r.recurrence || null,
      recurrenceUntil: r.recurrence_until || null,
      teamAssignees: parseTeamAssignees(r.team_assignees),
      assignees: assigneeMap.get(r.id) || []
    }));

  // Zones + Racks
  const zoneRows = db.prepare('SELECT * FROM zones ORDER BY sort_order, id').all();
  const rackStmt = db.prepare(
    'SELECT id, zone_id, sort_order, created FROM racks WHERE zone_id = ? ORDER BY sort_order, id'
  );
  const zones = zoneRows.map((z) => ({
    id: z.id,
    name: z.name,
    role: z.role,
    color: z.color,
    sortOrder: z.sort_order,
    maxCapacity: z.max_capacity || null,
    created: z.created,
    racks: rackStmt.all(z.id).map((r) => ({ id: r.id, sortOrder: r.sort_order, created: r.created }))
  }));

  // Suppliers
  const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY mat, name').all();

  // Barcodes
  const barcodes = getAllBarcodes(db);

  const version = getDataVersion(db);
  return {
    mushroomStrains,
    batches,
    scanLog,
    manualTasks,
    harvests,
    cultures,
    inventory,
    teamMembers,
    caldav,
    duckdns,
    assets,
    calendarEvents,
    zones,
    suppliers,
    barcodes,
    version
  };
}

// ── Data Versioning ─────────────────────────────────────────
function getDataVersion(db) {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get('data_version');
  return row ? parseInt(row.value, 10) : 0;
}
function incrementDataVersion(db) {
  const v = getDataVersion(db) + 1;
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
    'data_version',
    String(v)
  );
  return v;
}

// ── Write All (diff incoming JSON against DB, apply changes) ─
// Used by backup/restore only — normal mutations use atomic functions below
function writeAll(db, incoming) {
  db.exec('BEGIN');
  try {
    // ── Batches ──
    if (incoming.batches) {
      const existingIds = new Set(
        db
          .prepare('SELECT batch_id FROM batches')
          .all()
          .map((r) => r.batch_id)
      );
      const incomingIds = new Set(incoming.batches.map((b) => b.batchId));

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
          b.batchId,
          b.species,
          b.strain || null,
          b.qty,
          b.days,
          sub.hardwood || 0,
          sub.wheatbran || 0,
          sub.rh || 0,
          sub.gypsum ? 1 : 0,
          b.bagKg || 3,
          b.batchType || 'block',
          b.sourceId || null,
          b.notes || '',
          b.created,
          b.due
        );
        deleteBags.run(b.batchId);
        for (const bagId of b.bags || []) {
          insertBag.run(bagId, b.batchId);
        }
      }
    }

    // ── Scan Log (replace all) ──
    if (incoming.scanLog) {
      db.prepare('DELETE FROM scan_log').run();
      const ins = db.prepare(
        'INSERT INTO scan_log(time, action, batch, bag, "from", "to", species, strain, user_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const e of incoming.scanLog) {
        ins.run(
          e.time,
          e.action,
          e.batch || null,
          e.bag || null,
          e.from || null,
          e.to || null,
          e.species || null,
          e.strain || null,
          e.userId ?? e.user_id ?? null
        );
      }
    }

    // ── Harvests (replace all) ──
    if (incoming.harvests) {
      db.prepare('DELETE FROM harvests').run();
      const ins = db.prepare(
        'INSERT INTO harvests(time, batch, bag, species, strain, grams, flush) VALUES(?, ?, ?, ?, ?, ?, ?)'
      );
      for (const h of incoming.harvests) {
        ins.run(h.time, h.batch || null, h.bag || null, h.species || null, h.strain || null, h.grams, h.flush || 1);
      }
    }

    // ── Cultures ──
    if (incoming.cultures) {
      const existingIds = new Set(
        db
          .prepare('SELECT id FROM cultures')
          .all()
          .map((r) => r.id)
      );
      const incomingIds = new Set(incoming.cultures.map((c) => c.id));

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
        upsert.run(
          c.id,
          c.type,
          c.species || null,
          c.strain || null,
          c.parentId || null,
          c.source || null,
          c.status || 'active',
          c.notes || '',
          c.created
        );
      }
    }

    // ── Manual Tasks (replace all) ──
    if (incoming.manualTasks) {
      db.prepare('DELETE FROM manual_tasks').run();
      const ins = db.prepare(
        'INSERT INTO manual_tasks(text, priority, done, created, assignee, due_date, due_time, due_end_time, description, caldav_uid, caldav_synced, private, recurrence, recurrence_until) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const t of incoming.manualTasks) {
        ins.run(
          t.text,
          t.priority || 'med',
          t.done ? 1 : 0,
          t.created,
          t.assignee || null,
          t.dueDate || null,
          t.dueTime || null,
          t.dueEndTime || null,
          t.description || null,
          t.caldavUid || null,
          t.caldavSynced || null,
          t.private ? 1 : 0,
          t.recurrence || null,
          t.recurrenceUntil || null
        );
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
      db.prepare(
        `
        UPDATE inventory SET
          thresh_hardwood=?, thresh_wheatbran=?, thresh_gypsum=?, thresh_grain=?,
          avg_hw_pct=?, avg_wb_pct=?, avg_rh_pct=?, avg_bag_kg=?, avg_grain_bag_kg=?
        WHERE id=1
      `
      ).run(
        (thresh.hardwood && thresh.hardwood.minKg) ?? 50,
        (thresh.wheatbran && thresh.wheatbran.minKg) ?? 20,
        (thresh.gypsum && thresh.gypsum.minKg) ?? 5,
        (thresh.grain && thresh.grain.minKg) ?? 10,
        avg.hwPct ?? 75,
        avg.wbPct ?? 25,
        avg.rhPct ?? 63,
        avg.bagKg ?? 3,
        avg.grainBagKg ?? 1
      );
    }

    // ── Assets ──
    if (incoming.assets) {
      const existingIds = new Set(
        db
          .prepare('SELECT asset_id FROM assets')
          .all()
          .map((r) => r.asset_id)
      );
      const incomingIds = new Set(incoming.assets.map((a) => a.assetId));

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
        upsert.run(
          a.assetId,
          a.name,
          a.category,
          a.entryDate,
          a.exitDate || null,
          a.purchasePrice,
          a.usefulLife,
          a.depreciationMethod || 'linear',
          a.supplier || null,
          a.invoiceNumber || null,
          a.serialNumber || null,
          a.location || null,
          a.status || 'aktiv',
          a.notes || '',
          a.created
        );
      }
    }

    // ── Calendar Events ──
    if (incoming.calendarEvents) {
      const existingIds = new Set(
        db
          .prepare('SELECT id FROM calendar_events')
          .all()
          .map((r) => r.id)
      );
      const incomingIds = new Set(incoming.calendarEvents.map((e) => e.id));

      for (const id of existingIds) {
        if (!incomingIds.has(id)) {
          db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
        }
      }

      const upsert = db.prepare(`
        INSERT INTO calendar_events(id, title, description, start_date, end_date, all_day,
          start_time, end_time, category, color, caldav_uid, caldav_synced, created,
          recurrence, recurrence_until, team_assignees)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, description=excluded.description, start_date=excluded.start_date,
          end_date=excluded.end_date, all_day=excluded.all_day, start_time=excluded.start_time,
          end_time=excluded.end_time, category=excluded.category, color=excluded.color,
          caldav_uid=excluded.caldav_uid, caldav_synced=excluded.caldav_synced, created=excluded.created,
          recurrence=excluded.recurrence, recurrence_until=excluded.recurrence_until,
          team_assignees=excluded.team_assignees
      `);
      for (const e of incoming.calendarEvents) {
        upsert.run(
          e.id,
          e.title,
          e.description || null,
          e.startDate,
          e.endDate || null,
          e.allDay ? 1 : 0,
          e.startTime || null,
          e.endTime || null,
          e.category || 'custom',
          e.color || null,
          e.caldavUid || null,
          e.caldavSynced || null,
          e.created,
          e.recurrence || null,
          e.recurrenceUntil || null,
          serializeTeamAssignees(e.teamAssignees)
        );
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
      const existingZoneIds = new Set(
        db
          .prepare('SELECT id FROM zones')
          .all()
          .map((r) => r.id)
      );
      const existingRackIds = new Set(
        db
          .prepare('SELECT id FROM racks')
          .all()
          .map((r) => r.id)
      );
      const incomingZoneIds = new Set(incoming.zones.map((z) => z.id));
      const incomingRackIds = new Set(incoming.zones.flatMap((z) => (z.racks || []).map((r) => r.id)));

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
        upsertZone.run(z.id, z.name, z.role, z.color, z.sortOrder || 0, z.created || new Date().toISOString());
      }

      const upsertRack = db.prepare(`
        INSERT INTO racks(id, zone_id, sort_order, created)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          zone_id=excluded.zone_id, sort_order=excluded.sort_order, created=excluded.created
      `);
      for (const z of incoming.zones) {
        for (const r of z.racks || []) {
          upsertRack.run(r.id, z.id, r.sortOrder || 0, r.created || new Date().toISOString());
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
  // VACUUM INTO doesn't support bound parameters — whitelist path chars to prevent injection.
  // Allow absolute paths with letters, digits, dots, dashes, underscores, slashes, colons (Windows drive),
  // spaces (Windows user dirs like "OneDrive - Meisterpilze UG"), and backslashes.
  if (typeof destPath !== 'string' || !destPath.length) {
    throw new Error('Backup path required');
  }
  if (!/^[A-Za-z0-9 ._/\\:-]+$/.test(destPath)) {
    throw new Error('Backup path contains unsafe characters');
  }
  // Escape single quotes just in case (shouldn't match the whitelist above, but defense-in-depth)
  const safePath = destPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${safePath}'`);
  return Promise.resolve();
}

// ── Update CalDAV UID on a task after sync ──
function updateTaskCaldavUid(db, text, created, uid, synced) {
  db.prepare('UPDATE manual_tasks SET caldav_uid = ?, caldav_synced = ? WHERE text = ? AND created = ?').run(
    uid,
    synced,
    text,
    created
  );
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
  db.prepare('UPDATE manual_tasks SET due_date = ?, caldav_synced = NULL WHERE caldav_uid = ?').run(
    newDueDate,
    caldavUid
  );
  incrementDataVersion(db);
}

// ── Read only CalDAV config (lightweight, for auth checks) ──
function readCaldavConfig(db) {
  const cal = db.prepare('SELECT * FROM caldav_config WHERE id = 1').get();
  if (!cal) return { enabled: false };
  return {
    enabled: cal.enabled === 1
  };
}

// ── Auth helpers ────────────────────────────────────────────
function createUser(db, username, password, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const created = new Date().toISOString();
  db.prepare('INSERT INTO users(username, hash, salt, role, created) VALUES(?, ?, ?, ?, ?)').run(
    username,
    hash,
    salt,
    role || 'user',
    created
  );
  return { username, role: role || 'user', created };
}

function getUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserByUsernameCaseInsensitive(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
}

function verifyPassword(storedHash, salt, password) {
  const a = Buffer.from(storedHash, 'hex');
  const b = crypto.scryptSync(password, salt, 64);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSession(db, userId) {
  // Enforce session limit per user — evict oldest when at cap
  const count = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?').get(userId).count;
  if (count >= MAX_SESSIONS_PER_USER) {
    db.prepare(
      `DELETE FROM sessions WHERE token IN (
      SELECT token FROM sessions WHERE user_id = ? ORDER BY created ASC LIMIT ?
    )`
    ).run(userId, count - MAX_SESSIONS_PER_USER + 1);
  }
  const token = crypto.randomBytes(32).toString('hex');
  const created = new Date().toISOString();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions(token, user_id, created, expires) VALUES(?, ?, ?, ?)').run(
    token,
    userId,
    created,
    expires
  );
  return token;
}

function getSession(db, token) {
  return db
    .prepare(
      `SELECT s.token, s.user_id, s.expires, u.username, u.role
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.token = ? AND s.expires > datetime('now')`
    )
    .get(token);
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
  // Resolve strainId → species + strain text
  let strainId = b.strainId || null;
  let species = b.species;
  let strain = b.strain || null;
  if (strainId) {
    const ms = db.prepare('SELECT * FROM mushroom_strains WHERE id=?').get(strainId);
    if (!ms) throw new Error('Pilzsorte nicht gefunden');
    species = ms.name;
    strain = ms.kuerzel;
  }
  db.exec('BEGIN');
  try {
    const sub = b.substrate || {};
    db.prepare(
      `INSERT INTO batches(batch_id,species,strain,strain_id,qty,days,sub_hardwood,sub_wheatbran,sub_rh,sub_gypsum,bag_kg,batch_type,source_id,notes,strain_text,created,due) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      b.batchId,
      species,
      strain,
      strainId,
      b.qty,
      b.days,
      sub.hardwood || 0,
      sub.wheatbran || 0,
      sub.rh || 0,
      sub.gypsum ? 1 : 0,
      b.bagKg || 3,
      b.batchType || 'block',
      b.sourceId || null,
      b.notes || '',
      b.strainText || '',
      b.created,
      b.due
    );
    const ins = db.prepare('INSERT INTO bags(bag_id,batch_id) VALUES(?,?)');
    for (const bagId of b.bags || []) ins.run(bagId, b.batchId);
    // Assign numeric barcodes to all new bags
    const bagBarcodes = assignBarcodes(db, 'bag', b.bags || []);
    incrementDataVersion(db);
    db.exec('COMMIT');
    return { bagBarcodes };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function updateBatchField(db, batchId, fields) {
  // Note: qty is intentionally NOT in the allowed list. Changing qty here
  // would skip the inventory_log entries that addBagsToBatch / deleteBatchById
  // use to keep stock consistent. Use addBagsToBatch to grow a batch.
  db.exec('BEGIN');
  try {
    // Handle strainId update: resolve species+strain from mushroom_strains
    if (fields.strainId != null) {
      const ms = db.prepare('SELECT * FROM mushroom_strains WHERE id=?').get(fields.strainId);
      if (!ms) throw new Error('Pilzsorte nicht gefunden');
      db.prepare('UPDATE batches SET strain_id=?,species=?,strain=? WHERE batch_id=?').run(fields.strainId, ms.name, ms.kuerzel, batchId);
    }
    const allowed = ['notes', 'species', 'strain', 'days', 'due'];
    const cols = Object.keys(fields).filter((k) => allowed.includes(k));
    if (cols.length) {
      const sets = cols.map((c) => `${c}=?`).join(',');
      db.prepare(`UPDATE batches SET ${sets} WHERE batch_id=?`).run(...cols.map((c) => fields[c]), batchId);
    }
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function renameBatch(db, oldId, newId) {
  db.exec('BEGIN');
  // Defer FK checks to COMMIT so we can update parent (batches) and child (bags)
  // without hitting a constraint violation mid-transaction. The schema uses
  // ON DELETE CASCADE but not ON UPDATE CASCADE, so without deferral SQLite
  // rejects any update to batches.batch_id while bags still reference the old value.
  db.exec('PRAGMA defer_foreign_keys = ON');
  try {
    const existing = db.prepare('SELECT batch_id FROM batches WHERE batch_id=?').get(oldId);
    if (!existing) throw new Error('Batch not found: ' + oldId);
    const conflict = db.prepare('SELECT batch_id FROM batches WHERE batch_id=?').get(newId);
    if (conflict) throw new Error('A batch with ID "' + newId + '" already exists');
    db.prepare('UPDATE bags SET bag_id=REPLACE(bag_id,?,?) WHERE batch_id=?').run(oldId, newId, oldId);
    db.prepare('UPDATE scan_log SET bag=REPLACE(bag,?,?),batch=? WHERE batch=?').run(oldId, newId, newId, oldId);
    db.prepare('UPDATE harvests SET bag=REPLACE(bag,?,?),batch=? WHERE batch=?').run(oldId, newId, newId, oldId);
    db.prepare('UPDATE inventory_log SET ref=? WHERE ref=?').run(newId, oldId);
    db.prepare('UPDATE batches SET batch_id=? WHERE batch_id=?').run(newId, oldId);
    db.prepare('UPDATE bags SET batch_id=? WHERE batch_id=?').run(newId, oldId);
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function addBagsToBatch(db, batchId, newBags, newQty) {
  db.exec('BEGIN');
  try {
    const ins = db.prepare('INSERT OR IGNORE INTO bags(bag_id,batch_id) VALUES(?,?)');
    for (const id of newBags) ins.run(id, batchId);
    if (newQty != null) db.prepare('UPDATE batches SET qty=? WHERE batch_id=?').run(newQty, batchId);
    // Assign numeric barcodes to new bags
    const bagBarcodes = assignBarcodes(db, 'bag', newBags);
    incrementDataVersion(db);
    db.exec('COMMIT');
    return { bagBarcodes };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function deleteBatchById(db, batchId) {
  db.exec('BEGIN');
  try {
    // Read batch before deleting so we can reverse inventory deductions
    const row = db.prepare('SELECT qty, bag_kg, batch_type, sub_hardwood, sub_wheatbran, sub_rh, sub_gypsum FROM batches WHERE batch_id=?').get(batchId);
    if (row) {
      const deltas = computeBatchMaterialDeltas(row);
      // Reverse each delta (add materials back)
      for (const d of deltas) {
        const col = 'stock_' + d.mat;
        db.prepare(`UPDATE inventory SET ${col} = ${col} + ? WHERE id=1`).run(d.deltaKg);
        const cur = db.prepare(`SELECT ${col} as val FROM inventory WHERE id=1`).get();
        db.prepare('INSERT INTO inventory_log(time,mat,delta_kg,running,type,ref) VALUES(?,?,?,?,?,?)').run(
          new Date().toISOString(), d.mat, d.deltaKg, cur.val, 'batch-delete', batchId
        );
      }
    }
    db.prepare('DELETE FROM batches WHERE batch_id=?').run(batchId);
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Compute material kg used by a batch row (positive values = what was consumed) */
function computeBatchMaterialDeltas(row) {
  const deltas = [];
  const qty = row.qty;
  const bagKg = row.bag_kg || 3;
  if (row.batch_type === 'grain') {
    deltas.push({ mat: 'grain', deltaKg: qty * bagKg });
  } else {
    const hw = row.sub_hardwood || 0;
    const wb = row.sub_wheatbran || 0;
    const rh = row.sub_rh || 0;
    const gyp = row.sub_gypsum;
    if (hw || wb) {
      const dryKgPerBag = rh > 0 ? bagKg * (1 - rh / 100) : bagKg;
      const hwUsed = qty * dryKgPerBag * (hw / 100);
      const wbUsed = qty * dryKgPerBag * (wb / 100);
      if (hwUsed > 0) deltas.push({ mat: 'hardwood', deltaKg: hwUsed });
      if (wbUsed > 0) deltas.push({ mat: 'wheatbran', deltaKg: wbUsed });
      if (gyp) deltas.push({ mat: 'gypsum', deltaKg: qty * dryKgPerBag * 0.01 });
    }
  }
  return deltas;
}

// -- Scan Log --
function appendScanEntries(db, entries, userId) {
  const ins = db.prepare(
    'INSERT INTO scan_log(time,action,batch,bag,"from","to",species,strain,user_id) VALUES(?,?,?,?,?,?,?,?,?)'
  );
  const ids = [];
  db.exec('BEGIN');
  try {
    for (const e of entries) {
      const r = ins.run(
        e.time,
        e.action,
        e.batch || null,
        e.bag || null,
        e.from || null,
        e.to || null,
        e.species || null,
        e.strain || null,
        userId || null
      );
      ids.push(r.lastInsertRowid);
    }
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return ids;
}

function deleteLastScanEntries(db, n) {
  db.prepare('DELETE FROM scan_log WHERE id IN (SELECT id FROM scan_log ORDER BY id DESC LIMIT ?)').run(n);
  incrementDataVersion(db);
}

function deleteScanEntryById(db, id) {
  const info = db.prepare('DELETE FROM scan_log WHERE id = ?').run(id);
  if (info.changes > 0) incrementDataVersion(db);
  return info.changes > 0;
}

function clearScanLog(db) {
  db.prepare('DELETE FROM scan_log').run();
  incrementDataVersion(db);
}

// -- Harvests --
function insertHarvest(db, h) {
  if (!Number.isFinite(h.grams) || h.grams < 0) throw new Error('grams must be >= 0');
  const r = db
    .prepare('INSERT INTO harvests(time,batch,bag,species,strain,grams,flush) VALUES(?,?,?,?,?,?,?)')
    .run(h.time, h.batch || null, h.bag || null, h.species || null, h.strain || null, h.grams, h.flush || 1);
  incrementDataVersion(db);
  return r.lastInsertRowid;
}

// -- Cultures --
function insertCultures(db, cultures) {
  if (!cultures.length) return;
  const ins = db.prepare(
    `INSERT INTO cultures(id,type,species,strain,strain_id,parent_id,source,status,notes,created) VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET type=excluded.type, species=excluded.species, strain=excluded.strain, strain_id=excluded.strain_id,
       parent_id=excluded.parent_id, source=excluded.source, status=excluded.status, notes=excluded.notes, created=excluded.created`
  );
  for (const c of cultures) {
    // Resolve strainId if provided
    let strainId = c.strainId || null;
    let species = c.species || null;
    let strain = c.strain || null;
    if (strainId) {
      const ms = db.prepare('SELECT * FROM mushroom_strains WHERE id=?').get(strainId);
      if (ms) { species = ms.name; strain = ms.kuerzel; }
    }
    ins.run(c.id, c.type, species, strain, strainId, c.parentId || null, c.source || null, c.status || 'active', c.notes || '', c.created);
  }
  // Assign numeric barcodes to all new cultures
  const cultureBarcodes = assignBarcodes(db, 'culture', cultures.map(c => c.id));
  incrementDataVersion(db);
  return { cultureBarcodes };
}

function updateCulture(db, id, fields) {
  // Handle strainId update
  if (fields.strainId != null) {
    const ms = db.prepare('SELECT * FROM mushroom_strains WHERE id=?').get(fields.strainId);
    if (!ms) throw new Error('Pilzsorte nicht gefunden');
    db.prepare('UPDATE cultures SET strain_id=?,species=?,strain=? WHERE id=?').run(fields.strainId, ms.name, ms.kuerzel, id);
  }
  const allowed = ['status', 'notes', 'species', 'strain', 'source'];
  const cols = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!cols.length && fields.strainId == null) return;
  if (cols.length) {
    const sets = cols.map((c) => `${c}=?`).join(',');
    db.prepare(`UPDATE cultures SET ${sets} WHERE id=?`).run(...cols.map((c) => fields[c]), id);
  }
  incrementDataVersion(db);
}

function deleteCulture(db, id) {
  const info = db.prepare('DELETE FROM cultures WHERE id=?').run(id);
  if (info.changes > 0) incrementDataVersion(db);
  return info.changes > 0;
}

// -- Tasks --
function insertTask(db, t) {
  const r = db
    .prepare(
      'INSERT INTO manual_tasks(text,priority,done,created,assignee,due_date,due_time,due_end_time,description,caldav_uid,caldav_synced,private,recurrence,recurrence_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    )
    .run(
      t.text,
      t.priority || 'med',
      t.done ? 1 : 0,
      t.created,
      t.assignee || null,
      t.dueDate || null,
      t.dueTime || null,
      t.dueEndTime || null,
      t.description || null,
      t.caldavUid || null,
      t.caldavSynced || null,
      t.private ? 1 : 0,
      t.recurrence || null,
      t.recurrenceUntil || null
    );
  incrementDataVersion(db);
  return r.lastInsertRowid;
}

function updateTaskById(db, id, fields) {
  const map = {
    done: 'done',
    caldavUid: 'caldav_uid',
    caldavSynced: 'caldav_synced',
    text: 'text',
    priority: 'priority',
    assignee: 'assignee',
    dueDate: 'due_date',
    dueTime: 'due_time',
    dueEndTime: 'due_end_time',
    description: 'description',
    private: 'private',
    recurrence: 'recurrence',
    recurrenceUntil: 'recurrence_until'
  };
  const entries = Object.entries(fields).filter(([k]) => map[k]);
  if (!entries.length) return;
  const sets = entries.map(([k]) => `${map[k]}=?`).join(',');
  const vals = entries.map(([k, v]) => (k === 'done' || k === 'private' ? (v ? 1 : 0) : v));
  db.prepare(`UPDATE manual_tasks SET ${sets} WHERE id=?`).run(...vals, id);
  incrementDataVersion(db);
}

function readTaskById(db, id) {
  const r = db.prepare('SELECT * FROM manual_tasks WHERE id=?').get(id);
  if (!r) return null;
  return {
    id: r.id,
    text: r.text,
    priority: r.priority,
    done: r.done === 1,
    created: r.created,
    assignee: r.assignee,
    dueDate: r.due_date,
    dueTime: r.due_time,
    dueEndTime: r.due_end_time,
    description: r.description,
    caldavUid: r.caldav_uid,
    caldavSynced: r.caldav_synced,
    private: r.private === 1,
    recurrence: r.recurrence || null,
    recurrenceUntil: r.recurrence_until || null
  };
}

// Check whether a user is allowed to modify or delete a task.
// Admins can always modify. Otherwise, the user must be named in the
// task's assignee field (comma-separated) OR the task must be
// unassigned (null/empty assignee means "for everyone").
function canUserModifyTask(db, username, taskId, isAdmin) {
  if (isAdmin) return true;
  const r = db.prepare('SELECT assignee FROM manual_tasks WHERE id=?').get(taskId);
  if (!r) return false;
  if (!r.assignee || !String(r.assignee).trim()) return true;
  const assignees = String(r.assignee).split(',').map((s) => s.trim()).filter(Boolean);
  return assignees.includes(username);
}

function readTaskByCaldavUid(db, caldavUid) {
  const r = db.prepare('SELECT * FROM manual_tasks WHERE caldav_uid = ?').get(caldavUid);
  if (!r) return null;
  return {
    id: r.id,
    text: r.text,
    priority: r.priority,
    done: r.done === 1,
    created: r.created,
    assignee: r.assignee,
    dueDate: r.due_date,
    dueTime: r.due_time,
    dueEndTime: r.due_end_time,
    description: r.description,
    caldavUid: r.caldav_uid,
    caldavSynced: r.caldav_synced,
    private: r.private === 1,
    recurrence: r.recurrence || null,
    recurrenceUntil: r.recurrence_until || null
  };
}

function readBatchById(db, batchId) {
  const r = db.prepare('SELECT * FROM batches WHERE batch_id=?').get(batchId);
  if (!r) return null;
  const bagStmt = db.prepare('SELECT bag_id FROM bags WHERE batch_id = ? ORDER BY bag_id');
  return mapBatchRow(r, bagStmt, db);
}

function deleteTaskById(db, id) {
  db.prepare('DELETE FROM manual_tasks WHERE id=?').run(id);
  incrementDataVersion(db);
}

// -- Team Members --
function insertMember(db, m) {
  const r = db.prepare('INSERT INTO team_members(name,role,added) VALUES(?,?,?)').run(m.name, m.role || null, m.added);
  incrementDataVersion(db);
  return r.lastInsertRowid;
}

function deleteMember(db, id) {
  db.prepare('DELETE FROM team_members WHERE id=?').run(id);
  incrementDataVersion(db);
}

// -- Assets --
function upsertAsset(db, a) {
  db.prepare(
    `INSERT INTO assets(asset_id,name,category,entry_date,exit_date,purchase_price,useful_life,depreciation_method,supplier,invoice_number,serial_number,location,status,notes,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET name=excluded.name,category=excluded.category,entry_date=excluded.entry_date,exit_date=excluded.exit_date,purchase_price=excluded.purchase_price,useful_life=excluded.useful_life,depreciation_method=excluded.depreciation_method,supplier=excluded.supplier,invoice_number=excluded.invoice_number,serial_number=excluded.serial_number,location=excluded.location,status=excluded.status,notes=excluded.notes,created=excluded.created`
  ).run(
    a.assetId,
    a.name,
    a.category,
    a.entryDate,
    a.exitDate || null,
    a.purchasePrice,
    a.usefulLife,
    a.depreciationMethod || 'linear',
    a.supplier || null,
    a.invoiceNumber || null,
    a.serialNumber || null,
    a.location || null,
    a.status || 'aktiv',
    a.notes || '',
    a.created
  );
  const barcode = assignBarcode(db, 'asset', a.assetId);
  incrementDataVersion(db);
  return { barcode };
}

function deleteAssetById(db, id) {
  db.prepare('DELETE FROM assets WHERE asset_id=?').run(id);
  incrementDataVersion(db);
}

// -- CalDAV Config --
function updateCaldavCfg(db, c) {
  db.prepare('UPDATE caldav_config SET enabled=? WHERE id=1').run(c.enabled ? 1 : 0);
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
  if (fields.lastIpUpdate !== undefined) {
    sets.push('last_ip_update=?');
    vals.push(fields.lastIpUpdate);
  }
  if (fields.lastIp !== undefined) {
    sets.push('last_ip=?');
    vals.push(fields.lastIp);
  }
  if (fields.leLastRenewal !== undefined) {
    sets.push('le_last_renewal=?');
    vals.push(fields.leLastRenewal);
  }
  if (fields.leExpiry !== undefined) {
    sets.push('le_expiry=?');
    vals.push(fields.leExpiry);
  }
  if (sets.length) db.prepare('UPDATE duckdns_config SET ' + sets.join(',') + ' WHERE id=1').run(...vals);
}

// -- Inventory Delta --
const VALID_MATS = ['hardwood', 'wheatbran', 'gypsum', 'grain'];

function applyInventoryDelta(db, mat, deltaKg, type, ref) {
  if (!VALID_MATS.includes(mat)) throw new Error('invalid material: ' + mat);
  const col = 'stock_' + mat;
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE inventory SET ${col} = MAX(0, ${col} + ?) WHERE id=1`).run(deltaKg);
    const row = db.prepare(`SELECT ${col} as val FROM inventory WHERE id=1`).get();
    db.prepare('INSERT INTO inventory_log(time,mat,delta_kg,running,type,ref) VALUES(?,?,?,?,?,?)').run(
      new Date().toISOString(),
      mat,
      deltaKg,
      row.val,
      type || null,
      ref || null
    );
    incrementDataVersion(db);
    db.exec('COMMIT');
    return row.val;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function setInventoryAbsolute(db, mat, value, type, ref) {
  if (!VALID_MATS.includes(mat)) throw new Error('invalid material: ' + mat);
  const col = 'stock_' + mat;
  db.exec('BEGIN');
  try {
    const old = db.prepare(`SELECT ${col} as val FROM inventory WHERE id=1`).get().val;
    const delta = value - old;
    db.prepare(`UPDATE inventory SET ${col}=? WHERE id=1`).run(value);
    db.prepare('INSERT INTO inventory_log(time,mat,delta_kg,running,type,ref) VALUES(?,?,?,?,?,?)').run(
      new Date().toISOString(),
      mat,
      delta,
      value,
      type || null,
      ref || null
    );
    incrementDataVersion(db);
    db.exec('COMMIT');
    return value;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function updateInventoryConfig(db, thresholds, avgComposition) {
  const t = thresholds || {};
  const a = avgComposition || {};
  db.prepare(
    `UPDATE inventory SET thresh_hardwood=?,thresh_wheatbran=?,thresh_gypsum=?,thresh_grain=?,avg_hw_pct=?,avg_wb_pct=?,avg_rh_pct=?,avg_bag_kg=?,avg_grain_bag_kg=? WHERE id=1`
  ).run(
    (t.hardwood && t.hardwood.minKg) ?? 50,
    (t.wheatbran && t.wheatbran.minKg) ?? 20,
    (t.gypsum && t.gypsum.minKg) ?? 5,
    (t.grain && t.grain.minKg) ?? 10,
    a.hwPct ?? 75,
    a.wbPct ?? 25,
    a.rhPct ?? 63,
    a.bagKg ?? 3,
    a.grainBagKg ?? 1
  );
  incrementDataVersion(db);
}

// ── Supplier CRUD ──────────────────────────────────────────
function listSuppliers(db) {
  return db.prepare('SELECT * FROM suppliers ORDER BY mat, name').all();
}

function upsertSupplier(db, s) {
  if (!s.mat || !s.name) throw new Error('mat and name are required');
  if (!VALID_MATS.includes(s.mat)) throw new Error('invalid material: ' + s.mat);
  if (s.id) {
    db.prepare('UPDATE suppliers SET mat=?,name=?,url=?,phone=?,notes=? WHERE id=?').run(s.mat, s.name, s.url || null, s.phone || null, s.notes || null, s.id);
    incrementDataVersion(db);
    return s.id;
  }
  const info = db.prepare('INSERT INTO suppliers(mat,name,url,phone,notes) VALUES(?,?,?,?,?)').run(s.mat, s.name, s.url || null, s.phone || null, s.notes || null);
  incrementDataVersion(db);
  return Number(info.lastInsertRowid);
}

function deleteSupplier(db, id) {
  db.prepare('DELETE FROM suppliers WHERE id=?').run(id);
  incrementDataVersion(db);
}

// ── Calendar Event CRUD ─────────────────────────────────────
function serializeTeamAssignees(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(Array.isArray(v) ? v : []); } catch { return null; }
}
function parseTeamAssignees(v) {
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}

function insertCalendarEvent(db, ev, assigneeIds) {
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO calendar_events(id, title, description, start_date, end_date, all_day,
      start_time, end_time, category, color, caldav_uid, caldav_synced, created,
      recurrence, recurrence_until, team_assignees)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      ev.id,
      ev.title,
      ev.description || null,
      ev.startDate,
      ev.endDate || null,
      ev.allDay ? 1 : 0,
      ev.startTime || null,
      ev.endTime || null,
      ev.category || 'custom',
      ev.color || null,
      ev.caldavUid || null,
      ev.caldavSynced || null,
      ev.created || new Date().toISOString(),
      ev.recurrence || null,
      ev.recurrenceUntil || null,
      serializeTeamAssignees(ev.teamAssignees)
    );
    if (assigneeIds && assigneeIds.length) {
      const ins = db.prepare('INSERT INTO calendar_event_assignees(event_id, user_id) VALUES(?, ?)');
      for (const uid of assigneeIds) ins.run(ev.id, uid);
    }
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function updateCalendarEvent(db, id, fields) {
  const allowed = [
    'title',
    'description',
    'start_date',
    'end_date',
    'all_day',
    'start_time',
    'end_time',
    'category',
    'color',
    'caldav_uid',
    'caldav_synced',
    'recurrence',
    'recurrence_until',
    'team_assignees'
  ];
  const map = {
    startDate: 'start_date',
    endDate: 'end_date',
    allDay: 'all_day',
    startTime: 'start_time',
    endTime: 'end_time',
    caldavUid: 'caldav_uid',
    caldavSynced: 'caldav_synced',
    recurrenceUntil: 'recurrence_until',
    teamAssignees: 'team_assignees'
  };
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = map[k] || k;
    if (!allowed.includes(col)) continue;
    sets.push(col + '=?');
    if (col === 'all_day') vals.push(v ? 1 : 0);
    else if (col === 'team_assignees') vals.push(serializeTeamAssignees(v));
    else vals.push(v ?? null);
  }
  if (!sets.length) return;
  vals.push(id);
  db.prepare('UPDATE calendar_events SET ' + sets.join(',') + ' WHERE id=?').run(...vals);
  incrementDataVersion(db);
}

function getCalendarEventById(db, id) {
  return db.prepare('SELECT * FROM calendar_events WHERE id=?').get(id) || null;
}

function deleteCalendarEvent(db, id) {
  db.prepare('DELETE FROM calendar_events WHERE id=?').run(id);
  incrementDataVersion(db);
}

function readCalendarEventByCaldavUid(db, caldavUid) {
  const r = db.prepare('SELECT * FROM calendar_events WHERE caldav_uid = ?').get(caldavUid);
  if (!r) return null;
  return {
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
    recurrence: r.recurrence || null,
    recurrenceUntil: r.recurrence_until || null,
    teamAssignees: parseTeamAssignees(r.team_assignees)
  };
}

function setCalendarEventAssignees(db, eventId, userIds) {
  db.prepare('DELETE FROM calendar_event_assignees WHERE event_id=?').run(eventId);
  const ins = db.prepare('INSERT INTO calendar_event_assignees(event_id, user_id) VALUES(?, ?)');
  for (const uid of userIds) ins.run(eventId, uid);
  incrementDataVersion(db);
}

function getAllCalendarEventAssignees(db) {
  const rows = db
    .prepare(
      `
    SELECT cea.event_id, cea.user_id, u.username
    FROM calendar_event_assignees cea
    JOIN users u ON u.id = cea.user_id
    ORDER BY cea.event_id, u.username
  `
    )
    .all();
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
    const existing = db
      .prepare('SELECT id FROM racks WHERE id IN (' + z.racks.map(() => '?').join(',') + ')')
      .all(...z.racks);
    if (existing.length) throw new Error('Rack already exists: ' + existing.map((r) => r.id).join(', '));
  }
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO zones(id,name,role,color,sort_order,max_capacity,created) VALUES(?,?,?,?,?,?,?)').run(
      z.id,
      z.name,
      z.role,
      z.color,
      z.sortOrder || 0,
      z.maxCapacity || null,
      z.created || new Date().toISOString()
    );
    if (z.racks && z.racks.length) {
      const ins = db.prepare('INSERT INTO racks(id,zone_id,sort_order,created) VALUES(?,?,?,?)');
      z.racks.forEach((rId, i) => ins.run(rId, z.id, i + 1, z.created || new Date().toISOString()));
      assignBarcodes(db, 'rack', z.racks);
    }
    assignBarcode(db, 'zone', z.id);
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function zoneBagCount(db, zoneId) {
  // Get all rack ids for this zone
  const rackIds = db
    .prepare('SELECT id FROM racks WHERE zone_id=?')
    .all(zoneId)
    .map((r) => r.id);
  const allLocs = [zoneId, ...rackIds];
  // Replay scan_log to count bags currently in this zone
  const placeholders = allLocs.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT bag, action, "from", "to" FROM scan_log WHERE bag IS NOT NULL AND ("to" IN (${placeholders}) OR "from" IN (${placeholders})) ORDER BY id`
    )
    .all(...allLocs, ...allLocs);
  const bags = new Set();
  for (const r of rows) {
    if ((r.action === 'ADD' || r.action === 'MOVE' || r.action === 'MOVE_BATCH') && allLocs.includes(r.to)) bags.add(r.bag);
    if ((r.action === 'MOVE' || r.action === 'MOVE_BATCH' || r.action === 'REMOVE') && allLocs.includes(r.from)) bags.delete(r.bag);
  }
  return bags.size;
}

function deleteZone(db, id) {
  const count = zoneBagCount(db, id);
  if (count > 0) throw new Error('Zone has ' + count + ' bags — remove them first');
  db.prepare('DELETE FROM zones WHERE id=?').run(id);
  incrementDataVersion(db);
}

function reorderZones(db, order) {
  if (!Array.isArray(order)) throw new Error('order must be an array');
  const existing = new Set(db.prepare('SELECT id FROM zones').all().map((r) => r.id));
  for (const id of order) {
    if (!existing.has(id)) throw new Error('Unknown zone: ' + id);
  }
  db.exec('BEGIN');
  try {
    const upd = db.prepare('UPDATE zones SET sort_order=? WHERE id=?');
    order.forEach((id, i) => upd.run(i + 1, id));
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function insertRack(db, r) {
  db.prepare('INSERT INTO racks(id,zone_id,sort_order,created) VALUES(?,?,?,?)').run(
    r.id,
    r.zoneId,
    r.sortOrder || 0,
    r.created || new Date().toISOString()
  );
  assignBarcode(db, 'rack', r.id);
  incrementDataVersion(db);
}

function rackBagCount(db, rackId) {
  const rows = db
    .prepare(
      'SELECT bag, action, "from", "to" FROM scan_log WHERE bag IS NOT NULL AND ("to"=? OR "from"=?) ORDER BY id'
    )
    .all(rackId, rackId);
  const bags = new Set();
  for (const r of rows) {
    if ((r.action === 'ADD' || r.action === 'MOVE' || r.action === 'MOVE_BATCH') && r.to === rackId) bags.add(r.bag);
    if ((r.action === 'MOVE' || r.action === 'MOVE_BATCH' || r.action === 'REMOVE') && r.from === rackId) bags.delete(r.bag);
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

function renameZoneName(db, id, newName) {
  if (!newName || !newName.trim()) throw new Error('Zone name cannot be empty');
  if (newName.length > 50) throw new Error('Zone name too long (max 50 chars)');
  const z = db.prepare('SELECT id FROM zones WHERE id=?').get(id);
  if (!z) throw new Error('Zone not found: ' + id);
  db.prepare('UPDATE zones SET name=? WHERE id=?').run(newName.trim(), id);
  incrementDataVersion(db);
}

function getMcpCfg(db) {
  const row = db.prepare('SELECT * FROM mcp_config WHERE id=1').get();
  return { enabled: row.enabled === 1, hasToken: !!row.api_token };
}
function getMcpToken(db) {
  return db.prepare('SELECT api_token FROM mcp_config WHERE id=1').get().api_token || '';
}
function updateMcpCfg(db, cfg) {
  db.prepare('UPDATE mcp_config SET enabled=? WHERE id=1').run(cfg.enabled ? 1 : 0);
  incrementDataVersion(db);
}
function generateMcpToken(db) {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('UPDATE mcp_config SET api_token=? WHERE id=1').run(hash);
  incrementDataVersion(db);
  return token; // plaintext returned once to show to user; only hash is stored
}

// ── OAuth 2.0 ───────────────────────────────────────────────
function registerOAuthClient(db, { clientId, clientName, redirectUris }) {
  const existing = db.prepare('SELECT client_id FROM oauth_clients WHERE client_id = ?').get(clientId);
  if (existing) {
    db.prepare('UPDATE oauth_clients SET client_name = ?, redirect_uris = ? WHERE client_id = ?')
      .run(clientName || '', JSON.stringify(redirectUris), clientId);
  } else {
    db.prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created) VALUES (?, ?, ?, ?)')
      .run(clientId, clientName || '', JSON.stringify(redirectUris), new Date().toISOString());
  }
  return db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId);
}

function getOAuthClient(db, clientId) {
  const row = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId);
  if (!row) return null;
  if (row.revoked === 1) return null;
  return { clientId: row.client_id, clientName: row.client_name, redirectUris: JSON.parse(row.redirect_uris || '[]'), created: row.created, hasSecret: !!row.client_secret_hash, secretHash: row.client_secret_hash };
}

function createOAuthCode(db, { code, clientId, userId, redirectUri, codeChallenge, codeChallengeMethod, resource }) {
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
  try {
    db.prepare('INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, expires, resource) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(code, clientId, userId, redirectUri, codeChallenge, codeChallengeMethod || 'S256', expires, resource || '');
  } catch (e) {
    // Fallback if resource column doesn't exist yet (migration v15 not run)
    if (e.message && e.message.includes('resource')) {
      db.prepare('INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, expires) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(code, clientId, userId, redirectUri, codeChallenge, codeChallengeMethod || 'S256', expires);
    } else {
      throw e;
    }
  }
}

function getOAuthCode(db, code) {
  const row = db.prepare('SELECT * FROM oauth_codes WHERE code = ? AND used = 0 AND expires > datetime(\'now\')').get(code);
  if (!row) return null;
  return {
    code: row.code, clientId: row.client_id, userId: row.user_id, redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge, codeChallengeMethod: row.code_challenge_method, expires: row.expires,
    resource: row.resource || ''
  };
}

function markOAuthCodeUsed(db, code) {
  db.prepare('UPDATE oauth_codes SET used = 1 WHERE code = ?').run(code);
}

function createOAuthToken(db, { token, tokenType, clientId, userId, expiresInSeconds, refreshTokenRef }) {
  const expires = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  db.prepare('INSERT INTO oauth_tokens (token, token_type, client_id, user_id, expires, created, refresh_token_ref) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(token, tokenType, clientId, userId, expires, new Date().toISOString(), refreshTokenRef || null);
}

function getOAuthAccessToken(db, tokenHash) {
  const row = db.prepare("SELECT * FROM oauth_tokens WHERE token = ? AND token_type = 'access' AND revoked = 0 AND expires > datetime('now')").get(tokenHash);
  if (!row) return null;
  return { token: row.token, clientId: row.client_id, userId: row.user_id, expires: row.expires };
}

function getOAuthRefreshToken(db, tokenHash) {
  const row = db.prepare("SELECT * FROM oauth_tokens WHERE token = ? AND token_type = 'refresh' AND revoked = 0 AND expires > datetime('now')").get(tokenHash);
  if (!row) return null;
  return { token: row.token, clientId: row.client_id, userId: row.user_id, expires: row.expires };
}

function revokeOAuthTokensByRefresh(db, refreshHash) {
  db.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE refresh_token_ref = ? OR token = ?").run(refreshHash, refreshHash);
}

function deleteExpiredOAuthData(db) {
  db.prepare("DELETE FROM oauth_codes WHERE expires < datetime('now') OR used = 1").run();
  db.prepare("DELETE FROM oauth_tokens WHERE expires < datetime('now') OR revoked = 1").run();
}

function listOAuthClients(db) {
  const rows = db.prepare(`SELECT c.client_id, c.client_name, c.redirect_uris, c.client_secret_hash, c.created,
    (SELECT COUNT(*) FROM oauth_tokens t WHERE t.client_id = c.client_id AND t.token_type = 'access' AND t.revoked = 0 AND t.expires > datetime('now')) as active_sessions
    FROM oauth_clients c WHERE c.revoked = 0 ORDER BY c.created DESC`).all();
  return rows.map(r => ({
    clientId: r.client_id, clientName: r.client_name, redirectUris: JSON.parse(r.redirect_uris || '[]'),
    created: r.created, activeSessions: r.active_sessions, autoRegistered: !r.client_secret_hash
  }));
}

function deleteOAuthClient(db, clientId) {
  db.prepare('DELETE FROM oauth_tokens WHERE client_id = ?').run(clientId);
  db.prepare('DELETE FROM oauth_codes WHERE client_id = ?').run(clientId);
  const result = db.prepare('DELETE FROM oauth_clients WHERE client_id = ?').run(clientId);
  return result.changes;
}

function verifyOAuthClientSecret(db, clientId, secret) {
  const row = db.prepare('SELECT client_secret_hash FROM oauth_clients WHERE client_id = ? AND revoked = 0').get(clientId);
  if (!row || !row.client_secret_hash) return false;
  const hash = crypto.createHash('sha256').update(secret).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(row.client_secret_hash));
}

// ── Mushroom Strains CRUD ────────────────────────────────────
function listMushroomStrains(db) {
  return db.prepare('SELECT * FROM mushroom_strains ORDER BY name').all().map((r) => ({
    id: r.id, name: r.name, kuerzel: r.kuerzel, description: r.description || '',
    created: r.created, updated: r.updated || null
  }));
}

function createMushroomStrain(db, { name, kuerzel, description }) {
  if (!name || !name.trim()) throw new Error('Name ist Pflichtfeld');
  if (!kuerzel || !kuerzel.trim()) throw new Error('Kürzel ist Pflichtfeld');
  const now = new Date().toISOString();
  try {
    const result = db.prepare(
      'INSERT INTO mushroom_strains(name,kuerzel,description,created) VALUES(?,?,?,?)'
    ).run(name.trim(), kuerzel.trim(), description || '', now);
    incrementDataVersion(db);
    return result.lastInsertRowid;
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      if (e.message.includes('name')) throw new Error('Name already taken');
      if (e.message.includes('kuerzel')) throw new Error('Kürzel already taken');
    }
    throw e;
  }
}

function updateMushroomStrain(db, id, { name, kuerzel, description }) {
  const now = new Date().toISOString();
  const fields = {};
  if (name !== undefined) fields.name = name.trim();
  if (kuerzel !== undefined) fields.kuerzel = kuerzel.trim();
  if (description !== undefined) fields.description = description;
  if (!Object.keys(fields).length) return;
  fields.updated = now;
  const cols = Object.keys(fields);
  const sets = cols.map((c) => `${c}=?`).join(',');
  try {
    db.prepare(`UPDATE mushroom_strains SET ${sets} WHERE id=?`).run(...cols.map((c) => fields[c]), id);
    // Propagate name/kuerzel changes to batches and cultures that reference this strain
    if (fields.name || fields.kuerzel) {
      const ms = db.prepare('SELECT * FROM mushroom_strains WHERE id=?').get(id);
      if (ms) {
        db.prepare('UPDATE batches SET species=?,strain=? WHERE strain_id=?').run(ms.name, ms.kuerzel, id);
        db.prepare('UPDATE cultures SET species=?,strain=? WHERE strain_id=?').run(ms.name, ms.kuerzel, id);
      }
    }
    incrementDataVersion(db);
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      if (e.message.includes('name')) throw new Error('Name already taken');
      if (e.message.includes('kuerzel')) throw new Error('Kürzel already taken');
    }
    throw e;
  }
}

function deleteMushroomStrain(db, id) {
  const batchCount = db.prepare('SELECT COUNT(*) as c FROM batches WHERE strain_id=?').get(id).c;
  const cultureCount = db.prepare('SELECT COUNT(*) as c FROM cultures WHERE strain_id=?').get(id).c;
  if (batchCount > 0 || cultureCount > 0) {
    throw new Error(`Cannot delete: Pilzsorte is still in use (${batchCount} batches, ${cultureCount} cultures).`);
  }
  const result = db.prepare('DELETE FROM mushroom_strains WHERE id=?').run(id);
  if (result.changes > 0) incrementDataVersion(db);
  return result.changes > 0;
}

// ── Targeted queries for MCP tools (avoid full readAll) ─────
function mapBatchRow(r, bagStmt, db) {
  let strainName = null, strainKuerzel = null;
  if (r.strain_id && db) {
    const ms = db.prepare('SELECT name, kuerzel FROM mushroom_strains WHERE id=?').get(r.strain_id);
    if (ms) { strainName = ms.name; strainKuerzel = ms.kuerzel; }
  }
  return {
    batchId: r.batch_id, species: r.species, strain: r.strain, strainId: r.strain_id || null,
    strainName, strainKuerzel,
    qty: r.qty, days: r.days,
    substrate: { hardwood: r.sub_hardwood, wheatbran: r.sub_wheatbran, rh: r.sub_rh, gypsum: r.sub_gypsum === 1 },
    bagKg: r.bag_kg, batchType: r.batch_type, sourceId: r.source_id, notes: r.notes,
    strainText: r.strain_text || '',
    created: r.created, due: r.due, bags: bagStmt.all(r.batch_id).map(b => b.bag_id)
  };
}
function getAllBatches(db) {
  const bagStmt = db.prepare('SELECT bag_id FROM bags WHERE batch_id = ? ORDER BY bag_id');
  return db.prepare('SELECT * FROM batches ORDER BY created').all().map(r => mapBatchRow(r, bagStmt, db));
}
function getAllTasks(db) {
  return db.prepare('SELECT * FROM manual_tasks ORDER BY id').all().map(r => ({
    id: r.id, text: r.text, priority: r.priority, done: r.done === 1, created: r.created,
    assignee: r.assignee, dueDate: r.due_date, dueTime: r.due_time, dueEndTime: r.due_end_time,
    description: r.description,
    recurrence: r.recurrence || null, recurrenceUntil: r.recurrence_until || null
  }));
}
function getAllHarvests(db) {
  return db.prepare('SELECT * FROM harvests ORDER BY id').all().map(r => ({
    id: r.id, time: r.time, batch: r.batch, bag: r.bag,
    species: r.species, strain: r.strain, grams: r.grams, flush: r.flush
  }));
}
function getAllCultures(db) {
  const msStmt = db.prepare('SELECT name, kuerzel FROM mushroom_strains WHERE id=?');
  return db.prepare('SELECT * FROM cultures ORDER BY created').all().map(r => {
    let strainName = null, strainKuerzel = null;
    if (r.strain_id) {
      const ms = msStmt.get(r.strain_id);
      if (ms) { strainName = ms.name; strainKuerzel = ms.kuerzel; }
    }
    return {
      id: r.id, type: r.type, species: r.species, strain: r.strain,
      strainId: r.strain_id || null, strainName, strainKuerzel,
      parentId: r.parent_id, source: r.source, status: r.status, notes: r.notes, created: r.created
    };
  });
}
function getScanLog(db) {
  return db.prepare('SELECT s.*, u.username FROM scan_log s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.id').all().map(r => ({
    id: r.id, time: r.time, action: r.action, batch: r.batch, bag: r.bag,
    from: r.from, to: r.to, species: r.species, strain: r.strain
  }));
}
function getCalendarEvents(db) {
  const assigneeMap = getAllCalendarEventAssignees(db);
  return db.prepare('SELECT * FROM calendar_events ORDER BY start_date').all().map(r => ({
    id: r.id, title: r.title, description: r.description, startDate: r.start_date,
    endDate: r.end_date, allDay: r.all_day === 1, startTime: r.start_time, endTime: r.end_time,
    category: r.category, color: r.color,
    recurrence: r.recurrence || null, recurrenceUntil: r.recurrence_until || null,
    teamAssignees: parseTeamAssignees(r.team_assignees),
    assignees: assigneeMap.get(r.id) || []
  }));
}
function getInventory(db, logLimit) {
  const inv = db.prepare('SELECT * FROM inventory WHERE id = 1').get();
  const logRows = logLimit
    ? db.prepare('SELECT * FROM inventory_log ORDER BY id DESC LIMIT ?').all(logLimit).reverse()
    : db.prepare('SELECT * FROM inventory_log ORDER BY id').all();
  return {
    stock: { hardwood: inv.stock_hardwood, wheatbran: inv.stock_wheatbran, gypsum: inv.stock_gypsum, grain: inv.stock_grain },
    thresholds: { hardwood: { minKg: inv.thresh_hardwood }, wheatbran: { minKg: inv.thresh_wheatbran }, gypsum: { minKg: inv.thresh_gypsum }, grain: { minKg: inv.thresh_grain } },
    avgComposition: { hwPct: inv.avg_hw_pct, wbPct: inv.avg_wb_pct, rhPct: inv.avg_rh_pct, bagKg: inv.avg_bag_kg, grainBagKg: inv.avg_grain_bag_kg },
    log: logRows.map(r => ({ time: r.time, mat: r.mat, deltaKg: r.delta_kg, running: r.running, type: r.type, ref: r.ref }))
  };
}
function getZonesWithRacks(db) {
  const rackStmt = db.prepare('SELECT id, zone_id, sort_order, created FROM racks WHERE zone_id = ? ORDER BY sort_order, id');
  return db.prepare('SELECT * FROM zones ORDER BY sort_order, id').all().map(z => ({
    id: z.id, name: z.name, role: z.role, color: z.color, sortOrder: z.sort_order,
    maxCapacity: z.max_capacity || null, created: z.created,
    racks: rackStmt.all(z.id).map(r => ({ id: r.id, sortOrder: r.sort_order, created: r.created }))
  }));
}

// ── Daily KPI Snapshot ──────────────────────────────────────
function snapshotDailyKPIs(db) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Skip if already snapshotted today
  const existing = db.prepare('SELECT date FROM kpi_snapshots WHERE date = ?').get(today);
  if (existing) return { skipped: true, date: today };

  const dayStart = today + 'T00:00:00';
  const dayEnd = today + 'T23:59:59';

  // 1. Bags created today
  const bagsCreated = db.prepare(
    "SELECT COALESCE(SUM(qty), 0) AS v FROM batches WHERE created >= ? AND created <= ?"
  ).get(dayStart, dayEnd).v;

  // 2-4. Materials used today (from inventory_log, type='batch')
  const matRows = db.prepare(
    "SELECT mat, COALESCE(SUM(ABS(delta_kg)), 0) AS v FROM inventory_log WHERE type = 'batch' AND time >= ? AND time <= ? GROUP BY mat"
  ).all(dayStart, dayEnd);
  const matUsed = {};
  matRows.forEach(r => { matUsed[r.mat] = r.v; });

  // 5. Harvest today (kg)
  const harvestKg = db.prepare(
    "SELECT COALESCE(SUM(grams), 0) AS v FROM harvests WHERE time >= ? AND time <= ?"
  ).get(dayStart, dayEnd).v / 1000;

  // 6. Avg yield per bag (all-time) — total grams / unique bags harvested
  const yieldData = db.prepare(
    "SELECT COALESCE(SUM(grams), 0) AS totalG, COUNT(DISTINCT bag) AS uniqueBags FROM harvests"
  ).get();
  const avgYield = yieldData.uniqueBags > 0 ? Math.round(yieldData.totalG / yieldData.uniqueBags) : 0;

  // 7. Contamination rate (all-time) — contaminated bags / all bags placed
  const zones = db.prepare('SELECT id, role FROM zones').all();
  const contamZoneIds = zones.filter(z => z.role === 'contaminated').map(z => z.id);
  const allBagsPlaced = db.prepare(
    "SELECT COUNT(DISTINCT bag) AS v FROM scan_log WHERE action = 'ADD' AND bag IS NOT NULL"
  ).get().v;

  let contamBags = 0;
  if (contamZoneIds.length > 0) {
    // A bag is contaminated if it was ever moved TO a contaminated zone (or zone:rack)
    const placeholders = contamZoneIds.map(() => '?').join(',');
    // scan_log.to can be "zone" or "zone:rack", so we match zone prefix
    const contamRows = db.prepare(
      `SELECT DISTINCT bag FROM scan_log WHERE bag IS NOT NULL AND (` +
      contamZoneIds.map(() => `"to" = ? OR "to" LIKE ? || ':%'`).join(' OR ') + `)`
    ).all(...contamZoneIds.flatMap(id => [id, id]));
    contamBags = contamRows.length;
  }
  const contamRate = allBagsPlaced > 0 ? +(contamBags / allBagsPlaced * 100).toFixed(1) : 0;

  // 8. Days since last contamination
  let daysSinceContam = null;
  if (contamZoneIds.length > 0) {
    const lastContamCondition = contamZoneIds.map(() => `"to" = ? OR "to" LIKE ? || ':%'`).join(' OR ');
    const lastContam = db.prepare(
      `SELECT MAX(time) AS t FROM scan_log WHERE bag IS NOT NULL AND (${lastContamCondition})`
    ).get(...contamZoneIds.flatMap(id => [id, id]));
    if (lastContam && lastContam.t) {
      daysSinceContam = Math.floor((Date.now() - new Date(lastContam.t).getTime()) / 864e5);
    }
  }

  // 9. Flush 2+ bags
  const flush2Plus = db.prepare(
    "SELECT COUNT(*) AS v FROM (SELECT bag, MAX(flush) AS mf FROM harvests GROUP BY bag HAVING mf >= 2)"
  ).get().v;

  // 10. Pipeline counts — compute current bag locations from scan_log
  const zoneRoleMap = {};
  zones.forEach(z => { zoneRoleMap[z.id] = z.role; });
  const allScans = db.prepare('SELECT action, bag, "from", "to" FROM scan_log ORDER BY id').all();
  const bagZone = {}; // bag -> zone_id (current)
  allScans.forEach(e => {
    const toZone = e.to ? e.to.split(':')[0] : null;
    const fromZone = e.from ? e.from.split(':')[0] : null;
    if (e.action === 'ADD' && toZone) bagZone[e.bag] = toZone;
    if ((e.action === 'MOVE' || e.action === 'MOVE_BATCH') && toZone) bagZone[e.bag] = toZone;
    if (e.action === 'REMOVE' && fromZone && bagZone[e.bag] === fromZone) delete bagZone[e.bag];
  });
  const roleCounts = { spawn: 0, incubation: 0, fruiting: 0, contaminated: 0 };
  Object.values(bagZone).forEach(zId => {
    const role = zoneRoleMap[zId];
    if (role && roleCounts[role] !== undefined) roleCounts[role]++;
  });

  // 11. Total batches & current stock
  const totalBatches = db.prepare('SELECT COUNT(*) AS v FROM batches').get().v;
  const inv = db.prepare('SELECT stock_hardwood, stock_wheatbran, stock_grain FROM inventory WHERE id = 1').get();

  // Insert snapshot
  db.prepare(`INSERT INTO kpi_snapshots (
    date, bags_created, grain_used_kg, harvest_kg, hardwood_used_kg, wheatbran_used_kg,
    avg_yield_g, contam_rate_pct, contam_bags, total_bags_placed, days_since_contam,
    flush_2plus, bags_spawn, bags_incubation, bags_fruiting, bags_contaminated,
    total_batches, stock_hardwood_kg, stock_wheatbran_kg, stock_grain_kg
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    today, bagsCreated, matUsed.grain || 0, harvestKg, matUsed.hardwood || 0, matUsed.wheatbran || 0,
    avgYield, contamRate, contamBags, allBagsPlaced, daysSinceContam,
    flush2Plus, roleCounts.spawn, roleCounts.incubation, roleCounts.fruiting, roleCounts.contaminated,
    totalBatches, inv ? inv.stock_hardwood : 0, inv ? inv.stock_wheatbran : 0, inv ? inv.stock_grain : 0
  );

  return { saved: true, date: today };
}

function getKpiSnapshots(db, limit) {
  if (limit) {
    return db.prepare('SELECT * FROM kpi_snapshots ORDER BY date DESC LIMIT ?').all(limit).reverse();
  }
  return db.prepare('SELECT * FROM kpi_snapshots ORDER BY date').all();
}

module.exports = {
  openDb,
  readAll,
  writeAll,
  backupDb,
  getDataVersion,
  readCaldavConfig,
  updateTaskCaldavUid,
  updateBatchDue,
  updateTaskDueDate,
  createUser,
  getUserByUsername,
  getUserByUsernameCaseInsensitive,
  verifyPassword,
  createSession,
  getSession,
  deleteSession,
  deleteSessionsByUserId,
  deleteExpiredSessions,
  countUsers,
  listUsers,
  deleteUser,
  SESSION_TTL_MS,
  updateUserPassword,
  resetUserPassword,
  insertBatch,
  updateBatchField,
  renameBatch,
  addBagsToBatch,
  deleteBatchById,
  appendScanEntries,
  deleteLastScanEntries,
  deleteScanEntryById,
  clearScanLog,
  insertHarvest,
  insertCultures,
  updateCulture,
  deleteCulture,
  insertTask,
  updateTaskById,
  deleteTaskById,
  readTaskById,
  canUserModifyTask,
  readTaskByCaldavUid,
  readBatchById,
  insertMember,
  deleteMember,
  upsertAsset,
  deleteAssetById,
  updateCaldavCfg,
  getDuckdnsCfg,
  updateDuckdnsCfg,
  updateDuckdnsStatus,
  applyInventoryDelta,
  setInventoryAbsolute,
  updateInventoryConfig,
  listSuppliers,
  upsertSupplier,
  deleteSupplier,
  insertCalendarEvent,
  updateCalendarEvent,
  getCalendarEventById,
  deleteCalendarEvent,
  readCalendarEventByCaldavUid,
  setCalendarEventAssignees,
  getAllCalendarEventAssignees,
  insertZone,
  deleteZone,
  reorderZones,
  insertRack,
  deleteRack,
  zoneExists,
  renameZoneName,
  zoneBagCount,
  rackBagCount,
  getMcpCfg,
  getMcpToken,
  updateMcpCfg,
  generateMcpToken,
  registerOAuthClient,
  getOAuthClient,
  createOAuthCode,
  getOAuthCode,
  markOAuthCodeUsed,
  createOAuthToken,
  getOAuthAccessToken,
  getOAuthRefreshToken,
  revokeOAuthTokensByRefresh,
  deleteExpiredOAuthData,
  listOAuthClients,
  deleteOAuthClient,
  verifyOAuthClientSecret,
  getAllBatches,
  getAllTasks,
  getAllHarvests,
  getAllCultures,
  getScanLog,
  getCalendarEvents,
  getInventory,
  getZonesWithRacks,
  listMushroomStrains,
  createMushroomStrain,
  updateMushroomStrain,
  deleteMushroomStrain,
  assignBarcode,
  assignBarcodes,
  lookupBarcode,
  getBarcodeForEntity,
  getAllBarcodes,
  snapshotDailyKPIs,
  getKpiSnapshots
};
