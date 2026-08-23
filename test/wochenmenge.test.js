'use strict';
// Eine Menge, zwei Ebenen — und beide sollen voneinander wissen.
//
// Der Wochenrhythmus ist die Vorlage ("montags 36 Substrat"), der Kalender die
// Ausnahme für einen einzelnen Tag. Das sind zwei verschiedene Aussagen und
// beide werden gebraucht, aber auf dem Schirm sahen sie aus wie zwei Systeme
// über dieselbe Sache:
//
//   – dieselbe nackte 72 stand zweimal in einer Spalte, oben im Kopf und
//     zwanzig Pixel darunter im Körper, wo sie zusätzlich bearbeitbar war;
//   – wer einen Tag einmal im Kalender angefasst hatte, hatte ihn unsichtbar
//     vom Rhythmus abgekoppelt — eine spätere Änderung der Vorlage ging an ihm
//     wortlos vorbei, und es gab keinen Weg zurück;
//   – gedacht wird in "70 die Woche", gefragt wurde nach sieben Tageszahlen.
//
// Diese Datei hält fest, was die beiden Ebenen zusammenhält.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');

const SRC = quelle('app.js');
const CSS = quelle('styles.css');
const HTML = quelle('index.html');

// ── Die Wochensumme ─────────────────────────────────────────────────────────
// _rhythmWeekTotals() liest den Entwurf des Editors, nicht das DOM, also lässt
// es sich mit einem Entwurf und den beiden Konstanten davor prüfen.
function summen(draft) {
  const code =
    hebeKonstante('WEEK_DAYS', SRC) + '\n' + hebeFunktion('_rhythmWeekTotals', SRC) + '\nreturn _rhythmWeekTotals();';
  return new Function('_rhythmDraft', code)(draft);
}

describe('Was die Woche verlangt', () => {
  it('summiert die Tage je Thema', () => {
    const t = summen({
      1: { theme: 'substrate', targetQty: 36 },
      4: { theme: 'substrate', targetQty: 34 },
      2: { theme: 'grain', targetQty: 20 }
    });
    assert.equal(t.substrate, 70, '36 + 34 sollten die 70 der Woche sein');
    assert.equal(t.grain, 20);
  });

  it('wirft Substrat und Körnerbrut nicht in eine Zahl', () => {
    // Blöcke und Gläser sind nicht dieselbe Einheit. Eine gemeinsame Summe wäre
    // eine Zahl, die nichts misst — und die Frage stellt sich ohnehin je Thema.
    const t = summen({ 1: { theme: 'substrate', targetQty: 36 }, 2: { theme: 'grain', targetQty: 20 } });
    assert.deepEqual(Object.keys(t).sort(), ['grain', 'substrate']);
  });

  it('zählt freie Tage und leere Felder nicht mit', () => {
    const t = summen({
      1: { theme: 'substrate', targetQty: 36 },
      2: { theme: 'free', targetQty: 99 },
      3: { theme: 'substrate', targetQty: null },
      5: { theme: 'substrate' }
    });
    assert.equal(t.substrate, 36, 'ein freier Tag oder ein leeres Feld hat die Summe verändert');
    assert.equal(t.free, undefined);
  });

  it('lässt ein halb getipptes Feld die Summe nicht zerstören', () => {
    // Number('') ist 0, Number('-') ist NaN. Eine Summe, die beim Tippen kurz
    // NaN anzeigt, sieht aus wie ein Fehler der App.
    const t = summen({ 1: { theme: 'substrate', targetQty: 36 }, 2: { theme: 'substrate', targetQty: NaN } });
    assert.equal(t.substrate, 36);
  });

  it('ist leer, solange nichts eingetragen ist', () => {
    assert.deepEqual(summen({}), {});
  });

  it('rechnet beim Tippen mit, ohne die Zeilen neu zu bauen', () => {
    // Ein Neuaufbau mitten in der Eingabe nimmt dem Feld den Fokus und setzt den
    // Cursor zurück; man tippt "70" und es steht "0" da.
    const fn = hebeFunktion('_renderRhythmRows', SRC);
    const bindung = fn.slice(fn.indexOf("querySelectorAll('[data-rhythm-qty]')"));
    assert.match(bindung, /addEventListener\('input'/, 'die Summe rechnet beim Tippen nicht mit');
    assert.match(bindung, /_renderRhythmTotal\(\)/);
    assert.doesNotMatch(
      bindung.slice(0, bindung.indexOf('_renderRhythmTotal')),
      /_renderRhythmRows\(\)/,
      'die Eingabe baut die Zeilen neu und verliert den Fokus'
    );
  });

  it('hat einen Platz im Rhythmus-Fenster, den es beschreiben kann', () => {
    assert.match(HTML, /id="rhythm-total"/, 'die Summe hat kein Element');
    assert.match(hebeFunktion('_renderRhythmTotal', SRC), /getElementById\('rhythm-total'\)/);
  });

  it('bleibt auf dem Telefon stehen, während man tippt', () => {
    // Sieben Wochentage mit Menge, Sorte und Notiz sind höher als ein
    // Telefonschirm. Eine Summe unter diesen sieben Zeilen ist genau dann nicht
    // zu sehen, wenn man sie braucht — und auf dem Telefon läuft die App meistens.
    assert.match(CSS, /\.rhythm-total \{[^}]*position: sticky;[^}]*bottom: 0;/);
    assert.match(CSS, /\.rhythm-total \{[^}]*background: var\(--c-surface\)/, 'die Zeilen scheinen durch');
    // Geklebt wird am Scrollbereich, und das ist .modal selbst.
    assert.match(CSS, /\.modal \{[^}]*overflow-y: auto;/, 'das Fenster scrollt gar nicht');
  });
});

// ── Der Rückweg zur Vorlage ─────────────────────────────────────────────────
describe('Kalender und Rhythmus wissen voneinander', () => {
  const DB = quelle('db.js');

  it('nennt beim Ändern eines Tages, was der Rhythmus sagt', () => {
    // Sonst sind es zwei Zahlen an zwei Stellen ohne sichtbaren Bezug.
    const fn = hebeFunktion('editRhythmTarget', SRC);
    assert.match(fn, /rhythm\.targetPromptTpl/, 'die Vorlage wird beim Ändern nicht mitgesagt');
    assert.match(fn, /rhythmOf\(/, 'die Vorlage wird gar nicht erst nachgeschlagen');
  });

  it('löscht die Ausnahme, wenn sie der Vorlage gleicht — aber nur in der Zukunft', () => {
    const fn = hebeFunktion('setRhythmTarget', DB);
    assert.match(fn, /DELETE FROM rhythm_task WHERE date/, 'es gibt keinen Weg zurück zur Vorlage');
    assert.match(fn, /date > heute/, 'ein vergangener Tag wäre rückwirkend umgeschrieben worden');
    assert.match(fn, /followsRhythm/, 'der Client erfährt nicht, dass die Zeile fort ist');
  });

  it('räumt die Zeile auch im Browser weg, wenn der Server sie gelöscht hat', () => {
    // Sonst verdeckt eine Zeile, die es serverseitig nicht mehr gibt, bis zum
    // nächsten Laden weiter den Rhythmus.
    const fn = hebeFunktion('editRhythmTarget', SRC);
    const zweig = fn.slice(fn.indexOf('followsRhythm'));
    assert.match(zweig, /rhythmTasks\.splice/, 'die abgelegte Ausnahme bleibt im Speicher stehen');
  });

  it('gibt die gesetzte Menge weiterhin zurück, damit die Route sie melden kann', () => {
    const fn = hebeFunktion('setRhythmTarget', DB);
    assert.match(fn, /return \{ targetQty: qty, followsRhythm: (?:true|false) \}/);
    assert.match(quelle('server.js'), /out\.followsRhythm = gesetzt\.followsRhythm/);
  });
});

// ── Einmal pro Spalte, auf jedem Schirm ─────────────────────────────────────
describe('Die Vorgabezahl steht genau einmal da', () => {
  it('markiert die Zahl im Kopf, damit die Breite entscheiden kann', () => {
    const fn = hebeFunktion('_weekHeadHtml', SRC);
    assert.match(fn, /class="wk-h-t"/, 'die Zahl im Kopf ist nicht markiert');
    // Nur die Vorgabezahl. Wo n die Anzahl der Arbeitszeilen ist, wiederholt der
    // Körper sie nirgends, und sie muss auf jedem Schirm stehen bleiben.
    assert.match(fn, /task && task\.targetQty\s*\r?\n?\s*\?\s*'<span class="wk-h-t">/);
  });

  it('blendet sie nur dort aus, wo der Spaltenkörper sie ohnehin zeigt', () => {
    // Über 768px sind alle sieben Körper offen — dort trägt der Körper die Zahl.
    assert.match(CSS, /@media \(min-width: 769px\) \{\s*\.wk-h-t \{\s*display: none;/);
  });

  it('lässt sie auf dem Telefon stehen', () => {
    // Unter 769px zeigen sechs von sieben Tagen nur ihren Kopf (.wk-b wird
    // ausgeblendet). Ohne die Zahl dort waere der Wochenüberblick auf dem Gerät,
    // auf dem die App meistens läuft, eine Reihe blosser Themen.
    assert.doesNotMatch(CSS, /@media \(max-width: 768px\)[\s\S]{0,400}\.wk-h-t \{\s*display: none;/);
    assert.match(
      CSS,
      /@media \(max-width: 768px\) \{\s*\.wk-b \{\s*display: none;/,
      'die Annahme dahinter gilt nicht mehr'
    );
  });

  it('lässt die Fusszeile nicht leer zusammenfallen', () => {
    // Ist die Zahl ausgeblendet und der Tag hat kein Thema, bleibt die Zeile
    // sonst ohne Inhalt und die sieben Spalten bekommen verschiedene Höhen.
    assert.match(hebeFunktion('_weekHeadHtml', SRC), /\(short \? esc\(short\) : '&nbsp;'\)/);
  });
});
