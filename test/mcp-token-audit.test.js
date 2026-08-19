'use strict';
// What "last used" on the MCP token actually records.
//
// checkMcpAuth asked for the stored hash with getMcpToken(database,
// { touchLastUsed: true }), and the helper wrote last_used_at before returning
// — before the caller had compared anything. So the column recorded *attempts*,
// not uses. Every failed bearer probe from the internet refreshed it.
//
// That inverts what the column is for. The admin screen shows it so somebody
// deciding whether a token is still needed can see whether anyone is using it;
// with attempts counted, an unused token that is merely being probed reads as
// live, and the reasonable conclusion — "leave it, the integration still needs
// it" — is exactly the wrong one. It also let an unauthenticated request cause
// a database write.
//
// The read and the stamp are two calls now, and only a comparison that
// succeeded makes the second one.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

describe('getMcpToken does not write', () => {
  let d, p;
  const lastUsed = () => d.prepare('SELECT last_used_at FROM mcp_config WHERE id=1').get().last_used_at;

  before(() => {
    p = path.join(os.tmpdir(), 'mt_mcptok_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    db.generateMcpToken(d);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('starts clean after a rotation', () => {
    assert.equal(lastUsed(), null, 'generateMcpToken should reset the audit columns');
  });

  it('reading the token leaves the timestamp alone', () => {
    assert.ok(db.getMcpToken(d));
    assert.equal(lastUsed(), null, 'a read must not look like a use');
    // Repeatedly, the way a probe would.
    for (let i = 0; i < 5; i++) db.getMcpToken(d);
    assert.equal(lastUsed(), null);
  });

  it('takes no options that would bring the write back', () => {
    db.getMcpToken(d, { touchLastUsed: true });
    assert.equal(lastUsed(), null, 'the old option must not still be honoured');
  });

  it('touchMcpTokenUsed is what records a use', () => {
    db.touchMcpTokenUsed(d);
    const t = lastUsed();
    assert.ok(t, 'expected a timestamp');
    assert.match(t, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('a revoked token reads as absent, and stays that way', () => {
    db.revokeMcpToken(d);
    assert.equal(db.getMcpToken(d), '');
  });
});

describe('checkMcpAuth stamps only after the comparison', () => {
  const fn = (() => {
    const m = SRC.match(/function checkMcpAuth\(req\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'checkMcpAuth has moved');
    return m[0];
  })();

  it('reads the token without asking for a write', () => {
    assert.match(fn, /db\.getMcpToken\(database\)/);
    assert.equal(/touchLastUsed/.test(fn), false);
  });

  it('the stamp is inside the timingSafeEqual branch', () => {
    const cmp = fn.indexOf('crypto.timingSafeEqual(a, b)');
    const touch = fn.indexOf('db.touchMcpTokenUsed(database)');
    assert.ok(cmp >= 0, 'the constant-time comparison is gone');
    assert.ok(touch > cmp, 'the stamp must follow the comparison, not precede it');
    // And it must be inside the branch, not merely after it: the success return
    // has to come after the stamp with nothing between them but whitespace.
    assert.match(
      fn.slice(touch),
      /db\.touchMcpTokenUsed\(database\);\s*\n\s*return \{ userId: null, role: 'admin' \};/
    );
  });

  it('an unauthenticated request no longer causes a database write', () => {
    // Everything before the comparison must be read-only. (Matching on write
    // helpers rather than SQL keywords — createHash().update() is not a write.)
    const upTo = fn.slice(0, fn.indexOf('crypto.timingSafeEqual(a, b)'));
    for (const write of ['touchMcpTokenUsed', '.run(', 'touchLastUsed']) {
      assert.equal(upTo.includes(write), false, write + ' sits ahead of the verification');
    }
  });

  it('still fails closed for anything that is not a bearer token', () => {
    assert.match(fn, /if \(!auth\.startsWith\('Bearer '\)\) return null;/);
    assert.match(fn, /return null;\n\}$/);
  });
});
