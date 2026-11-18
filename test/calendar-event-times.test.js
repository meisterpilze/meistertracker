'use strict';
// An event ends after it starts: as the entry form saves it, and when the week
// or day view moves or stretches it.
//
// The entry form saved an end time before the start time as it was, and a drag
// then worked the new end out from that negative length: an event from 14:00
// to 06:00, dragged to 06:00, came out ending at "-2:00". The server turns
// that away with a 400, after the page has already drawn the move. An end time
// before the start time on the start day now means the next morning, in the
// form and in a drag alike. app.js has no module boundary, so the functions are
// lifted out of it and run against stand-ins for the page.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle('app.js');
const hebe = (...namen) => namen.map((n) => hebeFunktion(n, SRC)).join('\n');
const ZEIT = hebe('calMinutes', 'calDayTime', 'calShiftDay', 'calEventEnd', 'calMovedEnd');
// The rule the server checks a clock time against.
const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;

const { calEventEnd, calMovedEnd } = new Function(ZEIT + '\nreturn { calEventEnd, calMovedEnd };')();

describe('the end an event is saved with', () => {
  const ev = (extra) => ({ startDate: '2026-11-20', startTime: '10:00', endDate: null, endTime: '11:30', ...extra });

  it('keeps an end that comes after the start', () => {
    assert.deepEqual(calEventEnd(ev()), { endDate: null, endTime: '11:30' });
    assert.deepEqual(
      calEventEnd(ev({ endDate: '2026-11-21', endTime: '08:00' })),
      { endDate: '2026-11-21', endTime: '08:00' },
      'an earlier clock time on a later day'
    );
  });

  it('reads an end time before the start time as the next morning', () => {
    assert.deepEqual(calEventEnd(ev({ startTime: '22:00', endTime: '06:00' })), {
      endDate: '2026-11-21',
      endTime: '06:00'
    });
    assert.deepEqual(
      calEventEnd(ev({ endDate: '2026-11-20', endTime: '08:00' })),
      { endDate: '2026-11-21', endTime: '08:00' },
      'an end day on the start day says no more than none'
    );
  });

  it('puts an end equal to the start an hour after it', () => {
    assert.deepEqual(calEventEnd(ev({ endTime: '10:00' })), { endDate: null, endTime: '11:00' });
    assert.deepEqual(
      calEventEnd(ev({ startTime: '23:30', endTime: '23:30' })),
      { endDate: '2026-11-21', endTime: '00:30' },
      'past midnight, on the next day'
    );
  });

  it('drops an end day before the start day', () => {
    assert.deepEqual(calEventEnd(ev({ endDate: '2026-11-18' })), { endDate: null, endTime: '11:30' });
    assert.deepEqual(calEventEnd(ev({ endDate: '2026-11-18', endTime: '09:00' })), {
      endDate: '2026-11-21',
      endTime: '09:00'
    });
    assert.deepEqual(
      calEventEnd({ startDate: '2026-11-20', endDate: '2026-11-18', startTime: null, endTime: null }),
      { endDate: null, endTime: null },
      'all day'
    );
  });
});

describe('the end of a moved event', () => {
  const ev = (extra) => ({ startDate: '2026-11-20', startTime: '09:00', endDate: null, endTime: '10:30', ...extra });

  it('keeps its length', () => {
    assert.deepEqual(calMovedEnd(ev(), '2026-11-21', '13:15'), { endDate: null, endTime: '14:45' });
  });

  it('counts an end time before the start time as the next morning', () => {
    assert.deepEqual(calMovedEnd(ev({ startTime: '22:00', endTime: '06:00' }), '2026-11-21', '22:00'), {
      endDate: '2026-11-22',
      endTime: '06:00'
    });
    assert.deepEqual(
      calMovedEnd(ev({ startTime: '22:00', endTime: '06:00' }), '2026-11-20', '13:00'),
      { endDate: null, endTime: '21:00' },
      'eight hours from 13:00 stay on the day'
    );
  });

  it('gives an event whose end did not come after its start an hour', () => {
    assert.deepEqual(calMovedEnd(ev({ endTime: '09:00' }), '2026-11-20', '15:00'), {
      endDate: null,
      endTime: '16:00'
    });
    assert.deepEqual(calMovedEnd(ev({ endDate: '2026-11-19', endTime: '12:00' }), '2026-11-20', '15:00'), {
      endDate: '2026-11-20',
      endTime: '16:00'
    });
  });

  it('moves only the end day of an event without an end time', () => {
    const tage = ev({ startDate: '2026-11-16', startTime: '20:00', endDate: '2026-11-18', endTime: null });
    assert.deepEqual(calMovedEnd(tage, '2026-11-17', '21:00'), { endDate: '2026-11-19', endTime: null });
    assert.deepEqual(
      calMovedEnd(ev({ endTime: null }), '2026-11-21', '15:00'),
      { endDate: null, endTime: null },
      'one day, and still no end time'
    );
    assert.deepEqual(
      calMovedEnd(ev({ endDate: '2026-11-18', endTime: null }), '2026-11-21', '15:00'),
      { endDate: '2026-11-21', endTime: null },
      'an end day before the start day comes up to it'
    );
  });

  it('keeps an event within one day on its day', () => {
    assert.deepEqual(calMovedEnd(ev({ endTime: '12:00' }), '2026-11-20', '22:30'), {
      endDate: null,
      endTime: '23:59'
    });
  });

  it('moves the end day of an event that has one', () => {
    const nacht = ev({ startDate: '2026-11-16', startTime: '20:00', endDate: '2026-11-17', endTime: '08:00' });
    assert.deepEqual(calMovedEnd(nacht, '2026-11-18', '21:00'), { endDate: '2026-11-19', endTime: '09:00' });
    const einTag = ev({ startDate: '2026-11-16', endDate: '2026-11-16', endTime: '10:00' });
    assert.deepEqual(calMovedEnd(einTag, '2026-11-18', '11:00'), { endDate: '2026-11-18', endTime: '12:00' });
  });

  it('counts clock time across a change of daylight saving time', () => {
    const nacht = ev({ startDate: '2026-10-24', startTime: '20:00', endDate: '2026-10-25', endTime: '08:00' });
    assert.deepEqual(calMovedEnd(nacht, '2026-10-24', '21:00'), { endDate: '2026-10-25', endTime: '09:00' });
  });
});

// initEventDrag and initEventResize themselves, with stand-ins for the
// element, the grid body and the document the mouse listeners hang on.
const WOCHE = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
const ZIEHEN = hebe('pxToTime', 'snapPx', 'updateEventTime', 'initEventDrag', 'initEventResize');

function seite(termin) {
  const gesendet = [];
  const horcher = {};
  const document = {
    addEventListener: (typ, f) => (horcher[typ] = f),
    removeEventListener: (typ) => delete horcher[typ]
  };
  const app = new Function(
    'document',
    'apiPatch',
    `const CAL_HOURS_START = 6, CAL_HOURS_END = 22;
    const calendarEvents = [${JSON.stringify(termin)}];
    const renderCalendar = () => {};
    ${ZEIT}
    ${ZIEHEN}
    return { initEventDrag, initEventResize, calendarEvents };`
  )(document, (url, body) => gesendet.push(body));
  const [h, m] = termin.startTime.split(':').map(Number);
  const [eh, em] = (termin.endTime || String(h + 1) + ':' + String(m)).split(':').map(Number);
  const el = {
    style: {
      top: (h - 6) * 48 + (m / 60) * 48 + 'px',
      height: Math.max(24, (eh - h) * 48 + ((em - m) / 60) * 48) + 'px',
      gridColumn: String(WOCHE.indexOf(termin.startDate) + 2)
    },
    dataset: { id: termin.id, date: termin.startDate },
    an: {},
    addEventListener(typ, f) {
      this.an[typ] = f;
    }
  };
  const griff = { an: {}, addEventListener: el.addEventListener };
  const body = { getBoundingClientRect: () => ({ left: 0, width: 56 + 7 * 100 }) };
  app.initEventDrag(el, body, 'week', WOCHE);
  app.initEventResize(el, griff, body, 'week');
  const maus = { target: { classList: { contains: () => false } }, preventDefault() {}, stopPropagation() {} };
  // The middle of the column the event stands in, moved by whole days.
  const x = (tage) => 56 + (WOCHE.indexOf(termin.startDate) + tage) * 100 + 50;
  return {
    gesendet,
    termin: () => app.calendarEvents[0],
    ziehe(dy, tage = 0) {
      el.an.mousedown({ ...maus, clientX: x(0), clientY: 500 });
      horcher.mousemove({ clientX: x(tage), clientY: 500 + dy });
      horcher.mouseup();
    },
    strecke(dy) {
      griff.an.mousedown({ ...maus, clientY: 500 });
      horcher.mousemove({ clientY: 500 + dy });
      horcher.mouseup();
    }
  };
}

describe('dragging and stretching in the week view', () => {
  it('moves an event that ends the next morning to a time the server takes', () => {
    const s = seite({ id: 'cev-1', startDate: '2026-11-20', startTime: '14:00', endTime: '06:00' });
    s.ziehe(-8 * 48);
    assert.equal(s.gesendet.length, 1);
    const patch = s.gesendet[0];
    assert.equal(patch.startTime, '06:00');
    assert.equal(patch.endTime, '22:00', 'sixteen hours, as before; was "-2:00"');
    assert.match(patch.endTime, UHRZEIT);
    assert.equal(s.termin().endTime, '22:00', 'and the page shows what it sent');
  });

  it('takes the end day along when it moves an event to another day', () => {
    const s = seite({
      id: 'cev-2',
      startDate: '2026-11-17',
      startTime: '20:00',
      endDate: '2026-11-18',
      endTime: '08:00'
    });
    s.ziehe(0, 1);
    assert.deepEqual(s.gesendet[0], {
      caldavSynced: null,
      startTime: '20:00',
      endTime: '08:00',
      startDate: '2026-11-18',
      endDate: '2026-11-19'
    });
  });

  it('gives an event that ends the next morning its end day when moved', () => {
    const s = seite({ id: 'cev-3', startDate: '2026-11-17', startTime: '22:00', endTime: '06:00' });
    s.ziehe(0, 1);
    assert.equal(s.gesendet[0].startDate, '2026-11-18');
    assert.equal(s.gesendet[0].endDate, '2026-11-19');
    assert.equal(s.gesendet[0].endTime, '06:00');
  });

  it('keeps the end day of an event without an end time, moved by the same days', () => {
    const s = seite({ id: 'cev-5', startDate: '2026-11-16', startTime: '20:00', endDate: '2026-11-18', endTime: null });
    s.ziehe(48, 1);
    assert.deepEqual(s.gesendet[0], {
      caldavSynced: null,
      startTime: '21:00',
      startDate: '2026-11-17',
      endDate: '2026-11-19'
    });
    assert.equal(s.termin().endTime, null, 'no end time comes in');
  });

  it('keeps the end after the start when stretched past the last hour', () => {
    const s = seite({ id: 'cev-4', startDate: '2026-11-20', startTime: '22:30', endTime: '23:00' });
    s.strecke(48);
    assert.equal(s.gesendet[0].startTime, '22:30');
    assert.equal(s.gesendet[0].endTime, '23:59', 'pxToTime alone reads the bottom of the grid as 22:00');
  });
});

describe('the entry form', () => {
  const FORMULAR = hebe('normalizeTimeInput', 'saveEntryEvent');

  // saveEntryEvent with the form's fields, and the events the page already has.
  // Returns what it saved and which events it asked about first.
  function speichere(felder, vorher = []) {
    const gespeichert = [];
    const gefragt = [];
    const werte = {
      'cal-entry-mode': 'create',
      'cal-entry-name': 'Teamsitzung',
      'cal-entry-type-select': 'meeting',
      'cal-entry-date': '2026-11-20',
      'cal-entry-start-time': '10:00',
      'cal-entry-end-time': '11:00',
      ...felder
    };
    const document = {
      getElementById: (id) => ({ value: werte[id] === undefined ? '' : werte[id], checked: werte[id] === true })
    };
    new Function(
      'document',
      'applyEntryEvent',
      'confirmBookedWindow',
      'calendarEvents',
      `const calEvSelectedAssignees = [];
      const CATEGORY_COLORS = {};
      ${ZEIT}
      ${FORMULAR}
      saveEntryEvent();`
    )(
      document,
      (ev) => gespeichert.push(ev),
      (id) => gefragt.push(id),
      vorher
    );
    return { gespeichert, gefragt };
  }
  const neu = (felder) => {
    const { gespeichert } = speichere(felder);
    assert.equal(gespeichert.length, 1);
    return gespeichert[0];
  };

  it('saves an end before the start as the next morning', () => {
    const ev = neu({ 'cal-entry-start-time': '22:00', 'cal-entry-end-time': '6:00' });
    assert.equal(ev.startTime, '22:00');
    assert.equal(ev.endDate, '2026-11-21');
    assert.equal(ev.endTime, '06:00');
  });

  it('saves an end equal to the start as an hour after it', () => {
    const ev = neu({ 'cal-entry-start-time': '10:00', 'cal-entry-end-time': '10:00' });
    assert.equal(ev.endDate, null);
    assert.equal(ev.endTime, '11:00');
  });

  it('keeps what was typed when it is in order', () => {
    const ev = neu({ 'cal-entry-end-date': '2026-11-21', 'cal-entry-end-time': '08:00' });
    assert.equal(ev.endDate, '2026-11-21');
    assert.equal(ev.endTime, '08:00');
  });

  it('drops an end day before the start day', () => {
    const ev = neu({ 'cal-entry-end-date': '2026-11-18', 'cal-entry-allday': true });
    assert.equal(ev.endDate, null);
  });

  it('does not ask about bookings when only the title of a window that ends the next morning changes', () => {
    const fenster = {
      id: 'cev-abholung',
      title: 'Abholung',
      category: 'pickup',
      startDate: '2026-11-20',
      startTime: '22:00',
      endDate: null,
      endTime: '06:00',
      locationId: null,
      recurrence: null,
      recurrenceUntil: null
    };
    const { gespeichert, gefragt } = speichere(
      {
        'cal-entry-mode': 'edit',
        'cal-entry-id': 'cev-abholung',
        'cal-entry-name': 'Abholung, Tor 2',
        'cal-entry-type-select': 'pickup',
        'cal-entry-start-time': '22:00',
        'cal-entry-end-time': '06:00'
      },
      [fenster]
    );
    assert.deepEqual(gefragt, [], 'the window keeps its times');
    assert.equal(gespeichert.length, 1);
    assert.equal(gespeichert[0].endTime, '06:00');
    assert.equal(gespeichert[0].endDate, '2026-11-21');
  });
});
