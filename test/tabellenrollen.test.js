'use strict';
// Befund T7: Der Kartenmodus nimmt zwölf Tabellen ihre Semantik.
//
// Unter der Kartengrenze bekommt jedes Tabellenelement `display: block`, und
// damit fällt die eingebaute Tabellenrolle weg. Ein Vorleseprogramm hört danach
// keine Tabelle mehr, sondern eine Folge von Absätzen: keine Zeile 3 von 12,
// keine Spaltenzuordnung. Der Shop stellt das von Hand wieder her, 44 mal in
// den drei Dateien, deren CSS Karten baut. Der Tracker tat es an keiner Stelle.
//
// Warum das eine Prüfung braucht: Der Fehler ist unsichtbar. Nichts läuft über,
// nichts ist zu klein, kein Bild sieht anders aus, und die sechs Kategorien des
// Messstands melden weiter null. Nur wer zuhört, merkt es. Also prüft dieser
// Test beide Hälften — die feste im Markup und die gestempelte zur Laufzeit —
// und vor allem, dass eine dreizehnte Tabelle nicht still ohne sie ankommt.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const html = quelle('index.html');
const app = quelle('app.js');

const kartentabellen = [...html.matchAll(/<table id="([\w-]+)" class="t-cards"([^>]*)>/g)];

describe('die feste Hälfte: der Kopf steht im Markup', () => {
  it('findet die Kartentabellen überhaupt', () => {
    assert.ok(kartentabellen.length >= 12, `nur ${kartentabellen.length} Kartentabellen gefunden`);
  });

  it('gibt jeder von ihnen die Tabellenrolle', () => {
    const ohne = kartentabellen.filter((m) => !/role="table"/.test(m[2])).map((m) => m[1]);
    assert.deepEqual(ohne, [], 'ohne role="table": ' + ohne.join(', '));
  });

  it('macht Kopf und Rumpf zu Rollengruppen', () => {
    for (const m of kartentabellen) {
      const block = html.slice(m.index, html.indexOf('</table>', m.index));
      assert.match(block, /<thead role="rowgroup">/, m[1] + ': thead ohne Rolle');
      assert.match(block, /<tbody id="[\w-]+" role="rowgroup">/, m[1] + ': tbody ohne Rolle');
    }
  });

  it('beschriftet jede Kopfzelle als Spaltenkopf', () => {
    for (const m of kartentabellen) {
      const block = html.slice(m.index, html.indexOf('</table>', m.index));
      const kopf = block.match(/<thead role="rowgroup">[\s\S]*?<\/thead>/);
      assert.ok(kopf, m[1] + ': kein thead');
      const zellen = [...kopf[0].matchAll(/<th(\s[^>]*)?>/g)];
      const ohne = zellen.filter((z) => !/role="columnheader"/.test(z[1] || ''));
      assert.equal(ohne.length, 0, `${m[1]}: ${ohne.length} von ${zellen.length} th ohne Rolle`);
      assert.match(kopf[0], /<tr role="row">/, m[1] + ': Kopfzeile ohne Rolle');
    }
  });
});

describe('die gestempelte Hälfte: die Zeilen entstehen zur Laufzeit', () => {
  // Attrappe statt jsdom, wie überall in diesen Tests. Gemessen wird die
  // Entscheidung, welches Element welche Rolle bekommt, nicht der Browser.
  const el = (tagName, children = []) => {
    const o = { tagName, children, attrs: {} };
    o.setAttribute = (k, v) => {
      o.attrs[k] = v;
    };
    return o;
  };

  function stempeln(tbody) {
    const fn = new Function(hebeFunktion('stampRowRoles') + '\nreturn stampRowRoles;')();
    fn(tbody);
    return tbody;
  }

  it('macht aus jeder Zeile eine Zeile und aus jeder Zelle eine Zelle', () => {
    const zeile = el('TR', [el('TD'), el('TD'), el('TD')]);
    stempeln(el('TBODY', [zeile]));
    assert.equal(zeile.attrs.role, 'row');
    assert.deepEqual(
      zeile.children.map((z) => z.attrs.role),
      ['cell', 'cell', 'cell']
    );
  });

  it('nennt eine th-Zelle im Rumpf einen Zeilenkopf und keinen Spaltenkopf', () => {
    const zeile = el('TR', [el('TH'), el('TD')]);
    stempeln(el('TBODY', [zeile]));
    assert.equal(zeile.children[0].attrs.role, 'rowheader');
  });

  it('lässt eine Tabelle in einer Zelle in Ruhe', () => {
    // Sonst würden die Zeilen der inneren Tabelle als Zeilen der äußeren
    // ausgegeben, und das ist schlimmer als gar keine Rolle.
    const innen = el('TR', [el('TD')]);
    const zelle = el('TD', [el('TABLE', [el('TBODY', [innen])])]);
    stempeln(el('TBODY', [el('TR', [zelle])]));
    assert.equal(zelle.attrs.role, 'cell');
    assert.equal(innen.attrs.role, undefined, 'die innere Zeile wurde mitgestempelt');
  });

  it('geht über alles hinweg, was keine Zeile ist', () => {
    const text = el('#text');
    assert.doesNotThrow(() => stempeln(el('TBODY', [text])));
    assert.equal(text.attrs.role, undefined);
  });
});

describe('die Verdrahtung', () => {
  it('hängt an jedem Tabellenrumpf einen Beobachter, nicht an jeder Rendermethode', () => {
    // Zwölf Rümpfe werden aus einem Dutzend Stellen gefüllt, mehrere davon
    // mehrfach. Ein Aufruf je Stelle ist ein Aufruf, den die dreizehnte Stelle
    // vergisst.
    assert.match(app, /document\.querySelectorAll\('\.t-cards > tbody'\)/);
    assert.match(
      app,
      /new MutationObserver\(\(\) => stampRowRoles\(tbody\)\)\.observe\(tbody, \{ childList: true \}\)/
    );
  });

  it('beobachtet nur Kindlisten, damit das Stempeln sich nicht selbst auslöst', () => {
    const auf = app.match(/\.observe\(tbody, \{[^}]*\}\)/);
    assert.ok(auf);
    assert.doesNotMatch(auf[0], /attributes/);
  });

  it('läuft auch dann an, wenn app.js erst nach dem Aufbau der Seite drankommt', () => {
    assert.match(app, /document\.readyState === 'loading'/);
    assert.match(app, /addEventListener\('DOMContentLoaded', watchCardTables, \{ once: true \}\)/);
  });
});
