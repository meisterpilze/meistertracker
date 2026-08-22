'use strict';
// Was eine leere Liste behaupten darf, bevor die Daten da sind.
//
// zones ist bis zur ersten Antwort von /api/data die leere Vorbelegung, und
// beide Seiten, die sie zeichnen, machten daraus dieselbe Aussage wie über
// echte Leere: "Noch keine Zonen angelegt — leg welche unter Werkzeuge an."
// Das ist eine Behauptung über Daten, die niemand gesehen hat, und sie schickt
// jemanden Zonen anlegen, die es längst gibt.
//
// Ob damit die Meldung erklärt ist, die Jonas auf Admin → Zones & Racks sieht,
// ist offen — nachstellen ließ sie sich nicht. Aber ein leerer Bildschirm, der
// nichts behauptet, was er nicht weiß, ist unabhängig davon richtig.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle } = require('./helpers/quelle');

const SRC = quelle();

function hebeFunktion(name) {
  const re = new RegExp('^function ' + name + '\\(\\) \\{[\\s\\S]*?\\r?\\n\\}', 'm');
  const m = SRC.match(re);
  assert.ok(m, name + '() nicht in app.js gefunden — der Test muss mitgeführt werden');
  return m[0];
}

// Ein Behälter, der sich merkt, was hineingeschrieben wurde.
function umgebung({ zones, datenGeladen }) {
  const el = { innerHTML: '' };
  return {
    el,
    lauf(code, name, extra = '') {
      new Function(`
        const zones = ${JSON.stringify(zones)};
        const datenGeladen = ${datenGeladen};
        const ausgabe = arguments[0];
        const document = { getElementById: () => ausgabe, querySelector: () => null };
        const t = (k) => k;
        const esc = (x) => String(x);
        const ROLE_ORDER = [];
        const ROLE_LABELS = {};
        const getZoneBags = () => ({});
        const getRackBags = () => ({});
        const safeColor = (c) => c || '#000';
        const tp = (k) => k;
        ${extra}
        ${code}
        ${name}();
      `)(el);
      return el.innerHTML;
    }
  };
}

describe('leere Zonenliste', () => {
  const ZONE = { id: 'SPAWN', name: 'Spawn', role: 'spawn', racks: [], sortOrder: 1 };

  it('sagt vor der ersten Antwort nur, dass geladen wird', () => {
    const u = umgebung({ zones: [], datenGeladen: false });
    const html = u.lauf(hebeFunktion('renderZones'), 'renderZones');
    assert.match(html, /common\.loading/);
    assert.doesNotMatch(html, /zones\.empty/, 'ohne Daten keine Aussage über die Daten');
  });

  it('sagt erst nach der Antwort, dass keine Zone angelegt ist', () => {
    const u = umgebung({ zones: [], datenGeladen: true });
    const html = u.lauf(hebeFunktion('renderZones'), 'renderZones');
    assert.match(html, /zones\.empty/);
  });

  it('zeichnet die Liste, sobald es Zonen gibt', () => {
    const u = umgebung({ zones: [ZONE], datenGeladen: true });
    const html = u.lauf(hebeFunktion('renderZones'), 'renderZones');
    assert.doesNotMatch(html, /zones\.empty|common\.loading/);
  });

  // Dasselbe auf der Arbeitsgang-Seite, die dieselbe leere Liste anders
  // beschriftet — und denselben Fehler machte.
  // renderPipelineKPIs hieß die Attrappe früher; die Kennzahlenleiste ist den
  // Sorten-Kacheln gewichen, die renderStatus an genau denselben Stellen ruft.
  // Die Standorte liegen inzwischen auf einem eigenen Reiter, und renderStatus
  // baut sie nur noch, wenn der offen ist — die Attrappe muss also einen
  // aktiven Reiter vortäuschen, sonst prüft der Test den Auslassungspfad.
  const DASH_ATTRAPPEN =
    'const renderSorteTiles = () => {}; const renderOverviewKPIs = () => {};' +
    " document.getElementById = (id) => (id === 'sp-batch-locations' ? { classList: { contains: () => true } } : ausgabe);";

  it('hält die Arbeitsgang-Seite an dieselbe Regel', () => {
    const ohne = umgebung({ zones: [], datenGeladen: false });
    assert.match(ohne.lauf(hebeFunktion('renderStatus'), 'renderStatus', DASH_ATTRAPPEN), /common\.loading/);
    const mit = umgebung({ zones: [], datenGeladen: true });
    assert.match(mit.lauf(hebeFunktion('renderStatus'), 'renderStatus', DASH_ATTRAPPEN), /dash\.noZones/);
  });
});
