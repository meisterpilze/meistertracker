'use strict';
// Das Etikett eines Fachs (vorher "Brett"), hochkant.
//
// Man dreht es um 90° und klebt es stehend an. Stehend gelesen, von oben nach
// unten: das schwarze Band mit Raum und Regal, klein das Wort "Fach", groß die
// Nummer, unten der QR-Code mit der Nummer zum Abtippen. Die Art steht nicht
// darauf: ein freies Regal nimmt auch mal eine andere, und das Etikett soll dann
// nicht falsch sein. Die anderen Etiketten, die shelfLabelCanvas zeichnet
// (Regal-Artikel, Laborfächer), bleiben liegend, wie sie sind.
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

  it('Raum und Regal fürs Band, Wort und Nummer des Fachs getrennt', () => {
    assert.deepEqual(etikett(DE), {
      barcode: 4711,
      band: 'Testraum\nRegal 2',
      wort: 'Fach',
      nummer: '3'
    });
  });
  it('keine Art, auch wenn das Regal eine trägt', () => {
    assert.doesNotMatch(JSON.stringify(etikett(DE)), /Testpilz/);
  });
  it('auf Englisch bleibt es Shelf', () => {
    assert.equal(etikett(EN).wort, 'Shelf');
  });
});

// Eine Leinwand mit echten Punkten (je Punkt ein Grauwert), die außerdem
// mitschreibt, wo was hinkommt. Die Schrift misst sie mit festen Anteilen der
// Schriftgröße: ein Zeichen ist 0,55 breit, Ziffern und Großbuchstaben
// schwärzen bei textBaseline "alphabetic" 0,72 über der Grundlinie, darunter
// nichts.
function leinwand() {
  const rechtecke = [];
  const texte = [];
  const leinwaende = [];
  const document = {
    createElement(tag) {
      if (tag !== 'canvas') return {};
      const cv = { width: 0, height: 0 };
      leinwaende.push(cv);
      cv.getContext = () => cv.ctx || (cv.ctx = kontext(cv));
      return cv;
    }
  };
  function kontext(cv) {
    const W = cv.width;
    const H = cv.height;
    const punkte = new Uint8ClampedArray(W * H * 4).fill(255);
    const stapel = [];
    let lage = { x: 0, y: 0, s: 1 };
    const px = () => Number((ctx.font.match(/(\d+)px/) || [0, 0])[1]);
    const ctx = {
      fillStyle: '#000',
      font: '10px sans-serif',
      textBaseline: 'alphabetic',
      textAlign: 'start',
      fillRect(x, y, w, h) {
        const r = { x: lage.x + x * lage.s, y: lage.y + y, w, h, farbe: ctx.fillStyle, cv };
        rechtecke.push(r);
        const v = ctx.fillStyle === '#fff' ? 255 : 0;
        for (let yy = Math.max(0, r.y); yy < Math.min(H, r.y + h); yy++)
          for (let xx = Math.max(0, r.x); xx < Math.min(W, r.x + w); xx++)
            punkte.fill(v, (yy * W + xx) * 4, (yy * W + xx) * 4 + 3);
      },
      fillText: (text, x, y) =>
        texte.push({ text, x: lage.x + x * lage.s, y: lage.y + y, px: px(), s: lage.s, align: ctx.textAlign }),
      measureText: (text) => ({
        width: text.length * px() * 0.55,
        actualBoundingBoxAscent: 0.72 * px(),
        actualBoundingBoxDescent: 0
      }),
      save: () => stapel.push({ ...lage }),
      restore: () => (lage = stapel.pop()),
      translate: (x, y) => (lage = { x: lage.x + x, y: lage.y + y, s: lage.s }),
      scale: (sx) => (lage = { ...lage, s: lage.s * sx }),
      getImageData: () => ({ data: new Uint8ClampedArray(punkte) }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img) => punkte.set(img.data),
      punkt: (x, y) => punkte[(y * W + x) * 4]
    };
    return ctx;
  }
  return { document, rechtecke, texte, leinwaende };
}

// Ein QR-Code aus 21 Modulen, nur das erste dunkel: so sieht man, wo er beginnt.
function QRCode() {
  this._oQRCode = { getModuleCount: () => 21, isDark: (r, c) => r === 0 && c === 0 };
}
QRCode.CorrectLevel = { M: 0 };

const BAND_HOCH = APP.match(/^const FACH_BAND_HOCH = \d+;$/m)[0];
const heben = (namen) => namen.map((f) => hebeFunktion(f, APP)).join('\n');

describe('fachEtikettCanvas: das Fach-Etikett hochkant', () => {
  function zeichne(item) {
    const l = leinwand();
    const cv = new Function(
      'document',
      'QRCode',
      'item',
      `const labelDims = { widthDots: 400, heightDots: 240 };
      ${BAND_HOCH}
      ${heben(['_bandZeilen', '_qrModule', '_qrZeichnen', '_nurSchwarzWeiss', 'fachEtikettCanvas', 'fachEtikettQuer'])}
      return fachEtikettCanvas(item);`
    )(l.document, QRCode, item);
    return { ...l, cv, stehend: l.leinwaende[0] };
  }
  const FACH = { barcode: 4711, band: 'Testraum\nRegal 2', wort: 'Fach', nummer: '3' };

  it('gedruckt wird liegend, auf das Etikett 400 × 240', () => {
    const { cv, stehend } = zeichne(FACH);
    assert.deepEqual([stehend.width, stehend.height], [240, 400]);
    assert.deepEqual([cv.width, cv.height], [400, 240]);
  });
  it('oben das Band über die ganze Breite, Raum und Regal mittig darin (mit Zahl bleibt es, wie es ist)', () => {
    const { rechtecke, texte, stehend } = zeichne(FACH);
    const band = rechtecke.find((r) => r.cv === stehend && r.farbe === '#000' && r.w === 240);
    assert.deepEqual([band.x, band.y, band.h], [0, 0, 76]);
    const zeilen = texte.filter((x) => x.px === 24);
    assert.deepEqual(
      zeilen.map((z) => [z.text, z.x, z.align]),
      [
        ['TESTRAUM', 120, 'center'],
        ['Regal 2', 120, 'center']
      ]
    );
    assert.ok(zeilen.every((z) => z.y > 0 && z.y + 24 < 76));
  });
  it('unten der QR-Code mittig, die Nummer darunter', () => {
    const { rechtecke, texte } = zeichne(FACH);
    // 21 Module zu 7 Punkten: 147 breit, mittig ab x = 46; unten 10 Rand und 26 für die Nummer.
    const qr = rechtecke.find((r) => r.w === 7);
    assert.deepEqual([qr.x, qr.y], [46, 400 - 10 - 26 - 147]);
    const nummer = texte.find((x) => x.text === '4711');
    assert.deepEqual([nummer.x, nummer.y, nummer.align], [120, 390, 'center']);
  });
  it('das Wort klein, die Nummer groß, zusammen mittig zwischen Band und QR-Code', () => {
    const { texte } = zeichne(FACH);
    const wort = texte.find((x) => x.text === 'Fach');
    const nummer = texte.find((x) => x.text === '3');
    assert.deepEqual([wort.px, wort.x], [30, 120]);
    assert.deepEqual([nummer.px, nummer.x], [104, 120]);
    const oben = wort.y - 0.72 * 30;
    assert.ok(wort.y < nummer.y - 0.72 * 104, 'das Wort steht über der Nummer');
    const mitte = (oben + nummer.y) / 2;
    assert.ok(Math.abs(mitte - (76 + 217) / 2) <= 1, 'Mitte bei ' + mitte);
  });
  it('ein langes Wort wird schmaler gezogen, nicht über den Rand', () => {
    const { texte } = zeichne({ ...FACH, wort: 'Testwortlaenger' });
    const w = texte.find((x) => x.text === 'Testwortlaenger');
    // 15 Zeichen zu 30 × 0,55 sind 247 breit; mittig gesetzt und auf 216 gestaucht.
    assert.equal(w.x, 120);
    assert.ok(Math.abs(15 * 30 * 0.55 * w.s - 216) < 0.01, 'breit ' + 15 * 30 * 0.55 * w.s);
    assert.equal(texte.find((x) => x.text === '3').s, 1, 'die Nummer bleibt, wie sie ist');
  });
  it('gedreht: stehend oben liegt links, der QR-Code liegt rechts', () => {
    const { cv } = zeichne(FACH);
    const ctx = cv.getContext('2d');
    // Das Band (stehend y 0..75) ist liegend der linke Streifen.
    assert.equal(ctx.punkt(10, 120), 0);
    assert.equal(ctx.punkt(75, 0), 0);
    assert.equal(ctx.punkt(76, 120), 255);
    // Das erste Modul (stehend x 46..52, y 217..223) liegt liegend bei x 217..223, y 193..187.
    assert.equal(ctx.punkt(217, 239 - 46), 0);
    assert.equal(ctx.punkt(217 + 6, 239 - 46 - 6), 0);
    assert.equal(ctx.punkt(217 + 7, 239 - 46), 255);
  });
});

describe('shelfLabelCanvas: andere Etiketten bleiben liegend, wie sie sind', () => {
  it('QR-Code mittig rechts, Nummer unten links, Text unter dem Band', () => {
    const l = leinwand();
    new Function(
      'document',
      'QRCode',
      `const labelDims = { widthDots: 400, heightDots: 240 };
      const etikettBild = () => {};
      ${heben(['_shelfWrap', '_bandZeilen', '_qrModule', '_qrZeichnen', '_nurSchwarzWeiss', 'shelfLabelCanvas'])}
      shelfLabelCanvas({ barcode: 55, band: 'Testband', etikett: 'Testartikel' });`
    )(l.document, QRCode);
    // 21 Module zu 7 Punkten: 147 breit, rechts 14 vom Rand, also ab x = 239.
    const qr = l.rechtecke.find((r) => r.x === 239 && r.w === 7);
    assert.equal(qr.y, Math.floor((240 - 147) / 2));
    const nummer = l.texte.find((x) => x.text === '55');
    assert.deepEqual([nummer.x, nummer.y, nummer.align], [12, 230, 'start']);
    assert.equal(l.texte.find((x) => x.text === 'Testartikel').y, 92);
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
