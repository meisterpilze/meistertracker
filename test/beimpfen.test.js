'use strict';
// Beimpfen: aus einer Kultur vieles auf einmal.
//
// Aus dem Glas in eine Spritze, und daraus gehen etwa Körnerbeutel, neue
// Flüssigkulturen und Petrischalen in einem Durchgang am Tisch. Bisher hieß das:
// für jede Art den Dialog öffnen und dieselbe Spritze neu scannen — und eine
// Spritze durfte gar keine Körnerbrut beimpfen.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');
const db = require('../db');

const APP = quelle();
const HTML = quelle('index.html');
const hebe = (n) => _hf(n, APP);
const LAB = APP.match(/const LAB_PARENT_TYPES = \{[\s\S]*?\n\};/)[0];

const arten = (type) => new Function(`${LAB}\n${hebe('bmpArten')}\nreturn bmpArten(${JSON.stringify(type)});`)();

describe('Beimpfen: was woraus', () => {
  it('eine Spritze beimpft Körnerbrut, Flüssigkultur und Petrischale, aber keine Spritze', () => {
    assert.deepEqual(arten('SY'), ['KB', 'LC', 'PD']);
  });
  it('eine Flüssigkultur alles vier', () => {
    assert.deepEqual(arten('LC'), ['KB', 'LC', 'PD', 'SY']);
  });
  it('ein Slant keine Körnerbrut, wie bisher', () => {
    assert.deepEqual(arten('MC'), ['LC', 'PD', 'SY']);
  });
  it('die Körnerbrut-Auswahl im Formular nimmt Spritzen mit', () => {
    assert.doesNotMatch(APP, /fillCultureSelect\('gs-culture', \['PD', 'LC', 'GS'\]\)/);
    assert.match(APP, /fillCultureSelect\('gs-culture', \['PD', 'LC', 'SY', 'GS'\]\)/);
  });
});

describe('Beimpfen: ein Tipp legt alles an', () => {
  function lauf(n, kg) {
    return new Function(
      'n',
      'kg',
      `
      const angelegt = [];
      const korn = [];
      const fenster = [];
      const gesetzt = {};
      const SY = { id: 'SY-KO-KOKQ07-011026-01', type: 'SY', strainId: 2, strainText: 'KOKQ07', status: 'active' };
      const cultures = [SY];
      const mushroomStrains = [{ id: 2, name: 'King Oyster', kuerzel: 'KO', recGrainRhPct: 52 }];
      let _bmp = { id: SY.id, n: n, kg: kg };
      let _inoc = [];
      const t = (k) => k;
      const toast = () => {};
      const fieldError = () => {};
      const _bmpLesen = () => {};
      const _bmpMerken = () => {};
      const bmpClose = () => { _bmp = Object.assign({}, _bmp); };
      const anlageLesen = () => '';
      const anlageZeitpunkt = () => new Date(2026, 9, 1, 12);
      const kulturenAnlegen = (spec) => {
        angelegt.push(spec);
        return { newC: Array.from({ length: spec.qty }, (_, i) => ({ id: spec.type + '-' + (i + 1) })), saved: Promise.resolve() };
      };
      const document = { getElementById: (id) => ({ set value(v) { gesetzt[id] = v; } }) };
      const gsSetLines = (l) => { gesetzt.lines = l; };
      const createGrainBatch = (o) => { korn.push({ o, inoc: _inoc.slice() }); return { batchObj: { batchId: 'G-1' }, bagIds: ['G-1-01'] }; };
      const renderLabLog = () => {};
      const nbPlaceAndPrint = (b, bags) => fenster.push(['korn', b.batchId, bags.length]);
      const cprShow = (ids, saved, danach) => fenster.push(['etiketten', ids.length, typeof danach]);
      ${hebe('bmpGo')}
      bmpGo();
      return { angelegt, korn, fenster, gesetzt };
    `
    )(n, kg);
  }

  it('4 Körnerbeutel, 3 Flüssigkulturen, 10 Petrischalen aus einer Spritze', () => {
    const r = lauf({ KB: 4, LC: 3, PD: 10 }, 1.5);
    assert.deepEqual(
      r.angelegt.map((s) => [s.type, s.qty, s.parentId, s.strainText]),
      [
        ['LC', 3, 'SY-KO-KOKQ07-011026-01', 'KOKQ07'],
        ['PD', 10, 'SY-KO-KOKQ07-011026-01', 'KOKQ07']
      ]
    );
    assert.equal(r.korn.length, 1);
    assert.deepEqual(r.korn[0].o, { ohneFenster: true });
    assert.deepEqual(
      r.korn[0].inoc,
      [{ kind: 'culture', id: 'SY-KO-KOKQ07-011026-01' }],
      'die Spritze ist die Herkunft'
    );
    assert.deepEqual(r.gesetzt.lines, [{ kg: 1.5, qty: 4 }]);
    assert.equal(r.gesetzt['lw-st'], 2);
    // Ein Etiketten-Fenster für alle 13 Kulturen, danach das Einlagern der Körnerbrut.
    assert.deepEqual(r.fenster, [['etiketten', 13, 'function']]);
  });

  it('nur Körnerbrut: gleich das Fenster zum Einlagern', () => {
    const r = lauf({ KB: 6, LC: 0, PD: 0 }, 1);
    assert.deepEqual(r.angelegt, []);
    assert.deepEqual(r.fenster, [['korn', 'G-1', 1]]);
  });

  it('ohne Körnerbrut keine Charge', () => {
    const r = lauf({ KB: 0, LC: 0, PD: 5 }, 1);
    assert.equal(r.korn.length, 0);
    assert.deepEqual(r.fenster, [['etiketten', 5, 'object']]);
  });
});

describe('Beimpfen: das Fenster', () => {
  it('steht in index.html und der Knopf im Kultur-Fenster öffnet es', () => {
    assert.match(HTML, /id="m-beimpfen"/);
    assert.match(HTML, /id="bmp-go" data-bmp="go"/);
    assert.match(hebe('renderCiActions'), /data-bi="ci-beimpfen"/);
    assert.match(hebe('ciAction'), /if \(a === 'ci-beimpfen'\) bmpOpen\(c\);/);
  });
  it('das Etiketten-Fenster gibt nach dem Schließen an das Einlagern weiter', () => {
    assert.match(hebe('cprShow'), /_cprDanach = danach \|\| null;/);
    assert.match(hebe('cprClose'), /const weiter = _cprDanach;[\s\S]*if \(weiter\) weiter\(\);/);
  });
});

describe('Beimpfen: der Server nimmt eine Spritze als Herkunft', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmp-'));
  const d = db.openDb(path.join(dir, 'test.db'));
  const k = (id, type, parentId) => ({
    id,
    type,
    parentId,
    species: 'King Oyster',
    status: 'active',
    notes: '',
    created: '2026-10-01T00:00:00Z'
  });
  db.insertCultures(d, [k('LC-KO-010326-01', 'LC', null), k('SY-KO-011026-01', 'SY', 'LC-KO-010326-01')]);

  for (const type of ['PD', 'LC', 'GS']) {
    it(type + ' aus einer Spritze', () => {
      db.insertCultures(d, [k(type + '-KO-021026-01', type, 'SY-KO-011026-01')]);
    });
  }
  it('aber keine Spritze aus einer Spritze', () => {
    assert.throws(
      () => db.insertCultures(d, [k('SY-KO-021026-09', 'SY', 'SY-KO-011026-01')]),
      /SY parent must be one of/
    );
  });
});
