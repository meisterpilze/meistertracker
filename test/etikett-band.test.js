'use strict';
// Etiketten im Entwurf "Band": oben ein schwarzes Band mit Bild und Wort,
// darunter der Text in einer festen Größe. Am Regal legt das Team Bild, Band
// und Text je Artikel fest; im Labor ergeben sie sich aus dem Gefäß.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const hebe = (n) => _hf(n, APP);

describe('Regal-Etikett: Bild, Band und Text am Artikel', () => {
  let d, p, a;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_band_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    a = db.createShelfItem(d, 'Testartikel Band');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('ein neuer Artikel hat kein Bild und kein Band; sein Etikett zeigt den Namen', () => {
    assert.deepEqual([a.bild, a.band, a.etikett], ['', '', '']);
  });
  it('speichert Bild, Band (bis zwei Zeilen) und Text, aufgeräumt', () => {
    const x = db.updateShelfItem(d, a.id, { bild: 'weizen', band: ' Kokos \n  Substrat ', etikett: '  1   kg ' });
    assert.deepEqual([x.bild, x.band, x.etikett], ['weizen', 'Kokos\nSubstrat', '1 kg']);
    const y = db.updateShelfItem(d, a.id, { minStock: 5 });
    assert.deepEqual([y.bild, y.band, y.etikett], ['weizen', 'Kokos\nSubstrat', '1 kg'], 'bleibt beim Alarm-Ändern');
    const z = db.updateShelfItem(d, a.id, { bild: '', band: '', etikett: '' });
    assert.deepEqual([z.bild, z.band, z.etikett], ['', '', '']);
  });
  it('nimmt nur Bilder, die es gibt, und nicht zu viel Text', () => {
    assert.throws(() => db.updateShelfItem(d, a.id, { bild: 'rakete' }), /Bild gibt es nicht/);
    assert.throws(() => db.updateShelfItem(d, a.id, { band: 'a\nb\nc' }), /zwei Zeilen/);
    assert.throws(() => db.updateShelfItem(d, a.id, { band: 'x'.repeat(17) }), /16 Zeichen/);
    assert.throws(() => db.updateShelfItem(d, a.id, { etikett: 'x'.repeat(41) }), /40 Zeichen/);
  });
});

describe('Etikett: die Bilder', () => {
  const konst = (n) => {
    const i = APP.indexOf('const ' + n + ' = {');
    let tief = 0;
    for (let j = APP.indexOf('{', i); j < APP.length; j++) {
      if (APP[j] === '{') tief++;
      else if (APP[j] === '}' && --tief === 0) return APP.slice(i, j + 1);
    }
    throw new Error(n);
  };
  it('die App zeichnet genau die Bilder, die die Datenbank annimmt', () => {
    const app = new Function(
      `${hebe('_bildBeutel')}\n${konst('ETIKETT_BILDER')};\nreturn Object.keys(ETIKETT_BILDER);`
    )();
    assert.deepEqual(app, db.ETIKETT_BILDER);
  });
  it('jedes Bild zeichnet etwas, in den 64 Punkten, die es hat', () => {
    for (const name of db.ETIKETT_BILDER) {
      const punkte = [];
      const ctx = {
        fillRect: (x, y, w, h) => punkte.push([x, y, x + w, y + h]),
        beginPath() {},
        moveTo: (x, y) => punkte.push([x, y, x, y]),
        lineTo: (x, y) => punkte.push([x, y, x, y]),
        closePath() {},
        ellipse: (cx, cy, rx, ry) => punkte.push([cx - rx, cy - ry, cx + rx, cy + ry]),
        roundRect: (x, y, w, h) => punkte.push([x, y, x + w, y + h]),
        fill() {},
        stroke() {}
      };
      new Function(
        'ctx',
        `${hebe('_bildStift')}\n${hebe('_bildBeutel')}\n${konst('ETIKETT_BILDER')};\n${hebe('etikettBild')}\netikettBild(ctx, ${JSON.stringify(name)}, 0, 0, '#000', '#fff');`
      )(ctx);
      assert.ok(punkte.length > 2, name + ' zeichnet nichts');
      for (const [x0, y0, x1, y1] of punkte)
        assert.ok(x0 >= -1 && y0 >= -1 && x1 <= 66 && y1 <= 66, name + ' geht über sein Feld hinaus');
    }
  });
});

describe('Etikett: Labor und Regal', () => {
  it('ein Laborfach trägt das Bild seines Gefäßes, das Wort im Band und die Art darunter', () => {
    const item = (f) =>
      new Function(
        'f',
        `const t = (k) => ({ 'lf.label.LC': 'FK-Glas', 'lf.label.PD': 'Petri', 'lf.label.SYall': 'Spritzen', 'lf.label.KB': 'Körnerbrut' })[k];
        ${APP.match(/^const LF_BILD = .*;$/m)[0]}
        ${hebe('_lfLabelItem')}
        return _lfLabelItem(f);`
      )(f);
    assert.deepEqual(item({ id: 1, barcode: 5, kind: 'PD', name: 'Testart' }), {
      id: 1,
      barcode: 5,
      bild: 'petri',
      band: 'Petri',
      etikett: 'Testart',
      namePx: 32
    });
    assert.equal(item({ kind: 'SY', group: true, name: 'Testart' }).band, 'Spritzen');
    assert.equal(item({ kind: 'SY', group: true, name: 'Testart' }).bild, 'spritze');
    assert.equal(item({ kind: 'KB', size: 1.5, name: 'Testart' }).band, 'Körnerbrut\n1,5 kg');
    assert.equal(item({ kind: 'KB', size: 3, name: 'Testart' }).bild, 'koernerbeutel');
  });
  it('am Regal stellt man Bild, Band und Text im Blatt ein', () => {
    const m = HTML.slice(HTML.indexOf('id="m-shelf"'), HTML.indexOf('id="m-labfach"'));
    assert.match(m, /id="m-shelf-bilder"/);
    assert.match(m, /id="m-shelf-band"/);
    assert.match(m, /id="m-shelf-etikett"/);
    assert.match(m, /data-shelf-act="etikett"/);
    assert.match(APP, /if \(bild\) shelfEtikett\(\{ bild: bild\.dataset\.shelfBild \}\);/);
  });
  it('ein Wort, das breiter ist als der Platz, läuft nicht unter den QR-Code', () => {
    const f = hebe('shelfLabelCanvas');
    assert.match(f, /lines\.every\(\(l\) => ctx\.measureText\(l\)\.width <= maxW\)/);
    assert.match(f, /if \(w > maxW\) ctx\.scale\(maxW \/ w, 1\);/);
  });
  it('eine Größe im Band bleibt klein geschrieben, ein Wort wird groß', () => {
    assert.match(hebe('shelfLabelCanvas'), /const band = _bandZeilen\(x\.band\);/);
    assert.match(
      hebe('_bandZeilen'),
      /\.map\(\(z\) => \(\/\\d\/\.test\(z\) \? z\.trim\(\) : z\.trim\(\)\.toUpperCase\(\)\)\)/
    );
  });
});
