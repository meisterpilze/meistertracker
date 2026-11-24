'use strict';
// Regalbretter im Browser (v122): was die App aus dem Stand rechnet und wie sie
// es zeigt. Die Fristen muss der Browser genauso rechnen wie der Server, sonst
// fragt er "Noch da?" an einem anderen Tag, als der Server ausbucht.
//
// Alle Zahlen hier sind erfunden: Testarten mit runden Tagen, keine aus dem Labor.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { quelle, hebeFunktion, ROOT } = require('./helpers/quelle');

const SRC = quelle();
const HTML = quelle('index.html');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const DAY = 86400000;
const NOW = Date.parse('2026-03-01T10:00:00.000Z');
const ago = (d) => new Date(NOW - d * DAY).toISOString();
const RULES = { confirmDays: 14, checkDay: 1 };

const brettFristVon = new Function(
  ['brettCheckAb', 'brettWocheSpaeter', 'brettFristVon'].map((n) => hebeFunktion(n, SRC)).join('\n') +
    '; return brettFristVon;'
)();
const zeltPlanVon = new Function(hebeFunktion('zeltPlanVon', SRC) + '; return zeltPlanVon;')();

describe('Regalbretter im Browser: die Fristen', () => {
  const s = { incMaxDays: 30, grainMaxDays: 50, tentMaxDays: 20 };
  const frist = (p) => brettFristVon(Object.assign({ s, rules: RULES, confirmed: null, limitsSet: ago(100) }, p));

  it('rechnet mit denselben Tagen wie der Server', () => {
    const m = DB_SRC.match(/const BRETT_CONFIRM_DAYS = (\d+);[\s\S]*?const BRETT_CHECK_DAY = (\d+);/);
    assert.ok(m, 'die Fristen in db.js sind nicht mehr dort');
    assert.equal(Number(m[1]), RULES.confirmDays);
    assert.equal(Number(m[2]), RULES.checkDay);
    assert.match(SRC, /let brettRules = \{ confirmDays: 14, checkDay: 1 \};/, 'Vorgabe im Browser wie im Server');
  });

  it('der Montag des Checks: dieselbe Rechnung im Browser und im Server', () => {
    // Bis auf die Vorgabe des Wochentags wortgleich, damit beide denselben Montag nehmen.
    const rumpf = (src) =>
      hebeFunktion('brettCheckAb', src)
        .replace(/tag = [A-Za-z_.]+\)/, 'tag)')
        .replace(/^\s*\/\/.*$/gm, '');
    assert.equal(rumpf(SRC), rumpf(DB_SRC));
    assert.equal(hebeFunktion('brettWocheSpaeter', SRC), hebeFunktion('brettWocheSpaeter', DB_SRC));
  });

  it('im Zelt: die Zeltzeit ab dem Tag, an dem der Block hereinkam', () => {
    const f = frist({ role: 'fruiting', batchType: 'block', made: ago(60), since: ago(25) });
    assert.equal(f.kind, 'tent');
    assert.equal(f.limitAt, NOW - 5 * DAY);
    assert.equal(f.outAt, f.limitAt);
  });

  it('im Zelt: ein "Noch da" nach dem Hereinkommen gibt zwei Wochen ab dann', () => {
    const f = frist({ role: 'fruiting', batchType: 'block', made: ago(60), since: ago(25), confirmed: ago(0) });
    assert.equal(f.limitAt, NOW + 14 * DAY);
  });

  // NOW ist Sonntag, der 1.3.2026. Der nächste Montags-Check ist der 2.3. um 0 Uhr
  // Ortszeit, der danach der 9.3.
  const MONTAG = new Date(2026, 2, 2).getTime();
  const MONTAG_DANACH = new Date(2026, 2, 9).getTime();

  it('in der Inkubation: ab dem Tag der Charge, gefragt am nächsten Montag, ausgebucht eine Woche später', () => {
    const f = frist({ role: 'incubation', batchType: 'block', made: ago(34), since: ago(34) });
    assert.equal(f.limitAt, NOW - 4 * DAY);
    assert.equal(f.askAt, MONTAG);
    assert.equal(f.outAt, MONTAG_DANACH);
  });

  it('eine frisch eingetragene Zahl fragt erst am Montag danach und bucht eine Woche später aus', () => {
    const f = frist({ role: 'incubation', batchType: 'block', made: ago(90), since: ago(90), limitsSet: ago(0) });
    assert.equal(f.askAt, MONTAG);
    assert.equal(f.outAt, MONTAG_DANACH);
  });

  it('im Zelt fragt die App nicht vorher: kein Montag', () => {
    assert.equal(frist({ role: 'fruiting', batchType: 'block', made: ago(60), since: ago(25) }).askAt, null);
  });

  it('Körnerbrut hat ihre eigene Zahl, auch in einem Raum der Inkubation', () => {
    assert.equal(frist({ role: 'spawn', batchType: 'grain', made: ago(45), since: ago(45) }).limitAt, NOW + 5 * DAY);
    assert.equal(
      frist({ role: 'incubation', batchType: 'grain', made: ago(45), since: ago(45) }).limitAt,
      NOW + 5 * DAY
    );
  });

  it('ohne Zahl, und in einem anderen Raum, gibt es keine Frist', () => {
    assert.equal(brettFristVon({ role: 'fruiting', s: {}, rules: RULES, since: ago(1), made: ago(1) }), null);
    assert.equal(frist({ role: 'contaminated', batchType: 'block', made: ago(300), since: ago(300) }), null);
  });
});

describe('Regalbretter im Browser: was als Nächstes ins Zelt kommt', () => {
  const g = (ort, strainId, n, due) => ({ ort, zone: 'INC', strainId, n, due });

  it('Arten unter ihrem Minimum zuerst, dann nach dem Tag', () => {
    const p = zeltPlanVon(
      [g('INC_R1:1', 1, 4, '2026-02-01'), g('INC_R2:1', 2, 3, '2026-02-10')],
      { 1: 10, 2: 1 },
      { 1: { min: 2, max: 30 }, 2: { min: 5, max: 30 } }
    );
    assert.deepEqual(
      p.go.map((x) => [x.ort, x.take, x.low]),
      [
        ['INC_R2:1', 3, true],
        ['INC_R1:1', 4, false]
      ]
    );
  });

  it('nie mehr, als ins Zelt passt; der Rest wartet', () => {
    const p = zeltPlanVon(
      [g('INC_R1:1', 1, 4, '2026-02-01'), g('INC_R1:2', 1, 5, '2026-02-02'), g('INC_R1:3', 1, 2, '2026-02-03')],
      { 1: 7 },
      { 1: { min: 0, max: 10 } }
    );
    assert.deepEqual(
      p.go.map((x) => [x.ort, x.take, x.voll]),
      [['INC_R1:1', 3, true]],
      'nur drei passen noch, und das Brett hat vier'
    );
    assert.deepEqual(
      p.wait.map((x) => x.ort),
      ['INC_R1:2', 'INC_R1:3']
    );
  });

  it('ohne Höchstzahl passt alles', () => {
    const p = zeltPlanVon([g('INC_R1:1', 1, 40, '2026-02-01')], {}, { 1: { min: 0, max: 0 } });
    assert.equal(p.go[0].take, 40);
    assert.equal(p.wait.length, 0);
  });
});

describe('Regalbretter im Browser: Plätze', () => {
  it('liest ein Brett wie der Server', () => {
    const brettVon = new Function(
      SRC.match(/^const BRETT_RE = .*$/m)[0] + hebeFunktion('brettVon', SRC) + '; return brettVon;'
    )();
    assert.deepEqual(brettVon('INC_R1:2'), { rackId: 'INC_R1', level: 2 });
    assert.equal(brettVon('INC_R1'), null);
    assert.equal(brettVon('INC:R1'), null);
    const dbRe = DB_SRC.match(/function shelfOfLocation[\s\S]*?\/(\^\(\[A-Z\][^/]*)\//);
    assert.ok(dbRe, 'shelfOfLocation in db.js nicht gefunden');
    assert.equal('/' + dbRe[1] + '/', SRC.match(/^const BRETT_RE = (\/.*\/);$/m)[1], 'derselbe Ausdruck wie im Server');
  });

  it('toZone liest ein Brett als sein Regal', () => {
    const toZone = new Function(
      'RACK_ZONE',
      'ZONES',
      SRC.match(/^const toZone = \(loc\) => \{[\s\S]*?\n\};$/m)[0] + ' return toZone;'
    )({ INC_R1: 'INC' }, ['INC', 'TENT1']);
    assert.equal(toZone('INC_R1:2'), 'INC');
    assert.equal(toZone('INC_R1'), 'INC');
    assert.equal(toZone('INC:R1'), 'INC');
    assert.equal(toZone('TENT1'), 'TENT1');
  });

  it('ein Regal zählt die Beutel auf seinen Brettern; ein Platz anderswo nimmt sie herunter', () => {
    const scanLog = [
      { action: 'ADD', bag: 'A', batch: 'X', to: 'INC_R1:1' },
      { action: 'ADD', bag: 'B', batch: 'X', to: 'INC_R1' },
      { action: 'ADD', bag: 'C', batch: 'X', to: 'INC_R1:2' },
      { action: 'MOVE', bag: 'A', batch: 'X', from: 'INC_R1:1', to: 'INC_R1:2' },
      { action: 'MOVE', bag: 'C', batch: 'X', from: 'INC_R1:2', to: 'TENT1' },
      { action: 'ADD', bag: 'D', batch: 'X', to: 'INC_R1:3' },
      { action: 'REMOVE', bag: 'D', batch: 'X', from: null }
    ];
    const getRackBags = new Function('scanLog', hebeFunktion('getRackBags', SRC) + '; return getRackBags;')(scanLog);
    assert.deepEqual(Object.keys(getRackBags('INC_R1')).sort(), ['A', 'B']);
    assert.equal(getRackBags('INC_R1').A.loc, 'INC_R1:2');
  });
});

describe('Regalbretter im Browser: neue Beutel ohne Frage', () => {
  const zone = (id, role, racks, sortOrder) => ({ id, role, racks, sortOrder });
  const laden = (zones) =>
    new Function(
      'zones',
      hebeFunktion('brettZoneMitBrettern', SRC) + hebeFunktion('brettStartZone', SRC) + '; return brettStartZone;'
    )(zones);

  it('ohne Bretter fragt die App wie bisher', () => {
    const f = laden([zone('INC', 'incubation', [{ id: 'INC_R1', levels: 0, strainId: 1 }], 1)]);
    assert.equal(f({ batchType: 'block', strainId: 1 }), null);
  });

  it('Blöcke kommen in den Raum mit einem Regal ihrer Art', () => {
    const f = laden([
      zone('INC', 'incubation', [{ id: 'INC_R1', levels: 3, strainId: 1 }], 1),
      zone('WARM', 'incubation', [{ id: 'WARM_R1', levels: 2, strainId: 2 }], 2),
      zone('SPAWN', 'spawn', [{ id: 'SPAWN_R1', levels: 2, strainId: 2 }], 0)
    ]);
    assert.equal(f({ batchType: 'block', strainId: 2 }), 'WARM');
    assert.equal(f({ batchType: 'grain', strainId: 2 }), 'SPAWN', 'Körnerbrut zuerst in den Raum der Körnerbrut');
    assert.equal(f({ batchType: 'block', strainId: 9 }), 'INC', 'eine Art ohne Regal: der erste Raum der Inkubation');
  });

  it('das Anlegen nimmt diesen Weg, gedruckt wird danach', () => {
    const f = hebeFunktion('nbPlaceAndPrint', SRC);
    assert.ok(f.indexOf('brettStartZone(') < f.indexOf('openZonePickModal('));
  });
});

describe('Regalbretter im Browser: Fenster und Knöpfe', () => {
  it('das Brett-Etikett öffnet sein Blatt, egal welcher Vorgang steht', () => {
    assert.match(hebeFunktion('processScan', SRC), /entry\.type === 'brett'\)\s*\{[\s\S]*?brettScanned\(entry\.id\)/);
  });

  it('beide Fenster stehen in index.html und schließen über _Z_SCHLIESSEN', () => {
    for (const id of ['m-brett', 'm-rack-edit', 'wk-bretter', 'wk-bretter-list', 'm-brett-body', 'm-rack-edit-strain'])
      assert.ok(HTML.includes('id="' + id + '"'), id + ' fehlt in index.html');
    assert.match(SRC, /'m-brett': \(\) => brettZu\(\)/);
    assert.match(SRC, /'m-rack-edit': \(\) => rackEditClose\(\)/);
  });

  it('die Startseite zeichnet Regale und Zelt mit', () => {
    assert.match(hebeFunktion('renderDashBatchTasks', SRC), /renderWorkBretter\(\)/);
  });

  it('die Felder der Grenzen je Art stehen im Formular, und leer heißt null', () => {
    const felder = SRC.match(/const MS_LIMIT_FIELDS = \[[\s\S]*?\n\];/)[0];
    for (const m of felder.matchAll(/\['(ms-[a-z-]+)'/g))
      assert.ok(HTML.includes('id="' + m[1] + '"'), m[1] + ' fehlt im Formular');
    const werte = {
      'ms-inc-max': '30',
      'ms-grain-max': '',
      'ms-tent-days': ' 12 ',
      'ms-tent-min': '-3',
      'ms-tent-max': 'x'
    };
    const lies = new Function('document', felder + hebeFunktion('_msReadLimits', SRC) + '; return _msReadLimits;')({
      getElementById: (id) => ({ value: werte[id] })
    });
    assert.deepEqual(lies(), { incMaxDays: 30, grainMaxDays: null, tentMaxDays: 12, tentMin: null, tentMax: null });
  });

  it('ein Zähler beginnt bei 0, nur Umziehen behält die Zahl', () => {
    const w = hebeFunktion('brettWire', SRC);
    assert.match(w, /_brett\.n = nach === 'move' \|\| nach === 'target' \? _brett\.n : 0;/);
  });
});
