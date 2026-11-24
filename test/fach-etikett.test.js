'use strict';
// Das Etikett eines Fachs (vorher "Brett").
//
// Oben links ein schwarzes Band mit Raum und Regal, rechts oben der QR-Code mit
// der Nummer darunter, und das Fach groß in der Mitte zwischen Band und unterem
// Rand. Die Art steht nicht darauf: ein freies Regal nimmt auch mal eine andere,
// und das Etikett soll dann nicht falsch sein. Die anderen Etiketten, die
// shelfLabelCanvas zeichnet (Regal-Artikel, Laborfächer), bleiben, wie sie sind.
//
// Alle Namen und Nummern hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const DE = (() => {
  const w = {};
  new Function('window', quelle('lang/de.js'))(w);
  return w.LANG.de;
})();
const EN = (() => {
  const w = {};
  new Function('window', quelle('lang/en.js'))(w);
  return w.LANG.en;
})();
const tVon = (tab) => (k, p) => String(tab[k] || k).replace(/\{(\w+)\}/g, (_, n) => (p && n in p ? p[n] : ''));

describe('brettEtikett: was auf das Etikett eines Fachs kommt', () => {
  const etikett = (tab) =>
    new Function(
      't',
      `const rackVon = () => ({ zoneId: 'Z9', strainId: 3 });
      const brettVon = (ort) => ({ rackId: 'Z9_R2', level: Number(ort.split(':')[1]) });
      const brettArt = () => ({ name: 'Testpilz' });
      const barcodeByEntity = new Map([['brett:Z9_R2:3', 4711]]);
      const zoneDisplayName = () => 'Testraum';
      ${hebeFunktion('rackLabel', APP)}
      ${hebeFunktion('brettEtikett', APP)}
      return brettEtikett('Z9_R2:3');`
    )(tVon(tab));

  it('Raum und Regal im Band, das Fach groß und mittig, der QR-Code oben', () => {
    assert.deepEqual(etikett(DE), {
      barcode: 4711,
      band: 'Testraum\nRegal 2',
      etikett: 'Fach 3',
      namePx: 60,
      qrOben: true,
      mitte: true
    });
  });
  it('keine Art, auch wenn das Regal eine trägt', () => {
    assert.doesNotMatch(JSON.stringify(etikett(DE)), /Testpilz/);
  });
  it('auf Englisch bleibt es Shelf', () => {
    assert.equal(etikett(EN).etikett, 'Shelf 3');
  });
});

describe('shelfLabelCanvas: die Lage von QR-Code, Nummer und Text', () => {
  // Eine Leinwand, die mitschreibt, wo was hinkommt. Die Schrift misst sie mit
  // festen Anteilen der Schriftgröße: ein Zeichen ist 0,55 breit, und bei
  // textBaseline "top" schwärzt eine Zeile von 0,2 bis 0,9 unter ihrem y.
  function zeichne(item) {
    const rechtecke = [];
    const texte = [];
    const stapel = [];
    let lage = { x: 0, y: 0, s: 1 };
    const px = () => Number((ctx.font.match(/(\d+)px/) || [0, 0])[1]);
    const ctx = {
      fillStyle: '#000',
      font: '10px sans-serif',
      textBaseline: 'alphabetic',
      textAlign: 'start',
      fillRect: (x, y, w, h) => rechtecke.push({ x: lage.x + x * lage.s, y: lage.y + y, w, h, farbe: ctx.fillStyle }),
      fillText: (text, x, y) =>
        texte.push({ text, x: lage.x + x * lage.s, y: lage.y + y, px: px(), align: ctx.textAlign }),
      measureText: (text) => ({
        width: text.length * px() * 0.55,
        actualBoundingBoxAscent: -0.2 * px(),
        actualBoundingBoxDescent: 0.9 * px()
      }),
      save: () => stapel.push({ ...lage }),
      restore: () => (lage = stapel.pop()),
      translate: (x, y) => (lage = { x: lage.x + x, y: lage.y + y, s: lage.s }),
      scale: (sx) => (lage = { ...lage, s: lage.s * sx }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {}
    };
    const document = {
      createElement: (tag) => (tag === 'canvas' ? { getContext: () => ctx } : {})
    };
    // Ein QR-Code aus 21 Modulen, nur das erste dunkel: so sieht man, wo er beginnt.
    function QRCode() {
      this._oQRCode = { getModuleCount: () => 21, isDark: (r, c) => r === 0 && c === 0 };
    }
    QRCode.CorrectLevel = { M: 0 };
    new Function(
      'document',
      'QRCode',
      'item',
      `const labelDims = { widthDots: 400, heightDots: 240 };
      const etikettBild = () => {};
      ${hebeFunktion('_shelfWrap', APP)}
      ${hebeFunktion('shelfLabelCanvas', APP)}
      shelfLabelCanvas(item);`
    )(document, QRCode, item);
    // 21 Module zu 7 Punkten: 147 breit, rechts 14 vom Rand, also ab x = 239.
    const qr = rechtecke.find((r) => r.x === 239 && r.w === 7);
    return { qr, texte };
  }

  it('Fach: der QR-Code oben, so weit vom Rand wie rechts, die Nummer mittig darunter', () => {
    const { qr, texte } = zeichne({
      barcode: 4711,
      band: 'Testraum\nRegal 2',
      etikett: 'Fach 3',
      namePx: 60,
      qrOben: true,
      mitte: true
    });
    assert.equal(qr.y, 14);
    const nummer = texte.find((x) => x.text === '4711');
    assert.deepEqual([nummer.x, nummer.y, nummer.align], [239 + 147 / 2, 14 + 147 + 26, 'center']);
  });
  it('Fach: der Text groß und mittig zwischen Band und unterem Rand', () => {
    const { texte } = zeichne({
      barcode: 4711,
      band: 'Testraum\nRegal 2',
      etikett: 'Fach 3',
      namePx: 60,
      qrOben: true,
      mitte: true
    });
    const fach = texte.find((x) => x.text === 'Fach 3');
    assert.equal(fach.px, 60);
    assert.equal(fach.x, 12, 'links bündig mit dem Band');
    // Geschwärzt von y + 12 bis y + 54; die Mitte liegt zwischen Band (81) und Rand (240).
    const mitte = fach.y + (0.2 * 60 + 0.9 * 60) / 2;
    assert.ok(Math.abs(mitte - (81 + 240) / 2) <= 1, 'Mitte bei ' + mitte);
  });
  it('zwei Zeilen stehen zusammen in der Mitte', () => {
    // "Testname" passt erst eine Stufe kleiner (48) in die Breite, in zwei Zeilen.
    const { texte } = zeichne({
      barcode: 4711,
      band: 'Testraum',
      etikett: 'Fach Testname',
      namePx: 60,
      qrOben: true,
      mitte: true
    });
    const zeilen = texte.filter((x) => x.px >= 40);
    assert.deepEqual(
      zeilen.map((z) => [z.text, z.px]),
      [
        ['Fach', 48],
        ['Testname', 48]
      ]
    );
    const lh = zeilen[1].y - zeilen[0].y;
    const mitte = (zeilen[0].y + 0.2 * zeilen[0].px + zeilen[1].y + 0.9 * zeilen[1].px) / 2;
    assert.ok(lh > 0 && Math.abs(mitte - (81 + 240) / 2) <= 1, 'Mitte bei ' + mitte);
    assert.ok(zeilen[1].y + 0.9 * zeilen[1].px <= 240, 'nichts läuft unten heraus');
  });
  it('andere Etiketten bleiben, wie sie sind: QR-Code mittig, Nummer unten links, Text unter dem Band', () => {
    const { qr, texte } = zeichne({ barcode: 55, band: 'Testband', etikett: 'Testartikel' });
    assert.equal(qr.y, Math.floor((240 - 147) / 2));
    const nummer = texte.find((x) => x.text === '55');
    assert.deepEqual([nummer.x, nummer.y, nummer.align], [12, 230, 'start']);
    assert.equal(texte.find((x) => x.text === 'Testartikel').y, 92);
  });
});

describe('Fach statt Brett', () => {
  it('kein deutscher Text sagt mehr Brett', () => {
    const alt = Object.entries(DE).filter(([, v]) => /Brett/.test(String(v)));
    assert.deepEqual(alt, []);
  });
  it('das Regal-Blatt sagt Fächer, auch bevor die Sprache geladen ist', () => {
    const html = quelle('index.html');
    assert.match(html, /<span data-i18n="rackEdit\.levels">Fächer<\/span>/);
    assert.match(html, new RegExp(DE['rackEdit.help'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(DE['brett.levelN'], 'Fach {n}');
    assert.equal(DE['bretter.free'], 'In keinem Fach');
  });
});
