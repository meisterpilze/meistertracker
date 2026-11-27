'use strict';
// Eine Kultur, die als aufgebraucht drinsteht, aber vor einem liegt.
//
// Ein Scan sagte nur "aufgebraucht — nimm eine andere", und eine Petrischale,
// die sichtbar im Regal stand, ließ sich vom Scan aus nicht zurückholen. Jetzt:
// - ein gewöhnlicher Scan öffnet ihr Fenster, darin "Wieder in den Bestand";
// - als Herkunft gescannt (die Kamera bleibt offen) holt ein zweiter Scan
//   derselben Kultur sie zurück und nimmt sie, mit Rückgängig;
// - kontaminiert kommt auf diesem Weg nie zurück.
// Alle Kennungen hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const sprache = (code) => {
  const w = {};
  new Function('window', quelle('lang/' + code + '.js'))(w);
  return w.LANG[code];
};

function zeile(re, name) {
  const m = APP.match(re);
  assert.ok(m, name + ' nicht in der Quelle gefunden — der Test muss mitgeführt werden');
  return m[0];
}

function baue(cultures) {
  const welt = { jetzt: 1_000_000, status: [], undo: null, undoText: null, cultures };
  const nochmal = new Function(
    'welt',
    `const Date = { now: () => welt.jetzt };
    const t = (k, p) => k + (p ? ' ' + JSON.stringify(p) : '');
    const setCultureStatus = (id, st) => {
      welt.status.push([id, st]);
      const c = welt.cultures.find((x) => x.id === id);
      if (c) c.status = st;
    };
    const showUndoBar = (text, cb) => { welt.undoText = text; welt.undo = cb; };
    ${zeile(/^const KULTUR_NOCHMAL_MS = \d+;$/m, 'KULTUR_NOCHMAL_MS')}
    ${zeile(/^let _kulturNochmal = \{ id: null, at: 0 \};$/m, '_kulturNochmal')}
    ${hebeFunktion('kulturNochmalGescannt')}
    return kulturNochmalGescannt;`
  )(welt);
  const scan = (id) => nochmal(welt.cultures.find((c) => c.id === id));
  return { welt, scan };
}

describe('Kultur als Herkunft gescannt: ein zweiter Scan holt sie zurück', () => {
  it('der erste Scan nicht, der zweite derselben Kultur schon, mit Rückgängig', () => {
    const { welt, scan } = baue([{ id: 'PD-TA-171126-01', status: 'used' }]);
    assert.equal(scan('PD-TA-171126-01'), false);
    assert.deepEqual(welt.status, []);
    welt.jetzt += 5000;
    assert.equal(scan('PD-TA-171126-01'), true);
    assert.deepEqual(welt.status, [['PD-TA-171126-01', 'active']]);
    assert.match(welt.undoText, /^ci\.activeDone /);
    welt.undo();
    assert.equal(welt.cultures[0].status, 'used', 'Rückgängig stellt den Status von vorher her');
  });

  it('verkauft kommt genauso zurück', () => {
    const { welt, scan } = baue([{ id: 'SY-TA-171126-01', status: 'sold' }]);
    scan('SY-TA-171126-01');
    assert.equal(scan('SY-TA-171126-01'), true);
    welt.undo();
    assert.equal(welt.cultures[0].status, 'sold');
  });

  it('nach einer Minute zählt ein Scan wieder als erster', () => {
    const { welt, scan } = baue([{ id: 'PD-TA-171126-01', status: 'used' }]);
    scan('PD-TA-171126-01');
    welt.jetzt += 60000;
    assert.equal(scan('PD-TA-171126-01'), false);
    welt.jetzt += 4000;
    assert.equal(scan('PD-TA-171126-01'), true);
  });

  it('eine andere Kultur dazwischen fängt von vorn an', () => {
    const { welt, scan } = baue([
      { id: 'PD-TA-171126-01', status: 'used' },
      { id: 'PD-TA-171126-02', status: 'used' }
    ]);
    scan('PD-TA-171126-01');
    welt.jetzt += 4000;
    assert.equal(scan('PD-TA-171126-02'), false);
    welt.jetzt += 4000;
    assert.equal(scan('PD-TA-171126-01'), false);
    welt.jetzt += 4000;
    assert.equal(scan('PD-TA-171126-01'), true);
    assert.deepEqual(welt.status, [['PD-TA-171126-01', 'active']]);
  });

  it('kontaminiert nie, auch nicht beim dritten Scan', () => {
    const { welt, scan } = baue([{ id: 'PD-TA-171126-01', status: 'contam' }]);
    for (let i = 0; i < 3; i++) {
      welt.jetzt += 4000;
      assert.equal(scan('PD-TA-171126-01'), false);
    }
    assert.deepEqual(welt.status, []);
  });
});

describe('Kultur wieder da: in der App', () => {
  const scan = hebeFunktion('processScan');
  it('als Herkunft: erst die Frage, beim zweiten Scan weiter wie jede andere; kontaminiert wie vorher', () => {
    assert.match(scan, /if \(cultureGone\(hit\) && !kulturNochmalGescannt\(hit\)\) \{/);
    assert.match(
      scan,
      /setFb\('err', hit\.status === 'contam' \? cultureRefusal\(hit\) : t\('scanFb\.cultureScanAgain', \{ id: hit\.id \}\)\);/
    );
  });
  it('ein gewöhnlicher Scan öffnet ihr Fenster, mit "Wieder in den Bestand"', () => {
    assert.match(
      scan,
      /if \(cultureGone\(c\)\) \{\s*openCultureSheet\(c\);\s*setFb\('warn', cultureBackHint\(c\), \{ noModal: true \}\);/
    );
    assert.match(
      hebeFunktion('renderCiActions'),
      /if \(!aktiv\)\s*html \+= `<button type="button" data-bi="ci-active"/
    );
  });
  it('im Raus-Modus bleibt es beim Hinweis', () => {
    assert.match(
      hebeFunktion('kulturRausScan'),
      /if \(cultureGone\(c\)\) \{\s*_scanBeep\(500, 120\);\s*setFb\('warn', cultureRefusal\(c\)\);/
    );
  });
  it('jedes Wort in jeder Sprache', () => {
    for (const code of ['de', 'en', 'pt'])
      for (const k of ['cultureBackUsed', 'cultureBackSold', 'cultureMarkedContam', 'cultureScanAgain'])
        assert.ok(sprache(code)['scanFb.' + k], code + ': ' + k);
  });
  it('der Hinweis je Status', () => {
    const hinweis = new Function('t', hebeFunktion('cultureBackHint') + '\nreturn cultureBackHint;')((k) => k);
    assert.equal(hinweis({ id: 'X', status: 'used' }), 'scanFb.cultureBackUsed');
    assert.equal(hinweis({ id: 'X', status: 'sold' }), 'scanFb.cultureBackSold');
    assert.equal(hinweis({ id: 'X', status: 'contam' }), 'scanFb.cultureMarkedContam');
  });
});
