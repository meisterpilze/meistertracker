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
const { execFileSync } = require('node:child_process');

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

// Every `data-i18n*` attribute the application actually translates, plus `t('…')`
// in the code — including the `t('…', { n })` form, which an earlier version of
// this pattern walked straight past, leaving 170 calls unchecked. Keys assembled
// at runtime (`t('a.' + x)`) stay out of reach of any regex; the dictionary-parity
// test below is what covers those.
//
// ⚠️ The list of suffixes is not decoration — it has to match applyI18n() in
// app.js. It read `-html` and `-placeholder` only, while app.js has translated
// `-title` and `-aria-label` for a long time: 25 keys behind 39 attributes were
// never checked here. Nothing was actually missing, which is the point — the test
// could not have told us either way, and a tooltip or a screen-reader label
// carrying a raw identifier is the exact failure this file exists to catch. It is
// just harder to notice than a button, so it is *more* worth a test, not less.
const I18N_ATTRS = ['', '-html', '-placeholder', '-title', '-aria-label'];

function usedKeys() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const attrs = new RegExp('data-i18n(?:' + I18N_ATTRS.filter(Boolean).join('|') + ')?="([^"]+)"', 'g');
  const fromHtml = [...html.matchAll(attrs)].map((m) => m[1]);
  const fromApp = [...app.matchAll(/\bt\('([^']+)'\s*[,)]/g)].map((m) => m[1]);
  return [...new Set([...fromHtml, ...fromApp])];
}

/**
 * The suffixes app.js really translates, read out of its own selectors.
 *
 * Without this, the two lists drift the moment someone adds `data-i18n-alt`: the
 * markup gets translated, the check stays quiet, and we are back where we started
 * — with a test that reports success over an unchecked attribute.
 *
 * ⚠️ Both quote styles and stray whitespace, and the count is asserted by the
 * caller. A regex that only knew single quotes would return nothing the day
 * someone wrote `querySelectorAll("[data-i18n-alt]")` — and returning nothing
 * makes this guard pass, which is the precise blind spot it was written to close.
 * Finding no selectors at all has to be the loud failure, not the quiet one.
 */
function translatedAttrs() {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  return [...app.matchAll(/querySelectorAll\(\s*['"`]\[data-i18n(-[a-z-]+)?\]['"`]\s*\)/g)].map((m) => m[1] || '');
}

// {n}, {sum}, {time} … — a translation that drops one renders the placeholder
// as literal text, which is the same class of bug as a missing key.
function placeholders(text) {
  return [...String(text).matchAll(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g)].map((m) => m[0]).sort();
}

// A key written twice in the same file does not throw and does not show up in
// the loaded dictionary: the object literal keeps the last one and drops the
// first without a word. Three keys carried two different German texts that way
// — `inv.alertBelow` said "Warnung unter {n}kg" in one place and "Alarm unter
// {n}kg" 700 lines further down, and only the second was ever on screen. So this
// has to read the source text; `require()`ing the file is exactly what hides it.
//
// Split on \r?\n: the working tree is CRLF on Windows and LF on CI.
function doppelteSchluessel(sprache) {
  const src = fs.readFileSync(path.join(ROOT, 'lang', sprache + '.js'), 'utf8');
  const gesehen = new Map();
  const doppelt = [];
  src.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^\s*'((?:[^'\\]|\\.)*)'\s*:/);
    if (!m) return;
    if (gesehen.has(m[1])) doppelt.push(m[1] + ' (lines ' + gesehen.get(m[1]) + ' and ' + (i + 1) + ')');
    else gesehen.set(m[1], i + 1);
  });
  return doppelt;
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

  // The guard on the guard. Every attribute app.js translates has to be one this
  // file reads, or that attribute is being translated without anyone checking the
  // keys exist — which is how 25 keys behind `-title` and `-aria-label` went
  // unverified for as long as they did.
  it('reads every data-i18n attribute the application translates', () => {
    const found = translatedAttrs();
    // Before comparing: an empty or shrunken result is the failure mode that would
    // otherwise pass silently. If the selectors move, get renamed, or stop matching
    // this regex, the comparison below has nothing to disagree with.
    assert.ok(
      found.length >= I18N_ATTRS.length,
      'only found ' + found.length + ' data-i18n selectors in app.js, expected at least ' + I18N_ATTRS.length
    );
    const missed = found.filter((a) => !I18N_ATTRS.includes(a));
    assert.deepEqual(
      missed,
      [],
      'app.js translates data-i18n' + missed.join(', data-i18n') + ' — add it to I18N_ATTRS or those keys go unchecked'
    );
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

  // The guard for the failure above: a duplicate is invisible in every other
  // check in this file, because they all read the dictionary after the second
  // definition has already won.
  it('defines every key exactly once per file', () => {
    for (const s of SPRACHEN) {
      assert.deepEqual(
        doppelteSchluessel(s),
        [],
        s + '.js defines these keys twice — the second one silently wins and the first is dead text'
      );
    }
  });

  // A translation nothing asks for is dead weight, and the way it goes unnoticed
  // is a report with a standing count in it: once section 2 says "61" every
  // week, nobody reads the 62nd line. So the count is held at zero, and keys the
  // code builds at runtime (`t('rhythm.day.' + d)`) are resolved by the audit
  // rather than parked in that list — they are referenced, just not by name.
  //
  // Runs the audit rather than reimplementing it: two copies of this logic would
  // drift, and the copy in the test is the one nobody updates.
  it('leaves no translation nothing asks for', () => {
    const bericht = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'i18n-audit.js')], {
      encoding: 'utf8'
    });
    const m = bericht.match(/## 2\. Orphan keys[^\n]*— (\d+)/);
    assert.ok(m, 'die Waisen-Zeile steht nicht im Bericht — das Audit hat sich geändert');
    const waisen = bericht
      .split(/\r?\n/)
      .slice(bericht.split(/\r?\n/).findIndex((l) => l.startsWith('## 2. Orphan')))
      .filter((l) => l.startsWith('  - '))
      .map((l) => l.slice(4).trim());
    assert.deepEqual(
      waisen.slice(0, Number(m[1])),
      [],
      'diese Schlüssel stehen in den Sprachdateien, aber kein Pfad fragt danach'
    );
  });

  // The parser above has the same blind spot as any regex: if it stops matching
  // the file's shape it finds nothing, and finding nothing makes the test pass.
  it('reads the locale files it is supposed to check', () => {
    for (const s of SPRACHEN) {
      const src = fs.readFileSync(path.join(ROOT, 'lang', s + '.js'), 'utf8');
      const treffer = src.split(/\r?\n/).filter((l) => /^\s*'((?:[^'\\]|\\.)*)'\s*:/.test(l)).length;
      assert.ok(treffer > 1000, s + '.js: only ' + treffer + ' key lines matched, the extraction is broken');
    }
  });
});
