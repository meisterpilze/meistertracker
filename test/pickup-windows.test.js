'use strict';
// Pickup windows: the places goods are handed over, and the appointments that
// say when. Issues #480 and #481.
//
// What this file guards is mostly the difference between two values that look
// alike and are not:
//
//   null capacity vs 0     "as many as turn up" vs "exists, takes no bookings"
//   inactive vs deleted    a location nobody uses vs one no past event can name
//
// Both collapse under the usual shorthand (`|| null`, a DELETE), and both are
// cheap to get wrong and expensive to discover — the second one silently blanks
// the place on appointments that already happened.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const feed = require('../harvest-feed.js');

const ROOT = path.join(__dirname, '..');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_pickup_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

describe('pickup locations', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('stores a location and reads it back', () => {
    const id = db.upsertPickupLocation(d, { name: 'Marktstand Erlangen', address: 'Marktplatz 1', sortOrder: 1 });
    const list = db.listPickupLocations(d);
    const l = list.find((x) => x.id === id);
    assert.equal(l.name, 'Marktstand Erlangen');
    assert.equal(l.address, 'Marktplatz 1');
    assert.equal(l.sort_order, 1);
    assert.equal(l.active, 1);
  });

  it('refuses a location without a name', () => {
    assert.throws(() => db.upsertPickupLocation(d, { name: '   ' }), /name is required/);
  });

  it('updates in place rather than adding a second row', () => {
    const id = db.upsertPickupLocation(d, { name: 'Halle' });
    const before = db.listPickupLocations(d).length;
    db.upsertPickupLocation(d, { id, name: 'Halle Pommernstraße' });
    const after = db.listPickupLocations(d);
    assert.equal(after.length, before);
    assert.equal(after.find((x) => x.id === id).name, 'Halle Pommernstraße');
  });

  it('retires a location instead of deleting it, and keeps listing it', () => {
    const id = db.upsertPickupLocation(d, { name: 'Alter Markt' });
    db.deactivatePickupLocation(d, id);
    const l = db.listPickupLocations(d).find((x) => x.id === id);
    // Still there. An event pointing at it has to be able to name the place.
    assert.ok(l, 'a retired location must not disappear from the list');
    assert.equal(l.active, 0);
  });

  it('hands the client a boolean, not SQLite 0/1', () => {
    const id = db.upsertPickupLocation(d, { name: 'Zweitstandort' });
    db.deactivatePickupLocation(d, id);
    const all = db.readAll(d).pickupLocations;
    assert.equal(all.find((x) => x.id === id).active, false);
    assert.equal(all.find((x) => x.name === 'Halle Pommernstraße').active, true);
  });
});

describe('pickup windows – location and capacity on an event', () => {
  let d, p, locId;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    locId = db.upsertPickupLocation(d, { name: 'Marktstand Erlangen' });
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  const baseEvent = (id, extra) => ({
    id,
    title: 'Abholfenster',
    startDate: '2026-08-15',
    allDay: false,
    startTime: '09:00',
    endTime: '13:00',
    category: 'pickup',
    created: new Date().toISOString(),
    ...extra
  });

  it('keeps location and capacity through a round trip', () => {
    db.insertCalendarEvent(d, baseEvent('ev-1', { locationId: locId, pickupCapacity: 8 }), []);
    const ev = db.getCalendarEvents(d).find((e) => e.id === 'ev-1');
    assert.equal(ev.locationId, locId);
    assert.equal(ev.pickupCapacity, 8);
    assert.equal(ev.category, 'pickup');
  });

  it('treats no capacity as uncapped, and zero as a window that takes nobody', () => {
    db.insertCalendarEvent(d, baseEvent('ev-uncapped', { locationId: locId }), []);
    db.insertCalendarEvent(d, baseEvent('ev-zero', { locationId: locId, pickupCapacity: 0 }), []);
    const evs = db.getCalendarEvents(d);
    assert.equal(evs.find((e) => e.id === 'ev-uncapped').pickupCapacity, null);
    // The whole point: 0 survives. `|| null` here would publish an open window.
    assert.equal(evs.find((e) => e.id === 'ev-zero').pickupCapacity, 0);
  });

  it('turns an empty dropdown into no location rather than location 0', () => {
    db.insertCalendarEvent(d, baseEvent('ev-noloc', { locationId: '', pickupCapacity: '' }), []);
    const ev = db.getCalendarEvents(d).find((e) => e.id === 'ev-noloc');
    assert.equal(ev.locationId, null);
    assert.equal(ev.pickupCapacity, null);
  });

  it('updates both fields through the patch path', () => {
    db.insertCalendarEvent(d, baseEvent('ev-patch'), []);
    db.updateCalendarEvent(d, 'ev-patch', { locationId: locId, pickupCapacity: 12 });
    let ev = db.getCalendarEvents(d).find((e) => e.id === 'ev-patch');
    assert.equal(ev.locationId, locId);
    assert.equal(ev.pickupCapacity, 12);
    // And back off again — clearing has to be expressible, or a window keeps a
    // cap nobody can remove.
    db.updateCalendarEvent(d, 'ev-patch', { locationId: '', pickupCapacity: '' });
    ev = db.getCalendarEvents(d).find((e) => e.id === 'ev-patch');
    assert.equal(ev.locationId, null);
    assert.equal(ev.pickupCapacity, null);
  });

  it('leaves ordinary appointments alone', () => {
    db.insertCalendarEvent(d, { ...baseEvent('ev-meeting'), category: 'meeting' }, []);
    const ev = db.getCalendarEvents(d).find((e) => e.id === 'ev-meeting');
    assert.equal(ev.locationId, null);
    assert.equal(ev.pickupCapacity, null);
  });
});

// A category lives in five places in server.js and one in app.js, and missing
// from any single one of them fails quietly rather than loudly:
//
//   KNOWN_CATEGORIES              an imported event's category is dropped
//   CALDAV_EVENT_CATEGORY_MAP     the window lands in "Eigene Termine"
//   CALDAV_CATEGORY_CALS          the calendar folder is never created
//   CALDAV_CATEGORY_COLORS        the window shows up green like everything else
//   the cleanup list              a stale .ics survives a category change
//
// server.js exports nothing — it starts a server — so this reads the source,
// the same way the migration and settings-tab guards in this suite do.
describe('pickup category – declared everywhere a category has to be', () => {
  let server, app, html;
  before(() => {
    server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  });

  /** The body of a `const NAME = { … }` literal in server.js. */
  function literal(name) {
    const at = server.indexOf('const ' + name + ' = {');
    assert.notEqual(at, -1, name + ' not found in server.js');
    const end = server.indexOf('};', at);
    assert.notEqual(end, -1, 'end of ' + name + ' not found');
    return server.slice(at, end);
  }

  it('is a known category', () => {
    assert.match(literal('KNOWN_CATEGORIES'), /pickup:\s*1/);
  });

  it('maps to its own CalDAV calendar', () => {
    assert.match(literal('CALDAV_EVENT_CATEGORY_MAP'), /pickup:\s*'abholung'/);
  });

  it('has that calendar declared, so the directory gets created', () => {
    assert.match(literal('CALDAV_CATEGORY_CALS'), /abholung:\s*\{/);
  });

  it('has a colour of its own', () => {
    assert.match(literal('CALDAV_CATEGORY_COLORS'), /pickup:\s*'#/);
  });

  it('is cleaned up when an event moves to another category', () => {
    // Same list the sync path walks to remove the old file. Leave 'abholung'
    // out and a window that stopped being one stays published to subscribers.
    const at = server.indexOf("for (const other of ['eigene-termine'");
    assert.notEqual(at, -1, 'the CalDAV cleanup list moved — check this test');
    assert.match(server.slice(at, at + 200), /'abholung'/);
  });

  it('is offered in the editor and coloured in the client', () => {
    assert.match(html, /<option value="pickup"/);
    assert.match(app, /pickup:\s*'#f59e0b'/);
  });

  it('emits the place as LOCATION on the VEVENT', () => {
    assert.match(server, /lines\.push\('LOCATION:' \+ escapeIcsText\(place\)\)/);
  });

  it('does not offer all-day for a pickup window', () => {
    // The feed skips a window with no clock, and from the author's side that is
    // silent. The editor takes the option away instead of explaining it later.
    assert.match(app, /const isPickup = type === 'pickup';/);
    assert.match(app, /if \(isPickup\) document\.getElementById\('cal-entry-allday'\)\.checked = false;/);
  });
});

// The export. Two constraints from #481 carry the weight here, and both are the
// kind that pass review and fail in the field:
//
//   the key is event id + occurrence date, never the id alone
//   title and description do not leave the building
describe('pickup windows – what goes out on the harvest feed', () => {
  let d, p, locId;

  // The builder works in the machine's own day, like the release window does.
  const today = () => {
    const at = new Date();
    const q = (n) => String(n).padStart(2, '0');
    return `${at.getFullYear()}-${q(at.getMonth() + 1)}-${q(at.getDate())}`;
  };
  const inDays = (n) => {
    const dt = new Date(today() + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  };

  before(() => {
    ({ db: d, path: p } = tmpDb());
    locId = db.upsertPickupLocation(d, { name: 'Marktstand Erlangen', address: 'Marktplatz 1, 91054 Erlangen' });
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  const window = (id, extra) =>
    db.insertCalendarEvent(
      d,
      {
        id,
        title: 'Anna übernimmt, Bernd hat frei',
        description: 'Schlüssel liegt beim Nachbarn',
        startDate: inDays(2),
        allDay: false,
        startTime: '09:00',
        endTime: '12:00',
        category: 'pickup',
        locationId: locId,
        created: new Date().toISOString(),
        ...extra
      },
      []
    );

  it('exports one window per occurrence, keyed by event AND date', () => {
    window('cev-weekly', { recurrence: 'weekly' });
    const out = feed.buildPickupWindows(d, new Date());
    const mine = out.filter((w) => w.id.startsWith('cev-weekly'));
    // Four weeks of horizon, so the first occurrence plus three repeats.
    assert.ok(mine.length >= 4, 'expected the recurrence to expand, got ' + mine.length);
    const ids = new Set(mine.map((w) => w.id));
    // The whole point. Key on the row alone and every Friday is the same window,
    // so one booking takes all of them — and nobody finds out until a handover.
    assert.equal(ids.size, mine.length, 'occurrences must not share an id');
    assert.equal(mine[0].id, 'cev-weekly_' + inDays(2));
    assert.equal(mine[1].date, inDays(9));
  });

  it('never lets the title or the description out', () => {
    const out = feed.buildPickupWindows(d, new Date());
    const asText = JSON.stringify(out);
    assert.ok(!asText.includes('Anna'), 'a staff note reached the payload through the title');
    assert.ok(!asText.includes('Nachbarn'), 'a staff note reached the payload through the description');
    // And nothing else creeps in later either: an allow-list, not a deny-list,
    // because the field that gets added without thinking is the free-text one.
    const allowed = new Set(['id', 'date', 'from', 'to', 'tz', 'place', 'capacity']);
    for (const w of out) {
      for (const k of Object.keys(w)) assert.ok(allowed.has(k), 'unexpected field on a published window: ' + k);
    }
  });

  it('sends the place by name, and leaves the address at home', () => {
    const out = feed.buildPickupWindows(d, new Date());
    assert.equal(out[0].place, 'Marktstand Erlangen');
    assert.ok(!JSON.stringify(out).includes('Marktplatz 1'), 'the address must not leave the lab');
  });

  it('drops an occurrence that was cancelled', () => {
    window('cev-exc', { recurrence: 'weekly', exceptionDates: [inDays(9)] });
    const dates = feed
      .buildPickupWindows(d, new Date())
      .filter((w) => w.id.startsWith('cev-exc'))
      .map((w) => w.date);
    assert.ok(dates.includes(inDays(2)));
    assert.ok(!dates.includes(inDays(9)), 'an exception date is an occurrence that does not exist');
    assert.ok(dates.includes(inDays(16)));
  });

  it('omits capacity when uncapped and keeps a zero', () => {
    window('cev-uncapped');
    window('cev-zero', { pickupCapacity: 0 });
    window('cev-eight', { pickupCapacity: 8 });
    const out = feed.buildPickupWindows(d, new Date());
    const one = (id) => out.find((w) => w.id.startsWith(id));
    assert.ok(!('capacity' in one('cev-uncapped')), 'absent means uncapped');
    assert.equal(one('cev-zero').capacity, 0, 'a window that takes nobody is not an uncapped one');
    assert.equal(one('cev-eight').capacity, 8);
  });

  it('skips a window with no clock on it', () => {
    window('cev-allday', { allDay: true, startTime: null, endTime: null });
    const out = feed.buildPickupWindows(d, new Date());
    assert.ok(!out.some((w) => w.id.startsWith('cev-allday')), '"Saturday" is not a slot anyone can book');
  });

  it('ignores everything that is not a pickup window', () => {
    db.insertCalendarEvent(
      d,
      {
        id: 'cev-meeting',
        title: 'Jour fixe',
        startDate: inDays(1),
        allDay: false,
        startTime: '10:00',
        endTime: '11:00',
        category: 'meeting',
        created: new Date().toISOString()
      },
      []
    );
    const out = feed.buildPickupWindows(d, new Date());
    assert.ok(!out.some((w) => w.id.startsWith('cev-meeting')));
  });

  it('stops at the horizon and ignores what is already past', () => {
    window('cev-past', { startDate: inDays(-3) });
    window('cev-far', { startDate: inDays(120) });
    const out = feed.buildPickupWindows(d, new Date());
    assert.ok(!out.some((w) => w.id.startsWith('cev-past')));
    assert.ok(!out.some((w) => w.id.startsWith('cev-far')));
  });

  it('carries the zone, because 09:00 on its own is not a time', () => {
    const out = feed.buildPickupWindows(d, new Date());
    assert.equal(out[0].tz, 'Europe/Berlin');
  });

  it('folds an id a receiver could not accept, without merging two of them', () => {
    // CalDAV ids look like this, and the receiver's charset is [A-Za-z0-9_-].
    const a = feed.windowId('abc@example.com', '2026-08-15');
    const b = feed.windowId('abc.example.com', '2026-08-15');
    assert.match(a, /^[A-Za-z0-9_-]+$/);
    assert.ok(a.length <= 64);
    // Folded naively these two become the same string, and two markets become
    // one window with one set of seats.
    assert.notEqual(a, b);
    // An ordinary id is left legible.
    assert.equal(feed.windowId('cev-123-ab', '2026-08-15'), 'cev-123-ab_2026-08-15');
  });

  it('rides along on the payload, empty list included', () => {
    const { db: fresh, path: fp } = tmpDb();
    try {
      const payload = feed.buildPayload(
        fresh,
        { freshDays: 3, plannedDays: 28, leadDays: 0, strain: true },
        new Date()
      );
      // Present-but-empty is a statement ("nothing bookable"); absent would mean
      // "this software cannot say", which is the only case a receiver may answer
      // by falling back to a hand-kept list.
      assert.ok(Array.isArray(payload.pickupWindows));
      assert.equal(payload.pickupWindows.length, 0);
    } finally {
      fresh.close();
      fs.unlinkSync(fp);
    }
  });
});
