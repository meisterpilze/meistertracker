'use strict';
// What the sessions table gives away when somebody reads the database file.
//
// sessions.token held the exact 32 bytes the browser holds in its __Host-session
// cookie. So one read of the file — a stray backup, a filesystem snapshot, an
// ops copy handed over for debugging — was every live session, for up to the
// full seven-day TTL, with no cracking required. SECURITY.md puts physical
// database access out of scope, which is a fair line to draw, but the MCP token
// two tables over was already stored as a SHA-256 hash: the pattern was in the
// schema, sessions just never got it.
//
// A plain digest is the right primitive here, unlike for passwords. The token is
// 32 bytes of CSPRNG output, so there is no guessable input for a KDF to slow
// down, and the lookup stays one indexed equality.
//
// Migration v71 rewrites the existing rows instead of emptying the table, so
// deploying this does not sign everybody out — the cookies people are already
// holding keep working, they just stop matching anything readable in the file.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function tmpPath(tag) {
  return path.join(os.tmpdir(), 'mt_' + tag + '_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
}

describe('sessions are stored hashed', () => {
  let d, p, userId;
  before(() => {
    p = tmpPath('sess');
    d = db.openDb(p);
    db.createUser(d, 'alice', 'a reasonable password', 'admin');
    userId = db.getUserByUsername(d, 'alice').id;
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('hands back a token that is not what the row holds', () => {
    const token = db.createSession(d, userId);
    assert.match(token, /^[a-f0-9]{64}$/);
    const stored = d
      .prepare('SELECT token FROM sessions WHERE user_id=?')
      .all(userId)
      .map((r) => r.token);
    assert.equal(stored.includes(token), false, 'the cookie value is sitting in the table in the clear');
    assert.ok(stored.includes(sha256(token)), 'the row should hold sha256 of the token');
  });

  it('nothing in the table lets you reconstruct a cookie', () => {
    db.createSession(d, userId);
    for (const r of d.prepare('SELECT token FROM sessions').all()) {
      assert.match(r.token, /^[a-f0-9]{64}$/);
    }
  });

  it('the round trip still works from the caller side', () => {
    const token = db.createSession(d, userId);
    const s = db.getSession(d, token);
    assert.ok(s);
    assert.equal(s.username, 'alice');
    assert.equal(s.role, 'admin');
  });

  it('does not hand the stored hash back out', () => {
    // Returning it would only invite somebody to treat it as the cookie again.
    const token = db.createSession(d, userId);
    assert.equal('token' in db.getSession(d, token), false);
  });

  it('presenting the hash instead of the token gets you nowhere', () => {
    // The obvious way to get this wrong is to hash on write and not on read;
    // then whoever read the file could authenticate with what they found.
    const token = db.createSession(d, userId);
    assert.equal(db.getSession(d, sha256(token)), undefined);
  });

  it('rejects an unknown token, and deletes by the plaintext one', () => {
    assert.equal(db.getSession(d, 'deadbeef'.repeat(8)), undefined);
    const token = db.createSession(d, userId);
    db.deleteSession(d, token);
    assert.equal(db.getSession(d, token), undefined);
  });

  it('still enforces the per-user session cap', () => {
    d.prepare('DELETE FROM sessions').run();
    const tokens = [];
    for (let i = 0; i < 12; i++) tokens.push(db.createSession(d, userId));
    const n = d.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id=?').get(userId).c;
    assert.ok(n < 12, 'oldest sessions should have been evicted, found ' + n);
    // The most recent one is always still valid.
    assert.ok(db.getSession(d, tokens[tokens.length - 1]));
  });
});

describe('migration v71', () => {
  it('hashes the rows that are already there, without logging anyone out', () => {
    const p = tmpPath('sessmig');
    let d = db.openDb(p);
    db.createUser(d, 'bob', 'another reasonable password', 'user');
    const userId = db.getUserByUsername(d, 'bob').id;

    // A session row exactly as the old code wrote it: the cookie value itself.
    const legacyToken = crypto.randomBytes(32).toString('hex');
    d.prepare('INSERT INTO sessions(token, user_id, created, expires) VALUES(?,?,?,?)').run(
      legacyToken,
      userId,
      new Date().toISOString(),
      new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    );
    // Rewind so reopening the database runs the migration over that row.
    d.prepare('DELETE FROM schema_version WHERE version = 71').run();
    d.close();

    d = db.openDb(p);
    try {
      const stored = d.prepare('SELECT token FROM sessions WHERE user_id=?').get(userId).token;
      assert.notEqual(stored, legacyToken, 'the plaintext token survived the migration');
      assert.equal(stored, sha256(legacyToken));
      // The whole point: the cookie in that person's browser still works.
      const s = db.getSession(d, legacyToken);
      assert.ok(s, 'an existing session should survive the deploy');
      assert.equal(s.username, 'bob');
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });

  it('is a no-op on an empty table and runs on a fresh database', () => {
    const p = tmpPath('sessfresh');
    const d = db.openDb(p);
    try {
      const applied = d
        .prepare('SELECT version FROM schema_version')
        .all()
        .map((r) => r.version);
      assert.ok(applied.includes(71));
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });
});
