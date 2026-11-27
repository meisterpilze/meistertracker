'use strict';
// Eine andere Mischung, ohne das Rezept der Sorte umzuschreiben.
//
// Das Rezept der Sorte war die Vorschrift: stand dort 80/20, mischte der
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
      [{ branPct: 99, cornPct: 5 }, /Kleie, Maismehl und Sojaschalen ergeben 104%/],
      // Sojaschalen teilen sich denselben Platz mit Kleie und Mais.
      [{ branPct: 40, soyhullPct: 60 }, /Kleie, Maismehl und Sojaschalen ergeben 100%/]
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

// Die zwei Felder, die eine Zahl sind: was nicht Kleie (und Sojaschalen) ist,
// ist Pellets. Gegen Attrappen, weil wkmBlendEdited im geführten Ablauf lebt,
// dem einen Weg, Substrat anzusetzen. Das Formular, das dieselbe Rechnung ein
// zweites Mal hatte, gibt es nicht mehr.
function tippen(felder, welches, mix) {
  return new Function(
    'werte',
    'welches',
    'mix',
    `
    const el = {};
    for (const id of Object.keys(werte)) el[id] = { value: String(werte[id]) };
    const document = { getElementById: (id) => el[id] || null, querySelector: () => null };
    const WKM = { recipeId: 1, mix: Object.assign({}, mix), unlesbar: {} };
    const sbRecipeOf = () => ({ branPct: 20, soyhullPct: 0 });
    const wkmMixAdjusted = () => false;
    const wkmLoadPreview = () => {};
    const setTimeout = () => 0;
    const clearTimeout = () => {};
    let _wkmMixTimer = null;
    ${hebeFunktion('parseDecimal', quelle())}
    ${hebeFunktion('_sbSet', quelle())}
    ${hebeFunktion('wkmFeldLesen', quelle())}
    ${hebeFunktion('wkmBlendEdited', quelle())}
    wkmBlendEdited(welches);
    const raus = { mix: WKM.mix };
    for (const id of Object.keys(el)) raus[id] = el[id].value;
    return raus;
  `
  )(felder, welches, mix || {});
}

describe('Pellets und Kleie im Ablauf', () => {
  it('setzt die Kleie, wenn jemand die Pellets tippt', () => {
    const r = tippen({ 'wkm-hw': 70, 'wkm-wb': 20 }, 'hw');
    assert.equal(r['wkm-wb'], '30', '70 % Pellets sind 30 % Kleie, sonst ergibt die Mischung nicht 100');
    assert.equal(r.mix.branPct, 30);
  });

  it('und die Pellets, wenn jemand die Kleie tippt', () => {
    assert.equal(tippen({ 'wkm-hw': 80, 'wkm-wb': 30 }, 'wb')['wkm-hw'], '70');
  });

  it('zieht die Sojaschalen vorher ab', () => {
    // Mit Sojaschalen, etwa 70/20/10. Die Pellets sind der Rest von allem, nicht
    // nur von der Kleie.
    const r = tippen({ 'wkm-hw': 70, 'wkm-wb': 20 }, 'wb', { soyhullPct: 10 });
    assert.equal(r['wkm-hw'], '70');
  });

  it('lässt keine Mischung über 100 % zu', () => {
    const r = tippen({ 'wkm-hw': 140, 'wkm-wb': 20 }, 'hw');
    assert.equal(r['wkm-wb'], '0', 'mehr als 100 % Pellets sind 0 % Kleie, keine negative');
  });

  it('rührt Gips und Feuchte nicht an', () => {
    // Die beiden gehören zu keiner Waage: der Gips kommt oben drauf, die
    // Feuchte ist Wasser. Sie hier mitzurechnen wäre stiller Unsinn.
    const r = tippen({ 'wkm-hw': 70, 'wkm-wb': 20, 'wkm-gyp': 1, 'wkm-rh': 60 }, 'hw');
    assert.equal(r['wkm-gyp'], '1');
    assert.equal(r['wkm-rh'], '60');
  });
});
