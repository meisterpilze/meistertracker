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

describe('order hub – schema', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('creates the order-hub tables', () => {
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

  it('drops the obsolete v2 materials/product_bom tables (v44)', () => {
    const tables = d
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    assert.ok(!tables.includes('materials'), 'materials should be dropped');
    assert.ok(!tables.includes('product_bom'), 'product_bom should be dropped');
  });

  it('adds production-spec columns to products and coir to inventory', () => {
    const pcols = d
      .prepare("SELECT name FROM pragma_table_info('products')")
      .all()
      .map((r) => r.name);
    for (const c of ['prod_type', 'prod_bag_kg', 'prod_substrate', 'prod_grain_kg', 'prod_grain_rh_pct']) {
      assert.ok(pcols.includes(c), `products.${c} missing`);
    }
    const icols = d
      .prepare("SELECT name FROM pragma_table_info('inventory')")
      .all()
      .map((r) => r.name);
    assert.ok(icols.includes('stock_coir'), 'inventory.stock_coir missing');
  });

  it('records migrations v42 + v43 + v44 as applied', () => {
    assert.ok(d.prepare('SELECT version FROM schema_version WHERE version = 42').get(), 'v42 applied');
    assert.ok(d.prepare('SELECT version FROM schema_version WHERE version = 43').get(), 'v43 applied');
    assert.ok(d.prepare('SELECT version FROM schema_version WHERE version = 44').get(), 'v44 applied');
  });
});

describe('order hub – production spec → material need', () => {
  it('all-in-one explodes into grain + coir (CVG)', () => {
    const need = db.computeProductMaterialNeed({
      prodType: 'allinone',
      prodSubstrate: 'cvg',
      prodBagKg: 3,
      prodRhPct: 0,
      prodCoirPct: 100,
      prodGrainKg: 0.5,
      prodGrainRhPct: 0
    });
    assert.equal(need.coir, 3);
    assert.equal(need.grain, 0.5);
    assert.equal(need.hardwood, 0);
  });

  it('block holzkleie applies hydration + hw/wb split + gypsum 1%', () => {
    const need = db.computeProductMaterialNeed({
      prodType: 'block',
      prodSubstrate: 'holzkleie',
      prodBagKg: 3,
      prodRhPct: 65, // dry = 3 * 0.35 = 1.05
      prodHardwoodPct: 70,
      prodWheatbranPct: 30,
      prodGypsum: 1
    });
    assert.ok(Math.abs(need.hardwood - 0.735) < 1e-9, 'hardwood 1.05*0.70');
    assert.ok(Math.abs(need.wheatbran - 0.315) < 1e-9, 'wheatbran 1.05*0.30');
    assert.ok(Math.abs(need.gypsum - 0.0105) < 1e-9, 'gypsum 1% of dry');
    assert.equal(need.coir, 0);
  });

  it('grain spawn uses grain hydration (52% default)', () => {
    const need = db.computeProductMaterialNeed({ prodType: 'grain', prodGrainKg: 1, prodGrainRhPct: 52 });
    assert.ok(Math.abs(need.grain - 0.48) < 1e-9, '1kg wet @52% → 0.48kg dry');
  });

  it('bought-in products need no raw materials', () => {
    const need = db.computeProductMaterialNeed({ prodType: 'buy', prodBagKg: 99, prodGrainKg: 99 });
    assert.equal(need.grain, 0);
    assert.equal(need.coir, 0);
    assert.equal(need.hardwood, 0);
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

  it('creates a product with a production spec and reads it back with materialNeed', () => {
    const id = db.upsertProduct(d, {
      sku: 'AIO-3',
      name: 'All-in-One 3kg',
      category: 'all-in-one',
      stock: 4,
      leadDays: 18,
      prodType: 'grain',
      prodGrainKg: 1.5,
      prodGrainRhPct: 0
    });
    assert.ok(id > 0);
    const prod = db.getProduct(d, id);
    assert.equal(prod.name, 'All-in-One 3kg');
    assert.equal(prod.stock, 4);
    assert.equal(prod.prodType, 'grain');
    assert.equal(prod.prodGrainKg, 1.5);
    assert.ok(prod.materialNeed, 'materialNeed present');
    assert.equal(prod.materialNeed.grain, 1.5);
  });

  it('updating a product replaces its production spec', () => {
    const id = db.upsertProduct(d, {
      name: 'Substrat CVG',
      category: 'substrat',
      prodType: 'block',
      prodSubstrate: 'cvg',
      prodBagKg: 3,
      prodCoirPct: 100
    });
    db.upsertProduct(d, {
      id,
      name: 'Substrat CVG 3.2',
      category: 'substrat',
      prodType: 'block',
      prodSubstrate: 'cvg',
      prodBagKg: 3.2,
      prodCoirPct: 100
    });
    const prod = db.getProduct(d, id);
    assert.equal(prod.name, 'Substrat CVG 3.2');
    assert.equal(prod.prodBagKg, 3.2);
    assert.equal(prod.materialNeed.coir, 3.2);
  });

  it('maps a channel listing and back-resolves already-imported items', () => {
    const id = db.upsertProduct(d, {
      sku: 'SPAWN-RYE',
      name: 'Körnerbrut Roggen 1kg',
      category: 'koernerbrut',
      prodType: 'grain',
      prodGrainKg: 1
    });
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
      category: 'all-in-one',
      prodType: 'allinone',
      prodSubstrate: 'holzkleie',
      prodBagKg: 3,
      prodHardwoodPct: 70,
      prodWheatbranPct: 30,
      prodGrainKg: 0.5
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

  it('reserves from finished stock first, then produces the shortfall + checks the shared inventory', () => {
    // Only 4 kg grain on hand in the shared inventory ledger.
    db.setInventoryAbsolute(d, 'grain', 4, 'seed', 'test');
    const pid = db.upsertProduct(d, {
      name: 'All-in-One',
      category: 'all-in-one',
      stock: 2,
      leadDays: 7,
      prodType: 'grain', // grain-only spec → 1.5 kg dry grain per unit
      prodGrainKg: 1.5,
      prodGrainRhPct: 0
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
    const g = row.components.find((c) => c.mat === 'grain');
    assert.ok(g, 'grain component present');
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
    assert.equal(row2.toProduce, 1, 'open 3 − 2 reserved = 1 to produce');
  });

  it('bought-in items (Zubehör) become backorder when out of stock, not production', () => {
    const sid = db.upsertProduct(d, { name: 'Spritzenfilter', category: 'zubehoer', stock: 1, prodType: 'buy' });
    db.mapListing(d, { channel: 'ebay', channelSku: 'EB-FILT', productId: sid });
    db.upsertOrder(d, {
      channel: 'ebay',
      channelOrderId: 'EB-1',
      customerEmail: 'g@ex.de',
      items: [{ channelSku: 'EB-FILT', title: 'Filter', qty: 3 }]
    });
    const row = db.computeProductionDemand(d).find((r) => r.productId === sid);
    assert.equal(row.fromStock, 1);
    assert.equal(row.toProduce, 0, 'bought-in → never "produce"');
    assert.equal(row.backorder, 2, '3 − 1 in stock = 2 to restock');
    assert.equal(row.components.length, 0);
  });
});

describe('order hub – review fixes (recall pass)', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('#3 eBay orders with no email dedup by buyerHandle across re-syncs', () => {
    const o = {
      channel: 'ebay',
      channelOrderId: 'EB-77',
      customerEmail: null,
      customerName: 'pilzfan',
      buyerHandle: 'pilzfan', // eBay username — the dedup key when email is masked
      totalAmount: 12,
      items: []
    };
    const id1 = db.upsertOrder(d, o);
    const id2 = db.upsertOrder(d, o); // re-sync of the same unshipped order
    assert.equal(id1, id2, 'same order row on re-sync');
    assert.equal(
      d.prepare("SELECT COUNT(*) AS c FROM customer_identities WHERE channel='ebay' AND handle='pilzfan'").get().c,
      1,
      'one identity row for the buyer'
    );
    assert.equal(
      d.prepare('SELECT COUNT(*) AS c FROM customers WHERE email IS NULL').get().c,
      1,
      'no duplicate null-email customer created per sync'
    );
  });

  it('#4 a channel re-sync does not downgrade a locally-advanced status', () => {
    const o = {
      channel: 'ebay',
      channelOrderId: 'EB-STAT',
      customerEmail: 'st@ex.de',
      status: 'new',
      items: [{ channelSku: 'S', title: 'S', qty: 1 }]
    };
    const oid = db.upsertOrder(d, o);
    db.setOrderStatus(d, oid, 'in_production');
    db.upsertOrder(d, o); // channel re-sends it as 'new' (still unshipped)
    assert.equal(
      d.prepare('SELECT status FROM orders WHERE id=?').get(oid).status,
      'in_production',
      'local progress survives the sync'
    );
    db.upsertOrder(d, { ...o, status: 'cancelled' }); // terminal channel state is authoritative
    assert.equal(d.prepare('SELECT status FROM orders WHERE id=?').get(oid).status, 'cancelled');
  });

  it('#5 re-reserving with no batch updates the row, never duplicates it', () => {
    const pid = db.upsertProduct(d, {
      name: 'AIO5',
      category: 'all-in-one',
      stock: 0,
      prodType: 'grain',
      prodGrainKg: 1,
      prodGrainRhPct: 0
    });
    db.mapListing(d, { channel: 'wix', channelSku: 'WX-5', productId: pid });
    db.upsertOrder(d, {
      channel: 'wix',
      channelOrderId: 'O-5',
      customerEmail: 'r5@ex.de',
      items: [{ channelSku: 'WX-5', title: 'AIO', qty: 4 }]
    });
    const item = d
      .prepare("SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.channel_order_id='O-5'")
      .get();
    db.reserveDemand(d, { allocations: [{ orderItemId: item.id, qty: 2 }] });
    db.reserveDemand(d, { allocations: [{ orderItemId: item.id, qty: 2 }] }); // re-reserve, NOT additive
    const agg = d
      .prepare('SELECT COUNT(*) AS c, COALESCE(SUM(qty),0) AS q FROM order_allocations WHERE order_item_id=?')
      .get(item.id);
    assert.equal(agg.c, 1, 'one allocation row (NULL batch no longer inserts a dupe)');
    assert.equal(agg.q, 2, 'qty updated to 2, not summed to 4');
    const row = db.computeProductionDemand(d).find((r) => r.productId === pid);
    assert.equal(row.reserved, 2);
  });

  it('#6 a reservation on a shipped order no longer cancels new demand', () => {
    const pid = db.upsertProduct(d, {
      name: 'AIO6',
      category: 'all-in-one',
      stock: 0,
      prodType: 'grain',
      prodGrainKg: 1,
      prodGrainRhPct: 0
    });
    db.mapListing(d, { channel: 'wix', channelSku: 'WX-6', productId: pid });
    const oldId = db.upsertOrder(d, {
      channel: 'wix',
      channelOrderId: 'O-6OLD',
      customerEmail: 'o6@ex.de',
      items: [{ channelSku: 'WX-6', title: 'AIO', qty: 5 }]
    });
    const oldItem = d
      .prepare("SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.channel_order_id='O-6OLD'")
      .get();
    db.reserveDemand(d, { allocations: [{ orderItemId: oldItem.id, qty: 5 }] });
    db.setOrderStatus(d, oldId, 'shipped'); // ship it — its reservation must stop counting
    db.upsertOrder(d, {
      channel: 'wix',
      channelOrderId: 'O-6NEW',
      customerEmail: 'o6b@ex.de',
      items: [{ channelSku: 'WX-6', title: 'AIO', qty: 3 }]
    });
    const row = db.computeProductionDemand(d).find((r) => r.productId === pid);
    assert.ok(row, 'new demand row present (was silently dropped before the fix)');
    assert.equal(row.demand, 3);
    assert.equal(row.reserved, 0, 'shipped order reservation excluded from the rollup');
    assert.equal(row.toProduce, 3);
  });

  it('#1 getBilledShipment flags a billable label and ignores a test announce', () => {
    const oid = db.upsertOrder(d, { channel: 'wix', channelOrderId: 'O-SHIP', customerEmail: 'sh@ex.de', items: [] });
    assert.equal(db.getBilledShipment(d, oid), null, 'none yet → first buy allowed');
    db.insertShipment(d, { orderId: oid, provider: 'sendcloud', providerParcelId: 'P1', status: 'announced' });
    assert.equal(db.getBilledShipment(d, oid), null, 'a test announce is not billable');
    const sid = db.insertShipment(d, {
      orderId: oid,
      provider: 'sendcloud',
      providerParcelId: 'P2',
      trackingNumber: 'T2',
      status: 'created'
    });
    const billed = db.getBilledShipment(d, oid);
    assert.ok(billed && billed.id === sid, 'a real bought label is detected → blocks a second buy');
  });
});
