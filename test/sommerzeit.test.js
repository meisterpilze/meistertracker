'use strict';
// Ein Tag ist nicht immer 24 Stunden.
//
// In der Nacht der Umstellung sind es 23 oder 25, und drei Stellen dieser App
// rechneten Datumsreihen in festen 864e5 Millisekunden. Jede davon war still
// falsch, jede nur an ein bis zwei Tagen im Jahr, und keine wäre je durch eine
// Fehlermeldung aufgefallen:
//
//   – der Rückwärtsgang der Rückstände übersprang den Umstellungstag im
//     Frühjahr ganz, ein an ihm versäumter Termin war damit unsichtbar;
//   – der Wochenstreifen zeigte im Herbst denselben Sonntag zweimal und
//     verschwieg den Montag danach;
//   – der Anker einer neu angelegten Aufgabe landete einen Tag zu früh, also
//     auf dem falschen Wochentag — und da der Anker den Wochentag BESTIMMT,
//     lief die Aufgabe von da an dauerhaft am falschen Tag.
//
// recurringDueOn() rechnet aus genau diesem Grund in UTC. Seine Aufrufer taten
// es nicht, und das war die Hälfte, die kein Test angesehen hat.
//
// Die Zeitzone wird hier gesetzt, nicht geraten: `node --test` gibt jeder Datei
// einen eigenen Prozess, also bleibt das auf diese Datei beschränkt.
process.env.TZ = 'Europe/Berlin';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebe, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle('app.js');

function werkzeug(tasks) {
  const code =
    hebe([[/^const RECURRING_LOOKBACK_DAYS = \d+;$/m, 'RECURRING_LOOKBACK_DAYS']], SRC) +
    '\n' +
    hebeFunktion('addDays', SRC) +
    '\n' +
    hebeFunktion('_ymd', SRC) +
    '\n' +
    hebeFunktion('recurringDueOn', SRC) +
    '\n' +
    hebeFunktion('recurringDoneOn', SRC) +
    '\n' +
    hebeFunktion('recurringArrears', SRC) +
    '\nreturn { recurringArrears, addDays, _ymd };';
  return new Function('recurringTasks', code)(tasks || []);
}

const TAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const mitternacht = (s) => {
  const d = new Date(s + 'T00:00:00');
  d.setHours(0, 0, 0, 0);
  return d;
};

describe('Die Umstellung im Frühjahr', () => {
  // 2026-03-29 ist die Nacht mit 23 Stunden.
  it('lässt den Umstellungstag im Rückwärtsgang nicht aus', () => {
    const { addDays, _ymd } = werkzeug();
    const von = mitternacht('2026-03-30');
    const reihe = [1, 2, 3].map((b) => _ymd(addDays(von, -b)));
    assert.deepEqual(reihe, ['2026-03-29', '2026-03-28', '2026-03-27']);
  });

  it('meldet einen an ihm versäumten Termin', () => {
    // Vorher lief der Rückwärtsgang an ihm vorbei, fand den bereits abgehakten
    // Sonntag davor und brach ab — der wirklich versäumte Tag verschwand, und
    // zwar für immer, weil Rückstände nur den jüngsten Termin ansehen.
    const { recurringArrears } = werkzeug([
      { id: 1, name: 'Putzen', everyWeeks: 1, anchor: '2026-03-01', active: true, done: ['2026-03-22'] }
    ]);
    assert.deepEqual(
      recurringArrears(mitternacht('2026-03-30')).map((x) => x.date),
      ['2026-03-29']
    );
  });
});

describe('Die Umstellung im Herbst', () => {
  // 2026-10-25 ist die Nacht mit 25 Stunden.
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
