'use strict';
// Ein wenig DER, um Antworten und Token einer Zeitstempelstelle (RFC 3161) zu
// bauen. Ohne Signatur fuer scripts/rfc3161.js, das nur den TSTInfo darin liest:
// Hash, Zeit, Seriennummer, Nonce. Mit Signatur und Zertifikaten, ganz in Node
// gebaut, fuer scripts/rfc3161-verify.js: eine eigene Wurzel, eine Stelle
// darunter, und alles, was eine echte Stelle nie ausstellen wuerde.
const crypto = require('crypto');

function laenge(n) {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) b.unshift(x % 256);
  return Buffer.from([0x80 | b.length, ...b]);
}
const tlv = (tag, ...teile) => {
  const c = Buffer.concat(teile);
  return Buffer.concat([Buffer.from([tag]), laenge(c.length), c]);
};
const hex = (h) => Buffer.from(h, 'hex');
const oid = (h) => tlv(0x06, hex(h));
const SHA256 = '608648016503040201';
const SIGNED_DATA = '2a864886f70d010702';
const TST_INFO = '2a864886f70d0109100104';
const NONCE = hex('1122334455667788');

function tstInfo({
  hash,
  nonce = NONCE,
  zeit = '20261003093728Z',
  algorithmus = SHA256,
  ohneNonce = false,
  accuracy = false,
  serial = '0a0b0c'
}) {
  return tlv(
    0x30,
    tlv(0x02, hex('01')),
    oid('2a03'),
    tlv(0x30, tlv(0x30, oid(algorithmus), hex('0500')), tlv(0x04, Buffer.isBuffer(hash) ? hash : hex(hash))),
    tlv(0x02, hex(serial)),
    tlv(0x18, Buffer.from(zeit, 'latin1')),
    accuracy ? tlv(0x30, tlv(0x02, hex('01'))) : Buffer.alloc(0),
    ohneNonce ? Buffer.alloc(0) : tlv(0x02, nonce)
  );
}
function token(tst, { inhalt = TST_INFO, art = SIGNED_DATA } = {}) {
  const signedData = tlv(
    0x30,
    tlv(0x02, hex('03')),
    tlv(0x31, tlv(0x30, oid(SHA256))),
    tlv(0x30, oid(inhalt), tlv(0xa0, tlv(0x04, tst))),
    tlv(0x31)
  );
  return tlv(0x30, oid(art), tlv(0xa0, signedData));
}
function antwort(status, tok, text) {
  const info = text
    ? tlv(0x30, tlv(0x02, Buffer.from([status])), tlv(0x30, tlv(0x0c, Buffer.from(text, 'utf8'))))
    : tlv(0x30, tlv(0x02, Buffer.from([status])));
  return tok ? tlv(0x30, info, tok) : tlv(0x30, info);
}
// Ein Token ueber einen Hash in Hex, wie es eine Stelle fuer ein Glied gaebe.
function tokenFuer(hashHex, zeit) {
  return token(tstInfo({ hash: hex(hashHex), zeit }));
}

// ── Mit Signatur ────────────────────────────────────────────

const HASH_OID = {
  sha1: '2b0e03021a',
  sha256: SHA256,
  sha384: '608648016503040202',
  sha512: '608648016503040203',
  'sha3-256': '608648016503040208'
};
const ECDSA_OID = {
  sha1: '2a8648ce3d0401',
  sha256: '2a8648ce3d040302',
  sha384: '2a8648ce3d040303',
  sha512: '2a8648ce3d040304',
  'sha3-256': '60864801650304030a'
};
const RSA_OID = { sha1: '2a864886f70d010105', sha256: '2a864886f70d01010b' };
// Zwecke einer erweiterten Schluesselverwendung; privat ist einer unter einer
// ausgedachten Firmennummer, den openssl nicht kennt.
const ZWECK = {
  zeitstempel: '2b06010505070308',
  server: '2b06010505070301',
  client: '2b06010505070302',
  beliebig: '551d2500',
  privat: '2b06010401868d1f01'
};
const NUTZUNG = { signatur: '03020780', verschluesseln: '03020520', ca: '03020106' };
const leer = Buffer.alloc(0);

const schluessel = (art = 'ec') =>
  art === 'rsa'
    ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    : art === 'ed25519'
      ? crypto.generateKeyPairSync('ed25519')
      : crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const hashAlg = (hash) => tlv(0x30, oid(HASH_OID[hash]), hex('0500'));
// RSASSA-PSS mit seinen Parametern: Hash, MGF1 ueber denselben, Salzlaenge.
const pssAlg = (hash, salz) =>
  tlv(
    0x30,
    oid('2a864886f70d01010a'),
    tlv(
      0x30,
      tlv(0xa0, hashAlg(hash)),
      tlv(0xa1, tlv(0x30, oid('2a864886f70d010108'), hashAlg(hash))),
      tlv(0xa2, tlv(0x02, Buffer.from([salz])))
    )
  );
const pssMit = (key, salz) => ({ key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: salz });
const name = (cn) => tlv(0x30, tlv(0x31, tlv(0x30, oid('550403'), tlv(0x0c, Buffer.from(cn, 'utf8')))));
// UTCTime bis 2049, danach GeneralizedTime, wie RFC 5280 es will.
function zeitpunkt(iso) {
  const z = iso.replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return Number(z.slice(0, 4)) < 2050
    ? tlv(0x17, Buffer.from(z.slice(2), 'latin1'))
    : tlv(0x18, Buffer.from(z, 'latin1'));
}
const erweiterung = (id, kritisch, wert) => tlv(0x30, oid(id), kritisch ? hex('0101ff') : leer, tlv(0x04, wert));
// Eine Zwischen- oder Wurzelstelle; pfad ist die erlaubte Zahl von CAs
// darunter, zwecke die, auf die sie beschraenkt ist.
const alsCa = (pfad, zwecke) => [
  erweiterung('551d13', true, tlv(0x30, hex('0101ff'), pfad == null ? leer : tlv(0x02, Buffer.from([pfad])))),
  erweiterung('551d0f', true, hex(NUTZUNG.ca)),
  ...(zwecke ? [erweiterung('551d25', false, tlv(0x30, ...zwecke.map(oid)))] : [])
];
// Ein Zertifikat zum Zeitstempeln, wie RFC 3161 es will, oder eben nicht.
const alsStelle = ({ zwecke = [ZWECK.zeitstempel], kritisch = true, nutzung = NUTZUNG.signatur } = {}) => [
  erweiterung('551d25', kritisch, tlv(0x30, ...zwecke.map(oid))),
  ...(nutzung ? [erweiterung('551d0f', true, hex(nutzung))] : [])
];

// Ein X.509-Zertifikat. aussteller ist ein anderes von hier; ohne ihn ist es
// selbst signiert. kennung setzt einen Subject Key Identifier, hash das
// Verfahren, mit dem der Aussteller unterschreibt (pss: als RSA-PSS mit
// dieser Salzlaenge, algKennung: unter dieser Kennung in Hex), oeffentlich
// (SPKI in DER) einen Schluessel, zu dem es keinen privaten gibt.
function zertifikat({
  cn,
  aussteller = null,
  von = '2020-01-01T00:00:00Z',
  bis = '2040-01-01T00:00:00Z',
  erweiterungen = [],
  seriennummer = '01',
  art = 'ec',
  kennung = null,
  hash = 'sha256',
  pss = null,
  algKennung = null,
  oeffentlich = null
}) {
  const k = schluessel(art);
  const subjekt = name(cn);
  const signierer = aussteller || { name: subjekt, privateKey: k.privateKey };
  const ec = signierer.privateKey.asymmetricKeyType === 'ec';
  const alg = algKennung
    ? tlv(0x30, oid(algKennung), hex('0500'))
    : pss
      ? pssAlg(hash, pss)
      : ec
        ? tlv(0x30, oid(ECDSA_OID[hash]))
        : tlv(0x30, oid(RSA_OID[hash]), hex('0500'));
  const alle = kennung ? [...erweiterungen, erweiterung('551d0e', false, tlv(0x04, kennung))] : erweiterungen;
  const tbs = tlv(
    0x30,
    tlv(0xa0, tlv(0x02, hex('02'))),
    tlv(0x02, hex(seriennummer)),
    alg,
    signierer.name,
    tlv(0x30, zeitpunkt(von), zeitpunkt(bis)),
    subjekt,
    oeffentlich || k.publicKey.export({ type: 'spki', format: 'der' }),
    alle.length ? tlv(0xa3, tlv(0x30, ...alle)) : leer
  );
  const unterschrift = crypto.sign(hash, tbs, pss ? pssMit(signierer.privateKey, pss) : signierer.privateKey);
  const der = tlv(0x30, tbs, alg, tlv(0x03, hex('00'), unterschrift));
  return {
    der,
    pem: new crypto.X509Certificate(der).toString(),
    name: subjekt,
    ausstellerName: signierer.name,
    seriennummer,
    kennung,
    ...k
  };
}

const attribut = (id, ...werte) => tlv(0x30, oid(id), tlv(0x31, ...werte));
// signingCertificate (v1, SHA-1) und signingCertificateV2 (SHA-256): der Hash
// des Zertifikats und, mit mitAussteller, Aussteller und Seriennummer dazu.
function essAttribut(fassung, z, mitAussteller) {
  const hash = crypto
    .createHash(fassung === 'v1' ? 'sha1' : 'sha256')
    .update(z.der)
    .digest();
  const ausstellerSerie = mitAussteller
    ? tlv(
        0x30,
        tlv(0x30, tlv(0xa4, mitAussteller.name || z.ausstellerName)),
        tlv(0x02, hex(mitAussteller.seriennummer || z.seriennummer))
      )
    : leer;
  const id = tlv(0x30, tlv(0x04, hash), ausstellerSerie);
  return attribut(fassung === 'v1' ? '2a864886f70d010910020c' : '2a864886f70d010910022f', tlv(0x30, tlv(0x30, id)));
}

// Ein Token mit echter Signatur von stelle (ein zertifikat() mit Schluessel).
//   zertifikate  was ins Token kommt; ohne Angabe nur die Stelle
//   hash         des TSTInfo und der Signatur
//   verfahren    'pkcs1', 'pss', 'ecdsa' oder 'ed25519'; ohne Angabe nach
//                dem Schluessel
//   ess          'v1', 'v2', 'beide' oder 'keins'; essFuer nennt ein anderes
//                Zertifikat, mitAussteller nennt Aussteller und Seriennummer
//                (mitAussteller.name, .seriennummer: andere als die echten)
//   ausstellerAls  der Aussteller (Name in DER), unter dem der Unterzeichner
//                die Stelle nennt, statt ihres echten
//   inhalt       der Inhaltstyp in den signierten Attributen
//   attribute    (liste) => liste, um die signierten Attribute zu aendern
//   unterschreibt ein anderer privater Schluessel als der der Stelle
//   algorithmus  eine andere Kennung des Signaturverfahrens (Hex)
//   digestKennung  eine andere Kennung des Hashverfahrens beim Unterzeichner
//   ski          die Stelle ueber ihren Subject Key Identifier nennen
//   ohneAttribute, zweimal  ohne signierte Attribute; zwei Unterzeichner
function signiertesToken({
  tst,
  stelle,
  zertifikate = [stelle],
  hash = 'sha256',
  verfahren = { ec: 'ecdsa', ed25519: 'ed25519' }[stelle.privateKey.asymmetricKeyType] || 'pkcs1',
  ess = 'v2',
  essFuer = stelle,
  mitAussteller = null,
  ausstellerAls = null,
  inhalt = TST_INFO,
  attribute = (liste) => liste,
  unterschreibt = stelle.privateKey,
  algorithmus = null,
  digestKennung = null,
  ski = false,
  ohneAttribute = false,
  zweimal = false
}) {
  const liste = attribute([
    attribut('2a864886f70d010903', oid(inhalt)),
    attribut('2a864886f70d010904', tlv(0x04, crypto.createHash(hash).update(tst).digest())),
    ...(ess === 'v1' || ess === 'beide' ? [essAttribut('v1', essFuer, mitAussteller)] : []),
    ...(ess === 'v2' || ess === 'beide' ? [essAttribut('v2', essFuer, mitAussteller)] : [])
  ]);
  const signiert = ohneAttribute ? tst : tlv(0x31, ...liste);
  // Ed25519 unterschreibt die Attribute selbst, ohne Hash davor (RFC 8419).
  const signatur =
    verfahren === 'ed25519'
      ? crypto.sign(null, signiert, unterschreibt)
      : crypto.sign(hash, signiert, verfahren === 'pss' ? pssMit(unterschreibt, 32) : unterschreibt);
  const alg = algorithmus
    ? tlv(0x30, oid(algorithmus))
    : verfahren === 'ed25519'
      ? tlv(0x30, oid('2b6570'))
      : verfahren === 'ecdsa'
        ? tlv(0x30, oid(ECDSA_OID[hash]))
        : verfahren === 'pss'
          ? pssAlg(hash, 32)
          : tlv(0x30, oid('2a864886f70d010101'), hex('0500'));
  const kennung = ski
    ? tlv(0x80, stelle.kennung)
    : tlv(0x30, ausstellerAls || stelle.ausstellerName, tlv(0x02, hex(stelle.seriennummer)));
  const signerInfo = tlv(
    0x30,
    tlv(0x02, hex(ski ? '03' : '01')),
    kennung,
    digestKennung ? tlv(0x30, oid(digestKennung), hex('0500')) : hashAlg(hash),
    ohneAttribute ? leer : tlv(0xa0, ...liste),
    alg,
    tlv(0x04, signatur)
  );
  const signedData = tlv(
    0x30,
    tlv(0x02, hex('03')),
    tlv(0x31, hashAlg(hash)),
    tlv(0x30, oid(TST_INFO), tlv(0xa0, tlv(0x04, tst))),
    zertifikate.length ? tlv(0xa0, ...zertifikate.map((z) => (Buffer.isBuffer(z) ? z : z.der))) : leer,
    tlv(0x31, signerInfo, zweimal ? signerInfo : leer)
  );
  return tlv(0x30, oid(SIGNED_DATA), tlv(0xa0, signedData));
}

module.exports = {
  tlv,
  hex,
  oid,
  SHA256,
  SIGNED_DATA,
  TST_INFO,
  NONCE,
  tstInfo,
  token,
  antwort,
  tokenFuer,
  ZWECK,
  NUTZUNG,
  attribut,
  alsCa,
  alsStelle,
  zertifikat,
  signiertesToken
};
