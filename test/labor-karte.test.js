'use strict';
// Was die Labor-Karte tatsächlich zeichnet.
//
// Sie benutzt jetzt dieselbe Kachel wie der Chargen-Reiter — dasselbe Gehäuse,
// derselbe gestapelte Balken, dieselbe Ampel —, weil sie dieselbe Art Frage über
// ein anderes Regal beantwortet: wie viel ist da, von welcher Sorte, und fehlt
// etwas. Vorher war sie eine eigene Anordnung aus Inline-Styles, und die zwei
// Seiten brachten dem Leser zwei Vokabeln für einen Gedanken bei.
//
// Geprüft wird das Markup, nicht das Aussehen: ob die richtigen Zeilen rot
// werden, ob die Ampel den richtigen Zustand nennt, und ob die vier Typen mit
// eigener Untergrenze auch daran gemessen werden — das war der Fehler, den die
// Karte hatte, nachdem v79 Slants und Petrischalen eigene Zahlen gegeben hatte.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf, hebeKonstante: _hk } = require('./helpers/quelle');

const SRC = quelle();
const hebeFunktion = (n) => _hf(n, SRC);
const hebeKonstante = (n) => _hk(n, SRC);

// kulturen: [{typ, sorte, kz}]   sorten: [{name, kuerzel, imProgramm, min*}]
function zeichne({ kulturen = [], sorten = [], schwellen = {} } = {}) {
  const code = [
    hebeKonstante('LAB_TYPES'),
    hebeKonstante('MIN_TYPES'),
    hebeKonstante('STRAIN_MIN_FIELD'),
    hebeKonstante('LAB_TYPE_COLORS'),
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
    hebeFunktion('strainMinFor'),
    hebeFunktion('getLabStrainBreakdown'),
    hebeFunktion('renderDashLabStock'),
    'renderDashLabStock();'
  ].join('\n');
  const ziel = { innerHTML: '' };
  new Function(
    'cultures',
    'batches',
    'mushroomStrains',
    'inventory',
    'ziel',
    `
    const t = (k) => k;
    const esc = (x) => String(x == null ? '' : x);
    const fmtKg = (v, d) => Number(v).toFixed(d);
    const spColor = () => '#888888';
    const safeColor = (c) => c || '#888888';
    const getStatus = () => ({ status: 'INCUBATING' });
    const isArchivedStatus = (s) => ARCHIVED_STATUSES.includes(s);
    const _hasScanByBatch = new Map(batches.map((b) => [b.batchId, true]));
    const getLabLabel = (x) => 'label:' + x;
    const getLabStockCounts = () => {
      const c = { MC: 0, PD: 0, LC: 0, G2G: 0, GS: 0, SY: 0 };
      for (const k of cultures) if (c[k.type] !== undefined) c[k.type]++;
      return c;
    };
    const document = { getElementById: () => ziel };
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
    [],
    sorten.map((s) => ({ id: 1, description: '', ...s })),
    { labThresholds: { MC: 0, PD: 0, LC: 0, G2G: 0, GS: 0, SY: 0, ...schwellen } },
    ziel
  );
  return ziel.innerHTML;
}

const SH = { name: 'Shiitake', kuerzel: 'SH', imProgramm: true };
const kultur = (typ) => ({ typ, sorte: 'Shiitake', kz: 'SH' });
// Der Abschnitt einer Kachel, von ihrem Typ-Chip bis zum nächsten.
function kachel(html, typ) {
  const i = html.indexOf('>' + typ + '<');
  assert.ok(i > 0, 'keine Kachel für ' + typ);
  const start = html.lastIndexOf('<div class="stile', i);
  const next = html.indexOf('<div class="stile', i);
  return html.slice(start, next === -1 ? undefined : next);
}

describe('Labor-Karte', () => {
  it('zeichnet eine Kachel je Kulturtyp', () => {
    const html = zeichne({ sorten: [SH] });
    assert.equal((html.match(/<div class="stile/g) || []).length, 6, 'MC, PD, LC, G2G, GS, SY');
    assert.ok(html.startsWith('<div class="sorten-grid">'), 'im selben Raster wie die Chargen-Kacheln');
  });

  it('lässt nichts Undefiniertes durch', () => {
    const html = zeichne({ sorten: [{ ...SH, minMc: 3, minPd: 2 }], kulturen: [kultur('MC'), kultur('LC')] });
    assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
  });

  it('färbt die Zahl rot, wenn eine Sorte unter ihrer Untergrenze liegt', () => {
    // Der Fehler nach v79: die Karte prüfte weiter nur GS und LC, also konnten
    // Slants und Petrischalen ihr Ziel anzeigen und nie rot werden.
    const html = zeichne({ sorten: [{ ...SH, minMc: 4 }], kulturen: [kultur('MC')] });
    const mc = kachel(html, 'MC');
    assert.match(mc, /class="lab-row[^"]*under/, 'ein Slant von vier muss auffallen');
    assert.match(mc, /\/4/, 'und die Zielzahl nennen');
  });

  it('prüft alle vier Typen mit eigener Untergrenze, nicht nur zwei', () => {
    const html = zeichne({
      sorten: [{ ...SH, minMc: 2, minPd: 2, minLc: 2, minSpawnKg: 2 }],
      kulturen: [kultur('MC'), kultur('PD'), kultur('LC')]
    });
    for (const typ of ['MC', 'PD', 'LC']) {
      assert.match(kachel(html, typ), /class="lab-row[^"]*under/, typ + ' wird nicht gegen seine eigene Zahl geprüft');
    }
  });

  it('unterscheidet "gar nichts mehr" von "zu wenig"', () => {
    const knapp = kachel(zeichne({ sorten: [{ ...SH, minMc: 4 }], kulturen: [kultur('MC')] }), 'MC');
    assert.match(knapp, /sup-low/);
    const leer = kachel(zeichne({ sorten: [{ ...SH, minMc: 4 }], kulturen: [] }), 'MC');
    assert.match(leer, /sup-now/, 'nichts mehr da ist ein anderes Problem als ein bisschen zu wenig');
    assert.match(leer, /urgent/, 'und wird wie auf dem Chargen-Reiter gerahmt');
  });

  it('meldet nichts, wo keine Untergrenze gesetzt ist', () => {
    const html = zeichne({ sorten: [SH], kulturen: [kultur('MC')] });
    assert.match(kachel(html, 'MC'), /sup-ok/);
    assert.doesNotMatch(kachel(html, 'MC'), /urgent/);
  });

  it('misst G2G und Spritzen an der betriebsweiten Schwelle', () => {
    // Sie werden auf Bestellung gemacht; eine Untergrenze je Sorte würde Vorrat
    // verlangen, den niemand hält.
    const html = zeichne({ sorten: [SH], schwellen: { SY: 5 } });
    assert.match(kachel(html, 'SY'), /sup-now/, 'null von fünf');
    assert.match(kachel(html, 'SY'), /min 5/, 'und die Schwelle steht daneben');
    // Und ohne gesetzte Schwelle bleibt die Kachel still, statt null zu rügen.
    assert.match(kachel(zeichne({ sorten: [SH] }), 'SY'), /sup-ok/);
  });

  it('wiegt Körnerbrut und zählt alles andere', () => {
    const html = zeichne({ sorten: [{ ...SH, minSpawnKg: 2 }] });
    assert.match(kachel(html, 'GS'), /lab\.kgUnit/, 'Körner in Kilogramm');
    assert.match(kachel(html, 'MC'), /lab\.piecesUnit/, 'Slants in Stück');
  });

  it('macht jede Sorten-Zeile zum Knopf für ihre eigene Untergrenze', () => {
    // Die Zahl je Sorte lag nur im Pilzsorten-Formular, und der einzige Knopf
    // auf dieser Karte setzte die betriebsweite — eine andere Zahl, aus der nie
    // eine Tagesaufgabe entsteht. Vierzehn Sorten mal vier Typen war der Weg.
    const html = zeichne({ sorten: [{ ...SH, minMc: 4 }], kulturen: [kultur('MC')] });
    const mc = kachel(html, 'MC');
    assert.match(mc, /data-action="lab-set-strain-min"/, 'die Zeile selbst setzt die Zahl');
    assert.match(mc, /data-strain="1"/, 'und nennt dabei die Sorte, nicht nur den Typ');
    assert.match(mc, /data-labtype="MC"/);
  });

  it('bietet keinen Knopf, wo es nichts zu setzen gibt', () => {
    // G2G und Spritzen haben keine Spalte je Sorte, und eine Sorte ohne
    // Pilzsorten-Zeile hat nichts, wohin die Zahl geschrieben würde.
    const html = zeichne({ sorten: [SH], kulturen: [{ typ: 'G2G', sorte: 'Shiitake', kz: 'SH' }] });
    assert.doesNotMatch(kachel(html, 'G2G'), /lab-set-strain-min/);
  });

  it('gibt jedem Knopf seinen Typ mit, statt inline zu rufen', () => {
    const html = zeichne({ sorten: [SH] });
    assert.equal((html.match(/data-action="lab-set-min"/g) || []).length, 6);
    assert.doesNotMatch(html, /onclick=/, 'die Karte wird bei jedem Sync neu gebaut — Handler werden delegiert');
  });
});
