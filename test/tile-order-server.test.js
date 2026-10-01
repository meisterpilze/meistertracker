'use strict';
// The start-screen tile order is stored on the user, so it follows them to any
// phone they sign in on. The server does not know the tiles; it stores a short
// list of short ids, refuses anything else, and hands it back unchanged.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function tmpPath(tag) {
  return path.join(os.tmpdir(), 'mt_' + tag + '_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
}

describe('tile order per user', () => {
  let d, p, max, erika;
  before(() => {
    p = tmpPath('tiles');
    d = db.openDb(p);
    db.createUser(d, 'max', 'a reasonable password', 'user');
    db.createUser(d, 'erika', 'another reasonable password', 'admin');
    max = db.getUserByUsername(d, 'max').id;
    erika = db.getUserByUsername(d, 'erika').id;
  });
  after(() => {
    d.close();
    for (const f of [p, p + '-wal', p + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
  });

  it('starts with none, meaning the default', () => {
    assert.equal(db.getUserTileOrder(d, max), null);
  });

  it('keeps each user their own order', () => {
    db.setUserTileOrder(d, max, ['harvest', 'move', 'lab']);
    assert.deepEqual(db.getUserTileOrder(d, max), ['harvest', 'move', 'lab']);
    assert.equal(db.getUserTileOrder(d, erika), null);
  });

  it('drops duplicates and goes back to the default with null', () => {
    assert.deepEqual(db.setUserTileOrder(d, max, ['lab', 'lab', 'move']), ['lab', 'move']);
    db.setUserTileOrder(d, max, null);
    assert.equal(db.getUserTileOrder(d, max), null);
  });

  it('refuses anything that is not a short list of short ids', () => {
    for (const bad of [undefined, 'move', [1, 2], ['<b>'], ['x'.repeat(21)], new Array(21).fill('a'), {}]) {
      assert.throws(() => db.setUserTileOrder(d, max, bad), /invalid tile order/, JSON.stringify(bad));
    }
  });

  it('reads a broken stored value as the default instead of failing', () => {
    d.prepare('UPDATE users SET tile_order = ? WHERE id = ?').run('{not json', max);
    assert.equal(db.getUserTileOrder(d, max), null);
  });
});

describe('tile order routes', () => {
  it('sends the order with /api/auth/me', () => {
    assert.match(SERVER, /tileOrder: db\.getUserTileOrder\(database, session\.user_id\)/);
  });

  it('writes only the signed-in user, after the auth gate', () => {
    const route = SERVER.indexOf("url === '/api/me/tile-order'");
    const gate = SERVER.indexOf('req.authUser = authUser;');
    assert.ok(route > gate && gate > 0, 'route sits behind the session gate');
    assert.match(SERVER.slice(route, route + 800), /setUserTileOrder\(database, req\.authUser\.user_id, order\)/);
  });
});
