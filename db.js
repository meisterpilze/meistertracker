'use strict';
const { DatabaseSync: Database } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

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
  strain  TEXT
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
  caldav_synced TEXT
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
  enabled              INTEGER DEFAULT 0,
  caldav_username      TEXT DEFAULT '',
  caldav_password      TEXT DEFAULT '',
  per_person_calendars INTEGER DEFAULT 0
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
`;

// ── Schema Migrations ───────────────────────────────────────
// Each migration runs exactly once, tracked by schema_version.
// To add a new migration: append an entry to MIGRATIONS array.
const MIGRATIONS = [
  // v1: baseline — all tables already created via SCHEMA DDL
  // Future migrations go here, e.g.:
  // { version: 2, description: 'Add priority column to batches', sql: 'ALTER TABLE batches ADD COLUMN priority INTEGER DEFAULT 0' },
];

function runMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied TEXT NOT NULL, description TEXT)');
  const applied = new Set(db.prepare('SELECT version FROM schema_version').all().map(r => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    try {
      db.exec('BEGIN');
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_version(version, applied, description) VALUES(?, ?, ?)').run(m.version, new Date().toISOString(), m.description || '');
      db.exec('COMMIT');
      console.log(`  Migration v${m.version} applied: ${m.description || ''}`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration v${m.version} failed: ${e.message}`);
    }
  }
}

// ── Open / Init ──────────────────────────────────────────────
function openDb(dbPath) {
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  runMigrations(db);
  // Ensure singleton rows exist
  db.prepare(`INSERT OR IGNORE INTO inventory(id) VALUES(1)`).run();
  db.prepare(`INSERT OR IGNORE INTO caldav_config(id) VALUES(1)`).run();
  return db;
}

// ── Read All (assembles the JSON shape the client expects) ───
function readAll(db) {
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

  // Scan log — include id for PATCH/DELETE targeting
  const scanLog = db.prepare('SELECT * FROM scan_log ORDER BY id').all().map(r => ({
    id: r.id,
    time: r.time,
    action: r.action,
    batch: r.batch,
    bag: r.bag,
    from: r.from,
    to: r.to,
    species: r.species,
    strain: r.strain
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
    caldavSynced: r.caldav_synced
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
  const invLog = db.prepare('SELECT * FROM inventory_log ORDER BY id').all().map(r => ({
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
    caldavUsername: cal.caldav_username,
    caldavPassword: cal.caldav_password,
    enabled: cal.enabled === 1 ? true : false,
    perPersonCalendars: cal.per_person_calendars === 1 ? true : false
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
    created: r.created
  }));

  return { batches, scanLog, manualTasks, harvests, cultures, inventory, teamMembers, caldav, assets, calendarEvents };
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
    }

    // ── CalDAV Config ──
    if (incoming.caldav) {
      const c = incoming.caldav;
      db.prepare(`
        UPDATE caldav_config SET
          enabled=?, caldav_username=?, caldav_password=?, per_person_calendars=?
        WHERE id=1
      `).run(
        c.enabled ? 1 : 0,
        c.caldavUsername || '',
        c.caldavPassword || '',
        c.perPersonCalendars ? 1 : 0
      );
    }
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
}

// ── Update batch due date (for calendar drag or CalDAV bidirectional sync) ──
function updateBatchDue(db, batchId, newDueISO) {
  const batch = db.prepare('SELECT created FROM batches WHERE batch_id = ?').get(batchId);
  if (!batch) return;
  const created = new Date(batch.created);
  const newDue = new Date(newDueISO);
  const newDays = Math.max(1, Math.round((newDue - created) / 86400000));
  db.prepare('UPDATE batches SET due = ?, days = ? WHERE batch_id = ?').run(newDueISO, newDays, batchId);
}

// ── Update task due date (for calendar drag or CalDAV bidirectional sync) ──
function updateTaskDueDate(db, caldavUid, newDueDate) {
  db.prepare('UPDATE manual_tasks SET due_date = ?, caldav_synced = NULL WHERE caldav_uid = ?').run(newDueDate, caldavUid);
}

// ── Read only CalDAV config (lightweight, for auth checks) ──
function readCaldavConfig(db) {
  const cal = db.prepare('SELECT * FROM caldav_config WHERE id = 1').get();
  return {
    caldavUsername: cal.caldav_username,
    caldavPassword: cal.caldav_password,
    enabled: cal.enabled === 1,
    perPersonCalendars: cal.per_person_calendars === 1
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
  const token = crypto.randomBytes(32).toString('hex');
  const created = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
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
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// ── Atomic CRUD functions ───────────────────────────────────

// -- Batches --
function insertBatch(db, b) {
  db.exec('BEGIN');
  try {
    const sub = b.substrate || {};
    db.prepare(`INSERT INTO batches(batch_id,species,strain,qty,days,sub_hardwood,sub_wheatbran,sub_rh,sub_gypsum,bag_kg,batch_type,source_id,notes,created,due) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(b.batchId, b.species, b.strain||null, b.qty, b.days, sub.hardwood||0, sub.wheatbran||0, sub.rh||0, sub.gypsum?1:0, b.bagKg||3, b.batchType||'block', b.sourceId||null, b.notes||'', b.created, b.due);
    const ins = db.prepare('INSERT INTO bags(bag_id,batch_id) VALUES(?,?)');
    for (const bagId of (b.bags||[])) ins.run(bagId, b.batchId);
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}

function updateBatchField(db, batchId, fields) {
  const allowed = ['notes','species','strain','qty','days','due'];
  const cols = Object.keys(fields).filter(k => allowed.includes(k));
  if (!cols.length) return;
  const sets = cols.map(c => `${c}=?`).join(',');
  db.prepare(`UPDATE batches SET ${sets} WHERE batch_id=?`).run(...cols.map(c=>fields[c]), batchId);
}

function addBagsToBatch(db, batchId, newBags, newQty) {
  db.exec('BEGIN');
  try {
    const ins = db.prepare('INSERT OR IGNORE INTO bags(bag_id,batch_id) VALUES(?,?)');
    for (const id of newBags) ins.run(id, batchId);
    if (newQty != null) db.prepare('UPDATE batches SET qty=? WHERE batch_id=?').run(newQty, batchId);
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}

function deleteBatchById(db, batchId) {
  db.prepare('DELETE FROM batches WHERE batch_id=?').run(batchId);
}

// -- Scan Log --
function appendScanEntries(db, entries) {
  const ins = db.prepare('INSERT INTO scan_log(time,action,batch,bag,"from","to",species,strain) VALUES(?,?,?,?,?,?,?,?)');
  const ids = [];
  for (const e of entries) {
    const r = ins.run(e.time, e.action, e.batch||null, e.bag||null, e.from||null, e.to||null, e.species||null, e.strain||null);
    ids.push(r.lastInsertRowid);
  }
  return ids;
}

function deleteLastScanEntries(db, n) {
  db.prepare('DELETE FROM scan_log WHERE id IN (SELECT id FROM scan_log ORDER BY id DESC LIMIT ?)').run(n);
}

function clearScanLog(db) {
  db.prepare('DELETE FROM scan_log').run();
}

// -- Harvests --
function insertHarvest(db, h) {
  const r = db.prepare('INSERT INTO harvests(time,batch,bag,species,strain,grams,flush) VALUES(?,?,?,?,?,?,?)').run(h.time, h.batch||null, h.bag||null, h.species||null, h.strain||null, h.grams, h.flush||1);
  return r.lastInsertRowid;
}

// -- Cultures --
function insertCultures(db, cultures) {
  const ins = db.prepare('INSERT INTO cultures(id,type,species,strain,parent_id,source,status,notes,created) VALUES(?,?,?,?,?,?,?,?,?)');
  for (const c of cultures) {
    ins.run(c.id, c.type, c.species||null, c.strain||null, c.parentId||null, c.source||null, c.status||'active', c.notes||'', c.created);
  }
}

function updateCulture(db, id, fields) {
  const allowed = ['status','notes','species','strain','source'];
  const cols = Object.keys(fields).filter(k => allowed.includes(k));
  if (!cols.length) return;
  const sets = cols.map(c => `${c}=?`).join(',');
  db.prepare(`UPDATE cultures SET ${sets} WHERE id=?`).run(...cols.map(c=>fields[c]), id);
}

// -- Tasks --
function insertTask(db, t) {
  const r = db.prepare('INSERT INTO manual_tasks(text,priority,done,created,assignee,due_date,description,caldav_uid,caldav_synced) VALUES(?,?,?,?,?,?,?,?,?)').run(t.text, t.priority||'med', t.done?1:0, t.created, t.assignee||null, t.dueDate||null, t.description||null, t.caldavUid||null, t.caldavSynced||null);
  return r.lastInsertRowid;
}

function updateTaskById(db, id, fields) {
  const map = {done:'done',caldavUid:'caldav_uid',caldavSynced:'caldav_synced',text:'text',priority:'priority',assignee:'assignee',dueDate:'due_date',description:'description'};
  const entries = Object.entries(fields).filter(([k])=>map[k]);
  if (!entries.length) return;
  const sets = entries.map(([k])=>`${map[k]}=?`).join(',');
  const vals = entries.map(([k,v])=>k==='done'?(v?1:0):v);
  db.prepare(`UPDATE manual_tasks SET ${sets} WHERE id=?`).run(...vals, id);
}

function readTaskById(db, id) {
  const r = db.prepare('SELECT * FROM manual_tasks WHERE id=?').get(id);
  if (!r) return null;
  return { id: r.id, text: r.text, priority: r.priority, done: r.done===1, created: r.created, assignee: r.assignee, dueDate: r.due_date, description: r.description, caldavUid: r.caldav_uid, caldavSynced: r.caldav_synced };
}

function readBatchById(db, batchId) {
  const r = db.prepare('SELECT * FROM batches WHERE batch_id=?').get(batchId);
  if (!r) return null;
  return { batchId: r.batch_id, species: r.species, strain: r.strain, qty: r.qty, days: r.days, due: r.due, created: r.created, notes: r.notes };
}

function deleteTaskById(db, id) {
  db.prepare('DELETE FROM manual_tasks WHERE id=?').run(id);
}

// -- Team Members --
function insertMember(db, m) {
  const r = db.prepare('INSERT INTO team_members(name,role,added) VALUES(?,?,?)').run(m.name, m.role||null, m.added);
  return r.lastInsertRowid;
}

function deleteMember(db, id) {
  db.prepare('DELETE FROM team_members WHERE id=?').run(id);
}

// -- Assets --
function upsertAsset(db, a) {
  db.prepare(`INSERT INTO assets(asset_id,name,category,entry_date,exit_date,purchase_price,useful_life,depreciation_method,supplier,invoice_number,serial_number,location,status,notes,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET name=excluded.name,category=excluded.category,entry_date=excluded.entry_date,exit_date=excluded.exit_date,purchase_price=excluded.purchase_price,useful_life=excluded.useful_life,depreciation_method=excluded.depreciation_method,supplier=excluded.supplier,invoice_number=excluded.invoice_number,serial_number=excluded.serial_number,location=excluded.location,status=excluded.status,notes=excluded.notes,created=excluded.created`)
    .run(a.assetId, a.name, a.category, a.entryDate, a.exitDate||null, a.purchasePrice, a.usefulLife, a.depreciationMethod||'linear', a.supplier||null, a.invoiceNumber||null, a.serialNumber||null, a.location||null, a.status||'aktiv', a.notes||'', a.created);
}

function deleteAssetById(db, id) {
  db.prepare('DELETE FROM assets WHERE asset_id=?').run(id);
}

// -- CalDAV Config --
function updateCaldavCfg(db, c) {
  db.prepare('UPDATE caldav_config SET enabled=?,caldav_username=?,caldav_password=?,per_person_calendars=? WHERE id=1').run(c.enabled?1:0, c.caldavUsername||'', c.caldavPassword||'', c.perPersonCalendars?1:0);
}

// -- Inventory Delta --
function applyInventoryDelta(db, mat, deltaKg, type, ref) {
  const col = 'stock_' + mat;
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE inventory SET ${col} = MAX(0, ${col} + ?) WHERE id=1`).run(deltaKg);
    const row = db.prepare(`SELECT ${col} as val FROM inventory WHERE id=1`).get();
    db.prepare('INSERT INTO inventory_log(time,mat,delta_kg,running,type,ref) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(), mat, deltaKg, row.val, type||null, ref||null);
    db.exec('COMMIT');
    return row.val;
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}

function setInventoryAbsolute(db, mat, value, type, ref) {
  const col = 'stock_' + mat;
  db.exec('BEGIN');
  try {
    const old = db.prepare(`SELECT ${col} as val FROM inventory WHERE id=1`).get().val;
    const delta = value - old;
    db.prepare(`UPDATE inventory SET ${col}=? WHERE id=1`).run(value);
    db.prepare('INSERT INTO inventory_log(time,mat,delta_kg,running,type,ref) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(), mat, delta, value, type||null, ref||null);
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
}

// ── Calendar Event CRUD ─────────────────────────────────────
function insertCalendarEvent(db, ev) {
  db.prepare(`INSERT INTO calendar_events(id, title, description, start_date, end_date, all_day,
    start_time, end_time, category, color, caldav_uid, caldav_synced, created)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ev.id, ev.title, ev.description || null, ev.startDate, ev.endDate || null,
    ev.allDay ? 1 : 0, ev.startTime || null, ev.endTime || null,
    ev.category || 'custom', ev.color || null, ev.caldavUid || null,
    ev.caldavSynced || null, ev.created || new Date().toISOString()
  );
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
}

function deleteCalendarEvent(db, id) {
  db.prepare('DELETE FROM calendar_events WHERE id=?').run(id);
}

module.exports = {
  openDb, readAll, writeAll, backupDb, readCaldavConfig, updateTaskCaldavUid,
  updateBatchDue, updateTaskDueDate,
  createUser, getUserByUsername, verifyPassword, createSession, getSession,
  deleteSession, deleteExpiredSessions, countUsers, listUsers, deleteUser,
  insertBatch, updateBatchField, addBagsToBatch, deleteBatchById,
  appendScanEntries, deleteLastScanEntries, clearScanLog,
  insertHarvest, insertCultures, updateCulture,
  insertTask, updateTaskById, deleteTaskById, readTaskById, readBatchById,
  insertMember, deleteMember,
  upsertAsset, deleteAssetById,
  updateCaldavCfg,
  applyInventoryDelta, setInventoryAbsolute, updateInventoryConfig,
  insertCalendarEvent, updateCalendarEvent, deleteCalendarEvent
};
