'use strict';
// Wix → Billbee, the one place orders travel *out* of this server.
//
// Billbee cannot fetch Wix itself: its Wix connector parses the order mail Wix
// sends the merchant, and that mail carries no order data — no address, no
// positions, just a link into the dashboard. So the hub reads the Wix API and
// files the sale into Billbee instead. These tests cover the whole bridge, from a
// raw Wix order to the body that gets posted, plus the two rules that keep it from
// doing damage: never push what came from Billbee, and never claim money.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const channels = require('../channels.js');

// A Wix eCommerce order as the API returns one, trimmed to the fields the
// normaliser actually reads.
function wixOrder(over = {}) {
  return {
    number: 1042,
    id: 'wix-internal-id',
    createdDate: '2026-01-15T10:00:00.000Z',
    status: 'APPROVED',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'NOT_FULFILLED',
    currency: 'EUR',
    priceSummary: { total: { amount: '39.00', currency: 'EUR' } },
    buyerInfo: { email: 'kundin@example.de' },
    recipientInfo: {
      contactDetails: { firstName: 'Erika', lastName: 'Musterfrau', phone: '+49 170 0000000' },
      address: {
        streetAddress: { name: 'Musterstraße', number: '7' },
        city: 'Musterstadt',
        postalCode: '00000',
        country: 'DE'
      }
    },
    lineItems: [
      {
        physicalProperties: { sku: 'BEISPIEL-ARTIKEL-1' },
        productName: { original: 'Beispielartikel' },
        quantity: 2,
        price: { amount: '19.50' }
      }
    ],
    channelInfo: { type: 'WEB' },
    ...over
  };
}

describe('a Wix order becomes a Billbee order', () => {
  const payloadFor = (over) => channels._billbeeOrderPayload(channels._normalizeWix(wixOrder(over)));

  it('carries the Wix order number, not the internal id', () => {
    // Billbee shows this to the merchant and it has to match what Wix shows them.
    assert.equal(payloadFor().OrderNumber, '1042');
  });

  it('keeps the SKU, which is the only thing Billbee matches an article on', () => {
    // A renamed article proved the point the hard way: an order whose SKU finds no
    // article makes Billbee mint a new one under the old name.
    assert.equal(payloadFor().OrderItems[0].Product.SKU, 'BEISPIEL-ARTIKEL-1');
  });

  it('multiplies the unit price back out into a position total', () => {
    // The hub stores a unit price; Billbee reads TotalPrice as the whole position.
    // Getting this backwards halves or doubles every order that is not quantity 1.
    const item = payloadFor().OrderItems[0];
    assert.equal(item.Quantity, 2);
    assert.equal(item.TotalPrice, 39);
  });

  it('splits the recipient into first and last name', () => {
    const a = payloadFor().ShippingAddress;
    assert.equal(a.FirstName, 'Erika');
    assert.equal(a.LastName, 'Musterfrau');
  });

  it('sends the address, because an order nobody can ship is no use to Billbee', () => {
    const a = payloadFor().ShippingAddress;
    assert.equal(a.Street, 'Musterstraße');
    assert.equal(a.HouseNumber, '7');
    assert.equal(a.Zip, '00000');
    assert.equal(a.City, 'Musterstadt');
    assert.equal(a.CountryISO2, 'DE');
  });

  it('recovers the house number when Wix left it inside the street line', () => {
    // Wix fills streetAddress.number on only a minority of orders.
    const a = payloadFor({
      recipientInfo: {
        contactDetails: { firstName: 'Erika', lastName: 'Musterfrau' },
        address: { streetAddress: { name: 'Musterstraße 7' }, city: 'Musterstadt', postalCode: '00000', country: 'DE' }
      }
    }).ShippingAddress;
    assert.equal(a.Street, 'Musterstraße');
    assert.equal(a.HouseNumber, '7');
  });

  it('bills to the same address it ships to', () => {
    const p = payloadFor();
    assert.deepEqual(p.InvoiceAddress, p.ShippingAddress);
  });
});

describe('what the push is willing to claim about money', () => {
  const stateFor = (over) => channels._billbeeStateFor(channels._normalizeWix(wixOrder(over)));

  it('files a paid order as paid', () => {
    assert.equal(stateFor(), 3);
  });

  it('does not call an unpaid order paid', () => {
    // 2 is "confirmed". The hub's three statuses say nothing about money, and a
    // wrongly-paid order walks straight into Billbee's "bezahlte Aufträge, die
    // versendet werden können" list — and from there into the bookkeeping.
    assert.equal(stateFor({ paymentStatus: 'NOT_PAID' }), 2);
    assert.equal(stateFor({ paymentStatus: undefined }), 2);
  });

  it('only attaches a paid amount when it filed the order as paid', () => {
    const paid = channels._billbeeOrderPayload(channels._normalizeWix(wixOrder()));
    assert.equal(paid.PaidAmount, 39);
    const unpaid = channels._billbeeOrderPayload(channels._normalizeWix(wixOrder({ paymentStatus: 'NOT_PAID' })));
    assert.equal(unpaid.PaidAmount, undefined);
    assert.equal(unpaid.PayedAt, undefined);
  });

  it('passes cancelled and shipped through as their own states', () => {
    assert.equal(stateFor({ status: 'CANCELED' }), 8);
    assert.equal(stateFor({ fulfillmentStatus: 'FULFILLED' }), 4);
  });
});

describe('the push refuses to feed Billbee its own orders', () => {
  it('rejects anything that did not come from Wix', async () => {
    // An order imported *from* Billbee and pushed back would be filed as a second,
    // unrelated sale — the two ids have nothing to do with each other, so nothing
    // would ever merge them again.
    await assert.rejects(
      () =>
        channels.billbee.pushOrder(
          { apiKey: 'K', clientId: 'a@example.de', clientSecret: 'pw' },
          { channel: 'billbee', channelOrderId: '5' }
        ),
      /nur für Wix/
    );
  });

  it('rejects a Wix order without a number', async () => {
    await assert.rejects(
      () =>
        channels.billbee.pushOrder({ apiKey: 'K', clientId: 'a@example.de', clientSecret: 'pw' }, { channel: 'wix' }),
      /Bestellnummer fehlt/
    );
  });
});

describe('an order is pushed once and only once', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_bbpush_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('knows nothing about an order it has not pushed', () => {
    assert.equal(db.billbeePushedAt(d, 'wix', '1042'), null);
  });

  it('remembers one it has', () => {
    db.markBillbeePushed(d, 'wix', '1042', '2026-01-15T12:00:00.000Z');
    assert.equal(db.billbeePushedAt(d, 'wix', '1042'), '2026-01-15T12:00:00.000Z');
  });

  it('keeps the channels apart', () => {
    // 1042 is a Wix number; an eBay order could carry the same one.
    assert.equal(db.billbeePushedAt(d, 'ebay', '1042'), null);
  });

  it('leaves a failed push unmarked, so the next sync retries it', () => {
    // This is the whole reason for a mark per order rather than a high-water mark:
    // the marks are what make a push that failed — a key not yet approved, a 429,
    // a restart mid-run — come back round instead of being skipped for ever.
    assert.equal(db.billbeePushedAt(d, 'wix', '1041'), null);
  });
});
