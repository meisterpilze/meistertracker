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
      'order_sync_log',
      'materials',
      'product_bom'
    ]) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
  });

  it('records migrations v42 + v43 as applied', () => {
    assert.ok(d.prepare('SELECT version FROM schema_version WHERE version = 42').get(), 'v42 applied');
    assert.ok(d.prepare('SELECT version FROM schema_version WHERE version = 43').get(), 'v43 applied');
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

  it('creates materials + a product with stock and a BOM, reads it back', () => {
    const grain = db.upsertMaterial(d, { name: 'Roggen', unit: 'kg', stock: 10 });
    const bag = db.upsertMaterial(d, { name: 'Filterbeutel', unit: 'Stk', stock: 50 });
    const id = db.upsertProduct(d, {
      sku: 'AIO-3',
      name: 'All-in-One 3kg',
      category: 'all-in-one',
      stock: 4,
      leadDays: 18,
      bom: [
        { materialId: grain, qtyPerUnit: 1.5 },
        { materialId: bag, qtyPerUnit: 1 }
      ]
    });
    assert.ok(id > 0);
    const prod = db.getProduct(d, id);
    assert.equal(prod.name, 'All-in-One 3kg');
    assert.equal(prod.stock, 4);
    assert.equal(prod.producible, 1);
    assert.equal(prod.bom.length, 2);
    const g = prod.bom.find((b) => b.materialName === 'Roggen');
    assert.equal(g.qtyPerUnit, 1.5);
    assert.equal(g.unit, 'kg');
  });

  it('updating a product replaces its BOM', () => {
    const cvg = db.upsertMaterial(d, { name: 'CVG', unit: 'L', stock: 30 });
    const id = db.upsertProduct(d, {
      name: 'Substrat CVG',
      category: 'substrat',
      bom: [{ materialId: cvg, qtyPerUnit: 3 }]
    });
    db.upsertProduct(d, {
      id,
      name: 'Substrat CVG 3L',
      category: 'substrat',
      bom: [{ materialId: cvg, qtyPerUnit: 3.2 }]
    });
    const prod = db.getProduct(d, id);
    assert.equal(prod.name, 'Substrat CVG 3L');
    assert.equal(prod.bom.length, 1);
    assert.equal(prod.bom[0].qtyPerUnit, 3.2);
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

  it('maps a manual title-only line (no SKU) by title', () => {
    const id = db.upsertProduct(d, {
      name: 'Austern Growkit',
      category: 'growkit',
      components: [{ fulfillType: 'produce', batchType: 'block', species: 'oyster', qtyPerUnit: 1 }]
    });
    db.upsertOrder(d, {
      channel: 'manual',
      channelOrderId: 'M-1',
      customerEmail: 'x@y.de',
      items: [{ title: 'Austern Growkit', qty: 3 }] // no sku, no listing id
    });
    let unmapped = db.listUnmappedItems(d);
    assert.ok(
      unmapped.find((u) => u.title === 'Austern Growkit' && !u.channelSku),
      'title-only line should start unmapped'
    );
    db.mapListing(d, { channel: 'manual', title: 'Austern Growkit', productId: id });
    unmapped = db.listUnmappedItems(d);
    assert.ok(
      !unmapped.find((u) => u.title === 'Austern Growkit'),
      'title-only line should resolve after mapping by title'
    );
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

  it('reserves from finished stock first, then produces the shortfall + checks components', () => {
    const grain = db.upsertMaterial(d, { name: 'Roggen', unit: 'kg', stock: 4 }); // only 4 kg on hand
    const bag = db.upsertMaterial(d, { name: 'Beutel', unit: 'Stk', stock: 100 });
    const pid = db.upsertProduct(d, {
      name: 'All-in-One',
      category: 'all-in-one',
      stock: 2,
      leadDays: 7,
      bom: [
        { materialId: grain, qtyPerUnit: 1.5 },
        { materialId: bag, qtyPerUnit: 1 }
      ]
    });
    db.mapListing(d, { channel: 'wix', channelSku: 'WX-AIO', productId: pid });
    db.upsertOrder(d, {
      channel: 'wix',
      channelOrderId: 'O-1',
      shipBy: '2026-06-20',
      customerEmail: 'c1@ex.de',
      items: [{ channelSku: 'WX-AIO', title: 'AIO', qty: 5 }]
    });

    const row = db.computeProductionDemand(d).find((r) => r.productId === pid);
    assert.ok(row, 'demand row present');
    assert.equal(row.demand, 5);
    assert.equal(row.fromStock, 2, '2 reserved from finished stock');
    assert.equal(row.toProduce, 3, 'produce the remaining 3');
    assert.equal(row.startBy, '2026-06-13', 'ship 06-20 minus 7 lead days');
    const g = row.components.find((c) => c.materialName === 'Roggen');
    assert.equal(g.need, 4.5); // 3 × 1.5 kg
    assert.ok(Math.abs(g.short - 0.5) < 1e-9, 'short 0.5 kg grain (have 4, need 4.5)');
    assert.equal(row.componentsShort, true);

    // Reserve 2 against the order line → open demand drops, toProduce shrinks.
    const item = d
      .prepare("SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.channel_order_id = 'O-1'")
      .get();
    db.reserveDemand(d, { allocations: [{ orderItemId: item.id, qty: 2 }] });
    const row2 = db.computeProductionDemand(d).find((r) => r.productId === pid);
    assert.equal(row2.reserved, 2);
    assert.equal(row2.toProduce, 1, 'open 3 − 2 from stock = 1 to produce');
  });

  it('non-producible items (Zubehör) become backorder when out of stock, not production', () => {
    const sid = db.upsertProduct(d, { name: 'Spritzenfilter', category: 'zubehoer', stock: 1, producible: 0 });
    db.mapListing(d, { channel: 'ebay', channelSku: 'EB-FILT', productId: sid });
    db.upsertOrder(d, {
      channel: 'ebay',
      channelOrderId: 'EB-1',
      customerEmail: 'g@ex.de',
      items: [{ channelSku: 'EB-FILT', title: 'Filter', qty: 3 }]
    });
    const row = db.computeProductionDemand(d).find((r) => r.productId === sid);
    assert.equal(row.fromStock, 1);
    assert.equal(row.toProduce, 0, 'not producible → never "produce"');
    assert.equal(row.backorder, 2, '3 − 1 in stock = 2 to restock');
    assert.equal(row.components.length, 0);
  });
});
