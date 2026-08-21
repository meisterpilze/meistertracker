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

describe('the mobile topbar title', () => {
  // Three files again, and the same failure mode. index.html holds the span,
  // app.js writes into it, styles.css keeps it from pushing the bell off the
  // bar. Any one can be edited alone and the result is a phone that says
  // "Meistertracker" on twelve different pages, or one that says the right
  // thing and hides the notification bell to do it.

  it('has a span to write into', () => {
    assert.match(HTML, /id="topbar-title"/, 'the mobile topbar has no title element');
    assert.match(
      HTML,
      /id="topbar-title" data-i18n="nav\.[a-zA-Z]+"/,
      'the title starts without a data-i18n key, so a language switch would leave the first page name in the old language'
    );
  });

  it('reads the name off the entry that opened the page', () => {
    // A second table of page names is the thing this rules out: it looks right
    // the day it is written and goes stale the first time a page is renamed in
    // only one of the two places.
    const fn = APP.match(/function go\(page, btnId\) \{[\s\S]*?\n\}/)[0];
    assert.match(fn, /getElementById\('topbar-title'\)/, 'go() no longer sets the topbar title');
    assert.match(
      fn,
      /navBtn\.querySelector\('\[data-i18n\]'\)/,
      'the title is no longer derived from the nav entry — whatever names it can now drift from the sidebar'
    );
    assert.match(
      fn,
      /title\.dataset\.i18n = label\.dataset\.i18n/,
      'the key does not travel with the text, so translatePage() cannot reach it'
    );
  });

  // A different `max-width` block from PHONE_BLOCK: the title's rules sit with
  // .mobile-topbar's own, where the bar is turned on.
  const TOPBAR_BLOCK = (() => {
    for (const b of blocks(CSS, MAX_WIDTH_BLOCK)) if (b.body.includes('.mobile-topbar {')) return b.body;
    return null;
  })();

  it('truncates rather than shoving the chrome off the bar', () => {
    // pt `nav.workSteps` is "Etapas de trabalho" and overflows a 320px bar by
    // 4px. Without min-width: 0 on both the flex item and the span, no ellipsis
    // is possible at all and the bell and sync dot go over the right edge.
    assert.ok(TOPBAR_BLOCK, 'no `max-width` block in styles.css turns the mobile topbar on');
    assert.match(TOPBAR_BLOCK, /#topbar-title \{[^}]*text-overflow: ellipsis/s, 'the title does not ellipsise');
    assert.match(
      TOPBAR_BLOCK,
      /#topbar-title \{[^}]*min-width: 0/s,
      'the span cannot shrink, so the ellipsis never fires'
    );
    assert.match(
      TOPBAR_BLOCK,
      /\.mobile-topbar \.sb-logo \{[^}]*min-width: 0/s,
      '.sb-logo still cannot shrink — it carries flex-shrink: 0 in the base rule'
    );
  });
});

describe('the drawer that outlived its breakpoint', () => {
  // The one finding in the responsive review that made the application
  // unusable, and it is reached by an ordinary gesture: open the drawer in a
  // split window, then widen the window. `.sb-overlay.sb-show` is display:block
  // at every width, the only code that took it off refused to run above 769px,
  // and the tap meant to lift it fell into the desktop branch of
  // toggleSidebar() and collapsed the docked sidebar instead. Reload was the
  // only way out.
  //
  // Same limit as the rest of this file: no browser here, so these prove the
  // rules are written, not that they run.
  const MIN_WIDTH_BLOCK = /@media[^{]*min-width[^{]*\{/g;
  const desktopOnly = [...blocks(CSS, MIN_WIDTH_BLOCK)].map((b) => b.body).join('\n');
  const TOGGLE = APP.match(/function toggleSidebar\(\) \{[\s\S]*?\n\}/);

  it('asks the media query, not the width at the moment of the click', () => {
    // The width read is what made the state outlive its arrangement: the drawer
    // was opened under one answer and closed under another.
    assert.ok(TOGGLE, 'toggleSidebar() is gone');
    assert.doesNotMatch(
      TOGGLE[0],
      /innerWidth/,
      'toggleSidebar() reads the window width again, so the two branches can still disagree with the drawer'
    );
    // Anchored to sbPhone, because the bare literal appears twice elsewhere in
    // this file for the calendar, and both predate this fix: the assertion
    // passed with the whole sidebar block deleted.
    assert.match(
      APP,
      /const sbPhone = [^;]*matchMedia\('\(max-width: 768px\)'\)/,
      'nothing asks the phone query any more'
    );
  });

  it('puts the drawer back to nothing when the breakpoint is crossed', () => {
    assert.match(
      APP,
      /sbPhone\.addEventListener\('change'/,
      'nothing listens for the crossing, so a drawer opened on one side survives on the other'
    );
  });

  it('puts the DESKTOP state back to nothing too when the breakpoint is crossed', () => {
    // The other half of the same disease. sb-collapsed is set at exactly two
    // places and used to be removed by nothing else, while
    // `.sidebar.sb-collapsed { width: var(--sidebar-collapsed) }` sits outside
    // any min-width block, so the phone block never takes it back. Collapse on
    // a desk, narrow the window, tap the hamburger: a 64px drawer with every
    // label gone.
    const HANDLER = APP.match(/sbPhone\.addEventListener\('change'[\s\S]*?\n  \}\);/);
    assert.ok(HANDLER, 'nothing listens for the crossing any more');
    assert.match(HANDLER[0], /sbClose\(\)/, 'the crossing no longer closes the drawer');
    assert.match(HANDLER[0], /sbUncollapse\(\)/, 'the crossing leaves the desktop collapse standing');
    const UNCOLLAPSE = APP.match(/function sbUncollapse\(\) \{[\s\S]*?\n\}/);
    assert.ok(UNCOLLAPSE, 'sbUncollapse() is gone');
    for (const cls of ['sb-collapsed', 'sb-is-collapsed']) {
      assert.match(UNCOLLAPSE[0], new RegExp("remove\\('" + cls + "'\\)"), `sbUncollapse() leaves ${cls} standing`);
    }
  });

  it('takes the three classes off in one place', () => {
    // Three call sites each removing their own subset is how one of them came
    // to remove none.
    const CLOSE = APP.match(/function sbClose\(\) \{[\s\S]*?\n\}/);
    assert.ok(CLOSE, 'sbClose() is gone');
    for (const cls of ['sb-open', 'sb-show', 'sb-mobile-open']) {
      assert.match(CLOSE[0], new RegExp("remove\\('" + cls + "'\\)"), `sbClose() leaves ${cls} standing`);
    }
    assert.match(
      APP,
      /function sbCloseMobile\(\) \{\s*if \(sbIsPhone\(\)\) sbClose\(\);/,
      'the two closers have drifted apart again'
    );
  });

  it('lifts the drawer when the veil is tapped, the same way as everything else', () => {
    // The busiest way out of the drawer, and the one that used to take a
    // different route: toggleSidebar() re-asks which arrangement we are in, so
    // it could collapse the docked sidebar instead, and it left focus nowhere
    // while Escape handed it back to the opener.
    const VEIL = APP.match(/\$\('sb-overlay'\)\.addEventListener\('click'[\s\S]*?\n  \}\);/);
    assert.ok(VEIL, 'nothing listens on the veil any more');
    assert.doesNotMatch(VEIL[0], /toggleSidebar/, 'the veil re-branches on the arrangement again');
    assert.match(VEIL[0], /sbClose\(\)/, 'the veil no longer closes the drawer');
    assert.match(VEIL[0], /tgl-17/, 'the veil leaves keyboard focus nowhere');
  });

  it('lets Escape lift the drawer, like every dialog in the app', () => {
    // It is modal in every way that matters: an overlay over the page with the
    // taps behind it swallowed. It was the one such surface Escape could not
    // reach.
    assert.match(APP, /classList\.contains\('sb-open'\)\) \{\s*sbClose\(\);/, 'Escape no longer closes the drawer');
    assert.match(
      APP,
      /const opener = document\.getElementById\('tgl-17'\);/,
      'Escape drops the focus instead of handing it back to the button that opened the drawer'
    );
  });

  it('takes the closed drawer out of the tab order without hiding it', () => {
    // Off-screen is not gone: translateX(-100%) keeps all fourteen rows
    // tabbable. The flag has to be derived from both facts, because a docked
    // sidebar is on screen and must never be inert.
    assert.match(
      APP,
      /sb\.inert = sbIsPhone\(\) && !sb\.classList\.contains\('sb-open'\)/,
      'the inert flag is gone or no longer derived from both the arrangement and the state'
    );
  });

  it('keeps a second lock on the overlay in the stylesheet', () => {
    // Worth having twice: the service worker can be handing out a cached app.js
    // from before this fix while the stylesheet is already the new one.
    assert.match(
      desktopOnly,
      /\.sb-overlay\.sb-show \{\s*display: none;/,
      'above the breakpoint the overlay can cover the desktop again'
    );
  });
});
