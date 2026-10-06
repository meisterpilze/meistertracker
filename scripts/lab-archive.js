'use strict';
// The lab book as an archive file: what a funder or an auditor may ask for
// years later, in files that can be read and checked without this application.
//
//   LIESMICH.txt                    what is in here and how to check it
//   laborbuch.json                  the lab book for the chosen period or work
//                                   package, as /api/lab-book returns it
//   fotos/<id>-<code>/<n>.jpg       each photo as the app shows it (1280 px)
//   fotos/<id>-<code>/<n>_original.jpg
//                                   the camera's original, without location
//   pruefkette/verlauf.json         every history entry, as stored, from the first
//   pruefkette/kette.json           every entry's link in the hash chain
//   zeitstempel/<n>.tsr             every RFC 3161 token, as the authority sent it
//   zeitstempel/zeitstempel.json    which link each token covers, when, from whom
//   pruefung.json                   what was checked while writing: the chain,
//                                   every token's signature, and every photo
//                                   file against its recorded SHA-256
//   SHA256SUMS                      the SHA-256 of every file above
//
// The history and the chain are always complete, whatever was chosen: a chain
// can only be recomputed from its first link. Photos and laborbuch.json follow
// the choice.
const path = require('path');
const fs = require('fs');
const { createZipWriter } = require('./zip-store.js');
const { tokenSignature } = require('./rfc3161-verify.js');
const { tokenInfo } = require('./rfc3161.js');

// When and with which serial number a token says it was made, from the
// token, not from the columns next to it; nulls for one that cannot be read.
function tokenTime(token) {
  try {
    const t = tokenInfo(token);
    return { genTime: t.genTime, serial: t.serial };
  } catch {
    return { genTime: null, serial: null };
  }
}

// "Stand beim Erstellen" on the signatures: how many the app checked, could
// not check, and found invalid. Nothing without stamps, or from a chain
// status that does not report them.
function signatureLine(chain) {
  const s = chain.signatures;
  if (!s || !chain.stamps) return '';
  return ' (Signatur: ' + s.ok + ' geprueft, ' + s.unchecked + ' nicht pruefbar, ' + s.bad + ' ungueltig)';
}

// A folder name for an experiment: its id, so two codes that clean up alike
// stay apart, and its code with anything a file system might mind replaced.
function folder(e) {
  return e.id + '-' + String(e.code || '').replace(/[^A-Za-z0-9._-]+/g, '_');
}

// The file name the download suggests: period and package, in an order that
// sorts.
function fileName(opts, now, packages) {
  // The lab's own day, like the lab book's periods, not the UTC one: just
  // after midnight they differ.
  const day = (d) =>
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const parts = ['laborbuch'];
  if (opts.from || opts.to) parts.push((opts.from || 'anfang') + '_' + (opts.to || day(now)));
  else parts.push(day(now));
  const wp = opts.workPackageId != null ? (packages || []).find((w) => w.id === opts.workPackageId) : null;
  if (wp) parts.push(String(wp.code).replace(/[^A-Za-z0-9._-]+/g, '_'));
  return parts.join('-') + '.zip';
}

function lines(rows) {
  return '[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n';
}

function readme(book, opts, createdBy, chain) {
  const choice = [
    opts.from || opts.to ? 'Zeitraum ' + (opts.from || '…') + ' bis ' + (opts.to || '…') : 'alle Versuche',
    opts.workPackageId != null ? 'Arbeitspaket #' + opts.workPackageId : ''
  ]
    .filter(Boolean)
    .join(', ');
  return [
    'Laborbuch-Archiv',
    '================',
    '',
    'Erstellt ' + book.createdAt + ' (UTC) von ' + (createdBy || '?') + '. Auswahl: ' + choice + '.',
    '',
    'Was drin ist',
    '------------',
    'laborbuch.json        Das Laborbuch der Auswahl: Versuche, Gefaesse (auch entfernte),',
    '                      Fotos mit Pruefsumme, Verlauf, Arbeitspakete.',
    'fotos/                Je Versuch ein Ordner. <n>.jpg ist das Bild in der Anwendung,',
    '                      <n>_original.jpg das Original der Kamera ohne Standort.',
    'pruefkette/           Der ganze Verlauf (verlauf.json) und je Eintrag sein Glied',
    '                      der Pruefkette (kette.json).',
    'zeitstempel/          Die Zeitstempel nach RFC 3161 (.tsr) und welches Glied sie',
    '                      belegen (zeitstempel.json).',
    'pruefung.json         Was beim Schreiben geprueft wurde: die Kette, die Signatur',
    '                      jedes Zeitstempels, und jede Fotodatei gegen ihre',
    '                      gespeicherte Pruefsumme.',
    'SHA256SUMS            Die SHA-256-Pruefsumme jeder Datei.',
    '',
    'Pruefen',
    '-------',
    '1. Dateien:   sha256sum -c SHA256SUMS      (macOS: shasum -a 256 -c SHA256SUMS)',
    '2. Kette:     Fuer jeden Eintrag in Reihenfolge der id gilt',
    '                glied = SHA-256( vorheriges_glied + "\\n" + JSON.stringify([id, at,',
    '                  user_id, username, entity, entity_id, experiment_id, action,',
    '                  field, old_value, new_value]) )',
    '              in UTF-8; das erste vorherige Glied sind 64 Nullen ("000...0").',
    '              Jedes Ergebnis muss in kette.json stehen. Ein Eintrag mit',
    '              entity "chain" und action "adopt" heisst: die Eintraege von',
    '              from bis to kamen ohne Glied in die Datei, etwa von einer',
    '              aelteren Version der Anwendung, und der naechste Start hat',
    '              sie verkettet. Er gehoert zur Kette wie jeder andere.',
    '              Ein Eintrag mit entity "database" und action "backup" heisst:',
    '              hier wurde eine Sicherung zurueckgespielt. Der Verlauf bis',
    '              zur id in entity_id ist der der Sicherung; was die Datenbank',
    '              davor darueber hinaus hatte, ist verworfen. new_value nennt,',
    '              wie viele Eintraege es waren, je Versuch und Arbeitspaket,',
    '              und unter kept die Kopie von vorher, in der sie stehen.',
    '3. Stempel:   openssl ts -verify -digest <hash> \\',
    '                -in zeitstempel/<n>.tsr -token_in -CAfile <CA-Zertifikate>',
    '              mit dem Hash aus kette.json bei der id (historyId), die',
    '              zeitstempel.json fuer den Stempel nennt. "Verification: OK"',
    '              heisst: die Stelle hat genau dieses Glied zu der Zeit im',
    '              Token unterschrieben. openssl prueft die Zertifikate auf',
    '              heute; ist das der Stelle inzwischen abgelaufen, auf die',
    '              Zeit des Stempels pruefen: -attime <genTime in Sekunden',
    '              seit 1970>.',
    '              Die Anwendung hat jede Signatur beim Schreiben selbst',
    '              geprueft, auf die Zeit des Stempels (pruefung.json, stamps).',
    '              ok heisst: geprueft bis zu einem Stammzertifikat aus der',
    '              Liste, die Node.js mitbringt. unchecked: alles haelt, aber',
    '              kein solches Stammzertifikat ist zu finden, nur eines ueber',
    '              eine CA fuer andere Zwecke, oder es haelt nur mit MD5, SHA-1',
    '              oder einem anderen Verfahren, das nicht als stark gilt; dann',
    '              entscheidet openssl mit dem Stammzertifikat der Stelle. bad:',
    '              die Signatur haelt nicht, oder das Token laesst sich gar',
    '              nicht pruefen; es wurde veraendert oder kam nicht von der',
    '              Stelle.',
    '',
    'Stand beim Erstellen: ' +
      (chain.ok ? 'Kette unveraendert' : 'Kette passt nicht ab Eintrag #' + chain.broken[0].id) +
      ', ' +
      chain.entries +
      ' Eintraege, ' +
      chain.stamps +
      ' Zeitstempel' +
      signatureLine(chain) +
      '.',
    ...(chain.adopted || []).map(
      (a) =>
        'Nachgetragen am ' +
        a.at +
        ' (UTC): ' +
        a.count +
        ' Eintraege ohne Glied, #' +
        a.from +
        ' bis #' +
        a.to +
        ' (Eintrag #' +
        a.id +
        ').'
    ),
    ...(chain.restores || []).map(
      (r) =>
        'Zurueckgespielt am ' +
        r.at +
        ' (UTC): eine Sicherung ' +
        (r.upTo ? 'mit Verlauf bis #' + r.upTo : 'ohne Verlauf') +
        ', ' +
        r.discarded +
        ' Eintraege verworfen (Eintrag #' +
        r.id +
        ')' +
        (r.kept ? '; der Stand davor: ' + r.kept : '') +
        '.'
    ),
    '',
    '',
    'Lab book archive',
    '================',
    '',
    'laborbuch.json is the lab book for the choice above; fotos/ holds each photo',
    '(<n>.jpg as shown in the app, <n>_original.jpg the camera original without',
    'location); pruefkette/ the whole history and its hash chain; zeitstempel/',
    'the RFC 3161 tokens; pruefung.json what was checked while writing;',
    'SHA256SUMS every file. Check files with sha256sum -c SHA256SUMS, the chain',
    'with the formula in step 2 above, and each token with openssl ts -verify as',
    'in step 3. openssl checks certificates as of today: once the certificate of',
    'the authority has expired, add -attime <genTime in seconds since 1970>. The',
    'app checked every signature itself while writing, as of the time of the',
    'stamp (pruefung.json, stamps): ok means checked up to a root certificate',
    'from the list Node.js ships; unchecked that everything holds but no such',
    'root was found, one only through a CA for other purposes, or the token holds',
    'only with MD5, SHA-1 or another algorithm not counted as strong, so openssl',
    'with the root certificate of the authority decides; bad that the signature',
    'does not hold, or that the token cannot be checked at all. A history entry',
    'with entity "chain" and action "adopt" records entries that reached the file',
    'without a link (from an older version of the app, for example) and were',
    'linked by the next start. One with entity',
    '"database" and action "backup" records a restored backup: the history up to',
    "the id in entity_id is the backup's, and new_value says how many entries",
    'the restore discarded, per experiment and work package, and names the copy',
    'of the database from before (kept) that holds them.',
    ''
  ].join('\n');
}

// o.out       where the ZIP goes (a writable stream; not ended here)
// o.dbApi     db.js; o.database the open handle
// o.dataDir   the app's data folder (photo paths in the database are under it)
// o.opts      { from, to, workPackageId } as for /api/lab-book
// o.book      the lab book for o.opts, if the caller already has it
// o.createdBy who asked for it
// o.date      for tests: the archive's time
//
// Everything the archive says about the database is read here, in one go and
// before the first byte is written: the lab book, the photo rows, the
// history, the chain and the timestamps. Writing a year of photos can take
// long, and an entry or a stamp added meanwhile would otherwise end up in
// one file and not in another, which an auditor would read as tampering.
function snapshot(o) {
  const { dbApi, database } = o;
  const book = o.book || dbApi.labBook(database, o.opts || {});
  const photos = [];
  for (const e of book.experiments) {
    for (const p of e.photos) {
      if (p.purged) continue;
      const row = dbApi.getExperimentPhotoByUuid(database, p.uuid);
      if (!row) continue;
      photos.push({ e, p, rel: row.rel_path, sha256: row.sha256, name: String(p.id) + '.jpg' });
      if (row.original_path) {
        photos.push({
          e,
          p,
          rel: row.original_path,
          sha256: row.original_sha256,
          name: String(p.id) + '_original.jpg'
        });
      }
    }
  }
  return {
    book,
    photos,
    history: database.prepare('SELECT * FROM lab_history ORDER BY id').all(),
    chain: database
      .prepare('SELECT history_id, hash FROM lab_history_chain ORDER BY history_id')
      .all()
      .map((g) => ({ id: g.history_id, hash: g.hash })),
    stamps: dbApi.listLabTimestamps(database)
  };
}

async function writeLabArchive(o) {
  const opts = o.opts || {};
  const snap = snapshot(o);
  const { book } = snap;
  const zip = createZipWriter(o.out, { date: o.date || new Date(book.createdAt) });
  const sums = [];
  const add = async (name, data) => sums.push([await zip.addBuffer(name, data), name]);
  const photosRoot = path.join(o.dataDir, 'photos');
  const check = { files: 0, mismatched: [], missing: [] };

  await add('LIESMICH.txt', readme(book, opts, o.createdBy, book.chain));
  await add('laborbuch.json', JSON.stringify(book, null, 2) + '\n');

  for (const { e, p, rel, sha256: expected, name } of snap.photos) {
    const abs = path.join(o.dataDir, rel || '');
    const entry = 'fotos/' + folder(e) + '/' + name;
    if (!rel || !abs.startsWith(photosRoot + path.sep) || !fs.existsSync(abs)) {
      check.missing.push({ experiment: e.code, photo: p.id, file: entry });
      continue;
    }
    const r = await zip.addFile(entry, abs);
    sums.push([r.sha256, entry]);
    check.files++;
    if (expected && r.sha256 !== expected) {
      check.mismatched.push({ experiment: e.code, photo: p.id, file: entry, recorded: expected, found: r.sha256 });
    }
  }

  await add('pruefkette/verlauf.json', lines(snap.history));
  await add('pruefkette/kette.json', lines(snap.chain));
  for (const s of snap.stamps) await add('zeitstempel/' + s.id + '.tsr', Buffer.from(s.token));
  await add(
    'zeitstempel/zeitstempel.json',
    lines(snap.stamps.map((s) => ({ ...s, token: undefined, file: 'zeitstempel/' + s.id + '.tsr' })))
  );

  await add(
    'pruefung.json',
    JSON.stringify(
      {
        createdAt: book.createdAt,
        createdBy: o.createdBy || null,
        choice: { from: opts.from || null, to: opts.to || null, workPackageId: opts.workPackageId ?? null },
        chain: book.chain,
        // Every token's signature as the app checked it (scripts/rfc3161-verify.js),
        // so a reader sees which stamps it vouched for and why not the others,
        // with the time and serial the token itself names.
        stamps: snap.stamps.map((s) => ({
          id: s.id,
          historyId: s.historyId,
          file: 'zeitstempel/' + s.id + '.tsr',
          ...tokenTime(s.token),
          ...tokenSignature(s.token)
        })),
        photos: check
      },
      null,
      2
    ) + '\n'
  );
  // sha256sum reads "<hash>  <path>", two spaces for a binary-safe text mode.
  await zip.addBuffer('SHA256SUMS', sums.map(([h, n]) => h + '  ' + n).join('\n') + '\n');
  const done = await zip.finish();
  return { ...done, photos: check, chainOk: book.chain.ok };
}

module.exports = { writeLabArchive, fileName, folder };
