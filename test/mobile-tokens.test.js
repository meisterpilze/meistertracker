'use strict';
// The mobile size system, checked as text — because nothing else can check it.
//
// Why this is worth a test: type that is too small does not throw. It renders,
// it ships, and it is only wrong on a device nobody reviewing the diff is
// holding. The same blindness that let a 480px viewport get a *smaller* primary
// button than a 27" monitor, which is the defect the token layer exists to fix.
//
// This repo has no browser and no jsdom — the other UI tests lift functions out
// of app.js and run them against mocks, which cannot see a stylesheet at all.
// So these assertions read styles.css as text. That is a real limit and worth
// stating: this proves the rules are written, not that they render. The device
// pass in the PR checklist is what proves the second thing.
//
// The bridge case below is not hypothetical. The first version of the bridge
// listed 8/9/10/11/12px and missed eleven fractional sizes (10.5px, 11.5px,
// 9.5px, 12.5px) that app.js emits, so that text stayed small on a phone while
// the block looked complete. A pattern list is only as good as its survey.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { floor, subFloorSizes, blocks, MAX_WIDTH_BLOCK } = require('../scripts/mobile-size-scan.js');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// Read off --fs-xs rather than restated here: a second copy of the number lets
// the token move while this file keeps asserting against the old one.
const FLOOR = floor(CSS);

// The :root block and the desktop override, as source text.
function block(re) {
  const m = CSS.match(re);
  assert.ok(m, 'block not found in styles.css — it was renamed or removed: ' + re);
  return m[0];
}
const ROOT_BLOCK = block(/^:root \{[\s\S]*?\n\}/m);
// Non-greedy to the first `}` at column 0: the nested :root close is indented,
// so this lands on the media query's own brace.
const DESKTOP_BLOCK = block(/@media \(min-width: 769px\) and \(hover: hover\) \{[\s\S]*?\n\}/);

const TOKENS = [
  '--fs-xs',
  '--fs-sm',
  '--fs-base',
  '--tap',
  '--tap-sm',
  '--pad-page',
  '--pad-card',
  '--pad-btn',
  '--pad-stab',
  '--pad-sb',
  '--pad-modal',
  '--fab-bottom'
];

describe('mobile token layer', () => {
  it('declares every size token on :root, which is the phone', () => {
    for (const t of TOKENS) {
      assert.match(ROOT_BLOCK, new RegExp('\\n\\s*' + t + ':\\s*[^;]+;'), `${t} missing from :root`);
    }
  });

  // The whole architecture is this one direction. A `max-width` override block
  // would mean someone went back to subtracting from the desktop.
  it('overrides on min-width, not max-width, so the phone stays the base', () => {
    for (const block of blocks(CSS, MAX_WIDTH_BLOCK)) {
      assert.doesNotMatch(
        block.body,
        /^\s*:root \{/m,
        'a max-width block redefines :root — the base flipped back to desktop'
      );
    }
  });

  // Not decoration: a tablet held in a gloved hand is 1024px wide and still
  // needs the phone's numbers. Width alone would hand it the desk's.
  it('keys the desktop override on the input device as well as the width', () => {
    assert.match(DESKTOP_BLOCK, /hover: hover/);
  });

  it('overrides only tokens that :root actually declares', () => {
    for (const m of DESKTOP_BLOCK.matchAll(/(--[a-z-]+):/g)) {
      assert.ok(TOKENS.includes(m[1]), `${m[1]} is overridden for desktop but is not a declared token — typo?`);
    }
  });
});

describe('touch targets', () => {
  for (const sel of ['.btn', '.stab', '.sb-btn']) {
    it(`${sel} carries a tap-token minimum`, () => {
      const rule = CSS.match(new RegExp('^\\' + sel + ' \\{[\\s\\S]*?\\n\\}', 'm'));
      assert.ok(rule, `${sel} rule not found`);
      assert.match(rule[0], /min-height: var\(--tap(-sm)?\)/, `${sel} has no min-height from a tap token`);
    });
  }

  // The specific regression this phase existed to undo.
  it('never shrinks .btn at a narrow breakpoint again', () => {
    for (const block of blocks(CSS, MAX_WIDTH_BLOCK)) {
      assert.doesNotMatch(
        block.body,
        /\.btn \{[^}]*font-size:\s*\d/,
        'a max-width block sets a literal font-size on .btn'
      );
    }
  });
});

describe('the inline-size bridge', () => {
  // Every distinct sub-floor size the source actually emits, both spellings.
  const declared = new Set();
  for (const src of [HTML, APP]) {
    for (const m of subFloorSizes(src, FLOOR)) declared.add(m.size);
  }

  it('finds sub-floor inline sizes to cover (otherwise this suite is vacuous)', () => {
    assert.ok(declared.size > 0, 'no sub-floor inline sizes found — check the scan, not the app');
  });

  it('has a selector for every sub-floor size present in the source', () => {
    const missing = [...declared].filter((size) => !CSS.includes(`[style*='font-size:${size}']`));
    assert.deepEqual(
      missing,
      [],
      `the bridge misses ${missing.length} size(s) the source emits — that text stays small on a phone`
    );
  });

  // An attribute selector outranks a bare `input`, so the bridge would silently
  // hand iOS Safari a 13px field to zoom into.
  it('keeps form controls at 16px despite the bridge outranking the old rule', () => {
    assert.match(CSS, /input\[style\*='font-size'\][\s\S]{0,200}font-size: 16px !important/);
  });
});
