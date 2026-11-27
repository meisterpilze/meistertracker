'use strict';
// Lager: three views.
//
// The page had five tabs, and two of them were not views of anything:
//   - "+ Lieferung erfassen" records something. A tab that looks like its
//     neighbours and does something else is the case "Neue Charge" and
//     "Laborarbeit" were moved out of their strips for. It is now a lead button
//     on Rohstoffe, where the raw materials are that a delivery adds to.
//   - "Lieferanten" is a short list that is read when a raw material runs low
//     and changed rarely. It stands under the raw materials.
//
// Left are Verkaufsregal, Rohstoffe and Verbrauchsprotokoll. The delivery form
// is a lead panel (data-stab-lead), found by the search, and carries its own
// way back, since no tab leads to it. Text and lifted functions, no browser.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function hebe(name) {
  const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
  assert.ok(m, name + '() not found in app.js');
  return m[1];
}
const von = HTML.indexOf('<div class="page" id="p-inv"');
const SEITE = HTML.slice(von, HTML.indexOf('<div class="page" id="p-', von + 1));
const panel = (id) => {
  const a = SEITE.indexOf('<div class="sp' + (id === 'shelf' ? ' active' : '') + '" id="sp-inv-' + id + '"');
  assert.ok(a >= 0, 'no panel sp-inv-' + id);
  const b = SEITE.indexOf('<div class="sp', a + 1);
  return SEITE.slice(a, b < 0 ? undefined : b);
};

describe('Lager: its views', () => {
  it('has three tabs', () => {
    const reiter = [...SEITE.matchAll(/<button[^>]*class="stab[^"]*"[^>]*id="(st-inv-[a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(reiter, ['st-inv-shelf', 'st-inv-stock', 'st-inv-log']);
  });

  it('has a panel for each, and the delivery form as a lead panel', () => {
    const panels = [...SEITE.matchAll(/<div class="sp[^"]*" id="(sp-inv-[a-z]+)"([^>]*)>/g)].map((m) => [
      m[1],
      m[2].trim()
    ]);
    assert.deepEqual(panels, [
      ['sp-inv-shelf', ''],
      ['sp-inv-stock', ''],
      ['sp-inv-delivery', 'data-stab-lead="inv.logDelivery"'],
      ['sp-inv-log', '']
    ]);
  });

  it('has nothing left of the two tabs in app.js', () => {
    assert.doesNotMatch(APP, /st-inv-delivery|st-inv-suppliers|openStab\('inv', ?'suppliers'\)/);
  });
});

describe('Lager: recording a delivery', () => {
  it('starts from a lead button on Rohstoffe, not from a tab', () => {
    assert.match(
      panel('stock'),
      /<button type="button" class="btn btn-p btn-lead" id="btn-inv-delivery" data-i18n="inv\.logDelivery">/
    );
    assert.ok(APP.includes("$('btn-inv-delivery').addEventListener('click', () => openStab('inv', 'delivery'));"));
  });

  it('is first on Rohstoffe: what the view is opened to do stands above what is read', () => {
    const p = panel('stock');
    assert.ok(p.indexOf('id="btn-inv-delivery"') < p.indexOf('id="inv-cards"'));
  });

  it('opens a panel a phone may land on although no tab stands for it', () => {
    const landable = new Function(hebe('stabLandable') + '\nreturn stabLandable;')();
    assert.equal(landable(null, { dataset: { stabLead: 'inv.logDelivery' } }), true);
    assert.equal(landable(null, { dataset: {} }), false, 'premise: without the mark it would not');
  });

  it('has its own way back, since no tab leads there', () => {
    assert.match(
      panel('delivery'),
      /<button type="button" class="btn btn-sm inv-back" id="btn-inv-delivery-back" data-i18n="inv\.backToStock">/
    );
    assert.ok(APP.includes("$('btn-inv-delivery-back').addEventListener('click', () => openStab('inv', 'stock'));"));
  });

  it('still fills its form when it opens', () => {
    assert.match(
      hebe('openStab'),
      /if \(page === 'inv' && sub === 'delivery'\) \{\s*delMatChange\(\);\s*adjMatChange\(\);/
    );
  });

  it('is found by the search through its button', () => {
    // gsIndex lists every .sp[data-stab-lead] of a page under the page's .btn-lead.
    assert.match(APP, /const lead = strip\.parentElement\.querySelector\('\.btn-lead'\);/);
    assert.equal((SEITE.match(/class="[^"]*\bbtn-lead\b/g) || []).length, 1, 'one lead button on the page');
  });

  it('is a button of its own size, not one as wide as the row', () => {
    for (const cls of ['btn-lead', 'inv-back']) {
      const rule = CSS.match(new RegExp('\\n\\.' + cls + ' \\{([^}]*)\\}'));
      assert.ok(rule, '.' + cls + ' has no rule');
      assert.doesNotMatch(rule[1], /width:\s*100%|display:\s*block/);
    }
  });
});

describe('Lager: the suppliers', () => {
  it('stand under the raw materials', () => {
    const p = panel('stock');
    assert.ok(p.includes('id="suppliers-list"'), 'the list is not on Rohstoffe');
    assert.ok(p.indexOf('id="inv-thresholds"') < p.indexOf('id="suppliers-list"'), 'under, not above');
    assert.match(p, /onclick="editSupplier\(\)" data-i18n="inv\.addSupplier"/);
  });

  it('are drawn whenever Rohstoffe is: by its tab, on arrival and on a sync', () => {
    assert.match(
      hebe('openStab'),
      /if \(page === 'inv' && sub === 'stock'\) \{\s*renderInvStock\(\);\s*renderSuppliers\(\);/
    );
    assert.match(hebe('go'), /if \(page === 'inv'\) \{\s*renderInvStock\(\);\s*renderSuppliers\(\);/);
    assert.match(hebe('refresh'), /if \(id === 'inv'\) \{\s*renderInvStock\(\);\s*renderSuppliers\(\);/);
  });
});
