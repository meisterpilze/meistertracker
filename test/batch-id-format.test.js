'use strict';
// The Kürzel at the front of a Chargen-ID.
//
// Every batch ID starts with the strain's Kürzel — BPKO-180826-01 — and the
// Admin migration tool exists to repair IDs that do not. Such IDs could appear
// because createBatch() had two ways of asking for an ID: the plain path handed
// abbrev() the strain name and got BPKO, while the path that portions out of a
// substrate mix handed it "Black Pearl King Oyster (BPKO)". That string matches
// no strain, so abbrev() fell back to the first four letters and the mix
// produced BLAC-180826-01. Two doors into the same room, one of them mislabeled.
//
// Same approach as substrate-draw-ui.test.js: app.js has no module boundary, so
// the test lifts the generator out of the source, reads the arguments createBatch
// actually passes it, and checks every call site lands on the Kürzel.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebe } = require('./helpers/quelle');

const SRC = quelle();

// Named so a failure says which function moved, rather than "unexpected token".
const TEILE = [
  [/^const abbrev = \([\s\S]*?\n\};/m, 'abbrev()'],
  [/^const todayStr = \([\s\S]*?\n\};/m, 'todayStr()'],
  [/^const genBatchId = \([\s\S]*?\n\};/m, 'genBatchId()']
];

const TEILE_SRC = hebe(TEILE, SRC);

const STRAINS = [
  { id: 1, name: 'Black Pearl King Oyster', kuerzel: 'BPKO' },
  { id: 2, name: 'Lions Mane', kuerzel: 'LION' }
];

// The day the batch was made. createBatch() hands it to both call sites as
// `wann`; for a batch entered during a stocktake it lies in the past, and the ID
// carries it, like the label on the bag. A fixed day makes that visible here.
const WANN = new Date(2026, 8, 3, 12, 0, 0);

function createBatchBody() {
  // `async` since its two material warnings became dialogs rather than
  // window.confirm() — optional here so this keeps matching either way.
  const m = SRC.match(/^(?:async )?function createBatch\(\) \{[\s\S]*?\n\}/m);
  assert.ok(m, 'createBatch() not found in app.js — the test needs updating with it');
  return m[0];
}

// Every genBatchId(...) inside createBatch(), evaluated with the locals
// createBatch() itself defines. Reading the argument out of the source rather
// than restating it is what makes this a test of the call sites.
function idsFromCallSites(ms) {
  const body = createBatchBody();
  const locals = (body.match(/^ {2}const sp = .*;$/m) || [''])[0];
  const args = [...body.matchAll(/genBatchId\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(args.length >= 2, 'expected createBatch() to generate an ID on both the plain and the substrate path');
  return args.map((arg) => ({
    arg,
    id: new Function(
      'ms',
      'mushroomStrains',
      'batches',
      'wann',
      TEILE_SRC + '\n' + locals + '\nreturn genBatchId(' + arg + ');'
    )(ms, STRAINS, [], WANN)
  }));
}

describe('batch ID prefix', () => {
  it('gives the strain Kürzel, whatever createBatch() passes in', () => {
    const ms = STRAINS[0];
    for (const { arg, id } of idsFromCallSites(ms)) {
      assert.ok(
        id.startsWith(ms.kuerzel + '-'),
        'genBatchId(' + arg + ') produced ' + id + ' — expected it to start with ' + ms.kuerzel
      );
    }
  });

  it('agrees across call sites, so a mix and a fresh block share the format', () => {
    const ids = idsFromCallSites(STRAINS[1]).map((c) => c.id);
    assert.equal(new Set(ids).size, 1, 'call sites disagree: ' + ids.join(' vs '));
  });

  it('still falls back to four letters for a species with no strain entry', () => {
    const genBatchId = new Function('mushroomStrains', 'batches', TEILE_SRC + '\nreturn genBatchId;')(STRAINS, []);
    assert.match(genBatchId('Enoki'), /^ENOK-\d{6}-01$/);
    assert.match(genBatchId('Reishi'), /^REIS-\d{6}-01$/);
  });

  it('carries the day the batch was made, on every call site', () => {
    for (const { arg, id } of idsFromCallSites(STRAINS[0])) {
      assert.equal(id, 'BPKO-030926-01', 'genBatchId(' + arg + ') ignores the day createBatch() passes it');
    }
  });

  it('numbers after the highest number of that day, not after the count', () => {
    // A stocktake enters batches on days that already have some — and on a day
    // one of them was deleted, the count hands out an ID that still exists.
    const vorhanden = [{ batchId: 'LION-030926-01' }, { batchId: 'LION-030926-03' }, { batchId: 'LION-040926-07' }];
    const genBatchId = new Function('mushroomStrains', 'batches', TEILE_SRC + '\nreturn genBatchId;')(
      STRAINS,
      vorhanden
    );
    assert.equal(genBatchId('Lions Mane', WANN), 'LION-030926-04');
    assert.equal(genBatchId('Lions Mane', new Date(2026, 8, 5, 12)), 'LION-050926-01');
  });
});
