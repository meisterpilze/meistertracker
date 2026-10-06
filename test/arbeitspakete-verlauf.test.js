'use strict';
// Der Verlauf der Arbeitspakete: wer ein Paket angelegt, umbenannt oder
// ausgeblendet hat.
//
// Worauf es ankommt: jede echte Aenderung steht mit Namen im Verlauf, in
// derselben Transaktion wie die Aenderung; was sich nicht aendert, schreibt
// nichts; Pakete, die es vor v96 schon gab, bekommen einen Ausgangsstand ohne
// Namen; und das Laborbuch druckt diesen Verlauf, aber nicht in das Blatt eines
// einzelnen Versuchs.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { hebe, hebeFunktion } = require('./helpers/quelle');
const { versuchsrouten } = require('./helpers/versuchsrouten');

const CHEF = { user_id: 1, username: 'chef' };

function datenbank() {
  const p = path.join(os.tmpdir(), 'mt_ap_verlauf_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  const d = db.openDb(p);
  d.prepare('INSERT INTO users(id,username,hash,salt,role,created) VALUES(?,?,?,?,?,?)').run(
    1,
    'chef',
    'x',
    'y',
    'admin',
    new Date().toISOString()
  );
  return {
    p,
    d,
    weg() {
      try {
        d.close();
      } catch {
        // schon zu
      }
      fs.rmSync(p, { force: true });
    }
  };
}
function eintraege(d, id) {
  return d.prepare("SELECT * FROM lab_history WHERE entity='work_package' AND entity_id=? ORDER BY id").all(id);
}

describe('Arbeitspakete im Verlauf', () => {
  let x;
  before(() => {
    x = datenbank();
  });
  after(() => x.weg());

  it('schreibt das Anlegen mit Namen, ohne Versuch', () => {
    const id = db.insertWorkPackage(x.d, { code: 'P1', title: 'Erstes Paket' }, CHEF);
    const [e] = eintraege(x.d, id);
    assert.equal(e.action, 'create');
    assert.equal(e.username, 'chef');
    assert.equal(e.user_id, 1);
    assert.equal(e.experiment_id, null, 'a package belongs to no experiment');
    assert.deepEqual(JSON.parse(e.new_value), { code: 'P1', title: 'Erstes Paket', archived: false });
  });

  it('schreibt Umbenennen und Ausblenden Feld fuer Feld, mit altem und neuem Wert', () => {
    const id = db.listWorkPackages(x.d).find((w) => w.code === 'P1').id;
    assert.equal(db.updateWorkPackage(x.d, id, { code: 'P1a', title: 'Erstes Paket, neu' }, CHEF), true);
    assert.equal(db.updateWorkPackage(x.d, id, { archived: true }, CHEF), true);
    assert.equal(db.updateWorkPackage(x.d, id, { archived: false }, CHEF), true);
    assert.deepEqual(
      eintraege(x.d, id)
        .slice(1)
        .map((e) => [e.action, e.field, e.old_value, e.new_value, e.username]),
      [
        ['update', 'code', 'P1', 'P1a', 'chef'],
        ['update', 'title', 'Erstes Paket', 'Erstes Paket, neu', 'chef'],
        ['update', 'archived', 'false', 'true', 'chef'],
        ['update', 'archived', 'true', 'false', 'chef']
      ]
    );
    assert.deepEqual(
      db.listWorkPackages(x.d).map((w) => [w.code, w.title, w.archived]),
      [['P1a', 'Erstes Paket, neu', false]]
    );
  });

  it('schreibt nichts, wenn sich nichts aendert, auch bei anderer Gross- und Kleinschreibung nicht im Rest', () => {
    const id = db.listWorkPackages(x.d)[0].id;
    const vorher = eintraege(x.d, id).length;
    assert.equal(db.updateWorkPackage(x.d, id, { title: ' Erstes Paket, neu ', archived: false }, CHEF), false);
    assert.equal(db.updateWorkPackage(x.d, id, { code: null, title: null }, CHEF), false);
    assert.equal(eintraege(x.d, id).length, vorher);
  });

  it('schreibt bei einem abgelehnten Code weder Zeile noch Eintrag', () => {
    const zweites = db.insertWorkPackage(x.d, { code: 'P2', title: 'Zweites Paket' }, CHEF);
    const vorher = eintraege(x.d, zweites).length;
    assert.throws(() => db.updateWorkPackage(x.d, zweites, { code: 'p1A' }, CHEF), /already in use/);
    assert.equal(eintraege(x.d, zweites).length, vorher);
    assert.equal(db.listWorkPackages(x.d).find((w) => w.id === zweites).code, 'P2');
  });

  it('nimmt eine Aenderung samt Eintrag zurueck, wenn der Eintrag scheitert', () => {
    const id = db.listWorkPackages(x.d).find((w) => w.code === 'P2').id;
    const vorher = eintraege(x.d, id).length;
    // Ein Verlauf, der nichts mehr annimmt: dann darf auch das Paket bleiben,
    // wie es war.
    x.d.exec("CREATE TRIGGER test_kein_eintrag BEFORE INSERT ON lab_history BEGIN SELECT RAISE(ABORT, 'voll'); END");
    try {
      assert.throws(() => db.updateWorkPackage(x.d, id, { title: 'Zweites, anders' }, CHEF), /voll/);
      assert.throws(() => db.insertWorkPackage(x.d, { code: 'P3', title: 'Drittes' }, CHEF), /voll/);
    } finally {
      x.d.exec('DROP TRIGGER test_kein_eintrag');
    }
    assert.equal(db.listWorkPackages(x.d).find((w) => w.id === id).title, 'Zweites Paket');
    assert.equal(
      db.listWorkPackages(x.d).some((w) => w.code === 'P3'),
      false
    );
    assert.equal(eintraege(x.d, id).length, vorher);
  });

  it('liest den Verlauf aller Pakete oder eines Pakets in der Reihenfolge des Geschehens', () => {
    const [p1, p2] = db.listWorkPackages(x.d);
    const alle = db.listWorkPackageHistory(x.d);
    assert.ok(alle.every((e) => e.entity === 'work_package'));
    assert.deepEqual(
      alle.map((e) => e.id),
      [...alle.map((e) => e.id)].sort((a, b) => a - b)
    );
    assert.ok(db.listWorkPackageHistory(x.d, p2.id).every((e) => e.entityId === p2.id));
    const umbenannt = db.listWorkPackageHistory(x.d, p1.id).find((e) => e.field === 'code');
    assert.equal(umbenannt.from, 'P1');
    assert.equal(umbenannt.to, 'P1a');
    assert.equal(umbenannt.user, 'chef');
    const angelegt = db.listWorkPackageHistory(x.d, p1.id)[0];
    assert.equal(angelegt.record.code, 'P1', 'a record comes back as an object');
  });

  it('steht nicht im Verlauf eines Versuchs, und ein zurueckgespieltes Backup zaehlt es keinem Versuch zu', () => {
    const v = db.insertExperiment(x.d, { code: 'V1', title: 'Lauf', started: '2026-09-01' }, CHEF);
    assert.ok(db.listExperimentHistory(x.d, v).every((e) => e.entity !== 'work_package'));
    // Gegen eine leere Sicherung ist alles verworfen: die Eintraege der Pakete
    // zaehlen je Paket, keiner unter einem Versuch.
    const leer = x.p + '.leer.db';
    db.openDb(leer).close();
    try {
      const n = db.historyDiscarded(x.d, leer);
      assert.deepEqual(
        n.experiments.map((e) => e.id),
        [Number(v)]
      );
      assert.ok(n.workPackages.length > 0);
    } finally {
      for (const s of ['', '-wal', '-shm']) fs.rmSync(leer + s, { force: true });
    }
  });
});

describe('Migration 96: Ausgangsstand fuer Pakete von vorher', () => {
  it('schreibt einen Eintrag je Paket, ohne Namen, mit dem Tag des Anlegens, und nur einmal', () => {
    const x = datenbank();
    let d2;
    try {
      // Pakete, die vor dem Verlauf der Pakete angelegt wurden: Zeilen ohne
      // Eintrag, und v96 gilt als nicht gelaufen.
      const neu = x.d.prepare('INSERT INTO work_packages(code,title,archived,sort,created) VALUES(?,?,?,?,?)');
      neu.run('A1', 'Altes Paket', 0, 1, '2026-09-30T20:00:00.000Z');
      neu.run('A2', 'Altes, ausgeblendet', 1, 2, '2026-09-30T20:05:00.000Z');
      x.d.prepare('DELETE FROM schema_version WHERE version=96').run();
      x.d.close();

      d2 = db.openDb(x.p);
      const alle = d2.prepare("SELECT * FROM lab_history WHERE entity='work_package' ORDER BY id").all();
      assert.deepEqual(
        alle.map((z) => [z.action, z.experiment_id, z.user_id, z.username]),
        [
          ['baseline', null, null, ''],
          ['baseline', null, null, '']
        ],
        'nobody knows who created them, so nobody is named'
      );
      assert.deepEqual(JSON.parse(alle[0].new_value), {
        code: 'A1',
        title: 'Altes Paket',
        archived: false,
        created: '2026-09-30T20:00:00.000Z'
      });
      assert.equal(JSON.parse(alle[1].new_value).archived, true);

      // Der erste Eintrag danach beginnt bei dem Stand, der festgehalten ist.
      const a1 = d2.prepare("SELECT id FROM work_packages WHERE code='A1'").get().id;
      db.updateWorkPackage(d2, a1, { title: 'Altes Paket, neu' }, CHEF);
      const danach = d2.prepare("SELECT * FROM lab_history WHERE entity='work_package' ORDER BY id DESC").get();
      assert.equal(danach.old_value, 'Altes Paket');

      d2.close();
      d2 = db.openDb(x.p);
      assert.equal(
        d2.prepare("SELECT COUNT(*) AS c FROM lab_history WHERE entity='work_package' AND action='baseline'").get().c,
        2,
        'opening again writes no second baseline'
      );
    } finally {
      if (d2) d2.close();
      fs.rmSync(x.p, { force: true });
    }
  });
});

describe('Arbeitspakete im Verlauf ueber die Routen', () => {
  let r;
  const ADMIN = { user_id: 1, username: 'chef', role: 'admin' };
  before(() => {
    r = versuchsrouten({
      benutzer: [
        { id: 1, username: 'chef', role: 'admin' },
        { id: 7, username: 'anna', role: 'user' }
      ]
    });
  });
  after(() => r.schliessen());

  it('schreibt den Namen aus der Sitzung', async () => {
    const neu = await r.anfrage('POST', '/api/work-packages', { code: 'R1', title: 'Routenpaket' }, ADMIN);
    assert.equal(neu.status, 200);
    await r.anfrage('PATCH', '/api/work-packages/' + neu.json.id, { archived: true }, ADMIN);
    assert.deepEqual(
      db.listWorkPackageHistory(r.database, neu.json.id).map((e) => [e.action, e.field || '', e.user]),
      [
        ['create', '', 'chef'],
        ['update', 'archived', 'chef']
      ]
    );
  });

  it('bringt den Verlauf der Pakete im Laborbuch mit, nur fuer Zeitraum und Paket', async () => {
    const paket = db.listWorkPackages(r.database)[0].id;
    const v = db.insertExperiment(r.database, { code: 'RV1', title: 'Lauf', started: '2026-09-01' }, CHEF);
    const alle = await r.anfrage('GET', '/api/lab-book');
    assert.equal(alle.status, 200);
    assert.equal(alle.json.workPackageHistory.length, 2);
    const jePaket = await r.anfrage('GET', '/api/lab-book?workPackage=' + paket);
    assert.equal(jePaket.json.workPackageHistory.length, 2);
    const anderes = await r.anfrage('GET', '/api/lab-book?workPackage=' + (paket + 99));
    assert.deepEqual(anderes.json.workPackageHistory, []);
    const vorher = await r.anfrage('GET', '/api/lab-book?from=2000-01-01&to=2000-12-31');
    assert.deepEqual(vorher.json.workPackageHistory, [], 'only the period');
    const einzeln = await r.anfrage('GET', '/api/lab-book?experiment=' + v);
    assert.deepEqual(einzeln.json.workPackageHistory, [], 'one experiment prints only itself');
  });
});

// ── Laborbuch ───────────────────────────────────────────────
const t = (k, o) => k + (o ? '(' + Object.values(o).join(',') + ')' : '');
function blatt() {
  return new Function(
    't',
    `
    const currentLang = 'de';
    const workPackages = [];
    ${[
      'esc',
      'fmtDt',
      'fmtDtTime',
      'parseDateStr',
      'pjApName',
      'pjVerlaufCodes',
      'pjVerlaufWert',
      'pjVerlaufZeile',
      'pjLbTag',
      'pjLbEntfernt',
      'pjLbGefaess',
      'pjLbFoto',
      'pjLbVersuch',
      'pjLbArbeitspakete',
      'pjLbKette',
      'pjLbHtml'
    ]
      .map((n) => hebeFunktion(n))
      .join('\n')}
    ${hebe([
      [/^const PJ_LB_STIL =[\s\S]*?;\n/m, 'PJ_LB_STIL'],
      [/^const PJ_LB_DRUCK =[\s\S]*?;\n/m, 'PJ_LB_DRUCK']
    ])}
    return pjLbHtml;`
  )(t);
}

describe('Arbeitspakete: Verlauf im Laborbuch', () => {
  const PAKETE = [
    { id: 1, code: 'AP1', title: 'Erstes <b>Paket</b>', archived: false },
    { id: 2, code: 'AP2', title: 'Alt', archived: true }
  ];
  const VERLAUF = [
    {
      id: 10,
      at: '2026-09-30T20:00:00.000Z',
      user: '',
      entity: 'work_package',
      entityId: 2,
      action: 'baseline',
      record: { code: 'AP2', title: 'Alt', archived: false, created: '2026-09-29T10:00:00.000Z' }
    },
    {
      id: 11,
      at: '2026-10-01T09:00:00.000Z',
      user: 'chef',
      entity: 'work_package',
      entityId: 1,
      action: 'create',
      record: { code: 'AP1', title: 'Erstes', archived: false }
    },
    {
      id: 12,
      at: '2026-10-01T09:05:00.000Z',
      user: 'chef',
      entity: 'work_package',
      entityId: 1,
      action: 'update',
      field: 'title',
      from: 'Erstes',
      to: 'Erstes <b>Paket</b>'
    },
    {
      id: 13,
      at: '2026-10-02T09:00:00.000Z',
      user: 'chef',
      entity: 'work_package',
      entityId: 2,
      action: 'update',
      field: 'archived',
      from: 'false',
      to: 'true'
    }
  ];

  it('druckt je Paket seinen heutigen Namen und seinen Verlauf, escaped', () => {
    const html = blatt()(
      { createdAt: '2026-10-03T10:00:00.000Z', workPackages: PAKETE, workPackageHistory: VERLAUF, experiments: [] },
      'Laborbuch',
      'chef'
    );
    assert.ok(html.includes('<h2>exp.lbWpHist</h2>'));
    assert.ok(html.includes('<h3>AP2 · Alt (exp.lbWpHidden)</h3>'), 'a hidden package says so');
    assert.ok(html.includes('<h3>AP1 · Erstes &lt;b&gt;Paket&lt;/b&gt;</h3>'));
    assert.ok(html.includes('exp.hist.create.work_package()'));
    assert.ok(html.includes('exp.hist.f.work_package.title'));
    assert.ok(html.includes('<ins>Erstes &lt;b&gt;Paket&lt;/b&gt;</ins>'));
    assert.ok(html.includes('<del>exp.hist.no</del> → <ins>exp.hist.yes</ins>'));
    assert.ok(html.includes('exp.hist.baseline'), 'the baseline is one line');
    assert.ok(html.includes(' · chef'));
    // Je Paket steht der Ausgangsstand vor dem Rest, und die Pakete in der
    // Reihenfolge ihres ersten Eintrags.
    assert.ok(html.indexOf('AP2 · Alt') < html.indexOf('AP1 · Erstes'));
  });

  it('laesst den Abschnitt weg, wenn es keine Eintraege gibt', () => {
    const leer = blatt()(
      { createdAt: '2026-10-03T10:00:00.000Z', workPackages: PAKETE, workPackageHistory: [], experiments: [] },
      'Laborbuch',
      'chef'
    );
    assert.equal(leer.includes('exp.lbWpHist'), false);
    const alt = blatt()(
      { createdAt: '2026-10-03T10:00:00.000Z', workPackages: PAKETE, experiments: [] },
      'Laborbuch',
      'chef'
    );
    assert.equal(alt.includes('exp.lbWpHist'), false, 'an answer from an older server has no such list');
  });
});
