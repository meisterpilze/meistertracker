'use strict';
// Zone names: the seeded zones are translated, a renamed one keeps its name.
//
// db.js seeds TENT1 as "Tent 1" and the UI shows it as "Zelt 1". Once someone
// renames it in Settings → Zones, the scanner's "Umziehen nach …" has to say
// the new name — it used to translate the ID regardless, so a tent renamed to
// something else still came back as "Zelt 1".
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function lift(...names) {
  return names
    .map((n) => {
      const m = APP.match(new RegExp(`^(?:const ${n} = \\{[\\s\\S]*?\\n\\};|function ${n}\\([\\s\\S]*?\\n\\})`, 'm'));
      assert.ok(m, `${n} not found in app.js — this file is testing nothing`);
      return m[0];
    })
    .join('\n');
}

function load(zones) {
  const src = lift('KNOWN_ZONE_I18N', 'KNOWN_ZONE_SEED_NAME', 'zoneI18nKey', 'zoneDisplayName');
  const t = (k) => ({ 'dash.zoneTent1': 'Zelt 1', 'dash.zoneInc': 'Inkubation' })[k] || k;
  return new Function('zones', 't', `${src}\nreturn zoneDisplayName;`)(zones, t);
}

describe('zoneDisplayName', () => {
  it('translates a seeded zone that still has its seed name', () => {
    const name = load([{ id: 'TENT1', name: 'Tent 1', racks: [] }]);
    assert.equal(name('TENT1'), 'Zelt 1');
  });

  it('shows the name a seeded zone was renamed to', () => {
    const name = load([{ id: 'TENT1', name: 'Großes Zelt', racks: [] }]);
    assert.equal(name('TENT1'), 'Großes Zelt');
  });

  it('shows a custom zone by its name', () => {
    const name = load([{ id: 'GH_A', name: 'Gewächshaus A', racks: [] }]);
    assert.equal(name('GH_A'), 'Gewächshaus A');
  });

  it('still translates a known ID before the zones have loaded', () => {
    const name = load([]);
    assert.equal(name('INC'), 'Inkubation');
  });

  it('names a rack after its zone as renamed', () => {
    const name = load([{ id: 'TENT1', name: 'Großes Zelt', racks: [{ id: 'TENT1-R2' }] }]);
    assert.equal(name('TENT1-R2'), 'Großes Zelt/R2');
  });
});
