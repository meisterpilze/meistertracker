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
  MEDIA_BLOCK,
  maskedCss,
  maskedSource
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
// so this lands on the media query's own brace. `, print` is part of the
// header and not an afterthought — see the assertion below.
const DESKTOP_BLOCK = block(/@media \(min-width: 769px\) and \(hover: hover\), print \{[\s\S]*?\n\}/);

/** Der Wert einer Marke in einem der beiden Blöcke. Stand als lokale Hilfe in
 *  einem inneren `describe`; hochgezogen, weil die Prüfung auf rem und px sie
 *  ebenfalls braucht und zwei Fassungen davon genau die stille Drift wären,
 *  gegen die sie dort steht. */
const valueIn = (blockText, token) => {
  const m = blockText.match(new RegExp('\\n\\s*' + token + ':\\s*([^;]+);'));
  return m && m[1].trim();
};

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
  // ⚠️ Package P1.5. The type marks are `rem` and the tap marks are `px`, and
  // that split is the whole point rather than a formatting preference.
  //
  // A browser's own font size is the one accessibility setting people actually
  // use, and until this conversion it reached nothing in this app: 189 sizes in
  // absolute pixels, and the marks that were meant to be the single switch for
  // them were pixels themselves. In rem they scale with it.
  //
  // A tap target must NOT. A finger is 10mm wide whatever size the type is set
  // to, so 56px is a physical measurement and stays one. Writing it in rem
  // would make the button grow with the text and the target no more reachable
  // than before.
  //
  // Nothing caught the conversion when it happened: all 1471 tests passed with
  // the marks changed under them, because every assertion here compares tokens
  // to each other rather than to a value. This is the assertion that was
  // missing.
  const TYP_MARKEN = ['--fs-xs', '--fs-sm', '--fs-base', '--fs-meta', '--fs-micro', '--fs-tile'];
  const TIPP_MARKEN = ['--tap', '--tap-sm', '--tap-min', '--tap-sm-min'];

  it('writes the type marks in rem, so the browser setting reaches them', () => {
    const falsch = TYP_MARKEN.filter((t) => !/^[\d.]+rem$/.test(valueIn(ROOT_BLOCK, t) || ''));
    assert.deepEqual(
      falsch,
      [],
      `these type marks are not relative: ${falsch.map((t) => `${t}: ${valueIn(ROOT_BLOCK, t)}`).join(', ')}` +
        ' — in px a browser font-size setting reaches nothing in this app'
    );
  });

  it('writes the tap marks in px, because a finger does not scale with the type', () => {
    const falsch = TIPP_MARKEN.filter((t) => !/^\d+px$/.test(valueIn(ROOT_BLOCK, t) || ''));
    assert.deepEqual(
      falsch,
      [],
      `these tap marks are not absolute: ${falsch.map((t) => `${t}: ${valueIn(ROOT_BLOCK, t)}`).join(', ')}` +
        ' — a target in rem grows with the text and stays just as hard to hit'
    );
  });

  it('the desktop marks follow the same split', () => {
    const typ = TYP_MARKEN.filter((t) => {
      const v = valueIn(DESKTOP_BLOCK, t);
      return v && !/^[\d.]+rem$/.test(v);
    });
    assert.deepEqual(typ, [], `desktop type marks not in rem: ${typ.join(', ')}`);
  });

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

  // And paper, which has no pointer at all. Without this every token resolves
  // to the gloved-hand value when printing: 13px floors on a barcode label and
  // 56px of white space under any control that reaches a page.
  it('gives print the desk values, not the hand ones', () => {
    assert.match(
      CSS,
      /@media \(min-width: 769px\) and \(hover: hover\), print \{/,
      'print is not in the desktop token query — `hover: hover` is false on paper, so every floor applies there'
    );
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

describe('what counts as an inline size', () => {
  // app.js builds a print window by writing a whole document as a string,
  // stylesheet included: `<style>…th{font-size:11px}…</style>`. Those are rules
  // on paper. No phone reads them, and the §6 bridge is an attribute selector,
  // so it never could have reached them — counting them as debt asks for a fix
  // that would be wrong to make. Two of the 256 were exactly this.
  it('does not count a print stylesheet as an inline style', () => {
    const src = '<div style="font-size:11px">a</div><style>th{font-size:11px}</style>';
    const found = [...subFloorSizes(maskedSource(src), FLOOR)];
    assert.equal(found.length, 1, 'the rule inside <style> was counted as an inline size');
  });

  it('keeps every byte and every newline while doing it', () => {
    const src = 'x<style>a{\nfont-size:9px;\n}</style>y';
    const out = maskedSource(src);
    assert.equal(out.length, src.length, 'masking moved every offset after it');
    assert.equal((out.match(/\n/g) || []).length, 2, 'masking ate the newlines and every line number with them');
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
    //
    // Two shapes are legitimate and both have to end at --fs-min:
    //   max(12px, var(--fs-min))            a rule with its own literal
    //   max(var(--fs-own), var(--fs-min))   .fs-floor, where the literal is on
    //                                       the element as a custom property
    //
    // Read from the comment-blanked stylesheet. The token block explains this
    // very pattern in prose, `font-size: max(12px, var(--fs-min))` and all, and
    // a scan of the raw text finds it there — the earlier version of this
    // assertion did, and only passed because the token it found in the comment
    // happened to be the allowed one.
    const bad = [];
    for (const m of maskedCss(CSS).src.matchAll(/font-size:\s*max\(([^;]*)\);/g)) {
      // The element's own number may carry a fallback — `var(--fs-own, var(--fs-xs))`
      // — and that inner token is not the floor, so it is removed before the
      // check rather than allowed by name.
      const expr = m[1].replace(/var\(--fs-own,[^)]*\)\)/g, 'var(--fs-own)');
      const vars = [...expr.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((v) => v[1]);
      if (!vars.includes('--fs-min')) bad.push(`${m[0].trim()} — no --fs-min`);
      for (const v of vars) if (v !== '--fs-min' && v !== '--fs-own') bad.push(`${m[0].trim()} — ${v}`);
    }
    assert.deepEqual(bad, [], `font-size: max() floored against something other than --fs-min: ${bad.join(' | ')}`);
  });

  // The same idea applied to height, twice — because §9 chose two floors and
  // one sentinel could only serve one of them. Rules across the app already
  // picked a minimum — 44px, 46px, 48px — each correct for a mouse; the
  // sentinels raise them in a hand and leave them alone on a desk.
  for (const [floorToken, pairToken] of [
    ['--tap-min', '--tap'],
    ['--tap-sm-min', '--tap-sm']
  ]) {
    it(`floors touch the same way it floors type (${floorToken})`, () => {
      assert.equal(
        valueIn(ROOT_BLOCK, floorToken),
        valueIn(ROOT_BLOCK, pairToken),
        `${floorToken} and ${pairToken} disagree — two numbers for one touch floor`
      );
      // ⚠️ Two separate demands on this one value, and they used to be one.
      // It must be a LENGTH, because `auto` inside max() is invalid CSS: the
      // whole declaration is dropped and the phone minimum goes with it. And
      // since package P1 it must be at least 24px, because that is WCAG 2.5.8
      // Target Size (Minimum), level AA, and level AA knows nothing about
      // input devices. It read `0px` before, which said "no floor at all on a
      // desk" — the exact half of rule R1 the tracker was missing while the
      // coarse half was already right.
      const desk = valueIn(DESKTOP_BLOCK, floorToken);
      assert.match(
        desk,
        /^\d+px$/,
        `the desktop value of ${floorToken} must be a length. It cannot be \`auto\` like ${pairToken}: ` +
          'max() with a keyword is invalid CSS, the whole declaration is dropped, and the phone ' +
          'minimum goes with it'
      );
      assert.ok(
        parseInt(desk, 10) >= 24,
        `${floorToken} is ${desk} on a desk, under the 24px of WCAG 2.5.8 level AA (package P1)`
      );
    });
  }

  // Both spellings, and both properties. The earlier version read `min-height`
  // and `min-width` only, which left `width: max(44px, var(--tap-min))` — the
  // form three square icon buttons actually use — unchecked. A max() against
  // the wrong token there reads as deliberate and silently resizes the desktop.
  it('never floors a size against a token that is not a touch floor', () => {
    const TOUCH_FLOORS = ['--tap-min', '--tap-sm-min'];
    const wrong = [...CSS.matchAll(/(?:min-)?(?:height|width):\s*max\([^)]*var\((--[a-z0-9-]+)\)/g)]
      .map((m) => m[1])
      .filter((t) => !TOUCH_FLOORS.includes(t));
    assert.deepEqual(wrong, [], `a height/width max() floored against ${[...new Set(wrong)].join(', ')}`);
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

describe('the size utilities that replace the inline styles', () => {
  const UTILITIES = ['fs-base', 'fs-sm', 'fs-meta', 'fs-xs', 'fs-micro'];

  it('declares each one doubled, so it outranks what the inline style outranked', () => {
    // An inline style beats every normal rule. Move one onto a plain class and
    // the element goes back to whatever component rule it had been overriding
    // — measured, not feared: the first version of this migration moved
    // thirteen elements at 1440px, four hints from 12px to 14px under
    // `.modal p` and six buttons from 11px to 12px under `.btn-sm`.
    for (const u of UTILITIES) {
      assert.match(
        CSS,
        new RegExp('\\.' + u + '\\.' + u + '\\s*\\{'),
        `.${u} is declared singly — every element carrying it is one component rule away from changing size`
      );
    }
  });

  it('never gives them !important, which would beat the anti-zoom rule', () => {
    // (0,1,0) with !important outranks `input, select, textarea { font-size:
    // 16px !important }` at (0,0,3), and iOS Safari zooms any field under
    // 16px. A doubled class loses to it, which is the whole point.
    for (const u of UTILITIES) {
      const rule = CSS.match(new RegExp('\\.' + u + '\\.' + u + '\\s*\\{[^}]*\\}'));
      assert.ok(rule, `.${u}.${u} rule not found`);
      assert.doesNotMatch(rule[0], /!important/, `.${u} carries !important and now outranks the iOS anti-zoom rule`);
    }
  });

  it('pairs each one with a token that has both a phone and a desktop value', () => {
    for (const u of UTILITIES) {
      const rule = CSS.match(new RegExp('\\.' + u + '\\.' + u + '\\s*\\{[^}]*\\}'));
      const token = rule[0].match(/font-size:\s*var\((--[a-z0-9-]+)\)/);
      assert.ok(token, `.${u} does not read its size from a token`);
      assert.ok(TOKENS.includes(token[1]), `${token[1]} is not a declared size token`);
    }
  });

  // .fs-floor is the fourth, and the only one whose number still lives on the
  // element — as `--fs-own`, so a 10.5px fruiting target keeps 10.5px on a desk
  // instead of being rounded onto the scale. It is worth its own assertion
  // because dropping the max() leaves valid CSS that simply has no floor, and
  // the utilities check above would not notice: it only inspects max()
  // expressions, and there would no longer be one.
  it('keeps the floor on the class whose size comes from the element', () => {
    const rule = CSS.match(/\.fs-floor\.fs-floor\s*\{[^}]*\}/);
    assert.ok(rule, '.fs-floor.fs-floor rule not found');
    assert.match(
      rule[0],
      /font-size:\s*max\(var\(--fs-own[^)]*\)[^)]*\),\s*var\(--fs-min\)\)/,
      '.fs-floor no longer floors — every one-off size it carries is back under 13px on a phone'
    );
    assert.match(
      rule[0],
      /var\(--fs-own,\s*var\(--fs-[a-z]+\)\)/,
      '.fs-floor lost its fallback: an element wearing it without --fs-own now makes the whole declaration ' +
        'invalid, and the element inherits whatever its parent happens to be'
    );
  });

  // The class carries no number of its own — the element brings it. An element
  // that wears the class and forgets the property gets the fallback rather than
  // nothing, which is the CSS half of the same guard; this is the loud half.
  it('never wears the floor class without bringing a size', () => {
    const bare = [];
    for (const [name, src] of [
      ['index.html', HTML],
      ['app.js', APP]
    ]) {
      for (const m of src.matchAll(/<[^<>]*\bfs-floor\b[^<>]*>/g)) {
        if (!m[0].includes('--fs-own')) bare.push(`${name}: ${m[0].slice(0, 70)}`);
      }
    }
    assert.deepEqual(bare, [], `${bare.length} element(s) carry .fs-floor with no --fs-own: ${bare.join(' | ')}`);
  });

  it('leaves no sub-floor inline size behind in index.html', () => {
    // app.js still has its own; this one is finished, and finished means the
    // count stays at nothing rather than drifting back one edit at a time.
    const left = [...subFloorSizes(HTML, FLOOR)].map((m) => m.text);
    assert.deepEqual(left, [], `index.html grew ${left.length} inline sub-floor size(s) back`);
  });
});

describe('the bridge, now that it is gone', () => {
  // §6's block matched `[style*='font-size:11px']` and lifted it with
  // !important. It was written as a hack, labelled as one, and given an exit:
  // delete it when the ratchet reports 0. The ratchet reports 0.
  //
  // These assertions are the inversion of the ones that used to live here.
  // They no longer check that the bridge covers every size the source emits;
  // they check that neither the sizes nor the bridge come back — because the
  // failure mode after a deletion is a slow return, one edit at a time, and
  // the first inline `font-size:11px` to reappear would now be small on a
  // phone with nothing to catch it.
  it('leaves no sub-floor inline size anywhere in the source', () => {
    const left = [];
    for (const [name, src] of [
      ['index.html', HTML],
      ['app.js', maskedSource(APP)]
    ]) {
      for (const m of subFloorSizes(src, FLOOR)) left.push(`${name}: ${m.text}`);
    }
    assert.deepEqual(
      left,
      [],
      `${left.length} inline sub-floor size(s) are back, and the bridge that used to cover them is gone: ` +
        left.slice(0, 6).join(', ')
    );
  });

  it('leaves no attribute-substring rule behind to bring it back', () => {
    const bridge = [...CSS.matchAll(/\[style\*='font-size[^\]]*\]/g)].map((m) => m[0]);
    assert.deepEqual(bridge, [], `${bridge.length} bridge selector(s) survive: ${bridge.join(', ')}`);
  });

  // The one rule the bridge used to have to fight, still standing and still
  // needing !important — for a different reason now. The inline sizes it beat
  // are gone; what it beats today is .fs-meta at (0,2,0), against its own
  // (0,0,3). Without the !important, Safari gets a 13px field to zoom into on
  // exactly the pages that were just cleaned up.
  it('keeps form controls at 16px, which is what stops iOS zooming the page', () => {
    assert.match(
      CSS,
      /input,\s*\n\s*select,\s*\n\s*textarea \{\s*\n\s*font-size: max\(1rem, 16px\) !important;/,
      'the anti-zoom rule lost its !important or its shape — a phone now zooms when a field is focused'
    );
  });

  // And the half that took twice as long to notice as the rule itself: which
  // axis it hangs on. Until 2026-08-23 it sat in `@media (max-width: 768px)`,
  // so a tablet in landscape — 1024px wide, still a finger — lost it, and 26
  // fields on nine pages went back to 13 and 14px from exactly 769px up.
  //
  // Read as text rather than measured because measure-mobile.js only sweeps
  // widths the band contains and pointers the emulator can set: it proves the
  // fields are 16px today, not that the rule cannot be moved back onto a width
  // tomorrow. This is the assertion that says which axis it belongs to.
  it('hangs the anti-zoom rule on the pointer, never on a width', () => {
    const { src } = maskedCss(CSS);
    const at = src.indexOf('font-size: max(1rem, 16px) !important');
    assert.ok(at > 0, 'the anti-zoom rule is gone');
    // Every @media whose body contains it. blocks() yields the body, so the
    // header is the text between the last `@media` before it and its brace.
    const umgebend = [...blocks(src, MEDIA_BLOCK)].filter((b) => b.start < at && at < b.end);
    assert.ok(umgebend.length > 0, 'the anti-zoom rule sits in no media block at all — it now applies to a mouse too');
    const bedingungen = umgebend.map((b) => src.slice(src.lastIndexOf('@media', b.start), b.start - 1).trim());
    for (const c of bedingungen) {
      assert.ok(
        !/width/.test(c),
        `the anti-zoom rule is back inside a width query (${c.trim()}) — a landscape tablet loses it again`
      );
      assert.ok(
        /any-pointer:\s*coarse/.test(c),
        `the anti-zoom rule asks ${c.trim()}, not any-pointer: coarse — a touchscreen laptop reports pointer: fine`
      );
    }
  });
});

// ── The type sizes themselves, not just the tokens ─────────────────────────
// The tokens became rem in the commit before this one; these are the 177
// declarations that were still writing their own px, and after them the
// browser's font setting reaches the whole sheet rather than fourteen names.
//
// Worth stating what this does NOT prove: a rem value is not automatically the
// right value. It proves the reader's setting is not thrown away, which is a
// different and smaller claim than "the type scale is good".
describe('the type sizes follow the reader, not the sheet', () => {
  // @media print is a physical medium: 10px there is a tenth of an inch of
  // paper, and a reader who set 20px in the browser would get a calendar that
  // no longer fits the sheet. So it keeps px, deliberately, and the list of
  // survivors below is what says so out loud.
  const OHNE_DRUCK = (() => {
    const { src } = maskedCss(CSS);
    const p = src.indexOf('@media print');
    if (p < 0) return src;
    const open = src.indexOf('{', p);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0)
        return src.slice(0, p) + src.slice(p, i + 1).replace(/[^\n]/g, ' ') + src.slice(i + 1);
    }
    return src;
  })();

  const pxSizes = (text) =>
    [...text.matchAll(/font-size\s*:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => /\d(?:\.\d+)?px\b/.test(v));

  it('writes no px font-size outside the print block, bar the anti-zoom rule', () => {
    // The 16px inside `max(1rem, 16px)` on a form control is not a type size,
    // it is iOS Safari's zoom threshold — a fixed count of CSS pixels that does
    // not move when the reader changes their font. The 1rem beside it is the
    // reader's setting, free to grow. It is the one honest px left.
    const left = pxSizes(OHNE_DRUCK).filter((v) => v !== 'max(1rem, 16px) !important');
    assert.deepEqual(left, [], `${left.length} px font-size(s) are back: ${left.slice(0, 8).join(' · ')}`);
  });

  // The other half of the same sweep. styles.css was the 177; app.js wrote 44
  // more of its own, and an inline font-size beats every rule in the sheet,
  // so those were the sizes no media query, no token and no reader setting
  // could reach at all. They are classes now — .fs-sm and .fs-base for the two
  // that are a mark's desktop value (26 and 8 of the 44), .fs-floor with the
  // number on the element for the eleven that sit on no rung.
  it('writes no inline px font-size in app.js outside the printed sheets', () => {
    const zeilen = APP.split('\n');
    const uebrig = [];
    for (const m of APP.matchAll(/font-size:\s*([0-9.]+px)/g)) {
      const z = APP.slice(0, m.index).split('\n').length;
      // The marker sits on the statement that builds the sheet, so the window
      // is the ten lines above the size rather than the line itself: one
      // marker covers a print document whose whole <style> is one string.
      const markiert = zeilen
        .slice(Math.max(0, z - 10), z)
        .join('\n')
        .includes('px-auf-papier');
      if (!markiert) uebrig.push(`app.js:${z} ${m[1]}`);
    }
    assert.deepEqual(
      uebrig,
      [],
      `${uebrig.length} inline size(s) in app.js beat the whole stylesheet again: ${uebrig.slice(0, 8).join(' · ')}`
    );
  });

  it('marks every px it does keep in app.js as belonging to paper', () => {
    // The escape hatch has to stay small, or it becomes the rule. Four
    // statements: one print document opened in its own window, two label
    // sheets, one calendar task list.
    const marken = [...APP.matchAll(/px-auf-papier/g)].length;
    assert.ok(marken > 0 && marken <= 6, `${marken} px-auf-papier markers in app.js — the exception is spreading`);
  });

  it('keeps the print block on px, because paper does not read a browser setting', () => {
    const { src } = maskedCss(CSS);
    const inPrint = pxSizes(src).length - pxSizes(OHNE_DRUCK).length;
    assert.ok(inPrint >= 10, `only ${inPrint} px sizes left in @media print — did the block move or shrink?`);
  });

  it('lands every rem value back on the pixel it was converted from', () => {
    // 13px is 0.8125rem, and 0.8125 × 16 is exactly 13. This is the guard on
    // the conversion itself: a value that does not land on a size the sheet
    // could have written means it was derived from a number that was never
    // there, and the desktop moved by a fraction nobody asked for.
    //
    // Half pixels are allowed because six of them were already half pixels —
    // 11.5px and 12.5px, the fractional sizes the :root comment calls out as
    // "named where they are used". Allowing halves keeps those honest; allowing
    // anything finer would let a 0.703125rem through and mean nothing.
    const krumm = [...maskedCss(CSS).src.matchAll(/font-size\s*:\s*([^;}]+)/g)]
      .flatMap((m) => [...m[1].matchAll(/(\d+(?:\.\d+)?)rem\b/g)].map((r) => Number(r[1])))
      .filter((n) => Math.abs(n * 32 - Math.round(n * 32)) > 1e-9);
    assert.deepEqual(krumm, [], `${krumm.length} rem value(s) land between pixels: ${krumm.join(', ')}`);
  });
});
