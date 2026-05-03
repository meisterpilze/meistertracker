'use strict';
const { DatabaseSync: Database } = require('node:sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — keep in sync with server.js cookie Max-Age
const MAX_SESSIONS_PER_USER = 10;

// ── Date helpers ─────────────────────────────────────────────
// Lab day boundary = the server's local timezone midnight (a single physical lab,
// one timezone). KPI snapshots and "due today" comparisons should bucket events
// against this local day, not against UTC — otherwise a 23:00 Berlin event lands
// in the next UTC day and disappears from the wrong KPI bucket.
function localDayString(d = new Date()) {
  const offsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
}

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
  due           TEXT NOT NULL,
  grain_rh      REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bags (
  bag_id   TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bags_batch ON bags(batch_id);

CREATE TABLE IF NOT EXISTS scan_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  time        TEXT NOT NULL,
  action      TEXT NOT NULL,
  batch       TEXT,
  bag         TEXT,
  "from"      TEXT,
  "to"        TEXT,
  species     TEXT,
  strain      TEXT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  client_uuid TEXT
);
CREATE INDEX IF NOT EXISTS idx_scanlog_time ON scan_log(time);
-- I-11 idempotency index is created by migration v39, not here: pre-v39
-- databases reach this SCHEMA block before migrations run, and CREATE TABLE
-- IF NOT EXISTS is a no-op for them (so client_uuid wouldn't exist yet).
-- See audit-2026-04.md R-02 + PR #382.

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
  recurrence_until TEXT,
  -- I-15: SEQUENCE counter for VTODO output (RFC 5545 §3.8.7.4). Bumped on
  -- every update so external CalDAV clients can detect changes.
  sequence         INTEGER NOT NULL DEFAULT 0
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
  avg_grain_bag_kg REAL DEFAULT 1,
  avg_grain_rh_pct REAL DEFAULT 52
);

CREATE TABLE IF NOT EXISTS inventory_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  time     TEXT NOT NULL,
  mat      TEXT NOT NULL,
  delta_kg REAL NOT NULL,
  running  REAL DEFAULT 0,
  type     TEXT,
  ref      TEXT,
  user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL
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

CREATE TABLE IF NOT EXISTS print_bridge_config (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER DEFAULT 0,
  url     TEXT DEFAULT '',
  token   TEXT DEFAULT ''
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
  team_assignees   TEXT,
  exception_dates  TEXT,
  -- I-15: SEQUENCE counter for VEVENT output (RFC 5545 §3.8.7.4). Bumped on
  -- every update so external CalDAV clients can detect changes.
  sequence         INTEGER NOT NULL DEFAULT 0
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

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link_type  TEXT,
  link_id    TEXT,
  created    TEXT NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created DESC);

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
        if (!/^[a-z_][a-z0-9_]*$/i.test(col)) throw new Error('invalid column name: ' + col);
        const has = db
          .prepare("SELECT COUNT(*) as c FROM pragma_table_info('calendar_events') WHERE name = ?")
          .get(col);
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
        if (!/^[a-z_][a-z0-9_]*$/i.test(col)) throw new Error('invalid column name: ' + col);
        const has = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('manual_tasks') WHERE name = ?").get(col);
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
        if (!/^[a-z_][a-z0-9_]*$/i.test(col)) throw new Error('invalid column name: ' + col);
        const has = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('manual_tasks') WHERE name = ?").get(col);
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

      const hasBatch = db
        .prepare("SELECT COUNT(*) as c FROM pragma_table_info('batches') WHERE name='strain_id'")
        .get();
      if (!hasBatch.c) db.exec('ALTER TABLE batches ADD COLUMN strain_id INTEGER REFERENCES mushroom_strains(id)');

      const hasCulture = db
        .prepare("SELECT COUNT(*) as c FROM pragma_table_info('cultures') WHERE name='strain_id'")
        .get();
      if (!hasCulture.c) db.exec('ALTER TABLE cultures ADD COLUMN strain_id INTEGER REFERENCES mushroom_strains(id)');

      // Collect unique (species, strain) pairs from existing batches + cultures
      const pairs = new Map();
      const batchRows = db
        .prepare("SELECT DISTINCT species, strain FROM batches WHERE strain IS NOT NULL AND TRIM(strain) != ''")
        .all();
      const cultureRows = db
        .prepare("SELECT DISTINCT species, strain FROM cultures WHERE strain IS NOT NULL AND TRIM(strain) != ''")
        .all();
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
        while (nameUsed.has(finalName.toLowerCase())) {
          finalName = name + ' ' + nameSuffix;
          nameSuffix++;
        }
        nameUsed.add(finalName.toLowerCase());

        // Kuerzel: up to 6 chars from strain, alphanumeric+hyphen, deduplicated
        let kuerzel =
          strain
            .slice(0, 6)
            .toUpperCase()
            .replace(/[^A-Z0-9\-]/g, '') || 'UNK';
        const kuerzelBase = kuerzel.slice(0, 5);
        let kuerzelSuffix = 1;
        while (kuerzelUsed.has(kuerzel)) {
          kuerzel = kuerzelBase + kuerzelSuffix;
          kuerzelSuffix++;
        }
        kuerzelUsed.add(kuerzel);

        const result = insMS.run(finalName, kuerzel, '', now);
        pairToId.set(key, result.lastInsertRowid);
      }

      // Link existing batches to their mushroom_strain
      const updateBatch = db.prepare('UPDATE batches SET strain_id=? WHERE batch_id=?');
      for (const b of db
        .prepare("SELECT batch_id, species, strain FROM batches WHERE strain IS NOT NULL AND TRIM(strain) != ''")
        .all()) {
        const key = (b.species || '').toLowerCase() + '|' + b.strain.toLowerCase();
        const id = pairToId.get(key);
        if (id) updateBatch.run(id, b.batch_id);
      }

      // Link existing cultures to their mushroom_strain
      const updateCulture = db.prepare('UPDATE cultures SET strain_id=? WHERE id=?');
      for (const c of db
        .prepare("SELECT id, species, strain FROM cultures WHERE strain IS NOT NULL AND TRIM(strain) != ''")
        .all()) {
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
      // date is PRIMARY KEY — no extra index needed
    }
  },
  {
    version: 23,
    description: 'Add lab threshold columns to inventory table',
    fn(db) {
      db.exec('ALTER TABLE inventory ADD COLUMN lab_thresh_mc INTEGER DEFAULT 0');
      db.exec('ALTER TABLE inventory ADD COLUMN lab_thresh_pd INTEGER DEFAULT 0');
      db.exec('ALTER TABLE inventory ADD COLUMN lab_thresh_lc INTEGER DEFAULT 0');
      db.exec('ALTER TABLE inventory ADD COLUMN lab_thresh_g2g INTEGER DEFAULT 0');
      db.exec('ALTER TABLE inventory ADD COLUMN lab_thresh_gs INTEGER DEFAULT 0');
    }
  },
  {
    version: 24,
    description: 'Add reason column to scan_log for contamination tracking',
    fn(db) {
      db.exec('ALTER TABLE scan_log ADD COLUMN reason TEXT');
    }
  },
  {
    version: 25,
    description: 'Add recipes table for reusable substrate mixtures',
    fn(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS recipes (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          name          TEXT NOT NULL UNIQUE,
          hardwood_pct  REAL DEFAULT 0,
          wheatbran_pct REAL DEFAULT 0,
          gypsum_pct    REAL DEFAULT 0,
          rh_pct        REAL DEFAULT 0,
          notes         TEXT,
          created       TEXT NOT NULL
        )
      `);
    }
  },
  {
    version: 26,
    description: 'Add quality and notes columns to harvests',
    fn(db) {
      db.exec('ALTER TABLE harvests ADD COLUMN quality TEXT');
      db.exec('ALTER TABLE harvests ADD COLUMN notes TEXT');
    }
  },
  {
    version: 27,
    description: 'Add maintenance_log table for equipment/zone maintenance tracking',
    fn(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_log (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          asset_id        TEXT,
          zone_id         TEXT,
          type            TEXT NOT NULL,
          description     TEXT,
          scheduled_date  TEXT,
          completed_date  TEXT,
          completed_by    TEXT,
          notes           TEXT,
          FOREIGN KEY (asset_id) REFERENCES assets(asset_id),
          FOREIGN KEY (zone_id) REFERENCES zones(id)
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_maint_asset ON maintenance_log(asset_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_maint_zone ON maintenance_log(zone_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_maint_scheduled ON maintenance_log(scheduled_date)');
    }
  },
  {
    version: 28,
    description:
      'Remove UNIQUE constraint on mushroom_strains.name so multiple strains of the same species are allowed',
    disableForeignKeys: true,
    fn(db) {
      // SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so recreate the table.
      // disableForeignKeys flag ensures PRAGMA foreign_keys=OFF runs before BEGIN.
      db.exec(`
        CREATE TABLE mushroom_strains_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL,
          kuerzel     TEXT NOT NULL UNIQUE,
          description TEXT DEFAULT '',
          created     TEXT NOT NULL,
          updated     TEXT
        )
      `);
      db.exec('INSERT INTO mushroom_strains_new SELECT * FROM mushroom_strains');
      db.exec('DROP TABLE mushroom_strains');
      db.exec('ALTER TABLE mushroom_strains_new RENAME TO mushroom_strains');
    }
  },
  {
    version: 29,
    description: 'Clean up orphaned scan_log and harvests entries from previously deleted batches',
    fn(db) {
      db.exec('DELETE FROM scan_log WHERE batch IS NOT NULL AND batch NOT IN (SELECT batch_id FROM batches)');
      db.exec('DELETE FROM harvests WHERE batch IS NOT NULL AND batch NOT IN (SELECT batch_id FROM batches)');
    }
  },
  {
    version: 30,
    description: 'Add strain_text column to cultures for free-text strain annotation',
    fn(db) {
      const has = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('cultures') WHERE name='strain_text'").get();
      if (!has.c) db.exec("ALTER TABLE cultures ADD COLUMN strain_text TEXT DEFAULT ''");
    }
  },
  {
    version: 31,
    description: 'Add per-bag weight column to bags table and backfill from batch',
    fn(db) {
      db.exec('ALTER TABLE bags ADD COLUMN bag_kg REAL');
      db.exec('UPDATE bags SET bag_kg = (SELECT bag_kg FROM batches WHERE batches.batch_id = bags.batch_id)');
    }
  },
  {
    version: 32,
    description: 'Add exception_dates to calendar_events for per-occurrence recurring deletes',
    fn(db) {
      const has = db
        .prepare(`SELECT COUNT(*) as c FROM pragma_table_info('calendar_events') WHERE name='exception_dates'`)
        .get();
      if (!has.c) db.exec(`ALTER TABLE calendar_events ADD COLUMN exception_dates TEXT`);
    }
  },
  {
    version: 33,
    description: 'Add notifications table for per-user in-app alerts',
    fn(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type       TEXT NOT NULL,
          title      TEXT NOT NULL,
          body       TEXT,
          link_type  TEXT,
          link_id    TEXT,
          created    TEXT NOT NULL,
          read       INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created DESC);
      `);
    }
  },
  {
    version: 34,
    description: 'Add grain hydration fields: batches.grain_rh and inventory.avg_grain_rh_pct',
    fn(db) {
      const hasBatchCol = db
        .prepare("SELECT COUNT(*) as c FROM pragma_table_info('batches') WHERE name='grain_rh'")
        .get();
      if (!hasBatchCol.c) db.exec('ALTER TABLE batches ADD COLUMN grain_rh REAL DEFAULT 0');
      const hasInvCol = db
        .prepare("SELECT COUNT(*) as c FROM pragma_table_info('inventory') WHERE name='avg_grain_rh_pct'")
        .get();
      if (!hasInvCol.c) db.exec('ALTER TABLE inventory ADD COLUMN avg_grain_rh_pct REAL DEFAULT 52');
    }
  },
  {
    version: 35,
    description: 'Add print_bridge_config table for editable Windows print bridge settings',
    fn(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS print_bridge_config (
        id      INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER DEFAULT 0,
        url     TEXT DEFAULT '',
        token   TEXT DEFAULT ''
      )`);
    }
  },
  {
    version: 36,
    description: 'Contamination reports + types + photos (audit Section 2 MVP)',
    fn(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS contamination_types (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          key         TEXT NOT NULL UNIQUE,
          name_de     TEXT NOT NULL,
          name_en     TEXT NOT NULL,
          name_pt     TEXT NOT NULL,
          color       TEXT NOT NULL,
          sort_order  INTEGER DEFAULT 0,
          active      INTEGER NOT NULL DEFAULT 1,
          created     TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS contamination_reports (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          reported_at  TEXT NOT NULL,
          user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
          bag_id       TEXT,
          batch_id     TEXT,
          zone_id      TEXT,
          type_id      INTEGER NOT NULL REFERENCES contamination_types(id),
          severity     TEXT NOT NULL DEFAULT 'minor',
          notes        TEXT DEFAULT '',
          scan_log_id  INTEGER REFERENCES scan_log(id) ON DELETE SET NULL,
          resolved_at  TEXT,
          resolved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
          resolution   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_contam_batch ON contamination_reports(batch_id);
        CREATE INDEX IF NOT EXISTS idx_contam_zone  ON contamination_reports(zone_id);
        CREATE INDEX IF NOT EXISTS idx_contam_type  ON contamination_reports(type_id);
        CREATE INDEX IF NOT EXISTS idx_contam_time  ON contamination_reports(reported_at);
        CREATE TABLE IF NOT EXISTS contamination_photos (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          report_id   INTEGER NOT NULL REFERENCES contamination_reports(id) ON DELETE CASCADE,
          uuid        TEXT NOT NULL UNIQUE,
          rel_path    TEXT NOT NULL,
          thumb_path  TEXT NOT NULL,
          width       INTEGER,
          height      INTEGER,
          bytes       INTEGER NOT NULL,
          sha256      TEXT NOT NULL,
          uploaded_at TEXT NOT NULL,
          uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_contam_photos_report ON contamination_photos(report_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_contam_photos_sha ON contamination_photos(sha256);
      `);
      // Seed the default contamination type list. Admins can extend via a future
      // Settings UI; soft-deletes (active=0) preserve historical references.
      const now = new Date().toISOString();
      const seed = db.prepare(`INSERT OR IGNORE INTO contamination_types
        (key, name_de, name_en, name_pt, color, sort_order, active, created)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)`);
      const types = [
        ['tricho', 'Trichoderma (Grünschimmel)', 'Trichoderma (green mold)', 'Trichoderma (mofo verde)', '#16a34a', 10],
        ['cobweb', 'Spinnweben (Dactylium)', 'Cobweb (Dactylium)', 'Teia de aranha (Dactylium)', '#94a3b8', 20],
        ['bacterial_wet_rot', 'Bakterielle Nassfäule', 'Bacterial wet rot', 'Podridão úmida bacteriana', '#0891b2', 30],
        ['aspergillus', 'Aspergillus', 'Aspergillus', 'Aspergillus', '#facc15', 40],
        [
          'penicillium',
          'Penicillium (Blauschimmel)',
          'Penicillium (blue mold)',
          'Penicillium (mofo azul)',
          '#3b82f6',
          50
        ],
        ['wet_spot', 'Nassflecken', 'Wet spot', 'Mancha úmida', '#92400e', 60],
        ['pin_set_defect', 'Pin-Set-Defekt', 'Pin-set defect / aborts', 'Defeito de pin-set', '#a855f7', 70],
        ['mites', 'Milben', 'Mites', 'Ácaros', '#dc2626', 80],
        ['verticillium', 'Verticillium', 'Verticillium', 'Verticillium', '#f97316', 90],
        ['unknown_other', 'Unbekannt / Sonstiges', 'Unknown / other', 'Desconhecido / outro', '#64748b', 999]
      ];
      for (const t of types) seed.run(...t, now);
    }
  },
  {
    version: 37,
    description: 'Add minor indexes flagged by the audit (Section 3.2)',
    fn(db) {
      db.exec(`
        -- Used by getContaminationReport (server.js / db.js:3629). Partial
        -- index keeps it small since most scan_log entries have NULL reason.
        CREATE INDEX IF NOT EXISTS idx_scanlog_action_reason
          ON scan_log(action) WHERE reason IS NOT NULL;
        -- Batches order-by-created in readAll / getAllBatches.
        CREATE INDEX IF NOT EXISTS idx_batches_created ON batches(created);
      `);
    }
  },
  {
    version: 38,
    description: 'Add audit columns to mcp_config for static MCP token (audit S-08)',
    fn(db) {
      // SQLite doesn't support `ADD COLUMN ... IF NOT EXISTS`, so check the
      // current schema and add only the columns that are missing.
      const cols = db
        .prepare("SELECT name FROM pragma_table_info('mcp_config')")
        .all()
        .map((r) => r.name);
      if (!cols.includes('last_used_at')) {
        db.exec('ALTER TABLE mcp_config ADD COLUMN last_used_at TEXT');
      }
      if (!cols.includes('created_at')) {
        db.exec('ALTER TABLE mcp_config ADD COLUMN created_at TEXT');
      }
      if (!cols.includes('revoked_at')) {
        db.exec('ALTER TABLE mcp_config ADD COLUMN revoked_at TEXT');
      }
    }
  },
  {
    version: 39,
    description: 'Add client_uuid + sequence for scan idempotency and iCal RFC 5545 (I-11, I-15)',
    fn(db) {
      // I-11: client-supplied idempotency key on scan_log so the offline
      // queue (sw.js) can replay POSTs without creating duplicates when a
      // network partition times out the request but the server has already
      // committed it. Partial unique index — legacy rows have NULL.
      const scanCols = db
        .prepare("SELECT name FROM pragma_table_info('scan_log')")
        .all()
        .map((r) => r.name);
      if (!scanCols.includes('client_uuid')) {
        db.exec('ALTER TABLE scan_log ADD COLUMN client_uuid TEXT');
      }
      db.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_scanlog_client_uuid ON scan_log(client_uuid) WHERE client_uuid IS NOT NULL'
      );
      // I-15: SEQUENCE counter for VTODO/VEVENT iCal output. Bumped on every
      // update so external CalDAV clients can detect changes (RFC 5545 §3.8.7.4).
      const taskCols = db
        .prepare("SELECT name FROM pragma_table_info('manual_tasks')")
        .all()
        .map((r) => r.name);
      if (!taskCols.includes('sequence')) {
        db.exec('ALTER TABLE manual_tasks ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0');
      }
      const evtCols = db
        .prepare("SELECT name FROM pragma_table_info('calendar_events')")
        .all()
        .map((r) => r.name);
      if (!evtCols.includes('sequence')) {
        db.exec('ALTER TABLE calendar_events ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0');
      }
    }
  },
  {
    version: 40,
    description: 'Add user_id to inventory_log for actor accountability (I-22)',
    fn(db) {
      // I-22: every stock change should record who performed it. Existing rows
      // pre-date this column and stay NULL — we don't backfill since the
      // information is not recoverable from elsewhere. ON DELETE SET NULL so
      // removing a user keeps the audit trail (just anonymises it).
      const cols = db
        .prepare("SELECT name FROM pragma_table_info('inventory_log')")
        .all()
        .map((r) => r.name);
      if (!cols.includes('user_id')) {
        db.exec('ALTER TABLE inventory_log ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
      }
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
      // Migrations that drop/recreate tables with FK references need foreign_keys OFF
      // BEFORE the transaction (the pragma is a no-op inside a transaction).
      if (m.disableForeignKeys) db.exec('PRAGMA foreign_keys = OFF');
      db.exec('BEGIN');
      if (m.fn) m.fn(db);
      else db.exec(m.sql);
      db.prepare('INSERT INTO schema_version(version, applied, description) VALUES(?, ?, ?)').run(
        m.version,
        new Date().toISOString(),
        m.description || ''
      );
      db.exec('COMMIT');
      if (m.disableForeignKeys) db.exec('PRAGMA foreign_keys = ON');
      console.log(`  Migration v${m.version} applied: ${m.description || ''}`);
    } catch (e) {
      db.exec('ROLLBACK');
      if (m.disableForeignKeys) db.exec('PRAGMA foreign_keys = ON');
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
function backfillBarcodes(db) {
  const queries = [
    {
      type: 'bag',
      sql: "SELECT bag_id AS id FROM bags WHERE bag_id NOT IN (SELECT entity_id FROM barcodes WHERE entity_type='bag') ORDER BY bag_id"
    },
    {
      type: 'culture',
      sql: "SELECT id FROM cultures WHERE id NOT IN (SELECT entity_id FROM barcodes WHERE entity_type='culture') ORDER BY created, id"
    },
    {
      type: 'asset',
      sql: "SELECT asset_id AS id FROM assets WHERE asset_id NOT IN (SELECT entity_id FROM barcodes WHERE entity_type='asset') ORDER BY asset_id"
    },
    {
      type: 'zone',
      sql: "SELECT id FROM zones WHERE id NOT IN (SELECT entity_id FROM barcodes WHERE entity_type='zone') ORDER BY sort_order, id"
    },
    {
      type: 'rack',
      sql: "SELECT id FROM racks WHERE id NOT IN (SELECT entity_id FROM barcodes WHERE entity_type='rack') ORDER BY zone_id, sort_order, id"
    }
  ];
  const now = new Date().toISOString();
  let count = 0;
  for (const q of queries) {
    const missing = db.prepare(q.sql).all();
    if (missing.length) {
      let num = nextBarcodeNumber(db);
      const ins = db.prepare('INSERT INTO barcodes(barcode, entity_type, entity_id, created) VALUES(?,?,?,?)');
      for (const r of missing) {
        ins.run(num++, q.type, r.id, now);
        count++;
      }
    }
  }
  if (count) console.log(`[barcode-backfill] Assigned ${count} missing barcodes`);
}

function openDb(dbPath) {
  const db = new Database(dbPath);
  // R-16: stash the path on the handle so backupDb() can stat the source DB
  // for its disk-space pre-flight without having to plumb it through every
  // caller. Non-enumerable so it doesn't show up in stringification.
  Object.defineProperty(db, '_mpDbPath', { value: dbPath, enumerable: false, writable: false });
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
  db.prepare(`INSERT OR IGNORE INTO print_bridge_config(id) VALUES(1)`).run();
  db.prepare(`INSERT OR IGNORE INTO mcp_config(id) VALUES(1)`).run();
  // Backfill: assign numeric barcodes to any entities missing them
  backfillBarcodes(db);
  return db;
}

// ── Barcode Registry ────────────────────────────────────────
function nextBarcodeNumber(db) {
  const row = db.prepare('SELECT MAX(barcode) as m FROM barcodes').get();
  return row && row.m != null ? row.m + 1 : 1000000;
}

function assignBarcode(db, entityType, entityId) {
  // Return existing barcode if already assigned
  const existing = db
    .prepare('SELECT barcode FROM barcodes WHERE entity_type=? AND entity_id=?')
    .get(entityType, entityId);
  if (existing) return existing.barcode;
  const num = nextBarcodeNumber(db);
  db.prepare('INSERT INTO barcodes(barcode, entity_type, entity_id, created) VALUES(?,?,?,?)').run(
    num,
    entityType,
    entityId,
    new Date().toISOString()
  );
  return num;
}

function assignBarcodes(db, entityType, entityIds) {
  const result = {};
  const existing = db
    .prepare(
      'SELECT barcode, entity_id FROM barcodes WHERE entity_type=? AND entity_id IN (' +
        entityIds.map(() => '?').join(',') +
        ')'
    )
    .all(entityType, ...entityIds);
  for (const r of existing) result[r.entity_id] = r.barcode;
  const missing = entityIds.filter((id) => !(id in result));
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

  // Batches + bags. Bulk-load bags in ONE query and group by batch_id instead
  // of running bagStmt.all() once per batch (the audit-flagged N+1 — at 200
  // batches that was 200 statement executions every time readAll fired,
  // and readAll is called by /api/data which polls on each SSE event).
  const batchRows = db.prepare('SELECT * FROM batches ORDER BY created').all();
  const bagsByBatch = new Map();
  for (const b of db.prepare('SELECT batch_id, bag_id, bag_kg FROM bags ORDER BY batch_id, bag_id').all()) {
    let arr = bagsByBatch.get(b.batch_id);
    if (!arr) {
      arr = [];
      bagsByBatch.set(b.batch_id, arr);
    }
    arr.push(b);
  }
  const batches = batchRows.map((r) => {
    const ms = r.strain_id ? msById.get(r.strain_id) : null;
    const bagRows = bagsByBatch.get(r.batch_id) || [];
    const bagWeights = {};
    for (const b of bagRows) bagWeights[b.bag_id] = b.bag_kg != null ? b.bag_kg : r.bag_kg || 3;
    return {
      batchId: r.batch_id,
      species: r.species,
      strain: r.strain,
      strainId: r.strain_id || null,
      strainName: ms ? ms.name : null,
      strainKuerzel: ms ? ms.kuerzel : null,
      strainDescriptor: ms ? ms.description || null : null,
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
      grainRh: r.grain_rh || 0,
      sourceId: r.source_id,
      notes: r.notes,
      strainText: r.strain_text || '',
      created: r.created,
      due: r.due,
      bags: bagRows.map((b) => b.bag_id),
      bagWeights
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
      reason: r.reason || null,
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
      flush: r.flush,
      quality: r.quality || null,
      notes: r.notes || null
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
        strainDescriptor: ms ? ms.description || null : null,
        strainText: r.strain_text || '',
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
      recurrenceUntil: r.recurrence_until || null,
      sequence: r.sequence || 0
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
    ref: r.ref,
    // I-22: surface the actor for clients that need it (audit views, KPIs).
    user_id: r.user_id != null ? r.user_id : null
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
      grainBagKg: inv.avg_grain_bag_kg,
      grainRhPct: inv.avg_grain_rh_pct != null ? inv.avg_grain_rh_pct : 52
    },
    labThresholds: {
      MC: inv.lab_thresh_mc || 0,
      PD: inv.lab_thresh_pd || 0,
      LC: inv.lab_thresh_lc || 0,
      G2G: inv.lab_thresh_g2g || 0,
      GS: inv.lab_thresh_gs || 0
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
      exceptionDates: parseExceptionDates(r.exception_dates),
      assignees: assigneeMap.get(r.id) || [],
      sequence: r.sequence || 0
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

// ── P-06: Bag-zone cache ────────────────────────────────────
// snapshotDailyKPIs and getProductionPipeline both used to do a full
// `SCAN scan_log` to derive the per-bag current zone, then iterate the
// rows in JS to derive zone counts. At 50K scans that's ~80 ms per
// snapshot blocking the writer.
//
// We maintain a process-lifetime in-memory map (bag -> zone_id) that we
// update incrementally on each scan_log insert. The cache is rebuilt
// once on first access (lazy) by reading scan_log once; thereafter every
// write path that inserts into scan_log calls applyScanEntryToBagZoneCache
// with the new entry, so reads are O(1).
//
// Cache key = the database object. We keep a WeakMap so multiple Database
// instances (e.g. in tests) don't cross-contaminate.
const _bagZoneCacheByDb = new WeakMap();

function _readBagZoneFromDb(db) {
  const map = new Map();
  const stmt = db.prepare('SELECT action, bag, "to" FROM scan_log ORDER BY id');
  for (const e of stmt.iterate()) {
    if (!e.bag) continue;
    const toZ = e.to ? e.to.split(':')[0] : null;
    if (e.action === 'ADD' && toZ) map.set(e.bag, toZ);
    else if ((e.action === 'MOVE' || e.action === 'MOVE_BATCH') && toZ) map.set(e.bag, toZ);
    else if (e.action === 'REMOVE') map.delete(e.bag);
  }
  return map;
}

/** Get the bag→zone-id map for `db`. Builds once, then returned by
 * reference — DO NOT mutate from outside the helpers below. */
function getBagZoneMap(db) {
  let cached = _bagZoneCacheByDb.get(db);
  if (!cached) {
    cached = _readBagZoneFromDb(db);
    _bagZoneCacheByDb.set(db, cached);
  }
  return cached;
}

/** Apply a single scan_log entry to the cache (incremental update path).
 * Called from every write site that inserts into scan_log so consumers
 * never have to re-scan the table. */
function applyScanEntryToBagZoneCache(db, entry) {
  const cached = _bagZoneCacheByDb.get(db);
  if (!cached || !entry || !entry.bag) return; // not built yet — first read will build it
  const toZ = entry.to ? entry.to.split(':')[0] : null;
  if (entry.action === 'ADD' && toZ) cached.set(entry.bag, toZ);
  else if ((entry.action === 'MOVE' || entry.action === 'MOVE_BATCH') && toZ) cached.set(entry.bag, toZ);
  else if (entry.action === 'REMOVE') cached.delete(entry.bag);
}

/** Force a rebuild on next read. Used by writeAll (which replaces all of
 * scan_log) and by tests that mutate scan_log directly. */
function invalidateBagZoneCache(db) {
  _bagZoneCacheByDb.delete(db);
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
        INSERT INTO batches(batch_id, species, strain, strain_id, strain_text, qty, days, sub_hardwood, sub_wheatbran, sub_rh, sub_gypsum, bag_kg, batch_type, source_id, notes, created, due, grain_rh)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(batch_id) DO UPDATE SET
          species=excluded.species, strain=excluded.strain,
          strain_id=excluded.strain_id, strain_text=excluded.strain_text,
          qty=excluded.qty, days=excluded.days,
          sub_hardwood=excluded.sub_hardwood, sub_wheatbran=excluded.sub_wheatbran,
          sub_rh=excluded.sub_rh, sub_gypsum=excluded.sub_gypsum,
          bag_kg=excluded.bag_kg, batch_type=excluded.batch_type,
          source_id=excluded.source_id, notes=excluded.notes,
          created=excluded.created, due=excluded.due,
          grain_rh=excluded.grain_rh
      `);
      const deleteBags = db.prepare('DELETE FROM bags WHERE batch_id = ?');
      const insertBag = db.prepare('INSERT INTO bags(bag_id, batch_id, bag_kg) VALUES(?, ?, ?)');

      for (const b of incoming.batches) {
        const sub = b.substrate || {};
        upsertBatch.run(
          b.batchId,
          b.species,
          b.strain || null,
          b.strainId || null,
          b.strainText || '',
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
          b.due,
          b.batchType === 'grain' && Number.isFinite(b.grainRh) ? b.grainRh : 0
        );
        deleteBags.run(b.batchId);
        const bagIds = [];
        for (const item of b.bags || []) {
          if (typeof item === 'string') {
            insertBag.run(item, b.batchId, (b.bagWeights && b.bagWeights[item]) || b.bagKg || 3);
            bagIds.push(item);
          } else {
            insertBag.run(item.id, b.batchId, item.bagKg || b.bagKg || 3);
            bagIds.push(item.id);
          }
        }
        // Ensure all bags have barcode assignments
        if (bagIds.length) {
          assignBarcodes(db, 'bag', bagIds);
        }
      }
    }

    // ── Scan Log (replace all) ──
    if (incoming.scanLog) {
      db.prepare('DELETE FROM scan_log').run();
      // P-06: scan_log was wiped — invalidate the in-memory bag-zone cache
      // so the next snapshotDailyKPIs / getProductionPipeline rebuilds it
      // from the freshly-imported rows.
      invalidateBagZoneCache(db);
      // I-11: preserve client_uuid on bulk import so re-imported scan entries
      // keep their idempotency keys. Older exports won't have the field; the
      // column is nullable.
      const ins = db.prepare(
        'INSERT INTO scan_log(time, action, batch, bag, "from", "to", species, strain, user_id, reason, client_uuid) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
          e.userId ?? e.user_id ?? null,
          e.reason || null,
          e.client_uuid || e.clientUuid || null
        );
      }
    }

    // ── Harvests (replace all) ──
    if (incoming.harvests) {
      db.prepare('DELETE FROM harvests').run();
      const ins = db.prepare(
        'INSERT INTO harvests(time, batch, bag, species, strain, grams, flush, quality, notes) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const h of incoming.harvests) {
        ins.run(
          h.time,
          h.batch || null,
          h.bag || null,
          h.species || null,
          h.strain || null,
          h.grams,
          h.flush || 1,
          h.quality || null,
          h.notes || null
        );
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
        INSERT INTO cultures(id, type, species, strain, strain_id, strain_text, parent_id, source, status, notes, created)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type=excluded.type, species=excluded.species, strain=excluded.strain,
          strain_id=excluded.strain_id, strain_text=excluded.strain_text,
          parent_id=excluded.parent_id, source=excluded.source, status=excluded.status,
          notes=excluded.notes, created=excluded.created
      `);
      const cultureIds = [];
      for (const c of incoming.cultures) {
        upsert.run(
          c.id,
          c.type,
          c.species || null,
          c.strain || null,
          c.strainId || null,
          c.strainText || '',
          c.parentId || null,
          c.source || null,
          c.status || 'active',
          c.notes || '',
          c.created
        );
        cultureIds.push(c.id);
      }
      // Ensure all cultures have barcode assignments
      if (cultureIds.length) {
        assignBarcodes(db, 'culture', cultureIds);
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
      const lt = inv.labThresholds || {};
      db.prepare(
        `
        UPDATE inventory SET
          thresh_hardwood=?, thresh_wheatbran=?, thresh_gypsum=?, thresh_grain=?,
          avg_hw_pct=?, avg_wb_pct=?, avg_rh_pct=?, avg_bag_kg=?, avg_grain_bag_kg=?, avg_grain_rh_pct=?,
          lab_thresh_mc=?, lab_thresh_pd=?, lab_thresh_lc=?, lab_thresh_g2g=?, lab_thresh_gs=?
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
        avg.grainBagKg ?? 1,
        avg.grainRhPct ?? 52,
        lt.MC ?? 0,
        lt.PD ?? 0,
        lt.LC ?? 0,
        lt.G2G ?? 0,
        lt.GS ?? 0
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
      const assetIds = [];
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
        assetIds.push(a.assetId);
      }
      // Ensure all assets have barcode assignments
      if (assetIds.length) {
        assignBarcodes(db, 'asset', assetIds);
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
          recurrence, recurrence_until, team_assignees, exception_dates)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, description=excluded.description, start_date=excluded.start_date,
          end_date=excluded.end_date, all_day=excluded.all_day, start_time=excluded.start_time,
          end_time=excluded.end_time, category=excluded.category, color=excluded.color,
          caldav_uid=excluded.caldav_uid, caldav_synced=excluded.caldav_synced, created=excluded.created,
          recurrence=excluded.recurrence, recurrence_until=excluded.recurrence_until,
          team_assignees=excluded.team_assignees,
          exception_dates=excluded.exception_dates
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
          serializeTeamAssignees(e.teamAssignees),
          serializeExceptionDates(e.exceptionDates)
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
      const zoneIds = [];
      const rackIds = [];
      for (const z of incoming.zones) {
        upsertZone.run(z.id, z.name, z.role, z.color, z.sortOrder || 0, z.created || new Date().toISOString());
        zoneIds.push(z.id);
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
          rackIds.push(r.id);
        }
      }
      // Ensure all zones and racks have barcode assignments
      if (zoneIds.length) assignBarcodes(db, 'zone', zoneIds);
      if (rackIds.length) assignBarcodes(db, 'rack', rackIds);
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

// R-16: pre-flight disk-space check. VACUUM INTO with no free space leaves
// a half-written file behind and fails part-way through, so we'd rather
// fail loudly upfront. Node's fs.statfsSync was added in 18.15 but is not
// fully available on Windows in all Node 22 builds — treat any throw from
// statfsSync as "platform doesn't support this; log and continue".
function checkDiskSpace(targetPath, requiredBytes) {
  try {
    const dir = path.dirname(path.resolve(targetPath));
    const stats = fs.statfsSync(dir);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (free < requiredBytes) {
      throw new Error(
        'Insufficient disk space: ' +
          Math.round(free / 1e6) +
          'MB free, ' +
          Math.round(requiredBytes / 1e6) +
          'MB required'
      );
    }
    return { free, required: requiredBytes, ok: true };
  } catch (e) {
    if (e.message && e.message.startsWith('Insufficient')) throw e;
    // statfsSync not supported (older Node, Windows without polyfill): skip.
    return { free: null, required: requiredBytes, ok: true, skipped: true, reason: e.message };
  }
}

function backupDb(db, destPath) {
  // VACUUM INTO doesn't support bound parameters — whitelist path chars to prevent injection.
  // Allow absolute paths with letters, digits, dots, dashes, underscores, slashes, colons (Windows drive),
  // spaces (Windows user dirs like "OneDrive - Meisterpilze"), and backslashes.
  if (typeof destPath !== 'string' || !destPath.length) {
    throw new Error('Backup path required');
  }
  if (!/^[A-Za-z0-9 ._/\\:-]+$/.test(destPath)) {
    throw new Error('Backup path contains unsafe characters');
  }
  // R-16: pre-flight disk-space check. Require ~3x the current DB size: the
  // VACUUM target file is up to 1x, plus headroom for SQLite's own working
  // copy. Errors here surface as backup failures rather than corrupting the
  // primary DB.
  try {
    const dbFile = db._mpDbPath || null;
    if (dbFile && fs.existsSync(dbFile)) {
      const dbSize = fs.statSync(dbFile).size;
      checkDiskSpace(destPath, 3 * dbSize);
    }
  } catch (spaceErr) {
    if (spaceErr.message && spaceErr.message.startsWith('Insufficient')) {
      throw spaceErr;
    }
    // Other errors from the space check (e.g. statSync race) shouldn't
    // block the backup itself — fall through to VACUUM.
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
  // I-15: bump SEQUENCE so the change propagates to CalDAV clients.
  db.prepare(
    'UPDATE manual_tasks SET due_date = ?, caldav_synced = NULL, sequence = sequence + 1 WHERE caldav_uid = ?'
  ).run(newDueDate, caldavUid);
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

// R-10: periodic cleanup helpers (called from server.js setInterval).
// Both return the count of rows deleted so the caller can log totals.
function cleanupExpiredSessions(db) {
  const info = db.prepare("DELETE FROM sessions WHERE expires < datetime('now')").run();
  return info.changes;
}

function cleanupOldNotifications(db) {
  // Hold read notifications 30 days, then GC. Unread notifications are kept
  // forever so users don't lose anything they haven't seen.
  const info = db.prepare("DELETE FROM notifications WHERE read = 1 AND created < datetime('now', '-30 days')").run();
  return info.changes;
}

// ── Notifications ──
function createNotification(db, { userId, type, title, body, linkType, linkId }) {
  if (!userId || !type || !title) throw new Error('createNotification: userId, type, title required');
  const info = db
    .prepare(
      `INSERT INTO notifications(user_id, type, title, body, link_type, link_id, created, read)
       VALUES(?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .run(userId, type, title, body || null, linkType || null, linkId || null, new Date().toISOString());
  return info.lastInsertRowid;
}

function listNotifications(db, userId, limit = 20) {
  const lim = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  return db
    .prepare(
      // id DESC breaks ties when two rows share a created timestamp
      // (notifications inserted in the same millisecond).
      `SELECT id, user_id AS userId, type, title, body, link_type AS linkType, link_id AS linkId, created, read
       FROM notifications
       WHERE user_id = ?
       ORDER BY created DESC, id DESC
       LIMIT ?`
    )
    .all(userId, lim);
}

function countUnreadNotifications(db, userId) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(userId);
  return row ? row.c : 0;
}

function markNotificationsRead(db, userId, ids) {
  if (ids == null) {
    // Mark all unread as read
    const info = db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId);
    return info.changes;
  }
  if (!Array.isArray(ids) || !ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const info = db
    .prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${placeholders})`)
    .run(userId, ...ids);
  return info.changes;
}

function countUsers(db) {
  return db.prepare('SELECT COUNT(*) as count FROM users').get().count;
}

function listUsers(db) {
  return db.prepare('SELECT id, username, role, created FROM users ORDER BY id').all();
}

function deleteUser(db, userId) {
  // I-16: clean up all auth artifacts so a freshly-recycled user_id can't
  // inherit OAuth grants/tokens/sessions from the deleted account. Wrap in
  // a transaction so a partial failure doesn't leave dangling tokens.
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM oauth_tokens WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM oauth_codes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
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
// `deltas` is an optional array of { mat, deltaKg, type, ref } applied inside
// the same transaction as the batch + bag inserts. Atomicity guarantee: if
// any delta or insert fails, the batch row, bag rows, inventory mutations,
// and inventory_log entries are all rolled back.
function insertBatch(db, b, deltas, userId) {
  if (!Number.isFinite(b.qty) || b.qty < 1) throw new Error('qty must be >= 1');
  if (!Number.isFinite(b.days) || b.days < 1) throw new Error('days must be >= 1');
  // Resolve strainId → species + strain text
  let strainId = b.strainId || null;
  let species = b.species;
  let strain = b.strain || null;
  if (strainId) {
    const ms = db.prepare('SELECT * FROM mushroom_strains WHERE id=?').get(strainId);
    if (!ms) throw new Error('Pilzsorte nicht gefunden');
    species = ms.name + ' (' + ms.kuerzel + ')';
    if (!strain) strain = 'XXX';
  }
  // I-19: defensive substrate-composition check. Block batches must have
  // hardwood + wheatbran summing to 100% (within rounding). The client warns
  // before submit, but the API/MCP path is bypassable, so guard here too.
  // Skip when batchType is not 'block' (grain/liquid don't use this split) or
  // when both percentages are zero (caller opted out of detailed tracking).
  const batchType = b.batchType || 'block';
  if (batchType === 'block') {
    const sub0 = b.substrate || {};
    const hw0 = sub0.hardwood || 0;
    const wb0 = sub0.wheatbran || 0;
    if ((hw0 || wb0) && Math.abs(hw0 + wb0 - 100) > 0.01) {
      throw new Error('Substrate composition must total 100% (got ' + (hw0 + wb0).toFixed(1) + '%)');
    }
  }
  db.exec('BEGIN');
  try {
    const sub = b.substrate || {};
    const grainRh = b.batchType === 'grain' ? (Number.isFinite(b.grainRh) ? b.grainRh : 0) : 0;
    db.prepare(
      `INSERT INTO batches(batch_id,species,strain,strain_id,qty,days,sub_hardwood,sub_wheatbran,sub_rh,sub_gypsum,bag_kg,batch_type,source_id,notes,strain_text,created,due,grain_rh) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
      b.due,
      grainRh
    );
    const ins = db.prepare('INSERT INTO bags(bag_id,batch_id,bag_kg) VALUES(?,?,?)');
    for (const item of b.bags || []) {
      if (typeof item === 'string') {
        ins.run(item, b.batchId, b.bagKg || 3);
      } else {
        ins.run(item.id, b.batchId, item.bagKg || b.bagKg || 3);
      }
    }
    const bagIds = (b.bags || []).map((x) => (typeof x === 'string' ? x : x.id));
    // Assign numeric barcodes to all new bags
    const bagBarcodes = assignBarcodes(db, 'bag', bagIds);
    // Apply inventory deltas inside the same transaction so an under-stock
    // failure or invalid material rolls the batch back too.
    // I-22: forward `userId` so each row in `inventory_log` records the actor.
    if (Array.isArray(deltas)) {
      for (const d of deltas) {
        applyInventoryDeltaNoTxn(db, d.mat, d.deltaKg, d.type || 'batch', d.ref || b.batchId, userId || null);
      }
    }
    incrementDataVersion(db);
    db.exec('COMMIT');
    return { bagBarcodes };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function updateBatchField(db, batchId, fields) {
  // Note: qty is intentionally NOT in the allowed list. addBagsToBatch (post
  // I-23) and deleteBatchById both compute inventory deltas from the bag rows
  // they create/destroy and write the corresponding inventory_log entries; a
  // bare qty update here would mutate the count without any of that ledger
  // bookkeeping. Use addBagsToBatch to grow a batch.
  db.exec('BEGIN');
  try {
    // Handle strainId update: resolve species+strain from mushroom_strains
    if (fields.strainId != null) {
      const ms = db.prepare('SELECT * FROM mushroom_strains WHERE id=?').get(fields.strainId);
      if (!ms) throw new Error('Pilzsorte nicht gefunden');
      db.prepare('UPDATE batches SET strain_id=?,species=? WHERE batch_id=?').run(
        fields.strainId,
        ms.name + ' (' + ms.kuerzel + ')',
        batchId
      );
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
    // P-06: bag IDs were renamed in scan_log — invalidate the cache.
    invalidateBagZoneCache(db);
    db.prepare('UPDATE harvests SET bag=REPLACE(bag,?,?),batch=? WHERE batch=?').run(oldId, newId, newId, oldId);
    db.prepare('UPDATE inventory_log SET ref=? WHERE ref=?').run(newId, oldId);
    // Audit I-06: contamination reports also reference batch_id and bag_id; without these
    // updates the reports would orphan and the contamination history for the batch would
    // disappear from the UI after a rename.
    db.prepare('UPDATE contamination_reports SET batch_id=? WHERE batch_id=?').run(newId, oldId);
    db.prepare("UPDATE contamination_reports SET bag_id = REPLACE(bag_id, ?, ?) WHERE bag_id LIKE ? || '%'").run(
      oldId,
      newId,
      oldId
    );
    db.prepare('UPDATE batches SET batch_id=? WHERE batch_id=?').run(newId, oldId);
    db.prepare('UPDATE bags SET batch_id=? WHERE batch_id=?').run(newId, oldId);
    // Update barcode registry: rename entity_id for bags that were renamed
    db.prepare("UPDATE barcodes SET entity_id=REPLACE(entity_id,?,?) WHERE entity_type='bag' AND entity_id LIKE ?").run(
      oldId,
      newId,
      oldId + '%'
    );
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function renameCulture(db, oldId, newId) {
  db.exec('BEGIN');
  db.exec('PRAGMA defer_foreign_keys = ON');
  try {
    const existing = db.prepare('SELECT id FROM cultures WHERE id=?').get(oldId);
    if (!existing) throw new Error('Culture not found: ' + oldId);
    const conflict = db.prepare('SELECT id FROM cultures WHERE id=?').get(newId);
    if (conflict) throw new Error('A culture with ID "' + newId + '" already exists');
    // Update parent_id references in child cultures
    db.prepare('UPDATE cultures SET parent_id=? WHERE parent_id=?').run(newId, oldId);
    // Update source_id references in batches
    db.prepare('UPDATE batches SET source_id=? WHERE source_id=?').run(newId, oldId);
    // Rename the culture itself
    db.prepare('UPDATE cultures SET id=? WHERE id=?').run(newId, oldId);
    // Update barcode registry
    db.prepare("UPDATE barcodes SET entity_id=? WHERE entity_type='culture' AND entity_id=?").run(newId, oldId);
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function addBagsToBatch(db, batchId, newBags, newQty, bagKg, userId) {
  db.exec('BEGIN');
  try {
    // I-23: read the full batch row so we can reuse its composition for
    // proportional inventory deduction. addBagsToBatch previously bumped
    // qty + bag rows without touching inventory, so growing 10→12 bags
    // silently consumed real substrate that never hit the ledger.
    const batch = db.prepare('SELECT * FROM batches WHERE batch_id=?').get(batchId);
    if (!batch) throw new Error('batch not found: ' + batchId);

    // Resolve bag weight: explicit param > batch's existing weight
    let weight = bagKg;
    if (weight == null) weight = batch.bag_kg || 3;

    const ins = db.prepare('INSERT OR IGNORE INTO bags(bag_id,batch_id,bag_kg) VALUES(?,?,?)');
    for (const id of newBags) ins.run(id, batchId, weight);
    if (newQty != null) db.prepare('UPDATE batches SET qty=? WHERE batch_id=?').run(newQty, batchId);

    // I-23: compute and apply inventory deltas for the *added* bags only.
    // Reuses computeBatchMaterialDeltasForKg so the deduction math matches
    // what insertBatch would have charged for those bags originally. Negative
    // deltas are clamped against current stock by applyInventoryDeltaNoTxn —
    // the same lenient behaviour insertBatch already has when stock is short.
    const addedWetKg = weight * newBags.length;
    const deltas = computeBatchMaterialDeltasForKg(batch, addedWetKg);
    for (const d of deltas) {
      applyInventoryDeltaNoTxn(db, d.mat, -d.deltaKg, 'batch-grow', batchId, userId || null);
    }

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

function deleteBatchById(db, batchId, userId) {
  db.exec('BEGIN');
  try {
    // Read batch before deleting so we can reverse inventory deductions
    const row = db
      .prepare(
        'SELECT qty, bag_kg, batch_type, sub_hardwood, sub_wheatbran, sub_rh, sub_gypsum, grain_rh FROM batches WHERE batch_id=?'
      )
      .get(batchId);
    if (row) {
      row.batch_id = batchId;
      const deltas = computeBatchMaterialDeltas(db, row);
      // Reverse each delta (add materials back)
      for (const d of deltas) {
        const col = 'stock_' + d.mat;
        db.prepare(`UPDATE inventory SET ${col} = ${col} + ? WHERE id=1`).run(d.deltaKg);
        const cur = db.prepare(`SELECT ${col} as val FROM inventory WHERE id=1`).get();
        // I-22: include user_id so the inventory ledger records who triggered the credit-back.
        db.prepare('INSERT INTO inventory_log(time,mat,delta_kg,running,type,ref,user_id) VALUES(?,?,?,?,?,?,?)').run(
          new Date().toISOString(),
          d.mat,
          d.deltaKg,
          cur.val,
          'batch-delete',
          batchId,
          userId || null
        );
      }
    }
    db.prepare('DELETE FROM harvests WHERE batch=?').run(batchId);
    db.prepare('DELETE FROM scan_log WHERE batch=?').run(batchId);
    // P-06: scan_log rows for this batch are gone — invalidate the cache.
    invalidateBagZoneCache(db);
    // Audit I-07: keep contamination history (audit-relevant) by NULLing the FK
    // instead of deleting the report rows. The reports list (listContaminationReports)
    // already filters by batch_id only when set, so NULL rows remain visible in the
    // unfiltered view.
    db.prepare('UPDATE contamination_reports SET batch_id = NULL WHERE batch_id = ?').run(batchId);
    db.prepare("UPDATE contamination_reports SET bag_id = NULL WHERE bag_id LIKE ? || '%'").run(batchId);
    db.prepare('DELETE FROM batches WHERE batch_id=?').run(batchId);
    incrementDataVersion(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Compute material kg used by a batch row (positive values = what was consumed) */
function computeBatchMaterialDeltas(db, row) {
  const deltas = [];
  // Read actual per-bag weights from the bags table
  const bagWeightRows = db.prepare('SELECT bag_kg FROM bags WHERE batch_id = ?').all(row.batch_id);
  const fallbackKg = row.bag_kg || 3;
  if (row.batch_type === 'grain') {
    // grain_rh = % water added during hydration (e.g. 52 for wheat).
    // Dry grain used = wet bag weight * (1 - rh/100). rh=0 preserves legacy behaviour
    // for batches created before the hydration field existed.
    const rh = row.grain_rh || 0;
    let totalDryKg = 0;
    if (bagWeightRows.length) {
      for (const b of bagWeightRows) {
        const kg = b.bag_kg != null ? b.bag_kg : fallbackKg;
        totalDryKg += rh > 0 ? kg * (1 - rh / 100) : kg;
      }
    } else {
      const dryKgPerBag = rh > 0 ? fallbackKg * (1 - rh / 100) : fallbackKg;
      totalDryKg = row.qty * dryKgPerBag;
    }
    deltas.push({ mat: 'grain', deltaKg: totalDryKg });
  } else {
    const hw = row.sub_hardwood || 0;
    const wb = row.sub_wheatbran || 0;
    const rh = row.sub_rh || 0;
    const gyp = row.sub_gypsum;
    if (hw || wb) {
      let totalDryKg = 0;
      if (bagWeightRows.length) {
        for (const b of bagWeightRows) {
          const kg = b.bag_kg != null ? b.bag_kg : fallbackKg;
          totalDryKg += rh > 0 ? kg * (1 - rh / 100) : kg;
        }
      } else {
        const dryKgPerBag = rh > 0 ? fallbackKg * (1 - rh / 100) : fallbackKg;
        totalDryKg = row.qty * dryKgPerBag;
      }
      const hwUsed = totalDryKg * (hw / 100);
      const wbUsed = totalDryKg * (wb / 100);
      if (hwUsed > 0) deltas.push({ mat: 'hardwood', deltaKg: hwUsed });
      if (wbUsed > 0) deltas.push({ mat: 'wheatbran', deltaKg: wbUsed });
      if (gyp) deltas.push({ mat: 'gypsum', deltaKg: totalDryKg * 0.01 });
    }
  }
  return deltas;
}

/**
 * I-23: Compute material kg consumed by adding `addedWetKg` (sum of new bags'
 * wet weights) to an existing batch. Reuses the batch's stored composition
 * (hardwood/wheatbran %, rh %, gypsum flag, grain_rh) so the deduction matches
 * what the original `insertBatch` deduction logic would have charged for those
 * bags. Returns deltas as positive consumption values; caller flips the sign
 * when applying to inventory. Returns [] when the batch has no composition
 * (legacy or zero-percent batches).
 */
function computeBatchMaterialDeltasForKg(batch, addedWetKg) {
  const deltas = [];
  if (!batch || !(addedWetKg > 0)) return deltas;
  if (batch.batch_type === 'grain') {
    const rh = batch.grain_rh || 0;
    const dryKg = rh > 0 ? addedWetKg * (1 - rh / 100) : addedWetKg;
    if (dryKg > 0) deltas.push({ mat: 'grain', deltaKg: dryKg });
    return deltas;
  }
  const hw = batch.sub_hardwood || 0;
  const wb = batch.sub_wheatbran || 0;
  if (!hw && !wb) return deltas;
  const rh = batch.sub_rh || 0;
  const dryKg = rh > 0 ? addedWetKg * (1 - rh / 100) : addedWetKg;
  const hwUsed = dryKg * (hw / 100);
  const wbUsed = dryKg * (wb / 100);
  if (hwUsed > 0) deltas.push({ mat: 'hardwood', deltaKg: hwUsed });
  if (wbUsed > 0) deltas.push({ mat: 'wheatbran', deltaKg: wbUsed });
  if (batch.sub_gypsum) deltas.push({ mat: 'gypsum', deltaKg: dryKg * 0.01 });
  return deltas;
}

// -- Scan Log --
// Append scan entries inside an existing transaction. Caller is responsible for BEGIN/COMMIT
// and for calling incrementDataVersion(). Returns the inserted row IDs (or the
// existing row id if a client_uuid collision triggered the ON CONFLICT branch).
//
// I-11: client_uuid is the offline-queue idempotency key. SQLite UPSERT
// (ON CONFLICT DO NOTHING) makes the INSERT a no-op when the same UUID is
// replayed; we then look up the original row id so callers (and the
// `_serverId` reconciliation on the client) still see a real id.
function appendScanEntriesNoTxn(db, entries, userId) {
  // I-11: SQLite UPSERT against the partial unique index needs the index's
  // exact WHERE clause in the conflict target ("partial index conflict
  // resolution", https://www.sqlite.org/lang_upsert.html). Without the
  // WHERE clause the planner can't match the partial index and raises
  // "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint".
  const insIdempotent = db.prepare(
    'INSERT INTO scan_log(time,action,batch,bag,"from","to",species,strain,user_id,reason,client_uuid) ' +
      'VALUES(?,?,?,?,?,?,?,?,?,?,?) ' +
      'ON CONFLICT(client_uuid) WHERE client_uuid IS NOT NULL DO NOTHING'
  );
  // Fallback for entries without a client_uuid. ON CONFLICT against a partial
  // index whose WHERE rejects NULL never fires for NULL keys anyway, but
  // keeping a separate plain INSERT keeps the call site explicit and avoids
  // depending on that subtle planner detail.
  const insPlain = db.prepare(
    'INSERT INTO scan_log(time,action,batch,bag,"from","to",species,strain,user_id,reason,client_uuid) ' +
      'VALUES(?,?,?,?,?,?,?,?,?,?,?)'
  );
  const lookupByUuid = db.prepare('SELECT id FROM scan_log WHERE client_uuid = ?');
  const ids = [];
  for (const e of entries) {
    const stmt = e.client_uuid ? insIdempotent : insPlain;
    const r = stmt.run(
      e.time,
      e.action,
      e.batch || null,
      e.bag || null,
      e.from || null,
      e.to || null,
      e.species || null,
      e.strain || null,
      userId || null,
      e.reason || null,
      e.client_uuid || null
    );
    if (r.changes === 0 && e.client_uuid) {
      // Replay: row already exists. Return the existing id so the client can
      // still reconcile its in-memory entry with a server id.
      const existing = lookupByUuid.get(e.client_uuid);
      ids.push(existing ? existing.id : null);
    } else {
      ids.push(r.lastInsertRowid);
      // P-06: keep the in-memory bag→zone cache in sync incrementally so
      // snapshotDailyKPIs / getProductionPipeline don't have to re-scan
      // scan_log on every call. A REPLAY (changes === 0) is a no-op for
      // the cache because the original entry already updated it.
      applyScanEntryToBagZoneCache(db, e);
    }
  }
  return ids;
}

function appendScanEntries(db, entries, userId) {
  db.exec('BEGIN');
  try {
    const ids = appendScanEntriesNoTxn(db, entries, userId);
    incrementDataVersion(db);
    db.exec('COMMIT');
    return ids;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function deleteLastScanEntries(db, n) {
  db.prepare('DELETE FROM scan_log WHERE id IN (SELECT id FROM scan_log ORDER BY id DESC LIMIT ?)').run(n);
  // P-06: rows removed — incremental update not possible without re-reading,
  // so invalidate and let the next read rebuild from scratch.
  invalidateBagZoneCache(db);
  incrementDataVersion(db);
}

function getScanEntryById(db, id) {
  return db.prepare('SELECT id, user_id, action, time FROM scan_log WHERE id = ?').get(id);
}

function deleteScanEntryById(db, id) {
  const info = db.prepare('DELETE FROM scan_log WHERE id = ?').run(id);
  if (info.changes > 0) {
    invalidateBagZoneCache(db); // P-06: row removed — rebuild cache lazily
    incrementDataVersion(db);
  }
  return info.changes > 0;
}

function clearScanLog(db) {
  db.prepare('DELETE FROM scan_log').run();
  invalidateBagZoneCache(db); // P-06
  incrementDataVersion(db);
}

// -- Harvests --
function insertHarvest(db, h) {
  if (!Number.isFinite(h.grams) || h.grams < 0) throw new Error('grams must be >= 0');
  const r = db
    .prepare('INSERT INTO harvests(time,batch,bag,species,strain,grams,flush,quality,notes) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(
      h.time,
      h.batch || null,
      h.bag || null,
      h.species || null,
      h.strain || null,
      h.grams,
      h.flush || 1,
      h.quality || null,
      h.notes || null
    );
  incrementDataVersion(db);
  return r.lastInsertRowid;
}

// -- Cultures --
// I-20: allowed parent types per child type. Enforced in insertCultures and
// updateCulture. Block batches are not cultures, so they're not in this map.
// G2G and GS both denote grain spawn cultures and share the same parent rules.
// Existing rows in the DB may already violate these rules — we don't run any
// retroactive cleanup, just enforce the constraint going forward.
const VALID_CULTURE_PARENT_TYPES = {
  MC: [], // mother culture is the lineage root — no parent allowed
  PD: ['MC', 'PD'],
  LC: ['MC', 'PD', 'LC'],
  G2G: ['MC', 'PD', 'LC', 'G2G', 'GS'],
  GS: ['MC', 'PD', 'LC', 'G2G', 'GS']
};

function validateCultureParent(db, type, parentId) {
  if (!parentId) return null;
  const parent = db.prepare('SELECT type FROM cultures WHERE id = ?').get(parentId);
  if (!parent) return 'parent culture not found: ' + parentId;
  const allowed = VALID_CULTURE_PARENT_TYPES[type];
  if (!allowed) return 'unknown culture type: ' + type;
  if (allowed.length === 0) return type + ' cultures cannot have a parent';
  if (!allowed.includes(parent.type)) {
    return type + ' parent must be one of [' + allowed.join(', ') + '], got ' + parent.type;
  }
  return null;
}

function insertCultures(db, cultures) {
  if (!cultures.length) return;
  const ins = db.prepare(
    `INSERT INTO cultures(id,type,species,strain,strain_id,parent_id,source,status,notes,created,strain_text) VALUES(?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET type=excluded.type, species=excluded.species, strain=excluded.strain, strain_id=excluded.strain_id,
       parent_id=excluded.parent_id, source=excluded.source, status=excluded.status, notes=excluded.notes, created=excluded.created, strain_text=excluded.strain_text`
  );
  for (const c of cultures) {
    // Reject self-cycles up front so the lineage walker never has to discover them.
    if (c.parentId && c.parentId === c.id) {
      throw new Error('Culture parent_id must not equal its own id (self-cycle rejected)');
    }
    // I-20: validate parent type against the child type (defence-in-depth —
    // the UI dropdown already filters by allowed types, but the API and MCP
    // tools accept arbitrary parentId so the constraint is enforceable here).
    const err = validateCultureParent(db, c.type, c.parentId || null);
    if (err) throw new Error('Invalid culture parent: ' + err);

    // Resolve strainId if provided
    let strainId = c.strainId || null;
    let species = c.species || null;
    let strain = c.strain || null;
    if (strainId) {
      const ms = db.prepare('SELECT * FROM mushroom_strains WHERE id=?').get(strainId);
      if (ms) {
        species = ms.name;
        strain = ms.kuerzel;
      }
    }
    ins.run(
      c.id,
      c.type,
      species,
      strain,
      strainId,
      c.parentId || null,
      c.source || null,
      c.status || 'active',
      c.notes || '',
      c.created,
      c.strainText || ''
    );
  }
  // Assign numeric barcodes to all new cultures
  const cultureBarcodes = assignBarcodes(
    db,
    'culture',
    cultures.map((c) => c.id)
  );
  incrementDataVersion(db);
  return { cultureBarcodes };
}

function updateCulture(db, id, fields) {
  // Defence-in-depth: even though parent_id isn't in the allowed list today,
  // reject self-cycle attempts up front.
  if ((fields.parentId != null && fields.parentId === id) || (fields.parent_id != null && fields.parent_id === id)) {
    throw new Error('Culture parent_id must not equal its own id (self-cycle rejected)');
  }
  // I-20: if a future update path ever lets parent_id through the allowed
  // list, validate the parent type against the child's existing type. This
  // covers both the camelCase and snake_case spellings.
  const incomingParent = fields.parentId != null ? fields.parentId : fields.parent_id != null ? fields.parent_id : null;
  if (incomingParent) {
    const cur = db.prepare('SELECT type FROM cultures WHERE id = ?').get(id);
    if (cur) {
      const err = validateCultureParent(db, cur.type, incomingParent);
      if (err) throw new Error('Invalid culture parent: ' + err);
    }
  }
  // Handle strainId update
  if (fields.strainId != null) {
    const ms = db.prepare('SELECT * FROM mushroom_strains WHERE id=?').get(fields.strainId);
    if (!ms) throw new Error('Pilzsorte nicht gefunden');
    db.prepare('UPDATE cultures SET strain_id=?,species=?,strain=? WHERE id=?').run(
      fields.strainId,
      ms.name,
      ms.kuerzel,
      id
    );
  }
  const allowed = ['status', 'notes', 'species', 'strain', 'source', 'strain_text'];
  // Map camelCase to snake_case for DB
  if (fields.strainText != null && fields.strain_text == null) {
    fields.strain_text = fields.strainText;
  }
  const cols = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!cols.length && fields.strainId == null) return;
  if (cols.length) {
    const sets = cols.map((c) => `${c}=?`).join(',');
    db.prepare(`UPDATE cultures SET ${sets} WHERE id=?`).run(...cols.map((c) => fields[c]), id);
  }
  incrementDataVersion(db);
}

/** Get a single culture by ID with strain info and lineage (parent + children) */
function getCultureById(db, id) {
  const r = db.prepare('SELECT * FROM cultures WHERE id=?').get(id);
  if (!r) return null;
  let strainName = null,
    strainKuerzel = null;
  if (r.strain_id) {
    const ms = db.prepare('SELECT name, kuerzel FROM mushroom_strains WHERE id=?').get(r.strain_id);
    if (ms) {
      strainName = ms.name;
      strainKuerzel = ms.kuerzel;
    }
  }
  const parent = r.parent_id
    ? db.prepare('SELECT id, type, species, strain, status FROM cultures WHERE id=?').get(r.parent_id)
    : null;
  const children = db
    .prepare('SELECT id, type, species, strain, status, created FROM cultures WHERE parent_id=? ORDER BY created')
    .all(id);
  const batches = db
    .prepare(
      'SELECT batch_id, species, strain, batch_type, created, due FROM batches WHERE source_id=? ORDER BY created'
    )
    .all(id)
    .map((b) => ({
      batchId: b.batch_id,
      species: b.species,
      strain: b.strain,
      batchType: b.batch_type,
      created: b.created,
      due: b.due
    }));
  return {
    id: r.id,
    type: r.type,
    species: r.species,
    strain: r.strain,
    strainId: r.strain_id || null,
    strainName,
    strainKuerzel,
    strainText: r.strain_text || '',
    parentId: r.parent_id,
    parent: parent || null,
    source: r.source,
    status: r.status,
    notes: r.notes,
    created: r.created,
    children,
    batches
  };
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
  // I-15: bump SEQUENCE on any meaningful update (RFC 5545 §3.8.7.4) so
  // CalDAV clients see the change. Skip pure caldavSynced bookkeeping
  // updates so we don't spuriously invalidate cached calendar entries.
  const meaningful = entries.some(([k]) => k !== 'caldavSynced' && k !== 'caldavUid');
  const sets = entries.map(([k]) => `${map[k]}=?`).join(',') + (meaningful ? ', sequence=sequence+1' : '');
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
  const assignees = String(r.assignee)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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
  const bagRows = db.prepare('SELECT bag_id, bag_kg FROM bags WHERE batch_id = ? ORDER BY bag_id').all(batchId);
  return mapBatchRow(r, bagRows, db);
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

/** List all assets ordered by asset_id */
function listAssets(db) {
  return db
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

// -- Print Bridge Config --
function getPrintBridgeCfg(db) {
  const row = db.prepare('SELECT * FROM print_bridge_config WHERE id = 1').get();
  return {
    enabled: row && row.enabled === 1,
    url: (row && row.url) || '',
    token: (row && row.token) || ''
  };
}

function updatePrintBridgeCfg(db, cfg) {
  db.prepare(`UPDATE print_bridge_config SET enabled=?, url=?, token=? WHERE id=1`).run(
    cfg.enabled ? 1 : 0,
    cfg.url || '',
    cfg.token || ''
  );
  incrementDataVersion(db);
}

// -- Inventory Delta --
const VALID_MATS = ['hardwood', 'wheatbran', 'gypsum', 'grain'];

// Apply a single inventory delta inside an existing transaction. Caller is
// responsible for BEGIN/COMMIT. Returns the new running total for the material.
// I-22: optional `userId` is recorded so the inventory_log shows who acted.
function applyInventoryDeltaNoTxn(db, mat, deltaKg, type, ref, userId) {
  if (!VALID_MATS.includes(mat)) throw new Error('invalid material: ' + mat);
  const col = 'stock_' + mat;
  // Clamp negative deltas against current stock so the inventory_log "running" total
  // matches the sum of recorded deltas. Without this, requesting -200 against a stock
  // of 100 would record a -200 delta but only mutate stock by -100, breaking ledger
  // reconciliation. The MAX(0, ...) SQL guard is therefore unnecessary.
  const cur = db.prepare(`SELECT ${col} as val FROM inventory WHERE id=1`).get().val;
  const recorded = deltaKg < 0 ? Math.max(deltaKg, -cur) : deltaKg;
  db.prepare(`UPDATE inventory SET ${col} = ${col} + ? WHERE id=1`).run(recorded);
  const row = db.prepare(`SELECT ${col} as val FROM inventory WHERE id=1`).get();
  db.prepare('INSERT INTO inventory_log(time,mat,delta_kg,running,type,ref,user_id) VALUES(?,?,?,?,?,?,?)').run(
    new Date().toISOString(),
    mat,
    recorded,
    row.val,
    type || null,
    ref || null,
    userId || null
  );
  return row.val;
}

function applyInventoryDelta(db, mat, deltaKg, type, ref, userId) {
  db.exec('BEGIN');
  try {
    const newVal = applyInventoryDeltaNoTxn(db, mat, deltaKg, type, ref, userId);
    incrementDataVersion(db);
    db.exec('COMMIT');
    return newVal;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function setInventoryAbsolute(db, mat, value, type, ref, userId) {
  if (!VALID_MATS.includes(mat)) throw new Error('invalid material: ' + mat);
  const col = 'stock_' + mat;
  db.exec('BEGIN');
  try {
    const old = db.prepare(`SELECT ${col} as val FROM inventory WHERE id=1`).get().val;
    const delta = value - old;
    db.prepare(`UPDATE inventory SET ${col}=? WHERE id=1`).run(value);
    db.prepare('INSERT INTO inventory_log(time,mat,delta_kg,running,type,ref,user_id) VALUES(?,?,?,?,?,?,?)').run(
      new Date().toISOString(),
      mat,
      delta,
      value,
      type || null,
      ref || null,
      userId || null
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
    `UPDATE inventory SET thresh_hardwood=?,thresh_wheatbran=?,thresh_gypsum=?,thresh_grain=?,avg_hw_pct=?,avg_wb_pct=?,avg_rh_pct=?,avg_bag_kg=?,avg_grain_bag_kg=?,avg_grain_rh_pct=? WHERE id=1`
  ).run(
    (t.hardwood && t.hardwood.minKg) ?? 50,
    (t.wheatbran && t.wheatbran.minKg) ?? 20,
    (t.gypsum && t.gypsum.minKg) ?? 5,
    (t.grain && t.grain.minKg) ?? 10,
    a.hwPct ?? 75,
    a.wbPct ?? 25,
    a.rhPct ?? 63,
    a.bagKg ?? 3,
    a.grainBagKg ?? 1,
    a.grainRhPct ?? 52
  );
  incrementDataVersion(db);
}

function updateLabThresholds(db, labThresholds) {
  const lt = labThresholds || {};
  db.prepare(
    `UPDATE inventory SET lab_thresh_mc=?, lab_thresh_pd=?, lab_thresh_lc=?, lab_thresh_g2g=?, lab_thresh_gs=? WHERE id=1`
  ).run(lt.MC ?? 0, lt.PD ?? 0, lt.LC ?? 0, lt.G2G ?? 0, lt.GS ?? 0);
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
    db.prepare('UPDATE suppliers SET mat=?,name=?,url=?,phone=?,notes=? WHERE id=?').run(
      s.mat,
      s.name,
      s.url || null,
      s.phone || null,
      s.notes || null,
      s.id
    );
    incrementDataVersion(db);
    return s.id;
  }
  const info = db
    .prepare('INSERT INTO suppliers(mat,name,url,phone,notes) VALUES(?,?,?,?,?)')
    .run(s.mat, s.name, s.url || null, s.phone || null, s.notes || null);
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
  try {
    return JSON.stringify(Array.isArray(v) ? v : []);
  } catch {
    return null;
  }
}
function parseTeamAssignees(v) {
  if (!v) return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function serializeExceptionDates(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v || null;
  if (!Array.isArray(v)) return null;
  const clean = [...new Set(v.map((d) => String(d || '').trim()).filter(Boolean))];
  return clean.length ? clean.join(',') : null;
}
function parseExceptionDates(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
}

function insertCalendarEvent(db, ev, assigneeIds) {
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO calendar_events(id, title, description, start_date, end_date, all_day,
      start_time, end_time, category, color, caldav_uid, caldav_synced, created,
      recurrence, recurrence_until, team_assignees, exception_dates)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
      serializeTeamAssignees(ev.teamAssignees),
      serializeExceptionDates(ev.exceptionDates)
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
    'team_assignees',
    'exception_dates'
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
    teamAssignees: 'team_assignees',
    exceptionDates: 'exception_dates'
  };
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = map[k] || k;
    if (!allowed.includes(col)) continue;
    sets.push(col + '=?');
    if (col === 'all_day') vals.push(v ? 1 : 0);
    else if (col === 'team_assignees') vals.push(serializeTeamAssignees(v));
    else if (col === 'exception_dates') vals.push(serializeExceptionDates(v));
    else vals.push(v ?? null);
  }
  if (!sets.length) return;
  // I-15: bump SEQUENCE on any meaningful update so CalDAV clients see the
  // change. Skip pure caldav_synced / caldav_uid bookkeeping fields.
  const meaningful = sets.some((s) => !s.startsWith('caldav_synced') && !s.startsWith('caldav_uid'));
  const sql =
    'UPDATE calendar_events SET ' + sets.join(',') + (meaningful ? ', sequence=sequence+1' : '') + ' WHERE id=?';
  vals.push(id);
  db.prepare(sql).run(...vals);
  incrementDataVersion(db);
}

function addCalendarEventException(db, id, dateStr) {
  const row = db.prepare('SELECT exception_dates FROM calendar_events WHERE id=?').get(id);
  if (!row) return false;
  const current = parseExceptionDates(row.exception_dates);
  if (current.includes(dateStr)) return true;
  current.push(dateStr);
  // I-15: adding an EXDATE is a calendar-visible change; bump SEQUENCE.
  db.prepare('UPDATE calendar_events SET exception_dates=?, sequence=sequence+1 WHERE id=?').run(
    serializeExceptionDates(current),
    id
  );
  incrementDataVersion(db);
  return true;
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
    teamAssignees: parseTeamAssignees(r.team_assignees),
    exceptionDates: parseExceptionDates(r.exception_dates)
  };
}

function setCalendarEventAssignees(db, eventId, userIds) {
  db.prepare('DELETE FROM calendar_event_assignees WHERE event_id=?').run(eventId);
  const ins = db.prepare('INSERT INTO calendar_event_assignees(event_id, user_id) VALUES(?, ?)');
  for (const uid of userIds) ins.run(eventId, uid);
  incrementDataVersion(db);
}

function getCalendarEventAssignees(db, eventId) {
  return db
    .prepare('SELECT user_id FROM calendar_event_assignees WHERE event_id = ?')
    .all(eventId)
    .map((r) => r.user_id);
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
    if ((r.action === 'ADD' || r.action === 'MOVE' || r.action === 'MOVE_BATCH') && allLocs.includes(r.to))
      bags.add(r.bag);
    if ((r.action === 'MOVE' || r.action === 'MOVE_BATCH' || r.action === 'REMOVE') && allLocs.includes(r.from))
      bags.delete(r.bag);
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
  const existing = new Set(
    db
      .prepare('SELECT id FROM zones')
      .all()
      .map((r) => r.id)
  );
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
    if ((r.action === 'MOVE' || r.action === 'MOVE_BATCH' || r.action === 'REMOVE') && r.from === rackId)
      bags.delete(r.bag);
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
  return {
    enabled: row.enabled === 1,
    hasToken: !!row.api_token && !row.revoked_at,
    createdAt: row.created_at || null,
    lastUsedAt: row.last_used_at || null,
    revokedAt: row.revoked_at || null
  };
}
// Audit S-08: getMcpToken is called from two places — token verification
// (server.js checkMcpAuth) and admin diagnostics. The verification path
// passes touchLastUsed=true so we can record audit timestamps; the admin
// path defaults to false so just opening the settings page doesn't bump
// "last used" and mask actual abuse.
function getMcpToken(db, opts) {
  const row = db.prepare('SELECT api_token, revoked_at FROM mcp_config WHERE id=1').get();
  if (!row || !row.api_token) return '';
  if (row.revoked_at) return '';
  if (opts && opts.touchLastUsed) {
    db.prepare('UPDATE mcp_config SET last_used_at=? WHERE id=1').run(new Date().toISOString());
  }
  return row.api_token;
}
function updateMcpCfg(db, cfg) {
  db.prepare('UPDATE mcp_config SET enabled=? WHERE id=1').run(cfg.enabled ? 1 : 0);
  incrementDataVersion(db);
}
function generateMcpToken(db) {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  // Reset audit columns on rotation: created_at = now, last_used_at and
  // revoked_at cleared so the new token starts fresh.
  db.prepare('UPDATE mcp_config SET api_token=?, created_at=?, last_used_at=NULL, revoked_at=NULL WHERE id=1').run(
    hash,
    new Date().toISOString()
  );
  incrementDataVersion(db);
  return token; // plaintext returned once to show to user; only hash is stored
}
function revokeMcpToken(db) {
  // Soft revoke: keep the hash so audit history remains visible, but mark
  // the token revoked so verification short-circuits to "no token".
  db.prepare('UPDATE mcp_config SET revoked_at=? WHERE id=1').run(new Date().toISOString());
  incrementDataVersion(db);
}

// ── OAuth 2.0 ───────────────────────────────────────────────
function registerOAuthClient(db, { clientId, clientName, redirectUris }) {
  const existing = db.prepare('SELECT client_id FROM oauth_clients WHERE client_id = ?').get(clientId);
  if (existing) {
    db.prepare('UPDATE oauth_clients SET client_name = ?, redirect_uris = ? WHERE client_id = ?').run(
      clientName || '',
      JSON.stringify(redirectUris),
      clientId
    );
  } else {
    db.prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created) VALUES (?, ?, ?, ?)').run(
      clientId,
      clientName || '',
      JSON.stringify(redirectUris),
      new Date().toISOString()
    );
  }
  return db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId);
}

function getOAuthClient(db, clientId) {
  const row = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId);
  if (!row) return null;
  if (row.revoked === 1) return null;
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: JSON.parse(row.redirect_uris || '[]'),
    created: row.created,
    hasSecret: !!row.client_secret_hash,
    secretHash: row.client_secret_hash
  };
}

function createOAuthCode(db, { code, clientId, userId, redirectUri, codeChallenge, codeChallengeMethod, resource }) {
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
  try {
    db.prepare(
      'INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, expires, resource) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(code, clientId, userId, redirectUri, codeChallenge, codeChallengeMethod || 'S256', expires, resource || '');
  } catch (e) {
    // Fallback if resource column doesn't exist yet (migration v15 not run)
    if (e.message && e.message.includes('resource')) {
      db.prepare(
        'INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, expires) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(code, clientId, userId, redirectUri, codeChallenge, codeChallengeMethod || 'S256', expires);
    } else {
      throw e;
    }
  }
}

function getOAuthCode(db, code) {
  const row = db
    .prepare("SELECT * FROM oauth_codes WHERE code = ? AND used = 0 AND expires > datetime('now')")
    .get(code);
  if (!row) return null;
  return {
    code: row.code,
    clientId: row.client_id,
    userId: row.user_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    expires: row.expires,
    resource: row.resource || ''
  };
}

function markOAuthCodeUsed(db, code) {
  db.prepare('UPDATE oauth_codes SET used = 1 WHERE code = ?').run(code);
}

function createOAuthToken(db, { token, tokenType, clientId, userId, expiresInSeconds, refreshTokenRef }) {
  const expires = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  db.prepare(
    'INSERT INTO oauth_tokens (token, token_type, client_id, user_id, expires, created, refresh_token_ref) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(token, tokenType, clientId, userId, expires, new Date().toISOString(), refreshTokenRef || null);
}

function getOAuthAccessToken(db, tokenHash) {
  const row = db
    .prepare(
      "SELECT * FROM oauth_tokens WHERE token = ? AND token_type = 'access' AND revoked = 0 AND expires > datetime('now')"
    )
    .get(tokenHash);
  if (!row) return null;
  return { token: row.token, clientId: row.client_id, userId: row.user_id, expires: row.expires };
}

function getOAuthRefreshToken(db, tokenHash) {
  const row = db
    .prepare(
      "SELECT * FROM oauth_tokens WHERE token = ? AND token_type = 'refresh' AND revoked = 0 AND expires > datetime('now')"
    )
    .get(tokenHash);
  if (!row) return null;
  return { token: row.token, clientId: row.client_id, userId: row.user_id, expires: row.expires };
}

function revokeOAuthTokensByRefresh(db, refreshHash) {
  db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE refresh_token_ref = ? OR token = ?').run(
    refreshHash,
    refreshHash
  );
}

function deleteExpiredOAuthData(db) {
  db.prepare("DELETE FROM oauth_codes WHERE expires < datetime('now') OR used = 1").run();
  db.prepare("DELETE FROM oauth_tokens WHERE expires < datetime('now') OR revoked = 1").run();
}

function listOAuthClients(db) {
  const rows = db
    .prepare(
      `SELECT c.client_id, c.client_name, c.redirect_uris, c.client_secret_hash, c.created,
    (SELECT COUNT(*) FROM oauth_tokens t WHERE t.client_id = c.client_id AND t.token_type = 'access' AND t.revoked = 0 AND t.expires > datetime('now')) as active_sessions
    FROM oauth_clients c WHERE c.revoked = 0 ORDER BY c.created DESC`
    )
    .all();
  return rows.map((r) => ({
    clientId: r.client_id,
    clientName: r.client_name,
    redirectUris: JSON.parse(r.redirect_uris || '[]'),
    created: r.created,
    activeSessions: r.active_sessions,
    autoRegistered: !r.client_secret_hash
  }));
}

function deleteOAuthClient(db, clientId) {
  db.prepare('DELETE FROM oauth_tokens WHERE client_id = ?').run(clientId);
  db.prepare('DELETE FROM oauth_codes WHERE client_id = ?').run(clientId);
  const result = db.prepare('DELETE FROM oauth_clients WHERE client_id = ?').run(clientId);
  return result.changes;
}

function verifyOAuthClientSecret(db, clientId, secret) {
  const row = db
    .prepare('SELECT client_secret_hash FROM oauth_clients WHERE client_id = ? AND revoked = 0')
    .get(clientId);
  if (!row || !row.client_secret_hash) return false;
  const hash = crypto.createHash('sha256').update(secret).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(row.client_secret_hash));
}

// ── Mushroom Strains CRUD ────────────────────────────────────
function listMushroomStrains(db) {
  return db
    .prepare('SELECT * FROM mushroom_strains ORDER BY name')
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      kuerzel: r.kuerzel,
      description: r.description || '',
      created: r.created,
      updated: r.updated || null
    }));
}

function createMushroomStrain(db, { name, kuerzel, description }) {
  if (!name || !name.trim()) throw new Error('Name ist Pflichtfeld');
  if (!kuerzel || !kuerzel.trim()) throw new Error('Kürzel ist Pflichtfeld');
  const now = new Date().toISOString();
  try {
    const result = db
      .prepare('INSERT INTO mushroom_strains(name,kuerzel,description,created) VALUES(?,?,?,?)')
      .run(name.trim(), kuerzel.trim(), description || '', now);
    incrementDataVersion(db);
    return result.lastInsertRowid;
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
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
// `bagRows` is an array of {bag_id, bag_kg} for THIS batch — caller fetches
// however they want (single .all() for one batch, pre-built bagsByBatch map
// for bulk callers). `msById` is an optional Map<id, {name,kuerzel}> so bulk
// callers can avoid the per-batch SELECT against mushroom_strains.
function mapBatchRow(r, bagRows, db, msById) {
  let strainName = null,
    strainKuerzel = null;
  if (r.strain_id) {
    let ms = msById ? msById.get(r.strain_id) : null;
    if (!ms && db) {
      ms = db.prepare('SELECT name, kuerzel FROM mushroom_strains WHERE id=?').get(r.strain_id);
    }
    if (ms) {
      strainName = ms.name;
      strainKuerzel = ms.kuerzel;
    }
  }
  const bagWeights = {};
  for (const b of bagRows) bagWeights[b.bag_id] = b.bag_kg != null ? b.bag_kg : r.bag_kg || 3;
  return {
    batchId: r.batch_id,
    species: r.species,
    strain: r.strain,
    strainId: r.strain_id || null,
    strainName,
    strainKuerzel,
    qty: r.qty,
    days: r.days,
    substrate: { hardwood: r.sub_hardwood, wheatbran: r.sub_wheatbran, rh: r.sub_rh, gypsum: r.sub_gypsum === 1 },
    bagKg: r.bag_kg,
    batchType: r.batch_type,
    grainRh: r.grain_rh || 0,
    sourceId: r.source_id,
    notes: r.notes,
    strainText: r.strain_text || '',
    created: r.created,
    due: r.due,
    bags: bagRows.map((b) => b.bag_id),
    bagWeights
  };
}
function getAllBatches(db) {
  // Bulk-load bags in ONE query and group by batch_id, instead of running
  // bagStmt.all() once per batch (the audit-flagged N+1 — at 200 batches that
  // was 200 prepared statement executions just for bag info).
  const bagsByBatch = new Map();
  for (const b of db.prepare('SELECT batch_id, bag_id, bag_kg FROM bags ORDER BY batch_id, bag_id').all()) {
    let arr = bagsByBatch.get(b.batch_id);
    if (!arr) {
      arr = [];
      bagsByBatch.set(b.batch_id, arr);
    }
    arr.push(b);
  }
  // Same for mushroom_strains — used to be a per-batch SELECT inside
  // mapBatchRow; one bulk query is faster and avoids N re-prepares.
  const msById = new Map(
    db
      .prepare('SELECT id, name, kuerzel FROM mushroom_strains')
      .all()
      .map((m) => [m.id, m])
  );
  return db
    .prepare('SELECT * FROM batches ORDER BY created')
    .all()
    .map((r) => mapBatchRow(r, bagsByBatch.get(r.batch_id) || [], db, msById));
}
function getAllTasks(db) {
  return db
    .prepare('SELECT * FROM manual_tasks ORDER BY id')
    .all()
    .map((r) => ({
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
      recurrence: r.recurrence || null,
      recurrenceUntil: r.recurrence_until || null,
      caldavUid: r.caldav_uid || null,
      sequence: r.sequence || 0
    }));
}
function getAllHarvests(db) {
  return db
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
      flush: r.flush,
      quality: r.quality || null,
      notes: r.notes || null
    }));
}
function getAllCultures(db) {
  const msStmt = db.prepare('SELECT name, kuerzel FROM mushroom_strains WHERE id=?');
  return db
    .prepare('SELECT * FROM cultures ORDER BY created')
    .all()
    .map((r) => {
      let strainName = null,
        strainKuerzel = null;
      if (r.strain_id) {
        const ms = msStmt.get(r.strain_id);
        if (ms) {
          strainName = ms.name;
          strainKuerzel = ms.kuerzel;
        }
      }
      return {
        id: r.id,
        type: r.type,
        species: r.species,
        strain: r.strain,
        strainId: r.strain_id || null,
        strainName,
        strainKuerzel,
        strainText: r.strain_text || '',
        parentId: r.parent_id,
        source: r.source,
        status: r.status,
        notes: r.notes,
        created: r.created
      };
    });
}
function getScanLog(db) {
  return db
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
      reason: r.reason || null
    }));
}
function getCalendarEvents(db) {
  const assigneeMap = getAllCalendarEventAssignees(db);
  return db
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
      caldavUid: r.caldav_uid || null,
      recurrence: r.recurrence || null,
      recurrenceUntil: r.recurrence_until || null,
      teamAssignees: parseTeamAssignees(r.team_assignees),
      exceptionDates: parseExceptionDates(r.exception_dates),
      assignees: assigneeMap.get(r.id) || [],
      sequence: r.sequence || 0
    }));
}
function getInventory(db, logLimit) {
  const inv = db.prepare('SELECT * FROM inventory WHERE id = 1').get();
  const logRows = logLimit
    ? db.prepare('SELECT * FROM inventory_log ORDER BY id DESC LIMIT ?').all(logLimit).reverse()
    : db.prepare('SELECT * FROM inventory_log ORDER BY id').all();
  return {
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
      grainBagKg: inv.avg_grain_bag_kg,
      grainRhPct: inv.avg_grain_rh_pct != null ? inv.avg_grain_rh_pct : 52
    },
    labThresholds: {
      MC: inv.lab_thresh_mc || 0,
      PD: inv.lab_thresh_pd || 0,
      LC: inv.lab_thresh_lc || 0,
      G2G: inv.lab_thresh_g2g || 0,
      GS: inv.lab_thresh_gs || 0
    },
    log: logRows.map((r) => ({
      time: r.time,
      mat: r.mat,
      deltaKg: r.delta_kg,
      running: r.running,
      type: r.type,
      ref: r.ref,
      // I-22: surface acting user for audit views.
      user_id: r.user_id != null ? r.user_id : null
    }))
  };
}
function getZonesWithRacks(db) {
  const rackStmt = db.prepare(
    'SELECT id, zone_id, sort_order, created FROM racks WHERE zone_id = ? ORDER BY sort_order, id'
  );
  return db
    .prepare('SELECT * FROM zones ORDER BY sort_order, id')
    .all()
    .map((z) => ({
      id: z.id,
      name: z.name,
      role: z.role,
      color: z.color,
      sortOrder: z.sort_order,
      maxCapacity: z.max_capacity || null,
      created: z.created,
      racks: rackStmt.all(z.id).map((r) => ({ id: r.id, sortOrder: r.sort_order, created: r.created }))
    }));
}

// ── Daily KPI Snapshot ──────────────────────────────────────
function snapshotDailyKPIs(db, { force } = {}) {
  // I-09: bucket events by lab-local day. The DB stores ISO timestamps in UTC,
  // so we need the UTC range that corresponds to local midnight..23:59:59.999.
  // `new Date('YYYY-MM-DDTHH:MM:SS')` (no Z) parses as local time; `.toISOString()`
  // converts back to UTC.
  const today = localDayString(); // YYYY-MM-DD in lab-local time

  // Skip if already snapshotted today (unless force=true for manual retake)
  const existing = db.prepare('SELECT date FROM kpi_snapshots WHERE date = ?').get(today);
  if (existing && !force) return { skipped: true, date: today };
  if (existing && force) db.prepare('DELETE FROM kpi_snapshots WHERE date = ?').run(today);

  const dayStart = new Date(today + 'T00:00:00').toISOString();
  const dayEnd = new Date(today + 'T23:59:59.999').toISOString();

  // 1. Bags created today
  const bagsCreated = db
    .prepare('SELECT COALESCE(SUM(qty), 0) AS v FROM batches WHERE created >= ? AND created <= ?')
    .get(dayStart, dayEnd).v;

  // 2-4. Materials used today (from inventory_log, type='batch')
  const matRows = db
    .prepare(
      "SELECT mat, COALESCE(SUM(ABS(delta_kg)), 0) AS v FROM inventory_log WHERE type = 'batch' AND time >= ? AND time <= ? GROUP BY mat"
    )
    .all(dayStart, dayEnd);
  const matUsed = {};
  matRows.forEach((r) => {
    matUsed[r.mat] = r.v;
  });

  // 5. Harvest today (kg)
  const harvestKg =
    db.prepare('SELECT COALESCE(SUM(grams), 0) AS v FROM harvests WHERE time >= ? AND time <= ?').get(dayStart, dayEnd)
      .v / 1000;

  // 6. Avg yield per bag (all-time) — total grams / unique bags harvested
  const yieldData = db
    .prepare('SELECT COALESCE(SUM(grams), 0) AS totalG, COUNT(DISTINCT bag) AS uniqueBags FROM harvests')
    .get();
  const avgYield = yieldData.uniqueBags > 0 ? Math.round(yieldData.totalG / yieldData.uniqueBags) : 0;

  // 7. Contamination rate (all-time) — contaminated bags / all bags placed
  const zones = db.prepare('SELECT id, role FROM zones').all();
  const contamZoneIds = zones.filter((z) => z.role === 'contaminated').map((z) => z.id);
  const allBagsPlaced = db
    .prepare("SELECT COUNT(DISTINCT bag) AS v FROM scan_log WHERE action = 'ADD' AND bag IS NOT NULL")
    .get().v;

  let contamBags = 0;
  if (contamZoneIds.length > 0) {
    // I-13: only count contaminated bags that were also ADDed to inventory.
    // Otherwise a MOVE-only bag (e.g. one that moved to CONTAM via the
    // contamination flow without ever having an explicit ADD) inflates the
    // numerator while the denominator counts ADDs only — which previously
    // made `contam_rate_pct` exceed 100%.
    const contamRows = db
      .prepare(
        `SELECT DISTINCT bag FROM scan_log WHERE bag IS NOT NULL AND (` +
          contamZoneIds.map(() => `"to" = ? OR "to" LIKE ? || ':%'`).join(' OR ') +
          `) AND bag IN (SELECT DISTINCT bag FROM scan_log WHERE action = 'ADD' AND bag IS NOT NULL)`
      )
      .all(...contamZoneIds.flatMap((id) => [id, id]));
    contamBags = contamRows.length;
  }
  const contamRate = allBagsPlaced > 0 ? +((contamBags / allBagsPlaced) * 100).toFixed(1) : 0;

  // 8. Days since last contamination
  let daysSinceContam = null;
  if (contamZoneIds.length > 0) {
    const lastContamCondition = contamZoneIds.map(() => `"to" = ? OR "to" LIKE ? || ':%'`).join(' OR ');
    const lastContam = db
      .prepare(`SELECT MAX(time) AS t FROM scan_log WHERE bag IS NOT NULL AND (${lastContamCondition})`)
      .get(...contamZoneIds.flatMap((id) => [id, id]));
    if (lastContam && lastContam.t) {
      daysSinceContam = Math.floor((Date.now() - new Date(lastContam.t).getTime()) / 864e5);
    }
  }

  // 9. Flush 2+ bags
  const flush2Plus = db
    .prepare('SELECT COUNT(*) AS v FROM (SELECT bag, MAX(flush) AS mf FROM harvests GROUP BY bag HAVING mf >= 2)')
    .get().v;

  // 10. Pipeline counts — compute current bag locations from scan_log.
  // I-14: REMOVE always wipes the bag, regardless of `from`. Previously this
  // was guarded by `bagZone[e.bag] === fromZone`, which meant a stale REMOVE
  // (replayed offline after the bag had been moved by another user) would
  // leave the bag tracked at its NEW zone — diverging from
  // getProductionPipeline (which deletes unconditionally) and from the
  // client's getStatus (rewritten in I-10 to derive from last-event-per-bag).
  // P-06: bag-zone state is maintained in-memory by appendScanEntries; we
  // just read the cached map here instead of re-scanning scan_log.
  const zoneRoleMap = {};
  zones.forEach((z) => {
    zoneRoleMap[z.id] = z.role;
  });
  const bagZoneMap = getBagZoneMap(db);
  const roleCounts = { spawn: 0, incubation: 0, fruiting: 0, contaminated: 0 };
  for (const zId of bagZoneMap.values()) {
    const role = zoneRoleMap[zId];
    if (role && roleCounts[role] !== undefined) roleCounts[role]++;
  }

  // 11. Total batches & current stock
  const totalBatches = db.prepare('SELECT COUNT(*) AS v FROM batches').get().v;
  const inv = db.prepare('SELECT stock_hardwood, stock_wheatbran, stock_grain FROM inventory WHERE id = 1').get();

  // Insert snapshot
  db.prepare(
    `INSERT INTO kpi_snapshots (
    date, bags_created, grain_used_kg, harvest_kg, hardwood_used_kg, wheatbran_used_kg,
    avg_yield_g, contam_rate_pct, contam_bags, total_bags_placed, days_since_contam,
    flush_2plus, bags_spawn, bags_incubation, bags_fruiting, bags_contaminated,
    total_batches, stock_hardwood_kg, stock_wheatbran_kg, stock_grain_kg
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    today,
    bagsCreated,
    matUsed.grain || 0,
    harvestKg,
    matUsed.hardwood || 0,
    matUsed.wheatbran || 0,
    avgYield,
    contamRate,
    contamBags,
    allBagsPlaced,
    daysSinceContam,
    flush2Plus,
    roleCounts.spawn,
    roleCounts.incubation,
    roleCounts.fruiting,
    roleCounts.contaminated,
    totalBatches,
    inv ? inv.stock_hardwood : 0,
    inv ? inv.stock_wheatbran : 0,
    inv ? inv.stock_grain : 0
  );

  return { saved: true, date: today };
}

function getKpiSnapshots(db, limit) {
  if (limit) {
    return db.prepare('SELECT * FROM kpi_snapshots ORDER BY date DESC LIMIT ?').all(limit).reverse();
  }
  return db.prepare('SELECT * FROM kpi_snapshots ORDER BY date').all();
}

// ── Contamination Report ─────────────────────────────────
/** Get contamination stats grouped by species, zone, or month */
function getContaminationReport(db, groupBy, startDate, endDate) {
  const zones = db.prepare('SELECT id, role FROM zones').all();
  const contamZoneIds = zones.filter((z) => z.role === 'contaminated').map((z) => z.id);
  if (contamZoneIds.length === 0) return { groupBy, groups: {}, totalContam: 0 };

  let rows = db
    .prepare("SELECT * FROM scan_log WHERE action IN ('MOVE','REMOVE') AND reason IS NOT NULL ORDER BY id")
    .all();
  if (startDate) rows = rows.filter((r) => r.time && r.time.slice(0, 10) >= startDate);
  if (endDate) rows = rows.filter((r) => r.time && r.time.slice(0, 10) <= endDate);

  const groups = {};
  for (const r of rows) {
    let key;
    if (groupBy === 'species') key = r.species || 'unknown';
    else if (groupBy === 'zone') key = r.from || 'unknown';
    else key = r.time ? r.time.slice(0, 7) : 'unknown'; // month
    if (!groups[key]) groups[key] = { count: 0, reasons: {} };
    groups[key].count++;
    const reason = r.reason || 'unspecified';
    groups[key].reasons[reason] = (groups[key].reasons[reason] || 0) + 1;
  }

  return { groupBy: groupBy || 'month', groups, totalContam: rows.length };
}

// ── Recipes ──────────────────────────────────────────────
/** Insert a new substrate recipe */
function insertRecipe(db, r) {
  const res = db
    .prepare(
      'INSERT INTO recipes(name, hardwood_pct, wheatbran_pct, gypsum_pct, rh_pct, notes, created) VALUES(?,?,?,?,?,?,?)'
    )
    .run(
      r.name,
      r.hardwood_pct || 0,
      r.wheatbran_pct || 0,
      r.gypsum_pct || 0,
      r.rh_pct || 0,
      r.notes || null,
      r.created || new Date().toISOString()
    );
  incrementDataVersion(db);
  return res.lastInsertRowid;
}

/** Update an existing recipe */
function updateRecipe(db, id, fields) {
  const allowed = ['name', 'hardwood_pct', 'wheatbran_pct', 'gypsum_pct', 'rh_pct', 'notes'];
  const colMap = {
    name: 'name',
    hardwood_pct: 'hardwood_pct',
    wheatbran_pct: 'wheatbran_pct',
    gypsum_pct: 'gypsum_pct',
    rh_pct: 'rh_pct',
    notes: 'notes'
  };
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k) && v !== undefined) {
      sets.push(`${colMap[k]}=?`);
      vals.push(v);
    }
  }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE recipes SET ${sets.join(',')} WHERE id=?`).run(...vals);
  incrementDataVersion(db);
}

/** Delete a recipe by id */
function deleteRecipe(db, id) {
  const info = db.prepare('DELETE FROM recipes WHERE id=?').run(id);
  if (info.changes) incrementDataVersion(db);
  return info.changes > 0;
}

/** Get all recipes */
function getAllRecipes(db) {
  return db
    .prepare('SELECT * FROM recipes ORDER BY name')
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      hardwoodPct: r.hardwood_pct,
      wheatbranPct: r.wheatbran_pct,
      gypsumPct: r.gypsum_pct,
      rhPct: r.rh_pct,
      notes: r.notes,
      created: r.created
    }));
}

/** Get a single recipe by id */
function getRecipeById(db, id) {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(id);
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    hardwoodPct: r.hardwood_pct,
    wheatbranPct: r.wheatbran_pct,
    gypsumPct: r.gypsum_pct,
    rhPct: r.rh_pct,
    notes: r.notes,
    created: r.created
  };
}

// ── Traceability ─────────────────────────────────────────
/** Trace lineage backwards from a batch or culture to its origin */
function traceLineageBack(db, entityType, entityId) {
  const chain = [];
  if (entityType === 'batch') {
    const batch = db.prepare('SELECT * FROM batches WHERE batch_id=?').get(entityId);
    if (!batch) return chain;
    chain.push({
      type: 'batch',
      id: batch.batch_id,
      species: batch.species,
      strain: batch.strain,
      created: batch.created
    });
    if (batch.source_id) {
      const cultureChain = traceLineageBack(db, 'culture', batch.source_id);
      chain.push(...cultureChain);
    }
  } else if (entityType === 'culture') {
    let current = db.prepare('SELECT * FROM cultures WHERE id=?').get(entityId);
    // Guard against parent-pointer cycles. Self-cycles are rejected at insert/update,
    // but legacy data or future edits could still produce a loop — break on revisit.
    const visited = new Set();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.push({
        type: 'culture',
        id: current.id,
        cultureType: current.type,
        species: current.species,
        strain: current.strain,
        status: current.status,
        created: current.created
      });
      current = current.parent_id ? db.prepare('SELECT * FROM cultures WHERE id=?').get(current.parent_id) : null;
    }
  }
  return chain;
}

/** Trace lineage forward from a culture to all batches/harvests it produced */
function traceLineageForward(db, cultureId) {
  const result = { cultures: [], batches: [], harvests: [] };
  const visited = new Set();
  const queue = [cultureId];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const c = db.prepare('SELECT * FROM cultures WHERE id=?').get(id);
    if (c) {
      result.cultures.push({
        id: c.id,
        type: c.type,
        species: c.species,
        strain: c.strain,
        status: c.status,
        created: c.created
      });
      // Find child cultures
      const children = db.prepare('SELECT id FROM cultures WHERE parent_id=?').all(id);
      for (const child of children) queue.push(child.id);
      // Find batches sourced from this culture
      const batches = db.prepare('SELECT batch_id FROM batches WHERE source_id=?').all(id);
      for (const b of batches) {
        const batch = db.prepare('SELECT * FROM batches WHERE batch_id=?').get(b.batch_id);
        if (batch) {
          result.batches.push({
            batchId: batch.batch_id,
            species: batch.species,
            strain: batch.strain,
            batchType: batch.batch_type,
            created: batch.created,
            due: batch.due
          });
          const harvests = db.prepare('SELECT * FROM harvests WHERE batch=?').all(batch.batch_id);
          for (const h of harvests) {
            result.harvests.push({
              id: h.id,
              batch: h.batch,
              bag: h.bag,
              grams: h.grams,
              flush: h.flush,
              time: h.time
            });
          }
        }
      }
    }
  }
  return result;
}

// ── Production Pipeline ──────────────────────────────────
/** Get aggregated production pipeline overview */
function getProductionPipeline(db) {
  // Active cultures by type and status
  const cultures = db.prepare('SELECT type, status, COUNT(*) AS cnt FROM cultures GROUP BY type, status').all();
  const cultureSummary = {};
  for (const c of cultures) {
    if (!cultureSummary[c.type]) cultureSummary[c.type] = {};
    cultureSummary[c.type][c.status] = c.cnt;
  }

  // Batches by type and phase
  const allBatches = db.prepare('SELECT batch_id, batch_type, due FROM batches').all();
  // I-09: compare against lab-local day, not UTC day. A 22:00 Berlin "due"
  // would otherwise tip into tomorrow under UTC and disappear from the ready bucket.
  const todayStr = localDayString();
  const batchSummary = {
    grain: { incubating: 0, ready: 0 },
    block: { incubating: 0, ready: 0 },
    liquid: { incubating: 0, ready: 0 }
  };
  for (const b of allBatches) {
    const type = b.batch_type || 'block';
    if (!batchSummary[type]) batchSummary[type] = { incubating: 0, ready: 0 };
    if (b.due && b.due.slice(0, 10) <= todayStr) batchSummary[type].ready++;
    else batchSummary[type].incubating++;
  }

  // Bags per zone with capacity
  // P-06: bag-zone map is maintained in memory; used to be a full scan_log SCAN.
  const zones = db.prepare('SELECT id, name, role, max_capacity FROM zones ORDER BY sort_order').all();
  const bagZoneMap = getBagZoneMap(db);
  const zoneCounts = {};
  for (const zId of bagZoneMap.values()) {
    zoneCounts[zId] = (zoneCounts[zId] || 0) + 1;
  }
  const zoneOverview = zones.map((z) => ({
    id: z.id,
    name: z.name,
    role: z.role,
    bagCount: zoneCounts[z.id] || 0,
    maxCapacity: z.max_capacity,
    capacityPct: z.max_capacity ? Math.round(((zoneCounts[z.id] || 0) / z.max_capacity) * 100) : null
  }));

  return { cultures: cultureSummary, batches: batchSummary, zones: zoneOverview };
}

// ── Maintenance Log ──────────────────────────────────────
/** Schedule a maintenance task */
function insertMaintenance(db, m) {
  const res = db
    .prepare(
      'INSERT INTO maintenance_log(asset_id, zone_id, type, description, scheduled_date, notes) VALUES(?,?,?,?,?,?)'
    )
    .run(m.assetId || null, m.zoneId || null, m.type, m.description || null, m.scheduledDate || null, m.notes || null);
  incrementDataVersion(db);
  return res.lastInsertRowid;
}

/** Mark a maintenance task as completed */
function completeMaintenance(db, id, completedBy, notes) {
  db.prepare('UPDATE maintenance_log SET completed_date=?, completed_by=?, notes=COALESCE(?,notes) WHERE id=?').run(
    new Date().toISOString(),
    completedBy || null,
    notes || null,
    id
  );
  incrementDataVersion(db);
}

/** Get due/overdue maintenance tasks (not yet completed) */
function getMaintenanceDue(db) {
  return db
    .prepare('SELECT * FROM maintenance_log WHERE completed_date IS NULL ORDER BY scheduled_date')
    .all()
    .map(mapMaintenanceRow);
}

/** Get maintenance history with optional filters */
function getMaintenanceHistory(db, assetId, zoneId, limit) {
  let sql = 'SELECT * FROM maintenance_log WHERE 1=1';
  const params = [];
  if (assetId) {
    sql += ' AND asset_id=?';
    params.push(assetId);
  }
  if (zoneId) {
    sql += ' AND zone_id=?';
    params.push(zoneId);
  }
  sql += ' ORDER BY COALESCE(completed_date, scheduled_date) DESC';
  if (limit) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  return db
    .prepare(sql)
    .all(...params)
    .map(mapMaintenanceRow);
}

function mapMaintenanceRow(r) {
  return {
    id: r.id,
    assetId: r.asset_id,
    zoneId: r.zone_id,
    type: r.type,
    description: r.description,
    scheduledDate: r.scheduled_date,
    completedDate: r.completed_date,
    completedBy: r.completed_by,
    notes: r.notes
  };
}

// ── Contamination reports (audit Section 2 MVP) ─────────────
function listContaminationTypes(db, includeInactive) {
  const where = includeInactive ? '' : ' WHERE active = 1';
  return db
    .prepare(
      `SELECT id, key, name_de, name_en, name_pt, color, sort_order, active FROM contamination_types${where} ORDER BY sort_order, name_en`
    )
    .all();
}

function createContaminationReport(db, data) {
  const stmt = db.prepare(`INSERT INTO contamination_reports
    (reported_at, user_id, bag_id, batch_id, zone_id, type_id, severity, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const r = stmt.run(
    data.reported_at || new Date().toISOString(),
    data.user_id || null,
    data.bag_id || null,
    data.batch_id || null,
    data.zone_id || null,
    data.type_id,
    data.severity || 'minor',
    data.notes || ''
  );
  return r.lastInsertRowid;
}

function addContaminationPhoto(db, reportId, photo) {
  const stmt = db.prepare(`INSERT INTO contamination_photos
    (report_id, uuid, rel_path, thumb_path, width, height, bytes, sha256, uploaded_at, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const r = stmt.run(
    reportId,
    photo.uuid,
    photo.rel_path,
    photo.thumb_path,
    photo.width || null,
    photo.height || null,
    photo.bytes,
    photo.sha256,
    photo.uploaded_at || new Date().toISOString(),
    photo.uploaded_by || null
  );
  return r.lastInsertRowid;
}

function findContaminationPhotoBySha(db, sha256) {
  return db.prepare('SELECT id, report_id, uuid, rel_path FROM contamination_photos WHERE sha256 = ?').get(sha256);
}

function listContaminationReports(db, filters) {
  filters = filters || {};
  const where = [];
  const params = [];
  if (filters.batchId) {
    where.push('cr.batch_id = ?');
    params.push(filters.batchId);
  }
  if (filters.bagId) {
    where.push('UPPER(cr.bag_id) = UPPER(?)');
    params.push(filters.bagId);
  }
  if (filters.typeId) {
    where.push('cr.type_id = ?');
    params.push(filters.typeId);
  }
  if (filters.severity) {
    where.push('cr.severity = ?');
    params.push(filters.severity);
  }
  if (filters.zoneId) {
    where.push('cr.zone_id = ?');
    params.push(filters.zoneId);
  }
  if (filters.startDate) {
    where.push('substr(cr.reported_at, 1, 10) >= ?');
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    where.push('substr(cr.reported_at, 1, 10) <= ?');
    params.push(filters.endDate);
  }
  if (filters.status === 'open') {
    where.push('cr.resolved_at IS NULL');
  } else if (filters.status === 'resolved') {
    where.push('cr.resolved_at IS NOT NULL');
  }
  // first_photo_uuid lets the browse-list render an actual thumbnail per row
  // without a second round-trip. Correlated subquery scans contamination_photos
  // by (report_id) which already has an index from migration v36.
  const sql = `
    SELECT
      cr.id, cr.reported_at, cr.user_id, cr.bag_id, cr.batch_id, cr.zone_id,
      cr.type_id, cr.severity, cr.notes, cr.resolved_at, cr.resolution,
      ct.key AS type_key, ct.color AS type_color, ct.name_en, ct.name_de, ct.name_pt,
      u.username AS reporter,
      (SELECT COUNT(*) FROM contamination_photos WHERE report_id = cr.id) AS photo_count,
      (SELECT uuid FROM contamination_photos WHERE report_id = cr.id ORDER BY id LIMIT 1) AS first_photo_uuid
    FROM contamination_reports cr
    LEFT JOIN contamination_types ct ON ct.id = cr.type_id
    LEFT JOIN users u ON u.id = cr.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY cr.reported_at DESC
    LIMIT ?
  `;
  params.push(Math.min(filters.limit || 200, 500));
  return db.prepare(sql).all(...params);
}

function getContaminationReportById(db, id) {
  const report = db
    .prepare(
      `SELECT cr.*, ct.key AS type_key, ct.color AS type_color, ct.name_en, ct.name_de, ct.name_pt, u.username AS reporter
              FROM contamination_reports cr
              LEFT JOIN contamination_types ct ON ct.id = cr.type_id
              LEFT JOIN users u ON u.id = cr.user_id
              WHERE cr.id = ?`
    )
    .get(id);
  if (!report) return null;
  report.photos = db
    .prepare(
      'SELECT id, uuid, rel_path, thumb_path, width, height, bytes, uploaded_at FROM contamination_photos WHERE report_id = ? ORDER BY id'
    )
    .all(id);
  return report;
}

function getContaminationPhotoByUuid(db, uuid) {
  return db
    .prepare('SELECT id, report_id, uuid, rel_path, thumb_path, bytes FROM contamination_photos WHERE uuid = ?')
    .get(uuid);
}

function deleteContaminationReport(db, id) {
  // Photos cascade-delete via FK; caller is responsible for unlinking files on disk.
  const photos = db.prepare('SELECT rel_path, thumb_path FROM contamination_photos WHERE report_id = ?').all(id);
  db.prepare('DELETE FROM contamination_reports WHERE id = ?').run(id);
  return photos;
}

function setContaminationReportScanLogId(db, reportId, scanLogId) {
  db.prepare('UPDATE contamination_reports SET scan_log_id = ? WHERE id = ?').run(scanLogId, reportId);
}

function resolveContaminationReport(db, id, userId, resolution) {
  const r = db
    .prepare(
      `UPDATE contamination_reports
       SET resolved_at = ?, resolved_by = ?, resolution = ?
       WHERE id = ?`
    )
    .run(new Date().toISOString(), userId || null, resolution, id);
  return r.changes > 0;
}

function unresolveContaminationReport(db, id) {
  const r = db
    .prepare(
      `UPDATE contamination_reports
       SET resolved_at = NULL, resolved_by = NULL, resolution = NULL
       WHERE id = ?`
    )
    .run(id);
  return r.changes > 0;
}

// R-23: classifier for `Error.message` strings — true if the message comes
// from a known validator and is safe to forward to the client as a 400, false
// for anything else (which should be logged + returned as a generic 500).
//
// The previous implementation was a substring regex
// (`/required|invalid|must be|not found|already|duplicate|too short|too long|cannot|constraint/i`)
// that matched SQLite messages like
// "SQLITE_CONSTRAINT: UNIQUE constraint failed: users.username" and forwarded
// the schema details to clients. The allowlist is curated from every
// `throw new Error(...)` call site in db.js + photo handling in server.js —
// anything not matching falls through to the 500 branch by design.
const SAFE_ERROR_PREFIXES = [
  // Lookups — db.js
  'Batch not found:',
  'Culture not found:',
  'Zone not found:',
  'Rack not found:',
  'batch not found:',
  // Conflicts — db.js
  'Zone already exists:',
  'Rack already exists:',
  'A batch with ID ',
  'A culture with ID ',
  'Unknown zone:',
  // Validation — db.js
  'invalid material:',
  'Invalid culture parent:',
  'Substrate composition must total',
  'Zone has ',
  'Rack has ',
  'Zone name ',
  'Cannot delete:',
  // Photo upload — server.js (every message is prefixed `photo:`)
  'photo:'
];

const SAFE_ERROR_BARE = new Set([
  'qty must be >= 1',
  'days must be >= 1',
  'grams must be >= 0',
  'order must be an array',
  'mat and name are required',
  'Pilzsorte nicht gefunden',
  'Culture parent_id must not equal its own id (self-cycle rejected)',
  'Name ist Pflichtfeld',
  'Kürzel ist Pflichtfeld',
  'Kürzel already taken'
]);

function isSafeError(msg) {
  const s = String(msg || '');
  if (!s) return false;
  if (SAFE_ERROR_BARE.has(s)) return true;
  return SAFE_ERROR_PREFIXES.some((p) => s.startsWith(p));
}

module.exports = {
  openDb,
  readAll,
  writeAll,
  backupDb,
  checkDiskSpace,
  getDataVersion,
  getBagZoneMap,
  invalidateBagZoneCache,
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
  cleanupExpiredSessions,
  cleanupOldNotifications,
  createNotification,
  listNotifications,
  countUnreadNotifications,
  markNotificationsRead,
  countUsers,
  listUsers,
  deleteUser,
  SESSION_TTL_MS,
  updateUserPassword,
  resetUserPassword,
  insertBatch,
  updateBatchField,
  renameBatch,
  renameCulture,
  addBagsToBatch,
  deleteBatchById,
  appendScanEntries,
  appendScanEntriesNoTxn,
  deleteLastScanEntries,
  getScanEntryById,
  deleteScanEntryById,
  clearScanLog,
  insertHarvest,
  insertCultures,
  updateCulture,
  getCultureById,
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
  listAssets,
  deleteAssetById,
  updateCaldavCfg,
  getDuckdnsCfg,
  updateDuckdnsCfg,
  updateDuckdnsStatus,
  getPrintBridgeCfg,
  updatePrintBridgeCfg,
  applyInventoryDelta,
  setInventoryAbsolute,
  updateInventoryConfig,
  updateLabThresholds,
  listSuppliers,
  upsertSupplier,
  deleteSupplier,
  insertCalendarEvent,
  updateCalendarEvent,
  getCalendarEventById,
  deleteCalendarEvent,
  addCalendarEventException,
  readCalendarEventByCaldavUid,
  setCalendarEventAssignees,
  getCalendarEventAssignees,
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
  revokeMcpToken,
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
  getKpiSnapshots,
  getContaminationReport,
  insertRecipe,
  updateRecipe,
  deleteRecipe,
  getAllRecipes,
  getRecipeById,
  traceLineageBack,
  traceLineageForward,
  getProductionPipeline,
  insertMaintenance,
  completeMaintenance,
  getMaintenanceDue,
  getMaintenanceHistory,
  listContaminationTypes,
  createContaminationReport,
  addContaminationPhoto,
  findContaminationPhotoBySha,
  listContaminationReports,
  getContaminationReportById,
  getContaminationPhotoByUuid,
  deleteContaminationReport,
  resolveContaminationReport,
  unresolveContaminationReport,
  setContaminationReportScanLogId,
  // R-23
  isSafeError
};
