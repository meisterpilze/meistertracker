'use strict';
// Who may tell the shop when goods can be collected.
//
// A calendar event with category 'pickup' is not a diary entry: harvest-feed.js
// selects exactly those rows and publishes their day, clock, address and number
// of places to the Worker, which the shop then offers to customers. POST and
// PATCH on /api/calendar-events carried no permission check at all — only the
// session gate — so any logged-in worker could invent a 05:00 collection at an
// address the farm does not use, or set the capacity of a window customers had
// already booked to zero. The neighbours had long since decided this was not
// everyone's to do: DELETE on the same row, POST /api/pickup-locations and the
// MCP delete_calendar_event tool are all admin-only.
//
// There are four doors to that one room, and this file walks all four. The HTTP
// route was the obvious one. The CalDAV create branch is the second: any user
// may mint themselves an app password and checkCalendarAccess lets everyone
// write into the shared calendar. The MCP create_calendar_event tool is the
// third — delete_calendar_event was gated, create was not. And the fourth is
// the withdraw direction over CalDAV, which the UID pattern used to miss.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { createMcpServer } = require('../mcp-server.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const vor = (heu, a, b, msg) => {
  const i = heu.indexOf(a);
  const j = heu.indexOf(b);
  assert.ok(i >= 0, a + ' is not there at all');
  assert.ok(j >= 0, b + ' is not there at all');
  assert.ok(i < j, msg);
};

describe('touchesPickupWindow asks both directions', () => {
  let d, p, frage;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_pickup_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    const m = SRC.match(/function touchesPickupWindow\(id, data\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'touchesPickupWindow has moved');
    frage = new Function('db', 'database', m[0] + '\nreturn touchesPickupWindow;')(db, d);
    db.insertCalendarEvent(d, {
      id: 'cev-abhol',
      title: 'Abholung Markt',
      startDate: '2026-08-22',
      category: 'pickup',
      created: '2026-08-20T00:00:00Z'
    });
    db.insertCalendarEvent(d, {
      id: 'cev-sitzung',
      title: 'Teamsitzung',
      startDate: '2026-08-22',
      category: 'meeting',
      created: '2026-08-20T00:00:00Z'
    });
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('says yes to creating one', () => {
    assert.equal(frage(null, { category: 'pickup' }), true);
  });

  it('says no to an ordinary entry, which stays open to everyone', () => {
    assert.equal(frage(null, { category: 'meeting' }), false);
    assert.equal(frage(null, {}), false);
  });

  it('says yes to moving one, even when the body never says "pickup"', () => {
    // This is the case a body-only check misses: a PATCH that shifts the clock
    // carries no category at all.
    assert.equal(frage('cev-abhol', { startTime: '05:00', endTime: '05:30' }), true);
  });

  it('says yes to withdrawing one by re-labelling it', () => {
    // Takes a published window off the shop without ever mentioning pickup.
    assert.equal(frage('cev-abhol', { category: 'meeting' }), true);
  });

  it('leaves a meeting a meeting', () => {
    assert.equal(frage('cev-sitzung', { startTime: '09:00' }), false);
  });

  it('says yes to turning a meeting into a window', () => {
    assert.equal(frage('cev-sitzung', { category: 'pickup' }), true);
  });
});

describe('the HTTP door', () => {
  it('asks before POST writes the row', () => {
    const i = SRC.indexOf("req.method === 'POST' && req.url === '/api/calendar-events'");
    const route = SRC.slice(i, SRC.indexOf('const calEvMatch', i));
    vor(route, 'touchesPickupWindow(null, data)', 'db.insertCalendarEvent', 'the guard must precede the insert');
    assert.match(route, /touchesPickupWindow\(null, data\) && requireAdmin\(req, res\)/);
  });

  it('asks before PATCH writes the row', () => {
    const i = SRC.indexOf('const calEvMatch');
    const route = SRC.slice(i, i + 4000);
    vor(route, 'touchesPickupWindow(id, data)', 'db.updateCalendarEvent', 'the guard must precede the update');
  });
});

describe('the CalDAV doors', () => {
  it('refuses a non-admin creating a pickup VEVENT, using the category it already parsed', () => {
    const i = SRC.indexOf('const catMatch = veventBlock.match(/CATEGORIES:(.*)/);', SRC.indexOf('// Check it doesn'));
    const zweig = SRC.slice(i, i + 3500);
    vor(zweig, "category === 'pickup'", 'db.insertCalendarEvent', 'refused before the row is written');
    // Not a third spelling of the same parse: the loose one would read the
    // whole file rather than this VEVENT block.
    assert.equal((zweig.match(/CATEGORIES:/g) || []).length, 1, 'the category is parsed once in this branch');
  });

  it('recognises an event by its stored uid, not only by the cev- shape', () => {
    // The UID is only built as cev-<id>@meisterpilze when the row has no
    // caldav_uid of its own. One that arrived from a calendar client keeps the
    // client's UID, and the pattern walks straight past it — which left the
    // withdraw direction open for exactly the windows an admin created from
    // their own calendar app.
    const fn = SRC.match(/function caldavRecordAllowed\(req, ics\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'caldavRecordAllowed has moved');
    assert.match(fn[0], /db\.readCalendarEventByCaldavUid\(database, uid\)/);
    vor(fn[0], 'readCalendarEventByCaldavUid', 'readTaskByCaldavUid', 'events are decided before tasks');
  });
});

describe('the MCP door', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_pickmcp_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  const werkzeug = (auth, name) => {
    const server = createMcpServer(d, () => {}, { auth });
    const t = server._registeredTools[name];
    assert.ok(t && typeof t.handler === 'function', name + ' is gone or the SDK renamed the callback');
    return t.handler;
  };

  const args = (category) => ({ title: 'Abholung', startDate: '2026-08-22', category });

  it('refuses a worker creating a pickup window', async () => {
    const r = await werkzeug({ userId: 2, role: 'user', username: 'anton' }, 'create_calendar_event')(
      args('pickup'),
      {}
    );
    assert.match(JSON.stringify(r), /admin/i, 'expected an admin refusal');
    assert.equal(d.prepare("SELECT COUNT(*) AS n FROM calendar_events WHERE category='pickup'").get().n, 0);
  });

  it('still lets a worker create an ordinary entry', async () => {
    const r = await werkzeug({ userId: 2, role: 'user', username: 'anton' }, 'create_calendar_event')(
      args('meeting'),
      {}
    );
    assert.equal(/admin/i.test(JSON.stringify(r)), false, 'meetings stay open to everyone');
  });

  it('lets an admin create one', async () => {
    await werkzeug({ userId: 1, role: 'admin', username: 'chefin' }, 'create_calendar_event')(args('pickup'), {});
    assert.equal(d.prepare("SELECT COUNT(*) AS n FROM calendar_events WHERE category='pickup'").get().n, 1);
  });
});
