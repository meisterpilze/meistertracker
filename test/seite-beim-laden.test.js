'use strict';
// Zeichnet die offene Seite sich selbst, wenn Daten hereinkommen?
//
// Es gibt zwei Wege auf eine Seite: go(), wenn jemand tippt, und refresh(),
// wenn Daten eintreffen — beim Laden, bei jedem SSE-Ereignis, alle 30 Sekunden.
// Beide führen eine eigene Liste, welche Seite was neu zeichnen muss, und die
// zwei Listen sind auseinandergelaufen: refresh() kannte 'dash', wo die
// Aufgabenkarte einmal stand, aber nicht 'work', wohin sie gezogen war. Also
// blieb die Liste beim Neuladen leer — die Kacheln darunter sind statisches
// Markup und waren da — und füllte sich erst, wenn man die Seite verließ und
// über go() zurückkam. Wer blieb, sah nie eine Aktualisierung.
//
// Der Test hält die zwei Listen aneinander und prüft, dass eine Karte auf der
// Seite neu gezeichnet wird, auf der sie auch steht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle } = require('./helpers/quelle');

const SRC = quelle();
const HTML = quelle('index.html');

// Der Rumpf einer Funktion, von ihrer Zeile bis zur schließenden Klammer in
// Spalte 0 — dieselbe Annahme, auf der hebeFunktion() steht.
function rumpf(name) {
  const m = SRC.match(new RegExp('^(?:async )?function ' + name + '\\([\\s\\S]*?\\r?\\n\\}', 'm'));
  assert.ok(m, name + '() nicht gefunden — der Test muss mitgeführt werden');
  return m[0];
}

// Welche Seiten-Kennungen ein Rumpf abfragt.
const seiten = (text, ausdruck) =>
  new Set([...text.matchAll(new RegExp(ausdruck + " === '([a-z]+)'", 'g'))].map((m) => m[1]));

// In welcher .page ein Element steht.
function seiteVon(id) {
  const i = HTML.indexOf('id="' + id + '"');
  assert.ok(i > 0, '#' + id + ' steht nicht in index.html');
  const davor = HTML.slice(0, i);
  const m = [...davor.matchAll(/<div class="page(?: active)?" id="p-([a-z]+)"/g)].pop();
  assert.ok(m, '#' + id + ' liegt in keiner .page');
  return m[1];
}

describe('Die offene Seite zeichnet sich, wenn Daten kommen', () => {
  it('zeichnet die Aufgabenliste auf der Seite, auf der sie steht', () => {
    // Der Fehler in einer Zeile: die Karte zog nach p-work, der Zweig blieb
    // auf 'dash', und keiner der beiden Orte beschwerte sich.
    const seite = seiteVon('dash-batch-tasks');
    assert.equal(seite, 'work', 'die Karte steht auf Arbeitsgänge');
    const r = rumpf('refresh');
    const m = r.match(/id === '([a-z]+)'\)\s*renderDashBatchTasks\(\)/);
    assert.ok(m, 'refresh() zeichnet die Aufgabenliste überhaupt nicht neu');
    assert.equal(m[1], seite, 'sie wird für eine andere Seite gezeichnet als die, auf der sie steht');
  });

  it('kennt in refresh() jede Seite, die auch go() eigens neu zeichnet', () => {
    // go() läuft beim Tippen, refresh() beim Eintreffen von Daten. Was die eine
    // zeichnet und die andere nicht, ist beim Laden leer und bleibt es, solange
    // man auf der Seite steht.
    //
    // Zwei Seiten stehen bewusst nicht in refresh(): Einstellungen und Drucken
    // sind Formulare, die niemand von außen füllt. Sie stehen hier namentlich,
    // damit eine dritte auffällt, statt still dazuzukommen.
    //
    // 'dash' stand hier einmal mit, weil go() dort nur die KPI-Historie nachlud.
    // Das war kein Grund, sondern derselbe Fehler wie bei 'work': die Seite
    // zeichnete sich nie selbst. Jetzt tut sie es, und die Ausnahme ist weg.
    const ohneGrund = ['settings', 'print'];
    const nurGo = [...seiten(rumpf('go'), 'page')].filter(
      (s) => !seiten(rumpf('refresh'), 'id').has(s) && !ohneGrund.includes(s)
    );
    assert.deepEqual(nurGo, [], 'diese Seiten zeichnet nur go(): beim Neuladen bleiben sie leer');
  });

  it('lässt keinen Zweig auf eine Seite zeigen, auf der sein Element nicht steht', () => {
    // Je Zweig getrennt, nicht mit einem Ausdruck quer über alle: der erste
    // Anlauf hier fand renderDashLabStock() unter 'batch', weil sein lazy match
    // über die Klammer des Nachbarzweigs hinweglas.
    const zweige = {};
    const r = rumpf('refresh');
    const re = /if \(id === '([a-z]+)'\)\s*(\{)?/g;
    let m;
    while ((m = re.exec(r))) {
      let rumpfText;
      if (m[2]) {
        let tiefe = 1;
        let i = re.lastIndex;
        while (i < r.length && tiefe > 0) {
          if (r[i] === '{') tiefe++;
          else if (r[i] === '}') tiefe--;
          i++;
        }
        rumpfText = r.slice(re.lastIndex, i);
      } else {
        rumpfText = r.slice(re.lastIndex, r.indexOf(String.fromCharCode(10), re.lastIndex));
      }
      zweige[m[1]] = (zweige[m[1]] || '') + rumpfText;
    }
    const ziele = { renderDashBatchTasks: 'dash-batch-tasks', renderDashLabStock: 'dash-lab-stock' };
    for (const [fn, id] of Object.entries(ziele)) {
      const seite = Object.keys(zweige).find((k) => zweige[k].includes(fn + '()'));
      assert.ok(seite, fn + '() wird von refresh() gar nicht gerufen');
      assert.equal(seite, seiteVon(id), fn + '() wird auf der falschen Seite gerufen');
    }
  });
});
