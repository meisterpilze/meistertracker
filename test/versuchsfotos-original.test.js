'use strict';
// Das Original zu einem Versuchsfoto: PUT /api/experiment-photos/:id/original.
//
// Was es tun muss: das JPEG in voller Aufloesung neben das verkleinerte Bild
// legen, ohne Standort, mit der Pruefsumme der gespeicherten Datei, genau einmal
// je Foto, und es wieder hergeben. Und was es nicht darf: ein Original mit
// Adresse speichern, eine Platte vollschreiben, Dateien liegen lassen, wenn
// etwas schiefgeht.
//
// Alle Inhalte hier sind ausgedacht; die Koordinaten im Testbild zeigen auf
// keinen bestimmten Ort.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { versuchsrouten, jpeg: dataUrl } = require('./helpers/versuchsrouten');
const { tiff, app1, exif, xmp, sof, jpeg } = require('./helpers/jpeg-bau');

const MIT_ORT = () =>
  jpeg(exif(true), xmp('<x:xmpmeta><rdf:Description exif:GPSLatitude="12,34.5N"/></x:xmpmeta>'), sof(4032, 3024));

async function fotoAnlegen(r, experimentId) {
  const a = await r.anfrage('POST', '/api/experiment-photos', { experimentId, photos: [{ data_url: dataUrl(300) }] });
  assert.equal(a.status, 200);
  return a.json.ids[0];
}

describe('PUT /api/experiment-photos/:id/original', () => {
  let r;
  let versuch;
  let foto;
  beforeEach(async () => {
    r = versuchsrouten();
    versuch = Number(r.db.insertExperiment(r.database, { code: 'T-1', title: 'Testversuch' }));
    foto = await fotoAnlegen(r, versuch);
  });
  afterEach(() => r.schliessen());

  const zeile = () => r.database.prepare('SELECT * FROM experiment_photos WHERE id=?').get(foto);

  it('legt das Original ohne Standort neben das Foto, mit der Pruefsumme der gespeicherten Datei', async () => {
    const roh = MIT_ORT();
    const a = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', roh);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    // Stored 4032 × 3024 with orientation 6: recorded as it is shown, upright.
    assert.equal(a.json.original.width, 3024);
    assert.equal(a.json.original.height, 4032);
    assert.equal(a.json.original.locationRemoved, true);

    const z = zeile();
    assert.equal(z.original_path, path.posix.join(path.posix.dirname(z.rel_path), z.uuid + '_orig.jpg'));
    const gespeichert = fs.readFileSync(path.join(r.DIR, 'data', z.original_path));
    assert.equal(gespeichert.length, roh.length, 'overwritten in place, not cut');
    assert.equal(z.original_sha256, crypto.createHash('sha256').update(gespeichert).digest('hex'));
    assert.equal(z.original_bytes, gespeichert.length);
    assert.equal(a.json.original.sha256, z.original_sha256);
    const text = gespeichert.toString('latin1');
    assert.ok(!text.includes('12,34.5N'), 'the XMP location is gone');
    const breite = Buffer.alloc(4);
    breite.writeUInt32LE(2100);
    assert.equal(gespeichert.indexOf(breite), -1, 'the EXIF coordinates are gone');
    assert.notEqual(roh.indexOf(breite), -1, 'and they were there before');
  });

  it('schreibt den Verlauf und zeigt das Original in Liste und Laborbuch', async () => {
    await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT());
    const eintrag = r.database
      .prepare("SELECT * FROM lab_history WHERE entity='photo' AND action='original' AND entity_id=?")
      .get(foto);
    assert.ok(eintrag, 'one history entry for the original');
    assert.equal(JSON.parse(eintrag.new_value).original.sha256, zeile().original_sha256);
    assert.equal(eintrag.username, 'anna');

    const liste = r.db.listExperiments(r.database).find((v) => v.id === versuch);
    assert.deepEqual(Object.keys(liste.photos[0].original).sort(), ['bytes', 'height', 'sha256', 'width']);
    const buch = r.db.labBook(r.database, { experimentId: versuch });
    assert.equal(buch.experiments[0].photos[0].original.sha256, zeile().original_sha256);
  });

  it('nimmt ein Original nur einmal', async () => {
    assert.equal((await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT())).status, 200);
    const zweites = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', jpeg(sof(8, 8)));
    assert.equal(zweites.status, 409);
    assert.match(zweites.json.error, /already has its original/);
  });

  it('sagt zum selben Original noch einmal, dass es da ist', async () => {
    // Die Antwort auf das erste ging unterwegs verloren; die Wiederholung
    // schickt dieselbe Datei.
    const erstes = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT());
    const nochmal = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT());
    assert.equal(nochmal.status, 200);
    assert.equal(nochmal.json.original.already, true);
    assert.equal(nochmal.json.original.sha256, erstes.json.original.sha256);
    assert.equal(r.dateien().filter((n) => n.endsWith('_orig.jpg')).length, 1, 'nothing written twice');
  });

  it('nimmt nur JPEG, und nur zu einem Foto, das in der Liste steht', async () => {
    let a = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', Buffer.from('\x89PNG....'));
    assert.equal(a.status, 415);
    a = await r.anfrage('PUT', '/api/experiment-photos/99999/original', MIT_ORT());
    assert.equal(a.status, 404);
    r.db.removeExperimentPhoto(r.database, foto);
    a = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT());
    assert.equal(a.status, 409);
    assert.equal(r.dateien().filter((n) => n.endsWith('_orig.jpg')).length, 0);
  });

  it('speichert ein Original mit unlesbarem EXIF ohne dieses EXIF, statt es abzulehnen', async () => {
    const { b } = tiff(true);
    b.writeUInt32LE(60000, 30);
    const kaputt = jpeg(app1(Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), b])), sof(10, 10));
    const a = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', kaputt);
    assert.equal(a.status, 200);
    assert.equal(a.json.original.locationRemoved, true);
    const gespeichert = fs.readFileSync(path.join(r.DIR, 'data', zeile().original_path));
    const breite = Buffer.alloc(4);
    breite.writeUInt32LE(2100);
    assert.equal(gespeichert.indexOf(breite), -1, 'no coordinates in what was stored');
  });

  it('nimmt das Original nur von dem, der das Foto hochgeladen hat, oder von einem Admin', async () => {
    const fremd = { user_id: 8, username: 'ben', role: 'user' };
    let a = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT(), fremd);
    assert.equal(a.status, 403);
    assert.equal(zeile().original_path, null);
    a = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT(), {
      user_id: 1,
      username: 'admin',
      role: 'admin'
    });
    assert.equal(a.status, 200);
  });

  it('nimmt kein Bild als Original, das nicht zum Foto passt', async () => {
    // Ein Hochformatfoto, 960 × 1280 verkleinert.
    const a = await r.anfrage('POST', '/api/experiment-photos', {
      experimentId: versuch,
      photos: [{ data_url: dataUrl(300), width: 960, height: 1280 }]
    });
    const hoch = a.json.ids[0];
    const quer = await r.anfrage('PUT', '/api/experiment-photos/' + hoch + '/original', jpeg(sof(4000, 1000)));
    assert.equal(quer.status, 422);
    assert.match(quer.json.error, /does not match/);
    // Das echte Original: 4032 × 3024 gespeichert, Ausrichtung 6, also aufrecht 3024 × 4032.
    const echt = await r.anfrage('PUT', '/api/experiment-photos/' + hoch + '/original', MIT_ORT());
    assert.equal(echt.status, 200);
  });

  it('laesst ein Hochladen fallen, von dem nichts mehr kommt', async () => {
    const a = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT(), undefined, undefined, {
      reisstAb: true
    });
    assert.equal(a.req.timeoutMs, 60 * 1000);
    assert.equal(a.req.destroyed, true);
    assert.equal(zeile().original_path, null);
  });

  it('gibt das Original wieder her, und sagt 404 bei einem Foto ohne', async () => {
    let a = await r.anfrage('GET', '/api/experiments/' + versuch + '/photos/' + zeile().uuid + '?original=1');
    assert.equal(a.status, 404);
    await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT());
    a = await r.anfrage('GET', '/api/experiments/' + versuch + '/photos/' + zeile().uuid + '?original=1');
    assert.equal(a.status, 200);
    assert.ok(a.roh.equals(fs.readFileSync(path.join(r.DIR, 'data', zeile().original_path))));
    assert.equal(a.headers.ETag, '"' + zeile().uuid + '-o"');
    const klein = await r.anfrage('GET', '/api/experiments/' + versuch + '/photos/' + zeile().uuid);
    assert.notEqual(klein.headers.ETag, a.headers.ETag, 'the small picture and the original are cached apart');
  });

  it('loescht das Original mit, wenn ein Admin das Foto endgueltig loescht', async () => {
    await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT());
    const datei = path.join(r.DIR, 'data', zeile().original_path);
    assert.ok(fs.existsSync(datei));
    r.db.removeExperimentPhoto(r.database, foto);
    const a = await r.anfrage('POST', '/api/experiment-photos/' + foto + '/purge', undefined, {
      user_id: 1,
      username: 'admin',
      role: 'admin'
    });
    assert.equal(a.status, 200);
    assert.equal(fs.existsSync(datei), false);
    assert.equal(zeile().original_path, null);
    assert.ok(zeile().original_sha256, 'the checksum stays as the record of what there was');
  });
});

describe('Originale, die keine Zeile kennt', () => {
  let r;
  let versuch;
  let foto;
  beforeEach(async () => {
    r = versuchsrouten();
    versuch = Number(r.db.insertExperiment(r.database, { code: 'T-1', title: 'Testversuch' }));
    foto = await fotoAnlegen(r, versuch);
  });
  afterEach(() => r.schliessen());
  const zeile = () => r.database.prepare('SELECT * FROM experiment_photos WHERE id=?').get(foto);

  it('laesst keine halbe Datei liegen, wenn das Schreiben abbricht', async () => {
    const writeFileSync = fs.writeFileSync;
    fs.writeFileSync = (f, d, ...rest) => {
      if (String(f).endsWith('_orig.jpg')) {
        writeFileSync(f, d.subarray(0, 10));
        throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      }
      return writeFileSync(f, d, ...rest);
    };
    const vorher = r.groesse();
    let a;
    try {
      a = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT());
    } finally {
      fs.writeFileSync = writeFileSync;
    }
    assert.equal(a.status, 500);
    assert.equal(r.dateien().filter((n) => n.endsWith('_orig.jpg')).length, 0);
    assert.equal(r.groesse(), vorher, 'the folder counts what is on disk, no more and no less');
  });

  it('loescht beim endgueltigen Loeschen auch ein Original, das die Zeile nicht nennt', async () => {
    const z = zeile();
    const verwaist = path.join(r.DIR, 'data', z.rel_path.replace(/\.jpg$/, '_orig.jpg'));
    fs.writeFileSync(verwaist, 'left by a run that broke off');
    r.db.removeExperimentPhoto(r.database, foto);
    const a = await r.anfrage('POST', '/api/experiment-photos/' + foto + '/purge', undefined, {
      user_id: 1,
      username: 'admin',
      role: 'admin'
    });
    assert.equal(a.status, 200);
    assert.equal(fs.existsSync(verwaist), false);
  });
});

describe('PUT /api/experiment-photos/:id/original, wenn der Platz knapp ist', () => {
  let r;
  afterEach(() => r.schliessen());

  it('antwortet 507 an der Obergrenze der Ablage und laesst nichts liegen', async () => {
    r = versuchsrouten({ deckel: 2000 });
    const versuch = Number(r.db.insertExperiment(r.database, { code: 'T-1', title: 'Testversuch' }));
    const foto = await fotoAnlegen(r, versuch);
    const gross = jpeg(sof(10, 10), Buffer.alloc(3000, 1));
    const a = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', gross);
    assert.equal(a.status, 507);
    assert.equal(r.dateien().filter((n) => n.endsWith('_orig.jpg')).length, 0);
  });

  it('fragt die Platte des Ordners, in den geschrieben wird', async () => {
    r = versuchsrouten();
    const photoCap = require('../scripts/photo-cap.js');
    const echt = photoCap.enforceFreeSpace;
    const gefragt = [];
    photoCap.enforceFreeSpace = (dir, ...rest) => {
      gefragt.push(dir);
      return echt(dir, ...rest);
    };
    try {
      const versuch = Number(r.db.insertExperiment(r.database, { code: 'T-1', title: 'Testversuch' }));
      const foto = await fotoAnlegen(r, versuch);
      await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT());
    } finally {
      photoCap.enforceFreeSpace = echt;
    }
    const fotos = path.join(r.DIR, 'data', 'photos') + path.sep;
    assert.equal(gefragt.length, 2, 'the photo, then its original');
    for (const d of gefragt) assert.ok(d.startsWith(fotos), d + ' is the folder written to');
  });

  it('nimmt unter der Reserve noch das Foto an, aber nicht mehr sein Original', async () => {
    // 1 GB frei, 2 GB Reserve: das Foto, das die App zeigt, hat seine eigene,
    // niedrigere Grenze; das Original von 25 MB haelt die Reserve ein.
    const GB = 1024 * 1024 * 1024;
    r = versuchsrouten({ frei: 2 * GB });
    const statfsSync = fs.statfsSync;
    fs.statfsSync = () => ({ bavail: GB / 4096, bsize: 4096 });
    let a;
    try {
      const versuch = Number(r.db.insertExperiment(r.database, { code: 'T-1', title: 'Testversuch' }));
      const foto = await fotoAnlegen(r, versuch);
      a = await r.anfrage('PUT', '/api/experiment-photos/' + foto + '/original', MIT_ORT());
    } finally {
      fs.statfsSync = statfsSync;
    }
    assert.equal(a.status, 507);
    assert.match(a.json.error, /2\.0 GB must stay free, see PHOTO_MIN_FREE_GB/);
    assert.equal(r.dateien().filter((n) => n.endsWith('_orig.jpg')).length, 0);
    const abgelehnt = r.logs.filter((l) => l.msg === 'Photo refused, disk nearly full');
    assert.equal(abgelehnt.length, 1, 'a refusal is in the log, not only in the answer');
    assert.equal(abgelehnt[0].level, 'warn');
  });

  it('sagt im Log, wenn die Platte unter das Doppelte der Reserve faellt, einmal je Stunde', async () => {
    // Die Warnung der Obergrenze kommt bei 90 GB; die erste Nachricht von
    // einer vollen Platte soll nicht das 507 eines Kollegen sein.
    const GB = 1024 * 1024 * 1024;
    r = versuchsrouten({ frei: 2 * GB });
    const statfsSync = fs.statfsSync;
    fs.statfsSync = () => ({ bavail: (3 * GB) / 4096, bsize: 4096 });
    try {
      const versuch = Number(r.db.insertExperiment(r.database, { code: 'T-1', title: 'Testversuch' }));
      await fotoAnlegen(r, versuch);
      await fotoAnlegen(r, versuch);
    } finally {
      fs.statfsSync = statfsSync;
    }
    const warnungen = r.logs.filter((l) => l.msg === 'Photo disk getting full');
    assert.equal(warnungen.length, 1);
    assert.equal(warnungen[0].level, 'warn');
    assert.equal(warnungen[0].meta.reserveMB, Math.round((2 * GB) / 1e6));
    assert.ok(warnungen[0].meta.freeMB < 2 * warnungen[0].meta.reserveMB);
  });
});
