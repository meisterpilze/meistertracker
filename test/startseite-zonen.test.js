'use strict';
// The start screen: daily jobs first, the weekly ones small below them, and
// "Wo steht was" with the day each group of bags went in and how long it has
// been there — the dates are what the team works from, so they are tested.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function lift(name) {
  const m = APP.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`, 'm'));
  assert.ok(m, `${name} not found in app.js — this file is testing nothing`);
  return m[0];
}

describe('Startseite — Kacheln', () => {
  it('puts the daily jobs in the first row and the weekly ones in the small row', () => {
    const first = HTML.indexOf('<div class="wk-tiles">');
    const small = HTML.indexOf('<div class="wk-tiles wk-tiles-row2 wk-tiles-small">');
    assert.ok(first > 0 && small > first);
    const order = [...HTML.matchAll(/id="wk-t-(\w+)"/g)].map((m) => [m[1], m.index]);
    const big = order.filter(([, i]) => i > first && i < small).map(([id]) => id);
    const weekly = order.filter(([, i]) => i > small).map(([id]) => id);
    assert.deepEqual(big, ['move', 'harvest', 'contam', 'batch']);
    assert.deepEqual(weekly, ['lab', 'grain', 'sub']);
  });

  it('has every new text in all three languages', () => {
    for (const lang of ['de', 'en', 'pt']) {
      const src = fs.readFileSync(path.join(ROOT, 'lang', lang + '.js'), 'utf8');
      for (const k of ['work.tileBatch', 'work.tileSubstrate', 'work.todayNone', 'work.alertFull', 'work.tentsTitle']) {
        assert.ok(src.includes(`'${k}':`), `${lang} lacks ${k}`);
      }
    }
  });
});

describe('Startseite — Wo steht was', () => {
  const rows = new Function(
    'esc',
    't',
    'tp',
    'fmtDtShort',
    '_wkTentFold',
    `${lift('_wkZoneRowsHtml')}\nreturn _wkZoneRowsHtml;`
  )(
    (s) => String(s),
    (k, p) => (k === 'work.tentSince' ? 'seit ' + p.date : k === 'work.tentToday' ? 'heute' : k),
    (k, n) => (k === 'work.tentDays' ? n + (n === 1 ? ' Tag' : ' Tage') : n + ' Beutel'),
    (d) => String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.',
    { open: new Set() }
  );
  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  };

  it('says when a group went in and how long ago, oldest first', () => {
    const html = rows(
      { id: 'TENT1' },
      {
        'BO-1-02': { batchId: 'BO-1', species: 'Blue Oyster', since: daysAgo(0) },
        'LM-1-03': { batchId: 'LM-1', species: 'Lions Mane', since: daysAgo(8) }
      }
    );
    assert.ok(html.indexOf('Lions Mane') < html.indexOf('Blue Oyster'), 'oldest group first');
    assert.match(html, /8 Tage/);
    assert.match(html, /seit \d\d\.\d\d\. · heute/);
  });

  it('keeps bags of one species that went in on different days apart', () => {
    const html = rows(
      { id: 'TENT1' },
      {
        'LM-1-01': { batchId: 'LM-1', species: 'Lions Mane', since: daysAgo(8) },
        'LM-2-01': { batchId: 'LM-2', species: 'Lions Mane', since: daysAgo(0) },
        'LM-2-02': { batchId: 'LM-2', species: 'Lions Mane', since: daysAgo(0) }
      }
    );
    assert.equal((html.match(/class="wk-tent-row"/g) || []).length, 2);
    assert.match(html, /2 Beutel/);
    assert.match(html, /LM-2<\/span> 01, 02/);
  });
});
