'use strict';
// The measuring stand reads the fixture against a fixed clock, and this is the
// gate on it.
//
// Why it needs one: the fixture already pins its data to one morning and says
// so in a comment, which reads like the job is done. It is half of it. The app
// renders that data against the browser's clock, so a task seeded as "due
// tomorrow" is overdue three days later, and the page draws a different number
// of elements. On 24.08. three lines of the census had moved -- 11, 20 and 5
// elements at 9, 10 and 10.5px had become 9, 13 and 6 -- and they had moved by
// the same amounts on two different builds of the navigation, which is what
// proved it was not the code. Running the stand with --tage 3 reproduces it
// exactly from the frozen baseline.
//
// A number that wanders between two runs on different days measures nothing,
// and the census exists to be the number that does not wander. Nothing in
// `npm test` can catch that by itself: the drift takes a day to appear and the
// run is green the whole time. So what is testable is the wiring, and that is
// what this file holds.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const standQuelle = fs.readFileSync(path.join(WURZEL, 'scripts', 'measure-mobile.js'), 'utf8');
const fixtureQuelle = fs.readFileSync(path.join(WURZEL, 'scripts', 'measure-fixture.js'), 'utf8');

// The function is injected into the page, so it cannot be required. Lift it out
// by source and run it against a stub window, the same way the arbeitsgänge
// tests lift their handlers.
function uhrLaden() {
  const start = standQuelle.indexOf('function uhrQuelle(');
  assert.notStrictEqual(start, -1, 'uhrQuelle is gone from the stand');
  const ende = standQuelle.indexOf('\n}\n', start);
  const quelle = standQuelle.slice(start, ende + 2);
  const fenster = {};
  new Function('window', quelle + '\nuhrQuelle(arguments[1]);')(fenster, Date.parse('2026-08-21T08:00:00Z'));
  return fenster.Date;
}

describe('the fixture owns the instant, and owns it once', () => {
  it('exports it by name', () => {
    const { BASIS } = require('../scripts/measure-fixture.js');
    assert.strictEqual(typeof BASIS, 'number');
    assert.strictEqual(new Date(BASIS).toISOString(), '2026-08-21T08:00:00.000Z');
  });

  it('does not write the date a second time, so the two halves cannot drift apart', () => {
    const treffer = fixtureQuelle.match(/2026-08-21T08:00:00Z/g) || [];
    assert.strictEqual(treffer.length, 1, 'the fixture instant is written more than once');
  });
});

describe('the stand reads that instant, not the wall clock', () => {
  it('takes the base from the fixture instead of repeating it', () => {
    assert.match(standQuelle, /const \{ BASIS: FIXTURE_BASIS \} = require\('\.\/measure-fixture\.js'\)/);
    assert.doesNotMatch(standQuelle, /2026-08-21T08:00:00Z/);
  });

  it('injects the clock, and only where scripts run', () => {
    assert.match(
      standQuelle,
      /if \(APP\) await page\.evaluateOnNewDocument\(uhrQuelle, FIXTURE_BASIS \+ TAGE \* 86400000\)/
    );
  });

  it('injects it before the page has a chance to read the time', () => {
    // evaluateOnNewDocument and not evaluate: app.js asks for the date while it
    // renders, so a clock installed afterwards installs it too late.
    assert.doesNotMatch(standQuelle, /await page\.evaluate\(uhrQuelle/);
  });

  it('lets a run be moved to another day on purpose', () => {
    assert.match(standQuelle, /const TAGE = Number\(flag\('--tage'\) \|\| 0\) \|\| 0/);
  });
});

describe('the injected clock', () => {
  it('starts the page at the fixture morning', () => {
    const Uhr = uhrLaden();
    const abstand = Math.abs(Uhr.now() - Date.parse('2026-08-21T08:00:00Z'));
    assert.ok(abstand < 1000, `the page opened ${abstand}ms away from the fixture`);
    assert.ok(Math.abs(new Uhr().getTime() - Date.parse('2026-08-21T08:00:00Z')) < 1000);
  });

  it('offsets rather than freezes, so anything waiting on time still finishes', async () => {
    const Uhr = uhrLaden();
    const vorher = Uhr.now();
    await new Promise((r) => setTimeout(r, 25));
    assert.ok(Uhr.now() > vorher, 'time stands still inside the page');
  });

  it('leaves every other way of making a date alone', () => {
    const Uhr = uhrLaden();
    assert.strictEqual(new Uhr('2020-01-02T03:04:05Z').toISOString(), '2020-01-02T03:04:05.000Z');
    assert.strictEqual(new Uhr(0).getTime(), 0);
    assert.strictEqual(Uhr.parse('2020-01-02T03:04:05Z'), Date.parse('2020-01-02T03:04:05Z'));
    assert.strictEqual(Uhr.UTC(2020, 0, 2), Date.UTC(2020, 0, 2));
    assert.ok(new Uhr() instanceof Date, 'app.js checks instanceof in places');
  });
});
