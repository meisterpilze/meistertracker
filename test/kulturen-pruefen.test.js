'use strict';
// Kulturen prüfen: die Inventur im Labor, mit der Kamera.
//
// Labor → Kulturen → Prüfen listet die Kulturen, die die App noch im Bestand
// meint, und jeder Scan hakt eine ab. Was am Ende fehlt, geht als aufgebraucht
// hinaus. Vorher standen dort alle Kulturen auf einmal: wer nur die
// Petrischalen und die FK-Gläser durchscannte, schrieb mit "nicht gefunden →
// aufgebraucht" auch jeden Slant und jede Spritze ab. Jetzt zählen nur die
// Gefäße, die oben angetippt sind; Petri und FK-Glas zu Beginn. Eingelagert
// ist ein eigener Knopf, zu Beginn aus.
//
// Alle Namen und Nummern hier sind ausgedacht.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { quelle } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const SERVER = quelle('server.js');
const sprache = (code) => {
  const w = {};
  new Function('window', quelle('lang/' + code + '.js'))(w);
  return w.LANG[code];
};
const STUNDE = 3600e3;
const BEKANNT = ['PD', 'LC', 'MC', 'SY', 'G2G', 'GS', 'DU'];

// Der Block von LC_KINDS bis _lcVonVorn, gegen Attrappen.
function baue(start) {
  const m = APP.match(/^const LC_KINDS = [\s\S]*?^function _lcVonVorn\(\) \{[\s\S]*?\r?\n\}/m);
  assert.ok(m, 'der Block der Laborinventur ist umgezogen — der Test muss mitgeführt werden');
  const welt = {
    cultures: start.cultures,
    speicher: new Map(Object.entries(start.speicher || {})),
    els: {},
    feedback: [],
    toasts: [],
    status: [],
    undo: null,
    bestaetigt: null,
    jetzt: start.jetzt || 1_000_000
  };
  const el = (id) =>
    (welt.els[id] = welt.els[id] || { innerHTML: '', textContent: '', classList: { add() {}, remove() {} } });
  // Wie das echte t(): ein Schlüssel, den es nicht gibt, kommt als er selbst zurück.
  const t = (k, p) => {
    const kind = /^labCheck\.kind\.(.+)$/.exec(k);
    if (kind) return BEKANNT.includes(kind[1]) ? 'kind:' + kind[1] : k;
    return k + (p ? ' ' + JSON.stringify(p) : '');
  };
  const f = new Function(
    'welt',
    'el',
    't',
    'EchtesDatum',
    `const document = { getElementById: el };
    const localStorage = {
      getItem: (k) => (welt.speicher.has(k) ? welt.speicher.get(k) : null),
      setItem: (k, v) => welt.speicher.set(k, String(v))
    };
    class Date extends EchtesDatum {
      static now() { return welt.jetzt; }
    }
    const currentLang = 'de';
    const cultures = welt.cultures;
    const esc = (s) => String(s);
    const toast = (text) => welt.toasts.push(text);
    const zoneDisplayName = (z) => z;
    const getZoneBags = () => ({ 'B-1': { batchId: 'B' } });
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
    return {
      openLabCheck, labCheckScanned, _zcMarkMissingUsed, _lcKindToggle, _lcLagerToggle, _lcVonVorn,
      _zcRowToggle, _zcExpected, _zcFound, _lcKinds,
      zone: () => { _zcMode = 'zone'; _zcFound.clear(); },
      moved: () => _zcMoved
    };`
  );
  return { welt, ...f(welt, el, t, Date) };
}

const kultur = (id, type, status = 'active') => ({ id, type, status, species: 'Testart Alpha' });
const BESTAND = () => [
  kultur('PD-TA-171126-01', 'PD'),
  kultur('PD-TA-171126-02', 'PD'),
  kultur('LC-TA-171126-01', 'LC', 'stored'),
  kultur('LC-TA-171126-02', 'LC'),
  kultur('MC-TA-171126-01', 'MC'),
  kultur('SY-TA-171126-01', 'SY'),
  kultur('PD-TA-171126-03', 'PD', 'used')
];
const status = (a, id) => a.welt.cultures.find((c) => c.id === id).status;
const weiter = (a, jetzt) => {
  const b = baue({ cultures: a.welt.cultures, speicher: Object.fromEntries(a.welt.speicher), jetzt });
  b.openLabCheck();
  return b;
};

describe('Kulturen prüfen: nur die angetippten Gefäße', () => {
  let a;
  beforeEach(() => {
    a = baue({ cultures: BESTAND() });
    a.openLabCheck();
  });

  it('zu Beginn Petri und FK-Glas, ohne Eingelagertes: Slants und Spritzen stehen nicht in der Liste', () => {
    assert.deepEqual(
      a._zcExpected().map(([id]) => id),
      ['LC-TA-171126-02', 'PD-TA-171126-01', 'PD-TA-171126-02']
    );
  });

  it('die Knöpfe oben zeigen jedes Gefäß mit seiner Zahl, und Eingelagert', () => {
    const h = a.welt.els['zc-kinds'].innerHTML;
    assert.match(h, /data-zc-kind="PD" aria-pressed="true">kind:PD · 2</);
    assert.match(h, /data-zc-kind="LC" aria-pressed="true">kind:LC · 1</);
    assert.match(h, /data-zc-kind="MC" aria-pressed="false">kind:MC · 1</);
    assert.match(h, /data-zc-kind="SY" aria-pressed="false">/);
    assert.doesNotMatch(h, /data-zc-kind="DU"/, 'ein Gefäß ohne Bestand bekommt keinen Knopf');
    assert.match(h, /data-zc-lager="1" aria-pressed="false">labCheck\.stored · 1</);
  });

  it('"nicht gefunden → aufgebraucht" fasst nur die angetippten Gefäße an, nichts Eingelagertes', () => {
    a.labCheckScanned('PD-TA-171126-01');
    a._zcMarkMissingUsed();
    assert.deepEqual(a.welt.status, [
      ['LC-TA-171126-02', 'used'],
      ['PD-TA-171126-02', 'used']
    ]);
    for (const id of ['MC-TA-171126-01', 'SY-TA-171126-01']) assert.equal(status(a, id), 'active');
    assert.equal(status(a, 'LC-TA-171126-01'), 'stored');
    assert.match(a.welt.bestaetigt, /"kinds":"kind:PD, kind:LC"/, 'die Rückfrage nennt die Gefäße');
  });

  it('mit Eingelagert zählt auch das Eingelagerte, und die Rückfrage sagt es', () => {
    a._lcLagerToggle();
    assert.ok(a._zcExpected().some(([id]) => id === 'LC-TA-171126-01'));
    a._zcMarkMissingUsed();
    assert.match(a.welt.bestaetigt, /labCheck\.storedToo/);
    assert.equal(status(a, 'LC-TA-171126-01'), 'used');
  });

  it('Rückgängig stellt jeden Status wieder her, wie er war, und die Haken auch', () => {
    a._lcLagerToggle();
    a.labCheckScanned('PD-TA-171126-01');
    a._zcMarkMissingUsed();
    a.welt.undo();
    assert.equal(status(a, 'LC-TA-171126-01'), 'stored');
    assert.equal(status(a, 'PD-TA-171126-02'), 'active');
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
    a.labCheckScanned('LC-TA-171126-01');
    assert.match(a.welt.feedback.at(-1)[1], /^labCheck\.scanOther .*labCheck\.stored/, 'eingelagert, Knopf aus');
    assert.match(a.welt.els['zc-count'].textContent, /"found":0,"total":3/);
    a._zcMarkMissingUsed();
    assert.ok(!a.welt.status.some(([id]) => id === 'MC-TA-171126-01'));
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

  it('eine Art, die die Liste nicht kennt, heißt wie ihr Kürzel, nicht wie ein Schlüssel', () => {
    a.welt.cultures.push(kultur('XQ-TA-171126-01', 'XQ'));
    a.labCheckScanned('XQ-TA-171126-01');
    assert.match(a.welt.feedback.at(-1)[1], /"kind":"XQ"/);
  });
});

describe('Kulturen prüfen: ein Fehlscan lässt sich zurücknehmen', () => {
  let a;
  beforeEach(() => {
    a = baue({ cultures: BESTAND() });
    a.openLabCheck();
    a.labCheckScanned('PD-TA-171126-03');
  });

  it('eine abgeschriebene Kultur, die im Regal steht, ist wieder aktiv', () => {
    assert.deepEqual(a.welt.status, [['PD-TA-171126-03', 'active']]);
    assert.match(a.welt.feedback.at(-1)[1], /^labCheck\.scanRevived/);
  });

  it('die Zeile abhaken setzt sie zurück, wie sie vor dem Scan stand', () => {
    a._zcRowToggle('PD-TA-171126-03');
    assert.equal(status(a, 'PD-TA-171126-03'), 'used');
    assert.equal(a.moved(), 0);
    assert.match(a.welt.toasts.at(-1), /^labCheck\.reviveUndone/);
  });

  it('Von vorn setzt sie auch zurück, und Rückgängig holt sie wieder', () => {
    a._lcVonVorn();
    assert.equal(status(a, 'PD-TA-171126-03'), 'used');
    a.welt.undo();
    assert.equal(status(a, 'PD-TA-171126-03'), 'active');
    assert.ok(a._zcFound.has('PD-TA-171126-03'));
  });

  it('was zurückgeholt ist, übersteht ein Neuladen und lässt sich dann noch zurücknehmen', () => {
    const b = weiter(a, a.welt.jetzt + STUNDE);
    b._zcRowToggle('PD-TA-171126-03');
    assert.equal(status(b, 'PD-TA-171126-03'), 'used');
  });
});

describe('Kulturen prüfen: was gescannt ist, bleibt auf dem Telefon', () => {
  it('nach einem Neuladen sind die Haken und die Gefäße noch da, und die Zeile sagt seit wann', () => {
    const a = baue({ cultures: BESTAND() });
    a.openLabCheck();
    a._lcKindToggle('MC');
    a.labCheckScanned('PD-TA-171126-01');
    const b = weiter(a, a.welt.jetzt + STUNDE);
    assert.ok(b._zcFound.has('PD-TA-171126-01'));
    assert.ok(b._lcKinds.has('MC'));
    assert.match(b.welt.els['zc-count'].textContent, /labCheck\.resumed/);
    assert.doesNotMatch(a.welt.els['zc-count'].textContent, /labCheck\.resumed/, 'ein frischer Durchgang sagt nichts');
  });

  it('die Frist zählt ab dem ersten Haken: das Blatt nur öffnen verlängert sie nicht', () => {
    const a = baue({ cultures: BESTAND() });
    a.openLabCheck();
    a.labCheckScanned('PD-TA-171126-01');
    const b = weiter(a, a.welt.jetzt + 20 * STUNDE);
    assert.ok(b._zcFound.has('PD-TA-171126-01'));
    const c = weiter(b, a.welt.jetzt + 25 * STUNDE);
    assert.equal(c._zcFound.size, 0);
  });

  it('nach einem Tag fängt die Inventur leer an; die Gefäße bleiben gewählt', () => {
    const a = baue({ cultures: BESTAND() });
    a.openLabCheck();
    a._lcKindToggle('SY');
    a._lcLagerToggle();
    a.labCheckScanned('PD-TA-171126-01');
    const b = weiter(a, a.welt.jetzt + 25 * STUNDE);
    assert.equal(b._zcFound.size, 0);
    assert.ok(b._lcKinds.has('SY'));
    assert.ok(
      b._zcExpected().some(([id]) => id === 'LC-TA-171126-01'),
      'Eingelagert bleibt an'
    );
  });

  it('auch "nichts angetippt" bleibt gewählt', () => {
    const a = baue({ cultures: BESTAND() });
    a.openLabCheck();
    a._lcKindToggle('PD');
    a._lcKindToggle('LC');
    const b = weiter(a, a.welt.jetzt + 1);
    assert.equal(b._lcKinds.size, 0);
  });

  it('nach dem Ausbuchen ist die nächste Inventur leer', () => {
    const a = baue({ cultures: BESTAND() });
    a.openLabCheck();
    a.labCheckScanned('PD-TA-171126-01');
    a._zcMarkMissingUsed();
    const b = weiter(a, a.welt.jetzt + 1);
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

  it('Rückgängig, während eine Zonenprüfung offen ist: die Haken gehen in den Speicher, nicht in die Zone', () => {
    const a = baue({ cultures: BESTAND() });
    a.openLabCheck();
    a.labCheckScanned('PD-TA-171126-01');
    a._zcMarkMissingUsed();
    a.zone();
    a.welt.undo();
    assert.equal(a._zcFound.size, 0, 'die Zone bekommt keine Kulturen');
    const b = weiter(a, a.welt.jetzt + 1);
    assert.ok(b._zcFound.has('PD-TA-171126-01'), 'die nächste Laborinventur hat sie');
  });

  it('die Speicherung der ersten Fassung (mit "at") geht weiter', () => {
    const alt = { 'mp-lab-check': JSON.stringify({ at: 1_000_000, found: ['PD-TA-171126-01'], kinds: ['PD'] }) };
    const a = baue({ cultures: BESTAND(), speicher: alt, jetzt: 1_000_000 + STUNDE });
    a.openLabCheck();
    assert.ok(a._zcFound.has('PD-TA-171126-01'));
  });

  it('ein kaputter Speicher bricht nichts', () => {
    const a = baue({ cultures: BESTAND(), speicher: { 'mp-lab-check': '{kaputt' } });
    a.openLabCheck();
    assert.equal(a._zcExpected().length, 3);
  });
});

// Vom Laborbestand aus: das Blatt einer Art in einem Gefäß hat Scannen. Dann
// zählt nur diese Art in diesem Gefäß, und die Wahl der Gefäße oben bleibt.
// Spritzen in allen Größen: sie stehen zusammen, unter einem Etikett der Art.
describe('Kulturen prüfen: ein Fach vom Laborbestand', () => {
  const FACH = { strainId: 1, name: 'Testart Alpha', kind: 'PD', size: null };
  const bestand = () => [
    ...BESTAND().map((c) => ({ ...c, strainId: 1 })),
    { id: 'PD-TB-171126-01', type: 'PD', status: 'active', species: 'Testart Beta', strainId: 2 },
    { id: 'SY-TA-171126-02', type: 'SY', status: 'active', species: 'Testart Alpha', strainId: 1, ml: 20 }
  ];
  let a;
  beforeEach(() => {
    a = baue({ cultures: bestand() });
    a.openLabCheck(FACH);
  });

  it('erwartet nur die Schalen dieser Art, ohne Knöpfe für die Gefäße', () => {
    assert.deepEqual(
      a._zcExpected().map(([id]) => id),
      ['PD-TA-171126-01', 'PD-TA-171126-02']
    );
    assert.doesNotMatch(a.welt.els['zc-kinds'].innerHTML, /data-zc-kind=/);
    assert.match(a.welt.els['zc-title'].textContent, /^labCheck\.titleFach .*Testart Alpha · kind:PD/);
  });

  it('eine Schale einer anderen Art: abgehakt, nicht mitgezählt, nicht abgeschrieben', () => {
    a.labCheckScanned('PD-TB-171126-01');
    assert.match(a.welt.feedback.at(-1)[1], /^labCheck\.scanOtherFach/);
    a.labCheckScanned('PD-TA-171126-01');
    a._zcMarkMissingUsed();
    assert.deepEqual(a.welt.status, [['PD-TA-171126-02', 'used']]);
    assert.match(a.welt.bestaetigt, /"kinds":"Testart Alpha · kind:PD"/);
  });

  it('eine abgeschriebene Schale dieser Art, die im Regal steht, ist wieder da', () => {
    a.labCheckScanned('PD-TA-171126-03');
    assert.equal(status(a, 'PD-TA-171126-03'), 'active');
    assert.deepEqual(
      a._zcExpected().map(([id]) => id),
      ['PD-TA-171126-01', 'PD-TA-171126-02', 'PD-TA-171126-03']
    );
    assert.ok(a._zcFound.has('PD-TA-171126-03'));
  });

  it('Spritzen: alle Größen der Art, auch vom Etikett ohne Größe, jede mit ihrer Größe in der Zeile', () => {
    for (const fach of [
      { ...FACH, kind: 'SY', size: 10 },
      { ...FACH, kind: 'SY', size: null, group: true }
    ]) {
      const b = baue({ cultures: bestand() });
      b.openLabCheck(fach);
      assert.deepEqual(
        b._zcExpected().map(([id, d]) => [id, d.batchId]),
        [
          ['SY-TA-171126-01', 'Testart Alpha · 10 ml'],
          ['SY-TA-171126-02', 'Testart Alpha · 20 ml']
        ],
        'ohne ml ist eine Spritze 10 ml'
      );
    }
  });

  it('Ausbuchen nimmt nur die Haken dieses Fachs weg; die der anderen Art warten auf deren Fach', () => {
    a.labCheckScanned('PD-TB-171126-01');
    a.labCheckScanned('PD-TA-171126-01');
    a._zcMarkMissingUsed();
    assert.deepEqual([...a._zcFound], ['PD-TB-171126-01']);
    const b = weiter(a, a.welt.jetzt + 1);
    assert.ok(b._zcFound.has('PD-TB-171126-01'), 'auch nach einem Neuladen');
    a.welt.undo();
    assert.equal(status(a, 'PD-TA-171126-02'), 'active');
    assert.ok(a._zcFound.has('PD-TA-171126-01'));
  });

  it('Von vorn auch: nur dieses Fach, und eine zurückgeholte Schale der anderen Art bleibt aktiv', () => {
    a.welt.cultures.push({ id: 'PD-TB-171126-02', type: 'PD', status: 'used', species: 'Testart Beta', strainId: 2 });
    a.labCheckScanned('PD-TB-171126-02');
    a.labCheckScanned('PD-TA-171126-03');
    a._lcVonVorn();
    assert.equal(status(a, 'PD-TA-171126-03'), 'used');
    assert.equal(status(a, 'PD-TB-171126-02'), 'active');
    assert.deepEqual([...a._zcFound], ['PD-TB-171126-02']);
    a.welt.undo();
    assert.equal(status(a, 'PD-TA-171126-03'), 'active');
    assert.ok(a._zcFound.has('PD-TA-171126-03'));
  });

  it('die Wahl der Gefäße für das ganze Regal bleibt, und Prüfen danach zählt wieder alle Arten', () => {
    const b = weiter(a, a.welt.jetzt + 1);
    assert.deepEqual([...b._lcKinds].sort(), ['LC', 'PD']);
    assert.ok(b._zcExpected().some(([id]) => id === 'PD-TB-171126-01'));
  });

  it('Haken einer anderen Art von vorhin sagen nicht "fortgesetzt"', () => {
    a.labCheckScanned('PD-TB-171126-01');
    const b = baue({
      cultures: a.welt.cultures,
      speicher: Object.fromEntries(a.welt.speicher),
      jetzt: a.welt.jetzt + 1
    });
    b.openLabCheck(FACH);
    assert.doesNotMatch(b.welt.els['zc-count'].textContent, /labCheck\.resumed/);
  });
});

// Slants haben kein Fach: ein Tipp auf ihre Zahl öffnet das Blatt der Art. Dort
// steht ihre Kamera, an der Zeile der Slants, und öffnet dieselbe Prüfung.
describe('Kulturen prüfen: die Slants vom Blatt der Art', () => {
  it('die Zeile der Slants hat die Kamera, die anderen Zeilen nicht', () => {
    assert.match(
      APP,
      /const kamera =\s*sp && i\.key === 'MC'\s*\?\s*`<button type="button" class="lb-cam" data-lb-scan="MC" aria-label="\$\{esc\(t\('lf\.scan'\)\)\}"/
    );
    assert.match(APP, /\$\{soll\}\$\{weg\}\$\{kamera\}<\/div>\$\{make\}/);
  });
  it('die Kamera ist die vom Scan-Knopf, ohne Wort', () => {
    const svg = /^const KAMERA_SVG =([\s\S]*?);$/m.exec(APP);
    assert.ok(svg, 'KAMERA_SVG');
    for (const teil of ['<rect x="2" y="5" width="20" height="15" rx="2" />', '<circle cx="12" cy="13" r="4" />'])
      assert.ok(svg[1].includes(teil) && HTML.slice(HTML.indexOf('id="cam-fab"')).includes(teil), teil);
  });
  it('ein Tipp schließt das Blatt und öffnet die Prüfung für diese Art in diesem Gefäß', () => {
    assert.match(APP, /closest\('\[data-lb-scan\]'\);\s*if \(sc\) return lbScannen\(sc\.dataset\.lbScan\);/);
    assert.match(
      APP,
      /function lbScannen\(kind\) \{[^}]*lbSheetClose\(\);\s*openLabCheck\(\{ strainId: sp\.strainId, name: sp\.name, kind \}\);/
    );
    const CSS = quelle('styles.css');
    assert.match(CSS, /\.lb-cam \{[^}]*min-height: var\(--tap-sm\)/);
  });
  it('die Prüfung kennt die Slants: Titel und Liste nur dieser Art', () => {
    const a = baue({ cultures: BESTAND().map((c) => ({ ...c, strainId: 1 })) });
    a.openLabCheck({ strainId: 1, name: 'Testart Alpha', kind: 'MC' });
    assert.deepEqual(
      a._zcExpected().map(([id]) => id),
      ['MC-TA-171126-01']
    );
    assert.match(a.welt.els['zc-title'].textContent, /Testart Alpha · kind:MC/);
  });
});

describe('Kulturen prüfen in der App', () => {
  it('das Blatt eines Fachs hat Scannen, bei Körnerbrut nicht, und Prüfen öffnet ohne Fach', () => {
    const m = HTML.slice(HTML.indexOf('id="m-labfach"'), HTML.indexOf('id="m-kbz"'));
    assert.match(m, /id="m-lf-scan"\s+data-lf-act="scan"\s+data-i18n-aria-label="lf\.scan"/);
    // Die Kamera wie am Scan-Knopf unten, kein Wort: data-i18n würde sie überschreiben.
    const knopf = m.slice(m.indexOf('id="m-lf-scan"'), m.indexOf('</button>', m.indexOf('id="m-lf-scan"')));
    assert.match(knopf, /<circle cx="12" cy="13" r="4" \/>/);
    assert.doesNotMatch(knopf, /data-i18n="/);
    assert.match(
      APP,
      /if \(a === 'scan'\) \{\s*if \(f\.kind === 'KB'\) return;\s*lfClose\(\);\s*return openLabCheck\(f\);/
    );
    assert.match(APP, /getElementById\('m-lf-scanrow'\)\.hidden = f\.kind === 'KB';/);
    assert.match(m, /<div class="shelf-acts" id="m-lf-scanrow">/, 'eigene Zeile: [hidden] gilt über .shelf-acts');
    assert.ok(
      APP.indexOf("if (a === 'scan')") < APP.indexOf("if (f.group) return toast(t('lf.pickSize')"),
      'Scannen geht auch am Spritzen-Etikett, ohne gewählte Größe'
    );
    assert.match(APP, /\$\('lab-check-btn'\)\.addEventListener\('click', \(\) => openLabCheck\(\)\);/);
    for (const code of ['de', 'en', 'pt'])
      for (const k of ['lf.scan', 'labCheck.titleFach', 'labCheck.emptyFach', 'labCheck.scanOtherFach'])
        assert.ok(sprache(code)[k], code + ': ' + k);
  });

  it('das Blatt hat eine Zeile für die Gefäße über der Liste', () => {
    const m = HTML.slice(HTML.indexOf('id="m-zonecheck"'));
    assert.ok(m.indexOf('id="zc-kinds"') > 0 && m.indexOf('id="zc-kinds"') < m.indexOf('id="zc-body"'));
  });
  it('ein Tipp auf ein Gefäß, auf Eingelagert oder auf eine Zeile', () => {
    assert.match(APP, /closest\('\[data-zc-kind\]'\);\n\s*if \(kind\) return _lcKindToggle\(kind\.dataset\.zcKind\);/);
    assert.match(APP, /closest\('\[data-zc-lager\]'\)\) return _lcLagerToggle\(\);/);
    assert.match(APP, /if \(row\) return _zcRowToggle\(row\.dataset\.zcBag\);/);
  });
  it('die Gefäße sind dieselben wie die Kulturarten des Servers', () => {
    const app = APP.match(/^const LC_KINDS = \[([^\]]*)\]/m)[1].match(/'([A-Z0-9]+)'/g);
    const srv = SERVER.match(/^const CULTURE_TYPES = \[([^\]]*)\]/m)[1].match(/'([A-Z0-9]+)'/g);
    assert.deepEqual([...app].sort(), [...srv].sort());
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
      'labCheck.restarted',
      'labCheck.stored',
      'labCheck.storedToo',
      'labCheck.resumed',
      'labCheck.reviveUndone'
    ];
    for (const code of ['de', 'en', 'pt']) {
      const L = sprache(code);
      for (const k of keys) assert.ok(L[k], code + ': ' + k);
      assert.match(L['labCheck.confirmMsg'], /\{kinds\}/, code + ': die Rückfrage nennt die Gefäße');
      assert.match(L['labCheck.resumed'], /\{time\}/, code);
    }
  });
});
