'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db.js');

const DATA_FILE = path.join(__dirname, 'data.json');
const DB_FILE = path.join(__dirname, 'meistertracker.db');

// ── Read source data ─────────────────────────────────────────
if (!fs.existsSync(DATA_FILE)) {
  console.error('  ERROR: data.json not found at ' + DATA_FILE);
  process.exit(1);
}

const raw = fs.readFileSync(DATA_FILE, 'utf8');
const data = JSON.parse(raw);

console.log('');
console.log('  Meisterpilze JSON → SQLite Migration');
console.log('  ─────────────────────────────────────');
console.log('');
console.log('  Source: ' + DATA_FILE);
console.log('  Target: ' + DB_FILE);
console.log('');

// ── Source stats ─────────────────────────────────────────────
const srcBatches = (data.batches || []).length;
const srcBags = (data.batches || []).reduce((n, b) => n + (b.bags || []).length, 0);
const srcScanLog = (data.scanLog || []).length;
const srcHarvests = (data.harvests || []).length;
const srcCultures = (data.cultures || []).length;
const srcTasks = (data.manualTasks || []).length;
const srcMembers = (data.teamMembers || []).length;
const srcInvLog = (data.inventory && data.inventory.log || []).length;

console.log('  Source data.json:');
console.log('    Batches:        ' + srcBatches);
console.log('    Bags:           ' + srcBags);
console.log('    Scan log:       ' + srcScanLog);
console.log('    Harvests:       ' + srcHarvests);
console.log('    Cultures:       ' + srcCultures);
console.log('    Tasks:          ' + srcTasks);
console.log('    Team members:   ' + srcMembers);
console.log('    Inventory log:  ' + srcInvLog);
console.log('');

// ── Remove existing DB if re-running ─────────────────────────
if (fs.existsSync(DB_FILE)) {
  fs.unlinkSync(DB_FILE);
  console.log('  Removed existing ' + path.basename(DB_FILE));
}
const walFile = DB_FILE + '-wal';
const shmFile = DB_FILE + '-shm';
if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);

// ── Create DB and import ─────────────────────────────────────
const database = db.openDb(DB_FILE);

try {
  db.importFromJson(database, data);
  console.log('  Import complete.');
  console.log('');

  // ── Verify round-trip ────────────────────────────────────────
  const result = db.readAll(database);

  let ok = true;
  function check(name, expected, actual) {
    if (expected !== actual) {
      console.error('  MISMATCH: ' + name + ' — expected ' + expected + ', got ' + actual);
      ok = false;
    } else {
      console.log('  ✓ ' + name + ': ' + actual);
    }
  }

  console.log('  Verification:');
  check('Batches', srcBatches, result.batches.length);
  check('Bags', srcBags, result.batches.reduce((n, b) => n + b.bags.length, 0));
  check('Scan log', srcScanLog, result.scanLog.length);
  check('Harvests', srcHarvests, result.harvests.length);
  check('Cultures', srcCultures, result.cultures.length);
  check('Tasks', srcTasks, result.manualTasks.length);
  check('Team members', srcMembers, result.teamMembers.length);
  check('Inventory log', srcInvLog, result.inventory.log.length);

  // Deep-compare a few key fields
  for (let i = 0; i < result.batches.length; i++) {
    const src = data.batches[i];
    const dst = result.batches[i];
    if (src.batchId !== dst.batchId) {
      console.error('  MISMATCH: batch[' + i + '].batchId — ' + src.batchId + ' vs ' + dst.batchId);
      ok = false;
    }
    if (src.bags.length !== dst.bags.length) {
      console.error('  MISMATCH: batch[' + i + '].bags.length — ' + src.bags.length + ' vs ' + dst.bags.length);
      ok = false;
    }
  }

  // Check inventory stock values
  if (data.inventory && data.inventory.stock) {
    const srcStock = data.inventory.stock;
    const dstStock = result.inventory.stock;
    for (const mat of ['hardwood', 'wheatbran', 'gypsum', 'grain']) {
      if (srcStock[mat] !== dstStock[mat]) {
        console.error('  MISMATCH: inventory.stock.' + mat + ' — ' + srcStock[mat] + ' vs ' + dstStock[mat]);
        ok = false;
      }
    }
  }

  // Check CalDAV config
  if (data.caldav) {
    if (data.caldav.caldavUsername !== result.caldav.caldavUsername) {
      console.error('  MISMATCH: caldav.caldavUsername');
      ok = false;
    }
    if (!!data.caldav.enabled !== result.caldav.enabled) {
      console.error('  MISMATCH: caldav.enabled');
      ok = false;
    }
  }

  console.log('');
  if (ok) {
    console.log('  Migration successful! All data verified.');
    console.log('  Database: ' + DB_FILE);
    console.log('  Original data.json preserved as backup.');
  } else {
    console.error('  MIGRATION FAILED — mismatches detected. Check output above.');
    fs.unlinkSync(DB_FILE);
    console.error('  Database file removed.');
    process.exit(1);
  }
} finally {
  database.close();
}
console.log('');
