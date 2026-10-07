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

// On a phone the tile titles broke wherever the last letter fitted:
// "contamina / tion" at 390px, "Subst / rate" and "Repor / t" at 320px. Two
// things stop that, and both are only written here, not rendered: the browser
// hyphenates by the page's lang, and the title keeps the room a word it will
// not hyphenate needs — Chrome leaves capitalised English words whole, and
// "Substrate" is about 79px wide at 17px.
describe('Startseite — Kacheln auf dem Telefon', () => {
  const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const phone = [...CSS.matchAll(/@media \(max-width: 768px\) \{[\s\S]*?\n\}/g)]
    .map((m) => m[0])
    .find((b) => b.includes('.wk-tile-t {'));
  const rule = (sel) => {
    const m = phone && phone.match(new RegExp('\\n  ' + sel.replace(/\./g, '\\.') + ' \\{([\\s\\S]*?)\\n  \\}'));
    assert.ok(m, sel + ' not found in the phone block of styles.css — this test reads nothing');
    return m[1];
  };

  it('hyphenates the title, and keeps breaking anywhere only as the last resort', () => {
    const t = rule('.wk-tile-t');
    assert.match(t, /\n\s*hyphens: auto;/);
    assert.match(t, /-webkit-hyphens: auto;/, 'Safari on the iPhone still wants the prefix');
    assert.match(t, /overflow-wrap: anywhere;/);
  });

  it('hyphenates in the language on screen: translatePage() sets lang on <html>', () => {
    const doc = { querySelectorAll: () => [], documentElement: { lang: 'de' } };
    new Function('document', 't', 'currentLang', lift('translatePage') + '\ntranslatePage();')(doc, (k) => k, 'en');
    assert.equal(doc.documentElement.lang, 'en');
  });

  it('leaves the title 80px from 320 to 430px wide', () => {
    const tile = rule('.wk-tile');
    const art = tile.match(/--wk-art: clamp\((\d+)px, (\d+)vw - (\d+)px, (\d+)px\);/);
    assert.ok(art, 'the drawing no longer gives way on a narrow phone');
    const [lo, vw, off, hi] = art.slice(1).map(Number);
    const [, right, , left] = tile
      .match(/padding: (\d+)px (\d+)px (\d+)px (\d+)px;/)
      .slice(1)
      .map(Number);
    const gap = Number(tile.match(/column-gap: (\d+)px;/)[1]);
    const between = Number(rule('.wk-tiles').match(/gap: (\d+)px;/)[1]);
    const page = Number(CSS.match(/^ {2}--pad-page: (\d+)px;/m)[1]);
    for (const w of [320, 340, 360, 375, 390, 414, 430]) {
      const drawing = Math.min(hi, Math.max(lo, (vw * w) / 100 - off));
      // Two tiles side by side, a 1px border round each.
      const title = (w - 2 * page - between) / 2 - 2 - left - right - drawing - gap;
      assert.ok(title >= 80, w + 'px: ' + title + 'px for the title');
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
  function load(stored, username, serverOrder) {
    const store = new Map(stored ? [['mp-tile-order:' + username, stored]] : []);
    const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
    const src = ['WK_TILES', 'WK_TILE_DEFAULT']
      .map((n) => APP.match(new RegExp(`^const ${n} = [\\s\\S]*?;\\n`, 'm'))[0])
      .join('\n');
    const fns = ['_wkOrderKey', '_wkLocalOrder', 'wkTileOrder'].map(lift).join('\n');
    return new Function('localStorage', 'currentUser', `${src}\n${fns}\nreturn { wkTileOrder };`)(
      localStorage,
      username ? { username, tileOrder: serverOrder === undefined ? null : serverOrder } : null
    );
  }

  it('takes the order stored on the server over the copy on the phone', () => {
    const o = load(JSON.stringify(['lab']), 'max', ['grain', 'contam']).wkTileOrder();
    assert.deepEqual(o.slice(0, 2), ['grain', 'contam']);
    assert.equal(o.length, 7);
  });

  it('falls back to the phone copy while the server has none', () => {
    assert.equal(load(JSON.stringify(['lab']), 'max', null).wkTileOrder()[0], 'lab');
  });

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
    const fns = ['_wkOrderKey', '_wkLocalOrder', 'wkTileOrder'].map(lift).join('\n');
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
