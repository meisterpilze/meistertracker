'use strict';
// Eine Charge umbenennen, auf die eine Bestellung zeigt.
//
// renameBatch schiebt die Fremdschluessel-Pruefung ans COMMIT und zieht jede
// Tabelle mit, die auf die alte Kennung zeigt. Die Zuordnungen von Bestellungen
// zu Chargen fehlten dabei: eine Charge, fuer die etwas reserviert war, liess
// sich nicht umbenennen, und die Antwort war ein 500.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

describe('renameBatch mit Bestellzuordnung', () => {
  it('nimmt die Zuordnung mit', () => {
    const p = path.join(
      os.tmpdir(),
      'mt_charge_umbenennen_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db'
    );
    const d = db.openDb(p);
    try {
      const jetzt = new Date().toISOString();
      d.prepare('INSERT INTO batches(batch_id,species,qty,days,created,due) VALUES(?,?,?,?,?,?)').run(
        'B-7',
        'Testpilz',
        1,
        10,
        jetzt,
        jetzt
      );
      const bestellung = d
        .prepare('INSERT INTO orders(channel,channel_order_id,imported,updated) VALUES(?,?,?,?)')
        .run('manual', 'X-1', jetzt, jetzt).lastInsertRowid;
      const posten = d.prepare('INSERT INTO order_items(order_id) VALUES(?)').run(bestellung).lastInsertRowid;
      d.prepare('INSERT INTO order_allocations(order_item_id,batch_id,qty,created) VALUES(?,?,?,?)').run(
        posten,
        'B-7',
        2,
        jetzt
      );
      db.renameBatch(d, 'B-7', 'B-7b');
      assert.equal(
        d.prepare('SELECT batch_id FROM order_allocations WHERE order_item_id=?').get(posten).batch_id,
        'B-7b'
      );
      assert.ok(d.prepare("SELECT 1 FROM batches WHERE batch_id='B-7b'").get());
    } finally {
      d.close();
      for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
    }
  });
});
