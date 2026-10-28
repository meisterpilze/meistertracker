'use strict';
// Laborbestand je Sorte: ein Bild für das ganze Labor.
//
// Vorher standen zwei nebeneinander: Kacheln je Ansatz mit Untergrenzen je
// Sorte, und die Verkaufsbestand-Karte mit einem Soll je Shop-Artikel. Sie
// zählten dieselben Petrischalen und dieselbe Körnerbrut verschieden, mit zwei
// Untergrenzen für ein Regal. Jetzt zählt db.labStock einmal, und Laborseite,
// Arbeitsgänge und Tagesliste lesen nur das.
//
// Die Regeln der alten Untergrenzen bleiben, hier gegen die neue Rechnung
// geprüft: jedes Feld seine eigene Zahl; ohne Untergrenze Ruhe; eine Sorte
// außer Programm fehlt nirgends, auch mit Restbestand; genug da, Zeile weg.
// Neu: rot ist nur eine Bestellung, die nicht rausgehen kann.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const JETZT = new Date('2026-10-27T12:00:00Z');

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-'));
  return { d: db.openDb(path.join(dir, 'test.db')), dir };
}
let seq = 0;
function kultur(d, strainId, type, status = 'active', ml) {
  seq++;
  db.insertCultures(d, [
    {
      id: type + '-TST-271026-' + String(seq).padStart(2, '0'),
      type,
      strainId,
      status,
      notes: '',
      created: '2026-10-27T00:00:00Z',
      ...(ml ? { ml } : {})
    }
  ]);
}
let uhr = 0;
function beutel(d, batchId, strainId, due, kgs) {
  const bags = kgs.map((kg, i) => ({ id: batchId + '-' + String(i + 1).padStart(2, '0'), bagKg: kg }));
  db.insertBatch(d, {
    batchId,
    strainId,
    qty: bags.length,
    days: 14,
    substrate: {},
    bagKg: 1,
    batchType: 'grain',
    notes: '',
    created: '2026-10-06T08:00:00.000Z',
    due,
    bags
  });
  for (const b of bags) {
    uhr++;
    db.appendScanEntries(d, [
      {
        time: '2026-10-06T09:' + String(uhr).padStart(2, '0') + ':00.000Z',
        action: 'ADD',
        batch: batchId,
        bag: b.id,
        from: null,
        to: 'SPAWN'
      }
    ]);
  }
}
const sorte = (L, id) => L.find((s) => s.strainId === id);
const feld = (L, id, key) => sorte(L, id).items.find((i) => i.key === key);

describe('Laborbestand: die Rechnung je Sorte', () => {
  let d, dir, a, b, c;
  before(() => {
    ({ d, dir } = freshDb());
    a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
    b = Number(db.createMushroomStrain(d, { name: 'Testart Beta', kuerzel: 'TB' }));
    c = Number(db.createMushroomStrain(d, { name: 'Testart Gamma', kuerzel: 'TG' }));
    db.updateMushroomStrain(d, a, { minMc: 2, minLc: 3, minPd: 4, minSpawnKg: 5 });
    kultur(d, a, 'MC');
    kultur(d, a, 'LC');
    kultur(d, a, 'LC');
    kultur(d, a, 'LC');
    kultur(d, a, 'PD');
    kultur(d, a, 'PD', 'stored');
    kultur(d, a, 'PD', 'contam');
    beutel(d, 'G-TA-061026-01', a, '2026-10-20T08:00:00.000Z', [1, 2]);
    beutel(d, 'G-TA-211026-01', a, '2026-11-04T08:00:00.000Z', [1]);
    // Beta: außer Programm, mit Untergrenzen und Restbestand.
    db.updateMushroomStrain(d, b, { minPd: 3, imProgramm: false });
    kultur(d, b, 'PD');
    // Gamma: im Programm, keine Untergrenzen.
  });
  after(() => {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('hält Slants, Flüssigkultur, Petrischalen und den kg-Vorrat an je eigene Zahlen', () => {
    const L = db.labStock(d, JETZT);
    assert.deepEqual(
      ['MC', 'LC', 'PD', 'GSKG'].map((k) => [k, feld(L, a, k).have, feld(L, a, k).soll, feld(L, a, k).make]),
      [
        ['MC', 1, 2, 1],
        ['LC', 3, 3, 0],
        ['PD', 2, 4, 2],
        ['GSKG', 3, 5, 1]
      ]
    );
  });

  it('zählt Kulturen aktiv und gelagert, nicht kontaminiert', () => {
    assert.equal(feld(db.labStock(d, JETZT), a, 'PD').have, 2);
  });

  it('wiegt Körnerbrut im Regal, und was noch wächst, deckt den Vorrat mit', () => {
    const g = feld(db.labStock(d, JETZT), a, 'GSKG');
    assert.equal(g.have, 3);
    assert.equal(g.growing, 1);
    assert.equal(g.make, 1, '5 kg Vorrat, 3 fertig und 1 wächst: es fehlt 1');
  });

  it('meldet unter dem Soll gelb, auch bei null, nie rot', () => {
    const L = db.labStock(d, JETZT);
    for (const k of ['MC', 'PD', 'GSKG']) assert.equal(feld(L, a, k).urgency, 'low', k);
  });

  it('schweigt, wo keine Untergrenze gesetzt ist', () => {
    assert.ok(sorte(db.labStock(d, JETZT), c).items.every((i) => i.make === 0));
  });

  it('eine Sorte außer Programm fehlt nirgends, auch mit Restbestand und Untergrenze', () => {
    const s = sorte(db.labStock(d, JETZT), b);
    assert.equal(s.imProgramm, false);
    assert.equal(feld([s], b, 'PD').soll, 3, 'das Soll bleibt stehen, es gilt nur gerade nicht');
    assert.ok(s.items.every((i) => i.make === 0));
  });

  it('verschwindet, sobald genug da ist', () => {
    kultur(d, a, 'MC');
    assert.equal(feld(db.labStock(d, JETZT), a, 'MC').make, 0);
  });

  it('eine Bestellung, die das Regal nicht deckt, ist rot, auch ohne Soll und außer Programm', () => {
    db.setSyringeSku(d, b, 10, 'SPRI-TEST-BETA10');
    db.upsertOrder(d, {
      channel: 'billbee',
      channelOrderId: '1001',
      status: 'new',
      customerName: 'Erika Musterfrau',
      items: [{ channelSku: 'SPRI-TEST-BETA10', title: 'Spritze', qty: 1 }]
    });
    const sy = feld(db.labStock(d, JETZT), b, 'SY10');
    assert.equal(sy.ordered, 1);
    assert.equal(sy.make, 1);
    assert.equal(sy.urgency, 'now');
    assert.ok(sy.shop && sy.shop.sku === 'SPRI-TEST-BETA10', 'ein Shop-Artikel trägt seinen Billbee-Stand');
  });

  it('eine Sorte außer Programm ohne Bestand und ohne Shop ruht, steht aber da, damit man sie einschalten kann', () => {
    const z = Number(db.createMushroomStrain(d, { name: 'Testart Zeta', kuerzel: 'TZ' }));
    db.updateMushroomStrain(d, z, { imProgramm: false });
    const s = sorte(db.labStock(d, JETZT), z);
    assert.equal(s.ruht, true);
    assert.ok(
      s.items.every((i) => !i.make),
      'eine ruhende Sorte fehlt nirgends'
    );
    assert.equal(sorte(db.labStock(d, JETZT), b).ruht, false, 'mit Restbestand ruht sie nicht');
  });
});

describe('Laborbestand: eine Zahl für die Petrischale', () => {
  it('das Soll der Petrischale ist die Untergrenze der Sorte, auch über die Verkaufsroute', () => {
    const { d, dir } = freshDb();
    try {
      const a = Number(db.createMushroomStrain(d, { name: 'Testart Eta', kuerzel: 'TE' }));
      db.setSyringeSku(d, a, 'pd', 'PETRI-TEST-ETA');
      db.setSaleTarget(d, a, 'pd', 5);
      assert.equal(db.listMushroomStrains(d).find((m) => m.id === a).minPd, 5);
      const pd = feld(db.labStock(d, JETZT), a, 'PD');
      assert.equal(pd.soll, 5);
      assert.equal(pd.make, 5);
    } finally {
      d.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Migration 108 nimmt ein Shop-Soll der Petrischale in die Untergrenze, das größere gewinnt', () => {
    const { d, dir } = freshDb();
    try {
      const a = Number(db.createMushroomStrain(d, { name: 'Testart Theta', kuerzel: 'TT' }));
      db.updateMushroomStrain(d, a, { minPd: 2 });
      db.setSyringeSku(d, a, 'pd', 'PETRI-TEST-THETA');
      d.prepare("UPDATE syringe_stock_sku SET soll = 6 WHERE type = 'PD'").run();
      d.prepare('DELETE FROM schema_version WHERE version = 108').run();
      const file = d.location();
      d.close();
      const d2 = db.openDb(file);
      try {
        assert.equal(db.listMushroomStrains(d2).find((m) => m.id === a).minPd, 6);
        assert.equal(d2.prepare("SELECT soll FROM syringe_stock_sku WHERE type = 'PD'").get().soll, null);
      } finally {
        d2.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Die Karten gegen eine Seite aus Platzhaltern.
function seite(species, extra = '') {
  const els = {};
  const el = (id) =>
    (els[id] = els[id] || {
      id,
      hidden: false,
      checked: false,
      innerHTML: '',
      textContent: '',
      klassen: new Set(),
      classList: {
        add: (k) => els[id].klassen.add(k),
        remove: (k) => els[id].klassen.delete(k),
        toggle: (k, an) => (an ? els[id].klassen.add(k) : els[id].klassen.delete(k)),
        contains: (k) => els[id].klassen.has(k)
      }
    });
  const fns = [
    '_lbKurz',
    '_lbLang',
    '_lbChip',
    'renderNachproduzieren',
    'renderWorkNachproduzieren',
    '_lbStat',
    '_lbStatCls',
    '_lbZeile',
    'renderLabStock',
    'buildLabMinTasks'
  ];
  const consts = ['_lbSpecies', '_lbFehlt', '_lbDringend', '_lbIstShop', '_lbZahl', 'NP_ZEIGEN'];
  const code =
    consts.map((n) => APP.match(new RegExp('^const ' + n + ' = .*;$', 'm'))[0]).join('\n') +
    '\n' +
    fns.map((n) => _hf(n, APP)).join('\n');
  const aufgaben = new Function(
    'document',
    't',
    'esc',
    'fmtDtTime',
    'fmtDtShort',
    'fmtKg',
    `let _lbData = ${JSON.stringify({ enabled: true, species })};
    let _npAlle = false;
    let _lbRuhenOffen = false;
    ${code}
    renderLabStock();
    ${extra}
    return buildLabMinTasks();`
  )(
    { getElementById: el },
    (k, p) => (p ? k + JSON.stringify(p) : k),
    (s) => String(s),
    () => '27.10.26 12:00',
    () => '04.11',
    (v) => String(v)
  );
  return { els, aufgaben };
}
const it_ = (key, o) => ({ key, have: 0, growing: 0, ordered: 0, soll: null, make: 0, urgency: null, ...o });
const art = (strainId, name, items, o = {}) => ({
  strainId,
  name,
  kuerzel: '',
  imProgramm: true,
  items: [
    it_('MC', items.MC),
    it_('LC', items.LC),
    it_('PD', items.PD),
    ...(items.SY10 ? [it_('SY10', { ml: 10, ...items.SY10 })] : []),
    it_('GSKG', items.GSKG),
    ...(items.kb1 ? [it_('kb1', { kg: 1, ...items.kb1 })] : [])
  ],
  ...o
});

describe('Laborbestand: die Liste je Sorte', () => {
  it('ist weg, solange es keine Sorte gibt', () => {
    assert.equal(seite([]).els['lb-card'].hidden, true);
  });

  it('fünf Felder je Sorte, gelb unter dem Soll, mit da/Soll', () => {
    const { els } = seite([
      art(1, 'Testart Alpha', { MC: { have: 1, soll: 2, make: 1, urgency: 'low' }, PD: { have: 3 } })
    ]);
    const h = els['lb-list'].innerHTML;
    assert.match(h, /data-lb-strain="1"/);
    assert.equal((h.match(/class="lb-st/g) || []).length, 5);
    assert.match(h, /class="lb-st lb-under"><small>lb\.short\.MC<\/small><b>1<em>\/2<\/em><\/b>/);
    assert.match(h, /lb\.short\.SYall<\/small><b>–<\/b>/, 'eine Sorte ohne Spritzen zeigt einen Strich');
  });

  it('eine ruhende Sorte steht eingeklappt unten, hinter einem Knopf', () => {
    const { els } = seite([
      art(1, 'Testart Alpha', {}),
      art(2, 'Testart Ruhend', {}, { imProgramm: false, ruht: true })
    ]);
    const h = els['lb-list'].innerHTML;
    assert.match(h, /data-lb-strain="1"/);
    assert.doesNotMatch(h, /data-lb-strain="2"/);
    assert.match(h, /data-lb-ruhen[^>]*>lb\.resting\{"n":1\}/);
  });

  it('eine Sorte außer Programm sagt es', () => {
    assert.match(seite([art(1, 'Testart Alpha', {}, { imProgramm: false })]).els['lb-list'].innerHTML, /lb\.paused/);
  });

  it('markiert, was ein Shop verkauft, und sagt, wie es um Billbee steht', () => {
    const shop = { sku: 'x', pushedCount: 2, pushedAt: '2026-10-27T10:00:00Z', billbeeStock: 2, lastError: null };
    const { els } = seite([art(1, 'Testart Alpha', { PD: { have: 2, shop } })]);
    assert.match(els['lb-list'].innerHTML, /lb\.short\.PD<i class="lb-shopdot"/);
    assert.equal(els['lb-bb'].hidden, false);
    assert.equal(els['lb-bb'].textContent, 'vb.allSent{"n":1,"time":"27.10.26 12:00"}');
  });
});

describe('Laborbestand: Nachproduzieren je Sorte', () => {
  it('ist weg, solange nichts fehlt', () => {
    assert.equal(seite([art(1, 'Testart Alpha', { PD: { have: 3 } })]).els['np-card'].hidden, true);
  });

  it('je Sorte, was ihr fehlt, als Stichworte; rot zuerst; ein Knopf je Sorte', () => {
    const { els } = seite([
      art(1, 'Testart Alpha', { MC: { make: 2, urgency: 'low' }, LC: { make: 1, urgency: 'low' } }),
      art(2, 'Testart Beta', { SY10: { ordered: 1, make: 1, urgency: 'now' } })
    ]);
    const h = els['np-rows'].innerHTML;
    assert.ok(
      h.indexOf('Testart Beta') < h.indexOf('Testart Alpha'),
      'eine Bestellung, die nicht rausgeht, steht oben'
    );
    assert.match(h, /np-chip np-now">lb\.chip\.SY\{"n":1,"ml":10\}/);
    assert.match(
      h,
      /np-chip np-low">lb\.chip\.MC\{"n":"2"\}<\/span><span class="np-chip np-low">lb\.chip\.LC\{"n":"1"\}/
    );
    assert.match(h, /data-np-strain="1">np\.go</);
  });

  it('zeigt sechs Sorten und den Rest auf einen Tipp', () => {
    const viele = Array.from({ length: 8 }, (_, i) => art(i + 1, 'Testart ' + i, { PD: { make: 1, urgency: 'low' } }));
    const h = seite(viele).els['np-rows'].innerHTML;
    assert.equal((h.match(/class="np-row"/g) || []).length, 6);
    assert.match(h, /data-np-more>np\.more\{"n":2\}/);
  });

  it('in Arbeitsgänge oben nur, was rot ist', () => {
    const gelb = seite([art(1, 'Testart Alpha', { PD: { make: 1, urgency: 'low' } })]).els['wk-np'];
    assert.equal(gelb.hidden, true, 'das Gelbe steht in der Tagesliste, nicht noch einmal oben');
    const rot = seite([art(2, 'Testart Beta', { SY10: { ordered: 1, make: 1, urgency: 'now' } })]).els['wk-np'];
    assert.equal(rot.hidden, false);
    assert.equal(rot.textContent, 'work.npOrders{"n":1} · Testart Beta lb.short.SY{"ml":10}');
  });
});

describe('Laborbestand: die Tagesliste', () => {
  it('nimmt ihre Laboraufgaben aus denselben Zahlen, eine Zeile je Sorte', () => {
    const { aufgaben } = seite([
      art(1, 'Testart Alpha', { MC: { make: 2, urgency: 'low' }, GSKG: { make: 10, urgency: 'low' } }),
      art(2, 'Testart Beta', { SY10: { ordered: 1, make: 1, urgency: 'now' } }),
      art(3, 'Testart Gamma', { PD: { have: 4 } })
    ]);
    assert.deepEqual(
      aufgaben.map((a) => [a.name, a.strainId, a.empty, a.detail]),
      [
        ['Testart Beta', 2, true, 'lb.chip.SY{"n":1,"ml":10}'],
        ['Testart Alpha', 1, false, 'lb.chip.MC{"n":"2"} · lb.chip.GSKG{"n":"10"}']
      ]
    );
  });

  it('ist leer, bis die Zahlen da sind, und zeichnet sich neu, wenn sie kommen', () => {
    assert.match(_hf('buildLabMinTasks', APP), /_lbSpecies\(\)/);
    assert.match(_hf('loadLabStock', APP), /renderDashBatchTasks\(\)/);
  });
});

describe('Laborbestand: ansetzen und das Soll', () => {
  // lbAnsetzen gegen einen Laborarbeit-Dialog aus Platzhaltern.
  function ansetzen(items, menge) {
    const els = {};
    const el = (id) => (els[id] = els[id] || { innerHTML: '' });
    const log = [];
    const ctx = {};
    new Function(
      'document',
      'log',
      'ctxBox',
      `const MSQ_MEHRERE = ['PD', 'LC', 'SY', 'KB'];
      let _msQuickCtx = null;
      const mushroomStrains = [{ id: 1, name: 'Testart Alpha' }];
      let _lbData = { species: [${JSON.stringify(art(1, 'Testart Alpha', items))}] };
      ${APP.match(/^const _lbSpecies = .*;$/m)[0]}
      ${APP.match(/^const _lbFehlt = .*;$/m)[0]}
      const lbSheetClose = () => log.push('zu');
      const msQuickOpen = (mode, ms) => { _msQuickCtx = { mode, ms }; log.push('open:' + mode + ':' + ms.id); };
      const _msqPickType = (t) => log.push('typ:' + t);
      const msqMehrereUmschalten = () => { _msQuickCtx.mehrere = true; log.push('mehrere'); };
      const syMengenHtml = (p, n) => 'sy' + JSON.stringify(n);
      const kbMengenHtml = (p, n) => 'kb' + JSON.stringify(n);
      const msQuickRender = () => log.push('render');
      const msQuickPreview = () => log.push('preview');
      ${_hf('lbAnsetzen', APP)}
      lbAnsetzen(1, ${JSON.stringify(menge || null)});
      Object.assign(ctxBox, _msQuickCtx);`
    )({ getElementById: el }, log, ctx);
    return { els, log, ctx };
  }

  it('öffnet Laborarbeit → Mehrere mit allem, was fehlt, und den Anzahlen', () => {
    const r = ansetzen({
      MC: { make: 2 },
      PD: { make: 3 },
      SY10: { make: 2 },
      GSKG: { make: 10 },
      kb1: { make: 1 }
    });
    assert.deepEqual(r.log.slice(0, 3), ['zu', 'open:labor:1', 'mehrere']);
    assert.deepEqual(r.ctx.arten, ['PD', 'SY', 'KB'], 'Slants sind die Quelle und nicht Teil von Mehrere');
    assert.deepEqual(r.ctx.n, { PD: 3, LC: 0 });
    assert.equal(r.els['ms-q-sy'].innerHTML, 'sy{"10":2}');
    assert.equal(r.els['ms-q-sizes'].innerHTML, 'kb{"1":1}');
    assert.deepEqual(r.log.slice(-2), ['render', 'preview']);
  });

  it('fehlen nur Slants, geht der Dialog für eine Art auf, mit Slant gewählt', () => {
    const r = ansetzen({ MC: { make: 2 } });
    assert.deepEqual(r.log, ['zu', 'open:labor:1', 'typ:MC']);
  });

  it('aus dem Blatt: genau die eingetippten Anzahlen, nicht was fehlt', () => {
    const r = ansetzen({ PD: { make: 3 }, SY10: { make: 2 }, kb1: { make: 1 } }, { PD: 1, LC: 2, SY10: 0 });
    assert.deepEqual(r.ctx.arten, ['PD', 'LC']);
    assert.deepEqual(r.ctx.n, { PD: 1, LC: 2 });
    assert.equal(r.els['ms-q-sy'].innerHTML, 'sy{}');
    assert.equal(r.els['ms-q-sizes'].innerHTML, 'kb{}');
  });

  it('aus dem Blatt nur Slants: der Dialog für eine Art, mit der Anzahl', () => {
    const r = ansetzen({}, { MC: 4 });
    assert.deepEqual(r.log, ['zu', 'open:labor:1', 'typ:MC', 'preview']);
    assert.equal(r.els['ms-q-qty'].value, 4);
  });

  it('der kg-Vorrat wählt Körnerbrut, die Beutelgrößen trägt man ein', () => {
    const r = ansetzen({ GSKG: { make: 10 } });
    assert.deepEqual(r.ctx.arten, ['KB']);
    assert.equal(r.els['ms-q-sizes'].innerHTML, 'kb{}');
  });

  it('das Soll steht, wo es immer stand: an der Sorte, oder an der SKU der Verkaufsgröße', () => {
    const f = _hf('lbSollSave', APP);
    assert.match(f, /apiPatch\('\/api\/mushroom-strains\/' \+ strainId/);
    assert.match(f, /apiPut\('\/api\/sale-stock\/' \+ strainId \+ '\/' \+ slot/);
    assert.match(APP, /const LB_SORTE_FELD = \{ MC: 'minMc', LC: 'minLc', PD: 'minPd', GSKG: 'minSpawnKg' \};/);
  });

  it('der Bestand steht nur da; die Zahl mit − und + ist, was man ansetzt, und fängt bei 0 an', () => {
    assert.match(_hf('lbSheetOpen', APP), /make: \{\}/);
    const zeile = _hf('_lbSheetZeile', APP);
    assert.match(zeile, /data-lb-make="-1"/);
    assert.match(zeile, /_lbSheet\.make\[i\.key\] \|\| 0/);
    assert.match(zeile, /data-lb-step="-1"/, 'das Soll hat sein eigenes − und +');
    assert.doesNotMatch(_hf('lbMakeStep', APP), /api(Patch|Put|Post)/, 'ansetzen-Zahl speichert nichts');
  });

  it('ein Tipp auf + oder − gilt sofort, ohne Rückfrage, und "Im Programm" schaltet die Sorte', () => {
    const f = _hf('lbSollStep', APP);
    assert.match(f, /setTimeout\(\(\) => lbSollSave/);
    assert.doesNotMatch(f, /confirm/);
    assert.match(_hf('lbProgramm', APP), /\{ imProgramm: an \}/);
  });
});

describe('Laborbestand: wo es steht', () => {
  it('die zwei Karten oben auf der Laborseite, außerhalb der Reiter; die Kacheln sind weg', () => {
    const np = HTML.indexOf('id="np-card"');
    const lb = HTML.indexOf('id="lb-card"');
    const reiter = HTML.indexOf('<div class="stabs" data-stab-home="nav.lab">');
    assert.ok(np > 0 && np < lb && lb < reiter);
    assert.equal(HTML.indexOf('id="dash-lab-stock"'), -1);
    assert.equal(HTML.indexOf('id="vb-card"'), -1);
  });

  it('ein Tipp in der Glocke öffnet die Sorte', () => {
    const i = APP.indexOf("linkType === 'sale'");
    assert.match(APP.slice(i, i + 400), /loadLabStock\(\)\.then\(\(\) => lbSheetOpen\(sid\)\)/);
  });
});
