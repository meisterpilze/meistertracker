'use strict';
// Substrat ansetzen: Calciumhydroxid, pH am Ansatz, und Mischungen mit Namen.
//
// Calciumhydroxid geht wie Gips und Calciumcarbonat obendrauf auf die
// Trockenmischung und steht am Ansatz und an der gespeicherten Mischung. Eine
// Mischung wird ganz gespeichert, mit beidem Kalk, in einem Tipp und mit
// Rückweg; sie hat einen Namen, der sich ändern lässt, und die Auswahl zeigt
// daneben ihr Verhältnis. Der pH des gemischten Substrats steht am Ansatz,
// getrennt vom pH der Chargen beim Beimpfen. Alle Zahlen und Namen hier sind
// erfunden.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');

const APP = quelle();
const SERVER = quelle('server.js');
const HTML = quelle('index.html');
const CSS = quelle('styles.css');
const hebe = (name) => hebeFunktion(name, APP);

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_mixname_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}
const sub = (d, id) => db.listSubstrateBatches(d).find((s) => s.subId === id);

const OPTS = { residualPct: 9 };
const BLEND = { branPct: 20, cornPct: 0, gypsumPct: 1, moisturePct: 60 };

describe('Calciumhydroxid in der Mischrechnung', () => {
  it('rechnet es als Anteil der Trockenmischung, obendrauf wie Gips', () => {
    const m = db.computeMixBatch({ ...BLEND, hydroxidePct: 0.5 }, 100, OPTS);
    assert.equal(m.hydroxideKg.toFixed(6), (m.dryKg * 0.005).toFixed(6));
    assert.equal(m.hydroxidePct, 0.5);
  });

  it('hält die Masse und trifft die Soll-Feuchte, auch neben Calciumcarbonat', () => {
    const m = db.computeMixBatch({ ...BLEND, calciumPct: 2, hydroxidePct: 1 }, 100, OPTS);
    assert.equal((m.dryKg + m.gypsumKg + m.calciumKg + m.hydroxideKg + m.waterL).toFixed(6), '100.000000');
    assert.equal(m.moisturePct.toFixed(1), '60.0');
  });

  it('bucht es nicht vom Lager: es hat dort keinen Bestand', () => {
    const m = db.computeMixBatch({ ...BLEND, hydroxidePct: 1 }, 100, OPTS);
    assert.ok(!m.deltas.some((x) => /hydrox/.test(x.mat)));
    assert.ok(m.deltas.every((x) => db.VALID_MATS === undefined || db.VALID_MATS.includes(x.mat)));
  });

  it('ist 0, wenn keins drin ist, und zählt als Abweichung, wenn welches dazukommt', () => {
    assert.equal(db.computeMixBatch(BLEND, 100, OPTS).hydroxideKg, 0);
    const a = db.mixWithOverride(BLEND, { hydroxidePct: 0.3 });
    assert.equal(a.adjusted, true);
    assert.equal(a.recipe.hydroxidePct, 0.3);
  });
});

describe('eine gespeicherte Mischung trägt die ganze Mischung', () => {
  let d, p, mix;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    for (const [mat, v] of [
      ['hardwood', 500],
      ['wheatbran', 200],
      ['gypsum', 20],
      ['calcium', 20]
    ])
      db.setInventoryAbsolute(d, mat, v, 'count', 'Inventur', null);
    mix = db.createMixRecipe(d, {
      name: 'Testmischung Kalk',
      wheatbranPct: 20,
      gypsumPct: 1,
      calciumPct: 2,
      hydroxidePct: 0.5,
      rhPct: 60
    });
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('legt die Spalten an, auf einer frischen Datenbank', () => {
    const cols = (t) =>
      d
        .prepare("SELECT name FROM pragma_table_info('" + t + "')")
        .all()
        .map((r) => r.name);
    for (const c of ['hydroxide_pct', 'calcium_pct']) assert.ok(cols('recipes').includes(c), 'recipes.' + c);
    for (const c of ['hydroxide_pct', 'hydroxide_kg', 'mix_ph'])
      assert.ok(cols('substrate_batches').includes(c), 'substrate_batches.' + c);
  });

  it('speichert Calciumcarbonat und Calciumhydroxid mit der Mischung', () => {
    assert.equal(mix.calciumPct, 2);
    assert.equal(mix.hydroxidePct, 0.5);
    const gelesen = db.getAllRecipes(d).find((r) => r.id === mix.id);
    assert.deepEqual(
      { ca: gelesen.calciumPct, hyd: gelesen.hydroxidePct, hw: gelesen.hardwoodPct },
      { ca: 2, hyd: 0.5, hw: 80 }
    );
    const found = db.resolveMix(d, { recipeId: mix.id });
    assert.equal(found.recipe.calciumPct, 2);
    assert.equal(found.recipe.hydroxidePct, 0.5);
  });

  it('liest eine Mischung ohne die neuen Zahlen als 0, nicht als leer', () => {
    const id = Number(db.insertRecipe(d, { name: 'Testmischung alt', wheatbran_pct: 10, rh_pct: 60 }));
    const r = db.getRecipeById(d, id);
    assert.equal(r.calciumPct, 0);
    assert.equal(r.hydroxidePct, 0);
  });

  it('weist einen unmöglichen Anteil mit lesbarer Meldung ab', () => {
    assert.throws(
      () => db.createMixRecipe(d, { name: 'Testmischung zu viel', hydroxidePct: 30, rhPct: 60 }),
      /Mischung: Calciumhydroxid liegt zwischen 0 und 20 %/
    );
    assert.ok(db.isSafeError('Mischung: Calciumhydroxid liegt zwischen 0 und 20 %.'));
  });

  it('setzt nach ihr an: Anteil und Menge stehen am Ansatz, der Name bleibt der der Mischung', () => {
    const r = db.createSubstrateBatch(d, { subId: 'KALK-1', recipeId: mix.id, targetKg: 100 }, null);
    const s = sub(d, 'KALK-1');
    assert.equal(s.recipeLabel, 'Testmischung Kalk', 'was die Mischung vorsieht, steht nicht noch einmal im Namen');
    assert.equal(s.composition.hydroxidePct, 0.5);
    assert.equal(s.composition.calciumPct, 2);
    assert.equal(s.hydroxideKg.toFixed(4), r.mix.hydroxideKg.toFixed(4));
    assert.ok(s.hydroxideKg > 0);
  });

  it('nennt im Namen, wenn ein Ansatz vom Kalk der Mischung abweicht', () => {
    db.createSubstrateBatch(
      d,
      { subId: 'KALK-2', recipeId: mix.id, targetKg: 50, mix: { hydroxidePct: 0.8, calciumPct: 0 } },
      null
    );
    assert.equal(sub(d, 'KALK-2').recipeLabel, 'Testmischung Kalk · CaCO₃ 0 % · Ca(OH)₂ 0,8 %');
  });

  it('gibt beim Rezept einer Sorte jede Kalkmenge im Namen an', () => {
    const rezept = { branPct: 20, cornPct: 0, gypsumPct: 1, moisturePct: 60 };
    const name = (ov) => db.mixLabel('Beispiel', rezept, db.computeMixBatch({ ...rezept, ...ov }, 50, {}));
    assert.equal(name({}), 'Beispiel');
    assert.equal(name({ hydroxidePct: 0.5 }), 'Beispiel · Ca(OH)₂ 0,5 %');
    assert.equal(name({ calciumPct: 2, hydroxidePct: 0.5 }), 'Beispiel · CaCO₃ 2 % · Ca(OH)₂ 0,5 %');
  });
});

describe('pH am Ansatz', () => {
  let d, p, mixId;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    mixId = db.createMixRecipe(d, { name: 'Testmischung pH', wheatbranPct: 20, gypsumPct: 1, rhPct: 60 }).id;
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('speichert ihn beim Anlegen und lässt ihn leer, wenn keiner angegeben ist', () => {
    db.createSubstrateBatch(d, { subId: 'PH-1', recipeId: mixId, targetKg: 20, mixPh: 7 }, null);
    db.createSubstrateBatch(d, { subId: 'PH-2', recipeId: mixId, targetKg: 20 }, null);
    assert.equal(sub(d, 'PH-1').mixPh, 7);
    assert.equal(sub(d, 'PH-2').mixPh, null, 'leer ist nicht 0');
  });

  it('trägt ihn nach, korrigiert und löscht ihn', () => {
    assert.deepEqual(db.setSubstrateMixPh(d, 'PH-2', 6.5), { subId: 'PH-2', mixPh: 6.5 });
    assert.equal(sub(d, 'PH-2').mixPh, 6.5);
    db.setSubstrateMixPh(d, 'PH-2', '6.8');
    assert.equal(sub(d, 'PH-2').mixPh, 6.8);
    db.setSubstrateMixPh(d, 'PH-2', '');
    assert.equal(sub(d, 'PH-2').mixPh, null);
    assert.equal(db.setSubstrateMixPh(d, 'PH-99', 7), null, 'unbekannter Ansatz');
  });

  it('weist einen unmöglichen pH ab und legt den Ansatz dann gar nicht an', () => {
    assert.throws(() => db.setSubstrateMixPh(d, 'PH-1', 15), /pH liegt zwischen 0 und 14/);
    assert.throws(() => db.setSubstrateMixPh(d, 'PH-1', 'sauer'), /pH muss eine Zahl sein/);
    assert.throws(
      () => db.createSubstrateBatch(d, { subId: 'PH-3', recipeId: mixId, targetKg: 20, mixPh: 15 }, null),
      /pH liegt/
    );
    assert.equal(sub(d, 'PH-3'), undefined);
  });

  it('hält ihn getrennt vom pH der Chargen beim Beimpfen', () => {
    const s = sub(d, 'PH-1');
    assert.equal(s.mixPh, 7);
    assert.equal(s.phAvg, null, 'keine Charge gemessen');
    assert.equal(db.getSubstrateBatch(d, 'PH-1').mixPh, 7);
  });
});

describe('eine Mischung umbenennen und wieder entfernen', () => {
  let d, p, a, b;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    a = db.createMixRecipe(d, { name: '80/20', wheatbranPct: 20, rhPct: 60 });
    b = db.createMixRecipe(d, { name: 'Testmischung B', wheatbranPct: 10, rhPct: 60 });
    db.setInventoryAbsolute(d, 'hardwood', 500, 'count', 'Inventur', null);
    db.setInventoryAbsolute(d, 'wheatbran', 200, 'count', 'Inventur', null);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('gibt ihr einen neuen Namen, ohne die Zahlen anzufassen', () => {
    const r = db.renameMixRecipe(d, a.id, '  80/20   Testpilz ');
    assert.equal(r.name, '80/20 Testpilz', 'Leerraum bereinigt');
    assert.equal(r.wheatbranPct, 20);
    assert.equal(db.getRecipeById(d, a.id).name, '80/20 Testpilz');
  });

  it('lässt Ansätze unter dem Namen stehen, unter dem sie angesetzt wurden', () => {
    db.createSubstrateBatch(d, { subId: 'NAME-1', recipeId: a.id, targetKg: 20 }, null);
    db.renameMixRecipe(d, a.id, 'Testmischung A');
    assert.equal(sub(d, 'NAME-1').recipeLabel, '80/20 Testpilz');
    db.createSubstrateBatch(d, { subId: 'NAME-2', recipeId: a.id, targetKg: 20 }, null);
    assert.equal(sub(d, 'NAME-2').recipeLabel, 'Testmischung A');
  });

  it('weist einen leeren, zu langen oder schon vergebenen Namen ab', () => {
    assert.throws(() => db.renameMixRecipe(d, a.id, '   '), /Bitte einen Namen eingeben/);
    assert.throws(() => db.renameMixRecipe(d, a.id, 'x'.repeat(61)), /höchstens 60 Zeichen/);
    assert.throws(() => db.renameMixRecipe(d, a.id, 'testmischung b'), /gibt es schon/);
    assert.equal(db.getRecipeById(d, a.id).name, 'Testmischung A');
  });

  it('erlaubt, nur Groß und Klein des eigenen Namens zu ändern', () => {
    assert.equal(db.renameMixRecipe(d, a.id, 'testmischung a').name, 'testmischung a');
  });

  it('meldet eine unbekannte Mischung als nicht gefunden', () => {
    assert.equal(db.renameMixRecipe(d, 99999, 'Testmischung Z'), null);
    assert.equal(db.removeMixRecipe(d, 99999), false);
  });

  it('sortiert die Liste ohne Rücksicht auf Groß und Klein', () => {
    assert.deepEqual(
      db.getAllRecipes(d).map((r) => r.name),
      ['testmischung a', 'Testmischung B']
    );
  });

  it('entfernt eine Mischung wieder, lässt aber eine stehen, an der ein Produkt hängt', () => {
    const c = db.createMixRecipe(d, { name: 'Testmischung C', wheatbranPct: 15, rhPct: 60 });
    assert.equal(db.removeMixRecipe(d, c.id), true);
    assert.equal(db.getRecipeById(d, c.id), null);
    const prod = d
      .prepare('INSERT INTO products(name, created) VALUES(?, ?)')
      .run('Testprodukt', new Date().toISOString()).lastInsertRowid;
    d.prepare('INSERT INTO product_components(product_id, recipe_id) VALUES(?, ?)').run(prod, b.id);
    assert.throws(() => db.removeMixRecipe(d, b.id), /Mischung: Sie wird von einem Produkt verwendet/);
    assert.ok(db.getRecipeById(d, b.id));
  });
});

describe('die Wege im Server', () => {
  const route = (re) => {
    const m = SERVER.match(re);
    assert.ok(m, 'Weg nicht gefunden: ' + re);
    return m[0];
  };

  it('lässt nur einen Admin umbenennen und entfernen', () => {
    const name = route(/const recipeNameMatch = [\s\S]*?\n {2}\}\n/);
    assert.match(name, /\^\\\/api\\\/recipes\\\/\(\\d\+\)\\\/name\$/);
    assert.match(name, /requireAdmin\(req, res\)/);
    assert.match(name, /db\.renameMixRecipe\(/);
    const del = route(/const recipeDelMatch = [\s\S]*?\n {2}\}\n/);
    assert.match(del, /req\.method === 'DELETE'/);
    assert.match(del, /requireAdmin\(req, res\)/);
    assert.match(del, /db\.removeMixRecipe\(/);
  });

  it('trägt den pH am Ansatz nach, und ein fehlendes Feld heißt nicht gemessen', () => {
    const ph = route(/const subPhMatch = [\s\S]*?\n {2}\}\n/);
    assert.match(ph, /db\.setSubstrateMixPh\(/);
    assert.match(ph, /'mixPh' in data \? data\.mixPh : null/);
  });

  it('prüft Calciumhydroxid mit denselben Grenzen wie die anderen Zuschläge', () => {
    const v = hebeFunktion('validateMixOverride', SERVER);
    assert.match(v, /hydroxidePct: \{ min: 0, max: 20 \}/);
  });

  // Das Muster einer Route, aus der Zeile gehoben, die es trägt.
  const muster = (marke) => {
    const zeile = SERVER.split('\n').find((l) => l.includes(marke + ' = req.url.match('));
    assert.ok(zeile, marke + ' nicht in server.js gefunden');
    return new RegExp(zeile.match(/match\(\/(\^.*\$)\/\)/)[1]);
  };

  it('trifft mit jedem Weg nur seine eigene Adresse', () => {
    const name = muster('recipeNameMatch');
    const del = muster('recipeDelMatch');
    const ph = muster('subPhMatch');
    assert.equal('/api/recipes/12/name'.match(name)[1], '12');
    assert.equal(name.test('/api/recipes/12'), false);
    assert.equal(name.test('/api/recipes/abc/name'), false, 'eine Mischung hat eine Nummer');
    assert.equal('/api/recipes/12'.match(del)[1], '12');
    assert.equal(del.test('/api/recipes'), false, 'die Liste ist keine einzelne Mischung');
    assert.equal(del.test('/api/recipes/12/name'), false);
    assert.equal('/api/substrate-batches/SUB-01/ph'.match(ph)[1], 'SUB-01');
    assert.equal(ph.test('/api/substrate-batches/SUB-01'), false);
    assert.equal(ph.test('/api/substrate-batches/SUB-01/steri'), false);
    // Der Einzelabruf eines Ansatzes darf den neuen Weg nicht schlucken.
    assert.equal(muster('subGetMatch').test('/api/substrate-batches/SUB-01/ph'), false);
  });
});

describe('Name und Verhältnis in der Auswahl', () => {
  const namen = {
    'sub.pellets': 'Pellets',
    'sub.bran': 'Weizenkleie',
    'sub.corn': 'Maismehl',
    'sub.soyhull': 'Sojaschalen',
    'sub.gypsum': 'Gips',
    'sub.calcium': 'Calciumcarbonat',
    'sub.hydroxide': 'Calciumhydroxid',
    'sub.moisture': 'Soll-Feuchte'
  };
  const REZEPTE = [
    { id: 1, name: 'Testmischung A', wheatbranPct: 20, soyhullPct: 0, gypsumPct: 1, rhPct: 60 },
    { id: 2, name: '80/20', wheatbranPct: 20, soyhullPct: 0, gypsumPct: 1, rhPct: 60 }
  ];
  const ctx = new Function(
    't',
    '_sbRecipes',
    'esc',
    ['sbZahl', 'sbRecipeRatio', 'sbRecipeTitle', 'subBlendText', 'sbRecipeLine', 'sbRecipeOptions', 'sbMixAutoName']
      .map(hebe)
      .join('\n') + '\nreturn { sbRecipeRatio, sbRecipeTitle, sbRecipeLine, sbRecipeOptions, sbMixAutoName };'
  )(
    (k) => namen[k] || k,
    REZEPTE,
    (s) => String(s)
  );

  it('schreibt das Verhältnis als Pellets zu Kleie, Sojaschalen beim Namen', () => {
    assert.equal(ctx.sbRecipeRatio({ wheatbranPct: 10 }), '90/10');
    assert.equal(ctx.sbRecipeRatio({ wheatbranPct: 12.5 }), '87,5/12,5');
    assert.equal(ctx.sbRecipeRatio({ wheatbranPct: 10, soyhullPct: 35 }), '55/10 · Sojaschalen 35 %');
  });

  it('stellt das Verhältnis neben den Namen', () => {
    assert.equal(ctx.sbRecipeTitle(REZEPTE[0]), 'Testmischung A · 80/20');
    assert.match(ctx.sbRecipeOptions(1), /<option value="1" selected>Testmischung A · 80\/20<\/option>/);
  });

  it('wiederholt es nicht, wenn es schon im Namen steht', () => {
    assert.equal(ctx.sbRecipeTitle(REZEPTE[1]), '80/20');
    assert.equal(ctx.sbRecipeTitle({ name: '80 20 Testpilz', wheatbranPct: 20 }), '80 20 Testpilz');
    assert.equal(ctx.sbRecipeTitle({ name: 'Testpilz 80-20', wheatbranPct: 20 }), 'Testpilz 80-20');
    assert.equal(
      ctx.sbRecipeTitle({ name: 'Testpilz 20', wheatbranPct: 20 }),
      'Testpilz 20 · 80/20',
      'eine einzelne Zahl ist kein Verhältnis'
    );
    assert.equal(
      ctx.sbRecipeTitle({ name: '55/10 Testpilz', wheatbranPct: 10, soyhullPct: 35 }),
      '55/10 Testpilz · Sojaschalen 35 %'
    );
  });

  it('nennt in der Liste alles, was die Mischung ausmacht, und lässt weg, was 0 ist', () => {
    assert.equal(
      ctx.sbRecipeLine({ wheatbranPct: 20, gypsumPct: 1, calciumPct: 2, hydroxidePct: 0.5, rhPct: 60 }),
      '80 % Pellets · 20 % Weizenkleie · Gips 1 % · Calciumcarbonat 2 % · Calciumhydroxid 0,5 % · Soll-Feuchte 60 %'
    );
    assert.equal(
      ctx.sbRecipeLine({ wheatbranPct: 20, rhPct: 60 }),
      '80 % Pellets · 20 % Weizenkleie · Soll-Feuchte 60 %'
    );
  });

  it('schlägt als Namen das Verhältnis vor, mit Nummer, wenn es den schon gibt', () => {
    assert.equal(ctx.sbMixAutoName({ branPct: 30 }), '70/30');
    assert.equal(ctx.sbMixAutoName({ branPct: 20 }), '80/20 (2)');
    assert.equal(ctx.sbMixAutoName({ branPct: 10, soyhullPct: 35 }), '55/10 Sojaschalen 35 %');
  });
});

describe('speichern in einem Tipp, mit Rückweg', () => {
  // Was an den Server geht, und was die Meldung danach anbietet.
  function speichern(antwort) {
    const posts = [];
    const geloescht = [];
    const leiste = {};
    const ctx = new Function(
      't',
      '_sbRecipes',
      'apiPost',
      'apiDelete',
      'showUndoBar',
      'toast',
      'loadSubstrateRecipes',
      ['sbZahl', 'sbRecipeRatio', 'sbMixAutoName', 'sbSaveMixRecipe', 'sbMixSavedToast'].map(hebe).join('\n') +
        '\nreturn { sbSaveMixRecipe, sbMixSavedToast };'
    )(
      (k, p) => k + (p ? JSON.stringify(p) : ''),
      [{ id: 1, name: '70/30' }],
      async (url, body) => {
        posts.push({ url, body });
        return antwort || { id: 7, name: body.name };
      },
      async (url) => {
        geloescht.push(url);
        return { ok: true };
      },
      (msg, cb) => {
        leiste.msg = msg;
        leiste.undo = cb;
      },
      (msg, kind) => {
        leiste.toast = msg;
        leiste.kind = kind;
      },
      async () => {}
    );
    return { ctx, posts, geloescht, leiste };
  }
  const M = { branPct: 30, soyhullPct: 0, gypsumPct: 1, calciumPct: 2, hydroxidePct: 0.5, moisturePct: 60 };

  it('schickt die ganze Mischung, auch den Kalk', async () => {
    const { ctx, posts } = speichern();
    await ctx.sbSaveMixRecipe(' Testmischung neu ', M);
    assert.deepEqual(posts, [
      {
        url: '/api/recipes',
        body: {
          name: 'Testmischung neu',
          wheatbranPct: 30,
          soyhullPct: 0,
          gypsumPct: 1,
          calciumPct: 2,
          hydroxidePct: 0.5,
          rhPct: 60
        }
      }
    ]);
  });

  it('verlangt keinen Namen: ohne heißt sie nach ihrem Verhältnis', async () => {
    const { ctx, posts } = speichern();
    await ctx.sbSaveMixRecipe('', M);
    assert.equal(posts[0].body.name, '70/30 (2)', 'der Name 70/30 ist schon vergeben');
  });

  it('bietet nach dem Speichern den Rückweg an, der die Mischung wieder entfernt', async () => {
    const { ctx, geloescht, leiste } = speichern();
    let zurueck = 0;
    ctx.sbMixSavedToast({ id: 7, name: 'Testmischung neu' }, () => zurueck++);
    assert.match(leiste.msg, /sub\.mixSaved.*Testmischung neu/);
    assert.equal(geloescht.length, 0, 'erst auf Tipp');
    await leiste.undo();
    assert.deepEqual(geloescht, ['/api/recipes/7']);
    assert.equal(zurueck, 1, 'die vorige Auswahl kommt zurück');
    assert.match(leiste.toast, /sub\.mixUnsaved/);
  });

  it('fragt vor dem Speichern nicht nach', () => {
    for (const fn of ['wkmSaveMix', 'wkmSaveDone']) {
      assert.doesNotMatch(hebe(fn), /confirm2\(|confirm\(/, fn + ' fragt nach');
    }
  });

  it('zeigt das Speichern im Ablauf, sobald eine Zahl abweicht, und nur einem Admin', () => {
    const html = (user, abweichend) =>
      new Function(
        'currentUser',
        't',
        'esc',
        'WKM',
        'function wkmMixAdjusted() { return ' +
          abweichend +
          '; }\n' +
          hebe('wkmDarfSichern') +
          '\n' +
          hebe('wkmSichernHtml') +
          '\nreturn wkmSichernHtml();'
      )(
        user,
        (k) => k,
        (s) => String(s),
        { sichern: { name: '', fehler: '', laeuft: false } }
      );
    assert.equal(html({ role: 'user' }, true), '');
    assert.match(html({ role: 'admin' }, false), /id="wkm-sichern" hidden>/);
    const offen = html({ role: 'admin' }, true);
    assert.match(offen, /id="wkm-sichern">/);
    assert.equal(offen.match(/<button/g).length, 1, 'ein Knopf, kein Abbrechen daneben');
    assert.match(offen, /data-wkm="savego"/);
    assert.match(offen, /id="wkm-savename"/);
  });

  it('bietet es auf der Quittung an, wenn der Ansatz von der Mischung abwich', () => {
    const submit = hebe('wkmSubmit');
    assert.match(submit, /wkmDarfSichern\(\) && wkmWeichtAb\(recipeId, mix\)/);
    assert.match(hebe('wkmRender'), /d\.neu \? `<button class="btn" data-wkm="savedone">/);
  });
});

describe('die neuen Felder im Browser', () => {
  const fmtKg = (v, d) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

  it('zeigt Calciumhydroxid unter einem Kilo in Gramm', () => {
    const text = new Function('fmtKg', hebe('sbHydText') + '\nreturn sbHydText;')(fmtKg);
    assert.equal(text(0.214), '214 g');
    assert.equal(text(1.25), '1,25 kg');
  });

  it('führt es im Ablauf als Anteil der Mischung, den pH nicht', () => {
    assert.match(hebeKonstante('WKM_MIX_KEYS', APP), /'hydroxidePct'/);
    assert.doesNotMatch(hebeKonstante('WKM_MIX_KEYS', APP), /mixPh/);
    const render = hebe('wkmRender');
    assert.match(render, /feld\('wkm-hyd', t\('sub\.hydroxide'\)/);
    assert.match(render, /feld\('wkm-ph', t\('sub\.mixPhShort'\)/);
  });

  it('nimmt einen vertippten pH nicht still als leer, und sperrt damit nicht die Mischung', () => {
    const felder = { 'wkm-ph': { value: 'sauer' } };
    const ctx = new Function(
      'document',
      'const WKM = { mix: { branPct: 20 }, steriMin: null, mixPh: null, unlesbar: {} };\n' +
        hebe('parseDecimal') +
        '\n' +
        APP.match(/^const WKM_KEIN_ANTEIL = .*;$/m)[0] +
        '\n' +
        ['wkmFeldLesen', 'wkmUnlesbar', 'wkmMixOk', 'wkmPhOk'].map(hebe).join('\n') +
        '\nreturn { WKM, wkmFeldLesen, wkmUnlesbar, wkmMixOk, wkmPhOk };'
    )({ getElementById: (id) => felder[id] || null });
    ctx.WKM.mixPh = ctx.wkmFeldLesen('ph');
    assert.equal(ctx.wkmPhOk(), false);
    assert.equal(ctx.wkmUnlesbar('ph'), 'ph');
    assert.equal(ctx.wkmUnlesbar('mix'), null);
    assert.equal(ctx.wkmMixOk(), true);
    felder['wkm-ph'].value = '6,8';
    ctx.WKM.mixPh = ctx.wkmFeldLesen('ph');
    assert.equal(ctx.WKM.mixPh, 6.8);
    assert.equal(ctx.wkmPhOk(), true);
    ctx.WKM.mixPh = 15;
    assert.equal(ctx.wkmPhOk(), false, 'ein pH liegt zwischen 0 und 14');
    felder['wkm-ph'].value = '';
    ctx.WKM.mixPh = ctx.wkmFeldLesen('ph');
    assert.equal(ctx.wkmPhOk(), true, 'leer heißt: noch nicht gemessen');
  });

  it('schickt den pH mit dem Ansatz', () => {
    assert.match(hebe('wkmSubmit'), /steriMin,\n\s+mixPh,/);
  });

  it('zeigt in der Liste beide pH nebeneinander, vorher → nachher', () => {
    const zelle = new Function(
      't',
      'esc',
      'fmtKg',
      ['_subSteriText', '_subPhText', '_sbSteriPhCell'].map(hebe).join('\n') + '\nreturn _sbSteriPhCell;'
    )(
      (k) => k,
      (s) => String(s),
      fmtKg
    );
    assert.match(zelle({ steriMin: null, phAvg: null, mixPh: null, phN: 0 }), />–<\/span>$/);
    assert.match(
      zelle({ steriMin: 90, phAvg: 6.2, phN: 1 }),
      />90 min · pH 6,2<\/span>$/,
      'ohne erste Messung wie bisher'
    );
    assert.match(zelle({ steriMin: 90, phAvg: 6.2, phN: 1, mixPh: 7 }), />90 min · pH 7,0 → 6,2<\/span>$/);
    assert.match(zelle({ steriMin: null, phAvg: null, phN: 0, mixPh: 7 }), />– · pH 7,0 → –<\/span>$/);
    assert.match(zelle({ steriMin: 90, phAvg: 6.2, phN: 1, mixPh: 7 }), /title="sub\.phArrow"/);
  });

  it('zeigt am Ansatz Calciumhydroxid und den pH, und lässt den pH nachtragen', () => {
    const info = hebe('openSubstrateInfo');
    assert.match(info, /line\(t\('sub\.hydroxide'\)/);
    assert.match(info, /line\(t\('sub\.mixPh'\)/);
    assert.match(info, /t\('sub\.mixPhAdd'\) : t\('sub\.mixPhEdit'\)/);
    assert.match(hebe('recordMixPh'), /\/ph', \{ mixPh: n \}/);
  });
});

describe('die Liste der gespeicherten Mischungen', () => {
  function liste(user, rezepte) {
    const els = { 'sb-mixes-list': { innerHTML: '' }, 'sb-mixes-n': { textContent: '' } };
    new Function(
      'document',
      'currentUser',
      '_sbRecipes',
      't',
      'esc',
      ['sbZahl', 'subBlendText', 'sbRecipeLine', 'wkmDarfSichern', 'renderMixRecipes'].map(hebe).join('\n') +
        '\nrenderMixRecipes();'
    )(
      { getElementById: (id) => els[id] || null },
      user,
      rezepte,
      (k) => k,
      (s) => String(s).replace(/</g, '&lt;')
    );
    return els;
  }
  const EINE = [{ id: 3, name: 'Testmischung <A>', wheatbranPct: 20, gypsumPct: 1, rhPct: 60 }];

  it('zählt ab 0 und sagt, wenn noch keine da ist', () => {
    const els = liste({ role: 'admin' }, []);
    assert.equal(els['sb-mixes-n'].textContent, ' (0)');
    assert.match(els['sb-mixes-list'].innerHTML, /sub\.mixesNone/);
  });

  it('zeigt Name und Zahlen, und das Umbenennen nur einem Admin', () => {
    const admin = liste({ role: 'admin' }, EINE);
    assert.equal(admin['sb-mixes-n'].textContent, ' (1)');
    assert.match(admin['sb-mixes-list'].innerHTML, /<b>Testmischung &lt;A><\/b>/, 'der Name ist maskiert');
    assert.match(admin['sb-mixes-list'].innerHTML, /80 % sub\.pellets · 20 % sub\.bran/);
    assert.match(admin['sb-mixes-list'].innerHTML, /data-sb-mixname="3"/);
    assert.doesNotMatch(liste({ role: 'user' }, EINE)['sb-mixes-list'].innerHTML, /data-sb-mixname/);
  });

  it('benennt um mit Rückweg, statt vorher zu fragen', async () => {
    const posts = [];
    const leiste = {};
    let eingabe = null;
    const ctx = new Function(
      '_sbRecipes',
      't',
      'apiPost',
      'loadSubstrateRecipes',
      'toast',
      'showUndoBar',
      'prompt2',
      ['sbSetMixName', 'sbRenameMix'].map(hebe).join('\n') + '\nreturn { sbRenameMix };'
    )(
      [{ id: 3, name: '80/20' }],
      (k, p) => k + (p ? JSON.stringify(p) : ''),
      async (url, body) => {
        posts.push({ url, body });
        return { id: 3, name: body.name };
      },
      async () => {},
      (msg, kind) => {
        leiste.toast = msg;
        leiste.kind = kind;
      },
      (msg, cb) => {
        leiste.msg = msg;
        leiste.undo = cb;
      },
      (title, ph, cb, opts) => {
        eingabe = { title, cb, opts };
      }
    );
    ctx.sbRenameMix(3);
    assert.equal(eingabe.opts.value, '80/20', 'der alte Name steht im Feld');
    await eingabe.cb('   ');
    assert.equal(posts.length, 0);
    assert.equal(leiste.kind, 'err', 'ein leerer Name wird gesagt, nicht gespeichert');
    await eingabe.cb('80/20');
    assert.equal(posts.length, 0, 'derselbe Name ist keine Änderung');
    await eingabe.cb('80/20 Testpilz');
    assert.deepEqual(posts, [{ url: '/api/recipes/3/name', body: { name: '80/20 Testpilz' } }]);
    assert.match(leiste.msg, /sub\.mixRenamed.*80\/20 Testpilz/);
    await leiste.undo();
    assert.deepEqual(posts[1], { url: '/api/recipes/3/name', body: { name: '80/20' } });
  });

  it('steht zugeklappt unter dem Formular', () => {
    assert.match(HTML, /<details id="sb-mixes"/);
    assert.match(HTML, /id="sb-mixes-list"/);
    assert.match(hebe('loadSubstrateRecipes'), /renderMixRecipes\(\)/);
  });
});

describe('Texte und Telefon', () => {
  const KEYS = [
    'sub.hydroxide',
    'sub.mixPh',
    'sub.mixPhShort',
    'sub.mixPhAdd',
    'sub.mixPhEdit',
    'sub.mixPhPrompt',
    'sub.mixPhHint',
    'sub.mixPhNaN',
    'sub.mixPhSaved',
    'sub.mixPhCleared',
    'sub.phArrow',
    'sub.mixUnsaved',
    'sub.saveMixAfter',
    'sub.mixesTitle',
    'sub.mixesNone',
    'sub.mixRename',
    'sub.mixRenamePrompt',
    'sub.mixRenamed'
  ];

  it('hat jeden neuen Text in allen drei Sprachen', () => {
    for (const lang of ['de', 'en', 'pt']) {
      const src = quelle('lang/' + lang + '.js');
      for (const k of KEYS) assert.ok(src.includes("'" + k + "': "), lang + ' fehlt ' + k);
    }
  });

  it('verwendet keinen Text, den es nicht gibt', () => {
    const de = quelle('lang/de.js');
    const benutzt = new Set();
    for (const fn of [
      'sbRecipeLine',
      'sbMixSavedToast',
      'renderMixRecipes',
      'sbRenameMix',
      'recordMixPh',
      'wkmSichernHtml',
      '_sbSteriPhCell'
    ]) {
      for (const m of hebe(fn).matchAll(/\bt\('([\w.]+)'/g)) benutzt.add(m[1]);
    }
    for (const m of HTML.matchAll(/data-i18n(?:-placeholder)?="(sub\.(?:mix|saveMix|hydroxide)[\w.]*)"/g))
      benutzt.add(m[1]);
    assert.ok(benutzt.size > 10);
    for (const k of benutzt) assert.ok(de.includes("'" + k + "': "), 'de fehlt ' + k);
  });

  it('nennt im Englischen Gips gypsum und kommt ohne Emojis aus', () => {
    const en = quelle('lang/en.js');
    for (const k of KEYS.concat('work.mMixRange', 'sub.saveMixHint', 'sub.saveMixPh')) {
      const zeile = en.split('\n').find((l) => l.includes("'" + k + "': "));
      assert.ok(zeile, 'en fehlt ' + k);
      assert.doesNotMatch(zeile, /plaster/i);
      assert.doesNotMatch(zeile, /\p{Extended_Pictographic}/u);
    }
  });

  it('lässt den Kasten verschwinden und den Knopf so breit wie seinen Text', () => {
    assert.match(CSS, /\.wkm-sichern\[hidden\] \{\n {2}display: none;\n\}/);
    const zeile = CSS.match(/\.wkm-sichern-row \{[^}]*\}/);
    assert.ok(zeile);
    assert.match(zeile[0], /flex-wrap: wrap/, 'am Telefon bricht der Knopf unter das Feld um');
    const knopf = CSS.match(/\.wkm-sichern-row \.btn \{[^}]*\}/);
    assert.ok(knopf);
    assert.match(knopf[0], /flex: 0 0 auto/);
    assert.doesNotMatch(knopf[0], /width: 100%/);
  });
});
