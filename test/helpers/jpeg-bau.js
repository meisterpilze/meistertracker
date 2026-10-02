'use strict';
// JPEGs built byte by byte for tests: EXIF with a GPS block at a known place,
// XMP, a frame header. Nothing here is a real photo, and the coordinates are
// invented ones that point at no place in particular.

// A TIFF block: IFD0 with the orientation and, optionally, a GPS pointer; a GPS
// IFD with latitude and longitude, both out of line as three rationals each.
function tiff(le, { gps = true, orientation = 6 } = {}) {
  const w16 = (b, o, v) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (b, o, v) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  const n0 = gps ? 2 : 1;
  const gpsOff = 8 + 2 + n0 * 12 + 4;
  const valOff = gpsOff + 2 + 4 * 12 + 4;
  const b = Buffer.alloc(gps ? valOff + 48 : gpsOff);
  b.write(le ? 'II' : 'MM', 0, 'latin1');
  w16(b, 2, 42);
  w32(b, 4, 8);
  w16(b, 8, n0);
  w16(b, 10, 0x0112);
  w16(b, 12, 3);
  w32(b, 14, 1);
  w16(b, 18, orientation);
  if (gps) {
    w16(b, 22, 0x8825);
    w16(b, 24, 4);
    w32(b, 26, 1);
    w32(b, 30, gpsOff);
    w16(b, gpsOff, 4);
    const entry = (k, tag, type, count, value) => {
      const e = gpsOff + 2 + k * 12;
      w16(b, e, tag);
      w16(b, e + 2, type);
      w32(b, e + 4, count);
      if (typeof value === 'string') b.write(value, e + 8, 'latin1');
      else w32(b, e + 8, value);
    };
    entry(0, 1, 2, 2, 'N\0');
    entry(1, 2, 5, 3, valOff);
    entry(2, 3, 2, 2, 'E\0');
    entry(3, 4, 5, 3, valOff + 24);
    [12, 1, 34, 1, 5600, 100, 65, 1, 43, 1, 2100, 100].forEach((v, i) => w32(b, valOff + i * 4, v));
  }
  return { b, gpsOff, valOff };
}
function app1(payload) {
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}
function exif(le, opts) {
  return app1(Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff(le, opts).b]));
}
function xmp(xml) {
  return app1(Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xml, 'utf8')]));
}
// A Photoshop block (APP13) holding IPTC-IIM datasets: [record, dataset, value].
function app13(datasets) {
  const iim = Buffer.concat(
    datasets.map(([rec, ds, value]) => {
      const v = Buffer.from(value, 'utf8');
      const h = Buffer.from([0x1c, rec, ds, 0, 0]);
      h.writeUInt16BE(v.length, 3);
      return Buffer.concat([h, v]);
    })
  );
  const res = Buffer.alloc(12);
  res.write('8BIM', 0, 'latin1');
  res.writeUInt16BE(0x0404, 4);
  res.writeUInt32BE(iim.length, 8);
  const payload = Buffer.concat([Buffer.from('Photoshop 3.0\0', 'latin1'), res, iim, Buffer.alloc(iim.length % 2)]);
  const head = Buffer.from([0xff, 0xed, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}
// One piece of an extended XMP packet: its GUID, the whole packet's length,
// and where this piece sits in it.
function xmpExt(guid, full, offset, piece) {
  const h = Buffer.alloc(40);
  h.write(guid, 0, 'latin1');
  h.writeUInt32BE(full, 32);
  h.writeUInt32BE(offset, 36);
  return app1(
    Buffer.concat([Buffer.from('http://ns.adobe.com/xmp/extension/\0', 'latin1'), h, Buffer.from(piece, 'latin1')])
  );
}
function sof(w, h) {
  const b = Buffer.alloc(19);
  b[0] = 0xff;
  b[1] = 0xc0;
  b.writeUInt16BE(17, 2);
  b[4] = 8;
  b.writeUInt16BE(h, 5);
  b.writeUInt16BE(w, 7);
  b[9] = 3;
  return b;
}
function jpeg(...segs) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...segs,
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9])
  ]);
}
// Offset of the TIFF header inside a JPEG built as jpeg(exif(...), ...).
const TIFF_AT = 2 + 4 + 6;

module.exports = { tiff, app1, exif, xmp, app13, xmpExt, sof, jpeg, TIFF_AT };
