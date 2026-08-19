'use strict';
// Two endpoints written as public that nobody could reach.
//
// The auth gate runs before both handlers, and neither was in its exemption
// list. So:
//
//   /api/health      — "Public: minimal status only", says the comment, and it
//                      calls checkAuth itself to decide how much to reveal.
//                      Behind the gate it answered 401 to everybody, the
//                      Dockerfile's HEALTHCHECK could never pass (the container
//                      reported unhealthy forever), and the admin-detail branch
//                      inside the handler was unreachable code.
//
//   /api/csp-reports — "the browser sends these without credentials", says that
//                      comment, which is simply how CSP reporting works. Behind
//                      the gate every violation report was discarded with a 401
//                      — losing the one signal that would say an injected
//                      script had actually run.
//
// Neither was a vulnerability: failing closed is the safe direction. But both
// were dead, and the health one was actively misleading operators.
//
// server.js listens on require, so the gate is checked as source rather than
// exercised over HTTP — the same approach test/setup-guard.test.js takes.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const gate = (() => {
  const at = SRC.indexOf('// ── Auth gate ─');
  assert.ok(at > 0, 'the auth gate has moved');
  return SRC.slice(at, SRC.indexOf('req.authUser = authUser;', at) + 40);
})();

describe('the auth gate exemptions', () => {
  it('names every one of them in the condition', () => {
    const condition = gate.slice(gate.indexOf('!isLoginPage'));
    for (const flag of [
      'isLoginPage',
      'isPublicAsset',
      'isWebhook',
      'isChannelOAuthCb',
      'isEbayDeletion',
      'isHealth',
      'isCspReport'
    ]) {
      assert.match(condition, new RegExp('!' + flag + '\\b'), flag + ' is declared but not in the condition');
    }
  });

  it('lets the health check through, GET only', () => {
    assert.match(gate, /const isHealth = req\.method === 'GET' && url === '\/api\/health';/);
  });

  it('lets a CSP report through, POST only', () => {
    assert.match(gate, /const isCspReport = req\.method === 'POST' && url === '\/api\/csp-reports';/);
  });

  it('still gates everything else', () => {
    // The exemptions are exact URLs and fixed methods, not prefixes — a prefix
    // here would open far more than intended.
    assert.equal(/isHealth = .*startsWith/.test(gate), false);
    assert.equal(/isCspReport = .*startsWith/.test(gate), false);
  });
});

describe('/api/health', () => {
  const handler = (() => {
    const at = SRC.indexOf("if (req.method === 'GET' && req.url === '/api/health')");
    assert.ok(at > 0, 'the health route has moved');
    return SRC.slice(at, at + 3500);
  })();

  it('is rate-limited, now that anyone can call it', () => {
    // It touches the database on every call.
    assert.match(handler, /checkRate\(req, \d+\)/);
    assert.ok(
      handler.indexOf('checkRate') < handler.indexOf("database.prepare('SELECT 1')"),
      'the budget check has to come before the query'
    );
    assert.match(handler, /429/);
  });

  it('keeps the detail behind an admin check', () => {
    assert.match(handler, /const authUser = checkAuth\(req\);/);
    assert.match(handler, /if \(authUser && authUser\.role === 'admin'\)/);
    // The fields worth not handing out: an exact Node version narrows which
    // CVEs are worth trying.
    for (const field of ['health.platform', 'health.nodeVersion', 'health.memory', 'health.backup']) {
      const at = handler.indexOf(field);
      assert.ok(at > handler.indexOf("authUser.role === 'admin'"), field + ' is outside the admin branch');
    }
  });

  it('the unauthenticated body stays minimal', () => {
    const publicBlock = handler.slice(handler.indexOf('const health = {'), handler.indexOf("role === 'admin'"));
    assert.deepEqual([...publicBlock.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]).sort(), [
      'db',
      'status',
      'uptime',
      'version',
      'worktree'
    ]);
  });
});

describe('the Dockerfile health check can now pass', () => {
  const DOCKERFILE = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');

  it('still points at /api/health', () => {
    assert.match(DOCKERFILE, /HEALTHCHECK/);
    assert.match(DOCKERFILE, /\/api\/health/);
  });
});
