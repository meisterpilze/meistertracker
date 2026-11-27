'use strict';
// Bedarf: what has to be made, in one place.
//
// Four calculations said it in six places: the lab stock (two cards on the lab
// page), the packing board (Herstellen), the sales shelf (a word on the row)
// and the list of Sorten (a row of the day list). Somebody asking "was muss ich
// herstellen" had to know which page counted which thing.
//
// The Bedarf page calculates nothing. It collects what those four already say,
// in three bands: an order is waiting for it; it is running low; it is this
// week's grain spawn or a Sorte with nothing on the way. One button per row
// starts the work through the flow that already exists.
//
// bedarfZeilen() does the sorting and is tested with plain objects.
// renderBedarf() and bedarfKlick() are lifted out of app.js and run against
// stand-ins. Every name and number here is invented. No browser.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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

const SORTIEREN = [konst('_lbFehlt'), konst('_shelfLow'), hebe('_kbpZeilen'), hebe('bedarfZeilen')].join('\n');
const zeilen = (species, board, shelf, supply) =>
  new Function(SORTIEREN + '\nreturn bedarfZeilen;')()(species, board, shelf, supply);

// A field of a species, as db.labStock sends it.
const feld = (key, o) => ({ key, have: 0, growing: 0, soll: null, make: 0, urgency: null, ...o });
const art = (strainId, name, items, o = {}) => ({ strainId, name, imProgramm: true, items, ...o });
const plan = (o) => ({ needKgWeek: 4, oldKg: 0, oldAt: null, ...o });

describe('Bedarf: which band a thing stands in', () => {
  it('puts a species an order waits for first, and one that is only short second', () => {
    const z = zeilen(
      [
        art(1, 'Testart Alpha', [feld('PD', { make: 2, urgency: 'low' })]),
        art(2, 'Testart Beta', [feld('SY10', { make: 1, urgency: 'now' }), feld('MC', { make: 1, urgency: 'low' })])
      ],
      null,
      [],
      []
    );
    assert.deepEqual(
      z.rot.map((r) => r.sp.name),
      ['Testart Beta']
    );
    assert.equal(z.rot[0].fehlt.length, 2, 'the row of a species carries everything it lacks, red or not');
    assert.deepEqual(
      z.knapp.map((r) => r.sp.name),
      ['Testart Alpha']
    );
  });

  it('keeps grain spawn in kg out of the row of the species: it has a row of its own', () => {
    const z = zeilen(
      [art(1, 'Testart Alpha', [feld('GSKG', { make: 6, urgency: 'low', plan: plan() })])],
      null,
      [],
      []
    );
    assert.equal(z.knapp.length, 0, 'the same kilograms would stand there twice');
    assert.deepEqual(
      z.woche.map((r) => [r.art, r.sp.name, r.i.make]),
      [['kb', 'Testart Alpha', 6]]
    );
  });

  it('takes what is made to order from the packing board, after the lab rows', () => {
    const z = zeilen(
      [art(1, 'Testart Alpha', [feld('PD', { make: 1, urgency: 'now' })])],
      { make: [{ sku: 'TEST-1', qty: 3, byDay: [], orders: 2 }] },
      [],
      []
    );
    assert.deepEqual(
      z.rot.map((r) => r.art),
      ['lab', 'make']
    );
  });

  it('lists a shelf item at or under its alarm, if it is in use', () => {
    const z = zeilen(
      [],
      null,
      [
        { id: 1, name: 'Testware A', stock: 4, minStock: 10, active: true },
        { id: 2, name: 'Testware B', stock: 12, minStock: 10, active: true },
        { id: 3, name: 'Testware C', stock: 0, minStock: 10, active: false }
      ],
      []
    );
    assert.deepEqual(
      z.knapp.map((r) => r.x.name),
      ['Testware A']
    );
  });

  it('sorts the week: to make and getting old above, enough folded away', () => {
    const z = zeilen(
      [
        art(1, 'Testart Alpha', [feld('GSKG', { make: 0, have: 9, plan: plan() })]),
        art(2, 'Testart Beta', [feld('GSKG', { make: 0, have: 9, plan: plan({ oldKg: 2 }) })]),
        art(3, 'Testart Gamma', [feld('GSKG', { make: 5, urgency: 'low', plan: plan() })]),
        art(4, 'Testart Delta', [feld('GSKG', { make: 2, urgency: 'now', plan: plan() })])
      ],
      null,
      [],
      []
    );
    assert.deepEqual(
      z.rot.map((r) => r.sp.name),
      ['Testart Delta'],
      'an order waits for it'
    );
    assert.deepEqual(z.woche.map((r) => r.sp.name).sort(), ['Testart Beta', 'Testart Gamma']);
    assert.deepEqual(
      z.genug.map((r) => r.sp.name),
      ['Testart Alpha']
    );
  });

  it('does not ask twice for the grain spawn of one Sorte', () => {
    const species = [art(1, 'Testart Alpha', [feld('GSKG', { make: 5, urgency: 'low', plan: plan() })])];
    const supply = [
      { key: 'id:1', name: 'Testart Alpha', supply: 'nospawn', taskAction: 'make-grain' },
      { key: 'id:2', name: 'Testart Beta', supply: 'now', taskAction: 'make-blocks' }
    ];
    const z = zeilen(species, null, [], supply);
    assert.deepEqual(
      z.woche.map((r) => r.art + ':' + (r.sp ? r.sp.name : r.s.name)),
      ['kb:Testart Alpha', 'supply:Testart Beta']
    );
  });
});

// The page against stand-ins. t() answers with the key and its parameters.
function seite({ species, board = null, shelf = [], supply = [], geladen = true, genugOffen = false }) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, innerHTML: '' });
  const t = (k, p) => (p ? k + JSON.stringify(p) : k);
  const code = [
    konst('_lbSpecies'),
    konst('_lbFehlt'),
    konst('_lbZahl'),
    konst('_kbZahl'),
    konst('_shelfLow'),
    konst('_bdWarum'),
    hebe('_lbChip'),
    hebe('_kbpZeilen'),
    hebe('_kbpAltText'),
    hebe('bedarfZeilen'),
    hebe('_bdKnopf'),
    hebe('_bdZeile'),
    hebe('_bdZeileHtml'),
    hebe('_bdSetze'),
    hebe('renderBedarf')
  ].join('\n');
  new Function(
    'document',
    't',
    'esc',
    'fmtKg',
    'fmtDtShort',
    '_obNum',
    '_obDay',
    'shelfItems',
    'buildSupplyTasks',
    `let _lbData = ${JSON.stringify(geladen ? { species } : null)};
     let _bdBoard = ${JSON.stringify(board)};
     let _bdHtml = '';
     let _bdGenugOffen = ${genugOffen};
     ${code}
     renderBedarf();`
  )(
    { getElementById: el },
    t,
    (s) => String(s),
    (v) => String(v),
    () => '04.11',
    (n) => String(n),
    (d) => 'am ' + d,
    shelf,
    () => supply
  );
  return els['bd-list'].innerHTML;
}

describe('Bedarf: what the page shows', () => {
  it('says only that it is loading before the lab has answered', () => {
    const h = seite({ species: [], geladen: false });
    assert.match(h, /common\.loading/);
    assert.doesNotMatch(h, /bd\.none/, 'no claim about figures nobody has seen');
  });

  it('says so when there is nothing to make', () => {
    assert.match(seite({ species: [art(1, 'Testart Alpha', [feld('PD', { have: 3 })])] }), /class="empty">bd\.none</);
  });

  it('draws the three bands in their order, each with its count, and leaves out an empty one', () => {
    const h = seite({
      species: [
        art(1, 'Testart Alpha', [feld('SY10', { ml: 10, make: 2, urgency: 'now' })]),
        art(2, 'Testart Beta', [feld('GSKG', { make: 5, urgency: 'low', plan: plan() })])
      ]
    });
    const rot = h.indexOf('bd.ordered');
    const woche = h.indexOf('bd.week');
    assert.ok(rot >= 0 && woche > rot, 'ordered stands above the week');
    assert.equal(h.indexOf('bd.low'), -1, 'a band with nothing in it is not drawn');
    assert.match(h, /np-dot np-now"[^>]*><\/i><span>bd\.ordered<\/span><span class="bd-n">1<\/span>/);
    assert.match(h, /np-dot np-week"[^>]*><\/i><span>bd\.week<\/span><span class="bd-n">1<\/span>/);
  });

  it('gives a species its gaps as chips and one button that makes all of them', () => {
    const h = seite({ species: [art(7, 'Testart Alpha', [feld('SY10', { ml: 10, make: 2, urgency: 'now' })])] });
    assert.match(h, /data-bd-art="7" class="np-main bd-open"><span class="np-what">Testart Alpha<\/span>/);
    assert.match(h, /np-chip np-now">lb\.chip\.SY\{"n":2,"ml":10\}/);
    assert.match(h, /btn-p np-go" data-bd-ansetzen="7">np\.go</);
  });

  it('gives grain spawn its kilograms, what stands behind them, and the same button', () => {
    const h = seite({
      species: [art(3, 'Testart Beta', [feld('GSKG', { make: 5, have: 2, growing: 1, urgency: 'low', plan: plan() })])]
    });
    assert.match(h, /bd\.kb\{"name":"Testart Beta"\} <span class="kbp-make">kbp\.make\{"n":"5"\}/);
    assert.match(h, /bd-why">kbp\.need\{"n":"4"\} · kbp\.have\{"n":"2"\} · kbp\.growing\{"n":"1"\}/);
    assert.match(h, /data-bd-kb="3" data-bd-kg="5">np\.go</);
    assert.match(h, /data-bd-art-kb="3" class="np-main bd-open"/, 'the text opens the calculation');
  });

  it('sends a made-to-order row to the packing board, where the mark is set', () => {
    const h = seite({
      species: [],
      board: {
        today: '2026-01-01',
        make: [{ sku: 'TEST-1', qty: 3, orders: 2, overdue: true, byDay: [{ day: '2026-01-02', qty: 3 }] }]
      }
    });
    assert.match(h, /np-what">3 × TEST-1</);
    assert.match(
      h,
      /bd-why bd-late">orders\.board\.labelOnQty\{"qty":"3","day":"am 2026-01-02"\} · orders\.board\.ordersN\.other\{"n":2\}/
    );
    assert.match(h, /np-go" data-bd-pack>bd\.toPack</);
    assert.doesNotMatch(h, /btn-p np-go" data-bd-pack/, 'it leads somewhere, it does not make anything');
  });

  it('names a shelf item with its count and alarm, and a Sorte with nothing on the way', () => {
    const h = seite({
      species: [],
      shelf: [{ id: 5, name: 'Testware A', stock: 4, minStock: 10, active: true }],
      supply: [{ key: 'id:9', name: 'Testart Gamma', supply: 'now', taskAction: 'make-blocks' }]
    });
    assert.match(h, /Testware A<\/span><small class="bd-why">bd\.shelfWhy\{"n":4,"min":10\}/);
    assert.match(h, /data-bd-shelf="5">bd\.look</);
    assert.match(h, /Testart Gamma<\/span><small class="bd-why">batch\.supply\.now</);
    assert.match(h, /data-bd-supply="id:9" data-bd-korn="0">todo\.makeBatch</);
  });

  it('folds away the Sorten with enough grain spawn, under the week', () => {
    const species = [art(1, 'Testart Alpha', [feld('GSKG', { make: 0, have: 9, plan: plan() })])];
    const zu = seite({ species });
    assert.match(zu, /bd\.week<\/span><span class="bd-n">0</);
    assert.match(zu, /data-bd-genug aria-expanded="false">bd\.enough\{"n":1\}</);
    assert.doesNotMatch(zu, /Testart Alpha/);
    const auf = seite({ species, genugOffen: true });
    assert.match(auf, /data-bd-genug aria-expanded="true">np\.less</);
    assert.match(auf, /bd\.kb\{"name":"Testart Alpha"\} <span class="kbp-ok">kbp\.enough/);
    assert.match(auf, /data-bd-art-kb="1">kbp\.show</, 'nothing to make, so the button shows the calculation');
  });
});

describe('Bedarf: what a tap does', () => {
  function tippe(dataset) {
    const calls = [];
    const note =
      (name) =>
      (...a) =>
        calls.push([name, ...a]);
    const klick = new Function(
      'lbAnsetzen',
      'lbSheetOpen',
      'kbpOeffnen',
      'go',
      'openStab',
      'renderShelf',
      'shelfSheetOpen',
      '_strainByKey',
      'setFb',
      't',
      'msQuickLabor',
      '_msqPickType',
      'msQuickCharge',
      'renderBedarf',
      'let _bdGenugOffen = false;\n' + hebe('bedarfKlick') + '\nreturn bedarfKlick;'
    )(
      note('ansetzen'),
      note('blatt'),
      note('rechnung'),
      note('go'),
      note('reiter'),
      note('regal'),
      note('regalblatt'),
      (key) => (key === 'id:9' ? { id: 9 } : null),
      note('fehler'),
      (k) => k,
      note('labor'),
      note('typ'),
      note('charge'),
      note('zeichnen')
    );
    klick({ closest: () => ({ dataset }) });
    return calls;
  }

  it('makes everything a species lacks', () => {
    assert.deepEqual(tippe({ bdAnsetzen: '7' }), [['ansetzen', 7]]);
  });

  it('makes the grain spawn of the row, with its kilograms', () => {
    assert.deepEqual(tippe({ bdKb: '3', bdKg: '5' }), [['ansetzen', 3, { GSKG: 5 }]]);
  });

  it('opens the species, or the calculation behind its grain spawn', () => {
    assert.deepEqual(tippe({ bdArt: '7' }), [['blatt', 7]]);
    assert.deepEqual(tippe({ bdArtKb: '3' }), [['rechnung', 3]]);
  });

  it('goes to Packen for what is made to order', () => {
    assert.deepEqual(tippe({ bdPack: '' }), [
      ['go', 'orders', 'n-orders'],
      ['reiter', 'orders', 'pack']
    ]);
  });

  it('opens the shelf item under Lager', () => {
    assert.deepEqual(tippe({ bdShelf: '5' }), [
      ['go', 'inv', 'n-inv'],
      ['reiter', 'inv', 'shelf'],
      ['regal'],
      ['regalblatt', 5]
    ]);
  });

  it('starts grain spawn or a Charge for a Sorte with nothing on the way', () => {
    assert.deepEqual(tippe({ bdSupply: 'id:9', bdKorn: '1' }), [
      ['labor', 9],
      ['typ', 'KB']
    ]);
    assert.deepEqual(tippe({ bdSupply: 'id:9', bdKorn: '0' }), [['charge', 9]]);
    assert.deepEqual(tippe({ bdSupply: 'id:404', bdKorn: '0' }), [['fehler', 'err', 'todo.supplyNoSorte']]);
  });

  it('opens and closes the fold', () => {
    assert.deepEqual(tippe({ bdGenug: '' }), [['zeichnen']]);
  });
});

describe('Bedarf: the page in the app', () => {
  it('has an entry in the menu and a page with its list', () => {
    assert.match(HTML, /<button class="sb-btn" id="n-bedarf" data-page="bedarf">[\s\S]*?data-i18n="nav\.bedarf"/);
    assert.match(HTML, /<div class="page" id="p-bedarf">\s*<div id="bd-list"><\/div>\s*<\/div>/);
  });

  it('loads when it opens and on every sync, and is wired', () => {
    assert.match(hebe('go'), /if \(page === 'bedarf'\) bedarfLaden\(\);/);
    assert.match(hebe('refresh'), /if \(id === 'bedarf'\) bedarfLaden\(\);/);
    assert.match(APP, /\$\('n-bedarf'\)\.addEventListener\('click', \(\) => \{\s*go\('bedarf', 'n-bedarf'\);/);
    assert.ok(APP.includes("$('bd-list').addEventListener('click', (e) => bedarfKlick(e.target));"));
  });

  it('asks the lab and the packing board, and draws again when either answers', () => {
    const laden = hebe('bedarfLaden');
    assert.match(laden, /loadLabStock\(\);/);
    assert.match(laden, /apiGet\('\/api\/orders\/board'\)/);
    assert.match(hebe('renderLabStock'), /if \(bedarfOffen\(\)\) renderBedarf\(\);/);
  });

  it('calls the middle band "Wird knapp"', () => {
    const window = {};
    new Function('window', fs.readFileSync(path.join(ROOT, 'lang', 'de.js'), 'utf8'))(window);
    assert.equal(window.LANG.de['bd.low'], 'Wird knapp');
  });
});
