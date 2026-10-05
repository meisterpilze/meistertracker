'use strict';
// scripts/rfc3161.js: the request a TSA gets, and how its answer is read.
//
// What matters: the request is the DER RFC 3161 asks for, with our hash and
// nonce and nothing else; an answer is only accepted when it was granted and
// its token is about our hash and our request; anything cut short, refused or
// about something else is an error with a reason; and the HTTP side gives up
// instead of hanging or reading without end.
//
// test/fixtures/rfc3161-token.der is a real token, from a public TSA, over a
// random hash. It carries the TSA's own certificates, nothing else.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const r = require('../scripts/rfc3161.js');

const { hex, SHA256, tstInfo, token, antwort } = require('./helpers/tsa');
const HASH = Buffer.alloc(32, 0xab);
const NONCE = hex('1122334455667788');

describe('RFC 3161: die Anfrage', () => {
  it('ist genau das DER aus der RFC: Version 1, SHA-256 und Hash, Nonce, Zertifikat erbeten', () => {
    const der = r.buildRequest(HASH, NONCE);
    assert.equal(
      der.toString('hex'),
      '3043' +
        '020101' +
        '3031' +
        '300d0609' +
        SHA256 +
        '0500' +
        '0420' +
        'ab'.repeat(32) +
        '02081122334455667788' +
        '0101ff'
    );
  });

  it('nimmt nur einen Hash von 32 Bytes', () => {
    assert.throws(() => r.buildRequest(Buffer.alloc(20), NONCE), /32 bytes/);
    assert.throws(() => r.buildRequest('ab'.repeat(32), NONCE), /32 bytes/);
  });

  it('macht eine Nonce, die eine positive Zahl in kuerzester Form ist', () => {
    for (let i = 0; i < 200; i++) {
      const n = r.randomNonce();
      assert.equal(n.length, 8);
      assert.ok(n[0] >= 1 && n[0] <= 0x7f, 'neither a leading zero byte nor negative');
    }
  });
});

describe('RFC 3161: die Antwort', () => {
  it('liest ein echtes Token: Zeit, Seriennummer, und das Token, wie es kam', () => {
    const echt = fs.readFileSync(path.join(__dirname, 'fixtures', 'rfc3161-token.der'));
    const hash = hex('6491253b709b930450ebaea22b4ca9fd36111db9e53bbb60024fd511d773d505');
    const nonce = hex('19ccc7d122c3a239');
    const x = r.readResponse(antwort(0, echt), hash, nonce);
    assert.equal(x.genTime, '2026-10-03T09:37:28.000Z');
    assert.equal(x.serial, '3ec9c7abf5d5259dc282b38c2c523b13');
    assert.ok(x.token.equals(echt));
    assert.throws(() => r.readResponse(antwort(0, echt), Buffer.alloc(32), nonce), /another hash/);
    assert.throws(() => r.readResponse(antwort(0, echt), hash, hex('19ccc7d122c3a238')), /another request/);
  });

  it('nimmt "granted with modifications" wie "granted"', () => {
    const tok = token(tstInfo({ hash: HASH, nonce: NONCE }));
    for (const status of [0, 1]) {
      const x = r.readResponse(antwort(status, tok), HASH, NONCE);
      assert.equal(x.genTime, '2026-10-03T09:37:28.000Z');
      assert.equal(x.serial, '0a0b0c');
      assert.ok(x.token.equals(tok));
    }
  });

  it('findet die Nonce auch hinter einer Genauigkeitsangabe', () => {
    const tok = token(tstInfo({ hash: HASH, nonce: NONCE, accuracy: true }));
    assert.equal(r.readResponse(antwort(0, tok), HASH, NONCE).serial, '0a0b0c');
  });

  it('sagt, warum eine Antwort nicht genommen wird', () => {
    const gut = (o = {}) => token(tstInfo({ hash: HASH, nonce: NONCE, ...o }));
    const faelle = [
      [antwort(2, null, 'bad request'), /refused with status 2 \(bad request\)/],
      [antwort(0, null), /token missing/],
      [antwort(0, gut({ hash: Buffer.alloc(32, 1) })), /another hash/],
      [antwort(0, gut({ ohneNonce: true })), /another request/],
      [antwort(0, gut({ nonce: hex('11') })), /another request/],
      [antwort(0, gut({ algorithmus: '2b0e03021a' })), /not over a SHA-256/],
      [antwort(0, gut({ zeit: '2026-10-03' })), /unreadable time/],
      [antwort(0, token(tstInfo({ hash: HASH, nonce: NONCE }), { inhalt: '2a03' })), /no TSTInfo/],
      [antwort(0, token(tstInfo({ hash: HASH, nonce: NONCE }), { art: '2a03' })), /not signed data/],
      [antwort(0, gut()).subarray(0, 40), /cut short/],
      [Buffer.concat([antwort(0, gut()), hex('00')]), /bytes after the answer/],
      [Buffer.from('<html>Bad Gateway</html>'), /answer missing|cut short|unexpected|unsupported/]
    ];
    for (const [der, grund] of faelle) assert.throws(() => r.readResponse(der, HASH, NONCE), grund);
  });

  it('liest ein gespeichertes Token wieder: Hash, Zeit, Seriennummer', () => {
    const echt = fs.readFileSync(path.join(__dirname, 'fixtures', 'rfc3161-token.der'));
    assert.deepEqual(r.tokenInfo(echt), {
      hash: '6491253b709b930450ebaea22b4ca9fd36111db9e53bbb60024fd511d773d505',
      genTime: '2026-10-03T09:37:28.000Z',
      serial: '3ec9c7abf5d5259dc282b38c2c523b13'
    });
    assert.throws(() => r.tokenInfo(Buffer.from([1, 2, 3])), /RFC 3161/);
    assert.throws(() => r.tokenInfo(Buffer.concat([echt, hex('00')])), /bytes after the token/);
  });

  it('liest Bruchteile von Sekunden mit, auf Millisekunden', () => {
    assert.equal(r.generalizedTime('20261003093728.5Z'), '2026-10-03T09:37:28.500Z');
    assert.equal(r.generalizedTime('20261003093728.12345Z'), '2026-10-03T09:37:28.123Z');
    assert.throws(() => r.generalizedTime('20261303093728Z'), /unreadable time/);
  });
});

// Eine Stelle zum Ausprobieren: sie antwortet, wie handler es sagt.
function stelle(handler) {
  return new Promise((fertig) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      fertig({ url: 'http://127.0.0.1:' + server.address().port + '/tsr', zu: () => server.close() });
    });
  });
}
function lesen(req) {
  return new Promise((fertig) => {
    const teile = [];
    req.on('data', (c) => teile.push(c));
    req.on('end', () => fertig(Buffer.concat(teile)));
  });
}

describe('RFC 3161: ueber HTTP', () => {
  it('schickt die Anfrage mit dem richtigen Typ und liest die Antwort', async () => {
    let typ = null;
    const s = await stelle(async (req, res) => {
      typ = req.headers['content-type'];
      const anfrage = await lesen(req);
      // Hash und Nonce stehen in der Anfrage an festen Stellen.
      const hash = anfrage.subarray(24, 56);
      const nonce = anfrage.subarray(58, 66);
      res.writeHead(200, { 'Content-Type': 'application/timestamp-reply' });
      res.end(antwort(0, token(tstInfo({ hash, nonce }))));
    });
    try {
      const x = await r.stamp(s.url, 'cd'.repeat(32));
      assert.equal(typ, 'application/timestamp-query');
      assert.equal(x.genTime, '2026-10-03T09:37:28.000Z');
    } finally {
      s.zu();
    }
  });

  it('legt bei einer Fehlerantwort auf, statt weiterzulesen', async () => {
    let zu = null;
    const s = await stelle(async (req, res) => {
      await lesen(req);
      res.writeHead(500);
      const tropfen = setInterval(() => res.write('x'.repeat(100)), 20);
      req.socket.on('close', () => {
        clearInterval(tropfen);
        zu = Date.now();
      });
    });
    try {
      const start = Date.now();
      await assert.rejects(r.post(s.url, Buffer.alloc(3), 2000), /HTTP 500/);
      await new Promise((fertig) => setTimeout(fertig, 300));
      assert.ok(zu !== null && zu - start < 1000, 'the socket is closed, not drained');
    } finally {
      s.zu();
    }
  });

  it('gibt auf: bei einem HTTP-Fehler, einer zu grossen Antwort und einer, die nicht kommt', async () => {
    const s = await stelle(async (req, res) => {
      await lesen(req);
      if (req.url.endsWith('/kaputt')) {
        res.writeHead(500);
        res.end('nein');
      } else if (req.url.endsWith('/gross')) {
        res.writeHead(200);
        res.end(Buffer.alloc(r.MAX_ANSWER_BYTES + 10));
      }
      // sonst: keine Antwort
    });
    try {
      await assert.rejects(r.post(s.url + '/kaputt', Buffer.alloc(3), 2000), /HTTP 500/);
      await assert.rejects(r.post(s.url + '/gross', Buffer.alloc(3), 2000), /too large/);
      await assert.rejects(r.post(s.url + '/still', Buffer.alloc(3), 200), /no answer within/);
      await assert.rejects(r.post('ftp://example.com/', Buffer.alloc(3), 200), /only http and https/);
      await assert.rejects(r.post('kein url', Buffer.alloc(3), 200), /not a URL/);
    } finally {
      s.zu();
    }
  });
});
