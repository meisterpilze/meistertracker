'use strict';
// R-15: photo-directory size cap regression tests. The cap helper lives in
// scripts/photo-cap.js so we can test it without standing up an HTTP server.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { computePhotoDirSize, enforceCap, PhotoCapError } = require('../scripts/photo-cap.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt-photo-cap-'));
}

describe('R-15 — photo directory size cap', () => {
  let dir;
  before(() => {
    dir = tmpDir();
  });
  after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('computePhotoDirSize returns 0 for an empty/missing dir', () => {
    assert.equal(computePhotoDirSize(path.join(dir, 'does-not-exist')), 0);
    assert.equal(computePhotoDirSize(dir), 0);
  });

  it('computePhotoDirSize sums file sizes recursively', () => {
    const sub = path.join(dir, '2026', '04', '7');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'a.jpg'), Buffer.alloc(1024));
    fs.writeFileSync(path.join(sub, 'a_thumb.jpg'), Buffer.alloc(100));
    const sub2 = path.join(dir, '2026', '04', '8');
    fs.mkdirSync(sub2, { recursive: true });
    fs.writeFileSync(path.join(sub2, 'b.jpg'), Buffer.alloc(2048));
    assert.equal(computePhotoDirSize(dir), 1024 + 100 + 2048);
  });

  it('enforceCap allows writes when under cap', () => {
    assert.equal(enforceCap(1000, 500, 5000), true);
  });

  it('enforceCap throws PhotoCapError when write would exceed cap', () => {
    assert.throws(
      () => enforceCap(4500, 600, 5000),
      (e) => e instanceof PhotoCapError && /directory full/.test(e.message)
    );
  });

  it('enforceCap throws even on the first byte over the cap', () => {
    assert.throws(
      () => enforceCap(0, 5001, 5000),
      (e) => e instanceof PhotoCapError
    );
  });

  it('end-to-end: write photos until just under cap, next write fails', () => {
    const e2eDir = tmpDir();
    try {
      const cap = 10 * 1024; // 10 KB cap
      // Fill to 9 KB
      const photoDir = path.join(e2eDir, '2026', '04', '7');
      fs.mkdirSync(photoDir, { recursive: true });
      fs.writeFileSync(path.join(photoDir, 'p1.jpg'), Buffer.alloc(9 * 1024));
      const used = computePhotoDirSize(e2eDir);
      assert.equal(used, 9 * 1024);
      // 1.5 KB more should fail (9 + 1.5 > 10)
      assert.throws(() => enforceCap(used, 1536, cap), PhotoCapError);
      // 1 KB more is right at the boundary — under (9216 + 1024 = 10240 = cap, not >)
      assert.equal(enforceCap(used, 1024, cap), true);
    } finally {
      fs.rmSync(e2eDir, { recursive: true, force: true });
    }
  });
});
