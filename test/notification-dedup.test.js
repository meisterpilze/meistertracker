'use strict';
// One notification per thing, not one per request.
//
// POST /api/channels/ebay/deletion is exempt from the session gate by
// necessity — eBay calls it from its own infrastructure — and the POST carries
// no signature this server verifies yet. The handler is careful about the part
// that matters: it deliberately does NOT erase anything, it records the request
// and leaves the erasure to an admin.
//
// Recording is the whole effect, then, and it was one row per admin per
// request. findCustomerByIdentity falls back to matching on email address, so
// anyone who knew a customer's email could repeat the call and produce
// notifications indefinitely. Nothing is destroyed by that, but a notification
// list buried under duplicates is how the real one gets missed — and there is
// no UI for these yet, so the list is the entire surface.
//
// Unread is the right key rather than "ever seen". A second request about a
// customer whose first is still sitting unread adds nothing; one arriving after
// the admin dealt with the last is a new event and should say so.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');

describe('createNotificationOnce', () => {
  let d, p, adminA, adminB;

  const notify = (userId, linkId) =>
    db.createNotificationOnce(d, {
      userId,
      type: 'ebay-deletion',
      title: 'eBay account closure',
      body: 'Customer #' + linkId + ' requested erasure.',
      linkType: 'customer',
      linkId: String(linkId)
    });

  const countFor = (userId) => d.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=?').get(userId).c;

  before(() => {
    p = path.join(os.tmpdir(), 'mt_notif_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    db.createUser(d, 'admin.one', 'a reasonable password', 'admin');
    db.createUser(d, 'admin.two', 'a reasonable password', 'admin');
    adminA = db.getUserByUsername(d, 'admin.one').id;
    adminB = db.getUserByUsername(d, 'admin.two').id;
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });
  beforeEach(() => {
    d.prepare('DELETE FROM notifications').run();
  });

  it('creates the first one', () => {
    const id = notify(adminA, 42);
    assert.ok(id);
    assert.equal(countFor(adminA), 1);
  });

  it('a flood of repeats adds nothing', () => {
    const first = notify(adminA, 42);
    for (let i = 0; i < 500; i++) {
      assert.equal(notify(adminA, 42), first, 'a repeat should return the existing row');
    }
    assert.equal(countFor(adminA), 1);
  });

  it('still tells every admin', () => {
    notify(adminA, 42);
    notify(adminB, 42);
    assert.equal(countFor(adminA), 1);
    assert.equal(countFor(adminB), 1);
  });

  it('a different customer is a different notification', () => {
    notify(adminA, 42);
    notify(adminA, 43);
    assert.equal(countFor(adminA), 2);
  });

  it('notifies again once the admin has dealt with the last one', () => {
    notify(adminA, 42);
    db.markNotificationsRead(d, adminA, null);
    notify(adminA, 42);
    assert.equal(countFor(adminA), 2, 'a request after the previous one was handled is a new event');
    assert.equal(d.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0').get(adminA).c, 1);
  });

  it('does not collapse unrelated types onto each other', () => {
    notify(adminA, 42);
    db.createNotificationOnce(d, {
      userId: adminA,
      type: 'something-else',
      title: 'Unrelated',
      linkType: 'customer',
      linkId: '42'
    });
    assert.equal(countFor(adminA), 2);
  });

  it('treats a missing link as its own key rather than a wildcard', () => {
    // NULL = NULL is not true in SQL; the lookup has to use IS.
    const first = db.createNotificationOnce(d, { userId: adminA, type: 'plain', title: 'No link' });
    const second = db.createNotificationOnce(d, { userId: adminA, type: 'plain', title: 'No link' });
    assert.equal(second, first);
    assert.equal(countFor(adminA), 1);
    db.createNotificationOnce(d, { userId: adminA, type: 'plain', title: 'With link', linkId: '7' });
    assert.equal(countFor(adminA), 2, 'a linked notification is not the same as an unlinked one');
  });

  it('validates like createNotification does', () => {
    assert.throws(() => db.createNotificationOnce(d, { userId: adminA, type: 'x' }), /title required/);
    assert.throws(() => db.createNotificationOnce(d, { type: 'x', title: 'y' }), /userId/);
  });
});

describe('the eBay deletion endpoint uses it', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const handler = (() => {
    // The route pattern appears twice — once in the auth-gate exemption list and
    // once at the handler. Anchor on the handler's own banner comment.
    const at = SRC.indexOf('eBay Marketplace Account Deletion / Closure');
    assert.ok(at > 0, 'the eBay deletion route has moved');
    return SRC.slice(at, SRC.indexOf('-- DuckDNS Config --', at));
  })();

  it('deduplicates the admin fan-out', () => {
    assert.match(handler, /db\.createNotificationOnce\(database, \{/);
    assert.equal(/db\.createNotification\(database, \{/.test(handler), false);
  });

  it('still notifies every admin, not just the first', () => {
    assert.match(
      handler,
      /for \(const u of db\.listUsers\(database\)\) \{\s*\n\s*if \(u\.role !== 'admin'\) continue;/
    );
  });

  it('still refuses to erase anything on its own', () => {
    // The important property of this endpoint, pinned so a later change to the
    // notification behaviour cannot quietly bring automatic erasure back.
    assert.match(handler, /NOT erased automatically/);
    assert.equal(/eraseCustomer|db\.erase/.test(handler), false);
  });
});
