'use strict';
// Which Sorte needs a batch started — the question the Chargen tab could not
// answer, and the one it is actually opened with.
//
// ── Why these fixtures look the way they do ─────────────────────────────────
//
// The first version of this file built every batch as `species: 'Shiitake'`,
// and every test passed against code that did not work at all. The app never
// writes that string. createBatch (app.js) and insertBatch (db.js) both write
//
//     species = ms.name + ' (' + ms.kuerzel + ')'      ->  "Shiitake (SH)"
//
// while createGrainBatch writes the bare `ms.name`. So one Sorte reached the
// rollup under two spellings: grain never joined its blocks, the programme flag
// matched nothing, and buildSupplyTasks() returned [] on real data — none of
// which a fixture using the tidy name can see.
//
// `charge()` and `koerner()` below build rows the way the two create paths do,
// suffix and all. Anything testing this code has to go through them.
//
// ── The verdict ────────────────────────────────────────────────────────────
//
// It reads grain and incubation SEPARATELY, because they are two different lead
// times: incubation is the next harvest, grain is what the one after that gets
// made from. A Sorte with a full incubation and no grain is fine today and
// certain to run dry in two cycles — a different thing from "running low", and
// a different thing to do about it.
//
//   now      grain 0, incubating 0   behind the fruiting blocks: nothing
//   nospawn  grain 0, incubating >0  next harvest yes, the one after it no
//   low      incubating < fruiting   the chain runs but is thinning
//   ok       otherwise
//
// Grain is counted apart because stageOf() gives a BLOCK no spawn stage at all,
// and in KILOGRAMS by the same computation the Labor card uses — reading it off
// scan positions counted zero for grain made today, since createGrainBatch
// writes no scan entries at all.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf, hebeKonstante: _hk } = require('./helpers/quelle');

const SRC = quelle();
const hebeFunktion = (n) => _hf(n, SRC);
const hebeKonstante = (n) => _hk(n, SRC);

const ZONEN = [
  { id: 'SPAWN', role: 'spawn' },
  { id: 'INC', role: 'incubation' },
  { id: 'TENT1', role: 'fruiting' },
  { id: 'CONTAM', role: 'contaminated' }
];

let _n = 0;
// Eine Block-Charge, geschrieben wie createBatch/insertBatch sie schreiben.
function charge(name, { inc = 0, frucht = 0, kontam = 0, tageAlt = 5, strainId = 1, kz = 'SH' } = {}) {
  return {
    batchId: kz + '-B' + ++_n,
    species: name + ' (' + kz + ')', // <- der Suffix, an dem alles hing
    strainId,
    strainName: name,
    strainKuerzel: kz,
    batchType: 'block',
    qty: inc + frucht,
    days: 14, // Rezeptlänge, absichtlich konstant: sie ist NICHT das Alter
    created: new Date(Date.now() - tageAlt * 864e5).toISOString(),
    due: '2026-09-01T00:00:00.000Z',
    _c: { INC: inc, TENT1: frucht, CONTAM: kontam }
  };
}
// Eine Körner-Charge: bare Name, Gewicht statt Scans.
function koerner(name, { kg = 0, glaeser = 1, strainId = 1, kz = 'SH', status } = {}) {
  return {
    batchId: kz + '-G' + ++_n,
    species: name, // <- ohne Suffix, anders als die Block-Charge
    strainId,
    strainName: name,
    strainKuerzel: kz,
    batchType: 'grain',
    qty: glaeser,
    bagKg: kg / Math.max(1, glaeser),
    days: 14,
    created: new Date().toISOString(),
    due: '2026-09-01T00:00:00.000Z',
    _status: status || 'SPAWN RUN',
    _c: {}
  };
}
const sorte = (name, extra) => ({ id: 1, name, kuerzel: 'SH', description: '', imProgramm: true, ...extra });
const BO = { id: 2, name: 'Blue Oyster', kuerzel: 'BO', description: '', imProgramm: true };

function lauf(ausdruck, chargen, sorten) {
  const code = [
    hebeKonstante('SUPPLY_RANK'),
    hebeFunktion('_spKey'),
    hebeFunktion('sorteKey'),
    hebeFunktion('_strainKeys'),
    hebeFunktion('sorteName'),
    hebeFunktion('_stageBagsOf'),
    hebeFunktion('_grainKgOf'),
    hebeFunktion('sorteRollup'),
    hebeFunktion('buildSupplyTasks')
  ].join('\n');
  return new Function(
    'batches',
    'zones',
    'statusByBatch',
    'statusByBatchName',
    'mushroomStrains',
    `
    const t = (k, p) => (p ? k + ':' + Object.values(p).join(',') : k);
    const abbrev = (s) => String(s || '').slice(0, 2).toUpperCase();
    const isArchivedStatus = (s) => ['DONE', 'EMPTY', 'CONTAM'].includes(s);
    const stageOf = (role, batchType) =>
      role === 'fruiting' || role === 'contaminated' ? role : batchType === 'grain' ? 'spawn' : 'incubation';
    const getStatus = (id) => ({ c: statusByBatch[id] || {}, status: statusByBatchName[id] || 'INCUBATING' });
    ${code}
    return ${ausdruck};`
  )(
    chargen,
    ZONEN,
    Object.fromEntries(chargen.map((b) => [b.batchId, b._c])),
    Object.fromEntries(chargen.map((b) => [b.batchId, b._status || 'INCUBATING'])),
    sorten
  );
}
const rollup = (chargen, sorten = [sorte('Shiitake')]) => lauf('sorteRollup()', chargen, sorten);
const tasks = (chargen, sorten = [sorte('Shiitake')]) => lauf('buildSupplyTasks()', chargen, sorten);
const nach = (rows, name) => rows.find((r) => r.name === name);

describe('Eine Sorte ist eine Sorte, egal wie sie geschrieben steht', () => {
  it('führt Körner und Blöcke derselben Sorte zusammen', () => {
    // Der Fehler, den die alten Fixtures nicht sehen konnten: die Block-Charge
    // heißt "Shiitake (SH)", die Körner-Charge "Shiitake". Über den Namen
    // gruppiert wurden daraus zwei Sorten, und die Körner zählten nie zu den
    // Blöcken, hinter denen sie stehen.
    const rows = rollup([koerner('Shiitake', { kg: 20 }), charge('Shiitake', { frucht: 96 })]);
    assert.equal(rows.length, 1, 'eine Sorte, eine Zeile');
    assert.equal(rows[0].name, 'Shiitake', 'und ohne Kürzel-Suffix beschriftet');
    assert.equal(rows[0].grain, 20);
    assert.equal(rows[0].fruiting, 96);
  });

  it('gruppiert auch ohne strainId, über den bereinigten Namen', () => {
    // Zeilen von vor der strain_id-Spalte: kein strainId, aber derselbe Suffix.
    const alt = charge('Shiitake', { frucht: 40 });
    const g = koerner('Shiitake', { kg: 5 });
    for (const b of [alt, g]) {
      b.strainId = null;
      b.strainName = null;
    }
    const rows = rollup([alt, g]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].grain, 5);
  });

  it('erkennt die Sorte im Programm wieder', () => {
    // Über den Namen nachgeschlagen traf "shiitake (sh)" nie auf "shiitake",
    // und die Ampel stand den ganzen Sommer auf rot.
    const rows = rollup([charge('Shiitake', { frucht: 96 })], [sorte('Shiitake', { imProgramm: false })]);
    assert.equal(rows[0].imProgramm, false);
    assert.equal(rows[0].supply, 'off');
  });
});

describe('Nachschub je Sorte', () => {
  it('sagt "jetzt ansetzen", wenn hinter der Fruchtung nichts steht', () => {
    const r = nach(rollup([charge('Shiitake', { frucht: 96 })]), 'Shiitake');
    assert.equal(r.supply, 'now');
    assert.equal(r.grain, 0);
    assert.equal(r.incubation, 0);
  });

  it('trennt "Körner fehlen" von "knapp" — der Fall, um den es geht', () => {
    const r = nach(rollup([charge('Shiitake', { inc: 120, frucht: 192 })]), 'Shiitake');
    assert.equal(r.supply, 'nospawn');
    assert.equal(r.incubation, 120);
    assert.equal(r.grain, 0);
  });

  it('nennt es "knapp", wenn die Kette läuft aber dünner wird', () => {
    const r = nach(rollup([koerner('Shiitake', { kg: 12 }), charge('Shiitake', { inc: 20, frucht: 44 })]), 'Shiitake');
    assert.equal(r.supply, 'low');
    assert.equal(r.grain, 12);
  });

  it('nennt es "läuft", wenn mehr nachkommt als fruchtet', () => {
    const r = nach(rollup([koerner('Shiitake', { kg: 24 }), charge('Shiitake', { inc: 96, frucht: 96 })]), 'Shiitake');
    assert.equal(r.supply, 'ok');
  });

  it('behandelt eine Sorte ohne aktive Beutel als "jetzt ansetzen"', () => {
    const r = nach(rollup([charge('Shiitake', {})]), 'Shiitake');
    assert.equal(r.supply, 'now');
    assert.equal(r.bags, 0);
    assert.equal(r.nBatches, 0, 'eine Charge ohne Beutel zählt nicht als aktive Charge');
    assert.equal(r.nAll, 1, 'sie verschwindet aber nicht — sonst fiele die Sorte ganz aus der Übersicht');
  });
});

describe('Körner werden gewogen, nicht gescannt', () => {
  it('zählt frisch angesetzte Körner mit, obwohl sie noch keinen Scan haben', () => {
    // createGrainBatch schreibt keine Scan-Einträge. Über getStatus().c gelesen
    // war heute angesetzte Brut null — die Kachel meldete "Körner fehlen" über
    // einem vollen Regal, während die Labor-Karte die Kilo zeigte.
    const g = koerner('Shiitake', { kg: 24, glaeser: 8 });
    assert.deepEqual(g._c, {}, 'keine Scan-Position, wie in echt');
    const r = nach(rollup([g, charge('Shiitake', { frucht: 96 })]), 'Shiitake');
    assert.equal(r.grain, 24);
    assert.notEqual(r.supply, 'now');
  });

  it('rechnet in Kilogramm, wie die Labor-Karte und min_spawn_kg', () => {
    const r = nach(rollup([koerner('Shiitake', { kg: 15, glaeser: 5 })]), 'Shiitake');
    assert.equal(r.grain, 15, 'nicht 5 Gläser');
  });

  it('zählt verbrauchte Körner nicht mehr mit', () => {
    const g = koerner('Shiitake', { kg: 20, status: 'DONE' });
    const r = nach(rollup([g, charge('Shiitake', { frucht: 96 })]), 'Shiitake');
    assert.equal(r.grain, 0);
    assert.equal(r.supply, 'now');
  });

  it('hält Körner aus den Beutelzahlen heraus', () => {
    const r = nach(rollup([koerner('Shiitake', { kg: 22 }), charge('Shiitake', { frucht: 96 })]), 'Shiitake');
    assert.equal(r.bags, 96, 'Kilo sind keine Beutel');
    assert.equal(r.nAll, 1, 'und eine Körnercharge ist keine Zeile der Chargenliste');
  });

  it('zeigt eine Sorte, die es nur als Körner gibt', () => {
    const r = nach(rollup([koerner('Shiitake', { kg: 18 })]), 'Shiitake');
    assert.ok(r, 'die Sorte darf nicht aus der Übersicht fallen');
    assert.equal(r.grain, 18);
    assert.equal(r.nAll, 0);
  });
});

describe('Was sonst in die Zahlen eingeht', () => {
  it('summiert mehrere Chargen derselben Sorte', () => {
    const r = nach(
      rollup([charge('Shiitake', { inc: 72 }), charge('Shiitake', { inc: 48 }), charge('Shiitake', { frucht: 192 })]),
      'Shiitake'
    );
    assert.equal(r.incubation, 120);
    assert.equal(r.fruiting, 192);
    assert.equal(r.bags, 312);
    assert.equal(r.nBatches, 3);
  });

  it('lässt kontaminierte Beutel nicht als Bestand zählen', () => {
    const r = nach(rollup([charge('Shiitake', { frucht: 96, kontam: 48 })]), 'Shiitake');
    assert.equal(r.bags, 96, 'kontaminierte Beutel sind kein Bestand');
    assert.equal(r.supply, 'now');
  });

  it('misst "zuletzt vor" am Anlagedatum, nicht an der Rezeptlänge', () => {
    // b.days ist die geplante Inkubationsdauer — dieselbe 14, die die Tabelle
    // als "14d" zeigt. Von dort gelesen stand unter jeder Kachel für immer
    // dieselbe Zahl, unter der Überschrift "zuletzt vor N T".
    const r = nach(
      rollup([charge('Shiitake', { frucht: 40, tageAlt: 90 }), charge('Shiitake', { inc: 10, tageAlt: 30 })]),
      'Shiitake'
    );
    assert.equal(r.lastDays, 30, 'die jüngste Charge zählt');
    assert.notEqual(r.lastDays, 14, 'und nicht die Rezeptlänge');
  });

  it('hält die Sorten auseinander', () => {
    const rows = rollup(
      [charge('Blue Oyster', { inc: 120, strainId: 2, kz: 'BO' }), charge('Shiitake', { frucht: 96 })],
      [sorte('Shiitake'), BO]
    );
    assert.equal(rows.length, 2);
    assert.equal(nach(rows, 'Blue Oyster').supply, 'nospawn');
    assert.equal(nach(rows, 'Shiitake').supply, 'now');
  });
});

describe('Nachschub als Tagesaufgabe', () => {
  it('stellt eine Zeile ein, wenn hinter einer Sorte nichts steht', () => {
    const ts = tasks([charge('Shiitake', { frucht: 96 })]);
    assert.equal(ts.length, 1);
    assert.equal(ts[0].name, 'Shiitake');
    assert.equal(ts[0].taskAction, 'make-grain', 'ohne Körner ist Körner ansetzen der erste Schritt');
  });

  it('schweigt, wenn Körner da sind und genug in der Inkubation steht', () => {
    const ts = tasks([koerner('Shiitake', { kg: 20 }), charge('Shiitake', { inc: 120, frucht: 96 })]);
    assert.deepEqual(ts, []);
  });

  it('meldet "Körner fehlen" als eigene Zeile', () => {
    const ts = tasks([charge('Shiitake', { inc: 120, frucht: 192 })]);
    assert.equal(ts.length, 1);
    assert.equal(ts[0].supply, 'nospawn');
    assert.equal(ts[0].taskAction, 'make-grain');
  });

  it('schweigt über Sorten, die gerade nicht angebaut werden', () => {
    const ts = tasks([charge('Shiitake', { frucht: 96 })], [sorte('Shiitake', { imProgramm: false })]);
    assert.deepEqual(ts, [], 'sonst steht dieselbe Zeile den ganzen Sommer da');
  });

  it('schweigt über eine Sorte, die in den Pilzsorten gar nicht steht', () => {
    // Anders als die Kachel, die sie vorsichtshalber zeigt: eine Tagesaufgabe
    // ist eine Anweisung, und dafür reicht "steht nicht dagegen" nicht.
    assert.deepEqual(tasks([charge('Shiitake', { frucht: 96 })], []), []);
  });

  it('verschwindet, sobald die Charge wirklich existiert', () => {
    assert.equal(tasks([charge('Shiitake', { frucht: 96 })]).length, 1);
    const gemacht = tasks([
      charge('Shiitake', { frucht: 96 }),
      koerner('Shiitake', { kg: 20 }),
      charge('Shiitake', { inc: 120 })
    ]);
    assert.deepEqual(gemacht, [], 'kein Häkchen nötig — die Zeile ist abgeleitet');
  });

  it('stellt die dringendste Sorte nach oben', () => {
    const ts = tasks(
      [charge('Blue Oyster', { inc: 120, frucht: 192, strainId: 2, kz: 'BO' }), charge('Shiitake', { frucht: 96 })],
      [sorte('Shiitake'), BO]
    );
    assert.deepEqual(
      ts.map((x) => x.name),
      ['Shiitake', 'Blue Oyster'],
      'gar nichts dahinter wiegt schwerer als nur keine Körner'
    );
  });

  it('sortiert die Zustände nach Dringlichkeit', () => {
    const rang = new Function(hebeKonstante('SUPPLY_RANK') + '\nreturn SUPPLY_RANK;')();
    assert.deepEqual(
      ['ok', 'low', 'nospawn', 'now', 'off'].sort((a, b) => rang[a] - rang[b]),
      ['now', 'nospawn', 'low', 'ok', 'off']
    );
    assert.ok(rang.off > rang.ok, 'geparkte Sorten stehen am Ende, nicht zwischen den anderen');
  });
});
