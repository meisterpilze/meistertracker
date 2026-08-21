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
// Die zweite Nachprüfung fand die nächste Schicht: ein abgeschriebener Ansatz
// stand weiter zur Auswahl, der Flush ließ sich gar nicht mehr berichtigen, und
// die Quittung zählte abgelehnte Gramm weiter mit. Auch das steht jetzt hier.
//
// Gleiches Vorgehen wie substrate-draw-ui.test.js: app.js hat keine Modulgrenze,
// also hebt der Test die Funktionen aus der Quelle und lässt sie gegen Attrappen
// laufen. Der Browser steht nicht unter Test, die Zahlen schon.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hebe } = require('./helpers/quelle');

// Benannt, damit ein Fehlschlag sagt, welche Funktion umgezogen ist, statt
// "unexpected token".
// Die Quelle hat CRLF-Zeilenenden, ein Block endet also auf \r\n} statt \n}.
// wkmStock() steht vor wkmShortfalls(), weil letztere es aufruft; wkBagHarvested
// vor wkBagFlush vor wkfBagFlush aus demselben Grund.
//
// LOCALE_MAP wird mitgehoben, nicht nachgebaut: es ist das Einzige, was das
// Ergebnis von fmtKg bestimmt. Eine Kopie im Test hätte genau die Änderung
// durchgelassen, gegen die die drei Sprachtests unten schützen sollen.
const TEILE = [
  [/^const LOCALE_MAP = .*$/m, 'LOCALE_MAP'],
  [/^const fmtKg = .*$/m, 'fmtKg'],
  [/^function wkBagHarvested\(bagId\) \{[\s\S]*?\r?\n\}/m, 'wkBagHarvested()'],
  [/^function wkBagFlush\(bag\) \{[\s\S]*?\r?\n\}/m, 'wkBagFlush()'],
  [/^function wkfBagFlush\(bag, lastFlush\) \{[\s\S]*?\r?\n\}/m, 'wkfBagFlush()'],
  [/^function wkfHarvestReceiptText\(r\) \{[\s\S]*?\r?\n\}/m, 'wkfHarvestReceiptText()'],
  [/^function wkIstApple\(ua, touchPoints\) \{[\s\S]*?\r?\n\}/m, 'wkIstApple()'],
  [/^function wkOpenMixes\(\) \{[\s\S]*?\r?\n\}/m, 'wkOpenMixes()'],
  [/^function wkbStrain\(\) \{[\s\S]*?\r?\n\}/m, 'wkbStrain()'],
  [/^function wkbRecipe\(\) \{[\s\S]*?\r?\n\}/m, 'wkbRecipe()'],
  [/^function wkbMix\(\) \{[\s\S]*?\r?\n\}/m, 'wkbMix()'],
  [/^function wkbMischung\(\) \{[\s\S]*?\r?\n\}/m, 'wkbMischung()'],
  [/^function wkmStock\(\) \{[\s\S]*?\r?\n\}/m, 'wkmStock()'],
  [/^function wkmShortfalls\(\) \{[\s\S]*?\r?\n\}/m, 'wkmShortfalls()']
];

// Einmal aus der Quelle heben, nicht je Attrappe: app.js ist knapp ein Megabyte,
// und der gehobene Text ist bei jedem Aufbau derselbe.
const TEILE_SRC = hebe(TEILE);

// Die Attrappen: nur das, was die gehobenen Funktionen wirklich anfassen.
// t() gibt die Platzhalter mit zurück, damit die Quittungstests sehen, mit
// welchen Zahlen die Zeile geschrieben wurde.
function bauen({
  harvests = [],
  sbList = [],
  preview = null,
  stock = {},
  lang = 'de',
  flushOverride = null,
  strains = [],
  wkb = {}
} = {}) {
  const quelle = `
    let currentLang = ${JSON.stringify(lang)};
    const harvests = ${JSON.stringify(harvests)};
    const _sbList = ${JSON.stringify(sbList)};
    const mushroomStrains = ${JSON.stringify(strains)};
    const inventory = { stock: ${JSON.stringify(stock)} };
    const WKM = { preview: ${JSON.stringify(preview)} };
    const WKF = { flushOverride: ${JSON.stringify(flushOverride)} };
    const WKB = Object.assign({ strainId: null, subId: '', hw: null, wb: null, rh: null, days: null }, ${JSON.stringify(wkb)});
    const t = (k, p) => (p ? k + ' ' + JSON.stringify(p) : k);
    ${TEILE_SRC}
    return { fmtKg, wkBagHarvested, wkBagFlush, wkfBagFlush, wkfHarvestReceiptText, wkIstApple, wkOpenMixes, wkbMischung, wkbRecipe, wkmShortfalls, WKF };
  `;
  return new Function(quelle)();
}

const DE = bauen({ lang: 'de' });
const EN = bauen({ lang: 'en' });

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

describe('Arbeitsgänge — der Flush lässt sich berichtigen', () => {
  it('nimmt ohne Eingriff den nächsten Flush des Beutels', () => {
    const w = bauen({ harvests: [{ bag: 'BO-1-01', grams: 200, flush: 1 }] });
    assert.equal(w.wkfBagFlush('BO-1-01'), 2);
    assert.equal(w.wkfBagFlush('BO-1-09'), 1);
  });

  it('lässt eine eingetragene Zahl für alle Beutel gelten', () => {
    // Eine Welle wird über zwei, drei Tage gepflückt. Ohne dieses Feld zählte
    // Mittwoch als Flush 2 und Freitag als Flush 3 desselben Beutels — und die
    // Kennzahl "Beutel in zweiter Welle" stieg mit jedem Pflücktag.
    const w = bauen({
      harvests: [{ bag: 'BO-1-01', grams: 200, flush: 1 }],
      flushOverride: 1
    });
    assert.equal(w.wkfBagFlush('BO-1-01'), 1, 'die Übersteuerung schlägt die Vorgeschichte');
    assert.equal(w.wkfBagFlush('BO-1-09'), 1);
  });

  it('nimmt den mitgereichten Wert, statt alle Ernten noch einmal zu lesen', () => {
    // wkLiveBags() hat die Vorgeschichte schon gelesen. Der zweite Durchlauf je
    // Zeile kostete bei tausenden Ernten sichtbar Zeit.
    const w = bauen({ harvests: [] });
    assert.equal(w.wkfBagFlush('BO-1-01', 2), 3, 'der übergebene Wert zählt');
    assert.equal(w.wkfBagFlush('BO-1-01', 0), 1, 'auch die 0 zählt, sie ist kein "nicht gesetzt"');
  });
});

describe('Arbeitsgänge — die Quittung rechnet nach', () => {
  const zettel = () => ({
    batchId: 'BO-260819-01',
    species: 'Austernpilz',
    by: 'jonas',
    grams: 2500,
    bags: 5,
    bagsTotal: 40,
    released: false,
    releaseFailed: 0
  });

  it('schreibt die Kopfzeile aus den Gramm, die wirklich gebucht sind', () => {
    const w = bauen({});
    const r = zettel();
    w.wkfHarvestReceiptText(r);
    assert.match(r.headline, /2\.50 kg/, 'über einem Kilo in Kilo');
    // Der Server lehnt einen Beutel ab: die Kopfzeile muss mitgehen, sonst steht
    // "2,50 kg geerntet" über einer Zeile, die das Gegenteil sagt.
    r.grams -= 500;
    r.bags--;
    w.wkfHarvestReceiptText(r);
    assert.match(r.headline, /2\.00 kg/);
    assert.match(r.lines[1][1], /"n":4/, 'die Beutelzahl geht mit');
  });

  it('schreibt unter einem Kilo in Gramm', () => {
    const w = bauen({});
    const r = zettel();
    r.grams = 840;
    w.wkfHarvestReceiptText(r);
    assert.match(r.headline, /840 g/);
  });

  it('sagt bei der Freigabe, wenn nur ein Teil durchging', () => {
    const w = bauen({});
    const r = zettel();
    r.released = true;
    w.wkfHarvestReceiptText(r);
    assert.equal(r.lines[2][1], 'work.rReleasedYes');
    r.releaseFailed = 2;
    w.wkfHarvestReceiptText(r);
    assert.match(r.lines[2][1], /rReleasedPartial/, 'ein Teilerfolg darf nicht als voller Erfolg dastehen');
    r.released = false;
    w.wkfHarvestReceiptText(r);
    assert.equal(r.lines[2][1], 'work.rReleasedNo');
  });
});

describe('Arbeitsgänge — aufs Handy legen', () => {
  // Chrome meldet beforeinstallprompt, Safari nicht. Für Safari steht statt des
  // Knopfes der Weg von Hand da — und nur dort, sonst bekämen Android-Nutzer eine
  // Anleitung für ein Menü, das ihr Browser nicht hat.
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const IPAD_ALT =
    'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 Version/12.1 Mobile/15E148 Safari/604.1';
  const IPAD_NEU =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
  const WINDOWS =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

  it('erkennt iPhone und älteres iPad an der Kennung', () => {
    const w = bauen({});
    assert.equal(w.wkIstApple(IPHONE, 5), true);
    assert.equal(w.wkIstApple(IPAD_ALT, 5), true);
  });

  it('erkennt das iPad, das sich als Macintosh ausgibt', () => {
    // Seit iPadOS 13 ist die Kennung die eines Rechners. Ohne den Touch-Zähler
    // bekäme genau das Gerät im Labor den Hinweis nie zu sehen.
    const w = bauen({});
    assert.equal(w.wkIstApple(IPAD_NEU, 5), true);
  });

  it('hält einen echten Mac für einen Rechner', () => {
    const w = bauen({});
    assert.equal(w.wkIstApple(IPAD_NEU, 0), false, 'ohne Touch ist es keiner');
  });

  it('lässt Android und Windows in Ruhe — dort gibt es den Knopf', () => {
    const w = bauen({});
    assert.equal(w.wkIstApple(ANDROID, 5), false);
    assert.equal(w.wkIstApple(WINDOWS, 0), false);
  });
});

describe('Arbeitsgänge — woraus die Beutel wirklich bestehen', () => {
  // Der Server nimmt die Zusammensetzung aus dem Ansatz, nicht aus der Sorte
  // (createBagBatchFromSubstrate in db.js). Der Assistent zeigte trotzdem das
  // Sorten-Rezept an — man las 70/30 bei 61 % und bekam 65/35 bei 62 % gebucht.
  const SORTE = {
    id: 3,
    name: 'Black Pearl King Oyster',
    recHardwoodPct: 70,
    recWheatbranPct: 30,
    recRhPct: 61,
    recIncDays: 14
  };
  const ANSATZ = {
    subId: 'SUB-260806-01',
    status: 'open',
    remainingKg: 300,
    composition: { hardwoodPct: 65, wheatbranPct: 35, cornPct: 0, gypsumPct: 1, rhPct: 62 }
  };

  it('nimmt die Mischung des Ansatzes, wenn einer gewählt ist', () => {
    const w = bauen({ strains: [SORTE], sbList: [ANSATZ], wkb: { strainId: 3, subId: 'SUB-260806-01' } });
    assert.deepEqual(w.wkbMischung(), { hw: 65, wb: 35, rh: 62, ausAnsatz: 'SUB-260806-01' });
  });

  it('nimmt das Rezept der Sorte, wenn kein Ansatz gewählt ist', () => {
    const w = bauen({ strains: [SORTE], sbList: [ANSATZ], wkb: { strainId: 3, subId: '' } });
    assert.deepEqual(w.wkbMischung(), { hw: 70, wb: 30, rh: 61, ausAnsatz: null });
  });

  it('lässt ein von Hand geändertes Rezept gelten — aber nur ohne Ansatz', () => {
    const eigen = { strainId: 3, hw: 60, wb: 40, rh: 58 };
    const ohne = bauen({ strains: [SORTE], sbList: [ANSATZ], wkb: { ...eigen, subId: '' } });
    assert.deepEqual(ohne.wkbMischung(), { hw: 60, wb: 40, rh: 58, ausAnsatz: null });
    // Mit Ansatz zählt die Handeingabe nicht, weil der Server sie auch nicht
    // bucht. Ein Feld, das nichts bewirkt, darf gar nicht erst etwas behaupten.
    const mit = bauen({ strains: [SORTE], sbList: [ANSATZ], wkb: { ...eigen, subId: 'SUB-260806-01' } });
    assert.deepEqual(mit.wkbMischung(), { hw: 65, wb: 35, rh: 62, ausAnsatz: 'SUB-260806-01' });
  });

  it('fällt auf das Rezept zurück, wenn der Ansatz inzwischen leer ist', () => {
    // wkbMix() geht über wkOpenMixes(); ein leergezogener Ansatz ist dort nicht
    // mehr drin, und dann wird die Charge ohnehin vom Lager gebucht.
    const leer = { ...ANSATZ, remainingKg: 0 };
    const w = bauen({ strains: [SORTE], sbList: [leer], wkb: { strainId: 3, subId: 'SUB-260806-01' } });
    assert.deepEqual(w.wkbMischung(), { hw: 70, wb: 30, rh: 61, ausAnsatz: null });
  });

  it('kommt mit einem Ansatz ohne Zusammensetzung klar', () => {
    // Ältere Ansätze aus der Zeit vor den Prozentspalten.
    const alt = { subId: 'SUB-ALT-01', status: 'open', remainingKg: 100 };
    const w = bauen({ strains: [SORTE], sbList: [alt], wkb: { strainId: 3, subId: 'SUB-ALT-01' } });
    assert.deepEqual(w.wkbMischung(), { hw: 70, wb: 30, rh: 61, ausAnsatz: null });
  });
});

describe('Arbeitsgänge — Substrat-Ansätze', () => {
  it('bietet nur Ansätze an, aus denen noch etwas zu ziehen ist', () => {
    // Vorher stand ein leergezogener Ansatz vorausgewählt in der Auswahl und
    // ließ sich bebuchen.
    const w = bauen({
      sbList: [
        { subId: 'SUB-01', status: 'open', remainingKg: 0 },
        { subId: 'SUB-02', status: 'open', remainingKg: 240 },
        { subId: 'SUB-03', status: 'open', remainingKg: 0.00001 }
      ]
    });
    assert.deepEqual(
      w.wkOpenMixes().map((x) => x.subId),
      ['SUB-02'],
      'weder der leere noch der praktisch leere Ansatz gehört in die Liste'
    );
  });

  it('lässt einen abgeschriebenen Ansatz draußen, auch wenn noch Kilo drauf sind', () => {
    // Die Übersicht verlangte status === 'open', die Auswahl und der geführte
    // Ablauf nicht — ein als verdorben abgeschriebener Ansatz ließ sich weiter
    // zu einer Charge verarbeiten.
    const w = bauen({
      sbList: [
        { subId: 'SUB-10', status: 'written_off', remainingKg: 180 },
        { subId: 'SUB-11', status: 'used', remainingKg: 5 },
        { subId: 'SUB-12', status: 'open', remainingKg: 180 }
      ]
    });
    assert.deepEqual(
      w.wkOpenMixes().map((x) => x.subId),
      ['SUB-12']
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
    assert.equal(DE.fmtKg(13.65, 2), '13,65');
    assert.equal(EN.fmtKg(13.65, 2), '13.65');
  });

  it('trennt Tausender nach den Regeln der jeweiligen Sprache', () => {
    assert.equal(DE.fmtKg(1003.5, 1), '1.003,5');
    assert.equal(EN.fmtKg(1003.5, 1), '1,003.5');
  });

  it('hält die verlangte Zahl an Nachkommastellen ein', () => {
    assert.equal(DE.fmtKg(100, 0), '100');
    assert.equal(DE.fmtKg(56.5, 1), '56,5');
    assert.equal(DE.fmtKg(2, 2), '2,00');
  });
});
