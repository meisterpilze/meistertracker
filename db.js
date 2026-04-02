'use strict';
const Database = require('better-sqlite3');
const path = require('path');

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
`;

// ── Open / Init ──────────────────────────────────────────────
function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
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

  // Scan log
  const scanLog = db.prepare('SELECT * FROM scan_log ORDER BY id').all().map(r => ({
    time: r.time,
    action: r.action,
    batch: r.batch,
    bag: r.bag,
    from: r.from,
    to: r.to,
    species: r.species,
    strain: r.strain
  }));

  // Harvests
  const harvests = db.prepare('SELECT * FROM harvests ORDER BY id').all().map(r => ({
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

  // Manual tasks
  const manualTasks = db.prepare('SELECT * FROM manual_tasks ORDER BY id').all().map(r => ({
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

  // Team members
  const teamMembers = db.prepare('SELECT * FROM team_members ORDER BY id').all().map(r => ({
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

  return { batches, scanLog, manualTasks, harvests, cultures, inventory, teamMembers, caldav };
}

// ── Write All (diff incoming JSON against DB, apply changes) ─
function writeAll(db, incoming) {
  const tx = db.transaction(() => {
    // ── Batches ──
    if (incoming.batches) {
      const existingIds = new Set(db.prepare('SELECT batch_id FROM batches').all().map(r => r.batch_id));
      const incomingIds = new Set(incoming.batches.map(b => b.batchId));

      // Delete removed batches (CASCADE deletes bags)
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
        // Replace bags for this batch
        deleteBags.run(b.batchId);
        for (const bagId of (b.bags || [])) {
          insertBag.run(bagId, b.batchId);
        }
      }
    }

    // ── Scan Log (replace all — append-only in practice, safety check done before writeAll) ──
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

    // ── Manual Tasks (replace all — no stable unique ID) ──
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

    // ── Inventory ──
    if (incoming.inventory) {
      const inv = incoming.inventory;
      const stock = inv.stock || {};
      const thresh = inv.thresholds || {};
      const avg = inv.avgComposition || {};
      db.prepare(`
        UPDATE inventory SET
          stock_hardwood=?, stock_wheatbran=?, stock_gypsum=?, stock_grain=?,
          thresh_hardwood=?, thresh_wheatbran=?, thresh_gypsum=?, thresh_grain=?,
          avg_hw_pct=?, avg_wb_pct=?, avg_rh_pct=?, avg_bag_kg=?, avg_grain_bag_kg=?
        WHERE id=1
      `).run(
        stock.hardwood || 0, stock.wheatbran || 0, stock.gypsum || 0, stock.grain || 0,
        (thresh.hardwood && thresh.hardwood.minKg) || 50,
        (thresh.wheatbran && thresh.wheatbran.minKg) || 20,
        (thresh.gypsum && thresh.gypsum.minKg) || 5,
        (thresh.grain && thresh.grain.minKg) || 10,
        avg.hwPct || 75, avg.wbPct || 25, avg.rhPct || 63,
        avg.bagKg || 3, avg.grainBagKg || 1
      );

      // Inventory log (replace all)
      if (inv.log) {
        db.prepare('DELETE FROM inventory_log').run();
        const ins = db.prepare('INSERT INTO inventory_log(time, mat, delta_kg, running, type, ref) VALUES(?, ?, ?, ?, ?, ?)');
        for (const e of inv.log) {
          ins.run(e.time, e.mat, e.deltaKg, e.running || 0, e.type || null, e.ref || null);
        }
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
  });

  tx();
}

// ── Backup ───────────────────────────────────────────────────
function backupDb(db, destPath) {
  return db.backup(destPath);
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

module.exports = { openDb, readAll, writeAll, backupDb, readCaldavConfig };
