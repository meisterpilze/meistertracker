'use strict';
// Versuche und ihre Ansaetze.
//
// Was hier wirklich auf dem Spiel steht, ist nicht das Anlegen, sondern das
// Wiederfinden: ein Laborbuch taugt nur, wenn der Lauf von vorletztem Monat in
// zwei Jahren noch dasteht — mit seinen Zahlen und seinem Ausgang. Deshalb
// prueft dieser Test vor allem, dass nichts still verschwindet: ein
// abgeschlossener Versuch behaelt seine Ansaetze, ein archivierter auch, und
// ein Ausgang, den niemand kennt, wird abgelehnt statt gespeichert.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

describe('Versuche', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_versuche_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('legt einen Versuch an und gibt ihn mit leerer Ansatzliste zurueck', () => {
    const id = db.insertExperiment(d, { code: 'V1', title: 'Erster Ansatz', started: '2026-09-10' });
    const v = db.listExperiments(d).find((x) => x.id === id);
    assert.equal(v.code, 'V1');
    assert.equal(v.status, 'running');
    assert.equal(v.archived, false);
    assert.deepEqual(v.runs, []);
  });

  it('besteht auf Code und Titel', () => {
    assert.throws(() => db.insertExperiment(d, { code: 'V9' }), /required/);
    assert.throws(() => db.insertExperiment(d, { title: 'ohne Code' }), /required/);
  });

  it('laesst denselben Code kein zweites Mal zu', () => {
    // Zwei Versuche "V1" waeren zwei Laufbuecher unter einem Namen, und beim
    // Nachschlagen faende man das falsche.
    assert.throws(() => db.insertExperiment(d, { code: 'V1', title: 'noch einer' }));
  });

  it('haengt Ansaetze an und haelt ihre Reihenfolge', () => {
    const v = db.listExperiments(d).find((x) => x.code === 'V1');
    db.insertExperimentRun(d, { experimentId: v.id, code: 'A-01', what: 'Ansatz A' });
    db.insertExperimentRun(d, { experimentId: v.id, code: 'A-02', what: 'Ansatz A' });
    db.insertExperimentRun(d, { experimentId: v.id, code: 'B-01', what: 'Ansatz B' });
    const runs = db.listExperiments(d).find((x) => x.id === v.id).runs;
    assert.deepEqual(
      runs.map((r) => r.code),
      ['A-01', 'A-02', 'B-01']
    );
    assert.equal(runs[0].outcome, 'open');
  });

  it('nimmt keinen Ansatz zu einem Versuch, den es nicht gibt', () => {
    assert.throws(() => db.insertExperimentRun(d, { experimentId: 9999, code: 'X-01' }), /unknown experiment/);
  });

  it('schreibt Ergebnis und Ausgang', () => {
    const v = db.listExperiments(d).find((x) => x.code === 'V1');
    const r = v.runs.find((x) => x.code === 'A-01');
    db.updateExperimentRun(d, r.id, { result: 'Messwert, erfunden', outcome: 'contam' });
    const neu = db
      .listExperiments(d)
      .find((x) => x.id === v.id)
      .runs.find((x) => x.id === r.id);
    assert.equal(neu.result, 'Messwert, erfunden');
    assert.equal(neu.outcome, 'contam');
  });

  it('lehnt einen Ausgang ab, den niemand auswerten kann', () => {
    // Ein freies Textfeld hier hiesse: "kontaminiert", "kontam", "contam" und
    // "hin" stehen nebeneinander, und keine Auswertung zaehlt sie zusammen.
    const v = db.listExperiments(d).find((x) => x.code === 'V1');
    assert.throws(() => db.updateExperimentRun(d, v.runs[0].id, { outcome: 'hinueber' }), /invalid outcome/);
  });

  it('schliesst ab, ohne etwas wegzunehmen', () => {
    const v = db.listExperiments(d).find((x) => x.code === 'V1');
    db.updateExperiment(d, v.id, { status: 'done', ended: '2026-09-24', outcome: 'Test beendet.' });
    const nachher = db.listExperiments(d).find((x) => x.id === v.id);
    assert.equal(nachher.status, 'done');
    assert.equal(nachher.ended, '2026-09-24');
    assert.equal(nachher.outcome, 'Test beendet.');
    assert.equal(nachher.runs.length, 3, 'die Ansaetze bleiben am abgeschlossenen Versuch');
  });

  it('archiviert, und archiviert ist nicht geloescht', () => {
    const v = db.listExperiments(d).find((x) => x.code === 'V1');
    db.updateExperiment(d, v.id, { archived: true });
    const nachher = db.listExperiments(d).find((x) => x.id === v.id);
    assert.ok(nachher, 'der archivierte Versuch steht weiter in der Liste');
    assert.equal(nachher.archived, true);
    assert.equal(nachher.runs.length, 3);
    assert.equal(nachher.runs.find((r) => r.code === 'A-01').result, 'Messwert, erfunden');
  });

  it('kennt nur Zustaende, die die Oberflaeche zeichnen kann', () => {
    const v = db.listExperiments(d).find((x) => x.code === 'V1');
    assert.throws(() => db.updateExperiment(d, v.id, { status: 'irgendwas' }), /invalid status/);
  });

  it('loescht einen Ansatz, der falsch angelegt war', () => {
    const id = db.insertExperiment(d, { code: 'V2', title: 'Zweiter Ansatz' });
    const r = db.insertExperimentRun(d, { experimentId: id, code: 'TIPPFEHLER' });
    assert.equal(db.deleteExperimentRun(d, r), true);
    assert.deepEqual(db.listExperiments(d).find((x) => x.id === id).runs, []);
  });

  it('nimmt die Ansaetze mit, wenn ein Versuch doch verschwindet', () => {
    // Ueber die Oberflaeche gibt es diesen Weg nicht — aber die Fremdschluessel
    // muessen trotzdem stimmen, sonst bleiben verwaiste Zeilen liegen, die in
    // keiner Liste mehr auftauchen und trotzdem mitgezaehlt werden.
    const id = db.insertExperiment(d, { code: 'V3', title: 'Dritter' });
    db.insertExperimentRun(d, { experimentId: id, code: 'Z-01' });
    d.prepare('DELETE FROM experiments WHERE id=?').run(id);
    const uebrig = d.prepare('SELECT COUNT(*) AS c FROM experiment_runs WHERE experiment_id=?').get(id);
    assert.equal(uebrig.c, 0);
  });

  it('haengt Fotos an den Versuch und gibt sie mit der Liste zurueck', () => {
    const v = db.listExperiments(d).find((x) => x.code === 'V1');
    const id = db.addExperimentPhoto(d, v.id, v.runs[0].id, {
      uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      rel_path: 'photos/2026/09/exp-1/a.jpg',
      thumb_path: 'photos/2026/09/exp-1/a_thumb.jpg',
      width: 1280,
      height: 960,
      bytes: 123456,
      sha256: 'x'.repeat(64),
      uploaded_at: '2026-09-24T09:15:00.000Z',
      uploaded_by: null
    });
    const nachher = db.listExperiments(d).find((x) => x.id === v.id);
    assert.equal(nachher.photos.length, 1);
    // Datum UND Uhrzeit: bei einem Lauf ueber vierzehn Tage ist "wann" die
    // halbe Information, und ein Datum allein beantwortet sie nicht.
    assert.equal(nachher.photos[0].uploadedAt, '2026-09-24T09:15:00.000Z');
    assert.equal(nachher.photos[0].runId, v.runs[0].id);
    assert.ok(nachher.photos[0].uuid, 'die Kennung kommt mit, sonst laedt kein Bild');
    assert.equal(db.getExperimentPhotoByUuid(d, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee').id, id);
  });

  it('gibt beim Loeschen die Zeile zurueck, damit die Datei mitgeht', () => {
    // Die Platte ist nicht Teil der Transaktion. Wer loescht, muss erfahren,
    // welche Datei jetzt niemandem mehr gehoert — sonst waechst data/photos
    // weiter, waehrend die Anwendung nichts mehr davon weiss.
    const v = db.listExperiments(d).find((x) => x.code === 'V1');
    const zeile = db.deleteExperimentPhoto(d, v.photos[0].id);
    assert.equal(zeile.rel_path, 'photos/2026/09/exp-1/a.jpg');
    assert.equal(zeile.thumb_path, 'photos/2026/09/exp-1/a_thumb.jpg');
    assert.equal(db.deleteExperimentPhoto(d, 999999), null);
    assert.deepEqual(db.listExperiments(d).find((x) => x.id === v.id).photos, []);
  });

  it('reicht die Versuche mit der Nutzlast an die Oberflaeche durch', () => {
    const daten = db.readAll(d);
    assert.ok(Array.isArray(daten.experiments), 'readAll traegt experiments');
    assert.ok(daten.experiments.some((v) => v.code === 'V1'));
  });
});
