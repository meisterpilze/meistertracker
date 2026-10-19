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

describe('order board – heute packen', () => {
  it('lists a paid shelf order on the day it comes in', () => {
    const b = board.buildOrderBoard([row()], { now: NOW });
    assert.equal(b.today, '2026-10-19');
    assert.equal(b.pack.length, 1);
    const o = b.pack[0];
    assert.equal(o.number, '1001', "the shop's order number, not Billbee's internal id");
    assert.equal(o.shop, 'eBay');
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

  it('keeps cancelled orders out, and shipped ones only for the last few days', () => {
    const b = board.buildOrderBoard(
      [
        row({ id: 1, status: 'cancelled' }),
        row({ id: 2, status: 'shipped', raw: { OrderNumber: '1002', ShippedAt: '2026-10-17T10:00:00Z' } }),
        row({ id: 3, status: 'shipped', raw: { OrderNumber: '1003', ShippedAt: '2026-10-01T10:00:00Z' } })
      ],
      { now: NOW }
    );
    assert.equal(b.pack.length, 0);
    assert.deepEqual(
      b.shipped.map((o) => o.number),
      ['1002']
    );
    assert.equal(b.shipped[0].shippedDay, '2026-10-17');
  });

  it('keeps a packed order on the list, marked, below the ones still to pack', () => {
    const b = board.buildOrderBoard(
      [
        row({ id: 1, status: 'ready', orderDate: '2026-10-19T06:00:00Z', raw: { OrderNumber: '1001', State: 3 } }),
        row({ id: 2, orderDate: '2026-10-19T07:00:00Z', raw: { OrderNumber: '1002', State: 3 } })
      ],
      { now: NOW }
    );
    assert.deepEqual(
      b.pack.map((o) => [o.number, o.packed]),
      [
        ['1002', false],
        ['1001', true]
      ]
    );
  });
});

describe('order board – herstellen', () => {
  it('holds a made-to-order parcel until its label day and puts the dowels on the make list', () => {
    // Ordered Monday: Billbee buys the label four working days later, on Friday.
    const b = board.buildOrderBoard([row({ items: [dowel(2), { sku: 'MUSTER-250', title: 'Muster', qty: 1 }] })], {
      now: NOW
    });
    assert.equal(b.pack.length, 0, 'the shelf item waits for the dowels: one parcel');
    assert.equal(b.later.length, 1);
    assert.equal(b.later[0].plannedLabelDay, '2026-10-23');
    assert.equal(b.make.length, 1);
    assert.equal(b.make[0].sku, 'SPWN-DUBL-MUSTER-100');
    assert.equal(b.make[0].qty, 2);
    assert.deepEqual(b.make[0].byDay, [{ day: '2026-10-23', qty: 2 }]);
    assert.equal(b.make[0].overdue, false);
  });

  it('totals one SKU across orders, earliest label day first', () => {
    const b = board.buildOrderBoard(
      [
        row({ id: 1, orderDate: '2026-10-19T07:00:00Z', items: [dowel(1)] }), // → Fri 23.10.
        row({ id: 2, orderDate: '2026-10-14T07:00:00Z', items: [dowel(3)] }), // Wed → Tue 20.10.
        row({ id: 3, orderDate: '2026-10-15T07:00:00Z', items: [{ ...dowel(2), sku: 'SPWN-DUBL-MUSTER-50' }] }) // → Wed 21.10.
      ],
      { now: NOW }
    );
    assert.deepEqual(
      b.make.map((m) => [m.sku, m.qty, m.orders, m.earliestDay]),
      [
        ['SPWN-DUBL-MUSTER-100', 4, 2, '2026-10-20'],
        ['SPWN-DUBL-MUSTER-50', 2, 1, '2026-10-21']
      ]
    );
    assert.deepEqual(b.make[0].byDay, [
      { day: '2026-10-20', qty: 3 },
      { day: '2026-10-23', qty: 1 }
    ]);
  });

  it('moves the parcel to "heute packen" on its label day, and flags a late one', () => {
    const b = board.buildOrderBoard(
      [
        row({ id: 1, orderDate: '2026-10-13T07:00:00Z', items: [dowel(1)] }), // Tue → Mon 19.10. = today
        row({ id: 2, orderDate: '2026-10-08T07:00:00Z', items: [dowel(1)] }) // Thu → Wed 14.10. = late
      ],
      { now: NOW }
    );
    assert.deepEqual(b.pack.map((o) => o.plannedLabelDay).sort(), ['2026-10-14', '2026-10-19']);
    assert.equal(b.later.length, 0);
    assert.equal(b.make[0].overdue, true, 'one of them should have gone out already');
  });

  it('takes packed orders off the make list', () => {
    const b = board.buildOrderBoard([row({ status: 'ready', orderDate: '2026-10-13T07:00:00Z', items: [dowel(1)] })], {
      now: NOW
    });
    assert.equal(b.make.length, 0);
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

  it("flags an order Billbee's rule tagged ZUSAMMENFASSEN even without a partner here", () => {
    const b = board.buildOrderBoard([row({ raw: { OrderNumber: '1001', State: 3, Tags: ['zusammenfassen'] } })], {
      now: NOW
    });
    assert.equal(b.pack[0].taggedCombine, true);
    assert.deepEqual(b.pack[0].combine, { key: null, size: 1 });
  });
});

describe('order board – Billbee import', () => {
  it('keeps the paid date, the tags and an anonymous buyer key', () => {
    const o = channels._normalizeBillbee(billbeeOrder({ Tags: ['ZUSAMMENFASSEN', ' ', null] }));
    assert.equal(o.raw.PayedAt, '2026-10-19T07:31:00Z');
    assert.deepEqual(o.raw.Tags, ['ZUSAMMENFASSEN']);
    assert.match(o.raw.CustomerKey, /^[0-9a-f]{16}$/);
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
      const b = board.buildOrderBoard(rows, { now: NOW });
      assert.equal(b.pack.length, 0, 'the shelf order goes with the dowels of the same buyer');
      assert.equal(b.later.length, 2);
      assert.deepEqual(b.later[0].combine && b.later[0].combine.size, 2);
      assert.equal(b.make[0].qty, 2);
      assert.equal(b.later.find((o) => o.number === '1001').shop, 'Shopify');
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });

  it('keeps "gepackt" through the next sync', () => {
    const { db: d, path: p } = tmpDb();
    try {
      const id = db.upsertOrder(d, channels._normalizeBillbee(billbeeOrder()));
      db.setOrderStatus(d, id, 'ready');
      db.upsertOrder(d, channels._normalizeBillbee(billbeeOrder()));
      const b = board.buildOrderBoard(db.listBoardOrders(d, {}), { now: NOW });
      assert.equal(b.pack[0].packed, true);
      // Billbee then reports it shipped: that wins.
      db.upsertOrder(d, channels._normalizeBillbee(billbeeOrder({ State: 4, ShippedAt: '2026-10-19T09:00:00Z' })));
      const b2 = board.buildOrderBoard(db.listBoardOrders(d, {}), { now: NOW });
      assert.equal(b2.pack.length, 0);
      assert.equal(b2.shipped.length, 1);
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
    assert.match(app, /action === 'ob-packed'/);
  });
});
