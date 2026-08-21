'use strict';
// White text on a coloured fill, everywhere the app does it.
//
// The palette gives each family five steps — light, border, accent, mid, dark —
// and not one of them is a surface you can put white text on. The mid tones are
// 3.8:1 (red) and 2.2:1 (amber) against white; the -dark tones carry white
// comfortably but are heavy enough on a small control to read as disabled. So
// every author who needed a filled button picked a one-off, and the two guesses
// that got used most did not agree: #dc2626 clears 4.5:1, #ea580c reads 3.56.
//
// The "View" button on every non-urgent attention alert was the visible cost —
// 11px white on #ea580c on a desktop. Same class of defect as the KPI values in
// test/kpi-kontrast.test.js, and invisible for the same reason: it is a colour
// somebody chose on purpose, so nothing about it looks like a mistake.
//
// This file is the general guard. It finds every place the source puts white
// text on a known fill, resolves tokens to their values, and computes the
// ratio. New pairings have to clear 4.5:1.
//
// KNOWN is the honest part. Thirteen of the failures are a single token —
// --c-primary at 3.30:1, the brand green under every primary button — and four
// more are --c-red. Changing either is a brand decision with app-wide visual
// consequences, not a bug fix, so they are listed rather than quietly tolerated
// or silently changed. The list may shrink; it must never grow.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const TOKEN = new Map();
{
  const root = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')));
  for (const m of root.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) TOKEN.set(m[1], m[2].toLowerCase());
}

function relLum(hex) {
  const c = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const x = parseInt(c.substr(i, 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a, b) => (Math.max(relLum(a), relLum(b)) + 0.05) / (Math.min(relLum(a), relLum(b)) + 0.05);

/** A literal, or a token resolved to its value. Null when neither. */
function resolve(raw) {
  const v = raw.match(/var\((--[\w-]+)/);
  if (v) return TOKEN.get(v[1]) || null;
  const h = raw.match(/#[0-9a-fA-F]{6}/);
  return h ? h[0].toLowerCase() : null;
}

/** Fills that carry white text, as (file, line, colour). */
function whiteOnColour() {
  const out = [];
  for (const file of ['app.js', 'index.html', 'styles.css']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const re =
      /background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6}|var\(--[\w-]+\))[^;"'`]*;?[^;"'`]{0,120}?color\s*:\s*(?:#fff\b|#ffffff\b|white\b)/gi;
    for (const m of src.matchAll(re)) {
      const bg = resolve(m[1]);
      if (!bg) continue;
      out.push({ file, line: src.slice(0, m.index).split('\n').length, bg });
    }
  }
  return out;
}

// The brand pairings that fail today. Keyed by colour, with the count so a new
// site using the same colour is caught too. The list may shrink; it must never
// grow — and it has shrunk once already: #16a34a was the biggest entry at 13
// sites and 3.30:1, and --c-primary moved one step down its own green to the
// value that was already its hover. Nothing here is tolerated on purpose; each
// is a brand colour whose change is a design decision rather than a fix.
const KNOWN = new Map([
  ['#ef4444', 4], // --c-red      3.76:1
  ['#3b82f6', 1], // --c-blue     3.68:1
  ['#6366f1', 1] //  --c-indigo   4.47:1 — a rounding error away, but under
]);

const FLOOR = 4.5;

describe('white text on a coloured fill', () => {
  const all = whiteOnColour();

  it('finds the pairings at all — the scan still matches the source', () => {
    assert.ok(all.length > 20, 'the scan found only ' + all.length + ' pairings; the pattern has stopped matching');
  });

  it('no colour outside the known brand set is below ' + FLOOR + ':1', () => {
    const bad = all
      .filter((p) => contrast('#ffffff', p.bg) < FLOOR)
      .filter((p) => !KNOWN.has(p.bg))
      .map((p) => p.file + ':' + p.line + '  white on ' + p.bg + '  ' + contrast('#ffffff', p.bg).toFixed(2) + ':1');
    assert.deepEqual(bad, [], 'white text on a fill too light to carry it:\n  ' + bad.join('\n  '));
  });

  it('the known brand failures have not spread', () => {
    const counted = new Map();
    for (const p of all) {
      if (!KNOWN.has(p.bg)) continue;
      counted.set(p.bg, (counted.get(p.bg) || 0) + 1);
    }
    const grown = [];
    for (const [hex, cap] of KNOWN) {
      const n = counted.get(hex) || 0;
      if (n > cap) grown.push(hex + ': ' + n + ' sites, was ' + cap);
    }
    assert.deepEqual(grown, [], 'a known-failing brand colour gained new white-text sites:\n  ' + grown.join('\n  '));
  });

  it('the strong step carries white text, which is the whole reason it exists', () => {
    for (const t of ['--c-red-strong', '--c-amber-strong']) {
      const hex = TOKEN.get(t);
      assert.ok(hex, t + ' is not defined');
      const ratio = contrast('#ffffff', hex);
      assert.ok(ratio >= FLOOR, t + ' is ' + ratio.toFixed(2) + ':1 against white — it cannot carry a white label');
    }
  });

  it('#ea580c no longer sits under a white label anywhere', () => {
    const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    assert.equal(
      /#ea580c[^;"'`]*;?[^;"'`]{0,60}?color\s*:\s*#fff/i.test(app),
      false,
      '#ea580c is 3.56:1 against white — use var(--c-amber-strong)'
    );
  });
});
