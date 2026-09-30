'use strict';
// Rückgängig after a move (the undo bar of "→ Fruchtung", the bulk move, the
// zone picker and the bag sheet) writes the way back as a MOVE with reason
// 'undo'. getZoneBags() reads the reason to give the bags their old move-in day
// back instead of "seit heute" (zone-bags-since.test.js has the cases), and the
// contamination report must not count the way back as contamination.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hebeFunktion } = require('./helpers/quelle');

const toZone = (l) => (l ? String(l).split('_')[0] : l);

function rig(scanLog) {
  const posted = [];
  const f = new Function(
    'scanLog',
    'posted',
    'toZone',
    `
    const movements = [];
    const sessionEntries = [];
    let sessionStartTime = 0;
    let _scanTempIdCounter = 0;
    let uuid = 0;
    const currentUser = { username: 'tester' };
    const scanChannel = null;
    const newScanUuid = () => 'u' + ++uuid;
    const rememberDest = () => {};
    const postScanEntries = (entries) => posted.push(...entries);
    const buildLastPlacementByBag = () => {
      const m = new Map();
      for (const e of scanLog) if (e.bag) m.set(e.bag.toUpperCase(), e);
      return m;
    };
    const updateSD = () => {};
    const renderBatches = () => {};
    const renderStatus = () => {};
    const renderDashBatchTasks = () => {};
    const flashUndoBar = () => {};
    const t = (k) => k;
    ${hebeFunktion('moveBagsTo')}
    ${hebeFunktion('_undoMove')}
    ${hebeFunktion('getZoneBags')}
    return { moveBagsTo, _undoMove, getZoneBags };
    `
  )(scanLog, posted, toZone);
  return { ...f, posted };
}

const batch = { batchId: 'BO-1', species: 'Blue Oyster', strain: 'BO', bags: ['BO-1-01', 'BO-1-02'] };
const placed = () => [
  { action: 'ADD', batch: 'BO-1', bag: 'BO-1-01', to: 'INC_R1', time: '2026-09-01T08:00:00.000Z' },
  { action: 'ADD', batch: 'BO-1', bag: 'BO-1-02', to: 'INC_R1', time: '2026-09-01T08:00:00.000Z' }
];

describe('Rückgängig after a move', () => {
  it('a move itself carries no reason', () => {
    const r = rig(placed());
    r.moveBagsTo(batch, ['BO-1-01', 'BO-1-02'], 'TENT1');
    assert.equal(r.posted.length, 2);
    for (const e of r.posted) assert.equal(e.reason, undefined);
  });

  it('writes the way back with reason "undo"', () => {
    const r = rig(placed());
    r.moveBagsTo(batch, ['BO-1-01', 'BO-1-02'], 'TENT1');
    r._undoMove([
      { batch, bag: 'BO-1-01', from: 'INC_R1' },
      { batch, bag: 'BO-1-02', from: 'INC_R1' }
    ]);
    const back = r.posted.slice(2);
    assert.equal(back.length, 2);
    for (const e of back) {
      assert.equal(e.action, 'MOVE');
      assert.equal(e.from, 'TENT1');
      assert.equal(e.to, 'INC_R1');
      assert.equal(e.reason, 'undo');
    }
  });

  it('leaves the bags on their old move-in day', () => {
    const log = placed();
    const r = rig(log);
    r.moveBagsTo(batch, ['BO-1-01', 'BO-1-02'], 'TENT1');
    r._undoMove([
      { batch, bag: 'BO-1-01', from: 'INC_R1' },
      { batch, bag: 'BO-1-02', from: 'INC_R1' }
    ]);
    const inc = r.getZoneBags('INC');
    assert.equal(inc['BO-1-01'].since, '2026-09-01T08:00:00.000Z');
    assert.equal(inc['BO-1-02'].since, '2026-09-01T08:00:00.000Z');
    assert.deepEqual(r.getZoneBags('TENT1'), {});
  });
});

describe('The contamination report and Rückgängig', () => {
  it('does not count the way back as contamination', () => {
    const db = require('../db.js');
    const p = path.join(os.tmpdir(), 'mt_undo_test_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    const d = db.openDb(p);
    try {
      const time = '2026-09-30T09:00:00.000Z';
      db.appendScanEntries(
        d,
        [
          {
            time,
            action: 'MOVE',
            batch: 'BO-1',
            bag: 'BO-1-01',
            from: 'INC_R1',
            to: 'CONTAM',
            reason: 'contam_tricho',
            client_uuid: 'u1'
          },
          { time, action: 'MOVE', batch: 'BO-1', bag: 'BO-1-02', from: 'INC_R1', to: 'CONTAM', client_uuid: 'u2' },
          {
            time,
            action: 'MOVE',
            batch: 'BO-1',
            bag: 'BO-1-02',
            from: 'CONTAM',
            to: 'INC_R1',
            reason: 'undo',
            client_uuid: 'u3'
          }
        ],
        null
      );
      assert.equal(db.getContaminationReport(d, 'month').totalContam, 1);
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });
});
