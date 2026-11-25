'use strict';
// Kulturen prüfen: die Inventur im Labor, mit der Kamera.
//
// Labor → Kulturbibliothek → Prüfen listet die Kulturen, die die App noch im
// Bestand meint, und jeder Scan hakt eine ab. Was am Ende fehlt, geht als
// aufgebraucht hinaus. Vorher standen dort alle Kulturen auf einmal: wer nur die
// Petrischalen und die FK-Gläser durchscannte, schrieb mit "nicht gefunden →
// aufgebraucht" auch jeden Slant und jede Spritze ab. Jetzt zählen nur die
// Gefäße, die oben angetippt sind; Petri und FK-Glas zu Beginn.
//
// Alle Namen und Nummern hier sind ausgedacht.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { quelle } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const sprache = (code) => {
  const w = {};
  new Function('window', quelle('lang/' + code + '.js'))(w);
  return w.LANG[code];
};

// Der Block von LC_KINDS bis _lcVonVorn, gegen Attrappen.
function baue(start) {
  const m = APP.match(/^const LC_KINDS = [\s\S]*?^function _lcVonVorn\(\) \{[\s\S]*?\r?\n\}/m);
  assert.ok(m, 'der Block der Laborinventur ist umgezogen — der Test muss mitgeführt werden');
  const welt = {
    cultures: start.cultures,
    speicher: new Map(Object.entries(start.speicher || {})),
    els: {},
    feedback: [],
    status: [],
    undo: null,
    bestaetigt: null,
    jetzt: start.jetzt || Date.now()
  };
  const el = (id) =>
    (welt.els[id] = welt.els[id] || { innerHTML: '', textContent: '', classList: { add() {}, remove() {} } });
  const f = new Function(
    'welt',
    'el',
    `const document = { getElementById: el };
    const localStorage = {
      getItem: (k) => (welt.speicher.has(k) ? welt.speicher.get(k) : null),
      setItem: (k, v) => welt.speicher.set(k, String(v))
    };
    const Date = { now: () => welt.jetzt };
    const cultures = welt.cultures;
    const t = (k, p) => k + (p ? ' ' + JSON.stringify(p) : '');
    const esc = (s) => String(s);
    const zoneDisplayName = (z) => z;
    const getZoneBags = () => ({});
    const _zcFeedback = (art, text) => welt.feedback.push([art, text]);
    const setCultureStatus = (id, st) => {
      welt.status.push([id, st]);
      const c = cultures.find((x) => x.id === id);
      if (c) c.status = st;
    };
    const confirm2 = (titel, text, knopf, ja) => { welt.bestaetigt = text; ja(); };
    const showUndoBar = (text, cb) => { welt.undo = cb; };
    let _zcMode = 'zone';
    let _zcZone = null;
    let _zcMoved = 0;
    const _zcFound = new Set();
    ${m[0]}
    return { openLabCheck, labCheckScanned, _zcMarkMissingUsed, _lcKindToggle, _lcVonVorn, _zcExpected, _zcFound, _lcKinds };`
  );
  return { welt, ...f(welt, el) };
}

const kultur = (id, type, status = 'active') => ({ id, type, status, species: 'Testart Alpha' });
const BESTAND = () => [
  kultur('PD-TA-171126-01', 'PD'),
  kultur('PD-TA-171126-02', 'PD'),
  kultur('LC-TA-171126-01', 'LC', 'stored'),
  kultur('MC-TA-171126-01', 'MC'),
  kultur('SY-TA-171126-01', 'SY'),
  kultur('PD-TA-171126-03', 'PD', 'used')
];

describe('Kulturen prüfen: nur die angetippten Gefäße', () => {
  let a;
  beforeEach(() => {
    a = baue({ cultures: BESTAND() });
    a.openLabCheck();
  });

  it('zu Beginn Petri und FK-Glas: Slants und Spritzen stehen nicht in der Liste', () => {
    assert.deepEqual(
      a._zcExpected().map(([id]) => id),
      ['LC-TA-171126-01', 'PD-TA-171126-01', 'PD-TA-171126-02']
    );
  });

  it('die Knöpfe oben zeigen jedes Gefäß mit seiner Zahl, angetippt oder nicht', () => {
    const h = a.welt.els['zc-kinds'].innerHTML;
    assert.match(h, /data-zc-kind="PD" aria-pressed="true">labCheck\.kind\.PD · 2</);
    assert.match(h, /data-zc-kind="LC" aria-pressed="true">labCheck\.kind\.LC · 1</);
    assert.match(h, /data-zc-kind="MC" aria-pressed="false">labCheck\.kind\.MC · 1</);
    assert.match(h, /data-zc-kind="SY" aria-pressed="false">/);
    assert.doesNotMatch(h, /data-zc-kind="DU"/, 'ein Gefäß ohne Bestand bekommt keinen Knopf');
  });

  it('"nicht gefunden → aufgebraucht" fasst nur die angetippten Gefäße an', () => {
    a.labCheckScanned('PD-TA-171126-01');
    a._zcMarkMissingUsed();
    assert.deepEqual(a.welt.status, [
      ['LC-TA-171126-01', 'used'],
      ['PD-TA-171126-02', 'used']
    ]);
    assert.equal(a.welt.cultures.find((c) => c.type === 'MC').status, 'active');
    assert.equal(a.welt.cultures.find((c) => c.type === 'SY').status, 'active');
    assert.match(
      a.welt.bestaetigt,
      /"kinds":"labCheck\.kind\.PD, labCheck\.kind\.LC"/,
      'die Rückfrage nennt die Gefäße'
    );
  });

  it('Rückgängig stellt jeden Status wieder her, wie er war, und die Haken auch', () => {
    a.labCheckScanned('PD-TA-171126-01');
    a._zcMarkMissingUsed();
    a.welt.undo();
    assert.equal(a.welt.cultures.find((c) => c.id === 'LC-TA-171126-01').status, 'stored');
    assert.equal(a.welt.cultures.find((c) => c.id === 'PD-TA-171126-02').status, 'active');
    assert.ok(a._zcFound.has('PD-TA-171126-01'));
  });

  it('ein Tipp nimmt ein Gefäß dazu; ein zweiter wieder heraus', () => {
    a._lcKindToggle('MC');
    assert.ok(a._zcExpected().some(([id]) => id === 'MC-TA-171126-01'));
    a._lcKindToggle('MC');
    assert.ok(!a._zcExpected().some(([id]) => id === 'MC-TA-171126-01'));
    a._lcKindToggle('XX');
    assert.ok(!a._lcKinds.has('XX'), 'nur Gefäße, die es gibt');
  });

  it('ein gescanntes Gefäß, das nicht angetippt ist: abgehakt, nicht mitgezählt, nicht abgeschrieben', () => {
    a.labCheckScanned('MC-TA-171126-01');
    assert.match(a.welt.feedback.at(-1)[1], /^labCheck\.scanOther/);
    assert.match(a.welt.els['zc-count'].textContent, /"found":0,"total":3/);
    a._zcMarkMissingUsed();
    assert.ok(!a.welt.status.some(([id]) => id === 'MC-TA-171126-01'));
  });

  it('eine abgeschriebene Kultur, die im Regal steht, ist wieder aktiv', () => {
    a.labCheckScanned('PD-TA-171126-03');
    assert.deepEqual(a.welt.status, [['PD-TA-171126-03', 'active']]);
    assert.match(a.welt.feedback.at(-1)[1], /^labCheck\.scanRevived/);
  });

  it('eine unbekannte Nummer sagt das, und ein zweiter Scan derselben Kultur zählt nicht doppelt', () => {
    a.labCheckScanned('PD-XX-010101-01');
    assert.equal(a.welt.feedback.at(-1)[0], 'err');
    a.labCheckScanned('PD-TA-171126-01');
    a.labCheckScanned('PD-TA-171126-01');
    assert.match(a.welt.feedback.at(-1)[1], /^zoneCheck\.scanDup/);
  });

  it('nichts angetippt: die Liste sagt, was zu tun ist, und bietet kein Ausbuchen an', () => {
    a._lcKindToggle('PD');
    a._lcKindToggle('LC');
    assert.match(a.welt.els['zc-body'].innerHTML, /labCheck\.pickKind/);
    assert.equal(a.welt.els['zc-foot'].innerHTML, '');
  });
});

describe('Kulturen prüfen: was gescannt ist, bleibt auf dem Telefon', () => {
  it('nach einem Neuladen sind die Haken und die Gefäße noch da', () => {
    const a = baue({ cultures: BESTAND(), jetzt: 1_000_000 });
    a.openLabCheck();
    a._lcKindToggle('MC');
    a.labCheckScanned('PD-TA-171126-01');
    const b = baue({ cultures: BESTAND(), speicher: Object.fromEntries(a.welt.speicher), jetzt: 1_000_000 + 3600e3 });
    b.openLabCheck();
    assert.ok(b._zcFound.has('PD-TA-171126-01'));
    assert.ok(b._lcKinds.has('MC'));
  });

  it('nach einem Tag fängt die Inventur leer an; die Gefäße bleiben gewählt', () => {
    const a = baue({ cultures: BESTAND(), jetzt: 1_000_000 });
    a.openLabCheck();
    a._lcKindToggle('SY');
    a.labCheckScanned('PD-TA-171126-01');
    const b = baue({
      cultures: BESTAND(),
      speicher: Object.fromEntries(a.welt.speicher),
      jetzt: 1_000_000 + 25 * 3600e3
    });
    b.openLabCheck();
    assert.equal(b._zcFound.size, 0);
    assert.ok(b._lcKinds.has('SY'));
  });

  it('nach dem Ausbuchen ist die nächste Inventur leer', () => {
    const a = baue({ cultures: BESTAND(), jetzt: 1_000_000 });
    a.openLabCheck();
    a.labCheckScanned('PD-TA-171126-01');
    a._zcMarkMissingUsed();
    const b = baue({ cultures: BESTAND(), speicher: Object.fromEntries(a.welt.speicher), jetzt: 1_000_001 });
    b.openLabCheck();
    assert.equal(b._zcFound.size, 0);
  });

  it('Von vorn nimmt die Haken weg, mit Rückgängig', () => {
    const a = baue({ cultures: BESTAND() });
    a.openLabCheck();
    a.labCheckScanned('PD-TA-171126-01');
    a._lcVonVorn();
    assert.equal(a._zcFound.size, 0);
    a.welt.undo();
    assert.ok(a._zcFound.has('PD-TA-171126-01'));
  });

  it('ein kaputter Speicher bricht nichts', () => {
    const a = baue({ cultures: BESTAND(), speicher: { 'mp-lab-check': '{kaputt' } });
    a.openLabCheck();
    assert.equal(a._zcExpected().length, 3);
  });
});

describe('Kulturen prüfen in der App', () => {
  it('das Blatt hat eine Zeile für die Gefäße über der Liste', () => {
    const m = HTML.slice(HTML.indexOf('id="m-zonecheck"'));
    assert.ok(m.indexOf('id="zc-kinds"') > 0 && m.indexOf('id="zc-kinds"') < m.indexOf('id="zc-body"'));
  });
  it('ein Tipp auf ein Gefäß schaltet es um', () => {
    assert.match(APP, /closest\('\[data-zc-kind\]'\);\n\s*if \(kind\) return _lcKindToggle\(kind\.dataset\.zcKind\);/);
  });
  it('jedes Gefäß und jede neue Beschriftung gibt es in allen drei Sprachen', () => {
    const kinds = APP.match(/^const LC_KINDS = \[([^\]]*)\]/m)[1]
      .match(/'([A-Z0-9]+)'/g)
      .map((s) => s.slice(1, -1));
    const keys = [
      ...kinds.map((k) => 'labCheck.kind.' + k),
      'labCheck.kinds',
      'labCheck.empty',
      'labCheck.pickKind',
      'labCheck.scanBtn',
      'labCheck.scanOther',
      'labCheck.restart',
      'labCheck.restarted'
    ];
    for (const code of ['de', 'en', 'pt']) {
      const L = sprache(code);
      for (const k of keys) assert.ok(L[k], code + ': ' + k);
      assert.match(L['labCheck.confirmMsg'], /\{kinds\}/, code + ': die Rückfrage nennt die Gefäße');
    }
  });
});
