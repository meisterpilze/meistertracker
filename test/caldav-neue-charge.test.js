'use strict';
// Eine neue Charge kommt in den Kalender.
//
// Beim Anlegen schickt die App ihre Beutel als { id, bagKg }, mit dem Gewicht
// je Beutel; aus der Datenbank kommen sie als blanke Kennungen.
// getBatchLocServer() nahm nur die zweite Form und warf bei jeder neuen Charge
// "bag.toUpperCase is not a function", und ihre Fälligkeit kam nie in den
// CalDAV-Kalender. Jetzt ist beides ein Beutel.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SERVER = quelle('server.js');
const { getBatchLocServer, batchToVEVENT } = new Function(
  ['getBatchLocServer', '_berlinDateCompact', '_nextDayCompact', 'escapeIcsText', 'foldIcsLines', 'batchToVEVENT']
    .map((name) => hebeFunktion(name, SERVER))
    .join('\n') + '\nreturn { getBatchLocServer, batchToVEVENT };'
)();

const SCANS = [
  { action: 'ADD', bag: 'G-TA-281026-01-01', to: 'INC_R1' },
  { action: 'ADD', bag: 'G-TA-281026-01-02', to: 'INC_R1' },
  { action: 'ADD', bag: 'G-TA-281026-01-03', to: 'SPAWN_R1' }
];

describe('CalDAV: eine neue Charge', () => {
  it('liest Beutel als { id, bagKg }, wie die App sie beim Anlegen schickt', () => {
    const neu = {
      batchId: 'G-TA-281026-01',
      bags: [
        { id: 'G-TA-281026-01-01', bagKg: 1 },
        { id: 'G-TA-281026-01-02', bagKg: 2 },
        { id: 'G-TA-281026-01-03', bagKg: 2 }
      ]
    };
    assert.equal(getBatchLocServer(neu, SCANS), 'INC_R1');
  });

  it('und weiter als blanke Kennungen, wie sie aus der Datenbank kommen', () => {
    const alt = { batchId: 'G-TA-281026-01', bags: ['g-ta-281026-01-01', 'G-TA-281026-01-03', 'G-TA-281026-01-03'] };
    assert.equal(getBatchLocServer(alt, SCANS), 'SPAWN_R1');
  });

  it('ein Eintrag ohne Kennung zählt nicht und wirft nicht', () => {
    assert.equal(getBatchLocServer({ batchId: 'X', bags: [null, {}, ''] }, SCANS), '');
  });

  it('der Termin der neuen Charge entsteht, mit ihrem Platz', () => {
    const { uid, ics } = batchToVEVENT(
      {
        batchId: 'G-TA-281026-01',
        due: '2026-11-11T08:00:00.000Z',
        bags: [{ id: 'G-TA-281026-01-01', bagKg: 1 }]
      },
      SCANS
    );
    assert.equal(uid, 'batch-G-TA-281026-01@meisterpilze');
    assert.match(ics, /DTSTART;VALUE=DATE:20261111/);
    assert.match(ics, /LOCATION:INC_R1/);
  });
});
