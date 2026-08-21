'use strict';
// Welche Dateien mit einem Deploy sofort ankommen müssen.
//
// Der Service Worker liefert fast alles stale-while-revalidate aus: erst der
// Zwischenspeicher, Auffrischen im Hintergrund. Für Dateien ohne Version in der
// URL, die zusammen einen Build ergeben, ist das falsch — sie kommen dann eine
// Neuladung zu spät, und zwar einzeln. Neues Markup unter alten Regeln sieht
// nicht alt aus, sondern kaputt; ein frisches app.js mit alter Sprachdatei
// druckt rohe Schlüssel.
//
// Deshalb stehen Hülle, Code, Stil und Sprachen in einem Zweig, der zuerst das
// Netz fragt. Der Test hält fest, wer dazugehört — die Liste ist die Aussage,
// nicht der Mechanismus drumherum.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle } = require('./helpers/quelle');

const SW = quelle('sw.js');

// Der Netz-zuerst-Zweig ist der eine, dessen fetch eine Zeitgrenze trägt.
function bedingung() {
  const m = SW.match(
    /if \(([\s\S]{0,400}?)\)\s*\{\s*e\.respondWith\(\s*fetch\(e\.request, \{ signal: AbortSignal\.timeout/
  );
  assert.ok(m, 'der Netz-zuerst-Zweig steht nicht mehr so in sw.js — der Test muss mitgeführt werden');
  return m[1];
}

describe('Service Worker: was mit dem Deploy sofort ankommt', () => {
  it('fragt für Hülle, Code, Stil und Sprachen zuerst das Netz', () => {
    const b = bedingung();
    for (const pfad of ["'/'", "'/index.html'", "'/app.js'", "'/styles.css'", "'/lang/'"]) {
      assert.ok(b.includes(pfad), pfad + ' fehlt im Netz-zuerst-Zweig');
    }
  });

  it('lässt die gepinnten Fremdbibliotheken im Zwischenspeicher', () => {
    // /lib/ trägt seine Version im Inhalt, nicht im Namen, und wird als
    // immutable ausgeliefert — die gehören ausdrücklich nicht dazu.
    assert.ok(!bedingung().includes("'/lib/'"), '/lib/ braucht das Netz nicht zuerst');
  });
});
