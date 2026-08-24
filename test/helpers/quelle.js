'use strict';
// Funktionen aus der Quelle heben.
//
// app.js hat keine Modulgrenze — kein module.exports, kein import, eine Datei,
// die der Browser als Ganzes lädt. Um einzelne Funktionen daraus zu prüfen,
// schneidet der Test sie per regulärem Ausdruck heraus und lässt sie gegen
// Attrappen laufen. server.js hat zwar eine Modulgrenze, exportiert aber nicht
// alles, was zu prüfen wäre, also gilt dort dasselbe.
//
// Dieses Vorgehen stand wortgleich in sechs Testdateien. Hier steht es einmal.
// Die Attrappen bleiben Sache der jeweiligen Datei — sie sind der Teil, der sich
// von Test zu Test wirklich unterscheidet, und der gehört dorthin, wo man ihn
// beim Lesen des Tests braucht.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');

// Der Text einer Quelldatei. Ohne Angabe app.js.
function quelle(datei) {
  return fs.readFileSync(path.join(ROOT, datei || 'app.js'), 'utf8');
}

// `teile` ist eine Liste aus [regulärer Ausdruck, Name]. Der Name landet in der
// Fehlermeldung: ein Fehlschlag soll sagen, welche Funktion umgezogen oder
// umbenannt wurde, statt später als "unexpected token" aus dem Zusammenbau zu
// fallen. Die Reihenfolge in der Liste ist die Reihenfolge im Ergebnis — wer
// eine andere Funktion aufruft, muss hinter ihr stehen.
function hebe(teile, src) {
  const s = src === undefined ? quelle() : src;
  return teile
    .map(([re, name]) => {
      const m = s.match(re);
      assert.ok(m, name + ' nicht in der Quelle gefunden — der Test muss mitgeführt werden');
      return m[0];
    })
    .join('\n');
}

// Eine benannte Funktion aus der Quelle, samt Rumpf.
//
// Beide Helfer standen zuletzt in drei Testdateien, wortgleich gemeint und in
// drei Fassungen: eine passte nur auf Funktionen ohne Parameter, zwei auf
// beliebige, und die zwei Konstanten-Fassungen unterschieden sich in der
// Klammerklasse. Sie stehen jetzt einmal hier.
function hebeFunktion(name, src) {
  const s = src === undefined ? quelle() : src;
  // `async` mit: ohne das Präfix meldete der Helfer eine Funktion als
  // verschwunden, sobald sie ein await bekam — und die Fehlermeldung sagte dann
  // "der Test muss mitgeführt werden", was in die Irre führt.
  const m = s.match(new RegExp('^(?:async )?function ' + name + '\\([\\s\\S]*?\\r?\\n\\}', 'm'));
  assert.ok(m, name + '() nicht in der Quelle gefunden — der Test muss mitgeführt werden');
  return m[0];
}

// Eine Konstante mit Objekt- oder Array-Literal.
//
// Die schließende Klammer muss am Zeilenanfang stehen. Das ist nicht Kosmetik:
// die frühere Fassung endete bei der ERSTEN Zeile, die auf `}` oder `]` endet,
// und traf damit bei einem verschachtelten Literal ohne nachgestelltes Komma —
//
//     SY: { bg: '#ebf3f4', fg: '#2c626c', accent: '#478590' }
//
// — die innere Klammer der letzten Zeile. Herausgeschnitten wurde dann ein
// Literal ohne Abschluss, und der Fehler fiel erst als "Unexpected token" beim
// Zusammenbau auf, weit weg von seiner Ursache. Prettier setzt die schließende
// Klammer eines mehrzeiligen Literals immer auf Spalte 0.
function hebeKonstante(name, src) {
  const s = src === undefined ? quelle() : src;
  const einzeilig = s.match(new RegExp('^const ' + name + ' = [[{].*[\\]}];?$', 'm'));
  if (einzeilig) return einzeilig[0];
  const m = s.match(new RegExp('^const ' + name + ' = [[{][\\s\\S]*?\\r?\\n[\\]}];?$', 'm'));
  assert.ok(m, name + ' nicht in der Quelle gefunden — der Test muss mitgeführt werden');
  return m[0];
}

module.exports = { ROOT, quelle, hebe, hebeFunktion, hebeKonstante };
