'use strict';
// Bestellungen → Packen: the shop orders from Billbee, read as "what to pack
// today" and "what to make first" (order-board.js).
//
// Every order here is invented: Erika Musterfrau and Max Mustermann, Musterweg,
// 00000, example.de, order numbers from 1001. The SKU prefix SPWN-DUBL- is the
// made-to-order rule itself, not a real order.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const channels = require('../channels.js');
const board = require('../order-board.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_board_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

// Monday 19 October 2026, ten in the morning in Berlin.
const NOW = new Date('2026-10-19T08:00:00Z');

// A Billbee order as the API sends it, buyer and address included, so the tests
// can show that none of it survives the import.
function billbeeOrder(over = {}) {
  return {
    BillBeeOrderId: 9001,
    OrderNumber: '1001',
    State: 3,
    CreatedAt: '2026-10-19T07:30:00Z',
    PayedAt: '2026-10-19T07:31:00Z',
    Currency: 'EUR',
    TotalCost: 10,
    ShippingCost: 4.9,
    Tags: [],
    Customer: { Id: 501, Name: 'Erika Musterfrau', Email: 'erika@example.de' },
    Buyer: { Platform: 'Shopify', BillbeeShopName: 'Shopify', FullName: 'Erika Musterfrau' },
    ShippingAddress: {
      FirstName: 'Erika',
      LastName: 'Musterfrau',
      Street: 'Musterweg 1',
      Zip: '00000',
      City: 'Musterstadt',
      CountryISO2: 'DE',
      Email: 'erika@example.de',
      Phone: '+49 170 0000000'
    },
    OrderItems: [{ Quantity: 1, TotalPrice: 10, Product: { SKU: 'MUSTER-250', Title: 'Muster 250 g' } }],
    ...over
  };
}

// The board's input shape (db.listBoardOrders), written directly.
function row(over = {}) {
  return {
    id: 1,
    channel: 'billbee',
    channelOrderId: '9001',
    status: 'new',
    orderDate: '2026-10-19T07:30:00Z',
    raw: { OrderNumber: '1001', State: 3, PayedAt: '2026-10-19T07:31:00Z', ShopName: 'eBay', Tags: [] },
    items: [{ sku: 'MUSTER-250', title: 'Muster 250 g', qty: 1 }],
    ...over
  };
}
const dowel = (qty = 1) => ({ sku: 'SPWN-DUBL-MUSTER-100', title: 'Muster-Dübel 100 Stück', qty });

describe('order board – working days', () => {
  it('counts Monday to Friday, starting the day after the order', () => {
    assert.equal(board.addWorkdays('2026-10-19', 4), '2026-10-23', 'Monday → Friday');
    assert.equal(board.addWorkdays('2026-10-23', 4), '2026-10-29', 'Friday → Thursday');
    assert.equal(board.addWorkdays('2026-10-24', 4), '2026-10-29', 'Saturday → Thursday');
    assert.equal(board.addWorkdays('2026-10-25', 4), '2026-10-29', 'Sunday → Thursday');
    assert.equal(board.addWorkdays('2026-10-19', 0), '2026-10-19');
  });

  it("reads an order's day in Berlin, not in UTC", () => {
    // 23:30 UTC on a Sunday is already Monday in Berlin.
    assert.equal(board.localDay('2026-10-18T23:30:00Z'), '2026-10-19');
    assert.equal(board.localDay(null), null);
    assert.equal(board.localDay('kein Datum'), null);
  });

  it('knows a made-to-order SKU by its prefix, whatever the case', () => {
    assert.ok(board.madeToOrderRule('SPWN-DUBL-MUSTER-100'));
    assert.ok(board.madeToOrderRule('spwn-dubl-muster-50'));
    assert.equal(board.madeToOrderRule('MUSTER-250'), null);
    assert.equal(board.madeToOrderRule(null), null);
  });
});

const packedAt = (at, by = 'erika') => ({ packed: { by, at } });
const madeAt = (at, by = 'max') => ({ made: { by, at } });

describe('order board – heute packen', () => {
  it('lists a paid shelf order on the day it comes in', () => {
    const b = board.buildOrderBoard([row()], { now: NOW });
    assert.equal(b.today, '2026-10-19');
    assert.equal(b.pack.length, 1);
    const o = b.pack[0];
    assert.equal(o.number, '1001', "the shop's order number, not Billbee's internal id");
    assert.equal(o.shop, 'eBay');
    assert.equal(o.billbee, 'open');
    assert.equal(o.madeToOrder, false);
    assert.equal(o.plannedLabelDay, null);
    assert.deepEqual(o.items, [{ sku: 'MUSTER-250', title: 'Muster 250 g', qty: 1, madeToOrder: false }]);
  });

  it('leaves unpaid orders off both lists and only counts them', () => {
    const unpaid = row({ id: 2, raw: { OrderNumber: '1002', State: 2, ShopName: 'Etsy' }, items: [dowel(3)] });
    const b = board.buildOrderBoard([row(), unpaid], { now: NOW });
    assert.equal(b.pack.length, 1);
    assert.equal(b.make.length, 0, 'nothing is made for an order nobody has paid yet');
    assert.equal(b.unpaid, 1);
  });

  it('counts state 3 as paid even without a payment date', () => {
    const b = board.buildOrderBoard([row({ raw: { OrderNumber: '1001', State: 3 } })], { now: NOW });
    assert.equal(b.pack.length, 1);
  });

  it('keeps an order Billbee already calls versendet on the list until it is marked packed', () => {
    // Billbee's 07:00 rule bought the label and set "Versendet" before anybody
    // packed the parcel — that is exactly the parcel that has to go out today.
    const labelled = row({
      id: 2,
      status: 'shipped',
      orderDate: '2026-10-19T07:45:00Z',
      raw: { OrderNumber: '1002', State: 4, ShippedAt: '2026-10-19T05:00:00Z', LabelAt: '2026-10-19T05:00:00Z' }
    });
    const b = board.buildOrderBoard([row(), labelled], { now: NOW, marksSince: '2026-10-01T00:00:00Z' });
    assert.deepEqual(
      b.pack.map((o) => [o.number, o.billbee]),
      [
        ['1002', 'label'],
        ['1001', 'open']
      ],
      'a bought label goes first: that parcel leaves today'
    );
    assert.equal(board.billbeeState({ status: 'shipped', raw: {} }), 'shipped');
  });

  it('moves a packed order to "Erledigt heute", with who and when, and forgets it the next day', () => {
    const b = board.buildOrderBoard(
      [
        row({ id: 1, marks: packedAt('2026-10-19T07:55:00Z') }),
        row({ id: 2, raw: { OrderNumber: '1002', State: 3 }, marks: packedAt('2026-10-16T12:00:00Z') }),
        row({ id: 3, raw: { OrderNumber: '1003', State: 3 } })
      ],
      { now: NOW }
    );
    assert.deepEqual(
      b.pack.map((o) => o.number),
      ['1003']
    );
    assert.deepEqual(
      b.done.map((o) => o.number),
      ['1001'],
      'packed on Friday is simply done'
    );
    assert.deepEqual(b.done[0].packed, { by: 'erika', at: '2026-10-19T07:55:00Z' });
  });

  it('drops cancelled, deleted and returned orders', () => {
    const b = board.buildOrderBoard(
      [
        row({ id: 1, status: 'cancelled' }),
        row({ id: 2, raw: { OrderNumber: '1002', State: 5, PayedAt: '2026-10-19T07:31:00Z' } }),
        row({ id: 3, raw: { OrderNumber: '1003', State: 6 } }),
        row({ id: 4, raw: { OrderNumber: '1004', State: 8 } })
      ],
      { now: NOW }
    );
    assert.equal(b.pack.length + b.later.length + b.done.length + b.unpaid, 0);
  });

  it('counts an order labelled before the marks began as done, not as a month of backlog', () => {
    const old = row({
      status: 'shipped',
      orderDate: '2026-10-12T07:00:00Z',
      raw: { OrderNumber: '1001', State: 4, LabelAt: '2026-10-12T05:00:00+02:00' }
    });
    assert.equal(board.buildOrderBoard([old], { now: NOW, marksSince: '2026-10-19T06:00:00Z' }).pack.length, 0);
    assert.equal(board.buildOrderBoard([old], { now: NOW, marksSince: '2026-10-01T00:00:00Z' }).pack.length, 1);
  });
});

describe('order board – herstellen', () => {
  it('holds a made-to-order parcel until it is marked made, and puts the dowels on the make list', () => {
    const b = board.buildOrderBoard([row({ items: [dowel(2), { sku: 'MUSTER-250', title: 'Muster', qty: 1 }] })], {
      now: NOW
    });
    assert.equal(b.pack.length, 0, 'the shelf item waits for the dowels: one parcel');
    assert.equal(b.later.length, 1);
    assert.equal(b.later[0].needsMaking, true);
    assert.equal(b.later[0].plannedLabelDay, '2026-10-23', 'ordered Monday, label four working days later');
    assert.equal(b.make.length, 1);
    assert.equal(b.make[0].sku, 'SPWN-DUBL-MUSTER-100');
    assert.equal(b.make[0].qty, 2);
    assert.deepEqual(b.make[0].byDay, [{ day: '2026-10-23', qty: 2 }]);
    assert.equal(b.make[0].overdue, false);
  });

  it('moves the order to "heute packen" once it is marked made, whatever the date', () => {
    const b = board.buildOrderBoard([row({ items: [dowel(2)], marks: madeAt('2026-10-19T07:50:00Z') })], {
      now: NOW
    });
    assert.equal(b.later.length, 0);
    assert.equal(b.make.length, 0);
    assert.equal(b.pack.length, 1);
    assert.deepEqual(b.pack[0].made, { by: 'max', at: '2026-10-19T07:50:00Z' });
  });

  it('keeps an unmade order off "heute packen" even when its label is due, and flags it', () => {
    const b = board.buildOrderBoard(
      [
        row({ id: 1, orderDate: '2026-10-13T07:00:00Z', items: [dowel(1)] }), // Tue → Mon 19.10. = today
        row({ id: 2, orderDate: '2026-10-08T07:00:00Z', items: [dowel(1)] }) // Thu → Wed 14.10. = late
      ],
      { now: NOW }
    );
    assert.equal(b.pack.length, 0);
    assert.deepEqual(
      b.later.map((o) => [o.plannedLabelDay, o.labelDue]),
      [
        ['2026-10-14', true],
        ['2026-10-19', true]
      ]
    );
    assert.equal(b.make[0].overdue, true);
  });

  it('totals one SKU across orders, earliest label day first', () => {
    const b = board.buildOrderBoard(
      [
        row({ id: 1, orderDate: '2026-10-19T07:00:00Z', items: [dowel(1)] }), // → Fri 23.10.
        row({ id: 2, orderDate: '2026-10-14T07:00:00Z', items: [dowel(3)] }), // Wed → Tue 20.10.
        row({ id: 3, orderDate: '2026-10-15T07:00:00Z', items: [{ ...dowel(2), sku: 'SPWN-DUBL-MUSTER-50' }] }), // → Wed 21.10.
        row({ id: 4, orderDate: '2026-10-15T07:00:00Z', items: [dowel(5)], marks: madeAt('2026-10-19T07:00:00Z') })
      ],
      { now: NOW }
    );
    assert.deepEqual(
      b.make.map((m) => [m.sku, m.qty, m.orders, m.earliestDay]),
      [
        ['SPWN-DUBL-MUSTER-100', 4, 2, '2026-10-20'],
        ['SPWN-DUBL-MUSTER-50', 2, 1, '2026-10-21']
      ],
      'the order already made is not counted again'
    );
    assert.deepEqual(b.make[0].byDay, [
      { day: '2026-10-20', qty: 3 },
      { day: '2026-10-23', qty: 1 }
    ]);
  });
});

describe('order board – zusammen packen', () => {
  it('frames two open orders from the same buyer as one parcel, side by side', () => {
    const b = board.buildOrderBoard(
      [
        row({
          id: 1,
          orderDate: '2026-10-19T05:00:00Z',
          raw: { OrderNumber: '1001', State: 3, CustomerKey: 'k-erika' }
        }),
        row({ id: 2, orderDate: '2026-10-19T06:00:00Z', raw: { OrderNumber: '1002', State: 3, CustomerKey: 'k-max' } }),
        row({
          id: 3,
          orderDate: '2026-10-19T07:00:00Z',
          raw: { OrderNumber: '1003', State: 3, CustomerKey: 'k-erika' }
        })
      ],
      { now: NOW }
    );
    assert.deepEqual(
      b.pack.map((o) => o.number),
      ['1001', '1003', '1002'],
      'the pair sits together, at the place of its first order'
    );
    assert.deepEqual(b.pack[0].combine, { key: 'k-erika', size: 2 });
    assert.deepEqual(b.pack[1].combine, { key: 'k-erika', size: 2 });
    assert.equal(b.pack[2].combine, null);
  });

  it('holds a shelf order back while the same buyer still has something being made', () => {
    const shelf = row({ id: 1, raw: { OrderNumber: '1001', State: 3, CustomerKey: 'k-erika' } });
    const dowels = row({ id: 2, raw: { OrderNumber: '1002', State: 3, CustomerKey: 'k-erika' }, items: [dowel(1)] });
    const b = board.buildOrderBoard([shelf, dowels], { now: NOW });
    assert.equal(b.pack.length, 0);
    assert.deepEqual(
      b.later.map((o) => [o.number, o.waitsForGroup, o.needsMaking]),
      [
        ['1002', false, true],
        ['1001', true, false]
      ]
    );
    const made = board.buildOrderBoard([shelf, { ...dowels, marks: madeAt('2026-10-19T07:59:00Z') }], { now: NOW });
    assert.equal(made.pack.length, 2, 'once made, both go into the parcel together');
  });

  it("flags an order Billbee's rule tagged ZUSAMMENFASSEN even without a partner here", () => {
    const b = board.buildOrderBoard([row({ raw: { OrderNumber: '1001', State: 3, Tags: ['zusammenfassen'] } })], {
      now: NOW
    });
    assert.equal(b.pack[0].taggedCombine, true);
    assert.deepEqual(b.pack[0].combine, { key: null, size: 1 });
  });
});

describe('order board – Billbee import', () => {
  it('keeps the paid date, the tags, an anonymous buyer key and when the label was bought', () => {
    const o = channels._normalizeBillbee(
      billbeeOrder({
        Tags: ['ZUSAMMENFASSEN', ' ', null],
        ShippingIds: [
          { ShippingId: 'GLS-TEST-0001', Shipper: 'GLS', Created: '2026-10-19T07:00:12+02:00' },
          { ShippingId: 'GLS-TEST-0002', Shipper: 'GLS', Created: '2026-10-19T06:59:00+02:00' }
        ]
      })
    );
    assert.equal(o.raw.PayedAt, '2026-10-19T07:31:00Z');
    assert.deepEqual(o.raw.Tags, ['ZUSAMMENFASSEN']);
    assert.match(o.raw.CustomerKey, /^[0-9a-f]{16}$/);
    assert.equal(o.raw.LabelCount, 2);
    assert.equal(o.raw.LabelAt, '2026-10-19T06:59:00+02:00');
    assert.equal(JSON.stringify(o).includes('GLS-TEST-0001'), false, 'no tracking numbers');
  });

  it('gives the same buyer the same key and another buyer another', () => {
    const a = channels._normalizeBillbee(billbeeOrder()).raw.CustomerKey;
    const b = channels._normalizeBillbee(billbeeOrder({ BillBeeOrderId: 9002 })).raw.CustomerKey;
    const c = channels._normalizeBillbee(
      billbeeOrder({ BillBeeOrderId: 9003, Customer: { Id: 502, Name: 'Max Mustermann' } })
    ).raw.CustomerKey;
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(channels._normalizeBillbee(billbeeOrder({ Customer: null, Buyer: {} })).raw.CustomerKey, null);
  });

  it('still brings no personal data into the lab', () => {
    const asText = JSON.stringify(channels._normalizeBillbee(billbeeOrder()));
    for (const secret of ['Erika', 'Musterfrau', 'erika@example.de', '+49 170 0000000', 'Musterweg', '00000', '501'])
      assert.equal(asText.includes(secret), false, secret + ' must not reach the lab database');
  });

  it('builds the board end to end from synced orders, without a customer column', () => {
    const { db: d, path: p } = tmpDb();
    try {
      db.upsertOrder(d, channels._normalizeBillbee(billbeeOrder()));
      db.upsertOrder(
        d,
        channels._normalizeBillbee(
          billbeeOrder({
            BillBeeOrderId: 9002,
            OrderNumber: '1002',
            OrderItems: [
              { Quantity: 2, TotalPrice: 20, Product: { SKU: 'SPWN-DUBL-MUSTER-100', Title: 'Muster-Dübel' } }
            ]
          })
        )
      );
      const rows = db.listBoardOrders(d, { sinceIso: '2026-09-19T00:00:00Z' });
      assert.equal(rows.length, 2);
      assert.equal('customerName' in rows[0], false);
      const b = board.buildOrderBoard(rows, { now: NOW, marksSince: db.orderMarksSince(d) });
      assert.equal(b.pack.length, 0, 'the shelf order goes with the dowels of the same buyer');
      assert.equal(b.later.length, 2);
      assert.equal(b.later[0].combine.size, 2);
      assert.equal(b.make[0].qty, 2);
      assert.equal(b.later.find((o) => o.number === '1001').shop, 'Shopify');
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });

  it('stores the marks with who and when, keyed on the Billbee order, through every sync', () => {
    const { db: d, path: p } = tmpDb();
    try {
      // The orders arrive after the marks began, as they will on a live system.
      d.prepare("UPDATE meta SET value = '2026-10-01T00:00:00.000Z' WHERE key = 'order_marks_since'").run();
      const id = db.upsertOrder(d, channels._normalizeBillbee(billbeeOrder()));
      assert.equal(db.setOrderMark(d, id, 'packed', true, 'erika'), true);
      const mark = d.prepare('SELECT * FROM order_marks').get();
      assert.equal(mark.channel, 'billbee');
      assert.equal(mark.channel_order_id, '9001');
      assert.equal(mark.kind, 'packed');
      assert.equal(mark.marked_by, 'erika');
      assert.ok(mark.marked_at);
      // Billbee's rule then buys the label and calls it versendet: the mark
      // stands, and the order stays where the packer put it.
      db.upsertOrder(
        d,
        channels._normalizeBillbee(
          billbeeOrder({
            State: 4,
            ShippedAt: '2026-10-19T09:00:00Z',
            ShippingIds: [{ ShippingId: 'GLS-TEST-0001', Created: '2026-10-19T09:00:00Z' }]
          })
        )
      );
      const now = new Date(mark.marked_at);
      const b = board.buildOrderBoard(db.listBoardOrders(d, {}), { now, marksSince: db.orderMarksSince(d) });
      assert.equal(b.pack.length, 0);
      assert.equal(b.done.length, 1);
      assert.equal(b.done[0].billbee, 'label');
      assert.equal(b.done[0].packed.by, 'erika');
      // Undo.
      db.setOrderMark(d, id, 'packed', false, 'erika');
      const b2 = board.buildOrderBoard(db.listBoardOrders(d, {}), { now, marksSince: db.orderMarksSince(d) });
      assert.equal(b2.pack.length, 1, 'label bought, not packed: back on the list');
      assert.equal(db.setOrderMark(d, 99999, 'packed', true, 'erika'), false);
      assert.throws(() => db.setOrderMark(d, id, 'shipped', true, 'erika'));
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });

  it('leaves orders older than the window to the window', () => {
    const { db: d, path: p } = tmpDb();
    try {
      db.upsertOrder(d, channels._normalizeBillbee(billbeeOrder({ CreatedAt: '2026-08-01T08:00:00Z' })));
      assert.equal(db.listBoardOrders(d, { sinceIso: '2026-09-19T00:00:00Z' }).length, 0);
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });
});

describe('order board – sync state in plain words', () => {
  const ok = { enabled: true, connected: true, lastSync: '2026-10-19T07:50:00Z', lastError: null };
  it('says nothing when the last sync is fresh', () => {
    assert.equal(board.syncProblem(ok, { now: NOW }), null);
  });
  it('names the problem instead of passing the raw error on', () => {
    const at = (lastError) => board.syncProblem({ ...ok, lastError }, { now: NOW });
    assert.equal(board.syncProblem({ enabled: false }), 'off');
    assert.equal(board.syncProblem({ enabled: true, connected: false }), 'not_connected');
    assert.equal(at('Billbee Aufträge HTTP 401'), 'auth');
    assert.equal(at('Billbee API-Key fehlt'), 'auth');
    assert.equal(at('Billbee Aufträge HTTP 429'), 'busy');
    assert.equal(at('Billbee Aufträge HTTP 503'), 'down');
    assert.equal(at('The operation was aborted due to timeout'), 'offline');
    assert.equal(at('fetch failed'), 'offline');
    assert.equal(at('Unexpected token < in JSON'), 'failed');
    assert.equal(board.syncProblem({ ...ok, lastSync: null }, { now: NOW }), 'never');
    assert.equal(board.syncProblem({ ...ok, lastSync: '2026-10-19T06:00:00Z' }, { now: NOW }), 'stale');
  });
});

describe('order board – wiring', () => {
  const ROOT = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

  it('serves the board before the /api/orders/:id route can swallow it', () => {
    const boardAt = server.indexOf("url === '/api/orders/board'");
    const idAt = server.indexOf('const orderMatch = url.match(');
    assert.ok(boardAt > 0, 'route missing');
    assert.ok(boardAt < idAt, 'must precede /api/orders/:id');
  });

  it('opens Bestellungen on the Packen tab', () => {
    assert.match(html, /<button class="stab active" id="st-orders-pack"/);
    assert.match(html, /<div class="sp active" id="sp-orders-pack">/);
    assert.match(html, /<div class="sp" id="sp-orders-inbox">/, 'the inbox is no longer the default');
    assert.match(app, /sub === 'pack'\) renderOrderBoard\(\)/);
    assert.match(app, /action === 'ob-mark'/);
    assert.match(html, /<details class="card ob-done-list">/, '"Erledigt heute" starts folded');
  });

  it('writes the marks only into this app, never to Billbee', () => {
    const start = server.indexOf("url === '/api/orders/board/mark'");
    assert.ok(start > 0, 'mark route missing');
    const handler = server.slice(start, server.indexOf('// Orders — production-demand', start));
    assert.match(handler, /db\.setOrderMark\(/);
    assert.doesNotMatch(handler, /channels\.|getChannelProvider|prov\.|fetch\(/);
    const ui = app.slice(app.indexOf('let _obBoard = null;'), app.indexOf('function obSyncNow('));
    assert.doesNotMatch(ui, /\/api\/channels|\/api\/orders\/\d|apiPatch/, 'the board UI sets marks, nothing else');
  });
});
