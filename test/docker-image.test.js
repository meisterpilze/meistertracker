'use strict';
// Whether the container can actually start.
//
// The Dockerfile's COPY list named server.js, db.js, app.js and mcp-server.js
// and stopped there. server.js also requires channels.js, harvest-feed.js and
// shipping.js at the top level, and none of the three was in the image. The
// build succeeded — nothing in a Docker build resolves a require — and
// `docker run` exited immediately with MODULE_NOT_FOUND.
//
// That is the failure mode worth testing: it is invisible until deploy, and the
// list is edited by hand every time a module is added. So rather than pinning
// the three names that were missing, this walks the require graph from the
// entry point and checks every local module against what the image contains.
// Building the image in CI would catch it too, at rather more than a
// millisecond.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCKERFILE = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');

/** Paths the image ends up containing, as written in the COPY lines. */
function copiedPaths() {
  const out = new Set();
  for (const line of DOCKERFILE.split('\n')) {
    const m = line.match(/^COPY\s+(.+)$/);
    if (!m) continue;
    const parts = m[1].trim().split(/\s+/);
    parts.pop(); // the destination
    for (const p of parts) out.add(p.replace(/\/$/, ''));
  }
  return out;
}

/** Local modules reachable from `entry`, transitively. Relative to the repo root. */
function localRequires(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/require\('(\.[^']+)'\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
      if (!target.endsWith('.json')) queue.push(target);
      else seen.add(target);
    }
  }
  seen.delete(entry);
  return [...seen];
}

describe('the Dockerfile copies everything the server needs', () => {
  const copied = copiedPaths();
  const covered = (rel) => copied.has(rel) || copied.has(path.posix.dirname(rel));

  it('copies the entry point itself', () => {
    assert.ok(copied.has('server.js'));
    assert.match(DOCKERFILE, /CMD \["node", "server\.js"\]/);
  });

  for (const rel of localRequires('server.js')) {
    it('copies ' + rel, () => {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), rel + ' is required but not in the repository');
      assert.ok(covered(rel), rel + ' is required by the server but never COPYed into the image');
    });
  }

  it('the three that were missing are named explicitly', () => {
    // Belt and braces: if the graph walk above ever stops finding them (a
    // dynamic require, a refactor into a directory), this still fails.
    for (const f of ['channels.js', 'harvest-feed.js', 'shipping.js']) {
      assert.ok(copied.has(f), f + ' is back out of the image');
    }
  });

  it('copies the static files the server serves by name', () => {
    const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const staticBlock = SRC.slice(SRC.indexOf('// Static files'), SRC.indexOf('// Path traversal protection'));
    for (const m of staticBlock.matchAll(/path\.join\(DIR, '([^']+)'\)/g)) {
      assert.ok(copied.has(m[1]) || copied.has(path.posix.dirname(m[1])), m[1] + ' is served but not in the image');
    }
  });

  it('still runs as a non-root user', () => {
    assert.match(DOCKERFILE, /adduser/);
    assert.match(DOCKERFILE, /^USER app$/m);
    assert.ok(DOCKERFILE.indexOf('\nUSER app') < DOCKERFILE.indexOf('CMD ['), 'USER has to come before CMD');
  });
});
