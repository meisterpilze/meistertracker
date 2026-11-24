'use strict';
// Der Montags-Check: einmal die Woche, was eine Antwort braucht.
//
// Vorher stand "Noch da?" jeden Tag auf der Startseite, für jeden Beutel ab dem
// Tag, an dem er über seiner Zeit war, und dazu jede Zeile "Von selbst
// ausgebucht", bis jemand sie wegtippte. Eine Warnung, die immer dasteht, liest
// niemand mehr. Jetzt fragt die App am Montag, bucht eine Woche später aus, was
// keiner beantwortet hat, und was nur knapp ist, steht am Montag in der Liste.
//
// Alle Daten hier sind ausgedacht; die Tage rechnen in Ortszeit, wie die App.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const SERVER = quelle('server.js');
const lokal = (...a) => new Date(...a).getTime();
const DAY = 86400000;
// Der erste Augenblick eines Montags (0 Uhr, oder 1 Uhr, wo die Uhr um
// Mitternacht springt).
const montagsAnfang = (ms) => new Date(ms).getDay() === 1 && new Date(ms - 1).getDay() === 0;

describe('Montags-Check: der Tag', () => {
  it('der nächste Montag um 0 Uhr Ortszeit, ein Montag um 0 Uhr ist er selbst', () => {
    assert.equal(db.brettCheckAb(lokal(2026, 2, 1, 11)), lokal(2026, 2, 2), 'Sonntag → Montag danach');
    assert.equal(db.brettCheckAb(lokal(2026, 2, 2)), lokal(2026, 2, 2), 'Montag 0 Uhr → derselbe');
    assert.equal(
      db.brettCheckAb(lokal(2026, 2, 2, 0, 0, 1)),
      lokal(2026, 2, 9),
      'Montag kurz nach 0 Uhr → der nächste'
    );
    assert.equal(db.brettCheckAb(lokal(2026, 2, 4, 15)), lokal(2026, 2, 9), 'Mittwoch → Montag danach');
  });

  it('in Kalendertagen: die Zeitumstellung verschiebt den Montag nicht', () => {
    // Ende März wird die Uhr vorgestellt; mit festen 24 Stunden läge der Montag
    // danach auf Montag 1 Uhr oder Sonntag 23 Uhr. Wo es 0 Uhr an einem Tag
    // nicht gibt, ist es der erste Augenblick des Montags — und eine Woche
    // später wieder dessen Anfang, nicht 1 Uhr.
    const montag = db.brettCheckAb(lokal(2026, 2, 28, 12));
    assert.ok(montagsAnfang(montag));
    assert.equal(new Date(montag).getDate(), 30);
    const danach = db.brettWocheSpaeter(montag);
    assert.ok(montagsAnfang(danach));
    assert.equal(new Date(danach).getDate(), 6);
  });

  it('der Anfang der Woche: am Montag derselbe, sonst der Montag davor', () => {
    assert.equal(db.brettWochenAnfang(lokal(2026, 2, 2)), lokal(2026, 2, 2));
    assert.equal(db.brettWochenAnfang(lokal(2026, 2, 2, 9)), lokal(2026, 2, 2));
    assert.equal(db.brettWochenAnfang(lokal(2026, 2, 8, 23)), lokal(2026, 2, 2));
  });

  it('ein anderer Wochentag geht auch, wenn der Check einmal woanders liegen soll', () => {
    assert.equal(db.brettCheckAb(lokal(2026, 2, 2, 9), 3), lokal(2026, 2, 4), 'Montag → Mittwoch');
  });
});

describe('Montags-Check: der Server', () => {
  let d, p, sid;
  beforeEach(() => {
    p = path.join(os.tmpdir(), 'mt_montag_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    sid = Number(db.createMushroomStrain(d, { name: 'Testpilz', kuerzel: 'TP', incMaxDays: 30, tentMaxDays: 20 }));
    d.prepare('UPDATE mushroom_strains SET limits_set = ?').run(new Date(lokal(2025, 10, 1)).toISOString());
  });
  afterEach(() => {
    d.close();
    for (const f of [p, p + '-wal', p + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
  });
  // Eine Charge, gemacht am Tag `gemacht`, ihre Beutel ab `zeit` an `ort`.
  const charge = (id, n, gemacht) => {
    const bags = Array.from({ length: n }, (_, i) => ({ id: id + '-' + String(i + 1).padStart(2, '0'), bagKg: 3 }));
    db.insertBatch(
      d,
      {
        batchId: id,
        strainId: sid,
        qty: n,
        days: 10,
        substrate: {},
        bagKg: 3,
        batchType: 'block',
        notes: '',
        created: new Date(gemacht).toISOString(),
        due: new Date(gemacht + 10 * DAY).toISOString(),
        bags
      },
      null,
      null
    );
    return bags.map((b) => b.id);
  };
  const stelle = (bags, batch, ort, zeit, action = 'ADD') =>
    db.appendScanEntries(
      d,
      bags.map((bag) => ({ time: new Date(zeit).toISOString(), action, batch, bag, from: null, to: ort })),
      null
    );
  const frist = (bag) => db.brettFristen(d).find((f) => f.bag === bag);

  it('ein Beutel, der wieder eingebucht wird, wird nicht im selben Augenblick wieder ausgebucht', () => {
    // Gemacht am 5.1., Höchstzeit 30 Tage: über der Zeit seit Februar, gefragt,
    // ohne Antwort ausgebucht. Am Dienstag, dem 10.3., stellt ihn jemand wieder
    // ins Fach: gefragt wird er erst im nächsten Check, am 16.3.
    const bags = charge('TP-050126-01', 1, lokal(2026, 0, 5));
    stelle(bags, 'TP-050126-01', 'INC_R1', lokal(2026, 0, 5));
    assert.equal(db.autoBookOuts(d, new Date(frist(bags[0]).outAt)).length, 1, 'erst ausgebucht');
    const wieder = lokal(2026, 2, 10, 9);
    stelle(bags, 'TP-050126-01', 'INC_R1', wieder);
    assert.equal(db.autoBookOuts(d, new Date(wieder + 5000)).length, 0, 'nicht gleich wieder');
    assert.equal(frist(bags[0]).askAt, lokal(2026, 2, 16));
    assert.equal(frist(bags[0]).outAt, lokal(2026, 2, 23));
  });

  it('ein Umzug innerhalb der Inkubation (Raum → Fach) verschiebt die Frage nicht', () => {
    const bags = charge('TP-050126-01', 1, lokal(2026, 0, 5));
    stelle(bags, 'TP-050126-01', 'INC_R1', lokal(2026, 0, 5));
    const vorher = frist(bags[0]).askAt;
    stelle(bags, 'TP-050126-01', 'INC_R1:1', lokal(2026, 1, 20), 'MOVE');
    assert.equal(frist(bags[0]).askAt, vorher);
  });

  it('kommt der Lauf zu spät (Server aus), bleibt die Zeile offen und der nächste Check zeigt sie', () => {
    const bags = charge('TP-050126-01', 1, lokal(2026, 0, 5));
    stelle(bags, 'TP-050126-01', 'INC_R1', lokal(2026, 0, 5));
    const f = frist(bags[0]);
    assert.equal(db.autoBookOuts(d, new Date(f.outAt + 3 * DAY)).length, 1);
    assert.equal(db.listAutoBookouts(d).length, 1, 'offen: kein Check hat ihn sicher gezeigt');
  });

  it('pünktlich ausgebucht wird still: der Check hatte gefragt', () => {
    const bags = charge('TP-050126-01', 1, lokal(2026, 0, 5));
    stelle(bags, 'TP-050126-01', 'INC_R1', lokal(2026, 0, 5));
    assert.equal(db.autoBookOuts(d, new Date(frist(bags[0]).outAt + 15 * 60000)).length, 1);
    assert.deepEqual(db.listAutoBookouts(d), []);
  });

  it('die Zeilen tragen den Montag ihres Checks und das Ende der Woche', () => {
    const bags = charge('TP-050126-01', 1, lokal(2026, 0, 5));
    stelle(bags, 'TP-050126-01', 'TENT1', lokal(2026, 1, 1));
    db.autoBookOuts(d, new Date(lokal(2026, 2, 3, 14)));
    const [z] = db.listAutoBookouts(d);
    assert.equal(z.checkAt, lokal(2026, 2, 9));
    assert.equal(z.closeAt, lokal(2026, 2, 16));
  });

  it('ein Lauf, der nur Zeilen schließt, sagt es (geschlossen), und der Server gibt dann Bescheid', () => {
    const bags = charge('TP-050126-01', 1, lokal(2026, 0, 5));
    stelle(bags, 'TP-050126-01', 'TENT1', lokal(2026, 1, 1));
    db.autoBookOuts(d, new Date(lokal(2026, 2, 3, 14)));
    const r = db.autoBookOuts(d, new Date(lokal(2026, 2, 16)));
    assert.deepEqual(r, []);
    assert.equal(r.geschlossen, 1);
    assert.match(SERVER, /const geschlossen = out\.geschlossen \|\| 0;\s*if \(!out\.length && !geschlossen\) return;/);
  });

  it('der Browser bekommt die Tage des Servers: Regeln und je Beutel askAt und outAt', () => {
    const bags = charge('TP-050126-01', 1, lokal(2026, 0, 5));
    stelle(bags, 'TP-050126-01', 'INC_R1', lokal(2026, 0, 5));
    const alles = db.readAll(d);
    assert.deepEqual(alles.brettRules, { confirmDays: 14, checkDay: 1 });
    const f = frist(bags[0]);
    assert.deepEqual(alles.brettFragen, [{ bag: bags[0], askAt: f.askAt, outAt: f.outAt }]);
  });
});

describe('Montags-Check: was gefragt wird', () => {
  // brettAlteGruppen mit einem Beutel je Fall: über der Zeit, aber erst im
  // nächsten Check dran (askAt in der Zukunft), und einer, der dran ist.
  function alte(now, faelle) {
    const plaetze = new Map([['TEST_R1:1', faelle.map((f) => ({ bag: f.bag, batch: 'TB-1', to: 'TEST_R1:1' }))]]);
    return new Function(
      'plaetze',
      'faelle',
      'now',
      `const brettPlaetze = () => plaetze;
      const ZONE_BY_ID = { TESTRAUM: { id: 'TESTRAUM', role: 'incubation' } };
      const toZone = () => 'TESTRAUM';
      const _brettInfo = (e) => ({ bag: e.bag, batch: e.batch, b: null, made: '2026-01-01', loc: e.to });
      const brettFrist = (x) => faelle.find((f) => f.bag === x.bag).frist;
      ${hebeFunktion('brettAlteGruppen', APP)}
      return brettAlteGruppen(now);`
    )(plaetze, faelle, now);
  }
  const SONNTAG = new Date(lokal(2026, 2, 1, 11));
  const MONTAG = new Date(lokal(2026, 2, 2, 8));

  it('ein Beutel über der Zeit wartet auf den Montag, und am Montag ist er dran', () => {
    const faelle = [
      { bag: 'TB-1-01', frist: { limitAt: lokal(2026, 1, 25), askAt: lokal(2026, 2, 2), outAt: lokal(2026, 2, 9) } }
    ];
    assert.deepEqual(alte(SONNTAG, faelle), [], 'am Sonntag noch nicht');
    const [g] = alte(MONTAG, faelle);
    assert.deepEqual(
      g.xs.map((x) => x.bag),
      ['TB-1-01']
    );
    assert.equal(g.outAt, lokal(2026, 2, 9), 'die Zeile kennt den Tag des Ausbuchens');
  });

  it('im Zelt gibt es keine Frage vorher (askAt null)', () => {
    const faelle = [{ bag: 'TB-1-02', frist: { limitAt: lokal(2026, 1, 25), askAt: null, outAt: lokal(2026, 1, 25) } }];
    assert.deepEqual(alte(MONTAG, faelle), []);
  });

  // brettAutoGruppen mit den Tagen, die der Server schickt (checkAt, closeAt),
  // oder ohne sie (eine Antwort von vorher).
  const auto = new Function(
    'autoBookouts',
    'now',
    `const brettRules = { confirmDays: 14, checkDay: 1 };
    const batchById = () => null;
    const toZone = (l) => String(l).split(':')[0];
    ${hebeFunktion('brettCheckAb', APP)}
    ${hebeFunktion('brettWocheSpaeter', APP)}
    ${hebeFunktion('brettAutoGruppen', APP)}
    return brettAutoGruppen(now);`
  );

  it('was die App ausgebucht hat, zeigt der erste Check danach', () => {
    // Am Dienstag ausgebucht: nicht am Sonntag danach, aber am Montag.
    const liste = [{ id: 1, batch: 'TB-1', loc: 'ZELT9', created: new Date(lokal(2026, 2, 3, 14)).toISOString() }];
    assert.deepEqual(auto(liste, new Date(lokal(2026, 2, 8, 20))), []);
    assert.equal(auto(liste, new Date(lokal(2026, 2, 9, 7))).length, 1);
  });

  it('die Tage des Servers gelten, und nach dem Ende der Woche gibt es keinen Knopf mehr', () => {
    const liste = [
      {
        id: 1,
        batch: 'TB-1',
        loc: 'ZELT9',
        created: '2026-03-03T13:00:00.000Z',
        checkAt: lokal(2026, 2, 9, 5),
        closeAt: lokal(2026, 2, 16, 5)
      }
    ];
    assert.deepEqual(auto(liste, new Date(lokal(2026, 2, 9, 1))), [], 'der Server sagt: erst ab 5 Uhr');
    assert.equal(auto(liste, new Date(lokal(2026, 2, 9, 6))).length, 1);
    assert.deepEqual(auto(liste, new Date(lokal(2026, 2, 16, 6))), [], 'die Woche ist um');
  });
});

describe('Montags-Check: der Browser nimmt den Montag des Servers', () => {
  function frist(vomServer, bestaetigt) {
    return new Function(
      'vomServer',
      'bestaetigt',
      `const brettRules = { confirmDays: 14, checkDay: 1 };
      const brettArt = () => ({ incMaxDays: 30, limitsSet: '2025-11-01T00:00:00.000Z' });
      const ZONE_BY_ID = { TESTRAUM: { id: 'TESTRAUM', role: 'incubation' } };
      const toZone = () => 'TESTRAUM';
      const stillThere = bestaetigt ? { 'TB-1-01': bestaetigt } : {};
      const brettFragen = new Map(vomServer ? [['TB-1-01', vomServer]] : []);
      ${['brettCheckAb', 'brettWocheSpaeter', 'brettWochenAnfang', 'brettFristVon', 'brettFrist']
        .map((n) => hebeFunktion(n, APP))
        .join('\n')}
      return brettFrist({ bag: 'TB-1-01', strainId: 3, loc: 'TESTRAUM', type: 'block', made: '2026-01-05T09:00:00.000Z', since: '2026-01-05T09:00:00.000Z' });`
    )(vomServer, bestaetigt);
  }

  it('mit den Tagen des Servers rechnet der Browser nicht selbst', () => {
    // Ein Server in einer anderen Zeitzone: sein Montag beginnt hier um 5 Uhr.
    const server = { askAt: lokal(2026, 1, 9, 5), outAt: lokal(2026, 1, 16, 5) };
    const f = frist(server);
    assert.deepEqual([f.askAt, f.outAt], [server.askAt, server.outAt]);
  });

  it('nach einem "Noch da", das der Server noch nicht kennt, gilt die eigene Rechnung', () => {
    const f = frist(
      { askAt: lokal(2026, 1, 9), outAt: lokal(2026, 1, 16) },
      new Date(lokal(2026, 2, 2, 9)).toISOString()
    );
    assert.equal(f.askAt, lokal(2026, 2, 16), 'zwei Montage später, nicht der alte Montag');
  });

  it('"Als Nächstes ins Fruchtzelt" behält einen Block über der Zeit, bis der Check ihn zeigt', () => {
    const plan = hebeFunktion('zeltPlan', APP);
    assert.match(plan, /now\.getTime\(\) >= \(frist\.askAt != null \? frist\.askAt : frist\.limitAt\)/);
    assert.doesNotMatch(plan, /now\.getTime\(\) >= frist\.limitAt\) continue/);
  });
});

describe('Montags-Check: die Karte', () => {
  function karte(alt, auto) {
    const els = {
      'wk-montag': { hidden: true },
      'wk-montag-list': {
        innerHTML: '',
        dataset: {},
        gebunden: 0,
        addEventListener() {
          this.gebunden++;
        }
      }
    };
    new Function(
      'els',
      'alt',
      'auto',
      `const document = { getElementById: (id) => els[id] };
      const t = (k, p) => k + (p ? JSON.stringify(p) : '');
      const esc = (x) => String(x);
      const fmtDtShort = (d) => { const x = new Date(d); return x.getDate() + '.' + (x.getMonth() + 1) + '.'; };
      const sorteName = () => 'Testpilz';
      const brettPlatzName = () => 'Testraum · Regal 1 · Fach 1';
      const zoneDisplayName = () => 'Testzelt';
      const brettAlteGruppen = () => alt;
      const brettAutoGruppen = () => auto;
      const brettStartKlick = () => {};
      let _montagStand = '';
      ${hebeFunktion('renderMontagsCheck', APP)}
      renderMontagsCheck(new Date());
      renderMontagsCheck(new Date());`
    )(els, alt, auto);
    return { card: els['wk-montag'], box: els['wk-montag-list'] };
  }

  it('ohne Frage ist sie nicht da', () => {
    assert.equal(karte([], []).card.hidden, true);
  });

  it('mit Fragen: "Noch da?" und "Von selbst ausgebucht", je mit ihren zwei Antworten', () => {
    const alt = [{ loc: 'TEST_R1:1', b: {}, made: '2026-01-01', outAt: lokal(2026, 2, 9), xs: [{ bag: 'TB-1-01' }] }];
    const auto = [{ b: {}, zone: 'ZELT9', created: '2026-03-03T14:00:00.000Z', ids: [7, 8] }];
    const { card, box } = karte(alt, auto);
    assert.equal(card.hidden, false);
    for (const k of [
      'bretter.stale',
      'bretter.auto',
      'data-bretter-noch="0"',
      'data-bretter-raus="0"',
      'data-bretter-auto-noch="0"',
      'data-bretter-auto-ok="0"'
    ])
      assert.ok(box.innerHTML.includes(k), k);
    assert.equal(box._alt, alt, 'die Antworten finden ihre Zeilen');
    assert.equal(box._auto, auto);
    assert.equal(box.gebunden, 1, 'der Klick wird einmal gebunden, nicht bei jedem Zeichnen');
  });

  it('die Zeile nennt den letzten Tag zum Antworten, nicht den Montag, an dem um 0 Uhr ausgebucht wird', () => {
    const alt = [{ loc: 'TEST_R1:1', b: {}, made: '2026-01-01', outAt: lokal(2026, 2, 9), xs: [{ bag: 'TB-1-01' }] }];
    const { box } = karte(alt, []);
    assert.ok(box.innerHTML.includes('"out":"8.3."'), box.innerHTML);
  });

  it('die Tageskarte "Regale und Fruchtzelt" fragt nicht mehr, sie zeichnet den Check mit', () => {
    const tag = hebeFunktion('renderWorkBretter', APP);
    assert.doesNotMatch(tag, /bretter\.stale'|bretter\.auto'/);
    assert.match(tag, /renderMontagsCheck\(now\)/);
  });

  it('steht über "Regale und Fruchtzelt" und ist versteckt, bis es etwas zu fragen gibt', () => {
    const a = HTML.indexOf('id="wk-montag"');
    const b = HTML.indexOf('id="wk-bretter"');
    assert.ok(a > 0 && a < b);
    assert.match(HTML, /<section class="wk-teil wk-teil-montag" id="wk-montag" hidden>/);
  });

  it('ein neuer Tag ohne neue Daten zeichnet die Startseite neu, damit der Check am Montag erscheint', () => {
    const poll = hebeFunktion('pollSync', APP);
    const zweig = poll.slice(poll.indexOf('r.status === 304'), poll.indexOf('const newEtag'));
    assert.match(zweig, /_montagStand !== new Date\(\)\.toDateString\(\)\) renderDashBatchTasks\(\)/);
  });
});

describe('Montags-Check: die Antworten', () => {
  it('"Noch da" auf eine Zeile, die der Server schon geschlossen hat, meldet keinen Erfolg', async () => {
    const meldungen = [];
    let abgleich = 0;
    await new Function(
      'meldungen',
      'zaehle',
      `let autoBookouts = [{ id: 7 }];
      const apiPost = async () => ({ ok: true, resolved: 0, restored: 0 });
      const toast = (m, art) => meldungen.push([m, art || '']);
      const t = (k) => k;
      const syncNow = () => zaehle();
      const renderDashBatchTasks = () => {};
      ${hebeFunktion('brettAutoAntwort', APP)}
      return brettAutoAntwort([7], 'still_there');`
    )(meldungen, () => abgleich++);
    assert.deepEqual(meldungen, [['brett.autoClosed', 'err']]);
    assert.equal(abgleich, 1);
  });

  it('Zelt zählen: mehr da als gezählt holt zuerst die eigenen Ausbuchungen zurück, dann erst aus der Inkubation', () => {
    const gesendet = [];
    const geschrieben = [];
    let meldung = '';
    new Function(
      'gesendet',
      'geschrieben',
      'fertig',
      `let autoBookouts = [
        { id: 1, batch: 'TB-1', loc: 'ZELT9', created: '2026-03-03T10:00:00.000Z' },
        { id: 2, batch: 'TB-1', loc: 'ZELT9', created: '2026-03-04T10:00:00.000Z' },
        { id: 3, batch: 'TB-2', loc: 'ZELT9', created: '2026-03-04T10:00:00.000Z' }
      ];
      const batchById = (b) => ({ strainId: b === 'TB-1' ? 5 : 6 });
      const toZone = (l) => String(l).split(':')[0];
      const brettArt = () => ({ name: 'Testpilz' });
      const t = (k, p) => k + (p ? JSON.stringify(p) : '');
      const apiPost = (url, body) => { gesendet.push([url, body]); return Promise.resolve({ ok: true }); };
      const syncNow = () => {};
      const toast = () => {};
      const zones = [{ id: 'INK9', role: 'incubation' }];
      const brettPlaetze = () => new Map([['INK9', [{ bag: 'TB-1-09', batch: 'TB-1', to: 'INK9' }]]]);
      const _brettInfo = (e) => ({ bag: e.bag, batch: e.batch, strainId: 5, type: 'block', due: '2026-02-01' });
      const brettAelter = () => 0;
      const brettSchreibe = (items) => { geschrieben.push(...items); return items; };
      ${hebeFunktion('brettZeltZaehlen', APP)}
      brettZeltZaehlen({ zone: 'ZELT9', strainId: 5 }, [{ bag: 'TB-1-01' }], 4, fertig);`
    )(gesendet, geschrieben, (m) => (meldung = m));
    // Gezählt 4, die App hatte 1: die zwei Testpilz-Ausbuchungen dieses Zelts
    // kommen zurück (die jüngste zuerst), der vierte aus der Inkubation.
    assert.deepEqual(gesendet, [['/api/auto-bookouts/resolve', { ids: [2, 1], how: 'still_there' }]]);
    assert.deepEqual(
      geschrieben.map((g) => [g.action, g.x.bag]),
      [['MOVE', 'TB-1-09']]
    );
    assert.match(meldung, /brett\.restored\{"n":2\}/);
  });
});

describe('Montags-Check: was nur knapp ist, steht am Montag', () => {
  const checkSpalte = new Function(
    `const brettRules = { confirmDays: 14, checkDay: 1 }; ${hebeFunktion('checkSpalte', APP)} return checkSpalte;`
  )();
  const woche = (ab) =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(ab);
      d.setDate(d.getDate() + i);
      return { offset: i, date: d, weekday: d.getDay() };
    });

  it('an einem Mittwoch: knapp in der Montagsspalte, was brennt heute', () => {
    const tage = woche(lokal(2026, 2, 4));
    assert.equal(tage[checkSpalte(tage, false)].weekday, 1);
    assert.equal(checkSpalte(tage, false), 5);
    assert.equal(checkSpalte(tage, true), 0);
  });

  it('am Montag selbst steht alles heute', () => {
    assert.equal(checkSpalte(woche(lokal(2026, 2, 2)), false), 0);
  });

  it('die Woche legt Bestand und Labor danach, nicht mehr alles auf heute', () => {
    const plan = hebeFunktion('buildWeekPlan', APP);
    assert.match(plan, /put\(checkSpalte\(days, a\.urgent\), \{/);
    assert.match(plan, /const off = checkSpalte\(days, l\.empty\);/);
  });
});
