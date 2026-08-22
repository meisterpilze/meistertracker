'use strict';
// Which Sorte needs a batch started — the question the Chargen tab could not
// answer, and the one it is actually opened with.
//
// The verdict reads grain and incubation SEPARATELY, and that separation is the
// whole point rather than a detail. They are two different lead times:
// incubation is the next harvest, grain is what the one after that gets made
// from. Folded into one "how much is behind this" number, a Sorte with a full
// incubation and no grain looks merely thin — when in fact it is fine today and
// certain to run dry in two cycles, which wants a different answer on a
// different day.
//
// The four states, and the case each one exists for:
//
//   now      grain 0, incubating 0   behind the fruiting blocks: nothing
//   nospawn  grain 0, incubating >0  next harvest yes, the one after it no
//   low      incubating < fruiting   the chain runs but is thinning
//   ok       otherwise
//
// Grain is counted apart rather than added in because stageOf() gives a BLOCK
// no spawn stage at all — every non-fruiting zone folds into 'incubation' for
// blocks, and only batchType 'grain' produces 'spawn'. Reading "bags in spawn"
// off a block would have made that number permanently zero. It is also a
// different unit: jars, not blocks.
//
// sorteRollup() is lifted out of app.js and run against stubs, the same way the
// other renderer tests here work — app.js has no module boundary.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle } = require('./helpers/quelle');

const SRC = quelle();

function hebeFunktion(name) {
  const re = new RegExp('^function ' + name + '\\([\\s\\S]*?\\r?\\n\\}', 'm');
  const m = SRC.match(re);
  assert.ok(m, name + '() nicht in app.js gefunden — der Test muss mitgeführt werden');
  return m[0];
}
function hebeKonstante(name) {
  const re = new RegExp('^const ' + name + ' = \\{[\\s\\S]*?\\r?\\n?\\};?$', 'm');
  const m = SRC.match(re);
  assert.ok(m, name + ' nicht in app.js gefunden');
  return m[0];
}

// Drei Zonen, eine je Phase — dieselben Rollen, die die App kennt.
const ZONEN = [
  { id: 'SPAWN', role: 'spawn' },
  { id: 'INC', role: 'incubation' },
  { id: 'TENT1', role: 'fruiting' },
  { id: 'CONTAM', role: 'contaminated' }
];

// `verteilung` ist {SPAWN, INC, TENT1, CONTAM} in Beuteln je Charge.
function rollup(chargen) {
  const code = [
    hebeKonstante('SUPPLY_RANK'),
    hebeFunktion('_stageBagsOf'),
    hebeFunktion('sorteRollup'),
    'return sorteRollup();'
  ].join('\n');
  return new Function(
    'batches',
    'zones',
    'statusByBatch',
    `
    const mushroomStrains = [];
    const t = (k) => k;
    const abbrev = (s) => String(s || '').slice(0, 2).toUpperCase();
    // Wie in app.js: Körner landen unabhängig von der Zone im Spawn.
    const stageOf = (role, batchType) =>
      role === 'fruiting' || role === 'contaminated' ? role : batchType === 'grain' ? 'spawn' : 'incubation';
    const getStatus = (id) => ({ c: statusByBatch[id] || {} });
    ${code}
  `
  )(
    chargen.map((c) => ({
      batchId: c.id,
      species: c.sorte,
      batchType: c.typ || 'block',
      days: c.tage == null ? 5 : c.tage,
      due: c.faellig || '2026-09-01T00:00:00.000Z',
      strainId: null
    })),
    ZONEN,
    Object.fromEntries(chargen.map((c) => [c.id, c.verteilung]))
  );
}
const nach = (rows, name) => rows.find((r) => r.name === name);

describe('Nachschub je Sorte', () => {
  it('sagt "jetzt ansetzen", wenn hinter der Fruchtung nichts steht', () => {
    const r = nach(rollup([{ id: 'SH-1', sorte: 'Shiitake', verteilung: { TENT1: 96 } }]), 'Shiitake');
    assert.equal(r.supply, 'now');
    assert.equal(r.fruiting, 96);
    assert.equal(r.grain, 0);
    assert.equal(r.incubation, 0);
  });

  it('trennt "Körner fehlen" von "knapp" — der Fall, um den es geht', () => {
    // 120 in der Inkubation, keine Körner. Die nächste Ernte ist gesichert, die
    // übernächste hat nichts zum Ansetzen. Zusammengezählt sähe das nur nach
    // "knapp" aus, und "knapp" heißt an einem anderen Tag etwas anderes tun.
    const r = nach(rollup([{ id: 'BO-1', sorte: 'Blue Oyster', verteilung: { INC: 120, TENT1: 192 } }]), 'Blue Oyster');
    assert.equal(r.supply, 'nospawn');
    assert.equal(r.incubation, 120);
    assert.equal(r.grain, 0);
  });

  it('nennt es "knapp", wenn die Kette läuft aber dünner wird', () => {
    const r = nach(
      rollup([
        { id: 'PP-G', sorte: 'Pioppino', typ: 'grain', verteilung: { SPAWN: 12 } },
        { id: 'PP-1', sorte: 'Pioppino', verteilung: { INC: 20, TENT1: 44 } }
      ]),
      'Pioppino'
    );
    assert.equal(r.supply, 'low');
    assert.equal(r.grain, 12);
  });

  it('nennt es "läuft", wenn mehr nachkommt als fruchtet', () => {
    const r = nach(
      rollup([
        { id: 'KO-G', sorte: 'King Oyster', typ: 'grain', verteilung: { SPAWN: 24 } },
        { id: 'KO-1', sorte: 'King Oyster', verteilung: { INC: 96, TENT1: 96 } }
      ]),
      'King Oyster'
    );
    assert.equal(r.supply, 'ok');
  });

  it('behandelt eine Sorte ohne aktive Beutel als "jetzt ansetzen"', () => {
    // Alles abgeerntet: die Charge existiert noch, Beutel stehen keine mehr.
    const r = nach(rollup([{ id: 'PO-1', sorte: 'Pink Oyster', verteilung: {} }]), 'Pink Oyster');
    assert.equal(r.supply, 'now');
    assert.equal(r.bags, 0);
    assert.equal(r.nBatches, 0, 'eine Charge ohne Beutel zählt nicht als aktive Charge');
    assert.equal(r.nAll, 1, 'sie verschwindet aber nicht — sonst fiele die Sorte ganz aus der Übersicht');
  });
});

describe('Nachschub — was in die Zahlen eingeht', () => {
  it('hält Körnergläser aus den Beutelzahlen heraus', () => {
    // Ein Glas macht mehrere Blöcke — die beiden zusammenzuzählen wäre genau
    // der Fehler, den diese Karte abstellen soll (die alte Leiste stellte
    // Chargenzahlen neben Beutelzahlen in eine Zeile). Die Körner zählen für
    // die Ampel und stehen als eigene Zahl da, nicht im Bestand.
    const rows = rollup([
      { id: 'SH-1', sorte: 'Shiitake', verteilung: { TENT1: 96 } },
      { id: 'SH-G1', sorte: 'Shiitake', typ: 'grain', verteilung: { SPAWN: 22 } }
    ]);
    const r = nach(rows, 'Shiitake');
    assert.equal(r.grain, 22);
    assert.equal(r.bags, 96, 'Gläser sind keine Beutel');
    assert.equal(r.nAll, 1, 'und eine Körnercharge ist keine Zeile der Chargenliste');
    // Nicht 'now': hinter der Fruchtung steht zwar kein Block, aber das Material
    // dafür liegt da. Blöcke ansetzen ist eine Arbeit von heute, Körner ansetzen
    // kostet Wochen — die beiden Fälle dürfen nicht dieselbe Ampel bekommen.
    assert.equal(r.supply, 'low');
  });

  it('zeigt eine Sorte, die es nur als Körner gibt', () => {
    // Kein Block, nur Gläser: "Spawn liegt bereit und niemand hat Blöcke daraus
    // gemacht" ist genau etwas, das man sehen will.
    const r = nach(rollup([{ id: 'RE-G', sorte: 'Reishi', typ: 'grain', verteilung: { SPAWN: 18 } }]), 'Reishi');
    assert.ok(r, 'die Sorte darf nicht aus der Übersicht fallen');
    assert.equal(r.grain, 18);
    assert.equal(r.bags, 0);
    assert.equal(r.nAll, 0);
  });

  it('summiert mehrere Chargen derselben Sorte', () => {
    const r = nach(
      rollup([
        { id: 'BO-1', sorte: 'Blue Oyster', verteilung: { INC: 72 } },
        { id: 'BO-2', sorte: 'Blue Oyster', verteilung: { INC: 48 } },
        { id: 'BO-3', sorte: 'Blue Oyster', verteilung: { TENT1: 192 } }
      ]),
      'Blue Oyster'
    );
    assert.equal(r.incubation, 120);
    assert.equal(r.fruiting, 192);
    assert.equal(r.bags, 312);
    assert.equal(r.nBatches, 3);
  });

  it('lässt kontaminierte Beutel weder als Nachschub noch als Bestand zählen', () => {
    const r = nach(rollup([{ id: 'SH-1', sorte: 'Shiitake', verteilung: { CONTAM: 48, TENT1: 96 } }]), 'Shiitake');
    assert.equal(r.contaminated, 48);
    assert.equal(r.bags, 96, 'kontaminierte Beutel sind kein Bestand');
    assert.equal(r.supply, 'now');
  });

  it('merkt sich, wie lange die letzte Charge her ist', () => {
    const r = nach(
      rollup([
        { id: 'LM-1', sorte: "Lion's Mane", tage: 27, verteilung: { TENT1: 48 } },
        { id: 'LM-2', sorte: "Lion's Mane", tage: 13, verteilung: { INC: 36 } }
      ]),
      "Lion's Mane"
    );
    assert.equal(r.lastDays, 13, 'die jüngste Charge zählt, nicht die erste gefundene');
  });

  it('hält die Sorten auseinander', () => {
    const rows = rollup([
      { id: 'BO-1', sorte: 'Blue Oyster', verteilung: { INC: 120 } },
      { id: 'SH-1', sorte: 'Shiitake', verteilung: { TENT1: 96 } }
    ]);
    assert.equal(rows.length, 2);
    assert.equal(nach(rows, 'Blue Oyster').supply, 'nospawn');
    assert.equal(nach(rows, 'Shiitake').supply, 'now');
  });

  it('sortiert die dringendste Sorte nach vorn', () => {
    // SUPPLY_RANK ist, was die Kacheln ordnen — die Sorte, für die etwas zu tun
    // ist, soll die sein, die man ohne Suchen sieht.
    const rang = new Function(hebeKonstante('SUPPLY_RANK') + '\nreturn SUPPLY_RANK;')();
    assert.deepEqual(
      ['ok', 'low', 'nospawn', 'now'].sort((a, b) => rang[a] - rang[b]),
      ['now', 'nospawn', 'low', 'ok']
    );
  });
});

describe('Sorten-Kacheln — was tatsächlich gezeichnet wird', () => {
  // Der Rollup kann stimmen und die Karte trotzdem "undefined" zeigen. Diese
  // Runde zeichnet wirklich und liest das Ergebnis.
  function zeichne(chargen, { legendeOffen = false, filter = null } = {}) {
    const code = [
      hebeKonstante('SUPPLY_RANK'),
      hebeFunktion('_stageBagsOf'),
      hebeFunktion('sorteRollup'),
      hebeFunktion('_sortSorten'),
      hebeFunktion('_stageSeg'),
      hebeFunktion('_stageNum'),
      hebeFunktion('_sorteTileBody'),
      hebeFunktion('renderSorteTiles'),
      'renderSorteTiles();'
    ].join('\n');
    const ziel = { innerHTML: '' };
    new Function(
      'batches',
      'zones',
      'statusByBatch',
      'batchSorteFilter',
      'batchLegendOpen',
      `
      const mushroomStrains = [];
      const datenGeladen = true;
      const batchTileSort = 'urgency';
      const t = (k, p) => (p ? k + ':' + Object.values(p).join(',') : k);
      const esc = (x) => String(x == null ? '' : x);
      const spDot = () => '<span class="sp-dot"></span>';
      const spColor = () => '#888';
      const fmtDt = () => '01.09.26';
      const abbrev = (s) => String(s || '').slice(0, 2).toUpperCase();
      const stageOf = (role, batchType) =>
        role === 'fruiting' || role === 'contaminated' ? role : batchType === 'grain' ? 'spawn' : 'incubation';
      const getStatus = (id) => ({ c: statusByBatch[id] || {} });
      const document = { getElementById: () => arguments[5] };
      ${code}
    `
    ).call(
      null,
      chargen.map((c) => ({
        batchId: c.id,
        species: c.sorte,
        batchType: c.typ || 'block',
        days: c.tage == null ? 5 : c.tage,
        due: '2026-09-01T00:00:00.000Z',
        strainId: null
      })),
      ZONEN,
      Object.fromEntries(chargen.map((c) => [c.id, c.verteilung])),
      filter,
      legendeOffen,
      ziel
    );
    return ziel.innerHTML;
  }

  const CHARGEN = [
    { id: 'SH-1', sorte: 'Shiitake', verteilung: { TENT1: 96 } },
    { id: 'BO-1', sorte: 'Blue Oyster', verteilung: { INC: 120, TENT1: 192 } },
    { id: 'KO-G', sorte: 'King Oyster', typ: 'grain', verteilung: { SPAWN: 24 } },
    { id: 'KO-1', sorte: 'King Oyster', verteilung: { INC: 96, TENT1: 96 } }
  ];

  // Eine Kachel kann gleichzeitig ausgewaehlt UND dringend sein, also
  // class="stile on urgent" — auf das schliessende Anfuehrungszeichen zu
  // pruefen findet genau die Faelle nicht, um die es geht.
  const ausgewaehlt = (html) => (html.match(/class="stile[^"]* on(?:"| )/g) || []).length;

  it('zeichnet die Summenkachel und je eine Kachel pro Sorte', () => {
    const html = zeichne(CHARGEN);
    assert.ok(html.includes('stile stile-total'), 'die Summenkachel fehlt');
    assert.equal((html.match(/data-action="sorte-tile"/g) || []).length, 3, 'eine Kachel je Sorte');
    assert.equal((html.match(/data-action="sorte-all"/g) || []).length, 1, 'und genau eine Summenkachel');
  });

  it('lässt nichts Undefiniertes und keine rohen Objekte durch', () => {
    for (const opts of [{}, { legendeOffen: true }, { filter: 'Shiitake' }]) {
      const html = zeichne(CHARGEN, opts);
      assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/, 'Ausgabe unsauber bei ' + JSON.stringify(opts));
    }
  });

  it('rahmt genau die Sorte ein, für die sofort etwas zu tun ist', () => {
    const html = zeichne(CHARGEN);
    // Shiitake: keine Körner, nichts in der Inkubation. Sonst niemand.
    assert.equal((html.match(/ urgent"/g) || []).length, 1);
  });

  it('hält die Legende zu, bis jemand sie öffnet', () => {
    const zu = zeichne(CHARGEN);
    assert.ok(zu.includes('data-action="sorte-legend"'), 'der Schalter muss immer da sein');
    assert.ok(!zu.includes('tlegend-note'), 'die Legende darf zugeklappt nicht im Markup stehen');
    assert.ok(zeichne(CHARGEN, { legendeOffen: true }).includes('tlegend-note'));
  });

  it('markiert die ausgewählte Kachel, und sonst keine', () => {
    // Shiitake ist zugleich die dringende Kachel — genau der Fall, in dem beide
    // Markierungen nebeneinander stehen müssen, ohne dass eine die andere frisst.
    const html = zeichne(CHARGEN, { filter: 'Shiitake' });
    assert.equal(ausgewaehlt(html), 1, 'genau eine Kachel ist ausgewählt');
    assert.match(html, /class="stile on urgent"/, 'ausgewählt und dringend zugleich');
    assert.ok(!html.includes('stile stile-total on'), 'die Summenkachel ist es dann nicht');
  });

  it('markiert die Summenkachel, wenn nichts gefiltert ist', () => {
    const html = zeichne(CHARGEN);
    assert.ok(html.includes('stile stile-total on'));
    assert.equal(ausgewaehlt(html), 1, 'und dann ist sonst keine markiert');
  });
});

describe('Sorten im Programm', () => {
  // Was die Farm gerade anbaut, wechselt mit der Jahreszeit. Ohne diese Angabe
  // muss jede abgeleitete Aussage annehmen, dass immer alles gewollt ist — und
  // dann meldet Shiitake im Sommer jeden Tag "jetzt ansetzen", per Definition:
  // keine Körner, nichts in der Inkubation, weil niemand welche macht. Eine
  // Warnung, die immer an ist, zieht die echten mit runter.
  function rollupMitProgramm(chargen, sorten) {
    const code = [
      hebeKonstante('SUPPLY_RANK'),
      hebeFunktion('_stageBagsOf'),
      hebeFunktion('sorteRollup'),
      'return sorteRollup();'
    ].join('\n');
    return new Function(
      'batches',
      'zones',
      'statusByBatch',
      'mushroomStrains',
      `
      const t = (k) => k;
      const abbrev = (s) => String(s || '').slice(0, 2).toUpperCase();
      const stageOf = (role, batchType) =>
        role === 'fruiting' || role === 'contaminated' ? role : batchType === 'grain' ? 'spawn' : 'incubation';
      const getStatus = (id) => ({ c: statusByBatch[id] || {} });
      ${code}
    `
    )(
      chargen.map((c) => ({
        batchId: c.id,
        species: c.sorte,
        batchType: c.typ || 'block',
        days: 5,
        due: '2026-09-01T00:00:00.000Z',
        strainId: null
      })),
      ZONEN,
      Object.fromEntries(chargen.map((c) => [c.id, c.verteilung])),
      sorten
    );
  }

  const SH_LEER = [{ id: 'SH-1', sorte: 'Shiitake', verteilung: { TENT1: 96 } }];

  it('meldet nichts für eine Sorte, die gerade nicht angebaut wird', () => {
    const r = nach(rollupMitProgramm(SH_LEER, [{ id: 1, name: 'Shiitake', imProgramm: false }]), 'Shiitake');
    assert.equal(r.supply, 'off');
  });

  it('meldet sie wieder, sobald sie im Programm steht', () => {
    const r = nach(rollupMitProgramm(SH_LEER, [{ id: 1, name: 'Shiitake', imProgramm: true }]), 'Shiitake');
    assert.equal(r.supply, 'now');
  });

  it('nimmt eine Sorte ohne Eintrag in den Pilzsorten als "im Programm" an', () => {
    // Sie wird angebaut, es hat nur niemand aufgeschrieben. Stillschweigend
    // abschalten würde echte Arbeit verstecken.
    const r = nach(rollupMitProgramm(SH_LEER, []), 'Shiitake');
    assert.equal(r.imProgramm, true);
    assert.equal(r.supply, 'now');
  });

  it('schaltet die Ampel aus, statt sie auf grün zu stellen', () => {
    // Grün behauptet "Nachschub ist in Ordnung". Wahr ist: es fragt niemand.
    const r = nach(rollupMitProgramm(SH_LEER, [{ id: 1, name: 'Shiitake', imProgramm: false }]), 'Shiitake');
    assert.notEqual(r.supply, 'ok');
    assert.equal(r.supply, 'off');
  });

  it('sortiert Sorten außerhalb des Programms ans Ende', () => {
    const rang = new Function(hebeKonstante('SUPPLY_RANK') + '\nreturn SUPPLY_RANK;')();
    assert.ok(rang.off > rang.ok, 'sonst stehen sie zwischen den Sorten, um die es geht');
  });

  it('vergleicht Namen ohne Rücksicht auf Groß- und Kleinschreibung', () => {
    // Die Charge trägt "Shiitake", die Pilzsorte "shiitake" — verschieden
    // geschrieben ist nicht verschieden gemeint.
    const r = nach(rollupMitProgramm(SH_LEER, [{ id: 1, name: 'shiitake ', imProgramm: false }]), 'Shiitake');
    assert.equal(r.supply, 'off');
  });
});

describe('Nachschub als Tagesaufgabe', () => {
  // Eine Lücke gehört in die Tagesliste, nicht nur auf den Chargen-Reiter: wer
  // den Tag abarbeitet, soll sehen, dass die Shiitake ausgehen, ohne dafür
  // woanders hinzugehen. Die Zeile ist ABGELEITET wie die Umlager- und
  // Ernte-Zeilen daneben — deshalb funktioniert "bis sie wirklich gemacht ist"
  // ohne Buchhaltung: Körner gemacht, Zeile weg. Es gibt kein Häkchen, das man
  // vergessen könnte.
  function tasks(chargen, sorten) {
    const code = [
      hebeKonstante('SUPPLY_RANK'),
      hebeFunktion('_stageBagsOf'),
      hebeFunktion('sorteRollup'),
      hebeFunktion('buildSupplyTasks'),
      'return buildSupplyTasks();'
    ].join('\n');
    return new Function(
      'batches',
      'zones',
      'statusByBatch',
      'mushroomStrains',
      `
      const t = (k, p) => (p ? k + ':' + Object.values(p).join(',') : k);
      const abbrev = (s) => String(s || '').slice(0, 2).toUpperCase();
      const stageOf = (role, batchType) =>
        role === 'fruiting' || role === 'contaminated' ? role : batchType === 'grain' ? 'spawn' : 'incubation';
      const getStatus = (id) => ({ c: statusByBatch[id] || {} });
      ${code}
    `
    )(
      chargen.map((c) => ({
        batchId: c.id,
        species: c.sorte,
        batchType: c.typ || 'block',
        days: 5,
        due: '2026-09-01T00:00:00.000Z',
        strainId: null
      })),
      ZONEN,
      Object.fromEntries(chargen.map((c) => [c.id, c.verteilung])),
      sorten
    );
  }
  const IM_PROGRAMM = [
    { id: 1, name: 'Shiitake', imProgramm: true },
    { id: 2, name: 'Blue Oyster', imProgramm: true },
    { id: 3, name: 'King Oyster', imProgramm: true }
  ];

  it('stellt eine Zeile ein, wenn hinter einer Sorte nichts steht', () => {
    const ts = tasks([{ id: 'SH-1', sorte: 'Shiitake', verteilung: { TENT1: 96 } }], IM_PROGRAMM);
    assert.equal(ts.length, 1);
    assert.equal(ts[0].name, 'Shiitake');
    assert.equal(ts[0].taskAction, 'make-grain', 'ohne Körner ist Körner ansetzen der erste Schritt');
  });

  it('verlangt Blöcke statt Körner, wenn Körner da sind', () => {
    const ts = tasks(
      [
        { id: 'BO-G', sorte: 'Blue Oyster', typ: 'grain', verteilung: { SPAWN: 20 } },
        { id: 'BO-1', sorte: 'Blue Oyster', verteilung: { TENT1: 96 } }
      ],
      IM_PROGRAMM
    );
    // Körner da, nichts in der Inkubation: 'low', also keine Zeile — die Kette
    // läuft, sie wird nur dünn. Gemeldet wird, was fehlt, nicht was knapp ist.
    assert.equal(ts.length, 0);
  });

  it('meldet "Körner fehlen" als eigene Zeile', () => {
    const ts = tasks([{ id: 'BO-1', sorte: 'Blue Oyster', verteilung: { INC: 120, TENT1: 192 } }], IM_PROGRAMM);
    assert.equal(ts.length, 1);
    assert.equal(ts[0].supply, 'nospawn');
    assert.equal(ts[0].taskAction, 'make-grain');
  });

  it('schweigt über Sorten, die gerade nicht angebaut werden', () => {
    const ts = tasks(
      [{ id: 'SH-1', sorte: 'Shiitake', verteilung: { TENT1: 96 } }],
      [{ id: 1, name: 'Shiitake', imProgramm: false }]
    );
    assert.deepEqual(ts, [], 'sonst steht dieselbe Zeile den ganzen Sommer da');
  });

  it('schweigt über eine Sorte, die in den Pilzsorten gar nicht steht', () => {
    // Anders als die Kachel, die sie vorsichtshalber zeigt: eine Tagesaufgabe
    // ist eine Anweisung, und für die reicht "steht nicht dagegen" nicht.
    assert.deepEqual(tasks([{ id: 'SH-1', sorte: 'Shiitake', verteilung: { TENT1: 96 } }], []), []);
  });

  it('verschwindet, sobald die Charge wirklich existiert', () => {
    const leer = tasks([{ id: 'SH-1', sorte: 'Shiitake', verteilung: { TENT1: 96 } }], IM_PROGRAMM);
    assert.equal(leer.length, 1);
    const gemacht = tasks(
      [
        { id: 'SH-1', sorte: 'Shiitake', verteilung: { TENT1: 96 } },
        { id: 'SH-G', sorte: 'Shiitake', typ: 'grain', verteilung: { SPAWN: 20 } },
        { id: 'SH-2', sorte: 'Shiitake', verteilung: { INC: 120 } }
      ],
      IM_PROGRAMM
    );
    assert.deepEqual(gemacht, [], 'kein Häkchen nötig — die Zeile ist abgeleitet');
  });

  it('stellt die dringendste Sorte nach oben', () => {
    const ts = tasks(
      [
        { id: 'BO-1', sorte: 'Blue Oyster', verteilung: { INC: 120, TENT1: 192 } },
        { id: 'SH-1', sorte: 'Shiitake', verteilung: { TENT1: 96 } }
      ],
      IM_PROGRAMM
    );
    assert.deepEqual(
      ts.map((x) => x.name),
      ['Shiitake', 'Blue Oyster'],
      'gar nichts dahinter wiegt schwerer als nur keine Körner'
    );
  });
});
