'use strict';
// Hat die Woche ihr Ziel gebracht?
//
// Zwei Zahlen entscheiden: wie viele Beutel eine Woche bringen soll und ab wann
// gezählt wird. Das Ab-wann ist der Punkt — die Bestandsdaten dieser Anlage
// wurden zurückgesetzt, und ohne Startdatum stünde jede Woche davor als
// verfehlt da, obwohl niemand sie mehr ändern kann.
//
// Gerechnet wird Montag bis Sonntag, wie überall sonst in der App. Die laufende
// Woche zählt mit, aber als "läuft": eine Woche mit drei Tagen vor sich als
// verfehlt zu melden wäre eine Aussage über eine Zahl, die noch steigt.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle();

// heute: 'YYYY-MM-DD'. chargen: [{ created, qty, batchType }]
function wochen({ heute, ziel, von, chargen = [] }) {
  const code = [hebeFunktion('_montagVon', SRC), hebeFunktion('buildWeekBagGoal', SRC)].join('\n');
  return new Function(
    'inventory',
    'batches',
    'heute',
    `
    const RealDate = Date;
    // Nur der argumentlose Aufruf wird festgenagelt; new Date(x) muss weiter
    // rechnen, sonst misst der Test seine eigene Attrappe.
    Date = function (...a) { return a.length ? new RealDate(...a) : new RealDate(heute + 'T12:00:00'); };
    Date.prototype = RealDate.prototype;
    ${code}
    const r = buildWeekBagGoal();
    Date = RealDate;
    return r;
  `
  )({ weekBagGoal: ziel, bagCountFrom: von }, chargen, heute);
}

// Die Lage dieser Anlage: 70 Blöcke am 20. und 21.08.2026, davor nichts.
const ECHT = [
  { created: '2026-08-20T08:04:00', qty: 17, batchType: 'block' },
  { created: '2026-08-20T08:05:00', qty: 8, batchType: 'block' },
  { created: '2026-08-20T08:06:00', qty: 13, batchType: 'block' },
  { created: '2026-08-21T08:06:00', qty: 10, batchType: 'block' },
  { created: '2026-08-21T08:24:00', qty: 10, batchType: 'block' },
  { created: '2026-08-21T08:50:00', qty: 3, batchType: 'block' },
  { created: '2026-08-21T09:05:00', qty: 9, batchType: 'block' }
];

describe('Das Wochenziel', () => {
  it('schweigt, solange kein Ziel gesetzt ist', () => {
    assert.equal(wochen({ heute: '2026-08-23', ziel: 0, von: '2026-08-17', chargen: ECHT }), null);
  });

  it('schweigt auch ohne Startdatum', () => {
    // Ein Ziel ohne Anfang würde bis zur ersten Charge zurückrechnen.
    assert.equal(wochen({ heute: '2026-08-23', ziel: 70, von: null, chargen: ECHT }), null);
  });

  it('zählt die 70 Blöcke in die Woche, in der sie gemacht wurden', () => {
    // Der 20. und der 21.08.2026 liegen beide in der Woche ab Montag, dem 17.
    const w = wochen({ heute: '2026-08-23', ziel: 70, von: '2026-08-17', chargen: ECHT });
    assert.equal(w.length, 1, 'eine Woche seit dem Start');
    assert.equal(w[0].gemacht, 70);
    assert.equal(w[0].ziel, 70);
    assert.ok(w[0].geschafft, '70 von 70 ist geschafft');
  });

  it('nennt die laufende Woche laufend, statt sie zu bewerten', () => {
    // Am Sonntag ist die Woche ab dem 17. noch die laufende.
    const w = wochen({ heute: '2026-08-23', ziel: 70, von: '2026-08-17', chargen: ECHT });
    assert.ok(w[0].laeuft);
  });

  it('rechnet nichts vor dem Startdatum mit', () => {
    // Genau der Grund für das Startdatum: was vor dem Reset liegt, zählt nicht.
    const mitAlt = ECHT.concat([{ created: '2026-07-01T09:00:00', qty: 200, batchType: 'block' }]);
    const w = wochen({ heute: '2026-08-23', ziel: 70, von: '2026-08-17', chargen: mitAlt });
    assert.equal(w.length, 1, 'die alte Woche taucht nicht auf');
    assert.equal(w[0].gemacht, 70, 'und ihre 200 Beutel auch nicht');
  });

  it('führt jede Woche seit dem Start auf, auch die leeren', () => {
    // Eine Woche ohne Zeile wäre eine Woche, über die niemand nachfragt.
    const w = wochen({ heute: '2026-09-06', ziel: 70, von: '2026-08-17', chargen: ECHT });
    // Der 06.09.2026 ist ein Sonntag, sein Montag ist der 31.08. — also drei
    // Wochen, nicht vier. (Der erste Anlauf dieses Tests rechnete vier und lag
    // damit falsch, nicht der Code.)
    assert.equal(w.length, 3, '17., 24. und 31.08. — drei Montage');
    assert.equal(w[0].gemacht, 70);
    assert.ok(w[0].geschafft);
    assert.ok(!w[1].geschafft && !w[1].laeuft, 'die leere Woche danach ist verfehlt, nicht laufend');
    assert.ok(w[2].laeuft, 'nur die letzte läuft');
  });

  it('zählt Körner nicht als Beutel', () => {
    // "70 Beutel die Woche" meint Blöcke. Körnerbrut wird gewogen, und Gläser
    // in eine Beutelzahl zu addieren ist die Vermischung, die die Labor-Kachel
    // schon einmal falsch beschriftet hat.
    const mitKorn = ECHT.concat([{ created: '2026-08-20T10:00:00', qty: 40, batchType: 'grain' }]);
    assert.equal(wochen({ heute: '2026-08-23', ziel: 70, von: '2026-08-17', chargen: mitKorn })[0].gemacht, 70);
  });

  it('legt einen Start mitten in der Woche auf ihren Montag', () => {
    // Sonst wäre die erste Woche ein Rumpf aus drei Tagen, der das Ziel gar
    // nicht erreichen kann. db.updateWeekGoal() tut dasselbe beim Speichern.
    const w = wochen({ heute: '2026-08-23', ziel: 70, von: '2026-08-19', chargen: ECHT });
    assert.equal(w[0].gemacht, 70, 'der 20. gehoert in die Woche ab dem 17.');
  });
});

describe('Was beim Speichern festgehalten wird', () => {
  it('legt das Startdatum auf den Montag seiner Woche', () => {
    const fn = hebeFunktion('updateWeekGoal', quelle('db.js'));
    let gespeichert = null;
    const db = { prepare: () => ({ run: (...a) => (gespeichert = a) }) };
    const r = new Function('db', 'incrementDataVersion', fn + '\nreturn updateWeekGoal(db, 70, "2026-08-19");')(
      db,
      () => {}
    );
    assert.equal(r.bagCountFrom, '2026-08-17', 'Mittwoch wird Montag');
    assert.equal(r.weekBagGoal, 70);
    assert.deepEqual(gespeichert, [70, '2026-08-17']);
  });

  it('nimmt kein negatives Ziel an', () => {
    const fn = hebeFunktion('updateWeekGoal', quelle('db.js'));
    const db = { prepare: () => ({ run: () => {} }) };
    const r = new Function('db', 'incrementDataVersion', fn + '\nreturn updateWeekGoal(db, -5, null);')(db, () => {});
    assert.equal(r.weekBagGoal, 0);
    assert.equal(r.bagCountFrom, null, 'ohne Ziel auch kein Startdatum');
  });
});
