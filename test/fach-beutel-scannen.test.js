'use strict';
// Beutel scannen im Fach: für die Inventur, und wenn die Dazu-Liste zu lang ist.
//
// Im Blatt eines Fachs steht unter Dazu oben "Beutel scannen". Der Knopf macht
// die Kamera auf, mit einem Umzug in dieses Fach: jeder gescannte Beutel kommt
// hierher. Ein anderes Fach-Etikett wechselt das Ziel, statt sein Blatt zu
// öffnen, solange der Umzug läuft. Was am Ende in keinem Fach steht, bucht
// "In keinem Fach" → "Alle ausbuchen" aus; das gab es schon.
//
// Alle Namen und Nummern hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');

const APP = quelle();
const sprache = (datei, code) => {
  const w = {};
  new Function('window', quelle(datei))(w);
  return w.LANG[code];
};

describe('brettScanned: ein Fach-Etikett', () => {
  function scanne(id, { scan, brett }) {
    const calls = [];
    const brettScanned = new Function(
      'scan',
      '_brett',
      'calls',
      `const rackVon = (x) => ({ id: x.split(':')[0], zoneId: 'Z9', levels: 5 });
      const brettVon = (x) => ({ rackId: x.split(':')[0], level: Number(x.split(':')[1]) });
      const brettName = (x) => x;
      const t = (k) => k;
      const setFb = (type, msg) => calls.push(['setFb', type, msg]);
      const brettZiehe = (x) => calls.push(['brettZiehe', x]);
      const armMoveRun = (x) => calls.push(['armMoveRun', x]);
      const closeCamScan = () => calls.push(['closeCamScan']);
      const closeScanModal = () => calls.push(['closeScanModal']);
      const brettOeffne = (s) => calls.push(['brettOeffne', s.kind, s.loc]);
      const document = { getElementById: () => ({ classList: { contains: () => true } }) };
      ${hebeFunktion('brettScanned', APP)}
      return brettScanned;`
    )(scan, brett || null, calls);
    brettScanned(id);
    return calls;
  }

  it('während eines Umzugs wird das Fach das neue Ziel, die Kamera bleibt offen', () => {
    const calls = scanne('Z9_R2:3', { scan: { action: 'MOVE', to: 'Z9_R2:1' } });
    assert.deepEqual(calls, [['armMoveRun', 'Z9_R2:3']]);
  });
  it('ein Umziehen ohne Ziel bekommt das Fach als Ziel', () => {
    const calls = scanne('Z9_R2:3', { scan: { action: 'MOVE', to: null } });
    assert.deepEqual(calls, [['armMoveRun', 'Z9_R2:3']]);
  });
  it('ohne Umzug öffnet sich sein Blatt wie bisher', () => {
    const calls = scanne('Z9_R2:3', { scan: { action: null, to: null } });
    assert.deepEqual(calls, [['closeCamScan'], ['closeScanModal'], ['brettOeffne', 'platz', 'Z9_R2:3']]);
  });
  it('bei einem anderen Vorgang (Ernten) auch', () => {
    const calls = scanne('Z9_R2:3', { scan: { action: 'HARVEST', to: null } });
    assert.deepEqual(calls.at(-1), ['brettOeffne', 'platz', 'Z9_R2:3']);
  });
  it('steht das Blatt beim Ziel-Fach, bleibt das Fach das Ziel dieses Umzugs', () => {
    const calls = scanne('Z9_R2:3', {
      scan: { action: 'MOVE', to: 'Z9_R2:1' },
      brett: { kind: 'platz', loc: 'Z9_R2:1', mode: 'target' }
    });
    assert.deepEqual(calls, [['brettZiehe', 'Z9_R2:3']]);
  });
  it('ein Fach, das es nicht mehr gibt, wird kein Ziel', () => {
    const calls = scanne('Z9_R2:7', { scan: { action: 'MOVE', to: 'Z9_R2:1' } });
    assert.deepEqual(calls, [['setFb', 'err', 'brett.scanGone']]);
  });
});

describe('brettAktion("scan"): die Kamera mit diesem Fach als Ziel', () => {
  function tippe(pending) {
    const calls = [];
    const brettAktion = new Function(
      'calls',
      'pending',
      `let _brett = { kind: 'platz', loc: 'Z9_R2:3', mode: 'add', n: 0 };
      const brettQuelle = () => [];
      const brettName = (x) => x;
      const _brettN = () => 0;
      const contamPending = () => pending;
      const brettZu = () => {
        calls.push(['brettZu']);
        _brett = null;
      };
      const armMode = (a, to) => calls.push(['armMode', a, to]);
      const rememberDest = (l) => calls.push(['rememberDest', l]);
      const openCamScan = () => calls.push(['openCamScan']);
      const _showCamHudToast = (ty, m) => calls.push(['hud', ty, m]);
      const zoneDisplayName = (l) => 'Raum ' + l;
      const t = (k, p) => k + (p ? ' ' + JSON.stringify(p) : '');
      ${hebeFunktion('brettAktion', APP)}
      return brettAktion;`
    )(calls, pending);
    brettAktion('scan');
    return calls;
  }

  it('Blatt zu, Umzug ins Fach, dann die Kamera, und dort die Meldung', () => {
    assert.deepEqual(tippe(false), [
      ['brettZu'],
      ['armMode', 'MOVE', 'Z9_R2:3'],
      ['rememberDest', 'Z9_R2:3'],
      ['openCamScan'],
      ['hud', 'ok', 'cam.moveArmed {"loc":"Raum Z9_R2:3"}']
    ]);
  });
  it('mit gesammelten Kontaminations-Beuteln passiert nichts (sie gingen sonst verloren)', () => {
    assert.deepEqual(tippe(true), []);
  });
});

describe('Dazu: "Beutel scannen" steht oben', () => {
  function zeige(kandidaten) {
    return new Function(
      'kandidaten',
      `const rackVon = () => ({ id: 'Z9_R2', zoneId: 'Z9', strainId: 3 });
      const toZone = () => 'Z9';
      const brettKandidaten = () => kandidaten.slice();
      const brettAelter = () => 0;
      const t = (k) => k;
      const sorteName = (b) => b.name;
      const spDot = () => '';
      const fmtDtShort = (d) => d;
      const zoneDisplayName = (z) => z;
      ${hebeFunktion('esc', APP)}
      ${hebeFunktion('_bb', APP)}
      ${hebeKonstante('BRETT_ANSICHT', APP)}
      return BRETT_ANSICHT.add({ kind: 'platz', loc: 'Z9_R2:3', mode: 'add', n: 0 });`
    )(kandidaten);
  }
  const knopf = 'data-brett-act="scan"';

  it('über der Liste der Chargen, als Hauptknopf', () => {
    const h = zeige([
      { batch: 'TEST-1', b: { name: 'Testpilz' }, made: '2026-01-01', strainId: 3, zone: 'Z9', bags: [1, 2] }
    ]);
    assert.ok(h.includes(knopf), 'Knopf fehlt');
    assert.ok(h.indexOf(knopf) < h.indexOf('data-brett-charge'), 'Knopf steht unter der Liste');
    assert.match(h, /class="btn btn-p" data-brett-act="scan">brett\.scanBags</);
    assert.ok(h.indexOf('brett.scanHelp') < h.indexOf('brett.addQ'));
  });
  it('auch wenn nichts auf ein Fach wartet: Beutel von anderswo kann man scannen', () => {
    const h = zeige([]);
    assert.ok(h.includes(knopf));
    assert.ok(h.indexOf(knopf) < h.indexOf('brett.addNone'));
  });
});

describe('die Texte', () => {
  for (const [datei, code] of [
    ['lang/de.js', 'de'],
    ['lang/en.js', 'en'],
    ['lang/pt.js', 'pt']
  ]) {
    it(code + ': Knopf und Hilfe', () => {
      const L = sprache(datei, code);
      assert.ok(L['brett.scanBags'] && L['brett.scanHelp']);
    });
  }
  it('deutsch', () => {
    const DE = sprache('lang/de.js', 'de');
    assert.equal(DE['brett.scanBags'], 'Beutel scannen');
  });
});
