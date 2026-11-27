'use strict';
// Die Kamera liest Strichcodes auf jedem Telefon.
//
// Auf manchen Telefonen las die Kamera gut, auf anderen gar nicht, und am
// schwächsten waren die Strichcodes. Drei Gründe, alle hier festgehalten:
// html5-qrcode las eine Kopie des Kastens in Bildschirmgröße (gut 350 Punkte
// breit), legte nach dem Start ein Quadrat über die Kamera, das jede Auflösung
// löschte, und nahm den Barcode-Leser des Browsers auch dort, wo er nichts liest.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const LIB = quelle('lib/html5-qrcode.min.js');

describe('Kamera: die Kopie des Kastens so scharf wie die Kamera', () => {
  // Eine Attrappe von html5-qrcode: setupUi legt wie die echte Bibliothek die
  // Kopie in Bildschirmgröße an.
  function lauf(video, kasten) {
    const ctx = {
      canvas: { width: kasten.width, height: kasten.height },
      transform: null,
      setTransform(...a) {
        this.transform = a;
      }
    };
    function Html5Qrcode() {}
    Html5Qrcode.prototype.setupUi = function () {
      this.context = ctx;
      this.qrRegion = kasten;
      this.element = { querySelector: () => video };
    };
    const einbauen = new Function('Html5Qrcode', hebeFunktion('_camScharfLesen') + '\nreturn _camScharfLesen;')(
      Html5Qrcode
    );
    einbauen();
    const einmal = Html5Qrcode.prototype.setupUi;
    einbauen();
    assert.equal(Html5Qrcode.prototype.setupUi, einmal, 'nur einmal umwickelt');
    new Html5Qrcode().setupUi(360, 360, {});
    return ctx;
  }
  const KASTEN = { x: 9, y: 103, width: 342, height: 153 };
  const video = (vb, vh, cb, ch) => ({ videoWidth: vb, videoHeight: vh, clientWidth: cb, clientHeight: ch });

  it('so viele Punkte, wie die Kamera im Kasten hat', () => {
    const ctx = lauf(video(480, 480, 360, 360), KASTEN);
    assert.deepEqual([ctx.canvas.width, ctx.canvas.height], [456, 204]);
    const k = 480 / 360;
    assert.deepEqual(ctx.transform, [k, 0, 0, k, 0, 0]);
  });
  it('höchstens dreimal so viele', () => {
    const ctx = lauf(video(1440, 1440, 360, 360), KASTEN);
    assert.deepEqual([ctx.canvas.width, ctx.canvas.height], [1026, 459]);
    assert.deepEqual(ctx.transform, [3, 0, 0, 3, 0, 0]);
  });
  it('eine Kamera, die weniger hat als der Schirm, und ein Bild ohne Maße bleiben, wie sie waren', () => {
    for (const v of [video(320, 320, 360, 360), video(0, 0, 360, 360), video(1080, 1080, 0, 0), null]) {
      const ctx = lauf(v, KASTEN);
      assert.deepEqual([ctx.canvas.width, ctx.canvas.height, ctx.transform], [342, 153, null]);
    }
  });
  it('nicht mehr gespiegelt lesen, und kein Quadrat mehr hinterher', () => {
    const start = hebeFunktion('openCamScan');
    assert.match(start, /videoConstraints: _camVorgaben\(\),\s*disableFlip: true/);
    assert.doesNotMatch(start, /aspectRatio:/);
    assert.match(start, /_camScharfLesen\(\);\s*_camScanner = new Html5Qrcode\(/);
  });
});

describe('Kamera: was sie liefern soll', () => {
  const vorgaben = (seite) =>
    new Function('_camFacingMode', hebeFunktion('_camVorgaben') + '\nreturn _camVorgaben();')(seite);
  it('quadratisch wie bisher, aber 1080 Punkte, und die gewählte Seite', () => {
    assert.deepEqual(vorgaben('environment'), {
      facingMode: 'environment',
      aspectRatio: { ideal: 1 },
      width: { ideal: 1080 },
      height: { ideal: 1080 }
    });
    assert.equal(vorgaben('user').facingMode, 'user');
  });
  // Licht an oder Schärfe: applyConstraints ersetzt alles. Die Vorgaben gehen
  // jedes Mal mit, die Seite nicht (die wechselt nur ein neuer Start).
  const nachstellen = (caps, extra) => {
    const gesetzt = [];
    const track = {
      getCapabilities: () => caps,
      applyConstraints: (c) => {
        gesetzt.push(c);
        return Promise.resolve();
      }
    };
    new Function(
      '_camFacingMode',
      [hebeFunktion('_camVorgaben'), hebeFunktion('_camFokus'), hebeFunktion('_camNachstellen')].join('\n') +
        '\nreturn _camNachstellen;'
    )('environment')(track, extra);
    return gesetzt[0];
  };
  it('mit Licht und Schärfe, wo die Kamera das kann', () => {
    assert.deepEqual(nachstellen({ focusMode: ['manual', 'continuous'], torch: true }, [{ torch: true }]), {
      aspectRatio: { ideal: 1 },
      width: { ideal: 1080 },
      height: { ideal: 1080 },
      advanced: [{ torch: true }, { focusMode: 'continuous' }]
    });
  });
  it('ohne Schärfe, wo sie es nicht kann, und ohne getCapabilities', () => {
    assert.deepEqual(nachstellen({ focusMode: ['manual'] }, [{ torch: false }]).advanced, [{ torch: false }]);
    assert.deepEqual(nachstellen(undefined, []).advanced, []);
  });
  it('Licht und Schärfe gehen über die Vorgaben; kann ein Browser das nicht, wie vorher', () => {
    assert.match(
      hebeFunktion('toggleTorch'),
      /_camNachstellen\(track, \[\{ torch: newState \}\]\)\s*\.catch\(\(\) => track\.applyConstraints\(\{ advanced: \[\{ torch: newState \}\] \}\)\)/
    );
    assert.match(
      hebeFunktion('_detectTorchSupport'),
      /if \(_camFokus\(track\)\.length\) _camNachstellen\(track, \[\]\)\.catch\(\(\) => \{\}\);/
    );
  });
});

describe('Kamera: der Barcode-Leser des Telefons nur, wenn er liest', () => {
  const frage = (BD) =>
    new Function('window', hebeFunktion('_camNativFragen') + '\nreturn _camNativFragen();')({ BarcodeDetector: BD });
  const leser = (formate) => ({ getSupportedFormats: () => formate });

  it('kennt er QR und Code 128, liest er', async () => {
    assert.equal(await frage(leser(Promise.resolve(['qr_code', 'code_128', 'ean_13']))), true);
  });
  it('angeboten, aber ohne Formate (ohne die Google-Play-Dienste): der eigene liest', async () => {
    assert.equal(await frage(leser(Promise.resolve([]))), false);
    assert.equal(await frage(leser(Promise.resolve(['qr_code']))), false);
  });
  it('nicht da, kaputt oder ohne Liste: der eigene liest', async () => {
    assert.equal(await frage(undefined), false);
    assert.equal(await frage({}), false);
    assert.equal(await frage(leser(Promise.reject(new Error('NotSupported')))), false);
    assert.equal(
      await frage({
        getSupportedFormats() {
          throw new Error('kaputt');
        }
      }),
      false
    );
  });
  it('einmal gefragt, vor dem ersten Start; zu ist zu', () => {
    const start = hebeFunktion('openCamScan');
    assert.match(
      start,
      /if \(_camNativ === null\) \{\s*_camNativFragen\(\)\.then\(\(ok\) => \{\s*_camNativ = ok;\s*if \(_camState !== CAM_OPENING\) return;\s*_camState = CAM_IDLE;\s*openCamScan\(\);/
    );
    assert.match(
      start,
      /new Html5Qrcode\('cam-reader', \{ useBarCodeDetectorIfSupported: _camNativ, verbose: false \}\)/
    );
    assert.match(APP, /^let _camNativ = null;/m);
  });
});

// Die Kamera greift an zwei Stellen in html5-qrcode hinein. Kommt eine neue
// Fassung der Bibliothek, muss sie diese Stellen noch haben, sonst liest die
// Kamera wieder aus der kleinen Kopie, ohne dass es jemand merkt.
describe('Kamera: was sie von html5-qrcode braucht', () => {
  it('die Kopie entsteht in setupUi, und jedes Bild wird in den Kasten gezeichnet', () => {
    assert.match(LIB, /e\.prototype\.setupUi=function\(t,e,r\)\{/);
    assert.match(LIB, /this\.qrRegion=a,this\.context=l,this\.canvasElement=c/);
    assert.match(LIB, /this\.context\.drawImage\(i,l,h,a,c,0,0,this\.qrRegion\.width,this\.qrRegion\.height\)/);
    assert.match(LIB, /Html5Qrcode:\(\)=>W/);
    assert.match(LIB, /W=function\(\)\{function e\(t,e\)\{if\(this\.element=null/);
  });
  it('disableFlip lässt das Spiegeln aus, aspectRatio gilt nur, wenn es gesetzt ist', () => {
    assert.match(LIB, /!0===t\.disableFlip\?u\(\):/);
    assert.match(LIB, /c&&!s\.aspectRatio\|\|\(l\.aspectRatio=s\.aspectRatio\)/);
  });
  it('useBarCodeDetectorIfSupported: false heißt der eigene Leser', () => {
    assert.match(LIB, /if\(!f\(t\.useBarCodeDetectorIfSupported\)\)return!1!==t\.useBarCodeDetectorIfSupported/);
  });
});
