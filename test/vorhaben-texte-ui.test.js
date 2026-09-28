'use strict';
// Die Vorhaben-Reiter zeichnen, was die Datenbank liefert.
//
// Seit die Texte nicht mehr in app.js stehen, hat renderProjekte() drei Faelle
// statt einem: noch nicht geladen, geladen und leer, geladen mit Dokument. Dazu
// kommt der Import-Knopf, den nur ein Admin sieht. Wie die anderen UI-Tests
// holt dieser die Funktionen aus dem Quelltext und laesst sie gegen ein
// Stub-DOM laufen; geprueft wird das HTML, das dabei herauskommt.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function grab(name) {
  const m = SRC.match(new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
  assert.ok(m, 'could not find ' + name + '() in app.js — has it been renamed?');
  return m[0];
}

const TEILE = [
  'esc',
  'pjText',
  'pjTable',
  'pjCards',
  'pjSteps',
  'pjTasks',
  'pjChkLoad',
  'pjChkSave',
  'pjPlan',
  'pjPlanRefresh',
  'pjPlansRefresh',
  'pjItem',
  'pjNotizDatum',
  'pjNotizZeile',
  'pjNotizen',
  'pjDocsLaden',
  'pjDocsWarten',
  'pjDocImport',
  'renderProjekte'
];

function laden() {
  return new Function(`
    let projectDocs = null;
    let projectNotes = [];
    let currentUser = null;
    let pjDocsAbruf = null;
    const PJ_CHK = 'test';
    const abrufe = [];
    let antwort = { docs: {} };
    const els = {};
    for (const k of ['research', 'products', 'build']) els['pj-' + k] = { innerHTML: '', querySelectorAll: () => [] };
    const document = { getElementById: (id) => els[id] || null, querySelectorAll: () => [] };
    const localStorage = { getItem: () => null, setItem: () => {} };
    const t = (k, o) => k + (o ? JSON.stringify(o) : '');
    const loc = () => 'de-DE';
    const apiGet = (p) => {
      abrufe.push(p);
      return antwort instanceof Error ? Promise.reject(antwort) : Promise.resolve(antwort);
    };
    ${TEILE.map(grab).join('\n')}
    return {
      renderProjekte,
      els,
      abrufe,
      setzeDocs: (x) => { projectDocs = x; },
      setzeUser: (u) => { currentUser = u; },
      setzeAntwort: (a) => { antwort = a; }
    };`)();
}

// Ein paar Runden der Ereignisschleife, bis der Abruf samt then/finally durch ist.
const warten = () => new Promise((r) => setTimeout(r, 5));

const DOK = {
  title: 'Titel <img src=x onerror=alert(1)>',
  meta: 'Stand',
  lead: 'Vorweg',
  sections: [
    { t: 'Offen', items: [{ p: 'Absatz' }, { table: { head: ['A'], rows: [['1']] } }, { tasks: ['Aufgabe'] }] },
    { t: 'Hinten', fold: true, items: [{ ul: ['eins'] }] }
  ]
};

describe('Vorhaben-Reiter', () => {
  let ui;
  before(() => {
    ui = laden();
  });

  it('laedt erst beim Oeffnen und zeigt bis dahin einen Platzhalter', async () => {
    ui.setzeAntwort({ docs: { research: DOK } });
    ui.renderProjekte('research');
    assert.ok(ui.els['pj-research'].innerHTML.includes('proj.docLoading'));
    assert.deepEqual(ui.abrufe, ['/api/project-docs']);
    await warten();
    const html = ui.els['pj-research'].innerHTML;
    assert.ok(html.includes('Absatz'), 'the document is drawn once it has arrived');
    assert.ok(html.includes('pj-notebox'), 'research keeps its notes box');
  });

  it('holt nicht bei jedem Reiter neu', () => {
    ui.renderProjekte('research');
    assert.equal(ui.abrufe.length, 1);
  });

  it('escaped, was aus der Datenbank kommt', () => {
    const html = ui.els['pj-research'].innerHTML;
    assert.equal(html.includes('<img'), false);
    assert.ok(html.includes('&lt;img'));
  });

  it('zeigt den Import nur einem Admin', () => {
    ui.setzeUser({ role: 'user' });
    ui.renderProjekte('research');
    assert.equal(ui.els['pj-research'].innerHTML.includes('data-pj-doc-import'), false);
    ui.setzeUser({ role: 'admin' });
    ui.renderProjekte('research');
    assert.ok(ui.els['pj-research'].innerHTML.includes('data-pj-doc-import="research"'));
    assert.ok(ui.els['pj-research'].innerHTML.includes('proj.docReplace'));
  });

  it('sagt, wenn ein Reiter noch leer ist, und laesst die Notizen stehen', () => {
    ui.renderProjekte('build');
    const bau = ui.els['pj-build'].innerHTML;
    assert.ok(bau.includes('proj.docNone'));
    assert.ok(bau.includes('proj.docImport'), 'an admin can fill an empty tab');
    ui.setzeDocs({});
    ui.renderProjekte('research');
    const forschung = ui.els['pj-research'].innerHTML;
    assert.ok(forschung.includes('proj.docNone'));
    assert.ok(forschung.includes('pj-notebox'), 'notes do not depend on the document');
  });

  it('bleibt nach einem Fehler nicht im Laden haengen', async () => {
    ui.setzeDocs(null);
    ui.setzeAntwort(new Error('offline'));
    ui.renderProjekte('products');
    await warten();
    const html = ui.els['pj-products'].innerHTML;
    assert.ok(html.includes('proj.docLoadErr'));
    assert.ok(html.includes('data-pj-doc-retry="products"'));
  });
});
