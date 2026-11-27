'use strict';
// Dialogs nothing opens.
//
// Two dialogs stood in the markup that no code could open any more. "Beutel"
// (m-locmove) moved one bag picked in the room view under Chargen; its grid was
// replaced by the shared zone picker long ago, and the code only ever closed
// it. "Wohin kommen diese Beutel?" (m-zone-pick) was not named in app.js at
// all: the question is asked by the same shared picker. Both went.
//
// The check that stays: a dialog in the markup that app.js never names is a
// dialog nobody can see. It is cheap to hold and catches the next one.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

describe('dialogs in the markup', () => {
  it('no longer hold the two that could not be opened', () => {
    for (const id of ['m-locmove', 'lm-grid', 'cls-9', 'btn-10', 'm-zone-pick', 'zp-zones']) {
      assert.equal(HTML.includes('id="' + id + '"'), false, `#${id} is still in index.html`);
      assert.equal(new RegExp('[\'"`]' + id + '[\'"`]').test(APP), false, `${id} is still named in app.js`);
    }
  });

  it('are each named somewhere in app.js', () => {
    const ids = [
      ...HTML.matchAll(
        /<div[^>]*class="modal-bg[^"]*"[^>]*id="([^"]+)"|<div[^>]*id="([^"]+)"[^>]*class="modal-bg[^"]*"/g
      )
    ].map((m) => m[1] || m[2]);
    assert.ok(ids.length >= 30, `expected to find the dialogs, found ${ids.length}`);
    const stumm = ids.filter((id) => !new RegExp('[\'"`#]' + id + '[\'"`]').test(APP));
    assert.deepEqual(stumm, [], `in the markup, but app.js never names them: ${stumm.join(', ')}`);
  });

  it('leave the move and remove of a stock check as they were', () => {
    for (const name of ['locMoveTo', 'locRemoveSelected']) {
      const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
      assert.ok(m, name + '() not found');
      assert.match(m[1], /selectedLocBags\.clear\(\);/);
      assert.doesNotMatch(m[1], /m-locmove/);
    }
  });
});
