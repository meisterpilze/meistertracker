'use strict';
// Which routes are behind which permission.
//
// meistertracker has three tiers above "logged in": admin, can_ship and
// can_release. can_ship is the one an admin grants deliberately, and the
// comment on requireShipping says what it is for — keeping a logged-in
// non-admin away from the postage balance and away from customer addresses.
//
// Every *read* path honoured that. GET /api/orders/:id gated on it, so did
// GET /api/customers and the ship routes, and the order list even strips
// customerName for users without it. POST /api/orders/import did not gate on
// anything at all, and it is not a create — db.upsertOrder() matches an
// existing row on channel + channel_order_id and then COALESCE-replaces
// ship_name / ship_street / ship_city / ship_postal / ship_phone with whatever
// the caller sent. The two halves compose into a working attack:
//
//   1. GET /api/orders hands any authed user the channel and channelOrderId of
//      every order — those two fields are not part of the PII redaction.
//   2. POST /api/orders/import with that pair and a different address rewrites
//      the delivery address on somebody else's order.
//   3. The next colleague who *does* have can_ship opens it and buys a label.
//      The parcel goes to the attacker.
//
// So the interesting property is not "the guard function is correct" — it was
// always correct — but "the guard is actually on the route". That is what this
// file pins, by slicing the handler out of the source and looking for the call.
//
// server.js starts listening on require, so nothing here imports it; the
// predicate is lifted and the routes are read as text, the same approach
// test/setup-guard.test.js and test/substrate-routes.test.js take.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function liftGuard(name) {
  const m = SRC.match(new RegExp('function ' + name + '\\(req, res\\) \\{[\\s\\S]*?\\n\\}'));
  assert.ok(m, name + ' is gone from server.js — has the permission model been rewritten?');
  return new Function('jsonErr', m[0] + '\nreturn ' + name + ';')(() => {});
}

// The body of a route handler, from the `if (req.method === ...)` line that
// opens it up to the next one. Slicing to the *next route* rather than a fixed
// number of lines is what makes this honest: a guard that gets pushed past the
// end of the handler by an edit still fails the test.
function routeBody(marker) {
  const lines = SRC.split('\n');
  const start = lines.findIndex((l) => l.includes(marker));
  assert.ok(start >= 0, 'route not found in server.js: ' + marker);
  const isRouteOpener = (l) => /^\s*if \(req\.method === /.test(l);
  let end = start + 1;
  while (end < lines.length && !isRouteOpener(lines[end])) end++;
  return lines.slice(start, end).join('\n');
}

describe('requireShipping', () => {
  const requireShipping = liftGuard('requireShipping');
  // Returns true when it has *rejected* the request, so `if (guard()) return;`
  // reads as "stop here". Inverted from the obvious reading, hence the names.
  const rejected = (authUser) => requireShipping({ authUser }, {});

  it('lets admins through regardless of the capability flag', () => {
    assert.equal(rejected({ role: 'admin' }), false);
    assert.equal(rejected({ role: 'admin', can_ship: 0 }), false);
  });

  it('lets a user with the granted capability through', () => {
    assert.equal(rejected({ role: 'user', can_ship: 1 }), false);
  });

  it('rejects a plain user, however the flag is spelled', () => {
    assert.equal(rejected({ role: 'user' }), true);
    assert.equal(rejected({ role: 'user', can_ship: 0 }), true);
    // SQLite hands back 0/1, never a boolean — a `true` here would mean the
    // column is being read from somewhere that does not go through the DB.
    assert.equal(rejected({ role: 'user', can_ship: true }), true);
  });

  it('rejects when there is no authenticated user at all', () => {
    assert.equal(rejected(null), true);
    assert.equal(rejected(undefined), true);
  });
});

describe('customer-PII routes carry the shipping guard', () => {
  // The regression this file exists for. Import is an upsert: it can overwrite
  // the ship-to address of an order that already exists.
  it('POST /api/orders/import', () => {
    const body = routeBody("url === '/api/orders/import'");
    assert.match(body, /requireShipping\(req, res\)/, 'orders/import may not be open to any authed user');
  });

  it('and the guard runs before the body is read, not after', () => {
    const body = routeBody("url === '/api/orders/import'");
    assert.ok(
      body.indexOf('requireShipping') < body.indexOf('jsonBody'),
      'the guard has to reject before upsertOrder can see the payload'
    );
  });

  // The routes that were already gated, pinned so they stay that way.
  for (const marker of ["req.method === 'GET' && orderMatch", "url === '/api/customers'"]) {
    it(marker, () => {
      assert.match(routeBody(marker), /requireShipping\(req, res\)/);
    });
  }
});
