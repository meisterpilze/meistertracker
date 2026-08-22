'use strict';
// The fallback exists for the one state duckdns.js cannot cover: the server not
// running. That makes it hard to exercise by hand — you would have to stop the
// server and wait a quarter of an hour — so it takes its directory, its
// database and its HTTP from the caller, and everything below hands it fakes.
//
// Fixtures use db.openDb, not a hand-written CREATE TABLE. An earlier version
// declared its own copy of duckdns_config, which meant the fallback and its
// tests could drift away from the real schema together and stay green.
//
// Nothing here touches the network.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const duckdns = require('../duckdns.js');
const fallback = require('../scripts/duckdns-fallback.js');

const ROOT = path.join(__dirname, '..');
const okReply = { status: 200, body: 'OK\n203.0.113.7\n\nUPDATED' };
const silent = { out: () => {}, err: () => {} };

/** Read a file with its comment lines removed, for assertions about code. */
function codeOnly(file) {
  return fs
    .readFileSync(path.join(ROOT, file), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(#|\/\/|\*|<#)/.test(l))
    .join('\n');
}

describe('the threshold that keeps the two updaters apart', () => {
  it('clears the server’s retry ladder, so a bad few minutes is not raced', () => {
    // The server keeps retrying with backoff and only records success. By the
    // time that ladder reaches its ceiling it is over twelve minutes past its
    // last success while still actively trying; a threshold under that figure
    // wakes the fallback mid-backoff and both processes then set the same name.
    let t = 0;
    for (let f = 1; duckdns.nextDelay(f) < duckdns.RETRY_MAX_MS; f++) t += duckdns.nextDelay(f);
    t += duckdns.RETRY_MAX_MS; // the first tick at the ceiling
    assert.ok(
      duckdns.FALLBACK_AFTER_MS > t,
      'FALLBACK_AFTER_MS (' + duckdns.FALLBACK_AFTER_MS / 60000 + ' min) must clear the ladder (' + t / 60000 + ' min)'
    );
  });

  it('is not tied to the banner threshold in either direction', () => {
    // It used to be required to fire *before* STALE_AFTER_MS so the banner
    // could never go red while the fallback covered. That was backwards: the
    // banner answers "is this server's own updater working", which stays worth
    // knowing. They are different columns now and the ordering carries no
    // meaning, so nothing should assert one.
    assert.ok(duckdns.STALE_AFTER_MS > 0 && duckdns.FALLBACK_AFTER_MS > 0);
  });
});

describe('staleness', () => {
  const now = Date.parse('2026-08-21T12:00:00.000Z');
  const ago = (min) => new Date(now - min * 60000).toISOString();

  it('takes the deadline from the caller', () => {
    assert.equal(duckdns.staleness(ago(16), now, duckdns.FALLBACK_AFTER_MS).stale, true);
    assert.equal(duckdns.staleness(ago(16), now, duckdns.STALE_AFTER_MS).stale, false);
  });

  it('treats a timestamp from the future as stale, not as fresh', () => {
    // A board with no RTC boots hours behind, so every recorded success looks
    // like it has not happened yet. Reading that as "younger than the
    // threshold" left both the banner green and the fallback standing down
    // during exactly the post-reboot window they exist for.
    const r = duckdns.staleness(new Date(now + 3 * 3600 * 1000).toISOString(), now);
    assert.equal(r.future, true);
    assert.equal(r.stale, true);
    assert.equal(r.ageMs, 0, 'and never a negative age');
  });

  it('allows a second of skew without crying wolf', () => {
    assert.equal(duckdns.staleness(new Date(now + 1000).toISOString(), now).future, false);
  });

  it('counts never having succeeded as stale', () => {
    assert.equal(duckdns.staleness(null, now).stale, true);
    assert.equal(duckdns.staleness('not a date', now).stale, true);
  });
});

describe('shouldRun', () => {
  const now = Date.parse('2026-08-21T12:00:00.000Z');
  const cfg = (over) => Object.assign({ enabled: true, domain: 'example', token: 'testtoken' }, over);
  const ago = (min) => new Date(now - min * 60000).toISOString();

  it('stands down while the server is keeping the record current', () => {
    const r = fallback.shouldRun(cfg({ lastIpUpdate: ago(4) }), now);
    assert.equal(r.run, false);
    assert.match(r.why, /4 min ago/);
  });

  it('takes over once the server has gone quiet', () => {
    assert.equal(fallback.shouldRun(cfg({ lastIpUpdate: ago(30) }), now).run, true);
  });

  it('acts when the recorded time is in the future', () => {
    const r = fallback.shouldRun(cfg({ lastIpUpdate: new Date(now + 3 * 3600 * 1000).toISOString() }), now);
    assert.equal(r.run, true);
    assert.match(r.why, /future/);
  });

  it('takes over when there is no successful update on record at all', () => {
    assert.equal(fallback.shouldRun(cfg({ lastIpUpdate: null }), now).run, true);
    assert.equal(fallback.shouldRun(cfg({ lastIpUpdate: 'not a date' }), now).run, true);
  });

  it('does nothing when DuckDNS is switched off or half-configured', () => {
    assert.equal(fallback.shouldRun(cfg({ enabled: false, lastIpUpdate: null }), now).run, false);
    assert.equal(fallback.shouldRun(cfg({ token: '', lastIpUpdate: null }), now).run, false);
    assert.equal(fallback.shouldRun(cfg({ domain: '', lastIpUpdate: null }), now).run, false);
    assert.equal(fallback.shouldRun(null, now).run, false);
  });

  it('--force overrides a fresh timestamp, so an install can be proven', () => {
    assert.equal(fallback.shouldRun(cfg({ lastIpUpdate: ago(1) }), now, true).run, true);
  });

  it('ignores the fallback’s own column entirely', () => {
    // This is the whole separation. Reading a column this process also writes
    // meant standing down on the strength of its own work.
    const stale = cfg({ lastIpUpdate: ago(30), fallbackLast: new Date(now).toISOString() });
    assert.equal(fallback.shouldRun(stale, now).run, true, 'a recent fallback run must not look like a live server');
  });
});

describe('isWorktree', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_ddns_wt_'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('treats a plain directory as the real thing', () => {
    assert.equal(fallback.isWorktree(dir, {}), false);
  });

  it('spots a worktree by its .git being a file', () => {
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');
    assert.equal(fallback.isWorktree(dir, {}), true);
    fs.unlinkSync(path.join(dir, '.git'));
  });

  it('is not fooled by a real .git directory', () => {
    fs.mkdirSync(path.join(dir, '.git'));
    assert.equal(fallback.isWorktree(dir, {}), false);
    fs.rmSync(path.join(dir, '.git'), { recursive: true });
  });

  it('honours WORKTREE_MODE even where .git says otherwise', () => {
    assert.equal(fallback.isWorktree(dir, { WORKTREE_MODE: '1' }), true);
    assert.equal(fallback.isWorktree(dir, { WORKTREE_MODE: 'true' }), true);
  });
});

describe('end to end, against a throwaway database', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_ddns_'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** A real schema, built by the real migrations, inside the swept directory. */
  function tempDb(over) {
    const p = path.join(dir, 'mt_' + Math.random().toString(36).slice(2) + '.db');
    const d = db.openDb(p);
    const row = Object.assign({ enabled: 1, domain: 'example', token: 'testtoken' }, over);
    d.prepare(
      'UPDATE duckdns_config SET enabled=?, domain=?, token=?, last_ip_update=?, fallback_last=? WHERE id=1'
    ).run(
      row.enabled,
      row.domain,
      row.token,
      row.last_ip_update === undefined ? null : row.last_ip_update,
      row.fallback_last === undefined ? null : row.fallback_last
    );
    d.close();
    return p;
  }

  const read = (p) => {
    const d = db.openDb(p);
    const row = d.prepare('SELECT last_ip, last_ip_update, fallback_last FROM duckdns_config WHERE id=1').get();
    d.close();
    return row;
  };

  const run = (dbFile, over) =>
    fallback.main(
      (over && over.argv) || [],
      Object.assign({ dir, dbFile, env: {}, deps: { httpGet: () => Promise.resolve(okReply) } }, silent, over)
    );

  it('records itself in fallback_last and leaves the server’s column alone', async () => {
    // The separation, end to end. Writing last_ip_update here is what used to
    // keep the admin banner green over a permanently broken in-process updater.
    const stamp = new Date(Date.now() - 60 * 60000).toISOString();
    const p = tempDb({ last_ip_update: stamp });
    assert.equal(await run(p), 0);
    const row = read(p);
    assert.equal(row.last_ip, '203.0.113.7');
    assert.equal(row.last_ip_update, stamp, 'the server’s column must be untouched');
    assert.ok(Date.now() - Date.parse(row.fallback_last) < 60000);
    fs.unlinkSync(p);
  });

  it('acts on every tick while the server stays down', async () => {
    // It used to stand down on the two ticks after its own update, so a real
    // outage got a fifteen-minute cadence out of a five-minute timer.
    let calls = 0;
    const p = tempDb({ last_ip_update: new Date(Date.now() - 60 * 60000).toISOString() });
    const deps = { httpGet: () => (calls++, Promise.resolve(okReply)) };
    for (let tick = 0; tick < 3; tick++) assert.equal(await run(p, { deps }), 0);
    assert.equal(calls, 3, 'three ticks with a dead server must be three updates');
    fs.unlinkSync(p);
  });

  it('touches nothing while the server is alive', async () => {
    let calls = 0;
    const p = tempDb({ last_ip_update: new Date(Date.now() - 60000).toISOString() });
    assert.equal(await run(p, { deps: { httpGet: () => (calls++, Promise.resolve(okReply)) } }), 0);
    assert.equal(calls, 0, 'a healthy server must not cost a request to duckdns.org');
    fs.unlinkSync(p);
  });

  it('--force acts even then', async () => {
    let calls = 0;
    const p = tempDb({ last_ip_update: new Date(Date.now() - 60000).toISOString() });
    await run(p, { argv: ['--force'], deps: { httpGet: () => (calls++, Promise.resolve(okReply)) } });
    assert.equal(calls, 1);
    fs.unlinkSync(p);
  });

  it('reports a refused token as a failure the scheduler can see', async () => {
    const p = tempDb({ last_ip_update: null });
    assert.equal(await run(p, { deps: { httpGet: () => Promise.resolve({ status: 200, body: 'KO' }) } }), 1);
    fs.unlinkSync(p);
  });

  it('fails loudly when the record moved but the run could not be recorded', async () => {
    // The one that mattered most. updateNow treats a failed status write as a
    // success, so this exited 0 with nothing persisted — and since the write is
    // the only record that the timer ran, systemctl showed green while nothing
    // had been written at all.
    const p = tempDb({ last_ip_update: null });
    const lines = [];
    const code = await run(p, {
      err: (m) => lines.push(m),
      dbApi: {
        getDuckdnsCfg: (c) => db.getDuckdnsCfg(c),
        updateDuckdnsStatus: () => {
          throw new Error('SQLITE_BUSY');
        }
      }
    });
    assert.equal(code, 1, 'a run that could not be recorded is not a clean run');
    assert.ok(
      lines.some((l) => /could not be recorded/.test(l) && /SQLITE_BUSY/.test(l)),
      'and it has to name the cause: ' + lines.join(' | ')
    );
    fs.unlinkSync(p);
  });

  it('updateNow tells its caller whether the write landed', async () => {
    const r = await duckdns.updateNow({
      database: {},
      dbApi: {
        getDuckdnsCfg: () => ({ enabled: true, domain: 'example', token: 'testtoken' }),
        updateDuckdnsStatus: () => {
          throw new Error('SQLITE_BUSY');
        }
      },
      log: () => {},
      deps: { httpGet: () => Promise.resolve(okReply) }
    });
    assert.equal(r.ok, true, 'the record itself did move');
    assert.equal(r.wrote, false);
    assert.equal(r.writeError, 'SQLITE_BUSY');
  });

  it('does nothing, successfully, when DuckDNS is switched off', async () => {
    let calls = 0;
    const p = tempDb({ enabled: 0, last_ip_update: null });
    assert.equal(await run(p, { deps: { httpGet: () => (calls++, Promise.resolve(okReply)) } }), 0);
    assert.equal(calls, 0);
    fs.unlinkSync(p);
  });

  it('names the real fault instead of blaming a missing row', async () => {
    // Every SQLite error used to arrive as "no duckdns_config row — start the
    // server once", which sent the operator to restart a running server.
    const p = path.join(dir, 'not-a-database.db');
    fs.writeFileSync(p, 'this is not an sqlite file at all');
    const lines = [];
    assert.equal(await run(p, { err: (m) => lines.push(m) }), 2);
    assert.ok(
      lines.some((l) => /cannot read the database/.test(l)),
      'expected the real error, got: ' + lines.join(' | ')
    );
    fs.unlinkSync(p);
  });

  it('says so plainly when the table is genuinely absent', async () => {
    const p = path.join(dir, 'empty.db');
    const { DatabaseSync } = require('node:sqlite');
    new DatabaseSync(p).close();
    const lines = [];
    assert.equal(await run(p, { err: (m) => lines.push(m) }), 2);
    assert.ok(lines.some((l) => /no duckdns_config table/.test(l)));
    fs.unlinkSync(p);
  });

  it('--check answers configuration and nothing else', async () => {
    let calls = 0;
    const deps = { httpGet: () => (calls++, Promise.resolve(okReply)) };
    const on = tempDb({ last_ip_update: null });
    assert.equal(await run(on, { argv: ['--check'], deps }), 0);
    fs.unlinkSync(on);
    const off = tempDb({ enabled: 0, last_ip_update: null });
    assert.equal(await run(off, { argv: ['--check'], deps }), 1);
    fs.unlinkSync(off);
    // Even with the server long dead, --check must not update.
    const stale = tempDb({ last_ip_update: new Date(Date.now() - 6 * 3600 * 1000).toISOString() });
    assert.equal(await run(stale, { argv: ['--check'], deps }), 0);
    fs.unlinkSync(stale);
    assert.equal(calls, 0, '--check must never touch the network');
  });

  it('refuses from a worktree even with everything else in order', async () => {
    const p = tempDb({ last_ip_update: null });
    let calls = 0;
    const code = await fallback.main(
      [],
      Object.assign(
        { dir, dbFile: p, env: { WORKTREE_MODE: '1' }, deps: { httpGet: () => (calls++, Promise.resolve(okReply)) } },
        silent
      )
    );
    assert.equal(code, 2);
    assert.equal(calls, 0);
    fs.unlinkSync(p);
  });

  it('refuses a checkout whose .git is a file, through main()', async () => {
    // The guard both installers rely on. The previous test for this asserted
    // exit code 2 on both of its branches, so it held even with the detection
    // removed.
    const wt = fs.mkdtempSync(path.join(dir, 'wt_'));
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
    const p = tempDb({ last_ip_update: null });
    let calls = 0;
    const lines = [];
    const code = await fallback.main([], {
      dir: wt,
      dbFile: p,
      env: {},
      out: () => {},
      err: (m) => lines.push(m),
      deps: { httpGet: () => (calls++, Promise.resolve(okReply)) }
    });
    assert.equal(code, 2);
    assert.equal(calls, 0);
    assert.ok(
      lines.some((l) => /worktree/.test(l)),
      'and for the worktree reason, not some other 2'
    );
    fs.unlinkSync(p);
  });
});

describe('the systemd units', () => {
  const dir = path.join(ROOT, 'scripts', 'systemd');
  const service = fs.readFileSync(path.join(dir, 'meistertracker-duckdns.service'), 'utf8');
  const timer = fs.readFileSync(path.join(dir, 'meistertracker-duckdns.timer'), 'utf8');
  const installerCode = codeOnly('scripts/install-duckdns-fallback.sh');

  it('runs the script that actually exists', () => {
    assert.ok(service.includes('scripts/duckdns-fallback.js'));
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'duckdns-fallback.js')));
  });

  it('quotes every substituted path, so a space cannot split a directive', () => {
    for (const key of ['ExecStart', 'WorkingDirectory', 'ReadWritePaths']) {
      const line = (service.split(/\r?\n/).find((l) => l.startsWith(key + '=')) || '').trim();
      assert.ok(line, key + ' missing');
      assert.ok(!/__MT_[A-Z]+__/.test(line.replace(/"[^"]*"/g, '')), key + ' has an unquoted placeholder: ' + line);
    }
  });

  it('substitutes cleanly for a deployment path containing a space', () => {
    const out = service
      .replace(/__MT_DIR__/g, '/home/pi/My Server/mt')
      .replace(/__MT_NODE__/g, '/usr/bin/node')
      .replace(/__MT_USER__/g, 'mt')
      .replace(/__MT_GROUP__/g, 'mt');
    const exec = out.split(/\r?\n/).find((l) => l.startsWith('ExecStart='));
    assert.equal(exec, 'ExecStart="/usr/bin/node" "/home/pi/My Server/mt/scripts/duckdns-fallback.js" --quiet');
  });

  it('has every placeholder substituted by the installer', () => {
    // Asserted against the installer's *code*, not its prose: the previous
    // version matched a comment that happened to mention __MT_DIR__, so
    // deleting the sed expression left the test green.
    const used = new Set([...service.matchAll(/__MT_[A-Z]+__/g), ...timer.matchAll(/__MT_[A-Z]+__/g)].map((m) => m[0]));
    assert.ok(used.size > 0, 'the templates should have placeholders');
    for (const p of used) {
      assert.ok(new RegExp('s\\|' + p + '\\|').test(installerCode), p + ' is never substituted by the installer');
    }
  });

  it('waits for a route and for the clock', () => {
    assert.ok(service.includes('network-online.target'));
    assert.ok(service.includes('time-sync.target'));
  });

  it('is a oneshot, not a service meant to stay up', () => {
    assert.ok(service.includes('Type=oneshot'));
  });

  it('keeps the private key and the backups out of the writable set', () => {
    assert.ok(service.includes('ProtectSystem=strict'));
    const inacc = service.split(/\r?\n/).find((l) => l.startsWith('InaccessiblePaths='));
    assert.ok(inacc, 'the whole app directory is writable, so the sensitive parts must be excluded');
    for (const p of ['certs', 'backups']) assert.ok(inacc.includes(p), p + ' should be excluded: ' + inacc);
  });

  it('leaves getaddrinfo a netlink socket to work with', () => {
    const line = service.split('\n').find((l) => l.startsWith('RestrictAddressFamilies='));
    assert.ok(line && line.includes('AF_NETLINK'), line);
  });

  it('fires on the same cadence as the server, and again after a boot', () => {
    assert.ok(timer.includes('OnUnitActiveSec=5min'));
    assert.ok(timer.includes('OnBootSec='));
    assert.ok(timer.includes('WantedBy=timers.target'));
  });
});

describe('the Linux installer', () => {
  const code = codeOnly('scripts/install-duckdns-fallback.sh');

  it('refuses to install from a worktree', () => {
    assert.match(code, /is a git worktree/);
  });

  it('refuses rather than guessing when there is no database to own the unit', () => {
    // It used to fall back to ${SUDO_USER:-root} and enable the timer anyway,
    // which installed a permanent User=root job that later left root-owned
    // -wal/-shm files the app user could not reopen.
    assert.ok(!/SUDO_USER/.test(code), 'no guessing at the run-as user');
    assert.match(code, /no database at .* yet/);
  });

  it('resolves node as the user the unit will run as', () => {
    assert.ok(/runuser -l "\$MT_USER"|sudo -u "\$MT_USER" -i command -v node/.test(code));
  });

  it('proves the interpreter runs before enabling anything', () => {
    assert.match(code, /--check --quiet/);
    assert.match(code, /does not run as user/);
  });

  it('escapes sed replacements, since & and \\ are not literal there', () => {
    assert.match(code, /sed_escape/);
  });

  it('stages the units and installs them only after the checks pass', () => {
    const stage = code.indexOf('mktemp -d');
    const guard = code.indexOf("grep -l '__MT_");
    const put = code.indexOf('install -m 0644');
    assert.ok(stage > 0 && guard > stage && put > guard, 'stage -> verify -> install, in that order');
  });

  it('rejects an unknown argument instead of installing', () => {
    // A mistyped --uninstall used to fall through and re-enable the timer.
    assert.match(code, /unknown argument/);
  });
});

describe('the Windows task', () => {
  const ps = fs.readFileSync(path.join(ROOT, 'install-duckdns-fallback.ps1'), 'utf8');
  const psCode = codeOnly('install-duckdns-fallback.ps1');
  const bat = fs.readFileSync(path.join(ROOT, 'install-duckdns-fallback.bat'), 'utf8');

  it('asks Windows for rights instead of telling the reader to find them', () => {
    assert.match(psCode, /-Verb RunAs/);
    assert.match(psCode, /Start-Process/);
  });

  it('carries both the user and the interpreter across the elevation boundary', () => {
    // UAC can be answered with a different account's credentials. The user was
    // already carried; node was still resolved after elevation, so the task got
    // the administrator's per-user node and failed as somebody else.
    assert.match(psCode, /-TargetUser/);
    assert.match(psCode, /-TargetNode/);
    const elevate = psCode.indexOf('-Verb RunAs');
    const resolve = psCode.indexOf('Get-Command node');
    assert.ok(resolve < elevate, 'node must be resolved before elevation, not after');
  });

  it('registers the recurring job unelevated', () => {
    assert.match(psCode, /-RunLevel Limited/);
    assert.ok(!/-RunLevel Highest/.test(psCode));
  });

  it('states a repetition duration rather than trusting the default', () => {
    assert.match(psCode, /-RepetitionInterval \(New-TimeSpan -Minutes 5\)/);
    assert.match(psCode, /-RepetitionDuration/);
  });

  it('leaves the next run a slot when one stalls', () => {
    assert.match(psCode, /-ExecutionTimeLimit \(New-TimeSpan -Minutes 2\)/);
    assert.match(psCode, /MultipleInstances IgnoreNew/);
  });

  it('holds the window open on every path out, not just the successful ones', () => {
    // Every failure was a `throw` under $ErrorActionPreference='Stop', which
    // skipped the pause entirely: the user saw a UAC prompt, a flash, and
    // concluded the install had worked.
    const fin = ps.slice(ps.indexOf('} finally {'));
    assert.match(fin, /Read-Host/);
    assert.ok(ps.includes('} catch {'), 'the work has to be wrapped for that finally to cover it');
  });

  it('can be removed again', () => {
    assert.match(psCode, /Unregister-ScheduledTask/);
  });

  it('has a wrapper that is one double-click and reports its own failures', () => {
    assert.ok(bat.includes('install-duckdns-fallback.ps1'));
    assert.match(bat, /-ExecutionPolicy Bypass/);
    assert.match(bat, /if errorlevel 1/, 'a failure before PowerShell pauses must not flash past');
  });
});

describe('the deploy-time reminder', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'update_server.sh'), 'utf8');
  const fn = sh.slice(sh.indexOf('check_duckdns_fallback() {'), sh.indexOf('do_update() {'));

  it('exists and runs after both start paths', () => {
    assert.match(sh, /^check_duckdns_fallback\(\) \{/m);
    assert.equal((sh.match(/^ *check_duckdns_fallback$/gm) || []).length, 2);
  });

  it('names the command instead of describing it', () => {
    assert.ok(sh.includes('sudo bash scripts/install-duckdns-fallback.sh'));
  });

  it('asks systemd what the timer is doing, not whether a file exists', () => {
    // A disabled or masked unit leaves its file in place, so the presence check
    // called a timer that had not run in months "installed".
    assert.ok(fn.includes('is-enabled'));
    assert.ok(fn.includes('is-active'));
    assert.ok(fn.includes('is-failed'), 'and an installed timer whose job keeps failing is worth saying too');
  });

  it('only speaks up where it could help', () => {
    assert.ok(fn.includes('IS_WORKTREE'));
    assert.ok(fn.includes('systemctl'));
    assert.ok(fn.includes('--check'));
  });

  it('cannot fail a deploy over a reminder', () => {
    assert.ok(!/&&\s*return/.test(fn), 'use if blocks, not && chains, under set -e');
    assert.ok(fn.includes('node scripts/duckdns-fallback.js --check --quiet >/dev/null 2>&1'));
  });
});
