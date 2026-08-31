'use strict';
// Eine andere Mischung, ohne das Rezept der Sorte umzuschreiben.
//
// Das Rezept der Sorte war die Vorschrift: 80/20 stand dort, also mischte der
// Ansatz-Knopf 80/20. Wer einmal 70/30 ansetzen wollte, musste das Rezept der
// Sorte ändern — und damit jeden künftigen Ansatz mit. Zwei Änderungen für
// einen Versuch, und die zweite (das Zurücknehmen) vergisst man.
//
// Die Spalten dafür gab es längst: substrate_batches führt hardwood_pct,
// wheatbran_pct, gypsum_pct und rh_pct pro Ansatz. Es gab nur keinen Weg, sie
// anders zu füllen als über die Sorte.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const REZEPT = { substrate: 'holzkleie', branPct: 20, cornPct: 0, gypsumPct: 1, moisturePct: 60 };
const OPTS = { residualPct: 9, flowLmin: 10 };

describe('die Mischung eines Ansatzes', () => {
  it('bleibt beim Rezept, wenn nichts genannt ist', () => {
    for (const ov of [undefined, null, {}, 'nein']) {
      const r = db.mixWithOverride(REZEPT, ov);
      assert.equal(r.adjusted, false, String(ov) + ' hat das Rezept angefasst');
      assert.equal(r.recipe.branPct, 20);
    }
  });

  it('übernimmt nur, was genannt ist', () => {
    const r = db.mixWithOverride(REZEPT, { branPct: 30 });
    assert.equal(r.adjusted, true);
    assert.equal(r.recipe.branPct, 30);
    assert.equal(r.recipe.gypsumPct, 1, 'der Gips stand nicht zur Debatte');
    assert.equal(r.recipe.moisturePct, 60);
    assert.equal(REZEPT.branPct, 20, 'das Rezept der Sorte darf sich dabei nicht ändern');
  });

  it('nennt dieselbe Zahl keine Abweichung', () => {
    // Das Formular schickt immer alle vier Felder, auch wenn nichts angefasst
    // wurde. Zählte das als Abweichung, trüge jeder Ansatz "· 80/20" im Namen.
    const r = db.mixWithOverride(REZEPT, { branPct: 20, cornPct: 0, gypsumPct: 1, moisturePct: 60 });
    assert.equal(r.adjusted, false);
  });

  it('rechnet die 70/30 aus, die jemand eingetippt hat', () => {
    const r = db.mixWithOverride(REZEPT, { branPct: 30 });
    const m = db.computeMixBatch(r.recipe, 200, OPTS);
    assert.equal(Math.round(m.hardwoodPct), 70);
    assert.equal(Math.round(m.wheatbranPct), 30);
    // Die Kilo dahinter, damit ein Vorzeichenfehler in der Rechnung hier
    // auffällt und nicht erst am Mischer.
    assert.equal(m.pelletsKg.toFixed(1), '60.9');
    assert.equal(m.branKg.toFixed(1), '26.1');
    assert.equal((m.pelletsKg + m.branKg + m.gypsumKg + m.waterL).toFixed(1), '200.0', 'der Ansatz wiegt sein Ziel');
  });

  it('lässt auch die Zielfeuchte ändern', () => {
    const trocken = db.computeMixBatch(db.mixWithOverride(REZEPT, { moisturePct: 56 }).recipe, 200, OPTS);
    const feucht = db.computeMixBatch(REZEPT, 200, OPTS);
    assert.ok(trocken.waterL < feucht.waterL, 'trockener heißt weniger Wasser');
    assert.ok(trocken.dryKg > feucht.dryKg, 'und bei gleichem Zielgewicht mehr Trockenmaterial');
  });

  it('sagt, was schiefging, statt "Internal server error"', () => {
    // Seit die Anteile eintippbar sind, sind das Tippfehler und keine
    // Programmfehler. isSafeError entscheidet, ob der Text den Mischenden
    // erreicht oder hinter einer 500 verschwindet.
    const faelle = [
      [{ moisturePct: 6 }, /Restfeuchte/],
      [{ branPct: 99, cornPct: 5 }, /Kleie \+ Maismehl/]
    ];
    for (const [ov, muster] of faelle) {
      let msg = null;
      try {
        db.computeMixBatch(db.mixWithOverride(REZEPT, ov).recipe, 200, OPTS);
      } catch (e) {
        msg = e.message;
      }
      assert.ok(msg, JSON.stringify(ov) + ' hätte auffallen müssen');
      assert.match(msg, muster);
      assert.equal(db.isSafeError(msg), true, 'diese Meldung erreicht den Mischenden nicht: ' + msg);
    }
  });
});

// Die zwei Felder, die eine Zahl sind: was nicht Kleie (und Mais) ist, ist
// Pellets. Gegen Attrappen, weil sbBlendEdited im Formular lebt.
function tippen(felder, welches) {
  return new Function(
    'werte',
    'welches',
    `
    const el = {};
    for (const id of Object.keys(werte)) el[id] = { value: String(werte[id]) };
    const document = { getElementById: (id) => el[id] || null };
    const parseDecimal = (v) => parseFloat(String(v).replace(',', '.'));
    function sbBlendDirty() {}
    function sbPreviewSoon() {}
    ${hebeFunktion('_sbNum', quelle())}
    ${hebeFunktion('_sbSet', quelle())}
    ${hebeFunktion('sbBlendEdited', quelle())}
    sbBlendEdited(welches);
    const raus = {};
    for (const id of Object.keys(el)) raus[id] = el[id].value;
    return raus;
  `
  )(felder, welches);
}

describe('Pellets und Kleie im Formular', () => {
  it('setzt die Kleie, wenn jemand die Pellets tippt', () => {
    const r = tippen({ 'sb-hw': 70, 'sb-wb': 20, 'sb-corn': 0 }, 'hw');
    assert.equal(r['sb-wb'], '30', '70 % Pellets sind 30 % Kleie, sonst ergibt die Mischung nicht 100');
  });

  it('und die Pellets, wenn jemand die Kleie tippt', () => {
    assert.equal(tippen({ 'sb-hw': 80, 'sb-wb': 30, 'sb-corn': 0 }, 'wb')['sb-hw'], '70');
  });

  it('zieht das Maismehl vorher ab', () => {
    // Maitake mischt 76/19/5. Die Pellets sind der Rest von allem, nicht nur
    // von der Kleie.
    const r = tippen({ 'sb-hw': 76, 'sb-wb': 19, 'sb-corn': 5 }, 'wb');
    assert.equal(r['sb-hw'], '76');
  });

  it('lässt keine Mischung über 100 % zu', () => {
    const r = tippen({ 'sb-hw': 140, 'sb-wb': 20, 'sb-corn': 0 }, 'hw');
    assert.equal(r['sb-wb'], '0', 'mehr als 100 % Pellets sind 0 % Kleie, keine negative');
  });

  it('rührt Gips und Feuchte nicht an', () => {
    // Die beiden gehören zu keiner Waage: der Gips kommt oben drauf, die
    // Feuchte ist Wasser. Sie hier mitzurechnen wäre stiller Unsinn.
    const r = tippen({ 'sb-hw': 70, 'sb-wb': 20, 'sb-corn': 0, 'sb-gyp': 1, 'sb-rh': 60 }, 'hw');
    assert.equal(r['sb-gyp'], '1');
    assert.equal(r['sb-rh'], '60');
  });
});
