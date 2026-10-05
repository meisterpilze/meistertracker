'use strict';
// RFC 3161: a timestamp from an outside authority over a hash.
//
// The request carries only a SHA-256 value and a random nonce. What was
// hashed never leaves the machine. The answer is a signed token (CMS
// SignedData around a TSTInfo) saying: this hash existed at this time. The
// token is kept exactly as it came, so it can be checked later without this
// application, for example with
//
//   openssl ts -verify -digest <hash> -in <token>.tsr -token_in -CAfile <ca.pem>
//
// This file holds only as much DER as the request and the answer need: build
// what is sent, and read whether the token belongs to our hash and our nonce,
// with its time and serial number. It does not check the signature; that is
// what openssl and the TSA's certificates are for.
const crypto = require('crypto');
const http = require('http');
const https = require('https');

// 2.16.840.1.101.3.4.2.1, sha256
const OID_SHA256 = '608648016503040201';
// 1.2.840.113549.1.7.2, signedData
const OID_SIGNED_DATA = '2a864886f70d010702';
// 1.2.840.113549.1.9.16.1.4, id-ct-TSTInfo
const OID_TST_INFO = '2a864886f70d0109100104';

const MAX_ANSWER_BYTES = 64 * 1024;

// ── Writing ─────────────────────────────────────────────────

function derLength(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function tlv(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

// A positive INTEGER in its shortest form: eight random bytes, the first one
// between 0x01 and 0x7f, so it neither starts with a zero byte nor reads as
// negative.
function randomNonce() {
  const b = crypto.randomBytes(8);
  b[0] = (b[0] & 0x7f) | 0x01;
  return b;
}

// TimeStampReq { version 1, messageImprint { sha256, hash }, nonce,
// certReq TRUE }. certReq asks the TSA to put its certificate into the token,
// so the token can be checked on its own later.
function buildRequest(hash, nonce) {
  if (!Buffer.isBuffer(hash) || hash.length !== 32) throw new Error('RFC 3161: the hash must be 32 bytes');
  const algorithm = tlv(0x30, Buffer.concat([tlv(0x06, Buffer.from(OID_SHA256, 'hex')), Buffer.from([0x05, 0x00])]));
  const imprint = tlv(0x30, Buffer.concat([algorithm, tlv(0x04, hash)]));
  return tlv(
    0x30,
    Buffer.concat([tlv(0x02, Buffer.from([0x01])), imprint, tlv(0x02, nonce), Buffer.from([0x01, 0x01, 0xff])])
  );
}

// ── Reading ─────────────────────────────────────────────────

// One element: its tag, where its content starts and ends, and where it began.
// Only definite lengths and one-byte tags, which is all DER uses here.
function readElement(buf, at, limit) {
  const end = limit == null ? buf.length : limit;
  if (at + 2 > end) throw new Error('RFC 3161: answer cut short');
  const tag = buf[at];
  if ((tag & 0x1f) === 0x1f) throw new Error('RFC 3161: unexpected tag');
  let len = buf[at + 1];
  let head = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('RFC 3161: unsupported length');
    if (at + 2 + n > end) throw new Error('RFC 3161: answer cut short');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[at + 2 + i];
    head += n;
  }
  const start = at + head;
  if (start + len > end) throw new Error('RFC 3161: answer cut short');
  return { tag, at, start, end: start + len };
}
function children(buf, el) {
  const out = [];
  let at = el.start;
  while (at < el.end) {
    const child = readElement(buf, at, el.end);
    out.push(child);
    at = child.end;
  }
  return out;
}
function expectTag(el, tag, what) {
  if (!el || el.tag !== tag) throw new Error('RFC 3161: ' + what + ' missing or malformed');
  return el;
}
function content(buf, el) {
  return buf.subarray(el.start, el.end);
}
// An INTEGER's value as hex without leading zero bytes, so 00 81 and 81 compare
// equal.
function integerHex(buf, el) {
  let bytes = content(buf, el);
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  return bytes.toString('hex');
}
// GeneralizedTime, always UTC in a TSTInfo: YYYYMMDDHHMMSS[.fff]Z.
function generalizedTime(text) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(text);
  if (!m) throw new Error('RFC 3161: unreadable time');
  const fraction = m[7] ? (m[7] + '000').slice(0, 4) : '.000';
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${fraction}Z`;
  if (Number.isNaN(Date.parse(iso))) throw new Error('RFC 3161: unreadable time');
  return iso;
}

// What a token says: the SHA-256 it is about, when, its serial number and the
// nonce it answers, read from the TSTInfo inside it. Throws when it is not a
// timestamp token over a SHA-256 hash. `el` is where the token sits in `der`;
// without it, `der` is the token itself.
function readToken(der, el) {
  const token = el || readElement(der, 0);
  if (!el && token.end !== der.length) throw new Error('RFC 3161: bytes after the token');
  // ContentInfo { signedData, [0] SignedData }
  const contentInfo = children(der, expectTag(token, 0x30, 'token'));
  expectTag(contentInfo[0], 0x06, 'content type');
  if (content(der, contentInfo[0]).toString('hex') !== OID_SIGNED_DATA) {
    throw new Error('RFC 3161: the token is not signed data');
  }
  const signedData = expectTag(children(der, expectTag(contentInfo[1], 0xa0, 'signed data'))[0], 0x30, 'signed data');
  // SignedData { version, digestAlgorithms, encapContentInfo, ... }
  const encap = children(der, expectTag(children(der, signedData)[2], 0x30, 'encapsulated content'));
  expectTag(encap[0], 0x06, 'content type');
  if (content(der, encap[0]).toString('hex') !== OID_TST_INFO) throw new Error('RFC 3161: no TSTInfo in the token');
  const octets = expectTag(children(der, expectTag(encap[1], 0xa0, 'TSTInfo'))[0], 0x04, 'TSTInfo');
  const tst = content(der, octets);
  // TSTInfo { version, policy, messageImprint, serialNumber, genTime,
  //           accuracy?, ordering?, nonce?, [0] tsa?, [1] extensions? }
  const fields = children(tst, expectTag(readElement(tst, 0), 0x30, 'TSTInfo'));
  const imprint = children(tst, expectTag(fields[2], 0x30, 'message imprint'));
  const algorithm = children(tst, expectTag(imprint[0], 0x30, 'hash algorithm'));
  if (content(tst, expectTag(algorithm[0], 0x06, 'hash algorithm')).toString('hex') !== OID_SHA256) {
    throw new Error('RFC 3161: the token is not over a SHA-256 hash');
  }
  const hash = Buffer.from(content(tst, expectTag(imprint[1], 0x04, 'hashed message')));
  const serial = integerHex(tst, expectTag(fields[3], 0x02, 'serial number'));
  const genTime = generalizedTime(content(tst, expectTag(fields[4], 0x18, 'time')).toString('latin1'));
  // The nonce is the first INTEGER after the time; accuracy (SEQUENCE) and
  // ordering (BOOLEAN) may come before it.
  const rest = fields.slice(5).filter((x) => x.tag !== 0x30 && x.tag !== 0x01);
  const nonce = rest[0] && rest[0].tag === 0x02 ? integerHex(tst, rest[0]) : null;
  return { hash, genTime, serial, nonce, token };
}

// A stored token, read again: which hash (hex), when, which serial. For the
// chain check, which trusts the token, not a column next to it.
function tokenInfo(token) {
  const t = readToken(Buffer.from(token));
  return { hash: t.hash.toString('hex'), genTime: t.genTime, serial: t.serial };
}

// The TSA's answer to buildRequest(hash, nonce). Returns the token as it came,
// with its time and serial number, or throws with the reason: refused, cut
// short, or a token that is about some other hash or another request.
function readResponse(der, hash, nonce) {
  const top = expectTag(readElement(der, 0), 0x30, 'answer');
  if (top.end !== der.length) throw new Error('RFC 3161: bytes after the answer');
  const [statusInfo, tokenEl] = children(der, top);
  const statusFields = children(der, expectTag(statusInfo, 0x30, 'status'));
  const status = parseInt(integerHex(der, expectTag(statusFields[0], 0x02, 'status')), 16);
  // 0 granted, 1 granted with modifications; everything else is a refusal.
  if (status !== 0 && status !== 1) {
    const text = statusFields[1] && statusFields[1].tag === 0x30 ? children(der, statusFields[1]) : [];
    const words = text
      .filter((el) => el.tag === 0x0c)
      .map((el) => content(der, el).toString('utf8'))
      .join(' ');
    throw new Error('RFC 3161: refused with status ' + status + (words ? ' (' + words + ')' : ''));
  }
  const t = readToken(der, expectTag(tokenEl, 0x30, 'token'));
  if (!t.hash.equals(hash)) throw new Error('RFC 3161: the token is about another hash');
  if (t.nonce === null || t.nonce !== integerHex(nonce, { start: 0, end: nonce.length })) {
    throw new Error('RFC 3161: the token answers another request (nonce)');
  }
  return { token: Buffer.from(der.subarray(t.token.at, t.token.end)), genTime: t.genTime, serial: t.serial };
}

// ── Sending ─────────────────────────────────────────────────

// POST the request, read at most MAX_ANSWER_BYTES, give up after timeoutMs.
// No redirects: the URL is configured, and an answer from somewhere else would
// not be what was configured.
function post(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new Error('RFC 3161: not a URL: ' + url));
      return;
    }
    const mod = target.protocol === 'https:' ? https : target.protocol === 'http:' ? http : null;
    if (!mod) {
      reject(new Error('RFC 3161: only http and https URLs'));
      return;
    }
    let settled = false;
    let deadline = null;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (err) reject(err);
      else resolve(value);
    };
    const req = mod.request(
      target,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/timestamp-query',
          'Content-Length': body.length,
          Accept: 'application/timestamp-reply'
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          // Not read on: a peer that keeps sending would hold the socket.
          req.destroy();
          done(new Error('RFC 3161: the TSA answered HTTP ' + res.statusCode));
          return;
        }
        const parts = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_ANSWER_BYTES) {
            req.destroy();
            done(new Error('RFC 3161: the answer is too large'));
            return;
          }
          parts.push(chunk);
        });
        res.on('end', () => done(null, Buffer.concat(parts)));
        res.on('error', (e) => done(e));
      }
    );
    deadline = setTimeout(() => {
      req.destroy();
      done(new Error('RFC 3161: no answer within ' + Math.round(timeoutMs / 1000) + ' s'));
    }, timeoutMs);
    req.on('error', (e) => done(e));
    req.end(body);
  });
}

// One timestamp over a SHA-256 value given as hex.
async function stamp(url, hashHex, opts = {}) {
  const hash = Buffer.from(String(hashHex), 'hex');
  const nonce = randomNonce();
  const answer = await post(url, buildRequest(hash, nonce), opts.timeoutMs || 20000);
  return readResponse(answer, hash, nonce);
}

module.exports = {
  buildRequest,
  readResponse,
  tokenInfo,
  randomNonce,
  stamp,
  post,
  generalizedTime,
  MAX_ANSWER_BYTES
};
