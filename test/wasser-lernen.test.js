'use strict';
// Der Wasservorschlag lernt aus gemessenen Ansaetzen und haelt einen Teil
// zurueck. Zu viel Wasser laesst sich nicht wieder herausholen; zu wenig
// laesst sich nach dem Messen nachgeben. Gepinnt wird:
//   - ohne Messungen: Rechnung minus Rueckhalt,
//   - ein Ansatz, der mit weniger Wasser nasser wurde als gedacht, senkt den
//     naechsten Vorschlag um genau so viel, wie das Ziel getroffen haette,
//   - vertippte Werte verbiegen den Vorschlag nicht.
// Alle Zahlen sind erfunden.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

describe('Wasser lernen und zurueckhalten', () => {
  let d, p, mixId;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_water_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    mixId = Number(db.insertRecipe(d, { name: 'Testmischung W', wheatbran_pct: 20, gypsum_pct: 2, rh_pct: 60 }));
    for (const [mat, v] of [
      ['hardwood', 2000],
      ['wheatbran', 600],
      ['gypsum', 50]
    ])
      db.setInventoryAbsolute(d, mat, v, 'count', 'Inventur', null);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('haelt ohne Messungen die Vorgabe zurueck und lernt nichts', () => {
    const w = db.waterPlan(d, 100, 10);
    assert.equal(w.n, 0);
    assert.equal(w.factor, 1);
    assert.equal(w.nowL.toFixed(1), '90.0');
    assert.equal(w.restL.toFixed(1), '10.0');
    assert.equal(w.nowMinutes.toFixed(1), '9.0');
  });

  it('nimmt den Rueckhalt aus den Einstellungen', () => {
    db.setResidualMoisture(d, { pelletsPct: 9, holdbackPct: 20 });
    assert.equal(db.waterPlan(d, 100, 10).nowL.toFixed(1), '80.0');
    db.setResidualMoisture(d, { pelletsPct: 9, holdbackPct: null });
    assert.equal(db.waterPlan(d, 100, 10).holdbackPct, 10);
  });

  it('speichert den Vorschlag am Ansatz', () => {
    const r = db.createSubstrateBatch(d, { subId: 'W-1', recipeId: mixId, targetKg: 200 }, null);
    const s = db.getSubstrateBatch(d, 'W-1');
    assert.equal(s.waterNowL.toFixed(3), (r.mix.waterL * 0.9).toFixed(3));
    assert.equal(s.actualWaterL, null);
    assert.equal(s.waterFactor, null);
  });

  it('lernt aus Messung und zugegebenem Wasser, was das Ziel getroffen haette', () => {
    const s = db.getSubstrateBatch(d, 'W-1');
    // Weniger Wasser als gerechnet, und trotzdem nasser als das Ziel.
    const W = Math.round(s.waterL * 0.9);
    db.setSubstrateMoisture(d, 'W-1', 61, null);
    db.setSubstrateWater(d, 'W-1', W);
    const solids = s.dryKg + s.gypsumKg;
    const ausMaterial = 0.61 * (solids + W) - W;
    const noetig = (0.6 * solids - ausMaterial) / 0.4;
    const f = db.getSubstrateBatch(d, 'W-1').waterFactor;
    assert.equal(f.toFixed(6), (noetig / s.waterL).toFixed(6));
    assert.ok(f < 0.9);

    const plan = db.waterPlan(d, 100, 10);
    assert.equal(plan.n, 1);
    assert.equal(plan.plannedL.toFixed(3), (100 * f).toFixed(3));
    assert.equal(plan.nowL.toFixed(3), (100 * f * 0.9).toFixed(3));
  });

  it('nimmt den Median, damit ein Ausreisser nicht allein bestimmt', () => {
    for (const [id, rh] of [
      ['W-2', 60],
      ['W-3', 59.5]
    ]) {
      db.createSubstrateBatch(d, { subId: id, recipeId: mixId, targetKg: 200 }, null);
      const s = db.getSubstrateBatch(d, id);
      db.setSubstrateMoisture(d, id, rh, null);
      db.setSubstrateWater(d, id, Math.round(s.waterL));
    }
    const fs3 = ['W-1', 'W-2', 'W-3'].map((id) => db.getSubstrateBatch(d, id).waterFactor).sort((a, b) => a - b);
    const plan = db.waterPlan(d, 100, 10);
    assert.equal(plan.n, 3);
    assert.equal(plan.factor.toFixed(6), fs3[1].toFixed(6));
  });

  it('laesst vertippte Werte nicht mitlernen', () => {
    db.createSubstrateBatch(d, { subId: 'W-4', recipeId: mixId, targetKg: 200 }, null);
    db.setSubstrateMoisture(d, 'W-4', 95, null);
    db.setSubstrateWater(d, 'W-4', 5);
    assert.equal(db.getSubstrateBatch(d, 'W-4').waterFactor, null);
    assert.equal(db.waterPlan(d, 100, 10).n, 3);
  });

  it('weist unsinnige Wassermengen ab und loescht mit null', () => {
    assert.throws(() => db.setSubstrateWater(d, 'W-4', -3), /Wassermenge/);
    assert.equal(db.setSubstrateWater(d, 'W-4', null).actualWaterL, null);
    assert.equal(db.setSubstrateWater(d, 'NICHT-DA', 10), null);
  });
});
