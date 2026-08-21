'use strict';
// Who can read the server's private keys.
//
// Two writes in the ACME path had no `mode`:
//
//   fs.writeFileSync(ACME_ACCOUNT_KEY_PATH, privateKey.export(...))
//   fs.writeFileSync(CERT_KEY, domainKey.export(...))
//
// so both landed at 0666 & ~umask — 0644 on a normal host. That is the TLS
// private key for the domain, and the ACME account key, which is enough on its
// own to have fresh certificates issued for that domain. Any local account on
// the box could read them. The codebase clearly knew the pattern: BACKUP_DIR is
// created 0700 and the restore temp file is written 0600. These two were missed,
// and gen-cert.sh had the same gap via openssl's umask.
//
// The renewal case is the one worth a test. `mode` on writeFileSync only
// applies when the call *creates* the file — an overwrite keeps whatever
// permissions the old file had. A host that already has a 0644 key from before
// this fix would therefore have stayed 0644 through every renewal, which is the
// opposite of what the change is for. Hence the explicit chmod, and hence the
// second test below.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// server.js starts listening on require, so the helpers are lifted out of the
// source and given their own fs and log — the approach test/setup-guard.test.js
// uses for the setup predicate.
function lift(name) {
  const m = SRC.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
  assert.ok(m, name + ' is gone from server.js');
  return { src: m[0], warnings: [] };
}

function build() {
  const warnings = [];
  const log = (level, msg, meta) => warnings.push({ level, msg, meta });
  const fns = new Function(
    'fs',
    'log',
    lift('writePrivateFile').src +
      '\n' +
      lift('ensurePrivateDir').src +
      '\nreturn { writePrivateFile, ensurePrivateDir };'
  )(fs, log);
  return { ...fns, warnings };
}

const mode = (p) => fs.statSync(p).mode & 0o777;

// The four tests below assert a POSIX permission bitmask. NTFS has no such
// thing: Node reports 0666 for every file it creates on Windows and chmod is a
// no-op there, so they fail on a developer's machine while saying nothing about
// the code. The deployment target is Linux, CI is Linux, and that is where the
// assertion is worth making — so skip the mode checks off POSIX rather than
// weaken them. Everything else in this file reads source text and runs
// everywhere, including the EPERM test below, which stubs chmod itself.
const POSIX = process.platform !== 'win32';
const notPosix = { skip: POSIX ? false : 'POSIX file modes: Windows reports 0666 and chmod is a no-op' };

describe('private key files', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_keys_'));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a new key readable only by the owner', notPosix, () => {
    const { writePrivateFile } = build();
    const f = path.join(dir, 'fresh.key');
    writePrivateFile(f, '-----BEGIN PRIVATE KEY-----\n');
    assert.equal(mode(f), 0o600, 'expected 0600, got 0' + mode(f).toString(8));
  });

  it('tightens a key that is already there — the renewal case', notPosix, () => {
    const { writePrivateFile } = build();
    const f = path.join(dir, 'old.key');
    // Exactly what a host deployed before this fix has on disk.
    fs.writeFileSync(f, 'old', { mode: 0o644 });
    fs.chmodSync(f, 0o644);
    assert.equal(mode(f), 0o644, 'precondition');
    writePrivateFile(f, 'renewed');
    assert.equal(mode(f), 0o600, 'a renewal must not inherit the old permissions');
    assert.equal(fs.readFileSync(f, 'utf8'), 'renewed');
  });

  it('does not survive a umask that would loosen it', notPosix, () => {
    const { writePrivateFile } = build();
    const prev = process.umask(0o000);
    try {
      const f = path.join(dir, 'umask.key');
      writePrivateFile(f, 'k');
      assert.equal(mode(f), 0o600);
    } finally {
      process.umask(prev);
    }
  });

  it('creates the key directory 0700, and tightens an existing one', notPosix, () => {
    const { ensurePrivateDir } = build();
    const fresh = path.join(dir, 'certs-new');
    ensurePrivateDir(fresh);
    assert.equal(mode(fresh), 0o700);

    const loose = path.join(dir, 'certs-old');
    fs.mkdirSync(loose, { mode: 0o755 });
    fs.chmodSync(loose, 0o755);
    ensurePrivateDir(loose);
    assert.equal(mode(loose), 0o700);
  });

  it('warns instead of throwing when the permissions cannot be set', () => {
    // A key owned by someone else: chmod raises EPERM. Refusing to start over
    // that would be worse than running with a warning in the log.
    const warnings = [];
    const stubFs = {
      writeFileSync: () => {},
      chmodSync: () => {
        const e = new Error('EPERM: operation not permitted');
        e.code = 'EPERM';
        throw e;
      }
    };
    const { writePrivateFile } = new Function(
      'fs',
      'log',
      lift('writePrivateFile').src + '\nreturn { writePrivateFile };'
    )(stubFs, (level, msg, meta) => warnings.push({ level, msg, meta }));
    assert.doesNotThrow(() => writePrivateFile('/nowhere/x.key', 'k'));
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].level, 'warn');
    assert.match(warnings[0].msg, /permissions/i);
  });
});

describe('the key writes go through the helper', () => {
  it('ACME account key', () => {
    assert.match(SRC, /writePrivateFile\(ACME_ACCOUNT_KEY_PATH,/);
    assert.equal(/fs\.writeFileSync\(ACME_ACCOUNT_KEY_PATH/.test(SRC), false);
  });

  it('TLS domain key', () => {
    assert.match(SRC, /writePrivateFile\(CERT_KEY,/);
    assert.equal(/fs\.writeFileSync\(CERT_KEY/.test(SRC), false);
  });

  it('the certificate itself stays world-readable — it is public', () => {
    assert.match(SRC, /fs\.writeFileSync\(CERT_CRT, certPem\);/);
  });
});

describe('gen-cert.sh', () => {
  const SH = fs.readFileSync(path.join(ROOT, 'gen-cert.sh'), 'utf8');

  it('restricts the directory and the key, and leaves the crt readable', () => {
    assert.match(SH, /chmod 700 "\$CERT_DIR"/);
    assert.match(SH, /chmod 600 "\$CERT_DIR\/server\.key"/);
    assert.match(SH, /chmod 644 "\$CERT_DIR\/server\.crt"/);
  });

  it('chmods the key after openssl has written it, not before', () => {
    assert.ok(
      SH.indexOf('openssl req') < SH.indexOf('chmod 600'),
      'chmod before generation would be undone by openssl'
    );
  });
});
