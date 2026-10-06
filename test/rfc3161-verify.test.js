'use strict';
// scripts/rfc3161-verify.js: die Signatur der Stelle unter einem Token.
//
// Worauf es ankommt: echte Token dreier Stellen pruefen sich bis zu einer
// Wurzel, die Node mitbringt (ok); was an ihnen geaendert wurde, faellt auf
// (bad); ein selbst gemachtes Token wird nie ok, sondern bleibt unchecked,
// solange seine Wurzel nicht unter Nodes ist; und mit einer eigenen Wurzel
// zeigt sich jede Regel einzeln: nur ein Zertifikat zum Zeitstempeln, genannt
// in den signierten Attributen, gueltig am Tag des Stempels und nicht heute,
// ueber eine Kette aus CAs.
//
// Die echten Token sind von DigiCert (rfc3161-token.der), Sectigo und SSL.com,
// jedes ueber einen zufaelligen Hash und mit den Zertifikaten der Stelle, sonst
// nichts. Alle anderen Inhalte hier sind ausgedacht.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { verifyToken, tokenSignature } = require('../scripts/rfc3161-verify.js');
const { tokenInfo, der } = require('../scripts/rfc3161.js');
const {
  tlv,
  hex,
  oid,
  SIGNED_DATA,
  tstInfo,
  token,
  ZWECK,
  NUTZUNG,
  attribut,
  alsCa,
  alsStelle,
  zertifikat,
  signiertesToken
} = require('./helpers/tsa');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name));
const ECHT = [
  {
    datei: 'rfc3161-token.der',
    hash: '6491253b709b930450ebaea22b4ca9fd36111db9e53bbb60024fd511d773d505',
    genTime: '2026-10-03T09:37:28.000Z',
    signer: 'DigiCert SHA256 RSA4096 Timestamp Responder 2026 1',
    root: 'DigiCert Trusted Root G4'
  },
  {
    // SHA-384, und die Kette geht ueber ein Querzertifikat.
    datei: 'rfc3161-sectigo.der',
    hash: '447d66420f481f430e405890040ef141a5ccd0887e4b0ca8c0ddf210ef755ace',
    genTime: '2026-10-06T06:27:01.000Z',
    signer: 'Sectigo Public Time Stamping Signer R37',
    root: 'USERTrust RSA Certification Authority'
  },
  {
    // ECDSA ueber P-256.
    datei: 'rfc3161-sslcom.der',
    hash: '2b1fff353d38fef1aedea8183547af1e2859ec0d912e453a2a9c7606b6525329',
    genTime: '2026-10-06T06:27:31.000Z',
    signer: 'SSL.com Timestamping Unit 2025 E1',
    root: 'SSL.com Root Certification Authority RSA'
  }
];
const ok = (signer, root) => ({ signature: 'ok', reason: null, signer, root });
const bad = (reason) => ({ signature: 'bad', reason, signer: null, root: null });
const unchecked = (reason) => ({ signature: 'unchecked', reason, signer: null, root: null });

// Ein Byte anders, an der Stelle, an der `suche` zuerst steht, plus `um`.
function geaendert(buf, suche, um = 0) {
  const i = buf.indexOf(suche);
  assert.ok(i >= 0, 'the place to change is in the token');
  const b = Buffer.from(buf);
  b[i + um] ^= 0x01;
  return b;
}
// Die Teile eines Tokens: die SignedData-Felder, die Zertifikate, der TSTInfo.
function teile(tok) {
  const { readElement, children, content } = der;
  const info = children(tok, readElement(tok, 0));
  const felder = children(tok, children(tok, info[1])[0]);
  const menge = felder.find((el) => el.tag === 0xa0);
  const encap = children(tok, felder[2]);
  return {
    felder: felder.map((el) => ({ tag: el.tag, bytes: tok.subarray(el.at, el.end) })),
    zertifikate: children(tok, menge).map((el) => Buffer.from(tok.subarray(el.at, el.end))),
    tst: Buffer.from(content(tok, children(tok, encap[1])[0]))
  };
}
const schluesselRsa = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
// Ein RSA-Schluessel (SPKI in DER) mit 3072 Bit Modulus und einem Exponenten
// fast ebenso lang: jede Pruefung damit dauert Millisekunden. Einen privaten
// Schluessel dazu gibt es nicht; der Modulus ist bloss eine ungerade Zahl.
function langsamerSchluessel() {
  const zahl = (b) => (b[0] & 0x80 ? Buffer.concat([hex('00'), b]) : b);
  const n = crypto.randomBytes(384);
  n[0] |= 0xc0;
  n[383] |= 1;
  const e = crypto.randomBytes(384);
  e[0] = 0x3f;
  e[383] |= 1;
  const rsa = tlv(0x30, tlv(0x02, zahl(n)), tlv(0x02, zahl(e)));
  return tlv(0x30, tlv(0x30, oid('2a864886f70d010101'), hex('0500')), tlv(0x03, hex('00'), rsa));
}
// Ein DSA-Schluessel (SPKI in DER) mit 10000 Bit p, so gross, wie openssl
// ihn nimmt; ebenso ohne privaten Schluessel.
function langsamerDsa() {
  const zahl = (b) => (b[0] & 0x80 ? Buffer.concat([hex('00'), b]) : b);
  const p = crypto.randomBytes(1250);
  p[0] |= 0x80;
  p[1249] |= 1;
  const q = Buffer.from(crypto.generatePrimeSync(256));
  const g = crypto.randomBytes(1000);
  g[0] &= 0x3f;
  const y = crypto.randomBytes(1000);
  y[0] &= 0x3f;
  const parameter = tlv(0x30, tlv(0x02, zahl(p)), tlv(0x02, zahl(q)), tlv(0x02, zahl(g)));
  return tlv(0x30, tlv(0x30, oid('2a8648ce380401'), parameter), tlv(0x03, hex('00'), tlv(0x02, zahl(y))));
}
// Aussteller und Subjekt (als Name in DER) und Seriennummer eines Zertifikats.
function namenUndSerie(zert) {
  const { readElement, children, integerHex } = der;
  const tbs = children(zert, children(zert, readElement(zert, 0))[0]);
  return {
    ausstellerName: zert.subarray(tbs[3].at, tbs[3].end),
    name: zert.subarray(tbs[5].at, tbs[5].end),
    seriennummer: integerHex(zert, tbs[1])
  };
}

describe('Signatur: echte Token', () => {
  it('prueft die Token dreier Stellen bis zu einer Wurzel, die Node mitbringt', () => {
    const wurzeln = tls.rootCertificates.map((p) => new crypto.X509Certificate(p).subject);
    for (const e of ECHT) {
      const tok = fixture(e.datei);
      assert.deepEqual(tokenInfo(tok).hash, e.hash);
      assert.equal(tokenInfo(tok).genTime, e.genTime);
      assert.ok(
        wurzeln.some((s) => s.split('\n').includes('CN=' + e.root)),
        e.datei + ': Node ships ' + e.root + '. If an update dropped it, these stamps now show as unchecked.'
      );
      assert.deepEqual(verifyToken(tok), ok(e.signer, e.root), e.datei);
    }
  });

  it('nimmt das Token auch so, wie SQLite es liefert', () => {
    const tok = fixture('rfc3161-token.der');
    assert.equal(verifyToken(new Uint8Array(tok)).signature, 'ok');
  });

  it('nennt es unchecked, wenn keine Wurzel passt, nicht bad', () => {
    for (const e of ECHT) assert.deepEqual(verifyToken(fixture(e.datei), { roots: [] }), unchecked('root'));
    // Eine echte Wurzel, nur die einer anderen Stelle.
    const andere = tls.rootCertificates.find((p) => new crypto.X509Certificate(p).subject.includes('CN=ISRG Root X1'));
    assert.ok(andere);
    assert.deepEqual(verifyToken(fixture('rfc3161-token.der'), { roots: [andere] }), unchecked('root'));
  });

  it('merkt, was an einem echten Token geaendert wurde', () => {
    const tok = fixture('rfc3161-token.der');
    // Im TSTInfo: die Seriennummer, und damit der Hash, den die Signatur deckt.
    assert.deepEqual(verifyToken(geaendert(tok, hex('3ec9c7abf5d5259dc282b38c2c523b13'), 3)), bad('digest'));
    // In den signierten Attributen: die Zeit der Signatur (UTCTime, nicht die
    // genTime im TSTInfo, die dieselben Ziffern hat).
    assert.deepEqual(
      verifyToken(geaendert(tok, Buffer.concat([hex('170d'), Buffer.from('261003093728Z')]), 12)),
      bad('signature')
    );
    // Die Signatur selbst; sie steht am Ende des Tokens.
    const ende = Buffer.from(tok);
    ende[ende.length - 1] ^= 0x01;
    assert.deepEqual(verifyToken(ende), bad('signature'));
    // Das Zertifikat der Stelle, ausserhalb ihres Schluessels: die Signatur
    // passt noch zum Schluessel, aber nicht mehr zu dem Zertifikat, das die
    // signierten Attribute nennen.
    assert.deepEqual(
      verifyToken(geaendert(tok, Buffer.from('TimeStampingRSA4096SHA2562025CA1.crl'), 0)),
      bad('signing-certificate')
    );
    assert.deepEqual(verifyToken(Buffer.from([1, 2, 3])), bad('format'));
  });

  it('laesst sich nicht von bad auf unchecked herunterschreiben, auch nicht mit einem anderen Hashverfahren', () => {
    // Der TSTInfo geaendert, und dazu das Hashverfahren des Unterzeichners:
    // auf SHA3-256, das Node kennt, und auf eines, das es nicht kennt. Beides
    // laesst sich nicht pruefen, also kein unchecked. Das Verfahren steht als
    // letztes SHA-256 im Token, hinter Zertifikaten und TSTInfo.
    const tok = geaendert(fixture('rfc3161-token.der'), hex('3ec9c7abf5d5259dc282b38c2c523b13'), 3);
    const beimUnterzeichner = tok.lastIndexOf(hex('0609608648016503040201')) + 10;
    for (const [letztes, grund] of [
      [0x08, 'digest'],
      [0x7f, 'algorithm']
    ]) {
      const b = Buffer.from(tok);
      b[beimUnterzeichner] = letztes;
      assert.deepEqual(verifyToken(b), bad(grund));
    }
  });

  it('nennt ein Token ohne die Zertifikate der Stelle bad: an ihm laesst sich nichts pruefen', () => {
    const tok = fixture('rfc3161-sectigo.der');
    const { felder } = teile(tok);
    const ohne = tlv(
      0x30,
      oid(SIGNED_DATA),
      tlv(0xa0, tlv(0x30, ...felder.filter((f) => f.tag !== 0xa0).map((f) => f.bytes)))
    );
    assert.deepEqual(verifyToken(ohne), bad('certificate'));
  });

  it('nennt es bad, wenn jemand anderes unterschrieb, auch mit den Zertifikaten der Stelle', () => {
    // Der TSTInfo und die Zertifikate von DigiCert, die Signatur von einem
    // eigenen Schluessel, der das Zertifikat von DigiCert als seins ausgibt.
    const echt = teile(fixture('rfc3161-token.der'));
    const { ausstellerName, seriennummer } = namenUndSerie(echt.zertifikate[0]);
    const stelle = {
      der: echt.zertifikate[0],
      ausstellerName,
      seriennummer,
      privateKey: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    };
    const falsch = signiertesToken({ tst: echt.tst, stelle, zertifikate: echt.zertifikate, verfahren: 'pkcs1' });
    assert.equal(tokenInfo(falsch).hash, ECHT[0].hash, 'the same TSTInfo');
    assert.deepEqual(verifyToken(falsch), bad('signature'));
  });

  it('nennt es bad, wenn ein eigenes Zertifikat sich die CA einer Stelle als Aussteller gibt', () => {
    // Ein Zertifikat zum Zeitstempeln, das sagt, die Zwischenstelle von
    // DigiCert habe es ausgestellt, und daneben ihre echten Zertifikate. Die
    // Namen fuehren bis zu einer Wurzel, die Node mitbringt; die Signatur auf
    // dem Zertifikat ist aber nicht ihre.
    const echt = teile(fixture('rfc3161-token.der'));
    const ca = namenUndSerie(echt.zertifikate[1]);
    const schluessel = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const falsch = zertifikat({
      cn: 'Falsche Stempelstelle',
      aussteller: { name: ca.name, privateKey: schluessel },
      erweiterungen: alsStelle()
    });
    const tok = signiertesToken({
      tst: tstInfo({ hash: hex('ef'.repeat(32)) }),
      stelle: falsch,
      zertifikate: [falsch, ...echt.zertifikate.slice(1)]
    });
    assert.deepEqual(verifyToken(tok), bad('chain'));
  });

  it('pruft jedes Token einmal und merkt sich die Antwort', () => {
    const tok = fixture('rfc3161-sslcom.der');
    const a = tokenSignature(tok);
    assert.equal(tokenSignature(Buffer.from(tok)), a, 'the same answer, not checked again');
    assert.ok(Object.isFrozen(a));
    assert.equal(tokenSignature(geaendert(tok, hex(ECHT[2].hash), 0)).signature, 'bad', 'a changed token is new');
  });
});

describe('Signatur: selbst gebaute Token', () => {
  const TST = tstInfo({ hash: hex('ab'.repeat(32)) });
  let wurzel;
  let zwischen;
  let stelle;
  let stelleRsa;
  let mit;
  before(() => {
    wurzel = zertifikat({ cn: 'Pruefwurzel', erweiterungen: alsCa() });
    zwischen = zertifikat({ cn: 'Pruefzwischenstelle', aussteller: wurzel, erweiterungen: alsCa(0) });
    stelle = zertifikat({
      cn: 'Pruefstempelstelle',
      aussteller: zwischen,
      erweiterungen: alsStelle(),
      seriennummer: '0a1b'
    });
    stelleRsa = zertifikat({
      cn: 'Pruefstempelstelle RSA',
      aussteller: zwischen,
      erweiterungen: alsStelle(),
      art: 'rsa'
    });
    mit = { roots: [wurzel.pem] };
  });
  const kette = (s) => [s, zwischen];
  const pruefe = (o, roots = mit) =>
    verifyToken(signiertesToken({ tst: TST, zertifikate: kette(o.stelle || stelle), stelle, ...o }), roots);

  it('wird nie ok, solange seine Wurzel nicht unter Nodes ist, und ok mit ihr', () => {
    const tok = signiertesToken({ tst: TST, stelle, zertifikate: kette(stelle) });
    assert.deepEqual(verifyToken(tok), unchecked('root'), 'a token anyone could make');
    assert.deepEqual(verifyToken(tok, mit), ok('Pruefstempelstelle', 'Pruefwurzel'));
    // Liegt die Wurzel im Token, aendert das nichts: Wurzel ist, was als
    // Wurzel gilt.
    const mitWurzel = signiertesToken({ tst: TST, stelle, zertifikate: [stelle, zwischen, wurzel] });
    assert.deepEqual(verifyToken(mitWurzel), unchecked('root'));
    assert.deepEqual(verifyToken(mitWurzel, mit), ok('Pruefstempelstelle', 'Pruefwurzel'));
  });

  it('prueft PKCS #1 v1.5, RSA-PSS und ECDSA, ueber SHA-256 bis SHA-512', () => {
    for (const hash of ['sha256', 'sha384', 'sha512']) {
      assert.equal(pruefe({ stelle: stelleRsa, hash, verfahren: 'pkcs1' }).signature, 'ok', 'PKCS #1 ' + hash);
      assert.equal(pruefe({ stelle: stelleRsa, hash, verfahren: 'pss' }).signature, 'ok', 'PSS ' + hash);
      assert.equal(pruefe({ hash }).signature, 'ok', 'ECDSA ' + hash);
    }
    // Ein Verfahren, das nicht zum Schluessel passt, in beide Richtungen.
    assert.deepEqual(pruefe({ stelle: stelleRsa, algorithmus: '2a8648ce3d040302' }), bad('signature'));
    assert.deepEqual(pruefe({ algorithmus: '2a864886f70d010101' }), bad('signature'));
  });

  it('prueft auch Ed25519, das die Attribute selbst unterschreibt', () => {
    const ed = zertifikat({
      cn: 'Pruefstempelstelle Ed25519',
      aussteller: zwischen,
      erweiterungen: alsStelle(),
      art: 'ed25519'
    });
    assert.deepEqual(pruefe({ stelle: ed, hash: 'sha512' }), ok('Pruefstempelstelle Ed25519', 'Pruefwurzel'));
    const fremd = crypto.generateKeyPairSync('ed25519').privateKey;
    assert.deepEqual(pruefe({ stelle: ed, hash: 'sha512', unterschreibt: fremd }), bad('signature'));
    // Ein Ed25519-Schluessel unter einem anderen Verfahren haelt nicht, und
    // eine ECDSA-Signatur unter dem Namen Ed25519 auch nicht.
    assert.deepEqual(pruefe({ stelle: ed, hash: 'sha512', algorithmus: '2a8648ce3d040304' }), bad('signature'));
    assert.deepEqual(pruefe({ algorithmus: '2b6570' }), bad('signature'));
  });

  it('nennt die Stelle auch ueber ihren Subject Key Identifier', () => {
    const mitKennung = zertifikat({
      cn: 'Pruefstempelstelle K',
      aussteller: zwischen,
      erweiterungen: alsStelle(),
      kennung: crypto.randomBytes(20)
    });
    assert.equal(pruefe({ stelle: mitKennung, ski: true }).signature, 'ok');
  });

  it('nennt ein Token ohne Unterschrift bad, und eines mit zweien', () => {
    assert.deepEqual(verifyToken(token(TST), mit), bad('signers'));
    assert.deepEqual(pruefe({ zweimal: true }), bad('signers'));
    assert.deepEqual(pruefe({ ohneAttribute: true }), bad('attributes'));
  });

  it('nennt einen falschen Unterzeichner bad', () => {
    const fremd = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    assert.deepEqual(pruefe({ unterschreibt: fremd }), bad('signature'));
  });

  it('merkt einen geaenderten TSTInfo', () => {
    const tok = signiertesToken({ tst: TST, stelle, zertifikate: kette(stelle) });
    assert.deepEqual(verifyToken(geaendert(tok, hex('ab'.repeat(32)), 5), mit), bad('digest'));
  });

  it('laesst nur ein Zertifikat zum Zeitstempeln unterschreiben', () => {
    const mitZweck = (o, cn) => zertifikat({ cn, aussteller: zwischen, erweiterungen: o });
    const faelle = [
      [mitZweck(alsStelle({ zwecke: [ZWECK.server] }), 'Webserver'), 'a web server certificate'],
      [mitZweck(alsStelle({ kritisch: false }), 'Nicht kritisch'), 'not critical'],
      [mitZweck(alsStelle({ zwecke: [ZWECK.zeitstempel, ZWECK.server] }), 'Zwei Zwecke'), 'not alone'],
      [mitZweck(alsStelle({ zwecke: [ZWECK.zeitstempel, ZWECK.beliebig] }), 'Jeder Zweck'), 'any purpose too'],
      [mitZweck(alsStelle({ zwecke: [ZWECK.privat] }), 'Nur privat'), 'no time stamping at all'],
      [mitZweck(alsStelle({ nutzung: NUTZUNG.verschluesseln }), 'Verschluesseln'), 'key usage'],
      [mitZweck([], 'Ohne Erweiterungen'), 'no extended key usage']
    ];
    for (const [s, was] of faelle) assert.deepEqual(pruefe({ stelle: s }), bad('usage'), was);
    assert.equal(pruefe({ stelle: mitZweck(alsStelle({ nutzung: null }), 'Ohne Nutzung') }).signature, 'ok');
    // Ein Zweck, den openssl nicht kennt, neben dem Zeitstempeln: wie openssl
    // durchgelassen.
    const privat = mitZweck(alsStelle({ zwecke: [ZWECK.zeitstempel, ZWECK.privat] }), 'Privater Zweck');
    assert.equal(pruefe({ stelle: privat }).signature, 'ok');
  });

  it('laesst keine CA fuer eine Stelle buergen, die auf andere Zwecke beschraenkt ist', () => {
    // Eine CA unter einer echten Wurzel, die nur Webzertifikate ausstellen
    // darf und deren Schluessel jemand anderes hat, koennte sonst eine Stelle
    // machen. openssl prueft das nicht. Geaendert ist daran nichts: unchecked,
    // wie unter einer Wurzel, die Node nicht mitbringt.
    const nurWeb = zertifikat({
      cn: 'Nur-Web-CA',
      aussteller: wurzel,
      erweiterungen: alsCa(0, [ZWECK.server, ZWECK.client])
    });
    const unterWeb = zertifikat({ cn: 'Unter Nur-Web', aussteller: nurWeb, erweiterungen: alsStelle() });
    assert.deepEqual(pruefe({ stelle: unterWeb, zertifikate: [unterWeb, nurWeb] }), unchecked('purpose'));
    // Ein harter Fehler in derselben Kette zaehlt vor dem Zweck, auch weiter
    // oben: ueber der Web-CA eine, die keine CA ist.
    const keineCa = zertifikat({ cn: 'Keine CA ueber Web', aussteller: wurzel, erweiterungen: [] });
    const webUnten = zertifikat({
      cn: 'Web-CA unten',
      aussteller: keineCa,
      erweiterungen: alsCa(null, [ZWECK.server])
    });
    const tief = zertifikat({ cn: 'Unter Web unten', aussteller: webUnten, erweiterungen: alsStelle() });
    assert.deepEqual(pruefe({ stelle: tief, zertifikate: [tief, webUnten, keineCa] }), bad('chain'));
    for (const zwecke of [[ZWECK.zeitstempel], [ZWECK.beliebig], [ZWECK.server, ZWECK.zeitstempel]]) {
      const ca = zertifikat({ cn: 'CA ' + zwecke.join(' '), aussteller: wurzel, erweiterungen: alsCa(0, zwecke) });
      const s = zertifikat({ cn: 'Unter CA ' + zwecke.join(' '), aussteller: ca, erweiterungen: alsStelle() });
      assert.equal(pruefe({ stelle: s, zertifikate: [s, ca] }).signature, 'ok', zwecke.join(', '));
    }
  });

  it('prueft die Kette am Tag des Stempels, nicht heute', () => {
    const alt = zertifikat({
      cn: 'Abgelaufene Stelle',
      aussteller: zwischen,
      erweiterungen: alsStelle(),
      von: '2020-01-01T00:00:00Z',
      bis: '2021-01-01T00:00:00Z'
    });
    const damals = tstInfo({ hash: hex('cd'.repeat(32)), zeit: '20200601120000Z' });
    assert.deepEqual(
      verifyToken(signiertesToken({ tst: damals, stelle: alt, zertifikate: kette(alt) }), mit),
      ok('Abgelaufene Stelle', 'Pruefwurzel'),
      'expired today, valid then'
    );
    assert.deepEqual(pruefe({ stelle: alt }), bad('validity'), 'stamped after it expired');
    // Das gilt auch ohne passende Wurzel: ein Token, das eine Zeit nennt, zu
    // der sein eigenes Zertifikat nicht galt, passt nicht zu sich selbst.
    assert.deepEqual(pruefe({ stelle: alt }, {}), bad('validity'));
    // Eine Zwischenstelle, die am Tag des Stempels abgelaufen war.
    const alteZwischen = zertifikat({
      cn: 'Alte Zwischenstelle',
      aussteller: wurzel,
      erweiterungen: alsCa(0),
      bis: '2025-01-01T00:00:00Z'
    });
    const unter = zertifikat({
      cn: 'Unter alter Zwischenstelle',
      aussteller: alteZwischen,
      erweiterungen: alsStelle()
    });
    assert.deepEqual(pruefe({ stelle: unter, zertifikate: [unter, alteZwischen] }), bad('validity'));
  });

  it('nimmt die Wurzel, wie sie ist, auch mit Daten, die den Stempel nicht decken', () => {
    // Bringt Node eine Wurzel neu mit, mit einem spaeteren Beginn, bleiben
    // aeltere Stempel unter ihr, was sie waren.
    const neueWurzel = zertifikat({
      cn: 'Neu ausgestellte Wurzel',
      erweiterungen: alsCa(),
      von: '2027-01-01T00:00:00Z'
    });
    const unter = zertifikat({ cn: 'Unter neuer Wurzel', aussteller: neueWurzel, erweiterungen: alsStelle() });
    assert.deepEqual(
      verifyToken(signiertesToken({ tst: TST, stelle: unter }), { roots: [neueWurzel.pem] }),
      ok('Unter neuer Wurzel', 'Neu ausgestellte Wurzel')
    );
  });

  it('nennt eine Kette bad, deren Namen zur Wurzel fuehren, deren Signatur aber nicht', () => {
    const fremd = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    const untergeschoben = zertifikat({
      cn: 'Untergeschobene Stelle',
      aussteller: { name: zwischen.name, privateKey: fremd },
      erweiterungen: alsStelle()
    });
    assert.deepEqual(pruefe({ stelle: untergeschoben }), bad('chain'));
    // Ohne passende Wurzel bleibt es unchecked: dann fuehren schon die Namen
    // nirgends hin.
    assert.deepEqual(pruefe({ stelle: untergeschoben }, {}), unchecked('root'));
  });

  it('gibt bei einem Token, das den Server beschaeftigen soll, bald auf', () => {
    // Dreissig CAs mit demselben Namen: jede koennte jede ausgestellt haben,
    // und ohne Grenze gaebe es Milliarden Wege durch sie.
    let davor = zertifikat({ cn: 'Schleife', erweiterungen: alsCa() });
    const alle = [davor];
    for (let i = 0; i < 29; i++) {
      davor = zertifikat({ cn: 'Schleife', aussteller: davor, erweiterungen: alsCa() });
      alle.push(davor);
    }
    const s = zertifikat({ cn: 'Schleife', aussteller: davor, erweiterungen: alsStelle() });
    // Und eine CA dreihundertmal: jede Kopie waere zu pruefen.
    const ca = zertifikat({ cn: 'Vielfach', erweiterungen: alsCa() });
    const s2 = zertifikat({ cn: 'Vielfache Stelle', aussteller: ca, erweiterungen: alsStelle() });
    // Und zwanzig CAs mit RSA-Schluesseln, deren Exponent fast so lang ist
    // wie ihr Modulus: jede Pruefung mit einem davon dauert Millisekunden.
    const vorlage = zertifikat({ cn: 'Schwer', erweiterungen: alsCa() });
    const irgendwer = { name: vorlage.name, privateKey: schluesselRsa().privateKey };
    const schwere = Array.from({ length: 20 }, (_, i) =>
      zertifikat({
        cn: 'Schwer',
        aussteller: irgendwer,
        erweiterungen: alsCa(),
        seriennummer: (0x10 + i).toString(16),
        oeffentlich: langsamerSchluessel()
      })
    );
    const s3 = zertifikat({ cn: 'Schwere Stelle', aussteller: irgendwer, erweiterungen: alsStelle() });
    // Dasselbe mit DSA-Schluesseln von 10000 Bit.
    const dsaVorlage = zertifikat({ cn: 'Schwer DSA', erweiterungen: alsCa() });
    const dsaName = { name: dsaVorlage.name, privateKey: dsaVorlage.privateKey };
    const dsa = { aussteller: dsaName, algKennung: '608648016503040302' };
    const schwereDsa = Array.from({ length: 5 }, (_, i) =>
      zertifikat({
        cn: 'Schwer DSA',
        ...dsa,
        erweiterungen: alsCa(),
        seriennummer: (0x20 + i).toString(16),
        oeffentlich: langsamerDsa()
      })
    );
    const s4 = zertifikat({ cn: 'Stelle unter DSA', ...dsa, erweiterungen: alsStelle() });
    // Gezaehlt wird jede Signaturpruefung, die die Pruefung anstoesst.
    const zaehler = { alle: 0, langsam: 0 };
    const x509Verify = crypto.X509Certificate.prototype.verify;
    const verify = crypto.verify;
    crypto.X509Certificate.prototype.verify = function (key) {
      zaehler.alle++;
      const d = key.asymmetricKeyDetails;
      if (key.asymmetricKeyType === 'rsa' && d.publicExponent > 0x10001n) zaehler.langsam++;
      if (key.asymmetricKeyType === 'dsa' && d.modulusLength > 3072) zaehler.langsam++;
      return x509Verify.call(this, key);
    };
    crypto.verify = (...args) => {
      zaehler.alle++;
      return verify(...args);
    };
    try {
      for (const tok of [
        signiertesToken({ tst: TST, stelle: s, zertifikate: [s, ...alle] }),
        signiertesToken({ tst: TST, stelle: s2, zertifikate: [s2, ...Array(300).fill(ca)] }),
        signiertesToken({ tst: TST, stelle: s3, zertifikate: [s3, ...schwere] }),
        signiertesToken({ tst: TST, stelle: s4, zertifikate: [s4, ...schwereDsa] })
      ]) {
        zaehler.alle = 0;
        const start = Date.now();
        assert.deepEqual(verifyToken(tok), unchecked('root'));
        assert.ok(Date.now() - start < 2000, 'answered in ' + (Date.now() - start) + ' ms');
        assert.ok(zaehler.alle <= 32, zaehler.alle + ' signatures checked for one token');
      }
      assert.equal(zaehler.langsam, 0, 'a key made to be slow is never used');
    } finally {
      crypto.X509Certificate.prototype.verify = x509Verify;
      crypto.verify = verify;
    }
  });

  it('liest hoechstens zwanzig Zertifikate, auch wenn sich keins davon lesen laesst', () => {
    // Ein Eintrag, der kein Zertifikat ist, kostet beim Versuch so viel wie
    // eins; er zaehlt also mit.
    const kaputt = tlv(0x30, tlv(0x02, hex('00')));
    const mitMuell = (n) =>
      signiertesToken({ tst: TST, stelle, zertifikate: [...Array(n).fill(kaputt), stelle, zwischen] });
    assert.deepEqual(verifyToken(mitMuell(18), mit), ok('Pruefstempelstelle', 'Pruefwurzel'));
    // Hinter zwanzig Eintraegen wird das Zertifikat der Stelle nicht mehr
    // gelesen, auch hinter zwanzigtausend nicht, und das geht schnell.
    assert.deepEqual(verifyToken(mitMuell(20), mit), bad('certificate'));
    const start = Date.now();
    assert.deepEqual(verifyToken(mitMuell(20000), mit), bad('certificate'));
    assert.ok(Date.now() - start < 2000, 'answered in ' + (Date.now() - start) + ' ms');
  });

  it('verlangt CAs in der Kette, mit ihrer Pfadlaenge', () => {
    const keineCa = zertifikat({ cn: 'Keine CA', aussteller: wurzel, erweiterungen: [] });
    const darunter = zertifikat({ cn: 'Unter keiner CA', aussteller: keineCa, erweiterungen: alsStelle() });
    assert.deepEqual(
      verifyToken(signiertesToken({ tst: TST, stelle: darunter, zertifikate: [darunter, keineCa] }), mit),
      bad('chain')
    );
    // zwischen erlaubt keine CA unter sich.
    const tiefer = zertifikat({ cn: 'Tiefere CA', aussteller: zwischen, erweiterungen: alsCa() });
    const ganzUnten = zertifikat({ cn: 'Ganz unten', aussteller: tiefer, erweiterungen: alsStelle() });
    assert.deepEqual(
      verifyToken(signiertesToken({ tst: TST, stelle: ganzUnten, zertifikate: [ganzUnten, tiefer, zwischen] }), mit),
      bad('chain')
    );
    // Ein neuer Schluessel derselben Zwischenstelle unter ihrem alten Namen
    // (selbst ausgestellt) zaehlt dabei nicht mit.
    const neuerSchluessel = zertifikat({ cn: 'Pruefzwischenstelle', aussteller: zwischen, erweiterungen: alsCa() });
    const unterNeu = zertifikat({
      cn: 'Unter neuem Schluessel',
      aussteller: neuerSchluessel,
      erweiterungen: alsStelle()
    });
    assert.deepEqual(
      pruefe({ stelle: unterNeu, zertifikate: [unterNeu, neuerSchluessel, zwischen] }),
      ok('Unter neuem Schluessel', 'Pruefwurzel')
    );
  });

  it('erkennt das Zertifikat der Stelle auch unter einem anders geschriebenen Aussteller', () => {
    // Derselbe Name als PrintableString, gross und mit mehr Leerzeichen:
    // nach RFC 5280 derselbe.
    const anders = tlv(0x30, tlv(0x31, tlv(0x30, oid('550403'), tlv(0x13, Buffer.from('  PRUEFZWISCHENSTELLE ')))));
    assert.equal(pruefe({ ausstellerAls: anders }).signature, 'ok', 'in the signer identifier');
    assert.equal(pruefe({ mitAussteller: { name: anders } }).signature, 'ok', 'in the signed attributes');
    const fremd = tlv(0x30, tlv(0x31, tlv(0x30, oid('550403'), tlv(0x0c, Buffer.from('Andere Stelle')))));
    assert.deepEqual(pruefe({ ausstellerAls: fremd }), bad('certificate'));
    assert.deepEqual(pruefe({ mitAussteller: { name: fremd } }), bad('signing-certificate'));
  });

  it('verlangt, dass die signierten Attribute das Zertifikat der Stelle nennen', () => {
    assert.deepEqual(pruefe({ ess: 'keins' }), bad('signing-certificate'));
    assert.deepEqual(pruefe({ essFuer: zwischen }), bad('signing-certificate'), 'another certificate');
    assert.deepEqual(pruefe({ mitAussteller: { seriennummer: '0a1c' } }), bad('signing-certificate'), 'another serial');
    for (const ess of ['v1', 'v2', 'beide']) {
      assert.equal(pruefe({ ess }).signature, 'ok', ess);
      assert.equal(pruefe({ ess, mitAussteller: true }).signature, 'ok', ess + ' with issuer and serial');
    }
  });

  it('verlangt Inhaltstyp und Pruefsumme, je einmal', () => {
    assert.deepEqual(pruefe({ inhalt: '2a864886f70d010701' }), bad('attributes'), 'id-data');
    assert.deepEqual(pruefe({ attribute: (l) => [l[0], ...l.slice(2)] }), bad('attributes'), 'no digest');
    assert.deepEqual(pruefe({ attribute: (l) => [l[0], ...l] }), bad('attributes'), 'content type twice');
    const andereSumme = attribut('2a864886f70d010904', tlv(0x04, Buffer.alloc(32)));
    assert.deepEqual(pruefe({ attribute: (l) => [l[0], andereSumme, ...l.slice(2)] }), bad('digest'));
  });

  it('nennt unchecked, was mit SHA-1 haelt, aber erst nachdem alles geprueft ist', () => {
    // Echt mit SHA-1 unterschrieben: es haelt, nur buergt niemand dafuer.
    assert.deepEqual(pruefe({ hash: 'sha1' }), unchecked('algorithm'));
    assert.deepEqual(pruefe({ stelle: stelleRsa, hash: 'sha1', verfahren: 'pkcs1' }), unchecked('algorithm'));
    assert.deepEqual(pruefe({ hash: 'sha1' }, {}), unchecked('root'), 'without its root it is unchecked anyway');
    // Geaendert oder falsch unterschrieben ist es trotz SHA-1 bad: die
    // Pruefsumme und die Signatur werden auch dann nachgerechnet.
    const tok = signiertesToken({ tst: TST, stelle, zertifikate: kette(stelle), hash: 'sha1' });
    assert.deepEqual(verifyToken(geaendert(tok, hex('ab'.repeat(32)), 5), mit), bad('digest'));
    const fremd = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    assert.deepEqual(pruefe({ hash: 'sha1', unterschreibt: fremd }), bad('signature'));
    // SHA3-256 ist kein schwaches Verfahren.
    assert.deepEqual(pruefe({ hash: 'sha3-256' }), ok('Pruefstempelstelle', 'Pruefwurzel'));
  });

  it('nennt unchecked, was nur mit einem SHA-1-Zertifikat in der Kette haelt', () => {
    const alteZwischen = zertifikat({
      cn: 'SHA-1-Zwischenstelle',
      aussteller: wurzel,
      erweiterungen: alsCa(0),
      hash: 'sha1'
    });
    const darunter = zertifikat({ cn: 'Unter SHA-1', aussteller: alteZwischen, erweiterungen: alsStelle() });
    assert.deepEqual(pruefe({ stelle: darunter, zertifikate: [darunter, alteZwischen] }), unchecked('algorithm'));
    const selbst = zertifikat({ cn: 'Selbst SHA-1', aussteller: zwischen, erweiterungen: alsStelle(), hash: 'sha1' });
    assert.deepEqual(pruefe({ stelle: selbst }), unchecked('algorithm'));
    // SHA-1 auch unter anderen Namen: RSA-PSS mit SHA-1 und die alte
    // OIW-Kennung fuer SHA-1 mit RSA. RSA-PSS mit SHA-256 dagegen gilt.
    const rsaZwischen = zertifikat({
      cn: 'RSA-Zwischenstelle',
      aussteller: wurzel,
      erweiterungen: alsCa(0),
      art: 'rsa'
    });
    const unterRsa = (cn, o) => zertifikat({ cn, aussteller: rsaZwischen, erweiterungen: alsStelle(), ...o });
    const faelle = [
      ['PSS mit SHA-1', { hash: 'sha1', pss: 20 }, unchecked('algorithm')],
      ['OIW SHA-1', { hash: 'sha1', algKennung: '2b0e03021d' }, unchecked('algorithm')],
      ['PSS mit SHA-256', { pss: 32 }, ok('PSS mit SHA-256', 'Pruefwurzel')]
    ];
    for (const [cn, o, erwartet] of faelle) {
      const s = unterRsa(cn, o);
      assert.deepEqual(pruefe({ stelle: s, zertifikate: [s, rsaZwischen] }), erwartet, cn);
    }
  });

  it('nennt bad, was sich gar nicht pruefen laesst: ein unbekanntes Hash- oder Signaturverfahren', () => {
    assert.deepEqual(pruefe({ digestKennung: '60864801650304027f' }), bad('algorithm'));
    // DSA mit SHA-256, das Node hier nicht prueft.
    assert.deepEqual(pruefe({ algorithmus: '608648016503040302' }), bad('algorithm'));
  });
});
