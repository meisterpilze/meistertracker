'use strict';
// withSavepoint: alles oder nichts, auch in einer Transaktion, die schon laeuft.
//
// Der Verlauf des Laborbuchs, die Zuordnung von Kanal-Artikeln und der Import
// von Bestellungen schrieben dasselbe Muster dreimal von Hand. Hier steht, was
// es leisten muss.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

describe('withSavepoint', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_savepoint_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    d.exec('CREATE TABLE sp_probe(x INTEGER)');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });
  const zahl = () => d.prepare('SELECT COUNT(*) AS c FROM sp_probe').get().c;

  it('gibt das Ergebnis zurueck und behaelt, was geschrieben wurde', () => {
    const r = db.withSavepoint(d, 'sp_test', () => {
      d.prepare('INSERT INTO sp_probe(x) VALUES(1)').run();
      return 'fertig';
    });
    assert.equal(r, 'fertig');
    assert.equal(zahl(), 1);
    assert.equal(d.isTransaction, false, 'no transaction is left open');
  });

  it('nimmt bei einem Fehler alles zurueck und wirft den ersten Fehler weiter', () => {
    assert.throws(
      () =>
        db.withSavepoint(d, 'sp_test', () => {
          d.prepare('INSERT INTO sp_probe(x) VALUES(2)').run();
          throw new Error('der eigentliche Grund');
        }),
      /der eigentliche Grund/
    );
    assert.equal(zahl(), 1);
    assert.equal(d.isTransaction, false);
  });

  it('verschachtelt sich in eine laufende Transaktion', () => {
    d.exec('BEGIN');
    d.prepare('INSERT INTO sp_probe(x) VALUES(3)').run();
    assert.throws(() =>
      db.withSavepoint(d, 'sp_test', () => {
        d.prepare('INSERT INTO sp_probe(x) VALUES(4)').run();
        throw new Error('innen');
      })
    );
    assert.equal(d.isTransaction, true, 'the outer transaction is still there');
    d.exec('COMMIT');
    assert.deepEqual(
      d
        .prepare('SELECT x FROM sp_probe ORDER BY x')
        .all()
        .map((z) => z.x),
      [1, 3],
      'only the inner write was undone'
    );
  });
});
