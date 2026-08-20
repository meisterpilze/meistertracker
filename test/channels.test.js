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
    assert.equal(list.length, 4, 'wix/etsy/ebay/billbee');
  });

  it('billbee counts as connected once key, login and API password are set', () => {
    // Not accessToken like the OAuth channels, and not siteId like Wix: Billbee
    // authenticates with an app key *and* the account it acts for.
    db.updateChannelConfig(d, 'billbee', { apiKey: 'BB', clientId: 'jonas@example.de' });
    const half = db.listChannelConfigs(d).find((c) => c.channel === 'billbee');
    assert.equal(half.connected, false, 'no API password yet');
    db.updateChannelConfig(d, 'billbee', { clientSecret: 'api-pw' });
    const full = db.listChannelConfigs(d).find((c) => c.channel === 'billbee');
    assert.equal(full.connected, true);
    assert.equal(full.clientSecret, undefined, 'the API password never leaves the server');
    assert.equal(full.hasClientSecret, true);
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

  it('attributes the order to its true origin (Wix aggregates eBay/Etsy)', () => {
    const mk = (type) =>
      channels._normalizeWix({
        number: 1,
        channelInfo: type ? { type } : undefined,
        recipientInfo: { contactDetails: {}, address: {} },
        lineItems: []
      });
    assert.equal(mk('EBAY').channel, 'ebay');
    assert.equal(mk('ETSY').channel, 'etsy');
    assert.equal(mk('WEB').channel, 'wix');
    assert.equal(mk(undefined).channel, 'wix');
  });
});

describe('Wix write-back + WEB-only sync', () => {
  function mockFetch(handler) {
    const orig = global.fetch;
    global.fetch = async (url, opts) => handler(url, opts);
    return () => {
      global.fetch = orig;
    };
  }
  const jsonRes = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  });
  const cfg = { apiKey: 'KEY', siteId: 'SITE', clientId: 'ACC' };

  it('fetchOrders imports only WEB-origin orders', async () => {
    const restore = mockFetch(async () =>
      jsonRes(200, {
        orders: [
          {
            id: 'a',
            number: 1,
            channelInfo: { type: 'WEB' },
            recipientInfo: { contactDetails: {}, address: {} },
            lineItems: []
          },
          {
            id: 'b',
            number: 2,
            channelInfo: { type: 'EBAY' },
            recipientInfo: { contactDetails: {}, address: {} },
            lineItems: []
          },
          {
            id: 'c',
            number: 3,
            channelInfo: { type: 'ETSY' },
            recipientInfo: { contactDetails: {}, address: {} },
            lineItems: []
          }
        ],
        metadata: { cursors: {} }
      })
    );
    try {
      const { orders } = await channels.wix.fetchOrders(cfg, {});
      assert.equal(orders.length, 1);
      assert.equal(orders[0].channel, 'wix');
      assert.equal(orders[0].channelOrderId, '1');
    } finally {
      restore();
    }
  });

  it('pushTracking posts a Wix fulfillment with the tracking number', async () => {
    let sent = null;
    const restore = mockFetch(async (url, opts) => {
      sent = { url, body: JSON.parse(opts.body), headers: opts.headers };
      return jsonRes(200, { fulfillment: { id: 'f1' } });
    });
    try {
      const r = await channels.wix.pushTracking(cfg, {
        raw: { id: 'ORDER-GUID', lineItems: [{ id: 'li1', quantity: 2 }] },
        trackingNumber: 'TRK123',
        trackingUrl: 'http://t/123',
        carrier: 'dhl_de'
      });
      assert.equal(r.ok, true);
      assert.ok(sent.url.includes('/fulfillments/orders/ORDER-GUID/create-fulfillment'), 'create-fulfillment endpoint');
      assert.equal(sent.headers['wix-account-id'], 'ACC');
      assert.equal(sent.body.fulfillment.trackingInfo.trackingNumber, 'TRK123');
      assert.equal(sent.body.fulfillment.trackingInfo.shippingProvider, 'dhl_de');
      assert.equal(sent.body.fulfillment.lineItems[0].id, 'li1');
      assert.equal(sent.body.fulfillment.lineItems[0].quantity, 2);
    } finally {
      restore();
    }
  });
});

describe('channel review fixes (recall pass)', () => {
  function mockFetch(handler) {
    const orig = global.fetch;
    global.fetch = async (url, opts) => handler(url, opts);
    return () => {
      global.fetch = orig;
    };
  }
  const jsonRes = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  });

  it('#3 eBay normalizer sets buyerHandle from the username (email is masked)', () => {
    const o = channels._normalizeEbay({ orderId: '1', buyer: { username: 'pilzfan' }, lineItems: [] });
    assert.equal(o.buyerHandle, 'pilzfan');
    assert.equal(o.customerEmail, null, 'eBay does not expose the buyer email');
  });

  it('#3 Etsy normalizer sets buyerHandle from buyer_user_id', () => {
    const o = channels._normalizeEtsy({ receipt_id: 5, buyer_user_id: 42, transactions: [] });
    assert.equal(o.buyerHandle, '42');
  });

  it('#7 Etsy refresh: a missing expires_in yields a ~1h expiry, not expire-now', async () => {
    const restore = mockFetch(async () => jsonRes(200, { access_token: 'NEW' })); // no expires_in
    try {
      const tok = await channels.etsy.refreshAccessToken({ clientId: 'K', refreshToken: 'R' });
      assert.equal(tok.accessToken, 'NEW');
      assert.equal(tok.refreshToken, 'R', 'keeps the stored refresh token when omitted');
      const ms = Date.parse(tok.tokenExpires) - Date.now();
      assert.ok(ms > 3000 * 1000 && ms <= 3600 * 1000 + 1000, 'expiry ~1h out, not now (' + ms + 'ms)');
    } finally {
      restore();
    }
  });

  it('#8 Etsy refresh: a 2xx body without access_token throws (never persists an empty token)', async () => {
    const restore = mockFetch(async () => jsonRes(200, { error: 'invalid_grant' }));
    try {
      await assert.rejects(
        () => channels.etsy.refreshAccessToken({ clientId: 'K', refreshToken: 'R' }),
        /access_token/
      );
    } finally {
      restore();
    }
  });

  it('#9 Etsy fetchOrders keeps paging on a short page that is still below the total', async () => {
    const cfg = { clientId: 'K', accessToken: 'u1.tok-' + Math.random().toString(36).slice(2) };
    const restore = mockFetch(async (url) => {
      // The receipts URL also contains '/shops/', so match the receipts call first.
      if (url.includes('/receipts')) {
        // 80 results (< limit 100) but count says 150 → must NOT stop paging here.
        return jsonRes(200, { count: 150, results: Array.from({ length: 80 }, (_, i) => ({ receipt_id: i + 1 })) });
      }
      return jsonRes(200, { results: [{ shop_id: 99 }] }); // /users/<uid>/shops
    });
    try {
      const { orders, nextCursor } = await channels.etsy.fetchOrders(cfg, {});
      assert.equal(orders.length, 80);
      assert.equal(nextCursor, '80', 'short page below the reported count still advances the cursor');
    } finally {
      restore();
    }
  });
});

// House-number extraction. Real Wix data: only 41 of 151 live orders carry
// streetAddress.number, so the street line is the real source. Shared by all
// three channels, hence tested directly.
describe('house number extraction from a street line', () => {
  const split = channels._splitHouse;

  it('takes a trailing number (DE/AT convention)', () => {
    assert.deepEqual(split('Markgrafenallee 18'), { street: 'Markgrafenallee', house: '18' });
    assert.deepEqual(split('Musterweg 18a'), { street: 'Musterweg', house: '18a' });
    assert.deepEqual(split('Musterstr. 18 a'), { street: 'Musterstr.', house: '18a' });
    assert.deepEqual(split('Am Alten Bahnhof 7'), { street: 'Am Alten Bahnhof', house: '7' });
  });

  it('takes a leading number (FR/NL/BE/IE convention) — we ship EU-wide', () => {
    assert.deepEqual(split('12 Rue de la Paix'), { street: 'Rue de la Paix', house: '12' });
    assert.deepEqual(split('9 Main Street'), { street: 'Main Street', house: '9' });
    assert.deepEqual(split('221 Baker Street'), { street: 'Baker Street', house: '221' });
  });

  it('keeps a range or slash form together as one house number', () => {
    assert.deepEqual(split('Bahnhofstrasse 18-20'), { street: 'Bahnhofstrasse', house: '18-20' });
    assert.deepEqual(split('Musterstr 12/3'), { street: 'Musterstr', house: '12/3' });
    assert.deepEqual(split('18-20 High Street'), { street: 'High Street', house: '18-20' });
  });

  it('refuses to guess rather than inventing a wrong house number', () => {
    // No number at all — a label with a made-up number is worse than none.
    assert.deepEqual(split('Marktplatz'), { street: 'Marktplatz', house: null });
    assert.deepEqual(split('Am Sonnenhang'), { street: 'Am Sonnenhang', house: null });
    // Ambiguous: leading digits followed by more digits could split either way.
    assert.deepEqual(split('12 3rd Avenue'), { street: '12 3rd Avenue', house: null });
    // Empty / missing input must not throw.
    assert.deepEqual(split(''), { street: null, house: null });
    assert.deepEqual(split(null), { street: null, house: null });
  });

  it('prefers Wix streetAddress.number when the channel does supply it', () => {
    const o = channels._normalizeWix({
      id: 'x-1',
      number: 2001,
      recipientInfo: {
        contactDetails: { firstName: 'A', lastName: 'B' },
        address: {
          streetAddress: { name: 'Hauptstr', number: '5' },
          city: 'Erlangen',
          postalCode: '91054',
          country: 'DE'
        }
      },
      lineItems: []
    });
    assert.equal(o.shipStreet, 'Hauptstr');
    assert.equal(o.shipHouse, '5');
  });

  it('falls back to splitting the Wix address line when number is absent', () => {
    const o = channels._normalizeWix({
      id: 'x-2',
      number: 2002,
      recipientInfo: {
        contactDetails: { firstName: 'A', lastName: 'B' },
        address: { addressLine: '12 Rue de la Paix', city: 'Paris', postalCode: '75002', country: 'FR' }
      },
      lineItems: []
    });
    assert.equal(o.shipStreet, 'Rue de la Paix');
    assert.equal(o.shipHouse, '12');
  });
});

describe('Billbee: orders in', () => {
  function mockFetch(handler) {
    const orig = global.fetch;
    global.fetch = async (url, opts) => handler(url, opts);
    return () => {
      global.fetch = orig;
    };
  }
  // Unlike the other channels' helper this one carries headers: the 429 path reads
  // Retry-After off the response.
  const jsonRes = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
    text: async () => JSON.stringify(body)
  });
  const cfg = { apiKey: 'BB-KEY', clientId: 'jonas@example.de', clientSecret: 'api-pw' };
  const order = {
    BillBeeOrderId: 4711,
    Id: 'shopify-1001',
    OrderNumber: '#1001',
    State: 3,
    CreatedAt: '2026-08-19T08:00:00Z',
    Currency: 'EUR',
    TotalCost: 24.9,
    ShippingCost: 4.9,
    ShipWeightKg: 0.75,
    ShippingAddress: {
      FirstName: 'Max',
      LastName: 'Mustermann',
      Street: 'Hauptstr 5',
      Zip: '91054',
      City: 'Erlangen',
      CountryISO2: 'DE',
      Email: 'kunde@example.de',
      Phone: '+4915112345678'
    },
    Buyer: { Platform: 'Shopify', Id: '99', FullName: 'Max Mustermann' },
    OrderItems: [{ Quantity: 2, TotalPrice: 24.9, Product: { SKU: 'AUS-250', Title: 'Austernpilze 250 g', Id: 'p1' } }]
  };

  it('normalizes a Billbee order and keys it on the internal id', () => {
    const o = channels._normalizeBillbee(order);
    assert.equal(o.channel, 'billbee');
    // Not 'shopify-1001' and not '#1001': those are the marketplace's, and two
    // marketplaces can hand out the same one.
    assert.equal(o.channelOrderId, '4711');
    assert.equal(o.status, 'new');
    assert.equal(o.customerEmail, 'kunde@example.de');
    assert.equal(o.buyerHandle, 'shopify:99', 'platform-prefixed, the id is not Billbee-scoped');
    assert.equal(o.shipStreet, 'Hauptstr');
    assert.equal(o.shipHouse, '5', 'house number split out when Billbee leaves the field empty');
    assert.equal(o.shipPostal, '91054');
    assert.equal(o.shipWeightG, 750);
    assert.equal(o.totalAmount, 29.8, 'TotalCost excludes shipping — it is added back, and rounded');
    assert.equal(o.items[0].channelSku, 'AUS-250');
    assert.equal(o.items[0].unitPrice, 12.45, 'position total ÷ quantity');
  });

  it('keeps a house number Billbee already split', () => {
    const o = channels._normalizeBillbee({
      BillBeeOrderId: 1,
      ShippingAddress: { Street: 'Pommernstraße', HouseNumber: '12a' }
    });
    assert.equal(o.shipStreet, 'Pommernstraße');
    assert.equal(o.shipHouse, '12a');
  });

  it('reads shipped and cancelled from the timestamp as well as the state id', () => {
    assert.equal(channels._billbeeStatus({ State: 1 }), 'new');
    assert.equal(channels._billbeeStatus({ State: 4 }), 'shipped');
    assert.equal(channels._billbeeStatus({ State: 7 }), 'shipped');
    assert.equal(channels._billbeeStatus({ State: 8 }), 'cancelled');
    assert.equal(channels._billbeeStatus({ State: 6 }), 'cancelled');
    // The timestamp is what makes a state id we have wrong harmless.
    assert.equal(channels._billbeeStatus({ State: 99, ShippedAt: '2026-08-19T10:00:00Z' }), 'shipped');
    // …but a cancelled order stays cancelled even if it once went out.
    assert.equal(channels._billbeeStatus({ State: 8, ShippedAt: '2026-08-19T10:00:00Z' }), 'cancelled');
  });

  it('sends both credentials and pages by Billbee’s page count', async () => {
    const seen = [];
    const restore = mockFetch(async (url, opts) => {
      seen.push({ url, headers: opts.headers });
      return jsonRes(200, { Data: [order], Paging: { Page: 1, TotalPages: 2 } });
    });
    try {
      const { orders, nextCursor } = await channels.billbee.fetchOrders(cfg, {});
      assert.equal(orders.length, 1);
      assert.equal(nextCursor, '2', 'page 1 of 2 → there is a page 2');
      assert.ok(seen[0].url.startsWith('https://api.billbee.io/api/v1/orders?'), seen[0].url);
      assert.ok(seen[0].url.includes('minOrderDate='), 'a sync must not walk the whole history');
      assert.equal(seen[0].headers['X-Billbee-Api-Key'], 'BB-KEY');
      assert.equal(
        seen[0].headers.Authorization,
        'Basic ' + Buffer.from('jonas@example.de:api-pw').toString('base64'),
        'the API key identifies the app, basic auth the account'
      );
    } finally {
      restore();
    }
  });

  it('stops paging on the last page and drops an order without an internal id', async () => {
    const restore = mockFetch(async () =>
      jsonRes(200, { Data: [order, { OrderNumber: 'no-id' }], Paging: { Page: 2, TotalPages: 2 } })
    );
    try {
      const { orders, nextCursor } = await channels.billbee.fetchOrders(cfg, { cursor: '2' });
      assert.equal(nextCursor, null);
      assert.equal(orders.length, 1, 'an order with no BillBeeOrderId cannot be deduped — dropped, not thrown');
    } finally {
      restore();
    }
  });

  it('retries once on a 429 instead of losing the page', async () => {
    let calls = 0;
    const restore = mockFetch(async () => {
      calls++;
      return calls === 1
        ? jsonRes(429, { Message: 'too fast' }, { 'retry-after': '0' })
        : jsonRes(200, { Data: [order], Paging: { Page: 1, TotalPages: 1 } });
    });
    try {
      const { orders } = await channels.billbee.fetchOrders(cfg, {});
      assert.equal(calls, 2);
      assert.equal(orders.length, 1);
    } finally {
      restore();
    }
  });

  it('names the connected shops on a test — they are the ones to switch off here', async () => {
    const restore = mockFetch(async () => jsonRes(200, { Data: [{ Name: 'Shopify' }, { Name: 'eBay' }] }));
    try {
      const r = await channels.billbee.testConnection(cfg);
      assert.deepEqual(r.shops, ['Shopify', 'eBay']);
    } finally {
      restore();
    }
  });

  it('refuses to call out with half a credential', async () => {
    await assert.rejects(() => channels.billbee.fetchOrders({ apiKey: 'BB-KEY' }, {}), /Benutzer/);
    await assert.rejects(() => channels.billbee.fetchOrders({ clientId: 'a', clientSecret: 'b' }, {}), /API-Key/);
  });

  it('writes the Sendungsnummer onto the Billbee order', async () => {
    const sent = [];
    const restore = mockFetch(async (url, opts) => {
      sent.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
      if (url.includes('/enums/shippingcarriers')) return jsonRes(200, { Data: [{ Id: 12, Name: 'DHL' }] });
      return jsonRes(200, { Data: { Id: 1 } });
    });
    try {
      const r = await channels.billbee.pushTracking(cfg, {
        raw: { BillBeeOrderId: 4711 },
        trackingNumber: 'TRK123',
        trackingUrl: 'https://t/123',
        carrier: 'DHL Paket'
      });
      assert.equal(r.ok, true);
      const post = sent[sent.length - 1];
      assert.ok(post.url.endsWith('/orders/4711/shipment'), post.url);
      assert.equal(post.body.ShippingId, 'TRK123');
      assert.equal(post.body.ShipmentType, 0);
      assert.equal(post.body.CarrierId, 12, 'carrier ids are read from Billbee, not guessed');
      assert.ok(post.body.Comment.includes('DHL Paket'));
    } finally {
      restore();
    }
  });

  it('still sends the tracking number when the carrier list is unreachable', async () => {
    let post = null;
    const restore = mockFetch(async (url, opts) => {
      if (url.includes('/enums/shippingcarriers')) return jsonRes(500, {});
      post = JSON.parse(opts.body);
      return jsonRes(200, {});
    });
    try {
      await channels.billbee.pushTracking(cfg, {
        raw: { BillBeeOrderId: 8 },
        trackingNumber: 'TRK9',
        carrier: 'Hermes'
      });
      assert.equal(post.ShippingId, 'TRK9');
      assert.equal(post.CarrierId, undefined, 'no id rather than a wrong one');
      assert.ok(post.Comment.includes('Hermes'), 'the name still travels');
    } finally {
      restore();
    }
  });
});

describe('Billbee: stock out', () => {
  function mockFetch(handler) {
    const orig = global.fetch;
    global.fetch = async (url, opts) => handler(url, opts);
    return () => {
      global.fetch = orig;
    };
  }
  const jsonRes = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body)
  });
  const cfg = { apiKey: 'BB-KEY', clientId: 'jonas@example.de', clientSecret: 'api-pw' };

  it('sends absolute quantities and lets Billbee subtract what is already sold', async () => {
    let body = null;
    const restore = mockFetch(async (url, opts) => {
      body = JSON.parse(opts.body);
      return jsonRes(200, [{ Data: { SKU: 'AUS-250', CurrentStock: 8 } }]);
    });
    try {
      const r = await channels.billbee.pushStock(cfg, [{ sku: 'AUS-250', qty: 8, reason: 'Freigabe' }]);
      assert.equal(r.pushed, 1);
      assert.equal(r.failed, 0);
      assert.equal(body[0].Sku, 'AUS-250');
      assert.equal(body[0].NewQuantity, 8);
      assert.equal(body[0].AutosubtractReservedAmount, true, 'or an open order would be sellable twice');
    } finally {
      restore();
    }
  });

  it('counts a per-article error as failed instead of throwing the batch away', async () => {
    const restore = mockFetch(async () =>
      jsonRes(200, [{ Data: { SKU: 'A' } }, { ErrorMessage: 'SKU unbekannt', Data: { SKU: 'B' } }])
    );
    try {
      const r = await channels.billbee.pushStock(cfg, [
        { sku: 'A', qty: 1 },
        { sku: 'B', qty: 2 }
      ]);
      assert.equal(r.pushed, 1);
      assert.equal(r.failed, 1);
      assert.equal(r.results[1].message, 'SKU unbekannt');
    } finally {
      restore();
    }
  });

  it('does not call out at all for an empty list', async () => {
    let called = 0;
    const restore = mockFetch(async () => {
      called++;
      return jsonRes(200, []);
    });
    try {
      const r = await channels.billbee.pushStock(cfg, []);
      assert.equal(called, 0);
      assert.equal(r.pushed, 0);
    } finally {
      restore();
    }
  });
});

describe('Billbee stock levels are derived from releases', () => {
  let d, p;
  // Local noon, so the lab day is 2026-08-20 in every timezone a test machine
  // might run in.
  const AT = new Date('2026-08-20T12:00:00');
  before(() => {
    ({ db: d, path: p } = tmpDb());
    const now = new Date().toISOString();
    const prod = (sku, name) =>
      d
        .prepare("INSERT INTO products(sku, name, category, active, created) VALUES(?, ?, 'fresh', 1, ?)")
        .run(sku, name, now).lastInsertRowid;
    const comp = (id, species, grams, per = 1) =>
      d
        .prepare(
          `INSERT INTO product_components(product_id, fulfill_type, species, grams, qty_per_unit)
           VALUES(?, 'harvest', ?, ?, ?)`
        )
        .run(id, species, grams, per);
    const map = (sku, id) =>
      d
        .prepare('INSERT INTO product_channel_map(channel, channel_sku, product_id, created) VALUES(?, ?, ?, ?)')
        .run('billbee', sku, id, now);
    const release = (species, grams, until) =>
      d
        .prepare('INSERT INTO harvest_release(species, grams, valid_until, updated) VALUES(?, ?, ?, ?)')
        .run(species, grams, until, now);

    const p250 = prod('AUS-250', 'Austernpilze 250 g');
    comp(p250, 'Austernseitling (AUS)', 250);
    map('AUS-250', p250);

    const p500 = prod('AUS-500', 'Austernpilze 500 g');
    comp(p500, 'Austernseitling (AUS)', 500);
    map('AUS-500', p500);

    const pOld = prod('SHI-250', 'Shiitake 250 g');
    comp(pOld, 'Shiitake (SHI)', 250);
    map('SHI-250', pOld);

    const pKit = prod('KIT-1', 'Growkit');
    map('KIT-1', pKit); // no harvest component at all

    const pTypo = prod('IGL-250', 'Igelstachelbart 250 g');
    comp(pTypo, 'Igelstachelbart', 250); // the release is filed under "Igelstachelbart (IGL)"
    map('IGL-250', pTypo);

    release('Austernseitling (AUS)', 1200, null);
    release('Shiitake (SHI)', 900, '2026-08-19'); // expired yesterday
    release('Igelstachelbart (IGL)', 800, null);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('divides the release by what one article needs, rounding down', () => {
    const { levels } = db.billbeeStockLevels(d, { at: AT });
    const by = Object.fromEntries(levels.map((l) => [l.sku, l.qty]));
    assert.equal(by['AUS-250'], 4, '1200 g ÷ 250 g = 4, not 4.8');
    assert.equal(by['AUS-500'], 2);
  });

  it('publishes an expired release as nothing left, not as unknown', () => {
    const { levels } = db.billbeeStockLevels(d, { at: AT });
    const shi = levels.find((l) => l.sku === 'SHI-250');
    assert.equal(shi.qty, 0, 'the shops have to stop offering it');
  });

  it('leaves an article it cannot compute out of the push entirely', () => {
    const { levels, skipped } = db.billbeeStockLevels(d, { at: AT });
    assert.equal(
      levels.find((l) => l.sku === 'KIT-1'),
      undefined,
      'a 0 would delist the growkit in every connected shop'
    );
    assert.ok(skipped.some((s) => s.sku === 'KIT-1' && s.reason === 'no-harvest-component'));
  });

  it('skips an article whose recipe does not say what, or how much', () => {
    const now = new Date().toISOString();
    const mk = (sku, species, grams) => {
      const id = d
        .prepare("INSERT INTO products(sku, name, category, active, created) VALUES(?, ?, 'fresh', 1, ?)")
        .run(sku, sku, now).lastInsertRowid;
      d.prepare(
        `INSERT INTO product_components(product_id, fulfill_type, species, grams, qty_per_unit)
         VALUES(?, 'harvest', ?, ?, 1)`
      ).run(id, species, grams);
      d.prepare('INSERT INTO product_channel_map(channel, channel_sku, product_id, created) VALUES(?, ?, ?, ?)').run(
        'billbee',
        sku,
        id,
        now
      );
    };
    mk('NO-GRAMS', 'Austernseitling (AUS)', null);
    mk('NO-SPECIES', null, 250);
    const { levels, skipped, unknownSpecies } = db.billbeeStockLevels(d, { at: AT });
    for (const sku of ['NO-GRAMS', 'NO-SPECIES']) {
      assert.equal(
        levels.find((l) => l.sku === sku),
        undefined,
        sku + ' must not be published as 0 — that is an answer, and there is none'
      );
      assert.ok(skipped.some((s) => s.sku === sku && s.reason === 'component-without-species-or-grams'));
    }
    assert.ok(!unknownSpecies.includes(''), 'a missing species is not a species with a strange name');
  });

  it('reports a species name the lab has never released', () => {
    const { unknownSpecies } = db.billbeeStockLevels(d, { at: AT });
    // Sold out and misspelled both read as zero — only this list tells them apart.
    assert.deepEqual(unknownSpecies, ['Igelstachelbart']);
  });

  it('gives one SKU one number, the smaller one, when two articles share it', () => {
    const now = new Date().toISOString();
    const id = d
      .prepare(
        "INSERT INTO products(sku, name, category, active, created) VALUES('AUS-ALT', 'Austern alt', 'fresh', 1, ?)"
      )
      .run(now).lastInsertRowid;
    d.prepare(
      `INSERT INTO product_components(product_id, fulfill_type, species, grams, qty_per_unit)
       VALUES(?, 'harvest', 'Austernseitling (AUS)', 250, 2)`
    ).run(id);
    d.prepare(
      "INSERT INTO product_channel_map(channel, channel_sku, listing_id, product_id, created) VALUES('billbee', 'AUS-250', 'alt', ?, ?)"
    ).run(id, now);
    const { levels } = db.billbeeStockLevels(d, { at: AT });
    const rows = levels.filter((l) => l.sku === 'AUS-250');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].qty, 2, '2 × 250 g per unit is the recipe that must not be oversold');
  });
});

describe('the Billbee card is actually wired', () => {
  // Same lesson as settings-tabs.test.js: a card can be added, translated and
  // merged while a button does nothing, because nothing throws. Worse here —
  // `$('id')` on a missing element throws inside the one init handler, so a typo
  // in an id does not break the Billbee card, it breaks the whole page.
  const ROOT = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

  it('has every element app.js reaches for', () => {
    const ids = new Set();
    for (const m of app.matchAll(/\$\('([a-z0-9-]*billbee[a-z0-9-]*)'\)/g)) ids.add(m[1]);
    for (const m of app.matchAll(/getElementById\('([a-z0-9-]*billbee[a-z0-9-]*)'\)/g)) ids.add(m[1]);
    assert.ok(ids.size >= 8, 'found the Billbee element lookups: ' + ids.size);
    for (const id of ids) assert.ok(html.includes('id="' + id + '"'), 'index.html has #' + id);
  });

  it('gives each of its four buttons a listener', () => {
    for (const id of ['billbee-save-btn', 'billbee-test-btn', 'billbee-sync-btn', 'billbee-stock-btn']) {
      const at = app.indexOf(id);
      assert.notEqual(at, -1, id + ' is referenced');
      assert.ok(app.slice(at, at + 200).includes('addEventListener'), id + ' has a listener');
    }
  });
});

describe('Billbee stock levels use the lab day, and say when an article is gone', () => {
  let d, p;
  const now = '2026-08-20T10:00:00Z';
  const prod = (sku, name, active = 1) =>
    d
      .prepare("INSERT INTO products(sku, name, category, active, created) VALUES(?, ?, 'fresh', ?, ?)")
      .run(sku, name, active, now).lastInsertRowid;
  const comp = (id, species, grams) =>
    d
      .prepare(
        `INSERT INTO product_components(product_id, fulfill_type, species, grams, qty_per_unit)
         VALUES(?, 'harvest', ?, ?, 1)`
      )
      .run(id, species, grams);
  const map = (sku, id, listing = null) =>
    d
      .prepare(
        'INSERT INTO product_channel_map(channel, channel_sku, listing_id, product_id, created) VALUES(?, ?, ?, ?, ?)'
      )
      .run('billbee', sku, listing, id, now);

  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('lets a release expire on the lab calendar, not the UTC one', () => {
    // 00:30 local: in Berlin (and every timezone east of Greenwich) the UTC clock
    // still says yesterday. The release below ran out at the end of yesterday, so
    // it must be gone — reading the UTC day here kept it on sale for two hours in
    // every shop Billbee feeds, which is the regression this pins.
    const at = new Date('2026-08-21T00:30:00');
    const id = prod('AUS-250', 'Austernpilze 250 g');
    comp(id, 'Austernseitling (AUS)', 250);
    map('AUS-250', id);
    d.prepare('INSERT INTO harvest_release(species, grams, valid_until, updated) VALUES(?, ?, ?, ?)').run(
      'Austernseitling (AUS)',
      1200,
      '2026-08-20',
      now
    );
    const { levels } = db.billbeeStockLevels(d, { at });
    assert.equal(levels.find((l) => l.sku === 'AUS-250').qty, 0);
    // Still on sale the afternoon before, so the zero above is the expiry and not
    // a fixture that never had anything in it.
    const before5pm = new Date('2026-08-20T17:00:00');
    assert.equal(db.billbeeStockLevels(d, { at: before5pm }).levels.find((l) => l.sku === 'AUS-250').qty, 4);
  });

  it('agrees with activeHarvestReleases about what is live', () => {
    // The coupling itself, so the two cannot drift apart again whatever the rule
    // becomes: a species the shared helper does not report is worth zero here.
    const at = new Date('2026-08-21T00:30:00');
    assert.equal(db.activeHarvestReleases(d, at).has('Austernseitling (AUS)'), false);
    assert.equal(db.billbeeStockLevels(d, { at }).levels.find((l) => l.sku === 'AUS-250').qty, 0);
  });

  it('pushes a retired article as 0 instead of dropping it', () => {
    const at = new Date('2026-08-20T12:00:00');
    const id = prod('SHI-250', 'Shiitake 250 g', 0);
    comp(id, 'Austernseitling (AUS)', 250);
    map('SHI-250', id);
    const row = db.billbeeStockLevels(d, { at }).levels.find((l) => l.sku === 'SHI-250');
    // Dropping it would leave the last number it was ever given standing in every
    // connected shop, for good.
    assert.equal(row.qty, 0);
    assert.equal(row.retired, true);
  });

  it('does not let a retired listing delist a SKU that is still on sale', () => {
    const at = new Date('2026-08-20T12:00:00');
    const old = prod('AUS-ALT', 'Austernpilze, alte Fassung', 0);
    comp(old, 'Austernseitling (AUS)', 250);
    map('AUS-250', old, 'alt'); // same SKU as the live article above
    const rows = db.billbeeStockLevels(d, { at }).levels.filter((l) => l.sku === 'AUS-250');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].qty, 4, 'the live article decides; the retired one only fills SKUs nobody claims');
  });
});
