'use strict';
// Ein Beutel-Etikett mit dem alten Text-Strichcode (KUERZEL_MMDD_N) findet
// seinen Beutel wieder.
//
// Bloecke aus einem Substratansatz werden nur so breit gezaehlt, wie die Charge
// gross ist: bei acht Bloecken heisst der siebte "-7", nicht "-07". Der Scan
// machte aus "_7" aber immer "-07" und suchte einen Beutel, den es nicht gibt —
// "nicht im System" ueber einem Block, der im Regal stand. Und er nahm die
// erste Charge mit Kuerzel und Tag, auch wenn es an dem Tag zwei gab.
//
// Kuerzel, Chargen und Beutel hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();

function mit(batches) {
  const spAbbrev = (s) =>
    String(s || '')
      .slice(0, 2)
      .toUpperCase();
  return new Function(
    'batches',
    'spAbbrev',
    _hf('legacyBagMatch', APP) + '\n' + _hf('_batchMmdd', APP) + '\nreturn legacyBagMatch;'
  )(batches, spAbbrev);
}

const charge = (batchId, n, breite, extra) => ({
  batchId,
  strainKuerzel: batchId.split('-')[0],
  bags: Array.from({ length: n }, (_, i) => batchId + '-' + String(i + 1).padStart(breite, '0')),
  ...extra
});

describe('legacyBagMatch', () => {
  it('"_7" findet Beutel -7 einer Charge mit acht Bloecken', () => {
    const match = mit([charge('TA-081026-01', 8, 1)]);
    assert.deepEqual(match('TA-1008-7'), { bag: 'TA-081026-01-7', batch: 'TA-081026-01' });
  });

  it('"_7" findet weiter Beutel -07 einer Charge mit zweistelliger Zaehlung', () => {
    const match = mit([charge('TA-081026-01', 12, 2)]);
    assert.deepEqual(match('TA-1008-7'), { bag: 'TA-081026-01-07', batch: 'TA-081026-01' });
  });

  it('zwei Chargen vom selben Tag mit Beutel 3: nicht raten, sondern sagen', () => {
    const match = mit([charge('TA-211026-01', 10, 2), charge('TA-211026-02', 3, 1)]);
    assert.deepEqual(match('TA-1021-3'), { ambiguous: ['TA-211026-01-03', 'TA-211026-02-3'] });
  });

  it('zwei Chargen vom selben Tag, aber nur eine hat Beutel 9: die', () => {
    const match = mit([charge('TA-211026-01', 10, 2), charge('TA-211026-02', 3, 1)]);
    assert.deepEqual(match('TA-1021-9'), { bag: 'TA-211026-01-09', batch: 'TA-211026-01' });
  });

  it('die Charge gibt es, den Beutel nicht: weiterreichen wie bisher', () => {
    const match = mit([charge('TA-081026-01', 8, 1)]);
    assert.deepEqual(match('TA-1008-12'), { bag: 'TA-081026-01-12', batch: 'TA-081026-01' });
  });

  it('keine passende Charge, und kein alter Strichcode', () => {
    const match = mit([charge('TA-081026-01', 8, 1)]);
    assert.deepEqual(match('TB-1008-7'), {});
    assert.equal(match('TA-081026-01-7'), null);
    assert.equal(match('INC'), null);
  });
});

describe('Drucken: erst die Nummern holen', () => {
  it('jeder Weg, der Beutel-Etiketten druckt, fragt vorher nach den Nummern', () => {
    for (const name of ['printBatchLabelsInline', 'printNewBags', 'printBagLabels', 'printCultureLabelsInline']) {
      const f = _hf(name, APP);
      const vorher = f.indexOf('await ensureBagBarcodes(');
      assert.ok(vorher !== -1, name + ' holt die Nummern nicht');
      assert.ok(vorher < f.indexOf('makeBagZPL('), name + ' holt die Nummern erst nach dem Bauen');
    }
  });
});
