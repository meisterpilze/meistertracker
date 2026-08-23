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

  it('zeigt beim Ändern eines Tages beide Zahlen, benannt', () => {
    // Sonst sind es zwei Zahlen an zwei Stellen ohne sichtbaren Bezug.
    const fn = hebeFunktion('editRhythmTarget', SRC);
    assert.match(fn, /rhythmOf\(/, 'die Vorlage wird gar nicht erst nachgeschlagen');
    assert.match(fn, /dayqty\.planHint/, 'das Plan-Feld sagt nicht, wofür es gilt');
    assert.match(fn, /dayqty\.extraHint/, 'das Extra-Feld sagt nicht, dass es eine Ausnahme ist');
    assert.doesNotMatch(fn, /prompt2\(/, 'die nackte Abfrage ohne Zusammenhang ist zurück');
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
    const fn = hebeFunktion('saveDayQty', SRC);
    const zweig = fn.slice(fn.indexOf('followsRhythm'));
    assert.match(zweig, /rhythmTasks\.splice/, 'die abgelegte Ausnahme bleibt im Speicher stehen');
  });

  it('gibt die gesetzte Menge weiterhin zurück, damit die Route sie melden kann', () => {
    const fn = hebeFunktion('setRhythmTarget', DB);
    assert.match(fn, /return \{ targetQty: qty, followsRhythm: (?:true|false) \}/);
    assert.match(quelle('server.js'), /out\.followsRhythm = gesetzt\.followsRhythm/);
  });
});

// ── Regel und Ausnahme in einem Fenster ─────────────────────────────────────
// Zwei Zahlen ohne Beschriftung sind keine zwei Ebenen, sondern ein
// Widerspruch: wer im Kalender eine 72 sah, konnte nicht wissen, ob sie die
// Regel oder die Ausnahme war, und dass er gerade die Ausnahme setzte, stand
// nirgends. Also beide Felder untereinander, benannt, mit ihrer Summe.
describe('Die Menge eines Tages', () => {
  // _dayQtyValues() liest zwei Felder und den Zustand. Beides lässt sich
  // stellen, ohne ein DOM zu bauen.
  function werte(planFeld, extraFeld, zustand) {
    const felder = { 'dayqty-plan': { value: planFeld }, 'dayqty-extra': { value: extraFeld } };
    const code = hebeFunktion('_dayQtyValues', SRC) + '\nreturn _dayQtyValues();';
    return new Function('document', '_dayQty', code)({ getElementById: (id) => felder[id] || null }, zustand);
  }
  const admin = { plan: 36, darfPlan: true };

  it('addiert Plan und Extra zu dem, was der Tag verlangt', () => {
    assert.equal(werte('36', '36', admin).gesamt, 72);
  });

  it('nimmt ein leeres Extra als "wie immer"', () => {
    const v = werte('36', '', admin);
    assert.equal(v.extra, 0);
    assert.equal(v.gesamt, 36, 'ohne Ausnahme muss der Plan übrig bleiben');
  });

  it('lässt ein Minus zu, für die Woche, in der weniger gebraucht wird', () => {
    assert.equal(werte('36', '-10', admin).gesamt, 26);
  });

  it('fällt nicht unter null', () => {
    // Ein Tag, der -64 verlangt, ist keine Aussage über Arbeit.
    assert.equal(werte('36', '-100', admin).gesamt, 0);
  });

  it('nimmt bei gesperrtem Plan-Feld den gespeicherten Plan, nicht das Feld', () => {
    // Ein deaktiviertes Feld zeigt zwar einen Wert, aber niemand durfte ihn
    // ändern — ihn zu lesen hiesse, eine Änderung anzunehmen, die es nicht gab.
    const v = werte('999', '4', { plan: 36, darfPlan: false });
    assert.equal(v.plan, 36);
    assert.equal(v.gesamt, 40);
  });

  it('macht aus einer angetippten Kommazahl eine ganze', () => {
    assert.equal(werte('36', '2.7', admin).gesamt, 38);
  });

  it('führt das Extra als Differenz, nicht als zweiten gespeicherten Wert', () => {
    // Gespeichert wird eine Zahl je Datum: die Summe. Ein zweiter Wert könnte
    // irgendwann von der ersten abweichen, und dann gäbe es wieder zwei
    // Buchhaltungen über dieselbe Sache.
    assert.match(hebeFunktion('editRhythmTarget', SRC), /ist - plan === 0 \? '' : String\(ist - plan\)/);
    assert.match(hebeFunktion('saveDayQty', SRC), /targetQty: gesamt/);
  });

  it('schreibt erst die Regel, dann die Ausnahme', () => {
    // Der Server prüft die Ausnahme gegen die Vorlage. Ist die Vorlage noch die
    // alte, bliebe ein Tag als Ausnahme stehen, der der neuen Regel entspricht.
    const fn = hebeFunktion('saveDayQty', SRC);
    const plan = fn.indexOf('_saveWeekdayPlan');
    const tag = fn.indexOf("apiPost('/api/rhythm-task'");
    assert.ok(plan > 0 && tag > 0, 'eine der beiden Schreibungen fehlt');
    assert.ok(plan < tag, 'die Ausnahme wird gegen die alte Vorlage geprueft');
  });

  it('bietet niemandem ein Feld an, dessen Speichern der Server ablehnt', () => {
    // /api/week-rhythm ist Admin-Sache, /api/rhythm-task nicht. Dieselbe Grenze
    // muss im Fenster stehen, sonst tippt ein Mitarbeiter eine Zahl ein und
    // bekommt beim Speichern ein 403.
    const auf = hebeFunktion('editRhythmTarget', SRC);
    assert.match(auf, /currentUser && currentUser\.role === 'admin'/);
    assert.match(auf, /fPlan\.disabled = !darfPlan/);
    assert.match(auf, /dayqty\.planLocked/, 'das gesperrte Feld sagt nicht, warum');
    assert.match(hebeFunktion('saveDayQty', SRC), /_dayQty\.darfPlan && plan !== _dayQty\.plan/);
  });

  it('lässt die sechs anderen Wochentage in Ruhe', () => {
    // Die Route nimmt die Woche als Ganzes; nur der bearbeitete Tag darf sich
    // ändern, sonst löscht ein Griff in einen Montag die Mengen der übrigen.
    const fn = hebeFunktion('_saveWeekdayPlan', SRC);
    assert.match(fn, /d === weekday \? qty \|\| null : e\.targetQty/);
    assert.match(fn, /theme: e\.theme/, 'die Themen der anderen Tage gehen verloren');
  });

  it('hat beide Felder samt Beschriftung und Summe im Fenster', () => {
    assert.match(HTML, /id="m-dayqty"/);
    assert.match(HTML, /id="dayqty-plan"[\s\S]{0,40}class="dayqty-in"/);
    assert.match(HTML, /id="dayqty-extra"[\s\S]{0,40}class="dayqty-in"/);
    assert.match(HTML, /data-i18n="dayqty\.plan"/, 'das Plan-Feld ist unbeschriftet');
    assert.match(HTML, /data-i18n="dayqty\.extra"/, 'das Extra-Feld ist unbeschriftet');
    assert.match(HTML, /id="dayqty-sum"/, 'die Summe fehlt, also muss wieder im Kopf addiert werden');
  });

  it('zeigt ein gesperrtes Feld auch als gesperrt', () => {
    assert.match(CSS, /\.dayqty-in:disabled \{[^}]*cursor: not-allowed;/);
  });

  it('gibt den Feldern eine Tippfläche, die auf dem Telefon zu treffen ist', () => {
    // Die allgemeine input-Regel setzt keine Mindesthöhe; 9px Polsterung
    // ergeben rund 36px, und getippt wird hier meistens mit dem Daumen.
    assert.match(CSS, /\.dayqty-in \{[^}]*min-height: var\(--tap-sm\);/);
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
    // Unter 769px zeigt jeder der sieben Tage nur seinen Kopf (.wk-b wird
    // ausgeblendet, der Arbeitszettel steht darunter). Ohne die Zahl dort waere
    // der Wochenüberblick auf dem Gerät, auf dem die App meistens läuft, eine
    // Reihe blosser Themen.
    assert.doesNotMatch(CSS, /@media \(max-width: 768px\)[\s\S]{0,400}\.wk-h-t \{\s*display: none;/);
    assert.match(
      CSS,
      /@media \(max-width: 768px\) \{\s*\.wk-b \{\s*display: none;/,
      'die Annahme dahinter gilt nicht mehr'
    );
  });

  it('steht mit dem Arbeitszettel unter der Woche, nicht in einer Spalte', () => {
    // Eine Spalte ist ein Siebtel der Karte, rund 170px. Der ganze Zettel stand
    // darin: "Black..." statt der Sorte, "0,0 von 10,0" über drei Zeilen, und
    // ein Knopf breiter als die Spalte, die ihn hielt. Auf dem Telefon fiel es
    // nicht auf, weil die Spalte dort über alle sieben ging — zwei Layouts, von
    // denen eines nie jemand angesehen hat.
    const fn = hebeFunktion('renderDashBatchTasks', SRC);
    assert.match(fn, /<div class="wk-open">/, 'der Tag hat keinen eigenen Platz');
    assert.match(fn, /_weekDayBodyHtml\(week\[sel\], sel, sel === 0\)/);
    assert.match(CSS, /\.wk-open \{[^}]*grid-column: 1 \/ -1;/, 'er nimmt nicht die ganze Breite');
    assert.doesNotMatch(CSS, /\.wk-b\.sel \{\s*display: block;/, 'die Spalte klappt wieder selbst auf');
  });

  it('lässt die Spalten reine Übersicht sein', () => {
    // Zweimal derselbe Tag übereinander wäre nur länger.
    const fn = hebeFunktion('_weekColBodyHtml', SRC);
    assert.match(fn, /_weekColPreviewHtml\(d, sel\)/);
    assert.doesNotMatch(fn, /_weekDayBodyHtml/, 'der Zettel steckt wieder in der Spalte');
  });

  it('lässt die Fusszeile nicht leer zusammenfallen', () => {
    // Ist die Zahl ausgeblendet und der Tag hat kein Thema, bleibt die Zeile
    // sonst ohne Inhalt und die sieben Spalten bekommen verschiedene Höhen.
    assert.match(hebeFunktion('_weekHeadHtml', SRC), /\(short \? esc\(short\) : '&nbsp;'\)/);
  });
});

// ── Woche oder Tag ──────────────────────────────────────────────────────────
// Sieben Spalten sind eine Übersicht und ein Kompromiss: jede ist ein Siebtel
// breit, und was darin steht, muss klein sein. Wer den Tag arbeitet, braucht
// die Übersicht gerade nicht — dann fällt sie weg und der Tag bekommt die ganze
// Karte. Kein "besseres" von beiden: am Montagmorgen will man die Woche sehen,
// um halb vier will man wissen, was noch offen ist.
describe('Woche oder Tag', () => {
  it('merkt sich die Wahl über das Neuladen hinweg', () => {
    // Eine Gewohnheit, keine Einstellung, die man täglich neu trifft.
    assert.match(SRC, /localStorage\.getItem\('mp-dash-view'\)/);
    assert.match(hebeFunktion('setDashView', SRC), /localStorage\.setItem\('mp-dash-view'/);
  });

  it('lässt in der Tagesansicht den Wochenstreifen weg', () => {
    const fn = hebeFunktion('renderDashBatchTasks', SRC);
    assert.match(fn, /nurTag\s*\r?\n?\s*\?\s*_dayNavHtml\(week, sel\)/);
  });

  it('gibt dem Tag dann einen anderen Weg zum nächsten', () => {
    // Ohne den Streifen gäbe es sonst gar keinen — man säße auf einem Tag fest.
    const fn = hebeFunktion('_dayNavHtml', SRC);
    assert.match(fn, /data-action="dash-day"/);
    assert.match(fn, /sel <= 0/, 'der Pfeil vor dem ersten Tag zeigt ins Leere');
    assert.match(fn, /sel >= 6/, 'und der hinter dem letzten auch');
  });

  it('steckt den gewonnenen Platz in die Schrift', () => {
    // Der ganze Sinn der Tagesansicht.
    assert.match(CSS, /\.wk\.day-only \.wk-open \.fs-sm\.fs-sm \{\s*font-size: var\(--fs-base\)/);
    assert.match(CSS, /\.wk\.day-only \.wk-open \.fs-xs\.fs-xs \{\s*font-size: var\(--fs-sm\)/);
  });

  it('lässt den Umschalter auch auf einer leeren Woche stehen', () => {
    // Sonst fände man aus einer leeren Tagesansicht nicht zurück zur Woche.
    const fn = hebeFunktion('renderDashBatchTasks', SRC);
    const i = fn.indexOf('dash.noUrgent');
    assert.ok(i > 0, 'der leere Zweig ist fort');
    assert.match(fn.slice(Math.max(0, i - 400), i), /_dashViewToggleHtml/);
  });

  it('gibt den Umschaltknöpfen eine Tippfläche', () => {
    assert.match(CSS, /\.wk-view-btn \{[^}]*min-height: var\(--tap-sm\);/);
  });
});

// ── Die Zählung einer Spalte ────────────────────────────────────────────────
describe('Was in einer Spalte gezählt steht', () => {
  it('öffnet den Tag, wenn man darauf tippt', () => {
    // Vorher totes Papier: "4 Achtung · 4 Ansetzen · 5 überfällig" stand da, man
    // tippte darauf, und nichts geschah. Ein Kasten mit Zahlen darin sieht aus
    // wie etwas zum Aufklappen.
    const fn = hebeFunktion('_weekColPreviewHtml', SRC);
    assert.match(fn, /class="wk-counts fs-xs" data-action="dash-day" data-off="/);
    assert.match(fn, /d\.offset/, 'der Knopf weiß nicht, welchen Tag er öffnen soll');
  });

  it('ist eine antippbare Fläche, kein Knopf', () => {
    // Wie die Mengenzahl darüber: randlos und ohne Füllung.
    assert.match(CSS, /\.wk-counts \{[^}]*border: 0;/);
    assert.match(CSS, /\.wk-counts \{[^}]*background: none;/);
  });

  it('lässt die eigene Aufgabe daneben ihren eigenen Haken behalten', () => {
    // Ein Knopf im Knopf geht nicht, und der Haken darf nicht den Tag öffnen
    // statt abzuhaken.
    const fn = hebeFunktion('_weekColPreviewHtml', SRC);
    const chips = fn.indexOf('_choreChipHtml(c)');
    const knopf = fn.indexOf('wk-counts');
    assert.ok(chips > 0 && knopf > chips, 'die Aufgaben stehen im Zählknopf');
  });
});

describe('Der Tag, der schon offen ist', () => {
  it('bekommt keinen Knopf, den zu drücken nichts täte', () => {
    // Der offene Tag steht ausführlich unter dem Streifen. Seine Zählung dort
    // anzutippen hiess, ihn ein zweites Mal zu öffnen — ein Neuaufbau, der
    // exakt dasselbe zeichnete. Wieder ein Feld, das gedrückt wird und nichts
    // tut, nur diesmal, weil es schon getan war.
    const fn = hebeFunktion('_weekColPreviewHtml', SRC);
    assert.match(fn, /offen\s*\r?\n?\s*\?\s*'<div class="wk-counts fs-xs is-open">/);
    assert.match(
      hebeFunktion('_weekColBodyHtml', SRC),
      /_weekColPreviewHtml\(d, sel\)/,
      'die Vorschau erfährt gar nicht, ob ihr Tag offen ist'
    );
  });

  it('sieht dann auch nicht mehr wie ein Knopf aus', () => {
    // Ein Zeiger und ein Aufleuchten unter der Maus versprechen sonst etwas,
    // das bereits geschehen ist.
    assert.match(CSS, /\.wk-counts\.is-open \{\s*cursor: default;/);
    assert.match(CSS, /\.wk-counts\.is-open:hover \{\s*background: none;/);
  });

  it('behält seine Zählung trotzdem', () => {
    // Ohne sie wäre die Spalte des gearbeiteten Tages die einzige leere.
    const fn = hebeFunktion('_weekColPreviewHtml', SRC);
    assert.match(fn, /if \(zeilen\) \{/);
    assert.doesNotMatch(fn, /if \(offen\) return html;/, 'die offene Spalte fällt leer aus');
  });
});

// ── Gezählt wird Arbeit, nicht Zeilen ───────────────────────────────────────
describe('Was eine Spalte zählt', () => {
  function zaehle(items) {
    const code = [
      hebeKonstante('PLAN_KINDS', SRC),
      hebeFunktion('planKind', SRC),
      hebeFunktion('planCategory', SRC),
      hebeFunktion('planWeight', SRC),
      hebeFunktion('planOverdue', SRC),
      hebeFunktion('countByCategory', SRC)
    ].join('\n');
    return new Function(
      'items',
      code + '\nreturn { counts: countByCategory(items), overdue: items.reduce((n, i) => n + planOverdue(i), 0) };'
    )(items);
  }

  it('zählt die Arbeit, nicht die Zeilen', () => {
    // Die Labor-Zusammenfassung ist EINE Zeile für 38 Posten. Sie zählte als 1,
    // und beim Aufklappen wurden daraus 38 — die Zahl sagte, wie viel gerade
    // gezeichnet ist, statt wie viel ansteht.
    const r = zaehle([{ kind: 'labgroup', weight: 38, overdueWeight: 12 }]);
    assert.equal(r.counts.lab, 38, 'die Spalte sagt weiterhin 1');
    assert.equal(r.overdue, 12, 'und eine überfällige Zeile machte 38 überfällige Posten zu einem');
  });

  it('zählt aufgeklappt nicht doppelt', () => {
    // Dann steht die Zusammenfassung neben den 38 Einzelzeilen, und beide zu
    // zählen ergäbe 76.
    const auf = [{ kind: 'labgroup', weight: 0, overdueWeight: 0 }].concat(
      Array.from({ length: 38 }, (_, i) => ({ kind: 'labmin', overdue: i < 12 }))
    );
    const r = zaehle(auf);
    assert.equal(r.counts.lab, 38);
    assert.equal(r.overdue, 12);
  });

  it('nimmt für alles andere weiter eine Zeile als eine Arbeit', () => {
    const r = zaehle([{ kind: 'supply' }, { kind: 'supply' }, { kind: 'harvest', overdue: true }]);
    assert.equal(r.counts.create, 2);
    assert.equal(r.counts.harvest, 1);
    assert.equal(r.overdue, 1);
  });

  it('holt das Gewicht der Zusammenfassung aus ihrer Zeilenzahl', () => {
    const fn = hebeFunktion('buildWeekPlan', SRC);
    assert.match(fn, /weight: dashLabGroupOpen \? 0 : laborMin\.length/);
    assert.match(fn, /overdueWeight: dashLabGroupOpen \? 0 : laborMin\.filter\(\(l\) => l\.empty\)\.length/);
  });

  it('nennt im Spaltenkopf dieselbe Zahl', () => {
    // Sonst stünde oben "1" und zwei Zeilen darunter "38".
    assert.match(hebeFunktion('_weekHeadHtml', SRC), /d\.items\.reduce\(\(k, it\) => k \+ planWeight\(it\), 0\)/);
  });
});
