'use strict';
// Zonen: "Wo steht …?" und aufklappbare Regale.
//
// Nachsehen, wo eine Sorte steht, ging nur über Chargen → Mehr → Standorte und
// dort Raum für Raum. Jetzt wählt man oben auf Zonen eine Sorte und sieht jedes
// Fach mit der Zahl, bei Körnerbrut mit der Größe der Beutel; ein Tipp auf eine
// Regal-Kachel klappt seine Fächer auf. Die Einstellungen des Regals stehen
// darunter hinter "Regal bearbeiten".
//
// Alle Räume, Regale, Sorten und Chargen hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const ROLLEN = APP.match(/^const ROLE_ORDER = [^\n]*/m)[0];
const BRETT_RE = APP.match(/^const BRETT_RE = [^\n]*/m)[0];

const ZONEN = [
  { id: 'ZELT9', name: 'Testzelt', role: 'fruiting', sortOrder: 1, racks: [] },
  { id: 'KONTA', name: 'Testkontamination', role: 'contaminated', sortOrder: 2, racks: [] },
  {
    id: 'INK9',
    name: 'Testinkubation',
    role: 'incubation',
    sortOrder: 3,
    racks: [
      { id: 'INK9_R1', levels: 3, strainId: 7 },
      { id: 'INK9_R2', levels: 0, strainId: null }
    ]
  },
  { id: 'KORN9', name: 'Testkorn', role: 'spawn', sortOrder: 4, racks: [{ id: 'KORN9_R1', levels: 4, strainId: null }] }
];

const CHARGEN = [
  {
    batchId: 'K-1',
    batchType: 'grain',
    strainName: 'Testpilz',
    strainId: 7,
    created: '2026-01-02',
    bagKg: 5,
    bagWeights: { 'K-1-1': 1, 'K-1-2': 5 }
  },
  {
    batchId: 'K-2',
    batchType: 'grain',
    strainName: 'Testpilz',
    strainId: 7,
    created: '2026-01-05',
    bagKg: 2,
    bagWeights: {}
  },
  { batchId: 'B-1', batchType: 'block', strainName: 'Testpilz', strainId: 7, created: '2026-01-03', bagKg: 3 },
  { batchId: 'B-2', batchType: 'block', strainName: 'Anderpilz', strainId: 8, created: '2026-01-04', bagKg: 3 }
];

// Platz → Einträge, wie brettPlaetze() sie liefert.
const PLAETZE = [
  [
    'KORN9_R1:2',
    [
      { bag: 'K-1-1', batch: 'K-1', to: 'KORN9_R1:2' },
      { bag: 'K-1-2', batch: 'K-1', to: 'KORN9_R1:2' }
    ]
  ],
  ['KORN9_R1:1', [{ bag: 'K-2-1', batch: 'K-2', to: 'KORN9_R1:1' }]],
  ['KORN9', [{ bag: 'K-2-2', batch: 'K-2', to: 'KORN9' }]],
  [
    'INK9_R1:1',
    [
      { bag: 'B-1-1', batch: 'B-1', to: 'INK9_R1:1' },
      { bag: 'B-2-1', batch: 'B-2', to: 'INK9_R1:1' }
    ]
  ],
  ['INK9_R2', [{ bag: 'B-1-2', batch: 'B-1', to: 'INK9_R2' }]],
  ['ZELT9', [{ bag: 'B-1-3', batch: 'B-1', to: 'ZELT9' }]],
  ['KONTA', [{ bag: 'B-1-4', batch: 'B-1', to: 'KONTA' }]]
];

function welt({ plaetze = PLAETZE } = {}) {
  const els = {};
  const offen = [];
  const api = new Function(
    'zones',
    'chargen',
    'plaetze',
    'els',
    'offen',
    `const datenGeladen = true;
    const document = { getElementById: (id) => (els[id] = els[id] || { innerHTML: '' }) };
    const t = (k, p) => k + (p ? JSON.stringify(p) : '');
    const tp = (k, n) => k + ':' + n;
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const safeColor = (c) => c;
    const ZONE_BY_ID = Object.fromEntries(zones.map((z) => [z.id, z]));
    const RACK_ZONE = Object.fromEntries(zones.flatMap((z) => z.racks.map((r) => [r.id, z.id])));
    const toZone = (loc) => RACK_ZONE[String(loc).split(':')[0]] || String(loc).split(':')[0];
    const batchById = (id) => chargen.find((b) => b.batchId === id);
    const sorteName = (b) => b.strainName;
    const brettPlaetze = () => new Map(plaetze);
    const brettZustand = () => ({ k: 'ok' });
    const rackLabel = (id) => 'Regal ' + id.slice(-1);
    const brettName = (loc) => rackLabel(loc.split(':')[0]) + ' · Fach ' + loc.split(':')[1];
    const zoneDisplayName = (id) => zones.find((z) => z.id === id).name;
    const getZoneBags = () => ({});
    const getRackBags = () => ({});
    const brettOhne = () => [];
    const brettArt = () => null;
    const brettOeffne = (o) => offen.push(o);
    ${ROLLEN}
    ${BRETT_RE}
    ${[
      'zonenReihe',
      'brettVon',
      'brettOrt',
      'rackVon',
      'brettZoneMitBrettern',
      '_brettInfo',
      'brettAelter',
      'brettBeutel',
      'beutelKg',
      'kgText',
      'kgAufstellung',
      '_zonenArtName',
      'zonenBeutel',
      'zonenArten',
      'zonenPlatz',
      'zonenFunde',
      'fachChips',
      '_zonenOffen',
      'zonenSucheHtml',
      'zonenRegalHtml',
      'zonenRegalUmschalten',
      'zonenFundZiel',
      'zonenKarte',
      'zonenKontamHtml',
      'renderZones'
    ]
      .map((n) => hebeFunktion(n, APP))
      .join('\n')}
    let _zonenArt = '';
    const _zonenAuf = new Set();
    return {
      waehle: (k) => { _zonenArt = k; renderZones(); return els['zones-list'].innerHTML; },
      zeige: () => { renderZones(); return els['zones-list'].innerHTML; },
      umschalten: (id) => { zonenRegalUmschalten(id); return els['zones-list'].innerHTML; },
      funde: (k) => zonenFunde(zonenBeutel(), k),
      arten: () => zonenArten(zonenBeutel()),
      kg: (list) => kgAufstellung(list.map((e) => _brettInfo(e))),
      ziel: zonenFundZiel
    };`
  )(ZONEN, CHARGEN, plaetze, els, offen);
  return api;
}

describe('Wo steht …? — die Sorten', () => {
  it('jede Sorte im Haus mit ihrer Zahl, nach Namen; Kontamination zählt nicht', () => {
    const arten = welt().arten();
    assert.deepEqual(
      arten.map((a) => [a.key, a.n]),
      [
        ['anderpilz', 1],
        ['testpilz', 7]
      ]
    );
  });

  it('ohne Wahl nur die Auswahl, keine Liste', () => {
    const html = welt().zeige();
    assert.match(html, /<select id="zonen-art"><option value="">zones\.findPick<\/option>/);
    assert.match(html, /<option value="testpilz">Testpilz · dash\.bags:7<\/option>/);
    assert.doesNotMatch(html, /zonen-funde/);
  });
});

describe('Wo steht …? — die Plätze einer Sorte', () => {
  it('je Fach eine Zeile, in der Reihe der Räume, dann Regal und Fach; "in keinem Fach" am Ende des Raums', () => {
    const namen = welt()
      .funde('testpilz')
      .map((f) => f.name);
    assert.deepEqual(namen, [
      'Testkorn · Regal 1 · Fach 1',
      'Testkorn · Regal 1 · Fach 2',
      'Testkorn · zones.notInFach',
      'Testinkubation · Regal 1 · Fach 1',
      'Testinkubation · Regal 2',
      'Testzelt'
    ]);
  });

  it('nur die gewählte Sorte: im geteilten Fach zählt die andere nicht mit', () => {
    const fach = welt()
      .funde('testpilz')
      .find((f) => f.name === 'Testinkubation · Regal 1 · Fach 1');
    assert.deepEqual(
      fach.bags.map((x) => x.bag),
      ['B-1-1']
    );
  });

  it('jede Zeile öffnet das passende Blatt: Fach, in keinem Fach, Regal, Zelt', () => {
    const f = welt().funde('testpilz');
    assert.deepEqual(
      f.map((x) => x.open),
      [
        { kind: 'platz', loc: 'KORN9_R1:1' },
        { kind: 'platz', loc: 'KORN9_R1:2' },
        { kind: 'frei', zone: 'KORN9', strainId: 7 },
        { kind: 'platz', loc: 'INK9_R1:1' },
        { kind: 'platz', loc: 'INK9_R2' },
        { kind: 'zelt', zone: 'ZELT9', strainId: 7 }
      ]
    );
  });

  it('Körnerbrut sagt die Größe je Beutel, Blöcke nur die Zahl', () => {
    const html = welt().waehle('testpilz');
    const zeilen = html.split('class="brett-zeile zonen-fund"').slice(1);
    // Fach 2: ein 1-kg- und ein 5-kg-Beutel derselben Charge, zwei Chips.
    assert.match(zeilen[1], /Fach 2[\s\S]*<b>1×<\/b> 1 kg<\/span><span class="brett-chip brett-ok"><b>1×<\/b> 5 kg</);
    // Fach 1: kein Gewicht je Beutel, also das der Charge.
    assert.match(zeilen[0], /<b>1×<\/b> 2 kg</);
    // Ein Block hat keine Größe.
    assert.match(zeilen[3], /<b>1×<\/b><\/span>/);
    assert.match(html, /<option value="testpilz" selected>/);
  });

  it('ein Tipp liest das Ziel aus der Zeile zurück, mit der Sorte als Zahl', () => {
    const w = welt();
    assert.deepEqual(w.ziel({ fundKind: 'frei', fundZone: 'KORN9', fundStrain: '7' }), {
      kind: 'frei',
      zone: 'KORN9',
      strainId: 7
    });
    assert.deepEqual(w.ziel({ fundKind: 'platz', fundLoc: 'INK9_R2' }), { kind: 'platz', loc: 'INK9_R2' });
  });

  it('eine Sorte, die nicht mehr im Haus steht, fällt aus der Wahl', () => {
    const w = welt({ plaetze: PLAETZE.filter(([loc]) => loc !== 'INK9_R1:1') });
    const html = w.waehle('anderpilz');
    assert.doesNotMatch(html, /zonen-funde/);
    assert.doesNotMatch(html, /selected/);
  });
});

describe('Zonen: ein Regal aufklappen', () => {
  it('ein Tipp auf die Kachel zeigt die Fächer mit Inhalt, ein zweiter klappt zu', () => {
    const w = welt();
    const auf = w.umschalten('KORN9_R1');
    assert.match(auf, /class="zone-tile on" data-action="rack-open" data-rack="KORN9_R1" aria-expanded="true"/);
    const regal = auf.split('data-zonen-regal="KORN9_R1"')[1];
    assert.equal((regal.match(/data-fund-kind="platz"/g) || []).length, 4, 'vier Fächer');
    assert.match(
      regal,
      /data-fund-loc="KORN9_R1:2"><span class="brett-zeile-n">2<\/span>[\s\S]*?<b>1×<\/b> Testpilz · 1 kg/
    );
    assert.match(
      regal,
      /data-fund-loc="KORN9_R1:3"><span class="brett-zeile-n">3<\/span><span class="brett-zeile-chips"><span class="brett-chip-leer">brett\.emptyShort/
    );
    assert.match(regal, /data-action="rack-edit" data-rack="KORN9_R1">zones\.rackSettings/);
    const zu = w.umschalten('KORN9_R1');
    assert.doesNotMatch(zu, /data-zonen-regal/);
    assert.match(zu, /aria-expanded="false"/);
  });

  it('ein Regal ohne Fächer ist eine Zeile mit dem, was darauf steht', () => {
    const regal = welt().umschalten('INK9_R2').split('data-zonen-regal="INK9_R2"')[1];
    assert.match(regal, /data-fund-loc="INK9_R2"><span class="brett-zeile-n">–<\/span>[\s\S]*?<b>1×<\/b> Testpilz</);
  });
});

describe('Körnerbrut: die Größe im Blatt des Fachs', () => {
  it('"2 × 1 kg · 1 × 5 kg", die kleinen zuerst; Blöcke ohne', () => {
    const w = welt();
    assert.equal(
      w.kg([
        { bag: 'K-1-2', batch: 'K-1' },
        { bag: 'K-1-1', batch: 'K-1' },
        { bag: 'K-1-1', batch: 'K-1' }
      ]),
      '2 × 1 kg · 1 × 5 kg'
    );
    assert.equal(w.kg([{ bag: 'B-1-1', batch: 'B-1' }]), '');
  });

  it('die Zeile im Blatt hängt die Größe an "gemacht"', () => {
    const f = hebeFunktion('_brettZeilenHtml', APP);
    assert.match(f, /kgAufstellung\(g\.bags\)/);
    assert.match(f, /t\('brett\.made', \{ d: fmtDtShort\(g\.made\) \}\) \+ \(kg \? ' · ' \+ kg : ''\)/);
  });
});

describe('Zonen: die Verdrahtung', () => {
  it('die Kachel klappt auf, "Regal bearbeiten" öffnet die Einstellungen, eine Zeile das Blatt', () => {
    assert.match(APP, /action === 'rack-open'\) zonenRegalUmschalten\(btn\.dataset\.rack\)/);
    assert.match(APP, /action === 'rack-edit'\) rackEditOpen\(btn\.dataset\.rack\)/);
    assert.match(APP, /closest\('\[data-fund-kind\]'\);\s*if \(el\) brettOeffne\(zonenFundZiel\(el\.dataset\)\)/);
    assert.match(APP, /e\.target\.id !== 'zonen-art'/);
  });
  it('die Liste steht unter dem Kopf der Seite, die Wahl zeichnet sie selbst', () => {
    assert.match(HTML, /<div class="page" id="p-zones">[\s\S]*?<div id="zones-list"><\/div>/);
  });
});
