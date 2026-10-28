'use strict';
// Kulturbibliothek: eine Zeile je Sorte, aufklappen, eine Kultur antippen.
//
// Vorher war hier eine Tabelle, am Telefon 140 Karten untereinander, mit zwei
// Filtern davor und allem, was je verbraucht wurde, mitten drin. Jetzt steht
// je Sorte eine Zeile mit dem, was da ist; ein Tipp zeigt ihre Kulturen nach
// Art, älteste zuerst, und ein Tipp auf eine Kultur öffnet das Fenster, das
// auch ein Scan öffnet. Gesucht wird mit der Kamera.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const TAG = 864e5;
const JETZT = Date.parse('2026-10-28T12:00:00Z');
const vor = (tage) => new Date(JETZT - tage * TAG).toISOString();

function seite(liste) {
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
    `const Date = class extends globalThis.Date { static now() { return JETZT; } };
    let cultures = ${JSON.stringify(liste)};
    const mushroomStrains = [{ id: 1, name: 'Testart Alpha' }, { id: 2, name: 'Testart Beta' }];
    const esc = (s) => String(s);
    const t = (k, p) => (p ? k + JSON.stringify(p) : k);
    const loc = () => 'de';
    const spDot = () => '';
    const syMl = (c) => (c && c.type === 'SY' ? c.ml || 10 : null);
    const openCultureSheet = (c) => geoeffnet.push(c.id);
    ${['KB_ARTEN', 'KB_TITEL', 'KB_KURZ', 'KB_STATUS', 'KB_ZEIGEN', '_kb', '_kbDa']
      .map((n) => APP.match(new RegExp('^const ' + n + ' = .*;$', 'm'))[0])
      .join('\n')}
    ${[
      '_kbSorte',
      '_kbAlter',
      '_kbGruppen',
      '_kbKulturHtml',
      '_kbArtHtml',
      '_kbSorteHtml',
      'renderCultures',
      'kbZeige',
      'kbKlick',
      'kbErledigt'
    ]
      .map((n) => _hf(n, APP))
      .join('\n')}
    const klick = (attr, wert) => kbKlick({ target: { closest: (sel) => (sel === '[data-' + attr + ']' ? { dataset: { [attr.replace(/-(.)/g, (_, x) => x.toUpperCase())]: wert } } : null) } });
    return { renderCultures, kbZeige, kbErledigt, klick };`
  )({ getElementById: el, querySelector: () => null }, geoeffnet, JETZT);
  api.renderCultures();
  return { ...api, els, geoeffnet, html: () => els['kb-list'].innerHTML };
}
const k = (id, type, strainId, created, o = {}) => ({ id, type, strainId, status: 'active', created, ...o });

describe('Kulturbibliothek: je Sorte eine Zeile', () => {
  const LISTE = [
    k('PD-TB-011026-01', 'PD', 2, vor(27)),
    k('PD-TA-090926-01', 'PD', 1, vor(49)),
    k('PD-TA-090926-02', 'PD', 1, vor(49)),
    k('LC-TA-170926-01', 'LC', 1, vor(41), { status: 'stored' }),
    k('SY-TA-211026-01', 'SY', 1, vor(7), { ml: 20 }),
    k('PD-TA-011026-03', 'PD', 1, vor(27), { status: 'contam' }),
    k('SY-TA-011026-02', 'SY', 1, vor(27), { status: 'sold' })
  ];

  it('zeigt nur, was da ist, je Sorte mit ihren Zahlen, nach Namen', () => {
    const s = seite(LISTE);
    const h = s.html();
    assert.ok(h.indexOf('Testart Alpha') < h.indexOf('Testart Beta'));
    assert.match(
      h,
      /data-kb-sorte="id:1"[^>]*>.*lb\.short\.LC <b>1<\/b>.*lb\.short\.PD <b>2<\/b>.*lb\.short\.SYall <b>1<\/b>/
    );
    assert.doesNotMatch(h, /data-kb-id=/, 'zugeklappt: keine einzelne Kultur');
    assert.equal(s.els['kb-count'].textContent, 'kb.count{"n":5}');
    assert.equal(s.els['kb-erledigt'].textContent, 'kb.done{"n":2}');
  });

  it('ein Tipp klappt die Sorte auf: nach Art, älteste zuerst, mit Alter', () => {
    const s = seite(LISTE);
    s.klick('kb-sorte', 'id:1');
    const h = s.html();
    assert.ok(h.indexOf('lab.liquidCultures') < h.indexOf('lab.petriDishes'));
    assert.match(h, /data-kb-id="LC-TA-170926-01"[^>]*>.*lab\.stored · kb\.weeks\{"n":5\}/);
    assert.match(h, /data-kb-id="SY-TA-211026-01"[^>]*>.*20 ml · kb\.days\{"n":7\}/);
    assert.ok(h.indexOf('PD-TA-090926-01') < h.indexOf('PD-TA-090926-02'));
    assert.doesNotMatch(h, /PD-TB-011026-01/, 'nur die aufgeklappte Sorte');
    s.klick('kb-sorte', 'id:1');
    assert.doesNotMatch(s.html(), /data-kb-id=/, 'ein zweiter Tipp klappt zu');
  });

  it('eine Kultur antippen öffnet ihr Fenster, wie ein Scan', () => {
    const s = seite(LISTE);
    s.klick('kb-id', 'PD-TA-090926-01');
    assert.deepEqual(s.geoeffnet, ['PD-TA-090926-01']);
  });

  it('zeigt sechs je Art und den Rest auf einen Tipp; sieben stehen ganz da', () => {
    const viele = Array.from({ length: 9 }, (_, i) => k('PD-TA-0' + (i + 1) + '1026-01', 'PD', 1, vor(30 - i)));
    const s = seite(viele);
    s.klick('kb-sorte', 'id:1');
    assert.equal((s.html().match(/data-kb-id=/g) || []).length, 6);
    assert.match(s.html(), /data-kb-mehr="id:1\|PD">kb\.more\{"n":3\}/);
    s.klick('kb-mehr', 'id:1|PD');
    assert.equal((s.html().match(/data-kb-id=/g) || []).length, 9);
    const sieben = seite(viele.slice(0, 7));
    sieben.klick('kb-sorte', 'id:1');
    assert.equal((sieben.html().match(/data-kb-id=/g) || []).length, 7);
  });

  it('Erledigte zeigt verbraucht, verkauft, kontaminiert, die jüngste zuerst', () => {
    const s = seite(LISTE);
    s.kbErledigt();
    s.klick('kb-sorte', 'id:1');
    const h = s.html();
    assert.match(h, /data-kb-id="PD-TA-011026-03"[^>]*>.*lab\.contaminated/);
    assert.match(h, /data-kb-id="SY-TA-011026-02"[^>]*>.*10 ml · lab\.sold/);
    assert.doesNotMatch(h, /PD-TA-090926-01/);
    assert.equal(s.els['kb-erledigt'].textContent, 'kb.backToStock');
    assert.equal(s.els['kb-erledigt'].attrs['aria-pressed'], 'true');
  });

  it('die Suche landet auf der Kultur, auch hinter "weitere" oder bei den erledigten', () => {
    const s = seite(LISTE);
    s.kbZeige('PD-TA-011026-03');
    assert.match(s.html(), /data-find="culture:PD-TA-011026-03"/);
  });
});

describe('Kulturbibliothek: auf der Seite und im Fenster', () => {
  it('oben der Scan-Knopf statt Suche und Filter; keine Tabelle mehr', () => {
    const i = HTML.indexOf('id="sp-lab-cultures"');
    const block = HTML.slice(i, HTML.indexOf('<!-- Log work -->', i));
    assert.ok(block.indexOf('id="kb-scan"') < block.indexOf('id="kb-list"'));
    assert.doesNotMatch(block, /<table|id="cult-type"|id="cult-stat"/);
    assert.match(_hf('kbScan', APP), /scan\.action = null;[\s\S]*openCamScan\(\)/);
  });

  it('das Kultur-Fenster kann drucken, löschen und eine erledigte zurückholen', () => {
    const f = _hf('renderCiActions', APP);
    assert.match(f, /data-bi="ci-print"/);
    assert.match(f, /if \(_lbDarfWeg\(c\)\)\s*html \+= `<button type="button" data-bi="ci-delete"/);
    assert.match(f, /if \(!aktiv\)\s*html \+= `<button type="button" data-bi="ci-active"/);
    const a = _hf('ciAction', APP);
    assert.match(a, /if \(a === 'ci-active'\) return ciSetStatus\('active', 'ci\.activeDone'\)/);
    assert.match(a, /if \(a === 'ci-print'\) return quickPrintCulture\(c\.id\)/);
    assert.match(a, /if \(a === 'ci-delete'\) return kulturenLoeschen\(\[c\]\)/);
  });
});
