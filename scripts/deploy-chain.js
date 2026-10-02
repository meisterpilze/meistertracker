'use strict';
// The command the GitHub webhook spawns to update this checkout in place, once
// scripts/deploy-runner.js has fetched origin/main and taken the snapshot of
// the database.
//
// It used to be assembled inline in server.js, and the only test of it was a
// hand-made copy of its shape. Built here, the tests run the very string the
// server spawns, with stand-ins for git, npm and pm2 on PATH.
//
// The steps, in order:
//
//   update     git reset --hard <the commit the runner fetched>
//   install    npm install --omit=dev
//   preflight  node scripts/preflight.js --quiet --db backups/<the snapshot>
//   restart    the success sentinel, then pm2 restart
//
// The preflight is the one update_server.sh runs (see scripts/preflight.js):
// the new migrations against a copy of the real data, and a load of every
// module the server loads. This path needs it more than that one does. Nobody
// is watching when it runs, so a migration that throws would leave pm2
// restarting a server that cannot start. It is pointed at the snapshot the
// runner has just taken, not at the live database: nothing in the chain opens
// the file the old server is serving from, so nothing in it can overlap an
// admin's restore of that file. A tree without the script skips the step, as
// update_server.sh does. The chain is built by the version that is running and
// executes the version that arrives, so a step that insisted on a file a new
// version had dropped would refuse every deploy after it.
//
// A step that fails writes the failed sentinel with its own name in "step" and
// ends the chain with exit 1. pm2 restart is the last step, so after a failure
// it never runs: the old server keeps serving the code it has loaded, and new
// migrations never meet a database that has no fresh snapshot.
//
// From the update step on, though, the working tree and node_modules are
// already the new version. Left like that, the old process went on serving the
// refused version's frontend from disk (index.html, app.js and the rest are
// read per request, and the phones reload when their build changes), talking
// to its own old API, and the next crash or reboot started the refused backend
// and ran the migrations the preflight had just refused. So a failure at
// update, install or preflight puts back the commit that is running
// (git reset --hard <it> && npm install --omit=dev), and the record says
// whether that worked, in "rolledBack". The restart step does not roll back:
// a pm2 restart that reports failure may still have started the new server,
// and resetting the tree under it would be worse than leaving it.
//
// ── Quoting ────────────────────────────────────────────────────────────────
//
// Every value on the command line is generated or whitelisted, or a path of the
// running installation; none comes from the request. The commit is the one the
// runner resolved origin/main to, held to 40 hex digits here; started and the
// snapshot name are generated and checked; the PM2 name is held to the charset
// server.js enforces at start-up.
//
// The paths are quoted per shell. bash gets them in single quotes, where
// nothing is special, with the usual '\'' for a quote inside one, so any path
// survives. cmd.exe has nothing like that: inside double quotes it still
// expands %NAME%, and a double quote ends the string. Windows does not allow "
// in a file name, so refusing a path with % or a line break costs no working
// install anything, and a refused deploy says why instead of running a command
// that means something else.
//
// Each step prints a marker line first ("== update", ...; "== rolling back"
// before a rollback), so the runner can pick a failed step's own output out
// of the log the chain writes to.
//
// On Windows the line only survives at all if it is spawned with
// windowsVerbatimArguments; see the comment in scripts/deploy-runner.js.

const { PRE_UPDATE_SNAPSHOT_FILENAME } = require('./rotate-backups.js');

// What the "step" of a failed sentinel written by the chain can say, in the
// order the steps run. The runner adds its own: fetch, snapshot and prepare.
const STEPS = ['update', 'install', 'preflight', 'restart'];

const SHA = /^[a-f0-9]{40}$/;
// The commit to go back to, as the runner resolved it; null when it is unknown.
const ROLLBACK = SHA;
const STARTED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const PM2_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const CMD_UNQUOTABLE = /["%\r\n]/;
// What an unquoted `echo` on a cmd.exe line would treat as syntax. The
// sentinels are built from the checked values above and cannot contain any of
// it; this makes sure they never do.
const CMD_OPERATORS = /[&|<>^()%!\r\n]/;

function shQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function cmdQuote(s, what) {
  if (CMD_UNQUOTABLE.test(s)) {
    throw new Error(what + ' contains a character cmd.exe cannot quote (", % or a line break)');
  }
  return '"' + s + '"';
}

/**
 * The deploy chain for one webhook delivery.
 *
 * @param {object} o
 * @param {string} o.platform   process.platform
 * @param {string} o.dir        the checkout to update; the chain runs there
 * @param {string} o.node       the node binary, normally process.execPath
 * @param {string} o.stateFile  the deploy-state sentinel
 * @param {string} o.sha        the commit to deploy: what origin/main pointed at after the fetch
 * @param {string} o.started    ISO time of the delivery; ties the sentinels to this attempt
 * @param {string} o.snapshot   the snapshot's file name under backups/, taken by the runner
 * @param {string} o.pm2Name    the PM2 process to restart
 * @param {string|null} [o.rollback] the commit to put back when a step after the update fails
 * @returns {{command: string, args: string[]}} what to spawn
 */
function buildDeployChain(o) {
  if (!SHA.test(String(o.sha))) throw new Error('sha is not a full commit id');
  if (!STARTED.test(String(o.started))) throw new Error('started is not an ISO timestamp');
  if (!PRE_UPDATE_SNAPSHOT_FILENAME.test(String(o.snapshot)))
    throw new Error('snapshot is not a pre-update snapshot name');
  if (!PM2_NAME.test(String(o.pm2Name))) throw new Error('pm2Name has characters outside [A-Za-z0-9_-]');
  if (o.rollback != null && !ROLLBACK.test(String(o.rollback))) throw new Error('rollback is not a full commit id');
  for (const k of ['dir', 'node', 'stateFile']) {
    if (typeof o[k] !== 'string' || !o[k]) throw new Error(k + ' is required');
  }

  const record = (status, step, rolledBack) =>
    JSON.stringify(
      Object.assign(
        { status },
        step ? { step } : {},
        { sha: o.sha, started: o.started, snapshot: o.snapshot },
        rolledBack === undefined ? {} : { rolledBack }
      )
    );
  const putBack = o.rollback ? 'git reset --hard ' + o.rollback + ' && npm install --omit=dev' : null;

  if (o.platform === 'win32') {
    const state = cmdQuote(o.stateFile, 'stateFile');
    const node = cmdQuote(o.node, 'node');
    const echo = (json) => {
      if (CMD_OPERATORS.test(json)) throw new Error('sentinel would not survive cmd.exe: ' + json);
      return 'echo ' + json + ' > ' + state;
    };
    const fail = (step) => '(' + echo(record('failed', step)) + ' & exit 1)';
    // A failure after the update: put the running commit back, then say how
    // that went. Either echo ends the group; the exit is outside it.
    const failBack = (step) =>
      putBack
        ? '(((echo == rolling back& ' +
          putBack +
          ' && ' +
          echo(record('failed', step, true)) +
          ') || ' +
          echo(record('failed', step, false)) +
          ') & exit 1)'
        : '(' + echo(record('failed', step, false)) + ' & exit 1)';
    // `&` between the steps, not `&&`: each step ends the process itself when
    // it fails, so the line never has to rely on what cmd.exe reports for an
    // `if exist` whose condition was false.
    const line = [
      'cd /d ' + cmdQuote(o.dir, 'dir') + ' || exit 1',
      'echo == update',
      '(git reset --hard ' + o.sha + ' || ' + failBack('update') + ')',
      'echo == install',
      '(npm install --omit=dev || ' + failBack('install') + ')',
      'echo == preflight',
      '(if exist scripts\\preflight.js (' +
        node +
        ' scripts\\preflight.js --quiet --db "backups\\' +
        o.snapshot +
        '" || ' +
        failBack('preflight') +
        '))',
      'echo == restart',
      '(' + echo(record('success')) + ' && pm2 restart ' + o.pm2Name + ' --update-env || ' + fail('restart') + ')'
    ].join(' & ');
    return { command: 'cmd.exe', args: ['/c', line] };
  }

  const state = shQuote(o.stateFile);
  const node = shQuote(o.node);
  const write = (json) => "printf '%s' " + shQuote(json) + ' > ' + state;
  const fail = (step) => '{ ' + write(record('failed', step)) + '; exit 1; }';
  const failBack = (step) =>
    putBack
      ? "{ echo '== rolling back'; if " +
        putBack +
        '; then ' +
        write(record('failed', step, true)) +
        '; else ' +
        write(record('failed', step, false)) +
        '; fi; exit 1; }'
      : '{ ' + write(record('failed', step, false)) + '; exit 1; }';
  const script = [
    'cd ' + shQuote(o.dir) + ' || exit 1',
    "echo '== update'",
    'git reset --hard ' + o.sha + ' || ' + failBack('update'),
    "echo '== install'",
    'npm install --omit=dev || ' + failBack('install'),
    "echo '== preflight'",
    'if [ -f scripts/preflight.js ]; then ' +
      node +
      ' scripts/preflight.js --quiet --db ' +
      shQuote('backups/' + o.snapshot) +
      ' || ' +
      failBack('preflight') +
      '; fi',
    "echo '== restart'",
    write(record('success')) + ' && pm2 restart ' + o.pm2Name + ' --update-env || ' + fail('restart')
  ].join('\n');
  return { command: 'bash', args: ['-c', script] };
}

module.exports = { buildDeployChain, STEPS };
