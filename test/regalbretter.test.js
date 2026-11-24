'use strict';
// Regalbretter (v122): ein Regal hat Bretter und traegt eine Art. Ein Beutel
// steht auf einem Brett, wenn sein Platz "<Regal>:<Ebene>" ist. Je Art gibt es
// Hoechstzeiten; was laenger steht, bucht die App selbst aus und zeigt es, bis
// jemand "Stimmt" oder "Noch da" sagt.
//
// Alle Zahlen hier sind erfunden: eine Testart mit runden Tagen, keine aus dem Labor.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');
const { routen } = require('./helpers/routen');

const DAY = 86400000;
const NOW = new Date('2026-03-01T10:00:00.000Z');
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

function tmpDb() {
  const p = path.join(os.tmpdir(), 'mt_bretter_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  return { path: p, db: db.openDb(p) };
}
function aufraeumen(p) {
  for (const f of [p, p + '-wal', p + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
}

// Eine Charge der Testart mit n Beuteln, gemacht vor `tage` Tagen.
function charge(d, strainId, id, n, tage, batchType = 'block') {
  const bags = Array.from({ length: n }, (_, i) => ({ id: id + '-' + String(i + 1).padStart(2, '0'), bagKg: 3 }));
  db.insertBatch(
    d,
    {
      batchId: id,
      strainId,
      qty: n,
      days: 10,
      substrate: {},
      bagKg: 3,
      batchType,
      notes: '',
      created: ago(tage),
      due: ago(tage - 10),
      bags
    },
    null,
    null
  );
  return bags.map((b) => b.id);
}
function stelle(d, bags, batch, to, tage, action = 'ADD') {
  db.appendScanEntries(
    d,
    bags.map((bag) => ({ time: ago(tage), action, batch, bag, from: null, to })),
    null
  );
}
function letzter(d, bag) {
  const row = d
    .prepare('SELECT action, "to", "from", reason FROM scan_log WHERE bag = ? ORDER BY id DESC LIMIT 1')
    .get(bag);
  return row ? { ...row } : row;
}

describe('Regalbretter: Regal, Bretter, Art', () => {
  let d, p, sid;
  beforeEach(() => {
    ({ db: d, path: p } = tmpDb());
    sid = Number(db.createMushroomStrain(d, { name: 'Testpilz', kuerzel: 'TP' }));
  });
  afterEach(() => {
    d.close();
    aufraeumen(p);
  });

  it('ein Regal hat anfangs keine Bretter und keine Art, und /api/data sagt das', () => {
    const r = db.readAll(d).zones.find((z) => z.id === 'INC').racks[0];
    assert.equal(r.levels, 0);
    assert.equal(r.strainId, null);
  });

  it('setzt Bretter und Art, und jedes Brett bekommt eine eigene Etikett-Nummer', () => {
    assert.deepEqual(db.setRackShelves(d, 'INC_R1', { levels: 3, strainId: sid }), { levels: 3, strainId: sid });
    const r = db
      .readAll(d)
      .zones.find((z) => z.id === 'INC')
      .racks.find((x) => x.id === 'INC_R1');
    assert.equal(r.levels, 3);
    assert.equal(r.strainId, sid);
    const nummern = db.getAllBarcodes(d).filter((b) => b.entity_type === 'brett');
    assert.deepEqual(
      nummern.map((b) => b.entity_id),
      ['INC_R1:1', 'INC_R1:2', 'INC_R1:3']
    );
    assert.equal(new Set(nummern.map((b) => b.barcode)).size, 3);
  });

  it('nimmt kein Brett weg, auf dem noch Beutel stehen, und sagt welches', () => {
    db.setRackShelves(d, 'INC_R1', { levels: 3 });
    const bags = charge(d, sid, 'TP-010326-01', 2, 5);
    stelle(d, bags, 'TP-010326-01', 'INC_R1:3', 5);
    assert.throws(() => db.setRackShelves(d, 'INC_R1', { levels: 2 }), /Fach 3 stehen noch 2 Beutel/);
    assert.equal(db.readAll(d).zones.find((z) => z.id === 'INC').racks[0].levels, 3);
  });

  it('ein leeres Brett faellt weg, seine Nummer bleibt ihm, und kommt es wieder, gilt das alte Etikett', () => {
    db.setRackShelves(d, 'INC_R1', { levels: 3 });
    const vorher = db.getAllBarcodes(d).find((b) => b.entity_id === 'INC_R1:3').barcode;
    db.setRackShelves(d, 'INC_R1', { levels: 2 });
    assert.equal(db.lookupBarcode(d, vorher).entity_id, 'INC_R1:3', 'die Nummer gehoert nie einem anderen Ding');
    db.setRackShelves(d, 'INC_R1', { levels: 3 });
    assert.equal(db.getAllBarcodes(d).find((b) => b.entity_id === 'INC_R1:3').barcode, vorher);
  });

  it('lehnt eine falsche Zahl, ein fremdes Regal und eine unbekannte Art ab', () => {
    assert.throws(() => db.setRackShelves(d, 'INC_R1', { levels: 21 }), /0 bis 20/);
    assert.throws(() => db.setRackShelves(d, 'INC_R1', { levels: 1.5 }), /ganze Zahl/);
    assert.throws(() => db.setRackShelves(d, 'GIBTSNICHT', { levels: 2 }), /gibt es nicht mehr/);
    assert.throws(() => db.setRackShelves(d, 'INC_R1', { strainId: 99999 }), /Art gibt es nicht/);
  });

  it('eine geloeschte Art verschwindet auch vom Regal', () => {
    db.setRackShelves(d, 'INC_R1', { strainId: sid });
    db.deleteMushroomStrain(d, sid);
    assert.equal(db.readAll(d).zones.find((z) => z.id === 'INC').racks[0].strainId, null);
  });
});

describe('Regalbretter: der Platz "<Regal>:<Ebene>"', () => {
  let d, p, sid;
  beforeEach(() => {
    ({ db: d, path: p } = tmpDb());
    sid = Number(db.createMushroomStrain(d, { name: 'Testpilz', kuerzel: 'TP' }));
    db.setRackShelves(d, 'INC_R1', { levels: 2 });
  });
  afterEach(() => {
    d.close();
    aufraeumen(p);
  });

  it('liest ein Brett als Regal und Ebene, alles andere nicht', () => {
    assert.deepEqual(db.shelfOfLocation('INC_R1:2'), { rackId: 'INC_R1', level: 2 });
    assert.equal(db.shelfOfLocation('INC_R1'), null);
    assert.equal(db.shelfOfLocation('INC:R1'), null, 'die alte Schreibweise Zone:Regal ist kein Brett');
    assert.equal(db.shelfOfLocation('INC_R1:0'), null);
    assert.equal(db.locationBase('INC_R1:2'), 'INC_R1');
  });

  it('ein Beutel auf einem Brett zaehlt in seiner Zone und auf seinem Regal', () => {
    const bags = charge(d, sid, 'TP-010326-01', 3, 2);
    stelle(d, bags, 'TP-010326-01', 'INC_R1:2', 2);
    assert.equal(db.zoneIdOfLocation(d, 'INC_R1:2'), 'INC');
    assert.equal(db.getBagZoneMap(d).get(bags[0]), 'INC');
    assert.equal(db.zoneBagCount(d, 'INC'), 3);
    assert.equal(db.rackBagCount(d, 'INC_R1'), 3);
    assert.throws(() => db.deleteRack(d, 'INC_R1'), /3 bags/, 'ein Regal mit Beuteln auf seinen Brettern bleibt');
  });

  it('ein Umzug von Brett zu Brett bleibt auf dem Regal, einer ins Zelt verlaesst es', () => {
    const bags = charge(d, sid, 'TP-010326-01', 2, 2);
    stelle(d, bags, 'TP-010326-01', 'INC_R1:1', 2);
    db.appendScanEntries(
      d,
      [{ time: ago(1), action: 'MOVE', batch: 'TP-010326-01', bag: bags[0], from: 'INC_R1:1', to: 'INC_R1:2' }],
      null
    );
    assert.equal(db.rackBagCount(d, 'INC_R1'), 2);
    db.appendScanEntries(
      d,
      [{ time: ago(0), action: 'MOVE', batch: 'TP-010326-01', bag: bags[1], from: 'INC_R1:1', to: 'TENT1' }],
      null
    );
    assert.equal(db.rackBagCount(d, 'INC_R1'), 1);
    assert.equal(db.zoneBagCount(d, 'INC'), 1);
  });
});

describe('Regalbretter: Hoechstzeiten je Art', () => {
  let d, p;
  beforeEach(() => {
    ({ db: d, path: p } = tmpDb());
  });
  afterEach(() => {
    d.close();
    aufraeumen(p);
  });

  it('speichert die Zahlen, leer heisst aus, und nur eine Aenderung setzt den Fristbeginn neu', () => {
    const id = Number(db.createMushroomStrain(d, { name: 'Testpilz', kuerzel: 'TP', incMaxDays: 30, tentMin: 2 }));
    let s = db.listMushroomStrains(d).find((x) => x.id === id);
    assert.equal(s.incMaxDays, 30);
    assert.equal(s.tentMin, 2);
    assert.equal(s.tentMaxDays, null);
    assert.ok(s.limitsSet);
    d.prepare('UPDATE mushroom_strains SET limits_set = ? WHERE id = ?').run(ago(50), id);
    db.updateMushroomStrain(d, id, { incMaxDays: 30, tentMin: 2, description: 'gleich' });
    s = db.listMushroomStrains(d).find((x) => x.id === id);
    assert.equal(s.limitsSet, ago(50), 'dieselben Zahlen noch einmal gesendet: kein neuer Beginn');
    db.updateMushroomStrain(d, id, { incMaxDays: '', tentMaxDays: 40 });
    s = db.listMushroomStrains(d).find((x) => x.id === id);
    assert.equal(s.incMaxDays, null);
    assert.equal(s.tentMaxDays, 40);
    assert.notEqual(s.limitsSet, ago(50));
  });

  it('eine Aenderung an Name oder Rezept laesst die Zahlen stehen', () => {
    const id = Number(db.createMushroomStrain(d, { name: 'Testpilz', kuerzel: 'TP', grainMaxDays: 60 }));
    db.updateMushroomStrain(d, id, { name: 'Testpilz zwei', recIncDays: 12 });
    assert.equal(db.listMushroomStrains(d).find((x) => x.id === id).grainMaxDays, 60);
  });
});

describe('Regalbretter: was die App von selbst ausbucht', () => {
  let d, p, sid;
  beforeEach(() => {
    ({ db: d, path: p } = tmpDb());
    sid = Number(
      db.createMushroomStrain(d, {
        name: 'Testpilz',
        kuerzel: 'TP',
        incMaxDays: 30,
        grainMaxDays: 50,
        tentMaxDays: 20
      })
    );
    // Die Zahlen gelten seit langem; sonst laeuft die Schonfrist ab heute.
    d.prepare('UPDATE mushroom_strains SET limits_set = ?').run(ago(100));
    db.setRackShelves(d, 'INC_R1', { levels: 2, strainId: sid });
  });
  afterEach(() => {
    d.close();
    aufraeumen(p);
  });

  it('im Zelt: nach der Zeltzeit ausgebucht, mit Grund "auto", und ein zweiter Lauf bucht nichts doppelt', () => {
    const bags = charge(d, sid, 'TP-010126-01', 2, 60);
    stelle(d, bags, 'TP-010126-01', 'TENT1', 25);
    const out = db.autoBookOuts(d, NOW);
    assert.equal(out.length, 2);
    assert.deepEqual(letzter(d, bags[0]), { action: 'REMOVE', to: null, from: 'TENT1', reason: 'auto' });
    assert.deepEqual(
      db.listAutoBookouts(d).map((a) => a.bag),
      bags
    );
    assert.equal(db.autoBookOuts(d, NOW).length, 0);
  });

  it('im Zelt: vor der Zeltzeit bleibt der Block', () => {
    const bags = charge(d, sid, 'TP-010126-01', 1, 60);
    stelle(d, bags, 'TP-010126-01', 'TENT1', 15);
    assert.equal(db.autoBookOuts(d, NOW).length, 0);
  });

  // NOW ist Sonntag, der 1.3.2026, 11 Uhr Ortszeit. Der Montags-Check ist der
  // 2.3. um 0 Uhr Ortszeit, der nächste der 9.3.
  const MONTAG = new Date(2026, 2, 2);
  const MONTAG_DANACH = new Date(2026, 2, 9);
  const SONNTAG_SPAET = new Date(2026, 2, 8, 23);

  it('in der Inkubation: gefragt am Montag danach, ausgebucht eine Woche später, ohne zweite Frage', () => {
    const bags = charge(d, sid, 'TP-010126-01', 1, 34);
    stelle(d, bags, 'TP-010126-01', 'INC_R1:1', 34);
    const [f] = db.brettFristen(d);
    assert.equal(f.kind, 'inc');
    assert.equal(f.limitAt, NOW.getTime() - 4 * DAY, 'Hoechstzeit seit vier Tagen vorbei');
    assert.equal(f.askAt, MONTAG.getTime(), 'gefragt wird im naechsten Montags-Check');
    assert.equal(f.outAt, MONTAG_DANACH.getTime(), 'ausgebucht eine Woche nach dem Check');
    assert.equal(db.autoBookOuts(d, NOW).length, 0);
    assert.equal(db.autoBookOuts(d, SONNTAG_SPAET).length, 0, 'die ganze Woche des Checks nicht');
    assert.equal(db.autoBookOuts(d, MONTAG_DANACH).length, 1);
    assert.deepEqual(db.listAutoBookouts(d), [], 'die Frage war der Check, eine zweite gibt es nicht');
    assert.equal(d.prepare('SELECT resolved FROM auto_bookouts').get().resolved, 'silent');
  });

  it('eine frisch eingetragene Zahl leert keinen Raum auf einmal', () => {
    const bags = charge(d, sid, 'TP-010126-01', 3, 90);
    stelle(d, bags, 'TP-010126-01', 'INC_R1:1', 90);
    d.prepare('UPDATE mushroom_strains SET limits_set = ?').run(NOW.toISOString());
    assert.equal(db.autoBookOuts(d, NOW).length, 0);
    assert.equal(db.autoBookOuts(d, SONNTAG_SPAET).length, 0);
    assert.equal(db.autoBookOuts(d, MONTAG_DANACH).length, 3);
  });

  it('im Zelt: ohne Antwort gilt das Ausbuchen eine Woche nach dem Check als "Stimmt"', () => {
    const bags = charge(d, sid, 'TP-010126-01', 1, 60);
    stelle(d, bags, 'TP-010126-01', 'TENT1', 25);
    assert.equal(db.autoBookOuts(d, NOW).length, 1);
    assert.equal(db.listAutoBookouts(d).length, 1, 'offen fuer den Check am Montag');
    db.autoBookOuts(d, SONNTAG_SPAET);
    assert.equal(db.listAutoBookouts(d).length, 1, 'die Woche des Checks lang');
    assert.deepEqual(db.autoBookOuts(d, MONTAG_DANACH), [], 'nichts Neues ausgebucht');
    assert.equal(db.listAutoBookouts(d).length, 0);
    assert.equal(d.prepare('SELECT resolved FROM auto_bookouts').get().resolved, 'silent');
    assert.equal(letzter(d, bags[0]).action, 'REMOVE', 'er bleibt draussen');
  });

  it('Koernerbrut rechnet mit ihrer eigenen Hoechstzeit', () => {
    const bags = charge(d, sid, 'G-TP-010126-01', 1, 45, 'grain');
    stelle(d, bags, 'G-TP-010126-01', 'SPAWN_R1', 45);
    assert.equal(db.brettFristen(d)[0].limitAt, NOW.getTime() + 5 * DAY);
  });

  it('"Noch da" ueberspringt einen Check: gefragt wird im uebernaechsten', () => {
    const bags = charge(d, sid, 'TP-010126-01', 1, 34);
    stelle(d, bags, 'TP-010126-01', 'INC_R1:1', 34);
    // NOW ist Sonntag, der 1.3., der letzte Tag der Woche ab Montag, dem 23.2.:
    // zwei Wochen nach deren Anfang ist Montag, der 9.3.
    assert.equal(db.confirmStillThere(d, [bags[0], 'GIBTS-NICHT'], null, NOW), 1);
    const [f] = db.brettFristen(d);
    assert.equal(f.limitAt, MONTAG_DANACH.getTime());
    assert.equal(f.askAt, MONTAG_DANACH.getTime());
    assert.deepEqual(Object.keys(db.listStillThere(d, NOW)), bags);
    assert.ok('stillThere' in db.readAll(d), '/api/data traegt die Bestaetigungen mit');
  });

  it('"Noch da" am Montag um 9 Uhr: wieder gefragt genau zwei Montage spaeter, nicht drei', () => {
    const bags = charge(d, sid, 'TP-010126-01', 1, 34);
    stelle(d, bags, 'TP-010126-01', 'INC_R1:1', 34);
    db.confirmStillThere(d, bags, null, new Date(2026, 2, 2, 9));
    const [f] = db.brettFristen(d);
    assert.equal(f.askAt, new Date(2026, 2, 16).getTime());
    assert.equal(f.outAt, new Date(2026, 2, 23).getTime());
  });

  it('kontaminierte Beutel und Arten ohne Zahl haben keine Frist', () => {
    const ohne = Number(db.createMushroomStrain(d, { name: 'Ohnepilz', kuerzel: 'OP' }));
    const a = charge(d, ohne, 'OP-010126-01', 1, 300);
    stelle(d, a, 'OP-010126-01', 'INC_R1:2', 300);
    const b = charge(d, sid, 'TP-010126-02', 1, 300);
    stelle(d, b, 'TP-010126-02', 'CONTAM', 300);
    assert.deepEqual(db.brettFristen(d), []);
  });

  it('"Stimmt" laesst sie draussen, "Noch da" stellt sie zurueck an ihren Platz', () => {
    // Im Zelt: dort bucht die App ohne Frage aus, und der Check fragt danach.
    const bags = charge(d, sid, 'TP-010126-01', 2, 60);
    stelle(d, bags, 'TP-010126-01', 'TENT1', 25);
    const out = db.autoBookOuts(d, NOW);
    assert.equal(out.length, 2);
    const [eins, zwei] = db.listAutoBookouts(d);
    assert.deepEqual(db.resolveAutoBookouts(d, [eins.id], 'correct', null, NOW), { resolved: 1, restored: 0 });
    assert.equal(letzter(d, eins.bag).action, 'REMOVE');
    assert.deepEqual(db.resolveAutoBookouts(d, [zwei.id], 'still_there', null, NOW), { resolved: 1, restored: 1 });
    assert.deepEqual(letzter(d, zwei.bag), { action: 'ADD', to: 'TENT1', from: null, reason: 'still-there' });
    assert.equal(db.listAutoBookouts(d).length, 0);
    assert.equal(db.autoBookOuts(d, NOW).length, 0, 'zurueckgestellt zaehlt die Frist neu');
  });

  it('"Noch da" im Zelt gibt zwei Wochen, nicht die ganze Zeltzeit', () => {
    const bags = charge(d, sid, 'TP-010126-01', 1, 60);
    stelle(d, bags, 'TP-010126-01', 'TENT1', 25);
    db.autoBookOuts(d, NOW);
    db.resolveAutoBookouts(d, [db.listAutoBookouts(d)[0].id], 'still_there', null, NOW);
    assert.equal(db.brettFristen(d)[0].limitAt, NOW.getTime() + 14 * DAY);
  });

  it('ist der Beutel inzwischen anders zurueck, wird "Noch da" nur abgehakt', () => {
    const bags = charge(d, sid, 'TP-010126-01', 1, 60);
    stelle(d, bags, 'TP-010126-01', 'TENT1', 25);
    db.autoBookOuts(d, NOW);
    stelle(d, bags, 'TP-010126-01', 'TENT1', 0);
    assert.deepEqual(db.resolveAutoBookouts(d, [db.listAutoBookouts(d)[0].id], 'still_there', null, NOW), {
      resolved: 1,
      restored: 0
    });
  });

  it('zaehlt in der Kontaminationsauswertung nicht als Kontamination', () => {
    const bags = charge(d, sid, 'TP-010126-01', 1, 60);
    stelle(d, bags, 'TP-010126-01', 'TENT1', 25);
    db.autoBookOuts(d, NOW);
    const rows = d
      .prepare(
        "SELECT COUNT(*) AS c FROM scan_log WHERE action IN ('MOVE','REMOVE') AND reason IS NOT NULL AND reason <> 'spawn' AND reason NOT LIKE 'spawn:%' AND reason <> 'undo' AND reason <> 'sold' AND reason <> 'count' AND reason <> 'auto'"
      )
      .get();
    assert.equal(rows.c, 0);
    const src = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
    assert.match(
      src,
      /reason <> 'count' AND reason <> 'auto' ORDER BY id/,
      'getContaminationReport schliesst "auto" aus'
    );
  });

  it('der Neustart der Daten nimmt "Noch da" und die Ausbuchungen mit', () => {
    const bags = charge(d, sid, 'TP-010126-01', 1, 60);
    stelle(d, bags, 'TP-010126-01', 'TENT1', 25);
    db.autoBookOuts(d, NOW);
    db.confirmStillThere(d, bags, null, NOW);
    db.resetOperationalData(d, { growing: true });
    assert.equal(d.prepare('SELECT COUNT(*) AS c FROM auto_bookouts').get().c, 0);
    assert.equal(d.prepare('SELECT COUNT(*) AS c FROM bag_still_there').get().c, 0);
  });
});

describe('Regalbretter: die Routen', () => {
  const ABSCHNITT = {
    name: 'regalbretter',
    von: '// -- Regalbretter --',
    bis: '// -- Ende Regalbretter --',
    helfer: [
      'jsonOk',
      'jsonErr',
      'safeErr',
      'requireAdmin',
      'validateEnum',
      'validateBagId',
      'validateBagKg',
      'validateBagList',
      'validateRackShelves'
    ],
    konstanten: ['ID_CHARSET_RE']
  };
  const ADMIN = { user_id: 8, username: 'max', role: 'admin' };
  let r;
  beforeEach(() => {
    r = routen(ABSCHNITT, {
      benutzer: [
        { id: 7, username: 'erika' },
        { id: 8, username: 'max', role: 'admin' }
      ]
    });
  });

  it('Bretter und Art stellt nur ein Admin ein', async () => {
    const nein = await r.anfrage('PATCH', '/api/racks/INC_R1', { levels: 2 });
    assert.equal(nein.status, 403);
    const ja = await r.anfrage('PATCH', '/api/racks/INC_R1', { levels: 2, strainId: null }, ADMIN);
    assert.equal(ja.status, 200);
    assert.deepEqual(ja.json, { levels: 2, strainId: null });
  });

  it('sagt in Worten, was an der Eingabe falsch ist', async () => {
    const leer = await r.anfrage('PATCH', '/api/racks/INC_R1', {}, ADMIN);
    assert.equal(leer.status, 400);
    const viel = await r.anfrage('PATCH', '/api/racks/INC_R1', { levels: 40 }, ADMIN);
    assert.match(viel.json.error, /0 to 20/);
    const weg = await r.anfrage('PATCH', '/api/racks/NIRGENDS', { levels: 2 }, ADMIN);
    assert.match(weg.json.error, /gibt es nicht mehr/);
  });

  it('"Noch da" nimmt eine Liste von Beuteln', async () => {
    const leer = await r.anfrage('POST', '/api/bags/still-there', { bags: [] });
    assert.equal(leer.status, 400);
    const ok = await r.anfrage('POST', '/api/bags/still-there', { bags: ['TP-010126-01-01'] });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { confirmed: 0 }, 'einen unbekannten Beutel bestaetigt niemand');
  });

  it('die Antwort auf eine Ausbuchung ist "correct" oder "still_there"', async () => {
    const falsch = await r.anfrage('POST', '/api/auto-bookouts/resolve', { ids: [1], how: 'vielleicht' });
    assert.equal(falsch.status, 400);
    const keine = await r.anfrage('POST', '/api/auto-bookouts/resolve', { ids: ['eins'], how: 'correct' });
    assert.equal(keine.status, 400);
    const ok = await r.anfrage('POST', '/api/auto-bookouts/resolve', { ids: [1], how: 'correct' });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { resolved: 0, restored: 0 });
  });
});
