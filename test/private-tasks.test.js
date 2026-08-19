'use strict';
// The task checkbox that said "only visible to the assigned person".
//
// It was honoured in exactly one place — autoPushTaskCaldav skips the shared
// calendar for such a task — and nowhere else. readAll selected every
// manual_tasks row with no filter, GET /api/data handed the payload to any
// authenticated session, and the client read the flag only inside the edit
// dialog, never in a render or filter path. One request therefore returned
// every note somebody had marked private, which on a task list means sickness,
// warnings and personnel matters. The same payload also carries every task's
// caldavUid, which is the enumeration key for the CalDAV ownership guard.
//
// There are two doors, not one. The MCP daily_briefing tool reads the same
// tasks through db.getAllTasks and groups them by assignee, and any worker can
// mint themselves an MCP token through the OAuth flow. A read hole with two
// doors is not closed until both are.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { createMcpServer } = require('../mcp-server.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

describe('canUserSeeTask', () => {
  const offen = { private: false, assignee: 'britta' };
  const privatFremd = { private: true, assignee: 'britta' };
  const privatEigen = { private: true, assignee: 'anton' };
  const privatGeteilt = { private: true, assignee: 'britta, anton' };
  const privatNiemand = { private: true, assignee: null };

  it('shows an ordinary task to everyone', () => {
    assert.equal(db.canUserSeeTask(offen, 'anton', false), true);
  });

  it("hides a colleague's private task", () => {
    assert.equal(db.canUserSeeTask(privatFremd, 'anton', false), false);
  });

  it('shows a private task to the person it is for', () => {
    assert.equal(db.canUserSeeTask(privatEigen, 'anton', false), true);
  });

  it('splits a multi-assignee list the same way canUserModifyTask does', () => {
    assert.equal(db.canUserSeeTask(privatGeteilt, 'anton', false), true);
    assert.equal(db.canUserSeeTask(privatGeteilt, 'carla', false), false);
  });

  it('shows everything to an admin', () => {
    assert.equal(db.canUserSeeTask(privatFremd, 'anton', true), true);
  });

  it('leaves a private task with nobody assigned visible, deliberately', () => {
    // There is no created_by column, so such a row belongs to nobody. Hiding it
    // would lose the note for whoever typed it with no way to get it back, and
    // the checkbox's own words say nothing about the case where there is no
    // assigned person. Pinned so the decision is a decision and not a slip.
    assert.equal(db.canUserSeeTask(privatNiemand, 'anton', false), true);
  });

  it('fails closed on a row that does not carry the flag at all', () => {
    // A mapper that forgets the column must not quietly come to mean "public" —
    // that is exactly how the MCP briefing kept handing out what the web
    // payload had started filtering.
    assert.equal(db.canUserSeeTask({ assignee: 'britta' }, 'anton', false), false);
    assert.equal(db.canUserSeeTask(null, 'anton', false), false);
    assert.equal(db.canUserSeeTask(undefined, 'anton', false), false);
  });
});

describe('every task mapper carries the flag the filter asks about', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_priv_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    db.insertTask(d, {
      text: 'Krankmeldung Britta',
      assignee: 'britta',
      private: true,
      created: '2026-08-20T00:00:00Z'
    });
    db.insertTask(d, { text: 'Regale wischen', assignee: 'anton', created: '2026-08-20T00:00:00Z' });
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('readAll does', () => {
    for (const t of db.readAll(d).manualTasks) assert.notEqual(t.private, undefined);
  });

  it('getAllTasks does — it did not, and that was the second door', () => {
    for (const t of db.getAllTasks(d)) assert.notEqual(t.private, undefined);
  });

  it('so a worker sees only their own through either of them', () => {
    const sichtbar = (rows, wer) => rows.filter((t) => db.canUserSeeTask(t, wer, false)).map((t) => t.text);
    assert.deepEqual(sichtbar(db.readAll(d).manualTasks, 'anton'), ['Regale wischen']);
    assert.deepEqual(sichtbar(db.getAllTasks(d), 'anton'), ['Regale wischen']);
    assert.equal(sichtbar(db.readAll(d).manualTasks, 'britta').length, 2);
  });
});

describe('the MCP briefing applies the same filter', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_privmcp_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    db.insertTask(d, {
      text: 'Abmahnung vorbereiten',
      assignee: 'britta',
      private: true,
      created: '2026-08-20T00:00:00Z'
    });
    db.insertTask(d, { text: 'Regale wischen', assignee: 'anton', created: '2026-08-20T00:00:00Z' });
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  const briefing = async (auth) => {
    const server = createMcpServer(d, () => {}, { auth });
    const t = server._registeredTools['daily_briefing'];
    assert.ok(t && typeof t.handler === 'function', 'daily_briefing is gone or the SDK renamed the callback');
    return t.handler({}, {});
  };

  it("does not hand a worker a colleague's private task", async () => {
    const text = JSON.stringify(await briefing({ userId: 2, role: 'user', username: 'anton' }));
    assert.equal(text.includes('Abmahnung'), false, 'the private task must not be in the briefing');
    assert.ok(text.includes('Regale wischen'), 'and the ordinary one still is');
  });

  it('still hands it to the person it is for', async () => {
    const text = JSON.stringify(await briefing({ userId: 3, role: 'user', username: 'britta' }));
    assert.ok(text.includes('Abmahnung'), 'their own task must not disappear');
  });

  it('still hands it to an admin', async () => {
    const text = JSON.stringify(await briefing({ userId: 1, role: 'admin', username: 'chefin' }));
    assert.ok(text.includes('Abmahnung'));
  });
});

describe('the wiring', () => {
  it('filters in the /api/data handler, not inside readAll', () => {
    // readAll is also the admin write-back path's reader and needs the rows
    // whole; filtering there would corrupt it.
    const handler = SRC.slice(SRC.indexOf('const payload = readData();'));
    const filter = handler.indexOf('db.canUserSeeTask');
    const ende = handler.indexOf('res.end(JSON.stringify(payload))');
    assert.ok(filter >= 0, 'the filter is not in the handler at all');
    assert.ok(ende > filter, 'and it runs before the payload goes out');
    const readAll = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8').match(/function readAll\([\s\S]*?\n\}/);
    assert.ok(readAll && !readAll[0].includes('canUserSeeTask'), 'readAll must stay unfiltered');
  });

  it('carries the username through MCP auth, or a worker loses their own tasks', () => {
    // The filter asks whether a row is assigned to this *person*, and an
    // assignee is stored as a name. Without the name it would fail closed —
    // correct in direction, wrong in effect, and reported as data loss.
    assert.match(SRC, /SELECT role, username FROM users WHERE id = \?/);
    assert.match(SRC, /return \{ userId: oauthToken\.userId, role, username \};/);
  });
});
