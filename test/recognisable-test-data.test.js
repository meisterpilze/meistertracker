'use strict';
// Test data has to read as test data. An order fixture once carried a phone
// number, a customer name and an address that nobody could tell apart from a
// real order, and the only way to settle it was to look the order up in the
// shop. Invented values that look invented settle it by themselves.
//
// What a machine can check is checked here: an email address in a fixture is on
// a domain kept for examples, and a postcode is 00000. Phone numbers and a
// street with its postcode are the guard's job (scripts/leak-scan.js), names are
// the reviewer's: CLAUDE.md lists the placeholders to use.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Domains reserved for examples (RFC 2606, RFC 6761), and example.de, which this
// repository has always used for the same purpose.
const EXAMPLE_DOMAIN = /(^|\.)example\.(com|org|net|de)$|\.(test|example|invalid|localhost)$/i;

// An address on its own, not the user part of a URL: `https://user:pw@host/` is
// how a test hands over credentials it expects to see stripped, and the host
// there is the point of the test.
const EMAIL =
  /(^|[^A-Za-z0-9._%+:/-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})(?![A-Za-z0-9.-])/g;

// A postcode in a field or an assertion about one: `postalCode: '12345'`,
// `shipPostal: '12345'`, `assert.equal(row.ship_postal, '12345')`.
const POSTCODE = /(?:postal|zip|plz)[A-Za-z_]*['"]?\s*[:,=]\s*['"](\d{4,5})['"]/gi;

function fixtureFiles() {
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  } catch {
    return null; // no git available; CI covers this path
  }
  // This file is left out: its second test is bait by design.
  return tracked.filter(
    (f) =>
      (f.startsWith('test/') && f.endsWith('.js') && f !== 'test/recognisable-test-data.test.js') ||
      /(^|\/)[^/]*mock[^/]*\.html$/.test(f) ||
      f === 'scripts/measure-fixture.js' ||
      f.endsWith('.example.json')
  );
}

function findings(text, label) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    let m;
    EMAIL.lastIndex = 0;
    while ((m = EMAIL.exec(line)) !== null) {
      if (!EXAMPLE_DOMAIN.test(m[3])) out.push(label + ':' + (i + 1) + ' email on a real domain');
    }
    POSTCODE.lastIndex = 0;
    while ((m = POSTCODE.exec(line)) !== null) {
      if (m[1] !== '00000') out.push(label + ':' + (i + 1) + ' postcode other than 00000');
    }
  });
  return out;
}

describe('test data reads as test data', () => {
  it('uses example domains and the postcode 00000 in every fixture', () => {
    const files = fixtureFiles();
    if (!files) return;
    const all = [];
    for (const f of files) all.push(...findings(fs.readFileSync(path.join(ROOT, f), 'utf8'), f));
    assert.deepEqual(all, []);
  });

  it('tells an invented address from one that could be real', () => {
    assert.deepEqual(findings("customerEmail: 'kunde@example.de'", 't'), []);
    assert.deepEqual(findings("email: 'a@b.test'", 't'), []);
    assert.deepEqual(findings("customerEmail: 'rep@kundenmail.de'", 't'), ['t:1 email on a real domain']);
    assert.deepEqual(findings("url: 'https://bot:s3cret@github.com/x/y.git'", 't'), []);
    assert.deepEqual(findings("postalCode: '00000'", 't'), []);
    assert.deepEqual(findings("shipPostal: '12345'", 't'), ['t:1 postcode other than 00000']);
    assert.deepEqual(findings("assert.equal(row.ship_postal, '54321');", 't'), ['t:1 postcode other than 00000']);
  });
});
