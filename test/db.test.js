'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_test_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

describe('db – schema & init', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('opens a fresh database without error', () => {
    assert.ok(d);
  });

  it('readAll returns expected shape', () => {
    const data = db.readAll(d);
    assert.ok(Array.isArray(data.batches));
    assert.ok(Array.isArray(data.scanLog));
    assert.ok(Array.isArray(data.manualTasks));
    assert.ok(Array.isArray(data.harvests));
    assert.ok(Array.isArray(data.cultures));
    assert.ok(typeof data.inventory === 'object');
    assert.ok(Array.isArray(data.teamMembers));
    assert.ok(typeof data.caldav === 'object');
    assert.ok(Array.isArray(data.assets));
    assert.ok(Array.isArray(data.calendarEvents));
    assert.equal(typeof data.version, 'number');
  });

  it('inventory singleton exists with zero stock', () => {
    const data = db.readAll(d);
    assert.equal(data.inventory.stock.hardwood, 0);
    assert.equal(data.inventory.stock.wheatbran, 0);
    assert.equal(data.inventory.stock.gypsum, 0);
    assert.equal(data.inventory.stock.grain, 0);
  });

  it('migration v5 creates performance indexes', () => {
    const expected = {
      scan_log: ['idx_scanlog_batch', 'idx_scanlog_bag', 'idx_scanlog_user'],
      harvests: ['idx_harvests_bag'],
      cultures: ['idx_cultures_parent'],
      manual_tasks: ['idx_tasks_assignee', 'idx_tasks_due'],
      calendar_events: ['idx_calevents_start'],
      calendar_event_assignees: ['idx_calassign_user']
    };
    for (const [table, names] of Object.entries(expected)) {
      const indexes = d
        .prepare(`SELECT name FROM pragma_index_list('${table}')`)
        .all()
        .map((r) => r.name);
      for (const name of names) {
        assert.ok(indexes.includes(name), `Missing index ${name} on ${table}`);
      }
    }
  });

  it('migration v6 creates unique caldav_uid indexes', () => {
    const taskIndexes = d.prepare('SELECT name, "unique" as u FROM pragma_index_list(\'manual_tasks\')').all();
    const ti = taskIndexes.find((r) => r.name === 'idx_tasks_caldav_uid');
    assert.ok(ti, 'Missing unique index idx_tasks_caldav_uid on manual_tasks');
    assert.equal(ti.u, 1, 'idx_tasks_caldav_uid should be unique');

    const eventIndexes = d.prepare('SELECT name, "unique" as u FROM pragma_index_list(\'calendar_events\')').all();
    const ei = eventIndexes.find((r) => r.name === 'idx_calevents_caldav_uid');
    assert.ok(ei, 'Missing unique index idx_calevents_caldav_uid on calendar_events');
    assert.equal(ei.u, 1, 'idx_calevents_caldav_uid should be unique');
  });
});

describe('db – auth (users & sessions)', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('createUser stores a user', () => {
    const u = db.createUser(d, 'alice', 'password123', 'admin');
    assert.equal(u.username, 'alice');
    assert.equal(u.role, 'admin');
  });

  it('getUserByUsername returns the user', () => {
    const u = db.getUserByUsername(d, 'alice');
    assert.ok(u);
    assert.equal(u.username, 'alice');
    assert.ok(u.hash);
    assert.ok(u.salt);
  });

  it('verifyPassword returns true for correct password', () => {
    const u = db.getUserByUsername(d, 'alice');
    assert.ok(db.verifyPassword(u.hash, u.salt, 'password123'));
  });

  it('verifyPassword returns false for wrong password', () => {
    const u = db.getUserByUsername(d, 'alice');
    assert.ok(!db.verifyPassword(u.hash, u.salt, 'wrongpassword'));
  });

  it('createSession returns a hex token', () => {
    const u = db.getUserByUsername(d, 'alice');
    const token = db.createSession(d, u.id);
    assert.ok(token);
    assert.match(token, /^[a-f0-9]{64}$/);
  });

  it('getSession returns session data for valid token', () => {
    const u = db.getUserByUsername(d, 'alice');
    const token = db.createSession(d, u.id);
    const session = db.getSession(d, token);
    assert.ok(session);
    assert.equal(session.username, 'alice');
    assert.equal(session.role, 'admin');
  });

  it('getSession returns undefined for invalid token', () => {
    const session = db.getSession(d, 'deadbeef'.repeat(8));
    assert.equal(session, undefined);
  });

  it('deleteSession invalidates the token', () => {
    const u = db.getUserByUsername(d, 'alice');
    const token = db.createSession(d, u.id);
    db.deleteSession(d, token);
    assert.equal(db.getSession(d, token), undefined);
  });

  it('countUsers returns the count', () => {
    assert.equal(db.countUsers(d), 1);
  });

  it('listUsers returns user list without hashes', () => {
    const users = db.listUsers(d);
    assert.equal(users.length, 1);
    assert.equal(users[0].username, 'alice');
    assert.ok(!users[0].hash);
    assert.ok(!users[0].salt);
  });

  it('duplicate username throws', () => {
    assert.throws(() => db.createUser(d, 'alice', 'other', 'user'));
  });

  it('deleteUser removes the user', () => {
    db.createUser(d, 'bob', 'pass1234', 'user');
    const u = db.getUserByUsername(d, 'bob');
    db.deleteUser(d, u.id);
    assert.equal(db.getUserByUsername(d, 'bob'), undefined);
  });
});

describe('db – batches CRUD', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  const batch = {
    batchId: 'B-001',
    species: 'Pleurotus ostreatus',
    strain: 'HK35',
    qty: 10,
    days: 21,
    substrate: { hardwood: 75, wheatbran: 25, rh: 63, gypsum: false },
    bagKg: 3,
    batchType: 'block',
    notes: 'Test batch',
    created: '2024-01-01T00:00:00Z',
    due: '2024-01-22T00:00:00Z',
    bags: ['B-001-01', 'B-001-02', 'B-001-03']
  };

  it('insertBatch creates batch with bags', () => {
    db.insertBatch(d, batch);
    const data = db.readAll(d);
    assert.equal(data.batches.length, 1);
    assert.equal(data.batches[0].batchId, 'B-001');
    assert.equal(data.batches[0].species, 'Pleurotus ostreatus');
    assert.deepEqual(data.batches[0].bags, ['B-001-01', 'B-001-02', 'B-001-03']);
  });

  it('updateBatchField updates notes', () => {
    db.updateBatchField(d, 'B-001', { notes: 'Updated notes' });
    const b = db.readBatchById(d, 'B-001');
    assert.equal(b.notes, 'Updated notes');
  });

  it('addBagsToBatch adds new bags', () => {
    db.addBagsToBatch(d, 'B-001', ['B-001-04'], 11);
    const data = db.readAll(d);
    assert.equal(data.batches[0].bags.length, 4);
    assert.equal(data.batches[0].qty, 11);
  });

  it('deleteBatchById removes batch and cascades bags', () => {
    db.deleteBatchById(d, 'B-001');
    const data = db.readAll(d);
    assert.equal(data.batches.length, 0);
  });

  it('insertBatch rejects qty < 1', () => {
    assert.throws(() => db.insertBatch(d, { ...batch, batchId: 'B-BAD', qty: 0 }), /qty must be >= 1/);
  });

  it('insertBatch rejects days < 1', () => {
    assert.throws(() => db.insertBatch(d, { ...batch, batchId: 'B-BAD2', days: 0 }), /days must be >= 1/);
  });

  // I-19: substrate composition must total 100% for block batches.
  it('insertBatch rejects block batch with substrate < 100%', () => {
    assert.throws(
      () =>
        db.insertBatch(d, {
          ...batch,
          batchId: 'B-BAD-SUB-LOW',
          bags: ['B-BAD-SUB-LOW-01'],
          substrate: { hardwood: 70, wheatbran: 20, rh: 63, gypsum: false }
        }),
      /Substrate composition must total 100%/
    );
  });

  it('insertBatch rejects block batch with substrate > 100%', () => {
    assert.throws(
      () =>
        db.insertBatch(d, {
          ...batch,
          batchId: 'B-BAD-SUB-HIGH',
          bags: ['B-BAD-SUB-HIGH-01'],
          substrate: { hardwood: 80, wheatbran: 30, rh: 63, gypsum: false }
        }),
      /Substrate composition must total 100%/
    );
  });

  it('insertBatch allows block batch with no substrate composition (zero/zero)', () => {
    // Pre-existing legacy batches and minimal-config batches don't set hw/wb.
    db.insertBatch(d, {
      ...batch,
      batchId: 'B-NO-SUB',
      bags: ['B-NO-SUB-01'],
      substrate: { hardwood: 0, wheatbran: 0, rh: 63, gypsum: false }
    });
    const stored = db.readBatchById(d, 'B-NO-SUB');
    assert.equal(stored.batchId, 'B-NO-SUB');
  });

  it('insertBatch skips substrate check for grain batches', () => {
    // Grain batches don't use the hardwood/wheatbran split.
    db.insertBatch(d, {
      batchId: 'GS-NOSUB',
      species: 'Pleurotus ostreatus',
      strain: 'HK35',
      qty: 1,
      days: 14,
      substrate: {},
      bagKg: 1,
      batchType: 'grain',
      created: '2024-02-01T00:00:00Z',
      due: '2024-02-15T00:00:00Z',
      bags: ['GS-NOSUB-01']
    });
    const stored = db.readBatchById(d, 'GS-NOSUB');
    assert.equal(stored.batchType, 'grain');
  });
});

describe('db – grain hydration deduction', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    db.applyInventoryDelta(d, 'grain', 100, 'delivery', 'seed');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('grain batch with grainRh=52 deducts only dry weight on delete-reversal', () => {
    // Insert a 10-bag × 1kg grain batch with 52% water content.
    // Dry grain used = 10 × 1 × (1 - 0.52) = 4.8 kg.
    db.insertBatch(d, {
      batchId: 'G-001',
      species: 'Pleurotus ostreatus',
      strain: 'HK35',
      qty: 10,
      days: 14,
      bagKg: 1,
      batchType: 'grain',
      grainRh: 52,
      notes: '',
      created: '2024-01-01T00:00:00Z',
      due: '2024-01-15T00:00:00Z',
      bags: Array.from({ length: 10 }, (_, i) => 'G-001-' + String(i + 1).padStart(2, '0'))
    });
    // Simulate the client-side deduction (dry weight only)
    db.applyInventoryDelta(d, 'grain', -4.8, 'batch', 'G-001');
    let inv = db.getInventory(d);
    assert.ok(Math.abs(inv.stock.grain - 95.2) < 1e-6, `after deduct: ${inv.stock.grain}`);

    // Deleting the batch should restore exactly the dry weight.
    db.deleteBatchById(d, 'G-001');
    inv = db.getInventory(d);
    assert.ok(Math.abs(inv.stock.grain - 100) < 1e-6, `after delete: ${inv.stock.grain}`);
  });

  it('legacy grain batch with grainRh=0 deducts full wet weight (backward compat)', () => {
    db.insertBatch(d, {
      batchId: 'G-LEGACY',
      species: 'Pleurotus ostreatus',
      strain: 'HK35',
      qty: 5,
      days: 14,
      bagKg: 1,
      batchType: 'grain',
      // grainRh omitted → defaults to 0 (legacy behaviour)
      notes: '',
      created: '2024-01-01T00:00:00Z',
      due: '2024-01-15T00:00:00Z',
      bags: Array.from({ length: 5 }, (_, i) => 'G-LEGACY-' + String(i + 1).padStart(2, '0'))
    });
    // Legacy deduction: full wet weight
    db.applyInventoryDelta(d, 'grain', -5, 'batch', 'G-LEGACY');
    // Delete should reverse the full 5 kg (grain_rh=0 preserves old math)
    db.deleteBatchById(d, 'G-LEGACY');
    const inv = db.getInventory(d);
    assert.ok(Math.abs(inv.stock.grain - 100) < 1e-6, `after legacy delete: ${inv.stock.grain}`);
  });

  it('getInventory exposes avgComposition.grainRhPct with default 52', () => {
    const inv = db.getInventory(d);
    assert.equal(inv.avgComposition.grainRhPct, 52);
  });

  it('updateInventoryConfig persists grainRhPct', () => {
    db.updateInventoryConfig(d, {}, { grainRhPct: 55 });
    const inv = db.getInventory(d);
    assert.equal(inv.avgComposition.grainRhPct, 55);
  });
});

describe('db – scan log', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    db.insertBatch(d, {
      batchId: 'B-002',
      species: 'Lentinula edodes',
      strain: null,
      qty: 1,
      days: 90,
      created: '2024-01-01T00:00:00Z',
      due: '2024-04-01T00:00:00Z',
      bags: ['B-002-01']
    });
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('appendScanEntries adds entries and returns IDs', () => {
    const ids = db.appendScanEntries(
      d,
      [
        { time: '2024-01-02T10:00:00Z', action: 'ADD', batch: 'B-002', bag: 'B-002-01', from: null, to: 'Inoculation' },
        {
          time: '2024-01-02T11:00:00Z',
          action: 'MOVE',
          batch: 'B-002',
          bag: 'B-002-01',
          from: 'Inoculation',
          to: 'Incubation'
        }
      ],
      null
    );
    assert.equal(ids.length, 2);
  });

  it('deleteScanEntryById removes one entry', () => {
    const data = db.readAll(d);
    const id = data.scanLog[0].id;
    assert.ok(db.deleteScanEntryById(d, id));
    assert.equal(db.readAll(d).scanLog.length, 1);
  });

  it('clearScanLog removes all entries', () => {
    db.clearScanLog(d);
    assert.equal(db.readAll(d).scanLog.length, 0);
  });

  // I-11: client_uuid is the offline-queue idempotency key. A replay (same
  // entry POSTed twice because the client lost the response) should be a
  // no-op on the server, and the second call should return the *original*
  // row id so the client can still reconcile its in-memory entry.
  it('appendScanEntries dedupes on client_uuid (I-11)', () => {
    const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const entry = {
      time: '2024-05-01T12:00:00Z',
      action: 'ADD',
      batch: 'B-DEDUP',
      bag: 'B-DEDUP-01',
      from: null,
      to: 'INC',
      client_uuid: uuid
    };
    const before = db.readAll(d).scanLog.length;
    const [id1] = db.appendScanEntries(d, [entry], null);
    const [id2] = db.appendScanEntries(d, [entry], null);
    const after = db.readAll(d).scanLog.length;
    assert.equal(after - before, 1, 'second insert should be a no-op');
    assert.ok(id1, 'first insert returns an id');
    assert.equal(id2, id1, 'second call returns the original id so client can reconcile');
  });
});

describe('db – harvests', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('insertHarvest returns an ID', () => {
    const id = db.insertHarvest(d, {
      time: '2024-03-01T08:00:00Z',
      batch: 'B-002',
      bag: 'B-002-01',
      species: 'Lentinula edodes',
      strain: null,
      grams: 250,
      flush: 1
    });
    assert.ok(id);
  });

  it('harvest appears in readAll', () => {
    const data = db.readAll(d);
    assert.equal(data.harvests.length, 1);
    assert.equal(data.harvests[0].grams, 250);
  });

  it('insertHarvest rejects negative grams', () => {
    assert.throws(
      () =>
        db.insertHarvest(d, {
          time: '2024-03-01T08:00:00Z',
          batch: 'B-002',
          bag: 'B-002-01',
          species: 'Lentinula edodes',
          strain: null,
          grams: -5,
          flush: 1
        }),
      /grams must be >= 0/
    );
  });
});

describe('db – cultures', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('insertCultures adds cultures', () => {
    db.insertCultures(d, [
      {
        id: 'MC-PLEU-010124-01',
        type: 'MC',
        species: 'Pleurotus',
        strain: 'HK35',
        status: 'active',
        notes: '',
        created: '2024-01-01T00:00:00Z'
      }
    ]);
    const data = db.readAll(d);
    assert.equal(data.cultures.length, 1);
    assert.equal(data.cultures[0].type, 'MC');
  });

  it('updateCulture updates status', () => {
    db.updateCulture(d, 'MC-PLEU-010124-01', { status: 'retired' });
    const data = db.readAll(d);
    assert.equal(data.cultures[0].status, 'retired');
  });

  // I-20: parent type validation in insertCultures.
  it('insertCultures rejects MC with a parent (root must have no parent)', () => {
    assert.throws(
      () =>
        db.insertCultures(d, [
          {
            id: 'MC-BAD-PARENT',
            type: 'MC',
            parentId: 'MC-PLEU-010124-01',
            species: 'Pleurotus',
            status: 'active',
            notes: '',
            created: '2024-01-02T00:00:00Z'
          }
        ]),
      /MC cultures cannot have a parent/
    );
  });

  it('insertCultures rejects PD whose parent is not MC or PD', () => {
    // Seed an LC parent so we have a non-MC, non-PD candidate.
    db.insertCultures(d, [
      {
        id: 'LC-SEED-01',
        type: 'LC',
        parentId: 'MC-PLEU-010124-01',
        species: 'Pleurotus',
        status: 'active',
        notes: '',
        created: '2024-01-03T00:00:00Z'
      }
    ]);
    assert.throws(
      () =>
        db.insertCultures(d, [
          {
            id: 'PD-BAD-PARENT',
            type: 'PD',
            parentId: 'LC-SEED-01',
            species: 'Pleurotus',
            status: 'active',
            notes: '',
            created: '2024-01-04T00:00:00Z'
          }
        ]),
      /PD parent must be one of \[MC, PD\]/
    );
  });

  it('insertCultures accepts LC with PD parent', () => {
    db.insertCultures(d, [
      {
        id: 'PD-FOR-LC',
        type: 'PD',
        parentId: 'MC-PLEU-010124-01',
        species: 'Pleurotus',
        status: 'active',
        notes: '',
        created: '2024-01-05T00:00:00Z'
      },
      {
        id: 'LC-FROM-PD',
        type: 'LC',
        parentId: 'PD-FOR-LC',
        species: 'Pleurotus',
        status: 'active',
        notes: '',
        created: '2024-01-06T00:00:00Z'
      }
    ]);
    const data = db.readAll(d);
    assert.ok(data.cultures.find((c) => c.id === 'LC-FROM-PD'));
  });

  it('insertCultures rejects unknown parent culture id', () => {
    assert.throws(
      () =>
        db.insertCultures(d, [
          {
            id: 'PD-UNKNOWN-PARENT',
            type: 'PD',
            parentId: 'NO-SUCH-CULTURE',
            species: 'Pleurotus',
            status: 'active',
            notes: '',
            created: '2024-01-07T00:00:00Z'
          }
        ]),
      /parent culture not found: NO-SUCH-CULTURE/
    );
  });

  it('insertCultures still rejects self-cycles', () => {
    assert.throws(
      () =>
        db.insertCultures(d, [
          {
            id: 'SELF-CYCLE-01',
            type: 'PD',
            parentId: 'SELF-CYCLE-01',
            species: 'Pleurotus',
            status: 'active',
            notes: '',
            created: '2024-01-08T00:00:00Z'
          }
        ]),
      /self-cycle/
    );
  });
});

describe('db – tasks', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('insertTask returns an ID', () => {
    const id = db.insertTask(d, { text: 'Clean lab', priority: 'high', done: false, created: '2024-01-01T00:00:00Z' });
    assert.ok(id);
  });

  it('updateTaskById marks task done', () => {
    const data = db.readAll(d);
    db.updateTaskById(d, data.manualTasks[0].id, { done: true });
    const t = db.readTaskById(d, data.manualTasks[0].id);
    assert.equal(t.done, true);
  });

  it('deleteTaskById removes the task', () => {
    const data = db.readAll(d);
    db.deleteTaskById(d, data.manualTasks[0].id);
    assert.equal(db.readAll(d).manualTasks.length, 0);
  });
});

describe('db – team members', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('insertMember returns an ID', () => {
    const id = db.insertMember(d, { name: 'Max', role: 'Technician', added: '2024-01-01T00:00:00Z' });
    assert.ok(id);
  });

  it('deleteMember removes the member', () => {
    const data = db.readAll(d);
    db.deleteMember(d, data.teamMembers[0].id);
    assert.equal(db.readAll(d).teamMembers.length, 0);
  });
});

describe('db – inventory', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('applyInventoryDelta adds stock', () => {
    const val = db.applyInventoryDelta(d, 'hardwood', 100, 'delivery', 'Lieferung #1');
    assert.equal(val, 100);
  });

  it('applyInventoryDelta clamps under-stock subtraction and records actual delta', () => {
    // Stock is currently 100 (from the previous addStock test). Requesting -200 should
    // clamp to -100 so the inventory_log delta_kg matches what actually came out of stock.
    const val = db.applyInventoryDelta(d, 'hardwood', -200, 'batch', 'B-001');
    assert.equal(val, 0);
    const data = db.readAll(d);
    const hwLog = data.inventory.log.filter((l) => l.mat === 'hardwood');
    // Sum of recorded deltas must equal final stock — the ledger reconciles.
    const sum = hwLog.reduce((acc, l) => acc + l.deltaKg, 0);
    assert.equal(sum, 0);
    // The most recent hardwood entry records the clamped (-100), not the requested (-200).
    assert.equal(hwLog[hwLog.length - 1].deltaKg, -100);
  });

  it('setInventoryAbsolute sets stock value', () => {
    const val = db.setInventoryAbsolute(d, 'grain', 50, 'correction', null);
    assert.equal(val, 50);
  });

  it('inventory log is recorded', () => {
    const data = db.readAll(d);
    assert.ok(data.inventory.log.length >= 3);
  });

  it('rejects invalid material', () => {
    assert.throws(() => db.applyInventoryDelta(d, 'invalid', 10, null, null), /invalid material/);
  });

  it('updateInventoryConfig updates thresholds', () => {
    db.updateInventoryConfig(d, { hardwood: { minKg: 100 } }, { hwPct: 80 });
    const data = db.readAll(d);
    assert.equal(data.inventory.thresholds.hardwood.minKg, 100);
    assert.equal(data.inventory.avgComposition.hwPct, 80);
  });

  // I-22: actor accountability — every inventory_log row records the user_id
  // that triggered it. Optional, NULL when no user is supplied (legacy / system).
  it('inventory_log records user_id when supplied', () => {
    db.createUser(d, 'invlog_alice', 'pass1234', 'admin');
    const u = db.getUserByUsername(d, 'invlog_alice');
    db.applyInventoryDelta(d, 'wheatbran', 25, 'delivery', 'audit-trail', u.id);
    const log = db.readAll(d).inventory.log.filter((l) => l.mat === 'wheatbran' && l.ref === 'audit-trail');
    assert.equal(log.length, 1);
    assert.equal(log[0].user_id, u.id);
  });
});

describe('db – addBagsToBatch deducts inventory (I-23)', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    db.applyInventoryDelta(d, 'hardwood', 1000, 'delivery', 'seed');
    db.applyInventoryDelta(d, 'wheatbran', 1000, 'delivery', 'seed');
    db.insertBatch(d, {
      batchId: 'GROW-001',
      species: 'Pleurotus ostreatus',
      strain: 'HK35',
      qty: 10,
      days: 21,
      substrate: { hardwood: 75, wheatbran: 25, rh: 0, gypsum: false },
      bagKg: 3,
      batchType: 'block',
      created: '2024-01-01T00:00:00Z',
      due: '2024-01-22T00:00:00Z',
      bags: Array.from({ length: 10 }, (_, i) => 'GROW-001-' + String(i + 1).padStart(2, '0'))
    });
    // Apply the matching deduction the way the client / server flow does today
    // (insertBatch deltas are passed by the caller). For this test we set up
    // the post-create state by hand: 30 kg total wet, 75/25 → 22.5 hw + 7.5 wb.
    db.applyInventoryDelta(d, 'hardwood', -22.5, 'batch', 'GROW-001');
    db.applyInventoryDelta(d, 'wheatbran', -7.5, 'batch', 'GROW-001');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('addBagsToBatch deducts substrate proportional to the new bag count', () => {
    const before = db.readAll(d).inventory.stock;
    // Add 2 bags × 3 kg = 6 kg substrate. 75/25 split → 4.5 hw + 1.5 wb.
    db.addBagsToBatch(d, 'GROW-001', ['GROW-001-11', 'GROW-001-12'], 12);
    const after = db.readAll(d).inventory.stock;
    assert.ok(Math.abs(before.hardwood - after.hardwood - 4.5) < 1e-6, `hw delta: ${before.hardwood - after.hardwood}`);
    assert.ok(
      Math.abs(before.wheatbran - after.wheatbran - 1.5) < 1e-6,
      `wb delta: ${before.wheatbran - after.wheatbran}`
    );
  });

  it('addBagsToBatch records inventory_log entries with batch-grow type', () => {
    const log = db.readAll(d).inventory.log.filter((l) => l.type === 'batch-grow' && l.ref === 'GROW-001');
    // Two materials × 1 grow event = 2 entries.
    assert.equal(log.length, 2);
    const mats = new Set(log.map((l) => l.mat));
    assert.ok(mats.has('hardwood'));
    assert.ok(mats.has('wheatbran'));
  });

  it('addBagsToBatch records userId in inventory_log when supplied', () => {
    db.createUser(d, 'grow_bob', 'pass1234', 'admin');
    const u = db.getUserByUsername(d, 'grow_bob');
    db.addBagsToBatch(d, 'GROW-001', ['GROW-001-13'], 13, undefined, u.id);
    const log = db.readAll(d).inventory.log.filter((l) => l.type === 'batch-grow' && l.ref === 'GROW-001');
    // Newest entries should be the one we just added — they carry the user_id.
    const recent = log.filter((l) => l.user_id === u.id);
    assert.ok(recent.length >= 1, 'expected at least one row with the supplied user_id');
  });

  it('addBagsToBatch on grain batch deducts grain (dry weight)', () => {
    db.applyInventoryDelta(d, 'grain', 100, 'delivery', 'seed-grain');
    db.insertBatch(d, {
      batchId: 'GS-GROW',
      species: 'Pleurotus ostreatus',
      strain: 'HK35',
      qty: 5,
      days: 14,
      bagKg: 1,
      batchType: 'grain',
      grainRh: 52,
      created: '2024-01-01T00:00:00Z',
      due: '2024-01-15T00:00:00Z',
      bags: Array.from({ length: 5 }, (_, i) => 'GS-GROW-' + String(i + 1).padStart(2, '0'))
    });
    const before = db.readAll(d).inventory.stock.grain;
    // Add 2 bags × 1 kg wet × (1-0.52) = 0.96 kg dry grain.
    db.addBagsToBatch(d, 'GS-GROW', ['GS-GROW-06', 'GS-GROW-07'], 7);
    const after = db.readAll(d).inventory.stock.grain;
    assert.ok(Math.abs(before - after - 0.96) < 1e-6, `grain delta: ${before - after}`);
  });
});

describe('db – assets', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('upsertAsset creates an asset', () => {
    db.upsertAsset(d, {
      assetId: 'A-001',
      name: 'Autoclave',
      category: 'Equipment',
      entryDate: '2024-01-01',
      purchasePrice: 5000,
      usefulLife: 10,
      created: '2024-01-01T00:00:00Z'
    });
    const data = db.readAll(d);
    assert.equal(data.assets.length, 1);
    assert.equal(data.assets[0].name, 'Autoclave');
  });

  it('upsertAsset updates existing asset', () => {
    db.upsertAsset(d, {
      assetId: 'A-001',
      name: 'Autoclave XL',
      category: 'Equipment',
      entryDate: '2024-01-01',
      purchasePrice: 7000,
      usefulLife: 10,
      created: '2024-01-01T00:00:00Z'
    });
    const data = db.readAll(d);
    assert.equal(data.assets.length, 1);
    assert.equal(data.assets[0].name, 'Autoclave XL');
  });

  it('deleteAssetById removes the asset', () => {
    db.deleteAssetById(d, 'A-001');
    assert.equal(db.readAll(d).assets.length, 0);
  });
});

describe('db – calendar events', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    db.createUser(d, 'cal-user', 'password123', 'user');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('insertCalendarEvent creates an event', () => {
    db.insertCalendarEvent(d, {
      id: 'ev-001',
      title: 'Inoculation day',
      startDate: '2024-02-01',
      endDate: '2024-02-01',
      allDay: true,
      category: 'custom'
    });
    const data = db.readAll(d);
    assert.equal(data.calendarEvents.length, 1);
    assert.equal(data.calendarEvents[0].title, 'Inoculation day');
  });

  it('updateCalendarEvent updates fields', () => {
    db.updateCalendarEvent(d, 'ev-001', { title: 'Updated event' });
    const data = db.readAll(d);
    assert.equal(data.calendarEvents[0].title, 'Updated event');
  });

  it('setCalendarEventAssignees sets and reads assignees', () => {
    const u = db.getUserByUsername(d, 'cal-user');
    db.setCalendarEventAssignees(d, 'ev-001', [u.id]);
    const data = db.readAll(d);
    assert.equal(data.calendarEvents[0].assignees.length, 1);
    assert.equal(data.calendarEvents[0].assignees[0].username, 'cal-user');
  });

  it('deleteCalendarEvent removes the event', () => {
    db.deleteCalendarEvent(d, 'ev-001');
    assert.equal(db.readAll(d).calendarEvents.length, 0);
  });
});

describe('db – data versioning', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('version increments on mutations', () => {
    const v0 = db.getDataVersion(d);
    db.insertTask(d, { text: 'V test', priority: 'low', done: false, created: '2024-01-01T00:00:00Z' });
    const v1 = db.getDataVersion(d);
    assert.ok(v1 > v0);
  });
});

describe('db – backup', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('backupDb creates a valid copy', () => {
    db.insertTask(d, { text: 'Backup test', priority: 'low', done: false, created: '2024-01-01T00:00:00Z' });
    const dest = p + '.backup';
    db.backupDb(d, dest);
    assert.ok(fs.existsSync(dest));
    const d2 = db.openDb(dest);
    const data = db.readAll(d2);
    assert.ok(data.manualTasks.some((t) => t.text === 'Backup test'));
    d2.close();
    fs.unlinkSync(dest);
  });
});

describe('db – mushroom strains CRUD', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('listMushroomStrains returns empty array on fresh db', () => {
    assert.deepEqual(db.listMushroomStrains(d), []);
  });

  it('createMushroomStrain returns new id and stores the row', () => {
    const id = db.createMushroomStrain(d, {
      name: 'Pleurotus ostreatus HK35',
      kuerzel: 'HK35',
      description: 'Classic oyster'
    });
    assert.ok(Number(id) > 0);
    const list = db.listMushroomStrains(d);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Pleurotus ostreatus HK35');
    assert.equal(list[0].kuerzel, 'HK35');
    assert.equal(list[0].description, 'Classic oyster');
  });

  it('createMushroomStrain rejects missing name', () => {
    assert.throws(() => db.createMushroomStrain(d, { name: '', kuerzel: 'X1' }), /Name/);
  });

  it('createMushroomStrain rejects missing kuerzel', () => {
    assert.throws(() => db.createMushroomStrain(d, { name: 'Test', kuerzel: '' }), /K.?rzel/);
  });

  it('createMushroomStrain allows duplicate name (different kuerzel)', () => {
    const id = db.createMushroomStrain(d, { name: 'Pleurotus ostreatus HK35', kuerzel: 'OTHER' });
    assert.ok(Number(id) > 0);
  });

  it('createMushroomStrain rejects duplicate kuerzel', () => {
    assert.throws(() => db.createMushroomStrain(d, { name: 'Different name', kuerzel: 'HK35' }), /already taken/);
  });

  it('insertBatch with strainId resolves species/strain from mushroom_strains', () => {
    const list = db.listMushroomStrains(d);
    const strainId = list[0].id;
    db.insertBatch(d, {
      batchId: 'SB-001',
      strainId,
      species: 'WRONG SPECIES',
      strain: 'WRONG',
      qty: 2,
      days: 14,
      created: '2025-03-01T00:00:00Z',
      due: '2025-03-15T00:00:00Z',
      bags: ['SB-001-01', 'SB-001-02']
    });
    const b = db.readBatchById(d, 'SB-001');
    assert.equal(b.strainId, strainId);
    assert.equal(b.species, 'Pleurotus ostreatus HK35 (HK35)');
    assert.equal(b.strain, 'WRONG');
    assert.equal(b.strainName, 'Pleurotus ostreatus HK35');
    assert.equal(b.strainKuerzel, 'HK35');
  });

  it('insertCultures with strainId resolves species/strain from mushroom_strains', () => {
    const list = db.listMushroomStrains(d);
    const strainId = list[0].id;
    db.insertCultures(d, [
      {
        id: 'MC-KINGS-250301-01',
        type: 'MC',
        strainId,
        species: 'wrong',
        strain: 'wrong',
        status: 'active',
        notes: '',
        created: '2025-03-01T00:00:00Z'
      }
    ]);
    const cultures = db.getAllCultures(d);
    const c = cultures.find((x) => x.id === 'MC-KINGS-250301-01');
    assert.ok(c);
    assert.equal(c.strainId, strainId);
    assert.equal(c.species, 'Pleurotus ostreatus HK35');
    assert.equal(c.strain, 'HK35');
    assert.equal(c.strainName, 'Pleurotus ostreatus HK35');
    assert.equal(c.strainKuerzel, 'HK35');
  });

  it('updateMushroomStrain propagates name/kuerzel to batches and cultures', () => {
    const list = db.listMushroomStrains(d);
    const strainId = list[0].id;
    db.updateMushroomStrain(d, strainId, { name: 'Pleurotus ostreatus Kings', kuerzel: 'KINGS' });

    const b = db.readBatchById(d, 'SB-001');
    assert.equal(b.species, 'Pleurotus ostreatus Kings');
    assert.equal(b.strain, 'KINGS');
    assert.equal(b.strainName, 'Pleurotus ostreatus Kings');
    assert.equal(b.strainKuerzel, 'KINGS');

    const cultures = db.getAllCultures(d);
    const c = cultures.find((x) => x.id === 'MC-KINGS-250301-01');
    assert.equal(c.species, 'Pleurotus ostreatus Kings');
    assert.equal(c.strain, 'KINGS');
    assert.equal(c.strainName, 'Pleurotus ostreatus Kings');
    assert.equal(c.strainKuerzel, 'KINGS');
  });

  it('deleteMushroomStrain throws when strain is still referenced', () => {
    // Find the strain that has batches/cultures referencing it (kuerzel was updated to KINGS earlier)
    const list = db.listMushroomStrains(d);
    const referenced = list.find((s) => s.kuerzel === 'KINGS');
    assert.ok(referenced, 'expected to find the referenced strain');
    assert.throws(() => db.deleteMushroomStrain(d, referenced.id), /still in use/);
  });

  it('deleteMushroomStrain removes a free strain', () => {
    const freshId = db.createMushroomStrain(d, { name: 'Lentinula edodes CS-41', kuerzel: 'CS41' });
    const ok = db.deleteMushroomStrain(d, Number(freshId));
    assert.equal(ok, true);
    const list = db.listMushroomStrains(d);
    assert.ok(!list.some((s) => s.id === Number(freshId)));
  });
});

describe('db – notifications', () => {
  let d, p, userA, userB;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    db.createUser(d, 'notif-a', 'password123', 'admin');
    db.createUser(d, 'notif-b', 'password123', 'user');
    userA = db.getUserByUsername(d, 'notif-a');
    userB = db.getUserByUsername(d, 'notif-b');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('createNotification inserts a row and returns its id', () => {
    const id = db.createNotification(d, {
      userId: userB.id,
      type: 'calendar_assignment',
      title: 'New event: Pasteurize grain',
      body: 'From notif-a · 2026-04-17',
      linkType: 'calendar_event',
      linkId: 'cev-test-1'
    });
    assert.ok(typeof id === 'number' || typeof id === 'bigint');
  });

  it('createNotification requires userId, type, and title', () => {
    assert.throws(() => db.createNotification(d, { type: 't', title: 'x' }));
    assert.throws(() => db.createNotification(d, { userId: userB.id, title: 'x' }));
    assert.throws(() => db.createNotification(d, { userId: userB.id, type: 't' }));
  });

  it('countUnreadNotifications counts only unread rows for the user', () => {
    assert.equal(db.countUnreadNotifications(d, userB.id), 1);
    assert.equal(db.countUnreadNotifications(d, userA.id), 0);
  });

  it('listNotifications returns newest first', () => {
    db.createNotification(d, {
      userId: userB.id,
      type: 'calendar_assignment',
      title: 'Second event',
      linkType: 'calendar_event',
      linkId: 'cev-test-2'
    });
    const items = db.listNotifications(d, userB.id);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, 'Second event');
    assert.equal(items[0].read, 0);
    assert.equal(items[0].linkId, 'cev-test-2');
    assert.equal(items[0].linkType, 'calendar_event');
  });

  it('markNotificationsRead with null ids marks all unread as read', () => {
    const changed = db.markNotificationsRead(d, userB.id, null);
    assert.equal(changed, 2);
    assert.equal(db.countUnreadNotifications(d, userB.id), 0);
  });

  it('markNotificationsRead with null ids is idempotent when nothing unread', () => {
    const changed = db.markNotificationsRead(d, userB.id, null);
    assert.equal(changed, 0);
  });

  it('markNotificationsRead with specific ids only marks those', () => {
    const id1 = db.createNotification(d, {
      userId: userB.id,
      type: 'calendar_assignment',
      title: 'Third'
    });
    const id2 = db.createNotification(d, {
      userId: userB.id,
      type: 'calendar_assignment',
      title: 'Fourth'
    });
    assert.equal(db.countUnreadNotifications(d, userB.id), 2);
    const changed = db.markNotificationsRead(d, userB.id, [Number(id1)]);
    assert.equal(changed, 1);
    assert.equal(db.countUnreadNotifications(d, userB.id), 1);
    // Cleanup: mark remaining
    db.markNotificationsRead(d, userB.id, [Number(id2)]);
  });

  it('markNotificationsRead is scoped to the user (no cross-user writes)', () => {
    const idA = db.createNotification(d, {
      userId: userA.id,
      type: 'calendar_assignment',
      title: 'For A'
    });
    assert.equal(db.countUnreadNotifications(d, userA.id), 1);
    // userB tries to mark userA's notification as read — should be a no-op
    const changed = db.markNotificationsRead(d, userB.id, [Number(idA)]);
    assert.equal(changed, 0);
    assert.equal(db.countUnreadNotifications(d, userA.id), 1);
  });

  it('deleting a user cascades and removes their notifications', () => {
    db.createUser(d, 'notif-temp', 'password123', 'user');
    const temp = db.getUserByUsername(d, 'notif-temp');
    db.createNotification(d, { userId: temp.id, type: 'test', title: 'bye' });
    assert.equal(db.countUnreadNotifications(d, temp.id), 1);
    db.deleteUser(d, temp.id);
    assert.equal(db.countUnreadNotifications(d, temp.id), 0);
  });
});

describe('db – writeAll/readAll round-trip (I-04)', () => {
  let d, p, strainId;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    // Seed a strain so strain_id resolves cleanly
    strainId = db.createMushroomStrain(d, {
      name: 'Pleurotus ostreatus',
      kuerzel: 'HK35',
      description: 'Test strain'
    });
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('preserves strain_id, strain_text, reason, quality, notes, exception_dates across writeAll', () => {
    // Construct a snapshot containing every field the audit flagged as
    // dropped by writeAll. Round-trip via writeAll(readAll-shape) and verify.
    const snapshot = {
      batches: [
        {
          batchId: 'B-RT-01',
          species: 'Pleurotus ostreatus (HK35)',
          strain: 'XXX',
          strainId: strainId,
          strainText: 'lab-batch-RT-01',
          qty: 5,
          days: 14,
          substrate: { hardwood: 75, wheatbran: 25, rh: 63, gypsum: false },
          bagKg: 3,
          batchType: 'block',
          notes: 'rt test',
          created: '2024-02-01T00:00:00Z',
          due: '2024-02-15T00:00:00Z',
          bags: ['B-RT-01-01', 'B-RT-01-02']
        }
      ],
      cultures: [
        {
          id: 'MC-RT-01',
          type: 'MC',
          species: 'Pleurotus ostreatus',
          strain: 'HK35',
          strainId: strainId,
          strainText: 'lab-culture-RT-01',
          parentId: null,
          status: 'active',
          notes: '',
          created: '2024-02-01T00:00:00Z'
        }
      ],
      scanLog: [
        {
          time: '2024-02-02T00:00:00Z',
          action: 'MOVE',
          batch: 'B-RT-01',
          bag: 'B-RT-01-01',
          from: null,
          to: 'CONTAM',
          species: null,
          strain: null,
          reason: 'contam_trichoderma'
        }
      ],
      harvests: [
        {
          time: '2024-02-10T00:00:00Z',
          batch: 'B-RT-01',
          bag: 'B-RT-01-01',
          species: 'Pleurotus ostreatus',
          strain: 'HK35',
          grams: 250,
          flush: 1,
          quality: 'A',
          notes: 'good flush'
        }
      ],
      calendarEvents: [
        {
          id: 'evt-RT-01',
          title: 'Daily check',
          startDate: '2024-02-01',
          allDay: true,
          category: 'custom',
          recurrence: 'daily',
          recurrenceUntil: '2024-03-01',
          exceptionDates: ['2024-02-10', '2024-02-15'],
          created: '2024-02-01T00:00:00Z'
        }
      ]
    };

    db.writeAll(d, snapshot);
    const out = db.readAll(d);

    // Batch round-trip
    const b = out.batches.find((x) => x.batchId === 'B-RT-01');
    assert.ok(b, 'batch B-RT-01 not found after round-trip');
    assert.equal(b.strainId, strainId);
    assert.equal(b.strainText, 'lab-batch-RT-01');

    // Culture round-trip
    const c = out.cultures.find((x) => x.id === 'MC-RT-01');
    assert.ok(c, 'culture MC-RT-01 not found after round-trip');
    assert.equal(c.strainId, strainId);
    assert.equal(c.strainText, 'lab-culture-RT-01');

    // scan_log round-trip
    const s = out.scanLog.find((x) => x.bag === 'B-RT-01-01' && x.action === 'MOVE');
    assert.ok(s, 'scan-log entry not found after round-trip');
    assert.equal(s.reason, 'contam_trichoderma');

    // Harvest round-trip
    const h = out.harvests.find((x) => x.bag === 'B-RT-01-01');
    assert.ok(h, 'harvest not found after round-trip');
    assert.equal(h.quality, 'A');
    assert.equal(h.notes, 'good flush');

    // Calendar event round-trip
    const e = out.calendarEvents.find((x) => x.id === 'evt-RT-01');
    assert.ok(e, 'calendar event not found after round-trip');
    assert.deepEqual(e.exceptionDates.sort(), ['2024-02-10', '2024-02-15']);
  });
});

// R-10: periodic cleanup helpers — sessions and read notifications
describe('db – cleanupExpiredSessions (R-10)', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    db.createUser(d, 'cleanup_alice', 'password123', 'admin');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('deletes sessions whose expiry is in the past', () => {
    const u = db.getUserByUsername(d, 'cleanup_alice');
    // Insert two sessions: one expired, one fresh
    const expiredToken = require('crypto').randomBytes(32).toString('hex');
    const freshToken = db.createSession(d, u.id);
    d.prepare(
      "INSERT INTO sessions(token, user_id, created, expires) VALUES (?, ?, datetime('now', '-30 days'), datetime('now', '-1 day'))"
    ).run(expiredToken, u.id);
    const before = d.prepare('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?').get(u.id).c;
    assert.ok(before >= 2, 'expected at least 2 sessions before cleanup');
    const removed = db.cleanupExpiredSessions(d);
    assert.ok(removed >= 1, 'expected cleanup to remove the expired session');
    // Fresh session must still exist
    assert.ok(db.getSession(d, freshToken), 'fresh session should survive');
    // Expired token must be gone
    const stillThere = d.prepare('SELECT 1 FROM sessions WHERE token = ?').get(expiredToken);
    assert.equal(stillThere, undefined);
  });

  it('does not delete sessions whose expiry is in the future', () => {
    const u = db.getUserByUsername(d, 'cleanup_alice');
    const t = db.createSession(d, u.id);
    const removed = db.cleanupExpiredSessions(d);
    assert.equal(removed, 0, 'no fresh sessions should be removed');
    assert.ok(db.getSession(d, t));
  });
});

describe('db – cleanupOldNotifications (R-10)', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    db.createUser(d, 'notif_alice', 'password123', 'admin');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('deletes read notifications older than 30 days', () => {
    const u = db.getUserByUsername(d, 'notif_alice');
    const id = db.createNotification(d, { userId: u.id, type: 'test', title: 'old read' });
    // Mark read and back-date
    d.prepare("UPDATE notifications SET read = 1, created = datetime('now', '-60 days') WHERE id = ?").run(id);
    const removed = db.cleanupOldNotifications(d);
    assert.ok(removed >= 1);
    const stillThere = d.prepare('SELECT 1 FROM notifications WHERE id = ?').get(id);
    assert.equal(stillThere, undefined);
  });

  it('does not delete fresh read notifications', () => {
    const u = db.getUserByUsername(d, 'notif_alice');
    const id = db.createNotification(d, { userId: u.id, type: 'test', title: 'recent read' });
    d.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
    const removed = db.cleanupOldNotifications(d);
    assert.equal(removed, 0);
    assert.ok(d.prepare('SELECT 1 FROM notifications WHERE id = ?').get(id));
  });

  it('does not delete unread notifications regardless of age', () => {
    const u = db.getUserByUsername(d, 'notif_alice');
    const id = db.createNotification(d, { userId: u.id, type: 'test', title: 'old unread' });
    d.prepare("UPDATE notifications SET read = 0, created = datetime('now', '-60 days') WHERE id = ?").run(id);
    const removed = db.cleanupOldNotifications(d);
    assert.equal(removed, 0);
    assert.ok(d.prepare('SELECT 1 FROM notifications WHERE id = ?').get(id));
  });
});

// R-16: backup pre-flight disk-space check
describe('db – checkDiskSpace (R-16)', () => {
  it('returns ok=true when sufficient space (or skipped on Windows)', () => {
    const r = db.checkDiskSpace(os.tmpdir(), 1024);
    assert.equal(r.ok, true);
  });

  it('throws when required bytes exceed available (when supported)', () => {
    // On platforms where statfsSync is unsupported, the helper logs and
    // returns ok:true with skipped:true — that's fine. We only assert the
    // throw path on platforms that actually expose statfsSync.
    let supported = false;
    try {
      fs.statfsSync(os.tmpdir());
      supported = true;
    } catch (_) {
      supported = false;
    }
    if (!supported) return;
    assert.throws(() => db.checkDiskSpace(os.tmpdir(), Number.MAX_SAFE_INTEGER), /Insufficient/);
  });
});

// R-23: safeErr classifier — only forward known validator messages, never
// leak SQLite constraint / schema details to the client.
describe('db – isSafeError (R-23)', () => {
  it('rejects SQLITE_CONSTRAINT messages (would leak schema)', () => {
    // The previous regex matched on the substring "constraint" and forwarded
    // these strings — including the table.column — to clients as a 400.
    assert.equal(db.isSafeError('SQLITE_CONSTRAINT: UNIQUE constraint failed: users.username'), false);
    assert.equal(db.isSafeError('UNIQUE constraint failed: batches.id'), false);
    assert.equal(db.isSafeError('SQLITE_CONSTRAINT_FOREIGNKEY: FOREIGN KEY constraint failed'), false);
  });

  it('rejects unrelated runtime errors', () => {
    assert.equal(db.isSafeError('Cannot read properties of undefined'), false);
    assert.equal(db.isSafeError('ENOENT: no such file or directory'), false);
    assert.equal(db.isSafeError(''), false);
    assert.equal(db.isSafeError(null), false);
    assert.equal(db.isSafeError(undefined), false);
  });

  it('accepts known prefix-style validator messages', () => {
    assert.equal(db.isSafeError('Batch not found: B-2026-001'), true);
    assert.equal(db.isSafeError('Culture not found: C-99'), true);
    assert.equal(db.isSafeError('Zone not found: foo'), true);
    assert.equal(db.isSafeError('Rack not found: r-1'), true);
    assert.equal(db.isSafeError('Zone already exists: lab'), true);
    assert.equal(db.isSafeError('Rack already exists: r-1'), true);
    assert.equal(db.isSafeError('A batch with ID "B-001" already exists'), true);
    assert.equal(db.isSafeError('A culture with ID "C-1" already exists'), true);
    assert.equal(db.isSafeError('Unknown zone: foo'), true);
    assert.equal(db.isSafeError('invalid material: foo'), true);
    assert.equal(db.isSafeError('Invalid culture parent: cycle'), true);
    assert.equal(db.isSafeError('Substrate composition must total 100% (got 99.5%)'), true);
    assert.equal(db.isSafeError('Zone has 3 bags — remove them first'), true);
    assert.equal(db.isSafeError('Rack has 1 bags — remove them first'), true);
    assert.equal(db.isSafeError('Zone name cannot be empty'), true);
    assert.equal(db.isSafeError('Zone name too long (max 50 chars)'), true);
    assert.equal(db.isSafeError('Cannot delete: Pilzsorte is still in use (2 batches, 0 cultures).'), true);
    assert.equal(db.isSafeError('photo: too large (max 5 MB)'), true);
    assert.equal(db.isSafeError('photo: payload is not a JPEG'), true);
  });

  it('accepts known bare validator messages', () => {
    assert.equal(db.isSafeError('qty must be >= 1'), true);
    assert.equal(db.isSafeError('days must be >= 1'), true);
    assert.equal(db.isSafeError('grams must be >= 0'), true);
    assert.equal(db.isSafeError('order must be an array'), true);
    assert.equal(db.isSafeError('mat and name are required'), true);
    assert.equal(db.isSafeError('Pilzsorte nicht gefunden'), true);
    assert.equal(db.isSafeError('Culture parent_id must not equal its own id (self-cycle rejected)'), true);
    assert.equal(db.isSafeError('Name ist Pflichtfeld'), true);
    assert.equal(db.isSafeError('Kürzel ist Pflichtfeld'), true);
    assert.equal(db.isSafeError('Kürzel already taken'), true);
  });

  it('rejects bare messages that almost match (no partial match)', () => {
    // Old regex would have accepted these because they contain a hot
    // substring. New allowlist requires exact match for bare messages.
    assert.equal(db.isSafeError('something duplicate happened'), false);
    assert.equal(db.isSafeError('username must be unique constraint'), false);
    assert.equal(db.isSafeError('Pilzsorte gefunden'), false); // wrong message
  });
});
