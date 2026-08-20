'use strict';
// One sidebar entry per page, and the sidebar fits the laptop it is used on.
//
// Checked as text for the same reason as test/mobile-nav.test.js: no browser,
// no jsdom. What that costs here is stated plainly — this file cannot measure a
// rendered sidebar, so it does not claim to. It pins the *rule* that kept the
// sidebar short, because the rule is what drifted last time and the height was
// only the symptom.
//
// The symptom, measured once through scripts/static-page-server.js at 1366x768:
// .sb-nav needed 778px and had 611. Kunden and Versand were off the screen and
// nothing said they existed — no fade, no scrollbar, the list simply stopped.
// The cause was five entries that were sub-views of one page, #p-orders,
// promoted to the top level while Admin's thirteen stayed nested behind one.
// Folding them back took the same nav to 563px at 1280x720, which fits.
//
// So the invariant is not "eleven entries". It is: a top-level entry names a
// page, and a page is named once. Anything else and the sidebar grows by the
// sub-tab count of whichever section is being worked on that month.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// The main list only — .sb-admin-nav is the section's own list and is allowed
// one entry per sub-tab, because it replaces the main one rather than joining it.
const MAIN_NAV = HTML.slice(HTML.indexOf('<nav class="sb-nav"'), HTML.indexOf('<nav class="sb-admin-nav"'));
const ENTRIES = [...MAIN_NAV.matchAll(/<button class="sb-btn[^"]*" id="(n-[a-z0-9-]+)"/g)].map((m) => m[1]);

// Every `go('<page>', '<button>')` in app.js — the router is the only thing that
// knows which page an entry opens, so the pairing is read from it.
const ROUTES = [...APP.matchAll(/go\('([a-z]+)', '(n-[a-z0-9-]+)'\)/g)].map((m) => ({ page: m[1], btn: m[2] }));

describe('the sidebar', () => {
  it('finds its entries — a silent zero would make this file useless', () => {
    assert.ok(ENTRIES.length >= 8, `expected at least 8 .sb-nav entries, found ${ENTRIES.length}`);
    assert.ok(ROUTES.length >= 8, `expected at least 8 go() call sites, found ${ROUTES.length}`);
  });

  it('never carries two entries into the same page', () => {
    // The failure this rules out is exactly the one that shipped: five entries
    // all calling go('orders', …) and then openStab() on the same page. A
    // section with more than one view puts them in its own .stabs strip, which
    // is a pill row on a desk and a drill-down index in a hand.
    const byPage = new Map();
    for (const { page, btn } of ROUTES) {
      if (!ENTRIES.includes(btn)) continue; // a deep link from elsewhere, not a nav entry
      if (!byPage.has(page)) byPage.set(page, new Set());
      byPage.get(page).add(btn);
    }
    const doubled = [...byPage]
      .filter(([, btns]) => btns.size > 1)
      .map(([page, btns]) => `${page}: ${[...btns].join(', ')}`);
    assert.deepEqual(doubled, [], `pages reached by more than one sidebar entry:\n  ${doubled.join('\n  ')}`);
  });

  it('routes every entry somewhere', () => {
    // An entry with no go() is a button that looks like navigation and is not.
    const routed = new Set(ROUTES.map((r) => r.btn));
    const orphans = ENTRIES.filter((id) => !routed.has(id));
    assert.deepEqual(orphans, [], `sidebar entries no go() call opens: ${orphans.join(', ')}`);
  });

  it('sends nobody to a button that does not exist', () => {
    // go() does document.getElementById(btnId).classList.add(…) with no guard,
    // so a stale id is not a mis-highlight — it throws, and the user lands
    // nowhere. That is how the eBay account-closure notification behaved for as
    // long as it pointed at 'n-orders' while the markup said 'n-orders-inbox'.
    const known = new Set([...HTML.matchAll(/id="(n-[a-z0-9-]+)"/g)].map((m) => m[1]));
    const dangling = [...new Set(ROUTES.map((r) => r.btn))].filter((id) => !known.has(id));
    assert.deepEqual(dangling, [], `go() names sidebar buttons that are not in index.html: ${dangling.join(', ')}`);
  });

  it('keeps a group heading over entries that exist', () => {
    // Removing entries can empty a group and leave its label behind — a heading
    // over nothing. (markEmptyDrawerGroups() handles the phone case, where the
    // bottom bar hides its twins; this is the static one.)
    const parts = MAIN_NAV.split(/<div class="sb-group-label"[^>]*>/).slice(1);
    const empty = parts
      .map((chunk) => ({
        label: (chunk.match(/^([^<]+)</) || [, '?'])[1].trim(),
        entries: (chunk.split('<div class="sb-group-label"')[0].match(/class="sb-btn/g) || []).length
      }))
      .filter((g) => g.entries === 0)
      .map((g) => g.label);
    assert.deepEqual(empty, [], `group heading(s) with no entries under them: ${empty.join(', ')}`);
  });
});
