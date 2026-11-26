'use strict';
// Charge prüfen (v125): ein kontaminierter Beutel schickt jemanden zu den
// anderen seiner Charge.
//
// Vorher war die Meldung das Ende: der Beutel ging raus, und ob seine
// Nachbarn aus derselben Charge auch etwas hatten, fiel erst auf, wenn wieder
// einer auffiel. Jetzt öffnet die Meldung eine Prüfung der Charge, die für alle
// gilt, mit einer Glocke für jeden. Sie bleibt offen, bis jemand "Geprüft"
// tippt, oder bis von der Charge nichts mehr da ist.
//
// Beutel, Chargen und Namen hier sind ausgedacht.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { kontaminationsrouten } = require('./helpers/kontaminationsrouten');
const { routen } = require('./helpers/routen');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const CHARGE = 'TZ-010126-01';
const BENUTZER = [
  { id: 7, username: 'erika' },
  { id: 8, username: 'max', role: 'admin' }
];

describe('Charge prüfen: die Meldung öffnet sie', () => {
  let r;
  beforeEach(() => {
    r = kontaminationsrouten({ benutzer: BENUTZER });
  });
  afterEach(() => r.schliessen());

  const steht = (bag, to, batch = CHARGE) =>
    r.db.appendScanEntries(r.database, [{ time: new Date().toISOString(), action: 'ADD', batch, bag, from: null, to }]);
  const melden = (bag, extra = {}) =>
    r.anfrage('POST', '/api/contamination-reports', {
      severity: 'minor',
      auto_move: true,
      bags: [{ bag_id: bag, batch_id: CHARGE, report_uuid: 'u-' + bag + (extra.uuid || '') }],
      ...extra
    });
  const glocken = () =>
    r.database
      .prepare(
        "SELECT user_id, title, body, link_id, dismissed FROM notifications WHERE type = 'batch_check' ORDER BY user_id"
      )
      .all()
      .map((x) => ({ ...x }));

  it('ein Beutel kontaminiert, drei andere stehen noch: eine Prüfung, eine Glocke für jeden', async () => {
    for (const n of [1, 2, 3, 4]) steht(CHARGE + '-' + n, n < 3 ? 'INC_R1:2' : 'INC');
    const a = await melden(CHARGE + '-1');
    assert.equal(a.status, 200);
    assert.equal(a.json.bookedOutCount, 1);
    assert.deepEqual(a.json.batchChecks, [{ id: 1, batchId: CHARGE, left: 3 }]);
    const offen = r.db.listBatchChecks(r.database);
    assert.equal(offen.length, 1);
    assert.equal(offen[0].batchId, CHARGE);
    assert.equal(offen[0].reports, 1);
    const g = glocken();
    assert.deepEqual(
      g.map((x) => x.user_id),
      [7, 8]
    );
    assert.match(g[0].title, new RegExp(CHARGE));
    assert.match(g[0].body, /die anderen 3 Beutel/);
  });

  it('ein zweiter aus derselben Charge zählt die offene Prüfung hoch, ohne zweite Glocke', async () => {
    for (const n of [1, 2, 3]) steht(CHARGE + '-' + n, 'INC');
    await melden(CHARGE + '-1');
    const b = await melden(CHARGE + '-2');
    assert.deepEqual(b.json.batchChecks, [{ id: 1, batchId: CHARGE, left: 1 }]);
    const offen = r.db.listBatchChecks(r.database);
    assert.equal(offen.length, 1);
    assert.equal(offen[0].reports, 2);
    assert.equal(glocken().length, 2, 'eine je Benutzer, nicht zwei');
  });

  it('der letzte Beutel der Charge: nichts mehr anzusehen, keine Prüfung', async () => {
    steht(CHARGE + '-1', 'INC');
    const a = await melden(CHARGE + '-1');
    assert.equal(a.status, 200);
    assert.deepEqual(a.json.batchChecks, []);
    assert.equal(r.db.listBatchChecks(r.database).length, 0);
    assert.equal(glocken().length, 0);
  });

  it('ohne batch_id in der Meldung kommt die Charge aus dem Scan-Log', async () => {
    for (const n of [1, 2]) steht(CHARGE + '-' + n, 'INC');
    const a = await r.anfrage('POST', '/api/contamination-reports', {
      severity: 'minor',
      auto_move: true,
      bag_id: CHARGE + '-1'
    });
    assert.equal(a.status, 200);
    assert.deepEqual(a.json.batchChecks, [{ id: 1, batchId: CHARGE, left: 1 }]);
  });

  it('eine nachgespielte Meldung (gleiche report_uuid) zählt nicht noch einmal', async () => {
    for (const n of [1, 2, 3]) steht(CHARGE + '-' + n, 'INC');
    await melden(CHARGE + '-1');
    const nochmal = await melden(CHARGE + '-1');
    assert.equal(nochmal.status, 200);
    assert.equal(r.db.listBatchChecks(r.database)[0].reports, 1);
  });

  it('ein Beutel einer anderen Charge zählt nicht mit', async () => {
    steht(CHARGE + '-1', 'INC');
    steht('TZ-010126-02-1', 'INC', 'TZ-010126-02');
    const a = await melden(CHARGE + '-1');
    assert.deepEqual(a.json.batchChecks, []);
  });
});

describe('Charge prüfen: Geprüft, Rückgängig, und von selbst zu', () => {
  let r;
  beforeEach(() => {
    r = kontaminationsrouten({ benutzer: BENUTZER });
    for (const n of [1, 2, 3])
      r.db.appendScanEntries(r.database, [
        { time: new Date().toISOString(), action: 'ADD', batch: CHARGE, bag: CHARGE + '-' + n, from: null, to: 'INC' }
      ]);
  });
  afterEach(() => r.schliessen());

  const offeneGlocken = () =>
    r.database.prepare("SELECT COUNT(*) AS c FROM notifications WHERE type = 'batch_check' AND dismissed = 0").get().c;

  it('Geprüft schließt sie für alle und nimmt die Glocke bei allen weg; Rückgängig bringt beides zurück', async () => {
    await r.anfrage('POST', '/api/contamination-reports', {
      severity: 'minor',
      auto_move: true,
      bag_id: CHARGE + '-1',
      batch_id: CHARGE
    });
    assert.equal(offeneGlocken(), 2);
    assert.equal(r.db.closeBatchCheck(r.database, 1, 8), true);
    assert.equal(r.db.listBatchChecks(r.database).length, 0);
    assert.equal(offeneGlocken(), 0);
    const zu = r.database.prepare('SELECT checked_by, how FROM batch_checks WHERE id = 1').get();
    assert.deepEqual({ ...zu }, { checked_by: 8, how: 'checked' });
    assert.equal(r.db.closeBatchCheck(r.database, 1, 8), false, 'zweimal zu ändert nichts');
    assert.equal(r.db.closeBatchCheck(r.database, 1, 8, true), true);
    assert.equal(r.db.listBatchChecks(r.database).length, 1);
    assert.equal(offeneGlocken(), 2);
  });

  it('Rückgängig, wenn inzwischen eine neue Prüfung offen ist: die neue zählt, die alte bleibt zu', () => {
    r.db.openBatchCheck(r.database, CHARGE, 7);
    r.db.closeBatchCheck(r.database, 1, 7);
    r.db.openBatchCheck(r.database, CHARGE, 7);
    assert.equal(r.db.closeBatchCheck(r.database, 1, 7, true), false);
    assert.deepEqual(
      r.db.listBatchChecks(r.database).map((c) => c.id),
      [2]
    );
  });

  it('steht von der Charge nichts mehr da, schließt sie sich selbst', () => {
    r.db.openBatchCheck(r.database, CHARGE, 7);
    assert.equal(r.db.closeEmptyBatchChecks(r.database), 0, 'noch drei da');
    r.db.appendScanEntries(
      r.database,
      [1, 2, 3].map((n) => ({
        time: new Date().toISOString(),
        action: 'REMOVE',
        batch: CHARGE,
        bag: CHARGE + '-' + n,
        from: 'INC',
        to: null,
        reason: 'harvested'
      }))
    );
    assert.equal(r.db.closeEmptyBatchChecks(r.database), 1);
    assert.equal(r.db.listBatchChecks(r.database).length, 0);
    assert.equal(r.database.prepare('SELECT how FROM batch_checks').get().how, 'empty');
  });

  it('Beutel in der Kontaminationszone zählen nicht als noch da', () => {
    r.db.appendScanEntries(r.database, [
      { time: new Date().toISOString(), action: 'MOVE', batch: CHARGE, bag: CHARGE + '-2', from: 'INC', to: 'CONTAM' }
    ]);
    assert.deepEqual(r.db.batchStockBags(r.database, CHARGE).sort(), [CHARGE + '-1', CHARGE + '-3']);
  });

  it('Neustart der Daten leert die Prüfungen', () => {
    r.db.openBatchCheck(r.database, CHARGE, 7);
    r.db.resetOperationalData(r.database, { growing: true });
    assert.equal(r.database.prepare('SELECT COUNT(*) AS c FROM batch_checks').get().c, 0);
  });

  it('die Daten für den Browser tragen die offenen Prüfungen', () => {
    r.db.openBatchCheck(r.database, CHARGE, 7);
    const SERVER = quelle('server.js');
    assert.match(SERVER, /checkBatchChecks\(\);/, 'die regelmäßige Prüfung schließt leere');
    assert.match(quelle('db.js'), /batchChecks: listBatchChecks\(db\)/);
  });
});

describe('Charge prüfen: die Route', () => {
  const ABSCHNITT = {
    name: 'charge-pruefen',
    von: '// -- Regalbretter --',
    bis: '// -- Ende Regalbretter --',
    helfer: [
      'jsonOk',
      'jsonErr',
      'safeErr',
      'requireAdmin',
      'validateEnum',
      'validateBagId',
      'validateBagKg',
      'validateBagList',
      'validateRackShelves'
    ],
    konstanten: ['ID_CHARSET_RE']
  };
  let r;
  beforeEach(() => {
    r = routen(ABSCHNITT, { benutzer: BENUTZER });
    r.db.appendScanEntries(r.database, [
      { time: new Date().toISOString(), action: 'ADD', batch: CHARGE, bag: CHARGE + '-2', from: null, to: 'INC' }
    ]);
    r.db.openBatchCheck(r.database, CHARGE, 7);
  });
  afterEach(() => r.schliessen());

  it('nimmt nur eine ganze Zahl, schließt, und undo öffnet wieder', async () => {
    assert.equal((await r.anfrage('POST', '/api/batch-checks/close', { id: 'eins' })).status, 400);
    const zu = await r.anfrage('POST', '/api/batch-checks/close', { id: 1 });
    assert.equal(zu.status, 200);
    assert.equal(zu.json.changed, true);
    assert.equal(r.db.listBatchChecks(r.database).length, 0);
    const auf = await r.anfrage('POST', '/api/batch-checks/close', { id: 1, undo: true });
    assert.equal(auf.json.changed, true);
    assert.equal(r.db.listBatchChecks(r.database).length, 1);
  });
});

describe('Charge prüfen: die Karte', () => {
  const APP = quelle();
  it('je Platz eine Zahl, die meisten zuerst; Kontaminationszone und Ausgebuchtes zählen nicht', () => {
    const orte = new Function(
      `const placementByBag = () => new Map([
        ['A1', { bag: 'A1', batch: 'TZ-1', action: 'ADD', to: 'INC_R1:2' }],
        ['A2', { bag: 'A2', batch: 'TZ-1', action: 'MOVE', to: 'INC_R1:2' }],
        ['A3', { bag: 'A3', batch: 'TZ-1', action: 'ADD', to: 'ZELT9' }],
        ['A4', { bag: 'A4', batch: 'TZ-1', action: 'REMOVE', to: null }],
        ['A5', { bag: 'A5', batch: 'TZ-1', action: 'MOVE', to: 'CONTAM' }],
        ['B1', { bag: 'B1', batch: 'TZ-2', action: 'ADD', to: 'ZELT9' }]
      ]);
      const ZONE_BY_ID = { INC: { role: 'incubation' }, ZELT9: { role: 'fruiting' }, CONTAM: { role: 'contaminated' } };
      const toZone = (l) => (String(l).startsWith('INC') ? 'INC' : String(l).split(':')[0]);
      const chargeOrtName = (l) => l;
      ${hebeFunktion('chargeOrte', APP)}
      return chargeOrte('TZ-1');`
    )();
    assert.deepEqual(orte, [
      { loc: 'INC_R1:2', n: 2, name: 'INC_R1:2' },
      { loc: 'ZELT9', n: 1, name: 'ZELT9' }
    ]);
  });

  it('die Karte steht auf der Arbeit-Seite über dem Montags-Check, und die Glocke führt dahin', () => {
    const HTML = quelle('index.html');
    assert.ok(HTML.indexOf('id="wk-charge"') > 0);
    assert.ok(HTML.indexOf('id="wk-charge"') < HTML.indexOf('id="wk-montag"'));
    assert.match(APP, /linkType === 'batch_check'/);
    for (const lang of ['de', 'en', 'pt']) {
      const L = quelle('lang/' + lang + '.js');
      for (const k of ['charge.title', 'charge.help', 'charge.done', 'charge.receipt', 'charge.left.one'])
        assert.ok(L.includes("'" + k + "'"), lang + ' ' + k);
    }
  });
});
