'use strict';
// The scan modal's "Recent successes" tab.
//
// Two things were wrong on a phone. The empty state ("No successful scans yet
// in this session.") stood above the list once there were rows: it comes before
// the list in the markup, and the CSS rule meant to hide it used a sibling
// selector, which only looks forward, so it never matched. And the bag number
// was cut to "PI-26…" in every row, because on one line it got what the time,
// the action and the undo button left over, about 56px. The end of the number
// is what tells two bags of a batch apart, so the rows could not be told apart.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { hebeFunktion } = require('./helpers/quelle');

const RENDER = hebeFunktion('renderScanSuccesses');

// Just the three elements the function asks for. Invented bag numbers.
function zeichnen(eintraege) {
  const el = {
    'scan-successes-list': {
      innerHTML: '',
      rows: [],
      appendChild(r) {
        this.rows.push(r);
      }
    },
    'scan-tab-succ-count': { textContent: '' },
    'scan-successes-empty': { hidden: false }
  };
  const document = {
    getElementById: (id) => el[id] || null,
    createElement: () => ({ className: '', innerHTML: '', setAttribute() {} })
  };
  new Function('document', 'sessionEntries', 'esc', RENDER + '\nrenderScanSuccesses();')(document, eintraege, (s) =>
    String(s)
  );
  return { liste: el['scan-successes-list'], zahl: el['scan-tab-succ-count'], leer: el['scan-successes-empty'] };
}

const ZUG = (bag) => ({
  action: 'MOVE',
  batch: 'XX-260101-01',
  bag,
  from: 'INC_R1',
  to: 'TENT1',
  time: '2026-01-01T10:00:00'
});

describe('Recent successes — the empty state', () => {
  it('shows while there is nothing to list', () => {
    const z = zeichnen([]);
    assert.equal(z.leer.hidden, false);
    assert.equal(z.zahl.textContent, '0');
    assert.equal(z.liste.rows.length, 0);
  });

  it('hides as soon as there is a row', () => {
    const z = zeichnen([ZUG('XX-260101-01-01'), ZUG('XX-260101-01-02'), ZUG('XX-260101-01-03')]);
    assert.equal(z.leer.hidden, true);
    assert.equal(z.zahl.textContent, '3');
    assert.equal(z.liste.rows.length, 3);
  });

  it('comes back when the last row is undone', () => {
    assert.equal(zeichnen([ZUG('XX-260101-01-01')]).leer.hidden, true);
    assert.equal(zeichnen([]).leer.hidden, false);
  });

  it('counts only successes: an entry without an action keeps it visible', () => {
    assert.equal(zeichnen([{ bag: 'XX-260101-01-01' }]).leer.hidden, false);
  });

  it('writes the whole bag number into the row; how much of it shows is the stylesheet', () => {
    const z = zeichnen([ZUG('XX-260101-01-07')]);
    assert.match(z.liste.rows[0].innerHTML, /<b>XX-260101-01-07<\/b>/);
  });
});

describe('Recent successes — on a phone', () => {
  const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  it('no longer pretends CSS hides the empty state', () => {
    assert.doesNotMatch(CSS, /\.scan-successes-list:not\(:empty\)\s*[~+]\s*\.scan-successes-empty/);
  });

  it('asks the list how wide it is, not the window', () => {
    const liste = CSS.match(/\n\.scan-successes-list \{([\s\S]*?)\n\}/);
    assert.ok(liste, '.scan-successes-list not found in styles.css');
    assert.match(liste[1], /container-type: inline-size;/);
    assert.match(liste[1], /container-name: erfolge;/);
  });

  it('gives the bag number a line of its own in a narrow list, instead of an ellipsis', () => {
    const block = CSS.match(/@container erfolge \(max-width: [\d.]+rem\) \{[\s\S]*?\n\}/);
    assert.ok(block, 'the narrow-list layout is gone');
    const body = block[0].match(/\.scan-success-body \{([\s\S]*?)\n {2}\}/);
    assert.ok(body, '.scan-success-body has no narrow rule');
    assert.match(body[1], /grid-row: 2;/);
    assert.match(body[1], /white-space: normal;/);
  });
});
