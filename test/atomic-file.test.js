'use strict';
// One way of writing backup files: whole or not at all, a held rename waited
// out, and no temporary file left behind when it fails for good.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeFileAtomic, LEFTOVER } = require('../scripts/atomic-file.js');
const { listFiles } = require('../scripts/photo-mirror.js');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt_atomic_'));
}
const QUICK = [1, 1, 1];

describe('writeFileAtomic', () => {
  const rename = fs.promises.rename;
  afterEach(() => {
    fs.promises.rename = rename;
  });

  it('writes the file whole and leaves nothing beside it', async () => {
    const dir = tmp();
    const file = path.join(dir, 'a.json');
    await writeFileAtomic(file, '{"a":1}');
    assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}');
    assert.deepEqual(fs.readdirSync(dir), ['a.json']);
  });

  it('waits out a rename that a virus scanner holds for a moment', async () => {
    const dir = tmp();
    const file = path.join(dir, 'b.bin');
    let left = 2;
    fs.promises.rename = async (from, to) => {
      if (left-- > 0) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      return rename(from, to);
    };
    await writeFileAtomic(file, Buffer.from('photo'), { waits: QUICK });
    assert.equal(fs.readFileSync(file, 'utf8'), 'photo');
    assert.deepEqual(fs.readdirSync(dir), ['b.bin']);
  });

  it('gives up on a rename held for good, says it was held, and takes its temporary file with it', async () => {
    const dir = tmp();
    const file = path.join(dir, 'c.bin');
    let tries = 0;
    fs.promises.rename = async () => {
      tries++;
      throw Object.assign(new Error('resource busy'), { code: 'EBUSY' });
    };
    await assert.rejects(writeFileAtomic(file, 'x', { waits: QUICK }), (e) => e.code === 'EBUSY' && e.held === true);
    assert.equal(tries, QUICK.length + 1);
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  it('does not wait on a failure that is not a held file', async () => {
    const dir = tmp();
    fs.promises.rename = async () => {
      throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
    };
    await assert.rejects(writeFileAtomic(path.join(dir, 'd'), 'x', { waits: QUICK }), (e) => !e.held);
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  it('removes its temporary file when the write itself fails', async () => {
    const dir = tmp();
    await assert.rejects(writeFileAtomic(path.join(dir, 'e'), 12345));
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

describe('leftovers of a write cut short', () => {
  it('are recognised by name', () => {
    assert.ok(LEFTOVER.test('a.jpg.tmp-1a2b3c4d'));
    assert.ok(!LEFTOVER.test('a.jpg'));
    assert.ok(!LEFTOVER.test('a.tmp-1a2b3c4d.jpg'));
  });

  it('are never listed as photos, so they are neither mirrored nor put on a stick', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, '2026'));
    fs.writeFileSync(path.join(dir, '2026', 'a.jpg'), 'a');
    fs.writeFileSync(path.join(dir, '2026', 'a.jpg.tmp-1a2b3c4d'), 'half');
    assert.deepEqual([...(await listFiles(dir)).keys()], ['2026/a.jpg']);
  });
});
