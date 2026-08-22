'use strict';
// WCAG-Kontrast, einmal.
//
// relLum() und contrast() standen wortgleich in drei Testdateien —
// kpi-kontrast, weiss-auf-farbe und zonenfarben. Die Rechnung ist nicht der
// Punkt; der Punkt ist, dass sie eine Annahme trägt, die man an einer Stelle
// korrigieren können muss: `substr(i, 2)` für i aus 0,2,4 liest ausschließlich
// sechsstelliges Hex. kpi-kontrast.test.js sammelt seine Token aber mit
// `#[0-9a-fA-F]{3,8}` ein, und ein drei- oder achtstelliger Wert ergibt dann
// still NaN — worauf jede Zusicherung dagegen durchgeht, statt zu scheitern.
//
// Deshalb prüft hexToRgb() die Form und wirft, statt NaN weiterzureichen: ein
// Token, das dieser Helfer nicht lesen kann, soll den Test rot machen und nicht
// unsichtbar aus ihm herausfallen.
const assert = require('node:assert/strict');

/** '#rrggbb' oder '#rgb' -> [r, g, b] in 0..255. Wirft bei allem anderen. */
function hexToRgb(hex) {
  const s = String(hex).trim();
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s);
  assert.ok(m, 'kein lesbarer Hex-Farbwert: ' + JSON.stringify(hex));
  const c = m[1];
  const voll = c.length === 3 ? c[0] + c[0] + c[1] + c[1] + c[2] + c[2] : c;
  return [0, 2, 4].map((i) => parseInt(voll.substr(i, 2), 16));
}

/** Relative Leuchtdichte nach WCAG 2.x. */
function relLum(hex) {
  const ch = hexToRgb(hex).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Kontrastverhältnis zweier Farben, 1..21. */
function contrast(a, b) {
  const l1 = relLum(a);
  const l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

module.exports = { hexToRgb, relLum, contrast };
