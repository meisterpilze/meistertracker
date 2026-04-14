'use strict';
const db = require('./db.js');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');

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

// ── ZPL Label Generation ─────────────────────────────────
// Ported from app.js — server-side copy so MCP tools can generate labels
// without a browser. Canvas is 400×240 dots (50×30mm @ 203dpi).

function bcParams(val, qzMult) {
  const mods = 35 + val.length * 11;
  let mw = 3;
  qzMult = qzMult || 10;
  const qz = (m) => m * qzMult;
  while (mw > 1 && mods * mw + 2 * qz(mw) > 400) mw--;
  const w = mods * mw;
  return { mw, x: Math.max(qz(mw), Math.round((400 - w) / 2)) };
}

function zplText(s) {
  return String(s || '').replace(/[\^~]/g, '');
}

function fmtDt(d) {
  if (!(d instanceof Date)) d = new Date(d);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return dd + '.' + mm + '.' + yy;
}

function itemsToZPL(items) {
  // Fixed label size: 400×240 dots (50×30mm @ 203dpi).
  // ^LT0/^LS0 reset stored offsets, ^PON/^FWN force normal orientation.
  let z = '^XA^PW400^LL240^CI28^LH0,0^LT0^LS0^PON^FWN';
  for (const it of items) {
    if (it.type === 'barcode') {
      z +=
        '^FO' +
        it.x +
        ',' +
        it.y +
        '^BY' +
        it.mw +
        ',2.0,' +
        it.h +
        '^BCN,' +
        it.h +
        ',N,N,N^FD' +
        zplText(it.val) +
        '^FS';
    } else if (it.type === 'text') {
      const fw = it.fontW || it.fontH;
      const bw = it.blockW || 400;
      const bx = it.x || 0;
      z +=
        '^FO' + bx + ',' + it.y + '^FB' + bw + ',1,0,C^A0N,' + it.fontH + ',' + fw + '^FD' + zplText(it.text) + '^FS';
      if (it.bold) {
        z +=
          '^FO' +
          (bx + 1) +
          ',' +
          it.y +
          '^FB' +
          bw +
          ',1,0,C^A0N,' +
          it.fontH +
          ',' +
          fw +
          '^FD' +
          zplText(it.text) +
          '^FS';
      }
    } else if (it.type === 'qr') {
      // Reset label home immediately before QR to ensure ^FO works from true origin.
      z += '^LH0,0^FO' + it.x + ',' + it.y + '^BQN,2,' + (it.mag || 4) + '^FDMA,' + zplText(it.val) + '^FS';
    }
  }
  return z + '^XZ';
}

function bagLabelItems(bagId, batch, detail, barcodeNum, qr, bagKg) {
  const items = [];
  const bcVal = barcodeNum ? String(barcodeNum) : bagId.replace(/-/g, '_');
  if (qr) {
    items.push({ type: 'qr', x: 0, y: 10, size: 125, mag: 5, val: bcVal });
    items.push({ type: 'text', y: 155, blockW: 400, fontH: 28, text: bagId });
    if (detail === 'sorte' || detail === 'full') {
      const species = batch.strainName || batch.species || '';
      const strainTxt = (batch.strainText || '').trim();
      const rawNotes = (batch.notes || '').trim();
      const notes = rawNotes.length > 13 ? rawNotes.slice(0, 13) + '\u2026' : rawNotes;
      const parts = [species];
      if (bagKg != null) parts.push(bagKg + 'kg');
      if (strainTxt) parts.push(strainTxt);
      if (notes) parts.push(notes);
      const line2 = parts.join(' \u2013 ');
      if (line2) items.push({ type: 'text', y: 185, blockW: 400, fontH: 24, text: line2 });
    }
    if (detail === 'full' && batch.due) {
      const due = new Date(batch.due);
      const dueStr =
        String(due.getDate()).padStart(2, '0') +
        '.' +
        String(due.getMonth() + 1).padStart(2, '0') +
        '.' +
        due.getFullYear();
      items.push({
        type: 'text',
        y: 215,
        blockW: 400,
        fontH: 24,
        text: 'F\u00e4llig: ' + dueStr,
        bold: true
      });
    }
  } else {
    const bcY = 40,
      bcH = 90;
    const bc = bcParams(bcVal);
    items.push({ type: 'barcode', x: bc.x, y: bcY, w: 400 - 2 * bc.x, h: bcH, val: bcVal, mw: bc.mw });
    const line1Y = bcY + bcH + 6;
    items.push({ type: 'text', y: line1Y, blockW: 400, fontH: 24, text: bagId });
    if (detail === 'sorte' || detail === 'full') {
      const species = batch.strainName || batch.species || '';
      const strainTxt = (batch.strainText || '').trim();
      const rawNotes = (batch.notes || '').trim();
      const notes = rawNotes.length > 13 ? rawNotes.slice(0, 13) + '\u2026' : rawNotes;
      const parts = [species];
      if (bagKg != null) parts.push(bagKg + 'kg');
      if (strainTxt) parts.push(strainTxt);
      if (notes) parts.push(notes);
      const line2 = parts.join(' \u2013 ');
      if (line2) items.push({ type: 'text', y: line1Y + 28, blockW: 400, fontH: 24, text: line2 });
    }
    if (detail === 'full' && batch.due) {
      const due = new Date(batch.due);
      const dueStr =
        String(due.getDate()).padStart(2, '0') +
        '.' +
        String(due.getMonth() + 1).padStart(2, '0') +
        '.' +
        due.getFullYear();
      items.push({ type: 'text', y: line1Y + 56, fontH: 28, text: 'F\u00e4llig: ' + dueStr, bold: true });
    }
  }
  return items;
}

function labLabelItems(id, c, detail, barcodeNum, qr) {
  const items = [];
  // Build info line matching batch label pattern: strainName – strainText – notes(13)
  const species = c.strainName || c.species || '';
  const strainTxt = (c.strainText || '').trim();
  const rawNotes = (c.notes || '').trim();
  const notes = rawNotes.length > 13 ? rawNotes.slice(0, 13) + '\u2026' : rawNotes;
  const spParts = [species];
  if (strainTxt) spParts.push(strainTxt);
  if (notes) spParts.push(notes);
  const sp = spParts.join(' \u2013 ');
  const bcVal = barcodeNum ? String(barcodeNum) : id.replace(/-/g, '_');
  if (qr) {
    // QR mode: QR top-left, text centered full-width below.
    items.push({ type: 'qr', x: 0, y: 10, size: 125, mag: 5, val: bcVal });
    const line1Text = c.parentId ? id + ' \u2190 ' + c.parentId : id;
    items.push({ type: 'text', y: 155, blockW: 400, fontH: 28, text: line1Text });
    if (detail === 'sorte' || detail === 'full') {
      if (sp) items.push({ type: 'text', y: 185, blockW: 400, fontH: 24, text: sp });
    }
    if (detail === 'full' && c.created) {
      const line3Y = sp ? 215 : 185;
      items.push({
        type: 'text',
        y: line3Y,
        blockW: 400,
        fontH: 24,
        text: fmtDt(c.created),
        bold: true
      });
    }
  } else {
    const bcY = 40,
      bcH = 90;
    const bc = bcParams(bcVal);
    items.push({ type: 'barcode', x: bc.x, y: bcY, w: 400 - 2 * bc.x, h: bcH, val: bcVal, mw: bc.mw });
    const line1Y = bcY + bcH + 6;
    const line1Text = c.parentId ? id + ' \u2190 ' + c.parentId : id;
    items.push({ type: 'text', x: 0, y: line1Y, blockW: 400, fontH: 24, text: line1Text });
    if (detail === 'sorte' || detail === 'full') {
      if (sp) items.push({ type: 'text', x: 0, y: line1Y + 28, blockW: 400, fontH: 24, text: sp });
    }
    if (detail === 'full' && c.created) {
      const line3Y = line1Y + (sp ? 56 : 28);
      items.push({ type: 'text', x: 0, y: line3Y, blockW: 400, fontH: 28, text: fmtDt(c.created), bold: true });
    }
  }
  return items;
}

// ── MCP Server Factory ────────────────────────────────────
function createMcpServer(database, onWrite, printer) {
  const server = new McpServer({
    name: 'meistertracker',
    version: '1.0.0'
  });

  function notify() {
    if (typeof onWrite === 'function') onWrite();
  }

  // ──────────────────────────────────────────────────────────
  // READ TOOLS
  // ──────────────────────────────────────────────────────────

  server.tool(
    'daily_briefing',
    "Get today's operational briefing: batches due/overdue, open tasks by assignee, low-stock alerts, and calendar events. READ-ONLY overview — use other tools to take action on items.",
    { date: z.string().optional().describe('ISO date (YYYY-MM-DD), defaults to today') },
    async ({ date }) => {
      const batches = db.getAllBatches(database);
      const scanLog = db.getScanLog(database);
      const manualTasks = db.getAllTasks(database);
      const inventory = db.getInventory(database, 20);
      const calendarEvents = db.getCalendarEvents(database);
      const target = date || today();

      // Batches due today or overdue
      const bagLoc = buildBagLocationMap(scanLog);
      const dueToday = [];
      const overdue = [];
      for (const b of batches) {
        if (!b.due) continue;
        const dueDate = b.due.slice(0, 10);
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
      const openTasks = manualTasks.filter((t) => !t.done);
      const tasksByAssignee = {};
      for (const t of openTasks) {
        const key = t.assignee || 'Unassigned';
        if (!tasksByAssignee[key]) tasksByAssignee[key] = [];
        tasksByAssignee[key].push({ id: t.id, text: t.text, priority: t.priority, dueDate: t.dueDate });
      }

      // Low-stock alerts
      const inv = inventory;
      const lowStock = [];
      for (const mat of ['hardwood', 'wheatbran', 'gypsum', 'grain']) {
        const stock = inv.stock[mat];
        const threshold = inv.thresholds[mat].minKg;
        if (stock < threshold) lowStock.push({ material: mat, stockKg: stock, thresholdKg: threshold });
      }

      // Calendar events for today
      const todayEvents = calendarEvents.filter((e) => {
        const start = e.startDate;
        const end = e.endDate || e.startDate;
        return start <= target && end >= target;
      });

      // Maintenance due/overdue
      let maintenanceDue = [];
      try {
        const allDue = db.getMaintenanceDue(database);
        maintenanceDue = allDue.filter((m) => !m.scheduledDate || m.scheduledDate <= target);
      } catch (_) {
        // maintenance_log table may not exist yet
      }

      return json({
        date: target,
        batchesDueToday: dueToday,
        batchesOverdue: overdue,
        openTaskCount: openTasks.length,
        tasksByAssignee,
        lowStockAlerts: lowStock,
        maintenanceDue,
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
    'List production batches with optional filters. READ-ONLY listing. To modify batches use update_batch (metadata), add_bags_to_batch (more bags), rename_batch (change ID), or delete_batch (remove entirely).',
    {
      strainId: z
        .number()
        .optional()
        .describe('Filter by Pilzsorte id (exact match). Use list_mushroom_strains to discover ids.'),
      species: z.string().optional().describe('Filter by species (partial match, case-insensitive)'),
      strain: z.string().optional().describe('Filter by strain kuerzel (partial match, case-insensitive)'),
      batchType: z.enum(['block', 'grain', 'liquid']).optional().describe('Filter by batch type'),
      dueBefore: z.string().optional().describe('ISO date — batches due before this date'),
      dueAfter: z.string().optional().describe('ISO date — batches due after this date')
    },
    async (params) => {
      let batches = db.getAllBatches(database);

      if (params.strainId != null) batches = batches.filter((b) => b.strainId === params.strainId);
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
          strainId: b.strainId,
          strainName: b.strainName,
          strainKuerzel: b.strainKuerzel,
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
    'Get full details for a single batch: bags with current locations, scan history, harvest totals, and per-flush breakdown. READ-ONLY. To modify use update_batch, to record harvests use log_harvest, to move bags use move_bags.',
    { batchId: z.string().describe('Batch ID') },
    async ({ batchId }) => {
      const batch = db.readBatchById(database, batchId);
      if (!batch) return errResult('Batch not found: ' + batchId);

      const scanLog = db.getScanLog(database);
      const bagLoc = buildBagLocationMap(scanLog);
      const scans = scanLog.filter((e) => e.batch === batchId);
      const harvests = db.getAllHarvests(database).filter((h) => h.batch === batchId);

      const totalGrams = harvests.reduce((sum, h) => sum + h.grams, 0);
      const byFlush = {};
      for (const h of harvests) {
        const key = 'flush_' + h.flush;
        byFlush[key] = (byFlush[key] || 0) + h.grams;
      }

      const bags = batch.bags.map((id) => ({
        bagId: id,
        bagKg: batch.bagWeights ? batch.bagWeights[id] || batch.bagKg || 3 : batch.bagKg || 3,
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
    'Get all zones with rack counts, current bag counts, and capacity utilization. READ-ONLY. To manage zones use manage_zones, to manage racks use manage_racks.',
    {},
    async () => {
      const zones = db.getZonesWithRacks(database).map((z) => {
        const bagCount = db.zoneBagCount(database, z.id);
        const racks = z.racks.map((r) => ({
          id: r.id,
          bagCount: db.rackBagCount(database, r.id)
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
    'Get current substrate inventory levels, thresholds, low-stock alerts, and recent transactions. READ-ONLY. To log deliveries or usage use update_inventory.',
    {},
    async () => {
      const inv = db.getInventory(database, 20);
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
    'List team tasks with optional filters for assignee, priority, completion status, or date range. READ-ONLY. To create tasks use create_task, to modify use update_task.',
    {
      assignee: z.string().optional().describe('Filter by assignee name'),
      priority: z.enum(['low', 'med', 'high']).optional().describe('Filter by priority'),
      done: z.boolean().optional().describe('true=completed, false=open'),
      dueBefore: z.string().optional().describe('ISO date — tasks due before this date'),
      dueAfter: z.string().optional().describe('ISO date — tasks due after this date')
    },
    async (params) => {
      let tasks = db.getAllTasks(database);

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
    'Get calendar events within a date range, optionally filtered by category. READ-ONLY. To create events use create_calendar_event.',
    {
      startDate: z.string().optional().describe('ISO date — start of range (default: today)'),
      endDate: z.string().optional().describe('ISO date — end of range (default: 30 days from start)'),
      category: z.string().optional().describe('Filter by event category')
    },
    async (params) => {
      const start = params.startDate || today();
      const end = params.endDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

      let events = db.getCalendarEvents(database).filter((e) => {
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
    'List mushroom cultures with optional filters for type (MC/PD/LC/G2G), Pilzsorte (strainId), species, or status. READ-ONLY. To modify use update_culture, to delete use delete_culture.',
    {
      type: z.string().optional().describe('Culture type (MC, PD, or LC)'),
      strainId: z
        .number()
        .optional()
        .describe('Filter by Pilzsorte id (exact match). Use list_mushroom_strains to discover ids.'),
      species: z.string().optional().describe('Filter by species (partial match)'),
      status: z.string().optional().describe('Filter by status (e.g. active, stored, used, contam)')
    },
    async (params) => {
      let cultures = db.getAllCultures(database);

      if (params.type) cultures = cultures.filter((c) => c.type === params.type);
      if (params.strainId != null) cultures = cultures.filter((c) => c.strainId === params.strainId);
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
    'Get harvest data aggregated by batch, species, or month with totals and per-flush breakdowns. READ-ONLY. To record a new harvest use log_harvest.',
    {
      groupBy: z.enum(['batch', 'species', 'month']).optional().describe('Aggregation dimension (default: batch)'),
      batchId: z.string().optional().describe('Filter to a specific batch'),
      species: z.string().optional().describe('Filter by species'),
      startDate: z.string().optional().describe('ISO date — harvests after this date'),
      endDate: z.string().optional().describe('ISO date — harvests before this date')
    },
    async (params) => {
      let harvests = db.getAllHarvests(database);

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

        if (!groups[key]) groups[key] = { totalGrams: 0, count: 0, byFlush: {}, byQuality: {} };
        groups[key].totalGrams += h.grams;
        groups[key].count += 1;
        const fKey = 'flush_' + h.flush;
        groups[key].byFlush[fKey] = (groups[key].byFlush[fKey] || 0) + h.grams;
        const qKey = h.quality || 'ungraded';
        groups[key].byQuality[qKey] = (groups[key].byQuality[qKey] || 0) + 1;
      }

      // Overall quality distribution
      const qualityDist = {};
      for (const h of harvests) {
        const q = h.quality || 'ungraded';
        qualityDist[q] = (qualityDist[q] || 0) + 1;
      }

      return json({
        groupBy,
        totalHarvests: harvests.length,
        totalGrams: harvests.reduce((s, h) => s + h.grams, 0),
        qualityDistribution: qualityDist,
        groups
      });
    }
  );

  server.tool(
    'get_scan_log',
    'Get scan log entries (bag movements/placements/removals) with optional filters. READ-ONLY history. To log new bag movements use move_bags.',
    {
      batchId: z.string().optional().describe('Filter by batch ID'),
      bagId: z.string().optional().describe('Filter by bag ID'),
      action: z.enum(['ADD', 'MOVE', 'REMOVE']).optional().describe('Filter by action type'),
      reason: z.string().optional().describe('Filter by reason (e.g. contam_tricho, dried_out)'),
      limit: z.number().optional().describe('Max entries to return (default: 50, max: 500)'),
      startDate: z.string().optional().describe('ISO date — entries after this date'),
      endDate: z.string().optional().describe('ISO date — entries before this date')
    },
    async (params) => {
      let log = db.getScanLog(database);

      if (params.batchId) log = log.filter((e) => e.batch === params.batchId);
      if (params.bagId) log = log.filter((e) => e.bag === params.bagId);
      if (params.action) log = log.filter((e) => e.action === params.action);
      if (params.reason) log = log.filter((e) => e.reason === params.reason);
      if (params.startDate) log = log.filter((e) => e.time && e.time.slice(0, 10) >= params.startDate);
      if (params.endDate) log = log.filter((e) => e.time && e.time.slice(0, 10) <= params.endDate);

      const limit = Math.min(params.limit || 50, 500);
      log = log.slice(-limit);

      return json(log);
    }
  );

  // ──────────────────────────────────────────────────────────
  // WRITE TOOLS
  // ──────────────────────────────────────────────────────────

  server.tool(
    'create_batch',
    'Create a new production batch with auto-generated bags. Prefer strainId (use list_mushroom_strains); when omitted, species is required. Does NOT auto-deduct inventory — use update_inventory separately for substrate usage. Does NOT place bags in zones — use move_bags to ADD bags after creation.',
    {
      batchId: z.string().describe('Batch ID (e.g. FB-2025-042)'),
      strainId: z
        .number()
        .optional()
        .describe('Pilzsorte id. When set, species/strain are auto-filled from mushroom_strains.'),
      species: z.string().optional().describe('Mushroom species (required when strainId is omitted)'),
      qty: z.number().describe('Number of bags (>= 1)'),
      days: z.number().describe('Incubation days (>= 1)'),
      strain: z.string().optional().describe('Strain kuerzel (free-text fallback when strainId is omitted)'),
      subHardwood: z.number().optional().describe('Substrate hardwood %'),
      subWheatbran: z.number().optional().describe('Substrate wheat bran %'),
      subRh: z.number().optional().describe('Substrate relative humidity %'),
      subGypsum: z.boolean().optional().describe('Include gypsum?'),
      bagKg: z.number().optional().describe('Bag weight in kg (default: 3)'),
      batchType: z.enum(['block', 'grain', 'liquid']).optional().describe('Batch type (default: block)'),
      sourceId: z.string().optional().describe('Source culture ID'),
      recipeId: z
        .number()
        .optional()
        .describe('Recipe ID — auto-fills substrate fields (hardwood%, wheatbran%, gypsum%, rh%) from recipe'),
      notes: z.string().optional().describe('Notes')
    },
    async (params) => {
      try {
        if (!params.strainId && !params.species) {
          return errResult('Either strainId or species is required');
        }
        // Apply recipe if provided
        let subHardwood = params.subHardwood || 0;
        let subWheatbran = params.subWheatbran || 0;
        let subRh = params.subRh || 0;
        let subGypsum = params.subGypsum || false;
        if (params.recipeId) {
          const recipe = db.getRecipeById(database, params.recipeId);
          if (!recipe) return errResult('Recipe not found: ' + params.recipeId);
          subHardwood = params.subHardwood != null ? params.subHardwood : recipe.hardwoodPct;
          subWheatbran = params.subWheatbran != null ? params.subWheatbran : recipe.wheatbranPct;
          subRh = params.subRh != null ? params.subRh : recipe.rhPct;
          subGypsum = params.subGypsum != null ? params.subGypsum : recipe.gypsumPct > 0;
        }
        const created = new Date().toISOString();
        const due = new Date(Date.now() + params.days * 86400000).toISOString();
        const bags = [];
        for (let i = 1; i <= params.qty; i++) {
          bags.push(params.batchId + '-' + String(i).padStart(2, '0'));
        }
        db.insertBatch(database, {
          batchId: params.batchId,
          strainId: params.strainId || null,
          species: params.species,
          strain: params.strain || null,
          qty: params.qty,
          days: params.days,
          substrate: {
            hardwood: subHardwood,
            wheatbran: subWheatbran,
            rh: subRh,
            gypsum: subGypsum
          },
          bagKg: params.bagKg || 3,
          batchType: params.batchType || 'block',
          sourceId: params.sourceId || null,
          notes: params.notes || '',
          created,
          due,
          bags
        });
        notify();
        const persisted = db.readBatchById(database, params.batchId);
        return json({
          success: true,
          batchId: params.batchId,
          created,
          due,
          bagCount: params.qty,
          bags,
          species: persisted ? persisted.species : params.species,
          strain: persisted ? persisted.strain : params.strain || null,
          strainId: persisted ? persisted.strainId : params.strainId || null,
          strainName: persisted ? persisted.strainName : null,
          strainKuerzel: persisted ? persisted.strainKuerzel : null
        });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  server.tool(
    'update_batch',
    'Update batch METADATA ONLY: notes, species, strain, strainId, days, due date. NOT for contamination (→ move_bags with MOVE to contam zone). NOT for harvests/weights (→ log_harvest). NOT for inventory changes (→ update_inventory). NOT for adding bags (→ add_bags_to_batch). Pass strainId to switch Pilzsorte — species/strain auto-update.',
    {
      batchId: z.string().describe('Batch ID'),
      strainId: z.number().optional().describe('Pilzsorte id (auto-fills species/strain from mushroom_strains)'),
      notes: z.string().optional(),
      species: z.string().optional(),
      strain: z.string().optional(),
      days: z.number().optional(),
      due: z.string().optional().describe('ISO date')
    },
    async (params) => {
      try {
        const { batchId, ...fields } = params;
        const updates = {};
        for (const [k, v] of Object.entries(fields)) {
          if (v !== undefined) updates[k] = v;
        }
        if (!Object.keys(updates).length) return errResult('No fields to update');
        db.updateBatchField(database, batchId, updates);
        notify();
        const persisted = db.readBatchById(database, batchId);
        return json({
          success: true,
          batchId,
          updated: Object.keys(updates),
          species: persisted ? persisted.species : null,
          strain: persisted ? persisted.strain : null,
          strainId: persisted ? persisted.strainId : null,
          strainName: persisted ? persisted.strainName : null,
          strainKuerzel: persisted ? persisted.strainKuerzel : null
        });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  server.tool(
    'create_task',
    'Create a team task (todo/work item). ONLY for real team work: cleaning, ordering, maintenance, reviews. NOT for documenting contamination (→ move_bags). NOT for recording harvests (→ log_harvest). NOT for inventory changes (→ update_inventory). NOT for logging bag movements (→ move_bags).',
    {
      text: z.string().describe('Task description'),
      priority: z.enum(['low', 'med', 'high']).optional().describe('Priority (default: med)'),
      assignee: z.string().optional().describe('Assignee name'),
      dueDate: z.string().optional().describe('ISO date for due date'),
      description: z.string().optional().describe('Additional details')
    },
    async (params) => {
      try {
        const id = db.insertTask(database, {
          text: params.text,
          priority: params.priority || 'med',
          done: false,
          created: new Date().toISOString(),
          assignee: params.assignee || null,
          dueDate: params.dueDate || null,
          description: params.description || null
        });
        notify();
        return json({ success: true, id: Number(id), text: params.text, assignee: params.assignee || null });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  server.tool(
    'update_task',
    'Update an existing team task — change text, priority, assignee, due date, description, or mark as done/undone. ONLY for modifying existing tasks. NOT for physical actions like contamination or harvests.',
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
        const { id, ...fields } = params;
        const updates = {};
        for (const [k, v] of Object.entries(fields)) {
          if (v !== undefined) updates[k] = v;
        }
        if (!Object.keys(updates).length) return errResult('No fields to update');
        db.updateTaskById(database, id, updates);
        notify();
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
        const id = 'ev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        db.insertCalendarEvent(
          database,
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
        notify();
        return json({ success: true, id, title: params.title, startDate: params.startDate });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  server.tool(
    'log_harvest',
    'Record a mushroom harvest with weight in grams. ALWAYS use this tool when grams, weight, or harvest amount is mentioned — NEVER record harvests as notes in update_batch. Species/strain auto-fill from the batch when omitted; pass strainId to resolve from mushroom_strains.',
    {
      batch: z.string().describe('Batch ID'),
      grams: z.number().describe('Harvest weight in grams (>= 0)'),
      bag: z.string().optional().describe('Specific bag ID'),
      flush: z.number().optional().describe('Flush number (default: 1)'),
      quality: z.enum(['A', 'B', 'C']).optional().describe('Quality grade: A (premium), B (standard), C (low)'),
      notes: z.string().optional().describe('Harvest notes'),
      strainId: z
        .number()
        .optional()
        .describe('Pilzsorte id — when set, species/strain are resolved from mushroom_strains'),
      species: z.string().optional().describe('Auto-filled from batch if omitted'),
      strain: z.string().optional().describe('Auto-filled from batch if omitted')
    },
    async (params) => {
      try {
        let species = params.species;
        let strain = params.strain;
        if (params.strainId && (!species || !strain)) {
          const strains = db.listMushroomStrains(database);
          const ms = strains.find((s) => s.id === params.strainId);
          if (!ms) return errResult('Pilzsorte not found: ' + params.strainId);
          species = species || ms.name;
          strain = strain || ms.kuerzel;
        }
        if (!species || !strain) {
          const b = db.readBatchById(database, params.batch);
          if (b) {
            species = species || b.species;
            strain = strain || b.strain;
          }
        }
        const id = db.insertHarvest(database, {
          time: new Date().toISOString(),
          batch: params.batch,
          bag: params.bag || null,
          species: species || null,
          strain: strain || null,
          grams: params.grams,
          flush: params.flush || 1,
          quality: params.quality || null,
          notes: params.notes || null
        });
        notify();
        return json({
          success: true,
          id: Number(id),
          batch: params.batch,
          grams: params.grams,
          flush: params.flush || 1,
          quality: params.quality || null,
          species,
          strain
        });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  server.tool(
    'move_bags',
    'Log physical bag movements between zones/racks. Use for ALL physical bag state changes: ADD (place bag in zone), MOVE (relocate — including to contamination zone for contaminated bags), REMOVE (permanently remove bag from zone tracking; scan history preserved). DESTRUCTIVE: REMOVE requires confirm: true. For contamination ALWAYS use MOVE to a contam zone first. Only use REMOVE when user explicitly says entsorgen/wegwerfen/löschen. NOT for recording harvests (→ log_harvest). NOT for batch metadata (→ update_batch).',
    {
      entries: z
        .array(
          z.object({
            batch: z.string().describe('Batch ID'),
            bag: z.string().describe('Bag ID'),
            action: z.enum(['ADD', 'MOVE', 'REMOVE']).describe('Movement type'),
            from: z.string().optional().describe('Source zone/rack (required for MOVE/REMOVE)'),
            to: z.string().optional().describe('Destination zone/rack (required for ADD/MOVE)'),
            reason: z
              .string()
              .optional()
              .describe(
                'Reason for MOVE/REMOVE (e.g. contam_tricho, contam_cobweb, contam_bacteria, contam_other, dried_out, damaged, other)'
              )
          })
        )
        .describe('Array of bag movements'),
      confirm: z
        .boolean()
        .optional()
        .describe('Required true for REMOVE actions. Safety confirmation for destructive operations.')
    },
    async ({ entries, confirm }) => {
      try {
        const hasRemove = entries.some((e) => e.action === 'REMOVE');
        if (hasRemove && confirm !== true) {
          return errResult(
            'REMOVE entfernt Bags dauerhaft aus dem Zonen-Tracking (Scan-Historie bleibt erhalten). Bitte mit confirm: true bestätigen. Bei Kontamination besser MOVE in eine Kontam-Zone verwenden.'
          );
        }
        const now = new Date().toISOString();
        const enriched = entries.map((e) => {
          const b = db.readBatchById(database, e.batch);
          return {
            time: now,
            action: e.action,
            batch: e.batch,
            bag: e.bag,
            from: e.from || null,
            to: e.to || null,
            species: b ? b.species : null,
            strain: b ? b.strain : null,
            reason: e.reason || null
          };
        });
        const ids = db.appendScanEntries(database, enriched, null);
        notify();
        return json({ success: true, count: entries.length, ids: ids.map(Number) });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  server.tool(
    'update_inventory',
    'Log a substrate inventory change: delivery (positive deltaKg), usage (negative deltaKg), or correction. Materials: hardwood, wheatbran, gypsum, grain. ALWAYS use this for stock changes — NEVER record inventory as task (→ create_task) or batch note (→ update_batch).',
    {
      material: z.enum(['hardwood', 'wheatbran', 'gypsum', 'grain']).describe('Material type'),
      deltaKg: z.number().describe('Change in kg (positive for delivery, negative for usage)'),
      type: z.string().optional().describe('Transaction type (e.g. delivery, batch, correction)'),
      ref: z.string().optional().describe('Reference note (e.g. supplier name, batch ID)')
    },
    async (params) => {
      try {
        const newStock = db.applyInventoryDelta(
          database,
          params.material,
          params.deltaKg,
          params.type || null,
          params.ref || null
        );
        notify();
        return json({ success: true, material: params.material, deltaKg: params.deltaKg, newStockKg: newStock });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  server.tool(
    'update_culture',
    "Update a mushroom culture's metadata: status, notes, Pilzsorte (strainId), species, strain, or source. For status changes like 'contam' use this. NOT for physical bag handling (→ move_bags). Pass strainId to switch Pilzsorte — species/strain auto-update.",
    {
      id: z.string().describe('Culture ID'),
      status: z.string().optional().describe('New status (e.g. active, archived, contaminated)'),
      notes: z.string().optional(),
      strainId: z.number().optional().describe('Pilzsorte id (auto-fills species/strain from mushroom_strains)'),
      species: z.string().optional(),
      strain: z.string().optional(),
      source: z.string().optional()
    },
    async (params) => {
      try {
        const { id, ...fields } = params;
        const updates = {};
        for (const [k, v] of Object.entries(fields)) {
          if (v !== undefined) updates[k] = v;
        }
        if (!Object.keys(updates).length) return errResult('No fields to update');
        db.updateCulture(database, id, updates);
        notify();
        return json({ success: true, id, updated: Object.keys(updates) });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // ──────────────────────────────────────────────────────────
  // CULTURES: CREATE
  // ──────────────────────────────────────────────────────────

  server.tool(
    'create_culture',
    'Create a single mushroom culture (MC, PD, LC, or G2G). Prefer strainId (use list_mushroom_strains); when omitted, species is required. NOT for creating production batches (→ create_batch).',
    {
      id: z.string().describe('Culture ID (e.g. MC-KINGS-250301-01)'),
      type: z.enum(['MC', 'PD', 'LC', 'G2G']).describe('Culture type'),
      strainId: z
        .number()
        .optional()
        .describe('Pilzsorte id. When set, species/strain are auto-filled from mushroom_strains.'),
      species: z.string().optional().describe('Species (required when strainId is omitted)'),
      strain: z.string().optional().describe('Strain kuerzel (free-text fallback)'),
      parentId: z.string().optional().describe('Parent culture ID for lineage'),
      source: z.string().optional().describe('Source note (e.g. clone, spore print, wild)'),
      status: z.enum(['active', 'stored', 'used', 'contam']).optional().describe('Culture status (default: active)'),
      notes: z.string().optional(),
      created: z.string().optional().describe('ISO timestamp (default: now)')
    },
    async (params) => {
      try {
        if (!params.strainId && !params.species) {
          return errResult('Either strainId or species is required');
        }
        db.insertCultures(database, [
          {
            id: params.id,
            type: params.type,
            strainId: params.strainId || null,
            species: params.species || null,
            strain: params.strain || null,
            parentId: params.parentId || null,
            source: params.source || null,
            status: params.status || 'active',
            notes: params.notes || '',
            created: params.created || new Date().toISOString()
          }
        ]);
        notify();
        const persisted = db.getAllCultures(database).find((c) => c.id === params.id);
        return json({ success: true, id: params.id, culture: persisted });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // ──────────────────────────────────────────────────────────
  // MUSHROOM STRAINS (Pilzsorten) CRUD
  // ──────────────────────────────────────────────────────────

  server.tool(
    'list_mushroom_strains',
    'List all Pilzsorten (mushroom strains) with id, name, kuerzel, description. READ-ONLY. Use the returned id with create_batch, create_culture, update_batch, update_culture, or log_harvest to link to a strain.',
    {},
    async () => {
      return json(db.listMushroomStrains(database));
    }
  );

  server.tool(
    'create_mushroom_strain',
    'Create a new Pilzsorte (mushroom strain). Name and kuerzel are required and must be unique.',
    {
      name: z.string().describe('Full strain name, e.g. "Pleurotus ostreatus HK35"'),
      kuerzel: z.string().describe('Short code, e.g. "HK35"'),
      description: z.string().optional().describe('Free-text description')
    },
    async (params) => {
      try {
        const id = db.createMushroomStrain(database, {
          name: params.name,
          kuerzel: params.kuerzel,
          description: params.description || ''
        });
        notify();
        return json({ success: true, id: Number(id), name: params.name, kuerzel: params.kuerzel });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  server.tool(
    'update_mushroom_strain',
    'Update a Pilzsorte. Changes to name/kuerzel propagate to all batches and cultures that reference this strain.',
    {
      id: z.number().describe('Pilzsorte id'),
      name: z.string().optional().describe('New name'),
      kuerzel: z.string().optional().describe('New kuerzel'),
      description: z.string().optional().describe('New description')
    },
    async (params) => {
      try {
        const { id, ...fields } = params;
        const updates = {};
        for (const [k, v] of Object.entries(fields)) {
          if (v !== undefined) updates[k] = v;
        }
        if (!Object.keys(updates).length) return errResult('No fields to update');
        db.updateMushroomStrain(database, id, updates);
        notify();
        return json({ success: true, id, updated: Object.keys(updates) });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  server.tool(
    'delete_mushroom_strain',
    'Delete a Pilzsorte. DESTRUCTIVE — fails safely if still referenced by any batch or culture (delete protection). Cannot be undone.',
    {
      id: z.number().describe('Pilzsorte id')
    },
    async (params) => {
      try {
        const removed = db.deleteMushroomStrain(database, params.id);
        if (!removed) return errResult('Pilzsorte not found: ' + params.id);
        notify();
        return json({ success: true, id: params.id });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // ──────────────────────────────────────────────────────────
  // ZONE & RACK MANAGEMENT
  // ──────────────────────────────────────────────────────────

  // Example: manage_zones({ action: 'create', id: 'fruiting-2', name: 'Fruiting Room 2', role: 'fruiting' })
  server.tool(
    'manage_zones',
    'Create, rename, delete, or reorder zones. Actions: create (new zone), rename (change name), delete (remove empty zone), reorder (set sort order). READ zones with get_zone_overview. NOT for racks (→ manage_racks).',
    {
      action: z.enum(['create', 'rename', 'delete', 'reorder']).describe('Action to perform'),
      id: z.string().optional().describe('Zone ID (required for create/rename/delete)'),
      name: z.string().optional().describe('Zone name (required for create/rename)'),
      role: z
        .string()
        .optional()
        .describe('Zone role: spawn, incubation, fruiting, contaminated, storage (for create)'),
      color: z.string().optional().describe('Hex color e.g. #4CAF50 (for create)'),
      maxCapacity: z.number().optional().describe('Max bag capacity (for create)'),
      order: z.array(z.string()).optional().describe('Array of zone IDs in desired order (for reorder)')
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'create': {
            if (!params.id || !params.name) return errResult('id and name are required for create');
            db.insertZone(database, {
              id: params.id,
              name: params.name,
              role: params.role || null,
              color: params.color || null,
              maxCapacity: params.maxCapacity || null,
              created: new Date().toISOString()
            });
            notify();
            return json({ success: true, action: 'create', id: params.id, name: params.name });
          }
          case 'rename': {
            if (!params.id || !params.name) return errResult('id and name are required for rename');
            db.renameZoneName(database, params.id, params.name);
            notify();
            return json({ success: true, action: 'rename', id: params.id, newName: params.name });
          }
          case 'delete': {
            if (!params.id) return errResult('id is required for delete');
            db.deleteZone(database, params.id);
            notify();
            return json({ success: true, action: 'delete', id: params.id });
          }
          case 'reorder': {
            if (!params.order || !params.order.length) return errResult('order array is required for reorder');
            db.reorderZones(database, params.order);
            notify();
            return json({ success: true, action: 'reorder', order: params.order });
          }
          default:
            return errResult('Unknown action: ' + params.action);
        }
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // Example: manage_racks({ action: 'create', id: 'R-FRUIT2-01', zoneId: 'fruiting-2' })
  server.tool(
    'manage_racks',
    'Create or delete racks within zones. Actions: create (new rack in zone), delete (remove empty rack). View racks via get_zone_overview. NOT for zones (→ manage_zones).',
    {
      action: z.enum(['create', 'delete']).describe('Action to perform'),
      id: z.string().optional().describe('Rack ID (required for create/delete)'),
      zoneId: z.string().optional().describe('Zone ID (required for create)')
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'create': {
            if (!params.id || !params.zoneId) return errResult('id and zoneId are required for create');
            db.insertRack(database, {
              id: params.id,
              zoneId: params.zoneId,
              created: new Date().toISOString()
            });
            notify();
            return json({ success: true, action: 'create', id: params.id, zoneId: params.zoneId });
          }
          case 'delete': {
            if (!params.id) return errResult('id is required for delete');
            db.deleteRack(database, params.id);
            notify();
            return json({ success: true, action: 'delete', id: params.id });
          }
          default:
            return errResult('Unknown action: ' + params.action);
        }
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // ──────────────────────────────────────────────────────────
  // BATCH EXTENSIONS
  // ──────────────────────────────────────────────────────────

  // Example: add_bags_to_batch({ batchId: 'FB-2025-042', count: 5 })
  server.tool(
    'add_bags_to_batch',
    'Add more bags to an existing batch. Generates new bag IDs sequentially. Use this instead of update_batch when you need more bags — it keeps inventory log consistent.',
    {
      batchId: z.string().describe('Batch ID'),
      count: z.number().describe('Number of bags to add (>= 1)')
    },
    async (params) => {
      try {
        const batch = db.readBatchById(database, params.batchId);
        if (!batch) return errResult('Batch not found: ' + params.batchId);
        const existingCount = batch.bags.length;
        const newBags = [];
        for (let i = 1; i <= params.count; i++) {
          newBags.push(params.batchId + '-' + String(existingCount + i).padStart(2, '0'));
        }
        const result = db.addBagsToBatch(database, params.batchId, newBags, existingCount + params.count);
        notify();
        return json({
          success: true,
          batchId: params.batchId,
          newBags,
          totalBags: existingCount + params.count,
          bagBarcodes: result.bagBarcodes
        });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // Example: delete_batch({ batchId: 'FB-2025-042', confirm: true })
  server.tool(
    'delete_batch',
    'Delete a batch with ALL its bags, scan entries, and harvests. DESTRUCTIVE — cannot be undone. Reverses inventory deltas. Requires confirm: true.',
    {
      batchId: z.string().describe('Batch ID to delete'),
      confirm: z.boolean().optional().describe('Must be true to confirm deletion')
    },
    async (params) => {
      try {
        if (params.confirm !== true) {
          return errResult(
            'delete_batch löscht den Batch mit ALLEN Bags, Scan-Einträgen und Ernten unwiderruflich. Bitte mit confirm: true bestätigen.'
          );
        }
        const batch = db.readBatchById(database, params.batchId);
        if (!batch) return errResult('Batch not found: ' + params.batchId);
        db.deleteBatchById(database, params.batchId);
        notify();
        return json({ success: true, batchId: params.batchId, deletedBags: batch.bags.length });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // Example: rename_batch({ oldId: 'FB-2025-042', newId: 'FB-2025-043' })
  server.tool(
    'rename_batch',
    'Rename a batch ID. Updates all references in bags, scan_log, harvests, and inventory_log. NOT for metadata changes (→ update_batch).',
    {
      oldId: z.string().describe('Current batch ID'),
      newId: z.string().describe('New batch ID')
    },
    async (params) => {
      try {
        db.renameBatch(database, params.oldId, params.newId);
        notify();
        return json({ success: true, oldId: params.oldId, newId: params.newId });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // ──────────────────────────────────────────────────────────
  // CULTURE EXTENSIONS
  // ──────────────────────────────────────────────────────────

  // Example: delete_culture({ id: 'MC-KINGS-250301-01', confirm: true })
  server.tool(
    'delete_culture',
    'Delete a mushroom culture. DESTRUCTIVE — cannot be undone. Requires confirm: true. Consider setting status to "contam" or "used" via update_culture instead.',
    {
      id: z.string().describe('Culture ID to delete'),
      confirm: z.boolean().optional().describe('Must be true to confirm deletion')
    },
    async (params) => {
      try {
        if (params.confirm !== true) {
          return errResult(
            'delete_culture löscht die Kultur unwiderruflich. Bitte mit confirm: true bestätigen. Alternativ: update_culture mit status "contam" oder "used".'
          );
        }
        const removed = db.deleteCulture(database, params.id);
        if (!removed) return errResult('Culture not found: ' + params.id);
        notify();
        return json({ success: true, id: params.id });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // Example: get_culture_details({ id: 'MC-KINGS-250301-01' })
  server.tool(
    'get_culture_details',
    'Get full details for a single culture including strain info, lineage (parent + children), and batches created from it. READ-ONLY. To modify use update_culture.',
    {
      id: z.string().describe('Culture ID')
    },
    async (params) => {
      const culture = db.getCultureById(database, params.id);
      if (!culture) return errResult('Culture not found: ' + params.id);
      return json(culture);
    }
  );

  // ──────────────────────────────────────────────────────────
  // BARCODES
  // ──────────────────────────────────────────────────────────

  // Example: lookup_barcode({ barcode: 1000042 })
  server.tool(
    'lookup_barcode',
    'Resolve a numeric barcode to its entity (bag, culture, asset, zone, rack). Returns entity_type and entity_id. READ-ONLY.',
    {
      barcode: z.number().describe('Numeric barcode to look up')
    },
    async (params) => {
      const result = db.lookupBarcode(database, params.barcode);
      if (!result) return errResult('Barcode not found: ' + params.barcode);
      return json(result);
    }
  );

  // Example: assign_barcode({ entityType: 'bag', entityId: 'FB-2025-042-01' })
  server.tool(
    'assign_barcode',
    'Assign a numeric barcode to an entity (bag, culture, asset, zone, rack). Returns existing barcode if already assigned (idempotent).',
    {
      entityType: z.enum(['bag', 'culture', 'asset', 'zone', 'rack']).describe('Entity type'),
      entityId: z.string().describe('Entity ID')
    },
    async (params) => {
      try {
        const barcode = db.assignBarcode(database, params.entityType, params.entityId);
        notify();
        return json({ success: true, barcode, entityType: params.entityType, entityId: params.entityId });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // Example: list_barcodes()
  server.tool('list_barcodes', 'List all assigned barcodes with their entity type and ID. READ-ONLY.', {}, async () => {
    return json(db.getAllBarcodes(database));
  });

  // ──────────────────────────────────────────────────────────
  // ASSETS
  // ──────────────────────────────────────────────────────────

  // Example: manage_assets({ action: 'create', assetId: 'AK-001', name: 'Autoklav', category: 'Sterilisation', purchasePrice: 2500 })
  server.tool(
    'manage_assets',
    'Create, update, delete, or list equipment/assets. Actions: list (all assets), create/update (upsert by assetId), delete (remove asset). NOT for inventory/substrate (→ update_inventory).',
    {
      action: z.enum(['list', 'create', 'update', 'delete']).describe('Action to perform'),
      assetId: z.string().optional().describe('Asset ID (required for create/update/delete)'),
      name: z.string().optional().describe('Asset name (required for create)'),
      category: z.string().optional().describe('Category (required for create)'),
      entryDate: z.string().optional().describe('Entry date ISO (default: today)'),
      exitDate: z.string().optional().describe('Exit/disposal date ISO'),
      purchasePrice: z.number().optional().describe('Purchase price (required for create)'),
      usefulLife: z.number().optional().describe('Useful life in years (required for create)'),
      depreciationMethod: z.string().optional().describe('Depreciation method (default: linear)'),
      supplier: z.string().optional().describe('Supplier name'),
      invoiceNumber: z.string().optional().describe('Invoice number'),
      serialNumber: z.string().optional().describe('Serial number'),
      location: z.string().optional().describe('Current location'),
      status: z.string().optional().describe('Status (default: aktiv)'),
      notes: z.string().optional().describe('Notes')
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'list':
            return json(db.listAssets(database));
          case 'create':
          case 'update': {
            if (!params.assetId) return errResult('assetId is required');
            if (
              params.action === 'create' &&
              (!params.name || !params.category || params.purchasePrice == null || params.usefulLife == null)
            ) {
              return errResult('name, category, purchasePrice, and usefulLife are required for create');
            }
            const result = db.upsertAsset(database, {
              assetId: params.assetId,
              name: params.name || '',
              category: params.category || '',
              entryDate: params.entryDate || today(),
              exitDate: params.exitDate || null,
              purchasePrice: params.purchasePrice || 0,
              usefulLife: params.usefulLife || 0,
              depreciationMethod: params.depreciationMethod || 'linear',
              supplier: params.supplier || null,
              invoiceNumber: params.invoiceNumber || null,
              serialNumber: params.serialNumber || null,
              location: params.location || null,
              status: params.status || 'aktiv',
              notes: params.notes || '',
              created: new Date().toISOString()
            });
            notify();
            return json({ success: true, action: params.action, assetId: params.assetId, barcode: result.barcode });
          }
          case 'delete': {
            if (!params.assetId) return errResult('assetId is required for delete');
            db.deleteAssetById(database, params.assetId);
            notify();
            return json({ success: true, action: 'delete', assetId: params.assetId });
          }
          default:
            return errResult('Unknown action: ' + params.action);
        }
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // ──────────────────────────────────────────────────────────
  // SUPPLIERS
  // ──────────────────────────────────────────────────────────

  // Example: manage_suppliers({ action: 'list' })
  // Example: manage_suppliers({ action: 'create', mat: 'hardwood', name: 'Holz GmbH', url: 'https://holz.de' })
  server.tool(
    'manage_suppliers',
    'Create, update, delete, or list substrate suppliers. Actions: list, create/update (upsert), delete. Suppliers are linked to materials: hardwood, wheatbran, gypsum, grain.',
    {
      action: z.enum(['list', 'create', 'update', 'delete']).describe('Action to perform'),
      id: z.number().optional().describe('Supplier ID (required for update/delete)'),
      mat: z
        .enum(['hardwood', 'wheatbran', 'gypsum', 'grain'])
        .optional()
        .describe('Material type (required for create)'),
      name: z.string().optional().describe('Supplier name (required for create)'),
      url: z.string().optional().describe('Website URL'),
      phone: z.string().optional().describe('Phone number'),
      notes: z.string().optional().describe('Notes')
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'list':
            return json(db.listSuppliers(database));
          case 'create':
          case 'update': {
            if (params.action === 'create' && (!params.mat || !params.name)) {
              return errResult('mat and name are required for create');
            }
            const id = db.upsertSupplier(database, {
              id: params.id || undefined,
              mat: params.mat,
              name: params.name,
              url: params.url || null,
              phone: params.phone || null,
              notes: params.notes || null
            });
            notify();
            return json({ success: true, action: params.action, id: Number(id) });
          }
          case 'delete': {
            if (params.id == null) return errResult('id is required for delete');
            db.deleteSupplier(database, params.id);
            notify();
            return json({ success: true, action: 'delete', id: params.id });
          }
          default:
            return errResult('Unknown action: ' + params.action);
        }
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // ──────────────────────────────────────────────────────────
  // KPI
  // ──────────────────────────────────────────────────────────

  // Example: get_kpi_history({ limit: 30 })
  server.tool(
    'get_kpi_history',
    'Get KPI snapshots: yield/bag, contamination rate, bags created, stock levels, pipeline counts over time. READ-ONLY historical data.',
    {
      limit: z.number().optional().describe('Max snapshots to return (default: all, most recent first)')
    },
    async (params) => {
      return json(db.getKpiSnapshots(database, params.limit || undefined));
    }
  );

  // ──────────────────────────────────────────────────────────
  // USERS
  // ──────────────────────────────────────────────────────────

  // Example: list_users()
  server.tool(
    'list_users',
    'List all users with their IDs, usernames, roles, and creation dates. READ-ONLY. Useful for assigneeIds in calendar events.',
    {},
    async () => {
      return json(db.listUsers(database));
    }
  );

  // ──────────────────────────────────────────────────────────
  // CONTAMINATION REPORT
  // ──────────────────────────────────────────────────────────

  // Example: get_contamination_report({ groupBy: 'species', startDate: '2025-01-01' })
  server.tool(
    'get_contamination_report',
    'Get contamination statistics grouped by species, zone, or month. Shows contamination counts and reason breakdown. READ-ONLY. To log contamination use move_bags with reason.',
    {
      groupBy: z.enum(['species', 'zone', 'month']).optional().describe('Aggregation dimension (default: month)'),
      startDate: z.string().optional().describe('ISO date — start of range'),
      endDate: z.string().optional().describe('ISO date — end of range')
    },
    async (params) => {
      return json(db.getContaminationReport(database, params.groupBy || 'month', params.startDate, params.endDate));
    }
  );

  // ──────────────────────────────────────────────────────────
  // RECIPES
  // ──────────────────────────────────────────────────────────

  // Example: manage_recipes({ action: 'create', name: 'Standard HK35', hardwoodPct: 80, wheatbranPct: 20, rhPct: 65 })
  server.tool(
    'manage_recipes',
    'Create, update, or delete reusable substrate recipes. Recipes store hardwood%, wheatbran%, gypsum%, rh% for quick batch creation. Use recipeId in create_batch to auto-fill substrate fields.',
    {
      action: z.enum(['create', 'update', 'delete']).describe('Action to perform'),
      id: z.number().optional().describe('Recipe ID (required for update/delete)'),
      name: z.string().optional().describe('Recipe name (required for create, unique)'),
      hardwoodPct: z.number().optional().describe('Hardwood percentage'),
      wheatbranPct: z.number().optional().describe('Wheat bran percentage'),
      gypsumPct: z.number().optional().describe('Gypsum percentage'),
      rhPct: z.number().optional().describe('Relative humidity percentage'),
      notes: z.string().optional().describe('Notes')
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'create': {
            if (!params.name) return errResult('name is required for create');
            const id = db.insertRecipe(database, {
              name: params.name,
              hardwood_pct: params.hardwoodPct || 0,
              wheatbran_pct: params.wheatbranPct || 0,
              gypsum_pct: params.gypsumPct || 0,
              rh_pct: params.rhPct || 0,
              notes: params.notes || null,
              created: new Date().toISOString()
            });
            notify();
            return json({ success: true, action: 'create', id: Number(id), name: params.name });
          }
          case 'update': {
            if (params.id == null) return errResult('id is required for update');
            db.updateRecipe(database, params.id, {
              name: params.name,
              hardwood_pct: params.hardwoodPct,
              wheatbran_pct: params.wheatbranPct,
              gypsum_pct: params.gypsumPct,
              rh_pct: params.rhPct,
              notes: params.notes
            });
            notify();
            return json({ success: true, action: 'update', id: params.id });
          }
          case 'delete': {
            if (params.id == null) return errResult('id is required for delete');
            const removed = db.deleteRecipe(database, params.id);
            if (!removed) return errResult('Recipe not found: ' + params.id);
            notify();
            return json({ success: true, action: 'delete', id: params.id });
          }
          default:
            return errResult('Unknown action: ' + params.action);
        }
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // Example: list_recipes()
  server.tool(
    'list_recipes',
    'List all substrate recipes with their compositions. READ-ONLY. Use manage_recipes to create/update/delete.',
    {},
    async () => {
      return json(db.getAllRecipes(database));
    }
  );

  // ──────────────────────────────────────────────────────────
  // TRACEABILITY
  // ──────────────────────────────────────────────────────────

  // Example: trace_lineage({ entityType: 'batch', entityId: 'FB-2025-042' })
  server.tool(
    'trace_lineage',
    'Trace the origin chain of a batch or culture backwards: batch → source culture → parent culture → ... Shows the full production genealogy. READ-ONLY.',
    {
      entityType: z.enum(['batch', 'culture']).describe('Type of entity to trace'),
      entityId: z.string().describe('Batch ID or Culture ID')
    },
    async (params) => {
      return json({ chain: db.traceLineageBack(database, params.entityType, params.entityId) });
    }
  );

  // Example: trace_forward({ cultureId: 'MC-KINGS-250301-01' })
  server.tool(
    'trace_forward',
    'Trace everything produced from a culture forward: child cultures, batches, and harvests. Shows the complete downstream output. READ-ONLY.',
    {
      cultureId: z.string().describe('Culture ID to trace from')
    },
    async (params) => {
      return json(db.traceLineageForward(database, params.cultureId));
    }
  );

  // ──────────────────────────────────────────────────────────
  // PRODUCTION PIPELINE
  // ──────────────────────────────────────────────────────────

  // Example: get_production_pipeline()
  server.tool(
    'get_production_pipeline',
    'Get a full production pipeline overview: active cultures by type/status, batches by type and phase (incubating vs ready), bags per zone with capacity utilization. READ-ONLY snapshot of the entire operation.',
    {},
    async () => {
      return json(db.getProductionPipeline(database));
    }
  );

  // ──────────────────────────────────────────────────────────
  // MAINTENANCE
  // ──────────────────────────────────────────────────────────

  // Example: schedule_maintenance({ type: 'autoclave_cycle', assetId: 'AK-001', scheduledDate: '2025-04-15' })
  server.tool(
    'schedule_maintenance',
    'Schedule a maintenance task for an asset or zone (e.g. autoclave cycle, HEPA filter change, laminar flow cleaning). Creates an open maintenance entry with a due date.',
    {
      type: z.string().describe('Maintenance type (e.g. autoclave_cycle, hepa_filter, cleaning, calibration)'),
      assetId: z.string().optional().describe('Asset ID (for equipment maintenance)'),
      zoneId: z.string().optional().describe('Zone ID (for room/zone maintenance)'),
      description: z.string().optional().describe('Detailed description'),
      scheduledDate: z.string().optional().describe('ISO date when maintenance is due'),
      notes: z.string().optional().describe('Notes')
    },
    async (params) => {
      try {
        if (!params.assetId && !params.zoneId) {
          return errResult('Either assetId or zoneId is required');
        }
        const id = db.insertMaintenance(database, {
          assetId: params.assetId || null,
          zoneId: params.zoneId || null,
          type: params.type,
          description: params.description || null,
          scheduledDate: params.scheduledDate || null,
          notes: params.notes || null
        });
        notify();
        return json({ success: true, id: Number(id), type: params.type });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // Example: complete_maintenance({ id: 1, completedBy: 'Julian' })
  server.tool(
    'complete_maintenance',
    'Mark a scheduled maintenance task as completed. Records who completed it and when.',
    {
      id: z.number().describe('Maintenance log entry ID'),
      completedBy: z.string().optional().describe('Name of person who completed the maintenance'),
      notes: z.string().optional().describe('Completion notes')
    },
    async (params) => {
      try {
        db.completeMaintenance(database, params.id, params.completedBy || null, params.notes || null);
        notify();
        return json({ success: true, id: params.id });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  // Example: get_maintenance_due()
  server.tool(
    'get_maintenance_due',
    'Get all due/overdue maintenance tasks (not yet completed). READ-ONLY. To schedule new maintenance use schedule_maintenance, to complete use complete_maintenance.',
    {
      assetId: z.string().optional().describe('Filter by asset ID'),
      zoneId: z.string().optional().describe('Filter by zone ID'),
      limit: z.number().optional().describe('Max entries (for history)')
    },
    async (params) => {
      if (params.assetId || params.zoneId || params.limit) {
        return json(
          db.getMaintenanceHistory(database, params.assetId || null, params.zoneId || null, params.limit || 50)
        );
      }
      return json(db.getMaintenanceDue(database));
    }
  );

  // ──────────────────────────────────────────────────────────
  // LABEL PRINTING
  // ──────────────────────────────────────────────────────────

  server.tool(
    'get_printer_status',
    'Check whether the Zebra label printer is connected and available',
    {},
    async () => {
      if (!printer || !printer.checkPrinterAvailable) {
        return errResult('Printer functions not available (server not configured for printing)');
      }
      return new Promise((resolve) => {
        printer.checkPrinterAvailable((err, found) => {
          resolve(json({ available: !!found, printerName: 'ZDesigner GK420d' }));
        });
      });
    }
  );

  server.tool(
    'print_bag_labels',
    'Generate and print bag labels for a batch. Set preview=true to return ZPL without printing.',
    {
      batchId: z.string().describe('Batch ID (e.g. FB-2025-042)'),
      detail: z
        .enum(['minimal', 'sorte', 'full'])
        .optional()
        .describe('Label detail level (default: sorte). minimal=barcode+ID, sorte=+strain/notes, full=+due date'),
      qr: z.boolean().optional().describe('Use QR code instead of barcode (default: false)'),
      bagFrom: z.number().optional().describe('Start of bag range (1-based, inclusive)'),
      bagTo: z.number().optional().describe('End of bag range (1-based, inclusive)'),
      preview: z.boolean().optional().describe('If true, return ZPL string without sending to printer (default: false)')
    },
    async (params) => {
      try {
        const batch = db.readBatchById(database, params.batchId);
        if (!batch) return errResult('Batch not found: ' + params.batchId);

        let bags = batch.bags;
        if (params.bagFrom || params.bagTo) {
          const from = (params.bagFrom || 1) - 1;
          const to = params.bagTo || bags.length;
          bags = bags.slice(from, to);
        }
        if (!bags.length) return errResult('No bags in selected range');

        const barcodes = db.assignBarcodes(database, 'bag', bags);
        const detail = params.detail || 'sorte';
        const useQr = params.qr || false;

        // Pass per-bag weight when batch has mixed weights
        const wVals = batch.bagWeights ? new Set(Object.values(batch.bagWeights)) : new Set();
        const mixed = wVals.size > 1;
        const zpl = bags
          .map((bagId) => {
            const bk = mixed && batch.bagWeights ? batch.bagWeights[bagId] : null;
            return itemsToZPL(bagLabelItems(bagId, batch, detail, barcodes[bagId], useQr, bk));
          })
          .join('\n');

        if (params.preview) {
          return json({ success: true, batchId: params.batchId, labelCount: bags.length, zpl });
        }

        if (!printer || !printer.printZPL) {
          return errResult('Printer functions not available (server not configured for printing)');
        }

        return new Promise((resolve) => {
          printer.checkPrinterAvailable((_, found) => {
            if (!found) {
              resolve(errResult('Printer not found. Check that the Zebra printer is connected and powered on.'));
              return;
            }
            printer.printZPL(zpl, (err) => {
              if (err) {
                resolve(errResult('Print failed: ' + err));
              } else {
                resolve(json({ success: true, batchId: params.batchId, labelCount: bags.length, printed: true }));
              }
            });
          });
        });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  server.tool(
    'print_culture_labels',
    'Generate and print labels for mushroom cultures. Set preview=true to return ZPL without printing.',
    {
      cultureIds: z.array(z.string()).describe('Array of culture IDs to print (e.g. ["MC-KINGS-250301-01"])'),
      detail: z
        .enum(['minimal', 'sorte', 'full'])
        .optional()
        .describe('Label detail level (default: sorte). minimal=barcode+ID, sorte=+species/strain, full=+date'),
      qr: z.boolean().optional().describe('Use QR code instead of barcode (default: false)'),
      preview: z.boolean().optional().describe('If true, return ZPL string without sending to printer (default: false)')
    },
    async (params) => {
      try {
        if (!params.cultureIds.length) return errResult('No culture IDs provided');
        const allCultures = db.getAllCultures(database);
        const cultureMap = new Map(allCultures.map((c) => [c.id, c]));

        const missing = params.cultureIds.filter((id) => !cultureMap.has(id));
        if (missing.length) return errResult('Cultures not found: ' + missing.join(', '));

        const barcodes = db.assignBarcodes(database, 'culture', params.cultureIds);
        const detail = params.detail || 'sorte';
        const useQr = params.qr || false;

        const zpl = params.cultureIds
          .map((id) => {
            const c = cultureMap.get(id);
            return itemsToZPL(labLabelItems(id, c, detail, barcodes[id], useQr));
          })
          .join('\n');

        if (params.preview) {
          return json({ success: true, labelCount: params.cultureIds.length, zpl });
        }

        if (!printer || !printer.printZPL) {
          return errResult('Printer functions not available (server not configured for printing)');
        }

        return new Promise((resolve) => {
          printer.checkPrinterAvailable((_, found) => {
            if (!found) {
              resolve(errResult('Printer not found. Check that the Zebra printer is connected and powered on.'));
              return;
            }
            printer.printZPL(zpl, (err) => {
              if (err) {
                resolve(errResult('Print failed: ' + err));
              } else {
                resolve(json({ success: true, labelCount: params.cultureIds.length, printed: true }));
              }
            });
          });
        });
      } catch (e) {
        return errResult(e.message);
      }
    }
  );

  return server;
}

module.exports = {
  createMcpServer,
  buildBagLocationMap,
  bcParams,
  zplText,
  itemsToZPL,
  bagLabelItems,
  labLabelItems,
  fmtDt
};
