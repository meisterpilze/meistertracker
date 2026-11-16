'use strict';
// Bag ids, bag weights, counts and clock times: what the server accepts.
//
// The batch routes checked the batch id's charset but not the ids of its bags,
// nor that a weight or a count was a number. Contamination reports checked only
// the length of a bag id, and PATCH /api/tasks/:id checked no field at all.
// These values are shown in the batch dialogs, the location lists and the
// calendar, so they get the shape the forms give them. How the page escapes
// them is in inline-handler-escaping.test.js.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { routen } = require('./helpers/routen');
const { kontaminationsrouten } = require('./helpers/kontaminationsrouten');

describe('batch routes: bag ids, weights and counts', () => {
  const ABSCHNITT = {
    name: 'chargenrouten',
    von: '// A Charge portioned out of an existing mix.',
    bis: '// -- Scan Log --',
    helfer: [
      'jsonOk',
      'jsonErr',
      'safeErr',
      'requireAdmin',
      'validateRequired',
      'validateTypes',
      'validateRanges',
      'validateLengths',
      'validateEnum',
      'validateDate',
      'validateBagId',
      'validateBagKg',
      'validateBagList',
      'autoPushBatchCaldav'
    ],
    konstanten: ['ID_CHARSET_RE'],
    literale: ['BATCH_TYPES']
  };
  let r;
  before(() => {
    r = routen(ABSCHNITT);
  });
  after(() => r.schliessen());

  const charge = (extra) => ({
    batchId: 'T-0001',
    species: 'Beispielsorte',
    qty: 2,
    days: 14,
    created: '2026-11-16T08:00:00.000Z',
    due: '2026-11-30T08:00:00.000Z',
    batchType: 'block',
    bagKg: 2.5,
    bags: ['T-0001-01', 'T-0001-02'],
    ...extra
  });
  const beutel = (id) => r.database.prepare('SELECT bag_id FROM bags WHERE batch_id=? ORDER BY bag_id').all(id);

  it('turns away a bag id outside the id charset, a weight or a count that is no number', async () => {
    for (const extra of [
      { bags: ['T-0001-01', "T-0001-0'2"] },
      { bags: ['T-0001-01', 'T-0001 02'] },
      { bags: [{ id: 'T-0001-01', bagKg: '2,5' }] },
      { bags: [{ id: '<b>', bagKg: 2 }] },
      { bags: [7] },
      { bags: 'T-0001-01' },
      { bagKg: '2.5 kg' },
      { qty: 2.5 }
    ]) {
      const a = await r.anfrage('POST', '/api/batches', charge(extra));
      assert.equal(a.status, 400, JSON.stringify(extra));
    }
    assert.deepEqual(beutel('T-0001'), []);
  });

  it('still takes a batch the forms send, ids or { id, bagKg }', async () => {
    const a = await r.anfrage('POST', '/api/batches', charge());
    assert.equal(a.status, 200, JSON.stringify(a.json));
    const b = await r.anfrage(
      'POST',
      '/api/batches',
      charge({
        batchId: 'T-0002',
        batchType: 'grain',
        bagKg: 1,
        bags: [
          { id: 'T-0002-01', bagKg: 1 },
          { id: 'T-0002-02', bagKg: 2 }
        ]
      })
    );
    assert.equal(b.status, 200, JSON.stringify(b.json));
    assert.equal(beutel('T-0002').length, 2);
  });

  it('takes the bags of a batch whose id is as long as a batch id may be', async () => {
    // A bag id is its batch id with "-NN" behind it, so it may run past 100.
    const lang = 'T-' + 'X'.repeat(97);
    const a = await r.anfrage(
      'POST',
      '/api/batches',
      charge({ batchId: lang, qty: 2, bags: [lang + '-01', lang + '-02'] })
    );
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(beutel(lang).length, 2);
  });

  it('checks the bags added to a batch, and the new count', async () => {
    const pfad = '/api/batches/T-0001/bags';
    for (const body of [
      { add: ["T-0001-0'3"], newQty: 3 },
      { add: [{ id: 'T-0001-03' }], newQty: 3 },
      { add: 'T-0001-03', newQty: 3 },
      { add: ['T-0001-03'], newQty: '3' },
      { add: ['T-0001-03'], newQty: 3.5 }
    ]) {
      const a = await r.anfrage('PATCH', pfad, body);
      assert.equal(a.status, 400, JSON.stringify(body));
    }
    assert.equal(beutel('T-0001').length, 2);
    const ok = await r.anfrage('PATCH', pfad, { add: ['T-0001-03'], newQty: 3 });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(beutel('T-0001').length, 3);
  });

  it('checks the bags of a batch made from a mix before anything else', async () => {
    const a = await r.anfrage('POST', '/api/batches/from-substrate', {
      batchId: 'T-0003',
      subId: 'S-0001',
      strainId: 1,
      qty: 1,
      bags: ['T-0003 01']
    });
    assert.equal(a.status, 400);
    assert.match(a.json.error, /bags\[0\]/);
  });
});

describe('contamination reports: the bag id', () => {
  let r;
  before(() => {
    r = kontaminationsrouten();
  });
  after(() => r.schliessen());

  it('turns away a bag or batch id outside the id charset', async () => {
    for (const bags of [[{ bag_id: "B1-0'1" }], [{ bag_id: 'B1-01', batch_id: 'B1 x' }], [{ bag_id: 12 }]]) {
      const a = await r.anfrage('POST', '/api/contamination-reports', { bags, severity: 'minor' });
      assert.equal(a.status, 400, JSON.stringify(bags));
    }
    const n = r.database.prepare('SELECT COUNT(*) AS n FROM contamination_reports').get().n;
    assert.equal(n, 0);
  });
});

describe('PATCH /api/tasks/:id checks its fields', () => {
  const ABSCHNITT = {
    name: 'aufgabenrouten',
    von: '// -- Tasks --',
    bis: '// ── Versuche und ihre Ansaetze',
    helfer: [
      'jsonOk',
      'jsonErr',
      'safeErr',
      'validateRequired',
      'validateTypes',
      'validateLengths',
      'validateEnum',
      'validateDate',
      'validateTimeOfDay',
      'validateTaskFields',
      'resolveUsernamesToIds',
      'parseTaskAssigneeCsv',
      'notifyTaskAssignees',
      'autoPushTaskCaldav',
      'autoDeleteTaskCaldav'
    ]
  };
  const ERIKA = { user_id: 1, username: 'erika', role: 'admin' };
  let r, id;
  before(() => {
    r = routen(ABSCHNITT, { benutzer: [{ id: 1, username: 'erika', role: 'admin' }] });
    id = r.db.insertTask(r.database, {
      text: 'Autoklav prüfen',
      created: '2026-11-16T08:00:00.000Z',
      dueDate: '2026-11-18',
      dueTime: '08:00'
    });
  });
  after(() => r.schliessen());

  const zeile = () => r.database.prepare('SELECT text, due_time, due_end_time FROM manual_tasks WHERE id=?').get(id);

  it('turns away a time that is not HH:MM, and an emptied text', async () => {
    for (const body of [
      { dueTime: '25:00' },
      { dueTime: '8 Uhr' },
      { dueEndTime: '0800' },
      { text: '' },
      { priority: 'x' }
    ]) {
      const a = await r.anfrage('PATCH', '/api/tasks/' + id, body, ERIKA);
      assert.equal(a.status, 400, JSON.stringify(body));
    }
    assert.deepEqual({ ...zeile() }, { text: 'Autoklav prüfen', due_time: '08:00', due_end_time: null });
  });

  it('still saves what the task form sends', async () => {
    const a = await r.anfrage(
      'PATCH',
      '/api/tasks/' + id,
      {
        text: 'Autoklav prüfen',
        priority: 'high',
        dueDate: '2026-11-18',
        dueTime: '09:30',
        dueEndTime: '10:00',
        assignee: null,
        description: null,
        private: 0,
        recurrence: null,
        recurrenceUntil: null,
        caldavSynced: null
      },
      ERIKA
    );
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(zeile().due_time, '09:30');
    const fertig = await r.anfrage('PATCH', '/api/tasks/' + id, { done: true, caldavSynced: null }, ERIKA);
    assert.equal(fertig.status, 200, JSON.stringify(fertig.json));
  });
});
