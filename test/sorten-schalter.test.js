'use strict';
// Was wir gerade anbauen: ein Knopf je Sorte, an oder aus (im_programm). Aus
// heißt, die App verlangt nichts mehr für die Sorte: kein Soll, kein
// Körnerbrut-Plan, kein Minimum im Fruchtzelt und nicht in "Als Nächstes", keine
// Frage "Noch da?" und kein automatisches Ausbuchen. Wieder an bekommt, was in
// der Zeit fällig wurde, zwei Wochen wie nach einem "Noch da".
//
// Alle Zahlen und Namen hier sind erfunden.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle();
const HTML = quelle('index.html');
const DAY = 86400000;
const NOW = new Date('2026-03-01T10:00:00.000Z');
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
const spaeter = (days) => new Date(NOW.getTime() + days * DAY);

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_schalter_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}
function aufraeumen(p) {
  for (const f of [p, p + '-wal', p + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
}
function charge(d, strainId, id, n, tage) {
  const bags = Array.from({ length: n }, (_, i) => ({ id: id + '-' + String(i + 1).padStart(2, '0'), bagKg: 3 }));
  db.insertBatch(
    d,
    {
      batchId: id,
      strainId,
      qty: n,
      days: 10,
      substrate: {},
      bagKg: 3,
      batchType: 'block',
      notes: '',
      created: ago(tage),
      due: ago(tage - 10),
      bags
    },
    null,
    null
  );
  return bags.map((b) => b.id);
}
function stelle(d, bags, batch, to, tage) {
  db.appendScanEntries(
    d,
    bags.map((bag) => ({ time: ago(tage), action: 'ADD', batch, bag, from: null, to })),
    null
  );
}

describe('Sorte aus und wieder an (Server)', () => {
  let d, p, sid;
  beforeEach(() => {
    ({ db: d, path: p } = tmpDb());
    sid = Number(db.createMushroomStrain(d, { name: 'Testpilz', kuerzel: 'TP', tentMaxDays: 20, incMaxDays: 30 }));
    // Die Grenzen stehen schon lange: die Woche Schonfrist ist vorbei.
    d.prepare('UPDATE mushroom_strains SET limits_set = ? WHERE id = ?').run(ago(100), sid);
  });
  afterEach(() => {
    d.close();
    aufraeumen(p);
  });
  const fristen = () => new Map(db.brettFristen(d).map((f) => [f.bag, f]));

  it('aus: keine Fristen, nichts wird ausgebucht', () => {
    stelle(d, charge(d, sid, 'TP-01', 2, 60), 'TP-01', 'TENT1', 25);
    stelle(d, charge(d, sid, 'TP-02', 1, 40), 'TP-02', 'INC', 40);
    assert.equal(db.brettFristen(d).length, 3, 'an: zwei im Fruchtzelt, einer in der Inkubation');
    db.updateMushroomStrain(d, sid, { imProgramm: false }, NOW);
    assert.equal(db.brettFristen(d).length, 0);
    assert.equal(db.autoBookOuts(d, NOW).length, 0);
  });

  it('wieder an: was in der Zeit fällig wurde, bekommt zwei Wochen und wird nicht gleich ausgebucht', () => {
    const zelt = charge(d, sid, 'TP-01', 2, 60);
    stelle(d, zelt, 'TP-01', 'TENT1', 25);
    const inc = charge(d, sid, 'TP-02', 1, 40);
    stelle(d, inc, 'TP-02', 'INC', 40);
    db.updateMushroomStrain(d, sid, { imProgramm: false }, NOW);
    db.updateMushroomStrain(d, sid, { imProgramm: true }, NOW);
    assert.equal(db.autoBookOuts(d, NOW).length, 0, 'nicht sofort');
    const f = fristen();
    assert.equal(f.get(zelt[0]).limitAt, spaeter(14).getTime(), 'Fruchtzelt: zwei Wochen ab dem Anschalten');
    assert.equal(f.get(inc[0]).limitAt, spaeter(14).getTime(), 'Inkubation: gefragt wird in zwei Wochen');
    assert.equal(f.get(inc[0]).outAt, spaeter(21).getTime(), 'ausgebucht eine Woche danach');
    assert.equal(db.autoBookOuts(d, spaeter(15)).length, 2, 'dann die beiden im Fruchtzelt');
    assert.equal(db.autoBookOuts(d, spaeter(22)).length, 1, 'und der in der Inkubation');
  });

  it('wieder an: ein Beutel, der noch länger Zeit hat, behält seine Frist', () => {
    const frisch = charge(d, sid, 'TP-03', 1, 20);
    stelle(d, frisch, 'TP-03', 'TENT1', 3); // Fruchtzeltzeit 20 Tage: noch 17
    const vorher = fristen().get(frisch[0]).limitAt;
    db.updateMushroomStrain(d, sid, { imProgramm: false }, NOW);
    db.updateMushroomStrain(d, sid, { imProgramm: true }, NOW);
    assert.equal(fristen().get(frisch[0]).limitAt, vorher);
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM bag_still_there').get().n, 0);
  });

  it('nur das Anschalten zählt: eine Änderung an einer Sorte, die an ist, bestätigt nichts', () => {
    stelle(d, charge(d, sid, 'TP-01', 1, 60), 'TP-01', 'TENT1', 25);
    db.updateMushroomStrain(d, sid, { imProgramm: true, description: 'neu' }, NOW);
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM bag_still_there').get().n, 0);
    assert.equal(db.autoBookOuts(d, NOW).length, 1, 'an war sie schon: die Frist gilt wie bisher');
  });

  it('der Laborbestand: aus heißt kein Soll für Körnerbrut, auch mit Plan', () => {
    db.updateMushroomStrain(d, sid, { weekBlocks: 10, recSpawnPct: 7, recBagKg: 3, recBatchType: 'block' });
    const kb = () =>
      db
        .labStock(d, NOW)
        .find((s) => s.strainId === sid)
        .items.find((i) => i.key === 'GSKG');
    assert.ok(kb().make > 0, 'an: der Plan verlangt Körnerbrut');
    db.updateMushroomStrain(d, sid, { imProgramm: false });
    assert.equal(kb().make, 0);
  });
});

describe('Sorte aus: Fristen und Fruchtzelt im Browser', () => {
  const brettFristVon = new Function(hebeFunktion('brettFristVon', SRC) + '; return brettFristVon;')();
  const RULES = { confirmDays: 14, graceDays: 7 };
  const frist = (s) =>
    brettFristVon({
      s,
      rules: RULES,
      confirmed: null,
      limitsSet: ago(100),
      role: 'fruiting',
      batchType: 'block',
      made: ago(60),
      since: ago(25)
    });

  it('dieselbe Regel wie der Server: aus heißt keine Frist', () => {
    assert.ok(frist({ tentMaxDays: 20 }), 'an');
    assert.equal(frist({ tentMaxDays: 20, imProgramm: false }), null);
  });

  it('die Fruchtzelt-Karte: aus heißt kein Minimum und keine Warnung, das Maximum bleibt', () => {
    const karte = new Function(
      't',
      'esc',
      'spDot',
      'zoneDisplayName',
      hebeFunktion('_zeltGrenzenText', SRC) + hebeFunktion('zeltKarteHtml', SRC) + '; return zeltKarteHtml;'
    )(
      (k, p) => k + (p ? JSON.stringify(p) : ''),
      (s) => String(s),
      () => '',
      (id) => id
    );
    const z = { id: 'TENT1' };
    const an = karte(z, { name: 'Testpilz', tentMin: 10, tentMax: 20 }, 1, 4);
    assert.match(an, /zelt-unter/);
    assert.match(an, /zelt\.limits/);
    const aus = karte(z, { name: 'Testpilz', tentMin: 10, tentMax: 20, imProgramm: false }, 1, 4);
    assert.doesNotMatch(aus, /zelt-unter|zelt\.limits\b|zelt\.limitMin|zelt-bar-min/);
    assert.match(aus, /zelt-bar/);
    assert.match(aus, /zelt\.limitMax\{"max":20\}/);
    assert.match(karte(z, { name: 'Testpilz', tentMax: 20, imProgramm: false }, 1, 20), /zelt-voll/);
  });

  it('die Grenzen: aus heißt Minimum 0, das Maximum bleibt', () => {
    const grenzen = new Function(hebeFunktion('zeltGrenzenVon', SRC) + '; return zeltGrenzenVon;')();
    assert.deepEqual(
      grenzen([{ id: 1, tentMin: 5, tentMax: 20 }, { id: 2, tentMin: 5, tentMax: 20, imProgramm: false }, { id: 3 }]),
      { 1: { min: 5, max: 20 }, 2: { min: 0, max: 20 }, 3: { min: 0, max: 0 } }
    );
  });

  it('als Nächstes ins Fruchtzelt: eine Sorte, die aus ist, steht nicht darin, auch überfällig', () => {
    const mushroomStrains = [
      { id: 1, name: 'An', tentMax: 10 },
      { id: 2, name: 'Aus', tentMax: 10, imProgramm: false }
    ];
    const plaetze = new Map([
      ['INC_R1:1', [{ id: 'a' }]],
      ['INC_R1:2', [{ id: 'b' }, { id: 'c' }]]
    ]);
    const zeltPlan = new Function(
      'zones',
      'brettZoneMitBrettern',
      'brettPlaetze',
      'toZone',
      'brettVon',
      '_brettInfo',
      'brettFaellig',
      'brettFrist',
      'mushroomStrains',
      'brettImZelt',
      hebeFunktion('zeltPlanVon', SRC) +
        hebeFunktion('sorteAn', SRC) +
        hebeFunktion('zeltGrenzenVon', SRC) +
        hebeFunktion('zeltPlan', SRC) +
        '; return zeltPlan;'
    )(
      [{ id: 'INC', role: 'incubation' }],
      () => true,
      () => plaetze,
      () => 'INC',
      (loc) => ({ rackId: 'INC_R1', level: Number(loc.split(':')[1]) }),
      // a ist von der Sorte, die an ist; b und c (älter) von der, die aus ist
      (e) => ({ type: 'block', strainId: e.id === 'a' ? 1 : 2, due: e.id === 'a' ? ago(1) : ago(40) }),
      () => 'due',
      () => null,
      mushroomStrains,
      () => ({})
    );
    const plan = zeltPlan(NOW);
    assert.deepEqual(
      plan.go.map((g) => [g.strainId, g.take]),
      [[1, 1]]
    );
    assert.equal(plan.wait.length, 0);
    assert.deepEqual(plan.grenzen[2], { min: 0, max: 10 });
  });

  it('beim Umziehen ins Fruchtzelt warnt das Maximum auch bei einer Sorte, die aus ist', () => {
    const info = new Function(
      'brettArt',
      'brettImZelt',
      't',
      'tp',
      hebeFunktion('_brettZeltInfo', SRC) + '; return _brettZeltInfo;'
    )(
      () => ({ name: 'Testpilz', tentMax: 20, imProgramm: false }),
      () => ({ 5: 18 }),
      (k, p) => k + JSON.stringify(p || {}),
      (k, n) => k + n
    );
    const text = info([{ strainId: 5 }, { strainId: 5 }, { strainId: 5 }]);
    assert.match(text, /brett\.tentInfo\{/);
    assert.match(text, /brett\.tentFullWarn\{"n":2\}/);
  });

  it('der Körnerbrut-Plan lässt eine Sorte, die aus ist, weg', () => {
    const zeilen = new Function(hebeFunktion('_kbpZeilen', SRC) + '; return _kbpZeilen;')();
    const art = (strainId, imProgramm) => ({
      strainId,
      name: 'Art ' + strainId,
      imProgramm,
      items: [{ key: 'GSKG', make: 1, plan: { needKgWeek: 2, oldKg: 1 } }]
    });
    assert.deepEqual(
      zeilen([art(1, true), art(2, false)]).map((x) => x.sp.strainId),
      [1]
    );
  });
});

describe('Was wir gerade anbauen: die Knöpfe', () => {
  it('stehen oben auf der Pilzsorten-Seite, als benannte Gruppe', () => {
    const seite = HTML.slice(HTML.indexOf('id="p-strains"'));
    assert.ok(seite.indexOf('id="ms-schalter"') > 0);
    assert.ok(seite.indexOf('id="ms-schalter"') < seite.indexOf('id="ms-name"'), 'vor dem Formular');
    assert.match(HTML, /id="ms-schalter-t"/);
    assert.match(HTML, /id="ms-schalter" role="group" aria-labelledby="ms-schalter-t"/);
    assert.match(hebeFunktion('renderStrains', SRC), /^function renderStrains\(\) \{\s*renderSortenSchalter\(\);/);
  });

  const zeichne = (document, mushroomStrains) =>
    new Function(
      'document',
      'mushroomStrains',
      't',
      'esc',
      hebeFunktion('renderSortenSchalter', SRC) + '; renderSortenSchalter();'
    )(
      document,
      mushroomStrains,
      (k, p) => k + JSON.stringify(p || {}),
      (s) => String(s)
    );

  it('ein Knopf je Sorte, alphabetisch, an oder aus, mit der Zahl darunter', () => {
    const els = {};
    const document = { getElementById: (id) => (els[id] = els[id] || { innerHTML: '', textContent: '' }) };
    zeichne(document, [
      { id: 2, name: 'Zettpilz', imProgramm: false },
      { id: 1, name: 'Apfelpilz', imProgramm: true },
      { id: 3, name: 'Mittelpilz' }
    ]);
    const reihe = [
      ...els['ms-schalter'].innerHTML.matchAll(/data-ms-schalter="(\d+)" aria-pressed="(true|false)">([^<]+)</g)
    ].map((m) => [m[1], m[2], m[3]]);
    assert.deepEqual(reihe, [
      ['1', 'true', 'Apfelpilz'],
      ['3', 'true', 'Mittelpilz'],
      ['2', 'false', 'Zettpilz']
    ]);
    assert.equal(els['ms-schalter-n'].textContent, 'strains.switchCount{"n":2,"total":3}');
  });

  it('dieselben Sorten: die Knöpfe bleiben dieselben, nur ihr Stand ändert sich (der Fokus bleibt)', () => {
    const knopf = (id, name, an) => {
      const klassen = new Set(an ? ['ms-chip', 'an'] : ['ms-chip']);
      const attr = { 'aria-pressed': String(an) };
      return {
        dataset: { msSchalter: String(id) },
        textContent: name,
        classList: { toggle: (k, wert) => (wert ? klassen.add(k) : klassen.delete(k)), has: (k) => klassen.has(k) },
        setAttribute: (k, v) => (attr[k] = v),
        attr
      };
    };
    const knoepfe = [knopf(1, 'Apfelpilz', true), knopf(2, 'Zettpilz', true)];
    const box = { innerHTML: 'unberührt', querySelectorAll: () => knoepfe };
    const zahl = { textContent: '' };
    zeichne({ getElementById: (id) => (id === 'ms-schalter' ? box : zahl) }, [
      { id: 1, name: 'Apfelpilz', imProgramm: true },
      { id: 2, name: 'Zettpilz', imProgramm: false }
    ]);
    assert.equal(box.innerHTML, 'unberührt', 'nicht neu gezeichnet');
    assert.equal(knoepfe[1].attr['aria-pressed'], 'false');
    assert.equal(knoepfe[1].classList.has('an'), false);
    assert.equal(knoepfe[0].classList.has('an'), true);
  });

  it('ein Tipp auf einen Knopf schaltet die Sorte um', () => {
    const rufe = [];
    const klick = new Function(
      'mushroomStrains',
      'sorteProgramm',
      hebeFunktion('msSchalterKlick', SRC) + '; return msSchalterKlick;'
    )(
      [
        { id: 3, imProgramm: true },
        { id: 4, imProgramm: false }
      ],
      (id, want) => rufe.push([id, want])
    );
    const tipp = (id) => ({ target: { closest: () => ({ dataset: { msSchalter: String(id) } }) } });
    klick(tipp(3));
    klick(tipp(4));
    klick({ target: { closest: () => null } });
    assert.deepEqual(rufe, [
      [3, false],
      [4, true]
    ]);
    assert.match(SRC, /\$\('ms-schalter'\)\.addEventListener\('click', msSchalterKlick\)/);
  });

  // sorteProgramm mit Attrappen: jede Speicherung wartet, bis der Test sie beantwortet.
  function schalter({ blattOffen = false } = {}) {
    const log = [];
    const ms = { id: 5, name: 'Testpilz', imProgramm: true };
    const lab = { strainId: 5, imProgramm: true };
    const offen = [];
    const sorteProgramm = new Function(
      'mushroomStrains',
      'renderStrains',
      'renderBatches',
      'renderDashBatchTasks',
      'apiPatch',
      'toast',
      't',
      'loadLabStock',
      '_lbSpecies',
      '_lbSheet',
      'lbSheetRender',
      'const _progOffen = new Map();\n' +
        hebeFunktion('_sorteProgrammSetzen', SRC) +
        hebeFunktion('sorteProgramm', SRC) +
        '; return sorteProgramm;'
    )(
      [ms],
      () => log.push('zeichnen:' + ms.imProgramm),
      () => {},
      () => {},
      (url, body) =>
        new Promise((resolve) => {
          log.push('patch:' + body.imProgramm);
          offen.push(resolve);
        }),
      (text, art) => log.push('toast:' + text + ':' + art),
      (k) => k,
      () => log.push('labor'),
      () => [lab],
      blattOffen ? { strainId: 5 } : null,
      () => log.push('blatt:' + lab.imProgramm)
    );
    const antworte = async (i, antwort) => {
      offen[i](antwort);
      await new Promise((r) => setTimeout(r, 0));
    };
    return { sorteProgramm, antworte, log, ms, lab };
  }

  it('gespeichert: der neue Stand bleibt, der Laborbestand kommt neu', async () => {
    const s = schalter();
    s.sorteProgramm(5, false);
    assert.equal(s.ms.imProgramm, false, 'sofort');
    await s.antworte(0, { ok: true });
    assert.equal(s.ms.imProgramm, false);
    assert.ok(s.log.includes('labor'));
    assert.ok(!s.log.some((x) => x.startsWith('toast')));
  });

  it('nicht gespeichert: der alte Stand und eine Meldung in Klartext, ohne Scan-Fenster', async () => {
    const s = schalter();
    s.sorteProgramm(5, false);
    await s.antworte(0, { error: 'offline' });
    assert.equal(s.ms.imProgramm, true);
    assert.ok(s.log.includes('toast:strains.switchFailed:err'));
    assert.ok(!s.log.includes('labor'));
    assert.doesNotMatch(hebeFunktion('sorteProgramm', SRC), /setFb\(/);
  });

  it('zwei schnelle Tipps, beide nicht gespeichert: wieder der alte Stand, nicht das Gegenteil', async () => {
    const s = schalter();
    s.sorteProgramm(5, false);
    s.sorteProgramm(5, true);
    await s.antworte(0, { error: 'offline' });
    assert.equal(s.ms.imProgramm, true, 'die zweite Änderung ist noch unterwegs');
    await s.antworte(1, { error: 'offline' });
    assert.equal(s.ms.imProgramm, true, 'was der Server hat');
  });

  it('zwei schnelle Tipps, der erste gespeichert, der zweite nicht: der Stand des Servers', async () => {
    const s = schalter();
    s.sorteProgramm(5, false);
    s.sorteProgramm(5, true);
    await s.antworte(0, { ok: true });
    await s.antworte(1, { error: 'offline' });
    assert.equal(s.ms.imProgramm, false);
    assert.ok(s.log.includes('labor'));
  });

  it('das Blatt im Labor zeigt den Stand mit, und sein Häkchen geht denselben Weg', async () => {
    const s = schalter({ blattOffen: true });
    s.sorteProgramm(5, false);
    assert.equal(s.lab.imProgramm, false);
    assert.ok(s.log.includes('blatt:false'));
    await s.antworte(0, { error: 'offline' });
    assert.equal(s.lab.imProgramm, true);
    assert.equal(s.log[s.log.length - 1], 'blatt:true');
    const rufe = [];
    new Function('_lbSheet', 'sorteProgramm', hebeFunktion('lbProgramm', SRC) + '; return lbProgramm;')(
      { strainId: 7 },
      (id, an) => rufe.push([id, an])
    )(false);
    assert.deepEqual(rufe, [[7, false]]);
  });
});

describe('Abfrage und Speichern', () => {
  // pollSync mit Attrappen: authFetch ruft `waehrend` auf, bevor es antwortet.
  async function abfrage(waehrend) {
    const angewendet = [];
    const lauf = new Function(
      'authFetch',
      'dataResponse',
      'applyData',
      'setSyncStatus',
      't',
      'formatRelativeTime',
      'refresh',
      'noteServerBuild',
      'let _polling = false; let _mutating = 0; let _mutEpoch = 0; let _lastEtag = null; let lastHash = ""; ' +
        'let lastSyncTime = 0; const _pollWaiters = []; const POLL_TIMEOUT_MS = 1000;\n' +
        hebeFunktion('pollSync', SRC) +
        '; return { pollSync, schreibt: () => { _mutEpoch++; } };'
    );
    let w;
    const api = lauf(
      async () => {
        if (waehrend) waehrend(w);
        return { status: 200, headers: { get: () => 'e1' } };
      },
      async () => ({ stand: 1 }),
      (d) => angewendet.push(d),
      () => {},
      (k) => k,
      () => '',
      () => {},
      () => {}
    );
    w = api;
    const ergebnis = await api.pollSync();
    return { ergebnis, angewendet };
  }

  it('beginnt während der Abfrage eine Speicherung, wird ihr Stand nicht angewendet', async () => {
    const ruhig = await abfrage(null);
    assert.equal(ruhig.ergebnis, true);
    assert.equal(ruhig.angewendet.length, 1);
    const mitten = await abfrage((api) => api.schreibt());
    assert.equal(mitten.ergebnis, null);
    assert.equal(mitten.angewendet.length, 0);
    assert.match(hebeFunktion('_apiCall', SRC), /_mutating\+\+;\s*_mutEpoch\+\+;/);
  });
});

describe('Hilfetexte und Fruchtzelt statt Zelt', () => {
  const sprache = (l) => {
    const w = {};
    new Function('window', quelle('lang/' + l + '.js'))(w);
    return w.LANG[l];
  };
  it('heißt in allen drei Sprachen so', () => {
    const wort = { de: 'Fruchtzelt', en: 'fruiting tent', pt: 'tenda de frutificação' };
    for (const l of ['de', 'en', 'pt']) {
      const L = sprache(l);
      for (const k of ['bretter.title', 'bretter.next', 'bretter.tents', 'strains.tentMaxDays', 'strains.tentMin'])
        assert.ok(L[k].toLowerCase().includes(wort[l].toLowerCase()), l + ' ' + k + ': ' + L[k]);
    }
  });

  it('beide Schalter sagen, was aus heißt: offene Bestellungen zählen noch, keine Frage "Noch da?"', () => {
    const text = {
      de: ['Kundenbestellung', 'zwei Wochen', 'Noch da'],
      en: ['customer order', 'two weeks', 'Still there'],
      pt: ['encomenda', 'duas semanas', 'Ainda está lá']
    };
    for (const l of ['de', 'en', 'pt']) {
      const L = sprache(l);
      for (const w of text[l]) assert.ok(L['strains.switchHelp'].includes(w), l + ' switchHelp: ' + w);
      assert.ok(L['lb.programmHelp'].includes(text[l][2]), l + ' lb.programmHelp');
    }
  });
});
