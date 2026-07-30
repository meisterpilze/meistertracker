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
// ── Why a budget and not zero ────────────────────────────────────────────────
//
// German and English are complete. Portuguese is not: 209 of the 1162 keys the
// interface asks for have no Portuguese text yet. That is a translation job, not
// a bug, and asserting zero here would mean a suite that is red on a clean
// checkout — which ends with someone deleting the test rather than translating
// 209 strings.
//
// So the assertion is "no worse than it is". A new key added to two of three
// files pushes the count up and fails. Translating one pushes it down, and the
// number below wants lowering to match — deliberately, so the budget shrinks
// instead of quietly becoming a licence.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SPRACHEN = ['de', 'en', 'pt'];

// Measured 2026-07-30. Lower these as translations land; never raise one to
// make a commit pass — that is the failure this test exists to report.
const OHNE_UEBERSETZUNG = { de: 0, en: 0, pt: 209 };

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
// `t('…')` in the application code. Keys assembled at runtime (`t('a.' + x)`)
// are out of reach here and stay out — a regex that guessed at them would report
// keys that do not exist and train people to ignore this test.
function usedKeys() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const fromHtml = [...html.matchAll(/data-i18n(?:-html|-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  const fromApp = [...app.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]);
  return [...new Set([...fromHtml, ...fromApp])];
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
    assert.ok(used.length > 500, 'only found ' + used.length + ' keys, the extraction is probably broken');
  });

  it('translates every key the interface asks for, in German and English', () => {
    for (const s of ['de', 'en']) {
      const missing = used.filter((k) => !(k in dicts[s]));
      assert.deepEqual(missing, [], s + ' is complete and must stay complete');
    }
  });

  it('does not let the Portuguese gap grow', () => {
    const missing = used.filter((k) => !(k in dicts.pt));
    assert.ok(
      missing.length <= OHNE_UEBERSETZUNG.pt,
      'Portuguese is now missing ' +
        missing.length +
        ' of the keys the interface asks for, up from ' +
        OHNE_UEBERSETZUNG.pt +
        '. New: ' +
        missing.slice(0, 10).join(', ')
    );
  });
});
