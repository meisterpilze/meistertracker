'use strict';
// Laborfach: eine Art in einem Gefäß (Petri, FK-Glas, Spritze je Größe,
// Körnerbrut je Beutelgröße) mit einem Etikett zum Scannen und einem Alarm.
// Das Fach zählt nichts Eigenes: sein Bestand sind die Kulturen und Beutel,
// dieselbe Zahl wie Labor → Bestand und Billbee. Sein Alarm ist das Soll, an
// der Stelle, wo es schon stand. Diese Tests halten beides fest.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { quelle } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-'));
  return { d: db.openDb(path.join(dir, 'test.db')), dir };
}
let seq = 0;
function kultur(d, strainId, type, status = 'active', ml) {
  seq++;
  const id = type + '-TST-171126-' + String(seq).padStart(2, '0');
  db.insertCultures(d, [
    {
      id,
      type,
      strainId,
      status,
      notes: '',
      created: '2026-11-17T00:00:00Z',
      ...(ml ? { ml } : {})
    }
  ]);
  return id;
}
let uhr = 0;
function beutel(d, batchId, strainId, due, kgs, to = 'SPAWN') {
  const bags = kgs.map((kg, i) => ({ id: batchId + '-' + String(i + 1).padStart(2, '0'), bagKg: kg }));
  db.insertBatch(d, {
    batchId,
    strainId,
    qty: bags.length,
    days: 14,
    substrate: {},
    bagKg: 3,
    batchType: 'grain',
    notes: '',
    created: '2026-11-01T08:00:00.000Z',
    due,
    bags
  });
  for (const b of bags) {
    uhr++;
    db.appendScanEntries(d, [
      {
        time: '2026-11-01T09:' + String(uhr).padStart(2, '0') + ':00.000Z',
        action: 'ADD',
        batch: batchId,
        bag: b.id,
        from: null,
        to
      }
    ]);
  }
  return bags.map((b) => b.id);
}
const faecher = (d, strainId) => db.labStock(d).find((s) => s.strainId === strainId).fach;
const fach = (d, strainId, slot) => faecher(d, strainId).find((f) => f.slot === slot);

describe('Laborfach: Bestand und Etikett', () => {
  let d, dir, a;
  before(() => {
    ({ d, dir } = freshDb());
    a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
  });
  after(() => {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('jede Art hat FK und Petri, und im Programm eine 10er-Spritze zum Anfangen', () => {
    assert.deepEqual(
      faecher(d, a).map((f) => f.slot),
      ['LC', 'PD', 'SY10']
    );
    assert.equal(fach(d, a, 'PD').have, 0);
    assert.equal(fach(d, a, 'PD').id, null, 'ein Fach ohne Etikett hat noch keine Nummer');
  });

  it('zählt Kulturen, aktiv und gelagert, je Gefäß und Spritzengröße', () => {
    kultur(d, a, 'PD');
    kultur(d, a, 'PD', 'stored');
    kultur(d, a, 'PD', 'used');
    kultur(d, a, 'PD', 'sold');
    kultur(d, a, 'LC');
    kultur(d, a, 'SY', 'active', 20);
    kultur(d, a, 'SY', 'active', 20);
    assert.equal(fach(d, a, 'PD').have, 2);
    assert.equal(fach(d, a, 'LC').have, 1);
    assert.equal(fach(d, a, 'SY20').have, 2);
    // Die letzte 20er verkauft: das Fach bleibt, mit 0.
    for (const c of d.prepare("SELECT id FROM cultures WHERE type = 'SY'").all())
      db.updateCulture(d, c.id, { status: 'sold' });
    assert.equal(fach(d, a, 'SY20').have, 0);
    for (const c of d.prepare("SELECT id FROM cultures WHERE type = 'SY'").all())
      db.updateCulture(d, c.id, { status: 'active' });
    assert.equal(fach(d, a, 'SY10'), undefined, 'mit einer 20er braucht es die 10er nicht mehr');
  });

  it('zählt Körnerbrut je Beutelgröße: fertig, was fällig ist; was wächst, daneben', () => {
    beutel(d, 'TA-KB-01', a, '2026-11-01T00:00:00.000Z', [3, 3, 1]);
    beutel(d, 'TA-KB-02', a, '2099-01-01T00:00:00.000Z', [3]);
    const kb3 = fach(d, a, 'KB3');
    assert.equal(kb3.have, 2);
    assert.equal(kb3.growing, 1);
    assert.equal(kb3.readyAt, '2099-01-01T00:00:00.000Z');
    assert.equal(fach(d, a, 'KB1').have, 1);
    assert.deepEqual(
      faecher(d, a).map((f) => f.slot),
      ['LC', 'PD', 'SY20', 'KB1', 'KB3']
    );
  });

  it('ein verkaufter oder verbrauchter Beutel ist weg, und verkauft ist keine Kontamination', () => {
    const [bag] = beutel(d, 'TA-KB-03', a, '2026-11-01T00:00:00.000Z', [5]);
    assert.equal(fach(d, a, 'KB5').have, 1);
    db.appendScanEntries(d, [
      {
        time: '2026-11-17T10:00:00.000Z',
        action: 'REMOVE',
        batch: 'TA-KB-03',
        bag,
        from: 'SPAWN',
        to: null,
        reason: 'sold'
      }
    ]);
    assert.equal(fach(d, a, 'KB5').have, 0, 'leer steht mit 0 da, statt aus der Zeile zu fallen');
    assert.equal(db.getContaminationReport(d, 'species').totalContam, 0);
  });

  it('das Etikett: einmal angelegt, mit einer Nummer aus der Barcode-Liste', () => {
    const f = db.ensureLabFach(d, a, 'pd');
    assert.equal(f.slot, 'PD');
    assert.ok(f.barcode >= 1000000);
    const bc = db.getAllBarcodes(d).find((b) => b.barcode === f.barcode);
    assert.deepEqual([bc.entity_type, bc.entity_id], ['labfach', String(f.id)]);
    assert.equal(db.ensureLabFach(d, a, 'PD').id, f.id, 'ein zweites Mal ist dasselbe Fach');
    assert.equal(fach(d, a, 'PD').barcode, f.barcode, 'Labor → Bestand trägt die Nummer mit');
    assert.equal(db.getLabFach(d, f.id).have, 2);
  });

  it('kennt nur Fächer, die es gibt', () => {
    assert.throws(() => db.ensureLabFach(d, a, 'SY15'), /gibt es nicht/);
    assert.throws(() => db.ensureLabFach(d, a, 'MC'), /gibt es nicht/);
    assert.throws(() => db.ensureLabFach(d, 99999, 'PD'), /Art gibt es nicht/);
    assert.equal(db.ensureLabFach(d, a, 'kb1.50').slot, 'KB1.5');
  });
});

describe('Laborfach: der Alarm ist das Soll', () => {
  let d, dir, a;
  before(() => {
    ({ d, dir } = freshDb());
    a = Number(db.createMushroomStrain(d, { name: 'Testart Beta', kuerzel: 'TB' }));
  });
  after(() => {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('Petri und FK schreiben die Untergrenze der Art, dieselbe wie Nachproduzieren', () => {
    const pd = db.ensureLabFach(d, a, 'PD');
    assert.equal(db.setLabFachAlarm(d, pd.id, 4).soll, 4);
    assert.equal(db.listMushroomStrains(d).find((m) => m.id === a).minPd, 4);
    const lc = db.ensureLabFach(d, a, 'LC');
    db.setLabFachAlarm(d, lc.id, 2);
    assert.equal(db.listMushroomStrains(d).find((m) => m.id === a).minLc, 2);
    const items = db.labStock(d).find((s) => s.strainId === a).items;
    assert.equal(items.find((i) => i.key === 'PD').soll, 4, 'Nachproduzieren liest dasselbe Soll');
  });

  it('eine Spritzengröße mit Shop-SKU schreibt das Soll der SKU, ohne SKU das Fach', () => {
    db.setSyringeSku(d, a, 10, 'SPRITZE-TEST-10');
    const sy10 = db.ensureLabFach(d, a, 'SY10');
    db.setLabFachAlarm(d, sy10.id, 6);
    assert.equal(d.prepare("SELECT soll FROM syringe_stock_sku WHERE type = 'SY' AND ml = 10").get().soll, 6);
    assert.equal(d.prepare('SELECT min_stock FROM lab_fach WHERE id = ?').get(sy10.id).min_stock, null);
    const sy50 = db.ensureLabFach(d, a, 'SY50');
    assert.equal(db.setLabFachAlarm(d, sy50.id, 3).soll, 3);
    assert.equal(d.prepare('SELECT min_stock FROM lab_fach WHERE id = ?').get(sy50.id).min_stock, 3);
    assert.equal(db.setLabFachAlarm(d, sy50.id, 0).soll, null, '0 schaltet den Alarm aus');
  });

  it('nimmt nur ganze Zahlen von 0 bis 500', () => {
    const pd = db.ensureLabFach(d, a, 'PD');
    assert.throws(() => db.setLabFachAlarm(d, pd.id, -1), /ganze Zahl/);
    assert.throws(() => db.setLabFachAlarm(d, pd.id, 2.5), /ganze Zahl/);
    assert.throws(() => db.setLabFachAlarm(d, pd.id, 501), /ganze Zahl/);
    assert.throws(() => db.setLabFachAlarm(d, 99999, 1), /Fach gibt es nicht/);
  });

  it('läutet einmal, wenn ein Fach unter sein Soll fällt, und ist wieder scharf, wenn es reicht', () => {
    const pd = db.ensureLabFach(d, a, 'PD');
    db.setLabFachAlarm(d, pd.id, 2);
    const erst = db.labFachLowAlerts(d);
    assert.deepEqual(
      erst.filter((x) => x.id === pd.id).map((x) => [x.name, x.text, x.have, x.soll]),
      [['Testart Beta', 'Petri', 0, 2]]
    );
    assert.equal(
      db.labFachLowAlerts(d).filter((x) => x.id === pd.id).length,
      0,
      'kein zweites Mal, solange es knapp bleibt'
    );
    db.createUser(d, 'erika', 'a reasonable password', 'admin');
    const u = db.listUsers(d).find((x) => x.username === 'erika');
    db.createNotificationOnce(d, {
      userId: u.id,
      type: 'lab_low',
      title: 'Nachproduzieren',
      body: '',
      linkType: 'labfach',
      linkId: String(pd.id)
    });
    kultur(d, a, 'PD');
    kultur(d, a, 'PD');
    assert.equal(db.labFachLowAlerts(d).length, 0);
    assert.equal(d.prepare('SELECT low_alerted FROM lab_fach WHERE id = ?').get(pd.id).low_alerted, 0);
    const offen = d.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'lab_low' AND dismissed = 0").get().n;
    assert.equal(offen, 0, 'nachproduziert: die Meldung ist erledigt');
  });

  it('eine Art außer Programm läutet nicht', () => {
    const g = Number(db.createMushroomStrain(d, { name: 'Testart Gamma', kuerzel: 'TG' }));
    const lc = db.ensureLabFach(d, g, 'LC');
    db.setLabFachAlarm(d, lc.id, 3);
    db.updateMushroomStrain(d, g, { imProgramm: false });
    assert.equal(db.labFachLowAlerts(d).filter((x) => x.id === lc.id).length, 0);
  });
});

describe('Laborfach: ein Etikett für alle Spritzen einer Art', () => {
  let d, dir, a;
  before(() => {
    ({ d, dir } = freshDb());
    a = Number(db.createMushroomStrain(d, { name: 'Testart Delta', kuerzel: 'TD' }));
  });
  after(() => {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('das Sammelfach "SY" hat ein Etikett und zählt alle Größen zusammen', () => {
    kultur(d, a, 'SY', 'active', 10);
    kultur(d, a, 'SY', 'active', 20);
    kultur(d, a, 'SY', 'active', 50);
    kultur(d, a, 'SY', 'sold', 50);
    const sy = db.ensureLabFach(d, a, 'sy');
    assert.equal(sy.slot, 'SY');
    assert.equal(sy.group, true);
    assert.equal(sy.have, 3);
    assert.ok(sy.barcode >= 1000000);
    const sp = db.labStock(d).find((x) => x.strainId === a);
    assert.equal(sp.sy.barcode, sy.barcode, 'Labor → Bestand trägt das Etikett mit');
    assert.ok(!sp.fach.some((f) => f.slot === 'SY'), 'in der Zeile stehen weiter die Größen');
    assert.deepEqual(
      sp.fach.filter((f) => f.kind === 'SY').map((f) => [f.slot, f.have]),
      [
        ['SY10', 1],
        ['SY20', 1],
        ['SY50', 1]
      ]
    );
  });

  it('hat keinen eigenen Alarm und läutet nie', () => {
    const sy = db.ensureLabFach(d, a, 'SY');
    assert.throws(() => db.setLabFachAlarm(d, sy.id, 4), /jede Spritzengröße/);
    assert.equal(db.labFachLowAlerts(d).filter((x) => x.slot === 'SY').length, 0);
  });

  it('ein neues Fach sagt, dass es neu ist; ein bekanntes nicht', () => {
    const neu = {};
    db.ensureLabFach(d, a, 'PD', neu);
    assert.equal(neu.created, true);
    const alt = {};
    db.ensureLabFach(d, a, 'PD', alt);
    assert.equal(alt.created, undefined);
  });

  it('der Alarm am Fach gilt weiter, wenn die Größe später eine SKU bekommt', () => {
    const sy20 = db.ensureLabFach(d, a, 'SY20');
    db.setLabFachAlarm(d, sy20.id, 4);
    db.setSyringeSku(d, a, 20, 'SPRITZE-TEST-20');
    assert.equal(db.getLabFach(d, sy20.id).soll, 4);
    db.setLabFachAlarm(d, sy20.id, 0);
    assert.equal(db.getLabFach(d, sy20.id).soll, null, 'aus heißt aus, auch mit SKU');
  });

  it('Beutel, die beim Zählen fehlten, sind keine Kontamination', () => {
    const [bag] = beutel(d, 'TD-KB-01', a, '2026-11-01T00:00:00.000Z', [3]);
    db.appendScanEntries(d, [
      {
        time: '2026-11-17T11:00:00.000Z',
        action: 'REMOVE',
        batch: 'TD-KB-01',
        bag,
        from: 'SPAWN',
        to: null,
        reason: 'count'
      }
    ]);
    assert.equal(db.getContaminationReport(d, 'species').totalContam, 0);
  });
});

describe('Laborfach in der App', () => {
  it('das Etikett am Fach öffnet sein Blatt, wie beim Regal', () => {
    assert.match(APP, /entry\.type === 'labfach'\) \{[\s\S]{0,200}lfScanned\(entry\.id\)/);
    assert.match(APP, /linkType === 'labfach' && linkId\) \{[\s\S]{0,200}lfScanned\(linkId\)/);
  });
  it('das Blatt hat Add, Remove, Verkauft und Das ist der Bestand, und den Alarm oben', () => {
    const m = HTML.slice(HTML.indexOf('id="m-labfach"'), HTML.indexOf('<!-- Calendar print range modal -->'));
    for (const a of ['in', 'out', 'sold', 'count', 'print', 'close'])
      assert.match(m, new RegExp('data-lf-act="' + a + '"'));
    assert.ok(m.indexOf('data-lf-min="-1"') < m.indexOf('data-lf-act="in"'), 'der Alarm steht über den Knöpfen');
  });
  it('Remove und Verkauft nehmen die ältesten; Körnerbrut als "spawn" oder "sold"', () => {
    assert.match(APP, /spawnBuchen\(bags, wie === 'used' \? 'spawn' : wie\)/);
    assert.match(APP, /setze\(pick\.map\(\(c\) => \[c, wie === 'sold' \? 'sold' : 'used'\]\)\)/);
    // Zählen nach unten bucht "count", nicht Verbrauch.
    assert.match(APP, /return lfOut\(f, -diff, 'count'\);/);
  });
  it('was der Server abweist, steht auf dem Telefon wieder wie vorher', () => {
    assert.match(APP, /if \(!r \|\| r\.error\) c\.status = alt;/);
  });
  it('ein Fach, das das Telefon schon kennt, fragt den Server nicht noch einmal', () => {
    assert.match(
      APP,
      /lfRender\(\);\n  document\.getElementById\('m-labfach'\)\.classList\.add\('open'\);\n  if \(f\.id\) return;/
    );
  });
  it('am Regal steht der Alarm unter der Zahl, mit − und +', () => {
    const m = HTML.slice(HTML.indexOf('id="m-shelf"'), HTML.indexOf('id="m-labfach"'));
    assert.match(m, /data-shelf-min="-1"/);
    assert.doesNotMatch(m, /id="m-shelf-min"/, 'das alte Feld unter "Verlauf und Artikel" ist weg');
    assert.ok(m.indexOf('data-shelf-min') < m.indexOf('data-shelf-act="in"'));
  });
});
