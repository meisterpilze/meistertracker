'use strict';
// Ein Untertab ist eine Oberfläche.
//
// `measureLive()` misst, was sichtbar ist, und sichtbar ist je Seite genau ein
// Untertab: der, auf dem sie aufmacht. Zwölf Seiten tragen 33 Untertabs. Bis
// zum 25.08.2026 wurden zwölf davon gemessen, und jedes „0 offene Befunde"
// dieses Standes galt damit für ein Drittel der Anwendung und las sich wie das
// Ganze. Die Systemseite allein hat dreizehn Untertabs; nur „Server" stand je
// in einer Zahl.
//
// Gefunden beim Vergleich jeder `data-mlabel` mit ihrer Spalte: sechs der zwölf
// Kartentabellen hatten überhaupt keine Zeile, mit der man vergleichen könnte.
// Alle sechs lagen in einem Untertab.
//
// Was hier geprüft werden kann, ist die Verdrahtung — der Lauf selbst braucht
// einen Browser und eine Datenbank und kann nicht in `npm test` stehen.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle } = require('./helpers/quelle');

const html = quelle('index.html');
const stand = quelle('scripts/measure-mobile.js');

describe('jeder Untertab kann eine Station werden', () => {
  const knoepfe = [...html.matchAll(/<button([^>]*\bclass="stab[^"]*"[^>]*)>/g)].map((m) => m[1]);

  it('findet sie überhaupt', () => {
    assert.ok(knoepfe.length >= 33, `nur ${knoepfe.length} Untertabs gefunden`);
  });

  it('gibt jedem eine Kennung, sonst ist er für den Stand nicht anklickbar', () => {
    // Der Stand sammelt `.stab`-Knöpfe MIT id. Einer ohne fällt lautlos aus dem
    // Lauf, und seine Oberfläche wird nie gemessen — dieselbe Stille wie vorher,
    // nur eine Ebene tiefer.
    const ohne = knoepfe.filter((a) => !/\bid="/.test(a)).map((a) => a.trim().slice(0, 60));
    assert.deepEqual(ohne, [], `${ohne.length} Untertab(s) ohne id: ${ohne.join(' | ')}`);
  });

  it('hat je Streifen genau eine Voreinstellung', () => {
    const streifen = [...html.matchAll(/<div class="stabs"[^>]*>[\s\S]*?<\/div>/g)].map((m) => m[0]);
    assert.ok(streifen.length >= 6, `nur ${streifen.length} Untertab-Streifen`);
    for (const s of streifen) {
      const aktiv = (s.match(/class="stab active"/g) || []).length;
      assert.equal(aktiv, 1, `ein Streifen hat ${aktiv} voreingestellte Untertabs statt einem`);
    }
  });
});

describe('der Stand macht Stationen daraus', () => {
  it('sammelt die Untertabs der offenen Seite', () => {
    assert.match(stand, /seite\.querySelectorAll\('\.stab'\)/);
  });

  it('behält für die Voreinstellung den Namen der Seite', () => {
    // Sonst wäre der Zensus über den Umbau hinweg nicht mehr vergleichbar, und
    // eine Änderung an der Schriftgröße läse sich wie ein Umbau der Navigation.
    assert.match(stand, /stations\.push\(\{ name: id, open: id, tab: voreinstellung \}\)/);
    assert.match(stand, /stations\.push\(\{ name: `\$\{id\}\/\$\{tab\}`, open: id, tab \}\)/);
  });

  it('nimmt den offenen Untertab als Voreinstellung, nicht den ersten im Markup', () => {
    // DOM-Reihenfolge ist nicht die Voreinstellung der Anwendung. Beim ersten
    // Versuch stand die Laborseite dadurch den ganzen Lauf auf Körnerbrut, und
    // der Zensus meldete sechzig Elemente, die auf einer nur besuchten Seite
    // die Größe wechselten.
    assert.match(stand, /const voreinstellung = offen && tabs\.includes\(offen\) \? offen : tabs\[0\]/);
  });
});

describe('der Umschalter im Fuß', () => {
  it('wird nicht gedrückt, wenn die Seite schon offen ist', () => {
    // Der Admin-Knopf führt hinein UND hinaus. Dreizehn System-Untertabs
    // hintereinander bedeuten dreizehn Drücke, und jeder zweite ging wieder
    // heraus: die Wartezeit lief in ihre fünf Sekunden (36 mal in einem Lauf
    // über eine einzige Breite), und gemessen wurde die Seite davor unter dem
    // Namen der Systemseite.
    assert.match(stand, /if \(!noetig\) continue;/);
    assert.match(stand, /const noetig = await page\.evaluate\(/);
  });

  it('wartet auf die Seite und nicht auf den Knopf', () => {
    // `#n-settings` steht im Fuß und trägt kein `active`, wenn die Hauptliste
    // die Auswahl führt. Auf den Knopf zu warten heißt, fünf Sekunden zu warten
    // und dann trotzdem zu messen.
    const warten = stand.match(/waitForFunction\(\s*\(i\) => \{[\s\S]*?\},\s*\{ timeout: 5000 \},\s*id\s*\)/);
    assert.ok(warten, 'die Wartebedingung der Station wurde umbenannt');
    assert.match(warten[0], /document\.getElementById\('p-' \+ b\.dataset\.page\)/);
  });
});
