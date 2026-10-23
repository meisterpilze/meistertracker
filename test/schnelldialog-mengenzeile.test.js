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
  hebeKonstante('KB_KG', SRC),
  hebeFunktion('kbMengenLesen', SRC),
  hebeFunktion('msqReadSizes', SRC),
  // Seit der Inventur hängt die Zeile auch am Datum: früher angesetzt bucht
  // nichts ab, und das steht dann dahinter.
  hebeFunktion('localDateStr', SRC),
  hebeFunktion('anlageState', SRC),
  hebeFunktion('anlageFrueher', SRC),
  hebeFunktion('msQuickPreview', SRC)
].join('\n');

// Ein Lauf des Dialogs: Felder rein, Vorschauzeile raus. `groessen` ist, was in
// den Zählern je Beutelgröße steht — [kg, Anzahl] je Größe, kg aus 1, 2 und 5.
// Die alte Kurzform (qty + grainKg) ist dieselbe Liste mit genau einer Größe.
function vorschau({ ms, mode, qty, grainKg, groessen, labType, lang, angesetzt }) {
  const felder = {
    'ms-q-qty': { value: String(qty == null ? '' : qty) },
    'ms-q-labtype': { value: labType || '' },
    'ms-q-preview': { textContent: '', style: {} }
  };
  for (const [kg, n] of groessen || [[grainKg, qty]]) felder['ms-q-kb-' + kg] = { value: String(n == null ? '' : n) };
  const doc = {
    getElementById: (id) => felder[id] || null
  };
  // `angesetzt` ist das Feld "Angesetzt am", JJJJ-MM-TT; ohne Angabe zu (heute).
  const ANLAGE = { 'ms-q': angesetzt ? { offen: true, datum: angesetzt } : { offen: false, datum: '' } };
  new Function('document', 'LANG', 'currentLang', '_msQuickCtx', 'ANLAGE', CODE + '\nmsQuickPreview();')(
    doc,
    woerterbuecher(),
    lang || 'de',
    { mode, ms },
    ANLAGE
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

  it('sagt nichts, solange keine Größe eine Anzahl hat', () => {
    assert.equal(vorschau({ ms: SORTE(), mode: 'labor', labType: 'KB', qty: 0, grainKg: 2 }), '');
    assert.equal(
      vorschau({
        ms: SORTE(),
        mode: 'labor',
        labType: 'KB',
        groessen: [
          [1, 0],
          [2, 0],
          [5, 0]
        ]
      }),
      ''
    );
  });

  it('nennt jede Größe einzeln und summiert über alle', () => {
    // Der Fall, für den die Zähler je Größe da sind: ein Ansatz, eine Kultur,
    // drei Größen. 10 + 5 + 2 sind 17 Beutel, 10 + 10 + 10 sind 30 kg nass, und
    // bei 62 % Wasser bleiben davon 11,4 kg trockenes Korn.
    const s = vorschau({
      ms: SORTE(),
      mode: 'labor',
      labType: 'KB',
      groessen: [
        [1, 10],
        [2, 5],
        [5, 2]
      ]
    });
    assert.match(s, /17 Beutel Körnerbrut werden angelegt\./);
    assert.match(s, /10 × 1 kg \+ 5 × 2 kg \+ 2 × 5 kg/);
    assert.match(s, /30 kg gesamt/);
    assert.match(s, /11\.4 kg trockenes Korn vom Lager/);
  });

  it('übergeht Größen ohne Anzahl', () => {
    // Ein Zähler auf 0 ist keine Größe dieses Ansatzes. Er darf die Summe nicht
    // verfälschen und nicht in der Aufstellung stehen.
    const s = vorschau({
      ms: SORTE(),
      mode: 'labor',
      labType: 'KB',
      groessen: [
        [1, 10],
        [2, 0],
        [5, 0]
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

describe('Mengenzeile bei Bestand aus der Inventur', () => {
  // Früher angesetzt heißt: angelegt, aber nichts abgebucht. Die Zeile nennt
  // weiter, was ein Ansatz von heute nähme — und muss dann sagen, dass es
  // diesmal nicht geschieht, sonst liest man eine Abbuchung, die nicht kommt.
  const tag = (versatz) => {
    const d = new Date();
    d.setDate(d.getDate() + versatz);
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  };

  it('sagt bei Körnerbrut mit früherem Tag, dass nichts abgebucht wird', () => {
    const s = vorschau({ ms: SORTE(), mode: 'labor', labType: 'KB', qty: 10, grainKg: 2, angesetzt: tag(-14) });
    assert.match(s, /7\.6 kg trockenes Korn vom Lager — nichts abgebucht, früher angesetzt$/);
  });

  it('und bei einer Charge ebenso', () => {
    const s = vorschau({ ms: SORTE(), mode: 'charge', qty: 10, angesetzt: tag(-3) });
    assert.match(s, /für 10 Stück:.* — nichts abgebucht, früher angesetzt$/);
  });

  it('lässt die Zeile, wie sie war, solange der Tag heute ist', () => {
    for (const angesetzt of [undefined, tag(0)]) {
      const s = vorschau({ ms: SORTE(), mode: 'labor', labType: 'KB', qty: 10, grainKg: 2, angesetzt });
      assert.doesNotMatch(s, /nichts abgebucht/);
    }
  });

  it('schweigt bei Kulturen, die buchen ohnehin nie etwas', () => {
    const s = vorschau({ ms: SORTE(), mode: 'labor', labType: 'LC', qty: 4, angesetzt: tag(-14) });
    assert.doesNotMatch(s, /nichts abgebucht/);
  });
});
