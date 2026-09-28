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
const KONSTANTEN = ['_LABEL_EM', '_LABEL_ERSATZ'];
const FUNKTIONEN = [
  '_lineBlockW',
  'labelTextW',
  'labelGlyphs',
  'labelWrap',
  'labelLines',
  'labelLayout',
  '_labelBarcode',
  '_labelQr'
];
const unterkante = (src) => src.match(/^const LABEL_UNTEN = \d+;$/m)[0];

// app.js hat keine Modulgrenze: die Etiketten-Funktionen werden herausgehoben
// und gegen Attrappen gebaut. barcodeByEntity bleibt leer, also druckt jedes
// Etikett den Ersatz-Code aus der Nummer — für den Text darunter egal.
const APP_E = new Function(
  [
    'const barcodeByEntity = new Map();',
    'const labelDims = { widthDots: 400, heightDots: 240 };',
    'let _labelEmMap = null;',
    unterkante(APP),
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
      assert.ok(zpl.includes('LC-LM-260926-01 <- PD-LM-200926-03'), name + ': Herkunft fehlt');
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
  const zeilen = texte(items)
    .filter((i) => i !== zaehler)
    .sort((a, b) => a.y - b.y);
  for (const z of zeilen.concat(zaehler ? [zaehler] : [])) {
    const breite = mcp.labelTextW(z.text, z.fontH);
    assert.ok(breite <= (z.blockW || 400) - 6, name + ': "' + z.text + '" braucht ' + breite + ' von ' + z.blockW);
  }
  if (code.type === 'barcode') {
    assert.ok(code.y >= 40, name + ': Strichcode im Rand, den das Material abschneidet');
    assert.ok(code.h >= 60 && code.h <= 90, name + ': Strichcode ' + code.h + ' hoch');
  }
  let oben = code.y + (code.h || code.size);
  for (const z of zeilen) {
    assert.ok(z.y >= oben, name + ': "' + z.text + '" überdeckt, was darüber steht');
    oben = z.y + z.fontH;
  }
  assert.ok(oben <= (code.type === 'barcode' ? 234 : 240), name + ': Text reicht bis ' + oben);
  if (zaehler) {
    for (const z of zeilen) {
      const daneben = z.y < zaehler.y + zaehler.fontH && zaehler.y < z.y + z.fontH;
      if (daneben) assert.ok((z.blockW || 400) <= zaehler.x - 6, name + ': "' + z.text + '" läuft unter den Zähler');
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
            const nummern = c.parentId ? [id, c.parentId] : [id];
            pruefe(d.kultur(id, c, detail, qr), art + ' ' + fall, nummern);
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
        ['barcode', 46, 90],
        ['text', 142, 24],
        ['text', 170, 24]
      ]
    );
  });
});

describe('app.js und mcp-server.js messen und umbrechen gleich', () => {
  for (const k of KONSTANTEN) {
    it(k, () => assert.equal(hebeKonstante(k, MCP), hebeKonstante(k, APP)));
  }
  for (const f of FUNKTIONEN) {
    it(f, () => assert.equal(hebeFunktion(f, MCP), hebeFunktion(f, APP)));
  }
  it('LABEL_UNTEN', () => assert.equal(unterkante(MCP), unterkante(APP)));
});
