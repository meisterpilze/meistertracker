'use strict';
// Ein Druck antwortet genau einmal. Am 17.11.2026 brauchte Windows für einen
// Etikettendruck länger als die 15 Sekunden: die Zeitgrenze antwortete "timed
// out", beendete PowerShell, und dessen Ende antwortete ein zweites Mal.
// /api/print schrieb seine Antwort zweimal, und der Server meldete
// "Cannot write headers after they are sent".
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SERVER = quelle('server.js');

// printZPL mit Platzhaltern: der Druckweg antwortet so oft, wie man ihn lässt.
function drucke(antworten, bruecke = false) {
  return new Function(
    'antworten',
    'bruecke',
    `
    const gemerkt = [];
    const log = () => {};
    const checkZpl = () => null;
    const rememberPrintedLabels = (z) => gemerkt.push(z);
    const getEffectiveBridgeConfig = () => bruecke;
    const weg = (zpl, cb) => antworten.forEach((a) => cb(a));
    const _printViaBridge = weg;
    const _printViaPowerShell = weg;
    ${hebeFunktion('printZPL', SERVER)}
    const bekommen = [];
    printZPL('^XA^XZ', (err) => bekommen.push(err));
    return { bekommen, gemerkt };
  `
  )(antworten, bruecke);
}

describe('Ein Druck antwortet genau einmal', () => {
  it('Zeitgrenze und Prozessende: der Aufrufer hört nur die erste Antwort', () => {
    const r = drucke(['Print failed: PowerShell process timed out', 'Print failed: killed']);
    assert.deepEqual(r.bekommen, ['Print failed: PowerShell process timed out']);
    assert.deepEqual(r.gemerkt, [], 'ein abgebrochener Druck gilt nicht als gedruckt');
  });
  it('über die Brücke ebenso', () => {
    assert.equal(drucke([null, 'spät'], true).bekommen.length, 1);
  });
  it('ein gelungener Druck wird gemerkt, einmal', () => {
    const r = drucke([null, null]);
    assert.deepEqual(r.bekommen, [null]);
    assert.equal(r.gemerkt.length, 1);
  });
  it('das Aufräumen der Zwischendateien läuft auch nur einmal', () => {
    const teil = SERVER.slice(
      SERVER.indexOf('function _printViaPowerShell('),
      SERVER.indexOf('const timeout = setTimeout(')
    );
    assert.match(teil, /const cleanup = \(\) => \{\s*if \(aufgeraeumt\) return;\s*aufgeraeumt = true;/);
  });
});
