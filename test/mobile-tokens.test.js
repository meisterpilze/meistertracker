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

const {
  floor,
  tapFloor,
  rootPx,
  subFloorSizes,
  blocks,
  MAX_WIDTH_BLOCK,
  maskedCss
} = require('../scripts/mobile-size-scan.js');

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

// Derived from the stylesheet, not restated here. Phase 2 adds a paired token
// per component — the base layer holds 104 sub-floor sizes and every one needs
// its own — and a hand-kept list is a list someone forgets to extend, which is
// silent: the new token simply is not checked.
//
// The prefixes are the contract. `--fs-` `--tap` `--pad-` `--fab-` are the size
// system; everything else on :root is theme (--c-*, --radius, --sidebar-w) and
// has nothing to do with the phone.
const TOKEN_PREFIX = /^--(fs-|tap|pad-|fab-)/;
const TOKENS = [...new Set([...ROOT_BLOCK.matchAll(/\n\s*(--[a-z0-9-]+):/g)].map((m) => m[1]))].filter((t) =>
  TOKEN_PREFIX.test(t)
);

// The twelve Phase 0 shipped. Named so a derivation that quietly matches
// nothing fails here rather than turning every assertion below into a no-op.
const PHASE_0_TOKENS = [
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
  it('finds the tokens (a derivation that matches nothing would pass everything)', () => {
    const lost = PHASE_0_TOKENS.filter((t) => !TOKENS.includes(t));
    assert.deepEqual(lost, [], `the :root scan no longer sees ${lost.length} of the tokens Phase 0 shipped`);
  });

  it('declares every size token on :root, which is the phone', () => {
    for (const t of TOKENS) {
      assert.match(ROOT_BLOCK, new RegExp('\\n\\s*' + t + ':\\s*[^;]+;'), `${t} missing from :root`);
    }
  });

  // The failure this catches is the one the project cannot afford and CI cannot
  // otherwise see: a token added for a phone value with no desktop value beside
  // it silently moves the desktop, and the only thing that would notice is
  // scripts/capture-desktop-baseline.js, which needs a browser and a human.
  it('pairs every token with a desktop value', () => {
    const unpaired = TOKENS.filter((t) => !new RegExp('\\n\\s*' + t + ':\\s*[^;]+;').test(DESKTOP_BLOCK));
    assert.deepEqual(
      unpaired,
      [],
      `${unpaired.length} token(s) have a phone value and no desktop one — the desktop moves: ${unpaired.join(', ')}`
    );
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

describe('the scan that the ratchet reports through', () => {
  // scripts/mobile-audit.js --list prints styles.css:<line> for every hit, and
  // it computes that line from the MASKED stylesheet. The masking blanks
  // comments so the bridge block's own `[style*='font-size:8px']` selectors do
  // not count themselves, and its contract is that a blanked byte is still a
  // byte and a blanked newline is still a newline.
  //
  // The first version wrote `' '.repeat(s.length)`. Byte count preserved, line
  // count destroyed: every multi-line comment collapsed to one line, and every
  // DECLARED line number after the first block comment pointed at an unrelated
  // rule. The tool was confidently sending people to the wrong place, which is
  // worse than not reporting a line at all.
  const RAW = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const newlines = (t) => (t.match(/\n/g) || []).length;

  it('keeps every byte where it was', () => {
    const { src, scan } = maskedCss(RAW);
    assert.equal(src.length, RAW.length, 'masking changed the byte count — every reported offset is off by that much');
    assert.equal(scan.length, RAW.length);
  });

  it('keeps every newline where it was', () => {
    const { src, scan } = maskedCss(RAW);
    assert.equal(
      newlines(src),
      newlines(RAW),
      'masking ate newlines — byte offsets still resolve, but every line number computed from them is wrong'
    );
    assert.equal(newlines(scan), newlines(RAW));
  });
});

describe('the phone floors', () => {
  // 104 rules set a sub-floor font-size and serve both devices from that one
  // number. They are not tokenised — each keeps its desktop literal and is
  // floored on the phone by `max(Npx, var(--fs-min))`, so the desktop value is
  // never replaced and cannot move. What has to hold is that the floor is the
  // floor everywhere: the ratchet in scripts/mobile-audit.js reads --fs-xs to
  // decide what counts as sub-floor, and the stylesheet enforces --fs-min. Two
  // numbers for one idea is a silent drift, so they are pinned to each other.
  const valueIn = (blockText, token) => {
    const m = blockText.match(new RegExp('\\n\\s*' + token + ':\\s*([^;]+);'));
    return m && m[1].trim();
  };

  it('floors the phone at exactly --fs-xs', () => {
    assert.equal(
      valueIn(ROOT_BLOCK, '--fs-min'),
      valueIn(ROOT_BLOCK, '--fs-xs'),
      '--fs-min and --fs-xs disagree — the stylesheet enforces one floor and the ratchet counts against another'
    );
  });

  it('lifts the floor off the desktop entirely', () => {
    assert.equal(
      valueIn(DESKTOP_BLOCK, '--fs-min'),
      '0px',
      'the desktop floor must be 0 so every max() returns the literal beside it unchanged'
    );
  });

  it('never floors against a token that is not the floor', () => {
    // `max(12px, var(--fs-sm))` would read as deliberate, pass the ratchet —
    // which only looks for a bare px after `font-size:` — and quietly hand the
    // desktop a 13px value where 12px was written.
    const wrong = [...CSS.matchAll(/font-size:\s*max\([^)]*var\((--[a-z0-9-]+)\)/g)]
      .map((m) => m[1])
      .filter((t) => t !== '--fs-min');
    assert.deepEqual(
      wrong,
      [],
      `font-size: max() floored against ${[...new Set(wrong)].join(', ')} instead of --fs-min`
    );
  });

  // The same idea applied to height. Rules across the app already chose a
  // minimum — 44px, 46px, 48px — each correct for a mouse; --tap-min raises
  // them in a hand and leaves them alone on a desk.
  it('floors touch the same way it floors type', () => {
    assert.equal(
      valueIn(ROOT_BLOCK, '--tap-min'),
      valueIn(ROOT_BLOCK, '--tap'),
      '--tap-min and --tap disagree — two numbers for one touch floor'
    );
    assert.equal(
      valueIn(DESKTOP_BLOCK, '--tap-min'),
      '0px',
      'the desktop touch floor must be 0. It cannot be `auto` like --tap: max() with a keyword is invalid CSS, ' +
        'the whole declaration is dropped, and the phone minimum goes with it'
    );
  });

  it('never floors a height against a token that is not the touch floor', () => {
    const wrong = [...CSS.matchAll(/min-(?:height|width):\s*max\([^)]*var\((--[a-z0-9-]+)\)/g)]
      .map((m) => m[1])
      .filter((t) => t !== '--tap-min');
    assert.deepEqual(wrong, [], `min-height/width: max() floored against ${[...new Set(wrong)].join(', ')}`);
  });
});

describe('the floors the tools measure against', () => {
  // scripts/measure-mobile.js gates a real phone measurement on these two
  // numbers, and scripts/mobile-audit.js counts against the first. Both get
  // them from rootPx(), so a reader that quietly returns the wrong value does
  // not throw — it reports a clean bill of health against the wrong floor,
  // which is the one failure mode worse than no measurement at all.
  it('reads the type floor and the touch floor off :root', () => {
    assert.equal(floor(CSS), 13, 'the type floor moved — if that was deliberate, this number moves with it');
    assert.equal(tapFloor(CSS), 56, 'the touch floor moved — see MOBILE_REDESIGN.md §9 decision 2');
  });

  // The specific way this breaks. `--tap-min` is declared twice: 56px on :root
  // and 0px in the desktop override, the 0 being what makes every max() return
  // its literal on a desk. A reader not anchored to the phone block finds the
  // desktop one just as easily, and then the touch floor is zero and every
  // control on earth clears it.
  it('reads the phone value, not the desktop override beside it', () => {
    assert.notEqual(
      rootPx('--tap-min', CSS),
      0,
      'the touch floor resolved to the desktop 0px — nothing can fail against it'
    );
    assert.notEqual(rootPx('--fs-min', CSS), 0, 'the type floor resolved to the desktop 0px');
  });

  it('throws on a token it cannot find, rather than reporting against undefined', () => {
    assert.throws(() => rootPx('--fs-nope', CSS), /--fs-nope/);
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
