'use strict';
// Whether a control is actually big enough to hit with a thumb.
//
// §5.1 of MOBILE_REDESIGN.md set the floor and the token layer delivered it:
// --tap is 56px on a phone and `auto` on a desk, --tap-sm is 48px. What was
// never built is the half that keeps it true. scripts/mobile-audit.js ratchets
// *font sizes* — inline, declared and base — and test/mobile-tokens.test.js
// checks the tokens are declared and paired. Neither can see whether a control
// ends up with a height at all.
//
// So only the buttons somebody remembered to give a class consumed the floor:
// .btn, .stab, .sb-btn, the bottom nav. Twenty-five did not, and came out at
// whatever their padding made — the Woche/Monat/Jahr toggle at roughly 28px,
// "alles gelesen" at 20px, the pack-size delete at 20px, seven with no class at
// all that nothing could even address.
//
// The fix is a base rule on `button` rather than twenty-five patches, so this
// file guards the two ways that rule can be defeated: something removing it,
// and something outranking it with a smaller number. `button` is (0,0,1), so
// every class in the sheet outranks it by design — that is what lets .btn keep
// its 56px — which is exactly why a class that sets a *smaller* min-height
// silently wins and has to be caught here.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const WCAG_AAA = 44;

/** Every (selector, own declarations) pair, at any @-nesting depth. */
function rules(src) {
  const out = [];
  const stack = [];
  let sel = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      stack.push({ sel: sel.trim().replace(/\s+/g, ' '), start: i + 1 });
      sel = '';
    } else if (ch === '}') {
      const f = stack.pop();
      if (f && !f.sel.startsWith('@')) out.push({ sel: f.sel, body: src.slice(f.start, i), at: f.start });
      sel = '';
    } else {
      sel += ch;
      i++;
      continue;
    }
    i++;
  }
  return out;
}

const ownDecls = (body) => body.replace(/\{[^{}]*\}/g, '');
const lineOf = (i) => CSS.slice(0, i).split('\n').length;

/** Class names that sit on a <button> somewhere in the markup. */
function buttonClasses() {
  const set = new Set();
  for (const src of [HTML, APP]) {
    for (const m of src.matchAll(/<button\b([^>]*)>/g)) {
      const cls = (m[1].match(/class\s*=\s*["'`]([^"'`]*)/) || [])[1] || '';
      for (const c of cls.split(/\s+/).filter(Boolean)) set.add(c.replace(/\$\{[\s\S]*/, ''));
    }
  }
  return set;
}

describe('the touch floor', () => {
  it('there is a base rule on `button`, and it reads a --tap token', () => {
    const base = rules(CSS).filter((r) => r.sel === 'button');
    assert.ok(
      base.length,
      'no bare `button` rule — the floor is back to being per-class, and things will fall through'
    );
    const withFloor = base.filter((r) => /min-height\s*:\s*[^;]*--tap/.test(ownDecls(r.body)));
    assert.ok(
      withFloor.length,
      'the `button` rule no longer sets min-height from a --tap token, so nothing floors the controls that have no class of their own'
    );
  });

  it('the token it reads is the phone value, and lets the desk go free', () => {
    // --tap-sm is 48px on :root (the phone) and `auto` in the desktop override.
    // If it ever became a fixed px in both, this rule would start setting a
    // minimum height on every desktop button in the app.
    const root = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')));
    assert.match(root, /--tap-sm:\s*48px/, '--tap-sm is no longer 48px on the phone');
    const desktop = CSS.slice(CSS.indexOf('min-width: 769px'));
    assert.match(desktop.slice(0, 4000), /--tap-sm:\s*auto/, '--tap-sm no longer releases the constraint on a desk');
  });

  it('no rule that lands on a button sets a smaller minimum', () => {
    const onButtons = buttonClasses();
    const bad = [];
    for (const r of rules(CSS)) {
      const names = [...r.sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
      if (!names.some((n) => onButtons.has(n))) continue;
      for (const m of ownDecls(r.body).matchAll(/min-height\s*:\s*(\d+)px/g)) {
        if (Number(m[1]) < WCAG_AAA)
          bad.push('styles.css:' + lineOf(r.at) + '  ' + r.sel + '  min-height:' + m[1] + 'px');
      }
    }
    assert.deepEqual(bad, [], 'these outrank the base rule with a number under it:\n  ' + bad.join('\n  '));
  });

  it('no button carries an inline height under the minimum', () => {
    // An inline style beats every rule in the sheet, so this is the other way
    // the floor gets lost — and the one a reviewer is least likely to notice.
    const bad = [];
    for (const [file, src] of [
      ['index.html', HTML],
      ['app.js', APP]
    ]) {
      for (const m of src.matchAll(/<button\b([^>]*)>/g)) {
        const style = (m[1].match(/style\s*=\s*["'`]([^"'`]*)/) || [])[1] || '';
        if (/--tap/.test(style)) continue;
        for (const d of style.matchAll(/(?:^|;)\s*(min-height|height)\s*:\s*(\d+)px/g)) {
          if (Number(d[2]) < WCAG_AAA) {
            bad.push(file + ':' + src.slice(0, m.index).split('\n').length + '  ' + d[1] + ':' + d[2] + 'px');
          }
        }
      }
    }
    assert.deepEqual(bad, [], 'an inline height beats the base rule:\n  ' + bad.join('\n  '));
  });

  it('an inline tap height is written from the token, not typed as a number', () => {
    // 44 is the WCAG minimum, not this app's floor: --tap is 56 because the lab
    // works gloved. A typed 44 clears the guideline, leaves twelve pixels on the
    // table, and cannot follow the token if it moves.
    const typed = [];
    for (const [file, src] of [
      ['index.html', HTML],
      ['app.js', APP]
    ]) {
      for (const m of src.matchAll(/<button\b([^>]*)>/g)) {
        const style = (m[1].match(/style\s*=\s*["'`]([^"'`]*)/) || [])[1] || '';
        if (/--tap/.test(style)) continue;
        for (const d of style.matchAll(/(?:^|;)\s*(min-height|height)\s*:\s*(\d+)px/g)) {
          if (Number(d[2]) >= WCAG_AAA) {
            typed.push(file + ':' + src.slice(0, m.index).split('\n').length + '  ' + d[1] + ':' + d[2] + 'px');
          }
        }
      }
    }
    assert.deepEqual(typed, [], 'these hardcode a tap height instead of reading --tap:\n  ' + typed.join('\n  '));
  });
});
