'use strict';
// Vorhaben-Texte aus der Datenbank.
//
// Forschung, Produkte und Bau standen als Konstante in app.js. Jetzt kommen sie
// per Import in die Datenbank, und app.js kennt nur noch ihre Form. Dieser Test
// haelt fest, was der Import annimmt und was nicht: eine Datei, die der Zeichner
// nicht lesen kann, soll hier scheitern und nicht erst auf dem Telefon.
//
// Die Dokumente hier sind ausgedacht. Echter Wortlaut gehoert nicht ins
// Repository, auch nicht in einen Test.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

// Ein Dokument mit jedem Baustein, den renderProjekte() kennt.
function dokument(titel) {
  return {
    title: titel,
    meta: 'Stand heute',
    lead: 'Ein Satz vorweg.',
    sections: [
      {
        t: 'Offen',
        items: [
          { p: 'Ein Absatz mit **fett**.' },
          { t: 'Liste', ul: ['eins', 'zwei'] },
          { ol: ['erst', 'dann'] },
          { note: 'Achtung', tone: 'warn' },
          { table: { head: ['A', 'B'], rows: [['1', '2']] } },
          { cards: [{ t: 'Karte', sub: 'klein', rows: [['k', 'v']], foot: 'unten' }] },
          { steps: [{ k: '1', v: 'Schritt' }] },
          { tasks: ['Aufgabe'] },
          { plan: { key: 'tag1', items: [['Ort', 'Handgriff', 'Detail']] } },
          { copy: { text: 'zum Kopieren' } }
        ]
      },
      { t: 'Zugeklappt', fold: true, items: [{ p: 'hinten' }] }
    ]
  };
}

describe('Vorhaben-Texte', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_vorhaben_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('ist leer, bis jemand importiert', () => {
    assert.deepEqual(db.getProjectDocs(d), {});
    assert.equal(db.getProjectDocsStamp(d), '');
  });

  it('nimmt die ganze Datei mit allen drei Reitern', () => {
    const reiter = db.setProjectDocs(
      d,
      { research: dokument('F'), products: dokument('P'), build: dokument('B') },
      null
    );
    assert.deepEqual(reiter.sort(), ['build', 'products', 'research']);
    const docs = db.getProjectDocs(d);
    assert.equal(docs.research.title, 'F');
    assert.equal(docs.build.sections[0].items[8].plan.key, 'tag1');
    assert.ok(db.getProjectDocsStamp(d));
  });

  it('ersetzt einen Reiter und laesst die anderen stehen', () => {
    db.setProjectDocs(d, { products: dokument('P2') }, null);
    const docs = db.getProjectDocs(d);
    assert.equal(docs.products.title, 'P2');
    assert.equal(docs.research.title, 'F');
  });

  it('gibt /api/data nur die Marke mit, nicht die Texte', () => {
    // /api/data laeuft bei jedem Sync; die Texte kommen ueber ihren eigenen Abruf.
    const alles = db.readAll(d);
    assert.equal(alles.projectDocsStamp, db.getProjectDocsStamp(d));
    assert.equal(JSON.stringify(alles).includes('Ein Absatz mit'), false);
  });

  it('schreibt nichts, wenn ein Reiter nicht passt', () => {
    // Erst alles pruefen, dann alles schreiben: sonst stuende nach einem halben
    // Import die eine Haelfte neu da und die andere alt.
    assert.throws(
      () => db.setProjectDocs(d, { research: dokument('F-neu'), build: { title: 'ohne Abschnitte' } }, null),
      /^Error: project doc: build\.sections must be a list/
    );
    assert.equal(db.getProjectDocs(d).research.title, 'F');
  });

  it('kennt nur die drei Reiter', () => {
    assert.throws(() => db.setProjectDocs(d, { forschung: dokument('X') }, null), /unknown tab forschung/);
    assert.throws(() => db.setProjectDocs(d, {}, null), /expected an object/);
    assert.throws(() => db.setProjectDocs(d, [dokument('X')], null), /expected an object/);
  });

  it('weist ab, woran der Zeichner scheitern wuerde', () => {
    const abschnitt = (items) => ({ title: 'T', sections: [{ t: 'S', items }] });
    const kaputt = [
      [{ title: 'T', sections: 'nein' }, /research\.sections must be a list/],
      [{ sections: [] }, /research\.title must be text/],
      [{ title: 'T', sections: [{ items: [] }] }, /sections\[0\]\.t must be text/],
      [abschnitt(['nur Text']), /items\[0\] must be an object/],
      [abschnitt([{ ul: 'x' }]), /items\[0\]\.ul must be a list of texts/],
      [abschnitt([{ table: { rows: [] } }]), /table\.head must be a list of texts/],
      [abschnitt([{ table: { head: ['A'], rows: ['keine Zeile'] } }]), /table\.rows\[0\] must be a row/],
      [abschnitt([{ cards: [{ t: 'K', rows: 'x' }] }]), /cards\[0\]\.rows must be a list/],
      [abschnitt([{ plan: { items: [] } }]), /plan\.key must be text/],
      [abschnitt([{ copy: {} }]), /copy\.text must be text/]
    ];
    for (const [doc, fehler] of kaputt) {
      assert.throws(() => db.setProjectDocs(d, { research: doc }, null), fehler);
    }
    assert.equal(db.getProjectDocs(d).research.title, 'F');
  });

  it('meldet Formfehler an den Admin, statt sie zu verschlucken', () => {
    // safeErr gibt nur Meldungen mit bekanntem Anfang weiter. Alles andere wird
    // "Internal server error", und der Admin erfuehre nicht, was an der Datei fehlt.
    assert.equal(db.isSafeError('project doc: research.title must be text'), true);
  });

  it('merkt sich, wer ersetzt hat', () => {
    db.createUser(d, 'importeur', 'lang-genug-fuer-den-test', 'admin');
    const id = d.prepare('SELECT id FROM users WHERE username=?').get('importeur').id;
    db.setProjectDocs(d, { build: dokument('B2') }, id);
    assert.equal(d.prepare('SELECT updated_by FROM project_docs WHERE tab=?').get('build').updated_by, id);
  });
});

describe('Vorhaben-Texte im Quelltext', () => {
  it('stehen nicht mehr in app.js', () => {
    // Der Wortlaut gehoert in die Datenbank, siehe CLAUDE.md. Kommt die alte
    // Konstante zurueck, etwa ueber einen Revert, faellt es hier auf.
    const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.equal(/\bPJ_DOCS\b/.test(app), false);
  });

  it('ersetzt nur ein Admin', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').split('\n');
    const i = src.findIndex((l) => l.includes("req.method === 'PUT' && url === '/api/project-docs'"));
    assert.ok(i > 0, 'PUT /api/project-docs not found in server.js');
    assert.ok(src[i + 1].includes('requireAdmin(req, res)'), 'the PUT route has to start with requireAdmin');
  });
});
