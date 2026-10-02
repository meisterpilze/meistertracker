'use strict';
// Saving the DuckDNS settings changes what the request sends, and nothing else.
//
// db.updateDuckdnsCfg wrote all four fields every time, so a request that left
// one out reset it: without `leEnabled` the Let's Encrypt renewal was off,
// without `enabled` the updater stopped, without `domain` the name was gone.
// Only the token was kept, by the route. A request that rotated the token and
// sent nothing else would have done all three.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { quelle } = require('./helpers/quelle');

// Made-up values. The route accepts hex digits and dashes for the token.
const DOMAIN = 'example';
const TOKEN_A = 'deadbeef00000000';
const TOKEN_B = 'deadbeef11111111';

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_duckdns_cfg_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

// Everything on, as a configured installation has it.
function configured(d) {
  db.updateDuckdnsCfg(d, { enabled: true, domain: DOMAIN, token: TOKEN_A, leEnabled: true });
}

const settings = (d) => {
  const c = db.getDuckdnsCfg(d);
  return { enabled: c.enabled, domain: c.domain, token: c.token, leEnabled: c.leEnabled };
};
const ALL_ON = { enabled: true, domain: DOMAIN, token: TOKEN_A, leEnabled: true };

describe('db.updateDuckdnsCfg', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('writes every field it is given', () => {
    configured(d);
    assert.deepEqual(settings(d), ALL_ON);
    db.updateDuckdnsCfg(d, { enabled: false, domain: '', token: TOKEN_B, leEnabled: false });
    assert.deepEqual(settings(d), { enabled: false, domain: '', token: TOKEN_B, leEnabled: false });
  });

  it('keeps the renewal on when a save leaves the box out', () => {
    configured(d);
    db.updateDuckdnsCfg(d, { enabled: true, domain: DOMAIN });
    assert.equal(settings(d).leEnabled, true);
  });

  it('a new token alone changes the token and nothing else', () => {
    configured(d);
    db.updateDuckdnsCfg(d, { token: TOKEN_B });
    assert.deepEqual(settings(d), Object.assign({}, ALL_ON, { token: TOKEN_B }));
  });

  it('the renewal box alone changes the box and nothing else', () => {
    configured(d);
    db.updateDuckdnsCfg(d, { leEnabled: false });
    assert.deepEqual(settings(d), Object.assign({}, ALL_ON, { leEnabled: false }));
  });

  it('an empty request changes nothing, not even the data version', () => {
    configured(d);
    const v = db.getDataVersion(d);
    db.updateDuckdnsCfg(d, {});
    assert.deepEqual(settings(d), ALL_ON);
    assert.equal(db.getDataVersion(d), v);
  });
});

describe('POST /api/duckdns/config', () => {
  // The route from server.js, verbatim, against a real database. server.js
  // starts a server when it loads, so the route is cut out of its text and run
  // with stand-ins for what it calls around the database.
  const SRV = quelle('server.js');
  const von = SRV.indexOf('  // -- DuckDNS Config --\n');
  const bis = SRV.indexOf("  if (req.method === 'GET' && req.url === '/api/duckdns/config') {");
  assert.ok(von > 0 && bis > von, 'the DuckDNS config route was not found in server.js; the test has to follow it');

  let d, p, route, restarts;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    restarts = 0;
    route = new Function(
      'db',
      'database',
      'requireAdmin',
      'jsonBody',
      'jsonErr',
      'jsonOk',
      'safeErr',
      'startDuckdnsUpdater',
      'log',
      'return function handle(req, res) {\n' + SRV.slice(von, bis) + '\nreturn false;\n};'
    )(
      db,
      d,
      () => false,
      (req, res, cb) => cb(null, JSON.parse(req.body)),
      (res, code, msg) => res.done({ status: code, error: msg }),
      (res) => res.done({ status: 200 }),
      (res, err) => res.done({ status: 500, error: err.message }),
      () => restarts++,
      () => {}
    );
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  function post(body) {
    let answer = null;
    const handled = route(
      { method: 'POST', url: '/api/duckdns/config', body: JSON.stringify(body), authUser: { username: 'admin' } },
      { done: (a) => (answer = a) }
    );
    assert.notEqual(handled, false, 'the route did not take the request');
    return answer;
  }

  it('a request with only a new token rotates the token and keeps the rest', () => {
    configured(d);
    assert.deepEqual(post({ token: TOKEN_B }), { status: 200 });
    assert.deepEqual(settings(d), Object.assign({}, ALL_ON, { token: TOKEN_B }));
  });

  it('a save without the token field keeps the stored token, as before', () => {
    configured(d);
    assert.deepEqual(post({ enabled: true, domain: DOMAIN, leEnabled: true, token: '' }), { status: 200 });
    assert.equal(settings(d).token, TOKEN_A);
  });

  it('a save without the renewal box leaves the renewal on', () => {
    configured(d);
    assert.deepEqual(post({ enabled: true, domain: DOMAIN }), { status: 200 });
    assert.equal(settings(d).leEnabled, true);
  });

  it('what the settings page sends still switches everything', () => {
    configured(d);
    assert.deepEqual(post({ enabled: false, domain: DOMAIN, leEnabled: false }), { status: 200 });
    assert.deepEqual(settings(d), Object.assign({}, ALL_ON, { enabled: false, leEnabled: false }));
  });

  it('still refuses a malformed domain or token, and changes nothing then', () => {
    configured(d);
    assert.equal(post({ domain: 'not a name' }).status, 400);
    assert.equal(post({ token: 'not-hex-at-all' }).status, 400);
    assert.deepEqual(settings(d), ALL_ON);
  });

  it('restarts the updater after a save', () => {
    const before = restarts;
    post({ leEnabled: true });
    assert.equal(restarts, before + 1);
  });
});
