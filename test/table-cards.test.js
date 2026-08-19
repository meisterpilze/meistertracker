'use strict';
// The contract between a renderer and the card layout.
//
// Below 769px `.t-cards` turns a table row into a card, and it decides what a
// cell *is* from two structural facts rather than from a class per table: the
// first cell is the card's header, and the cell with no `data-mlabel` is the
// actions row, because a row of buttons has nothing to label.
//
// That second rule is the one with a silent failure mode. A renderer that
// forgets a data-mlabel on a data cell does not lose a label — the cell
// becomes an actions row: full width, a rule above it, pushed to the bottom of
// the card as though it were the buttons. Nothing throws, the desktop table is
// unaffected, and it is only wrong on a phone.
//
// So this reads the row templates out of app.js and checks every <td> in them.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

// Every `<tr>…</tr>` template in app.js that carries at least one data-mlabel,
// found by content so that renaming or moving a renderer costs nothing here.
const ROW_TEMPLATES = [...APP.matchAll(/<tr>((?:(?!<\/tr>).)*)<\/tr>/g)]
  .map((m) => m[1])
  .filter((row) => row.includes('data-mlabel'));

// A cell may go unlabelled for exactly two reasons, both of which the layout
// handles on purpose.
const MAY_BE_UNLABELLED = /class="[^"]*(?:-actions|\bempty)\b/;

describe('the cards a table becomes on a phone', () => {
  it('finds the row templates — a silent zero would make this file vacuous', () => {
    assert.ok(ROW_TEMPLATES.length >= 4, `expected at least 4 labelled row templates, found ${ROW_TEMPLATES.length}`);
  });

  it('labels every data cell, or says why not', () => {
    const unlabelled = [];
    for (const row of ROW_TEMPLATES) {
      // Split on the tag itself so each piece is one cell's attributes.
      for (const cell of row.split('<td').slice(1)) {
        const attrs = cell.slice(0, cell.indexOf('>'));
        if (attrs.includes('data-mlabel') || MAY_BE_UNLABELLED.test(attrs)) continue;
        unlabelled.push(attrs.trim().slice(0, 70) || '(no attributes)');
      }
    }
    assert.deepEqual(
      unlabelled,
      [],
      `${unlabelled.length} cell(s) carry neither a data-mlabel nor an actions/empty class, so on a phone ` +
        `they render as the card's button row: ${unlabelled.join(' | ')}`
    );
  });

  // The roster is written down rather than derived, and deliberately: adding
  // .t-cards to a table whose renderer emits no data-mlabel produces a stack
  // of unlabelled values — strictly worse than the scrolling table it
  // replaced. Landing a sixth means editing this line, which is where the
  // reason is.
  it('is applied only to tables whose rows carry labels', () => {
    const marked = [...HTML.matchAll(/<table id="([^"]+)" class="t-cards">/g)].map((m) => m[1]).sort();
    assert.deepEqual(marked, ['t-batches', 't-cultures', 't-grain', 't-harvest', 't-log']);
  });

  // #t-grain is the reason this became one mechanism instead of a fifth copy.
  it('covers the table that was missed for having no block of its own', () => {
    assert.match(
      HTML,
      /<table id="t-grain" class="t-cards">/,
      '#t-grain is filled by batchRowHtml(), the same function that fills #t-batches, so every one of its ' +
        'cells already carries a data-mlabel — it scrolled sideways only because nobody wrote it an id block'
    );
  });

  it('keeps the mechanism and its markup in step', () => {
    assert.match(CSS, /\.t-cards > tbody > tr > td\[data-mlabel\]::before/, 'the label rule is gone');
    assert.match(
      CSS,
      /\.t-cards > tbody > tr > td:not\(\[data-mlabel\]\):not\(:first-child\):not\(\.empty\)/,
      'the actions rule no longer keys on the missing label — the two structural facts are what replaced ' +
        'four id-scoped blocks'
    );
  });
});
