'use strict';
// The sub-tab drill-down, checked as text — same limit and same reason as
// test/mobile-tokens.test.js: no browser, no jsdom, so these prove the rules are
// written, not that they render. The device pass is what proves the second one.
//
// What makes this worth a file of its own: the drill-down is the first thing in
// this app whose behaviour is split across three files that cannot see each
// other. index.html names the page a strip goes back to, lang/*.js holds the
// string, styles.css decides what the two states look like, and app.js decides
// which state a page is in. Any one of them can be edited alone and the result
// is a back row reading `nav.batches`, or a strip that scrolls sideways again,
// and neither throws.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { blocks, MAX_WIDTH_BLOCK } = require('../scripts/mobile-size-scan.js');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const SPRACHEN = ['de', 'en', 'pt'];

// Every `<div class="stabs" …>` opening tag, with its attributes.
const STRIPS = [...HTML.matchAll(/<div class="stabs"([^>]*)>/g)].map((m) => m[1]);

// The phone block is the `max-width` block that carries the back row. Found by
// content rather than by line number so reordering the stylesheet is free.
const PHONE_BLOCK = (() => {
  for (const b of blocks(CSS, MAX_WIDTH_BLOCK)) if (b.body.includes('.stab-back')) return b.body;
  return null;
})();

describe('the sub-tab drill-down', () => {
  it('finds the strips to check — a silent zero would make this file useless', () => {
    assert.ok(STRIPS.length >= 5, `expected at least 5 .stabs strips in index.html, found ${STRIPS.length}`);
  });

  it('has a phone block', () => {
    assert.ok(PHONE_BLOCK, 'no `max-width` block in styles.css mentions .stab-back — the drill-down is gone');
  });

  it('gives every strip either a home to go back to or a reason it has none', () => {
    // Two legitimate states, no third. A strip with neither gets a back row
    // labelled with a raw i18n key, which renders and ships.
    const orphans = STRIPS.filter((attrs) => !/data-stab-home="/.test(attrs) && !/display:\s*none/.test(attrs));
    assert.equal(orphans.length, 0, `strip(s) with no data-stab-home and no display:none: ${JSON.stringify(orphans)}`);
  });

  it('shows one sub-page at a time, and none on the index', () => {
    assert.match(
      PHONE_BLOCK,
      /\.page\.stab-drilled > \.stabs \{\s*display: none;/,
      'inside a sub-page the strip must be hidden — otherwise the list sits above the content it opened'
    );
    assert.match(
      PHONE_BLOCK,
      /\.page\.stab-drill:not\(\.stab-drilled\) \.sp \{\s*display: none;/,
      'on the index no sub-page may show. This selector is 0,4,0 and beats `.sp.active` at 0,2,0 — ' +
        'weaken it and the default panel renders under the list'
    );
    assert.match(
      PHONE_BLOCK,
      /\.page\.stab-drilled > \.stab-back \{\s*display: flex;/,
      'no way back out of a sub-page'
    );
  });

  it('keeps the back row off the desktop', () => {
    // Declared outside any media query, so the phone block is what turns it on.
    // A back row on a desktop points at a list that page never shows.
    assert.match(CSS, /\n\.stab-back \{\n {2}display: none;\n\}/, '.stab-back must default to display: none');
  });

  it('gives the list rows the full touch target', () => {
    assert.match(
      PHONE_BLOCK,
      /min-height: var\(--tap\);/,
      "a row in the page's own navigation gets --tap, not the --tap-sm the desktop pills use"
    );
  });

  it('has not grown either of the strip mitigations back', () => {
    // Both treated the symptom, and both are what the drill-down replaced:
    // wrapping to a second line ate a third of a short screen, and sideways
    // scroll hid the far end from anyone who did not think to swipe.
    for (const b of blocks(CSS, MAX_WIDTH_BLOCK)) {
      assert.doesNotMatch(b.body, /\.stabs \{[^}]*flex-wrap: wrap/s, 'a `max-width` block wraps .stabs again');
      assert.doesNotMatch(b.body, /#p-settings > \.stabs \{[^}]*overflow-x: auto/s, 'Admin scrolls sideways again');
    }
  });

  it('reaches only the pages that were given a way back', () => {
    // This is the shape of a bug that shipped: the index rule started as
    // `.page:not(.stab-drilled) .sp`, which also hid the sub-pages of
    // Bestellungen — a page whose strip is display:none on every device, so it
    // is never drilled and never can be. It rendered blank on a phone.
    //
    // Both halves are asserted because either alone is silent: CSS scoped to a
    // class nobody adds hides nothing, and a class nobody reads changes nothing.
    assert.match(
      PHONE_BLOCK,
      /\.page\.stab-drill\b/,
      'the index rule must be scoped to the pages stabDrillInit() set up, not to every .page'
    );
    assert.match(APP, /classList\.add\('stab-drill'\)/, 'nothing adds stab-drill — the scoped CSS then hides nothing');
    assert.match(
      APP,
      /classList\.contains\('stab-drill'\)/,
      'openStab() must not drill a page it was never set up for — that page has no back row'
    );
  });

  it('does not send a phone to a tab the list cannot get back to', () => {
    // Admin's default tab is display:none in both the strip and the sidebar
    // list. Landing on it means a sub-page the index does not offer.
    assert.match(
      APP,
      /function stabLandable\(/,
      'the landable rule is gone — Admin opens on a panel its list cannot reach'
    );
    assert.match(APP, /stabLandable\(stEl\)/, 'openStab() no longer checks whether the tab is one you can land on');
  });

  it('marks the page drilled from the one place every route runs through', () => {
    assert.match(
      APP,
      /classList\.add\('stab-drilled'\)/,
      'nothing sets stab-drilled — tapping a row would show the sub-page under the list'
    );
    assert.match(APP, /\bstabDrillInit\(\);/, 'stabDrillInit() is never called — no strip gets a back row');
  });
});

describe('the drawer on a phone', () => {
  // Every `@media (... min-width ...)` block body, so "is this rule desktop-only"
  // is answerable without depending on where it sits in the file.
  const MIN_WIDTH_BLOCK = /@media[^{]*min-width[^{]*\{/g;
  const desktopOnly = [...blocks(CSS, MIN_WIDTH_BLOCK)].map((b) => b.body).join('\n');
  const everywhere = (() => {
    let out = CSS;
    for (const b of blocks(CSS, MIN_WIDTH_BLOCK)) out = out.replace(b.body, '');
    return out;
  })();

  it('keeps the main navigation there while Admin is open', () => {
    // Admin's sidebar list is a desktop arrangement. On a phone the section's
    // list is on the page, so a drawer swapped to the same thirteen entries
    // would lay them over the thirteen behind it and take the screen with them.
    assert.match(
      desktopOnly,
      /body\.admin-mode \.sb-admin-nav \{\s*display: block;/,
      'the admin swap is not desktop-only'
    );
    assert.doesNotMatch(
      everywhere,
      /body\.admin-mode \.sb-nav \{\s*display: none;/,
      'the main nav is hidden in admin-mode outside a min-width block — a phone drawer then has neither list'
    );
  });

  it('gets out of the way on Admin like it does everywhere else', () => {
    assert.doesNotMatch(
      APP,
      /if \(page !== 'settings'\) sbCloseMobile\(\)/,
      "Admin keeps the drawer open again — it now covers the page's own list"
    );
    assert.match(APP, /\n {2}sbCloseMobile\(\);\n\}/, 'openPage() must close the drawer unconditionally');
  });
});

describe('the floating scan button', () => {
  it('gets out of the way of anything modal', () => {
    // It sits at z-index 850. The drawer is 120 and every dialog backdrop is
    // 200, so without these two rules it floats over both — and tappably:
    // elementFromPoint at its centre returns the button, not the dialog under
    // it, so a thumb aiming at the bottom of a form opens the scanner.
    assert.match(CSS, /body\.sb-mobile-open \.cam-fab \{\s*display: none;/, 'the scan button covers the open drawer');
    assert.match(
      CSS,
      /body:has\(\.modal-bg\.open\) \.cam-fab \{\s*display: none;/,
      'the scan button covers open dialogs. :has() is what makes this one rule instead of 25 — every dialog ' +
        'in the app opens by putting .open on its .modal-bg'
    );
  });
});

describe('the drawer and the bottom bar', () => {
  // Phase 1 left this open on purpose and said why: hiding the five duplicated
  // rows by id would rot the day the bottom nav changed. So the marking is
  // derived from the list that wires the bar's buttons — the same loop, the
  // same `'n-' + bnId.slice(3)` pairing — and these assertions are here to keep
  // it derived. A hardcoded selector list would pass a visual check and fail
  // silently a year later.
  const WIRING = APP.match(/\['bn-work'[\s\S]*?\n {2}\}\);/);

  it('marks the duplicates inside the loop that pairs the two navigations', () => {
    assert.ok(WIRING, 'the bottom-nav wiring loop is gone or reshaped');
    assert.match(
      WIRING[0],
      /classList\.add\('sb-in-bottom-nav'\)/,
      "the drawer rows are no longer marked from the bar's own list — whatever marks them can now drift from it"
    );
  });

  it('never names a sidebar id to decide it', () => {
    // The failure this rules out is the one the note predicted: five selectors
    // that look right today and are wrong the first time someone adds a sixth
    // destination to the bar.
    const css = [...blocks(CSS, MAX_WIDTH_BLOCK)].map((b) => b.body).join('\n');
    const byId = [...css.matchAll(/#n-(?:work|dash|batch|lab|cal)\b/g)].map((m) => m[0]);
    assert.deepEqual(byId, [], `the stylesheet hides drawer rows by id: ${byId.join(', ')}`);
  });

  it('hides them only below the breakpoint the bar appears at', () => {
    const hiding = [...blocks(CSS, MAX_WIDTH_BLOCK)].filter((b) => b.body.includes('.sb-in-bottom-nav'));
    assert.equal(hiding.length, 1, '.sb-in-bottom-nav is not hidden in exactly one max-width block');
    const header = CSS.slice(0, hiding[0].start).match(/@media[^{]*\{$/);
    assert.match(
      header[0],
      /max-width:\s*768px/,
      'the drawer hides its duplicates at a different width than the bar appears'
    );
  });

  it('marks a group heading whose entries have all gone', () => {
    // "Arbeiten" holds exactly the three the bar shows. Without this it stays,
    // a heading over nothing.
    assert.match(APP, /function markEmptyDrawerGroups\(\)/, 'the empty-heading pass is gone');
    assert.match(APP, /markEmptyDrawerGroups\(\);/, 'the empty-heading pass is defined but never called');
    const fn = APP.match(/function markEmptyDrawerGroups\(\) \{[\s\S]*?\n\}/)[0];
    assert.match(
      fn,
      /every\(\(e\) => e\.classList\.contains\('sb-in-bottom-nav'\)\)/,
      'the heading is hidden by something other than all of its own entries being marked'
    );
  });
});

describe('the calendar agenda', () => {
  // Same split-brain as the drill-down, one file further: app.js decides that a
  // phone gets the agenda, styles.css decides that a phone gets no view toggle
  // and no legend, and the two decisions are the same breakpoint written twice.
  // Move one and the phone shows a Monat/Woche/Tag toggle whose three buttons
  // all render the same list — or a grid with no way back to it. Neither throws.
  const JS_BREAKPOINT = APP.match(/function calAgendaOnly\(\)[\s\S]*?matchMedia\('([^']+)'\)/);

  it('decides in one place whether this is a phone', () => {
    assert.ok(JS_BREAKPOINT, 'calAgendaOnly() no longer reads a media query — the router lost its condition');
    assert.equal(JS_BREAKPOINT[1], '(max-width: 768px)');
  });

  it('hides the grid-only chrome at exactly that breakpoint', () => {
    const hides = [...blocks(CSS, MAX_WIDTH_BLOCK)].filter((b) =>
      /\.cal-view-toggle,\s*\n\s*\.cal-legend/.test(b.body)
    );
    assert.equal(
      hides.length,
      1,
      'the view toggle and legend are not hidden in a max-width block — on a phone the toggle offers ' +
        'three views that all render the agenda'
    );
    // The block's own header has to be the same 768, not merely some max-width.
    // blocks() reports `start` just past the opening brace, so the slice ends on it.
    const header = CSS.slice(0, hides[0].start).match(/@media[^{]*\{$/);
    assert.match(
      header[0],
      /max-width:\s*768px/,
      'the CSS hides the toggle at a different width than app.js routes at — between the two, a phone ' +
        'gets either a grid it cannot read or a toggle that does nothing'
    );
  });

  it('routes the phone to the agenda before it reads calView', () => {
    // Order matters: `calView` survives from a desktop session in the same tab,
    // so a `calView === 'month'` branch tested first would win on a phone too.
    const router = APP.match(/function renderCalendar\(\) \{[\s\S]*?\n\}/);
    assert.ok(router, 'renderCalendar() not found');
    // The FIRST branch, found by position rather than by pattern. Matching
    // `if (calAgendaOnly())` anywhere passes just as happily when the branch
    // has been demoted to an `else if`, because the demoted line still
    // contains it — which is exactly what a mutation run showed.
    // Anchored on `renderCal…` so it finds the view dispatch and not the
    // `if (!title) return` guard three lines above it.
    const firstBranch = router[0].match(/^ {2}if \((.+?)\) renderCal/m);
    assert.ok(firstBranch, 'renderCalendar() no longer opens its view dispatch with a plain if');
    assert.equal(
      firstBranch[1],
      'calAgendaOnly()',
      'the agenda is not the first branch — a calView left at "month" by a desktop session in the same ' +
        'tab would route a phone to a grid'
    );
  });

  it('navigates by month on a phone whatever calView still says', () => {
    const nav = APP.match(/function calNav\(delta\) \{[\s\S]*?\n\}/);
    assert.ok(nav, 'calNav() not found');
    assert.match(
      nav[0],
      /calView === 'month' \|\| calAgendaOnly\(\)/,
      'prev/next on a phone would step by seven days while the list below it changes by thirty'
    );
  });

  // The failure this catches is the quietest one in the set: renderCalAgenda()
  // builds its markup as a string, so a class it emits that styles.css does
  // not define throws nothing, logs nothing, and renders as unstyled text in a
  // list nobody on a desktop will ever open.
  it('styles every class it emits', () => {
    const fn = APP.match(/function renderCalAgenda\(\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'renderCalAgenda() not found in app.js');
    const emitted = [...new Set([...fn[0].matchAll(/class="(cal-agenda[a-z- ]*)"/g)].flatMap((m) => m[1].split(/\s+/)))]
      .filter(Boolean)
      .filter((c) => c !== 'today');
    assert.ok(emitted.length >= 8, `expected the agenda to emit several classes, found ${emitted.length}`);
    const unstyled = emitted.filter((c) => !new RegExp('\\.' + c + '\\b').test(CSS));
    assert.deepEqual(unstyled, [], `the agenda emits ${unstyled.length} class(es) styles.css never defines`);
  });

  it('gives the empty month something to say in every language', () => {
    // Emitted through `t('cal.agendaEmpty')` inside a template, so
    // test/i18n.test.js's literal scan does not reach it either.
    assert.match(APP, /t\('cal\.agendaEmpty'\)/, 'the agenda no longer has an empty state');
  });
});

describe('the back rows', () => {
  let LANG;
  before(() => {
    global.window = {};
    for (const s of SPRACHEN) {
      delete require.cache[require.resolve(path.join(ROOT, 'lang', s + '.js'))];
      require(path.join(ROOT, 'lang', s + '.js'));
    }
    LANG = global.window.LANG;
  });

  it('names a page every language can say', () => {
    // test/i18n.test.js cannot see these: it reads `data-i18n` attributes and
    // literal `t('…')` calls, and the back row's label goes through `t(home)`
    // with the key in a variable. Untranslated, the row reads "nav.batches".
    const keys = [...HTML.matchAll(/data-stab-home="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(keys.length >= 5, `expected at least 5 data-stab-home keys, found ${keys.length}`);
    const missing = [];
    for (const key of keys) {
      for (const s of SPRACHEN) if (!LANG[s] || !LANG[s][key]) missing.push(`${s}:${key}`);
    }
    assert.deepEqual(missing, [], `back row label(s) with no translation: ${missing.join(', ')}`);
  });
});
