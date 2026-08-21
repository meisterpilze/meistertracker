'use strict';
// The fallback exists for the one state duckdns.js cannot cover: the server not
// running. That makes it hard to exercise by hand — you would have to stop the
// server and wait twelve minutes — so it takes its directory, its database, its
// clock and its HTTP from the caller, and everything below hands it fakes.
//
// Nothing here touches the network or the real database.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const duckdns = require('../duckdns.js');
const fallback = require('../scripts/duckdns-fallback.js');

const ROOT = path.join(__dirname, '..');

/** A throwaway database with just the one table the fallback reads. */
function tempDb(over) {
  const p = path.join(os.tmpdir(), 'mt_ddns_' + process.pid + '_' + Math.random().toString(36).slice(2) + '.db');
  const db = new DatabaseSync(p);
  db.exec(
    'CREATE TABLE duckdns_config (id INTEGER PRIMARY KEY, enabled INTEGER DEFAULT 0, domain TEXT, token TEXT, last_ip TEXT, last_ip_update TEXT)'
  );
  const row = Object.assign(
    { enabled: 1, domain: 'example', token: 'testtoken', last_ip: null, last_ip_update: null },
    over
  );
  db.prepare(
    'INSERT INTO duckdns_config (id, enabled, domain, token, last_ip, last_ip_update) VALUES (1,?,?,?,?,?)'
  ).run(row.enabled, row.domain, row.token, row.last_ip, row.last_ip_update);
  db.close();
  return p;
}

/** A directory that is not a git worktree, so the guard lets the run through. */
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt_ddns_dir_'));
}

const okReply = { status: 200, body: 'OK\n203.0.113.7\n\nUPDATED' };
const silent = { out: () => {}, err: () => {} };

describe('the threshold that keeps the two updaters apart', () => {
  it('fires before the interface calls the record stale', () => {
    // The ordering is the whole design. If the fallback woke up later than the
    // banner turns red, the red would be reporting a gap the fallback was
    // supposed to have already covered — and the admin would be chasing a
    // problem that fixes itself two minutes later.
    assert.ok(duckdns.FALLBACK_AFTER_MS < duckdns.STALE_AFTER_MS);
  });

  it('waits out more than one missed cycle, so an ordinary restart does not wake it', () => {
    assert.ok(duckdns.FALLBACK_AFTER_MS > duckdns.OK_INTERVAL_MS * 2);
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

  it('takes over when there is no successful update on record at all', () => {
    // A database restored from backup looks exactly like this, and it is the
    // strongest reason to act rather than a reason to wait.
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

  it('does not fire one minute early or one minute late', () => {
    const edge = duckdns.FALLBACK_AFTER_MS;
    assert.equal(fallback.shouldRun(cfg({ lastIpUpdate: new Date(now - edge + 60000).toISOString() }), now).run, false);
    assert.equal(fallback.shouldRun(cfg({ lastIpUpdate: new Date(now - edge - 60000).toISOString() }), now).run, true);
  });
});

describe('isWorktree', () => {
  let dir;
  before(() => {
    dir = tempDir();
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

  it('honours WORKTREE_MODE even where .git says otherwise', () => {
    assert.equal(fallback.isWorktree(dir, { WORKTREE_MODE: '1' }), true);
    assert.equal(fallback.isWorktree(dir, { WORKTREE_MODE: 'true' }), true);
  });

  it('this checkout is what it is, and main() obeys it', async () => {
    // Not a fake: the suite runs from a worktree during development and from a
    // real checkout in CI, and the fallback must be right either way.
    const worktree = fallback.isWorktree(ROOT, {});
    const code = await fallback.main([], Object.assign({ dbFile: '/nonexistent/x.db' }, silent));
    assert.equal(code, 2, worktree ? 'a worktree must be refused' : 'a missing database must be refused');
  });
});

describe('end to end, against a throwaway database', () => {
  let dir;
  before(() => {
    dir = tempDir();
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (dbFile, over) =>
    fallback.main(
      (over && over.argv) || [],
      Object.assign({ dir, dbFile, env: {}, deps: { httpGet: () => Promise.resolve(okReply) } }, silent, over)
    );

  it('updates the record and writes the timestamp back when the server has gone quiet', async () => {
    const p = tempDb({ last_ip_update: new Date(Date.now() - 60 * 60000).toISOString() });
    assert.equal(await run(p), 0);
    const db = new DatabaseSync(p);
    const row = db.prepare('SELECT last_ip, last_ip_update FROM duckdns_config WHERE id=1').get();
    db.close();
    assert.equal(row.last_ip, '203.0.113.7');
    // Without this the fallback would take over again on every single tick,
    // because nothing would ever record that it had.
    assert.ok(Date.now() - Date.parse(row.last_ip_update) < 60000);
    fs.unlinkSync(p);
  });

  it('touches nothing while the server is alive', async () => {
    let calls = 0;
    const p = tempDb({ last_ip_update: new Date(Date.now() - 60000).toISOString() });
    const code = await run(p, { deps: { httpGet: () => (calls++, Promise.resolve(okReply)) } });
    assert.equal(code, 0);
    assert.equal(calls, 0, 'a healthy server must not cost a second request to duckdns.org');
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
    const code = await run(p, { deps: { httpGet: () => Promise.resolve({ status: 200, body: 'KO' }) } });
    assert.equal(code, 1, 'a non-zero exit is what makes systemctl status say something happened');
    fs.unlinkSync(p);
  });

  it('does nothing, successfully, when DuckDNS is switched off', async () => {
    let calls = 0;
    const p = tempDb({ enabled: 0, last_ip_update: null });
    const code = await run(p, { deps: { httpGet: () => (calls++, Promise.resolve(okReply)) } });
    assert.equal(code, 0);
    assert.equal(calls, 0);
    fs.unlinkSync(p);
  });

  it('says so rather than crashing when the table is not there yet', async () => {
    const p = path.join(dir, 'empty.db');
    new DatabaseSync(p).close();
    assert.equal(await run(p), 2);
    fs.unlinkSync(p);
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
});

describe('the systemd units', () => {
  const dir = path.join(ROOT, 'scripts', 'systemd');
  const service = fs.readFileSync(path.join(dir, 'meistertracker-duckdns.service'), 'utf8');
  const timer = fs.readFileSync(path.join(dir, 'meistertracker-duckdns.timer'), 'utf8');
  const installer = fs.readFileSync(path.join(ROOT, 'scripts', 'install-duckdns-fallback.sh'), 'utf8');

  it('runs the script that actually exists', () => {
    assert.ok(service.includes('scripts/duckdns-fallback.js'));
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'duckdns-fallback.js')));
  });

  it('has every placeholder substituted by the installer', () => {
    // A unit installed with a literal __MT_DIR__ in it starts, fails, and reads
    // like a DuckDNS problem rather than an installation one.
    const used = new Set([...service.matchAll(/__MT_[A-Z]+__/g), ...timer.matchAll(/__MT_[A-Z]+__/g)].map((m) => m[0]));
    assert.ok(used.size > 0, 'the templates should have placeholders');
    for (const p of used) {
      assert.ok(installer.includes(p), installer ? p + ' is never substituted' : p);
    }
  });

  it('waits for a route before trying to reach duckdns.org', () => {
    assert.ok(service.includes('network-online.target'));
  });

  it('leaves getaddrinfo a netlink socket to work with', () => {
    // The sandbox is the easiest place to break this job without noticing.
    // glibc's getaddrinfo enumerates the local addresses over netlink before it
    // returns anything, so restricting the address families without AF_NETLINK
    // means the unit cannot resolve duckdns.org — indistinguishable, from the
    // outside, from the outage it exists to fix.
    const line = service.split('\n').find((l) => l.startsWith('RestrictAddressFamilies='));
    assert.ok(line, 'the unit should restrict address families at all');
    assert.ok(line.includes('AF_NETLINK'), line);
    assert.ok(line.includes('AF_INET'));
  });

  it('is a oneshot, not a service that is meant to stay up', () => {
    assert.ok(service.includes('Type=oneshot'));
  });

  it('may write the directory holding the database, and little else', () => {
    assert.ok(service.includes('ProtectSystem=strict'));
    assert.ok(service.includes('ReadWritePaths=__MT_DIR__'));
  });

  it('fires on the same cadence as the server, and again after a boot', () => {
    assert.ok(timer.includes('OnUnitActiveSec=5min'));
    assert.ok(timer.includes('OnBootSec='));
    assert.ok(timer.includes('WantedBy=timers.target'));
  });

  it('refuses to install from a worktree', () => {
    assert.match(installer, /is a git worktree/);
  });

  it('checks its own substitution before enabling anything', () => {
    assert.match(installer, /__MT_\[A-Z\]\*__/);
  });
});

describe('the Windows task', () => {
  const ps = fs.readFileSync(path.join(ROOT, 'install-duckdns-fallback.ps1'), 'utf8');

  it('runs the same script, on the same cadence', () => {
    assert.ok(ps.includes('duckdns-fallback.js'));
    assert.match(ps, /RepetitionInterval \(New-TimeSpan -Minutes 5\)/);
  });

  it('resolves node rather than trusting the task PATH', () => {
    assert.match(ps, /Get-Command node/);
  });

  it('refuses to install from a worktree', () => {
    assert.match(ps, /is a git worktree/);
  });

  it('can be removed again', () => {
    assert.match(ps, /Unregister-ScheduledTask/);
  });

  it('does not let a stalled run block the next one', () => {
    assert.match(ps, /MultipleInstances IgnoreNew/);
  });
});
