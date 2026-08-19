'use strict';
// Two accounts, one personal calendar.
//
// A CalDAV personal calendar lives at a slug derived from the username:
//
//     username.toLowerCase().replace(/[^a-z0-9]+/g, '-')
//
// and checkCalendarAccess granted access on nothing more than a slug match.
// The username charset is [A-Za-z0-9._-], and every one of '.', '_' and '-'
// collapses to the same character — so bob.smith, bob_smith, bob-smith and
// Bob.Smith all produce "bob-smith". createUser rejected case-insensitive
// *exact* duplicates and knew nothing about this weaker equality, so two
// accounts could end up reading and writing each other's private calendar.
//
// It takes an admin creating both accounts, so the likelihood is low. The
// naming drift that produces it is not exotic though — anna.mueller in one
// month and anna_mueller in the next is how it actually happens.
//
// Two halves: createUser refuses the second name, and a database that already
// holds such a pair fails closed rather than sharing the calendar. Denying a
// personal calendar is worse than nothing only until you consider what the
// alternative grants.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

describe('caldavSlug', () => {
  it('collapses every separator to the same thing', () => {
    for (const u of ['bob.smith', 'bob_smith', 'bob-smith', 'Bob.Smith', 'BOB__SMITH', 'bob.-_smith']) {
      assert.equal(db.caldavSlug(u), 'bob-smith', u + ' should slug to bob-smith');
    }
  });

  it('leaves distinct names distinct', () => {
    assert.equal(db.caldavSlug('anna'), 'anna');
    assert.notEqual(db.caldavSlug('anna'), db.caldavSlug('anna2'));
  });
});

describe('createUser rejects a colliding name', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_slug_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('accepts the first one', () => {
    db.createUser(d, 'bob.smith', 'a reasonable password', 'user');
    assert.ok(db.getUserByUsername(d, 'bob.smith'));
  });

  it('refuses every separator variant of it', () => {
    for (const u of ['bob_smith', 'bob-smith', 'BOB.SMITH']) {
      assert.throws(
        () => db.createUser(d, u, 'a reasonable password', 'user'),
        /already exists|conflicts with existing user/,
        u + ' was accepted alongside bob.smith'
      );
    }
    assert.equal(d.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
  });

  it('names the account that has to be renamed, and the message reaches the admin', () => {
    let msg = '';
    try {
      db.createUser(d, 'bob_smith', 'a reasonable password', 'user');
    } catch (e) {
      msg = e.message;
    }
    assert.match(msg, /bob\.smith/);
    // Otherwise the admin gets a bare 500 and no idea what to change. The route
    // is admin-only, so naming the existing account leaks nothing.
    assert.equal(db.isSafeError(msg), true);
  });

  it('still lets a genuinely different name through', () => {
    db.createUser(d, 'anna.mueller', 'a reasonable password', 'user');
    assert.ok(db.getUserByUsername(d, 'anna.mueller'));
  });
});

describe('findCaldavSlugCollisions', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_slug2_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('is empty on a healthy database', () => {
    db.createUser(d, 'anna.mueller', 'a reasonable password', 'user');
    db.createUser(d, 'bob', 'a reasonable password', 'user');
    assert.deepEqual(db.findCaldavSlugCollisions(d), []);
  });

  it('finds a pair that predates the guard', () => {
    // Inserted straight into the table, the way an older release left it.
    d.prepare('INSERT INTO users(username, hash, salt, role, created) VALUES(?,?,?,?,?)').run(
      'anna_mueller',
      'x',
      'y',
      'user',
      new Date().toISOString()
    );
    const found = db.findCaldavSlugCollisions(d);
    assert.equal(found.length, 1);
    assert.equal(found[0].slug, 'anna-mueller');
    assert.deepEqual(found[0].names.sort(), ['anna.mueller', 'anna_mueller']);
  });
});

describe('checkCalendarAccess', () => {
  const fn = SRC.match(/function checkCalendarAccess\(req, calName\) \{[\s\S]*?\n\}/)[0];

  it('still lets the owner and admins in, and nobody else', () => {
    assert.match(fn, /if \(req\.caldavUser\.role === 'admin'\) return true;/);
    assert.match(fn, /if \(req\.caldavUserSlug !== calName\) return false;/);
  });

  it('denies when the slug belongs to more than one account', () => {
    assert.match(fn, /owners\.length > 1/);
    const deny = fn.indexOf('owners.length > 1');
    assert.match(fn.slice(deny, deny + 400), /return false;/);
  });

  it('says something an operator can act on when it does', () => {
    assert.match(fn, /log\('warn'/);
    assert.match(fn, /users: owners\.map\(\(u\) => u\.username\)/);
  });

  it('uses the shared slug helper, not its own copy of the regex', () => {
    assert.match(fn, /db\.caldavSlug\(u\.username\)/);
    assert.equal(
      /toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\+\/g, '-'\)/.test(SRC),
      false,
      'an inline copy will drift away from db.caldavSlug'
    );
  });

  it('startup says so too, since a denied calendar is otherwise silent', () => {
    assert.match(SRC, /db\.findCaldavSlugCollisions\(database\)/);
  });
});
