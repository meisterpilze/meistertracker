'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { buildBagLocationMap } = require('../mcp-server.js');

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
