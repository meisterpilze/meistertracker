'use strict';
// Zahlen: what is read, in one place.
//
// The harvest statistics and the book of good blocks were two tabs of Chargen,
// between the list of batches and the mixes: figures nobody edits, on the page
// where the work is done. The Dashboard, one entry further up, drew the same
// harvests again as two charts of its own. Somebody looking for "how much did
// we harvest" had two places to try, and Chargen had five views of which two
// were not about doing anything.
//
// Now the Dashboard is called Zahlen and has three views: Übersicht (what the
// page always showed), Ernten and Gute Blöcke. Chargen keeps the views that
// work on batches. This file holds that split, as text and with openStab()
// lifted out of app.js and run against stand-ins. No browser.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// A page's markup: from its opening tag to the next page's.
function seite(id) {
  const von = HTML.indexOf('<div class="page" id="p-' + id + '"');
  assert.ok(von >= 0, 'no page p-' + id);
  const bis = HTML.indexOf('<div class="page" id="p-', von + 1);
  return HTML.slice(von, bis < 0 ? undefined : bis);
}
function reiter(markup) {
  return [...markup.matchAll(/<button[^>]*class="stab[^"]*"[^>]*id="(st-[a-z]+-[a-z]+)"/g)].map((m) => m[1]);
}

const DASH = seite('dash');
const BATCH = seite('batch');

describe('Zahlen holds the figures', () => {
  it('has the three views, Übersicht first', () => {
    assert.deepEqual(reiter(DASH), ['st-dash-overview', 'st-dash-harvest', 'st-dash-blocks']);
    assert.match(DASH, /<button class="stab active" id="st-dash-overview"/, 'the page does not open on Übersicht');
  });

  it('has a panel for every view, inside the page', () => {
    for (const id of reiter(DASH)) {
      const panel = 'sp-' + id.slice(3);
      assert.ok(DASH.includes('id="' + panel + '"'), `${id} has no panel ${panel} on its own page`);
    }
    assert.match(DASH, /<div class="sp active" id="sp-dash-overview"/, 'Übersicht is not the panel that shows first');
  });

  it('carries what each view draws into', () => {
    // openStab() only shows a panel; the lists and canvases are found by id, and
    // a panel left behind on another page would be drawn into behind display:none.
    for (const id of ['ov-kpi-week', 'ov-chart-harvest', 'harvest-metrics', 'harvest-body', 'bb-summary', 'bb-good']) {
      assert.ok(DASH.includes('id="' + id + '"'), `#${id} is not on Zahlen`);
    }
  });

  it('left Chargen with the views that work on batches', () => {
    assert.deepEqual(reiter(BATCH), ['st-batch-list', 'st-batch-locations', 'st-batch-substrate']);
    assert.doesNotMatch(BATCH, /id="(harvest-body|bb-good|sp-batch-harvest|sp-batch-blocks)"/);
  });

  it('names its strip so the phone can say where "back" leads', () => {
    assert.match(DASH, /<div class="stabs" data-stab-home="nav\.dashboard">/);
  });
});

describe('every panel app.js asks for exists', () => {
  it('finds each sp-<page>-<view> it names in the markup', () => {
    // A view that moves keeps its handlers only if every id moves with it. The
    // one that was easy to miss: _bbOpen() decides whether the block book
    // reloads on a sync, by asking whether its panel is the open one.
    const asked = new Set([...APP.matchAll(/getElementById\('(sp-[a-z]+-[a-z]+)'\)/g)].map((m) => m[1]));
    assert.ok(asked.size >= 3, `expected app.js to name several panels, found ${asked.size}`);
    const missing = [...asked].filter((id) => !HTML.includes('id="' + id + '"'));
    assert.deepEqual(missing, [], `app.js looks for panel(s) the markup does not have: ${missing.join(', ')}`);
  });
});

describe('opening a view of Zahlen', () => {
  const src = APP.match(/function openStab\(page, sub\) \{[\s\S]*?\n\}/);
  assert.ok(src, 'openStab() not found');

  function oeffne(sub, kpiHistoryData) {
    const calls = [];
    const note = (name) => () => calls.push(name);
    // Not a page with a back row of its own (stab-drill), so openStab() ends
    // without asking whether the tab is one a phone may land on.
    const el = { classList: { add() {}, remove() {}, contains: () => false } };
    const document = { querySelectorAll: () => [], getElementById: () => el };
    const openStab = new Function(
      'document',
      'zurueckMerk',
      'setPageTitle',
      'kpiHistoryData',
      'renderOverviewKPIs',
      'loadKpiHistory',
      'renderHarvests',
      'renderBlockBook',
      'loadBlockBook',
      src[0] + '\nreturn openStab;'
    )(
      document,
      () => {},
      () => {},
      kpiHistoryData,
      note('kpis'),
      note('history'),
      note('harvests'),
      note('blocks'),
      note('blocks-load')
    );
    openStab('dash', sub);
    return calls;
  }

  it('draws the Übersicht and loads its history once', () => {
    assert.deepEqual(oeffne('overview', null), ['kpis', 'history']);
    assert.deepEqual(oeffne('overview', []), ['kpis']);
  });

  it('draws Ernten', () => {
    assert.deepEqual(oeffne('harvest', null), ['harvests']);
  });

  it('draws Gute Blöcke and asks the server for them', () => {
    assert.deepEqual(oeffne('blocks', null), ['blocks', 'blocks-load']);
  });

  it('no longer answers under Chargen', () => {
    assert.doesNotMatch(src[0], /page === 'batch' && sub === '(harvest|blocks)'/);
  });

  it('wires every tab of the strip to openStab()', () => {
    for (const id of reiter(DASH)) {
      const sub = id.slice('st-dash-'.length);
      const re = new RegExp(
        "\\$\\('" + id + "'\\)\\.addEventListener\\('click', \\(\\) => openStab\\('dash', '" + sub + "'\\)\\)"
      );
      assert.match(APP, re, `${id} has no click handler`);
    }
  });
});

describe('arriving on Zahlen', () => {
  const go = APP.match(/\nfunction go\(page, btnId\) \{[\s\S]*?\n\}/);
  const refresh = APP.match(/\nfunction refresh\(\) \{[\s\S]*?\n\}/);

  it('opens the view that was showing, by its own tab', () => {
    // One wiring per view: the tab knows what its panel needs. go() drawing the
    // Übersicht itself would draw four charts behind Ernten.
    assert.ok(go, 'go() not found');
    assert.match(
      go[0],
      /if \(page === 'dash'\) \{\s*const stab = document\.querySelector\('#p-dash \.stab\.active'\);\s*if \(stab\) stab\.click\(\);\s*\}/
    );
    assert.doesNotMatch(go[0], /if \(page === 'dash'\) renderOverviewKPIs\(\)/);
  });

  it('redraws the Übersicht on a sync only while it is the open view', () => {
    assert.ok(refresh, 'refresh() not found');
    assert.match(refresh[0], /if \(id === 'dash' && dashUebersichtOffen\(\)\) renderOverviewKPIs\(\);/);
    const offen = APP.match(/function dashUebersichtOffen\(\) \{[\s\S]*?\n\}/);
    assert.ok(offen, 'dashUebersichtOffen() not found');
    const frage = (active) =>
      new Function('document', offen[0] + '\nreturn dashUebersichtOffen();')({
        getElementById: (id) => (id === 'sp-dash-overview' ? { classList: { contains: () => active } } : null)
      });
    assert.equal(frage(true), true);
    assert.equal(frage(false), false);
  });
});
