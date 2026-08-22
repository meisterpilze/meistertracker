'use strict';

// ── The updater that runs when the server does not ───────────────────────────
//
// duckdns.js keeps the A record honest while this application is running. That
// leaves one gap it cannot close by construction: the record stops moving the
// moment the process stops, because the thing that moves it *is* the process.
// A failed deploy, a reboot where pm2 never came back, a crash nobody saw — and
// the name goes on pointing at whatever address the line had when the server
// last spoke. The server is then unreachable for a reason that has nothing to
// do with whether it is running: by the time somebody starts it again, the
// address it advertises is somebody else's.
//
// So this is a one-shot, run by systemd (Linux) or Task Scheduler (Windows),
// outside the server's lifetime entirely. It exists to be the thing that is
// still there when the server is not.
//
// **It reads the server's column and writes its own.** The two do not share a
// timestamp, and the first version of this file did, which broke two things at
// once. It measured itself: standing down whenever `last_ip_update` was fresh
// meant standing down when *it* was what made it fresh, so during a real outage
// it acted every fifteen minutes rather than every five. And it hid a running
// server whose own updater had died, because refreshing that column is exactly
// what stops the admin banner going red. `last_ip_update` now means the server
// and only the server; this records itself in `fallback_last`. Neither writer
// can throttle or silence the other.
//
// **It stands down while the server is doing its job.** Only when the server's
// own last success is older than FALLBACK_AFTER_MS does this act — a figure set
// against duckdns.js's retry ladder, so a server merely having a bad few
// minutes is left to its own retries instead of being raced.
//
// **It opens the database read-only to decide.** Answering "should I act" is a
// read, and taking a write handle on the live database to perform one is how a
// probe that runs on every deploy ends up creating -wal/-shm files owned by the
// wrong user. The write handle is opened only on the path that actually writes.
//
// **It does not open the database the way the server does.** `db.openDb` runs
// migrations and backfills, which is right for an application starting up and
// wrong for an unattended timer: a background job silently migrating a schema
// while nobody is watching is how a five-minute outage turns into a restore
// from backup. Requiring db.js has no such effect — it defines functions — so
// its accessors are reused rather than re-implemented here.
//
// Usage:
//   node scripts/duckdns-fallback.js [--force] [--quiet] [--check]
//
//   --force  update regardless of how recently the server did, for testing the
//            installation without waiting for a real gap
//   --quiet  print nothing on the ordinary "server is alive" path
//   --check  answer "is DuckDNS configured here?" and do nothing else. No
//            network, no writes. update_server.sh uses it so the reminder to
//            install this only appears on machines where it would help.
//
// Exit codes: 0 nothing to do, or the record was updated and recorded.
//             1 the update was refused, failed, or could not be recorded; and
//               for --check, "DuckDNS is not configured here".
//             2 this checkout or database cannot be used at all.
// systemd records a non-zero exit against the unit, so
// `systemctl status meistertracker-duckdns` is the whole report.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const duckdns = require('../duckdns.js');
const db = require('../db.js');

const DIR = path.join(__dirname, '..');
const DB_FILE = path.join(DIR, 'meistertracker.db');

/**
 * Is this checkout a git worktree rather than the real deployment?
 *
 * A worktree carries the same configuration and often a copy of the same token,
 * and an unattended timer inside one would quietly fight production over the
 * external record — the same reason the server itself skips its updater there.
 * A worktree's `.git` is a file pointing at the parent repository, not a
 * directory.
 *
 * ⚠️ That heuristic is also true of a submodule and of `--separate-git-dir`,
 * where this refuses a checkout that update_server.sh would happily deploy. It
 * errs towards refusing, which is the safe direction for a job whose failure
 * mode is two updaters fighting over one name, but it is a heuristic and the
 * two answers can differ.
 */
function isWorktree(dir, env) {
  if (env && (env.WORKTREE_MODE === '1' || env.WORKTREE_MODE === 'true')) return true;
  try {
    return fs.statSync(path.join(dir, '.git')).isFile();
  } catch {
    return false;
  }
}

/**
 * Should the fallback take over? Pure, so the rule can be pinned by a test
 * rather than by waiting a quarter of an hour.
 *
 * `cfg.lastIpUpdate` is the *server's* last success and nothing else writes it,
 * which is what makes this honest: during an outage it stops moving, so every
 * tick sees it grow older and every tick acts. Measuring against a column this
 * process also wrote would mean standing down on the strength of its own work.
 *
 * Absent or unparseable means the server has never recorded a success. That is
 * not a reason to stand down — it is the strongest reason to act, and it is
 * what a database restored from backup looks like.
 */
function shouldRun(cfg, now, force) {
  if (!duckdns.isConfigured(cfg)) return { run: false, why: 'not configured' };
  if (force) return { run: true, why: 'forced' };
  const st = duckdns.staleness(cfg.lastIpUpdate, now, duckdns.FALLBACK_AFTER_MS);
  if (st.future) return { run: true, why: 'the recorded time is in the future — clock not trustworthy' };
  if (st.ageMs == null) return { run: true, why: 'no successful update on record' };
  const mins = Math.round(st.ageMs / 60000);
  return st.stale
    ? { run: true, why: 'server last updated ' + mins + ' min ago' }
    : { run: false, why: 'server updated ' + mins + ' min ago' };
}

/**
 * Read the config without taking a write handle.
 *
 * Errors are reported rather than flattened. The first version caught
 * everything here and said "no duckdns_config row", so a locked database, a
 * permissions change and a corrupt file all told the operator to start a server
 * that was already running — every five minutes, in a journal that never named
 * the real fault.
 */
function readConfig(dbFile) {
  let conn;
  try {
    conn = new DatabaseSync(dbFile, { readonly: true });
    conn.exec('PRAGMA busy_timeout = 5000');
    return { cfg: db.getDuckdnsCfg(conn) };
  } catch (e) {
    const missing = /no such table/i.test(e.message || '');
    return { error: e.message, missing };
  } finally {
    try {
      if (conn) conn.close();
    } catch {
      /* nothing was written; a close failure changes nothing */
    }
  }
}

/**
 * @param {string[]} argv
 * @param {{dir?: string, dbFile?: string, env?: object, out?: Function,
 *          err?: Function, deps?: object, dbApi?: object}} [opts]
 *        Everything the outside world provides, so a test can hand it a
 *        throwaway database and a fake DuckDNS instead of waiting for a real
 *        outage against the real service.
 */
async function main(argv, opts) {
  const o = opts || {};
  const dir = o.dir || DIR;
  const dbFile = o.dbFile || DB_FILE;
  const env = o.env || process.env;
  const force = argv.includes('--force');
  const quiet = argv.includes('--quiet');
  const check = argv.includes('--check');
  const say = o.out || ((msg) => process.stdout.write('duckdns-fallback: ' + msg + '\n'));
  const warn = o.err || ((msg) => process.stderr.write('duckdns-fallback: ' + msg + '\n'));

  if (isWorktree(dir, env)) {
    warn('refusing to run from a git worktree — it would fight the real instance for the record');
    return 2;
  }
  if (!fs.existsSync(dbFile)) {
    warn('no database at ' + dbFile);
    return 2;
  }

  const read = readConfig(dbFile);
  if (read.error) {
    warn(
      read.missing
        ? 'no duckdns_config table — start the server once before installing this'
        : 'cannot read the database: ' + read.error
    );
    return 2;
  }
  const cfg = read.cfg;

  if (check) {
    const configured = duckdns.isConfigured(cfg);
    if (!quiet) say(configured ? 'duckdns is configured' : 'duckdns is not configured');
    return configured ? 0 : 1;
  }

  const verdict = shouldRun(cfg, Date.now(), force);
  if (!verdict.run) {
    if (!quiet) say('standing by (' + verdict.why + ')');
    return 0;
  }
  say('taking over (' + verdict.why + ')');

  // Only now does a write handle exist. Reuse the server's own update path so
  // the reply is parsed, the timeout applies and the column names live in one
  // place; `statusFields` is the whole adaptation, and it is what keeps this
  // process out of the column the admin banner reads.
  const conn = new DatabaseSync(dbFile);
  try {
    conn.exec('PRAGMA busy_timeout = 5000');
    const r = await duckdns.updateNow({
      database: conn,
      dbApi: o.dbApi || db,
      log: (level, msg, meta) => warn(msg + (meta ? ' ' + JSON.stringify(meta) : '')),
      deps: o.deps,
      statusFields: (at) => ({ fallbackLast: at })
    });
    if (!r.ok) {
      warn('update failed: ' + r.reason);
      return 1;
    }
    if (!r.wrote) {
      // The record is correct; our note about it is not. Worth a non-zero exit:
      // this is the one signal that the timer ran, and an operator reading
      // "last result 0" would have no reason to look further.
      warn('record updated, but the run could not be recorded: ' + r.writeError);
      return 1;
    }
    say('record updated');
    return 0;
  } finally {
    try {
      conn.close();
    } catch {
      /* the update already landed; a close failure changes nothing */
    }
  }
}

module.exports = { shouldRun, isWorktree, readConfig, main, DIR, DB_FILE };

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write('duckdns-fallback: ' + (e && e.message ? e.message : String(e)) + '\n');
      process.exit(1);
    }
  );
}
