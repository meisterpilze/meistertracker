'use strict';
// Migration numbering — the guard against two branches claiming the same version.
//
// The runner skips a migration whose version is already in schema_version:
//
//     for (const m of MIGRATIONS) { if (applied.has(m.version)) continue; ... }
//
// That is correct for a database catching up, and silently wrong when two
// branches developed in parallel both add `version: 59`. Whichever lands second
// never runs: its column is simply never created, and the failure shows up far
// away, as a `no such column` at the first query that needs it. Nothing warns.
//
// This has now happened twice in this repository, so it gets a test rather than
// a note. The check is on the source text on purpose: it fails during review,
// before a database has been anywhere near the collision.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../db.js');

/** The `version:` numbers declared inside the MIGRATIONS array, in file order. */
function declaredVersions() {
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  const start = quelle.indexOf('const MIGRATIONS = [');
  assert.notEqual(start, -1, 'MIGRATIONS array not found in db.js');
  const ende = quelle.indexOf('\n];', start);
  assert.notEqual(ende, -1, 'end of MIGRATIONS array not found');
  return [...quelle.slice(start, ende).matchAll(/^\s*version:\s*(\d+),/gm)].map((m) => Number(m[1]));
}

describe('migrations – version numbering', () => {
  it('declares every version exactly once', () => {
    const versionen = declaredVersions();
    const doppelt = versionen.filter((v, i) => versionen.indexOf(v) !== i);
    assert.deepEqual(
      [...new Set(doppelt)],
      [],
      'two migrations share a version number; the second one will be skipped without a word'
    );
  });

  it('numbers them in ascending order', () => {
    const versionen = declaredVersions();
    const sortiert = [...versionen].sort((a, b) => a - b);
    assert.deepEqual(versionen, sortiert, 'migrations must be appended, not inserted');
  });

  it('records all of them when a fresh database is opened', () => {
    const p = path.join(os.tmpdir(), 'mt_migrations_' + Date.now() + '.db');
    const d = db.openDb(p);
    try {
      const angewandt = d
        .prepare('SELECT version FROM schema_version')
        .all()
        .map((r) => r.version);
      for (const v of declaredVersions()) {
        assert.ok(angewandt.includes(v), `migration v${v} did not run on a fresh database`);
      }
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });
});
