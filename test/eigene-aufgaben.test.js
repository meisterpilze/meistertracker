'use strict';
// Was regelmäßig ansteht und keine Buchung hinterlässt.
//
// Der Wochenrhythmus zählt Produktion und kann nur, was eine Buchung
// hinterlässt: Chargen sind Chargen, Körnerbrut sind Gläser. Das ist seine
// Stärke und zugleich seine Grenze — "alle zwei Wochen die Growrooms putzen"
// ist ebenso wiederkehrende Arbeit, hinterlässt aber nichts, woraus sich
// "gemacht" ableiten liesse.
//
// Ein festes Thema dafür zu erfinden hiesse, beim nächsten Einfall wieder eines
// zu erfinden. Also stehen daneben Aufgaben, die die Anlage selbst benennt,
// selbst taktet und selbst abhakt — und diese Datei hält fest, dass das eine
// Ausnahme mit Grund bleibt und keine Hintertür:
//
//   – abgehakt wird nur ein Datum, an dem die Aufgabe wirklich fällt;
//   – ein Haken zählt im Fortschritt mit, sonst wüchse nur der Nenner;
//   – versäumt wird höchstens ein Termin je Aufgabe nachgetragen;
//   – anlegen darf ein Admin, abhaken jeder, der die Arbeit tut.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { quelle, hebe, hebeFunktion, hebeKonstante } = require('./helpers/quelle');
const db = require('../db.js');

const SRC = quelle('app.js');
const DB = quelle('db.js');
const CSS = quelle('styles.css');
const HTML = quelle('index.html');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_recur_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

// Die Browser-Fassung, mit einem gestellten Aufgabenbestand.
function browser(tasks) {
  const code =
    hebe([[/^const RECURRING_LOOKBACK_DAYS = \d+;$/m, 'RECURRING_LOOKBACK_DAYS']], SRC) +
    '\n' +
    hebeFunktion('addDays', SRC) +
    '\n' +
    hebeFunktion('_ymd', SRC) +
    '\n' +
    hebeFunktion('recurringDueOn', SRC) +
    '\n' +
    hebeFunktion('recurringDoneOn', SRC) +
    '\n' +
    hebeFunktion('recurringOn', SRC) +
    '\n' +
    hebeFunktion('recurringArrears', SRC) +
    '\nreturn { recurringDueOn, recurringOn, recurringArrears };';
  return new Function('recurringTasks', code)(tasks);
}

const putzen = (extra) =>
  Object.assign(
    { id: 1, name: 'Growrooms putzen', everyWeeks: 2, anchor: '2026-08-24', active: true, done: [] },
    extra
  );

describe('Wann eine eigene Aufgabe fällt', () => {
  const { recurringDueOn } = browser([]);

  it('fällt am Anker und dann im eingestellten Takt', () => {
    assert.equal(recurringDueOn('2026-08-24', 2, '2026-08-24'), true, 'der Anker selbst ist ein Termin');
    assert.equal(recurringDueOn('2026-08-24', 2, '2026-09-07'), true);
    assert.equal(recurringDueOn('2026-08-24', 2, '2026-09-21'), true);
  });

  it('fällt in der Woche dazwischen nicht', () => {
    assert.equal(recurringDueOn('2026-08-24', 2, '2026-08-31'), false);
    assert.equal(recurringDueOn('2026-08-24', 2, '2026-09-14'), false);
  });

  it('fällt an keinem anderen Wochentag', () => {
    // Der Wochentag steckt im Anker. Ein zweites Feld dafür wäre eine zweite
    // Wahrheit, die ihm widersprechen könnte.
    assert.equal(recurringDueOn('2026-08-24', 2, '2026-08-25'), false);
    assert.equal(recurringDueOn('2026-08-24', 1, '2026-08-25'), false);
  });

  it('fällt vor dem Anker nie', () => {
    // Eine heute angelegte Aufgabe hat nicht rückwirkend seit Januar gefehlt.
    assert.equal(recurringDueOn('2026-08-24', 2, '2026-08-10'), false);
    assert.equal(recurringDueOn('2026-08-24', 2, '2026-08-23'), false);
  });

  it('stolpert nicht über die Zeitumstellung', () => {
    // Ende Oktober hat eine Woche 169 Stunden. In Ortszeit gerechnet wären das
    // 7,04 Tage, und der Termin fiele aus.
    assert.equal(recurringDueOn('2026-10-19', 1, '2026-10-26'), true, 'die Woche der Umstellung');
    assert.equal(recurringDueOn('2026-10-19', 2, '2026-11-02'), true);
    assert.equal(recurringDueOn('2026-03-23', 1, '2026-03-30'), true, 'und die im Frühjahr');
  });

  it('sagt dasselbe wie der Server', () => {
    // Zwei Fassungen derselben Regel: der Server prüft, der Browser zeichnet.
    // Gingen sie auseinander, böte die App einen Haken an, den der Server
    // ablehnt — oder verschwiege einen Termin, den er kennt.
    const serverDue = new Function(hebeFunktion('recurringDueOn', DB) + '\nreturn recurringDueOn;')();
    const start = Date.UTC(2026, 7, 1);
    let geprueft = 0;
    for (const takt of [1, 2, 3, 4]) {
      for (let i = 0; i < 120; i++) {
        const tag = new Date(start + i * 864e5).toISOString().slice(0, 10);
        assert.equal(
          recurringDueOn('2026-08-24', takt, tag),
          serverDue('2026-08-24', takt, tag),
          'Browser und Server uneinig über ' + tag + ' bei Takt ' + takt
        );
        geprueft++;
      }
    }
    assert.equal(geprueft, 480, 'der Vergleich hat gar nicht stattgefunden');
  });

  it('nimmt keinen unsinnigen Takt', () => {
    assert.equal(recurringDueOn('2026-08-24', 0, '2026-08-24'), false);
    assert.equal(recurringDueOn('2026-08-24', 1.5, '2026-08-24'), false);
    assert.equal(recurringDueOn('', 2, '2026-08-24'), false);
  });
});

describe('Was an einem Tag ansteht', () => {
  it('nennt die fällige Aufgabe samt Stand des Hakens', () => {
    const { recurringOn } = browser([putzen({ done: ['2026-09-07'] })]);
    assert.deepEqual(
      recurringOn('2026-09-07').map((x) => [x.task.name, x.done]),
      [['Growrooms putzen', true]]
    );
    assert.deepEqual(
      recurringOn('2026-08-24').map((x) => x.done),
      [false]
    );
    assert.deepEqual(recurringOn('2026-08-31'), []);
  });

  it('lässt eine stillgelegte Aufgabe aus', () => {
    assert.deepEqual(browser([putzen({ active: false })]).recurringOn('2026-08-24'), []);
  });
});

describe('Versäumte Termine', () => {
  const heute = (s) => new Date(s + 'T00:00:00');

  it('trägt den versäumten Termin nach', () => {
    const { recurringArrears } = browser([putzen()]);
    assert.deepEqual(
      recurringArrears(heute('2026-08-26')).map((x) => x.date),
      ['2026-08-24']
    );
  });

  it('trägt nichts nach, wenn abgehakt wurde', () => {
    const { recurringArrears } = browser([putzen({ done: ['2026-08-24'] })]);
    assert.deepEqual(recurringArrears(heute('2026-08-26')), []);
  });

  it('trägt je Aufgabe höchstens einen Termin nach, und zwar den jüngsten', () => {
    // Wer zweimal nicht geputzt hat, putzt einmal und ist wieder aktuell. Drei
    // offene Putztermine nebeneinander wären eine Liste, die niemand abarbeitet
    // und die deshalb keiner mehr liest.
    const { recurringArrears } = browser([putzen()]);
    const offen = recurringArrears(heute('2026-09-20'));
    assert.equal(offen.length, 1, 'es standen ' + offen.length + ' Termine offen');
    assert.equal(offen[0].date, '2026-09-07', 'nachgetragen wurde ' + offen[0].date);
  });

  it('geht nie hinter den Anker zurück', () => {
    const { recurringArrears } = browser([putzen({ anchor: '2026-08-24' })]);
    assert.deepEqual(recurringArrears(heute('2026-08-24')), [], 'der Anker selbst ist noch nicht versäumt');
  });

  it('findet auch bei langem Takt den letzten Termin', () => {
    // Zwölf Wochen liegen weit ausserhalb der vierzehn Tage, die der Rhythmus
    // zurückschaut; die Rückschau muss mit dem Takt mitwachsen.
    const { recurringArrears } = browser([putzen({ everyWeeks: 12, anchor: '2026-05-04' })]);
    assert.deepEqual(
      recurringArrears(heute('2026-08-20')).map((x) => x.date),
      ['2026-07-27']
    );
  });

  it('lässt eine stillgelegte Aufgabe aus', () => {
    assert.deepEqual(browser([putzen({ active: false })]).recurringArrears(heute('2026-09-20')), []);
  });
});

describe('Der Haken', () => {
  it('geht nur auf ein Datum, an dem die Aufgabe wirklich fällt', () => {
    // Ohne diese Prüfung liesse sich ein beliebiger Tag abhaken, und die
    // Rückstandsrechnung fände Haken auf Tagen, die sie gar nicht kennt.
    const { db: d, path: p } = tmpDb();
    try {
      const id = db.saveRecurringTask(d, { name: 'Growrooms putzen', everyWeeks: 2, anchor: '2026-08-24' });
      assert.equal(db.setRecurringDone(d, id, '2026-09-07', true, 'jonas'), true);
      assert.throws(() => db.setRecurringDone(d, id, '2026-08-31', true, 'jonas'), /Not a due date/);
      assert.throws(() => db.setRecurringDone(d, id, '2026-08-17', true, 'jonas'), /Not a due date/);
      assert.throws(() => db.setRecurringDone(d, 999, '2026-09-07', true, 'jonas'), /No such task/);
      assert.deepEqual(db.listRecurringTasks(d, new Date('2026-09-10'))[0].done, ['2026-09-07']);
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });

  it('lässt sich zurücknehmen und verträgt zweimal Tippen', () => {
    const { db: d, path: p } = tmpDb();
    try {
      const id = db.saveRecurringTask(d, { name: 'Filter wechseln', everyWeeks: 4, anchor: '2026-08-24' });
      db.setRecurringDone(d, id, '2026-08-24', true, 'a');
      db.setRecurringDone(d, id, '2026-08-24', true, 'a');
      assert.deepEqual(db.listRecurringTasks(d, new Date('2026-08-26'))[0].done, ['2026-08-24'], 'doppelt gehakt');
      db.setRecurringDone(d, id, '2026-08-24', false, 'a');
      assert.deepEqual(db.listRecurringTasks(d, new Date('2026-08-26'))[0].done, []);
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });

  it('verschwindet mit der Aufgabe', () => {
    const { db: d, path: p } = tmpDb();
    try {
      const id = db.saveRecurringTask(d, { name: 'Putzen', everyWeeks: 1, anchor: '2026-08-24' });
      db.setRecurringDone(d, id, '2026-08-24', true, 'a');
      db.deleteRecurringTask(d, id);
      assert.deepEqual(db.listRecurringTasks(d, new Date('2026-08-26')), []);
      const rest = d.prepare('SELECT COUNT(*) n FROM recurring_done').get();
      assert.equal(rest.n, 0, 'die Haken zeigen jetzt auf niemanden mehr');
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });

  it('nimmt nur eine benannte Aufgabe mit plausiblem Takt an', () => {
    const { db: d, path: p } = tmpDb();
    try {
      assert.throws(() => db.saveRecurringTask(d, { name: '  ', everyWeeks: 1, anchor: '2026-08-24' }), /name/);
      assert.throws(() => db.saveRecurringTask(d, { name: 'x', everyWeeks: 0, anchor: '2026-08-24' }), /Interval/);
      assert.throws(() => db.saveRecurringTask(d, { name: 'x', everyWeeks: 53, anchor: '2026-08-24' }), /Interval/);
      assert.throws(() => db.saveRecurringTask(d, { name: 'x', everyWeeks: 2.5, anchor: '2026-08-24' }), /Interval/);
      assert.throws(() => db.saveRecurringTask(d, { name: 'x', everyWeeks: 1, anchor: 'Montag' }), /Not a date/);
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });
});

describe('Wer was darf', () => {
  const SERVER = quelle('server.js');
  function route(muster) {
    const i = SERVER.indexOf(muster);
    assert.ok(i > 0, 'Route nicht gefunden: ' + muster);
    const rest = SERVER.slice(i);
    const ende = rest.indexOf('\n  if (req.method', 1);
    return ende === -1 ? rest : rest.slice(0, ende);
  }

  it('verlangt einen Admin für das Anlegen und Löschen', () => {
    // Eine wiederkehrende Aufgabe anzulegen ist eine Festlegung für alle und
    // fortan — dieselbe Grenze wie beim Wochenrhythmus.
    assert.match(route("req.url === '/api/recurring-task'"), /requireAdmin/);
    assert.match(route("req.method === 'DELETE' && recurringDelMatch"), /requireAdmin/);
  });

  it('lässt jeden Angemeldeten abhaken', () => {
    // Dass etwas getan wurde, meldet, wer es getan hat.
    assert.doesNotMatch(route("req.url === '/api/recurring-done'"), /requireAdmin/);
  });

  it('zeigt die Verwaltung nur dem, der sie auch speichern darf', () => {
    // Ein Feld anzubieten, dessen Speichern mit 403 zurückkommt, ist schlimmer
    // als keins.
    const fn = hebeFunktion('_renderRhythmOwn', SRC);
    assert.match(fn, /currentUser && currentUser\.role === 'admin'/);
    assert.match(fn, /el\.hidden = !admin/);
  });
});

describe('Wie eine eigene Aufgabe im Tagesplan steht', () => {
  it('steht in PLAN_KINDS und überlebt die Klappe', () => {
    const kinds = hebeKonstante('PLAN_KINDS', SRC);
    assert.match(kinds, /chore: \{ cat: 'chore', rank: -0\.5, counts: true, btn: 'chore' \}/);
    // Eigene Kategorie, nicht 'other': "Sonstiges" ist kein Name fuer "Growrooms
    // putzen", und genau das stand ueber der Zeile, die man abhaken soll.
    //
    // rank -0.5, weil eine eigene Aufgabe keine Zone hat: ohne eigenen Rang
    // fiele sie auf 999 und waere als Erstes von der Sechs-Zeilen-Klappe
    // verdeckt. Sie ist aber die einzige Zeile des Tages, an die nichts anderes
    // erinnert -- eine fehlende Charge faellt spaeter im Bestand auf, ein
    // ungeputzter Raum niemandem.
    const cats = new Function(hebeKonstante('PLAN_CATS', SRC) + String.fromCharCode(10) + 'return PLAN_CATS;')();
    assert.ok(cats.includes('chore'), 'die Kategorie steht in keiner PLAN_CATS');
  });

  it('zählt einen abgehakten Termin genau einmal', () => {
    // Zweimal war der Fehler: counts:true liess den Nenner wachsen, und die
    // Gegenzeile addierte den Haken im Zaehler — total ist done + countable,
    // also stand ein erledigter Termin auf beiden Seiten und der Balken kam nie
    // auf 100%. Vorher wurde hier nur die Zeile `done++` im Quelltext gesucht,
    // was zu genau dieser falschen Zahl passte.
    const fortschritt = (items) => {
      const code = [
        hebeKonstante('PLAN_KINDS', SRC),
        hebeFunktion('planKind', SRC),
        hebeFunktion('todayProgress', SRC)
      ].join('\n');
      return new Function(
        'todayItems',
        'scanLog',
        'harvests',
        'manualTasks',
        'ZONE_BY_ID',
        'toZone',
        code + '\nreturn todayProgress(todayItems);'
      )(items, [], [], [], {}, (x) => x);
    };
    assert.deepEqual(fortschritt([{ kind: 'chore', done: false }]), { done: 0, total: 1 }, 'offen');
    assert.deepEqual(fortschritt([{ kind: 'chore', done: true }]), { done: 1, total: 1 }, 'erledigt muss 1/1 sein');
    assert.deepEqual(
      fortschritt([
        { kind: 'chore', done: true },
        { kind: 'chore', done: false }
      ]),
      { done: 1, total: 2 },
      'einer von zweien'
    );
  });

  it('bietet einen Haken an und einen Weg zurück', () => {
    const fn = hebeFunktion('_planBtn', SRC);
    const zweig = fn.slice(fn.indexOf("it.kind === 'chore'"));
    assert.match(zweig, /data-action="chore-done"/);
    assert.match(zweig, /recur\.undo/, 'ein Fehltipp lässt sich nicht zurücknehmen');
    assert.doesNotMatch(
      zweig.slice(0, zweig.indexOf('</button>')),
      /confirm/i,
      'eine Rückfrage ist teurer als der Fehler'
    );
  });

  it('steht in der Wochenspalte mit Namen, nicht als Zahl in einer Kategorie', () => {
    // "1 Sonstiges" sagt über "Growrooms putzen" gar nichts, und genau das
    // stand da. Die Zählung ist richtig für vier abgeschnittene Chargennummern
    // in 170px; bei einer benannten Aufgabe ist der Name die ganze Auskunft.
    const fn = hebeFunktion('_weekColPreviewHtml', SRC);
    assert.match(fn, /_choreChipHtml\(c\)/, 'die Aufgabe steht nicht mit Namen da');
    assert.match(fn, /countByCategory\(rest\)/, 'sie wird zusätzlich noch mitgezählt');
  });

  it('lässt sich aus der Wochenspalte heraus abhaken', () => {
    // Der Umweg über den geöffneten Tag wäre ein Umweg um einen einzigen Tipp.
    const chip = hebeFunktion('_choreChipHtml', SRC);
    assert.match(chip, /data-action="chore-done"/);
    assert.match(chip, /wk-chore-name/);
  });

  it('ist dabei eine antippbare Zeile, kein breitgetretener Knopf', () => {
    // Randlos und ohne Fläche, wie die Mengenzahl zwei Zeilen darüber.
    assert.match(CSS, /\.wk-chore \{[^}]*border: 0;/);
    assert.match(CSS, /\.wk-chore \{[^}]*background: none;/);
  });

  it('trägt den versäumten Termin auf heute, mit seinem eigenen Datum', () => {
    // "Wenn Montag nicht geputzt wird, muss es Dienstag noch dastehen, bis es
    // abgehakt ist" — und zwar als Dienstagszeile, die sagt, von wann sie ist.
    const fn = hebeFunktion('buildWeekPlan', SRC);
    const zweig = fn.slice(fn.indexOf('recurringArrears('));
    assert.match(zweig, /put\(0, \{/, 'der versäumte Termin landet nicht auf heute');
    assert.match(zweig, /recur\.missedFrom/, 'er sagt nicht, von wann er offen ist');
    assert.match(zweig, /overdue: true/, 'er sieht aus wie ein Termin, der noch Zeit hat');
  });

  it('zeigt einen versäumten Termin rot, wie jede überfällige Zeile', () => {
    assert.match(hebeFunktion('_choreChipHtml', SRC), /it\.overdue \? ' late' : ''/);
    assert.match(CSS, /\.wk-chore\.late \{[^}]*border-left-color: var\(--c-red-dark\)/);
  });

  it('setzt den Anker auf den nächsten Termin, nicht auf heute', () => {
    // Sonst hinge der Wochentag davon ab, an welchem Tag jemand die Aufgabe
    // angelegt hat.
    const fn = hebeFunktion('addOwnTask', SRC);
    assert.match(fn, /\(wd - heute\.getDay\(\) \+ 7\) % 7/);
    assert.match(fn, /everyWeeks: every/);
  });
});

describe('Auf dem Telefon', () => {
  it('bricht die Eingabezeile um, statt vier Felder zu quetschen', () => {
    // 375px minus Fensterrand sind rund 300px. Name, Takt, Wochentag und Knopf
    // nebeneinander wären vier unlesbare Stummel.
    assert.match(CSS, /\.rhythm-own-add \{[^}]*flex-wrap: wrap;/);
    assert.match(CSS, /\.rhythm-own-add input \{[^}]*flex: 1 1 100%;/, 'der Name teilt sich die Zeile');
  });

  it('unterbietet die allgemeine Feldhöhe nicht', () => {
    // Hier stand `min-height: var(--tap-sm)` als vermeintlich größere
    // Tippfläche. Die allgemeine input-Regel setzt aber schon 64px, und eine
    // Klasse schlägt den Elementselektor — die Zeile machte die Felder also
    // KLEINER, auf 48px am Telefon und rund 39px am Rechner.
    assert.match(
      CSS,
      /^input,\s*\r?\nselect,\s*\r?\ntextarea \{[^}]*min-height: 64px;/m,
      'die allgemeine Höhe ist fort'
    );
    for (const regel of ['\\.rhythm-own-add input', '\\.rhythm-own-add select', '\\.dayqty-in']) {
      assert.doesNotMatch(
        CSS,
        new RegExp(regel + ' \\{[^}]*min-height:'),
        regel + ' setzt wieder eine eigene Mindesthöhe und unterbietet damit die 64px'
      );
    }
  });

  it('hat einen Platz im Rhythmus-Fenster', () => {
    assert.match(HTML, /id="rhythm-own"/);
    assert.match(hebeFunktion('_renderRhythmOwn', SRC), /getElementById\('rhythm-own'\)/);
  });
});

// ── Die Naht zwischen Server und Browser ────────────────────────────────────
// Jeder Test oben stellt entweder den Server oder den Browser — und der
// schlimmste Fehler dieser Funktion lag genau dazwischen: der Server lieferte
// 60 Tage Haken, der Browser suchte bis zu 84 Tage zurück. Ein Termin, der
// abgehakt WAR, kam ohne seinen Haken an und stand als versäumt da; nochmal
// abzuhaken half nicht, weil der Haken auf demselben Datum landete, das
// weiterhin ausserhalb des Fensters lag. Eine rote Zeile, die sich nicht
// wegdrücken liess.
//
// Diese Tests bauen die Aufgabe durch die echten db-Funktionen, reichen genau
// das an den Browser weiter, was listRecurringTasks liefert, und fragen ihn.
describe('Was der Server liefert, reicht dem Browser', () => {
  function durchgereicht(d, now) {
    const code =
      hebe([[/^const RECURRING_LOOKBACK_DAYS = \d+;$/m, 'RECURRING_LOOKBACK_DAYS']], SRC) +
      '\n' +
      hebeFunktion('addDays', SRC) +
      '\n' +
      hebeFunktion('_ymd', SRC) +
      '\n' +
      hebeFunktion('recurringDueOn', SRC) +
      '\n' +
      hebeFunktion('recurringDoneOn', SRC) +
      '\n' +
      hebeFunktion('recurringArrears', SRC) +
      '\nreturn recurringArrears;';
    return new Function('recurringTasks', code)(db.listRecurringTasks(d, now));
  }

  for (const wochen of [1, 4, 8, 12, 26, 52]) {
    it('behält den Haken einer ' + wochen + '-Wochen-Aufgabe bis zum nächsten Termin', () => {
      const { db: d, path: p } = tmpDb();
      try {
        // Der letzte Termin liegt einen vollen Takt zurück und wurde erledigt.
        const heute = new Date('2026-08-23T00:00:00');
        const anker = new Date(heute);
        anker.setDate(anker.getDate() - 7 * wochen);
        // Ortszeit, nicht toISOString(): das rechnet nach UTC um und liefert
        // östlich von Greenwich den Vortag — derselbe Fehler eine Ebene höher,
        // und er hätte diesen Test grün-falsch gemacht.
        const p2 = (n) => String(n).padStart(2, '0');
        const ymd = (x) => x.getFullYear() + '-' + p2(x.getMonth() + 1) + '-' + p2(x.getDate());
        const id = db.saveRecurringTask(d, { name: 'Filter wechseln', everyWeeks: wochen, anchor: ymd(anker) });
        db.setRecurringDone(d, id, ymd(anker), true, 'jonas');
        const offen = durchgereicht(d, heute)(heute);
        assert.deepEqual(
          offen.map((x) => x.date),
          [],
          'erledigt, aber der Browser meldet es als versäumt: ' + JSON.stringify(offen.map((x) => x.date))
        );
      } finally {
        d.close();
        fs.unlinkSync(p);
      }
    });
  }

  it('meldet einen wirklich versäumten Termin weiterhin', () => {
    // Die Gegenprobe: ohne sie könnte das Fenster alles verschlucken und die
    // Tests oben wären trotzdem grün.
    const { db: d, path: p } = tmpDb();
    try {
      // Anker 30.05., alle 12 Wochen: der Termin fiel am 22.08. und wurde
      // nicht abgehakt. Heute ist der 23.08., also kein Termin — sonst stünde
      // die Aufgabe ohnehin schon in der Tagesliste und der Rückstand entfiele.
      const heute = new Date('2026-08-23T00:00:00');
      db.saveRecurringTask(d, { name: 'Filter wechseln', everyWeeks: 12, anchor: '2026-05-30' });
      assert.deepEqual(
        durchgereicht(d, heute)(heute).map((x) => x.date),
        ['2026-08-22']
      );
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });

  it('lässt einen Haken auch nach einem Ankerwechsel wieder entfernen', () => {
    // Die Fälligkeitsprüfung stand vor beiden Zweigen, also war eine Zeile
    // unlöschbar, sobald Takt oder Anker verschoben worden waren — und tauchte
    // als "schon erledigt" wieder auf, wenn jemand den Anker zurücksetzte.
    const { db: d, path: p } = tmpDb();
    try {
      const id = db.saveRecurringTask(d, { name: 'Putzen', everyWeeks: 2, anchor: '2026-08-24' });
      db.setRecurringDone(d, id, '2026-08-24', true, 'a');
      db.saveRecurringTask(d, { id, name: 'Putzen', everyWeeks: 3, anchor: '2026-08-25' });
      db.setRecurringDone(d, id, '2026-08-24', false, 'a');
      assert.deepEqual(db.listRecurringTasks(d, new Date('2026-08-26'))[0].done, []);
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });

  it('zeigt einen heute fälligen Termin einmal, nicht zweimal', () => {
    // Fällt die Aufgabe heute ohnehin an, steht sie schon in der Tagesliste.
    // Den versäumten Termin daneben zu setzen hiess: zwei Zeilen mit zwei
    // Haken für einmal Putzen — und wer einmal putzt, ist wieder aktuell.
    const { recurringArrears } = browser([
      { id: 1, name: 'Putzen', everyWeeks: 1, anchor: '2026-08-10', active: true, done: [] }
    ]);
    assert.deepEqual(recurringArrears(new Date('2026-08-24T00:00:00')), [], 'heute fällig UND als versäumt gemeldet');
    // An einem Tag, an dem sie nicht fällt, bleibt der Rückstand stehen.
    assert.deepEqual(
      recurringArrears(new Date('2026-08-25T00:00:00')).map((x) => x.date),
      ['2026-08-24']
    );
  });
});
