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
      move: { n: 2, late: 0 },
      harvest: { n: 1, late: 0 },
      lab: { n: 1, late: 0 }
    });
  });

  it('puts grain spawn that is ready for bags on "Beutel beimpfen"', () => {
    // The plan calls that row 'grain'; the job it asks for is the bags.
    assert.deepEqual(zaehle([{ kind: 'grain' }]), { batch: { n: 1, late: 0 } });
  });

  it('puts a Sorte with nothing coming on the job that is missing: grain first, else bags', () => {
    assert.deepEqual(
      zaehle([
        { kind: 'supply', task: { taskAction: 'make-grain' } },
        { kind: 'supply', task: { taskAction: 'make-blocks' } }
      ]),
      { grain: { n: 1, late: 0 }, batch: { n: 1, late: 0 } }
    );
  });

  it('counts how many rows of the job are late', () => {
    const d = zaehle([{ kind: 'harvest' }, { kind: 'harvest', overdue: true }]);
    assert.deepEqual(d.harvest, { n: 2, late: 1 });
  });

  it('counts a bundled lab row as the species it stands for', () => {
    const bundle = { kind: 'labgroup', task: { rows: [{ empty: false }, { empty: true }, { empty: false }] } };
    assert.deepEqual(zaehle([bundle]), { lab: { n: 3, late: 1 } });
  });

  it('does not count the bundle and its rows when the bundle is open', () => {
    const bundle = { kind: 'labgroup', task: { rows: [{ empty: false }, { empty: false }] } };
    const d = zaehle([bundle, { kind: 'labmin' }, { kind: 'labmin' }], true);
    assert.deepEqual(d, { lab: { n: 2, late: 0 } });
  });

  it('leaves out what no job on the page does', () => {
    assert.deepEqual(zaehle([{ kind: 'manual' }, { kind: 'chore' }, { kind: 'alert' }, { kind: 'left' }]), {});
  });
});

describe('Heute: the figure on the job', () => {
  function zeichne(open) {
    const els = {};
    const el = (id) => (els[id] = els[id] || { hidden: true, innerHTML: '' });
    new Function(
      'document',
      'tp',
      'esc',
      'dashLabGroupOpen',
      ZAEHLEN + '\n' + hebe('renderWorkTileDue') + '\nreturn renderWorkTileDue;'
    )(
      { getElementById: el },
      (k, n) => k + ':' + n,
      (x) => String(x),
      false
    )(open);
    return els;
  }

  it('says in words what it counts: what is late in red, the rest beside it', () => {
    // A bare red "2" beside "Ernte erfassen" told nobody what it counted.
    const els = zeichne([{ kind: 'harvest', overdue: true }, { kind: 'harvest' }, { kind: 'harvest' }]);
    assert.equal(els['wk-due-harvest'].hidden, false);
    assert.equal(
      els['wk-due-harvest'].innerHTML,
      '<span class="wk-due-p rot">work.grp.late:1</span><span class="wk-due-p">work.dueN:2</span>'
    );
  });

  it('shows only the one that applies', () => {
    assert.equal(zeichne([{ kind: 'fruiting' }])['wk-due-move'].innerHTML, '<span class="wk-due-p">work.dueN:1</span>');
    assert.equal(
      zeichne([{ kind: 'fruiting', overdue: true }])['wk-due-move'].innerHTML,
      '<span class="wk-due-p rot">work.grp.late:1</span>'
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

  it('stands in the flow of the job, never laid over it', () => {
    // It was position:absolute in a corner, and the words of the job ran under it.
    const regel = CSS.match(/\n\.wk-due \{[^}]*\}/);
    assert.ok(regel, 'no rule for .wk-due');
    assert.doesNotMatch(regel[0], /position: absolute/);
    assert.match(regel[0], /position: relative;/);
    assert.doesNotMatch(CSS, /\.wk-due-wort/);
    assert.match(CSS, /\.wk-due\[hidden\] \{\s*display: none;/);
  });

  it('has a column of its own at the end of the row on a phone, so the text stops before it', () => {
    const phone = CSS.match(
      /@media \(max-width: 768px\) \{\s*\.wk-tile \{\s*grid-template-columns: 40px minmax\(0, 1fr\) auto;\s*\}\s*\.wk-due \{[^}]*\}/
    );
    assert.ok(phone, 'no phone rule that gives the figure a column');
    assert.match(phone[0], /grid-column: 3;/);
    assert.match(phone[0], /grid-row: 1 \/ span 2;/);
    assert.doesNotMatch(CSS, /\.wk-tile:has\(\.wk-due/);
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
