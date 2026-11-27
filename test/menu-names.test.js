'use strict';
// One name, one place.
//
// Two views were called "Bestand" (cultures under Labor, raw material under
// Lager), two were called "Versand" (the labels under Bestellungen, the
// carrier's login under Admin), and "Regal" was the sales stock under Lager
// while every other Regal in the app is a rack of bags. On a phone the name of
// the view is the only thing at the top of the page, so "Bestand" did not say
// which of the two somebody was looking at.
//
// The rule this file holds: within one language, no two entries of the
// navigation carry the same label. An entry is a page in the sidebar or a view
// in a strip of tabs (the strips are what sbSubInit() turns into the list under
// an open page). It is checked as text, like test/sidebar-entries.test.js: the
// labels come from the markup and the three language files, no browser.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function lang(code) {
  const window = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'lang', code + '.js'), 'utf8'))(window);
  return window.LANG[code];
}

// Every view: <button class="stab ..." id="st-<page>-<view>" data-i18n="key">.
function views() {
  const out = [];
  const re = /<button[^>]*class="stab[^"]*"[^>]*id="(st-[a-z]+-[a-z]+)"[^>]*data-i18n="([^"]+)"/g;
  let m;
  while ((m = re.exec(HTML))) out.push({ id: m[1], key: m[2] });
  return out;
}

// Every page of the main list: <button class="sb-btn" id="n-<page>" data-page=...>
// followed by the span that names it.
function pages() {
  const out = [];
  const re = /<button class="sb-btn[^"]*" id="(n-[a-z]+)" data-page="[a-z]+"[\s\S]*?<span data-i18n="([^"]+)"/g;
  let m;
  while ((m = re.exec(HTML))) out.push({ id: m[1], key: m[2] });
  return out;
}

describe('menu names', () => {
  const entries = [...pages(), ...views()];

  it('finds the navigation in the markup', () => {
    // A regex that stops matching would make every check below pass on nothing.
    assert.ok(pages().length >= 10, 'pages found: ' + pages().length);
    assert.ok(views().length >= 35, 'views found: ' + views().length);
  });

  for (const code of ['de', 'en', 'pt']) {
    it('no two entries share a label (' + code + ')', () => {
      const L = lang(code);
      const seen = new Map();
      const twice = [];
      for (const e of entries) {
        const label = L[e.key];
        assert.ok(label, code + ' has no text for ' + e.key);
        const k = label.trim().toLowerCase();
        if (seen.has(k) && seen.get(k) !== e.id) twice.push(label + ': ' + seen.get(k) + ' and ' + e.id);
        else seen.set(k, e.id);
      }
      assert.deepEqual(twice, []);
    });
  }

  it('a message that names a place names one that exists', () => {
    // "Admin → Einstellungen → Versand" sent people to a level the app does not
    // have. Wherever a text points into Admin, the next word is one of its views.
    const L = lang('de');
    const admin = views()
      .filter((v) => v.id.startsWith('st-settings-'))
      .map((v) => L[v.key]);
    for (const [key, text] of Object.entries(L)) {
      const m = /Admin → ([^→.,:;]+)/.exec(text);
      if (!m) continue;
      const next = m[1].trim();
      assert.ok(
        admin.some((a) => next === a || next.startsWith(a + ' ')),
        key + ' points to "Admin → ' + next + '"'
      );
    }
  });
});
