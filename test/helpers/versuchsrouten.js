'use strict';
// Die Versuchs-Routen aus server.js, gegen eine echte Datenbank.
//
// server.js startet beim Laden einen Server, deshalb laedt kein Test es. Dieser
// Helfer schneidet den Abschnitt von "Versuche und ihre Ansaetze" bis vor
// "Vorhaben-Texte" woertlich heraus, dazu die Helfer und Konstanten, die er
// braucht, und laesst ihn gegen db.js und eine Datenbank in einem Temp-Ordner
// laufen. Ein Test prueft damit, was die Route antwortet, und nicht nur, was in
// ihr steht.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const { Writable } = require('stream');
const { ROOT, quelle, hebeFunktion, hebeKonstante } = require('./quelle');

const db = require(path.join(ROOT, 'db.js'));
const photoCap = require(path.join(ROOT, 'scripts', 'photo-cap.js'));

const HELFER = [
  'jsonOk',
  'jsonErr',
  'requireAdmin',
  'safeErr',
  'validateRequired',
  'validateTypes',
  'validateLengths',
  'validateDate',
  'validateDay',
  'versuchPruefen',
  '_ensurePhotoDirSize',
  '_parseImageDataUrl',
  '_isJpegMagic',
  'savePhotoToDisk',
  '_discardPhotoFiles',
  'ansatzPruefen',
  'etagMatches'
];
const KONSTANTEN = ['PHOTO_MAX_BYTES', 'PHOTO_THUMB_MAX_BYTES', 'PHOTO_SIZE_REFRESH_MS', 'EXP_MAX_PHOTOS_PER_CALL'];
// Konstanten mit Objekt- oder Listenliteral.
const LITERALE = ['ANSATZ_TYPEN'];

function abschnitt(src) {
  const a = src.indexOf('// ── Versuche und ihre Ansaetze');
  const b = src.indexOf('// ── Vorhaben-Texte');
  assert.ok(a > 0 && b > a, 'Versuchs-Abschnitt in server.js nicht gefunden — der Helfer muss mitgeführt werden');
  return src.slice(a, b);
}
function konstante(src, name) {
  const m = src.match(new RegExp('^const ' + name + ' = [^\\n]*;', 'm'));
  assert.ok(m, name + ' nicht in server.js gefunden — der Helfer muss mitgeführt werden');
  return m[0];
}

// Eine Antwort, die mitschreibt, was die Route sendet, auch wenn sie eine
// Datei hineinleitet.
function antwort() {
  const teile = [];
  const res = new Writable({
    write(chunk, enc, cb) {
      teile.push(Buffer.from(chunk));
      cb();
    }
  });
  res.statusCode = null;
  res.headers = {};
  res.writeHead = (code, headers) => {
    res.statusCode = code;
    Object.assign(res.headers, headers || {});
    return res;
  };
  res.inhalt = () => Buffer.concat(teile);
  return res;
}

// Ein Stueck JPEG: die Magie am Anfang, der Rest ist gleichgueltig.
function jpeg(bytes) {
  const b = Buffer.alloc(Math.max(4, bytes || 64), 7);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  return 'data:image/jpeg;base64,' + b.toString('base64');
}

// opts.deckel: Obergrenze der Fotoablage in Bytes (Standard 10 GB).
// opts.benutzer: Benutzer, die es in der Datenbank gibt.
function versuchsrouten(opts = {}) {
  const src = quelle('server.js');
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_versuchsrouten_'));
  const database = db.openDb(path.join(DIR, 'test.db'));
  const neu = database.prepare('INSERT INTO users(id,username,hash,salt,role,created) VALUES(?,?,?,?,?,?)');
  for (const u of opts.benutzer || [{ id: 7, username: 'anna', role: 'user' }]) {
    neu.run(u.id, u.username, 'x', 'y', u.role || 'user', new Date().toISOString());
  }
  const logs = [];
  let sendungen = 0;
  const log = (level, msg, meta) => logs.push({ level, msg, meta });
  const broadcastSSE = () => {
    sendungen++;
  };
  const jsonBody = (req, res, cb) => {
    let daten;
    try {
      daten = JSON.parse(req.rohBody);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"bad json"}');
      return;
    }
    cb(null, daten);
  };
  const innen = new Function(
    'db',
    'database',
    'path',
    'fs',
    'crypto',
    'photoCap',
    'DIR',
    'log',
    'broadcastSSE',
    'jsonBody',
    'deckel',
    `
    ${KONSTANTEN.map((k) => konstante(src, k)).join('\n')}
    ${LITERALE.map((k) => hebeKonstante(k, src)).join('\n')}
    const PHOTO_DIR = path.join(DIR, 'data', 'photos');
    const PHOTO_DIR_MAX_BYTES = deckel;
    let _photoDirSizeBytes = 0;
    let _photoDirSizeStaleAt = 0;
    ${HELFER.map((n) => hebeFunktion(n, src)).join('\n')}
    function handle(req, res, url) {
      ${abschnitt(src)}
      return false;
    }
    return { handle, groesse: () => _photoDirSizeBytes };`
  )(db, database, path, fs, crypto, photoCap, DIR, log, broadcastSSE, jsonBody, opts.deckel || 10 * 1024 * 1024 * 1024);

  // Eine Anfrage an die Routen. Kommt keine Antwort, meldet das Ergebnis
  // status null, statt den Test haengen zu lassen. kopf: Anfragekoepfe, klein
  // geschrieben wie bei node:http.
  function anfrage(method, url, body, authUser, kopf) {
    const res = antwort();
    const req = {
      method,
      url,
      headers: kopf || {},
      authUser: authUser === undefined ? { user_id: 7, username: 'anna', role: 'user' } : authUser,
      rohBody: body === undefined ? '' : JSON.stringify(body)
    };
    return new Promise((fertig) => {
      const uhr = setTimeout(() => fertig({ status: null, haengt: true }), 1000);
      res.on('finish', () => {
        clearTimeout(uhr);
        const roh = res.inhalt();
        let json = null;
        try {
          json = JSON.parse(roh.toString('utf8'));
        } catch {
          /* keine JSON-Antwort, etwa ein Bild */
        }
        fertig({ status: res.statusCode, json, roh, headers: res.headers });
      });
      if (innen.handle(req, res, url.split('?')[0]) === false) {
        clearTimeout(uhr);
        fertig({ status: 'keine Route' });
      }
    });
  }

  return {
    db,
    database,
    DIR,
    logs,
    anfrage,
    groesse: innen.groesse,
    sendungen: () => sendungen,
    dateien() {
      const wurzel = path.join(DIR, 'data', 'photos');
      if (!fs.existsSync(wurzel)) return [];
      return fs
        .readdirSync(wurzel, { recursive: true })
        .map(String)
        .filter((n) => fs.statSync(path.join(wurzel, n)).isFile());
    },
    schliessen() {
      try {
        database.close();
      } catch {
        /* schon zu */
      }
      fs.rmSync(DIR, { recursive: true, force: true });
    }
  };
}

module.exports = { versuchsrouten, jpeg };
