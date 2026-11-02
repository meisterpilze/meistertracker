'use strict';
// Calciumcarbonat im Ansatz, Sterilisierzeit am Ansatz, pH an der Charge.
//
// Calciumcarbonat geht wie Gips obendrauf auf die Trockenmischung und vom Lager
// ab. Die Sterilisierzeit steht am Ansatz, der pH an den Chargen daraus, damit
// sich nebeneinander lesen lässt, was die Zeit mit dem pH macht. Alle Zahlen
// hier sind erfunden.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_caph_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

const BLEND = { branPct: 20, cornPct: 0, gypsumPct: 1, moisturePct: 60 };

function seedStrain(d) {
  return db.createMushroomStrain(d, {
    name: 'Testpilz',
    kuerzel: 'TP',
    recBatchType: 'block',
    recSubstrate: 'holzkleie',
    recBagKg: 5,
    recHardwoodPct: 80,
    recWheatbranPct: 20,
    recCornPct: 0,
    recGypsumPct: 1,
    recRhPct: 60,
    recSpawnPct: 5,
    recIncDays: 30
  });
}

const stock = (d, mat) => d.prepare('SELECT stock_' + mat + ' AS v FROM inventory WHERE id=1').get().v;
const sub = (d, id) => db.listSubstrateBatches(d).find((s) => s.subId === id);

describe('Calciumcarbonat in der Mischrechnung', () => {
  it('rechnet es als Anteil der Trockenmischung, wie Gips', () => {
    const m = db.computeMixBatch({ ...BLEND, calciumPct: 2 }, 100, { residualPct: 9 });
    assert.equal(m.calciumKg.toFixed(4), (m.dryKg * 0.02).toFixed(4));
    assert.equal(m.calciumPct, 2);
    assert.ok(m.deltas.some((x) => x.mat === 'calcium' && Math.abs(x.deltaKg + m.calciumKg) < 1e-9));
  });

  it('hält die Masse: trocken, Gips, Calciumcarbonat und Wasser ergeben die Zielmenge', () => {
    const m = db.computeMixBatch({ ...BLEND, calciumPct: 3 }, 100, { residualPct: 9 });
    assert.equal((m.dryKg + m.gypsumKg + m.calciumKg + m.waterL).toFixed(6), '100.000000');
  });

  it('trifft die Soll-Feuchte auch mit Calciumcarbonat', () => {
    const m = db.computeMixBatch({ ...BLEND, calciumPct: 3 }, 100, { residualPct: 9 });
    assert.equal(m.moisturePct.toFixed(1), '60.0');
  });

  it('bucht nichts, wenn keins drin ist', () => {
    const m = db.computeMixBatch(BLEND, 100, { residualPct: 9 });
    assert.equal(m.calciumKg, 0);
    assert.ok(!m.deltas.some((x) => x.mat === 'calcium'));
  });

  it('nimmt es als Abweichung vom Rezept', () => {
    const a = db.mixWithOverride(BLEND, { calciumPct: 1.5 });
    assert.equal(a.adjusted, true);
    assert.equal(a.recipe.calciumPct, 1.5);
  });
});

describe('Ansatz mit Calciumcarbonat und Sterilisierzeit, Chargen mit pH', () => {
  let d, p, ms;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    ms = seedStrain(d);
    for (const [mat, v] of [
      ['hardwood', 500],
      ['wheatbran', 200],
      ['gypsum', 20],
      ['calcium', 10],
      ['grain', 50]
    ]) {
      db.setInventoryAbsolute(d, mat, v, 'count', 'Inventur', null);
    }
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('bucht Calciumcarbonat vom Lager und speichert Anteil, Menge und Zeit am Ansatz', () => {
    const r = db.createSubstrateBatch(
      d,
      { subId: 'SUB-CA', recipeStrainId: ms, targetKg: 100, mix: { calciumPct: 2 }, steriMin: 150 },
      null
    );
    assert.equal(stock(d, 'calcium').toFixed(4), (10 - r.mix.calciumKg).toFixed(4));
    const s = sub(d, 'SUB-CA');
    assert.equal(s.composition.calciumPct, 2);
    assert.equal(s.calciumKg.toFixed(4), r.mix.calciumKg.toFixed(4));
    assert.equal(s.steriMin, 150);
    assert.equal(s.phAvg, null, 'noch keine Charge, also kein pH');
    assert.equal(s.phN, 0);
  });

  it('lässt die Sterilisierzeit leer, wenn keine angegeben ist, statt 0 zu speichern', () => {
    db.createSubstrateBatch(d, { subId: 'SUB-OHNE', recipeStrainId: ms, targetKg: 20 }, null);
    assert.equal(sub(d, 'SUB-OHNE').steriMin, null);
  });

  it('trägt die Sterilisierzeit nach und löscht sie wieder', () => {
    assert.deepEqual(db.setSubstrateSteriMin(d, 'SUB-OHNE', 90), { subId: 'SUB-OHNE', steriMin: 90 });
    assert.equal(sub(d, 'SUB-OHNE').steriMin, 90);
    db.setSubstrateSteriMin(d, 'SUB-OHNE', '');
    assert.equal(sub(d, 'SUB-OHNE').steriMin, null);
    assert.equal(db.setSubstrateSteriMin(d, 'GIBT-ES-NICHT', 10), null);
  });

  it('weist eine unmögliche Sterilisierzeit mit lesbarer Meldung ab', () => {
    assert.throws(
      () => db.setSubstrateSteriMin(d, 'SUB-OHNE', 5000),
      (e) => db.isSafeError(e.message)
    );
    assert.throws(
      () => db.setSubstrateSteriMin(d, 'SUB-OHNE', 'lang'),
      (e) => db.isSafeError(e.message)
    );
  });

  it('speichert den pH an der Charge und mittelt ihn am Ansatz, ohne die ungemessenen', () => {
    db.createBagBatchFromSubstrate(
      d,
      { batchId: 'TP-1', subId: 'SUB-CA', strainId: ms, qty: 2, bagKg: 5, ph: 6.4 },
      null
    );
    db.createBagBatchFromSubstrate(
      d,
      { batchId: 'TP-2', subId: 'SUB-CA', strainId: ms, qty: 2, bagKg: 5, ph: 6.8 },
      null
    );
    db.createBagBatchFromSubstrate(d, { batchId: 'TP-3', subId: 'SUB-CA', strainId: ms, qty: 2, bagKg: 5 }, null);
    const s = sub(d, 'SUB-CA');
    assert.equal(s.phAvg.toFixed(2), '6.60');
    assert.equal(s.phN, 2);
    const detail = db.getSubstrateBatch(d, 'SUB-CA');
    assert.deepEqual(
      detail.drawn.map((b) => b.ph),
      [6.4, 6.8, null]
    );
    assert.equal(detail.phAvg.toFixed(2), '6.60');
  });

  it('legt eine Charge mit vertipptem pH gar nicht erst an', () => {
    assert.throws(
      () =>
        db.createBagBatchFromSubstrate(
          d,
          { batchId: 'TP-X', subId: 'SUB-CA', strainId: ms, qty: 1, bagKg: 5, ph: 15 },
          null
        ),
      (e) => db.isSafeError(e.message)
    );
    assert.equal(d.prepare("SELECT COUNT(*) c FROM batches WHERE batch_id='TP-X'").get().c, 0);
  });

  it('gibt Calciumcarbonat zurück, wenn ein Ansatz ohne Chargen gelöscht wird', () => {
    const vorher = stock(d, 'calcium');
    db.createSubstrateBatch(d, { subId: 'SUB-WEG', recipeStrainId: ms, targetKg: 20, mix: { calciumPct: 2 } }, null);
    assert.ok(stock(d, 'calcium') < vorher);
    assert.equal(db.deleteSubstrateBatch(d, 'SUB-WEG', null), true);
    assert.equal(stock(d, 'calcium').toFixed(6), vorher.toFixed(6));
  });

  it('führt Calciumcarbonat im Lagerbestand', () => {
    const inv = db.getInventory(d, 5);
    assert.equal(typeof inv.stock.calcium, 'number');
    assert.deepEqual(inv.thresholds.calcium, { minKg: 0 });
  });
});

describe('was die Durchsicht gefunden hat', () => {
  let d, p, ms;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    ms = seedStrain(d);
    for (const [mat, v] of [
      ['hardwood', 500],
      ['wheatbran', 200],
      ['gypsum', 20],
      ['calcium', 10]
    ]) {
      db.setInventoryAbsolute(d, mat, v, 'count', 'Inventur', null);
    }
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('speichert die Warnschwelle für Calciumcarbonat und Maismehl', () => {
    const inv = db.getInventory(d, 1);
    db.updateInventoryConfig(d, { ...inv.thresholds, calcium: { minKg: 4 }, corn: { minKg: 7 } }, inv.avgComposition);
    const nachher = db.getInventory(d, 1).thresholds;
    assert.deepEqual(nachher.calcium, { minKg: 4 });
    assert.deepEqual(nachher.corn, { minKg: 7 });
  });

  it('lässt die Schwelle stehen, wenn ein älterer Client sie nicht mitschickt', () => {
    const inv = db.getInventory(d, 1);
    const ohne = { ...inv.thresholds };
    delete ohne.calcium;
    db.updateInventoryConfig(d, ohne, inv.avgComposition);
    assert.deepEqual(db.getInventory(d, 1).thresholds.calcium, { minKg: 4 });
  });

  it('nennt im Namen jede Abweichung vom Rezept, Calciumcarbonat immer', () => {
    const rezept = { branPct: 20, cornPct: 0, gypsumPct: 1, moisturePct: 60 };
    const name = (ov) => db.mixLabel('Beispiel', rezept, db.computeMixBatch({ ...rezept, ...ov }, 50, {}));
    assert.equal(name({}), 'Beispiel');
    assert.equal(name({ calciumPct: 2 }), 'Beispiel · CaCO₃ 2 %');
    assert.equal(name({ branPct: 25 }), 'Beispiel · 75/25');
    assert.equal(name({ gypsumPct: 1.5 }), 'Beispiel · Gips 1,5 %');
    assert.equal(name({ moisturePct: 62 }), 'Beispiel · 62 % Feuchte');
  });

  it('gibt zwei Ansätzen, die sich nur im Calciumcarbonat unterscheiden, verschiedene Namen', () => {
    db.createSubstrateBatch(d, { subId: 'SUB-N0', recipeStrainId: ms, targetKg: 20 }, null);
    db.createSubstrateBatch(d, { subId: 'SUB-N2', recipeStrainId: ms, targetKg: 20, mix: { calciumPct: 2 } }, null);
    const n0 = sub(d, 'SUB-N0').recipeLabel;
    const n2 = sub(d, 'SUB-N2').recipeLabel;
    assert.notEqual(n0, n2);
    assert.match(n2, /CaCO₃ 2 %$/);
  });

  it('trägt den pH an der Charge nach, korrigiert und löscht ihn', () => {
    db.createBagBatchFromSubstrate(d, { batchId: 'TP-NACH', subId: 'SUB-N2', strainId: ms, qty: 1, bagKg: 5 }, null);
    const ph = () => d.prepare("SELECT ph FROM batches WHERE batch_id='TP-NACH'").get().ph;
    db.updateBatchField(d, 'TP-NACH', { ph: 6.2 });
    assert.equal(ph(), 6.2);
    assert.equal(sub(d, 'SUB-N2').phAvg, 6.2, 'der Mittelwert am Ansatz zieht mit');
    db.updateBatchField(d, 'TP-NACH', { ph: '' });
    assert.equal(ph(), null);
    assert.throws(
      () => db.updateBatchField(d, 'TP-NACH', { ph: 20 }),
      (e) => db.isSafeError(e.message)
    );
    assert.equal(ph(), null, 'ein abgewiesener Wert ändert nichts');
    db.updateBatchField(d, 'TP-NACH', { notes: 'nur die Notiz' });
    assert.equal(ph(), null, 'wer den pH nicht nennt, lässt ihn stehen');
  });
});

describe('die Felder im Browser', () => {
  const { hebeFunktion, quelle } = require('./helpers/quelle');
  const APP = quelle();
  const hebe = (n) => hebeFunktion(n, APP);

  it('liest den pH: leer ist erlaubt, vertippt nicht', () => {
    const phLesen = new Function(hebe('parseDecimal') + '\n' + hebe('phLesen') + '\nreturn phLesen;')();
    assert.equal(phLesen(''), null);
    assert.equal(phLesen('6,5'), 6.5);
    assert.equal(phLesen('abc'), undefined);
    assert.equal(phLesen('15'), undefined);
  });

  it('schätzt für Calciumcarbonat keine Blöcke, statt 0 zu behaupten', () => {
    const est = new Function(
      'function getAvgComp() { return { bagKg: 3.8, rhPct: 60, hwPct: 80, wbPct: 20, gypPct: 1, grainBagKg: 1, grainRhPct: 52 }; }\n' +
        'function mtDryKg(kg, rh) { return kg * (1 - rh / 100); }\n' +
        hebe('estBagsFromMat') +
        '\nreturn estBagsFromMat;'
    )();
    assert.equal(est('calcium', 10).bags, null);
    assert.equal(est('corn', 10).bags, null);
    assert.ok(est('gypsum', 10).bags > 0);
  });

  it('nimmt im Ansatz-Dialog eine Nicht-Zahl nicht still als leer', () => {
    const felder = {};
    const document = { getElementById: (id) => felder[id] || null };
    const t = (k, p) => k + (p ? JSON.stringify(p) : '');
    const ctx = new Function(
      'document',
      't',
      'const WKM = { mix: { branPct: 20 }, steriMin: null, unlesbar: {} };\n' +
        hebe('parseDecimal') +
        '\n' +
        APP.match(/^const WKM_FELD_NAME = \{[\s\S]*?\n\};/m)[0] +
        '\n' +
        hebe('wkmFeldLesen') +
        '\n' +
        hebe('wkmUnlesbar') +
        '\n' +
        hebe('wkmMixOk') +
        '\n' +
        hebe('wkmSteriOk') +
        '\n' +
        hebe('wkmMixFehler') +
        '\nreturn { WKM, wkmFeldLesen, wkmMixOk, wkmSteriOk, wkmMixFehler };'
    )(document, t);
    felder['wkm-ca'] = { value: 'zwei' };
    felder['wkm-steri'] = { value: '' };
    assert.equal(ctx.wkmFeldLesen('ca'), null);
    assert.equal(ctx.wkmMixOk(), false, 'eine unlesbare Zahl sperrt die Rechnung');
    assert.match(ctx.wkmMixFehler(), /work\.mNotNumber.*sub\.calcium/);
    felder['wkm-ca'].value = '2';
    assert.equal(ctx.wkmFeldLesen('ca'), 2);
    assert.equal(ctx.wkmMixOk(), true);
    assert.equal(ctx.wkmFeldLesen('steri'), null, 'leer ist erlaubt');
    assert.equal(ctx.wkmSteriOk(), true);
    felder['wkm-steri'].value = 'lang';
    ctx.wkmFeldLesen('steri');
    assert.equal(ctx.wkmSteriOk(), false);
    assert.equal(ctx.wkmMixOk(), true, 'die Zeit sperrt die Mischung nicht');
  });
});
