'use strict';
// Ein kontaminierter Block geht aus dem Bestand: er wird ausgebucht.
//
// Vorher zog der Bericht nur bei "Größer" oder "Total" um, und das Formular
// stand auf "Klein": gemeldet wurde, umgezogen nie, und der Block zählte weiter
// als Bestand in der Inkubation. Dann zog er in die Kontaminationszone und
// wartete dort, als wäre sie ein Raum. Jetzt schickt das Formular
// auto_move: true als Vorgabe, und der Server zeichnet den Block mit einem
// Umzug in die Kontaminationszone (daran zählen Kontaminationsrate und "Tage
// ohne Kontamination") und bucht ihn im selben Zug aus.
//
// Beutel und Chargen hier sind ausgedacht.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { kontaminationsrouten } = require('./helpers/kontaminationsrouten');

describe('Kontamination melden bucht den Block aus', () => {
  let r;
  beforeEach(() => {
    r = kontaminationsrouten();
  });
  afterEach(() => r.schliessen());

  const steht = (bag, to) =>
    r.db.appendScanEntries(r.database, [
      { time: new Date().toISOString(), action: 'ADD', batch: 'TA-081026-01', bag, from: null, to }
    ]);
  const raus = (bag, from) =>
    r.db.appendScanEntries(r.database, [
      { time: new Date().toISOString(), action: 'REMOVE', batch: 'TA-081026-01', bag, from, to: null, reason: 'auto' }
    ]);
  const zuletzt = (bag) =>
    r.database
      .prepare(
        'SELECT action, "from", "to" FROM scan_log WHERE bag = ? AND action IN (\'ADD\',\'MOVE\') ORDER BY id DESC'
      )
      .all(bag);
  // Alle Platz-Einträge eines Beutels, der neueste zuerst.
  const verlauf = (bag) =>
    r.database
      .prepare(
        "SELECT action, \"from\", \"to\", reason FROM scan_log WHERE bag = ? AND action IN ('ADD','MOVE','MOVE_BATCH','REMOVE') ORDER BY id DESC"
      )
      .all(bag)
      .map((x) => ({ ...x }));
  const melden = (body) =>
    r.anfrage('POST', '/api/contamination-reports', { severity: 'minor', batch_id: 'TA-081026-01', ...body });

  it('auto_move: true bucht auch bei "Klein" aus, gezeichnet in der Kontaminationszone', async () => {
    steht('TA-081026-01-7', 'INC_R1');
    const a = await melden({ bag_id: 'TA-081026-01-7', auto_move: true });
    assert.equal(a.status, 200);
    assert.ok(a.json.autoMovedScanId);
    assert.equal(a.json.bookedOutCount, 1);
    const [aus, rein] = verlauf('TA-081026-01-7');
    assert.deepEqual(rein, { action: 'MOVE', from: 'INC_R1', to: 'CONTAM', reason: 'contam_unknown_other' });
    assert.deepEqual(aus, { action: 'REMOVE', from: 'CONTAM', to: null, reason: 'contam_unknown_other' });
    // Der Bericht zeigt auf den Umzug: daran hängt, woran er erkannt wurde.
    const bericht = r.database.prepare('SELECT scan_log_id FROM contamination_reports').get();
    assert.equal(bericht.scan_log_id, a.json.autoMovedScanId);
  });

  it('für mehrere Beutel einer Meldung, jeder einmal', async () => {
    steht('TA-081026-01-7', 'INC_R1');
    steht('TA-081026-01-8', 'INC_R1');
    const a = await melden({
      auto_move: true,
      bags: [
        { bag_id: 'TA-081026-01-7', batch_id: 'TA-081026-01', report_uuid: 'u-7' },
        { bag_id: 'TA-081026-01-8', batch_id: 'TA-081026-01', report_uuid: 'u-8' }
      ]
    });
    assert.equal(a.status, 200);
    assert.equal(a.json.autoMovedCount, 2);
    assert.equal(a.json.bookedOutCount, 2);
    for (const bag of ['TA-081026-01-7', 'TA-081026-01-8']) assert.equal(verlauf(bag)[0].action, 'REMOVE');
  });

  it('auto_move: false lässt ihn stehen, auch bei "Total"', async () => {
    steht('TA-081026-01-7', 'INC_R1');
    const a = await melden({ bag_id: 'TA-081026-01-7', auto_move: false, severity: 'lost' });
    assert.equal(a.status, 200);
    assert.equal(a.json.autoMovedCount, 0);
    assert.equal(a.json.bookedOutCount, 0);
    assert.equal(zuletzt('TA-081026-01-7')[0].to, 'INC_R1');
    assert.equal(verlauf('TA-081026-01-7').length, 1);
  });

  it('ohne Angabe wie bisher: "Klein" bleibt, "Größer" bucht aus', async () => {
    steht('TA-081026-01-7', 'INC_R1');
    steht('TA-081026-01-8', 'INC_R1');
    assert.equal((await melden({ bag_id: 'TA-081026-01-7' })).json.bookedOutCount, 0);
    assert.equal((await melden({ bag_id: 'TA-081026-01-8', severity: 'major' })).json.bookedOutCount, 1);
  });

  it('steht er noch in der Kontaminationszone (von früher), wird er nur ausgebucht', async () => {
    steht('TA-081026-01-7', 'CONTAM');
    const a = await melden({ bag_id: 'TA-081026-01-7', auto_move: true });
    assert.equal(a.status, 200);
    assert.equal(a.json.autoMovedCount, 0, 'kein zweiter Umzug');
    assert.equal(a.json.bookedOutCount, 1);
    assert.equal(zuletzt('TA-081026-01-7').length, 1);
    assert.deepEqual(verlauf('TA-081026-01-7')[0], {
      action: 'REMOVE',
      from: 'CONTAM',
      to: null,
      reason: 'contam_unknown_other'
    });
  });

  it('schon in der Zone gezeichnet und schon draußen: nichts kommt dazu', async () => {
    steht('TA-081026-01-7', 'CONTAM');
    raus('TA-081026-01-7', 'CONTAM');
    const a = await melden({ bag_id: 'TA-081026-01-7', auto_move: true });
    assert.equal(a.status, 200);
    assert.equal(a.json.bookedOutCount, 0);
    assert.equal(verlauf('TA-081026-01-7').length, 2);
  });

  it('schon ausgebucht, aber nie gezeichnet: er wird gezeichnet und bleibt draußen', async () => {
    steht('TA-081026-01-7', 'INC_R1');
    raus('TA-081026-01-7', 'INC_R1');
    const a = await melden({ bag_id: 'TA-081026-01-7', auto_move: true });
    assert.equal(a.status, 200);
    assert.equal(a.json.autoMovedCount, 1);
    const [aus, rein] = verlauf('TA-081026-01-7');
    assert.equal(rein.to, 'CONTAM');
    assert.equal(aus.action, 'REMOVE');
  });
});
