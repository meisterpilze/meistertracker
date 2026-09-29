'use strict';
// Die Haken am Tagesplan der Vorhaben-Seite.
//
// Ein Haken gehoert zu einem Schritt. Frueher hing er an der Zeilennummer:
// nach einem Neuimport, der oben eine Zeile einfuegte, stand er beim naechsten
// Schritt, und weil erledigte Zeilen ausgeblendet werden, verschwand ein Schritt,
// der noch offen war. Das Zuruecksetzen eines Plans "tag" nahm ausserdem die
// Haken eines Plans "tag-2" mit.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hebeFunktion } = require('./helpers/quelle');

const TEILE = [
  'esc',
  'pjText',
  'pjChkLoad',
  'pjChkSave',
  'pjChkSchluessel',
  'pjChkAlt',
  'pjPlan',
  'pjPlanRefresh',
  'pjClick'
];

// Die Funktionen gegen einen Speicher, der wirklich speichert.
function laden(anfang) {
  return new Function(
    'anfang',
    `
    const PJ_CHK = 'mp_vorhaben_chk';
    const speicher = { [PJ_CHK]: JSON.stringify(anfang || {}) };
    const localStorage = {
      getItem: (k) => (k in speicher ? speicher[k] : null),
      setItem: (k, v) => {
        speicher[k] = String(v);
      }
    };
    const t = (k) => k;
    const pjVersuchClick = () => false;
    const pjNotizClick = () => false;
    ${TEILE.map((n) => hebeFunktion(n)).join('\n')}
    return { pjPlan, pjClick, stand: () => JSON.parse(speicher[PJ_CHK]) };`
  )(anfang);
}

// Die Zeilen eines gezeichneten Plans: Schluessel, Wortlaut, erledigt.
function zeilen(html) {
  const re =
    /<div class="pj-chk( is-done)?"><input type="checkbox" id="[^"]*" data-pj-chk="([^"]*)"[\s\S]*?<label for="[^"]*">([\s\S]*?)<\/label>/g;
  return [...html.matchAll(re)].map((m) => ({ fertig: !!m[1], schluessel: m[2], text: m[3] }));
}

// Ein Tipp auf einen Kasten, so wie pjClick ihn bekommt.
function haken(ui, schluessel, an) {
  const kasten = { checked: an, dataset: { pjChk: schluessel }, closest: () => null };
  ui.pjClick({ target: { closest: (sel) => (sel === '[data-pj-chk]' ? kasten : null) } });
}
function zuruecksetzen(ui, plan) {
  const feld = {
    dataset: { pjPlan: plan },
    classList: { remove() {}, toggle() {}, contains: () => false },
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const knopf = { closest: (sel) => (sel === '.pj-plan' ? feld : null) };
  ui.pjClick({ target: { closest: (sel) => (sel === '[data-pj-reset]' ? knopf : null) } });
}

const PLAN = {
  key: 'tag',
  items: [
    ['Bank', 'Schritt A'],
    ['Autoklav', 'Schritt B']
  ]
};

describe('Haken am Tagesplan', () => {
  it('bleibt nach einem Neuimport beim selben Schritt', () => {
    const ui = laden();
    const a = zeilen(ui.pjPlan(PLAN)).find((z) => z.text === 'Schritt A');
    haken(ui, a.schluessel, true);
    const neu = { key: 'tag', items: [['Einkauf', 'Neuer Schritt'], ...PLAN.items] };
    const danach = zeilen(ui.pjPlan(neu));
    assert.deepEqual(
      danach.map((z) => [z.text, z.fertig]),
      [
        ['Neuer Schritt', false],
        ['Schritt A', true],
        ['Schritt B', false]
      ]
    );
  });

  it('setzt nur den eigenen Plan zurueck', () => {
    const ui = laden();
    const tag = zeilen(ui.pjPlan(PLAN));
    const tag2 = zeilen(ui.pjPlan({ key: 'tag-2', items: PLAN.items }));
    haken(ui, tag[0].schluessel, true);
    haken(ui, tag2[0].schluessel, true);
    zuruecksetzen(ui, 'tag');
    assert.equal(zeilen(ui.pjPlan(PLAN))[0].fertig, false);
    assert.equal(zeilen(ui.pjPlan({ key: 'tag-2', items: PLAN.items }))[0].fertig, true, 'tag-2 keeps its tick');
  });

  it('nimmt Haken nach alter Zeilennummer einmal mit', () => {
    const ui = laden({ 'tag-1': 1, 'tag-2-0': 1 });
    const z = zeilen(ui.pjPlan(PLAN));
    assert.deepEqual(
      z.map((x) => x.fertig),
      [false, true]
    );
    const stand = ui.stand();
    assert.equal('tag-1' in stand, false, 'the old key is gone');
    assert.equal(stand['tag-2-0'], 1, 'another plan’s old tick is left for that plan');
    assert.equal(stand[z[1].schluessel], 1);
  });

  it('raeumt alte Haken fuer Zeilen weg, die es nicht mehr gibt', () => {
    // Ein Haken fuer Zeile 2 aus einem Plan mit drei Zeilen; der Plan hat jetzt
    // zwei. Bliebe er liegen, hakte er spaeter eine neue dritte Zeile ab.
    const ui = laden({ 'tag-2': 1, 'tag-2-0': 1 });
    ui.pjPlan(PLAN);
    const stand = ui.stand();
    assert.equal('tag-2' in stand, false);
    assert.equal(stand['tag-2-0'], 1, 'plan tag-2 is another plan');
    const drei = { key: 'tag', items: [...PLAN.items, ['Bank', 'Neu dazu']] };
    assert.equal(zeilen(ui.pjPlan(drei))[2].fertig, false);
  });

  it('unterscheidet zwei gleichlautende Zeilen', () => {
    const ui = laden();
    const z = zeilen(
      ui.pjPlan({
        key: 'tag',
        items: [
          ['Bank', 'Spuelen'],
          ['Bank', 'Spuelen']
        ]
      })
    );
    assert.notEqual(z[0].schluessel, z[1].schluessel);
  });
});
