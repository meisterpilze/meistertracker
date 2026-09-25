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
//
// Seit den vier Knöpfen in der Kamera (test/scan-in-serie.test.js) ist der
// Umziehen-Knopf die Tür. Die Reihe mit Vorgang, Ziel und Zähler spricht die
// Sprache der gedruckten Etiketten und steht nur noch da, wo sie etwas sagt, was
// kein Knopf sagt: bei einem Vorgang ohne Knopf (ADD, MOVE_BATCH) oder einem
// Umzug, dem das Ziel fehlt. Dort bleibt das Feld die Tür zum Ziel.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const SRC = quelle();
const hebeFunktion = (n) => _hf(n, SRC);

// Zeichnet die Kamera-Leiste für einen Scanner-Zustand und gibt zurück, was
// sichtbar ist.
function leiste(scanZustand) {
  const ids = [
    'cam-hud-chips',
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
    const zoneDisplayName = (z) => (z === 'TENT1' ? 'Zelt 1' : String(z));
    const t = (k) => k;
    ${hebeFunktion('updateCamHud')}
    updateCamHud();
    // Sichtbar heißt: das Feld selbst UND seine Reihe.
    const zu = (id) => el[id].style.display === 'none';
    return { sichtbar: (id) => !zu(id) && !zu('cam-hud-chips'), reihe: () => !zu('cam-hud-chips'),
             klasse: (id) => el[id].className, text: (id) => el[id].textContent,
             pulst: (id) => !!el[id].classList['ch-pulse'] };
  `
  )(scanZustand, ids);
}

const leer = { action: null, from: null, to: null, count: 0, harvestBag: null };

describe('Der Einstieg in einen Umzug am Telefon', () => {
  it('hat einen Umziehen-Knopf in der Kamera', () => {
    // Der Fehler in einer Zeile: am Telefon gab es keinen Weg in einen Umzug,
    // außer einem gedruckten Barcode.
    const html = quelle('index.html');
    const kamera = html.slice(html.indexOf('id="cam-scan-hud"'), html.indexOf('<!-- Sidebar -->'));
    assert.match(kamera, /id="btn-cam-move"/);
    assert.match(SRC, /\['btn-cam-move', toggleMoveScan\]/, 'der Knopf ist an nichts gebunden');
  });

  it('blendet die Etiketten-Reihe ohne Vorgang aus — die Knöpfe sagen genug', () => {
    assert.ok(!leiste({ ...leer }).reihe());
  });

  it('zeigt die Reihe samt Ziel-Feld, solange ein Umzug auf sein Ziel wartet', () => {
    // Ein gedrucktes MOVE-Etikett stellt den Vorgang ohne Ziel scharf — dann
    // ist das Feld wirklich das, was als Nächstes dran ist.
    const l = leiste({ ...leer, action: 'MOVE' });
    assert.ok(l.sichtbar('cam-chip-to'));
    assert.ok(l.pulst('cam-chip-to'), 'es ist das Feld, das als Nächstes dran ist');
    const a = leiste({ ...leer, action: 'ADD' });
    assert.ok(a.sichtbar('cam-chip-to'));
    assert.ok(a.pulst('cam-chip-to'));
  });

  it('zeigt das Ziel beim Namen, nicht beim Kürzel', () => {
    assert.equal(leiste({ ...leer, action: 'ADD', to: 'TENT1' }).text('ch-to'), 'Zelt 1');
  });

  it('hört auf zu pulsen, sobald das Ziel steht', () => {
    const l = leiste({ ...leer, action: 'ADD', to: 'TENT1' });
    assert.ok(!l.pulst('cam-chip-to'), 'gesetzt ist gesetzt');
    assert.match(l.klasse('cam-chip-to'), /ch-set/);
  });

  it('blendet die Reihe aus, wo ein leuchtender Knopf schon alles sagt', () => {
    // Umzug mit Ziel, Ernten, Entsorgen, Kontamination: der Knopf zeigt, was
    // läuft, und seine Zahl, wieviel.
    for (const z of [
      { ...leer, action: 'MOVE', to: 'TENT1' },
      { ...leer, action: 'HARVEST' },
      { ...leer, action: 'REMOVE' },
      { ...leer, action: 'CONTAM' }
    ]) {
      assert.ok(!leiste(z).reihe(), z.action + (z.to ? ' → ' + z.to : '') + ' braucht die Reihe nicht');
    }
  });

  it('sagt in der Meldung, dass man tippen kann, nicht nur scannen', () => {
    // Wer einen Beutel ohne Vorgang scannt, bekam "scanne ADD, MOVE, REMOVE
    // oder HARVEST" — der einzige genannte Weg war der, den ein Telefon nicht
    // hat.
    for (const lang of ['de', 'en', 'pt']) {
      const txt = quelle('lang/' + lang + '.js').match(/'scanFb\.setAction':\s*'([^']*)'/);
      assert.ok(txt, lang + ': scanFb.setAction fehlt');
      assert.match(
        txt[1],
        /antippen|Tap|Toque/,
        lang + ': die Meldung nennt nur das Scannen, nicht den Weg, den das Telefon hat'
      );
    }
  });
});
