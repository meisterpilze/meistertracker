'use strict';
// "Update & restart" in the server tab.
//
// The route used to spawn START.bat or update_server.sh as a child of the
// server. Both scripts run `pm2 delete` before `pm2 start`, and pm2 stops the
// whole process tree of the app it deletes, the script included, so the
// server went down and stayed down. The route now hands the job to the deploy
// runner the webhook uses, whose chain ends in `pm2 restart`. And the page no
// longer takes the old server's answer for the new one: it waits for a process
// that started after the click, and says so when the deploy stopped at a step.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SERVER = quelle('server.js');
const APP = quelle('app.js');

function route({ admin = true, worktree = false, ergebnis = 'started' } = {}) {
  const a = SERVER.indexOf('  // -- Server Restart --');
  const b = SERVER.indexOf('  // -- GitHub Webhook');
  assert.ok(a > 0 && b > a, 'the restart route has moved');
  const calls = { deliver: [], spawn: [] };
  const deploys = {
    deliver: async (info) => {
      calls.deliver.push(info);
      return ergebnis;
    }
  };
  const spawn = (...args) => {
    calls.spawn.push(args);
    return { unref() {} };
  };
  const record = () =>
    ergebnis === 'stopped'
      ? { status: 'failed', step: 'fetch', error: 'could not reach origin', started: '2026-11-16T10:00:00.000Z' }
      : { status: 'in_progress', started: '2026-11-16T10:00:00.000Z' };
  const handle = new Function(
    'deploys',
    'spawn',
    'readDeployState',
    'log',
    'WORKTREE_MODE',
    `
    function jsonOk(res, data) { res.status = 200; res.body = data || { ok: true }; res.done(); }
    function jsonErr(res, code, msg) { res.status = code; res.body = { error: msg }; res.done(); }
    function requireAdmin(req, res) {
      if (!req.authUser || req.authUser.role !== 'admin') { jsonErr(res, 403, 'admin required'); return true; }
      return false;
    }
    return function (req, res) { ${SERVER.slice(a, b)} return false; };`
  )(deploys, spawn, record, () => {}, worktree);
  const anfrage = () =>
    new Promise((fertig) => {
      const res = {
        done() {
          fertig(res);
        }
      };
      const authUser = admin ? { username: 'erika', role: 'admin' } : { username: 'max', role: 'user' };
      handle({ method: 'POST', url: '/api/server/restart', authUser }, res);
    });
  return { anfrage, calls };
}

describe('POST /api/server/restart', () => {
  it('runs the deploy runner and starts no script of its own', async () => {
    const r = route();
    const res = await r.anfrage();
    assert.equal(res.status, 200);
    assert.deepEqual(r.calls.deliver, [{ sha: 'manual', sender: 'erika' }]);
    assert.deepEqual(r.calls.spawn, []);
    assert.equal(res.body.result, 'started');
    assert.equal(res.body.deploy.started, '2026-11-16T10:00:00.000Z');
  });

  it('says when the deploy stopped before changing anything', async () => {
    const res = await route({ ergebnis: 'stopped' }).anfrage();
    assert.equal(res.body.ok, false);
    assert.equal(res.body.deploy.step, 'fetch');
  });

  it('says when it waits behind another deploy', async () => {
    const res = await route({ ergebnis: 'queued' }).anfrage();
    assert.equal(res.body.ok, true);
    assert.equal(res.body.result, 'queued');
  });

  it('stays an admin action', async () => {
    const r = route({ admin: false });
    assert.equal((await r.anfrage()).status, 403);
    assert.deepEqual(r.calls.deliver, []);
  });

  it('refuses in worktree mode, where the chain would reset the branch', async () => {
    const r = route({ worktree: true });
    assert.equal((await r.anfrage()).status, 409);
    assert.deepEqual(r.calls.deliver, []);
  });

  it('is not started from a script that deletes the pm2 app, anywhere in server.js', () => {
    assert.doesNotMatch(SERVER, /spawn\([^)]*START\.bat/);
    assert.doesNotMatch(SERVER, /spawn\([^)]*update_server\.sh/);
  });
});

describe('the page after the click', () => {
  // restartServer from app.js, with the network, the clock and the timer
  // replaced. Every tick of the poll is driven by hand.
  function seite({ antwort, gesundheit, voll }) {
    let uhr = 1_000_000;
    let tick = null;
    let neuGeladen = false;
    const el = () => ({ style: {}, textContent: '', disabled: false });
    const knopf = el();
    const status = el();
    let bestaetigt;
    const fn = new Function(
      'confirm2',
      't',
      'document',
      'authFetch',
      'fetch',
      'setInterval',
      'clearInterval',
      'window',
      'Date',
      hebeFunktion('restartServer', APP) + '\nreturn restartServer;'
    )(
      (a, b, c, cb) => {
        bestaetigt = cb();
      },
      (key, p) => key + (p ? ' ' + JSON.stringify(p) : ''),
      { getElementById: (id) => (id === 'btn-server-restart' ? knopf : status) },
      async (url) => {
        if (url === '/api/server/restart') return { ok: true, status: 200, json: async () => antwort };
        if (url === '/api/health/full') return { ok: true, json: async () => voll() };
        throw new Error('unexpected ' + url);
      },
      async () => ({ ok: true, json: async () => gesundheit() }),
      (f) => {
        tick = f;
        return 1;
      },
      () => {
        tick = null;
      },
      {
        location: {
          reload() {
            neuGeladen = true;
          }
        }
      },
      { now: () => uhr }
    );
    return {
      async klick() {
        fn();
        await bestaetigt;
      },
      async weiter(ms) {
        uhr += ms;
        if (tick) await tick();
      },
      laeuft: () => tick !== null,
      neuGeladen: () => neuGeladen,
      knopf,
      status
    };
  }

  it('waits for a process younger than the click, not for the old one', async () => {
    let uptime = 86400;
    const s = seite({
      antwort: { ok: true, result: 'started', deploy: { started: 'S1', status: 'in_progress' } },
      gesundheit: () => ({ status: 'ok', uptime }),
      voll: () => ({ deploy: { started: 'S1', status: 'in_progress' } })
    });
    await s.klick();
    assert.equal(s.status.textContent, 'server.waitReconnect');
    await s.weiter(3000);
    await s.weiter(3000);
    assert.equal(s.neuGeladen(), false, 'the old server answered, nothing restarted yet');
    uptime = 2;
    await s.weiter(3000);
    assert.equal(s.neuGeladen(), true);
  });

  it('shows the step when the deploy stopped, and gives the button back', async () => {
    const s = seite({
      antwort: { ok: true, result: 'started', deploy: { started: 'S2', status: 'in_progress' } },
      gesundheit: () => ({ status: 'ok', uptime: 86400 }),
      voll: () => ({ deploy: { started: 'S2', status: 'failed', step: 'preflight', error: 'migration v120' } })
    });
    await s.klick();
    for (let i = 0; i < 3; i++) await s.weiter(3000);
    assert.equal(s.laeuft(), false);
    assert.equal(s.neuGeladen(), false);
    assert.match(s.status.textContent, /server\.updateFailed.*preflight/);
    assert.equal(s.knopf.disabled, false);
  });

  it('shows the refusal when the deploy could not start', async () => {
    const s = seite({
      antwort: { ok: false, result: 'stopped', deploy: { started: 'S3', status: 'failed', step: 'fetch', error: 'x' } },
      gesundheit: () => ({ status: 'ok', uptime: 86400 }),
      voll: () => ({})
    });
    await s.klick();
    assert.equal(s.laeuft(), false);
    assert.match(s.status.textContent, /server\.updateFailed.*fetch/);
  });
});
