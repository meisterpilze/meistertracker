'use strict';
// Phase 4 Versand foundation (migration v47): shipping_config round-trip,
// shipment CRUD, and the structured ship-to address on orders.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_ship_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

describe('Phase 4 Versand foundation', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('seeds a shipping_config row with sane defaults', () => {
    const cfg = db.getShippingConfig(d);
    assert.equal(cfg.provider, 'sendcloud');
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.mode, 'test');
    assert.equal(cfg.defaultWeightG, 1000);
    assert.equal(cfg.secretKey, '');
  });

  it('round-trips shipping_config updates', () => {
    db.updateShippingConfig(d, {
      enabled: true,
      publicKey: 'pub_123',
      secretKey: 'sec_456',
      mode: 'live',
      defaultWeightG: 1500,
      defaultMethod: '8'
    });
    const cfg = db.getShippingConfig(d);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.publicKey, 'pub_123');
    assert.equal(cfg.secretKey, 'sec_456');
    assert.equal(cfg.mode, 'live');
    assert.equal(cfg.defaultWeightG, 1500);
    assert.equal(cfg.defaultMethod, '8');
  });

  it('partial config update leaves other fields intact', () => {
    db.updateShippingConfig(d, { mode: 'test' });
    const cfg = db.getShippingConfig(d);
    assert.equal(cfg.mode, 'test');
    assert.equal(cfg.publicKey, 'pub_123', 'publicKey preserved');
    assert.equal(cfg.defaultWeightG, 1500, 'weight preserved');
  });

  it('inserts, lists and updates shipments', () => {
    const id = db.insertShipment(d, {
      orderId: null,
      provider: 'sendcloud',
      providerParcelId: 'P1',
      carrier: 'dhl',
      methodId: 8,
      methodName: 'DHL Paket',
      trackingNumber: 'TRK1',
      trackingUrl: 'http://t/1',
      labelUrl: 'http://l/1',
      labelFormat: 'pdf_a6',
      cost: 4.2,
      currency: 'EUR',
      status: 'created'
    });
    assert.ok(id > 0);
    let list = db.listShipments(d, {});
    assert.equal(list.length, 1);
    assert.equal(list[0].trackingNumber, 'TRK1');
    assert.equal(list[0].methodId, '8', 'methodId coerced to string');
    assert.equal(list[0].channelPushed, false);

    db.updateShipmentStatus(d, id, { status: 'announced', channelPushed: true });
    list = db.listShipments(d, {});
    assert.equal(list[0].status, 'announced');
    assert.equal(list[0].channelPushed, true);
  });

  it('updates a structured ship-to address on an order', () => {
    const now = new Date().toISOString();
    d.prepare(
      "INSERT INTO orders(channel, channel_order_id, status, customer_name, ship_country, imported, updated) VALUES('manual','O-1','new','Max M','DE',?,?)"
    ).run(now, now);
    const orderId = d.prepare("SELECT id FROM orders WHERE channel_order_id='O-1'").get().id;
    db.updateOrderShipAddress(d, orderId, {
      shipName: 'Max Mustermann',
      shipStreet: 'Hauptstr',
      shipHouse: '5',
      shipCity: 'Erlangen',
      shipPostal: '91054',
      shipCountry: 'DE',
      shipWeightG: 800
    });
    const row = d.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    assert.equal(row.ship_name, 'Max Mustermann');
    assert.equal(row.ship_postal, '91054');
    assert.equal(row.ship_city, 'Erlangen');
    assert.equal(row.ship_weight_g, 800);
  });
});
