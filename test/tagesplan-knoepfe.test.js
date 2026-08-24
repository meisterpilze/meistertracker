'use strict';
// Was die Knöpfe der Tagesliste mitgeben — und ob der Empfänger es lesen kann.
//
// Beide Knöpfe, die dieser Umbau neu gebaut hat, waren zu hundert Prozent tot.
// _planBtn() schrieb den ANZEIGENAMEN der Sorte in data-sorte, der Handler löst
// ihn mit _strainByKey() auf, und das trifft nur 'id:3' oder 'n:shiitake'. Jeder
// Druck endete in "Diese Sorte steht nicht in den Pilzsorten" — über einer
// Sorte, die dort stehen MUSS, sonst hätte buildSupplyTasks() die Zeile gar
// nicht erst gebaut.
//
// Gesehen hat das kein Test, weil keiner _planBtn je aufgerufen hat. Dieser
// prüft darum nicht die Zeichenkette, sondern den Rundlauf: was der Knopf
// schreibt, muss der Auflöser wiederfinden. Eine Hälfte allein zu prüfen ist
// genau die Lücke, durch die es gefallen ist.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebe: _hebe, hebeFunktion: _hf, hebeKonstante: _hk } = require('./helpers/quelle');

const SRC = quelle();
const hebeFunktion = (n) => _hf(n, SRC);
const hebeKonstante = (n) => _hk(n, SRC);

const SORTEN = [
  { id: 3, name: 'Shiitake', kuerzel: 'SH', description: '' },
  { id: 7, name: 'Blue Oyster', kuerzel: 'BO', description: '' }
];

// Baut den Knopf und löst das data-sorte wieder auf, wie der Handler es tut.
function rundlauf(it, sorten = SORTEN) {
  // _planBtn ist kein Zweigbaum mehr, sondern ein Nachschlag in PLAN_BTNS über
  // PLAN_KINDS.btn — also muss der Rundlauf die Tabelle mitheben.
  const code = [
    hebeFunktion('_spKey'),
    hebeFunktion('_strainKeys'),
    hebeFunktion('_strainByKey'),
    hebeFunktion('sorteKey'),
    _hebe([[/^const _labRows = .*$/m, '_labRows']], SRC),
    hebeKonstante('PLAN_KINDS'),
    hebeFunktion('planKind'),
    hebeKonstante('PLAN_BTNS'),
    hebeFunktion('_planBtn')
  ].join('\n');
  return new Function(
    'mushroomStrains',
    'it',
    `
    const esc = (x) => String(x == null ? '' : x).replace(/"/g, '&quot;');
    const t = (k) => k;
    const getLabLabel = (x) => 'label:' + x;
    const dashTaskBtn = () => '';
    const dashLabGroupOpen = false;
    ${code}
    const html = _planBtn(it);
    const m = /data-sorte="([^"]*)"/.exec(html);
    const aktion = /data-action="([^"]*)"/.exec(html);
    return { html, sorte: m && m[1], aktion: aktion && aktion[1], ms: m ? _strainByKey(m[1]) : null };
  `
  )(sorten, it);
}

// Wie buildSupplyTasks()/buildLabMinTasks() ihre Zeilen wirklich schreiben:
// species ist der Anzeigename, task.key der Schlüssel.
const versorgung = (name, key, taskAction) => ({
  kind: 'supply',
  species: name,
  task: { key, name, taskAction }
});
const laborMin = (name, key, type) => ({ kind: 'labmin', species: name, task: { key, name, type } });

describe('Die Knöpfe der Tagesliste', () => {
  it('gibt der Nachschub-Zeile einen Schlüssel mit, den der Handler auflöst', () => {
    const r = rundlauf(versorgung('Shiitake', 'id:3', 'make-grain'));
    assert.ok(r.ms, 'der Handler findet die Sorte nicht — genau hier war der Knopf tot');
    assert.equal(r.ms.id, 3);
  });

  it('tut dasselbe für eine Labor-Untergrenze', () => {
    const r = rundlauf(laborMin('Blue Oyster', 'id:7', 'MC'));
    assert.ok(r.ms, 'der Handler findet die Sorte nicht');
    assert.equal(r.ms.id, 7);
  });

  it('funktioniert auch für eine Sorte ohne strainId, über den Namensschlüssel', () => {
    // Chargen von vor der strain_id-Nachtragung tragen keinen Verweis; sorteKey()
    // fällt dann auf 'n:' + bereinigter Name zurück, und der muss genauso treffen.
    const r = rundlauf(versorgung('Shiitake', 'n:shiitake', 'make-blocks'));
    assert.ok(r.ms, 'der Namensschlüssel muss genauso auflösbar sein wie die Id');
    assert.equal(r.ms.id, 3);
  });

  it('schreibt niemals den Anzeigenamen ins Attribut', () => {
    // Der eigentliche Fehler, in einem Satz. "Shiitake" steht in keinem der
    // beiden Schlüsselräume, also lief _strainByKey() jedes Mal auf null.
    for (const it of [versorgung('Shiitake', 'id:3', 'make-grain'), laborMin('Shiitake', 'id:3', 'LC')]) {
      const r = rundlauf(it);
      assert.notEqual(r.sorte, 'Shiitake', 'data-sorte trägt einen Schlüssel, keinen Namen');
      assert.match(r.sorte, /^(id:|n:)/, 'und Schlüssel sind an ihrem Präfix zu erkennen');
    }
  });

  it('unterscheidet "Körner ansetzen" von "Charge ansetzen"', () => {
    // Körner zuerst, wenn keine da sind: aus nichts lassen sich keine Blöcke
    // machen. Die beiden Fälle dürfen nicht auf denselben Knopf fallen.
    assert.equal(rundlauf(versorgung('Shiitake', 'id:3', 'make-grain')).aktion, 'supply-make-grain');
    assert.equal(rundlauf(versorgung('Shiitake', 'id:3', 'make-blocks')).aktion, 'supply-make-batch');
  });

  it('gibt dem Labor-Knopf den Typ mit, der knapp ist', () => {
    assert.match(rundlauf(laborMin('Shiitake', 'id:3', 'PD')).html, /data-labtype="PD"/);
  });

  it('bleibt leer statt zu raten, wenn die Zeile keinen Schlüssel trägt', () => {
    // Ohne Schlüssel ist ein leeres Attribut ehrlicher als der Name: der Handler
    // sagt dann "Sorte nicht gefunden", und das stimmt dann auch.
    const r = rundlauf({ kind: 'supply', species: 'Shiitake', task: { taskAction: 'make-grain' } });
    assert.equal(r.sorte, '');
    assert.equal(r.ms, null);
  });
});

// Körnerbrut wird gewogen. Die Karte hat sie gezählt und das Ergebnis als
// Kilogramm beschriftet — 20 Gläser zu 3 kg standen als "20,0 kg" über Zeilen,
// die zusammen 60 ergaben, und renderThresholds() maß Gläser gegen eine
// Kilogramm-Schwelle.
describe('Der Bestand an Körnerbrut', () => {
  function bestand(chargen, kulturen = []) {
    const code = [
      hebeKonstante('ARCHIVED_STATUSES'),
      hebeFunktion('_grainKgOf'),
      hebeFunktion('getLabStockCounts')
    ].join('\n');
    return new Function(
      'batches',
      'cultures',
      `
      const getStatus = (id) => ({ status: (batches.find((b) => b.batchId === id) || {})._status || 'EMPTY' });
      const isArchivedStatus = (s) => ARCHIVED_STATUSES.includes(s);
      const ZONE_BY_ID = { CONTAM: { role: 'contaminated' }, SPAWN: { role: 'spawn' } };
      const toZone = (x) => x;
      const placementByBag = () => new Map(batches.flatMap((b) => b._platz || []).map((e) => [e.bag.toUpperCase(), e]));
      ${code}
      return getLabStockCounts();
    `
    )(chargen, kulturen);
  }
  // Zwanzig Glaeser zu 3 kg. `verbraucht` gibt so vielen ein REMOVE, wie
  // nbConsumeSpawnBags() es schreibt.
  const koerner = ({ verbraucht = 0, ...extra } = {}) => {
    const bags = Array.from({ length: 20 }, (_, i) => 'SH-G1-' + (i + 1));
    return {
      batchId: 'SH-G1',
      batchType: 'grain',
      qty: 20,
      bagKg: 3,
      bags,
      bagWeights: Object.fromEntries(bags.map((b) => [b, 3])),
      _platz: bags.map((b, i) => ({
        bag: b,
        action: i < verbraucht ? 'REMOVE' : 'ADD',
        to: i < verbraucht ? null : 'SPAWN'
      })),
      ...extra
    };
  };

  it('rechnet in Kilogramm, nicht in Gläsern', () => {
    assert.equal(bestand([koerner()]).GS, 60, '20 Gläser zu 3 kg sind 60 kg, nicht 20');
  });

  it('zählt frisch angesetzte Brut mit, die noch keinen Scan hat', () => {
    // createGrainBatch schreibt keine Scan-Einträge. Ein Glas ohne Eintrag ist
    // heute angesetzt und noch nirgends hingestellt — es steht da.
    assert.equal(bestand([koerner({ _platz: [] })]).GS, 60);
  });

  it('lässt verbrauchte Gläser heraus', () => {
    assert.equal(bestand([koerner({ verbraucht: 20 })]).GS, 0);
  });

  it('zählt den Rest, wenn erst ein Teil verbraucht ist', () => {
    // Der Fehler, den das hier festhält: die ganze Charge zählte voll, bis das
    // letzte Glas ging.
    assert.equal(bestand([koerner({ verbraucht: 15 })]).GS, 15, 'fünf Gläser zu 3 kg');
  });

  it('zählt Kulturen weiterhin in Stück', () => {
    const c = bestand(
      [],
      [
        { type: 'MC', status: 'active' },
        { type: 'MC', status: 'active' }
      ]
    );
    assert.equal(c.MC, 2);
  });
});

// Eine Versorgungslücke und eine gerissene Labor-Untergrenze tragen keine Zone.
// Die Wegreihenfolge hatte damit nichts, wonach sie sie einsortieren konnte, und
// schob sie ans Ende — hinter eine Klappe, die zu ist, an genau den vollen Tagen,
// an denen sie zählen. Sie sind keine Stationen des Rundgangs, sondern das, was
// davor anzufangen ist.
// Kennt die Tabelle jede Zeilenart, die der Tagesplan wirklich erzeugt?
//
// Das ist die eigentliche Lehre aus diesem Umbau. Es gab vier Leitern ueber
// dieselben Arten — die Reihenfolge auf dem Schirm, die ueber die Klappe, der
// Nenner des Fortschrittsbalkens, der Knopf — und eine neue Art musste in alle
// vier. 'labgroup' kam in drei an. In rank() nicht, fiel damit auf 999 und
// wurde als Erstes von der Sechs-Zeilen-Klappe verdeckt: die Zusammenfassung,
// die eigens dagegen erfunden war. Kein Test, kein Fehler, nichts.
//
// Statt vier Leitern gibt es eine Tabelle. Dieser Test liest die Arten aus dem
// Erzeuger und haelt sie dagegen, damit eine neue Art nicht still danebenfaellt.
describe('Jede Zeilenart steht in der Tabelle', () => {
  const tabelle = () => new Function(hebeKonstante('PLAN_KINDS') + String.fromCharCode(10) + 'return PLAN_KINDS;')();

  // Was buildWeekPlan() tatsaechlich in den Tag legt.
  function erzeugteArten() {
    const fn = SRC.slice(SRC.indexOf('function buildWeekPlan'));
    const rumpf = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    const arten = new Set([...rumpf.matchAll(/kind: '([a-z]+)'/g)].map((m) => m[1]));
    // Eine Zeile waehlt ihre Art zur Laufzeit: inoculate -> grain, sonst fruiting.
    for (const m of rumpf.matchAll(/kind: [^,]*\?\s*'([a-z]+)'\s*:\s*'([a-z]+)'/g)) {
      arten.add(m[1]);
      arten.add(m[2]);
    }
    return [...arten].sort();
  }

  it('kennt jede Art, die der Erzeuger in den Tag legt', () => {
    const bekannt = tabelle();
    const fehlend = erzeugteArten().filter((a) => !bekannt[a]);
    assert.deepEqual(fehlend, [], 'diese Arten fallen durch jede Abfrage und schweigen dabei');
  });

  it('fuehrt keine Art, die niemand mehr erzeugt', () => {
    // Andersherum genauso: eine Zeile fuer etwas, das es nicht gibt, liest sich
    // beim naechsten Mal wie eine Zusage.
    const erzeugt = erzeugteArten();
    const tot = Object.keys(tabelle()).filter((a) => !erzeugt.includes(a));
    assert.deepEqual(tot, [], 'diese Arten stehen in der Tabelle und werden nie gebaut');
  });

  it('gibt jeder Art alle vier Angaben', () => {
    // Eine fehlende Spalte ist derselbe stille Ausfall wie eine fehlende Zeile.
    for (const [art, e] of Object.entries(tabelle())) {
      assert.ok(typeof e.cat === 'string' && e.cat, art + ': keine Kategorie');
      assert.ok(e.rank === null || typeof e.rank === 'number', art + ': kein Rang');
      assert.equal(typeof e.counts, 'boolean', art + ': zaehlt-mit fehlt');
      assert.equal(typeof e.btn, 'string', art + ': kein Knopf');
    }
  });

  it('sortiert alles Abgeleitete vor den Rundgang und zaehlt es nicht mit', () => {
    // Die zwei Eigenschaften haengen zusammen: eine Zeile, die sich nicht
    // abhaken laesst, gehoert nicht in den Nenner — und weil sie keine Zone
    // hat, braucht sie einen eigenen Rang, sonst frisst die Klappe sie.
    for (const [art, e] of Object.entries(tabelle())) {
      if (e.counts) continue;
      assert.ok(e.rank != null && e.rank < 0, art + ': abgeleitet, aber ohne eigenen Rang vor dem Rundgang');
    }
  });

  it('nennt nur Kategorien, die der Tag auch zeichnet', () => {
    const cats = new Function(hebeKonstante('PLAN_CATS') + String.fromCharCode(10) + 'return PLAN_CATS;')();
    for (const [art, e] of Object.entries(tabelle())) {
      assert.ok(cats.includes(e.cat), art + ': Kategorie ' + e.cat + ' steht in keiner PLAN_CATS');
    }
  });
});

// ── Nur das Wesentliche ─────────────────────────────────────────────────────
describe('Was eine Versorgungslücke sagt', () => {
  it('trägt keine Herleitung mehr mit sich', () => {
    // Hier stand: "keine Körner, nichts in der Inkubation — nach der Fruchtung
    // (12) ist Schluss". Eine Herleitung dessen, was der Knopf daneben ohnehin
    // verlangt, und in der Zeile, die man im Vorbeigehen liest, die längste von
    // allen. Übrig bleibt: die Sorte, und was zu tun ist.
    assert.doesNotMatch(hebeFunktion('buildSupplyTasks'), /detail:/, 'die Begründung ist zurück');
  });

  it('sagt trotzdem noch, dass es eilt', () => {
    // Nicht in Worten, sondern im roten Streifen, den die Zeile ohnehin trägt.
    // Ohne das wäre "kürzer" auch "sagt weniger".
    const zweig = SRC.slice(SRC.indexOf('for (const s of buildSupplyTasks())'));
    assert.match(zweig.slice(0, 700), /overdue: s\.supply === 'now'/);
  });

  it('öffnet das Körnerbrut-Formular mit der Sorte schon gewählt', () => {
    // Sonst wäre der kurze Text nur eine Aufforderung, das Formular selbst zu
    // suchen und die Sorte ein zweites Mal auszuwählen.
    const h = SRC.slice(
      SRC.indexOf("action === 'supply-make-grain'"),
      SRC.indexOf("action === 'supply-make-grain'") + 800
    );
    assert.match(h, /_strainByKey\(el\.dataset\.sorte\)/);
    assert.match(h, /msQuickLabor\(ms\.id\)/, 'das Laborformular öffnet ohne Sorte');
    assert.match(h, /_msqPickType\('KB'\)/, 'es öffnet ohne die Körnerbrut vorgewählt');
  });
});

// ── Wie der Tag gegliedert ist ──────────────────────────────────────────────
describe('Labor und Chargen sind zwei Arbeiten', () => {
  const tabelle = () => new Function(hebeKonstante('PLAN_KINDS') + String.fromCharCode(10) + 'return PLAN_KINDS;')();

  it('stellt sie nicht mehr unter dieselbe Überschrift', () => {
    // "33 Sorten unter Labor-Minimum" und "Blue Oyster · Körnerbrut ansetzen"
    // standen nebeneinander unter "Ansetzen" — zwei Arbeiten in zwei Räumen
    // unter einer Überschrift, die keine von beiden benennt.
    const k = tabelle();
    assert.equal(k.labmin.cat, 'lab');
    assert.equal(k.labgroup.cat, 'lab');
  });

  it('lässt die Körnerbrut aber bei den Chargen', () => {
    // Sie IST eine Charge (batchType 'grain'), und wer Blöcke ansetzt, setzt
    // auch die Körner an.
    const k = tabelle();
    assert.equal(k.supply.cat, 'create');
    assert.equal(k.grain.cat, 'create');
  });

  it('führt die Kategorien in der Reihenfolge, in der die Kette läuft', () => {
    const cats = new Function(hebeKonstante('PLAN_CATS') + String.fromCharCode(10) + 'return PLAN_CATS;')();
    assert.ok(cats.indexOf('lab') < cats.indexOf('create'), 'die Chargen stünden vor dem Labor');
    assert.ok(cats.indexOf('create') < cats.indexOf('move'), 'umgezogen würde vor dem Ansetzen');
    assert.ok(cats.indexOf('move') < cats.indexOf('harvest'));
  });
});

// ── Die Tabelle ist die Tabelle ─────────────────────────────────────────────
describe('PLAN_KINDS wird auch gelesen', () => {
  const tabelle = () => new Function(hebeKonstante('PLAN_KINDS') + String.fromCharCode(10) + 'return PLAN_KINDS;')();
  const bauer = () =>
    new Function(
      'esc',
      't',
      'getLabLabel',
      'dashTaskBtn',
      'dashLabGroupOpen',
      hebeKonstante('PLAN_BTNS') + String.fromCharCode(10) + 'return Object.keys(PLAN_BTNS);'
    )(String, String, String, () => '', false);

  it('baut den Knopf aus der Spalte btn statt aus einer Leiter', () => {
    // Die Spalte behauptete seit ihrer Einführung, die vierte der vier
    // parallelen Leitern zu ersetzen. Gelesen hat sie niemand: _planBtn
    // verzweigte weiter selbst, und eine neue Art mit gesetztem btn bekam still
    // den allgemeinen „Ansehen"-Knopf. Eine Attrappe, die autoritativ aussah.
    const fn = hebeFunktion('_planBtn');
    assert.doesNotMatch(fn, /it\.kind ===/, 'die Leiter ist zurück');
    assert.match(fn, /PLAN_BTNS\[/, 'die Tabelle wird nicht befragt');
  });

  it('hat zu jeder Art einen Bauer und zu jedem Bauer eine Art', () => {
    const kinds = tabelle();
    const btns = bauer();
    for (const [art, e] of Object.entries(kinds)) {
      assert.ok(btns.includes(e.btn), art + ': btn "' + e.btn + '" hat keinen Bauer in PLAN_BTNS');
    }
    for (const b of btns) {
      assert.ok(
        Object.values(kinds).some((e) => e.btn === b),
        'der Bauer "' + b + '" gehört zu keiner Art — tote Zeichnung'
      );
    }
  });

  it('trägt das Gewicht in der Tabelle, nicht an der Zeile', () => {
    // Als Feld auf dem Eintrag hätte die nächste zusammenfassende Art still
    // wieder „1 Labor" statt 38 gezählt: planWeight nahm 1 für alles, was das
    // Feld vergass, und kein Test hätte das gesehen.
    const kinds = tabelle();
    assert.equal(typeof kinds.labgroup.weight, 'function', 'labgroup sagt nicht mehr, für wie viele es steht');
    assert.equal(typeof kinds.labgroup.late, 'function');
    for (const [art, e] of Object.entries(kinds)) {
      if (e.weight !== undefined) assert.equal(typeof e.weight, 'function', art + ': weight ist keine Funktion');
      if (e.late !== undefined) assert.equal(typeof e.late, 'function', art + ': late ist keine Funktion');
    }
    assert.doesNotMatch(hebeFunktion('buildWeekPlan'), /overdueWeight:/, 'die Zeile trägt es wieder selbst');
  });

  it('rechnet das Gewicht aus den Zeilen, die die Zusammenfassung vertritt', () => {
    const code = [
      _hebe([[/^const _labRows = .*$/m, '_labRows']], SRC),
      hebeKonstante('PLAN_KINDS'),
      hebeFunktion('planKind'),
      hebeFunktion('planWeight'),
      hebeFunktion('planOverdue')
    ].join(String.fromCharCode(10));
    const mit = (offen) =>
      new Function('dashLabGroupOpen', code + String.fromCharCode(10) + 'return { planWeight, planOverdue };')(offen);
    const rows = Array.from({ length: 38 }, (_, i) => ({ empty: i < 12 }));
    const zeile = { kind: 'labgroup', overdue: true, task: { rows } };
    const zu = mit(false);
    assert.equal(zu.planWeight(zeile), 38, 'zugeklappt steht sie für 38');
    assert.equal(zu.planOverdue(zeile), 12, 'und für die 12 leeren davon');
    const auf = mit(true);
    assert.equal(auf.planWeight(zeile), 0, 'aufgeklappt stehen die 38 selbst daneben');
    assert.equal(auf.planOverdue(zeile), 0);
    assert.equal(zu.planWeight({ kind: 'harvest' }), 1, 'alles andere zählt als eins');
  });
});
