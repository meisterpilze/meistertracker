'use strict';
// "Bestellt, aber nicht da": eine Bestellung, die das Labor nicht decken kann,
// meldet sich in der Glocke, einmal je neuer Bestellung; und was fehlt, steht
// oben in Arbeitsgänge, wo die App aufgeht.
//
// Nur die nicht gedeckte Bestellung meldet sich. Ein Soll zu unterschreiten ist
// Planung und steht unter Nachproduzieren, nicht in der Glocke.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { quelle, hebeFunktion: _hf, hebeKonstante: _hk } = require('./helpers/quelle');

const APP = quelle();
const SERVER = quelle('server.js');
const HTML = quelle('index.html');

describe('Bestellt, aber nicht da: wann es sich meldet', () => {
  let d, dir, a, n;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-'));
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
    n = 1000;
  });
  after(() => {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const bestellung = (sku, qty, status = 'new') => {
    n++;
    db.upsertOrder(d, {
      channel: 'billbee',
      channelOrderId: String(n),
      status,
      customerName: 'Erika Musterfrau',
      items: [{ channelSku: sku, title: 'Testartikel', qty }]
    });
    return String(n);
  };
  const versenden = (id) => db.upsertOrder(d, { channel: 'billbee', channelOrderId: id, status: 'shipped' });

  it('eine Bestellung, die das Regal deckt, meldet nichts', () => {
    bestellung('SPRI-TEST-ALPHA10', 1);
    assert.deepEqual(db.saleAlerts(d), []);
  });

  it('eine, die es nicht deckt, meldet sich einmal, mit Art, Artikel und den Zahlen', () => {
    bestellung('SPRI-TEST-ALPHA10', 1);
    const m = db.saleAlerts(d);
    assert.equal(m.length, 1);
    assert.equal(m[0].title, 'Bestellt, aber nicht da: Testart Alpha · Spritze 10 ml');
    assert.match(m[0].body, /^2 bestellt, 1 im Labor\. Auf der Laborseite unter Nachproduzieren ansetzen\.$/);
    assert.equal(m[0].strainId, a);
    assert.equal(m[0].slot, 10);
    assert.deepEqual(db.saleAlerts(d), [], 'derselbe Stand meldet sich nicht noch einmal');
  });

  it('jede weitere Bestellung, die nicht gedeckt ist, meldet sich wieder', () => {
    bestellung('SPRI-TEST-ALPHA10', 1);
    const m = db.saleAlerts(d);
    assert.equal(m.length, 1);
    assert.match(m[0].body, /^3 bestellt/);
  });

  it('ist alles gedeckt, vergisst es; die nächste nicht gedeckte meldet sich neu', () => {
    const ids = d
      .prepare("SELECT channel_order_id AS id FROM orders WHERE status = 'new'")
      .all()
      .map((x) => x.id);
    for (const id of ids) versenden(id);
    assert.deepEqual(db.saleAlerts(d), []);
    bestellung('SPRI-TEST-ALPHA10', 2);
    assert.equal(db.saleAlerts(d).length, 1);
  });

  it('unter dem Soll allein meldet sich nicht in der Glocke', () => {
    db.setSaleTarget(d, a, 'pd', 3);
    assert.deepEqual(
      db.saleAlerts(d).filter((x) => x.slot === 'pd'),
      []
    );
  });

  it('ein Artikel ohne SKU meldet sich nie', () => {
    db.upsertOrder(d, {
      channel: 'billbee',
      channelOrderId: 'X-1',
      status: 'new',
      items: [{ channelSku: 'GIBT-ES-NICHT', title: 'x', qty: 5 }]
    });
    assert.deepEqual(db.saleAlerts(d), []);
  });
});

describe('Bestellt, aber nicht da: der Server', () => {
  const pruefe = SERVER.slice(
    SERVER.indexOf('function checkSaleAlerts'),
    SERVER.indexOf('function scheduleSaleAlerts')
  );

  it('meldet jedem Benutzer, ohne doppelte, solange die erste ungelesen ist', () => {
    assert.match(pruefe, /db\.listUsers\(database\)/);
    assert.match(pruefe, /createNotificationOnce/);
    assert.match(pruefe, /linkType: 'sale'/);
  });

  it('eine Worktree-Kopie bleibt still', () => {
    assert.match(pruefe, /if \(WORKTREE_MODE\) return;/);
  });

  it('läuft nach jeder Änderung, also auch nach jedem Bestellabgleich', () => {
    const b = SERVER.slice(SERVER.indexOf('function broadcastSSE'), SERVER.indexOf('function broadcastSSE') + 200);
    assert.match(b, /scheduleSaleAlerts\(\)/);
    // Die Verzögerung steht vor broadcastSSE: ein Aufruf beim Start darf nicht
    // an einer noch nicht angelegten Konstante scheitern.
    assert.ok(SERVER.indexOf('const SALE_ALERT_DEBOUNCE_MS') < SERVER.indexOf('function broadcastSSE'));
  });
});

// renderWorkNachproduzieren gegen einen Platzhalter.
function zeile(rows) {
  const el = { hidden: false, textContent: '', klassen: new Set() };
  el.classList = { toggle: (k, an) => (an ? el.klassen.add(k) : el.klassen.delete(k)) };
  new Function(
    'document',
    't',
    `${_hk('VB_KINDS', APP)}
    ${_hf('_vbArtikel', APP)}
    ${_hf('renderWorkNachproduzieren', APP)}
    renderWorkNachproduzieren(${JSON.stringify(rows)});`
  )({ getElementById: () => el }, (k, p) => (p ? k + JSON.stringify(p) : k));
  return el;
}
const art = (o) => ({ strainId: 1, name: 'Testart Alpha', type: 'SY', slot: 10, ml: 10, make: 0, urgency: null, ...o });

describe('Nachproduzieren in Arbeitsgänge', () => {
  it('ist weg, solange nichts fehlt', () => {
    assert.equal(zeile([art({})]).hidden, true);
  });

  it('nennt die Anzahl und die ersten zwei, dringende zuerst, und ist dann rot', () => {
    const el = zeile([
      art({ name: 'Testart Beta', make: 1, urgency: 'low' }),
      art({ type: 'PD', slot: 'pd', make: 2, urgency: 'now' }),
      art({ name: 'Testart Gamma', make: 1, urgency: 'low' })
    ]);
    assert.equal(el.hidden, false);
    assert.equal(
      el.textContent,
      'work.np{"n":3} · Testart Alpha np.kindPD, Testart Beta np.kindSY{"ml":10}, work.npMore{"n":1}'
    );
    assert.ok(el.klassen.has('wk-np-now'));
  });

  it('nur Knappes ist gelb, nicht rot', () => {
    assert.ok(!zeile([art({ make: 1, urgency: 'low' })]).klassen.has('wk-np-now'));
  });

  it('steht über den Kacheln, gleich unter der Warnzeile', () => {
    const np = HTML.indexOf('id="wk-np"');
    assert.ok(np > HTML.indexOf('id="wk-alert"'));
    assert.ok(np < HTML.indexOf('id="wk-tiles"'));
  });

  it('die Seite lädt den Verkaufsbestand, wenn sie aufgeht und wenn sie neu zeichnet', () => {
    assert.match(APP, /if \(page === 'work'\) \{\s*renderDashBatchTasks\(\);\s*loadSaleStock\(\);/);
    assert.match(APP, /if \(id === 'work'\) \{\s*renderDashBatchTasks\(\);\s*loadSaleStock\(\);/);
  });

  it('ein Tipp in der Glocke öffnet den Artikel auf der Laborseite', () => {
    const i = APP.indexOf("linkType === 'sale'");
    const zweig = APP.slice(i, i + 400);
    assert.match(zweig, /go\('lab', 'n-lab'\)/);
    assert.match(zweig, /vbSheetOpen\(parseInt\(sid, 10\), slot\)/);
  });
});
