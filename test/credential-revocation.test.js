'use strict';
// What a password change actually ends.
//
// Both password paths — PATCH /api/auth/password and the admin's
// PATCH /api/users/:id/password — called deleteSessionsByUserId and stopped
// there. That kills the browser cookies and nothing else. The account also has
// OAuth grants: an access token good for an hour, a refresh token good for 30
// days, and any authorization code issued but not yet exchanged. /mcp accepts a
// token minted from that refresh token and resolves the *live* role for it, so
// an attacker who had gone through the OAuth flow kept full access — admin
// included — for a month after the victim did the one thing everybody is told
// to do when an account looks compromised.
//
// db.deleteUser already got this right and said so in a comment (I-16); the
// password paths were simply never given the same treatment. The three DELETEs
// now live in one helper, and the sessions-only helper is gone — there is no
// longer a half-measure to reach for by accident.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_revoke_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

describe('revokeUserCredentials', () => {
  let d, p, victim, bystander;

  const grantEverything = (userId, tag) => {
    db.createSession(d, userId);
    db.createOAuthToken(d, {
      token: 'access-' + tag,
      tokenType: 'access',
      clientId: 'client-' + tag,
      userId,
      expiresInSeconds: 3600
    });
    db.createOAuthToken(d, {
      token: 'refresh-' + tag,
      tokenType: 'refresh',
      clientId: 'client-' + tag,
      userId,
      expiresInSeconds: 30 * 24 * 3600
    });
    db.createOAuthCode(d, {
      code: 'code-' + tag,
      clientId: 'client-' + tag,
      userId,
      redirectUri: 'http://127.0.0.1:9999/cb',
      codeChallenge: 'x'.repeat(43)
    });
  };

  const counts = (userId) => ({
    sessions: d.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(userId).n,
    tokens: d.prepare('SELECT COUNT(*) n FROM oauth_tokens WHERE user_id=?').get(userId).n,
    codes: d.prepare('SELECT COUNT(*) n FROM oauth_codes WHERE user_id=?').get(userId).n
  });

  before(() => {
    ({ db: d, path: p } = tmpDb());
    // createUser returns the public shape, not the row — read the id back.
    const mk = (name, role) => {
      db.createUser(d, name, 'correct horse battery ' + name, role);
      return db.getUserByUsername(d, name).id;
    };
    victim = mk('victim', 'admin');
    bystander = mk('bystander', 'user');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });
  beforeEach(() => {
    d.prepare('DELETE FROM sessions').run();
    d.prepare('DELETE FROM oauth_tokens').run();
    d.prepare('DELETE FROM oauth_codes').run();
    grantEverything(victim, 'v');
    grantEverything(bystander, 'b');
  });

  it('starts from a state where the tokens really are live', () => {
    assert.deepEqual(counts(victim), { sessions: 1, tokens: 2, codes: 1 });
    assert.ok(db.getOAuthAccessToken(d, 'access-v'), 'access token should be usable before the revoke');
    assert.ok(db.getOAuthRefreshToken(d, 'refresh-v'), 'refresh token should be usable before the revoke');
  });

  it('ends the sessions, both token kinds, and the unexchanged code', () => {
    db.revokeUserCredentials(d, victim);
    assert.deepEqual(counts(victim), { sessions: 0, tokens: 0, codes: 0 });
    assert.equal(db.getOAuthAccessToken(d, 'access-v'), null);
    assert.equal(db.getOAuthRefreshToken(d, 'refresh-v'), null, 'the 30-day refresh token is the one that mattered');
    assert.equal(db.getOAuthCode(d, 'code-v'), null);
  });

  it('touches nobody else', () => {
    db.revokeUserCredentials(d, victim);
    assert.deepEqual(counts(bystander), { sessions: 1, tokens: 2, codes: 1 });
    assert.ok(db.getOAuthRefreshToken(d, 'refresh-b'));
  });

  it('is idempotent, and fine for a user who never used OAuth', () => {
    db.revokeUserCredentials(d, victim);
    db.revokeUserCredentials(d, victim);
    db.revokeUserCredentials(d, 999999);
    assert.deepEqual(counts(victim), { sessions: 0, tokens: 0, codes: 0 });
  });

  it('leaves a session issued afterwards alone — the user stays logged in', () => {
    db.revokeUserCredentials(d, victim);
    const fresh = db.createSession(d, victim);
    assert.ok(db.getSession(d, fresh), 'the self-service path issues a new cookie right after revoking');
    assert.deepEqual(counts(victim), { sessions: 1, tokens: 0, codes: 0 });
  });

  it('deleteUser still clears the same set', () => {
    db.createUser(d, 'doomed', 'another password entirely', 'user');
    const doomed = db.getUserByUsername(d, 'doomed').id;
    grantEverything(doomed, 'd');
    db.deleteUser(d, doomed);
    assert.deepEqual(counts(doomed), { sessions: 0, tokens: 0, codes: 0 });
  });
});

describe('both password paths revoke', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  // The handler body, from its route line to the next route.
  function routeBody(marker) {
    const lines = SRC.split('\n');
    const start = lines.findIndex((l) => l.includes(marker));
    assert.ok(start >= 0, 'route not found: ' + marker);
    let end = start + 1;
    while (end < lines.length && !/^\s*if \((url|req)\./.test(lines[end])) end++;
    return lines.slice(start, end).join('\n');
  }

  it('PATCH /api/auth/password', () => {
    assert.match(routeBody("url === '/api/auth/password'"), /db\.revokeUserCredentials\(database, user\.id\)/);
  });

  it('PATCH /api/users/:id/password', () => {
    assert.match(routeBody('/^\\/api\\/users\\/\\d+\\/password$/'), /db\.revokeUserCredentials\(database, userId\)/);
  });

  it('the sessions-only helper is gone, so it cannot be reached for again', () => {
    assert.equal(/deleteSessionsByUserId/.test(SRC), false, 'server.js still references the half-measure');
    assert.equal(
      /deleteSessionsByUserId/.test(fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8')),
      false,
      'db.js still exports the half-measure'
    );
  });
});
