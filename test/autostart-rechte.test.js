'use strict';
// Why the boot task and START.bat must run at the same privilege level.
//
// pm2 talks to its daemon over \\.\pipe\rpc.sock. A pipe created by an elevated
// process cannot be opened by a non-elevated one. The scheduled task registered
// by install-autostart.ps1 starts the server before anyone logs in, so if it
// runs at RunLevel Highest its instance is elevated — and an ordinary START.bat
// window can then neither stop that process nor reach its daemon.
//
// What that looked like in practice: START.bat printed
//
//     -> Killing stale process on port 3000 (PID 15628)...
//
// and carried on, because taskkill's output was discarded and a refusal is
// indistinguishable from a success when nobody checks. Two steps later pm2 hit
// the pipe it could not open and printed `connect EPERM //./pipe/rpc.sock` with
// a Node stack trace, which START.bat reported as "Server process crashed on
// startup". Nothing had crashed. The old instance was still running, still
// serving the code it booted with — for seventeen hours, through a git pull it
// never picked up — while every launch appeared to fail.
//
// Three things keep that from recurring, and each is pinned below: the task is
// registered unelevated, START.bat checks whether the kill worked, and the one
// thing that made elevation look necessary stays unnecessary.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PS1 = fs.readFileSync(path.join(ROOT, 'install-autostart.ps1'), 'utf8');
const BAT = fs.readFileSync(path.join(ROOT, 'START.bat'), 'utf8');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

describe('the boot task runs at the same level as START.bat', () => {
  it('is registered unelevated', () => {
    assert.match(PS1, /-RunLevel\s+Limited/, 'the scheduled task is not registered with RunLevel Limited');
    assert.equal(
      /-RunLevel\s+Highest/.test(PS1),
      false,
      'RunLevel Highest is back — the boot instance will again be unreachable from an ordinary START.bat'
    );
  });

  it('still starts without a login, which is the whole point of the task', () => {
    // S4U is what lets it run as this user with the profile loaded and no
    // stored password. Dropping elevation must not quietly drop that too.
    assert.match(PS1, /-LogonType\s+S4U/);
    assert.match(PS1, /New-ScheduledTaskTrigger\s+-AtStartup/);
  });
});

describe('START.bat does not pretend the kill worked', () => {
  it('re-checks the port after killing, rather than assuming', () => {
    const step5 = BAT.slice(BAT.indexOf('[5/5]'));
    assert.match(step5, /set "PORT_HOLDER="/, 'nothing re-reads the port after taskkill');
    assert.match(step5, /if defined PORT_HOLDER/, 'the re-read result is never tested');
  });

  it('stops there instead of walking into pm2', () => {
    const held = BAT.slice(BAT.indexOf('if defined PORT_HOLDER'));
    const stop = held.indexOf('exit /b 1');
    const pm2 = held.indexOf('pm2 start');
    assert.ok(stop !== -1, 'a refused kill no longer aborts the run');
    assert.ok(
      pm2 === -1 || stop < pm2,
      'START.bat still reaches pm2 start after failing to free the port, which is the EPERM path'
    );
  });

  it('names the cause and both fixes, since the error alone explains nothing', () => {
    const held = BAT.slice(BAT.indexOf('if defined PORT_HOLDER'), BAT.indexOf('if defined PORT_HOLDER') + 2200);
    assert.match(held, /install-autostart\.ps1/, 'the permanent fix is not named');
    assert.match(held, /Stop-Process -Id/, 'the immediate fix is not named');
    assert.match(held, /Administrator/, 'it does not say the fix needs elevation');
  });

  it('leaves worktree runs alone — they never touch the production port', () => {
    const step5 = BAT.slice(BAT.indexOf('[5/5]'));
    const guard = step5.indexOf('if not "%WORKTREE_MODE%"=="1"');
    const check = step5.indexOf('set "PORT_HOLDER="');
    assert.ok(guard !== -1 && guard < check, 'the port check is not gated on production mode');
  });
});

describe('nothing in the server needs the elevation that was dropped', () => {
  it('port 80 is a convenience, and its failure is already handled', () => {
    // This is the load-bearing assumption behind RunLevel Limited. Binding 80
    // is the only privileged-looking thing the server does; Windows permits it
    // unprivileged, and if it ever is refused the server has to carry on rather
    // than exit — otherwise dropping elevation would turn a redirect into a
    // boot failure.
    const near = SRV.slice(SRV.indexOf('HTTP_REDIRECT_PORT'), SRV.indexOf('HTTP_REDIRECT_PORT') + 1600);
    assert.match(near, /\.on\('error'/, 'the port-80 listener has no error handler');
    assert.match(near, /EACCES/, 'a refused port 80 is not handled');
    assert.match(near, /EADDRINUSE/, 'a taken port 80 is not handled');
    assert.equal(/process\.exit/.test(near), false, 'a failed port-80 bind must not end the process');
  });

  it('START.bat itself runs no administrator-only command', () => {
    const forbidden = [/\bnetsh\b/i, /\bsc\s+(create|config|start)\b/i, /\breg\s+add\b/i, /\bicacls\b/i, /setx\s+\/m/i];
    const hits = forbidden.filter((re) => re.test(BAT)).map((re) => String(re));
    assert.deepEqual(hits, [], 'START.bat gained a command that needs elevation:\n  ' + hits.join('\n  '));
  });
});
