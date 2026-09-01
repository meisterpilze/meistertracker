'use strict';
// Der Schalter in der Benutzertabelle, und warum er kein Ankreuzfeld mehr ist.
//
// Die beiden Spalten „Versand" und „Freigabe" trugen ein natives Ankreuzfeld,
// und das erbte die globale `input`-Regel: `width: 100%`, `min-height: 64px`,
// also 202 x 64 px um ein Häkchen von 13 px (Befund T8). Es auf Fingergröße zu
// setzen behebt das nicht, es macht einen ordentlicheren Klotz — ein
// Ankreuzfeld mit `appearance: auto` malt über seinen Polsterkasten, seine
// Trefferfläche ist also immer genau so groß wie sein Bild.
//
// Julian hat am 25.08.2026 den Schalter gewählt. Er ist weiterhin ein echtes
// `input[type=checkbox]`; nur gezeichnet wird er selbst, und selbst gezeichnet
// lassen sich Fläche und Bild trennen.
//
// Diese Datei hält die Teile zusammen, die einzeln stillschweigend versagen.
// Beide Maschinen bestätigen das Verfahren (neubau/theme-pruefung/mobil/
// maschinen im privaten Repo, Merkmale `schalter-*`); was hier geprüft wird,
// ist, dass die Regel selbst zusammenbleibt.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle } = require('./helpers/quelle');

const css = quelle('styles.css');
const app = quelle('app.js');

const REGEL = css.match(/\.us-tab input\[type='checkbox'\] \{[\s\S]*?\n\}/);

describe('der Schalter', () => {
  it('steht überhaupt im Blatt', () => {
    assert.ok(REGEL, ".us-tab input[type='checkbox'] nicht gefunden");
  });

  it('zeichnet sich selbst, in beiden Schreibweisen', () => {
    // Ohne die Präfix-Zeile bleibt es in älterem WebKit ein Ankreuzfeld, und
    // dann ist der ganze Rest eine Regel über ein Element, das es nicht gibt.
    assert.match(REGEL[0], /\n\s*appearance: none;/);
    assert.match(REGEL[0], /-webkit-appearance: none;/);
  });

  it('leitet die durchsichtigen Ränder aus derselben Höhe ab wie die Fläche', () => {
    // Das ist die Stelle, an der eine spätere Änderung leise danebengeht: Wer
    // die Höhe anfasst und die Ränder vergisst, bekommt eine Pille, die nicht
    // mehr mittig sitzt, und nichts meldet es.
    const hoehe = REGEL[0].match(/height: (max\(28px, var\(--tap-sm-min\)\));/);
    assert.ok(hoehe, 'die Höhe folgt nicht mehr max(28px, var(--tap-sm-min))');
    for (const seite of ['top', 'bottom']) {
      const re = new RegExp(`border-${seite}-width: calc\\(\\(max\\(28px, var\\(--tap-sm-min\\)\\) - 28px\\) / 2\\);`);
      assert.match(REGEL[0], re, `border-${seite}-width leitet sich nicht aus derselben Höhe ab`);
    }
  });

  it('hält die Farbe im Polsterkasten', () => {
    // Ohne diese Zeile läuft der Hintergrund bis in den Randbereich, und aus
    // der 28px-Pille wird wieder ein 48px-Klotz. Es sieht dann aus wie vorher,
    // und keine Messung sagt etwas dazu.
    assert.match(REGEL[0], /background-clip: padding-box;/);
  });

  it('bleibt über beiden Böden, ohne dass das Bild mitwächst', () => {
    // 44px in der Hand (WCAG 2.5.5), 24px mit der Maus (2.5.8, Stufe AA).
    // --tap-sm-min ist 48 bzw. 24, und 28 ist die Pille. Also: 48 und 28.
    assert.match(REGEL[0], /height: max\(28px, var\(--tap-sm-min\)\);/);
    assert.doesNotMatch(REGEL[0], /min-height: 64px/);
  });

  it('bewegt den Knopf über den Hintergrund und nicht über ein Pseudoelement', () => {
    // Ein `input` ist ein ersetztes Element. Dass Chrome dort ::before zeichnet,
    // sobald appearance:none gesetzt ist, gilt für WebKit nicht verlässlich,
    // und Julian arbeitet in Safari.
    assert.match(REGEL[0], /background-image: radial-gradient/);
    assert.doesNotMatch(css, /\.us-tab input\[type='checkbox'\]::(before|after)/);
    const an = css.match(/\.us-tab input\[type='checkbox'\]:checked \{[\s\S]*?\n\}/);
    assert.ok(an, 'der eingeschaltete Zustand fehlt');
    assert.match(an[0], /background-position: 22px 0;/);
    assert.match(REGEL[0], /background-position: 0 0;/);
  });

  it('sagt auch gesperrt noch, was wahr ist', () => {
    // Admins dürfen immer, das Feld ist `disabled`. Gedämpft und nicht
    // ausgegraut: der Zustand soll ablesbar bleiben.
    const aus = css.match(/\.us-tab input\[type='checkbox'\]:disabled \{[\s\S]*?\n\}/);
    assert.ok(aus, 'der gesperrte Zustand fehlt');
    assert.match(aus[0], /opacity: 0\.5;/);
  });

  it('bleibt mit der Tastatur sichtbar', () => {
    assert.match(css, /\.us-tab input\[type='checkbox'\]:focus-visible \{/);
  });
});

describe('das Element darunter', () => {
  it('ist weiter ein echtes Ankreuzfeld, kein Knopf mit Rolle', () => {
    // Der Klick-Auswerter in app.js liest `.checked`, der Server bekommt einen
    // Wahrheitswert, und ein Vorleseprogramm sagt „Kontrollkästchen, aktiviert".
    // Ein nachgebauter Schalter aus <div> und aria-checked müsste all das
    // wiederherstellen, und keine Prüfung hier würde merken, wenn er es nicht
    // täte.
    assert.match(app, /data-action="toggle-ship"/);
    assert.match(app, /data-action="toggle-release"/);
    assert.match(app, /<input type="checkbox" data-action="toggle-ship"/);
    assert.match(app, /<input type="checkbox" data-action="toggle-release"/);
  });
});
