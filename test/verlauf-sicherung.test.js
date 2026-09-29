'use strict';
// Eine zurueckgespielte Sicherung im Verlauf.
//
// Mit einer Sicherung kommt ihr Verlauf zurueck; was danach geschrieben wurde,
// ist weg. Vorher stand davon nichts im Verlauf, und eine Datei mit
// gleichnamigen, aber wirkungslosen Triggern blieb so, wie sie war. Jetzt
// steht in jedem Versuch ein Eintrag, und openDb legt die Trigger jedes Mal neu
// an.
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
    const zaehlen = route.indexOf('db.historyAfter(database');
    const schliessen = route.indexOf('database.close()');
    const marke = route.indexOf('db.markBackupRestore(database');
    const oeffnen = route.indexOf('database = db.openDb(DB_FILE)');
    assert.ok(zaehlen > 0 && zaehlen < schliessen, 'counted from the old file before it is closed');
    assert.ok(marke > oeffnen, 'written into the restored file after it is opened');
  });
});
