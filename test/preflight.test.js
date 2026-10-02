'use strict';
// The preflight's whole value is that it fails instead of the deploy, so what
// needs pinning is the failing: a migration that throws, a module that will not
// load, a table that shrank. A preflight that only knows how to pass is a
// preflight that would have waved through every bug the review found.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db.js');
const preflight = require('../scripts/preflight.js');

const ROOT = path.join(__dirname, '..');
const silent = { out: () => {}, err: () => {} };

describe('losses — the check that a migration did not eat anything', () => {
  it('says nothing when every table kept its rows', () => {
    assert.deepEqual(preflight.losses({ a: 3, b: 0 }, { a: 3, b: 0 }), []);
  });

  it('allows a table to grow, and allows a new one', () => {
    assert.deepEqual(preflight.losses({ a: 3 }, { a: 4, b: 9 }), []);
  });

  it('reports a table that shrank', () => {
    const r = preflight.losses({ batches: 812 }, { batches: 811 });
    assert.equal(r.length, 1);
    assert.match(r[0], /batches: 812 rows before, 811 after/);
  });

  it('reports a table that disappeared', () => {
    const r = preflight.losses({ harvests: 40 }, {});
    assert.equal(r.length, 1);
    assert.match(r[0], /harvests: table gone/);
  });
});

describe('against a real database', () => {
  let dir, live;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_pf_'));
    live = path.join(dir, 'meistertracker.db');
    const d = db.openDb(live);
    db.createUser(d, 'admin.one', 'a reasonable password', 'admin');
    d.close();
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('snapshots without writing to the source', () => {
    const before = fs.statSync(live).mtimeMs;
    const snap = path.join(dir, 'snap.db');
    preflight.snapshot(live, snap);
    assert.ok(fs.existsSync(snap));
    assert.equal(fs.statSync(live).mtimeMs, before, 'the live file must not be touched');
    // And the copy is usable, not a truncated file.
    assert.ok(preflight.census(snap).users >= 1);
    fs.unlinkSync(snap);
  });

  it('counts every table', () => {
    const c = preflight.census(live);
    assert.ok(c.users >= 1);
    assert.ok(Object.keys(c).length > 20, 'expected the full schema, got ' + Object.keys(c).length + ' tables');
  });

  it('passes on the tree it ships with, and migrates only the copy', () => {
    // Rewind the live database behind the migration that added fallback_last —
    // the state a server about to be updated is actually in — and check that
    // preflight leaves it there.
    //
    // The two version numbers used to be written out: delete 76, expect 75.
    // That made this test a tripwire on every migration added afterwards, which
    // is a false alarm about the wrong file: adding migration 77 broke an
    // assertion about migration 76 having not run. Both numbers are derived
    // now. FALLBACK_MIGRATION is the only one still named, because it is the
    // one whose column this rewind actually drops.
    const FALLBACK_MIGRATION = 76;
    const vorher = (() => {
      const d = new DatabaseSync(live, { readOnly: true });
      const v = d.prepare('SELECT MAX(version) AS v FROM schema_version').get().v;
      d.close();
      return v;
    })();
    const r = new DatabaseSync(live);
    r.exec('ALTER TABLE duckdns_config DROP COLUMN fallback_last');
    r.prepare('DELETE FROM schema_version WHERE version >= ?').run(FALLBACK_MIGRATION);
    r.close();
    const zurueckgesetztAuf = (() => {
      const d = new DatabaseSync(live, { readOnly: true });
      const v = d.prepare('SELECT MAX(version) AS v FROM schema_version').get().v;
      d.close();
      return v;
    })();
    assert.ok(zurueckgesetztAuf < vorher, 'the rewind did not actually move the live database back');

    assert.equal(preflight.main(['--quiet'], Object.assign({ dbFile: live }, silent)), 0);

    const after = new DatabaseSync(live, { readOnly: true });
    const v = after.prepare('SELECT MAX(version) AS v FROM schema_version').get().v;
    const col = after
      .prepare("SELECT COUNT(*) AS c FROM pragma_table_info('duckdns_config') WHERE name='fallback_last'")
      .get().c;
    after.close();
    assert.equal(v, zurueckgesetztAuf, 'the live database must still be unmigrated');
    assert.equal(col, 0, 'and must not have gained the column');
  });

  it('says so rather than guessing when there is no database', () => {
    const lines = [];
    const code = preflight.main([], { dbFile: path.join(dir, 'nope.db'), out: () => {}, err: (m) => lines.push(m) });
    assert.equal(code, 2);
    assert.ok(lines.some((l) => /no database at/.test(l)));
  });
});

describe('the snapshot reads through the WAL and writes nothing back', () => {
  // The handle used to be opened with `readonly`, which node:sqlite ignores, so
  // it was read-write. Under a running server that changes nothing. After a
  // crash it does: closing last, a read-write handle checkpoints the dead
  // server's WAL into the live file. Each case below holds rows only in the
  // -wal, so the snapshot has to read through it, and the file and the -wal
  // have to come out byte for byte as they went in.
  const ROWS = 40;
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_pf_wal_'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** A writer in WAL mode that never checkpoints: its rows live in the -wal. */
  function writer(file) {
    const w = new DatabaseSync(file);
    w.exec('PRAGMA journal_mode = WAL');
    w.exec('PRAGMA wal_autocheckpoint = 0');
    w.exec('CREATE TABLE t (v TEXT)');
    return w;
  }

  function write(w, from, to) {
    const ins = w.prepare('INSERT INTO t (v) VALUES (?)');
    for (let i = from; i < to; i++) ins.run('row ' + i);
  }

  function rows(file) {
    const c = new DatabaseSync(file, { readOnly: true });
    try {
      return c.prepare('SELECT COUNT(*) AS n FROM t').get().n;
    } finally {
      c.close();
    }
  }

  function assertUntouched(live, db, wal) {
    assert.ok(fs.readFileSync(live).equals(db), 'the database file must not be written');
    assert.ok(
      fs.existsSync(live + '-wal') && fs.readFileSync(live + '-wal').equals(wal),
      'and the -wal must not be checkpointed into it'
    );
  }

  it('under a running server, the way the deploy chain calls it', () => {
    const live = path.join(dir, 'running.db');
    const server = writer(live);
    try {
      write(server, 0, ROWS);
      const db = fs.readFileSync(live);
      const wal = fs.readFileSync(live + '-wal');
      const snap = path.join(dir, 'running-snap.db');
      preflight.snapshot(live, snap);
      assert.equal(rows(snap), ROWS, 'the snapshot must have the rows only the -wal holds');
      assertUntouched(live, db, wal);
    } finally {
      server.close();
    }
  });

  // What a killed server leaves: its files as they stood mid-run, held by no
  // process, so whoever opens them next has to rebuild the WAL index. Copying
  // them while the writer is still open gives exactly that without killing
  // anything. The -shm can survive a crash as it was, as an older copy that
  // describes fewer frames than the -wal holds, or not at all.
  //
  // Read and rewritten rather than copyFileSync: a plain read goes through
  // libuv's open, which shares the file with a writer on Windows as well, and
  // CopyFile there may not.
  const copy = (from, to) => fs.writeFileSync(to, fs.readFileSync(from));
  for (const shm of ['as it was', 'stale', 'missing']) {
    it('after a crash, with the -shm ' + shm, () => {
      const name = 'crashed-' + shm.replace(/ /g, '-');
      const src = path.join(dir, name + '-writer.db');
      const live = path.join(dir, name + '.db');
      const w = writer(src);
      write(w, 0, ROWS / 2);
      const earlierShm = fs.readFileSync(src + '-shm');
      write(w, ROWS / 2, ROWS);
      copy(src, live);
      copy(src + '-wal', live + '-wal');
      if (shm === 'as it was') copy(src + '-shm', live + '-shm');
      if (shm === 'stale') fs.writeFileSync(live + '-shm', earlierShm);
      w.close();

      const db = fs.readFileSync(live);
      const wal = fs.readFileSync(live + '-wal');
      const snap = path.join(dir, name + '-snap.db');
      preflight.snapshot(live, snap);
      assert.equal(rows(snap), ROWS, 'the snapshot must have the rows only the -wal holds');
      assertUntouched(live, db, wal);
    });
  }
});

describe('a tree that would not start', () => {
  let dir, live, code;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_pf_bad_'));
    // A copy of everything preflight loads, so one of them can be broken
    // without touching the repository.
    for (const f of preflight.MODULES.concat(['server.js', 'app.js', 'login.js', 'sw.js'])) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    }
    live = path.join(dir, 'meistertracker.db');
    db.openDb(live).close();
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('refuses a module with a syntax error instead of letting pm2 find it', () => {
    const good = fs.readFileSync(path.join(dir, 'shipping.js'), 'utf8');
    fs.writeFileSync(path.join(dir, 'shipping.js'), 'function ( {{{ broken\n');
    const lines = [];
    code = preflight.main(['--quiet'], { dir, dbFile: live, out: () => {}, err: (m) => lines.push(m) });
    fs.writeFileSync(path.join(dir, 'shipping.js'), good);
    assert.equal(code, 1);
    assert.ok(
      lines.some((l) => /SYNTAX ERROR in shipping\.js/.test(l)),
      'expected the file to be named, got: ' + lines.join(' | ')
    );
  });

  it('refuses a module that parses but throws on load', () => {
    const good = fs.readFileSync(path.join(dir, 'channels.js'), 'utf8');
    fs.writeFileSync(path.join(dir, 'channels.js'), "throw new Error('boom at load time');\n");
    const lines = [];
    const c = preflight.main(['--quiet'], { dir, dbFile: live, out: () => {}, err: (m) => lines.push(m) });
    fs.writeFileSync(path.join(dir, 'channels.js'), good);
    assert.equal(c, 1);
    assert.ok(
      lines.some((l) => /MODULE FAILED TO LOAD: channels\.js/.test(l) && /boom at load time/.test(l)),
      'expected the module and the reason, got: ' + lines.join(' | ')
    );
  });

  it('refuses a missing file rather than reporting success', () => {
    const good = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
    fs.unlinkSync(path.join(dir, 'sw.js'));
    const lines = [];
    const c = preflight.main(['--quiet'], { dir, dbFile: live, out: () => {}, err: (m) => lines.push(m) });
    fs.writeFileSync(path.join(dir, 'sw.js'), good);
    assert.equal(c, 1);
    assert.ok(lines.some((l) => /missing file: sw\.js/.test(l)));
  });

  // The script the webhook deploy is built from. A version that cannot load it
  // is a server that cannot start, taking the webhook that would deliver the
  // fix down with it.
  it('refuses a broken scripts/deploy-chain.js', () => {
    const file = path.join(dir, 'scripts', 'deploy-chain.js');
    const good = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, 'module.exports = { broken: ( };\n');
    const lines = [];
    const c = preflight.main(['--quiet'], { dir, dbFile: live, out: () => {}, err: (m) => lines.push(m) });
    fs.writeFileSync(file, good);
    assert.equal(c, 1);
    assert.ok(
      lines.some((l) => /SYNTAX ERROR in scripts\/deploy-chain\.js/.test(l)),
      'expected the file to be named, got: ' + lines.join(' | ')
    );
  });
});

// MODULES is a list kept by hand, and it had already fallen behind: three of the
// scripts server.js requires at start-up were missing, so a version that broke
// one of them passed the preflight and then could not start. This reads the list
// off server.js instead of trusting anyone to remember.
describe('the preflight loads everything server.js loads at start-up', () => {
  it('lists every local module server.js requires at the top level', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const loaded = [...src.matchAll(/^(?:const|let|var)\b[^\n=]*=\s*require\('\.\/([^']+\.js)'\)/gm)].map((m) => m[1]);
    assert.ok(loaded.length >= 10, 'the pattern no longer finds the requires: ' + loaded.join(', '));
    const missing = loaded.filter((f) => !preflight.MODULES.includes(f));
    assert.deepEqual(missing, [], 'server.js loads these at start-up, but the preflight never does');
  });
});

describe('the deploy uses it, and can undo itself', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'update_server.sh'), 'utf8');

  it('runs the preflight before the process is stopped', () => {
    const pre = sh.indexOf('scripts/preflight.js');
    const stop = sh.indexOf('pm2 delete "$PM2_PROCESS_NAME"');
    assert.ok(pre > 0, 'update_server.sh should run the preflight');
    assert.ok(pre < stop, 'the check has to happen while the old server is still serving');
  });

  it('aborts the deploy when the preflight refuses', () => {
    const fn = sh.slice(sh.indexOf('run_preflight'), sh.indexOf('do_start()'));
    assert.match(fn, /exit 1/);
  });

  it('rolls back to the last known-good commit when the new code will not start', () => {
    // The crash was already detected; what was missing is that anything
    // happened afterwards. Leaving production down until somebody reads the
    // log is not a deploy strategy.
    const crash = sh.slice(sh.indexOf('ERROR: Server process crashed on startup'));
    assert.match(crash, /rollback_to_stable/, 'a detected crash must do something, not just report');

    const fn = sh.slice(sh.indexOf('rollback_to_stable() {'), sh.indexOf('do_update() {'));
    assert.match(fn, /git reset --hard stable/, 'restore the commit last known to have started');
    assert.match(fn, /pm2 start/, 'and bring the old version back up');
    assert.match(fn, /rev-parse --verify stable/, 'and say so plainly if there is no such commit');
    assert.match(fn, /IS_WORKTREE/, 'a worktree must never rewrite its own tree from a prod tag');
  });
});
