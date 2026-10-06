'use strict';
// Write a set of substrate recipes onto the Sorten that match them by Kuerzel.
//
// This used to be a migration, which was wrong twice over: another lab runs this
// code and their oyster recipe is not this one, and an operator who had already
// tuned rec_* had it overwritten on upgrade with no record of what it had been.
// So it is a script you run on purpose, it prints what it would change, and it
// writes nothing until told to.
//
// The figures themselves are a farm's own and are not kept in this repository.
// They come from a JSON file named on the command line;
// scripts/seed-substrate-recipes.example.json shows the shape with invented
// values.
//
//   node scripts/seed-substrate-recipes.js <recipes.json>              # show what would change
//   node scripts/seed-substrate-recipes.js <recipes.json> --write      # actually write it
//   node scripts/seed-substrate-recipes.js <recipes.json> --db <file>  # another database
//
// In the file, every recipe is per 100 kg of dry mix: bran, corn and gypsum in
// percent, moist as the hydration target in percent, colon and steril as the
// free text the Sorte shows. Hardwood pellets are whatever bran and corn leave
// over. blockKg and spawnPct apply to every Sorte the file names, and byKuerzel
// says which Sorte gets which recipe.
const fs = require('fs');
const path = require('path');
const db = require(path.join(__dirname, '..', 'db.js'));

const USAGE = 'Usage: node scripts/seed-substrate-recipes.js <recipes.json> [--write] [--db <file>]';

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

function isPct(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
}

// Refuse a file that would write nonsense, before anything is opened. Every
// message names the recipe or Kuerzel at fault, so the fix is one look away.
function readRecipes(file) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail('Cannot read ' + file + ': ' + e.message);
  }
  if (!cfg || typeof cfg !== 'object') fail(file + ' does not hold a JSON object');
  const { blockKg, spawnPct, recipes, byKuerzel } = cfg;
  if (!(typeof blockKg === 'number' && blockKg > 0)) fail('blockKg must be a number above 0');
  if (!isPct(spawnPct)) fail('spawnPct must be a percentage');
  if (!recipes || typeof recipes !== 'object' || !Object.keys(recipes).length)
    fail('recipes must name at least one recipe');
  for (const [key, r] of Object.entries(recipes)) {
    for (const f of ['bran', 'corn', 'gyp']) {
      if (!isPct(r[f])) fail('recipes.' + key + '.' + f + ' must be a percentage');
    }
    if (!(isPct(r.moist) && r.moist > 0 && r.moist < 100)) fail('recipes.' + key + '.moist must lie between 0 and 100');
    if (r.bran + r.corn > 100) fail('recipes.' + key + ': bran and corn leave no room for pellets');
    for (const f of ['colon', 'steril']) {
      if (r[f] != null && typeof r[f] !== 'string') fail('recipes.' + key + '.' + f + ' must be text');
    }
  }
  if (!byKuerzel || typeof byKuerzel !== 'object' || !Object.keys(byKuerzel).length)
    fail('byKuerzel must name at least one Sorte');
  for (const [kuerzel, key] of Object.entries(byKuerzel)) {
    if (!recipes[key]) fail('byKuerzel.' + kuerzel + ' points at no recipe: ' + key);
  }
  return { blockKg, spawnPct, recipes, byKuerzel };
}

function main(argv) {
  const write = argv.includes('--write');
  const dbAt = argv.indexOf('--db');
  if (dbAt >= 0 && !argv[dbAt + 1]) fail('--db needs a file\n' + USAGE);
  const dbFile = dbAt >= 0 ? argv[dbAt + 1] : path.join(__dirname, '..', 'meistertracker.db');
  const file = argv.find((a, i) => !a.startsWith('--') && !(dbAt >= 0 && i === dbAt + 1));
  if (!file) fail(USAGE);
  const { blockKg, spawnPct, recipes, byKuerzel } = readRecipes(file);

  const d = db.openDb(dbFile);
  const upd = d.prepare(
    `UPDATE mushroom_strains SET rec_batch_type='block', rec_substrate='holzkleie',
       rec_hardwood_pct=?, rec_wheatbran_pct=?, rec_corn_pct=?, rec_gypsum_pct=?, rec_gypsum=1,
       rec_rh_pct=?, rec_spawn_pct=?, rec_bag_kg=?, rec_colon_text=?, rec_steril_text=?, updated=?
     WHERE kuerzel=?`
  );
  const now = new Date().toISOString();
  let changed = 0;
  let missing = 0;
  for (const [kuerzel, key] of Object.entries(byKuerzel)) {
    const r = recipes[key];
    const cur = d
      .prepare(
        'SELECT name, rec_hardwood_pct h, rec_wheatbran_pct w, rec_corn_pct c, rec_rh_pct rh FROM mushroom_strains WHERE kuerzel=?'
      )
      .get(kuerzel);
    if (!cur) {
      console.log('  ' + kuerzel.padEnd(6) + 'no such Sorte — skipped');
      missing++;
      continue;
    }
    // Pellets are the remainder, never stored separately, so the three shares
    // cannot drift into a blend that does not total 100%.
    const pellets = 100 - r.bran - r.corn;
    // Corn has to be in the comparison or a corn blend reads as changed on every run.
    const before = cur.h + '/' + cur.w + (cur.c ? '/' + cur.c : '') + ' @ ' + cur.rh + '%';
    const after = pellets + '/' + r.bran + (r.corn ? '/' + r.corn : '') + ' @ ' + r.moist + '%';
    if (before === after) {
      console.log('  ' + kuerzel.padEnd(6) + cur.name.padEnd(26) + 'already ' + after);
      continue;
    }
    console.log('  ' + kuerzel.padEnd(6) + cur.name.padEnd(26) + before + '  ->  ' + after);
    changed++;
    if (write) {
      upd.run(pellets, r.bran, r.corn, r.gyp, r.moist, spawnPct, blockKg, r.colon || '', r.steril || '', now, kuerzel);
    }
  }
  console.log('');
  if (!changed) {
    console.log('Nothing to change.');
  } else if (write) {
    console.log(changed + ' recipe(s) written.' + (missing ? ' ' + missing + ' Sorte(n) not found.' : ''));
  } else {
    console.log(changed + ' recipe(s) would change. Re-run with --write to apply.');
  }
  d.close();
}

main(process.argv.slice(2));
