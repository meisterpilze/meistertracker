'use strict';
// Ein Tag ist nicht immer 24 Stunden.
//
// In der Nacht der Umstellung sind es 23 oder 25, und fünf Stellen dieser App
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
//     lief die Aufgabe von da an dauerhaft am falschen Tag;
//   – der Wochenrhythmus trug den Umstellungssonntag im Frühjahr nicht nach:
//     öffnete an ihm niemand die App, bekam er nie seine Zeile, und was an ihm
//     verlangt war, fehlte im Rückstand;
//   – der Kalendereintrag einer Charge, die in der ersten Stunde des
//     Umstellungssonntags im Herbst fällig war, endete an dem Tag, an dem er
//     begann.
//
// Zwei Rechenarten, zwei Regeln. Termine liegen auf Kalendertagen im Abstand
// ganzer Wochen: die rechnet der Server in UTC, wo eine Woche immer 7 x 864e5
// ist. Der Wochenstreifen und der Anker sind Ortszeit — dort zählt der
// Kalender, also addDays() und nicht Millisekunden. Der Rückblick des
// Wochenrhythmus läuft zwar auf dem Server, zählt aber Ortstage, also gilt für
// ihn dasselbe.
//
// Die Zeitzone wird hier gesetzt, nicht geraten: `node --test` gibt jeder Datei
// einen eigenen Prozess, also bleibt das auf diese Datei beschränkt.
process.env.TZ = 'Europe/Berlin';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
// Ein Kalendertag `n` Tage nach `s`, beide YYYY-MM-DD. In UTC gezählt, wo jeder
// Tag 864e5 hat — so rechnet der Test seine Erwartung nicht mit dem Fehler aus,
// den er sucht.
const kalendertag = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

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

describe('Der Wochenrhythmus über eine Umstellung', () => {
  // ensureRhythmTasks() hält heute und die vierzehn Tage davor fest, damit ein
  // versäumter Tag eine Zeile ist, die nachwirkt, und keine Lücke. Es zählte
  // rückwärts ab Mitternacht in festen 864e5 und landete über den Tag mit 23
  // Stunden um 23 Uhr am Vortag: zwei Wochen lang kam der Umstellungssonntag
  // nicht vor, dafür ein fünfzehnter Tag am anderen Ende.
  //
  // Bemerkt hat es db.test.js, das in diesen zwei Wochen in Berliner Zeit rot
  // wird. Die CI hätte es nie gesehen: sie läuft in UTC.
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_sommerzeit_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    // Jeder Wochentag mit einer Menge, damit jeder Tag im Fenster eine Zeile
    // bekommt und eine fehlende auffällt.
    const m = {};
    for (let i = 0; i < 7; i++) m[i] = { theme: 'substrate', targetQty: 45 };
    db.setWeekRhythm(d, m);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  // Was ensureRhythmTasks() an `jetzt` anlegt, von einem leeren Stand aus.
  const angelegt = (jetzt) => {
    d.prepare('DELETE FROM rhythm_task').run();
    db.ensureRhythmTasks(d, jetzt);
    return db.listRhythmTasks(d);
  };
  // Heute und die vierzehn Kalendertage davor.
  const fenster = (heute) => Array.from({ length: 15 }, (_, i) => kalendertag(heute, i - 14));

  it('trägt den Umstellungssonntag im Frühjahr nach', () => {
    // 2027-03-28 ist die Nacht mit 23 Stunden. Am Mittwoch danach reichte der
    // Rückblick vom 16. bis zum 31. März und liess den 28. aus.
    const tage = angelegt(new Date(2027, 2, 31, 12)).map((r) => r.date);
    assert.ok(tage.includes('2027-03-28'), 'der Umstellungssonntag fehlt');
    assert.deepEqual(tage, fenster('2027-03-31'));
  });

  it('reicht um beide Umstellungen herum genau vierzehn Tage zurück', () => {
    // Jeder Tag vom Vortag der Umstellung, bis sie aus dem Fenster gefallen ist,
    // und an jedem kurz nach Mitternacht, mittags und spät am Abend.
    for (const vortag of ['2027-03-27', '2026-10-24']) {
      for (let n = 0; n <= 16; n++) {
        const heute = kalendertag(vortag, n);
        for (const uhr of ['00:30', '12:00', '23:30']) {
          const zeilen = angelegt(new Date(heute + 'T' + uhr + ':00'));
          const tage = zeilen.map((r) => r.date);
          assert.deepEqual(tage, fenster(heute), 'am ' + heute + ' um ' + uhr);
          for (const r of zeilen) {
            const echt = new Date(r.date + 'T00:00:00Z').getUTCDay();
            assert.equal(r.weekday, echt, r.date + ' ist ein ' + TAG[echt] + ', nicht ' + TAG[r.weekday]);
          }
        }
      }
    }
  });
});

describe('Der Kalendereintrag einer Charge über eine Umstellung', () => {
  // batchToVEVENT() trägt die Fälligkeit als ganztägigen Termin ein, und ein
  // ganztägiger Termin endet am Tag nach seinem letzten (RFC 5545). Dieses Ende
  // war die Fälligkeit plus 864e5, als Berliner Datum gelesen. Lag sie in der
  // ersten Stunde des Umstellungssonntags im Herbst — wie eine um Mitternacht
  // gespeicherte —, endete der Termin an dem Tag, an dem er begann. Lag sie in
  // der letzten Stunde des Samstags vor der Umstellung im Frühjahr, endete er
  // einen Tag zu spät.
  const SERVER = quelle('server.js');
  const batchToVEVENT = new Function(
    ['_berlinDateCompact', '_nextDayCompact', 'escapeIcsText', 'foldIcsLines', 'batchToVEVENT']
      .map((name) => hebeFunktion(name, SERVER))
      .join('\n') + '\nreturn batchToVEVENT;'
  )();
  // [DTSTART, DTEND] als YYYY-MM-DD, für eine Charge, die zu `due` fällig ist.
  const ganztags = (due) => {
    const { ics } = batchToVEVENT({ batchId: 'T-01', due: due.toISOString() }, null);
    return [/DTSTART;VALUE=DATE:(\d{8})/, /DTEND;VALUE=DATE:(\d{8})/].map((re) =>
      ics.match(re)[1].replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
    );
  };

  it('endet am Tag nach einer Fälligkeit um Mitternacht der Herbst-Umstellung', () => {
    // 2026-10-25 ist die Nacht mit 25 Stunden.
    assert.deepEqual(ganztags(mitternacht('2026-10-25')), ['2026-10-25', '2026-10-26']);
  });

  it('endet um beide Umstellungen herum immer genau einen Tag später', () => {
    // Jede Viertelstunde von zwei Tagen vor der Umstellung bis zwei Tage danach.
    for (const umstellung of ['2027-03-28', '2026-10-25']) {
      const bis = Date.parse(kalendertag(umstellung, 3) + 'T00:00:00Z');
      for (let t = Date.parse(kalendertag(umstellung, -2) + 'T00:00:00Z'); t < bis; t += 15 * 60000) {
        const [start, ende] = ganztags(new Date(t));
        assert.equal(ende, kalendertag(start, 1), 'fällig ' + new Date(t).toISOString());
      }
    }
  });
});
