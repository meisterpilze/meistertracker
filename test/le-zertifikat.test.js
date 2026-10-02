'use strict';
// Let's Encrypt, read off the certificate instead of off notes about it.
//
// Three things went by something other than the certificate on disk:
//
// - The renewal went by le_expiry, a note the issuance writes and nothing reads
//   back. A database restored from before the first issuance has no note, so
//   checkCertRenewal() returned on every tick while the certificate ran out.
// - The issuance wrote "now + 90 days" as that note, whatever lifetime the CA
//   gave the certificate.
// - "Is it Let's Encrypt?" searched the PEM text, which is base64: "Let's
//   Encrypt" never appears in it, and "R3" turns up by chance in about one
//   self-signed certificate in six.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SRV = quelle('server.js');

// Made-up certificates with fixed dates, generated once with openssl. The first
// is signed by a throwaway CA whose subject copies Let's Encrypt's issuer line;
// the second is self-signed, like the fallback gen-cert writes.
const LE_PEM = `-----BEGIN CERTIFICATE-----
MIIBoDCCAUagAwIBAgIUa5yt3YpMmN2ZGumZbniPyFWN0kUwCgYIKoZIzj0EAwIw
QTELMAkGA1UEBhMCVVMxFjAUBgNVBAoMDUxldCdzIEVuY3J5cHQxGjAYBgNVBAMM
EVRlc3QgSW50ZXJtZWRpYXRlMB4XDTI2MTAwMTAwMDAwMFoXDTI2MTIzMDAwMDAw
MFowGzEZMBcGA1UEAwwQdGVzdC5leGFtcGxlLmNvbTBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABJICIg18pUEBC+6hCs6xDl7rh7v461AeJGsl767fkhlxcfrgfiGG
5QKQWyyCxnzEucfcMAlAKFmjrTOTExNm1xyjQjBAMB0GA1UdDgQWBBSepyCkvs6Z
0/p4M9aH5U5F6jjwyzAfBgNVHSMEGDAWgBS4yQSnCRC1JNoxdHJbe9lhZDkGGDAK
BggqhkjOPQQDAgNIADBFAiB2rMfE7BOmDHIlOqLRTLnejtFk2HFf/kr8FCLrzlkr
+gIhALCfgQg5hm5wNNoPLAC7VgxVv2nVsd9v4UbwrDZngsoY
-----END CERTIFICATE-----
`;
const LE_VALID_TO = '2026-12-30T00:00:00.000Z';

const SELF_PEM = `-----BEGIN CERTIFICATE-----
MIIBfTCCASOgAwIBAgIUdfmmhavUpN474zK7h4D9gB6PSqEwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MTAwMTAwMDAwMFoXDTI3MTAwMTAw
MDAwMFowFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEkgIiDXylQQEL7qEKzrEOXuuHu/jrUB4kayXvrt+SGXFx+uB+IYblApBb
LILGfMS5x9wwCUAoWaOtM5MTE2bXHKNTMFEwHQYDVR0OBBYEFJ6nIKS+zpnT+ngz
1oflTkXqOPDLMB8GA1UdIwQYMBaAFJ6nIKS+zpnT+ngz1oflTkXqOPDLMA8GA1Ud
EwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgFMMFu/pq04Styq9bRm43y8u6
FnhPNZnKDjRlcz9xbb4CIQDcvRVFiHN8rxp+IpinM/ylSd0FPFA5A93Ijsnb2Mhg
fQ==
-----END CERTIFICATE-----
`;
const SELF_VALID_TO = '2027-10-01T00:00:00.000Z';

// A function from server.js, with the names it uses handed in.
function lift(name, inject) {
  const keys = Object.keys(inject);
  const fn = new Function(...keys, hebeFunktion(name, SRV) + '\nreturn ' + name + ';');
  return fn(...keys.map((k) => inject[k]));
}

const LE_ISSUER = (() => {
  const m = SRV.match(/^const LE_ISSUER = .*;$/m);
  assert.ok(m, 'LE_ISSUER not found in server.js; the test has to follow it');
  return new Function(m[0] + '\nreturn LE_ISSUER;')();
})();

const DAY = 24 * 60 * 60 * 1000;
const renewalExpiry = lift('renewalExpiry', {});

describe('certOnDisk() reads the certificate itself', () => {
  const onDisk = (fsStub) => lift('certOnDisk', { fs: fsStub, crypto, CERT_CRT: '/certs/server.crt', LE_ISSUER })();
  const file = (pem) => ({ existsSync: () => true, readFileSync: () => pem });

  it("knows a Let's Encrypt certificate by its issuer, and reads its expiry", () => {
    const c = onDisk(file(LE_PEM));
    assert.equal(c.letsEncrypt, true);
    assert.equal(c.validTo.toISOString(), LE_VALID_TO);
    // The PEM text does not say so: the check this replaced looked there.
    assert.ok(!LE_PEM.includes("Let's Encrypt"));
  });

  it('knows a self-signed certificate is not one', () => {
    const c = onDisk(file(SELF_PEM));
    assert.equal(c.letsEncrypt, false);
    assert.equal(c.validTo.toISOString(), SELF_VALID_TO);
  });

  it('gives null, never an exception, for no file or an unreadable one', () => {
    assert.equal(onDisk({ existsSync: () => false, readFileSync: () => LE_PEM }), null);
    assert.equal(onDisk(file('not a certificate')), null);
    assert.equal(
      onDisk({
        existsSync: () => true,
        readFileSync: () => {
          throw new Error('EACCES');
        }
      }),
      null
    );
  });
});

describe('renewalExpiry() goes by the certificate when it can', () => {
  const le = (iso) => ({ validTo: new Date(iso), letsEncrypt: true });
  const self = { validTo: new Date(SELF_VALID_TO), letsEncrypt: false };

  it('takes the certificate over a missing note, and says to write it back', () => {
    assert.deepEqual(renewalExpiry(null, le(LE_VALID_TO)), { expiry: new Date(LE_VALID_TO), writeBack: true });
  });

  it('takes the certificate over an older note from an earlier issuance', () => {
    const r = renewalExpiry('2026-07-01T00:00:00.000Z', le(LE_VALID_TO));
    assert.equal(r.expiry.toISOString(), LE_VALID_TO);
    assert.equal(r.writeBack, true);
  });

  it('writes nothing back when the note already says what the certificate says', () => {
    assert.equal(renewalExpiry(LE_VALID_TO, le(LE_VALID_TO)).writeBack, false);
  });

  it('a malformed note is replaced too', () => {
    assert.equal(renewalExpiry('garbage', le(LE_VALID_TO)).writeBack, true);
  });

  it("without a Let's Encrypt certificate the note is all there is", () => {
    assert.deepEqual(renewalExpiry(LE_VALID_TO, self), { expiry: new Date(LE_VALID_TO), writeBack: false });
    assert.deepEqual(renewalExpiry(LE_VALID_TO, null), { expiry: new Date(LE_VALID_TO), writeBack: false });
  });

  it('with neither there is nothing to go by', () => {
    assert.deepEqual(renewalExpiry(null, self), { expiry: null, writeBack: false });
    assert.deepEqual(renewalExpiry(null, null), { expiry: null, writeBack: false });
    assert.deepEqual(renewalExpiry('garbage', null), { expiry: null, writeBack: false });
  });
});

describe('checkCertRenewal()', () => {
  // The renewal with stand-ins for the database, the log and the ACME request.
  function run({ note, disk, worktree = false, cfgThrows = false }) {
    const writes = [];
    const logs = [];
    let requested = 0;
    const cfg = { leEnabled: true, domain: 'example', token: 'x', leExpiry: note };
    const check = lift('checkCertRenewal', {
      WORKTREE_MODE: worktree,
      database: {},
      db: {
        getDuckdnsCfg: () => {
          if (cfgThrows) throw new Error('database is locked');
          return cfg;
        },
        updateDuckdnsStatus: (_d, f) => writes.push(f)
      },
      log: (level, msg) => logs.push(level + ' ' + msg),
      requestLetsEncryptCert: () => requested++,
      certOnDisk: () => disk,
      renewalExpiry
    });
    check();
    return { writes, logs, requested };
  }
  const leIn = (days) => ({ validTo: new Date(Date.now() + days * DAY), letsEncrypt: true });

  it('renews a certificate about to run out that the restored database has no note of', () => {
    const disk = leIn(10);
    const r = run({ note: null, disk });
    assert.deepEqual(r.writes, [{ leExpiry: disk.validTo.toISOString() }]);
    assert.equal(r.requested, 1);
  });

  it('corrects an old note without renewing a certificate that has time left', () => {
    const disk = leIn(60);
    const r = run({ note: new Date(Date.now() - 5 * DAY).toISOString(), disk });
    assert.deepEqual(r.writes, [{ leExpiry: disk.validTo.toISOString() }]);
    assert.equal(r.requested, 0);
  });

  it('leaves the self-signed fallback alone when there is no note', () => {
    const r = run({ note: null, disk: { validTo: new Date(Date.now() + 5 * DAY), letsEncrypt: false } });
    assert.deepEqual(r.writes, []);
    assert.equal(r.requested, 0);
  });

  it('cannot stop the server from starting', () => {
    let r;
    assert.doesNotThrow(() => {
      r = run({ note: null, disk: leIn(10), cfgThrows: true });
    });
    assert.ok(
      r.logs.some((l) => l.startsWith('error ')),
      'the failure is not logged'
    );
  });

  it('does nothing in a worktree', () => {
    const r = run({ note: null, disk: leIn(10), worktree: true });
    assert.deepEqual(r.writes, []);
    assert.equal(r.requested, 0);
  });
});

describe('where the server says what kind of certificate it has', () => {
  // assert.ok rather than assert.match: a failed match on server.js would print
  // all of it.
  it('the DuckDNS status and the full health check both ask the issuer', () => {
    assert.ok(/const isLE = LE_ISSUER\.test\(x509\.issuer/.test(SRV), '/api/health/full does not ask the issuer');
    assert.ok(
      /const disk = certOnDisk\(\);\n\s+if \(disk\) certInfo = \{ type: disk\.letsEncrypt \?/.test(SRV),
      '/api/duckdns/status does not go by certOnDisk()'
    );
    // None of the PEM-text needles is left.
    for (const needle of [/certPem\.includes\('R\d+'\)/, /certPem\.includes\("Let's Encrypt"\)/, /CN=R\\d\+/]) {
      assert.ok(!needle.test(SRV), 'still searching the PEM text: ' + needle);
    }
  });

  it('the issuance records the expiry the certificate carries', () => {
    assert.ok(
      /new crypto\.X509Certificate\(certPem\)\.validTo/.test(hebeFunktion('requestLetsEncryptCert', SRV)),
      'requestLetsEncryptCert does not read the issued certificate'
    );
  });

  it("LE_ISSUER matches Let's Encrypt's issuer line and nothing like it", () => {
    assert.ok(LE_ISSUER.test("C=US\nO=Let's Encrypt\nCN=R11"));
    assert.ok(!LE_ISSUER.test('CN=localhost'));
    assert.ok(!LE_ISSUER.test("O=Let's Encrypt Fan Club"));
  });
});
