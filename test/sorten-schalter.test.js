'use strict';
// Was wir gerade anbauen: ein Knopf je Sorte, an oder aus (im_programm). Aus
// heißt, die App verlangt nichts mehr für die Sorte: kein Soll, kein
// Körnerbrut-Plan, kein Minimum im Fruchtzelt, keine Frage "Noch da?" und kein
// automatisches Ausbuchen.
//
// Alle Zahlen und Namen hier sind erfunden.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle();
const HTML = quelle('index.html');
const DAY = 86400000;
const NOW = new Date('2026-03-01T10:00:00.000Z');
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_schalter_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}
function aufraeumen(p) {
  for (const f of [p, p + '-wal', p + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
}
function charge(d, strainId, id, n, tage) {
  const bags = Array.from({ length: n }, (_, i) => ({ id: id + '-' + String(i + 1).padStart(2, '0'), bagKg: 3 }));
  db.insertBatch(
    d,
    {
      batchId: id,
      strainId,
      qty: n,
      days: 10,
      substrate: {},
      bagKg: 3,
      batchType: 'block',
      notes: '',
      created: ago(tage),
      due: ago(tage - 10),
      bags
    },
    null,
    null
  );
  return bags.map((b) => b.id);
}
function stelle(d, bags, batch, to, tage) {
  db.appendScanEntries(
    d,
    bags.map((bag) => ({ time: ago(tage), action: 'ADD', batch, bag, from: null, to })),
    null
  );
}

describe('Sorte aus: keine Fristen, kein Ausbuchen (Server)', () => {
  let d, p, sid;
  beforeEach(() => {
    ({ db: d, path: p } = tmpDb());
    sid = Number(db.createMushroomStrain(d, { name: 'Testpilz', kuerzel: 'TP', tentMaxDays: 20, incMaxDays: 30 }));
    // Die Grenzen stehen schon lange: die Woche Schonfrist ist vorbei.
    d.prepare('UPDATE mushroom_strains SET limits_set = ? WHERE id = ?').run(ago(100), sid);
  });
  afterEach(() => {
    d.close();
    aufraeumen(p);
  });

  it('eine Sorte, die aus ist, hat keine Fristen und wird nicht ausgebucht', () => {
    const zelt = charge(d, sid, 'TP-01', 2, 60);
    stelle(d, zelt, 'TP-01', 'TENT1', 25);
    const inc = charge(d, sid, 'TP-02', 1, 40);
    stelle(d, inc, 'TP-02', 'INC', 40);
    assert.equal(db.brettFristen(d).length, 3, 'an: zwei im Zelt, einer in der Inkubation');
    db.updateMushroomStrain(d, sid, { imProgramm: false });
    assert.equal(db.brettFristen(d).length, 0);
    assert.equal(db.autoBookOuts(d, NOW).length, 0);
    db.updateMushroomStrain(d, sid, { imProgramm: true });
    assert.equal(
      db.autoBookOuts(d, NOW).length,
      3,
      'wieder an: die Fristen gelten wieder, im Zelt und in der Inkubation'
    );
  });

  it('der Laborbestand: aus heißt kein Soll für Körnerbrut, auch mit Plan', () => {
    db.updateMushroomStrain(d, sid, { weekBlocks: 10, recSpawnPct: 10, recBagKg: 3, recBatchType: 'block' });
    const kb = () =>
      db
        .labStock(d, NOW)
        .find((s) => s.strainId === sid)
        .items.find((i) => i.key === 'GSKG');
    assert.ok(kb().make > 0, 'an: der Plan verlangt Körnerbrut');
    db.updateMushroomStrain(d, sid, { imProgramm: false });
    assert.equal(kb().make, 0);
  });
});

describe('Sorte aus: keine Fristen und keine Grenzen im Browser', () => {
  const brettFristVon = new Function(hebeFunktion('brettFristVon', SRC) + '; return brettFristVon;')();
  const RULES = { confirmDays: 14, graceDays: 7 };
  const frist = (s) =>
    brettFristVon({
      s,
      rules: RULES,
      confirmed: null,
      limitsSet: ago(100),
      role: 'fruiting',
      batchType: 'block',
      made: ago(60),
      since: ago(25)
    });

  it('dieselbe Regel wie der Server: aus heißt keine Frist', () => {
    assert.ok(frist({ tentMaxDays: 20 }), 'an');
    assert.equal(frist({ tentMaxDays: 20, imProgramm: false }), null);
  });

  it('die Fruchtzelt-Karte zeigt bei einer Sorte, die aus ist, nur die Zahl', () => {
    const karte = new Function(
      't',
      'esc',
      'spDot',
      'zoneDisplayName',
      hebeFunktion('_zeltGrenzenText', SRC) + hebeFunktion('zeltKarteHtml', SRC) + '; return zeltKarteHtml;'
    )(
      (k, p) => k + (p ? JSON.stringify(p) : ''),
      (s) => String(s),
      () => '',
      (id) => id
    );
    const z = { id: 'TENT1' };
    const an = karte(z, { name: 'Testpilz', tentMin: 10, tentMax: 20 }, 1, 4);
    assert.match(an, /zelt-unter/);
    assert.match(an, /zelt-bar/);
    const aus = karte(z, { name: 'Testpilz', tentMin: 10, tentMax: 20, imProgramm: false }, 1, 4);
    assert.doesNotMatch(aus, /zelt-unter|zelt-bar|zelt\.limits|zelt\.state/);
    assert.match(aus, /<b>4<\/b>/);
  });

  it('als Nächstes ins Fruchtzelt: eine Sorte, die aus ist, hat weder Minimum noch Maximum', () => {
    assert.match(
      SRC,
      /grenzen\[s\.id\] = s\.imProgramm === false \? \{ min: 0, max: 0 \} : \{ min: s\.tentMin \|\| 0, max: s\.tentMax \|\| 0 \};/
    );
    assert.match(hebeFunktion('_brettZeltInfo', SRC), /art\.imProgramm !== false && art\.tentMax > 0/);
  });

  it('der Körnerbrut-Plan lässt eine Sorte, die aus ist, weg', () => {
    const zeilen = new Function(hebeFunktion('_kbpZeilen', SRC) + '; return _kbpZeilen;')();
    const art = (strainId, imProgramm) => ({
      strainId,
      name: 'Art ' + strainId,
      imProgramm,
      items: [{ key: 'GSKG', make: 1, plan: { needKgWeek: 2, oldKg: 1 } }]
    });
    assert.deepEqual(
      zeilen([art(1, true), art(2, false)]).map((x) => x.sp.strainId),
      [1]
    );
  });
});

describe('Was wir gerade anbauen: die Knöpfe', () => {
  it('stehen oben auf der Pilzsorten-Seite', () => {
    const seite = HTML.slice(HTML.indexOf('id="p-strains"'));
    assert.ok(seite.indexOf('id="ms-schalter"') > 0);
    assert.ok(seite.indexOf('id="ms-schalter"') < seite.indexOf('id="ms-name"'), 'vor dem Formular');
    assert.match(hebeFunktion('renderStrains', SRC), /^function renderStrains\(\) \{\s*renderSortenSchalter\(\);/);
  });

  it('ein Knopf je Sorte, alphabetisch, an oder aus, mit der Zahl darunter', () => {
    const els = {};
    const document = { getElementById: (id) => (els[id] = els[id] || { innerHTML: '', textContent: '' }) };
    const mushroomStrains = [
      { id: 2, name: 'Zettpilz', imProgramm: false },
      { id: 1, name: 'Apfelpilz', imProgramm: true },
      { id: 3, name: 'Mittelpilz' }
    ];
    new Function(
      'document',
      'mushroomStrains',
      't',
      'esc',
      hebeFunktion('renderSortenSchalter', SRC) + '; renderSortenSchalter();'
    )(
      document,
      mushroomStrains,
      (k, p) => k + JSON.stringify(p || {}),
      (s) => String(s)
    );
    const html = els['ms-schalter'].innerHTML;
    const reihe = [...html.matchAll(/data-ms-schalter="(\d+)" aria-pressed="(true|false)">([^<]+)</g)].map((m) => [
      m[1],
      m[2],
      m[3]
    ]);
    assert.deepEqual(reihe, [
      ['1', 'true', 'Apfelpilz'],
      ['3', 'true', 'Mittelpilz'],
      ['2', 'false', 'Zettpilz']
    ]);
    assert.equal(els['ms-schalter-n'].textContent, 'strains.switchCount{"n":2,"total":3}');
  });

  it('ein Tipp gilt sofort, gespeichert wird danach; schlägt das fehl, steht der alte Stand wieder da', async () => {
    const lauf = async (antwort) => {
      const log = [];
      const ms = { id: 5, name: 'Testpilz', imProgramm: true };
      const sorteProgramm = new Function(
        'mushroomStrains',
        'renderStrains',
        'renderBatches',
        'renderDashBatchTasks',
        'apiPatch',
        'setFb',
        't',
        'loadLabStock',
        hebeFunktion('sorteProgramm', SRC) + '; return sorteProgramm;'
      )(
        [ms],
        () => log.push('zeichnen:' + ms.imProgramm),
        () => {},
        () => {},
        (url, body) => {
          log.push('patch:' + url + ':' + body.imProgramm);
          return antwort();
        },
        (kind) => log.push('fehler:' + kind),
        (k) => k,
        () => log.push('labor')
      );
      sorteProgramm(5, false);
      await new Promise((r) => setTimeout(r, 0));
      return { log, an: ms.imProgramm };
    };
    let r = await lauf(() => Promise.resolve({ ok: true }));
    assert.deepEqual(r.log, ['zeichnen:false', 'patch:/api/mushroom-strains/5:false', 'labor']);
    assert.equal(r.an, false);
    r = await lauf(() => Promise.resolve({ error: 'kaputt' }));
    assert.equal(r.an, true);
    assert.deepEqual(r.log.slice(-2), ['fehler:err', 'zeichnen:true']);
    r = await lauf(() => Promise.reject(new Error('offline')));
    assert.equal(r.an, true);
  });

  it('die Knöpfe und die Tabelle schalten über dieselbe Funktion', () => {
    assert.match(SRC, /sorteProgramm\(parseInt\(box\.dataset\.id, 10\), box\.checked\)/);
    assert.match(SRC, /\$\('ms-schalter'\)\.addEventListener\('click'/);
  });
});

describe('Fruchtzelt statt Zelt', () => {
  const sprache = (l) => {
    const w = {};
    new Function('window', quelle('lang/' + l + '.js'))(w);
    return w.LANG[l];
  };
  it('heißt in allen drei Sprachen so', () => {
    const wort = { de: 'Fruchtzelt', en: 'fruiting tent', pt: 'tenda de frutificação' };
    for (const l of ['de', 'en', 'pt']) {
      const L = sprache(l);
      for (const k of ['bretter.title', 'bretter.next', 'bretter.tents', 'strains.tentMaxDays', 'strains.tentMin'])
        assert.ok(L[k].toLowerCase().includes(wort[l].toLowerCase()), l + ' ' + k + ': ' + L[k]);
    }
  });
});
