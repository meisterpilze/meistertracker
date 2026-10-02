'use strict';
// The /api/usb-backup routes as server.js has them, against a stand-in for the
// service: who may call them, what they answer, and that the recovery key is
// never cached on the way out.
//
// server.js starts listening when it is loaded, so, as elsewhere, the section
// is cut out of the source between its two marker comments and run on its own.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle('server.js');
const VON = '// -- USB stick backup (scripts/usb-backup.js) --';
const BIS = '// -- Backup Download (encrypted .db) --';

function setConst(name) {
  const m = SRC.match(new RegExp('^const ' + name + ' = new Set\\(\\[[\\s\\S]*?\\]\\);', 'm'));
  assert.ok(m, name + ' not found in server.js');
  return m[0];
}

function build(service, logs) {
  const a = SRC.indexOf(VON);
  const b = SRC.indexOf(BIS);
  assert.ok(a > 0 && b > a, 'the USB section of server.js has moved');
  return new Function(
    'usbBackup',
    'log',
    'describeUsbError',
    `
    ${['requireAdmin', 'jsonOk', 'jsonErr', 'usbBackupError', 'jsonNoStore'].map((n) => hebeFunktion(n, SRC)).join('\n')}
    ${setConst('USB_BACKUP_BAD_REQUEST')}
    ${setConst('USB_BACKUP_CONFLICT')}
    function jsonBody(req, res, cb) { cb(null, req.body || {}); }
    return function handle(req, res, url) {
      ${SRC.slice(a, b)}
      return false;
    };`
  )(service, (level, msg, meta) => logs.push({ level, msg, meta }), require('../scripts/usb-backup.js').describeError);
}

function call(handle, method, url, { body, admin = true } = {}) {
  return new Promise((resolve) => {
    const res = {
      headers: {},
      writeHead(code, headers) {
        this.status = code;
        Object.assign(this.headers, headers || {});
      },
      end(text) {
        resolve({ status: this.status, headers: this.headers, body: text ? JSON.parse(text) : null });
      }
    };
    const req = {
      method,
      url,
      body,
      authUser: admin ? { id: 1, username: 'admin', role: 'admin' } : { id: 2, username: 'anna', role: 'user' }
    };
    const handled = handle(req, res, url);
    if (handled === false) resolve({ status: 'not handled' });
  });
}

function codeError(code) {
  const e = new Error('because ' + code);
  e.code = code;
  return e;
}

function stub(over = {}) {
  return Object.assign(
    {
      status: () => ({ configured: true, reminder: 'due' }),
      drives: async () => [{ root: 'E:\\' }],
      setup: async () => ({ stick: { id: 'aaaaaaaaaaaaaaaa' }, recoveryKey: 'KEY' }),
      connect: async () => ({ stick: { id: 'aaaaaaaaaaaaaaaa' } }),
      runNow: async () => ({ state: 'running' }),
      revealKey: () => 'KEY',
      confirmKey: () => true,
      forget: (id) => id === 'aaaaaaaaaaaaaaaa'
    },
    over
  );
}

const ROUTES = [
  ['GET', '/api/usb-backup'],
  ['GET', '/api/usb-backup/drives'],
  ['POST', '/api/usb-backup/setup'],
  ['POST', '/api/usb-backup/connect'],
  ['POST', '/api/usb-backup/run'],
  ['POST', '/api/usb-backup/key'],
  ['POST', '/api/usb-backup/key/confirm'],
  ['DELETE', '/api/usb-backup/sticks/aaaaaaaaaaaaaaaa']
];

describe('/api/usb-backup', () => {
  it('turns away everyone but admins, on every route', async () => {
    const handle = build(stub(), []);
    for (const [m, u] of ROUTES) {
      const r = await call(handle, m, u, { admin: false, body: {} });
      assert.equal(r.status, 403, m + ' ' + u);
    }
  });

  it('answers admins on every route', async () => {
    const handle = build(stub(), []);
    for (const [m, u] of ROUTES) {
      const r = await call(handle, m, u, { body: {} });
      assert.equal(r.status, 200, m + ' ' + u);
    }
  });

  it('never lets the recovery key be cached', async () => {
    const handle = build(stub(), []);
    for (const u of ['/api/usb-backup/setup', '/api/usb-backup/key']) {
      const r = await call(handle, 'POST', u, { body: {} });
      assert.equal(r.body.recoveryKey, 'KEY');
      assert.equal(r.headers['Cache-Control'], 'no-store', u);
    }
  });

  it('passes the drive and the label on, and nothing else', async () => {
    let got;
    const handle = build(stub({ setup: async (a) => ((got = a), { stick: null, recoveryKey: null }) }), []);
    await call(handle, 'POST', '/api/usb-backup/setup', { body: { root: 'E:\\', label: 'A', extra: 1 } });
    assert.deepEqual(got, { root: 'E:\\', label: 'A' });
  });

  it('answers a refused request with its code, and an unexpected failure with a generic one', async () => {
    const logs = [];
    let next;
    const handle = build(
      stub({
        setup: async () => {
          throw next;
        }
      }),
      logs
    );
    next = codeError('NOT_A_DRIVE');
    let r = await call(handle, 'POST', '/api/usb-backup/setup', { body: {} });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'NOT_A_DRIVE');

    next = codeError('SAME_DISK');
    r = await call(handle, 'POST', '/api/usb-backup/setup', { body: {} });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SAME_DISK');

    next = codeError('ENOSPC');
    r = await call(handle, 'POST', '/api/usb-backup/setup', { body: {} });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'FULL', 'a full stick is said in words the interface knows');

    next = codeError('STATE', 'data/usb-backup.json could not be saved (ENOSPC)');
    r = await call(handle, 'POST', '/api/usb-backup/setup', { body: {} });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'STATE', 'the PC, not the stick');

    next = new Error('C:\\some\\path exploded');
    r = await call(handle, 'POST', '/api/usb-backup/setup', { body: {} });
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: 'USB backup request failed', code: 'FAILED' });
    assert.ok(
      logs.some((l) => l.level === 'error' && l.meta.error.includes('exploded')),
      'the detail goes to the log'
    );
  });

  it('passes "back up anyway" on only when it is said in so many words', async () => {
    const calls = [];
    const handle = build(stub({ runNow: async (id, opts) => (calls.push([id, opts]), { state: 'running' }) }), []);
    await call(handle, 'POST', '/api/usb-backup/run', { body: { force: true } });
    await call(handle, 'POST', '/api/usb-backup/run', { body: { force: 'yes', id: 'aaaaaaaaaaaaaaaa' } });
    assert.deepEqual(calls, [
      [null, { force: true }],
      ['aaaaaaaaaaaaaaaa', { force: false }]
    ]);
  });

  it('will not confirm a key that does not exist yet', async () => {
    const handle = build(stub({ confirmKey: () => false }), []);
    const r = await call(handle, 'POST', '/api/usb-backup/key/confirm');
    assert.equal(r.status, 409);
  });

  it('answers a confirmation that could not be saved, instead of leaving it hanging', async () => {
    const handle = build(
      stub({
        confirmKey: () => {
          throw codeError('STATE');
        }
      }),
      []
    );
    const r = await call(handle, 'POST', '/api/usb-backup/key/confirm');
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'STATE');
  });

  it('says so when the stick to forget is unknown', async () => {
    const handle = build(stub(), []);
    const r = await call(handle, 'DELETE', '/api/usb-backup/sticks/bbbbbbbbbbbbbbbb');
    assert.equal(r.status, 404);
  });

  it('leaves other paths alone', async () => {
    const handle = build(stub(), []);
    for (const u of ['/api/usb-backup/sticks/zz', '/api/usb-backups', '/api/usb-backup/sticks/aaaaaaaaaaaaaaaa/x']) {
      const r = await call(handle, 'DELETE', u);
      assert.equal(r.status, 'not handled', u);
    }
  });
});
