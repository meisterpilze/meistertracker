'use strict';
// Live channel sync: sales_channel_config round-trip (+ secret masking) and Wix
// order normalization, including end-to-end ingest via upsertOrder with the
// structured ship-to address.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const channels = require('../channels.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_chan_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

describe('sales channel config', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('defaults to disabled with empty creds', () => {
    const cfg = db.getChannelConfig(d, 'wix');
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.apiKey, '');
    assert.equal(cfg.siteId, '');
  });

  it('round-trips config and masks secrets in the list', () => {
    db.updateChannelConfig(d, 'wix', { enabled: true, apiKey: 'KEY123', siteId: 'site-abc' });
    const cfg = db.getChannelConfig(d, 'wix');
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.apiKey, 'KEY123');
    assert.equal(cfg.siteId, 'site-abc');
    const list = db.listChannelConfigs(d);
    const wix = list.find((c) => c.channel === 'wix');
    assert.equal(wix.hasApiKey, true);
    assert.equal(wix.apiKey, undefined, 'raw apiKey never leaves the server');
    assert.equal(wix.connected, true, 'wix connected = apiKey + siteId set');
    assert.equal(list.length, 3, 'wix/etsy/ebay');
  });

  it('records sync state', () => {
    db.setChannelSyncState(d, 'wix', { lastSync: '2026-06-16T00:00:00Z', lastError: null });
    const cfg = db.getChannelConfig(d, 'wix');
    assert.equal(cfg.lastSync, '2026-06-16T00:00:00Z');
    assert.equal(cfg.lastError, null);
  });
});

describe('Wix order normalization', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('normalizes a Wix order and ingests it with the ship address', () => {
    const wixOrder = {
      id: 'abc-1',
      number: 1007,
      status: 'APPROVED',
      fulfillmentStatus: 'NOT_FULFILLED',
      createdDate: '2026-06-15T10:00:00Z',
      currency: 'EUR',
      priceSummary: { total: { amount: '24.90', currency: 'EUR' } },
      buyerInfo: { email: 'kunde@example.de' },
      recipientInfo: {
        contactDetails: { firstName: 'Max', lastName: 'Mustermann', phone: '+4915112345678', company: 'Pilz GmbH' },
        address: {
          streetAddress: { name: 'Hauptstr', number: '5' },
          city: 'Erlangen',
          postalCode: '91054',
          country: 'DE'
        }
      },
      lineItems: [
        {
          quantity: 2,
          productName: { original: "Lion's Mane Kit" },
          price: { amount: '12.45' },
          physicalProperties: { sku: 'LM-KIT' },
          catalogReference: { catalogItemId: 'cat-1' }
        }
      ]
    };
    const o = channels._normalizeWix(wixOrder);
    assert.equal(o.channel, 'wix');
    assert.equal(o.channelOrderId, '1007');
    assert.equal(o.status, 'new');
    assert.equal(o.customerName, 'Max Mustermann');
    assert.equal(o.customerEmail, 'kunde@example.de');
    assert.equal(o.totalAmount, 24.9);
    assert.equal(o.shipStreet, 'Hauptstr');
    assert.equal(o.shipHouse, '5');
    assert.equal(o.shipPostal, '91054');
    assert.equal(o.shipCity, 'Erlangen');
    assert.equal(o.items.length, 1);
    assert.equal(o.items[0].channelSku, 'LM-KIT');
    assert.equal(o.items[0].qty, 2);

    const orderId = db.upsertOrder(d, o);
    const stored = db.getOrderForShipping(d, orderId);
    assert.equal(stored.shipPostal, '91054');
    assert.equal(stored.shipName, 'Max Mustermann');
    assert.equal(stored.shipCity, 'Erlangen');

    // Re-sync is idempotent (dedupe by channel + channelOrderId).
    db.upsertOrder(d, o);
    const list = db.listOrders(d, { channel: 'wix' });
    assert.equal(list.length, 1);
  });

  it('splits an embedded house number out of the Wix street line', () => {
    const o = channels._normalizeWix({
      number: 10001,
      createdDate: '2025-08-12T00:00:00Z',
      recipientInfo: {
        contactDetails: { firstName: 'Cam', lastName: 'Ortiz' },
        address: { streetAddress: { name: 'Markgrafenallee 18' }, city: 'Bayreuth', postalCode: '95448', country: 'DE' }
      },
      lineItems: []
    });
    assert.equal(o.shipStreet, 'Markgrafenallee');
    assert.equal(o.shipHouse, '18');
  });
});
