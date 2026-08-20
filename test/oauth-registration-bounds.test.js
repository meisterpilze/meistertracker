'use strict';
// POST /oauth/register — unauthenticated by design, unbounded by accident.
//
// MCP clients register themselves, so the route sits in front of the auth gate
// (RFC 7591, and the MCP OAuth spec requires it). Every call INSERTed a row into
// oauth_clients and nothing ever collected them: deleteExpiredOAuthData reaped
// codes and tokens and left the clients alone. Nothing bounded client_name, the
// number of redirect_uris or their length either, so the only limits were
// checkOAuthRate at 20 a minute per address and MAX_BODY_SIZE at five megabytes.
//
// Both halves are needed. Bounds alone leave 28,800 rows a day accumulating for
// ever; a reaper alone leaves each of them able to carry five megabytes.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

describe('what a registration may carry', () => {
  // The route is inside handleRequest and cannot be lifted out on its own, so
  // the bounds are read where they are declared and the branch that uses them
  // is checked for being there — with presence asserted before order, because
  // indexOf returns -1 for something absent and -1 sorts before everything.
  const grenzen = {
    OAUTH_MAX_CLIENT_NAME: 128,
    OAUTH_MAX_REDIRECT_URIS: 5,
    OAUTH_MAX_URI_LENGTH: 512
  };

  for (const [name, wert] of Object.entries(grenzen)) {
    it(`declares ${name}`, () => {
      const m = SRC.match(new RegExp('const ' + name + ' = ([0-9]+);'));
      assert.ok(m, name + ' is not declared');
      assert.equal(Number(m[1]), wert);
    });
  }

  it('refuses each of them before the row is written', () => {
    const i = SRC.indexOf("req.url === '/oauth/register'", SRC.indexOf('Dynamic Client Registration'));
    assert.ok(i > 0, 'the registration route has moved');
    const route = SRC.slice(i, SRC.indexOf("req.url === '/oauth/token'", i));
    const schreiben = route.indexOf('db.registerOAuthClient(database');
    assert.ok(schreiben > 0, 'the write is not in this slice — the test is looking at the wrong place');
    for (const wache of ['OAUTH_MAX_REDIRECT_URIS', 'OAUTH_MAX_URI_LENGTH', 'OAUTH_MAX_CLIENT_NAME']) {
      const at = route.indexOf(wache);
      assert.ok(at >= 0, wache + ' is not used in the route at all');
      assert.ok(at < schreiben, wache + ' is checked after the row is already written');
    }
  });

  it('types the redirect_uris as well as bounding them', () => {
    // `new URL(uri)` throws on a non-string, and that lands in safeErr as a
    // 500 — our fault by the response code, the caller's by the facts.
    const i = SRC.indexOf("req.url === '/oauth/register'", SRC.indexOf('Dynamic Client Registration'));
    const route = SRC.slice(i, SRC.indexOf("req.url === '/oauth/token'", i));
    const typ = route.indexOf("typeof uri !== 'string'");
    // `u = new URL(uri)` and not `new URL(` — the looser form also matches the
    // sentence in the comment right above the check, and a test that reads
    // prose as code reports an ordering that is not the code's.
    const url = route.indexOf('u = new URL(uri)');
    assert.ok(typ >= 0, 'nothing checks the type');
    assert.ok(url >= 0, 'the URL parse has moved');
    assert.ok(typ < url, 'the type check must come before the URL parse');
  });
});

describe('and how the pile stops growing', () => {
  let d, p;
  const tage = (n) => new Date(Date.now() + n * 86400000).toISOString();

  before(() => {
    p = path.join(os.tmpdir(), 'mt_oauth_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  const anlegen = (id, alter, { secret = null, benutzt = null } = {}) => {
    d.prepare(
      'INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created, client_secret_hash, last_used) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, 'x', '[]', tage(alter), secret, benutzt);
  };
  const da = (id) => !!d.prepare('SELECT client_id FROM oauth_clients WHERE client_id = ?').get(id);

  it('sweeps an auto-registered client that never completed a flow', () => {
    anlegen('nie-benutzt', -2);
    db.deleteExpiredOAuthData(d);
    assert.equal(da('nie-benutzt'), false);
  });

  it('leaves a fresh one alone — register, authorize and token take minutes, not a day', () => {
    anlegen('frisch', 0);
    db.deleteExpiredOAuthData(d);
    assert.equal(da('frisch'), true);
  });

  it('never touches a client an admin created by hand', () => {
    // listOAuthClients already calls a null secret "autoRegistered"; the sweep
    // uses the same distinction rather than inventing a second one.
    anlegen('von-hand', -30, { secret: 'irgendein-hash' });
    db.deleteExpiredOAuthData(d);
    assert.equal(da('von-hand'), true);
  });

  it('keeps one that ever completed a flow, however long ago', () => {
    // ⚠️ This used to ask "does it have any tokens or codes?", and that broke.
    // Tokens go away when they expire and when deleteAuthArtifactsNoTxn runs —
    // which it does on every password change — so one colleague changing their
    // password put every MCP registration on a one-hour fuse. The mark is only
    // ever set, so nothing that happens later can take it back.
    anlegen('einmal-benutzt', -365, { benutzt: tage(-364) });
    db.deleteExpiredOAuthData(d);
    assert.equal(da('einmal-benutzt'), true);
  });

  it('survives its owner changing their password', () => {
    // The case that found the defect, walked end to end.
    db.createUser(d, 'anton', 'passwort-lang-genug', 'user');
    const nutzer = db.getUserByUsername(d, 'anton');
    anlegen('mcp-klient', -30);
    db.createOAuthCode(d, {
      code: 'c-anton',
      clientId: 'mcp-klient',
      userId: nutzer.id,
      redirectUri: 'https://x/cb',
      codeChallenge: 'ch',
      codeChallengeMethod: 'S256'
    });
    assert.ok(
      d.prepare('SELECT last_used FROM oauth_clients WHERE client_id = ?').get('mcp-klient').last_used,
      'issuing a code marks the client as used'
    );
    db.resetUserPassword(d, nutzer.id, 'ein-anderes-passwort');
    db.deleteExpiredOAuthData(d);
    assert.equal(da('mcp-klient'), true, 'a password change must not delete the registration');
  });

  it('marks the client when a token is issued too, not only a code', () => {
    anlegen('nur-token', -30);
    db.createOAuthToken(d, {
      token: 'tok',
      tokenType: 'access',
      clientId: 'nur-token',
      userId: 1,
      expiresInSeconds: 3600
    });
    db.deleteExpiredOAuthData(d);
    assert.equal(da('nur-token'), true);
  });
});
