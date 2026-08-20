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

module.exports = { ROOT, quelle, hebe };
