'use strict';
// Ein Ansatz, eine Flüssigkultur, mehrere Beutelgrößen.
//
// Körnerbrut wird nicht gezählt, sie wird gewogen, und was in einem Durchgang
// angesetzt wird, geht nicht in gleich große Beutel: aus derselben Kultur und
// demselben Korn werden 1-kg-Beutel neben 2- und 3-kg-Beuteln abgefüllt. Das
// ist eine Charge — gleiche Herkunft, gleicher Tag, gleiche Fälligkeit — mit
// mehr als einer Größe darin.
//
// Die Datenbank konnte das seit v31 (bags.bag_kg), das lange Formular auch
// (gs-wline). Nur führte dorthin kein Weg mehr: angelegt wird über die Kacheln,
// und deren Dialog trug ein einziges Feld "kg pro Beutel". Wer zwei Größen
// brauchte, bekam zwei Chargen — zwei Nummern, zwei Zeilen, zwei Fälligkeiten
// für einen Arbeitsgang.
//
// Und dann steht der Beutel im Regal. Das Etikett nannte sein Gewicht nur, wenn
// die Charge GEMISCHT war; bei einer Charge aus lauter 2-kg-Beuteln stand es
// nicht darauf, weil es ja "für alle gilt". Für den Beutel in der Hand gilt es
// dann nicht mehr.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');
const { bagLabelItems } = require('../mcp-server.js');

const SRC = quelle();
const HTML = quelle('index.html');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_groessen_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

// ── Der Schnelldialog ────────────────────────────────────────

describe('Größen im Schnelldialog', () => {
  it('bietet eine Zeilenliste statt eines einzelnen kg-Feldes an', () => {
    assert.match(HTML, /id="ms-q-sizes"/, 'die Liste der Größen fehlt');
    assert.match(HTML, /id="ms-q-add-size"/, 'ohne "+ Größe" bleibt es bei einer');
    assert.doesNotMatch(
      HTML,
      /id="ms-q-grainkg"/,
      'das alte Einzelfeld steht noch da — zwei Felder für dieselbe Frage, und nur eines wird gelesen'
    );
  });

  it('nimmt die Anzahl aus der Zeile, nicht aus dem gemeinsamen Zähler darüber', () => {
    // Der Zähler oben gilt für alle Größen zugleich, also für keine. Er gehört
    // versteckt, solange die Liste steht — sonst stehen zwei Antworten auf
    // dieselbe Frage nebeneinander und nur eine wird gebucht.
    assert.match(HTML, /id="ms-q-qty-wrap"/, 'der Zähler lässt sich nicht ausblenden');
    const render = hebeFunktion('msQuickRender', SRC);
    assert.match(render, /ms-q-qty-wrap/, 'msQuickRender blendet den Zähler nicht um');
    assert.match(render, /ms-q-sizes-wrap/, 'msQuickRender zeigt die Größenliste nicht an');
  });

  it('gilt auch für die Charge einer Körner-Sorte, nicht nur für Laborarbeit', () => {
    // Eine Sorte, deren Rezept auf Körner lautet, kommt als Charge durch den
    // Dialog — und hatte dort gar kein Gewichtsfeld, sondern nahm stumm
    // recGrainKg. Damit war genau der Weg ohne Größen, den die Kachel anbietet.
    const f = hebeFunktion('_msqIsGrain', SRC);
    assert.match(f, /recBatchType === 'grain'/, '_msqIsGrain erkennt die Körner-Charge nicht');
    assert.match(f, /_msqIsGrainspawn\(\)/, '_msqIsGrain erkennt die Laborarbeit nicht');
  });
});

// ── Die Zeilen des langen Formulars, von aussen gefüllt ──────

// Attrappen für die Gewichtszeilen. Kein jsdom hier — siehe
// test/mobile-nav.test.js zum selben Grund.
function formular() {
  const rows = [];
  const mkRow = () => {
    const felder = {
      '.gs-line-kg': { value: '' },
      '.gs-line-qty': { value: '' },
      '.gs-line-rm': { style: {} }
    };
    const btns = ['0.7', '1', '2', '5'].map((kg) => ({ dataset: { kg }, className: '' }));
    const row = {
      querySelector: (s) => felder[s] || null,
      querySelectorAll: (s) => (s === '.gs-wbtn' ? btns : []),
      cloneNode: () => mkRow(),
      remove() {
        const i = rows.indexOf(row);
        if (i >= 0) rows.splice(i, 1);
      }
    };
    return row;
  };
  rows.push(mkRow());
  const container = {
    querySelector: () => rows[0] || null,
    querySelectorAll: () => rows.slice(),
    appendChild: (r) => rows.push(r)
  };
  const doc = {
    getElementById: (id) => (id === 'gs-weight-lines' ? container : null),
    querySelectorAll: () => rows.slice()
  };
  const code = [
    hebeFunktion('gsReadLines', SRC),
    hebeFunktion('gsAddLine', SRC),
    hebeFunktion('gsUpdateRemoveButtons', SRC),
    hebeFunktion('gsResetLines', SRC),
    hebeFunktion('gsSetLines', SRC)
  ].join('\n');
  return (lines) =>
    new Function(
      'document',
      'parseDecimal',
      'gsPreview',
      code + '\ngsSetLines(' + JSON.stringify(lines) + ');\nreturn gsReadLines();'
    )(
      doc,
      (v) => parseFloat(String(v).replace(',', '.')),
      () => {}
    );
}

describe('gsSetLines', () => {
  it('legt so viele Zeilen an, wie Größen angesetzt werden', () => {
    const lauf = formular();
    const gelesen = lauf([
      { kg: 1, qty: 10 },
      { kg: 2, qty: 5 },
      { kg: 3, qty: 2 }
    ]);
    assert.deepEqual(gelesen, [
      { kg: 1, qty: 10 },
      { kg: 2, qty: 5 },
      { kg: 3, qty: 2 }
    ]);
  });

  it('räumt die Zeilen des vorigen Ansatzes weg', () => {
    // Zweimal hintereinander durch denselben Dialog: die zweite Charge darf
    // nicht die Größen der ersten erben.
    const lauf = formular();
    lauf([
      { kg: 1, qty: 10 },
      { kg: 2, qty: 5 }
    ]);
    assert.deepEqual(lauf([{ kg: 5, qty: 3 }]), [{ kg: 5, qty: 3 }]);
  });
});

// ── Was davon in der Datenbank ankommt ───────────────────────

describe('Eine Charge, mehrere Gewichte', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    db.applyInventoryDelta(d, 'grain', 500, 'delivery', 'seed');
    db.insertBatch(
      d,
      {
        batchId: 'G-BO-20260917-01',
        species: 'Blue Oyster (BO)',
        strain: 'BO',
        qty: 17,
        days: 14,
        // Die Charge trägt die Größe, aus der die meisten Beutel sind — nicht
        // null, denn insertBatch macht daraus `|| 3`, und eine 3 hat hier
        // niemand angesetzt.
        bagKg: 1,
        batchType: 'grain',
        grainRh: 52,
        created: '2026-09-17T08:00:00Z',
        due: '2026-10-01T08:00:00Z',
        bags: [
          ...Array.from({ length: 10 }, (_, i) => ({
            id: 'G-BO-20260917-01-' + String(i + 1).padStart(2, '0'),
            bagKg: 1
          })),
          ...Array.from({ length: 5 }, (_, i) => ({
            id: 'G-BO-20260917-01-' + String(i + 11).padStart(2, '0'),
            bagKg: 2
          })),
          ...Array.from({ length: 2 }, (_, i) => ({
            id: 'G-BO-20260917-01-' + String(i + 16).padStart(2, '0'),
            bagKg: 3
          }))
        ]
      },
      null,
      null
    );
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('gibt jedem Beutel sein eigenes Gewicht zurück', () => {
    const b = db.readBatchById(d, 'G-BO-20260917-01');
    assert.equal(b.qty, 17);
    assert.equal(b.bagWeights['G-BO-20260917-01-01'], 1);
    assert.equal(b.bagWeights['G-BO-20260917-01-11'], 2);
    assert.equal(b.bagWeights['G-BO-20260917-01-16'], 3);
    const summe = Object.values(b.bagWeights).reduce((s, w) => s + w, 0);
    assert.equal(summe, 10 * 1 + 5 * 2 + 2 * 3);
  });

  it('ergänzt Beutel mit dem angegebenen Gewicht, nicht mit dem der Charge', () => {
    // Nachträglich zwei 5-kg-Beutel. Ohne Gewicht bekämen sie das der Charge
    // (1 kg) und stünden dann mit einer falschen Zahl auf dem Etikett.
    const vorher = db.readAll(d).inventory.stock.grain;
    db.addBagsToBatch(d, 'G-BO-20260917-01', ['G-BO-20260917-01-18', 'G-BO-20260917-01-19'], 19, 5, null);
    const b = db.readBatchById(d, 'G-BO-20260917-01');
    assert.equal(b.bagWeights['G-BO-20260917-01-18'], 5);
    assert.equal(b.bagWeights['G-BO-20260917-01-19'], 5);
    // 2 × 5 kg nass bei 52 % Wasser = 4,8 kg trockenes Korn vom Lager.
    const nachher = db.readAll(d).inventory.stock.grain;
    assert.ok(Math.abs(vorher - nachher - 4.8) < 1e-6, 'abgebucht: ' + (vorher - nachher));
  });

  it('nimmt ohne Angabe weiterhin das Gewicht der Charge', () => {
    db.addBagsToBatch(d, 'G-BO-20260917-01', ['G-BO-20260917-01-20'], 20, undefined, null);
    const b = db.readBatchById(d, 'G-BO-20260917-01');
    assert.equal(b.bagWeights['G-BO-20260917-01-20'], 1);
  });
});

// ── Das Etikett ──────────────────────────────────────────────

describe('Das Gewicht auf dem Etikett', () => {
  const bagLabelKg = new Function(
    'batch',
    'bagId',
    hebeFunktion('bagLabelKg', SRC) + '\nreturn bagLabelKg(batch, bagId);'
  );

  it('nennt es auch bei einer Charge aus lauter gleichen Beuteln', () => {
    // Der Kern der Sache: früher wurde das Gewicht nur weitergereicht, wenn die
    // Charge gemischte Größen trug. Im Regal steht der Beutel allein.
    const batch = { bagKg: 2, bagWeights: { 'G-BO-01': 2, 'G-BO-02': 2 } };
    assert.equal(bagLabelKg(batch, 'G-BO-01'), 2);
  });

  it('nennt bei gemischten Größen die des jeweiligen Beutels', () => {
    const batch = { bagKg: 1, bagWeights: { 'G-BO-01': 1, 'G-BO-11': 2, 'G-BO-16': 3 } };
    assert.equal(bagLabelKg(batch, 'G-BO-01'), 1);
    assert.equal(bagLabelKg(batch, 'G-BO-11'), 2);
    assert.equal(bagLabelKg(batch, 'G-BO-16'), 3);
  });

  it('fällt auf das Gewicht der Charge zurück, und erfindet sonst keines', () => {
    assert.equal(bagLabelKg({ bagKg: 3.8, bagWeights: {} }, 'FB-01'), 3.8);
    assert.equal(bagLabelKg({ bagWeights: {} }, 'FB-01'), null, 'eine erfundene Zahl ist schlimmer als keine');
    assert.equal(bagLabelKg({ bagKg: 0, bagWeights: { 'FB-01': 0 } }, 'FB-01'), null);
  });

  it('druckt es mit Komma, nicht mit Punkt', () => {
    // Das Etikett liest ein Mensch in einer deutschen Halle. "3.8kg" ist eine
    // Programmiersprache.
    const batch = { strainName: 'Blue Oyster', batchType: 'block', notes: '', strainText: '' };
    const zeilen = bagLabelItems('FB-2026-001-01', batch, 'sorte', 42, false, 3.8).map((i) => i.text || '');
    assert.ok(
      zeilen.some((x) => x.includes('3,8kg')),
      'Gewicht fehlt oder steht mit Punkt: ' + JSON.stringify(zeilen)
    );
  });

  it('lässt eine ganze Zahl ganz', () => {
    const batch = { strainName: 'Blue Oyster', batchType: 'grain', notes: '', strainText: '' };
    const zeilen = bagLabelItems('G-BO-20260917-01-01', batch, 'sorte', 42, false, 1).map((i) => i.text || '');
    assert.ok(
      zeilen.some((x) => x.includes('1kg')),
      JSON.stringify(zeilen)
    );
    assert.ok(!zeilen.some((x) => x.includes('1,0kg')));
  });

  it('gibt jedem Beutel sein eigenes Gewicht mit — auch in der Vorschau', () => {
    // Vorschau und Druck lesen dasselbe. Liefe eines der beiden noch über die
    // alte "nur bei gemischt"-Regel, zeigte der Bildschirm etwas anderes als
    // das Etikett.
    for (const [name, fn] of [
      ['makeBagZPL', hebeFunktion('makeBagZPL', SRC)],
      ['renderBagPreview', hebeFunktion('renderBagPreview', SRC)]
    ]) {
      assert.match(fn, /bagLabelKg\(batch, bagId\)/, name + ' reicht das Gewicht nicht je Beutel durch');
      assert.doesNotMatch(fn, /mixed/, name + ' entscheidet immer noch danach, ob die Charge gemischt ist');
    }
  });
});
