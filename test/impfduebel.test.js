'use strict';
// Impfdübel in der Laborarbeit: ein Beutel Holzdübel, beimpft aus einer Kultur
// oder aus einem Körnerbeutel. Eine eigene Art (DU) mit Nummer und Etikett wie
// eine Spritze; der Körnerbeutel geht dabei als verbraucht raus.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');
const db = require('../db');

const APP = quelle();
const HTML = quelle('index.html');
const SERVER = quelle('server.js');
const hebe = (n) => _hf(n, APP);
const LAB = APP.match(/const LAB_PARENT_TYPES = \{[\s\S]*?\n\};/)[0];

const korn = (art) =>
  new Function(
    `${LAB}\n${hebe('kornAlsHerkunft')}\nreturn kornAlsHerkunft(LAB_PARENT_TYPES[${JSON.stringify(art)}]);`
  )();

describe('Impfdübel: woraus', () => {
  it('aus einem Körnerbeutel wie die Körnerbrut', () => {
    assert.equal(korn('DU'), true);
    assert.equal(korn('KB'), true);
  });
  it('eine Petrischale, Flüssigkultur oder Spritze nicht aus einem Körnerbeutel', () => {
    for (const art of ['PD', 'LC', 'SY', 'MC']) assert.equal(korn(art), false, art);
  });
  it('bei "Mehrere" zählt kein Körnerbeutel: die Liste ist dann eine neue', () => {
    const f = new Function(`${LAB}\n${hebe('kornAlsHerkunft')}\nreturn kornAlsHerkunft(LAB_PARENT_TYPES.DU.slice());`);
    assert.equal(f(), false);
  });
});

describe('Impfdübel: in der Laborarbeit', () => {
  it('steht im Schnelldialog und im langen Formular', () => {
    for (const id of ['ms-q-labtype', 'lw-type']) {
      const sel = HTML.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))[0];
      assert.match(sel, /<option value="DU" data-i18n="lab.duPrep">/, id);
    }
  });
  it('der Server nimmt die Art an', () => {
    assert.match(SERVER, /const CULTURE_TYPES = \[[^\]]*'DU'[^\]]*\]/);
  });
  it('der gescannte Körnerbeutel wird erst nach dem Speichern verbucht', () => {
    assert.match(APP, /saved\.then\(\s*\(\) => spawnBuchen\(opts\.korn, 'spawn:' \+ newC\[0\]\.id\)/);
  });
});

describe('Impfdübel in der Datenbank', () => {
  function mitDb(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duebel-'));
    const d = db.openDb(path.join(dir, 'test.db'));
    try {
      const art = Number(db.createMushroomStrain(d, { name: 'Testart Dübel', kuerzel: 'TD' }));
      fn(d, art);
    } finally {
      d.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const kultur = (id, type, art, parentId) => ({
    id,
    type,
    strainId: art,
    parentId: parentId || null,
    status: 'active',
    notes: '',
    created: '2026-10-08T00:00:00Z'
  });

  it('aus einer Flüssigkultur angesetzt, mit ihr als Herkunft', () => {
    mitDb((d, art) => {
      db.insertCultures(d, [kultur('LC-TD-081026-01', 'LC', art)]);
      db.insertCultures(d, [kultur('DU-TD-081026-01', 'DU', art, 'LC-TD-081026-01')]);
      const c = d.prepare('SELECT type, parent_id FROM cultures WHERE id = ?').get('DU-TD-081026-01');
      assert.deepEqual({ ...c }, { type: 'DU', parent_id: 'LC-TD-081026-01' });
    });
  });
  it('nicht aus anderen Dübeln', () => {
    mitDb((d, art) => {
      db.insertCultures(d, [kultur('DU-TD-081026-01', 'DU', art)]);
      assert.throws(() => db.insertCultures(d, [kultur('DU-TD-081026-02', 'DU', art, 'DU-TD-081026-01')]));
    });
  });
});
