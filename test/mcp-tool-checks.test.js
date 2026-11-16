'use strict';
// The MCP tools ask what the REST routes ask.
//
// An MCP token is something any user can mint through the OAuth flow, and it
// carries that user's role. Several write tools took their fields without the
// checks of the routes they mirror: update_task changed any task, whoever it
// belonged to; create_culture took any id and wrote over an existing culture;
// move_bags, log_harvest, create_calendar_event and the strain tools took ids,
// times and names the routes refuse; complete_maintenance recorded whatever
// name the caller gave. Each tool here is called the way the SDK calls it.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { createMcpServer } = require('../mcp-server.js');

const ERIKA = { userId: 1, role: 'admin', username: 'erika' };
const MAX = { userId: 7, role: 'user', username: 'max' };

describe('MCP write tools check what the REST routes check', () => {
  let d, p;
  const werkzeug = (auth, name) => {
    const t = createMcpServer(d, () => {}, { auth })._registeredTools[name];
    assert.ok(t && typeof t.handler === 'function', name + ' is gone or the SDK renamed the callback');
    return (args) => t.handler(args, {});
  };
  const fehler = (r) => (r && r.isError ? JSON.parse(r.content[0].text).error : null);
  const aufgabe = (id) => d.prepare('SELECT text, done, assignee FROM manual_tasks WHERE id=?').get(id);

  let erikas, maxens, offene;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_mcp_checks_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    const neu = d.prepare('INSERT INTO users(id,username,hash,salt,role,created) VALUES(?,?,?,?,?,?)');
    neu.run(1, 'erika', 'x', 'y', 'admin', '2026-11-16T08:00:00Z');
    neu.run(7, 'max', 'x', 'y', 'user', '2026-11-16T08:00:00Z');
    erikas = db.insertTask(d, { text: 'Autoklav prüfen', assignee: 'erika', created: '2026-11-16T08:00:00Z' });
    maxens = db.insertTask(d, { text: 'Regal auffüllen', assignee: 'max', created: '2026-11-16T08:00:00Z' });
    offene = db.insertTask(d, { text: 'Lager zählen', created: '2026-11-16T08:00:00Z' });
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  describe('update_task', () => {
    it("leaves a colleague's task alone", async () => {
      const r = await werkzeug(MAX, 'update_task')({ id: Number(erikas), done: true, assignee: 'max' });
      assert.match(fehler(r), /not allowed/);
      assert.deepEqual({ ...aufgabe(erikas) }, { text: 'Autoklav prüfen', done: 0, assignee: 'erika' });
    });

    it('changes the own task and an unassigned one, as PATCH /api/tasks/:id does', async () => {
      assert.equal(fehler(await werkzeug(MAX, 'update_task')({ id: Number(maxens), done: true })), null);
      assert.equal(aufgabe(maxens).done, 1);
      assert.equal(
        fehler(await werkzeug(MAX, 'update_task')({ id: Number(offene), text: 'Lager zählen, Halle 2' })),
        null
      );
      assert.equal(aufgabe(offene).text, 'Lager zählen, Halle 2');
    });

    it('lets an admin change any task', async () => {
      assert.equal(fehler(await werkzeug(ERIKA, 'update_task')({ id: Number(maxens), done: false })), null);
      assert.equal(aufgabe(maxens).done, 0);
    });

    it('does not report success for a task that is not there', async () => {
      assert.ok(fehler(await werkzeug(MAX, 'update_task')({ id: 99999, done: true })));
      assert.ok(fehler(await werkzeug(ERIKA, 'update_task')({ id: 99999, done: true })));
    });

    it('takes a due date only as a date, and no empty text', async () => {
      assert.match(fehler(await werkzeug(MAX, 'update_task')({ id: Number(maxens), dueDate: 'morgen' })), /dueDate/);
      assert.match(fehler(await werkzeug(MAX, 'update_task')({ id: Number(maxens), text: '' })), /text/);
    });
  });

  describe('cultures', () => {
    it('refuses an id outside the id charset', async () => {
      for (const id of ["MC-0'1", 'MC 01', '<b>', 'x'.repeat(201)]) {
        const r = await werkzeug(MAX, 'create_culture')({ id, type: 'MC', species: 'Beispielsorte' });
        assert.match(fehler(r), /id must be/, JSON.stringify(id));
      }
      assert.equal(d.prepare('SELECT COUNT(*) AS n FROM cultures').get().n, 0);
    });

    it('creates a new culture, and refuses to write over an existing one', async () => {
      const anlegen = werkzeug(MAX, 'create_culture');
      assert.equal(fehler(await anlegen({ id: 'MC-0001', type: 'MC', species: 'Beispielsorte' })), null);
      assert.equal(
        fehler(await anlegen({ id: 'PD-0001', type: 'PD', species: 'Beispielsorte', parentId: 'MC-0001' })),
        null
      );
      const r = await anlegen({ id: 'PD-0001', type: 'PD', species: 'Beispielsorte', notes: 'neu' });
      assert.match(fehler(r), /already exists/);
      const pd = db.getCultureById(d, 'PD-0001');
      assert.equal(pd.parentId, 'MC-0001', 'the lineage is kept');
    });

    it('takes a status only from the list the app knows', async () => {
      const aendern = werkzeug(MAX, 'update_culture');
      assert.match(fehler(await aendern({ id: 'MC-0001', status: 'archived' })), /status must be one of/);
      assert.equal(fehler(await aendern({ id: 'MC-0001', status: 'stored' })), null);
      assert.match(fehler(await aendern({ id: 'MC-9999', status: 'stored' })), /not found/);
    });
  });

  describe('create_calendar_event', () => {
    const termin = (extra) => ({ title: 'Teamsitzung', startDate: '2026-11-20', ...extra });
    it('takes times as HH:MM, dates as dates, category and color in their shape', async () => {
      const anlegen = werkzeug(MAX, 'create_calendar_event');
      for (const extra of [
        { startTime: '9 Uhr' },
        { endTime: '25:00' },
        { startDate: 'Freitag' },
        { endDate: 'bald' },
        { category: 'Meeting Raum' },
        { color: 'red' }
      ]) {
        assert.ok(fehler(await anlegen(termin(extra))), JSON.stringify(extra));
      }
      assert.equal(d.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n, 0);
      const ok = await anlegen(termin({ allDay: false, startTime: '09:00', endTime: '10:00', category: 'meeting' }));
      assert.equal(fehler(ok), null);
      assert.equal(d.prepare('SELECT start_time FROM calendar_events').get().start_time, '09:00');
    });
  });

  describe('move_bags and log_harvest', () => {
    it('refuses a bag, batch or zone id outside the id charset', async () => {
      const bewegen = werkzeug(MAX, 'move_bags');
      for (const e of [
        { batch: 'B-01', bag: "B-01-0'1", action: 'ADD', to: 'INC_01' },
        { batch: 'B 01', bag: 'B-01-01', action: 'ADD', to: 'INC_01' },
        { batch: 'B-01', bag: 'B-01-01', action: 'ADD', to: '<i>' },
        { batch: 'B-01', bag: 'B-01-01', action: 'MOVE', from: 'INC 01', to: 'INC_02' }
      ]) {
        assert.match(fehler(await bewegen({ entries: [e] })), /must be alphanumeric/, JSON.stringify(e));
      }
      assert.equal(d.prepare('SELECT COUNT(*) AS n FROM scan_log').get().n, 0);
      const ok = await bewegen({ entries: [{ batch: 'B-01', bag: 'B-01-01', action: 'ADD', to: 'INC_01' }] });
      assert.equal(fehler(ok), null);
    });

    it('keeps a harvest inside the ranges of POST /api/harvests', async () => {
      const ernten = werkzeug(MAX, 'log_harvest');
      for (const args of [
        { batch: 'B-01', grams: 2000000 },
        { batch: 'B-01', grams: -1 },
        { batch: 'B-01', grams: 500, flush: 0 },
        { batch: 'B-01', grams: 500, flush: 1.5 },
        { batch: 'B 01', grams: 500 },
        { batch: 'B-01', bag: 'B-01 01', grams: 500 }
      ]) {
        assert.ok(fehler(await ernten({ species: 'Beispielsorte', strain: 'BS', ...args })), JSON.stringify(args));
      }
      assert.equal(d.prepare('SELECT COUNT(*) AS n FROM harvests').get().n, 0);
      assert.equal(fehler(await ernten({ batch: 'B-01', grams: 500, species: 'Beispielsorte', strain: 'BS' })), null);
    });
  });

  describe('strains and maintenance', () => {
    it('checks a strain the way validateMushroomStrain does', async () => {
      const anlegen = werkzeug(MAX, 'create_mushroom_strain');
      assert.match(fehler(await anlegen({ name: 'Beispielsorte', kuerzel: 'B S' })), /kuerzel/);
      assert.match(fehler(await anlegen({ name: 'Beispielsorte', kuerzel: 'X'.repeat(17) })), /kuerzel/);
      assert.equal(fehler(await anlegen({ name: 'Beispielsorte', kuerzel: 'BS-1' })), null);
    });

    it('records the token user as the one who completed maintenance', async () => {
      const id = db.insertMaintenance(d, { assetId: 'AK-001', type: 'autoclave_cycle', scheduledDate: '2026-11-20' });
      const r = await werkzeug(MAX, 'complete_maintenance')({ id: Number(id), completedBy: 'erika' });
      assert.equal(fehler(r), null);
      assert.equal(d.prepare('SELECT completed_by FROM maintenance_log WHERE id=?').get(id).completed_by, 'max');
      const id2 = db.insertMaintenance(d, { assetId: 'AK-001', type: 'autoclave_cycle', scheduledDate: '2026-11-21' });
      await werkzeug(ERIKA, 'complete_maintenance')({ id: Number(id2), completedBy: 'max' });
      assert.equal(d.prepare('SELECT completed_by FROM maintenance_log WHERE id=?').get(id2).completed_by, 'max');
    });

    it('schedules maintenance only with a plain type, a zone id and a date', async () => {
      const planen = werkzeug(MAX, 'schedule_maintenance');
      for (const args of [
        { type: 'Autoklav <b>', assetId: 'AK-001' },
        { type: 'autoclave_cycle', zoneId: 'INC 01' },
        { type: 'autoclave_cycle', assetId: 'AK-001', scheduledDate: 'bald' }
      ]) {
        assert.ok(fehler(await planen(args)), JSON.stringify(args));
      }
      assert.equal(fehler(await planen({ type: 'hepa_filter', assetId: 'AK-002', scheduledDate: '2026-12-01' })), null);
    });
  });

  describe('update_batch and assign_barcode', () => {
    before(() => {
      db.insertBatch(
        d,
        {
          batchId: 'B-02',
          species: 'Beispielsorte',
          qty: 1,
          days: 14,
          created: '2026-11-16T08:00:00.000Z',
          due: '2026-11-30T08:00:00.000Z',
          bags: ['B-02-01']
        },
        null,
        null
      );
    });

    it('fails for a batch that is not there, and checks days and due', async () => {
      const aendern = werkzeug(MAX, 'update_batch');
      assert.match(fehler(await aendern({ batchId: 'B-99', notes: 'x' })), /not found/);
      assert.match(fehler(await aendern({ batchId: 'B-02', days: 0 })), /days/);
      assert.match(fehler(await aendern({ batchId: 'B-02', due: 'nächste Woche' })), /due/);
      assert.equal(fehler(await aendern({ batchId: 'B-02', due: '2026-12-01T12:00:00.000Z' })), null);
    });

    it('assigns a barcode only to an id in the id charset', async () => {
      const zuweisen = werkzeug(MAX, 'assign_barcode');
      assert.ok(fehler(await zuweisen({ entityType: 'bag', entityId: '<b>' })));
      assert.equal(fehler(await zuweisen({ entityType: 'bag', entityId: 'B-02-01' })), null);
    });

    it('reads a date as a date and nothing behind it', async () => {
      // V8 takes "2026-11-20 (anything)" for a date; the tools do not.
      const anlegen = werkzeug(MAX, 'create_task');
      assert.ok(fehler(await anlegen({ text: 'Regal', dueDate: '2026-11-20 (Freitag)' })));
      assert.equal(fehler(await anlegen({ text: 'Regal', dueDate: '2026-11-20' })), null);
    });
  });
});
