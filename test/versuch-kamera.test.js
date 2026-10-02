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

// Die Grenzen so, wie app.js sie setzt.
const konstante = (name) => quelle().match(new RegExp('^const ' + name + ' = [^\\n]*;$', 'm'))[0];
const GRENZEN = ['PJ_MAX_FOTOS', 'PJ_ORIGINAL_MAX', 'PJ_ORIGINAL_PAUSEN'].map(konstante).join('\n');

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
// mitgeschrieben, und die Antwort des Servers stellt der Test ein. Gewartet
// wird nicht, nur notiert, wie lange.
function kamera(antwort) {
  return new Function(
    'antwort',
    `
    // Die Statuszeile; neuZeichnen() ersetzt sie wie ein Neuzeichnen der Seite.
    let status = { textContent: '' };
    const neuZeichnen = () => {
      status = { textContent: '' };
      return status;
    };
    const document = { getElementById: (id) => (id === 'pj-cam-status' ? status : null) };
    let pjOffen = 7;
    let pjKameraZeile = { id: null, text: '' };
    const pjOriginaleUnterwegs = new Set();
    const gewartet = [];
    const pjWarten = async (ms) => {
      gewartet.push(ms);
    };
    const t = (k, o) => k + (o ? JSON.stringify(o) : '');
    const toasts = [];
    const toast = (msg, kind) => toasts.push({ msg, kind });
    const gesendet = [];
    const apiPost = async (pfad, body) => {
      gesendet.push({ pfad, n: body.photos.length });
      return antwort;
    };
    const _crCompressFile = async (f) => ({ data_url: 'data:image/jpeg;base64,/9j/', name: f.name });
    const tp = (k, n) => k + '.' + (n === 1 ? 'one' : 'other') + ':' + n;
    // Die Originale gehen roh per PUT; die Antworten stellt der Test ein,
    // sonst ist jede ein 200.
    const originale = [];
    const putAntworten = [];
    let beimSenden = null;
    const authFetch = async (pfad, opts) => {
      originale.push({ pfad, method: opts.method, typ: opts.headers['Content-Type'], body: opts.body });
      if (beimSenden) beimSenden();
      const a = putAntworten.length ? putAntworten.shift() : { ok: true, status: 200 };
      if (a === 'weg') throw new Error('network down');
      if (typeof a === 'number') return { ok: a >= 200 && a < 300, status: a };
      return a;
    };
    let geladen = 0;
    let gezeichnet = 0;
    const loadData = async () => {
      geladen++;
    };
    const renderVersuch = () => {
      gezeichnet++;
    };
    ${GRENZEN}
    ${hebeFunktion('pjKameraStatus')}
    ${hebeFunktion('pjIstJpeg')}
    ${hebeFunktion('pjOriginalSenden')}
    ${hebeFunktion('pjOriginaleHochladen')}
    ${hebeFunktion('pjOriginalNachreichen')}
    ${hebeFunktion('pjKamera')}
    return {
      pjKamera,
      pjOriginalNachreichen,
      get status() {
        return status;
      },
      neuZeichnen,
      toasts,
      gesendet,
      originale,
      putAntworten,
      gewartet,
      unterwegs: pjOriginaleUnterwegs,
      set beimSenden(f) {
        beimSenden = f;
      },
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
    // Einmal gleich nach dem Speichern, damit die Fotos sofort zu sehen sind,
    // und einmal nach den Originalen.
    assert.deepEqual(k.stand(), { geladen: 2, gezeichnet: 2 });
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

describe('Originale der Versuchsfotos', () => {
  it('schickt zu jedem gespeicherten JPEG sein Original, roh und in der Reihenfolge der Kennungen', async () => {
    const k = kamera({ ids: [41, 42] });
    const dateien = bilder(2);
    await k.pjKamera(7, dateien);
    assert.deepEqual(
      k.originale.map((o) => [o.pfad, o.method, o.typ]),
      [
        ['/api/experiment-photos/41/original', 'PUT', 'image/jpeg'],
        ['/api/experiment-photos/42/original', 'PUT', 'image/jpeg']
      ]
    );
    assert.equal(k.originale[0].body, dateien[0], 'the file itself, not a re-encoded copy');
    assert.deepEqual(k.toasts, []);
    assert.equal(k.status.textContent, '', 'and the status line is cleared afterwards');
  });

  it('sagt, wenn ein Bild kein JPEG ist und deshalb ohne Original bleibt', async () => {
    const k = kamera({ ids: [1, 2] });
    await k.pjKamera(7, [
      { name: 'a.jpg', type: 'image/jpeg' },
      { name: 'b.png', type: 'image/png' }
    ]);
    assert.deepEqual(
      k.originale.map((o) => o.pfad),
      ['/api/experiment-photos/1/original']
    );
    assert.deepEqual(k.toasts, [{ msg: 'exp.originalsNotJpeg.one:1', kind: undefined }]);
  });

  it('versucht es nach einem Netzfehler nach einer Pause noch einmal, nach einer Absage nicht', async () => {
    const k = kamera({ ids: [1, 2] });
    k.putAntworten.push('weg', 200, 409);
    await k.pjKamera(7, bilder(2));
    assert.deepEqual(
      k.originale.map((o) => o.pfad),
      ['/api/experiment-photos/1/original', '/api/experiment-photos/1/original', '/api/experiment-photos/2/original']
    );
    assert.deepEqual(k.gewartet, [2000], 'one pause before the second try, none after the 409');
    assert.equal(k.toasts.length, 1);
    assert.ok(k.toasts[0].msg.startsWith('exp.originalsFailed'));
    assert.ok(k.toasts[0].msg.includes('"n":1'));
    assert.equal(k.toasts[0].kind, 'err');
  });

  it('wartet ein Netz ab, das laenger weg ist, statt die Versuche in Millisekunden zu verbrauchen', async () => {
    // Ohne Netz antwortet der Service Worker sofort mit 503.
    const k = kamera({ ids: [1] });
    k.putAntworten.push(503, 503, 503, 200);
    await k.pjKamera(7, bilder(1));
    assert.equal(k.originale.length, 4);
    assert.deepEqual(k.gewartet, [2000, 5000, 15000]);
    assert.deepEqual(k.toasts, []);
  });

  it('gibt nach knapp einer Minute auf und sagt es', async () => {
    const k = kamera({ ids: [1] });
    k.putAntworten.push(503, 503, 503, 503, 503);
    await k.pjKamera(7, bilder(1));
    assert.equal(k.originale.length, 5);
    assert.equal(
      k.gewartet.reduce((a, b) => a + b, 0),
      52000
    );
    assert.equal(k.toasts.length, 1);
    assert.ok(k.toasts[0].msg.startsWith('exp.originalsFailed'));
  });

  it('hoert bei vollem Speicher auf, statt jedes Original noch einmal zu schicken, und sagt es so', async () => {
    const k = kamera({ ids: [1, 2, 3] });
    k.putAntworten.push(507);
    await k.pjKamera(7, bilder(3));
    assert.equal(k.originale.length, 1, 'one 507 is enough to know');
    assert.deepEqual(k.gewartet, []);
    assert.equal(k.toasts.length, 1);
    assert.ok(k.toasts[0].msg.startsWith('exp.originalsFull'));
    assert.ok(k.toasts[0].msg.includes('"n":3'));
    assert.equal(k.toasts[0].kind, 'err');
  });

  it('nimmt eine Antwort auf ein schon gespeichertes Original als gespeichert', async () => {
    // Ging die Antwort auf das erste Senden verloren, sagt der Server beim
    // zweiten 200 mit already: true, nicht 409.
    const k = kamera({ ids: [1] });
    k.putAntworten.push('weg', { ok: true, status: 200, already: true });
    await k.pjKamera(7, bilder(1));
    assert.deepEqual(k.toasts, []);
  });

  it('schickt kein Original ueber 40 MB, und sagt es', async () => {
    const k = kamera({ ids: [1, 2] });
    const dateien = bilder(2);
    dateien[1].size = 41 * 1024 * 1024;
    await k.pjKamera(7, dateien);
    assert.deepEqual(
      k.originale.map((o) => o.pfad),
      ['/api/experiment-photos/1/original']
    );
    assert.deepEqual(k.toasts, [{ msg: 'exp.originalsTooBig.one:1', kind: 'err' }]);
  });

  it('sagt alles in einer Meldung, damit die zweite nicht den Fehler der ersten ueberschreibt', async () => {
    const k = kamera({ ids: [1, 2] });
    k.putAntworten.push(409);
    await k.pjKamera(7, [
      { name: 'a.jpg', type: 'image/jpeg' },
      { name: 'b.png', type: 'image/png' }
    ]);
    assert.equal(k.toasts.length, 1);
    assert.ok(k.toasts[0].msg.startsWith('exp.originalsFailed'));
    assert.ok(k.toasts[0].msg.includes('exp.originalsNotJpeg.one:1'));
    assert.equal(k.toasts[0].kind, 'err', 'a failure among them keeps the error styling');
  });

  it('zaehlt die Originale als unterwegs, bis das letzte angekommen ist', async () => {
    const k = kamera({ ids: [1, 2] });
    const gesehen = [];
    k.beimSenden = () => gesehen.push([...k.unterwegs]);
    await k.pjKamera(7, bilder(2));
    assert.deepEqual(gesehen, [
      [1, 2],
      [1, 2]
    ]);
    assert.equal(k.unterwegs.size, 0);
  });

  it('schreibt in die Statuszeile, die gerade auf der Seite steht, auch nach einem Neuzeichnen', async () => {
    const k = kamera({ ids: [1, 2] });
    const gelesen = [];
    k.beimSenden = () => {
      gelesen.push(k.status.textContent);
      // Das eigene Speichern loest ueber den Sync ein Neuzeichnen aus; die
      // Zeile von vorher haengt danach nicht mehr in der Seite.
      k.neuZeichnen();
    };
    await k.pjKamera(7, bilder(2));
    assert.deepEqual(gelesen, [
      'exp.originalsUploading{"done":1,"total":2}',
      'exp.originalsUploading{"done":2,"total":2}'
    ]);
  });
});

describe('Ein Original nachreichen', () => {
  const datei = (art = 'image/jpeg', groesse = 1000) => ({ name: 'x.jpg', type: art, size: groesse });

  it('schickt die gewaehlte Datei an das Foto und zeichnet danach neu', async () => {
    const k = kamera({});
    await k.pjOriginalNachreichen(7, 41, datei());
    assert.deepEqual(
      k.originale.map((o) => o.pfad),
      ['/api/experiment-photos/41/original']
    );
    assert.deepEqual(k.toasts, [{ msg: 'exp.originalAdded', kind: undefined }]);
    assert.deepEqual(k.stand(), { geladen: 1, gezeichnet: 1 });
    assert.equal(k.unterwegs.size, 0);
  });

  it('sagt, wenn das Bild nicht zu diesem Foto passt', async () => {
    const k = kamera({});
    k.putAntworten.push(422);
    await k.pjOriginalNachreichen(7, 41, datei());
    assert.deepEqual(k.toasts, [{ msg: 'exp.originalMismatch', kind: 'err' }]);
  });

  it('schickt kein anderes Format und nichts ueber 40 MB', async () => {
    const k = kamera({});
    await k.pjOriginalNachreichen(7, 41, datei('image/png'));
    await k.pjOriginalNachreichen(7, 41, datei('image/jpeg', 41 * 1024 * 1024));
    assert.equal(k.originale.length, 0);
    assert.deepEqual(
      k.toasts.map((x) => x.msg),
      ['exp.originalsNotJpeg.one:1', 'exp.originalsTooBig.one:1']
    );
  });
});

describe('Ein Neuladen fuer ein Update', () => {
  // reloadIsSafe gegen eine Seite, auf der sonst nichts offen ist.
  function neuladen() {
    return new Function(`
      let _mutating = 0;
      const pjOriginaleUnterwegs = new Set();
      const leaveGuards = [];
      const askGuard = () => null;
      const pageHasTypedText = () => false;
      const document = { querySelector: () => null, getElementById: () => null, activeElement: null };
      ${hebeFunktion('reloadIsSafe')}
      return { reloadIsSafe, unterwegs: pjOriginaleUnterwegs };`)();
  }

  it('wartet, solange ein Original unterwegs ist', () => {
    const n = neuladen();
    assert.equal(n.reloadIsSafe(), true);
    n.unterwegs.add(41);
    assert.equal(n.reloadIsSafe(), false);
    n.unterwegs.delete(41);
    assert.equal(n.reloadIsSafe(), true);
  });
});

describe('Die Kachel eines Fotos ohne Original', () => {
  function kachel(benutzer, unterwegs = []) {
    return new Function(
      'benutzer',
      'unterwegs',
      `
      const currentUser = benutzer;
      const pjOriginaleUnterwegs = new Set(unterwegs);
      const esc = (x) => String(x);
      const t = (k) => k;
      const fmtDt = (x) => x;
      const fmtDtTime = (x) => x;
      ${hebeFunktion('pjFotoKachel')}
      return pjFotoKachel;`
    )(benutzer, unterwegs);
  }
  const foto = (mehr) => ({ id: 41, uuid: 'u-1', uploadedAt: '2026-10-01T10:00:00Z', uploadedBy: 7, ...mehr });
  const bietet = (html) => html.includes('data-pj-original="41"');

  it('bietet das Nachreichen dem an, der das Foto hochgeladen hat, und einem Admin', () => {
    assert.ok(bietet(kachel({ userId: 7, role: 'user' })({ id: 3 }, foto())));
    assert.ok(bietet(kachel({ userId: 9, role: 'admin' })({ id: 3 }, foto())));
  });

  it('bietet es niemand anderem an, und nicht, wenn es ein Original gibt oder eins unterwegs ist', () => {
    assert.ok(!bietet(kachel({ userId: 9, role: 'user' })({ id: 3 }, foto())));
    assert.ok(!bietet(kachel({ userId: 7, role: 'user' })({ id: 3 }, foto({ original: { sha256: 'x' } }))));
    assert.ok(!bietet(kachel({ userId: 7, role: 'user' }, [41])({ id: 3 }, foto())));
    assert.ok(!bietet(kachel({ userId: 7, role: 'user' })({ id: 3 }, foto({ removedAt: '2026-10-02' }))));
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
