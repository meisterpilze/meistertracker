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

  it('refuses to mix a Sorte with no hydration target, since there is no sum to do', () => {
    const empty = db.createMushroomStrain(d, { name: 'Ohne Rezept', kuerzel: 'OHNE' });
    assert.throws(
      () => db.createSubstrateBatch(d, { subId: 'SUB-X', recipeStrainId: empty, targetKg: 50 }, null),
      /Rezept/
    );
  });

  it('accepts a recipe that uses no gypsum', () => {
    // Gypsum is not what makes a recipe complete. Requiring it reported a
    // finished CVG recipe as missing and sent the operator off to re-enter one
    // that was already there.
    const nogyp = db.createMushroomStrain(d, {
      name: 'Ohne Gips',
      kuerzel: 'NOGY',
      recBatchType: 'block',
      recSubstrate: 'holzkleie',
      recBagKg: 5,
      recHardwoodPct: 80,
      recWheatbranPct: 20,
      recGypsumPct: 0,
      recRhPct: 62,
      recSpawnPct: 5
    });
    const found = db.getMixRecipe(d, nogyp);
    assert.ok(found, 'a gypsum-free blend is still a recipe');
    const m = db.computeMixBatch(found.recipe, 100, { residualPct: 9 });
    assert.equal(m.gypsumKg, 0);
    assert.equal(
      m.deltas.some((x) => x.mat === 'gypsum'),
      false
    );
  });

  it('books coir for a CVG recipe instead of draining the pellets', () => {
    // The base of a blend is whatever the blend is not, and on a CVG recipe that
    // base is coir. Pricing every mix as hardwood emptied the wrong shelf.
    const cvg = db.createMushroomStrain(d, {
      name: 'CVG Sorte',
      kuerzel: 'TCVG',
      recBatchType: 'block',
      recSubstrate: 'cvg',
      recBagKg: 5,
      recHardwoodPct: 0,
      recWheatbranPct: 0,
      recCoirPct: 100,
      recGypsumPct: 0,
      recRhPct: 60,
      recSpawnPct: 5
    });
    db.setInventoryAbsolute(d, 'coir', 200, 'count', 'Inventur', null);
    const hwBefore = stock(d, 'hardwood');
    db.createSubstrateBatch(d, { subId: 'SUB-CVG', recipeStrainId: cvg, targetKg: 50 }, null);
    assert.equal(stock(d, 'hardwood'), hwBefore, 'a coir mix must not touch the pellets');
    assert.ok(stock(d, 'coir') < 200, 'the coir is what gets used');
    assert.equal(db.getMixRecipe(d, cvg).recipe.substrate, 'cvg');
  });
});

describe('what a mix still holds is derived, not accumulated', () => {
  let d, p, bo;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    bo = seedStrain(d, 'Blue Oyster', 'BO', { branPct: 20, cornPct: 0, gypsumPct: 1, moisturePct: 62 });
    const counts = [
      ['hardwood', 900],
      ['wheatbran', 300],
      ['gypsum', 30],
      ['grain', 90]
    ];
    for (const [mat, v] of counts) db.setInventoryAbsolute(d, mat, v, 'count', 'Inventur', null);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('does not hand back more than the mix ever held when a Charge overdrew it', () => {
    // 200 kg mixed, 75 kg taken, then 150 kg overdrawn. Deleting the overdrawn
    // Charge used to credit its full 150 kg onto a remainder of 0 and leave
    // 150 kg standing — 25 kg of substrate that was never made.
    db.createSubstrateBatch(d, { subId: 'M1', recipeStrainId: bo, targetKg: 200 }, null);
    db.createBagBatchFromSubstrate(d, { batchId: 'M1-A', subId: 'M1', strainId: bo, qty: 15, bagKg: 5 }, null);
    assert.equal(sub(d, 'M1').remainingKg, 125);
    db.createBagBatchFromSubstrate(d, { batchId: 'M1-B', subId: 'M1', strainId: bo, qty: 30, bagKg: 5 }, null);
    assert.equal(sub(d, 'M1').remainingKg, 0);
    db.deleteBatchById(d, 'M1-B', null);
    assert.equal(sub(d, 'M1').remainingKg, 125, 'only the 75 kg still out stays out');
  });

  it('keeps a written-off mix written off when a Charge is handed back', () => {
    db.createSubstrateBatch(d, { subId: 'M2', recipeStrainId: bo, targetKg: 200 }, null);
    db.createBagBatchFromSubstrate(d, { batchId: 'M2-A', subId: 'M2', strainId: bo, qty: 20, bagKg: 5 }, null);
    db.writeOffSubstrateBatch(d, 'M2', 'kontaminiert', null);
    assert.equal(sub(d, 'M2').status, 'written_off');
    db.deleteBatchById(d, 'M2-A', null);
    const after = sub(d, 'M2');
    assert.equal(after.status, 'written_off', 'contaminated substrate must not become available again');
    assert.equal(after.remainingKg, 0);
  });

  it('counts the extra bags when a Charge out of a mix is grown', () => {
    db.createSubstrateBatch(d, { subId: 'M3', recipeStrainId: bo, targetKg: 100 }, null);
    db.createBagBatchFromSubstrate(d, { batchId: 'M3-A', subId: 'M3', strainId: bo, qty: 10, bagKg: 5 }, null);
    assert.equal(sub(d, 'M3').remainingKg, 50);
    db.addBagsToBatch(d, 'M3-A', ['M3-A-11', 'M3-A-12'], 12, 5, null);
    assert.equal(sub(d, 'M3').remainingKg, 40, 'the two added bags come out of the mix too');
  });
});

describe('looking into a mix after the fact', () => {
  let d, p, bo;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    bo = seedStrain(d, 'Blue Oyster', 'BO', { branPct: 20, cornPct: 0, gypsumPct: 1, moisturePct: 62 });
    for (const [mat, v] of [['hardwood', 600], ['wheatbran', 200], ['gypsum', 20], ['grain', 60]]) {
      db.setInventoryAbsolute(d, mat, v, 'count', 'Inventur', null);
    }
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('reports how it was made and what came out of it', () => {
    db.createSubstrateBatch(d, { subId: 'SUB-A', recipeStrainId: bo, targetKg: 200, notes: 'Montag' }, null);
    db.createBagBatchFromSubstrate(d, { batchId: 'BO-A', subId: 'SUB-A', strainId: bo, qty: 20, bagKg: 5 }, null);
    const one = db.getSubstrateBatch(d, 'SUB-A');
    assert.equal(one.targetKg, 200);
    assert.equal(one.remainingKg, 100);
    assert.equal(one.notes, 'Montag');
    assert.equal(one.drawn.length, 1);
    assert.equal(one.drawn[0].batchId, 'BO-A');
    assert.equal(one.drawn[0].substrateKg, 100);
    // The ledger, not a recomputation: a mix made while stock was short booked
    // less than its recipe asked for, and that gap is the whole point of showing it.
    const pellets = one.ledger.find((l) => l.mat === 'hardwood');
    assert.equal(Math.abs(pellets.deltaKg).toFixed(2), one.pelletsKg.toFixed(2));
  });

  it('says nothing about a mix that does not exist', () => {
    assert.equal(db.getSubstrateBatch(d, 'SUB-NOPE'), null);
  });

  it('writes off what is left without crediting the shelf', () => {
    const pelletsBefore = stock(d, 'hardwood');
    const r = db.writeOffSubstrateBatch(d, 'SUB-A', 'kontaminiert', null);
    assert.equal(r.lostKg, 100);
    const one = db.getSubstrateBatch(d, 'SUB-A');
    assert.equal(one.status, 'written_off');
    assert.equal(one.remainingKg, 0);
    // The pellets were mixed. They are gone whatever the mix turned into.
    assert.equal(stock(d, 'hardwood'), pelletsBefore);
    assert.match(one.notes, /kontaminiert/);
    assert.match(one.notes, /100\.0 kg/);
  });

  it('keeps a written-off mix out of what can still be used', () => {
    const open = db.listSubstrateBatches(d, { openOnly: true }).map((s) => s.subId);
    assert.equal(open.includes('SUB-A'), false);
    // But it is still there to be counted and looked at.
    assert.ok(db.listSubstrateBatches(d).some((s) => s.subId === 'SUB-A'));
  });

  it('deletes a mix nothing was made from, and puts the material back', () => {
    const before = stock(d, 'hardwood');
    const r = db.createSubstrateBatch(d, { subId: 'SUB-TEST', recipeStrainId: bo, targetKg: 40 }, null);
    assert.equal(stock(d, 'hardwood').toFixed(3), (before - r.mix.pelletsKg).toFixed(3));
    assert.equal(db.deleteSubstrateBatch(d, 'SUB-TEST', null), true);
    assert.equal(stock(d, 'hardwood').toFixed(3), before.toFixed(3));
    assert.equal(db.getSubstrateBatch(d, 'SUB-TEST'), null);
  });
});
