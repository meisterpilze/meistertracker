'use strict';
// Whether the eight numbers on the Betrieb overview can be read.
//
// card(icon, value, label, sub, accentColor, accentBg) puts accentColor on two
// different things: the 24px bold value, which sits on the white card, and the
// icon glyph, which sits on the tinted accentBg chip beside it. Both want 3:1 —
// the value because 24px bold is "large text" under WCAG 1.4.3, the glyph
// because 1.4.11 asks the same of a graphical object that carries meaning.
//
// Six of the eight cards pass hand-picked darks between 3.7 and 6.4. The two
// quality cards were passing the mid tones of the semantic palette instead, and
// the mid tones are built to sit *behind* white text, not to be read on it:
// --c-green is 2.3:1 on white and 2.1:1 as a glyph on --c-green-light, --c-amber
// 2.1 and 1.9. So two of eight cards in a row were visibly fainter than their
// neighbours, which is the sort of thing you notice without being able to say
// why.
//
// Computed rather than asserted from a table: the ratios come out of the token
// values in styles.css, so moving a token moves the test with it and a token
// that drops below the floor fails here instead of on somebody's screen.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

/** --c-green -> #22c55e, straight out of the :root block. */
const TOKEN = new Map();
{
  const root = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')));
  for (const m of root.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) TOKEN.set(m[1], m[2].toLowerCase());
}

function relLum(hex) {
  const c = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const x = parseInt(c.substr(i, 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a, b) {
  const l1 = relLum(a);
  const l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** The var(--x) names in an assignment, in source order — one per ternary branch. */
function branches(varName) {
  const m = APP.match(new RegExp('const ' + varName + ' =[\\s\\S]*?;'));
  assert.ok(m, varName + ' has moved or been renamed');
  const names = [...m[0].matchAll(/var\((--[\w-]+)\)/g)].map((x) => x[1]);
  assert.ok(names.length > 0, varName + ' no longer names any token');
  return names;
}

function resolve(name) {
  const hex = TOKEN.get(name);
  assert.ok(hex, name + ' is used as a KPI colour but has no value in :root');
  return hex;
}

const SURFACE = () => resolve('--c-surface');
const FLOOR = 3.0;
const fmt = (n) => n.toFixed(2);

// The two cards whose colour is chosen by a rule rather than picked once. Both
// ternaries list their states in the same order, so branch i of the colour goes
// with branch i of the background.
const PAIRS = [
  ['contamination rate', 'contamColor', 'contamBg'],
  ['days without contamination', 'streakColor', 'streakBg']
];

describe('the quality KPIs can be read at every value they can take', () => {
  for (const [label, fgVar, bgVar] of PAIRS) {
    const fgs = branches(fgVar);
    const bgs = branches(bgVar);

    it(label + ': the value on the white card clears ' + FLOOR + ':1', () => {
      const weak = fgs
        .map((n) => [n, contrast(resolve(n), SURFACE())])
        .filter(([, r]) => r < FLOOR)
        .map(([n, r]) => n + ' is ' + fmt(r) + ':1');
      assert.deepEqual(weak, [], label + ' has a state whose 24px value is too faint: ' + weak.join(', '));
    });

    it(label + ': the icon glyph on its own chip clears ' + FLOOR + ':1', () => {
      assert.equal(fgs.length, bgs.length, fgVar + ' and ' + bgVar + ' no longer branch in step');
      const weak = [];
      for (let i = 0; i < fgs.length; i++) {
        const r = contrast(resolve(fgs[i]), resolve(bgs[i]));
        if (r < FLOOR) weak.push(fgs[i] + ' on ' + bgs[i] + ' is ' + fmt(r) + ':1');
      }
      assert.deepEqual(weak, [], label + ' has a state whose icon is too faint: ' + weak.join(', '));
    });
  }

  it('the mid tones are what fails, which is why the -dark variants are used', () => {
    // Guards the reasoning, not just the outcome: if someone reaches for
    // --c-green here again, this says what will happen before it ships.
    for (const mid of ['--c-green', '--c-amber']) {
      assert.ok(
        contrast(resolve(mid), SURFACE()) < FLOOR,
        mid + ' now clears ' + FLOOR + ':1 on the card — the palette moved, and this file can be simplified'
      );
    }
    for (const dark of ['--c-green-dark', '--c-amber-dark', '--c-red-dark']) {
      assert.ok(contrast(resolve(dark), SURFACE()) >= 4.5, dark + ' no longer clears even the small-text floor');
    }
  });

  it('the hand-picked cards too — the whole row, not just the two rules', () => {
    // This one earned its place immediately: it found a third faint card the
    // eye had passed over. The wheat-bran KPI was #c9a227, picked for its hue
    // rather than its weight, at 2.4:1 on the card and 2.2:1 on its chip while
    // its six neighbours ran 3.7 to 6.4. Checking the literals as well as the
    // two ternaries is the difference between fixing what was noticed and
    // fixing what is there.
    const lits = [...APP.matchAll(/card\(\s*icon\w+[\s\S]{0,400}?'(#[0-9a-fA-F]{6})',\s*'(#[0-9a-fA-F]{6})'/g)];
    assert.ok(lits.length >= 4, 'expected the hand-picked KPI cards to still pass literal colours');
    const weak = [];
    for (const m of lits) {
      const onCard = contrast(m[1], SURFACE());
      const onChip = contrast(m[1], m[2]);
      if (onCard < FLOOR) weak.push(m[1] + ' on the card is ' + fmt(onCard) + ':1');
      if (onChip < FLOOR) weak.push(m[1] + ' on ' + m[2] + ' is ' + fmt(onChip) + ':1');
    }
    assert.deepEqual(weak, [], 'a hand-picked KPI colour is too faint: ' + weak.join(', '));
  });
});
