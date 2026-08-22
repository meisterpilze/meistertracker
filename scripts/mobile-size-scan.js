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

// Any length token on the phone :root, read from the stylesheet rather than
// restated. A copy in each consumer would let the token move while both kept
// checking the old number, and nothing would fail.
//
// ⚠️ **px OR rem.** Package P1.5 moves the type marks to `rem` so that a
// browser's own font size finally reaches this app, and the tools measure in
// px. 16 is the CSS initial value of the root font size, so a rem token
// converts back to exactly the px it replaced — which is the point of the
// conversion and the reason the desktop baseline did not move. It is a
// CONVERSION and not a measurement: if the user has set 20px, the real floor
// on their screen is higher than what these tools compare against, and that is
// the right direction to be wrong in. Measuring it properly needs a browser,
// and mobile-size-scan.js deliberately has none.
const WURZEL_PX = 16;

function rootPx(name, css = readCss()) {
  const m = css.match(/^:root \{[\s\S]*?\n\}/m);
  const decl = m && m[0].match(new RegExp('\\n\\s*' + name + ':\\s*([\\d.]+)(px|rem);'));
  if (!decl) {
    throw new Error(name + ' not found as a px or rem value in the :root block of styles.css');
  }
  return parseFloat(decl[1]) * (decl[2] === 'rem' ? WURZEL_PX : 1);
}

// The two floors the whole redesign is measured against. Named rather than
// spelled out at each call site, because "13" and "56" appearing bare in three
// scripts is how the tokens and the tools drift apart.
const floor = (css) => rootPx('--fs-xs', css === undefined ? readCss() : css);
const tapFloor = (css) => rootPx('--tap-min', css === undefined ? readCss() : css);

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

// The root font size a media query resolves `em` against. Always the browser's
// default, never `:root{font-size:…}` — that is what makes an em-based
// breakpoint move when someone enlarges text in their browser settings, which
// is the whole point of the P1.5 work in the responsive plan.
const ROOT_PX = 16;

// Every width at which the cascade switches, read from the file rather than
// typed into a tool.
//
// This is the tracker's half of a pair. The shop has the same reader in
// neubau/theme-pruefung/mobil/grenzen.mjs in the private repo, and the two are
// deliberately NOT one file: this repo is public and that one is not, so there
// is no module they could share. They are twins, not a copy with a copy's
// excuse — when one learns a new spelling, teach the other.
//
// Why it exists: both mobile rounds measured a hand-typed list of widths, and
// both lists were missing the band where the app actually breaks. A list knows
// nothing about an @media rule somebody adds tomorrow. This does.
function breakpoints(css = readCss()) {
  const src = maskedCss(css).src;
  const found = new Map();
  const nonWidth = new Map();
  const toPx = (n, unit) => (unit === 'em' || unit === 'rem' ? n * ROOT_PX : n);

  for (const m of src.matchAll(/@(media|container)([^{]*)\{/g)) {
    const axis = m[1] === 'container' ? 'container' : 'viewport';
    const cond = m[2];
    const add = (px, from) => {
      const key = axis + ':' + Math.round(px);
      if (!found.has(key)) found.set(key, { px: Math.round(px), axis, from: new Set(), count: 0 });
      found.get(key).from.add(from);
      found.get(key).count++;
    };
    for (const b of cond.matchAll(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)?\s*\)/gi)) {
      add(toPx(parseFloat(b[2]), (b[3] || 'px').toLowerCase()), b[1] + '-width');
    }
    // Range syntax names two bounds in `(400px <= width <= 800px)`, so it takes
    // two passes: one expression would consume the word `width` on the first
    // match and never see the second.
    for (const b of cond.matchAll(/([\d.]+)(px|em|rem)?\s*[<>]=?\s*width/gi)) {
      add(toPx(parseFloat(b[1]), (b[2] || 'px').toLowerCase()), 'range');
    }
    for (const b of cond.matchAll(/width\s*[<>]?=?\s*([\d.]+)(px|em|rem)?/gi)) {
      add(toPx(parseFloat(b[1]), (b[2] || 'px').toLowerCase()), 'range');
    }
    // Conditions that switch the cascade without being a width do not vanish
    // silently; a stand that only knows widths would report them as absent.
    for (const b of cond.matchAll(
      /\(\s*(orientation|pointer|hover|any-pointer|any-hover|min-height|max-height|prefers-[a-z-]+|forced-colors|display-mode)\s*:\s*([^)]+)\)/gi
    )) {
      nonWidth.set(b[1].toLowerCase() + ':' + b[2].trim(), { feature: b[1].toLowerCase(), value: b[2].trim() });
    }
  }
  const list = [...found.values()]
    .map((g) => ({ px: g.px, axis: g.axis, count: g.count, from: [...g.from].sort() }))
    .sort((a, b) => a.px - b.px || a.axis.localeCompare(b.axis));
  return { list, nonWidth: [...nonWidth.values()] };
}

// The widths to measure: a RANGE, plus G-1, G, G+1 around every breakpoint.
//
// The range catches what goes wrong between the breakpoints, which is where the
// shop's header sat on two lines for two hundred pixels with no @media rule in
// sight. The triples catch what goes wrong exactly at the switch: a rule that
// applies at G and is never taken back at G+1 is invisible from one side.
// `from` and `to` bound the SWEEP, never the triples. A breakpoint is worth
// measuring because the stylesheet switches there, not because it happens to
// fall inside a range somebody typed. The first version clamped the triples to
// from..to as well, so `@media (min-width: 2000px)` contributed no width AND
// reported no gap: the gate printed its all-clear for precisely the breakpoint
// nobody had opened a window at. Both halves of that came from the same guard,
// which is why it read as consistent.
function widthBand(list, { from = 320, to = 1920, step = 20 } = {}) {
  const out = new Set();
  for (let w = from; w <= to; w += step) out.add(w);
  out.add(to);
  for (const g of list) {
    if (g.axis !== 'viewport') continue; // a container breakpoint is not a window width
    for (const w of [g.px - 1, g.px, g.px + 1]) if (w >= 1) out.add(w);
  }
  return [...out].sort((a, b) => a - b);
}

// The gate. Not "the list looks complete" but "name the breakpoint it misses".
// No range filter here either, for the same reason.
function uncovered(list, widths) {
  const have = new Set(widths);
  const gaps = [];
  for (const g of list) {
    if (g.axis !== 'viewport') continue;
    const missing = [g.px - 1, g.px, g.px + 1].filter((w) => w >= 1 && !have.has(w));
    if (missing.length) gaps.push({ px: g.px, missing, from: g.from });
  }
  return gaps;
}

// The input axis, and it is independent of width — a graphics tablet is coarse
// and wide, a phone in landscape is coarse and 844px, a window on a desktop is
// fine and 380px. The floors differ because the finger and the mouse differ:
// 24px is WCAG 2.5.8 Target Size (Minimum), level AA, and applies to every
// pointer; 44px is Apple's HIG, WCAG 2.5.5 level AAA, and Material's 48dp.
const POINTERS = [
  { name: 'fine', pointer: 'fine', hover: 'hover', tapFloor: 24 },
  { name: 'coarse', pointer: 'coarse', hover: 'none', tapFloor: 44 }
];

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
//
// Newlines survive the blanking too, and that is not a detail. The first
// version wrote `' '.repeat(s.length)`, which preserves the byte count and
// destroys the line count — a multi-line comment collapsed into one very long
// line, and every DECLARED line number after the first block comment pointed
// somewhere else in the file. `--list` was confidently sending people to the
// wrong rule.
// The same blanking, for source files rather than the stylesheet: a `<style>`
// block emitted into a print window is CSS, not an inline style. Its rules
// land on paper, where the phone floor means nothing and where the §6 bridge —
// an attribute selector — could never have reached them anyway. Counting them
// as inline debt asks for a fix that would be wrong to make.
//
// Blanked rather than deleted, so a reported line number is still the real one.
function maskedSource(src) {
  return src.replace(/<style>[\s\S]*?<\/style>/g, (s) => s.replace(/[^\n]/g, ' '));
}

function maskedCss(css = readCss()) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  const src = css.replace(/\/\*[\s\S]*?\*\//g, blank);
  return { src, scan: src.replace(/\[[^\]]*\]/g, blank) };
}

module.exports = {
  ROOT,
  CSS_PATH,
  readCss,
  rootPx,
  floor,
  tapFloor,
  subFloorSizes,
  blocks,
  MAX_WIDTH_BLOCK,
  PHONE_BLOCK,
  MEDIA_BLOCK,
  ROOT_PX,
  POINTERS,
  breakpoints,
  widthBand,
  uncovered,
  outsideMedia,
  maskedCss,
  maskedSource
};
