'use strict';
// Why pm2 must never be started with administrator rights, and how START.bat
// makes sure of it.
//
// pm2 talks to its daemon over \\.\pipe\rpc.sock. Whoever starts pm2 first
// decides who owns everything it creates: the daemon, the server it runs, and
// that pipe. A named pipe gives full access to its creator's owner and read
// access to everyone else, and an administrator token's owner is
// Administrators — which an ordinary window holds only as deny-only. So an
// ordinary START.bat window could read pm2's pipe but not send it a command,
// and could not stop the server either.
//
// The boot task registered by install-autostart.ps1 is where that comes from.
// It runs START.bat through an S4U logon, and Windows does not apply the task's
// RunLevel to S4U: registered Limited, the boot run still gets the full
// administrator token. Files it wrote came out owned by Administrators, and its
// processes refused an ordinary window even a query.
//
// What that looked like: the first START.bat after every restart printed
//
//     -> Killing stale process on port 3000 (PID 15628)...
//
// and then either a pm2 stack trace (`connect EPERM //./pipe/rpc.sock`) or,
// later, an error naming the wrong cause. Two earlier fixes aimed at the wrong
// thing — registering the task Limited, and asking the scheduler to end a task
// that had long finished — and the server kept serving whatever it booted with.
//
// What is pinned below: an elevated run hands itself to scripts\unelevated.ps1,
// which runs it again as a standard user; nothing talks to pm2 before START.bat
// has asked whether it can; and the kill is still checked rather than assumed.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync, execFile } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PS1 = fs.readFileSync(path.join(ROOT, 'install-autostart.ps1'), 'utf8');
const BAT = fs.readFileSync(path.join(ROOT, 'START.bat'), 'utf8');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HELPER = path.join(ROOT, 'scripts', 'unelevated.ps1');
const PROBE = path.join(ROOT, 'scripts', 'pm2-access.ps1');
const HELPER_SRC = fs.readFileSync(HELPER, 'utf8');

const isWin = process.platform === 'win32';

// START.bat without its comments, so a REM that mentions a command does not
// count as running it.
const CODE = BAT.split(/\r?\n/)
  .filter((line) => !/^\s*REM\b/i.test(line))
  .join('\n');

function tmpName(tag) {
  return 'mt_' + tag + '_' + process.pid + '_' + Math.random().toString(36).slice(2);
}

describe('the boot task', () => {
  it('still starts without a login, which is the whole point of the task', () => {
    // S4U is what lets it run as this user with the profile loaded and no
    // stored password.
    assert.match(PS1, /-LogonType\s+S4U/);
    assert.match(PS1, /New-ScheduledTaskTrigger\s+-AtStartup/);
  });

  it('points at the script that really drops the rights, and that script exists', () => {
    // RunLevel Limited does nothing for S4U. The installer must not go back to
    // implying it does.
    assert.match(PS1, /scripts\\unelevated\.ps1/, 'install-autostart.ps1 no longer says where the rights are dropped');
    assert.ok(fs.existsSync(HELPER), 'scripts/unelevated.ps1 is gone');
  });
});

describe('START.bat drops administrator rights before anything can start pm2', () => {
  it('hands an elevated run to scripts\\unelevated.ps1 before the first pm2 command', () => {
    const helper = CODE.indexOf('scripts\\unelevated.ps1');
    const firstPm2 = CODE.search(/call pm2 /);
    assert.ok(helper !== -1, 'START.bat no longer calls scripts\\unelevated.ps1');
    assert.ok(firstPm2 !== -1 && helper < firstPm2, 'a pm2 command runs before the rights are dropped');
  });

  it('only when it is elevated and has nothing to install', () => {
    // Installing Node.js or Git through winget is the one thing that needs the
    // rights; a run that has to do that keeps them.
    const block = CODE.slice(CODE.indexOf('if "%~3"=="--unelevated"'), CODE.indexOf('scripts\\unelevated.ps1'));
    for (const check of [':check_admin', ':check_node', ':check_git']) {
      assert.ok(block.includes('call ' + check), 'the hand-over does not ask ' + check + ' first');
    }
  });

  it('asks fltmc whether it is elevated, not net session', () => {
    // net session answers "not elevated" whenever the Server service is not
    // running — and a run that thinks it is not elevated keeps its rights.
    const label = CODE.slice(CODE.indexOf('\n:check_admin'));
    assert.match(label.slice(0, 80), /fltmc >nul 2>&1/);
  });

  it('cannot hand itself over twice', () => {
    assert.match(CODE, /set "UNELEVATED_ARGS=[^\n]*--unelevated/, 'the second run is not marked');
    assert.match(CODE, /if "%~3"=="--unelevated" \(/, 'a marked run is not recognised');
  });

  it('carries on with its rights when the helper never started the second run', () => {
    // A boot that ends without a server is worse than one with the wrong rights.
    assert.match(CODE, /type nul > "!UNELEVATED_MARK!"/, 'no marker is left for the second run to remove');
    assert.match(
      CODE,
      /if defined UNELEVATED_MARK del "!UNELEVATED_MARK!"/,
      'the second run does not remove the marker'
    );
    assert.match(CODE, /if exist "!UNELEVATED_MARK!" \(/, 'nobody looks at the marker afterwards');
  });

  it('keeps exit /b the last command of every block around it', () => {
    // Anything after `exit /b` in the same block — even a line that never runs —
    // makes cmd /c exit 0. Phase 1 then takes a failed second run for a good
    // one and closes the window instead of pausing on the error.
    const after = CODE.slice(CODE.indexOf('exit /b !UNELEVATED_RC!'));
    const next = after
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4);
    assert.deepEqual(next, [')', ')', ')', ')'], 'something follows exit /b inside its blocks');
  });

  it('builds the restricted token the way an ordinary window has it', () => {
    assert.match(HELPER_SRC, /CreateRestrictedToken/);
    assert.match(HELPER_SRC, /LUA_TOKEN/);
    assert.match(HELPER_SRC, /"S-1-5-32-544"/, 'Administrators is not made deny-only');
    assert.match(HELPER_SRC, /S-1-16-8192/, 'the integrity level is not lowered to medium');
    // The owner is what pm2's pipe grants full access to; without it the
    // pipe stays out of reach even with the rights dropped.
    assert.match(HELPER_SRC, /SetPointer\(restricted, TokenOwner/, 'the owner is not set');
    assert.match(HELPER_SRC, /SetPointer\(restricted, TokenDefaultDacl/, 'the default DACL is not set');
    assert.match(HELPER_SRC, /Invoke-AsIs/, 'there is no fallback when the rights cannot be dropped');
  });
});

describe('START.bat asks whether it can reach pm2 before the first pm2 command', () => {
  it('runs no pm2 command before step 5 — not even pm2 --version', () => {
    // Every pm2 command, --version included, connects to the daemon first and
    // starts one when it cannot. Against a daemon it could not reach, that left
    // a second daemon behind on every run.
    assert.equal(/pm2 --version/.test(CODE), false, 'pm2 --version is back');
    const step5 = CODE.indexOf('[5/5]');
    const probe = CODE.indexOf('scripts\\pm2-access.ps1');
    const firstPm2 = CODE.search(/call pm2 /);
    assert.ok(step5 !== -1 && step5 < probe, 'the pm2 check is not in step 5');
    assert.ok(probe < firstPm2, 'a pm2 command runs before the check');
  });

  it('stops on a daemon it cannot reach, and names the fix', () => {
    const from = CODE.indexOf('if "!PM2_ACCESS!"=="denied"');
    assert.ok(from !== -1, 'nothing acts on a refused pipe');
    const branch = CODE.slice(from, CODE.indexOf('exit /b 1', from));
    assert.match(branch, /pm2\.cmd" kill/, 'the fix is not named');
    assert.match(branch, /Administrator/, 'it does not say the fix needs elevation');
    assert.match(branch, /meistertracker-unelevated\.log/, 'it does not say where the boot run wrote down why');
    assert.equal(/call pm2 /.test(branch), false, 'the refused branch still calls pm2');
  });
});

describe('START.bat does not pretend the kill worked', () => {
  it('stops the server through pm2 before killing anything on the port', () => {
    // A process pm2 runs, killed from outside, is one pm2 starts straight back up.
    const step5 = CODE.slice(CODE.indexOf('[5/5]'));
    const del = step5.indexOf('call pm2 delete');
    const kill = step5.indexOf('taskkill /PID');
    assert.ok(del !== -1 && kill !== -1 && del < kill, 'the port is cleared before pm2 is asked');
  });

  it('re-checks the port after killing, rather than assuming', () => {
    const step5 = CODE.slice(CODE.indexOf('[5/5]'));
    assert.match(step5, /set "PORT_HOLDER="/, 'nothing re-reads the port after taskkill');
    assert.match(step5, /if defined PORT_HOLDER/, 'the re-read result is never tested');
  });

  it('stops there instead of walking into pm2', () => {
    const held = CODE.slice(CODE.indexOf('if defined PORT_HOLDER'));
    const stop = held.indexOf('exit /b 1');
    const pm2 = held.indexOf('pm2 start');
    assert.ok(stop !== -1, 'a refused kill no longer aborts the run');
    assert.ok(
      pm2 === -1 || stop < pm2,
      'START.bat still reaches pm2 start after failing to free the port, which is the EPERM path'
    );
  });

  it('names what holds the port and how to stop it', () => {
    const from = CODE.indexOf('if defined PORT_HOLDER');
    const held = CODE.slice(from, CODE.indexOf('exit /b 1', from));
    assert.ok(held.length > 0, 'der Abbruchzweig ist fort');
    assert.match(held, /tasklist/, 'the program holding the port is not named');
    assert.match(held, /Stop-Process -Id/, 'the fix is not named');
    assert.match(held, /Administrator/, 'it does not say the fix needs elevation');
  });

  it('no longer asks the scheduler, which could not have helped', () => {
    // The task has finished by the time anyone runs START.bat — it only starts
    // pm2 — and an ordinary account may read it, not end it.
    assert.equal(/schtasks/i.test(CODE), false, 'schtasks is back in START.bat');
  });

  it('leaves worktree runs alone — they never touch the production port', () => {
    const step5 = CODE.slice(CODE.indexOf('[5/5]'));
    const guard = step5.indexOf('if "%WORKTREE_MODE%"=="1" (');
    const otherwise = step5.indexOf(') else (', guard);
    const kill = step5.indexOf('taskkill /PID');
    const check = step5.indexOf('set "PORT_HOLDER="');
    assert.ok(guard !== -1 && otherwise !== -1, 'the port clean-up is not gated on production mode');
    assert.ok(otherwise < kill && otherwise < check, 'the kill or the re-check runs in worktree mode too');
  });
});

describe('nothing in the server needs the elevation that is dropped', () => {
  it('port 80 is a convenience, and its failure is already handled', () => {
    // Binding 80 is the only privileged-looking thing the server does; Windows
    // permits it unprivileged, and if it ever is refused the server has to
    // carry on rather than exit — otherwise dropping elevation would turn a
    // redirect into a boot failure.
    const near = SRV.slice(SRV.indexOf('HTTP_REDIRECT_PORT'), SRV.indexOf('HTTP_REDIRECT_PORT') + 1600);
    assert.match(near, /\.on\('error'/, 'the port-80 listener has no error handler');
    assert.match(near, /EACCES/, 'a refused port 80 is not handled');
    assert.match(near, /EADDRINUSE/, 'a taken port 80 is not handled');
    assert.equal(/process\.exit/.test(near), false, 'a failed port-80 bind must not end the process');
  });

  it('START.bat itself runs no administrator-only command', () => {
    const forbidden = [/\bnetsh\b/i, /\bsc\s+(create|config|start)\b/i, /\breg\s+add\b/i, /\bicacls\b/i, /setx\s+\/m/i];
    const hits = forbidden.filter((re) => re.test(CODE)).map((re) => String(re));
    assert.deepEqual(hits, [], 'START.bat gained a command that needs elevation:\n  ' + hits.join('\n  '));
  });
});

describe('on Windows, for real', { skip: isWin ? false : 'Windows-only (tokens, named pipes, cmd.exe)' }, () => {
  function powershell(args, env) {
    return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
      env: { ...process.env, ...env },
      input: '', // closed stdin, like the boot task's NUL
      encoding: 'utf8',
      timeout: 90000,
      windowsHide: true
    });
  }

  it('unelevated.ps1 leaves the child and its children an ordinary token', () => {
    // -Force takes the real path although this test runs unelevated. What
    // survives DISABLE_MAX_PRIVILEGE is a single privilege, where an ordinary
    // window has five — so a match proves the restricted token was used. The
    // pause proves a closed stdin does not leave the boot run hanging.
    const r = powershell(['-File', HELPER, '-Force'], {
      UNELEVATED_ARGS: '/d /c "pause >nul & cmd /d /c whoami /priv /fo csv & exit 7"'
    });
    assert.equal(r.status, 7, 'the exit code did not come back: ' + r.stderr);
    const privileges = r.stdout.match(/^"Se\w+Privilege"/gm) || [];
    assert.deepEqual(privileges, ['"SeChangeNotifyPrivilege"'], 'the grandchild kept privileges:\n' + r.stdout);
  });

  it('pm2-access.ps1 says none when no daemon is there', () => {
    const r = powershell(['-File', PROBE, '-PipeName', tmpName('none')]);
    assert.equal(r.stdout.trim(), 'none');
  });

  it('pm2-access.ps1 says ok when the daemon answers', async () => {
    const name = tmpName('ok');
    const server = net.createServer((s) => s.destroy());
    await new Promise((resolve) => server.listen('\\\\.\\pipe\\' + name, resolve));
    try {
      const out = await new Promise((resolve, reject) =>
        execFile(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PROBE, '-PipeName', name],
          { windowsHide: true },
          (err, stdout) => (err ? reject(err) : resolve(stdout))
        )
      );
      assert.equal(out.trim(), 'ok');
    } finally {
      server.close();
    }
  });

  it('pm2-access.ps1 says denied for a pipe this window may only read', async () => {
    // The same DACL the boot daemon's pipe has, as an ordinary window sees it:
    // everyone may read, only SYSTEM and Administrators may write.
    const name = tmpName('denied');
    const script = [
      '$sec = New-Object IO.Pipes.PipeSecurity',
      "foreach ($sid in 'S-1-5-18', 'S-1-5-32-544') {",
      "  $sec.AddAccessRule((New-Object IO.Pipes.PipeAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'Allow')))",
      '}',
      "$sec.AddAccessRule((New-Object IO.Pipes.PipeAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-1-0')), 'Read', 'Allow')))",
      "$server = New-Object IO.Pipes.NamedPipeServerStream('" + name + "', 'InOut', 1, 'Byte', 'None', 0, 0, $sec)",
      "'ready'",
      'Start-Sleep -Seconds 30'
    ].join('\n');
    const server = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true });
    try {
      await new Promise((resolve, reject) => {
        server.stdout.on('data', (d) => String(d).includes('ready') && resolve());
        server.on('exit', (code) => reject(new Error('pipe server exited early: ' + code)));
      });
      const r = powershell(['-File', PROBE, '-PipeName', name]);
      assert.equal(r.stdout.trim(), 'denied');
    } finally {
      server.kill();
    }
  });

  it('the hand-over in START.bat passes the second run’s exit code back', () => {
    // START.bat's own lines, run as a pretend-elevated first pass. The helper
    // sees an unelevated caller and runs the second pass as it is, which ends
    // with 5. A 0 here is the cmd /c trap pinned above, back again.
    const prologue = BAT.slice(BAT.indexOf('cd /d "%~2"'), BAT.indexOf('REM  Check and auto-install prerequisites'));
    const labels = BAT.slice(BAT.indexOf('\n:check_node'), BAT.indexOf('\n:check_pm2'));
    const call = '-File "!HERE!scripts\\unelevated.ps1"';
    assert.ok(prologue.includes(call), 'the hand-over no longer calls the helper the way this test expects');
    const harness = (helperPath) =>
      [
        '@echo off',
        'setlocal enabledelayedexpansion',
        prologue.replace(call, '-File "!HERE!' + helperPath + '"'),
        'if "%~3"=="--unelevated" exit /b 5',
        'echo carried on with its rights',
        'exit /b 0',
        ':check_admin',
        'exit /b 0',
        labels
      ]
        .join('\n')
        .replace(/\r?\n/g, '\r\n');
    const run = (text) => {
      const file = path.join(os.tmpdir(), tmpName('handover') + '.bat');
      fs.writeFileSync(file, text);
      try {
        return spawnSync(
          process.env.ComSpec || 'cmd.exe',
          ['/d', '/c', '""' + file + '" --relaunched "' + ROOT + '\\""'],
          {
            windowsVerbatimArguments: true,
            input: '',
            encoding: 'utf8',
            timeout: 90000,
            windowsHide: true
          }
        );
      } finally {
        fs.rmSync(file, { force: true });
      }
    };

    const handedOver = run(harness('scripts\\unelevated.ps1'));
    assert.equal(
      handedOver.status,
      5,
      'the second run’s exit code was lost:\n' + handedOver.stdout + handedOver.stderr
    );

    // And when the helper cannot run at all, the first run carries on.
    const noHelper = run(harness('scripts\\no-such-helper.ps1'));
    assert.equal(noHelper.status, 0);
    assert.match(noHelper.stdout, /could not drop administrator rights/);
    assert.match(noHelper.stdout, /carried on with its rights/);
  });
});
