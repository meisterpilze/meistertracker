'use strict';
// v67: substrate is mixed in bulk, once, and portioned into bags afterwards —
// often across several species out of the same mix. So the raw materials are
// charged when the mix is made, and a Charge drawn from it costs only the spawn
// it is inoculated with.
//
// The old arrangement charged pellets per bag, which booked the same substrate
// twice: once when it was mixed and again for every bag made from it. These
// tests hold the two levels apart and pin the places where kilograms move
// between them — creating, growing, deleting, and overdrawing.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_sub_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

// The shiitake row of the recipe sheet: its hydration target sits far enough
// below the others that the residual-moisture correction is plainly visible.
const SHIITAKE = { branPct: 20, cornPct: 0, gypsumPct: 1, moisturePct: 56.5 };
const MAITAKE = { branPct: 19, cornPct: 5, gypsumPct: 1, moisturePct: 59 };

function seedStrain(d, name, kuerzel, rec, spawnPct) {
  return db.createMushroomStrain(d, {
    name,
    kuerzel,
    recBatchType: 'block',
    recSubstrate: 'holzkleie',
    recBagKg: 5,
    recHardwoodPct: 100 - rec.branPct - rec.cornPct,
    recWheatbranPct: rec.branPct,
    recCornPct: rec.cornPct,
    recGypsumPct: rec.gypsumPct,
    recRhPct: rec.moisturePct,
    recSpawnPct: spawnPct == null ? 5 : spawnPct,
    recIncDays: 60
  });
}

const stock = (d, mat) => d.prepare('SELECT stock_' + mat + ' AS v FROM inventory WHERE id=1').get().v;
const sub = (d, id) => db.listSubstrateBatches(d).find((s) => s.subId === id);

describe('mix arithmetic', () => {
  it('prices a mix from a blend and a target amount of finished substrate', () => {
    const m = db.computeMixBatch(SHIITAKE, 200, { residualPct: 9, flowLmin: 10 });
    assert.equal(m.dryKg.toFixed(1), '94.6');
    assert.equal(m.pelletsKg.toFixed(1), '75.7');
    assert.equal(m.branKg.toFixed(1), '18.9');
    assert.equal(m.gypsumKg.toFixed(2), '0.95');
    assert.equal(m.waterL.toFixed(1), '104.5');
    // Lands on the figure the recipe asked for once the moisture the pellets
    // arrived with is counted — which is the point of the correction.
    assert.equal(m.moisturePct.toFixed(1), '56.5');
  });

  it('counts the moisture the delivery arrived with', () => {
    const corrected = db.computeMixBatch(SHIITAKE, 200, { residualPct: 9 });
    const naive = 200 * (1 - 0.565); // what a per-bag calculation charges
    assert.equal((corrected.dryKg - naive).toFixed(1), '7.6');
    const dry0 = db.computeMixBatch({ ...SHIITAKE, gypsumPct: 0 }, 200, { residualPct: 0 }).dryKg;
    assert.equal(dry0.toFixed(1), naive.toFixed(1));
  });

  it('charges no spawn, because a mix does not know its species yet', () => {
    const m = db.computeMixBatch(SHIITAKE, 200, {});
    assert.equal(
      m.deltas.some((x) => x.mat === 'grain'),
      false
    );
  });

  it('keeps corn meal in the blend rather than folding it into the pellets', () => {
    const m = db.computeMixBatch(MAITAKE, 100, { residualPct: 9 });
    assert.equal(m.cornKg.toFixed(1), '2.2');
    assert.equal((m.pelletsKg + m.branKg + m.cornKg).toFixed(2), m.dryKg.toFixed(2));
  });

  it('refuses blends and targets that cannot be mixed', () => {
    assert.throws(() => db.computeMixBatch({ ...SHIITAKE, branPct: 80, cornPct: 25 }, 100, {}), /Pellets/);
    assert.throws(() => db.computeMixBatch({ ...SHIITAKE, moisturePct: 5 }, 100, { residualPct: 9 }), /Restfeuchte/);
    assert.throws(() => db.computeMixBatch(SHIITAKE, 0, {}), /groesser als 0/);
  });
});

describe('substrate batches and the Chargen drawn from them', () => {
  let d, p, bo, chut;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    bo = seedStrain(d, 'Blue Oyster', 'BO', { branPct: 20, cornPct: 0, gypsumPct: 1, moisturePct: 62 });
    chut = seedStrain(d, 'Chestnut', 'CHUT', { branPct: 20, cornPct: 0, gypsumPct: 1, moisturePct: 63 });
    const counts = [
      ['hardwood', 600],
      ['wheatbran', 200],
      ['gypsum', 20],
      ['grain', 60],
      ['corn', 25]
    ];
    for (const [mat, v] of counts) db.setInventoryAbsolute(d, mat, v, 'count', 'Inventur', null);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('charges the shelf when the mix is made, and not for the spawn', () => {
    const r = db.createSubstrateBatch(d, { subId: 'SUB-01', recipeStrainId: bo, targetKg: 200 }, null);
    assert.equal(stock(d, 'hardwood').toFixed(2), (600 - r.mix.pelletsKg).toFixed(2));
    assert.equal(stock(d, 'wheatbran').toFixed(2), (200 - r.mix.branKg).toFixed(2));
    // Nothing is inoculated yet, so nothing has been taken out of the grain.
    assert.equal(stock(d, 'grain'), 60);
    assert.equal(sub(d, 'SUB-01').remainingKg, 200);
  });

  it('takes kilograms out of the mix, not out of the shelf, when bags are made', () => {
    const pelletsBefore = stock(d, 'hardwood');
    const r = db.createBagBatchFromSubstrate(
      d,
      { batchId: 'BO-01', subId: 'SUB-01', strainId: bo, qty: 20, bagKg: 5 },
      null
    );
    assert.equal(r.drawKg, 100);
    assert.equal(stock(d, 'hardwood'), pelletsBefore, 'the substrate was paid for when it was mixed');
    assert.equal(stock(d, 'grain').toFixed(2), '55.00', 'only the spawn is charged here');
    assert.equal(sub(d, 'SUB-01').remainingKg, 100);
    assert.equal(d.prepare("SELECT COUNT(*) c FROM bags WHERE batch_id='BO-01'").get().c, 20);
    assert.equal(d.prepare("SELECT COUNT(*) c FROM barcodes WHERE entity_type='bag'").get().c, 20);
  });

  it('lets a different species draw from the same mix', () => {
    const r = db.createBagBatchFromSubstrate(
      d,
      { batchId: 'CHUT-01', subId: 'SUB-01', strainId: chut, qty: 15, bagKg: 5 },
      null
    );
    assert.equal(r.drawKg, 75);
    assert.equal(sub(d, 'SUB-01').remainingKg, 25);
    // The bags carry the blend that was actually mixed — a blue oyster mix at
    // 62%, not the chestnut recipe's 63%.
    const row = d.prepare("SELECT sub_rh FROM batches WHERE batch_id='CHUT-01'").get();
    assert.equal(row.sub_rh, 62);
  });

  it('charges more mix and more spawn when a Charge is grown', () => {
    const grainBefore = stock(d, 'grain');
    const pelletsBefore = stock(d, 'hardwood');
    db.addBagsToBatch(d, 'CHUT-01', ['CHUT-01-16', 'CHUT-01-17'], 17, 5, null);
    assert.equal(sub(d, 'SUB-01').remainingKg, 15);
    assert.equal(stock(d, 'grain').toFixed(2), (grainBefore - 0.5).toFixed(2));
    assert.equal(stock(d, 'hardwood'), pelletsBefore);
  });

  it('will not delete a mix that Chargen are still made of', () => {
    assert.throws(() => db.deleteSubstrateBatch(d, 'SUB-01', null), /verwendet/);
    assert.ok(sub(d, 'SUB-01'));
  });

  it('gives the substrate back to the mix when a Charge is deleted', () => {
    const grainBefore = stock(d, 'grain');
    const pelletsBefore = stock(d, 'hardwood');
    db.deleteBatchById(d, 'BO-01', null);
    assert.equal(sub(d, 'SUB-01').remainingKg, 115, '100 kg returns to the mix');
    assert.equal(stock(d, 'grain').toFixed(2), (grainBefore + 5).toFixed(2), 'the spawn returns to the shelf');
    assert.equal(stock(d, 'hardwood'), pelletsBefore, 'the pellets stay booked against the mix');
  });

  it('allows an overdraw and records it, rather than losing the bags', () => {
    // A mix can come out heavier than the arithmetic said. Refusing the bags
    // that physically exist pushes the operator into not recording them at all.
    const r = db.createBagBatchFromSubstrate(
      d,
      { batchId: 'BO-02', subId: 'SUB-01', strainId: bo, qty: 30, bagKg: 5 },
      null
    );
    assert.equal(r.over, true);
    assert.equal(sub(d, 'SUB-01').remainingKg, 0, 'never shows substrate that is demonstrably gone');
    assert.equal(sub(d, 'SUB-01').status, 'used');
  });

  it('refunds a mix by what the ledger says it took', () => {
    const r = db.createSubstrateBatch(d, { subId: 'SUB-02', recipeStrainId: bo, targetKg: 50 }, null);
    const after = stock(d, 'hardwood');
    db.deleteSubstrateBatch(d, 'SUB-02', null);
    assert.equal(stock(d, 'hardwood').toFixed(3), (after + r.mix.pelletsKg).toFixed(3));
    assert.equal(sub(d, 'SUB-02'), undefined);
  });

  it('leaves the ledger reconciling with the shelf', () => {
    const opening = { hardwood: 600, wheatbran: 200, gypsum: 20, grain: 60, corn: 25 };
    for (const mat of Object.keys(opening)) {
      const sum = d.prepare('SELECT COALESCE(SUM(delta_kg),0) s FROM inventory_log WHERE mat=?').get(mat).s;
      assert.ok(
        Math.abs(sum - stock(d, mat)) < 1e-6,
        mat + ': ledger ' + sum + ' vs shelf ' + stock(d, mat)
      );
    }
  });

  it('refuses to mix a Sorte whose recipe is not complete enough', () => {
    const resh = db.createMushroomStrain(d, { name: 'Reishi', kuerzel: 'RESH', recRhPct: 61 });
    assert.throws(() => db.createSubstrateBatch(d, { subId: 'SUB-X', recipeStrainId: resh, targetKg: 50 }, null), /Rezept/);
  });
});
