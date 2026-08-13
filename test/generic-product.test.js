'use strict';
// The operating company's name must not appear in the product source.
//
// Why this is worth a test: Meistertracker is meant to run other people's labs.
// A stray operator name is not a cosmetic blemish — it is the difference
// between a product and one company's in-house tool. It reaches other labs in
// ways nobody reviews: printed on their barcode sheets, in the calendar URL
// they type into Thunderbird, in the filename of their backup.
//
// It also erodes quietly. Nobody adds "Meisterpilze" to a file on purpose; it
// arrives in a hurry, in a string that seemed local, and the next reader takes
// it as precedent. A grep in CI is the cheapest thing that keeps that from
// happening, which is exactly the bet i18n.test.js already makes for
// translation keys.
//
// ── The exception, and why it is written out rather than budgeted ────────────
//
// server.js still carries the name in one place: the CalDAV layer. That is not
// laziness, it is compatibility. The string is simultaneously
//
//   * a directory name on disk (data/caldav/meisterpilze/),
//   * a path segment in the URL every calendar client has already subscribed
//     to (/caldav/calendars/meisterpilze/),
//   * a permission boundary ("only admins may delete from the shared
//     calendar"),
//   * the PRODID that the sync pass uses to recognise its own .ics files, and
//   * the UID domain of every event ever written.
//
// Renaming it is a data migration, not an edit: existing subscriptions break,
// and any file whose PRODID no longer matches is orphaned on disk forever.
// That deserves its own change with its own migration, not a drive-by rename.
//
// So the rule here is not a budget ("at most N hits"), which would quietly
// absorb the next unrelated slip. Every surviving line must match one of the
// documented CalDAV categories below. A new occurrence of any other shape
// fails, in server.js as much as anywhere else.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OPERATOR = /meisterpilze/i;

// Files that make up the product. Docs, LICENSE and NOTICE are excluded on
// purpose: a copyright line naming the company is correct and required.
const PRODUCT_FILES = [
  'app.js',
  'channels.js',
  'db.js',
  'harvest-feed.js',
  'login.js',
  'mcp-server.js',
  'shipping.js',
  'sw.js'
];

// The surviving occurrences, each an identifier a client has already stored.
// The dividing line is deliberate: anything the client merely *displays* has
// been cleaned, because changing it costs nothing. Anything the client stores
// and sends back is left alone, because changing it has a protocol cost —
// re-prompting for credentials, or forcing a full resync — and that belongs in
// a migration that says so, not in a rename.
const CALDAV_EXCEPTIONS = [
  { why: 'PRODID: also the marker the sync pass recognises its own files by', re: /PRODID:-\/\/Meisterpilze/ },
  { why: 'custom iCalendar property name, read back when reconciling', re: /X-MEISTERPILZE-/ },
  { why: 'UID domain of every event already written to a client', re: /@meisterpilze/ },
  // The slug appears quoted in comparisons and bare as an object key; both are
  // the same on-disk directory and URL segment.
  { why: 'shared calendar slug: directory name, URL segment and permission boundary', re: /'meisterpilze'/ },
  { why: 'shared calendar slug as an object key', re: /^meisterpilze:/ },
  { why: 'HTTP auth realm — clients key stored credentials by it', re: /realm="Meisterpilze CalDAV"/ },
  {
    why: 'sync-token namespace — an opaque value clients store and send back',
    re: /sync-token>http:\/\/meisterpilze\//
  },
  { why: 'PM2 process name default, overridable via PM2_PROCESS_NAME', re: /PM2_PROCESS_NAME/ },
  { why: 'comment naming the shared calendar', re: /^\s*\/\// }
];

function linesWithOperator(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (OPERATOR.test(line)) out.push({ n: i + 1, line: line.trim() });
  });
  return out;
}

describe('the product carries no operator name', () => {
  for (const file of PRODUCT_FILES) {
    it(file + ' names no operating company', () => {
      const hits = linesWithOperator(file);
      assert.deepEqual(
        hits.map((h) => file + ':' + h.n + '  ' + h.line),
        [],
        'another lab runs this code — see the header of this file'
      );
    });
  }

  it('server.js names one only where CalDAV compatibility forces it', () => {
    const unexplained = linesWithOperator('server.js').filter((h) => !CALDAV_EXCEPTIONS.some((e) => e.re.test(h.line)));
    assert.deepEqual(
      unexplained.map((h) => 'server.js:' + h.n + '  ' + h.line),
      [],
      'this shape is not one of the documented CalDAV identifiers — see the header of this file'
    );
  });

  // Guards the guard: if the CalDAV debt is ever actually paid off, the
  // exception list should be deleted rather than left lying around looking
  // like permission.
  it('still needs its CalDAV exception, or this test is out of date', () => {
    assert.notEqual(
      linesWithOperator('server.js').length,
      0,
      'server.js is clean now — delete CALDAV_EXCEPTIONS and this test with it'
    );
  });
});
