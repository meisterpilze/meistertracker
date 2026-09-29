'use strict';
// Die Kamera am Versuch gibt die gewaehlten Bilder weiter.
//
// Das Dateifeld wird nach der Auswahl geleert, damit dasselbe Bild ein zweites
// Mal gewaehlt werden kann. Browser leeren dabei die Liste des Feldes selbst:
// wer sich nur die Liste gemerkt hatte statt einer Abschrift, hielt danach eine
// leere in der Hand, und pjKamera bekam nie ein Bild. Das Feld hier verhaelt
// sich wie das im Browser.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

// Die Grenze so, wie app.js sie setzt.
const GRENZE = quelle().match(/^const PJ_MAX_FOTOS = \d+;$/m)[0];

// Ein Dateifeld, dessen files bei jedem Zugriff dieselbe Liste ist und das
// beim Leeren genau diese Liste leert.
function dateifeld(dateien) {
  const liste = dateien.slice();
  return {
    id: 'pj-cam',
    dataset: { pjFor: '7' },
    get files() {
      return liste;
    },
    get value() {
      return liste.length ? 'C:\\fakepath\\' + liste[0].name : '';
    },
    set value(v) {
      if (v === '') liste.length = 0;
    }
  };
}

// pjKameraAuswahl und der Knopf "Foto aufnehmen" gegen Attrappen.
function kameraKnopf() {
  return new Function(`
    const gesehen = [];
    function pjKamera(id, dateien) {
      gesehen.push({ id, n: Array.from(dateien || []).length });
    }
    const liste = [];
    const feld = {
      liste,
      geklickt: 0,
      onchange: null,
      get files() {
        return liste;
      },
      set value(v) {
        if (v === '') liste.length = 0;
      },
      click() {
        this.geklickt++;
      }
    };
    const document = { getElementById: (id) => (id === 'pj-cam' ? feld : null) };
    ${hebeFunktion('pjKameraAuswahl')}
    ${hebeFunktion('pjVersuchClick')}
    let pjGefaessUnterwegs = false;
    let pjVersuchUnterwegs = false;
    const tippen = (id) =>
      pjVersuchClick({ target: { closest: (sel) => (sel === '[data-pj-cam]' ? { dataset: { pjCam: String(id) } } : null) } });
    return { auswahl: pjKameraAuswahl, tippen, feld, gesehen };`)();
}

// pjKamera gegen Attrappen: komprimiert wird nichts, geschickt wird nur
// mitgeschrieben, und die Antwort des Servers stellt der Test ein.
function kamera(antwort) {
  return new Function(
    'antwort',
    `
    const status = { textContent: '' };
    const document = { getElementById: (id) => (id === 'pj-cam-status' ? status : null) };
    const t = (k, o) => k + (o ? JSON.stringify(o) : '');
    const toasts = [];
    const toast = (msg, kind) => toasts.push({ msg, kind });
    const gesendet = [];
    const apiPost = async (pfad, body) => {
      gesendet.push({ pfad, n: body.photos.length });
      return antwort;
    };
    const _crCompressFile = async (f) => ({ data_url: 'data:image/jpeg;base64,/9j/', name: f.name });
    let geladen = 0;
    let gezeichnet = 0;
    const loadData = async () => {
      geladen++;
    };
    const renderVersuch = () => {
      gezeichnet++;
    };
    ${GRENZE}
    ${hebeFunktion('pjKamera')}
    return {
      pjKamera,
      status,
      toasts,
      gesendet,
      stand: () => ({ geladen, gezeichnet })
    };`
  )(antwort);
}
const bilder = (n) => Array.from({ length: n }, (_, i) => ({ name: 'b' + i + '.jpg', type: 'image/jpeg' }));

describe('Upload der Versuchsfotos', () => {
  it('laedt nach einem gelungenen Upload nach und leert die Statuszeile', async () => {
    const k = kamera({ ids: [1, 2] });
    await k.pjKamera(7, bilder(2));
    assert.deepEqual(k.gesendet, [{ pfad: '/api/experiment-photos', n: 2 }]);
    assert.equal(k.status.textContent, '');
    assert.deepEqual(k.stand(), { geladen: 1, gezeichnet: 1 });
    assert.deepEqual(k.toasts, []);
  });

  it('sagt, wenn der Server die Bilder nicht genommen hat, statt so zu tun als ob', async () => {
    const k = kamera({ error: 'photos: directory full' });
    await k.pjKamera(7, bilder(2));
    assert.ok(k.status.textContent.startsWith('exp.uploadErr'), 'the status line keeps the failure');
    assert.ok(k.status.textContent.includes('directory full'), 'and says why');
    assert.equal(k.toasts.length, 1);
    assert.equal(k.toasts[0].kind, 'err');
    assert.deepEqual(k.stand(), { geladen: 0, gezeichnet: 0 }, 'no reload that would paint the sync status green');
  });

  it('meldet, welche Bilder ueber die Grenze gehen, und schickt nur die erlaubten', async () => {
    const k = kamera({ ids: [] });
    await k.pjKamera(7, bilder(11));
    assert.deepEqual(k.gesendet, [{ pfad: '/api/experiment-photos', n: 8 }]);
    assert.equal(k.toasts.length, 1);
    assert.ok(k.toasts[0].msg.startsWith('exp.photoLimit'));
    assert.ok(k.toasts[0].msg.includes('"rest":3'));
  });
});

describe('Kamera am Versuch', () => {
  it('gibt die gewaehlten Bilder weiter, obwohl das Feld danach geleert wird', () => {
    const k = kameraKnopf();
    const feld = dateifeld([
      { name: 'a.jpg', type: 'image/jpeg' },
      { name: 'b.jpg', type: 'image/jpeg' }
    ]);
    k.auswahl(feld, 7);
    assert.deepEqual(k.gesehen, [{ id: 7, n: 2 }]);
    assert.equal(feld.files.length, 0, 'the field is still cleared, so the same photo can be picked again');
  });

  it('hoert die Auswahl am Feld selbst, auch wenn die Ansicht inzwischen neu gezeichnet wurde', () => {
    // Die Seite leitet change nur an Felder weiter, die noch in ihr haengen.
    // Der Zuhoerer sitzt deshalb am Feld; ob es noch in der Seite haengt, ist
    // ihm gleich.
    const k = kameraKnopf();
    k.tippen(7);
    assert.equal(k.feld.geklickt, 1);
    assert.equal(typeof k.feld.onchange, 'function');
    k.feld.liste.push({ name: 'c.jpg', type: 'image/jpeg' });
    k.feld.onchange();
    assert.deepEqual(k.gesehen, [{ id: 7, n: 1 }]);
  });
});
