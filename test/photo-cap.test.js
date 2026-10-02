'use strict';
// R-15: photo-directory size cap regression tests. The cap helper lives in
// scripts/photo-cap.js so we can test it without standing up an HTTP server.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  computePhotoDirSize,
  enforceCap,
  removeContaminationPhotos,
  experimentPhotoScope,
  PhotoCapError,
  enforceFreeSpace
} = require('../scripts/photo-cap.js');

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

// The admin reset clears contamination reports and used to remove the whole
// photo directory with them. Experiment photos live in the same tree, under
// {year}/{month}/exp-{id}/, and the reset keeps experiments, so every
// experiment was left pointing at files that were gone. The pre-reset backup
// covers the database only, so nothing brought them back.
describe('reset — removes contamination photos, keeps experiment photos', () => {
  it('removes report folders and stray files, and leaves exp-* folders alone', () => {
    const dir = tmpDir();
    try {
      const put = (rel, bytes) => {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), Buffer.alloc(bytes));
      };
      put('2026/04/7/a.jpg', 100);
      put('2026/04/7/a_thumb.jpg', 10);
      // Die Ordner so benannt, wie der Upload sie benennt.
      put('2026/04/' + experimentPhotoScope(3) + '/b.jpg', 200);
      put('2026/05/12/c.jpg', 300);
      put('2026/05/' + experimentPhotoScope(4) + '/d.jpg', 400);
      put('2026/05/stray.jpg', 5);
      put('stray.txt', 5);
      assert.equal(removeContaminationPhotos(dir), 4);
      assert.equal(fs.existsSync(path.join(dir, '2026/04/7')), false);
      assert.equal(fs.existsSync(path.join(dir, '2026/05/12')), false);
      assert.equal(fs.existsSync(path.join(dir, '2026/05/stray.jpg')), false);
      assert.equal(fs.existsSync(path.join(dir, 'stray.txt')), false);
      assert.equal(computePhotoDirSize(dir), 200 + 400, 'only the experiment photos are left');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is the name the upload gives an experiment folder', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(src.includes('savePhotoToDisk(photoCap.experimentPhotoScope(data.experimentId)'));
  });

  it('does nothing when the directory does not exist', () => {
    assert.equal(removeContaminationPhotos(path.join(os.tmpdir(), 'mt-photo-cap-missing-' + Date.now())), 0);
  });

  function resetRoute() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = src.indexOf("req.url === '/api/admin/reset'");
    assert.ok(start > 0, 'reset route not found in server.js');
    return src.slice(start, src.indexOf('\n  // -- Contamination reports --', start));
  }

  it('is what the reset route calls, instead of removing the directory', () => {
    const route = resetRoute();
    assert.ok(route.includes('photoCap.removeContaminationPhotos(PHOTO_DIR)'));
    assert.equal(route.includes('fs.rmSync(PHOTO_DIR'), false);
  });

  // The cached total the cap compares against only follows the disk when it is
  // told to. A removal that throws partway has still deleted files, so the
  // rescan cannot sit in the same try.
  it('recounts the directory whether or not the removal got through', () => {
    const route = resetRoute();
    const attempt = route.slice(
      route.indexOf('photoCap.removeContaminationPhotos(PHOTO_DIR)'),
      route.indexOf('} catch (fileErr)')
    );
    assert.equal(attempt.includes('_ensurePhotoDirSize'), false, 'the rescan sits inside the try again');
    assert.ok(
      route.indexOf('_ensurePhotoDirSize(true)') > route.indexOf("'Reset: photo cleanup failed'"),
      'the rescan must follow the removal and its catch'
    );
  });
});

describe('the free space the disk keeps', () => {
  const GB = 1024 * 1024 * 1024;
  const platte = (frei) => () => ({ bavail: frei / 4096, bsize: 4096 });

  it('lets a photo through while enough stays free, and says how much stays', () => {
    assert.equal(enforceFreeSpace('/x', 5 * 1024 * 1024, 2 * GB, platte(10 * GB)), 10 * GB - 5 * 1024 * 1024);
  });

  it('refuses the photo that would leave less than the reserve', () => {
    assert.throws(
      () => enforceFreeSpace('/x', 2 * 1024 * 1024, 2 * GB, platte(2 * GB + 1024 * 1024)),
      (e) => e instanceof PhotoCapError && /2\.0 GB must stay free, see PHOTO_MIN_FREE_GB/.test(e.message)
    );
  });

  it('names a floor below a gigabyte in megabytes', () => {
    assert.throws(
      () => enforceFreeSpace('/x', 1, 256 * 1024 * 1024, platte(100 * 1024 * 1024)),
      (e) => e instanceof PhotoCapError && /\(256 MB must stay free/.test(e.message)
    );
  });

  it('lets the write through when the platform cannot say, leaving the folder cap to guard', () => {
    const stumm = () => {
      throw new Error('ENOSYS');
    };
    assert.equal(enforceFreeSpace('/x', 1, 2 * GB, stumm), null);
  });

  it('asks the real disk by default', () => {
    assert.ok(enforceFreeSpace(os.tmpdir(), 1, 0) > 0);
  });
});
