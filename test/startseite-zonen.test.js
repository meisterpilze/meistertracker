'use strict';
// The start screen: daily jobs first, the weekly ones small below them, and
// "Wo steht was" with the day each group of bags went in and how long it has
// been there — the dates are what the team works from, so they are tested.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function lift(name) {
  const m = APP.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`, 'm'));
  assert.ok(m, `${name} not found in app.js — this file is testing nothing`);
  return m[0];
}

describe('Startseite — Kacheln', () => {
  it('has one grid, daily jobs first and Kontamination last', () => {
    assert.equal((HTML.match(/class="wk-tiles/g) || []).length, 1);
    const ids = [...HTML.matchAll(/id="wk-t-(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ['move', 'harvest', 'batch', 'lab', 'grain', 'sub', 'contam']);
  });

  it('has every new text in all three languages', () => {
    for (const lang of ['de', 'en', 'pt']) {
      const src = fs.readFileSync(path.join(ROOT, 'lang', lang + '.js'), 'utf8');
      for (const k of ['work.tileBatch', 'work.tileSubstrate', 'work.todayNone', 'work.alertFull', 'work.tentsTitle']) {
        assert.ok(src.includes(`'${k}':`), `${lang} lacks ${k}`);
      }
    }
  });
});

describe('Startseite — Wo steht was', () => {
  const rows = new Function(
    'esc',
    't',
    'tp',
    'fmtDtShort',
    '_wkTentFold',
    `${lift('_wkZoneRowsHtml')}\nreturn _wkZoneRowsHtml;`
  )(
    (s) => String(s),
    (k, p) => (k === 'work.tentSince' ? 'seit ' + p.date : k === 'work.tentToday' ? 'heute' : k),
    (k, n) => (k === 'work.tentDays' ? n + (n === 1 ? ' Tag' : ' Tage') : n + ' Beutel'),
    (d) => String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.',
    { open: new Set() }
  );
  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  };

  it('says when a group went in and how long ago, oldest first', () => {
    const html = rows(
      { id: 'TENT1' },
      {
        'BO-1-02': { batchId: 'BO-1', species: 'Blue Oyster', since: daysAgo(0) },
        'LM-1-03': { batchId: 'LM-1', species: 'Lions Mane', since: daysAgo(8) }
      }
    );
    assert.ok(html.indexOf('Lions Mane') < html.indexOf('Blue Oyster'), 'oldest group first');
    assert.match(html, /8 Tage/);
    assert.match(html, /seit \d\d\.\d\d\. · heute/);
  });

  it('keeps bags of one species that went in on different days apart', () => {
    const html = rows(
      { id: 'TENT1' },
      {
        'LM-1-01': { batchId: 'LM-1', species: 'Lions Mane', since: daysAgo(8) },
        'LM-2-01': { batchId: 'LM-2', species: 'Lions Mane', since: daysAgo(0) },
        'LM-2-02': { batchId: 'LM-2', species: 'Lions Mane', since: daysAgo(0) }
      }
    );
    assert.equal((html.match(/class="wk-tent-row"/g) || []).length, 2);
    // The figure stands in the mono face, the word in the text face.
    assert.match(html, /<b>2<\/b> Beutel/);
    assert.match(html, /LM-2<\/span> 01, 02/);
  });
});

describe('Startseite — Wo steht was, eine Zone zur Zeit', () => {
  // One zone at a time, picked from a chip per zone, as the farm built it
  // (#646). The redesign drew every zone at once: a small demo carried that, a
  // full farm did not; a single incubation room filled screens of rows.
  const chosen = (stored, bagsByZone) =>
    new Function('localStorage', 'getZoneBags', '_wkTentFold', `${lift('_wkZoneChosen')}\nreturn _wkZoneChosen;`)(
      { getItem: () => stored },
      (id) => bagsByZone[id] || {},
      { open: new Set(), zone: null }
    );
  const list = [{ id: 'FRA' }, { id: 'FRB' }, { id: 'INK' }];

  it('shows the zone picked on this device while it exists', () => {
    assert.equal(chosen('INK', {})(list), 'INK');
  });

  it('falls back to the first zone with bags in it, then to the first zone', () => {
    assert.equal(chosen('WEG', { INK: { 'B-01': {} } })(list), 'INK');
    assert.equal(chosen('', {})(list), 'FRA');
  });

  it('draws a chip per zone, marks the one on show, keeps the pick, and draws the rows of that one only', () => {
    const fn = lift('renderWorkTents');
    assert.match(fn, /class="wk-zchip" data-wk-zone="/);
    assert.match(fn, /aria-pressed="' \+\s*\(z === chosen\)/);
    assert.match(fn, /localStorage\.setItem\('mp-work-zone'/);
    assert.match(fn, /_wkZoneRowsHtml\(chosen, /);
    assert.doesNotMatch(fn, /list\s*\.map\(\(z\) =>\s*\{\s*const bags = getZoneBags/, 'every zone is drawn again');
  });
});

describe('Startseite — Was ansteht, nach Arbeit', () => {
  // A full farm's day has many times the rows of a demo. As a list capped at six
  // it showed notices and hid the moves due that morning. By job it is one
  // row per kind of work, with how many and how many of them are late, and a
  // tap opens the job's own rows. Run for real, against stubs of the plan.
  const box = { innerHTML: '', dataset: { bound: '1' } };
  const offen = new Set();
  const decl = APP.match(/^const WK_AN_GRUPPEN = \[[\s\S]*?\n\];/m);
  assert.ok(decl, 'WK_AN_GRUPPEN not found in app.js');
  const render = new Function(
    'document',
    'zones',
    'planKind',
    'esc',
    't',
    'tp',
    'loc',
    '_wkAnRowHtml',
    '_wkNoticeRowsHtml',
    '_wkAnOffen',
    `const WK_AN_CHEV = '<svg/>';\n${decl[0]}\n${lift('_wkAnGruppeHtml')}\n${lift('renderWorkDue')}\nreturn renderWorkDue;`
  )(
    { getElementById: () => box, querySelector: () => null },
    [],
    (it) => ({ alert: { rank: -10 } })[it.kind] || { rank: null },
    (x) => String(x),
    (k) => k,
    (k, n) => k + ':' + n,
    () => 'de-DE',
    (it) => '<row ' + it.kind + ' ' + it.label + '>',
    () => '<notice>',
    offen
  );
  const day = (items) => [{ items }];

  it('draws one row per job, in the order of the chain, with its count and how many are late', () => {
    render(
      day([
        { kind: 'alert', label: 'A1', overdue: true },
        { kind: 'alert', label: 'A2', overdue: true },
        { kind: 'fruiting', label: 'C1', overdue: true },
        { kind: 'fruiting', label: 'C2', overdue: false },
        { kind: 'fruiting', label: 'C3', overdue: true },
        { kind: 'harvest', label: 'H1', overdue: false },
        { kind: 'harvest', label: 'H2', overdue: false }
      ])
    );
    const h = box.innerHTML;
    assert.ok(h.indexOf('data-wk-gruppe="move"') < h.indexOf('data-wk-gruppe="harvest"'));
    assert.ok(h.indexOf('data-wk-gruppe="harvest"') < h.indexOf('data-wk-gruppe="alert"'));
    assert.match(
      h,
      /data-wk-gruppe="move" aria-expanded="false"><span class="wk-an-was">work\.grp\.move<span class="wk-an-wer"><span class="rot">work\.grp\.late:2<\/span> · work\.grp\.today:1<\/span><\/span><span class="wk-an-zahl">3<\/span>/
    );
    assert.doesNotMatch(h, /<row fruiting/, 'a closed job shows its rows');
    assert.ok(h.endsWith('<notice>'), 'the notices are no longer last');
  });

  it('opens a job to its own rows, and a job of one piece of work is that row', () => {
    offen.add('move');
    render(
      day([
        { kind: 'fruiting', label: 'C1', overdue: true },
        { kind: 'fruiting', label: 'C2' },
        { kind: 'harvest', label: 'H1' }
      ])
    );
    assert.match(
      box.innerHTML,
      /aria-expanded="true">[^]*?<div class="wk-an-teil"><row fruiting C1><row fruiting C2><\/div>/
    );
    assert.match(box.innerHTML, /<row harvest H1>/);
    assert.doesNotMatch(box.innerHTML, /data-wk-gruppe="harvest"/);
    offen.clear();
  });

  it('calls stock alarms urgent, not late', () => {
    render(
      day([
        { kind: 'alert', label: 'A1', overdue: true },
        { kind: 'alert', label: 'A2', overdue: false }
      ])
    );
    assert.match(box.innerHTML, /data-wk-gruppe="alert"[^]*?<span class="rot">work\.grp\.urgent:1<\/span>/);
    assert.doesNotMatch(box.innerHTML, /work\.grp\.late/);
  });

  it('leaves out what is done, and says so when nothing is left', () => {
    render(day([{ kind: 'fruiting', label: 'C1', done: true }]));
    assert.doesNotMatch(box.innerHTML, /<row/);
    assert.match(box.innerHTML, /work\.todayNone/);
  });
});

describe('Startseite — Was ansteht', () => {
  // The list under the jobs. Its rows are the week plan's own, and each carries
  // the attributes of the button the week draws for it, so a tap on a row does
  // exactly what that button does. Run for real, against stubs of the plan.
  const PLAN_KINDS = {
    supply: { btn: 'supply' },
    fruiting: { btn: 'task' },
    manual: { btn: 'manual' },
    left: { btn: '' }
  };
  const BTNS = {
    supply: (it) =>
      `<button class="btn" data-action="supply-make-grain" data-sorte="${it.task.key}" style="padding:3px">Körnerbrut ansetzen</button>`,
    task: (it) =>
      `<button class="btn btn-p" data-action="move-to-fruiting" data-batch="${it.batchId}" style="x">→ Fruchtung</button>` +
      `<button class="btn" data-action="open-move-modal" data-batch="${it.batchId}" style="y">Umziehen</button>`,
    manual: (it) => `<button class="btn" data-action="toggle-task" data-id="${it.taskId}">Erledigt</button>`,
    '': () => ''
  };
  const row = new Function(
    'esc',
    't',
    'tp',
    'zoneDisplayName',
    'planKind',
    '_planBtn',
    `const WK_AN_CHEV = '<svg/>';\n${lift('_wkAnBtn')}\n${lift('_wkAnRowHtml')}\nreturn _wkAnRowHtml;`
  )(
    (x) => String(x),
    (k) => k,
    (k, n) => n + ' Beutel',
    (z) => 'Zone ' + z,
    (it) => PLAN_KINDS[it.kind] || null,
    (it) => BTNS[(PLAN_KINDS[it.kind] || { btn: '' }).btn](it)
  );

  it('says the verdict first and the Sorte second for a gap in the supply', () => {
    const now = row({ kind: 'supply', label: 'Testart Alpha', overdue: true, task: { key: 'id:1', supply: 'now' } });
    assert.match(now, /^<button type="button" class="wk-an-zeile" data-action="supply-make-grain" data-sorte="id:1">/);
    assert.match(now, /class="wk-an-was rot">batch\.supply\.now<span class="wk-an-wer">Testart Alpha<\/span>/);
    const later = row({
      kind: 'supply',
      label: 'Testart Beta',
      overdue: false,
      task: { key: 'id:2', supply: 'nospawn' }
    });
    assert.match(later, /class="wk-an-was bernstein">batch\.supply\.nospawn/);
  });

  it('takes the picker and not the one-tap move, and names the Charge second', () => {
    const html = row({ kind: 'fruiting', label: 'TA-1', batchId: 'TA-1', zone: 'INK', bags: 6, overdue: true });
    assert.match(html, /data-action="open-move-modal" data-batch="TA-1"/);
    assert.doesNotMatch(html, /move-to-fruiting/, 'a tap in passing would move a Charge without asking');
    assert.match(html, /class="wk-an-was rot">Umziehen<span class="wk-an-wer">TA-1 · Zone INK · 6 Beutel<\/span>/);
    assert.doesNotMatch(html, /style=/, 'the button of the week brought its inline style along');
  });

  it('leads with the Sorte in the ink inside an opened job, whose heading already says how many are late', () => {
    const html = row(
      {
        kind: 'fruiting',
        label: 'TA-1',
        batchId: 'TA-1',
        species: 'Testart Alpha',
        zone: 'INK',
        bags: 6,
        overdue: true
      },
      true
    );
    assert.match(html, /class="wk-an-was">Testart Alpha<span class="wk-an-wer">TA-1 · Zone INK · 6 Beutel<\/span>/);
    assert.match(html, /data-action="open-move-modal" data-batch="TA-1"/, 'the row lost what a tap on it does');
  });

  it('keeps the button on work that is ticked off', () => {
    const html = row({ kind: 'manual', label: 'Raum putzen', taskId: 7, overdue: false });
    assert.match(html, /^<div class="wk-an-zeile wk-an-haken">/);
    assert.match(html, /data-action="toggle-task" data-id="7">Erledigt<\/button>/);
  });

  it('is drawn with the week, and its taps reach the handler of the week', () => {
    assert.match(lift('renderDashBatchTasks'), /renderWorkDue\(week\);/);
    assert.match(APP, /\$\('wk-an'\)\.addEventListener\('click', dashTaskCardClick\);/);
    assert.match(lift('renderWorkDue'), /for \(const g of WK_AN_GRUPPEN\)/, 'the rows are no longer drawn by job');
  });

  it('opens the week from the heading of the list', () => {
    assert.match(HTML, /id="wk-today"[^>]*aria-controls="dash-batch-tasks-card"/);
    assert.match(lift('_wkTasksAreOpen'), /=== '1'/, 'the week no longer starts folded away');
  });
});

describe('Startseite — keine eigene Reihenfolge mehr einzustellen', () => {
  it('has no editor on the page, and keeps an order somebody set earlier', () => {
    assert.doesNotMatch(HTML, /wk-order/);
    assert.doesNotMatch(APP, /wk-order-btn|renderWkOrderList/);
    assert.match(APP, /\(function wireWorkSteps\(\) \{\n {2}applyWkTileOrder\(\);/);
  });
});

describe('Startseite — eigene Reihenfolge', () => {
  function load(stored, username, serverOrder) {
    const store = new Map(stored ? [['mp-tile-order:' + username, stored]] : []);
    const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
    const src = ['WK_TILES', 'WK_TILE_DEFAULT']
      .map((n) => APP.match(new RegExp(`^const ${n} = [\\s\\S]*?;\\n`, 'm'))[0])
      .join('\n');
    const fns = ['_wkOrderKey', '_wkLocalOrder', 'wkTileOrder'].map(lift).join('\n');
    return new Function('localStorage', 'currentUser', `${src}\n${fns}\nreturn { wkTileOrder };`)(
      localStorage,
      username ? { username, tileOrder: serverOrder === undefined ? null : serverOrder } : null
    );
  }

  it('takes the order stored on the server over the copy on the phone', () => {
    const o = load(JSON.stringify(['lab']), 'max', ['grain', 'contam']).wkTileOrder();
    assert.deepEqual(o.slice(0, 2), ['grain', 'contam']);
    assert.equal(o.length, 7);
  });

  it('falls back to the phone copy while the server has none', () => {
    assert.equal(load(JSON.stringify(['lab']), 'max', null).wkTileOrder()[0], 'lab');
  });

  it('starts from the default order with Kontamination last', () => {
    const o = load(null, 'max').wkTileOrder();
    assert.equal(o[o.length - 1], 'contam');
    assert.equal(o.length, 7);
  });

  it('keeps each user their own order', () => {
    const mine = JSON.stringify(['lab', 'harvest', 'move']);
    assert.deepEqual(load(mine, 'max').wkTileOrder().slice(0, 3), ['lab', 'harvest', 'move']);
    // Max's order is stored under his name; Erika on the same phone has none.
    const store = new Map([['mp-tile-order:max', mine]]);
    const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: () => {} };
    const src = ['WK_TILES', 'WK_TILE_DEFAULT']
      .map((n) => APP.match(new RegExp(`^const ${n} = [\\s\\S]*?;\\n`, 'm'))[0])
      .join('\n');
    const fns = ['_wkOrderKey', '_wkLocalOrder', 'wkTileOrder'].map(lift).join('\n');
    const forErika = new Function('localStorage', 'currentUser', `${src}\n${fns}\nreturn wkTileOrder;`)(ls, {
      username: 'erika'
    });
    assert.equal(forErika()[0], 'move');
  });

  it('drops unknown and duplicate tiles and appends missing ones', () => {
    const o = load(JSON.stringify(['old', 'harvest', 'harvest']), 'max').wkTileOrder();
    assert.equal(o[0], 'harvest');
    assert.equal(o.length, 7);
    assert.ok(!o.includes('old'));
  });

  it('survives garbage in storage', () => {
    assert.equal(load('{not json', 'max').wkTileOrder().length, 7);
    assert.equal(load('{"a":1}', 'max').wkTileOrder().length, 7);
  });
});
