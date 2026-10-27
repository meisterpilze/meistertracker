'use strict';
// Syringe stock → Billbee: the count per species, the SKU mapping, what the sync
// decides to send, and the exact request Billbee gets.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const channels = require('../channels.js');
const { createSyringeStockSync } = require('../syringe-stock.js');

const BILLBEE_CFG = { enabled: true, apiKey: 'test-key', clientId: 'erika@example.com', clientSecret: 'test-pw' };

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syr-'));
  const d = db.openDb(path.join(dir, 'test.db'));
  return { d, dir };
}
let seq = 0;
function syringe(d, strainId, status, extra = {}) {
  seq++;
  db.insertCultures(d, [
    {
      id: 'SY-TST-081026-' + String(seq).padStart(2, '0'),
      type: 'SY',
      strainId,
      status,
      notes: '',
      created: '2026-10-08T00:00:00Z',
      ...extra
    }
  ]);
}
const row = (d, strainId, ml = 10) => db.listSyringeStock(d).find((r) => r.strainId === strainId && r.ml === ml);

describe('Spritzenbestand: Zählung je Art', () => {
  let d, dir, a, b;
  before(() => {
    ({ d, dir } = freshDb());
    a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
    b = Number(db.createMushroomStrain(d, { name: 'Testart Beta', kuerzel: 'TB' }));
  });
  after(() => {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('zählt aktive und gelagerte Spritzen, nicht verbrauchte oder kontaminierte', () => {
    syringe(d, a, 'active');
    syringe(d, a, 'active');
    syringe(d, a, 'stored');
    syringe(d, a, 'used');
    syringe(d, a, 'contam');
    assert.equal(row(d, a).count, 3);
    assert.equal(row(d, b).count, 0);
  });

  it('zählt nur Spritzen, keine anderen Kulturen derselben Art', () => {
    db.insertCultures(d, [
      { id: 'LC-TA-081026-01', type: 'LC', strainId: a, status: 'active', notes: '', created: '2026-10-08T00:00:00Z' }
    ]);
    assert.equal(row(d, a).count, 3);
  });

  it('zählt alte Zeilen ohne strain_id über den Artnamen', () => {
    syringe(d, null, 'active', { species: 'Testart Beta' });
    assert.equal(row(d, b).count, 1);
  });

  it('SKU setzen, ändern und entfernen', () => {
    db.setSyringeSku(d, a, 10, ' SPRI-TEST-ALPHA ');
    assert.equal(row(d, a).sku, 'SPRI-TEST-ALPHA');
    db.recordSyringePush(d, a, 10, { count: 3, billbeeStock: 2 });
    assert.equal(row(d, a).pushedCount, 3);
    // Same SKU again keeps what was reported.
    db.setSyringeSku(d, a, 10, 'SPRI-TEST-ALPHA');
    assert.equal(row(d, a).pushedCount, 3);
    // A different SKU is an article that has never been told anything.
    db.setSyringeSku(d, a, 10, 'SPRI-TEST-ALPHA2');
    assert.equal(row(d, a).pushedCount, null);
    db.setSyringeSku(d, a, 10, '');
    assert.equal(row(d, a).sku, '');
  });

  it('zwei Arten dürfen sich keine SKU teilen', () => {
    db.setSyringeSku(d, a, 10, 'SPRI-TEST-SHARED');
    assert.throws(() => db.setSyringeSku(d, b, 10, 'SPRI-TEST-SHARED'), /gehört schon zu einer anderen Art/);
  });

  it('eine unbekannte Art wird abgelehnt', () => {
    assert.throws(() => db.setSyringeSku(d, 999999, 10, 'X'), /gibt es nicht/);
  });
});

describe('Spritzen in 10, 20 und 50 ml', () => {
  let d, dir, a;
  before(() => {
    ({ d, dir } = freshDb());
    a = Number(db.createMushroomStrain(d, { name: 'Testart Zeta', kuerzel: 'TZ' }));
  });
  after(() => {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('eine Spritze ohne Größe ist eine 10er, andere Arten haben keine', () => {
    syringe(d, a, 'active');
    db.insertCultures(d, [
      {
        id: 'LC-TZ-081026-01',
        type: 'LC',
        strainId: a,
        status: 'active',
        notes: '',
        created: '2026-10-08T00:00:00Z',
        ml: 50
      }
    ]);
    const all = db.getAllCultures(d);
    assert.equal(all.find((c) => c.type === 'SY').ml, 10);
    assert.equal(all.find((c) => c.id === 'LC-TZ-081026-01').ml, null);
  });

  it('zählt jede Größe für sich', () => {
    syringe(d, a, 'active', { ml: 20 });
    syringe(d, a, 'stored', { ml: 50 });
    syringe(d, a, 'active', { ml: 50 });
    assert.deepEqual(
      db
        .listSyringeStock(d)
        .filter((r) => r.strainId === a)
        .map((r) => [r.slot, r.count]),
      [
        [10, 1],
        [20, 1],
        [50, 2],
        ['pd', 0],
        // Körnerbrut je Beutelgröße, siehe koernerbrut-verkauf.test.js.
        ['kb1', 0],
        ['kb2', 0],
        ['kb5', 0]
      ]
    );
  });

  it('eine Größe, die es nicht gibt, wird abgelehnt', () => {
    assert.throws(() => syringe(d, a, 'active', { ml: 30 }), /10, 20, 50 ml/);
    assert.throws(() => db.setSyringeSku(d, a, 30, 'SPRI-TEST-30'), /10, 20, 50 ml/);
  });

  it('jede Größe hat ihre eigene SKU, und keine zwei teilen sich eine', () => {
    db.setSyringeSku(d, a, 10, 'SPRI-TEST-Z10');
    db.setSyringeSku(d, a, 50, 'SPRI-TEST-Z50');
    assert.equal(row(d, a, 10).sku, 'SPRI-TEST-Z10');
    assert.equal(row(d, a, 20).sku, '');
    assert.equal(row(d, a, 50).sku, 'SPRI-TEST-Z50');
    assert.throws(() => db.setSyringeSku(d, a, 20, 'SPRI-TEST-Z10'), /anderen Größe/);
  });

  it('die Größe einer Spritze lässt sich richtigstellen, nur auf eine, die es gibt', () => {
    const id = db.getAllCultures(d).find((c) => c.type === 'SY' && c.ml === 20).id;
    db.updateCulture(d, id, { ml: 50 });
    assert.equal(row(d, a, 20).count, 0);
    assert.equal(row(d, a, 50).count, 3);
    assert.throws(() => db.updateCulture(d, id, { ml: 15 }), /10, 20, 50 ml/);
    assert.throws(() => db.updateCulture(d, 'LC-TZ-081026-01', { ml: 10 }), /nur eine Spritze/);
  });
});

describe('Petrischalen: ein Artikel je Art, wie eine Spritzengröße', () => {
  let d, dir, a, b, sent;
  let pd = 0;
  const petri = (strainId, status) =>
    db.insertCultures(d, [
      {
        id: 'PD-TST-081026-' + String(++pd).padStart(2, '0'),
        type: 'PD',
        strainId,
        status,
        notes: '',
        created: '2026-10-08T00:00:00Z'
      }
    ]);
  const petriRow = (strainId) => db.listSyringeStock(d).find((r) => r.strainId === strainId && r.type === 'PD');
  before(() => {
    ({ d, dir } = freshDb());
    a = Number(db.createMushroomStrain(d, { name: 'Testart Eta', kuerzel: 'TH' }));
    b = Number(db.createMushroomStrain(d, { name: 'Testart Theta', kuerzel: 'TT' }));
  });
  after(() => {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('zählt aktive und gelagerte Petrischalen, nicht verkaufte, verbrauchte oder kontaminierte', () => {
    petri(a, 'active');
    petri(a, 'stored');
    petri(a, 'sold');
    petri(a, 'used');
    petri(a, 'contam');
    syringe(d, a, 'active');
    assert.equal(petriRow(a).count, 2);
    assert.equal(petriRow(a).ml, null);
    assert.equal(petriRow(a).slot, 'pd');
    assert.equal(row(d, a, 10).count, 1, 'a syringe is not a petri dish');
  });

  it('die Petrischale hat ihre eigene SKU, getrennt von den Spritzen', () => {
    db.setSyringeSku(d, a, 'pd', ' PETRI-TEST-ETA ');
    db.setSyringeSku(d, a, 10, 'SPRI-TEST-ETA10');
    assert.equal(petriRow(a).sku, 'PETRI-TEST-ETA');
    assert.equal(row(d, a, 10).sku, 'SPRI-TEST-ETA10');
    assert.throws(() => db.setSyringeSku(d, a, 20, 'PETRI-TEST-ETA'), /Petrischalen dieser Art/);
    assert.throws(() => db.setSyringeSku(d, a, 'PD', 'SPRI-TEST-ETA10'), /Spritzen dieser Art/);
    assert.throws(() => db.setSyringeSku(d, b, 'pd', 'PETRI-TEST-ETA'), /anderen Art/);
    db.setSyringeSku(d, a, 'pd', '');
    assert.equal(petriRow(a).sku, '');
    assert.equal(row(d, a, 10).sku, 'SPRI-TEST-ETA10', 'removing the petri SKU leaves the syringe alone');
  });

  it('der Abgleich meldet die Petrischale unter ihrer SKU und hält das Ergebnis an ihrer Zeile fest', async () => {
    db.updateChannelConfig(d, 'billbee', BILLBEE_CFG);
    db.setSyringeStockSyncEnabled(d, true);
    db.setSyringeSku(d, a, 'pd', 'PETRI-TEST-ETA');
    const sync = createSyringeStockSync({
      getDatabase: () => d,
      dbApi: db,
      channels: {
        getChannelProvider: () => ({
          async setStock(cfg, args) {
            sent.push(args);
            return { ok: true, currentStock: args.count };
          }
        })
      },
      log: () => {},
      skip: false
    });
    sent = [];
    await sync.runOnce();
    sync.stop();
    const p = sent.find((x) => x.sku === 'PETRI-TEST-ETA');
    assert.equal(p.count, 2);
    assert.match(p.reason, /2 Petrischalen Testart Eta/);
    assert.match(sent.find((x) => x.sku === 'SPRI-TEST-ETA10').reason, /1 Spritzen 10 ml/);
    assert.equal(petriRow(a).pushedCount, 2);
    assert.equal(row(d, a, 10).pushedCount, 1, 'each row keeps its own result');
  });
});

describe('Migration 103: vorhandene SKUs bleiben Spritzen', () => {
  it('nimmt die Zeilen aus der Tabelle ohne Kulturtyp als Spritzen mit', () => {
    const { d, dir } = freshDb();
    const a = Number(db.createMushroomStrain(d, { name: 'Testart Iota', kuerzel: 'TI' }));
    // Die Tabelle, wie Migration 102 sie hinterliess.
    d.exec('DROP TABLE syringe_stock_sku');
    d.exec(`CREATE TABLE syringe_stock_sku (
      strain_id INTEGER NOT NULL REFERENCES mushroom_strains(id) ON DELETE CASCADE,
      ml INTEGER NOT NULL DEFAULT 10, sku TEXT NOT NULL UNIQUE, pushed_count INTEGER, pushed_at TEXT,
      billbee_stock REAL, last_error TEXT, last_try TEXT, PRIMARY KEY (strain_id, ml))`);
    d.prepare('INSERT INTO syringe_stock_sku(strain_id, ml, sku, pushed_count) VALUES(?, ?, ?, ?)').run(
      a,
      50,
      'SPRI-TEST-IOTA50',
      4
    );
    // 103 rebuilds the table; 105 rebuilds it again and 106 adds a column, so a
    // database that stood before 103 runs all three, in order.
    d.prepare('DELETE FROM schema_version WHERE version IN (103, 105, 106)').run();
    const file = d.location();
    d.close();
    const d2 = db.openDb(file);
    try {
      const r = db.listSyringeStock(d2).find((x) => x.sku === 'SPRI-TEST-IOTA50');
      assert.equal(r.type, 'SY');
      assert.equal(r.ml, 50);
      assert.equal(r.pushedCount, 4, 'nothing is sent again');
    } finally {
      d2.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Spritzenbestand: was der Abgleich an Billbee schickt', () => {
  let d, dir, a, b, sent, fail;
  const logs = [];
  const fakeChannels = {
    getChannelProvider: () => ({
      async setStock(cfg, args) {
        if (fail && fail(args)) throw new Error('Billbee kennt die SKU ' + args.sku + ' nicht.');
        sent.push(args);
        return { ok: true, currentStock: args.count - 1 };
      }
    })
  };
  let sync;
  before(() => {
    ({ d, dir } = freshDb());
    a = Number(db.createMushroomStrain(d, { name: 'Testart Gamma', kuerzel: 'TG' }));
    b = Number(db.createMushroomStrain(d, { name: 'Testart Delta', kuerzel: 'TD' }));
    db.updateChannelConfig(d, 'billbee', BILLBEE_CFG);
    db.setSyringeSku(d, a, 10, 'SPRI-TEST-GAMMA');
    db.setSyringeSku(d, b, 10, 'SPRI-TEST-DELTA');
    syringe(d, a, 'active');
    syringe(d, a, 'active');
    syringe(d, b, 'stored');
    sync = createSyringeStockSync({
      getDatabase: () => d,
      dbApi: db,
      channels: fakeChannels,
      log: (...x) => logs.push(x),
      skip: false
    });
  });
  after(() => {
    sync.stop();
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('schickt nichts, solange der Abgleich aus ist', async () => {
    sent = [];
    const r = await sync.runOnce();
    assert.equal(r.skipped, 'off');
    assert.equal(sent.length, 0);
  });

  it('schickt nichts ohne verbundenes Billbee', async () => {
    db.setSyringeStockSyncEnabled(d, true);
    db.updateChannelConfig(d, 'billbee', { enabled: false });
    sent = [];
    assert.equal((await sync.runOnce()).skipped, 'billbee');
    db.updateChannelConfig(d, 'billbee', { enabled: true });
  });

  it('meldet beim ersten Lauf jede Art mit SKU, mit der Laborzahl', async () => {
    sent = [];
    const r = await sync.runOnce();
    assert.equal(r.pushed, 2);
    const bySku = Object.fromEntries(sent.map((s) => [s.sku, s.count]));
    assert.deepEqual(bySku, { 'SPRI-TEST-GAMMA': 2, 'SPRI-TEST-DELTA': 1 });
    assert.equal(row(d, a).pushedCount, 2);
    assert.equal(row(d, a).billbeeStock, 1);
  });

  it('ein automatischer Lauf zwingt nichts an die Shops', async () => {
    assert.ok(sent.every((x) => x.resend === false));
  });

  it('meldet nichts, wenn sich nichts geändert hat', async () => {
    sent = [];
    assert.equal((await sync.runOnce()).pushed, 0);
    assert.equal(sent.length, 0);
  });

  it('meldet nur die Art, deren Zahl sich bewegt hat', async () => {
    syringe(d, a, 'active');
    sent = [];
    await sync.runOnce();
    assert.deepEqual(
      sent.map((s) => [s.sku, s.count]),
      [['SPRI-TEST-GAMMA', 3]]
    );
  });

  it('hält einen Fehler fest und versucht es beim nächsten Lauf wieder', async () => {
    syringe(d, b, 'active');
    fail = (args) => args.sku === 'SPRI-TEST-DELTA';
    sent = [];
    const r = await sync.runOnce();
    assert.equal(r.errors.length, 1);
    assert.match(row(d, b).lastError, /kennt die SKU/);
    assert.equal(row(d, b).pushedCount, 1, 'the last accepted count stays');
    fail = null;
    sent = [];
    await sync.runOnce();
    assert.deepEqual(
      sent.map((s) => [s.sku, s.count]),
      [['SPRI-TEST-DELTA', 2]]
    );
    assert.equal(row(d, b).lastError, null);
  });

  it('hält es zurück, wenn alle Arten auf einmal auf null fallen', async () => {
    d.prepare("UPDATE cultures SET status = 'used' WHERE type = 'SY'").run();
    sent = [];
    const r = await sync.runOnce();
    assert.equal(r.held, true);
    assert.equal(sent.length, 0);
    assert.match(row(d, a).lastError, /auf einmal weg/);
    // "Jetzt melden" confirms it.
    const forced = await sync.runOnce({ force: true });
    assert.equal(forced.pushed, 2);
    assert.ok(
      sent.every((x) => x.resend === true),
      'the button makes Billbee resend to the shops'
    );
    assert.deepEqual(
      sent.map((s) => s.count),
      [0, 0]
    );
  });

  it('in einer Worktree-Kopie passiert nichts', async () => {
    const off = createSyringeStockSync({
      getDatabase: () => d,
      dbApi: db,
      channels: fakeChannels,
      log: () => {},
      skip: true
    });
    sent = [];
    assert.equal((await off.runOnce({ force: true })).skipped, 'worktree');
    assert.equal(sent.length, 0);
  });
});

describe('Billbee setStock: die Anfrage', () => {
  async function withFetch(handler, fn) {
    const orig = global.fetch;
    global.fetch = async (url, opts) => handler(url, opts);
    try {
      return await fn();
    } finally {
      global.fetch = orig;
    }
  }

  it('schickt die absolute Zahl und lässt Billbee offene Bestellungen abziehen', async () => {
    let seen;
    const r = await withFetch(
      (url, opts) => {
        seen = { url, method: opts.method, body: JSON.parse(opts.body) };
        return new Response(
          JSON.stringify({
            ErrorCode: 0,
            Data: { SKU: 'SPRI-TEST-1', OldStock: 1, CurrentStock: 4, UnfulfilledAmount: 1 }
          }),
          { status: 200 }
        );
      },
      () => channels.billbee.setStock(BILLBEE_CFG, { sku: 'SPRI-TEST-1', count: 5 })
    );
    assert.equal(seen.url, 'https://api.billbee.io/api/v1/products/updatestock');
    assert.equal(seen.method, 'POST');
    assert.equal(seen.body.Sku, 'SPRI-TEST-1');
    assert.equal(seen.body.NewQuantity, 5);
    assert.equal(seen.body.AutosubtractReservedAmount, true);
    assert.equal('DeltaQuantity' in seen.body, false, 'Billbee ignores it; sending it would only mislead');
    assert.equal(seen.body.ForceSendStockToShops, false, 'an ordinary change is not forced through');
    assert.equal(r.currentStock, 4);
    assert.equal(r.unfulfilled, 1);
  });

  it('sagt bei einer unbekannten SKU, was zu prüfen ist', async () => {
    await withFetch(
      () => new Response('{}', { status: 400 }),
      () =>
        assert.rejects(
          channels.billbee.setStock(BILLBEE_CFG, { sku: 'SPRI-TEST-NOPE', count: 1 }),
          /Billbee kennt die SKU SPRI-TEST-NOPE nicht/
        )
    );
  });

  it('mit resend schickt Billbee die Zahl auch unverändert an die Shops', async () => {
    let body;
    await withFetch(
      (url, opts) => {
        body = JSON.parse(opts.body);
        return new Response(JSON.stringify({ ErrorCode: 0, Data: {} }), { status: 200 });
      },
      () => channels.billbee.setStock(BILLBEE_CFG, { sku: 'SPRI-TEST-3', count: 2, resend: true })
    );
    assert.equal(body.ForceSendStockToShops, true);
  });

  it('nimmt eine Ablehnung im Umschlag ernst, auch bei HTTP 200', async () => {
    await withFetch(
      () => new Response(JSON.stringify({ ErrorCode: 3, ErrorMessage: 'Artikel nicht gefunden' }), { status: 200 }),
      () =>
        assert.rejects(
          channels.billbee.setStock(BILLBEE_CFG, { sku: 'SPRI-TEST-2', count: 1 }),
          /abgelehnt: Artikel nicht gefunden/
        )
    );
  });

  it('lehnt eine negative oder krumme Zahl ab, bevor etwas hinausgeht', async () => {
    let called = false;
    await withFetch(
      () => {
        called = true;
        return new Response('{}');
      },
      async () => {
        await assert.rejects(channels.billbee.setStock(BILLBEE_CFG, { sku: 'X', count: -1 }));
        await assert.rejects(channels.billbee.setStock(BILLBEE_CFG, { sku: 'X', count: 1.5 }));
      }
    );
    assert.equal(called, false);
  });
});

describe('Spritzenbestand: regelmäßig noch einmal an die Shops', () => {
  let d, dir, a, sent;
  const fakeChannels = {
    getChannelProvider: () => ({
      async setStock(cfg, args) {
        sent.push(args);
        return { ok: true, currentStock: args.count };
      }
    })
  };
  let sync;
  before(() => {
    ({ d, dir } = freshDb());
    a = Number(db.createMushroomStrain(d, { name: 'Testart Epsilon', kuerzel: 'TE' }));
    db.updateChannelConfig(d, 'billbee', BILLBEE_CFG);
    db.setSyringeStockSyncEnabled(d, true);
    db.setSyringeSku(d, a, 10, 'SPRI-TEST-EPSILON');
    syringe(d, a, 'active');
    sync = createSyringeStockSync({
      getDatabase: () => d,
      dbApi: db,
      channels: fakeChannels,
      log: () => {},
      skip: false
    });
  });
  after(() => {
    sync.stop();
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('schickt auch eine unveränderte Zahl und lässt Billbee sie weitergeben', async () => {
    sent = [];
    await sync.runOnce();
    assert.equal(sent.length, 1);
    sent = [];
    assert.equal((await sync.runOnce()).pushed, 0, 'nothing changed, so an ordinary run sends nothing');
    await sync.runOnce({ resend: true });
    assert.deepEqual(
      sent.map((s) => [s.sku, s.count, s.resend]),
      [['SPRI-TEST-EPSILON', 1, true]]
    );
  });

  it('hält trotzdem zurück, wenn alle Arten auf einmal auf null fallen', async () => {
    d.prepare("UPDATE cultures SET status = 'used' WHERE type = 'SY'").run();
    sent = [];
    const r = await sync.runOnce({ resend: true });
    assert.equal(r.held, true, 'a timer must never empty the shops on a reset');
    assert.equal(sent.length, 0);
  });

  it('der Takt: alle sechs Stunden, über die Viertelstunden-Schleife', () => {
    const mod = require('../syringe-stock.js');
    assert.equal(mod.RESEND_MS, 6 * 60 * 60 * 1000);
    assert.equal(mod.RESEND_MS % mod.RETRY_MS, 0);
    const src = fs.readFileSync(path.join(__dirname, '..', 'syringe-stock.js'), 'utf8');
    assert.match(src, /run\(due \? \{ resend: true \} : undefined\)/);
  });
});
