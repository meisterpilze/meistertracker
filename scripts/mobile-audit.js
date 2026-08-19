// Ratchet for the two debts the mobile redesign has to pay down.
//
// Both counts are allowed to fall and never to rise, in the spirit of the
// `--max-warnings 73` on `npm run lint`: you cannot fix 495 things in one
// commit, but you can guarantee nobody adds the 496th. Unlike that flag, which
// is a hand-edited integer in package.json, --update rewrites the CEILING line
// below in place — so it verifies the rewrite instead of trusting it.
//
//   node scripts/mobile-audit.js            # check against the ceilings
//   node scripts/mobile-audit.js --list     # ...and show where the hits are
//   node scripts/mobile-audit.js --update   # lower the ceilings after a phase
//
// 1. INLINE — style="font-size:11px" in index.html / app.js. A token layer
//    cannot reach these, which is why styles.css carries a temporary bridge
//    block that lifts them at runtime. When this count hits 0, delete the
//    bridge. See MOBILE_REDESIGN.md §6.
//
// 2. DECLARED — font-size below the 13px floor inside a `max-width` block in
//    styles.css. These are the leftovers of "mobile means the same thing,
//    tighter": rules that make text smaller on the device held at arm's length.
//
// Comments and attribute selectors are excluded, so the bridge block's own
// `[style*='font-size:8px']` selectors do not count themselves.

const fs = require('fs');
const path = require('path');
const { ROOT, floor, subFloorSizes, blocks, MAX_WIDTH_BLOCK, maskedCss } = require('./mobile-size-scan.js');

const SELF = path.relative(ROOT, __filename);
const FLOOR = floor(); // --fs-xs, read from styles.css

// Lower these as phases land. Never raise them.
const CEILING = { inline: 495, declared: 11 };

function inlineHits() {
  const hits = [];
  for (const file of ['index.html', 'app.js']) {
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of subFloorSizes(line, FLOOR)) hits.push({ file, line: i + 1, text: m.text });
    });
  }
  return hits;
}

function declaredHits() {
  const { src, scan } = maskedCss();
  const hits = [];
  // Hits arrive in ascending offset order, so carry the line count forward
  // instead of re-counting newlines from byte 0 for each one.
  let scanned = 0;
  let line = 1;
  const lineAt = (offset) => {
    for (; scanned < offset; scanned++) if (src[scanned] === '\n') line++;
    return line;
  };
  for (const block of blocks(scan, MAX_WIDTH_BLOCK)) {
    for (const f of subFloorSizes(block.body, FLOOR)) {
      hits.push({ file: 'styles.css', line: lineAt(block.start + f.index), text: f.text });
    }
  }
  return hits;
}

const inline = inlineHits();
const declared = declaredHits();
const counts = { inline: inline.length, declared: declared.length };

if (process.argv.includes('--list')) {
  for (const [label, hits] of [
    ['INLINE', inline],
    ['DECLARED', declared]
  ]) {
    console.log(`\n${label} (${hits.length})`);
    hits.forEach((h) => console.log(`  ${h.file}:${h.line}  ${h.text}`));
  }
}

if (process.argv.includes('--update')) {
  const before = fs.readFileSync(__filename, 'utf8');
  const CEILING_LINE = /const CEILING = \{ inline: \d+, declared: \d+ \};/;
  // Test the pattern rather than comparing the result: the regex can quietly
  // stop matching — a reformat, a wrapped line, a trailing comment — and the
  // script would write the file back unchanged while printing that it had
  // lowered the ceilings. `scripts/` is in neither the lint nor the format npm
  // script, so nothing else guards its shape. Comparing before/after instead
  // would call a re-run at the same numbers a failure, which it is not.
  if (!CEILING_LINE.test(before)) {
    console.error(`✗ could not find the CEILING line in ${SELF} — edit it by hand, or restore its one-line shape.`);
    process.exit(1);
  }
  const after = before.replace(
    CEILING_LINE,
    `const CEILING = { inline: ${counts.inline}, declared: ${counts.declared} };`
  );
  fs.writeFileSync(__filename, after);
  // The direction is computed, not assumed. This line used to read "ceilings
  // lowered to ..." whatever it had just written, and the first time that
  // mattered it was wrong: a rebase brought five inline sizes in from main and
  // it announced a fall while raising the ceiling from 495 to 500. A ratchet
  // that reports a rise as a fall is worse than no ratchet at all.
  const moved = ['inline', 'declared']
    .map((key) => {
      const from = CEILING[key];
      const to = counts[key];
      return `${key}: ${from} ${to < from ? '↓' : to > from ? '↑ RAISED' : '='} ${to}`;
    })
    .join(', ');
  console.log(`\n✓ ${moved} — commit ${SELF}`);
  process.exit(0);
}

let failed = false;
for (const key of ['inline', 'declared']) {
  const now = counts[key];
  const max = CEILING[key];
  if (now > max) {
    console.error(`✗ ${key}: ${now} (ceiling ${max}) — ${now - max} new one(s). Run with --list to find them.`);
    failed = true;
  } else if (now < max) {
    console.log(`↓ ${key}: ${now} (ceiling ${max}) — run --update to lock the gain in.`);
  } else {
    console.log(`· ${key}: ${now} at the ceiling.`);
  }
}

if (!failed && counts.inline === 0) {
  console.log('\n✓ no inline sub-floor sizes left — delete the bridge block in styles.css.');
}
process.exit(failed ? 1 : 0);
