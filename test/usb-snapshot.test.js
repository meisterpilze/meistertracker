'use strict';
// The database copy a stick run encrypts: made under backups/ with a name the
// start-up sweep knows, and gone again when the copy fails half-way.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle('server.js');

function snapshotForStick(BACKUP_DIR, db) {
  return new Function(
    'path',
    'fs',
    'crypto',
    'BACKUP_DIR',
    'db',
    'database',
    hebeFunktion('snapshotForStick', SRC) + '\nreturn snapshotForStick;'
  )(path, fs, crypto, BACKUP_DIR, db, {});
}

describe('the database copy for a stick run', () => {
  it('is made under backups/ with the prefix the start-up sweep removes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_snap_'));
    const make = snapshotForStick(dir, { backupDb: async (d, p) => fs.writeFileSync(p, 'SQLite format 3\0') });
    const p = await make();
    assert.equal(path.dirname(p), dir);
    assert.match(path.basename(p), /^_usb_tmp_[0-9a-f]{16}\.db$/);
  });

  it('leaves nothing behind when the copy fails half-way', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_snap_'));
    const make = snapshotForStick(dir, {
      backupDb: async (d, p) => {
        fs.writeFileSync(p, 'half a database');
        fs.writeFileSync(p + '-journal', 'j');
        throw Object.assign(new Error('disk I/O error'), { code: 'ERR_SQLITE_ERROR' });
      }
    });
    await assert.rejects(make(), /disk I\/O error/);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});
