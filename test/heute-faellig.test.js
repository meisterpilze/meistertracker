'use strict';
// The start page: what is due today, on the job that does it.
//
// On a phone the seven jobs are the first screen and "Was ansteht" stands below
// them. That order is deliberate: the jobs are what the app is opened for. Its
// price was that the first screen said what somebody CAN do and not what is
// waiting. So each job now carries a figure: how many rows of today's list are
// its work, red once one of them is late. The list is not counted a second
// time; the figures are read off the same rows (buildWeekPlan, today).
//
// And one notice more above the jobs: the parcels to pack today, which the
// packing board knew and the start page did not say.
//
// wkTileDue() is plain counting and is tested with plain objects. The two
// drawing functions run against stand-ins. Invented data, no browser.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function hebe(name) {
  const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
  assert.ok(m, name + '() not found in app.js');
  return m[1];
}
function konst(name) {
  const m = APP.match(new RegExp('^const ' + name + ' = .*;$', 'm'));
  assert.ok(m, 'const ' + name + ' not found in app.js');
  return m[0];
}

const ZAEHLEN = [konst('_labRows'), konst('WK_DUE_TILE'), hebe('wkTileDue')].join('\n');
const zaehle = (open, labGroupOpen = false) =>
  new Function('dashLabGroupOpen', ZAEHLEN + '\nreturn wkTileDue;')(labGroupOpen)(open);

describe('Heute: which job a row of the day list belongs to', () => {
  it('counts a move, a harvest and a lab row on their jobs', () => {
    assert.deepEqual(zaehle([{ kind: 'fruiting' }, { kind: 'fruiting' }, { kind: 'harvest' }, { kind: 'labmin' }]), {
      move: { n: 2, late: false },
      harvest: { n: 1, late: false },
      lab: { n: 1, late: false }
    });
  });

  it('puts grain spawn that is ready for bags on "Beutel beimpfen"', () => {
    // The plan calls that row 'grain'; the job it asks for is the bags.
    assert.deepEqual(zaehle([{ kind: 'grain' }]), { batch: { n: 1, late: false } });
  });

  it('puts a Sorte with nothing coming on the job that is missing: grain first, else bags', () => {
    assert.deepEqual(
      zaehle([
        { kind: 'supply', task: { taskAction: 'make-grain' } },
        { kind: 'supply', task: { taskAction: 'make-blocks' } }
      ]),
      { grain: { n: 1, late: false }, batch: { n: 1, late: false } }
    );
  });

  it('is red once one row of the job is late', () => {
    const d = zaehle([{ kind: 'harvest' }, { kind: 'harvest', overdue: true }]);
    assert.deepEqual(d.harvest, { n: 2, late: true });
  });

  it('counts a bundled lab row as the species it stands for', () => {
    const bundle = { kind: 'labgroup', task: { rows: [{ empty: false }, { empty: true }, { empty: false }] } };
    assert.deepEqual(zaehle([bundle]), { lab: { n: 3, late: true } });
  });

  it('does not count the bundle and its rows when the bundle is open', () => {
    const bundle = { kind: 'labgroup', task: { rows: [{ empty: false }, { empty: false }] } };
    const d = zaehle([bundle, { kind: 'labmin' }, { kind: 'labmin' }], true);
    assert.deepEqual(d, { lab: { n: 2, late: false } });
  });

  it('leaves out what no job on the page does', () => {
    assert.deepEqual(zaehle([{ kind: 'manual' }, { kind: 'chore' }, { kind: 'alert' }, { kind: 'left' }]), {});
  });
});

describe('Heute: the figure on the job', () => {
  function zeichne(open) {
    const els = {};
    const el = (id) =>
      (els[id] = els[id] || {
        hidden: true,
        textContent: '',
        rot: false,
        label: '',
        classList: {
          toggle(k, an) {
            els[id].rot = !!an;
          }
        },
        setAttribute(k, v) {
          els[id].label = v;
        }
      });
    new Function(
      'document',
      'tp',
      'dashLabGroupOpen',
      ZAEHLEN + '\n' + hebe('renderWorkTileDue') + '\nreturn renderWorkTileDue;'
    )(
      { getElementById: el },
      (k, n) => k + ':' + n,
      false
    )(open);
    return els;
  }

  it('shows the count, with words for a screen reader, and red when late', () => {
    const els = zeichne([{ kind: 'harvest', overdue: true }, { kind: 'harvest' }, { kind: 'fruiting' }]);
    assert.deepEqual(
      [els['wk-due-harvest'].hidden, els['wk-due-harvest'].textContent, els['wk-due-harvest'].rot],
      [false, '2', true]
    );
    assert.equal(els['wk-due-harvest'].label, 'work.dueN:2');
    assert.deepEqual(
      [els['wk-due-move'].hidden, els['wk-due-move'].textContent, els['wk-due-move'].rot],
      [false, '1', false]
    );
  });

  it('hides the figure of a job with nothing due, and takes an old one away', () => {
    const els = zeichne([]);
    for (const tile of ['lab', 'grain', 'batch', 'move', 'harvest']) {
      assert.equal(els['wk-due-' + tile].hidden, true, tile);
    }
  });

  it('has a place for it on the five jobs the plan knows, and on no other', () => {
    const ids = [...HTML.matchAll(/<span class="wk-due" id="wk-due-([a-z]+)" hidden><\/span>/g)]
      .map((m) => m[1])
      .sort();
    assert.deepEqual(ids, ['batch', 'grain', 'harvest', 'lab', 'move']);
    for (const tile of ids) {
      const kachel = HTML.slice(HTML.indexOf('id="wk-t-' + tile + '"'));
      assert.ok(
        kachel.indexOf('id="wk-due-' + tile + '"') < kachel.indexOf('</button>'),
        `the figure of ${tile} is not inside its job`
      );
    }
  });

  it('is counted from the rows "Was ansteht" draws, in the same pass', () => {
    assert.match(
      hebe('renderWorkDue'),
      /const open = day\.items\.filter\(\(it\) => !it\.done\)[^\n]*\n\s*renderWorkTileDue\(open\);/
    );
  });

  it('stands at the end of the row on a phone, and the words stop before it', () => {
    const phone = CSS.match(/@media \(max-width: 768px\) \{\s*\.wk-due \{[\s\S]*?\n\}/);
    assert.ok(phone, 'no phone rule for .wk-due');
    assert.match(phone[0], /top: 50%;[\s\S]*transform: translateY\(-50%\);/);
    assert.match(phone[0], /\.wk-tile:has\(\.wk-due:not\(\[hidden\]\)\) \{\s*padding-right: 52px;/);
    assert.match(CSS, /\.wk-due\[hidden\] \{\s*display: none;/);
  });
});

describe('Heute: parcels to pack', () => {
  function zeichne(board) {
    const el = { hidden: true, textContent: '' };
    new Function('document', 'tp', hebe('renderWorkPack') + '\nreturn renderWorkPack;')(
      { getElementById: () => el },
      (k, n) => k + ':' + n
    )(board);
    return el;
  }

  it('says how many, and is not there when there are none', () => {
    assert.deepEqual(zeichne({ pack: [{}, {}, {}] }), { hidden: false, textContent: 'work.packN:3' });
    assert.equal(zeichne({ pack: [] }).hidden, true);
    assert.equal(zeichne(null).hidden, true);
  });

  it('is one of the notices above the jobs, and a row of the list on a desk', () => {
    const strip = HTML.slice(HTML.indexOf('<div class="wk-alerts">'), HTML.indexOf('<div class="wk-tiles"'));
    assert.match(strip, /<button type="button" class="wk-alert wk-pack" id="wk-pack" hidden><\/button>/);
    assert.match(hebe('_wkNoticeRowsHtml'), /\['wk-alert', 'wk-np', 'wk-pack', 'wk-usb', 'wk-usb-key'\]/);
  });

  it('asks the packing board when the page opens and on every sync, and leads to Packen', () => {
    assert.match(hebe('go'), /if \(page === 'work'\) \{[^}]*wkPackLaden\(\);/);
    assert.match(hebe('refresh'), /if \(id === 'work'\) \{[^}]*wkPackLaden\(\);/);
    assert.match(hebe('wkPackLaden'), /apiGet\('\/api\/orders\/board'\)/);
    const i = APP.indexOf("getElementById('wk-pack')") >= 0 ? APP.indexOf("$('wk-pack').addEventListener") : -1;
    assert.ok(i > 0, 'wk-pack is not wired');
    assert.match(APP.slice(i, i + 160), /go\('orders', 'n-orders'\);\s*openStab\('orders', 'pack'\);/);
  });
});
