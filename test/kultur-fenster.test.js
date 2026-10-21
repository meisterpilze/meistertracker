'use strict';
// Das Kultur-Fenster: eine gescannte Kultur zeigt, woher sie kommt.
//
// "Stammbaum" schickte auf die Laborseite, und am Telefon lag der Baum dort
// unter dem Laborbestand, außer Sicht — man sah die Laborseite und sonst nichts.
// Jetzt steht die Herkunft gleich im Fenster, und der Knopf scrollt zum Baum.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();
const hebe = (n) => _hf(n, APP);

function herkunft(cultures, id) {
  return new Function(
    'cultures',
    'id',
    `
    const t = (k) => k;
    const esc = (s) => String(s);
    const ctBadge = (x) => '[' + x + ']';
    ${hebe('ciHerkunftHtml')}
    return ciHerkunftHtml(cultures.find((c) => c.id === id));
  `
  )(cultures, id);
}

function verfuegbar(cultures, id) {
  return new Function(
    'cultures',
    'id',
    `
    const t = (k, p) => (p ? k + ' ' + JSON.stringify(p) : k);
    const esc = (s) => String(s);
    ${hebe('ciGeschwister')}
    ${hebe('ciVerfuegbarHtml')}
    return ciVerfuegbarHtml(cultures.find((c) => c.id === id));
  `
  )(cultures, id);
}

describe('Kultur-Fenster: wieviele aus dem Ansatz noch da sind', () => {
  const ansatz = [
    { id: 'SY-CHUT-CHEKQ07-011026-01', status: 'active' },
    { id: 'SY-CHUT-CHEKQ07-011026-02', status: 'active' },
    { id: 'SY-CHUT-CHEKQ07-011026-03', status: 'used' },
    { id: 'SY-CHUT-CHEKQ07-011026-04', status: 'stored' },
    // Ein anderer Tag und ein anderer Stamm gehören nicht dazu.
    { id: 'SY-CHUT-CHEKQ07-021026-01', status: 'active' },
    { id: 'SY-CHUT-011026-01', status: 'active' }
  ];

  it('zählt die noch aktiven oder gelagerten aus genau diesem Ansatz', () => {
    const h = verfuegbar(ansatz, 'SY-CHUT-CHEKQ07-011026-01');
    assert.match(h, /ci\.available \{"n":3,"total":4\}/);
  });

  it('zeigt jede Nummer, die gescannte hervorgehoben, die verbrauchte durchgestrichen', () => {
    const h = verfuegbar(ansatz, 'SY-CHUT-CHEKQ07-011026-02');
    assert.equal((h.match(/>0[1-4]</g) || []).length, 4);
    assert.match(h, /color:#fff[^>]*>02</);
    assert.match(h, /line-through">03</);
  });

  it('ohne Geschwister keine Nummernreihe', () => {
    const h = verfuegbar([{ id: 'LC-CHUT-KQ07-090326-01', status: 'active' }], 'LC-CHUT-KQ07-090326-01');
    assert.match(h, /"n":1,"total":1/);
    assert.doesNotMatch(h, /monospace/);
  });

  it('zählt bei Spritzen nur die gleicher Größe, eine ohne Angabe als 10er', () => {
    const tag = [
      { id: 'SY-CHUT-211026-01', type: 'SY', status: 'active' },
      { id: 'SY-CHUT-211026-02', type: 'SY', status: 'active', ml: 10 },
      { id: 'SY-CHUT-211026-03', type: 'SY', status: 'active', ml: 50 },
      { id: 'SY-CHUT-211026-04', type: 'SY', status: 'stored', ml: 50 },
      { id: 'SY-CHUT-211026-05', type: 'SY', status: 'active', ml: 50 }
    ];
    assert.match(verfuegbar(tag, 'SY-CHUT-211026-01'), /"n":2,"total":2/);
    assert.match(verfuegbar(tag, 'SY-CHUT-211026-04'), /"n":3,"total":3/);
  });
});

describe('Kultur-Fenster: die Herkunft', () => {
  const kultur = [
    { id: 'MC-KO-010126-01', type: 'MC', parentId: null },
    { id: 'LC-KO-010326-01', type: 'LC', parentId: 'MC-KO-010126-01' },
    { id: 'SY-KO-011026-01', type: 'SY', parentId: 'LC-KO-010326-01' }
  ];

  it('zeigt die ganze Kette, vom Ursprung bis zu dieser', () => {
    const h = herkunft(kultur, 'SY-KO-011026-01');
    const a = h.indexOf('MC-KO-010126-01');
    const b = h.indexOf('LC-KO-010326-01');
    const c = h.indexOf('SY-KO-011026-01');
    assert.ok(a > -1 && a < b && b < c, 'Reihenfolge Slant → Flüssigkultur → Spritze');
    assert.match(h, /font-weight:700">SY-KO-011026-01/);
  });

  it('sagt es, wenn keine Herkunft eingetragen ist', () => {
    assert.match(herkunft(kultur, 'MC-KO-010126-01'), /ci\.noParent/);
  });

  it('nennt eine Herkunft, die nicht in der Liste steht, statt "keine"', () => {
    const h = herkunft([{ id: 'SY-KO-011026-01', type: 'SY', parentId: 'LC-KO-010326-09' }], 'SY-KO-011026-01');
    assert.match(h, /\[LC\][\s\S]*LC-KO-010326-09/);
    assert.doesNotMatch(h, /ci\.noParent/);
  });

  it('läuft bei einem Kreis nicht endlos', () => {
    const kreis = [
      { id: 'PD-A-010126-01', type: 'PD', parentId: 'PD-B-010126-01' },
      { id: 'PD-B-010126-01', type: 'PD', parentId: 'PD-A-010126-01' }
    ];
    assert.match(herkunft(kreis, 'PD-A-010126-01'), /PD-B-010126-01/);
  });

  it('der Knopf Stammbaum scrollt zum Baum', () => {
    assert.match(hebe('ciAction'), /getElementById\('sp-lab-lineage'\)[\s\S]{0,40}scrollIntoView/);
  });
});
