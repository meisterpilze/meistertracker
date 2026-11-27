'use strict';
// Substrat ansetzen: one way.
//
// Substrate could be mixed in two places. The tile "Substrat" on the start page
// opens a guided flow (wkmOpen). And Chargen › Substrat-Ansätze carried a whole
// form for the same thing: its own fields for the recipe, the bags, every share
// of the mix, the pH, its own preview and its own "save as a mix". Every change
// to mixing had to be made twice, and the two did not always behave alike.
//
// The form is gone. The tab keeps a button that opens the same flow as the
// tile, the list of Ansätze, and the two things only that card held: the saved
// mixes and how wet pellets and bran arrive.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const von = HTML.indexOf('<div class="sp" id="sp-batch-substrate">');
const TAB = HTML.slice(von, HTML.indexOf('<div class="sp" id="sp-batch-new"', von));

describe('Substrat ansetzen: one way', () => {
  it('opens the guided flow from the tab, the same one as the tile', () => {
    assert.match(TAB, /<button type="button" class="btn btn-p" id="btn-sub-new" data-i18n="sub\.newBtn">/);
    assert.ok(APP.includes("$('btn-sub-new').addEventListener('click', wkmOpen);"), 'the button is not wired');
    assert.match(APP, /\['wk-t-sub', wkmOpen\]/, 'the tile opens something else');
  });

  it('has no second form on the tab', () => {
    for (const id of [
      'sb-recipe',
      'sb-bags',
      'sb-hw',
      'sb-wb',
      'sb-soy',
      'sb-gyp',
      'sb-ca',
      'sb-hyd',
      'sb-rh',
      'sb-ph',
      'sb-steri',
      'sb-notes',
      'sb-go',
      'sb-out',
      'sb-mixsave'
    ]) {
      assert.equal(HTML.includes('id="' + id + '"'), false, `#${id} is still in the markup`);
    }
    // What is left asks for a checkbox and three numbers, not for a mix.
    assert.ok((TAB.match(/<(input|select|textarea)\b/g) || []).length <= 4);
  });

  it('has no code left that only the form used', () => {
    for (const name of [
      'createSubstrateBatchUI',
      'sbPreview',
      'sbPreviewSoon',
      'sbBlend',
      'sbBlendEdited',
      'sbSaveMixFromForm',
      'sbRecipeChanged',
      'fillSbRecipeSelect'
    ]) {
      assert.equal(
        new RegExp('(?<![\\w$])' + name + '(?![\\w$])').test(APP),
        false,
        `${name} is still named in app.js`
      );
    }
  });

  it('keeps on the tab what only that card held', () => {
    assert.match(TAB, /<details id="sb-resid"/, 'how wet the bagged goods arrive');
    assert.match(TAB, /onclick="sbSaveResidual\(\)"/);
    assert.match(TAB, /<details id="sb-mixes"[\s\S]*?id="sb-mixes-list"/, 'the saved mixes, where one is renamed');
    assert.match(TAB, /id="sb-tab-list"/, 'the list of Ansätze');
  });

  it('still loads the mixes for the flow and for the list of saved mixes', () => {
    const m = APP.match(/\nasync function loadSubstrateRecipes\(force\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'loadSubstrateRecipes() not found');
    assert.match(m[0], /renderMixRecipes\(\);/);
    assert.match(APP, /async function wkmOpen\(\) \{[\s\S]*?await loadSubstrateRecipes\(true\);/);
  });
});
