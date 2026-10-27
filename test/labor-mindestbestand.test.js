'use strict';
// Was das Labor vorrätig halten muss, und was passiert, wenn es das nicht tut.
//
// Die Untergrenzen gab es schon (v69) und die Labor-Karte zeichnete sie auch —
// nur sah sie eben nur, wer hinging und nachschaute. Der ganze Sinn einer
// Untergrenze ist, dass sie sich meldet, ohne gefragt zu werden. Diese Zeilen
// stehen jetzt in der Tagesliste, abgeleitet wie die Umlager- und Ernte-Zeilen:
// drei Platten mehr gegossen, Zeile weg. Kein Häkchen, das man vergessen kann.
//
// Zwei Dinge, die beim Schreiben aufgefallen sind und hier festgehalten werden:
//
//   strainMinFor() las min_lc für JEDEN Kulturtyp, der nicht Körnerbrut war —
//   und traf davor auf ein `return 0`, das Slants und Petrischalen ganz ohne
//   Untergrenze ließ. Ein Slant ist die Langzeit-Sicherung, eine Platte das
//   Arbeitsmaterial, ein Glas LC das, was in die Körner geht. Drei Gründe, drei
//   Mengen, seit v79 drei Zahlen.
//
//   strainsInProduction() hieß "jede Sorte mit einer lebenden Charge" und war
//   damit im einzigen wichtigen Fall zirkulär: eine Sorte, die ausgegangen ist,
//   hat keine lebende Charge, fiel aus der Liste und verlor ihre Nullzeile
//   genau dann, wenn sie zählt.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf, hebeKonstante: _hk } = require('./helpers/quelle');

const SRC = quelle();
const hebeFunktion = (n) => _hf(n, SRC);
const hebeKonstante = (n) => _hk(n, SRC);

// kulturen: [{typ, sorte, kz}] — je Eintrag eine aktive Kultur.
// sorten:   [{name, kuerzel, imProgramm, minMc, minPd, minLc, minSpawnKg}]
function lauf(ausdruck, { kulturen = [], sorten = [], chargen = [] } = {}) {
  const code = [
    hebeKonstante('LAB_TYPES'),
    hebeKonstante('MIN_TYPES'),
    hebeKonstante('STRAIN_MIN_FIELD'),
    hebeKonstante('ARCHIVED_STATUSES'),
    hebeFunktion('_spKey'),
    hebeFunktion('sorteKey'),
    hebeFunktion('_strainKeys'),
    hebeFunktion('sorteName'),
    hebeFunktion('_grainKgOf'),
    hebeFunktion('_labKey'),
    hebeFunktion('_labName'),
    hebeFunktion('strainsInProduction'),
    hebeFunktion('_strainOfEntry'),
    hebeFunktion('getLabStrainBreakdown'),
    'return ' + ausdruck + ';'
  ].join('\n');
  return new Function(
    'cultures',
    'batches',
    'mushroomStrains',
    `
    const t = (k, p) => (p ? k + ':' + Object.values(p).join(',') : k);
    const fmtKg = (v) => String(v);
    const spColor = () => '#888';
    const getStatus = () => ({ status: 'INCUBATING' });
    const isArchivedStatus = (s) => ARCHIVED_STATUSES.includes(s);
    const _hasScanByBatch = new Map(batches.map((b) => [b.batchId, true]));
    const getLabLabel = (x) => x;
    ${code}
  `
  )(
    kulturen.map((c, i) => ({
      id: 'C' + i,
      type: c.typ,
      status: 'active',
      species: c.sorte,
      strainName: c.sorte,
      strain: c.kz || '',
      strainKuerzel: c.kz || ''
    })),
    chargen,
    sorten.map((s) => ({ id: 1, description: '', ...s }))
  );
}

const SH = { name: 'Shiitake', kuerzel: 'SH', imProgramm: true };

// Die Untergrenzen selbst rechnet jetzt db.labStock, für Laborseite und
// Tagesliste zugleich; ihre Regeln prüft laborbestand.test.js.
describe('Welche Sorten das Labor bevorraten muss', () => {
  it('fragt das Programm, nicht die vorhandenen Chargen', () => {
    // Der zirkuläre Fall: keine lebende Charge, weil die Sorte ausgegangen ist.
    // Genau dann muss die Nullzeile stehen.
    const inProd = lauf('strainsInProduction()', { sorten: [SH], chargen: [] });
    assert.equal(inProd.size, 1);
    assert.equal([...inProd.values()][0].name, 'Shiitake');
  });

  it('nimmt eine Sorte mit lebender Charge dazu, auch ohne Eintrag', () => {
    // Sie wird angebaut, es hat nur niemand aufgeschrieben.
    const inProd = lauf('strainsInProduction()', {
      sorten: [],
      chargen: [{ batchId: 'BO-1', species: 'Blue Oyster', strainName: 'Blue Oyster', strain: 'BO' }]
    });
    assert.equal(inProd.size, 1);
    assert.equal([...inProd.values()][0].name, 'Blue Oyster');
  });

  it('lässt eine geparkte Sorte draußen, auch wenn noch Chargen laufen', () => {
    // Restbestand ist kein Grund, wieder Vorrat zu verlangen.
    const inProd = lauf('strainsInProduction()', {
      sorten: [{ name: 'Shiitake', kuerzel: 'SH', imProgramm: false }],
      chargen: [{ batchId: 'SH-1', species: 'Shiitake', strainName: 'Shiitake', strain: 'SH' }]
    });
    assert.equal(inProd.size, 0);
  });
});
