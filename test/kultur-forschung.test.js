'use strict';
// Kulturen in der Forschung: eine gescannte Flüssigkultur bekommt im Fenster
// "Zur Forschung" und steht danach im Reiter Forschung. Heraus geht sie im
// selben Fenster, beides mit Rückgängig.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');
const db = require('../db');

const APP = quelle();
const hebe = (n) => _hf(n, APP);
const VERKAUFBAR = APP.match(/const CI_VERKAUFBAR = \[[^\]]*\];/)[0];
const FORSCHUNG = APP.match(/const CI_FORSCHUNG = \[[^\]]*\];/)[0];

function knoepfe(c) {
  const el = { innerHTML: '' };
  new Function(
    'document',
    'bmpArten',
    't',
    'esc',
    '_lbDarfWeg',
    'fmtDt',
    `${VERKAUFBAR}\n${FORSCHUNG}\n${hebe('renderCiActions')}\nrenderCiActions(${JSON.stringify(c)});`
  )(
    { getElementById: () => el },
    () => ['KB'],
    (k) => k,
    (s) => String(s),
    () => true,
    (d) => String(d)
  );
  return [...el.innerHTML.matchAll(/data-bi="([^"]+)"/g)].map((m) => m[1]);
}

function mitDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forschung-'));
  const d = db.openDb(path.join(dir, 'test.db'));
  try {
    fn(d);
  } finally {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const lc = (n) => ({
  id: 'LC-TFO-261126-0' + n,
  type: 'LC',
  species: 'Testart',
  status: 'active',
  notes: '',
  created: '2026-11-26T08:00:00Z'
});

describe('Kultur-Fenster: Zur Forschung', () => {
  it('eine aktive Flüssigkultur bekommt den Knopf', () => {
    assert.ok(knoepfe({ id: 'LC-TST-261126-01', type: 'LC', status: 'active' }).includes('ci-research'));
  });
  it('eine, die schon in der Forschung steht, bietet stattdessen das Herausnehmen an', () => {
    const k = knoepfe({ id: 'LC-TST-261126-01', type: 'LC', status: 'active', researchAt: '2026-11-26T09:00:00Z' });
    assert.ok(k.includes('ci-research-off'));
    assert.ok(!k.includes('ci-research'));
  });
  it('auch wenn sie inzwischen raus ist, sonst stuende sie für immer in der Liste', () => {
    const k = knoepfe({ id: 'LC-TST-261126-01', type: 'LC', status: 'contam', researchAt: '2026-11-26T09:00:00Z' });
    assert.ok(k.includes('ci-research-off'));
  });
  it('eine verbrauchte, die nie dort war, kommt nicht mehr hinein', () => {
    assert.ok(!knoepfe({ id: 'LC-TST-261126-01', type: 'LC', status: 'used' }).includes('ci-research'));
  });
  it('Spritze und Petrischale auch', () => {
    for (const type of ['SY', 'PD']) {
      assert.ok(knoepfe({ id: type + '-TST-261126-01', type, status: 'active' }).includes('ci-research'), type);
    }
  });
  it('ein Slant, Körnerbrut oder Dübel nicht', () => {
    for (const type of ['MC', 'G2G', 'GS', 'DU']) {
      assert.ok(!knoepfe({ id: type + '-TST-261126-01', type, status: 'active' }).includes('ci-research'), type);
    }
  });
  it('der Knopf schaltet sofort, mit Rückgängig', () => {
    const f = hebe('ciAction');
    assert.match(f, /setCultureResearch\(c\.id, an\)/);
    assert.match(f, /showUndoBar\([\s\S]*setCultureResearch\(c\.id, !an\)/);
  });
});

describe('Der Reiter Forschung', () => {
  const liste = (cultures) =>
    new Function('cultures', `${hebe('pjForschungKulturen')}\nreturn pjForschungKulturen();`)(cultures);
  it('zeigt nur Kulturen in der Forschung, die neueste oben', () => {
    const l = liste([
      { id: 'A', researchAt: '2026-11-20T10:00:00Z' },
      { id: 'B', researchAt: null },
      { id: 'C', researchAt: '2026-11-26T10:00:00Z' },
      { id: 'D' }
    ]);
    assert.deepEqual(
      l.map((c) => c.id),
      ['C', 'A']
    );
  });
  it('steht oben im Reiter, mit und ohne importierte Unterlage', () => {
    const f = hebe('pjProjekteZeichnen');
    assert.equal((f.match(/el\.innerHTML =\s*kulturen \+/g) || []).length, 2);
  });
  it('ein Tipp auf die Zeile öffnet dasselbe Fenster wie der Scan', () => {
    assert.match(hebe('pjClick'), /data-pj-kultur[\s\S]*openCultureSheet\(c\)/);
  });
  it('zeichnet neu, wenn sich die Liste nach einem Datenstand geändert hat', () => {
    assert.match(hebe('pjRefresh'), /pjKulturenGezeigt !== pjKulturenStand\(\)/);
  });
});

describe('Der Server merkt sich, seit wann', () => {
  it('true setzt den Zeitpunkt einmal, false nimmt ihn wieder weg', () => {
    mitDb((d) => {
      db.insertCultures(d, [lc(1)]);
      assert.equal(db.getCultureById(d, lc(1).id).researchAt, null);
      db.updateCulture(d, lc(1).id, { research: true });
      const erst = db.getCultureById(d, lc(1).id).researchAt;
      assert.ok(erst && !isNaN(Date.parse(erst)));
      db.updateCulture(d, lc(1).id, { research: true });
      assert.equal(db.getCultureById(d, lc(1).id).researchAt, erst, 'ein zweites true lässt den ersten stehen');
      db.updateCulture(d, lc(1).id, { research: false });
      assert.equal(db.getCultureById(d, lc(1).id).researchAt, null);
    });
  });
  it('der Datenstand trägt ihn, und er ändert die Version', () => {
    mitDb((d) => {
      db.insertCultures(d, [lc(2)]);
      const vorher = db.getDataVersion(d);
      db.updateCulture(d, lc(2).id, { research: true });
      assert.notEqual(db.getDataVersion(d), vorher);
      const c = db.readAll(d).cultures.find((x) => x.id === lc(2).id);
      assert.ok(c.researchAt);
    });
  });
  it('nur true oder false', () => {
    mitDb((d) => {
      db.insertCultures(d, [lc(3)]);
      assert.throws(() => db.updateCulture(d, lc(3).id, { research: 'ja' }), /true or false/);
    });
  });
});

describe('Forschung ist kein Bestand', () => {
  const kultur = (art, type, n) => ({
    id: type + '-TFB-261126-0' + n,
    type,
    strainId: art,
    status: 'active',
    notes: '',
    created: '2026-11-26T08:00:00Z'
  });
  it('eine Flüssigkultur in der Forschung zählt weder im Laborbestand noch im Fach', () => {
    mitDb((d) => {
      const art = Number(db.createMushroomStrain(d, { name: 'Testart Forschung', kuerzel: 'TFB' }));
      db.insertCultures(d, [kultur(art, 'LC', 1), kultur(art, 'LC', 2), kultur(art, 'LC', 3)]);
      const lc = () => {
        const s = db.labStock(d).find((x) => x.strainId === art);
        return [s.items.find((i) => i.key === 'LC').have, s.fach.find((f) => f.slot === 'LC').have];
      };
      assert.deepEqual(lc(), [3, 3]);
      db.updateCulture(d, kultur(art, 'LC', 1).id, { research: true });
      assert.deepEqual(lc(), [2, 2]);
      db.updateCulture(d, kultur(art, 'LC', 1).id, { research: false });
      assert.deepEqual(lc(), [3, 3], 'aus der Forschung heraus zählt sie wieder');
    });
  });
  it('eine Petrischale oder Spritze in der Forschung zählt nicht im Verkaufsbestand', () => {
    mitDb((d) => {
      const art = Number(db.createMushroomStrain(d, { name: 'Testart Forschung PD', kuerzel: 'TFP' }));
      db.insertCultures(d, [kultur(art, 'PD', 1), kultur(art, 'PD', 2), kultur(art, 'SY', 1), kultur(art, 'SY', 2)]);
      const zahl = (type) =>
        db
          .listSyringeStock(d)
          .filter((r) => r.strainId === art && r.type === type)
          .reduce((s, r) => s + r.count, 0);
      assert.deepEqual([zahl('PD'), zahl('SY')], [2, 2]);
      db.updateCulture(d, kultur(art, 'PD', 1).id, { research: true });
      db.updateCulture(d, kultur(art, 'SY', 1).id, { research: true });
      assert.deepEqual([zahl('PD'), zahl('SY')], [1, 1]);
    });
  });
  it('in der Kulturliste bleibt sie stehen, mit Vermerk, zählt aber nicht mit', () => {
    assert.match(APP, /const _kbBestand = \(c\) => _kbDa\(c\) && !c\.researchAt;/);
    assert.match(APP, /zaehler: \(\) => t\('kb\.count', \{ n: cultures\.filter\(_kbBestand\)\.length \}\)/);
    assert.match(APP, /const nLab = cultures\.filter\(_kbBestand\)\.length;/);
    assert.match(APP, /if \(c\.researchAt\) rechts\.push\(t\('kb\.research'\)\)/);
  });
  it('nach dem Umschalten holt die App die Zahlen je Art neu', () => {
    assert.match(hebe('setCultureResearch'), /loadLabStock\(\)/);
  });
});
