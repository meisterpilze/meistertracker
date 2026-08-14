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
