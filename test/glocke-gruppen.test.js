'use strict';
// Glocke: Nachproduzieren (Labor, Regal) und Bestellungen, die nicht rausgehen
// koennen, stehen ab zwei derselben Art als eine Gruppe da, nicht als zwanzig
// Zeilen. Wie die anderen UI-Tests holt dieser die Funktionen aus app.js und
// laesst sie gegen Attrappen laufen.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');

const APP = quelle();

function werkbank() {
  return new Function(
    `
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const t = (k, v) => k + (v ? JSON.stringify(v) : '');
    const loc = () => 'de-DE';
    const formatRelativeTime = () => 'vor 1 Std.';
    const WK_AN_CHEV = '<svg></svg>';
    ${hebeKonstante('NOTIF_GRUPPEN', APP)}
    const _notifOffen = new Set();
    ${hebeFunktion('notifEintraege', APP)}
    ${hebeFunktion('notifKurz', APP)}
    ${hebeFunktion('notifZeileHtml', APP)}
    ${hebeFunktion('notifGruppeHtml', APP)}
    return { notifEintraege, notifKurz, notifGruppeHtml, _notifOffen };
    `
  )();
}

let n = 0;
const meldung = (type, title, extra) => ({
  id: ++n,
  type,
  title,
  body: 'Testtext',
  linkType: 'x',
  linkId: String(n),
  created: '2026-01-01T10:00:00.000Z',
  read: 0,
  ...extra
});

describe('Glocke in Gruppen', () => {
  it('ab zwei derselben Art eine Gruppe, an der Stelle der neuesten', () => {
    const { notifEintraege } = werkbank();
    const items = [
      meldung('task_assignment', 'Aufgabe A'),
      meldung('lab_low', 'Nachproduzieren: Testpilz Petri'),
      meldung('shelf_low', 'Nachproduzieren: Testsubstrat'),
      meldung('lab_low', 'Nachproduzieren: Testpilz FK-Glas'),
      meldung('calendar_assignment', 'Termin B'),
      meldung('lab_low', 'Nachproduzieren: Zweitpilz Petri')
    ];
    const e = notifEintraege(items);
    assert.deepEqual(
      e.map((x) => (x.g ? 'G:' + x.g.type + ':' + x.g.items.length : x.it.title)),
      ['Aufgabe A', 'G:lab_low:3', 'Nachproduzieren: Testsubstrat', 'Termin B']
    );
  });

  it('eine allein bleibt eine Zeile', () => {
    const { notifEintraege } = werkbank();
    const e = notifEintraege([meldung('shelf_low', 'Nachproduzieren: Testsubstrat')]);
    assert.equal(e.length, 1);
    assert.ok(e[0].it && !e[0].g);
  });

  it('offene Bestellungen stehen oben, auch als einzelne', () => {
    const { notifEintraege } = werkbank();
    const e = notifEintraege([
      meldung('lab_low', 'Nachproduzieren: Testpilz Petri'),
      meldung('lab_low', 'Nachproduzieren: Testpilz FK-Glas'),
      meldung('sale_uncovered', 'Bestellt, aber nicht da: Testpilz · Spritze 10 ml')
    ]);
    assert.equal(e[0].it.type, 'sale_uncovered');
    assert.equal(e[1].g.type, 'lab_low');
  });

  it('der Name ohne das, was die Gruppe schon sagt', () => {
    const { notifKurz } = werkbank();
    assert.equal(notifKurz({ title: 'Nachproduzieren: Testpilz Petri' }), 'Testpilz Petri');
    assert.equal(notifKurz({ title: 'Bestellt, aber nicht da: Testpilz · Spritze 10 ml' }), 'Testpilz · Spritze 10 ml');
    assert.equal(notifKurz({ title: 'Ohne Doppelpunkt' }), 'Ohne Doppelpunkt');
  });

  it('die Gruppe zeigt Zahl, drei Namen und den Rest; aufgeklappt die einzelnen', () => {
    const w = werkbank();
    const items = ['A', 'B', 'C', 'D', 'E'].map((x) => meldung('lab_low', 'Nachproduzieren: Testpilz ' + x));
    const g = { type: 'lab_low', items };
    const zu = w.notifGruppeHtml(g);
    assert.match(zu, /notifications\.grp\.lab_low/);
    assert.match(zu, /class="notif-zahl">5</);
    assert.match(zu, /Testpilz A, Testpilz B, Testpilz C notifications\.grpMore\{&quot;n&quot;:2\}/);
    assert.match(zu, /aria-expanded="false"/);
    assert.match(zu, /data-ngrp-done="lab_low"/);
    assert.doesNotMatch(zu, /data-nid=/, 'zugeklappt keine einzelnen Zeilen');

    w._notifOffen.add('lab_low');
    const auf = w.notifGruppeHtml(g);
    assert.match(auf, /aria-expanded="true"/);
    assert.equal((auf.match(/class="notif-done" data-nid=/g) || []).length, 5);
  });

  it('ungelesen, solange eine darin ungelesen ist; Bestellungen rot', () => {
    const w = werkbank();
    const gelesen = [1, 2].map(() => meldung('sale_uncovered', 'Bestellt, aber nicht da: Testpilz', { read: 1 }));
    assert.doesNotMatch(w.notifGruppeHtml({ type: 'sale_uncovered', items: gelesen }), /unread/);
    const html = w.notifGruppeHtml({ type: 'sale_uncovered', items: [...gelesen, meldung('sale_uncovered', 'X: Y')] });
    assert.match(html, /notif-item unread/);
    assert.match(html, /notif-gruppe notif-rot/);
  });

  it('jede Gruppe hat ihre Worte in allen Sprachen', () => {
    const keys = [
      'notifications.grp.sale_uncovered',
      'notifications.grp.lab_low',
      'notifications.grp.shelf_low',
      'notifications.grpMore',
      'notifications.grpDoneTitle',
      'notifications.grpDoneToast.one',
      'notifications.grpDoneToast.other'
    ];
    for (const lang of ['de', 'en', 'pt']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'lang', lang + '.js'), 'utf8');
      for (const k of keys) assert.ok(src.includes("'" + k + "':"), lang + ': ' + k + ' fehlt');
    }
  });

  it('eine offene Bestellung ist rot, auch allein und aufgeklappt in der Gruppe', () => {
    const w = werkbank();
    const allein = w.notifEintraege([meldung('sale_uncovered', 'Bestellt, aber nicht da: Testpilz')]);
    assert.ok(allein[0].it, 'allein bleibt sie eine Zeile');
    const { notifZeileHtml } = new Function(
      `
      const esc = (s) => String(s);
      const t = (k) => k;
      const formatRelativeTime = () => '';
      ${hebeFunktion('notifZeileHtml', APP)}
      return { notifZeileHtml };
      `
    )();
    assert.match(notifZeileHtml(allein[0].it), /class="notif-row notif-rot"/);
    assert.match(notifZeileHtml(meldung('lab_low', 'Nachproduzieren: Testpilz')), /class="notif-row"/);

    w._notifOffen.add('sale_uncovered');
    const items = [1, 2].map(() => meldung('sale_uncovered', 'Bestellt, aber nicht da: Testpilz'));
    const html = w.notifGruppeHtml({ type: 'sale_uncovered', items });
    assert.equal((html.match(/class="notif-row notif-rot"/g) || []).length, 2);
  });

  it('die Glocke holt genug Meldungen fuer volle Gruppen', () => {
    const src = quelle('server.js');
    assert.match(src, /listNotifications\(database, req\.authUser\.user_id, 100\)/);
  });
});
