'use strict';
// Verkaufsbestand auf der Laborseite: was die Shops verkaufen, je Art und
// Größe, mit allen Nullen, und was Billbee davon zuletzt bekommen hat.
//
// Drei Dinge werden geprüft: dass jeder Angemeldete die Zahlen lesen kann
// (das Labor ist meist nicht Admin), dass die Tabelle zeigt, was fehlt, statt
// es wegzulassen, und dass die Karte am Telefon nicht hinter einem Reiter
// verschwindet.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { routen } = require('./helpers/routen');
const { quelle, hebeFunktion: _hf, hebeKonstante: _hk } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');

const ABSCHNITT = {
  name: 'verkaufsbestand',
  von: '// The same count for the Labor page',
  bis: "if (req.method === 'POST' && req.url === '/api/syringe-stock/push')",
  helfer: ['jsonOk', 'jsonErr', 'safeErr']
};

let seq = 0;
function kultur(d, db, strainId, type, status, ml) {
  seq++;
  db.insertCultures(d, [
    {
      id: type + '-TST-261026-' + String(seq).padStart(2, '0'),
      type,
      strainId,
      status,
      notes: '',
      created: '2026-10-26T00:00:00Z',
      ...(ml ? { ml } : {})
    }
  ]);
}

describe('Verkaufsbestand: die Route', () => {
  let r, a, b, c;
  before(() => {
    r = routen(ABSCHNITT);
    const { db, database: d } = r;
    a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
    b = Number(db.createMushroomStrain(d, { name: 'Testart Beta', kuerzel: 'TB' }));
    c = Number(db.createMushroomStrain(d, { name: 'Testart Gamma', kuerzel: 'TG' }));
    db.setSyringeSku(d, a, 10, 'SPRI-TEST-ALPHA10');
    db.setSyringeSku(d, a, 50, 'SPRI-TEST-ALPHA50');
    db.setSyringeSku(d, b, 'pd', 'PETRI-TEST-BETA');
    kultur(d, db, a, 'SY', 'active', 10);
    kultur(d, db, a, 'SY', 'stored', 10);
    kultur(d, db, a, 'SY', 'used', 10);
    // Gamma hat Spritzen im Labor, aber keine SKU: kein Shop verkauft sie.
    kultur(d, db, c, 'SY', 'active', 10);
  });
  after(() => r.schliessen());

  it('liest jeder Angemeldete, nicht nur der Admin', async () => {
    const res = await r.anfrage('GET', '/api/sale-stock');
    assert.equal(res.status, 200);
    assert.equal(res.json.enabled, false);
  });

  it('zeigt jeden Artikel mit SKU, auch die Nullen, und keinen ohne', async () => {
    const { json } = await r.anfrage('GET', '/api/sale-stock');
    const kurz = json.rows.map((x) => [x.name, x.type, x.slot, x.count]);
    assert.deepEqual(kurz, [
      ['Testart Alpha', 'SY', 10, 2],
      ['Testart Alpha', 'SY', 50, 0],
      ['Testart Beta', 'PD', 'pd', 0]
    ]);
    assert.ok(!json.rows.some((x) => x.strainId === c), 'Gamma hat keine SKU und gehört nicht in den Verkaufsbestand');
  });

  it('sagt, was Billbee zuletzt bekommen hat, und nennt die SKU nicht', async () => {
    const { db, database: d } = r;
    db.recordSyringePush(d, a, 10, { count: 2, billbeeStock: 1 });
    db.recordSyringePush(d, a, 50, { error: 'Billbee kennt die SKU nicht.' });
    const { json } = await r.anfrage('GET', '/api/sale-stock');
    const zehn = json.rows.find((x) => x.slot === 10);
    assert.equal(zehn.pushedCount, 2);
    assert.equal(zehn.billbeeStock, 1);
    assert.ok(zehn.pushedAt);
    assert.equal(json.rows.find((x) => x.slot === 50).lastError, 'Billbee kennt die SKU nicht.');
    assert.ok(!('sku' in zehn), 'die SKU setzt der Admin; die Laborseite braucht sie nicht');
  });

  it('meldet, ob der Abgleich an ist', async () => {
    r.db.setSyringeStockSyncEnabled(r.database, true);
    const { json } = await r.anfrage('GET', '/api/sale-stock');
    assert.equal(json.enabled, true);
  });
});

// renderSaleStock gegen eine Seite aus Platzhaltern.
function zeichne(daten, art) {
  const els = {};
  const el = (id) =>
    (els[id] = els[id] || {
      id,
      hidden: false,
      innerHTML: '',
      textContent: '',
      klassen: new Set(),
      classList: {
        toggle(k, an) {
          if (an) els[id].klassen.add(k);
          else els[id].klassen.delete(k);
        }
      }
    });
  new Function(
    'document',
    't',
    'esc',
    'fmtDtTime',
    `${_hk('VB_KINDS', APP)}
    let _vbKind = ${JSON.stringify(art || 'SY')};
    let _vbData = ${JSON.stringify(daten)};
    ${_hf('_vbNote', APP)}
    ${_hf('_vbCell', APP)}
    ${_hf('_vbSlotLabel', APP)}
    ${_hf('renderSaleStock', APP)}
    renderSaleStock();`
  )(
    { getElementById: el },
    (k, p) => (p ? k + JSON.stringify(p) : k),
    (s) => String(s),
    () => '26.10.26 12:31'
  );
  return { card: el('vb-card'), seg: el('vb-seg'), table: el('vb-table').innerHTML, bb: el('vb-bb') };
}
const zeile = (o) => ({
  strainId: 1,
  name: 'Testart Alpha',
  type: 'SY',
  slot: 10,
  count: 0,
  pushedCount: 0,
  pushedAt: '2026-10-26T10:31:00Z',
  billbeeStock: 0,
  lastError: null,
  ...o
});

describe('Verkaufsbestand: die Karte', () => {
  it('bleibt verborgen, solange kein Shop etwas aus dem Labor verkauft', () => {
    assert.equal(zeichne({ enabled: true, rows: [] }).card.hidden, true);
  });

  it('eine Spalte je Größe, die ein Shop führt, und ein Punkt, wo eine Art sie nicht hat', () => {
    const { table } = zeichne({
      enabled: true,
      rows: [
        zeile({ slot: 10, count: 3, pushedCount: 3, billbeeStock: 3 }),
        zeile({ slot: 50, count: 0 }),
        zeile({ strainId: 2, name: 'Testart Beta', slot: 10, count: 0 })
      ]
    });
    assert.match(table, /<th scope="col">10 ml<\/th><th scope="col">50 ml<\/th><\/tr>/);
    assert.doesNotMatch(table, /20 ml/, 'eine Größe ohne SKU bekommt keine Spalte');
    const beta = table.split('Testart Beta')[1];
    assert.match(beta, /vb-na/, 'Beta hat keine 50er im Shop');
  });

  it('zeigt die Null, statt die Art wegzulassen, und graut sie aus', () => {
    const { table } = zeichne({ enabled: true, rows: [zeile({ count: 0 })] });
    assert.match(table, /class="vb-c vb-zero"[^>]*><b>0<\/b>/);
  });

  it('sagt unter einer Zahl nur, was abweicht', () => {
    const { table } = zeichne({
      enabled: true,
      rows: [
        zeile({ slot: 10, count: 4, pushedCount: 4, billbeeStock: 4 }),
        zeile({ slot: 20, count: 4, pushedCount: 4, billbeeStock: 3 }),
        zeile({ slot: 50, count: 2, pushedCount: 1, billbeeStock: 1 })
      ]
    });
    const zellen = table.split('<td>').slice(1);
    assert.doesNotMatch(zellen[0], /<i/, 'gleich wie gemeldet: nichts darunter');
    assert.match(zellen[1], /vb.billbee\{"n":3\}/, 'Billbee hat eine offene Bestellung abgezogen');
    assert.match(zellen[2], /vb.waiting/, 'die neue Zahl ist noch nicht bei Billbee');
  });

  it('ein Fehler steht an der Zahl und in der Zeile darunter', () => {
    const { table, bb } = zeichne({
      enabled: true,
      rows: [zeile({ count: 1, lastError: 'Billbee kennt die SKU nicht.' }), zeile({ slot: 20, count: 0 })]
    });
    assert.match(table, /vb-err/);
    assert.match(table, /title="Billbee kennt die SKU nicht\."/);
    assert.equal(bb.textContent, 'vb.errors{"n":1}');
    assert.ok(bb.klassen.has('vb-bb-warn'));
  });

  it('ist der Abgleich aus, steht das da, und die Zahlen bleiben ohne Billbee-Zeile', () => {
    const { table, bb } = zeichne({ enabled: false, rows: [zeile({ count: 2, pushedCount: 0, pushedAt: null })] });
    assert.equal(bb.textContent, 'vb.off');
    assert.doesNotMatch(table, /<i/);
  });

  it('alles gemeldet: wie viele und wann zuletzt', () => {
    const { bb } = zeichne({
      enabled: true,
      rows: [zeile({ count: 1, pushedCount: 1, billbeeStock: 1 }), zeile({ type: 'PD', slot: 'pd' })]
    });
    assert.equal(bb.textContent, 'vb.allSent{"n":2,"time":"26.10.26 12:31"}');
    assert.ok(!bb.klassen.has('vb-bb-warn'));
  });

  it('ein Reiter je Warenart, und keiner, wenn es nur eine gibt', () => {
    const zwei = zeichne({ enabled: true, rows: [zeile({}), zeile({ type: 'PD', slot: 'pd' })] }, 'PD');
    assert.equal(zwei.seg.hidden, false);
    assert.match(zwei.seg.innerHTML, /data-vb-kind="PD" aria-pressed="true"/);
    assert.match(zwei.table, /vb.pieces/, 'die Petrischale hat eine Spalte, keine Größen');
    const eine = zeichne({ enabled: true, rows: [zeile({ type: 'PD', slot: 'pd' })] }, 'SY');
    assert.equal(eine.seg.hidden, true);
    assert.match(eine.table, /vb.pieces/, 'ohne Spritzen fällt der Reiter auf die Petrischalen');
  });
});

describe('Verkaufsbestand: wo die Karte steht', () => {
  it('über den Reitern der Laborseite, damit sie am Telefon nicht in einem Reiter verschwindet', () => {
    const karte = HTML.indexOf('id="vb-card"');
    const reiter = HTML.indexOf('<div class="stabs" data-stab-home="nav.lab">');
    const labor = HTML.indexOf('id="dash-lab-stock"');
    assert.ok(karte > labor && karte < reiter);
  });

  it('lädt, wenn die Laborseite aufgeht und wenn sie neu zeichnet', () => {
    const zweige = APP.match(/if \((?:page|id) === 'lab'\) \{[^}]*\}/g);
    assert.equal(zweige.length, 2);
    for (const z of zweige) assert.match(z, /loadSaleStock\(\)/);
  });
});
