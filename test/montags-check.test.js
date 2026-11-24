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
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const lokal = (...a) => new Date(...a).getTime();

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
    // danach auf Montag 1 Uhr oder Sonntag 23 Uhr.
    const montag = db.brettCheckAb(lokal(2026, 2, 28, 12));
    assert.equal(montag, lokal(2026, 2, 30));
    const danach = new Date(db.brettWocheSpaeter(montag));
    assert.deepEqual([danach.getDay(), danach.getHours(), danach.getDate()], [1, 0, 6]);
  });

  it('ein anderer Wochentag geht auch, wenn der Check einmal woanders liegen soll', () => {
    assert.equal(db.brettCheckAb(lokal(2026, 2, 2, 9), 3), lokal(2026, 2, 4), 'Montag → Mittwoch');
  });

  it('der Browser bekommt den Tag mit den übrigen Regeln', () => {
    const p = path.join(os.tmpdir(), 'mt_montag_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    const d = db.openDb(p);
    try {
      assert.deepEqual(db.readAll(d).brettRules, { confirmDays: 14, checkDay: 1 });
    } finally {
      d.close();
      for (const f of [p, p + '-wal', p + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
    }
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
    assert.equal(g.outAt, lokal(2026, 2, 9), 'die Zeile sagt, wann er ausgebucht wird');
  });

  it('im Zelt gibt es keine Frage vorher (askAt null)', () => {
    const faelle = [{ bag: 'TB-1-02', frist: { limitAt: lokal(2026, 1, 25), askAt: null, outAt: lokal(2026, 1, 25) } }];
    assert.deepEqual(alte(MONTAG, faelle), []);
  });

  it('was die App ausgebucht hat, zeigt der erste Check danach', () => {
    const auto = new Function(
      'autoBookouts',
      'now',
      `const brettRules = { confirmDays: 14, checkDay: 1 };
      const batchById = () => null;
      const toZone = (l) => String(l).split(':')[0];
      ${hebeFunktion('brettCheckAb', APP)}
      ${hebeFunktion('brettAutoGruppen', APP)}
      return brettAutoGruppen(now);`
    );
    // Am Dienstag ausgebucht: nicht am Sonntag danach, aber am Montag.
    const liste = [{ id: 1, batch: 'TB-1', loc: 'ZELT9', created: new Date(lokal(2026, 2, 3, 14)).toISOString() }];
    assert.deepEqual(auto(liste, new Date(lokal(2026, 2, 8, 20))), []);
    assert.equal(auto(liste, new Date(lokal(2026, 2, 9, 7))).length, 1);
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
      const fmtDtShort = () => '1.3.';
      const sorteName = () => 'Testpilz';
      const brettPlatzName = () => 'Testraum · Regal 1 · Fach 1';
      const zoneDisplayName = () => 'Testzelt';
      const brettAlteGruppen = () => alt;
      const brettAutoGruppen = () => auto;
      const brettStartKlick = () => {};
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
