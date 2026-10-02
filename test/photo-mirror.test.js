'use strict';
// The nightly second copy of the photos on the same disk: hard links where the
// file system has them, a one-time copy where it does not, and deleted photos
// kept for the grace period.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  mirrorPhotos,
  trackRemoved,
  parseRemoved,
  listFiles,
  GRACE_DAYS,
  MIN_SEEN_DAYS,
  COPY_MIN_FREE,
  REMOVED_FILE
} = require('../scripts/photo-mirror.js');

function put(dir, rel, content) {
  const abs = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
const DAY = 86400000;

describe('mirrorPhotos', () => {
  let src;
  let dst;
  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_mirror_'));
    src = path.join(base, 'data', 'photos');
    dst = path.join(base, 'backups', 'photos');
    put(src, '2026/09/3/a.jpg', 'aaaa');
    put(src, '2026/09/3/a_thumb.jpg', 'a');
    put(src, '2026/10/exp-2/b.jpg', 'bbbbbb');
  });

  it('gives every photo a second name that costs no space', async () => {
    const r = await mirrorPhotos({ src, dst });
    assert.equal(r.linked, 3);
    assert.equal(r.copied, 0);
    const a = fs.statSync(path.join(src, '2026', '09', '3', 'a.jpg'));
    const b = fs.statSync(path.join(dst, '2026', '09', '3', 'a.jpg'));
    assert.equal(a.ino, b.ino, 'one file, two names');
  });

  it('does nothing the second time, and only the new photo the third', async () => {
    await mirrorPhotos({ src, dst });
    const again = await mirrorPhotos({ src, dst });
    assert.equal(again.linked + again.copied, 0);
    assert.equal(again.present, 3);
    put(src, '2026/10/exp-2/c.jpg', 'c');
    const third = await mirrorPhotos({ src, dst });
    assert.equal(third.linked, 1);
    assert.equal(third.present, 3);
  });

  it('keeps a deleted photo for the grace period, then removes it and its empty folder', async () => {
    const t0 = new Date('2026-10-01T00:00:00Z');
    await mirrorPhotos({ src, dst, now: new Date(t0.getTime() - DAY) });
    fs.rmSync(path.join(src, '2026', '10', 'exp-2'), { recursive: true });
    const kept = await mirrorPhotos({ src, dst, now: t0 });
    assert.equal(kept.pending, 1);
    assert.equal(fs.readFileSync(path.join(dst, '2026', '10', 'exp-2', 'b.jpg'), 'utf8'), 'bbbbbb', 'still there');
    const { removed } = parseRemoved(JSON.parse(fs.readFileSync(path.join(dst, REMOVED_FILE), 'utf8')));
    assert.deepEqual(Object.keys(removed), ['2026/10/exp-2/b.jpg']);
    assert.equal(removed['2026/10/exp-2/b.jpg'].since, t0.toISOString());
    // The nightly runs of the following week.
    for (let d = 1; d < MIN_SEEN_DAYS; d++) await mirrorPhotos({ src, dst, now: new Date(t0.getTime() + d * DAY) });

    const almost = await mirrorPhotos({ src, dst, now: new Date(t0.getTime() + (GRACE_DAYS - 1) * DAY) });
    assert.equal(almost.pruned, 0, 'the date it was first missed is kept, not reset');

    const gone = await mirrorPhotos({ src, dst, now: new Date(t0.getTime() + GRACE_DAYS * DAY) });
    assert.equal(gone.pruned, 1);
    assert.equal(fs.existsSync(path.join(dst, '2026', '10', 'exp-2')), false);
    assert.ok(fs.existsSync(path.join(dst, '2026', '09', '3', 'a.jpg')));
  });

  it('forgets the deletion of a photo that came back', async () => {
    await mirrorPhotos({ src, dst });
    const b = path.join(src, '2026', '10', 'exp-2', 'b.jpg');
    fs.rmSync(b);
    await mirrorPhotos({ src, dst });
    fs.writeFileSync(b, 'bbbbbb');
    await mirrorPhotos({ src, dst });
    assert.deepEqual(parseRemoved(JSON.parse(fs.readFileSync(path.join(dst, REMOVED_FILE), 'utf8'))).removed, {});
  });

  it('marks nothing as deleted when the photo folder itself is missing', async () => {
    await mirrorPhotos({ src, dst });
    fs.rmSync(src, { recursive: true });
    const r = await mirrorPhotos({ src, dst });
    assert.equal(r.pending, 0);
    const record = JSON.parse(fs.readFileSync(path.join(dst, REMOVED_FILE), 'utf8'));
    assert.deepEqual(parseRemoved(record).removed, {}, 'nothing marked');
  });

  it('keeps what it has when a photo changed after it was backed up', async () => {
    const a = path.join(dst, '2026', '09', '3', 'a.jpg');
    put(dst, '2026/09/3/a.jpg', 'an older, longer version');
    const r = await mirrorPhotos({ src, dst });
    assert.equal(r.conflicts, 1);
    assert.equal(fs.readFileSync(a, 'utf8'), 'an older, longer version');
  });

  describe('where no hard link can be made', () => {
    const link = fs.promises.link;
    beforeEach(() => {
      fs.promises.link = async () => {
        const e = new Error('cross-device link not permitted');
        e.code = 'EXDEV';
        throw e;
      };
    });
    afterEach(() => {
      fs.promises.link = link;
    });

    it('copies each photo once instead', async () => {
      const r = await mirrorPhotos({ src, dst });
      assert.equal(r.copied, 3);
      const again = await mirrorPhotos({ src, dst });
      assert.equal(again.copied, 0);
      assert.equal(fs.readFileSync(path.join(dst, '2026', '10', 'exp-2', 'b.jpg'), 'utf8'), 'bbbbbb');
    });

    it('makes a copy cut short again, and keeps one that is longer than its photo', async () => {
      await mirrorPhotos({ src, dst });
      const b = path.join(dst, '2026', '10', 'exp-2', 'b.jpg');
      fs.writeFileSync(b, 'bb');
      const r = await mirrorPhotos({ src, dst });
      assert.equal(r.repaired, 1);
      assert.equal(fs.readFileSync(b, 'utf8'), 'bbbbbb');
      const a = path.join(dst, '2026', '09', '3', 'a.jpg');
      fs.writeFileSync(a, 'aaaa and more');
      const again = await mirrorPhotos({ src, dst });
      assert.equal(again.conflicts, 1);
      assert.equal(fs.readFileSync(a, 'utf8'), 'aaaa and more', 'the photo is the one that was cut');
    });

    it('copies nothing into the last of the disk', async () => {
      const statfs = fs.promises.statfs;
      fs.promises.statfs = async () => ({ bavail: COPY_MIN_FREE / 4096, bsize: 4096 });
      try {
        const r = await mirrorPhotos({ src, dst });
        assert.equal(r.copied, 0);
        assert.equal(r.errors.length, 3);
        assert.match(r.errors[0].error, /free space/);
      } finally {
        fs.promises.statfs = statfs;
      }
    });
  });
});

describe('photos behind a link', () => {
  it('follows a folder moved to another disk and linked back, and takes nothing under it for deleted while it is away', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_mirror_link_'));
    const src = path.join(base, 'data', 'photos');
    const dst = path.join(base, 'backups', 'photos');
    const woanders = path.join(base, 'other-disk', '2025');
    put(src, '2026/10/1/neu.jpg', 'new');
    put(woanders, '09/1/alt.jpg', 'old');
    fs.symlinkSync(woanders, path.join(src, '2025'), 'junction');

    const r = await mirrorPhotos({ src, dst });
    assert.equal(r.linked + r.copied, 2, 'the linked year is backed up too');
    assert.equal(fs.readFileSync(path.join(dst, '2025', '09', '1', 'alt.jpg'), 'utf8'), 'old');

    // The other disk is unplugged: the link points nowhere.
    fs.renameSync(path.join(base, 'other-disk'), path.join(base, 'other-disk-away'));
    const weg = await mirrorPhotos({ src, dst, now: new Date('2026-10-01T00:00:00Z') });
    assert.equal(weg.pending, 0, 'not readable is not deleted');
    const spaeter = await mirrorPhotos({ src, dst, now: new Date('2027-06-01T00:00:00Z') });
    assert.equal(spaeter.pruned, 0);
    assert.ok(fs.existsSync(path.join(dst, '2025', '09', '1', 'alt.jpg')));
  });

  it('does not walk in circles when a link points back into the tree', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_mirror_loop_'));
    const src = path.join(base, 'photos');
    put(src, '2026/a.jpg', 'a');
    fs.symlinkSync(src, path.join(src, '2026', 'loop'), 'junction');
    const files = await listFiles(src);
    assert.deepEqual([...files.keys()], ['2026/a.jpg']);
  });
});

describe('trackRemoved', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const daysAgo = (n) => new Date(now.getTime() - n * DAY);
  const iso = (d) => d.toISOString();
  const today = trackRemoved({ existing: new Set(['x']), source: new Set(), removed: {}, now }).removed.x.day;

  it('starts the clock for a newly missing file and stops it for one that is back', () => {
    const r = trackRemoved({
      existing: new Set(['a', 'b']),
      source: new Set(['b']),
      removed: { b: '2026-09-01T00:00:00.000Z' },
      now,
      lastRun: iso(now)
    });
    assert.deepEqual(r.removed, { a: { since: iso(now), seen: 1, day: today } });
    assert.deepEqual(r.prune, []);
    assert.equal(r.changed, true);
  });

  it('prunes what has been missing for the grace period and was found missing on a week of days', () => {
    const r = trackRemoved({
      existing: new Set(['a']),
      source: new Set(),
      removed: { a: { since: iso(daysAgo(GRACE_DAYS)), seen: MIN_SEEN_DAYS - 1, day: 'an earlier day' } },
      now
    });
    assert.deepEqual(r.prune, ['a']);
    assert.deepEqual(r.removed, {});
  });

  it('prunes nothing on a single run whose clock is months ahead', () => {
    // Missing since yesterday by the record; the PC's clock says it is 2027.
    const ahead = new Date(now.getTime() + 200 * DAY);
    const r = trackRemoved({
      existing: new Set(['a']),
      source: new Set(),
      removed: { a: { since: iso(daysAgo(1)), seen: 2, day: 'yesterday' } },
      now: ahead,
      lastRun: iso(now)
    });
    assert.deepEqual(r.prune, [], 'seen missing on three days, not on a week of them');
    assert.equal(r.removed.a.seen, 3);
  });

  it('never dates a missing photo before a run that already happened', () => {
    // A dead CMOS battery: the PC boots in 2009, after a run in October 2026.
    const back = new Date('2009-01-01T00:00:00Z');
    const r = trackRemoved({ existing: new Set(['a']), source: new Set(), removed: {}, now: back, lastRun: iso(now) });
    assert.equal(r.removed.a.since, iso(now), 'dated at the last run, not in 2009');
    assert.equal(r.lastRun, iso(now), 'and the last run is not moved back either');
    // The clock is right again the next day: nothing goes for ninety days.
    const next = trackRemoved({
      existing: new Set(['a']),
      source: new Set(),
      removed: r.removed,
      now: new Date(now.getTime() + DAY),
      lastRun: r.lastRun
    });
    assert.deepEqual(next.prune, []);
  });

  it('counts a day once, however many runs it has', () => {
    let removed = {};
    let lastRun = null;
    for (let i = 0; i < 5; i++) {
      const r = trackRemoved({ existing: new Set(['a']), source: new Set(), removed, now, lastRun });
      removed = r.removed;
      lastRun = r.lastRun;
    }
    assert.equal(removed.a.seen, 1);
  });

  it('reads the first format, a plain time per path, as seen once', () => {
    const since = iso(daysAgo(GRACE_DAYS + 30));
    const r = trackRemoved({ existing: new Set(['a']), source: new Set(), removed: { a: since }, now });
    assert.deepEqual(r.prune, [], 'old enough, but seen on one day only');
    assert.deepEqual(r.removed.a, { since, seen: 1, day: today });
    assert.deepEqual(parseRemoved({ 'x.jpg': since }), { removed: { 'x.jpg': since }, lastRun: null });
  });

  it('leaves alone what lies under a folder that cannot be read', () => {
    const since = iso(daysAgo(GRACE_DAYS + 5));
    const r = trackRemoved({
      existing: new Set(['2025/09/a.jpg', '2026/b.jpg']),
      source: new Set(),
      removed: { '2025/09/a.jpg': since },
      now,
      unreadable: ['2025']
    });
    assert.deepEqual(r.prune, [], 'a date older than the grace period, and still not pruned');
    assert.deepEqual(Object.keys(r.removed).sort(), ['2025/09/a.jpg', '2026/b.jpg']);
    assert.equal(r.removed['2025/09/a.jpg'], since, 'its date kept as it was');
  });

  it('reports no change when nothing changed', () => {
    const r = trackRemoved({ existing: new Set(['a']), source: new Set(['a']), removed: {}, now, lastRun: iso(now) });
    assert.equal(r.changed, false);
  });
});
