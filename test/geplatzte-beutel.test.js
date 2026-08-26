'use strict';
// Wie viele Beutel im Autoklav geplatzt sind.
//
// Beutel platzen unter dem Druck, und die Frage dahinter ist nicht "dieser eine
// Ansatz", sondern wie oft es passiert — bei welchem Rezept, welcher Füllmenge,
// welcher Lieferung Pellets. Bisher ließ sich das nur in den Kommentar
// schreiben, und ein Kommentar lässt sich nicht zählen.
//
// Der Test, auf den es ankommt, ist der erste: 0 ist eine Antwort, keine Lücke.
// Die Ist-Feuchte nebenan ist bewusst NULL, solange niemand gemessen hat — dort
// wäre 0 % eine Behauptung. Hier wird ein Ereignis gezählt, und ein Ansatz, an
// dem niemand etwas eingetragen hat, ist einer, an dem nichts geplatzt ist.
// Wäre das NULL, müsste jede Auswertung "unbekannt" von "keins" trennen und
// könnte die Frage gar nicht beantworten.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_burst_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

describe('geplatzte Beutel am Ansatz', () => {
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
      recBagKg: 4.3,
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
    db.createSubstrateBatch(d, { subId: 'BURST-1', recipeStrainId: bo, targetKg: 100 }, uid);
    db.createSubstrateBatch(d, { subId: 'BURST-2', recipeStrainId: bo, targetKg: 20 }, uid);
  });

  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('ein frischer Ansatz hat keine geplatzten Beutel — 0, nicht null', () => {
    const s = db.getSubstrateBatch(d, 'BURST-1');
    assert.equal(s.burstBags, 0);
    // Der Unterschied zur Nachbarspalte, ausdrücklich: die Messung ist offen,
    // die Zählung ist beantwortet.
    assert.equal(s.actualRhPct, null);
  });

  it('hält die Zahl fest', () => {
    const r = db.setSubstrateBurstBags(d, 'BURST-1', 4);
    assert.equal(r.burstBags, 4);
    assert.equal(db.getSubstrateBatch(d, 'BURST-1').burstBags, 4);
  });

  it('taucht auch in der Liste auf, nicht nur in der Einzelansicht', () => {
    // Die Übersicht rechnet die Bilanz über die Liste; käme die Zahl dort nicht
    // an, stünde sie in der Karte und nirgends sonst.
    const s = db.listSubstrateBatches(d).find((x) => x.subId === 'BURST-1');
    assert.equal(s.burstBags, 4);
  });

  it('lässt alles andere am Ansatz in Ruhe', () => {
    // Geplatzte Beutel sind eine Beobachtung, keine Buchung: das Substrat war
    // gemischt und gebucht, bevor es in den Autoklav ging.
    const s = db.getSubstrateBatch(d, 'BURST-1');
    assert.equal(s.remainingKg, 100);
    assert.equal(s.status, 'open');
    assert.equal(s.notes, '');
  });

  it('nimmt keinen Tippfehler als Zahl an', () => {
    assert.throws(() => db.setSubstrateBurstBags(d, 'BURST-1', 2.5), /ganze Zahl/);
    assert.throws(() => db.setSubstrateBurstBags(d, 'BURST-1', -1), /negativ/);
    assert.throws(() => db.setSubstrateBurstBags(d, 'BURST-1', 'vier'), /muss eine Zahl sein/);
    // Und der zuletzt gültige Wert steht noch.
    assert.equal(db.getSubstrateBatch(d, 'BURST-1').burstBags, 4);
  });

  it('lässt nicht mehr Beutel platzen, als der Ansatz füllen kann', () => {
    // 20 kg Ansatz, und ein Beutel unter 1 kg ist kein Block. 40 ist dann kein
    // Zählergebnis, sondern eine verrutschte Null.
    assert.throws(() => db.setSubstrateBurstBags(d, 'BURST-2', 40), /höchstens 20|hoechstens 20/);
    // Die Schranke wächst mit dem Ansatz — dieselbe Zahl geht am großen durch.
    assert.equal(db.setSubstrateBurstBags(d, 'BURST-1', 40).burstBags, 40);
    db.setSubstrateBurstBags(d, 'BURST-1', 4);
  });

  it('setzt auf 0 zurück, wenn das Feld leer bleibt', () => {
    // Der Weg zurück, wenn die Zahl am falschen Ansatz landete. Kein zweiter
    // Knopf daneben, wie beim Löschen der Messung nebenan.
    assert.equal(db.setSubstrateBurstBags(d, 'BURST-1', '').burstBags, 0);
    assert.equal(db.getSubstrateBatch(d, 'BURST-1').burstBags, 0);
  });

  it('meldet einen unbekannten Ansatz, statt still nichts zu tun', () => {
    assert.equal(db.setSubstrateBurstBags(d, 'GIBTSNICHT', 1), null);
  });

  it('gibt jedem Ansatz, den es schon gab, eine 0 statt einer Leerstelle', () => {
    // Die Migration. NOT NULL DEFAULT 0 heißt: die Bilanz über alle Ansätze
    // stimmt ab dem ersten Tag, ohne dass jemand alte Zeilen nachpflegt.
    const spalte = d.prepare("SELECT * FROM pragma_table_info('substrate_batches') WHERE name='burst_bags'").get();
    assert.ok(spalte, 'die Spalte fehlt — Migration 83 ist nicht gelaufen');
    assert.equal(spalte.notnull, 1);
    assert.equal(Number(spalte.dflt_value), 0);
    assert.equal(
      d.prepare('SELECT COUNT(*) AS c FROM substrate_batches WHERE burst_bags IS NULL').get().c,
      0,
      'ein Ansatz ohne Zahl wäre in jeder Auswertung ein Sonderfall'
    );
  });
});
