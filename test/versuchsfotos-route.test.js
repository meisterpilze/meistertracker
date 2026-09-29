'use strict';
// Was POST /api/experiment-photos antwortet, wenn etwas schiefgeht.
//
// Drei Faelle kamen vorher als 500 "Internal server error" zurueck oder
// hinterliessen einen falschen Zaehlerstand: ein Eintrag, der kein Objekt ist,
// eine volle Fotoablage, und ein Fehler mitten in einer Anfrage mit mehreren
// Bildern, nach dem die schon geschriebenen Dateien weggeraeumt, ihre Bytes aber
// weiter zur Deckelung gezaehlt wurden.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { versuchsrouten, jpeg } = require('./helpers/versuchsrouten');

function mitVersuch(opts) {
  const r = versuchsrouten(opts);
  const id = Number(r.db.insertExperiment(r.database, { code: 'T-1', title: 'Testversuch' }));
  return { r, id };
}
const zeilen = (r) => r.database.prepare('SELECT COUNT(*) AS c FROM experiment_photos').get().c;

describe('POST /api/experiment-photos', () => {
  let r;
  let id;
  beforeEach(() => {
    ({ r, id } = mitVersuch());
  });
  afterEach(() => r.schliessen());

  it('nimmt Bilder an und zaehlt ihre Bytes zur Deckelung', async () => {
    const a = await r.anfrage('POST', '/api/experiment-photos', {
      experimentId: id,
      photos: [{ data_url: jpeg(300) }, { data_url: jpeg(500) }]
    });
    assert.equal(a.status, 200);
    assert.equal(a.json.ids.length, 2);
    assert.equal(zeilen(r), 2);
    assert.equal(r.dateien().length, 4, 'picture and thumbnail per photo');
    assert.equal(r.groesse(), 2 * 300 + 2 * 500);
  });

  it('antwortet 400 auf einen Eintrag, der kein Objekt ist', async () => {
    for (const eintrag of [null, 1, 'x', []]) {
      const a = await r.anfrage('POST', '/api/experiment-photos', { experimentId: id, photos: [eintrag] });
      assert.equal(a.status, 400, JSON.stringify(eintrag));
      assert.match(a.json.error, /every entry must be an object/);
    }
    assert.equal(zeilen(r), 0);
    assert.deepEqual(r.dateien(), []);
  });

  it('laesst nach einem kaputten zweiten Bild weder Dateien noch Bytes zurueck', async () => {
    const a = await r.anfrage('POST', '/api/experiment-photos', {
      experimentId: id,
      photos: [{ data_url: jpeg(400) }, { data_url: 'kein bild' }]
    });
    assert.equal(a.status, 400);
    assert.match(a.json.error, /^photo: /);
    assert.equal(zeilen(r), 0);
    assert.deepEqual(r.dateien(), []);
    assert.equal(r.groesse(), 0, 'the bytes of the removed files are no longer counted');
  });
});

describe('POST /api/experiment-photos: Gefaess des Fotos', () => {
  let r;
  let id;
  beforeEach(() => {
    ({ r, id } = mitVersuch());
  });
  afterEach(() => r.schliessen());

  it('nimmt nur ein Gefaess desselben Versuchs, und kein entferntes', async () => {
    const anderer = Number(r.db.insertExperiment(r.database, { code: 'T-2', title: 'Anderer Versuch' }));
    const fremd = Number(r.db.insertExperimentRun(r.database, { experimentId: anderer, code: 'X-1' }));
    const weg = Number(r.db.insertExperimentRun(r.database, { experimentId: id, code: 'A-9' }));
    r.db.removeExperimentRun(r.database, weg);
    const eigen = Number(r.db.insertExperimentRun(r.database, { experimentId: id, code: 'A-1' }));
    const faelle = [
      [fremd, /does not belong/],
      [weg, /is removed/],
      [99999, /does not belong/],
      ['3', /must be a number/],
      [1.5, /whole number/]
    ];
    for (const [runId, grund] of faelle) {
      const a = await r.anfrage('POST', '/api/experiment-photos', {
        experimentId: id,
        runId,
        photos: [{ data_url: jpeg(200) }]
      });
      assert.equal(a.status, 400, String(runId));
      assert.match(a.json.error, grund);
    }
    assert.equal(zeilen(r), 0);
    assert.deepEqual(r.dateien(), []);
    const ok = await r.anfrage('POST', '/api/experiment-photos', {
      experimentId: id,
      runId: eigen,
      photos: [{ data_url: jpeg(200) }]
    });
    assert.equal(ok.status, 200);
  });
});

describe('Foto endgueltig loeschen', () => {
  const ADMIN = { user_id: 8, username: 'chef', role: 'admin' };
  let r;
  let id;
  beforeEach(() => {
    ({ r, id } = mitVersuch({
      benutzer: [
        { id: 7, username: 'anna', role: 'user' },
        { id: 8, username: 'chef', role: 'admin' }
      ]
    }));
  });
  afterEach(() => r.schliessen());
  const hochladen = async () => {
    const a = await r.anfrage('POST', '/api/experiment-photos', {
      experimentId: id,
      photos: [{ data_url: jpeg(700) }]
    });
    return a.json.ids[0];
  };

  it('ist einem Admin vorbehalten und nur fuer ein entferntes Foto', async () => {
    const foto = await hochladen();
    assert.equal((await r.anfrage('POST', '/api/experiment-photos/' + foto + '/purge')).status, 403);
    const a = await r.anfrage('POST', '/api/experiment-photos/' + foto + '/purge', undefined, ADMIN);
    assert.equal(a.status, 400);
    assert.match(a.json.error, /must be removed/);
    assert.equal(r.dateien().length, 2);
  });

  it('loescht die Dateien, laesst einen Grabstein und haelt es im Verlauf fest', async () => {
    const foto = await hochladen();
    const zeile = r.database.prepare('SELECT uuid, sha256 FROM experiment_photos WHERE id=?').get(foto);
    await r.anfrage('DELETE', '/api/experiment-photos/' + foto);
    const vorher = r.groesse();
    const a = await r.anfrage('POST', '/api/experiment-photos/' + foto + '/purge', undefined, ADMIN);
    assert.equal(a.status, 200);
    assert.deepEqual(a.json, { ok: true });
    assert.deepEqual(r.dateien(), []);
    assert.equal(r.groesse(), vorher - 1400, 'the freed bytes leave the cap');
    const grab = r.database
      .prepare('SELECT rel_path, thumb_path, removed_at FROM experiment_photos WHERE id=?')
      .get(foto);
    assert.deepEqual([grab.rel_path, grab.thumb_path], ['', '']);
    assert.ok(grab.removed_at);
    const eintrag = r.database
      .prepare("SELECT username, old_value FROM lab_history WHERE entity='photo' AND entity_id=? AND action='purge'")
      .get(foto);
    assert.equal(eintrag.username, 'chef');
    assert.equal(JSON.parse(eintrag.old_value).sha256, zeile.sha256);
    const bild = await r.anfrage('GET', '/api/experiments/' + id + '/photos/' + zeile.uuid);
    assert.equal(bild.status, 404);
    const zurueck = await r.anfrage('POST', '/api/experiment-photos/' + foto + '/restore');
    assert.equal(zurueck.status, 400);
    assert.match(zurueck.json.error, /deleted for good/);
    const liste = r.db.listExperiments(r.database).find((v) => v.id === id);
    assert.equal(liste.removedPhotos[0].purged, true);
  });

  it('sagt es, wenn eine Datei liegen bleibt, und nennt sie im Log', async () => {
    const foto = await hochladen();
    await r.anfrage('DELETE', '/api/experiment-photos/' + foto);
    // Ein Ordner, wo die Vorschau liegen sollte: den loescht unlink nicht,
    // gleich unter welchem Benutzer der Test laeuft.
    const { thumb_path } = r.database.prepare('SELECT thumb_path FROM experiment_photos WHERE id=?').get(foto);
    const vorschau = path.join(r.DIR, 'data', thumb_path);
    fs.rmSync(vorschau);
    fs.mkdirSync(vorschau);
    const a = await r.anfrage('POST', '/api/experiment-photos/' + foto + '/purge', undefined, ADMIN);
    assert.equal(a.status, 200);
    assert.equal(a.json.leftoverFiles, 1);
    const eintrag = r.logs.find((l) => l.msg === 'Photo purge left files on disk');
    assert.equal(eintrag.level, 'error');
    assert.deepEqual(eintrag.meta, { photoId: foto, files: [thumb_path] });
  });
});

describe('GET /api/experiments/:id/photos/:uuid', () => {
  let r;
  let id;
  beforeEach(() => {
    ({ r, id } = mitVersuch({
      benutzer: [
        { id: 7, username: 'anna', role: 'user' },
        { id: 8, username: 'chef', role: 'admin' }
      ]
    }));
  });
  afterEach(() => r.schliessen());

  it('fragt jedes Mal nach, und die Antwort auf ein bekanntes Bild ist leer', async () => {
    const foto = (
      await r.anfrage('POST', '/api/experiment-photos', { experimentId: id, photos: [{ data_url: jpeg(700) }] })
    ).json.ids[0];
    const { uuid } = r.database.prepare('SELECT uuid FROM experiment_photos WHERE id=?').get(foto);
    const url = '/api/experiments/' + id + '/photos/' + uuid;
    const bild = await r.anfrage('GET', url);
    assert.equal(bild.status, 200);
    assert.equal(bild.headers['Cache-Control'], 'private, no-cache');
    assert.equal(bild.roh.length, 700);
    const vorschau = await r.anfrage('GET', url + '?thumb=1');
    assert.notEqual(vorschau.headers.ETag, bild.headers.ETag, 'picture and thumbnail are told apart');
    const wieder = await r.anfrage('GET', url, undefined, undefined, { 'if-none-match': bild.headers.ETag });
    assert.equal(wieder.status, 304);
    assert.equal(wieder.roh.length, 0);
    // Endgueltig geloescht: die Frage des Browsers bekommt kein 304 mehr.
    await r.anfrage('DELETE', '/api/experiment-photos/' + foto);
    await r.anfrage('POST', '/api/experiment-photos/' + foto + '/purge', undefined, {
      user_id: 8,
      username: 'chef',
      role: 'admin'
    });
    const weg = await r.anfrage('GET', url, undefined, undefined, { 'if-none-match': bild.headers.ETag });
    assert.equal(weg.status, 404);
  });
});

describe('POST /api/experiment-photos bei voller Ablage', () => {
  it('antwortet 507 und zieht die Bytes der weggeraeumten Dateien wieder ab', async () => {
    // Das erste Bild passt, das zweite nicht mehr: je 1000 Bytes Bild und
    // Vorschau, Deckel bei 3000.
    const { r, id } = mitVersuch({ deckel: 3000 });
    try {
      const a = await r.anfrage('POST', '/api/experiment-photos', {
        experimentId: id,
        photos: [{ data_url: jpeg(1000) }, { data_url: jpeg(1000) }]
      });
      assert.equal(a.status, 507);
      assert.match(a.json.error, /directory full/);
      assert.equal(zeilen(r), 0);
      assert.deepEqual(r.dateien(), []);
      assert.equal(r.groesse(), 0);
      // Und danach passt ein Bild wieder, statt bis zur naechsten Zaehlung
      // abgewiesen zu werden.
      const b = await r.anfrage('POST', '/api/experiment-photos', {
        experimentId: id,
        photos: [{ data_url: jpeg(1000) }]
      });
      assert.equal(b.status, 200);
    } finally {
      r.schliessen();
    }
  });
});
