// Shared scanning for the mobile size system — used by scripts/mobile-audit.js
// (the ratchet) and test/mobile-tokens.test.js (the CI assertions).
//
// Both need the same three things, and before this file existed both had their
// own copy of each: the floor as a hand-typed 13, a `font-size:` regex, and a
// way to carve `@media (... max-width ...)` blocks out of styles.css. The two
// block extractors were not even the same algorithm — one counted braces, the
// other matched a non-greedy regex that only works while Prettier keeps nested
// closing braces indented. They agreed on today's file and would not have kept
// agreeing.
//
// Same shape as scripts/photo-cap.js, which lives here so server.js and
// test/photo-cap.test.js can share one implementation.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS_PATH = path.join(ROOT, 'styles.css');

const readCss = () => fs.readFileSync(CSS_PATH, 'utf8');

// The floor is --fs-xs, read from the stylesheet rather than restated. A copy
// in each consumer would let the token move while both kept checking the old
// number, and nothing would fail.
function floor(css = readCss()) {
  const m = css.match(/^:root \{[\s\S]*?\n\}/m);
  const decl = m && m[0].match(/\n\s*--fs-xs:\s*([\d.]+)px;/);
  if (!decl) throw new Error('--fs-xs not found in the :root block of styles.css — the floor has no source of truth');
  return parseFloat(decl[1]);
}

// Every `font-size:` below the floor. `spacing` is kept because it is the
// difference between the two spellings in this codebase — index.html writes
// `font-size: 12px`, app.js writes `font-size:12px` — and the bridge block in
// styles.css needs a selector for each.
function* subFloorSizes(text, floorPx) {
  for (const m of text.matchAll(/font-size:(\s*)([\d.]+)px/g)) {
    const value = parseFloat(m[2]);
    if (value < floorPx) yield { index: m.index, value, spacing: m[1], size: m[1] + m[2] + 'px', text: m[0] };
  }
}

// Carve out the body of every block whose header matches, by brace depth, so
// nesting and formatting are both irrelevant.
function* blocks(css, headerRe) {
  for (const m of css.matchAll(headerRe)) {
    const start = m.index + m[0].length;
    let i = start;
    let depth = 1;
    while (i < css.length && depth) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    yield { start, end: i, body: css.slice(start, i) };
  }
}

const MAX_WIDTH_BLOCK = /@media[^{]*max-width[^{]*\{/g;
const MEDIA_BLOCK = /@media[^{]*\{/g;

// Every block a phone matches. Width is the obvious one and was the only one
// for a while, which left a hole: `@media (pointer: coarse)` targets exactly
// the devices the floor exists for, at any width, so a sub-floor size in one of
// those is worse than the same size in a base rule — it is aimed at the phone.
// The scan overlay had one, 12px on the undo button in the scan log, and no
// count could see it.
const PHONE_BLOCK = /@media[^{]*(max-width|pointer:\s*coarse|hover:\s*none)[^{]*\{/g;

// Everything a phone reads from an unconditional rule: the stylesheet with every
// @media body blanked out. Blanked, not deleted, so byte offsets survive.
//
// Both media directions have to go. A `max-width` body is the mobile-only layer
// the ratchet already counts separately; a `min-width` body is by definition a
// desktop value, and 11px there is the correct answer, not debt. What is left is
// the layer that serves both devices from one number — the layer neither the
// bridge (inline only) nor the max-width count can see.
function outsideMedia(css) {
  const src = maskedCss(css).src;
  let out = src;
  for (const block of blocks(src, MEDIA_BLOCK)) {
    out = out.slice(0, block.start) + ' '.repeat(block.end - block.start) + out.slice(block.end);
  }
  return out;
}

// Comments and attribute selectors are blanked rather than deleted, so byte
// offsets survive and a reported line number points at the real line. Blanking
// them is what stops the bridge block's own `[style*='font-size:8px']`
// selectors from counting themselves.
function maskedCss(css = readCss()) {
  const blank = (s) => ' '.repeat(s.length);
  const src = css.replace(/\/\*[\s\S]*?\*\//g, blank);
  return { src, scan: src.replace(/\[[^\]]*\]/g, blank) };
}

module.exports = {
  ROOT,
  CSS_PATH,
  readCss,
  floor,
  subFloorSizes,
  blocks,
  MAX_WIDTH_BLOCK,
  PHONE_BLOCK,
  MEDIA_BLOCK,
  outsideMedia,
  maskedCss
};
