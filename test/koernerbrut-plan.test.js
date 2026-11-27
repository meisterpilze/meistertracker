'use strict';
// Körnerbrut-Plan (v123): wie viel Körnerbrut eine Art pro Woche braucht,
// für Blöcke und für den Online-Verkauf, wie viel davon anzusetzen ist, und
// was im Regal alt wird.
//
// Alle Zahlen hier sind erfunden: eine Testart mit runden Gewichten und einem
// Prozentsatz, der mit keinem aus dem Labor übereinstimmt.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');

const DAY = 86400000;
const NOW = new Date('2026-03-01T10:00:00.000Z');
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_kbplan_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}
function aufraeumen(p) {
  for (const f of [p, p + '-wal', p + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
}

// Eine Charge der Testart: n Beutel zu je kg, gemacht vor `tage` Tagen,
// `reif` Tage bis fertig.
function charge(d, strainId, id, n, tage, { batchType = 'block', kg = 4, reif = 10 } = {}) {
  const bags = Array.from({ length: n }, (_, i) => ({ id: id + '-' + String(i + 1).padStart(2, '0'), bagKg: kg }));
  db.insertBatch(
    d,
    {
      batchId: id,
      strainId,
      qty: n,
      days: reif,
      substrate: {},
      bagKg: kg,
      batchType,
      notes: '',
      created: ago(tage),
      due: ago(tage - reif),
      bags
    },
    null,
    null
  );
  return bags.map((b) => b.id);
}
function scan(d, bags, batch, tage, action, to, reason) {
  db.appendScanEntries(
    d,
    bags.map((bag) => ({ time: ago(tage), action, batch, bag, from: null, to: to || null, reason: reason || null })),
    null
  );
}
// Eine Bestellung mit einer Zeile.
let bestellNr = 1000;
function bestellung(d, sku, qty, tage, status = 'shipped') {
  bestellNr++;
  const id = d
    .prepare(
      `INSERT INTO orders (channel, channel_order_id, status, order_date, imported, updated)
       VALUES ('test', ?, ?, ?, ?, ?)`
    )
    .run(String(bestellNr), status, ago(tage).slice(0, 19), ago(tage), ago(tage)).lastInsertRowid;
  d.prepare('INSERT INTO order_items (order_id, channel_sku, title, qty) VALUES (?, ?, ?, ?)').run(
    id,
    sku,
    'Testartikel',
    qty
  );
}

describe('Körnerbrut-Plan: Bedarf, Soll, alt', () => {
  let d, p, sid;
  beforeEach(() => {
    ({ db: d, path: p } = tmpDb());
    // Testart: 4 kg je Block, 6 % Körnerbrut vom Substrat.
    sid = Number(db.createMushroomStrain(d, { name: 'Testpilz', kuerzel: 'TP', recBagKg: 4, recSpawnPct: 6 }));
  });
  afterEach(() => {
    d.close();
    aufraeumen(p);
  });
  const plan = () => db.grainPlan(d, NOW).get(sid);

  it('Migration 123: week_blocks steht an der Art, leer ist null, und startet keine Frist', () => {
    assert.equal(plan().weekBlocks, null);
    db.updateMushroomStrain(d, sid, { weekBlocks: 12 });
    const ms = db.listMushroomStrains(d).find((x) => x.id === sid);
    assert.equal(ms.weekBlocks, 12);
    assert.equal(ms.limitsSet, null, 'ein Plan ist kein Grenzwert');
    db.updateMushroomStrain(d, sid, { weekBlocks: '' });
    assert.equal(db.listMushroomStrains(d).find((x) => x.id === sid).weekBlocks, null);
  });

  it('Blöcke pro Woche: was die letzten acht Wochen angelegt wurde, durch acht', () => {
    charge(d, sid, 'B1', 16, 10);
    charge(d, sid, 'B2', 24, 30);
    charge(d, sid, 'B3', 40, 70); // vor mehr als acht Wochen: zählt nicht
    charge(d, sid, 'K1', 3, 20, { batchType: 'grain', kg: 2 }); // Körnerbrut ist kein Block
    const x = plan();
    assert.equal(x.blocksWeekActual, 5);
    assert.equal(x.blocksWeek, 5);
    // 5 Blöcke × 4 kg × 6 % = 1,2 kg Körnerbrut pro Woche
    assert.equal(x.blocksKgWeek, 1.2);
    assert.equal(x.needKgWeek, 1.2);
  });

  it('ein Plan je Art geht vor, die gemessene Zahl steht daneben', () => {
    charge(d, sid, 'B1', 16, 10);
    db.updateMushroomStrain(d, sid, { weekBlocks: 10 });
    const x = plan();
    assert.equal(x.weekBlocks, 10);
    assert.equal(x.blocksWeek, 10);
    assert.equal(x.blocksWeekActual, 2);
    assert.equal(x.blocksKgWeek, 2.4);
  });

  it('online: Bestellungen an den Körnerbrut-SKUs der Art, mal Beutelgröße, ohne Stornos und Altes', () => {
    d.prepare("INSERT INTO syringe_stock_sku (strain_id, type, ml, sku) VALUES (?, 'GS', 2, 'TEST-KB-2000')").run(sid);
    bestellung(d, 'TEST-KB-2000', 4, 5); // 8 kg
    bestellung(d, 'TEST-KB-2000', 3, 6, 'cancelled');
    bestellung(d, 'TEST-KB-2000', 5, 80); // vor mehr als acht Wochen
    bestellung(d, 'ANDERE-SKU', 9, 5);
    const x = plan();
    assert.equal(x.onlineKgWeek, 1);
    assert.equal(x.needKgWeek, 1);
  });

  it('fertig nach: der Median der letzten drei Körnerbrut-Chargen, ohne eine 14 Tage', () => {
    assert.equal(plan().leadDays, 14);
    charge(d, sid, 'K1', 1, 40, { batchType: 'grain', kg: 1, reif: 30 }); // die vierte zählt nicht mehr
    charge(d, sid, 'K2', 1, 30, { batchType: 'grain', kg: 1, reif: 12 });
    charge(d, sid, 'K3', 1, 20, { batchType: 'grain', kg: 1, reif: 20 });
    charge(d, sid, 'K4', 1, 10, { batchType: 'grain', kg: 1, reif: 16 });
    assert.equal(plan().leadDays, 16);
  });

  it('Soll: Bedarf bis fertig plus eine Woche, auf ein halbes Kilo nach oben', () => {
    charge(d, sid, 'B1', 40, 10); // 5 Blöcke pro Woche = 1,2 kg
    d.prepare("INSERT INTO syringe_stock_sku (strain_id, type, ml, sku) VALUES (?, 'GS', 1, 'TEST-KB-1000')").run(sid);
    bestellung(d, 'TEST-KB-1000', 8, 3); // 1 kg pro Woche
    charge(d, sid, 'K1', 1, 50, { batchType: 'grain', kg: 1, reif: 14 });
    const x = plan();
    assert.equal(x.needKgWeek, 2.2);
    // 2,2 × (14 + 7) / 7 = 6,6 → 7
    assert.equal(x.sollKg, 7);
    assert.equal(x.capped, false);
  });

  it('nie mehr, als bis zum Höchstalter verbraucht wird', () => {
    charge(d, sid, 'B1', 40, 10); // 1,2 kg pro Woche
    db.updateMushroomStrain(d, sid, { grainMaxDays: 14 });
    const x = plan();
    // ohne Deckel 1,2 × 21 / 7 = 3,6; gedeckelt 1,2 × 14 / 7 = 2,4 → 2,5
    assert.equal(x.sollKg, 2.5);
    assert.equal(x.capped, true);
    assert.equal(x.grainMaxDays, 14);
  });

  it('alt wird, was bei diesem Bedarf vor seinem Höchstalter nicht drankommt, die älteste zuerst', () => {
    db.updateMushroomStrain(d, sid, { weekBlocks: 0, grainMaxDays: 30 });
    // Kein Bedarf: alles im Regal wird alt, die ältere Charge zuerst.
    scan(d, charge(d, sid, 'K1', 3, 25, { batchType: 'grain', kg: 2 }), 'K1', 25, 'ADD', 'INC');
    scan(d, charge(d, sid, 'K2', 1, 5, { batchType: 'grain', kg: 3 }), 'K2', 5, 'ADD', 'INC');
    let x = plan();
    assert.equal(x.oldKg, 9);
    assert.equal(x.oldAt, ago(-5));
    // 3,5 kg pro Woche (0,5 am Tag): K1 gibt fünf Tage lang 0,5 ab, die übrigen
    // 3,5 kg von K1 werden alt. K2 ist erst dann fertig und in sechs Tagen leer.
    d.prepare("INSERT INTO syringe_stock_sku (strain_id, type, ml, sku) VALUES (?, 'GS', 2, 'TEST-KB-2000')").run(sid);
    bestellung(d, 'TEST-KB-2000', 14, 1);
    x = plan();
    assert.equal(x.needKgWeek, 3.5);
    assert.equal(x.oldKg, 3.5);
    assert.equal(x.oldAt, ago(-5));
  });

  it('was nicht im Regal steht, wird nicht alt, und ohne Höchstalter wird nichts alt', () => {
    const k1 = charge(d, sid, 'K1', 2, 40, { batchType: 'grain', kg: 2 });
    scan(d, k1, 'K1', 40, 'ADD', 'INC');
    assert.equal(plan().oldKg, 0, 'ohne Höchstalter');
    db.updateMushroomStrain(d, sid, { grainMaxDays: 30 });
    assert.equal(plan().oldKg, 4);
    assert.ok(Date.parse(plan().oldAt) < NOW.getTime(), 'schon zu alt');
    scan(d, k1, 'K1', 1, 'REMOVE', null, 'spawn:B9');
    assert.equal(plan().oldKg, 0);
  });

  it('gemessen: Körnerbrut, die in eine Block-Charge gescannt wurde, gegen das Blockgewicht', () => {
    charge(d, sid, 'B1', 10, 10); // 40 kg Blöcke
    const k = charge(d, sid, 'K1', 2, 30, { batchType: 'grain', kg: 1 });
    scan(d, k, 'K1', 10, 'REMOVE', null, 'spawn:B1');
    const x = plan();
    assert.equal(x.measuredPct, 5);
    assert.equal(x.measuredBatches, 1);
  });

  it('Laborbestand: das Soll des kg-Vorrats rechnet der Plan, ohne Verbrauch gilt der Mindestbestand', () => {
    db.updateMushroomStrain(d, sid, { minSpawnKg: 9 });
    const gskg = () =>
      db
        .labStock(d, NOW)
        .find((s) => s.strainId === sid)
        .items.find((i) => i.key === 'GSKG');
    let i = gskg();
    assert.equal(i.auto, false);
    assert.equal(i.soll, 9);
    assert.ok(i.plan, 'die Rechnung steht trotzdem dabei');
    charge(d, sid, 'B1', 40, 10); // 1,2 kg pro Woche → Soll 3,6 → 4
    i = gskg();
    assert.equal(i.auto, true);
    assert.equal(i.soll, 4);
    assert.equal(i.make, 4);
    assert.equal(i.plan.needKgWeek, 1.2);
  });

  it('ein Plan von 0 Blöcken gilt auch: dann kein Soll aus dem alten Mindestbestand', () => {
    db.updateMushroomStrain(d, sid, { minSpawnKg: 9, weekBlocks: 0 });
    const i = db
      .labStock(d, NOW)
      .find((s) => s.strainId === sid)
      .items.find((x) => x.key === 'GSKG');
    assert.equal(i.auto, true);
    assert.equal(i.plan.needKgWeek, 0);
    assert.equal(i.soll, null);
    assert.equal(i.make, 0);
  });

  it('die Prüfung am Server: Blöcke pro Woche ist eine ganze Zahl ab 0, oder leer', () => {
    const SRV = quelle('server.js');
    const pruefe = new Function(hebeFunktion('validateMushroomStrain', SRV) + '; return validateMushroomStrain;')();
    assert.equal(pruefe({ weekBlocks: 12 }), null);
    assert.equal(pruefe({ weekBlocks: null }), null);
    assert.equal(pruefe({ weekBlocks: '' }), null);
    assert.match(pruefe({ weekBlocks: -1 }), /weekBlocks/);
    assert.match(pruefe({ weekBlocks: 1.5 }), /weekBlocks/);
    assert.match(pruefe({ weekBlocks: '7' }), /weekBlocks/);
  });
});

describe('Körnerbrut-Plan: die Seite', () => {
  const SRC = quelle();
  const HTML = quelle('index.html');
  // Attrappen: t setzt die Platzhalter ein, Zahlen wie in der App ohne Gebietsschema.
  const fenster = {};
  new Function('window', quelle('lang/de.js'))(fenster);
  const DE = fenster.LANG.de;
  const tt = (k, v = {}) => String(DE[k] || k).replace(/\{(\w+)\}/g, (_, n) => (n in v ? v[n] : '{' + n + '}'));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const fmtKg = (v, n) => Number(v).toFixed(n).replace('.', ',');
  const lade = (namen) =>
    new Function(
      't',
      'esc',
      'fmtKg',
      'fmtDtShort',
      'const _kbZahl = (n) => fmtKg(n, n % 1 ? 1 : 0);\n' +
        namen.map((n) => hebeFunktion(n, SRC)).join('\n') +
        '\nreturn {' +
        namen.join(',') +
        '};'
    )(tt, esc, fmtKg, (d) => String(d).slice(0, 10));

  it('die Zeilen: nur Arten mit Bedarf oder altem Vorrat, was fehlt zuerst', () => {
    const { _kbpZeilen } = lade(['_kbpZeilen']);
    const art = (strainId, name, make, need, oldKg = 0) => ({
      strainId,
      name,
      items: [{ key: 'GSKG', make, plan: { needKgWeek: need, oldKg } }]
    });
    const z = _kbpZeilen([
      art(1, 'Aaa', 0, 2),
      art(2, 'Bbb', 3, 1),
      art(3, 'Ccc', 0, 0),
      art(4, 'Ddd', 0, 0, 2),
      { strainId: 5, name: 'Eee', items: [{ key: 'MC', make: 1 }] }
    ]);
    assert.deepEqual(
      z.map((x) => x.sp.strainId),
      [2, 1, 4]
    );
  });

  it('die Rechnung im Blatt: jeder Schritt, und Text wird nie zu Markup', () => {
    const { _kbPlanHtml } = lade(['_kbpAltText', '_kbPlanHtml']);
    const html = _kbPlanHtml({
      plan: {
        weekBlocks: null,
        blocksWeekActual: 5,
        blockKg: 4,
        spawnPct: 6,
        blocksKgWeek: 1.2,
        onlineKgWeek: 1,
        needKgWeek: 2.2,
        leadDays: 14,
        sollKg: 7,
        capped: true,
        grainMaxDays: 20,
        measuredPct: 5,
        measuredBatches: 3,
        oldKg: 0
      }
    });
    for (const s of [
      '5 pro Woche',
      '× 4 kg × 6 %',
      '1,2 kg',
      '+ 1 kg',
      '2,2 kg pro Woche',
      '14 Tagen',
      'Soll 7 kg',
      '20 Tagen',
      '5 % in 3'
    ])
      assert.ok(html.includes(s), s + ' fehlt in ' + html);
    assert.doesNotMatch(html, /<script/);
  });

  it('ein berechnetes Soll sagt es dazu und zeigt die Rechnung statt − und +', () => {
    const z = hebeFunktion('_lbSheetZeile', SRC);
    assert.match(z, /offen \? \(i\.auto && i\.plan \? _kbPlanHtml\(i\) : stepper\) : ''/);
    assert.match(SRC, /if \(i\.auto\) return t\('lb\.sollAuto'/);
  });

  it('die Zeilen stehen im Bedarf, werden mit dem Laborbestand gezeichnet und öffnen die Art', () => {
    assert.ok(HTML.includes('id="bd-list"') && !HTML.includes('id="kbp-card"'));
    assert.match(hebeFunktion('renderLabStock', SRC), /if \(bedarfOffen\(\)\) renderBedarf\(\);/);
    assert.match(hebeFunktion('bedarfZeilen', SRC), /_kbpZeilen\(species\)/);
    assert.match(hebeFunktion('bedarfKlick', SRC), /else if \(d\.bdArtKb\) kbpOeffnen\(Number\(d\.bdArtKb\)\);/);
    assert.match(hebeFunktion('kbpOeffnen', SRC), /_lbSheet\.sollOffen = 'GSKG'/);
  });

  it('das Feld Blöcke pro Woche steht im Formular, und leer heißt null', () => {
    const felder = hebeKonstante('MS_LIMIT_FIELDS', SRC) + '\n' + hebeKonstante('MS_PLAN_FIELDS', SRC);
    for (const m of felder.matchAll(/\['(ms-[a-z-]+)'/g))
      assert.ok(HTML.includes('id="' + m[1] + '"'), m[1] + ' fehlt im Formular');
    const werte = { 'ms-week-blocks': ' 14 ' };
    const lies = new Function('document', felder + hebeFunktion('_msReadLimits', SRC) + '; return _msReadLimits;')({
      getElementById: (id) => ({ value: werte[id] || '' })
    });
    assert.deepEqual(lies(MS_PLAN_FIELDS_aus(felder)), { weekBlocks: 14 });
    werte['ms-week-blocks'] = '';
    assert.deepEqual(lies(MS_PLAN_FIELDS_aus(felder)), { weekBlocks: null });
  });
});

// Die Konstante als Wert, aus ihrem Quelltext.
function MS_PLAN_FIELDS_aus(felder) {
  return new Function(felder + '; return MS_PLAN_FIELDS;')();
}
