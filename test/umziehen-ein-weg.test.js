'use strict';
// Umziehen: a whole Charge is moved one way.
//
// The tile "Umziehen" on the start page lists the Chargen that stand somewhere.
// After one was picked, the flow had a step of its own for where to: a list of
// rooms and nothing else, then "Buchen", then a receipt, and no way back.
// "Umziehen" on a Charge in the list did the same job with the shared picker:
// rooms and racks, the places used last, one tap, and "Rückgängig" in the
// message. Two ways to move the same Charge, and the tile had the weaker one.
//
// The tile keeps its list and hands over to the shared picker, the way it
// already hands a contamination over to its dialog.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function hebe(name) {
  const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
  assert.ok(m, name + '() not found in app.js');
  return m[1];
}

describe('Umziehen from the tile', () => {
  function waehle(kind) {
    const calls = [];
    const WKF = { kind, step: 'pick', batchId: null, grams: {}, flushOverride: null, releaseAll: false };
    new Function(
      'WKF',
      'wkfClose',
      'openMoveBatchModal',
      'openContamReport',
      'wkfRender',
      hebe('wkfPickBatch') + '\nwkfPickBatch("T-TEST-1");'
    )(
      WKF,
      () => calls.push('close'),
      (id) => calls.push('picker ' + id),
      (a, id) => calls.push('contam ' + id),
      () => calls.push('render ' + WKF.step)
    );
    return calls;
  }

  it('closes the flow and opens the shared picker for the Charge', () => {
    assert.deepEqual(waehle('move'), ['close', 'picker T-TEST-1']);
  });

  it('leaves the other two jobs of the flow as they were', () => {
    assert.deepEqual(waehle('contam'), ['close', 'contam T-TEST-1']);
    assert.deepEqual(waehle('harvest'), ['render detail']);
  });

  it('has no destination step of its own left', () => {
    for (const name of ['wkfRenderMove', 'wkfBookMove']) {
      assert.equal(
        new RegExp('(?<![\\w$])' + name + '(?![\\w$])').test(APP),
        false,
        `${name} is still named in app.js`
      );
    }
    assert.doesNotMatch(APP, /book-move|WKF\.dest\b/);
    assert.doesNotMatch(CSS, /\.wkf-zone\b|\.wkf-zones\b/);
  });

  it('draws only the harvest as a second step', () => {
    assert.match(hebe('wkfRender'), /if \(WKF\.step === 'detail'\) return wkfRenderHarvest\(\);/);
  });

  it('says two steps on the way, not three', () => {
    const chips = hebe('wkfStepChips');
    assert.match(chips, /WKF\.kind === 'move'\s*\? \[t\('work\.stepBatch'\), t\('work\.stepTarget'\)\]/);
  });

  it('ends in the picker that offers the way back', () => {
    const m = hebe('openMoveBatchModal');
    assert.match(m, /_openZonePicker\(/);
    assert.match(m, /showUndoBar\(/);
  });
});
