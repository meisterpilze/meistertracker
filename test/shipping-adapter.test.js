'use strict';
// Sendcloud adapter (shipping.js) — verified with a mocked global.fetch so no
// network call and (critically) no billable label is ever created.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ship = require('../shipping.js');

function mockFetch(handler) {
  const orig = global.fetch;
  global.fetch = async (url, opts) => handler(url, opts);
  return () => {
    global.fetch = orig;
  };
}
function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

const cfg = { provider: 'sendcloud', publicKey: 'pub', secretKey: 'sec', defaultWeightG: 1000 };

describe('sendcloud adapter', () => {
  it('lists methods and filters by weight', async () => {
    const restore = mockFetch(async (url) => {
      assert.ok(url.includes('/shipping_methods'), 'calls shipping_methods');
      return jsonRes(200, {
        shipping_methods: [
          { id: 1, name: 'Light', carrier: 'dpd', min_weight: '0.000', max_weight: '1.000' },
          { id: 2, name: 'Heavy', carrier: 'dhl_de', min_weight: '2.000', max_weight: '5.000' }
        ]
      });
    });
    try {
      const all = await ship.sendcloud.listMethods(cfg, {});
      assert.equal(all.length, 2);
      const light = await ship.sendcloud.listMethods(cfg, { weightG: 500 });
      assert.equal(light.length, 1);
      assert.equal(light[0].id, 1);
    } finally {
      restore();
    }
  });

  it('buys a label with the right parcel body and parses the response', async () => {
    let sent = null;
    const restore = mockFetch(async (url, opts) => {
      sent = { url, body: JSON.parse(opts.body), auth: opts.headers.Authorization };
      return jsonRes(200, {
        parcel: {
          id: 555,
          tracking_number: 'TRK9',
          tracking_url: 'http://t/9',
          carrier: { code: 'dpd' },
          shipment: { id: 8, name: 'DPD Classic' },
          label: { label_printer: 'http://l/a6', normal_printer: ['http://l/a4'] }
        }
      });
    });
    try {
      const order = {
        id: 7,
        channel: 'wix',
        channelOrderId: 'W-7',
        customerName: 'Max',
        customerEmail: 'm@e.de',
        shipName: 'Max M',
        shipStreet: 'Hauptstr',
        shipHouse: '5',
        shipCity: 'Erlangen',
        shipPostal: '91054',
        shipCountry: 'de'
      };
      const r = await ship.sendcloud.buyLabel(cfg, { order, methodId: 8, weightG: 1500 });
      assert.ok(sent.auth.startsWith('Basic '), 'basic auth header');
      assert.equal(sent.body.parcel.shipment.id, 8);
      assert.equal(sent.body.parcel.request_label, true);
      assert.equal(sent.body.parcel.postal_code, '91054');
      assert.equal(sent.body.parcel.country, 'DE', 'country upper-cased');
      assert.equal(sent.body.parcel.weight, '1.500', 'grams -> kg string');
      assert.equal(sent.body.parcel.order_number, 'wix-W-7');
      assert.equal(r.trackingNumber, 'TRK9');
      assert.equal(r.labelUrl, 'http://l/a6', 'prefers label-printer (A6/100x150) url');
      assert.equal(r.labelFormat, 'pdf_a6');
      assert.equal(r.providerParcelId, '555');
      assert.equal(r.carrier, 'dpd');
    } finally {
      restore();
    }
  });

  it('announces only (no billable label) when requestLabel is false (test mode)', async () => {
    let sent = null;
    const restore = mockFetch(async (url, opts) => {
      sent = JSON.parse(opts.body);
      return jsonRes(200, { parcel: { id: 556, label: {} } });
    });
    try {
      const order = { id: 8, channel: 'wix', channelOrderId: 'W-8', shipCountry: 'de' };
      const r = await ship.sendcloud.buyLabel(cfg, { order, methodId: 8, weightG: 1000, requestLabel: false });
      assert.equal(sent.parcel.request_label, false, 'test mode must NOT request a billable label');
      assert.equal(r.status, 'announced');
    } finally {
      restore();
    }
  });

  it('throws on a Sendcloud error response', async () => {
    const restore = mockFetch(async () => jsonRes(400, { error: { message: 'bad address' } }));
    try {
      await assert.rejects(() => ship.sendcloud.listMethods(cfg, {}), /bad address/);
    } finally {
      restore();
    }
  });

  it('#10 maps a full country name to its ISO-3166 alpha-2 code', async () => {
    let sent = null;
    const restore = mockFetch(async (url, opts) => {
      sent = JSON.parse(opts.body);
      return jsonRes(200, { parcel: { id: 1, label: {} } });
    });
    try {
      await ship.sendcloud.buyLabel(cfg, {
        order: { id: 1, shipCountry: 'Germany' },
        methodId: 1,
        weightG: 1000,
        requestLabel: false
      });
      assert.equal(sent.parcel.country, 'DE', 'full name "Germany" → DE');
    } finally {
      restore();
    }
  });

  it('#10 rejects an unmappable country instead of buying an invalid label', async () => {
    const restore = mockFetch(async () => jsonRes(200, { parcel: { id: 1, label: {} } }));
    try {
      await assert.rejects(
        () =>
          ship.sendcloud.buyLabel(cfg, {
            order: { id: 1, shipCountry: 'Atlantis' },
            methodId: 1,
            weightG: 1000,
            requestLabel: false
          }),
        /Ungültiges Zielland/
      );
    } finally {
      restore();
    }
  });
});
