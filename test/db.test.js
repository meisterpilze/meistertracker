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

  it('applyInventoryDelta subtracts stock (floor at 0)', () => {
    const val = db.applyInventoryDelta(d, 'hardwood', -200, 'batch', 'B-001');
    assert.equal(val, 0);
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
    const id = db.createMushroomStrain(d, { name: 'Pleurotus ostreatus HK35', kuerzel: 'HK35', description: 'Classic oyster' });
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

  it('createMushroomStrain rejects duplicate name', () => {
    assert.throws(
      () => db.createMushroomStrain(d, { name: 'Pleurotus ostreatus HK35', kuerzel: 'OTHER' }),
      /already taken/
    );
  });

  it('createMushroomStrain rejects duplicate kuerzel', () => {
    assert.throws(
      () => db.createMushroomStrain(d, { name: 'Different name', kuerzel: 'HK35' }),
      /already taken/
    );
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
    assert.equal(b.species, 'Pleurotus ostreatus HK35');
    assert.equal(b.strain, 'HK35');
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
    const list = db.listMushroomStrains(d);
    const strainId = list[0].id;
    assert.throws(() => db.deleteMushroomStrain(d, strainId), /still in use/);
  });

  it('deleteMushroomStrain removes a free strain', () => {
    const freshId = db.createMushroomStrain(d, { name: 'Lentinula edodes CS-41', kuerzel: 'CS41' });
    const ok = db.deleteMushroomStrain(d, Number(freshId));
    assert.equal(ok, true);
    const list = db.listMushroomStrains(d);
    assert.ok(!list.some((s) => s.id === Number(freshId)));
  });
});
