'use strict';
// Der offene Versuch bleibt aktuell.
//
// Ein Datenstand von einem anderen Geraet zeichnete den offenen Versuch nicht
// neu. Ein Gefaess, das dort entfernt wurde, stand hier weiter mit
// Eingabefeldern da, was man hineintippte, landete im entfernten, und das x
// daneben tat gar nichts. Nach einem Sprachwechsel blieb der Versuch ausserdem
// in der alten Sprache stehen.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hebeFunktion, hebeKonstante } = require('./helpers/quelle');

function seite(opts = {}) {
  return new Function(
    'opts',
    `
    let currentLang = 'de';
    let pjOffen = 5;
    let experiments = [{ id: 5, runs: [{ id: 1, code: 'A-1' }] }];
    const feldImVersuch = { id: 'pj-res', tagName: 'INPUT' };
    const knopfImVersuch = { tagName: 'BUTTON' };
    const versuch = {
      id: 'pj-versuch',
      innerHTML: '',
      dataset: {},
      contains: (el) => el === feldImVersuch || el === knopfImVersuch
    };
    const document = {
      activeElement: null,
      querySelector: () => versuch,
      getElementById: (id) => (id === 'pj-versuch' ? versuch : null)
    };
    let gezeichnet = 0;
    const pjDetail = () => {
      gezeichnet++;
      return '<div>Versuch</div>';
    };
    const pjListe = () => '<div>Liste</div>';
    const pjExp = (id) => experiments.find((v) => v.id === id) || null;
    let pjVerlaufOffen = null;
    const pjVerlaufLaden = () => {};
    const renderProjekte = () => {};
    const t = (k) => k;
    const toasts = [];
    const toast = (m, k) => toasts.push([m, k]);
    const gepatcht = [];
    const apiPatch = (p, b) => {
      gepatcht.push([p, b]);
      return Promise.resolve({});
    };
    const pjVerlaufNeu = () => {};
    let pjVersuchGezeigt = null;
    const PJ_ANLEGEN_FELDER = [];
    let pjGezeichnetFuer;
    ${['pjVersuchStand', 'pjRefresh', 'renderVersuch', 'pjChange'].map((n) => hebeFunktion(n)).join('\n')}
    return {
      pjRefresh,
      renderVersuch,
      pjChange,
      toasts,
      gepatcht,
      gezeichnet: () => gezeichnet,
      neuerStand: (e) => {
        experiments = e;
      },
      tippen: () => {
        document.activeElement = feldImVersuch;
      },
      verlassen: () => {
        document.activeElement = null;
      },
      knopf: () => {
        document.activeElement = knopfImVersuch;
      },
      sprache: (l) => {
        currentLang = l;
      }
    };`
  )(opts);
}

describe('offener Versuch bei neuem Datenstand', () => {
  it('zeichnet nichts neu, wenn sich an den Versuchen nichts geaendert hat', () => {
    const s = seite();
    s.renderVersuch();
    s.pjRefresh();
    assert.equal(s.gezeichnet(), 1);
  });

  it('zeichnet neu, wenn ein Gefaess anderswo entfernt wurde', () => {
    const s = seite();
    s.renderVersuch();
    s.neuerStand([{ id: 5, runs: [], removedRuns: [{ id: 1, code: 'A-1' }] }]);
    s.pjRefresh();
    assert.equal(s.gezeichnet(), 2);
  });

  it('wartet, solange jemand im Versuch etwas eingibt', () => {
    const s = seite();
    s.renderVersuch();
    s.tippen();
    s.neuerStand([{ id: 5, runs: [] }]);
    s.pjRefresh();
    assert.equal(s.gezeichnet(), 1, 'no redraw under the cursor');
    s.verlassen();
    s.pjRefresh();
    assert.equal(s.gezeichnet(), 2, 'and once the field is left, it catches up');
  });

  it('laesst sich von einem Knopf mit dem Fokus nicht aufhalten', () => {
    // Nach Entfernen oder Zurueckholen steht der Fokus auf einem Knopf; das
    // heisst nicht, dass jemand etwas eingibt.
    const s = seite();
    s.renderVersuch();
    s.knopf();
    s.neuerStand([{ id: 5, runs: [] }]);
    s.pjRefresh();
    assert.equal(s.gezeichnet(), 2);
  });

  it('zeichnet nach einem Sprachwechsel neu', () => {
    const s = seite();
    s.renderVersuch();
    s.sprache('pt');
    s.pjRefresh();
    assert.equal(s.gezeichnet(), 2);
  });
});

describe('veraltete Zeile eines entfernten Gefaesses', () => {
  it('schickt nichts, zeichnet neu und sagt warum', () => {
    const s = seite();
    s.renderVersuch();
    s.neuerStand([{ id: 5, runs: [] }]);
    const feld = { value: '12 g/L', dataset: { pjFeld: 'result', pjRun: '1' } };
    s.pjChange({ target: { id: '', dataset: {}, closest: () => feld } });
    assert.deepEqual(s.gepatcht, []);
    assert.deepEqual(s.toasts, [['exp.runGone', 'err']]);
    assert.equal(s.gezeichnet(), 2);
  });
});

describe('Felder zum Anlegen beim Neuzeichnen', () => {
  // Jedes Zeichnen legt die Felder neu an, wie innerHTML im Browser.
  function ansicht() {
    return new Function(`
      let pjOffen = 5;
      let felder = {};
      const neueFelder = () => {
        felder = {};
        for (const id of ['pj-new-code', 'pj-new-what', 'pj-new-vcode', 'pj-new-vtitle']) felder[id] = { value: '' };
      };
      const versuch = {
        dataset: {},
        set innerHTML(x) {
          neueFelder();
        }
      };
      const document = { getElementById: (id) => (id === 'pj-versuch' ? versuch : felder[id] || null) };
      let currentLang = 'de';
      let pjVerlaufOffen = null;
      let pjVersuchGezeigt = null;
      const experiments = [{ id: 5, runs: [] }, { id: 6, runs: [] }];
      const pjExp = (id) => experiments.find((v) => v.id === id) || null;
      const pjDetail = () => '';
      const pjListe = () => '';
      const pjVerlaufLaden = () => {};
      ${hebeKonstante('PJ_ANLEGEN_FELDER')}
      let pjGezeichnetFuer;
      ${['pjVersuchStand', 'renderVersuch'].map((n) => hebeFunktion(n)).join('\n')}
      return {
        renderVersuch,
        feld: (id) => felder[id],
        oeffne: (id) => {
          pjOffen = id;
        }
      };`)();
  }

  it('behaelt, was noch nicht abgeschickt ist', () => {
    const a = ansicht();
    a.renderVersuch();
    a.feld('pj-new-code').value = 'A-03';
    a.renderVersuch();
    assert.equal(a.feld('pj-new-code').value, 'A-03');
  });

  it('nimmt es nicht in einen anderen Versuch mit', () => {
    const a = ansicht();
    a.renderVersuch();
    a.feld('pj-new-code').value = 'A-03';
    a.oeffne(6);
    a.renderVersuch();
    assert.equal(a.feld('pj-new-code').value, '');
  });
});
