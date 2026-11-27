'use strict';
// The Kalender asks before a window somebody has booked into is cancelled or
// moved (confirmBookedWindow). It can only ask if it knows the bookings, and
// those were loaded in one place: the branch of openStab() for a view "cal" of
// the page "cal". The Kalender has no views any more, nothing calls that
// branch, so the list stayed empty and the question was never asked.
//
// The bookings are loaded where the page opens. Text and lifted functions, no
// browser; the bookings below are invented.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function hebe(name) {
  const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
  assert.ok(m, name + '() not found in app.js');
  return m[1];
}

describe('Kalender: the bookings behind the warning', () => {
  it('loads them when the page opens', () => {
    const go = hebe('go');
    const zweig = go.match(/if \(page === 'cal'\) \{[\s\S]*?\n {2}\}/);
    assert.ok(zweig, 'go() has no branch for the Kalender');
    assert.match(zweig[0], /loadPickupBookings\(\)\.catch\(\(\) => \{\}\);/);
    assert.match(zweig[0], /renderCalendar\(\);/, 'the calendar draws without waiting for them');
  });

  it('has no loader left behind a view that does not exist', () => {
    // Every other caller would be as unreachable as the old one if it hung on
    // a tab of a page without tabs.
    assert.doesNotMatch(hebe('openStab'), /loadPickupBookings/);
    const von = HTML.indexOf('<div class="page" id="p-cal"');
    assert.ok(von > 0, 'no Kalender page');
    const seite = HTML.slice(von, HTML.indexOf('<div class="page" id="p-', von + 1));
    assert.doesNotMatch(seite, /class="stab[ "]/, 'the Kalender has views again: load the bookings there too');
  });

  it('does not let a failed request become an unhandled rejection', () => {
    // loadPickupBookings() awaits apiGet() without a catch of its own.
    const callers = APP.match(/loadPickupBookings\(\)[^\n]*/g).filter((l) => !l.startsWith('loadPickupBookings() {'));
    assert.ok(callers.length >= 1);
    for (const l of callers) assert.match(l, /\.catch\(/, 'a call without a catch: ' + l);
  });

  it('counts the bookings of one day, or of the whole series', () => {
    const booked = new Function('pickupBookings', hebe('bookedForWindow') + '\nreturn bookedForWindow;')([
      { event: 'evt-test-1', date: '2026-01-05', count: 2 },
      { event: 'evt-test-1', date: '2026-01-12', count: 1 },
      { event: 'evt-test-2', date: '2026-01-05', count: 4 }
    ]);
    assert.equal(booked('evt-test-1', '2026-01-05'), 2);
    assert.equal(booked('evt-test-1', null), 3);
    assert.equal(booked('evt-test-3', null), 0);
  });
});
