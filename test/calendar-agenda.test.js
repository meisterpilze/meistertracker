'use strict';
// The agenda list's day grouping — the part that used to be unreachable.
//
// It was the middle of printCalendarTaskList(), three lines above a
// window.print(), which is the only reason this calendar had no agenda view
// for as long as it did: the grouping and the sort were already written and
// already right, and nothing could call them. Now two callers share them, so
// a change made for the screen can quietly break the printed sheet. That is
// what these assertions are for.
//
// Same harness as test/arbeitsgaenge-ui.test.js: app.js has no module
// boundary, so the test lifts the functions out of the source and runs them
// against mocks. The browser is not under test; the grouping is.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const PARTS = [
  [/^function fmtDate\(y, m, d\) \{[\s\S]*?\r?\n\}/m, 'fmtDate()'],
  [/^function calAgendaDays\(startDate, endDate\) \{[\s\S]*?\r?\n\}/m, 'calAgendaDays()']
];

function lift() {
  return PARTS.map(([re, name]) => {
    const m = SRC.match(re);
    assert.ok(m, name + ' not found in app.js — this test has to move with it');
    return m[0];
  }).join('\n');
}

// Only what the lifted functions actually touch.
function build(events, days) {
  return new Function(`
    const DAY_NAMES = ${JSON.stringify(days || ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'])};
    const calDays = () => DAY_NAMES;
    const collectCalendarEvents = () => ${JSON.stringify(events)};
    ${lift()}
    return { calAgendaDays };
  `)();
}

const ev = (date, label, extra = {}) => ({ date, label, type: 'custom', ...extra });

describe('the agenda day list', () => {
  it('returns one entry per day in the range, ends included', () => {
    const { calAgendaDays } = build([]);
    const days = calAgendaDays(new Date(2026, 7, 1), new Date(2026, 7, 31));
    assert.equal(days.length, 31, 'August has 31 days and all of them are in the range');
    assert.equal(days[0].ds, '2026-08-01');
    assert.equal(days[30].ds, '2026-08-31');
  });

  // A day with nothing on it is kept, because the printed sheet uses the blank
  // line. The screen drops them itself — that decision belongs to the view,
  // not to the grouping.
  it('keeps empty days rather than skipping them', () => {
    const { calAgendaDays } = build([ev('2026-08-03', 'one thing')]);
    const days = calAgendaDays(new Date(2026, 7, 1), new Date(2026, 7, 5));
    assert.equal(days.length, 5);
    assert.deepEqual(
      days.map((d) => d.events.length),
      [0, 0, 1, 0, 0]
    );
  });

  // Guarded by the day loop rather than by the filter above it — removing the
  // filter's upper bound changes nothing observable, because a day outside the
  // range is never walked. Stated so the next reader does not take this as
  // cover for the filter.
  it('never shows an event from outside the range', () => {
    const { calAgendaDays } = build([
      ev('2026-07-31', 'day before'),
      ev('2026-08-01', 'first day'),
      ev('2026-08-05', 'last day'),
      ev('2026-08-06', 'day after')
    ]);
    const days = calAgendaDays(new Date(2026, 7, 1), new Date(2026, 7, 5));
    assert.deepEqual(
      days.flatMap((d) => d.events.map((e) => e.label)),
      ['first day', 'last day']
    );
  });

  // The whole point of the ordering: on this farm nearly everything is all-day
  // — every batch due date and every harvest is, and tasks are unless someone
  // typed a time. If timed events sorted first, the four things that actually
  // happen today would sit below the one meeting at 14:00.
  it('puts all-day entries above timed ones, then sorts by start time', () => {
    // The all-day entry carries a late start time on purpose. Without one the
    // assertion proves nothing: an absent startTime sorts first under the
    // time comparison alone, so the rule this test is named after can be
    // deleted and the test still passes. It is not a contrived shape — a
    // custom event takes allDay and startTime from two independent fields
    // (app.js collectCalendarEvents), and so does a CalDAV import.
    const { calAgendaDays } = build([
      ev('2026-08-03', 'meeting', { startTime: '14:00' }),
      ev('2026-08-03', 'early call', { startTime: '08:30' }),
      ev('2026-08-03', 'harvest', { allDay: true, startTime: '23:00' }),
      ev('2026-08-03', 'batch due', { allDay: true })
    ]);
    const [day] = calAgendaDays(new Date(2026, 7, 3), new Date(2026, 7, 3));
    assert.deepEqual(
      day.events.map((e) => e.label),
      ['batch due', 'harvest', 'early call', 'meeting'],
      'a timed entry sorted above an all-day one, or the two all-day ones lost their own order'
    );
  });

  // Monday-first. getDay() is Sunday-first, so the shift is load-bearing and
  // silently wrong by one for anyone reading a Sunday.
  it('names the weekday Monday-first, the way the grid headers do', () => {
    const { calAgendaDays } = build([]);
    // 2026-08-03 is a Monday; 2026-08-09 is the Sunday that closes that week.
    const days = calAgendaDays(new Date(2026, 7, 3), new Date(2026, 7, 9));
    assert.deepEqual(
      days.map((d) => d.dayName),
      ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    );
  });

  // Crossing a month boundary is the case a naive day counter gets wrong, and
  // the loop mutates its own cursor with setDate().
  it('walks across a month end without losing or repeating a day', () => {
    const { calAgendaDays } = build([]);
    const days = calAgendaDays(new Date(2026, 7, 30), new Date(2026, 8, 2));
    assert.deepEqual(
      days.map((d) => d.ds),
      ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']
    );
  });

  // February 2028 has 29 days. A range built by adding 28 to the first would
  // be short one, and nobody would notice until a leap year.
  it('gets February right in a leap year', () => {
    const { calAgendaDays } = build([ev('2028-02-29', 'the extra day')]);
    const days = calAgendaDays(new Date(2028, 1, 1), new Date(2028, 1, 29));
    assert.equal(days.length, 29);
    assert.equal(days[28].events[0].label, 'the extra day');
  });

  // There was an assertion here that the grouping does not reorder the array
  // it is handed. It survived every mutation, including deleting the .slice()
  // it was written to guard, because the grouping sorts per-day buckets it
  // built itself and never touches the source array at all. A test that
  // cannot fail is not a test, so it is gone rather than left to be counted.
});
