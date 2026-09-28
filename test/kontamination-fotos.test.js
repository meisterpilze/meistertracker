'use strict';
// Ein Foto, mehrere Beutel.
//
// Ein Kontaminationsbericht kann eine ganze Reihe Beutel abdecken, und jeder
// Beutel bekommt seine eigene Kopie der Fotos: eine eigene Datei im Ordner
// seines Berichts, damit das Loeschen des einen Berichts dem anderen nichts
// wegnimmt. Die Kopien haben dieselben Bytes und damit dieselbe sha256.
//
// Ein eindeutiger Index auf sha256 liess deshalb jede Meldung ueber zwei oder
// mehr Beutel mit Foto scheitern. Die zweite Kopie verletzte ihn, die
// Transaktion rollte zurueck, und gespeichert war nichts — weder die Berichte
// noch die Fotos, nur ein "Internal server error" im Formular.
//
// Die Beutel, Chargen und Bilder hier sind ausgedacht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');

// Die Migration, die den eindeutigen Index ersetzt. Wird sie umnummeriert, muss
// die Zahl hier mit.
const INDEX_MIGRATION = 91;

// Ein ausgedachtes Bild. Nur die ersten drei Bytes muessen stimmen, damit der
// Server es als JPEG annaehme; mehr schaut sich hier niemand an.
function bild(inhalt) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(inhalt)]);
}
const BILD = bild('ausgedachtes Bild');

function tempDbPfad() {
  return path.join(os.tmpdir(), 'mt_kontam_fotos_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
}

function wegraeumen(p) {
  for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
}

// Die Zeile, die savePhotoToDisk() fuer einen Bericht liefert: eigene uuid und
// eigener Ordner, aber aus denselben Bytes dieselbe Pruefsumme.
function kopie(berichtId, bild) {
  const uuid = crypto.randomUUID();
  return {
    uuid,
    rel_path: `photos/2026/01/${berichtId}/${uuid}.jpg`,
    thumb_path: `photos/2026/01/${berichtId}/${uuid}_thumb.jpg`,
    width: 1280,
    height: 960,
    bytes: bild.length,
    sha256: crypto.createHash('sha256').update(bild).digest('hex'),
    uploaded_at: new Date().toISOString(),
    uploaded_by: null
  };
}

// Was POST /api/contamination-reports mit einem Rumpf macht, der mehrere Beutel
// nennt: in einer Transaktion je Beutel ein Bericht, und je Bericht eine eigene
// Kopie jedes Fotos. Scheitert eine Zeile, rollt alles zurueck.
function melden(d, beutel, bilder) {
  const typeId = db.listContaminationTypes(d)[0].id;
  const ids = [];
  d.exec('BEGIN');
  try {
    for (const b of beutel) {
      const { id } = db.createContaminationReport(d, {
        type_id: typeId,
        severity: 'minor',
        bag_id: b,
        batch_id: 'XY-0101',
        report_uuid: crypto.randomUUID()
      });
      for (const bild of bilder) db.addContaminationPhoto(d, id, kopie(id, bild));
      ids.push(id);
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return ids;
}

function shaIndex(d) {
  return d
    .prepare("SELECT * FROM pragma_index_list('contamination_photos') WHERE name = ?")
    .get('idx_contam_photos_sha');
}

describe('Fotos an einer Meldung ueber mehrere Beutel', () => {
  let p, d;
  before(() => {
    p = tempDbPfad();
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    wegraeumen(p);
  });

  it('speichert eine Meldung ueber drei Beutel mit einem Foto, und jeder Bericht hat seins', () => {
    const beutel = ['XY-0101-01', 'XY-0101-02', 'XY-0101-03'];
    const ids = melden(d, beutel, [BILD]);

    assert.equal(ids.length, 3);
    ids.forEach((id, i) => {
      const bericht = db.getContaminationReportById(d, id);
      assert.equal(bericht.bag_id, beutel[i]);
      assert.equal(bericht.photos.length, 1, `der Bericht zu ${beutel[i]} hat sein Foto verloren`);
      // Die eigene Kopie im eigenen Ordner, nicht die Datei des Nachbarn: die
      // Loeschroute haengt ab, worauf die Zeilen des Berichts zeigen.
      assert.ok(bericht.photos[0].rel_path.includes(`/${id}/`), bericht.photos[0].rel_path);
    });
    const shas = d
      .prepare(`SELECT DISTINCT sha256 FROM contamination_photos WHERE report_id IN (${ids.join(',')})`)
      .all();
    assert.equal(shas.length, 1, 'drei Kopien desselben Bildes, also eine Pruefsumme');
  });

  it('nimmt dasselbe Bild in einem spaeteren Bericht wieder an', () => {
    // Ein eigenes Bild, damit der Fall nicht davon abhaengt, ob der Test davor
    // etwas gespeichert hat.
    const wieder = bild('ein Bild fuer zwei Berichte');
    const [erster] = melden(d, ['XY-0101-04'], [wieder]);
    const [zweiter] = melden(d, ['XY-0101-04'], [wieder]);
    assert.equal(db.getContaminationReportById(d, erster).photos.length, 1);
    assert.equal(db.getContaminationReportById(d, zweiter).photos.length, 1);
  });

  it('verliert die Meldung nicht, wenn im Formular dasselbe Bild zweimal ausgewaehlt wurde', () => {
    // Deshalb ist der Index auch je Bericht nicht eindeutig: die doppelte
    // Kachel ist harmlos, eine verlorene Meldung nicht.
    const [id] = melden(d, ['XY-0101-05'], [BILD, BILD]);
    assert.equal(db.getContaminationReportById(d, id).photos.length, 2);
  });

  it('behaelt den Index auf sha256, nur nicht eindeutig', () => {
    const idx = shaIndex(d);
    assert.ok(idx, 'idx_contam_photos_sha fehlt');
    assert.equal(idx.unique, 0);
  });
});

describe('eine Datenbank von vor der Korrektur', () => {
  it('verliert beim naechsten Start den eindeutigen Index, und die Meldung geht durch', () => {
    // Der Zustand auf einem laufenden Server: v36 hat den eindeutigen Index
    // angelegt, die Korrektur ist noch nicht gelaufen.
    const p = tempDbPfad();
    try {
      const alt = db.openDb(p);
      try {
        alt.exec('DROP INDEX idx_contam_photos_sha');
        alt.exec('CREATE UNIQUE INDEX idx_contam_photos_sha ON contamination_photos(sha256)');
        const weg = alt.prepare('DELETE FROM schema_version WHERE version = ?').run(INDEX_MIGRATION);
        assert.equal(weg.changes, 1, `Migration v${INDEX_MIGRATION} nicht gefunden — umnummeriert?`);
        // Der Fehler, den diese Datei festhaelt, in seiner alten Form.
        assert.throws(() => melden(alt, ['XY-0101-06', 'XY-0101-07'], [BILD]), /UNIQUE constraint failed/);
      } finally {
        alt.close();
      }

      const neu = db.openDb(p);
      try {
        assert.equal(shaIndex(neu).unique, 0);
        const ids = melden(neu, ['XY-0101-06', 'XY-0101-07'], [BILD]);
        for (const id of ids) assert.equal(db.getContaminationReportById(neu, id).photos.length, 1);
      } finally {
        neu.close();
      }
    } finally {
      wegraeumen(p);
    }
  });
});

describe('Aufraeumen, wenn die Meldung doch scheitert', () => {
  // Die Fotos liegen schon auf der Platte, wenn die Transaktion zurueckrollt.
  // savePhotoToDisk() hat sie in den Zaehler fuer die Obergrenze des
  // Fotoordners eingerechnet; wer sie loescht, muss sie dort wieder abziehen.
  //
  // server.js lauscht schon beim require. Die Funktion kommt deshalb aus der
  // Quelle und laeuft gegen einen eigenen Zaehler statt gegen den des Servers.
  const SERVER = quelle('server.js');

  function aufraeumen(dateien, zaehler) {
    return new Function(
      'fs',
      'dateien',
      '_photoDirSizeBytes',
      `
      ${hebeFunktion('_discardPhotoFiles', SERVER)}
      _discardPhotoFiles(dateien);
      return _photoDirSizeBytes;
    `
    )(fs, dateien, zaehler);
  }

  it('loescht die geschriebenen Dateien und gibt ihre Bytes dem Zaehler zurueck', () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-kontam-fotos-'));
    try {
      const foto = path.join(ordner, 'a.jpg');
      const vorschau = path.join(ordner, 'a_thumb.jpg');
      fs.writeFileSync(foto, Buffer.alloc(1000));
      fs.writeFileSync(vorschau, Buffer.alloc(300));
      // 5000 Bytes gezaehlt, 1300 davon sind die beiden Dateien dieser Meldung.
      assert.equal(aufraeumen([foto, vorschau], 5000), 3700);
      assert.equal(fs.existsSync(foto), false);
      assert.equal(fs.existsSync(vorschau), false);
    } finally {
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });

  it('zieht fuer eine Datei, die es nicht gibt, nichts ab', () => {
    const fehlt = path.join(os.tmpdir(), 'mt-kontam-fehlt-' + Date.now() + '.jpg');
    assert.equal(aufraeumen([fehlt], 5000), 5000);
  });

  it('ist der Weg, auf dem die Meldung ihre Dateien wieder abraeumt', () => {
    assert.match(SERVER, /_discardPhotoFiles\(writtenPhotoFiles\)/);
  });
});
