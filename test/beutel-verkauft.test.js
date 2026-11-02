'use strict';
// "Verkauft" im Beutel-Fenster: Körnerbrut und Growkits gehen auch in den
// Versand. Bis dahin blieb beim Scannen nur Entsorgt, und ein verkaufter Beutel
// stand als weggeworfen da.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const hebe = (n) => hebeFunktion(n, APP);

const G = 'G-TEST-281026-01';
const BRUT = { batchId: G, batchType: 'grain', species: 'Testart (TEST)', bags: [G + '-01', G + '-02'] };
const BLOCK = { batchId: 'TEST-281026-01', batchType: 'block', species: 'Testart (TEST)', bags: ['TEST-281026-01-01'] };
const liegt = (bag, to, action, reason) => ({ action: action || 'ADD', bag, to: to || null, reason: reason || null });

function knoepfe(batch, scanLog) {
  return new Function(
    'batch',
    'scanLog',
    `
    const out = { innerHTML: '' };
    const document = { getElementById: (id) => (id === 'bi-actions' ? out : null) };
    const batches = [batch];
    const biBatchId = batch.batchId;
    const biBagId = batch.bags[0];
    const biWholeBatch = false;
    const ZONE_BY_ID = { SPAWN: { role: 'spawn' }, INC: { role: 'incubation' }, TENT1: { role: 'fruiting' } };
    const toZone = (loc) => String(loc).split('_')[0];
    const _fruitingDest = () => 'TENT1';
    const esc = (s) => String(s);
    const t = (k) => k;
    ${hebe('_biBagCurrentLoc')}
    ${hebe('renderBiActions')}
    renderBiActions();
    return [...out.innerHTML.matchAll(/data-bi="([^"]+)"/g)].map((m) => m[1]);
  `
  )(batch, scanLog);
}

describe('Beutel-Fenster: Verkauft', () => {
  it('ein Körnerbeutel im Regal kann verkauft werden, neben Verbraucht und Entsorgt', () => {
    const k = knoepfe(BRUT, [liegt(G + '-01', 'SPAWN_R1')]);
    assert.ok(k.includes('sold'));
    assert.ok(k.includes('used') && k.includes('remove'));
  });
  it('ein Growkit in der Inkubation auch', () => {
    assert.ok(knoepfe(BLOCK, [liegt('TEST-281026-01-01', 'INC_R1')]).includes('sold'));
  });
  it('ein Beutel, der schon raus ist, bietet es nicht mehr an', () => {
    const k = knoepfe(BRUT, [liegt(G + '-01', 'SPAWN_R1'), liegt(G + '-01', null, 'REMOVE', 'sold')]);
    assert.ok(!k.includes('sold'));
  });
  it('der Knopf bucht mit dem Grund "sold" aus, zurück in die Kamera, mit Rückgängig', () => {
    assert.match(APP, /if \(a === 'sold'\) return biMarkSold\(\);/);
    const f = hebe('biMarkSold');
    assert.match(
      f,
      /biRearmScanner\(\);[\s\S]*spawnBuchen\(biWholeBatch \? b\.bags \|\| \[\] : \[biBagId\], 'sold', \{ sitzung: true \}\)/
    );
    assert.match(f, /showUndoBar\(msg, \(\) => spawnZuruecknehmen\(entries\)\)/);
  });
  it('ein verkaufter Beutel heißt verkauft, nicht entsorgt oder verbraucht', () => {
    const key = (reason) =>
      new Function(
        `${hebe('istVerbraucht')}\n${hebe('istVerkauft')}\n${hebe('biSchonRausKey')}\nreturn biSchonRausKey({ action: 'REMOVE', reason: ${JSON.stringify(reason)} });`
      )();
    assert.equal(key('sold'), 'scanFb.alreadySold');
    assert.equal(key('spawn'), 'scanFb.alreadyUsed');
    assert.equal(key(null), 'scanFb.alreadyRemoved');
  });
});

describe('Verkaufte Beutel sind keine Kontamination', () => {
  it('der Bericht zählt "sold" nicht mit', () => {
    const db = require('../db.js');
    const p = path.join(os.tmpdir(), 'mt_sold_test_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    const d = db.openDb(p);
    try {
      db.appendScanEntries(
        d,
        [
          {
            time: '2026-10-28T09:00:00.000Z',
            action: 'REMOVE',
            batch: G,
            bag: G + '-01',
            from: 'SPAWN_R1',
            reason: 'sold',
            client_uuid: 's1'
          },
          {
            time: '2026-10-28T09:00:00.000Z',
            action: 'MOVE',
            batch: 'TEST-281026-01',
            bag: 'TEST-281026-01-01',
            from: 'INC_R1',
            to: 'CONTAM',
            reason: 'contam_tricho',
            client_uuid: 's2'
          }
        ],
        null
      );
      assert.equal(db.getContaminationReport(d, 'species').totalContam, 1);
    } finally {
      d.close();
      for (const f of [p, p + '-wal', p + '-shm']) fs.rmSync(f, { force: true });
    }
  });
});
