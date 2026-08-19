'use strict';
// Group-by accumulators and the key "__proto__".
//
// Four reporting functions built a lookup with a plain `{}` and a key taken
// straight out of a row: contamination by species/zone/reason, the production
// pipeline by batch_type and culture type, MCP tasks by assignee, MCP harvests
// by batch/species/quality. The shape was always
//
//     if (!groups[key]) groups[key] = { count: 0, ... };
//     groups[key].count++;
//
// which works for every key except one. `groups['__proto__']` on a plain
// object is Object.prototype — truthy — so the initialiser is skipped and the
// ++ runs on the prototype. After that `({}).count` is NaN for every object
// created anywhere in the process, and pm2 keeps that process alive for weeks.
//
// Three of the four sites then threw a TypeError as well, so the MCP tool an
// admin's assistant called simply failed. getProductionPipeline was the quiet
// one: both branches only increment, so it corrupted Object.prototype.ready
// and Object.prototype.incubating without anything going wrong at the site.
//
// batch_type was the easiest key to plant — POST /api/batches validated
// batchId, species, qty, days and both dates, and let batch_type through with
// no check at all. It has one now, but the accumulators are the real fix: the
// value also arrives via restore and could arrive via a future writer.
//
// The rows below are inserted with raw SQL on purpose. The question is not how
// the value gets into the column — it is what the reporting code does once it
// is there.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_proto_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

// Every property these four sites would create on Object.prototype if the
// null-prototype accumulators were reverted.
const LEAKS = ['count', 'reasons', 'ready', 'incubating', 'totalGrams', 'byFlush', 'byQuality'];

function assertPrototypeClean(where) {
  for (const k of LEAKS) {
    assert.equal(k in {}, false, where + ': Object.prototype gained "' + k + '"');
  }
  // A number that arrived by inheritance rather than assignment is the tell.
  assert.equal(Object.prototype.count, undefined, where + ': Object.prototype.count is set');
}

describe('reporting accumulators survive a "__proto__" key', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    // getContaminationReport bails out early unless a contaminated zone exists.
    // openDb seeds a default set of zones, so only add one if it did not.
    if (!d.prepare("SELECT 1 FROM zones WHERE role='contaminated'").get()) {
      d.prepare('INSERT INTO zones(id,name,role,color,sort_order,created) VALUES(?,?,?,?,?,?)').run(
        'PROTO-CT',
        'Contaminated',
        'contaminated',
        '#c00',
        99,
        '2026-01-01T00:00:00Z'
      );
    }
    const scan = d.prepare(
      'INSERT INTO scan_log(time,action,batch,bag,"from","to",species,strain,reason) VALUES(?,?,?,?,?,?,?,?,?)'
    );
    // Hostile in the group key, and hostile again in the nested reason map.
    scan.run('2026-02-01T10:00:00Z', 'MOVE', 'B-1', 'B-1-01', 'INC', 'CONTAM', '__proto__', 'x', '__proto__');
    scan.run('2026-02-01T11:00:00Z', 'MOVE', 'B-1', 'B-1-02', 'INC', 'CONTAM', '__proto__', 'x', 'constructor');
    scan.run('2026-02-02T09:00:00Z', 'REMOVE', 'B-2', 'B-2-01', 'INC', 'CONTAM', 'Pleurotus', 'x', 'trichoderma');

    const batch = d.prepare(
      'INSERT INTO batches(batch_id,species,qty,days,batch_type,created,due) VALUES(?,?,?,?,?,?,?)'
    );
    batch.run('B-1', 'Pleurotus', 1, 21, '__proto__', '2026-01-01T00:00:00Z', '2026-01-22T00:00:00Z');
    batch.run('B-2', 'Pleurotus', 1, 21, 'block', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z');
    d.prepare('INSERT INTO cultures(id,type,status,created) VALUES(?,?,?,?)').run(
      'MC-1',
      '__proto__',
      '__proto__',
      '2026-01-01T00:00:00Z'
    );
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('getContaminationReport groups it instead of writing to Object.prototype', () => {
    const rep = db.getContaminationReport(d, 'species', null, null);
    assertPrototypeClean('getContaminationReport');
    // It is still counted — the fix is not "drop the row", it is "use a key
    // that has nowhere to leak to".
    assert.equal(rep.groups['__proto__'].count, 2);
    assert.equal(rep.groups['__proto__'].reasons['__proto__'], 1);
    assert.equal(rep.groups['__proto__'].reasons['constructor'], 1);
    assert.equal(rep.groups['Pleurotus'].count, 1);
    assert.equal(rep.totalContam, 3);
  });

  it('the report still serialises — a null prototype is not a JSON problem', () => {
    const rep = db.getContaminationReport(d, 'species', null, null);
    const round = JSON.parse(JSON.stringify(rep));
    assert.equal(round.groups['__proto__'].count, 2);
    assert.deepEqual(Object.keys(rep.groups).sort(), ['Pleurotus', '__proto__']);
  });

  it('getProductionPipeline keeps its own buckets — the silent one', () => {
    const pipe = db.getProductionPipeline(d);
    assertPrototypeClean('getProductionPipeline');
    // The three seeded kinds are untouched, and the hostile type got its own
    // bucket rather than incrementing the prototype.
    assert.equal(pipe.batches.block.incubating, 1);
    assert.equal(pipe.batches.grain.ready, 0);
    assert.equal(pipe.batches['__proto__'].ready, 1);
    assert.equal(pipe.cultures['__proto__']['__proto__'], 1);
    assert.equal(JSON.parse(JSON.stringify(pipe)).batches['__proto__'].ready, 1);
  });

  it('leaves no residue behind for the next caller', () => {
    db.getContaminationReport(d, 'zone', null, null);
    db.getContaminationReport(d, 'month', null, null);
    db.getProductionPipeline(d);
    assertPrototypeClean('after repeated calls');
    assert.deepEqual({ ...{} }, {});
  });
});

describe('the accumulators are declared with a null prototype', () => {
  // The MCP tool handlers are closures inside registerTools() and cannot be
  // reached from a test, so those two sites are pinned in the source. A `{}`
  // that comes back is the bug coming back.
  const MCP = fs.readFileSync(path.join(ROOT, 'mcp-server.js'), 'utf8');
  const DB = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');

  const cases = [
    [MCP, 'mcp-server.js', 'const tasksByAssignee = '],
    [MCP, 'mcp-server.js', 'const qualityDist = '],
    [DB, 'db.js', 'const cultureSummary = '],
    [DB, 'db.js', 'const zoneCounts = ']
  ];
  for (const [src, file, decl] of cases) {
    it(file + ': ' + decl.trim(), () => {
      const line = src.split('\n').find((l) => l.includes(decl));
      assert.ok(line, decl + ' is gone from ' + file);
      assert.match(line, /Object\.create\(null\)/, decl.trim() + ' is back to a plain object literal');
    });
  }

  it('mcp-server.js: the harvest-summary groups and their sub-maps', () => {
    const m = MCP.match(/if \(!groups\[key\]\)\s*\n?\s*groups\[key\] = \{[^}]*\};/);
    assert.ok(m, 'the harvest-summary accumulator has moved');
    assert.equal((m[0].match(/Object\.create\(null\)/g) || []).length, 2, 'byFlush and byQuality both need it');
  });
});

describe('POST /api/batches pins batch_type', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const validateEnum = new Function(
    SRC.match(/function validateEnum\(value, allowed, fieldName\) \{[\s\S]*?\n\}/)[0] + '\nreturn validateEnum;'
  )();
  const types = JSON.parse(SRC.match(/const BATCH_TYPES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));

  it('accepts the kinds the app knows, and an omitted value', () => {
    for (const t of ['block', 'grain', 'liquid', undefined, null]) {
      assert.equal(validateEnum(t, types, 'batchType'), null);
    }
  });

  it('rejects "__proto__" and anything else', () => {
    for (const t of ['__proto__', 'constructor', 'prototype', 'blocks', '']) {
      assert.match(validateEnum(t, types, 'batchType') || '', /batchType must be one of/);
    }
  });

  it('is wired into the batch route', () => {
    assert.match(SRC, /validateEnum\(data\.batchType, BATCH_TYPES, 'batchType'\)/);
  });
});
