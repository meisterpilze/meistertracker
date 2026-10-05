'use strict';
// Ein wenig DER, um Antworten und Token einer Zeitstempelstelle (RFC 3161) zu
// bauen, ohne Signatur. scripts/rfc3161.js prueft die Signatur nicht; das tut
// openssl mit dem echten Token. Fuer die Tests zaehlt der TSTInfo darin: Hash,
// Zeit, Seriennummer, Nonce.
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

module.exports = { tlv, hex, oid, SHA256, SIGNED_DATA, TST_INFO, NONCE, tstInfo, token, antwort, tokenFuer };
