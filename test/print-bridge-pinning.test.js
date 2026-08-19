'use strict';
// Who the print bridge is actually talking to.
//
// The bridge's certificate is self-signed by `print-bridge.ps1 -Install`, so
// there is no chain to validate, and the request went out with
// rejectUnauthorized:false and nothing in its place. Encryption without
// authentication stops a passive listener and does nothing about an active one:
// anyone on the LAN able to answer for the bridge's address could present their
// own certificate, take the X-Bridge-Token out of the request header, and hand
// back whatever printer status they liked. The code said as much — "Future
// enhancement: pin to a stored fingerprint".
//
// So: trust on first use. The first connection to an address records the
// certificate's SHA-256 fingerprint; every one after compares against it. The
// first connection is still trusted blind — that is what TOFU costs — but it
// happens once, on the operator's own network, right after they ran the
// installer, instead of on every print for the life of the bridge.
//
// The ordering matters as much as the comparison, and it is the reason this
// test talks to a real TLS server rather than asserting on source. The check
// runs on 'secureConnect' and destroys the socket there; what has to be true is
// that Node has not yet written the request head at that point. If it had, a
// mismatch would still hand the attacker the token — a check that fires after
// the secret is on the wire is worse than none, because it looks like a fix.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let dir;
let haveOpenssl = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  haveOpenssl = false;
}

function makeCert(tag) {
  execFileSync(
    'openssl',
    // prettier-ignore
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', path.join(dir, tag + '.key'), '-out', path.join(dir, tag + '.crt'),
      '-days', '2', '-subj', '/CN=print-bridge'],
    { stdio: 'ignore' }
  );
  return {
    key: fs.readFileSync(path.join(dir, tag + '.key')),
    cert: fs.readFileSync(path.join(dir, tag + '.crt'))
  };
}

// Lift _pinnedBridgeFingerprint and _bridgeRequest out of server.js (it listens
// on require) and give them a database, a log and a bridge config of our own.
function buildBridge(store) {
  const pinFn = SRC.match(/function _pinnedBridgeFingerprint\(origin\) \{[\s\S]*?\n\}/);
  const reqFn = SRC.match(/function _bridgeRequest\(method, urlPath, body, callback\) \{[\s\S]*?\n\}\n/);
  assert.ok(pinFn && reqFn, '_bridgeRequest has been rewritten — this test needs updating with it');
  const logs = [];
  const dbStub = {
    getPrintBridgeCfg: () => ({ certFp: store.certFp, certUrl: store.certUrl }),
    setPrintBridgeCertPin: (_d, origin, fp) => {
      store.certUrl = origin;
      store.certFp = fp;
    }
  };
  const api = new Function(
    'db',
    'database',
    'log',
    'http',
    'https',
    'URL',
    'Buffer',
    'getEffectiveBridgeConfig',
    pinFn[0] + '\n' + reqFn[0] + '\nreturn { _bridgeRequest, _pinnedBridgeFingerprint };'
  )(
    dbStub,
    {},
    (...a) => logs.push(a),
    require('http'),
    require('https'),
    URL,
    Buffer,
    () => ({ url: store.url, token: 'SECRET-BRIDGE-TOKEN', source: 'db' })
  );
  return { ...api, logs };
}

describe('print bridge certificate pinning', { skip: haveOpenssl ? false : 'openssl not available' }, () => {
  let server, port, seenByServer, certs;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_pin_'));
    certs = { real: makeCert('real'), impostor: makeCert('impostor') };
  });
  after(() => {
    if (server) server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // A TLS server that records every byte it is sent, so "did the token leak?"
  // is a question with an answer rather than an assumption.
  //
  // Live sockets are destroyed when the server is swapped, not merely
  // server.close()'d. Node's https.globalAgent keeps connections alive, so a
  // pooled socket to the previous certificate would be reused and no handshake
  // — and therefore no pin check — would happen at all. That is correct in
  // production (the connection was authenticated when it was made) and would
  // quietly make this test prove nothing.
  const open = new Set();

  function listen(which) {
    return new Promise((resolve) => {
      if (server) {
        server.close();
        for (const s of open) s.destroy();
        open.clear();
      }
      seenByServer = '';
      server = tls.createServer({ key: certs[which].key, cert: certs[which].cert }, (sock) => {
        open.add(sock);
        sock.on('close', () => open.delete(sock));
        sock.on('data', (d) => {
          seenByServer += d.toString();
          sock.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{"ok":true}');
        });
        sock.on('error', () => {});
      });
      server.on('tlsClientError', () => {});
      server.listen(port || 0, '127.0.0.1', () => {
        port = server.address().port;
        // Let the client's agent notice the sockets it had are gone.
        setTimeout(resolve, 30);
      });
    });
  }

  const call = (bridge) =>
    new Promise((resolve) => bridge._bridgeRequest('POST', 'print', 'ZPLDATA', (err, resp) => resolve({ err, resp })));

  it('pins on the first connection and lets it through', async () => {
    await listen('real');
    const store = { url: 'https://127.0.0.1:' + port, certFp: '', certUrl: '' };
    const bridge = buildBridge(store);

    const { err, resp } = await call(bridge);
    assert.equal(err, null, err && err.message);
    assert.equal(resp.statusCode, 200);
    assert.match(store.certFp, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/, 'a SHA-256 fingerprint should have been stored');
    assert.equal(store.certUrl, 'https://127.0.0.1:' + port);
    assert.match(bridge.logs.map((l) => l[1]).join(' '), /Pinned print bridge certificate/);
  });

  it('accepts the same certificate afterwards without re-pinning', async () => {
    await listen('real');
    const store = { url: 'https://127.0.0.1:' + port, certFp: '', certUrl: '' };
    const first = buildBridge(store);
    await call(first);
    const pinned = store.certFp;

    const second = buildBridge(store);
    const { err, resp } = await call(second);
    assert.equal(err, null, err && err.message);
    assert.equal(resp.statusCode, 200);
    assert.equal(store.certFp, pinned, 'the pin should not move on a matching connection');
    assert.equal(
      second.logs.some((l) => /Pinned print bridge/.test(l[1])),
      false
    );
  });

  it('refuses a different certificate at the same address', async () => {
    await listen('real');
    const store = { url: 'https://127.0.0.1:' + port, certFp: '', certUrl: '' };
    await call(buildBridge(store));
    const pinned = store.certFp;

    // Same address, different certificate — an on-path attacker answering for
    // the bridge, or the bridge re-installed without re-pinning.
    await listen('impostor');
    const bridge = buildBridge(store);
    const { err } = await call(bridge);

    assert.ok(err, 'the request should have failed');
    assert.match(err.message, /certificate changed/i);
    assert.match(err.message, /save the printer settings again/i, 'the error has to say how to recover');
    assert.equal(store.certFp, pinned, 'a mismatch must never quietly overwrite the pin');
    assert.match(bridge.logs.map((l) => l[1]).join(' '), /does not match the pinned one/);
  });

  it('and the token never reaches the impostor', async () => {
    await listen('real');
    const store = { url: 'https://127.0.0.1:' + port, certFp: '', certUrl: '' };
    await call(buildBridge(store));

    await listen('impostor');
    await call(buildBridge(store));
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(seenByServer, '', 'bytes reached the impostor: ' + JSON.stringify(seenByServer.slice(0, 120)));
    assert.equal(seenByServer.includes('SECRET-BRIDGE-TOKEN'), false);
    assert.equal(seenByServer.includes('ZPLDATA'), false);
  });

  it('re-pins for a different address rather than refusing', async () => {
    // Moving the bridge to another machine is not an attack; the pin belongs to
    // an origin, so the new one is learned instead of rejected.
    await listen('real');
    const store = { url: 'https://127.0.0.1:' + port, certFp: 'AA:BB', certUrl: 'https://127.0.0.1:1' };
    const bridge = buildBridge(store);
    const { err } = await call(bridge);
    assert.equal(err, null, err && err.message);
    assert.equal(store.certUrl, 'https://127.0.0.1:' + port);
    assert.notEqual(store.certFp, 'AA:BB');
  });
});

describe('saving the printer settings clears the pin', () => {
  const DB = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');

  it('updatePrintBridgeCfg wipes both columns', () => {
    const fn = DB.match(/function updatePrintBridgeCfg\(db, cfg\) \{[\s\S]*?\n\}/)[0];
    assert.match(fn, /cert_fp='', cert_url=''/);
  });

  it('the migration adds them idempotently', () => {
    const mig = DB.slice(DB.indexOf('version: 72'), DB.indexOf('version: 72') + 1200);
    assert.match(mig, /pragma_table_info\('print_bridge_config'\)/);
    assert.match(mig, /cert_fp/);
    assert.match(mig, /cert_url/);
  });
});
