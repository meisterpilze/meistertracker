'use strict';
// Was den Verlauf und das Zurueckholen mit der Oberflaeche verbindet.
//
// Die Schluessel, unter denen der Verlauf seine Zeilen uebersetzt, baut app.js
// zur Laufzeit zusammen ('exp.hist.f.' + Art + '.' + Feld). Die Suche nach
// Schluesseln in i18n.test.js findet nur feste, und die UI-Tests ersetzen t()
// durch eine Attrappe: fehlte einer, stuende der Rohschluessel vor den Nutzern,
// und alle Tests waeren gruen. Dasselbe galt fuer die Verdrahtung: der
// Capture-Zuhoerer fuer "toggle", das Nachladen nach dem Neuzeichnen und die
// Routen zum Zurueckholen liessen sich entfernen, ohne dass etwas rot wurde.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT, quelle, hebeFunktion } = require('./helpers/quelle');
const { versuchsrouten, jpeg } = require('./helpers/versuchsrouten');

function sprachen() {
  global.window = {};
  for (const s of ['de', 'en', 'pt']) {
    delete require.cache[require.resolve(path.join(ROOT, 'lang', s + '.js'))];
    require(path.join(ROOT, 'lang', s + '.js'));
  }
  return global.window.LANG;
}
function liste(src, re, name) {
  const m = src.match(re);
  assert.ok(m, name + ' nicht in db.js gefunden — der Test muss mitgeführt werden');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('Verlauf: Uebersetzungen, die app.js zur Laufzeit zusammensetzt', () => {
  let r;
  before(() => {
    r = versuchsrouten({
      benutzer: [
        { id: 7, username: 'anna', role: 'user' },
        { id: 8, username: 'chef', role: 'admin' }
      ]
    });
  });
  after(() => r.schliessen());

  it('gibt es in allen drei Sprachen, fuer jedes Feld und jede Handlung', async () => {
    const DB = quelle('db.js');
    const versuchFelder = liste(
      DB,
      /_aenderungen\(_versuchStand\(zeile\), neu, \[([\s\S]*?)\]\)/,
      'Felder des Versuchs'
    );
    const ansatzFelder = [
      ...DB.match(/function updateExperimentRun[\s\S]*?const spalten = \{([\s\S]*?)\};/)[1].matchAll(/(\w+):/g)
    ].map((m) => m[1]);
    const status = liste(DB, /^const VERSUCH_STATUS = \[(.*)\];$/m, 'VERSUCH_STATUS');
    const ausgaenge = liste(DB, /^const ANSATZ_AUSGANG = \[(.*)\];$/m, 'ANSATZ_AUSGANG');
    assert.ok(versuchFelder.length >= 7 && ansatzFelder.length >= 6);

    // Jede Handlung einmal wirklich ausfuehren und nachsehen, was im Verlauf steht.
    const ADMIN = { user_id: 8, username: 'chef', role: 'admin' };
    const v = (await r.anfrage('POST', '/api/experiments', { code: 'W-1', title: 'Lauf' })).json.id;
    const g = (await r.anfrage('POST', '/api/experiment-runs', { experimentId: v, code: 'A-1' })).json.id;
    await r.anfrage('DELETE', '/api/experiment-runs/' + g);
    await r.anfrage('POST', '/api/experiment-runs/' + g + '/restore');
    const f = (
      await r.anfrage('POST', '/api/experiment-photos', { experimentId: v, photos: [{ data_url: jpeg(100) }] })
    ).json.ids[0];
    await r.anfrage('DELETE', '/api/experiment-photos/' + f);
    await r.anfrage('POST', '/api/experiment-photos/' + f + '/restore');
    await r.anfrage('DELETE', '/api/experiment-photos/' + f);
    await r.anfrage('POST', '/api/experiment-photos/' + f + '/purge', undefined, ADMIN);
    r.db.markBackupRestore(r.database, {}, ADMIN);

    const schluessel = new Set([
      ...versuchFelder.map((x) => 'exp.hist.f.experiment.' + x),
      ...ansatzFelder.map((x) => 'exp.hist.f.run.' + x),
      ...status.map((x) => 'exp.hist.status.' + x),
      ...ausgaenge.map((x) => 'exp.out.' + x),
      'exp.hist.baseline',
      'exp.hist.userGone',
      'exp.hist.yes',
      'exp.hist.no',
      'exp.removedRuns',
      'exp.removedPhotos'
    ]);
    const handlungen = new Set();
    for (const e of r.db.listExperimentHistory(r.database, v)) {
      handlungen.add(e.action);
      if (e.action === 'update') schluessel.add('exp.hist.f.' + e.entity + '.' + e.field);
      else if (e.action === 'backup') schluessel.add('exp.hist.backup');
      else if (e.action !== 'baseline') schluessel.add('exp.hist.' + e.action + '.' + e.entity);
    }
    assert.deepEqual([...handlungen].sort(), ['backup', 'create', 'purge', 'remove', 'restore']);

    const LANG = sprachen();
    for (const sprache of ['de', 'en', 'pt']) {
      const fehlt = [...schluessel].filter((k) => !LANG[sprache][k]);
      assert.deepEqual(fehlt, [], sprache + ' lacks history translations');
    }
  });
});

describe('Verlauf und Zurueckholen: Verdrahtung', () => {
  it('haengt den toggle-Zuhoerer in der Capture-Phase an die Seite', () => {
    // "toggle" steigt nicht auf; ohne das dritte Argument kaeme das Aufklappen
    // nie bei pjToggle an, und der Verlauf stuende fuer immer bei "Laden".
    assert.ok(quelle().includes("$('p-proj').addEventListener('toggle', pjToggle, true);"));
  });

  it('holt nach dem Neuzeichnen nur das Neue, wenn der Verlauf offen ist', () => {
    const geholt = [];
    const ui = new Function(
      'geholt',
      `
      const document = { getElementById: () => ({ innerHTML: '', dataset: {} }) };
      let currentLang = 'de';
      let pjOffen = 5;
      let pjVerlaufOffen = 5;
      let pjVersuchGezeigt = null;
      const PJ_ANLEGEN_FELDER = [];
      let pjGezeichnetFuer;
      const experiments = [{ id: 5, runs: [] }];
      const pjExp = (id) => experiments.find((v) => v.id === id) || null;
      const pjDetail = () => '';
      const pjListe = () => '';
      const pjVerlaufLaden = (id, art) => geholt.push([id, art]);
      ${hebeFunktion('pjVersuchStand')}
      ${hebeFunktion('renderVersuch')}
      return { renderVersuch, zu: () => { pjVerlaufOffen = null; } };`
    )(geholt);
    ui.renderVersuch();
    ui.zu();
    ui.renderVersuch();
    assert.deepEqual(geholt, [[5, 'neu']], 'once while open, not while closed');
  });

  it('holt ein Foto ueber seine Route zurueck', async () => {
    const r = versuchsrouten();
    try {
      const v = Number(r.db.insertExperiment(r.database, { code: 'W-2', title: 'Lauf' }));
      const f = (
        await r.anfrage('POST', '/api/experiment-photos', { experimentId: v, photos: [{ data_url: jpeg(100) }] })
      ).json.ids[0];
      assert.equal((await r.anfrage('DELETE', '/api/experiment-photos/' + f)).status, 200);
      assert.equal(r.db.listExperiments(r.database)[0].removedPhotos.length, 1);
      assert.equal((await r.anfrage('POST', '/api/experiment-photos/' + f + '/restore')).status, 200);
      const zurueck = r.db.listExperiments(r.database)[0];
      assert.deepEqual([zurueck.photos.length, zurueck.removedPhotos.length], [1, 0]);
    } finally {
      r.schliessen();
    }
  });
});
