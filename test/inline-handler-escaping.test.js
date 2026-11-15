'use strict';
// Values the page puts into markup: bag ids, counts, clock times.
//
// The inline handlers used esc() for a JavaScript string, where the browser
// decodes the attribute before the handler runs, and a few templates put such
// values in unescaped. escJs() is for the first, esc() for the second. The
// server checks the same values on the way in (bag-ids-and-times.test.js).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle('app.js');
const escJs = new Function(hebeFunktion('escJs', APP) + '\nreturn escJs;')();

describe('escJs: a value for a quoted string in an inline handler', () => {
  const PROBEN = ['B1-01', "a'b", 'a"b', 'a\\b', 'a&#39;b', '</span>', 'Zeile\numbruch', 'Ümlaut', '\u2028', '😀', ''];

  it('reads back as the same string in JavaScript', () => {
    for (const s of PROBEN) {
      assert.equal(new Function("return '" + escJs(s) + "'")(), s, JSON.stringify(s));
    }
  });

  it('leaves nothing for the attribute decoding to turn back into a quote', () => {
    for (const s of PROBEN) {
      const out = escJs(s);
      assert.doesNotMatch(out, /["'<>&]/, JSON.stringify(s));
      assert.doesNotMatch(out.replace(/\\u[0-9a-f]{4}/g, ''), /\\/, JSON.stringify(s));
    }
  });

  it('keeps an id that is already plain as it is', () => {
    assert.equal(escJs('B-2026-11-001_A@x.y:z'), 'B-2026-11-001_A@x.y:z');
    assert.equal(escJs(null), '');
  });
});

describe('app.js: values in inline handlers and bag lists', () => {
  // Every ${…} inside an on…="…" attribute. A string goes through escJs; the
  // rest are numeric row ids and the fixed keys of MAT_LABELS.
  const OHNE_ESCJS = new Set(['s.id', 'ms.id', 'mat']);

  it('passes every string in an inline handler through escJs', () => {
    const falsch = [];
    for (const m of APP.matchAll(/\bon[a-z]+="([^"]*)"/g)) {
      for (const k of m[1].matchAll(/\$\{([^}]*)\}/g)) {
        const a = k[1].trim();
        if (!a.startsWith('escJs(') && !OHNE_ESCJS.has(a)) falsch.push(a);
      }
    }
    assert.deepEqual(falsch, []);
  });

  it('escapes the bag number in the location chips', () => {
    assert.equal(APP.includes("${bg.id.split('-').pop()}"), false);
    assert.ok(APP.includes("${esc(bg.id.split('-').pop())}"));
  });

  it('escapes the times in the week and day views', () => {
    assert.doesNotMatch(APP, /\+\s*e\.startTime\s*\+/);
    assert.doesNotMatch(APP, /' — ' \+ e\.endTime\b/);
  });

  it('escapes count and weight in the list of what a mix became', () => {
    assert.match(APP, /esc\(b\.qty\) \+\s*' × ' \+\s*esc\(b\.bagKg\)/);
  });
});
