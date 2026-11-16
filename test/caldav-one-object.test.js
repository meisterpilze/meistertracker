'use strict';
// CalDAV PUT and DELETE, and the import, run against a real database.
//
// The S-24 guard and the writers behind it used to read the UID each with
// their own pattern, and the properties with patterns that ran over the whole
// body. Now handlePut and handleDelete read the body once with
// readCalendarObject, and guard and writers act on the same UID. These tests
// run the two handlers themselves, cut out of server.js, with only the file
// and calendar plumbing around them replaced.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');
const { routen } = require('./helpers/routen');

const SRC = quelle('server.js');
const konstante = (name) => {
  const m = SRC.match(new RegExp('^const ' + name + ' = [^\\n]*;', 'm'));
  assert.ok(m, name + ' has moved');
  return m[0];
};

const LESER = [
  'unfoldIcs',
  'parseIcsLine',
  'parseIcsComponents',
  'readCalendarObject',
  'icsProp',
  'icsValue',
  'icsMaster',
  'icsAppType',
  'icsDateTime'
];

function handler(database, DIR, logs) {
  const teile = [
    konstante('CALDAV_MAX_ICS_BYTES'),
    konstante('ICS_ITEM_COMPONENTS'),
    hebeKonstante('KNOWN_CATEGORIES', SRC),
    hebeKonstante('CALDAV_PRIO_MAP', SRC),
    ...LESER.map((n) => hebeFunktion(n, SRC)),
    hebeFunktion('_allDayLastDate', SRC),
    hebeFunktion('caldavRecordAllowed', SRC),
    hebeFunktion('handlePut', SRC),
    hebeFunktion('handleDelete', SRC)
  ];
  return new Function(
    'db',
    'database',
    'path',
    'fs',
    'DIR',
    'log',
    `
    const CAL_DIR = DIR;
    const checkCalendarAccess = () => true;
    const ensureCalDir = (name) => {
      const d = path.join(CAL_DIR, name);
      fs.mkdirSync(d, { recursive: true });
      return d;
    };
    const invalidateCtag = () => {};
    const recordChange = () => {};
    const broadcastSSE = () => {};
    const autoPushTaskCaldav = () => {};
    const deleteIcsFile = () => {};
    ${teile.join('\n')}
    return { handlePut, handleDelete };`
  )(db, database, path, fs, DIR, (level, msg, meta) => logs.push({ level, msg, meta }));
}

const antwort = () => ({
  status: null,
  writeHead(code) {
    this.status = code;
    return this;
  },
  end() {}
});
const MAX = { headers: {}, caldavUser: { username: 'max', role: 'user' }, caldavUserSlug: 'max' };

const ics = (...zeilen) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...zeilen, 'END:VCALENDAR'].join('\r\n') + '\r\n';
const vtodo = (...zeilen) => ['BEGIN:VTODO', ...zeilen, 'END:VTODO'];

describe('CalDAV PUT and DELETE act on the one UID the guard was asked about', () => {
  let d, p, DIR, h, logs;
  const aufgabe = (uid) => d.prepare('SELECT * FROM manual_tasks WHERE caldav_uid=?').get(uid);
  const put = (datei, body) => {
    const res = antwort();
    h.handlePut(['calendars', 'max', datei], body, MAX, res);
    return res.status;
  };
  const del = (datei) => {
    const res = antwort();
    h.handleDelete(['calendars', 'max', datei], MAX, res);
    return res.status;
  };
  const liegt = (datei) => fs.existsSync(path.join(DIR, 'max', datei));

  before(() => {
    DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_caldav_objekt_'));
    p = path.join(DIR, 'test.db');
    d = db.openDb(p);
    logs = [];
    h = handler(d, DIR, logs);
    db.insertTask(d, {
      text: 'Autoklav prüfen',
      assignee: 'erika',
      created: '2026-11-16T08:00:00Z',
      caldavUid: 'uid-erika'
    });
    db.insertTask(d, {
      text: 'Regal auffüllen',
      assignee: 'max',
      created: '2026-11-16T08:00:00Z',
      caldavUid: 'uid-max'
    });
  });
  after(() => {
    d.close();
    fs.rmSync(DIR, { recursive: true, force: true });
  });

  it('writes the row the guard judged, whatever stands in front of the UID', () => {
    // The guard and the writer each read "the UID" once: a line whose name only
    // ends in UID must not send the write to another row than the one judged.
    const body = ics(...vtodo('X-A-UID:uid-erika', 'UID:uid-max', 'SUMMARY:Regal auffüllen, oben'));
    assert.equal(put('uid-max.ics', body), 201);
    assert.equal(aufgabe('uid-max').text, 'Regal auffüllen, oben');
    assert.equal(aufgabe('uid-erika').text, 'Autoklav prüfen');
  });

  it('judges the UID of the VTODO, not a line in front of it', () => {
    const body = ics(...vtodo('X-A-UID:uid-max', 'UID:uid-erika', 'SUMMARY:Geändert', 'STATUS:COMPLETED'));
    assert.equal(put('a.ics', body), 403);
    assert.equal(aufgabe('uid-erika').text, 'Autoklav prüfen');
    assert.equal(aufgabe('uid-erika').done, 0);
    assert.equal(liegt('a.ics'), false);
  });

  it('refuses a body that names a second row in another component', () => {
    const body = ics(
      ...vtodo('UID:uid-max', 'SUMMARY:Regal auffüllen'),
      'BEGIN:VEVENT',
      'UID:uid-erika-event',
      'X-MEISTERPILZE-TYPE:task-due',
      'DTSTART;VALUE=DATE:20270101',
      'END:VEVENT'
    );
    assert.equal(put('b.ics', body), 400);
    assert.equal(aufgabe('uid-erika').due_date, null);
    assert.equal(liegt('b.ics'), false);
    assert.ok(logs.some((l) => /not one calendar object/.test(l.msg)));
  });

  it("syncs the caller's own task from the VTODO's own properties", () => {
    const body = ics(
      ...vtodo(
        'UID:uid-max',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Erinnerung',
        'TRIGGER:-PT15M',
        'END:VALARM',
        'SUMMARY:Regal auffüllen',
        'DESCRIPTION:Oben links',
        'DUE;TZID=Europe/Berlin:20261120T083000'
      )
    );
    assert.equal(put('regal.ics', body), 201);
    const t = aufgabe('uid-max');
    assert.equal(t.description, 'Oben links', 'the alarm text is not the task text');
    assert.equal(t.due_date, '2026-11-20');
    assert.equal(t.due_time, '08:30');
  });

  it('reads a large body in linear time and refuses one over the cap', () => {
    // One long line of parameters that never reach a ':' — the shape that made
    // the old per-property patterns run in quadratic time.
    const lang = 'X-Y;' + 'DUE;'.repeat(60000) + 'x';
    const body = ics(...vtodo('UID:uid-max', 'SUMMARY:Regal auffüllen', lang));
    assert.ok(Buffer.byteLength(body) < 256 * 1024);
    const t0 = process.hrtime.bigint();
    assert.equal(put('uid-max.ics', body), 204);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 1000, 'took ' + ms.toFixed(0) + ' ms');
    const zuGross = ics(...vtodo('UID:uid-max', 'DESCRIPTION:' + 'x'.repeat(300 * 1024)));
    assert.equal(put('gross.ics', zuGross), 413);
    assert.equal(liegt('gross.ics'), false);
  });

  it('deletes the row named by the component, not by a line in front of it', () => {
    fs.writeFileSync(
      path.join(DIR, 'max', 'alt.ics'),
      ics('X-A-UID:uid-erika', ...vtodo('UID:uid-max', 'SUMMARY:Regal auffüllen'))
    );
    assert.equal(del('alt.ics'), 204);
    assert.ok(aufgabe('uid-erika'), "the colleague's task is still there");
    assert.equal(aufgabe('uid-max'), undefined, 'the own task went, as it should');
  });

  it('deletes a stored file that names two rows as a file only', () => {
    db.insertTask(d, { text: 'Zweite', assignee: 'max', created: '2026-11-16T08:00:00Z', caldavUid: 'uid-max-2' });
    fs.writeFileSync(path.join(DIR, 'max', 'zwei.ics'), ics(...vtodo('UID:uid-max-2'), ...vtodo('UID:uid-erika')));
    assert.equal(del('zwei.ics'), 204);
    assert.equal(liegt('zwei.ics'), false);
    assert.ok(aufgabe('uid-erika'));
    assert.ok(aufgabe('uid-max-2'));
  });

  it("does not let a calendar entry with a colleague's task UID open that task", () => {
    // A calendar row can carry any UID: the routes and the CalDAV create branch
    // store the one they are given. The task with the same UID is still the
    // colleague's, for PUT and for DELETE.
    db.insertCalendarEvent(d, { id: 'cev-gleich', title: 'Treffen', startDate: '2026-11-20', caldavUid: 'uid-erika' });
    const body = ics(...vtodo('UID:uid-erika', 'SUMMARY:Geändert', 'STATUS:COMPLETED'));
    assert.equal(put('gleich.ics', body), 403);
    assert.equal(aufgabe('uid-erika').text, 'Autoklav prüfen');
    fs.writeFileSync(path.join(DIR, 'max', 'gleich.ics'), body);
    assert.equal(del('gleich.ics'), 403);
    assert.ok(aufgabe('uid-erika'));
  });

  it('reads past a byte-order mark and a missing last END', () => {
    db.insertTask(d, { text: 'Dritte', assignee: 'max', created: '2026-11-16T08:00:00Z', caldavUid: 'uid-max-3' });
    assert.equal(put('bom.ics', '﻿' + ics(...vtodo('UID:uid-max-3', 'SUMMARY:Mit Marke'))), 201);
    assert.equal(aufgabe('uid-max-3').text, 'Mit Marke');
    const ohneEnde = ics(...vtodo('UID:uid-max-3', 'SUMMARY:Ohne Ende')).replace(/END:VCALENDAR\r\n$/, '');
    assert.equal(put('bom.ics', ohneEnde), 204);
    assert.equal(aufgabe('uid-max-3').text, 'Ohne Ende');
  });

  it('takes the series, not an occurrence listed in front of it', () => {
    db.insertTask(d, { text: 'Vierte', assignee: 'max', created: '2026-11-16T08:00:00Z', caldavUid: 'uid-max-4' });
    db.updateTaskDueDate(d, 'uid-max-4', '2026-11-25');
    // The app's due-date event for the task, with a changed occurrence first
    // that a client wrote without the app's marker.
    fs.writeFileSync(
      path.join(DIR, 'max', 'uid-max-4-event.ics'),
      ics(
        'BEGIN:VEVENT',
        'UID:uid-max-4-event',
        'RECURRENCE-ID;VALUE=DATE:20261202',
        'DTSTART;VALUE=DATE:20261203',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:uid-max-4-event',
        'X-MEISTERPILZE-TYPE:task-due',
        'DTSTART;VALUE=DATE:20261125',
        'END:VEVENT'
      )
    );
    assert.equal(del('uid-max-4-event.ics'), 204);
    assert.equal(aufgabe('uid-max-4').due_date, null, 'the due date went with its event');
    assert.ok(aufgabe('uid-max-4'), 'the task itself stays');
  });
});

describe('the import reads calendar files the same way', () => {
  const ABSCHNITT = {
    name: 'kalenderimport',
    von: '// GET /api/caldav/import',
    bis: '// GET /api/printer-status',
    helfer: LESER,
    konstanten: ['CAL_DIR', 'CALDAV_MAX_ICS_BYTES', 'ICS_ITEM_COMPONENTS', '_icsTooBigLogged'],
    literale: ['CALDAV_CATEGORY_CALS']
  };
  let r;
  before(() => {
    r = routen(ABSCHNITT);
    const dir = path.join(r.DIR, 'calendars', 'meetings');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'termin.ics'),
      ics(
        'BEGIN:VTIMEZONE',
        'TZID:Europe/Berlin',
        'BEGIN:STANDARD',
        'DTSTART:19701025T030000',
        'END:STANDARD',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'UID:extern-1@example.com',
        'SUMMARY:Lieferung',
        'DTSTART;TZID=Europe/Berlin:20261120T090000',
        'DTEND;TZID=Europe/Berlin:20261120T093000',
        'END:VEVENT'
      )
    );
    // The app's own event, with a changed occurrence first that lost the marker.
    fs.writeFileSync(
      path.join(dir, 'eigen.ics'),
      ics(
        'BEGIN:VEVENT',
        'UID:cev-7@meisterpilze',
        'RECURRENCE-ID:20261127T090000',
        'DTSTART:20261127T100000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:cev-7@meisterpilze',
        'X-MEISTERPILZE-TYPE:custom-event',
        'DTSTART:20261120T090000',
        'RRULE:FREQ=WEEKLY',
        'END:VEVENT'
      )
    );
    fs.writeFileSync(
      path.join(dir, 'lang.ics'),
      ics('BEGIN:VEVENT', 'UID:extern-2@example.com', 'X-Y;' + 'DTSTART;'.repeat(28000) + 'x', 'END:VEVENT')
    );
    fs.writeFileSync(
      path.join(dir, 'gross.ics'),
      ics(
        'BEGIN:VEVENT',
        'UID:extern-3@example.com',
        'DTSTART:20261121T090000',
        'X-Y:' + 'x'.repeat(300 * 1024),
        'END:VEVENT'
      )
    );
  });
  after(() => r.schliessen());

  it('takes the VEVENT start, not the VTIMEZONE one, and skips what it cannot use', async () => {
    const t0 = process.hrtime.bigint();
    const a = await r.anfrage('GET', '/api/caldav/import', undefined, { user_id: 7, username: 'max', role: 'user' });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(a.status, 200);
    assert.deepEqual(
      a.json.map((e) => [e.uid, e.date, e.startTime, e.endTime, e.allDay]),
      [['extern-1@example.com', '2026-11-20', '09:00', '09:30', false]]
    );
    assert.ok(ms < 1000, 'took ' + ms.toFixed(0) + ' ms');
  });
});
