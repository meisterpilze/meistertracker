'use strict';
const path = require('path');
const http = require('http');
const db = require('./db.js');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

// ── Configuration ──────────────────────────────────────────
const DB_FILE = process.env.MT_DB_PATH || path.join(__dirname, 'meistertracker.db');
const NOTIFY_PORT = parseInt(process.env.MT_NOTIFY_PORT || process.env.PORT, 10) || 3000;

let database;

function getDb() {
  if (!database) database = db.openDb(DB_FILE);
  return database;
}

// ── Notify helper ──────────────────────────────────────────
function notifyWebClients() {
  const req = http.request({
    hostname: '127.0.0.1',
    port: NOTIFY_PORT,
    path: '/api/internal/notify',
    method: 'POST',
    headers: { 'Content-Length': 0 }
  });
  req.on('error', () => {}); // silent — web server may not be running
  req.end();
}

// ── Helpers ────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10);
}

function json(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

function errResult(msg) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
}

// Build a map of bagId → current location by replaying scan log
function buildBagLocationMap(scanLog) {
  const map = new Map();
  for (const e of scanLog) {
    if (e.action === 'ADD' && e.to) {
      map.set(e.bag, e.to);
    } else if (e.action === 'MOVE' && e.to) {
      map.set(e.bag, e.to);
    } else if (e.action === 'REMOVE') {
      map.delete(e.bag);
    }
  }
  return map;
}

// ── MCP Server ─────────────────────────────────────────────
const server = new McpServer({
  name: 'meistertracker',
  version: '1.0.0'
});

// ────────────────────────────────────────────────────────────
// READ TOOLS
// ────────────────────────────────────────────────────────────

server.tool(
  'daily_briefing',
  "Get today's briefing: batches due today/overdue, open tasks by assignee, low-stock alerts, and today's calendar events",
  { date: z.string().optional().describe('ISO date (YYYY-MM-DD), defaults to today') },
  async ({ date }) => {
    const d = getDb();
    const data = db.readAll(d, { inventoryLogLimit: 20 });
    const target = date || today();

    // Batches due today or overdue
    const bagLoc = buildBagLocationMap(data.scanLog);
    const dueToday = [];
    const overdue = [];
    for (const b of data.batches) {
      if (!b.due) continue;
      const dueDate = b.due.slice(0, 10);
      // Skip batches where all bags are removed
      const activeBags = b.bags.filter((id) => bagLoc.has(id));
      if (activeBags.length === 0) continue;
      if (dueDate === target)
        dueToday.push({
          batchId: b.batchId,
          species: b.species,
          strain: b.strain,
          due: b.due,
          activeBags: activeBags.length,
          totalBags: b.bags.length
        });
      else if (dueDate < target)
        overdue.push({
          batchId: b.batchId,
          species: b.species,
          strain: b.strain,
          due: b.due,
          activeBags: activeBags.length,
          totalBags: b.bags.length
        });
    }

    // Open tasks grouped by assignee
    const openTasks = data.manualTasks.filter((t) => !t.done);
    const tasksByAssignee = {};
    for (const t of openTasks) {
      const key = t.assignee || 'Unassigned';
      if (!tasksByAssignee[key]) tasksByAssignee[key] = [];
      tasksByAssignee[key].push({ id: t.id, text: t.text, priority: t.priority, dueDate: t.dueDate });
    }

    // Low-stock alerts
    const inv = data.inventory;
    const lowStock = [];
    for (const mat of ['hardwood', 'wheatbran', 'gypsum', 'grain']) {
      const stock = inv.stock[mat];
      const threshold = inv.thresholds[mat].minKg;
      if (stock < threshold) lowStock.push({ material: mat, stockKg: stock, thresholdKg: threshold });
    }

    // Calendar events for today
    const todayEvents = data.calendarEvents.filter((e) => {
      const start = e.startDate;
      const end = e.endDate || e.startDate;
      return start <= target && end >= target;
    });

    return json({
      date: target,
      batchesDueToday: dueToday,
      batchesOverdue: overdue,
      openTaskCount: openTasks.length,
      tasksByAssignee,
      lowStockAlerts: lowStock,
      calendarEvents: todayEvents.map((e) => ({
        id: e.id,
        title: e.title,
        startDate: e.startDate,
        endDate: e.endDate,
        allDay: e.allDay,
        startTime: e.startTime,
        endTime: e.endTime,
        category: e.category,
        assignees: e.assignees
      }))
    });
  }
);

server.tool(
  'list_batches',
  'List production batches with optional filters for species, strain, batch type, or date range',
  {
    species: z.string().optional().describe('Filter by species (partial match, case-insensitive)'),
    strain: z.string().optional().describe('Filter by strain (partial match, case-insensitive)'),
    batchType: z.enum(['block', 'grain', 'liquid']).optional().describe('Filter by batch type'),
    dueBefore: z.string().optional().describe('ISO date — batches due before this date'),
    dueAfter: z.string().optional().describe('ISO date — batches due after this date')
  },
  async (params) => {
    const data = db.readAll(getDb());
    let batches = data.batches;

    if (params.species) {
      const s = params.species.toLowerCase();
      batches = batches.filter((b) => b.species && b.species.toLowerCase().includes(s));
    }
    if (params.strain) {
      const s = params.strain.toLowerCase();
      batches = batches.filter((b) => b.strain && b.strain.toLowerCase().includes(s));
    }
    if (params.batchType) batches = batches.filter((b) => b.batchType === params.batchType);
    if (params.dueBefore) batches = batches.filter((b) => b.due && b.due.slice(0, 10) < params.dueBefore);
    if (params.dueAfter) batches = batches.filter((b) => b.due && b.due.slice(0, 10) > params.dueAfter);

    return json(
      batches.map((b) => ({
        batchId: b.batchId,
        species: b.species,
        strain: b.strain,
        qty: b.qty,
        days: b.days,
        batchType: b.batchType,
        created: b.created,
        due: b.due,
        bagCount: b.bags.length,
        notes: b.notes
      }))
    );
  }
);

server.tool(
  'get_batch_details',
  'Get full details for a single batch including bags, scan history, harvest totals, and current bag locations',
  { batchId: z.string().describe('Batch ID') },
  async ({ batchId }) => {
    const d = getDb();
    const data = db.readAll(d);
    const batch = data.batches.find((b) => b.batchId === batchId);
    if (!batch) return errResult('Batch not found: ' + batchId);

    const bagLoc = buildBagLocationMap(data.scanLog);
    const scans = data.scanLog.filter((e) => e.batch === batchId);
    const harvests = data.harvests.filter((h) => h.batch === batchId);

    const totalGrams = harvests.reduce((sum, h) => sum + h.grams, 0);
    const byFlush = {};
    for (const h of harvests) {
      const key = 'flush_' + h.flush;
      byFlush[key] = (byFlush[key] || 0) + h.grams;
    }

    const bags = batch.bags.map((id) => ({
      bagId: id,
      currentLocation: bagLoc.get(id) || null,
      harvests: harvests.filter((h) => h.bag === id).map((h) => ({ grams: h.grams, flush: h.flush, time: h.time }))
    }));

    return json({
      ...batch,
      bags,
      scanHistory: scans.slice(-50),
      harvestSummary: { totalGrams, harvestCount: harvests.length, byFlush }
    });
  }
);

server.tool(
  'get_zone_overview',
  'Get all zones with rack counts, current bag counts, and capacity utilization',
  {},
  async () => {
    const d = getDb();
    const data = db.readAll(d);

    const zones = data.zones.map((z) => {
      const bagCount = db.zoneBagCount(d, z.id);
      const racks = z.racks.map((r) => ({
        id: r.id,
        bagCount: db.rackBagCount(d, r.id)
      }));
      return {
        id: z.id,
        name: z.name,
        role: z.role,
        color: z.color,
        maxCapacity: z.maxCapacity,
        bagCount,
        capacityPct: z.maxCapacity ? Math.round((bagCount / z.maxCapacity) * 100) : null,
        racks
      };
    });

    return json(zones);
  }
);

server.tool(
  'get_inventory_status',
  'Get current substrate inventory levels, thresholds, and low-stock alerts',
  {},
  async () => {
    const data = db.readAll(getDb(), { inventoryLogLimit: 20 });
    const inv = data.inventory;
    const alerts = [];
    for (const mat of ['hardwood', 'wheatbran', 'gypsum', 'grain']) {
      if (inv.stock[mat] < inv.thresholds[mat].minKg) {
        alerts.push({ material: mat, stockKg: inv.stock[mat], thresholdKg: inv.thresholds[mat].minKg });
      }
    }
    return json({
      stock: inv.stock,
      thresholds: inv.thresholds,
      avgComposition: inv.avgComposition,
      alerts,
      recentLog: inv.log
    });
  }
);

server.tool(
  'get_tasks',
  'List tasks with optional filters for assignee, priority, completion status, or date range',
  {
    assignee: z.string().optional().describe('Filter by assignee name'),
    priority: z.enum(['low', 'med', 'high']).optional().describe('Filter by priority'),
    done: z.boolean().optional().describe('true=completed, false=open'),
    dueBefore: z.string().optional().describe('ISO date — tasks due before this date'),
    dueAfter: z.string().optional().describe('ISO date — tasks due after this date')
  },
  async (params) => {
    const data = db.readAll(getDb());
    let tasks = data.manualTasks;

    if (params.assignee) {
      const a = params.assignee.toLowerCase();
      tasks = tasks.filter((t) => t.assignee && t.assignee.toLowerCase().includes(a));
    }
    if (params.priority) tasks = tasks.filter((t) => t.priority === params.priority);
    if (params.done !== undefined) tasks = tasks.filter((t) => t.done === params.done);
    if (params.dueBefore) tasks = tasks.filter((t) => t.dueDate && t.dueDate < params.dueBefore);
    if (params.dueAfter) tasks = tasks.filter((t) => t.dueDate && t.dueDate > params.dueAfter);

    return json(
      tasks.map((t) => ({
        id: t.id,
        text: t.text,
        priority: t.priority,
        done: t.done,
        assignee: t.assignee,
        dueDate: t.dueDate,
        description: t.description,
        created: t.created
      }))
    );
  }
);

server.tool(
  'get_calendar_events',
  'Get calendar events within a date range, optionally filtered by category',
  {
    startDate: z.string().optional().describe('ISO date — start of range (default: today)'),
    endDate: z.string().optional().describe('ISO date — end of range (default: 30 days from start)'),
    category: z.string().optional().describe('Filter by event category')
  },
  async (params) => {
    const data = db.readAll(getDb());
    const start = params.startDate || today();
    const end = params.endDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    let events = data.calendarEvents.filter((e) => {
      const eStart = e.startDate;
      const eEnd = e.endDate || e.startDate;
      return eEnd >= start && eStart <= end;
    });

    if (params.category) events = events.filter((e) => e.category === params.category);

    return json(
      events.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        startDate: e.startDate,
        endDate: e.endDate,
        allDay: e.allDay,
        startTime: e.startTime,
        endTime: e.endTime,
        category: e.category,
        color: e.color,
        assignees: e.assignees
      }))
    );
  }
);

server.tool(
  'list_cultures',
  'List mushroom cultures with optional filters for type, species, or status',
  {
    type: z.string().optional().describe('Culture type (e.g. mother, PD, LC)'),
    species: z.string().optional().describe('Filter by species (partial match)'),
    status: z.string().optional().describe('Filter by status (e.g. active, archived, contaminated)')
  },
  async (params) => {
    const data = db.readAll(getDb());
    let cultures = data.cultures;

    if (params.type) cultures = cultures.filter((c) => c.type === params.type);
    if (params.species) {
      const s = params.species.toLowerCase();
      cultures = cultures.filter((c) => c.species && c.species.toLowerCase().includes(s));
    }
    if (params.status) cultures = cultures.filter((c) => c.status === params.status);

    return json(cultures);
  }
);

server.tool(
  'get_harvest_report',
  'Get harvest data aggregated by batch, species, or month with totals and per-flush breakdowns',
  {
    groupBy: z.enum(['batch', 'species', 'month']).optional().describe('Aggregation dimension (default: batch)'),
    batchId: z.string().optional().describe('Filter to a specific batch'),
    species: z.string().optional().describe('Filter by species'),
    startDate: z.string().optional().describe('ISO date — harvests after this date'),
    endDate: z.string().optional().describe('ISO date — harvests before this date')
  },
  async (params) => {
    const data = db.readAll(getDb());
    let harvests = data.harvests;

    if (params.batchId) harvests = harvests.filter((h) => h.batch === params.batchId);
    if (params.species) {
      const s = params.species.toLowerCase();
      harvests = harvests.filter((h) => h.species && h.species.toLowerCase().includes(s));
    }
    if (params.startDate) harvests = harvests.filter((h) => h.time && h.time.slice(0, 10) >= params.startDate);
    if (params.endDate) harvests = harvests.filter((h) => h.time && h.time.slice(0, 10) <= params.endDate);

    const groupBy = params.groupBy || 'batch';
    const groups = {};
    for (const h of harvests) {
      let key;
      if (groupBy === 'batch') key = h.batch || 'unknown';
      else if (groupBy === 'species') key = h.species || 'unknown';
      else key = h.time ? h.time.slice(0, 7) : 'unknown'; // month: YYYY-MM

      if (!groups[key]) groups[key] = { totalGrams: 0, count: 0, byFlush: {} };
      groups[key].totalGrams += h.grams;
      groups[key].count += 1;
      const fKey = 'flush_' + h.flush;
      groups[key].byFlush[fKey] = (groups[key].byFlush[fKey] || 0) + h.grams;
    }

    return json({
      groupBy,
      totalHarvests: harvests.length,
      totalGrams: harvests.reduce((s, h) => s + h.grams, 0),
      groups
    });
  }
);

server.tool(
  'get_scan_log',
  'Get recent scan log entries (bag movements), optionally filtered by batch, bag, action, or date',
  {
    batchId: z.string().optional().describe('Filter by batch ID'),
    bagId: z.string().optional().describe('Filter by bag ID'),
    action: z.enum(['ADD', 'MOVE', 'REMOVE']).optional().describe('Filter by action type'),
    limit: z.number().optional().describe('Max entries to return (default: 50, max: 500)'),
    startDate: z.string().optional().describe('ISO date — entries after this date'),
    endDate: z.string().optional().describe('ISO date — entries before this date')
  },
  async (params) => {
    const data = db.readAll(getDb());
    let log = data.scanLog;

    if (params.batchId) log = log.filter((e) => e.batch === params.batchId);
    if (params.bagId) log = log.filter((e) => e.bag === params.bagId);
    if (params.action) log = log.filter((e) => e.action === params.action);
    if (params.startDate) log = log.filter((e) => e.time && e.time.slice(0, 10) >= params.startDate);
    if (params.endDate) log = log.filter((e) => e.time && e.time.slice(0, 10) <= params.endDate);

    const limit = Math.min(params.limit || 50, 500);
    log = log.slice(-limit);

    return json(log);
  }
);

// ────────────────────────────────────────────────────────────
// WRITE TOOLS
// ────────────────────────────────────────────────────────────

server.tool(
  'create_batch',
  'Create a new production batch with auto-generated bags',
  {
    batchId: z.string().describe('Batch ID (e.g. FB-2025-042)'),
    species: z.string().describe('Mushroom species'),
    qty: z.number().describe('Number of bags (>= 1)'),
    days: z.number().describe('Incubation days (>= 1)'),
    strain: z.string().optional().describe('Strain name'),
    subHardwood: z.number().optional().describe('Substrate hardwood %'),
    subWheatbran: z.number().optional().describe('Substrate wheat bran %'),
    subRh: z.number().optional().describe('Substrate relative humidity %'),
    subGypsum: z.boolean().optional().describe('Include gypsum?'),
    bagKg: z.number().optional().describe('Bag weight in kg (default: 3)'),
    batchType: z.enum(['block', 'grain', 'liquid']).optional().describe('Batch type (default: block)'),
    sourceId: z.string().optional().describe('Source culture ID'),
    notes: z.string().optional().describe('Notes')
  },
  async (params) => {
    try {
      const d = getDb();
      const created = new Date().toISOString();
      const due = new Date(Date.now() + params.days * 86400000).toISOString();
      const bags = [];
      for (let i = 1; i <= params.qty; i++) {
        bags.push(params.batchId + '-' + String(i).padStart(2, '0'));
      }
      db.insertBatch(d, {
        batchId: params.batchId,
        species: params.species,
        strain: params.strain || null,
        qty: params.qty,
        days: params.days,
        substrate: {
          hardwood: params.subHardwood || 0,
          wheatbran: params.subWheatbran || 0,
          rh: params.subRh || 0,
          gypsum: params.subGypsum || false
        },
        bagKg: params.bagKg || 3,
        batchType: params.batchType || 'block',
        sourceId: params.sourceId || null,
        notes: params.notes || '',
        created,
        due,
        bags
      });
      notifyWebClients();
      return json({ success: true, batchId: params.batchId, created, due, bagCount: params.qty, bags });
    } catch (e) {
      return errResult(e.message);
    }
  }
);

server.tool(
  'update_batch',
  'Update fields on an existing batch (notes, species, strain, qty, days, due date)',
  {
    batchId: z.string().describe('Batch ID'),
    notes: z.string().optional(),
    species: z.string().optional(),
    strain: z.string().optional(),
    qty: z.number().optional(),
    days: z.number().optional(),
    due: z.string().optional().describe('ISO date')
  },
  async (params) => {
    try {
      const d = getDb();
      const { batchId, ...fields } = params;
      const updates = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) updates[k] = v;
      }
      if (!Object.keys(updates).length) return errResult('No fields to update');
      db.updateBatchField(d, batchId, updates);
      notifyWebClients();
      return json({ success: true, batchId, updated: Object.keys(updates) });
    } catch (e) {
      return errResult(e.message);
    }
  }
);

server.tool(
  'create_task',
  'Create a new task for the team',
  {
    text: z.string().describe('Task description'),
    priority: z.enum(['low', 'med', 'high']).optional().describe('Priority (default: med)'),
    assignee: z.string().optional().describe('Assignee name'),
    dueDate: z.string().optional().describe('ISO date for due date'),
    description: z.string().optional().describe('Additional details')
  },
  async (params) => {
    try {
      const d = getDb();
      const id = db.insertTask(d, {
        text: params.text,
        priority: params.priority || 'med',
        done: false,
        created: new Date().toISOString(),
        assignee: params.assignee || null,
        dueDate: params.dueDate || null,
        description: params.description || null
      });
      notifyWebClients();
      return json({ success: true, id: Number(id), text: params.text, assignee: params.assignee || null });
    } catch (e) {
      return errResult(e.message);
    }
  }
);

server.tool(
  'update_task',
  'Update a task — change text, priority, assignee, due date, description, or mark as done/undone',
  {
    id: z.number().describe('Task ID'),
    text: z.string().optional(),
    priority: z.enum(['low', 'med', 'high']).optional(),
    done: z.boolean().optional().describe('Mark as done (true) or reopen (false)'),
    assignee: z.string().optional(),
    dueDate: z.string().optional().describe('ISO date'),
    description: z.string().optional()
  },
  async (params) => {
    try {
      const d = getDb();
      const { id, ...fields } = params;
      const updates = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) updates[k] = v;
      }
      if (!Object.keys(updates).length) return errResult('No fields to update');
      db.updateTaskById(d, id, updates);
      notifyWebClients();
      return json({ success: true, id, updated: Object.keys(updates) });
    } catch (e) {
      return errResult(e.message);
    }
  }
);

server.tool(
  'create_calendar_event',
  'Create a calendar event (e.g. inoculation day, harvest window, team meeting)',
  {
    title: z.string().describe('Event title'),
    startDate: z.string().describe('ISO date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('ISO date (YYYY-MM-DD)'),
    allDay: z.boolean().optional().describe('All-day event (default: true)'),
    startTime: z.string().optional().describe('Start time (HH:MM)'),
    endTime: z.string().optional().describe('End time (HH:MM)'),
    category: z.string().optional().describe('Event category (default: custom)'),
    color: z.string().optional().describe('Hex color (e.g. #4CAF50)'),
    description: z.string().optional(),
    assigneeIds: z.array(z.number()).optional().describe('Array of user IDs to assign')
  },
  async (params) => {
    try {
      const d = getDb();
      const id = 'ev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      db.insertCalendarEvent(
        d,
        {
          id,
          title: params.title,
          description: params.description || null,
          startDate: params.startDate,
          endDate: params.endDate || null,
          allDay: params.allDay !== false,
          startTime: params.startTime || null,
          endTime: params.endTime || null,
          category: params.category || 'custom',
          color: params.color || null
        },
        params.assigneeIds || []
      );
      notifyWebClients();
      return json({ success: true, id, title: params.title, startDate: params.startDate });
    } catch (e) {
      return errResult(e.message);
    }
  }
);

server.tool(
  'log_harvest',
  'Record a mushroom harvest with weight, batch, bag, and flush number',
  {
    batch: z.string().describe('Batch ID'),
    grams: z.number().describe('Harvest weight in grams (>= 0)'),
    bag: z.string().optional().describe('Specific bag ID'),
    flush: z.number().optional().describe('Flush number (default: 1)'),
    species: z.string().optional().describe('Auto-filled from batch if omitted'),
    strain: z.string().optional().describe('Auto-filled from batch if omitted')
  },
  async (params) => {
    try {
      const d = getDb();
      let species = params.species;
      let strain = params.strain;
      if (!species || !strain) {
        const b = db.readBatchById(d, params.batch);
        if (b) {
          species = species || b.species;
          strain = strain || b.strain;
        }
      }
      const id = db.insertHarvest(d, {
        time: new Date().toISOString(),
        batch: params.batch,
        bag: params.bag || null,
        species: species || null,
        strain: strain || null,
        grams: params.grams,
        flush: params.flush || 1
      });
      notifyWebClients();
      return json({
        success: true,
        id: Number(id),
        batch: params.batch,
        grams: params.grams,
        flush: params.flush || 1
      });
    } catch (e) {
      return errResult(e.message);
    }
  }
);

server.tool(
  'move_bags',
  'Log bag movement(s) between zones/racks. Supports ADD (place bag), MOVE (relocate), and REMOVE (discard)',
  {
    entries: z
      .array(
        z.object({
          batch: z.string().describe('Batch ID'),
          bag: z.string().describe('Bag ID'),
          action: z.enum(['ADD', 'MOVE', 'REMOVE']).describe('Movement type'),
          from: z.string().optional().describe('Source zone/rack (required for MOVE/REMOVE)'),
          to: z.string().optional().describe('Destination zone/rack (required for ADD/MOVE)')
        })
      )
      .describe('Array of bag movements')
  },
  async ({ entries }) => {
    try {
      const d = getDb();
      const now = new Date().toISOString();
      const enriched = entries.map((e) => {
        const b = db.readBatchById(d, e.batch);
        return {
          time: now,
          action: e.action,
          batch: e.batch,
          bag: e.bag,
          from: e.from || null,
          to: e.to || null,
          species: b ? b.species : null,
          strain: b ? b.strain : null
        };
      });
      const ids = db.appendScanEntries(d, enriched, null);
      notifyWebClients();
      return json({ success: true, count: entries.length, ids: ids.map(Number) });
    } catch (e) {
      return errResult(e.message);
    }
  }
);

server.tool(
  'update_inventory',
  'Log a substrate inventory change (delivery, usage, correction). Materials: hardwood, wheatbran, gypsum, grain',
  {
    material: z.enum(['hardwood', 'wheatbran', 'gypsum', 'grain']).describe('Material type'),
    deltaKg: z.number().describe('Change in kg (positive for delivery, negative for usage)'),
    type: z.string().optional().describe('Transaction type (e.g. delivery, batch, correction)'),
    ref: z.string().optional().describe('Reference note (e.g. supplier name, batch ID)')
  },
  async (params) => {
    try {
      const d = getDb();
      const newStock = db.applyInventoryDelta(
        d,
        params.material,
        params.deltaKg,
        params.type || null,
        params.ref || null
      );
      notifyWebClients();
      return json({ success: true, material: params.material, deltaKg: params.deltaKg, newStockKg: newStock });
    } catch (e) {
      return errResult(e.message);
    }
  }
);

server.tool(
  'update_culture',
  "Update a mushroom culture's status, notes, species, strain, or source",
  {
    id: z.string().describe('Culture ID'),
    status: z.string().optional().describe('New status (e.g. active, archived, contaminated)'),
    notes: z.string().optional(),
    species: z.string().optional(),
    strain: z.string().optional(),
    source: z.string().optional()
  },
  async (params) => {
    try {
      const d = getDb();
      const { id, ...fields } = params;
      const updates = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) updates[k] = v;
      }
      if (!Object.keys(updates).length) return errResult('No fields to update');
      db.updateCulture(d, id, updates);
      notifyWebClients();
      return json({ success: true, id, updated: Object.keys(updates) });
    } catch (e) {
      return errResult(e.message);
    }
  }
);

// ── Start ──────────────────────────────────────────────────
async function main() {
  getDb(); // initialize database connection
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Export for testing
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write('MCP server failed to start: ' + err.message + '\n');
    process.exit(1);
  });
}

module.exports = { getDb, notifyWebClients, buildBagLocationMap, server };
