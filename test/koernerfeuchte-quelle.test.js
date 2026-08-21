'use strict';
// Woher die Körnerfeuchte kommt, wenn der Schnelldialog eine Körnerbrut anlegt.
//
// msQuickConfirm() hat zwei Zweige, die dasselbe Feld gs-rh füllen und beide in
// createGrainBatch() münden: einer für "Laborarbeit: KB", einer für eine Sorte,
// deren Rezept recBatchType 'grain' sagt. Der zweite las seit #406 die Feuchte
// der Sorte, der erste seit #433 getAvgComp().grainRhPct — den Schnitt über
// alle Rezepte. Beide haben ms in der Hand; der Schnitt war dort nie die
// genauere Zahl.
//
// Es geht nicht um die Anzeige: gs-rh entscheidet, wie viel *trockenes* Korn
// vom Lagerbestand abgeht. 1 kg Tüte bei 52 % sind 0,48 kg trocken, bei 60 %
// 0,40 — 17 % Unterschied auf jede Buchung einer Sorte, deren Rezept von der
// Vorgabe abweicht.
//
// Der Test liest die Quelle, statt den Dialog nachzubauen: die Zusage lautet
// "kein Pfad füllt gs-rh aus dem Schnitt", und das ist eine Aussage über alle
// Zuweisungen, nicht über einen durchgespielten Klick.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle } = require('./helpers/quelle');

const SRC = quelle();

// Alle Zuweisungen an gs-rh über setv(). Nicht über getElementById: die drei
// Lesestellen weiter unten dürfen den Schnitt sehr wohl als letzte Vorgabe
// nehmen, wenn das Feld gar nicht existiert.
function zuweisungen() {
  return [...SRC.matchAll(/setv\('gs-rh',[^;]*\);/g)].map((m) => m[0].replace(/\s+/g, ' '));
}

describe('Körnerfeuchte im Schnelldialog', () => {
  // Die Wache über der Wache: findet der Ausdruck nichts mehr, weil setv()
  // umbenannt wurde oder das Feld anders heißt, wäre der Test still grün.
  it('findet die Zuweisungen überhaupt', () => {
    const z = zuweisungen();
    assert.ok(z.length >= 2, 'nur ' + z.length + ' Zuweisung(en) an gs-rh gefunden — der Test muss mitgeführt werden');
  });

  it('nimmt die Feuchte aus dem Sortenrezept, nicht aus dem Schnitt', () => {
    const ausSchnitt = zuweisungen().filter((z) => z.includes('getAvgComp'));
    assert.deepEqual(
      ausSchnitt,
      [],
      'gs-rh wird aus dem Durchschnitt aller Rezepte gefüllt, obwohl die Sorte ihren eigenen Wert trägt'
    );
  });

  it('füllt das eine Feld aus genau einer Quelle', () => {
    const verschieden = [...new Set(zuweisungen())];
    assert.equal(verschieden.length, 1, 'die Zweige füllen gs-rh unterschiedlich:\n  ' + verschieden.join('\n  '));
    assert.match(verschieden[0], /recGrainRhPct/);
  });
});
