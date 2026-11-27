'use strict';
// Bestellungen › Versandetiketten: only while the shipping service is in use.
//
// The view buys shipping labels from the service set up under Admin ›
// Versanddienst. With the service switched off it showed one notice, that the
// service is switched off, and still stood in every list of views. An
// installation that ships through another system never needed it.
//
// The server says whether it is in use (db.shippingInUse, sent with /api/data
// as shipOn): the service is switched on, or a label was bought before. Hidden,
// not removed: switching the service on brings the view back.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function hebe(name) {
  const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
  assert.ok(m, name + '() not found in app.js');
  return m[1];
}

describe('shipping: is it in use', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_ship_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('is not on a fresh installation, and /api/data says so', () => {
    assert.equal(db.shippingInUse(d), false);
    assert.equal(db.readAll(d).shipOn, false);
  });

  it('is as soon as the service is switched on, keys or not', () => {
    db.updateShippingConfig(d, { enabled: true });
    assert.equal(db.shippingInUse(d), true);
    assert.equal(db.readAll(d).shipOn, true);
    db.updateShippingConfig(d, { enabled: false });
    assert.equal(db.shippingInUse(d), false);
  });

  it('only reads', () => {
    const src = db.shippingInUse.toString();
    assert.doesNotMatch(src, /INSERT|UPDATE|DELETE/i);
    assert.match(src, /FROM shipments LIMIT 1/, 'a label bought before keeps the view');
  });
});

function seite({ inUse, offen, seiteOffen }) {
  const els = {};
  const el = (id, aktiv) => {
    const k = new Set(aktiv ? ['active'] : []);
    return (els[id] = {
      id,
      style: { display: id.endsWith('-versand') && !id.startsWith('sp-') ? 'none' : '' },
      classList: { add: (c) => k.add(c), remove: (c) => k.delete(c), contains: (c) => k.has(c) },
      aktiv: () => k.has('active')
    });
  };
  for (const pre of ['st', 'sp', 'sn'])
    for (const sub of ['pack', 'inbox', 'versand']) el(pre + '-orders-' + sub, sub === offen);
  el('p-orders', seiteOffen);
  const calls = [];
  new Function('document', 'shipInUse', 'openStab', hebe('showShipTab') + '\nshowShipTab();')(
    { getElementById: (id) => els[id] || null, querySelector: () => els['st-orders-' + offen] || null },
    inUse,
    (page, sub) => calls.push(page + '/' + sub)
  );
  return { els, calls };
}

describe('Bestellungen: the view Versandetiketten', () => {
  it('starts hidden in the markup, so nothing flashes before the server has answered', () => {
    assert.match(
      HTML,
      /<button class="stab" id="st-orders-versand" style="display: none" data-i18n="orders\.versandTab">/
    );
  });

  it('is shown, tab and list entry together, while shipping is in use', () => {
    const { els, calls } = seite({ inUse: true, offen: 'pack', seiteOffen: true });
    assert.deepEqual([els['st-orders-versand'].style.display, els['sn-orders-versand'].style.display], ['', '']);
    assert.deepEqual(calls, []);
  });

  it('stays hidden, both of the pair, while it is not, and leaves the others alone', () => {
    const { els } = seite({ inUse: false, offen: 'pack', seiteOffen: true });
    assert.deepEqual(
      [els['st-orders-versand'].style.display, els['sn-orders-versand'].style.display],
      ['none', 'none']
    );
    assert.equal(els['st-orders-inbox'].style.display, '');
  });

  it('sends whoever stands on it to Packen, by its tab while the page is open', () => {
    assert.deepEqual(seite({ inUse: false, offen: 'versand', seiteOffen: true }).calls, ['orders/pack']);
  });

  it('only moves the mark while another page is open', () => {
    const { els, calls } = seite({ inUse: false, offen: 'versand', seiteOffen: false });
    assert.deepEqual(calls, []);
    for (const pre of ['st', 'sp', 'sn']) {
      assert.equal(els[pre + '-orders-versand'].aktiv(), false);
      assert.equal(els[pre + '-orders-pack'].aktiv(), true);
    }
  });

  it('follows every answer of the server', () => {
    assert.match(hebe('applyData'), /shipInUse = !!d\.shipOn;\s*showShipTab\(\);/);
  });
});
