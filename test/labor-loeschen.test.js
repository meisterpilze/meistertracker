'use strict';
// Löschen, was nicht mehr da ist.
//
// Eine Petrischale, die runtergefallen ist oder sich nicht mehr findet, stand
// im Bestand, bis jemand sie in der Kulturenliste suchte, und löschen durfte
// sie dort nur ein Admin. Jetzt klappt im Blatt einer Sorte unter jeder Zeile
// die Liste ihrer Kulturen auf; was weg ist, antippen, ein Knopf löscht, mit
// Rückgängig statt Rückfrage. Löschen darf jeder, außer eine Kultur, aus der
// schon etwas angesetzt ist: die bleibt Sache eines Admins.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();
const SERVER = quelle('server.js');

describe('Löschen: was der Server erlaubt', () => {
  it('weiß, aus welcher Kultur schon etwas angesetzt ist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-'));
    const d = db.openDb(path.join(dir, 'test.db'));
    try {
      const a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
      const k = (id, parentId) => ({
        id,
        type: 'PD',
        strainId: a,
        status: 'active',
        notes: '',
        created: '2026-10-01T08:00:00.000Z',
        ...(parentId ? { parentId } : {})
      });
      db.insertCultures(d, [k('PD-TA-011026-01'), k('PD-TA-011026-02'), k('PD-TA-011026-03', 'PD-TA-011026-01')]);
      db.insertBatch(d, {
        batchId: 'G-TA-021026-01',
        strainId: a,
        qty: 1,
        days: 14,
        substrate: {},
        bagKg: 1,
        batchType: 'grain',
        sourceId: 'PD-TA-011026-02',
        notes: '',
        created: '2026-10-02T08:00:00.000Z',
        due: '2026-10-16T08:00:00.000Z',
        bags: [{ id: 'G-TA-021026-01-01', bagKg: 1 }]
      });
      assert.equal(db.cultureHasOffspring(d, 'PD-TA-011026-01'), true, 'eine Kultur daraus');
      assert.equal(db.cultureHasOffspring(d, 'PD-TA-011026-02'), true, 'eine Charge daraus');
      assert.equal(db.cultureHasOffspring(d, 'PD-TA-011026-03'), false);
    } finally {
      d.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('jeder darf löschen; nur was schon angesetzt ist, bleibt einem Admin', () => {
    const i = SERVER.indexOf("req.method === 'DELETE' && cultureMatch");
    const route = SERVER.slice(i, i + 1200);
    assert.doesNotMatch(route, /requireAdmin/);
    assert.match(route, /if \(!isAdmin && db\.cultureHasOffspring\(database, id\)\)/);
    assert.match(
      route,
      /jsonErr\(res, 403, 'Aus ' \+ id \+ ' ist schon etwas angesetzt worden\. Löschen kann das nur ein Admin\.'\)/
    );
  });
});

// Das Blatt gegen Attrappen: Kulturen, ein Benutzer, eine Uhr, die man stellt.
function blatt({ admin = true, liste }) {
  const log = [];
  const uhr = [];
  const ctx = new Function(
    'log',
    'uhr',
    `let cultures = ${JSON.stringify(liste)};
    let batches = [{ batchId: 'G-TA-021026-01', sourceId: 'PD-TA-011026-02' }];
    const currentUser = { role: ${JSON.stringify(admin ? 'admin' : 'user')} };
    const syMl = (c) => (c && c.type === 'SY' ? c.ml || 10 : null);
    const esc = (s) => String(s);
    const t = (k, p) => (p ? k + JSON.stringify(p) : k);
    const fmtDt = (s) => String(s).slice(0, 10);
    const sp = { strainId: 1, name: 'Testart Alpha', items: [{ key: 'PD', have: 3 }] };
    const _lbSpecies = () => [sp];
    let _lbSheet = { strainId: 1, make: {}, sollOffen: null, wegOffen: 'PD', weg: new Set() };
    const renderLabLog = () => {};
    const renderLabStock = () => {};
    const renderCultures = () => log.push('kb');
    const lbSheetRender = () => log.push('render');
    const loadLabStock = () => log.push('reload');
    const toast = (m) => log.push('toast:' + m);
    const apiDelete = async (p) => { log.push('DELETE ' + p); return {}; };
    let undo = null;
    const showUndoBar = (m, cb) => { log.push('undo:' + m); undo = cb; };
    const setTimeout = (fn) => { uhr.push(fn); return uhr.length; };
    const clearTimeout = (n) => { uhr[n - 1] = null; };
    ${APP.match(/^const LB_WEG_MS = .*;$/m)[0]}
    ${_hf('_lbWegTyp', APP)}
    ${_hf('_lbKulturen', APP)}
    ${_hf('_lbDarfWeg', APP)}
    ${_hf('_lbWegListe', APP)}
    ${_hf('lbWegWaehlen', APP)}
    ${_hf('_lbHaveAendern', APP)}
    ${_hf('lbWegLoeschen', APP)}
    ${_hf('kulturenLoeschen', APP)}
    return {
      kulturen: () => _lbKulturen(sp, 'PD').map((c) => c.id),
      liste: () => _lbWegListe(sp, 'PD'),
      waehle: lbWegWaehlen,
      loesche: lbWegLoeschen,
      undo: () => undo(),
      ids: () => cultures.map((c) => c.id),
      have: () => sp.items[0].have
    };`
  )(log, uhr);
  return { ...ctx, log, uhr };
}
const pd = (id, created, o = {}) => ({ id, type: 'PD', strainId: 1, status: 'active', created, ...o });
const LISTE = [
  pd('PD-TA-021026-01', '2026-10-02'),
  pd('PD-TA-011026-02', '2026-10-01'),
  pd('PD-TA-011026-03', '2026-10-01', { status: 'contam' }),
  pd('PD-TB-011026-01', '2026-10-01', { strainId: 2 }),
  { id: 'LC-TA-011026-01', type: 'LC', strainId: 1, status: 'active', created: '2026-10-01' },
  pd('PD-TA-031026-01', '2026-10-03', { status: 'stored' })
];

describe('Löschen: im Blatt einer Sorte', () => {
  it('listet die Kulturen dieser Zeile im Bestand, älteste zuerst', () => {
    assert.deepEqual(blatt({ liste: LISTE }).kulturen(), ['PD-TA-011026-02', 'PD-TA-021026-01', 'PD-TA-031026-01']);
  });

  it('eine Kultur, aus der schon etwas angesetzt ist, löscht nur ein Admin', () => {
    const h = blatt({ admin: false, liste: LISTE }).liste();
    assert.match(
      h,
      /data-lb-wegid="PD-TA-011026-02" aria-pressed="false" disabled><span>PD-TA-011026-02<\/span><small>lb\.deleteAdminOnly/
    );
    assert.match(h, /data-lb-wegid="PD-TA-021026-01" aria-pressed="false">/);
    assert.doesNotMatch(blatt({ admin: true, liste: LISTE }).liste(), /aria-pressed="false" disabled>/);
  });

  it('löscht erst, wenn die Zeit für Rückgängig um ist', async () => {
    const b = blatt({ liste: LISTE });
    b.waehle('PD-TA-021026-01');
    b.waehle('PD-TA-031026-01');
    assert.match(b.liste(), /data-lb-act="weg">lb\.deleteN\{"n":2\}/);
    b.loesche();
    assert.ok(!b.ids().includes('PD-TA-021026-01'), 'sofort weg aus der Liste');
    assert.equal(b.have(), 1, 'der Bestand im Blatt folgt sofort');
    assert.ok(b.log.includes('undo:lb.deleted{"n":2}'));
    assert.ok(!b.log.some((l) => l.startsWith('DELETE')), 'noch nichts beim Server');
    await b.uhr[0]();
    assert.deepEqual(
      b.log.filter((l) => l.startsWith('DELETE')),
      ['DELETE /api/cultures/PD-TA-021026-01', 'DELETE /api/cultures/PD-TA-031026-01']
    );
    assert.ok(b.log.includes('reload'));
  });

  it('Rückgängig holt alles zurück, und nichts geht zum Server', () => {
    const b = blatt({ liste: LISTE });
    b.waehle('PD-TA-021026-01');
    b.loesche();
    b.undo();
    assert.ok(b.ids().includes('PD-TA-021026-01'));
    assert.equal(b.have(), 3);
    assert.equal(b.uhr[0], null, 'der Zeitgeber ist abgestellt');
  });

  it('der Knopf steht unter Zeilen mit Bestand, Slants, Flüssigkultur, Petri und Spritzen, nicht unter Körnerbrut', () => {
    const z = _hf('_lbSheetZeile', APP);
    assert.match(z, /sp && i\.have > 0 && _lbWegTyp\(i\.key\)/);
    const typ = new Function(_hf('_lbWegTyp', APP) + '; return _lbWegTyp;')();
    assert.deepEqual(
      ['MC', 'LC', 'PD', 'SY20', 'GSKG', 'kb2'].map((k) => !!typ(k)),
      [true, true, true, true, false, false]
    );
  });
});
