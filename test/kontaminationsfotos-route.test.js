'use strict';
// Was GET /api/contamination-reports/:id/photos/:uuid dem Browser-Cache sagt.
//
// Die Route schickte "immutable" mit einem Jahr max-age: ein Browser, der ein
// Foto einmal gezeigt hatte, nahm es danach ein Jahr lang aus seinem Cache,
// ohne den Server zu fragen. Ein Foto eines geloeschten Berichts oeffnete sich
// so weiter aus dem Verlauf, und an einem geteilten Geraet auch nach dem
// Abmelden, weil keine Anfrage beim Server ankam und die Sitzungspruefung nie
// lief. Jetzt fragt der Browser jedes Mal nach; fuer ein Bild, das er schon
// hat, ist die Antwort eine 304 ohne Inhalt.
//
// Die Beutel, Chargen und Bilder hier sind ausgedacht.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { kontaminationsrouten, jpeg } = require('./helpers/kontaminationsrouten');

describe('GET /api/contamination-reports/:id/photos/:uuid', () => {
  let r;
  beforeEach(() => {
    r = kontaminationsrouten();
  });
  afterEach(() => r.schliessen());

  // Ein Bericht ueber einen Beutel, mit einem Foto und eigener Vorschau.
  async function melden() {
    const a = await r.anfrage('POST', '/api/contamination-reports', {
      type_id: r.db.listContaminationTypes(r.database)[0].id,
      severity: 'minor',
      bag_id: 'XY-0101-01',
      batch_id: 'XY-0101',
      photos: [{ data_url: jpeg(700), thumb_data_url: jpeg(90) }]
    });
    assert.equal(a.status, 200);
    const foto = r.database
      .prepare('SELECT uuid, rel_path FROM contamination_photos WHERE id=?')
      .get(a.json.photoIds[0]);
    return { id: a.json.id, foto, url: '/api/contamination-reports/' + a.json.id + '/photos/' + foto.uuid };
  }
  const nachfragen = (url, etag) => r.anfrage('GET', url, undefined, undefined, { 'if-none-match': etag });

  it('fragt jedes Mal nach, und die Antwort auf ein bekanntes Bild ist leer', async () => {
    const { url } = await melden();
    const bild = await r.anfrage('GET', url);
    assert.equal(bild.status, 200);
    assert.equal(bild.headers['Cache-Control'], 'private, no-cache');
    assert.match(String(bild.headers.ETag), /^"[^"]+"$/);
    assert.equal(bild.roh.length, 700);
    const vorschau = await r.anfrage('GET', url + '?thumb=1');
    assert.equal(vorschau.status, 200);
    assert.equal(vorschau.headers['Cache-Control'], 'private, no-cache');
    assert.equal(vorschau.roh.length, 90);
    assert.notEqual(vorschau.headers.ETag, bild.headers.ETag, 'picture and thumbnail are told apart');
    const wieder = await nachfragen(url, bild.headers.ETag);
    assert.equal(wieder.status, 304);
    assert.equal(wieder.roh.length, 0);
    assert.equal(wieder.headers.ETag, bild.headers.ETag);
    assert.equal(wieder.headers['Cache-Control'], 'private, no-cache');
  });

  it('antwortet nach dem Loeschen des Berichts 404, auch auf die Frage mit dem ETag', async () => {
    const { id, url } = await melden();
    const { ETag } = (await r.anfrage('GET', url)).headers;
    assert.equal((await nachfragen(url, ETag)).status, 304);
    assert.equal((await r.anfrage('DELETE', '/api/contamination-reports/' + id)).status, 200);
    assert.deepEqual(r.dateien(), [], 'picture and thumbnail are unlinked');
    const weg = await nachfragen(url, ETag);
    assert.equal(weg.status, 404);
    assert.equal(weg.json.error, 'photo not found');
  });

  it('antwortet 404, wenn die Datei fehlt, auch auf die Frage mit dem ETag', async () => {
    // Die Zeile steht noch, die Datei ist weg: das 304 kommt erst nach der
    // Pruefung, ob es die Datei gibt.
    const { foto, url } = await melden();
    const { ETag } = (await r.anfrage('GET', url)).headers;
    assert.equal((await nachfragen(url, ETag)).status, 304);
    fs.rmSync(path.join(r.DIR, 'data', foto.rel_path));
    const weg = await nachfragen(url, ETag);
    assert.equal(weg.status, 404);
    assert.equal(weg.json.error, 'photo file missing');
  });
});
