'use strict';
// Was die Knöpfe der Tagesliste mitgeben — und ob der Empfänger es lesen kann.
//
// Beide Knöpfe, die dieser Umbau neu gebaut hat, waren zu hundert Prozent tot.
// _planBtn() schrieb den ANZEIGENAMEN der Sorte in data-sorte, der Handler löst
// ihn mit _strainByKey() auf, und das trifft nur 'id:3' oder 'n:shiitake'. Jeder
// Druck endete in "Diese Sorte steht nicht in den Pilzsorten" — über einer
// Sorte, die dort stehen MUSS, sonst hätte buildSupplyTasks() die Zeile gar
// nicht erst gebaut.
//
// Gesehen hat das kein Test, weil keiner _planBtn je aufgerufen hat. Dieser
// prüft darum nicht die Zeichenkette, sondern den Rundlauf: was der Knopf
// schreibt, muss der Auflöser wiederfinden. Eine Hälfte allein zu prüfen ist
// genau die Lücke, durch die es gefallen ist.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf, hebeKonstante: _hk } = require('./helpers/quelle');

const SRC = quelle();
const hebeFunktion = (n) => _hf(n, SRC);
const hebeKonstante = (n) => _hk(n, SRC);

const SORTEN = [
  { id: 3, name: 'Shiitake', kuerzel: 'SH', description: '' },
  { id: 7, name: 'Blue Oyster', kuerzel: 'BO', description: '' }
];

// Baut den Knopf und löst das data-sorte wieder auf, wie der Handler es tut.
function rundlauf(it, sorten = SORTEN) {
  const code = [
    hebeFunktion('_spKey'),
    hebeFunktion('_strainKeys'),
    hebeFunktion('_strainByKey'),
    hebeFunktion('sorteKey'),
    hebeFunktion('_planBtn')
  ].join('\n');
  return new Function(
    'mushroomStrains',
    'it',
    `
    const esc = (x) => String(x == null ? '' : x).replace(/"/g, '&quot;');
    const t = (k) => k;
    const getLabLabel = (x) => 'label:' + x;
    const dashTaskBtn = () => '';
    ${code}
    const html = _planBtn(it);
    const m = /data-sorte="([^"]*)"/.exec(html);
    const aktion = /data-action="([^"]*)"/.exec(html);
    return { html, sorte: m && m[1], aktion: aktion && aktion[1], ms: m ? _strainByKey(m[1]) : null };
  `
  )(sorten, it);
}

// Wie buildSupplyTasks()/buildLabMinTasks() ihre Zeilen wirklich schreiben:
// species ist der Anzeigename, task.key der Schlüssel.
const versorgung = (name, key, taskAction) => ({
  kind: 'supply',
  species: name,
  task: { key, name, taskAction }
});
const laborMin = (name, key, type) => ({ kind: 'labmin', species: name, task: { key, name, type } });

describe('Die Knöpfe der Tagesliste', () => {
  it('gibt der Nachschub-Zeile einen Schlüssel mit, den der Handler auflöst', () => {
    const r = rundlauf(versorgung('Shiitake', 'id:3', 'make-grain'));
    assert.ok(r.ms, 'der Handler findet die Sorte nicht — genau hier war der Knopf tot');
    assert.equal(r.ms.id, 3);
  });

  it('tut dasselbe für eine Labor-Untergrenze', () => {
    const r = rundlauf(laborMin('Blue Oyster', 'id:7', 'MC'));
    assert.ok(r.ms, 'der Handler findet die Sorte nicht');
    assert.equal(r.ms.id, 7);
  });

  it('funktioniert auch für eine Sorte ohne strainId, über den Namensschlüssel', () => {
    // Chargen von vor der strain_id-Nachtragung tragen keinen Verweis; sorteKey()
    // fällt dann auf 'n:' + bereinigter Name zurück, und der muss genauso treffen.
    const r = rundlauf(versorgung('Shiitake', 'n:shiitake', 'make-blocks'));
    assert.ok(r.ms, 'der Namensschlüssel muss genauso auflösbar sein wie die Id');
    assert.equal(r.ms.id, 3);
  });

  it('schreibt niemals den Anzeigenamen ins Attribut', () => {
    // Der eigentliche Fehler, in einem Satz. "Shiitake" steht in keinem der
    // beiden Schlüsselräume, also lief _strainByKey() jedes Mal auf null.
    for (const it of [versorgung('Shiitake', 'id:3', 'make-grain'), laborMin('Shiitake', 'id:3', 'LC')]) {
      const r = rundlauf(it);
      assert.notEqual(r.sorte, 'Shiitake', 'data-sorte trägt einen Schlüssel, keinen Namen');
      assert.match(r.sorte, /^(id:|n:)/, 'und Schlüssel sind an ihrem Präfix zu erkennen');
    }
  });

  it('unterscheidet "Körner ansetzen" von "Charge ansetzen"', () => {
    // Körner zuerst, wenn keine da sind: aus nichts lassen sich keine Blöcke
    // machen. Die beiden Fälle dürfen nicht auf denselben Knopf fallen.
    assert.equal(rundlauf(versorgung('Shiitake', 'id:3', 'make-grain')).aktion, 'supply-make-grain');
    assert.equal(rundlauf(versorgung('Shiitake', 'id:3', 'make-blocks')).aktion, 'supply-make-batch');
  });

  it('gibt dem Labor-Knopf den Typ mit, der knapp ist', () => {
    assert.match(rundlauf(laborMin('Shiitake', 'id:3', 'PD')).html, /data-labtype="PD"/);
  });

  it('bleibt leer statt zu raten, wenn die Zeile keinen Schlüssel trägt', () => {
    // Ohne Schlüssel ist ein leeres Attribut ehrlicher als der Name: der Handler
    // sagt dann "Sorte nicht gefunden", und das stimmt dann auch.
    const r = rundlauf({ kind: 'supply', species: 'Shiitake', task: { taskAction: 'make-grain' } });
    assert.equal(r.sorte, '');
    assert.equal(r.ms, null);
  });
});

// Körnerbrut wird gewogen. Die Karte hat sie gezählt und das Ergebnis als
// Kilogramm beschriftet — 20 Gläser zu 3 kg standen als "20,0 kg" über Zeilen,
// die zusammen 60 ergaben, und renderThresholds() maß Gläser gegen eine
// Kilogramm-Schwelle.
describe('Der Bestand an Körnerbrut', () => {
  function bestand(chargen, kulturen = []) {
    const code = [
      hebeKonstante('ARCHIVED_STATUSES'),
      hebeFunktion('_grainKgOf'),
      hebeFunktion('getLabStockCounts')
    ].join('\n');
    return new Function(
      'batches',
      'cultures',
      `
      const getStatus = (id) => ({ status: (batches.find((b) => b.batchId === id) || {})._status || 'EMPTY' });
      const isArchivedStatus = (s) => ARCHIVED_STATUSES.includes(s);
      const ZONE_BY_ID = { CONTAM: { role: 'contaminated' }, SPAWN: { role: 'spawn' } };
      const toZone = (x) => x;
      const placementByBag = () => new Map(batches.flatMap((b) => b._platz || []).map((e) => [e.bag.toUpperCase(), e]));
      ${code}
      return getLabStockCounts();
    `
    )(chargen, kulturen);
  }
  // Zwanzig Glaeser zu 3 kg. `verbraucht` gibt so vielen ein REMOVE, wie
  // nbConsumeSpawnBags() es schreibt.
  const koerner = ({ verbraucht = 0, ...extra } = {}) => {
    const bags = Array.from({ length: 20 }, (_, i) => 'SH-G1-' + (i + 1));
    return {
      batchId: 'SH-G1',
      batchType: 'grain',
      qty: 20,
      bagKg: 3,
      bags,
      bagWeights: Object.fromEntries(bags.map((b) => [b, 3])),
      _platz: bags.map((b, i) => ({
        bag: b,
        action: i < verbraucht ? 'REMOVE' : 'ADD',
        to: i < verbraucht ? null : 'SPAWN'
      })),
      ...extra
    };
  };

  it('rechnet in Kilogramm, nicht in Gläsern', () => {
    assert.equal(bestand([koerner()]).GS, 60, '20 Gläser zu 3 kg sind 60 kg, nicht 20');
  });

  it('zählt frisch angesetzte Brut mit, die noch keinen Scan hat', () => {
    // createGrainBatch schreibt keine Scan-Einträge. Ein Glas ohne Eintrag ist
    // heute angesetzt und noch nirgends hingestellt — es steht da.
    assert.equal(bestand([koerner({ _platz: [] })]).GS, 60);
  });

  it('lässt verbrauchte Gläser heraus', () => {
    assert.equal(bestand([koerner({ verbraucht: 20 })]).GS, 0);
  });

  it('zählt den Rest, wenn erst ein Teil verbraucht ist', () => {
    // Der Fehler, den das hier festhält: die ganze Charge zählte voll, bis das
    // letzte Glas ging.
    assert.equal(bestand([koerner({ verbraucht: 15 })]).GS, 15, 'fünf Gläser zu 3 kg');
  });

  it('zählt Kulturen weiterhin in Stück', () => {
    const c = bestand(
      [],
      [
        { type: 'MC', status: 'active' },
        { type: 'MC', status: 'active' }
      ]
    );
    assert.equal(c.MC, 2);
  });
});

// Eine Versorgungslücke und eine gerissene Labor-Untergrenze tragen keine Zone.
// Die Wegreihenfolge hatte damit nichts, wonach sie sie einsortieren konnte, und
// schob sie ans Ende — hinter eine Klappe, die zu ist, an genau den vollen Tagen,
// an denen sie zählen. Sie sind keine Stationen des Rundgangs, sondern das, was
// davor anzufangen ist.
describe('Wo die abgeleiteten Zeilen im Tag stehen', () => {
  it('sortiert sie vor die Zonen, nicht hinter alles', () => {
    const src = SRC.slice(SRC.indexOf('function _weekDayBodyHtml'));
    const rank = src.slice(src.indexOf('const rank ='), src.indexOf('const openKey'));
    assert.match(rank, /kind === 'supply' \|\| it\.kind === 'labmin'/, 'die beiden Arten müssen benannt sein');
    assert.match(rank, /\?\s*-1/, 'und vor jede Zone sortieren, sonst schneidet DASH_DAY_CAP sie weg');
  });
});
