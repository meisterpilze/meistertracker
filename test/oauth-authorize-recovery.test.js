'use strict';
// The other side of the sweep in deleteExpiredOAuthData: what happens to a
// client that was swept and does not know it.
//
// mcp-remote caches its dynamic registration under ~/.mcp-auth and reuses the
// client_id for ever. Register once, never finish the consent, and a day later
// the row is gone — but the cache is not, so every start presents the same dead
// id, and the 400 it earns is rendered in the browser tab the proxy just
// opened, never returned to the proxy. It waits on its callback port, times
// out, and the next session opens another tab. One installation did this 55
// times over four months without a single completed flow.
//
// Two things had to change, and both are load-bearing on their own: the sweep
// now counts a consent screen as use, so the gap between "asked" and "clicked"
// is no longer fatal; and the one page a person actually sees says which cache
// to delete.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// The route lives inside handleRequest and cannot be required on its own, so it
// is read where it is written — the same approach oauth-registration-bounds
// takes, and for the same reason.
const routeGet = (() => {
  const von = SRC.indexOf("req.url.startsWith('/oauth/authorize')");
  assert.ok(von > 0, 'the authorize route has moved');
  const bis = SRC.indexOf("if (req.method === 'POST')", von);
  assert.ok(bis > von, 'the GET branch no longer ends at the POST branch');
  return SRC.slice(von, bis);
})();

describe('showing the consent screen counts as use', () => {
  it('stamps the client on the way to the screen', () => {
    assert.ok(
      routeGet.includes('db.touchOAuthClient(database, clientId)'),
      'nothing marks the client when consent is shown — a person who closes the tab loses the registration'
    );
  });

  it('stamps it before the page goes out, not after', () => {
    // Presence alone is not the property. Written after res.end the stamp still
    // usually lands, but the response is already flushed and any throw in
    // between leaves the client exactly as unrecoverable as before.
    const stempel = routeGet.indexOf('db.touchOAuthClient(database, clientId)');
    const seite = routeGet.indexOf('<h1>Authorize Access</h1>');
    assert.ok(seite > 0, 'the consent page has moved');
    assert.ok(stempel >= 0 && stempel < seite, 'the client is marked only after the page is written');
  });

  it('stays behind the session check, so registration spam cannot reach it', () => {
    // This is what keeps S-25 intact. POST /oauth/register is unauthenticated
    // by design; if an unauthenticated caller could reach the stamp it could
    // keep its own rows alive for ever and the sweep would stop bounding
    // anything.
    const wache = routeGet.indexOf('checkAuth(req)');
    const stempel = routeGet.indexOf('db.touchOAuthClient(database, clientId)');
    assert.ok(wache >= 0, 'the session check has moved');
    assert.ok(wache < stempel, 'the stamp is reachable without a session');
  });
});

describe('and an id that was swept anyway explains itself', () => {
  const zweig = (() => {
    const von = routeGet.indexOf('if (!client) {');
    assert.ok(von > 0, 'the unknown-client branch has moved');
    return routeGet.slice(von, routeGet.indexOf('client.redirectUris.includes', von));
  })();

  it('answers with a page, not with JSON', () => {
    // Every other /oauth/ error is read by a machine. This one is only ever
    // read by a person: the route is where a client sends its user, so a bare
    // {"error":"invalid client_id"} is addressed to nobody who is looking.
    assert.ok(zweig.includes("'Content-Type': 'text/html; charset=utf-8'"), 'the answer is not a page');
    assert.ok(!zweig.includes('jsonErr('), 'the answer is still JSON');
  });

  it('keeps the 400 — the request really is bad', () => {
    assert.ok(/writeHead\(400,/.test(zweig), 'the status code is no longer 400');
  });

  it('names the cache the reader has to delete', () => {
    // Without this the page is only a prettier dead end. The fix is on the
    // reader's own disk and nothing else on the screen can point at it.
    assert.ok(zweig.includes('~/.mcp-auth'), 'the page does not say where the stale registration is kept');
  });

  it('leaves a warning in the log for whoever runs the instance', () => {
    assert.ok(
      /log\('warn', 'OAuth authorize: unknown client_id'/.test(zweig),
      'a swept client fails silently as far as the operator is concerned'
    );
  });

  it('does not put the client_id back on the page', () => {
    // It is in the address bar already, so echoing it buys nothing and would
    // need escaping to stay safe. Not interpolating it is the cheaper guarantee.
    const html = zweig.slice(zweig.indexOf('<!DOCTYPE html>'));
    assert.ok(!html.includes('${'), 'the page interpolates something — check it is escaped');
  });
});

describe('the sweep honours the stamp on its own', () => {
  let d, p;
  const tage = (n) => new Date(Date.now() + n * 86400000).toISOString();

  before(() => {
    p = path.join(os.tmpdir(), 'mt_oauth_rec_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  const anlegen = (id, alter) => {
    db.registerOAuthClient(d, {
      clientId: id,
      clientName: 'MCP CLI Proxy',
      redirectUris: ['http://localhost:4416/oauth/callback']
    });
    d.prepare('UPDATE oauth_clients SET created = ? WHERE client_id = ?').run(tage(alter), id);
  };
  const da = (id) => !!d.prepare('SELECT client_id FROM oauth_clients WHERE client_id = ?').get(id);

  it('keeps a client that only ever reached consent', () => {
    // No code, no token — the person looked at the screen and went to bed. This
    // is the case that used to be indistinguishable from a drive-by
    // registration, and the one the cached id cannot survive.
    anlegen('nur-consent', -2);
    db.touchOAuthClient(d, 'nur-consent');
    db.deleteExpiredOAuthData(d);
    assert.equal(da('nur-consent'), true);
  });

  it('still sweeps one that never got that far', () => {
    // The bound has to keep biting, or the change traded a trap for a leak.
    anlegen('nie-gesehen', -2);
    db.deleteExpiredOAuthData(d);
    assert.equal(da('nie-gesehen'), false);
  });
});
