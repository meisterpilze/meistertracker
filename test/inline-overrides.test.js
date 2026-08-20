'use strict';
// Inline styles that a media query is trying to overrule.
//
// This is the quietest bug this codebase can have. An inline declaration beats
// every rule in styles.css, so a `@media` block written to change something on a
// phone silently does nothing on exactly the elements it was written for. It
// never throws, it never shows in a diff, and both halves look correct on their
// own — the rule says the right thing and the markup says the right thing.
//
// Three instances were found by walking the real cascade in a browser rather
// than by reading either file:
//
//   .dash-top-row      align-items: flex-start inline, and the phone block
//                      restacking it into a column could not change the
//                      alignment — both cards rendered 137px wide in a 343px page.
//   .btn-sm / .btn-xs  five buttons with inline padding, against the
//                      `(pointer: coarse)` rule that raises it to 10px 14px.
//   input / select     eight fields with an inline `max-width`, against the
//                      `max-width: 100%` rule written for exactly those fields.
//
// A full check needs a browser: only the DOM knows which selectors match which
// element. What this file does instead is forbid the two shapes that produced
// all three, as a grep over the markup — cheap, and it fails in CI on the next
// one. The browser sweep that found them lives in the session notes, not here.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const zeile = (i) => HTML.slice(0, i).split('\n').length;
const stil = (tag) => (tag.match(/style="([^"]*)"/) || [, ''])[1];
const wer = (tag) => (tag.match(/id="([^"]*)"/) || [, tag.slice(0, 40)])[1];

describe('nothing inline outranks a rule meant to change it', () => {
  it('finds the markup to check — a silent zero would make this file useless', () => {
    assert.ok(HTML.length > 100000, 'index.html did not load');
    assert.match(CSS, /pointer: coarse/, 'the touch block is gone — this file is checking against nothing');
  });

  it('leaves the touch padding to the touch rule', () => {
    // `(pointer: coarse) { .btn-xs, .btn-sm { padding: 10px 14px } }` exists to
    // make the small buttons tappable. An inline padding beats it and the button
    // stays at its desk size on a phone, which is the one place it must not.
    const schuldig = [...HTML.matchAll(/<button[^>]*>/g)]
      .filter((m) => /class="[^"]*btn-(sm|xs)/.test(m[0]) && /(^|;|")\s*padding\b/.test(stil(m[0])))
      .map((m) => `${wer(m[0])} (line ${zeile(m.index)})`);
    assert.deepEqual(schuldig, [], `small button(s) with an inline padding: ${schuldig.join(', ')}`);
  });

  it("leaves a field's width cap to the cascade", () => {
    // The cap is data — `--w-cap: 480px` on the element, read by `.w-cap` — so
    // the phone block can drop it. Written as `max-width: 480px` inline it
    // cannot be dropped by anything.
    const schuldig = [...HTML.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)]
      .filter((m) => /(^|;|")\s*max-width\b/.test(stil(m[0])))
      .map((m) => `${wer(m[0])} (line ${zeile(m.index)})`);
    assert.deepEqual(
      schuldig,
      [],
      `field(s) with an inline max-width — use class="w-cap" and --w-cap: ${schuldig.join(', ')}`
    );
  });

  it('keeps the two halves of the width cap together', () => {
    // Either without the other is worse than neither: the property with no rule
    // reading it caps nothing, and the rule with no property caps everything to
    // `max-width: var(--w-cap)` → invalid → none.
    const props = HTML.includes('--w-cap:');
    assert.equal(
      props,
      /\.w-cap \{[^}]*max-width: var\(--w-cap\)/s.test(CSS),
      '--w-cap is declared without .w-cap reading it, or the other way round'
    );
    assert.match(
      CSS,
      /\.w-cap \{\s*max-width: 100%;/,
      'nothing drops the cap below the breakpoint — the two fields that declare no inline width are not reached by the attribute rule either'
    );
  });

  it("does not put a flex row's alignment out of the stylesheet's reach", () => {
    // `.dash-top-row` is the one that shipped broken. The general shape — an
    // inline align-items on something a media query restacks — is what is
    // forbidden; the class list is deliberately short rather than a guess at
    // every row that might one day be restacked.
    const stacked = ['dash-top-row'];
    const schuldig = [...HTML.matchAll(/<div[^>]*>/g)]
      .filter(
        (m) => stacked.some((c) => new RegExp(`class="[^"]*\\b${c}\\b`).test(m[0])) && /align-items/.test(stil(m[0]))
      )
      .map((m) => `${wer(m[0])} (line ${zeile(m.index)})`);
    assert.deepEqual(schuldig, [], `row(s) whose alignment a phone cannot change: ${schuldig.join(', ')}`);
  });
});
