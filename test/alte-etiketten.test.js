'use strict';
// Alte Etiketten: von vor einem Neustart der Daten.
//
// Der Neustart loeschte die Barcodes mit, und die Zaehlung fing bei der
// hoechsten verbliebenen Nummer wieder an. Eine Petrischale, die noch im Labor
// stand, trug danach die Nummer eines neuen Beutels einer anderen Art und hiess
// beim Scannen so. Jetzt: keine Nummer wird je zweimal vergeben, der Neustart
// merkt sich, welche Kulturen er geloescht hat, und ein Scan ihres Etiketts
// nimmt sie wieder auf und druckt ein neues.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db.js');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const SERVER = quelle('server.js');
const T0 = '2026-05-14T16:58:25.474Z';

function mitDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-'));
  const d = db.openDb(path.join(dir, 'test.db'));
  try {
    const a = Number(db.createMushroomStrain(d, { name: 'Testart Alpha', kuerzel: 'TA' }));
    fn(d, a, dir);
  } finally {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const kultur = (id, a, extra) =>
  Object.assign(
    { id, type: 'PD', strainId: a, strainText: 'Test 01', status: 'active', notes: '', created: T0 },
    extra
  );
const nummer = (d, id) => d.prepare("SELECT barcode FROM barcodes WHERE entity_type='culture' AND entity_id=?").get(id);

describe('Nummern: keine zweimal', () => {
  it('nach einem Neustart geht es über der höchsten alten Nummer weiter', () => {
    mitDb((d, a) => {
      db.insertCultures(d, [kultur('PD-TA-140526-01', a), kultur('PD-TA-140526-02', a, { status: 'contam' })]);
      const vorher = nummer(d, 'PD-TA-140526-02').barcode;
      db.resetOperationalData(d, { growing: true }, null);
      db.insertCultures(d, [kultur('LC-TA-290926-01', a, { type: 'LC' })]);
      assert.ok(nummer(d, 'LC-TA-290926-01').barcode > vorher, 'eine alte Nummer kam wieder');
    });
  });

  it('die Nummern alter Etiketten zählen mit, auch ohne Untergrenze', () => {
    mitDb((d) => {
      d.prepare(
        "INSERT INTO alte_etiketten(barcode, entity_id, type, archived_at) VALUES(1005000, 'PD-X', 'PD', '2026-08-18')"
      ).run();
      assert.equal(db.nextBarcodeNumber(d), 1005001);
    });
  });
});

describe('Der Neustart merkt sich, was im Labor stehen kann', () => {
  it('aktive Kulturen mit Nummer; eine kontaminierte nicht', () => {
    mitDb((d, a) => {
      db.insertCultures(d, [kultur('PD-TA-140526-01', a), kultur('PD-TA-140526-02', a, { status: 'contam' })]);
      const bc = nummer(d, 'PD-TA-140526-01').barcode;
      db.resetOperationalData(d, { growing: true }, null);
      const l = db.listAlteEtiketten(d);
      assert.deepEqual(
        l.map((x) => [x.barcode, x.id, x.type, x.species, x.strainText]),
        [[bc, 'PD-TA-140526-01', 'PD', 'Testart Alpha', 'Test 01']]
      );
    });
  });
});

describe('Ein altes Etikett wird gescannt', () => {
  it('die Kultur kommt mit ihrer Kennung zurück, mit neuer Nummer, und ist dann kein altes Etikett mehr', () => {
    mitDb((d, a) => {
      db.insertCultures(d, [kultur('LC-TA-010526-01', a, { type: 'LC' })]);
      db.insertCultures(d, [kultur('PD-TA-140526-01', a, { parentId: 'LC-TA-010526-01' })]);
      const alt = nummer(d, 'PD-TA-140526-01').barcode;
      db.resetOperationalData(d, { growing: true }, null);
      const r = db.altesEtikettAufnehmen(d, alt);
      assert.equal(r.id, 'PD-TA-140526-01');
      assert.ok(r.barcode > alt);
      const c = d.prepare('SELECT * FROM cultures WHERE id = ?').get('PD-TA-140526-01');
      assert.equal(c.created, T0, 'das Datum vom Etikett');
      assert.equal(c.strain_text, 'Test 01');
      assert.equal(c.parent_id, null, 'die Herkunft gibt es nicht mehr');
      assert.equal(c.status, 'active');
      assert.deepEqual(
        db.listAlteEtiketten(d).map((x) => x.id),
        ['LC-TA-010526-01']
      );
    });
  });

  it('eine unbekannte Nummer sagt das, im Klartext', () => {
    mitDb((d) => {
      assert.throws(() => db.altesEtikettAufnehmen(d, 1999999), /Dieses alte Etikett kennt die App nicht\./);
      assert.ok(db.isSafeError('Dieses alte Etikett kennt die App nicht.'));
    });
  });
});

describe('Nachtragen aus der Sicherung von vor dem Neustart', () => {
  it('nur, was heute nicht in der App ist; die Untergrenze über der höchsten alten Nummer', () => {
    mitDb((d, a, dir) => {
      const altPfad = path.join(dir, 'alt.db');
      const alt = db.openDb(altPfad);
      try {
        const b = Number(db.createMushroomStrain(alt, { name: 'Testart Alpha', kuerzel: 'TA' }));
        db.insertCultures(alt, [kultur('PD-TA-140526-01', b), kultur('MC-TA-010426-01', b, { type: 'MC' })]);
        alt.exec(
          "INSERT INTO barcodes(barcode, entity_type, entity_id, created) VALUES(1009000, 'bag', 'X-1', '2026-08-01')"
        );
      } finally {
        alt.close();
      }
      db.insertCultures(d, [kultur('MC-TA-010426-01', a, { type: 'MC' })]);
      const { DatabaseSync } = require('node:sqlite');
      const q = new DatabaseSync(altPfad, { readOnly: true });
      try {
        assert.equal(db.alteEtikettenSichern(d, q), 1);
        assert.equal(db.alteEtikettenSichern(d, q), 0, 'zweimal ist einmal');
      } finally {
        q.close();
      }
      assert.deepEqual(
        db.listAlteEtiketten(d).map((x) => x.id),
        ['PD-TA-140526-01']
      );
      assert.equal(db.nextBarcodeNumber(d), 1009001);
    });
  });

  it('das Skript schreibt nur mit --write', () => {
    mitDb((d, a, dir) => {
      const altPfad = path.join(dir, 'alt.db');
      const alt = db.openDb(altPfad);
      try {
        const b = Number(db.createMushroomStrain(alt, { name: 'Testart Alpha', kuerzel: 'TA' }));
        db.insertCultures(alt, [kultur('PD-TA-140526-01', b)]);
      } finally {
        alt.close();
      }
      d.close();
      const ziel = path.join(dir, 'test.db');
      const { main } = require('../scripts/alte-etiketten-nachtragen.js');
      const log = console.log;
      console.log = () => {};
      try {
        main(['node', 'x', altPfad, '--db', ziel]);
        let z = db.openDb(ziel);
        assert.equal(db.listAlteEtiketten(z).length, 0);
        z.close();
        main(['node', 'x', altPfad, '--db', ziel, '--write']);
        z = db.openDb(ziel);
        assert.equal(db.listAlteEtiketten(z).length, 1);
        z.close();
      } finally {
        console.log = log;
      }
      // mitDb schliesst d am Ende noch einmal; ein offenes Handle dafuer.
      d.close = () => {};
    });
  });
});

describe('Alte Etiketten in der App', () => {
  it('kommen mit den Daten, und der Scan prüft sie vor der Nummernliste', () => {
    assert.match(quelle('db.js'), /alteEtiketten: listAlteEtiketten\(db\)/);
    const f = hebeFunktion('processScan', APP);
    const i = f.indexOf('alteEtiketten.get(numVal)');
    assert.ok(i > 0 && i < f.indexOf('const entry = barcodeRegistry.get(numVal)'));
    assert.match(f, /opts && opts\.ohneAlt \? null/);
  });

  it('der Server nimmt ein altes Etikett auf', () => {
    assert.match(
      SERVER,
      /req\.url === '\/api\/alte-etiketten\/aufnehmen'[\s\S]{0,400}db\.altesEtikettAufnehmen\(database, data && data\.barcode\)/
    );
  });

  function lauf(mitEintrag, druckFehler) {
    return new Function(
      'mitEintrag',
      'druckFehler',
      `
      return (async () => {
        const fb = [];
        const gefragt = [];
        const gescannt = [];
        const gesendet = [];
        const posts = [];
        const t = (k, p) => k + (p ? JSON.stringify(p) : '');
        const setFb = (k, m) => fb.push([k, m]);
        const confirm3 = (title, body, a, b, cbA, cbB) => gefragt.push({ title, a, b, cbA, cbB });
        const processScan = (raw, opts) => gescannt.push([raw, opts]);
        const apiPost = async (url, body) => { posts.push([url, body]); return { ok: true, id: 'PD-TA-140526-01', barcode: 1002000 }; };
        const loadData = async () => {};
        const document = { getElementById: () => null };
        const makeLabZPL = (ids) => ids.map((id) => '^XA' + id + '^XZ').join('');
        const sendToPrinter = async (zpl) => { gesendet.push(zpl); return druckFehler; };
        ${hebeFunktion('altesEtikettAufnehmen', APP)}
        ${hebeFunktion('altesEtikettGescannt', APP)}
        const alt = { barcode: 1000500, id: 'PD-TA-140526-01' };
        altesEtikettGescannt(1000500, alt, mitEintrag ? { type: 'bag', id: 'TB-290926-01-01' } : null, '1000500');
        if (gefragt.length) {
          gefragt[0].cbB();
          gefragt[0].cbA();
        }
        await new Promise((r) => setTimeout(r, 5));
        return { fb, gefragt, gescannt, gesendet, posts };
      })();
    `
    )(mitEintrag, druckFehler);
  }

  it('ohne zweiten Besitzer: gleich aufnehmen, drucken und sagen, dass gedruckt ist', async () => {
    const r = await lauf(false, null);
    assert.equal(r.gefragt.length, 0);
    assert.deepEqual(r.posts, [['/api/alte-etiketten/aufnehmen', { barcode: 1000500 }]]);
    assert.deepEqual(r.gesendet, ['^XAPD-TA-140526-01^XZ']);
    assert.deepEqual(r.fb[r.fb.length - 1], ['ok', 'alt.printed{"id":"PD-TA-140526-01"}']);
  });

  it('hat die Nummer inzwischen etwas anderes: eine Frage, und beide Antworten führen weiter', async () => {
    const r = await lauf(true, null);
    assert.equal(r.gefragt.length, 1);
    assert.equal(r.gefragt[0].a, 'alt.isOld{"id":"PD-TA-140526-01"}');
    assert.equal(r.gefragt[0].b, 'alt.isNew{"id":"TB-290926-01-01"}');
    assert.deepEqual(r.gescannt, [['1000500', { ohneAlt: true }]], 'das neue: ein ganz normaler Scan');
    assert.equal(r.gesendet.length, 1, 'das alte: neues Etikett');
  });

  it('druckt der Drucker nicht, sagt die Meldung das und wo es wartet', async () => {
    const r = await lauf(false, 'Printer not found');
    assert.deepEqual(r.fb[r.fb.length - 1], [
      'warn',
      'alt.printFailed{"id":"PD-TA-140526-01","msg":"Printer not found"}'
    ]);
  });
});
