'use strict';
// Ein Abschnitt der Routen aus server.js, gegen eine echte Datenbank.
//
// server.js startet beim Laden einen Server, deshalb laedt kein Test es. Dieser
// Helfer schneidet einen Abschnitt zwischen zwei Markierungskommentaren
// woertlich heraus, dazu die Helfer und Konstanten, die er braucht, und laesst
// ihn gegen db.js und eine Datenbank in einem Temp-Ordner laufen. Ein Test
// prueft damit, was die Route antwortet, und nicht nur, was in ihr steht.
//
// Das Geruest stand fast wortgleich in versuchsrouten.js und
// kontaminationsrouten.js. Hier steht es einmal. Welcher Abschnitt es ist und
// was er aus server.js braucht, bleibt Sache der Datei, die nach ihm heisst.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const { Writable } = require('stream');
const { EventEmitter } = require('events');
const { ROOT, quelle, hebeFunktion, hebeKonstante } = require('./quelle');

const db = require(path.join(ROOT, 'db.js'));
const photoCap = require(path.join(ROOT, 'scripts', 'photo-cap.js'));
const jpegLocation = require(path.join(ROOT, 'scripts', 'jpeg-location.js'));

function abschnitt(src, von, bis) {
  const a = src.indexOf(von);
  const b = src.indexOf(bis);
  assert.ok(
    a > 0 && b > a,
    'Abschnitt "' + von + '" bis "' + bis + '" in server.js nicht gefunden — der Helfer muss mitgeführt werden'
  );
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

// teil beschreibt den Abschnitt:
//   name        der Temp-Ordner heisst mt_<name>_
//   von, bis    die Markierungskommentare; der Abschnitt endet vor `bis`
//   helfer      Funktionen aus server.js, die er aufruft
//   konstanten  Konstanten, die auf einer Zeile stehen
//   literale    Konstanten mit Objekt- oder Listenliteral
//   liestUrl    der Abschnitt liest url, den Pfad ohne Query
// opts.deckel: Obergrenze der Fotoablage in Bytes (Standard 10 GB).
// opts.frei: was auf der Platte nach einem Original frei bleiben muss, in
// Bytes (Standard 0). Fuer die kleinen Bilder gilt, was server.js daraus macht.
// opts.benutzer: Benutzer, die es in der Datenbank gibt.
function routen(teil, opts = {}) {
  const { name, von, bis, helfer = [], konstanten = [], literale = [], liestUrl = false } = teil;
  const src = quelle('server.js');
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_' + name + '_'));
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
  // Der Server trennt die Query einmal vor allen Routen ab und nennt den Pfad
  // url. anfrage() reicht den Pfad immer mit, als url sichtbar ist er im
  // Abschnitt aber nur, wenn teil.liestUrl es sagt. Liest ein Abschnitt ohne
  // liestUrl doch url, faellt das auf wie ein fehlender Helfer.
  const parameter = liestUrl ? 'req, res, url' : 'req, res';
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
    'frei',
    'jpegLocation',
    `
    ${konstanten.map((k) => konstante(src, k)).join('\n')}
    ${literale.map((k) => hebeKonstante(k, src)).join('\n')}
    const PHOTO_DIR = path.join(DIR, 'data', 'photos');
    const PHOTO_DIR_MAX_BYTES = deckel;
    const PHOTO_MIN_FREE_BYTES = frei;
    ${konstante(src, 'PHOTO_SMALL_MIN_FREE_BYTES')}
    let _photoDirSizeBytes = 0;
    let _photoDirSizeStaleAt = 0;
    ${helfer.map((n) => hebeFunktion(n, src)).join('\n')}
    function handle(${parameter}) {
      ${abschnitt(src, von, bis)}
      return false;
    }
    return { handle, groesse: () => _photoDirSizeBytes };`
  )(
    db,
    database,
    path,
    fs,
    crypto,
    photoCap,
    DIR,
    log,
    broadcastSSE,
    jsonBody,
    opts.deckel || 10 * 1024 * 1024 * 1024,
    opts.frei || 0,
    jpegLocation
  );

  // Eine Anfrage an die Routen. Kommt keine Antwort, meldet das Ergebnis
  // status null, statt den Test haengen zu lassen. kopf: Anfragekoepfe, klein
  // geschrieben wie bei node:http. Ein Buffer als body kommt roh an, ueber die
  // Ereignisse 'data' und 'end', wie bei einer Route, die selbst liest.
  // weiter.reisstAb: der Body kommt, sein Ende nie, und dann laeuft die
  // Wartezeit ab, die die Route der Anfrage gesetzt hat — ein Handy, das
  // mitten im Hochladen aus dem WLAN faellt.
  function anfrage(method, url, body, authUser, kopf, weiter = {}) {
    const res = antwort();
    const roh = Buffer.isBuffer(body) ? body : null;
    const req = Object.assign(new EventEmitter(), {
      method,
      url,
      headers: kopf || {},
      authUser: authUser === undefined ? { user_id: 7, username: 'anna', role: 'user' } : authUser,
      rohBody: roh || body === undefined ? '' : JSON.stringify(body),
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
      setTimeout(ms, cb) {
        this.timeoutMs = ms;
        this.onTimeout = cb;
        return this;
      }
    });
    return new Promise((fertig) => {
      const uhr = setTimeout(() => fertig({ status: null, haengt: true, req }), 1000);
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
      } else if (roh) {
        setImmediate(() => {
          req.emit('data', roh);
          if (!weiter.reisstAb) req.emit('end');
          else if (req.onTimeout) req.onTimeout();
        });
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

module.exports = { routen, jpeg };
