'use strict';
// Ein kontaminierter Beutel ist kein Bestand, nirgends.
//
// Er steht noch in einer Zone, der Kontamination, und alles, was "Beutel, die
// irgendwo stehen" zählte, zählte ihn mit: die Beutelzahl beim Umsetzen und
// Ernten, und ein Umsetzen der ganzen Charge trug ihn aus der Kontamination
// zurück in den Bestand. Nur die Kontamination selbst zeigt ihn noch.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();

const ZONES = {
  INC: { id: 'INC', role: 'incubation' },
  TENT1: { id: 'TENT1', role: 'fruiting' },
  CONTAM: { id: 'CONTAM', role: 'contaminated' }
};
const platz = (eintraege) => new Map(Object.entries(eintraege));

function lauf(body, lastByBag) {
  return new Function(
    'ZONE_BY_ID',
    'lastByBag',
    `const toZone = (loc) => String(loc).split('_')[0];
    ${_hf('isContamLoc', APP)}
    ${_hf('_batchZoneCounts', APP)}
    ${body}`
  )(ZONES, lastByBag);
}

describe('Kontamination: kein Bestand', () => {
  const lastByBag = platz({
    'B-01': { action: 'ADD', to: 'INC_R1' },
    'B-02': { action: 'MOVE', to: 'CONTAM' },
    'B-03': { action: 'MOVE', to: 'TENT1' },
    'B-04': { action: 'REMOVE', to: null }
  });

  it('die Beutelzahl einer Charge je Zone lässt die kontaminierten weg', () => {
    const c = lauf("return _batchZoneCounts({ bags: ['B-01', 'B-02', 'B-03', 'B-04'] }, lastByBag);", lastByBag);
    assert.deepEqual(c, { INC: 1, TENT1: 1 });
  });

  it('die ganze Charge umsetzen lässt die kontaminierten stehen', () => {
    const bewegt = new Function(
      'ZONE_BY_ID',
      'lastByBag',
      `const toZone = (loc) => String(loc).split('_')[0];
      const buildLastPlacementByBag = () => lastByBag;
      let bewegt = null;
      const moveBagsTo = (batch, ids, dest, cb) => { bewegt = ids; cb(ids.length, 0); };
      const addBagsToLocation = (batch, ids, dest, cb) => cb(ids.length);
      ${_hf('isContamLoc', APP)}
      ${_hf('moveBatchTo', APP)}
      moveBatchTo({ bags: ['B-01', 'B-02', 'B-03', 'B-04'] }, 'TENT1', () => {});
      return bewegt;`
    )(ZONES, lastByBag);
    assert.deepEqual(bewegt, ['B-01', 'B-03', 'B-04']);
  });

  it('die Ernteliste zählt kontaminierte nicht als aktive Beutel', () => {
    const f = _hf('buildHarvestTasks', APP);
    assert.match(f, /last\.action === 'REMOVE' \|\| !last\.to \|\| isContamLoc\(last\.to\)\) return;\s*activeBags\+\+/);
  });

  it('die Gesamtlinie im Verlauf rechnet die kontaminierten nicht dazu', () => {
    assert.doesNotMatch(APP, /\(s\.bags_fruiting \|\| 0\) \+ \(s\.bags_contaminated \|\| 0\)/);
  });
});
