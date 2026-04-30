'use strict';
// Auto-backup rotation helper. Lives in scripts/ so it can be required by
// server.js AND imported into the test suite without booting the whole
// HTTP server. See R-01 in audit-2026-04.md for the bug this fixes.

const fs = require('fs');
const path = require('path');

// Filenames matching this pattern are considered auto-backups and ARE
// candidates for rotation. Manual backups (`meistertracker_*`) and any
// other file in the directory are explicitly NOT candidates — alphabetic
// sort places `meisterpilze_b...` BEFORE `meistertracker_*`, which used
// to put today's auto-backup at the head of a >30-file slice and made
// `verifyBackupFile` fail with `stat ENOENT` immediately afterwards.
const AUTO_BACKUP_FILENAME = /^meisterpilze_backup_\d{4}-\d{2}-\d{2}\.db$/;

// Files newer than this threshold are NEVER deleted, regardless of retention
// policy. This is belt + suspenders against a future ordering regression
// where rotation runs AFTER writing today's file (the original R-01 bug).
const MIN_FILE_AGE_MS = 60_000;

// Rotate auto-backups in `dir`, keeping only files whose age is within
// `retentionDays`. Returns { kept, deleted, skipped, error? } so the caller
// can log the decision and tests can assert on it.
//
// Three guardrails:
//   1. Filter on AUTO_BACKUP_FILENAME so manual backups stay put.
//   2. Sort by mtime (newest first) — alphabetic sort happens to work for
//      the current ISO-date filename pattern but couples behaviour to the
//      filename, which is fragile.
//   3. Refuse to delete files whose mtime is < 60 seconds old.
function rotateAutoBackups(dir, retentionDays = 30) {
  const result = { kept: [], deleted: [], skipped: [] };
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return Object.assign(result, { error: 'readdir failed: ' + e.message });
  }
  const now = Date.now();
  const cutoffMs = retentionDays * 24 * 60 * 60 * 1000;
  const candidates = [];
  for (const f of entries) {
    if (!AUTO_BACKUP_FILENAME.test(f)) continue;
    const full = path.join(dir, f);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (e) {
      result.skipped.push({ file: f, reason: 'stat failed: ' + e.message });
      continue;
    }
    candidates.push({ file: f, full, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const c of candidates) {
    const ageMs = now - c.mtimeMs;
    if (ageMs <= cutoffMs) {
      result.kept.push(c.file);
      continue;
    }
    if (ageMs < MIN_FILE_AGE_MS) {
      result.skipped.push({ file: c.file, reason: 'mtime too recent (' + ageMs + 'ms ago)' });
      continue;
    }
    try {
      fs.unlinkSync(c.full);
      result.deleted.push(c.file);
    } catch (e) {
      result.skipped.push({ file: c.file, reason: 'unlink failed: ' + e.message });
    }
  }
  return result;
}

module.exports = {
  AUTO_BACKUP_FILENAME,
  MIN_FILE_AGE_MS,
  rotateAutoBackups
};
