'use strict';
// Was die Vorhaben-Seite tut, wenn der Server einen Schreibvorgang ablehnt.
//
// apiPost, apiPatch und apiDelete werfen nicht, sie melden {error}. Vorher sah
// ein gescheiterter Vorgang aus wie ein gelungener: ein Ergebnis, ein Ausgang,
// "Abschliessen" und eine geaenderte Notiz standen lokal da und sprangen spaeter
// still zurueck, eine neue Notiz war nach dem Neuzeichnen weg, und ein Code,
// den ein archivierter Versuch schon hatte, leerte das Formular ohne Grund.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hebeFunktion } = require('./helpers/quelle');

const FEHLER = { error: 'lab: something went wrong' };
const warten = () => new Promise((r) => setTimeout(r, 0));

function seite(antwort) {
  return new Function(
    'antwort',
    `
    const felder = {
      'pj-new-vcode': { value: 'V9' },
      'pj-new-vtitle': { value: 'Neuer Lauf' },
      'pj-note-new': { value: 'Eine Notiz' }
    };
    const notizZeile = { classList: { add(k) { this.k = k; }, remove() {} }, querySelector: () => notizFeld };
    const notizFeld = { value: '' };
    const document = {
      getElementById: (id) => felder[id] || null,
      querySelector: () => ({ closest: () => notizZeile })
    };
    const t = (k, o) => k + (o ? '(' + Object.values(o).join(',') + ')' : '');
    const toasts = [];
    const toast = (m, k) => toasts.push([m, k]);
    const gesendet = [];
    const antworte = (methode) => (pfad, body) => {
      gesendet.push([methode, pfad, body]);
      return Promise.resolve(antwort);
    };
    const apiPatch = antworte('PATCH');
    const apiPost = antworte('POST');
    const apiDelete = antworte('DELETE');
    let experiments = [
      { id: 5, code: 'V1', status: 'running', ended: null, outcome: 'alt', runs: [{ id: 1, code: 'A-1', result: 'alt', outcome: 'open' }] },
      { id: 6, code: 'ARCH-1', status: 'done', archived: true, runs: [] }
    ];
    let projectNotes = [
      { id: 40, tab: 'research', body: 'erste', created: '2026-09-01', updated: '' },
      { id: 41, tab: 'research', body: 'zweite', created: '2026-09-02', updated: '' }
    ];
    let pjOffen = 5;
    const pjExp = (id) => experiments.find((v) => v.id === id) || null;
    const localDateStr = () => '2026-09-29';
    let gezeichnet = 0;
    const renderVersuch = () => { gezeichnet++; };
    const renderProjekte = () => { gezeichnet++; };
    let verlaufNeu = 0;
    const pjVerlaufNeu = () => { verlaufNeu++; };
    const loadData = async () => {};
    const confirm2 = (a, b, c, ja) => ja();
    let pjGefaessUnterwegs = false;
    let pjVersuchUnterwegs = false;
    ${['pjFehlgeschlagen', 'pjFokus', 'pjChange', 'pjVersuchClick', 'pjNotizClick'].map((n) => hebeFunktion(n)).join('\n')}
    const klick = (fn, sel, el) => fn({ target: { closest: (s) => (s === sel ? el : null) } });
    return {
      pjChange,
      versuch: (sel, el) => klick(pjVersuchClick, sel, el),
      notiz: (sel, el) => klick(pjNotizClick, sel, el),
      toasts,
      gesendet,
      felder,
      notizFeld,
      notizZeile,
      experiments: () => experiments,
      notizen: () => projectNotes,
      stand: () => ({ gezeichnet, verlaufNeu })
    };`
  )(antwort);
}
const fehler = (s) => s.toasts.filter(([, k]) => k === 'err').map(([m]) => m);

describe('Laborbuch bei einer Ablehnung durch den Server', () => {
  it('nimmt ein Ergebnis zurueck, das nicht gespeichert wurde, und sagt es', async () => {
    const s = seite(FEHLER);
    const feld = { value: 'neu', dataset: { pjFeld: 'result', pjRun: '1' } };
    s.pjChange({ target: { id: '', dataset: {}, closest: () => feld } });
    await warten();
    assert.equal(s.experiments()[0].runs[0].result, 'alt');
    assert.ok(fehler(s)[0].startsWith('proj.saveErr'));
    assert.equal(s.stand().verlaufNeu, 0);
  });

  it('zeigt nach einem abgelehnten Ausgang wieder den gespeicherten', async () => {
    const s = seite(FEHLER);
    const feld = { value: 'contam', dataset: { pjFeld: 'outcome', pjRun: '1' } };
    s.pjChange({ target: { id: '', dataset: {}, closest: () => feld } });
    await warten();
    assert.equal(s.experiments()[0].runs[0].outcome, 'open');
    assert.equal(s.stand().gezeichnet, 2, 'drawn once with the new value, once back');
  });

  it('nimmt ein Fazit zurueck, das nicht gespeichert wurde', async () => {
    const s = seite(FEHLER);
    const feld = { value: 'neu', dataset: { pjFeld: 'outcome', pjExp: '5' } };
    s.pjChange({ target: { id: '', dataset: {}, closest: () => feld } });
    await warten();
    assert.equal(s.experiments()[0].outcome, 'alt');
    assert.equal(fehler(s).length, 1);
  });

  it('laesst einen Versuch laufen, dessen Abschluss abgelehnt wurde', async () => {
    const s = seite(FEHLER);
    s.versuch('[data-pj-finish]', { dataset: { pjFinish: '5' } });
    await warten();
    assert.equal(s.experiments()[0].status, 'running');
    assert.equal(s.experiments()[0].ended, null);
    assert.equal(fehler(s).length, 1);
  });

  it('sagt vor dem Abschicken, dass ein archivierter Versuch den Code schon hat', () => {
    const s = seite({ id: 9 });
    s.felder['pj-new-vcode'].value = 'arch-1';
    s.versuch('[data-pj-newexp]', { dataset: {}, disabled: false });
    assert.deepEqual(s.gesendet, []);
    assert.ok(fehler(s)[0].startsWith('exp.codeTaken'));
  });

  it('laesst Code und Titel stehen, wenn der neue Versuch abgelehnt wird', async () => {
    const s = seite(FEHLER);
    const knopf = { dataset: {}, disabled: false };
    s.versuch('[data-pj-newexp]', knopf);
    await warten();
    assert.equal(s.stand().gezeichnet, 0, 'nothing redrawn, so the inputs keep their text');
    assert.equal(knopf.disabled, false);
    assert.equal(fehler(s).length, 1);
  });

  it('laesst den Text einer neuen Notiz im Feld, wenn sie abgelehnt wird', async () => {
    const s = seite(FEHLER);
    const knopf = { dataset: { pjNoteAdd: 'research' }, disabled: false };
    s.notiz('[data-pj-note-add]', knopf);
    await warten();
    assert.equal(s.notizen().length, 2);
    assert.equal(s.stand().gezeichnet, 0);
    assert.equal(knopf.disabled, false);
  });

  it('oeffnet eine abgelehnte Aenderung wieder zum Bearbeiten, und ein zweites Speichern geht raus', async () => {
    const s = seite(FEHLER);
    s.notizFeld.value = 'geaendert';
    const knopf = { dataset: { pjNoteSave: '40' }, closest: () => s.notizZeile };
    s.notiz('[data-pj-note-save]', knopf);
    await warten();
    assert.equal(s.notizen()[0].body, 'erste', 'the stored text is the old one again');
    assert.equal(s.notizZeile.classList.k, 'is-edit');
    assert.equal(s.notizFeld.value, 'geaendert', 'with what was typed');
    s.notiz('[data-pj-note-save]', knopf);
    assert.equal(s.gesendet.filter(([m]) => m === 'PATCH').length, 2, 'the retry is sent');
  });

  it('stellt eine Notiz zurueck an ihren Platz, wenn das Loeschen abgelehnt wird', async () => {
    const s = seite(FEHLER);
    s.notiz('[data-pj-note-del]', { dataset: { pjNoteDel: '41' } });
    await warten();
    assert.deepEqual(
      s.notizen().map((n) => n.id),
      [40, 41]
    );
    assert.equal(fehler(s).length, 1);
  });

  it('sagt, wenn Entfernen oder Zurueckholen abgelehnt wird', async () => {
    const s = seite(FEHLER);
    s.versuch('[data-pj-runback]', { dataset: { pjRunback: '1' } });
    await warten();
    assert.equal(fehler(s).length, 1);
  });

  it('legt einen neuen Versuch in derselben Form an, die /api/data liefert', async () => {
    const s = seite({ id: 9 });
    s.versuch('[data-pj-newexp]', { dataset: {}, disabled: false });
    await warten();
    const neu = s.experiments().find((v) => v.id === 9);
    assert.deepEqual([neu.runs, neu.removedRuns, neu.photos, neu.removedPhotos], [[], [], [], []]);
  });

  it('sagt nach dem endgueltigen Loeschen, wenn eine Datei liegen blieb', async () => {
    const s = seite({ ok: true, leftoverFiles: 1 });
    s.versuch('[data-pj-photopurge]', { dataset: { pjPhotopurge: '3' } });
    await warten();
    assert.deepEqual(fehler(s), ['exp.purgeLeftover']);
    assert.equal(s.stand().gezeichnet, 1, 'and still redraws');
  });

  it('bleibt still, wenn alles gespeichert ist', async () => {
    const s = seite({ ok: true });
    const feld = { value: 'neu', dataset: { pjFeld: 'result', pjRun: '1' } };
    s.pjChange({ target: { id: '', dataset: {}, closest: () => feld } });
    await warten();
    assert.equal(s.experiments()[0].runs[0].result, 'neu');
    assert.deepEqual(fehler(s), []);
    assert.equal(s.stand().verlaufNeu, 1);
  });
});
