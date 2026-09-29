'use strict';
// Was die Versuchs-Routen annehmen und was nicht.
//
// Die Routen laufen hier woertlich aus server.js gegen eine echte Datenbank
// (test/helpers/versuchsrouten.js). Geprueft wird, was der Server antwortet und
// was danach in der Datenbank und im Verlauf steht.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { versuchsrouten } = require('./helpers/versuchsrouten');

const verlauf = (r) => r.database.prepare('SELECT COUNT(*) AS c FROM lab_history').get().c;
const version = (r) => r.database.prepare("SELECT value FROM meta WHERE key='data_version'").get().value;

describe('Gefaess aendern: Typen', () => {
  let r;
  let versuch;
  let ansatz;
  before(() => {
    r = versuchsrouten();
    versuch = Number(r.db.insertExperiment(r.database, { code: 'T-1', title: 'Testversuch' }));
    ansatz = Number(r.db.insertExperimentRun(r.database, { experimentId: versuch, code: 'A-1' }));
  });
  after(() => r.schliessen());

  it('weist ein Objekt oder eine Liste als Kultur oder Charge ab, ohne etwas zu schreiben', async () => {
    const vorher = [verlauf(r), version(r)];
    for (const body of [{ cultureId: {} }, { cultureId: [] }, { batchId: {} }, { batchId: ['x'] }]) {
      const a = await r.anfrage('PATCH', '/api/experiment-runs/' + ansatz, body);
      assert.equal(a.status, 400, JSON.stringify(body));
      assert.match(a.json.error, /must be a string/);
    }
    assert.deepEqual([verlauf(r), version(r)], vorher, 'no history entry and no new data version');
  });

  it('nimmt als Reihenfolge nur eine ganze Zahl', async () => {
    for (const sort of [{}, 1.5, null, '2']) {
      const a = await r.anfrage('PATCH', '/api/experiment-runs/' + ansatz, { sort });
      assert.equal(a.status, 400, JSON.stringify(sort));
    }
    const a = await r.anfrage('PATCH', '/api/experiment-runs/' + ansatz, { sort: 7 });
    assert.equal(a.status, 200);
    assert.equal(r.database.prepare('SELECT sort FROM experiment_runs WHERE id=?').get(ansatz).sort, 7);
  });

  it('laesst den Code nicht leer werden', async () => {
    for (const code of [null, '', '   ']) {
      const a = await r.anfrage('PATCH', '/api/experiment-runs/' + ansatz, { code });
      assert.equal(a.status, 400, JSON.stringify(code));
      assert.match(a.json.error, /code must not be empty/);
    }
    const b = await r.anfrage('POST', '/api/experiment-runs', { experimentId: versuch, code: '  ' });
    assert.equal(b.status, 400);
  });

  it('nimmt beim Anlegen nur eine Zahl als Versuch', async () => {
    const a = await r.anfrage('POST', '/api/experiment-runs', { experimentId: String(versuch), code: 'A-2' });
    assert.equal(a.status, 400);
  });
});

describe('Verlauf: nur fuer eine Aenderung, die eine Zeile getroffen hat', () => {
  let r;
  before(() => {
    r = versuchsrouten();
  });
  after(() => r.schliessen());

  it('wirft, statt einen Eintrag ohne Aenderung zu schreiben', () => {
    const versuch = Number(r.db.insertExperiment(r.database, { code: 'T-2', title: 'Testversuch' }));
    const ansatz = Number(r.db.insertExperimentRun(r.database, { experimentId: versuch, code: 'B-1' }));
    const vorher = [verlauf(r), version(r)];
    // Ein Objekt vorne liest node:sqlite als benannte Parameter; das UPDATE
    // trifft dann keine Zeile.
    assert.throws(() => r.db.updateExperimentRun(r.database, ansatz, { cultureId: {} }), /matched 0 rows/);
    assert.deepEqual([verlauf(r), version(r)], vorher);
  });
});

describe('Versuch anlegen und aendern: Felder', () => {
  let r;
  let versuch;
  before(() => {
    r = versuchsrouten();
    versuch = Number(r.db.insertExperiment(r.database, { code: 'T-3', title: 'Testversuch', started: '2026-09-01' }));
  });
  after(() => r.schliessen());
  const zeile = () => r.database.prepare('SELECT * FROM experiments WHERE id=?').get(versuch);
  const patch = (body) => r.anfrage('PATCH', '/api/experiments/' + versuch, body);

  it('laesst Titel und Beginn nicht leer werden', async () => {
    for (const body of [{ title: '' }, { title: '   ' }, { title: null }, { started: '' }, { started: null }]) {
      assert.equal((await patch(body)).status, 400, JSON.stringify(body));
    }
    assert.equal(zeile().title, 'Testversuch');
    assert.equal(zeile().started, '2026-09-01');
  });

  it('nimmt als Datum nur einen Tag, den es gibt', async () => {
    for (const started of [5, [2026], '2026-02-31', '2026-9-1', 'gestern', { toString: 1 }]) {
      assert.equal((await patch({ started })).status, 400, JSON.stringify(started));
    }
    assert.equal((await patch({ started: '2026-09-02' })).status, 200);
    assert.equal(zeile().started, '2026-09-02');
  });

  it('antwortet auf einen Status ohne Wert mit 400 statt 500', async () => {
    assert.equal((await patch({ status: null })).status, 400);
    assert.equal((await patch({ status: 5 })).status, 400);
    assert.equal(zeile().status, 'running');
  });

  it('archiviert nur mit einem echten Ja', async () => {
    assert.equal((await patch({ archived: 'false' })).status, 400);
    assert.equal(zeile().archived, 0);
    assert.equal((await patch({ archived: true })).status, 200);
    assert.equal(zeile().archived, 1);
  });

  it('setzt ein Ende und nimmt es mit leerem Wert als NULL zurueck', async () => {
    assert.equal((await patch({ ended: '2026-09-30' })).status, 200);
    assert.equal(zeile().ended, '2026-09-30');
    assert.equal((await patch({ ended: '' })).status, 200);
    assert.equal(zeile().ended, null);
  });

  it('prueft das Datum auch beim Anlegen', async () => {
    const a = await r.anfrage('POST', '/api/experiments', { code: 'T-4', title: 'Neu', started: '2026-13-01' });
    assert.equal(a.status, 400);
    const b = await r.anfrage('POST', '/api/experiments', { code: 'T-4', title: 'Neu', started: '2026-09-28' });
    assert.equal(b.status, 200);
  });

  it('antwortet auf einen Rumpf, der kein Objekt ist, statt haengen zu bleiben', async () => {
    const a = await patch(null);
    assert.equal(a.status, 400);
  });
});

describe('Laborbuch: Fehler kommen als Auskunft an', () => {
  let r;
  before(() => {
    r = versuchsrouten();
  });
  after(() => r.schliessen());

  it('sagt, dass ein Code schon vergeben ist, auch an einen archivierten Versuch', async () => {
    const alt = Number(r.db.insertExperiment(r.database, { code: 'V3', title: 'Alter Lauf' }));
    r.db.updateExperiment(r.database, alt, { status: 'done', archived: true });
    const a = await r.anfrage('POST', '/api/experiments', { code: 'V3', title: 'Neuer Lauf' });
    assert.equal(a.status, 400);
    assert.match(a.json.error, /already in use: V3/);
  });

  it('gibt Ausgang, Versuch und Reiter, die es nicht gibt, als 400 mit Grund zurueck', async () => {
    const versuch = Number(r.db.insertExperiment(r.database, { code: 'V4', title: 'Lauf' }));
    const ansatz = Number(r.db.insertExperimentRun(r.database, { experimentId: versuch, code: 'A-1' }));
    const faelle = [
      ['PATCH', '/api/experiment-runs/' + ansatz, { outcome: 'hinueber' }, /invalid outcome/],
      ['POST', '/api/experiment-runs', { experimentId: 99999, code: 'A-2' }, /unknown experiment/],
      ['POST', '/api/project-notes', { tab: 'forschung', body: 'x' }, /invalid tab/]
    ];
    for (const [methode, pfad, body, grund] of faelle) {
      const a = await r.anfrage(methode, pfad, body);
      assert.equal(a.status, 400, methode + ' ' + pfad);
      assert.match(a.json.error, grund);
    }
  });
});

describe('Entferntes Gefaess', () => {
  let r;
  before(() => {
    r = versuchsrouten();
  });
  after(() => r.schliessen());

  it('ist nur noch zum Lesen da, bis es zurueckgeholt ist', async () => {
    const versuch = Number(r.db.insertExperiment(r.database, { code: 'V5', title: 'Lauf' }));
    const ansatz = Number(r.db.insertExperimentRun(r.database, { experimentId: versuch, code: 'A-1' }));
    assert.equal((await r.anfrage('DELETE', '/api/experiment-runs/' + ansatz)).status, 200);
    const vorher = verlauf(r);
    const a = await r.anfrage('PATCH', '/api/experiment-runs/' + ansatz, { result: 'spaet eingetragen' });
    assert.equal(a.status, 400);
    assert.match(a.json.error, /is removed; restore it first/);
    assert.equal(verlauf(r), vorher);
    assert.equal(r.database.prepare('SELECT result FROM experiment_runs WHERE id=?').get(ansatz).result, '');
    assert.equal((await r.anfrage('POST', '/api/experiment-runs/' + ansatz + '/restore')).status, 200);
    assert.equal((await r.anfrage('PATCH', '/api/experiment-runs/' + ansatz, { result: 'jetzt' })).status, 200);
  });
});

describe('Verlauf seitenweise', () => {
  let r;
  let versuch;
  before(() => {
    r = versuchsrouten();
    versuch = Number(r.db.insertExperiment(r.database, { code: 'V6', title: 'Lauf' }));
    const eintragen = r.database.prepare(
      "INSERT INTO lab_history(at,entity,entity_id,experiment_id,action,field,old_value,new_value) VALUES(?, 'experiment', ?, ?, 'update', 'outcome', '', ?)"
    );
    for (let i = 0; i < 250; i++) eintragen.run(new Date().toISOString(), versuch, versuch, 'Stand ' + i);
  });
  after(() => r.schliessen());
  const holen = (q) => r.anfrage('GET', '/api/experiments/' + versuch + '/history' + (q || ''));

  it('liefert erst die juengsten Eintraege und sagt, dass es aeltere gibt', async () => {
    const a = await holen();
    assert.equal(a.status, 200);
    assert.equal(a.json.entries.length, 200);
    assert.equal(a.json.more, true);
    const ids = a.json.entries.map((e) => e.id);
    assert.deepEqual(
      ids,
      [...ids].sort((x, y) => x - y),
      'in the order it happened'
    );
    assert.equal(a.json.newest, ids[ids.length - 1], 'the newest id comes along');
    const b = await holen('?before=' + ids[0]);
    assert.equal(b.json.entries.length, 51, 'the rest, including the create entry');
    assert.equal(b.json.more, false);
    assert.equal(b.json.entries[0].action, 'create');
  });

  it('liefert nach einer bekannten Kennung nur das Neue', async () => {
    const alle = r.db.listExperimentHistory(r.database, versuch);
    const letzte = alle[alle.length - 1].id;
    assert.deepEqual((await holen('?after=' + letzte)).json.entries, []);
    const a = await holen('?after=' + alle[alle.length - 3].id);
    assert.deepEqual(
      a.json.entries.map((e) => e.id),
      alle.slice(-2).map((e) => e.id)
    );
  });

  it('weist Angaben ab, die keine Zahlen sind', async () => {
    for (const q of ['?after=abc', '?before=-1', '?limit=1.5']) {
      assert.equal((await holen(q)).status, 400, q);
    }
  });
});

describe('Laborbuch: nur eine Aenderung weckt die anderen Geraete', () => {
  let r;
  before(() => {
    r = versuchsrouten();
  });
  after(() => r.schliessen());

  it('sendet nichts fuer einen PATCH ohne Aenderung oder ein zweites Entfernen', async () => {
    const versuch = Number(r.db.insertExperiment(r.database, { code: 'V7', title: 'Lauf' }));
    const ansatz = Number(r.db.insertExperimentRun(r.database, { experimentId: versuch, code: 'A-1' }));
    const vorher = r.sendungen();
    await r.anfrage('PATCH', '/api/experiments/' + versuch, { title: 'Lauf' });
    await r.anfrage('PATCH', '/api/experiment-runs/' + ansatz, { result: '' });
    assert.equal(r.sendungen(), vorher, 'nothing changed, nothing sent');
    await r.anfrage('DELETE', '/api/experiment-runs/' + ansatz);
    await r.anfrage('DELETE', '/api/experiment-runs/' + ansatz);
    assert.equal(r.sendungen(), vorher + 1, 'the second remove changes nothing');
  });
});
