#!/usr/bin/env node
'use strict';
// npm audit over the whole dependency tree, dev tools included. It fails on a
// HIGH or CRITICAL advisory unless scripts/audit-allow.json lists it.
//
// CI first runs `npm audit --audit-level=high --omit=dev`, with no exceptions:
// what an installation gets has to be clean. This is the second half. Dev
// tools run only in CI and on a developer's machine, and an advisory against
// one of them can have no fix at all. The release that fixes it may not exist
// yet, and the older one may be vulnerable to something else (#422 left
// license-checker-rseidelsohn 4.4.2 for that reason). Such an advisory goes
// into the allow list, with the reason it cannot be fixed and why it does not
// reach an installation. Every other advisory still fails the build.
//
// An allowed advisory that shows up in the production tree is not covered:
// the first step fails on it. An entry that no advisory matches any more is
// reported, so that it can be removed.
//
// CI runs this on Linux. It needs the registry, like npm audit itself, and
// fails if it cannot get a report.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ALLOW_FILE = path.join(__dirname, 'audit-allow.json');
const FAILING = new Set(['high', 'critical']);
const GHSA = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;

function ghsaId(url) {
  const m = GHSA.exec(String(url || ''));
  return m ? m[0] : null;
}

// The advisories in an `npm audit --json` report (auditReportVersion 2), each
// once. A package that is vulnerable only through another one names that
// package in `via`; the advisories themselves are the objects there.
function advisories(report) {
  const out = new Map();
  for (const v of Object.values((report && report.vulnerabilities) || {})) {
    for (const via of v.via || []) {
      if (!via || typeof via !== 'object') continue;
      const id = ghsaId(via.url) || 'npm-' + via.source;
      if (!out.has(id)) out.set(id, { id, name: via.name, title: via.title, severity: via.severity, url: via.url });
    }
  }
  return [...out.values()];
}

// What the report means against the allow list: the HIGH and CRITICAL
// advisories the list does not cover, the ones it does, and the entries that
// matched nothing.
function judge(report, allow) {
  const listed = new Set((allow || []).map((a) => a.id));
  const failing = [];
  const allowed = [];
  for (const a of advisories(report)) {
    if (!FAILING.has(a.severity)) continue;
    if (listed.has(a.id)) allowed.push(a);
    else failing.push(a);
  }
  const seen = new Set(allowed.map((a) => a.id));
  const stale = [...listed].filter((id) => !seen.has(id));
  return { failing, allowed, stale };
}

// Every entry names one advisory and says why it is allowed.
function readAllowList(file) {
  const allow = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(allow)) throw new Error(path.basename(file) + ' must be a list');
  for (const a of allow) {
    if (!a || !GHSA.test(a.id || '') || ghsaId(a.id) !== a.id) {
      throw new Error(path.basename(file) + ': every entry needs a GHSA id, got ' + JSON.stringify(a && a.id));
    }
    if (typeof a.reason !== 'string' || a.reason.trim().length < 20) {
      throw new Error(path.basename(file) + ': ' + a.id + ' needs a reason');
    }
  }
  return allow;
}

function auditReport() {
  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // npm audit exits 1 whenever it finds anything; the report is on stdout
    // either way. No stdout means it never got as far as a report.
    raw = e.stdout;
    if (!raw) throw e;
  }
  const report = JSON.parse(raw);
  if (report.error) throw new Error('npm audit: ' + (report.error.summary || report.error.code || 'failed'));
  return report;
}

function main() {
  const allow = readAllowList(ALLOW_FILE);
  const { failing, allowed, stale } = judge(auditReport(), allow);
  for (const a of allowed) console.log('allowed by audit-allow.json: ' + a.id + ' (' + a.name + ')');
  for (const id of stale) console.log('no longer reported, remove it from audit-allow.json: ' + id);
  for (const a of failing) console.log(a.severity.toUpperCase() + ' ' + a.name + ': ' + a.title + ' ' + (a.url || ''));
  if (failing.length) {
    console.log(
      '\n' +
        failing.length +
        ' HIGH or CRITICAL advisory/advisories. Run `npm audit` for the paths and `npm audit fix` where it can. ' +
        'Only an advisory with no fix that cannot reach an installation belongs in scripts/audit-allow.json.'
    );
    process.exit(1);
  }
  console.log('npm audit: no HIGH or CRITICAL advisory outside scripts/audit-allow.json');
}

if (require.main === module) main();

module.exports = { advisories, judge, ghsaId, readAllowList, ALLOW_FILE };
