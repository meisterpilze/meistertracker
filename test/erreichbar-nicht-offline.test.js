'use strict';
// The day the app said "offline" and meant "your certificate changed".
//
// A Let's Encrypt certificate covers the public hostname and cannot cover
// localhost or a private IP — no public CA will issue for a name it cannot
// verify. gen-cert.sh and gen-cert.ps1 both put DNS:localhost, IP:127.0.0.1 and
// the LAN IP in the SAN precisely because those are the addresses you actually
// open. So switching to ACME silently invalidates both of them, and the switch
// takes effect not when the file is written but at the next restart, which can
// be days later.
//
// Two things then conspired. server.js printed
//
//     Open on this PC:      https://localhost:3000
//     Open on phone/tablet: https://<lan-ip>:3000
//
// which are exactly the two addresses the new certificate rejects. And sw.js
// caught every fetch rejection — TLS included — and answered
// `{"error":"offline"}` with status 503. A page can carry a click-through
// certificate exception; a service worker cannot, so the worker's fetch died on
// the hostname check and the app reported itself disconnected while its server
// was healthy, serving, and logging nothing.
//
// The symptom was indistinguishable from a dead server. This file pins both
// halves of not saying that again.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

/** Lift a top-level function out of a source file and give it its own scope. */
function lift(src, name, inject) {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}', 'm'));
  assert.ok(m, name + ' is gone — if it was renamed, this test needs to follow it');
  const args = Object.keys(inject || {});
  return new Function(...args, m[0] + '\nreturn ' + name + ';')(...args.map((k) => inject[k]));
}

describe('a failed API call says which failure it was', () => {
  const bodyFor = lift(SW, '_apiFailureBody');

  it('no network: that, and only that, is "offline"', () => {
    const b = bodyFor(new TypeError('NetworkError'), false, 'https://host/api/data');
    assert.equal(b.error, 'offline');
    assert.equal(b.reason, 'no network connection');
  });

  it('browser says online but the fetch failed: "unreachable", with the reason', () => {
    const b = bodyFor(new TypeError('SSL_ERROR_BAD_CERT_DOMAIN'), true, 'https://localhost:3000/api/data');
    assert.equal(b.error, 'unreachable', 'a TLS failure is not an offline device');
    assert.match(b.reason, /SSL_ERROR_BAD_CERT_DOMAIN/, 'the real reason has to survive — it is the whole point');
    assert.match(b.url, /localhost:3000/, 'and which address it was');
  });

  it('an error with no message still carries something', () => {
    const b = bodyFor({ name: 'AbortError' }, true, 'https://host/api/x');
    assert.equal(b.reason, 'AbortError');
    const bare = bodyFor(null, true, 'https://host/api/x');
    assert.equal(bare.reason, 'fetch failed', 'never an empty explanation');
  });

  it('the word "offline" is not hardcoded into the response any more', () => {
    // The original line. If it comes back, so does the day it cost.
    assert.equal(
      /'\{"error":"offline"\}'/.test(SW),
      false,
      'sw.js is answering a literal {"error":"offline"} again, for every kind of failure'
    );
  });

  it('and the worker says it out loud, once per origin', () => {
    assert.match(SW, /function _warnUnreachable/, 'nothing surfaces the reason to the console');
    assert.match(SW, /_unreachableSeen/, 'the warning is not deduplicated, so it will bury itself');
    assert.match(SW, /console\.error/);
  });
});

describe('the server does not advertise addresses its certificate rejects', () => {
  // A stub X509 so the parsing is tested without shipping a certificate or
  // shelling out to openssl.
  const fsStub = {
    existsSync: () => true,
    readFileSync: () => 'PEM'
  };
  const cryptoStub = (san, subject) => ({
    X509Certificate: class {
      constructor() {
        this.subjectAltName = san;
        this.subject = subject || '';
      }
    }
  });

  const covered = (san, subject) =>
    lift(SRV, 'certCoveredHosts', {
      fs: fsStub,
      crypto: cryptoStub(san, subject),
      CERT_CRT: '/certs/server.crt'
    })();

  it('reads the subject alternative names', () => {
    assert.deepEqual(covered('DNS:example.duckdns.org'), ['example.duckdns.org']);
    assert.deepEqual(covered('DNS:localhost, IP Address:127.0.0.1, IP Address:10.0.0.5'), [
      'localhost',
      '127.0.0.1',
      '10.0.0.5'
    ]);
  });

  it('falls back to the common name when there is no SAN', () => {
    assert.deepEqual(covered('', 'CN=old-style.example\nC=DE'), ['old-style.example']);
  });

  it('an unreadable certificate produces no claim rather than a crash', () => {
    const fn = lift(SRV, 'certCoveredHosts', {
      fs: {
        existsSync: () => true,
        readFileSync: () => {
          throw new Error('EACCES');
        }
      },
      crypto: cryptoStub(''),
      CERT_CRT: '/certs/server.crt'
    });
    assert.deepEqual(fn(), []);
  });

  describe('and reports what is left out', () => {
    const uncoveredWith = (names) => lift(SRV, 'certUncoveredHosts', { certCoveredHosts: () => names });

    it('the Let’s Encrypt case — the one that happened', () => {
      const f = uncoveredWith(['example.duckdns.org']);
      assert.deepEqual(
        f(['localhost', '192.168.1.20']),
        ['localhost', '192.168.1.20'],
        'both banner addresses are uncovered and the banner has to say so'
      );
    });

    it('the self-signed case — nothing to warn about', () => {
      const f = uncoveredWith(['example.duckdns.org', 'localhost', '127.0.0.1', '192.168.1.20']);
      assert.deepEqual(f(['localhost', '192.168.1.20']), []);
    });

    it('a wildcard covers one label, not two', () => {
      const f = uncoveredWith(['*.example.com']);
      assert.deepEqual(f(['a.example.com']), [], 'one label should match');
      assert.deepEqual(f(['a.b.example.com']), ['a.b.example.com'], 'two labels must not');
      assert.deepEqual(f(['example.com']), ['example.com'], 'the bare domain is not covered by *.');
    });

    it('says nothing when it cannot read the certificate at all', () => {
      const f = uncoveredWith([]);
      assert.deepEqual(f(['localhost']), [], 'a guess is worse than silence here');
    });
  });

  it('the startup banner actually consults it', () => {
    // The helpers existing is not the fix; the banner calling them is.
    const banner = SRV.slice(SRV.indexOf('Meistertracker is running!'));
    assert.match(
      banner.slice(0, 2000),
      /certUncoveredHosts\(\[\s*'localhost'/,
      'the banner no longer checks its own certificate'
    );
    assert.match(banner.slice(0, 2000), /certCoveredHosts\(\)/, 'the banner does not say which names would work');
  });

  describe('and recommends an address that works instead of two that do not', () => {
    // Warning after the fact was still the wrong shape: the two lines people
    // copy were printed first and contradicted three lines later. What the
    // banner offers has to be the thing that actually loads.
    const banner = SRV.slice(SRV.indexOf('Meistertracker is running!'), SRV.indexOf('CalDAV server:'));

    it('branches on whether anything is uncovered at all', () => {
      assert.match(
        banner,
        /if \(!uncovered\.length\)/,
        'the banner prints the same lines regardless of the certificate'
      );
    });

    it('leads with the covered name when the recommended addresses are not covered', () => {
      assert.match(banner, /vouched/, 'nothing works out which name the certificate would accept');
      assert.match(banner, /Open on any device:\s*'\s*\+\s*protocol\s*\+\s*':\/\/'\s*\+\s*vouched\[0\]/);
    });

    it('excludes wildcards and the two addresses it is replacing', () => {
      // *.example.com is not something you can type into a phone, and offering
      // back localhost or the LAN IP would defeat the point.
      const pick = banner.slice(banner.indexOf('const vouched'), banner.indexOf('if (!uncovered.length)'));
      assert.match(pick, /startsWith\('\*\.'\)/, 'a wildcard could be offered as an address');
      assert.match(pick, /!== 'localhost'/);
      assert.match(pick, /!== ip/);
    });

    it('says why clicking past the warning will not save you', () => {
      assert.match(banner, /service worker will not/i, 'the banner does not explain the failure mode');
    });

    it('and what a phone needs, since it has no hosts file', () => {
      assert.match(banner, /hosts file/, 'no mention of how this machine reaches the name');
      assert.match(banner, /router has to answer/, 'no mention of what a phone needs');
    });

    it('keeps the plain two lines when the certificate does cover them', () => {
      const selfSigned = banner.slice(0, banner.indexOf('} else if'));
      assert.match(selfSigned, /Open on this PC/, 'the self-signed case lost its normal output');
      assert.match(selfSigned, /Open on phone\/tablet/);
    });
  });
});
