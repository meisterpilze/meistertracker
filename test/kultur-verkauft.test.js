'use strict';
// "Verkauft": eine Spritze oder Petrischale, die in den Versand geht, verlässt
// den Bestand mit einem eigenen Status — getrennt von "verbraucht", und so, dass
// die Zahl stimmt, die Billbee den Shops meldet (syringe-stock.js).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');
const db = require('../db');

const APP = quelle();
const hebe = (n) => _hf(n, APP);
const VERKAUFBAR = APP.match(/const CI_VERKAUFBAR = \[[^\]]*\];/)[0];

// renderCiActions schreibt in #bi-actions; hier ein Platzhalter dafür.
function knoepfe(c) {
  const el = { innerHTML: '' };
  new Function(
    'document',
    'bmpArten',
    't',
    'esc',
    '_lbDarfWeg',
    `${VERKAUFBAR}\n${hebe('renderCiActions')}\nrenderCiActions(${JSON.stringify(c)});`
  )(
    { getElementById: () => el },
    () => ['KB'],
    (k) => k,
    (s) => String(s),
    () => true
  );
  return [...el.innerHTML.matchAll(/data-bi="([^"]+)"/g)].map((m) => m[1]);
}

describe('Kultur-Fenster: Verkauft', () => {
  it('eine aktive Spritze kann verkauft werden, und das steht zuoberst', () => {
    const k = knoepfe({ id: 'SY-TST-081026-01', type: 'SY', status: 'active' });
    assert.equal(k[0], 'ci-sold');
    assert.ok(k.includes('ci-out'), 'Raus (verbraucht) bleibt daneben');
  });
  it('eine gelagerte Petrischale auch', () => {
    assert.ok(knoepfe({ id: 'PD-TST-081026-01', type: 'PD', status: 'stored' }).includes('ci-sold'));
  });
  it('eine Flüssigkultur im Glas auch, aber unter "Raus" — sie geht seltener in den Versand', () => {
    const k = knoepfe({ id: 'LC-TST-081026-01', type: 'LC', status: 'active' });
    assert.ok(k.includes('ci-sold'));
    assert.ok(k.indexOf('ci-out') < k.indexOf('ci-sold'));
  });
  it('eine schon verkaufte Spritze bietet nichts mehr zum Rausnehmen', () => {
    const k = knoepfe({ id: 'SY-TST-081026-02', type: 'SY', status: 'sold' });
    assert.ok(!k.includes('ci-sold') && !k.includes('ci-out'));
  });
  it('der Knopf setzt "sold", mit Rückgängig wie "Raus"', () => {
    assert.match(hebe('ciAction'), /a === 'ci-sold'\) return ciSetStatus\('sold', 'ci\.soldDone'\)/);
  });
});

describe('Verkauft zählt als weg', () => {
  const gone = (status) =>
    new Function(`${hebe('cultureGone')}\nreturn cultureGone({ status: ${JSON.stringify(status)} });`)();
  it('verkauft, verbraucht und kontaminiert sind weg; aktiv und gelagert nicht', () => {
    assert.equal(gone('sold'), true);
    assert.equal(gone('used'), true);
    assert.equal(gone('contam'), true);
    assert.equal(gone('active'), false);
    assert.equal(gone('stored'), false);
  });
  it('eine verkaufte Spritze nochmal scannen sagt, dass sie verkauft ist', () => {
    const msg = new Function('t', `${hebe('cultureRefusal')}\nreturn cultureRefusal({ id: 'SY-1', status: 'sold' });`)(
      (k) => k
    );
    assert.equal(msg, 'scanFb.cultureSold');
  });
  it('der Server nimmt den Status an, und die Kulturbibliothek zeigt ihn bei den erledigten', () => {
    assert.match(quelle('server.js'), /const CULTURE_STATUSES = \[[^\]]*'sold'/);
    assert.match(APP, /^const KB_STATUS = \{[^}]*sold: 'lab\.sold'/m);
  });
});

describe('Verkauft und der Spritzenbestand an Billbee', () => {
  it('eine verkaufte Spritze zählt nicht mehr mit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sold-'));
    const d = db.openDb(path.join(dir, 'test.db'));
    try {
      const art = Number(db.createMushroomStrain(d, { name: 'Testart Verkauf', kuerzel: 'TV' }));
      const sy = (n, status) => ({
        id: 'SY-TV-081026-0' + n,
        type: 'SY',
        strainId: art,
        status,
        notes: '',
        created: '2026-10-08T00:00:00Z'
      });
      db.insertCultures(d, [sy(1, 'active'), sy(2, 'active'), sy(3, 'stored')]);
      const zahl = () => db.listSyringeStock(d).find((r) => r.strainId === art).count;
      assert.equal(zahl(), 3);
      db.updateCulture(d, 'SY-TV-081026-01', { status: 'sold' });
      assert.equal(zahl(), 2);
    } finally {
      d.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
