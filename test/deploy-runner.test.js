'use strict';
// What the server does around the deploy chain, driven directly. The exit
// handling used to be checked by reading server.js for two phrases, and that
// test kept passing when the handler overwrote the chain's own record (losing
// the step it stopped at) or took another delivery's record for its own.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDeployRunner, settleExit, scrub, stepOutput } = require('../scripts/deploy-runner.js');

const attempt = { sha: 'deadbeef', started: '2026-10-02T10:00:00.000Z', snapshot: 'meistertracker_20261002_120000.db' };
const failedAt = (step, extra) =>
  Object.assign(
    { status: 'failed', step, sha: attempt.sha, started: attempt.started, snapshot: attempt.snapshot },
    extra
  );

describe('what the chain leaves behind when it exits', () => {
  it('a clean exit needs no record', () => {
    assert.equal(settleExit({ status: 'success', ...attempt }, attempt, { code: 0, signal: null }), null);
  });

  it('keeps the failed record the chain wrote, step and all, and adds the exit code', () => {
    const own = failedAt('preflight');
    assert.deepEqual(settleExit(own, attempt, { code: 1, signal: null }), failedAt('preflight', { exitCode: 1 }));
  });

  // pm2 restart stops the server and, by default, the chain with it. The
  // success record was written just before; the exit is the restart.
  it('leaves this attempt’s success record alone', () => {
    const own = { status: 'success', ...attempt };
    assert.equal(settleExit(own, attempt, { code: null, signal: 'SIGINT' }), null);
  });

  it('records a chain that died before writing anything of its own', () => {
    const own = { status: 'in_progress', ...attempt, sender: 'someone' };
    const r = settleExit(own, attempt, { code: null, signal: 'SIGKILL' });
    assert.equal(r.status, 'failed');
    assert.equal(r.started, attempt.started);
    assert.equal(r.sha, attempt.sha);
    assert.equal(r.snapshot, attempt.snapshot);
    assert.equal(r.exitCode, null);
  });

  it('and one that found no record at all', () => {
    const r = settleExit(null, attempt, { code: 1, signal: null });
    assert.equal(r.status, 'failed');
    assert.equal(r.started, attempt.started);
  });

  // Matching on the delivery's start time is what makes a record this
  // attempt's. Another delivery's success must not silence this failure.
  it('does not take an earlier delivery’s success for its own', () => {
    const earlier = { status: 'success', sha: 'cafef00d', started: '2026-10-02T09:00:00.000Z' };
    const r = settleExit(earlier, attempt, { code: 1, signal: null });
    assert.ok(r, 'the failure went unrecorded');
    assert.equal(r.status, 'failed');
    assert.equal(r.started, attempt.started);
  });
});

// ── The deploy itself, with stand-ins for git, the database and the child ──

const TARGET = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00';
// What git resolves the running commit (or HEAD) to.
const RUNNING = '1234567890123456789012345678901234567890';
const NOON = () => new Date(2026, 9, 2, 12, 0, 0);
const NOON_SNAPSHOT = 'meistertracker_20261002_120000.db';

// `opts.root` sets up a second runner on the same checkout, as the server that
// a successful deploy restarted.
function setup(opts = {}) {
  const dir = opts.root || fs.mkdtempSync(path.join(os.tmpdir(), 'mt-runner-'));
  const backupDir = path.join(dir, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
  const seq = [];
  const states = [];
  const logs = [];
  const spawned = [];
  const timers = [];
  let onDisk = opts.state || null;
  // The clock stands still unless a test moves it: a second deploy in the same
  // second would want the same snapshot name, and is refused for it.
  let clock = (opts.now || NOON)().getTime();
  const runner = createDeployRunner({
    platform: opts.platform || 'linux',
    dir: opts.dir || dir,
    node: '/usr/bin/node',
    pm2Name: 'meisterpilze-test',
    stateFile: path.join(dir, 'data', 'deploy-state.json'),
    pendingFile: path.join(dir, 'data', 'deploy-pending.json'),
    logFile: path.join(dir, 'data', 'deploy.log'),
    backupDir,
    git: async (args) => {
      seq.push('git ' + args.join(' '));
      if (opts.git) return opts.git(args);
      if (args[0] !== 'rev-parse') return '';
      return (args[2] === 'origin/main^{commit}' ? TARGET : RUNNING) + '\n';
    },
    snapshot: (dest) => {
      seq.push('snapshot ' + path.basename(dest));
      if (opts.snapshot) return opts.snapshot(dest);
      fs.writeFileSync(dest, 'SQLite format 3\0');
    },
    rotate: () => seq.push('rotate'),
    restoreBusy: () => Boolean(opts.restoreBusy && opts.restoreBusy()),
    runningCommit: () => (opts.runningCommit === undefined ? null : opts.runningCommit),
    setTimeout: (fn) => timers.push(fn),
    readState: () => onDisk,
    writeState: (r) => {
      onDisk = r;
      states.push(r);
    },
    log: (level, msg, data) => logs.push({ level, msg, data }),
    spawn: (command, args, options) => {
      seq.push('spawn');
      const child = new EventEmitter();
      child.unref = () => {};
      spawned.push({ command, args, options, child });
      return child;
    },
    now: () => new Date(clock)
  });
  return {
    runner,
    dir,
    backupDir,
    seq,
    states,
    logs,
    spawned,
    timers,
    advance: (ms) => (clock += ms),
    pendingFile: path.join(dir, 'data', 'deploy-pending.json'),
    state: () => onDisk,
    setState: (s) => (onDisk = s),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}

describe('a delivery, before the chain', () => {
  it('fetches, takes the snapshot, rotates, and only then spawns the chain for the fetched commit', async () => {
    const t = setup();
    try {
      await t.runner.deliver({ sha: 'abc1234', sender: 'someone' });
      assert.deepEqual(t.seq, [
        'git fetch origin',
        'git rev-parse --verify origin/main^{commit}',
        'git rev-parse --verify HEAD^{commit}',
        'snapshot ' + NOON_SNAPSHOT,
        'rotate',
        'spawn'
      ]);
      assert.deepEqual(t.states[0], {
        status: 'in_progress',
        sha: 'abc1234',
        started: NOON().toISOString(),
        sender: 'someone'
      });
      assert.ok(fs.existsSync(path.join(t.backupDir, NOON_SNAPSHOT)));
      const { command, args, options } = t.spawned[0];
      assert.equal(command, 'bash');
      assert.match(args[1], new RegExp('git reset --hard ' + TARGET));
      assert.match(args[1], new RegExp("--db 'backups/" + NOON_SNAPSHOT + "'"));
      assert.equal(options.cwd, t.dir);
      assert.equal(options.detached, true);
      assert.equal(options.windowsVerbatimArguments, true);
      assert.equal(options.stdio[0], 'ignore');
      assert.equal(typeof options.stdio[1], 'number', 'the chain’s output goes nowhere');
      assert.equal(options.stdio[2], options.stdio[1]);
    } finally {
      t.cleanup();
    }
  });

  // A fetch writes only refs and objects. Before, the snapshot came first, so
  // every delivery that could not reach GitHub still left a full copy behind
  // that counted toward the ten kept.
  it('changes nothing when the fetch fails: no snapshot, no chain', async () => {
    const t = setup({
      git: async (args) => {
        if (args[0] === 'fetch') throw new Error("fatal: unable to access 'https://bot:s3cret@github.com/x/y.git/'");
        return TARGET;
      }
    });
    try {
      await t.runner.deliver({ sha: 'abc1234' });
      assert.deepEqual(t.seq, ['git fetch origin']);
      assert.deepEqual(fs.readdirSync(t.backupDir), []);
      assert.equal(t.state().status, 'failed');
      assert.equal(t.state().step, 'fetch');
      assert.doesNotMatch(t.state().error, /s3cret/, 'a credential in the remote URL must not reach the record');
      assert.match(t.state().error, /\/\/\*\*\*@github\.com/);
    } finally {
      t.cleanup();
    }
  });

  it('stops when origin/main does not resolve to a full commit id', async () => {
    const t = setup({ git: async (args) => (args[0] === 'rev-parse' ? 'origin/main\n' : '') });
    try {
      await t.runner.deliver({ sha: 'abc1234' });
      assert.equal(t.state().step, 'fetch');
      assert.equal(t.spawned.length, 0);
      assert.deepEqual(fs.readdirSync(t.backupDir), []);
    } finally {
      t.cleanup();
    }
  });

  it('stops when the snapshot fails, and leaves no half-written file behind', async () => {
    const t = setup({
      snapshot: (dest) => {
        fs.writeFileSync(dest, 'SQLite format 3\0 and then the disk was full');
        throw new Error('Insufficient disk space: 10MB free, 30MB required');
      }
    });
    try {
      await t.runner.deliver({ sha: 'abc1234' });
      assert.equal(t.state().status, 'failed');
      assert.equal(t.state().step, 'snapshot');
      assert.match(t.state().error, /Insufficient disk space/);
      assert.deepEqual(fs.readdirSync(t.backupDir), [], 'the partial snapshot was left behind');
      assert.equal(t.spawned.length, 0, 'no chain without a snapshot');
      assert.ok(!t.seq.includes('rotate'));
    } finally {
      t.cleanup();
    }
  });

  it('never writes over a snapshot of the same name', async () => {
    const t = setup();
    try {
      const theirs = path.join(t.backupDir, NOON_SNAPSHOT);
      fs.writeFileSync(theirs, 'somebody else’s snapshot');
      await t.runner.deliver({ sha: 'abc1234' });
      assert.equal(t.state().step, 'snapshot');
      assert.equal(fs.readFileSync(theirs, 'utf8'), 'somebody else’s snapshot');
      assert.ok(!t.seq.some((s) => s.startsWith('snapshot ')), 'the snapshot was attempted anyway');
      assert.equal(t.spawned.length, 0);
    } finally {
      t.cleanup();
    }
  });

  it('refuses to spawn a chain it cannot quote', async () => {
    const t = setup({ platform: 'win32', dir: 'C:\\100%PATH%\\meistertracker' });
    try {
      await t.runner.deliver({ sha: 'abc1234' });
      assert.equal(t.state().step, 'prepare');
      assert.match(t.state().error, /cmd\.exe cannot quote/);
      assert.equal(t.spawned.length, 0);
    } finally {
      t.cleanup();
    }
  });
});

describe('a delivery, after the chain', () => {
  it('keeps what the chain recorded, and names the snapshot it took', async () => {
    const t = setup();
    try {
      await t.runner.deliver({ sha: 'abc1234' });
      const started = NOON().toISOString();
      t.setState({ status: 'failed', step: 'preflight', sha: TARGET, started, snapshot: NOON_SNAPSHOT });
      t.spawned[0].child.emit('exit', 1, null);
      assert.deepEqual(t.state(), {
        status: 'failed',
        step: 'preflight',
        sha: TARGET,
        started,
        snapshot: NOON_SNAPSHOT,
        exitCode: 1,
        log: 'data/deploy.log'
      });
    } finally {
      t.cleanup();
    }
  });

  it('records a chain that died before it wrote anything', async () => {
    const t = setup();
    try {
      await t.runner.deliver({ sha: 'abc1234' });
      t.spawned[0].child.emit('exit', null, 'SIGKILL');
      assert.equal(t.state().status, 'failed');
      assert.equal(t.state().sha, TARGET);
      assert.equal(t.state().snapshot, NOON_SNAPSHOT);
    } finally {
      t.cleanup();
    }
  });

  it('records a chain that could not be spawned', async () => {
    const t = setup();
    try {
      await t.runner.deliver({ sha: 'abc1234' });
      t.spawned[0].child.emit('error', new Error('spawn bash ENOENT'));
      assert.deepEqual(t.state(), {
        status: 'failed',
        sha: TARGET,
        started: NOON().toISOString(),
        snapshot: NOON_SNAPSHOT,
        error: 'spawn bash ENOENT'
      });
    } finally {
      t.cleanup();
    }
  });
});

describe('scrub', () => {
  it('hides credentials in URLs and keeps the record short', () => {
    assert.equal(scrub('see https://u:p@host/x and ssh://git@host/y'), 'see https://***@host/x and ssh://***@host/y');
    assert.equal(scrub('x'.repeat(2000)).length, 500);
  });
});

// Two pushes merged a few seconds apart used to start two chains in one
// checkout: the second reset the tree under the first one's preflight, and the
// first one's restart killed the second mid-install and came up on a tree no
// preflight had checked.
describe('one deploy at a time', () => {
  const tick = () => new Promise((r) => setImmediate(r));

  it('queues a push that lands while a deploy runs, and runs it once that one has failed', async () => {
    const t = setup();
    try {
      assert.equal(await t.runner.deliver({ sha: 'aaaaaaa' }), 'started');
      assert.equal(await t.runner.deliver({ sha: 'bbbbbbb' }), 'queued');
      assert.equal(t.spawned.length, 1, 'a second chain was started next to the first');
      assert.equal(t.seq.filter((s) => s === 'git fetch origin').length, 1);
      assert.ok(fs.existsSync(t.pendingFile), 'the queued push is not kept on disk');
      t.setState({ status: 'failed', step: 'preflight', sha: TARGET, started: NOON().toISOString() });
      t.advance(60_000);
      t.spawned[0].child.emit('exit', 1, null);
      await tick();
      await tick();
      assert.equal(t.spawned.length, 2, 'the queued push never ran');
      assert.equal(fs.existsSync(t.pendingFile), false);
    } finally {
      t.cleanup();
    }
  });

  // Every deploy is of origin/main as it is by then, so the newest push stands
  // for all the ones before it.
  it('keeps only the newest of several queued pushes', async () => {
    const t = setup();
    try {
      await t.runner.deliver({ sha: 'aaaaaaa' });
      await t.runner.deliver({ sha: 'bbbbbbb' });
      await t.runner.deliver({ sha: 'ccccccc' });
      assert.equal(JSON.parse(fs.readFileSync(t.pendingFile, 'utf8')).sha, 'ccccccc');
      t.advance(60_000);
      t.spawned[0].child.emit('exit', 1, null);
      await tick();
      await tick();
      assert.equal(t.spawned.length, 2);
      t.spawned[1].child.emit('exit', 1, null);
      await tick();
      assert.equal(t.spawned.length, 2, 'more than one queued run');
    } finally {
      t.cleanup();
    }
  });

  it('frees the runner when a chain exits cleanly', async () => {
    const t = setup();
    try {
      await t.runner.deliver({ sha: 'aaaaaaa' });
      t.spawned[0].child.emit('exit', 0, null);
      t.advance(60_000);
      assert.equal(await t.runner.deliver({ sha: 'bbbbbbb' }), 'started');
    } finally {
      t.cleanup();
    }
  });

  it('frees it, too, when the deploy stops before the chain', async () => {
    const t = setup({ git: async () => Promise.reject(new Error('offline')) });
    try {
      assert.equal(await t.runner.deliver({ sha: 'aaaaaaa' }), 'stopped');
      assert.equal(await t.runner.deliver({ sha: 'bbbbbbb' }), 'stopped', 'the second push was queued forever');
    } finally {
      t.cleanup();
    }
  });

  it('waits for an admin restore to finish before it touches anything', async () => {
    let restoring = true;
    const t = setup({ restoreBusy: () => restoring });
    try {
      assert.equal(await t.runner.deliver({ sha: 'aaaaaaa' }), 'queued');
      assert.deepEqual(t.seq, [], 'the deploy ran during the restore');
      assert.equal(t.timers.length, 1);
      restoring = false;
      t.timers.shift()();
      await tick();
      await tick();
      assert.equal(t.spawned.length, 1, 'the deploy never ran after the restore');
    } finally {
      t.cleanup();
    }
  });

  // A deploy that succeeds restarts the server, and the queue goes with the
  // process. It waits on disk instead, for the server that comes up next.
  it('hands the queue to the restarted server, which deploys only what is new', async () => {
    const first = setup();
    try {
      await first.runner.deliver({ sha: 'aaaaaaa' });
      await first.runner.deliver({ sha: 'bbbbbbb', sender: 'someone' });
      assert.ok(fs.existsSync(first.pendingFile));

      // The restart came up on TARGET already: nothing new to deploy.
      const upToDate = setup({ root: first.dir, runningCommit: TARGET.slice(0, 7) });
      assert.equal(await upToDate.runner.resumePending(), 'up to date');
      assert.equal(upToDate.spawned.length, 0);
      assert.deepEqual(upToDate.states, [], 'the record of the deploy that just succeeded was overwritten');
      assert.equal(fs.existsSync(first.pendingFile), false);

      // Queued again, and this time origin/main has moved on.
      await first.runner.deliver({ sha: 'ccccccc' });
      const behind = setup({ root: first.dir, runningCommit: '1234567', now: () => new Date(2026, 9, 2, 12, 5, 0) });
      assert.equal(await behind.runner.resumePending(), 'started');
      assert.equal(behind.spawned.length, 1);
      assert.equal(behind.states[0].status, 'in_progress');
    } finally {
      first.cleanup();
    }
  });

  it('has nothing to resume without a queued push', async () => {
    const t = setup();
    try {
      assert.equal(await t.runner.resumePending(), 'none');
      assert.deepEqual(t.seq, []);
    } finally {
      t.cleanup();
    }
  });
});

// A step after the update that fails puts the running commit back, so the
// tree on disk matches the code in memory: the old server keeps serving its
// own frontend, and a crash or reboot starts the version that was running.
describe('the commit a failed deploy goes back to', () => {
  it('is the one this process runs, resolved to a full id', async () => {
    const t = setup({ runningCommit: '1234567' });
    try {
      await t.runner.deliver({ sha: 'abc1234' });
      assert.ok(t.seq.includes('git rev-parse --verify 1234567^{commit}'));
      assert.match(t.spawned[0].args[1], new RegExp('git reset --hard ' + RUNNING + ' && npm install --omit=dev'));
    } finally {
      t.cleanup();
    }
  });

  it('is HEAD when the running commit is unknown', async () => {
    const t = setup({ runningCommit: null });
    try {
      await t.runner.deliver({ sha: 'abc1234' });
      assert.ok(t.seq.includes('git rev-parse --verify HEAD^{commit}'));
      assert.match(t.spawned[0].args[1], new RegExp('git reset --hard ' + RUNNING));
    } finally {
      t.cleanup();
    }
  });

  it('is none when git cannot say, and the deploy goes ahead without one', async () => {
    const t = setup({
      git: async (args) => {
        if (args[0] !== 'rev-parse') return '';
        if (args[2] === 'origin/main^{commit}') return TARGET;
        throw new Error('fatal: Needed a single revision');
      }
    });
    try {
      assert.equal(await t.runner.deliver({ sha: 'abc1234' }), 'started');
      assert.doesNotMatch(t.spawned[0].args[1], /&& npm install --omit=dev; then/);
      assert.match(t.spawned[0].args[1], /"rolledBack":false/);
    } finally {
      t.cleanup();
    }
  });
});

// The chain's output used to go nowhere, so a refused deploy said which step
// stopped and never why.
describe('why a deploy stopped', () => {
  const LOG = [
    '== update',
    'HEAD is now at c0ffee0 Something',
    '== install',
    'up to date in 2s',
    '== preflight',
    '  MIGRATION LOST DATA:',
    '    batches: 100 rows before, 99 after',
    '  The running server has not been touched. Do not deploy.',
    '== rolling back',
    'HEAD is now at 1234567 What was running',
    'up to date in 1s',
    ''
  ].join('\n');

  it('picks the failed step’s own output, not the rollback after it', () => {
    assert.equal(
      stepOutput(LOG, 'preflight'),
      [
        '  MIGRATION LOST DATA:',
        '    batches: 100 rows before, 99 after',
        '  The running server has not been touched. Do not deploy.'
      ].join('\n')
    );
  });

  it('takes the end of the log when there is no step', () => {
    assert.match(stepOutput(LOG, undefined), /up to date in 1s$/);
  });

  it('keeps it short, and keeps credentials out', () => {
    const noisy = '== update\n' + 'x'.repeat(5000) + '\nfatal: https://bot:s3cret@github.com/x/y.git';
    const out = stepOutput(noisy, 'update');
    assert.ok(out.length <= 1500);
    assert.doesNotMatch(out, /s3cret/);
  });

  it('is in the record, with where the whole log is', async () => {
    const t = setup();
    try {
      await t.runner.deliver({ sha: 'abc1234' });
      fs.writeFileSync(path.join(t.dir, 'data', 'deploy.log'), LOG);
      const started = NOON().toISOString();
      t.setState({ status: 'failed', step: 'preflight', sha: TARGET, started, snapshot: NOON_SNAPSHOT });
      t.spawned[0].child.emit('exit', 1, null);
      assert.equal(t.state().step, 'preflight');
      assert.match(t.state().detail, /MIGRATION LOST DATA/);
      assert.doesNotMatch(t.state().detail, /What was running/);
      assert.equal(t.state().log, 'data/deploy.log');
    } finally {
      t.cleanup();
    }
  });
});
