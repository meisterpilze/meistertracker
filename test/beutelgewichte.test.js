'use strict';
// Drei Beutelgrößen, eine Vorgabe.
//
// Produziert werden 3,5 / 3,8 / 4,3 / 5 kg, und 3,8 ist die, die läuft: die
// Blöcke sind am 28.08.2026 von 4,3 auf 3,8 kg heruntergegangen. Die App
// kannte davon keine: das lange Formular bot 3 und 5 an und startete auf 3, der
// Assistent bot 0,7 / 1 / 2 / 3 / 5 an und startete auf 5, getAvgComp fiel auf 3
// zurück, und die dreizehn Rezepte sagten 5. Vier Vorgaben für dieselbe Frage.
//
// Der zweite Grund für diesen Test steht in setBagWeight: welche Gewichte es
// gibt, stand dort zweimal als Liste von Knopf-Kennungen und ein drittes Mal als
// `kg === 3 || kg === 5`, und die Zahl wurde aus der Beschriftung gelesen. Bei
// "3,5 kg" liest parseFloat eine 3 — der Knopf hätte sich richtig gefärbt und
// das falsche Gewicht gebucht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');

const SRC = quelle();
const HTML = quelle('index.html');

const ANGEBOTEN = [3.5, 3.8, 4.3, 5];
const VORGABE = 3.8;

// Die Knopfreihe des langen Formulars, so wie sie im HTML steht.
function knopfReihe() {
  const m = HTML.match(/id="nb-weight-btns"[\s\S]*?<\/div>/);
  assert.ok(m, 'nb-weight-btns nicht in index.html gefunden — der Test muss mitgeführt werden');
  // Der ganze Knopf, nicht ab data-kg: class steht davor, und btn-p ist es, was
  // die Vorauswahl ausmacht.
  return [...m[0].matchAll(/<button\b[^>]*\bdata-kg="([\d.]+)"[^>]*>([^<]*)</g)].map((x) => ({
    kg: parseFloat(x[1]),
    label: x[2].trim(),
    aktiv: /class="[^"]*\bbtn-p\b/.test(x[0])
  }));
}

// setBagWeight gegen Attrappen laufen lassen, mit den echten Gewichten aus dem
// HTML als Knöpfe.
function gewichtSetzen(kg) {
  const knoepfe = knopfReihe().map((k) => ({ dataset: { kg: String(k.kg) }, className: '', _id: k.kg }));
  const other = { className: '' };
  const field = { value: '', style: {} };
  const doc = {
    getElementById: (id) => (id === 'nb-weight' ? field : id === 'wbtn-other' ? other : null),
    querySelectorAll: () => knoepfe
  };
  new Function(
    'document',
    'nbPreview',
    hebeFunktion('nbWeightButtons', SRC) + '\n' + hebeFunktion('setBagWeight', SRC) + '\nsetBagWeight(' + kg + ');'
  )(doc, () => {});
  return {
    feld: field.value,
    sichtbar: field.style.display !== 'none',
    aktiv: knoepfe.filter((b) => /btn-p/.test(b.className)).map((b) => b._id),
    anderes: /btn-p/.test(other.className)
  };
}

describe('Beutelgewichte', () => {
  it('bietet im langen Formular genau 3,5 · 3,8 · 4,3 · 5 an', () => {
    assert.deepEqual(
      knopfReihe().map((k) => k.kg),
      ANGEBOTEN
    );
  });

  it('hat 3,8 vorausgewählt', () => {
    const aktiv = knopfReihe().filter((k) => k.aktiv);
    assert.equal(aktiv.length, 1, 'genau ein Knopf trägt btn-p');
    assert.equal(aktiv[0].kg, VORGABE);
    assert.match(HTML, /id="nb-weight"[\s\S]{0,200}?value="3\.8"/, 'das Feld dahinter steht auf einem anderen Wert');
  });

  it('schreibt die Zahl an den Knopf, nicht nur in die Beschriftung', () => {
    // Der eigentliche Punkt: parseFloat('3,5 kg') ist 3. Solange data-kg die
    // Quelle ist, darf die Beschriftung ein Komma tragen.
    const dreifuenf = knopfReihe().find((k) => k.kg === 3.5);
    assert.equal(dreifuenf.label, '3,5 kg', 'die Beschriftung ist für Menschen, data-kg für die App');
    assert.doesNotMatch(
      hebeFunktion('setBagWeight', SRC),
      /textContent/,
      'setBagWeight liest wieder die Beschriftung — bei "3,5 kg" kommt 3 heraus'
    );
  });

  it('färbt den passenden Knopf und versteckt das Feld', () => {
    for (const kg of ANGEBOTEN) {
      const r = gewichtSetzen(kg);
      assert.deepEqual(r.aktiv, [kg], kg + ' kg färbt den falschen Knopf');
      assert.equal(r.sichtbar, false, kg + ' kg ist ein Knopf, das Feld gehört weg');
      assert.equal(r.anderes, false);
    }
  });

  it('zeigt das Feld für alles andere', () => {
    const r = gewichtSetzen(2);
    assert.deepEqual(r.aktiv, [], 'kein Knopf steht für 2 kg');
    assert.equal(r.sichtbar, true, 'ohne sichtbares Feld sähe niemand, was gebucht wird');
    assert.equal(r.anderes, true, '"anderes" bleibt der Weg für ein Gewicht ohne Knopf');
    assert.equal(r.feld, 2);
  });

  it('bietet im Assistenten dieselben vier an', () => {
    // Zwei Bildschirme mit verschiedenen Gewichten sind zwei Wahrheiten darüber,
    // was produziert wird.
    const m = SRC.match(/\[3\.5, 3\.8, 4\.3, 5\]\s*\r?\n\s*\.map\(\(k\) =>[\s\S]*?data-wkb="kg"/);
    assert.ok(m, 'die Gewichtsreihe des Assistenten weicht von 3,5 · 3,8 · 4,3 · 5 ab');
  });

  it('hat eine Vorgabe, nicht vier', () => {
    assert.match(SRC, new RegExp('^const NB_BAG_KG_DEFAULT = ' + VORGABE + ';$', 'm'));
    assert.match(hebeKonstante('WKB', SRC), /bagKg: NB_BAG_KG_DEFAULT/, 'der Assistent startet auf einer eigenen Zahl');
    assert.match(
      hebeFunktion('getAvgComp', SRC),
      /'bagKg', NB_BAG_KG_DEFAULT\)/,
      'die Lagerschätzung fällt auf eine eigene Zahl zurück'
    );
  });

  it('lässt ein gespeichertes Altgewicht die neue Vorgabe nicht überstimmen', () => {
    // Ein Gerät, das die App schon kennt, trägt in mp-nb-defaults noch die 3
    // oder die 5 von damals. Das ist keine Wahl, sondern ein Erbe, und es stünde
    // sonst auf jedem eingerichteten Handy statt der 3,8.
    const f = hebeFunktion('nbApplyDefaults', SRC);
    assert.match(f, /d\.wv !== NB_DEFAULTS_WEIGHT_V/, 'das Altgewicht wird nicht verworfen');
    assert.match(f, /weight: _avg\.bagKg/, 'ohne Vorrat fiele das Feld auf das HTML zurück statt auf den Schnitt');
    assert.match(hebeFunktion('nbSaveDefaults', SRC), /wv: NB_DEFAULTS_WEIGHT_V/, 'gespeichert wird ohne Stempel');
  });
});
