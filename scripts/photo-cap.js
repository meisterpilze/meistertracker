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

module.exports = { computePhotoDirSize, enforceCap, PhotoCapError };
