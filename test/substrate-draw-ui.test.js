'use strict';
// The line that says how much of a mix a Charge will take.
//
// This is the one number the operator plans against: "20 bags × 5 kg = 100 kg
// out of the mix, 40 kg left". It is written by nbSubstrateNeed(), and the draw
// it describes is actually performed by createBatch() posting to
// /api/batches/from-substrate. Two functions, one figure — and they read the bag
// weight from different places the first time round: the quote took it from the
// Sorte's recipe (5 kg) while the submit took it from the form field (3 kg). The
// screen promised 100 kg and the mix lost 60, with nothing anywhere saying so.
//
// Same approach as harvest-pack-ui.test.js: app.js has no module boundary, so
// the test lifts the functions out of the source and runs them against a stub
// DOM. The browser is not under test; the arithmetic on the screen is.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// Named so a failure says which function moved, rather than "unexpected token".
const TEILE = [
  [/^function esc\(s\) \{[\s\S]*?\n\}/m, 'esc()'],
  [/^function parseDecimal\([\s\S]*?\n\}/m, 'parseDecimal()'],
  [/^function nbSubstrateNeed\(\) \{[\s\S]*?\n\}/m, 'nbSubstrateNeed()']
];

function lift() {
  const out = [];
  for (const [re, name] of TEILE) {
    const m = SRC.match(re);
    assert.ok(m, name + ' not found in app.js — the test needs updating with it');
    out.push(m[0]);
  }
  return out.join('\n');
}

function stubDom(fields) {
  const els = {};
  for (const [id, value] of Object.entries(fields)) els[id] = { value, innerHTML: '', style: {} };
  els['nb-substrate-info'] = els['nb-substrate-info'] || { value: '', innerHTML: '', style: {} };
  return {
    document: { getElementById: (id) => els[id] || null },
    els
  };
}

// Run the lifted source with everything it reaches for supplied as a stub.
function run(fields, sbList, strains) {
  const dom = stubDom(fields);
  const ctx = {
    document: dom.document,
    _sbList: sbList,
    mushroomStrains: strains,
    // The real t() interpolates {name} placeholders; keeping that here is what
    // lets the assertions read the numbers back out of the rendered line.
    t: (key, vars) =>
      key +
      '(' +
      Object.entries(vars || {})
        .map(([k, v]) => k + '=' + v)
        .join(',') +
      ')'
  };
  const fn = new Function('document', '_sbList', 'mushroomStrains', 't', lift() + '\nreturn nbSubstrateNeed();');
  fn(ctx.document, ctx._sbList, ctx.mushroomStrains, ctx.t);
  return dom.els['nb-substrate-info'].innerHTML;
}

const MIX = [
  {
    subId: 'SUB-01',
    remainingKg: 200,
    targetKg: 200,
    composition: { hardwoodPct: 80, wheatbranPct: 20, rhPct: 62 }
  }
];
const STRAINS = [{ id: 7, name: 'Blue Oyster', kuerzel: 'BO', recBagKg: 5, recSpawnPct: 5 }];

describe('the draw a Charge quotes against a mix', () => {
  it('takes the bag weight from the form, which is what gets submitted', () => {
    // The recipe says 5 kg, the form says 3 kg. The form wins, because the form
    // is what createBatch reads when it posts.
    const html = run(
      { 'nb-substrate-batch': 'SUB-01', 'nb-qty': '20', 'nb-weight': '3', 'nb-strain-sel': '7' },
      MIX,
      STRAINS
    );
    assert.match(html, /bagKg=3/, 'quoted the recipe weight instead of the form weight');
    assert.match(html, /need=60\.0/);
    assert.match(html, /left=140\.0/);
  });

  it('falls back to the recipe only when the form carries no weight', () => {
    const html = run(
      { 'nb-substrate-batch': 'SUB-01', 'nb-qty': '20', 'nb-weight': '', 'nb-strain-sel': '7' },
      MIX,
      STRAINS
    );
    assert.match(html, /bagKg=5/);
    assert.match(html, /need=100\.0/);
  });

  it('says how much spawn the bags will take, since the mix carries none', () => {
    const html = run(
      { 'nb-substrate-batch': 'SUB-01', 'nb-qty': '20', 'nb-weight': '5', 'nb-strain-sel': '7' },
      MIX,
      STRAINS
    );
    assert.match(html, /kg=5\.00/, '100 kg at a 5% spawn rate is 5 kg');
  });

  it('names the overdraw rather than showing a negative remainder', () => {
    const html = run(
      { 'nb-substrate-batch': 'SUB-01', 'nb-qty': '50', 'nb-weight': '5', 'nb-strain-sel': '7' },
      MIX,
      STRAINS
    );
    assert.match(html, /sub\.overdraw\(over=50\.0\)/);
    assert.doesNotMatch(html, /left=-/);
  });

  it('quotes the blend that was mixed, not the one the Sorte would use today', () => {
    const html = run(
      { 'nb-substrate-batch': 'SUB-01', 'nb-qty': '10', 'nb-weight': '5', 'nb-strain-sel': '7' },
      MIX,
      STRAINS
    );
    assert.match(html, /hw=80.*wb=20.*rh=62/);
  });
});
