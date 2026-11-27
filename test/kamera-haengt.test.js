'use strict';
// Die Kamera bleibt nach einem Scan nicht stehen.
//
// Nach ein paar Petrischalen stand die Kamera: ein stehendes Bild mit dem
// grünen Rahmen vom letzten Treffer, und erst Zumachen und Aufmachen half. Zwei
// Wege führten dorthin, beide über das kurze Anhalten nach jedem Treffer:
// - pause(true) hielt auch das Video an, und html5-qrcode liest erst wieder,
//   wenn das Video danach "playing" meldet; das blieb auf manchem Telefon aus;
// - warf der Scan einen Fehler, wurde das Weiter gar nicht erst geplant.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const LIB = quelle('lib/html5-qrcode.min.js');
const sprache = (code) => {
  const w = {};
  new Function('window', quelle('lang/' + code + '.js'))(w);
  return w.LANG[code];
};

// _camWeiter gegen eine Attrappe des Scanners. `nachResume` ist der Zustand,
// in dem resume() ihn lässt: 2 liest wieder, 3 wartet noch aufs Video.
function baue({ zustand = 3, nachResume = 2, wirft = false } = {}) {
  const welt = { timer: [], resumes: 0, warnungen: 0 };
  const scanner = {
    zustand,
    getState() {
      return this.zustand;
    },
    resume() {
      welt.resumes++;
      if (wirft) throw new Error('Cannot result, scanner is not paused.');
      this.zustand = nachResume;
    }
  };
  const k = new Function(
    'welt',
    'scanner',
    `const CAM_OPEN = 'open';
    let _camState = 'open';
    let _camScanner = scanner;
    const setTimeout = (fn, ms) => welt.timer.push([fn, ms]);
    const console = { warn: () => welt.warnungen++ };
    ${APP.match(/^const CAM_PAUSIERT = 3;.*$/m)[0]}
    ${hebeFunktion('_camWeiter')}
    return {
      weiter: (v) => _camWeiter(scanner, v),
      zu: () => { _camState = 'closing'; },
      neu: () => { _camScanner = {}; }
    };`
  )(welt, scanner);
  // Den nächsten geplanten Versuch laufen lassen.
  const naechster = () => welt.timer.shift()[0]();
  return { welt, scanner, ...k, naechster };
}

describe('Kamera: nach dem Treffer liest sie weiter', () => {
  it('angehalten: weiter, und liest sie wieder, ist nichts mehr geplant', () => {
    const k = baue();
    k.weiter(0);
    assert.equal(k.welt.resumes, 1);
    assert.equal(k.scanner.zustand, 2);
    assert.deepEqual(k.welt.timer, []);
  });

  it('wartet sie noch aufs Video, versucht sie es jede Sekunde noch einmal, höchstens fünfmal', () => {
    const k = baue({ nachResume: 3 });
    k.weiter(0);
    assert.equal(k.welt.timer.length, 1);
    assert.equal(k.welt.timer[0][1], 1000);
    while (k.welt.timer.length) k.naechster();
    assert.equal(k.welt.resumes, 6, 'der erste und fünf weitere');
  });

  it('kommt das Video beim zweiten Versuch, hört sie auf', () => {
    const k = baue({ nachResume: 3 });
    k.weiter(0);
    k.scanner.getState = function () {
      return this.zustand;
    };
    k.scanner.resume = function () {
      k.welt.resumes++;
      this.zustand = 2;
    };
    k.naechster();
    assert.equal(k.scanner.zustand, 2);
    assert.deepEqual(k.welt.timer, []);
  });

  it('liest sie schon, fasst sie nichts an', () => {
    const k = baue({ zustand: 2 });
    k.weiter(0);
    assert.equal(k.welt.resumes, 0);
    assert.deepEqual(k.welt.timer, []);
  });

  it('zu oder eine neue Kamera: nichts', () => {
    const zu = baue();
    zu.zu();
    zu.weiter(0);
    const neu = baue();
    neu.neu();
    neu.weiter(0);
    assert.equal(zu.welt.resumes + neu.welt.resumes, 0);
  });

  it('wirft resume(), wird es gesagt und noch einmal versucht', () => {
    const k = baue({ wirft: true });
    k.weiter(0);
    assert.equal(k.welt.warnungen, 1);
    assert.equal(k.welt.timer.length, 1);
  });
});

describe('Kamera: der Treffer in openCamScan', () => {
  const start = hebeFunktion('openCamScan');
  it('hält nur das Lesen an, nicht das Bild', () => {
    assert.match(start, /try \{\s*scanner\.pause\(false\);\s*\} catch/);
    assert.doesNotMatch(APP, /\.pause\(true\)/);
  });
  it('plant das Weiter vor dem Scan, und ein Fehler im Scan sagt es, statt die Kamera anzuhalten', () => {
    const weiter = start.indexOf('setTimeout(() => _camWeiter(scanner, 0), pauseMs);');
    const scan = start.indexOf('processScan(decoded);');
    assert.ok(weiter > 0 && scan > weiter, 'erst das Weiter, dann der Scan');
    assert.match(
      start,
      /try \{\s*processScan\(decoded\);\s*\} catch \(e\) \{\s*console\.error\('Scan failed:', decoded, e\);\s*setFb\('err', t\('cam\.scanFailed'\)\);/
    );
  });
  it('die Meldung gibt es in jeder Sprache', () => {
    for (const code of ['de', 'en', 'pt']) assert.ok(sprache(code)['cam.scanFailed'], code);
  });
});

// Was das voraussetzt: pause(false) lässt das Video laufen, und resume() liest
// dann sofort weiter; nur ein angehaltenes Video wartet auf "playing".
describe('Kamera: was das Weiterlesen von html5-qrcode braucht', () => {
  it('pause(false) hält das Video nicht an', () => {
    assert.match(LIB, /\(f\(t\)\|\|!0!==t\)&&\(t=!1\),t&&this\.renderedCamera&&this\.renderedCamera\.pause\(\)/);
  });
  it('resume() wartet nur bei angehaltenem Video auf "playing"', () => {
    assert.match(
      LIB,
      /this\.renderedCamera\.isPaused\(\)\?this\.renderedCamera\.resume\(\(function\(\)\{e\(\)\}\)\):e\(\)/
    );
    assert.match(LIB, /this\.surface\.addEventListener\("playing",r\),this\.surface\.play\(\)/);
  });
  it('PAUSED ist 3', () => {
    assert.match(LIB, /t\[t\.SCANNING=2\]="SCANNING",t\[t\.PAUSED=3\]="PAUSED"/);
  });
});
