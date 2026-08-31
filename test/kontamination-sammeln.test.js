'use strict';
// Eine kontaminierte Reihe in einem Formular.
//
// Kontamination war ein Vorgang für einen Beutel: scharfstellen, scannen,
// Fenster auf, Typ tippen, Schwere tippen, senden, Fenster zu — und für den
// nächsten Beutel wieder von vorn. Am Regal stehen aber selten einzelne
// schlechte Beutel; da ist eine Reihe hin, acht Stück, alle mit demselben
// Trichoderma. Achtmal dasselbe Formular auszufüllen ist die Arbeit, die
// niemand macht, und was niemand macht, steht am Ende nicht in den Zahlen.
//
// Jetzt sammelt der Scanner, solange CONTAM steht, und das Formular kommt
// einmal für alle. Diese Datei hält die drei Stellen fest, an denen das
// zerbrechen würde:
//
//   1. die Sammelliste selbst — zweimal derselbe Beutel sind nicht zwei Beutel,
//   2. der Rumpf, den Senden schickt — ein Bericht je Beutel, jeder mit eigener
//      report_uuid, sonst fallen sie beim Nachspielen aus der Warteschlange auf
//      einen zusammen,
//   3. der Knopf, der das Sammeln beendet — er darf die gescannten Beutel nicht
//      wegwerfen, sondern muss das Formular über ihnen aufmachen.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const SERVER = quelle('server.js');

// crToggleTarget() gegen eine übergebene Liste laufen lassen.
function sammeln(liste, beutel, charge) {
  return new Function(
    '_crTargets',
    'bag',
    'batch',
    `
    ${hebeFunktion('crToggleTarget', APP)}
    const r = crToggleTarget(bag, batch);
    return { r, liste: _crTargets };
  `
  )(liste, beutel, charge);
}

describe('die Sammelliste', () => {
  it('nimmt einen gescannten Beutel auf', () => {
    const { r, liste } = sammeln([], 'BO-2608-01', 'BO-2608');
    assert.equal(r.added, true);
    assert.equal(r.count, 1);
    assert.deepEqual(liste, [{ bag: 'BO-2608-01', batch: 'BO-2608' }]);
  });

  it('nimmt denselben Beutel wieder heraus, statt ihn doppelt zu führen', () => {
    // Am Regal zweimal über denselben Beutel zu ziehen ist das übliche
    // Versehen. Ihn stumm ein zweites Mal aufzunehmen wären zwei Berichte über
    // einen Beutel — und die zweite Meldung fiele erst in der Auswertung auf.
    const liste = [{ bag: 'BO-2608-01', batch: 'BO-2608' }];
    const erg = sammeln(liste, 'BO-2608-01', 'BO-2608');
    assert.equal(erg.r.added, false);
    assert.equal(erg.r.count, 0);
    assert.deepEqual(erg.liste, []);
  });

  it('erkennt den Beutel unabhängig von der Schreibweise wieder', () => {
    // Die Beutelnummer kommt mal aus dem Barcode, mal aus dem Beutel-Fenster.
    // Groß und klein geschrieben ist derselbe Beutel.
    const liste = [{ bag: 'BO-2608-01', batch: 'BO-2608' }];
    assert.equal(sammeln(liste, 'bo-2608-01', 'bo-2608').r.added, false, 'sonst steht er zweimal in der Liste');
  });

  it('lässt die anderen Beutel in Ruhe', () => {
    const liste = [
      { bag: 'BO-2608-01', batch: 'BO-2608' },
      { bag: 'BO-2608-02', batch: 'BO-2608' }
    ];
    const erg = sammeln(liste, 'BO-2608-01', 'BO-2608');
    assert.deepEqual(erg.liste, [{ bag: 'BO-2608-02', batch: 'BO-2608' }]);
  });
});

// crReportBags() mit gestellter uuid-Quelle: die Kennungen sollen sich
// unterscheiden, ihr Inhalt ist für den Test gleichgültig.
function rumpf(ziele, charge) {
  return new Function(
    '_crTargets',
    '_crBatchId',
    `
    let n = 0;
    const newScanUuid = () => 'uuid-' + ++n;
    ${hebeFunktion('crReportBags', APP)}
    return crReportBags();
  `
  )(ziele, charge);
}

describe('der Rumpf, den Senden schickt', () => {
  it('macht aus drei gesammelten Beuteln drei Berichte', () => {
    const bags = rumpf(
      [
        { bag: 'BO-2608-01', batch: 'BO-2608' },
        { bag: 'BO-2608-02', batch: 'BO-2608' },
        { bag: 'SY-2609-04', batch: 'SY-2609' }
      ],
      null
    );
    assert.equal(bags.length, 3);
    assert.deepEqual(
      bags.map((b) => b.bag_id),
      ['BO-2608-01', 'BO-2608-02', 'SY-2609-04']
    );
    // Beutel aus verschiedenen Chargen in einer Meldung: jeder Bericht behält
    // seine eigene Charge, es gibt keine gemeinsame, die für alle gälte.
    assert.equal(bags[2].batch_id, 'SY-2609');
  });

  it('gibt jedem Bericht seine eigene report_uuid', () => {
    // Die Offline-Warteschlange spielt den Rumpf unverändert nach, und die uuid
    // ist es, woran der Server einen Wiedergänger erkennt. Eine gemeinsame
    // Kennung ließe beim Nachspielen acht Beutel auf einen Bericht fallen.
    const bags = rumpf(
      [
        { bag: 'BO-2608-01', batch: 'BO-2608' },
        { bag: 'BO-2608-02', batch: 'BO-2608' }
      ],
      null
    );
    const kennungen = new Set(bags.map((b) => b.report_uuid));
    assert.equal(kennungen.size, bags.length, 'zwei Berichte mit derselben uuid sind nach dem Nachspielen einer');
  });

  it('bleibt ohne gescannten Beutel der Bericht über die Charge', () => {
    // Eine ganze Charge zu melden hat es vorher schon gegeben und muss es
    // weiter geben — dort gibt es keine Beutelnummer zu sammeln.
    const bags = rumpf([], 'BO-2608');
    assert.equal(bags.length, 1);
    assert.equal(bags[0].bag_id, null);
    assert.equal(bags[0].batch_id, 'BO-2608');
  });
});

// toggleContamScan() mit Attrappen für alles, was es sonst anfasst.
function knopf(zustand, ziele) {
  return new Function(
    'scan',
    '_crTargets',
    `
    let formular = false;
    const t = (k) => k;
    function crFinishCollect() { formular = true; }
    function updateSD() {}
    function setFb() {}
    function armScanAction(v) { scan.action = v; }
    function updateCamContamBtn() {}
    ${hebeFunktion('toggleContamScan', APP)}
    toggleContamScan();
    return { action: scan.action, formular, gesammelt: _crTargets.length };
  `
  )(zustand, ziele);
}

describe('der CONTAM-Knopf in der Kamera-Leiste', () => {
  it('stellt scharf, wenn nichts steht', () => {
    const e = knopf({ action: null }, []);
    assert.equal(e.action, 'CONTAM');
    assert.equal(e.formular, false);
  });

  it('räumt den Vorgang ab, solange nichts gesammelt ist', () => {
    const e = knopf({ action: 'CONTAM' }, []);
    assert.equal(e.action, null);
  });

  it('öffnet das Formular, statt gesammelte Beutel wegzuwerfen', () => {
    // Das ist der Knopf, den man drückt, wenn die Reihe abgegangen ist. Würde
    // er hier nur den Vorgang abräumen, wären acht Scans still verloren — und
    // der einzige Hinweis darauf wäre eine Zahl, die von 8 auf 0 springt.
    const e = knopf({ action: 'CONTAM' }, [{ bag: 'BO-2608-01', batch: 'BO-2608' }]);
    assert.equal(e.formular, true, 'gesammelte Beutel gehören ins Formular, nicht in den Papierkorb');
    assert.equal(e.action, 'CONTAM', 'der Vorgang bleibt stehen — die nächste Reihe kommt gleich');
  });
});

// closeCamScan() gegen Attrappen: die Kamera zuzumachen ist am Telefon das
// Zeichen "fertig", und der grüne Haken tut nichts anderes.
function kameraZu(zustand, ziele, entwurf) {
  return new Function(
    'scan',
    '_crTargets',
    '_crResumeForm',
    `
    let formular = false;
    const el = { hidden: false, classList: { remove() {}, add() {}, contains: () => false } };
    const document = { getElementById: () => el };
    function crFinishCollect() { formular = true; }
    let _inocScanPrefix = null;
    function msqRestoreAfterScan() {}
    let _zcScanMode = false;
    function renderZoneCheck() {}
    let _camTorchOn = false;
    const CAM_IDLE = 'idle';
    const CAM_CLOSING = 'closing';
    let _camState = CAM_IDLE;
    let _camScanner = null;
    ${hebeFunktion('closeCamScan', APP)}
    closeCamScan();
    return { formular };
  `
  )(zustand, ziele, entwurf);
}

describe('die Kamera zumachen, wenn gesammelt wurde', () => {
  it('öffnet das Formular über den gesammelten Beuteln', () => {
    // Der grüne Haken heißt "fertig mit Scannen". Ohne diesen Weg führte er
    // ins Leere: Kamera zu, acht markierte Beutel unsichtbar liegen geblieben,
    // und nichts auf dem Schirm, das noch von ihnen wüsste.
    const e = kameraZu({ action: 'CONTAM' }, [{ bag: 'BO-2608-01', batch: 'BO-2608' }], false);
    assert.equal(e.formular, true);
  });

  it('bringt auch den Entwurf zurück, wenn nichts dazugekommen ist', () => {
    // "+ Beutel scannen" und dann doch nichts gefunden: das halb ausgefüllte
    // Formular muss trotzdem wiederkommen.
    assert.equal(kameraZu({ action: 'CONTAM' }, [], true).formular, true);
  });

  it('lässt jede andere Kamera in Ruhe', () => {
    assert.equal(kameraZu({ action: 'CONTAM' }, [], false).formular, false, 'ohne Sammlung gibt es nichts zu melden');
    assert.equal(kameraZu({ action: null }, [], false).formular, false);
    // Vorgang abgeräumt und einen Beutel nachgeschlagen: dann gehört das
    // Beutel-Fenster nach vorn und nicht ein alter Entwurf davor.
    assert.equal(kameraZu({ action: 'MOVE' }, [{ bag: 'BO-2608-01', batch: 'BO-2608' }], true).formular, false);
  });
});

// Die zwei Wege aus dem Formular heraus, gegen eine Attrappe des Fensters.
function schliessen(weg, ziele) {
  return new Function(
    'ziele',
    `
    let _crTargets = ziele;
    let _crPhotos = [{ data_url: 'x' }];
    let _crResumeForm = false;
    const document = { getElementById: () => ({ classList: { remove() {} } }) };
    function updateSD() {}
    ${hebeFunktion('crStashReport', APP)}
    ${hebeFunktion('closeContamReport', APP)}
    ${weg}();
    return { gesammelt: _crTargets.length, fotos: _crPhotos.length, zurueck: _crResumeForm };
  `
  )(ziele);
}

describe('das Formular verlassen', () => {
  const zwei = () => [
    { bag: 'BO-2608-01', batch: 'BO-2608' },
    { bag: 'BO-2608-02', batch: 'BO-2608' }
  ];

  it('legt es beim × zur Seite, ohne die Scans wegzuwerfen', () => {
    // Am Telefon hält der Daumen den Rand, und der Rand schließt das Fenster.
    // Als ein Bericht ein Beutel war, kostete ein Fehltipp ein Formular; jetzt
    // kostete er acht Scans.
    const e = schliessen('crStashReport', zwei());
    assert.equal(e.gesammelt, 2, 'die gescannten Beutel bleiben stehen');
    assert.equal(e.fotos, 1, 'und der Entwurf mit ihnen');
    assert.equal(e.zurueck, true, 'der nächste Weg ins Formular bringt beides zurück');
  });

  it('wirft beim Abbrechen alles weg', () => {
    // Der eine Weg, der wirklich verwirft. Ohne ihn stünden die Beutel beim
    // nächsten Bericht wieder da, und niemand würde sie dort suchen.
    const e = schliessen('closeContamReport', zwei());
    assert.equal(e.gesammelt, 0);
    assert.equal(e.fotos, 0);
    assert.equal(e.zurueck, false);
  });
});

// contamReportTargets() aus server.js: welche Beutel ein Rumpf nennt.
function ziele(data) {
  return new Function(
    'data',
    `
    ${hebeFunktion('contamReportTargets', SERVER)}
    return contamReportTargets(data);
  `
  )(data);
}

describe('was der Server aus einem Rumpf liest', () => {
  it('nimmt die Liste, wenn eine da ist', () => {
    const t = ziele({
      bags: [
        { bag_id: 'BO-2608-01', batch_id: 'BO-2608', report_uuid: 'a' },
        { bag_id: 'BO-2608-02', batch_id: 'BO-2608', report_uuid: 'b' }
      ]
    });
    assert.equal(t.length, 2);
    assert.equal(t[1].bag_id, 'BO-2608-02');
    assert.equal(t[1].report_uuid, 'b');
  });

  it('liest ohne Liste die flachen Felder', () => {
    // Das ist die Form, die vor dieser Änderung in die Offline-Warteschlange
    // gelegt wurde. Der Server sieht sie nach dem Update noch — die
    // Warteschlange überlebt den Neustart, und der Rumpf darin ändert sich
    // nicht mehr.
    const t = ziele({ bag_id: 'BO-2608-01', batch_id: 'BO-2608', report_uuid: 'a' });
    assert.deepEqual(t, [{ bag_id: 'BO-2608-01', batch_id: 'BO-2608', report_uuid: 'a' }]);
  });

  it('gibt auch für den Bericht über eine Charge genau ein Ziel', () => {
    const t = ziele({ batch_id: 'BO-2608' });
    assert.equal(t.length, 1);
    assert.equal(t[0].bag_id, null);
    assert.equal(t[0].batch_id, 'BO-2608');
  });
});
