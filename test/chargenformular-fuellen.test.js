'use strict';
// Das Chargenformular aus einem Rezept füllen.
//
// Zwei Wege füllen dasselbe lange Formular: der Schnelldialog und der geführte
// Assistent. Sie hatten je ihre eigene Feldliste, und die waren auseinander-
// gelaufen — dem Assistenten fehlten Gips, Kultur und Körnerfeuchte, bis die
// zweite Nachprüfung sie fand. Eine stehengebliebene G2G-Kultur schrieb dabei
// sogar eine fremde Körnertüte als verbraucht ab.
//
// Der wichtigste Test hier hält keine eigene Liste: er liest aus createBatch(),
// welche Felder gebraucht werden, und verlangt, dass nbFillFromStrain() jedes
// davon setzt. Eine Liste im Test wäre nur die nächste Stelle, die jemand
// mitführen muss und vergisst.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebe } = require('./helpers/quelle');

const SRC = quelle();

// Felder, die createBatch anfasst, aber nicht als Eingabe liest: dort schreibt
// es sein Ergebnis hin.
const AUSGABE = new Set(['nb-bags', 'nb-result', 'nb-mat-preview']);

function gelesenVonCreateBatch() {
  // `async`, seit die beiden Material-Warnungen darin Dialoge sind statt
  // window.confirm() — hier optional, damit beides passt.
  const m = SRC.match(/^(?:async )?function createBatch\(\) \{[\s\S]*?\r?\n\}/m);
  assert.ok(m, 'createBatch() nicht in app.js gefunden — der Test muss mitgeführt werden');
  const ids = new Set();
  for (const treffer of m[0].matchAll(/getElementById\('(nb-[a-z0-9-]+)'\)/g)) {
    if (!AUSGABE.has(treffer[1])) ids.add(treffer[1]);
  }
  return [...ids].sort();
}

// Ein Formularfeld, das sich merkt, ob jemand hineingeschrieben hat.
function feld(id, geschrieben) {
  const o = { _v: '', _c: false };
  Object.defineProperty(o, 'value', {
    get: () => o._v,
    set: (v) => {
      geschrieben.add(id);
      o._v = v;
    }
  });
  Object.defineProperty(o, 'checked', {
    get: () => o._c,
    set: (v) => {
      geschrieben.add(id);
      o._c = v;
    }
  });
  return o;
}

const CODE = hebe([[/^function nbFillFromStrain\(ms, o\) \{[\s\S]*?\r?\n\}/m, 'nbFillFromStrain()']], SRC);

function fuellen(ms, opt) {
  const geschrieben = new Set();
  const felder = {};
  const doc = {
    getElementById: (id) => {
      felder[id] = felder[id] || feld(id, geschrieben);
      return felder[id];
    }
  };
  let kulturListe = null;
  const api = new Function(
    'document',
    'setBagWeight',
    'parseDecimal',
    'fillCultureSelect',
    'inocRender',
    'nbSubstrateChanged',
    'nbStrainChanged',
    '_inoc',
    CODE + '\nreturn { nbFillFromStrain, inoc: () => _inoc };'
  )(
    doc,
    // setBagWeight ist die einzige Stelle, die nb-weight setzen darf — siehe
    // dort. Für den Test zählt, dass sie überhaupt gerufen wird.
    (kg) => {
      geschrieben.add('nb-weight');
      felder['nb-weight'] = felder['nb-weight'] || feld('nb-weight', geschrieben);
      felder['nb-weight'].value = kg;
    },
    (v) => (v == null ? NaN : parseFloat(String(v).trim())),
    (id, typen) => {
      kulturListe = { id, typen };
    },
    () => {},
    () => {},
    () => {},
    ['alt']
  );
  api.nbFillFromStrain(ms, opt);
  const wert = (id) => (felder[id] ? felder[id].value : undefined);
  return { geschrieben, wert, felder, kulturListe, inoc: api.inoc() };
}

const HOLZ = {
  id: 7,
  recSubstrate: 'holzkleie',
  recBatchType: 'block',
  recBagKg: 5,
  recIncDays: 14,
  recRhPct: 65,
  recHardwoodPct: 70,
  recWheatbranPct: 30,
  recCoirPct: 0,
  recGrainKg: 0,
  recGrainRhPct: 52,
  recGypsum: true
};

describe('Chargenformular füllen — kein Feld darf durchrutschen', () => {
  it('setzt jedes Feld, das createBatch liest', () => {
    // Der eigentliche Wächter. Kommt in createBatch ein Feld dazu, ohne dass
    // nbFillFromStrain es setzt, fällt dieser Test um — statt dass der nächste
    // Benutzer den Altwert seines Vorgängers mitbucht.
    const { geschrieben } = fuellen(HOLZ, { qty: 20 });
    const fehlend = gelesenVonCreateBatch().filter((id) => !geschrieben.has(id));
    assert.deepEqual(
      fehlend,
      [],
      'createBatch liest diese Felder, nbFillFromStrain setzt sie nicht: ' + fehlend.join(', ')
    );
  });

  it('leert die Ansatz-Auswahl, sonst zieht die Charge aus einem alten Ansatz', () => {
    // createBatch nimmt bei gesetzter Auswahl den Weg über den Ansatz und
    // übergeht die Zusammensetzung komplett. Der Schnelldialog leerte sie nie.
    const { wert } = fuellen(HOLZ, { qty: 20 });
    assert.equal(wert('nb-substrate-batch'), '');
  });

  it('räumt Kultur und Beimpfung weg, wenn keine mitkommt', () => {
    // Eine stehengebliebene G2G-/GS-Kultur wird von createBatch als verbraucht
    // abgeschrieben — für eine Charge, die sie nie angefasst hat.
    const { wert, inoc, kulturListe } = fuellen(HOLZ, { qty: 20 });
    assert.equal(wert('nb-culture'), '');
    assert.deepEqual(inoc, [], 'die Beimpf-Auswahl des letzten Durchgangs darf nicht überleben');
    assert.ok(kulturListe, 'die Kulturliste muss frisch gefüllt werden');
    assert.deepEqual(kulturListe.typen, ['PD', 'LC', 'G2G', 'GS']);
  });

  it('übernimmt Kultur und Beimpfung, wenn eine mitkommt', () => {
    const { wert, inoc } = fuellen(HOLZ, { qty: 20, culture: 'LC-AUS-260801-01', inoc: [{ id: 'GS-1' }] });
    assert.equal(wert('nb-culture'), 'LC-AUS-260801-01');
    assert.deepEqual(inoc, [{ id: 'GS-1' }]);
  });
});

describe('Chargenformular füllen — das Rezept der Sorte', () => {
  it('nimmt Holz und Kleie aus dem Rezept und lässt Kokos auf null', () => {
    const { wert } = fuellen(HOLZ, { qty: 20 });
    assert.equal(wert('nb-hw'), 70);
    assert.equal(wert('nb-wb'), 30);
    assert.equal(wert('nb-coir'), 0);
    assert.equal(wert('nb-rh'), 65);
    assert.equal(wert('nb-days'), 14);
    assert.equal(wert('nb-gyp'), '');
    assert.equal(wert('nb-grainrh'), 52);
  });

  it('gibt einer CVG-Sorte ihre Masse im Kokos, nicht in Holz und Kleie', () => {
    // Hart auf 0 gesetzt legte der Assistent eine CVG-Charge an, ohne ein Gramm
    // abzubuchen — createBatch fragte dann noch „bucht kein Material?".
    const cvg = Object.assign({}, HOLZ, {
      recSubstrate: 'cvg',
      recCoirPct: 100,
      recHardwoodPct: 0,
      recWheatbranPct: 0
    });
    const { wert } = fuellen(cvg, { qty: 20 });
    assert.equal(wert('nb-coir'), 100);
    assert.equal(wert('nb-hw'), 0);
    assert.equal(wert('nb-wb'), 0);
  });

  it('lässt Holz und Kleie auch dann weg, wenn der Aufrufer sie mitbringt', () => {
    // Der Assistent reicht sein eigenes Rezept durch. Bei einer CVG-Sorte darf
    // das die 100 % Kokos nicht auf 170 % aufaddieren.
    const cvg = Object.assign({}, HOLZ, { recSubstrate: 'cvg', recCoirPct: 100 });
    const { wert } = fuellen(cvg, { qty: 20, hw: 70, wb: 30 });
    assert.equal(wert('nb-hw'), 0);
    assert.equal(wert('nb-wb'), 0);
    assert.equal(wert('nb-coir'), 100);
  });

  it('gibt einer All-in-One-Sorte ihre Körnerbrut', () => {
    const aio = Object.assign({}, HOLZ, { recBatchType: 'allinone', recGrainKg: 3 });
    const { wert } = fuellen(aio, { qty: 20 });
    assert.equal(wert('nb-grainkg'), 3);
  });

  it('lässt eine Block-Sorte ohne Körner', () => {
    const { wert } = fuellen(HOLZ, { qty: 20 });
    assert.equal(wert('nb-grainkg'), 0);
  });

  it('setzt den Gips-Haken aus dem Rezept, nicht aus der letzten Eingabe', () => {
    // Der Haken überlebt über die gemerkten Vorgaben jede Sitzung und buchte
    // sonst Gips mit, den der Assistent nie angeboten hat.
    const { felder } = fuellen(HOLZ, { qty: 20 });
    assert.equal(felder['nb-gyp'].checked, true);
    const ohne = fuellen(Object.assign({}, HOLZ, { recGypsum: false }), { qty: 20 });
    assert.equal(ohne.felder['nb-gyp'].checked, false);
  });
});

describe('Chargenformular füllen — was der Aufrufer mitbringt, gilt', () => {
  it('überschreibt Menge, Tage und Feuchte des Rezepts', () => {
    const { wert } = fuellen(HOLZ, { qty: 40, days: 21, rh: 58 });
    assert.equal(wert('nb-qty'), 40);
    assert.equal(wert('nb-days'), 21);
    assert.equal(wert('nb-rh'), 58);
  });

  it('nimmt eine 0 als Wert, nicht als „nicht gesetzt"', () => {
    // hw/wb sind bei einer Block-Sorte legitim 0, wenn der Assistent es so sagt.
    const { wert } = fuellen(HOLZ, { qty: 20, hw: 0, wb: 0 });
    assert.equal(wert('nb-hw'), 0);
    assert.equal(wert('nb-wb'), 0);
  });

  it('fällt auf das Rezept zurück, wo nichts mitkommt', () => {
    const { wert } = fuellen(HOLZ, { qty: 20 });
    assert.equal(wert('nb-days'), 14, 'recIncDays');
    assert.equal(wert('nb-rh'), 65, 'recRhPct');
  });

  it('schreibt Notiz und Stammbezeichnung, und leert sie sonst', () => {
    const mit = fuellen(HOLZ, { qty: 20, notes: 'Regal 3', strainText: 'P8' });
    assert.equal(mit.wert('nb-notes'), 'Regal 3');
    assert.equal(mit.wert('nb-strain-text'), 'P8');
    const ohne = fuellen(HOLZ, { qty: 20 });
    assert.equal(ohne.wert('nb-notes'), '');
    assert.equal(ohne.wert('nb-strain-text'), '');
  });
});
