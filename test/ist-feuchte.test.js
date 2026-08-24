'use strict';
// Soll-Feuchte und Ist-Feuchte sind zwei Zahlen, nicht eine.
//
// Die Karte des Ansatzes zeigte eine Zeile "Ist-Feuchte" und darin den Wert aus
// computeMixBatch — also das, was das Rezept vorgibt, unter dem Namen dessen,
// was gemessen wurde. Wer nach dem Mischen nachmass, fand seine eigene Messung
// dem Namen nach schon dort stehen und hatte für das Ergebnis keinen Platz.
//
// Der Test, auf den es ankommt, ist der dritte: die Messung darf den Rezeptwert
// nicht anfassen. Ein Ansatz ist gemischt, und was er treffen sollte, ändert sich
// nicht rückwirkend dadurch, dass er es nicht getroffen hat.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_rh_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

describe('gemessene Ist-Feuchte am Ansatz', () => {
  let d, p, bo, uid;

  before(() => {
    ({ db: d, path: p } = tmpDb());
    d.prepare('INSERT INTO users(username,hash,salt,role,created) VALUES(?,?,?,?,?)').run(
      'Jonas',
      'h',
      's',
      'admin',
      new Date().toISOString()
    );
    uid = d.prepare("SELECT id FROM users WHERE username='Jonas'").get().id;
    bo = db.createMushroomStrain(d, {
      name: 'Blue Oyster',
      kuerzel: 'BO',
      recBatchType: 'block',
      recSubstrate: 'holzkleie',
      recBagKg: 5,
      recHardwoodPct: 79,
      recWheatbranPct: 20,
      recCornPct: 0,
      recGypsumPct: 1,
      recRhPct: 62,
      recSpawnPct: 5,
      recIncDays: 60
    });
    for (const [mat, v] of [
      ['hardwood', 600],
      ['wheatbran', 200],
      ['gypsum', 20],
      ['grain', 60]
    ]) {
      db.setInventoryAbsolute(d, mat, v, 'count', 'Inventur', uid);
    }
    db.createSubstrateBatch(d, { subId: 'RH-1', recipeStrainId: bo, targetKg: 100 }, uid);
  });

  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('ein frischer Ansatz ist noch nicht gemessen', () => {
    const s = db.getSubstrateBatch(d, 'RH-1');
    // null, nicht 0: sonst stünde jeder Altbestand als knochentrocken gemessen da.
    assert.equal(s.actualRhPct, null);
    assert.equal(s.actualRhAt, null);
    assert.equal(s.actualRhBy, null);
    // Und der Rezeptwert ist da, wo er immer war.
    assert.equal(s.moisturePct.toFixed(1), '62.0');
  });

  it('hält Zahl, Zeitpunkt und Person fest', () => {
    const r = db.setSubstrateMoisture(d, 'RH-1', 58.4, uid);
    assert.equal(r.actualRhPct, 58.4);
    const s = db.getSubstrateBatch(d, 'RH-1');
    assert.equal(s.actualRhPct, 58.4);
    assert.equal(s.actualRhBy, 'Jonas');
    assert.match(s.actualRhAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('lässt die Soll-Feuchte in Ruhe', () => {
    // Der eigentliche Punkt: die beiden Zahlen werden nie ineinander gerechnet.
    const s = db.getSubstrateBatch(d, 'RH-1');
    assert.equal(s.moisturePct.toFixed(1), '62.0');
    assert.notEqual(s.moisturePct, s.actualRhPct);
  });

  it('rundet auf eine Nachkommastelle', () => {
    db.setSubstrateMoisture(d, 'RH-1', 61.2666, uid);
    assert.equal(db.getSubstrateBatch(d, 'RH-1').actualRhPct, 61.3);
  });

  it('nimmt keinen Tippfehler als Messwert an', () => {
    // 650 statt 65 ist die Eingabe, gegen die die Grenze steht.
    assert.throws(() => db.setSubstrateMoisture(d, 'RH-1', 650, uid), /zwischen 0 und 100/);
    assert.throws(() => db.setSubstrateMoisture(d, 'RH-1', -1, uid), /zwischen 0 und 100/);
    assert.throws(() => db.setSubstrateMoisture(d, 'RH-1', 'nass', uid), /muss eine Zahl sein/);
    // Und der zuletzt gültige Wert steht noch.
    assert.equal(db.getSubstrateBatch(d, 'RH-1').actualRhPct, 61.3);
  });

  it('löscht die Messung wieder, samt Zeitpunkt und Person', () => {
    // Der Weg zurück, wenn die Messung am falschen Ansatz landete.
    db.setSubstrateMoisture(d, 'RH-1', null, uid);
    const s = db.getSubstrateBatch(d, 'RH-1');
    assert.equal(s.actualRhPct, null);
    assert.equal(s.actualRhAt, null);
    assert.equal(s.actualRhBy, null);
  });

  it('kommt auch ohne angemeldete Person aus, wie auf dem MCP-Weg', () => {
    db.createSubstrateBatch(d, { subId: 'RH-2', recipeStrainId: bo, targetKg: 40 }, null);
    db.setSubstrateMoisture(d, 'RH-2', 60, null);
    const s = db.getSubstrateBatch(d, 'RH-2');
    assert.equal(s.actualRhPct, 60);
    assert.equal(s.actualRhBy, null);
    // Die Messung ist vollständig, sie hat nur niemanden.
    assert.match(s.actualRhAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('meldet einen unbekannten Ansatz, statt still nichts zu tun', () => {
    assert.equal(db.setSubstrateMoisture(d, 'GIBTSNICHT', 60, uid), null);
  });

  it('taucht auch in der Liste auf, nicht nur in der Einzelansicht', () => {
    const s = db.listSubstrateBatches(d).find((x) => x.subId === 'RH-2');
    assert.equal(s.actualRhPct, 60);
  });
});
