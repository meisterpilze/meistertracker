'use strict';
// Two names that were never defined, and two rows that said the wrong thing.
//
// `var(--c-accent)` appears fifteen times across three files and `--c-card`
// twice, and neither has ever had a value. That is not a cosmetic slip. An
// undefined custom property makes the whole declaration invalid at
// computed-value time, so the property falls back to the *inherited* value if
// it is an inherited one and the *initial* value otherwise — which means
// `background: var(--c-accent)` computes to `transparent`, not to some
// reasonable green. The substrate progress bar was drawing an empty bar, the
// "open" status pill was drawing white text on nothing, and today's date in the
// calendar was rendering in the same colour as every other day.
//
// Nothing catches this. It is valid CSS, it is valid JavaScript, the browser
// logs nothing, and a screenshot of a mostly-empty progress bar looks like a
// progress bar at 0%. So the first test here is the general one: every var()
// in the app resolves to something, either a definition or its own fallback.
//
// The other two are the rows. `setLocFb` wrote `scan-toast` onto the element
// that `setFb` writes `scan-toast-inline` onto — and only the latter is a class
// this sheet defines, so the move confirmation lost its skin *and* its
// `display:none`, which is what hides it again five seconds later. And
// `_rhythmTaskRowHtml` never learned the `urgent` class when the colour moved
// from the species to the state, so a carried-over task drew a neutral stripe
// beside an identical task-list row drawing red.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

describe('every custom property the app reads has a value', () => {
  // A property counts as defined if anything anywhere writes it — the :root
  // block, a rule further down, an inline style attribute, or setProperty at
  // runtime. The point is not where it is set, only that it is.
  const defined = new Set();
  for (const src of [CSS, APP, HTML]) {
    for (const m of src.matchAll(/(--[A-Za-z][\w-]*)\s*:/g)) defined.add(m[1]);
    for (const m of src.matchAll(/setProperty\(\s*['"](--[\w-]+)['"]/g)) defined.add(m[1]);
  }

  const files = [
    ['styles.css', CSS],
    ['app.js', APP],
    ['index.html', HTML]
  ];

  it('no var() is left dangling without a fallback', () => {
    const dangling = [];
    for (const [name, src] of files) {
      // The character after the property name tells us which it is: a comma
      // opens a fallback, a closing paren means there is none.
      for (const m of src.matchAll(/var\(\s*(--[A-Za-z][\w-]*)\s*([,)])/g)) {
        if (m[2] === ',') continue; // has a fallback, cannot break
        if (defined.has(m[1])) continue;
        dangling.push(name + ':' + src.slice(0, m.index).split('\n').length + '  var(' + m[1] + ')');
      }
    }
    assert.deepEqual(
      dangling,
      [],
      'these read a custom property that is never set, and no fallback catches it — ' +
        'the declaration is dropped and the property takes its initial value:\n  ' +
        dangling.join('\n  ')
    );
  });

  it('--c-accent and --c-card in particular, since those are the two that were missing', () => {
    for (const token of ['--c-accent', '--c-card']) {
      assert.ok(defined.has(token), token + ' is read by the app but defined nowhere');
    }
  });
});

describe('the scan toast wears the class the stylesheet actually defines', () => {
  // The base class carries the padding, the border, the colour and — the part
  // that bites — `display:none`. `.visible` only un-hides it in combination
  // with the base class, so getting the base name wrong breaks showing it and
  // hiding it in the same stroke.
  const BASE = 'scan-toast-inline';

  it('the stylesheet defines that class, and does not define the other one', () => {
    assert.match(CSS, new RegExp('\\.' + BASE + '\\s*\\{'), BASE + ' is not a class this sheet styles');
    assert.match(CSS, new RegExp('\\.' + BASE + '\\.visible\\s*\\{'), 'nothing un-hides the toast');
    assert.equal(
      /\.scan-toast\s*\{/.test(CSS),
      false,
      '.scan-toast is styled now — if it has become real, this test is the thing to update'
    );
  });

  it('both writers of #scan-toast use it', () => {
    const writers = [...APP.matchAll(/el\.className\s*=\s*'([^']*)'/g)]
      .map((m) => m[1])
      .filter((v) => v.includes('scan-toast'));
    assert.ok(writers.length >= 2, 'expected setFb and setLocFb to both write the toast class');
    for (const w of writers) {
      assert.ok(
        w.split(/\s+/).includes(BASE),
        'a writer sets className to "' + w + '", which drops ' + BASE + ' and with it every rule that styles the toast'
      );
    }
  });

  it('the undo button inside it is translated, not a hardcoded English word', () => {
    const fn = APP.match(/function setLocFb\(msg\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'setLocFb has moved');
    assert.equal(/>Undo</.test(fn[0]), false, 'the undo label is hardcoded English');
    assert.match(fn[0], /t\('dash\.undo'\)/);
  });
});

describe('a late row says late, in both places that draw one', () => {
  // Lifted and run rather than pattern-matched: what matters is the class the
  // function actually emits for a carried-over task, not that the word
  // "urgent" appears somewhere in its source.
  function runRhythmRow(late) {
    const src = APP.match(/function _rhythmTaskRowHtml\(task, outstanding\) \{[\s\S]*?\n\}/);
    assert.ok(src, '_rhythmTaskRowHtml has moved');
    const fn = new Function(
      'mushroomStrains',
      't',
      'fmtDt',
      'weekThemeLabel',
      '_rhythmTargetBtn',
      'esc',
      'spColor',
      // Die Zeile zaehlt jetzt selbst, was gemacht wurde; hier interessiert nur
      // der Streifen, also liefert die Attrappe eine feste Zahl.
      'rhythmMadeOn',
      src[0] + '\nreturn _rhythmTaskRowHtml;'
    )(
      [],
      (k) => k,
      () => '01.01.',
      () => 'theme',
      () => '<button></button>',
      (s) => String(s == null ? '' : s),
      () => '#000000',
      () => 0
    );
    return fn({ date: '2026-08-21', targetQty: 4, doneQty: 0, theme: 'x', planned: false }, late ? 2 : 0);
  }

  it('carried over from an earlier day: the urgent stripe', () => {
    const html = runRhythmRow(true);
    assert.match(html, /class="todo-row urgent"/, 'a late rhythm task drew the neutral stripe');
  });

  it('nothing outstanding: the plain row', () => {
    const html = runRhythmRow(false);
    assert.match(html, /class="todo-row"/);
    assert.equal(/urgent/.test(html), false, 'an on-time task was marked urgent');
  });

  it('it no longer writes the species colour into a property nothing reads', () => {
    // --sp-color was how this row used to be coloured. The rule that read it
    // went when the stripe started meaning the state; the write stayed behind.
    // A write is `--sp-color:`, a read is `var(--sp-color)`. Matching the bare
    // name would match this comment, and the one in app.js explaining the same
    // thing — prose about a dead property is not the property coming back.
    const written = (src) => /--sp-color\s*:/.test(src);
    const read = (src) => /var\(\s*--sp-color/.test(src);
    assert.equal(read(CSS) || read(APP), false, 'if a rule reads --sp-color again, this test is the thing to update');
    assert.equal(written(APP) || written(CSS), false, 'something still sets --sp-color, which no rule reads');
  });
});
