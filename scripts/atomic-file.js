'use strict';
// Writing a file so that it is there whole or not at all, on Windows too.
// Everything that writes a backup or its bookkeeping goes through here: the
// stick, the photo mirror, the off-site marker, a photo restore.
//
// The bytes go to a temporary name beside the target, are flushed to the
// device, and the temporary file is renamed onto the target. A crash or a
// pulled stick leaves a .tmp-<hex> file at worst, never a short file under the
// real name that the next run would take for a finished one. A write or a
// rename that fails for good removes its temporary file; a leftover from a
// crash is recognised by LEFTOVER and never taken for a photo.
//
// Windows lets a virus scanner or the search indexer hold a file that was
// just written, and a rename of it fails for a moment with EPERM, EBUSY or
// EACCES. renameRetry waits that out for about ten seconds. A rename still
// refused after that carries `held: true`: the target may be fine and only
// busy, so it is reported as something that may pass, not as a stick that
// cannot be written to.

const fsp = require('fs').promises;
const crypto = require('crypto');

const LEFTOVER = /\.tmp-[0-9a-f]{8}$/;
const HELD = ['EPERM', 'EBUSY', 'EACCES'];
// 50 ms, doubling, at most 2 s a wait: about ten seconds in all.
const RETRY_WAITS = [50, 100, 200, 400, 800, 1600, 2000, 2000, 2000, 2000];

function tmpName(file) {
  return file + '.tmp-' + crypto.randomBytes(4).toString('hex');
}

async function renameRetry(from, to, waits = RETRY_WAITS) {
  for (let i = 0; ; i++) {
    try {
      return await fsp.rename(from, to);
    } catch (e) {
      if (!HELD.includes(e.code)) throw e;
      if (i >= waits.length) {
        e.held = true;
        throw e;
      }
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}

async function writeFileAtomic(file, data, { mode, waits } = {}) {
  const tmp = tmpName(file);
  const fh = await fsp.open(tmp, 'wx', mode);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } catch (e) {
    await fh.close().catch(() => {});
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  await fh.close();
  try {
    await renameRetry(tmp, file, waits);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

module.exports = { writeFileAtomic, renameRetry, tmpName, LEFTOVER, RETRY_WAITS };
