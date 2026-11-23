'use strict';
// Kein Weg, der Beutel anlegt, endet ohne Einlagern.
//
// Es konnten Chargen in der Datenbank landen, die kein einziger
// ADD-Scan je berührt hatte, etwa eine Charge mit ein paar
// Beuteln, über den geführten Ablauf aus einem Ansatz gezogen. Ohne
// Scan-Eintrag ist eine Charge für getStatus EMPTY — das Dashboard zeigt sie
// nicht, jeder Umzug überspringt sie, und Etiketten hat auch niemand gedruckt.
//
// Der Grund war eine Verzweigung: createBatch() hatte die Zonenwahl und den
// Etikettendialog als Rumpf am eigenen Ende stehen, und createBatchFromSubstrate
// kam dort nie vorbei. Beide legen Beutel an. Deshalb liegt der Schluss jetzt in
// nbPlaceAndPrint(), und dieser Test hält fest, dass alle Wege ihn nehmen.
//
// Gelesen wird die Quelle, nicht ein durchgespielter Klick: die Zusage lautet
// "kein Erzeugungsweg ohne Einlagern", und das ist eine Aussage über alle Wege,
// nicht über einen.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle();
const HTML = quelle('index.html');

// Jede Funktion, die Beutel entstehen lässt, und wie sie einlagert.
const WEGE = [
  ['createBatch', 'nbPlaceAndPrint'],
  ['wkbCreate', 'nbPlaceAndPrint'],
  // Die Körnerbrut hatte ihren eigenen Schluss — eigener Zonenwähler, eigene
  // Ergebniskarte, Sprung auf die Druckseite. Seit dem 11.09.2026 nimmt sie
  // denselben wie jede Charge: ein Weg, ein Fenster.
  ['createGrainBatch', 'nbPlaceAndPrint']
];

describe('Einlagern nach dem Anlegen', () => {
  for (const [name, ruft] of WEGE) {
    it(name + '() lagert ein, bevor es fertig ist', () => {
      assert.match(
        hebeFunktion(name, SRC),
        new RegExp('\\b' + ruft + '\\('),
        name + '() legt Beutel an, ohne ' + ruft + '() zu rufen — die Charge bliebe ohne Standort'
      );
    });
  }

  it('nbPlaceAndPrint macht beides: Platz, dann Etiketten', () => {
    // Seit es Regalbretter gibt (v122), fragt die App Blöcke und Körnerbrut
    // nicht mehr nach dem Platz: wo Platz ist, sieht man erst vor dem Regal.
    // Sie kommen ohne Frage in ihren Raum (brettStartZone), auf keinem Brett,
    // und bekommen ihr Brett beim Scannen. Gibt es noch keine Bretter, fragt die
    // App wie bisher. Ohne Platz bleibt keine Charge: einer der beiden Wege
    // bucht immer ein ADD.
    const f = hebeFunktion('nbPlaceAndPrint', SRC);
    assert.match(f, /brettStartZone\(/, 'ohne den Raum für Bretter fragt die App jedes Mal');
    assert.match(f, /addBagsToLocation\(/, 'ohne Frage gestellt wird mit einem ADD in den Raum');
    assert.match(f, /openZonePickModal\(/, 'ohne Bretter hat die Charge sonst keinen Standort');
    // Die Reihenfolge ist der Punkt: gedruckt wird nach dem Platz, auf beiden
    // Wegen. Ein Etikett ohne Standort ist ein Etikett auf einem Beutel, den die
    // App nicht kennt.
    assert.ok(
      f.indexOf('addBagsToLocation(') < f.indexOf('nbEtikettenNachPlatz('),
      'beim Raum ohne Frage steht der Druck vor dem Einlagern'
    );
    assert.ok(
      f.indexOf('openZonePickModal(') < f.lastIndexOf('nbEtikettenNachPlatz('),
      'der Etikettendialog steht vor der Zonenwahl statt in deren Rückruf'
    );
    assert.match(hebeFunktion('nbEtikettenNachPlatz', SRC), /nbpOpen\(\)/, 'ohne Etikettendialog druckt niemand');
  });

  it('der geführte Ablauf schließt sein Fenster, bevor er einlagert', () => {
    // m-move-batch und m-batch-print teilen sich den z-index mit m-work-flow und
    // stehen in index.html davor, liegen also darunter. Bliebe das Ablauffenster
    // offen, tippte der Arbeiter gegen ein Fenster, das er nicht sieht — genau
    // der Fehler aus #592.
    const f = hebeFunktion('wkbCreate', SRC);
    assert.ok(
      f.indexOf('wkfClose()') !== -1 && f.indexOf('wkfClose()') < f.indexOf('nbPlaceAndPrint('),
      'wkbCreate lagert ein, ohne vorher wkfClose() zu rufen'
    );
  });

  it('und die Markup-Reihenfolge, auf der das beruht, steht noch so da', () => {
    // Die Wache über der Wache: zieht jemand m-work-thing im HTML nach vorn,
    // ist der Grund für wkfClose() weg und dieser Test erklärt, warum er da war.
    const pos = (id) => HTML.indexOf('id="' + id + '"');
    for (const id of ['m-batch-print', 'm-move-batch', 'm-work-flow']) {
      assert.ok(pos(id) > -1, id + ' nicht in index.html gefunden — der Test muss mitgeführt werden');
    }
    assert.ok(pos('m-batch-print') < pos('m-work-flow'), 'm-batch-print läge jetzt über dem Ablauffenster');
    assert.ok(pos('m-move-batch') < pos('m-work-flow'), 'm-move-batch läge jetzt über dem Ablauffenster');
  });
});
