'use strict';
// Die Kamera schließen, auf jedem Telefon.
//
// Geschlossen wurde sie nur über den grünen Haken ganz unten, unter Kamera,
// Kacheln und Knopfreihe. Auf einem kleinen Telefon lag er unter dem Bildrand,
// und das Blatt rollte nicht; das X, das man sah, setzte nur den Scan zurück.
// Wer fertig war, musste die App schließen. Jetzt steht oben rechts immer
// "Schließen", das Blatt rollt, und der Zurücksetzen-Knopf ist kein X mehr.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const CSS = quelle('styles.css');
const kamera = HTML.slice(HTML.indexOf('id="m-camscan"'), HTML.indexOf('<!-- Sidebar -->'));
const regel = (sel) => {
  const i = CSS.indexOf('\n' + sel + ' {');
  assert.ok(i >= 0, sel + ' fehlt in styles.css');
  return CSS.slice(i, CSS.indexOf('}', i));
};

describe('Kamera schließen', () => {
  it('oben rechts steht "Schließen", vor allem anderen in der Kamera', () => {
    assert.ok(kamera.indexOf('id="cam-close"') > 0);
    assert.ok(kamera.indexOf('id="cam-close"') < kamera.indexOf('class="cam-scan-wrap"'));
    assert.match(kamera, /id="cam-close"[\s\S]{0,700}data-i18n="common\.close"/);
    const r = regel('.cam-close');
    assert.match(r, /position: absolute/);
    assert.match(r, /top: calc\(12px \+ env\(safe-area-inset-top/);
    assert.match(r, /z-index: 2/);
  });

  it('der Knopf schließt wie der grüne Haken', () => {
    assert.match(APP, /\$\('cam-close'\)\.addEventListener\('click', closeCamScan\)/);
    assert.match(APP, /\$\('cls-16'\)\.addEventListener\('click', closeCamScan\)/);
  });

  it('ist die Kamera höher als der Schirm, rollt sie, statt Knöpfe abzuschneiden', () => {
    const r = regel('.cam-scan-wrap');
    assert.match(r, /overflow-y: auto/);
    assert.match(r, /justify-content: safe center/);
  });

  it('Zurücksetzen ist kein X im Kreis mehr', () => {
    const reset = kamera.slice(kamera.indexOf('id="btn-cam-reset"'), kamera.indexOf('id="cls-16"'));
    assert.doesNotMatch(reset, /<circle cx="12" cy="12" r="10" \/>/);
  });
});
