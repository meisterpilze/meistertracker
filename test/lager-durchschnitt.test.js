'use strict';
// Der Durchschnitt hinter der Lagerschätzung.
//
// Die Schätzung „aus diesem Holz werden noch ~X Beutel" hat keine Sorte — man
// schaut auf einen Haufen Pellets. Ein Mittelwert ist dafür richtig; getippt
// war er es nur so lange, wie ihn jemand nachpflegte. Am 21.08.2026 stand er
// auf 3 kg Blockgewicht, während alle dreizehn Rezepte 5 kg sagten: die
// Schätzung versprach bei 500 kg Holz 600 Beutel statt 334.
//
// Deshalb wird er gerechnet. Diese Tests halten die vier Stufen fest, in denen
// er das tut, und die eine Ausnahme, die keine Rezeptquelle hat.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hebe } = require('./helpers/quelle');

const TEILE = [
  [/^const AVG_FENSTER_TAGE = .*$/m, 'AVG_FENSTER_TAGE'],
  [/^function _avgGewichte\(\) \{[\s\S]*?\r?\n\}/m, '_avgGewichte()'],
  [/^function _avgMittel\(sorten, feld, gewicht\) \{[\s\S]*?\r?\n\}/m, '_avgMittel()'],
  [/^function getAvgComp\(\) \{[\s\S]*?\r?\n\}/m, 'getAvgComp()']
];
const CODE = hebe(TEILE);

// Tage relativ zu jetzt, nie feste Daten: ein Fixture mit eingebautem Datum
// wird irgendwann von der Uhr überholt und der Test dann grün aus dem falschen
// Grund.
const vorTagen = (n) => new Date(Date.now() - n * 86400000).toISOString();

function bauen({ strains = [], batches = [], gespeichert = undefined } = {}) {
  return new Function(`
    const mushroomStrains = ${JSON.stringify(strains)};
    const batches = ${JSON.stringify(batches)};
    const inventory = ${JSON.stringify(gespeichert === undefined ? {} : { avgComposition: gespeichert })};
    ${CODE}
    return { getAvgComp, AVG_FENSTER_TAGE };
  `)();
}

const BLOCK = { id: 1, name: 'Blue Oyster', recBatchType: 'block', recSubstrate: 'holzkleie' };
const holz = (id, hw, wb, rh, bag, grh) => ({
  ...BLOCK,
  id,
  name: 'Sorte ' + id,
  recHardwoodPct: hw,
  recWheatbranPct: wb,
  recRhPct: rh,
  recBagKg: bag,
  recGrainRhPct: grh
});

describe('Lagerdurchschnitt — er kommt aus den Rezepten', () => {
  it('mittelt über die Rezepte, wenn noch nichts produziert wurde', () => {
    // Die Werte sind bewusst so gewählt, dass ihr Mittel NICHT auf der
    // eingebauten Vorgabe (75/25/63, 3 kg) landet — sonst wäre nicht zu sehen,
    // ob wirklich gerechnet oder nur zurückgefallen wurde.
    const w = bauen({ strains: [holz(1, 66, 34, 58, 4, 58), holz(2, 74, 26, 66, 6, 66)] });
    const c = w.getAvgComp();
    assert.equal(c.hwPct, 70);
    assert.equal(c.wbPct, 30);
    assert.equal(c.rhPct, 62);
    assert.equal(c.bagKg, 5);
    assert.equal(c.grainRhPct, 62);
    assert.equal(c.quelle, 'rezepte');
  });

  it('gewichtet nach dem, was wirklich gemacht wurde', () => {
    // Dreimal so viele Beutel von Sorte 2 — deren Rezept zählt dreifach.
    const w = bauen({
      strains: [holz(1, 70, 30, 60, 3, 60), holz(2, 80, 20, 64, 5, 64)],
      batches: [
        { strainId: 1, qty: 10, created: vorTagen(5) },
        { strainId: 2, qty: 30, created: vorTagen(3) }
      ]
    });
    const c = w.getAvgComp();
    assert.equal(c.hwPct, 77.5, '(70·10 + 80·30) / 40');
    assert.equal(c.bagKg, 4.5, '(3·10 + 5·30) / 40');
    assert.equal(c.quelle, 'produktion');
    assert.equal(c.beutel, 40);
  });

  it('lässt alte Chargen aus dem Fenster fallen', () => {
    // Wieder Werte, deren Mittel (70) von der Vorgabe (75) abweicht.
    const strains = [holz(1, 66, 34, 60, 3, 60), holz(2, 74, 26, 64, 5, 64)];
    const frisch = bauen({ strains, batches: [{ strainId: 1, qty: 10, created: vorTagen(5) }] });
    assert.equal(frisch.getAvgComp().hwPct, 66, 'nur Sorte 1 im Fenster');
    const alt = bauen({
      strains,
      batches: [{ strainId: 1, qty: 10, created: vorTagen(frisch.AVG_FENSTER_TAGE + 10) }]
    });
    const c = alt.getAvgComp();
    assert.equal(c.quelle, 'rezepte', 'zu alt — dann zählt wieder jedes Rezept gleich');
    assert.equal(c.hwPct, 70, 'das Mittel der Rezepte, nicht die Vorgabe 75');
  });

  it('fällt aufs Rezeptmittel zurück, wenn ausgerechnet die produzierte Sorte den Wert nicht hat', () => {
    // Der Fall, der die zweite Stufe überhaupt erst braucht: es wurde produziert,
    // aber die Sorte, die produziert wurde, trägt kein Rezept. Ohne den Rückfall
    // stünde hier die eingebaute Vorgabe statt der Rezepte, die es sehr wohl gibt.
    const ohneRezept = { id: 3, name: 'noch ohne Rezept', recBatchType: 'block', recSubstrate: 'holzkleie' };
    const w = bauen({
      strains: [holz(1, 66, 34, 58, 4, 58), holz(2, 74, 26, 66, 6, 66), ohneRezept],
      batches: [{ strainId: 3, qty: 20, created: vorTagen(2) }]
    });
    const c = w.getAvgComp();
    assert.equal(c.hwPct, 70, 'das Mittel der beiden echten Rezepte');
    assert.equal(c.quelle, 'rezepte', 'und die Herkunft sagt genau das');
  });

  it('rechnet Holz und Kleie ohne die CVG-Sorten', () => {
    // Eine CVG-Sorte hat ihre Masse im Kokos. Zählte sie mit, zöge sie den
    // Holzanteil nach unten, obwohl sie kein Gramm Holz nimmt.
    const cvg = {
      id: 9,
      name: 'CVG',
      recBatchType: 'block',
      recSubstrate: 'cvg',
      recCoirPct: 100,
      recRhPct: 70,
      recBagKg: 2
    };
    const w = bauen({ strains: [holz(1, 80, 20, 62, 5, 62), cvg] });
    const c = w.getAvgComp();
    assert.equal(c.hwPct, 80);
    assert.equal(c.bagKg, 5, 'auch das Blockgewicht kommt nur aus den Holz-Rezepten');
    assert.equal(c.rezepte, 1);
  });

  it('nimmt den gespeicherten Wert, solange kein Rezept dasteht', () => {
    const w = bauen({ strains: [], gespeichert: { hwPct: 75, wbPct: 25, rhPct: 63, bagKg: 3, grainRhPct: 52 } });
    const c = w.getAvgComp();
    assert.equal(c.hwPct, 75);
    assert.equal(c.bagKg, 3);
    assert.equal(c.quelle, 'gespeichert');
  });

  it('fällt auf die eingebaute Vorgabe zurück, wenn auch nichts gespeichert ist', () => {
    const c = bauen({ strains: [] }).getAvgComp();
    assert.equal(c.hwPct, 75);
    assert.equal(c.wbPct, 25);
    assert.equal(c.bagKg, 3);
  });

  it('lässt die Körnerbrut-Tüte eine Einstellung — kein Rezept trägt sie', () => {
    const w = bauen({
      strains: [holz(1, 80, 20, 62, 5, 62)],
      gespeichert: { grainBagKg: 2.5 }
    });
    const c = w.getAvgComp();
    assert.equal(c.grainBagKg, 2.5, 'gespeichert, nicht gerechnet');
    assert.equal(c.hwPct, 80, 'alles andere trotzdem aus dem Rezept');
  });

  it('übergeht Sorten ohne Rezepttyp und Werte ohne Zahl', () => {
    const ohne = { id: 5, name: 'ohne Rezept' };
    const halb = { ...holz(6, 0, 0, 0, 0, 0), recBatchType: 'block' };
    const w = bauen({ strains: [holz(1, 80, 20, 62, 5, 62), ohne, halb] });
    const c = w.getAvgComp();
    assert.equal(c.hwPct, 80, 'die leeren Rezepte ziehen den Schnitt nicht auf null');
  });
});
