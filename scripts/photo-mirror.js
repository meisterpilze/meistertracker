'use strict';
// The photo folder a second time on the same disk, without a second copy of
// the bytes.
//
// A photo is written once, under a random name, and never changed afterwards;
// it can only be deleted. So the second copy can be a hard link: one file with
// two names. It costs no space, and when the app (or a person, or a bug)
// deletes data/photos/…/x.jpg, backups/photos/…/x.jpg still holds the bytes.
// That is what a copy on the same disk can protect against. A dead disk takes
// both names with it — that is what the USB stick is for (scripts/usb-stick.js).
//
// Where a hard link cannot be made (backups/ on another file system, FAT, some
// network shares, a year folder linked in from another disk) the file is
// copied instead: once, like the link, so the folder grows by each photo
// exactly once and never by the whole set. Such a copy does cost space, and
// it is not made into the last COPY_MIN_FREE of the disk.
//
// What is gone from data/photos stays here for GRACE_DAYS, then goes too. A
// photo purged on purpose should not live forever in a backup, and ninety
// days is long enough to notice one that was not.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { writeFileAtomic, renameRetry, tmpName, LEFTOVER } = require('./atomic-file.js');

const REMOVED_FILE = '.removed.json';
const GRACE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
// A photo is pruned from a backup only when both hold: it has been missing
// for GRACE_DAYS by the clock, and runs on at least MIN_SEEN_DAYS different
// days found it missing. The clock alone was not to be trusted: a PC that
// boots with a dead CMOS battery dated a deletion years back, and once the
// clock was right again the photo was pruned the next day; one run with the
// clock months ahead pruned everything pending at once. Now a missing photo
// is never dated before the last run that already happened (lastRun), and a
// clock that jumps ahead has to stay wrong for a week of runs to cost
// anything. A stick plugged in once a week keeps a deleted photo for at
// least seven weeks; daily, the ninety days are what counts.
const MIN_SEEN_DAYS = 7;
// Where no hard link can be made, a copy costs the photo's size a second
// time, on the app's own disk. It is never made into the last of the space:
// a year folder linked in from another disk would otherwise be copied onto
// this one in full, until the database had no room left either.
const COPY_MIN_FREE = 2 * 1024 * 1024 * 1024;

// Every file below `dir`, keyed by its path relative to `dir` with forward
// slashes, so the same photo has the same key on Windows and elsewhere.
// Names starting with a dot are skipped: they are this module's bookkeeping,
// or the operating system's. So are leftovers of an atomic write cut short
// (scripts/atomic-file.js): half a file under a temporary name is no photo,
// and backed up it would never match anything again.
//
// Links are followed in the app's photo folder. A year's photos moved to
// another disk and linked back (a junction, mklink /J) are still the app's
// photos, and served as such; skipped here they would count as deleted and be
// pruned from every backup ninety days later. A folder below `dir` that cannot
// be read right now — a link whose disk is unplugged, a folder the account may
// not open — is listed in `unreadable`: nothing under it may be taken for
// deleted.
//
// On a backup stick they are not ({ followLinks: false }): nothing there is
// written by anyone but the backup, and a junction on an NTFS stick would lead
// the backup's writes and deletions off the stick, onto the PC. Links found
// there are listed in `links` instead, and not walked.
async function listFiles(dir, { followLinks = true } = {}) {
  const out = new Map();
  out.unreadable = [];
  out.links = [];
  const seen = new Set();
  async function walk(abs, rel) {
    let entries;
    try {
      if (!followLinks && !rel && (await fsp.lstat(abs)).isSymbolicLink()) {
        out.links.push('.');
        return;
      }
      const real = await fsp.realpath(abs);
      // A link back into the tree would be walked forever.
      if (seen.has(real)) return;
      seen.add(real);
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch (e) {
      if (!rel && e.code === 'ENOENT') return;
      if (!rel) throw e;
      out.unreadable.push(rel);
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || LEFTOVER.test(e.name)) continue;
      const a = path.join(abs, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        if (!followLinks) {
          out.links.push(r);
          continue;
        }
        try {
          const st = await fsp.stat(a);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          out.unreadable.push(r);
          continue;
        }
      }
      if (isDir) await walk(a, r);
      else if (isFile) out.set(r, a);
    }
  }
  await walk(dir, '');
  return out;
}

// Whether a backed-up path lies under a folder that could not be read.
function underUnreadable(rel, unreadable) {
  return (unreadable || []).some((u) => rel === u || rel.startsWith(u + '/'));
}

function fromRel(base, rel) {
  return path.join(base, ...rel.split('/'));
}

function localDay(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// One entry of the removal record: since when the photo is missing, and on
// how many different days a run found it missing. The first format kept only
// the time; such an entry counts as seen once.
function entryOf(v) {
  if (typeof v === 'string') return isNaN(Date.parse(v)) ? null : { since: v, seen: 1, day: null };
  if (!v || typeof v !== 'object' || typeof v.since !== 'string' || isNaN(Date.parse(v.since))) return null;
  return {
    since: v.since,
    seen: Number(v.seen) >= 1 ? Math.floor(Number(v.seen)) : 1,
    day: typeof v.day === 'string' ? v.day : null
  };
}

// Which backed-up files no longer have a source, since when, and which of
// them have been gone long enough to delete. Shared with the USB stick, which
// keeps deleted photos for the same time.
//
//   existing  the paths the backup holds
//   source    the paths the app holds now
//   removed   { path: { since, seen, day } } from the last run
//   lastRun   when the last run happened, as far as the record knows
//
// Returns the new map, the paths to delete now, the new lastRun, and whether
// anything worth saving changed.
function trackRemoved({ existing, source, removed, now, graceDays = GRACE_DAYS, unreadable = [], lastRun = null }) {
  const last = typeof lastRun === 'string' && !isNaN(Date.parse(lastRun)) ? new Date(lastRun) : null;
  // A clock behind a run that already happened is wrong, not early.
  const latest = last && last > now ? last : now;
  const today = localDay(now);
  const next = {};
  const prune = [];
  let changed = !last || localDay(last) !== localDay(latest);
  for (const rel of existing) {
    // Not readable now is not deleted. Whatever count it had stays as it was.
    if (underUnreadable(rel, unreadable)) {
      if (removed[rel]) next[rel] = removed[rel];
      continue;
    }
    if (source.has(rel)) {
      // Back again, after a restore: not removed any more.
      if (removed[rel]) changed = true;
      continue;
    }
    let e = entryOf(removed[rel]);
    if (!e) {
      e = { since: latest.toISOString(), seen: 1, day: today };
      changed = true;
    } else if (e.day !== today) {
      e = { since: e.since, seen: e.day === null ? e.seen : e.seen + 1, day: today };
      changed = true;
    }
    if (now.getTime() - Date.parse(e.since) >= graceDays * DAY_MS && e.seen >= MIN_SEEN_DAYS) {
      prune.push(rel);
      changed = true;
    } else {
      next[rel] = e;
    }
  }
  // Entries whose file someone deleted by hand.
  for (const rel of Object.keys(removed)) if (!existing.has(rel)) changed = true;
  return { removed: next, prune, changed, lastRun: latest.toISOString() };
}

// The removal record as it is kept on disk, here and on the stick. The first
// format was the bare map of path to time.
function parseRemoved(json) {
  if (json && typeof json === 'object' && json.version === 2 && json.removed && typeof json.removed === 'object') {
    return { removed: json.removed, lastRun: typeof json.lastRun === 'string' ? json.lastRun : null };
  }
  if (json && typeof json === 'object' && !Array.isArray(json)) return { removed: json, lastRun: null };
  return { removed: {}, lastRun: null };
}
function serializeRemoved(removed, lastRun) {
  return JSON.stringify({ version: 2, lastRun, removed }, null, 2) + '\n';
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// Two names for one file, or a copy where that cannot be had. The copy goes
// to a temporary name first: written straight under the real one, a copy cut
// short (a restart, a power cut) stayed there short, and every later run took
// it for a photo that had changed and kept it.
async function copyWhole(src, dst) {
  const tmp = tmpName(dst);
  try {
    await fsp.copyFile(src, tmp, fs.constants.COPYFILE_EXCL);
    await renameRetry(tmp, dst);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

async function linkOrCopy(src, dst, roomFor) {
  try {
    await fsp.link(src, dst);
    return 'linked';
  } catch (e) {
    if (e.code === 'EEXIST') throw e;
    if (!(await roomFor((await fsp.stat(src)).size))) {
      throw Object.assign(new Error('not enough free space for a copy'), { code: 'NOSPACE' });
    }
    await copyWhole(src, dst);
    return 'copied';
  }
}

// One pass. Safe to run as often as you like: what is already there is left
// alone, so a second run straight after the first does nothing.
async function mirrorPhotos({ src, dst, now = new Date(), graceDays = GRACE_DAYS }) {
  const result = { linked: 0, copied: 0, repaired: 0, present: 0, pending: 0, pruned: 0, conflicts: 0, errors: [] };
  // No source folder is not "every photo was deleted". It is a missing mount
  // or a fresh install, and either way nothing in the backup may be marked
  // for deletion because of it.
  if (!fs.existsSync(src)) return result;
  await fsp.mkdir(dst, { recursive: true });

  const source = await listFiles(src);
  const existing = await listFiles(dst);

  let free = null;
  async function roomFor(bytes) {
    if (free === null) {
      try {
        const s = await fsp.statfs(dst);
        free = Number(s.bavail) * Number(s.bsize);
      } catch {
        free = Infinity;
      }
    }
    if (free - bytes < COPY_MIN_FREE) return false;
    free -= bytes;
    return true;
  }

  for (const [rel, abs] of source) {
    const target = fromRel(dst, rel);
    if (existing.has(rel)) {
      // Already there. A link shares the inode; a copy has the same size.
      // Photos are never changed, only cut short: a copy smaller than its
      // photo is one that was cut, and is made again. A copy larger than its
      // photo is kept, and said so: then the photo is the one that was cut.
      try {
        const [a, b] = await Promise.all([fsp.stat(abs, { bigint: true }), fsp.stat(target, { bigint: true })]);
        const same = a.ino === b.ino && a.dev === b.dev;
        if (!same && b.size < a.size && (await roomFor(Number(a.size)))) {
          await copyWhole(abs, target);
          result.repaired++;
        } else if (!same && a.size !== b.size) result.conflicts++;
        else result.present++;
      } catch (e) {
        result.errors.push({ rel, error: e.message });
      }
      continue;
    }
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      result[await linkOrCopy(abs, target, roomFor)]++;
    } catch (e) {
      result.errors.push({ rel, error: e.message });
    }
  }

  const removedFile = path.join(dst, REMOVED_FILE);
  const { removed, lastRun } = parseRemoved(await readJson(removedFile));
  const r = trackRemoved({
    existing: new Set(existing.keys()),
    source: new Set(source.keys()),
    removed,
    lastRun,
    now,
    graceDays,
    unreadable: source.unreadable
  });
  for (const rel of r.prune) {
    try {
      await fsp.rm(fromRel(dst, rel), { force: true });
      result.pruned++;
    } catch (e) {
      result.errors.push({ rel, error: e.message });
      r.removed[rel] = removed[rel];
    }
  }
  result.pending = Object.keys(r.removed).length;
  if (r.changed) await writeFileAtomic(removedFile, serializeRemoved(r.removed, r.lastRun));
  await removeEmptyDirs(dst);
  return result;
}

// Folders a prune left empty. The top folder stays.
async function removeEmptyDirs(dir, top = true) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) if (e.isDirectory()) await removeEmptyDirs(path.join(dir, e.name), false);
  if (top) return;
  try {
    if ((await fsp.readdir(dir)).length === 0) await fsp.rmdir(dir);
  } catch {
    /* in use, or filled meanwhile: leave it */
  }
}

module.exports = {
  mirrorPhotos,
  trackRemoved,
  parseRemoved,
  serializeRemoved,
  listFiles,
  fromRel,
  removeEmptyDirs,
  GRACE_DAYS,
  MIN_SEEN_DAYS,
  COPY_MIN_FREE,
  REMOVED_FILE
};
