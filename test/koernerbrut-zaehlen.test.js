'use strict';
// Körnerbrut zählen: einmal im Monat je Art und Beutelgröße die fertigen Beutel
// im Regal. Weniger als gedacht: die ältesten gehen als "count" hinaus, kein
// Verbrauch und keine Kontamination. Mehr: eine Charge "aus der Zählung", fertig
// ab sofort, die weder Korn noch Weizen aus dem Regal nimmt. Ein Rückgängig nimmt
// alles zurück. Dazu ein Körnerbrut-Etikett je Art statt je Größe.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const hebe = (n) => _hf(n, APP);

function beutel(d, batchId, strainId, due, kgs) {
  const bags = kgs.map((kg, i) => ({ id: batchId + '-' + String(i + 1).padStart(2, '0'), bagKg: kg }));
  db.insertBatch(d, {
    batchId,
    strainId,
    qty: bags.length,
    days: 14,
    substrate: {},
    bagKg: 1,
    batchType: 'grain',
    notes: '',
    created: '2026-11-01T08:00:00.000Z',
    due,
    bags
  });
  db.appendScanEntries(
    d,
    bags.map((b) => ({ time: '2026-11-01T09:00:00.000Z', action: 'ADD', batch: batchId, bag: b.id, to: 'SPAWN' }))
  );
}

describe('Körnerbrut zählen', () => {
  let d, dir, a;
  const jetzt = new Date('2026-11-17T12:00:00.000Z');
  const sp = () => db.labStock(d, jetzt).find((s) => s.strainId === a);
  const zahl = (slot) => (sp().fach.find((f) => f.slot === slot) || { have: 0 }).have;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kbz-'));
    d = db.openDb(path.join(dir, 'test.db'));
    a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
    beutel(d, 'G-TA-01', a, '2026-11-05T00:00:00.000Z', [1, 1, 1, 2]);
    beutel(d, 'G-TA-02', a, '2099-01-01T00:00:00.000Z', [1]);
  });
  after(() => {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('zählt nur fertige Beutel; was wächst, zählt nicht', () => {
    assert.equal(zahl('KB1'), 3);
    assert.equal(zahl('KB2'), 1);
  });

  it('stimmt alles, bucht es nichts', () => {
    const r = db.zaehleKoernerbrut(d, [{ strainId: a, kg: 1, count: 3 }], null, jetzt);
    assert.deepEqual([r.changes, r.removed, r.added], [[], [], []]);
  });

  let ergebnis;
  it('weniger: die ältesten hinaus, als "count"; mehr: eine Charge aus der Zählung', () => {
    ergebnis = db.zaehleKoernerbrut(
      d,
      [
        { strainId: a, kg: 1, count: 1 },
        { strainId: a, kg: 5, count: 2 }
      ],
      null,
      jetzt
    );
    assert.deepEqual(
      ergebnis.changes.map((c) => [c.kg, c.from, c.to]),
      [
        [1, 3, 1],
        [5, 0, 2]
      ]
    );
    assert.equal(zahl('KB1'), 1);
    assert.equal(zahl('KB5'), 2);
    const raus = d.prepare("SELECT bag, reason FROM scan_log WHERE action = 'REMOVE' ORDER BY id").all();
    assert.deepEqual(
      raus.map((r) => [r.bag, r.reason]),
      [
        ['G-TA-01-01', 'count'],
        ['G-TA-01-02', 'count']
      ]
    );
    assert.equal(db.getContaminationReport(d, 'species').totalContam, 0, 'gezählt ist keine Kontamination');
    const neu = d
      .prepare('SELECT batch_id, notes, shelf_draw, due FROM batches WHERE batch_id = ?')
      .get(ergebnis.added[0]);
    assert.match(neu.batch_id, /^G-TA-ZAEHL-171126-01$/);
    assert.equal(neu.notes, 'Aus der Zählung');
    assert.equal(neu.shelf_draw, null, 'nimmt keinen Weizen aus dem Regal');
    assert.equal(
      d.prepare('SELECT COUNT(*) AS n FROM inventory_log WHERE ref = ?').get(ergebnis.added[0]).n,
      0,
      'nimmt kein Korn vom Lager'
    );
  });

  it('Rückgängig nimmt die ganze Zählung zurück', () => {
    db.zaehlungZurueck(d, ergebnis, null);
    assert.equal(zahl('KB1'), 3);
    assert.equal(zahl('KB5'), 0);
    assert.equal(d.prepare("SELECT COUNT(*) AS n FROM batches WHERE batch_id LIKE '%-ZAEHL-%'").get().n, 0);
  });

  it('nimmt keine Zahlen, die keine sind', () => {
    assert.throws(() => db.zaehleKoernerbrut(d, [{ strainId: a, kg: 1, count: -1 }], null, jetzt), /ganze Zahl/);
    assert.throws(() => db.zaehleKoernerbrut(d, [{ strainId: a, kg: 1, count: 1.5 }], null, jetzt), /ganze Zahl/);
    assert.throws(
      () => db.zaehleKoernerbrut(d, [{ strainId: 99999, kg: 1, count: 1 }], null, jetzt),
      /Art gibt es nicht/
    );
  });

  it('Rückgängig fasst nur an, was von einer Zählung kommt', () => {
    db.zaehlungZurueck(d, { removed: [], added: ['G-TA-01'] }, null);
    assert.ok(d.prepare("SELECT 1 FROM batches WHERE batch_id = 'G-TA-01'").get(), 'eine echte Charge bleibt');
  });

  it('ein Körnerbrut-Etikett je Art: zählt alle Größen zusammen, hat keinen Alarm', () => {
    const kb = db.ensureLabFach(d, a, 'KB');
    assert.equal(kb.group, true);
    assert.equal(kb.have, 4, '3 × 1 kg und 1 × 2 kg');
    assert.ok(kb.barcode >= 1000000);
    assert.equal(sp().kb.barcode, kb.barcode, 'Labor → Bestand trägt es mit');
    assert.ok(!sp().fach.some((f) => f.slot === 'KB'), 'in der Zeile stehen weiter die Größen');
    assert.throws(() => db.setLabFachAlarm(d, kb.id, 3), /jede Größe selbst/);
    assert.equal(db.labFachText('KB'), 'Körnerbrut');
  });
});

describe('Körnerbrut zählen in der App', () => {
  it('ein Knopf auf dem Körnerbrut-Reiter öffnet die Zählung', () => {
    const reiter = HTML.slice(HTML.indexOf('id="sp-lab-grain"'), HTML.indexOf('id="gr-list"'));
    assert.match(reiter, /id="gr-zaehlen"/);
    assert.match(HTML, /id="m-kbz"/);
    assert.match(hebe('kbzWire'), /getElementById\('gr-zaehlen'\)\.addEventListener\('click', kbzOpen\)/);
  });
  it('je Art 1, 2 und 5 kg, vorbelegt mit dem, was die App meint', () => {
    assert.match(APP, /^const KBZ_KG = \[1, 2, 5\];$/m);
    assert.match(hebe('kbzOpen'), /value="\$\{f\.have\}"/);
  });
  it('am Fach geht Add und Zählen nach oben jetzt auch bei Körnerbrut, über dieselbe Buchung', () => {
    assert.match(hebe('lfAdd'), /kbzBuchen\(\[\{ strainId: f\.strainId, kg: f\.size, count: f\.have \+ n \}\]\)/);
    assert.match(hebe('lfAct'), /if \(diff > 0\) return lfAdd\(f, diff\);/);
  });
  it('die Zurück-Geste schließt die Zählung', () => {
    assert.match(APP, /'m-kbz': \(\) => kbzClose\(\)/);
  });
});
