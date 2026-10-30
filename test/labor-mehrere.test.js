'use strict';
// Mehrere Arten auf einmal, aus einer Herkunft.
//
// Ein Labortag mit einer Sorte: aus demselben Glas gehen Petrischalen,
// Flüssigkulturen, Spritzen und Körnerbrut. Einzeln hieß das, für jede Art den
// Laborarbeit-Dialog zu öffnen, dieselbe Herkunft neu zu scannen und jedes Mal
// zu drucken. Der Knopf "Mehrere" lässt mehrere Arten antippen; die eine
// Herkunft gilt für alle, jede Zahl fängt bei 0 an, und am Ende stehen alle
// Etiketten in einem Fenster mit einem Druck — auch die der Körnerbeutel, die
// vorher ihr eigenes Fenster hatten. Das Beimpfen-Fenster endet seitdem gleich.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT, quelle, hebe: _hebe, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const hebe = (n) => _hf(n, APP);
const LAB = APP.match(/const LAB_PARENT_TYPES = \{[\s\S]*?\n\};/)[0];
// sySumme und syTeile sind Pfeilfunktionen auf einer Zeile.
const SY = _hebe(
  [
    [/^const SY_ML = .*$/m, 'SY_ML'],
    [/^const sySumme = .*$/m, 'sySumme'],
    [/^const syTeile = .*$/m, 'syTeile']
  ],
  APP
);
const MEHRERE = [
  APP.match(/^const MSQ_MEHRERE = .*$/m)[0],
  APP.match(/^const MSQ_STUECK = .*$/m)[0],
  hebe('msqMehrere'),
  hebe('msqArten'),
  hebe('msqParentTypes')
].join('\n');

describe('Mehrere Arten: die eine Herkunft', () => {
  const herkunft = (arten) =>
    new Function(`
      ${LAB}
      const _msQuickCtx = { mode: 'labor', mehrere: true, arten: ${JSON.stringify(arten)} };
      const document = { getElementById: () => ({ value: 'PD' }) };
      ${MEHRERE}
      return msqParentTypes();
    `)();

  it('muss zu jeder angetippten Art passen', () => {
    assert.deepEqual(herkunft(['PD', 'LC']), ['MC', 'PD', 'LC', 'SY']);
    // Slants mit Petrischalen aus derselben Schale.
    assert.deepEqual(herkunft(['MC', 'PD']), ['MC', 'PD', 'LC', 'SY']);
    // Körnerbrut wächst nicht aus einem Slant.
    assert.deepEqual(herkunft(['PD', 'LC', 'KB']), ['PD', 'LC', 'SY']);
    // Und eine Spritze nicht aus einer Spritze.
    assert.deepEqual(herkunft(['PD', 'SY', 'KB']), ['PD', 'LC']);
  });

  function scannen(arten, inoc, id) {
    return new Function(`
      ${LAB}
      const _msQuickCtx = { mode: 'labor', mehrere: true, arten: ${JSON.stringify(arten)}, ms: { id: 7, name: 'Blue Oyster' } };
      let _inoc = ${JSON.stringify(inoc)};
      const cultures = [
        { id: 'LC-BO-151026-01', type: 'LC', strainId: 7 },
        { id: 'SY-BO-161026-01', type: 'SY', strainId: 7 }
      ];
      const document = { getElementById: () => ({ value: 'PD', selectedOptions: [{ textContent: 'Petrischalen-Transfer' }] }) };
      const t = (k, p) => k + (p ? ' ' + JSON.stringify(p) : '');
      const inocAdd = (x) => { _inoc.push({ kind: 'culture', id: x }); return null; };
      const nbAvailableSpawnBags = () => [{ bag: 'G-BO-101026-01-01', strainId: 7 }];
      ${MEHRERE}
      ${hebe('msqInocAdd')}
      const fehler = msqInocAdd(${JSON.stringify(id)});
      return { fehler, inoc: _inoc };
    `)();
  }

  it('eine zweite Herkunft ersetzt die erste: es gibt genau eine für alle', () => {
    const r = scannen(['PD', 'LC', 'KB'], [{ kind: 'culture', id: 'SY-BO-161026-01' }], 'LC-BO-151026-01');
    assert.equal(r.fehler, null);
    assert.deepEqual(r.inoc, [{ kind: 'culture', id: 'LC-BO-151026-01' }]);
  });

  it('was nicht zu allem passt, wird abgewiesen, und die Meldung sagt, was zu tun ist', () => {
    const r = scannen(['PD', 'SY'], [], 'SY-BO-161026-01');
    assert.match(r.fehler, /^msq\.parentWrongTypeMulti /);
    assert.match(r.fehler, /"art":"msq\.art\.PD, msq\.art\.SY"/);
    assert.match(r.fehler, /"types":"MC, PD, LC"/);
    assert.deepEqual(r.inoc, []);
  });

  it('ein Körnerbeutel ist keine Herkunft für mehrere Arten, auch nicht mit Körnerbrut dabei', () => {
    const r = scannen(['LC', 'KB'], [], 'G-BO-101026-01-01');
    assert.match(r.fehler, /^msq\.parentWrongTypeMulti /);
  });
});

describe('Mehrere Arten: die Zahlen', () => {
  it('zählt nur, was angetippt ist, Spritzen je Größe und Körnerbrut je Beutelgröße', () => {
    const z = new Function(`
      ${SY}
      const felder = {
        'ms-q-n-PD': { value: '10' },
        'ms-q-n-LC': { value: '4' },
        'ms-q-sy-10': { value: '3' },
        'ms-q-sy-20': { value: '0' },
        'ms-q-sy-50': { value: '2' }
      };
      const document = { getElementById: (id) => felder[id] || null };
      const _msQuickCtx = { mode: 'labor', mehrere: true, arten: ['PD', 'SY', 'KB'], n: { PD: 0, LC: 0 } };
      const msqReadSizes = () => [{ kg: 1, qty: 6 }];
      ${MEHRERE}
      ${hebe('syMengenLesen')}
      ${hebe('msqMehrereLesen')}
      return msqMehrereLesen();
    `)();
    assert.equal(z.PD, 10);
    assert.equal(z.LC, 0, 'Flüssigkultur ist nicht angetippt');
    assert.deepEqual(z.sy, { 10: 3, 20: 0, 50: 2 });
    assert.deepEqual(z.kb, [{ kg: 1, qty: 6 }]);
    assert.equal(z.summe, 21);
  });

  it('Körnerbrut zählt je Beutelgröße, 1, 2 und 5 kg, und fängt bei 0 an', () => {
    const r = new Function(`
      ${APP.match(/^const KB_KG = .*$/m)[0]}
      ${APP.match(/^const ZAEHLER_KNOPF =\r?\n.*;$/m)[0]}
      const felder = { 'ms-q-kb-1': { value: '6' }, 'ms-q-kb-2': { value: '0' }, 'ms-q-kb-5': { value: '2' } };
      const document = { getElementById: (id) => felder[id] || null };
      const t = (k) => k;
      const esc = (s) => String(s);
      ${hebe('zaehlerZeileHtml')}
      ${hebe('kbMengenHtml')}
      ${hebe('kbMengenLesen')}
      ${hebe('msqReadSizes')}
      return { html: kbMengenHtml('ms-q', {}), zeilen: msqReadSizes() };
    `)();
    assert.deepEqual(r.html.match(/id="ms-q-kb-\d+" value="\d+"/g), [
      'id="ms-q-kb-1" value="0"',
      'id="ms-q-kb-2" value="0"',
      'id="ms-q-kb-5" value="0"'
    ]);
    assert.match(r.html, />5 kg</);
    // Nur Größen mit Anzahl, in der Form, die gsSetLines nimmt.
    assert.deepEqual(r.zeilen, [
      { kg: 1, qty: 6 },
      { kg: 5, qty: 2 }
    ]);
  });

  it('der Knopf "Mehrere" setzt jede Zahl auf 0 und nimmt die gewählte Art als erste', () => {
    const r = new Function(`
      const sel = { value: 'LC' };
      const syBox = { innerHTML: 'alt' };
      const kbBox = { innerHTML: 'alt' };
      const document = { getElementById: (id) => (id === 'ms-q-labtype' ? sel : id === 'ms-q-sy' ? syBox : id === 'ms-q-sizes' ? kbBox : null) };
      const _msQuickCtx = { mode: 'labor', mehrere: false, arten: [], n: { MC: 3, PD: 7, LC: 9 } };
      const msQuickRender = () => {};
      const syMengenHtml = (pre, n) => 'sy:' + pre + JSON.stringify(n);
      const kbMengenHtml = (pre, n) => 'kb:' + pre + JSON.stringify(n);
      ${MEHRERE}
      ${hebe('msqMehrereUmschalten')}
      msqMehrereUmschalten();
      return { ctx: _msQuickCtx, sy: syBox.innerHTML, kb: kbBox.innerHTML };
    `)();
    assert.equal(r.ctx.mehrere, true);
    assert.deepEqual(r.ctx.arten, ['LC']);
    assert.deepEqual(r.ctx.n, { MC: 0, PD: 0, LC: 0 });
    assert.equal(r.sy, 'sy:ms-q{}');
    assert.equal(r.kb, 'kb:ms-q{}');
  });
});

describe('Mehrere Arten: anlegen', () => {
  function anlegen(zahlen) {
    return new Function(`
      const angelegt = [];
      const gesetzt = {};
      const fenster = [];
      const SY_ML = [10, 20, 50];
      let _inoc = [];
      let kornInoc = null;
      let kornOpts = null;
      const wann = new Date(2026, 9, 23, 12);
      const anlageZeitpunkt = () => wann;
      const kulturenAnlegen = (spec) => {
        angelegt.push(spec);
        return { newC: Array.from({ length: spec.qty }, (_, i) => ({ id: spec.type + (spec.ml || '') + '-' + (i + 1) })), saved: Promise.resolve() };
      };
      const document = { getElementById: (id) => ({ set value(v) { gesetzt[id] = v; } }) };
      const gsSetLines = (l) => { gesetzt.lines = l; };
      const createGrainBatch = (o) => {
        kornInoc = _inoc.slice();
        kornOpts = o;
        return { batchObj: { batchId: 'G-1' }, bagIds: ['G-1-01', 'G-1-02'], saved: Promise.resolve() };
      };
      const renderLabLog = () => {};
      const etikettenFuerAlles = (ids, saved, korn) => fenster.push([ids, korn && korn.batchObj.batchId]);
      ${hebe('msqMehrereAnlegen')}
      msqMehrereAnlegen({
        ms: { id: 7, name: 'Blue Oyster', recGrainRhPct: 52 },
        strainText: 'BO1',
        angesetzt: '',
        quelle: 'LC-BO-BO1-151026-01',
        inoc: [{ kind: 'culture', id: 'LC-BO-BO1-151026-01' }],
        zahlen: ${JSON.stringify(zahlen)},
        days: 14
      });
      return { angelegt, gesetzt, fenster, kornInoc, kornOpts, wann };
    `)();
  }

  it('jede Art mit derselben Herkunft, Sorte, Stamm und Tag; Körnerbrut über den Körnerbrut-Weg', () => {
    const r = anlegen({ PD: 10, LC: 4, sy: { 10: 3, 20: 0, 50: 2 }, kb: [{ kg: 1, qty: 2 }] });
    assert.deepEqual(
      r.angelegt.map((s) => [s.type, s.qty, s.ml, s.parentId, s.strainText, s.wann === r.wann, s.ms.id]),
      [
        ['PD', 10, null, 'LC-BO-BO1-151026-01', 'BO1', true, 7],
        ['LC', 4, null, 'LC-BO-BO1-151026-01', 'BO1', true, 7],
        ['SY', 3, 10, 'LC-BO-BO1-151026-01', 'BO1', true, 7],
        ['SY', 2, 50, 'LC-BO-BO1-151026-01', 'BO1', true, 7]
      ]
    );
    // Die Felder, die createGrainBatch liest — der Tag eingeschlossen.
    assert.equal(r.gesetzt['lw-st'], 7);
    assert.equal(r.gesetzt['lw-strain-text'], 'BO1');
    assert.equal(r.gesetzt['lw-created'], '');
    assert.equal(r.gesetzt['gs-days'], 14);
    assert.deepEqual(r.gesetzt.lines, [{ kg: 1, qty: 2 }]);
    assert.deepEqual(r.kornOpts, { ohneFenster: true });
    assert.deepEqual(r.kornInoc, [{ kind: 'culture', id: 'LC-BO-BO1-151026-01' }], 'dieselbe Herkunft');
    // Ein Schluss für alles: 19 Kulturen und die Körnerbrut.
    assert.equal(r.fenster.length, 1);
    assert.equal(r.fenster[0][0].length, 19);
    assert.equal(r.fenster[0][1], 'G-1');
  });

  it('ohne Körnerbrut keine Charge', () => {
    const r = anlegen({ PD: 5, LC: 0, sy: {}, kb: [] });
    assert.equal(r.kornOpts, null);
    assert.deepEqual(r.fenster, [[['PD-1', 'PD-2', 'PD-3', 'PD-4', 'PD-5'], null]]);
  });

  it('der Dialog prüft die Zahlen, solange er steht, und merkt sich nichts davon', () => {
    const f = hebe('msQuickConfirm');
    const pruefen = f.indexOf("toast(t('bmp.nothing'), 'err')");
    const warten = f.indexOf("await stammFertig('ms-q')");
    const anlegen = f.indexOf('msqMehrereAnlegen(');
    assert.ok(pruefen > 0 && pruefen < warten, 'geprüft wird erst, wenn der Dialog schon zu ist');
    assert.ok(warten < anlegen);
    assert.match(
      f,
      /msqMehrereAnlegen\(\{ ms, strainText, angesetzt, quelle: sourceCulture, inoc: inocMit, zahlen, days \}\);/
    );
    // Weder die Art noch eine Anzahl wird für das nächste Mal gemerkt.
    assert.ok(anlegen < f.indexOf('_msqSaveArt('));
  });
});

describe('Ein Etiketten-Fenster, ein Druck', () => {
  it('mit Körnerbrut: erst einlagern, dann ein Fenster für Kulturen und Beutel', () => {
    const r = new Function(`
      const fenster = [];
      const korn = { batchObj: { batchId: 'G-1' }, bagIds: ['G-1-01', 'G-1-02'] };
      const openZonePickModal = (b, bags, fertig) => { fenster.push(['zone', b.batchId, bags.length]); fertig(); };
      const nbPlaceAndPrint = (b) => fenster.push(['nur-korn', b.batchId]);
      const cprShow = (ids, saved, k) => fenster.push(['etiketten', ids.length, k ? k.bagIds.length : 0]);
      ${hebe('etikettenFuerAlles')}
      etikettenFuerAlles(['PD-1', 'LC-1'], Promise.resolve(), korn);
      etikettenFuerAlles(['PD-1'], Promise.resolve(), null);
      etikettenFuerAlles([], Promise.resolve(), korn);
      return fenster;
    `)();
    assert.deepEqual(r, [
      ['zone', 'G-1', 2],
      ['etiketten', 2, 2],
      ['etiketten', 1, 0],
      ['nur-korn', 'G-1']
    ]);
  });

  it('das Fenster nennt Kulturen und Körnerbeutel und zeigt alle Nummern', () => {
    const el = new Function(`
      const el = {};
      const document = { getElementById: (id) => (el[id] = el[id] || { classList: { add() {} } }) };
      const t = (k, p) => k + (p ? JSON.stringify(p) : '');
      const esc = (s) => String(s);
      let lastCreatedCultureIds = [];
      let _cprSaved = null;
      let _cprKorn = null;
      ${hebe('cprShow')}
      cprShow(['PD-1', 'LC-1'], null, { batchObj: { batchId: 'G-1' }, bagIds: ['G-1-01'] });
      return el;
    `)();
    assert.equal(el['cpr-head'].textContent, 'lab.printForAll{"n":3,"kulturen":2,"beutel":1}');
    assert.match(el['cpr-ids'].innerHTML, /PD-1[\s\S]*LC-1[\s\S]*G-1-01/);
    assert.equal(el['prt-cpr'].textContent, 'lab.printAllNow');
    assert.equal(el['cpr-ids-title'].textContent, 'lab.createdIdsAll');
  });

  function drucken(batches) {
    return new Function(
      'batches',
      `
      return (async () => {
        const gesendet = [];
        const reihenfolge = [];
        let _cprSaved = Promise.resolve().then(() => reihenfolge.push('kulturen gespeichert'));
        let gespeichert;
        let _cprKorn = {
          batchObj: { batchId: 'G-1' },
          bagIds: ['G-1-01', 'G-1-02'],
          saved: new Promise((res) => { gespeichert = res; })
        };
        let lastCreatedCultureIds = ['PD-1', 'LC-1'];
        const document = { getElementById: () => null };
        const t = (k, p) => k + (p ? JSON.stringify(p) : '');
        const toast = () => {};
        const makeLabZPL = (ids) => ids.map((id) => '^XA' + id + '^XZ').join('\\n');
        const makeBagZPL = (bags) => bags.map((id) => '^XA' + id + '^XZ').join('\\n');
        const ensureBagBarcodes = async () => {};
        const sendToPrinter = async (zpl) => { reihenfolge.push('gedruckt'); gesendet.push(zpl); return null; };
        let gemeldet = '';
        const printedFb = (m) => { gemeldet = m; };
        const cprClose = () => {};
        ${hebe('printCultureLabelsInline')}
        const lauf = printCultureLabelsInline();
        setTimeout(() => { reihenfolge.push('beutel gespeichert'); gespeichert(); }, 5);
        await lauf;
        return { gesendet, reihenfolge, gemeldet };
      })();
    `
    )(batches);
  }

  it('Kultur- und Beutel-Etiketten gehen zusammen an den Drucker, nach beiden Speicherungen', async () => {
    const r = await drucken([{ batchId: 'G-1', bags: ['G-1-01', 'G-1-02'] }]);
    assert.equal(r.gesendet.length, 1, 'ein Druckauftrag');
    assert.deepEqual(r.gesendet[0].match(/\^XA.*?\^XZ/g), ['^XAPD-1^XZ', '^XALC-1^XZ', '^XAG-1-01^XZ', '^XAG-1-02^XZ']);
    assert.deepEqual(r.reihenfolge, ['kulturen gespeichert', 'beutel gespeichert', 'gedruckt']);
    assert.equal(r.gemeldet, 'print.printedAll{"n":4}');
  });

  it('ist die Charge nicht gespeichert, druckt das Fenster nur die Kulturen', async () => {
    const r = await drucken([]);
    assert.equal(r.gesendet.length, 1);
    assert.deepEqual(r.gesendet[0].match(/\^XA.*?\^XZ/g), ['^XAPD-1^XZ', '^XALC-1^XZ']);
    assert.equal(r.gemeldet, 'print.printedAll{"n":2}');
  });

  it('die Körnerbrut gibt ihre Speicherung mit, auf die das Fenster wartet', () => {
    const f = hebe('createGrainBatch');
    assert.match(f, /const saved = apiPost\('\/api\/batches', apiPayload\)/);
    assert.match(f, /if \(opts && opts\.ohneFenster\) return \{ batchObj, bagIds, saved \};/);
  });
});

describe('Mehrere Arten: der Dialog', () => {
  it('hat den Knopf, die Knöpfe der Arten, die Zähler und die Überschriften', () => {
    assert.match(HTML, /id="ms-q-mehrere"[\s\S]*?data-i18n="msq\.mehrere"/);
    for (const id of ['ms-q-arten', 'ms-q-multi', 'ms-q-sy-head', 'ms-q-kb-head', 'cpr-ids-title'])
      assert.match(HTML, new RegExp('id="' + id + '"'), id + ' fehlt');
  });

  it('jede neue Beschriftung gibt es in allen drei Sprachen', () => {
    global.window = {};
    for (const s of ['de', 'en', 'pt']) {
      delete require.cache[require.resolve(path.join(ROOT, 'lang', s + '.js'))];
      require(path.join(ROOT, 'lang', s + '.js'));
    }
    const keys = [
      'msq.mehrere',
      'msq.art.PD',
      'msq.art.LC',
      'msq.art.SY',
      'msq.art.KB',
      'msq.createN',
      'msq.parentWrongTypeMulti',
      'lab.printForAll',
      'lab.createdIdsAll',
      'lab.printAllNow',
      'print.printedAll'
    ];
    for (const s of ['de', 'en', 'pt']) for (const k of keys) assert.ok(global.window.LANG[s][k], k + ' fehlt in ' + s);
  });
});
