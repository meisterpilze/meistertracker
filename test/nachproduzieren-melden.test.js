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
const { quelle } = require('./helpers/quelle');

const SERVER = quelle('server.js');

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
