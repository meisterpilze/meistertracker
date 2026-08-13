'use strict';
// Who may claim the first admin account without the setup token.
//
// POST /api/auth/setup is the one unauthenticated endpoint that hands out an
// admin account, and it is open exactly while the users table is empty — a
// first install, a replacement machine, a restore that recreated the database.
// GET /api/auth/setup-required reports that state without authentication, so
// the window is observable from the network, not merely theoretical.
//
// Two things were meant to guard it: the request coming from loopback, or an
// X-Setup-Token printed to the log on first start. They are OR-ed, so loopback
// alone is enough — and behind `proxy_pass http://localhost:3000` the TCP peer
// is 127.0.0.1 for *every* request. The shortcut then means "anyone".
//
// Measured against a real proxy before this was pinned down: setup from a LAN
// address returned 200 with role admin. Setting TRUST_PROXY=true — precisely
// what DEPLOYMENT.md instructs a Path B operator to do — did not help, because
// the handler read req.socket.remoteAddress directly and never consulted it.
//
// The obvious repair is the wrong one, which is why this is a test and not a
// comment. Switching to getClientIP() would read the first X-Forwarded-For
// entry, and nginx's $proxy_add_x_forwarded_for puts the client's own value
// first — so `X-Forwarded-For: 127.0.0.1` would reopen the hole. Behind a
// proxy the socket cannot identify the operator at all, so the answer is to
// drop the shortcut there and let the token be the only way in.
//
// server.js starts a server on require, so the predicate is lifted out of the
// source and exercised on its own — the same approach test/culture-badges.test.js
// takes for app.js.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadGuard() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const m = src.match(/function setupFromLoopback\(remoteAddress, trustProxy\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'setupFromLoopback is gone from server.js — has the setup guard been rewritten?');
  return new Function(m[0] + '\nreturn setupFromLoopback;')();
}

const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const REMOTE = ['192.168.0.102', '10.0.0.7', '::ffff:192.168.0.102', '203.0.113.9'];

describe('first-time setup: who gets in without the token', () => {
  let setupFromLoopback;
  before(() => {
    setupFromLoopback = loadGuard();
  });

  describe('no proxy in front', () => {
    for (const ip of LOOPBACK) {
      it('lets the operator at the machine through: ' + ip, () => {
        assert.equal(setupFromLoopback(ip, false), true);
      });
    }

    for (const ip of REMOTE) {
      it('turns the network away: ' + ip, () => {
        assert.equal(setupFromLoopback(ip, false), false);
      });
    }
  });

  describe('behind a reverse proxy', () => {
    // The whole point: with a proxy in front, 127.0.0.1 is what every request
    // looks like, so it can no longer be taken as proof of anything.
    for (const ip of LOOPBACK.concat(REMOTE)) {
      it('grants nothing on the strength of the socket alone: ' + ip, () => {
        assert.equal(setupFromLoopback(ip, true), false);
      });
    }
  });

  it('treats a missing remote address as untrusted', () => {
    assert.equal(setupFromLoopback(undefined, false), false);
    assert.equal(setupFromLoopback('', false), false);
  });

  // The repair that looks right and is not.
  it('reads the socket, never a forwarded-for header', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const call = src.match(/const isLoopback = setupFromLoopback\(([^)]*)\)/);
    assert.ok(call, 'the setup handler no longer calls setupFromLoopback');
    assert.equal(
      /x-forwarded-for|getClientIP/i.test(call[1]),
      false,
      'the first X-Forwarded-For entry is attacker-supplied behind nginx — see the header of this file'
    );
  });
});
