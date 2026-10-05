'use strict';
// Eine zurueckgespielte Sicherung im Verlauf.
//
// Mit einer Sicherung kommt ihr Verlauf zurueck; was danach geschrieben wurde,
// ist weg. Vorher stand davon nichts im Verlauf, und eine Datei mit
// gleichnamigen, aber wirkungslosen Triggern blieb so, wie sie war. Jetzt
// steht in jedem Versuch ein Eintrag, und openDb legt die Trigger jedes Mal neu
// an. Der Stand von vorher wird nicht mehr geloescht, sondern bleibt bei den
// Sicherungen, und der Eintrag nennt die Datei.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');

function neuePfad(name) {
  return path.join(
    os.tmpdir(),
    'mt_sicherung_' + name + '_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db'
  );
}
function weg(p) {
  for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
}

describe('Sicherung zurueckgespielt', () => {
  it('zaehlt die verworfenen Eintraege je Versuch und schreibt in jeden Versuch einen', () => {
    const p = neuePfad('marke');
    const d = db.openDb(p);
    try {
      const a = Number(db.insertExperiment(d, { code: 'S-1', title: 'Erster' }));
      const b = Number(db.insertExperiment(d, { code: 'S-2', title: 'Zweiter' }));
      const stand = db.lastHistoryId(d);
      db.updateExperiment(d, a, { outcome: 'spaeter eins' });
      db.updateExperiment(d, a, { outcome: 'spaeter zwei' });
      assert.deepEqual(db.historyAfter(d, stand), { [a]: 2 });
      db.markBackupRestore(d, { [a]: 2 }, { user_id: null, username: 'admin' });
      const marken = d
        .prepare(
          "SELECT experiment_id, username, new_value FROM lab_history WHERE action='backup' ORDER BY experiment_id"
        )
        .all();
      assert.deepEqual(
        marken.map((m) => [m.experiment_id, m.username, JSON.parse(m.new_value).discarded]),
        [
          [a, 'admin', 2],
          [b, 'admin', 0]
        ]
      );
    } finally {
      d.close();
      weg(p);
    }
  });

  it('legt die Schutz-Trigger beim Oeffnen neu an, auch wenn gleichnamige wirkungslos sind', () => {
    const p = neuePfad('trigger');
    let d = db.openDb(p);
    db.insertExperiment(d, { code: 'S-3', title: 'Dritter' });
    d.close();
    // Eine Datei, wie sie jemand von Hand zurechtgemacht haben koennte.
    const roh = new DatabaseSync(p);
    roh.exec(`DROP TRIGGER lab_history_no_update;
      DROP TRIGGER lab_history_no_delete;
      CREATE TRIGGER lab_history_no_update BEFORE UPDATE ON lab_history BEGIN SELECT 1; END;
      CREATE TRIGGER lab_history_no_delete BEFORE DELETE ON lab_history BEGIN SELECT 1; END;`);
    roh.close();
    d = db.openDb(p);
    try {
      assert.throws(() => d.prepare("UPDATE lab_history SET username='jemand'").run(), /append-only/);
      assert.throws(() => d.prepare('DELETE FROM lab_history').run(), /append-only/);
    } finally {
      d.close();
      weg(p);
    }
  });

  it('wird im Verlauf als eigene Zeile gezeigt', () => {
    const zeile = new Function(`
      const t = (k, o) => k + (o ? '(' + Object.values(o).join(',') + ')' : '');
      ${['esc', 'fmtDt', 'fmtDtTime', 'pjVerlaufWert', 'pjVerlaufZeile'].map((n) => hebeFunktion(n)).join('\n')}
      return pjVerlaufZeile;`)();
    const html = zeile(
      {
        id: 9,
        at: '2026-09-28T10:00:00.000Z',
        user: 'admin',
        entity: 'experiment',
        entityId: 1,
        action: 'backup',
        record: { discarded: 3 }
      },
      {}
    );
    assert.ok(html.includes('exp.hist.backup(3)'));
  });

  it('wird vom Zurueckspielen geschrieben, nach dem Tausch', () => {
    const src = quelle('server.js');
    const start = src.indexOf("req.url.startsWith('/api/backup/restore')");
    const route = src.slice(start, src.indexOf('// POST /api/print', start));
    const roh = route.indexOf('db.lastHistoryIdOfFile(tmpPath)');
    const migriert = route.indexOf('tmpDb = db.openDb(tmpPath)');
    const zaehlen = route.indexOf('db.historyAfter(database');
    const tausch = route.indexOf('swapRestoredDatabase(tmpPath)');
    const marke = route.indexOf('db.markBackupRestore(database');
    assert.ok(roh > 0 && roh < migriert, 'the backup is read before its migrations run');
    assert.ok(zaehlen > 0 && zaehlen < tausch, 'counted from the old file before the swap');
    assert.ok(marke > tausch, 'written into the restored file after the swap');
    assert.equal(route.includes('pre-restore.bak'), false, 'no file copy after closing any more');
  });

  it('nennt die aufgehobene Kopie von vorher, wenn es eine gibt', () => {
    const p = neuePfad('kopie');
    const d = db.openDb(p);
    try {
      db.insertExperiment(d, { code: 'S-4', title: 'Vierter' });
      db.markBackupRestore(
        d,
        {},
        { user_id: null, username: 'admin' },
        { kept: 'pre-restore-2026-10-03T10-00-00-000Z.db' }
      );
      db.markBackupRestore(d, {}, { user_id: null, username: 'admin' });
      const marken = d
        .prepare("SELECT new_value FROM lab_history WHERE action='backup' ORDER BY id")
        .all()
        .map((m) => JSON.parse(m.new_value));
      assert.equal(marken[0].kept, 'pre-restore-2026-10-03T10-00-00-000Z.db');
      assert.equal('kept' in marken[1], false, 'no copy, no name');
    } finally {
      d.close();
      weg(p);
    }
  });

  it('zeigt die Datei im Verlauf', () => {
    const zeile = new Function(`
      const t = (k, o) => k + (o ? '(' + Object.values(o).join(',') + ')' : '');
      ${['esc', 'fmtDt', 'fmtDtTime', 'pjVerlaufWert', 'pjVerlaufZeile'].map((n) => hebeFunktion(n)).join('\n')}
      return pjVerlaufZeile;`)();
    const html = zeile(
      {
        id: 10,
        at: '2026-10-03T10:00:00.000Z',
        user: 'admin',
        entity: 'experiment',
        entityId: 1,
        action: 'backup',
        record: { discarded: 2, kept: 'pre-restore-<x>.db' }
      },
      {}
    );
    assert.ok(html.includes('exp.hist.backup(2) exp.hist.backupKept(pre-restore-&lt;x&gt;.db)'));
  });
});

describe('Sicherung zurueckgespielt: Arbeitspakete und Zaehlung', () => {
  it('schreibt auch in jedes Arbeitspaket einen Eintrag, mit seinen verworfenen', () => {
    const p = neuePfad('pakete');
    const d = db.openDb(p);
    try {
      const wer = { user_id: null, username: 'admin' };
      const a = Number(db.insertWorkPackage(d, { code: 'P1', title: 'Eins' }, wer));
      const b = Number(db.insertWorkPackage(d, { code: 'P2', title: 'Zwei' }, wer));
      const stand = db.lastHistoryId(d);
      db.updateWorkPackage(d, a, { title: 'Eins, neu' }, wer);
      db.updateWorkPackage(d, a, { archived: true }, wer);
      assert.deepEqual(db.historyAfterPackages(d, stand), { [a]: 2 });
      assert.deepEqual(db.historyAfter(d, stand), {}, 'packages belong to no experiment');
      db.markBackupRestore(d, {}, wer, { kept: 'pre-restore-x.db', packages: { [a]: 2 } });
      const marken = d
        .prepare(
          "SELECT entity_id, experiment_id, new_value FROM lab_history WHERE action='backup' AND entity='work_package' ORDER BY entity_id"
        )
        .all();
      assert.deepEqual(
        marken.map((m) => [
          m.entity_id,
          m.experiment_id,
          JSON.parse(m.new_value).discarded,
          JSON.parse(m.new_value).kept
        ]),
        [
          [a, null, 2, 'pre-restore-x.db'],
          [b, null, 0, 'pre-restore-x.db']
        ]
      );
    } finally {
      d.close();
      weg(p);
    }
  });

  it('zeigt die Zeile eines Pakets mit seinem eigenen Wortlaut', () => {
    const zeile = new Function(`
      const t = (k, o) => k + (o ? '(' + Object.values(o).join(',') + ')' : '');
      ${['esc', 'fmtDt', 'fmtDtTime', 'pjVerlaufWert', 'pjVerlaufZeile'].map((n) => hebeFunktion(n)).join('\n')}
      return pjVerlaufZeile;`)();
    const html = zeile(
      {
        id: 3,
        at: '2026-10-03T10:00:00.000Z',
        user: 'admin',
        entity: 'work_package',
        entityId: 2,
        action: 'backup',
        record: { discarded: 1 }
      },
      {}
    );
    assert.ok(html.includes('exp.hist.backupWp(1)'));
  });

  it('liest den juengsten Eintrag einer Sicherung, bevor ihre Migrationen laufen', () => {
    const p = neuePfad('roh');
    const d = db.openDb(p);
    try {
      db.insertExperiment(d, { code: 'R-1', title: 'Roh' });
      // Ein Paket von vor v96: ohne Eintrag. Laeuft v96 noch einmal, kommt ein
      // Ausgangsstand dazu, und den darf die Zaehlung nicht mitnehmen.
      d.prepare("INSERT INTO work_packages(code,title,archived,sort,created) VALUES('A','alt',0,1,'2026-09-30')").run();
      // Eine Sicherung von vor v96 kennt auch die Pruefkette (v97) nicht.
      d.exec('DROP TABLE lab_history_chain; DROP TABLE lab_timestamps');
      d.prepare('DELETE FROM schema_version WHERE version IN (96, 97)').run();
      const vorher = db.lastHistoryId(d);
      d.close();
      assert.equal(db.lastHistoryIdOfFile(p), vorher);
      const migriert = db.openDb(p);
      assert.equal(db.lastHistoryId(migriert), vorher + 1, 'v96 added a baseline');
      migriert.close();
      const leer = neuePfad('ohne');
      const roh = new DatabaseSync(leer);
      roh.exec('CREATE TABLE t(x)');
      roh.close();
      assert.equal(db.lastHistoryIdOfFile(leer), 0, 'a file without a history');
      weg(leer);
    } finally {
      weg(p);
    }
  });
});

describe('Der Tausch beim Zurueckspielen', () => {
  // swapRestoredDatabase aus server.js, gegen echte Dateien.
  function tausch(ordner, opts = {}) {
    const DB_FILE = path.join(ordner, 'meistertracker.db');
    const BACKUP_DIR = opts.backupDir || path.join(ordner, 'backups');
    fs.mkdirSync(path.join(ordner, 'backups'), { recursive: true });
    const logs = [];
    // neueGehtNichtAuf: das naechste openDb scheitert, mit 'immer' jedes.
    let kaputt = opts.neueGehtNichtAuf === 'immer' ? Infinity : opts.neueGehtNichtAuf ? 1 : 0;
    const dbApi = {
      ...db,
      openDb: (p) => {
        if (kaputt > 0) {
          kaputt--;
          throw new Error('kaputt');
        }
        return db.openDb(p);
      }
    };
    // opts.fs ersetzt einzelne Funktionen, um einen Fehler beim Kopieren zu stellen.
    const dateien = opts.fs ? { ...fs, ...opts.fs } : fs;
    const start = db.openDb(DB_FILE);
    const h = new Function(
      'db',
      'fs',
      'path',
      'log',
      'DB_FILE',
      'BACKUP_DIR',
      'closeAllMcpSessions',
      'start',
      `let database = start;
      ${hebeFunktion('swapRestoredDatabase', quelle('server.js'))}
      return { swap: swapRestoredDatabase, aktuell: () => database };`
    )(
      dbApi,
      dateien,
      path,
      (level, msg) => logs.push([level, msg]),
      DB_FILE,
      BACKUP_DIR,
      () => {},
      start
    );
    return { ...h, DB_FILE, BACKUP_DIR, logs, start };
  }
  // Eine Sicherung mit anderem Inhalt, wie sie das Zurueckspielen nach der
  // Pruefung ablegt.
  function sicherung(ordner, titel) {
    const quelle_ = path.join(ordner, 'quelle.db');
    const q = db.openDb(quelle_);
    db.insertExperiment(q, { code: 'B-1', title: titel });
    const tmp = path.join(ordner, 'backups', '_restore_tmp_test.db');
    q.prepare('VACUUM INTO ?').run(tmp);
    q.close();
    weg(quelle_);
    return tmp;
  }
  const titel = (d) =>
    d
      .prepare('SELECT title FROM experiments ORDER BY id')
      .all()
      .map((z) => z.title);

  it('tauscht und hebt den Stand davor ganz auf, auch was nur im WAL stand', () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_tausch_'));
    try {
      const t = tausch(ordner);
      db.insertExperiment(t.start, { code: 'A-1', title: 'Alt eins' });
      db.insertExperiment(t.start, { code: 'A-2', title: 'Alt zwei' });
      const tmp = sicherung(ordner, 'Aus der Sicherung');
      const r = t.swap(tmp);
      assert.equal(r.ok, true);
      assert.match(r.kept, /^pre-restore-\d{4}-\d{2}-\d{2}T[\d-]+Z\.db$/);
      assert.deepEqual(titel(t.aktuell()), ['Aus der Sicherung']);
      const kopie = new DatabaseSync(path.join(t.BACKUP_DIR, r.kept), { readOnly: true });
      assert.deepEqual(titel(kopie), ['Alt eins', 'Alt zwei']);
      kopie.close();
      assert.equal(fs.existsSync(tmp), false, 'the temp file became the database');
      t.aktuell().close();
    } finally {
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });

  it('tauscht nicht, solange ein anderes Programm die Datenbank offen hat, und verliert nichts', () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_tausch_'));
    const t = tausch(ordner);
    const fremd = new DatabaseSync(t.DB_FILE, { readOnly: true });
    try {
      fremd.prepare('SELECT COUNT(*) AS n FROM experiments').get();
      db.insertExperiment(t.start, { code: 'A-1', title: 'Alt eins' });
      const tmp = sicherung(ordner, 'Aus der Sicherung');
      const r = t.swap(tmp);
      assert.equal(r.ok, false);
      assert.equal(r.status, 409);
      assert.deepEqual(titel(t.aktuell()), ['Alt eins'], 'the original is open again, complete');
      assert.equal(
        fs.readdirSync(t.BACKUP_DIR).some((n) => n.startsWith('pre-restore-')),
        false,
        'no copy named for a restore that did not happen'
      );
      assert.ok(fs.existsSync(tmp), 'the route removes the temp file');
      assert.equal(t.logs.at(-1)[0], 'warn');
    } finally {
      fremd.close();
      try {
        t.aktuell().close();
      } catch {
        // schon zu
      }
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });

  it('tauscht nicht, wenn sich der Stand davor nicht sichern laesst', () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_tausch_'));
    try {
      const t = tausch(ordner, { backupDir: path.join(ordner, 'gibt-es-nicht') });
      db.insertExperiment(t.start, { code: 'A-1', title: 'Alt eins' });
      const tmp = sicherung(ordner, 'Aus der Sicherung');
      const r = t.swap(tmp);
      assert.equal(r.ok, false);
      assert.equal(r.status, 500);
      assert.equal(t.aktuell(), t.start, 'the database was never closed');
      assert.deepEqual(titel(t.aktuell()), ['Alt eins']);
      t.aktuell().close();
    } finally {
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });

  it('geht zum Stand davor zurueck, wenn die neue Datei nicht aufgeht, und behaelt die Kopie', () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_tausch_'));
    try {
      const t = tausch(ordner, { neueGehtNichtAuf: true });
      db.insertExperiment(t.start, { code: 'A-1', title: 'Alt eins' });
      const tmp = sicherung(ordner, 'Aus der Sicherung');
      const r = t.swap(tmp);
      assert.equal(r.ok, false);
      assert.equal(r.status, 500);
      assert.deepEqual(titel(t.aktuell()), ['Alt eins']);
      assert.ok(fs.readdirSync(t.BACKUP_DIR).some((n) => n.startsWith('pre-restore-')));
      t.aktuell().close();
    } finally {
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });

  it('gibt die Sicherung nicht als den Stand davor aus, wenn auch der Weg zurueck scheitert', () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_tausch_'));
    const kopieGehtNicht = () => {
      throw new Error('EBUSY');
    };
    try {
      // Die neue Datei geht nicht auf, die Kopie kommt nicht zurueck, und auch
      // ein zweites Oeffnen scheitert: dann bleibt die Datenbank zu, und die
      // Antwort nennt die Kopie, statt "Stand davor erhalten" zu sagen.
      const t = tausch(ordner, { neueGehtNichtAuf: 'immer', fs: { copyFileSync: kopieGehtNicht } });
      db.insertExperiment(t.start, { code: 'A-1', title: 'Alt eins' });
      const r = t.swap(sicherung(ordner, 'Aus der Sicherung'));
      assert.equal(r.ok, false);
      assert.equal(r.status, 500);
      assert.match(r.error, /could not be reopened/);
      assert.match(r.error, /still the restored backup/, 'says which file a restart would open');
      assert.match(r.error, /pre-restore-[\d-]+T[\d-]+Z\.db/);
      assert.throws(() => t.aktuell().prepare('SELECT 1').get(), 'no handle on the wrong file');
      const kopie = fs.readdirSync(t.BACKUP_DIR).find((n) => n.startsWith('pre-restore-'));
      const alt = new DatabaseSync(path.join(t.BACKUP_DIR, kopie), { readOnly: true });
      assert.deepEqual(titel(alt), ['Alt eins'], 'the copy holds the data from before');
      alt.close();
    } finally {
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });

  it('zaehlt es als geklappt, wenn die Kopie nicht zurueckkommt, die neue Datei aber doch aufgeht', () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_tausch_'));
    try {
      const t = tausch(ordner, {
        neueGehtNichtAuf: true,
        fs: {
          copyFileSync: () => {
            throw new Error('EBUSY');
          }
        }
      });
      db.insertExperiment(t.start, { code: 'A-1', title: 'Alt eins' });
      const r = t.swap(sicherung(ordner, 'Aus der Sicherung'));
      assert.equal(r.ok, true);
      assert.deepEqual(titel(t.aktuell()), ['Aus der Sicherung'], 'what is open is what the answer says');
      t.aktuell().close();
    } finally {
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });

  it('laesst die Datei nicht offen, wenn openDb scheitert', () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_tausch_'));
    try {
      // Eine Datei, an der das Einrichten scheitert: ihr Verlauf hat keine
      // Spalte experiment_id, die der Index darauf braucht.
      const p = path.join(ordner, 'kaputt.db');
      const roh = new DatabaseSync(p);
      roh.exec('PRAGMA journal_mode=WAL; CREATE TABLE lab_history(id INTEGER PRIMARY KEY)');
      roh.close();
      assert.throws(() => db.openDb(p));
      // Das Journal umstellen darf nur, wer die Datei allein hat. Haette openDb
      // seinen Griff offen gelassen, hiesse es hier "database is locked", und
      // unter Windows liesse sich die Datei weder ersetzen noch zurueckholen.
      const pruef = new DatabaseSync(p);
      pruef.exec('PRAGMA journal_mode=DELETE');
      assert.equal(pruef.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
      pruef.close();
    } finally {
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });
});
