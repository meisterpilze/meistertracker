'use strict';
// A ZIP file written as a stream, without compression (method STORE).
//
// For the lab book archive (scripts/lab-archive.js): JSON, a few text files and
// the experiment photos, which are JPEGs and would not get smaller. Every file
// is read twice, once for its CRC-32 (and, for the caller, its SHA-256) and
// once into the archive, so each local header carries its real sizes and CRC
// and any unzip tool can read the archive front to back. ZIP64 records are
// written where an offset or size passes 4 GB, which a year of full-resolution
// photos can.
//
// Format: APPNOTE.TXT 6.3.10 (PKWARE), sections 4.3 (structure), 4.4 (fields),
// 4.5.3 (ZIP64 extra field). Names are UTF-8 (general purpose flag bit 11).
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

function dosTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}
function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

// CRC-32 and SHA-256 of a file, in one read.
function fileSums(abs) {
  return new Promise((resolve, reject) => {
    let crc = 0;
    let size = 0;
    const sha = crypto.createHash('sha256');
    const s = fs.createReadStream(abs);
    s.on('data', (chunk) => {
      crc = zlib.crc32(chunk, crc);
      sha.update(chunk);
      size += chunk.length;
    });
    s.on('error', reject);
    s.on('end', () => resolve({ crc, size, sha256: sha.digest('hex') }));
  });
}

// out: a writable stream (an HTTP response, a file). opts.force64 writes the
// ZIP64 records for every entry, which the tests use to check them without
// writing 4 GB. opts.date is the modification time every entry gets.
function createZipWriter(out, opts = {}) {
  const force64 = !!opts.force64;
  const when = dosTime(opts.date || new Date());
  const central = [];
  let offset = 0;
  let closed = false;
  // A download the browser cancels closes the response without 'drain' or
  // 'error', and every write after that returns false and fires nothing. A
  // writer waiting for 'drain' would wait forever, holding a photo file open
  // and the caller's one-at-a-time lock. So 'close' ends it too.
  let outputGone = false;
  out.once('close', () => {
    outputGone = true;
  });

  function write(buf) {
    if (outputGone || out.destroyed) return Promise.reject(new Error('zip: output closed'));
    offset += buf.length;
    if (out.write(buf)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = (err) => {
        out.off('drain', onDrain);
        out.off('error', onError);
        out.off('close', onClose);
        if (err) reject(err);
        else resolve();
      };
      const onDrain = () => done();
      const onError = (e) => done(e);
      const onClose = () => done(new Error('zip: output closed'));
      out.once('drain', onDrain);
      out.once('error', onError);
      out.once('close', onClose);
    });
  }

  function localHeader(name, crc, size, zip64) {
    const extra = zip64 ? Buffer.concat([u16(0x0001), u16(16), u64(size), u64(size)]) : Buffer.alloc(0);
    return Buffer.concat([
      u32(0x04034b50),
      u16(zip64 ? 45 : 20),
      u16(0x0800),
      u16(0),
      u16(when.time),
      u16(when.date),
      u32(crc),
      u32(zip64 ? MAX32 : size),
      u32(zip64 ? MAX32 : size),
      u16(name.length),
      u16(extra.length),
      name,
      extra
    ]);
  }

  function centralHeader(e) {
    const bigSize = force64 || e.size >= MAX32;
    const bigOffset = force64 || e.offset >= MAX32;
    const fields = [];
    if (bigSize) fields.push(u64(e.size), u64(e.size));
    if (bigOffset) fields.push(u64(e.offset));
    const extra = fields.length ? Buffer.concat([u16(0x0001), u16(fields.length * 8), ...fields]) : Buffer.alloc(0);
    const needs64 = bigSize || bigOffset;
    return Buffer.concat([
      u32(0x02014b50),
      u16(45),
      u16(needs64 ? 45 : 20),
      u16(0x0800),
      u16(0),
      u16(when.time),
      u16(when.date),
      u32(e.crc),
      u32(bigSize ? MAX32 : e.size),
      u32(bigSize ? MAX32 : e.size),
      u16(e.name.length),
      u16(extra.length),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(bigOffset ? MAX32 : e.offset),
      e.name,
      extra
    ]);
  }

  function entryName(name) {
    if (closed) throw new Error('zip: already finished');
    const n = String(name);
    if (!n || n.startsWith('/') || n.split('/').includes('..') || n.includes('\\')) {
      throw new Error('zip: bad entry name: ' + n);
    }
    return Buffer.from(n, 'utf8');
  }

  return {
    // A whole buffer as one entry. Returns its SHA-256.
    async addBuffer(name, data) {
      const nameBuf = entryName(name);
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
      const crc = zlib.crc32(buf);
      const zip64 = force64 || buf.length >= MAX32;
      central.push({ name: nameBuf, crc, size: buf.length, offset });
      await write(localHeader(nameBuf, crc, buf.length, zip64));
      await write(buf);
      return crypto.createHash('sha256').update(buf).digest('hex');
    },
    // A file from disk as one entry, read twice (sums, then data). If its
    // size changes in between, the archive would lie, so that is an error.
    // Returns { size, sha256 }.
    async addFile(name, abs) {
      const nameBuf = entryName(name);
      const sums = await fileSums(abs);
      const zip64 = force64 || sums.size >= MAX32;
      central.push({ name: nameBuf, crc: sums.crc, size: sums.size, offset });
      await write(localHeader(nameBuf, sums.crc, sums.size, zip64));
      let written = 0;
      let crc = 0;
      await new Promise((resolve, reject) => {
        const s = fs.createReadStream(abs);
        s.on('data', (chunk) => {
          written += chunk.length;
          crc = zlib.crc32(chunk, crc);
          s.pause();
          write(chunk).then(
            () => s.resume(),
            (e) => {
              s.destroy();
              reject(e);
            }
          );
        });
        s.on('error', reject);
        s.on('end', resolve);
      });
      if (written !== sums.size || crc !== sums.crc) throw new Error('zip: ' + name + ' changed while it was read');
      return { size: sums.size, sha256: sums.sha256 };
    },
    // The central directory and the end records. Does not end `out`.
    async finish() {
      if (closed) throw new Error('zip: already finished');
      closed = true;
      const start = offset;
      for (const e of central) await write(centralHeader(e));
      const size = offset - start;
      const need64 = force64 || central.length >= MAX16 || size >= MAX32 || start >= MAX32;
      if (need64) {
        const record = offset;
        await write(
          Buffer.concat([
            u32(0x06064b50),
            u64(44),
            u16(45),
            u16(45),
            u32(0),
            u32(0),
            u64(central.length),
            u64(central.length),
            u64(size),
            u64(start)
          ])
        );
        await write(Buffer.concat([u32(0x07064b50), u32(0), u64(record), u32(1)]));
      }
      await write(
        Buffer.concat([
          u32(0x06054b50),
          u16(0),
          u16(0),
          u16(need64 ? MAX16 : central.length),
          u16(need64 ? MAX16 : central.length),
          u32(need64 ? MAX32 : size),
          u32(need64 ? MAX32 : start),
          u16(0)
        ])
      );
      return { entries: central.length, bytes: offset };
    }
  };
}

module.exports = { createZipWriter, fileSums, dosTime };
