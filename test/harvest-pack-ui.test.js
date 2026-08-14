'use strict';
// The pack-size boxes in Settings → Harvest feed.
//
// What this screen decides cannot be seen from the server, and the server is
// the only other place these sizes appear. Between them sits the part that goes
// wrong quietly: a stored size the ready-made ladder does not offer. Tick 400 g,
// save, come back — and if the render only drew its own ladder, the box would
// be gone and the next save would silently drop it. Nothing errors, nothing is
// red, and a shop starts offering sizes the farm does not pack.
//
// Same approach as harvest-release-ui.test.js: the functions live in app.js,
// which has no module boundary, so the test lifts them out of the source and
// runs them against a stub DOM. The browser is not the thing under test, the
// decisions are.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Named so a failure says which function moved, rather than "unexpected token".
const TEILE = [
  [/^function esc\(s\) \{[\s\S]*?\n\}/m, 'esc()'],
  [/^const HARVEST_PACK_LADDER = \[[^\]]*\];/m, 'HARVEST_PACK_LADDER'],
  [/^function packSizeLabel\(g\) \{[\s\S]*?\n\}/m, 'packSizeLabel()'],
  [/^function renderHarvestPackSizes\(chosen\) \{[\s\S]*?\n\}/m, 'renderHarvestPackSizes()'],
  [/^function harvestPackSizes\(\) \{[\s\S]*?\n\}/m, 'harvestPackSizes()'],
  [/^function addHarvestPackSize\(\) \{[\s\S]*?\n\}/m, 'addHarvestPackSize()']
];

/**
 * Lift the boxes out of app.js and make them callable.
 *
 * The stub keeps a real relationship between the two directions: what
 * `renderHarvestPackSizes()` writes as HTML is what `harvestPackSizes()` reads
 * back, parsed out of that same string. A stub where the two are independent
 * would pass while the page lost every tick.
 */
function laden() {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const code = TEILE.map(([re, was]) => {
    const m = src.match(re);
    assert.ok(m, 'could not find ' + was + ' in app.js — has it been renamed?');
    return m[0];
  }).join('\n\n');

  const log = { html: '', feld: { value: '' }, meldung: { textContent: '' } };
  const stub = `
    const t = (k) => k;
    const kasten = {
      set innerHTML(v) { log.html = v; },
      get innerHTML() { return log.html; }
    };
    // The checkboxes as the page would hand them back: one object per input in
    // the rendered HTML, in the order they appear.
    const document = {
      getElementById: (id) =>
        id === 'harvestfeed-packs' ? kasten
        : id === 'harvestfeed-pack-new' ? log.feld
        : id === 'harvestfeed-pack-msg' ? log.meldung
        : null,
      querySelectorAll: () =>
        [...log.html.matchAll(/<input type="checkbox" class="hf-pack" value="(\\d+)"[^>]*?(checked)?>/g)].map((m) => ({
          value: m[1],
          checked: !!m[2]
        }))
    };
  `;
  return new Function(
    'log',
    stub +
      '\n' +
      code +
      '\nreturn { log, renderHarvestPackSizes, harvestPackSizes, addHarvestPackSize, packSizeLabel };'
  )(log);
}

describe('pack sizes — the boxes', () => {
  let ui;
  beforeEach(() => {
    ui = laden();
  });

  it('ticks what is stored and leaves the rest of the ladder empty', () => {
    ui.renderHarvestPackSizes([250, 1000]);
    assert.deepEqual(ui.harvestPackSizes(), [250, 1000]);
    assert.match(ui.log.html, /value="500"(?![^>]*checked)/, '500 g is offered, not chosen');
  });

  it('keeps a stored size the ladder does not offer', () => {
    // The quiet one. A farm packing 400 g trays ticks it once; if the render
    // drew only its own ladder, the box would be missing on the next load and
    // the next save would drop the size without saying so.
    ui.renderHarvestPackSizes([400]);
    assert.deepEqual(ui.harvestPackSizes(), [400]);
    assert.match(ui.log.html, /value="400"[^>]*checked/);
  });

  it('reads back ascending, whatever order it was stored in', () => {
    // The order is what a shop shows, so it is not cosmetic.
    ui.renderHarvestPackSizes([1000, 250, 500]);
    assert.deepEqual(ui.harvestPackSizes(), [250, 500, 1000]);
  });

  it('adds a size and ticks it straight away', () => {
    ui.renderHarvestPackSizes([250]);
    ui.log.feld.value = '400';
    ui.addHarvestPackSize();
    assert.deepEqual(ui.harvestPackSizes(), [250, 400], 'and keeps what was already ticked');
    assert.equal(ui.log.feld.value, '', 'the field clears, so the next one is typed into an empty box');
    assert.equal(ui.log.meldung.textContent, '');
  });

  it('refuses a size that is not one, and changes nothing', () => {
    ui.renderHarvestPackSizes([250]);
    for (const bad of ['0', '5', '30000', 'x', '']) {
      ui.log.feld.value = bad;
      ui.addHarvestPackSize();
      assert.equal(ui.log.meldung.textContent, 'harvestFeed.packBad', bad + ' should be refused');
      assert.deepEqual(ui.harvestPackSizes(), [250]);
    }
  });

  it('says a size the way somebody would say it', () => {
    assert.equal(ui.packSizeLabel(250), '250 g');
    assert.equal(ui.packSizeLabel(1000), '1 kg');
    assert.equal(ui.packSizeLabel(1500), '1500 g', 'not "1.5 kg" — a comma in a label is a comma to mistype');
  });

  it('survives a stored list with nothing usable in it', () => {
    // getHarvestFeedCfg() is a split and not a check, so what arrives here is
    // whatever the column held. An empty ladder on screen would look like the
    // feature is broken rather than unset.
    ui.renderHarvestPackSizes([null, -5, 'x']);
    assert.deepEqual(ui.harvestPackSizes(), [], 'nothing ticked');
    assert.match(ui.log.html, /value="250"/, 'the ladder is still there to tick');
  });
});
