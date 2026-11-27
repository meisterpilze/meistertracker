'use strict';
// What a review of the menu work found, held here so it stays fixed.
//
// 1. Bedarf lost a Sorte whose only gap was grain spawn in kg and that has no
//    row in the weekly plan (a target set by hand, or out of the programme).
// 2. The start page and Bedarf wrote the packing board the page Packen works
//    from; an answer that came late put an older state under it.
// 3. A bag recorded in a contamination room was shown by no page once the room
//    view under Chargen was gone.
// 4. Bedarf replaced its list on every answer of a sync, changed or not.
// 5. The parcels notice was written again on every sync, which the list of
//    what is due took for a change and answered by building the week again.
// 6. Bedarf matched "the same Sorte" by its name; two lists spell it differently.
// 7. (The figure on a job, for a screen reader: test/heute-faellig.test.js.)
// 8. (Folding a group under "Mehr": the groups became tiles, test/mehr-blatt.test.js.)
// 9. The Scan-Log under Zahlen did not follow a sync.
//
// Lifted functions against stand-ins, invented data, no browser.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function hebe(name) {
  const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
  assert.ok(m, name + '() not found in app.js');
  return m[1];
}
function konst(name) {
  const m = APP.match(new RegExp('^const ' + name + ' = .*;$', 'm'));
  assert.ok(m, 'const ' + name + ' not found in app.js');
  return m[0];
}

const feld = (key, o) => ({ key, have: 0, growing: 0, soll: null, make: 0, urgency: null, ...o });
const art = (strainId, name, items, o = {}) => ({ strainId, name, imProgramm: true, items, ...o });
const zeilen = (species, board, shelf, supply) =>
  new Function(
    [konst('_lbFehlt'), konst('_shelfLow'), hebe('_kbpZeilen'), hebe('bedarfZeilen')].join('\n') +
      '\nreturn bedarfZeilen;'
  )()(species, board, shelf, supply);

describe('Bedarf: a gap in grain spawn is never lost', () => {
  it('keeps the kilograms on the species when the weekly plan has no row for it', () => {
    // A target set by hand: nothing used in eight weeks, so no weekly need.
    const vonHand = art(1, 'Testart Alpha', [
      feld('GSKG', { make: 5, urgency: 'low', plan: { needKgWeek: 0, oldKg: 0 } })
    ]);
    // Out of the programme, with an order waiting.
    const ruht = art(
      2,
      'Testart Beta',
      [feld('GSKG', { make: 2, urgency: 'now', plan: { needKgWeek: 3, oldKg: 0 } })],
      {
        imProgramm: false
      }
    );
    const z = zeilen([vonHand, ruht], null, [], []);
    assert.deepEqual(
      z.knapp.map((r) => [r.sp.name, r.fehlt.map((i) => i.key)]),
      [['Testart Alpha', ['GSKG']]]
    );
    assert.deepEqual(
      z.rot.map((r) => [r.sp.name, r.fehlt.map((i) => i.key)]),
      [['Testart Beta', ['GSKG']]]
    );
    assert.equal(z.woche.length + z.genug.length, 0);
  });

  it('still says it once where the plan has a row', () => {
    const z = zeilen(
      [
        art(3, 'Testart Gamma', [
          feld('PD', { make: 1, urgency: 'low' }),
          feld('GSKG', { make: 4, urgency: 'low', plan: { needKgWeek: 6, oldKg: 0 } })
        ])
      ],
      null,
      [],
      []
    );
    assert.deepEqual(
      z.knapp[0].fehlt.map((i) => i.key),
      ['PD']
    );
    assert.deepEqual(
      z.woche.map((r) => r.art),
      ['kb']
    );
  });

  it('knows the same Sorte by its key, however the other list spells its name', () => {
    const species = [
      art(7, 'Testart Delta', [feld('GSKG', { make: 4, urgency: 'low', plan: { needKgWeek: 6, oldKg: 0 } })])
    ];
    const z = zeilen(
      species,
      null,
      [],
      [
        { key: 'id:7', name: 'Testart Delta (TD)', supply: 'nospawn', taskAction: 'make-grain' },
        { key: 'id:8', name: 'Testart Epsilon', supply: 'nospawn', taskAction: 'make-grain' }
      ]
    );
    assert.deepEqual(
      z.woche.map((r) => r.art + ':' + (r.sp ? r.sp.name : r.s.name)),
      ['kb:Testart Delta', 'supply:Testart Epsilon']
    );
  });
});

describe('Bedarf: the list is written when it changes', () => {
  it('leaves the rows alone when an answer brings nothing new', () => {
    let writes = 0;
    let inhalt = '';
    const el = {
      get innerHTML() {
        return inhalt;
      },
      set innerHTML(v) {
        inhalt = v;
        writes++;
      }
    };
    const setze = new Function("let _bdHtml = '';\n" + hebe('_bdSetze') + '\nreturn _bdSetze;')();
    setze(el, '<p>a</p>');
    setze(el, '<p>a</p>');
    setze(el, '<p>a</p>');
    assert.equal(writes, 1, 'a tap under way must still hit the button it aimed at');
    setze(el, '<p>b</p>');
    assert.equal(writes, 2);
    // Emptied from outside (a test page, a rebuilt node): write again.
    inhalt = '';
    setze(el, '<p>b</p>');
    assert.equal(writes, 3);
  });

  it('goes through that one writer, for the list and for "loading"', () => {
    const r = hebe('renderBedarf');
    assert.doesNotMatch(r, /el\.innerHTML\s*=/);
    assert.equal((r.match(/_bdSetze\(el, /g) || []).length, 2);
  });
});

describe('the packing board belongs to Packen', () => {
  it('is not written from the start page or from Bedarf', () => {
    assert.doesNotMatch(hebe('wkPackLaden'), /_obBoard\s*=/);
    const laden = hebe('bedarfLaden');
    assert.doesNotMatch(laden, /_obBoard\s*=/);
    assert.match(laden, /_bdBoard = b;/);
    assert.match(hebe('renderBedarf'), /bedarfZeilen\(_lbSpecies\(\), _bdBoard, /);
  });

  it('lets Bedarf name a day against the day of its own board', () => {
    const tag = new Function('_obBoard', 't', 'loc', hebe('_obDay') + '\nreturn _obDay;')(
      { today: '2026-01-09' },
      (k) => k,
      () => 'de'
    );
    assert.equal(tag('2026-01-05', { today: '2026-01-05' }), 'orders.board.today');
    assert.equal(tag('2026-01-06', { today: '2026-01-05' }), 'orders.board.tomorrow');
    assert.equal(tag('2026-01-09'), 'orders.board.today', 'without a board of its own it is the one of Packen');
    assert.match(hebe('_bdZeileHtml'), /_obDay\(d\.day, _bdBoard\)/);
  });
});

describe('Heute: the parcels notice is written when it changes', () => {
  function hinweis() {
    const log = [];
    let hidden = true;
    let text = '';
    const el = {
      get hidden() {
        return hidden;
      },
      set hidden(v) {
        hidden = v;
        log.push('hidden');
      },
      get textContent() {
        return text;
      },
      set textContent(v) {
        text = v;
        log.push('text');
      }
    };
    const zeichne = new Function('document', 'tp', hebe('renderWorkPack') + '\nreturn renderWorkPack;')(
      { getElementById: () => el },
      (k, n) => k + ':' + n
    );
    return { zeichne, log, el };
  }

  it('touches nothing on a sync that brings the same number', () => {
    const h = hinweis();
    h.zeichne({ pack: [{}, {}] });
    assert.deepEqual(h.log, ['hidden', 'text']);
    h.zeichne({ pack: [{}, {}] });
    h.zeichne({ pack: [{}, {}] });
    assert.deepEqual(h.log, ['hidden', 'text'], 'the observer of the notices would rebuild the week for nothing');
    h.zeichne({ pack: [{}] });
    assert.deepEqual(h.log, ['hidden', 'text', 'text']);
    assert.equal(h.el.textContent, 'work.packN:1');
    h.zeichne({ pack: [] });
    assert.equal(h.el.hidden, true);
  });
});

describe('Zonen: a bag left in a contamination room', () => {
  function zeile(zones, beutel) {
    return new Function(
      'zones',
      'getZoneBags',
      'zoneDisplayName',
      't',
      'esc',
      hebe('zonenKontamHtml') + '\nreturn zonenKontamHtml();'
    )(
      zones,
      (id) => beutel[id] || {},
      (id) => 'Raum ' + id,
      (k, p) => k + JSON.stringify(p),
      (s) => String(s)
    );
  }
  const RAEUME = [
    { id: 'TESTINC', role: 'incubation' },
    { id: 'TESTKONTAM', role: 'contaminated' }
  ];

  it('says nothing while the room is empty', () => {
    assert.equal(zeile(RAEUME, { TESTINC: { 'T-1': {} } }), '');
  });

  it('says how many are still recorded there, and leads to the check of that room', () => {
    const h = zeile(RAEUME, { TESTKONTAM: { 'T-1': {}, 'T-2': {} } });
    assert.match(h, /data-action="zone-check" data-zone="TESTKONTAM"/);
    assert.match(h, /zones\.contamLeft\{"zone":"Raum TESTKONTAM","n":2\}/);
    assert.equal((h.match(/<button/g) || []).length, 1, 'no line for a room that is not one for contamination');
  });

  it('is drawn under the rooms and opens the stock check', () => {
    assert.match(hebe('renderZones'), /zonenReihe\(\)\.map\(zonenKarte\)\.join\(''\) \+ zonenKontamHtml\(\);/);
    assert.ok(APP.includes("else if (action === 'zone-check') openZoneCheck(btn.dataset.zone);"));
  });
});

describe('Zahlen: the Scan-Log follows a sync', () => {
  it('redraws the rows while it is the open view, and only then', () => {
    assert.match(hebe('refresh'), /if \(id === 'dash' && dashLogOffen\(\)\) renderLog\(\);/);
    const offen = (active) =>
      new Function('document', hebe('dashLogOffen') + '\nreturn dashLogOffen();')({
        getElementById: (id) => (id === 'sp-dash-log' ? { classList: { contains: () => active } } : null)
      });
    assert.equal(offen(true), true);
    assert.equal(offen(false), false);
  });
});
