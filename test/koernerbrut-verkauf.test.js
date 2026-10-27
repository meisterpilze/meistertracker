'use strict';
// Bewachsene Körnerbrut als Artikel im Shop: je Art und Beutelgröße (1, 2,
// 5 kg) die Zahl der fertigen Beutel, die noch im Regal stehen, an Billbee
// gemeldet wie eine Spritzengröße.
//
// Fertig ist ein Beutel ab dem Fälligkeitstag seiner Charge; davor wächst er
// und zählt nicht, steht aber daneben. Im Regal ist er, solange der letzte Scan
// ihn hinein- oder umgestellt hat; rausgescannt (verbraucht, verkauft,
// kontaminiert) ist er weg. Ein Beutel einer Größe, die kein Artikel ist, zählt
// nicht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { createSyringeStockSync } = require('../syringe-stock.js');
const { quelle } = require('./helpers/quelle');

const JETZT = new Date('2026-10-27T12:00:00Z');
const FERTIG = '2026-10-20T08:00:00.000Z';
const WAECHST = '2026-11-04T08:00:00.000Z';

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kbv-'));
  return { d: db.openDb(path.join(dir, 'test.db')), dir };
}
function charge(d, batchId, strainId, due, bags) {
  db.insertBatch(d, {
    batchId,
    strainId,
    qty: bags.length,
    days: 14,
    substrate: {},
    bagKg: 1,
    batchType: 'grain',
    notes: '',
    created: '2026-10-06T08:00:00.000Z',
    due,
    bags
  });
}
let uhr = 0;
function scan(d, action, bag, to) {
  uhr++;
  db.appendScanEntries(d, [
    {
      time: '2026-10-06T09:' + String(uhr).padStart(2, '0') + ':00.000Z',
      action,
      batch: bag.split('-').slice(0, -1).join('-'),
      bag,
      from: null,
      to: to === undefined ? 'SPAWN' : to
    }
  ]);
}
const gs = (d, strainId, kg, now = JETZT) =>
  db.listSyringeStock(d, now).find((r) => r.strainId === strainId && r.type === 'GS' && r.kg === kg);

describe('Körnerbrut im Verkauf: was zählt', () => {
  let d, dir, a, b;
  before(() => {
    ({ d, dir } = freshDb());
    a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
    b = Number(db.createMushroomStrain(d, { name: 'Testart Beta', kuerzel: 'TB' }));
    // Fertig: drei 1-kg-Beutel, einer davon rausgescannt, ein 2-kg-Beutel, ein
    // 3-kg-Beutel (keine Verkaufsgröße) und ein 1-kg-Beutel, der nie ins Regal kam.
    charge(d, 'G-TA-061026-01', a, FERTIG, [
      { id: 'G-TA-061026-01-01', bagKg: 1 },
      { id: 'G-TA-061026-01-02', bagKg: 1 },
      { id: 'G-TA-061026-01-03', bagKg: 1 },
      { id: 'G-TA-061026-01-04', bagKg: 2 },
      { id: 'G-TA-061026-01-05', bagKg: 3 },
      { id: 'G-TA-061026-01-06', bagKg: 1 }
    ]);
    for (const n of ['01', '02', '03', '04', '05']) scan(d, 'ADD', 'G-TA-061026-01-' + n);
    scan(d, 'REMOVE', 'G-TA-061026-01-03', null);
    // Wächst noch: zwei 1-kg-Beutel, fällig am 04.11.
    charge(d, 'G-TA-211026-01', a, WAECHST, [
      { id: 'G-TA-211026-01-01', bagKg: 1 },
      { id: 'G-TA-211026-01-02', bagKg: 1 }
    ]);
    scan(d, 'ADD', 'G-TA-211026-01-01');
    scan(d, 'ADD', 'G-TA-211026-01-02');
    // Umgestellt bleibt im Regal.
    scan(d, 'MOVE', 'G-TA-211026-01-02', 'INC');
  });
  after(() => {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('zählt fertige Beutel im Regal, nicht rausgescannte und nicht nie eingestellte', () => {
    assert.equal(gs(d, a, 1).count, 2);
    assert.equal(gs(d, a, 2).count, 1);
    assert.equal(gs(d, a, 5).count, 0);
  });

  it('was noch wächst, zählt nicht, steht aber daneben mit dem Tag, an dem es fertig ist', () => {
    const r = gs(d, a, 1);
    assert.equal(r.growing, 2);
    assert.equal(r.readyAt, WAECHST);
    assert.equal(gs(d, a, 2).growing, 0);
  });

  it('ab dem Fälligkeitstag zählt derselbe Beutel als fertig', () => {
    const spaeter = new Date('2026-11-05T00:00:00Z');
    assert.equal(gs(d, a, 1, spaeter).count, 4);
    assert.equal(gs(d, a, 1, spaeter).growing, 0);
  });

  it('ein Beutel, dessen Größe kein Artikel ist, zählt nirgends', () => {
    const summe = db
      .listSyringeStock(d, JETZT)
      .filter((r) => r.type === 'GS' && r.strainId === a)
      .reduce((s, r) => s + r.count + r.growing, 0);
    assert.equal(summe, 5, '2 + 2 wachsend bei 1 kg, 1 bei 2 kg, der 3-kg-Beutel nicht');
  });

  it('eine Art ohne Körnerbrut hat ihre Zeilen mit 0', () => {
    assert.equal(gs(d, b, 1).count, 0);
    assert.equal(gs(d, b, 1).growing, 0);
  });

  it('Spritzen und Petrischalen bleiben, wie sie waren, und kommen vor der Körnerbrut', () => {
    const typen = db
      .listSyringeStock(d, JETZT)
      .filter((r) => r.strainId === a)
      .map((r) => r.slot);
    assert.deepEqual(typen, [10, 20, 50, 'pd', 'kb1', 'kb2', 'kb5']);
  });
});

describe('Körnerbrut im Verkauf: SKU je Beutelgröße', () => {
  let d, dir, a;
  before(() => {
    ({ d, dir } = freshDb());
    a = Number(db.createMushroomStrain(d, { name: 'Testart Gamma', kuerzel: 'TG' }));
  });
  after(() => {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('jede Beutelgröße hat ihre eigene SKU', () => {
    db.setSyringeSku(d, a, 'kb1', 'KORN-TEST-GAMMA1');
    db.setSyringeSku(d, a, 'kb5', 'KORN-TEST-GAMMA5');
    assert.equal(gs(d, a, 1).sku, 'KORN-TEST-GAMMA1');
    assert.equal(gs(d, a, 2).sku, '');
    assert.equal(gs(d, a, 5).sku, 'KORN-TEST-GAMMA5');
  });

  it('eine Größe, die es nicht gibt, wird abgelehnt und sagt, welche es gibt', () => {
    assert.throws(() => db.setSyringeSku(d, a, 'kb3', 'KORN-TEST-GAMMA3'), /1, 2, 5 kg/);
  });

  it('eine SKU, die schon eine Spritze trägt, sagt das in Klartext', () => {
    db.setSyringeSku(d, a, 10, 'SPRI-TEST-GAMMA10');
    assert.throws(() => db.setSyringeSku(d, a, 'kb2', 'SPRI-TEST-GAMMA10'), /den Spritzen dieser Art/);
    assert.throws(() => db.setSyringeSku(d, a, 20, 'KORN-TEST-GAMMA1'), /der Körnerbrut dieser Art/);
  });

  it('die Adresse nimmt die Beutelgröße an', () => {
    const SERVER = quelle('server.js');
    const m = SERVER.match(/const syringeSkuMatch = req\.url\.match\((\/.*\/)\);/);
    const re = new Function('return ' + m[1])();
    assert.equal('/api/syringe-stock/4/kb2'.match(re)[2], 'kb2');
    assert.equal('/api/syringe-stock/4/pd'.match(re)[2], 'pd');
    assert.equal('/api/syringe-stock/4/20'.match(re)[2], '20');
  });
});

describe('Körnerbrut im Verkauf: was Billbee bekommt', () => {
  let d, dir, a, sent, sync;
  before(() => {
    ({ d, dir } = freshDb());
    a = Number(db.createMushroomStrain(d, { name: 'Testart Delta', kuerzel: 'TD' }));
    db.updateChannelConfig(d, 'billbee', {
      enabled: true,
      apiKey: 'test-key',
      clientId: 'erika@example.com',
      clientSecret: 'test-pw'
    });
    db.setSyringeStockSyncEnabled(d, true);
    db.setSyringeSku(d, a, 'kb1', 'KORN-TEST-DELTA1');
    charge(d, 'G-TD-061026-01', a, FERTIG, [
      { id: 'G-TD-061026-01-01', bagKg: 1 },
      { id: 'G-TD-061026-01-02', bagKg: 1 }
    ]);
    scan(d, 'ADD', 'G-TD-061026-01-01');
    scan(d, 'ADD', 'G-TD-061026-01-02');
    sent = [];
    sync = createSyringeStockSync({
      getDatabase: () => d,
      dbApi: db,
      channels: {
        getChannelProvider: () => ({
          async setStock(cfg, args) {
            sent.push(args);
            return { ok: true, currentStock: args.count };
          }
        })
      },
      log: () => {},
      skip: false
    });
  });
  after(() => {
    sync.stop();
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('meldet die fertigen Beutel unter ihrer SKU und sagt in Billbee, was gezählt wurde', async () => {
    const r = await sync.runOnce();
    assert.equal(r.pushed, 1);
    assert.equal(sent[0].sku, 'KORN-TEST-DELTA1');
    assert.equal(sent[0].count, 2);
    assert.equal(sent[0].reason, 'Meistertracker: 2 Beutel Körnerbrut 1 kg Testart Delta im Labor');
    assert.equal(gs(d, a, 1, new Date()).pushedCount, 2);
  });

  it('ein rausgescannter Beutel geht beim nächsten Lauf weg', async () => {
    scan(d, 'REMOVE', 'G-TD-061026-01-02', null);
    sent = [];
    await sync.runOnce();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].count, 1);
  });
});
