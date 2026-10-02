'use strict';
// The GitHub auto-deploy spawns a shell command built by string concatenation:
// a quoted `cd`, the update steps, JSON echoed into a quoted path, and a failed
// sentinel for every step that can go wrong. On Windows that string only
// survives if it is passed to cmd.exe verbatim — Node's default argv escaping
// turns the quotes into \" , which cmd.exe cannot parse, so it exits 1 having run
// nothing at all. That failure is invisible: the deploy writes neither its
// success nor its failed sentinel, the files are never pulled, and the server
// keeps serving the previous release.
//
// These tests run the very command scripts/deploy-chain.js builds, under the
// shell it is built for, with stand-ins for git, npm, pm2 and the preflight on
// PATH. What happens before the chain (the fetch and the snapshot, both done by
// the server itself) is test/deploy-runner.test.js's business.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync: Database } = require('node:sqlite');
const deployChain = require('../scripts/deploy-chain.js');

const ROOT = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const PM2_NAME = 'meisterpilze-test';
const SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
// The commit the server runs, which the chain puts back when it fails.
const ROLLBACK = '0123456789abcdef0123456789abcdef01234567';
const STARTED = '2026-07-29T18:00:00.000Z';
const SNAPSHOT = 'meistertracker_20260729_200000.db';
const ROWS = 25;

// As it comes, on purpose: on the Windows runner this is an 8.3 short name
// (RUNNER~1), the kind of path the snapshot used to refuse.
const TMP = os.tmpdir();

function pathKey(env) {
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
}

// git, npm and pm2 as they look to the chain: each call is written to a log,
// and the one named in MT_STUB_FAIL (tool and first argument) exits 1.
function writeStubs(bin) {
  for (const tool of ['git', 'npm', 'pm2']) {
    if (isWin) {
      fs.writeFileSync(
        path.join(bin, tool + '.cmd'),
        [
          '@echo off',
          '>>"%MT_STUB_LOG%" echo ' + tool + ' %*',
          'if "%MT_STUB_FAIL%"=="' + tool + ' %1" exit /b 1',
          'exit /b 0',
          ''
        ].join('\r\n')
      );
    } else {
      const file = path.join(bin, tool);
      fs.writeFileSync(
        file,
        [
          '#!/bin/sh',
          'printf "%s\\n" "' + tool + ' $*" >> "$MT_STUB_LOG"',
          '[ "$MT_STUB_FAIL" = "' + tool + ' $1" ] && exit 1',
          'exit 0',
          ''
        ].join('\n')
      );
      fs.chmodSync(file, 0o755);
    }
  }
}

// A checkout the chain can run in: stand-ins on PATH and for the preflight
// (whose own behaviour is test/preflight.test.js's business), and the data
// directory the deploy-state sentinel lives in.
function makeCheckout(opts = {}) {
  const root = fs.mkdtempSync(path.join(TMP, 'mt chain '));
  const dir = opts.checkoutName ? path.join(root, opts.checkoutName) : root;
  if (dir !== root) fs.mkdirSync(dir);
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'data'));
  if (opts.preflight !== false) {
    fs.writeFileSync(
      path.join(dir, 'scripts', 'preflight.js'),
      [
        "'use strict';",
        "require('fs').appendFileSync(process.env.MT_STUB_LOG, 'preflight ' + process.argv.slice(2).join(' ') + '\\n');",
        "process.exit(process.env.MT_STUB_FAIL === 'preflight' ? 1 : 0);",
        ''
      ].join('\n')
    );
  }
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  writeStubs(bin);
  const dataDir = opts.oddDir ? path.join(dir, opts.oddDir) : path.join(dir, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  return {
    dir,
    bin,
    log: path.join(dir, 'stub.log'),
    stateFile: path.join(dataDir, 'deploy-state.json'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function chainFor(co, extra) {
  return deployChain.buildDeployChain({
    platform: process.platform,
    dir: co.dir,
    node: process.execPath,
    stateFile: co.stateFile,
    sha: SHA,
    started: STARTED,
    snapshot: SNAPSHOT,
    pm2Name: PM2_NAME,
    rollback: ROLLBACK,
    ...extra
  });
}

// Spawned with the options the runner uses, except that the output is kept for
// the assertion messages instead of being thrown away.
function run(co, opts = {}) {
  const chain = chainFor(co, opts.chain);
  const env = Object.assign({}, process.env, { MT_STUB_LOG: co.log, MT_STUB_FAIL: opts.fail || '' });
  const key = pathKey(env);
  env[key] = co.bin + path.delimiter + env[key];
  return new Promise((resolve, reject) => {
    const child = spawn(chain.command, chain.args, {
      cwd: co.dir,
      detached: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments: opts.verbatim !== false
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, chain }));
  });
}

function calls(co) {
  if (!fs.existsSync(co.log)) return [];
  return fs
    .readFileSync(co.log, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function state(co) {
  return JSON.parse(fs.readFileSync(co.stateFile, 'utf8'));
}

function rowsIn(file) {
  const d = new Database(file, { readOnly: true });
  try {
    return d.prepare('SELECT COUNT(*) AS c FROM ansatz').get().c;
  } finally {
    d.close();
  }
}

const RESET = 'git reset --hard ' + SHA;
const INSTALL = 'npm install --omit=dev';
const PREFLIGHT = 'preflight --quiet --db ' + (isWin ? 'backups\\' : 'backups/') + SNAPSHOT;
const RESTART = 'pm2 restart ' + PM2_NAME + ' --update-env';
const PUT_BACK = 'git reset --hard ' + ROLLBACK;

describe('the deploy chain the webhook spawns', () => {
  it('updates to the fetched commit, installs, checks the snapshot and restarts', async () => {
    const co = makeCheckout();
    try {
      const r = await run(co);
      assert.equal(r.code, 0, r.out);
      assert.deepEqual(calls(co), [RESET, INSTALL, PREFLIGHT, RESTART]);
      assert.deepEqual(state(co), { status: 'success', sha: SHA, started: STARTED, snapshot: SNAPSHOT });
      const markers = r.out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('== '));
      assert.deepEqual(
        markers,
        ['== update', '== install', '== preflight', '== restart'],
        'the step markers the log is read by'
      );
    } finally {
      co.cleanup();
    }
  });

  // A step after the update that fails puts the running commit back, so the
  // tree on disk matches the code in memory again. The stand-ins fail every
  // call that matches, so a failing reset or install fails its rollback too,
  // and the record says so.
  for (const [step, fail, ran, rolledBack] of [
    ['update', 'git reset', [RESET, PUT_BACK], false],
    ['install', 'npm install', [RESET, INSTALL, PUT_BACK, INSTALL], false],
    // The migrations would fail, or lose rows, against this database: the
    // old server has to keep running rather than restart into that.
    ['preflight', 'preflight', [RESET, INSTALL, PREFLIGHT, PUT_BACK, INSTALL], true]
  ]) {
    it('stops before the restart when the ' + step + ' step fails, and puts the running commit back', async () => {
      const co = makeCheckout();
      try {
        const r = await run(co, { fail });
        assert.equal(r.code, 1, r.out);
        assert.deepEqual(calls(co), ran);
        assert.ok(r.out.includes('== rolling back'), 'no rollback marker in the output');
        assert.deepEqual(state(co), {
          status: 'failed',
          step,
          sha: SHA,
          started: STARTED,
          snapshot: SNAPSHOT,
          rolledBack
        });
      } finally {
        co.cleanup();
      }
    });
  }

  it('says so when it does not know the commit to put back', async () => {
    const co = makeCheckout();
    try {
      const r = await run(co, { fail: 'preflight', chain: { rollback: null } });
      assert.equal(r.code, 1, r.out);
      assert.deepEqual(calls(co), [RESET, INSTALL, PREFLIGHT]);
      assert.equal(state(co).rolledBack, false);
    } finally {
      co.cleanup();
    }
  });

  it('records a restart that pm2 refused as failed, not as the success written before it', async () => {
    const co = makeCheckout();
    try {
      const r = await run(co, { fail: 'pm2 restart' });
      assert.equal(r.code, 1, r.out);
      assert.deepEqual(calls(co), [RESET, INSTALL, PREFLIGHT, RESTART]);
      assert.equal(state(co).status, 'failed');
      assert.equal(state(co).step, 'restart');
      assert.equal(
        'rolledBack' in state(co),
        false,
        'a restart failure must not reset the tree under a starting server'
      );
    } finally {
      co.cleanup();
    }
  });

  // The chain is built by the running version and runs the arriving one. If
  // that one has no preflight, refusing would refuse every deploy after it.
  it('skips the preflight when the new tree has none, as update_server.sh does', async () => {
    const co = makeCheckout({ preflight: false });
    try {
      const r = await run(co);
      assert.equal(r.code, 0, r.out);
      assert.deepEqual(calls(co), [RESET, INSTALL, RESTART]);
      assert.equal(state(co).status, 'success');
    } finally {
      co.cleanup();
    }
  });

  // Paths come from the installation, not the request, but they still reach
  // the shell. Everything here is literal inside the quoting each branch uses.
  it('carries paths with spaces, quotes and shell syntax through unchanged', async () => {
    const co = makeCheckout({ oddDir: isWin ? 'odd (dir) & co ^x' : "odd it's $HOME `x` (dir) & co" });
    try {
      const r = await run(co);
      assert.equal(r.code, 0, r.out);
      assert.equal(state(co).status, 'success');
    } finally {
      co.cleanup();
    }
  });

  it('updates a checkout whose path has an umlaut, brackets, an ampersand and a quote', async () => {
    const co = makeCheckout({ checkoutName: "Beispielhöfe (neu) & Co's" });
    try {
      const r = await run(co);
      assert.equal(r.code, 0, r.out);
      assert.deepEqual(calls(co), [RESET, INSTALL, PREFLIGHT, RESTART]);
      assert.equal(state(co).status, 'success');
    } finally {
      co.cleanup();
    }
  });

  // Guards the reason for windowsVerbatimArguments: without it Node escapes the
  // quotes and cmd.exe bails before running a single step, leaving no sentinel
  // behind. If this ever starts passing, Node changed its escaping and the
  // comment in scripts/deploy-runner.js should be revisited — but the verbatim
  // flag stays correct either way.
  it(
    'without the verbatim flag cmd.exe bails and writes no sentinel',
    { skip: isWin ? false : 'Windows-only (cmd.exe quoting)' },
    async () => {
      const co = makeCheckout();
      try {
        const r = await run(co, { verbatim: false });
        assert.notEqual(r.code, 0, 'cmd.exe cannot parse backslash-escaped quotes');
        assert.equal(fs.existsSync(co.stateFile), false, 'neither sentinel is written — the silent failure');
        assert.deepEqual(calls(co), []);
      } finally {
        co.cleanup();
      }
    }
  );
});

describe('what the chain builder refuses', () => {
  const base = {
    platform: 'linux',
    dir: '/srv/meistertracker',
    node: '/usr/bin/node',
    stateFile: '/srv/meistertracker/data/deploy-state.json',
    sha: SHA,
    started: STARTED,
    snapshot: SNAPSHOT,
    pm2Name: PM2_NAME
  };
  const win = Object.assign({}, base, {
    platform: 'win32',
    dir: 'C:\\meistertracker',
    node: 'C:\\Program Files\\nodejs\\node.exe',
    stateFile: 'C:\\meistertracker\\data\\deploy-state.json'
  });
  const build = (patch, from = base) => deployChain.buildDeployChain(Object.assign({}, from, patch));

  it('anything but the full commit id the runner resolved', () => {
    assert.throws(() => build({ sha: 'deadbeef' }), /sha/);
    assert.throws(() => build({ sha: SHA + '; pm2 kill' }), /sha/);
    assert.throws(() => build({ sha: '$(id)' }, win), /sha/);
    assert.throws(() => build({ sha: 'unknown' }), /sha/);
  });

  it('a timestamp, a snapshot name or a PM2 name that was not generated or whitelisted', () => {
    assert.throws(() => build({ started: '2026-07-29 & calc' }), /started/);
    assert.throws(() => build({ snapshot: '../../meistertracker.db' }), /snapshot/);
    const { preUpdateSnapshotName } = require('../scripts/rotate-backups.js');
    assert.doesNotThrow(() => build({ snapshot: preUpdateSnapshotName(new Date()) }), 'refuses the runner’s own name');
    assert.throws(() => build({ snapshot: 'meistertracker_20260729_2000.db' }), /snapshot/);
    assert.throws(() => build({ pm2Name: 'meisterpilze --watch' }), /pm2Name/);
    assert.throws(() => build({ rollback: 'HEAD; pm2 kill' }), /rollback/);
    assert.throws(() => build({ rollback: 'abc1234' }), /rollback/);
    assert.doesNotThrow(() => build({ rollback: null }));
  });

  it('a path cmd.exe cannot quote, and nothing that bash can', () => {
    assert.throws(() => build({ dir: 'C:\\100%PATH%\\meistertracker' }, win), /dir.*cmd\.exe/);
    assert.throws(() => build({ dir: 'C:\\a"b' }, win), /dir.*cmd\.exe/);
    assert.throws(() => build({ stateFile: 'C:\\a\nb' }, win), /stateFile/);
    assert.doesNotThrow(() => build({ dir: '/srv/100%PATH%/x "y" $z' }));
  });

  it('a missing value', () => {
    for (const k of ['dir', 'node', 'stateFile']) {
      assert.throws(() => build({ [k]: '' }), new RegExp(k));
    }
  });
});

// Neither shell is needed to read the Windows line, so its shape is checked on
// every platform, not only where cmd.exe exists.
describe('the cmd.exe line', () => {
  const chain = deployChain.buildDeployChain({
    platform: 'win32',
    dir: 'C:\\Labor (neu) & Co\\meistertracker',
    node: 'C:\\Program Files\\nodejs\\node.exe',
    stateFile: 'C:\\Labor (neu) & Co\\meistertracker\\data\\deploy-state.json',
    sha: SHA,
    started: STARTED,
    snapshot: SNAPSHOT,
    pm2Name: PM2_NAME,
    rollback: ROLLBACK
  });
  const line = chain.args[1];

  it('is one argument to cmd.exe /c', () => {
    assert.equal(chain.command, 'cmd.exe');
    assert.deepEqual(chain.args.slice(0, 1), ['/c']);
    assert.equal(chain.args.length, 2);
    assert.doesNotMatch(line, /[\r\n]/);
  });

  it('updates to the fetched commit, checks the snapshot, and restarts last', () => {
    const at = (s) => line.indexOf(s);
    assert.ok(at('git reset --hard ' + SHA) > 0);
    assert.ok(at('git reset --hard') < at('npm install'));
    assert.ok(at('npm install') < at('if exist scripts\\preflight.js ('));
    assert.ok(at('scripts\\preflight.js --quiet --db "backups\\' + SNAPSHOT + '"') < at('pm2 restart'));
    assert.equal(line.split('pm2 restart').length, 2, 'exactly one restart');
  });

  it('puts the running commit back after update, install and preflight, and only there', () => {
    const groups = line.split(' & (');
    const putsBack = groups.filter((g) => g.includes('git reset --hard ' + ROLLBACK)).length;
    assert.equal(putsBack, 3);
    const restart = groups.find((g) => g.includes('pm2 restart'));
    assert.ok(!restart.includes(ROLLBACK), 'the restart step must not reset the tree');
  });

  // The fetch and the snapshot are the server's own steps now; the chain must
  // not repeat them, and must not touch the live database.
  it('neither fetches nor opens the live database', () => {
    assert.doesNotMatch(line, /git fetch/);
    assert.doesNotMatch(line, /backup-db\.js/);
    const databases = line.match(/[\w.-]+\.db\b/g);
    assert.ok(databases.length > 0);
    assert.ok(
      databases.every((f) => f === SNAPSHOT),
      'only the snapshot may be named: ' + databases.join(', ')
    );
  });

  it('writes sentinels that are JSON, each failure naming its step', () => {
    const records = [...line.matchAll(/echo (\{[^}]*\}) > /g)].map((m) => JSON.parse(m[1]));
    assert.deepEqual(
      records.map((r) => r.status + (r.step ? ':' + r.step : '') + ('rolledBack' in r ? ':' + r.rolledBack : '')),
      [
        'failed:update:true',
        'failed:update:false',
        'failed:install:true',
        'failed:install:false',
        'failed:preflight:true',
        'failed:preflight:false',
        'success',
        'failed:restart'
      ]
    );
    assert.deepEqual(
      [...new Set(records.filter((r) => r.step).map((r) => r.step))],
      deployChain.STEPS,
      'STEPS is what a failed sentinel from the chain can name'
    );
    for (const r of records) {
      assert.equal(r.sha, SHA);
      assert.equal(r.started, STARTED);
      assert.equal(r.snapshot, SNAPSHOT);
    }
  });
});

const hash = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : null);

// START.bat runs scripts/backup-db.js while the old server is still up, holding
// the database open in WAL mode and possibly in the middle of a write. It has to
// get a consistent copy anyway, and it must not write to the live file, block
// the writer, or leave anything behind that the old server would trip over.
describe('backup-db.js while the old server still has the database open', () => {
  let dir, src, live;

  before(() => {
    dir = fs.mkdtempSync(path.join(TMP, 'mt-live-'));
    src = path.join(dir, 'meistertracker.db');
    live = new Database(src);
    // What openDb() sets on the server's own handle.
    live.exec('PRAGMA journal_mode = WAL');
    live.exec('PRAGMA busy_timeout = 5000');
    live.exec('PRAGMA wal_autocheckpoint = 1000');
    live.exec('CREATE TABLE ansatz (id INTEGER PRIMARY KEY, rh REAL)');
    for (let i = 0; i < ROWS; i++) live.prepare('INSERT INTO ansatz(rh) VALUES(?)').run(60 + i);
  });

  after(() => {
    try {
      live.close();
    } catch {
      /* the directory goes either way */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('copies what is committed, leaves the live file alone, and does not hold up the writer', () => {
    // A write in flight: begun, not committed.
    live.exec('BEGIN IMMEDIATE');
    live.prepare('INSERT INTO ansatz(rh) VALUES(?)').run(-1);
    const before = { db: hash(src), wal: hash(src + '-wal') };
    assert.ok(before.wal, 'the fixture must have its rows in the WAL');

    const dest = path.join(dir, 'snapshot.db');
    execFileSync(process.execPath, ['--no-warnings', path.join(ROOT, 'scripts', 'backup-db.js'), src, dest], {
      encoding: 'utf8',
      timeout: 30_000
    });

    assert.deepEqual({ db: hash(src), wal: hash(src + '-wal') }, before, 'the live database was written to');
    live.exec('COMMIT');
    live.prepare('INSERT INTO ansatz(rh) VALUES(?)').run(99);
    assert.equal(live.prepare('SELECT COUNT(*) AS c FROM ansatz').get().c, ROWS + 2, 'the writer was held up');

    assert.equal(rowsIn(dest), ROWS, 'committed rows only — not the write that was still open');
    const d = new Database(dest, { readOnly: true });
    try {
      assert.equal(d.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally {
      d.close();
    }
    assert.equal(fs.existsSync(dest + '-wal'), false, 'the snapshot is a single file');
  });
});

// The real preflight, called the way the chain calls it: against the snapshot
// the server has just taken, never against the live file.
describe('the preflight against the snapshot', () => {
  let dir, snapshot;

  before(() => {
    dir = fs.mkdtempSync(path.join(TMP, 'mt-pf-snap-'));
    const db = require('../db.js');
    const live = db.openDb(path.join(dir, 'meistertracker.db'));
    db.createUser(live, 'admin.one', 'a reasonable password', 'admin');
    fs.mkdirSync(path.join(dir, 'backups'));
    snapshot = path.join(dir, 'backups', SNAPSHOT);
    db.backupDb(live, snapshot);
    live.close();
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('passes, and leaves the snapshot as it was', () => {
    const before = hash(snapshot);
    const r = spawnSync(process.execPath, ['--no-warnings', 'scripts/preflight.js', '--quiet', '--db', snapshot], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000
    });
    assert.equal(r.status, 0, 'preflight refused:\n' + r.stdout + r.stderr);
    assert.equal(hash(snapshot), before, 'the snapshot was written to');
    assert.equal(fs.existsSync(snapshot + '-wal'), false);
  });
});

describe('server.js hands the deploy to the runner', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const hook = src.slice(src.indexOf("req.url === '/api/webhook/github'"), src.indexOf('// -- Notifications'));

  it('builds no chain of its own', () => {
    assert.match(hook, /deploys\.deliver\(/);
    assert.doesNotMatch(hook, /git reset --hard|spawn\(/, 'a second copy of the chain in server.js would drift');
  });
});
