'use strict';
// scripts/seed-substrate-recipes.js writes recipe figures onto the Sorten. The
// figures are a farm's own, so they come from a file the operator names on the
// command line, and the repository carries only an example with invented values.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const db = require('../db.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'seed-substrate-recipes.js');
const EXAMPLE = path.join(__dirname, '..', 'scripts', 'seed-substrate-recipes.example.json');

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

describe('seed-substrate-recipes', () => {
  let dir, dbFile;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_seed_'));
    dbFile = path.join(dir, 'seed.db');
    const d = db.openDb(dbFile);
    db.createMushroomStrain(d, { name: 'Blue Oyster', kuerzel: 'BO' });
    db.createMushroomStrain(d, { name: 'King Oyster', kuerzel: 'KO' });
    d.close();
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const strain = (kuerzel) => {
    const d = db.openDb(dbFile);
    try {
      return d.prepare('SELECT * FROM mushroom_strains WHERE kuerzel=?').get(kuerzel);
    } finally {
      d.close();
    }
  };

  const badFile = (name, cfg) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(cfg));
    return file;
  };

  it('keeps no figures of its own', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    assert.doesNotMatch(src, /\b(bran|corn|gyp|moist)['"]?\s*:\s*\d/, 'recipe figures belong in the named file');
    assert.doesNotMatch(src, /\b(BLOCK_KG|SPAWN_PCT)\s*=\s*\d/);
  });

  it('refuses to run without a recipe file', () => {
    const r = run(['--db', dbFile]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage/);
  });

  it('shows what the file would change and writes nothing', () => {
    const before = strain('BO').rec_rh_pct;
    const r = run([EXAMPLE, '--db', dbFile]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /would change/);
    assert.match(r.stdout, /PO\s+no such Sorte/);
    assert.equal(strain('BO').rec_rh_pct, before);
  });

  it('writes the figures from the file with --write, and then has nothing left to do', () => {
    const ex = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
    const r = run([EXAMPLE, '--write', '--db', dbFile]);
    assert.equal(r.status, 0, r.stderr);
    const oyster = ex.recipes[ex.byKuerzel.BO];
    const bo = strain('BO');
    assert.equal(bo.rec_wheatbran_pct, oyster.bran);
    assert.equal(bo.rec_hardwood_pct, 100 - oyster.bran - oyster.corn, 'pellets are the remainder');
    assert.equal(bo.rec_rh_pct, oyster.moist);
    assert.equal(bo.rec_bag_kg, ex.blockKg);
    assert.equal(bo.rec_spawn_pct, ex.spawnPct);
    assert.equal(bo.rec_colon_text, oyster.colon);
    assert.equal(strain('KO').rec_corn_pct, ex.recipes[ex.byKuerzel.KO].corn);
    assert.match(run([EXAMPLE, '--db', dbFile]).stdout, /Nothing to change/);
  });

  it('refuses a file that points a Sorte at a recipe it does not define', () => {
    const file = badFile('unknown-recipe.json', {
      blockKg: 4,
      spawnPct: 6,
      recipes: { a: { bran: 10, corn: 0, gyp: 1, moist: 60 } },
      byKuerzel: { BO: 'b' }
    });
    const r = run([file, '--db', dbFile]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /byKuerzel\.BO/);
  });

  it('refuses a blend that leaves no room for pellets', () => {
    const file = badFile('no-pellets.json', {
      blockKg: 4,
      spawnPct: 6,
      recipes: { a: { bran: 80, corn: 30, gyp: 1, moist: 60 } },
      byKuerzel: { BO: 'a' }
    });
    const r = run([file, '--db', dbFile]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no room for pellets/);
  });
});
