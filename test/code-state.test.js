'use strict';
// Which state of the code a server is running.
//
// package.json says 1.0.0 and always has, so the Server tab could not tell
// whether an update had arrived. That mattered for real: an update whose
// `git fetch` fails carries on with the old code and only says so in a console
// window nobody looks at. The commit and its date answer the question from any
// admin's phone.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { ROOT, quelle, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle('server.js');
const readCodeState = new Function('execFile', hebeFunktion('readCodeState', SRC) + '\nreturn readCodeState;')(
  execFile
);
const lesen = (dir) => new Promise((fertig) => readCodeState(dir, fertig));

describe('the code state', () => {
  it('reads the commit and its date from git', async (t) => {
    let erwartet;
    try {
      erwartet = execFileSync('git', ['log', '-1', '--format=%h'], { cwd: ROOT }).toString().trim();
    } catch {
      t.skip('no git here');
      return;
    }
    const stand = await lesen(ROOT);
    assert.equal(stand.commit, erwartet);
    assert.ok(!Number.isNaN(Date.parse(stand.date)), 'the date is a date: ' + stand.date);
  });

  it('is null where there is no repository, instead of failing start-up', async () => {
    const leer = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_codestand_'));
    try {
      assert.equal(await lesen(leer), null);
    } finally {
      fs.rmSync(leer, { recursive: true, force: true });
    }
  });

  it('is read once at start-up, not on every health check', () => {
    assert.equal(SRC.split('readCodeState(').length - 1, 2, 'one definition, one call');
    assert.match(SRC, /^readCodeState\(DIR, /m);
  });
});

describe('the Server tab', () => {
  function tab(h) {
    const el = { innerHTML: '', textContent: '' };
    const run = new Function(
      'el',
      'h',
      `
      const document = { getElementById: () => el };
      const currentUser = { role: 'admin' };
      const t = (k) => k;
      const authFetch = async () => ({ json: async () => h });
      ${['esc', 'fmtDt', 'fmtDtTime', 'loadServerTab'].map((n) => hebeFunktion(n)).join('\n')}
      return loadServerTab();`
    );
    return run(el, h).then(() => el.innerHTML);
  }
  const health = { status: 'ok', version: '1.0.0', platform: 'win32', nodeVersion: 'v22', uptime: 60, sseClients: 1 };

  it('shows the commit and when it was made', async () => {
    const html = await tab({ ...health, code: { commit: 'abc1234', date: '2026-09-30T19:07:00+02:00' } });
    assert.match(html, /server\.codeLabel:<\/b> abc1234 · \d\d\.\d\d\.\d\d \d\d:\d\d/);
  });

  it('shows a dash when the server has no git', async () => {
    const html = await tab({ ...health, code: null });
    assert.ok(html.includes('server.codeLabel:</b> –'));
  });
});
