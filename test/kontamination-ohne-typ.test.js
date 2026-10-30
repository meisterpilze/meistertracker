'use strict';
// Kontamination melden, ohne einen Typ zu waehlen.
//
// Am Regal sieht man, dass ein Beutel hin ist, nicht immer, woran. Der Typ war
// Pflicht, und das Formular liess ohne ihn nicht senden; jetzt reicht der
// Beutel. Ohne Typ landet der Bericht unter "Unbekannt / Sonstiges", gewaehlt
// wird er weiter so wie vorher.
//
// Die Beutel und Chargen hier sind ausgedacht.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { kontaminationsrouten } = require('./helpers/kontaminationsrouten');

describe('POST /api/contamination-reports ohne Typ', () => {
  let r;
  beforeEach(() => {
    r = kontaminationsrouten();
  });
  afterEach(() => r.schliessen());

  const typVon = (id) =>
    r.database
      .prepare(
        'SELECT ct.key FROM contamination_reports cr JOIN contamination_types ct ON ct.id = cr.type_id WHERE cr.id=?'
      )
      .get(id).key;

  it('nimmt einen Bericht ohne type_id an und legt ihn unter "unknown_other" ab', async () => {
    const a = await r.anfrage('POST', '/api/contamination-reports', {
      severity: 'minor',
      bag_id: 'XY-0101-01',
      batch_id: 'XY-0101'
    });
    assert.equal(a.status, 200);
    assert.equal(typVon(a.json.id), 'unknown_other');
  });

  it('nimmt type_id: null genauso, auch fuer mehrere Beutel', async () => {
    const a = await r.anfrage('POST', '/api/contamination-reports', {
      type_id: null,
      severity: 'minor',
      bags: [
        { bag_id: 'XY-0101-01', batch_id: 'XY-0101', report_uuid: 'u-1' },
        { bag_id: 'XY-0101-02', batch_id: 'XY-0101', report_uuid: 'u-2' }
      ]
    });
    assert.equal(a.status, 200);
    assert.equal(a.json.ids.length, 2);
    for (const id of a.json.ids) assert.equal(typVon(id), 'unknown_other');
  });

  it('behaelt einen gewaehlten Typ', async () => {
    const tricho = r.db.listContaminationTypes(r.database).find((tp) => tp.key === 'tricho');
    const a = await r.anfrage('POST', '/api/contamination-reports', {
      type_id: tricho.id,
      severity: 'minor',
      bag_id: 'XY-0101-01',
      batch_id: 'XY-0101'
    });
    assert.equal(a.status, 200);
    assert.equal(typVon(a.json.id), 'tricho');
  });

  it('lehnt einen Typ ab, der keine Zahl ist', async () => {
    const a = await r.anfrage('POST', '/api/contamination-reports', {
      type_id: 'tricho',
      severity: 'minor',
      bag_id: 'XY-0101-01'
    });
    assert.equal(a.status, 400);
  });
});
