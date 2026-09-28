'use strict';
// Stämme je Pilzsorte, und der Tag, an dem etwas angesetzt wurde.
//
// Zwei Lücken, die bei einer Inventur auffallen. Der Stamm — Nordlicht, Blue
// Seestern 01, SHIKQ07 — war freier Text an Charge und Kultur, und dieselbe
// Linie hieß jedes Mal anders. Jetzt steht er in einer Liste je Sorte und wird
// ausgewählt wie die Sorte selbst, in allen drei Arbeitsgängen: Charge,
// Reinraumarbeit, Körnerbrut. Und alte Flüssigkulturen und Platten kamen mit dem
// heutigen Datum in die App, jung auf dem Papier und alt im Regal. Jetzt darf ein
// Anlegen einen früheren Tag tragen — als Ausnahme; die Vorgabe bleibt heute.
//
// Der Stamm bleibt als NAME an Charge und Kultur (strain_text), nicht als Id:
// alles, was ihn anzeigt, druckt oder in eine Kennung schreibt, liest diese
// Spalte. Deshalb hält dieser Test vor allem fest, was mit dem Namen geschieht,
// wenn sich die Liste ändert — und dass jeder Weg den Tag bis zum Anlegen trägt.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle();
const HTML = quelle('index.html');
const SERVER = quelle('server.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_staemme_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}

// Eine Block-Charge, geschrieben wie createBatch sie schreibt: der Stamm in
// strain_text, und in `strain` derselbe Name oder 'XXX'.
function charge(d, batchId, strainId, stamm) {
  db.insertBatch(
    d,
    {
      batchId,
      strainId,
      strain: stamm || 'XXX',
      strainText: stamm || '',
      qty: 1,
      days: 14,
      substrate: { hardwood: 80, wheatbran: 20, rh: 0, gypsum: false },
      bagKg: 3,
      batchType: 'block',
      created: '2026-09-01T10:00:00.000Z',
      due: '2026-09-15T10:00:00.000Z',
      bags: [batchId + '-01']
    },
    [],
    null
  );
}
function kultur(d, id, strainId, stamm, status) {
  db.insertCultures(d, [
    { id, type: 'LC', strainId, strainText: stamm, status: status || 'active', created: '2026-09-01T10:00:00.000Z' }
  ]);
}
const text = (d, tabelle, spalte, id) =>
  d.prepare(`SELECT strain_text AS t FROM ${tabelle} WHERE ${spalte}=?`).get(id).t;

describe('Stämme in der Datenbank', () => {
  let d, p, lm, shi;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    lm = db.createMushroomStrain(d, { name: 'Lions Mane', kuerzel: 'LM' });
    shi = db.createMushroomStrain(d, { name: 'Shiitake', kuerzel: 'SHI' });
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('legt einen Stamm an einer Sorte an, ohne Tippspuren', () => {
    const id = db.createStamm(d, { strainId: lm, name: '  LMKQ07   Acme ' });
    const s = db.listStaemme(d).find((x) => x.id === id);
    assert.equal(s.strainId, lm);
    assert.equal(s.name, 'LMKQ07 Acme');
    assert.ok(s.created);
  });

  it('kennt einen Namen je Sorte nur einmal, gleich wie er geschrieben ist', () => {
    db.createStamm(d, { strainId: lm, name: 'Nordlicht' });
    assert.throws(() => db.createStamm(d, { strainId: lm, name: 'nordlicht' }), /Stamm: already exists/);
    // Die Meldung soll am Telefon ankommen, nicht als "Internal server error".
    assert.equal(db.isSafeError('Stamm: already exists'), true);
  });

  it('lässt denselben Namen bei einer anderen Sorte zu', () => {
    // Nordlicht beim Lions Mane ist kein Stamm des Shiitake.
    assert.doesNotThrow(() => db.createStamm(d, { strainId: shi, name: 'Nordlicht' }));
  });

  it('besteht auf Sorte und Namen', () => {
    assert.throws(() => db.createStamm(d, { strainId: lm, name: '   ' }), /name is required/);
    assert.throws(() => db.createStamm(d, { strainId: 9999, name: 'Waise' }), /Pilzsorte nicht gefunden/);
    assert.throws(() => db.createStamm(d, { name: 'ohne Sorte' }), /Pilzsorte nicht gefunden/);
  });

  it('reicht die Stämme mit den übrigen Daten aus', () => {
    // Die Auswahl in den Arbeitsgängen liest aus demselben Stand wie alles
    // andere; fehlten sie in readAll, stünde nach dem Neuladen nur "ohne Stamm" da.
    const alles = db.readAll(d);
    assert.ok(Array.isArray(alles.staemme));
    assert.ok(alles.staemme.some((s) => s.name === 'Nordlicht' && s.strainId === lm));
  });
});

describe('Stamm umbenennen und löschen', () => {
  let d, p, lm, shi, nordlicht;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    lm = db.createMushroomStrain(d, { name: 'Lions Mane', kuerzel: 'LM' });
    shi = db.createMushroomStrain(d, { name: 'Shiitake', kuerzel: 'SHI' });
    nordlicht = db.createStamm(d, { strainId: lm, name: 'Nordlicht' });
    db.createStamm(d, { strainId: lm, name: 'LMKQ07' });
    charge(d, 'LM-010926-01', lm, 'Nordlicht');
    kultur(d, 'LC-LM-NORDLICHT-010926-01', lm, ' nordlicht ');
    kultur(d, 'LC-LM-LMKQ07-010926-01', lm, 'LMKQ07');
    // Derselbe Name bei einer anderen Sorte gehört nicht zu diesem Stamm.
    kultur(d, 'LC-SHI-NORDLICHT-010926-01', shi, 'Nordlicht');
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('zieht die Chargen und Kulturen der Sorte mit, die den alten Namen tragen', () => {
    // Sonst stünde ein Tippfehler, der in der Liste korrigiert ist, auf jedem
    // Etikett, das danach noch gedruckt wird.
    assert.equal(db.updateStamm(d, nordlicht, { name: 'Nordlicht 2' }), true);
    assert.equal(text(d, 'batches', 'batch_id', 'LM-010926-01'), 'Nordlicht 2');
    assert.equal(text(d, 'cultures', 'id', 'LC-LM-NORDLICHT-010926-01'), 'Nordlicht 2');
  });

  it('und lässt alles andere stehen', () => {
    assert.equal(text(d, 'cultures', 'id', 'LC-SHI-NORDLICHT-010926-01'), 'Nordlicht', 'eine andere Sorte wurde umbenannt');
    assert.equal(text(d, 'cultures', 'id', 'LC-LM-LMKQ07-010926-01'), 'LMKQ07', 'ein anderer Stamm wurde umbenannt');
    // `batches.strain` gehört der Charge — dieselbe Regel wie beim Umbenennen
    // einer Sorte (strain-rename.test.js).
    const b = d.prepare("SELECT strain FROM batches WHERE batch_id='LM-010926-01'").get();
    assert.equal(b.strain, 'Nordlicht');
  });

  it('weist einen Namen ab, den die Sorte schon hat', () => {
    assert.throws(() => db.updateStamm(d, nordlicht, { name: 'lmkq07' }), /Stamm: already exists/);
    assert.equal(text(d, 'batches', 'batch_id', 'LM-010926-01'), 'Nordlicht 2', 'der Fehlschlag hat trotzdem umbenannt');
  });

  it('lässt einen leeren Namen nicht zu, und ein leerer Auftrag ändert nichts', () => {
    assert.throws(() => db.updateStamm(d, nordlicht, { name: '  ' }), /name is required/);
    assert.equal(db.updateStamm(d, nordlicht, {}), false);
    assert.throws(() => db.updateStamm(d, 9999, { name: 'x' }), /Stamm: not found/);
  });

  it('nimmt beim Löschen nur den Eintrag aus der Auswahl, die Texte bleiben', () => {
    // Sie stehen auf Etiketten, die schon an Gläsern kleben.
    assert.equal(db.deleteStamm(d, nordlicht), true);
    assert.ok(!db.listStaemme(d).some((s) => s.id === nordlicht));
    assert.equal(text(d, 'cultures', 'id', 'LC-LM-NORDLICHT-010926-01'), 'Nordlicht 2');
    assert.equal(db.deleteStamm(d, nordlicht), false);
  });

  it('geht mit seiner Sorte', () => {
    const leer = db.createMushroomStrain(d, { name: 'Zunderschwamm', kuerzel: 'ZUND' });
    db.createStamm(d, { strainId: leer, name: 'Beispiel 1' });
    db.deleteMushroomStrain(d, leer);
    assert.ok(!db.listStaemme(d).some((s) => s.strainId === leer));
  });
});

describe('Eine Charge aus einem Ansatz, angesetzt an einem früheren Tag', () => {
  let d, p, bo;
  before(() => {
    ({ db: d, path: p } = tmpDb());
    bo = db.createMushroomStrain(d, {
      name: 'Blue Oyster',
      kuerzel: 'BO',
      recBatchType: 'block',
      recSubstrate: 'holzkleie',
      recBagKg: 5,
      recHardwoodPct: 80,
      recWheatbranPct: 20,
      recGypsumPct: 1,
      recRhPct: 62,
      recSpawnPct: 5,
      recIncDays: 60
    });
    for (const [mat, v] of [
      ['hardwood', 600],
      ['wheatbran', 200],
      ['gypsum', 20],
      ['grain', 60]
    ])
      db.setInventoryAbsolute(d, mat, v, 'count', 'Inventur', null);
    db.createSubstrateBatch(d, { subId: 'SUB-01', recipeStrainId: bo, targetKg: 200 }, null);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('trägt den Tag und rechnet die Fälligkeit davon', () => {
    // Der Weg des Chargen-Assistenten: der Server rechnet `due` selbst aus, also
    // muss er es vom mitgegebenen Tag aus tun, nicht von heute.
    const r = db.createBagBatchFromSubstrate(
      d,
      {
        batchId: 'BO-030926-01',
        subId: 'SUB-01',
        strainId: bo,
        qty: 2,
        bagKg: 5,
        days: 14,
        strain: 'Blue Seestern 01',
        strainText: 'Blue Seestern 01',
        created: '2026-09-03T10:00:00.000Z'
      },
      null
    );
    const b = d.prepare("SELECT created, due, strain_text FROM batches WHERE batch_id='BO-030926-01'").get();
    assert.equal(b.created, '2026-09-03T10:00:00.000Z');
    assert.equal(b.due, '2026-09-17T10:00:00.000Z');
    assert.equal(r.due, b.due, 'der Kalender bekommt eine andere Fälligkeit als die Charge');
    assert.equal(b.strain_text, 'Blue Seestern 01');
  });

  it('bucht als Bestand aus der Inventur nichts: kein Kilo aus dem Ansatz, kein Korn vom Lager', () => {
    // Mit einem früheren Tag wird nichts abgebucht. Das Material ist
    // längst verbraucht, und das Regal wird bei der Inventur gezählt.
    const korn = () => d.prepare('SELECT stock_grain AS v FROM inventory WHERE id=1').get().v;
    const rest = () => db.listSubstrateBatches(d).find((s) => s.subId === 'SUB-01').remainingKg;
    const kornVorher = korn();
    const restVorher = rest();
    const r = db.createBagBatchFromSubstrate(
      d,
      {
        batchId: 'BO-020926-01',
        subId: 'SUB-01',
        strainId: bo,
        qty: 10,
        bagKg: 5,
        days: 14,
        created: '2026-09-02T10:00:00.000Z',
        noBooking: true
      },
      null
    );
    assert.equal(korn(), kornVorher, 'Körnerbrut wurde abgebucht');
    assert.equal(rest(), restVorher, 'aus dem Ansatz wurde gezogen');
    assert.equal(r.drawKg, 0);
    assert.equal(r.spawnKg, 0);
    assert.equal(r.over, false);
    // Die Charge steht trotzdem da, mit ihren Beuteln und am Ansatz — nur mit 0 kg.
    const b = d.prepare("SELECT substrate_kg, created FROM batches WHERE batch_id='BO-020926-01'").get();
    assert.equal(b.substrate_kg, 0);
    assert.equal(b.created, '2026-09-02T10:00:00.000Z');
    assert.equal(d.prepare("SELECT COUNT(*) c FROM bags WHERE batch_id='BO-020926-01'").get().c, 10);
    assert.equal(
      d.prepare("SELECT COUNT(*) c FROM inventory_log WHERE ref='BO-020926-01'").get().c,
      0,
      'im Lagerbuch steht eine Buchung für eine Charge, die nichts gebucht hat'
    );
  });

  it('und gibt beim Löschen nichts zurück, was sie nie genommen hat', () => {
    const korn = () => d.prepare('SELECT stock_grain AS v FROM inventory WHERE id=1').get().v;
    const rest = () => db.listSubstrateBatches(d).find((s) => s.subId === 'SUB-01').remainingKg;
    const kornVorher = korn();
    const restVorher = rest();
    db.deleteBatchById(d, 'BO-020926-01', null);
    assert.equal(korn(), kornVorher, 'das Löschen hat Korn gutgeschrieben, das nie abging');
    assert.equal(rest(), restVorher, 'das Löschen hat den Ansatz aufgefüllt');
  });

  it('ohne den Schalter bucht sie wie immer', () => {
    // Der Tag allein schaltet nichts ab — nur noBooking. Ein anderer Aufrufer, der
    // `created` mitgibt, zieht weiter aus dem Ansatz. (Korn bucht eine Charge seit
    // dem 28.09.2026 gar nicht mehr ab: es ging beim Ansetzen der Körnerbrut.)
    const rest = () => db.listSubstrateBatches(d).find((s) => s.subId === 'SUB-01').remainingKg;
    const restVorher = rest();
    const r = db.createBagBatchFromSubstrate(
      d,
      { batchId: 'BO-010926-01', subId: 'SUB-01', strainId: bo, qty: 2, bagKg: 5, created: '2026-09-01T10:00:00.000Z' },
      null
    );
    assert.equal(r.drawKg, 10);
    assert.equal(rest(), restVorher - 10, 'ohne noBooking wurde nichts aus dem Ansatz gezogen');
  });
});

// ── Im Browser ───────────────────────────────────────────────

describe('Angesetzt am', () => {
  const zeitpunkt = new Function(hebeFunktion('anlageZeitpunkt', SRC) + '\nreturn anlageZeitpunkt;')();

  it('macht aus einem früheren Tag Mittag an diesem Tag, Ortszeit', () => {
    // Weit genug von beiden Mitternächten, dass keine Zeitzone den Tag verschiebt.
    const d = zeitpunkt('2026-09-03');
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 8, 3, 12]);
  });

  it('und ohne Tag ist es jetzt — auch bei Unsinn im Feld', () => {
    const vorher = Date.now();
    for (const v of ['', undefined, '03.09.2026']) {
      const d = zeitpunkt(v);
      assert.ok(!isNaN(d.getTime()) && d.getTime() - vorher < 5000, String(v) + ' ergab ' + d);
    }
  });

  // anlageLesen mit einem Feld, wie der Dialog es zeigt.
  function lesen(offen, wert) {
    let gemeldet = null;
    const feld = offen ? { value: wert } : null;
    const f = new Function(
      'document',
      'fieldError',
      't',
      [
        hebeFunktion('localDateStr', SRC),
        'const ANLAGE = {};',
        hebeFunktion('anlageState', SRC),
        hebeFunktion('anlageLesen', SRC)
      ].join('\n') + '\nreturn (o) => { ANLAGE.x = { offen: o, datum: "" }; return anlageLesen("x"); };'
    )(
      { getElementById: (id) => (id === 'x-anlage' ? feld : null) },
      (id) => {
        gemeldet = id;
      },
      (k) => k
    );
    return { ergebnis: f(offen), gemeldet };
  }
  const tag = (versatz) => {
    const d = new Date();
    d.setDate(d.getDate() + versatz);
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  };

  it('bleibt heute, solange niemand das Feld aufmacht', () => {
    assert.equal(lesen(false).ergebnis, '');
  });

  it('heute im offenen Feld ist dasselbe wie zu', () => {
    // Dann ist es der Augenblick des Anlegens, wie bisher — nicht Mittag.
    assert.equal(lesen(true, tag(0)).ergebnis, '');
    assert.equal(lesen(true, '').ergebnis, '');
  });

  it('gibt einen früheren Tag weiter', () => {
    assert.equal(lesen(true, tag(-21)).ergebnis, tag(-21));
  });

  it('weist einen Tag in der Zukunft ab, am Feld', () => {
    const r = lesen(true, tag(1));
    assert.equal(r.ergebnis, null);
    assert.equal(r.gemeldet, 'x-anlage');
  });
});

describe('Der Stamm-Wähler', () => {
  const CODE = [
    hebeFunktion('esc', SRC),
    hebeFunktion('stammNameSauber', SRC),
    hebeFunktion('stammGleich', SRC),
    hebeFunktion('staemmeFor', SRC),
    'const STAMM = {};',
    hebeFunktion('stammState', SRC),
    hebeFunktion('stammRender', SRC),
    hebeFunktion('stammAnzeige', SRC)
  ].join('\n');
  const LISTE = [
    { id: 1, strainId: 1, name: 'Nordlicht' },
    { id: 2, strainId: 1, name: 'LMKQ07 Acme' },
    { id: 3, strainId: 2, name: 'SHIKQ07' },
    { id: 4, strainId: 1, name: '<img src=x onerror=alert(1)>' }
  ];
  function waehler() {
    const box = { innerHTML: '' };
    const api = new Function('document', 't', 'staemme', CODE + '\nreturn { stammRender, stammState, stammAnzeige };')(
      { getElementById: (id) => (id === 'p-stamm-wrap' ? box : null) },
      (k) => k,
      LISTE
    );
    return Object.assign({ box }, api);
  }

  it('bietet nur die Stämme der gewählten Sorte an, "ohne Stamm" zuerst', () => {
    const w = waehler();
    w.stammRender('p', 1);
    const h = w.box.innerHTML;
    assert.match(h, /<select id="p-stamm"[^>]*><option value="">stamm\.none<\/option>/);
    assert.ok(h.indexOf('LMKQ07 TG') > -1 && h.indexOf('LMKQ07 TG') < h.indexOf('Nordlicht'), 'nicht nach Namen sortiert');
    assert.doesNotMatch(h, /SHIKQ07/, 'ein Stamm einer anderen Sorte wird angeboten');
  });

  it('setzt Namen nie roh in die Seite', () => {
    const w = waehler();
    w.stammRender('p', 1);
    assert.doesNotMatch(w.box.innerHTML, /<img/);
  });

  it('behält die Wahl beim Neuzeichnen, gleich wie sie geschrieben ist', () => {
    const w = waehler();
    w.stammRender('p', 1);
    w.stammState('p').wert = 'nordlicht';
    w.stammRender('p', 1);
    assert.match(w.box.innerHTML, /<option value="Nordlicht" selected>/);
  });

  it('fällt beim Wechsel der Sorte auf "ohne Stamm", wenn die neue den Namen nicht kennt', () => {
    const w = waehler();
    w.stammRender('p', 1);
    w.stammState('p').wert = 'Nordlicht';
    w.stammRender('p', 2);
    assert.equal(w.stammState('p').wert, '');
    assert.doesNotMatch(w.box.innerHTML, / selected>/);
  });

  it('zeigt ohne Sorte gar nichts', () => {
    const w = waehler();
    w.stammRender('p', null);
    assert.equal(w.box.innerHTML, '');
  });

  it('hält einen getippten neuen Namen über das Neuzeichnen, und legt mit ihm an', () => {
    // Der Dialog zeichnet sich beim Wechsel der Art neu; das Getippte darf
    // dabei nicht verschwinden — und wer danach "Anlegen" drückt, statt erst
    // "Hinzufügen", meint genau diesen Stamm.
    const w = waehler();
    w.stammRender('p', 1);
    Object.assign(w.stammState('p'), { neu: true, getippt: 'Blue  Seestern 01' });
    w.stammRender('p', 1);
    assert.match(w.box.innerHTML, /<input type="text" id="p-stamm-neu"[^>]*value="Blue  Seestern 01"/);
    assert.equal(w.stammAnzeige('p'), 'Blue Seestern 01');
  });
});

describe('Jeder Weg trägt Stamm und Tag bis zum Anlegen', () => {
  it('der Schnelldialog hat kein freies Stamm-Feld mehr', () => {
    assert.doesNotMatch(HTML, /id="ms-q-strain"/, 'das Freitextfeld steht noch da — zwei Antworten auf eine Frage');
    assert.match(HTML, /id="ms-q-stamm-wrap"/);
    assert.match(HTML, /id="ms-q-anlage-wrap"/);
  });

  it('jedes Öffnen fängt bei "ohne Stamm" und heute an', () => {
    // Ein Datum, das für die letzte Inventurzeile galt, soll nicht still an der
    // nächsten hängen.
    for (const [name, prefix] of [
      ['msQuickOpen', 'ms-q'],
      ['wkbOpen', 'wkb']
    ]) {
      const f = hebeFunktion(name, SRC);
      assert.match(f, new RegExp("stammReset\\('" + prefix + "'\\)"), name + ' setzt den Stamm nicht zurück');
      assert.match(f, new RegExp("anlageReset\\('" + prefix + "'\\)"), name + ' setzt das Datum nicht zurück');
    }
  });

  it('der Schnelldialog gibt Stamm und Tag an alle vier Zweige weiter', () => {
    const f = hebeFunktion('msQuickConfirm', SRC);
    assert.match(f, /const angesetzt = anlageLesen\('ms-q'\)/);
    assert.match(f, /const strainText = await stammFertig\('ms-q'\)/);
    // Körnerbrut als Laborarbeit, Kultur, Körner-Sorte als Charge: je ein
    // setv('lw-created') vor dem Aufruf, der es liest.
    const setzen = [...f.matchAll(/setv\('lw-created', angesetzt\)/g)].map((m) => m.index);
    const aufrufe = [...f.matchAll(/\b(createGrainBatch|logLabWork)\(\);/g)].map((m) => m.index);
    assert.equal(setzen.length, 3, 'nicht jeder Laborzweig setzt lw-created');
    assert.equal(aufrufe.length, 3);
    setzen.forEach((s, i) => assert.ok(s < aufrufe[i], 'lw-created wird erst nach dem Anlegen gesetzt'));
    // Die Block-Charge über das lange Formular.
    assert.match(f, /nbFillFromStrain\(ms, \{[^}]*created: angesetzt[^}]*\}\)/);
  });

  it('die Anlegefunktionen nehmen ihr Datum aus dem Feld, nicht von der Uhr', () => {
    for (const [name, feld] of [
      ['createBatch', 'nb-created'],
      ['logLabWork', 'lw-created'],
      ['createGrainBatch', 'lw-created']
    ]) {
      const f = hebeFunktion(name, SRC);
      const lesen = "anlageNehmen(document.getElementById('" + feld + "'))";
      assert.ok(f.includes(lesen), name + ' liest ' + feld + ' nicht');
      // Als Erstes, und geleert: bricht eine Prüfung ab, darf kein Datum für die
      // nächste Charge stehen bleiben.
      assert.ok(f.indexOf(lesen) < f.indexOf('return'), name + ' kann abbrechen, bevor das Datum geleert ist');
      assert.match(f, /created: wann\.toISOString\(\)/, name + ' stempelt created nicht mit dem Ansetztag');
      assert.doesNotMatch(f, /created: new Date\(\)/, name + ' stempelt created wieder mit jetzt');
    }
    for (const name of ['createBatch', 'createGrainBatch']) {
      assert.match(hebeFunktion(name, SRC), /const due = new Date\(wann\)/, name + ' rechnet die Fälligkeit von heute');
    }
  });

  it('die Kennung trägt den Ansetztag, bei Beuteln wie bei Kulturen', () => {
    assert.match(hebeFunktion('createGrainBatch', SRC), /genGrainBatchId\(sp, lwStrainText, wann\)/);
    assert.match(hebeFunktion('logLabWork', SRC), /todayStr\(wann\)/);
  });

  it('der Chargen-Assistent gibt Stamm und Tag an beide Wege weiter', () => {
    const c = hebeFunktion('wkbCreate', SRC);
    assert.match(c, /const angesetzt = anlageLesen\('wkb'\)/);
    assert.match(c, /const stamm = await stammFertig\('wkb'\)/);
    assert.match(c, /wkbCreateFromShelf\(stamm, angesetzt\)/);
    assert.match(c, /genBatchId\(ms\.name, wann\)/);
    assert.match(c, /createBatchFromSubstrate\([^;]*stamm \|\| 'XXX', stamm,/);
    assert.match(c, /created: angesetzt \? wann\.toISOString\(\) : undefined/);
    const s = hebeFunktion('wkbCreateFromShelf', SRC);
    assert.match(s, /strainText: stamm \|\| ''/);
    assert.match(s, /created: angesetzt \|\| ''/);
    // Und der Weg über den Ansatz schickt den Tag an den Server mit.
    assert.match(hebeFunktion('createBatchFromSubstrate', SRC), /frueher \? \{ created: opts\.created\b/);
  });

  it('der Server prüft den mitgebrachten Tag, und Löschen darf nur der Admin', () => {
    assert.match(SERVER, /validateDate\(data\.created, 'created'\)/, 'from-substrate nimmt jedes created an');
    assert.match(SERVER, /validateDate\(c\.created, 'created'\)/, '/api/cultures nimmt jedes created an');
    const i = SERVER.indexOf("if (req.method === 'DELETE' && stammMatch)");
    assert.ok(i > 0, 'die Löschroute für Stämme fehlt — der Test muss mitgeführt werden');
    const block = SERVER.slice(i, i + 400);
    assert.ok(
      block.indexOf('requireAdmin(') > -1 && block.indexOf('requireAdmin(') < block.indexOf('deleteStamm('),
      'ein Stamm lässt sich ohne Admin löschen'
    );
  });
});

describe('Bestand aus der Inventur bucht nichts ab', () => {
  // Nach der ersten Fassung kam dazu: mit früherem Tag wird nichts abgebucht.
  // Ein früherer Tag heißt, das Material ist längst verbraucht, und
  // das Regal wird bei der Inventur gezählt — eine Abbuchung zöge es doppelt ab.

  it('createBatch bucht nur ohne früheren Tag, und fragt dann auch nicht nach dem Lager', () => {
    const f = hebeFunktion('createBatch', SRC);
    assert.match(f, /const bucht = !angesetzt;/);
    // Jede Stelle, die ein Delta anlegt und den Bestand auf dem Schirm ändert.
    assert.match(f, /if \(substrate && bucht\) \{/, 'Holz, Kleie, Kokos und Gips gehen trotzdem ab');
    assert.match(f, /if \(grainKg > 0 && bucht\) \{/, 'das Korn einer All-in-One geht trotzdem ab');
    // Die beiden Fragen nach dem Lager hätten keine andere Antwort.
    assert.match(f, /if \(bucht && !hw && !wb && !coir && !grainKg\)/);
    assert.match(f, /if \(bucht\) \{\s*const _rhPct/, 'die Warnung vor zu wenig Material kommt trotzdem');
  });

  it('createGrainBatch ebenso', () => {
    const f = hebeFunktion('createGrainBatch', SRC);
    assert.match(f, /const bucht = !angesetzt;/);
    assert.match(f, /if \(grainUsed > 0 && bucht\) \{/, 'das Korn geht trotzdem ab');
  });

  it('der Weg über einen Ansatz sagt es dem Server, und warnt nicht vor dem Überziehen', () => {
    const f = hebeFunktion('createBatchFromSubstrate', SRC);
    assert.match(f, /frueher \? \{ created: opts\.created, noBooking: true \}/);
    assert.match(f, /if \(!frueher && s && need > s\.remainingKg/);
    assert.match(SERVER, /noBooking: 'boolean'/, 'der Server nimmt noBooking ungeprüft an');
    // Und die Meldung danach nennt keine gezogenen Kilogramm.
    assert.match(hebeFunktion('wkbCreate', SRC), /const gezogen = angesetzt\s*\? t\('anlage\.notBooked'\)/);
  });

  it('der Assistent fragt nach dem Datum im ersten Schritt, bevor er nach dem Ansatz fragt', () => {
    const r = hebeFunktion('wkbRender', SRC);
    const schritt1 = r.slice(r.indexOf('if (WKB.step === 1) {'), r.indexOf('} else if (WKB.step === 2) {'));
    assert.match(schritt1, /id="wkb-anlage-wrap"/, 'das Datum steht nicht mehr im ersten Schritt');
    assert.match(r, /if \(WKB\.step === 1\) \{\s*stammRender\('wkb', WKB\.strainId\);\s*anlageRender\('wkb'\);/);
    // Ein Tag in der Zukunft hält ihn dort fest.
    assert.match(SRC, /if \(WKB\.step === 1 && anlageLesen\('wkb'\) === null\) return;/);
  });

  it('und schlägt für Bestand aus der Inventur keinen Ansatz vor, außer man wählt ihn selbst', () => {
    // Ein vorausgewählter Ansatz von heute wäre für eine Charge von vor drei
    // Wochen eine erfundene Herkunft.
    const vorgabe = (frueher, vonHand) => {
      const WKB = { subId: 'SUB-230926-01', subVonHand: vonHand };
      return new Function(
        'WKB',
        'wkOpenMixes',
        'anlageFrueher',
        hebeFunktion('wkbQuelleVorgabe', SRC) + '\nwkbQuelleVorgabe(); return WKB.subId;'
      )(
        WKB,
        () => [{ subId: 'SUB-240926-01' }, { subId: 'SUB-230926-01' }],
        () => frueher
      );
    };
    assert.equal(vorgabe(false, false), 'SUB-240926-01', 'heute: der erste offene Ansatz');
    assert.equal(vorgabe(true, false), '', 'früher: kein Ansatz');
    assert.equal(vorgabe(true, true), 'SUB-230926-01', 'selbst gewählt bleibt gewählt');
  });

  it('der Tag vor heute ist das Kriterium, nicht das offene Feld', () => {
    const frueher = (a) =>
      new Function(
        [
          hebeFunktion('localDateStr', SRC),
          'const ANLAGE = { x: ' + JSON.stringify(a) + ' };',
          hebeFunktion('anlageState', SRC),
          hebeFunktion('anlageFrueher', SRC)
        ].join('\n') + '\nreturn anlageFrueher("x");'
      )();
    const heute = new Date();
    const ymd = (d) =>
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const gestern = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - 1);
    assert.equal(frueher({ offen: true, datum: ymd(gestern) }), true);
    assert.equal(frueher({ offen: true, datum: ymd(heute) }), false, 'heute bucht wie immer');
    assert.equal(frueher({ offen: false, datum: ymd(gestern) }), false, 'zugeklappt ist heute');
    assert.equal(frueher({ offen: true, datum: '' }), false);
  });
});
