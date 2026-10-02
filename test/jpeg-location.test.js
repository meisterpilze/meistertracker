'use strict';
// Taking the location out of an original: GPS in every EXIF block, place names
// in XMP, overwritten in place so the file keeps its length and layout.
//
// The JPEGs are built here byte by byte, with a known position, so a test can
// say exactly which bytes must be gone and which must not have moved.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isJpeg, scrubLocation, jpegSize } = require('../scripts/jpeg-location.js');

const { tiff, app1, exif, xmp, app13, xmpExt, sof, jpeg, TIFF_AT } = require('./helpers/jpeg-bau');

describe('scrubLocation', () => {
  for (const le of [true, false]) {
    it('zeroes the GPS block and its values, ' + (le ? 'little' : 'big') + '-endian', () => {
      const { gpsOff, valOff, b: block } = tiff(le);
      const before = jpeg(exif(le), sof(4032, 3024));
      const { buf, gpsBlocks, blanked } = scrubLocation(before);
      assert.equal(gpsBlocks, 1);
      assert.equal(blanked, 0, 'scrubbed exactly, not overwritten whole');
      assert.equal(buf.length, before.length, 'not one byte shorter or longer');
      const gpsStart = TIFF_AT + gpsOff;
      const gpsEnd = TIFF_AT + gpsOff + 2 + 4 * 12 + 4;
      const valStart = TIFF_AT + valOff;
      const valEnd = valStart + 48;
      assert.ok(
        buf.subarray(gpsStart, gpsEnd).every((x) => x === 0),
        'the GPS entries are gone'
      );
      assert.ok(
        buf.subarray(valStart, valEnd).every((x) => x === 0),
        'the coordinates are gone'
      );
      // Everything else is where it was, the orientation and the pointer included.
      for (let i = 0; i < buf.length; i++) {
        if ((i >= gpsStart && i < gpsEnd) || (i >= valStart && i < valEnd)) continue;
        assert.equal(buf[i], before[i], 'byte ' + i + ' changed');
      }
      assert.equal(le ? block.readUInt16LE(18) : block.readUInt16BE(18), 6);
      assert.equal(le ? buf.readUInt16LE(TIFF_AT + 18) : buf.readUInt16BE(TIFF_AT + 18), 6, 'still upright');
    });
  }

  it('leaves a photo without location exactly as it was', () => {
    const before = jpeg(exif(true, { gps: false }), sof(10, 10));
    const r = scrubLocation(before);
    assert.equal(r.gpsBlocks, 0);
    assert.ok(r.buf.equals(before));
    assert.notEqual(r.buf, before, 'a copy, never the caller’s buffer');
  });

  it('finds the location in a second picture behind the first, as phones store depth and HDR maps', () => {
    const before = Buffer.concat([jpeg(exif(true), sof(8, 8)), jpeg(exif(false), sof(4, 4))]);
    const r = scrubLocation(before);
    assert.equal(r.gpsBlocks, 2);
    assert.equal(r.buf.length, before.length);
    const rational = Buffer.alloc(4);
    rational.writeUInt32LE(2100);
    assert.equal(r.buf.indexOf(rational), -1);
    rational.writeUInt32BE(2100);
    assert.equal(r.buf.indexOf(rational), -1);
  });

  it('blanks place values in XMP and keeps the rest of the packet', () => {
    const xml =
      '<x:xmpmeta><rdf:Description exif:GPSLatitude="12,34.5N" exif:GPSLongitude="65,43.2E" ' +
      'tiff:Orientation="6" photoshop:City="Somewhere"><exif:GPSAltitude>34/1</exif:GPSAltitude>' +
      '<dc:title>Plate 3</dc:title></rdf:Description></x:xmpmeta>';
    const before = jpeg(xmp(xml), sof(10, 10));
    const r = scrubLocation(before);
    assert.equal(r.xmpValues, 4);
    assert.equal(r.buf.length, before.length);
    const text = r.buf.toString('latin1');
    assert.ok(
      !text.includes('12,34.5N') && !text.includes('65,43.2E') && !text.includes('Somewhere') && !text.includes('34/1')
    );
    assert.ok(text.includes('exif:GPSLatitude="        "'));
    assert.ok(text.includes('<exif:GPSAltitude>    </exif:GPSAltitude>'));
    assert.ok(text.includes('tiff:Orientation="6"') && text.includes('<dc:title>Plate 3</dc:title>'));
  });

  it('overwrites an EXIF block whose GPS pointer it cannot follow, keeping the orientation', () => {
    const { b } = tiff(true);
    b.writeUInt32LE(60000, 30); // the GPS pointer, now far outside the block
    const before = jpeg(app1(Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), b])), sof(10, 10));
    const r = scrubLocation(before);
    assert.equal(r.blanked, 1);
    assert.equal(r.locationRemoved, true);
    assert.equal(r.buf.length, before.length);
    const rational = Buffer.alloc(4);
    rational.writeUInt32LE(2100);
    assert.notEqual(before.indexOf(rational), -1);
    assert.equal(r.buf.indexOf(rational), -1, 'the coordinates are gone');
    assert.equal(r.buf.readUInt16LE(TIFF_AT + 10), 0x0112, 'one entry left: the orientation');
    assert.equal(r.buf.readUInt16LE(TIFF_AT + 18), 6);
  });

  it('overwrites an EXIF block it cannot read at all', () => {
    const { b } = tiff(true);
    b.writeUInt16LE(0x2a00, 2); // a byte-swapped 42, which tolerant readers still accept
    const before = jpeg(app1(Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), b])), sof(10, 10));
    const r = scrubLocation(before);
    assert.equal(r.blanked, 1);
    assert.ok(r.buf.subarray(TIFF_AT, TIFF_AT + b.length).every((x) => x === 0));
  });

  it('takes no longer than a moment over a file built to make it slow', () => {
    // Overlapping fake XMP segments: each four bytes in, another 64 KB one.
    const unit = Buffer.concat([
      Buffer.from([0xff, 0xe1, 0xff, 0xff]),
      Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1')
    ]);
    const crafted = Buffer.concat([Buffer.from([0xff, 0xd8]), ...Array(120000).fill(unit), sof(10, 10)]);
    const t = Date.now();
    scrubLocation(crafted);
    assert.ok(Date.now() - t < 1000, 'took ' + (Date.now() - t) + ' ms for ' + crafted.length + ' bytes');
  });

  it('reads a packet of unclosed tags in one go', () => {
    const crafted = jpeg(xmp('<x:xmpmeta>' + '<exif:GPS '.repeat(6400) + '</x:xmpmeta>'), sof(10, 10));
    const t = Date.now();
    scrubLocation(crafted);
    assert.ok(Date.now() - t < 200, 'took ' + (Date.now() - t) + ' ms');
  });

  it('blanks a place name that holds the other quote', () => {
    const xml =
      '<x:xmpmeta><rdf:Description photoshop:City="Vila d\'Exemplo" ' +
      'Iptc4xmpCore:Location=\'The "Old" Lane 3\' tiff:Orientation="1"/></x:xmpmeta>';
    const r = scrubLocation(jpeg(xmp(xml), sof(10, 10)));
    const text = r.buf.toString('latin1');
    assert.equal(r.xmpValues, 2);
    assert.ok(!text.includes('Exemplo') && !text.includes('Old'), text);
    assert.ok(text.includes('tiff:Orientation="1"'));
  });

  it('finds coordinates by their namespace, whatever prefix the packet gives it', () => {
    const xml =
      '<x:xmpmeta><rdf:Description xmlns:ns2="http://ns.adobe.com/exif/1.0/" ns2:GPSLatitude="12,34.5N" ' +
      'xmlns:drone="http://www.example.com/drone/1.0/" drone:GpsLongitude="+65.4321"/></x:xmpmeta>';
    const r = scrubLocation(jpeg(xmp(xml), sof(10, 10)));
    const text = r.buf.toString('latin1');
    assert.ok(!text.includes('12,34.5N') && !text.includes('65.4321'), text);
    assert.ok(text.includes('xmlns:ns2="http://ns.adobe.com/exif/1.0/"'), 'the declarations stay whole');
  });

  it('blanks the IPTC extension location structures', () => {
    const xml =
      '<x:xmpmeta><rdf:Description><Iptc4xmpExt:LocationCreated><rdf:Bag><rdf:li rdf:parseType="Resource">' +
      '<Iptc4xmpExt:City>Somewhere</Iptc4xmpExt:City><Iptc4xmpExt:Sublocation>Example Lane 1</Iptc4xmpExt:Sublocation>' +
      '<Iptc4xmpExt:CountryName>Nowhereland</Iptc4xmpExt:CountryName></rdf:li></rdf:Bag>' +
      '</Iptc4xmpExt:LocationCreated></rdf:Description></x:xmpmeta>';
    const r = scrubLocation(jpeg(xmp(xml), sof(10, 10)));
    const text = r.buf.toString('latin1');
    assert.equal(r.xmpValues, 3);
    assert.ok(!/Somewhere|Example Lane|Nowhereland/.test(text), text);
  });

  it('blanks a value in extended XMP, even split between two of its segments', () => {
    const packet = '<x:xmpmeta><rdf:Description exif:GPSLatitude="12,34.5N" dc:format="image/jpeg"/></x:xmpmeta>';
    const cut = packet.indexOf('34.5N');
    const guid = 'A'.repeat(32);
    const before = jpeg(
      xmpExt(guid, packet.length, 0, packet.slice(0, cut)),
      xmpExt(guid, packet.length, cut, packet.slice(cut)),
      sof(10, 10)
    );
    const r = scrubLocation(before);
    const text = r.buf.toString('latin1');
    assert.equal(r.buf.length, before.length);
    assert.ok(!text.includes('12,') && !text.includes('34.5N'), text);
    assert.ok(text.includes('dc:format="image/jpeg"'));
  });

  it('blanks the place fields of IPTC-IIM in a Photoshop block, and keeps the caption', () => {
    const before = jpeg(
      app13([
        [2, 90, 'Somewhere'],
        [2, 92, 'Example Lane 1'],
        [2, 101, 'Nowhereland'],
        [2, 120, 'Plate 3 on day 4']
      ]),
      sof(10, 10)
    );
    const r = scrubLocation(before);
    const text = r.buf.toString('latin1');
    assert.equal(r.iimValues, 3);
    assert.equal(r.locationRemoved, true);
    assert.ok(!/Somewhere|Example Lane|Nowhereland/.test(text), text);
    assert.ok(text.includes('Plate 3 on day 4'));
    assert.equal(r.buf.length, before.length);
  });

  it('refuses what is not a JPEG', () => {
    assert.throws(() => scrubLocation(Buffer.from('PNG...')), /not a JPEG/);
  });
});

describe('jpegSize and isJpeg', () => {
  it('reads the frame size past the metadata, turned as the picture is shown', () => {
    // Stored 4032 × 3024 with orientation 6: a portrait photo, 3024 × 4032.
    assert.deepEqual(jpegSize(jpeg(exif(true), xmp('<x/>'), sof(4032, 3024))), { width: 3024, height: 4032 });
    assert.deepEqual(jpegSize(jpeg(exif(false, { orientation: 8 }), sof(4032, 3024))), { width: 3024, height: 4032 });
    assert.deepEqual(jpegSize(jpeg(exif(true, { orientation: 1 }), sof(4032, 3024))), { width: 4032, height: 3024 });
    assert.deepEqual(jpegSize(jpeg(sof(640, 480))), { width: 640, height: 480 }, 'no EXIF, as stored');
  });

  it('says null rather than inventing a size', () => {
    assert.equal(jpegSize(jpeg(exif(true))), null);
    assert.equal(jpegSize(Buffer.from('hello')), null);
  });

  it('knows a JPEG by its first bytes', () => {
    assert.equal(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
    assert.equal(isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47])), false);
  });
});
