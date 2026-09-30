'use strict';
// Arbeitspakete: die Gliederung eines Vorhabens, und welcher
// Versuch zu welchem Paket gehoert.
//
// Worauf es ankommt: ein Versuch zeigt nur auf ein Paket, das es gibt; wer ihn
// einem anderen zuordnet, steht im Verlauf; ein Paket verschwindet nie, es wird
// nur ausgeblendet, damit der Verlauf es auch spaeter noch benennen kann; und
// anlegen und aendern darf nur ein Admin.
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

const ANNA = { user_id: 7, username: 'anna' };

function datenbank() {
  const p = path.join(
    os.tmpdir(),
    'mt_arbeitspakete_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db'
  );
  const d = db.openDb(p);
  d.prepare('INSERT INTO users(id,username,hash,salt,role,created) VALUES(?,?,?,?,?,?)').run(
    7,
    'anna',
    'x',
    'y',
    'user',
    new Date().toISOString()
  );
  return {
    d,
    weg() {
      d.close();
      fs.rmSync(p, { force: true });
    }
  };
}

describe('Arbeitspakete in der Datenbank', () => {
  let x;
  before(() => {
    x = datenbank();
  });
  after(() => x.weg());

  it('hat nach v93 die Tabelle und am Versuch die Spalte', () => {
    const spalten = x.d
      .prepare("SELECT name FROM pragma_table_info('experiments')")
      .all()
      .map((s) => s.name);
    assert.ok(spalten.includes('work_package_id'));
    assert.ok(x.d.prepare('SELECT 1 FROM schema_version WHERE version=93').get());
  });

  it('legt Pakete in der Reihenfolge an, in der sie kommen', () => {
    db.insertWorkPackage(x.d, { code: 'P1', title: 'Erstes Paket' });
    db.insertWorkPackage(x.d, { code: 'P2', title: 'Zweites Paket' });
    assert.deepEqual(
      db.listWorkPackages(x.d).map((w) => [w.code, w.title, w.archived]),
      [
        ['P1', 'Erstes Paket', false],
        ['P2', 'Zweites Paket', false]
      ]
    );
  });

  it('besteht auf Code und Titel, und ein Code gehoert einem Paket, gross oder klein', () => {
    assert.throws(() => db.insertWorkPackage(x.d, { code: 'P3' }), /lab: code and title are required/);
    assert.throws(() => db.insertWorkPackage(x.d, { code: ' ', title: 'leer' }), /required/);
    assert.throws(() => db.insertWorkPackage(x.d, { code: 'p1', title: 'doppelt' }), /already in use/);
  });

  it('benennt um und blendet aus, loescht aber nicht', () => {
    const p2 = db.listWorkPackages(x.d).find((w) => w.code === 'P2').id;
    assert.equal(db.updateWorkPackage(x.d, p2, { title: 'Zweites, genauer' }), true);
    assert.equal(db.updateWorkPackage(x.d, p2, { title: 'Zweites, genauer' }), false, 'nothing changed');
    assert.equal(db.updateWorkPackage(x.d, p2, { code: 'p2' }), true, 'its own code in other case is fine');
    assert.throws(() => db.updateWorkPackage(x.d, p2, { code: 'P1' }), /already in use/);
    assert.throws(() => db.updateWorkPackage(x.d, p2, { title: '  ' }), /must not be empty/);
    assert.equal(db.updateWorkPackage(x.d, p2, { archived: true }), true);
    const w = db.listWorkPackages(x.d).find((z) => z.id === p2);
    assert.deepEqual([w.code, w.title, w.archived], ['p2', 'Zweites, genauer', true]);
    assert.throws(() => db.updateWorkPackage(x.d, 999, { title: 'gibt es nicht' }), /unknown work package/);
  });

  it('liest null als nicht mitgeschickt, nicht als Namen', () => {
    const p2 = db.listWorkPackages(x.d).find((w) => w.code === 'p2');
    assert.equal(db.updateWorkPackage(x.d, p2.id, { code: null, title: null, archived: null }), false);
    const danach = db.listWorkPackages(x.d).find((w) => w.id === p2.id);
    assert.deepEqual([danach.code, danach.title, danach.archived], [p2.code, p2.title, p2.archived]);
  });

  it('ordnet einen Versuch zu, schreibt es in den Verlauf und nimmt es wieder weg', () => {
    const p1 = db.listWorkPackages(x.d).find((w) => w.code === 'P1').id;
    const id = db.insertExperiment(x.d, { code: 'V1', title: 'Ein Lauf', started: '2026-01-05' }, ANNA);
    assert.equal(db.listExperiments(x.d).find((v) => v.id === id).workPackageId, null);
    assert.equal(db.updateExperiment(x.d, id, { workPackageId: p1 }, ANNA), true);
    assert.equal(db.listExperiments(x.d).find((v) => v.id === id).workPackageId, p1);
    assert.equal(db.updateExperiment(x.d, id, { workPackageId: p1 }, ANNA), false, 'same package, no entry');
    assert.equal(db.updateExperiment(x.d, id, { workPackageId: null }, ANNA), true);
    const eintraege = db.listExperimentHistory(x.d, id).filter((e) => e.field === 'workPackageId');
    assert.deepEqual(
      eintraege.map((e) => [e.from, e.to, e.user]),
      [
        [null, String(p1), 'anna'],
        [String(p1), null, 'anna']
      ]
    );
  });

  it('zeigt nur auf ein Paket, das es gibt', () => {
    const id = db.listExperiments(x.d).find((v) => v.code === 'V1').id;
    assert.throws(() => db.updateExperiment(x.d, id, { workPackageId: 999 }, ANNA), /lab: unknown work package/);
    assert.throws(() => db.updateExperiment(x.d, id, { workPackageId: 1.5 }, ANNA), /lab: unknown work package/);
    assert.throws(
      () => db.insertExperiment(x.d, { code: 'V9', title: 'nie', workPackageId: 999 }, ANNA),
      /unknown work package/
    );
    assert.equal(
      db.listExperiments(x.d).some((v) => v.code === 'V9'),
      false
    );
  });

  it('nimmt das Paket schon beim Anlegen, und /api/data bringt die Pakete mit', () => {
    const p1 = db.listWorkPackages(x.d).find((w) => w.code === 'P1').id;
    const id = db.insertExperiment(x.d, { code: 'V2', title: 'Gleich zugeordnet', workPackageId: p1 }, ANNA);
    assert.equal(db.listExperiments(x.d).find((v) => v.id === id).workPackageId, p1);
    const [angelegt] = db.listExperimentHistory(x.d, id);
    assert.equal(angelegt.record.workPackageId, p1);
    assert.deepEqual(
      db.readAll(x.d).workPackages.map((w) => w.code),
      ['P1', 'p2']
    );
  });

  it('druckt je Arbeitspaket und nennt alle Pakete', () => {
    const p1 = db.listWorkPackages(x.d).find((w) => w.code === 'P1').id;
    const buch = db.labBook(x.d, { workPackageId: p1 });
    assert.deepEqual(
      buch.experiments.map((v) => v.code),
      ['V2']
    );
    assert.equal(buch.workPackageId, p1);
    assert.deepEqual(
      buch.workPackages.map((w) => w.code),
      ['P1', 'p2']
    );
    assert.equal(db.labBook(x.d).workPackageId, null);
  });
});

describe('Arbeitspakete ueber die Routen', () => {
  let r, versuch;
  const ADMIN = { user_id: 1, username: 'chef', role: 'admin' };
  before(() => {
    r = versuchsrouten({
      benutzer: [
        { id: 1, username: 'chef', role: 'admin' },
        { id: 7, username: 'anna', role: 'user' }
      ]
    });
    versuch = db.insertExperiment(r.database, { code: 'R1', title: 'Routenlauf', started: '2026-02-01' }, ANNA);
  });
  after(() => r.schliessen());

  it('laesst nur einen Admin anlegen und aendern', async () => {
    assert.equal((await r.anfrage('POST', '/api/work-packages', { code: 'A1', title: 'Paket' })).status, 403);
    const neu = await r.anfrage('POST', '/api/work-packages', { code: 'A1', title: 'Paket' }, ADMIN);
    assert.equal(neu.status, 200);
    assert.ok(neu.json.id);
    assert.equal((await r.anfrage('PATCH', '/api/work-packages/' + neu.json.id, { title: 'anders' })).status, 403);
    const umbenannt = await r.anfrage('PATCH', '/api/work-packages/' + neu.json.id, { title: 'Paket, neu' }, ADMIN);
    assert.equal(umbenannt.status, 200);
    assert.equal(db.listWorkPackages(r.database)[0].title, 'Paket, neu');
  });

  it('sagt, was fehlt oder nicht passt', async () => {
    const faelle = [
      ['POST', '/api/work-packages', { code: 'A2' }],
      ['POST', '/api/work-packages', { code: 'a1', title: 'doppelt' }],
      ['POST', '/api/work-packages', { code: 7, title: 'Zahl' }],
      ['POST', '/api/work-packages', { code: 'X'.repeat(21), title: 'lang' }],
      ['PATCH', '/api/work-packages/999', { title: 'fehlt' }],
      ['PATCH', '/api/work-packages/1', { archived: 'ja' }]
    ];
    for (const [methode, pfad, rumpf] of faelle) {
      const a = await r.anfrage(methode, pfad, rumpf, ADMIN);
      assert.equal(a.status, 400, methode + ' ' + JSON.stringify(rumpf));
      assert.ok(a.json.error);
    }
  });

  it('laesst jeden einen Versuch zuordnen, aber nur einem Paket, das es gibt', async () => {
    const paket = db.listWorkPackages(r.database)[0].id;
    assert.equal((await r.anfrage('PATCH', '/api/experiments/' + versuch, { workPackageId: 1.5 })).status, 400);
    const unbekannt = await r.anfrage('PATCH', '/api/experiments/' + versuch, { workPackageId: 999 });
    assert.equal(unbekannt.status, 400);
    assert.match(unbekannt.json.error, /unknown work package/);
    assert.equal((await r.anfrage('PATCH', '/api/experiments/' + versuch, { workPackageId: paket })).status, 200);
    assert.equal(db.listExperiments(r.database)[0].workPackageId, paket);
    assert.equal((await r.anfrage('PATCH', '/api/experiments/' + versuch, { workPackageId: null })).status, 200);
    assert.equal(db.listExperiments(r.database)[0].workPackageId, null);
  });

  it('druckt je Paket und weist eine Kennung ab, die keine ist', async () => {
    assert.equal((await r.anfrage('GET', '/api/lab-book?workPackage=abc')).status, 400);
    const paket = db.listWorkPackages(r.database)[0].id;
    const a = await r.anfrage('GET', '/api/lab-book?workPackage=' + paket);
    assert.equal(a.status, 200);
    assert.deepEqual(a.json.experiments, []);
    assert.equal(a.json.workPackageId, paket);
  });
});

// ── Oberflaeche ─────────────────────────────────────────────
const t = (k, o) => k + (o ? '(' + Object.values(o).join(',') + ')' : '');
const PAKETE = [
  { id: 1, code: 'AP1', title: 'Erstes <b>Paket</b>', archived: false },
  { id: 2, code: 'AP2', title: 'Alt', archived: true }
];

function ansicht(opts = {}) {
  return new Function(
    't',
    'opts',
    `
    const workPackages = JSON.parse(JSON.stringify(opts.pakete || []));
    let currentUser = opts.admin ? { role: 'admin' } : { role: 'user' };
    const aufrufe = [];
    const toasts = [];
    const toast = (m, k) => toasts.push([m, k]);
    const antwort = opts.antwort || {};
    const apiPatch = (p, b) => { aufrufe.push(['PATCH', p, b]); return Promise.resolve(antwort); };
    const apiPost = (p, b) => { aufrufe.push(['POST', p, b]); return Promise.resolve(antwort); };
    const felder = opts.felder || {};
    const document = { getElementById: (id) => felder[id] || null };
    let gezeichnet = 0;
    const renderVersuch = () => { gezeichnet++; };
    const pjVerlaufNeu = () => {};
    const experiments = [{ id: 5, code: 'V1', workPackageId: null, runs: [], photos: [] }];
    const pjExp = (id) => experiments.find((v) => v.id === id) || null;
    let pjOffen = 5;
    let pjApOffen = false;
    let pjPaketUnterwegs = false;
    ${[
      'esc',
      'pjApName',
      'pjApAuswahl',
      'pjArbeitspakete',
      'pjListenzeile',
      'pjVerlaufWert',
      'pjFehlgeschlagen',
      'pjChange',
      'pjVersuchClick'
    ]
      .map((n) => hebeFunktion(n))
      .join('\n')}
    const klick = (sel, el) => pjVersuchClick({ target: { closest: (s) => (s === sel ? el : null) } });
    return {
      pjApAuswahl, pjArbeitspakete, pjListenzeile, pjVerlaufWert, pjChange, klick,
      aufrufe, toasts, pakete: () => workPackages, versuch: () => experiments[0], gezeichnet: () => gezeichnet
    };`
  )(t, opts);
}
const warten = () => new Promise((r) => setTimeout(r, 0));

describe('Arbeitspakete in der Oberflaeche', () => {
  it('bietet im Versuch nur sichtbare Pakete an, und das eigene auch ausgeblendet', () => {
    const a = ansicht({ pakete: PAKETE });
    const ohne = a.pjApAuswahl({ id: 5, workPackageId: null });
    assert.ok(ohne.includes('<option value="1">AP1 · Erstes &lt;b&gt;Paket&lt;/b&gt;</option>'), 'escaped');
    assert.equal(ohne.includes('value="2"'), false, 'hidden one not offered');
    assert.ok(ohne.includes('<option value="" selected>'));
    const mit = a.pjApAuswahl({ id: 5, workPackageId: 2 });
    assert.ok(mit.includes('<option value="2" selected>AP2 · Alt</option>'), 'keeps the hidden one it has');
    assert.equal(ansicht().pjApAuswahl({ id: 5, workPackageId: null }), '', 'no packages, no choice');
  });

  it('speichert die Auswahl als Kennung, und keins als null', async () => {
    const a = ansicht({ pakete: PAKETE });
    const auswahl = (wert) => ({ value: wert, dataset: { pjFeld: 'workPackageId', pjExp: '5' } });
    a.pjChange({ target: { dataset: {}, closest: () => auswahl('1') } });
    a.pjChange({ target: { dataset: {}, closest: () => auswahl('') } });
    await warten();
    assert.deepEqual(a.aufrufe, [
      ['PATCH', '/api/experiments/5', { workPackageId: 1 }],
      ['PATCH', '/api/experiments/5', { workPackageId: null }]
    ]);
  });

  it('zeigt die Verwaltung nur einem Admin, mit Knopf je Paket', () => {
    assert.equal(ansicht({ pakete: PAKETE }).pjArbeitspakete(), '');
    const html = ansicht({ pakete: PAKETE, admin: true }).pjArbeitspakete();
    assert.ok(html.includes('exp.wps(2)'));
    assert.ok(html.includes('data-pj-aparch="1">exp.wpHide</button>'));
    assert.ok(html.includes('data-pj-aparch="2">exp.wpShow</button>'));
    assert.ok(html.includes('value="Erstes &lt;b&gt;Paket&lt;/b&gt;"'), 'escaped');
  });

  it('benennt ein Paket um, und ein leeres Feld zeigt wieder den alten Namen', async () => {
    const a = ansicht({ pakete: PAKETE, admin: true });
    const feld = (wert) => ({ value: wert, dataset: { pjAp: '1', pjApfeld: 'code' } });
    const leer = feld('   ');
    a.pjChange({ target: leer });
    assert.equal(leer.value, 'AP1');
    a.pjChange({ target: feld(' AP1a ') });
    await warten();
    assert.deepEqual(a.aufrufe, [['PATCH', '/api/work-packages/1', { code: 'AP1a' }]]);
    assert.equal(a.pakete()[0].code, 'AP1a');
  });

  it('nimmt eine Umbenennung zurueck, die der Server ablehnt', async () => {
    const a = ansicht({ pakete: PAKETE, admin: true, antwort: { error: 'lab: work package code already in use' } });
    a.pjChange({ target: { value: 'AP2', dataset: { pjAp: '1', pjApfeld: 'code' } } });
    await warten();
    assert.equal(a.pakete()[0].code, 'AP1');
    assert.equal(a.toasts[0][1], 'err');
  });

  it('legt ein Paket an und prueft den Code vorher', async () => {
    const felder = { 'pj-ap-new-code': { value: 'ap1' }, 'pj-ap-new-title': { value: 'Noch eins' } };
    const doppelt = ansicht({ pakete: PAKETE, admin: true, felder });
    doppelt.klick('[data-pj-apadd]', { dataset: {} });
    assert.deepEqual(doppelt.aufrufe, []);
    assert.deepEqual(doppelt.toasts, [['exp.wpCodeTaken(ap1)', 'err']]);

    felder['pj-ap-new-code'] = { value: ' AP3 ' };
    const a = ansicht({ pakete: PAKETE, admin: true, felder, antwort: { id: 3 } });
    a.klick('[data-pj-apadd]', { dataset: {} });
    await warten();
    assert.deepEqual(a.aufrufe, [['POST', '/api/work-packages', { code: 'AP3', title: 'Noch eins' }]]);
    assert.deepEqual(a.pakete()[2], { id: 3, code: 'AP3', title: 'Noch eins', archived: false });
    assert.equal(felder['pj-ap-new-code'].value, '');
  });

  it('blendet aus und bietet wieder an', async () => {
    const a = ansicht({ pakete: PAKETE, admin: true });
    a.klick('[data-pj-aparch]', { dataset: { pjAparch: '1' } });
    a.klick('[data-pj-aparch]', { dataset: { pjAparch: '2' } });
    await warten();
    assert.deepEqual(a.aufrufe, [
      ['PATCH', '/api/work-packages/1', { archived: true }],
      ['PATCH', '/api/work-packages/2', { archived: false }]
    ]);
    assert.deepEqual(
      a.pakete().map((w) => w.archived),
      [true, false]
    );
  });

  it('nennt das Paket in der Liste und im Verlauf, auch eines, das es nicht mehr gibt', () => {
    const a = ansicht({ pakete: PAKETE });
    const zeile = a.pjListenzeile({
      id: 5,
      code: 'V1',
      title: 'Lauf',
      workPackageId: 1,
      runs: [{ code: 'G-1' }],
      photos: []
    });
    assert.ok(zeile.includes('AP1 · G-1'));
    const e = { entity: 'experiment', field: 'workPackageId' };
    assert.equal(a.pjVerlaufWert(e, '1'), 'AP1 · Erstes <b>Paket</b>', 'escaped later, by pjVerlaufZeile');
    assert.equal(a.pjVerlaufWert(e, '9'), '#9');
    assert.equal(a.pjVerlaufWert(e, null), '—');
  });
});

describe('Arbeitspakete im Laborbuch', () => {
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
  const versuch = {
    id: 5,
    code: 'V1',
    title: 'Lauf',
    started: '2026-09-01',
    ended: null,
    status: 'running',
    archived: false,
    recipe: '',
    outcome: '',
    workPackageId: 1,
    runs: [],
    photos: [],
    history: []
  };

  it('nennt das Paket am Versuch und im Kopf, wenn je Paket gedruckt wird', () => {
    const html = blatt()(
      { createdAt: '2026-09-30T10:00:00.000Z', workPackageId: 1, workPackages: PAKETE, experiments: [versuch] },
      'Laborbuch',
      'anna'
    );
    assert.ok(html.includes('exp.lbWpFilter(AP1 · Erstes &lt;b&gt;Paket&lt;/b&gt;)'));
    assert.ok(html.includes('exp.wp AP1 · Erstes &lt;b&gt;Paket&lt;/b&gt; · '));
  });

  it('bietet beim Zeitraum die Pakete zur Wahl und schickt die Wahl mit', () => {
    const felder = {
      'pj-lb-von': { value: '2026-01-01' },
      'pj-lb-bis': { value: '2026-09-30' },
      'pj-lb-ap': { value: '1' }
    };
    const z = new Function(
      't',
      'felder',
      `
      const experiments = [{}];
      const workPackages = ${JSON.stringify(PAKETE)};
      let pjLbOffen = false;
      const aufrufe = [];
      const pjLbDrucken = (pfad) => aufrufe.push(pfad);
      const toast = () => {};
      const document = { getElementById: (id) => felder[id] || null };
      let pjOffen = null;
      const pjExp = () => null;
      ${['esc', 'localDateStr', 'pjLbZeitraum', 'pjVersuchClick'].map((n) => hebeFunktion(n)).join('\n')}
      pjVersuchClick({ target: { closest: (s) => (s === '[data-pj-lbdruck]' ? {} : null) } });
      return { html: pjLbZeitraum(), aufrufe };`
    )(t, felder);
    assert.ok(z.html.includes('<select id="pj-lb-ap"><option value="">exp.lbWpAll</option>'));
    assert.ok(z.html.includes('<option value="2">AP2 · Alt</option>'), 'hidden packages can still be printed');
    assert.deepEqual(z.aufrufe, ['/api/lab-book?from=2026-01-01&to=2026-09-30&workPackage=1']);
  });
});
