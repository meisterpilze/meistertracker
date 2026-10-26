'use strict';
// Gute Blöcke und Notizen je Block.
//
// Worauf es ankommt: wer einen Block in der Fruchtung für gut befindet, will
// später wissen, woraus er gemacht war — Ansatz und Feuchte, Körnerbrut und ihre
// Feuchte. Das muss auch dann noch stehen, wenn die Charge längst gelöscht ist,
// und es muss die Messung zeigen, die nach dem Markieren dazukam.
//
// Alle Kennungen hier sind erfunden.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_bb_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

describe('Blockbuch', () => {
  let d, p;
  const now = new Date().toISOString();

  before(() => {
    ({ db: d, path: p } = tmpDb());
    d.prepare(
      `INSERT INTO substrate_batches(sub_id, recipe_label, target_kg, remaining_kg, hardwood_pct, wheatbran_pct, rh_pct, moisture_pct, created)
       VALUES('SUB-TEST-01', 'Testrezept', 100, 0, 80, 20, 60, 60, ?)`
    ).run(now);
    const subId = d.prepare("SELECT id FROM substrate_batches WHERE sub_id='SUB-TEST-01'").get().id;
    const batch = d.prepare(
      `INSERT INTO batches(batch_id, species, strain, qty, days, batch_type, source_id, created, due, grain_rh, substrate_batch_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    );
    batch.run('GRAIN-TEST', 'Testpilz', '', 2, 14, 'grain', 'LC-TEST', now, now, 50, null);
    batch.run('BLOCK-TEST', 'Testpilz', 'Teststamm', 2, 30, 'block', null, now, now, 0, subId);
    const bag = d.prepare('INSERT INTO bags(bag_id, batch_id) VALUES(?,?)');
    bag.run('GRAIN-TEST-01', 'GRAIN-TEST');
    bag.run('GRAIN-TEST-02', 'GRAIN-TEST');
    bag.run('BLOCK-TEST-01', 'BLOCK-TEST');
    bag.run('BLOCK-TEST-02', 'BLOCK-TEST');
    const scan = d.prepare(
      "INSERT INTO scan_log(time, action, batch, bag, reason) VALUES(?, 'REMOVE', 'GRAIN-TEST', ?, 'spawn:BLOCK-TEST')"
    );
    scan.run(now, 'GRAIN-TEST-01');
    scan.run(now, 'GRAIN-TEST-02');
    d.prepare(
      "INSERT INTO harvests(time, batch, bag, grams, flush) VALUES(?, 'BLOCK-TEST', 'BLOCK-TEST-01', 400, 1)"
    ).run(now);
  });

  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('liest die Herkunft: Ansatz mit Soll-Feuchte und die Körnerbrut mit ihrer', () => {
    const l = db.blockLineage(d, 'BLOCK-TEST');
    assert.equal(l.substrate.subId, 'SUB-TEST-01');
    assert.equal(l.substrate.targetRh, 60);
    assert.equal(l.substrate.actualRh, null);
    assert.deepEqual(l.grain, [{ batchId: 'GRAIN-TEST', rh: 50, culture: 'LC-TEST', bags: 2 }]);
    assert.equal(l.strain, 'Teststamm');
  });

  it('markiert gut, ohne auf die Schreibweise des Beutels zu achten', () => {
    assert.equal(db.setBlockGood(d, 'block-test-01', true, 'erika'), true);
    const [e] = db.listBlockNotes(d);
    assert.equal(e.bagId, 'BLOCK-TEST-01');
    assert.equal(e.good, true);
    assert.equal(e.goodBy, 'erika');
  });

  it('kennt keinen Beutel, den es nicht gibt', () => {
    assert.equal(db.setBlockGood(d, 'GIBT-ES-NICHT', true, 'erika'), false);
    assert.equal(db.addBlockComment(d, 'GIBT-ES-NICHT', 'x', 'erika'), null);
  });

  it('zeigt eine spätere Messung und die Ernte im Blockbuch', () => {
    d.prepare("UPDATE substrate_batches SET actual_rh_pct = 58.5 WHERE sub_id = 'SUB-TEST-01'").run();
    const [e] = db.getBlockBook(d);
    assert.equal(e.live, true);
    assert.equal(e.lineage.substrate.actualRh, 58.5);
    assert.equal(e.harvestG, 400);
    assert.equal(e.harvestCount, 1);
  });

  it('eine Notiz beim Ernten trägt die Welle', () => {
    const id = db.addBlockComment(d, 'BLOCK-TEST-02', 'Testnotiz', 'max', 2);
    assert.ok(id > 0);
    const e = db.listBlockNotes(d).find((x) => x.bagId === 'BLOCK-TEST-02');
    assert.equal(e.good, false);
    assert.equal(e.comments.length, 1);
    assert.equal(e.comments[0].flush, 2);
    assert.equal(e.comments[0].by, 'max');
  });

  it('ohne Notiz und ohne gut verschwindet der Eintrag', () => {
    const e = db.listBlockNotes(d).find((x) => x.bagId === 'BLOCK-TEST-02');
    assert.equal(db.deleteBlockComment(d, e.comments[0].id), true);
    assert.equal(
      db.listBlockNotes(d).some((x) => x.bagId === 'BLOCK-TEST-02'),
      false
    );
    // Ein guter Block bleibt, auch wenn seine letzte Notiz geht.
    const id = db.addBlockComment(d, 'BLOCK-TEST-01', 'Testnotiz', 'max');
    db.deleteBlockComment(d, id);
    assert.equal(
      db.listBlockNotes(d).some((x) => x.bagId === 'BLOCK-TEST-01'),
      true
    );
  });

  it('behält die Herkunft, wenn die Charge gelöscht wird', () => {
    d.prepare("DELETE FROM batches WHERE batch_id = 'BLOCK-TEST'").run();
    const [e] = db.getBlockBook(d);
    assert.equal(e.live, false);
    assert.equal(e.lineage.substrate.subId, 'SUB-TEST-01');
    assert.equal(e.lineage.grain[0].rh, 50);
  });

  it('reist in /api/data mit', () => {
    const all = db.readAll(d);
    assert.ok(Array.isArray(all.blockNotes));
    assert.equal(all.blockNotes[0].bagId, 'BLOCK-TEST-01');
  });
});
