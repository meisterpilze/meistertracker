'use strict';
// Entfernen und Zurueckholen in der Ansicht eines Experiments.
//
// Ein Gefaess und ein Foto werden nicht mehr geloescht, sondern entfernt. Die
// Ansicht muss dafuer drei Dinge koennen: ein Gefaess entfernen (das ging
// vorher gar nicht), zeigen, was entfernt ist, und es zurueckholen. Wie die
// anderen UI-Tests holt dieser die Funktionen aus app.js und laesst sie gegen
// Attrappen laufen.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');

const APP = quelle();
const TEILE = [
  'esc',
  'fmtDt',
  'fmtDtTime',
  'pjExp',
  'pjAusgangSelect',
  'pjGefaessZeile',
  'pjEntferntesGefaess',
  'pjEntfernte',
  'pjFotoKachel',
  'pjApAuswahl',
  'pjDetail',
  'pjVerlauf',
  'pjVerlaufCodes',
  'pjVerlaufWert',
  'pjVerlaufZeile',
  'pjVerlaufListe',
  'pjFehlgeschlagen',
  'pjFokus',
  'pjVersuchClick',
  'pjToggle'
];

function werkbank(v) {
  return new Function(
    'v',
    `
    const aufrufe = [];
    const nachfragen = [];
    let pjOffen = v.id;
    let pjVerlaufOffen = null;
    let pjVerlaufStand = null;
    let currentUser = v.admin ? { role: 'admin' } : { role: 'user' };
    const experiments = [v];
    const workPackages = [];
    const t = (k, o) => k + (o ? '(' + Object.values(o).join(',') + ')' : '');
    const confirm2 = (titel, text, knopf, ja) => {
      nachfragen.push({ titel, text, knopf });
      ja();
    };
    const apiPost = (p, b) => {
      aufrufe.push(['POST', p, b]);
      return Promise.resolve({});
    };
    const apiDelete = (p) => {
      aufrufe.push(['DELETE', p]);
      return Promise.resolve({});
    };
    const loadData = () => {
      aufrufe.push(['loadData']);
      return Promise.resolve();
    };
    const renderVersuch = () => aufrufe.push(['render']);
    let pjGefaessUnterwegs = false;
    let pjVersuchUnterwegs = false;
    let pjKameraZeile = { id: null, text: '' };
    const pjOriginaleUnterwegs = new Set();
    const fokussiert = [];
    const document = { querySelector: (sel) => ({ focus: () => fokussiert.push(sel) }) };
    const toasts = [];
    const toast = (m, k) => toasts.push([m, k]);
    ${hebeKonstante('PJ_AUSGANG', APP)}
    ${hebeKonstante('pjWegOffen', APP)}
    ${TEILE.map((n) => hebeFunktion(n, APP)).join('\n')}
    // Ein Klick auf ein Element, das genau einen dieser Schluessel traegt.
    const klick = (sel, dataset) =>
      pjVersuchClick({ target: { closest: (s) => (s === sel ? { dataset } : null) } });
    return { aufrufe, nachfragen, fokussiert, pjDetail, pjGefaessZeile, pjFotoKachel, pjToggle, klick };`
  )(v);
}

const warten = () => new Promise((r) => setTimeout(r, 5));

function versuch(extra) {
  return {
    id: 3,
    code: 'T1',
    title: 'Probelauf',
    started: '2026-01-05',
    ended: null,
    status: 'running',
    archived: false,
    recipe: '',
    outcome: '',
    runs: [{ id: 5, code: 'A-1', what: 'Probe', result: '', outcome: 'open' }],
    photos: [{ id: 8, uuid: 'aaaa-1', uploadedAt: '2026-01-06T09:00:00.000Z', removedAt: null }],
    removedRuns: [],
    removedPhotos: [],
    ...extra
  };
}

describe('Entfernen: Ansicht', () => {
  it('gibt jedem Gefaess ein Kreuz zum Entfernen', () => {
    const ui = werkbank(versuch());
    const html = ui.pjGefaessZeile(versuch().runs[0]);
    assert.ok(html.includes('data-pj-rundel="5"'));
    assert.ok(
      html.includes('aria-label="exp.removeRunNamed(A-1)"'),
      'the cross says what it does, and to which vessel'
    );
  });

  it('zeigt nichts Entferntes, solange nichts entfernt ist', () => {
    const html = werkbank(versuch()).pjDetail(versuch());
    assert.equal(html.includes('pj-weg'), false);
    assert.equal(html.includes('exp.removedRuns'), false);
    assert.equal(html.includes('exp.removedPhotos'), false);
  });

  it('legt entfernte Gefaesse zugeklappt und nur zum Lesen unter die Liste', () => {
    const v = versuch({
      removedRuns: [
        {
          id: 6,
          code: 'A-2',
          what: 'Kontrolle',
          result: '2 Punkte',
          outcome: 'contam',
          removedAt: '2026-01-07T10:00:00.000Z'
        }
      ]
    });
    const html = werkbank(v).pjDetail(v);
    assert.ok(
      html.includes(
        '<details class="pj-fold pj-weg" data-pj-weg="3:runs"><summary class="sec">exp.removedRuns(1)</summary>'
      )
    );
    const weg = html.slice(html.indexOf('exp.removedRuns(1)'));
    assert.ok(weg.includes('data-pj-runback="6"'), 'it can be brought back');
    assert.ok(weg.includes('2 Punkte') && weg.includes('exp.out.contam'), 'what it held is readable');
    assert.equal(weg.includes('data-pj-run="6"'), false, 'but not editable');
    assert.equal(weg.includes('data-pj-rundel="6"'), false);
    assert.ok(weg.includes('exp.removedAt('), 'when it was removed');
  });

  it('gibt einem entfernten Foto Zurueckholen statt des Kreuzes', () => {
    const v = versuch({
      removedPhotos: [
        { id: 9, uuid: 'bbbb-2', uploadedAt: '2026-01-06T10:00:00.000Z', removedAt: '2026-01-07T10:00:00.000Z' }
      ]
    });
    const html = werkbank(v).pjDetail(v);
    const weg = html.slice(html.indexOf('exp.removedPhotos(1)'));
    assert.ok(html.indexOf('exp.removedPhotos(1)') > 0);
    assert.ok(weg.includes('data-pj-photoback="9"'));
    assert.ok(weg.includes('pj-foto-entfernt'));
    assert.equal(weg.includes('data-pj-photodel="9"'), false);
    assert.ok(html.includes('data-pj-photodel="8"'), 'the photo in use keeps its cross');
    assert.ok(/aria-label="exp\.removePhotoNamed\([^)]+\)"/.test(html), 'the photo cross names its photo');
    assert.ok(/aria-label="exp\.restorePhotoNamed\([^)]+\)"/.test(html), 'and so does restore');
    assert.ok(/alt="exp\.photoAlt\([^)]+\)"/.test(html), 'the thumbnail link has a name');
    const zwei = versuch({
      photos: [
        { id: 8, uuid: 'aaaa-1', uploadedAt: '2026-01-06T09:00:00.000Z', removedAt: null },
        { id: 10, uuid: 'aaaa-2', uploadedAt: '2026-01-06T09:00:00.000Z', removedAt: null }
      ]
    });
    const namen = [
      ...werkbank(zwei)
        .pjDetail(zwei)
        .matchAll(/aria-label="(exp\.removePhotoNamed\([^"]*\))"/g)
    ].map((m) => m[1]);
    assert.equal(new Set(namen).size, 2, 'two photos from one upload are named apart');
  });

  it('merkt sich, dass die entfernten Gefaesse aufgeklappt sind, ueber das Neuzeichnen hinweg', () => {
    const v = versuch({
      removedRuns: [
        { id: 6, code: 'A-2', what: '', result: '', outcome: 'open', removedAt: '2026-01-07T10:00:00.000Z' }
      ]
    });
    const ui = werkbank(v);
    assert.equal(ui.pjDetail(v).includes('data-pj-weg="3:runs" open'), false);
    ui.pjToggle({ target: { dataset: { pjWeg: '3:runs' }, open: true } });
    assert.ok(ui.pjDetail(v).includes('data-pj-weg="3:runs" open'), 'still open after the redraw');
    ui.pjToggle({ target: { dataset: { pjWeg: '3:runs' }, open: false } });
    assert.equal(ui.pjDetail(v).includes('data-pj-weg="3:runs" open'), false);
  });

  it('bietet nur einem Admin an, ein entferntes Foto endgueltig zu loeschen', () => {
    const foto = {
      id: 9,
      uuid: 'bbbb-2',
      uploadedAt: '2026-01-06T10:00:00.000Z',
      removedAt: '2026-01-07T10:00:00.000Z'
    };
    const nutzer = versuch({ removedPhotos: [foto] });
    assert.equal(werkbank(nutzer).pjDetail(nutzer).includes('data-pj-photopurge'), false);
    const admin = versuch({ admin: true, removedPhotos: [foto] });
    assert.ok(werkbank(admin).pjDetail(admin).includes('data-pj-photopurge="9"'));
  });

  it('zeigt ein endgueltig geloeschtes Foto als leeren Platz, ohne Bild und ohne Zurueckholen', () => {
    const v = versuch({
      admin: true,
      removedPhotos: [
        {
          id: 9,
          uuid: 'bbbb-2',
          uploadedAt: '2026-01-06T10:00:00.000Z',
          removedAt: '2026-01-07T10:00:00.000Z',
          purged: true
        }
      ]
    });
    const weg = werkbank(v).pjDetail(v);
    const kachel = weg.slice(weg.indexOf('exp.removedPhotos(1)'));
    assert.ok(kachel.includes('exp.purged'));
    assert.equal(kachel.includes('bbbb-2'), false, 'no image is requested');
    assert.equal(kachel.includes('data-pj-photoback="9"'), false);
    assert.equal(kachel.includes('data-pj-photopurge="9"'), false);
  });
});

describe('Entfernen: Knoepfe', () => {
  it('entfernt ein Gefaess erst nach der Rueckfrage und laedt dann neu', async () => {
    const ui = werkbank(versuch());
    assert.equal(ui.klick('[data-pj-rundel]', { pjRundel: '5' }), true);
    assert.deepEqual(ui.nachfragen, [
      { titel: 'exp.removeRunTitle', text: 'exp.removeRunMsg(A-1)', knopf: 'exp.remove' }
    ]);
    await warten();
    assert.deepEqual(ui.aufrufe, [['DELETE', '/api/experiment-runs/5'], ['loadData'], ['render']]);
  });

  it('holt ein Gefaess und ein Foto zurueck', async () => {
    const ui = werkbank(versuch());
    ui.klick('[data-pj-runback]', { pjRunback: '6' });
    ui.klick('[data-pj-photoback]', { pjPhotoback: '9' });
    await warten();
    assert.deepEqual(
      ui.aufrufe.filter((a) => a[0] === 'POST'),
      [
        ['POST', '/api/experiment-runs/6/restore', undefined],
        ['POST', '/api/experiment-photos/9/restore', undefined]
      ]
    );
    assert.deepEqual(ui.nachfragen, [], 'bringing something back needs no confirmation');
    assert.deepEqual(
      ui.fokussiert,
      ['[data-pj-rundel="6"]', '[data-pj-photodel="9"]'],
      'focus goes to what came back, not to the page'
    );
  });

  it('fragt beim Foto nach "Entfernen", nicht nach "Loeschen"', async () => {
    const ui = werkbank(versuch());
    ui.klick('[data-pj-photodel]', { pjPhotodel: '8' });
    assert.equal(ui.nachfragen[0].knopf, 'exp.remove');
    await warten();
    assert.deepEqual(ui.aufrufe[0], ['DELETE', '/api/experiment-photos/8']);
  });
});
