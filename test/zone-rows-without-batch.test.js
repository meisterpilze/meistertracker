'use strict';
// "Wo steht was" on the start screen lists each zone's bags by batch. A scan
// entry need not name its batch, and sorting the batches then threw, which
// also took down the day's tasks drawn after the card. A bag without a batch
// is still a bag in the zone: it is counted and listed under "—".
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hebeFunktion } = require('./helpers/quelle');

const rows = new Function(
  't',
  'tp',
  'fmtDtShort',
  '_wkTentFold',
  `${hebeFunktion('esc')}\n${hebeFunktion('_wkZoneRowsHtml')}\nreturn _wkZoneRowsHtml;`
)(
  (k, p) => (k === 'work.tentSince' ? 'seit ' + p.date : k === 'work.tentToday' ? 'heute' : k),
  (k, n) => (k === 'work.tentDays' ? n + (n === 1 ? ' Tag' : ' Tage') : n + ' Beutel'),
  (d) => String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.',
  { open: new Set() }
);
const today = new Date().toISOString();

describe('Wo steht was — bags without a batch', () => {
  it('lists a bag the server stored without a batch next to a named batch', () => {
    const html = rows(
      { id: 'TENT1' },
      {
        'BO-1-01': { batchId: 'BO-1', species: 'Blue Oyster', since: today },
        'BO-1-02': { batchId: null, species: 'Blue Oyster', since: today }
      }
    );
    assert.match(html, /2 Beutel/);
    assert.match(html, /BO-1<\/span> 01/);
    assert.match(html, /—<\/span> 02/);
  });

  it('does the same for an entry this device wrote without one', () => {
    const html = rows(
      { id: 'TENT1' },
      {
        'BO-1-01': { batchId: undefined, species: 'Blue Oyster', since: today },
        'BO-2-01': { batchId: 'BO-2', species: 'Blue Oyster', since: today },
        'BO-3-01': { batchId: 'BO-3', species: 'Blue Oyster', since: today }
      }
    );
    assert.match(html, /3 Beutel/);
    assert.ok(html.indexOf('>—</span>') < html.indexOf('>BO-2</span>'), 'the unnamed batch sorts first');
    assert.ok(html.indexOf('>BO-2</span>') < html.indexOf('>BO-3</span>'));
  });

  it('never prints "null" or "undefined" as a batch', () => {
    const html = rows({ id: 'TENT1' }, { 'X-01': { batchId: null, species: null, since: null } });
    assert.doesNotMatch(html, /null|undefined/);
    assert.match(html, /—<\/span> 01/);
  });
});
