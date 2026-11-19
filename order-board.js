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

// Positions that are not things to pack: Billbee hands discounts over as lines
// of their own, often without a SKU.
const NON_ITEM_TITLE = /^\s*(rabatt|gutschein|discount|coupon|versand|shipping)\b/i;

/** The lines of an order that are something to pack, with their quantity. */
function packLines(items) {
  const out = [];
  for (const it of items || []) {
    const qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!it.sku && NON_ITEM_TITLE.test(String(it.title || ''))) continue;
    out.push({ sku: it.sku || null, title: it.title || null, qty });
  }
  return out;
}

/**
 * A refund, not an order. When a purchase is refunded Billbee keeps a copy of
 * it with negative quantities, in state "bestellt" for good — it would sit on
 * the board as an unpaid order for a month. Nothing in it is positive.
 */
function isRefundRecord(items) {
  const qtys = (items || []).map((it) => Number(it.qty)).filter(Number.isFinite);
  return qtys.some((q) => q < 0) && !qtys.some((q) => q > 0);
}

/**
 * A SKU read as product and size. The shop's SKUs are PRODUCT-VARIANT, where
 * the variant is either "<count>x<grams>" (KOMP-AIOCVG-3x1750: three bags of
 * 1750 g) or a name (SPWN-DUBL-BLUE). The product is the first two parts.
 * Anything else counts as one of whatever the rest says.
 */
function skuParts(sku) {
  const parts = String(sku || '')
    .trim()
    .split('-');
  const product = parts.slice(0, 2).join('-');
  const variant = parts.slice(2).join('-');
  const m = /^(\d+)x(\d+)$/i.exec(variant);
  if (m) return { product, variant, perPack: Number(m[1]) || 1, size: m[2], grams: Number(m[2]) };
  return { product, variant, perPack: 1, size: variant || null, grams: null };
}

/**
 * Everything the open orders need, counted once: per product the number of
 * pieces (bags, plugs, kits), how many of each size, and which SKUs were
 * ordered. This is the shelf list — pull it all, then pack order by order.
 */
function buildTotals(rows) {
  const byProduct = new Map();
  for (const r of rows) {
    for (const it of r.items) {
      const key = it.sku ? skuParts(it.sku).product.toUpperCase() : 'ohne-sku:' + String(it.title || '?');
      if (!byProduct.has(key)) {
        byProduct.set(key, {
          product: it.sku ? skuParts(it.sku).product : null,
          title: it.sku ? null : it.title || null,
          pieces: 0,
          orders: new Set(),
          sizes: new Map(),
          skus: new Map(),
          madeToOrder: false
        });
      }
      const t = byProduct.get(key);
      const p = it.sku ? skuParts(it.sku) : { perPack: 1, size: null, grams: null };
      const pieces = p.perPack * it.qty;
      t.pieces += pieces;
      t.orders.add(r.id);
      if (it.madeToOrder) t.madeToOrder = true;
      const sizeKey = p.size == null ? '' : String(p.size);
      const sz = t.sizes.get(sizeKey) || { size: p.size, grams: p.grams, pieces: 0 };
      sz.pieces += pieces;
      t.sizes.set(sizeKey, sz);
      if (it.sku) t.skus.set(it.sku, (t.skus.get(it.sku) || 0) + it.qty);
    }
  }
  return [...byProduct.values()]
    .map((t) => ({
      product: t.product,
      title: t.title,
      pieces: t.pieces,
      orders: t.orders.size,
      madeToOrder: t.madeToOrder,
      sizes: [...t.sizes.values()].sort(
        (a, b) => _cmp(a.grams, b.grams) || _cmp(String(a.size || ''), String(b.size || ''))
      ),
      skus: [...t.skus.entries()].sort((a, b) => _cmp(a[0], b[0])).map(([sku, qty]) => ({ sku, qty }))
    }))
    .sort((a, b) => _cmp(a.product || a.title, b.product || b.title));
}

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
function buildOrderBoard(
  orders,
  { now = new Date(), marksSince = null, showNames = false, rules = MADE_TO_ORDER } = {}
) {
  const today = localDay(now);
  const open = [];
  const done = [];
  let unpaid = 0;

  for (const o of orders || []) {
    const raw = o.raw || {};
    if (o.status === 'cancelled' || DROPPED_STATES.includes(Number(raw.State))) continue;
    if (isRefundRecord(o.items)) continue;
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
    const items = packLines(o.items).map((it) => {
      const rule = madeToOrderRule(it.sku, rules);
      if (rule) {
        const d = addWorkdays(orderDay, rule.labelAfterWorkdays);
        if (d && (!plannedLabelDay || d > plannedLabelDay)) plannedLabelDay = d;
      }
      return { ...it, madeToOrder: !!rule };
    });
    const madeToOrder = items.some((it) => it.madeToOrder);
    const tags = _tags(o);
    const row = {
      id: o.id,
      channel: o.channel,
      shop: _shopName(o),
      // Who it is for, first on the card — only for users who may see it.
      customer: showNames ? o.customerName || null : null,
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
    totals: buildTotals(open),
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

// ── Scanning the label on a packed parcel ──────────────────────────────────
//
// A GLS label carries three codes: a barcode, a large square code and a small
// one. Which of them holds the parcel number is the carrier's business, so a
// scan is matched loosely: it counts when the parcel number Billbee reported
// for an order (raw.LabelIds) is inside it, or it is inside that number. The
// small square code holds only the address, fields split by "|"; for that one
// the recipient's name is matched against the open orders instead. Whatever was
// scanned is only compared here, never stored or logged: the address is on it.

// Shorter than this, a number matches too much by accident.
const LABEL_MIN_LEN = 8;

function _labelClean(s) {
  return String(s == null ? '' : s)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

function _nameClean(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The parcel numbers an order has, as Billbee reported them. */
function labelIds(order) {
  const ids = order && order.raw && Array.isArray(order.raw.LabelIds) ? order.raw.LabelIds : [];
  return ids.map((x) => String(x || '').trim()).filter(Boolean);
}

/** An order the board still counts: not cancelled, dropped or a refund. */
function isLiveOrder(o) {
  return o.status !== 'cancelled' && !DROPPED_STATES.includes(Number((o.raw || {}).State)) && !isRefundRecord(o.items);
}

/**
 * Which order(s) a scanned label belongs to.
 *
 * A parcel number in the code always wins; only a code without one is read as
 * the address code. Numbers are grouped per order, so a code that carries two
 * numbers of the same order (parcel number and tracking id, say) still finds
 * it; numbers of two different orders make it 'ambiguous', unless those orders
 * share every number (two orders merged into one parcel).
 *
 * The address code names a person, not a parcel. It decides only when exactly
 * one open order of that name has a label: two open parcels for one person
 * are 'ambiguous', and an order with two labels is 'severalLabels' (the code is
 * the same on both). No open order with a label is 'unknown', so the caller
 * can fetch fresh labels from Billbee; 'onlyPacked' says the name fits only
 * orders that are packed already, which may still be a new order not yet here.
 *
 * @param {string} code    what the scanner read
 * @param {Array} orders   rows from db.listBoardOrders
 * @returns {{via:'label', labels:string[], orders:Array}
 *          |{via:'name', orders:Array}
 *          |{error:'unknown'|'ambiguous'|'severalLabels'|'onlyPacked', orders?:Array}}
 */
function matchLabelScan(code, orders) {
  const live = (orders || []).filter(isLiveOrder);
  const text = String(code == null ? '' : code);
  const scan = _labelClean(text);
  if (scan.length >= LABEL_MIN_LEN) {
    const byOrder = new Map();
    for (const o of live) {
      for (const id of labelIds(o)) {
        const c = _labelClean(id);
        if (c.length < LABEL_MIN_LEN) continue;
        if (!scan.includes(c) && !c.includes(scan)) continue;
        if (!byOrder.has(o)) byOrder.set(o, []);
        byOrder.get(o).push(id);
      }
    }
    if (byOrder.size) {
      const sets = [...byOrder.values()].map((ids) => [...new Set(ids)].sort().join('\u0000'));
      if (new Set(sets).size > 1) return { error: 'ambiguous' };
      const [ids] = [...byOrder.values()];
      return { via: 'label', labels: [...new Set(ids)], orders: [...byOrder.keys()] };
    }
  }
  if (!text.includes('|')) return { error: 'unknown' };
  const names = new Set(
    text
      .split('|')
      .map(_nameClean)
      .filter((n) => n.length >= 3)
  );
  const hits = live.filter((o) => o.customerName && names.has(_nameClean(o.customerName)));
  const open = hits.filter((o) => !_mark(o, 'packed'));
  const labelled = open.filter((o) => labelIds(o).length > 0);
  if (labelled.length > 1) return { error: 'ambiguous', orders: labelled };
  if (labelled.length === 1) {
    if (labelIds(labelled[0]).length > 1) return { error: 'severalLabels', orders: labelled };
    return { via: 'name', orders: labelled };
  }
  if (!open.length && hits.length) return { error: 'onlyPacked', orders: hits };
  return { error: 'unknown' };
}

module.exports = {
  BOARD_WINDOW_DAYS,
  DROPPED_STATES,
  isLiveOrder,
  labelIds,
  matchLabelScan,
  MADE_TO_ORDER,
  COMBINE_TAG,
  localDay,
  addWorkdays,
  madeToOrderRule,
  isPaid,
  isRefundRecord,
  skuParts,
  billbeeState,
  buildTotals,
  buildOrderBoard,
  buildMakeList,
  syncProblem
};
