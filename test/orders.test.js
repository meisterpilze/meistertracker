'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_orders_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

describe('order hub – schema (migration v42)', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('creates all order-hub tables', () => {
    const tables = d
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    for (const t of [
      'sales_channel_config',
      'products',
      'product_components',
      'product_channel_map',
      'customers',
      'customer_identities',
      'orders',
      'order_items',
      'order_allocations',
      'order_sync_log'
    ]) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
  });

  it('records migration v42 as applied', () => {
    const row = d.prepare('SELECT version FROM schema_version WHERE version = 42').get();
    assert.ok(row, 'schema_version should include 42');
  });
});

describe('order hub – products & mapping', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('upserts a product with components and reads it back', () => {
    const id = db.upsertProduct(d, {
      sku: 'GK-SHII-3',
      name: 'Shiitake Growkit 3kg',
      category: 'growkit',
      species: 'shiitake',
      components: [{ fulfillType: 'produce', batchType: 'block', species: 'shiitake', leadDays: 21, qtyPerUnit: 1 }]
    });
    assert.ok(id > 0);
    const prod = db.getProduct(d, id);
    assert.equal(prod.name, 'Shiitake Growkit 3kg');
    assert.equal(prod.active, 1);
    assert.equal(prod.components.length, 1);
    assert.equal(prod.components[0].batchType, 'block');
    assert.equal(prod.components[0].leadDays, 21);
  });

  it('updating a product replaces its components', () => {
    const id = db.upsertProduct(d, {
      sku: 'GK-OYS-3',
      name: 'Oyster Growkit',
      category: 'growkit',
      components: [{ fulfillType: 'produce', batchType: 'block', species: 'oyster', qtyPerUnit: 1 }]
    });
    db.upsertProduct(d, {
      id,
      name: 'Oyster Growkit 3kg',
      category: 'growkit',
      components: [
        { fulfillType: 'produce', batchType: 'block', species: 'oyster', leadDays: 18, qtyPerUnit: 1 },
        { fulfillType: 'stock', qtyPerUnit: 1, notes: 'instructions leaflet' }
      ]
    });
    const prod = db.getProduct(d, id);
    assert.equal(prod.name, 'Oyster Growkit 3kg');
    assert.equal(prod.components.length, 2);
  });

  it('maps a channel listing and back-resolves already-imported items', () => {
    const id = db.upsertProduct(d, {
      sku: 'SPAWN-RYE',
      name: 'Körnerbrut Roggen 1kg',
      category: 'spawn',
      components: [{ fulfillType: 'produce', batchType: 'grain', species: 'oyster', qtyPerUnit: 1 }]
    });
    // Import an order whose line is not yet mapped to any product.
    db.upsertOrder(d, {
      channel: 'etsy',
      channelOrderId: 'E-1',
      customerEmail: 'a@b.de',
      customerName: 'A',
      items: [{ channelSku: 'ETSY-RYE', title: 'Rye spawn', qty: 2 }]
    });
    let unmapped = db.listUnmappedItems(d);
    assert.ok(
      unmapped.find((u) => u.channelSku === 'ETSY-RYE'),
      'item should appear unmapped before mapping'
    );
    db.mapListing(d, { channel: 'etsy', channelSku: 'ETSY-RYE', productId: id });
    unmapped = db.listUnmappedItems(d);
    assert.ok(!unmapped.find((u) => u.channelSku === 'ETSY-RYE'), 'item should be resolved after mapping');
  });
});

describe('order hub – idempotent ingestion & customers', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('upsertOrder is idempotent on (channel, channelOrderId)', () => {
    const o = {
      channel: 'wix',
      channelOrderId: '10432',
      customerEmail: 'anna@ex.de',
      customerName: 'Anna',
      totalAmount: 30,
      currency: 'EUR',
      items: [{ channelSku: 'X', title: 'Kit', qty: 1 }]
    };
    const id1 = db.upsertOrder(d, o);
    const id2 = db.upsertOrder(d, o);
    assert.equal(id1, id2);
    assert.equal(d.prepare('SELECT COUNT(*) AS c FROM orders').get().c, 1);
    assert.equal(d.prepare('SELECT COUNT(*) AS c FROM order_items').get().c, 1, 're-import should not duplicate items');
  });

  it('dedups customers by email across channels and aggregates LTV', () => {
    db.upsertOrder(d, {
      channel: 'wix',
      channelOrderId: 'W-1',
      customerEmail: 'rep@ex.de',
      customerName: 'Rep',
      totalAmount: 20,
      items: []
    });
    db.upsertOrder(d, {
      channel: 'etsy',
      channelOrderId: 'E-9',
      customerEmail: 'REP@ex.de', // different case, same person
      customerName: 'Rep',
      totalAmount: 35,
      items: []
    });
    const rep = db.listCustomers(d).find((c) => c.email === 'rep@ex.de');
    assert.ok(rep, 'deduped customer should exist');
    assert.equal(rep.orderCount, 2);
    assert.equal(rep.totalSpent, 55);
    assert.ok(
      (rep.channels || '').includes('wix') && (rep.channels || '').includes('etsy'),
      'channels should list both'
    );
  });

  it('cancelled orders do not count toward LTV', () => {
    const oid = db.upsertOrder(d, {
      channel: 'wix',
      channelOrderId: 'W-CANCEL',
      customerEmail: 'cancel@ex.de',
      totalAmount: 99,
      items: []
    });
    db.setOrderStatus(d, oid, 'cancelled');
    // re-run stats by importing another (kept) order for the same customer
    db.upsertOrder(d, {
      channel: 'wix',
      channelOrderId: 'W-KEEP',
      customerEmail: 'cancel@ex.de',
      totalAmount: 10,
      items: []
    });
    const cust = db.listCustomers(d).find((c) => c.email === 'cancel@ex.de');
    assert.equal(cust.orderCount, 1);
    assert.equal(cust.totalSpent, 10);
  });
});

describe('order hub – demand engine & reservation', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('computes net-to-start, lead-time start-by, and reservation reduces it', () => {
    const pid = db.upsertProduct(d, {
      sku: 'GK',
      name: 'Shiitake Kit',
      category: 'growkit',
      components: [{ fulfillType: 'produce', batchType: 'block', species: 'shiitake', leadDays: 21, qtyPerUnit: 1 }]
    });
    db.mapListing(d, { channel: 'wix', channelSku: 'WX-GK', productId: pid });
    db.upsertOrder(d, {
      channel: 'wix',
      channelOrderId: 'O-1',
      shipBy: '2026-06-20',
      customerEmail: 'c1@ex.de',
      items: [{ channelSku: 'WX-GK', title: 'Kit', qty: 5 }]
    });
    db.upsertOrder(d, {
      channel: 'wix',
      channelOrderId: 'O-2',
      shipBy: '2026-06-18', // earliest → drives start-by
      customerEmail: 'c2@ex.de',
      items: [{ channelSku: 'WX-GK', title: 'Kit', qty: 7 }]
    });

    let demand = db.computeProductionDemand(d);
    const row = demand.find((r) => r.batchType === 'block' && r.species === 'shiitake');
    assert.ok(row, 'demand row present');
    assert.equal(row.gross, 12);
    assert.equal(row.netToStart, 12);
    assert.equal(row.startBy, '2026-05-28', 'earliest ship_by (06-18) minus 21 lead days');

    // Reserve 5 units (against O-1's line) → drops out of net, flips O-1 to in_production.
    const item = d
      .prepare("SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.channel_order_id = 'O-1'")
      .get();
    db.reserveDemand(d, { batchId: null, allocations: [{ orderItemId: item.id, qty: 5 }] });

    demand = db.computeProductionDemand(d);
    const row2 = demand.find((r) => r.batchType === 'block' && r.species === 'shiitake');
    assert.equal(row2.reserved, 5);
    assert.equal(row2.netToStart, 7);
    assert.equal(d.prepare("SELECT status FROM orders WHERE channel_order_id = 'O-1'").get().status, 'in_production');
  });

  it("'stock' components never appear as production demand", () => {
    const sid = db.upsertProduct(d, {
      sku: 'SUPPLY',
      name: 'Substratbeutel',
      category: 'supply',
      components: [{ fulfillType: 'stock', qtyPerUnit: 1 }]
    });
    db.mapListing(d, { channel: 'ebay', channelSku: 'EB-SUB', productId: sid });
    db.upsertOrder(d, {
      channel: 'ebay',
      channelOrderId: 'EB-1',
      customerEmail: 'g@ex.de',
      items: [{ channelSku: 'EB-SUB', title: 'Beutel', qty: 6 }]
    });
    const demand = db.computeProductionDemand(d);
    assert.ok(!demand.find((r) => r.batchType == null && r.species == null), 'stock lines excluded');
  });
});
