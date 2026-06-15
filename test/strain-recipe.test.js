'use strict';
// v46: each Pilzsorte (mushroom_strains) can carry a default production recipe
// (rec_* columns) so a Charge or Laborarbeit can be spun up from the Sorte
// without re-entering substrate/grain/hydration. These tests verify the recipe
// round-trips through create/list/update and that an empty recipe stays empty.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_rec_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

describe('Sorte production recipe (rec_*)', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('persists an all-in-one recipe on create and returns it from list', () => {
    const id = db.createMushroomStrain(d, {
      name: 'Oyster',
      kuerzel: 'OY',
      description: 'Blue',
      recBatchType: 'allinone',
      recSubstrate: 'cvg',
      recBagKg: 3,
      recRhPct: 0,
      recCoirPct: 100,
      recGypsum: true,
      recGrainKg: 0.5,
      recGrainRhPct: 52,
      recIncDays: 12
    });
    const ms = db.listMushroomStrains(d).find((x) => x.id === id);
    assert.ok(ms, 'strain created');
    assert.equal(ms.recBatchType, 'allinone');
    assert.equal(ms.recSubstrate, 'cvg');
    assert.equal(ms.recBagKg, 3);
    assert.equal(ms.recCoirPct, 100);
    assert.equal(ms.recGypsum, true);
    assert.equal(ms.recGrainKg, 0.5);
    assert.equal(ms.recGrainRhPct, 52);
    assert.equal(ms.recIncDays, 12);
  });

  it('defaults to an empty recipe when none is given', () => {
    const id = db.createMushroomStrain(d, { name: 'Shiitake', kuerzel: 'SHI' });
    const ms = db.listMushroomStrains(d).find((x) => x.id === id);
    assert.equal(ms.recBatchType, '', 'no recipe type');
    assert.equal(ms.recGrainRhPct, 52, 'grain hydration defaults to 52%');
    assert.equal(ms.recIncDays, 14, 'incubation days default 14');
  });

  it('updates the recipe via updateMushroomStrain', () => {
    const id = db.createMushroomStrain(d, { name: 'Lions Mane', kuerzel: 'LM' });
    db.updateMushroomStrain(d, id, {
      recBatchType: 'block',
      recSubstrate: 'holzkleie',
      recBagKg: 5,
      recRhPct: 60,
      recHardwoodPct: 80,
      recWheatbranPct: 20,
      recGypsum: false,
      recIncDays: 21
    });
    const ms = db.listMushroomStrains(d).find((x) => x.id === id);
    assert.equal(ms.recBatchType, 'block');
    assert.equal(ms.recBagKg, 5);
    assert.equal(ms.recHardwoodPct, 80);
    assert.equal(ms.recWheatbranPct, 20);
    assert.equal(ms.recIncDays, 21);
  });

  it('leaves the recipe untouched on a name/description-only update', () => {
    const id = db.createMushroomStrain(d, {
      name: 'Reishi',
      kuerzel: 'RE',
      recBatchType: 'grain',
      recGrainKg: 1
    });
    db.updateMushroomStrain(d, id, { description: 'updated note' });
    const ms = db.listMushroomStrains(d).find((x) => x.id === id);
    assert.equal(ms.recBatchType, 'grain', 'recipe preserved');
    assert.equal(ms.recGrainKg, 1, 'grain kg preserved');
    assert.equal(ms.description, 'updated note');
  });
});
