'use strict';
// "Mehr" on a phone: search, the places one was in last, groups that fold.
//
// The sheet listed every page with all of its views at once: some forty places
// under each other, two screens long. Whoever looked for one read all of them.
// And the groups it stood in (Arbeiten, Nachschauen, Werkzeuge) named what one
// is doing, so the page one looked for could stand under any of them.
//
// Now the list is grouped by thing, on a desk and on a phone. On a phone each
// group is a heading that opens and closes; the group of the open page starts
// open, and what somebody left open is remembered on that device. Above the
// groups stand the search and up to four places one was in last.
//
// Checked as text and with the functions lifted out of app.js and run against
// stand-ins. Every page, view and name in the stand-ins is invented. No browser.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { blocks, MAX_WIDTH_BLOCK } = require('../scripts/mobile-size-scan.js');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const PHONE = [...blocks(CSS, MAX_WIDTH_BLOCK)].map((b) => b.body).join('\n');
const MIN_WIDTH_BLOCK = /@media[^{]*min-width[^{]*\{/g;
const EVERYWHERE = (() => {
  let out = CSS;
  for (const b of blocks(CSS, MAX_WIDTH_BLOCK)) out = out.replace(b.body, '');
  for (const b of blocks(CSS, MIN_WIDTH_BLOCK)) out = out.replace(b.body, '');
  return out;
})();

function hebe(name) {
  const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
  assert.ok(m, name + '() not found in app.js');
  return m[1];
}
function konst(name) {
  const m = APP.match(new RegExp('^(?:const|let) ' + name + ' = .*;$', 'm'));
  assert.ok(m, name + ' not found in app.js');
  return m[0];
}
function sprache(code) {
  const window = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'lang', code + '.js'), 'utf8'))(window);
  return window.LANG[code];
}

const NAV = HTML.slice(HTML.indexOf('<nav class="sb-nav"'), HTML.indexOf('<nav class="sb-admin-nav"'));

describe('the list is grouped by thing', () => {
  const gruppen = NAV.split(/<div class="sb-group-label"/)
    .slice(1)
    .map((chunk) => ({
      key: (chunk.match(/^[^>]*data-group="([a-z]+)"/) || [])[1],
      text: (chunk.match(/^[^>]*data-i18n="([^"]+)"/) || [])[1],
      seiten: [...chunk.matchAll(/<button class="sb-btn[^"]*" id="(n-[a-z]+)"/g)].map((m) => m[1])
    }));

  it('has seven groups, each page in one of them', () => {
    assert.deepEqual(
      gruppen.map((g) => [g.key, g.seiten]),
      [
        ['start', ['n-work']],
        ['planen', ['n-bedarf', 'n-cal', 'n-proj']],
        ['produktion', ['n-batch', 'n-lab', 'n-zones']],
        ['verkauf', ['n-orders', 'n-pickups']],
        ['lager', ['n-inv']],
        ['auswerten', ['n-dash']],
        ['einrichten', ['n-strains', 'n-print']]
      ]
    );
  });

  it('gives every group a key to be remembered by and a name in three languages', () => {
    for (const g of gruppen) {
      assert.ok(g.key, 'a group heading without data-group cannot be folded or remembered');
      for (const code of ['de', 'en', 'pt']) {
        assert.ok(sprache(code)[g.text], `${code}: no text for ${g.text}`);
      }
    }
    assert.equal(new Set(gruppen.map((g) => g.key)).size, gruppen.length, 'two groups share a key');
  });

  it('keeps Admin and Abmelden under the list, outside the groups', () => {
    const fuss = HTML.slice(HTML.indexOf('<div class="sb-footer">'));
    assert.match(fuss, /id="n-settings"/);
    assert.match(fuss, /id="sb-logout"/);
    assert.doesNotMatch(NAV, /id="n-settings"/);
  });
});

// A list as flat as the one in the markup: headings, entries, and the lists of
// views sbSubInit() hangs under an entry.
function liste(plan) {
  const els = plan.map(([art, name, extra]) => {
    const klassen = new Set(art === 'gruppe' ? ['sb-group-label'] : art === 'seite' ? ['sb-btn'] : ['sb-sub']);
    if (extra === 'offen') klassen.add('active');
    const attrs = {};
    return {
      art,
      name,
      dataset: art === 'gruppe' ? { group: name } : {},
      attrs,
      classList: {
        contains: (k) => klassen.has(k),
        add: (k) => klassen.add(k),
        remove: (k) => klassen.delete(k),
        toggle: (k, an) => (an ? klassen.add(k) : klassen.delete(k))
      },
      setAttribute: (k, v) => (attrs[k] = v),
      removeAttribute: (k) => delete attrs[k],
      hat: (k) => klassen.has(k)
    };
  });
  els.forEach((el, i) => (el.nextElementSibling = els[i + 1] || null));
  return els;
}
function blatt({ plan, telefon, gemerkt, speicherKaputt = false }) {
  const els = liste(plan);
  const speicher = { 'mp-mehr-auf': gemerkt === undefined ? null : JSON.stringify(gemerkt) };
  const localStorage = {
    getItem: (k) => {
      if (speicherKaputt) throw new Error('blocked');
      return speicher[k] === undefined ? null : speicher[k];
    },
    setItem: (k, v) => {
      if (speicherKaputt) throw new Error('blocked');
      speicher[k] = v;
    }
  };
  const document = {
    querySelectorAll: () => els.filter((el) => el.art === 'gruppe')
  };
  const fns = new Function(
    'document',
    'localStorage',
    'sbIsPhone',
    [
      konst('MEHR_KEY'),
      'let _mehrAuf = null;',
      hebe('mehrAuf'),
      hebe('mehrMerk'),
      hebe('mehrGruppen'),
      hebe('mehrSetze'),
      hebe('mehrZeichne'),
      hebe('mehrUmschalten'),
      'return { mehrZeichne, mehrUmschalten };'
    ].join('\n')
  )(document, localStorage, () => telefon);
  const zu = () => els.filter((el) => el.art !== 'gruppe' && el.hat('sb-fold-zu')).map((el) => el.name);
  const gruppe = (name) => els.find((el) => el.art === 'gruppe' && el.name === name);
  return { ...fns, els, zu, gruppe, speicher };
}
const PLAN = [
  ['gruppe', 'eins'],
  ['seite', 'n-alpha'],
  ['ansichten', 'alpha-views'],
  ['seite', 'n-beta'],
  ['gruppe', 'zwei'],
  ['seite', 'n-gamma', 'offen'],
  ['ansichten', 'gamma-views'],
  ['gruppe', 'drei'],
  ['seite', 'n-delta']
];

describe('the groups fold on a phone', () => {
  it('opens only the group of the page one stands on, the first time', () => {
    const b = blatt({ plan: PLAN, telefon: true });
    b.mehrZeichne();
    assert.deepEqual(b.zu(), ['n-alpha', 'alpha-views', 'n-beta', 'n-delta']);
    assert.equal(b.gruppe('zwei').attrs['aria-expanded'], 'true');
    assert.equal(b.gruppe('eins').attrs['aria-expanded'], 'false');
    assert.equal(b.gruppe('eins').hat('sb-zu'), true);
  });

  it('folds the views of a page with the page', () => {
    const b = blatt({ plan: PLAN, telefon: true });
    b.mehrZeichne();
    assert.ok(b.zu().includes('alpha-views'), 'a list of views would stand under a folded group');
  });

  it('makes a heading a button there: a role, a place in the tab order, a state', () => {
    const b = blatt({ plan: PLAN, telefon: true });
    b.mehrZeichne();
    assert.deepEqual(b.gruppe('drei').attrs, { role: 'button', tabindex: '0', 'aria-expanded': 'false' });
  });

  it('keeps open what was left open on this device', () => {
    const b = blatt({ plan: PLAN, telefon: true, gemerkt: ['drei'] });
    b.mehrZeichne();
    assert.deepEqual(b.zu(), ['n-alpha', 'alpha-views', 'n-beta']);
  });

  it('opens a group on a tap and remembers it; closes it on the next and forgets it', () => {
    const b = blatt({ plan: PLAN, telefon: true });
    b.mehrZeichne();
    b.mehrUmschalten(b.gruppe('eins'));
    assert.deepEqual(b.zu(), ['n-delta']);
    assert.deepEqual(JSON.parse(b.speicher['mp-mehr-auf']), ['eins']);
    b.mehrUmschalten(b.gruppe('eins'));
    assert.deepEqual(b.zu(), ['n-alpha', 'alpha-views', 'n-beta', 'n-delta']);
    assert.deepEqual(JSON.parse(b.speicher['mp-mehr-auf']), []);
  });

  it('lets the group of the open page be closed for now, and opens it again next time', () => {
    const b = blatt({ plan: PLAN, telefon: true });
    b.mehrZeichne();
    b.mehrUmschalten(b.gruppe('zwei'));
    assert.ok(b.zu().includes('n-gamma'));
    b.mehrZeichne();
    assert.ok(!b.zu().includes('n-gamma'), 'the sheet opened without the group one stands in');
  });

  it('works without storage: nothing is remembered, nothing breaks', () => {
    const b = blatt({ plan: PLAN, telefon: true, speicherKaputt: true });
    b.mehrZeichne();
    b.mehrUmschalten(b.gruppe('eins'));
    assert.deepEqual(b.zu(), ['n-delta']);
  });
});

describe('nothing folds on a desk', () => {
  it('leaves the headings headings, and takes back what a phone had set', () => {
    const b = blatt({ plan: PLAN, telefon: true });
    b.mehrZeichne();
    const desk = new Function(
      'document',
      'localStorage',
      'sbIsPhone',
      [
        konst('MEHR_KEY'),
        'let _mehrAuf = null;',
        hebe('mehrAuf'),
        hebe('mehrGruppen'),
        hebe('mehrSetze'),
        hebe('mehrZeichne'),
        'return mehrZeichne;'
      ].join('\n')
    )({ querySelectorAll: () => b.els.filter((el) => el.art === 'gruppe') }, { getItem: () => null }, () => false);
    desk();
    assert.deepEqual(b.zu(), []);
    for (const el of b.els.filter((x) => x.art === 'gruppe')) {
      assert.deepEqual(el.attrs, {}, 'a heading that does nothing still says it is a button');
      assert.equal(el.hat('sb-zu'), false);
    }
  });

  it('ignores a click on a heading', () => {
    const b = blatt({ plan: PLAN, telefon: false });
    b.mehrZeichne();
    b.mehrUmschalten(b.gruppe('eins'));
    assert.deepEqual(b.zu(), []);
    assert.equal(b.speicher['mp-mehr-auf'], null);
  });

  it('knows the fold only below the breakpoint', () => {
    assert.match(
      PHONE,
      /\.sb-nav > \.sb-btn\.sb-fold-zu,\s*\.sb-nav > \.sb-btn \+ \.sb-sub\.sb-fold-zu \{\s*display: none;/
    );
    assert.doesNotMatch(EVERYWHERE, /sb-fold-zu/, 'a class a desk never sets is styled for a desk');
    assert.doesNotMatch(EVERYWHERE, /\.sb-group-label\[data-group\]/);
  });

  it('puts the rule that folds after every rule that shows', () => {
    const fold = CSS.indexOf('.sb-nav > .sb-btn.sb-fold-zu,');
    for (const zeigt of [
      '.sb-btn.active + .sb-sub {',
      '.sb-nav > .sb-btn + .sb-sub {',
      '.sb-btn.sb-in-bottom-nav:has(+ .sb-sub) {'
    ]) {
      const i = CSS.indexOf(zeigt);
      assert.ok(i > 0 && fold > i, `the fold stands before "${zeigt}" and loses to it`);
    }
  });

  it('does not set display on a heading, so a group that is all in the bar stays hidden', () => {
    const regel = PHONE.match(/\.sb-nav > \.sb-group-label\[data-group\] \{[^}]*\}/);
    assert.ok(regel, 'the heading of a group has no rule on a phone');
    assert.doesNotMatch(regel[0], /\bdisplay:/);
  });

  it('no longer lifts the open page out of its group', () => {
    assert.doesNotMatch(PHONE, /\.sb-nav > \.sb-btn\.active:has\(\+ \.sb-sub\),/);
  });
});

// ── Zuletzt ──
const ZULETZT = [
  konst('ZULETZT_ZEIGEN'),
  konst('ZULETZT_MERKEN'),
  konst('_zuletztGleich'),
  hebe('zuletztOrt'),
  hebe('zuletztNeu'),
  hebe('zuletztOrte')
].join('\n');

describe('Zuletzt: what is remembered', () => {
  const neu = new Function(ZULETZT + '\nreturn zuletztNeu;')();

  it('puts a place in front, once', () => {
    const l = neu(
      [
        { b: 'n-alpha', s: null },
        { b: 'n-beta', s: 'st-beta-eins' }
      ],
      { b: 'n-beta', s: 'st-beta-eins' }
    );
    assert.deepEqual(l, [
      { b: 'n-beta', s: 'st-beta-eins' },
      { b: 'n-alpha', s: null }
    ]);
  });

  it('keeps two views of one page apart', () => {
    const l = neu([{ b: 'n-beta', s: 'st-beta-eins' }], { b: 'n-beta', s: 'st-beta-zwei' });
    assert.equal(l.length, 2);
  });

  it('keeps no more than it is meant to', () => {
    let l = [];
    for (let i = 0; i < 30; i++) l = neu(l, { b: 'n-seite' + i, s: null });
    assert.equal(l.length, 12);
    assert.equal(l[0].b, 'n-seite29');
  });

  it('is fed where a step is counted, and nowhere else', () => {
    // zurueckMerk() already knows a change by a tap from a jump the app makes
    // by itself, a step back, and go() followed by openStab().
    assert.match(
      hebe('zurueckMerk'),
      /_zSpur\.push\(w\);\n {2}if \(_zSpur\.length > Z_SPUR_MAX\) _zSpur\.shift\(\);\n {2}zuletztMerk\(w\);/
    );
    assert.equal((APP.match(/zuletztMerk\(/g) || []).length, 2, 'a second place feeds the list');
  });

  it('takes the list of views of a page as a place of its own, where a phone shows one', () => {
    const ort = (w, drill, telefon) =>
      new Function('document', 'sbIsPhone', ZULETZT + '\nreturn zuletztOrt;')(
        { getElementById: () => ({ classList: { contains: (k) => drill && k === 'stab-drill' } }) },
        () => telefon
      )(w);
    const w = { page: 'alpha', btnId: 'n-alpha', stab: 'st-alpha-eins', drilled: false };
    assert.deepEqual(ort(w, true, true), { b: 'n-alpha', s: null });
    assert.deepEqual(ort({ ...w, drilled: true }, true, true), { b: 'n-alpha', s: 'st-alpha-eins' });
    assert.deepEqual(ort(w, true, false), { b: 'n-alpha', s: 'st-alpha-eins' });
    assert.equal(ort({ page: 'alpha', btnId: 'sn-alpha-eins', stab: null }, false, true), null, 'a view is not a page');
  });
});

// The entries and tabs the list of places is checked against.
function seiten() {
  const strip = { dataset: { stabDefault: 'st-beta-eins' } };
  const stripP = { dataset: { stabDefault: 'st-pack-eins' } };
  const el = (o) => ({ style: { display: '' }, dataset: {}, classList: { contains: () => false }, ...o });
  const nav = (key, inBar) =>
    el({
      classList: { contains: (k) => inBar && k === 'sb-in-bottom-nav' },
      querySelector: () => ({ dataset: { i18n: key }, textContent: key })
    });
  const tab = (key, s, extra = {}) => el({ dataset: { i18n: key, ...extra }, closest: () => s });
  return {
    'n-alpha': nav('seite.alpha'),
    'n-beta': nav('seite.beta'),
    'st-beta-eins': Object.assign(tab('ansicht.eins', strip), { id: 'st-beta-eins' }),
    'st-beta-zwei': Object.assign(tab('ansicht.zwei', strip), { id: 'st-beta-zwei' }),
    'st-beta-weg': Object.assign(tab('ansicht.weg', strip), { id: 'st-beta-weg', style: { display: 'none' } }),
    'n-leiste': nav('seite.leiste', true),
    'n-pack': nav('seite.pack', true),
    'st-pack-eins': Object.assign(tab('ansicht.packen', stripP, { pageTitle: '' }), { id: 'st-pack-eins' }),
    'st-pack-zwei': Object.assign(tab('ansicht.eingang', stripP), { id: 'st-pack-zwei' }),
    'n-geheim': Object.assign(nav('seite.geheim'), { style: { display: 'none' } }),
    'p-hier': el({})
  };
}
function orte(gemerkt, hier = { page: 'hier', btnId: 'n-hier', stab: null }) {
  const els = seiten();
  return new Function('document', 'sbIsPhone', 'whereAmI', 't', 'zuletztListe', ZULETZT + '\nreturn zuletztOrte();')(
    { getElementById: (id) => els[id] || null },
    () => true,
    () => hier,
    (k) => 'T:' + k,
    () => gemerkt
  );
}

describe('Zuletzt: what is shown', () => {
  it('names a page on its first view like the page, and any other view like the view', () => {
    const o = orte([
      { b: 'n-beta', s: 'st-beta-zwei' },
      { b: 'n-beta', s: 'st-beta-eins' },
      { b: 'n-alpha', s: null }
    ]);
    assert.deepEqual(
      o.map((x) => x.text),
      ['T:ansicht.zwei', 'T:seite.beta', 'T:seite.alpha']
    );
  });

  it('leaves out the place one stands on', () => {
    const o = orte(
      [
        { b: 'n-beta', s: 'st-beta-zwei' },
        { b: 'n-alpha', s: null }
      ],
      { page: 'beta', btnId: 'n-beta', stab: 'st-beta-zwei' }
    );
    assert.deepEqual(
      o.map((x) => x.b),
      ['n-alpha']
    );
  });

  it('leaves out what this user does not see and what is no longer there', () => {
    const o = orte([
      { b: 'n-geheim', s: null },
      { b: 'n-beta', s: 'st-beta-weg' },
      { b: 'n-beta', s: 'st-beta-fort' },
      { b: 'n-fort', s: null },
      { b: 'n-alpha', s: null }
    ]);
    assert.deepEqual(
      o.map((x) => x.b),
      ['n-alpha']
    );
  });

  it('leaves out where the bar leads anyway, but not another view of that page', () => {
    const o = orte([
      { b: 'n-leiste', s: null },
      { b: 'n-pack', s: 'st-pack-eins' },
      { b: 'n-pack', s: 'st-pack-zwei' }
    ]);
    assert.deepEqual(
      o.map((x) => x.text),
      ['T:ansicht.eingang']
    );
  });

  it('shows four, the newest first', () => {
    const viele = [];
    for (const s of ['st-beta-zwei', 'st-beta-eins']) viele.push({ b: 'n-beta', s });
    viele.push({ b: 'n-alpha', s: null }, { b: 'n-pack', s: 'st-pack-zwei' }, { b: 'n-alpha', s: 'x' });
    viele.push({ b: 'n-beta', s: null });
    const o = orte(viele);
    assert.equal(o.length, 4);
    assert.equal(o[0].text, 'T:ansicht.zwei');
  });
});

describe('Zuletzt: what a tap does', () => {
  function tippe({ seiteOffen, darf = true, stab = 'st-beta-zwei', drill = false }) {
    const log = [];
    const klassen = new Set(drill ? ['stab-drill', 'stab-drilled'] : []);
    if (seiteOffen) klassen.add('active');
    const seite = {
      classList: { contains: (k) => klassen.has(k), remove: (k) => (klassen.delete(k), log.push('liste')) }
    };
    const els = {
      'n-beta': { dataset: { page: 'beta' } },
      'p-beta': seite,
      'st-beta-zwei': { click: () => log.push('ansicht') }
    };
    new Function(
      'document',
      'mayLeavePage',
      'gsNav',
      'sbCloseMobile',
      'sbIsPhone',
      hebe('zuletztOeffnen') + '\nreturn zuletztOeffnen;'
    )(
      { getElementById: (id) => els[id] || null },
      () => {
        log.push('frage');
        return darf;
      },
      (b, p) => log.push('seite ' + b + ' ' + p),
      () => log.push('zu'),
      () => true
    )('n-beta', stab);
    return log;
  }

  it('opens the page by its own entry, then the view by its tab, and asks once before', () => {
    assert.deepEqual(tippe({ seiteOffen: false }), ['frage', 'seite n-beta beta', 'ansicht', 'zu']);
  });

  it('only changes the view when its page is open', () => {
    assert.deepEqual(tippe({ seiteOffen: true }), ['ansicht', 'zu']);
  });

  it('changes nothing when the person stays to save what is unsaved', () => {
    assert.deepEqual(tippe({ seiteOffen: false, darf: false }), ['frage']);
  });

  it('goes back to the list of views where that list was the place', () => {
    assert.deepEqual(tippe({ seiteOffen: false, stab: null, drill: true }), [
      'frage',
      'seite n-beta beta',
      'liste',
      'zu'
    ]);
  });
});

describe('the sheet from the top', () => {
  it('has the search, then Zuletzt, then the list', () => {
    const suche = HTML.indexOf('<div class="sb-search-wrap">');
    const zuletzt = HTML.indexOf('<div class="sb-zuletzt" id="sb-zuletzt" hidden>');
    const nav = HTML.indexOf('<nav class="sb-nav"');
    assert.ok(suche > 0 && zuletzt > suche && nav > zuletzt);
    assert.match(HTML, /<div class="sb-zuletzt-t" data-i18n="nav\.recent">/);
    for (const code of ['de', 'en', 'pt']) assert.ok(sprache(code)['nav.recent'], code + ': no text for nav.recent');
  });

  it('shows the search in the sheet and leaves the keyboard hint to a desk', () => {
    assert.doesNotMatch(PHONE, /\.sb-search-wrap \{\s*display: none;/);
    assert.doesNotMatch(PHONE, /,\s*(\/\*[^*]*\*\/\s*)?\.sb-search-wrap \{\s*display: none;/);
    assert.match(PHONE, /\.sb-search-key \{\s*display: none;/);
  });

  it('shows Zuletzt in the sheet only', () => {
    assert.match(EVERYWHERE, /\.sb-zuletzt \{\s*display: none;/);
    assert.match(PHONE, /\.sb-zuletzt:not\(\[hidden\]\) \{\s*display: block;/);
  });

  it('draws groups and places each time the sheet opens, and starts at the top', () => {
    const toggle = hebe('toggleSidebar');
    assert.match(
      toggle,
      /if \(sb\.classList\.contains\('sb-open'\)\) \{\s*mehrZeichne\(\);\s*zuletztZeichne\(\);\s*sb\.scrollTop = 0;/
    );
  });

  it('closes the sheet before the search opens, and gives the focus back to "Mehr"', () => {
    const open = hebe('gsOpen');
    assert.match(
      open,
      /if \(document\.body\.classList\.contains\('sb-mobile-open'\)\) \{\s*sbCloseMobile\(\);\s*gsReturnFocus = document\.getElementById\('tgl-17'\);/
    );
    assert.match(HTML, /<button class="sb-btn sb-search" id="sb-search" type="button" data-gs-open>/);
  });

  it('is set up once the views are in the list, and again when the window crosses the line', () => {
    assert.match(APP, /\n {2}sbSubInit\(\);\n {2}mehrInit\(\);/);
    assert.match(
      APP,
      /sbPhone\.addEventListener\('change', \(\) => \{\s*sbClose\(\);\s*sbUncollapse\(\);\s*mehrZeichne\(\);/
    );
    const init = hebe('mehrInit');
    assert.match(init, /closest\('\.sb-group-label\[data-group\]'\)/);
    assert.match(
      init,
      /e\.key !== 'Enter' && e\.key !== ' '/,
      'a heading with the role of a button ignores the keyboard'
    );
    assert.match(init, /zuletztOeffnen\(b\.dataset\.zuletztB, b\.dataset\.zuletztS \|\| null\)/);
  });
});
