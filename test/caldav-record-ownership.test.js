'use strict';
// Who a CalDAV sync-back is allowed to touch.
//
// PUT and DELETE under /caldav/ resolve a row from the UID the caller supplies —
// in the request body for PUT, in the file being removed for DELETE — and then
// write or delete that row. Every guard above them asks about the *calendar*:
// checkCalendarAccess, and "only from your own calendar, or from the shared one
// if you are admin". None of them asks about the row.
//
// A worker may write into their own personal calendar, which is all the attack
// needs: PUT an .ics carrying a colleague's task UID there, DELETE it again,
// and the colleague's task is gone. The UIDs are not a secret — GET /api/data
// returns caldavUid for every task, so they can simply be read off.
//
// The HTTP twins of both operations already answer this: PATCH /api/tasks/:id
// calls db.canUserModifyTask, DELETE /api/calendar-events/:id is requireAdmin.
// So the test's real subject is agreement — the same question, the same answer,
// whichever of the two doors you come through.
//
// Run against a real database rather than a stub: the rule being checked is
// db.canUserModifyTask's, including how it splits a multi-assignee CSV, and a
// stub would only test this file's idea of that rule.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

/** Lift caldavRecordAllowed and give it the two globals it closes over. */
function lift(database) {
  const m = SRC.match(/function caldavRecordAllowed\(req, ics\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'caldavRecordAllowed has moved');
  return new Function('db', 'database', m[0] + '\nreturn caldavRecordAllowed;')(db, database);
}

const req = (username, role) => ({ caldavUser: { username, role } });
const ics = (uid) => 'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:' + uid + '\r\nSUMMARY:x\r\nEND:VTODO\r\nEND:VCALENDAR';

describe('a CalDAV write is judged on the record it names', () => {
  let d, p, erlaubt;
  let uidFremd, uidEigen, uidGeteilt, uidFrei;

  before(() => {
    p = path.join(os.tmpdir(), 'mt_caldav_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    erlaubt = lift(d);
    const mk = (text, assignee, uid) => {
      db.insertTask(d, { text, assignee, created: '2026-08-19T00:00:00Z', caldavUid: uid });
      return uid;
    };
    uidFremd = mk('Kollegin ihre Aufgabe', 'britta', 'uid-fremd');
    uidEigen = mk('Meine Aufgabe', 'anton', 'uid-eigen');
    uidGeteilt = mk('Zu zweit', 'britta, anton', 'uid-geteilt');
    uidFrei = mk('Niemandem zugewiesen', null, 'uid-frei');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it("refuses a colleague's task to an ordinary worker", () => {
    assert.equal(erlaubt(req('anton', 'user'), ics(uidFremd)), false);
  });

  it('allows the worker their own task', () => {
    assert.equal(erlaubt(req('anton', 'user'), ics(uidEigen)), true);
  });

  it('allows a task they share, because canUserModifyTask splits the CSV', () => {
    assert.equal(erlaubt(req('anton', 'user'), ics(uidGeteilt)), true);
  });

  it('allows an unassigned task, which is what the HTTP twin does', () => {
    assert.equal(erlaubt(req('anton', 'user'), ics(uidFrei)), true);
  });

  it('allows an admin everything', () => {
    assert.equal(erlaubt(req('chef', 'admin'), ics(uidFremd)), true);
  });

  it('judges the due-date companion event by its task', () => {
    // The DELETE path strips a "-event" suffix before resolving, so the
    // companion VEVENT must not be a way around the answer for its task.
    assert.equal(erlaubt(req('anton', 'user'), ics(uidFremd + '-event')), false);
    assert.equal(erlaubt(req('anton', 'user'), ics(uidEigen + '-event')), true);
  });

  it('reserves custom calendar events for admins, mirroring the HTTP route', () => {
    assert.equal(erlaubt(req('anton', 'user'), ics('cev-42@meisterpilze')), false);
    assert.equal(erlaubt(req('chef', 'admin'), ics('cev-42@meisterpilze')), true);
  });

  it('does not mangle an event id that itself ends in -event', () => {
    // Matched as an event before the suffix is stripped; otherwise
    // cev-x-event@meisterpilze would be resolved as some other id entirely.
    assert.equal(erlaubt(req('anton', 'user'), ics('cev-x-event@meisterpilze')), false);
  });

  it('lets through a UID that names nothing — creating a task takes nothing from anyone', () => {
    assert.equal(erlaubt(req('anton', 'user'), ics('brand-neu-123')), true);
    assert.equal(erlaubt(req('anton', 'user'), 'BEGIN:VCALENDAR\r\nEND:VCALENDAR'), true);
  });

  it('lets through a UID that could never name a row', () => {
    assert.equal(erlaubt(req('anton', 'user'), ics('../../etc/passwd')), true);
  });
});

describe('and it is asked before anything happens', () => {
  const put = SRC.match(/function handlePut\(parts, body, req, res\) \{[\s\S]*?\n\}\n\nfunction /);
  const del = SRC.match(/function handleDelete\(parts, req, res\) \{[\s\S]*?\n\}\n\nfunction /);

  // indexOf returns -1 when the guard is absent, and -1 is less than every
  // position — so "the guard comes first" is true of a handler that has no
  // guard at all. Presence is asserted separately, or these two would have
  // been green against the unfixed file.
  const vor = (hay, wer, was, msg) => {
    const a = hay.indexOf(wer);
    const b = hay.indexOf(was);
    assert.ok(a >= 0, wer + ' is not there at all');
    assert.ok(b >= 0, was + ' is not there at all');
    assert.ok(a < b, msg);
  };

  it('PUT refuses before the file is written, not after', () => {
    assert.ok(put, 'handlePut has moved');
    vor(
      put[0],
      'caldavRecordAllowed',
      "fs.writeFileSync(filePath, body, 'utf8')",
      'a refusal that still leaves the .ics in a shared calendar is a refusal in name only'
    );
  });

  it('DELETE refuses before any branch that writes to the database', () => {
    assert.ok(del, 'handleDelete has moved');
    vor(del[0], 'caldavRecordAllowed', 'X-MEISTERPILZE-TYPE', 'before the branching');
    vor(del[0], 'caldavRecordAllowed', 'fs.unlinkSync', 'before the unlink');
  });

  it('says so in the log, with who tried it', () => {
    assert.match(SRC, /CalDAV PUT: refused a record the caller may not modify/);
    assert.match(SRC, /CalDAV DELETE: refused a record the caller may not modify/);
  });
});
