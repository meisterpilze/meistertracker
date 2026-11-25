'use strict';
// Die Kamera schließen, auf jedem Telefon.
//
// Geschlossen wurde sie über einen grünen Haken ganz unten, unter Kamera,
// Kacheln und Knopfreihe. Den Haken las niemand als "Kamera zu", und das X,
// das man sah, setzte nur den Scan zurück: wer fertig war, schloss die ganze
// App. Jetzt ist der grüne Knopf ein X und heißt Schließen, Zurücksetzen ist
// ein Radiergummi, und ist die Kamera höher als der Schirm, rollt sie bis zu
// diesem Knopf. Ein zweiter Schließen-Knopf oben stand kurz da (#819) und ist
// wieder weg: einer reicht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const CSS = quelle('styles.css');
const kamera = HTML.slice(HTML.indexOf('id="m-camscan"'), HTML.indexOf('<!-- Sidebar -->'));
const knopf = (id) => {
  const i = kamera.indexOf('id="' + id + '"');
  assert.ok(i > 0, id + ' fehlt in der Kamera');
  return kamera.slice(i, kamera.indexOf('</button>', i));
};
const regel = (sel) => {
  const i = CSS.indexOf('\n' + sel + ' {');
  assert.ok(i >= 0, sel + ' fehlt in styles.css');
  return CSS.slice(i, CSS.indexOf('}', i));
};

describe('Kamera schließen', () => {
  it('der grüne Knopf ist ein X und heißt Schließen', () => {
    const k = knopf('cls-16');
    assert.match(k, /data-i18n-aria-label="common\.close"/);
    assert.match(k, /<line x1="18" y1="6" x2="6" y2="18" \/>/);
    assert.doesNotMatch(k, /M20 6L9 17l-5-5/, 'kein Haken mehr');
  });

  it('er schließt die Kamera', () => {
    assert.match(APP, /\$\('cls-16'\)\.addEventListener\('click', closeCamScan\)/);
  });

  it('es gibt nur einen Schließen-Knopf', () => {
    assert.doesNotMatch(HTML, /id="cam-close"/);
    assert.doesNotMatch(CSS, /\.cam-close\b/);
    assert.doesNotMatch(APP, /'cam-close'/);
  });

  it('ist die Kamera höher als der Schirm, rollt sie, statt Knöpfe abzuschneiden', () => {
    const r = regel('.cam-scan-wrap');
    assert.match(r, /overflow-y: auto/);
    assert.match(r, /justify-content: safe center/);
  });

  it('Zurücksetzen ist kein X: das X gibt es nur einmal', () => {
    const reset = knopf('btn-cam-reset');
    assert.doesNotMatch(reset, /<line x1="18" y1="6" x2="6" y2="18" \/>/);
    assert.doesNotMatch(reset, /<circle cx="12" cy="12" r="10" \/>/);
  });
});
