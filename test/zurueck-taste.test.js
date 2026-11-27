'use strict';
// Die Zurück-Taste des Telefons. Die App legte nie etwas in den Verlauf, und
// als installierte App schloss die Zurück-Geste sie einfach: aus dem Scan-
// Fenster, einem Blatt oder einer Unterseite kam man nur heraus, indem man die
// App schloss und neu öffnete. Diese Tests halten fest, was ein Schritt zurück
// tut und dass jedes Fenster dabei sein eigenes Schließen bekommt.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const hebe = (n) => _hf(n, APP);
const SCHLIESSEN = APP.match(/^const _Z_SCHLIESSEN = \{[\s\S]*?^\};$/m)[0];

describe('Zurück: der Verlauf', () => {
  it('die Zurück-Geste macht einen Schritt, statt die App zu verlassen', () => {
    assert.match(APP, /window\.addEventListener\('popstate', \(\) => \{[\s\S]{0,300}zurueckSchritt\(\);/);
  });
  it('jeder Seitenwechsel merkt sich, wo man war', () => {
    assert.match(hebe('go'), /if \(!mayLeavePage\(\)\) return;\n {2}zurueckMerk\(page, null\);/);
    assert.match(hebe('openStab'), /^function openStab\(page, sub\) \{\n {2}zurueckMerk\(page, sub\);/);
  });
  it('ein Fenster, das auf- oder zugeht, gleicht den Verlauf ab', () => {
    assert.match(APP, /function syncModalHiddenWithOpen\(\) \{[\s\S]{0,600}_zAbgleichSpaeter\(\);/);
  });
  it('neue Einträge kommen nach einer Berührung, nicht beim Start', () => {
    assert.match(APP, /for \(const ev of \['click', 'keyup', 'change'\]\)[\s\S]{0,200}_zBereit = true;/);
    assert.match(hebe('zurueckMerk'), /if \(_zGerade \|\| !_zBereit\) return;/);
  });
});

describe('Zurück: jedes Fenster schließt sich richtig', () => {
  it('die Fenster mit eigenem Schließen, die Escape kennt, kennt auch die Zurück-Taste', () => {
    for (const id of [
      'm-confirm',
      'm-confirm3',
      'm-search',
      'm-camscan',
      'm-bagselect',
      'm-work-flow',
      'm-prompt',
      'm-dayqty',
      'm-rhythm'
    ])
      assert.ok(SCHLIESSEN.includes(`'${id}':`), id);
  });
  it('jedes Fenster dort gibt es, und jede Funktion dort auch', () => {
    for (const [, id, fn] of SCHLIESSEN.matchAll(/'([a-z0-9-]+)': \(\) => (\w+)\(\)/g)) {
      assert.ok(HTML.includes(`id="${id}"`), 'kein Element ' + id);
      assert.ok(new RegExp('^(async )?function ' + fn + '\\(', 'm').test(APP), 'keine Funktion ' + fn);
    }
  });
  it('die Kamera geht aus, statt nur unsichtbar zu werden', () => {
    assert.match(SCHLIESSEN, /'m-camscan': \(\) => closeCamScan\(\)/);
    assert.match(SCHLIESSEN, /'scan-overlay': \(\) => closeScanModal\(\)/);
  });
});

// Ein Schritt mit Platzhaltern: zwei Fenster übereinander, dann die Seite davor.
function lauf({ fenster = [], spur = [], leiste = false, pflicht = false } = {}) {
  return new Function(
    'fenster',
    'spur',
    'leiste',
    'pflicht',
    `
    const wege = [];
    const window = { getComputedStyle: (el) => ({ zIndex: String(el.z) }) };
    const closeConfirm = () => wege.push('confirm zu');
    const closeCamScan = () => wege.push('kamera aus');
    const sbClose = () => wege.push('leiste zu');
    const _zpMandatory = () => pflicht;
    const gehZuOrt = (w) => wege.push('nach ' + w.page);
    let _zSpur = spur.slice();
    let _zGerade = false;
    const _zOverlays = () => fenster.filter((f) => f.offen);
    const _zLeiste = () => leiste;
    const _zBlatt = () => null;
    const _zAdminListe = () => false;
    const _Z_SCHLIESSEN = {
      'm-confirm': () => closeConfirm(),
      'm-camscan': () => closeCamScan()
    };
    ${hebe('_zOben')}
    ${hebe('_zSchliesse')}
    ${hebe('zurueckSchritt')}
    const r = zurueckSchritt();
    return { r, wege, spur: _zSpur, gerade: _zGerade };
  `
  )(fenster, spur, leiste, pflicht);
}
const fenster = (id, z, extra = {}) => ({
  id,
  z,
  offen: true,
  style: {},
  classList: { contains: (c) => c === 'open', remove: () => {} },
  ...extra
});

describe('Zurück: ein Schritt', () => {
  it('schließt das oberste Fenster: höchster z-index, bei Gleichstand das spätere', () => {
    assert.deepEqual(lauf({ fenster: [fenster('m-camscan', 200), fenster('m-confirm', 210)] }).wege, ['confirm zu']);
    assert.deepEqual(
      lauf({
        fenster: [fenster('m-baginfo', 200, { classList: { contains: () => false } }), fenster('m-camscan', 200)]
      }).wege,
      ['kamera aus']
    );
  });
  it('ein Fenster ohne eigenes Schließen verliert seine Klasse', () => {
    const weg = [];
    const f = fenster('m-baginfo', 200, { classList: { contains: () => true, remove: (c) => weg.push(c) } });
    assert.equal(lauf({ fenster: [f] }).r, true);
    assert.deepEqual(weg, ['open']);
  });
  it('lässt eine frisch angelegte Charge nicht ohne Platz stehen', () => {
    const r = lauf({ fenster: [fenster('m-move-batch', 200)], pflicht: true });
    assert.equal(r.r, true, 'der Schritt ist verbraucht, das Fenster bleibt');
    assert.deepEqual(r.wege, []);
  });
  it('dann die Seitenleiste, dann die Seite davor', () => {
    assert.deepEqual(lauf({ leiste: true, spur: [{ page: 'lab' }] }).wege, ['leiste zu']);
    const r = lauf({ spur: [{ page: 'inv' }, { page: 'lab' }] });
    assert.deepEqual(r.wege, ['nach lab']);
    assert.equal(r.spur.length, 1);
    assert.equal(r.gerade, false, 'danach merkt sich go() wieder, wo man war');
  });
  it('ohne alles: kein Schritt, die nächste Geste schließt die App', () => {
    assert.equal(lauf().r, false);
  });
});

describe('Zurück: was als Schritt zählt', () => {
  function merk(aufrufe, { bereit = true, hier = { page: 'work', stab: null } } = {}) {
    return new Function(
      'aufrufe',
      'bereit',
      'hier',
      `
      let _zSpur = [];
      let _zGerade = false;
      let _zBereit = bereit;
      let _zZeit = 0;
      const Z_SPUR_MAX = 20;
      let jetzt = 1000;
      const Date = { now: () => jetzt };
      const whereAmI = () => ({ ...hier });
      const _zAbgleichSpaeter = () => {};
      const zuletztMerk = () => {};
      ${hebe('zurueckMerk')}
      for (const [page, sub, dt] of aufrufe) {
        jetzt += dt;
        zurueckMerk(page, sub);
      }
      return _zSpur;
    `
    )(aufrufe, bereit, hier);
  }
  it('ein Wechsel ist ein Schritt; go() und gleich danach openStab() sind einer', () => {
    assert.equal(merk([['lab', null, 1000]]).length, 1);
    assert.equal(
      merk([
        ['lab', null, 1000],
        ['lab', 'stock', 50]
      ]).length,
      1
    );
  });
  it('dieselbe Seite noch einmal ist kein Schritt', () => {
    assert.equal(merk([['work', null, 1000]]).length, 0);
  });
  it('vor der ersten Berührung zählt nichts: der Start ist kein Schritt', () => {
    assert.equal(merk([['lab', null, 1000]], { bereit: false }).length, 0);
  });
});
