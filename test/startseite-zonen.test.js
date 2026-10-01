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
  it('has one grid, daily jobs first and Kontamination last', () => {
    assert.equal((HTML.match(/class="wk-tiles/g) || []).length, 1);
    const ids = [...HTML.matchAll(/id="wk-t-(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ['move', 'harvest', 'batch', 'lab', 'grain', 'sub', 'contam']);
  });

  it('has every new text in all three languages', () => {
    for (const lang of ['de', 'en', 'pt']) {
      const src = fs.readFileSync(path.join(ROOT, 'lang', lang + '.js'), 'utf8');
      for (const k of [
        'work.tileBatch',
        'work.tileSubstrate',
        'work.todayNone',
        'work.alertFull',
        'work.tentsTitle',
        'work.orderEdit',
        'work.orderReset',
        'work.orderDone',
        'work.orderUp',
        'work.orderDown'
      ]) {
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

describe('Startseite — eigene Reihenfolge', () => {
  function load(stored, username) {
    const store = new Map(stored ? [['mp-tile-order:' + username, stored]] : []);
    const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
    const src = ['WK_TILES', 'WK_TILE_DEFAULT']
      .map((n) => APP.match(new RegExp(`^const ${n} = [\\s\\S]*?;\\n`, 'm'))[0])
      .join('\n');
    const fns = ['_wkOrderKey', 'wkTileOrder', 'saveWkTileOrder'].map(lift).join('\n');
    return new Function(
      'localStorage',
      'currentUser',
      `${src}\n${fns}\nreturn { wkTileOrder, saveWkTileOrder, store: null };`
    )(localStorage, username ? { username } : null);
  }

  it('starts from the default order with Kontamination last', () => {
    const o = load(null, 'max').wkTileOrder();
    assert.equal(o[o.length - 1], 'contam');
    assert.equal(o.length, 7);
  });

  it('keeps each user their own order', () => {
    const mine = JSON.stringify(['lab', 'harvest', 'move']);
    assert.deepEqual(load(mine, 'max').wkTileOrder().slice(0, 3), ['lab', 'harvest', 'move']);
    // Max's order is stored under his name; Erika on the same phone has none.
    const store = new Map([['mp-tile-order:max', mine]]);
    const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: () => {} };
    const src = ['WK_TILES', 'WK_TILE_DEFAULT']
      .map((n) => APP.match(new RegExp(`^const ${n} = [\\s\\S]*?;\\n`, 'm'))[0])
      .join('\n');
    const fns = ['_wkOrderKey', 'wkTileOrder'].map(lift).join('\n');
    const forErika = new Function('localStorage', 'currentUser', `${src}\n${fns}\nreturn wkTileOrder;`)(ls, {
      username: 'erika'
    });
    assert.equal(forErika()[0], 'move');
  });

  it('drops unknown and duplicate tiles and appends missing ones', () => {
    const o = load(JSON.stringify(['old', 'harvest', 'harvest']), 'max').wkTileOrder();
    assert.equal(o[0], 'harvest');
    assert.equal(o.length, 7);
    assert.ok(!o.includes('old'));
  });

  it('survives garbage in storage', () => {
    assert.equal(load('{not json', 'max').wkTileOrder().length, 7);
    assert.equal(load('{"a":1}', 'max').wkTileOrder().length, 7);
  });
});
