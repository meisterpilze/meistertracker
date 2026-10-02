'use strict';
// node:sqlite spells the option `readOnly`. It ignores option names it does
// not know, so the lowercase spelling opens a read-write handle without a word
// of complaint. That is how the preflight snapshot, the backup check and the
// DuckDNS probe all came to promise a read-only handle they did not have, with
// a comment saying otherwise on each. Nothing at runtime would ever say so.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');

/** Our own .js files: no dependencies, no vendored bundles, no other worktrees. */
function ownJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'lib') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...ownJs(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

describe('read-only SQLite handles', () => {
  it('are read-only on this Node when spelled readOnly', () => {
    // Every fix of the spelling rests on this. A Node old enough not to know
    // the option would ignore it just as quietly.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_ro_'));
    try {
      const file = path.join(dir, 'x.db');
      new DatabaseSync(file).close();
      const ro = new DatabaseSync(file, { readOnly: true });
      try {
        assert.throws(() => ro.exec('CREATE TABLE t (v)'), /readonly database/);
      } finally {
        ro.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('are never asked for with the lowercase spelling', () => {
    const hits = [];
    for (const file of ownJs(ROOT)) {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes('node:sqlite')) continue;
      src.split('\n').forEach((line, i) => {
        if (/\breadonly\s*:/.test(line)) hits.push(path.relative(ROOT, file) + ':' + (i + 1));
      });
    }
    assert.deepEqual(hits, [], 'node:sqlite ignores `readonly` and opens read-write; the option is readOnly');
  });
});
