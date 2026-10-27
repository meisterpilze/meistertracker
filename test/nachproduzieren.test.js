'use strict';
// Nachproduzieren: was von einem Artikel angesetzt werden muss, und wie dringend.
//
// Verfügbar ist, was im Labor ist, plus was noch wächst, minus was bestellt und
// nicht verschickt ist. Liegt das unter dem Soll, fehlt die Differenz; ohne
// Soll (auf Bestellung) fehlt nur, was bestellt und nicht gedeckt ist. Billbee
// bekommt weiter die Laborzahl: es zieht offene Bestellungen selbst ab.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { routen } = require('./helpers/routen');
const { quelle, hebeFunktion: _hf, hebeKonstante: _hk } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');

describe('Nachproduzieren: die Rechnung', () => {
  const fall = (r) => db.saleNeed(r);

  it('ohne Soll und ohne Bestellung fehlt nichts, auch bei null', () => {
    assert.deepEqual(fall({ count: 0 }), { make: 0, urgency: null });
  });

  it('unter dem Soll fehlt die Differenz; nichts da ist dringend', () => {
    assert.deepEqual(fall({ count: 0, soll: 2 }), { make: 2, urgency: 'now' });
    assert.deepEqual(fall({ count: 1, soll: 3 }), { make: 2, urgency: 'low' });
    assert.deepEqual(fall({ count: 3, soll: 3 }), { make: 0, urgency: null });
  });

  it('was wächst, zählt mit', () => {
    assert.deepEqual(fall({ count: 0, growing: 3, soll: 2 }).make, 0);
    assert.deepEqual(fall({ count: 1, growing: 1, soll: 4 }), { make: 2, urgency: 'low' });
  });

  it('auf Bestellung: eine Bestellung, die das Regal nicht deckt, ist dringend', () => {
    assert.deepEqual(fall({ count: 0, ordered: 1 }), { make: 1, urgency: 'now' });
    assert.deepEqual(fall({ count: 2, ordered: 1 }), { make: 0, urgency: null });
  });

  it('eine Bestellung, die das Wachsende deckt, fehlt nicht, ist aber dringend, sobald sie unter das Soll drückt', () => {
    assert.deepEqual(fall({ count: 0, growing: 2, ordered: 1 }), { make: 0, urgency: null });
    assert.deepEqual(fall({ count: 1, growing: 2, ordered: 2, soll: 2 }), { make: 1, urgency: 'now' });
  });
});

describe('Nachproduzieren: offene Bestellungen und Soll in der Liste', () => {
  let d, dir, a;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-'));
    d = db.openDb(path.join(dir, 'test.db'));
    a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
    db.setSyringeSku(d, a, 10, 'SPRI-TEST-ALPHA10');
    db.setSyringeSku(d, a, 'pd', 'PETRI-TEST-ALPHA');
    db.insertCultures(d, [
      {
        id: 'SY-TST-271026-01',
        type: 'SY',
        strainId: a,
        status: 'active',
        notes: '',
        created: '2026-10-27T00:00:00Z',
        ml: 10
      }
    ]);
    const bestellung = (id, status, items) =>
      db.upsertOrder(d, { channel: 'billbee', channelOrderId: id, status, customerName: 'Erika Musterfrau', items });
    bestellung('1001', 'new', [
      { channelSku: 'SPRI-TEST-ALPHA10', title: 'Spritze', qty: 2 },
      { channelSku: 'SPRI-TEST-ALPHA10', title: 'Rabatt', qty: -1 }
    ]);
    bestellung('1002', 'shipped', [{ channelSku: 'SPRI-TEST-ALPHA10', title: 'Spritze', qty: 5 }]);
    bestellung('1003', 'cancelled', [{ channelSku: 'PETRI-TEST-ALPHA', title: 'Petrischale', qty: 4 }]);
  });
  after(() => {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const zeile = (slot) => db.listSyringeStock(d).find((r) => r.strainId === a && String(r.slot) === String(slot));

  it('zählt nur, was bestellt und nicht verschickt oder storniert ist, und keine Minuszeilen', () => {
    assert.equal(zeile(10).ordered, 2);
    assert.equal(zeile('pd').ordered, 0);
  });

  it('eine Bestellung, die das Labor nicht decken kann, steht als fehlend da, ohne Soll', () => {
    const r = zeile(10);
    assert.equal(r.soll, null);
    assert.equal(r.make, 1);
    assert.equal(r.urgency, 'now');
  });

  it('ein Artikel ohne SKU hat weder Bestellungen noch Soll', () => {
    const r = zeile(20);
    assert.equal(r.sku, '');
    assert.ok(!('make' in r));
  });

  it('das Soll setzen, ändern und mit 0 wieder auf Bestellung stellen', () => {
    db.setSaleTarget(d, a, 'pd', 3);
    assert.equal(zeile('pd').soll, 3);
    assert.equal(zeile('pd').make, 3);
    db.setSaleTarget(d, a, 'pd', 0);
    assert.equal(zeile('pd').soll, null);
    assert.equal(zeile('pd').make, 0);
  });

  it('ohne SKU gibt es kein Soll, und das sagt, was zu tun ist', () => {
    assert.throws(() => db.setSaleTarget(d, a, 20, 2), /keine SKU.*Admin → Kanäle → Billbee/);
  });

  it('ein Soll ist eine ganze Zahl von 0 bis 500', () => {
    assert.throws(() => db.setSaleTarget(d, a, 10, -1), /0 bis 500/);
    assert.throws(() => db.setSaleTarget(d, a, 10, 1.5), /0 bis 500/);
    assert.throws(() => db.setSaleTarget(d, a, 10, 501), /0 bis 500/);
  });
});

describe('Nachproduzieren: die Route', () => {
  let r, a;
  before(() => {
    r = routen({
      name: 'nachproduzieren',
      von: '// The same count for the Labor page',
      bis: "if (req.method === 'POST' && req.url === '/api/syringe-stock/push')",
      helfer: ['jsonOk', 'jsonErr', 'safeErr']
    });
    a = Number(r.db.createMushroomStrain(r.database, { name: 'Testart Beta', kuerzel: 'TB' }));
    r.db.setSyringeSku(r.database, a, 'kb1', 'KORN-TEST-BETA1');
  });
  after(() => r.schliessen());

  it('jeder Angemeldete setzt ein Soll, und die Antwort ist die ganze Liste', async () => {
    const res = await r.anfrage('PUT', '/api/sale-stock/' + a + '/kb1', { soll: 2 });
    assert.equal(res.status, 200);
    const z = res.json.rows.find((x) => x.slot === 'kb1');
    assert.equal(z.soll, 2);
    assert.equal(z.make, 2);
    assert.equal(z.urgency, 'now');
    assert.equal(z.kg, 1);
    assert.equal(r.sendungen(), 1, 'andere Bildschirme erfahren davon');
  });

  it('ein Artikel ohne SKU wird abgelehnt, mit dem Satz, der sagt, was zu tun ist', async () => {
    const res = await r.anfrage('PUT', '/api/sale-stock/' + a + '/kb2', { soll: 2 });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /keine SKU/);
  });
});

// Die Karte und die Zellen gegen eine Seite aus Platzhaltern, wie in
// verkaufsbestand.test.js.
function zeichne(rows) {
  const els = {};
  const el = (id) =>
    (els[id] = els[id] || {
      hidden: false,
      innerHTML: '',
      textContent: '',
      classList: { toggle() {} }
    });
  new Function(
    'document',
    't',
    'esc',
    'fmtDtTime',
    'fmtDtShort',
    `${_hk('VB_KINDS', APP)}
    let _vbKind = 'SY';
    let _vbData = ${JSON.stringify({ enabled: true, rows })};
    ${_hf('_vbNote', APP)}
    ${_hf('_vbCell', APP)}
    ${_hf('_vbSlotLabel', APP)}
    ${APP.match(/^const _vbSlotOrder = .*;$/m)[0]}
    ${_hf('_vbArtikel', APP)}
    ${_hf('renderNachproduzieren', APP)}
    ${_hf('renderSaleStock', APP)}
    renderSaleStock();`
  )(
    { getElementById: el },
    (k, p) => (p ? k + JSON.stringify(p) : k),
    (s) => String(s),
    () => '27.10.26 12:00',
    () => '04.11'
  );
  return { np: el('np-card'), npRows: el('np-rows').innerHTML, table: el('vb-table').innerHTML };
}
const art = (o) => ({
  strainId: 1,
  name: 'Testart Alpha',
  type: 'SY',
  slot: 10,
  ml: 10,
  count: 0,
  growing: 0,
  ordered: 0,
  soll: null,
  make: 0,
  urgency: null,
  pushedCount: 0,
  pushedAt: '2026-10-27T10:00:00Z',
  billbeeStock: 0,
  lastError: null,
  ...o
});

describe('Nachproduzieren: die Karte', () => {
  it('ist weg, solange nichts fehlt', () => {
    assert.equal(zeichne([art({ count: 3 })]).np.hidden, true);
  });

  it('Dringendes zuerst, mit Art, Artikel, Grund und einem Knopf mit der Anzahl', () => {
    const { np, npRows } = zeichne([
      art({ strainId: 2, name: 'Testart Beta', count: 1, soll: 3, make: 2, urgency: 'low' }),
      art({ type: 'GS', slot: 'kb1', ml: null, kg: 1, count: 0, ordered: 1, make: 1, urgency: 'now' })
    ]);
    assert.equal(np.hidden, false);
    assert.ok(npRows.indexOf('np-now') < npRows.indexOf('np-low'), 'dringend steht oben');
    assert.match(npRows, /Testart Alpha · np.kindGS\{"kg":1\}/);
    assert.match(npRows, /np.have\{"n":0\} · np.ordered\{"n":1\}/);
    assert.match(npRows, /data-np-strain="1" data-np-slot="kb1">np.make\{"n":1\}/);
    assert.match(npRows, /aria-label="np.now"/, 'die Farbe allein sagt es einem Screenreader nicht');
  });

  it('eine Zahl ist ein Knopf für ihren Artikel, rot, wenn etwas fehlt, mit dem Grund darunter', () => {
    const { table } = zeichne([
      art({ count: 0, soll: 2, make: 2, urgency: 'now' }),
      art({ strainId: 2, name: 'Testart Beta', count: 3, ordered: 1, pushedCount: 3, billbeeStock: 2 })
    ]);
    assert.match(table, /<button type="button" class="vb-c vb-zero vb-under" data-vb-strain="1" data-vb-slot="10"/);
    assert.match(table, /vb.soll\{"n":2\}/);
    assert.match(table, /class="vb-ord">vb.ordered\{"n":1\}/, 'bestellt geht vor der Billbee-Zahl');
  });
});

describe('Nachproduzieren: Ansetzen und das Soll', () => {
  it('Ansetzen öffnet die Laborarbeit für diese Art, mit Typ, Größe und Anzahl', () => {
    const f = _hf('npAnsetzen', APP);
    assert.match(f, /msQuickOpen\('labor', ms\)/);
    assert.match(f, /r\.type === 'GS' \? 'KB' : r\.type/);
    assert.match(f, /syMengenHtml\('ms-q', \{ \[r\.ml\]: r\.make \}\)/);
    assert.match(f, /kbMengenHtml\('ms-q', \{ \[r\.kg\]: r\.make \}\)/);
  });

  it('ein Tipp auf + oder − gilt sofort und wird kurz danach gespeichert, ohne Rückfrage', () => {
    const f = _hf('vbSollStep', APP);
    assert.match(f, /setTimeout\(\(\) => vbSollSave/);
    assert.doesNotMatch(f, /confirm/);
  });

  it('die Karte steht über dem Verkaufsbestand, außerhalb der Reiter', () => {
    const np = HTML.indexOf('id="np-card"');
    assert.ok(np > HTML.indexOf('id="dash-lab-stock"'));
    assert.ok(np < HTML.indexOf('id="vb-card"'));
    assert.ok(np < HTML.indexOf('<div class="stabs" data-stab-home="nav.lab">'));
  });
});
