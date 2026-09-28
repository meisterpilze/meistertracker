'use strict';
// What a route gets when it reads a JSON body, and what happens when it throws.
//
// jsonBody handed its callback whatever JSON.parse returned. Most routes read
// `data.<field>` or call validateTypes(data, …) before their own try, so a body
// of literally `null` threw a TypeError inside the request's 'end' listener.
// Nothing there caught it: the process-level uncaughtException handler only
// logs, and Node's requestTimeout stops counting once the body has arrived, so
// the request was never answered and the socket stayed open. A number, a
// string, `true` or `[]` got further and came back as a 200 that changed
// nothing. An object could hang a request the same way:
// {"started":{"toString":1}} made `new Date()` throw inside
// PATCH /api/experiments/:id.
//
// So jsonBody now turns away anything that is not an object with a 400, and a
// callback that throws is answered through safeErr. Two routes do take other
// shapes, /mcp (a JSON-RPC batch is an array) and the order import (a bare
// array of orders). They read the body with anyJsonBody, which passes every
// shape through and sits behind the same catch.
//
// server.js listens on require, so the readers are lifted out of its source
// and put behind an HTTP server of this file's own: a request left hanging
// only shows on a real socket.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const db = require('../db');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function lift(name) {
  const m = SRC.match(new RegExp('\\nfunction ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
  assert.ok(m, name + ' is gone from server.js — this test needs updating with it');
  return m[0];
}

// Everything log() is asked to write, so a test can check what got reported.
const logged = [];
const NAMES = ['anyJsonBody', 'jsonBody', 'jsonErr', 'jsonOk', 'safeErr', 'validateTypes', 'validateDate'];
const { anyJsonBody, jsonBody, jsonErr, jsonOk, validateTypes, validateDate } = new Function(
  'MAX_BODY_SIZE',
  'db',
  'log',
  NAMES.map(lift).join('\n') + '\nreturn { ' + NAMES.join(', ') + ' };'
)(5 * 1024 * 1024, db, (level, msg, meta) => logged.push({ level, msg, meta }));

// Loopback, and every route below answers at once, so this only runs out when
// a request has been left hanging.
const DEADLINE_MS = 5000;

describe('JSON request bodies', () => {
  // The route the next request runs into. Each test sets its own.
  let route;
  let port;
  const server = http.createServer((req, res) => {
    const read = req.url === '/any' ? anyJsonBody : jsonBody;
    read(req, res, (e, data) => route(data, res));
  });
  before(() =>
    new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)).then(() => (port = server.address().port))
  );
  after(() => {
    server.closeAllConnections();
    server.close();
  });

  // POSTs `body` and resolves with what came back. A request that is never
  // answered is the failure this file is about, so the helper does not wait for
  // one: it gives up at the deadline and says so.
  function post(url, body) {
    return new Promise((resolve, reject) => {
      const signal = AbortSignal.timeout(DEADLINE_MS);
      signal.addEventListener('abort', () => reject(new Error('no answer within ' + DEADLINE_MS + ' ms')));
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: url,
          method: 'POST',
          agent: false,
          signal,
          headers: { 'Content-Type': 'application/json' }
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (text += c));
          res.on('close', () => resolve({ status: res.statusCode, text, complete: res.complete }));
        }
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  describe('jsonBody', () => {
    it('turns away null, a number, a string, true and an array with a 400', async () => {
      let reached = 0;
      route = (data, res) => {
        reached++;
        jsonOk(res);
      };
      for (const body of ['null', '5', '"abc"', 'true', '[]', '[{"title":"x"}]']) {
        const r = await post('/', body);
        assert.equal(r.status, 400, body);
        assert.deepEqual(JSON.parse(r.text), { error: 'Request body must be a JSON object' }, body);
      }
      assert.equal(reached, 0, 'a body that is not an object reached the route');
    });

    it('hands an object to the route as it came', async () => {
      route = (data, res) => jsonOk(res, { got: data });
      const r = await post('/', '{"title":"x","n":2,"tags":["a"]}');
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(r.text), { got: { title: 'x', n: 2, tags: ['a'] } });
    });

    it('still answers malformed JSON with its own 400', async () => {
      let reached = 0;
      route = (data, res) => {
        reached++;
        jsonOk(res);
      };
      for (const body of ['{', '']) {
        const r = await post('/', body);
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.deepEqual(JSON.parse(r.text), { error: 'bad json' });
      }
      assert.equal(reached, 0);
    });
  });

  describe('a route that throws before it answers', () => {
    // PATCH /api/experiments/:id, down to the two checks that threw: validateTypes
    // on a null body, and validateDate on a date that is an object.
    const patchExperiment = (data, res) => {
      const vt = validateTypes(data, { title: 'string' });
      if (vt) return jsonErr(res, 400, vt);
      for (const feld of ['started', 'ended']) {
        if (!data[feld]) continue;
        const vd = validateDate(data[feld], feld);
        if (vd) return jsonErr(res, 400, vd);
      }
      jsonOk(res);
    };

    it('no longer sees a null body at all', async () => {
      route = patchExperiment;
      const r = await post('/', 'null');
      assert.equal(r.status, 400);
      assert.deepEqual(JSON.parse(r.text), { error: 'Request body must be a JSON object' });
    });

    it('is answered with a 500 through safeErr, not left hanging', async () => {
      route = patchExperiment;
      logged.length = 0;
      const r = await post('/', '{"started":{"toString":1}}');
      assert.equal(r.status, 500);
      assert.deepEqual(JSON.parse(r.text), { error: 'Internal server error' });
      // What the client is not told goes to the log, as safeErr does it.
      assert.equal(logged.length, 1);
      assert.equal(logged[0].level, 'error');
      assert.equal(logged[0].msg, 'Unexpected error');
      assert.match(logged[0].meta.error, /primitive/);
    });

    it('keeps the 400 safeErr gives an error it knows', async () => {
      route = () => {
        throw new Error('Batch not found: B-1');
      };
      const r = await post('/', '{}');
      assert.equal(r.status, 400);
      assert.deepEqual(JSON.parse(r.text), { error: 'Batch not found: B-1' });
    });

    it('is caught on anyJsonBody as well', async () => {
      route = (data, res) => jsonOk(res, { channels: data.map((o) => o.channel.trim()) });
      const r = await post('/any', '[{}]');
      assert.equal(r.status, 500);
      assert.deepEqual(JSON.parse(r.text), { error: 'Internal server error' });
    });
  });

  describe('a route that throws after it started answering', () => {
    it('keeps the answer it gave, and logs the error', async () => {
      route = (data, res) => {
        jsonOk(res, { ok: true });
        throw new Error('after the answer');
      };
      logged.length = 0;
      const r = await post('/', '{}');
      assert.equal(r.status, 200);
      assert.equal(r.complete, true);
      assert.deepEqual(JSON.parse(r.text), { ok: true });
      assert.equal(logged.length, 1);
      assert.equal(logged[0].msg, 'Unexpected error after the response started');
      assert.equal(logged[0].meta.error, 'after the answer');
    });

    it('cuts off a half-written answer instead of leaving it open', async () => {
      route = (data, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"rows":[');
        throw new Error('halfway through');
      };
      // Node holds a response's first write back until the next tick, so the
      // head may never leave before the socket closes: the client then hears a
      // hang-up rather than a truncated 200. Either is an answer that broke off,
      // which is the point; running into the deadline is not.
      const outcome = await post('/', '{}').then(
        (r) => (r.complete ? 'complete' : 'cut off'),
        (err) => (err.code === 'ECONNRESET' ? 'cut off' : err.message)
      );
      assert.equal(outcome, 'cut off');
    });
  });

  describe('anyJsonBody', () => {
    it('passes every shape through, for the routes that check it themselves', async () => {
      const seen = [];
      route = (data, res) => {
        seen.push(data);
        jsonOk(res);
      };
      for (const body of ['[{"channel":"x"}]', 'null', '5', '"abc"', '{"a":1}']) {
        assert.equal((await post('/any', body)).status, 200, body);
      }
      assert.deepEqual(seen, [[{ channel: 'x' }], null, 5, 'abc', { a: 1 }]);
    });

    it('is what /mcp and the order import read their body with, and nothing else', () => {
      const readerAfter = (marker) => {
        const at = SRC.indexOf(marker);
        assert.ok(at >= 0, 'route not found in server.js: ' + marker);
        return SRC.slice(at).match(/\b(anyJsonBody|jsonBody)\(req, res,/)[1];
      };
      // A JSON-RPC batch is an array, and the MCP SDK checks whatever arrives.
      assert.equal(readerAfter("if (req.url === '/mcp' || req.url.startsWith('/mcp?')) {"), 'anyJsonBody');
      // "single object, or {orders:[...]}, or [...]"
      assert.equal(readerAfter("url === '/api/orders/import'"), 'anyJsonBody');
      // Every call but the one inside jsonBody comes from a route.
      const routes = SRC.replace(lift('anyJsonBody'), '').replace(lift('jsonBody'), '');
      assert.equal(
        routes.match(/\banyJsonBody\(/g).length,
        2,
        'a new route on anyJsonBody has to check the shape of its body itself; add it here once it does'
      );
    });
  });
});
