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
// **It stands down while the server is doing its job.** The two do not both
// update. The server records the time of every successful update in the
// database, and this reads that timestamp: fresh means the server is alive and
// there is nothing to do, and the script exits without touching the network.
// Only a stale timestamp — FALLBACK_AFTER_MS, two missed cycles plus slack —
// makes it act. That is what keeps a fallback from becoming a second updater
// racing the first.
//
// **It does not open the database the way the server does.** `db.openDb` runs
// migrations and backfills, which is right for an application starting up and
// wrong for an unattended timer: a background job silently migrating a schema
// while nobody is watching is how a five-minute outage turns into a restore
// from backup. This opens the file and reads one row of one table. If that
// table is not there yet, there is nothing to fall back *to*, and it says so
// and leaves.
//
// Usage:
//   node scripts/duckdns-fallback.js [--force] [--quiet]
//
//   --force  update regardless of how recently the server did, for testing the
//            installation without waiting twelve minutes for a real gap
//   --quiet  print nothing on the ordinary "server is alive" path
//   --check  answer "is DuckDNS configured here?" and do nothing else. No
//            network, no writes. update_server.sh uses it so the reminder to
//            install this only appears on machines where it would help.
//
// Exit codes: 0 nothing to do or updated, 1 the update was refused or failed,
// 2 misconfigured or unusable database. systemd records a non-zero exit against
// the unit, so `systemctl status meistertracker-duckdns` is the whole report.

const fs = require('fs');
const path = require('path');
const duckdns = require('../duckdns.js');

const DIR = path.join(__dirname, '..');
const DB_FILE = process.env.MT_DB || path.join(DIR, 'meistertracker.db');

/**
 * Is this checkout a git worktree rather than the real deployment?
 *
 * A worktree carries the same configuration and often a copy of the same token,
 * and an unattended timer inside one would quietly fight production over the
 * external record — the same reason the server itself skips its updater there.
 * A worktree's `.git` is a file pointing at the parent repository, not a
 * directory, which is enough to tell without shelling out to git.
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
 * rather than by waiting twelve minutes.
 *
 * `null`/absent means the server has never recorded a successful update. That
 * is not a reason to stand down — it is the strongest reason to act, and it is
 * what a database restored from backup looks like.
 */
function shouldRun(cfg, now, force) {
  if (!cfg || !cfg.enabled || !cfg.domain || !cfg.token) return { run: false, why: 'not configured' };
  if (force) return { run: true, why: 'forced' };
  const at = cfg.lastIpUpdate ? Date.parse(cfg.lastIpUpdate) : NaN;
  if (!Number.isFinite(at)) return { run: true, why: 'no successful update on record' };
  const ageMs = now - at;
  if (ageMs < duckdns.FALLBACK_AFTER_MS)
    return { run: false, why: 'server updated ' + Math.round(ageMs / 60000) + ' min ago' };
  return { run: true, why: 'last update ' + Math.round(ageMs / 60000) + ' min ago' };
}

/**
 * Open the database and read the one row this cares about.
 *
 * Deliberately not db.openDb — see the note at the top. Returns null when the
 * file or the table is not there, which is a "nothing to do", not a crash.
 */
function readConfig(dbFile) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  let row;
  try {
    row = db.prepare('SELECT enabled, domain, token, last_ip, last_ip_update FROM duckdns_config WHERE id = 1').get();
  } catch {
    db.close();
    return null;
  }
  if (!row) {
    db.close();
    return null;
  }
  return {
    db,
    cfg: {
      enabled: row.enabled === 1,
      domain: row.domain || '',
      token: row.token || '',
      lastIp: row.last_ip || null,
      lastIpUpdate: row.last_ip_update || null
    }
  };
}

/**
 * @param {string[]} argv
 * @param {{dir?: string, dbFile?: string, env?: object, out?: Function, err?: Function,
 *          deps?: object, now?: number}} [opts]
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

  let opened;
  try {
    opened = readConfig(dbFile);
  } catch (e) {
    warn('cannot read the database: ' + e.message);
    return 2;
  }
  if (!opened) {
    warn('no duckdns_config row — start the server once before installing this');
    return 2;
  }

  const { db, cfg } = opened;
  try {
    if (check) {
      const configured = !!(cfg.enabled && cfg.domain && cfg.token);
      if (!quiet) say(configured ? 'duckdns is configured' : 'duckdns is not configured');
      return configured ? 0 : 1;
    }
    const verdict = shouldRun(cfg, o.now == null ? Date.now() : o.now, force);
    if (!verdict.run) {
      if (!quiet) say('standing by (' + verdict.why + ')');
      return 0;
    }
    say('taking over (' + verdict.why + ')');

    // Reuse the server's own update path so the reply is parsed, the timeout
    // applies and the status row is written in exactly one place. The dbApi
    // shim is the whole adaptation: two functions, no schema, no migrations.
    const dbApi = {
      getDuckdnsCfg: () => cfg,
      updateDuckdnsStatus: (_d, fields) => {
        const sets = [];
        const vals = [];
        if (fields.lastIpUpdate !== undefined) {
          sets.push('last_ip_update=?');
          vals.push(fields.lastIpUpdate);
        }
        if (fields.lastIp !== undefined) {
          sets.push('last_ip=?');
          vals.push(fields.lastIp);
        }
        if (sets.length) db.prepare('UPDATE duckdns_config SET ' + sets.join(',') + ' WHERE id=1').run(...vals);
      }
    };

    const r = await duckdns.updateNow({ database: db, dbApi, log: (_l, m) => warn(m), deps: o.deps });
    if (!r.ok) {
      warn('update failed: ' + r.reason);
      return 1;
    }
    say('record updated');
    return 0;
  } finally {
    try {
      db.close();
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
