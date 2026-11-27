'use strict';
// Jede Zeile auf dem Etikett passt in ihr Feld.
//
// Ein Beutel-Etikett wie "Reishi – 2,5kg – Ganoderma multipileum KQ07" ist zu
// lang für eine Zeile. Ein ^FB-Feld für eine Zeile schneidet aber nichts ab:
// der Drucker bricht um und druckt den Rest ÜBER die Zeile — der Stammcode
// stand mitten auf "Ganoderma". Auf demselben Etikett fehlten die zwei
// Gedankenstriche ganz, Schrift 0 hat sie nicht.
//
// Geprüft wird beides, was Etiketten druckt: app.js (Druck aus der App und die
// Vorschau) und mcp-server.js (Druck über die MCP-Werkzeuge). Die Mess- und
// Umbruchfunktionen stehen in beiden wortgleich; der letzte Block hält das so.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');
const mcp = require('../mcp-server.js');

const APP = quelle();
const MCP = quelle('mcp-server.js');

const GEDANKENSTRICH = String.fromCharCode(0x2013);
const AUSLASSUNG = String.fromCharCode(0x2026);
const PFEIL = String.fromCharCode(0x2190);
const NBSP = String.fromCharCode(0xa0);

// Was in beiden Dateien gleich stehen muss, in der Reihenfolge, in der es
// einander braucht.
const KONSTANTEN = ['LABEL_RAND', '_LABEL_EM', '_LABEL_ERSATZ'];
const FUNKTIONEN = [
  '_lineBlockW',
  'labelTextW',
  'labelGlyphs',
  'labelWrap',
  'labelLines',
  'labelLayout',
  '_labelBarcode',
  '_labelQr',
  'labelNotiz'
];
const runter = (src) => src.match(/^const LABEL_RUNTER = \d+;$/m)[0];
// Die Rolle: 57 × 32 mm, und die Ränder, in denen nichts steht.
const W = 456;
const H = 256;
const RAND = { seite: 20, oben: 12, unten: 12 };

// app.js hat keine Modulgrenze: die Etiketten-Funktionen werden herausgehoben
// und gegen Attrappen gebaut. barcodeByEntity bleibt leer, also druckt jedes
// Etikett den Ersatz-Code aus der Nummer — für den Text darunter egal.
const APP_E = new Function(
  [
    'const barcodeByEntity = new Map();',
    'const labelDims = { widthDots: ' + W + ', heightDots: ' + H + ' };',
    'let _labelEmMap = null;',
    runter(APP),
    hebeKonstante('_BADGE', APP),
    ...KONSTANTEN.map((k) => hebeKonstante(k, APP)),
    ...['bcParams', 'fmtDt', 'labelKg', '_bagTotalBadge', ...FUNKTIONEN].map((f) => hebeFunktion(f, APP)),
    ...['bagLabelItems', 'labLabelItems', 'zplText', 'itemsToZPL'].map((f) => hebeFunktion(f, APP)),
    'return { bagLabelItems, labLabelItems, itemsToZPL, labelTextW };'
  ].join('\n')
)();

// Beide Dateien mit derselben Unterschrift: die in app.js nimmt keine
// Barcode-Nummer, die in mcp-server.js schon.
const DRUCKER = {
  'app.js': {
    beutel: (id, charge, detail, qr, kg) => APP_E.bagLabelItems(id, charge, detail, null, qr, kg),
    kultur: (id, c, detail, qr) => APP_E.labLabelItems(id, c, detail, qr),
    zpl: APP_E.itemsToZPL
  },
  'mcp-server.js': {
    beutel: (id, charge, detail, qr, kg) => mcp.bagLabelItems(id, charge, detail, 1000601, qr, kg),
    kultur: (id, c, detail, qr) => mcp.labLabelItems(id, c, detail, 99, qr),
    zpl: mcp.itemsToZPL
  }
};

const BEUTEL = 'RESH-280926-01-04';
const REISHI = {
  batchId: 'RESH-280926-01',
  strainName: 'Reishi',
  strainText: 'Ganoderma multipileum KQ07',
  notes: '',
  bags: ['RESH-280926-01-01', 'RESH-280926-01-02', 'RESH-280926-01-03', BEUTEL],
  created: '2026-09-28T08:36:16Z',
  due: '2026-10-12T08:36:16Z'
};
const texte = (items) => items.filter((i) => i.type === 'text');

describe('Das Reishi-Etikett', () => {
  it('bricht "multipileum KQ07" in die zweite Zeile um, statt es darüber zu drucken', () => {
    const zeilen = texte(APP_E.bagLabelItems(BEUTEL, REISHI, 'sorte', null, false, 2.5)).map((i) => i.text);
    // "/4" ist der Zähler unten rechts, er steht zuerst in der Liste.
    assert.deepEqual(zeilen, ['/4', BEUTEL, 'Reishi - 2,5kg - Ganoderma', 'multipileum KQ07']);
  });

  it('schickt dem Drucker keine Zeile, die er umbrechen müsste', () => {
    for (const [name, d] of Object.entries(DRUCKER)) {
      const zpl = d.zpl(d.beutel(BEUTEL, REISHI, 'sorte', false, 2.5));
      const felder = [...zpl.matchAll(/\^FB(\d+),1,0,C\^A0N,(\d+),(\d+)\^FD([^^]*)\^FS/g)];
      assert.ok(felder.length >= 3, name + ': zu wenige Textfelder');
      for (const f of felder) {
        const breite = mcp.labelTextW(f[4], Number(f[3]));
        assert.ok(breite <= Number(f[1]), name + ': "' + f[4] + '" braucht ' + breite + ' in ' + f[1]);
      }
    }
  });

  it('druckt Striche, Pfeile und Auslassungen mit Zeichen, die Schrift 0 hat', () => {
    const c = { strainName: 'Lions Mane', strainText: 'LQ', notes: 'eine lange Notiz', parentId: 'PD-LM-200926-03' };
    for (const [name, d] of Object.entries(DRUCKER)) {
      const zpl =
        d.zpl(d.beutel(BEUTEL, REISHI, 'full', false, 2.5)) + d.zpl(d.kultur('LC-LM-260926-01', c, 'full', false));
      for (const z of [GEDANKENSTRICH, AUSLASSUNG, PFEIL, NBSP]) {
        assert.ok(!zpl.includes(z), name + ': Zeichen ' + z.charCodeAt(0).toString(16) + ' im Druck');
      }
      // Die Herkunft steht nicht mehr auf dem Etikett; die zeigt der Scan.
      assert.ok(zpl.includes('LC-LM-260926-01'), name + ': die Kennung fehlt');
      assert.ok(!zpl.includes('PD-LM-200926-03'), name + ': die Herkunft steht noch auf dem Etikett');
    }
  });
});

describe('Gemessen wird nie schmaler, als gedruckt wird', () => {
  // Nachgemessen am Foto eines gedruckten Etiketts. Der Strichcode ist 336
  // Punkte breit (7 Stellen, Modul 3) und auf dem Foto 640 Pixel. Die Nummer
  // (24 Punkte hoch) nimmt 450 Pixel ein, "Reishi – 2,5kg – Ganoderma
  // multipileum" 693 — ohne die zwei Striche, die nicht druckten und jetzt als
  // Bindestriche von gut einer halben Schrifthöhe dazukommen.
  const PX_JE_PUNKT = 640 / 336;

  it('eine Nummer aus Großbuchstaben, Ziffern und Bindestrichen', () => {
    assert.ok(mcp.labelTextW(BEUTEL, 24) >= 450 / PX_JE_PUNKT);
  });

  it('eine Zeile in Kleinbuchstaben', () => {
    assert.ok(mcp.labelTextW('Reishi - 2,5kg - Ganoderma multipileum', 24) >= 693 / PX_JE_PUNKT + 2 * 13);
  });

  it('ein Zeichen, das nicht in der Liste steht, zählt ganz breit', () => {
    assert.equal(mcp.labelTextW(String.fromCharCode(0x263a), 20), 21);
  });

  it('ein Umlaut zählt wie sein Grundbuchstabe', () => {
    assert.equal(mcp.labelTextW('Fällig', 24), mcp.labelTextW('Fallig', 24));
  });
});

describe('labelWrap', () => {
  const breit = (w) => () => w;

  it('setzt den Trennstrich zwischen zwei Angaben nie an den Rand einer Zeile', () => {
    assert.deepEqual(mcp.labelWrap('Aaaa ' + GEDANKENSTRICH + ' Bbbb', 24, breit(120), 2), ['Aaaa', 'Bbbb']);
  });

  it('lässt ihn in der Zeile stehen, als Bindestrich', () => {
    assert.deepEqual(mcp.labelWrap('Aaaa ' + GEDANKENSTRICH + ' Bbbb', 24, breit(394), 2), ['Aaaa - Bbbb']);
  });

  it('hält den Pfeil bei seiner Herkunft', () => {
    assert.deepEqual(mcp.labelWrap('LC-1 ' + PFEIL + NBSP + 'PD-2', 24, breit(120), 2), ['LC-1', '<- PD-2']);
  });

  it('trennt ein Wort, das allein zu lang ist, hinter einem Bindestrich', () => {
    const id = 'G-BPKO-BPKOKQ07-250926-01-03';
    const zeilen = mcp.labelWrap(id, 24, breit(300), 2);
    assert.equal(zeilen.length, 2);
    assert.ok(zeilen[0].endsWith('-'), zeilen[0]);
    assert.equal(zeilen.join(''), id);
  });

  it('kürzt am Wortende, mit drei Punkten, und sagt es', () => {
    const zeilen = mcp.labelWrap(
      'Reishi ' + GEDANKENSTRICH + ' 2,5kg ' + GEDANKENSTRICH + ' Ganoderma multipileum KQ07',
      24,
      breit(394),
      1
    );
    assert.deepEqual([...zeilen], ['Reishi - 2,5kg - Ganoderma...']);
    assert.equal(zeilen.gekuerzt, true);
    assert.equal(mcp.labelWrap('kurz', 24, breit(394), 1).gekuerzt, undefined);
  });

  it('labelGlyphs ersetzt, was Schrift 0 nicht hat', () => {
    const q = (n) => String.fromCharCode(n);
    assert.equal(
      mcp.labelGlyphs(q(0x201e) + 'x' + q(0x201c) + ' ' + q(0x2019) + AUSLASSUNG + q(0x2192)),
      '"x" \'...->'
    );
  });
});

// Jede Kombination, die gedruckt werden kann, mit kurzen und mit viel zu langen
// Angaben. Für jede gilt dasselbe.
const CHARGEN = {
  kurz: {
    id: 'BO-280926-01-01',
    charge: { strainName: 'Blue Oyster', strainText: '', notes: '', bags: ['BO-280926-01-01'], due: '2026-10-12' }
  },
  reishi: { id: BEUTEL, charge: REISHI },
  lang: {
    id: 'G-BPKO-BPKOKQ07-250926-01-03',
    charge: {
      strainName: 'Black Pearl King Oyster',
      strainText: 'BPKOKQ07 mit einem langen Zusatz',
      notes: 'eine sehr lange Notiz, die nicht passt',
      bags: Array.from({ length: 10 }, (_, i) => 'G-BPKO-BPKOKQ07-250926-01-' + String(i + 1).padStart(2, '0')),
      created: '2026-09-25T08:12:54Z',
      due: '2026-10-15T08:12:54Z'
    }
  }
};
const KULTUREN = {
  ohneHerkunft: { id: 'MC-LM-200926-01', c: { strainName: 'Lions Mane', created: '2026-09-20' } },
  mitHerkunft: {
    id: 'LC-LM-LMKQ07TG-260926-01',
    c: {
      strainName: 'Lions Mane',
      strainText: 'LMKQ07 TG',
      notes: 'eine lange Notiz zur Kultur',
      parentId: 'PD-LM-LMKQ07TG-200926-03',
      created: '2026-09-26T08:00:00Z'
    }
  }
};

function pruefe(items, name, nummern) {
  const code = items.find((i) => i.type === 'barcode' || i.type === 'qr');
  assert.ok(code, name + ': kein Code');
  const zaehler = items.find((i) => i.type === 'text' && /^\/\d+$/.test(i.text));
  // Neben einem QR-Code steht der Kommentar; alles andere steht unter dem Code.
  const istNeben = (i) => code.type === 'qr' && i !== zaehler && i.x >= code.x + code.size;
  const neben = texte(items)
    .filter(istNeben)
    .sort((a, b) => a.y - b.y);
  const zeilen = texte(items)
    .filter((i) => i !== zaehler && !istNeben(i))
    .sort((a, b) => a.y - b.y);
  // Neben dem Code: nicht höher und nicht tiefer als er, und keine Zeile auf
  // der anderen.
  let nebenOben = code.y;
  for (const z of neben) {
    assert.ok(z.y >= nebenOben, name + ': "' + z.text + '" überdeckt die Zeile darüber, neben dem Code');
    nebenOben = z.y + z.fontH;
  }
  if (neben.length) assert.ok(nebenOben <= code.y + code.size, name + ': Kommentar reicht unter den Code');
  for (const z of zeilen.concat(neben, zaehler ? [zaehler] : [])) {
    const breite = mcp.labelTextW(z.text, z.fontH);
    assert.ok(breite <= z.blockW - 6, name + ': "' + z.text + '" braucht ' + breite + ' von ' + z.blockW);
  }
  // Nichts steht im Rand: die Ecken sind rund, und an den Rand druckt der
  // Drucker nicht genau.
  for (const z of texte(items)) {
    assert.ok(z.x >= RAND.seite && z.x + z.blockW <= W - RAND.seite, name + ': "' + z.text + '" im Seitenrand');
  }
  assert.ok(code.y >= RAND.oben, name + ': Code im oberen Rand');
  if (code.type === 'qr') assert.ok(code.x >= RAND.seite, name + ': QR-Code im Seitenrand');
  if (zaehler) assert.ok(zaehler.y + 30 <= H - RAND.unten, name + ': Zähler im unteren Rand');
  if (code.type === 'barcode') {
    assert.ok(code.h >= 60 && code.h <= 90, name + ': Strichcode ' + code.h + ' hoch');
  }
  let oben = code.y + (code.h || code.size);
  for (const z of zeilen) {
    assert.ok(z.y >= oben, name + ': "' + z.text + '" überdeckt, was darüber steht');
    oben = z.y + z.fontH;
  }
  assert.ok(oben <= H - RAND.unten, name + ': Text reicht bis ' + oben);
  if (zaehler) {
    for (const z of zeilen) {
      const daneben = z.y < zaehler.y + zaehler.fontH && zaehler.y < z.y + z.fontH;
      if (daneben) assert.ok(z.x + z.blockW <= zaehler.x - 6, name + ': "' + z.text + '" läuft unter den Zähler');
    }
  }
  const alles = zeilen.map((z) => z.text).join('');
  for (const n of nummern) assert.ok(alles.includes(n), name + ': ' + n + ' steht nicht ganz da');
}

describe('Keine Zeile läuft über, keine überdeckt eine andere', () => {
  for (const [datei, d] of Object.entries(DRUCKER)) {
    for (const detail of ['minimal', 'sorte', 'full']) {
      for (const qr of [false, true]) {
        const art = datei + ' ' + detail + (qr ? ' QR' : '');
        it(art + ': Beutel', () => {
          for (const [fall, { id, charge }] of Object.entries(CHARGEN)) {
            pruefe(d.beutel(id, charge, detail, qr, 2.5), art + ' ' + fall, [id]);
          }
        });
        it(art + ': Kulturen', () => {
          for (const [fall, { id, c }] of Object.entries(KULTUREN)) {
            const items = d.kultur(id, c, detail, qr);
            pruefe(items, art + ' ' + fall, [id]);
            // Woraus sie angesetzt ist, zeigt der Scan, nicht das Etikett.
            if (c.parentId) {
              const alles = texte(items)
                .map((z) => z.text)
                .join('');
              assert.ok(!alles.includes(c.parentId), art + ' ' + fall + ': die Herkunft steht auf dem Etikett');
            }
          }
        });
      }
    }
  }

  it('ein kurzes Etikett sieht aus wie immer', () => {
    // Mittig über dem, was darauf steht, Code 90 hoch, Zeilen im Abstand 28 —
    // nur wer zu lang ist, bekommt eine zweite Zeile und dafür Platz.
    const items = mcp.bagLabelItems('BO-280926-01-01', CHARGEN.kurz.charge, 'sorte', 7, false, 2.5);
    assert.deepEqual(
      items.map((i) => [i.type, i.y, i.h || i.fontH]),
      [
        ['barcode', 54, 90],
        ['text', 150, 24],
        ['text', 178, 24]
      ]
    );
  });
  it('vor jedem QR-Code steht die Strichhöhe des Druckers, nicht die vom Etikett davor', () => {
    // Der Drucker setzt einen QR-Code etwa um die ^BY-Höhe unter sein ^FO und
    // behält ^BY vom vorigen Etikett: nach einem Strichcode-Etikett (Höhe 90)
    // lag der Code 80 Punkte zu tief, mitten im Text (am Etikett gemessen).
    for (const [datei, d] of Object.entries(DRUCKER)) {
      const zpl = d.zpl(d.beutel('BO-280926-01-01', CHARGEN.kurz.charge, 'full', true, 2.5));
      const qr = zpl.indexOf('^BQN');
      assert.ok(qr > 0, datei + ': kein QR-Code');
      assert.match(zpl.slice(0, qr), /\^BY2,3,10\^FO\d+,\d+$/, datei);
    }
  });
  it('gedruckt wird auf die ganze Rolle, alles 5 Punkte tiefer als in der Vorschau', () => {
    // Der Drucker legt das Bild 5 Punkte zu hoch, gemessen am Fach-Etikett.
    for (const [datei, d] of Object.entries(DRUCKER)) {
      const items = d.beutel('BO-280926-01-01', CHARGEN.kurz.charge, 'full', true, 2.5);
      const zpl = d.zpl(items);
      assert.ok(zpl.startsWith('^XA^PW456^LL256^'), datei + ': ' + zpl.slice(0, 20));
      const qr = items.find((i) => i.type === 'qr');
      assert.ok(zpl.includes('^FO' + qr.x + ',' + (qr.y + 5) + '^BQN'), datei + ': QR-Code');
      for (const z of texte(items))
        assert.ok(zpl.includes('^FO' + z.x + ',' + (z.y + 5) + '^FB'), datei + ': ' + z.text);
    }
  });
});

// Der Kommentar einer Charge oder Kultur stand mit seinen ersten 13 Zeichen
// hinter der Sorte, und oft nicht einmal das, weil die Zeile voll war. Er hat
// jetzt seinen eigenen Platz: ganz unten, unter einem QR-Code daneben.
describe('Der Kommentar steht unten auf dem Etikett', () => {
  const KURZ = 'Testnotiz: zweite Runde';
  const LANG =
    'Testnotiz, die so lang ist, dass sie auch in zwei Zeilen nicht ganz auf das Etikett passt und gekürzt wird';
  const mit = (charge, notes) => Object.assign({}, charge, { notes });
  const unterDemCode = (items) =>
    texte(items)
      .filter((i) => !/^\/\d+$/.test(i.text))
      .sort((a, b) => a.y - b.y);

  for (const [datei, d] of Object.entries(DRUCKER)) {
    it(datei + ': als eigene, letzte Zeile, ganz und nicht mehr hinter der Sorte', () => {
      for (const detail of ['sorte', 'full']) {
        const items = d.beutel('BO-280926-01-01', mit(CHARGEN.kurz.charge, KURZ), detail, false, 2.5);
        const zeilen = unterDemCode(items);
        const letzte = zeilen[zeilen.length - 1];
        assert.equal(letzte.text, KURZ, detail);
        assert.equal(letzte.fontH, 20, 'kleiner als die Angaben darüber');
        assert.equal(zeilen.filter((z) => z.text.includes('Testnotiz')).length, 1, 'nur einmal');
        assert.ok(
          zeilen.some((z) => z.text === 'Blue Oyster - 2,5kg'),
          'die Sorte steht ohne den Kommentar da'
        );
        pruefe(items, datei + ' ' + detail + ' Kommentar', ['BO-280926-01-01']);
      }
    });

    it(datei + ': unter dem Datum, wenn eines dasteht', () => {
      const zeilen = unterDemCode(d.beutel('BO-280926-01-01', mit(CHARGEN.kurz.charge, KURZ), 'full', false, 2.5));
      const datum = zeilen.findIndex((z) => /12\.10\.2026|12\.10\.26/.test(z.text));
      assert.ok(datum >= 0, 'kein Datum: ' + zeilen.map((z) => z.text).join(' | '));
      assert.equal(datum, zeilen.length - 2);
    });

    it(datei + ': bis zwei Zeilen, dann drei Punkte', () => {
      const items = d.beutel('BO-280926-01-01', mit(CHARGEN.kurz.charge, LANG), 'sorte', false, 2.5);
      const notiz = unterDemCode(items).filter((z) => z.fontH === 20);
      assert.equal(notiz.length, 2);
      assert.ok(notiz[0].text.startsWith('Testnotiz, die so lang ist'));
      assert.ok(notiz[1].text.endsWith('...'), notiz[1].text);
      pruefe(items, datei + ' langer Kommentar', ['BO-280926-01-01']);
    });

    it(datei + ': nicht auf dem Etikett, das nur Code und Nummer trägt, und nicht ohne Kommentar', () => {
      const nur = d.beutel('BO-280926-01-01', mit(CHARGEN.kurz.charge, KURZ), 'minimal', false, 2.5);
      assert.ok(!texte(nur).some((z) => z.text.includes('Testnotiz')));
      for (const leer of ['', '   ', null, undefined]) {
        assert.deepEqual(
          d.beutel('BO-280926-01-01', mit(CHARGEN.kurz.charge, leer), 'sorte', false, 2.5),
          d.beutel('BO-280926-01-01', mit(CHARGEN.kurz.charge, ''), 'sorte', false, 2.5)
        );
      }
    });

    it(datei + ': ein Zeilenumbruch im Kommentar wird ein Leerzeichen', () => {
      const items = d.beutel(
        'BO-280926-01-01',
        mit(CHARGEN.kurz.charge, 'Testnotiz\n  zweite\tRunde'),
        'sorte',
        false,
        2.5
      );
      assert.ok(texte(items).some((z) => z.text === 'Testnotiz zweite Runde'));
      assert.doesNotMatch(d.zpl(items), /[\n\t]\S*Runde/);
    });

    it(datei + ': er gibt als Erster nach, die Angaben zur Sorte bleiben', () => {
      // Lange Nummer, lange Angaben, Datum: für den Kommentar bleibt eine Zeile
      // oder keine. Was über ihm steht, ist dasselbe wie ohne ihn.
      const { id, charge } = CHARGEN.lang;
      const ohne = unterDemCode(d.beutel(id, mit(charge, ''), 'full', false, 2.5));
      const items = d.beutel(id, mit(charge, LANG), 'full', false, 2.5);
      const zeilen = unterDemCode(items);
      assert.deepEqual(
        zeilen.slice(0, ohne.length).map((z) => z.text),
        ohne.map((z) => z.text)
      );
      const notiz = zeilen.slice(ohne.length);
      assert.ok(notiz.length <= 2 && notiz.every((z) => z.fontH === 20), notiz.length + ' Zeilen Kommentar');
      pruefe(items, datei + ' alles lang', [id]);
    });

    it(datei + ': neben dem QR-Code, weil darunter kein Platz mehr ist', () => {
      const ohne = d.beutel('BO-280926-01-01', mit(CHARGEN.kurz.charge, ''), 'full', true, 2.5);
      const items = d.beutel('BO-280926-01-01', mit(CHARGEN.kurz.charge, LANG), 'full', true, 2.5);
      const qr = items.find((i) => i.type === 'qr');
      const neben = texte(items).filter((z) => !/^\/\d+$/.test(z.text) && z.x >= qr.x + qr.size);
      assert.ok(neben.length >= 2 && neben.length <= 5, neben.length + ' Zeilen');
      assert.ok(neben[0].text.startsWith('Testnotiz'));
      assert.ok(neben.every((z) => z.fontH === 20 && z.x + z.blockW <= W - RAND.seite));
      // Unter dem Code steht dasselbe wie ohne Kommentar, an derselben Stelle.
      assert.deepEqual(
        items.filter((i) => !neben.includes(i)),
        ohne
      );
      pruefe(items, datei + ' QR Kommentar', ['BO-280926-01-01']);
    });

    it(datei + ': auf dem Etikett einer Kultur ebenso', () => {
      const c = { strainName: 'Lions Mane', strainText: 'LQ', notes: KURZ, created: '2026-09-20' };
      for (const detail of ['sorte', 'full']) {
        const items = d.kultur('MC-LM-200926-01', c, detail, false);
        const zeilen = unterDemCode(items);
        assert.equal(zeilen[zeilen.length - 1].text, KURZ, detail);
        assert.ok(zeilen.some((z) => z.text === 'Lions Mane - LQ'));
        pruefe(items, datei + ' Kultur ' + detail, ['MC-LM-200926-01']);
      }
      const nur = d.kultur('MC-LM-200926-01', c, 'minimal', false);
      assert.ok(!texte(nur).some((z) => z.text.includes('Testnotiz')));
      const qr = d.kultur('MC-LM-200926-01', c, 'full', true);
      const code = qr.find((i) => i.type === 'qr');
      assert.ok(texte(qr).some((z) => z.text === KURZ && z.x >= code.x + code.size));
    });
  }
});

describe('app.js und mcp-server.js messen und umbrechen gleich', () => {
  for (const k of KONSTANTEN) {
    it(k, () => assert.equal(hebeKonstante(k, MCP), hebeKonstante(k, APP)));
  }
  for (const f of FUNKTIONEN) {
    it(f, () => assert.equal(hebeFunktion(f, MCP), hebeFunktion(f, APP)));
  }
  it('LABEL_RUNTER', () => assert.equal(runter(MCP), runter(APP)));
});
