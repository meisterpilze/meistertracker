'use strict';
// Ein Tag ist nicht immer 24 Stunden.
//
// In der Nacht der Umstellung sind es 23 oder 25, und drei Stellen dieser App
// rechneten Datumsreihen in festen 864e5 Millisekunden. Jede davon war still
// falsch, jede nur an ein bis zwei Tagen im Jahr, und keine wäre je durch eine
// Fehlermeldung aufgefallen:
//
//   – die Terminreihe übersprang den Umstellungstag im Frühjahr ganz, ein an
//     ihm versäumter Termin war damit unsichtbar;
//   – der Wochenstreifen zeigte im Herbst denselben Sonntag zweimal und
//     verschwieg den Montag danach;
//   – der Anker einer neu angelegten Aufgabe landete einen Tag zu früh, also
//     auf dem falschen Wochentag — und da der Anker den Wochentag BESTIMMT,
//     lief die Aufgabe von da an dauerhaft am falschen Tag.
//
// Zwei Rechenarten, zwei Regeln. Termine liegen auf Kalendertagen im Abstand
// ganzer Wochen: die rechnet der Server in UTC, wo eine Woche immer 7 x 864e5
// ist. Der Wochenstreifen und der Anker sind Ortszeit — dort zählt der
// Kalender, also addDays() und nicht Millisekunden.
//
// Die Zeitzone wird hier gesetzt, nicht geraten: `node --test` gibt jeder Datei
// einen eigenen Prozess, also bleibt das auf diese Datei beschränkt.
process.env.TZ = 'Europe/Berlin';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');
const db = require('../db.js');

const SRC = quelle('app.js');

const werkzeug = () =>
  new Function(hebeFunktion('addDays', SRC) + '\n' + hebeFunktion('_ymd', SRC) + '\nreturn { addDays, _ymd };')();

const TAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const mitternacht = (s) => {
  const d = new Date(s + 'T00:00:00');
  d.setHours(0, 0, 0, 0);
  return d;
};

describe('Die Terminreihe über eine Umstellung', () => {
  it('lässt den Umstellungstag im Frühjahr nicht aus', () => {
    // 2026-03-29 ist die Nacht mit 23 Stunden. Ein wöchentlicher Sonntagstermin
    // fiel hier heraus, und weil Rückstände nur den jüngsten Termin ansehen,
    // war das an ihm Versäumte für immer unsichtbar.
    assert.deepEqual(db.recurringDueBetween('2026-03-08', 1, '2026-03-20', '2026-04-05'), [
      '2026-03-22',
      '2026-03-29',
      '2026-04-05'
    ]);
  });

  it('lässt den Umstellungstag im Herbst nicht doppelt vorkommen', () => {
    // 2026-10-25 ist die Nacht mit 25 Stunden.
    const reihe = db.recurringDueBetween('2026-10-04', 1, '2026-10-10', '2026-11-08');
    assert.deepEqual(reihe, ['2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08']);
    assert.equal(new Set(reihe).size, reihe.length, 'ein Datum kommt zweimal vor');
  });

  it('hält den Wochentag über beide Umstellungen', () => {
    const reihe = db.recurringDueBetween('2026-01-05', 1, '2026-01-05', '2026-12-28');
    assert.equal(reihe.length, 52);
    for (const d of reihe) {
      assert.equal(new Date(d + 'T00:00:00Z').getUTCDay(), 1, d + ' ist kein Montag mehr');
    }
  });
});

describe('Was der Browser in Ortszeit rechnet', () => {
  it('gibt der Woche sieben verschiedene Tage', () => {
    const { addDays, _ymd } = werkzeug();
    const von = mitternacht('2026-10-20');
    const woche = [0, 1, 2, 3, 4, 5, 6].map((o) => _ymd(addDays(von, o)));
    assert.equal(new Set(woche).size, 7, 'zwei Spalten trugen dasselbe Datum: ' + woche.join(', '));
    assert.equal(woche[6], '2026-10-26', 'der Montag nach der Umstellung fehlte ganz');
  });

  it('legt eine Aufgabe auf den Wochentag, den man gewählt hat', () => {
    // Am Sa 24.10. eine Montagsaufgabe anlegen: mit festen 864e5 landete der
    // Anker auf dem 25.10., einem Sonntag, und die Aufgabe lief von da an jeden
    // Sonntag. Korrigieren liess sich das nur durch Löschen und Neuanlegen.
    const { addDays, _ymd } = werkzeug();
    for (const start of ['2026-10-24', '2026-10-20', '2026-03-27', '2026-08-22']) {
      const heute = mitternacht(start);
      const wd = 1;
      const vor = (wd - heute.getDay() + 7) % 7;
      const anchor = _ymd(addDays(heute, vor));
      const echt = new Date(anchor + 'T00:00:00').getDay();
      assert.equal(echt, wd, 'am ' + start + ' angelegt ergab ' + anchor + ' = ' + TAG[echt]);
    }
  });
});
