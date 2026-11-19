'use strict';
// Das Etikett auf dem fertigen Paket scannen setzt "Gepackt", wie der Knopf.
// Ein GLS-Etikett hat drei Codes; welcher es ist, soll egal sein. Paketnummern,
// Namen und Codes hier sind erfunden.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const board = require('../order-board.js');

// So sieht der große Code aus: viel drumherum, die Paketnummer mittendrin.
const grossCode = (nr) => 'ADE 000DE00X' + nr + 'ab12cdTESTTRCK          201B000000000  000000000';
const adressCode = (name) => 'A|' + name + '|Musterweg|Musterstadt|1|||';

describe('Etikett scannen', () => {
  let d, p;
  let nr = 5000;
  const bestellung = (o) =>
    db.upsertOrder(d, {
      channel: 'billbee',
      channelOrderId: String(++nr),
      status: 'new',
      customerName: o.name || 'Erika Musterfrau',
      raw: {
        OrderNumber: String(nr),
        State: o.state || 3,
        LabelIds: o.labels || [],
        CustomerKey: o.key || null
      },
      items: o.items || [{ channelSku: 'TEST-SCAN', qty: 1 }]
    });
  const gepackt = (id) => db.listBoardOrders(d, {}).find((o) => o.id === id).marks.packed;
  let fach;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_scan_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
    fach = db.createShelfItem(d, 'Testbeutel Scan');
    db.setShelfSku(d, fach.id, 'TEST-SCAN', 1);
    db.moveShelfStock(d, fach.id, { count: 50 }, null);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('findet die Bestellung, wenn die Paketnummer im großen Code steckt, und nimmt die Beutel aus dem Regal', () => {
    const id = bestellung({ labels: ['99000000001'], items: [{ channelSku: 'TEST-SCAN', qty: 3 }] });
    db.syncShelfOrders(d);
    assert.equal(db.getShelfItem(d, fach.id).held, 3);
    const r = db.scanShippingLabel(d, grossCode('99000000001'), 'erika');
    assert.equal(r.via, 'label');
    assert.deepEqual(
      r.orders.map((o) => [o.id, o.packed, o.wasPacked]),
      [[id, true, false]]
    );
    assert.deepEqual(r.bags, [{ name: 'Testbeutel Scan', qty: 3 }]);
    assert.equal(gepackt(id).by, 'erika');
    assert.equal(db.getShelfItem(d, fach.id).held, 0, 'gepackt: nichts mehr für sie im Fach');
  });

  it('findet sie auch, wenn der Strichcode nur einen Teil der Nummer trägt', () => {
    const id = bestellung({ labels: ['0099000000002'] });
    const r = db.scanShippingLabel(d, '99000000002', null);
    assert.deepEqual(
      r.orders.map((o) => o.id),
      [id]
    );
  });

  it('findet sie über den Namen im kleinen Adress-Code, groß, klein oder mit Akzent', () => {
    const id = bestellung({ name: 'Max Müller-Muster', labels: ['99000000003'] });
    const r = db.scanShippingLabel(d, adressCode('MAX MULLER-MUSTER'), null);
    assert.equal(r.via, 'name');
    assert.deepEqual(
      r.orders.map((o) => o.id),
      [id]
    );
    assert.equal(db.scanShippingLabel(d, adressCode('Niemand Bekannt'), null).error, 'unknown');
  });

  it('packt eine Bestellung mit zwei Paketen erst, wenn beide Etiketten gescannt sind', () => {
    const id = bestellung({ name: 'Erika Zweipaket', labels: ['99000000011', '99000000012'] });
    let r = db.scanShippingLabel(d, grossCode('99000000011'), null);
    assert.deepEqual(
      r.orders.map((o) => [o.scanned, o.labels, o.packed]),
      [[1, 2, false]]
    );
    assert.equal(gepackt(id), undefined);
    assert.equal(
      db.scanShippingLabel(d, adressCode('Erika Zweipaket'), null).error,
      'severalLabels',
      'der Adress-Code ist auf beiden Paketen gleich'
    );
    r = db.scanShippingLabel(d, grossCode('99000000011'), null);
    assert.equal(r.orders[0].packed, false, 'dasselbe Etikett zweimal zählt einmal');
    r = db.scanShippingLabel(d, grossCode('99000000012'), null);
    assert.deepEqual(
      r.orders.map((o) => [o.scanned, o.packed]),
      [[2, true]]
    );
  });

  it('sagt, wenn ein Paket schon gepackt ist, und bucht nichts doppelt', () => {
    const id = bestellung({ labels: ['99000000021'] });
    db.setOrderMark(d, id, 'packed', true, 'max');
    const r = db.scanShippingLabel(d, grossCode('99000000021'), 'erika');
    assert.equal(r.orders[0].wasPacked, true);
    assert.deepEqual(r.undo.packed, []);
    assert.equal(gepackt(id).by, 'max');
  });

  it('nimmt einen Scan genau zurück', () => {
    const id = bestellung({ labels: ['99000000031'] });
    const r = db.scanShippingLabel(d, grossCode('99000000031'), null);
    db.undoShippingLabelScan(d, r.undo, null);
    assert.equal(gepackt(id), undefined);
    const again = db.scanShippingLabel(d, grossCode('99000000031'), null);
    assert.deepEqual(again.undo.scans, [{ id, label: '99000000031' }], 'auch der Scan selbst ist vergessen');
  });

  it('packt eine Bestellung desselben Käufers ohne eigenes Etikett mit', () => {
    const mit = bestellung({ labels: ['99000000041'], key: 'kaeufer-a' });
    const ohne = bestellung({ labels: [], key: 'kaeufer-a' });
    const fremd = bestellung({ labels: [], key: 'kaeufer-b' });
    const r = db.scanShippingLabel(d, grossCode('99000000041'), null);
    assert.deepEqual(r.orders.map((o) => o.id).sort(), [mit, ohne].sort());
    assert.equal(gepackt(fremd), undefined);
  });

  it('kennt keine kurzen Codes, keine stornierten und keine zwei Nummern auf einmal', () => {
    bestellung({ labels: ['99000000051'] });
    bestellung({ labels: ['99000000052'] });
    const storniert = bestellung({ labels: ['99000000053'] });
    d.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(storniert);
    assert.equal(db.scanShippingLabel(d, '1234567', null).error, 'unknown');
    assert.equal(db.scanShippingLabel(d, grossCode('99000000053'), null).error, 'unknown');
    assert.equal(db.scanShippingLabel(d, '99000000051 99000000052', null).error, 'ambiguous');
  });

  it('packt eine Bestellung desselben Käufers nicht mit, die unbezahlt ist oder noch hergestellt wird', () => {
    const mit = bestellung({ labels: ['99000000071'], key: 'kaeufer-c' });
    const herzustellen = bestellung({ key: 'kaeufer-c', items: [{ channelSku: 'SPWN-DUBL-TEST', qty: 1 }] });
    const unbezahlt = bestellung({ key: 'kaeufer-c', state: 1 });
    const r = db.scanShippingLabel(d, grossCode('99000000071'), null);
    assert.deepEqual(
      r.orders.map((o) => o.id),
      [mit]
    );
    assert.equal(gepackt(herzustellen), undefined);
    assert.equal(gepackt(unbezahlt), undefined);
  });

  it('nimmt die Paketnummer, auch wenn der Code Felder mit | trägt', () => {
    const id = bestellung({ name: 'Erika Strich', labels: ['99000000081', '99000000082'] });
    const r = db.scanShippingLabel(d, 'A|Erika Strich|Musterweg|99000000081|||', null);
    assert.equal(r.via, 'label');
    assert.deepEqual(
      r.orders.map((o) => [o.id, o.scanned, o.labels]),
      [[id, 1, 2]]
    );
  });

  it('findet eine Bestellung, deren zwei Nummern beide im Code stehen', () => {
    const id = bestellung({ labels: ['99000000091', 'TRACK0000091'] });
    const r = db.scanShippingLabel(d, 'X 99000000091 Y TRACK0000091', null);
    assert.deepEqual(
      r.orders.map((o) => [o.id, o.scanned, o.packed]),
      [[id, 2, true]]
    );
  });

  it('packt über den Adress-Code nicht zwei Pakete derselben Person', () => {
    const a = bestellung({ name: 'Max Doppelpaket', labels: ['99000000101'] });
    const b = bestellung({ name: 'Max Doppelpaket', labels: ['99000000102'] });
    assert.equal(db.scanShippingLabel(d, adressCode('Max Doppelpaket'), null).error, 'ambiguous');
    assert.equal(gepackt(a), undefined);
    assert.equal(gepackt(b), undefined);
  });

  it('meldet für einen Stammkunden, dessen alte Bestellung gepackt ist, keinen Treffer auf die alte', () => {
    const alt = bestellung({ name: 'Erika Stammkundin', labels: ['99000000111'] });
    db.setOrderMark(d, alt, 'packed', true, 'max');
    const r = db.scanShippingLabel(d, adressCode('Erika Stammkundin'), null);
    assert.equal(r.error, 'onlyPacked', 'der Server fragt dann Billbee nach der neuen Bestellung');
  });

  it('hält den Scan nicht fest: in der Datenbank steht nur die Paketnummer', () => {
    bestellung({ name: 'Erika Spurlos', labels: ['99000000061'] });
    db.scanShippingLabel(d, grossCode('99000000061'), null);
    const dump = JSON.stringify(d.prepare('SELECT * FROM order_label_scans').all());
    assert.equal(dump.includes('TESTTRCK'), false);
    assert.equal(dump.includes('99000000061'), true);
  });
});

describe('Etikett scannen – Abgleich ohne Datenbank', () => {
  it('trifft nichts, wenn keine Bestellung Paketnummern hat', () => {
    assert.equal(board.matchLabelScan(grossCode('99000000001'), [{ id: 1, raw: {}, items: [] }]).error, 'unknown');
  });
});

// Die App: ein Knopf auf der Packliste, die Kamera liest Etiketten, und der
// Handscanner geht auch ohne den Knopf. Geprüft an der Quelle, wie die anderen
// Oberflächen-Tests hier.
describe('Etikett scannen – App', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  it('hat den Knopf auf der Packliste, und der Knopf tut etwas', () => {
    assert.match(html, /data-action="ob-scan"/);
    assert.match(app, /action === 'ob-scan'\) \{\s*obScanStart\(\);/);
  });

  it('gibt im Etiketten-Modus jeden Scan an die Etikettensuche, vor allem anderen', () => {
    const body = app.slice(app.indexOf('function processScan('));
    const first = body.indexOf('scan.packLabels');
    assert.ok(first > 0 && first < body.indexOf('barcodeRegistry.get'), 'vor dem Nachschlagen eigener Etiketten');
  });

  it('gibt einen Adress-Code auch ohne den Knopf an die Etikettensuche, nie als "unbekannt"', () => {
    const body = app.slice(app.indexOf('function processScan('));
    const pipe = body.indexOf("raw.includes('|')");
    assert.ok(pipe > 0 && pipe < body.indexOf('barcodeRegistry.get'), 'vor allem, was den Text anzeigen könnte');
  });

  it('lässt nach einem Fehler weiter scannen', () => {
    const fn = app.slice(app.indexOf('function obScanCode('), app.indexOf('const _OB_SCAN_ERRORS'));
    assert.match(fn, /\.catch\(/);
  });

  it('zeigt in der Kamera beim Etiketten-Scannen nur Rückgängig und Fertig, und Rückgängig nimmt das Etikett zurück', () => {
    assert.match(app, /classList\.toggle\('cam-labels', !!scan\.packLabels\)/);
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    for (const id of ['cam-hud-chips', 'cam-hud-modes', 'btn-flip-cam', 'btn-cam-reset'])
      assert.ok(css.includes('#m-camscan.cam-labels #' + id), id);
    const undo = app.slice(app.indexOf('function camUndoLastScan('));
    assert.ok(undo.indexOf('scan.packLabels') < undo.indexOf('sessionEntries'));
  });

  it('lässt das | eines Adress-Codes durch, das ein deutscher Handscanner mit AltGr tippt', () => {
    assert.match(app, /getModifierState\('AltGraph'\)/);
  });

  it('hat jeden Text, den das Scannen zeigt, in allen drei Sprachen', () => {
    const keys = new Set(['orders.board.scanLabels', 'orders.board.scanHint']);
    for (const m of app.matchAll(/'orders\.scan\.(\w+)'/g)) keys.add('orders.scan.' + m[1]);
    for (const k of ['unknown', 'unknownAny', 'ambiguous', 'severalLabels']) keys.add('orders.scan.' + k);
    for (const lang of ['de', 'en', 'pt']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'lang', lang + '.js'), 'utf8');
      for (const k of keys) assert.ok(src.includes(`'${k}':`), `${lang}: ${k}`);
    }
  });
});
