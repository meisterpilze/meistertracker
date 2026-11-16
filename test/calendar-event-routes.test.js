'use strict';
// The calendar-event routes from server.js, run against a real database.
//
// PATCH wrapped its two writes in database.transaction(), a helper node:sqlite
// does not have. Every edit ended in a TypeError and a 500 before anything was
// written, while the page had already updated its own copy, and no test
// noticed, because none ran the route. This one does, cut out of server.js the
// way helpers/routen.js does it for the other routes.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { routen } = require('./helpers/routen');

const ABSCHNITT = {
  name: 'kalenderrouten',
  von: '// -- Calendar Events --',
  bis: '// -- Inventory Delta --',
  helfer: [
    'jsonOk',
    'jsonErr',
    'safeErr',
    'requireAdmin',
    'validateRequired',
    'validateTypes',
    'validateLengths',
    'validateDate',
    'validateDay',
    'validateTimeOfDay',
    'validateCalendarEventFields',
    'touchesPickupWindow',
    'resolveUsernamesToIds',
    'deriveEffectiveAssignees',
    'autoSyncCalendarEvent',
    'notifyCalendarAssignees',
    'autoDeleteCalendarEventCaldav'
  ]
};

const ERIKA = { user_id: 1, username: 'erika', role: 'admin' };
const MAX = { user_id: 7, username: 'max', role: 'user' };

describe('calendar-event routes', () => {
  let r;
  before(() => {
    r = routen(ABSCHNITT, {
      benutzer: [
        { id: 1, username: 'erika', role: 'admin' },
        { id: 7, username: 'max', role: 'user' }
      ]
    });
  });
  after(() => r.schliessen());

  const termin = (id, extra) =>
    r.db.insertCalendarEvent(r.database, {
      id,
      title: 'Teamsitzung',
      startDate: '2026-11-20',
      startTime: '09:00',
      endTime: '10:00',
      category: 'meeting',
      ...extra
    });
  const zeile = (id) => r.db.getCalendarEventById(r.database, id);
  const zugeteilt = (id) => r.db.getCalendarEventAssignees(r.database, id);

  it('saves an edit', async () => {
    termin('cev-bearbeiten');
    const a = await r.anfrage(
      'PATCH',
      '/api/calendar-events/cev-bearbeiten',
      { title: 'Teamsitzung, verschoben', startTime: '11:00', endTime: '12:30', caldavSynced: null },
      MAX
    );
    assert.equal(a.status, 200, JSON.stringify(a.json));
    const ev = zeile('cev-bearbeiten');
    assert.equal(ev.title, 'Teamsitzung, verschoben');
    assert.equal(ev.start_time, '11:00');
    assert.equal(ev.end_time, '12:30');
  });

  it('saves the whole body the entry form sends', async () => {
    termin('cev-formular');
    const a = await r.anfrage(
      'PATCH',
      '/api/calendar-events/cev-formular',
      {
        title: 'Lieferung Substrat',
        description: null,
        startDate: '2026-11-21',
        endDate: null,
        allDay: false,
        startTime: '07:30',
        endTime: '08:00',
        category: 'delivery',
        color: '#14b8a6',
        recurrence: null,
        recurrenceUntil: null,
        teamAssignees: ['max'],
        locationId: '',
        pickupCapacity: ''
      },
      MAX
    );
    assert.equal(a.status, 200, JSON.stringify(a.json));
    const ev = zeile('cev-formular');
    assert.equal(ev.category, 'delivery');
    assert.equal(ev.start_date, '2026-11-21');
    assert.deepEqual(zugeteilt('cev-formular'), [7]);
  });

  it('writes the row and its assignees together or not at all', async () => {
    termin('cev-zusammen');
    const ok = await r.anfrage('PATCH', '/api/calendar-events/cev-zusammen', { title: 'Erst', assignees: [7] }, MAX);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual(zugeteilt('cev-zusammen'), [7]);
    // User 999 does not exist, so the assignee insert fails on its foreign key.
    // The title written before it in the same request must go back with it.
    const kaputt = await r.anfrage(
      'PATCH',
      '/api/calendar-events/cev-zusammen',
      { title: 'Dann', assignees: [7, 999] },
      MAX
    );
    assert.notEqual(kaputt.status, 200);
    assert.equal(zeile('cev-zusammen').title, 'Erst');
    assert.deepEqual(zugeteilt('cev-zusammen'), [7]);
  });

  it('turns away a time that is not HH:MM and leaves the row alone', async () => {
    termin('cev-uhrzeit');
    for (const startTime of ['25:00', '9:00', '09:00:00', '09.00', 'neun Uhr', 900]) {
      const a = await r.anfrage('PATCH', '/api/calendar-events/cev-uhrzeit', { startTime }, MAX);
      assert.equal(a.status, 400, JSON.stringify(startTime));
    }
    assert.equal(zeile('cev-uhrzeit').start_time, '09:00');
  });

  it('turns away a category or color the entry form would never send', async () => {
    termin('cev-form');
    for (const body of [
      { category: 'Meeting Raum' },
      { category: 'meeting\nX' },
      { color: 'red' },
      { color: '#12345g' },
      { caldavUid: 'cev-form@example.com\r\nX' }
    ]) {
      const a = await r.anfrage('PATCH', '/api/calendar-events/cev-form', body, MAX);
      assert.equal(a.status, 400, JSON.stringify(body));
    }
    assert.equal(zeile('cev-form').category, 'meeting');
  });

  it('can change a title or a start day, not empty it', async () => {
    termin('cev-leer');
    for (const body of [{ title: '' }, { startDate: '' }, { title: null }]) {
      const a = await r.anfrage('PATCH', '/api/calendar-events/cev-leer', body, MAX);
      assert.equal(a.status, 400, JSON.stringify(body));
    }
    assert.equal(zeile('cev-leer').title, 'Teamsitzung');
  });

  it('answers 404 for an event that does not exist', async () => {
    const a = await r.anfrage('PATCH', '/api/calendar-events/cev-gibtsnicht', { title: 'Neu' }, MAX);
    assert.equal(a.status, 404);
  });

  it('still leaves a pickup window to admins', async () => {
    termin('cev-abholung', { category: 'pickup', title: 'Abholung Markt' });
    const max = await r.anfrage('PATCH', '/api/calendar-events/cev-abholung', { startTime: '05:00' }, MAX);
    assert.equal(max.status, 403);
    assert.equal(zeile('cev-abholung').start_time, '09:00');
    const erika = await r.anfrage('PATCH', '/api/calendar-events/cev-abholung', { startTime: '10:00' }, ERIKA);
    assert.equal(erika.status, 200, JSON.stringify(erika.json));
    assert.equal(zeile('cev-abholung').start_time, '10:00');
  });

  it('checks a new event the same way', async () => {
    const neu = {
      id: 'cev-neu',
      title: 'Wartung Autoklav',
      startDate: '2026-11-22',
      allDay: false,
      startTime: '08:00',
      endTime: '09:00',
      category: 'maintenance',
      color: '#64748b',
      caldavUid: null,
      caldavSynced: null,
      assignees: [],
      teamAssignees: []
    };
    const schlecht = await r.anfrage('POST', '/api/calendar-events', { ...neu, endTime: '9 Uhr' }, MAX);
    assert.equal(schlecht.status, 400);
    assert.equal(zeile('cev-neu'), null);
    const gut = await r.anfrage('POST', '/api/calendar-events', neu, MAX);
    assert.equal(gut.status, 200, JSON.stringify(gut.json));
    assert.equal(zeile('cev-neu').end_time, '09:00');
  });

  it("takes as caldavUid only the event's own", async () => {
    // The CalDAV guard looks rows up by UID, so a calendar row must not carry
    // one that names a task or another event.
    const fremd = await r.anfrage(
      'POST',
      '/api/calendar-events',
      { id: 'cev-uid', title: 'Treffen', startDate: '2026-11-20', caldavUid: 'uid-einer-aufgabe' },
      MAX
    );
    assert.equal(fremd.status, 400);
    const eigen = await r.anfrage(
      'POST',
      '/api/calendar-events',
      { id: 'cev-uid', title: 'Treffen', startDate: '2026-11-20', caldavUid: 'cev-cev-uid@meisterpilze' },
      MAX
    );
    assert.equal(eigen.status, 200, JSON.stringify(eigen.json));
    const pfad = '/api/calendar-events/cev-uid';
    assert.equal((await r.anfrage('PATCH', pfad, { caldavUid: 'uid-einer-aufgabe' }, MAX)).status, 400);
    assert.equal((await r.anfrage('PATCH', pfad, { caldavUid: 'cev-cev-uid@meisterpilze' }, MAX)).status, 200);
    // An event that came from a calendar app keeps that app's UID.
    termin('cev-von-aussen', { caldavUid: 'A1B2C3@example.com' });
    const zurueck = { caldavUid: 'A1B2C3@example.com', caldavSynced: '2026-11-16T10:00:00.000Z' };
    assert.equal((await r.anfrage('PATCH', '/api/calendar-events/cev-von-aussen', zurueck, MAX)).status, 200);
  });

  it('does not announce the people an event already had on its first edit', async () => {
    // The entry form sends assignees: [] beside teamAssignees, so a new event's
    // people stand only in team_assignees until an edit fills the table.
    const neu = {
      id: 'cev-team',
      title: 'Teamsitzung',
      startDate: '2026-11-23',
      assignees: [],
      teamAssignees: ['max']
    };
    assert.equal((await r.anfrage('POST', '/api/calendar-events', neu, ERIKA)).status, 200);
    const meldungen = () =>
      r.database
        .prepare("SELECT user_id FROM notifications WHERE type='calendar_assignment' AND link_id='cev-team'")
        .all()
        .map((n) => n.user_id);
    const pfad = '/api/calendar-events/cev-team';
    assert.equal(
      (await r.anfrage('PATCH', pfad, { title: 'Teamsitzung, neu', teamAssignees: ['max'] }, ERIKA)).status,
      200
    );
    assert.deepEqual(zugeteilt('cev-team'), [7]);
    assert.deepEqual(meldungen(), [], 'max was on it already');
    assert.equal((await r.anfrage('PATCH', pfad, { teamAssignees: ['max', 'erika'] }, ERIKA)).status, 200);
    assert.deepEqual(meldungen(), [1], 'erika is new');
  });
});

describe('the CalDAV copy of an edited event', () => {
  // autoSyncCalendarEvent with the real VEVENT builder; only the file write is
  // caught. PATCH hands it the stored row, in snake_case.
  const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const db = require('../db.js');
  const SRC = quelle('server.js');
  let d, p, sync, geschrieben;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_cal_sync_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    d.prepare('INSERT OR REPLACE INTO caldav_config(id, enabled) VALUES(1, 1)').run();
    geschrieben = {};
    const teile = [
      hebeKonstante('CALDAV_EVENT_CATEGORY_MAP', SRC),
      hebeKonstante('CALDAV_CATEGORY_COLORS', SRC),
      ...[
        'foldIcsLines',
        'escapeIcsText',
        'buildRRuleLine',
        'formatExceptionDate',
        'buildExdateLine',
        'pickupLocationLabel',
        'customEventToVEVENT',
        'autoSyncCalendarEvent'
      ].map((n) => hebeFunktion(n, SRC))
    ];
    sync = new Function(
      'db',
      'database',
      'writeIcsFile',
      'deleteIcsFile',
      'log',
      teile.join('\n') + '\nreturn autoSyncCalendarEvent;'
    )(
      db,
      d,
      (cal, name, ics) => {
        geschrieben[cal + '/' + name] = ics;
      },
      () => {},
      (level, msg, meta) => {
        throw new Error(msg + ' ' + JSON.stringify(meta));
      }
    );
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('keeps the series, its exceptions and its SEQUENCE', () => {
    db.insertCalendarEvent(d, {
      id: 'cev-serie',
      title: 'Wochenrunde',
      startDate: '2026-11-16',
      startTime: '09:00',
      endTime: '09:30',
      category: 'meeting',
      color: '#8b5cf6',
      recurrence: 'weekly',
      exceptionDates: ['2026-11-23']
    });
    db.updateCalendarEvent(d, 'cev-serie', { title: 'Wochenrunde, kurz' });
    sync(db.getCalendarEventById(d, 'cev-serie'));
    const ics = geschrieben['meetings/cev-cev-serie@meisterpilze.ics'];
    assert.ok(ics, 'written to the meetings calendar: ' + Object.keys(geschrieben).join(', '));
    assert.match(ics, /^RRULE:FREQ=WEEKLY/m);
    assert.match(ics, /^EXDATE[;:].*20261123/m);
    assert.match(ics, /^SEQUENCE:1$/m);
    assert.match(ics, /^COLOR:#8b5cf6$/m);
  });
});
