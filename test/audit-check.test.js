'use strict';
// scripts/audit-check.js: the whole tree may carry an advisory only if
// scripts/audit-allow.json lists it, and the production tree never.
//
// The reports below have the shape `npm audit --json` gives
// (auditReportVersion 2). Nothing here touches the registry.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { advisories, judge, ghsaId, readAllowList, ALLOW_FILE } = require('../scripts/audit-check.js');
const { quelle } = require('./helpers/quelle');

// An advisory as npm audit reports it in `via`. The ids are made up.
const advisory = (id, name, severity) => ({
  source: 1000001,
  name,
  dependency: name,
  title: name + ' does something it should not',
  url: 'https://github.com/advisories/' + id,
  severity,
  range: '<=1.0.0'
});

// The leaf carries the advisory, the packages that depend on it name the leaf.
function report(...leaves) {
  const vulnerabilities = {};
  for (const a of leaves) {
    vulnerabilities[a.name] = { name: a.name, severity: a.severity, isDirect: false, via: [a], range: '*' };
    vulnerabilities['uses-' + a.name] = {
      name: 'uses-' + a.name,
      severity: a.severity,
      isDirect: true,
      via: [a.name],
      range: '*'
    };
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: {} };
}

const DEV_ONLY = advisory('GHSA-aaaa-bbbb-cccc', 'dev-only-cache', 'high');
const ALLOW = [{ id: 'GHSA-aaaa-bbbb-cccc', reason: 'no release fixes it, and only a dev tool uses it' }];

describe('audit-check', () => {
  it('passes when the only HIGH advisory is on the allow list', () => {
    const r = judge(report(DEV_ONLY), ALLOW);
    assert.deepEqual(r.failing, []);
    assert.deepEqual(
      r.allowed.map((a) => a.id),
      ['GHSA-aaaa-bbbb-cccc']
    );
    assert.deepEqual(r.stale, []);
  });

  it('fails on any other HIGH or CRITICAL advisory', () => {
    const neu = advisory('GHSA-dddd-eeee-ffff', 'other-lib', 'high');
    const kritisch = advisory('GHSA-gggg-hhhh-jjjj', 'third-lib', 'critical');
    const r = judge(report(DEV_ONLY, neu, kritisch), ALLOW);
    assert.deepEqual(r.failing.map((a) => a.id).sort(), ['GHSA-dddd-eeee-ffff', 'GHSA-gggg-hhhh-jjjj']);
  });

  it('leaves moderate and low findings to the printed report, as before', () => {
    const r = judge(report(advisory('GHSA-kkkk-mmmm-nnnn', 'meh', 'moderate')), []);
    assert.deepEqual(r.failing, []);
  });

  it('with an empty list it is the plain HIGH gate', () => {
    assert.deepEqual(
      judge(report(DEV_ONLY), []).failing.map((a) => a.id),
      ['GHSA-aaaa-bbbb-cccc']
    );
  });

  it('reports an entry no advisory matches any more, so it can go', () => {
    const r = judge(report(), ALLOW);
    assert.deepEqual(r.failing, []);
    assert.deepEqual(r.stale, ['GHSA-aaaa-bbbb-cccc']);
  });

  it('counts an advisory once, however many packages reach it', () => {
    const rep = report(DEV_ONLY);
    rep.vulnerabilities.another = { name: 'another', severity: 'high', via: [DEV_ONLY], range: '*' };
    assert.equal(advisories(rep).length, 1);
  });

  it('reads the GHSA id off the advisory URL', () => {
    assert.equal(ghsaId('https://github.com/advisories/GHSA-ch52-4w7c-c8xp'), 'GHSA-ch52-4w7c-c8xp');
    assert.equal(ghsaId('https://example.com/nothing'), null);
  });
});

describe('scripts/audit-allow.json', () => {
  it('names each advisory by its GHSA id and says why it is allowed', () => {
    const allow = readAllowList(ALLOW_FILE);
    assert.ok(Array.isArray(allow));
    for (const a of allow) {
      assert.match(a.id, /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);
      assert.ok(a.reason.length >= 20, a.id + ': no reason');
    }
  });

  it('refuses an entry without a reason or without a GHSA id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_audit_allow_'));
    const file = path.join(dir, 'audit-allow.json');
    try {
      fs.writeFileSync(file, JSON.stringify([{ id: 'GHSA-aaaa-bbbb-cccc' }]));
      assert.throws(() => readAllowList(file), /needs a reason/);
      fs.writeFileSync(file, JSON.stringify([{ id: 'CVE-2026-0001', reason: 'a reason long enough to count' }]));
      assert.throws(() => readAllowList(file), /needs a GHSA id/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CI', () => {
  it('audits the production tree with no exceptions, then the whole tree against the list', () => {
    const ci = quelle('.github/workflows/ci.yml');
    const prod = ci.indexOf('run: npm audit --audit-level=high --omit=dev');
    const all = ci.indexOf('run: node scripts/audit-check.js');
    assert.ok(prod > 0, 'the production audit step is gone');
    assert.ok(all > prod, 'the whole-tree audit does not follow the production one');
    assert.ok(!/run: npm audit --audit-level=high\n/.test(ci), 'an unfiltered audit step is back');
  });
});
