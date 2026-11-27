'use strict';
// Bestellungen: two views only while there is something for them.
//
// Produkt-Zuordnung and Kunden belong to a shop that is connected directly:
// products that channel articles are mapped to, customers those connections
// bring in. An installation that takes its orders in through Billbee has
// neither. There the two views were lists that stayed empty, between the three
// views that are used every day, and a banner in Eingang said "noch
// zuzuordnen" about every order that arrived.
//
// Nothing is removed. The server says whether the order hub is in use
// (db.orderHubInUse, sent with /api/data), and the page shows the two views
// when it is: a direct channel switched on, or a product, or a customer.
//
// A real database for the rule, lifted functions for the page. Every name is
// invented. No browser.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_hub_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}
function hebe(name) {
  const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
  assert.ok(m, name + '() not found in app.js');
  return m[1];
}

describe('order hub: is it in use', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('is not, on a fresh installation', () => {
    assert.equal(db.orderHubInUse(d), false);
    assert.equal(db.readAll(d).orderHub, false, '/api/data carries the answer');
  });

  it('is not, with Billbee switched on: Billbee is not a direct connection', () => {
    db.updateChannelConfig(d, 'billbee', { enabled: true });
    assert.equal(db.orderHubInUse(d), false);
  });

  it('is, once a direct channel is switched on, connected or not', () => {
    db.updateChannelConfig(d, 'etsy', { enabled: true });
    assert.equal(db.orderHubInUse(d), true);
    assert.equal(db.readAll(d).orderHub, true);
    db.updateChannelConfig(d, 'etsy', { enabled: false });
    assert.equal(db.orderHubInUse(d), false);
  });

  it('is, as long as a product exists, whatever the switches say', () => {
    const { db: d2, path: p2 } = tmpDb();
    try {
      db.upsertProduct(d2, { name: 'Beispielware', category: 'zubehoer', stock: 1, prodType: 'buy' });
      assert.equal(db.orderHubInUse(d2), true);
    } finally {
      d2.close();
      fs.unlinkSync(p2);
    }
  });

  it('is, as long as a customer exists', () => {
    const { db: d2, path: p2 } = tmpDb();
    try {
      db.upsertOrder(d2, {
        channel: 'manual',
        channelOrderId: '1001',
        customerEmail: 'erika@example.de',
        customerName: 'Erika Musterfrau',
        items: [{ title: 'Beispielware', qty: 1 }]
      });
      assert.equal(db.orderHubInUse(d2), true);
    } finally {
      d2.close();
      fs.unlinkSync(p2);
    }
  });

  it('only reads: it runs with every sync', () => {
    const src = db.orderHubInUse.toString();
    assert.doesNotMatch(src, /INSERT|UPDATE|DELETE|getChannelConfig|listChannelConfigs/);
  });
});

// The page against stand-ins: every element remembers its display and classes.
function seite({ inUse, offen, seiteOffen }) {
  const els = {};
  const el = (id, aktiv) => {
    const k = new Set(aktiv ? ['active'] : []);
    return (els[id] = {
      id,
      style: { display: id.endsWith('-mapping') || id.endsWith('-customers') ? 'none' : '' },
      classList: { add: (c) => k.add(c), remove: (c) => k.delete(c), contains: (c) => k.has(c) },
      aktiv: () => k.has('active')
    });
  };
  for (const pre of ['st', 'sp', 'sn']) {
    for (const sub of ['pack', 'inbox', 'mapping', 'customers']) el(pre + '-orders-' + sub, sub === offen);
  }
  el('p-orders', seiteOffen);
  const calls = [];
  const m = APP.match(/^const ORDER_HUB_TABS = .*;$/m);
  assert.ok(m, 'ORDER_HUB_TABS not found');
  new Function(
    'document',
    'orderHubInUse',
    'openStab',
    m[0] + '\n' + hebe('showOrderHubTabs') + '\nshowOrderHubTabs();'
  )(
    {
      getElementById: (id) => els[id] || null,
      querySelector: () => els['st-orders-' + offen] || null
    },
    inUse,
    (page, sub) => calls.push(page + '/' + sub)
  );
  return { els, calls };
}
const sichtbar = (els, sub) => [els['st-orders-' + sub].style.display, els['sn-orders-' + sub].style.display];

describe('Bestellungen: the two views of the order hub', () => {
  it('start hidden in the markup, so nothing flashes before the server has answered', () => {
    for (const sub of ['mapping', 'customers']) {
      assert.match(
        HTML,
        new RegExp('<button class="stab" id="st-orders-' + sub + '" style="display: none" data-i18n=')
      );
    }
  });

  it('are shown, tab and list entry together, when the order hub is in use', () => {
    const { els, calls } = seite({ inUse: true, offen: 'pack', seiteOffen: true });
    assert.deepEqual(sichtbar(els, 'mapping'), ['', '']);
    assert.deepEqual(sichtbar(els, 'customers'), ['', '']);
    assert.deepEqual(calls, []);
  });

  it('stay hidden, both of each pair, when it is not', () => {
    const { els } = seite({ inUse: false, offen: 'pack', seiteOffen: true });
    assert.deepEqual(sichtbar(els, 'mapping'), ['none', 'none']);
    assert.deepEqual(sichtbar(els, 'customers'), ['none', 'none']);
    assert.equal(els['st-orders-inbox'].style.display, '', 'the views in daily use are not touched');
  });

  it('send whoever stands on a hidden view to Packen, by its tab while the page is open', () => {
    const { calls } = seite({ inUse: false, offen: 'customers', seiteOffen: true });
    assert.deepEqual(calls, ['orders/pack']);
  });

  it('only move the mark while another page is open: the title up there is not theirs', () => {
    const { els, calls } = seite({ inUse: false, offen: 'mapping', seiteOffen: false });
    assert.deepEqual(calls, [], 'openStab() would write the title of Bestellungen over the open page');
    for (const pre of ['st', 'sp', 'sn']) {
      assert.equal(els[pre + '-orders-mapping'].aktiv(), false);
      assert.equal(els[pre + '-orders-pack'].aktiv(), true);
    }
  });

  it('leave a view that is in use alone', () => {
    const { els, calls } = seite({ inUse: true, offen: 'customers', seiteOffen: true });
    assert.deepEqual(calls, []);
    assert.equal(els['st-orders-customers'].aktiv(), true);
  });

  it('are decided with every answer of the server', () => {
    assert.match(hebe('applyData'), /orderHubInUse = !!d\.orderHub;\s*showOrderHubTabs\(\);/);
  });
});

describe('Eingang: no pointer to a view that is not there', () => {
  it('shows "noch zuzuordnen" only while the order hub is in use', () => {
    assert.match(APP, /banner\.style\.display = items\.length && orderHubInUse \? 'flex' : 'none';/);
  });

  it('marks an order with unmapped lines only then, too', () => {
    assert.match(APP, /\$\{o\.unmappedCount && orderHubInUse \? ` <span class="oh-warn"/);
  });
});
