'use strict';
// Eine Liste für Kulturbibliothek, Körnerbrut und Chargen.
//
// Alle drei waren Tabellen: am Telefon Karten untereinander, mit Filtern und
// einer Suche davor. Jetzt sind sie eine Sortenliste: eine Zeile je Sorte mit
// ihren Zahlen, ein Tipp klappt sie an Ort und Stelle auf, ein Tipp auf einen
// Eintrag öffnet sein Fenster, oben der Scan-Knopf, hinten das Archiv. Was die
// Liste ist, steht einmal in app.js (slRender und Freunde); jede Seite sagt nur,
// was ihre Einträge sind. Dieser Test lässt den echten Code laufen, mit allen
// drei Beschreibungen, und prüft, dass sie sich gleich bedienen.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const TAG = 864e5;
const JETZT = Date.parse('2026-10-28T12:00:00Z');
const vor = (tage) => new Date(JETZT - tage * TAG).toISOString();
const in_ = (tage) => new Date(JETZT + tage * TAG).toISOString();

// Der Block von der Sortenliste bis zum Ende der Körnerbrut, wie er in app.js steht.
const BLOCK = (() => {
  const a = APP.indexOf('// ── Sortenliste ──');
  const b = APP.indexOf('// Die Beutel einer Charge als Knöpfe');
  assert.ok(a > 0 && b > a, 'Sortenliste-Block nicht gefunden');
  return APP.slice(a, b);
})();

function welt({ cultures = [], batches = [], status = {}, beutel = {}, kg = {}, nachschub = [], filter = null } = {}) {
  const els = {};
  const el = (id) =>
    (els[id] = els[id] || {
      id,
      innerHTML: '',
      textContent: '',
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v;
      }
    });
  const geoeffnet = [];
  const api = new Function(
    'document',
    'geoeffnet',
    'JETZT',
    'STATUS',
    'BEUTEL',
    'KG',
    'NACHSCHUB',
    'FILTER',
    `const Date = class extends globalThis.Date {
       constructor(...a) { super(...(a.length ? a : [JETZT])); }
       static now() { return JETZT; }
     };
     let cultures = ${JSON.stringify(cultures)};
     let batches = ${JSON.stringify(batches)};
     const mushroomStrains = [{ id: 1, name: 'Testart Alpha' }, { id: 2, name: 'Testart Beta' }];
     const esc = (s) => String(s);
     const t = (k, p) => (p ? k + JSON.stringify(p) : k);
     const loc = () => 'de';
     const spDot = () => '';
     const syMl = (c) => (c && c.type === 'SY' ? c.ml || 10 : null);
     const fmtDtShort = (d) => String(d).slice(8, 10) + '.' + String(d).slice(5, 7) + '.';
     const fmtKg = (n, d) => n.toFixed(d).replace('.', ',');
     const getStatus = (id) => ({ status: STATUS[id] || 'INCUBATING' });
     const _stageBagsOf = (b) => ({ spawn: 0, incubation: 0, fruiting: 0, ...(BEUTEL[b.batchId] || {}) });
     const _grainKgOf = (b) => KG[b.batchId] || 0;
     const sorteRollup = () => NACHSCHUB;
     const isArchivedStatus = (s) => ['DONE', 'EMPTY', 'CONTAM'].includes(s);
     let batchAttentionFilter = FILTER;
     const renderBatchAttentionBanner = () => {};
     const openCultureSheet = (c) => geoeffnet.push('kultur:' + c.id);
     const openChargeSheet = (b) => geoeffnet.push('charge:' + b.batchId);
     const scan = {};
     const updateSD = () => {};
     const openCamScan = () => geoeffnet.push('kamera');
     ${_hf('_spKey', APP)}
     ${_hf('sorteKey', APP)}
     ${_hf('sorteName', APP)}
     ${BLOCK}
     const liste = { kb: SL_KULTUREN, ch: SL_CHARGEN, gr: SL_KOERNER };
     const klick = (id, attr, wert) =>
       slKlick(liste[id], {
         target: {
           closest: (sel) =>
             sel === '[data-' + attr + ']'
               ? { dataset: { [attr.replace(/-(.)/g, (_, x) => x.toUpperCase())]: wert } }
               : null
         }
       });
     return { liste, slRender, slArchiv, slZeige, slScan, klick, kbZeige, renderBatches, renderGrainBatches, renderCultures };`
  )({ getElementById: el, querySelector: () => null }, geoeffnet, JETZT, status, beutel, kg, nachschub, filter);
  return {
    ...api,
    els,
    geoeffnet,
    html: (id) => els[id + '-list'].innerHTML,
    zeichne: (id) => api.slRender(api.liste[id])
  };
}
const k = (id, type, strainId, created, o = {}) => ({ id, type, strainId, status: 'active', created, ...o });
const ch = (batchId, strainId, created, due, o = {}) => ({ batchId, strainId, created, due, qty: 10, bags: [], ...o });
const zeilen = (h) => (h.match(/data-sl-id=/g) || []).length;

describe('Sortenliste: Kulturbibliothek', () => {
  const KULTUREN = [
    k('PD-TB-011026-01', 'PD', 2, vor(27)),
    k('PD-TA-090926-01', 'PD', 1, vor(49)),
    k('PD-TA-090926-02', 'PD', 1, vor(49)),
    k('LC-TA-170926-01', 'LC', 1, vor(41), { status: 'stored' }),
    k('SY-TA-211026-01', 'SY', 1, vor(7), { ml: 20 }),
    k('PD-TA-011026-03', 'PD', 1, vor(27), { status: 'contam' }),
    k('SY-TA-011026-02', 'SY', 1, vor(27), { status: 'sold' })
  ];

  it('zeigt je Sorte eine Zeile mit dem, was da ist, nach Namen', () => {
    const w = welt({ cultures: KULTUREN });
    w.renderCultures();
    const h = w.html('kb');
    assert.ok(h.indexOf('Testart Alpha') < h.indexOf('Testart Beta'));
    assert.match(
      h,
      /data-sl-sorte="id:1"[^>]*>.*lb\.short\.LC <b>1<\/b>.*lb\.short\.PD <b>2<\/b>.*lb\.short\.SYall <b>1<\/b>/
    );
    assert.equal(zeilen(h), 0, 'zugeklappt: keine einzelne Kultur');
    assert.equal(w.els['kb-count'].textContent, 'kb.count{"n":5}');
    assert.equal(w.els['kb-archiv'].textContent, 'sl.archive{"n":2}');
  });

  it('ein Tipp klappt auf: nach Art, älteste zuerst, mit Alter; ein zweiter klappt zu', () => {
    const w = welt({ cultures: KULTUREN });
    w.renderCultures();
    w.klick('kb', 'sl-sorte', 'id:1');
    const h = w.html('kb');
    assert.ok(h.indexOf('lab.liquidCultures') < h.indexOf('lab.petriDishes'));
    assert.match(h, /data-sl-id="LC-TA-170926-01"[^>]*>.*lab\.stored · sl\.weeks\{"n":5\}/);
    assert.match(h, /data-sl-id="SY-TA-211026-01"[^>]*>.*20 ml · sl\.days\{"n":7\}/);
    assert.ok(h.indexOf('PD-TA-090926-01') < h.indexOf('PD-TA-090926-02'));
    assert.doesNotMatch(h, /PD-TB-011026-01/, 'nur die aufgeklappte Sorte');
    w.klick('kb', 'sl-sorte', 'id:1');
    assert.equal(zeilen(w.html('kb')), 0);
  });

  it('eine Kultur antippen öffnet ihr Fenster, wie ein Scan', () => {
    const w = welt({ cultures: KULTUREN });
    w.klick('kb', 'sl-id', 'PD-TA-090926-01');
    assert.deepEqual(w.geoeffnet, ['kultur:PD-TA-090926-01']);
  });

  it('zeigt sechs je Gruppe und den Rest auf einen Tipp; sieben stehen ganz da', () => {
    const viele = Array.from({ length: 9 }, (_, i) => k('PD-TA-0' + (i + 1) + '1026-01', 'PD', 1, vor(30 - i)));
    const w = welt({ cultures: viele });
    w.klick('kb', 'sl-sorte', 'id:1');
    assert.equal(zeilen(w.html('kb')), 6);
    assert.match(w.html('kb'), /data-sl-mehr="id:1\|PD">sl\.more\{"n":3\}/);
    w.klick('kb', 'sl-mehr', 'id:1|PD');
    assert.equal(zeilen(w.html('kb')), 9);
    const sieben = welt({ cultures: viele.slice(0, 7) });
    sieben.klick('kb', 'sl-sorte', 'id:1');
    assert.equal(zeilen(sieben.html('kb')), 7);
  });

  it('das Archiv zeigt verbraucht, verkauft, kontaminiert, die jüngste zuerst', () => {
    const w = welt({ cultures: KULTUREN });
    w.slArchiv(w.liste.kb);
    w.klick('kb', 'sl-sorte', 'id:1');
    const h = w.html('kb');
    assert.match(h, /data-sl-id="PD-TA-011026-03"[^>]*>.*lab\.contaminated/);
    assert.match(h, /data-sl-id="SY-TA-011026-02"[^>]*>.*10 ml · lab\.sold/);
    assert.doesNotMatch(h, /PD-TA-090926-01/);
    assert.equal(w.els['kb-archiv'].textContent, 'sl.archiveBack');
    assert.equal(w.els['kb-archiv'].attrs['aria-pressed'], 'true');
    assert.equal(w.els['kb-count'].textContent, 'sl.inArchive{"n":2}');
  });

  it('die Suche landet auf der Kultur, auch im Archiv', () => {
    const w = welt({ cultures: KULTUREN });
    w.kbZeige('PD-TA-011026-03');
    assert.match(w.html('kb'), /data-find="culture:PD-TA-011026-03"/);
  });
});

describe('Sortenliste: Chargen', () => {
  const CHARGEN = [
    ch('TA-221026-01', 1, vor(6), in_(8)),
    ch('TA-141026-01', 1, vor(14), vor(0)),
    ch('TA-101026-01', 1, vor(18), vor(4)),
    ch('TA-051026-01', 1, vor(23), vor(9)),
    ch('TB-011026-01', 2, vor(27), vor(13)),
    ch('TA-010926-01', 1, vor(57), vor(43)),
    ch('G-TA-011026-01', 1, vor(27), vor(13), { batchType: 'grain' })
  ];
  const STATUS = { 'TA-051026-01': 'FRUITING', 'TA-010926-01': 'DONE' };
  const BEUTEL = {
    'TA-221026-01': { incubation: 6 },
    'TA-141026-01': { incubation: 12 },
    'TA-101026-01': { incubation: 4 },
    'TA-051026-01': { fruiting: 15 },
    'TB-011026-01': { incubation: 20 }
  };

  it('je Sorte die Beutel nach Phase, ohne Körnerbrut, mit dem Nachschub unter dem Namen', () => {
    const w = welt({
      batches: CHARGEN,
      status: STATUS,
      beutel: BEUTEL,
      nachschub: [{ key: 'id:2', supply: 'now' }]
    });
    w.renderBatches();
    const h = w.html('ch');
    assert.match(h, /data-sl-sorte="id:1"[^>]*>.*sl\.ch\.inc <b>22<\/b>.*sl\.ch\.fruit <b>15<\/b>/);
    assert.match(h, /data-sl-sorte="id:2"[^>]*>.*<small class="sup sup-now">batch\.supply\.now<\/small>/);
    assert.doesNotMatch(h, /G-TA-011026-01/);
    assert.equal(w.els['ch-count'].textContent, 'ch.count{"n":5}');
    assert.equal(w.els['ch-archiv'].textContent, 'sl.archive{"n":1}');
  });

  it('aufgeklappt: Inkubation vor Fruchtung, die fälligste zuerst, mit Beuteln und Fälligkeit', () => {
    const w = welt({ batches: CHARGEN, status: STATUS, beutel: BEUTEL });
    w.klick('ch', 'sl-sorte', 'id:1');
    const h = w.html('ch');
    assert.ok(h.indexOf('stage.incubation') < h.indexOf('stage.fruiting'));
    assert.ok(h.indexOf('TA-101026-01') < h.indexOf('TA-141026-01'), 'überfällig vor heute');
    assert.ok(h.indexOf('TA-141026-01') < h.indexOf('TA-221026-01'), 'heute vor später');
    assert.match(h, /data-sl-id="TA-101026-01"[^>]*>.*sl\.bags\{"n":4\} · sl\.overdue\{"n":4\}/);
    assert.match(h, /data-sl-id="TA-141026-01"[^>]*>.*sl\.bags\{"n":12\} · sl\.dueToday/);
    assert.match(h, /data-sl-id="TA-221026-01"[^>]*>.*sl\.due\{"date":"05\.11\."\}/);
    assert.match(h, /data-sl-id="TA-051026-01"[^>]*>.*sl\.bags\{"n":15\} · sl\.weeks\{"n":3\}/, 'im Zelt: das Alter');
    assert.doesNotMatch(h, /TA-010926-01/, 'fertig liegt im Archiv');
  });

  it('eine Charge antippen öffnet ihr Fenster', () => {
    const w = welt({ batches: CHARGEN, status: STATUS, beutel: BEUTEL });
    w.klick('ch', 'sl-id', 'TA-141026-01');
    assert.deepEqual(w.geoeffnet, ['charge:TA-141026-01']);
  });

  it('der Filter vom Dashboard zeigt nur, was er meint, und alles davon offen', () => {
    const w = welt({
      batches: CHARGEN,
      status: STATUS,
      beutel: BEUTEL,
      filter: { pred: (b) => b.batchId === 'TA-101026-01', label: 'x' }
    });
    w.renderBatches();
    assert.equal(zeilen(w.html('ch')), 1);
    assert.match(w.html('ch'), /data-sl-id="TA-101026-01"/);
    const leer = welt({ batches: CHARGEN, status: STATUS, filter: { pred: () => false, label: 'x' } });
    leer.renderBatches();
    assert.match(leer.html('ch'), /dash\.noMatches/);
  });

  it('das Archiv zeigt, was fertig ist', () => {
    const w = welt({ batches: CHARGEN, status: STATUS, beutel: BEUTEL });
    w.slArchiv(w.liste.ch);
    w.klick('ch', 'sl-sorte', 'id:1');
    assert.match(w.html('ch'), /sl\.st\.done.*data-sl-id="TA-010926-01"[^>]*>.*sl\.bags\{"n":10\}/);
  });
});

describe('Sortenliste: Körnerbrut', () => {
  const KOERNER = [
    ch('G-TA-011026-01', 1, vor(27), vor(13), { batchType: 'grain' }),
    ch('G-TA-281026-01', 1, vor(0), in_(14), { batchType: 'grain' }),
    ch('TA-221026-01', 1, vor(6), in_(8))
  ];

  it('fertig und wächst je Sorte in kg, ohne Blöcke', () => {
    const w = welt({ batches: KOERNER, kg: { 'G-TA-011026-01': 6, 'G-TA-281026-01': 3 } });
    w.renderGrainBatches();
    const h = w.html('gr');
    assert.match(h, /sl\.gr\.readyShort <b>6 kg<\/b>.*sl\.gr\.growingShort <b>3 kg<\/b>/);
    assert.equal(w.els['gr-count'].textContent, 'gr.count{"kg":"6 kg"}');
    w.klick('gr', 'sl-sorte', 'id:1');
    const offen = w.html('gr');
    assert.ok(offen.indexOf('sl.gr.ready') < offen.indexOf('sl.gr.growing'));
    assert.match(offen, /data-sl-id="G-TA-281026-01"[^>]*>.*3 kg · sl\.gr\.readyOn\{"date":"11\.11\."\}/);
    assert.doesNotMatch(offen, /TA-221026-01"/);
  });
});

describe('Sortenliste: ein System, nicht drei', () => {
  it('alle drei zeichnen dieselben Bausteine', () => {
    const w = welt({
      cultures: [k('PD-TA-011026-01', 'PD', 1, vor(3))],
      batches: [ch('TA-011026-01', 1, vor(3), in_(3)), ch('G-TA-011026-01', 1, vor(3), in_(3), { batchType: 'grain' })],
      beutel: { 'TA-011026-01': { incubation: 2 } },
      kg: { 'G-TA-011026-01': 2 }
    });
    for (const id of ['kb', 'ch', 'gr']) {
      w.zeichne(id);
      w.klick(id, 'sl-sorte', 'id:1');
      const h = w.html(id);
      for (const teil of [
        'sl-sorte open',
        'sl-kopf',
        'sl-name',
        'sl-chips',
        'sl-chip',
        'sl-teil',
        'sl-teil-t',
        'sl-eintrag',
        'sl-id',
        'sl-r'
      ])
        assert.match(h, new RegExp('class="' + teil + '"'), id + ': ' + teil);
    }
  });

  it('auf jeder der drei Seiten dieselbe Karte: Scan oben, Archiv daneben, dann die Liste, keine Tabelle', () => {
    for (const [sp, id] of [
      ['sp-lab-cultures', 'kb'],
      ['sp-lab-grain', 'gr'],
      ['sp-batch-list', 'ch']
    ]) {
      const a = HTML.indexOf('id="' + sp + '"');
      const block = HTML.slice(a, HTML.indexOf('<div class="sp', a + 10));
      assert.ok(block.indexOf('id="' + id + '-scan"') > 0, sp + ': kein Scan-Knopf');
      assert.ok(block.indexOf('id="' + id + '-scan"') < block.indexOf('id="' + id + '-list"'), sp);
      assert.ok(block.indexOf('id="' + id + '-archiv"') > 0, sp + ': kein Archiv');
      assert.doesNotMatch(block, /<table|type="search"/, sp + ': Tabelle oder Suche übrig');
    }
  });

  it('der Scan-Knopf öffnet die Kamera ohne eine Aktion davor', () => {
    const w = welt();
    w.slScan();
    assert.deepEqual(w.geoeffnet, ['kamera']);
    assert.match(_hf('slScan', APP), /scan\.action = null;/);
  });
});

describe('Sortenliste: das Chargen-Fenster und die Wege hinein', () => {
  it('hat die Knöpfe der alten Tabellenzeile', () => {
    const f = _hf('renderChActions', APP);
    assert.match(f, /if \(status !== 'DONE'\)\s*html \+= `<button type="button" data-bi="ch-move"/);
    for (const a of ['ch-bags', 'ch-note', 'ch-del']) assert.match(f, new RegExp('data-bi="' + a + '"'));
    const c = _hf('chAction', APP);
    assert.match(c, /if \(a === 'ch-move'\) return openMoveBatchModal\(id\)/);
    assert.match(c, /if \(a === 'ch-bags'\) return openAddBags\(id\)/);
    assert.match(c, /if \(a === 'ch-note'\) return openNote\(id\)/);
    assert.match(c, /if \(a === 'ch-del'\) return delBatch\(id\)/);
    assert.match(APP, /if \(a\.startsWith\('ch-'\)\) return chAction\(a\);/);
    assert.match(_hf('openChargeSheet', APP), /_bagChipsHtml\(b\)/, 'die Beutel stehen im Fenster');
  });

  it('"Zur Charge" landet in der richtigen Liste und lässt die Zeile blinken', () => {
    const g = _hf('goToBatch', APP);
    assert.match(g, /b\.batchType === 'grain'[\s\S]*openStab\('lab', 'grain'\);\s*slZeige\(SL_KOERNER, b\)/);
    assert.match(g, /openStab\('batch', 'list'\);\s*if \(b\) slZeige\(SL_CHARGEN, b\)/);
    assert.match(g, /data-find="batch:/);
  });
});
