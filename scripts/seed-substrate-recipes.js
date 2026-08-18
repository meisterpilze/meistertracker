'use strict';
// Write a set of substrate recipes onto the Sorten that match them by Kuerzel.
//
// This used to be a migration, which was wrong twice over: another lab runs this
// code and their oyster recipe is not this one, and an operator who had already
// tuned rec_* had it overwritten on upgrade with no record of what it had been.
// So it is a script you run on purpose, it prints what it would change, and it
// writes nothing until told to.
//
//   node scripts/seed-substrate-recipes.js            # show what would change
//   node scripts/seed-substrate-recipes.js --write    # actually write it
//
// The figures below are invented examples. Edit them before running this — the
// whole point of the file is that they are visible and yours to change.
const path = require('path');
const db = require(path.join(__dirname, '..', 'db.js'));

// Per 100 kg dry mix. Block size and spawn rate are how a farm fills and
// inoculates, which is exactly the kind of thing another lab will want to change.
const BLOCK_KG = 4;
const SPAWN_PCT = 6;
const RECIPES = {
  oyster: { bran: 15, corn: 0, gyp: 1, moist: 60, colon: '14-18 d', steril: '3 h' },
  king: { bran: 15, corn: 0, gyp: 1, moist: 60, colon: '14-18 d', steril: '3 h' },
  lions: { bran: 15, corn: 0, gyp: 1, moist: 60, colon: '14-18 d', steril: '3 h' },
  chest: { bran: 15, corn: 0, gyp: 1, moist: 60, colon: '14-18 d', steril: '3 h' },
  pioppino: { bran: 15, corn: 0, gyp: 1, moist: 60, colon: '14-18 d', steril: '3 h' },
  shiitake: { bran: 16, corn: 4, gyp: 1, moist: 58, colon: '60 d', steril: '4 h' },
  maitake: { bran: 16, corn: 4, gyp: 1, moist: 58, colon: '60 d', steril: '4 h' }
};

// Species with no entry are left alone on purpose — a
// guess is worse than a blank, which the interface already handles.
const BY_KUERZEL = {
  BO: 'oyster',
  PO: 'oyster',
  YO: 'oyster',
  PEO: 'oyster',
  PHOE: 'oyster',
  KO: 'king',
  BPKO: 'king',
  LM: 'lions',
  CHUT: 'chest',
  PIOP: 'pioppino',
  SHIK: 'shiitake',
  MAIT: 'maitake'
};

function main() {
  const write = process.argv.includes('--write');
  const dbFile = path.join(__dirname, '..', 'meistertracker.db');
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
  for (const [kuerzel, key] of Object.entries(BY_KUERZEL)) {
    const r = RECIPES[key];
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
      upd.run(pellets, r.bran, r.corn, r.gyp, r.moist, SPAWN_PCT, BLOCK_KG, r.colon, r.steril, now, kuerzel);
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

main();
