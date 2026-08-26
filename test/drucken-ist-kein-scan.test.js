'use strict';
// Drucken ist kein Scan.
//
// Nach "Charge anlegen → Etiketten drucken" stand das Scan-Fenster offen, und
// zwar leer: setFb() ruft ohne noModal openScanModal(), und der Hinweis darin
// verblasst nach drei Sekunden. Übrig blieb ein Fenster ohne Inhalt, das der
// Arbeiter jedes Mal von Hand wegtippen musste.
//
// Vier Druckwege meldeten so. Ihr eigener Fehlerzweig war längst ein Toast — nur
// der Erfolg riss den Bildschirm an sich. Sie gehen jetzt alle durch printedFb(),
// das die Meldung als Toast zeigt und Ton, Aufblitzen und Verlaufseintrag behält.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle();

// Jede Funktion, die an den Drucker schickt. sendToPrinter selbst nicht — die
// verschickt nur und meldet nichts.
const DRUCKWEGE = ['printBatchLabelsInline', 'printNewBags', 'printBagLabels', 'printLabLabels'];

describe('Drucken ist kein Scan', () => {
  // Die Wache über der Wache: benennt jemand eine Druckfunktion um, soll der
  // Test das sagen und nicht still grün werden.
  it('findet alle Druckwege, die es zu prüfen gibt', () => {
    const gefunden = [...SRC.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)\(/gm)]
      .map((m) => m[1])
      .filter((n) => new RegExp('function ' + n + '\\([\\s\\S]*?sendToPrinter\\(').test(SRC));
    for (const w of DRUCKWEGE) {
      assert.ok(gefunden.includes(w), w + '() schickt nicht mehr an den Drucker — der Test muss mitgeführt werden');
    }
  });

  for (const name of DRUCKWEGE) {
    it(name + '() reißt das Scan-Fenster nicht auf', () => {
      const f = hebeFunktion(name, SRC);
      // Ein nacktes setFb() ist genau der Aufruf, der openScanModal() auslöst.
      assert.doesNotMatch(
        f,
        /setFb\(/,
        name + '() meldet wieder über setFb — ohne noModal öffnet das nach jedem Druck das Scan-Fenster'
      );
      assert.match(f, /printedFb\(/, name + '() meldet den Druck gar nicht mehr');
    });
  }

  it('printedFb meldet sichtbar, ohne das Fenster zu öffnen', () => {
    const f = hebeFunktion('printedFb', SRC);
    assert.match(f, /noModal:\s*true/, 'ohne noModal ist genau nichts gewonnen');
    assert.match(f, /toast\(/, 'mit noModal allein sähe der Arbeiter überhaupt keine Bestätigung mehr');
  });

  it('und setFb hält sich weiterhin an noModal', () => {
    // Der Mechanismus, auf dem das beruht. Fiele die Bedingung weg, wären alle
    // Aufrufe oben umsonst.
    const f = hebeFunktion('setFb', SRC);
    assert.match(f, /if \(!opts \|\| !opts\.noModal\) openScanModal\(\)/);
  });

  it('sagt es in der Sprache des Benutzers', () => {
    // Zwei der vier Wege trugen ihren Satz als englisches Literal im Code, in
    // einer App mit drei Sprachdateien.
    for (const name of DRUCKWEGE) {
      assert.doesNotMatch(hebeFunktion(name, SRC), /'Printed /, name + '() druckt wieder einen englischen Satz');
    }
  });
});
