'use strict';
// Phase 2: an "All-in-One" charge is internally a block batch that also carries
// a coir/CVG fraction (sub_coir) and a raw-grain portion (grain_kg). These tests
// verify the shared inventory ledger stays consistent: create deducts grain +
// coir + gypsum, delete credits exactly the same back (the credit-back path
// recomputes via computeBatchMaterialDeltas from the stored batch fields).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_aio_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

describe('all-in-one / CVG batch — inventory deduct + credit-back', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('deducts grain + coir + gypsum on create and credits them back on delete', () => {
    db.setInventoryAbsolute(d, 'grain', 10, 'seed', 't');
    db.setInventoryAbsolute(d, 'coir', 10, 'seed', 't');
    db.setInventoryAbsolute(d, 'gypsum', 5, 'seed', 't');

    const now = new Date().toISOString();
    const due = new Date(Date.now() + 14 * 864e5).toISOString();
    // 2 bags · substrate 3 kg coir @ rh 0 → 6 kg coir · gypsum 1% of dry → 0.06 ·
    // grain 0.5 kg/bag @ rh 0 → 1 kg grain
    db.insertBatch(
      d,
      {
        batchId: 'AIO-1',
        species: 'Oyster (OY)',
        strain: 'XXX',
        qty: 2,
        days: 14,
        substrate: { coir: 100, rh: 0, gypsum: true },
        bagKg: 3,
        batchType: 'block',
        grainRh: 0,
        grainKg: 0.5,
        created: now,
        due,
        bags: ['AIO-1-01', 'AIO-1-02']
      },
      [
        { mat: 'coir', deltaKg: -6 },
        { mat: 'grain', deltaKg: -1 },
        { mat: 'gypsum', deltaKg: -0.06 }
      ],
      null
    );

    let inv = db.getInventory(d).stock;
    assert.ok(Math.abs(inv.coir - 4) < 1e-9, 'coir 10-6=4');
    assert.ok(Math.abs(inv.grain - 9) < 1e-9, 'grain 10-1=9');
    assert.ok(Math.abs(inv.gypsum - 4.94) < 1e-9, 'gypsum 5-0.06=4.94');

    db.deleteBatchById(d, 'AIO-1', null);
    inv = db.getInventory(d).stock;
    assert.ok(Math.abs(inv.coir - 10) < 1e-9, 'coir credited back to 10');
    assert.ok(Math.abs(inv.grain - 10) < 1e-9, 'grain credited back to 10');
    assert.ok(Math.abs(inv.gypsum - 5) < 1e-9, 'gypsum credited back to 5');
  });

  it('applies grain hydration (52%) symmetrically on create + credit-back', () => {
    db.setInventoryAbsolute(d, 'grain', 5, 'seed', 't');
    db.setInventoryAbsolute(d, 'coir', 5, 'seed', 't');

    const now = new Date().toISOString();
    const due = new Date(Date.now() + 14 * 864e5).toISOString();
    // grain 1 kg/bag wet @ 52% → 0.48 dry/bag · 2 bags → 0.96 dry grain.
    // coir 2 kg dry/bag · 2 → 4 kg coir.
    db.insertBatch(
      d,
      {
        batchId: 'AIO-2',
        species: 'Oyster (OY)',
        strain: 'XXX',
        qty: 2,
        days: 14,
        substrate: { coir: 100, rh: 0, gypsum: false },
        bagKg: 2,
        batchType: 'block',
        grainRh: 52,
        grainKg: 1,
        created: now,
        due,
        bags: ['AIO-2-01', 'AIO-2-02']
      },
      [
        { mat: 'coir', deltaKg: -4 },
        { mat: 'grain', deltaKg: -0.96 }
      ],
      null
    );

    let inv = db.getInventory(d).stock;
    assert.ok(Math.abs(inv.grain - 4.04) < 1e-9, 'grain 5-0.96 (52% hydration)');
    assert.ok(Math.abs(inv.coir - 1) < 1e-9, 'coir 5-4');

    db.deleteBatchById(d, 'AIO-2', null);
    inv = db.getInventory(d).stock;
    assert.ok(Math.abs(inv.grain - 5) < 1e-9, 'grain credited back with hydration');
    assert.ok(Math.abs(inv.coir - 5) < 1e-9, 'coir credited back');
  });

  it('plain holz+kleie block batches are unaffected (no coir/grain)', () => {
    db.setInventoryAbsolute(d, 'hardwood', 10, 'seed', 't');
    db.setInventoryAbsolute(d, 'wheatbran', 10, 'seed', 't');
    db.setInventoryAbsolute(d, 'grain', 0, 'seed', 't');
    db.setInventoryAbsolute(d, 'coir', 0, 'seed', 't');

    const now = new Date().toISOString();
    const due = new Date(Date.now() + 14 * 864e5).toISOString();
    // 1 bag · 3 kg dry @ rh 0 · 70/30 → hw 2.1, wb 0.9; no coir, no grain
    db.insertBatch(
      d,
      {
        batchId: 'BLK-1',
        species: 'Shiitake (SHII)',
        strain: 'XXX',
        qty: 1,
        days: 14,
        substrate: { hardwood: 70, wheatbran: 30, rh: 0, gypsum: false },
        bagKg: 3,
        batchType: 'block',
        created: now,
        due,
        bags: ['BLK-1-01']
      },
      [
        { mat: 'hardwood', deltaKg: -2.1 },
        { mat: 'wheatbran', deltaKg: -0.9 }
      ],
      null
    );
    let inv = db.getInventory(d).stock;
    assert.ok(Math.abs(inv.hardwood - 7.9) < 1e-9, 'hardwood 10-2.1');
    assert.ok(Math.abs(inv.wheatbran - 9.1) < 1e-9, 'wheatbran 10-0.9');
    assert.equal(inv.grain, 0, 'no grain touched');
    assert.equal(inv.coir, 0, 'no coir touched');

    db.deleteBatchById(d, 'BLK-1', null);
    inv = db.getInventory(d).stock;
    assert.ok(Math.abs(inv.hardwood - 10) < 1e-9, 'hardwood credited back');
    assert.ok(Math.abs(inv.wheatbran - 10) < 1e-9, 'wheatbran credited back');
  });
});
