'use strict';
// "Mehr" on a phone: the pages as tiles.
//
// The sheet was a list. First every page with all of its views as pills, some
// forty places under each other; then six headings that fold, with "the places
// one was in last" above them. Both were text to search through, and neither
// was liked by the people who use it.
//
// Now every page is a tile: its picture over its name, three across, all on one
// screen, the way the jobs stand on the start page. A tap opens the page. A
// page with several views shows them first, as a short list with a way back to
// the tiles. Above the tiles stands the search.
//
// The markup is still the flat list a desk shows as its sidebar, grouped by
// thing. Tiles are made of it by the phone block of styles.css alone.
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

  it('gives every group a name in three languages', () => {
    for (const g of gruppen) {
      for (const code of ['de', 'en', 'pt']) {
        assert.ok(sprache(code)[g.text], `${code}: no text for ${g.text}`);
      }
    }
  });

  it('keeps Admin and Abmelden under the list, outside the groups', () => {
    const fuss = HTML.slice(HTML.indexOf('<div class="sb-footer">'));
    assert.match(fuss, /id="n-settings"/);
    assert.match(fuss, /id="sb-logout"/);
    assert.doesNotMatch(NAV, /id="n-settings"/);
  });
});

describe('the pages are tiles on a phone', () => {
  it('stand three across, each as wide as its column', () => {
    assert.match(PHONE, /\.sb-nav \{\s*display: grid;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    const kachel = PHONE.match(/\n\s*\.sb-nav > \.sb-btn \{[^}]*\}/);
    assert.ok(kachel, 'no rule for a tile');
    assert.match(kachel[0], /flex-direction: column;/, 'the picture stands over the name');
    assert.match(kachel[0], /width: auto;/, 'a tile is not as wide as the sheet');
    assert.match(kachel[0], /white-space: normal;/, 'a long name may take a second line');
  });

  it('carry no group headings', () => {
    assert.match(PHONE, /\.sb-nav > \.sb-group-label \{\s*display: none;/);
  });

  it('leave to the bar what the bar opens, and keep a page whose other views it does not reach', () => {
    assert.match(PHONE, /\n\s*\.sb-in-bottom-nav \{\s*display: none;/);
    assert.match(PHONE, /\.sb-btn\.sb-in-bottom-nav:has\(\+ \.sb-sub\) \{\s*display: flex;/);
  });

  it('are a phone’s: a desk knows neither the grid nor the back row', () => {
    assert.doesNotMatch(EVERYWHERE, /\.sb-nav \{[^}]*display: grid;/);
    assert.match(EVERYWHERE, /\.mehr-zurueck \{\s*display: none;/);
    assert.doesNotMatch(EVERYWHERE, /mehr-seite/);
  });

  it('no longer fold and no longer list the places one was in last', () => {
    for (const name of ['mehrUmschalten', 'mehrMerk', 'zuletztZeichne', 'zuletztMerk', 'zuletztOeffnen']) {
      assert.equal(
        new RegExp('(?<![\\w$])' + name + '(?![\\w$])').test(APP),
        false,
        `${name} is still named in app.js`
      );
    }
    assert.doesNotMatch(CSS, /sb-fold-zu|sb-zuletzt/);
    assert.doesNotMatch(HTML, /id="sb-zuletzt"/);
  });
});

// A sheet as flat as the one in the markup: entries and, under some, the list
// of their views.
function blatt({ ansichten, telefon = true, offen = true }) {
  const klassen = (an) => {
    const set = new Set(an);
    return { add: (k) => set.add(k), remove: (k) => set.delete(k), contains: (k) => set.has(k) };
  };
  const listen = {};
  for (const [page, views] of Object.entries(ansichten)) {
    listen[page] = {
      page,
      classList: klassen([]),
      children: views.map(([name, versteckt]) => ({ name, style: { display: versteckt ? 'none' : '' } }))
    };
  }
  const nav = {
    classList: klassen([]),
    querySelectorAll: () => Object.values(listen).filter((l) => l.classList.contains('mehr-offen'))
  };
  const name = { textContent: '' };
  const sb = { scrollTop: 99 };
  const document = {
    body: { classList: { contains: (k) => k === 'sb-mobile-open' && offen } },
    querySelector: (sel) => {
      if (sel === '.sb-nav') return nav;
      const m = sel.match(/data-page="([a-z]+)"/);
      return m ? listen[m[1]] || null : null;
    },
    getElementById: (id) =>
      id === 'mehr-zurueck-name'
        ? name
        : id === 'sidebar'
          ? sb
          : id.startsWith('n-')
            ? { querySelector: () => ({ textContent: 'Seite ' + id.slice(2) }) }
            : null
  };
  const fns = new Function(
    'document',
    'sbIsPhone',
    ['mehrListe', 'mehrAnsichten', 'mehrRaster', 'mehrSeite', 'mehrKachelTipp'].map(hebe).join('\n') +
      '\nreturn { mehrAnsichten, mehrRaster, mehrSeite, mehrKachelTipp };'
  )(document, () => telefon);
  // A tap on the tile of a page, as the browser hands it over.
  const tipp = (page, echt = true) => {
    const e = {
      isTrusted: echt,
      gestoppt: false,
      target: { closest: () => ({ dataset: { page } }) },
      stopPropagation() {
        this.gestoppt = true;
      },
      preventDefault() {}
    };
    fns.mehrKachelTipp(e);
    return e.gestoppt;
  };
  return { ...fns, tipp, nav, listen, name, sb };
}
const SEITEN = {
  alpha: [['Eins'], ['Zwei'], ['Drei']],
  beta: [['Nur']],
  gamma: [['Sichtbar'], ['Versteckt', true]]
};

describe('a tap on a tile', () => {
  it('shows the views of a page that has several, and does not open the page yet', () => {
    const b = blatt({ ansichten: SEITEN });
    assert.equal(b.tipp('alpha'), true, 'the entry would open the page under the list');
    assert.equal(b.nav.classList.contains('mehr-seite'), true);
    assert.equal(b.listen.alpha.classList.contains('mehr-offen'), true);
    assert.equal(b.name.textContent, 'Seite alpha', 'the way back is named after the page');
    assert.equal(b.sb.scrollTop, 0);
  });

  it('opens a page with one view straight away', () => {
    const b = blatt({ ansichten: SEITEN });
    assert.equal(b.tipp('beta'), false);
    assert.equal(b.nav.classList.contains('mehr-seite'), false);
  });

  it('counts only the views this user sees', () => {
    const b = blatt({ ansichten: SEITEN });
    assert.equal(b.mehrAnsichten('gamma').length, 1);
    assert.equal(b.tipp('gamma'), false, 'a list of one is a detour');
  });

  it('leaves alone a click the app makes itself: the bar, the search, a view picked in the list', () => {
    // They press the same entries with click(), and mean the page.
    const b = blatt({ ansichten: SEITEN });
    assert.equal(b.tipp('alpha', false), false);
  });

  it('leaves the entries of a desk and of a closed sheet alone', () => {
    assert.equal(blatt({ ansichten: SEITEN, telefon: false }).tipp('alpha'), false);
    assert.equal(blatt({ ansichten: SEITEN, offen: false }).tipp('alpha'), false);
  });

  it('shows one page at a time, and goes back to the tiles', () => {
    const b = blatt({ ansichten: { ...SEITEN, delta: [['A'], ['B']] } });
    b.mehrSeite('alpha');
    b.mehrSeite('delta');
    assert.equal(b.listen.alpha.classList.contains('mehr-offen'), false);
    assert.equal(b.listen.delta.classList.contains('mehr-offen'), true);
    b.mehrRaster();
    assert.equal(b.nav.classList.contains('mehr-seite'), false);
    assert.equal(b.listen.delta.classList.contains('mehr-offen'), false);
  });
});

describe('the views of one page, in the sheet', () => {
  it('take the place of the tiles, under the name of the page as the way back', () => {
    assert.match(PHONE, /\.sb-nav\.mehr-seite > \.sb-btn \{\s*display: none;/);
    assert.match(PHONE, /\.sb-nav\.mehr-seite > \.mehr-zurueck \{\s*display: flex;/);
    assert.match(
      PHONE,
      /\.sb-nav\.mehr-seite > \.sb-btn \+ \.sb-sub\.mehr-offen \{\s*display: flex;\s*flex-direction: column;/
    );
  });

  it('have the back row in the list, drawn without a character', () => {
    assert.match(
      NAV,
      /<button type="button" class="mehr-zurueck" id="mehr-zurueck" data-i18n-aria-label="work\.back">\s*<span class="mehr-zurueck-pfeil" aria-hidden="true"><\/span><span id="mehr-zurueck-name"><\/span>/
    );
    for (const code of ['de', 'en', 'pt']) assert.ok(sprache(code)['work.back'], code + ': no text for work.back');
  });

  it('open a view the way the list always did', () => {
    assert.match(hebe('sbSubInit'), /sbSubOpen\(btn\);/);
  });
});

describe('the sheet from the top', () => {
  it('has the search, then the pages', () => {
    const suche = HTML.indexOf('<div class="sb-search-wrap">');
    const nav = HTML.indexOf('<nav class="sb-nav"');
    assert.ok(suche > 0 && nav > suche);
  });

  it('shows the search in the sheet and leaves the keyboard hint to a desk', () => {
    assert.doesNotMatch(PHONE, /\.sb-search-wrap \{\s*display: none;/);
    assert.match(PHONE, /\.sb-search-key \{\s*display: none;/);
  });

  it('opens on the tiles each time, at the top', () => {
    assert.match(
      hebe('toggleSidebar'),
      /if \(sb\.classList\.contains\('sb-open'\)\) \{\s*mehrZeichne\(\);\s*sb\.scrollTop = 0;/
    );
    assert.match(hebe('mehrZeichne'), /mehrRaster\(\);/);
  });

  it('closes the sheet before the search opens, and gives the focus back to "Mehr"', () => {
    assert.match(
      hebe('gsOpen'),
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
    assert.match(
      init,
      /nav\.addEventListener\('click', mehrKachelTipp, true\);/,
      'the tap must arrive before the entry opens its page'
    );
    assert.match(init, /zurueck\.addEventListener\('click', mehrRaster\);/);
  });
});
