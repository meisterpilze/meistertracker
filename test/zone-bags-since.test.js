'use strict';
// getZoneBags() says when each bag came into the zone — the "seit 30.09." on
// the home screen's tent card. A rack-to-rack move inside the zone is not an
// arrival, so it keeps the first date.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const src = APP.match(/^function getZoneBags\([\s\S]*?\n\}/m);
assert.ok(src, 'getZoneBags not found in app.js — this file is testing nothing');

function zoneBags(scanLog, zone) {
  const toZone = (l) => (l ? String(l).split('_')[0] : l);
  return new Function('scanLog', 'toZone', `${src[0]}\nreturn getZoneBags;`)(scanLog, toZone)(zone);
}

const bag = (action, from, to, time) => ({
  action,
  from,
  to,
  time,
  bag: 'BO-1-02',
  batch: 'BO-1',
  species: 'Blue Oyster'
});

describe('getZoneBags since', () => {
  it('is the time of the move into the zone', () => {
    const b = zoneBags(
      [bag('ADD', null, 'INC_R1', '2026-09-01T08:00:00Z'), bag('MOVE', 'INC_R1', 'TENT1', '2026-09-30T12:28:00Z')],
      'TENT1'
    );
    assert.equal(b['BO-1-02'].since, '2026-09-30T12:28:00Z');
  });

  it('survives a move between racks of the same zone', () => {
    const b = zoneBags(
      [bag('ADD', null, 'INC_R1', '2026-09-01T08:00:00Z'), bag('MOVE', 'INC_R1', 'INC_R2', '2026-09-10T08:00:00Z')],
      'INC'
    );
    assert.equal(b['BO-1-02'].since, '2026-09-01T08:00:00Z');
  });

  it('starts over when the bag leaves and comes back', () => {
    const b = zoneBags(
      [
        bag('MOVE', 'INC', 'TENT1', '2026-09-20T08:00:00Z'),
        bag('MOVE', 'TENT1', 'INC', '2026-09-21T08:00:00Z'),
        bag('MOVE', 'INC', 'TENT1', '2026-09-30T08:00:00Z')
      ],
      'TENT1'
    );
    assert.equal(b['BO-1-02'].since, '2026-09-30T08:00:00Z');
  });
});
