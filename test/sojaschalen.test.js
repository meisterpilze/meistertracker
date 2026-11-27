'use strict';
// Sojaschalen im Substrat.
//
// Sojaschalen sind wie Weizenkleie ein Teil der Trockenmischung: die Pellets
// sind, was Kleie, Mais und Sojaschalen übrig lassen. Sie kommen vom Lager wie
// jeder Rohstoff, stehen in gespeicherten Mischungen und in jeder Charge, die aus
// einem Ansatz gezogen wird. Eine neue Mischung legt ein Admin im
// Ansatz-Ablauf an. Alle Zahlen hier sind erfunden.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');

const APP = quelle();
const SERVER = quelle('server.js');
const hebe = (name) => hebeFunktion(name, APP);

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_soja_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

const OPTS = { residualPct: 9 };
const MIT_SOJA = { branPct: 10, cornPct: 0, soyhullPct: 35, gypsumPct: 1, moisturePct: 60 };
const stock = (d, mat) => d.prepare('SELECT stock_' + mat + ' AS v FROM inventory WHERE id=1').get().v;
const sub = (d, id) => db.listSubstrateBatches(d).find((s) => s.subId === id);

describe('Sojaschalen in der Mischrechnung', () => {
  it('nimmt sie als Teil der Trockenmischung: die Pellets sind der Rest', () => {
    const m = db.computeMixBatch(MIT_SOJA, 100, OPTS);
    assert.equal(m.hardwoodPct.toFixed(6), '55.000000');
    assert.equal(m.soyhullPct, 35);
    assert.equal(m.soyhullKg.toFixed(6), (m.dryKg * 0.35).toFixed(6));
    assert.equal(m.pelletsKg.toFixed(6), (m.dryKg * 0.55).toFixed(6));
    assert.equal((m.pelletsKg + m.branKg + m.cornKg + m.soyhullKg).toFixed(6), m.dryKg.toFixed(6));
    assert.ok(m.deltas.some((x) => x.mat === 'soyhull' && Math.abs(x.deltaKg + m.soyhullKg) < 1e-9));
  });

  it('rechnet sie mit der Restfeuchte der Pellets, wie Mais', () => {
    const soja = db.computeMixBatch(MIT_SOJA, 100, OPTS);
    const kleie = db.computeMixBatch({ ...MIT_SOJA, branPct: 45, soyhullPct: 0 }, 100, OPTS);
    assert.equal(soja.waterL.toFixed(6), kleie.waterL.toFixed(6));
    assert.equal(soja.moisturePct.toFixed(1), '60.0');
  });

  it('bucht nichts, wenn keine drin sind', () => {
    const m = db.computeMixBatch({ ...MIT_SOJA, soyhullPct: 0 }, 100, OPTS);
    assert.equal(m.soyhullKg, 0);
    assert.ok(!m.deltas.some((x) => x.mat === 'soyhull'));
  });

  it('sagt lesbar, wenn für Pellets nichts übrig bleibt', () => {
    assert.throws(
      () => db.computeMixBatch({ ...MIT_SOJA, branPct: 30, soyhullPct: 70 }, 100, OPTS),
      (e) => /Sojaschalen ergeben 100%/.test(e.message) && db.isSafeError(e.message)
    );
  });

  it('nimmt sie als Abweichung vom Rezept', () => {
    const a = db.mixWithOverride(MIT_SOJA, { soyhullPct: 20 });
    assert.equal(a.adjusted, true);
    assert.equal(a.recipe.soyhullPct, 20);
    assert.equal(
      db.mixWithOverride(MIT_SOJA, { soyhullPct: 35 }).adjusted,
      false,
      'dieselbe Zahl ist keine Abweichung'
    );
  });
});

describe('Mischung, Ansatz und Charge mit Sojaschalen', () => {
  let d, p, ms, mischung;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    ms = db.createMushroomStrain(d, {
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
    for (const [mat, v] of [
      ['hardwood', 500],
      ['wheatbran', 200],
      ['soyhull', 300],
      ['gypsum', 20]
    ]) {
      db.setInventoryAbsolute(d, mat, v, 'count', 'Inventur', null);
    }
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('legt eine Mischung mit Sojaschalen an, die Pellets als Rest', () => {
    mischung = db.createMixRecipe(d, {
      name: '  Testmischung   Soja ',
      wheatbranPct: 10,
      soyhullPct: 35,
      gypsumPct: 1,
      rhPct: 60
    });
    assert.equal(mischung.name, 'Testmischung Soja', 'Leerzeichen am Rand und doppelte fallen weg');
    assert.equal(mischung.soyhullPct, 35);
    assert.equal(mischung.hardwoodPct, 55);
    assert.ok(db.getAllRecipes(d).some((r) => r.id === mischung.id && r.soyhullPct === 35));
  });

  it('weist eine Mischung, die nicht geht, mit lesbarer Meldung ab und legt nichts an', () => {
    const faelle = [
      { name: '', wheatbranPct: 10, rhPct: 60 },
      { name: 'testmischung soja', wheatbranPct: 10, rhPct: 60 },
      { name: 'Testmischung voll', wheatbranPct: 50, soyhullPct: 50, rhPct: 60 },
      { name: 'Testmischung ohne Feuchte', wheatbranPct: 10 },
      { name: 'Testmischung Tippfehler', soyhullPct: 350, rhPct: 60 },
      { name: 'Testmischung Buchstaben', soyhullPct: 'viel', rhPct: 60 },
      { name: 'x'.repeat(61), rhPct: 60 }
    ];
    for (const f of faelle) {
      assert.throws(
        () => db.createMixRecipe(d, f),
        (e) => db.isSafeError(e.message),
        JSON.stringify(f)
      );
    }
    assert.equal(db.getAllRecipes(d).length, 1);
  });

  it('bucht Sojaschalen vom Lager und hält Anteil und Menge am Ansatz fest', () => {
    const vorher = stock(d, 'soyhull');
    const r = db.createSubstrateBatch(d, { subId: 'SUB-SOJA', recipeId: mischung.id, targetKg: 100 }, null);
    assert.equal(stock(d, 'soyhull').toFixed(6), (vorher - r.mix.soyhullKg).toFixed(6));
    const s = sub(d, 'SUB-SOJA');
    assert.equal(s.composition.soyhullPct, 35);
    assert.equal(s.composition.hardwoodPct, 55);
    assert.equal(s.soyhullKg.toFixed(6), r.mix.soyhullKg.toFixed(6));
    assert.equal(s.recipeLabel, 'Testmischung Soja');
  });

  it('nennt eine Abweichung bei den Sojaschalen im Namen des Ansatzes', () => {
    db.createSubstrateBatch(
      d,
      { subId: 'SUB-SOJA-20', recipeId: mischung.id, targetKg: 20, mix: { soyhullPct: 20 } },
      null
    );
    const s = sub(d, 'SUB-SOJA-20');
    assert.equal(s.recipeLabel, 'Testmischung Soja · Soja 20 %');
    assert.equal(s.composition.hardwoodPct, 70);
  });

  it('zieht eine Charge aus dem Ansatz, deren Anteile mit den Sojaschalen 100 % ergeben', () => {
    db.createBagBatchFromSubstrate(d, { batchId: 'TP-S1', subId: 'SUB-SOJA', strainId: ms, qty: 2, bagKg: 5 }, null);
    const b = db.readAll(d).batches.find((x) => x.batchId === 'TP-S1');
    assert.equal(b.substrate.soyhull, 35);
    assert.equal(b.substrate.hardwood + b.substrate.wheatbran + b.substrate.corn + b.substrate.soyhull, 100);
    const herkunft = db.blockLineage ? db.blockLineage(d, 'TP-S1') : null;
    if (herkunft) assert.equal(herkunft.substrate.soyhullPct, 35);
  });

  it('gibt Sojaschalen zurück, wenn ein Ansatz ohne Chargen gelöscht wird', () => {
    const vorher = stock(d, 'soyhull');
    db.createSubstrateBatch(d, { subId: 'SUB-WEG', recipeId: mischung.id, targetKg: 20 }, null);
    assert.ok(stock(d, 'soyhull') < vorher);
    assert.equal(db.deleteSubstrateBatch(d, 'SUB-WEG', null), true);
    assert.equal(stock(d, 'soyhull').toFixed(6), vorher.toFixed(6));
  });

  it('führt Sojaschalen im Lager, mit einer Mindestmenge, die ein älterer Client nicht löscht', () => {
    const inv = db.getInventory(d, 5);
    assert.equal(typeof inv.stock.soyhull, 'number');
    assert.deepEqual(inv.thresholds.soyhull, { minKg: 0 });
    db.updateInventoryConfig(d, { soyhull: { minKg: 50 } }, {});
    assert.deepEqual(db.getInventory(d, 5).thresholds.soyhull, { minKg: 50 });
    db.updateInventoryConfig(d, { hardwood: { minKg: 40 } }, {});
    assert.deepEqual(db.getInventory(d, 5).thresholds.soyhull, { minKg: 50 });
    assert.equal(typeof db.readAll(d).inventory.stock.soyhull, 'number');
  });
});

describe('Sojaschalen im Ansatz-Ablauf', () => {
  const REZEPTE = [
    { id: 1, name: 'Testmischung A', hardwoodPct: 80, wheatbranPct: 20, soyhullPct: 0, gypsumPct: 1, rhPct: 60 },
    { id: 2, name: 'Testmischung Soja', hardwoodPct: 55, wheatbranPct: 10, soyhullPct: 35, gypsumPct: 1, rhPct: 60 }
  ];

  // Der Ablauf gegen Attrappen: Felder als { value }, die Knöpfe über ihr data-wkm.
  function ablauf(user) {
    const felder = {};
    for (const id of ['hw', 'wb', 'soy', 'gyp', 'ca', 'hyd', 'rh', 'steri']) felder['wkm-' + id] = { value: '' };
    // Das Speichern als neue Mischung ist ein Kasten unter den Feldern, kein
    // Knopf mehr im Kopf: er steht da, sobald eine Zahl abweicht.
    felder['wkm-sichern'] = { hidden: true };
    const knoepfe = { mixreset: { hidden: true } };
    const document = {
      getElementById: (id) => felder[id] || null,
      querySelector: (sel) => {
        const m = sel.match(/data-wkm="(\w+)"/);
        return m ? knoepfe[m[1]] || null : null;
      }
    };
    const ctx = new Function(
      'document',
      '_sbRecipes',
      'currentUser',
      'setTimeout',
      'clearTimeout',
      hebeKonstante('WKM', APP) +
        '\n' +
        hebeKonstante('WKM_MIX_KEYS', APP) +
        '\nlet _wkmMixTimer = null;\nfunction wkmLoadPreview() {}\n' +
        [
          'parseDecimal',
          '_sbSet',
          'sbRecipeOf',
          'wkmMixFromRecipe',
          'wkmWeichtAb',
          'wkmMixAdjusted',
          'wkmDarfSichern',
          'wkmFeldLesen',
          'wkmBlendEdited'
        ]
          .map(hebe)
          .join('\n') +
        '\nreturn { WKM, wkmMixFromRecipe, wkmBlendEdited, wkmMixAdjusted, wkmDarfSichern };'
    )(
      document,
      REZEPTE,
      user,
      () => 0,
      () => {}
    );
    return { ctx, felder, knoepfe };
  }

  it('übernimmt die Sojaschalen einer gespeicherten Mischung', () => {
    const { ctx } = ablauf({ role: 'admin' });
    ctx.WKM.recipeId = 2;
    ctx.wkmMixFromRecipe();
    assert.deepEqual(ctx.WKM.mix, {
      branPct: 10,
      soyhullPct: 35,
      gypsumPct: 1,
      calciumPct: 0,
      hydroxidePct: 0,
      moisturePct: 60
    });
  });

  it('lässt die Sojaschalen stehen, wenn Pellets oder Kleie getippt werden', () => {
    const { ctx, felder } = ablauf({ role: 'admin' });
    ctx.WKM.recipeId = 2;
    ctx.wkmMixFromRecipe();
    felder['wkm-wb'].value = '15';
    ctx.wkmBlendEdited('wb');
    assert.equal(ctx.WKM.mix.branPct, 15);
    assert.equal(ctx.WKM.mix.soyhullPct, 35);
    assert.equal(felder['wkm-hw'].value, '50');
    felder['wkm-hw'].value = '60';
    ctx.wkmBlendEdited('hw');
    assert.equal(ctx.WKM.mix.branPct, 5);
    assert.equal(felder['wkm-wb'].value, '5');
  });

  it('schreibt den Pellet-Rest ins Feld, wenn Sojaschalen getippt werden', () => {
    const { ctx, felder } = ablauf({ role: 'admin' });
    ctx.WKM.recipeId = 1;
    ctx.wkmMixFromRecipe();
    felder['wkm-soy'].value = '30';
    ctx.wkmBlendEdited('soy');
    assert.equal(ctx.WKM.mix.soyhullPct, 30);
    assert.equal(felder['wkm-hw'].value, '50');
    felder['wkm-soy'].value = '';
    ctx.wkmBlendEdited('soy');
    assert.equal('soyhullPct' in ctx.WKM.mix, false, 'leer heißt: wie im Rezept');
    assert.equal(felder['wkm-hw'].value, '80');
  });

  // Bis Migration 126 zählte Calciumcarbonat nicht mit: gespeicherte Mischungen
  // kannten es nicht. Jetzt wird die ganze Mischung gespeichert, also bietet
  // jede abweichende Zahl das Speichern an.
  it('bietet Speichern an, sobald eine Zahl von der Mischung abweicht, auch Calciumcarbonat', () => {
    const { ctx, felder } = ablauf({ role: 'admin' });
    ctx.WKM.recipeId = 1;
    ctx.wkmMixFromRecipe();
    assert.equal(felder['wkm-sichern'].hidden, true);
    felder['wkm-ca'].value = '2';
    ctx.wkmBlendEdited('ca');
    assert.equal(ctx.wkmMixAdjusted(), true);
    assert.equal(felder['wkm-sichern'].hidden, false);
    felder['wkm-ca'].value = '0';
    ctx.wkmBlendEdited('ca');
    assert.equal(felder['wkm-sichern'].hidden, true, 'zurückgetippt: nichts mehr zu speichern');
    felder['wkm-soy'].value = '25';
    ctx.wkmBlendEdited('soy');
    assert.equal(felder['wkm-sichern'].hidden, false);
  });

  it('lässt nur einen Admin speichern, wie den Server', () => {
    assert.equal(ablauf({ role: 'admin' }).ctx.wkmDarfSichern(), true);
    assert.equal(ablauf({ role: 'user' }).ctx.wkmDarfSichern(), false);
    assert.equal(ablauf(null).ctx.wkmDarfSichern(), false);
    const route = SERVER.match(/req\.method === 'POST' && req\.url === '\/api\/recipes'\) \{[\s\S]*?\n {2}\}/);
    assert.ok(route, 'POST /api/recipes nicht gefunden');
    assert.match(route[0], /requireAdmin\(req, res\)/);
    assert.match(route[0], /db\.createMixRecipe\(/);
  });

  it('schreibt die Mischung in Worten, Sojaschalen nur, wenn welche drin sind', () => {
    const namen = {
      'sub.pellets': 'Pellets',
      'sub.bran': 'Weizenkleie',
      'sub.corn': 'Maismehl',
      'sub.soyhull': 'Sojaschalen'
    };
    const text = new Function('t', hebe('subBlendText') + '\nreturn subBlendText;')((k) => namen[k] || k);
    assert.equal(text({ hardwoodPct: 80, wheatbranPct: 20 }), '80 % Pellets · 20 % Weizenkleie');
    assert.equal(
      text({ hardwoodPct: 55, wheatbranPct: 10, soyhullPct: 35 }),
      '55 % Pellets · 10 % Weizenkleie · 35 % Sojaschalen'
    );
    assert.equal(text({ hardwoodPct: 65, wheatbranPct: 0, soyhullPct: 35 }), '65 % Pellets · 35 % Sojaschalen');
    assert.equal(text({ hardwoodPct: 100, wheatbranPct: 0 }), '100 % Pellets · 0 % Weizenkleie');
  });
});
