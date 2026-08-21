'use strict';
// Every breakpoint in styles.css is measured, and the proof is the file itself.
//
// Why this is worth a test: a width list does not throw either. Two rounds of
// mobile work shipped with a maintained, reasoned list of widths — 320, 375,
// 1440 here; 320, 360, 390, 414, 768 in the shop — and both lists were missing
// the band where the layout is actually wrong. Neither run failed. Both
// reported green. A list knows nothing about an @media rule somebody writes
// tomorrow, and nothing about the space between two of its own numbers.
//
// So the width list stops being a list. It is derived: a range plus G-1, G, G+1
// around every breakpoint the stylesheet declares, and this file is the gate
// that fails when the derivation stops covering the file.
//
// Same limit as test/mobile-tokens.test.js, and worth restating: this proves
// the widths are covered, not that anything renders correctly at them. What
// renders is scripts/measure-mobile.js, which needs a browser and therefore
// cannot live in `npm test`.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { breakpoints, widthBand, uncovered, POINTERS, ROOT_PX, maskedCss } = require('../scripts/mobile-size-scan.js');

describe('the breakpoints are read, not typed', () => {
  it('finds them in styles.css', () => {
    const { list } = breakpoints();
    const px = list.filter((g) => g.axis === 'viewport').map((g) => g.px);
    // The numbers themselves are deliberately not pinned. They are allowed to
    // move — that they are allowed to move is the entire point of reading them.
    // What is pinned is that reading works and that the load-bearing one is
    // there.
    assert.ok(px.length >= 4, `only ${px.length} breakpoints found — is the reader still reading?`);
    assert.ok(px.includes(768), 'the 768px switch is missing, and the sidebar hangs on it');
    assert.deepEqual(
      px,
      [...px].sort((a, b) => a - b),
      'ascending'
    );
    assert.equal(new Set(px).size, px.length, 'no duplicates');
  });

  it('covers every one of them with G-1, G, G+1', () => {
    const { list } = breakpoints();
    assert.deepEqual(
      uncovered(list, widthBand(list)),
      [],
      'a breakpoint has no triple around it, which is exactly the defect the two previous rounds shipped'
    );
  });

  it('names a breakpoint outside the swept range instead of passing it', () => {
    // The regression this pins. widthBand and uncovered both used to clamp the
    // triple to from..to, so a breakpoint outside the range contributed no
    // width AND reported no gap: the run printed its all-clear for the one
    // switch it had never opened a window at. Both directions, because both
    // ends had the same guard.
    for (const px of [2000, 280]) {
      const rule = [{ px, axis: 'viewport', count: 1, from: ['min-width'] }];
      assert.ok(widthBand(rule).includes(px), `${px}px never reaches the band`);
      assert.deepEqual(
        uncovered(rule, [320, 1920]).map((g) => g.px),
        [px],
        `${px}px is outside the sweep and has to be named, not silently dropped`
      );
    }
  });

  it('fails loudly when a new breakpoint appears', () => {
    const { list } = breakpoints();
    const band = widthBand(list);
    // A rule that does not exist today, against a width list nobody updated.
    const invented = [...list, { px: 1233, axis: 'viewport', count: 1, from: ['max-width'] }];
    const gaps = uncovered(invented, band);
    assert.equal(gaps.length, 1, 'the new breakpoint has to be named');
    assert.deepEqual(gaps[0].missing, [1232, 1233, 1234]);
  });

  it('reads both spellings, both units and both axes', () => {
    const probe = [
      '@media (max-width: 860px){a{color:red}}',
      '@media (width <= 900px){b{color:red}}',
      '@media (400px <= width <= 800px){c{color:red}}',
      '@media screen and (max-width: 40em){d{color:red}}',
      '@container (min-width: 30rem){e{color:red}}'
    ].join('\n');
    const { list } = breakpoints(probe);
    assert.deepEqual(
      list.filter((g) => g.axis === 'viewport').map((g) => g.px),
      [400, 640, 800, 860, 900],
      '40em is 640px, and a range names two bounds rather than one'
    );
    assert.deepEqual(
      list.filter((g) => g.axis === 'container').map((g) => g.px),
      [30 * ROOT_PX],
      'a container query is a breakpoint too, on the box axis instead of the window one'
    );
  });

  it('keeps the container axis out of the window width list', () => {
    // Measuring a container breakpoint at that window width would be a number
    // without a meaning. It still has to be listed, so rule R2 can see it.
    const { list } = breakpoints('@container (min-width: 481px){a{color:red}}');
    assert.equal(list.length, 1);
    assert.deepEqual(
      widthBand(list).filter((w) => w > 470 && w < 490),
      [480],
      'the 20px step only, no triple around 481'
    );
    assert.deepEqual(uncovered(list, widthBand(list)), []);
  });

  it('reports what switches the cascade without being a width', () => {
    const { nonWidth } = breakpoints();
    const features = new Set(nonWidth.map((n) => n.feature));
    // These exist in styles.css today. The point is not the list but that it
    // comes back at all: `pointer: coarse` aims at a device at ANY width, and a
    // stand that only knows widths reports it as absent rather than unmeasured.
    assert.ok(features.has('pointer'), 'pointer: coarse switches the cascade');
    assert.ok(features.has('hover'), 'hover: none switches it too');
    assert.ok(features.has('orientation'), 'landscape switches it');
  });
});

describe('the input axis', () => {
  it('has two modes and neither of them is a width', () => {
    assert.deepEqual(
      POINTERS.map((p) => p.name),
      ['fine', 'coarse']
    );
    // Rule R1: space and input are two axes and never mixed. A pointer mode
    // carrying a width would be that mixture written down.
    for (const p of POINTERS) assert.equal('width' in p, false);
  });

  it('gives the finger a higher floor than the mouse', () => {
    const fine = POINTERS.find((p) => p.name === 'fine');
    const coarse = POINTERS.find((p) => p.name === 'coarse');
    assert.equal(fine.tapFloor, 24, 'WCAG 2.5.8 Target Size (Minimum), level AA');
    assert.equal(coarse.tapFloor, 44, "Apple's HIG and WCAG 2.5.5, level AAA");
    assert.ok(coarse.tapFloor > fine.tapFloor);
  });
});

describe('what the stand needs in order to stay honest', () => {
  it('does not clip the page instead of scrolling it', () => {
    // Comments blanked first, or the paragraph inside the body rule explaining
    // why the declaration is gone would itself trip the assertion.
    const css = maskedCss(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8')).src;
    const body = css.match(/\nbody \{[\s\S]*?\n\}/);
    assert.ok(body, 'no body rule in styles.css');
    // `overflow-x: hidden` on body removes the sideways scrollbar, which is the
    // one signal a person would have noticed, and that turned "no horizontal
    // scroll" into a claim nobody could disprove. Both mobile rounds made it.
    //
    // Measured on 2026-08-21 with scripts/measure-mobile.js --app before
    // removing it: 96 overflow findings with the rule, 98 without. It was
    // hiding two, both on the calendar's agenda row. And it did not do the job
    // it was there for -- eleven of twelve pages still widened the layout
    // viewport on a phone with it in place, because that is the meta viewport
    // and not a scrollbar.
    assert.doesNotMatch(
      body[0],
      /overflow-x:\s*hidden/,
      'body{overflow-x:hidden} is back, and with it a claim that cannot be measured'
    );
  });
});
