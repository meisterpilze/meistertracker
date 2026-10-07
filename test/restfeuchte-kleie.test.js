'use strict';
// Pellets und Kleie kommen unterschiedlich feucht an. Mit einer Restfeuchte fuer
// beide war das Wasser jedes Ansatzes um den Unterschied zu hoch: die Kleie
// brachte mehr mit, als abgezogen wurde. Gepinnt wird, dass die Mischung mit
// getrennten Werten ihre Soll-Feuchte trifft, und dass ohne Kleie-Wert alles
// beim Alten bleibt.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

// Erfundene Mischung und erfundene Restfeuchten.
const BLEND = { branPct: 25, cornPct: 0, gypsumPct: 2, moisturePct: 59 };

// Wasser im fertigen Substrat, aus den Bestandteilen nachgerechnet: zugegebenes
// Wasser plus das, was jeder Rohstoff mitbringt. Gips gilt als trocken.
function feuchte(m, rPellets, rKleie) {
  return ((m.waterL + m.pelletsKg * rPellets + m.branKg * rKleie) / m.targetKg) * 100;
}

describe('Restfeuchte je Rohstoff', () => {
  it('trifft die Soll-Feuchte, wenn die Kleie feuchter ankommt als die Pellets', () => {
    const m = db.computeMixBatch(BLEND, 100, { residualPct: 7, residualBranPct: 14 });
    assert.equal(feuchte(m, 0.07, 0.14).toFixed(2), '59.00');
  });

  it('gibt weniger Wasser zu als mit einer Zahl fuer beide', () => {
    const eine = db.computeMixBatch(BLEND, 100, { residualPct: 7 });
    const zwei = db.computeMixBatch(BLEND, 100, { residualPct: 7, residualBranPct: 14 });
    assert.ok(zwei.waterL < eine.waterL);
    // Mit einer Zahl fuer beide waere der Ansatz zu nass geworden.
    assert.ok(feuchte(eine, 0.07, 0.14) > 59.1);
  });

  it('rechnet ohne Kleie-Wert wie bisher', () => {
    const alt = db.computeMixBatch(BLEND, 100, { residualPct: 7 });
    const leer = db.computeMixBatch(BLEND, 100, { residualPct: 7, residualBranPct: null });
    assert.equal(leer.waterL.toFixed(6), alt.waterL.toFixed(6));
  });
});

describe('Restfeuchte speichern', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_resid_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('liefert ohne Kleie-Wert null, also wie die Pellets', () => {
    assert.equal(db.getResidualMoisture(d).branPct, null);
  });

  it('speichert beide Werte und die Mischrechnung liest sie', () => {
    db.setResidualMoisture(d, { pelletsPct: 7, branPct: 14 });
    assert.deepEqual(db.getResidualMoisture(d), { pelletsPct: 7, branPct: 14, holdbackPct: 10 });
    const id = Number(
      db.insertRecipe(d, { name: 'Testmischung R', wheatbran_pct: BLEND.branPct, gypsum_pct: 2, rh_pct: 59 })
    );
    const found = db.resolveMix(d, { recipeId: id });
    assert.equal(found.opts.residualPct, 7);
    assert.equal(found.opts.residualBranPct, 14);
  });

  it('weist Tippfehler ab', () => {
    assert.throws(() => db.setResidualMoisture(d, { pelletsPct: 90, branPct: 14 }), /zwischen 0 und 30/);
    assert.throws(() => db.setResidualMoisture(d, { pelletsPct: null, branPct: 14 }), /fehlt/);
  });
});
