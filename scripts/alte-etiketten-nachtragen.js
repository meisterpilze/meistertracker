'use strict';
// Etiketten von vor einem Neustart der Daten nachtragen.
//
// Seit es alte_etiketten gibt, merkt sich der Neustart (resetOperationalData)
// selbst, welche Kulturen er geloescht hat. Fuer einen Neustart davor gibt es
// nur die Sicherung, die er vorher geschrieben hat (pre-reset-*.db). Dieses
// Skript liest aus ihr die Kulturen, die damals im Labor standen und heute nicht
// in der App sind, samt ihrer Nummer. Danach erkennt der Scan ihre Etiketten,
// nimmt sie wieder auf und druckt ein neues; und keine dieser Nummern wird je
// wieder vergeben.
//
// Was in der Sicherung steht, sind Daten eines Labors; sie bleiben auf dem
// Rechner und kommen nicht in dieses Repository.
//
//   node scripts/alte-etiketten-nachtragen.js <sicherung.db>              # zeigen, was dazukaeme
//   node scripts/alte-etiketten-nachtragen.js <sicherung.db> --write      # eintragen
//   node scripts/alte-etiketten-nachtragen.js <sicherung.db> --db <datei> # eine andere Datenbank
//
// Ohne --db die Datenbank des Servers (MT_DB_FILE, sonst meistertracker.db
// neben server.js). Der Server darf laufen; er sieht die Eintraege beim
// naechsten Laden der App.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = require(path.join(__dirname, '..', 'db.js'));

const USAGE = 'Usage: node scripts/alte-etiketten-nachtragen.js <sicherung.db> [--write] [--db <datei>]';

function main(argv) {
  const args = argv.slice(2);
  const quelle = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--db');
  if (!quelle || !fs.existsSync(quelle)) {
    console.error(USAGE);
    process.exit(2);
  }
  const i = args.indexOf('--db');
  const ziel =
    i >= 0 && args[i + 1] ? args[i + 1] : process.env.MT_DB_FILE || path.join(__dirname, '..', 'meistertracker.db');
  if (path.resolve(ziel) === path.resolve(quelle)) {
    console.error('Sicherung und Ziel sind dieselbe Datei.');
    process.exit(2);
  }
  const alt = new DatabaseSync(quelle, { readOnly: true });
  const d = db.openDb(ziel);
  try {
    d.exec('BEGIN');
    const n = db.alteEtikettenSichern(d, alt);
    const naechste = db.nextBarcodeNumber(d);
    if (args.includes('--write')) d.exec('COMMIT');
    else d.exec('ROLLBACK');
    console.log(
      (args.includes('--write') ? 'Eingetragen: ' : 'Kaeme dazu (ohne --write nichts geschrieben): ') +
        n +
        ' alte Etiketten. Naechste neue Nummer: ' +
        naechste +
        '.'
    );
  } catch (e) {
    try {
      d.exec('ROLLBACK');
    } catch {
      /* schon zu */
    }
    throw e;
  } finally {
    d.close();
    alt.close();
  }
}

if (require.main === module) main(process.argv);
module.exports = { main };
