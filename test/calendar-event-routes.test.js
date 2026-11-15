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
});
