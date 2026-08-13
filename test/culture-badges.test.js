'use strict';
// Culture badges escape what they render.
//
// `ctBadge`/`csBadge` build a `<span>` from two things: a CSS class looked up
// in a fixed map, and the value itself. The class is safe by construction — an
// unknown key yields ''. The value is not: it comes from the cultures table,
// and both badges are dropped into the page with innerHTML.
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

/** Lift `esc` and the two badge builders out of app.js and make them callable. */
function loadBadges() {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const grab = (re, what) => {
    const m = src.match(re);
    assert.ok(m, 'could not find ' + what + ' in app.js — has it been renamed?');
    return m[0];
  };
  const escSrc = grab(/function esc\(s\) \{[\s\S]*?\n\}/, 'esc()');
  const ctSrc = grab(/const ctBadge = \(t\) => \{[\s\S]*?\n\};/, 'ctBadge');
  const csSrc = grab(/const csBadge = \(s\) => \{[\s\S]*?\n\};/, 'csBadge');
  return new Function(escSrc + '\n' + ctSrc + '\n' + csSrc + '\nreturn { esc, ctBadge, csBadge };')();
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

  it('csBadge does not let a culture status open a tag', () => {
    const html = badges.csBadge(PAYLOAD);
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
    assert.equal(badges.csBadge('active'), '<span class="badge badge-active">active</span>');
  });

  it('renders an unknown-but-harmless value with an empty class', () => {
    assert.equal(badges.ctBadge('GS'), '<span class="badge ">GS</span>');
  });
});

describe('the server pins culture type and status', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  // GS is a real type in db.js's VALID_CULTURE_PARENT_TYPES. The MCP tool's
  // enum lists only four; validating HTTP writes against that shorter list
  // would start rejecting cultures a lab already has on its shelves.
  it("accepts all five types db.js knows, not the MCP tool's four", () => {
    const m = src.match(/const CULTURE_TYPES = \[([^\]]*)\]/);
    assert.ok(m, 'CULTURE_TYPES is gone from server.js');
    const types = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    assert.deepEqual(types.sort(), ['G2G', 'GS', 'LC', 'MC', 'PD']);
  });

  it('validates both fields on the cultures write path', () => {
    assert.match(src, /validateEnum\(c\.type, CULTURE_TYPES/);
    assert.match(src, /validateEnum\(c\.status, CULTURE_STATUSES/);
  });
});
