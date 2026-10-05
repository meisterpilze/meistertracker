'use strict';

// ── Try the new code against this machine's real data, before swapping it in ──
//
// Some things cannot be tested anywhere but here. A migration is correct
// against the fixtures in test/ and still wrong against six months of this
// farm's actual rows; a module loads on a laptop and throws on a server with a
// different Node build. The usual answer is to deploy and watch, which means the
// first thing that finds out is production.
//
// This finds out instead, and it finds out on a copy. `VACUUM INTO` from a
// read-only handle gives a consistent snapshot of the live database without
// writing a byte to it, and everything below happens to the snapshot: the
// pending migrations run there, the row counts are compared there, the modules
// are loaded pointing at it. If any of that fails, the running server has not
// been touched — it is still serving, on the old code, and the deploy simply
// does not proceed.
//
// It is not a proof that the new version is correct. It is a proof that the
// specific ways a deploy usually dies — a migration that throws halfway, a
// module that will not load, a schema change that loses rows — are not going to
// happen to you today.
//
// Usage:
//   node scripts/preflight.js [--db <path>] [--quiet]
//
// Exit codes: 0 safe to proceed, 1 do not deploy, 2 could not check.
//
// The webhook deploy (scripts/deploy-chain.js) calls this as
// `node scripts/preflight.js --quiet --db <path>`, and it is the running
// version's chain that calls the version just pulled. Keep both flags and the
// meaning of exit 0 working: a version that broke them would have every
// webhook deploy after it refused, until someone updated by hand.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const DIR = path.join(__dirname, '..');

// Every module server.js pulls in at load time. Loading them is what catches a
// syntax error or a bad top-level require in the new version — the failure that
// otherwise shows up as pm2 restarting in a loop.
//
// server.js itself is deliberately absent: requiring it binds ports and starts
// timers. It gets a syntax check instead.
const MODULES = [
  'db.js',
  'duckdns.js',
  'channels.js',
  'shipping.js',
  'harvest-feed.js',
  'mcp-server.js',
  // The backups. A stick backup that fails to load takes the server down with
  // it, at start-up, which is exactly when an update has just changed it.
  'scripts/backup-crypto.js',
  'scripts/atomic-file.js',
  'scripts/photo-mirror.js',
  'scripts/usb-stick.js',
  'scripts/usb-backup.js',
  // The same holds for every other script server.js requires at the top level.
  // deploy-chain.js matters most: a version that cannot load it is a server
  // that cannot start, and the webhook that would deliver the fix lives in it.
  // test/preflight.test.js reads server.js and fails when one is missing here.
  'scripts/photo-cap.js',
  'scripts/jpeg-location.js',
  'scripts/deploy-chain.js',
  'scripts/deploy-runner.js',
  'scripts/rotate-backups.js',
  // The lab history's daily timestamp, and the RFC 3161 code it uses.
  'scripts/lab-timestamps.js',
  'scripts/rfc3161.js',
  // The lab book archive, and the ZIP writer under it.
  'scripts/lab-archive.js',
  'scripts/zip-store.js'
];

/**
 * A consistent copy of the live database, made without writing to it.
 *
 * `readOnly`, camelCase. node:sqlite ignores an option name it does not know,
 * so the `readonly` this used to pass opened a read-write handle, and nothing
 * said so.
 *
 * While the server is up the difference does not show: VACUUM INTO only reads,
 * and a second handle closing does not checkpoint. It shows after a crash, with
 * the server down and its last commits still in the -wal. A read-write handle
 * closing last checkpoints them into the database file, so the step promising
 * not to write was the one writing. A read-only handle leaves the file and the
 * -wal byte for byte as they were, for the server to recover when it starts.
 *
 * Read-only does not cost the crash case its snapshot. The WAL index is rebuilt
 * in the -shm, which SQLite opens read-write even under a read-only handle.
 * Measured against a killed writer with its -shm left as it was, deleted,
 * zeroed, and swapped for an older copy: every snapshot had every row. The one
 * setup where read-only could not open the file at all, no -shm and a directory
 * it may not write, refuses a read-write handle the same way. That is why there
 * is no fallback to one: there is nothing for it to catch.
 *
 * What it does leave behind, on a cleanly closed database, is an empty -wal and
 * a -shm. The server removes both at its next clean shutdown.
 */
function snapshot(liveDb, destPath) {
  const ro = new DatabaseSync(liveDb, { readOnly: true });
  try {
    ro.exec('VACUUM INTO ' + quoteSqlPath(destPath));
  } finally {
    ro.close();
  }
}

function quoteSqlPath(p) {
  return "'" + String(p).replace(/'/g, "''") + "'";
}

/** Row counts for every table, so a migration that loses data cannot pass. */
function census(dbFile) {
  const conn = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const out = {};
    const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for (const t of tables) {
      out[t.name] = conn.prepare('SELECT COUNT(*) AS c FROM "' + t.name.replace(/"/g, '""') + '"').get().c;
    }
    return out;
  } finally {
    conn.close();
  }
}

/**
 * Tables that lost rows. An added table is fine, a dropped one is reported, and
 * a table that shrank is the thing this exists to refuse.
 */
function losses(before, after) {
  const bad = [];
  for (const [name, count] of Object.entries(before)) {
    if (!(name in after)) bad.push(name + ': table gone (had ' + count + ' rows)');
    else if (after[name] < count) bad.push(name + ': ' + count + ' rows before, ' + after[name] + ' after');
  }
  return bad;
}

function main(argv, opts) {
  const o = opts || {};
  const quiet = argv.includes('--quiet');
  const dbArg = argv.indexOf('--db');
  const liveDb = o.dbFile || (dbArg >= 0 ? argv[dbArg + 1] : path.join(DIR, 'meistertracker.db'));
  const dir = o.dir || DIR;
  const say = o.out || ((m) => process.stdout.write('  ' + m + '\n'));
  const warn = o.err || ((m) => process.stderr.write('  ' + m + '\n'));

  if (!fs.existsSync(liveDb)) {
    warn('no database at ' + liveDb + ' — nothing to check against.');
    return 2;
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-preflight-'));
  const copy = path.join(work, 'snapshot.db');
  const cleanup = () => {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* a leftover temp directory is not worth failing a deploy over */
    }
  };

  try {
    // 1. A copy of the real thing.
    try {
      snapshot(liveDb, copy);
    } catch (e) {
      warn('could not snapshot the database: ' + e.message);
      return 2;
    }
    const sizeMb = (fs.statSync(copy).size / 1e6).toFixed(1);
    if (!quiet) say('snapshot taken (' + sizeMb + ' MB), live database untouched');

    // 2. What is in it now.
    const before = census(copy);
    const beforeVersions = new DatabaseSync(copy, { readOnly: true });
    let priorVersion = 0;
    try {
      priorVersion = beforeVersions.prepare('SELECT MAX(version) AS v FROM schema_version').get().v || 0;
    } catch {
      /* a database old enough to have no schema_version is still checkable */
    } finally {
      beforeVersions.close();
    }

    // 3. The migrations, against real rows, where failing is free.
    const db = require(path.join(dir, 'db.js'));
    let handle;
    try {
      handle = db.openDb(copy);
    } catch (e) {
      warn('MIGRATION FAILED against your data: ' + e.message);
      warn('The running server has not been touched. Do not deploy.');
      return 1;
    }
    const newVersion = handle.prepare('SELECT MAX(version) AS v FROM schema_version').get().v || 0;
    handle.close();

    // 4. Did anything vanish?
    const after = census(copy);
    const lost = losses(before, after);
    if (lost.length) {
      warn('MIGRATION LOST DATA:');
      for (const l of lost) warn('  ' + l);
      warn('The running server has not been touched. Do not deploy.');
      return 1;
    }
    if (!quiet) {
      say(
        newVersion > priorVersion
          ? 'migrations v' + (priorVersion + 1) + '–v' + newVersion + ' applied cleanly, no rows lost'
          : 'schema already at v' + newVersion + ', nothing to migrate'
      );
    }

    // 5. Will the code even load? This is where a bad deploy usually dies.
    for (const m of MODULES.concat(['server.js', 'app.js', 'login.js', 'sw.js'])) {
      const file = path.join(dir, m);
      if (!fs.existsSync(file)) {
        warn('missing file: ' + m);
        return 1;
      }
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      } catch (e) {
        warn('SYNTAX ERROR in ' + m + ':');
        warn(String(e.stderr || e.message).trim());
        return 1;
      }
    }
    for (const m of MODULES) {
      try {
        require(path.join(dir, m));
      } catch (e) {
        warn('MODULE FAILED TO LOAD: ' + m + ' — ' + e.message);
        warn('The server would crash on start. Do not deploy.');
        return 1;
      }
    }
    if (!quiet) say('all modules parse and load');

    // 6. The DuckDNS wiring, against the snapshot, without a network.
    //    It runs at server start-up, so a throw here is a server that will not
    //    boot. `skip` is not used: the point is to exercise the real path.
    try {
      const duckdns = require(path.join(dir, 'duckdns.js'));
      const conn = new DatabaseSync(copy);
      try {
        duckdns.start({
          database: conn,
          dbApi: db,
          log: () => {},
          deps: { httpGet: () => Promise.resolve({ status: 200, body: 'OK\n\n\nNOCHANGE' }) }
        });
        duckdns.stop();
      } finally {
        conn.close();
      }
    } catch (e) {
      warn('DUCKDNS WIRING THREW at start-up: ' + e.message);
      return 1;
    }
    if (!quiet) say('duckdns updater arms and disarms cleanly');

    if (!quiet) say('preflight passed — safe to restart');
    return 0;
  } finally {
    cleanup();
  }
}

module.exports = { main, census, losses, snapshot, MODULES };

if (require.main === module) {
  let code;
  try {
    code = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write('  preflight itself failed: ' + (e && e.message ? e.message : String(e)) + '\n');
    code = 2;
  }
  process.exit(code);
}
