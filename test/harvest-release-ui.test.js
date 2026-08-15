'use strict';
// The release table: removing a species, and not losing what was typed.
//
// Two things this screen got wrong, and both were invisible from the server.
//
// The button at the end of a row emptied the two inputs and nothing else. Save
// then wrote `grams: 0`, which publishes nothing — so it looked like it had
// worked — but left the row in `harvest_release` for good. The species came back
// on every load, and the list filled up with decisions somebody had already
// taken. `remove: true` and db.deleteHarvestRelease() existed the whole time;
// no caller ever used them.
//
// The second is worse because nobody touches anything to trigger it. This table
// saves on a button, deliberately: the amount reaches a shop within one feed
// interval, so 50 typed on the way to 5 must not be published in passing. But
// renderPickups() runs on every `data-changed` event — every scan by every
// client in the building — and it reloaded the table from the server. Somebody
// two rooms away scanning a bag wiped a half-typed release, with no click, no
// keystroke and no warning on the screen it happened to.
//
// These functions live in app.js, which has no module boundary, so the test
// lifts them out of the source and runs them against a stub DOM. Same approach
// as culture-badges.test.js: the browser is not the thing under test, the
// decisions are.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Named so a failure says which function moved, rather than "unexpected token".
const TEILE = [
  [/^function esc\(s\) \{[\s\S]*?\n\}/m, 'esc()'],
  [/^let harvestReleaseRows = \[\];/m, 'harvestReleaseRows'],
  [/^let harvestReleasePromised = \{\};/m, 'harvestReleasePromised'],
  [/^let harvestReleaseUnattributed = 0;/m, 'harvestReleaseUnattributed'],
  [/^let harvestReleaseFeed = null;/m, 'harvestReleaseFeed'],
  [/^function promisedCells\(row\) \{[\s\S]*?\n\}/m, 'promisedCells()'],
  [/^function renderHarvestReleaseUnattributed\(\) \{[\s\S]*?\n\}/m, 'renderHarvestReleaseUnattributed()'],
  [/^async function loadHarvestReleases\(\) \{[\s\S]*?\n\}/m, 'loadHarvestReleases()'],
  [/^function freshReleaseRow\(row\) \{[\s\S]*?\n\}/m, 'freshReleaseRow()'],
  [/^function harvestReleaseChanges\(\) \{[\s\S]*?\n\}/m, 'harvestReleaseChanges()'],
  [/^function harvestReleaseDirty\(\) \{[\s\S]*?\n\}/m, 'harvestReleaseDirty()'],
  [/^function harvestReleaseRemoveBtn\(row\) \{[\s\S]*?\n\}/m, 'harvestReleaseRemoveBtn()'],
  [/^function renderHarvestReleases\(\) \{[\s\S]*?\n\}/m, 'renderHarvestReleases()'],
  [/^function removeHarvestReleaseRow\(row\) \{[\s\S]*?\n\}/m, 'removeHarvestReleaseRow()'],
  [/^async function saveHarvestReleases\(\) \{[\s\S]*?\n\}/m, 'saveHarvestReleases()'],
  [/^const leaveGuards = \[\];/m, 'leaveGuards'],
  [/^function guardUnsaved\(ask, discard\) \{[\s\S]*?\n\}/m, 'guardUnsaved()'],
  [/^function askGuard\(g\) \{[\s\S]*?\n\}/m, 'askGuard()'],
  [/^function mayLeavePage\(\) \{[\s\S]*?\n\}/m, 'mayLeavePage()']
];

/**
 * Lift the release table's decisions out of app.js and make them callable.
 *
 * Everything the lifted code reaches for that belongs to the page or the network
 * is replaced by a recorder, so a test can read back what was posted, what was
 * asked, and how often the table was redrawn.
 */
function laden(opts) {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const code = TEILE.map(([re, was]) => {
    const m = src.match(re);
    assert.ok(m, 'could not find ' + was + ' in app.js — has it been renamed?');
    return m[0];
  }).join('\n\n');

  const log = { posts: [], fragen: [], renders: 0, ergebnis: [], geholt: 0, html: '' };
  const stub = `
    // Der Schlüssel statt der Übersetzung — aber **mit** den eingesetzten
    // Werten, wie das echte t() es tut. Ohne die zweite Hälfte kann ein Test nur
    // zählen, nicht lesen: Eine Meldung, die eine Menge nennt, sähe genauso aus
    // wie eine, die es vergisst.
    const t = (k, params) =>
      !params ? k : k + ' ' + Object.keys(params).map((n) => n + '=' + params[n]).join(' ');
    const tp = (k, n) => k + '.' + (n === 1 ? 'one' : 'other') + ':' + n;
    let knownSpecies = [];
    // The one element the table writes to. Recording innerHTML is what lets a
    // test read back the state a row is in — struck through, marked, disabled.
    const koerper = {
      set innerHTML(v) { log.html = v; log.renders++; },
      get innerHTML() { return log.html; },
      querySelectorAll: () => []
    };
    // Die Fußzeile für die nicht zuzuordnenden Vormerkungen. Eigene Attrappe,
    // weil der Aufruf in die Zelle schreibt und nicht in die Zeile — genau der
    // Unterschied, den das voreingestellte leere Element verschluckt hätte.
    const fussZelle = { textContent: '' };
    const fussZeile = { style: {}, querySelector: () => fussZelle };
    log.fuss = { zeile: fussZeile, zelle: fussZelle };
    const document = {
      getElementById: (id) =>
        id === 'harvestrelease-body' ? koerper : id === 'harvestrelease-unattributed' ? fussZeile : { style: {} }
    };
    const window = { confirm: (frage) => { log.fragen.push(frage); return log.antwort; } };
    const apiPost = async (url, body) => { log.posts.push({ url, body }); };
    const authFetch = async () => { log.geholt++; return { ok: true, json: async () => log.antwortDaten }; };
    const fillHarvestReleasePicker = () => {};
    const updateHarvestReleasePending = () => {};
    const showHarvestReleaseResult = (msg) => { log.ergebnis.push(msg); };
    const fmtDtTime = (v) => String(v);
  `;
  const api = new Function(
    'log',
    stub +
      '\n' +
      code +
      '\nreturn { log, guardUnsaved, mayLeavePage, leaveGuards, loadHarvestReleases, freshReleaseRow,' +
      ' harvestReleaseChanges, harvestReleaseDirty, harvestReleaseRemoveBtn, renderHarvestReleases,' +
      ' removeHarvestReleaseRow, saveHarvestReleases, promisedCells,' +
      ' rows: () => harvestReleaseRows, setRows: (r) => { harvestReleaseRows = r; },' +
      ' setPromised: (p, rest) => { harvestReleasePromised = p; harvestReleaseUnattributed = rest || 0; } };'
  )(log);
  Object.assign(log, opts || {});
  return api;
}

/** A row as it stands after a load: `stored` when the server actually holds one. */
function zeile(over) {
  return { species: 'Oyster', harvested: null, grams: 0, validUntil: null, stored: false, ...over };
}

describe('release table — removing a species', () => {
  let ui;
  beforeEach(() => {
    ui = laden();
  });

  it('sends remove, not a zero amount', async () => {
    // The whole bug in one assertion. `grams: 0` publishes nothing either, which
    // is why the old button looked like it worked — and why the row survived
    // every reload afterwards.
    ui.setRows([ui.freshReleaseRow(zeile({ grams: 2000, stored: true }))]);
    ui.removeHarvestReleaseRow(ui.rows()[0]);
    await ui.saveHarvestReleases();
    assert.deepEqual(ui.log.posts, [{ url: '/api/harvest-feed/release', body: { species: 'Oyster', remove: true } }]);
  });

  it('marks a stored row instead of deleting it on the spot', () => {
    // Everything else here waits for Save. A delete that did not would be the
    // one action on the page that cannot be undone by walking away from it.
    ui.setRows([ui.freshReleaseRow(zeile({ grams: 2000, stored: true }))]);
    ui.removeHarvestReleaseRow(ui.rows()[0]);
    assert.equal(ui.rows().length, 1, 'still on screen, struck through');
    assert.equal(ui.rows()[0].removing, true);
    assert.deepEqual(ui.log.posts, [], 'nothing sent until Save');
  });

  it('drops a row that was never stored, without asking the server', () => {
    // Added from the picker and not yet saved: there is nothing to delete and
    // nothing to take back, so it just leaves.
    ui.setRows([ui.freshReleaseRow(zeile({ species: 'Shiitake' }))]);
    ui.removeHarvestReleaseRow(ui.rows()[0]);
    assert.deepEqual(ui.rows(), []);
    assert.deepEqual(ui.log.posts, []);
  });

  it('offers no remove button for a species that is only listed because it was harvested', () => {
    // It comes straight back on the next load — it is an observation, not a
    // decision. A button promising otherwise is worse than no button.
    assert.equal(ui.harvestReleaseRemoveBtn(zeile({ harvested: 2400 })), '');
    assert.match(ui.harvestReleaseRemoveBtn(zeile({ harvested: 2400, stored: true })), /hr-remove/);
    assert.match(ui.harvestReleaseRemoveBtn(zeile({ stored: true, removing: true })), /hr-undo/);
  });

  it('shows a marked row as marked, and locks its fields', () => {
    // The old button emptied the two inputs, and that is the whole reason
    // "clear" got read as "remove": afterwards the row is indistinguishable from
    // a species nobody released, and nothing on screen says what Save will do
    // with it. A marked row keeps its numbers, struck through and labelled.
    const row = ui.freshReleaseRow(zeile({ grams: 2000, validUntil: '2026-08-20', stored: true }));
    ui.setRows([row]);
    ui.removeHarvestReleaseRow(row);
    const html = ui.log.html;
    assert.match(html, /line-through/, 'struck through');
    assert.match(html, /harvestFeed\.markedRemoved/, 'and says why');
    assert.match(html, /value="2\.00"[^>]*disabled/, 'the amount is still readable, and no longer editable');
    assert.match(html, /value="2026-08-20"[^>]*disabled/);
    assert.match(html, /hr-undo/, 'with the way back');
  });

  it('takes the mark back without having sent anything', () => {
    const row = ui.freshReleaseRow(zeile({ grams: 2000, stored: true }));
    ui.setRows([row]);
    ui.removeHarvestReleaseRow(row);
    row.removing = false;
    assert.deepEqual(ui.harvestReleaseChanges(), [], 'back to untouched');
  });
});

describe('release table — what is typed but not saved', () => {
  let ui;
  beforeEach(() => {
    ui = laden();
  });

  it('counts an edited amount and ignores an untouched row', () => {
    const row = ui.freshReleaseRow(zeile({ grams: 2000, stored: true }));
    ui.setRows([row, ui.freshReleaseRow(zeile({ species: 'Shiitake', grams: 500, stored: true }))]);
    assert.equal(ui.harvestReleaseDirty(), false, 'a freshly loaded table is not pending');
    row.kg = '3.00';
    assert.deepEqual(
      ui.harvestReleaseChanges().map((r) => r.species),
      ['Oyster']
    );
  });

  it('tints a touched row and leaves an untouched one plain', () => {
    // The mark is the only thing standing between a typed number and a Save
    // button nobody pressed.
    const row = ui.freshReleaseRow(zeile({ grams: 2000, stored: true }));
    ui.setRows([row]);
    ui.renderHarvestReleases();
    assert.doesNotMatch(ui.log.html, /amber-light/);
    row.kg = '3.00';
    ui.renderHarvestReleases();
    assert.match(ui.log.html, /amber-light/);
  });

  it('counts a changed date as well as a changed amount', () => {
    const row = ui.freshReleaseRow(zeile({ grams: 2000, validUntil: '2026-08-20', stored: true }));
    ui.setRows([row]);
    row.until = '2026-08-25';
    assert.equal(ui.harvestReleaseDirty(), true);
  });

  it('leaves an empty row somebody added alone', () => {
    // Adding a species and never filling it in costs nothing, and must not make
    // the page ask a question on the way out.
    ui.setRows([ui.freshReleaseRow(zeile({ species: 'Shiitake' }))]);
    assert.equal(ui.harvestReleaseDirty(), false);
  });

  it('refuses to redraw while something is pending', async () => {
    // The one that bites without anybody doing anything: renderPickups() runs on
    // every data-changed event, which is every scan by every client.
    const row = ui.freshReleaseRow(zeile({ grams: 2000, stored: true }));
    ui.setRows([row]);
    row.kg = '5.00';
    await ui.loadHarvestReleases();
    assert.equal(ui.log.geholt, 0, 'the server was not even asked');
    assert.equal(ui.log.renders, 0);
    assert.equal(ui.rows()[0].kg, '5.00', 'still what was typed');
  });

  it('redraws again once the table is clean', async () => {
    ui.log.antwortDaten = { recent: [], releases: [{ species: 'Oyster', grams: 2000 }], known: ['Oyster'] };
    await ui.loadHarvestReleases();
    assert.equal(ui.log.renders, 1);
    assert.equal(ui.rows()[0].kg, '2.00', 'grams on the wire, kilos in the form');
    assert.equal(ui.rows()[0].stored, true);
  });

  it('is clean again after a save, so the next refresh gets through', async () => {
    // Skipping this would freeze the table on the values it just saved: the
    // guard above would refuse every reload from then on.
    const row = ui.freshReleaseRow(zeile({ grams: 2000, stored: true }));
    ui.setRows([row]);
    row.kg = '5.00';
    ui.log.antwortDaten = { recent: [], releases: [{ species: 'Oyster', grams: 5000 }], known: ['Oyster'] };
    await ui.saveHarvestReleases();
    assert.deepEqual(ui.log.posts, [
      { url: '/api/harvest-feed/release', body: { species: 'Oyster', grams: 5000, validUntil: null } }
    ]);
    assert.equal(ui.log.geholt, 1, 'the reload was allowed through');
  });

  it('does not post rows nobody touched', async () => {
    // Posting all of them would stamp `updated` on decisions nobody revisited,
    // and create a zero row for every species ever harvested.
    ui.setRows([
      ui.freshReleaseRow(zeile({ grams: 2000, stored: true })),
      ui.freshReleaseRow(zeile({ species: 'Shiitake', harvested: 2400 }))
    ]);
    await ui.saveHarvestReleases();
    assert.deepEqual(ui.log.posts, []);
    assert.deepEqual(ui.log.ergebnis, ['harvestFeed.nothingChanged']);
  });

  it('refuses an amount that is not a number', async () => {
    const row = ui.freshReleaseRow(zeile({ stored: true }));
    ui.setRows([row]);
    row.kg = 'zwei';
    await ui.saveHarvestReleases();
    assert.deepEqual(ui.log.ergebnis, ['harvestFeed.badAmount']);
    assert.deepEqual(ui.log.posts, []);
  });

  it('does not check the amount on a row that is on its way out', async () => {
    // The field is disabled and struck through; whatever is left in it is not
    // going anywhere. Validating it would block the removal on a stale typo.
    const row = ui.freshReleaseRow(zeile({ grams: 2000, stored: true }));
    ui.setRows([row]);
    row.kg = 'zwei';
    row.removing = true;
    await ui.saveHarvestReleases();
    assert.deepEqual(ui.log.posts, [{ url: '/api/harvest-feed/release', body: { species: 'Oyster', remove: true } }]);
  });
});

describe('leaving a page with unsaved work', () => {
  let ui;
  beforeEach(() => {
    ui = laden();
  });

  it('says nothing when nothing is pending', () => {
    ui.guardUnsaved(() => null);
    assert.equal(ui.mayLeavePage(), true);
    assert.deepEqual(ui.log.fragen, [], 'a question nobody needed is how people learn to click past them');
  });

  it('asks, and stays put on a no', () => {
    let verworfen = false;
    ui.guardUnsaved(
      () => 'still pending',
      () => {
        verworfen = true;
      }
    );
    ui.log.antwort = false;
    assert.equal(ui.mayLeavePage(), false);
    assert.deepEqual(ui.log.fragen, ['still pending']);
    assert.equal(verworfen, false, 'nothing may be dropped while the page is still open');
  });

  it('drops the edits once leaving is confirmed', () => {
    // Without this the screen keeps counting changes the person chose to lose,
    // and goes on refusing every refresh.
    let verworfen = false;
    ui.guardUnsaved(
      () => 'still pending',
      () => {
        verworfen = true;
      }
    );
    ui.log.antwort = true;
    assert.equal(ui.mayLeavePage(), true);
    assert.equal(verworfen, true);
  });

  it('asks every guard before dropping any of them', () => {
    // A "cancel" on the second question must not leave the first one's edits
    // already thrown away — the page is still open and still showing them.
    const dropped = [];
    ui.guardUnsaved(
      () => 'first',
      () => dropped.push('first')
    );
    ui.guardUnsaved(
      () => 'second',
      () => dropped.push('second')
    );
    ui.log.antwort = false;
    assert.equal(ui.mayLeavePage(), false);
    assert.deepEqual(dropped, []);
  });

  it('does not lock the application on one page when a guard throws', () => {
    ui.guardUnsaved(() => {
      throw new Error('broken');
    });
    assert.equal(ui.mayLeavePage(), true);
  });
});

// ── V1: was von der Freigabe schon vergeben ist ──────────────────────────────
//
// Die Tabelle zeigte, wieviel ein Shop verkaufen darf, und die Liste darunter,
// wieviel davon schon versprochen ist — und nichts zog das eine vom anderen ab.
// Wer am Stand nach der oberen Zahl handelte, versprach bis zur Hälfte zu viel.
describe('release table — how much of a release is already booked', () => {
  let ui;
  beforeEach(() => {
    ui = laden();
  });

  it('shows what is promised and what is left of a release', () => {
    ui.setPromised({ 'Oyster (OY)': 800 });
    const [vorgemerkt, frei] = ui
      .promisedCells(ui.freshReleaseRow(zeile({ species: 'Oyster (OY)', grams: 2000, stored: true })))
      .split('</td>');
    assert.match(vorgemerkt, /0\.80 kg/);
    assert.match(frei, /1\.20 kg/);
  });

  it('measures against the saved amount, not a half-typed one', () => {
    // ⚠️ Der Kern der Spalte: Sie soll am Stand zu gebrauchen sein. Gegen eine
    // Zahl zu rechnen, die noch in keinem Feed steht, zeigte eine freie Menge,
    // die es nur in diesem Browser gibt.
    ui.setPromised({ 'Oyster (OY)': 800 });
    const row = ui.freshReleaseRow(zeile({ species: 'Oyster (OY)', grams: 2000, stored: true }));
    row.kg = '9.00'; // getippt, nicht gespeichert
    assert.match(ui.promisedCells(row), /1\.20 kg/);
  });

  it('does not read as a quantity when more is promised than released', () => {
    // Mehr versprochen als zurückgelegt ist echt und kein Rechenfehler — es ist
    // nichts mehr da, und jemand muss entscheiden, was passiert.
    ui.setPromised({ 'Oyster (OY)': 2500 });
    const raus = ui.promisedCells(ui.freshReleaseRow(zeile({ species: 'Oyster (OY)', grams: 2000, stored: true })));
    assert.match(raus, /-0\.50 kg/);
    assert.match(raus, /c-red-dark/, 'die Zahl steht als Warnung da, nicht als Menge');
  });

  it('leaves both cells empty for a species nobody has released', () => {
    // „Nichts freigegeben" und „alles weg" sind verschiedene Lagen, und nur eine
    // davon heißt aufhören zu verkaufen.
    ui.setPromised({});
    assert.equal(
      ui.promisedCells(ui.freshReleaseRow(zeile({ species: 'Oyster (OY)', grams: 0 }))).includes('0.00'),
      false
    );
  });

  it('never lets a booking it cannot attribute vanish silently', () => {
    // Zu klein ist die Richtung, die Ware kostet — deshalb wird es genannt statt
    // weggelassen. Betrifft Abholungen, die gemeldet wurden, bevor der Empfänger
    // den Artnamen mitschickte; sie altern von selbst heraus.
    ui.setPromised({}, 300);
    ui.setRows([ui.freshReleaseRow(zeile({ species: 'Oyster (OY)', grams: 2000, stored: true }))]);
    ui.renderHarvestReleases();
    assert.equal(ui.log.fuss.zeile.style.display, '', 'die Fußzeile steht da');
    assert.match(ui.log.fuss.zelle.textContent, /0\.30/, 'mit der Menge, die niemandem zugeordnet werden konnte');
  });

  it('says nothing when every booking could be attributed', () => {
    ui.setPromised({ 'Oyster (OY)': 800 }, 0);
    ui.setRows([ui.freshReleaseRow(zeile({ species: 'Oyster (OY)', grams: 2000, stored: true }))]);
    ui.renderHarvestReleases();
    assert.equal(ui.log.fuss.zeile.style.display, 'none');
  });

  it('mentions them even when no release is listed at all', () => {
    // Der frühe Rückkehrpunkt für die leere Tabelle ließ die Zeile sonst aus —
    // ausgerechnet in der Lage, in der sie am meisten zu sagen hat.
    ui.setPromised({}, 300);
    ui.setRows([]);
    ui.renderHarvestReleases();
    assert.equal(ui.log.fuss.zeile.style.display, '');
  });
});
