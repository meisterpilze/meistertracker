'use strict';
// The URL shapes the substrate endpoints answer to.
//
// Worth its own test because the list route was originally a prefix match —
// `req.url.startsWith('/api/substrate-batches')` — which also swallowed
// `/api/substrate-batches/SUB-01` and answered a request for one mix with the
// whole list. Nothing errors when that happens; the detail dialog just renders
// an array as if it were a mix, and every field reads undefined.
//
// server.js starts listening on require, so it cannot be imported. The route
// patterns are lifted out of the source instead — the same approach the
// harvest-feed UI tests use — which is enough to pin what matches what.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// Pull a regex literal out of the source by the line that carries it, so a
// failure names the route that moved rather than "undefined is not a function".
function liftPattern(marker, name) {
  const line = SRC.split('\n').find((l) => l.includes(marker));
  assert.ok(line, name + ' not found in server.js — the test needs updating with it');
  const m =
    line.match(/\/\^[^/]*\/(?=\.test|\))/) || line.match(/(\/\^.*?\/)\.test/) || line.match(/match\((\/\^.*?\/)\)/);
  assert.ok(m, name + ': could not lift a regex from: ' + line.trim());
  const body = (m[1] || m[0]).replace(/^\//, '').replace(/\/$/, '');
  return new RegExp(body);
}

describe('substrate route shapes', () => {
  const list = liftPattern('/^\\/api\\/substrate-batches(\\?|$)/', 'list route');
  const detail = liftPattern('subGetMatch = req.url.match', 'detail route');
  const writeOff = liftPattern('subOffMatch = req.url.match', 'write-off route');
  const moisture = liftPattern('subRhMatch = req.url.match', 'measured-moisture route');
  const notes = liftPattern('subNoteMatch = req.url.match', 'comment route');
  const del = liftPattern('subDelMatch = req.url.match', 'delete route');

  it('answers the collection only at the collection URL', () => {
    assert.ok(list.test('/api/substrate-batches'));
    assert.ok(list.test('/api/substrate-batches?open=1'));
    // The regression this file exists for.
    assert.equal(list.test('/api/substrate-batches/SUB-01'), false, 'a single mix is not the list');
    assert.equal(list.test('/api/substrate-batches/SUB-01/write-off'), false);
  });

  it('reads one mix by id, and does not claim the collection URL', () => {
    assert.equal('/api/substrate-batches/SUB-01'.match(detail)[1], 'SUB-01');
    assert.equal(detail.test('/api/substrate-batches'), false);
    // A write-off is a different route; the detail pattern must not swallow it.
    assert.equal(detail.test('/api/substrate-batches/SUB-01/write-off'), false);
  });

  it('matches a write-off only with the action on the end', () => {
    assert.equal('/api/substrate-batches/SUB-01/write-off'.match(writeOff)[1], 'SUB-01');
    assert.equal(writeOff.test('/api/substrate-batches/SUB-01'), false);
  });

  it('matches the measured moisture only with the action on the end', () => {
    assert.equal('/api/substrate-batches/SUB-01/moisture'.match(moisture)[1], 'SUB-01');
    assert.equal(moisture.test('/api/substrate-batches/SUB-01'), false);
    // The two per-mix actions are neighbours; neither may answer for the other.
    assert.equal(moisture.test('/api/substrate-batches/SUB-01/write-off'), false);
    assert.equal(writeOff.test('/api/substrate-batches/SUB-01/moisture'), false);
    assert.equal(detail.test('/api/substrate-batches/SUB-01/moisture'), false);
    assert.equal(list.test('/api/substrate-batches/SUB-01/moisture'), false);
  });

  it('matches the comment only with the action on the end', () => {
    assert.equal('/api/substrate-batches/SUB-01/notes'.match(notes)[1], 'SUB-01');
    assert.equal(notes.test('/api/substrate-batches/SUB-01'), false);
    // Drei Aktionen am selben Ansatz; keine darf fuer eine andere antworten.
    assert.equal(notes.test('/api/substrate-batches/SUB-01/moisture'), false);
    assert.equal(notes.test('/api/substrate-batches/SUB-01/write-off'), false);
    assert.equal(moisture.test('/api/substrate-batches/SUB-01/notes'), false);
    assert.equal(detail.test('/api/substrate-batches/SUB-01/notes'), false);
  });

  it('matches a delete by id', () => {
    assert.equal('/api/substrate-batches/SUB-01'.match(del)[1], 'SUB-01');
    assert.equal(del.test('/api/substrate-batches'), false);
  });

  it('handles ids that need encoding without leaking the path separator', () => {
    // ids are validated on write, but the read routes take whatever arrives.
    assert.equal(detail.test('/api/substrate-batches/SUB%2F01'), true, 'encoded slash stays one segment');
    assert.equal(detail.test('/api/substrate-batches/SUB/01'), false, 'a real slash is a different route');
  });
});

describe('substrate routes are wired to the right handlers', () => {
  // Cheap structural checks: the pieces that would silently disappear in a
  // refactor and leave an endpoint unauthenticated or unbroadcast.
  it('guards deletion behind an admin check', () => {
    const i = SRC.indexOf('subDelMatch');
    const window = SRC.slice(i, i + 600);
    assert.match(window, /requireAdmin\(req, res\)/, 'deleting a mix must stay admin-only');
  });

  it('broadcasts after every mutation, so other screens see the new remainder', () => {
    for (const marker of ["req.url === '/api/substrate-batches'", 'subOffMatch', 'subDelMatch', 'from-substrate']) {
      const i = SRC.indexOf(marker);
      assert.ok(i > 0, marker + ' not found');
      assert.match(SRC.slice(i, i + 2000), /broadcastSSE\(res\)/, marker + ' does not broadcast');
    }
  });

  it('pushes the calendar entry with the due date it computed, not one from the client', () => {
    // createBagBatchFromSubstrate works the due date out from the Sorte's
    // incubation days. autoPushBatchCaldav drops any batch without a due, so
    // handing it `data` instead of the result silently loses the appointment.
    const i = SRC.indexOf("req.url === '/api/batches/from-substrate'");
    assert.ok(i > 0, 'from-substrate handler not found');
    const window = SRC.slice(i, i + 2500);
    const push = window.match(/autoPushBatchCaldav\(([^)]*)\)/);
    assert.ok(push, 'the handler must push a calendar entry');
    assert.match(push[1], /due:\s*\w+\.due/, 'due must come from the create result');
    assert.doesNotMatch(push[1], /due:\s*data\./, 'due must not be taken from the request body');
  });
});
