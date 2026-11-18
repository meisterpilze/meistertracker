'use strict';
// Die sterilen Beutel im Regal sind dieselben, die beimpft werden. Steht ein
// Regal-Artikel fuer eine Beutelgroesse Koernerbrut, nimmt eine neue Charge in
// dieser Groesse ihre Beutel aus ihm; geloescht legt sie sie zurueck. Diese
// Tests halten fest, wann gebucht wird und wann nicht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_regal_kb_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

let nr = 0;
// Eine Charge Koernerbrut mit Beuteln je Groesse: { 1: 3, 2: 2 } = drei 1-kg- und
// zwei 2-kg-Beutel. Die Kennungen sind erfunden.
function charge(d, groessen, extra = {}) {
  const batchId = 'G-TEST-' + String(++nr).padStart(4, '0');
  const bags = [];
  for (const [kg, n] of Object.entries(groessen))
    for (let i = 0; i < n; i++) bags.push({ id: batchId + '-' + String(bags.length + 1).padStart(2, '0'), bagKg: +kg });
  const now = new Date();
  const res = db.insertBatch(
    d,
    {
      batchId,
      species: 'Testpilz',
      qty: bags.length,
      days: 14,
      bagKg: bags[0].bagKg,
      batchType: 'grain',
      created: now.toISOString(),
      due: new Date(now.getTime() + 14 * 864e5).toISOString(),
      bags,
      shelfDraw: true,
      ...extra
    },
    [],
    null
  );
  return { batchId, bags, res };
}

const stock = (d, id) => db.getShelfItem(d, id).stock;

describe('Regal und Koernerbrut', () => {
  let d, p, eins, zwei;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    eins = db.createShelfItem(d, 'Testweizen 1 kg');
    zwei = db.createShelfItem(d, 'Testweizen 2 kg');
    db.moveShelfStock(d, eins.id, { count: 10 }, null);
    db.moveShelfStock(d, zwei.id, { count: 10 }, null);
    // Verknuepft vor jeder Charge in diesen Tests.
    db.updateShelfItem(d, eins.id, { spawnKg: 1 });
    db.updateShelfItem(d, zwei.id, { spawnKg: 2 });
    d.prepare("UPDATE shelf_items SET spawn_linked='2000-01-01T00:00:00.000Z'").run();
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('verknuepft eine Beutelgroesse mit genau einem Artikel', () => {
    assert.equal(db.getShelfItem(d, eins.id).spawnKg, 1);
    const drei = db.createShelfItem(d, 'Testweizen Doppelt');
    assert.throws(() => db.updateShelfItem(d, drei.id, { spawnKg: 1 }), /nimmt schon aus „Testweizen 1 kg“/);
    assert.throws(() => db.updateShelfItem(d, drei.id, { spawnKg: -1 }), /Beutelgröße/);
    assert.equal(db.updateShelfItem(d, drei.id, { spawnKg: 5 }).spawnKg, 5);
    assert.equal(db.updateShelfItem(d, drei.id, { spawnKg: null }).spawnKg, null);
    db.updateShelfItem(d, drei.id, { active: false });
  });

  it('nimmt beim Anlegen je Groesse die Beutel aus dem verknuepften Artikel', () => {
    const vorher1 = stock(d, eins.id);
    const vorher2 = stock(d, zwei.id);
    const { batchId, res } = charge(d, { 1: 3, 2: 2, 5: 1 });
    assert.equal(stock(d, eins.id), vorher1 - 3);
    assert.equal(stock(d, zwei.id), vorher2 - 2);
    // 5 kg haengt an keinem Artikel: nichts genommen, kein Fehler.
    assert.deepEqual(res.shelfMoves.map((m) => [m.name, m.delta]).sort(), [
      ['Testweizen 1 kg', -3],
      ['Testweizen 2 kg', -2]
    ]);
    const log = db.listShelfLog(d, eins.id, 1)[0];
    assert.deepEqual([log.kind, log.delta, log.ref], ['spawn', -3, batchId]);
  });

  it('nimmt nichts bei Bestand aus der Inventur und nichts fuer Bloecke', () => {
    const vorher = stock(d, eins.id);
    const inventur = charge(d, { 1: 4 }, { shelfDraw: false });
    assert.deepEqual(inventur.res.shelfMoves, []);
    const block = charge(d, { 1: 2 }, { batchType: 'block' });
    assert.deepEqual(block.res.shelfMoves, []);
    assert.equal(stock(d, eins.id), vorher);
    assert.equal(db.syncShelfSpawn(d), 0);
    assert.equal(stock(d, eins.id), vorher);
  });

  it('nimmt fuer ergaenzte Beutel mit und legt beim Loeschen alles zurueck', () => {
    const vorher = stock(d, eins.id);
    const { batchId } = charge(d, { 1: 2 });
    const add = db.addBagsToBatch(d, batchId, [batchId + '-03'], 3, 1, null);
    assert.deepEqual(
      add.shelfMoves.map((m) => m.delta),
      [-1]
    );
    assert.equal(stock(d, eins.id), vorher - 3);
    db.deleteBatchById(d, batchId, null);
    assert.equal(stock(d, eins.id), vorher);
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM shelf_spawn_booked WHERE batch_id=?').get(batchId).n, 0);
    const back = db.listShelfLog(d, eins.id, 1)[0];
    assert.deepEqual([back.kind, back.delta, back.ref], ['spawn', 3, batchId]);
    assert.equal(db.syncShelfSpawn(d), 0, 'ein zweiter Lauf bucht nichts');
  });

  it('darf unter 0 gehen, und Rueckgaengig nimmt eine Charge nicht zurueck', () => {
    db.moveShelfStock(d, zwei.id, { count: 1 }, null);
    charge(d, { 2: 3 });
    assert.equal(stock(d, zwei.id), -2);
    const row = db.listShelfLog(d, zwei.id, 1)[0];
    assert.throws(() => db.undoShelfMove(d, row.id, null), /Charge gelöscht/);
  });

  it('nimmt keine Charge nachtraeglich, die vor dem Verknuepfen angelegt wurde', () => {
    const neu = db.createShelfItem(d, 'Testweizen 5 kg');
    db.moveShelfStock(d, neu.id, { count: 6 }, null);
    const { batchId } = charge(d, { 5: 2 });
    d.prepare("UPDATE batches SET shelf_draw='2001-01-01T00:00:00.000Z' WHERE batch_id=?").run(batchId);
    db.updateShelfItem(d, neu.id, { spawnKg: 5 });
    assert.equal(db.syncShelfSpawn(d), 0);
    assert.equal(stock(d, neu.id), 6);
    // Die naechste Charge nimmt.
    charge(d, { 5: 2 });
    assert.equal(stock(d, neu.id), 4);
  });

  it('legt zurueck, wohin es genommen hat, auch wenn die Groesse umgehaengt ist', () => {
    const vorher = stock(d, eins.id);
    const { batchId } = charge(d, { 1: 2 });
    const anderer = db.createShelfItem(d, 'Testweizen 1 kg Neu');
    db.updateShelfItem(d, eins.id, { spawnKg: null });
    db.updateShelfItem(d, anderer.id, { spawnKg: 1 });
    db.deleteBatchById(d, batchId, null);
    assert.equal(stock(d, eins.id), vorher);
    assert.equal(stock(d, anderer.id), 0);
  });

  it('der Lauf alle 15 Minuten legt zurueck, was an deleteBatchById vorbei geloescht wurde', () => {
    const anderer = db.listShelfItems(d).find((x) => x.name === 'Testweizen 1 kg Neu');
    const vorher = stock(d, anderer.id);
    const { batchId } = charge(d, { 1: 4 });
    assert.equal(stock(d, anderer.id), vorher - 4);
    d.prepare('DELETE FROM batches WHERE batch_id=?').run(batchId);
    assert.equal(db.syncShelfSpawn(d), 1);
    assert.equal(stock(d, anderer.id), vorher);
  });
});
