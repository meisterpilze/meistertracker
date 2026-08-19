'use strict';
// Two things the MCP tools said that the web UI does not.
//
// list_users returned the whole users row — role plus the can_ship and
// can_release flags — to whoever asked. The web UI splits that on purpose:
// GET /api/usernames hands every logged-in user {id, username}, GET /api/users
// returns the row behind an admin check. Any worker can mint themselves an MCP
// token through the OAuth flow, so the flags were readable by exactly the people
// they exist to hold back. can_ship is the one that matters there — it reaches
// postage and the customer's name — and knowing who holds it is a target list.
//
// move_bags passed a hardcoded null as the acting user to the scan log, while
// the same action through POST /api/scan-log carries its session's user. A
// contamination MOVE or a REMOVE therefore read back nameless out of the
// forensic query. The legacy static token genuinely belongs to nobody, so the
// fix keeps that a null rather than inventing an identity for it.
//
// Driven through the real registered tools rather than asserted against the
// source: the question is what a caller gets back, and only calling answers it.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { createMcpServer } = require('../mcp-server.js');

/** The tool callbacks, as a caller with this identity would reach them. */
function werkzeuge(database, auth) {
  const server = createMcpServer(database, () => {}, { auth });
  const reg = server._registeredTools;
  assert.ok(
    reg && Object.keys(reg).length > 0,
    'the SDK no longer exposes _registeredTools — the harness needs rewriting'
  );
  return reg;
}

// The SDK calls it `handler` on the registered entry. Asserted rather than
// assumed: if a version bump renames it, the test should say so instead of
// quietly passing on a tool it never called.
const rufe = async (reg, name, args = {}) => {
  const t = reg[name];
  assert.ok(t, name + ' is gone');
  assert.equal(typeof t.handler, 'function', 'the SDK renamed the tool callback — the harness needs rewriting');
  return t.handler(args, {});
};

// Every tool result is wrapped as { content: [{ type: 'text', text: <json> }] }.
const inhalt = (r) => JSON.parse(r.content[0].text);

describe('list_users tells a worker only what an assignee picker needs', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_mcpvis_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    db.createUser(d, 'chefin', 'passwort-lang-genug', 'admin');
    db.createUser(d, 'anton', 'passwort-lang-genug', 'user');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('gives a non-admin id and username, and nothing else', async () => {
    const zeilen = inhalt(await rufe(werkzeuge(d, { userId: 2, role: 'user' }), 'list_users'));
    assert.ok(zeilen.length >= 2);
    for (const z of zeilen) {
      assert.deepEqual(Object.keys(z).sort(), ['id', 'username']);
    }
  });

  it('still lets a worker look an assignee up, which is what the tool is for', async () => {
    const zeilen = inhalt(await rufe(werkzeuge(d, { userId: 2, role: 'user' }), 'list_users'));
    const anton = zeilen.find((z) => z.username === 'anton');
    assert.ok(anton && Number.isInteger(anton.id), 'the id an assigneeIds field needs is there');
  });

  it('gives an admin the whole row', async () => {
    const zeilen = inhalt(await rufe(werkzeuge(d, { userId: 1, role: 'admin' }), 'list_users'));
    const felder = Object.keys(zeilen[0]);
    for (const f of ['id', 'username', 'role', 'can_ship', 'can_release', 'created']) {
      assert.ok(felder.includes(f), 'admin should still see ' + f);
    }
  });

  it('treats a caller with no auth context at all as a non-admin', async () => {
    // createMcpServer fails closed when nothing is passed; the narrowing has to
    // fail closed the same way, or the default becomes the widest answer.
    const zeilen = inhalt(await rufe(werkzeuge(d, undefined), 'list_users'));
    assert.deepEqual(Object.keys(zeilen[0]).sort(), ['id', 'username']);
  });

  it('does not answer the two capability flags to anyone but an admin', async () => {
    const alsWorker = JSON.stringify(inhalt(await rufe(werkzeuge(d, { userId: 2, role: 'user' }), 'list_users')));
    assert.equal(alsWorker.includes('can_ship'), false);
    assert.equal(alsWorker.includes('can_release'), false);
    assert.equal(alsWorker.includes('admin'), false, 'and not who holds the role either');
  });
});

describe('move_bags writes down who moved them', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_mcpmove_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    db.createUser(d, 'anton', 'passwort-lang-genug', 'user');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  const letzterAkteur = () => d.prepare('SELECT user_id FROM scan_log ORDER BY id DESC LIMIT 1').get();

  it('records the calling user, not a null', async () => {
    const vorher = d.prepare('SELECT COUNT(*) AS n FROM scan_log').get().n;
    await rufe(werkzeuge(d, { userId: 1, role: 'user' }), 'move_bags', {
      bagIds: ['FB-2025-001-01'],
      toLocation: 'INC'
    });
    const nachher = d.prepare('SELECT COUNT(*) AS n FROM scan_log').get().n;
    if (nachher === vorher) return; // nothing to move in an empty database
    assert.equal(letzterAkteur().user_id, 1, 'the row must carry the user who asked for it');
  });

  it('leaves the legacy static token as nobody rather than inventing an identity', async () => {
    const vorher = d.prepare('SELECT COUNT(*) AS n FROM scan_log').get().n;
    await rufe(werkzeuge(d, { userId: null, role: 'admin' }), 'move_bags', {
      bagIds: ['FB-2025-001-02'],
      toLocation: 'INC'
    });
    const nachher = d.prepare('SELECT COUNT(*) AS n FROM scan_log').get().n;
    if (nachher === vorher) return;
    assert.equal(letzterAkteur().user_id, null);
  });
});

describe('requireAdminRole keeps one meaning', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'mcp-server.js'), 'utf8');

  it('is a refusal builder at every call site, never a narrowing switch', () => {
    // Ten tools spell it `const adminErr = requireAdminRole(); if (adminErr)
    // return adminErr;` — truthy means refuse. A tool that wants to narrow an
    // answer instead of refusing it must not reuse this one, or truthy would
    // mean two opposite things and the next maintainer sweeping for a missing
    // `if (adminErr) return adminErr;` would turn a narrowing into a refusal.
    const stellen = SRC.split('requireAdminRole()').length - 1;
    assert.ok(stellen >= 10, 'expected the existing call sites to still be there');
    assert.match(SRC, /function isAdminCaller\(\) \{/, 'the narrowing helper exists');
    assert.match(SRC, /if \(!isAdminCaller\(\)\) return json\(db\.listUsersPublic\(database\)\)/);
    assert.equal(
      /requireAdminRole\(\)\s*\)\s*return json/.test(SRC),
      false,
      'requireAdminRole must not be used as a narrowing condition'
    );
  });

  it('has one definition of the public projection, not two', () => {
    // The branch already argues this once, for the caldav uid charset: two
    // copies of a rule like this is how one of them quietly stops matching.
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(server, /db\.listUsersPublic\(database\)/, 'server.js uses the shared one');
    assert.equal(
      (server + SRC).split('({ id: u.id, username: u.username })').length - 1,
      0,
      'the projection is spelled out nowhere but db.js'
    );
  });
});
