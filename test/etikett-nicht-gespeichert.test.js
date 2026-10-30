'use strict';
// Gedruckt, aber nicht gespeichert.
//
// Ein Etikett, dessen Kultur oder Beutel nicht in der App steht, klebt auf
// etwas, das nirgends zählt: kein Bestand, kein Billbee, nichts auf der
// Nachproduzieren-Liste. Petrischalen blieben so wochenlang unsichtbar, bis
// jemand eine scannte. Jetzt merkt sich der Server jede gedruckte Kennung,
// fragt ein paar Minuten später nach, und die Glocke meldet, was fehlt.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();
const SERVER = quelle('server.js');

// Felder wie itemsToZPL() in app.js sie schreibt.
const text = (t, y = 60) => '^FO0,' + y + '^FB400,1,0,C^A0N,24,24^FD' + t + '^FS';
const strich = (v) => '^FO20,10^BY2,2.0,40^BCN,40,N,N,N^FD' + v + '^FS';
const qr = (v) => '^LH0,0^FO10,10^BQN,2,4^FDMA,' + v + '^FS';
const etikett = (...felder) => '^XA^PW400^LL240^CI28' + felder.join('') + '^XZ';

describe('Etikett: welche Kennung darauf steht', () => {
  it('die erste Textzeile, nicht die Herkunft dahinter und nicht der Strichcode', () => {
    const z = etikett(
      strich('100234'),
      text('PD-TA-TESTMP01-090926-01 ← LC-TA-010926-01'),
      text('Testart Alpha – TESTMP01', 90),
      text('09.09.26', 120)
    );
    assert.deepEqual(db.labelIdsFromZpl(z), ['PD-TA-TESTMP01-090926-01']);
  });

  it('eine am Bindestrich umbrochene Kennung steht wieder in einem Stück da', () => {
    const z = etikett(qr('PD_TA_TESTMP01_090926_02'), text('PD-TA-TESTMP01-'), text('090926-02', 90));
    assert.deepEqual(db.labelIdsFromZpl(z), ['PD-TA-TESTMP01-090926-02']);
  });

  it('ein Beutel mit Zähler in der Ecke, und mehrere Etiketten in einem Auftrag', () => {
    const z =
      etikett(text('/12', 200), strich('G_TA_0926_3'), text('G-TA-TESTMP01-281026-01-03')) +
      '\n' +
      etikett(text('/12', 200), strich('G_TA_0926_4'), text('G-TA-TESTMP01-281026-01-04'));
    assert.deepEqual(db.labelIdsFromZpl(z), ['G-TA-TESTMP01-281026-01-03', 'G-TA-TESTMP01-281026-01-04']);
  });

  it('ein Block mit einstelliger Nummer, wie ihn eine Charge unter zehn Beuteln trägt', () => {
    const z = etikett(text('/8', 200), strich('TA_1008_7'), text('TA-081026-01-7'));
    assert.deepEqual(db.labelIdsFromZpl(z), ['TA-081026-01-7']);
  });

  it('ein Etikett ohne Kennung (Produktetikett als Bild, Regal-QR) bleibt außen vor', () => {
    assert.deepEqual(db.labelIdsFromZpl('^XA^FO0,0^GFA,4,4,1,FFFFFFFF^FS^XZ'), []);
    assert.deepEqual(db.labelIdsFromZpl(etikett(qr('INC_R1'), text('Incubation Regal 1'))), []);
  });
});

describe('Etikett: gedruckt, aber nicht gespeichert', () => {
  const T0 = new Date('2026-10-28T10:00:00Z');
  const spaeter = (min) => new Date(T0.getTime() + min * 60 * 1000);

  it('meldet nach der Frist, was nicht in der App steht, und jedes nur einmal', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ung-'));
    const d = db.openDb(path.join(dir, 'test.db'));
    try {
      const a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
      db.insertCultures(d, [
        { id: 'PD-TA-281026-01', type: 'PD', strainId: a, status: 'active', notes: '', created: T0.toISOString() }
      ]);
      const n = db.recordPrintedLabels(d, etikett(text('PD-TA-281026-01')) + etikett(text('PD-TA-281026-02')), T0);
      assert.equal(n, 2);
      assert.deepEqual(db.unsavedLabels(d, spaeter(2)), [], 'in der Frist wird nicht gefragt');
      assert.deepEqual(db.unsavedLabels(d, spaeter(6)), [{ id: 'PD-TA-281026-02', printedAt: T0.toISOString() }]);
      assert.deepEqual(db.unsavedLabels(d, spaeter(12)), [], 'einmal gemeldet ist gemeldet');

      db.recordPrintedLabels(d, etikett(text('PD-TA-281026-02')), spaeter(20));
      assert.equal(db.unsavedLabels(d, spaeter(26)).length, 1, 'neu gedruckt wird neu gefragt');

      db.recordPrintedLabels(d, etikett(text('PD-TA-281026-02')), spaeter(30));
      db.insertCultures(d, [
        { id: 'PD-TA-281026-02', type: 'PD', strainId: a, status: 'active', notes: '', created: T0.toISOString() }
      ]);
      assert.deepEqual(db.unsavedLabels(d, spaeter(36)), [], 'aufgenommen, also still');
    } finally {
      d.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ein Beutel und seine Charge zählen als gespeichert', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ung-'));
    const d = db.openDb(path.join(dir, 'test.db'));
    try {
      const a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
      db.insertBatch(d, {
        batchId: 'G-TA-281026-01',
        strainId: a,
        qty: 1,
        days: 14,
        substrate: {},
        bagKg: 1,
        batchType: 'grain',
        notes: '',
        created: T0.toISOString(),
        due: spaeter(14 * 24 * 60).toISOString(),
        bags: [{ id: 'G-TA-281026-01-01', bagKg: 1 }]
      });
      db.recordPrintedLabels(d, etikett(text('G-TA-281026-01-01')) + etikett(text('G-TA-281026-01-02')), T0);
      assert.deepEqual(
        db.unsavedLabels(d, spaeter(6)).map((f) => f.id),
        ['G-TA-281026-01-02']
      );
    } finally {
      d.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Etikett: wo es hängt', () => {
  it('jeder Druck, der durchging, merkt sich seine Kennungen, über die Brücke wie lokal', () => {
    const f = _hf('printZPL', SERVER);
    assert.match(f, /if \(!err\) rememberPrintedLabels\(zplData\)/);
    assert.match(f, /_printViaBridge\(zplData, done\)/);
    assert.match(f, /_printViaPowerShell\(zplData, done\)/);
  });

  it('die Glocke meldet jede fehlende Kennung einmal, mit Link zum Aufnehmen', () => {
    const f = _hf('checkUnsavedLabels', SERVER);
    assert.match(f, /db\.unsavedLabels\(database/);
    assert.match(f, /createNotificationOnce/);
    assert.match(f, /linkType: 'label_unsaved'/);
  });

  it('ein Tipp auf die Meldung öffnet bei einer Kultur das Aufnehmen, datiert vom Etikett', () => {
    const f = _hf('onNotifItemClick', APP);
    assert.match(f, /linkType === 'label_unsaved'/);
    assert.match(f, /kulturKennungLesen\(linkId\)/);
    assert.match(f, /msQuickOpenIntake\(k\)/);
    assert.match(
      _hf('msQuickOpenIntake', APP),
      /if \(k\.datum\) ANLAGE\['ms-q'\] = \{ offen: true, datum: k\.datum \}/
    );
  });
});
