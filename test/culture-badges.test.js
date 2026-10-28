'use strict';
// Culture badges escape what they render.
//
// `ctBadge` builds a `<span>` from two things: a CSS class looked up in a fixed
// map, and the value itself. The class is safe by construction — an unknown key
// yields ''. The value is not: it comes from the cultures table, and the badge
// is dropped into the page with innerHTML. The status had a badge of its own in
// the old culture table; the Kulturbibliothek that replaced it writes status
// and id as text, and is held to the same rule below.
//
// That made `type` and `status` a stored-XSS pair. POST /api/cultures pinned
// the character set of `id` and nothing else, so any logged-in worker could
// write `type: '<img src=x onerror=…>'`, and it fired the moment somebody —
// in practice an admin — opened the Lab tab. No click on the row, no
// interaction: rendering was the trigger. The CSP does not help, because
// script-src carries 'unsafe-inline' for the app's own onclick handlers.
//
// Two details that make this worth a test rather than a one-line fix and a
// shrug. `ctBadge` has a second call site in a different table, so fixing the
// view somebody happens to be looking at fixes half of it. And the type check
// that does exist, validateCultureParent, returns early when there is no
// parent — so omitting parentId skipped it entirely.
//
// These functions live in app.js, which has no module boundary, so the test
// lifts them out of the source and runs them. Same approach as
// settings-tabs.test.js: the browser is not the thing under test, the string
// the function returns is.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Lift `esc`, the badge and the library row out of app.js and make them callable. */
function loadBadges() {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const grab = (re, what) => {
    const m = src.match(re);
    assert.ok(m, 'could not find ' + what + ' in app.js — has it been renamed?');
    return m[0];
  };
  const escSrc = grab(/function esc\(s\) \{[\s\S]*?\n\}/, 'esc()');
  const ctSrc = grab(/const ctBadge = \(t\) => \{[\s\S]*?\n\};/, 'ctBadge');
  // The Sortenliste and its Kulturbibliothek description, as they stand.
  const a = src.indexOf('// ── Sortenliste ──');
  const b = src.indexOf('// ── Chargen ──', a);
  assert.ok(a > 0 && b > a, 'could not find the Sortenliste block in app.js — has it been renamed?');
  return new Function(
    escSrc +
      '\n' +
      ctSrc +
      '\nconst t = (k) => k;\nconst syMl = () => 10;\nconst cultures = [];\nconst mushroomStrains = [];\n' +
      grab(/function _spKey\(s\) \{[\s\S]*?\n\}/, '_spKey()') +
      '\n' +
      grab(/function sorteKey\(rec\) \{[\s\S]*?\n\}/, 'sorteKey()') +
      '\n' +
      src.slice(a, b) +
      '\n_slStand(SL_KULTUREN).archiv = true;' +
      '\nreturn { esc, ctBadge, kulturZeile: (c) => _slEintragHtml(SL_KULTUREN, c) };'
  )();
}

const PAYLOAD = '<img src=x onerror=alert(document.domain)>';

describe('culture badges escape their label', () => {
  let badges;
  before(() => {
    badges = loadBadges();
  });

  it('the escaping helper itself still escapes', () => {
    assert.equal(badges.esc('<a>'), '&lt;a&gt;');
  });

  it('ctBadge does not let a culture type open a tag', () => {
    const html = badges.ctBadge(PAYLOAD);
    assert.equal(html.includes('<img'), false, 'a stored culture type must not become markup');
    assert.ok(html.includes('&lt;img'), 'it should be visible as text instead');
  });

  it('a library row does not let a culture status or id open a tag', () => {
    const html = badges.kulturZeile({ id: PAYLOAD, type: 'PD', status: PAYLOAD });
    assert.equal(html.includes('<img'), false, 'a stored culture status must not become markup');
    assert.ok(html.includes('&lt;img'), 'it should be visible as text instead');
  });

  it('a quote in the value cannot escape the class attribute', () => {
    const html = badges.ctBadge('" onmouseover="alert(1)');
    assert.equal(html.includes('onmouseover="'), false);
  });

  // The badge must still do its actual job, or the fix above is just deletion.
  it('still renders the ordinary values, class and all', () => {
    assert.equal(badges.ctBadge('MC'), '<span class="badge badge-mc">MC</span>');
  });

  it('renders an unknown-but-harmless value with an empty class', () => {
    assert.equal(badges.ctBadge('GS'), '<span class="badge ">GS</span>');
  });
});

describe('the server pins culture type and status', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  // db.js decides what a culture type is; server.js only guards the HTTP write.
  // Guarding it against a shorter list rejects cultures a lab already has on its
  // shelves — which is how this test came about, GS being real in db.js and
  // absent from the MCP tool's enum.
  //
  // Derived rather than listed. A literal snapshot has to be edited every time a
  // type is added, and editing it is indistinguishable from noticing that the
  // server was never told — so it would pass while the endpoint rejects the new
  // type. Adding one to db.js and forgetting server.js now fails here.
  it('accepts every culture type db.js knows about', () => {
    const dbSrc = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
    const known = dbSrc.match(/const VALID_CULTURE_PARENT_TYPES = \{([\s\S]*?)\n\};/);
    assert.ok(known, 'VALID_CULTURE_PARENT_TYPES is gone from db.js');
    const dbTypes = [...known[1].matchAll(/^\s*([A-Z0-9]+):/gm)].map((x) => x[1]).sort();
    assert.ok(dbTypes.length >= 5, 'expected db.js to know at least the original five');

    const m = src.match(/const CULTURE_TYPES = \[([^\]]*)\]/);
    assert.ok(m, 'CULTURE_TYPES is gone from server.js');
    const serverTypes = m[1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .sort();
    assert.deepEqual(serverTypes, dbTypes, 'server.js and db.js disagree on what a culture can be');
  });

  it('validates both fields on the cultures write path', () => {
    assert.match(src, /validateEnum\(c\.type, CULTURE_TYPES/);
    assert.match(src, /validateEnum\(c\.status, CULTURE_STATUSES/);
  });
});
