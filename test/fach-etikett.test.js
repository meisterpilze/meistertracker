'use strict';
// Das Etikett eines Fachs (vorher "Brett"), hochkant.
//
// Man dreht es um 90° und klebt es stehend an. Stehend gelesen, von oben nach
// unten: das schwarze Band mit Raum und Regal, die Nummer des Fachs so groß es
// geht (ohne das Wort "Fach"), unten der QR-Code (ohne Nummer: er wird nur gescannt).
// Band und Nummer sind in Fredoka, die mit der App kommt. Die Art steht nicht
// darauf: ein freies Regal nimmt auch mal eine andere, und das Etikett soll dann
// nicht falsch sein. Die anderen Etiketten, die shelfLabelCanvas zeichnet
// (Regal-Artikel, Laborfächer), bleiben liegend, wie sie sind.
//
// Alle Namen und Nummern hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');

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

  it('Raum und Regal fürs Band, die Nummer des Fachs, kein Wort "Fach"', () => {
    assert.deepEqual(etikett(DE), {
      barcode: 4711,
      band: 'Testraum\nRegal 2',
      nummer: '3'
    });
  });
  it('keine Art, auch wenn das Regal eine trägt', () => {
    assert.doesNotMatch(JSON.stringify(etikett(DE)), /Testpilz/);
  });
  it('auf Englisch heißt nur das Regal anders', () => {
    assert.equal(etikett(EN).band, 'Testraum\n' + EN['dash.rackN'].replace('{n}', '2'));
  });
});

describe('Fredoka: die Schrift der Fach-Etiketten kommt mit der App', () => {
  const fs = require('fs');
  const path = require('path');
  const lib = (f) => path.join(__dirname, '..', 'lib', f);
  it('die Dateien und die Lizenz liegen in lib/, NOTICE nennt sie', () => {
    for (const f of ['fredoka-latin-700-normal.woff2', 'fredoka-latin-ext-700-normal.woff2', 'OFL-Fredoka.txt'])
      assert.ok(fs.existsSync(lib(f)), f);
    assert.match(quelle('NOTICE'), /Fredoka[\s\S]*SIL Open Font License[\s\S]*lib\/OFL-Fredoka\.txt/);
  });
  it('styles.css meldet sie an, fett', () => {
    const css = quelle('styles.css');
    for (const f of ['fredoka-latin-700-normal.woff2', 'fredoka-latin-ext-700-normal.woff2'])
      assert.match(
        css,
        new RegExp("font-family: 'Fredoka';[^}]*font-weight: 700;[^}]*/lib/" + f.replace(/\./g, '\\.'))
      );
  });
  it('vor dem Zeichnen wird sie geladen, für den Text, der auf die Etiketten kommt', () => {
    const f = hebeFunktion('brettEtikettenDrucken', APP);
    const laden = f.indexOf('await fachEtikettSchrift(');
    assert.ok(laden > 0 && laden < f.indexOf('fachEtikettCanvas('), 'erst laden, dann zeichnen');
    assert.match(hebeFunktion('fachEtikettSchrift', APP), /document\.fonts\.load\('bold 100px Fredoka', text/);
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
        texte.push({
          text,
          x: lage.x + x * lage.s,
          y: lage.y + y,
          px: px(),
          s: lage.s,
          align: ctx.textAlign,
          font: ctx.font
        }),
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
// Die verlangte Fehlerkorrektur merkt er sich (Werte wie in qrcode.min.js).
let stufe;
function QRCode(div, opt) {
  stufe = opt.correctLevel;
  this._oQRCode = { getModuleCount: () => 21, isDark: (r, c) => r === 0 && c === 0 };
}
QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };

// Alle Konstanten des Fach-Etiketts, wie sie in app.js stehen.
const BAND_HOCH = APP.match(/^const FACH_[A-Z_]+ = .*;$/gm).join('\n');
// Stehend 256 × 456 (32 × 57 mm), alles um FACH_LINKS (5) nach links
// verschoben: die Mitte ist 123.
const MITTE = 128 - 5;
const heben = (namen) => namen.map((f) => hebeFunktion(f, APP)).join('\n');

describe('fachEtikettCanvas: das Fach-Etikett hochkant', () => {
  function zeichne(item) {
    const l = leinwand();
    const cv = new Function(
      'document',
      'QRCode',
      'item',
      `${BAND_HOCH}
      ${heben(['_bandZeilen', '_qrModule', '_qrZeichnen', '_nurSchwarzWeiss', 'fachEtikettCanvas', 'fachEtikettQuer'])}
      return fachEtikettCanvas(item);`
    )(l.document, QRCode, item);
    return { ...l, cv, stehend: l.leinwaende[0] };
  }
  const FACH = { barcode: 4711, band: 'Testraum\nRegal 2', nummer: '3' };

  it('auf die ganze Rolle: stehend 256 × 456, gedruckt liegend 456 × 256', () => {
    const { cv, stehend } = zeichne(FACH);
    assert.deepEqual([stehend.width, stehend.height], [256, 456]);
    assert.deepEqual([cv.width, cv.height], [456, 256]);
  });
  it('oben das Band, 12 vom Rand, Raum und Regal mittig darin (mit Zahl bleibt es, wie es ist)', () => {
    const { rechtecke, texte, stehend } = zeichne(FACH);
    const band = rechtecke.find((r) => r.cv === stehend && r.farbe === '#000' && r.h === 76);
    assert.deepEqual([band.x, band.y, band.w], [12 - 5, 12, 256 - 24]);
    const zeilen = texte.filter((x) => x.px === 24);
    assert.deepEqual(
      zeilen.map((z) => [z.text, z.x, z.align]),
      [
        ['TESTRAUM', MITTE, 'center'],
        ['Regal 2', MITTE, 'center']
      ]
    );
    assert.ok(zeilen.every((z) => z.y > 12 && z.y + 24 < 12 + 76));
    assert.ok(zeilen.every((z) => /^bold 24px Fredoka, Arial/.test(z.font)));
  });
  it('unten der QR-Code mittig, 6 Punkte je Modul, 44 über dem Rand, ohne Nummer darunter', () => {
    const { rechtecke, texte } = zeichne(FACH);
    // 21 Module zu 6 Punkten: 126 breit (16 mm), mittig ab x = 65, verschoben 60.
    const qr = rechtecke.find((r) => r.w === 6);
    assert.deepEqual([qr.x, qr.y], [60, 456 - 44 - 126]);
    assert.equal(
      texte.find((x) => x.text === '4711'),
      undefined,
      'ein Fach-Code wird nur gescannt'
    );
  });
  it('der QR-Code mit Fehlerkorrektur Q: er biegt sich um einen runden Pfosten', () => {
    zeichne(FACH);
    assert.equal(stufe, QRCode.CorrectLevel.Q);
  });
  it('rund um den QR-Code vier Module weiß, zum unteren Rand noch 12 Punkte mehr', () => {
    const { rechtecke, texte } = zeichne(FACH);
    const qr = rechtecke.find((r) => r.w === 6);
    const ruhe = 4 * 6;
    // Zum unteren Rand: Ruhezone und Luft für ein um 1,5 mm verschobenes Etikett.
    assert.ok(456 - (qr.y + 126) >= ruhe + 12, 'unten');
    // Zu den Seiten des Etiketts (stehend 0..256, alles 5 nach links verschoben).
    assert.ok(qr.x >= ruhe && 256 - 5 - (qr.x + 126) >= ruhe, 'Seiten');
    // Zur Nummer: ihr unterster schwarzer Punkt liegt vor der Ruhezone.
    const nummer = texte.find((x) => x.text === '3');
    assert.ok(nummer.y <= qr.y - ruhe, 'Nummer bei ' + nummer.y);
  });
  it('die Nummer so groß es geht, mittig zwischen Band und QR-Code, zum QR-Code mehr Luft', () => {
    const { texte } = zeichne(FACH);
    assert.equal(
      texte.find((x) => x.text === 'Fach'),
      undefined,
      'kein Wort "Fach"'
    );
    const nummer = texte.find((x) => x.text === '3');
    // Platz: von 12 + 76 + 12 bis 286 - 24 (die Ruhezone des QR-Codes), also
    // 162 hoch; Ziffern schwärzen 0,72 der Größe.
    const px = Math.floor((100 * 162) / 72);
    assert.deepEqual([nummer.px, nummer.x, nummer.s], [px, MITTE, 1]);
    assert.match(nummer.font, /^bold \d+px Fredoka, Arial/);
    const oben = nummer.y - 0.72 * px;
    assert.ok(oben >= 100 - 1 && nummer.y <= 262 + 1, 'nichts reicht in Band oder QR-Code');
    assert.ok(Math.abs((oben + nummer.y) / 2 - (100 + 262) / 2) <= 1, 'mittig');
  });
  it('eine Nummer, die zu breit wäre, wird kleiner, bis sie in die Breite passt', () => {
    const { texte } = zeichne({ ...FACH, nummer: '1234567' });
    const n = texte.find((x) => x.text === '1234567');
    // 7 Zeichen zu 0,55: bei 100 sind es 385, Platz ist 256 - 24 = 232.
    assert.deepEqual([n.px, n.s], [Math.floor((100 * 232) / 385), 1]);
  });
  it('ohne Nummer bleibt die Mitte leer, statt abzustürzen', () => {
    const { texte } = zeichne({ ...FACH, nummer: '' });
    assert.ok(texte.every((x) => x.px < 30));
  });
  it('gedreht: stehend oben liegt links, der QR-Code liegt rechts', () => {
    const { cv } = zeichne(FACH);
    const ctx = cv.getContext('2d');
    // Stehend (x, y) liegt liegend bei (y, 255 - x). Das Band (stehend x 7..238,
    // y 12..87) ist liegend ein Streifen links, mit weißem Rand rundherum.
    assert.equal(ctx.punkt(50, 128), 0);
    assert.equal(ctx.punkt(5, 128), 255);
    assert.equal(ctx.punkt(95, 128), 255);
    assert.equal(ctx.punkt(50, 255 - 242), 255);
    // Das erste Modul (stehend x 60..65, y 286..291) liegt liegend bei x 286..291, y 195..190.
    assert.equal(ctx.punkt(286, 255 - 60), 0);
    assert.equal(ctx.punkt(286 + 5, 255 - 60 - 5), 0);
    assert.equal(ctx.punkt(286 + 6, 255 - 60), 255);
  });
});

describe('shelfLabelCanvas: andere Etiketten bleiben liegend, wie sie sind', () => {
  // Gezeichnet wird auf die ganze Rolle (456 × 256), das Etikett darin 12 vom
  // Rand an den Seiten und 8 oben und unten, also innen 432 × 240, und um die
  // 5 Punkte tiefer, die der Drucker es zu hoch legt. Die Zahlen unten sind
  // innen gemessen; DX und DY rechnen sie auf die Rolle um.
  const DX = 12;
  const DY = 8 + 5;
  it('QR-Code mittig rechts, Nummer unten links, Text unter dem Band', () => {
    const l = leinwand();
    new Function(
      'document',
      'QRCode',
      `const labelDims = { widthDots: 456, heightDots: 256 };
      ${APP.match(/^const LABEL_RUNTER = \d+;$/m)[0]}
      ${hebeKonstante('SHELF_RAND', APP)}
      const etikettBild = () => {};
      ${heben(['_shelfWrap', '_bandZeilen', '_qrModule', '_qrZeichnen', '_nurSchwarzWeiss', 'shelfLabelCanvas'])}
      shelfLabelCanvas({ barcode: 55, band: 'Testband', etikett: 'Testartikel' });`
    )(l.document, QRCode);
    assert.deepEqual([l.leinwaende[0].width, l.leinwaende[0].height], [456, 256]);
    // 21 Module zu 7 Punkten: 147 breit, rechts 14 vom Rand, also innen ab x = 271.
    const qr = l.rechtecke.find((r) => r.x === DX + 271 && r.w === 7);
    assert.equal(qr.y, DY + Math.floor((240 - 147) / 2));
    const nummer = l.texte.find((x) => x.text === '55');
    assert.deepEqual([nummer.x, nummer.y, nummer.align], [DX + 12, DY + 230, 'start']);
    assert.equal(l.texte.find((x) => x.text === 'Testartikel').y, DY + 92);
    // Das Band beginnt innen bei 0, auf der Rolle also 12 vom Rand und unter dem oberen Rand.
    assert.ok(
      l.rechtecke.some((r) => r.x === DX && r.y === DY && r.h === 81 && r.farbe === '#000'),
      'Band'
    );
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
