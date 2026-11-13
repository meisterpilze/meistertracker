'use strict';
// Glocke: eine Meldung, die erledigt ist, muss aus der Liste gehen. Von Hand
// (Erledigt, mit Rueckgaengig) und von selbst, wenn die Sache dahinter erledigt
// ist: ein Regalfach, das wieder ueber seinem Alarm liegt, meldet nicht weiter
// "Nachproduzieren".
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');

describe('Meldungen erledigen', () => {
  let d, p, erika, max;

  before(() => {
    p = path.join(os.tmpdir(), 'mt_notif_dismiss_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    db.createUser(d, 'erika', 'a reasonable password', 'admin');
    db.createUser(d, 'max', 'a reasonable password', 'user');
    erika = db.getUserByUsername(d, 'erika').id;
    max = db.getUserByUsername(d, 'max').id;
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });
  beforeEach(() => {
    d.prepare('DELETE FROM notifications').run();
  });

  const note = (userId, linkId) =>
    db.createNotification(d, { userId, type: 'test', title: 'Testmeldung', linkType: 'x', linkId: String(linkId) });

  it('Erledigt nimmt sie aus Liste und Zaehler, Rueckgaengig holt sie zurueck', () => {
    const id = Number(note(erika, 1));
    note(erika, 2);
    assert.equal(db.countUnreadNotifications(d, erika), 2);
    assert.equal(db.dismissNotifications(d, erika, [id]), 1);
    assert.deepEqual(
      db.listNotifications(d, erika).map((n) => n.linkId),
      ['2']
    );
    assert.equal(db.countUnreadNotifications(d, erika), 1);
    assert.equal(db.dismissNotifications(d, erika, [id], true), 1);
    assert.equal(db.listNotifications(d, erika).length, 2);
    assert.equal(db.countUnreadNotifications(d, erika), 1, 'zurueckgeholt ist sie gelesen');
  });

  it('nur die eigenen', () => {
    const id = Number(note(max, 1));
    assert.equal(db.dismissNotifications(d, erika, [id]), 0);
    assert.equal(db.listNotifications(d, max).length, 1);
  });

  it('nach Erledigt meldet sich dieselbe Sache neu', () => {
    const payload = { userId: erika, type: 'test', title: 'Testmeldung', linkType: 'x', linkId: '1' };
    const first = Number(db.createNotificationOnce(d, payload));
    db.dismissNotifications(d, erika, [first]);
    const second = Number(db.createNotificationOnce(d, payload));
    assert.notEqual(second, first);
    assert.equal(db.listNotifications(d, erika).length, 1);
  });

  it('Nachproduzieren geht bei allen weg, sobald das Fach wieder ueber dem Alarm liegt', () => {
    const a = db.createShelfItem(d, 'Testbeutel Glocke');
    db.moveShelfStock(d, a.id, { count: 30 }, null);
    db.shelfLowAlerts(d); // andere Testfaecher melden sich hier einmal
    db.moveShelfStock(d, a.id, { count: 2 }, null);
    assert.deepEqual(
      db.shelfLowAlerts(d).map((x) => x.id),
      [a.id]
    );
    for (const userId of [erika, max]) {
      db.createNotificationOnce(d, {
        userId,
        type: 'shelf_low',
        title: 'Nachproduzieren: Testbeutel Glocke',
        linkType: 'shelf',
        linkId: String(a.id)
      });
    }
    db.moveShelfStock(d, a.id, { delta: 5 }, null);
    db.shelfLowAlerts(d);
    assert.equal(db.listNotifications(d, erika).length, 1, 'bei 7 von 10 ist es noch zu wenig');
    db.moveShelfStock(d, a.id, { delta: 20 }, null);
    db.shelfLowAlerts(d);
    assert.equal(db.listNotifications(d, erika).length, 0);
    assert.equal(db.listNotifications(d, max).length, 0);
    assert.equal(db.countUnreadNotifications(d, max), 0);
  });
});

describe('die Glocke zeigt Erledigt', () => {
  const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  it('jede Meldung hat ihren Erledigt-Knopf, mit Rueckgaengig', () => {
    assert.match(APP, /class="notif-done"/);
    const fn = APP.slice(APP.indexOf('function onNotifDoneClick'), APP.indexOf('function onNotifItemClick'));
    assert.match(fn, /showUndoBar\(/);
    assert.match(fn, /undo: true/);
  });

  it('der Server nimmt nur die eigenen', () => {
    const at = SRV.indexOf("url === '/api/notifications/dismiss'");
    assert.ok(at > 0);
    assert.match(SRV.slice(at, at + 1200), /dismissNotifications\(database, req\.authUser\.user_id/);
  });
});
