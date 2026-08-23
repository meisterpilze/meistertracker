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
    assert.match(kinds, /chore: \{ cat: 'other', rank: 50, counts: true, btn: 'chore' \}/);
    // rank 50, weil eine eigene Aufgabe keine Zone hat: ohne eigenen Rang fiele
    // sie auf 999 und wäre als Erstes von der Sechs-Zeilen-Klappe verdeckt — an
    // einem Putztag ist sie aber genau das, was ansteht.
  });

  it('zählt den Haken im Fortschritt mit, nicht nur im Nenner', () => {
    // counts:true lässt den Nenner wachsen. Ohne die Gegenseite läse ein
    // fertiger Tag 7/8 — derselbe Fehler, den die abgeleiteten Zeilen schon
    // einmal verursacht haben, nur von der anderen Seite.
    const fn = hebeFunktion('todayProgress', SRC);
    assert.match(fn, /it\.kind === 'chore' && it\.done.*done\+\+/s);
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

  it('gibt den Feldern eine Tippfläche', () => {
    assert.match(CSS, /\.rhythm-own-add input \{[^}]*min-height: var\(--tap-sm\);/);
    assert.match(CSS, /\.rhythm-own-add select \{[^}]*min-height: var\(--tap-sm\);/);
  });

  it('hat einen Platz im Rhythmus-Fenster', () => {
    assert.match(HTML, /id="rhythm-own"/);
    assert.match(hebeFunktion('_renderRhythmOwn', SRC), /getElementById\('rhythm-own'\)/);
  });
});
