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
