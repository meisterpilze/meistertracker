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

// Every `<tr…>…</tr>` template in app.js that carries at least one data-mlabel,
// found by content so that renaming or moving a renderer costs nothing here.
//
// The opening tag is allowed attributes and the body is allowed newlines. Both
// were bare when this was written, and both cost coverage the moment they were
// not: a `<tr>` that gained a data-find hook, a conditional style for a
// highlighted row, or a template broken over two lines simply stopped being a
// row template as far as this file was concerned. Three of the eleven were
// visible under the strict pattern, and the guard below is what said so.
//
// The body may not cross another `<tr`. Allowing it to was how widening the
// opening tag paid for itself in the wrong currency: prose in this file talks
// about rows, and the sentence "writing textContent onto the <tr>" in app.js
// is an opening tag as far as a regex is concerned. It anchored a match that
// ran 630 lines to the next `</tr>` and consumed every template in between —
// a stretch of app.js that happens to hold no labelled row today, and would
// have swallowed one silently on the day somebody wrote one there.
const ROW_RE = /<tr(?:\s[^>]*)?>((?:(?!<tr[\s>])[\s\S])*?)<\/tr>/g;
const ROW_MATCHES = [...APP.matchAll(ROW_RE)];
const ROW_TEMPLATES = ROW_MATCHES.map((m) => m[1]).filter((row) => row.includes('data-mlabel'));

// A cell may go unlabelled for exactly two reasons, both of which the layout
// handles on purpose.
const MAY_BE_UNLABELLED = /class="[^"]*(?:-actions|\bempty)\b/;

describe('the cards a table becomes on a phone', () => {
  it('finds the row templates — a silent zero would make this file vacuous', () => {
    assert.ok(ROW_TEMPLATES.length >= 10, `expected at least 10 labelled row templates, found ${ROW_TEMPLATES.length}`);
  });

  // The floor above only says the pattern found enough rows. It cannot say that
  // each one is a row: a match that runs from a `<tr` in a comment to a `</tr>`
  // hundreds of lines later still counts as one, and everything it swallows
  // stops being checked. The longest real template here is under 2000
  // characters, so a match several times that is not a row template, whatever
  // the count says.
  it('matches rows, not stretches of file between two of them', () => {
    const tooLong = ROW_MATCHES.filter((m) => m[0].length > 4000).map(
      (m) => `${m[0].length} chars at index ${m.index}`
    );
    assert.deepEqual(tooLong, [], 'a <tr…</tr> match spans far more than a row — it is hiding the templates inside it');
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
    assert.deepEqual(marked, [
      't-batches',
      't-catalog',
      't-cultures',
      't-customers',
      't-demand',
      't-grain',
      't-harvest',
      't-harvestrelease',
      't-log',
      't-orders',
      't-pickups',
      't-rawstock'
    ]);
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
    assert.match(
      CSS,
      /\.t-cards > tbody > tr > td\[data-mlabel\]:not\(:first-child\)::before/,
      'the label rule is gone'
    );
    assert.match(
      CSS,
      /\.t-cards > tbody > tr > td:not\(\[data-mlabel\]\):not\(:first-child\):not\(\.empty\)/,
      'the actions rule no longer keys on the missing label — the two structural facts are what replaced ' +
        'four id-scoped blocks'
    );
  });

  // The label used to be the first item of a flex cell, which reads correctly
  // and quietly made every element child a flex item too. #t-batches' Substrat
  // cell holds three .sub-tag chips; they became three competing items on one
  // nowrap line and each shrank until its text wrapped inside a 99px pill.
  //
  // Neither census could see it. The source scan reads app.js and index.html,
  // where the chips are a template; measure-mobile.js serves the page with the
  // scripts stripped, so the cell is empty when it measures. It took rendering
  // the table with rows in it.
  //
  // So this asserts the shape that cannot come back: the value side of a
  // labelled cell is normal flow, and the label is out of it.
  it('lays a labelled cell out as a gutter and normal flow, not as flex items', () => {
    const cell = CSS.match(/\n {2}\.t-cards > tbody > tr > td \{([\s\S]*?)\n {2}\}/);
    assert.ok(cell, 'the base card-cell rule moved — this test needs updating with it');
    assert.match(
      cell[1],
      /display:\s*block;/,
      'the cell is a flex container again, so a cell holding more than one element lays its children out as competing flex items'
    );
    const label = CSS.match(
      /\.t-cards > tbody > tr > td\[data-mlabel\]:not\(:first-child\)::before \{([\s\S]*?)\n {2}\}/
    );
    assert.match(
      label[1],
      /position:\s*absolute;/,
      'the label is back in flow, which puts it in the same formatting context as the value'
    );
  });

  // The other half: a pill is a box. Left inline it splits its background and
  // its radius across two line boxes the moment it wraps, and in a 132px-wide
  // card cell it wraps. Scoped to .t-cards on purpose — the same keyword on the
  // base rule takes the desktop #t-batches from 760px to 1093px tall, because
  // that table's Substrat column is ~63px wide.
  it('makes the substrate chips boxes on the card and leaves the desktop table alone', () => {
    assert.match(CSS, /\.t-cards \.sub-tag \{\s*display: inline-block;/, 'the card-scoped chip rule is gone');
    const base = CSS.match(/\n\.sub-tag \{([\s\S]*?)\n\}/);
    assert.ok(base, 'the base .sub-tag rule moved — this test needs updating with it');
    assert.doesNotMatch(
      base[1],
      /display:/,
      'the base rule sets a display again — that is a desktop layout change (#t-batches 760px → 1093px), ' +
        'not a phone fix'
    );
  });
});
