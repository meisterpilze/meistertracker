'use strict';
// Ein Code bezeichnet in einem Versuch ein Gefaess.
//
// Auf dem Etikett, im Verlauf und am Regal ist der Code das, woran man ein
// Gefaess erkennt. Zwei aktive Gefaesse mit demselben Code, etwa nach einem
// Doppeltipp auf "Gefaess", waren im Verlauf nicht mehr auseinanderzuhalten.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { hebeFunktion } = require('./helpers/quelle');

describe('Gefaess-Code in der Datenbank', () => {
  let d, p, versuch;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_gefaess_code_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    versuch = Number(db.insertExperiment(d, { code: 'T-1', title: 'Testversuch' }));
  });
  after(() => {
    d.close();
    for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
  });

  it('nimmt einen Code je Versuch nur einmal, gross oder klein geschrieben', () => {
    db.insertExperimentRun(d, { experimentId: versuch, code: 'A-01' });
    assert.throws(() => db.insertExperimentRun(d, { experimentId: versuch, code: 'a-01' }), /already in use/);
  });

  it('erlaubt denselben Code in einem anderen Versuch', () => {
    const anderer = Number(db.insertExperiment(d, { code: 'T-2', title: 'Anderer' }));
    assert.ok(db.insertExperimentRun(d, { experimentId: anderer, code: 'A-01' }));
  });

  it('gibt den Code eines entfernten Gefaesses frei, holt es aber nicht als zweites zurueck', () => {
    const alt = Number(db.insertExperimentRun(d, { experimentId: versuch, code: 'A-02' }));
    db.removeExperimentRun(d, alt);
    const neu = Number(db.insertExperimentRun(d, { experimentId: versuch, code: 'A-02' }));
    assert.ok(neu);
    assert.throws(() => db.restoreExperimentRun(d, alt), /already in use/);
    db.removeExperimentRun(d, neu);
    assert.equal(db.restoreExperimentRun(d, alt), true);
  });

  it('laesst ein Gefaess nicht auf einen vergebenen Code umbenennen', () => {
    const a = Number(db.insertExperimentRun(d, { experimentId: versuch, code: 'A-03' }));
    assert.throws(() => db.updateExperimentRun(d, a, { code: 'A-01' }), /already in use/);
    assert.equal(db.updateExperimentRun(d, a, { code: 'a-03' }), true, 'its own code in other case is fine');
  });
});

// Der Knopf "Gefaess" gegen Attrappen.
function knopf(antwort, gefaesse) {
  return new Function(
    'antwort',
    'gefaesse',
    `
    const felder = { 'pj-new-code': { value: 'A-09' }, 'pj-new-what': { value: 'Kontrolle' } };
    const document = { getElementById: (id) => felder[id] || null };
    const t = (k, o) => k + (o ? JSON.stringify(o) : '');
    const toasts = [];
    const toast = (m, k) => toasts.push([m, k]);
    const gesendet = [];
    let loesen;
    const apiPost = (pfad, body) => {
      gesendet.push(body);
      return new Promise((r) => {
        loesen = () => r(antwort);
      });
    };
    let gezeichnet = 0;
    const renderVersuch = () => {
      gezeichnet++;
    };
    const experiments = [{ id: 5, runs: gefaesse }];
    const pjExp = (id) => experiments.find((v) => v.id === id) || null;
    let pjOffen = 5;
    const confirm2 = () => {};
    const loadData = async () => {};
    ${hebeFunktion('pjFehlgeschlagen')}
    let pjGefaessUnterwegs = false;
    let pjVersuchUnterwegs = false;
    ${hebeFunktion('pjVersuchClick')}
    const taste = { dataset: { pjAddrun: '5' }, disabled: false };
    const tipp = () => pjVersuchClick({ target: { closest: (sel) => (sel === '[data-pj-addrun]' ? taste : null) } });
    return { tipp, taste, toasts, gesendet, antworten: () => loesen && loesen(), stand: () => ({ gezeichnet, gefaesse: experiments[0].runs.length }) };`
  )(antwort, gefaesse);
}
const warten = () => new Promise((r) => setTimeout(r, 0));

describe('Knopf "Gefaess"', () => {
  it('schickt bei einem Doppeltipp nur einmal', async () => {
    const k = knopf({ id: 11 }, []);
    k.tipp();
    k.tipp();
    assert.equal(k.gesendet.length, 1);
    k.antworten();
    await warten();
    assert.deepEqual(k.stand(), { gezeichnet: 1, gefaesse: 1 });
  });

  it('sagt vor dem Abschicken, dass der Code schon vergeben ist', () => {
    const k = knopf({ id: 11 }, [{ id: 1, code: 'a-09' }]);
    k.tipp();
    assert.equal(k.gesendet.length, 0);
    assert.ok(k.toasts[0][0].startsWith('exp.runCodeTaken'));
  });

  it('meldet einen Fehler und laesst den Knopf wieder zu', async () => {
    const k = knopf({ error: 'lab: run code already in use in this experiment: A-09' }, []);
    k.tipp();
    k.antworten();
    await warten();
    assert.equal(k.taste.disabled, false);
    assert.deepEqual(k.stand(), { gezeichnet: 0, gefaesse: 0 }, 'nothing is redrawn, so the typed code stays');
    assert.ok(k.toasts[0][0].startsWith('proj.saveErr'));
    assert.equal(k.toasts[0][1], 'err');
  });
});
