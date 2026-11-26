'use strict';
// Die Seite Zonen: je Raum eine Karte mit einem Knopf "Bearbeiten", die Regale
// als Kacheln, und was selten gebraucht wird, im Blatt des Raums.
//
// Vorher hatte jeder Raum sechs Knöpfe in der Kopfzeile und jedes Regal zwei,
// die Warnung "ohne Rack" schickte Beutel auf ein Regal statt in ein Fach, und
// die Kontaminationszone stand da wie ein Raum, in dem Beutel warten.
//
// Alle Räume, Regale und Arten hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const ROLLEN = APP.match(/^const ROLE_ORDER = [^\n]*/m)[0];

const ZONEN = [
  { id: 'ZELT9', name: 'Testzelt', role: 'fruiting', color: '#438871', sortOrder: 1, racks: [] },
  { id: 'KONTA', name: 'Testkontamination', role: 'contaminated', color: '#ef4444', sortOrder: 2, racks: [] },
  {
    id: 'INK9',
    name: 'Testinkubation',
    role: 'incubation',
    color: '#4d829b',
    sortOrder: 3,
    racks: [
      { id: 'INK9_R1', levels: 5, strainId: 7 },
      { id: 'INK9_R2', levels: 0, strainId: null }
    ]
  },
  {
    id: 'KORN9',
    name: 'Testkorn',
    role: 'spawn',
    color: '#926bb6',
    sortOrder: 4,
    racks: [{ id: 'KORN9_R1', levels: 4, strainId: null }]
  }
];

// Die Seite, mit Attrappen: Beutel je Raum und Regal, in keinem Fach je Raum.
function seite({ zones = ZONEN, beutel = {}, regalBeutel = {}, frei = {} } = {}) {
  const el = { innerHTML: '' };
  new Function(
    'el',
    'zones',
    'beutel',
    'regalBeutel',
    'frei',
    `const datenGeladen = true;
    const document = { getElementById: () => el };
    const t = (k, p) => k + (p ? JSON.stringify(p) : '');
    const tp = (k, n) => k + ':' + n;
    const esc = (x) => String(x);
    const safeColor = (c) => c;
    const getZoneBags = (id) => Object.fromEntries(Array.from({ length: beutel[id] || 0 }, (_, i) => ['b' + i, {}]));
    const getRackBags = (id) => Object.fromEntries(Array.from({ length: regalBeutel[id] || 0 }, (_, i) => ['b' + i, {}]));
    const brettZoneMitBrettern = (z) => (z.role === 'incubation' || z.role === 'spawn') && z.racks.some((r) => r.levels > 0);
    const brettOhne = (id) => Array.from({ length: frei[id] || 0 });
    const brettArt = (id) => (id === 7 ? { name: 'Testpilz' } : null);
    const rackLabel = (id) => 'Regal ' + id.slice(-1);
    const zoneDisplayName = (id) => zones.find((z) => z.id === id).name;
    const zonenSucheHtml = () => '';
    const _zonenAuf = new Set();
    const zonenRegalHtml = (r) => '<div data-zonen-regal="' + r.id + '"></div>';
    ${ROLLEN}
    ${hebeFunktion('zonenReihe', APP)}
    ${hebeFunktion('zonenKarte', APP)}
    ${hebeFunktion('renderZones', APP)}
    renderZones();`
  )(el, zones, beutel, regalBeutel, frei);
  return el.innerHTML;
}
const karten = (html) => html.split('<div class="zone-card"').slice(1);

describe('Zonen: die Karten', () => {
  it('eine Karte je Raum, in der Reihe Körnerbrut, Inkubation, Fruchtzelt; keine Kontamination', () => {
    const html = seite();
    const namen = karten(html).map((k) => k.match(/zone-card-name">([^<]*)</)[1]);
    assert.deepEqual(namen, ['Testkorn', 'Testinkubation', 'Testzelt']);
    assert.doesNotMatch(html, /Testkontamination/);
  });

  it('je Karte genau ein Knopf "Bearbeiten", und keiner der alten', () => {
    const html = seite({ beutel: { INK9: 12 } });
    for (const k of karten(html)) assert.equal((k.match(/data-action="zone-open"/g) || []).length, 1);
    for (const alt of [
      'bulk-move',
      'del-rack',
      'del-zone',
      'rename-zone',
      'toggle-qr',
      'print-zone-qr',
      'draggable',
      '⚠'
    ])
      assert.ok(!html.includes(alt), 'noch da: ' + alt);
  });

  it('die Regale als Kacheln: Name, Fächer, Beutel, Art; ein Tipp öffnet das Regal', () => {
    const html = seite({ regalBeutel: { INK9_R1: 3 } });
    const ink = karten(html)[1];
    const kacheln = ink.split('class="zone-tile"').slice(1);
    assert.equal(kacheln.length, 2);
    assert.match(kacheln[0], /data-action="rack-open" data-rack="INK9_R1"/);
    assert.match(kacheln[0], /Regal 1/);
    assert.match(kacheln[0], /rackEdit\.chip:5/);
    assert.match(kacheln[0], /dash\.bags:3/);
    assert.match(kacheln[0], /Testpilz/);
    // Ein Regal ohne Fächer und ohne Art sagt beides.
    assert.match(kacheln[1], /zones\.noShelves/);
    assert.match(kacheln[1], /zone-tile-leer">zones\.noStrain/);
  });

  it('"in keinem Fach" nur in einem Raum mit Fächern, und nur wenn da welche sind', () => {
    const html = seite({ frei: { INK9: 489, KORN9: 0, ZELT9: 7 } });
    const [korn, ink, zelt] = karten(html);
    assert.match(ink, /data-action="frei-open" data-zone="INK9">zones\.freeN\{"n":489\}/);
    assert.doesNotMatch(korn, /frei-open/);
    assert.doesNotMatch(zelt, /frei-open/, 'ein Zelt hat keine Fächer');
  });

  it('ein Raum ohne Regale: das Zelt sagt, wie es zählt, ein anderer Raum "keine Regale"', () => {
    const ohne = ZONEN.map((z) => (z.id === 'KORN9' ? { ...z, racks: [] } : z));
    const [korn, , zelt] = karten(seite({ zones: ohne }));
    assert.match(zelt, /zones\.tentHint/);
    assert.match(korn, /zones\.noRacks/);
  });
});

// Das Blatt eines Raums, mit Attrappen für das, was seine Knöpfe aufrufen.
function blatt(zoneId, { beutel = 0, zones = ZONEN } = {}) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { textContent: '', innerHTML: '', classList: { add() {}, remove() {} } });
  const aufrufe = [];
  const api = new Function(
    'el',
    'zones',
    'beutel',
    'aufrufe',
    `const document = { getElementById: el };
    const t = (k, p) => k + (p ? JSON.stringify(p) : '');
    const tp = (k, n) => k + ':' + n;
    const esc = (x) => String(x);
    const getZoneBags = () => Object.fromEntries(Array.from({ length: beutel }, (_, i) => ['b' + i, {}]));
    const zoneDisplayName = (id) => zones.find((z) => z.id === id).name;
    const reorderZoneWithinRole = (...a) => aufrufe.push(['reorder', ...a]);
    ${ROLLEN}
    ${hebeFunktion('zonenReihe', APP)}
    let _zoneEdit = null;
    ${hebeFunktion('zoneEditOpen', APP)}
    ${hebeFunktion('zoneEditClose', APP)}
    ${hebeFunktion('zoneEditZeichne', APP)}
    ${hebeFunktion('zoneSchiebe', APP)}
    zoneEditOpen(${JSON.stringify(zoneId)});
    return { zoneSchiebe };`
  )(el, zones, beutel, aufrufe);
  return { body: els['m-zone-edit-body'].innerHTML, sub: els['m-zone-edit-sub'].textContent, aufrufe, api };
}

describe('Zonen: das Blatt "Bearbeiten"', () => {
  it('umbenennen, Höchstzahl, Reihenfolge, Regal dazu, QR-Code, löschen', () => {
    const { body } = blatt('INK9');
    for (const a of ['rename', 'capacity', 'up', 'down', 'add-rack', 'qr', 'delete'])
      assert.match(body, new RegExp('data-zone-edit="' + a + '"'), a);
    assert.match(body, /zones\.capacityBtn\{"n":"zones\.capacityNone"\}/);
    assert.match(body, /zones\.qrHint/, 'ein Raum mit Fächern sagt, wer die Fach-Etiketten druckt');
  });

  it('nach oben und unten nur, wo es unter Räumen derselben Art weitergeht', () => {
    const zwei = [...ZONEN, { id: 'INK8', name: 'Testinkubation 2', role: 'incubation', sortOrder: 9, racks: [] }];
    const oben = blatt('INK9', { zones: zwei }).body;
    assert.match(oben, /data-zone-edit="up" disabled/);
    assert.doesNotMatch(oben, /data-zone-edit="down" disabled/);
    const unten = blatt('INK8', { zones: zwei }).body;
    assert.doesNotMatch(unten, /data-zone-edit="up" disabled/);
    assert.match(unten, /data-zone-edit="down" disabled/);
  });

  it('nach unten stellt den Raum hinter den nächsten derselben Art', () => {
    const zwei = [...ZONEN, { id: 'INK8', name: 'Testinkubation 2', role: 'incubation', sortOrder: 9, racks: [] }];
    const b = blatt('INK9', { zones: zwei });
    b.api.zoneSchiebe('INK9', 1);
    assert.deepEqual(b.aufrufe, [['reorder', 'INK9', 'INK8', false, 'incubation']]);
  });

  it('löschen geht erst, wenn kein Beutel mehr im Raum ist, und das Blatt sagt es', () => {
    const voll = blatt('INK9', { beutel: 489 });
    assert.match(voll.body, /data-zone-edit="delete" disabled/);
    assert.match(voll.body, /zones\.deleteBlocked\{"n":489\}/);
    assert.match(voll.sub, /dash\.bags:489 · zones\.racksN:2 · rackEdit\.chip:5/);
    const leer = blatt('INK9', { beutel: 0 });
    assert.doesNotMatch(leer.body, /data-zone-edit="delete" disabled/);
    assert.doesNotMatch(leer.body, /zones\.deleteBlocked/);
  });
});

describe('Zonen: QR-Code eines Raums', () => {
  it('der Raum und nur die Regale ohne Fächer', async () => {
    let gedruckt = null;
    await new Function(
      'zones',
      'fertig',
      `const zoneDisplayName = (id) => id;
      const printQrSheet = async (items, title) => fertig(items, title);
      ${hebeFunktion('printZoneQrBrowser', APP)}
      return printZoneQrBrowser('INK9');`
    )(ZONEN, (items, title) => (gedruckt = { items, title }));
    assert.deepEqual(gedruckt, { items: ['INK9', 'INK9_R2'], title: 'INK9' });
  });
});

describe('Zonen: das Blatt eines Regals', () => {
  function regal(n) {
    const els = {};
    const el = (id) =>
      (els[id] = els[id] || { textContent: '', innerHTML: '', value: '', hidden: false, classList: { add() {} } });
    new Function(
      'el',
      'n',
      `const document = { getElementById: el };
      const t = (k, p) => k + (p ? JSON.stringify(p) : '');
      const tp = (k, x) => k + ':' + x;
      const esc = (x) => String(x);
      const rackVon = () => ({ zoneId: 'INK9', levels: 5, strainId: null });
      const zoneDisplayName = () => 'Testinkubation';
      const rackLabel = () => 'Regal 1';
      const getRackBags = () => Object.fromEntries(Array.from({ length: n }, (_, i) => ['b' + i, {}]));
      const mushroomStrains = [];
      let _rackEdit = null;
      ${hebeFunktion('rackEditOpen', APP)}
      rackEditOpen('INK9_R1');`
    )(el, n);
    return els;
  }
  it('"Regal löschen" nur, solange das Regal leer ist', () => {
    assert.equal(regal(0)['m-rack-edit-del'].hidden, false);
    assert.equal(regal(4)['m-rack-edit-del'].hidden, true);
    assert.equal(regal(4)['m-rack-edit-sub'].textContent, 'rackEdit.sub{"bags":"dash.bags:4"}');
  });
});

describe('Zonen: das Markup', () => {
  const seiteHtml = HTML.match(/<div class="page" id="p-zones">[\s\S]*?\n {8}<\/div>/)[0];
  it('oben nur der Titel und "+ Raum", darunter die Liste', () => {
    assert.match(seiteHtml, /id="btn-zone-add-open"/);
    assert.match(seiteHtml, /id="zones-list"/);
    assert.doesNotMatch(seiteHtml, /btn-print-all-zone-qr|zone-name|btn-add-zone/);
  });
  it('"+ Raum" und "Bearbeiten" sind Fenster, die über _Z_SCHLIESSEN zugehen', () => {
    assert.match(HTML, /id="m-zone-add"[^>]*hidden/);
    assert.match(HTML, /id="m-zone-edit"[^>]*hidden/);
    assert.match(APP, /'m-zone-edit': \(\) => zoneEditClose\(\)/);
    assert.match(APP, /'m-zone-add': \(\) => zoneAddClose\(\)/);
  });
  it('einen Raum für Kontamination legt niemand mehr an', () => {
    const wahl = HTML.match(/<select id="zone-role">[\s\S]*?<\/select>/)[0];
    assert.doesNotMatch(wahl, /contaminated/);
    assert.deepEqual(
      [...wahl.matchAll(/value="(\w+)"/g)].map((m) => m[1]),
      ['spawn', 'incubation', 'fruiting']
    );
  });
});

describe('Kontamination: die Quittung zählt, was ausgebucht wurde', () => {
  const ausgebucht = new Function(`${hebeFunktion('_crAusgebucht', APP)} return _crAusgebucht;`)();
  it('liest bookedOutCount, auch eine 0', () => {
    assert.equal(ausgebucht({ bookedOutCount: 2, autoMovedCount: 1 }), 2);
    assert.equal(ausgebucht({ bookedOutCount: 0, autoMovedScanId: 5 }), 0);
  });
  it('eine Antwort von vorher zählt ihre Umzüge', () => {
    assert.equal(ausgebucht({ autoMovedCount: 3 }), 3);
    assert.equal(ausgebucht({ autoMovedScanId: 5 }), 1);
    assert.equal(ausgebucht(null), 0);
  });
});
