'use strict';
// Every settings tab is clickable, and none of them loads its config twice.
//
// There is no generic `.stab` handler: each tab is wired by hand with its own
// `addEventListener`. Add a button and a panel and everything looks finished —
// the tab renders, sits in the right place, carries the right label, and does
// nothing at all when clicked. Nothing throws, so no log line appears either.
//
// Found in production, by the person the feature was built for. The tab had
// been added, translated, tested and merged; the click was never exercised
// because the panel was opened from the console during development. This test
// is that click, without the browser.
//
// The second assertion is the mirror image: `openStab()` dispatches a loader
// for some sub-tabs, and a few handlers call one as well. Doing both fires two
// identical requests per click — harmless-looking, and the reason a settings
// page ends up hitting its API twice for no reason.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Is a listener attached to this tab id, in either file and either style? */
function isWired(tab, app, html) {
  const id = 'st-settings-' + tab;
  for (const quelle of [app, html]) {
    let at = quelle.indexOf(id);
    while (at !== -1) {
      // Small window: the listener follows within a few lines of the lookup.
      // Wide enough for `const btn = getElementById(id); if (btn) btn.add…`,
      // narrow enough that an unrelated listener further down does not count.
      if (quelle.slice(at, at + 400).includes('addEventListener')) return true;
      at = quelle.indexOf(id, at + 1);
    }
  }
  return false;
}

describe('settings tabs', () => {
  let html;
  let app;
  let tabs;
  before(() => {
    html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    tabs = [...html.matchAll(/id="st-settings-([a-z0-9-]+)"/g)].map((m) => m[1]);
  });

  it('finds the tabs — a silent zero would make this test useless', () => {
    assert.ok(tabs.length >= 8, 'only found ' + tabs.length + ' settings tabs, the extraction is probably broken');
  });

  it('gives every tab a panel to open', () => {
    const missing = tabs.filter((t) => !html.includes('id="sp-settings-' + t + '"'));
    assert.deepEqual(missing, [], 'tabs with no matching sp-settings-… panel');
  });

  it('wires every tab to a click handler', () => {
    // Two styles in the tree, both fine: `$('st-settings-x').addEventListener`
    // in app.js, and `getElementById('st-settings-x')` + addEventListener in an
    // inline script (the Growth tab). Matching only the first would report a
    // working tab as broken, and a test that cries wolf gets ignored the next
    // time it is right.
    const missing = tabs.filter((t) => !isWired(t, app, html));
    assert.deepEqual(missing, [], 'tabs that render but do nothing when clicked');
  });

  // Admin is navigated from two lists: the .stabs strip, which is what a phone
  // shows, and the sidebar list, which is what a desktop shows. They are one
  // selection drawn twice. A sub-tab in only one of them is reachable from only
  // one screen size — and the size that loses it is whichever one the author
  // was not sitting in front of. The sidebar forwards clicks by data-sub, so an
  // entry without that attribute renders, highlights, and goes nowhere.
  it('gives every tab a sidebar entry that knows which sub-tab it opens', () => {
    const entries = [...html.matchAll(/id="sn-settings-([a-z0-9-]+)"[^>]*data-sub="([a-z0-9-]+)"/g)];
    const named = entries.map((m) => m[1]).sort();
    assert.deepEqual(named, [...tabs].sort(), 'strip and sidebar disagree about which sub-tabs exist');
    const wrong = entries.filter((m) => m[1] !== m[2]).map((m) => m[1] + ' → ' + m[2]);
    assert.deepEqual(wrong, [], 'sidebar entries whose data-sub points at a different sub-tab');
  });

  it('does not load the same sub-tab config twice per click', () => {
    // A handler body runs until the closing `});` of the addEventListener call.
    const doubled = [];
    for (const t of tabs) {
      const start = app.indexOf("$('st-settings-" + t + "').addEventListener");
      if (start === -1) continue;
      const body = app.slice(start, app.indexOf('\n  });', start));
      const loaders = [...body.matchAll(/\b(load[A-Za-z]+|render[A-Za-z]+)\(/g)].map((m) => m[1]);
      if (!loaders.length) continue;
      // Does openStab() dispatch one of these for the same sub-tab?
      const dispatch = app.match(new RegExp("sub === '" + t + "'\\)\\s*([A-Za-z]+)\\(", ''));
      if (dispatch && loaders.includes(dispatch[1])) doubled.push(t + ': ' + dispatch[1]);
    }
    assert.deepEqual(doubled, [], 'handler and openStab() both call the same loader');
  });
});
