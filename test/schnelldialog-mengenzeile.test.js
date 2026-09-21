'use strict';
// Was der Schnelldialog ankündigt, bevor er anlegt.
//
// Wer zum Beispiel 10 Beutel à 2 kg Körnerbrut ansetzte, las darunter "pro Stück: 7.6 kg".
// Keine der drei Zahlen im Spiel heißt so: 2 kg kommt in einen Beutel, 20 kg
// setzt man an, und 7,6 kg ist davon das trockene Korn, das vom Lager abgeht.
// Der Vorspann stammt aus dem Rezepteditor, der mit Anzahl 1 rechnet — im
// Dialog stand er über einer Summe, und zwar in beiden Zweigen: die Charge
// multipliziert ihre Materialliste genauso mit der Anzahl.
//
// Der zweite Punkt ist die Feuchte. Die Vorschau rechnete mit dem Schnitt über
// alle Rezepte, msQuickConfirm schreibt aber die Feuchte der Sorte nach gs-rh,
// und createGrainBatch bucht damit (siehe koernerfeuchte-quelle.test.js). Eine
// Sorte, die von der Vorgabe abweicht, bekam eine Menge angekündigt, die nicht
// die gebuchte war.
//
// Der dritte Punkt kam später dazu: eine Körnerbrut geht in Beutel
// verschiedener Größe — dieselbe Flüssigkultur, derselbe Ansatz, 1 kg neben 2.
// Der Dialog trug eine einzige Zahl für alle, also stand die Aufstellung, die
// er ankündigen müsste, gar nicht zur Verfügung. Jetzt zählt jede Größe für
// sich, und die Zeile nennt sie einzeln, bevor sie die Summen nennt.
//
// Geprüft wird der fertige Satz, nicht die Form des Codes: es geht um das, was
// vor dem Anlegen auf dem Bildschirm steht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT, quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');

const SRC = quelle();

// Die echten Wörterbücher, damit die Zusagen unten am gerenderten Satz hängen
// und nicht an einer im Test nachgebauten Schablone.
function woerterbuecher() {
  global.window = {};
  for (const s of ['de', 'en', 'pt']) {
    delete require.cache[require.resolve(path.join(ROOT, 'lang', s + '.js'))];
    require(path.join(ROOT, 'lang', s + '.js'));
  }
  return global.window.LANG;
}

const CODE = [
  hebeFunktion('t', SRC),
  hebeFunktion('esc', SRC),
  hebeFunktion('parseDecimal', SRC),
  hebeFunktion('mtGrainFactor', SRC),
  hebeFunktion('mtDryKg', SRC),
  hebeFunktion('_ohProdNeedCompute', SRC),
  hebeKonstante('_MS_MAT_KEY', SRC),
  hebeFunktion('_msRecipeToProd', SRC),
  hebeFunktion('_msStrainToRecipe', SRC),
  hebeFunktion('_msNeedParts', SRC),
  hebeFunktion('_msqIsGrainspawn', SRC),
  hebeFunktion('_msqIsGrain', SRC),
  hebeFunktion('msqSizeRows', SRC),
  hebeFunktion('msqReadSizes', SRC),
  hebeFunktion('msQuickPreview', SRC)
].join('\n');

// Eine Größenzeile, wie msqReadSizes sie im DOM vorfindet.
function zeile(kg, qty) {
  const felder = {
    '.msq-size-kg': { value: kg == null ? '' : String(kg) },
    '.msq-size-qty': { value: qty == null ? '' : String(qty) }
  };
  return { querySelector: (sel) => felder[sel] || null };
}

// Ein Lauf des Dialogs: Felder rein, Vorschauzeile raus. `groessen` ist die
// Liste, die im Dialog steht — [kg, Anzahl] je Zeile. Die alte Kurzform
// (qty + grainKg) ist dieselbe Liste mit genau einer Zeile.
function vorschau({ ms, mode, qty, grainKg, groessen, labType, lang }) {
  const zeilen = (groessen || [[grainKg, qty]]).map(([kg, n]) => zeile(kg, n));
  const felder = {
    'ms-q-qty': { value: String(qty == null ? '' : qty) },
    'ms-q-labtype': { value: labType || '' },
    'ms-q-preview': { textContent: '', style: {} }
  };
  const doc = {
    getElementById: (id) => felder[id] || null,
    querySelectorAll: () => zeilen
  };
  new Function('document', 'LANG', 'currentLang', '_msQuickCtx', CODE + '\nmsQuickPreview();')(
    doc,
    woerterbuecher(),
    lang || 'de',
    { mode, ms }
  );
  return felder['ms-q-preview'].textContent;
}

// Eine Sorte, wie der Dialog sie in der Hand hat. Die Blockwerte sind die aus
// dem Rezepteditor; für den Körnerzweig zählt nur recGrainRhPct.
const SORTE = (o) =>
  Object.assign(
    {
      name: 'Blue Oyster',
      kuerzel: 'BO',
      recBatchType: 'block',
      recSubstrate: 'holzkleie',
      recBagKg: 5,
      recRhPct: 62,
      recHardwoodPct: 80,
      recWheatbranPct: 20,
      recGypsum: 0,
      recGrainKg: 0,
      recGrainRhPct: 62
    },
    o || {}
  );

describe('Mengenzeile im Schnelldialog', () => {
  it('nennt Beutelgewicht, Gesamtmenge und trockenes Korn getrennt', () => {
    const s = vorschau({ ms: SORTE(), mode: 'labor', labType: 'KB', qty: 10, grainKg: 2 });
    assert.match(s, /10 Beutel Körnerbrut werden angelegt\./);
    assert.match(s, /10 × 2 kg/);
    assert.match(s, /20 kg gesamt/);
    // 20 kg nass bei 62 % Wasser = 7,6 kg trocken — die Zahl, die vorher allein
    // dastand und "pro Stück" hieß.
    assert.match(s, /7\.6 kg trockenes Korn vom Lager/);
  });

  it('behauptet nirgends mehr, eine Summe gelte pro Stück', () => {
    const kb = vorschau({ ms: SORTE(), mode: 'labor', labType: 'KB', qty: 10, grainKg: 2 });
    assert.doesNotMatch(kb, /pro Stück/);
    // Die Charge multipliziert ihre Materialliste mit derselben Anzahl und trug
    // denselben Vorspann.
    const charge = vorschau({ ms: SORTE(), mode: 'charge', qty: 10 });
    assert.doesNotMatch(charge, /pro Stück/);
    assert.match(charge, /für 10 Stück:/);
  });

  it('rechnet die Charge tatsächlich für die ganze Anzahl', () => {
    // 5 kg Beutel, 62 % Wasser → 1,9 kg Trockenmasse, davon 80 % Hartholz =
    // 1,52 kg je Stück. Zehn Stück sind 15,2 kg, und genau das steht da.
    const eins = vorschau({ ms: SORTE(), mode: 'charge', qty: 1 });
    assert.match(eins, /Hartholzpellets 1\.52 kg/);
    const zehn = vorschau({ ms: SORTE(), mode: 'charge', qty: 10 });
    assert.match(zehn, /Hartholzpellets 15\.2 kg/);
  });

  it('nimmt die Körnerfeuchte aus dem Rezept der Sorte', () => {
    // Dieselben 10 × 2 kg, andere Sorte: 52 % statt 62 % sind 9,6 kg trocken.
    // Vorher stand hier der Schnitt über alle Rezepte — also eine Menge, die
    // createGrainBatch anschließend nicht gebucht hätte.
    const s = vorschau({ ms: SORTE({ recGrainRhPct: 52 }), mode: 'labor', labType: 'KB', qty: 10, grainKg: 2 });
    assert.match(s, /9\.6 kg trockenes Korn vom Lager/);
  });

  it('fällt ohne hinterlegte Körnerfeuchte auf 52 % zurück, wie das Anlegen selbst', () => {
    const s = vorschau({ ms: SORTE({ recGrainRhPct: null }), mode: 'labor', labType: 'KB', qty: 10, grainKg: 2 });
    assert.match(s, /9\.6 kg trockenes Korn vom Lager/);
  });

  it('sagt nichts, solange eine der beiden Zahlen fehlt', () => {
    assert.equal(vorschau({ ms: SORTE(), mode: 'labor', labType: 'KB', qty: 0, grainKg: 2 }), '');
    assert.equal(vorschau({ ms: SORTE(), mode: 'labor', labType: 'KB', qty: 10, grainKg: 0 }), '');
  });

  it('nennt jede Größe einzeln und summiert über alle', () => {
    // Der Fall, für den die Zeilenliste da ist: ein Ansatz, eine Kultur, drei
    // Größen. 10 + 5 + 2 sind 17 Beutel, 10 + 10 + 6 sind 26 kg nass, und bei
    // 62 % Wasser bleiben davon 9,88 kg trockenes Korn.
    const s = vorschau({
      ms: SORTE(),
      mode: 'labor',
      labType: 'KB',
      groessen: [
        [1, 10],
        [2, 5],
        [3, 2]
      ]
    });
    assert.match(s, /17 Beutel Körnerbrut werden angelegt\./);
    assert.match(s, /10 × 1 kg \+ 5 × 2 kg \+ 2 × 3 kg/);
    assert.match(s, /26 kg gesamt/);
    assert.match(s, /9\.88 kg trockenes Korn vom Lager/);
  });

  it('übergeht Zeilen ohne Gewicht oder ohne Anzahl', () => {
    // Eine halb ausgefüllte Zeile ist keine Größe. Sie darf die Summe nicht
    // verfälschen — und sie darf die Zeile auch nicht leer machen, solange eine
    // vollständige danebensteht.
    const s = vorschau({
      ms: SORTE(),
      mode: 'labor',
      labType: 'KB',
      groessen: [
        [1, 10],
        [2, 0],
        [null, 5]
      ]
    });
    assert.match(s, /10 Beutel Körnerbrut werden angelegt\./);
    assert.match(s, /10 kg gesamt/);
    assert.doesNotMatch(s, /× 2 kg/);
  });

  it('rechnet eine Körner-Charge über ihre Größen, nicht über die Anzahl oben', () => {
    // Eine Sorte, deren Rezept auf Körner lautet, kommt als CHARGE durch den
    // Dialog — und fiel damit in den Materiallisten-Zweig, der die Anzahl über
    // den Zeilen liest. Die gibt es für sie nicht mehr.
    const s = vorschau({
      ms: SORTE({ recBatchType: 'grain', recGrainKg: 2, recGrainRhPct: 52 }),
      mode: 'charge',
      groessen: [
        [1, 4],
        [2, 3]
      ]
    });
    assert.match(s, /7 Beutel Körnerbrut werden angelegt\./);
    assert.match(s, /4 × 1 kg \+ 3 × 2 kg/);
    assert.match(s, /10 kg gesamt/);
    assert.doesNotMatch(s, /für \d+ Stück:/);
  });

  it('trägt die Zeile in jeder Sprache, nicht nur auf Deutsch', () => {
    // Ein fehlender Schlüssel wirft nicht, er steht als Kennung auf dem Schirm.
    for (const lang of ['en', 'pt']) {
      const s = vorschau({ ms: SORTE(), mode: 'labor', labType: 'KB', qty: 10, grainKg: 2, lang });
      assert.doesNotMatch(s, /msq\./, lang + ': ein Schlüssel steht unübersetzt in der Zeile');
      assert.match(s, /7\.6/, lang + ': die trockene Menge fehlt');
      assert.match(s, /20 kg/, lang + ': die Gesamtmenge fehlt');
      assert.match(s, /10 × 2 kg/, lang + ': die Aufstellung der Größen fehlt');
    }
  });
});
