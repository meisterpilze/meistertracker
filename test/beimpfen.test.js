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
      // Wie das echte: das Fenster ist zu, _bmp ist weg. Was danach noch aus _bmp
      // läse, bräche hier ab wie in der App.
      const bmpClose = () => { _bmp = null; };
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
      const etikettenFuerAlles = (ids, saved, korn) => fenster.push(['etiketten', ids.length, korn ? korn.batchObj.batchId : null]);
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
    // Ein Schluss für alles: die 13 Kulturen und die Körnerbrut in einem Fenster.
    assert.deepEqual(r.fenster, [['etiketten', 13, 'G-1']]);
  });

  it('nur Körnerbrut: der gemeinsame Schluss bekommt die Charge ohne Kulturen', () => {
    const r = lauf({ KB: 6, LC: 0, PD: 0 }, 1);
    assert.deepEqual(r.angelegt, []);
    assert.deepEqual(r.fenster, [['etiketten', 0, 'G-1']]);
  });

  it('ohne Körnerbrut keine Charge', () => {
    const r = lauf({ KB: 0, LC: 0, PD: 5 }, 1);
    assert.equal(r.korn.length, 0);
    assert.deepEqual(r.fenster, [['etiketten', 5, null]]);
  });
});

describe('Beimpfen: Spritzen in mehreren Größen auf einmal', () => {
  it('3 × 10, 5 × 20 und 3 × 50 ml: je Größe ein Posten, ein Etiketten-Fenster für alle 11', () => {
    const r = new Function(
      `
      const angelegt = [];
      const fenster = [];
      const SY_ML = [10, 20, 50];
      const LC = { id: 'LC-KO-011026-01', type: 'LC', strainId: 2, strainText: '', status: 'active' };
      const cultures = [LC];
      const mushroomStrains = [{ id: 2, name: 'King Oyster', kuerzel: 'KO' }];
      let _bmp = { id: LC.id, n: { KB: 0, LC: 0, PD: 0, SY: 11 }, kg: 1, sy: { 10: 3, 20: 5, 50: 3 } };
      let gemerkt = null;
      const t = (k) => k;
      const toast = () => {};
      const fieldError = () => {};
      const _bmpLesen = () => {};
      const _bmpMerken = (type, w) => { gemerkt = w; };
      const bmpClose = () => { _bmp = null; };
      const anlageLesen = () => '';
      const anlageZeitpunkt = () => new Date(2026, 9, 1, 12);
      const kulturenAnlegen = (spec) => {
        angelegt.push(spec);
        return { newC: Array.from({ length: spec.qty }, (_, i) => ({ id: spec.type + spec.ml + '-' + (i + 1) })), saved: Promise.resolve() };
      };
      const renderLabLog = () => {};
      const etikettenFuerAlles = (ids) => fenster.push(ids.length);
      ${hebe('bmpGo')}
      bmpGo();
      return { angelegt, fenster, gemerkt };
    `
    )();
    assert.deepEqual(
      r.angelegt.map((s) => [s.type, s.qty, s.ml, s.parentId]),
      [
        ['SY', 3, 10, 'LC-KO-011026-01'],
        ['SY', 5, 20, 'LC-KO-011026-01'],
        ['SY', 3, 50, 'LC-KO-011026-01']
      ]
    );
    assert.deepEqual(r.fenster, [11], 'ein Fenster, ein Klick druckt alle');
    assert.deepEqual(r.gemerkt, { kg: 1 }, 'gemerkt wird nur das Gewicht je Beutel, keine Anzahl');
  });

  it('jede Anzahl fängt bei 0 an, auch wenn vom letzten Mal etwas gemerkt ist; nur das Gewicht bleibt', () => {
    const b = new Function(
      `
      ${LAB}
      const SY_ML = [10, 20, 50];
      let _bmp = null;
      const _bmpLetzte = () => ({ KB: 4, LC: 3, PD: 10, SY: 2, ml: 20, sy: { 10: 3, 20: 5, 50: 3 }, kg: 1.5 });
      const _msqLastSizes = () => null;
      const parseDecimal = (s) => parseFloat(String(s).replace(',', '.'));
      const anlageReset = () => {};
      const bmpRender = () => {};
      const t = (k) => k;
      const el = { style: {} };
      const document = { getElementById: () => el };
      ${hebe('bmpArten')}
      ${hebe('bmpOpen')}
      bmpOpen({ id: 'LC-KO-011026-01', type: 'LC', strainName: 'King Oyster', strainText: '' });
      return _bmp;
    `
    )();
    assert.deepEqual(b.n, { KB: 0, LC: 0, PD: 0, SY: 0 });
    assert.deepEqual(b.sy, { 10: 0, 20: 0, 50: 0 });
    assert.equal(b.kg, 1.5);
  });

  it('die Spritzen-Zeile zählt je Größe statt einer Größenwahl', () => {
    const f = hebe('bmpRender');
    assert.match(f, /syMengenHtml\('bmp', _bmp\.sy\)/);
    assert.doesNotMatch(APP, /data-bmp-ml/);
  });
});

describe('Schnelldialog: Spritzen je Größe', () => {
  it('logLabWork legt je Größe einen Posten an und zeigt ein Fenster für alle', () => {
    const r = new Function(
      `
      const angelegt = [];
      const fenster = [];
      const SY_ML = [10, 20, 50];
      const cultures = [];
      const mushroomStrains = [{ id: 2, name: 'King Oyster', kuerzel: 'KO' }];
      const felder = { 'lw-type': 'SY', 'lw-st': '2', 'lw-qty': '11', 'lw-ml': '10', 'lw-notes': '', 'lw-parent': '', 'lw-strain-text': '', 'lw-source': '' };
      const document = { getElementById: (id) => (id in felder ? { get value() { return felder[id]; }, set value(v) { felder[id] = v; } } : null) };
      const t = (k) => k;
      const toast = () => {};
      const fieldError = () => {};
      const anlageNehmen = () => '';
      const anlageZeitpunkt = () => new Date(2026, 9, 1, 12);
      const lwPreview = () => {};
      const kulturenAnlegen = (spec) => {
        angelegt.push(spec);
        return { newC: Array.from({ length: spec.qty }, (_, i) => ({ id: 'SY' + spec.ml + '-' + (i + 1) })), saved: Promise.resolve() };
      };
      const cprShow = (ids) => fenster.push(ids);
      ${hebe('logLabWork')}
      logLabWork({ sy: { 10: 3, 20: 0, 50: 2 } });
      return { angelegt, fenster };
    `
    )();
    assert.deepEqual(
      r.angelegt.map((s) => [s.type, s.qty, s.ml]),
      [
        ['SY', 3, 10],
        ['SY', 2, 50]
      ]
    );
    assert.equal(r.fenster.length, 1);
    assert.equal(r.fenster[0].length, 5);
  });

  it('der Schnelldialog reicht die Mengen je Größe weiter, ohne sie zu merken', () => {
    const f = hebe('msQuickConfirm');
    assert.match(f, /syMengenLesen\('ms-q'\)/);
    assert.match(f, /logLabWork\(intake \? \{ id: intake\.id \} : syN \? \{ sy: syN \} : undefined\);/);
    assert.match(HTML, /id="ms-q-sy"/);
    // Jedes Öffnen fängt bei 0 an.
    assert.match(hebe('msQuickOpen'), /syMengenHtml\('ms-q', \{\}\)/);
    assert.doesNotMatch(APP, /_syMengenMerken|_syMengenLetzte/);
  });
});

describe('Beimpfen: das Fenster', () => {
  it('steht in index.html und der Knopf im Kultur-Fenster öffnet es', () => {
    assert.match(HTML, /id="m-beimpfen"/);
    assert.match(HTML, /id="bmp-go" data-bmp="go"/);
    assert.match(hebe('renderCiActions'), /data-bi="ci-beimpfen"/);
    assert.match(hebe('ciAction'), /if \(a === 'ci-beimpfen'\) bmpOpen\(c\);/);
  });
  it('endet im gemeinsamen Schluss: Kulturen und Körnerbrut in einem Etiketten-Fenster', () => {
    assert.match(hebe('bmpGo'), /etikettenFuerAlles\(ids, Promise\.all\(saves\), korn\);/);
    assert.doesNotMatch(APP, /_cprDanach/);
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
