'use strict';
// Das Laborbuch als Archiv (scripts/lab-archive.js) und der ZIP-Schreiber
// darunter (scripts/zip-store.js).
//
// Worauf es ankommt: das ZIP laesst sich lesen, mit richtigen Pruefsummen, auch
// mit den ZIP64-Saetzen, die ein grosses Archiv braucht; im Archiv steht das
// Laborbuch der Auswahl, jedes Foto samt Original, der ganze Verlauf mit seiner
// Kette und jeder Zeitstempel; SHA256SUMS stimmt fuer jede Datei; ein Foto, das
// nicht mehr zu seiner gespeicherten Pruefsumme passt oder fehlt, steht in
// pruefung.json; und die Kette laesst sich allein aus dem Archiv nachrechnen.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const db = require('../db.js');
const { quelle } = require('./helpers/quelle');
const { createZipWriter } = require('../scripts/zip-store.js');
const { writeLabArchive, fileName, folder } = require('../scripts/lab-archive.js');
const { tokenFuer } = require('./helpers/tsa');

// ── ein ZIP lesen, unabhaengig vom Schreiber ────────────────
function zipLesen(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'end of central directory');
  let anzahl = buf.readUInt16LE(eocd + 10);
  let start = buf.readUInt32LE(eocd + 16);
  let zip64 = false;
  if (anzahl === 0xffff || start === 0xffffffff) {
    zip64 = true;
    const locator = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
    assert.ok(locator >= 0 && locator < eocd, 'ZIP64 locator before the end record');
    const satz = Number(buf.readBigUInt64LE(locator + 8));
    assert.equal(buf.readUInt32LE(satz), 0x06064b50, 'ZIP64 end record');
    anzahl = Number(buf.readBigUInt64LE(satz + 32));
    start = Number(buf.readBigUInt64LE(satz + 48));
  }
  const dateien = new Map();
  let at = start;
  for (let i = 0; i < anzahl; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50, 'central header');
    const flags = buf.readUInt16LE(at + 8);
    assert.equal(flags & 0x0800, 0x0800, 'names are UTF-8');
    assert.equal(buf.readUInt16LE(at + 10), 0, 'stored, not compressed');
    const crc = buf.readUInt32LE(at + 16);
    let groesse = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const kommentarLen = buf.readUInt16LE(at + 32);
    let lokal = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const extra = buf.subarray(at + 46 + nameLen, at + 46 + nameLen + extraLen);
    if (groesse === 0xffffffff || lokal === 0xffffffff) {
      assert.equal(extra.readUInt16LE(0), 0x0001, 'ZIP64 extra field');
      let p = 4;
      if (groesse === 0xffffffff) {
        groesse = Number(extra.readBigUInt64LE(p));
        p += 16;
      }
      if (lokal === 0xffffffff) lokal = Number(extra.readBigUInt64LE(p));
    }
    assert.equal(buf.readUInt32LE(lokal), 0x04034b50, 'local header of ' + name);
    assert.equal(buf.readUInt32LE(lokal + 14), crc, 'the local header carries the CRC of ' + name);
    const lokalName = buf.readUInt16LE(lokal + 26);
    const lokalExtra = buf.readUInt16LE(lokal + 28);
    const daten = buf.subarray(lokal + 30 + lokalName + lokalExtra, lokal + 30 + lokalName + lokalExtra + groesse);
    assert.equal(zlib.crc32(daten), crc, 'CRC of ' + name);
    dateien.set(name, daten);
    at += 46 + nameLen + extraLen + kommentarLen;
  }
  return { dateien, zip64 };
}
function sammeln() {
  const s = new PassThrough();
  const teile = [];
  s.on('data', (c) => teile.push(c));
  return { s, inhalt: () => Buffer.concat(teile) };
}

describe('ZIP ohne Kompression', () => {
  let ordner;
  before(() => {
    ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_zip_'));
    fs.writeFileSync(path.join(ordner, 'bild.jpg'), crypto.randomBytes(300 * 1024));
  });
  after(() => fs.rmSync(ordner, { recursive: true, force: true }));

  for (const force64 of [false, true]) {
    it(
      'schreibt Puffer und Dateien so, dass sie sich lesen lassen' + (force64 ? ', mit ZIP64-Saetzen' : ''),
      async () => {
        const z = sammeln();
        const zip = createZipWriter(z.s, { force64, date: new Date(2026, 9, 3, 12, 30, 10) });
        const sha = await zip.addBuffer('ä/text.txt', 'hallo Welt\n');
        assert.equal(sha, crypto.createHash('sha256').update('hallo Welt\n').digest('hex'));
        const r = await zip.addFile('fotos/1.jpg', path.join(ordner, 'bild.jpg'));
        assert.equal(r.size, 300 * 1024);
        assert.equal(
          r.sha256,
          crypto
            .createHash('sha256')
            .update(fs.readFileSync(path.join(ordner, 'bild.jpg')))
            .digest('hex')
        );
        await zip.addBuffer('leer.txt', Buffer.alloc(0));
        const fertig = await zip.finish();
        const buf = z.inhalt();
        assert.equal(fertig.bytes, buf.length);
        assert.equal(fertig.entries, 3);
        const { dateien, zip64 } = zipLesen(buf);
        assert.equal(zip64, force64);
        assert.deepEqual([...dateien.keys()], ['ä/text.txt', 'fotos/1.jpg', 'leer.txt']);
        assert.equal(dateien.get('ä/text.txt').toString('utf8'), 'hallo Welt\n');
        assert.ok(dateien.get('fotos/1.jpg').equals(fs.readFileSync(path.join(ordner, 'bild.jpg'))));
        assert.equal(dateien.get('leer.txt').length, 0);
      }
    );
  }

  it('gibt auf, wenn der Empfaenger weg ist, statt ewig zu warten', async () => {
    // Ein Download, den der Browser abbricht: kein 'drain', kein 'error',
    // nur 'close'. Ohne Leser staut sich der Puffer, und der Schreiber wartet.
    const voll = new PassThrough({ highWaterMark: 16 });
    const zip = createZipWriter(voll);
    const wartet = zip.addBuffer('gross.bin', Buffer.alloc(64 * 1024));
    setImmediate(() => voll.destroy());
    await assert.rejects(wartet, /output closed/);
    await assert.rejects(zip.addBuffer('danach.txt', 'x'), /output closed/);
    const ordnerAbbruch = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_zip_abbruch_'));
    try {
      fs.writeFileSync(path.join(ordnerAbbruch, 'b.jpg'), crypto.randomBytes(200 * 1024));
      const zu = new PassThrough({ highWaterMark: 16 });
      const z2 = createZipWriter(zu);
      const datei = z2.addFile('b.jpg', path.join(ordnerAbbruch, 'b.jpg'));
      setTimeout(() => zu.destroy(), 20);
      await assert.rejects(datei, /output closed/);
    } finally {
      fs.rmSync(ordnerAbbruch, { recursive: true, force: true });
    }
  });

  it('nimmt keine Namen, die aus dem Archiv hinausfuehren, und nichts nach dem Ende', async () => {
    const zip = createZipWriter(sammeln().s);
    for (const name of ['', '/abs.txt', '../raus.txt', 'a/../../b', 'a\\b']) {
      await assert.rejects(zip.addBuffer(name, 'x'), /bad entry name/, JSON.stringify(name));
    }
    await zip.finish();
    await assert.rejects(zip.addBuffer('spaet.txt', 'x'), /already finished/);
    await assert.rejects(zip.finish(), /already finished/);
  });
});

// ── das Archiv ──────────────────────────────────────────────
const ANNA = { user_id: 7, username: 'anna' };
function glied(vorher, z) {
  const eintrag = JSON.stringify([
    z.id,
    z.at,
    z.user_id,
    z.username,
    z.entity,
    z.entity_id,
    z.experiment_id,
    z.action,
    z.field,
    z.old_value,
    z.new_value
  ]);
  return crypto
    .createHash('sha256')
    .update(vorher + '\n' + eintrag, 'utf8')
    .digest('hex');
}

describe('Archiv: nachgetragene Eintraege', () => {
  it('nennt sie in der Anleitung, und die Kette rechnet sich trotzdem nach', async () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_archiv_nach_'));
    const p = path.join(ordner, 'test.db');
    let d = db.openDb(p);
    try {
      db.insertExperiment(d, { code: 'N1', title: 'Nachtrag', started: '2026-10-01' });
      // Wie eine aeltere Version ohne Kette: ein Eintrag ohne Glied am Ende.
      const fremd = Number(
        d
          .prepare(
            "INSERT INTO lab_history(at,entity,entity_id,experiment_id,action,new_value) VALUES('2026-10-04T12:00:00.000Z','experiment',1,1,'update','{}')"
          )
          .run().lastInsertRowid
      );
      d.close();
      d = db.openDb(p);
      const z = sammeln();
      await writeLabArchive({ out: z.s, dbApi: db, database: d, dataDir: path.join(ordner, 'data'), opts: {} });
      const { dateien } = zipLesen(z.inhalt());
      const liesmich = dateien.get('LIESMICH.txt').toString('utf8');
      assert.ok(liesmich.includes('Kette unveraendert'));
      assert.match(liesmich, new RegExp('Nachgetragen am .*: 1 Eintraege ohne Glied, #' + fremd + ' bis #' + fremd));
      const verlauf = JSON.parse(dateien.get('pruefkette/verlauf.json').toString('utf8'));
      const kette = JSON.parse(dateien.get('pruefkette/kette.json').toString('utf8'));
      let vorher = '0'.repeat(64);
      verlauf.forEach((e, i) => {
        vorher = glied(vorher, e);
        assert.deepEqual(kette[i], { id: e.id, hash: vorher });
      });
      assert.ok(verlauf.some((e) => e.entity === 'chain' && e.action === 'adopt'));
    } finally {
      d.close();
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });
});

describe('Archiv: zurueckgespielte Sicherungen', () => {
  it('hat den Eintrag fuer das Ganze im Verlauf, nennt ihn in der Anleitung, und die Kette rechnet sich nach', async () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_archiv_rueck_'));
    const p = path.join(ordner, 'test.db');
    let d = db.openDb(p);
    try {
      const v = Number(db.insertExperiment(d, { code: 'R1', title: 'Zurueck', started: '2026-10-01' }));
      const sicherung = path.join(ordner, 'sicherung.db');
      d.prepare('VACUUM INTO ?').run(sicherung);
      db.updateExperiment(d, v, { outcome: 'verworfen' });
      // Wie der Server: gegen die Sicherung zaehlen, tauschen, festhalten.
      const gezaehlt = db.historyDiscarded(d, sicherung);
      d.close();
      for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
      fs.copyFileSync(sicherung, p);
      d = db.openDb(p);
      const id = db.markBackupRestore(d, gezaehlt, { user_id: null, username: 'chef' }, 'pre-restore-test.db');
      // Und der Eintrag, den eine Sicherung ohne Verlauf hinterliesse.
      const ohne = db.markBackupRestore(d, { counted: 'id', last: 0, total: 3 }, { user_id: null, username: 'chef' });
      const z = sammeln();
      await writeLabArchive({ out: z.s, dbApi: db, database: d, dataDir: path.join(ordner, 'data'), opts: {} });
      const { dateien } = zipLesen(z.inhalt());
      const verlauf = JSON.parse(dateien.get('pruefkette/verlauf.json').toString('utf8'));
      const eintrag = verlauf.find((e) => e.id === id);
      assert.deepEqual(
        [eintrag.entity, eintrag.entity_id, eintrag.experiment_id, eintrag.action],
        ['database', gezaehlt.last, null, 'backup']
      );
      assert.equal(JSON.parse(eintrag.new_value).kept, 'pre-restore-test.db');
      assert.equal(JSON.parse(dateien.get('laborbuch.json').toString('utf8')).chain.restores[0].id, id);
      const liesmich = dateien.get('LIESMICH.txt').toString('utf8');
      assert.ok(liesmich.includes('entity "database" und action "backup"'));
      assert.ok(liesmich.includes('"database" and action "backup" records a restored backup'));
      assert.match(
        liesmich,
        new RegExp(
          'Zurueckgespielt am .*: eine Sicherung mit Verlauf bis #' +
            gezaehlt.last +
            ', 1 Eintraege verworfen \\(Eintrag #' +
            id +
            '\\); der Stand davor: pre-restore-test\\.db\\.'
        )
      );
      assert.match(
        liesmich,
        new RegExp(
          'Zurueckgespielt am .*: eine Sicherung ohne Verlauf, 3 Eintraege verworfen \\(Eintrag #' + ohne + '\\)\\.'
        )
      );
      const kette = JSON.parse(dateien.get('pruefkette/kette.json').toString('utf8'));
      let vorher = '0'.repeat(64);
      verlauf.forEach((e, i) => {
        vorher = glied(vorher, e);
        assert.deepEqual(kette[i], { id: e.id, hash: vorher });
      });
    } finally {
      d.close();
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });
});

describe('Das Laborbuch als Archiv', () => {
  let ordner, d, versuch, anderer, fotos, archiv;
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

  before(async () => {
    ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_archiv_'));
    d = db.openDb(path.join(ordner, 'test.db'));
    d.prepare('INSERT INTO users(id,username,hash,salt,role,created) VALUES(?,?,?,?,?,?)').run(
      7,
      'anna',
      'x',
      'y',
      'user',
      new Date().toISOString()
    );
    const ap = db.insertWorkPackage(d, { code: 'AP1', title: 'Paket' }, ANNA);
    versuch = Number(
      db.insertExperiment(d, { code: 'V/1 neu', title: 'Archivlauf', started: '2026-09-01', workPackageId: ap }, ANNA)
    );
    anderer = Number(db.insertExperiment(d, { code: 'V2', title: 'Ohne Paket', started: '2026-09-02' }, ANNA));
    // Drei Fotos: eins mit Original, eins, dessen Datei inzwischen anders ist,
    // und eins, dessen Datei fehlt.
    fotos = [];
    for (const [i, v] of [
      [1, versuch],
      [2, versuch],
      [3, anderer]
    ]) {
      const uuid = '0000000' + i + '-0000-4000-8000-00000000000' + i;
      const rel = 'photos/2026/09/exp-' + v + '/' + uuid + '.jpg';
      const bytes = crypto.randomBytes(1000 + i);
      fs.mkdirSync(path.join(ordner, 'data', path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(ordner, 'data', rel), bytes);
      const id = Number(
        db.addExperimentPhoto(
          d,
          v,
          null,
          {
            uuid,
            rel_path: rel,
            thumb_path: rel.replace('.jpg', '_thumb.jpg'),
            width: 10,
            height: 10,
            bytes: bytes.length,
            sha256: sha(bytes),
            uploaded_at: '2026-09-1' + i + 'T10:00:00.000Z',
            uploaded_by: 7
          },
          ANNA
        )
      );
      fotos.push({ id, uuid, rel, bytes });
    }
    const orig = crypto.randomBytes(5000);
    const origRel = fotos[0].rel.replace('.jpg', '_orig.jpg');
    fs.writeFileSync(path.join(ordner, 'data', origRel), orig);
    db.setExperimentPhotoOriginal(d, fotos[0].id, { path: origRel, bytes: orig.length, sha256: sha(orig) }, ANNA);
    fotos[0].orig = orig;
    fs.writeFileSync(path.join(ordner, 'data', fotos[1].rel), Buffer.from('nicht mehr das Foto'));
    fs.rmSync(path.join(ordner, 'data', fotos[2].rel));
    const kopf = db.labChainHead(d);
    db.insertLabTimestamp(d, {
      ...kopf,
      tsa: 'http://tsa.example',
      requested: '2026-10-03T10:00:00.000Z',
      genTime: '2026-10-03T10:00:01.000Z',
      serial: '0a',
      token: tokenFuer(kopf.hash)
    });

    const z = sammeln();
    const r = await writeLabArchive({
      out: z.s,
      dbApi: db,
      database: d,
      dataDir: path.join(ordner, 'data'),
      opts: {},
      createdBy: 'chef'
    });
    archiv = { r, ...zipLesen(z.inhalt()) };
  });
  after(() => {
    d.close();
    fs.rmSync(ordner, { recursive: true, force: true });
  });

  it('enthaelt Anleitung, Laborbuch, Fotos samt Original, Kette, Stempel, Pruefung und Pruefsummen', () => {
    const namen = [...archiv.dateien.keys()];
    assert.equal(namen[0], 'LIESMICH.txt');
    assert.equal(namen.at(-1), 'SHA256SUMS');
    for (const n of [
      'laborbuch.json',
      'fotos/' + versuch + '-V_1_neu/' + fotos[0].id + '.jpg',
      'fotos/' + versuch + '-V_1_neu/' + fotos[0].id + '_original.jpg',
      'pruefkette/verlauf.json',
      'pruefkette/kette.json',
      'zeitstempel/1.tsr',
      'zeitstempel/zeitstempel.json',
      'pruefung.json'
    ]) {
      assert.ok(archiv.dateien.has(n), n);
    }
    assert.ok(archiv.dateien.get('fotos/' + versuch + '-V_1_neu/' + fotos[0].id + '.jpg').equals(fotos[0].bytes));
    assert.ok(
      archiv.dateien.get('fotos/' + versuch + '-V_1_neu/' + fotos[0].id + '_original.jpg').equals(fotos[0].orig)
    );
    assert.ok(archiv.dateien.get('zeitstempel/1.tsr').equals(tokenFuer(db.listLabTimestamps(d)[0].hash)));
    const lies = archiv.dateien.get('LIESMICH.txt').toString('utf8');
    assert.ok(lies.includes('von chef'));
    assert.ok(lies.includes('sha256sum -c SHA256SUMS'));
    assert.ok(lies.includes('openssl ts -verify'));
  });

  it('nennt in SHA256SUMS jede andere Datei mit ihrer richtigen Pruefsumme', () => {
    const zeilen = archiv.dateien.get('SHA256SUMS').toString('utf8').trim().split('\n');
    const genannt = new Map(zeilen.map((z) => [z.slice(66), z.slice(0, 64)]));
    assert.ok(
      zeilen.every((z) => /^[0-9a-f]{64} {2}\S/.test(z)),
      'sha256sum format'
    );
    const andere = [...archiv.dateien.keys()].filter((n) => n !== 'SHA256SUMS');
    assert.deepEqual([...genannt.keys()].sort(), andere.sort());
    for (const n of andere) assert.equal(genannt.get(n), sha(archiv.dateien.get(n)), n);
  });

  it('meldet ein Foto, das nicht mehr zu seiner Pruefsumme passt, und eins, das fehlt', () => {
    const p = JSON.parse(archiv.dateien.get('pruefung.json').toString('utf8'));
    assert.equal(p.createdBy, 'chef');
    assert.equal(p.chain.ok, true);
    assert.equal(p.photos.files, 3);
    assert.deepEqual(
      p.photos.mismatched.map((m) => [m.photo, m.recorded, m.found]),
      [[fotos[1].id, sha(fotos[1].bytes), sha(Buffer.from('nicht mehr das Foto'))]]
    );
    assert.deepEqual(
      p.photos.missing.map((m) => m.photo),
      [fotos[2].id]
    );
    assert.deepEqual(archiv.r.photos, p.photos);
    assert.equal(archiv.r.chainOk, true);
  });

  it('laesst die Kette allein aus dem Archiv nachrechnen, bis zum Glied unter dem Zeitstempel', () => {
    const verlauf = JSON.parse(archiv.dateien.get('pruefkette/verlauf.json').toString('utf8'));
    const kette = JSON.parse(archiv.dateien.get('pruefkette/kette.json').toString('utf8'));
    assert.equal(verlauf.length, kette.length);
    let vorher = '0'.repeat(64);
    verlauf.forEach((z, i) => {
      vorher = glied(vorher, z);
      assert.deepEqual(kette[i], { id: z.id, hash: vorher });
    });
    const [stempel] = JSON.parse(archiv.dateien.get('zeitstempel/zeitstempel.json').toString('utf8'));
    assert.equal(stempel.file, 'zeitstempel/1.tsr');
    assert.equal(stempel.token, undefined);
    assert.equal(kette.find((k) => k.id === stempel.historyId).hash, stempel.hash);
  });

  it('folgt im Laborbuch und bei den Fotos der Auswahl, der Verlauf bleibt ganz', async () => {
    const paket = db.listWorkPackages(d)[0].id;
    const z = sammeln();
    await writeLabArchive({
      out: z.s,
      dbApi: db,
      database: d,
      dataDir: path.join(ordner, 'data'),
      opts: { workPackageId: paket },
      createdBy: 'chef'
    });
    const { dateien } = zipLesen(z.inhalt());
    const buch = JSON.parse(dateien.get('laborbuch.json').toString('utf8'));
    assert.deepEqual(
      buch.experiments.map((e) => e.id),
      [versuch]
    );
    assert.equal(
      [...dateien.keys()].some((n) => n.startsWith('fotos/' + anderer + '-')),
      false
    );
    const verlauf = JSON.parse(dateien.get('pruefkette/verlauf.json').toString('utf8'));
    assert.ok(
      verlauf.some((z) => z.experiment_id === anderer),
      'the chain can only be recomputed from its first link'
    );
  });

  it('liest alles, was es ueber die Datenbank sagt, vor dem ersten Byte', async () => {
    // Ein Empfaenger, der langsam liest: waehrend das Archiv schreibt, kommt
    // ein Eintrag dazu. Er darf in keiner Datei stehen, sonst passten Verlauf,
    // Kette und Befund nicht zueinander.
    const z = new PassThrough({ highWaterMark: 1024 });
    const teile = [];
    let geaendert = false;
    z.on('data', (c) => {
      teile.push(c);
      if (!geaendert) {
        geaendert = true;
        db.updateExperiment(d, versuch, { outcome: 'waehrenddessen' }, ANNA);
      }
    });
    const vorher = d.prepare('SELECT COUNT(*) AS n FROM lab_history').get().n;
    await writeLabArchive({ out: z, dbApi: db, database: d, dataDir: path.join(ordner, 'data'), opts: {} });
    const { dateien } = zipLesen(Buffer.concat(teile));
    assert.ok(geaendert);
    assert.equal(JSON.parse(dateien.get('pruefkette/verlauf.json').toString('utf8')).length, vorher);
    assert.equal(JSON.parse(dateien.get('pruefkette/kette.json').toString('utf8')).length, vorher);
    assert.equal(JSON.parse(dateien.get('pruefung.json').toString('utf8')).chain.entries, vorher);
  });

  it('benennt Datei und Ordner so, dass sie sortieren und auf jedem Dateisystem gehen', () => {
    const jetzt = new Date('2026-10-03T12:00:00.000Z');
    assert.equal(fileName({}, jetzt), 'laborbuch-2026-10-03.zip');
    // Kurz nach Mitternacht im Labor ist in UTC noch gestern.
    assert.equal(fileName({}, new Date(2026, 9, 3, 0, 30)), 'laborbuch-2026-10-03.zip');
    assert.equal(fileName({ from: '2026-01-01', to: '2026-09-30' }, jetzt), 'laborbuch-2026-01-01_2026-09-30.zip');
    assert.equal(fileName({ to: '2026-09-30' }, jetzt), 'laborbuch-anfang_2026-09-30.zip');
    assert.equal(fileName({ workPackageId: 3 }, jetzt, [{ id: 3, code: 'AP 3/b' }]), 'laborbuch-2026-10-03-AP_3_b.zip');
    assert.equal(folder({ id: 9, code: 'Ä:*?"<>|' }), '9-_');
  });
});

describe('Die Archiv-Route im Quelltext', () => {
  const src = quelle('server.js');
  const start = src.indexOf("url === '/api/lab-book/archive'");
  const route = src.slice(start, src.indexOf('// GET /api/health', start));
  it('laesst nur einen Admin ein, prueft die Auswahl und baut eins zur Zeit', () => {
    assert.ok(start > 0);
    assert.ok(route.indexOf('requireAdmin(req, res)') < route.indexOf('.writeLabArchive('));
    assert.ok(route.includes('validateDay(tag, name)'));
    assert.ok(route.includes("'from must not be after to'"));
    assert.ok(route.indexOf('if (labArchiveRunning)') < route.indexOf('labArchiveRunning = true'));
    assert.ok(
      route.indexOf('db.labBook(database, frage)') < route.indexOf('labArchiveRunning = true'),
      'the lab book is read before the lock is taken'
    );
    assert.ok(
      route.indexOf('safeErr(res, err)') < route.indexOf('res.writeHead(200'),
      'an early error gets a real answer'
    );
    assert.ok(route.includes('book: buch'));
    assert.ok(route.includes('labArchiveRunning = false'));
    assert.ok(route.includes("'Content-Disposition': 'attachment; filename=\"' + name + '\"'"));
  });
});
