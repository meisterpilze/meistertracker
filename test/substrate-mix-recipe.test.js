'use strict';
// A substrate Ansatz is species-neutral, so the form picks a stored mix (the
// recipes table) instead of a Sorte. These pin that the mix path books the same
// way the Sorte path does, and names the Ansatz after the mix.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

// An invented blend.
const BLEND = { branPct: 25, cornPct: 0, gypsumPct: 2, moisturePct: 59 };

describe('substrate Ansatz from a stored mix', () => {
  let d, p, mixId, dryId;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_mixrec_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    mixId = Number(
      db.insertRecipe(d, {
        name: 'Testmischung A',
        hardwood_pct: 100 - BLEND.branPct,
        wheatbran_pct: BLEND.branPct,
        gypsum_pct: BLEND.gypsumPct,
        rh_pct: BLEND.moisturePct
      })
    );
    dryId = Number(db.insertRecipe(d, { name: 'Testmischung ohne Feuchte', wheatbran_pct: 10 }));
    for (const [mat, v] of [
      ['hardwood', 500],
      ['wheatbran', 200],
      ['gypsum', 20]
    ])
      db.setInventoryAbsolute(d, mat, v, 'count', 'Inventur', null);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('reads the mix as the blend the arithmetic expects', () => {
    const found = db.resolveMix(d, { recipeId: mixId });
    assert.equal(found.label, 'Testmischung A');
    assert.deepEqual(
      { b: found.recipe.branPct, c: found.recipe.cornPct, g: found.recipe.gypsumPct, m: found.recipe.moisturePct },
      { b: 25, c: 0, g: 2, m: 59 }
    );
  });

  it('books the shelf and names the Ansatz after the mix', () => {
    const r = db.createSubstrateBatch(d, { subId: 'MIX-1', recipeId: mixId, targetKg: 100 }, null);
    const expect = db.computeMixBatch(BLEND, 100, db.resolveMix(d, { recipeId: mixId }).opts);
    assert.equal(r.mix.pelletsKg.toFixed(2), expect.pelletsKg.toFixed(2));
    const s = db.listSubstrateBatches(d).find((x) => x.subId === 'MIX-1');
    assert.equal(s.recipeLabel, 'Testmischung A');
    assert.equal(s.recipeStrainId, null);
    assert.equal(s.remainingKg, 100);
  });

  it('carries a changed blend in the label', () => {
    db.createSubstrateBatch(d, { subId: 'MIX-2', recipeId: mixId, targetKg: 50, mix: { branPct: 30 } }, null);
    const s = db.listSubstrateBatches(d).find((x) => x.subId === 'MIX-2');
    assert.equal(s.recipeLabel, 'Testmischung A · 70/30');
  });

  it('refuses a mix without a moisture target, and an unknown one', () => {
    assert.equal(db.resolveMix(d, { recipeId: dryId }), null);
    assert.throws(
      () => db.createSubstrateBatch(d, { subId: 'MIX-3', recipeId: dryId, targetKg: 10 }, null),
      /Soll-Feuchte/
    );
    assert.throws(() => db.resolveMix(d, { recipeId: 99999 }), /nicht gefunden/);
  });
});
