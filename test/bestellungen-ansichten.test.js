'use strict';
// Bestellungen: the views that are left.
//
// "Was muss ich machen" listed, per product, what open orders ask for beyond
// the stock, with the raw materials behind it. It read the product table that
// Produkt-Zuordnung fills, through the orders of the direct shop connections.
// An installation that takes its orders in through Billbee has neither, so the
// view said "nothing to produce" for as long as it existed, next to a Packen
// board that did have things to make.
//
// What has to be made is on the Bedarf page (test/bedarf.test.js). The view is
// gone. The calculation behind it (db.computeProductionDemand) and its route
// stay: they belong to the order hub and have tests of their own.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const von = HTML.indexOf('<div class="page" id="p-orders"');
const SEITE = HTML.slice(von, HTML.indexOf('<div class="page" id="p-', von + 1));

describe('Bestellungen: its views', () => {
  it('has five, without "Was muss ich machen"', () => {
    const reiter = [...SEITE.matchAll(/<button[^>]*class="stab[^"]*"[^>]*id="(st-orders-[a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(reiter, [
      'st-orders-pack',
      'st-orders-inbox',
      'st-orders-mapping',
      'st-orders-customers',
      'st-orders-versand'
    ]);
  });

  it('has a panel for every view and none left over', () => {
    const panels = [...SEITE.matchAll(/<div class="sp[^"]*" id="(sp-orders-[a-z]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(panels, [
      'sp-orders-customers',
      'sp-orders-inbox',
      'sp-orders-mapping',
      'sp-orders-pack',
      'sp-orders-versand'
    ]);
  });

  it('has nothing in app.js that draws or wires the removed view', () => {
    assert.doesNotMatch(APP, /renderOrdersDemand|orders-tomake|'tomake'|demand-body/);
  });

  it('redraws a view that exists, whichever is open', () => {
    const m = APP.match(/\nfunction _refreshOrdersActive\(\) \{[\s\S]*?\n\}/);
    assert.ok(m, '_refreshOrdersActive() not found');
    for (const id of m[0].match(/sp-orders-[a-z]+/g)) {
      assert.ok(SEITE.includes('id="' + id + '"'), `${id} is redrawn but not in the markup`);
    }
  });

  it('leaves the calculation and its route to the order hub', () => {
    assert.match(SERVER, /url === '\/api\/orders\/demand'/);
  });
});
