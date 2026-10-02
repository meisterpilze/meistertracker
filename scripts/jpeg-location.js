'use strict';
// Where a photo was taken, taken out of the photo.
//
// A phone writes its GPS position into every picture it takes with location
// on, and a JPEG picked from the gallery keeps it; one that went through
// Lightroom or Photoshop carries the place names as well. The lab notebook
// keeps the original of an experiment photo at full resolution, and an
// original can leave the building — on the backup stick, in a printed lab
// book, attached to a report. It must not carry the address of the lab with
// it.
//
// The bytes are overwritten in place, never cut out: the file keeps its length
// and its layout. Cutting would shift everything behind the cut, and a phone
// photo often carries more than one picture (MPF: a depth map, an HDR gain map)
// whose positions are offsets written near the start of the file. Overwriting
// leaves those offsets true.
//
// Where it looks: the header of each picture in the file — the segments from
// its start marker to its compressed data, walked by their lengths, where all
// of a picture's metadata lives. The first picture starts the file; the next
// ones are found by their start marker after the end of the previous header
// (inside compressed data a 0xFF is followed by 0x00 or a restart marker,
// never by the start marker's 0xD8). Every byte is looked at in at most one
// header, and the number of pictures and segments is bounded, so no file can
// make this slow. An earlier version scanned for the APP1 marker anywhere in
// the file and accepted segments overlapping each other: a crafted 40 MB
// upload cost the server's only thread more than a minute.
//
// What goes:
//   - the GPS block of every EXIF segment: its entries and their values are
//     zeroed and its count set to nothing. An EXIF block that cannot be walked
//     to the end is not trusted to hold no location: it is overwritten whole,
//     keeping only the orientation when that could be read. (Refusing such a
//     file, as an earlier version did, lost the original for good while other
//     malformed blocks went through with their coordinates.)
//   - location values in XMP — coordinates and place names, in the standard
//     packet and in extended XMP, found by their namespace whatever prefix the
//     packet gives it — blanked with spaces so the XML stays well-formed;
//   - the place fields of IPTC-IIM (city, sub-location, province, country) in
//     a Photoshop block (APP13), blanked with spaces.
// What stays is everything else, the orientation included, so the original
// still stands the right way up.

const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');
const XMP_HEADER = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');
const XMP_EXT_HEADER = Buffer.from('http://ns.adobe.com/xmp/extension/\0', 'latin1');
const PS_HEADER = Buffer.from('Photoshop 3.0\0', 'latin1');
const SOI = Buffer.from([0xff, 0xd8, 0xff]);
const MAX_IMAGES = 16;
const MAX_SEGMENTS = 256;

// Bytes per value for each TIFF field type.
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const GPS_IFD_TAG = 0x8825;
const ORIENTATION_TAG = 0x0112;

// XMP properties that say where, by namespace: the local names to blank.
const XMP_PLACE_NS = {
  'http://ns.adobe.com/exif/1.0/': 'GPS[A-Za-z]*',
  'http://cipa.jp/exif/1.0/': 'GPS[A-Za-z]*',
  'http://ns.adobe.com/photoshop/1.0/': '(?:City|State|Country)',
  'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/': '(?:Location|CountryCode)',
  'http://iptc.org/std/Iptc4xmpExt/2008-02-29/':
    '(?:City|CountryName|CountryCode|ProvinceState|ProvinceName|Sublocation|WorldRegion|LocationName|LocationId|GPS-[A-Za-z]+)'
};
// The prefixes these namespaces usually carry, for a packet whose declarations
// sit elsewhere (extended XMP split from its main packet).
const XMP_DEFAULT_PREFIX = {
  exif: 'http://ns.adobe.com/exif/1.0/',
  exifEX: 'http://cipa.jp/exif/1.0/',
  photoshop: 'http://ns.adobe.com/photoshop/1.0/',
  Iptc4xmpCore: 'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/',
  Iptc4xmpExt: 'http://iptc.org/std/Iptc4xmpExt/2008-02-29/'
};
// IPTC-IIM record 2: content location code and name, city, sub-location
// (often the street), province or state, country code, country name.
const IIM_PLACE = new Set([26, 27, 90, 92, 95, 100, 101]);

function isJpeg(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

// The segments of one picture's header, from its start marker up to its
// compressed data, walked by their lengths. A walk that meets something that
// is not a segment stops there.
function headerSegments(buf, soi) {
  const out = [];
  let p = soi + 2;
  while (p + 4 <= buf.length && out.length < MAX_SEGMENTS) {
    if (buf[p] !== 0xff) break;
    const m = buf[p + 1];
    if (m === 0xff) {
      p++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      p += 2;
      continue;
    }
    if (m === 0xd9 || m === 0xda) break;
    const len = buf.readUInt16BE(p + 2);
    if (len < 2 || p + 2 + len > buf.length) break;
    out.push({ marker: m, start: p + 4, end: p + 2 + len });
    p += 2 + len;
  }
  return { segments: out, end: p };
}

// Every picture's header in the file, the first one first.
function imageHeaders(buf) {
  const images = [];
  let soi = 0;
  while (images.length < MAX_IMAGES) {
    const h = headerSegments(buf, soi);
    images.push(h.segments);
    const next = buf.indexOf(SOI, Math.max(h.end, soi + 2));
    if (next === -1) break;
    soi = next;
  }
  return images;
}

function startsWith(buf, seg, header) {
  return seg.start + header.length <= seg.end && buf.subarray(seg.start, seg.start + header.length).equals(header);
}

// One EXIF block, starting at its TIFF header: the reader for its byte order.
function tiffReader(buf, tiff, end) {
  if (tiff + 8 > end) return null;
  const order = buf.toString('latin1', tiff, tiff + 2);
  const le = order === 'II';
  if (!le && order !== 'MM') return null;
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  if (u16(tiff + 2) !== 42) return null;
  return { u16, u32 };
}

// IFD0's entries: where the GPS block is and how the picture is turned.
// Null when IFD0 cannot be walked.
function readIfd0(buf, tiff, end) {
  const r = tiffReader(buf, tiff, end);
  if (!r) return null;
  const ifd0 = tiff + r.u32(tiff + 4);
  if (ifd0 < tiff + 8 || ifd0 + 2 > end) return null;
  const n0 = r.u16(ifd0);
  if (ifd0 + 2 + n0 * 12 > end) return null;
  let gps = null;
  let orientation = null;
  for (let k = 0; k < n0; k++) {
    const e = ifd0 + 2 + k * 12;
    const tag = r.u16(e);
    if (tag === GPS_IFD_TAG) gps = tiff + r.u32(e + 8);
    // A SHORT is stored left-justified in the value field, in either order.
    if (tag === ORIENTATION_TAG && r.u16(e + 2) === 3) orientation = r.u16(e + 8);
  }
  return { r, gps, orientation: orientation >= 1 && orientation <= 8 ? orientation : null };
}

// The whole EXIF block overwritten, and in its place a TIFF header whose
// IFD0 holds only the orientation, so the picture still stands up.
function blankExif(buf, tiff, end, orientation) {
  buf.fill(0, tiff, end);
  if (orientation && end - tiff >= 26) {
    buf.write('II', tiff, 'latin1');
    buf.writeUInt16LE(42, tiff + 2);
    buf.writeUInt32LE(8, tiff + 4);
    buf.writeUInt16LE(1, tiff + 8);
    buf.writeUInt16LE(ORIENTATION_TAG, tiff + 10);
    buf.writeUInt16LE(3, tiff + 12);
    buf.writeUInt32LE(1, tiff + 14);
    buf.writeUInt16LE(orientation, tiff + 18);
  }
  return 'blanked';
}

// One EXIF block: zero its GPS IFD. Returns 'none', 'scrubbed' or 'blanked'.
// Everything is checked before anything is zeroed, so a block is either
// scrubbed exactly or overwritten whole.
function scrubExif(buf, seg) {
  const tiff = seg.start + EXIF_HEADER.length;
  const end = seg.end;
  const ifd = readIfd0(buf, tiff, end);
  if (!ifd) return blankExif(buf, tiff, end, null);
  const { r, gps, orientation } = ifd;
  if (gps === null) return 'none';
  if (gps < tiff + 8 || gps + 2 > end) return blankExif(buf, tiff, end, orientation);
  const n = r.u16(gps);
  const ifdEnd = gps + 2 + n * 12 + 4;
  if (ifdEnd > end) return blankExif(buf, tiff, end, orientation);
  const values = [];
  for (let k = 0; k < n; k++) {
    const e = gps + 2 + k * 12;
    const size = (TYPE_SIZE[r.u16(e + 2)] || 0) * r.u32(e + 4);
    if (size <= 4) continue;
    const at = tiff + r.u32(e + 8);
    if (at < tiff + 8 || at + size > end) return blankExif(buf, tiff, end, orientation);
    values.push([at, at + size]);
  }
  for (const [from, to] of values) buf.fill(0, from, to);
  // Count, entries and the next-IFD link: an empty GPS IFD that ends the chain.
  buf.fill(0, gps, ifdEnd);
  return 'scrubbed';
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

// The XMP properties that say where, for this packet: by the namespaces it
// declares, whatever prefix it binds them to, plus the usual prefixes, plus
// any property whose name begins with GPS — vendors (drones, some apps) keep
// coordinates under names of their own.
//
// Names are bounded in length, and so is the number of declared prefixes
// taken in: an unbounded name pattern let a crafted run like "a.a.a.a…" be
// scanned again from every one of its starts.
const MAX_PREFIXES = 16;
function placeAlternatives(text) {
  const byPrefix = new Map(Object.entries(XMP_DEFAULT_PREFIX).map(([p, uri]) => [p, XMP_PLACE_NS[uri]]));
  let declared = 0;
  for (const m of text.matchAll(/xmlns:([A-Za-z_][\w.-]{0,63})\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const local = XMP_PLACE_NS[m[2] !== undefined ? m[2] : m[3]];
    if (!local || byPrefix.has(m[1])) continue;
    if (++declared > MAX_PREFIXES) break;
    byPrefix.set(m[1], local);
  }
  const alts = [...byPrefix].map(([p, local]) => escapeRe(p) + ':' + local);
  alts.push('[A-Za-z_][\\w.-]{0,63}:G[Pp][Ss][A-Za-z-]{0,63}');
  return '(?:' + alts.join('|') + ')';
}

// Blank the place values in XMP text, keeping its length. Values are matched
// in either quote, each with its own: a value holding the other quote
// ("Vila d'Exemplo") was left whole by a pattern that excluded both.
// Attributes inside an element's start tag are matched up to the next angle
// bracket, so an unclosed tag costs its own length and no more.
function scrubXmpText(text) {
  const place = placeAlternatives(text);
  const attr = new RegExp('(\\b(?!xmlns:)' + place + '\\s*=\\s*)(?:"([^"]*)"|\'([^\']*)\')', 'g');
  const elem = new RegExp('(<(' + place + ')(?:\\s[^<>]*)?>)([^<]*)(</\\2>)', 'g');
  let n = 0;
  const blank = (s) => {
    n++;
    return ' '.repeat(s.length);
  };
  const clean = text
    .replace(attr, (m, head, dq, sq) =>
      dq !== undefined ? head + '"' + blank(dq) + '"' : head + "'" + blank(sq) + "'"
    )
    .replace(elem, (m, open, name, value, close) => open + blank(value) + close);
  return { clean, n };
}

// One XMP packet: blank the place values. Returns how many it blanked.
function scrubXmp(buf, seg) {
  const from = seg.start + XMP_HEADER.length;
  const { clean, n } = scrubXmpText(buf.toString('latin1', from, seg.end));
  if (n) buf.write(clean, from, 'latin1');
  return n;
}

// Extended XMP: one packet split over several segments, each carrying a GUID,
// the packet's full length and its own offset. Put together, scrubbed as one
// text, and written back piece by piece, so a value split between two
// segments is found too. Pieces that do not fit together are blanked whole.
function scrubExtendedXmp(buf, segs) {
  let n = 0;
  const groups = new Map();
  for (const seg of segs) {
    const h = seg.start + XMP_EXT_HEADER.length;
    if (h + 40 > seg.end) {
      buf.fill(0x20, Math.min(h, seg.end), seg.end);
      n++;
      continue;
    }
    const guid = buf.toString('latin1', h, h + 32);
    const g = groups.get(guid) || { full: buf.readUInt32BE(h + 32), parts: [] };
    g.parts.push({ at: h + 40, len: seg.end - (h + 40), off: buf.readUInt32BE(h + 36) });
    groups.set(guid, g);
  }
  for (const g of groups.values()) {
    const total = g.parts.reduce((s, p) => s + p.len, 0);
    const fits = g.full <= total && g.parts.every((p) => p.off + p.len <= g.full);
    if (!fits) {
      for (const p of g.parts) buf.fill(0x20, p.at, p.at + p.len);
      n++;
      continue;
    }
    const whole = Buffer.alloc(g.full, 0x20);
    for (const p of g.parts) buf.copy(whole, p.off, p.at, p.at + p.len);
    const r = scrubXmpText(whole.toString('latin1'));
    if (!r.n) continue;
    n += r.n;
    const clean = Buffer.from(r.clean, 'latin1');
    for (const p of g.parts) clean.copy(buf, p.at, p.off, p.off + p.len);
  }
  return n;
}

// IPTC-IIM datasets (in Photoshop resource 0x0404): the place fields blanked
// with spaces, their lengths kept. What does not read as IIM is zeroed.
function scrubIim(buf, from, to) {
  let n = 0;
  let p = from;
  while (p + 5 <= to) {
    if (buf[p] !== 0x1c) {
      buf.fill(0, p, to);
      return n + 1;
    }
    const rec = buf[p + 1];
    const ds = buf[p + 2];
    let len = buf.readUInt16BE(p + 3);
    let v = p + 5;
    if (len & 0x8000) {
      const k = len & 0x7fff;
      if (k < 1 || k > 4 || v + k > to) {
        buf.fill(0, p, to);
        return n + 1;
      }
      len = buf.readUIntBE(v, k);
      v += k;
    }
    if (v + len > to) {
      buf.fill(0, p, to);
      return n + 1;
    }
    if (rec === 2 && IIM_PLACE.has(ds) && len) {
      buf.fill(0x20, v, v + len);
      n++;
    }
    p = v + len;
  }
  return n;
}

// A Photoshop block (APP13): its resources, and in the IPTC one the place
// fields. Returns how many it blanked.
function scrubPhotoshop(buf, seg) {
  let n = 0;
  let p = seg.start + PS_HEADER.length;
  while (p + 12 <= seg.end) {
    if (buf.toString('latin1', p, p + 4) !== '8BIM') break;
    const id = buf.readUInt16BE(p + 4);
    const nameLen = buf[p + 6];
    // The name is a Pascal string, padded to an even length.
    const q = p + 6 + ((nameLen + 2) & ~1);
    if (q + 4 > seg.end) break;
    const size = buf.readUInt32BE(q);
    const data = q + 4;
    if (data + size > seg.end) {
      buf.fill(0, data, seg.end);
      return n + 1;
    }
    if (id === 0x0404) n += scrubIim(buf, data, data + size);
    p = data + size + (size & 1);
  }
  return n;
}

// A copy of the photo without its location, and what was done to it.
function scrubLocation(input) {
  if (!isJpeg(input)) throw new Error('not a JPEG');
  const buf = Buffer.from(input);
  let gpsBlocks = 0;
  let blanked = 0;
  let xmpValues = 0;
  let iimValues = 0;
  for (const segments of imageHeaders(buf)) {
    const extended = [];
    for (const seg of segments) {
      if (seg.marker === 0xe1 && startsWith(buf, seg, EXIF_HEADER)) {
        const r = scrubExif(buf, seg);
        if (r === 'scrubbed') gpsBlocks++;
        if (r === 'blanked') blanked++;
      } else if (seg.marker === 0xe1 && startsWith(buf, seg, XMP_HEADER)) {
        xmpValues += scrubXmp(buf, seg);
      } else if (seg.marker === 0xe1 && startsWith(buf, seg, XMP_EXT_HEADER)) {
        extended.push(seg);
      } else if (seg.marker === 0xed && startsWith(buf, seg, PS_HEADER)) {
        iimValues += scrubPhotoshop(buf, seg);
      }
    }
    if (extended.length) xmpValues += scrubExtendedXmp(buf, extended);
  }
  return {
    buf,
    gpsBlocks,
    blanked,
    xmpValues,
    iimValues,
    locationRemoved: gpsBlocks + blanked + xmpValues + iimValues > 0
  };
}

// Width and height of the first picture as it is seen: the frame size, turned
// by the EXIF orientation. A portrait phone photo is stored 4032 × 3024 with
// orientation 6 and shown 3024 × 4032; recorded unturned, the lab book printed
// a landscape size under a portrait picture.
function jpegSize(buf) {
  if (!isJpeg(buf)) return null;
  const { segments } = headerSegments(buf, 0);
  let size = null;
  let orientation = null;
  for (const seg of segments) {
    const m = seg.marker;
    const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (sof && !size && seg.start + 5 <= seg.end) {
      size = { height: buf.readUInt16BE(seg.start + 1), width: buf.readUInt16BE(seg.start + 3) };
    }
    if (m === 0xe1 && orientation === null && startsWith(buf, seg, EXIF_HEADER)) {
      const ifd = readIfd0(buf, seg.start + EXIF_HEADER.length, seg.end);
      orientation = (ifd && ifd.orientation) || null;
    }
  }
  if (!size) return null;
  return orientation >= 5 ? { width: size.height, height: size.width } : size;
}

module.exports = { isJpeg, scrubLocation, jpegSize };
