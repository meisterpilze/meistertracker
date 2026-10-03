'use strict';
// Kein Weg, der Kulturen anlegt, endet ohne Etiketten-Fenster — und keiner, der
// vom Schnelldialog kommt, wechselt dafür die Seite.
//
// Am 11.09.2026 legte der Arbeiter über die Kachel "Reinraumarbeit erfassen"
// eine Mutterkultur an. Die App sprang auf die Laborseite, das lange Formular
// lag da, die Kultur stand in der Liste — und ein Etikett kam nicht. Die Charge
// aus dem Assistenten bekam ihr Fenster längst, wo man stand (nbPlaceAndPrint);
// die Kultur hatte nur eine Ergebniskarte im Formular, das der Schnelldialog
// als Ablage benutzt und nie zeigt.
//
// Gelesen wird die Quelle, nicht ein durchgespielter Klick — wie in
// einlagern-nach-anlegen.test.js, und aus demselben Grund: die Zusage gilt für
// alle Wege, nicht für einen.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle();
const HTML = quelle('index.html');

describe('Etiketten nach Laborarbeit', () => {
  it('logLabWork() endet im Etiketten-Fenster', () => {
    const f = hebeFunktion('logLabWork', SRC);
    assert.match(f, /\bcprShow\(/, 'logLabWork legt Kulturen an, ohne cprShow() zu rufen — kein Etikett');
  });

  it('und der Druck wartet auf die Antwort des Servers', () => {
    // Die Nummern-Barcodes kommen mit der Antwort; ein Etikett davor trägt die
    // alte ID-Kodierung.
    // Angelegt und gespeichert wird in kulturenAnlegen(), das logLabWork und
    // das Beimpfen-Fenster teilen; logLabWork reicht die Speicherung weiter.
    const k = hebeFunktion('kulturenAnlegen', SRC);
    assert.match(k, /const saved = apiPost\('\/api\/cultures'/, 'die Speicherung wird nicht mehr festgehalten');
    assert.match(k, /return \{ newC, saved \}/);
    const f = hebeFunktion('logLabWork', SRC);
    assert.match(f, /const \{ newC, saved \} = kulturenAnlegen\(/);
    assert.match(f, /cprShow\([\s\S]*?\bsaved\s*\)/, 'cprShow bekommt die Speicherung nicht mit');
    const p = hebeFunktion('printCultureLabelsInline', SRC);
    assert.match(p, /await _cprSaved/, 'der Druck wartet nicht auf die Speicherung');
    assert.ok(p.indexOf('await _cprSaved') < p.indexOf('makeLabZPL('), 'gedruckt wird, bevor gespeichert ist');
  });

  it('der Schnelldialog wechselt für Laborarbeit nicht mehr die Seite', () => {
    const f = hebeFunktion('msQuickConfirm', SRC);
    assert.doesNotMatch(f, /go\('lab'/, 'msQuickConfirm springt noch auf die Laborseite');
    assert.doesNotMatch(f, /openStab\('lab'/, 'msQuickConfirm schlägt noch das lange Laborformular auf');
    assert.match(f, /\blwUpdate\(\)/, 'ohne lwUpdate() bleibt lw-parent leer');
    // Reihenfolge: erst die Auswahl füllen, dann die Elternkultur setzen, dann anlegen.
    assert.ok(f.indexOf('lwUpdate()') < f.indexOf('logLabWork()'), 'logLabWork läuft vor lwUpdate');
  });

  it('und für eine Charge auch nicht — das Formular ist Ablage, nicht Ziel', () => {
    for (const name of ['msQuickConfirm', 'wkbCreateFromShelf']) {
      const f = hebeFunktion(name, SRC);
      assert.doesNotMatch(f, /openStab\('batch', 'new'\)/, name + ' schlägt noch das lange Chargenformular auf');
      assert.doesNotMatch(f, /go\('batch'/, name + ' springt noch auf die Chargenseite');
      assert.match(
        f,
        /\bnbEnsureReady\(\)/,
        name + ' füllt das Formular, ohne es bereitzumachen — die Vorgaben überschrieben das Rezept'
      );
      assert.ok(
        f.indexOf('nbEnsureReady()') < f.indexOf('nbFillFromStrain('),
        name + ': Vorgaben nach dem Rezept — sie überschreiben es'
      );
    }
    // openStab nimmt denselben Helfer, damit es nur eine Fassung davon gibt.
    assert.match(
      hebeFunktion('openStab', SRC),
      /sub === 'new'\) nbEnsureReady\(\)/,
      'openStab hat seine eigene Fassung der Vorbereitung'
    );
  });

  it('der Knopf "Neue Charge" öffnet den geführten Ablauf, kein zweites Formular', () => {
    assert.match(
      SRC,
      /\$\('btn-batch-new'\)\.addEventListener\('click', wkbOpen\)/,
      'btn-batch-new führt nicht in den geführten Ablauf'
    );
    assert.match(
      SRC,
      /\$\('btn-lab-work'\)\.addEventListener\('click', \(\) => msQuickLaborNew\(\)\)/,
      'btn-lab-work führt nicht in den Schnelldialog'
    );
  });

  it('die Suche drückt den Leitknopf statt das Formular aufzuschlagen', () => {
    const f = hebeFunktion('gsPageIndex', SRC);
    assert.match(f, /querySelector\('\.btn-lead'\)/, 'der Suchindex kennt den Leitknopf nicht');
    assert.match(f, /lead: lead \? lead\.id : ''/, 'der Treffer trägt den Leitknopf nicht');
    // Und nennt den Seitenknopf: ohne ihn lief gsNav() in go(page, undefined).
    assert.match(f, /btn: nav\.id,\s*lead:/, 'der Leitknopf-Treffer nennt keinen Seitenknopf');
    assert.match(SRC, /if \(rec\.lead\) \{[\s\S]*?\.click\(\);/, 'ein Treffer mit Leitknopf drückt ihn nicht');
  });

  it('die Körnerbrut nimmt denselben Schluss wie jede Charge', () => {
    const f = hebeFunktion('createGrainBatch', SRC);
    assert.match(f, /\bnbPlaceAndPrint\(/, 'createGrainBatch hat wieder einen eigenen Schluss');
    assert.doesNotMatch(SRC, /function goToPrintGrainBatch/, 'der Sprung auf die Druckseite ist zurück');
  });

  it('das Fenster liegt im Markup vor dem Ablauffenster, wie m-batch-print', () => {
    const pos = (id) => HTML.indexOf('id="' + id + '"');
    for (const id of ['m-culture-print', 'm-work-flow', 'prt-cpr', 'prt-cpr-opts', 'cpr-later', 'cpr-close']) {
      assert.ok(pos(id) > -1, id + ' nicht in index.html gefunden — der Test muss mitgeführt werden');
    }
    assert.ok(pos('m-culture-print') < pos('m-work-flow'), 'm-culture-print läge über dem Ablauffenster');
    // Die Ergebniskarten im langen Formular sind weg — sonst gäbe es wieder zwei
    // Stellen für dasselbe Etikett.
    for (const id of ['lw-result', 'gs-result', 'prt-lw', 'prt-gs']) {
      assert.equal(pos(id), -1, id + ' steht noch im Formular — zwei Stellen für dasselbe Etikett');
    }
  });

  it('die Arbeitsgänge stehen auf der Startseite zuoberst', () => {
    // Am Telefon ist das Erste im Bild das, was man gleich tut; was ansteht,
    // folgt darunter.
    const seite = HTML.slice(HTML.indexOf('id="p-work"'), HTML.indexOf('id="p-dash"'));
    const kacheln = seite.indexOf('class="wk-tiles"');
    const liste = seite.indexOf('class="dash-top-row"');
    assert.ok(
      kacheln > -1 && liste > -1,
      'Kacheln oder Tagesliste nicht auf p-work gefunden — der Test muss mitgeführt werden'
    );
    assert.ok(kacheln < liste, 'die Tagesliste steht wieder über den Kacheln');
  });
});
