'use strict';
// Beim Scannen eines Beutels steht sofort da, woraus er gemacht ist: die
// Kultur samt Kette, die Körnerbrut und der Substrat-Ansatz mit Soll- und
// Ist-Feuchte. Vorher stand das nur in der Chargenliste, und die Ist-Feuchte
// gar nicht. Die Funktionen werden aus app.js gehoben und gegen Attrappen
// geprüft; alle Kennungen und Zahlen sind erfunden.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hebeFunktion } = require('./helpers/quelle');

const NAMEN = ['spawnSourceFor', 'cultureChain', '_biChainHtml', 'grainSourcesFor', 'biHerkunftHtml', '_batchIstRhTag'];
const SRC = NAMEN.map((n) => hebeFunktion(n)).join('\n');

function bauen({ batches = [], cultures = [], scanLog = [], sbList = [] } = {}) {
  return new Function(`
    const batches = ${JSON.stringify(batches)};
    const cultures = ${JSON.stringify(cultures)};
    const scanLog = ${JSON.stringify(scanLog)};
    const _sbList = ${JSON.stringify(sbList)};
    const esc = (s) => String(s);
    const t = (k, p) => (p ? k + ' ' + JSON.stringify(p) : k);
    const fmtKg = (v, d) => Number(v).toFixed(d);
    const fmtDt = (d) => 'DATUM(' + d + ')';
    const ctBadge = (ty) => '[' + ty + ']';
    ${SRC}
    return { biHerkunftHtml, cultureChain, grainSourcesFor, _batchIstRhTag, batches };
  `)();
}

const KULTUREN = [
  { id: 'MC-901', type: 'MC', parentId: null },
  { id: 'LC-902', type: 'LC', parentId: 'MC-901' }
];
const KOERNER = {
  batchId: 'GR-910',
  batchType: 'grain',
  bags: ['GR-910-1', 'GR-910-2'],
  grainRh: 50,
  sourceId: 'LC-902'
};
const BLOCK = {
  batchId: 'BL-920',
  batchType: 'block',
  bags: ['BL-920-1'],
  sourceId: null,
  substrateSubId: 'SUB-TEST-01',
  substrate: { hardwood: 75, wheatbran: 25, rh: 59 },
  created: '2026-01-02T08:00:00Z'
};
const ANSATZ = {
  subId: 'SUB-TEST-01',
  recipeLabel: 'Testmischung',
  composition: { rhPct: 59 },
  moisturePct: 59,
  actualRhPct: 60.4
};
const SPAWN = [
  { action: 'REMOVE', reason: 'spawn:BL-920', bag: 'GR-910-1' },
  { action: 'REMOVE', reason: 'spawn:BL-920', bag: 'GR-910-2' },
  { action: 'REMOVE', reason: 'spawn:ANDERE', bag: 'GR-999-1' }
];

describe('Herkunft beim Scannen', () => {
  const app = bauen({ batches: [KOERNER, BLOCK], cultures: KULTUREN, scanLog: SPAWN, sbList: [ANSATZ] });
  const html = app.biHerkunftHtml(BLOCK);

  it('nennt die Körnerbrut-Charge statt einzelner Beutel, mit Anzahl und Feuchte', () => {
    const g = app.grainSourcesFor('BL-920');
    assert.equal(g.length, 1);
    assert.equal(g[0].batch.batchId, 'GR-910');
    assert.equal(g[0].bags.length, 2);
    assert.match(html, /GR-910/);
    assert.match(html, /bagInfo\.nBags \{"n":2\}/);
    assert.match(html, /RH 50 %/);
  });

  it('zeigt die Kultur der Körnerbrut mit ihrer ganzen Kette', () => {
    assert.deepEqual(
      app.cultureChain('LC-902').map((x) => x.id),
      ['MC-901', 'LC-902']
    );
    assert.match(html, /bagInfo\.grainCulture/);
    assert.ok(html.indexOf('MC-901') < html.indexOf('LC-902'));
  });

  it('zeigt den Ansatz mit Soll- und gemessener Ist-Feuchte', () => {
    assert.match(html, /SUB-TEST-01/);
    assert.match(html, /bagInfo\.rhTarget 59 %/);
    assert.match(html, /bagInfo\.rhActual 60\.4 %/);
  });

  it('sagt es, wenn noch nicht gemessen wurde', () => {
    const ohne = bauen({ batches: [BLOCK], sbList: [{ ...ANSATZ, actualRhPct: null }] });
    assert.match(ohne.biHerkunftHtml(BLOCK), /bagInfo\.rhActual sub\.rhNotMeasured/);
    assert.equal(ohne._batchIstRhTag(BLOCK), '');
  });

  it('nennt eine Kultur, die nicht mehr in der Liste steht, trotzdem', () => {
    const app2 = bauen({ cultures: [] });
    assert.deepEqual(app2.cultureChain('LC-777'), [{ id: 'LC-777', type: 'LC' }]);
  });

  it('trägt die Ist-Feuchte auch in die Chargenliste', () => {
    assert.match(app._batchIstRhTag(BLOCK), /bagInfo\.rhActual 60\.4%/);
  });
});
