'use strict';
// Ein kontaminierter Block zieht in die Kontaminationszone.
//
// Vorher zog der Bericht nur bei "Größer" oder "Total" um, und das Formular
// stand auf "Klein": gemeldet wurde, umgezogen nie, und der Block zählte weiter
// als Bestand in der Inkubation. Jetzt schickt das Formular auto_move: true als
// Vorgabe, und der Server zieht um, wie schwer es auch ist.
//
// Beutel und Chargen hier sind ausgedacht.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { kontaminationsrouten } = require('./helpers/kontaminationsrouten');

describe('Kontamination melden zieht den Block um', () => {
  let r;
  beforeEach(() => {
    r = kontaminationsrouten();
  });
  afterEach(() => r.schliessen());

  const steht = (bag, to) =>
    r.db.appendScanEntries(r.database, [
      { time: new Date().toISOString(), action: 'ADD', batch: 'TA-081026-01', bag, from: null, to }
    ]);
  const zuletzt = (bag) =>
    r.database
      .prepare(
        'SELECT action, "from", "to" FROM scan_log WHERE bag = ? AND action IN (\'ADD\',\'MOVE\') ORDER BY id DESC'
      )
      .all(bag);
  const melden = (body) =>
    r.anfrage('POST', '/api/contamination-reports', { severity: 'minor', batch_id: 'TA-081026-01', ...body });

  it('auto_move: true zieht auch bei "Klein" um', async () => {
    steht('TA-081026-01-7', 'INC_R1');
    const a = await melden({ bag_id: 'TA-081026-01-7', auto_move: true });
    assert.equal(a.status, 200);
    assert.ok(a.json.autoMovedScanId);
    const [neu] = zuletzt('TA-081026-01-7');
    assert.deepEqual({ ...neu }, { action: 'MOVE', from: 'INC_R1', to: 'CONTAM' });
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
  });

  it('auto_move: false lässt ihn stehen, auch bei "Total"', async () => {
    steht('TA-081026-01-7', 'INC_R1');
    const a = await melden({ bag_id: 'TA-081026-01-7', auto_move: false, severity: 'lost' });
    assert.equal(a.status, 200);
    assert.equal(a.json.autoMovedCount, 0);
    assert.equal(zuletzt('TA-081026-01-7')[0].to, 'INC_R1');
  });

  it('ohne Angabe wie bisher: "Klein" bleibt, "Größer" zieht um', async () => {
    steht('TA-081026-01-7', 'INC_R1');
    steht('TA-081026-01-8', 'INC_R1');
    assert.equal((await melden({ bag_id: 'TA-081026-01-7' })).json.autoMovedCount, 0);
    assert.equal((await melden({ bag_id: 'TA-081026-01-8', severity: 'major' })).json.autoMovedCount, 1);
  });

  it('steht er schon in der Kontaminationszone, kommt kein zweiter Umzug dazu', async () => {
    steht('TA-081026-01-7', 'CONTAM');
    const a = await melden({ bag_id: 'TA-081026-01-7', auto_move: true });
    assert.equal(a.status, 200);
    assert.equal(a.json.autoMovedCount, 0);
    assert.equal(zuletzt('TA-081026-01-7').length, 1);
  });
});
