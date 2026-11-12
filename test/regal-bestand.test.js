'use strict';
// Regal: fertige Ware als eine Zahl je Artikel. Am Fach hängt ein Etikett mit
// einer Nummer aus der Barcode-Liste; Scannen öffnet Rein, Raus und Zählen.
// Diese Tests halten fest, was die Zahl tun darf und was nicht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_regal_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

describe('Regal-Bestand', () => {
  let d, p;
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('legt einen Artikel bei 0 an, mit einer Nummer aus der Barcode-Liste', () => {
    const a = db.createShelfItem(d, '  Testartikel   A ');
    assert.equal(a.name, 'Testartikel A');
    assert.equal(a.stock, 0);
    assert.ok(a.barcode >= 1000000);
    const bc = db.getAllBarcodes(d).find((b) => b.barcode === a.barcode);
    assert.deepEqual([bc.entity_type, bc.entity_id], ['shelf', String(a.id)]);
    assert.ok(
      db.readAll(d).shelf.some((x) => x.id === a.id),
      '/api/data trägt die Liste mit'
    );
  });

  it('nimmt keinen zweiten Artikel mit demselben Namen und keinen leeren', () => {
    assert.throws(() => db.createShelfItem(d, 'testartikel a'), /schon im Regal/);
    assert.throws(() => db.createShelfItem(d, '   '), /Namen/);
    assert.throws(() => db.createShelfItem(d, 'x'.repeat(61)), /zu lang/);
  });

  it('bucht rein, raus und gezählt, und schreibt jede Bewegung in den Verlauf', () => {
    const a = db.createShelfItem(d, 'Testartikel B');
    assert.equal(db.moveShelfStock(d, a.id, { delta: 5 }, null).item.stock, 5);
    assert.equal(db.moveShelfStock(d, a.id, { delta: -2 }, null).item.stock, 3);
    assert.equal(db.moveShelfStock(d, a.id, { count: 12 }, null).item.stock, 12);
    const log = db.listShelfLog(d, a.id, 10);
    assert.deepEqual(
      log.map((e) => [e.kind, e.delta, e.running]),
      [
        ['count', 9, 12],
        ['out', -2, 3],
        ['in', 5, 5]
      ]
    );
  });

  it('nimmt nicht mehr raus, als da ist, und sagt, was zu tun ist', () => {
    const a = db.createShelfItem(d, 'Testartikel C');
    db.moveShelfStock(d, a.id, { delta: 2 }, null);
    assert.throws(() => db.moveShelfStock(d, a.id, { delta: -3 }, null), /nur 2 da.*Zähle/);
    assert.equal(db.getShelfItem(d, a.id).stock, 2);
  });

  it('verlangt ganze Zahlen', () => {
    const a = db.createShelfItem(d, 'Testartikel D');
    assert.throws(() => db.moveShelfStock(d, a.id, { delta: 0 }, null));
    assert.throws(() => db.moveShelfStock(d, a.id, { delta: 1.5 }, null));
    assert.throws(() => db.moveShelfStock(d, a.id, { count: -1 }, null));
    assert.equal(db.moveShelfStock(d, a.id, { count: 0 }, null).item.stock, 0, '0 zu zählen ist erlaubt');
  });

  it('nimmt die letzte Buchung zurück, aber nur die letzte und nur einmal', () => {
    const a = db.createShelfItem(d, 'Testartikel E');
    const erst = db.moveShelfStock(d, a.id, { delta: 4 }, null);
    const dann = db.moveShelfStock(d, a.id, { count: 10 }, null);
    assert.throws(() => db.undoShelfMove(d, erst.logId, null), /schon gezählt/);
    assert.equal(db.undoShelfMove(d, dann.logId, null).stock, 4);
    assert.throws(() => db.undoShelfMove(d, dann.logId, null), /schon zurückgenommen/);
    assert.equal(db.undoShelfMove(d, erst.logId, null).stock, 0);
    const log = db.listShelfLog(d, a.id, 10);
    assert.ok(
      log.every((e) => e.undone),
      'beide stehen als zurückgenommen im Verlauf'
    );
  });

  it('nimmt einen Artikel aus der Liste, ohne seine Nummer zu verlieren', () => {
    const a = db.createShelfItem(d, 'Testartikel F');
    const weg = db.updateShelfItem(d, a.id, { active: false });
    assert.equal(weg.active, false);
    assert.equal(weg.barcode, a.barcode);
    assert.throws(() => db.moveShelfStock(d, a.id, { delta: 1 }, null), /aus der Regal-Liste/);
    // Der Name ist wieder frei, solange der alte Artikel aus der Liste ist.
    const neu = db.createShelfItem(d, 'Testartikel F');
    assert.throws(() => db.updateShelfItem(d, a.id, { active: true }), /schon im Regal/);
    db.updateShelfItem(d, neu.id, { name: 'Testartikel F neu' });
    assert.equal(db.updateShelfItem(d, a.id, { active: true }).active, true);
  });
});

// Bestellungen aus dem Bestellungen-Hub nehmen den Bestand runter. Die Bestellung
// kommt hier so herein, wie der Abgleich mit Billbee sie ablegt (db.upsertOrder).
describe('Regal und Bestellungen', () => {
  let d, p;
  let nr = 1000;
  const bestellung = (items, status) =>
    db.upsertOrder(d, {
      channel: 'billbee',
      channelOrderId: String(++nr),
      status: status || 'new',
      customerName: 'Erika Musterfrau',
      items
    });
  before(() => {
    ({ db: d, path: p } = tmpDb());
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('bucht eine neue Bestellung ab, und dieselbe beim nächsten Abgleich nicht noch einmal', () => {
    const a = db.createShelfItem(d, 'Testbeutel');
    db.moveShelfStock(d, a.id, { count: 20 }, null);
    db.setShelfSku(d, a.id, 'TEST-1', 1);
    db.setShelfSku(d, a.id, 'TEST-3ER', 3);
    bestellung([
      { channelSku: 'TEST-1', qty: 2, title: 'Testbeutel' },
      { channelSku: 'test-3er', qty: 1, title: 'Testbeutel 3er' },
      { channelSku: 'ANDERES', qty: 5, title: 'Nicht im Regal' }
    ]);
    assert.equal(db.syncShelfOrders(d), 2);
    assert.equal(db.getShelfItem(d, a.id).stock, 15, '2 + ein 3er-Pack = 5 Beutel');
    assert.equal(db.syncShelfOrders(d), 0);
    assert.equal(db.getShelfItem(d, a.id).stock, 15);
    const log = db.listShelfLog(d, a.id, 10);
    assert.equal(log[0].kind, 'order');
    assert.equal(log[0].ref, String(nr));
  });

  it('nimmt zurück, wenn dieselbe Bestellung storniert wird', () => {
    const a = db.createShelfItem(d, 'Testbeutel Zurueck');
    db.moveShelfStock(d, a.id, { count: 10 }, null);
    db.setShelfSku(d, a.id, 'TEST-ZURUECK', 1);
    const items = [{ channelSku: 'TEST-ZURUECK', qty: 3 }];
    bestellung(items);
    db.syncShelfOrders(d);
    assert.equal(db.getShelfItem(d, a.id).stock, 7);
    db.upsertOrder(d, { channel: 'billbee', channelOrderId: String(nr), status: 'cancelled', items });
    db.syncShelfOrders(d);
    assert.equal(db.getShelfItem(d, a.id).stock, 10);
  });

  it('bucht keine Bestellung nach, die vor dem Anhängen der SKU kam', () => {
    const a = db.createShelfItem(d, 'Testbeutel Alt');
    db.moveShelfStock(d, a.id, { count: 8 }, null);
    bestellung([{ channelSku: 'TEST-ALT', qty: 2 }]);
    d.prepare("UPDATE orders SET imported='2000-01-01T00:00:00.000Z' WHERE channel_order_id=?").run(String(nr));
    db.setShelfSku(d, a.id, 'TEST-ALT', 1);
    assert.equal(db.syncShelfOrders(d), 0);
    assert.equal(db.getShelfItem(d, a.id).stock, 8);
  });

  it('geht unter 0, wenn mehr verkauft ist als da war', () => {
    const a = db.createShelfItem(d, 'Testbeutel Knapp');
    db.moveShelfStock(d, a.id, { count: 1 }, null);
    db.setShelfSku(d, a.id, 'TEST-KNAPP', 1);
    bestellung([{ channelSku: 'TEST-KNAPP', qty: 3 }]);
    db.syncShelfOrders(d);
    assert.equal(db.getShelfItem(d, a.id).stock, -2);
  });

  it('lässt Rein und Raus auch nach einer Bestellung zurücknehmen', () => {
    const a = db.createShelfItem(d, 'Testbeutel Undo');
    db.setShelfSku(d, a.id, 'TEST-UNDO', 1);
    db.moveShelfStock(d, a.id, { count: 10 }, null);
    const rein = db.moveShelfStock(d, a.id, { delta: 5 }, null);
    bestellung([{ channelSku: 'TEST-UNDO', qty: 1 }]);
    db.syncShelfOrders(d);
    assert.equal(db.undoShelfMove(d, rein.logId, null).stock, 9);
    const order = db.listShelfLog(d, a.id, 10).find((e) => e.kind === 'order');
    assert.throws(() => db.undoShelfMove(d, order.id, null), /storniert/);
  });

  it('hängt eine SKU nur an ein Fach', () => {
    const a = db.createShelfItem(d, 'Testbeutel X');
    const b = db.createShelfItem(d, 'Testbeutel Y');
    db.setShelfSku(d, a.id, 'TEST-X', 1);
    assert.throws(() => db.setShelfSku(d, b.id, 'test-x', 1), /hängt schon an/);
    assert.throws(() => db.setShelfSku(d, b.id, 'MIT LEER', 1), /ohne Leerzeichen/);
    assert.deepEqual(db.setShelfSku(d, a.id, 'TEST-X', 0).skus, []);
  });

  it('meldet ein Fach einmal, wenn es auf den Alarm-Stand fällt, und wieder, wenn es erneut fällt', () => {
    const a = db.createShelfItem(d, 'Testbeutel Alarm');
    assert.equal(a.minStock, 10);
    db.moveShelfStock(d, a.id, { count: 30 }, null);
    db.shelfLowAlerts(d); // alle anderen Testfächer melden sich hier einmal
    assert.deepEqual(db.shelfLowAlerts(d), []);
    db.moveShelfStock(d, a.id, { count: 11 }, null);
    assert.deepEqual(db.shelfLowAlerts(d), [], '11 liegt über dem Alarm bei 10');
    db.moveShelfStock(d, a.id, { delta: -1 }, null);
    assert.deepEqual(
      db.shelfLowAlerts(d).map((x) => x.id),
      [a.id],
      'bei 10 geht der Alarm raus'
    );
    db.moveShelfStock(d, a.id, { delta: -1 }, null);
    assert.deepEqual(db.shelfLowAlerts(d), [], 'nur einmal');
    db.moveShelfStock(d, a.id, { delta: 20 }, null);
    db.shelfLowAlerts(d);
    db.moveShelfStock(d, a.id, { count: 3 }, null);
    assert.deepEqual(
      db.shelfLowAlerts(d).map((x) => x.id),
      [a.id],
      'nach dem Auffüllen ist er wieder scharf'
    );
    assert.equal(db.updateShelfItem(d, a.id, { minStock: 2 }).minStock, 2);
    assert.throws(() => db.updateShelfItem(d, a.id, { minStock: -1 }), /Alarm-Stand/);
  });
});
