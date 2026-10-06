'use strict';
// The TSA's signature on an RFC 3161 token, checked inside the app.
//
// A token is CMS SignedData around a TSTInfo (scripts/rfc3161.js reads the
// TSTInfo). That the hash in it matches a link says nothing about who made
// it: someone who can write the database file can also store a token of
// their own. This checks what `openssl ts -verify` checks, at the time the
// token names instead of today:
//
//   1. one signer, with signed attributes: content type TSTInfo, and a
//      message digest equal to the hash of the TSTInfo in the token;
//   2. the signature over those attributes (their DER, tagged as a SET), with
//      the key of the certificate the signer names: RSA PKCS #1 v1.5,
//      RSA-PSS, ECDSA or Ed25519;
//   3. that the signed attributes name that certificate too (ESS
//      signingCertificate or signingCertificateV2, RFC 5035), and that it is
//      a certificate for time stamping: extended key usage id-kp-timeStamping,
//      critical, and no other purpose openssl knows (RFC 3161 §2.3). Without
//      this, any certificate under a root Node trusts, a web server's among
//      them, could sign;
//   4. a chain from it through the certificates in the token to a root
//      certificate Node ships (tls.rootCertificates), every signature in it
//      valid and every certificate below the root valid at the token's
//      genTime. The time of the stamp, not today: a stamp still counts after
//      the TSA's certificate has expired. The root is trusted as it is. A CA
//      in the chain whose extended key usage leaves out time stamping does
//      not vouch for a TSA below it: a CA allowed to issue only web
//      certificates, and run by someone else, could otherwise make one.
//      openssl does not check this.
//
// The answer, per token:
//
//   ok         all of the above holds
//   bad        the token does not hold up: a digest or a signature does not
//              match, the token's own or one in the chain, the certificate is
//              not one for time stamping, or the chain was not valid at
//              genTime. It was changed afterwards, or it never came from the
//              TSA. Also a token that cannot be checked at all: without the
//              signer's certificate (this app always asks for it), or with an
//              algorithm this check does not cover. Such a token cannot be
//              told from a changed one.
//   unchecked  everything that can be checked holds, and still the app does
//              not vouch for it: the chain ends at a root Node does not ship
//              ('root'), it gets to one only through a CA limited to other
//              purposes ('purpose'), or it holds only with MD5, SHA-1 or
//              another algorithm not on the strong list ('algorithm').
//              openssl with the TSA's own root certificate can check such a
//              token. A change to the TSTInfo, the signed attributes, the
//              signature or the signer's certificate never gets here: the
//              digest and those signatures are checked before any of these
//              reasons counts. A change to a CA certificate in the token can:
//              once its chain no longer leads to a known root, it looks like
//              one whose root Node does not ship.
//
// Not checked: revocation (CRL, OCSP), and which TSA it was. Any TSA whose
// chain ends at a root Node ships passes; `signer` names the certificate that
// signed, so the app and the printed lab book can show it.
const crypto = require('crypto');
const tls = require('tls');
const { der, tokenInfo } = require('./rfc3161.js');

const { readElement, children, content, expectTag, integerHex } = der;

// OIDs, as the hex of their DER content.
const OID_SIGNED_DATA = '2a864886f70d010702';
const OID_TST_INFO = '2a864886f70d0109100104';
const OID_CONTENT_TYPE = '2a864886f70d010903';
const OID_MESSAGE_DIGEST = '2a864886f70d010904';
const OID_SIGNING_CERT = '2a864886f70d010910020c';
const OID_SIGNING_CERT_V2 = '2a864886f70d010910022f';
const OID_RSA_PSS = '2a864886f70d01010a';
const OID_MGF1 = '2a864886f70d010108';
const OID_ED25519 = '2b6570';
const OID_SHA1 = '2b0e03021a';
const OID_EKU = '551d25';
const OID_KEY_USAGE = '551d0f';
const OID_BASIC_CONSTRAINTS = '551d13';
const OID_SUBJECT_KEY_ID = '551d0e';
const OID_TIME_STAMPING = '2b06010505070308';
const OID_ANY_PURPOSE = '551d2500';
// The purposes openssl knows besides time stamping (crypto/x509/v3_purp.c):
// server and client authentication, code signing, e-mail, OCSP, DVCS, any
// purpose, and the two SGC ones. A TSA certificate with one of them is not
// for time stamping alone. Purposes openssl does not know are let through.
const OTHER_PURPOSES = new Set([
  '2b06010505070301',
  '2b06010505070302',
  '2b06010505070303',
  '2b06010505070304',
  '2b06010505070309',
  '2b0601050507030a',
  OID_ANY_PURPOSE,
  '6086480186f8420401',
  '2b0601040182370a0303'
]);

// Every hash Node can compute that a token may name. A digest is computed
// whatever its hash, so a changed token shows as one even then. MD5 and
// SHA-1 (WEAK) are computed but not vouched for: a token that holds up only
// with them is unchecked, not ok.
const DIGESTS = {
  '2a864886f70d0205': 'md5',
  [OID_SHA1]: 'sha1',
  '608648016503040204': 'sha224',
  '608648016503040201': 'sha256',
  '608648016503040202': 'sha384',
  '608648016503040203': 'sha512',
  '608648016503040205': 'sha512-224',
  '608648016503040206': 'sha512-256',
  '608648016503040207': 'sha3-224',
  '608648016503040208': 'sha3-256',
  '608648016503040209': 'sha3-384',
  '60864801650304020a': 'sha3-512'
};
const WEAK = new Set(['md5', 'sha1']);
// PKCS #1 v1.5 under its own name and with each hash (RFC 4055, RFC 8702),
// and ECDSA under the key's name and with each hash (RFC 5758, RFC 8692).
// The hash is the signer's digest algorithm, as openssl does it.
const RSA_PKCS1 = new Set([
  '2a864886f70d010101',
  '2a864886f70d010104',
  '2a864886f70d010105',
  '2a864886f70d01010b',
  '2a864886f70d01010c',
  '2a864886f70d01010d',
  '2a864886f70d01010e',
  '60864801650304030d',
  '60864801650304030e',
  '60864801650304030f',
  '608648016503040310'
]);
const ECDSA = new Set([
  '2a8648ce3d0201',
  '2a8648ce3d0401',
  '2a8648ce3d040301',
  '2a8648ce3d040302',
  '2a8648ce3d040303',
  '2a8648ce3d040304',
  '608648016503040309',
  '60864801650304030a',
  '60864801650304030b',
  '60864801650304030c'
]);
// Signatures on certificates that are vouched for, a list of the strong ones
// rather than of the weak: RSA PKCS #1 v1.5, ECDSA and DSA with SHA-2 or
// SHA-3, EdDSA, and RSA-PSS with a hash that is not MD5 or SHA-1. A chain
// that holds only with anything else (MD5, SHA-1, under whatever name, or
// an algorithm not listed) is unchecked. A root's signature on itself does
// not count; the root is trusted as it is.
const STRONG_CERT_SIGNATURES = new Set([
  '2a864886f70d01010e',
  '2a864886f70d01010b',
  '2a864886f70d01010c',
  '2a864886f70d01010d',
  '60864801650304030d',
  '60864801650304030e',
  '60864801650304030f',
  '608648016503040310',
  '2a8648ce3d040301',
  '2a8648ce3d040302',
  '2a8648ce3d040303',
  '2a8648ce3d040304',
  '608648016503040309',
  '60864801650304030a',
  '60864801650304030b',
  '60864801650304030c',
  '608648016503040301',
  '608648016503040302',
  '2b6570',
  '2b6571'
]);

// Bounds, so a token made up to keep the server busy (many certificates that
// all name each other as issuer, keys made to be slow) cannot: a TSA sends
// one to five certificates, its chain is shorter than MAX_CHAIN, and checking
// it takes fewer than ten signatures.
const MAX_CERTS = 20;
const MAX_CHAIN = 8;
const MAX_STEPS = 1000;
const MAX_VERIFIES = 32;
// RSA keys within reason: up to 16384 bits, and a public exponent that fits
// in 32 bits (65537 is the usual one). One as long as its modulus takes
// milliseconds to check, every time. DSA keys up to 3072 bits, the most
// FIPS 186 has.
const MAX_RSA_BITS = 16384;
const MAX_RSA_EXPONENT = 0xffffffffn;
const MAX_DSA_BITS = 3072;

// ── Reading ─────────────────────────────────────────────────

// An element with its tag and length, as it is in the buffer.
function whole(buf, el) {
  return buf.subarray(el.at, el.end);
}
function oidHex(buf, el, what) {
  return content(buf, expectTag(el, 0x06, what)).toString('hex');
}
function algorithm(buf, el) {
  const f = children(buf, expectTag(el, 0x30, 'algorithm'));
  return { oid: oidHex(buf, f[0], 'algorithm'), params: f[1] || null };
}
function boolean(buf, el) {
  return content(buf, expectTag(el, 0x01, 'boolean')).some((b) => b !== 0);
}

// Validity as RFC 5280 writes it: UTCTime (YYMMDDHHMMSSZ, 1950 to 2049) or
// GeneralizedTime (YYYYMMDDHHMMSSZ). Milliseconds since 1970.
function certTime(buf, el) {
  const text = content(buf, el).toString('latin1');
  const m =
    el.tag === 0x17
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
      : el.tag === 0x18
        ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
        : null;
  if (!m) throw new Error('RFC 3161: unreadable validity');
  const year = el.tag === 0x17 ? (Number(m[1]) < 50 ? '20' : '19') + m[1] : m[1];
  const t = Date.parse(`${year}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  if (Number.isNaN(t)) throw new Error('RFC 3161: unreadable validity');
  return t;
}

// Whether a certificate's signature algorithm is one to vouch for
// (STRONG_CERT_SIGNATURES); for RSA-PSS, whether its parameters name a
// strong hash. Parameters that cannot be read vouch for nothing.
function strongCertSignature(buf, alg) {
  if (STRONG_CERT_SIGNATURES.has(alg.oid)) return true;
  if (alg.oid !== OID_RSA_PSS) return false;
  try {
    const pss = signatureScheme(buf, alg, null);
    return !!pss && !WEAK.has(pss.hash);
  } catch {
    return false;
  }
}

// A certificate, read as far as the checks need: serial, names, validity,
// extensions, and whether its issuer signed it with a strong algorithm. Node
// reads it as well, for the signatures and names.
function readCert(buf) {
  const top = readElement(buf, 0);
  if (top.end !== buf.length) throw new Error('RFC 3161: bytes after a certificate');
  // Certificate { tbsCertificate, signatureAlgorithm, signatureValue }
  const outer = children(buf, expectTag(top, 0x30, 'certificate'));
  const tbs = children(buf, expectTag(outer[0], 0x30, 'certificate'));
  // [0] version, serialNumber, signature, issuer, validity, subject,
  // subjectPublicKeyInfo, [1] and [2] unique ids, [3] extensions
  const v = tbs[0] && tbs[0].tag === 0xa0 ? 1 : 0;
  const validity = children(buf, expectTag(tbs[v + 3], 0x30, 'validity'));
  const extensions = new Map();
  const ext = tbs.slice(v + 6).find((el) => el.tag === 0xa3);
  if (ext) {
    for (const e of children(buf, expectTag(children(buf, ext)[0], 0x30, 'extensions'))) {
      const f = children(buf, expectTag(e, 0x30, 'extension'));
      if (f.length !== 2 && f.length !== 3) throw new Error('RFC 3161: extension malformed');
      const id = oidHex(buf, f[0], 'extension');
      // RFC 5280: an extension at most once. Two could say different things.
      if (extensions.has(id)) throw new Error('RFC 3161: an extension twice');
      extensions.set(id, {
        critical: f.length === 3 && boolean(buf, f[1]),
        value: content(buf, expectTag(f[f.length - 1], 0x04, 'extension'))
      });
    }
  }
  return {
    der: buf,
    x509: new crypto.X509Certificate(buf),
    strong: strongCertSignature(buf, algorithm(buf, outer[1])),
    serial: integerHex(buf, expectTag(tbs[v], 0x02, 'serial number')),
    issuer: whole(buf, expectTag(tbs[v + 2], 0x30, 'issuer')),
    subject: whole(buf, expectTag(tbs[v + 4], 0x30, 'subject')),
    notBefore: certTime(buf, validity[0]),
    notAfter: certTime(buf, validity[1]),
    extensions
  };
}

// The parts of the SignedData the checks need. tokenInfo has read the
// TSTInfo already; here it is its bytes, as the message digest covers them.
function readSignedData(buf) {
  const info = children(buf, expectTag(readElement(buf, 0), 0x30, 'token'));
  if (oidHex(buf, info[0], 'content type') !== OID_SIGNED_DATA) throw new Error('RFC 3161: not signed data');
  // version, digestAlgorithms, encapContentInfo, [0] certificates,
  // [1] crls, signerInfos
  const sd = children(buf, expectTag(children(buf, expectTag(info[1], 0xa0, 'signed data'))[0], 0x30, 'signed data'));
  const encap = children(buf, expectTag(sd[2], 0x30, 'encapsulated content'));
  const tst = content(buf, expectTag(children(buf, expectTag(encap[1], 0xa0, 'TSTInfo'))[0], 0x04, 'TSTInfo'));
  const rest = sd.slice(3);
  const signers = children(buf, expectTag(rest[rest.length - 1], 0x31, 'signer infos'));
  const certs = [];
  const set = rest.find((el) => el.tag === 0xa0);
  let tried = 0;
  for (const el of set ? children(buf, set) : []) {
    // Other kinds of certificate ([1] to [3]) are not X.509 ones.
    if (el.tag !== 0x30) continue;
    // Counted before reading: one that does not parse costs as much to try.
    if (++tried > MAX_CERTS) break;
    try {
      certs.push(readCert(Buffer.from(whole(buf, el))));
    } catch {
      // One Node cannot read is as good as none.
    }
  }
  return { tst, certs, signers };
}

// SignerInfo { version, sid, digestAlgorithm, [0] signedAttrs,
//              signatureAlgorithm, signature, [1] unsignedAttrs }
function readSigner(buf, el) {
  const f = children(buf, expectTag(el, 0x30, 'signer info'));
  let i = 3;
  const signedAttrs = f[i] && f[i].tag === 0xa0 ? f[i++] : null;
  return {
    sid: f[1],
    digest: algorithm(buf, f[2]),
    signedAttrs,
    signatureAlgorithm: algorithm(buf, f[i]),
    signature: content(buf, expectTag(f[i + 1], 0x04, 'signature'))
  };
}

// The signed attributes by type, each with its values. null when a type
// comes twice: which one would count?
function readAttributes(buf, el) {
  const attrs = new Map();
  for (const a of children(buf, el)) {
    const f = children(buf, expectTag(a, 0x30, 'attribute'));
    const id = oidHex(buf, f[0], 'attribute');
    if (attrs.has(id)) return null;
    attrs.set(id, children(buf, expectTag(f[1], 0x31, 'attribute')));
  }
  return attrs;
}

// ── Checking ────────────────────────────────────────────────

// How the signature is made: PKCS #1 v1.5, PSS with its parameters, ECDSA,
// or Ed25519, which signs the attributes themselves (RFC 8419). null for
// anything Node cannot check.
function signatureScheme(buf, alg, hash) {
  if (RSA_PKCS1.has(alg.oid)) return { kind: 'rsa', hash };
  if (ECDSA.has(alg.oid)) return { kind: 'ec', hash };
  if (alg.oid === OID_ED25519) return { kind: 'ed25519', hash: null };
  if (alg.oid !== OID_RSA_PSS || !alg.params) return null;
  // RSASSA-PSS-params (RFC 4055), each field with a default: SHA-1, MGF1
  // over SHA-1, 20 bytes of salt, trailer 1. Node's MGF1 uses the signature's
  // own hash, so a different one cannot be checked.
  let hashOid = OID_SHA1;
  let mgfHashOid = OID_SHA1;
  let saltLength = 20;
  let trailer = 1;
  for (const f of children(buf, expectTag(alg.params, 0x30, 'PSS parameters'))) {
    const inner = children(buf, f)[0];
    if (f.tag === 0xa0) hashOid = algorithm(buf, inner).oid;
    else if (f.tag === 0xa1) {
      const mgf = algorithm(buf, inner);
      if (mgf.oid !== OID_MGF1 || !mgf.params) return null;
      mgfHashOid = algorithm(buf, mgf.params).oid;
    } else if (f.tag === 0xa2) saltLength = parseInt(integerHex(buf, expectTag(inner, 0x02, 'salt length')), 16);
    else if (f.tag === 0xa3) trailer = parseInt(integerHex(buf, expectTag(inner, 0x02, 'trailer')), 16);
  }
  if (!DIGESTS[hashOid] || mgfHashOid !== hashOid || trailer !== 1) return null;
  return { kind: 'pss', hash: DIGESTS[hashOid], saltLength };
}

// Whether a key may be used at all; see MAX_RSA_BITS.
function usableKey(key) {
  const d = key.asymmetricKeyDetails || {};
  if (key.asymmetricKeyType === 'dsa') return d.modulusLength <= MAX_DSA_BITS;
  if (key.asymmetricKeyType !== 'rsa' && key.asymmetricKeyType !== 'rsa-pss') return true;
  return d.modulusLength <= MAX_RSA_BITS && d.publicExponent <= MAX_RSA_EXPONENT;
}
// One signature check out of the token's budget (MAX_VERIFIES), if the key
// may be used and some is left.
function spend(budget, key) {
  if (!usableKey(key) || budget.left <= 0) return false;
  budget.left--;
  return true;
}

function signatureHolds(scheme, data, cert, signature, budget) {
  const key = cert.x509.publicKey;
  const type = key.asymmetricKeyType;
  if (!spend(budget, key)) return false;
  try {
    if (scheme.kind === 'rsa') return type === 'rsa' && crypto.verify(scheme.hash, data, key, signature);
    if (scheme.kind === 'ec') return type === 'ec' && crypto.verify(scheme.hash, data, key, signature);
    if (scheme.kind === 'ed25519') return type === 'ed25519' && crypto.verify(null, data, key, signature);
    return (
      (type === 'rsa' || type === 'rsa-pss') &&
      crypto.verify(
        scheme.hash,
        data,
        { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: scheme.saltLength },
        signature
      )
    );
  } catch {
    // A signature that is not even the right shape for the key.
    return false;
  }
}

// Two Names in DER as the same name: byte for byte, or else as RFC 5280
// compares them, attribute by attribute, with case and runs of spaces in the
// text not counting, as openssl's X509_NAME_cmp does. A name only finds a
// certificate; that it is the right one, its key and its hash decide.
function sameName(a, b) {
  if (a.equals(b)) return true;
  try {
    return nameKey(a) === nameKey(b);
  } catch {
    return false;
  }
}
function nameKey(buf) {
  const rdns = children(buf, expectTag(readElement(buf, 0), 0x30, 'name'));
  return JSON.stringify(
    rdns.map((rdn) =>
      children(buf, expectTag(rdn, 0x31, 'name'))
        .map((ava) => {
          const [type, value] = children(buf, expectTag(ava, 0x30, 'name'));
          return oidHex(buf, type, 'name') + '=' + nameText(buf, value);
        })
        .sort()
    )
  );
}
// The text of a name's value, whatever string type holds it; anything else
// as its DER.
function nameText(buf, el) {
  const raw = content(buf, el);
  let text;
  if (el.tag === 0x0c) text = raw.toString('utf8');
  else if ([0x12, 0x13, 0x14, 0x16, 0x1a].includes(el.tag)) text = raw.toString('latin1');
  else if (el.tag === 0x1e) text = Buffer.from(raw).swap16().toString('utf16le');
  else return '#' + whole(buf, el).toString('hex');
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Whether the signer's identifier names this certificate: by issuer and
// serial number, or by subject key identifier ([0], version 3).
function names(buf, sid, cert) {
  if (sid.tag === 0x30) {
    const [issuer, serial] = children(buf, sid);
    return (
      !!issuer &&
      !!serial &&
      serial.tag === 0x02 &&
      integerHex(buf, serial) === cert.serial &&
      sameName(Buffer.from(whole(buf, issuer)), cert.issuer)
    );
  }
  if (sid.tag !== 0x80) return false;
  const ski = cert.extensions.get(OID_SUBJECT_KEY_ID);
  if (!ski) return false;
  const id = readElement(ski.value, 0);
  return id.tag === 0x04 && content(ski.value, id).equals(content(buf, sid));
}

// RFC 5035, which RFC 3161 makes mandatory: the signed attributes name the
// certificate that signed, by its hash and, if they say so, by issuer and
// serial number. The first certificate named is the signer's.
function namesSigner(buf, attrs, signer) {
  const v1 = attrs.get(OID_SIGNING_CERT);
  const v2 = attrs.get(OID_SIGNING_CERT_V2);
  if (!v1 && !v2) return false;
  for (const [values, version2] of [
    [v1, false],
    [v2, true]
  ]) {
    if (!values) continue;
    if (values.length !== 1) return false;
    // SigningCertificate(V2) { certs SEQUENCE OF ESSCertID(v2), policies }
    const ids = children(
      buf,
      expectTag(children(buf, expectTag(values[0], 0x30, 'signing certificate'))[0], 0x30, 'ids')
    );
    if (!ids.length) return false;
    // ESSCertID { certHash, issuerSerial } (SHA-1), ESSCertIDv2
    // { hashAlgorithm DEFAULT sha256, certHash, issuerSerial }. Only a name
    // for the certificate, so any hash will do, SHA-1 included.
    const id = children(buf, expectTag(ids[0], 0x30, 'certificate id'));
    let i = 0;
    let hash = version2 ? 'sha256' : 'sha1';
    if (version2 && id[0] && id[0].tag === 0x30) hash = DIGESTS[algorithm(buf, id[i++]).oid];
    if (!hash) return false;
    const certHash = content(buf, expectTag(id[i], 0x04, 'certificate hash'));
    if (!crypto.createHash(hash).update(signer.der).digest().equals(certHash)) return false;
    if (id[i + 1] && !issuerSerialNames(buf, id[i + 1], signer)) return false;
  }
  return true;
}
// IssuerSerial { issuer GeneralNames, serialNumber }: one directoryName ([4],
// the issuer's Name inside) and the serial, as openssl compares them.
function issuerSerialNames(buf, el, cert) {
  const [general, serial] = children(buf, expectTag(el, 0x30, 'issuer serial'));
  const all = children(buf, expectTag(general, 0x30, 'issuer serial'));
  if (all.length !== 1 || all[0].tag !== 0xa4 || !serial || serial.tag !== 0x02) return false;
  const name = children(buf, all[0])[0];
  return !!name && integerHex(buf, serial) === cert.serial && sameName(Buffer.from(whole(buf, name)), cert.issuer);
}

// The purposes an extended key usage extension lists, as OID hex.
function purposesOf(eku) {
  return children(eku.value, expectTag(readElement(eku.value, 0), 0x30, 'extended key usage')).map((p) =>
    oidHex(eku.value, p, 'extended key usage')
  );
}

// RFC 3161 §2.3: extended key usage id-kp-timeStamping, critical, and no
// other purpose, read as openssl ts -verify reads it: one it knows makes the
// certificate one for something else too, one it does not know is let
// through. A key usage, if there is one, allows digitalSignature and
// nonRepudiation and nothing else.
function forTimeStamping(cert) {
  const eku = cert.extensions.get(OID_EKU);
  if (!eku || !eku.critical) return false;
  const purposes = purposesOf(eku);
  if (!purposes.includes(OID_TIME_STAMPING) || purposes.some((p) => OTHER_PURPOSES.has(p))) return false;
  const ku = cert.extensions.get(OID_KEY_USAGE);
  if (!ku) return true;
  // BIT STRING: unused bits, then digitalSignature (0x80), nonRepudiation
  // (0x40), keyEncipherment (0x20) and the rest.
  const bits = content(ku.value, expectTag(readElement(ku.value, 0), 0x03, 'key usage')).subarray(1);
  return bits.length > 0 && (bits[0] & 0xc0) !== 0 && (bits[0] & 0x3f) === 0 && bits.subarray(1).every((b) => b === 0);
}

// basicConstraints { cA DEFAULT FALSE, pathLenConstraint }
function constraints(cert) {
  const bc = cert.extensions.get(OID_BASIC_CONSTRAINTS);
  const out = { ca: false, pathLen: null };
  if (!bc) return out;
  for (const el of children(bc.value, expectTag(readElement(bc.value, 0), 0x30, 'basic constraints'))) {
    if (el.tag === 0x01) out.ca = boolean(bc.value, el);
    else if (el.tag === 0x02) out.pathLen = parseInt(integerHex(bc.value, el), 16);
  }
  return out;
}

function validAt(cert, t) {
  return cert.notBefore <= t && t <= cert.notAfter;
}

// The certificates among `pool` that say they issued `cert`: Node's
// checkIssued compares the names, the key identifiers and the issuer's key
// usage. `signed` is whether the issuer's key verifies the signature; not
// checked, and so false, once the budget is spent or for a key out of reason.
function issuersOf(cert, pool, budget) {
  const out = [];
  for (const c of pool) {
    if (c === cert) continue;
    try {
      if (!cert.x509.checkIssued(c.x509)) continue;
      const key = c.x509.publicKey;
      out.push({ cert: c, signed: spend(budget, key) && cert.x509.verify(key) });
    } catch {
      // Not one Node can compare: no issuer of this one.
    }
  }
  return out;
}

// What a chain from the signer (first) to a root (last) lacks at t. What
// makes the token bad: 'chain', a signature in it that does not hold, or an
// issuer below the root that is no CA or has more CAs under it than its path
// length allows; 'validity', a certificate below the root not valid then.
// What only keeps the app from vouching for it: 'purpose', a CA in it
// limited to purposes other than time stamping, which says nothing about
// tampering; 'weak', a certificate below the root signed with an algorithm
// not on the strong list. null when the chain holds.
function chainFault({ path, signed }, t) {
  if (!signed) return 'chain';
  // The root is trusted as Node ships it, its dates included: a root
  // shipped again with a later start would otherwise void older stamps.
  if (!path.slice(0, -1).every((c) => validAt(c, t))) return 'validity';
  let otherPurpose = false;
  for (let i = 1; i < path.length - 1; i++) {
    const { ca, pathLen } = constraints(path[i]);
    // The CAs between this one and the signer; a self-issued one (a CA's new
    // key under its old name) does not count, as RFC 5280 says for basic
    // constraints.
    const under = path.slice(1, i).filter((c) => !sameName(c.issuer, c.subject)).length;
    if (!ca || (pathLen !== null && under > pathLen)) return 'chain';
    const eku = path[i].extensions.get(OID_EKU);
    if (eku && !purposesOf(eku).some((p) => p === OID_TIME_STAMPING || p === OID_ANY_PURPOSE)) otherPurpose = true;
  }
  if (otherPurpose) return 'purpose';
  if (path.slice(0, -1).some((c) => !c.strong)) return 'weak';
  return null;
}

// The common name of a certificate's subject, to show who signed.
function commonName(cert) {
  const line = cert.x509.subject.split('\n').find((l) => l.startsWith('CN='));
  return line ? line.slice(3) : cert.x509.subject.replace(/\n/g, ', ');
}

function answer(signature, reason, signer, root) {
  return Object.freeze({ signature, reason: reason || null, signer: signer || null, root: root || null });
}

function check(buf, roots) {
  const t = Date.parse(tokenInfo(buf).genTime);
  const sd = readSignedData(buf);
  if (sd.signers.length !== 1) return answer('bad', 'signers');
  const si = readSigner(buf, sd.signers[0]);
  if (!si.signedAttrs) return answer('bad', 'attributes');
  const attrs = readAttributes(buf, si.signedAttrs);
  const type = attrs && attrs.get(OID_CONTENT_TYPE);
  const digest = attrs && attrs.get(OID_MESSAGE_DIGEST);
  if (!type || type.length !== 1 || oidHex(buf, type[0], 'content type') !== OID_TST_INFO) {
    return answer('bad', 'attributes');
  }
  if (!digest || digest.length !== 1 || digest[0].tag !== 0x04) return answer('bad', 'attributes');
  // The digest first, with whatever hash the token names: a TSTInfo changed
  // afterwards shows here, before anything could excuse it.
  const hash = DIGESTS[si.digest.oid];
  if (!hash) return answer('bad', 'algorithm');
  if (!crypto.createHash(hash).update(sd.tst).digest().equals(content(buf, digest[0]))) return answer('bad', 'digest');
  const scheme = signatureScheme(buf, si.signatureAlgorithm, hash);
  if (!scheme) return answer('bad', 'algorithm');
  // Asked for with certReq, as this app always asks, the TSA puts its
  // certificate into the token (RFC 3161, 2.4.1). Without it the signature
  // cannot be checked.
  const named = sd.certs.filter((c) => names(buf, si.sid, c));
  if (!named.length) return answer('bad', 'certificate');
  // What is signed is the DER of the attributes as a SET OF, not as the [0]
  // they are stored under (RFC 5652, 5.4).
  const attributes = Buffer.from(whole(buf, si.signedAttrs));
  attributes[0] = 0x31;
  const budget = { left: MAX_VERIFIES };
  const signer = named.find((c) => signatureHolds(scheme, attributes, c, si.signature, budget));
  if (!signer) return answer('bad', 'signature');
  if (!namesSigner(buf, attrs, signer)) return answer('bad', 'signing-certificate');
  if (!forTimeStamping(signer)) return answer('bad', 'usage');
  if (!validAt(signer, t)) return answer('bad', 'validity');

  // Every chain up to a root, by the names the certificates give; then
  // whether one of them holds: every signature in it, every certificate
  // valid at genTime. A chain that names its way to a root but does not hold
  // is bad: a certificate in it claims an issuer that did not sign it. One
  // that names no root is unchecked. A root in the token counts as the root.
  const pool = sd.certs.filter((c) => !roots.some((r) => r.der.equals(c.der)));
  const known = new Map();
  const issuers = (cert) => {
    if (!known.has(cert)) {
      known.set(cert, { roots: issuersOf(cert, roots, budget), pool: issuersOf(cert, pool, budget) });
    }
    return known.get(cert);
  };
  const chains = [];
  let steps = 0;
  const walk = (cert, path, signed) => {
    if (++steps > MAX_STEPS) return;
    const { roots: up, pool: next } = issuers(cert);
    for (const r of up) chains.push({ path: [...path, r.cert], signed: signed && r.signed });
    if (path.length >= MAX_CHAIN) return;
    for (const c of next) if (!path.includes(c.cert)) walk(c.cert, [...path, c.cert], signed && c.signed);
  };
  walk(signer, [signer], true);
  if (!chains.length) return answer('unchecked', 'root');
  // Last, what holds but is not vouched for: MD5 or SHA-1 in the token's
  // own signature, or in the only chains that hold a weak certificate
  // signature or a CA for other purposes.
  const weak = WEAK.has(hash) || WEAK.has(scheme.hash);
  let fault = null;
  const lacks = new Set();
  for (const chain of chains) {
    const f = chainFault(chain, t);
    if (!f && weak) return answer('unchecked', 'algorithm');
    if (!f) return answer('ok', null, commonName(signer), commonName(chain.path[chain.path.length - 1]));
    if (f === 'weak' || f === 'purpose') lacks.add(f);
    else fault = fault || f;
  }
  if (lacks.has('weak')) return answer('unchecked', 'algorithm');
  if (lacks.has('purpose')) return answer('unchecked', 'purpose');
  return answer('bad', fault);
}

// ── The roots ───────────────────────────────────────────────

function readRoot(r) {
  try {
    return readCert(Buffer.from(new crypto.X509Certificate(r).raw));
  } catch {
    return null;
  }
}
let shipped = null;
function rootsFrom(list) {
  if (list) return list.map(readRoot).filter(Boolean);
  if (!shipped) shipped = tls.rootCertificates.map(readRoot).filter(Boolean);
  return shipped;
}

// ── Use ─────────────────────────────────────────────────────

// What a token's signature is worth: { signature: 'ok' | 'bad' | 'unchecked',
// reason, signer, root }, see the top of this file. opts.roots replaces
// Node's roots (PEM or DER), for tests.
function verifyToken(token, opts = {}) {
  try {
    return check(Buffer.from(token), rootsFrom(opts.roots));
  } catch {
    // Not readable as a token, a signer or a certificate.
    return answer('bad', 'format');
  }
}

// verifyToken against Node's roots, once per token. The answer depends on the
// token's bytes and those roots alone, and the chain status asks for every
// stamp each time. Kept by the token's SHA-256, so a token changed in the
// file is checked again.
const remembered = new Map();
const REMEMBER_MAX = 10000;
function tokenSignature(token) {
  const buf = Buffer.from(token);
  const key = crypto.createHash('sha256').update(buf).digest('hex');
  let r = remembered.get(key);
  if (!r) {
    r = verifyToken(buf);
    if (remembered.size >= REMEMBER_MAX) remembered.clear();
    remembered.set(key, r);
  }
  return r;
}

module.exports = { verifyToken, tokenSignature };
