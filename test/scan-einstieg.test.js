'use strict';
// Kommt man am Telefon überhaupt in einen Umzug hinein?
//
// Der Scanner macht ohne gesetzten Vorgang auf. In diesem Zustand blendete die
// Kamera-Leiste das Ziel-Feld aus — und genau dieses Feld ist der Einstieg:
// scanPickDestination() setzt selbst MOVE, wenn keiner gesetzt ist. Der
// Einstieg lag also hinter dem Zustand, den er herstellt.
//
// Übrig blieb am Telefon: einen gedruckten MOVE-Barcode scannen. armScanAction()
// wird sonst nur aus dem Barcode-Handler und vom CONTAM-Knopf gerufen, und ein
// Blatt Papier hat in der Kammer niemand dabei. Die Meldung, die man beim
// Scannen eines Beutels bekam, nannte auch nur diesen Weg.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const SRC = quelle();
const hebeFunktion = (n) => _hf(n, SRC);

// Zeichnet die Kamera-Leiste für einen Scanner-Zustand und gibt zurück, was
// sichtbar ist.
function leiste(scanZustand) {
  const ids = [
    'cam-chip-action',
    'cam-chip-arrow',
    'cam-chip-count',
    'cam-chip-from',
    'cam-chip-to',
    'ch-action',
    'ch-count',
    'ch-from',
    'ch-to'
  ];
  return new Function(
    'scan',
    'ids',
    `
    const el = {};
    for (const id of ids) el[id] = { style: {}, className: '', textContent: '',
      classList: { toggle(c, an) { this[c] = !!an; } } };
    const document = { getElementById: (id) => el[id] || null };
    const zoneDisplayName = (z) => String(z);
    const t = (k) => k;
    ${hebeFunktion('updateCamHud')}
    updateCamHud();
    return { sichtbar: (id) => el[id].style.display !== 'none', klasse: (id) => el[id].className,
             pulst: (id) => !!el[id].classList['ch-pulse'] };
  `
  )(scanZustand, ids);
}

const leer = { action: null, from: null, to: null, count: 0, harvestBag: null };

describe('Der Einstieg in einen Umzug am Telefon', () => {
  it('zeigt das Ziel-Feld, bevor ein Vorgang gesetzt ist', () => {
    // Der Fehler in einer Zeile: ausgeblendet, solange kein Vorgang steht, und
    // antippen ist das Einzige, was einen setzt.
    const l = leiste({ ...leer });
    assert.ok(l.sichtbar('cam-chip-to'), 'ohne Ziel-Feld bleibt am Telefon nur ein gedruckter Barcode');
  });

  it('lässt es pulsen, solange kein Ziel gewählt ist', () => {
    assert.ok(leiste({ ...leer }).pulst('cam-chip-to'), 'es ist das Feld, das als Nächstes dran ist');
  });

  it('zeigt es weiter, wenn MOVE steht', () => {
    assert.ok(leiste({ ...leer, action: 'MOVE' }).sichtbar('cam-chip-to'));
  });

  it('hört auf zu pulsen, sobald das Ziel steht', () => {
    const l = leiste({ ...leer, action: 'MOVE', to: 'TENT1' });
    assert.ok(!l.pulst('cam-chip-to'), 'gesetzt ist gesetzt');
    assert.match(l.klasse('cam-chip-to'), /ch-set/);
  });

  it('blendet es aus, wo es nichts zu wählen gibt', () => {
    // ERNTE und ENTFERNEN brauchen kein Ziel; ein Feld anzubieten, das nichts
    // tut, ist schlechter als keines.
    for (const a of ['HARVEST', 'REMOVE', 'CONTAM']) {
      assert.ok(!leiste({ ...leer, action: a }).sichtbar('cam-chip-to'), a + ' braucht kein Ziel');
    }
  });

  it('sagt in der Meldung, dass man tippen kann, nicht nur scannen', () => {
    // Wer einen Beutel ohne Vorgang scannt, bekam "scanne ADD, MOVE, REMOVE
    // oder HARVEST" — der einzige genannte Weg war der, den ein Telefon nicht
    // hat.
    for (const lang of ['de', 'en', 'pt']) {
      const txt = quelle('lang/' + lang + '.js').match(/'scanFb\.setAction': '([^']*)'/);
      assert.ok(txt, lang + ': scanFb.setAction fehlt');
      assert.match(
        txt[1],
        /antippen|Tap|Toque/,
        lang + ': die Meldung nennt nur das Scannen, nicht den Weg, den das Telefon hat'
      );
    }
  });
});
