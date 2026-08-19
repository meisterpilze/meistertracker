// Ratchet for the two debts the mobile redesign has to pay down.
//
// Both counts are allowed to fall and never to rise. That is the same trick
// `npm run lint --max-warnings 73` already plays in this repo: you cannot fix
// 495 things in one commit, but you can guarantee nobody adds the 496th.
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

const ROOT = path.resolve(__dirname, '..');
const SELF = path.relative(ROOT, __filename);
const FLOOR = 13; // --fs-xs

// Lower these as phases land. Never raise them.
const CEILING = { inline: 495, declared: 11 };

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function inlineHits() {
  const hits = [];
  for (const file of ['index.html', 'app.js']) {
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      // index.html writes `font-size: 12px`, app.js writes `font-size:12px`.
      for (const m of line.matchAll(/font-size:\s*([\d.]+)px/g)) {
        if (parseFloat(m[1]) < FLOOR) hits.push({ file, line: i + 1, text: m[0] });
      }
    });
  }
  return hits;
}

function declaredHits() {
  const raw = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  // Blank out comments and attribute selectors but keep the byte offsets, so a
  // reported line number still points at the real line in the real file.
  const blank = (s) => ' '.repeat(s.length);
  const src = stripComments(raw).length === raw.length ? raw : raw.replace(/\/\*[\s\S]*?\*\//g, blank);
  const scan = src.replace(/\[[^\]]*\]/g, blank);

  const hits = [];
  for (const m of scan.matchAll(/@media[^{]*max-width[^{]*\{/g)) {
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < scan.length && depth) {
      if (scan[i] === '{') depth++;
      else if (scan[i] === '}') depth--;
      i++;
    }
    for (const f of scan.slice(start, i).matchAll(/font-size:\s*([\d.]+)px/g)) {
      if (parseFloat(f[1]) >= FLOOR) continue;
      const at = start + f.index;
      hits.push({ file: 'styles.css', line: src.slice(0, at).split('\n').length, text: f[0] });
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
  const src = fs.readFileSync(__filename, 'utf8').replace(
    /const CEILING = \{ inline: \d+, declared: \d+ \};/,
    `const CEILING = { inline: ${counts.inline}, declared: ${counts.declared} };`
  );
  fs.writeFileSync(__filename, src);
  console.log(`\n✓ ceilings lowered to inline: ${counts.inline}, declared: ${counts.declared} — commit ${SELF}`);
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
