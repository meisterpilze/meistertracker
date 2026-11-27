'use strict';
// Drucken › Referenz-Barcodes: the groups are named in the language of the app.
//
// The sheet of barcodes to hang up on the wall has groups: the actions, the
// zones, and the racks of each room, five at a time. Their names were written
// into the list when it was built, in English: "Actions", "Zones",
// "<room> Racks 1–5", under a printed heading "Reference Barcodes". Everything
// around them was German.
//
// A group now carries the key of its name and is named when it is drawn, so a
// change of language reaches it too, and a room is called what it is called
// everywhere else. The codes under the bars stay as they are: they are what
// the scanner reads.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function hebe(name) {
  const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
  assert.ok(m, name + '() not found in app.js');
  return m[1];
}
function lang(code) {
  const window = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'lang', code + '.js'), 'utf8'))(window);
  return window.LANG[code];
}

describe('Referenz-Barcodes: the names of the groups', () => {
  const bau = hebe('rebuildZoneConstants');

  it('are keys in the list, not English words', () => {
    const namen = [...bau.matchAll(/\bg: ([^,\n]+),/g)].map((m) => m[1]);
    assert.deepEqual(namen, ["'print.refActions'", "'print.refZones'", "'print.refRacks'"]);
    assert.doesNotMatch(bau, /' Racks '/);
  });

  it('are said in the language that is set, with the room called what it is called everywhere', () => {
    const name = new Function('t', 'zoneDisplayName', hebe('refGroupName') + '\nreturn refGroupName;')(
      (k, p) => (p ? k + JSON.stringify(p) : k),
      (id) => 'Raum ' + id
    );
    assert.equal(name({ g: 'print.refActions', items: [] }), 'print.refActions');
    assert.equal(
      name({ g: 'print.refRacks', zone: 'TESTZONE', from: 6, to: 10, items: [] }),
      'print.refRacks{"zone":"Raum TESTZONE","from":6,"to":10}'
    );
  });

  it('are drawn through that function on the page and on the printed sheet, escaped on the page', () => {
    assert.match(hebe('renderRefBarcodes'), /<div class="sec">\$\{esc\(refGroupName\(group\)\)\}<\/div>/);
    const druck = hebe('printRef');
    assert.match(druck, /sec\.textContent = refGroupName\(group\);/);
    assert.match(druck, /title\.textContent = t\(useQR \? 'print\.refSheetQr' : 'print\.refBarcodes'\);/);
    assert.doesNotMatch(APP, /'Reference '/);
    assert.doesNotMatch(APP, /group\.g\b(?!,)[^)]*\}<\/div>/, 'a group name is written into markup as it stands');
  });

  it('exist in all three languages, and German is German', () => {
    for (const code of ['de', 'en', 'pt']) {
      const L = lang(code);
      for (const k of ['print.refActions', 'print.refZones', 'print.refRacks', 'print.refSheetQr']) {
        assert.ok(L[k], code + ' has no ' + k);
      }
      assert.match(L['print.refRacks'], /\{zone\}.*\{from\}.*\{to\}/, code + ': the racks name lost a placeholder');
    }
    const de = lang('de');
    assert.equal(de['print.refActions'], 'Aktionen');
    assert.equal(de['print.refZones'], 'Zonen');
    assert.match(de['print.refRacks'], /Regale/);
  });
});
