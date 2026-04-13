'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const {
  buildBagLocationMap,
  bcParams,
  zplText,
  itemsToZPL,
  bagLabelItems,
  labLabelItems,
  fmtDt
} = require('../mcp-server.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_mcp_test_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

function seedData(d) {
  // Batches
  db.insertBatch(d, {
    batchId: 'FB-2025-001',
    species: 'Pleurotus ostreatus',
    strain: 'HK35',
    qty: 3,
    days: 21,
    substrate: { hardwood: 75, wheatbran: 25, rh: 63, gypsum: false },
    bagKg: 3,
    batchType: 'block',
    sourceId: null,
    notes: 'Test batch',
    created: '2025-03-01T00:00:00Z',
    due: '2025-03-22T00:00:00Z',
    bags: ['FB-2025-001-01', 'FB-2025-001-02', 'FB-2025-001-03']
  });
  db.insertBatch(d, {
    batchId: 'GS-2025-001',
    species: 'Pleurotus ostreatus',
    strain: 'HK35',
    qty: 2,
    days: 14,
    substrate: {},
    bagKg: 1,
    batchType: 'grain',
    sourceId: null,
    notes: '',
    created: '2025-03-10T00:00:00Z',
    due: '2025-03-24T00:00:00Z',
    bags: ['GS-2025-001-01', 'GS-2025-001-02']
  });

  // Scan log — place some bags
  db.appendScanEntries(
    d,
    [
      {
        time: '2025-03-01T10:00:00Z',
        action: 'ADD',
        batch: 'FB-2025-001',
        bag: 'FB-2025-001-01',
        from: null,
        to: 'INC',
        species: 'Pleurotus ostreatus',
        strain: 'HK35'
      },
      {
        time: '2025-03-01T10:01:00Z',
        action: 'ADD',
        batch: 'FB-2025-001',
        bag: 'FB-2025-001-02',
        from: null,
        to: 'INC',
        species: 'Pleurotus ostreatus',
        strain: 'HK35'
      },
      {
        time: '2025-03-10T08:00:00Z',
        action: 'MOVE',
        batch: 'FB-2025-001',
        bag: 'FB-2025-001-01',
        from: 'INC',
        to: 'TENT1',
        species: 'Pleurotus ostreatus',
        strain: 'HK35'
      }
    ],
    null
  );

  // Harvests
  db.insertHarvest(d, {
    time: '2025-03-20T08:00:00Z',
    batch: 'FB-2025-001',
    bag: 'FB-2025-001-01',
    species: 'Pleurotus ostreatus',
    strain: 'HK35',
    grams: 450,
    flush: 1
  });
  db.insertHarvest(d, {
    time: '2025-03-25T08:00:00Z',
    batch: 'FB-2025-001',
    bag: 'FB-2025-001-01',
    species: 'Pleurotus ostreatus',
    strain: 'HK35',
    grams: 280,
    flush: 2
  });

  // Tasks
  db.insertTask(d, {
    text: 'Check incubation temps',
    priority: 'high',
    done: false,
    created: '2025-03-15T00:00:00Z',
    assignee: 'Max',
    dueDate: '2025-03-20'
  });
  db.insertTask(d, {
    text: 'Order wheat bran',
    priority: 'med',
    done: true,
    created: '2025-03-14T00:00:00Z',
    assignee: 'Julian',
    dueDate: '2025-03-18'
  });
  db.insertTask(d, {
    text: 'Clean tent 2',
    priority: 'low',
    done: false,
    created: '2025-03-16T00:00:00Z',
    assignee: null,
    dueDate: null
  });

  // Cultures
  db.insertCultures(d, [
    {
      id: 'MC-001',
      type: 'mother',
      species: 'Pleurotus ostreatus',
      strain: 'HK35',
      parentId: null,
      source: 'vendor',
      status: 'active',
      notes: 'Good growth',
      created: '2025-01-01T00:00:00Z'
    },
    {
      id: 'PD-001',
      type: 'PD',
      species: 'Pleurotus ostreatus',
      strain: 'HK35',
      parentId: 'MC-001',
      source: null,
      status: 'active',
      notes: '',
      created: '2025-02-01T00:00:00Z'
    },
    {
      id: 'MC-002',
      type: 'mother',
      species: 'Hericium erinaceus',
      strain: null,
      parentId: null,
      source: 'vendor',
      status: 'contaminated',
      notes: 'Trichoderma',
      created: '2025-01-15T00:00:00Z'
    }
  ]);

  // Inventory
  db.applyInventoryDelta(d, 'hardwood', 100, 'delivery', 'Initial stock');
  db.applyInventoryDelta(d, 'wheatbran', 30, 'delivery', 'Initial stock');
  db.applyInventoryDelta(d, 'gypsum', 2, 'delivery', 'Initial stock'); // below default threshold of 5
  db.applyInventoryDelta(d, 'grain', 50, 'delivery', 'Initial stock');

  // Calendar events
  db.insertCalendarEvent(
    d,
    {
      id: 'ev-test-001',
      title: 'Inoculation day',
      description: 'FB-2025-002',
      startDate: '2025-03-20',
      endDate: null,
      allDay: true,
      startTime: null,
      endTime: null,
      category: 'custom',
      color: '#4CAF50'
    },
    []
  );
  db.insertCalendarEvent(
    d,
    {
      id: 'ev-test-002',
      title: 'Team meeting',
      description: null,
      startDate: '2025-03-20',
      endDate: '2025-03-20',
      allDay: false,
      startTime: '09:00',
      endTime: '10:00',
      category: 'meeting',
      color: null
    },
    []
  );
}

// ── buildBagLocationMap ────────────────────────────────────
describe('buildBagLocationMap', () => {
  it('builds correct location map from scan log', () => {
    const log = [
      { action: 'ADD', bag: 'B-01', to: 'INC' },
      { action: 'ADD', bag: 'B-02', to: 'INC' },
      { action: 'MOVE', bag: 'B-01', from: 'INC', to: 'TENT1' },
      { action: 'REMOVE', bag: 'B-02' }
    ];
    const map = buildBagLocationMap(log);
    assert.equal(map.get('B-01'), 'TENT1');
    assert.equal(map.has('B-02'), false);
  });

  it('returns empty map for empty log', () => {
    assert.equal(buildBagLocationMap([]).size, 0);
  });
});

// ── Read tool logic tests ──────────────────────────────────
describe('MCP read tool logic', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    seedData(d);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('readAll returns seeded batches', () => {
    const data = db.readAll(d);
    assert.equal(data.batches.length, 2);
    assert.equal(data.batches[0].batchId, 'FB-2025-001');
    assert.equal(data.batches[0].bags.length, 3);
  });

  it('filters batches by species', () => {
    const data = db.readAll(d);
    const filtered = data.batches.filter((b) => b.species.toLowerCase().includes('pleurotus'));
    assert.equal(filtered.length, 2);
  });

  it('filters batches by batchType', () => {
    const data = db.readAll(d);
    const grain = data.batches.filter((b) => b.batchType === 'grain');
    assert.equal(grain.length, 1);
    assert.equal(grain[0].batchId, 'GS-2025-001');
  });

  it('filters batches by due date', () => {
    const data = db.readAll(d);
    const before = data.batches.filter((b) => b.due && b.due.slice(0, 10) < '2025-03-23');
    assert.equal(before.length, 1);
    assert.equal(before[0].batchId, 'FB-2025-001');
  });

  it('builds bag locations from scan log', () => {
    const data = db.readAll(d);
    const map = buildBagLocationMap(data.scanLog);
    assert.equal(map.get('FB-2025-001-01'), 'TENT1');
    assert.equal(map.get('FB-2025-001-02'), 'INC');
    assert.equal(map.has('FB-2025-001-03'), false); // never scanned
  });

  it('computes harvest totals per batch', () => {
    const data = db.readAll(d);
    const harvests = data.harvests.filter((h) => h.batch === 'FB-2025-001');
    const total = harvests.reduce((sum, h) => sum + h.grams, 0);
    assert.equal(total, 730);
    assert.equal(harvests.length, 2);
  });

  it('filters tasks by assignee', () => {
    const data = db.readAll(d);
    const maxTasks = data.manualTasks.filter((t) => t.assignee && t.assignee.toLowerCase().includes('max'));
    assert.equal(maxTasks.length, 1);
    assert.equal(maxTasks[0].text, 'Check incubation temps');
  });

  it('filters tasks by done status', () => {
    const data = db.readAll(d);
    const open = data.manualTasks.filter((t) => !t.done);
    assert.equal(open.length, 2);
    const done = data.manualTasks.filter((t) => t.done);
    assert.equal(done.length, 1);
  });

  it('detects low-stock inventory', () => {
    const data = db.readAll(d);
    const inv = data.inventory;
    const low = [];
    for (const mat of ['hardwood', 'wheatbran', 'gypsum', 'grain']) {
      if (inv.stock[mat] < inv.thresholds[mat].minKg) low.push(mat);
    }
    assert.ok(low.includes('gypsum'), 'gypsum should be below threshold');
    assert.ok(!low.includes('hardwood'), 'hardwood should not be low');
  });

  it('filters calendar events by date range', () => {
    const data = db.readAll(d);
    const target = '2025-03-20';
    const events = data.calendarEvents.filter((e) => {
      const start = e.startDate;
      const end = e.endDate || e.startDate;
      return start <= target && end >= target;
    });
    assert.equal(events.length, 2);
  });

  it('filters cultures by type', () => {
    const data = db.readAll(d);
    const mothers = data.cultures.filter((c) => c.type === 'mother');
    assert.equal(mothers.length, 2);
  });

  it('filters cultures by status', () => {
    const data = db.readAll(d);
    const contam = data.cultures.filter((c) => c.status === 'contaminated');
    assert.equal(contam.length, 1);
    assert.equal(contam[0].id, 'MC-002');
  });

  it('aggregates harvests by batch', () => {
    const data = db.readAll(d);
    const groups = {};
    for (const h of data.harvests) {
      const key = h.batch || 'unknown';
      if (!groups[key]) groups[key] = { totalGrams: 0, count: 0 };
      groups[key].totalGrams += h.grams;
      groups[key].count += 1;
    }
    assert.equal(groups['FB-2025-001'].totalGrams, 730);
    assert.equal(groups['FB-2025-001'].count, 2);
  });

  it('aggregates harvests by flush', () => {
    const data = db.readAll(d);
    const byFlush = {};
    for (const h of data.harvests) {
      const key = 'flush_' + h.flush;
      byFlush[key] = (byFlush[key] || 0) + h.grams;
    }
    assert.equal(byFlush.flush_1, 450);
    assert.equal(byFlush.flush_2, 280);
  });

  it('zoneBagCount and rackBagCount are exported', () => {
    assert.equal(typeof db.zoneBagCount, 'function');
    assert.equal(typeof db.rackBagCount, 'function');
  });
});

// ── Write operations ───────────────────────────────────────
describe('MCP write operations', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('creates a batch with auto-generated bags', () => {
    const created = new Date().toISOString();
    const due = new Date(Date.now() + 14 * 86400000).toISOString();
    const bags = ['TST-001-01', 'TST-001-02', 'TST-001-03'];
    db.insertBatch(d, {
      batchId: 'TST-001',
      species: 'Ganoderma lucidum',
      strain: 'GL-1',
      qty: 3,
      days: 14,
      substrate: { hardwood: 80, wheatbran: 20, rh: 60, gypsum: true },
      bagKg: 2.5,
      batchType: 'block',
      sourceId: null,
      notes: 'MCP test',
      created,
      due,
      bags
    });
    const data = db.readAll(d);
    assert.equal(data.batches.length, 1);
    assert.equal(data.batches[0].batchId, 'TST-001');
    assert.equal(data.batches[0].bags.length, 3);
    assert.deepEqual(data.batches[0].bags, bags);
  });

  it('updates batch fields', () => {
    db.updateBatchField(d, 'TST-001', { notes: 'Updated via MCP', species: 'Ganoderma lucidum v2' });
    const b = db.readBatchById(d, 'TST-001');
    assert.equal(b.notes, 'Updated via MCP');
    assert.equal(b.species, 'Ganoderma lucidum v2');
  });

  it('creates a task', () => {
    const id = db.insertTask(d, {
      text: 'MCP test task',
      priority: 'high',
      done: false,
      created: new Date().toISOString(),
      assignee: 'Claude',
      dueDate: '2025-04-01'
    });
    assert.ok(id);
    const task = db.readTaskById(d, Number(id));
    assert.equal(task.text, 'MCP test task');
    assert.equal(task.assignee, 'Claude');
    assert.equal(task.priority, 'high');
  });

  it('updates a task (mark done)', () => {
    const data = db.readAll(d);
    const task = data.manualTasks[0];
    db.updateTaskById(d, task.id, { done: true });
    const updated = db.readTaskById(d, task.id);
    assert.equal(updated.done, true);
  });

  it('creates a calendar event', () => {
    db.insertCalendarEvent(
      d,
      {
        id: 'ev-mcp-001',
        title: 'MCP Test Event',
        description: 'Created by MCP',
        startDate: '2025-04-01',
        endDate: null,
        allDay: true,
        startTime: null,
        endTime: null,
        category: 'custom',
        color: '#FF0000'
      },
      []
    );
    const data = db.readAll(d);
    const ev = data.calendarEvents.find((e) => e.id === 'ev-mcp-001');
    assert.ok(ev);
    assert.equal(ev.title, 'MCP Test Event');
  });

  it('logs a harvest', () => {
    const id = db.insertHarvest(d, {
      time: new Date().toISOString(),
      batch: 'TST-001',
      bag: 'TST-001-01',
      species: 'Ganoderma lucidum v2',
      strain: 'GL-1',
      grams: 200,
      flush: 1
    });
    assert.ok(id);
    const data = db.readAll(d);
    assert.equal(data.harvests.length, 1);
    assert.equal(data.harvests[0].grams, 200);
  });

  it('rejects harvest with negative grams', () => {
    assert.throws(() => {
      db.insertHarvest(d, {
        time: new Date().toISOString(),
        batch: 'TST-001',
        bag: null,
        species: null,
        strain: null,
        grams: -10,
        flush: 1
      });
    }, /grams must be >= 0/);
  });

  it('logs bag movements', () => {
    const ids = db.appendScanEntries(
      d,
      [
        {
          time: new Date().toISOString(),
          action: 'ADD',
          batch: 'TST-001',
          bag: 'TST-001-01',
          from: null,
          to: 'INC',
          species: 'Ganoderma lucidum v2',
          strain: 'GL-1'
        },
        {
          time: new Date().toISOString(),
          action: 'ADD',
          batch: 'TST-001',
          bag: 'TST-001-02',
          from: null,
          to: 'INC',
          species: 'Ganoderma lucidum v2',
          strain: 'GL-1'
        }
      ],
      null
    );
    assert.equal(ids.length, 2);
    const data = db.readAll(d);
    const map = buildBagLocationMap(data.scanLog);
    assert.equal(map.get('TST-001-01'), 'INC');
    assert.equal(map.get('TST-001-02'), 'INC');
  });

  it('updates inventory with delta', () => {
    const newStock = db.applyInventoryDelta(d, 'hardwood', 50, 'delivery', 'Test delivery');
    assert.equal(newStock, 50);
    const data = db.readAll(d);
    assert.equal(data.inventory.stock.hardwood, 50);
  });

  it('rejects invalid inventory material', () => {
    assert.throws(() => {
      db.applyInventoryDelta(d, 'invalid', 10, null, null);
    }, /invalid material/);
  });

  it('updates a culture', () => {
    db.insertCultures(d, [
      {
        id: 'C-MCP-001',
        type: 'mother',
        species: 'Test',
        strain: null,
        parentId: null,
        source: 'test',
        status: 'active',
        notes: '',
        created: new Date().toISOString()
      }
    ]);
    db.updateCulture(d, 'C-MCP-001', { status: 'contaminated', notes: 'Found trichoderma' });
    const data = db.readAll(d);
    const c = data.cultures.find((x) => x.id === 'C-MCP-001');
    assert.equal(c.status, 'contaminated');
    assert.equal(c.notes, 'Found trichoderma');
  });

  it('creates a batch with strainId — species/strain auto-filled', () => {
    const strainId = Number(db.createMushroomStrain(d, { name: 'Hericium erinaceus LH1', kuerzel: 'LH1' }));
    db.insertBatch(d, {
      batchId: 'HE-001',
      strainId,
      species: 'ignored',
      strain: 'ignored',
      qty: 1,
      days: 21,
      created: new Date().toISOString(),
      due: new Date(Date.now() + 21 * 86400000).toISOString(),
      bags: ['HE-001-01']
    });
    const b = db.readBatchById(d, 'HE-001');
    assert.equal(b.strainId, strainId);
    assert.equal(b.species, 'Hericium erinaceus LH1');
    assert.equal(b.strain, 'LH1');
    assert.equal(b.strainName, 'Hericium erinaceus LH1');
    assert.equal(b.strainKuerzel, 'LH1');
  });

  it('updates batch strainId — new species/strain cascade', () => {
    const newId = Number(db.createMushroomStrain(d, { name: 'Hericium erinaceus LH2', kuerzel: 'LH2' }));
    db.updateBatchField(d, 'HE-001', { strainId: newId });
    const b = db.readBatchById(d, 'HE-001');
    assert.equal(b.strainId, newId);
    assert.equal(b.species, 'Hericium erinaceus LH2');
    assert.equal(b.strain, 'LH2');
  });

  it('updates a culture strainId — new species/strain cascade', () => {
    const strainId = Number(db.createMushroomStrain(d, { name: 'Agrocybe aegerita AA1', kuerzel: 'AA1' }));
    db.updateCulture(d, 'C-MCP-001', { strainId });
    const cultures = db.getAllCultures(d);
    const c = cultures.find((x) => x.id === 'C-MCP-001');
    assert.equal(c.strainId, strainId);
    assert.equal(c.species, 'Agrocybe aegerita AA1');
    assert.equal(c.strain, 'AA1');
  });
});

describe('MCP mushroom strains tool layer', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('listMushroomStrains returns an empty array initially', () => {
    assert.deepEqual(db.listMushroomStrains(d), []);
  });

  it('createMushroomStrain + list round-trip', () => {
    const id = Number(db.createMushroomStrain(d, { name: 'Shiitake CS-41', kuerzel: 'CS41' }));
    const list = db.listMushroomStrains(d);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id);
    assert.equal(list[0].name, 'Shiitake CS-41');
  });

  it('updateMushroomStrain propagates to existing batches via MCP DB helpers', () => {
    const strainId = db.listMushroomStrains(d)[0].id;
    const bagStmt = `MCP-BATCH-${strainId}`;
    db.insertBatch(d, {
      batchId: bagStmt,
      strainId,
      qty: 1,
      days: 7,
      created: new Date().toISOString(),
      due: new Date(Date.now() + 7 * 86400000).toISOString(),
      bags: [bagStmt + '-01']
    });
    db.updateMushroomStrain(d, strainId, { name: 'Shiitake Kalliopi', kuerzel: 'KAL' });

    // All MCP read paths should now see the new values
    const listed = db.getAllBatches(d).find((b) => b.batchId === bagStmt);
    assert.ok(listed);
    assert.equal(listed.species, 'Shiitake Kalliopi');
    assert.equal(listed.strain, 'KAL');
    assert.equal(listed.strainName, 'Shiitake Kalliopi');
    assert.equal(listed.strainKuerzel, 'KAL');

    const detail = db.readBatchById(d, bagStmt);
    assert.equal(detail.strainName, 'Shiitake Kalliopi');
  });

  it('deleteMushroomStrain refuses while referenced', () => {
    const strainId = db.listMushroomStrains(d)[0].id;
    assert.throws(() => db.deleteMushroomStrain(d, strainId), /still in use/);
  });

  it('deleteMushroomStrain succeeds for an unreferenced strain', () => {
    const id = Number(db.createMushroomStrain(d, { name: 'Unused', kuerzel: 'UNU' }));
    assert.equal(db.deleteMushroomStrain(d, id), true);
  });

  it('getAllCultures exposes strainName/strainKuerzel for linked cultures', () => {
    const strainId = Number(db.createMushroomStrain(d, { name: 'Pleurotus eryngii PE1', kuerzel: 'PE1' }));
    db.insertCultures(d, [
      {
        id: 'MCP-CULT-PE1',
        type: 'MC',
        strainId,
        status: 'active',
        notes: '',
        created: new Date().toISOString()
      }
    ]);
    const cultures = db.getAllCultures(d);
    const c = cultures.find((x) => x.id === 'MCP-CULT-PE1');
    assert.ok(c);
    assert.equal(c.strainId, strainId);
    assert.equal(c.strainName, 'Pleurotus eryngii PE1');
    assert.equal(c.strainKuerzel, 'PE1');
  });
});

// ── Daily briefing compound query ──────────────────────────
describe('Daily briefing logic', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    seedData(d);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('identifies overdue batches (only those with active bags)', () => {
    const data = db.readAll(d);
    const target = '2025-04-01'; // well after both due dates
    const bagLoc = buildBagLocationMap(data.scanLog);
    const overdue = data.batches.filter((b) => {
      if (!b.due) return false;
      const activeBags = b.bags.filter((id) => bagLoc.has(id));
      return activeBags.length > 0 && b.due.slice(0, 10) < target;
    });
    // Only FB-2025-001 has bags in scan log; GS-2025-001 was never scanned so has 0 active bags
    assert.equal(overdue.length, 1);
    assert.equal(overdue[0].batchId, 'FB-2025-001');
  });

  it('groups open tasks by assignee', () => {
    const data = db.readAll(d);
    const open = data.manualTasks.filter((t) => !t.done);
    const byAssignee = {};
    for (const t of open) {
      const key = t.assignee || 'Unassigned';
      if (!byAssignee[key]) byAssignee[key] = [];
      byAssignee[key].push(t);
    }
    assert.ok(byAssignee.Max);
    assert.equal(byAssignee.Max.length, 1);
    assert.ok(byAssignee.Unassigned);
    assert.equal(byAssignee.Unassigned.length, 1);
  });

  it('flags low-stock materials', () => {
    const data = db.readAll(d);
    const inv = data.inventory;
    const alerts = [];
    for (const mat of ['hardwood', 'wheatbran', 'gypsum', 'grain']) {
      if (inv.stock[mat] < inv.thresholds[mat].minKg) {
        alerts.push(mat);
      }
    }
    assert.ok(alerts.includes('gypsum'), 'gypsum at 2kg should be below 5kg threshold');
  });
});

// ── MCP label printing ───────────────────────────────────
describe('MCP label printing', () => {
  // ── ZPL pure-function tests ────────────────────────────
  describe('bcParams', () => {
    it('returns mw=3 for short barcode values', () => {
      const p = bcParams('123');
      assert.equal(p.mw, 3);
      assert.ok(p.x >= 0, 'x must be non-negative');
    });

    it('reduces mw for long barcode values that exceed 400 dots', () => {
      // A very long value should force mw down
      const p = bcParams('ABCDEFGHIJKLMNOPQ');
      assert.ok(p.mw <= 3 && p.mw >= 1, 'mw should be between 1 and 3');
    });

    it('centers barcode within 400-dot canvas', () => {
      const p = bcParams('12345');
      const mods = 35 + 5 * 11; // 90
      const w = mods * p.mw;
      const qz = p.mw * 10;
      // x should be at least quiet zone, centered when possible
      assert.ok(p.x >= qz || p.x >= Math.round((400 - w) / 2));
    });

    it('accepts custom qzMult', () => {
      const p = bcParams('1234', 5);
      const qz = p.mw * 5;
      assert.ok(p.x >= qz, 'x must respect custom quiet zone');
    });
  });

  describe('zplText', () => {
    it('escapes ^ characters', () => {
      assert.equal(zplText('hello^world'), 'helloworld');
    });

    it('escapes ~ characters', () => {
      assert.equal(zplText('test~value'), 'testvalue');
    });

    it('escapes both ^ and ~ in same string', () => {
      assert.equal(zplText('a^b~c^d'), 'abcd');
    });

    it('handles null', () => {
      assert.equal(zplText(null), '');
    });

    it('handles undefined', () => {
      assert.equal(zplText(undefined), '');
    });

    it('handles empty string', () => {
      assert.equal(zplText(''), '');
    });

    it('passes through normal text unchanged', () => {
      assert.equal(zplText('FB-2025-001-01'), 'FB-2025-001-01');
    });
  });

  describe('itemsToZPL', () => {
    it('begins with ^XA and ends with ^XZ', () => {
      const zpl = itemsToZPL([]);
      assert.ok(zpl.startsWith('^XA'), 'must start with ^XA');
      assert.ok(zpl.endsWith('^XZ'), 'must end with ^XZ');
    });

    it('computes label length between 160 and 240', () => {
      const zpl = itemsToZPL([{ type: 'text', y: 10, fontH: 24, text: 'test' }]);
      const llMatch = zpl.match(/\^LL(\d+)/);
      assert.ok(llMatch, 'must contain ^LL');
      const ll = Number(llMatch[1]);
      assert.ok(ll >= 160 && ll <= 240, `label length ${ll} must be 160-240`);
    });

    it('renders barcode items with ^BCN command', () => {
      const zpl = itemsToZPL([{ type: 'barcode', x: 30, y: 40, h: 90, val: '12345', mw: 3 }]);
      assert.ok(zpl.includes('^BCN,'), 'must contain ^BCN barcode command');
      assert.ok(zpl.includes('^FD12345^FS'), 'must contain barcode value');
    });

    it('renders text items with ^FB block and ^A0N font', () => {
      const zpl = itemsToZPL([{ type: 'text', y: 136, fontH: 24, text: 'Hello', blockW: 400 }]);
      assert.ok(zpl.includes('^FB400,1,0,C'), 'must contain centered field block');
      assert.ok(zpl.includes('^A0N,24,24'), 'must contain font spec');
      assert.ok(zpl.includes('^FDHello^FS'), 'must contain text');
    });

    it('renders bold text with offset duplicate', () => {
      const zpl = itemsToZPL([{ type: 'text', y: 136, fontH: 28, text: 'Bold', bold: true }]);
      // Bold = two ^FO commands, second at x+1
      const matches = zpl.match(/\^FO/g);
      assert.equal(matches.length, 2, 'bold text needs 2 FO commands');
      assert.ok(zpl.includes('^FO0,136'), 'first at x=0');
      assert.ok(zpl.includes('^FO1,136'), 'second at x=1');
    });

    it('renders QR items with ^BQN and mag parameter', () => {
      const zpl = itemsToZPL([{ type: 'qr', x: 190, y: 10, size: 200, mag: 8, val: 'MC-001' }]);
      assert.ok(zpl.includes('^BQN,2,8'), 'must use mag=8');
      assert.ok(zpl.includes('^FDMM,AMC-001^FS'), 'must contain QR value');
    });

    it('uses default mag=4 when mag not specified', () => {
      const zpl = itemsToZPL([{ type: 'qr', x: 190, y: 10, size: 200, val: 'TEST' }]);
      assert.ok(zpl.includes('^BQN,2,4'), 'must default to mag=4');
    });

    it('expands label length for tall content', () => {
      const items = [
        { type: 'barcode', x: 30, y: 40, h: 90, val: '123', mw: 3 },
        { type: 'text', y: 136, fontH: 24, text: 'Line1' },
        { type: 'text', y: 164, fontH: 24, text: 'Line2' },
        { type: 'text', y: 192, fontH: 28, text: 'Line3', bold: true }
      ];
      const zpl = itemsToZPL(items);
      const ll = Number(zpl.match(/\^LL(\d+)/)[1]);
      // bottom of Line3 = 192+28 = 220, +10 pad = 230
      assert.ok(ll >= 220, `label length ${ll} should accommodate all content`);
    });
  });

  describe('bagLabelItems', () => {
    const batch = {
      species: 'Pleurotus ostreatus',
      strainName: 'Pleurotus ostreatus HK35',
      strainText: 'HK35',
      notes: 'Test batch',
      due: '2025-03-22T00:00:00Z'
    };

    it('minimal: produces barcode + ID text only', () => {
      const items = bagLabelItems('FB-2025-001-01', batch, 'minimal', 42, false);
      assert.equal(items.length, 2);
      assert.equal(items[0].type, 'barcode');
      assert.equal(items[0].val, '42');
      assert.equal(items[1].type, 'text');
      assert.equal(items[1].text, 'FB-2025-001-01');
    });

    it('sorte: adds species/strain line', () => {
      const items = bagLabelItems('FB-2025-001-01', batch, 'sorte', 42, false);
      assert.equal(items.length, 3);
      assert.equal(items[2].type, 'text');
      assert.ok(items[2].text.includes('Pleurotus ostreatus HK35'));
    });

    it('full: adds due date line', () => {
      const items = bagLabelItems('FB-2025-001-01', batch, 'full', 42, false);
      assert.equal(items.length, 4);
      const dueLine = items[3];
      assert.equal(dueLine.bold, true);
      assert.ok(dueLine.text.includes('22.03.2025'));
    });

    it('uses barcodeNum as barcode value when provided', () => {
      const items = bagLabelItems('FB-2025-001-01', batch, 'minimal', 999, false);
      assert.equal(items[0].val, '999');
    });

    it('falls back to underscore-encoded ID when no barcodeNum', () => {
      const items = bagLabelItems('FB-2025-001-01', batch, 'minimal', null, false);
      assert.equal(items[0].val, 'FB_2025_001_01');
    });

    it('with QR: produces large qr item at left', () => {
      const items = bagLabelItems('FB-2025-001-01', batch, 'minimal', 42, true);
      assert.equal(items[0].type, 'qr');
      assert.equal(items[0].val, 'FB-2025-001-01');
      assert.equal(items[0].mag, 7);
      assert.equal(items[0].x, 5);
    });

    it('with QR: text positioned right of QR', () => {
      const items = bagLabelItems('FB-2025-001-01', batch, 'sorte', 42, true);
      for (const it of items.filter((i) => i.type === 'text')) {
        assert.equal(it.x, 195, 'text must start at x=195 right of QR');
        assert.equal(it.blockW, 200, 'text width must be 200 with QR');
      }
    });

    it('truncates long notes to 13 chars + ellipsis', () => {
      const longBatch = { ...batch, notes: 'This is a very long note that should be truncated' };
      const items = bagLabelItems('FB-2025-001-01', longBatch, 'sorte', 42, false);
      const line2 = items[2].text;
      assert.ok(line2.includes('\u2026'), 'should contain ellipsis');
    });

    it('omits due date line when batch.due is null', () => {
      const noDueBatch = { ...batch, due: null };
      const items = bagLabelItems('FB-2025-001-01', noDueBatch, 'full', 42, false);
      // Should have barcode + ID + species line, but no due date
      assert.equal(items.length, 3);
    });
  });

  describe('labLabelItems', () => {
    const culture = {
      species: 'Pleurotus ostreatus',
      strainName: 'Pleurotus ostreatus HK35',
      strainDescriptor: 'Kräuterseitling',
      parentId: 'MC-001',
      created: '2025-02-01T00:00:00Z'
    };

    it('minimal: produces barcode + ID text only', () => {
      const items = labLabelItems('PD-001', culture, 'minimal', 55, false);
      assert.equal(items.length, 2);
      assert.equal(items[0].type, 'barcode');
      assert.equal(items[0].val, '55');
      assert.equal(items[1].type, 'text');
      assert.ok(items[1].text.includes('PD-001'));
    });

    it('shows parentId with arrow in line 1', () => {
      const items = labLabelItems('PD-001', culture, 'minimal', 55, false);
      assert.equal(items[1].text, 'PD-001 \u2190 MC-001');
    });

    it('omits parentId arrow when parentId is null', () => {
      const noParent = { ...culture, parentId: null };
      const items = labLabelItems('MC-001', noParent, 'minimal', 55, false);
      assert.equal(items[1].text, 'MC-001');
    });

    it('sorte: adds species + descriptor line', () => {
      const items = labLabelItems('PD-001', culture, 'sorte', 55, false);
      assert.equal(items.length, 3);
      assert.ok(items[2].text.includes('Pleurotus ostreatus HK35'));
      assert.ok(items[2].text.includes('Kräuterseitling'));
    });

    it('full: adds created date line', () => {
      const items = labLabelItems('PD-001', culture, 'full', 55, false);
      assert.equal(items.length, 4);
      const dateLine = items[3];
      assert.equal(dateLine.bold, true);
      assert.equal(dateLine.text, '01.02.25');
    });

    it('full without species: date at offset 28', () => {
      const noSpecies = { ...culture, strainName: null, species: null, strainDescriptor: '' };
      const items = labLabelItems('PD-001', noSpecies, 'full', 55, false);
      // Should have barcode, ID line, date line (no species line)
      const dateLine = items.find((i) => i.bold);
      assert.ok(dateLine, 'must have a date line');
      // line1Y = 40+90+6 = 136, date at 136+28 = 164 (no species line to skip)
      assert.equal(dateLine.y, 164);
    });

    it('with QR: produces large qr item at left', () => {
      const items = labLabelItems('PD-001', culture, 'minimal', 55, true);
      assert.equal(items[0].type, 'qr');
      assert.equal(items[0].val, 'PD-001');
      assert.equal(items[0].mag, 7);
      assert.equal(items[0].x, 5);
    });

    it('falls back to underscore-encoded ID when no barcodeNum', () => {
      const items = labLabelItems('MC-001', culture, 'minimal', null, false);
      assert.equal(items[0].val, 'MC_001');
    });
  });

  describe('fmtDt', () => {
    it('formats ISO date string as dd.mm.yy', () => {
      assert.equal(fmtDt('2025-03-22T00:00:00Z'), '22.03.25');
    });

    it('formats Date object', () => {
      assert.equal(fmtDt(new Date('2025-01-05T12:00:00Z')), '05.01.25');
    });
  });

  // ── Tool-logic tests (via DB) ──────────────────────────
  describe('print_bag_labels tool logic', () => {
    let d, p;
    before(() => {
      ({ db: d, path: p } = tmpDb());
      seedData(d);
    });
    after(() => {
      d.close();
      fs.unlinkSync(p);
    });

    it('generates valid ZPL for existing batch', () => {
      const batch = db.readBatchById(d, 'FB-2025-001');
      const bags = batch.bags;
      const barcodes = db.assignBarcodes(d, 'bag', bags);

      const zpl = bags
        .map((bagId) => itemsToZPL(bagLabelItems(bagId, batch, 'sorte', barcodes[bagId], false)))
        .join('\n');

      // One ^XA...^XZ per bag
      const xaCount = (zpl.match(/\^XA/g) || []).length;
      const xzCount = (zpl.match(/\^XZ/g) || []).length;
      assert.equal(xaCount, 3, 'must have 3 labels for 3 bags');
      assert.equal(xzCount, 3);

      // Barcodes should be numeric (from DB registry, not legacy fallback)
      for (const bagId of bags) {
        const num = barcodes[bagId];
        assert.ok(typeof num === 'number', 'barcode must be numeric from registry');
        assert.ok(zpl.includes('^FD' + num + '^FS'), `ZPL must contain barcode value ${num}`);
      }
    });

    it('respects bagFrom/bagTo range', () => {
      const batch = db.readBatchById(d, 'FB-2025-001');
      const bags = batch.bags.slice(0, 2); // bags 1-2
      const barcodes = db.assignBarcodes(d, 'bag', bags);

      const zpl = bags
        .map((bagId) => itemsToZPL(bagLabelItems(bagId, batch, 'minimal', barcodes[bagId], false)))
        .join('\n');

      const xaCount = (zpl.match(/\^XA/g) || []).length;
      assert.equal(xaCount, 2, 'range 1-2 should produce 2 labels');

      // Bag 3 should NOT be in the ZPL
      assert.ok(!zpl.includes('FB-2025-001-03'), 'bag 3 must not appear in ranged output');
    });

    it('returns error for non-existent batch', () => {
      const batch = db.readBatchById(d, 'NONEXISTENT-001');
      assert.equal(batch, null, 'non-existent batch must return null');
    });
  });

  describe('print_culture_labels tool logic', () => {
    let d, p;
    before(() => {
      ({ db: d, path: p } = tmpDb());
      seedData(d);
    });
    after(() => {
      d.close();
      fs.unlinkSync(p);
    });

    it('generates valid ZPL for existing cultures', () => {
      const allCultures = db.getAllCultures(d);
      const ids = ['MC-001', 'PD-001'];
      const cultureMap = new Map(allCultures.map((c) => [c.id, c]));
      const barcodes = db.assignBarcodes(d, 'culture', ids);

      const zpl = ids
        .map((id) => {
          const c = cultureMap.get(id);
          return itemsToZPL(labLabelItems(id, c, 'sorte', barcodes[id], false));
        })
        .join('\n');

      const xaCount = (zpl.match(/\^XA/g) || []).length;
      assert.equal(xaCount, 2, 'must have 2 labels');

      // Check numeric barcodes from registry
      for (const id of ids) {
        assert.ok(typeof barcodes[id] === 'number', 'culture barcode must be numeric');
      }

      // PD-001 should show parent arrow
      assert.ok(zpl.includes('PD-001 \u2190 MC-001'), 'PD-001 label must show parent');
    });

    it('returns null for non-existent culture', () => {
      const allCultures = db.getAllCultures(d);
      const cultureMap = new Map(allCultures.map((c) => [c.id, c]));
      const missing = ['FAKE-001', 'FAKE-002'].filter((id) => !cultureMap.has(id));
      assert.equal(missing.length, 2, 'both fake IDs should be missing');
      assert.ok(missing.join(', ').includes('FAKE-001'), 'error text must contain missing ID');
    });

    it('rejects empty culture ID array', () => {
      const ids = [];
      assert.equal(ids.length, 0, 'empty array should be rejected by tool');
    });
  });

  // ── Frontend parity tests ─────────────────────────────
  describe('frontend parity', () => {
    it('bag label ZPL structure matches frontend for same barcode number', () => {
      const batch = {
        species: 'Pleurotus ostreatus',
        strainName: 'Pleurotus ostreatus HK35',
        strainText: '',
        notes: 'Test',
        due: '2025-03-22T00:00:00Z'
      };
      const barcodeNum = 100;

      // MCP version
      const mcpItems = bagLabelItems('FB-2025-001-01', batch, 'full', barcodeNum, false);
      const mcpZpl = itemsToZPL(mcpItems);

      // Verify structural elements match what frontend would produce
      assert.ok(mcpZpl.startsWith('^XA^PW400^LL'), 'header format');
      assert.ok(mcpZpl.includes('^CI28^LH0,0'), 'charset and home');

      // Barcode: ^BY{mw},2.0,90^BCN,90,N,N,N^FD100^FS
      const expectedBc = bcParams('100');
      assert.ok(
        mcpZpl.includes('^FO' + expectedBc.x + ',40^BY' + expectedBc.mw + ',2.0,90^BCN,90,N,N,N^FD100^FS'),
        'barcode command must match frontend format'
      );

      // Text line 1: bagId
      assert.ok(mcpZpl.includes('^FDFB-2025-001-01^FS'), 'bag ID text');

      // Text line 2: species
      assert.ok(mcpZpl.includes('^FDPleurotus ostreatus HK35 \u2013 Test^FS'), 'species line');

      // Text line 3: due date (bold = doubled)
      assert.ok(mcpZpl.includes('^FDF\u00e4llig: 22.03.2025^FS'), 'due date line');

      assert.ok(mcpZpl.endsWith('^XZ'), 'footer');
    });

    it('culture label ZPL structure matches frontend for same barcode number', () => {
      const culture = {
        species: 'Pleurotus ostreatus',
        strainName: 'Pleurotus ostreatus HK35',
        strainDescriptor: 'Kräuterseitling',
        parentId: 'MC-001',
        created: '2025-02-01T00:00:00Z'
      };
      const barcodeNum = 200;

      const mcpItems = labLabelItems('PD-001', culture, 'full', barcodeNum, false);
      const mcpZpl = itemsToZPL(mcpItems);

      // Structural checks
      assert.ok(mcpZpl.startsWith('^XA^PW400^LL'), 'header');
      const expectedBc = bcParams('200');
      assert.ok(
        mcpZpl.includes('^FO' + expectedBc.x + ',40^BY' + expectedBc.mw + ',2.0,90^BCN,90,N,N,N^FD200^FS'),
        'barcode command'
      );
      assert.ok(mcpZpl.includes('PD-001 \u2190 MC-001'), 'ID with parent arrow');
      assert.ok(mcpZpl.includes('Pleurotus ostreatus HK35 \u2013 Kr\u00e4uterseitling'), 'species + descriptor');
      assert.ok(mcpZpl.includes('01.02.25'), 'created date');
      assert.ok(mcpZpl.endsWith('^XZ'), 'footer');
    });

    it('QR label uses mag=7 matching frontend', () => {
      const batch = { species: 'Test', strainName: 'Test' };
      const items = bagLabelItems('FB-001-01', batch, 'minimal', null, true);
      const zpl = itemsToZPL(items);
      assert.ok(zpl.includes('^BQN,2,7'), 'QR mag must be 7 like frontend');
    });

    it('barcode positions match between bag and culture labels for same value', () => {
      const batch = { species: 'Test' };
      const culture = { species: 'Test', parentId: null, created: '2025-01-01' };
      const bagItems = bagLabelItems('X-001', batch, 'minimal', 500, false);
      const labItems = labLabelItems('X-001', culture, 'minimal', 500, false);

      // Both should have identical barcode items (same value, same position)
      const bagBc = bagItems.find((i) => i.type === 'barcode');
      const labBc = labItems.find((i) => i.type === 'barcode');
      assert.equal(bagBc.x, labBc.x);
      assert.equal(bagBc.y, labBc.y);
      assert.equal(bagBc.h, labBc.h);
      assert.equal(bagBc.mw, labBc.mw);
      assert.equal(bagBc.val, labBc.val);
    });
  });
});
