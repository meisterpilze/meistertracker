'use strict';
// Wer darf welche Zahl setzen?
//
// Drei Angaben klingen ähnlich und sind es nicht:
//
//   der Rhythmus     — welcher Wochentag welches Thema hat. Gilt fortan.
//   das Startdatum   — ab wann überhaupt gezählt wird. Gilt rückwirkend.
//   das Tagesziel    — die Zahl für einen einzelnen Tag.
//
// Die ersten beiden gehören der Anlage, das dritte der Woche, die gerade
// gearbeitet wird. Also sind die ersten beiden Admin-Sache und das dritte nicht.
//
// Diese Datei hält die Grenze fest, weil sie sonst still verrutscht: der
// Kommentar an der Route begründete die Ausnahme einmal mit dem Melden
// erledigter Arbeit, und als dieser Zweig gelöscht wurde, blieb die Ausnahme
// ohne Begründung stehen. Eine Zusicherung vergisst das nicht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle } = require('./helpers/quelle');

const SERVER = quelle('server.js');
const DB = quelle('db.js');

// Der Rumpf einer Route, von ihrer Zeile bis zum nächsten `if (req.method`.
function route(muster) {
  const i = SERVER.indexOf(muster);
  assert.ok(i > 0, 'Route nicht gefunden: ' + muster);
  const rest = SERVER.slice(i);
  const ende = rest.indexOf('\n  if (req.method', 1);
  return ende === -1 ? rest : rest.slice(0, ende);
}

describe('Wer ein Ziel setzen darf', () => {
  it('lässt jeden Angemeldeten das Ziel eines Tages setzen', () => {
    const r = route("req.url === '/api/rhythm-task'");
    assert.doesNotMatch(r, /requireAdmin/, 'das Wochenziel setzt, wer die Woche arbeitet');
  });

  it('verlangt einen Admin für den wiederkehrenden Rhythmus', () => {
    // Er gilt fortan, nicht nur für diese Woche.
    assert.match(route("req.url === '/api/week-rhythm'"), /requireAdmin/);
  });

  it('verlangt einen Admin für das Startdatum', () => {
    // Es entscheidet rückwirkend, welche Wochen überhaupt gezählt werden.
    assert.match(route("req.url === '/api/rhythm-start'"), /requireAdmin/);
  });

  it('lässt niemanden einen Arbeitstag erfinden', () => {
    // Ein Ziel darf nur auf einen Tag, den der Rhythmus schon zu einem
    // Arbeitstag gemacht hat. Sonst könnte ein Mitarbeiter einen freien Tag
    // in einen Substrattag verwandeln, ohne den Rhythmus anzufassen.
    const fn = DB.slice(DB.indexOf('function setRhythmTarget'));
    assert.match(fn.slice(0, fn.indexOf('\n}')), /No rhythm on/);
  });

  it('nimmt nur eine plausible ganze Zahl an', () => {
    const fn = DB.slice(DB.indexOf('function setRhythmTarget'));
    const rumpf = fn.slice(0, fn.indexOf('\n}'));
    assert.match(rumpf, /Number\.isInteger/, 'ein Bruch waere kein Ziel');
    assert.match(rumpf, /n < 0/, 'ein negatives Ziel ist keines');
    assert.match(rumpf, /implausibly large/, 'und nach oben braucht es auch eine Grenze');
    assert.match(rumpf, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/, 'das Datum wird geprueft, bevor es in die Tabelle geht');
  });

  it('lässt nichts ohne Anmeldung durch', () => {
    // Alles ausserhalb der oeffentlichen Liste laeuft durch checkAuth(), bevor
    // irgendeine Route drankommt.
    const gate = SERVER.indexOf('const authUser = checkAuth(req);');
    assert.ok(gate > 0, 'die Anmeldeschranke ist fort');
    assert.ok(
      gate < SERVER.indexOf("req.url === '/api/rhythm-task'"),
      'die Route liegt vor der Schranke, also waere sie ohne Anmeldung erreichbar'
    );
  });
});
