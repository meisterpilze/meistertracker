'use strict';
// Notizen je Vorhaben-Reiter.
//
// Eine Notiz ist das Gegenstueck zum Versuch: der Versuch wird abgeschlossen und
// archiviert, die Notiz darf weg. Dieser Test haelt genau diesen Unterschied
// fest — und die zwei Grenzen, an denen formloser Text sonst leise Unfug
// anrichtet: ein Reiter, den es nicht gibt, und ein leerer Text, der eine
// vorhandene Notiz ueberschreibt.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db.js');

describe('Notizen', () => {
  let d, p;
  before(() => {
    p = path.join(os.tmpdir(), 'mt_notizen_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    d = db.openDb(p);
  });
  after(() => {
    d.close();
    fs.unlinkSync(p);
  });

  it('legt eine Notiz an und gibt sie an ihrem Reiter zurueck', () => {
    const id = db.insertProjectNote(d, { tab: 'research', body: 'Beispielnotiz' });
    const n = db.listProjectNotes(d).find((x) => x.id === id);
    assert.equal(n.tab, 'research');
    assert.equal(n.body, 'Beispielnotiz');
    assert.ok(n.created);
    assert.equal(n.updated, '');
  });

  it('nimmt das Datum vom Server, nicht aus der Anfrage', () => {
    const vorher = Date.now();
    const id = db.insertProjectNote(d, { tab: 'products', body: 'datiert', created: '2019-01-01T00:00:00.000Z' });
    const n = db.listProjectNotes(d).find((x) => x.id === id);
    assert.ok(Date.parse(n.created) >= vorher - 1000, 'created is now, not the date the client sent');
  });

  it('besteht auf Reiter und Text', () => {
    assert.throws(() => db.insertProjectNote(d, { tab: 'research' }), /required/);
    assert.throws(() => db.insertProjectNote(d, { body: 'ohne Reiter' }), /required/);
  });

  it('nimmt keinen Reiter an, den es nicht gibt', () => {
    // Sonst haette die Notiz einen Ort, den keine Seite je anzeigt, und sie
    // waere weg, ohne geloescht worden zu sein.
    assert.throws(() => db.insertProjectNote(d, { tab: 'forschung', body: 'falscher Reiter' }), /invalid tab/);
  });

  it('haelt die Reiter auseinander', () => {
    db.insertProjectNote(d, { tab: 'build', body: 'noch eine Beispielnotiz' });
    const alle = db.listProjectNotes(d);
    assert.equal(alle.filter((n) => n.tab === 'build').length, 1);
    assert.equal(alle.filter((n) => n.tab === 'research').length, 1);
  });

  it('stellt die neueste nach oben', () => {
    // Am Tisch liest man die letzte zuerst.
    db.insertProjectNote(d, { tab: 'research', body: 'zuletzt geschrieben' });
    assert.equal(db.listProjectNotes(d)[0].body, 'zuletzt geschrieben');
  });

  it('merkt sich beim Aendern, dass geaendert wurde', () => {
    const id = db.insertProjectNote(d, { tab: 'products', body: 'erst so' });
    assert.equal(db.updateProjectNote(d, id, { body: 'dann so' }), true);
    const n = db.listProjectNotes(d).find((x) => x.id === id);
    assert.equal(n.body, 'dann so');
    assert.ok(n.updated);
  });

  it('loescht den Text nicht, weil das Feld leer ankam', () => {
    // Ein leeres Formularfeld ist keine Aussage. Ohne diese Grenze macht ein
    // versehentliches Speichern aus einer Notiz ein leeres Kaestchen.
    const id = db.insertProjectNote(d, { tab: 'research', body: 'bleibt stehen' });
    assert.throws(() => db.updateProjectNote(d, id, { body: '' }), /required/);
    assert.equal(db.updateProjectNote(d, id, {}), false);
    assert.equal(db.listProjectNotes(d).find((x) => x.id === id).body, 'bleibt stehen');
  });

  it('wirft eine Notiz weg, und nur diese eine', () => {
    const vorher = db.listProjectNotes(d).length;
    const id = db.insertProjectNote(d, { tab: 'research', body: 'nur ein Zettel' });
    assert.equal(db.deleteProjectNote(d, id), true);
    assert.equal(db.listProjectNotes(d).length, vorher);
    assert.equal(db.deleteProjectNote(d, id), false);
  });

  it('reicht die Notizen mit den uebrigen Daten aus', () => {
    // Der Reiter liest sie aus demselben Stand wie alles andere; faellt sie aus
    // readAll heraus, ist die Seite nach einem Neuladen leer.
    const alles = db.readAll(d);
    assert.ok(Array.isArray(alles.projectNotes));
    assert.ok(alles.projectNotes.length > 0);
  });
});
