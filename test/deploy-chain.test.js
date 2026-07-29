'use strict';
// The GitHub auto-deploy spawns a shell command built by string concatenation:
// a quoted `cd`, JSON echoed into a quoted path, chained with && and a || fallback.
// On Windows that string only survives if it is passed to cmd.exe verbatim —
// Node's default argv escaping turns the quotes into \" , which cmd.exe cannot
// parse, so it exits 1 having run nothing at all. That failure is invisible: the
// deploy writes neither its success nor its failed sentinel, the files are never
// pulled, and the server keeps serving the previous release.
//
// These tests exercise the spawn shape itself with harmless commands, so a
// regression is caught here instead of by noticing weeks later that production
// has been stale.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';

function tmpFile(tag) {
  return path.join(
    os.tmpdir(),
    'mt_deploy_' + tag + '_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.json'
  );
}

// Mirrors the shape server.js builds: quoted cd, a JSON payload echoed into a
// quoted destination, && chaining and a || fallback.
function buildWindowsChain(dir, stateFile, sha) {
  return (
    'cd /d "' +
    dir +
    '" &&' +
    ' (echo {"status":"success","sha":"' +
    sha +
    '","started":"2026-07-29T18:00:00.000Z","completed":""} > "' +
    stateFile +
    '") &&' +
    ' echo ok ||' +
    ' (echo {"status":"failed","sha":"' +
    sha +
    '"} > "' +
    stateFile +
    '")'
  );
}

function runChain(opts, stateFile, cb) {
  const cmd = buildWindowsChain(os.tmpdir(), stateFile, 'deadbeef');
  const child = spawn('cmd.exe', ['/c', cmd], { cwd: os.tmpdir(), stdio: 'ignore', ...opts });
  child.on('exit', (code) => cb(null, code));
  child.on('error', (e) => cb(e));
}

describe('auto-deploy chain spawn', { skip: isWin ? false : 'Windows-only (cmd.exe quoting)' }, () => {
  it('cmd.exe parses the chain when arguments are passed verbatim', (t, done) => {
    const f = tmpFile('verbatim');
    runChain({ detached: true, windowsVerbatimArguments: true }, f, (err, code) => {
      try {
        assert.equal(err, null, 'spawn must not error');
        assert.equal(code, 0, 'cmd.exe must parse and run the chain');
        const written = JSON.parse(fs.readFileSync(f, 'utf8'));
        assert.equal(written.status, 'success', 'the success sentinel must be written');
        assert.equal(written.sha, 'deadbeef', 'the sha must survive the quoting intact');
        done();
      } catch (e) {
        done(e);
      } finally {
        try {
          fs.unlinkSync(f);
        } catch (e2) {
          /* ignore */
        }
      }
    });
  });

  // Guards the actual regression: without the flag Node escapes the quotes and
  // cmd.exe bails before running a single step, leaving no sentinel behind. If
  // this ever starts passing, Node changed its escaping and the comment in
  // server.js should be revisited — but the verbatim flag stays correct either way.
  it('without the verbatim flag cmd.exe bails and writes no sentinel', (t, done) => {
    const f = tmpFile('escaped');
    runChain({ detached: true }, f, (err, code) => {
      try {
        assert.equal(err, null, 'spawn itself still succeeds — that is why it looks fine');
        assert.notEqual(code, 0, 'cmd.exe cannot parse backslash-escaped quotes');
        assert.equal(fs.existsSync(f), false, 'neither success nor failed sentinel is written — the silent failure');
        done();
      } catch (e) {
        done(e);
      } finally {
        try {
          fs.unlinkSync(f);
        } catch (e2) {
          /* ignore */
        }
      }
    });
  });
});
