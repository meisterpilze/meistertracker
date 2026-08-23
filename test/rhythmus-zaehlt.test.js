'use strict';
// Der Rhythmus zählt, was gemacht wurde — er fragt nicht danach.
//
// Vorher trug jede Rhythmus-Zeile eine eigene Zahl, die nur der
// "Erfassen"-Knopf bewegte. Wer 70 Blöcke ansetzte und nicht daneben eintippte,
// dass er es getan hatte, sah den Montag weiter als offen stehen — die Anlage
// führte zwei Buchhaltungen über dieselbe Arbeit, und die zweite war die, die
// niemand pflegt. Genau das ist auf diesem Betrieb passiert: 36 offen vom 10.
// und vom 17.08., während in derselben Woche 70 Blöcke entstanden waren.
//
// Jetzt abgeleitet, wie die Versorgungslücken und die Labor-Untergrenzen: es
// gibt nichts einzutippen und nichts zu vergessen.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const SRC = quelle();
const hebe = (n) => _hf(n, SRC);

function messen({ theme, datum, batches = [], scanLog = [], harvests = [], cultures = [], zones = {} }) {
  const code = [hebe('_ymd'), hebe('rhythmMadeOn')].join('\n');
  return new Function(
    'batches',
    'scanLog',
    'harvests',
    'cultures',
    'ZONE_BY_ID',
    'datum',
    'theme',
    `
    const toZone = (x) => x;
    const _grainKgOf = (b) => (b.qty || 0) * (b.bagKg || 1);
    ${code}
    return rhythmMadeOn(datum, theme);
  `
  )(batches, scanLog, harvests, cultures, zones, datum, theme);
}

const TAG = '2026-08-20';

describe('Was der Rhythmus an einem Tag zählt', () => {
  it('zählt am Substrattag die Blöcke, die angesetzt wurden', () => {
    // Die Lage dieses Betriebs: 38 Blöcke am 20.08. Der Montag davor stand auf
    // 36 offen, obwohl in derselben Woche mehr als das entstanden war.
    const n = messen({
      theme: 'substrate',
      datum: TAG,
      batches: [
        { created: TAG + 'T08:04:00', qty: 17, batchType: 'block' },
        { created: TAG + 'T08:05:00', qty: 8, batchType: 'block' },
        { created: TAG + 'T08:06:00', qty: 13, batchType: 'block' }
      ]
    });
    assert.equal(n, 38);
  });

  it('lässt Chargen anderer Tage aus', () => {
    const n = messen({
      theme: 'substrate',
      datum: TAG,
      batches: [
        { created: TAG + 'T08:04:00', qty: 17, batchType: 'block' },
        { created: '2026-08-21T08:06:00', qty: 32, batchType: 'block' }
      ]
    });
    assert.equal(n, 17, 'der 21. gehört dem 21.');
  });

  it('zählt am Substrattag keine Körner mit', () => {
    // Körnerbrut wird gewogen, Blöcke werden gezählt. Beides in eine Zahl zu
    // addieren ist die Vermischung, die die Labor-Kachel schon einmal falsch
    // beschriftet hat.
    const n = messen({
      theme: 'substrate',
      datum: TAG,
      batches: [
        { created: TAG + 'T08:04:00', qty: 17, batchType: 'block' },
        { created: TAG + 'T09:00:00', qty: 40, batchType: 'grain' }
      ]
    });
    assert.equal(n, 17);
  });

  it('zählt am Körnertag die Kilogramm, nicht die Gläser', () => {
    const n = messen({
      theme: 'grain',
      datum: TAG,
      batches: [{ created: TAG + 'T09:00:00', qty: 20, bagKg: 3, batchType: 'grain' }]
    });
    assert.equal(n, 60, '20 Gläser zu 3 kg sind 60 kg');
  });

  it('zählt am Fruchtungstag die Beutel, die in eine Fruchtungszone gezogen sind', () => {
    const n = messen({
      theme: 'fruiting',
      datum: TAG,
      zones: { TENT1: { role: 'fruiting' }, INC: { role: 'incubation' } },
      scanLog: [
        { time: TAG + 'T10:00:00', action: 'MOVE', bag: 'a', to: 'TENT1' },
        { time: TAG + 'T10:01:00', action: 'MOVE', bag: 'b', to: 'TENT1' },
        { time: TAG + 'T10:02:00', action: 'MOVE', bag: 'c', to: 'INC' },
        { time: TAG + 'T10:03:00', action: 'ADD', bag: 'd', to: 'TENT1' },
        { time: '2026-08-19T10:00:00', action: 'MOVE', bag: 'e', to: 'TENT1' }
      ]
    });
    assert.equal(n, 2, 'nur Umzüge, nur in die Fruchtung, nur an dem Tag');
  });

  it('zählt am Erntetag die erfassten Ernten', () => {
    const n = messen({
      theme: 'harvest',
      datum: TAG,
      harvests: [{ time: TAG + 'T11:00:00' }, { time: TAG + 'T12:00:00' }, { time: '2026-08-19T11:00:00' }]
    });
    assert.equal(n, 2);
  });

  it('zählt am Labortag die angelegten Kulturen', () => {
    const n = messen({
      theme: 'lab',
      datum: TAG,
      cultures: [{ created: TAG + 'T13:00:00' }, { created: '2026-08-01T13:00:00' }]
    });
    assert.equal(n, 1);
  });

  it('zählt an einem freien Tag nichts', () => {
    const n = messen({
      theme: 'free',
      datum: TAG,
      batches: [{ created: TAG + 'T08:04:00', qty: 17, batchType: 'block' }]
    });
    assert.equal(n, 0);
  });

  it('stolpert nicht über ein kaputtes Datum', () => {
    const n = messen({
      theme: 'substrate',
      datum: TAG,
      batches: [
        { created: 'Montag', qty: 5, batchType: 'block' },
        { created: null, qty: 5 }
      ]
    });
    assert.equal(n, 0);
  });
});

describe('Was noch offen ist', () => {
  function offen({ heute, aufgaben, batches = [], ab = null }) {
    const code = [hebe('_ymd'), hebe('rhythmMadeOn'), hebe('rhythmCountsFrom'), hebe('rhythmArrears')].join('\n');
    return new Function(
      'rhythmTasks',
      'batches',
      'inventory',
      'heute',
      `
      const scanLog = [], harvests = [], cultures = [], ZONE_BY_ID = {};
      const toZone = (x) => x;
      const _grainKgOf = (b) => (b.qty || 0) * (b.bagKg || 1);
      ${code}
      return rhythmArrears(new Date(heute + 'T12:00:00'));
    `
    )(aufgaben, batches, { bagCountFrom: ab }, heute);
  }

  const MONTAG = { date: '2026-08-17', weekday: 1, theme: 'substrate', targetQty: 36 };
  const DAVOR = { date: '2026-08-10', weekday: 1, theme: 'substrate', targetQty: 36 };

  it('schließt einen Montag, an dessen Woche genug entstanden ist', () => {
    // 38 Blöcke am 20.08. — das ist mehr als die 36, die der 17. wollte. Der
    // Tag selbst zählt, nicht die Woche: hier fällt beides zusammen, weil die
    // Aufgabe auf dem Tag steht, an dem gearbeitet wurde.
    const r = offen({
      heute: '2026-08-23',
      aufgaben: [{ ...MONTAG, date: '2026-08-20' }],
      batches: [{ created: '2026-08-20T08:04:00', qty: 38, batchType: 'block' }]
    });
    assert.deepEqual(r, [], 'nichts offen, ohne dass jemand etwas eintippen musste');
  });

  it('lässt einen Tag offen, an dem wirklich nichts entstand', () => {
    const r = offen({ heute: '2026-08-23', aufgaben: [MONTAG], batches: [] });
    assert.equal(r.length, 1);
    assert.equal(r[0].outstanding, 36);
    assert.equal(r[0].doneQty, 0);
  });

  it('rechnet den Rest, wenn ein Tag halb geschafft ist', () => {
    const r = offen({
      heute: '2026-08-23',
      aufgaben: [MONTAG],
      batches: [{ created: '2026-08-17T08:00:00', qty: 20, batchType: 'block' }]
    });
    assert.equal(r[0].outstanding, 16, '36 gewollt, 20 gemacht');
  });

  it('lässt alles vor dem Startdatum aus', () => {
    // Der 10.08. liegt vor der Inbetriebnahme. Daran ist nichts nachzuholen,
    // und eine Zeile, die das jeden Tag verlangt, ist nur Lärm.
    const r = offen({ heute: '2026-08-23', aufgaben: [DAVOR, MONTAG], batches: [], ab: '2026-08-17' });
    assert.deepEqual(
      r.map((x) => x.date),
      ['2026-08-17']
    );
  });

  it('zeigt ohne Startdatum weiterhin alles', () => {
    const r = offen({ heute: '2026-08-23', aufgaben: [DAVOR, MONTAG], batches: [] });
    assert.equal(r.length, 2);
  });
});
