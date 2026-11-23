'use strict';
// Die Druckseite oben: noch nicht gedruckt, zuletzt angelegt.
//
// "Später" im Etiketten-Fenster hieß bisher: die Charge unter allen Chargen
// wieder heraussuchen. Und als am 23.11.2026 der Server mitten im Anlegen
// schlafen ging, waren zwei Körnerbeutel und eine Spritze gespeichert, aber
// ohne Etikett — und nichts in der App sagte das. Jetzt steht oben auf der
// Druckseite alles der letzten Tage, was noch nie aus dem Drucker kam.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const SERVER = quelle('server.js');
const HTML = quelle('index.html');

const text = (t) => '^FO0,60^FB400,1,0,C^A0N,24,24^FD' + t + '^FS';
const etikett = (id) => '^XA^PW400^LL240^CI28^FO20,10^BY2,2.0,40^BCN,40,N,N,N^FD1000001^FS' + text(id) + '^XZ';

const T0 = new Date('2026-11-23T10:12:09.725Z');
const tageVorher = (n) => new Date(T0.getTime() - n * 864e5).toISOString();

function mitDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'druck-'));
  const d = db.openDb(path.join(dir, 'test.db'));
  try {
    const a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
    fn(d, a);
  } finally {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const kultur = (id, a, extra) =>
  Object.assign(
    { id, type: 'PD', strainId: a, strainText: 'TESTMP01', status: 'active', notes: '', created: T0.toISOString() },
    extra
  );
const charge = (d, a, batchId, n, created, batchType = 'grain') =>
  db.insertBatch(d, {
    batchId,
    strainId: a,
    qty: n,
    days: 14,
    substrate: {},
    bagKg: 2,
    batchType,
    notes: '',
    created,
    due: created,
    bags: Array.from({ length: n }, (_, i) => ({ id: batchId + '-0' + (i + 1), bagKg: 2 }))
  });

describe('Druckliste: was noch kein Etikett hat', () => {
  it('was zusammen angelegt wurde, ist eine Zeile; gedruckt fällt es heraus', () => {
    mitDb((d, a) => {
      db.insertCultures(d, [kultur('PD-TA-TESTMP01-231126-01', a), kultur('PD-TA-TESTMP01-231126-02', a)]);
      db.insertCultures(d, [kultur('SY-TA-TESTMP01-231126-01', a, { type: 'SY', ml: 10 })]);
      let l = db.druckListe(d, T0);
      assert.equal(l.offen.length, 2);
      const pd = l.offen.find((g) => g.type === 'PD');
      assert.deepEqual(pd.offen, ['PD-TA-TESTMP01-231126-01', 'PD-TA-TESTMP01-231126-02']);
      assert.equal(pd.species, 'Testart Alpha');
      assert.equal(pd.strainText, 'TESTMP01');
      assert.equal(l.offen.find((g) => g.type === 'SY').ml, 10);

      db.recordPrintedLabels(d, etikett('PD-TA-TESTMP01-231126-01'), T0);
      l = db.druckListe(d, T0);
      assert.deepEqual(l.offen.find((g) => g.type === 'PD').offen, ['PD-TA-TESTMP01-231126-02']);

      db.recordPrintedLabels(d, etikett('PD-TA-TESTMP01-231126-02') + etikett('SY-TA-TESTMP01-231126-01'), T0);
      l = db.druckListe(d, T0);
      assert.deepEqual(l.offen, []);
      assert.equal(l.zuletzt.length, 2, 'gedruckt bleibt es unter "zuletzt", zum Nachdrucken');
      assert.deepEqual(
        l.zuletzt.map((g) => g.offen.length),
        [0, 0]
      );
    });
  });

  it('Beutel je Charge; nicht die, die schon weg sind, nicht aus der Zählung, nicht von vor 14 Tagen', () => {
    mitDb((d, a) => {
      charge(d, a, 'G-TA-TESTMP01-231126-02', 2, T0.toISOString());
      charge(d, a, 'G-TA-ZAEHL-231126-01', 3, T0.toISOString());
      charge(d, a, 'G-TA-TESTMP01-011126-01', 2, tageVorher(22));
      db.appendScanEntries(
        d,
        [
          {
            time: T0.toISOString(),
            action: 'ADD',
            batch: 'G-TA-TESTMP01-231126-02',
            bag: 'G-TA-TESTMP01-231126-02-01',
            to: 'SPAWN_R1'
          },
          {
            time: T0.toISOString(),
            action: 'ADD',
            batch: 'G-TA-TESTMP01-231126-02',
            bag: 'G-TA-TESTMP01-231126-02-02',
            to: 'SPAWN_R1'
          },
          {
            time: T0.toISOString(),
            action: 'REMOVE',
            batch: 'G-TA-TESTMP01-231126-02',
            bag: 'G-TA-TESTMP01-231126-02-02',
            from: 'SPAWN_R1',
            reason: 'test'
          }
        ],
        null
      );
      const l = db.druckListe(d, T0);
      assert.equal(l.offen.length, 1);
      assert.equal(l.offen[0].kind, 'bags');
      assert.equal(l.offen[0].batchId, 'G-TA-TESTMP01-231126-02');
      assert.equal(l.offen[0].type, 'grain');
      assert.deepEqual(l.offen[0].offen, ['G-TA-TESTMP01-231126-02-01']);
    });
  });

  it('eine Kultur, die schon raus ist, braucht kein Etikett mehr', () => {
    mitDb((d, a) => {
      db.insertCultures(d, [kultur('PD-TA-TESTMP01-231126-01', a, { status: 'contam' })]);
      assert.deepEqual(db.druckListe(d, T0).offen, []);
    });
  });

  it('das Neueste steht oben, und "zuletzt" hat höchstens 8 Zeilen', () => {
    mitDb((d, a) => {
      for (let i = 1; i <= 10; i++)
        db.insertCultures(d, [kultur('LC-TA-TESTMP01-1' + i, a, { type: 'LC', created: tageVorher(i) })]);
      const l = db.druckListe(d, T0);
      assert.equal(l.offen.length, 10);
      assert.equal(l.zuletzt.length, 8);
      assert.deepEqual(l.zuletzt[0].alle, ['LC-TA-TESTMP01-11']);
    });
  });
});

describe('Druckliste: "hat schon ein Etikett"', () => {
  it('nimmt es aus der Liste, und Rückgängig holt es zurück', () => {
    mitDb((d, a) => {
      db.insertCultures(d, [kultur('PD-TA-TESTMP01-231126-01', a)]);
      assert.equal(db.druckErledigt(d, ['PD-TA-TESTMP01-231126-01', 'GIBT-ES-NICHT'], false, T0), 1);
      assert.deepEqual(db.druckListe(d, T0).offen, []);
      assert.equal(db.druckErledigt(d, ['PD-TA-TESTMP01-231126-01'], true), 1);
      assert.equal(db.druckListe(d, T0).offen.length, 1);
    });
  });

  it('Rückgängig löscht nie einen echten Druck, und abgehakt meldet die Glocke nichts', () => {
    mitDb((d, a) => {
      db.insertCultures(d, [kultur('PD-TA-TESTMP01-231126-01', a)]);
      db.recordPrintedLabels(d, etikett('PD-TA-TESTMP01-231126-01'), T0);
      assert.equal(db.druckErledigt(d, ['PD-TA-TESTMP01-231126-01'], false, T0), 0, 'schon gedruckt');
      assert.equal(db.druckErledigt(d, ['PD-TA-TESTMP01-231126-01'], true), 0);
      assert.deepEqual(db.druckListe(d, T0).offen, []);

      db.insertCultures(d, [kultur('PD-TA-TESTMP01-231126-02', a)]);
      db.druckErledigt(d, ['PD-TA-TESTMP01-231126-02'], false, T0);
      d.prepare('DELETE FROM cultures WHERE id = ?').run('PD-TA-TESTMP01-231126-02');
      assert.deepEqual(db.unsavedLabels(d, new Date(T0.getTime() + 3600e3)), []);
    });
  });
});

describe('Druckliste: in der App', () => {
  it('der Server gibt die Liste aus und nimmt "hat Etikett" an', () => {
    assert.match(SERVER, /req\.url === '\/api\/print-queue'\)[\s\S]{0,120}db\.druckListe\(database\)/);
    assert.match(
      SERVER,
      /req\.url === '\/api\/print-queue\/erledigt'[\s\S]{0,400}db\.druckErledigt\(database, data && data\.ids, !!\(data && data\.zurueck\)\)/
    );
  });

  it('steht oben auf der Druckseite, vor der Suche in allen Chargen', () => {
    const seite = HTML.slice(HTML.indexOf('id="p-print"'));
    assert.ok(seite.indexOf('id="pq-card"') < seite.indexOf('id="st-print-bags"'));
    assert.ok(seite.indexOf('id="pq-recent-card"') < seite.indexOf('id="st-print-bags"'));
  });

  it('die Druckseite lädt die Liste beim Öffnen', () => {
    assert.match(APP, /if \(page === 'print'\) \{\n\s+loadPrintQueue\(\);/);
  });

  it('"Später" schließt das Fenster und sagt, wo es wartet', () => {
    assert.match(
      APP,
      /\$\('nbp-later'\)\.addEventListener\('click', \(\) => \{\n\s+nbpClose\(\);\n\s+toast\(t\('pq\.later'\)\);/
    );
    assert.match(
      APP,
      /\$\('cpr-later'\)\.addEventListener\('click', \(\) => \{\n\s+cprClose\(\);\n\s+toast\(t\('pq\.later'\)\);/
    );
  });

  it('eine aufgenommene Kultur hat ihr Etikett schon', () => {
    assert.match(hebeFunktion('logLabWork', APP), /apiPost\('\/api\/print-queue\/erledigt', \{ ids: \[intakeId\] \}\)/);
  });

  it('drucken: ungedruckte oder, beim Nachdrucken, alle; Kulturen und Beutel in einem Auftrag', async () => {
    const r = await new Function(`
      return (async () => {
        const gesendet = [];
        let geladen = 0;
        let _pq = null;
        let _pqBusy = false;
        const cultures = [{ id: 'PD-1' }, { id: 'PD-2' }];
        const batches = [{ batchId: 'G-1', bags: ['G-1-01', 'G-1-02'] }];
        const barcodeByEntity = new Map([['culture:PD-1', 1], ['culture:PD-2', 2]]);
        const document = { getElementById: () => null };
        const t = (k, p) => k + (p ? JSON.stringify(p) : '');
        const toast = () => {};
        const renderPrintQueue = () => {};
        const loadPrintQueue = () => { geladen++; };
        const loadData = async () => { throw new Error('nicht nötig'); };
        const ensureBagBarcodes = async () => {};
        const makeLabZPL = (ids) => ids.map((id) => '^XA' + id + '^XZ').join('\\n');
        const makeBagZPL = (bags) => bags.map((id) => '^XA' + id + '^XZ').join('\\n');
        const sendToPrinter = async (zpl) => { gesendet.push(zpl); return null; };
        let gemeldet = '';
        const printedFb = (m) => { gemeldet = m; };
        ${hebeFunktion('pqDrucken', APP)}
        const gruppen = [
          { kind: 'culture', type: 'PD', alle: ['PD-1', 'PD-2'], offen: ['PD-2'] },
          { kind: 'bags', batchId: 'G-1', alle: ['G-1-01', 'G-1-02'], offen: ['G-1-01', 'G-1-02'] }
        ];
        await pqDrucken(gruppen, false);
        const erst = gemeldet;
        await pqDrucken([gruppen[0]], true);
        return { gesendet, erst, dann: gemeldet, geladen };
      })();
    `)();
    assert.deepEqual(r.gesendet[0].match(/\^XA.*?\^XZ/g), ['^XAPD-2^XZ', '^XAG-1-01^XZ', '^XAG-1-02^XZ']);
    assert.equal(r.erst, 'print.printedAll{"n":3}');
    assert.deepEqual(r.gesendet[1].match(/\^XA.*?\^XZ/g), ['^XAPD-1^XZ', '^XAPD-2^XZ']);
    assert.equal(r.dann, 'print.printedAll{"n":2}');
    assert.equal(r.geladen, 2, 'danach wird die Liste neu geholt');
  });
});
