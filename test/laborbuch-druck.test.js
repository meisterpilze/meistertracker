'use strict';
// Das Laborbuch zum Drucken: was /api/lab-book liefert und was das Blatt
// daraus macht.
//
// Das Blatt ist das, was jemand von aussen in die Hand bekommt.
// Deshalb prueft dieser Test vor allem, dass nichts fehlt, was etwas belegt:
// das Entfernte steht mit darin, mit Datum und Namen; jedes Foto traegt seine
// Pruefsumme, auch ein endgueltig geloeschtes; und ein Zeitraum nimmt die
// Versuche, an denen in ihm gearbeitet wurde, nicht nur die, die in ihm
// anfingen.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const db = require('../db.js');
const { hebe, hebeFunktion } = require('./helpers/quelle');
const { versuchsrouten } = require('./helpers/versuchsrouten');

const ANNA = { user_id: 7, username: 'anna' };
const BEN = { user_id: 8, username: 'ben' };
const PRUEFSUMME = 'ab'.repeat(32);

function datenbank() {
  const p = path.join(os.tmpdir(), 'mt_laborbuch_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  const d = db.openDb(p);
  const neu = d.prepare('INSERT INTO users(id,username,hash,salt,role,created) VALUES(?,?,?,?,?,?)');
  for (const u of [ANNA, BEN]) neu.run(u.user_id, u.username, 'x', 'y', 'user', new Date().toISOString());
  return {
    d,
    weg() {
      d.close();
      fs.rmSync(p, { force: true });
    }
  };
}
// Eine Fotozeile, wie der Upload sie anlegt, mit einer gewaehlten Zeit.
function foto(d, experimentId, uploadedAt, wer, runId) {
  const uuid = crypto.randomUUID();
  return db.addExperimentPhoto(
    d,
    experimentId,
    runId || null,
    {
      uuid,
      rel_path: 'photos/2020/01/exp-' + experimentId + '/' + uuid + '.jpg',
      thumb_path: 'photos/2020/01/exp-' + experimentId + '/' + uuid + '_t.jpg',
      width: 10,
      height: 10,
      bytes: 100,
      sha256: PRUEFSUMME,
      uploaded_at: uploadedAt,
      uploaded_by: wer ? wer.user_id : null
    },
    wer
  );
}
// Ein Eintrag im Verlauf zu einer gewaehlten Zeit. Die Funktionen, die
// aendern, schreiben immer "jetzt"; ein Zeitraum in der Vergangenheit braucht
// Eintraege von damals.
function eintrag(d, at, experimentId, action = 'update') {
  const aenderung = action === 'update';
  d.prepare(
    'INSERT INTO lab_history(at,user_id,username,entity,entity_id,experiment_id,action,field,old_value,new_value) ' +
      'VALUES(?,?,?,?,?,?,?,?,?,?)'
  ).run(
    at,
    7,
    'anna',
    'experiment',
    experimentId,
    experimentId,
    action,
    aenderung ? 'outcome' : null,
    aenderung ? '' : null,
    aenderung ? 'nachgetragen' : '{}'
  );
}
// Mitten am Tag in der Zeit dieses Rechners, damit kein Test an einer
// Zeitzone haengt.
const mittags = (j, m, t) => new Date(j, m - 1, t, 12).toISOString();

describe('labBook: ein Versuch mit allem, was an ihm haengt', () => {
  let db1, id;
  before(() => {
    db1 = datenbank();
    const d = db1.d;
    id = db.insertExperiment(d, { code: 'X1', title: 'Probelauf', started: '2026-01-10' }, ANNA);
    const a1 = db.insertExperimentRun(d, { experimentId: id, code: 'A-1', what: 'Kolben' }, ANNA);
    const a2 = db.insertExperimentRun(d, { experimentId: id, code: 'A-2', what: 'Kontrolle' }, ANNA);
    db.updateExperimentRun(d, a1, { result: 'trueb', outcome: 'good' }, ANNA);
    db.removeExperimentRun(d, a2, BEN);
    foto(d, id, mittags(2026, 1, 11), ANNA, a1);
    const weg = foto(d, id, mittags(2026, 1, 12), ANNA);
    db.removeExperimentPhoto(d, weg, BEN);
    const geloescht = foto(d, id, mittags(2026, 1, 13), ANNA);
    db.removeExperimentPhoto(d, geloescht, BEN);
    db.purgeExperimentPhoto(d, geloescht, BEN);
  });
  after(() => db1.weg());

  it('nimmt auch das entfernte Gefaess mit, mit Datum und Namen', () => {
    const [v] = db.labBook(db1.d, { experimentId: id }).experiments;
    assert.equal(v.code, 'X1');
    assert.deepEqual(
      v.runs.map((r) => [r.code, r.result, r.outcome, r.removedBy]),
      [
        ['A-1', 'trueb', 'good', ''],
        ['A-2', '', 'open', 'ben']
      ]
    );
    assert.ok(v.runs[1].removedAt, 'the removed vessel says when');
    assert.equal(v.runs[0].removedAt, null);
  });

  it('gibt jedem Foto Pruefsumme und Namen, auch dem endgueltig geloeschten', () => {
    const [v] = db.labBook(db1.d, { experimentId: id }).experiments;
    assert.equal(v.photos.length, 3);
    for (const f of v.photos) {
      assert.equal(f.sha256, PRUEFSUMME);
      assert.equal(f.uploadedBy, 'anna');
    }
    assert.deepEqual(
      v.photos.map((f) => [f.removedBy, f.purged]),
      [
        ['', false],
        ['ben', false],
        ['ben', true]
      ]
    );
    assert.equal(v.photos[0].runId, v.runs[0].id, 'the photo knows its vessel');
  });

  it('bringt den ganzen Verlauf mit, in der Reihenfolge des Geschehens', () => {
    const [v] = db.labBook(db1.d, { experimentId: id }).experiments;
    const aktionen = v.history.map((e) => e.action);
    assert.equal(aktionen[0], 'create');
    assert.ok(aktionen.includes('remove'));
    assert.equal(aktionen[aktionen.length - 1], 'purge');
    assert.deepEqual(
      v.history.map((e) => e.id),
      [...v.history.map((e) => e.id)].sort((a, b) => a - b)
    );
  });

  it('nennt den Namen aus dem Verlauf, wenn das Konto nicht mehr da ist', () => {
    // Die Spalten kennen nur die Nummer des Kontos, und die wird mit ihm leer.
    // Wer es war, steht dann nur noch im Verlauf.
    const zweite = datenbank();
    try {
      const d = zweite.d;
      const vid = db.insertExperiment(d, { code: 'X2', title: 'Nachher', started: '2026-02-01' }, ANNA);
      const r = db.insertExperimentRun(d, { experimentId: vid, code: 'B-1' }, ANNA);
      db.removeExperimentRun(d, r, BEN);
      foto(d, vid, mittags(2026, 2, 2), BEN);
      d.prepare('DELETE FROM users WHERE id=?').run(BEN.user_id);
      const [v] = db.labBook(d, { experimentId: vid }).experiments;
      assert.equal(v.runs[0].removedBy, 'ben');
      assert.equal(v.photos[0].uploadedBy, 'ben');
    } finally {
      zweite.weg();
    }
  });

  it('gibt fuer einen unbekannten Versuch eine leere Liste', () => {
    assert.deepEqual(db.labBook(db1.d, { experimentId: 999 }).experiments, []);
  });
});

describe('labBook: ein Zeitraum', () => {
  let db1;
  const ids = {};
  before(() => {
    db1 = datenbank();
    const d = db1.d;
    const neu = (code, started, ended) => {
      ids[code] = db.insertExperiment(d, { code, title: 'Lauf ' + code, started, ended }, ANNA);
    };
    neu('VORHER', '2019-02-01', '2019-12-31');
    neu('DURCH', '2019-06-01', null);
    neu('DRIN', '2020-05-01', '2020-06-01');
    neu('DANACH', '2021-02-01', null);
    neu('NACHGETRAGEN', '2018-01-01', '2018-12-31');
    neu('NUR-STAND', '2018-01-01', '2018-02-01');
    // Am alten Versuch wird 2020 noch gearbeitet: er gehoert ins Jahr.
    eintrag(d, mittags(2020, 3, 15), ids.NACHGETRAGEN);
    // Ausgangsstand und Sicherung sind keine Arbeit am Versuch.
    eintrag(d, mittags(2020, 4, 1), ids['NUR-STAND'], 'baseline');
    eintrag(d, mittags(2020, 4, 2), ids['NUR-STAND'], 'backup');
    // An den Raendern des Jahres, in der Zeit dieses Rechners.
    eintrag(d, new Date(2019, 11, 31, 23, 30).toISOString(), ids.DRIN);
    eintrag(d, new Date(2020, 0, 1, 0, 10).toISOString(), ids.DRIN);
    eintrag(d, new Date(2020, 11, 31, 23, 30).toISOString(), ids.DRIN);
    eintrag(d, new Date(2021, 0, 1, 0, 30).toISOString(), ids.DRIN);
    foto(d, ids.DRIN, new Date(2020, 0, 1, 0, 10).toISOString(), ANNA);
    foto(d, ids.DRIN, new Date(2021, 0, 1, 0, 30).toISOString(), ANNA);
  });
  after(() => db1.weg());

  const jahr2020 = () => db.labBook(db1.d, { from: '2020-01-01', to: '2020-12-31' });

  it('nimmt, was im Zeitraum lief, und was in ihm bearbeitet wurde', () => {
    assert.deepEqual(
      jahr2020().experiments.map((v) => v.code),
      ['NACHGETRAGEN', 'DURCH', 'DRIN']
    );
  });

  it('zeigt Verlauf und Fotos nur aus dem Zeitraum, Tag fuer Tag in der Zeit des Servers', () => {
    const drin = jahr2020().experiments.find((v) => v.code === 'DRIN');
    assert.deepEqual(
      drin.history.map((e) => e.at),
      [new Date(2020, 0, 1, 0, 10).toISOString(), new Date(2020, 11, 31, 23, 30).toISOString()]
    );
    assert.deepEqual(
      drin.photos.map((f) => f.uploadedAt),
      [new Date(2020, 0, 1, 0, 10).toISOString()]
    );
  });

  it('sagt, welcher Zeitraum es ist', () => {
    const b = jahr2020();
    assert.equal(b.from, '2020-01-01');
    assert.equal(b.to, '2020-12-31');
    assert.ok(b.createdAt);
  });

  it('nimmt auch einen Zeitraum mit nur einem Ende', () => {
    assert.deepEqual(
      db.labBook(db1.d, { to: '2018-06-30' }).experiments.map((v) => v.code),
      ['NACHGETRAGEN', 'NUR-STAND']
    );
    // Angelegt wurden alle heute, und Anlegen ist Arbeit am Versuch. Weit in
    // der Zukunft bleiben nur die, die noch laufen.
    assert.deepEqual(
      db.labBook(db1.d, { from: '2099-01-01' }).experiments.map((v) => v.code),
      ['DURCH', 'DANACH']
    );
  });

  it('liefert ohne Angaben alle Versuche mit ihrem ganzen Verlauf', () => {
    const alle = db.labBook(db1.d).experiments;
    assert.equal(alle.length, 6);
    // Angelegt, vier Eintraege von damals und zwei Fotos.
    assert.equal(alle.find((v) => v.code === 'DRIN').history.length, 7);
    assert.equal(alle.find((v) => v.code === 'DRIN').photos.length, 2);
  });
});

describe('/api/lab-book', () => {
  let r, id;
  before(() => {
    r = versuchsrouten({ benutzer: [{ id: 7, username: 'anna', role: 'user' }] });
    id = db.insertExperiment(r.database, { code: 'R1', title: 'Routenlauf', started: '2020-05-01' }, ANNA);
    db.insertExperiment(r.database, { code: 'R2', title: 'Spaeter', started: '2024-05-01' }, ANNA);
  });
  after(() => r.schliessen());

  it('liefert einen Versuch, ohne jemanden nachladen zu lassen', async () => {
    const vorher = r.sendungen();
    const a = await r.anfrage('GET', '/api/lab-book?experiment=' + id);
    assert.equal(a.status, 200);
    assert.deepEqual(
      a.json.experiments.map((v) => v.code),
      ['R1']
    );
    assert.equal(r.sendungen(), vorher, 'reading wakes nobody up');
  });

  it('liefert die Versuche eines Zeitraums', async () => {
    const a = await r.anfrage('GET', '/api/lab-book?from=2020-01-01&to=2020-12-31');
    assert.equal(a.status, 200);
    assert.deepEqual(
      a.json.experiments.map((v) => v.code),
      ['R1']
    );
  });

  it('sagt 404 zu einem Versuch, den es nicht gibt', async () => {
    const a = await r.anfrage('GET', '/api/lab-book?experiment=999');
    assert.equal(a.status, 404);
  });

  it('weist Angaben ab, die kein Versuch und kein Tag sind', async () => {
    for (const frage of [
      'experiment=abc',
      'experiment=1.5',
      'from=2020-13-01',
      'to=gestern',
      'from=2020-02-30',
      'from=2020-12-31&to=2020-01-01'
    ]) {
      const a = await r.anfrage('GET', '/api/lab-book?' + frage);
      assert.equal(a.status, 400, frage);
      assert.ok(a.json && a.json.error, frage + ' says why');
    }
  });
});

// ── Das Blatt ───────────────────────────────────────────────
const t = (k, o) => k + (o ? '(' + Object.values(o).join(',') + ')' : '');

function blatt() {
  return new Function(
    't',
    `
    const currentLang = 'de';
    const loc = () => 'de-DE';
    ${[
      'esc',
      'fmtDt',
      'fmtDtTime',
      'parseDateStr',
      'pjVerlaufCodes',
      'pjVerlaufWert',
      'pjVerlaufZeile',
      'pjLbTag',
      'pjLbEntfernt',
      'pjLbGefaess',
      'pjMb',
      'pjLbFoto',
      'pjLbVersuch',
      'pjLbHtml'
    ]
      .map((n) => hebeFunktion(n))
      .join('\n')}
    ${hebe([
      [/^const PJ_LB_STIL =[\s\S]*?;\n/m, 'PJ_LB_STIL'],
      [/^const PJ_LB_DRUCK =[\s\S]*?;\n/m, 'PJ_LB_DRUCK']
    ])}
    return { pjLbHtml };`
  )(t);
}

const BOESE = '<img src=x onerror=alert(1)>';
function buch(ueber) {
  return {
    createdAt: '2026-09-30T10:00:00.000Z',
    from: null,
    to: null,
    experiments: [
      {
        id: 5,
        code: 'V1' + BOESE,
        title: 'Probelauf' + BOESE,
        started: '2026-09-01',
        ended: null,
        status: 'running',
        archived: false,
        recipe: 'Zutat A 10 g\nZutat B 5 g',
        outcome: '',
        runs: [
          {
            id: 1,
            code: 'A-1',
            what: 'Kolben',
            result: 'klar' + BOESE,
            outcome: 'good',
            cultureId: 'K-9',
            batchId: null,
            removedAt: null,
            removedBy: ''
          },
          {
            id: 2,
            code: 'A-2',
            what: '',
            result: '',
            outcome: 'open',
            cultureId: null,
            batchId: null,
            removedAt: '2026-09-03T08:00:00.000Z',
            removedBy: 'ben'
          }
        ],
        photos: [
          {
            id: 11,
            uuid: 'aaaa-1111',
            runId: 1,
            sha256: 'c0ffee'.repeat(10) + 'beef',
            uploadedAt: '2026-09-02T09:00:00.000Z',
            uploadedBy: 'anna',
            removedAt: null,
            removedBy: '',
            purged: false
          },
          {
            id: 12,
            uuid: 'bbbb-2222',
            runId: null,
            sha256: 'dead'.repeat(16),
            uploadedAt: '2026-09-02T09:05:00.000Z',
            uploadedBy: 'anna',
            removedAt: '2026-09-04T09:00:00.000Z',
            removedBy: 'ben',
            purged: true
          }
        ],
        history: [
          { id: 1, at: '2026-09-01T07:00:00.000Z', entity: 'experiment', entityId: 5, action: 'baseline' },
          { id: 2, at: '2026-09-01T07:00:00.000Z', entity: 'run', entityId: 1, action: 'baseline' },
          {
            id: 3,
            at: '2026-09-02T10:00:00.000Z',
            user: 'anna',
            entity: 'run',
            entityId: 1,
            action: 'update',
            field: 'result',
            from: '',
            to: 'klar'
          },
          {
            id: 4,
            at: '2026-09-03T08:00:00.000Z',
            user: 'ben',
            entity: 'run',
            entityId: 2,
            action: 'remove',
            record: { code: 'A-2', what: '' }
          }
        ]
      }
    ],
    ...ueber
  };
}

describe('Das Blatt', () => {
  const { pjLbHtml } = blatt();

  it('escapt, was aus der Datenbank kommt', () => {
    const html = pjLbHtml(buch(), 'Laborbuch' + BOESE, 'anna' + BOESE);
    assert.equal(html.includes(BOESE), false, 'no raw markup from the data');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });

  it('zeigt jedes Foto mit Pruefsumme, das geloeschte ohne Bild', () => {
    const html = pjLbHtml(buch(), 'Laborbuch', 'anna');
    assert.ok(html.includes('src="/api/experiments/5/photos/aaaa-1111"'), 'the full photo, not the thumbnail');
    assert.equal(html.includes('bbbb-2222'), false, 'a purged photo has no picture to load');
    assert.ok(html.includes('c0ffee'.repeat(10) + 'beef'));
    assert.ok(html.includes('dead'.repeat(16)), 'the purged photo keeps its checksum');
    assert.ok(html.includes('exp.purged'));
    assert.ok(html.includes('exp.lbRemovedBy('), 'removed photo says by whom');
  });

  it('nennt beim Foto mit Original dessen Groesse und Pruefsumme, beim Foto ohne nichts davon', () => {
    const b = buch();
    b.experiments[0].photos[0].original = {
      sha256: 'face'.repeat(16),
      bytes: 3355443,
      width: 4032,
      height: 3024
    };
    const html = pjLbHtml(b, 'Laborbuch', 'anna');
    assert.ok(html.includes('exp.lbOriginal(4032,3024,3,2)'));
    assert.ok(html.includes('SHA-256 ' + 'face'.repeat(16)));
    assert.ok(html.includes('c0ffee'.repeat(10) + 'beef'), 'the checksum of the small picture stays');
    assert.equal(pjLbHtml(buch(), 'Laborbuch', 'anna').includes('exp.lbOriginal'), false);
  });

  it('fuehrt das entfernte Gefaess mit, als entfernt', () => {
    const html = pjLbHtml(buch(), 'Laborbuch', 'anna');
    assert.match(html, /<tr class="weg"><td class="code">A-2<\/td>/);
    assert.ok(html.includes('K-9'), 'culture link printed');
    assert.ok(html.includes('exp.lbActive'));
  });

  it('liest sich von oben nach unten, mit dem Ausgangsstand als einer Zeile', () => {
    const html = pjLbHtml(buch(), 'Laborbuch', 'anna');
    assert.equal(html.split('exp.hist.baseline').length - 1, 1);
    // Der Feldname steht auch im Kopf der Gefaesstabelle; gesucht ist die
    // Zeile im Verlauf.
    const anfang = html.indexOf('exp.hist.baseline');
    const aenderung = html.indexOf('A-1 · exp.hist.f.run.result');
    const entfernt = html.indexOf('exp.hist.remove.run');
    assert.ok(anfang > 0 && anfang < aenderung && aenderung < entfernt, 'oldest first');
  });

  it('nennt den Zeitraum und warum die Felder von heute sind, nur wenn es einer ist', () => {
    const einer = pjLbHtml(buch(), 'Laborbuch', 'anna');
    assert.equal(einer.includes('exp.lbNote'), false);
    assert.equal(einer.includes('exp.lbRange'), false);
    const jahr = pjLbHtml(buch({ from: '2026-01-01', to: '2026-09-30' }), 'Laborbuch', 'anna');
    assert.ok(jahr.includes('exp.lbNote'));
    assert.ok(jahr.includes('exp.lbRange(01.01.26,30.09.26)'));
  });

  it('schlaegt fuer das PDF einen Namen mit Zeitraum vor, die Ueberschrift bleibt kurz', () => {
    // Der Druckdialog nimmt den Titel des Fensters als Dateinamen. Hiesse jeder
    // Bericht "Laborbuch", ueberschriebe der zweite den ersten.
    const titel = (html) => html.match(/<title>([^<]*)<\/title>/)[1];
    const jahr = pjLbHtml(buch({ from: '2026-01-01', to: '2026-09-30' }), 'Laborbuch', 'anna');
    assert.equal(titel(jahr), 'Laborbuch exp.lbRange(2026-01-01,2026-09-30)');
    assert.ok(jahr.includes('<h1>Laborbuch</h1>'));
    const offen = pjLbHtml(buch({ to: '2026-09-30' }), 'Laborbuch', 'anna');
    assert.equal(titel(offen), 'Laborbuch exp.lbRange(…,2026-09-30)');
    assert.equal(titel(pjLbHtml(buch(), 'Laborbuch · V1', 'anna')), 'Laborbuch · V1');
  });

  it('sagt, wenn im Zeitraum nichts lief', () => {
    const html = pjLbHtml(buch({ experiments: [] }), 'Laborbuch', 'anna');
    assert.ok(html.includes('exp.lbNone'));
  });

  it('druckt von selbst, und die Groessen sind fuer Papier', () => {
    const html = pjLbHtml(buch(), 'Laborbuch', 'anna');
    assert.equal(html.split('window.print()').length - 1, 1);
    assert.ok(html.startsWith('<!doctype html>'));
    assert.equal(/font-size:\s*[0-9.]+px/.test(html), false, 'paper sizes are pt, not px');
  });
});

// ── Die Knoepfe ─────────────────────────────────────────────
function knoepfe(felder) {
  return new Function(
    't',
    'felder',
    `
    const aufrufe = [];
    const toasts = [];
    const toast = (m, k) => toasts.push([m, k]);
    const pjLbDrucken = (pfad, titel) => aufrufe.push([pfad, titel]);
    const document = { getElementById: (id) => felder[id] || null };
    const experiments = [{ id: 5, code: 'V1', runs: [], removedRuns: [], photos: [], removedPhotos: [] }];
    const pjExp = (id) => experiments.find((v) => v.id === id) || null;
    let pjOffen = null;
    ${hebeFunktion('pjVersuchClick')}
    const klick = (sel, el) => pjVersuchClick({ target: { closest: (s) => (s === sel ? el : null) } });
    return { klick, aufrufe, toasts };`
  )(t, felder);
}

describe('Die Knoepfe fuers Laborbuch', () => {
  it('druckt einen Versuch aus seiner Ansicht', () => {
    const k = knoepfe({});
    assert.equal(k.klick('[data-pj-lbexp]', { dataset: { pjLbexp: '5' } }), true);
    assert.deepEqual(k.aufrufe, [['/api/lab-book?experiment=5', 'exp.lbTitle · V1']]);
  });

  it('druckt einen Zeitraum aus der Liste', () => {
    const k = knoepfe({ 'pj-lb-von': { value: '2026-01-01' }, 'pj-lb-bis': { value: '2026-09-30' } });
    k.klick('[data-pj-lbdruck]', { dataset: {} });
    assert.deepEqual(k.aufrufe, [['/api/lab-book?from=2026-01-01&to=2026-09-30', 'exp.lbTitle']]);
  });

  it('laesst ein leeres Datum offen', () => {
    const k = knoepfe({ 'pj-lb-von': { value: '' }, 'pj-lb-bis': { value: '2026-09-30' } });
    k.klick('[data-pj-lbdruck]', { dataset: {} });
    const ohne = knoepfe({ 'pj-lb-von': { value: '' }, 'pj-lb-bis': { value: '' } });
    ohne.klick('[data-pj-lbdruck]', { dataset: {} });
    assert.deepEqual(k.aufrufe[0][0], '/api/lab-book?to=2026-09-30');
    assert.deepEqual(ohne.aufrufe[0][0], '/api/lab-book');
  });

  it('sagt, wenn das Ende vor dem Anfang liegt, und fragt nicht', () => {
    const k = knoepfe({ 'pj-lb-von': { value: '2026-09-30' }, 'pj-lb-bis': { value: '2026-01-01' } });
    k.klick('[data-pj-lbdruck]', { dataset: {} });
    assert.deepEqual(k.aufrufe, []);
    assert.deepEqual(k.toasts, [['exp.lbBadRange', 'err']]);
  });
});

function fenster(antwort) {
  return new Function(
    't',
    'antwort',
    `
    const toasts = [];
    const toast = (m, k) => toasts.push([m, k]);
    const currentUser = { username: 'anna' };
    let geoeffnet = null;
    const neuesFenster = () => {
      const w = { closed: false, geschrieben: [], geleert: 0 };
      w.document = {
        open: () => { w.geleert++; w.geschrieben = []; },
        write: (s) => w.geschrieben.push(s),
        close: () => {}
      };
      w.close = () => { w.closed = true; };
      return w;
    };
    const window = { open: () => (geoeffnet = antwort.blockiert ? null : neuesFenster()) };
    const apiGet = (pfad) => (antwort.fehler ? Promise.reject(new Error(antwort.fehler)) : Promise.resolve({ pfad }));
    const pjLbHtml = (buch, titel, wer) => 'BLATT ' + buch.pfad + ' ' + titel + ' ' + wer;
    ${hebeFunktion('esc')}
    ${hebeFunktion('pjLbDrucken')}
    return { pjLbDrucken, toasts, fenster: () => geoeffnet };`
  )(t, antwort);
}

describe('Das Druckfenster', () => {
  it('zeigt erst, dass es arbeitet, dann das Blatt', async () => {
    const f = fenster({});
    const zugesagt = f.pjLbDrucken('/api/lab-book?experiment=5', 'Laborbuch');
    assert.ok(f.fenster().geschrieben[0].includes('exp.lbPreparing'), 'the window opens at once');
    assert.equal(await zugesagt, true);
    assert.deepEqual(f.fenster().geschrieben, ['BLATT /api/lab-book?experiment=5 Laborbuch anna']);
  });

  it('sagt, wenn der Browser das Fenster blockiert', async () => {
    const f = fenster({ blockiert: true });
    assert.equal(await f.pjLbDrucken('/api/lab-book', 'Laborbuch'), false);
    assert.deepEqual(f.toasts, [['worklist.popupBlocked', 'err']]);
  });

  it('macht das Fenster zu und sagt warum, wenn die Daten nicht kommen', async () => {
    const f = fenster({ fehler: 'HTTP 500' });
    assert.equal(await f.pjLbDrucken('/api/lab-book', 'Laborbuch'), false);
    assert.equal(f.fenster().closed, true);
    assert.deepEqual(f.toasts, [['exp.lbErr(HTTP 500)', 'err']]);
  });

  it('schreibt nichts mehr in ein Fenster, das schon zu ist', async () => {
    const f = fenster({});
    const zugesagt = f.pjLbDrucken('/api/lab-book', 'Laborbuch');
    f.fenster().close();
    assert.equal(await zugesagt, false);
    assert.equal(f.fenster().geleert, 0);
  });
});

describe('Der Zeitraum unter der Liste', () => {
  function liste(anzahl) {
    return new Function(
      't',
      `
      const experiments = new Array(${anzahl}).fill({});
      const workPackages = [];
      const heute = new Date();
      ${['esc', 'localDateStr', 'pjLbZeitraum'].map((n) => hebeFunktion(n)).join('\n')}
      let pjWegOffen = {};
      let pjVerlaufOffen = null;
      ${hebe([[/^let pjLbOffen = false;$/m, 'pjLbOffen']])}
      ${hebeFunktion('pjToggle')}
      return { pjLbZeitraum, pjToggle, heute };`
    )(t);
  }

  it('erscheint erst, wenn es einen Versuch gibt', () => {
    assert.equal(liste(0).pjLbZeitraum(), '');
  });

  it('schlaegt das laufende Jahr bis heute vor', () => {
    const l = liste(2);
    const j = l.heute.getFullYear();
    const html = l.pjLbZeitraum();
    assert.ok(html.includes(`id="pj-lb-von" value="${j}-01-01"`));
    const m = String(l.heute.getMonth() + 1).padStart(2, '0');
    const d = String(l.heute.getDate()).padStart(2, '0');
    assert.ok(html.includes(`id="pj-lb-bis" value="${j}-${m}-${d}"`));
  });

  it('bleibt offen, wenn die Liste neu gezeichnet wird', () => {
    const l = liste(1);
    assert.equal(l.pjLbZeitraum().includes('data-pj-lb="1" open'), false);
    l.pjToggle({ target: { dataset: { pjLb: '1' }, open: true } });
    assert.ok(l.pjLbZeitraum().includes('data-pj-lb="1" open'));
  });
});
