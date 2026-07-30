'use strict';
// Translation keys the interface asks for, checked against every language file.
//
// Why this is worth a test: a missing key does not throw. `t()` returns the key
// itself, so a button reads "settings.tabHarvestFeed" — and only for people
// using that language. In German it looks fine, ships, and the Portuguese
// interface has a raw identifier on it.
//
// Found exactly that way: a new settings tab was added, the label went into all
// three files, an unrelated reset dropped it again, and a count-based check
// waved it through because the number happened to match. The browser showed the
// key on screen. This test is that check without the browser.
//
// ── No budget, no exceptions ─────────────────────────────────────────────────
//
// This file used to carry a per-language budget, because Portuguese was 240
// keys short and a red suite on a clean checkout ends with someone deleting the
// test rather than translating 240 strings. Those strings exist now, so the
// budget is gone and every language is held to the same rule: a key added to
// two of three files fails here instead of reaching a user.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SPRACHEN = ['de', 'en', 'pt'];

// The lang files assign to `window`, which does not exist in node.
function loadDictionaries() {
  global.window = {};
  for (const s of SPRACHEN) {
    delete require.cache[require.resolve(path.join(ROOT, 'lang', s + '.js'))];
    require(path.join(ROOT, 'lang', s + '.js'));
  }
  return global.window.LANG;
}

// `data-i18n`, `data-i18n-html` and `data-i18n-placeholder` in the markup, plus
// `t('…')` in the application code — including the `t('…', { n })` form, which an
// earlier version of this pattern walked straight past, leaving 170 calls
// unchecked. Keys assembled at runtime (`t('a.' + x)`) stay out of reach of any
// regex; the dictionary-parity test below is what covers those.
function usedKeys() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const fromHtml = [...html.matchAll(/data-i18n(?:-html|-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  const fromApp = [...app.matchAll(/\bt\('([^']+)'\s*[,)]/g)].map((m) => m[1]);
  return [...new Set([...fromHtml, ...fromApp])];
}

// {n}, {sum}, {time} … — a translation that drops one renders the placeholder
// as literal text, which is the same class of bug as a missing key.
function placeholders(text) {
  return [...String(text).matchAll(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g)].map((m) => m[0]).sort();
}

describe('translations', () => {
  let dicts;
  let used;
  before(() => {
    dicts = loadDictionaries();
    used = usedKeys();
  });

  it('has all three languages loaded', () => {
    for (const s of SPRACHEN) assert.ok(dicts[s], s + ' missing');
  });

  it('finds keys to check — a silent zero would make this test useless', () => {
    assert.ok(used.length > 1000, 'only found ' + used.length + ' keys, the extraction is probably broken');
  });

  it('translates every key the interface asks for, in every language', () => {
    for (const s of SPRACHEN) {
      const missing = used.filter((k) => !(k in dicts[s]));
      assert.deepEqual(missing, [], s + ' has no text for these keys, so the interface shows the key itself');
    }
  });

  // Covers what the regex above cannot see: `t('orders.status.' + o.status)` and
  // friends never appear as a literal, so a gap there is invisible until someone
  // switches language and reads a status column full of identifiers.
  it('keeps the three dictionaries on the same set of keys', () => {
    const all = new Set(SPRACHEN.flatMap((s) => Object.keys(dicts[s])));
    for (const s of SPRACHEN) {
      const missing = [...all].filter((k) => !(k in dicts[s]));
      assert.deepEqual(missing, [], s + ' is missing keys the other languages define');
    }
  });

  it('has no blank translations', () => {
    for (const s of SPRACHEN) {
      const blank = Object.keys(dicts[s]).filter((k) => !String(dicts[s][k]).trim());
      assert.deepEqual(blank, [], s + ' has empty strings, which render as nothing at all');
    }
  });

  it('keeps the same placeholders in every language', () => {
    for (const k of Object.keys(dicts.de)) {
      const wanted = placeholders(dicts.de[k]);
      for (const s of SPRACHEN) {
        assert.deepEqual(placeholders(dicts[s][k]), wanted, s + ' changed the placeholders in ' + k);
      }
    }
  });
});
