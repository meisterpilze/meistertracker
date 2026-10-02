'use strict';
// The GitHub webhook's deploy, from a push to main to the chain that restarts
// the server.
//
// The server does the first two steps itself, before anything on disk changes:
//
//   fetch     git fetch origin, then the commit origin/main now points at
//   snapshot  a copy of the database through the server's own open handle
//             (db.backupDb, VACUUM INTO) to backups/meistertracker_<stamp>.db
//
// and only then spawns scripts/deploy-chain.js for the rest: update, install,
// the preflight against that snapshot, restart.
//
// Fetching first means a delivery that cannot reach GitHub changes nothing and
// leaves no snapshot behind to push an older one out of the rotation. Taking
// the snapshot here, in-process, means it runs on the code that is running,
// whatever an earlier failed deploy left checked out: a refused commit whose
// db.js or backup-db.js would not load used to stop every later deploy at its
// first step, before it could fetch the fix. And the chain never has to open
// the live database at all; the one connection that touches it is the
// server's own, which an admin's restore closes and reopens in one synchronous
// stretch that nothing here can interleave with.
//
// One deploy runs at a time. Two pushes merged a few seconds apart used to start
// two chains in the same checkout: the second reset the tree under the first
// one's preflight, the first one's pm2 restart killed the second mid-install,
// and pm2 started a tree no preflight had checked. A delivery that arrives
// while a deploy runs, or while an admin restores a backup, is queued instead;
// only the newest is kept, because every deploy is of origin/main as it is by
// then, not of the commit its own push carried. It runs when the current
// deploy ends without a restart. When the current one succeeds, the server is
// restarted, so the queue is handed over on disk and the new server picks it
// up (resumePending), deploying only if origin/main has moved past the commit
// it now runs.
//
// It lives outside server.js so the tests can drive it with stand-ins for git,
// the database and the child process instead of reading server.js as text.

const fs = require('fs');
const path = require('path');
const deployChain = require('./deploy-chain.js');
const { preUpdateSnapshotName } = require('./rotate-backups.js');

const SHA40 = /^[0-9a-f]{40}$/;
// How long a delivery waits for an admin's restore before it looks again.
const RESTORE_RETRY_MS = 30_000;

// Error text for the deploy-state record, which /api/health/full shows to an
// admin: git puts the remote URL in its messages, and a URL can carry a token.
function scrub(message, max = 500) {
  return String(message || '')
    .replace(/\/\/[^/\s@]+@/g, '//***@')
    .slice(0, max);
}

// The chain's output goes to the log file, and the chain prints "== <step>"
// before each step. A failed step's own output is what follows its marker up
// to the next one; the next one is usually "== rolling back", whose output
// would otherwise bury the reason. Without a step, the end of the log.
function stepOutput(text, step) {
  const lines = String(text || '').split(/\r?\n/);
  let from = 0;
  let to = lines.length;
  if (step) {
    const at = lines.map((l) => l.trim()).lastIndexOf('== ' + step);
    if (at < 0) return '';
    from = at + 1;
    const next = lines.slice(from).findIndex((l) => /^== /.test(l.trim()));
    if (next >= 0) to = from + next;
  }
  const kept = lines.slice(from, to).filter((l) => l.trim() && !/^== /.test(l.trim()));
  return scrub(kept.slice(-15).join('\n'), 1500);
}

// The last 64 KiB of a file, or '' when it cannot be read.
function readTail(file, bytes = 64 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* read is done either way */
      }
    }
  }
}

/**
 * The deploy-state record to write when the chain has exited, or null for none.
 *
 * A step that fails writes its own failed record, naming the step, and exits 1:
 * keep that record and add the exit code. A success record means the chain got
 * as far as `pm2 restart`, which stops this process and, by pm2's default, the
 * children it started, the chain among them; an exit seen after that is the
 * restart, not a failure. Anything else is a chain that died before it could
 * write a record of its own.
 *
 * @param {object|null} prev     the record on disk now
 * @param {object} attempt       { sha, started, snapshot } of this delivery
 * @param {{code: number|null, signal?: string|null}} exit
 * @returns {object|null}
 */
function settleExit(prev, attempt, exit) {
  if (exit.code === 0) return null;
  const own = prev && prev.started === attempt.started ? prev : null;
  if (own && own.status === 'success') return null;
  if (own && own.status === 'failed') return Object.assign({}, own, { exitCode: exit.code });
  return {
    status: 'failed',
    sha: attempt.sha,
    started: attempt.started,
    snapshot: attempt.snapshot,
    exitCode: exit.code
  };
}

/**
 * @param {object} deps
 * @param {string} deps.platform    process.platform
 * @param {string} deps.dir         the checkout
 * @param {string} deps.node        the node binary for the chain's preflight
 * @param {string} deps.pm2Name     the PM2 process to restart
 * @param {string} deps.stateFile   the deploy-state sentinel the chain writes to
 * @param {string} deps.pendingFile where a queued delivery waits across a restart
 * @param {string} deps.logFile     the chain's output, one attempt at a time
 * @param {string} deps.backupDir   where the snapshot goes
 * @param {(args: string[]) => Promise<string>} deps.git   git in the checkout; resolves to stdout
 * @param {(dest: string) => void} deps.snapshot           copies the live database to dest, throws on failure
 * @param {() => void} deps.rotate                          the pre-update snapshot rotation
 * @param {() => boolean} deps.restoreBusy                  true while an admin restore runs
 * @param {() => string|null} deps.runningCommit            the commit this process started from, if known
 * @param {() => object|null} deps.readState
 * @param {(record: object) => void} deps.writeState
 * @param {(level: string, msg: string, data?: object) => void} deps.log
 * @param {Function} deps.spawn                             child_process.spawn
 * @param {() => Date} [deps.now]
 * @param {Function} [deps.setTimeout]
 */
function createDeployRunner(deps) {
  const d = Object.assign({ now: () => new Date(), setTimeout }, deps);
  let busy = false;
  let queued = null;
  let retrying = false;

  /**
   * A push to main. Resolves to 'queued' at once when it has to wait, otherwise
   * once the chain is spawned ('started') or the attempt has stopped before it
   * ('stopped', or 'up to date' for a resumed delivery with nothing new). The
   * chain's own outcome arrives later, in the deploy-state file.
   */
  async function deliver(info) {
    if (busy || d.restoreBusy()) {
      queue(info);
      return 'queued';
    }
    busy = true;
    let result;
    try {
      result = await run(info);
    } catch (e) {
      d.log('error', 'Deploy failed', { error: e.message });
      result = 'stopped';
    }
    if (result !== 'started') finish();
    return result;
  }

  function queue(info) {
    queued = { sha: info.sha, sender: info.sender };
    d.log('info', 'Deploy queued behind ' + (busy ? 'the one running' : 'a restore'), { sha: info.sha });
    try {
      fs.mkdirSync(path.dirname(d.pendingFile), { recursive: true });
      fs.writeFileSync(d.pendingFile, JSON.stringify(Object.assign({ queued: d.now().toISOString() }, queued)));
    } catch (e) {
      d.log('warn', 'Could not write the queued deploy to disk', { error: e.message });
    }
    if (!busy && !retrying) {
      retrying = true;
      d.setTimeout(() => {
        retrying = false;
        drain();
      }, RESTORE_RETRY_MS);
    }
  }

  // The deploy has ended without a restart: run what queued up meanwhile.
  function finish() {
    busy = false;
    drain();
  }

  function drain() {
    if (busy || !queued) return;
    const next = queued;
    queued = null;
    try {
      fs.rmSync(d.pendingFile, { force: true });
    } catch {
      /* deliver() writes it again if it has to wait once more */
    }
    deliver(next).catch(() => {});
  }

  /**
   * After a restart: a delivery queued behind the deploy that restarted this
   * process. Deploys only if origin/main has moved past the commit running now.
   */
  function resumePending() {
    let info;
    try {
      info = JSON.parse(fs.readFileSync(d.pendingFile, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') d.log('warn', 'Queued deploy on disk unreadable, dropped', { error: e.message });
      try {
        fs.rmSync(d.pendingFile, { force: true });
      } catch {
        /* nothing to resume either way */
      }
      return Promise.resolve('none');
    }
    try {
      fs.rmSync(d.pendingFile, { force: true });
    } catch {
      /* resumed once; a leftover would only cause one more check */
    }
    return deliver({ sha: info.sha, sender: info.sender, onlyIfNew: true });
  }

  async function run(info) {
    const started = d.now().toISOString();
    const attempt = { sha: info.sha, started, snapshot: undefined };
    const inProgress = () => d.writeState({ status: 'in_progress', sha: info.sha, started, sender: info.sender });
    if (!info.onlyIfNew) inProgress();
    const stop = (step, e) => {
      const error = scrub(e && e.message ? e.message : e);
      d.log('error', 'Deploy stopped at ' + step, { error, sha: attempt.sha });
      d.writeState({ status: 'failed', step, sha: attempt.sha, started, snapshot: attempt.snapshot, error });
      return 'stopped';
    };

    // 1. What to deploy. A fetch writes only refs and objects, never the tree
    //    or HEAD, so a failure here has changed nothing.
    let target;
    try {
      await d.git(['fetch', 'origin']);
      target = String(await d.git(['rev-parse', '--verify', 'origin/main^{commit}'])).trim();
      if (!SHA40.test(target)) throw new Error('origin/main did not resolve to a commit id');
    } catch (e) {
      if (info.onlyIfNew) inProgress();
      return stop('fetch', e);
    }
    const running = d.runningCommit();
    if (info.onlyIfNew) {
      if (running && target.startsWith(running)) {
        d.log('info', 'Queued deploy: already running origin/main', { sha: target });
        return 'up to date';
      }
      inProgress();
    }
    attempt.sha = target;
    // What the chain puts back when a step after the update fails: the commit
    // this process runs, so the tree on disk matches the code in memory again.
    // HEAD when that is unknown (git missing at start-up), which is the same
    // commit unless something moved the tree since.
    let rollback = null;
    try {
      rollback = String(await d.git(['rev-parse', '--verify', (running || 'HEAD') + '^{commit}'])).trim();
      if (!SHA40.test(rollback)) rollback = null;
    } catch (e) {
      d.log('warn', 'No commit to roll back to if this deploy fails', { error: scrub(e.message) });
    }

    // 2. The snapshot, through the server's own handle. A file that is already
    //    there under this name is someone else's, and is left alone.
    const name = preUpdateSnapshotName(d.now());
    const dest = path.join(d.backupDir, name);
    if (fs.existsSync(dest)) return stop('snapshot', new Error('a snapshot named ' + name + ' already exists'));
    try {
      d.snapshot(dest);
    } catch (e) {
      try {
        fs.rmSync(dest, { force: true });
      } catch {
        /* the record below is what matters */
      }
      return stop('snapshot', e);
    }
    attempt.snapshot = name;
    // Right away, so the window stays bounded by the count even when this
    // deploy then fails and nothing restarts the server.
    try {
      d.rotate();
    } catch (e) {
      d.log('warn', 'Pre-update snapshot rotation failed', { error: e.message });
    }

    // 3. The rest, in a detached chain that outlives this process's restart.
    let chain;
    try {
      chain = deployChain.buildDeployChain({
        platform: d.platform,
        dir: d.dir,
        node: d.node,
        stateFile: d.stateFile,
        sha: target,
        started,
        snapshot: name,
        pm2Name: d.pm2Name,
        rollback
      });
    } catch (e) {
      return stop('prepare', e);
    }
    // windowsVerbatimArguments is what makes the Windows branch work at all.
    // Node escapes quotes inside an argv entry as \" — correct for MSVCRT
    // programs, but cmd.exe does not understand it, so the whole `/c` string
    // (quoted cd, quoted redirect targets, JSON) arrived mangled. cmd exited
    // 1 immediately: no git, no npm, no pm2 restart, and neither the success
    // nor the failed sentinel. The deploy looked like it ran, the files were
    // never pulled, and the server kept serving the old code silently. Safe
    // to pass the line verbatim because every interpolated value is generated
    // or whitelisted (see scripts/deploy-chain.js), never raw request input.
    // The option is ignored on non-Windows platforms.
    // The chain's output goes to the log, overwritten per attempt. It used to
    // go nowhere, so a refusal said which step stopped and never why: low
    // disk space, a migration that lost rows, a module that would not load.
    let out = 'ignore';
    try {
      fs.mkdirSync(path.dirname(d.logFile), { recursive: true });
      out = fs.openSync(d.logFile, 'w');
    } catch (e) {
      d.log('warn', 'Deploy log not writable; the chain runs without it', { error: e.message });
    }
    let child;
    try {
      child = d.spawn(chain.command, chain.args, {
        cwd: d.dir,
        detached: true,
        stdio: ['ignore', out, out],
        windowsVerbatimArguments: true
      });
    } finally {
      // The child has its own copy of the handle now.
      if (typeof out === 'number') {
        try {
          fs.closeSync(out);
        } catch {
          /* nothing to keep open in this process */
        }
      }
    }
    // A deploy that dies before its own sentinel used to be completely silent.
    // Either way the deploy is over: whatever queued up meanwhile goes next.
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      finish();
    };
    child.on('exit', (code, signal) => {
      const record = settleExit(d.readState(), attempt, { code, signal });
      if (record) {
        const detail = stepOutput(readTail(d.logFile), record.step);
        if (detail) record.detail = detail;
        record.log = path.relative(d.dir, d.logFile).split(path.sep).join('/');
        d.log('error', 'Deploy chain exited without deploying', { code, signal, step: record.step, sha: target });
        d.writeState(record);
      }
      end();
    });
    child.on('error', (e) => {
      d.log('error', 'Deploy chain failed to spawn', { error: e.message, sha: target });
      d.writeState({ status: 'failed', sha: target, started, snapshot: name, error: scrub(e.message) });
      end();
    });
    child.unref();
    return 'started';
  }

  return { deliver, resumePending };
}

module.exports = { createDeployRunner, settleExit, scrub, stepOutput, RESTORE_RETRY_MS };
