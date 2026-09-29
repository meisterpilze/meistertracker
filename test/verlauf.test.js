'use strict';
// Der Verlauf von Versuchen, Gefaessen und Fotos.
//
// Die Felder eines Versuchs zeigen nur den Stand von jetzt. Ein Laborbuch muss
// auch sagen koennen, was vorher dastand, wann es sich geaendert hat und wer es
// war. Dieser Test haelt fest, dass jede echte Aenderung einen Eintrag schreibt
// und keine unechte einen, dass Aenderung und Eintrag zusammen gelingen oder
// zusammen scheitern, und dass sich der Verlauf selbst nicht aendern laesst.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const ANNA = { user_id: 7, username: 'anna', role: 'user' };
const BEN = { user_id: 8, username: 'ben', role: 'user' };

function neueDb(name) {
  const p = path.join(
    os.tmpdir(),
    'mt_verlauf_' + name + '_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db'
  );
  const d = db.openDb(p);
  // Die beiden Benutzer gibt es wirklich: removed_by verweist auf users.
  const neu = d.prepare('INSERT INTO users(id,username,hash,salt,role,created) VALUES(?,?,?,?,?,?)');
  for (const u of [ANNA, BEN]) neu.run(u.user_id, u.username, 'x', 'y', 'user', new Date().toISOString());
  return { p, d };
}
function eintraege(d, entity, id) {
  return d.prepare('SELECT * FROM lab_history WHERE entity=? AND entity_id=? ORDER BY id').all(entity, id);
}
function anzahl(d) {
  return d.prepare('SELECT COUNT(*) AS c FROM lab_history').get().c;
}
function foto(uuid) {
  return {
    uuid,
    rel_path: 'photos/2026/01/exp-1/' + uuid + '.jpg',
    thumb_path: 'photos/2026/01/exp-1/' + uuid + '_thumb.jpg',
    width: 640,
    height: 480,
    bytes: 1000,
    sha256: 'a'.repeat(64),
    uploaded_at: '2026-01-06T09:00:00.000Z',
    uploaded_by: null
  };
}

describe('Verlauf: Versuche, Gefaesse, Fotos', () => {
  let d, p;
  const versuch = (code) => db.listExperiments(d).find((v) => v.code === code);
  before(() => {
    ({ d, p } = neueDb('versuch'));
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('schreibt beim Anlegen den ganzen Datensatz und wer es war', () => {
    const id = db.insertExperiment(d, { code: 'T1', title: 'Probelauf', started: '2026-01-05' }, ANNA);
    const [e] = eintraege(d, 'experiment', id);
    assert.equal(e.action, 'create');
    assert.equal(e.user_id, 7);
    assert.equal(e.username, 'anna');
    assert.equal(e.experiment_id, id);
    assert.ok(!Number.isNaN(Date.parse(e.at)), 'the entry carries a timestamp');
    assert.deepEqual(JSON.parse(e.new_value), {
      code: 'T1',
      title: 'Probelauf',
      started: '2026-01-05',
      ended: null,
      status: 'running',
      archived: false,
      recipe: '',
      outcome: ''
    });
  });

  it('schreibt je geaendertem Feld einen Eintrag mit altem und neuem Wert', () => {
    const v = versuch('T1');
    // Der Titel kommt mit, ist aber derselbe: dafuer gibt es keinen Eintrag.
    assert.equal(
      db.updateExperiment(d, v.id, { title: 'Probelauf', recipe: 'zwei Loeffel', outcome: 'klappt' }, BEN),
      true
    );
    const geaendert = eintraege(d, 'experiment', v.id).filter((z) => z.action === 'update');
    assert.deepEqual(
      geaendert.map((z) => [z.field, z.old_value, z.new_value, z.username]),
      [
        ['recipe', '', 'zwei Loeffel', 'ben'],
        ['outcome', '', 'klappt', 'ben']
      ]
    );
  });

  it('schreibt nichts, wenn sich nichts aendert', () => {
    const v = versuch('T1');
    const vorher = anzahl(d);
    const stand = db.getDataVersion(d);
    assert.equal(db.updateExperiment(d, v.id, { title: 'Probelauf', recipe: 'zwei Loeffel' }, ANNA), false);
    // Kein Enddatum und ein leeres Enddatum sind dasselbe.
    assert.equal(db.updateExperiment(d, v.id, { ended: '' }, ANNA), false);
    assert.equal(db.updateExperiment(d, v.id, {}, ANNA), false);
    assert.equal(db.updateExperiment(d, 999999, { title: 'gibt es nicht' }, ANNA), false);
    assert.equal(anzahl(d), vorher);
    assert.equal(db.getDataVersion(d), stand, 'no change, no new data version either');
  });

  it('haelt Abschliessen und Archivieren fest', () => {
    const v = versuch('T1');
    db.updateExperiment(d, v.id, { status: 'done', ended: '2026-01-20' }, ANNA);
    db.updateExperiment(d, v.id, { archived: true }, ANNA);
    // 1 ist dasselbe wie true und damit keine zweite Aenderung.
    db.updateExperiment(d, v.id, { archived: 1 }, ANNA);
    const geaendert = eintraege(d, 'experiment', v.id)
      .filter((z) => z.action === 'update')
      .slice(-3);
    assert.deepEqual(
      geaendert.map((z) => [z.field, z.old_value, z.new_value]),
      [
        ['ended', null, '2026-01-20'],
        ['status', 'running', 'done'],
        ['archived', 'false', 'true']
      ]
    );
  });

  it('schreibt keinen Eintrag fuer eine Aenderung, die scheitert', () => {
    // started ist NOT NULL. Die Zeile bleibt, wie sie war, und der Verlauf auch;
    // auch der Titel, der im selben PATCH kam, kommt nicht an.
    const v = versuch('T1');
    const vorher = anzahl(d);
    assert.throws(() => db.updateExperiment(d, v.id, { title: 'neu', started: null }, ANNA));
    assert.equal(anzahl(d), vorher);
    assert.equal(versuch('T1').title, 'Probelauf');
  });

  it('fuehrt ein Gefaess vom Anlegen ueber das Entfernen bis zum Zurueckholen', () => {
    const v = versuch('T1');
    const r = db.insertExperimentRun(d, { experimentId: v.id, code: 'A-1', what: 'Probe' }, ANNA);
    db.updateExperimentRun(d, r, { result: '3 Punkte', outcome: 'good' }, BEN);
    db.updateExperimentRun(d, r, { result: '3 Punkte' }, BEN);
    assert.equal(db.removeExperimentRun(d, r, ANNA), true);
    assert.equal(db.removeExperimentRun(d, r, BEN), false, 'removing twice changes nothing and writes nothing');
    assert.equal(db.restoreExperimentRun(d, r, BEN), true);
    const z = eintraege(d, 'run', r);
    assert.deepEqual(
      z.map((x) => [x.action, x.field, x.username]),
      [
        ['create', null, 'anna'],
        ['update', 'result', 'ben'],
        ['update', 'outcome', 'ben'],
        ['remove', null, 'anna'],
        ['restore', null, 'ben']
      ]
    );
    assert.ok(z.every((x) => x.experiment_id === v.id));
    assert.deepEqual(JSON.parse(z[3].old_value), {
      code: 'A-1',
      what: 'Probe',
      result: '3 Punkte',
      outcome: 'good',
      cultureId: null,
      batchId: null
    });
    assert.deepEqual(JSON.parse(z[4].new_value), JSON.parse(z[3].old_value), 'it comes back as it went');
    const zeile = d.prepare('SELECT removed_at, removed_by FROM experiment_runs WHERE id=?').get(r);
    assert.deepEqual({ ...zeile }, { removed_at: null, removed_by: null });
  });

  it('merkt am Gefaess, wann und von wem es entfernt wurde', () => {
    const v = versuch('T1');
    const r = db.insertExperimentRun(d, { experimentId: v.id, code: 'A-9' }, ANNA);
    db.removeExperimentRun(d, r, BEN);
    const zeile = d.prepare('SELECT removed_at, removed_by FROM experiment_runs WHERE id=?').get(r);
    assert.equal(zeile.removed_by, BEN.user_id);
    assert.ok(!Number.isNaN(Date.parse(zeile.removed_at)));
    assert.equal(
      versuch('T1').runs.some((x) => x.id === r),
      false
    );
    assert.equal(versuch('T1').removedRuns.find((x) => x.id === r).removedAt, zeile.removed_at);
  });

  it('schreibt die Reihenfolge, aber nicht in den Verlauf', () => {
    // Die Reihenfolge ist Anordnung, kein Befund.
    const v = versuch('T1');
    const r = db.insertExperimentRun(d, { experimentId: v.id, code: 'A-2' }, ANNA);
    assert.equal(db.updateExperimentRun(d, r, { sort: 50 }, ANNA), true);
    assert.equal(versuch('T1').runs.find((x) => x.id === r).sort, 50);
    assert.deepEqual(
      eintraege(d, 'run', r).map((x) => x.action),
      ['create']
    );
  });

  it('haelt ein Foto mit seiner Pruefsumme fest, auch nach dem Entfernen', () => {
    const v = versuch('T1');
    const id = db.addExperimentPhoto(d, v.id, null, foto('11111111-1111-1111-1111-111111111111'), ANNA);
    assert.equal(db.removeExperimentPhoto(d, id, BEN), true);
    const z = eintraege(d, 'photo', id);
    assert.deepEqual(
      z.map((x) => [x.action, x.username, x.experiment_id]),
      [
        ['create', 'anna', v.id],
        ['remove', 'ben', v.id]
      ]
    );
    assert.equal(JSON.parse(z[0].new_value).sha256, 'a'.repeat(64));
    assert.equal(JSON.parse(z[1].old_value).uuid, '11111111-1111-1111-1111-111111111111');
    assert.equal(
      z.some((x) => 'uploadedBy' in JSON.parse(x.new_value || x.old_value)),
      false,
      'the uploader is the name on the create entry, not a field that empties when the account goes'
    );
  });

  it('laeuft in der Transaktion des Foto-Uploads mit und geht mit ihr zurueck', () => {
    // Die Route schreibt mehrere Fotos in einer eigenen Transaktion. Der Verlauf
    // nimmt einen SAVEPOINT, damit er darin laufen kann, und verschwindet mit
    // ihr, wenn der Upload scheitert.
    const v = versuch('T1');
    const vorher = anzahl(d);
    d.exec('BEGIN');
    db.addExperimentPhoto(d, v.id, null, foto('22222222-2222-2222-2222-222222222222'), ANNA);
    d.exec('ROLLBACK');
    assert.equal(anzahl(d), vorher);
    assert.equal(db.getExperimentPhotoByUuid(d, '22222222-2222-2222-2222-222222222222'), null);
    d.exec('BEGIN');
    const id = db.addExperimentPhoto(d, v.id, null, foto('33333333-3333-3333-3333-333333333333'), ANNA);
    d.exec('COMMIT');
    assert.equal(eintraege(d, 'photo', id).length, 1);
  });

  it('gibt den Verlauf eines Versuchs mit Gefaessen und Fotos zurueck, und nur seinen', () => {
    const id = db.insertExperiment(d, { code: 'T2', title: 'Zweiter Lauf' }, ANNA);
    const r = db.insertExperimentRun(d, { experimentId: id, code: 'B-1' }, ANNA);
    db.updateExperimentRun(d, r, { outcome: 'contam' }, BEN);
    db.insertExperiment(d, { code: 'T3', title: 'Dritter Lauf' }, ANNA);
    const h = db.listExperimentHistory(d, id);
    assert.deepEqual(
      h.map((e) => [e.entity, e.action]),
      [
        ['experiment', 'create'],
        ['run', 'create'],
        ['run', 'update']
      ]
    );
    assert.equal(h[1].record.code, 'B-1', 'a record comes back as an object, not as JSON text');
    assert.deepEqual([h[2].field, h[2].from, h[2].to, h[2].user], ['outcome', 'open', 'contam', 'ben']);
    assert.equal(h[0].userId, 7);
  });

  it('sagt auch dann noch, wer es war, wenn es das Konto nicht mehr gibt', () => {
    const uid = d
      .prepare("INSERT INTO users(username,hash,salt,role,created) VALUES('carla','x','y','user',?)")
      .run(new Date().toISOString()).lastInsertRowid;
    const id = db.insertExperiment(d, { code: 'T4', title: 'Vierter Lauf' }, { user_id: uid, username: 'carla' });
    // Kein Fremdschluessel: das Loeschen des Kontos aendert den Verlauf nicht
    // und scheitert auch nicht an ihm.
    db.deleteUser(d, uid);
    const [e] = eintraege(d, 'experiment', id);
    assert.equal(e.username, 'carla');
    assert.equal(e.user_id, uid);
  });

  it('erfindet niemanden, wenn keine Sitzung da ist', () => {
    const id = db.insertExperiment(d, { code: 'T5', title: 'Fuenfter Lauf' });
    const [e] = eintraege(d, 'experiment', id);
    assert.equal(e.user_id, null);
    assert.equal(e.username, '');
  });

  it('laesst sich weder aendern noch loeschen', () => {
    const vorher = anzahl(d);
    assert.throws(() => d.prepare("UPDATE lab_history SET username='jemand'").run(), /append-only/);
    assert.throws(() => d.prepare('DELETE FROM lab_history').run(), /append-only/);
    assert.equal(anzahl(d), vorher);
  });
});

describe('Verlauf: geloeschtes Konto', () => {
  it('markiert Eintraege, deren Konto es nicht mehr gibt', () => {
    const { d, p } = neueDb('konto');
    try {
      const v = Number(db.insertExperiment(d, { code: 'K1', title: 'Lauf' }, BEN));
      db.updateExperiment(d, v, { outcome: 'von anna' }, ANNA);
      db.deleteUser(d, BEN.user_id);
      const eintraege = db.listExperimentHistory(d, v);
      assert.deepEqual(
        eintraege.map((e) => [e.user, !!e.userGone]),
        [
          ['ben', true],
          ['anna', false]
        ]
      );
      assert.equal(db.experimentHistoryPage(d, v).entries[0].userGone, true);
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });
});

describe('Verlauf: Notizen', () => {
  let d, p;
  before(() => {
    ({ d, p } = neueDb('notiz'));
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  // Eine Notiz ist ein Zettel, kein Laborbucheintrag. Was aus dem Reiter
  // geloescht wird, ist weg, so wie es der Dialog sagt, und keine Fassung
  // bleibt irgendwo liegen.
  it('schreibt nichts in den Verlauf und laesst nach dem Loeschen nichts zurueck', () => {
    const vorher = anzahl(d);
    const id = db.insertProjectNote(d, { tab: 'research', body: 'erste Fassung mit Geheimnis' });
    assert.equal(db.updateProjectNote(d, id, { body: 'zweite Fassung' }), true);
    assert.equal(db.deleteProjectNote(d, id), true);
    assert.equal(
      db.listProjectNotes(d).some((n) => n.id === id),
      false,
      'the note is gone from the tab'
    );
    assert.equal(anzahl(d), vorher, 'no history entry for notes');
    const irgendwo = d
      .prepare(
        "SELECT COUNT(*) AS c FROM lab_history WHERE old_value LIKE '%Geheimnis%' OR new_value LIKE '%Geheimnis%'"
      )
      .get().c;
    assert.equal(irgendwo, 0, 'no earlier version is kept');
  });

  it('macht eine Notiz nicht zur geaenderten, wenn derselbe Text gespeichert wird', () => {
    const id = db.insertProjectNote(d, { tab: 'build', body: 'bleibt so' });
    assert.equal(db.updateProjectNote(d, id, { body: 'bleibt so' }), false);
    assert.equal(db.listProjectNotes(d).find((n) => n.id === id).updated, '');
  });
});

describe('Verlauf: Ausgangsstand aus Migration 89', () => {
  it('haelt fest, was vor dem Verlauf schon da war, und zwar einmal', () => {
    const { p, d } = neueDb('anfang');
    let d2;
    try {
      // Eine Datenbank von vor dem Verlauf: Zeilen, zu denen es keine Eintraege
      // gibt. Die Tabelle geht, und die Migration gilt als nicht gelaufen.
      d.prepare("INSERT INTO experiments(code,title,started) VALUES('T9','Alter Lauf','2026-01-02')").run();
      const exp = d.prepare("SELECT id FROM experiments WHERE code='T9'").get().id;
      d.prepare("INSERT INTO experiment_runs(experiment_id,code,result,outcome) VALUES(?,'C-1','alt','good')").run(exp);
      d.prepare(
        'INSERT INTO experiment_photos(experiment_id,uuid,rel_path,thumb_path,bytes,sha256,uploaded_at,uploaded_by) VALUES(?,?,?,?,?,?,?,?)'
      ).run(
        exp,
        '44444444-4444-4444-4444-444444444444',
        'photos/x.jpg',
        'photos/x_thumb.jpg',
        10,
        'b'.repeat(64),
        '2026-01-03T10:00:00.000Z',
        ANNA.user_id
      );
      d.prepare(
        "INSERT INTO project_notes(tab,body,created) VALUES('build','alte Notiz','2026-01-04T10:00:00.000Z')"
      ).run();
      d.exec('DROP TABLE lab_history');
      // Eine Datenbank von vor dem Verlauf hat auch v92 noch nicht gesehen.
      d.prepare('DELETE FROM schema_version WHERE version IN (89, 92)').run();
      d.close();

      d2 = db.openDb(p);
      const alle = d2.prepare('SELECT * FROM lab_history ORDER BY id').all();
      assert.deepEqual(
        alle.map((z) => [z.entity, z.action, z.experiment_id]),
        [
          ['experiment', 'baseline', exp],
          ['run', 'baseline', exp],
          ['photo', 'baseline', exp]
        ]
      );
      assert.ok(
        alle.every((z) => z.user_id === null && z.username === ''),
        'nobody knows who created them, so nobody is named'
      );
      assert.equal(JSON.parse(alle[1].new_value).result, 'alt');
      assert.equal(JSON.parse(alle[2].new_value).sha256, 'b'.repeat(64));
      assert.equal(
        JSON.parse(alle[2].new_value).uploadedBy,
        ANNA.user_id,
        'as v89 shipped: a photo older than the history has no create entry, its baseline names the uploader'
      );
      assert.equal(
        alle.some((z) => z.entity === 'note'),
        false,
        'notes end up without history: v92 takes out what v89 wrote for them'
      );

      // Der erste Eintrag danach beginnt bei dem Stand, der festgehalten ist.
      const run = d2.prepare("SELECT id FROM experiment_runs WHERE code='C-1'").get().id;
      db.updateExperimentRun(d2, run, { result: 'neu' }, ANNA);
      const danach = eintraege(d2, 'run', run).pop();
      assert.equal(danach.old_value, JSON.parse(alle[1].new_value).result);

      // Ein weiteres Oeffnen schreibt keinen zweiten Ausgangsstand.
      d2.close();
      d2 = db.openDb(p);
      assert.equal(d2.prepare("SELECT COUNT(*) AS c FROM lab_history WHERE action='baseline'").get().c, 3);
    } finally {
      if (d2) d2.close();
      fs.unlinkSync(p);
    }
  });
});

describe('Verlauf: Migration 92 nimmt die Notizen heraus', () => {
  it('loescht Notiz-Eintraege und den ungenutzten Index, laesst den Rest und die Trigger stehen', () => {
    const { p, d } = neueDb('v92');
    let d2;
    try {
      // So, wie #633 auf main die Tabelle hinterlassen hat: Notizen mit jeder
      // Fassung, dazu der Index nach Art und Datensatz.
      const v = Number(db.insertExperiment(d, { code: 'N1', title: 'Lauf' }, ANNA));
      const eintragen = d.prepare(
        "INSERT INTO lab_history(at,user_id,username,entity,entity_id,action,field,old_value,new_value) VALUES(?,?,?,'note',?,?,?,?,?)"
      );
      eintragen.run(
        '2026-09-28T10:00:00.000Z',
        7,
        'anna',
        1,
        'create',
        null,
        null,
        JSON.stringify({ body: 'ZETTELTEXT' })
      );
      eintragen.run('2026-09-28T10:01:00.000Z', 7, 'anna', 1, 'update', 'body', 'ZETTELTEXT', 'anders');
      d.exec('CREATE INDEX IF NOT EXISTS idx_lab_history_entity ON lab_history(entity, entity_id, id)');
      d.prepare('DELETE FROM schema_version WHERE version=92').run();
      d.close();

      d2 = db.openDb(p);
      assert.equal(d2.prepare("SELECT COUNT(*) AS c FROM lab_history WHERE entity='note'").get().c, 0);
      assert.equal(
        d2.prepare('SELECT COUNT(*) AS c FROM lab_history WHERE experiment_id=?').get(v).c,
        1,
        'the experiment keeps its entry'
      );
      assert.equal(d2.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_lab_history_entity'").get(), undefined);
      assert.throws(() => d2.prepare('DELETE FROM lab_history').run(), /append-only/, 'the triggers are back');
      d2.close();
      d2 = null;
      const roh = Buffer.concat(['', '-wal'].filter((x) => fs.existsSync(p + x)).map((x) => fs.readFileSync(p + x)));
      assert.equal(roh.includes(Buffer.from('ZETTELTEXT')), false, 'the text is not left in the file or the WAL');
    } finally {
      if (d2) d2.close();
      for (const x of ['', '-wal', '-shm']) fs.rmSync(p + x, { force: true });
    }
  });
});

describe('Verlauf: Server', () => {
  const SERVER = quelle('server.js');

  it('reicht bei jeder Aenderung die Sitzung durch', () => {
    const aufrufe = [
      'insertExperiment(',
      'updateExperiment(',
      'insertExperimentRun(',
      'updateExperimentRun(',
      'removeExperimentRun(',
      'restoreExperimentRun(',
      'addExperimentPhoto(',
      'removeExperimentPhoto(',
      'restoreExperimentPhoto('
    ];
    for (const aufruf of aufrufe) {
      const stellen = SERVER.split('\n').filter((l) => l.includes('db.' + aufruf));
      assert.ok(stellen.length, 'db.' + aufruf + ' is not called in server.js any more');
      for (const s of stellen) {
        assert.match(s, /req\.authUser\)/, 'db.' + aufruf + ' without the session: ' + s.trim());
      }
    }
  });

  it('liest den Verlauf ueber eine eigene Route und fasst die Tabelle selbst nicht an', () => {
    assert.ok(SERVER.includes('/^\\/api\\/experiments\\/(\\d+)\\/history$/'), 'GET /api/experiments/:id/history');
    assert.ok(SERVER.includes('db.experimentHistoryPage(database'));
    assert.equal(SERVER.includes('lab_history'), false, 'server.js reaches the table through db.js only');
  });

  it('loescht weder ein Gefaess noch ein Foto, und laesst die Fotodatei liegen', () => {
    const zeilen = SERVER.split('\n');
    const route = (marke) => {
      const start = zeilen.findIndex((l) => l.includes(marke));
      assert.ok(start >= 0, 'route not found: ' + marke);
      let ende = start + 1;
      while (ende < zeilen.length && !/^\s*if \(req\.method === /.test(zeilen[ende])) ende++;
      return zeilen.slice(start, ende).join('\n');
    };
    const gefaess = route("if (req.method === 'DELETE' && ansatzTreffer)");
    const foto = route("if (req.method === 'DELETE' && fotoWegTreffer)");
    assert.ok(gefaess.includes('db.removeExperimentRun('));
    assert.ok(foto.includes('db.removeExperimentPhoto('));
    assert.equal(foto.includes('unlink'), false, 'the photo file stays on disk');
    assert.equal(
      /DELETE FROM experiment_(runs|photos)/.test(quelle('db.js')),
      false,
      'db.js has no hard delete for them'
    );
  });
});

// Die Oberflaeche: die Funktionen aus app.js gegen Attrappen, wie in den
// anderen UI-Tests.
describe('Verlauf: Oberflaeche', () => {
  const APP = quelle();
  const TEILE = [
    'esc',
    'fmtDt',
    'fmtDtTime',
    'pjExp',
    'pjVerlauf',
    'pjVerlaufCodes',
    'pjVerlaufWert',
    'pjVerlaufZeile',
    'pjVerlaufListe',
    'pjVerlaufMischen',
    'pjVerlaufLaden',
    'pjVerlaufNeu',
    'pjToggle'
  ];
  function werkbank() {
    return new Function(`
      const abrufe = [];
      let pjOffen = null;
      let pjVerlaufOffen = null;
      let pjVerlaufStand = null;
      let pjVerlaufNr = 0;
      const experiments = [];
      const els = { 'pj-verlauf-liste': { innerHTML: '' } };
      const document = { getElementById: (id) => els[id] || null };
      const t = (k, o) => k + (o ? '(' + Object.values(o).join(',') + ')' : '');
      const PJ_VERLAUF_NEU = 500;
      // Jeder Abruf bleibt offen, bis der Test ihn beantwortet: so laesst sich
      // eine spaete Antwort nach einer fruehen zustellen.
      const apiGet = (p) => new Promise((ok, fehler) => abrufe.push({ p, ok, fehler }));
      ${TEILE.map((n) => hebeFunktion(n, APP)).join('\n')}
      return {
        abrufe,
        els,
        experiments,
        pjVerlauf,
        pjVerlaufListe,
        pjVerlaufLaden,
        pjVerlaufNeu,
        pjToggle,
        oeffne: (id) => { pjOffen = id; },
        setzeStand: (s) => { pjVerlaufStand = s; },
        stand: () => pjVerlaufStand,
        offen: () => pjVerlaufOffen
      };`)();
  }
  const warten = () => new Promise((r) => setTimeout(r, 5));
  // Ein Versuch in der Form, die /api/data liefert.
  const versuchMit = (extra) => ({ id: 3, runs: [], removedRuns: [], photos: [], removedPhotos: [], ...extra });
  const V = versuchMit({
    runs: [
      { id: 1, code: 'A-1' },
      { id: 2, code: 'A-2' }
    ]
  });
  const EINTRAEGE = [
    {
      id: 1,
      at: '2026-01-05T08:00:00.000Z',
      user: '',
      entity: 'experiment',
      entityId: 3,
      action: 'baseline',
      record: {}
    },
    {
      id: 2,
      at: '2026-01-05T08:00:00.000Z',
      user: '',
      entity: 'run',
      entityId: 1,
      action: 'baseline',
      record: { code: 'A-1' }
    },
    {
      id: 3,
      at: '2026-01-06T09:00:00.000Z',
      user: 'ben',
      entity: 'run',
      entityId: 1,
      action: 'update',
      field: 'result',
      from: '',
      to: '3 Punkte'
    },
    {
      id: 4,
      at: '2026-01-06T10:00:00.000Z',
      user: 'anna',
      entity: 'run',
      entityId: 2,
      action: 'create',
      record: { code: 'A-2' }
    },
    {
      id: 5,
      at: '2026-01-07T11:00:00.000Z',
      user: 'anna',
      entity: 'run',
      entityId: 1,
      action: 'update',
      field: 'outcome',
      from: 'open',
      to: 'contam'
    }
  ];

  it('zeichnet das Neueste oben und den Ausgangsstand als eine Zeile unten', () => {
    const ui = werkbank();
    ui.setzeStand({ id: 3, eintraege: EINTRAEGE });
    const html = ui.pjVerlaufListe(V);
    const stellen = [
      'exp.hist.f.run.outcome',
      'exp.hist.create.run(A-2)',
      'exp.hist.f.run.result',
      'exp.hist.baseline'
    ].map((s) => html.indexOf(s));
    assert.ok(
      stellen.every((s) => s >= 0),
      'every entry is drawn'
    );
    assert.deepEqual(
      [...stellen].sort((a, b) => a - b),
      stellen,
      'newest first, the start of the history last'
    );
    assert.equal(html.split('exp.hist.baseline').length - 1, 1, 'one line for the whole baseline');
    assert.ok(html.includes('A-1 · exp.hist.f.run.outcome'), 'a vessel entry names the vessel');
    assert.ok(html.includes('<del>exp.out.open</del> → <ins>exp.out.contam</ins>'), 'the outcome is translated');
    assert.ok(html.includes('<del>—</del> → <ins>3 Punkte</ins>'), 'an empty value reads as a dash');
    assert.ok(html.includes(' · ben'), 'who it was');
  });

  it('nennt ein Gefaess, das es nicht mehr gibt, beim Namen aus dem Verlauf', () => {
    const ui = werkbank();
    ui.setzeStand({
      id: 3,
      eintraege: [
        {
          id: 1,
          at: '2026-01-05T08:00:00.000Z',
          user: 'anna',
          entity: 'run',
          entityId: 9,
          action: 'create',
          record: { code: 'X-9' }
        },
        {
          id: 2,
          at: '2026-01-05T09:00:00.000Z',
          user: 'anna',
          entity: 'run',
          entityId: 9,
          action: 'remove',
          record: { code: 'X-9' }
        }
      ]
    });
    const html = ui.pjVerlaufListe(versuchMit());
    assert.ok(html.includes('exp.hist.remove.run(X-9)'));
    assert.equal(html.includes('#9'), false);
  });

  it('haelt zwei Gefaesse mit demselben Code auseinander', () => {
    const ui = werkbank();
    const v = versuchMit({
      runs: [{ id: 1, code: 'A-1', what: 'Probe' }],
      removedRuns: [
        { id: 2, code: 'A-1', what: 'Kontrolle' },
        { id: 7, code: 'B-1', what: '' }
      ]
    });
    const e = (id, entityId) => ({
      id,
      at: '2026-01-06T09:00:00.000Z',
      user: 'anna',
      entity: 'run',
      entityId,
      action: 'update',
      field: 'result',
      from: '',
      to: 'x'
    });
    ui.setzeStand({ id: 3, eintraege: [e(1, 1), e(2, 2), e(3, 7)] });
    const html = ui.pjVerlaufListe(v);
    assert.ok(html.includes('A-1 (Probe) · exp.hist.f.run.result'));
    assert.ok(html.includes('A-1 (Kontrolle) · exp.hist.f.run.result'));
    assert.ok(html.includes('B-1 · exp.hist.f.run.result'), 'a code that is unique stays short');
    const gleich = versuchMit({
      runs: [{ id: 1, code: 'A-1', what: '' }],
      removedRuns: [{ id: 2, code: 'A-1', what: '' }]
    });
    ui.setzeStand({ id: 3, eintraege: [e(1, 1), e(2, 2)] });
    const html2 = ui.pjVerlaufListe(gleich);
    assert.ok(
      html2.includes('A-1 #1 · ') && html2.includes('A-1 #2 · '),
      'and with nothing else to tell them apart, the id'
    );
  });

  it('zeigt bei einem Foto das Foto, solange es eins gibt', () => {
    const ui = werkbank();
    const eintrag = (uuid) => ({
      id: 1,
      at: '2026-01-06T09:00:00.000Z',
      user: 'anna',
      entity: 'photo',
      entityId: 4,
      action: 'create',
      record: { uuid }
    });
    ui.setzeStand({ id: 3, eintraege: [eintrag('u-1')] });
    const html = ui.pjVerlaufListe(versuchMit({ photos: [{ id: 4, uuid: 'u-1' }] }));
    assert.ok(html.includes('src="/api/experiments/3/photos/u-1?thumb=1"'));
    const weg = ui.pjVerlaufListe(versuchMit({ removedPhotos: [{ id: 4, uuid: 'u-1', purged: true }] }));
    assert.equal(weg.includes('<img'), false, 'a photo deleted for good shows no picture');
  });

  it('sagt, wenn das Konto hinter einem Namen geloescht ist', () => {
    const ui = werkbank();
    ui.setzeStand({
      id: 3,
      eintraege: [
        {
          id: 1,
          at: '2026-01-06T09:00:00.000Z',
          user: 'lena',
          userGone: true,
          entity: 'experiment',
          entityId: 3,
          action: 'create',
          record: {}
        }
      ]
    });
    assert.ok(ui.pjVerlaufListe(V).includes(' · lena exp.hist.userGone'));
  });

  it('escaped, was im Verlauf steht', () => {
    const ui = werkbank();
    ui.setzeStand({
      id: 3,
      eintraege: [
        {
          id: 1,
          at: '2026-01-05T08:00:00.000Z',
          user: '<b>x</b>',
          entity: 'experiment',
          entityId: 3,
          action: 'update',
          field: 'outcome',
          from: '',
          to: '<img src=x onerror=alert(1)>'
        }
      ]
    });
    const html = ui.pjVerlaufListe(V);
    assert.equal(html.includes('<img'), false);
    assert.equal(html.includes('<b>'), false);
    assert.ok(html.includes('&lt;img'));
  });

  it('zeigt Laden und Fehler, statt leer zu bleiben', () => {
    const ui = werkbank();
    assert.ok(ui.pjVerlaufListe(V).includes('common.loading'));
    ui.setzeStand({ id: 99, eintraege: [] });
    assert.ok(ui.pjVerlaufListe(V).includes('common.loading'), 'the history of another experiment is not this one');
    ui.setzeStand({ id: 3, fehler: true });
    assert.ok(ui.pjVerlaufListe(V).includes('exp.histErr'));
  });

  it('ist zu, bis jemand ihn aufklappt, und holt ihn dann einmal', async () => {
    const ui = werkbank();
    ui.experiments.push(V);
    ui.oeffne(3);
    assert.equal(ui.pjVerlauf(V).includes(' open'), false);
    const det = { dataset: { pjVerlauf: '3' }, open: true };
    ui.pjToggle({ target: det });
    assert.deepEqual(
      ui.abrufe.map((a) => a.p),
      ['/api/experiments/3/history']
    );
    // Neu gezeichnet und wieder offen: das holt renderVersuch(), nicht toggle.
    ui.pjToggle({ target: det });
    assert.equal(ui.abrufe.length, 1);
    assert.ok(ui.pjVerlauf(V).includes(' open'), 'it stays open across a redraw');
    ui.abrufe[0].ok({ entries: EINTRAEGE });
    await warten();
    assert.ok(ui.els['pj-verlauf-liste'].innerHTML.includes('exp.hist.f.run.outcome'));
    ui.pjToggle({ target: { dataset: { pjVerlauf: '3' }, open: false } });
    assert.equal(ui.offen(), null);
    ui.pjVerlaufNeu();
    assert.equal(ui.abrufe.length, 1, 'a closed history is not fetched after a save');
    // Andere <details> auf der Seite gehen den Verlauf nichts an.
    ui.pjToggle({ target: { dataset: {}, open: true } });
    assert.equal(ui.abrufe.length, 1);
  });

  it('zeichnet nur die Antwort auf den juengsten Abruf', async () => {
    const ui = werkbank();
    ui.experiments.push(V);
    ui.oeffne(3);
    ui.pjToggle({ target: { dataset: { pjVerlauf: '3' }, open: true } });
    ui.pjVerlaufLaden(3, 'erste');
    ui.abrufe[1].ok({ entries: EINTRAEGE });
    await warten();
    ui.abrufe[0].ok({ entries: [] });
    await warten();
    const html = ui.els['pj-verlauf-liste'].innerHTML;
    assert.ok(html.includes('exp.hist.f.run.outcome'), 'the older, slower answer does not overwrite the newer one');
  });

  it('holt nach dem Speichern eines Feldes neu, wenn der Verlauf offen ist', () => {
    const ui = werkbank();
    ui.experiments.push(V);
    ui.oeffne(3);
    ui.pjToggle({ target: { dataset: { pjVerlauf: '3' }, open: true } });
    ui.pjVerlaufNeu();
    assert.equal(ui.abrufe.length, 2);
  });

  it('holt nach einer Aenderung nur, was seitdem dazukam', async () => {
    const ui = werkbank();
    ui.experiments.push(V);
    ui.oeffne(3);
    ui.pjToggle({ target: { dataset: { pjVerlauf: '3' }, open: true } });
    ui.abrufe[0].ok({ entries: EINTRAEGE, more: false });
    await warten();
    ui.pjVerlaufNeu();
    assert.equal(ui.abrufe[1].p, '/api/experiments/3/history?after=5&limit=500');
    ui.abrufe[1].ok({
      entries: [
        {
          id: 6,
          at: '2026-01-08T08:00:00.000Z',
          user: 'ben',
          entity: 'run',
          entityId: 2,
          action: 'update',
          field: 'result',
          from: '',
          to: 'neu'
        }
      ]
    });
    await warten();
    assert.deepEqual(
      ui.stand().eintraege.map((e) => e.id),
      [1, 2, 3, 4, 5, 6]
    );
    assert.ok(ui.els['pj-verlauf-liste'].innerHTML.includes('<ins>neu</ins>'));
  });

  it('laedt von vorn, wenn eine zurueckgespielte Sicherung die Kennungen zurueckgesetzt hat', async () => {
    const ui = werkbank();
    ui.experiments.push(V);
    ui.oeffne(3);
    ui.pjToggle({ target: { dataset: { pjVerlauf: '3' }, open: true } });
    ui.abrufe[0].ok({ entries: EINTRAEGE, more: false, newest: 5 });
    await warten();
    ui.pjVerlaufNeu();
    ui.abrufe[1].ok({ entries: [], more: false, newest: 2 });
    await warten();
    assert.equal(ui.abrufe[2].p, '/api/experiments/3/history', 'a fresh first page');
    ui.abrufe[2].ok({ entries: EINTRAEGE.slice(0, 2), more: false, newest: 2 });
    await warten();
    assert.deepEqual(
      ui.stand().eintraege.map((e) => e.id),
      [1, 2],
      'the discarded entries are gone from the view'
    );
  });

  it('bietet Aelteres an und haengt es unten an', async () => {
    const ui = werkbank();
    ui.experiments.push(V);
    ui.oeffne(3);
    ui.pjToggle({ target: { dataset: { pjVerlauf: '3' }, open: true } });
    ui.abrufe[0].ok({ entries: EINTRAEGE.slice(2), more: true });
    await warten();
    let html = ui.els['pj-verlauf-liste'].innerHTML;
    assert.ok(html.includes('data-pj-hist-mehr="3"'));
    assert.equal(html.includes('exp.hist.baseline'), false);
    ui.pjVerlaufLaden(3, 'aelter');
    assert.equal(ui.abrufe[1].p, '/api/experiments/3/history?before=3');
    ui.abrufe[1].ok({ entries: EINTRAEGE.slice(0, 2), more: false });
    await warten();
    html = ui.els['pj-verlauf-liste'].innerHTML;
    assert.equal(html.includes('data-pj-hist-mehr'), false);
    assert.ok(html.includes('exp.hist.baseline'));
  });

  it('zeichnet die Liste nur im offenen Verlauf und vergisst sie beim Zuklappen', async () => {
    const ui = werkbank();
    ui.experiments.push(V);
    ui.oeffne(3);
    ui.setzeStand({ id: 3, eintraege: EINTRAEGE, mehr: false });
    assert.ok(ui.pjVerlauf(V).includes('<div id="pj-verlauf-liste"></div>'), 'closed: no list is built');
    ui.pjToggle({ target: { dataset: { pjVerlauf: '3' }, open: true } });
    ui.pjToggle({ target: { dataset: { pjVerlauf: '3' }, open: false } });
    assert.equal(ui.stand(), null, 'closing drops the cached history');
    ui.abrufe[0].ok({ entries: EINTRAEGE });
    await warten();
    assert.equal(ui.stand(), null, 'and an answer still on its way does not bring it back');
  });
});

describe('Verlauf: Notiz speichern', () => {
  // pjNotizClick() gegen Attrappen: derselbe Text geht gar nicht erst zum Server.
  const APP = quelle();
  function werkbank(body) {
    return new Function(
      'body',
      `
      const gepatcht = [];
      const gezeichnet = [];
      let projectNotes = [{ id: 4, tab: 'research', body: 'so steht es da', created: '2026-01-05', updated: '' }];
      const document = { getElementById: () => null };
      const t = (k) => k;
      const toast = () => {};
      const confirm2 = () => {};
      const apiPost = () => Promise.resolve({});
      const apiDelete = () => Promise.resolve({});
      const apiPatch = (p, b) => { gepatcht.push([p, b]); return Promise.resolve({}); };
      const renderProjekte = (k) => gezeichnet.push(k);
      ${hebeFunktion('pjFehlgeschlagen', APP)}
      ${hebeFunktion('pjNotizClick', APP)}
      const feld = { value: body };
      const zeile = { querySelector: () => feld, classList: { remove() {}, add() {} } };
      const knopf = { dataset: { pjNoteSave: '4' }, closest: (s) => (s === '.pj-note' ? zeile : null) };
      pjNotizClick({ target: { closest: (s) => (s === '[data-pj-note-save]' ? knopf : null) } });
      return { gepatcht, gezeichnet, notiz: projectNotes[0] };`
    )(body);
  }

  it('schickt denselben Text nicht und markiert die Notiz nicht als geaendert', () => {
    const r = werkbank('so steht es da');
    assert.deepEqual(r.gepatcht, []);
    assert.equal(r.notiz.updated, '');
    assert.deepEqual(r.gezeichnet, ['research'], 'the edit box still closes');
  });

  it('schickt einen geaenderten Text', () => {
    const r = werkbank('jetzt anders');
    assert.deepEqual(r.gepatcht, [['/api/project-notes/4', { body: 'jetzt anders' }]]);
    assert.ok(r.notiz.updated);
  });
});
