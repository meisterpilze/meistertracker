'use strict';
// Renaming a Pilzsorte propagates to the rows that reference it — and until
// 2026-08-14 it propagated the wrong shape into `batches`.
//
// The two tables do not spell a species the same way. A batch is created with
// `species = "Name (KÜRZEL)"`; a culture is created with `species = "Name"` and
// keeps the kuerzel in `strain`. One statement served both, in the culture
// shape, so every rename stripped the code off its batches and overwrote their
// free-text strain with the kuerzel.
//
// The species half left the building: the harvest feed sends that string
// verbatim, a shop matches on it literally, and a release entered in the lab
// then matched nothing — with nothing red on either side. Measured on the
// production database: 25 batches across 8 species.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_ren_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

/** A batch the way the application actually writes one: coded species, free-text strain. */
function charge(d, batchId, strainId, species, strain) {
  db.insertBatch(
    d,
    {
      batchId,
      species,
      strain,
      strainId,
      qty: 1,
      days: 14,
      substrate: { hardwood: 80, wheatbran: 20, rh: 0, gypsum: false },
      bagKg: 3,
      batchType: 'block',
      grainRh: 0,
      grainKg: 0,
      created: '2026-08-01T08:00:00.000Z',
      due: '2026-08-15T08:00:00.000Z',
      bags: [batchId + '-01']
    },
    [],
    null
  );
}

describe('Sorte umbenennen', () => {
  let d, p, id;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    id = db.createMushroomStrain(d, { name: 'Lions Mane', kuerzel: 'LM' });
    charge(d, 'LM-010826-01', id, 'Lions Mane (LM)', 'Pride');
  });
  after(() => {
    d.close();
    try {
      fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  });

  it('hält die Art in der Form, in der eine Charge sie trägt', () => {
    db.updateMushroomStrain(d, id, { name: 'Igelstachelbart' });
    const b = db.readBatchById(d, 'LM-010826-01');
    assert.equal(
      b.species,
      'Igelstachelbart (LM)',
      'ohne das Kürzel trifft der Empfänger des Ernte-Feeds die Art nicht mehr'
    );
  });

  it('zieht ein geändertes Kürzel mit', () => {
    db.updateMushroomStrain(d, id, { kuerzel: 'IGEL' });
    assert.equal(db.readBatchById(d, 'LM-010826-01').species, 'Igelstachelbart (IGEL)');
  });

  it('lässt den freien Strain-Text der Charge in Ruhe', () => {
    // Er gehört der Charge und nicht der Sorte: Wie eine Sorte heißt, sagt
    // nichts darüber, welche Linie im April in einen bestimmten Beutel ging.
    assert.equal(db.readBatchById(d, 'LM-010826-01').strain, 'Pride', 'überschrieben wäre er unwiederbringlich weg');
  });

  it('lässt Chargen anderer Sorten unberührt', () => {
    const fremd = db.createMushroomStrain(d, { name: 'Shiitake', kuerzel: 'SHIT' });
    charge(d, 'SHIT-010826-01', fremd, 'Shiitake (SHIT)', 'XXX');
    db.updateMushroomStrain(d, id, { name: 'Löwenmähne' });
    assert.equal(db.readBatchById(d, 'SHIT-010826-01').species, 'Shiitake (SHIT)');
    assert.equal(db.readBatchById(d, 'SHIT-010826-01').strain, 'XXX');
  });
});
