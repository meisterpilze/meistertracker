'use strict';
// Forschungsproben: was aus dem Labor an Partner geht, mit Rezept, Herkunft
// und Weitergabe.
//
// Worauf es ankommt: jede Probe hat einen eindeutigen Code und eine Nummer fuer
// den Strichcode; das Rezept hat hoechstens zehn Zeilen und keine Menge ohne
// Zutat; eine Probe stammt nie aus sich selbst; jede Aenderung steht im Verlauf
// und in der Pruefkette; entfernt ist nicht geloescht; und ein gescanntes
// Etikett oeffnet die Probe.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { routen } = require('./helpers/routen');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const ERIKA = { user_id: 7, username: 'erika' };

function datenbank() {
  const p = path.join(os.tmpdir(), 'mt_proben_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  const d = db.openDb(p);
  d.prepare('INSERT INTO users(id,username,hash,salt,role,created) VALUES(?,?,?,?,?,?)').run(
    7,
    'erika',
    'x',
    'y',
    'user',
    new Date().toISOString()
  );
  return {
    d,
    weg() {
      d.close();
      fs.rmSync(p, { force: true });
    }
  };
}

describe('Forschungsproben in der Datenbank', () => {
  let x;
  before(() => {
    x = datenbank();
  });
  after(() => x.weg());

  it('hat nach v114 beide Tabellen', () => {
    assert.ok(x.d.prepare('SELECT 1 FROM schema_version WHERE version=114').get());
    for (const t of ['research_samples', 'research_handoffs']) {
      assert.ok(x.d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t), t);
    }
  });

  it('vergibt Codes je Art und eine Strichcode-Nummer', () => {
    const a = db.insertResearchSample(x.d, { kind: 'lc', title: 'Beispielbrühe' }, ERIKA);
    const b = db.insertResearchSample(x.d, { kind: 'lc' }, ERIKA);
    const c = db.insertResearchSample(x.d, { kind: 'aerial' }, ERIKA);
    const s = db.insertResearchSample(x.d, { kind: 'other' }, ERIKA);
    assert.deepEqual([a.code, b.code, c.code, s.code], ['RLC-001', 'RLC-002', 'RAM-001', 'RS-001']);
    const eintrag = x.d.prepare('SELECT * FROM barcodes WHERE barcode=?').get(a.barcode);
    assert.equal(eintrag.entity_type, 'sample');
    assert.equal(eintrag.entity_id, String(a.id));
    assert.ok(a.barcode >= 1000000);
  });

  it('nimmt einen eigenen Code, aber keinen doppelten, auch nicht anders geschrieben', () => {
    const p = db.insertResearchSample(x.d, { kind: 'lc', code: 'TEST-7' }, ERIKA);
    assert.equal(p.code, 'TEST-7');
    assert.throws(() => db.insertResearchSample(x.d, { kind: 'lc', code: 'test-7' }, ERIKA), /^Error: Probe: /);
    assert.throws(() => db.insertResearchSample(x.d, { kind: 'lc', code: 'mit leerzeichen' }, ERIKA), /Probe:/);
    // Der naechste automatische Code zaehlt ab der hoechsten Nummer weiter.
    db.insertResearchSample(x.d, { kind: 'lc', code: 'RLC-010' }, ERIKA);
    assert.equal(db.nextResearchSampleCode(x.d, 'lc'), 'RLC-011');
  });

  it('prueft das Rezept: leere Zeilen fallen weg, keine Menge ohne Zutat, hoechstens zehn', () => {
    const p = db.insertResearchSample(
      x.d,
      {
        kind: 'lc',
        recipe: [{ name: 'Zutat A', amount: '20', unit: 'g/L' }, {}, { name: ' ', amount: '', unit: '' }]
      },
      ERIKA
    );
    const zeile = db.listResearchSamples(x.d).find((z) => z.id === p.id);
    assert.deepEqual(zeile.recipe, [{ name: 'Zutat A', amount: '20', unit: 'g/L' }]);
    assert.throws(
      () => db.insertResearchSample(x.d, { kind: 'lc', recipe: [{ amount: '5', unit: 'g' }] }, ERIKA),
      /Rezeptzeile 1: die Zutat fehlt/
    );
    const elf = Array.from({ length: 11 }, (_, i) => ({ name: 'Zutat ' + i }));
    assert.throws(() => db.insertResearchSample(x.d, { kind: 'lc', recipe: elf }, ERIKA), /höchstens 10/);
  });

  it('lehnt Unsinn mit einer lesbaren Meldung ab', () => {
    for (const f of [
      { kind: 'pilz' },
      { kind: 'lc', made: '31.01.2026' },
      { kind: 'lc', parentId: 9999 },
      { kind: 'lc', experimentId: 9999 },
      { kind: 'lc', title: 'x'.repeat(201) }
    ]) {
      assert.throws(() => db.insertResearchSample(x.d, f, ERIKA), /^Error: Probe: /, JSON.stringify(f));
    }
  });

  it('haelt die Herkunft frei von Kreisen', () => {
    const a = db.insertResearchSample(x.d, { kind: 'lc' }, ERIKA);
    const b = db.insertResearchSample(x.d, { kind: 'aerial', parentId: a.id }, ERIKA);
    const c = db.insertResearchSample(x.d, { kind: 'other', parentId: b.id }, ERIKA);
    assert.throws(() => db.updateResearchSample(x.d, a.id, { parentId: c.id }, ERIKA), /Folgeproben/);
    assert.throws(() => db.updateResearchSample(x.d, a.id, { parentId: a.id }, ERIKA), /Folgeproben/);
    assert.equal(db.updateResearchSample(x.d, c.id, { parentId: a.id }, ERIKA), true);
    assert.equal(db.updateResearchSample(x.d, c.id, { parentId: null }, ERIKA), true);
  });

  it('schreibt jede echte Aenderung in den Verlauf, das Rezept als ganze Liste', () => {
    const p = db.insertResearchSample(x.d, { kind: 'lc', recipe: [{ name: 'Zutat A' }] }, ERIKA);
    assert.equal(db.updateResearchSample(x.d, p.id, { title: 'Neu' }, ERIKA), true);
    // Derselbe Wert noch einmal ist keine Aenderung.
    assert.equal(db.updateResearchSample(x.d, p.id, { title: 'Neu' }, ERIKA), false);
    assert.equal(
      db.updateResearchSample(x.d, p.id, { recipe: [{ name: 'Zutat B', amount: '1', unit: 'L' }] }, ERIKA),
      true
    );
    const verlauf = db.listResearchSampleHistory(x.d, p.id);
    assert.deepEqual(
      verlauf.map((e) => e.action + ':' + (e.field || '')),
      ['create:', 'update:title', 'update:recipe']
    );
    const rezept = verlauf[2];
    assert.deepEqual(JSON.parse(rezept.from), [{ name: 'Zutat A', amount: '', unit: '' }]);
    assert.deepEqual(JSON.parse(rezept.to), [{ name: 'Zutat B', amount: '1', unit: 'L' }]);
    assert.equal(rezept.user, 'erika');
    // Proben gehoeren in keinen Versuchsverlauf.
    assert.ok(verlauf.every((e) => !('experimentId' in e) || e.experimentId == null));
    assert.equal(db.labChainStatus(x.d).ok, true);
  });

  it('traegt Weitergaben ein, mit dem Tag der ersten Rueckmeldung', () => {
    const p = db.insertResearchSample(x.d, { kind: 'lc' }, ERIKA);
    assert.throws(() => db.insertResearchHandoff(x.d, { sampleId: p.id, partner: ' ' }, ERIKA), /wer die Probe/);
    const id = db.insertResearchHandoff(
      x.d,
      { sampleId: p.id, partner: 'Beispiel GmbH', given: '2026-01-31', amount: '50 mL', purpose: 'Messung' },
      ERIKA
    );
    let w = db.listResearchSamples(x.d).find((z) => z.id === p.id).handoffs[0];
    assert.equal(w.id, id);
    assert.equal(w.resultDate, null);
    assert.equal(db.updateResearchHandoff(x.d, id, { result: 'Ausgedachter Befund' }, ERIKA), true);
    w = db.listResearchSamples(x.d).find((z) => z.id === p.id).handoffs[0];
    assert.match(w.resultDate, /^\d{4}-\d{2}-\d{2}$/);
    const verlauf = db.listResearchSampleHistory(x.d, p.id);
    assert.deepEqual(
      verlauf.filter((e) => e.entity === 'handoff').map((e) => e.action + ':' + (e.field || '')),
      ['create:', 'update:result', 'update:resultDate']
    );
  });

  it('entfernt und holt zurueck, statt zu loeschen', () => {
    const p = db.insertResearchSample(x.d, { kind: 'lc', code: 'WEG-1' }, ERIKA);
    const w = db.insertResearchHandoff(x.d, { sampleId: p.id, partner: 'Beispiel GmbH' }, ERIKA);
    assert.equal(db.removeResearchHandoff(x.d, w, ERIKA), true);
    assert.equal(db.removeResearchHandoff(x.d, w, ERIKA), false);
    assert.equal(db.restoreResearchHandoff(x.d, w, ERIKA), true);
    assert.equal(db.removeResearchSample(x.d, p.id, ERIKA), true);
    assert.ok(db.listResearchSamples(x.d).find((z) => z.id === p.id).removedAt);
    assert.throws(() => db.insertResearchHandoff(x.d, { sampleId: p.id, partner: 'Beispiel GmbH' }, ERIKA), /entfernt/);
    // Eine entfernte Probe behaelt ihren Code: ihr Etikett ist vielleicht
    // schon draussen, und ein Code meint immer dieselbe Probe.
    assert.throws(() => db.insertResearchSample(x.d, { kind: 'lc', code: 'weg-1' }, ERIKA), /gibt es schon/);
    assert.equal(db.restoreResearchSample(x.d, p.id, ERIKA), true);
    const aktionen = db.listResearchSampleHistory(x.d, p.id).map((e) => e.entity + ':' + e.action);
    assert.ok(aktionen.includes('handoff:remove') && aktionen.includes('handoff:restore'));
    assert.ok(aktionen.includes('sample:remove'));
  });

  it('kommt mit /api/data mit', () => {
    const daten = db.readAll(x.d);
    assert.ok(Array.isArray(daten.researchSamples));
    assert.ok(daten.barcodes.some((b) => b.entity_type === 'sample'));
  });
});

describe('Forschungsproben-Routen', () => {
  const ABSCHNITT = {
    name: 'probenrouten',
    von: '// ── Forschungsproben',
    bis: '// ── Vorhaben-Texte',
    helfer: ['jsonOk', 'jsonErr', 'safeErr', 'validateTypes'],
    liestUrl: true
  };
  let r;
  before(() => {
    r = routen(ABSCHNITT);
  });

  it('legt an, aendert, entfernt und holt zurueck', async () => {
    const neu = await r.anfrage('POST', '/api/research-samples', {
      kind: 'lc',
      title: 'Beispiel',
      recipe: [{ name: 'Zutat A', amount: '1', unit: 'g' }]
    });
    assert.equal(neu.status, 200);
    assert.equal(neu.json.code, 'RLC-001');
    assert.ok(neu.json.barcode >= 1000000);
    const id = neu.json.id;
    assert.equal((await r.anfrage('PATCH', '/api/research-samples/' + id, { notes: 'beobachtet' })).status, 200);
    const w = await r.anfrage('POST', '/api/research-handoffs', { sampleId: id, partner: 'Beispiel GmbH' });
    assert.equal(w.status, 200);
    assert.equal((await r.anfrage('PATCH', '/api/research-handoffs/' + w.json.id, { result: 'ok' })).status, 200);
    assert.equal((await r.anfrage('DELETE', '/api/research-handoffs/' + w.json.id)).status, 200);
    assert.equal((await r.anfrage('POST', '/api/research-handoffs/' + w.json.id + '/restore')).status, 200);
    assert.equal((await r.anfrage('DELETE', '/api/research-samples/' + id)).status, 200);
    assert.equal((await r.anfrage('POST', '/api/research-samples/' + id + '/restore')).status, 200);
    const verlauf = await r.anfrage('GET', '/api/research-samples/' + id + '/history');
    assert.equal(verlauf.status, 200);
    assert.ok(verlauf.json.history.length >= 7);
  });

  it('antwortet auf Fehler mit 400 und der Meldung, nicht mit 500', async () => {
    for (const [method, url, body] of [
      ['POST', '/api/research-samples', { kind: 'pilz' }],
      ['POST', '/api/research-samples', { kind: 'lc', recipe: 'Zutat A' }],
      ['POST', '/api/research-samples', { kind: 'lc', parentId: '1' }],
      ['PATCH', '/api/research-samples/999', { title: 'fehlt' }],
      ['POST', '/api/research-handoffs', { sampleId: 999, partner: 'Beispiel GmbH' }],
      ['PATCH', '/api/research-handoffs/999', { result: 'fehlt' }]
    ]) {
      const a = await r.anfrage(method, url, body);
      assert.equal(a.status, 400, method + ' ' + url + ' ' + JSON.stringify(body));
      assert.ok(a.json && a.json.error, 'eine Meldung');
    }
  });
});

describe('Proben in der App', () => {
  const app = quelle('app.js');
  const html = quelle('index.html');

  it('hat den Reiter und sein Feld', () => {
    assert.match(html, /id="st-proj-proben"/);
    assert.match(html, /id="sp-proj-proben"><div id="pj-proben"><\/div>/);
    assert.match(app, /\$\('st-proj-proben'\)\.addEventListener\('click'/);
    assert.match(app, /else if \(sub === 'proben'\) renderProben\(\);/);
  });

  it('oeffnet eine gescannte Probe, egal welcher Vorgang steht', () => {
    const scan = hebeFunktion('processScan', app);
    assert.match(scan, /entry\.type === 'sample'[\s\S]{0,200}prbGescannt\(Number\(entry\.id\)\);\s*return;/);
  });

  it('druckt das Etikett mit der Nummer aus der Barcode-Liste', () => {
    const drucken = hebeFunktion('prbDrucken', app);
    assert.match(drucken, /barcodeByEntity\.get\('sample:' \+ p\.id\)/);
    assert.match(drucken, /labelLayout\(String\(nummer\)/);
    // Und das Anlegen endet im Etikett.
    assert.match(hebeFunktion('prbAnlegen', app), /prbDrucken\(r\.id\)/);
  });

  it('hat jeden Text in allen drei Sprachen', () => {
    const schluessel = new Set();
    for (const m of app.matchAll(/\bt\('(prb\.[A-Za-z.]+)'/g)) schluessel.add(m[1]);
    for (const m of app.matchAll(/\btp\('(prb\.[A-Za-z.]+)'/g)) {
      schluessel.add(m[1] + '.one');
      schluessel.add(m[1] + '.other');
    }
    for (const a of ['lc', 'aerial', 'misc']) schluessel.add('prb.kind.' + a);
    for (const e of ['sample', 'handoff'])
      for (const a of ['create', 'remove', 'restore']) schluessel.add(`prb.hist.${e}.${a}`);
    for (const f of ['code', 'kind', 'title', 'made', 'species', 'parentId', 'source', 'experimentId', 'recipe']) {
      schluessel.add('prb.f.' + f);
    }
    for (const f of ['conditions', 'notes', 'partner', 'given', 'amount', 'purpose', 'result', 'resultDate']) {
      schluessel.add('prb.f.' + f);
    }
    for (const lang of ['de', 'en', 'pt']) {
      global.window = {};
      delete require.cache[require.resolve('../lang/' + lang + '.js')];
      require('../lang/' + lang + '.js');
      const woerter = global.window.LANG[lang];
      const fehlen = [...schluessel].filter((k) => !k.endsWith('.') && !(k in woerter));
      assert.deepEqual(fehlen, [], lang);
      assert.ok('proj.tabSamples' in woerter, lang);
    }
    delete global.window;
  });
});
