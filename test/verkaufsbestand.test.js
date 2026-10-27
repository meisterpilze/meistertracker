'use strict';
// Verkaufsbestand auf der Laborseite: was die Shops verkaufen, je Art und
// Größe, mit allen Nullen, und was Billbee davon zuletzt bekommen hat.
//
// Drei Dinge werden geprüft: dass jeder Angemeldete die Zahlen lesen kann
// (das Labor ist meist nicht Admin), dass die Tabelle zeigt, was fehlt, statt
// es wegzulassen, und dass die Karte am Telefon nicht hinter einem Reiter
// verschwindet.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { routen } = require('./helpers/routen');

const ABSCHNITT = {
  name: 'verkaufsbestand',
  von: '// The same count for the Labor page',
  bis: "if (req.method === 'POST' && req.url === '/api/syringe-stock/push')",
  helfer: ['jsonOk', 'jsonErr', 'safeErr']
};

let seq = 0;
function kultur(d, db, strainId, type, status, ml) {
  seq++;
  db.insertCultures(d, [
    {
      id: type + '-TST-261026-' + String(seq).padStart(2, '0'),
      type,
      strainId,
      status,
      notes: '',
      created: '2026-10-26T00:00:00Z',
      ...(ml ? { ml } : {})
    }
  ]);
}

describe('Verkaufsbestand: die Route', () => {
  let r, a, b, c;
  before(() => {
    r = routen(ABSCHNITT);
    const { db, database: d } = r;
    a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
    b = Number(db.createMushroomStrain(d, { name: 'Testart Beta', kuerzel: 'TB' }));
    c = Number(db.createMushroomStrain(d, { name: 'Testart Gamma', kuerzel: 'TG' }));
    db.setSyringeSku(d, a, 10, 'SPRI-TEST-ALPHA10');
    db.setSyringeSku(d, a, 50, 'SPRI-TEST-ALPHA50');
    db.setSyringeSku(d, b, 'pd', 'PETRI-TEST-BETA');
    kultur(d, db, a, 'SY', 'active', 10);
    kultur(d, db, a, 'SY', 'stored', 10);
    kultur(d, db, a, 'SY', 'used', 10);
    // Gamma hat Spritzen im Labor, aber keine SKU: kein Shop verkauft sie.
    kultur(d, db, c, 'SY', 'active', 10);
  });
  after(() => r.schliessen());

  it('liest jeder Angemeldete, nicht nur der Admin', async () => {
    const res = await r.anfrage('GET', '/api/sale-stock');
    assert.equal(res.status, 200);
    assert.equal(res.json.enabled, false);
  });

  it('zeigt jeden Artikel mit SKU, auch die Nullen, und keinen ohne', async () => {
    const { json } = await r.anfrage('GET', '/api/sale-stock');
    const kurz = json.rows.map((x) => [x.name, x.type, x.slot, x.count]);
    assert.deepEqual(kurz, [
      ['Testart Alpha', 'SY', 10, 2],
      ['Testart Alpha', 'SY', 50, 0],
      ['Testart Beta', 'PD', 'pd', 0]
    ]);
    assert.ok(!json.rows.some((x) => x.strainId === c), 'Gamma hat keine SKU und gehört nicht in den Verkaufsbestand');
  });

  it('sagt, was Billbee zuletzt bekommen hat, und nennt die SKU nicht', async () => {
    const { db, database: d } = r;
    db.recordSyringePush(d, a, 10, { count: 2, billbeeStock: 1 });
    db.recordSyringePush(d, a, 50, { error: 'Billbee kennt die SKU nicht.' });
    const { json } = await r.anfrage('GET', '/api/sale-stock');
    const zehn = json.rows.find((x) => x.slot === 10);
    assert.equal(zehn.pushedCount, 2);
    assert.equal(zehn.billbeeStock, 1);
    assert.ok(zehn.pushedAt);
    assert.equal(json.rows.find((x) => x.slot === 50).lastError, 'Billbee kennt die SKU nicht.');
    assert.ok(!('sku' in zehn), 'die SKU setzt der Admin; die Laborseite braucht sie nicht');
  });

  it('meldet, ob der Abgleich an ist', async () => {
    r.db.setSyringeStockSyncEnabled(r.database, true);
    const { json } = await r.anfrage('GET', '/api/sale-stock');
    assert.equal(json.enabled, true);
  });
});
