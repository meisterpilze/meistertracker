'use strict';
// Merkt das Telefon, dass es alten Code ausführt?
//
// Nach einem Deploy lief auf jedem Telefon, das die App offen hatte, der alte
// Code weiter — tagelang, wenn niemand neu lud. Nach dem Etikett, das der
// Scanner nicht kannte, war "App neu starten" die Lösung, und niemand konnte
// sehen, dass es nötig war.
//
// Jetzt nennt der Server einen Stand seiner App-Dateien (appBuild) in
// /api/data, im Ereignisstrom und als X-App-Build an den Dateien selbst. Der
// Service Worker meldet der Seite, welchen Stand ihr app.js hat. Weichen die
// beiden ab, lädt die App sich in einem ruhigen Moment selbst neu und landet
// wieder auf ihrer Seite; sonst sagt ein Balken, dass eine neue Version da ist.
//
// server.js lauscht beim require, also werden seine Teile wie in den anderen
// Tests herausgehoben und gegen echte Dateien in einem Temp-Ordner geprüft.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const SERVER = quelle('server.js');
const APP = quelle();
const SW = quelle('sw.js');
const HTML = quelle('index.html');
const CSS = quelle('styles.css');
const vomServer = (n) => _hf(n, SERVER);
const ausDerApp = (n) => _hf(n, APP);
const ausDemSw = (n) => _hf(n, SW);

describe('Server: der Stand der App-Dateien', () => {
  let dir;
  let stand;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-stand-'));
    fs.mkdirSync(path.join(dir, 'lang'));
    for (const f of ['index.html', 'app.js', 'styles.css', 'sw.js', 'lang/de.js', 'lang/en.js']) {
      fs.writeFileSync(path.join(dir, f), 'inhalt ' + f);
    }
    // Vorkomprimiertes gehört nicht dazu: es entsteht beim Start aus dem Rest.
    fs.writeFileSync(path.join(dir, 'lang', 'de.js.br'), 'komprimiert');
    stand = new Function(
      'fs',
      'path',
      'crypto',
      'DIR',
      `
      ${vomServer('shellFiles')}
      const _fileTags = new Map();
      ${vomServer('fileTag')}
      ${vomServer('appBuild')}
      return { shellFiles, fileTag, appBuild };
    `
    )(fs, path, crypto, dir);
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('zählt Hülle, Code, Stil, Service Worker und Sprachen, sonst nichts', () => {
    assert.deepEqual(stand.shellFiles(), ['index.html', 'app.js', 'styles.css', 'sw.js', 'lang/de.js', 'lang/en.js']);
  });

  it('bleibt gleich, solange sich nichts ändert', () => {
    assert.equal(stand.appBuild(), stand.appBuild());
    assert.match(stand.appBuild(), /^[0-9a-f]{12}$/);
  });

  it('ändert sich, sobald eine der Dateien sich ändert', () => {
    const vorher = stand.appBuild();
    const datei = path.join(dir, 'app.js');
    fs.writeFileSync(datei, 'inhalt app.js, neu');
    // Die Änderungszeit ausdrücklich weiter, falls das Dateisystem grob misst.
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(datei, t, t);
    assert.notEqual(stand.appBuild(), vorher);
  });

  it('eine Sprachdatei zählt genauso', () => {
    const vorher = stand.appBuild();
    const datei = path.join(dir, 'lang', 'en.js');
    fs.writeFileSync(datei, 'andere Wörter, längere');
    const t = new Date(Date.now() + 10000);
    fs.utimesSync(datei, t, t);
    assert.notEqual(stand.appBuild(), vorher);
  });
});

describe('Server: wie die App-Dateien ausgeliefert werden', () => {
  const teile = new Function(`
    ${vomServer('isShellUrl')}
    ${vomServer('etagMatches')}
    return { isShellUrl, etagMatches };
  `)();
  function kopf(url, ext, shell, worktree) {
    return new Function(
      'url',
      'ext',
      'shell',
      'WORKTREE_MODE',
      `
      const MIME = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' };
      const COMPRESSIBLE_EXT = new Set(['.html', '.js', '.css', '.json', '.svg']);
      ${vomServer('staticHeaders')}
      return staticHeaders(ext, url, null, shell);
    `
    )(url, ext, shell, !!worktree);
  }
  const SHELL = { etag: 'W/"abc"', build: 'b1' };

  it('erkennt genau die Dateien der App', () => {
    for (const u of ['/', '/index.html', '/app.js', '/styles.css', '/sw.js', '/lang/de.js', '/lang/pt.js']) {
      assert.ok(teile.isShellUrl(u), u);
    }
    for (const u of [
      '/login.js',
      '/login.html',
      '/lib/chart.min.js',
      '/icon-192.png',
      '/lang/de.js.br',
      '/manifest.json'
    ]) {
      assert.ok(!teile.isShellUrl(u), u);
    }
  });

  it('fragt bei den App-Dateien jedes Mal nach, statt fünf Minuten alten Code zu nehmen', () => {
    // Vorher max-age=300: ein Neuladen gleich nach dem Deploy bekam das alte
    // app.js aus dem Browser-Cache — und das Neuladen, das den neuen Stand holen
    // sollte, holte den alten.
    for (const [u, ext] of [
      ['/app.js', '.js'],
      ['/styles.css', '.css'],
      ['/lang/de.js', '.js'],
      ['/index.html', '.html']
    ]) {
      const h = kopf(u, ext, SHELL);
      assert.equal(h['Cache-Control'], 'no-cache', u);
      assert.equal(h.ETag, 'W/"abc"', u + ': ohne ETag kostet "no-cache" jedes Mal die ganze Datei');
      assert.equal(h['X-App-Build'], 'b1', u);
    }
  });

  it('lässt alles andere, wie es war', () => {
    assert.equal(kopf('/login.js', '.js', null)['Cache-Control'], 'public, max-age=300');
    assert.equal(kopf('/lib/chart.min.js', '.js', null)['Cache-Control'], 'public, max-age=31536000, immutable');
    assert.equal(kopf('/login.js', '.js', null).ETag, undefined);
  });

  it('meldet den Stand auch auf der Test-Instanz, die nichts zwischenspeichert', () => {
    const h = kopf('/app.js', '.js', SHELL, true);
    assert.equal(h['Cache-Control'], 'no-store');
    assert.equal(h['X-App-Build'], 'b1');
  });

  it('versteht If-None-Match als Liste und als Stern', () => {
    assert.ok(teile.etagMatches('W/"abc"', 'W/"abc"'));
    assert.ok(teile.etagMatches('W/"x", W/"abc"', 'W/"abc"'));
    assert.ok(teile.etagMatches('*', 'W/"abc"'));
    assert.ok(!teile.etagMatches('W/"abd"', 'W/"abc"'));
    assert.ok(!teile.etagMatches(undefined, 'W/"abc"'));
  });

  it('antwortet mit 304 und denselben Köpfen, wenn sich nichts geändert hat', () => {
    const block = SERVER.slice(
      SERVER.indexOf('if (isShellUrl(url)) {'),
      SERVER.indexOf('// P-01: serve pre-compressed')
    );
    assert.match(block, /etagMatches\(req\.headers\['if-none-match'\], shell\.etag\)/);
    assert.match(block, /res\.writeHead\(304, staticHeaders\(ext, url, null, shell\)\)/);
  });

  it('nennt den Stand in /api/data und im ETag der Daten', () => {
    // Ohne ihn im ETag bekäme ein Telefon nach dem Deploy weiter 304 — die
    // Daten sind ja dieselben — und erführe es nie.
    assert.match(
      SERVER,
      /const etag = '"v' \+ version \+ '-u' \+ \(req\.authUser\.user_id \|\| 0\) \+ '-n' \+ unread \+ '-b' \+ build \+ '"';/
    );
    assert.match(SERVER, /payload\.build = build;/);
  });

  it('nennt den Stand, sobald sich ein Telefon nach dem Neustart wieder verbindet', () => {
    assert.match(SERVER, /JSON\.stringify\(\{ type: 'connected', build: appBuild\(\) \}\)/);
  });
});

describe('Service Worker: welchen Stand die Seite bekommen hat', () => {
  function melde(url, stand, clientId) {
    return new Function(
      'url',
      'stand',
      'clientId',
      `
      const gesendet = [];
      const self = { clients: { get: () => Promise.resolve({ postMessage: (m) => gesendet.push(m) }) } };
      ${ausDemSw('meldeAppStand')}
      const res = stand === undefined ? undefined : { headers: { get: (k) => (k === 'X-App-Build' ? stand : null) } };
      const zurueck = meldeAppStand({ request: { url }, clientId }, res);
      return Promise.resolve().then(() => Promise.resolve()).then(() => ({ gesendet, gleich: zurueck === res }));
    `
    )(url, stand, clientId);
  }

  it('meldet der Seite den Stand ihres app.js', async () => {
    const r = await melde('https://x.test/app.js', 'b7', 'seite-1');
    assert.deepEqual(r.gesendet, [{ type: 'app-build', build: 'b7' }]);
    assert.ok(r.gleich, 'die Antwort geht unverändert weiter');
  });

  it('schweigt bei allen anderen Dateien und ohne Stand', async () => {
    assert.deepEqual((await melde('https://x.test/styles.css', 'b7', 'seite-1')).gesendet, []);
    assert.deepEqual((await melde('https://x.test/app.js', null, 'seite-1')).gesendet, []);
    assert.deepEqual((await melde('https://x.test/app.js', 'b7', '')).gesendet, []);
  });

  it('bricht nichts, wenn gar keine Antwort da ist', async () => {
    const r = await melde('https://x.test/app.js', undefined, 'seite-1');
    assert.deepEqual(r.gesendet, []);
    assert.ok(r.gleich);
  });

  it('meldet aus beiden Zweigen, dem der Test-Instanz und dem der Hülle', () => {
    assert.equal((SW.match(/\.then\(\(res\) => meldeAppStand\(e, res\)\)/g) || []).length, 2);
  });
});

// Die Entscheidung auf dem Telefon, gegen Attrappen.
function telefon(z) {
  return new Function(
    'z',
    `
    const geladen = [];
    let _mutating = z.mutating || 0;
    const pjOriginaleUnterwegs = new Set(z.originale || []);
    const leaveGuards = z.ungespeichert ? [{ ask: () => 'Ungespeichert' }] : [];
    const askGuard = (g) => g.ask();
    const bar = { hidden: true };
    const offen = new Set(z.offen || []);
    const document = {
      hidden: !!z.versteckt,
      activeElement: z.fokus ? { tagName: z.fokus } : { tagName: 'BODY' },
      getElementById: (id) =>
        id === 'update-bar' ? bar
        : id === 'scan-overlay' ? { classList: { contains: () => offen.has('scan-overlay') } }
        : id === 'harvest-panel' ? { style: { display: offen.has('harvest-panel') ? 'block' : 'none' } }
        : null,
      querySelector: (sel) =>
        sel === '.modal-bg.open' ? (offen.has('fenster') ? {} : null)
        : sel === '.page.active' ? { querySelectorAll: () => z.felder || [] }
        : null
    };
    const speicher = new Map(Object.entries(z.speicher || {}));
    const sessionStorage = { getItem: (k) => (speicher.has(k) ? speicher.get(k) : null) };
    const reloadForUpdate = () => geladen.push(true);
    const _pageLoadedAt = Date.now() - (z.seitLaden || 0);
    let _resumedAt = 0;
    const UPDATE_QUIET_MS = 5000;
    let _loadedBuild = null;
    let _serverBuild = null;
    ${ausDerApp('noteServerBuild')}
    ${ausDerApp('noteLoadedBuild')}
    ${ausDerApp('appOutdated')}
    ${ausDerApp('checkForUpdate')}
    ${ausDerApp('reloadIsSafe')}
    ${ausDerApp('pageHasTypedText')}
    ${ausDerApp('updateReloadAllowed')}
    return {
      server: (b) => noteServerBuild(b),
      seite: (b) => noteLoadedBuild(b),
      geladen,
      balken: () => !bar.hidden
    };
  `
  )(z);
}
const TEXT = (wert, vorher) => ({
  tagName: 'INPUT',
  type: 'text',
  value: wert,
  defaultValue: vorher || '',
  offsetParent: {}
});

describe('Telefon: lädt neu, wenn es niemanden stört', () => {
  it('tut nichts, solange der Stand derselbe ist', () => {
    const t = telefon({});
    t.server('a');
    t.server('a');
    assert.deepEqual(t.geladen, []);
    assert.ok(!t.balken());
  });

  it('lädt gleich nach dem Start neu, wenn dort schon ein neuerer Stand liegt', () => {
    // Der Service Worker meldet: dieses app.js ist Stand "alt" (aus dem
    // Zwischenspeicher, das Netz war zu langsam). Der Server hat "neu".
    const t = telefon({ seitLaden: 1000 });
    t.seite('alt');
    t.server('neu');
    assert.deepEqual(t.geladen, [true]);
  });

  it('lädt neu, wenn die App gerade im Hintergrund ist', () => {
    const t = telefon({ seitLaden: 60000, versteckt: true });
    t.server('a');
    t.server('b');
    assert.deepEqual(t.geladen, [true]);
  });

  it('zeigt mitten in der Arbeit nur den Balken', () => {
    const t = telefon({ seitLaden: 60000 });
    t.server('a');
    t.server('b');
    assert.deepEqual(t.geladen, [], 'nicht einfach unter den Händen weg');
    assert.ok(t.balken());
  });

  for (const [was, z] of [
    ['ein offenes Fenster oder die Kamera', { offen: ['fenster'] }],
    ['die Scan-Hülle', { offen: ['scan-overlay'] }],
    ['das Ernte-Gewicht', { offen: ['harvest-panel'] }],
    ['eine laufende Speicherung', { mutating: 1 }],
    ['ein Original, das noch hochlädt', { originale: [41] }],
    ['Ungespeichertes mit Wache', { ungespeichert: true }],
    ['ein Feld mit dem Cursor darin', { fokus: 'INPUT' }],
    ['ein ausgefülltes Feld auf der Seite', { felder: [TEXT('12,5')] }]
  ]) {
    it('lädt nicht neu bei ' + was + ' — auch nicht im Hintergrund', () => {
      const t = telefon({ ...z, versteckt: true });
      t.server('a');
      t.server('b');
      assert.deepEqual(t.geladen, []);
      assert.ok(t.balken(), 'der Balken sagt es trotzdem');
    });
  }

  it('zählt Suchfelder und vorbelegte, unveränderte Felder nicht', () => {
    const suche = { tagName: 'INPUT', type: 'search', value: 'LM', defaultValue: '', offsetParent: {} };
    const vorbelegt = TEXT('3,8', '3,8');
    const versteckt = { ...TEXT('x'), offsetParent: null };
    const t = telefon({ versteckt: true, felder: [suche, vorbelegt, versteckt] });
    t.server('a');
    t.server('b');
    assert.deepEqual(t.geladen, [true]);
  });

  it('lädt nicht in einer Schleife, wenn danach wieder der alte Code kommt', () => {
    const marke = JSON.stringify({ build: 'b', at: Date.now() - 30000 });
    const t = telefon({ versteckt: true, speicher: { 'mp-update-reload': marke } });
    t.server('a');
    t.server('b');
    assert.deepEqual(t.geladen, [], 'eben erst für "b" neu geladen');
    assert.ok(t.balken());
  });

  it('versucht es nach zwei Minuten wieder', () => {
    const marke = JSON.stringify({ build: 'b', at: Date.now() - 3 * 60 * 1000 });
    const t = telefon({ versteckt: true, speicher: { 'mp-update-reload': marke } });
    t.server('a');
    t.server('b');
    assert.deepEqual(t.geladen, [true]);
  });

  it('der Stand des Service Workers geht dem ersten Stand vom Server vor', () => {
    const t = telefon({ seitLaden: 1000 });
    t.server('neu');
    assert.deepEqual(t.geladen, [], 'zuerst sieht alles gleich aus');
    t.seite('alt');
    assert.deepEqual(t.geladen, [true], 'bis der Service Worker sagt, welches app.js hier läuft');
  });
});

describe('Telefon: zurück auf die Seite, auf der man war', () => {
  function zurueck(gespeichert, telefonBreite) {
    return new Function(
      'gespeichert',
      'telefonBreite',
      `
      const wege = [];
      const speicher = new Map(gespeichert ? [['mp-update-where', JSON.stringify(gespeichert)]] : []);
      const sessionStorage = {
        getItem: (k) => (speicher.has(k) ? speicher.get(k) : null),
        removeItem: (k) => speicher.delete(k)
      };
      const da = new Set(['p-batch', 'n-batch', 'st-batch-list']);
      const document = {
        getElementById: (id) => (da.has(id) ? { id, click: () => wege.push('tipp ' + id) } : null)
      };
      const go = (page, btn) => wege.push('go ' + page + ' ' + btn);
      const sbIsPhone = () => telefonBreite;
      ${ausDerApp('restoreAfterUpdate')}
      restoreAfterUpdate();
      return { wege, uebrig: speicher.has('mp-update-where') };
    `
    )(gespeichert, telefonBreite);
  }
  const jetzt = () => Date.now();

  it('öffnet Seite und Reiter wieder', () => {
    const r = zurueck({ page: 'batch', btnId: 'n-batch', stab: 'st-batch-list', drilled: true, at: jetzt() }, true);
    assert.deepEqual(r.wege, ['go batch n-batch', 'tipp st-batch-list']);
    assert.equal(r.uebrig, false, 'nur einmal');
  });

  it('bleibt am Telefon auf der Reiter-Liste, wenn man dort stand', () => {
    const r = zurueck({ page: 'batch', btnId: 'n-batch', stab: 'st-batch-list', drilled: false, at: jetzt() }, true);
    assert.deepEqual(r.wege, ['go batch n-batch']);
  });

  it('vergisst eine alte Marke', () => {
    const r = zurueck({ page: 'batch', btnId: 'n-batch', at: jetzt() - 5 * 60 * 1000 }, true);
    assert.deepEqual(r.wege, []);
  });

  it('tut ohne Marke nichts', () => {
    assert.deepEqual(zurueck(null, true).wege, []);
  });
});

describe('Telefon: wo der Stand ankommt und wann geprüft wird', () => {
  it('beim Laden, bei jeder Abfrage und beim Verbinden des Ereignisstroms', () => {
    assert.match(ausDerApp('loadData'), /restoreAfterUpdate\(\);\s*noteServerBuild\(d\.build\);/);
    assert.match(ausDerApp('pollSync'), /noteServerBuild\(d\.build\);/);
    assert.match(ausDerApp('connectSSE'), /msg\.type === 'connected'[\s\S]*?noteServerBuild\(msg\.build\)/);
  });

  it('der Service Worker meldet, welches app.js die Seite hat', () => {
    assert.match(APP, /e\.data\.type === 'app-build'\) noteLoadedBuild\(e\.data\.build\)/);
  });

  it('prüft beim Weggehen und beim Zurückkommen', () => {
    const i = APP.indexOf("document.addEventListener('visibilitychange', function () {\n  if (document.hidden) {");
    assert.ok(i > 0, 'der Handler fürs Weggehen und Zurückkommen fehlt');
    const rumpf = APP.slice(i, APP.indexOf('\n});', i));
    assert.match(rumpf, /if \(appOutdated\(\)\) checkForUpdate\(\);\s*return;/);
    assert.match(rumpf, /_resumedAt = Date\.now\(\);/);
  });

  it('der Balken ist da, versteckt, übersetzt und über der Kamera aus', () => {
    assert.match(HTML, /<div id="update-bar" class="update-bar" role="status" aria-live="polite" hidden>/);
    assert.match(HTML, /data-i18n="update\.available"/);
    assert.match(HTML, /id="update-btn" data-i18n="update\.reload"/);
    assert.match(CSS, /\.update-bar\[hidden\] \{\s*display: none;/);
    assert.match(CSS, /body:has\(#m-camscan\.open\) \.update-bar \{\s*display: none;/);
  });
});
