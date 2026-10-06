'use strict';
// Eine zurueckgespielte Sicherung im Verlauf.
//
// Mit einer Sicherung kommt ihr Verlauf zurueck; was danach geschrieben wurde,
// ist weg. Vorher stand davon nichts im Verlauf, und eine Datei mit
// gleichnamigen, aber wirkungslosen Triggern blieb so, wie sie war. Jetzt
// steht ein Eintrag fuer das Ganze im Verlauf und einer in jedem Versuch und
// jedem Arbeitspaket, und openDb legt die Trigger jedes Mal neu an. Der Stand
// von vorher wird nicht mehr geloescht, sondern bleibt bei den Sicherungen,
// und die Eintraege nennen die Datei.
//
// Gezaehlt wird gegen die Pruefkette der Sicherung, so wie sie ist. Nach der
// Kennung allein ging es nach einem frueheren Zurueckspielen schief: die Datei
// vergibt Kennungen dann ein zweites Mal, und wer erst die Sicherung vom
// Morgen und dann die vom Mittag zurueckspielte, verlor Eintraege, die als 0
// zaehlten. Versuche, die es erst nach der Sicherung gab, wurden gezaehlt und
// nirgends genannt, und eine Sicherung ohne Versuch und Paket bekam gar keinen
// Eintrag.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const ADMIN = { user_id: null, username: 'admin' };

function neuePfad(name) {
  return path.join(
    os.tmpdir(),
    'mt_sicherung_' + name + '_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db'
  );
}
function weg(p) {
  for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
}
// Eine Datenbank, die sich sichern und zurueckspielen laesst, so wie es der
// Server tut: gegen die Sicherung zaehlen, die Datei tauschen, oeffnen, und
// festhalten, was geschah.
function labor(name) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_sicherung_' + name + '_'));
  const datei = path.join(ordner, 'live.db');
  let n = 0;
  const x = {
    d: db.openDb(datei),
    datei,
    sichern() {
      const p = path.join(ordner, 'sicherung-' + ++n + '.db');
      x.d.prepare('VACUUM INTO ?').run(p);
      return p;
    },
    zurueckspielen(sicherung, kept) {
      const gezaehlt = db.historyDiscarded(x.d, sicherung);
      x.d.close();
      weg(datei);
      fs.copyFileSync(sicherung, datei);
      x.d = db.openDb(datei);
      db.markBackupRestore(x.d, gezaehlt, ADMIN, kept);
      return gezaehlt;
    },
    weg() {
      try {
        x.d.close();
      } catch {
        // schon zu
      }
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  };
  return x;
}
// Der Eintrag fuer das Ganze, den das letzte Zurueckspielen geschrieben hat.
function fuerDasGanze(d) {
  const z = d
    .prepare("SELECT * FROM lab_history WHERE entity='database' AND action='backup' ORDER BY id DESC LIMIT 1")
    .get();
  return z && { ...z, record: JSON.parse(z.new_value) };
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
// Macht aus einer Sicherung eine von vor v97: ohne Kette und Zeitstempel.
function ohneKette(p) {
  const roh = new DatabaseSync(p);
  roh.exec('DROP TABLE lab_history_chain; DROP TABLE lab_timestamps; DELETE FROM schema_version WHERE version=97');
  roh.close();
  return p;
}

describe('Sicherung zurueckgespielt', () => {
  it('zaehlt die verworfenen Eintraege je Versuch und schreibt in jeden Versuch einen', () => {
    const x = labor('marke');
    try {
      const a = Number(db.insertExperiment(x.d, { code: 'S-1', title: 'Erster' }));
      const b = Number(db.insertExperiment(x.d, { code: 'S-2', title: 'Zweiter' }));
      const sicherung = x.sichern();
      db.updateExperiment(x.d, a, { outcome: 'spaeter eins' });
      db.updateExperiment(x.d, a, { outcome: 'spaeter zwei' });
      const gezaehlt = x.zurueckspielen(sicherung);
      assert.equal(gezaehlt.total, 2);
      assert.deepEqual(gezaehlt.experiments, [{ id: a, code: 'S-1', discarded: 2, inBackup: true }]);
      const marken = x.d
        .prepare(
          "SELECT experiment_id, username, new_value FROM lab_history WHERE action='backup' AND entity='experiment' ORDER BY experiment_id"
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
      x.weg();
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

  it('wird vom Zurueckspielen geschrieben, gezaehlt gegen die Sicherung vor ihren Migrationen', () => {
    const src = quelle('server.js');
    const start = src.indexOf("req.url.startsWith('/api/backup/restore')");
    const route = src.slice(start, src.indexOf('// POST /api/print', start));
    const zaehlen = route.indexOf('db.historyDiscarded(database, tmpPath)');
    const migriert = route.indexOf('tmpDb = db.openDb(tmpPath)');
    const tausch = route.indexOf('swapRestoredDatabase(tmpPath)');
    const marke = route.indexOf('db.markBackupRestore(database');
    assert.ok(zaehlen > 0 && zaehlen < migriert, 'counted against the backup before its migrations run');
    assert.ok(migriert < tausch, 'counted from the old file before the swap');
    assert.ok(marke > tausch, 'written into the restored file after the swap');
    assert.equal(route.includes('pre-restore.bak'), false, 'no file copy after closing any more');
  });

  it('nennt die aufgehobene Kopie von vorher, wenn es eine gibt', () => {
    const p = neuePfad('kopie');
    const d = db.openDb(p);
    try {
      db.insertExperiment(d, { code: 'S-4', title: 'Vierter' });
      db.markBackupRestore(d, null, ADMIN, 'pre-restore-2026-10-03T10-00-00-000Z.db');
      db.markBackupRestore(d, null, ADMIN);
      for (const art of ['database', 'experiment']) {
        const marken = d
          .prepare("SELECT new_value FROM lab_history WHERE action='backup' AND entity=? ORDER BY id")
          .all(art)
          .map((m) => JSON.parse(m.new_value));
        assert.equal(marken[0].kept, 'pre-restore-2026-10-03T10-00-00-000Z.db', art);
        assert.equal('kept' in marken[1], false, 'no copy, no name');
      }
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
    const x = labor('pakete');
    try {
      const a = Number(db.insertWorkPackage(x.d, { code: 'P1', title: 'Eins' }, ADMIN));
      const b = Number(db.insertWorkPackage(x.d, { code: 'P2', title: 'Zwei' }, ADMIN));
      const sicherung = x.sichern();
      db.updateWorkPackage(x.d, a, { title: 'Eins, neu' }, ADMIN);
      db.updateWorkPackage(x.d, a, { archived: true }, ADMIN);
      const gezaehlt = x.zurueckspielen(sicherung, 'pre-restore-x.db');
      assert.deepEqual(gezaehlt.workPackages, [{ id: a, code: 'P1', discarded: 2, inBackup: true }]);
      assert.deepEqual(gezaehlt.experiments, [], 'packages belong to no experiment');
      const marken = x.d
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
      x.weg();
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

  it('liest die Sicherung, wie sie ist, bevor ihre Migrationen laufen', () => {
    const p = neuePfad('roh');
    const jetzt = labor('roh_jetzt');
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
      assert.equal(db.historyDiscarded(jetzt.d, p).last, vorher);
      const migriert = db.openDb(p);
      assert.equal(db.lastHistoryId(migriert), vorher + 1, 'v96 added a baseline');
      migriert.close();
      const leer = neuePfad('ohne');
      const roh = new DatabaseSync(leer);
      roh.exec('CREATE TABLE t(x)');
      roh.close();
      const ohne = db.historyDiscarded(jetzt.d, leer);
      assert.deepEqual([ohne.counted, ohne.last], ['id', 0], 'a file without a history');
      weg(leer);
    } finally {
      weg(p);
      jetzt.weg();
    }
  });
});

describe('Sicherung zurueckgespielt: gegen ihre Pruefkette gezaehlt', () => {
  it('zaehlt richtig, auch wenn Kennungen nach einem frueheren Zurueckspielen ein zweites Mal vergeben sind', () => {
    const x = labor('morgen_mittag');
    try {
      const a = Number(db.insertExperiment(x.d, { code: 'MM-1', title: 'Erster' }, ADMIN));
      db.updateExperiment(x.d, a, { outcome: 'morgens' }, ADMIN);
      const morgen = x.sichern();
      for (const o of ['eins', 'zwei', 'drei', 'vier']) db.updateExperiment(x.d, a, { outcome: o }, ADMIN);
      const mittag = x.sichern();
      assert.equal(x.zurueckspielen(morgen, 'pre-restore-morgen.db').total, 4);
      db.updateExperiment(x.d, a, { outcome: 'nachmittags' }, ADMIN);
      const jetzt = db.lastHistoryId(x.d);
      const gezaehlt = db.historyDiscarded(x.d, mittag);
      // Jede Kennung der Datei gibt es auch in der Sicherung vom Mittag, nur
      // mit anderen Eintraegen: nach Kennung gezaehlt war das 0.
      assert.ok(jetzt <= gezaehlt.last);
      assert.equal(x.d.prepare('SELECT COUNT(*) AS n FROM lab_history WHERE id>?').get(gezaehlt.last).n, 0);
      // Verworfen ist alles nach dem Morgen: die Eintraege, die das erste
      // Zurueckspielen geschrieben hat, und der Nachmittag.
      assert.equal(gezaehlt.counted, 'chain');
      assert.equal(gezaehlt.total, 3);
      assert.deepEqual(gezaehlt.experiments, [{ id: a, code: 'MM-1', discarded: 2, inBackup: true }]);
      x.zurueckspielen(mittag, 'pre-restore-mittag.db');
      const r = fuerDasGanze(x.d).record;
      assert.equal(r.discarded, 3);
      assert.equal(r.kept, 'pre-restore-mittag.db');
      const eigen = x.d
        .prepare(
          "SELECT new_value FROM lab_history WHERE entity='experiment' AND action='backup' ORDER BY id DESC LIMIT 1"
        )
        .get();
      assert.equal(JSON.parse(eigen.new_value).discarded, 2);
    } finally {
      x.weg();
    }
  });

  it('nennt Versuche, die erst nach der Sicherung kamen, und schreibt ihre Zahl keinem unter derselben Kennung zu', () => {
    const x = labor('danach');
    try {
      const a = Number(db.insertExperiment(x.d, { code: 'N-1', title: 'Von Anfang an' }, ADMIN));
      const frueh = x.sichern();
      const b = Number(db.insertExperiment(x.d, { code: 'N-2', title: 'Erst danach' }, ADMIN));
      db.updateExperiment(x.d, b, { outcome: 'b' }, ADMIN);
      const spaet = x.sichern();
      // Zurueck auf frueh: N-2 gibt es danach nicht mehr, nur der Eintrag fuer
      // das Ganze nennt ihn noch.
      const erste = x.zurueckspielen(frueh, 'pre-restore-1.db');
      assert.deepEqual(erste.experiments, [{ id: b, code: 'N-2', discarded: 2, inBackup: false }]);
      assert.deepEqual(fuerDasGanze(x.d).record.experiments, erste.experiments);
      assert.equal(x.d.prepare('SELECT COUNT(*) AS n FROM experiments WHERE id=?').get(b).n, 0);
      // Ein neuer Versuch bekommt die Kennung, die N-2 hatte.
      const c = Number(db.insertExperiment(x.d, { code: 'N-3', title: 'Unter alter Kennung' }, ADMIN));
      assert.equal(c, b, 'the id is handed out a second time');
      db.updateExperiment(x.d, c, { outcome: 'c' }, ADMIN);
      // Zurueck auf spaet, wo die Kennung wieder N-2 gehoert.
      const zweite = x.zurueckspielen(spaet, 'pre-restore-2.db');
      assert.deepEqual(zweite.experiments, [
        { id: a, code: 'N-1', discarded: 1, inBackup: true },
        { id: c, code: 'N-3', discarded: 2, inBackup: false }
      ]);
      // N-2 ist zurueck, und in seinem Verlauf steht 0: was verworfen wurde,
      // gehoerte N-3.
      const ganz = fuerDasGanze(x.d);
      const einzeln = x.d
        .prepare(
          "SELECT experiment_id, new_value FROM lab_history WHERE entity='experiment' AND action='backup' AND id>? ORDER BY experiment_id"
        )
        .all(ganz.id)
        .map((z) => [z.experiment_id, JSON.parse(z.new_value).discarded]);
      assert.deepEqual(einzeln, [
        [a, 1],
        [b, 0]
      ]);
    } finally {
      x.weg();
    }
  });

  it('zaehlt Eintraege ohne Glied am Ende der Sicherung nicht als verworfen, und laesst ihre Datei, wie sie ist', () => {
    const x = labor('ende');
    try {
      const a = Number(db.insertExperiment(x.d, { code: 'E-1', title: 'Ende' }, ADMIN));
      // So schreibt eine aeltere Version, die die Kette nicht kennt: sie haengt
      // an, nur ohne Glied.
      const fremd = ['2026-10-04T12:00:00.000Z', '2026-10-04T12:05:00.000Z'].map((at) =>
        Number(
          x.d
            .prepare(
              "INSERT INTO lab_history(at,entity,entity_id,experiment_id,action,new_value) VALUES(?,'experiment',?,?,'update','{}')"
            )
            .run(at, a, a).lastInsertRowid
        )
      );
      const sicherung = x.sichern();
      const vorher = sha(sicherung);
      // Der naechste Start nimmt sie in die Kette, mit einem Vermerk, und es
      // geht weiter.
      x.d.close();
      x.d = db.openDb(x.datei);
      db.updateExperiment(x.d, a, { outcome: 'danach' }, ADMIN);
      const glieder = () =>
        x.d
          .prepare('SELECT history_id, hash FROM lab_history_chain WHERE history_id IN (?, ?) ORDER BY history_id')
          .all(...fremd)
          .map((g) => ({ ...g }));
      const davor = glieder();
      assert.equal(davor.length, 2);
      const gezaehlt = db.historyDiscarded(x.d, sicherung);
      // Verworfen sind der Vermerk und was danach kam. Die beiden hat die
      // Sicherung, nur noch ohne Glied, und ihr naechster Start gibt ihnen
      // dieselben.
      assert.equal(gezaehlt.counted, 'chain');
      assert.equal(gezaehlt.last, fremd[1]);
      assert.equal(gezaehlt.total, 2);
      assert.deepEqual(gezaehlt.experiments, [{ id: a, code: 'E-1', discarded: 1, inBackup: true }]);
      assert.equal(sha(sicherung), vorher, 'counting neither migrates the backup nor links its tail');
      // Lesend geoeffnet: bei SELECTs allein saehe die Pruefsumme keinen Unterschied.
      assert.match(hebeFunktion('historyDiscarded', quelle('db.js')), /new Database\(datei, \{ readOnly: true \}\)/);
      x.zurueckspielen(sicherung);
      assert.deepEqual(glieder(), davor);
      assert.equal(db.labChainStatus(x.d).ok, true);
    } finally {
      x.weg();
    }
  });

  it('vergleicht einen Eintrag ohne Glied Spalte fuer Spalte mit dem der Sicherung', () => {
    const x = labor('bruch');
    try {
      const a = Number(db.insertExperiment(x.d, { code: 'B-1', title: 'Bruch' }, ADMIN));
      db.updateExperiment(x.d, a, { outcome: 'eins' }, ADMIN);
      db.updateExperiment(x.d, a, { outcome: 'zwei' }, ADMIN);
      const sicherung = x.sichern();
      const ids = x.d
        .prepare('SELECT id FROM lab_history ORDER BY id')
        .all()
        .map((z) => z.id);
      // Wer die Datei in der Hand hat: zwei Glieder weg, und einer der beiden
      // Eintraege geaendert.
      x.d.exec('DROP TRIGGER lab_history_no_update; DROP TRIGGER lab_history_chain_no_delete');
      x.d.prepare('DELETE FROM lab_history_chain WHERE history_id IN (?, ?)').run(ids[1], ids[2]);
      x.d.prepare("UPDATE lab_history SET new_value='geschoent' WHERE id=?").run(ids[2]);
      const gezaehlt = db.historyDiscarded(x.d, sicherung);
      // Der unveraenderte steht so in der Sicherung, der geaenderte nicht.
      assert.equal(gezaehlt.total, 1);
      assert.deepEqual(gezaehlt.experiments, [{ id: a, code: 'B-1', discarded: 1, inBackup: true }]);
    } finally {
      x.weg();
    }
  });

  it('zaehlt eine Sicherung von vor der Kette nach Kennung und sagt das', () => {
    const x = labor('alt');
    try {
      const a = Number(db.insertExperiment(x.d, { code: 'A-1', title: 'Alt' }, ADMIN));
      const sicherung = x.sichern();
      // So sieht eine Sicherung von vor v97 aus: ohne Kette und Zeitstempel.
      const roh = new DatabaseSync(sicherung);
      roh.exec('DROP TABLE lab_history_chain; DROP TABLE lab_timestamps; DELETE FROM schema_version WHERE version=97');
      roh.close();
      db.updateExperiment(x.d, a, { outcome: 'danach' }, ADMIN);
      const b = Number(db.insertExperiment(x.d, { code: 'A-2', title: 'Neu' }, ADMIN));
      const gezaehlt = db.historyDiscarded(x.d, sicherung);
      assert.equal(gezaehlt.counted, 'id');
      assert.equal(gezaehlt.total, 2);
      // Welche Versuche sie hat, sagt dann ihre Tabelle.
      assert.deepEqual(gezaehlt.experiments, [
        { id: a, code: 'A-1', discarded: 1, inBackup: true },
        { id: b, code: 'A-2', discarded: 1, inBackup: false }
      ]);
      x.zurueckspielen(sicherung, 'pre-restore-alt.db');
      assert.equal(fuerDasGanze(x.d).record.counted, 'id');
      assert.equal(db.labChainStatus(x.d).ok, true, 'the restored file gets its chain from v97');
    } finally {
      x.weg();
    }
  });

  it('zaehlt nach Kennung gegen die geoeffnete Sicherung, wenn sie sich vorher nicht lesen liess', () => {
    const x = labor('notfall');
    try {
      const a = Number(db.insertExperiment(x.d, { code: 'F-1', title: 'Notfall' }, ADMIN));
      const sicherung = x.sichern();
      db.updateExperiment(x.d, a, { outcome: 'danach' }, ADMIN);
      const offen = db.openDb(sicherung);
      try {
        const gezaehlt = db.historyDiscardedById(x.d, offen);
        assert.deepEqual(
          { counted: gezaehlt.counted, last: gezaehlt.last, total: gezaehlt.total },
          { counted: 'migrated', last: db.lastHistoryId(offen), total: 1 }
        );
      } finally {
        offen.close();
      }
    } finally {
      x.weg();
    }
  });
});

describe('Sicherung zurueckgespielt: welcher Versuch, welches Paket', () => {
  it('erkennt ein Paket der Sicherung auch, wenn beide Seiten ihren Ausgangsstand selbst geschrieben haben', () => {
    const x = labor('ausgangsstand');
    try {
      // Ein Paket von vor v96, ohne Eintrag, und v96 gilt als nicht gelaufen.
      const wp = Number(
        x.d
          .prepare(
            "INSERT INTO work_packages(code,title,archived,sort,created) VALUES('WP1','Paket',0,1,'2026-09-30T10:00:00.000Z')"
          )
          .run().lastInsertRowid
      );
      x.d.prepare('DELETE FROM schema_version WHERE version=96').run();
      const vor96 = x.sichern();
      // Der naechste Start schreibt den Ausgangsstand, dann die Sicherung danach.
      x.d.close();
      x.d = db.openDb(x.datei);
      const nach96 = x.sichern();
      // Zurueck auf vor96: beim Oeffnen schreibt sie ihren eigenen
      // Ausgangsstand, zu einer anderen Zeit. Dann wird das Paket geaendert.
      x.zurueckspielen(vor96, 'pre-restore-1.db');
      db.updateWorkPackage(x.d, wp, { title: 'Paket, neu' }, ADMIN);
      const gezaehlt = x.zurueckspielen(nach96, 'pre-restore-2.db');
      // Keinen seiner Eintraege hat nach96, und doch ist es dasselbe Paket.
      assert.equal(gezaehlt.counted, 'chain');
      assert.deepEqual(gezaehlt.workPackages, [{ id: wp, code: 'WP1', discarded: 3, inBackup: true }]);
      const eigen = x.d
        .prepare(
          "SELECT new_value FROM lab_history WHERE entity='work_package' AND action='backup' ORDER BY id DESC LIMIT 1"
        )
        .get();
      assert.equal(JSON.parse(eigen.new_value).discarded, 3);
    } finally {
      x.weg();
    }
  });

  it('gibt bei einer Sicherung von vor der Kette nichts einem anderen Versuch unter derselben Kennung', () => {
    const x = labor('kennung');
    try {
      const a = Number(db.insertExperiment(x.d, { code: 'K-1', title: 'Von Anfang an' }, ADMIN));
      const frueh = ohneKette(x.sichern());
      const y = Number(db.insertExperiment(x.d, { code: 'K-Y', title: 'Erst danach' }, ADMIN));
      db.updateExperiment(x.d, y, { outcome: 'y' }, ADMIN);
      const spaet = ohneKette(x.sichern());
      x.zurueckspielen(frueh, 'pre-restore-1.db');
      // Die Kennung von K-Y bekommt ein anderer Versuch.
      const z = Number(db.insertExperiment(x.d, { code: 'K-Z', title: 'Unter alter Kennung' }, ADMIN));
      assert.equal(z, y, 'the id is handed out a second time');
      for (const o of ['eins', 'zwei', 'drei']) db.updateExperiment(x.d, z, { outcome: o }, ADMIN);
      const gezaehlt = x.zurueckspielen(spaet, 'pre-restore-2.db');
      assert.equal(gezaehlt.counted, 'id');
      assert.deepEqual(gezaehlt.experiments, [{ id: z, code: 'K-Z', discarded: 4, inBackup: false }]);
      // K-Y ist zurueck, und in seinem Verlauf steht 0, wie bei K-1.
      const ganz = fuerDasGanze(x.d);
      const einzeln = x.d
        .prepare(
          "SELECT experiment_id, new_value FROM lab_history WHERE entity='experiment' AND action='backup' AND id>? ORDER BY experiment_id"
        )
        .all(ganz.id)
        .map((r) => [r.experiment_id, JSON.parse(r.new_value).discarded]);
      assert.deepEqual(einzeln, [
        [a, 0],
        [y, 0]
      ]);
    } finally {
      x.weg();
    }
  });

  it('erkennt bei einer Sicherung von vor der Kette ein umbenanntes Paket an einem gemeinsamen Eintrag', () => {
    const x = labor('umbenannt');
    try {
      const wp = Number(db.insertWorkPackage(x.d, { code: 'UP', title: 'Vorher' }, ADMIN));
      const sicherung = ohneKette(x.sichern());
      db.updateWorkPackage(x.d, wp, { code: 'UP-2' }, ADMIN);
      db.updateWorkPackage(x.d, wp, { title: 'Nachher' }, ADMIN);
      const gezaehlt = x.zurueckspielen(sicherung, 'pre-restore-u.db');
      // Der Code ist ein anderer, aber den Eintrag, mit dem es angelegt wurde,
      // hat die Sicherung genauso.
      assert.deepEqual(gezaehlt.workPackages, [{ id: wp, code: 'UP-2', discarded: 2, inBackup: true }]);
      const eigen = x.d
        .prepare("SELECT new_value FROM lab_history WHERE entity='work_package' AND action='backup'")
        .get();
      assert.equal(JSON.parse(eigen.new_value).discarded, 2);
    } finally {
      x.weg();
    }
  });

  it('erkennt ein umbenanntes Paket aus einer Sicherung von vor v96 daran, wann es angelegt wurde', () => {
    const x = labor('vor96');
    try {
      // Ein Paket von vor v96, ohne Eintrag, und v96 gilt als nicht gelaufen.
      // Die Sicherung ist auch von vor der Kette, wie jede aus der Zeit.
      const wp = Number(
        x.d
          .prepare(
            "INSERT INTO work_packages(code,title,archived,sort,created) VALUES('AP1','Paket',0,1,'2026-09-30T10:00:00.000Z')"
          )
          .run().lastInsertRowid
      );
      x.d.prepare('DELETE FROM schema_version WHERE version=96').run();
      const vor96 = ohneKette(x.sichern());
      // Das Update schreibt den Ausgangsstand; dann bekommt das Paket einen
      // neuen Code und einen neuen Titel.
      x.d.close();
      x.d = db.openDb(x.datei);
      db.updateWorkPackage(x.d, wp, { code: 'AP-1' }, ADMIN);
      db.updateWorkPackage(x.d, wp, { title: 'Paket, neu' }, ADMIN);
      const gezaehlt = x.zurueckspielen(vor96, 'pre-restore-vor96.db');
      // Keinen seiner Eintraege hat die Sicherung, und der Code ist ein
      // anderer. Angelegt wurde es aber zur selben Zeit: dasselbe Paket.
      assert.equal(gezaehlt.counted, 'id');
      assert.deepEqual(gezaehlt.workPackages, [{ id: wp, code: 'AP-1', discarded: 3, inBackup: true }]);
      const eigen = x.d
        .prepare(
          "SELECT new_value FROM lab_history WHERE entity='work_package' AND action='backup' ORDER BY id DESC LIMIT 1"
        )
        .get();
      assert.equal(JSON.parse(eigen.new_value).discarded, 3);
    } finally {
      x.weg();
    }
  });

  it('gibt nichts dem Versuch der Sicherung, wenn ein spaeter angelegter seine Kennung und seinen Code bekam', () => {
    const x = labor('gleicher-code');
    try {
      const a = Number(db.insertExperiment(x.d, { code: 'GC-1', title: 'Von Anfang an' }, ADMIN));
      const morgen = x.sichern();
      const b = Number(db.insertExperiment(x.d, { code: 'GC-2', title: 'Am Vormittag' }, ADMIN));
      db.updateExperiment(x.d, b, { outcome: 'vormittags' }, ADMIN);
      const mittag = x.sichern();
      x.zurueckspielen(morgen, 'pre-restore-1.db');
      // Ein anderer Versuch bekommt die Kennung von GC-2 und denselben Code.
      const c = Number(db.insertExperiment(x.d, { code: 'GC-2', title: 'Ein anderer' }, ADMIN));
      assert.equal(c, b, 'the id is handed out a second time');
      for (const o of ['eins', 'zwei', 'drei']) db.updateExperiment(x.d, c, { outcome: o }, ADMIN);
      const gezaehlt = x.zurueckspielen(mittag, 'pre-restore-2.db');
      // Den Eintrag, mit dem er angelegt wurde, hat die Sicherung nicht.
      assert.equal(gezaehlt.counted, 'chain');
      assert.equal(gezaehlt.total, 6);
      assert.deepEqual(gezaehlt.experiments, [
        { id: a, code: 'GC-1', discarded: 1, inBackup: true },
        { id: c, code: 'GC-2', discarded: 4, inBackup: false }
      ]);
      // GC-2 vom Vormittag ist mit allen seinen Eintraegen zurueck: 0.
      const ganz = fuerDasGanze(x.d);
      const einzeln = x.d
        .prepare(
          "SELECT experiment_id, new_value FROM lab_history WHERE entity='experiment' AND action='backup' AND id>? ORDER BY experiment_id"
        )
        .all(ganz.id)
        .map((r) => [r.experiment_id, JSON.parse(r.new_value).discarded]);
      assert.deepEqual(einzeln, [
        [a, 1],
        [b, 0]
      ]);
    } finally {
      x.weg();
    }
  });
});

describe('Sicherung zurueckgespielt: der Eintrag fuer das Ganze', () => {
  it('steht auch da, wenn die Sicherung keinen Versuch und kein Paket hat, und nennt die Kopie', () => {
    const x = labor('leer');
    try {
      const leer = x.sichern();
      const a = Number(db.insertExperiment(x.d, { code: 'L-1', title: 'Spaeter' }, ADMIN));
      const p = Number(db.insertWorkPackage(x.d, { code: 'LP', title: 'Paket' }, ADMIN));
      x.zurueckspielen(leer, 'pre-restore-leer.db');
      const alle = x.d.prepare('SELECT entity, entity_id, experiment_id, action FROM lab_history ORDER BY id').all();
      assert.deepEqual(
        alle.map((z) => [z.entity, z.entity_id, z.experiment_id, z.action]),
        [['database', 0, null, 'backup']],
        'nothing else to write into, and the backup had no history'
      );
      const r = fuerDasGanze(x.d).record;
      assert.equal(r.kept, 'pre-restore-leer.db');
      assert.equal(r.discarded, 2);
      assert.deepEqual(r.experiments, [{ id: a, code: 'L-1', discarded: 1, inBackup: false }]);
      assert.deepEqual(r.workPackages, [{ id: p, code: 'LP', discarded: 1, inBackup: false }]);
    } finally {
      x.weg();
    }
  });

  it('steht ohne Versuch vor den Eintraegen je Versuch, die Pruefung nennt ihn, und die Kette bleibt ganz', () => {
    const x = labor('ganz');
    try {
      const a = Number(db.insertExperiment(x.d, { code: 'G-1', title: 'Ganz' }, ADMIN));
      const sicherung = x.sichern();
      db.updateExperiment(x.d, a, { outcome: 'weg' }, ADMIN);
      const gezaehlt = x.zurueckspielen(sicherung, 'pre-restore-ganz.db');
      const z = fuerDasGanze(x.d);
      assert.equal(z.experiment_id, null);
      assert.equal(z.entity_id, gezaehlt.last);
      assert.equal(z.username, 'admin');
      assert.deepEqual(z.record, {
        restoredAt: z.record.restoredAt,
        upTo: gezaehlt.last,
        discarded: 1,
        counted: 'chain',
        experiments: [{ id: a, code: 'G-1', discarded: 1, inBackup: true }],
        workPackages: [],
        kept: 'pre-restore-ganz.db'
      });
      const eigen = x.d.prepare("SELECT id FROM lab_history WHERE entity='experiment' AND action='backup'").get();
      assert.ok(eigen.id > z.id);
      assert.ok(db.listExperimentHistory(x.d, a).every((e) => e.entity !== 'database'));
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, true);
      assert.deepEqual(k.restores, [
        {
          id: z.id,
          at: z.at,
          user: 'admin',
          upTo: gezaehlt.last,
          discarded: 1,
          counted: 'chain',
          experiments: z.record.experiments,
          workPackages: [],
          kept: 'pre-restore-ganz.db'
        }
      ]);
    } finally {
      x.weg();
    }
  });
});

describe('Sicherung zurueckgespielt: in der Oberflaeche', () => {
  function oberflaeche() {
    const t = (k, o) => k + (o ? '(' + Object.values(o).join(',') + ')' : '');
    return new Function(
      't',
      `
      const currentLang = 'de';
      ${['esc', 'fmtDt', 'fmtDtTime', 'parseDateStr', 'serverKette', 'pjLbKette'].map((n) => hebeFunktion(n)).join('\n')}
      return { serverKette, pjLbKette };`
    )(t);
  }
  const RUECK = {
    id: 40,
    at: '2026-10-06T10:00:00.000Z',
    user: 'admin',
    upTo: 31,
    discarded: 5,
    counted: 'chain',
    experiments: [
      { id: 1, code: 'S-1', discarded: 3, inBackup: true },
      { id: 4, code: 'S-<4>', discarded: 1, inBackup: false }
    ],
    workPackages: [{ id: 2, code: 'P2', discarded: 1, inBackup: true }],
    kept: 'pre-restore-<x>.db'
  };

  it('druckt jede unter die Pruefkette, mit dem, was es nicht mehr gibt, escaped', () => {
    const o = oberflaeche();
    const blatt = o.pjLbKette({
      chain: {
        ok: true,
        entries: 45,
        broken: [],
        head: { historyId: 45, hash: 'ab'.repeat(32) },
        restores: [
          RUECK,
          { ...RUECK, id: 50, counted: 'id', experiments: [], workPackages: [], kept: null },
          // Eine Sicherung von bevor es den Verlauf gab: alles verworfen, und
          // nach Kennung gezaehlt ist das genau.
          { ...RUECK, id: 60, upTo: 0, counted: 'id', experiments: [], workPackages: [], kept: null },
          // Eine, die sich vor dem Oeffnen nicht lesen liess.
          { ...RUECK, id: 70, counted: 'migrated', experiments: [], workPackages: [], kept: null }
        ]
      }
    });
    assert.ok(blatt.includes(',admin,31,5)'));
    assert.ok(blatt.includes('exp.lbChainRestoreExp(S-1: 3, S-&lt;4&gt;: 1 (exp.lbChainRestoreGone))'));
    assert.ok(blatt.includes('exp.lbChainRestoreWp(P2: 1)'));
    assert.ok(blatt.includes('exp.lbChainRestoreKept(pre-restore-&lt;x&gt;.db)'));
    assert.equal(blatt.split('exp.lbChainRestore(').length - 1, 3, 'the three with a history');
    assert.equal(blatt.split('exp.lbChainRestoreNone(').length - 1, 1, 'the one without');
    assert.equal(blatt.split('exp.lbChainRestoreById').length - 1, 1, 'only where counting by id can miss some');
    assert.equal(
      blatt.split('exp.lbChainRestoreMigrated').length - 1,
      1,
      'not taken for a backup from before the chain'
    );
    assert.equal(blatt.split('exp.lbChainRestoreKept').length - 1, 1, 'no copy, no name');
    assert.equal(o.pjLbKette({ chain: { ok: true, entries: 1, broken: [] } }).includes('Restore'), false);
  });

  it('zeigt unter Server die juengste in einer Zeile, und wie viele es davor gab', () => {
    const o = oberflaeche();
    const k = { ok: true, entries: 45, broken: [], head: null, lastStamp: null, stamping: { tsa: null } };
    assert.equal(o.serverKette(k).includes('server.restore'), false, 'no restore, no line');
    const html = o.serverKette({ ...k, restores: [{ ...RUECK, id: 30, kept: 'pre-restore-alt.db' }, RUECK] });
    assert.ok(html.includes('server.restoreLabel:</b> server.restoreWhen('));
    assert.ok(html.includes(',admin,5) · server.restoreKept(pre-restore-&lt;x&gt;.db) · server.restoreEarlier(1)'));
    assert.equal(html.includes('pre-restore-alt.db'), false, 'only the latest');
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

describe('Das Zurueckspielen ueber die Route', () => {
  // Der Abschnitt aus server.js, gegen echte Dateien. Nur das Entschluesseln
  // ist hier eine Attrappe, die die Datei so durchreicht (das echte prueft
  // backup-crypto.test.js); alles danach ist der Code des Servers.
  const PASSWORT = 'ein Passwort nur fuer den Test';
  function route(ordner) {
    const src = quelle('server.js');
    const von = src.indexOf('// -- Backup Restore (encrypted .db) --');
    const bis = src.indexOf('// POST /api/print', von);
    assert.ok(von > 0 && bis > von, 'the restore route in server.js');
    const DB_FILE = path.join(ordner, 'meistertracker.db');
    const BACKUP_DIR = path.join(ordner, 'backups');
    fs.mkdirSync(BACKUP_DIR);
    const logs = [];
    const h = new Function(
      'db',
      'fs',
      'path',
      'crypto',
      'backupCrypto',
      'usbStick',
      'log',
      'DB_FILE',
      'BACKUP_DIR',
      'start',
      `let database = start;
      let restoreInProgress = false;
      const requireAdmin = () => false;
      const closeAllMcpSessions = () => {};
      const autoSyncAllCaldav = () => {};
      const readData = () => ({});
      const broadcastSSE = () => {};
      ${['jsonOk', 'jsonErr', 'swapRestoredDatabase'].map((n) => hebeFunktion(n, src)).join('\n')}
      function handle(req, res) {
        ${src.slice(von, bis)}
        return false;
      }
      return { handle, aktuell: () => database };`
    )(
      db,
      fs,
      path,
      crypto,
      { isEncryptedBackup: () => true, HEADER_LEN: 0, decryptBackup: (roh, pw) => (pw === PASSWORT ? roh : null) },
      { canonicalKey: () => null },
      (level, msg) => logs.push([level, msg]),
      DB_FILE,
      BACKUP_DIR,
      db.openDb(DB_FILE)
    );
    function zurueckspielen(datei) {
      return new Promise((fertig) => {
        const req = Object.assign(new EventEmitter(), {
          method: 'POST',
          url: '/api/backup/restore',
          headers: { 'x-backup-password': PASSWORT },
          authUser: { user_id: null, username: 'chef', role: 'admin' },
          destroy() {}
        });
        const res = {
          writeHead(code) {
            this.status = code;
          },
          end(body) {
            fertig({ status: this.status, json: JSON.parse(body) });
          }
        };
        h.handle(req, res);
        req.emit('data', fs.readFileSync(datei));
        req.emit('end');
      });
    }
    return { zurueckspielen, aktuell: h.aktuell, logs, BACKUP_DIR };
  }

  it('zaehlt erst den Morgen und dann den Mittag richtig, und die zweite Kopie haelt den ersten Eintrag', async () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mt_rueckspielen_'));
    const r = route(ordner);
    try {
      const d = () => r.aktuell();
      const a = Number(db.insertExperiment(d(), { code: 'RT-1', title: 'Route' }, ADMIN));
      const morgen = path.join(ordner, 'morgen.db');
      d().prepare('VACUUM INTO ?').run(morgen);
      for (const o of ['eins', 'zwei', 'drei']) db.updateExperiment(d(), a, { outcome: o }, ADMIN);
      const mittag = path.join(ordner, 'mittag.db');
      d().prepare('VACUUM INTO ?').run(mittag);

      assert.deepEqual(await r.zurueckspielen(morgen), { status: 200, json: { ok: true } });
      const erste = fuerDasGanze(d());
      assert.equal(erste.username, 'chef');
      assert.equal(erste.record.discarded, 3);
      assert.ok(fs.existsSync(path.join(r.BACKUP_DIR, erste.record.kept)), 'the copy it names is there');

      db.updateExperiment(d(), a, { outcome: 'nachmittags' }, ADMIN);
      const b = Number(db.insertExperiment(d(), { code: 'RT-2', title: 'Danach' }, ADMIN));
      assert.deepEqual(await r.zurueckspielen(mittag), { status: 200, json: { ok: true } });
      const zweite = fuerDasGanze(d());
      assert.equal(zweite.record.counted, 'chain');
      assert.equal(zweite.record.discarded, 4);
      assert.deepEqual(zweite.record.experiments, [
        { id: a, code: 'RT-1', discarded: 2, inBackup: true },
        { id: b, code: 'RT-2', discarded: 1, inBackup: false }
      ]);
      // Was das zweite Zurueckspielen verworfen hat, haelt seine Kopie, auch
      // den Eintrag des ersten, der zur Kopie davor fuehrt.
      assert.notEqual(zweite.record.kept, erste.record.kept);
      const kopie = new DatabaseSync(path.join(r.BACKUP_DIR, zweite.record.kept), { readOnly: true });
      const dort = kopie
        .prepare("SELECT new_value FROM lab_history WHERE entity='database' AND action='backup'")
        .all()
        .map((z) => JSON.parse(z.new_value).kept);
      kopie.close();
      assert.deepEqual(dort, [erste.record.kept]);
      assert.equal(db.labChainStatus(d()).ok, true);
      assert.deepEqual(
        r.logs.filter(([level]) => level !== 'info'),
        [],
        'read before migrating, swapped and recorded without a warning'
      );
    } finally {
      try {
        r.aktuell().close();
      } catch {
        // schon zu
      }
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  });
});
