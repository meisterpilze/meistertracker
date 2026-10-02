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
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');
const { kontaminationsrouten, jpeg } = require('./helpers/kontaminationsrouten');

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

// Die Fotos zaehlen gegen die Obergrenze des Fotoordners. savePhotoToDisk()
// rechnet jede Datei in einen zwischengespeicherten Zaehler ein, und neu
// gezaehlt wird nur alle fuenf Minuten. Wer eine Datei loescht, muss sie dort
// wieder abziehen, sonst zaehlt sie bis dahin weiter, und nahe der Grenze
// bekommt ein neues Foto ein 507 fuer Platz, der schon frei ist.
//
// server.js lauscht schon beim require. _discardPhotoFiles() kommt deshalb aus
// der Quelle und laeuft gegen einen eigenen Zaehler statt gegen den des
// Servers. Zurueck kommen der Zaehler danach und die Dateien, die noch da sind.
const SERVER = quelle('server.js');

function verwerfen(dateien, zaehler) {
  return new Function(
    'fs',
    'dateien',
    '_photoDirSizeBytes',
    `
    ${hebeFunktion('_discardPhotoFiles', SERVER)}
    const uebrig = _discardPhotoFiles(dateien);
    return { zaehler: _photoDirSizeBytes, uebrig };
  `
  )(fs, dateien, zaehler);
}

// Der Text einer Route in server.js, von `anfang` bis vor `ende`.
function route(anfang, ende) {
  const a = SERVER.indexOf(anfang);
  assert.ok(a > 0, anfang + ' nicht in server.js gefunden — der Test muss mitgeführt werden');
  const b = SERVER.indexOf(ende, a);
  assert.ok(b > a, ende + ' nicht hinter ' + anfang + ' gefunden — der Test muss mitgeführt werden');
  return SERVER.slice(a, b);
}

describe('Aufraeumen, wenn die Meldung doch scheitert', () => {
  // Die Fotos liegen schon auf der Platte, wenn die Transaktion zurueckrollt.
  const aufraeumen = (dateien, zaehler) => verwerfen(dateien, zaehler).zaehler;

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

describe('Loeschen eines Berichts', () => {
  // DELETE /api/contamination-reports/:id loescht die Zeilen und dann die
  // Dateien, auf die sie zeigten. Das tat es mit einem eigenen unlink, und die
  // Bytes blieben im Zaehler.
  const loeschroute = () => route('const contamDeleteMatch', '// -- Harvests --');

  it('raeumt die Dateien ueber _discardPhotoFiles ab, nicht mit einem eigenen unlink', () => {
    const r = loeschroute();
    assert.match(r, /_discardPhotoFiles\(/);
    assert.doesNotMatch(r, /unlinkSync|rmSync/);
  });

  it('loescht nur, was unter data/photos liegt', () => {
    // Sonst liesse eine Zeile, die auf etwas anderes zeigt, den Server eine
    // fremde Datei loeschen.
    assert.ok(loeschroute().includes("abs.startsWith(path.join(DIR, 'data', 'photos') + path.sep)"));
  });

  it('zaehlt eine Datei weiter, die sich nicht loeschen laesst, und nennt sie', () => {
    // Ein Ordner steht fuer eine solche Datei: unlink scheitert an ihm mit
    // EISDIR oder EPERM, nicht mit ENOENT. Was noch auf der Platte liegt,
    // belegt weiter Platz. Die Route schreibt es ins Log, denn nach dem
    // Loeschen nennt es keine Zeile mehr.
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-kontam-fotos-'));
    try {
      const foto = path.join(ordner, 'b.jpg');
      const klemmt = path.join(ordner, 'b_thumb.jpg');
      fs.writeFileSync(foto, Buffer.alloc(800));
      fs.mkdirSync(klemmt);
      const { zaehler, uebrig } = verwerfen([foto, klemmt], 5000);
      assert.equal(zaehler, 4200, 'nur die geloeschte Datei verlaesst den Zaehler');
      assert.deepEqual(uebrig, [klemmt]);
      assert.equal(fs.existsSync(foto), false);
    } finally {
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });

  describe('gegen die Route selbst', () => {
    // kontaminationsrouten() laesst den Abschnitt aus server.js gegen eine
    // Datenbank und eine Fotoablage in einem Temp-Ordner laufen, mit einem
    // eigenen Zaehler.
    let r;
    beforeEach(() => {
      r = kontaminationsrouten();
    });
    afterEach(() => r.schliessen());

    // Ein Bericht ueber einen Beutel mit einem Foto: 700 Bytes Bild, 90 Bytes
    // Vorschau.
    async function melden() {
      const a = await r.anfrage('POST', '/api/contamination-reports', {
        type_id: r.db.listContaminationTypes(r.database)[0].id,
        severity: 'minor',
        bag_id: 'XY-0101-01',
        batch_id: 'XY-0101',
        photos: [{ data_url: jpeg(700), thumb_data_url: jpeg(90) }]
      });
      assert.equal(a.status, 200);
      const foto = r.database
        .prepare('SELECT rel_path, thumb_path FROM contamination_photos WHERE id=?')
        .get(a.json.photoIds[0]);
      return { id: a.json.id, foto };
    }
    const loeschen = (id) => r.anfrage('DELETE', '/api/contamination-reports/' + id);

    it('gibt die Bytes von Bild und Vorschau dem Zaehler zurueck', async () => {
      const { id } = await melden();
      assert.equal(r.groesse(), 790);
      assert.equal((await loeschen(id)).status, 200);
      assert.equal(r.groesse(), 0, 'die geloeschten Dateien zaehlen weiter gegen die Obergrenze');
      assert.deepEqual(r.dateien(), []);
    });

    it('laesst eine Datei ausserhalb von data/photos stehen, auch wenn eine Zeile auf sie zeigt', async () => {
      const { id } = await melden();
      const draussen = path.join(r.DIR, 'draussen.jpg');
      fs.writeFileSync(draussen, BILD);
      const hinaus = 'photos/../../draussen.jpg';
      r.db.addContaminationPhoto(r.database, id, { ...kopie(id, BILD), rel_path: hinaus, thumb_path: hinaus });
      assert.equal((await loeschen(id)).status, 200);
      assert.equal(fs.existsSync(draussen), true, 'die Route hat eine Datei ausserhalb der Ablage geloescht');
      assert.equal(r.groesse(), 0);
    });

    it('zaehlt weiter, was sich nicht loeschen liess, und nennt es im Log', async () => {
      const { id, foto } = await melden();
      // Ein Ordner an der Stelle der Vorschau: unlink scheitert an ihm.
      const vorschau = path.join(r.DIR, 'data', foto.thumb_path);
      fs.rmSync(vorschau);
      fs.mkdirSync(vorschau);
      assert.equal((await loeschen(id)).status, 200);
      assert.equal(r.groesse(), 90, 'nur das Bild ist weg, die Vorschau zaehlt weiter');
      const eintrag = r.logs.find((l) => l.msg === 'Contamination report delete left photo files on disk');
      assert.ok(eintrag, 'kein Log-Eintrag fuer die Datei, die liegen blieb');
      assert.equal(eintrag.level, 'warn');
      assert.deepEqual(eintrag.meta.files, [path.normalize(foto.thumb_path)]);
    });
  });
});

describe('Eine Meldung mit Foto, wenn die Platte knapp wird', () => {
  // PHOTO_MIN_FREE_GB haelt Platz fuer die Originale der Versuchsfotos frei,
  // 25 MB das Stueck. Ein Foto hier hat ein paar hundert KB, und die Meldung
  // scheiterte an derselben Reserve: unter 2 GB frei liess sich keine
  // Kontamination mit Foto mehr melden.
  const GB = 1024 * 1024 * 1024;
  const statfsSync = fs.statfsSync;
  let r;
  beforeEach(() => {
    r = kontaminationsrouten({ frei: 2 * GB });
  });
  afterEach(() => {
    fs.statfsSync = statfsSync;
    r.schliessen();
  });
  const platte = (frei) => {
    fs.statfsSync = () => ({ bavail: frei / 4096, bsize: 4096 });
  };
  const melden = () =>
    r.anfrage('POST', '/api/contamination-reports', {
      type_id: r.db.listContaminationTypes(r.database)[0].id,
      severity: 'minor',
      bag_id: 'XY-0101-01',
      batch_id: 'XY-0101',
      photos: [{ data_url: jpeg(700), thumb_data_url: jpeg(90) }]
    });

  it('geht unter der Reserve der Originale noch durch', async () => {
    platte(1 * GB);
    const a = await melden();
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(a.json.photoIds.length, 1);
  });

  it('antwortet 507 erst an der Grenze, die der Datenbank ihren Platz laesst', async () => {
    platte(100 * 1024 * 1024);
    const a = await melden();
    assert.equal(a.status, 507);
    assert.match(a.json.error, /256 MB must stay free/);
    assert.equal(r.groesse(), 0);
  });
});

describe('Jeder Weg, der Fotodateien loescht, gibt ihre Bytes zurueck', () => {
  // Die Meldung ist nicht der einzige Weg, auf dem server.js Fotodateien
  // loescht. Wie sich die Versuchsfotos dabei verhalten, prueft
  // versuchsfotos-route.test.js gegen die Route selbst; hier steht, dass alle
  // ueber denselben Helfer gehen.
  it('der Rueckbau eines gescheiterten Versuchsfoto-Uploads', () => {
    const r = route("url === '/api/experiment-photos'", 'const fotoWegTreffer');
    assert.match(r, /_discardPhotoFiles\(geschrieben\)/);
    assert.doesNotMatch(r, /unlinkSync|rmSync/);
  });

  it('das endgueltige Loeschen eines entfernten Versuchsfotos, nur unter data/photos', () => {
    const r = route('const fotoEndgueltigTreffer', 'const fotoZurueckTreffer');
    assert.match(r, /_discardPhotoFiles\(/);
    assert.ok(r.includes("abs.startsWith(path.join(DIR, 'data', 'photos') + path.sep)"));
    assert.doesNotMatch(r, /unlinkSync|rmSync/);
  });

  it('kein Abschnitt mit Fotorouten loescht eine Datei an _discardPhotoFiles vorbei', () => {
    // Eine neue Route, die Fotodateien selbst loescht, soll hier auffallen und
    // nicht erst an einem Zaehler, der fuenf Minuten lang zu viel zaehlt.
    for (const [anfang, ende] of [
      ['// -- Contamination reports --', '// -- Harvests --'],
      ['// ── Versuche und ihre Ansaetze', '// ── Vorhaben-Texte']
    ]) {
      assert.doesNotMatch(route(anfang, ende), /unlinkSync|\.unlink\(|rmSync|\.rm\(/, anfang);
    }
  });
});
