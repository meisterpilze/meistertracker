'use strict';
// The packing board: incoming shop orders, read as the two questions the floor
// asks of them every morning — what goes into a parcel today, and what has to be
// made first.
//
// The orders themselves arrive through the Billbee sync in server.js (every
// 15 minutes, channels.js → billbee.fetchOrders), so nothing here talks to the
// network. This module only reads what the sync stored and sorts it: pure
// functions over plain objects, so the tests can hand it orders directly.
//
// It never sees a customer. The Billbee import keeps no name, address or e-mail
// (see _billbeeLabRecord in channels.js), and what a packer needs to know about
// the buyer is only "these two orders go to the same person", which the import
// carries as an anonymous key.

// How far back the board looks. The same window the Billbee sync pulls, so the
// board never shows an order whose state the sync has stopped refreshing.
const BOARD_WINDOW_DAYS = 30;
// Recently shipped orders stay visible this long, so "did that one go out?" has
// an answer on the same screen.
const SHIPPED_SHOW_DAYS = 3;
const SHIPPED_SHOW_MAX = 30;
// A sync older than this is reported as stale: the poll runs every 15 minutes,
// so an hour without one means it has stopped, not that it is slow.
const SYNC_STALE_MS = 60 * 60 * 1000;
// The farm's day. Orders arrive stamped in UTC; "today" and "in four working
// days" are counted in the time zone the team works in.
const BOARD_TZ = 'Europe/Berlin';

// Products made fresh for each order rather than taken from the shelf. Their
// parcel waits until they are made, and Billbee buys the label by its own rule
// a fixed number of working days after the order. The figure here has to match
// that rule; it is what the board shows as the planned label day.
const MADE_TO_ORDER = [{ skuPrefix: 'SPWN-DUBL-', labelAfterWorkdays: 4 }];

// The Billbee tag its rules set on orders that go out in one parcel.
const COMBINE_TAG = 'ZUSAMMENFASSEN';

const _dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BOARD_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** 'YYYY-MM-DD' of an instant, in the farm's time zone. null for no date. */
function localDay(iso) {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return _dayFmt.format(d);
}

/**
 * The day `n` working days after `day`, counting Monday to Friday (public
 * holidays are not taken out). Day 1 is the first working day *after* the order
 * day, so an order from Monday lands on Friday, and one from Saturday or Sunday
 * on the Thursday after.
 */
function addWorkdays(day, n) {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  let left = Math.max(0, n | 0);
  while (left > 0) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    const wd = dt.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return dt.toISOString().slice(0, 10);
}

/** The made-to-order rule a SKU falls under, or null for a shelf product. */
function madeToOrderRule(sku, rules = MADE_TO_ORDER) {
  const s = String(sku || '').toUpperCase();
  if (!s) return null;
  return rules.find((r) => s.startsWith(r.skuPrefix.toUpperCase())) || null;
}

/**
 * Paid, as far as the stored record says. Billbee states it twice — a payment
 * date, and state 3 ("bezahlt") — and either is enough. Orders from the direct
 * shop connections arrive only once they are paid, so they count as paid.
 */
function isPaid(order) {
  if (order.channel !== 'billbee') return true;
  const raw = order.raw || {};
  return !!raw.PayedAt || Number(raw.State) === 3;
}

function _shopName(order) {
  const raw = order.raw || {};
  return (order.channel === 'billbee' && raw.ShopName) || null;
}

function _tags(order) {
  const raw = order.raw || {};
  return Array.isArray(raw.Tags) ? raw.Tags.map(String) : [];
}

/** A link into Billbee, only when it is one. */
function _webUrl(order) {
  const u = order.raw && order.raw.WebUrl;
  return typeof u === 'string' && /^https:\/\//i.test(u) ? u : null;
}

/**
 * Turn the stored orders into the board.
 *
 * @param {Array} orders  rows from db.listBoardOrders: {id, channel,
 *   channelOrderId, status, orderDate, raw, items:[{sku, title, qty}]}
 * @param {object} [opts]
 * @param {Date|string} [opts.now]  for tests; defaults to the current time
 * @param {Array} [opts.rules]      made-to-order rules; defaults to MADE_TO_ORDER
 */
function buildOrderBoard(orders, { now = new Date(), rules = MADE_TO_ORDER } = {}) {
  const today = localDay(now);
  const shippedFloor = addDays(today, -SHIPPED_SHOW_DAYS);
  const open = [];
  const shipped = [];
  let unpaid = 0;

  for (const o of orders || []) {
    const orderDay = localDay(o.orderDate);
    // The parcel waits for the slowest product in it: an order with one
    // made-to-order line goes out with that line, not before.
    let plannedLabelDay = null;
    const items = (o.items || []).map((it) => {
      const rule = madeToOrderRule(it.sku, rules);
      if (rule) {
        const d = addWorkdays(orderDay, rule.labelAfterWorkdays);
        if (d && (!plannedLabelDay || d > plannedLabelDay)) plannedLabelDay = d;
      }
      return { sku: it.sku || null, title: it.title || null, qty: Number(it.qty) || 1, madeToOrder: !!rule };
    });
    const tags = _tags(o);
    const row = {
      id: o.id,
      channel: o.channel,
      shop: _shopName(o),
      number: (o.raw && o.raw.OrderNumber) || o.channelOrderId,
      status: o.status,
      packed: o.status === 'ready',
      orderDate: o.orderDate || null,
      orderDay,
      items,
      madeToOrder: items.some((it) => it.madeToOrder),
      plannedLabelDay,
      // Ready to pack: a shelf order the day it comes in, a made-to-order one
      // on its planned label day (or after, if it is running late).
      readyDay: plannedLabelDay || orderDay,
      tags,
      customerKey: (o.raw && o.raw.CustomerKey) || null,
      taggedCombine: tags.some((t) => t.toUpperCase() === COMBINE_TAG),
      webUrl: _webUrl(o),
      combine: null
    };
    if (o.status === 'cancelled') continue;
    if (o.status === 'shipped') {
      const shippedDay = localDay((o.raw && o.raw.ShippedAt) || o.orderDate);
      if (shippedDay && shippedDay >= shippedFloor) shipped.push({ ...row, shippedDay });
      continue;
    }
    if (!isPaid(o)) {
      unpaid++;
      continue;
    }
    open.push(row);
  }

  // Orders that go out in one parcel. Billbee's tag says so outright; two open
  // orders from the same buyer say so too, whether or not a rule tagged them.
  const byKey = new Map();
  for (const r of open) {
    if (!r.customerKey) continue;
    if (!byKey.has(r.customerKey)) byKey.set(r.customerKey, []);
    byKey.get(r.customerKey).push(r);
  }
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    // One parcel leaves when its last part is ready: a shelf order from the
    // same buyer as a made-to-order one waits for it rather than going out
    // alone and costing a second postage.
    let ready = null;
    for (const r of group) if (r.readyDay && (!ready || r.readyDay > ready)) ready = r.readyDay;
    for (const r of group) {
      r.combine = { key, size: group.length };
      if (ready) r.readyDay = ready;
    }
  }
  for (const r of open) {
    if (!r.combine && r.taggedCombine) r.combine = { key: null, size: 1 };
  }

  const pack = open.filter((r) => !r.readyDay || r.readyDay <= today);
  const later = open.filter((r) => r.readyDay && r.readyDay > today);
  _sortKeepingGroups(
    pack,
    (a, b) => _cmp(a.packed, b.packed) || _cmp(a.readyDay, b.readyDay) || _cmp(a.orderDate, b.orderDate)
  );
  _sortKeepingGroups(later, (a, b) => _cmp(a.readyDay, b.readyDay) || _cmp(a.orderDate, b.orderDate));
  shipped.sort((a, b) => _cmp(b.shippedDay, a.shippedDay) || _cmp(b.orderDate, a.orderDate));

  return {
    today,
    windowDays: BOARD_WINDOW_DAYS,
    pack,
    later,
    make: buildMakeList(open, today),
    unpaid,
    shipped: shipped.slice(0, SHIPPED_SHOW_MAX)
  };
}

/**
 * What has to be made: the made-to-order lines of every open, paid order that
 * has not been packed yet, totalled per SKU, each with the days its parcels are
 * due to leave. Sorted by the earliest of those days — the next thing to make
 * is the one whose label comes first.
 */
function buildMakeList(open, today) {
  const bySku = new Map();
  for (const r of open) {
    if (r.packed) continue;
    for (const it of r.items) {
      if (!it.madeToOrder) continue;
      const key = String(it.sku).toUpperCase();
      if (!bySku.has(key)) bySku.set(key, { sku: it.sku, title: it.title, qty: 0, orders: 0, days: new Map() });
      const m = bySku.get(key);
      m.qty += it.qty;
      m.orders++;
      if (!m.title && it.title) m.title = it.title;
      const day = r.plannedLabelDay || today;
      m.days.set(day, (m.days.get(day) || 0) + it.qty);
    }
  }
  return [...bySku.values()]
    .map((m) => {
      const byDay = [...m.days.entries()].sort((a, b) => _cmp(a[0], b[0])).map(([day, qty]) => ({ day, qty }));
      return {
        sku: m.sku,
        title: m.title,
        qty: m.qty,
        orders: m.orders,
        earliestDay: byDay.length ? byDay[0].day : null,
        overdue: byDay.length ? byDay[0].day < today : false,
        byDay
      };
    })
    .sort((a, b) => _cmp(a.earliestDay, b.earliestDay) || _cmp(a.sku, b.sku));
}

/**
 * Where the board's data stands, as one word the interface can say in plain
 * language. The raw sync error is a message like "Billbee Aufträge HTTP 401" —
 * accurate, and of no use to someone at a packing table.
 */
function syncProblem(cfg, { now = new Date() } = {}) {
  if (!cfg || !cfg.enabled) return 'off';
  if (!cfg.connected) return 'not_connected';
  const err = String(cfg.lastError || '');
  if (err) {
    if (/HTTP 40[13]\b|Doppelpunkt|fehlt|erforderlich/i.test(err)) return 'auth';
    if (/HTTP 429\b/.test(err)) return 'busy';
    if (/HTTP 5\d\d\b/.test(err)) return 'down';
    if (/timeout|abort|fetch failed|ENOTFOUND|ECONNRE|EAI_AGAIN|network/i.test(err)) return 'offline';
    return 'failed';
  }
  if (!cfg.lastSync) return 'never';
  const age = new Date(now).getTime() - new Date(cfg.lastSync).getTime();
  if (Number.isFinite(age) && age > SYNC_STALE_MS) return 'stale';
  return null;
}

function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function _cmp(a, b) {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

// Sort, then pull each combine group together at the position of its first
// member, so the two orders for one parcel sit next to each other on the list.
function _sortKeepingGroups(rows, cmp) {
  rows.sort(cmp);
  const out = [];
  const placed = new Set();
  for (const r of rows) {
    if (placed.has(r)) continue;
    const key = r.combine && r.combine.key;
    const group = key ? rows.filter((x) => x.combine && x.combine.key === key) : [r];
    for (const g of group) {
      out.push(g);
      placed.add(g);
    }
  }
  rows.splice(0, rows.length, ...out);
}

module.exports = {
  BOARD_WINDOW_DAYS,
  MADE_TO_ORDER,
  COMBINE_TAG,
  localDay,
  addWorkdays,
  madeToOrderRule,
  isPaid,
  buildOrderBoard,
  buildMakeList,
  syncProblem
};
