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
      /new Html5Qrcode\('cam-reader', \{\s*formatsToSupport: _camFormate\(\),\s*useBarCodeDetectorIfSupported: _camNativ,\s*verbose: false\s*\}\);\s*_camGruendlich\(_camScanner\);/
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

// Gründlich lesen: ZXing (auf dem iPhone der einzige Leser) mit TRY_HARDER, und
// wo der Leser des Telefons liest, nur er. Dazu nur die Arten, die es hier gibt.
describe('Kamera: gründlich lesen', () => {
  const gruendlich = new Function(
    APP.match(/^const ZXING_TRY_HARDER = 3;.*$/m)[0] +
      '\n' +
      hebeFunktion('_camGruendlich') +
      '\nreturn _camGruendlich;'
  )();

  it('ZXing allein: TRY_HARDER an', () => {
    const hints = new Map([
      [2, [0, 5]],
      [3, false]
    ]);
    const q = { primaryDecoder: { hints } };
    gruendlich({ qrcode: q });
    assert.equal(hints.get(3), true);
    assert.deepEqual(hints.get(2), [0, 5], 'die Arten bleiben');
  });
  it('der Leser des Telefons und ZXing: nur noch der des Telefons', () => {
    const zxing = { hints: new Map([[3, false]]) };
    const q = { primaryDecoder: { detector: {} }, secondaryDecoder: zxing };
    gruendlich({ qrcode: q });
    assert.equal(q.secondaryDecoder, null);
  });
  it('ohne Leser nichts, und kein Fehler', () => {
    gruendlich(null);
    gruendlich({});
    gruendlich({ qrcode: {} });
  });
  it('die Arten: QR, Code 128, DataMatrix, ITF, EAN-13; ohne die Liste der Bibliothek alle', () => {
    const formate = (F) =>
      new Function('window', hebeFunktion('_camFormate') + '\nreturn _camFormate();')({
        Html5QrcodeSupportedFormats: F
      });
    const F = { QR_CODE: 0, CODE_128: 5, DATA_MATRIX: 6, ITF: 8, EAN_13: 9 };
    assert.deepEqual(formate(F), [0, 5, 6, 8, 9]);
    assert.equal(formate(undefined), undefined);
  });
  it('15 Bilder je Sekunde statt 10', () => {
    assert.match(hebeFunktion('openCamScan'), /fps: 15,/);
  });
  it('was das von html5-qrcode braucht', () => {
    // TRY_HARDER steht in einer Map auf dem ZXing-Leser, mit dem Schlüssel 3,
    // und wird bei jedem Bild neu gelesen.
    assert.match(LIB, /t\[t\.TRY_HARDER=3\]="TRY_HARDER"/);
    assert.match(LIB, /o\.set\(E\.DecodeHintType\.TRY_HARDER,!1\),this\.hints=o/);
    assert.match(LIB, /new E\.MultiFormatReader\(this\.verbose,this\.hints\)/);
    // Mit dem Leser des Telefons kommt ZXing als zweiter dazu, und beide wechseln ab.
    assert.match(LIB, /this\.primaryDecoder=new S\(t,r,n\),this\.secondaryDecoder=new I\(t,r,n\)/);
    assert.match(LIB, /getDecoder=function\(\)\{return this\.secondaryDecoder\?/);
    // Die Arten, wie _camFormate sie nimmt.
    assert.match(LIB, /t\[t\.QR_CODE=0\]="QR_CODE"/);
    assert.match(LIB, /t\[t\.CODE_128=5\]="CODE_128",t\[t\.DATA_MATRIX=6\]="DATA_MATRIX"/);
    assert.match(LIB, /t\[t\.ITF=8\]="ITF",t\[t\.EAN_13=9\]="EAN_13"/);
    assert.match(LIB, /Html5QrcodeSupportedFormats = window\.__Html5QrcodeLibrary__\.Html5QrcodeSupportedFormats/);
  });
});
