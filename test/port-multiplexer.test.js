'use strict';
// How long the HTTPS port holds a connection.
//
// PORT takes TLS and plain HTTP alike: createPortMux reads the first byte of
// each connection and hands it to the HTTPS server or to the redirect with
// emit('connection'). Neither of those listens itself, and Node starts its
// header and request deadlines from a server's 'listening' event, so
// createPortMux sets them and raises the event. It also waits only so long for
// the first byte and caps how many connections there are at once. A handler at
// work and an answer on its way out get no limit: a slow handler and a slow
// download have to finish.
//
// server.js listens on require, so createPortMux is lifted out of its source and
// put in front of servers of this file's own, with limits short enough to wait
// for. A connection left hanging only shows on a real socket, and so would a
// Node release that stopped starting the deadlines on 'listening'.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');
const { zertifikat } = require('./helpers/tsa');

const SRC = quelle('server.js');
const sharedAddress = new Function(hebeFunktion('sharedAddress', SRC) + '\nreturn sharedAddress;')();
// createPortMux with the sharedAddress it is handed: server.js's own, or one
// that shares no address, since every client here comes from 127.0.0.1.
const portMux = (shared) =>
  new Function('net', 'sharedAddress', hebeFunktion('createPortMux', SRC) + '\nreturn createPortMux;')(net, shared);
const createPortMux = portMux(sharedAddress);
const PORT_LIMITS = new Function(hebeKonstante('PORT_LIMITS', SRC) + '\nreturn PORT_LIMITS;')();

// The real limits, scaled down to wait for, in the same order: first byte,
// headers, whole request.
const LIMITS = { firstByteMs: 300, headersMs: 600, requestMs: 1200, checkMs: 25, maxConnections: 50, perAddress: 50 };
// The TLS server's own handshake deadline. server.js leaves it at Node's 120 s.
const HANDSHAKE_MS = 900;
// An answer that leaves in one write, as a backup download does.
const BIG_BYTES = 6 * 1024 * 1024;
// A handler that waits on an outside service before its first byte, as the
// certificate request does for minutes: longer than every limit above.
const SLOW_HANDLER_MS = 1600;
// How late a close may come on a busy CI machine before it counts as missing.
const SLACK_MS = 1500;
// A connection that should have been closed and is still open after this fails.
const OPEN_MS = 5000;

// Made for this run; the client trusts exactly this certificate.
const CERT = zertifikat({ cn: 'localhost' });

// The HTTPS side: an event stream like /api/events, a big answer in one write,
// a slow handler, a body reader, and "ok".
function answer(req, res) {
  if (req.url === '/slow') {
    setTimeout(() => res.end('done'), SLOW_HANDLER_MS);
    return;
  }
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const beat = setInterval(() => res.write('data: {"type":"heartbeat"}\n\n'), 150);
    req.on('close', () => clearInterval(beat));
    return;
  }
  if (req.url === '/big') {
    res.end(Buffer.alloc(BIG_BYTES, 'x'));
    return;
  }
  if (req.method === 'POST') {
    let n = 0;
    req.on('data', (c) => (n += c.length));
    req.on('end', () => res.end('got ' + n));
    return;
  }
  res.end('ok');
}

// Both servers behind createPortMux, built the way server.js builds them.
async function openPort(limits, makeMux = createPortMux) {
  const tlsServer = https.createServer(
    {
      key: CERT.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      cert: CERT.pem,
      minVersion: 'TLSv1.2',
      handshakeTimeout: HANDSHAKE_MS
    },
    answer
  );
  const plainServer = http.createServer((req, res) => {
    res.writeHead(301, { Location: 'https://localhost' + req.url });
    res.end();
  });
  const mux = makeMux(tlsServer, plainServer, limits);
  await new Promise((resolve) => mux.listen(0, '127.0.0.1', resolve));
  return {
    mux,
    port: mux.address().port,
    close() {
      mux.close();
      tlsServer.close();
      plainServer.close();
    }
  };
}

// Every client socket. All of them go at the end, passed or failed: one left
// open would keep this file's process, and the test run, from ever finishing.
const sockets = new Set();
after(() => {
  for (const s of sockets) s.destroy();
});

function connectPlain(port) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
    sockets.add(s);
  });
}

function connectTls(port) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ port, host: '127.0.0.1', servername: 'localhost', ca: CERT.pem }, () => resolve(s));
    s.on('error', reject);
    sockets.add(s);
  });
}

// Resolves once the server has closed the connection: how long after `from`,
// and with everything it sent. All of it is read, because a socket whose data
// nobody reads never learns that the other end has gone.
function untilClosed(s, from = Date.now(), openMs = OPEN_MS) {
  return new Promise((resolve, reject) => {
    let text = '';
    s.setEncoding('latin1');
    s.on('data', (d) => (text += d));
    s.on('error', () => {});
    const open = setTimeout(() => {
      s.destroy();
      reject(new Error('still open after ' + openMs + ' ms'));
    }, openMs);
    s.on('close', () => {
      clearTimeout(open);
      resolve({ ms: Date.now() - from, text });
    });
  });
}

// Writes text one character at a time, every `everyMs`, until done or closed.
function trickle(s, text, everyMs) {
  let i = 0;
  const timer = setInterval(() => {
    if (i < text.length && !s.destroyed) s.write(text[i++]);
    else clearInterval(timer);
  }, everyMs);
  s.on('close', () => clearInterval(timer));
}

const SLOW_REQUEST = 'GET / HTTP/1.1\r\nHost: localhost\r\nX-Slow: ' + 'x'.repeat(60) + '\r\n\r\n';

describe('the HTTPS port', { concurrency: true, timeout: 30000 }, () => {
  let port;
  let closePort;
  before(async () => {
    ({ port, close: closePort } = await openPort(LIMITS));
  });
  after(() => closePort());

  it('closes a connection that sends nothing once firstByteMs is up', async () => {
    // From before connecting: the server starts counting when it accepts.
    const from = Date.now();
    const { ms, text } = await untilClosed(await connectPlain(port), from);
    assert.equal(text, '');
    assert.ok(ms >= LIMITS.firstByteMs - 50, 'closed after ' + ms + ' ms, before firstByteMs');
    assert.ok(ms < LIMITS.firstByteMs + SLACK_MS, 'closed after ' + ms + ' ms');
  });

  it('answers a request whose headers stop halfway with 408 and closes it, over TLS and plain HTTP', async () => {
    const results = await Promise.all(
      [connectTls(port), connectPlain(port)].map(async (connecting) => {
        const s = await connecting;
        const closed = untilClosed(s);
        s.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
        return closed;
      })
    );
    for (const { ms, text } of results) {
      assert.match(text, /^HTTP\/1\.1 408 /);
      assert.ok(ms < LIMITS.headersMs + SLACK_MS, 'closed after ' + ms + ' ms');
    }
  });

  it('counts the header deadline from the start of the request, however slowly bytes keep coming', async () => {
    const s = await connectTls(port);
    const closed = untilClosed(s);
    // One byte every 100 ms: the connection never goes quiet.
    trickle(s, SLOW_REQUEST, 100);
    const { ms, text } = await closed;
    assert.match(text, /^HTTP\/1\.1 408 /);
    assert.ok(ms < LIMITS.headersMs + SLACK_MS, 'closed after ' + ms + ' ms');
  });

  it('starts the header deadline again for the next request on a kept-alive connection', async () => {
    const s = await connectTls(port);
    const closed = untilClosed(s);
    s.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await once(s, 'data');
    trickle(s, SLOW_REQUEST, 100);
    const { text } = await closed;
    assert.match(text, /^HTTP\/1\.1 200 OK\r\n[\s\S]*\r\n\r\nokHTTP\/1\.1 408 /);
  });

  it('cuts off a body still arriving at requestMs', async () => {
    const s = await connectTls(port);
    const closed = untilClosed(s);
    s.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1000\r\n\r\n');
    trickle(s, 'x'.repeat(1000), 100);
    const { ms, text } = await closed;
    assert.match(text, /^HTTP\/1\.1 408 /);
    assert.ok(ms >= LIMITS.requestMs - 50, 'closed after ' + ms + ' ms, before requestMs');
    assert.ok(ms < LIMITS.requestMs + SLACK_MS, 'closed after ' + ms + ' ms');
  });

  it('leaves a TLS handshake that stops partway to the TLS server, which closes it', async () => {
    const s = await connectPlain(port);
    const closed = untilClosed(s);
    // The first bytes of a TLS record, and nothing after them.
    s.write(Buffer.from([0x16, 0x03, 0x01]));
    const { ms } = await closed;
    assert.ok(ms >= HANDSHAKE_MS - 50, 'closed after ' + ms + ' ms, before the handshake deadline');
    assert.ok(ms < HANDSHAKE_MS + SLACK_MS, 'closed after ' + ms + ' ms');
  });

  it('delivers a big answer sent in one write to a client that reads it slowly', async () => {
    const s = await connectTls(port);
    const closed = untilClosed(s, Date.now(), 20000);
    // About 1.6 MB a second: the write stays pending for seconds.
    s.on('data', () => {
      s.pause();
      setTimeout(() => s.resume(), 10);
    });
    s.write('GET /big HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    const { text } = await closed;
    assert.match(text, /^HTTP\/1\.1 200 OK\r\n/);
    assert.equal(text.length - text.indexOf('\r\n\r\n') - 4, BIG_BYTES, 'the answer was cut short');
  });

  it('waits for a handler that works longer than every limit before it answers', async () => {
    const s = await connectTls(port);
    const closed = untilClosed(s);
    s.write('GET /slow HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    const { text } = await closed;
    assert.match(text, /^HTTP\/1\.1 200 OK\r\n[\s\S]*\r\n\r\ndone$/);
  });

  it('answers a complete request, over TLS and with a redirect over plain HTTP', async () => {
    const [secure, plain] = await Promise.all([connectTls(port), connectPlain(port)]);
    const closed = [untilClosed(secure), untilClosed(plain)];
    for (const s of [secure, plain]) s.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    const [a, b] = await Promise.all(closed);
    assert.match(a.text, /^HTTP\/1\.1 200 OK\r\n[\s\S]*\r\n\r\nok$/);
    assert.match(b.text, /^HTTP\/1\.1 301 /);
  });

  it('keeps an event stream open past every limit while it is written to', async () => {
    const s = await connectTls(port);
    let text = '';
    let closedAfter = null;
    const from = Date.now();
    s.setEncoding('latin1');
    s.on('data', (d) => (text += d));
    s.on('close', () => (closedAfter = Date.now() - from));
    s.write('GET /events HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await new Promise((resolve) => setTimeout(resolve, LIMITS.requestMs + 500));
    assert.equal(closedAfter, null, 'the stream was closed after ' + closedAfter + ' ms');
    assert.match(text, /^HTTP\/1\.1 200 OK\r\n/);
    assert.ok(text.split('data: ').length > 5, 'too few events: ' + JSON.stringify(text));
    s.destroy();
  });
});

describe('the connection limit', { timeout: 30000 }, () => {
  it('closes a connection past maxConnections at once', async () => {
    // The three connections that fill the port send no request, so on a slow
    // machine the header deadline must not free a place before the fourth comes.
    const limited = await openPort({ ...LIMITS, headersMs: 10000, requestMs: 10000, maxConnections: 3 });
    // Node raises 'drop' as it closes the extra connection, before the client
    // can see the close; server.js logs it.
    let drops = 0;
    limited.mux.on('drop', () => drops++);
    try {
      await Promise.all([1, 2, 3].map(() => connectTls(limited.port)));
      const { text } = await untilClosed(await connectPlain(limited.port));
      assert.equal(drops, 1, 'not closed for the limit');
      assert.equal(text, '');
    } finally {
      limited.close();
    }
  });
});

describe('the connection limit per address', { timeout: 30000 }, () => {
  it('closes a connection past perAddress at once, and frees the place when one closes', async () => {
    const limited = await openPort(
      { ...LIMITS, headersMs: 10000, requestMs: 10000, perAddress: 2 },
      portMux(() => false)
    );
    const drops = [];
    limited.mux.on('drop', (info) => drops.push(info));
    const serverSide = new Map();
    limited.mux.on('connection', (s) => serverSide.set(s.remotePort, s));
    try {
      const held = await Promise.all([1, 2].map(() => connectTls(limited.port)));
      const { text } = await untilClosed(await connectPlain(limited.port));
      assert.deepEqual(drops, [{ perAddress: true }], 'not closed for the limit per address');
      assert.equal(text, '');
      const leaving = serverSide.get(held[0].localPort);
      held[0].destroy();
      await once(leaving, 'close');
      await connectTls(limited.port);
      assert.equal(drops.length, 1);
    } finally {
      limited.close();
    }
  });

  it('lets an address that many clients share past perAddress', async () => {
    const limited = await openPort({ ...LIMITS, headersMs: 10000, requestMs: 10000, perAddress: 2 });
    let drops = 0;
    limited.mux.on('drop', () => drops++);
    try {
      await Promise.all([1, 2, 3].map(() => connectTls(limited.port)));
      assert.equal(drops, 0);
    } finally {
      limited.close();
    }
  });
});

describe('sharedAddress in server.js', () => {
  it('counts this machine, local networks, a carrier or VPN range and link-local as shared', () => {
    const shared = ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.20.30.40', '172.16.0.1', '172.31.255.254'];
    shared.push('192.168.0.10', '100.64.0.1', '100.127.255.254', '169.254.10.20', 'fd12:3456:789a::1', 'fe80::1');
    for (const a of shared) assert.equal(sharedAddress(a), true, a);
  });

  it('counts every other address as a source of its own', () => {
    for (const a of ['192.0.2.10', '198.51.100.7', '203.0.113.200', '::ffff:203.0.113.5', '2001:db8::1']) {
      assert.equal(sharedAddress(a), false, a);
    }
  });
});

// The real limits against what runs on the port. Each of these is a claim in
// the comment above PORT_LIMITS in server.js.
describe('PORT_LIMITS in server.js', () => {
  it('let one browser in from any address, and no single address take the whole port', () => {
    assert.ok(PORT_LIMITS.perAddress >= 7, 'a browser opens six connections, plus its event stream');
    assert.ok(PORT_LIMITS.perAddress < PORT_LIMITS.maxConnections);
  });

  function constant(name) {
    const m = SRC.match(new RegExp('const ' + name + ' = ([^;]+);'));
    assert.ok(m, name + ' is gone from server.js, so this test needs updating with it');
    return new Function('return ' + m[1])();
  }

  it('take the largest bodies at half a megabit per second', () => {
    const bytesPerSecond = 0.5e6 / 8;
    for (const name of ['ORIGINAL_MAX_BYTES', 'MAX_BACKUP']) {
      const needs = (constant(name) / bytesPerSecond) * 1000;
      assert.ok(PORT_LIMITS.requestMs >= needs, name + ' needs ' + Math.round(needs) + ' ms');
    }
  });

  it('keep the header deadline inside the request deadline, as Node requires', () => {
    assert.ok(PORT_LIMITS.headersMs <= PORT_LIMITS.requestMs);
  });
});
