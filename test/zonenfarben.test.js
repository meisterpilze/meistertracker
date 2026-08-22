'use strict';
// Zone colours: readable, muted, and the same number in both halves of the app.
//
// A zone's colour is data. db.js seeds it, the operator may change it in
// Settings → Zones, and app.js falls back to a literal when a row carries none.
// That is three places holding one value, and before this test they had already
// drifted: the KPI strip fell back to #10b981 for fruiting, the fruiting section
// to #22c55e, and the new-zone form offered a third shade again. Nobody saw it,
// because a fallback only shows when a colour is missing — which on a seeded
// database is never, until someone adds a zone by hand.
//
// The colours also have to be legible. renderPipelineKPIs() paints the zone
// colour as the strip's large bold number on white, and the previous
// full-saturation values measured 2.77:1 (incubation) and 2.54:1 (fruiting) —
// under the 3:1 that test/kpi-kontrast.test.js holds the Betrieb cards to for
// exactly the same kind of text. Two of five numbers in a row were fainter than
// their neighbours and no test could say so.
//
// Ratios are computed from the source values rather than asserted from a table,
// so changing a colour moves the test with it and a colour that drops below the
// floor fails here instead of on somebody's screen.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { contrast } = require('./helpers/kontrast');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

/** ZONE_ROLE_COLOR out of app.js, which has no module boundary to import from. */
function appRoleColors() {
  const m = APP.match(/const ZONE_ROLE_COLOR = \{[\s\S]*?\};/);
  assert.ok(m, 'ZONE_ROLE_COLOR has moved or been renamed in app.js');
  const out = {};
  for (const x of m[0].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)) out[x[1]] = x[2].toLowerCase();
  return out;
}

/** A `background:`/`color:` pair out of one CSS rule. */
function badge(selector) {
  const m = CSS.match(new RegExp('\\' + selector + '\\s*\\{([^}]*)\\}'));
  assert.ok(m, selector + ' is gone from styles.css');
  const bg = m[1].match(/background:\s*(#[0-9a-fA-F]{6})/);
  const fg = m[1].match(/\bcolor:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(bg && fg, selector + ' no longer sets both background and color as literals');
  return { bg: bg[1].toLowerCase(), fg: fg[1].toLowerCase() };
}

// The surface the KPI number actually sits on: --c-surface, not the page ground.
const KARTE = '#ffffff';

describe('zone colours – one value, not three', () => {
  it('app.js falls back to exactly what db.js seeds', () => {
    assert.deepEqual(
      appRoleColors(),
      Object.fromEntries(Object.entries(db.ZONE_SEED_COLOR).map(([k, v]) => [k, v.toLowerCase()])),
      'ZONE_ROLE_COLOR in app.js and ZONE_SEED_COLOR in db.js have drifted apart'
    );
  });

  it('leaves no legacy stage colour behind in app.js', () => {
    // The three the seed used to write. A literal one still in the client means
    // a fallback that was missed, and it will only surface on a zone with no
    // colour of its own — which on a seeded database is never, until somebody
    // adds a zone by hand. That is why this is checked in the source and not
    // through the interface.
    //
    // LAB_TYPE_COLORS is cut out first. It shares two of these hex values and
    // none of their meaning: it colours culture TYPES in Labor (MC, LC, GS …),
    // which are not zones, not phases, and not part of this decision. Muting
    // that palette too may well be worth doing; it is a separate call about a
    // separate screen, and quietly folding it in here would make this change
    // impossible to review.
    const ohneLab = APP.replace(/const LAB_TYPE_COLORS = \{[\s\S]*?\};/, '').replace(
      /const ZONE_LEGACY_COLOR[\s\S]*?\};/,
      ''
    );
    for (const [role, alt] of Object.entries(db.ZONE_LEGACY_COLOR)) {
      if (alt === db.ZONE_SEED_COLOR[role]) continue;
      assert.ok(!new RegExp(alt, 'i').test(ohneLab), `${alt} (old ${role}) is still hardcoded in app.js`);
    }
  });
});

describe('zone colours – legibility', () => {
  // renderPipelineKPIs() puts this colour on .met-v: 26px bold, which is large
  // text under WCAG 1.4.3, so 3:1 rather than 4.5.
  it('carries the KPI number on a white card at 3:1', () => {
    for (const [role, hex] of Object.entries(db.ZONE_SEED_COLOR)) {
      const r = contrast(hex, KARTE);
      assert.ok(r >= 3, `${role} ${hex} measures ${r.toFixed(2)}:1 on the card, under the 3:1 floor`);
    }
  });

  it('keeps the three production phases within a hair of each other', () => {
    // Not a style rule: a set where one member measures twice its neighbours
    // reads as one zone shouting, which is what a KPI strip must not do.
    const r = ['spawn', 'incubation', 'fruiting'].map((k) => contrast(db.ZONE_SEED_COLOR[k], KARTE));
    const spanne = Math.max(...r) - Math.min(...r);
    assert.ok(spanne < 0.5, `contrast spread across the three phases is ${spanne.toFixed(2)}, too wide to look level`);
  });

  it('keeps the phase badges readable as small text', () => {
    // 11px 600 is small text, so the floor is 4.5 against the badge's own tint.
    for (const sel of ['.b-spawn', '.b-inc', '.b-tent']) {
      const { bg, fg } = badge(sel);
      const r = contrast(fg, bg);
      assert.ok(r >= 4.5, `${sel} measures ${r.toFixed(2)}:1, under the 4.5:1 floor for small text`);
    }
  });

  it('keeps the phase badges level with each other too', () => {
    const r = ['.b-spawn', '.b-inc', '.b-tent'].map((s) => {
      const { bg, fg } = badge(s);
      return contrast(fg, bg);
    });
    const spanne = Math.max(...r) - Math.min(...r);
    assert.ok(spanne < 1, `badge contrast spread is ${spanne.toFixed(2)}, one of them will read as louder`);
  });

  it('leaves contamination loud enough to notice', () => {
    // The one exit that should still catch an eye. It is deliberately NOT muted
    // with the rest, and this test is what stops a future tidy-up muting it.
    assert.equal(db.ZONE_SEED_COLOR.contaminated, db.ZONE_LEGACY_COLOR.contaminated);
  });
});

describe('zone colours – migration 77', () => {
  function frischeDb() {
    const p = path.join(os.tmpdir(), 'mt_zonecolor_' + process.pid + '_' + Math.random().toString(36).slice(2) + '.db');
    return { p, d: db.openDb(p) };
  }

  it('upgrades a zone still carrying the old seed colour', () => {
    const { p, d } = frischeDb();
    try {
      const rows = d.prepare("SELECT id, color FROM zones WHERE role = 'fruiting'").all();
      assert.ok(rows.length > 0, 'no fruiting zone was seeded');
      for (const r of rows) assert.equal(r.color.toLowerCase(), db.ZONE_SEED_COLOR.fruiting);
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });

  it('leaves a colour the operator picked alone', () => {
    const { p, d } = frischeDb();
    try {
      // A zone recoloured by hand, then the migration replayed over it. Deleting
      // the row from schema_version is what a re-run looks like from the
      // migration's point of view, and is the case that would eat the choice.
      d.prepare("UPDATE zones SET color = '#123456' WHERE id = 'TENT1'").run();
      d.prepare('DELETE FROM schema_version WHERE version = 77').run();
      d.close();

      const wieder = db.openDb(p);
      try {
        const c = wieder.prepare("SELECT color FROM zones WHERE id = 'TENT1'").get().color;
        assert.equal(c.toLowerCase(), '#123456', 'the migration overwrote a colour the operator chose');
        // and the untouched sibling still came along
        const t2 = wieder.prepare("SELECT color FROM zones WHERE id = 'TENT2'").get().color;
        assert.equal(t2.toLowerCase(), db.ZONE_SEED_COLOR.fruiting);
      } finally {
        wieder.close();
      }
    } finally {
      fs.existsSync(p) && fs.unlinkSync(p);
    }
  });

  it('upgrades a zone the operator added but never recoloured', () => {
    const { p, d } = frischeDb();
    try {
      // Matching on role rather than id is what makes this work: a fourth tent
      // created through the UI carries the legacy default and should follow.
      d.prepare(
        "INSERT INTO zones(id,name,role,color,sort_order,created) VALUES('TENT4','Tent 4','fruiting',?,6,'2026-01-01')"
      ).run(db.ZONE_LEGACY_COLOR.fruiting);
      d.prepare('DELETE FROM schema_version WHERE version = 77').run();
      d.close();

      const wieder = db.openDb(p);
      try {
        const c = wieder.prepare("SELECT color FROM zones WHERE id = 'TENT4'").get().color;
        assert.equal(c.toLowerCase(), db.ZONE_SEED_COLOR.fruiting);
      } finally {
        wieder.close();
      }
    } finally {
      fs.existsSync(p) && fs.unlinkSync(p);
    }
  });
});

describe('CSS-Variablen, die es auch gibt', () => {
  // Die Sorten-Kacheln malten ihren Balken mit var(--st-inc) und var(--st-fruit),
  // und diese Eigenschaften waren nirgends definiert. `background: var(--x)` ohne
  // Ersatzwert ist "invalid at computed-value time", background-color erbt nicht
  // — also wurde jedes Segment durchsichtig und der Balken, der der ganze Zweck
  // der Kachel ist, war auf jeder Karte ein gleichmäßiger grauer Streifen.
  //
  // Kein Test konnte das sehen: die Render-Prüfung sucht nach "undefined" und
  // "NaN" im HTML, und var(--fehlt) erzeugt weder das eine noch das andere. Die
  // Farbe entsteht erst im Browser. Also wird hier die Quelle geprüft.
  //
  // Erfasst beide Schreibweisen, die app.js benutzt: var(--x) direkt im Template
  // und über eine Variable hineingereichte Namen wie _stageSeg(v, t, '--st-inc').
  function referenzierteTokens(src) {
    const out = new Set();
    for (const m of src.matchAll(/var\(\s*(--[\w-]+)/g)) out.add(m[1]);
    for (const m of src.matchAll(/'(--[\w-]+)'/g)) out.add(m[1]);
    return out;
  }
  function definierteTokens(css) {
    const out = new Set();
    for (const m of css.matchAll(/^\s*(--[\w-]+)\s*:/gm)) out.add(m[1]);
    return out;
  }

  it('definiert jede Variable, die app.js benutzt', () => {
    const benutzt = referenzierteTokens(APP);
    const da = definierteTokens(CSS);
    // Ein Ersatzwert — var(--x, red) — trägt sich selbst, also zählt nur, was
    // ohne Komma dasteht.
    const ohneErsatz = [...benutzt].filter((tk) => {
      const mitErsatz = new RegExp('var\\(\\s*' + tk + '\\s*,').test(APP);
      const ohne = new RegExp('var\\(\\s*' + tk + '\\s*\\)').test(APP);
      // Über eine Variable hineingereicht (_stageSeg(v, t, '--st-inc')) taucht
      // der Name nie in einem var(...) auf — dann zählt er in jedem Fall.
      const alsString = new RegExp("'" + tk + "'").test(APP);
      return ohne || alsString || !mitErsatz;
    });
    const fehlend = ohneErsatz.filter((tk) => !da.has(tk));
    assert.deepEqual(fehlend, [], 'app.js malt mit CSS-Variablen, die styles.css nicht kennt: ' + fehlend.join(', '));
  });

  it('hält die Phasenfarben der Kacheln an dieselbe Lesbarkeitsgrenze', () => {
    // Sie stehen als Zahl auf weiß, genau wie die alte Kennzahlenleiste.
    for (const tk of ['--st-spawn', '--st-inc', '--st-fruit']) {
      const m = CSS.match(new RegExp('^\\s*' + tk + '\\s*:\\s*(#[0-9a-fA-F]{6})', 'm'));
      assert.ok(m, tk + ' ist nicht als Hex-Wert definiert');
      const r = contrast(m[1], '#ffffff');
      assert.ok(r >= 3, `${tk} ${m[1]} misst ${r.toFixed(2)}:1 auf weiß, unter der 3:1-Grenze`);
    }
  });
});
