'use strict';
// Wenn eine Kultur oder Charge geht, steht es im Verlauf ihrer Gefaesse.
//
// Gefaesse verweisen per Fremdschluessel mit ON DELETE SET NULL auf Kulturen und
// Chargen. SQLite leert die Verknuepfung beim Loeschen still; der Verlauf erfuhr
// davon nichts, und sein naechster Eintrag begann bei einem Stand, der nirgends
// stand. Jeder Weg, der Kulturen oder Chargen loescht, schreibt deshalb vorher
// einen Eintrag je betroffenem Gefaess.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { quelle } = require('./helpers/quelle');

const ANNA = { user_id: 7, username: 'anna', role: 'admin' };

function neueDb() {
  const p = path.join(os.tmpdir(), 'mt_verknuepfung_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  const d = db.openDb(p);
  d.prepare('INSERT INTO users(id,username,hash,salt,role,created) VALUES(?,?,?,?,?,?)').run(
    ANNA.user_id,
    ANNA.username,
    'x',
    'y',
    'admin',
    new Date().toISOString()
  );
  const jetzt = new Date().toISOString();
  d.prepare('INSERT INTO cultures(id,type,created) VALUES(?,?,?)').run('K-1', 'LC', jetzt);
  d.prepare('INSERT INTO batches(batch_id,species,qty,days,created,due) VALUES(?,?,?,?,?,?)').run(
    'B-1',
    'Testpilz',
    1,
    10,
    jetzt,
    jetzt
  );
  const versuch = Number(db.insertExperiment(d, { code: 'T-1', title: 'Testversuch' }, ANNA));
  const ansatz = Number(
    db.insertExperimentRun(d, { experimentId: versuch, code: 'A-1', cultureId: 'K-1', batchId: 'B-1' }, ANNA)
  );
  return { p, d, ansatz };
}
function eintraege(d, ansatz) {
  return d
    .prepare(
      "SELECT field, old_value, new_value, username FROM lab_history WHERE entity='run' AND entity_id=? AND action='update' ORDER BY id"
    )
    .all(ansatz)
    .map((z) => ({ ...z }));
}

describe('Verlauf: Kultur und Charge gehen', () => {
  let p, d, ansatz;
  beforeEach(() => {
    ({ p, d, ansatz } = neueDb());
  });
  afterEach(() => {
    d.close();
    for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
  });

  it('haelt fest, wenn eine Kultur geloescht wird, und wer es war', () => {
    assert.equal(db.deleteCulture(d, 'K-1', ANNA), true);
    assert.equal(d.prepare('SELECT culture_id FROM experiment_runs WHERE id=?').get(ansatz).culture_id, null);
    assert.deepEqual(eintraege(d, ansatz), [
      { field: 'cultureId', old_value: 'K-1', new_value: null, username: 'anna' }
    ]);
  });

  it('haelt fest, wenn eine Charge geloescht wird', () => {
    db.deleteBatchById(d, 'B-1', ANNA.user_id);
    assert.deepEqual(eintraege(d, ansatz), [{ field: 'batchId', old_value: 'B-1', new_value: null, username: 'anna' }]);
  });

  it('haelt beim Neustart beide Verknuepfungen fest', () => {
    db.resetOperationalData(d, { growing: true }, ANNA);
    const r = d.prepare('SELECT culture_id, batch_id FROM experiment_runs WHERE id=?').get(ansatz);
    assert.deepEqual({ ...r }, { culture_id: null, batch_id: null });
    assert.deepEqual(
      eintraege(d, ansatz).map((e) => [e.field, e.old_value, e.new_value]),
      [
        ['batchId', 'B-1', null],
        ['cultureId', 'K-1', null]
      ]
    );
  });

  it('haelt fest, wenn der Gesamtstand eine Kultur weglaesst', () => {
    db.writeAll(d, { cultures: [] }, { allowEmpty: true, wer: ANNA });
    assert.deepEqual(
      eintraege(d, ansatz).map((e) => [e.field, e.old_value, e.username]),
      [['cultureId', 'K-1', 'anna']]
    );
  });

  it('schreibt nichts, wenn nichts an einem Gefaess haengt', () => {
    d.prepare('INSERT INTO cultures(id,type,created) VALUES(?,?,?)').run('K-2', 'LC', new Date().toISOString());
    db.deleteCulture(d, 'K-2', ANNA);
    assert.deepEqual(eintraege(d, ansatz), []);
  });
});

describe('Verlauf: Kultur und Charge werden umbenannt', () => {
  let p, d, ansatz;
  beforeEach(() => {
    ({ p, d, ansatz } = neueDb());
  });
  afterEach(() => {
    d.close();
    for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
  });

  it('nimmt das Gefaess mit, statt am Fremdschluessel zu scheitern', () => {
    db.renameCulture(d, 'K-1', 'K-1b', ANNA);
    db.renameBatch(d, 'B-1', 'B-1b', ANNA);
    const r = d.prepare('SELECT culture_id, batch_id FROM experiment_runs WHERE id=?').get(ansatz);
    assert.deepEqual({ ...r }, { culture_id: 'K-1b', batch_id: 'B-1b' });
    assert.deepEqual(
      eintraege(d, ansatz).map((e) => [e.field, e.old_value, e.new_value, e.username]),
      [
        ['cultureId', 'K-1', 'K-1b', 'anna'],
        ['batchId', 'B-1', 'B-1b', 'anna']
      ]
    );
  });

  it('nimmt auch ein entferntes Gefaess mit', () => {
    db.removeExperimentRun(d, ansatz, ANNA);
    db.renameCulture(d, 'K-1', 'K-1c', ANNA);
    assert.equal(d.prepare('SELECT culture_id FROM experiment_runs WHERE id=?').get(ansatz).culture_id, 'K-1c');
  });
});

describe('Verlauf: jeder Weg, der Kulturen oder Chargen loescht', () => {
  it('schreibt vorher den Verlauf der Gefaesse', () => {
    // Ein neuer Weg, der loescht, ohne _verknuepfungGeht zu rufen, faellt hier
    // auf, statt still am Verlauf vorbei zu laufen.
    const src = quelle('db.js');
    const funktionen = src.split(/\n(?=(?:async )?function )/);
    const loeschend = funktionen.filter((f) => /DELETE FROM (cultures|batches)\b|wipe\('(cultures|batches)'\)/.test(f));
    assert.ok(loeschend.length >= 4, 'the delete paths were found');
    for (const f of loeschend) {
      const name = f.match(/function (\w+)/)[1];
      assert.ok(f.includes('_verknuepfungGeht('), name + ' deletes cultures or batches without recording it');
    }
  });
});
