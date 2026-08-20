'use strict';
// The scan log's ✕ button, and the timestamp that reached it.
//
// validateScanEntries pins the charset of batch, bag, from and to, and says in
// its own comment that it does so "to prevent stored XSS via raw rendering in
// the client". time was not on that list — it was only asked whether
// `new Date()` could read it. That is a much wider door than it looks: V8's
// legacy date parser ignores a trailing parenthesised group, so
//
//     Aug 19 2099 12:00:00 GMT+0000 (' + fetch('/api/users', …) + ')
//
// is a *valid* date. It was stored verbatim and then pasted into an inline
// onclick, where esc() cannot help — inside an attribute the HTML parser turns
// &#39; back into ' before the JavaScript is compiled, so the escaping is undone
// a moment before it would have mattered. A role-`user` worker could POST that
// entry; the admin who opened Settings and clicked the ✕ ran it in their own
// session, and POST /api/users takes `role` verbatim.
//
// Two things had to be true for that to work, so both are held here: the server
// must store the value it was handed, and the client must compile a handler out
// of the row. Either alone closes it; the test keeps both shut, because the
// charset pin already proves that a list of fields is the kind of thing that
// gets forgotten.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// The payload, kept in one place so both halves are tested against the same
// string rather than against two convenient variants of it.
const ANGRIFF = "Aug 19 2099 12:00:00 GMT+0000 (' + (globalThis.__pwned = 1) + ')";

/** Lift validateScanEntries (and the constants it reads) out of server.js. */
const validateScanEntries = (() => {
  const teile = [
    [/^const ID_CHARSET_RE = .*$/m, 'ID_CHARSET_RE'],
    [/^const SCAN_ACTIONS = .*$/m, 'SCAN_ACTIONS'],
    [/^function validateScanEntries\(entries\) \{[\s\S]*?\n\}/m, 'validateScanEntries()']
  ].map(([re, was]) => {
    const m = SERVER.match(re);
    assert.ok(m, was + ' no longer matches — the test lifts it out of server.js by shape');
    return m[0];
  });
  return new Function(teile.join('\n') + '\nreturn validateScanEntries;')();
})();

describe('scan log: the stored timestamp', () => {
  it('is rewritten to ISO, so a date-shaped payload cannot survive being stored', () => {
    // Deliberately asserted first: if V8 ever stops accepting this string the
    // premise of the whole test is gone, and a green run would mean nothing.
    assert.ok(!isNaN(new Date(ANGRIFF).getTime()), 'premise: V8 still reads the payload as a date');

    const entries = [{ action: 'ADD', time: ANGRIFF, batch: 'B-1' }];
    assert.equal(validateScanEntries(entries), null, 'a valid date is still accepted');
    assert.equal(entries[0].time, '2099-08-19T12:00:00.000Z');
    assert.ok(!entries[0].time.includes("'"), 'no quote survives into the stored row');
    assert.ok(!entries[0].time.includes('('), 'no call syntax survives into the stored row');
  });

  it('leaves an ordinary client timestamp untouched', () => {
    const iso = '2026-08-19T12:34:56.000Z';
    const entries = [{ action: 'MOVE', time: iso, bag: 'BAG-1' }];
    assert.equal(validateScanEntries(entries), null);
    assert.equal(entries[0].time, iso, 'what real clients send must round-trip unchanged');
  });

  it('still refuses something that is not a date at all', () => {
    assert.match(validateScanEntries([{ action: 'ADD', time: 'nonsense' }]), /time must be an ISO timestamp/);
  });
});

describe('scan log: the ✕ button', () => {
  // The row template, lifted and rendered with a hostile value, then read the
  // way a browser reads it: entities decoded, attributes inspected.
  const knopf = (e) => {
    const esc = (s) =>
      s == null
        ? ''
        : String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    // Anchored on the two classes that carry a contract — btn-xs for the size
    // rules, lg-del for the delegated listener above — and tolerant of the rest
    // of the list. Pinning the full class string made this fail the moment the
    // mobile branch added .fs-micro to the button, which is a presentation
    // change this test has no opinion about.
    const m = APP.match(/\$\{isRecent \? ('<button class="btn-xs lg-del[^"]*"[\s\S]*?) : ''\}/);
    assert.ok(m, 'the ✕ button template no longer matches — has the row been rebuilt?');
    return new Function('e', 'esc', 't', 'return ' + m[1] + ';')(e, esc, () => 'Löschen');
  };

  it('carries no attribute the browser would compile, however hostile the value', () => {
    const html = knopf({ time: ANGRIFF, batch: 'B-1', action: 'ADD', bag: '' });
    assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no on*= handler on the button: ' + html);
    assert.ok(html.includes('data-time="'), 'the value travels as data');
  });

  it('hands the payload back as a plain string once the entities are decoded', () => {
    const html = knopf({ time: ANGRIFF, batch: 'B-1', action: 'ADD', bag: '' });
    // What the parser does to attribute values before anything else sees them.
    const decoded = html
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const wert = decoded.match(/data-time="([^"]*)"/);
    assert.ok(wert, 'data-time survives decoding as one attribute');
    assert.equal(wert[1], ANGRIFF, 'the value arrives whole — as data, not as syntax');
    assert.ok(!decoded.includes('onclick'), 'and nothing turned back into a handler');
  });

  it('reaches deleteLogEntry through a delegated listener, not through markup', () => {
    assert.ok(
      /body\.addEventListener\('click'[\s\S]{0,400}?deleteLogEntry\(btn, btn\.dataset\.time/.test(APP),
      'the delegated listener is what calls deleteLogEntry'
    );
    assert.ok(
      !/onclick="deleteLogEntry/.test(APP) && !/onclick=\\"deleteLogEntry/.test(APP),
      'no inline onclick may build a call out of row data again'
    );
  });
});
