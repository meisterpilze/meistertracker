'use strict';
// Where things stand: Zonen, and only Zonen.
//
// Chargen › Standorte drew every room with its racks and one chip per bag. It
// was the older of two views of the same rooms: Zonen shows each room, its
// racks and their Fächer, finds a Sorte, and its sheets move bags by number.
// Two places answered "wo steht es", in two menu groups, and they did not look
// alike.
//
// The room view is gone. One thing it alone carried is kept: the button that
// opens the stock check of a room (openZoneCheck) stood in the heading of each
// room with racks. It is now in the sheet of that room on Zonen. What the check
// does not find still goes through selectedLocBags to the move and remove
// flows, which stay.
//
// Text and lifted functions, no browser.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function hebe(name) {
  const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
  assert.ok(m, name + '() not found in app.js');
  return m[1];
}

describe('the room view under Chargen is gone', () => {
  it('has no tab, panel, search field or selection bar left in the markup', () => {
    for (const id of ['st-batch-locations', 'sp-batch-locations', 'dash-locations', 'status-q', 'loc-action-bar']) {
      assert.equal(HTML.includes('id="' + id + '"'), false, `#${id} is still in index.html`);
    }
  });

  it('has nothing in app.js that draws or wires it', () => {
    // A leftover getElementById('dash-locations').addEventListener(...) at the
    // top level would throw on load and take every handler below it along.
    for (const name of ['renderStatus', 'renderRackSection', 'toggleLocBag', 'updateActionBar', 'locSortControlHtml']) {
      assert.equal(new RegExp('\\b' + name + '\\b').test(APP), false, `${name} is still named in app.js`);
    }
    assert.doesNotMatch(APP, /'(dash-locations|status-q|loc-action-bar|sp-batch-locations|st-batch-locations)'/);
  });

  it('still redraws the list of Chargen where the room view was redrawn', () => {
    // renderStatus() ended in renderBatches(); its callers now ask for that.
    assert.match(hebe('brettNeuZeichnen'), /renderBatches\(\);/);
    assert.match(
      hebe('refresh'),
      /if \(id === 'batch'\) \{\s*renderBatches\(\);\s*\}|if \(id === 'batch'\) renderBatches\(\);/
    );
  });
});

describe('the stock check of a room starts on Zonen', () => {
  function blatt(zone) {
    const out = {};
    const el = (id) => (out[id] = out[id] || {});
    const zeichne = new Function(
      'zones',
      '_zoneEdit',
      'document',
      'zoneEditClose',
      'getZoneBags',
      'zoneDisplayName',
      'tp',
      't',
      'zonenReihe',
      'esc',
      hebe('zoneEditZeichne') + '\nzoneEditZeichne();'
    );
    zeichne(
      [zone],
      zone.id,
      { getElementById: el },
      () => {},
      () => ({}),
      (id) => id,
      (k, n) => k + ':' + n,
      (k) => k,
      () => [zone],
      (s) => String(s)
    );
    return out['m-zone-edit-body'].innerHTML;
  }

  it('offers it in the sheet of a room with racks, first', () => {
    const html = blatt({ id: 'INC', role: 'incubation', racks: [{ id: 'INC_R1', levels: 4 }] });
    assert.match(html, /data-zone-edit="check"[^>]*>zoneCheck\.btn</);
    assert.ok(
      html.indexOf('zones.grpCheck') < html.indexOf('zones.grpRoom'),
      'the check is not above the settings of the room'
    );
  });

  it('does not offer it for a room without racks, as before', () => {
    const html = blatt({ id: 'TENT', role: 'fruiting', racks: [] });
    assert.doesNotMatch(html, /data-zone-edit="check"/);
    assert.match(html, /zones\.grpRoom/);
  });

  it('opens the check from that button, after the sheet has closed', () => {
    const wire = hebe('zoneEditWire');
    assert.match(wire, /else if \(a === 'check'\) openZoneCheck\(id\);/);
    assert.ok(
      wire.indexOf('zoneEditClose();\n    if (a ===') < wire.indexOf("a === 'check'"),
      'the sheet would stay open under the check'
    );
  });

  it('shows on Zonen what the check moved, removed or took back', () => {
    for (const name of ['locMoveTo', 'locRemoveSelected', 'locUndo']) {
      assert.match(hebe(name), /renderBatches\(\);\s*renderZones\(\);/, `${name}() does not redraw Zonen`);
    }
  });

  it('keeps the way from "not found" to move and remove', () => {
    assert.match(APP, /if \(act\.dataset\.zcAct === 'move'\) openLocMovePopup\(\);\s*else locRemoveSelected\(\);/);
    assert.match(hebe('openLocMovePopup'), /selectedLocBags/);
  });
});
