'use strict';
// Tests for the guard, and for the shapes that got past everything before it.
//
// The address of a live instance once went public through pull request prose.
// None of it was ever in a file, which is why a file-only scanner is not enough
// and why these tests exercise prose shapes as hard as code shapes.
//
// Every fixture below uses invented hosts. This file is public, so writing the
// real one here to "test it properly" would republish exactly what the guard
// exists to withhold — the same reason the rules are patterns instead of a list
// of names.
//
// The three groups that matter:
//
//   caught   — the shapes that actually leaked, plus the near neighbours
//   passed   — the legitimate uses already in this repository; the app talks to
//              duckdns.org for real, and a guard that broke that would be
//              switched off within a week
//   quiet    — findings must carry a location and never the matched text,
//              because workflow logs on a public repository are world-readable

// This file is the one exception the guard makes for itself: every fixture
// below is a leak shape, so scanning it would fail on purpose-built bait. The
// opt-out is the marker on the next line, and it is the only one in the tree.
// leak-scan:allow-file

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const { scan, redact, ALLOW_MARKER, FILE_ALLOW_MARKER } = require('../scripts/leak-scan.js');

const ROOT = path.resolve(__dirname, '..');
const prose = (t) => scan(t, { surface: 'prose', label: 'test' });
const file = (t) => scan(t, { surface: 'file', label: 'test' });
const rules = (findings) => findings.map((f) => f.rule).sort();

describe('leak-scan: the shapes that leaked', () => {
  it('catches a concrete host under a dynamic-DNS domain', () => {
    // The shapes that a verification checklist takes, which is how it got out.
    assert.deepEqual(rules(prose('- [ ] Server: `https://acme-intra.duckdns.org:3000/caldav/`')), ['dynamic-host']);
    assert.deepEqual(rules(prose('paste `https://acme-intra.duckdns.org:3000/mcp`')), ['dynamic-host']);
    assert.deepEqual(rules(prose('why `acme-intra.duckdns.org:3000` is unreachable')), ['dynamic-host']);
  });

  it('catches the same shape in a commit message body', () => {
    const body = [
      'Ein Symbol auf dem Handy',
      '',
      'Zertifikat für acme-intra.duckdns.org bis November, Sitzung sieben Tage.'
    ].join('\n');
    const found = prose(body);
    assert.deepEqual(rules(found), ['dynamic-host']);
    assert.equal(found[0].line, 3);
  });

  it('catches tunnel hosts, not only DuckDNS', () => {
    for (const host of [
      'https://abc-123.ngrok-free.app',
      'https://tidy-pear-42.trycloudflare.com',
      'box.ddns.net',
      'laptop.tail9f2c.ts.net'
    ]) {
      assert.deepEqual(rules(prose(host)), ['dynamic-host'], host);
    }
  });

  it('catches a multi-label host, not just the first level', () => {
    assert.deepEqual(rules(prose('api.acme-intra.duckdns.org')), ['dynamic-host']);
  });

  it('catches a routable address and, in prose only, a LAN address', () => {
    assert.deepEqual(rules(prose('curl https://203.0.114.9:3000/api')), ['public-ip']);
    assert.deepEqual(rules(prose('the box sits at 192.168.178.21')), ['private-ip']);
    // The deployment docs legitimately show LAN addresses, so files stay quiet.
    assert.deepEqual(rules(file('the box sits at 192.168.178.21')), []);
    assert.deepEqual(rules(file('curl https://203.0.114.9:3000/api')), ['public-ip']);
  });

  it('catches a credential whose name is part of a longer identifier', () => {
    // DUCKDNS_TOKEN has no word boundary at the underscore. A plain \b misses
    // the one environment variable most likely to be pasted into a PR body.
    assert.deepEqual(rules(prose('DUCKDNS_TOKEN=a7b3c9d1e4f24e2fb8c1d0e9f7a6b5c4')), ['credential']);
    assert.deepEqual(rules(prose('Authorization: Bearer 9f8e7d6c5b4a39281706fedcba098765')), ['credential']);
  });
});

describe('leak-scan: the legitimate uses in this repository', () => {
  it('leaves the DuckDNS API host alone', () => {
    // server.js posts to this, the settings tab links to it, three language
    // files mention it. Flagging it would make the guard useless.
    assert.deepEqual(rules(file("'https://www.duckdns.org/update?domains=' + cfg.domain")), []);
    assert.deepEqual(rules(file('<a href="https://www.duckdns.org">duckdns.org</a>')), []);
  });

  it('leaves a bare suffix alone', () => {
    // The concatenation form in server.js, and the <span> in index.html.
    assert.deepEqual(rules(file("const fullDomain = cfg.domain + '.duckdns.org';")), []);
    assert.deepEqual(rules(file('<span>.duckdns.org</span>')), []);
    assert.deepEqual(rules(file('Subdomain prefix only (without `.duckdns.org`)')), []);
  });

  it('leaves the documented placeholders alone', () => {
    // DEPLOYMENT.md and the gen-cert headers already use these. An angle
    // bracket cannot be part of a label, so the pattern never reaches them.
    assert.deepEqual(rules(file('Public hostname like `<your-name>.duckdns.org`')), []);
    assert.deepEqual(rules(file('URL: `https://<your-name>.duckdns.org:3000`')), []);
    assert.deepEqual(rules(file('-Domain myhost.duckdns.org')), []);
  });

  it('leaves reserved and documentation addresses alone', () => {
    for (const line of [
      'the server binds 0.0.0.0',
      'plain HTTP only for 127.0.0.1',
      'IP Address:192.168.178.21 in the SAN list',
      'TEST-NET 192.0.2.1 and 198.51.100.7 and 203.0.113.9',
      'link-local 169.254.1.1',
      'Tailscale hands out 100.101.102.103'
    ]) {
      assert.deepEqual(rules(file(line)), [], line);
    }
  });

  it('does not mistake version quads, OIDs or RFC sections for addresses', () => {
    // All three of these are in the repository and all three are IPv4-shaped.
    for (const line of [
      'Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36',
      '-TextExtension @("2.5.29.17={text}$sanText")',
      "-TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.1')",
      '// I-15: SEQUENCE counter for VTODO output (RFC 5545 §3.8.7.4). Bumped on',
      'upgrade to v10.20.30.40 of the driver'
    ]) {
      assert.deepEqual(rules(file(line)), [], line);
    }
  });

  it('still catches an address inside a URL, where the slash is doubled', () => {
    // The rule that lets `Chrome/126.0.0.0` through must not also let this by.
    assert.deepEqual(rules(file('fetch("https://203.0.114.9:3000/api")')), ['public-ip']);
  });

  it('does not mistake a reference to a credential for a credential', () => {
    for (const line of [
      'const password = generateCaldavAppPassword();',
      "return { url: PRINT_BRIDGE_URL_ENV, token: PRINT_BRIDGE_TOKEN_ENV, source: 'env' };",
      "() => ({ url: store.url, token: 'SECRET-BRIDGE-TOKEN', source: 'db' })",
      'DUCKDNS_TOKEN=your-token-here',
      'PRINT_BRIDGE_TOKEN: changeme',
      'const token = cfg.token;'
    ]) {
      assert.deepEqual(rules(file(line)), [], line);
    }
  });

  it('honours the per-line escape hatch', () => {
    const line = 'acme-intra.duckdns.org ' + ALLOW_MARKER;
    assert.deepEqual(rules(prose(line)), []);
  });

  it('honours the per-file opt-out, but only for files', () => {
    const text = FILE_ALLOW_MARKER + '\nacme-intra.duckdns.org';
    assert.deepEqual(rules(file(text)), []);
    // Prose must not be able to wave itself through: the person writing a pull
    // request body is the person the guard is there to check.
    assert.deepEqual(rules(prose(text)), ['dynamic-host']);
  });
});

describe('leak-scan: findings stay quiet', () => {
  it('reports a location and never the match', () => {
    const secret = 'acme-intra.duckdns.org';
    const found = prose('Server: https://' + secret + ':3000 at 203.0.114.9');
    assert.equal(found.length, 2);
    const serialised = JSON.stringify(found);
    assert.ok(!serialised.includes('acme-intra'), 'finding leaked the host label');
    assert.ok(!serialised.includes('203.0.114.9'), 'finding leaked the address');
    for (const f of found) {
      assert.ok(f.line >= 1 && f.column >= 1);
      assert.equal(typeof f.why, 'string');
    }
  });

  it('points at the right line and column', () => {
    const found = prose(['first line', 'second line', 'go to acme.duckdns.org now'].join('\n'));
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 3);
    assert.equal(found[0].column, 'go to '.length + 1);
  });
});

describe('leak-scan: redaction', () => {
  it('replaces every match and leaves the rest of the sentence intact', () => {
    const out = redact('Server https://203.0.114.9:3000 alias acme-intra.duckdns.org', {
      surface: 'prose'
    });
    assert.equal(out, 'Server https://<redacted-ip>:3000 alias <redacted-host>.duckdns.org');
  });

  it('produces text that scans clean', () => {
    const dirty = [
      '- [ ] Server: `https://acme-intra.duckdns.org:3000/caldav/`',
      'reachable at 203.0.114.9, DUCKDNS_TOKEN=a7b3c9d1e4f24e2fb8c1d0e9f7a6b5c4',
      'LAN 192.168.178.21'
    ].join('\n');
    assert.ok(prose(dirty).length >= 4);
    assert.deepEqual(prose(redact(dirty, { surface: 'prose' })), []);
  });

  it('leaves legitimate text untouched', () => {
    const clean = "see https://www.duckdns.org, then cfg.domain + '.duckdns.org'";
    assert.equal(redact(clean, { surface: 'prose' }), clean);
  });
});

describe('leak-scan: the repository itself', () => {
  it('has no findings in any tracked file', () => {
    // Runs the guard over the real tree, so `npm test` fails locally for the
    // same reason CI would — before the push, not after the pull request.
    let tracked;
    try {
      tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
    } catch {
      return; // no git available; CI covers this path
    }
    const findings = [];
    for (const rel of tracked) {
      const abs = path.join(ROOT, rel);
      let text;
      try {
        text = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      if (text.includes('\0')) continue;
      findings.push(...scan(text, { label: rel, surface: 'file' }));
    }
    assert.deepEqual(
      findings.map((f) => f.label + ':' + f.line + ' ' + f.rule),
      []
    );
  });
});
