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
//
// ── Why the board keeps its own marks ──────────────────────────────────────
//
// Billbee's state cannot say whether a parcel has been packed. Its timed rules
// buy the GLS label and set the order to "Versendet" at 07:00 and 12:00, before
// anybody has packed it — and that label day is exactly when the parcel has to
// go out. So an order leaves "Heute packen" only when someone taps "Gepackt"
// here, and a made-to-order one reaches it only when someone taps
// "Hergestellt". Both marks live in this app's database (order_marks, keyed on
// the Billbee order id, with who and when). Billbee's state is shown on the
// card as information, and nothing is ever written back to Billbee.

// How far back the board looks. The same window the Billbee sync pulls, so the
// board never shows an order whose state the sync has stopped refreshing.
const BOARD_WINDOW_DAYS = 30;
// A sync older than this is reported as stale: the poll runs every 15 minutes,
// so an hour without one means it has stopped, not that it is slow.
const SYNC_STALE_MS = 60 * 60 * 1000;
// The farm's day. Orders arrive stamped in UTC; "today" and "in four working
// days" are counted in the time zone the team works in.
const BOARD_TZ = 'Europe/Berlin';

// Products made fresh for each order rather than taken from the shelf. Their
// parcel waits until somebody marks them made, and Billbee buys the label by its
// own rule a fixed number of working days after the order. The figure here has
// to match that rule; the board shows it as the planned label day.
const MADE_TO_ORDER = [{ skuPrefix: 'SPWN-DUBL-', labelAfterWorkdays: 4 }];

// The Billbee tag its rules set on orders that go out in one parcel.
const COMBINE_TAG = 'ZUSAMMENFASSEN';

// Billbee states that take an order off the board: Reklamation (5, returns and
// refunds), gelöscht (6), storniert (8). Billbee's import maps 6 and 8 to the
// hub's 'cancelled' already; 5 it leaves open, because a return is not a
// cancellation for the books, but it is nothing to pack.
const DROPPED_STATES = [5, 6, 8];

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

/**
 * What Billbee says about the order, for the card: 'label' once a label has
 * been bought, 'shipped' once Billbee calls it versendet without one, 'open'
 * otherwise. Information only — none of the three takes an order off the list.
 */
function billbeeState(order) {
  const raw = order.raw || {};
  if (raw.LabelAt || Number(raw.LabelCount) > 0) return 'label';
  if (order.status === 'shipped') return 'shipped';
  return 'open';
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

function _mark(order, kind) {
  const m = order.marks && order.marks[kind];
  return m && m.at ? { by: m.by || null, at: m.at } : null;
}

/**
 * Turn the stored orders into the board.
 *
 * @param {Array} orders  rows from db.listBoardOrders: {id, channel,
 *   channelOrderId, status, orderDate, raw, items:[{sku, title, qty}],
 *   marks:{packed?:{by, at}, made?:{by, at}}}
 * @param {object} [opts]
 * @param {Date|string} [opts.now]         for tests; defaults to the current time
 * @param {string|null} [opts.marksSince]  when the marks began (db.orderMarksSince)
 * @param {Array} [opts.rules]             made-to-order rules; defaults to MADE_TO_ORDER
 */
function buildOrderBoard(orders, { now = new Date(), marksSince = null, rules = MADE_TO_ORDER } = {}) {
  const today = localDay(now);
  const open = [];
  const done = [];
  let unpaid = 0;

  for (const o of orders || []) {
    const raw = o.raw || {};
    if (o.status === 'cancelled' || DROPPED_STATES.includes(Number(raw.State))) continue;
    const packed = _mark(o, 'packed');
    const made = _mark(o, 'made');
    const bb = billbeeState(o);
    // Packed before the board could be tapped: a label bought (or the order
    // shipped) before the marks began went out without anybody marking it.
    if (!packed && bb !== 'open' && marksSince) {
      const when = raw.LabelAt || raw.ShippedAt || o.orderDate;
      // Compared as instants: Billbee writes its own offset, the app writes UTC.
      if (when && new Date(when).getTime() < new Date(marksSince).getTime()) continue;
    }
    if (!packed && bb === 'open' && !isPaid(o)) {
      unpaid++;
      continue;
    }
    const orderDay = localDay(o.orderDate);
    let plannedLabelDay = null;
    const items = (o.items || []).map((it) => {
      const rule = madeToOrderRule(it.sku, rules);
      if (rule) {
        const d = addWorkdays(orderDay, rule.labelAfterWorkdays);
        if (d && (!plannedLabelDay || d > plannedLabelDay)) plannedLabelDay = d;
      }
      return { sku: it.sku || null, title: it.title || null, qty: Number(it.qty) || 1, madeToOrder: !!rule };
    });
    const madeToOrder = items.some((it) => it.madeToOrder);
    const tags = _tags(o);
    const row = {
      id: o.id,
      channel: o.channel,
      shop: _shopName(o),
      number: raw.OrderNumber || o.channelOrderId,
      billbee: bb,
      orderDate: o.orderDate || null,
      orderDay,
      items,
      madeToOrder,
      plannedLabelDay,
      // The label day has come (or gone): Billbee buys it today or already did.
      labelDue: !!plannedLabelDay && plannedLabelDay <= today,
      packed,
      made: madeToOrder ? made : null,
      // Waiting for something to be made before it can go into a parcel.
      needsMaking: madeToOrder && !made,
      tags,
      customerKey: raw.CustomerKey || null,
      taggedCombine: tags.some((t) => t.toUpperCase() === COMBINE_TAG),
      webUrl: _webUrl(o),
      combine: null,
      waitsForGroup: false
    };
    if (packed) {
      // Erledigt heute: packed today. Packed on an earlier day is simply done.
      if (localDay(packed.at) === today) done.push(row);
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
    // One parcel is packed when its last part is made: a shelf order from the
    // same buyer as an unmade made-to-order one waits with it rather than going
    // out alone and costing a second postage.
    const waiting = group.some((r) => r.needsMaking);
    for (const r of group) {
      r.combine = { key, size: group.length };
      if (waiting && !r.needsMaking) r.waitsForGroup = true;
    }
  }
  for (const r of open) {
    if (!r.combine && r.taggedCombine) r.combine = { key: null, size: 1 };
  }

  const pack = open.filter((r) => !r.needsMaking && !r.waitsForGroup);
  const later = open.filter((r) => r.needsMaking || r.waitsForGroup);
  // A bought label first: that parcel has to leave today. Then the oldest.
  const urgency = (r) => (r.billbee === 'open' ? 1 : 0);
  _sortKeepingGroups(pack, (a, b) => _cmp(urgency(a), urgency(b)) || _cmp(a.orderDate, b.orderDate));
  _sortKeepingGroups(later, (a, b) => _cmp(a.plannedLabelDay, b.plannedLabelDay) || _cmp(a.orderDate, b.orderDate));
  done.sort((a, b) => _cmp(b.packed.at, a.packed.at));

  return {
    today,
    windowDays: BOARD_WINDOW_DAYS,
    pack,
    later,
    make: buildMakeList(open, today),
    done,
    unpaid
  };
}

/**
 * What has to be made: the made-to-order lines of every open order nobody has
 * marked made yet, totalled per SKU, each with the days their labels are due.
 * Sorted by the earliest of those days — the next thing to make is the one
 * whose label comes first.
 */
function buildMakeList(open, today) {
  const bySku = new Map();
  for (const r of open) {
    if (!r.needsMaking) continue;
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
        // Due today or late: the label is bought, the product is not made.
        overdue: byDay.length ? byDay[0].day <= today : false,
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
  billbeeState,
  buildOrderBoard,
  buildMakeList,
  syncProblem
};
