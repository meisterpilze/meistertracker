'use strict';
// R-15: total-size cap helper for the photo directory. Lives in its own
// module so the server-side enforcer (server.js → savePhotoToDisk) and the
// regression test can share the same logic. Refresh interval and cap come
// from the caller; the helper only knows how to scan a dir and decide
// whether a candidate write fits.

const fs = require('fs');
const path = require('path');

function computePhotoDirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { recursive: true });
    for (const e of entries) {
      try {
        const name = typeof e === 'string' ? e : e.name;
        const abs = path.join(dir, name);
        const st = fs.statSync(abs);
        if (st.isFile()) total += st.size;
      } catch {
        /* ignore individual stat failures */
      }
    }
  } catch {
    /* ignore — treat as 0 */
  }
  return total;
}

// The folder an experiment's photos go into, below {year}/{month}/. One place
// for the prefix: the upload names folders with it, and the reset keeps every
// folder that carries it. Renamed on one side only, the reset would delete
// experiment photos again.
const EXPERIMENT_SCOPE_PREFIX = 'exp-';
function experimentPhotoScope(experimentId) {
  return EXPERIMENT_SCOPE_PREFIX + experimentId;
}

// What the admin reset may take from the photo directory: the contamination
// report photos, which go with their reports. Experiment photos live in the
// same tree, as {year}/{month}/exp-{id}/, but belong to experiments, and the
// reset keeps experiments, so their photos stay. Everything else goes, stray
// files included, which is what the reset did to the whole directory before.
// Returns how many entries it removed.
function removeContaminationPhotos(dir) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  const drop = (abs) => {
    fs.rmSync(abs, { recursive: true, force: true });
    removed++;
  };
  for (const year of fs.readdirSync(dir, { withFileTypes: true })) {
    const yearDir = path.join(dir, year.name);
    if (!year.isDirectory()) {
      drop(yearDir);
      continue;
    }
    for (const month of fs.readdirSync(yearDir, { withFileTypes: true })) {
      const monthDir = path.join(yearDir, month.name);
      if (!month.isDirectory()) {
        drop(monthDir);
        continue;
      }
      for (const scope of fs.readdirSync(monthDir, { withFileTypes: true })) {
        if (scope.isDirectory() && scope.name.startsWith(EXPERIMENT_SCOPE_PREFIX)) continue;
        drop(path.join(monthDir, scope.name));
      }
    }
  }
  return removed;
}

class PhotoCapError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'PhotoCapError';
  }
}

// Throws PhotoCapError if (currentSize + addBytes) > capBytes.
// Returns true otherwise.
function enforceCap(currentSize, addBytes, capBytes) {
  if (currentSize + addBytes > capBytes) {
    const capGB = (capBytes / (1024 * 1024 * 1024)).toFixed(1);
    throw new PhotoCapError(`photos: directory full (cap PHOTO_DIR_MAX_GB=${capGB} GB exceeded)`);
  }
  return true;
}

// The disk under the photos keeps this much free. The folder cap alone says
// nothing about the disk: a cap the disk cannot hold still fills it, and a full
// disk stops the database along with the photos. Unknown free space (a platform
// that cannot say) lets the write through; the folder cap still applies.
// Returns what stays free after the write, or null when that is unknown.
function enforceFreeSpace(dir, addBytes, minFreeBytes, statfs = fs.statfsSync) {
  let free;
  try {
    const s = statfs(dir);
    free = Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
  if (!Number.isFinite(free)) return null;
  if (free - addBytes >= minFreeBytes) return free - addBytes;
  const gb = minFreeBytes / (1024 * 1024 * 1024);
  const amount = gb >= 1 ? gb.toFixed(1) + ' GB' : Math.round(minFreeBytes / (1024 * 1024)) + ' MB';
  throw new PhotoCapError(`photos: disk nearly full (${amount} must stay free, see PHOTO_MIN_FREE_GB)`);
}

module.exports = {
  computePhotoDirSize,
  enforceCap,
  enforceFreeSpace,
  removeContaminationPhotos,
  experimentPhotoScope,
  PhotoCapError
};
