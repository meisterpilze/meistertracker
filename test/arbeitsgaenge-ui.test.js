'use strict';
// Die Rechenteile der Arbeitsgänge.
//
// Diese Abläufe gingen ohne einen einzigen Test live, und die Nachprüfung fand
// fünfzehn Fehler — die meisten davon in genau der Arithmetik und den Filtern,
// die hier stehen. Ein Ernte-Durchgang schrieb Erst-Ernten als zweiten Flush,
// weil der Flush aus der ganzen Charge abgeleitet wurde statt aus dem Beutel;
// die Ansatz-Auswahl bot leergezogene Ansätze an; und der Kilo-Formatierer
// wurde eingeführt, weil "13.650 kg" auf Deutsch dreizehntausend heißt.
//
// Gleiches Vorgehen wie substrate-draw-ui.test.js: app.js hat keine Modulgrenze,
// also hebt der Test die Funktionen aus der Quelle und lässt sie gegen Attrappen
// laufen. Der Browser steht nicht unter Test, die Zahlen schon.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// Benannt, damit ein Fehlschlag sagt, welche Funktion umgezogen ist, statt
// "unexpected token".
// Die Quelle hat CRLF-Zeilenenden, ein Block endet also auf \r\n} statt \n}.
// wkmStock() steht vor wkmShortfalls(), weil letztere es aufruft.
const TEILE = [
  [/^const fmtKg = .*$/m, 'fmtKg'],
  [/^function wkBagHarvested\(bagId\) \{[\s\S]*?\r?\n\}/m, 'wkBagHarvested()'],
  [/^function wkBagFlush\(bag\) \{[\s\S]*?\r?\n\}/m, 'wkBagFlush()'],
  [/^function wkOpenMixes\(\) \{[\s\S]*?\r?\n\}/m, 'wkOpenMixes()'],
  [/^function wkmStock\(\) \{[\s\S]*?\r?\n\}/m, 'wkmStock()'],
  [/^function wkmShortfalls\(\) \{[\s\S]*?\r?\n\}/m, 'wkmShortfalls()']
];

function lift() {
  const out = [];
  for (const [re, name] of TEILE) {
    const m = SRC.match(re);
    assert.ok(m, name + ' nicht in app.js gefunden — der Test muss mitgeführt werden');
    out.push(m[0]);
  }
  return out.join('\n');
}

// Die Attrappen: nur das, was die gehobenen Funktionen wirklich anfassen.
function bauen({ harvests = [], sbList = [], preview = null, stock = {}, lang = 'de' } = {}) {
  const quelle = `
    const LOCALE_MAP = { en: 'en-GB', de: 'de-DE', pt: 'pt-BR' };
    let currentLang = ${JSON.stringify(lang)};
    const harvests = ${JSON.stringify(harvests)};
    const _sbList = ${JSON.stringify(sbList)};
    const inventory = { stock: ${JSON.stringify(stock)} };
    const WKM = { preview: ${JSON.stringify(preview)} };
    const t = (k) => k;
    ${lift()}
    return { fmtKg, wkBagHarvested, wkBagFlush, wkOpenMixes, wkmShortfalls };
  `;
  return new Function(quelle)();
}

describe('Arbeitsgänge — Ernte', () => {
  it('gibt einem nie geernteten Beutel Flush 1, auch wenn Nachbarn schon dran waren', () => {
    // Der Fehler, der live ging: gebucht wurden fünf Beutel einer Charge, dann
    // führte die Quittung zurück — und die fünf unberührten Beutel bekamen
    // Flush 2, weil der Flush aus der ganzen Charge abgeleitet wurde.
    const w = bauen({
      harvests: [
        { bag: 'BO-240726-01-01', grams: 245, flush: 1 },
        { bag: 'BO-240726-01-02', grams: 310, flush: 1 }
      ]
    });
    assert.equal(w.wkBagFlush('BO-240726-01-09'), 1, 'unberührter Beutel muss Erst-Ernte sein');
    assert.equal(w.wkBagFlush('BO-240726-01-01'), 2, 'einmal geernteter Beutel geht auf Flush 2');
  });

  it('zählt je Beutel zusammen und merkt sich dessen höchsten Flush', () => {
    const w = bauen({
      harvests: [
        { bag: 'KO-1-01', grams: 200, flush: 1 },
        { bag: 'KO-1-01', grams: 150, flush: 2 },
        { bag: 'KO-1-02', grams: 90, flush: 1 }
      ]
    });
    assert.deepEqual(w.wkBagHarvested('KO-1-01'), { grams: 350, lastFlush: 2 });
    assert.equal(w.wkBagFlush('KO-1-01'), 3);
    assert.equal(w.wkBagFlush('KO-1-02'), 2);
  });

  it('erkennt den Beutel unabhängig von Groß- und Kleinschreibung', () => {
    const w = bauen({ harvests: [{ bag: 'bo-1-01', grams: 100, flush: 1 }] });
    assert.equal(w.wkBagFlush('BO-1-01'), 2);
  });
});

describe('Arbeitsgänge — Substrat-Ansätze', () => {
  it('bietet nur Ansätze an, aus denen noch etwas zu ziehen ist', () => {
    // Vorher stand ein leergezogener Ansatz vorausgewählt in der Auswahl und
    // ließ sich bebuchen.
    const w = bauen({
      sbList: [
        { subId: 'SUB-01', remainingKg: 0 },
        { subId: 'SUB-02', remainingKg: 240 },
        { subId: 'SUB-03', remainingKg: 0.00001 }
      ]
    });
    assert.deepEqual(
      w.wkOpenMixes().map((x) => x.subId),
      ['SUB-02'],
      'weder der leere noch der praktisch leere Ansatz gehört in die Liste'
    );
  });

  it('meldet fehlendes Material und schweigt, wenn der Bestand genau reicht', () => {
    const mix = { pelletsKg: 160, branKg: 40, gypsumKg: 2, cornKg: 0 };
    const knapp = bauen({
      preview: { mix },
      stock: { hardwood: 100, wheatbran: 40, gypsum: 2 }
    });
    const fehlend = knapp.wkmShortfalls();
    assert.equal(fehlend.length, 1);
    assert.equal(fehlend[0].need, 160);
    assert.equal(fehlend[0].have, 100);

    const genau = bauen({
      preview: { mix },
      stock: { hardwood: 160, wheatbran: 40, gypsum: 2 }
    });
    assert.deepEqual(genau.wkmShortfalls(), [], 'ein exakt ausreichender Bestand ist keine Fehlmenge');
  });

  it('meldet ohne Vorschau gar nichts, statt zu stolpern', () => {
    const w = bauen({ preview: null, stock: { hardwood: 0 } });
    assert.deepEqual(w.wkmShortfalls(), []);
  });
});

describe('Arbeitsgänge — Kilo in der Sprache des Benutzers', () => {
  it('schreibt deutsch mit Komma und englisch mit Punkt', () => {
    // Der Grund für fmtKg: toFixed liefert immer einen Punkt, und "13.650 kg"
    // liest sich auf Deutsch als dreizehntausend.
    const de = bauen({ lang: 'de' });
    const en = bauen({ lang: 'en' });
    assert.equal(de.fmtKg(13.65, 2), '13,65');
    assert.equal(en.fmtKg(13.65, 2), '13.65');
  });

  it('trennt Tausender nach den Regeln der jeweiligen Sprache', () => {
    const de = bauen({ lang: 'de' });
    const en = bauen({ lang: 'en' });
    assert.equal(de.fmtKg(1003.5, 1), '1.003,5');
    assert.equal(en.fmtKg(1003.5, 1), '1,003.5');
  });

  it('hält die verlangte Zahl an Nachkommastellen ein', () => {
    const de = bauen({ lang: 'de' });
    assert.equal(de.fmtKg(100, 0), '100');
    assert.equal(de.fmtKg(56.5, 1), '56,5');
    assert.equal(de.fmtKg(2, 2), '2,00');
  });
});
