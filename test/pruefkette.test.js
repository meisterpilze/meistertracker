'use strict';
// Die Pruefkette ueber den Verlauf des Laborbuchs und die Zeitstempel auf ihr.
//
// Worauf es ankommt: jeder Eintrag bekommt sein Glied in derselben Transaktion
// wie er selbst, und nur seins; v97 verkettet, was schon da ist, ohne einen
// Eintrag anzufassen; eine Aenderung an der Datei vorbei zeigt sich genau an
// der Stelle, ob ein Eintrag geaendert, geloescht oder ohne Glied eingeschoben
// wurde; was eine aeltere Version ohne Glied ans Ende schrieb, nimmt der
// naechste Start oder Eintrag auf, nie ohne einen Vermerk, den die Pruefung
// immer nennt, und mitten im Verlauf gar nicht;
// wer alle Glieder neu rechnet, passt nicht mehr zum Token des Zeitstempels;
// ein Zeitstempel wird nur zu einem Glied gespeichert, das es so gibt; und der
// Dienst stempelt einmal am Tag, nur wenn etwas dazukam, und sagt, was
// schiefging.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const db = require('../db.js');
const { quelle, hebe, hebeFunktion } = require('./helpers/quelle');
const { createLabTimestamps, tsaFromEnv, shownTsa, DEFAULT_TSA } = require('../scripts/lab-timestamps.js');
const { tokenFuer, hex, tstInfo, zertifikat, alsCa, alsStelle, signiertesToken } = require('./helpers/tsa');

const ANNA = { user_id: 7, username: 'anna' };

function datenbank() {
  const p = path.join(os.tmpdir(), 'mt_pruefkette_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
  const d = db.openDb(p);
  d.prepare('INSERT INTO users(id,username,hash,salt,role,created) VALUES(?,?,?,?,?,?)').run(
    7,
    'anna',
    'x',
    'y',
    'user',
    new Date().toISOString()
  );
  return {
    p,
    d,
    weg() {
      try {
        this.d.close();
      } catch {
        // schon zu
      }
      for (const n of ['', '-wal', '-shm']) fs.rmSync(p + n, { force: true });
    }
  };
}
// Was ein Glied ist, hier noch einmal unabhaengig von db.js aufgeschrieben:
// aendert sich die Rechnung dort, passt keine gespeicherte Kette mehr.
function glied(vorher, z) {
  const eintrag = JSON.stringify([
    z.id,
    z.at,
    z.user_id,
    z.username,
    z.entity,
    z.entity_id,
    z.experiment_id,
    z.action,
    z.field,
    z.old_value,
    z.new_value
  ]);
  return crypto
    .createHash('sha256')
    .update(vorher + '\n' + eintrag, 'utf8')
    .digest('hex');
}
function glieder(d) {
  return d.prepare('SELECT history_id, hash FROM lab_history_chain ORDER BY history_id').all();
}
function anVorbei(d, sql, ...werte) {
  // Wer die Datei in der Hand hat: Trigger ab, aendern. openDb setzt sie beim
  // naechsten Oeffnen wieder.
  d.exec('DROP TRIGGER IF EXISTS lab_history_no_update; DROP TRIGGER IF EXISTS lab_history_no_delete;');
  d.exec('DROP TRIGGER IF EXISTS lab_history_chain_no_update; DROP TRIGGER IF EXISTS lab_history_chain_no_delete;');
  d.prepare(sql).run(...werte);
}

describe('Pruefkette: Glieder', () => {
  let x;
  before(() => {
    x = datenbank();
  });
  after(() => x.weg());

  it('gibt jedem Eintrag sein Glied, ueber das Glied davor und den Eintrag selbst', () => {
    const v = db.insertExperiment(x.d, { code: 'K1', title: 'Kettenlauf', started: '2026-10-01' }, ANNA);
    db.updateExperiment(x.d, v, { title: 'Kettenlauf, neu', outcome: 'gut' }, ANNA);
    db.insertWorkPackage(x.d, { code: 'K-AP', title: 'Paket' }, ANNA);
    const eintraege = x.d.prepare('SELECT * FROM lab_history ORDER BY id').all();
    const g = glieder(x.d);
    assert.equal(g.length, eintraege.length);
    let vorher = '0'.repeat(64);
    eintraege.forEach((z, i) => {
      vorher = glied(vorher, z);
      assert.equal(g[i].history_id, z.id);
      assert.equal(g[i].hash, vorher);
    });
    const k = db.labChainStatus(x.d);
    assert.equal(k.ok, true);
    assert.equal(k.entries, eintraege.length);
    assert.equal(k.chained, eintraege.length);
    assert.equal(k.brokenTotal, 0);
    assert.deepEqual(k.head, { historyId: eintraege.at(-1).id, hash: vorher });
    assert.equal(k.stamps, 0);
    assert.equal(k.lastStamp, null);
  });

  it('schreibt kein Glied, wenn die Aenderung zurueckgenommen wird', () => {
    const vorher = glieder(x.d).length;
    const v = x.d.prepare("SELECT id FROM experiments WHERE code='K1'").get().id;
    x.d.exec("CREATE TRIGGER test_kein_update BEFORE UPDATE ON experiments BEGIN SELECT RAISE(ABORT, 'nein'); END");
    try {
      assert.throws(() => db.updateExperiment(x.d, v, { title: 'nie' }, ANNA), /nein/);
    } finally {
      x.d.exec('DROP TRIGGER test_kein_update');
    }
    assert.equal(glieder(x.d).length, vorher);
    assert.equal(db.labChainStatus(x.d).ok, true);
  });

  it('laesst sich nur anhaengen, Glieder und Zeitstempel', () => {
    assert.throws(() => x.d.prepare("UPDATE lab_history_chain SET hash='x'").run(), /append-only/);
    assert.throws(() => x.d.prepare('DELETE FROM lab_history_chain').run(), /append-only/);
    const kopf = db.labChainHead(x.d);
    db.insertLabTimestamp(x.d, {
      ...kopf,
      tsa: 'http://tsa.example',
      requested: '2026-10-03T10:00:00.000Z',
      genTime: '2026-10-03T10:00:01.000Z',
      serial: '01',
      token: tokenFuer(kopf.hash)
    });
    assert.throws(() => x.d.prepare("UPDATE lab_timestamps SET serial='02'").run(), /append-only/);
    assert.throws(() => x.d.prepare('DELETE FROM lab_timestamps').run(), /append-only/);
  });

  it('speichert einen Zeitstempel nur zu einem Glied, das es so gibt, und nur mit einem Token darueber', () => {
    const kopf = db.labChainHead(x.d);
    const stempel = (s) => ({
      tsa: 'http://tsa.example',
      requested: '2026-10-03T11:00:00.000Z',
      genTime: '2026-10-03T11:00:01.000Z',
      serial: '03',
      token: tokenFuer(kopf.hash),
      ...s
    });
    assert.equal(db.insertLabTimestamp(x.d, stempel({ historyId: kopf.historyId, hash: 'f'.repeat(64) })), null);
    assert.equal(db.insertLabTimestamp(x.d, stempel({ historyId: kopf.historyId + 50, hash: kopf.hash })), null);
    assert.equal(
      db.insertLabTimestamp(x.d, stempel({ ...kopf, token: tokenFuer('e'.repeat(64)) })),
      null,
      'a token about another hash'
    );
    assert.equal(db.insertLabTimestamp(x.d, stempel({ ...kopf, token: Buffer.from([4]) })), null, 'not a token');
    const id = db.insertLabTimestamp(x.d, stempel(kopf));
    assert.ok(id);
    // Zeit und Seriennummer sind die aus dem Token (tokenFuer: 09:37:28,
    // 0a0b0c), nicht die, die der Aufrufer nannte.
    assert.deepEqual(db.lastLabTimestamp(x.d), {
      id,
      historyId: kopf.historyId,
      hash: kopf.hash,
      tsa: 'http://tsa.example',
      requested: '2026-10-03T11:00:00.000Z',
      genTime: '2026-10-03T09:37:28.000Z',
      serial: '0a0b0c'
    });
    const alle = db.listLabTimestamps(x.d);
    assert.equal(alle.length, 2);
    assert.ok(Buffer.from(alle[1].token).equals(tokenFuer(kopf.hash)), 'the token comes back as it was stored');
    const k = db.labChainStatus(x.d);
    assert.equal(k.stamps, 2);
    assert.equal(k.ok, true);
  });
});

describe('Pruefkette: was an der Anwendung vorbei geaendert wird', () => {
  function mitVerlauf() {
    const x = datenbank();
    const v = db.insertExperiment(x.d, { code: 'M1', title: 'Manipulation', started: '2026-10-01' }, ANNA);
    for (const titel of ['zwei', 'drei', 'vier']) db.updateExperiment(x.d, v, { title: titel }, ANNA);
    return {
      x,
      ids: x.d
        .prepare('SELECT id FROM lab_history ORDER BY id')
        .all()
        .map((z) => z.id)
    };
  }

  it('zeigt einen geaenderten Eintrag genau an seiner Stelle, auch nach dem naechsten Oeffnen', () => {
    const { x, ids } = mitVerlauf();
    try {
      anVorbei(x.d, "UPDATE lab_history SET new_value='geschoent' WHERE id=?", ids[2]);
      assert.deepEqual(db.labChainStatus(x.d).broken, [{ id: ids[2], reason: 'changed' }]);
      x.d.close();
      x.d = db.openDb(x.p);
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, false);
      assert.deepEqual(k.broken, [{ id: ids[2], reason: 'changed' }]);
      // Was danach geschrieben wird, haengt am gespeicherten Glied: der Bruch
      // bleibt, wo er ist, und waechst nicht.
      db.updateExperiment(
        x.d,
        x.d.prepare("SELECT id FROM experiments WHERE code='M1'").get().id,
        { title: 'fuenf' },
        ANNA
      );
      assert.deepEqual(db.labChainStatus(x.d).broken, [{ id: ids[2], reason: 'changed' }]);
    } finally {
      x.weg();
    }
  });

  it('zeigt einen geloeschten Eintrag', () => {
    const { x, ids } = mitVerlauf();
    try {
      anVorbei(x.d, 'DELETE FROM lab_history WHERE id=?', ids[1]);
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, false);
      assert.deepEqual(k.broken[0], { id: ids[1], reason: 'missing' });
    } finally {
      x.weg();
    }
  });

  it('zeigt einen Eintrag, dem sein Glied genommen wurde, als ohne Glied', () => {
    const { x, ids } = mitVerlauf();
    try {
      anVorbei(x.d, 'DELETE FROM lab_history_chain WHERE history_id=?', ids[1]);
      assert.deepEqual(db.labChainStatus(x.d).broken[0], { id: ids[1], reason: 'unlinked' });
    } finally {
      x.weg();
    }
  });

  it('zeigt am Token des Zeitstempels, wenn jemand ab einer Stelle alle Glieder neu gerechnet hat', () => {
    const { x, ids } = mitVerlauf();
    try {
      const kopf = db.labChainHead(x.d);
      db.insertLabTimestamp(x.d, {
        ...kopf,
        tsa: 'http://tsa.example',
        requested: '2026-10-03T10:00:00.000Z',
        genTime: '2026-10-03T10:00:01.000Z',
        serial: '01',
        token: tokenFuer(kopf.hash)
      });
      // Eintrag aendern und die Glieder ab dort so neu rechnen, dass die Kette
      // in sich wieder stimmt.
      anVorbei(x.d, "UPDATE lab_history SET new_value='geschoent' WHERE id=?", ids[1]);
      x.d.exec('DELETE FROM lab_history_chain');
      let vorher = '0'.repeat(64);
      for (const z of x.d.prepare('SELECT * FROM lab_history ORDER BY id').all()) {
        vorher = glied(vorher, z);
        x.d.prepare('INSERT INTO lab_history_chain(history_id, hash) VALUES(?,?)').run(z.id, vorher);
      }
      assert.deepEqual(db.labChainStatus(x.d).broken, [{ id: kopf.historyId, reason: 'stamp' }]);
      // Auch die Spalte neben dem Token passend zu machen hilft nicht: das
      // Token nennt den Hash, den das Glied damals hatte.
      x.d.exec('DROP TRIGGER IF EXISTS lab_timestamps_no_update');
      x.d
        .prepare(
          'UPDATE lab_timestamps SET hash=(SELECT hash FROM lab_history_chain c WHERE c.history_id=lab_timestamps.history_id)'
        )
        .run();
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, false);
      assert.deepEqual(k.broken, [{ id: kopf.historyId, reason: 'stamp' }]);
    } finally {
      x.weg();
    }
  });

  it('nimmt Eintraege ohne Glied am Ende beim naechsten Start auf, und haelt das im Verlauf fest', () => {
    const { x } = mitVerlauf();
    try {
      // So schreibt eine aeltere Version, die die Kette nicht kennt: sie haengt
      // an, nur ohne Glied. Dafuer muss niemand einen Trigger abheben.
      const fremd = ['2026-10-04T12:00:00.000Z', '2026-10-04T12:05:00.000Z'].map((at) =>
        Number(
          x.d
            .prepare(
              "INSERT INTO lab_history(at,entity,entity_id,experiment_id,action,new_value) VALUES(?,'experiment',1,1,'update','{}')"
            )
            .run(at).lastInsertRowid
        )
      );
      assert.deepEqual(db.labChainStatus(x.d).broken, [{ id: fremd[0], reason: 'unlinked' }]);
      x.d.close();
      x.d = db.openDb(x.p);
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, true);
      assert.equal(k.chained, k.entries);
      assert.equal(k.adopted.length, 1);
      assert.deepEqual(
        { from: k.adopted[0].from, to: k.adopted[0].to, count: k.adopted[0].count },
        { from: fremd[0], to: fremd[1], count: 2 }
      );
      // Der Vermerk ist selbst ein Eintrag mit Glied, hinter den nachgetragenen,
      // und die Glieder sind die, die eine Version mit Kette geschrieben haette.
      const vermerk = x.d.prepare('SELECT * FROM lab_history WHERE id=?').get(k.adopted[0].id);
      assert.equal(vermerk.entity, 'chain');
      assert.equal(vermerk.action, 'adopt');
      assert.equal(vermerk.experiment_id, null);
      assert.ok(vermerk.id > fremd[1]);
      assert.equal(k.head.historyId, vermerk.id);
      let vorher = '0'.repeat(64);
      const erwartet = x.d
        .prepare('SELECT * FROM lab_history ORDER BY id')
        .all()
        .map((z) => ({ history_id: z.id, hash: (vorher = glied(vorher, z)) }));
      assert.deepEqual(
        glieder(x.d).map((g) => ({ ...g })),
        erwartet
      );
      // Ein zweiter Start traegt nichts mehr nach.
      x.d.close();
      x.d = db.openDb(x.p);
      assert.equal(db.labChainStatus(x.d).adopted.length, 1);
    } finally {
      x.weg();
    }
  });

  it('nimmt einen eingeschobenen Eintrag am Ende beim naechsten Speichern auf, nie ohne Vermerk', () => {
    const { x } = mitVerlauf();
    try {
      const fremd = Number(
        x.d
          .prepare(
            "INSERT INTO lab_history(at,entity,entity_id,experiment_id,action,new_value) VALUES('2026-09-01T12:00:00.000Z','experiment',1,1,'baseline','{}')"
          )
          .run().lastInsertRowid
      );
      const v = x.d.prepare("SELECT id FROM experiments WHERE code='M1'").get().id;
      db.updateExperiment(x.d, v, { title: 'danach' }, ANNA);
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, true);
      assert.equal(k.chained, k.entries);
      assert.deepEqual(
        k.adopted.map((a) => [a.from, a.to, a.count]),
        [[fremd, fremd, 1]],
        'linked before the new entry, and recorded'
      );
    } finally {
      x.weg();
    }
  });

  it('laesst einen Eintrag ohne Glied mitten im Verlauf ein Bruch, auch nach Speichern und Start', () => {
    const { x, ids } = mitVerlauf();
    try {
      anVorbei(x.d, 'DELETE FROM lab_history_chain WHERE history_id=?', ids[1]);
      const v = x.d.prepare("SELECT id FROM experiments WHERE code='M1'").get().id;
      db.updateExperiment(x.d, v, { title: 'danach' }, ANNA);
      x.d.close();
      x.d = db.openDb(x.p);
      db.updateExperiment(x.d, v, { title: 'und noch' }, ANNA);
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, false);
      assert.deepEqual(k.broken[0], { id: ids[1], reason: 'unlinked' });
      assert.deepEqual(k.adopted, [], 'only a tail is ever taken in');
    } finally {
      x.weg();
    }
  });

  it('vermerkt, wer ab einer Stelle aendert und die Glieder danach loescht, und der Zeitstempel bricht', () => {
    const { x, ids } = mitVerlauf();
    try {
      const kopf = db.labChainHead(x.d);
      db.insertLabTimestamp(x.d, {
        ...kopf,
        tsa: 'http://tsa.example',
        requested: '2026-10-03T10:00:00.000Z',
        genTime: '2026-10-03T10:00:01.000Z',
        serial: '01',
        token: tokenFuer(kopf.hash)
      });
      anVorbei(x.d, "UPDATE lab_history SET new_value='geschoent' WHERE id=?", ids[2]);
      x.d.prepare('DELETE FROM lab_history_chain WHERE history_id>=?').run(ids[2]);
      assert.deepEqual(db.labChainStatus(x.d).broken, [
        { id: ids[2], reason: 'unlinked' },
        { id: kopf.historyId, reason: 'stamp' }
      ]);
      x.d.close();
      x.d = db.openDb(x.p);
      const k = db.labChainStatus(x.d);
      // Der Start nimmt die Eintraege ab der Stelle auf, aber nicht stillschweigend ...
      assert.deepEqual(
        k.adopted.map((a) => [a.from, a.to, a.count]),
        [[ids[2], kopf.historyId, ids.length - 2]]
      );
      // ... und der Zeitstempel kennt das Glied von vorher: der Bruch bleibt.
      assert.equal(k.ok, false);
      assert.deepEqual(k.broken, [{ id: kopf.historyId, reason: 'stamp' }]);
    } finally {
      x.weg();
    }
  });

  it('laesst weiter speichern, wenn jemand ein Glied unter eine kuenftige Kennung geschrieben hat', () => {
    const { x } = mitVerlauf();
    try {
      const naechste = db.labChainHead(x.d).historyId + 1;
      x.d.prepare('INSERT INTO lab_history_chain(history_id, hash) VALUES(?,?)').run(naechste, 'f'.repeat(64));
      assert.deepEqual(db.labChainStatus(x.d).broken, [{ id: naechste, reason: 'missing' }]);
      const v = x.d.prepare("SELECT id FROM experiments WHERE code='M1'").get().id;
      db.updateExperiment(x.d, v, { title: 'danach' }, ANNA);
      db.updateExperiment(x.d, v, { title: 'und noch' }, ANNA);
      const k = db.labChainStatus(x.d);
      // Der Eintrag behaelt das fremde Glied und gilt als geaendert; was danach
      // kommt, haengt an ihm und passt.
      assert.deepEqual(k.broken, [{ id: naechste, reason: 'changed' }]);
      assert.equal(k.chained, k.entries);
    } finally {
      x.weg();
    }
  });

  it('nimmt ein Glied ohne Eintrag nicht als Kopf, auch weit voraus', () => {
    const { x } = mitVerlauf();
    try {
      const kopf = db.labChainHead(x.d);
      anVorbei(x.d, 'INSERT INTO lab_history_chain(history_id, hash) VALUES(?,?)', 1e9, 'f'.repeat(64));
      assert.deepEqual(db.labChainHead(x.d), kopf, 'the newest link with an entry');
      const v = x.d.prepare("SELECT id FROM experiments WHERE code='M1'").get().id;
      db.updateExperiment(x.d, v, { title: 'danach' }, ANNA);
      const k = db.labChainStatus(x.d);
      assert.equal(k.head.historyId, kopf.historyId + 1, 'a stamp now goes to the real newest entry');
      assert.deepEqual(k.broken, [{ id: 1e9, reason: 'missing' }]);
    } finally {
      x.weg();
    }
  });

  it('traegt beim naechsten Eintrag nach, wenn es beim Start nicht ging, auch nach einem zurueckgenommenen', () => {
    const { x } = mitVerlauf();
    try {
      const fremd = Number(
        x.d
          .prepare(
            "INSERT INTO lab_history(at,entity,entity_id,experiment_id,action,new_value) VALUES('2026-10-04T12:00:00.000Z','experiment',1,1,'update','{}')"
          )
          .run().lastInsertRowid
      );
      // Beim naechsten Start laesst sich kein Glied schreiben.
      x.d.exec(`CREATE TABLE sperre(x); INSERT INTO sperre VALUES(1);
        CREATE TRIGGER kette_gesperrt BEFORE INSERT ON lab_history_chain WHEN EXISTS (SELECT 1 FROM sperre)
        BEGIN SELECT RAISE(ABORT, 'gesperrt'); END;`);
      x.d.close();
      x.d = db.openDb(x.p);
      assert.deepEqual(db.labChainStatus(x.d).broken, [{ id: fremd, reason: 'unlinked' }], 'the start could not');
      x.d.exec('DELETE FROM sperre');
      const v = x.d.prepare("SELECT id FROM experiments WHERE code='M1'").get().id;
      // Nimmt der erste, der speichert, seine Transaktion zurueck, geht das
      // Nachtragen mit; der naechste versucht es wieder.
      x.d.exec('BEGIN');
      db.updateExperiment(x.d, v, { title: 'zurueckgenommen' }, ANNA);
      x.d.exec('ROLLBACK');
      assert.deepEqual(db.labChainStatus(x.d).adopted, []);
      db.updateExperiment(x.d, v, { title: 'danach' }, ANNA);
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, true, 'the next entry linked the tail first, not past it');
      assert.equal(k.chained, k.entries);
      assert.deepEqual(
        k.adopted.map((a) => [a.from, a.to]),
        [[fremd, fremd]]
      );
    } finally {
      x.weg();
    }
  });

  it('nennt die ersten Stellen nach Kennung, und wie viele es sind', () => {
    const { x, ids } = mitVerlauf();
    try {
      const v = x.d.prepare("SELECT id FROM experiments WHERE code='M1'").get().id;
      for (let i = 0; i < 12; i++) db.updateExperiment(x.d, v, { title: 'Lauf ' + i }, ANNA);
      const alle = x.d
        .prepare('SELECT id FROM lab_history ORDER BY id')
        .all()
        .map((z) => z.id);
      for (const id of alle.slice(-11)) anVorbei(x.d, "UPDATE lab_history SET new_value='x' WHERE id=?", id);
      anVorbei(x.d, 'DELETE FROM lab_history WHERE id=?', ids[0]);
      const k = db.labChainStatus(x.d);
      assert.equal(k.broken.length, 10);
      assert.deepEqual(k.broken[0], { id: ids[0], reason: 'missing' }, 'the earliest place first');
      assert.ok(k.brokenTotal >= 12);
    } finally {
      x.weg();
    }
  });
});

describe('Pruefkette: die Signaturen der Zeitstempel', () => {
  const ECHT = fs.readFileSync(path.join(__dirname, 'fixtures', 'rfc3161-token.der'));
  const ECHT_HASH = '6491253b709b930450ebaea22b4ca9fd36111db9e53bbb60024fd511d773d505';
  const stempel = (s) => ({
    tsa: 'http://tsa.example',
    requested: '2026-10-03T10:00:00.000Z',
    genTime: '2026-10-03T10:00:01.000Z',
    serial: '01',
    ...s
  });
  function mitEintrag() {
    const x = datenbank();
    const v = db.insertExperiment(x.d, { code: 'S1', title: 'Signatur', started: '2026-10-01' }, ANNA);
    return { x, v };
  }

  it('zaehlt sie fuer sich: ein Token ohne Unterschrift ist bad, aber kein Bruch der Kette', () => {
    const { x } = mitEintrag();
    try {
      const kopf = db.labChainHead(x.d);
      const id = db.insertLabTimestamp(x.d, stempel({ ...kopf, token: tokenFuer(kopf.hash) }));
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, true, 'the chain itself holds');
      const problem = { id, historyId: kopf.historyId, signature: 'bad', reason: 'signers' };
      assert.deepEqual(k.signatures, { ok: 0, bad: 1, unchecked: 0, problems: [problem], firstBad: problem });
      assert.equal(k.lastStamp.id, id);
      assert.equal(k.lastStamp.signature, 'bad');
      assert.equal(k.lastStamp.signer, null);
    } finally {
      x.weg();
    }
  });

  it('nennt den Stempel einer Stelle, deren Wurzel Node nicht mitbringt, unchecked, ohne Bruch', () => {
    const { x } = mitEintrag();
    try {
      const kopf = db.labChainHead(x.d);
      const wurzel = zertifikat({ cn: 'Eigene Wurzel', erweiterungen: alsCa() });
      const stelle = zertifikat({ cn: 'Eigene Stelle', aussteller: wurzel, erweiterungen: alsStelle() });
      const token = signiertesToken({ tst: tstInfo({ hash: hex(kopf.hash) }), stelle, zertifikate: [stelle, wurzel] });
      db.insertLabTimestamp(x.d, stempel({ ...kopf, token }));
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, true);
      assert.deepEqual(
        k.signatures.problems.map((p) => [p.signature, p.reason]),
        [['unchecked', 'root']]
      );
      assert.equal(k.signatures.unchecked, 1);
      assert.equal(k.lastStamp.signature, 'unchecked');
    } finally {
      x.weg();
    }
  });

  it('prueft ein echtes Token bis zur Wurzel, getrennt davon, ob die Kette passt', () => {
    // Ein echtes Token gibt es nur ueber seinen eigenen Hash; hier steht es auf
    // einem Glied, das jemand von Hand geschrieben hat. Die Kette bricht dort,
    // die Signatur haelt.
    const { x } = mitEintrag();
    try {
      anVorbei(x.d, 'INSERT INTO lab_history_chain(history_id, hash) VALUES(?,?)', 1e9, ECHT_HASH);
      assert.ok(db.insertLabTimestamp(x.d, stempel({ historyId: 1e9, hash: ECHT_HASH, token: ECHT })));
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, false);
      assert.deepEqual(k.broken, [{ id: 1e9, reason: 'missing' }]);
      assert.deepEqual(k.signatures, { ok: 1, bad: 0, unchecked: 0, problems: [], firstBad: null });
      assert.equal(k.lastStamp.signature, 'ok');
      assert.equal(k.lastStamp.signer, 'DigiCert SHA256 RSA4096 Timestamp Responder 2026 1');
    } finally {
      x.weg();
    }
  });

  it('zeigt Zeit und Seriennummer aus dem Token, und eine geaenderte Spalte bricht die Kette', () => {
    // Das echte Token auf einem Glied von Hand, wie oben; dann die Zeit in
    // der Spalte vorverlegt, an der Anwendung vorbei.
    const { x } = mitEintrag();
    try {
      anVorbei(x.d, 'INSERT INTO lab_history_chain(history_id, hash) VALUES(?,?)', 1e9, ECHT_HASH);
      db.insertLabTimestamp(x.d, stempel({ historyId: 1e9, hash: ECHT_HASH, token: ECHT }));
      const vorher = db.labChainStatus(x.d);
      assert.deepEqual(vorher.broken, [{ id: 1e9, reason: 'missing' }], 'only the hand-made link');
      x.d.exec('DROP TRIGGER IF EXISTS lab_timestamps_no_update');
      x.d.prepare("UPDATE lab_timestamps SET gen_time='2021-01-01T00:00:00.000Z'").run();
      const k = db.labChainStatus(x.d);
      assert.deepEqual(k.broken, [
        { id: 1e9, reason: 'missing' },
        { id: 1e9, reason: 'stamp' }
      ]);
      assert.equal(k.lastStamp.genTime, '2026-10-03T09:37:28.000Z', 'the time the token was signed at');
      assert.equal(k.lastStamp.signature, 'ok', 'the token itself still holds');
      x.d.prepare("UPDATE lab_timestamps SET gen_time='2026-10-03T09:37:28.000Z', serial='01'").run();
      assert.deepEqual(db.labChainStatus(x.d).broken.at(-1), { id: 1e9, reason: 'stamp' }, 'the serial as well');
    } finally {
      x.weg();
    }
  });

  it('nennt die ersten zehn, die nicht ok sind, und zaehlt alle', () => {
    const { x, v } = mitEintrag();
    try {
      for (let i = 0; i < 12; i++) {
        db.updateExperiment(x.d, v, { title: 'Lauf ' + i }, ANNA);
        const kopf = db.labChainHead(x.d);
        db.insertLabTimestamp(x.d, stempel({ ...kopf, token: tokenFuer(kopf.hash) }));
      }
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, true);
      assert.equal(k.signatures.bad, 12);
      assert.equal(k.signatures.problems.length, 10);
      assert.ok(k.signatures.problems[0].id < k.signatures.problems[9].id, 'the earliest first');
    } finally {
      x.weg();
    }
  });

  it('nennt den ersten ungueltigen Stempel auch hinter zehn, die sich nur nicht pruefen lassen', () => {
    const { x, v } = mitEintrag();
    try {
      const wurzel = zertifikat({ cn: 'Eigene Wurzel', erweiterungen: alsCa() });
      const stelle = zertifikat({ cn: 'Eigene Stelle', aussteller: wurzel, erweiterungen: alsStelle() });
      for (let i = 0; i < 11; i++) {
        db.updateExperiment(x.d, v, { title: 'Lauf ' + i }, ANNA);
        const kopf = db.labChainHead(x.d);
        // Zehn von einer Stelle, deren Wurzel Node nicht mitbringt, dann einer ohne Unterschrift.
        const token =
          i < 10
            ? signiertesToken({ tst: tstInfo({ hash: hex(kopf.hash) }), stelle, zertifikate: [stelle, wurzel] })
            : tokenFuer(kopf.hash);
        db.insertLabTimestamp(x.d, stempel({ ...kopf, token }));
      }
      const k = db.labChainStatus(x.d);
      assert.equal(k.signatures.unchecked, 10);
      assert.equal(k.signatures.problems.length, 10);
      assert.ok(k.signatures.problems.every((p) => p.signature === 'unchecked'));
      assert.equal(k.signatures.firstBad.historyId, db.labChainHead(x.d).historyId);
      assert.equal(k.signatures.firstBad.reason, 'signers');
    } finally {
      x.weg();
    }
  });
});

describe('Migration 97: verkettet, was schon da ist', () => {
  it('gibt jedem vorhandenen Eintrag sein Glied, ohne einen Eintrag anzufassen', () => {
    const x = datenbank();
    try {
      const v = db.insertExperiment(x.d, { code: 'A1', title: 'Alt', started: '2026-09-01' }, ANNA);
      db.updateExperiment(x.d, v, { outcome: 'frueher' }, ANNA);
      const vorher = x.d.prepare('SELECT * FROM lab_history ORDER BY id').all();
      // Eine Datenbank von vor der Kette: keine Glieder, v97 nicht gelaufen.
      x.d.exec('DROP TABLE lab_history_chain; DROP TABLE lab_timestamps;');
      x.d.prepare('DELETE FROM schema_version WHERE version=97').run();
      x.d.close();
      x.d = db.openDb(x.p);
      assert.deepEqual(x.d.prepare('SELECT * FROM lab_history ORDER BY id').all(), vorher, 'no entry touched');
      const k = db.labChainStatus(x.d);
      assert.equal(k.ok, true);
      assert.equal(k.chained, vorher.length);
      assert.ok(x.d.prepare('SELECT 1 FROM schema_version WHERE version=97').get());
    } finally {
      x.weg();
    }
  });
});

describe('Pruefkette im Laborbuch', () => {
  it('bringt den Befund mit, ohne Token', () => {
    const x = datenbank();
    try {
      db.insertExperiment(x.d, { code: 'L1', title: 'Lauf', started: '2026-10-01' }, ANNA);
      const buch = db.labBook(x.d, {});
      assert.equal(buch.chain.ok, true);
      assert.equal(buch.chain.entries, 1);
      assert.equal(JSON.stringify(buch.chain).includes('token'), false);
    } finally {
      x.weg();
    }
  });
});

// ── Der Dienst ──────────────────────────────────────────────
describe('Zeitstempel-Dienst', () => {
  function aufbau(opts = {}) {
    const x = datenbank();
    let uhr = Date.parse('2026-10-03T10:00:00.000Z');
    const anfragen = [];
    const logs = [];
    const dienst = createLabTimestamps({
      getDb: () => x.d,
      dbApi: db,
      url: 'url' in opts ? opts.url : 'http://tsa.example/tsr',
      log: (level, msg, meta) => logs.push({ level, msg, meta }),
      now: () => uhr,
      request:
        opts.request ||
        (async (url, hash) => {
          anfragen.push({ url, hash });
          return { token: tokenFuer(hash), genTime: new Date(uhr).toISOString(), serial: '0a' };
        })
    });
    return {
      x,
      dienst,
      anfragen,
      logs,
      spaeter(ms) {
        uhr += ms;
      }
    };
  }
  const STUNDE = 3600 * 1000;

  it('stempelt das juengste Glied, und erst wieder, wenn etwas dazukam und ein Tag um ist', async () => {
    const a = aufbau();
    try {
      assert.equal((await a.dienst.run()).status, 'empty');
      const v = db.insertExperiment(a.x.d, { code: 'D1', title: 'Dienst', started: '2026-10-01' }, ANNA);
      const r = await a.dienst.run();
      assert.equal(r.status, 'stamped');
      assert.deepEqual(a.anfragen, [{ url: 'http://tsa.example/tsr', hash: db.labChainHead(a.x.d).hash }]);
      assert.equal(r.stamp.historyId, db.labChainHead(a.x.d).historyId);
      assert.equal((await a.dienst.run()).status, 'current', 'nothing new, no request');
      db.updateExperiment(a.x.d, v, { title: 'neu' }, ANNA);
      a.spaeter(STUNDE);
      assert.equal((await a.dienst.run()).status, 'later', 'new, but the last stamp is an hour old');
      a.spaeter(20 * STUNDE);
      assert.equal((await a.dienst.run()).status, 'stamped');
      assert.equal(a.anfragen.length, 2);
      assert.equal(db.labChainStatus(a.x.d).ok, true);
    } finally {
      a.x.weg();
    }
  });

  it('haelt den Kopf nicht fuer gestempelt, wenn der juengste Stempel einem Glied ohne Eintrag gilt', async () => {
    const a = aufbau();
    try {
      db.insertExperiment(a.x.d, { code: 'D1', title: 'Dienst', started: '2026-10-01' }, ANNA);
      const fremd = 'f'.repeat(64);
      anVorbei(a.x.d, 'INSERT INTO lab_history_chain(history_id, hash) VALUES(?,?)', 1e9, fremd);
      db.insertLabTimestamp(a.x.d, {
        historyId: 1e9,
        hash: fremd,
        tsa: 'http://tsa.example',
        requested: new Date(Date.parse('2026-10-03T09:00:00.000Z')).toISOString(),
        genTime: '2026-10-03T09:00:01.000Z',
        serial: '01',
        token: tokenFuer(fremd)
      });
      const r = await a.dienst.run({ force: true });
      assert.equal(r.status, 'stamped');
      assert.equal(r.stamp.historyId, db.labChainHead(a.x.d).historyId);
    } finally {
      a.x.weg();
    }
  });

  it('holt ihn auf Wunsch gleich, aber nicht zweimal in einer halben Minute, und nicht fuer nichts Neues', async () => {
    const a = aufbau();
    try {
      const v = db.insertExperiment(a.x.d, { code: 'D2', title: 'Sofort', started: '2026-10-01' }, ANNA);
      assert.equal((await a.dienst.run({ force: true })).status, 'stamped');
      assert.equal((await a.dienst.run({ force: true })).status, 'wait');
      a.spaeter(31 * 1000);
      assert.equal((await a.dienst.run({ force: true })).status, 'current');
      db.updateExperiment(a.x.d, v, { title: 'gleich' }, ANNA);
      assert.equal((await a.dienst.run({ force: true })).status, 'stamped', 'force skips the day, not the news');
      assert.equal(a.anfragen.length, 2);
    } finally {
      a.x.weg();
    }
  });

  it('merkt sich einen Fehler fuer die Anzeige und versucht es beim naechsten Mal wieder', async () => {
    let scheitern = true;
    const a = aufbau({
      request: async (url, hash) => {
        if (scheitern) throw new Error('RFC 3161: no answer within 20 s');
        return { token: tokenFuer(hash), genTime: '2026-10-03T10:00:00.000Z', serial: '01' };
      }
    });
    try {
      db.insertExperiment(a.x.d, { code: 'D3', title: 'Fehler', started: '2026-10-01' }, ANNA);
      const r = await a.dienst.run();
      assert.equal(r.status, 'error');
      assert.deepEqual(a.dienst.health().lastError, {
        at: '2026-10-03T10:00:00.000Z',
        message: 'RFC 3161: no answer within 20 s'
      });
      assert.equal(a.logs.at(-1).level, 'warn');
      scheitern = false;
      a.spaeter(STUNDE);
      assert.equal((await a.dienst.run()).status, 'stamped');
      assert.equal(a.dienst.health().lastError, null);
    } finally {
      a.x.weg();
    }
  });

  it('verwirft eine Antwort, die nach einem Zurueckspielen nicht mehr zur Kette passt', async () => {
    const a = aufbau({
      request: async (url, hash) => {
        // Waehrend die Stelle antwortet, wird eine andere Datei eingespielt.
        a.x.d.close();
        fs.rmSync(a.x.p, { force: true });
        for (const n of ['-wal', '-shm']) fs.rmSync(a.x.p + n, { force: true });
        a.x.d = db.openDb(a.x.p);
        return { token: tokenFuer(hash), genTime: '2026-10-03T10:00:00.000Z', serial: '01' };
      }
    });
    try {
      db.insertExperiment(a.x.d, { code: 'D4', title: 'Zurueck', started: '2026-10-01' }, ANNA);
      assert.equal((await a.dienst.run()).status, 'stale');
      assert.equal(db.lastLabTimestamp(a.x.d), null);
    } finally {
      a.x.weg();
    }
  });

  it('tut ohne Stelle nichts', async () => {
    const a = aufbau({ url: null });
    try {
      db.insertExperiment(a.x.d, { code: 'D5', title: 'Aus', started: '2026-10-01' }, ANNA);
      assert.equal((await a.dienst.run({ force: true })).status, 'off');
      a.dienst.start();
      a.dienst.stop();
      assert.deepEqual(a.dienst.health(), { tsa: null, busy: false, lastError: null });
    } finally {
      a.x.weg();
    }
  });

  it('speichert und zeigt die Stelle ohne Zugangsdaten und Abfrage, und stempelt ueber HTTPS', async () => {
    assert.equal(shownTsa('https://name:geheim@tsa.example:8443/tsr?key=x#y'), 'https://tsa.example:8443/tsr');
    assert.equal(shownTsa('kein url'), 'kein url');
    assert.match(DEFAULT_TSA, /^https:\/\//);
    const a = aufbau({ url: 'https://name:geheim@tsa.example/tsr?key=x' });
    try {
      db.insertExperiment(a.x.d, { code: 'D6', title: 'Geheim', started: '2026-10-01' }, ANNA);
      const r = await a.dienst.run();
      assert.equal(r.status, 'stamped');
      assert.equal(r.stamp.tsa, 'https://tsa.example/tsr');
      assert.equal(a.dienst.health().tsa, 'https://tsa.example/tsr');
      assert.equal(
        a.anfragen[0].url,
        'https://name:geheim@tsa.example/tsr?key=x',
        'the request itself uses the setting'
      );
    } finally {
      a.x.weg();
    }
  });

  it('nimmt die Stelle aus LAB_TSA_URL, schaltet mit "off" ab, und eine Worktree-Instanz stempelt nicht', () => {
    assert.equal(tsaFromEnv({}, false), DEFAULT_TSA);
    assert.equal(tsaFromEnv({ LAB_TSA_URL: ' https://tsa.example/x ' }, false), 'https://tsa.example/x');
    assert.equal(tsaFromEnv({ LAB_TSA_URL: 'OFF' }, false), null);
    assert.equal(tsaFromEnv({}, true), null);
    assert.equal(tsaFromEnv({ LAB_TSA_URL: 'https://tsa.example/x' }, true), 'https://tsa.example/x');
  });
});

describe('Zeitstempel-Route und Gesundheit im Quelltext', () => {
  const src = quelle('server.js');
  it('laesst nur einen Admin stempeln, vor dem Aufruf', () => {
    const i = src.indexOf("req.url === '/api/lab-history/timestamp'");
    assert.ok(i > 0);
    const stueck = src.slice(i, i + 400);
    assert.ok(stueck.indexOf('requireAdmin(req, res)') < stueck.indexOf('labStamps.run('));
  });
  it('meldet die Kette in /api/health fuer Admins und in /api/health/full, auch wenn die Datenbank nicht antwortet', () => {
    const i = src.indexOf('health.labChain = labChainHealth();');
    assert.ok(i > 0);
    const davor = src.slice(i - 200, i);
    assert.ok(davor.includes('try {'), 'a failing check does not take the answer down');
    assert.ok(src.includes('return labChainHealth();'));
    assert.ok(src.includes('jetzt - labChainCache.at > 60 * 1000'), 'checked at most once a minute');
  });
  it('macht den Status degraded bei einer Signatur, die nicht haelt, nicht bei einer, die sich nicht pruefen laesst', () => {
    const i = src.indexOf('const labSignaturen = health.labChain.signatures;');
    assert.ok(i > 0);
    const stueck = src.slice(i, i + 300);
    assert.ok(stueck.includes('labSignaturen.bad > 0'));
    assert.ok(stueck.includes("health.status = 'degraded'"));
    assert.equal(stueck.includes('unchecked'), false, 'a TSA whose root Node lacks is no fault');
  });
});

// ── Oberflaeche ─────────────────────────────────────────────
const t = (k, o) => k + (o ? '(' + Object.values(o).join(',') + ')' : '');
function oberflaeche() {
  return new Function(
    't',
    `
    const currentLang = 'de';
    ${['esc', 'fmtDt', 'fmtDtTime', 'parseDateStr', 'serverKette', 'labStempelText', 'pjLbKette']
      .map((n) => hebeFunktion(n))
      .join('\n')}
    return { serverKette, labStempelText, pjLbKette };`
  )(t);
}
const KOPF = { historyId: 12, hash: 'ab'.repeat(32) };
const STEMPEL = {
  id: 1,
  historyId: 10,
  hash: 'cd'.repeat(32),
  tsa: 'http://tsa.example/<x>',
  requested: '2026-10-03T08:00:00.000Z',
  genTime: '2026-10-03T08:00:01.000Z',
  serial: '0a'
};

describe('Pruefkette in der Oberflaeche', () => {
  const o = oberflaeche();

  it('zeigt unter Server, ob alles passt, den Stempel und den Knopf', () => {
    const html = o.serverKette({
      ok: true,
      entries: 12,
      broken: [],
      head: KOPF,
      lastStamp: STEMPEL,
      stamping: { tsa: 'http://tsa.example', lastError: null }
    });
    assert.ok(html.includes('server.chainLabel'));
    assert.ok(html.includes('server.chainOk(12)'));
    assert.ok(html.includes('server.chainStamp('));
    assert.ok(html.includes(',10)'), 'which entry the stamp covers');
    assert.ok(html.includes('id="btn-lab-stamp"'));
  });

  it('nennt einen Bruch, einen Fehler, und zeigt ohne Stelle keinen Knopf', () => {
    const kaputt = o.serverKette({
      ok: false,
      entries: 12,
      broken: [{ id: 5, reason: 'changed' }],
      head: KOPF,
      lastStamp: null,
      stamping: { tsa: 'http://tsa.example', lastError: { at: '2026-10-03T09:00:00.000Z', message: 'nein <b>' } }
    });
    assert.ok(kaputt.includes('server.chainBroken(5)'));
    assert.ok(kaputt.includes('server.chainNoStamp'));
    assert.ok(kaputt.includes('nein &lt;b&gt;'), 'escaped');
    const aus = o.serverKette({
      ok: true,
      entries: 0,
      broken: [],
      head: null,
      lastStamp: null,
      stamping: { tsa: null }
    });
    assert.ok(aus.includes('server.chainStampOff'));
    assert.equal(aus.includes('btn-lab-stamp'), false);
  });

  it('nennt nachgetragene Eintraege unter Server und auf dem Blatt, auch wenn alles passt', () => {
    const nachgetragen = [{ id: 20, at: '2026-10-04T08:00:00.000Z', from: 15, to: 19, count: 5 }];
    const server = o.serverKette({
      ok: true,
      entries: 20,
      broken: [],
      head: KOPF,
      lastStamp: STEMPEL,
      adopted: nachgetragen,
      stamping: { tsa: 'http://tsa.example', lastError: null }
    });
    assert.ok(server.includes('server.chainOk(20)'));
    assert.ok(server.includes('server.chainAdopted(5,'));
    assert.ok(server.includes(',15,19)'));
    const blatt = o.pjLbKette({
      chain: { ok: true, entries: 20, broken: [], head: KOPF, lastStamp: STEMPEL, adopted: nachgetragen }
    });
    assert.ok(blatt.includes('exp.lbChainAdopted('));
    assert.ok(blatt.includes(',5,15,19)'));
    // Ein Befund von einem Server ohne das Feld zeigt keine solche Zeile.
    assert.equal(o.pjLbKette({ chain: { ok: true, entries: 1, broken: [], head: KOPF } }).includes('Adopted'), false);
  });

  it('nennt unter Server die Signaturen fuer sich: geprueft, ungueltig, nicht pruefbar', () => {
    const zeile = (signatures, stamps = 5) =>
      o.serverKette({
        ok: true,
        entries: 12,
        broken: [],
        head: KOPF,
        lastStamp: STEMPEL,
        stamps,
        signatures,
        stamping: { tsa: 'http://tsa.example', lastError: null }
      });
    const gut = zeile({ ok: 5, bad: 0, unchecked: 0, problems: [] });
    assert.ok(gut.includes('server.chainOk(12)'));
    assert.ok(gut.includes('server.chainSigOk'));
    const schlecht = zeile({
      ok: 2,
      bad: 2,
      unchecked: 1,
      problems: [
        { id: 2, historyId: 4, signature: 'unchecked', reason: 'root' },
        { id: 3, historyId: 7, signature: 'bad', reason: 'digest' },
        { id: 4, historyId: 9, signature: 'bad', reason: 'signature' }
      ]
    });
    assert.ok(schlecht.includes('server.chainOk(12)'), 'the chain itself still holds');
    assert.ok(schlecht.includes('server.chainSigBad(2,5,7)'), 'how many, of how many, and the first bad one');
    assert.ok(schlecht.includes('server.chainSigUnchecked(1,5)'));
    assert.equal(schlecht.includes('server.chainSigOk'), false);
    // Steht der erste ungueltige hinter zehn, die sich nicht pruefen lassen,
    // nennt ihn firstBad.
    const zehn = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, historyId: i + 2, signature: 'unchecked' }));
    const dahinter = zeile(
      { ok: 0, bad: 1, unchecked: 10, problems: zehn, firstBad: { id: 11, historyId: 30, signature: 'bad' } },
      11
    );
    assert.ok(dahinter.includes('server.chainSigBad(1,11,30)'));
    // Ohne Stempel, und von einem Server ohne die Pruefung: kein Wort dazu.
    assert.equal(zeile({ ok: 0, bad: 0, unchecked: 0, problems: [] }, 0).includes('chainSig'), false);
    assert.equal(zeile(undefined).includes('chainSig'), false);
  });

  it('druckt die Signatur des juengsten Stempels, und die der aelteren, wenn sie nicht halten', () => {
    const blatt = (lastStamp, signatures, stamps = 5) =>
      o.pjLbKette({ chain: { ok: true, entries: 12, broken: [], head: KOPF, lastStamp, stamps, signatures } });
    const alleGut = { ok: 5, bad: 0, unchecked: 0, problems: [] };
    const gut = blatt({ ...STEMPEL, signature: 'ok', signer: 'Stelle <A>' }, alleGut);
    assert.ok(gut.includes('exp.lbChainSigOk(Stelle &lt;A&gt;)'), 'names the signer, escaped');
    assert.equal(gut.includes('exp.lbChainSigAll'), false);
    assert.ok(blatt({ ...STEMPEL, signature: 'bad', signer: null }, alleGut).includes('exp.lbChainSigBad'));
    assert.ok(blatt({ ...STEMPEL, signature: 'unchecked', signer: null }, alleGut).includes('exp.lbChainSigUnchecked'));
    const aeltere = blatt({ ...STEMPEL, signature: 'ok', signer: 'S' }, { ok: 2, bad: 1, unchecked: 2, problems: [] });
    assert.ok(aeltere.includes('exp.lbChainSigAll(5,1,2)'));
    // Ein einziger Stempel steht schon in seiner Zeile; ein Befund ohne
    // Signaturen druckt keine.
    assert.equal(
      blatt({ ...STEMPEL, signature: 'bad' }, { ok: 0, bad: 1, unchecked: 0, problems: [] }, 1).includes('SigAll'),
      false
    );
    assert.equal(blatt(STEMPEL, undefined).includes('exp.lbChainSig'), false);
  });

  it('sagt nach dem Knopf, was passiert ist', () => {
    assert.ok(o.labStempelText({ status: 'stamped', stamp: STEMPEL }).startsWith('server.chainStampDone('));
    assert.equal(o.labStempelText({ status: 'current' }), 'server.chainStampCurrent');
    assert.equal(o.labStempelText({ status: 'empty' }), 'server.chainStampEmpty');
    assert.equal(o.labStempelText({ status: 'off' }), 'server.chainStampOff');
    assert.equal(o.labStempelText({ status: 'wait' }), 'server.chainStampWait');
    assert.ok(o.labStempelText({ error: 'admin required' }).includes('admin required'));
  });

  it('druckt unter das Laborbuch Befund, juengstes Glied und Stempel, escaped', () => {
    const html = o.pjLbKette({
      chain: { ok: true, entries: 12, broken: [], head: KOPF, lastStamp: STEMPEL }
    });
    assert.ok(html.startsWith('<div class="kette"><h3>exp.lbChain</h3>'));
    assert.ok(html.includes('exp.lbChainOk(12)'));
    assert.ok(html.includes('exp.lbChainHead(12)'));
    assert.ok(html.includes('SHA-256 ' + KOPF.hash));
    assert.ok(html.includes('SHA-256 ' + STEMPEL.hash));
    assert.ok(html.includes('http://tsa.example/&lt;x&gt;'));
    assert.ok(html.includes('exp.lbChainAfter(10)'), 'entries after the stamp are named');
    assert.equal(o.pjLbKette({}), '', 'an answer from an older server has no chain');
    const kaputt = o.pjLbKette({
      chain: { ok: false, entries: 3, broken: [{ id: 2, reason: 'changed' }], head: null, lastStamp: null }
    });
    assert.ok(kaputt.includes('exp.lbChainBroken(2)'));
    assert.ok(kaputt.includes('exp.lbChainNoStamp'));
  });

  it('haengt die Kette ans Ende des ganzen Blatts', () => {
    const blatt = new Function(
      't',
      `
      const currentLang = 'de';
      const workPackages = [];
      ${[
        'esc',
        'fmtDt',
        'fmtDtTime',
        'parseDateStr',
        'pjApName',
        'pjVerlaufCodes',
        'pjVerlaufWert',
        'pjVerlaufZeile',
        'pjLbTag',
        'pjLbEntfernt',
        'pjLbGefaess',
        'pjLbFoto',
        'pjLbVersuch',
        'pjLbArbeitspakete',
        'pjLbKette',
        'pjLbHtml'
      ]
        .map((n) => hebeFunktion(n))
        .join('\n')}
      ${hebe([
        [/^const PJ_LB_STIL =[\s\S]*?;\n/m, 'PJ_LB_STIL'],
        [/^const PJ_LB_DRUCK =[\s\S]*?;\n/m, 'PJ_LB_DRUCK']
      ])}
      return pjLbHtml;`
    )(t);
    const html = blatt(
      {
        createdAt: '2026-10-03T10:00:00.000Z',
        workPackages: [],
        experiments: [],
        chain: { ok: true, entries: 1, broken: [], head: KOPF, lastStamp: null }
      },
      'Laborbuch',
      'anna'
    );
    assert.ok(html.indexOf('class="kette"') > html.indexOf('exp.lbNone'));
    assert.ok(html.indexOf('class="kette"') < html.indexOf('<scr' + 'ipt>'));
  });
});
