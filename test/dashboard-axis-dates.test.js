'use strict';
// Dates on the dashboard's chart axes follow the interface language.
//
// The axes had the weekdays written into the code in German ("Mo", "Di") and the
// months in English, so the English dashboard read "Mo 28.09" under its daily
// harvest and the German year chart read "May", "Oct", "Dec". The substrate
// chart counted weeks as "KW 40" in every language. The labels now come from
// Intl in the user's locale, and German keeps exactly the week and month labels
// it had.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebe, hebeFunktion } = require('./helpers/quelle');

const APP = quelle();
const HELFER = ['loc', 'fmtDayMonth', 'fmtWeekdayDayMonth', 'fmtMonthShort'];

// LOCALE_MAP comes out of app.js rather than being restated here: it is what
// decides the output, and a copy would let exactly that change through.
function bauen(lang) {
  return new Function(
    [
      'let currentLang = ' + JSON.stringify(lang) + ';',
      hebe([[/^const LOCALE_MAP = .*$/m, 'LOCALE_MAP']], APP),
      ...HELFER.map((f) => hebeFunktion(f, APP)),
      'return { fmtDayMonth, fmtWeekdayDayMonth, fmtMonthShort };'
    ].join('\n')
  )();
}

// Monday 28 September to Sunday 4 October 2026, local dates.
const WOCHE = Array.from({ length: 7 }, (_, i) => new Date(2026, 8, 28 + i));

describe('dashboard axis dates', () => {
  it('English: English weekdays, British day/month', () => {
    const en = bauen('en');
    assert.deepEqual(
      WOCHE.map((d) => en.fmtWeekdayDayMonth(d)),
      ['Mon 28/09', 'Tue 29/09', 'Wed 30/09', 'Thu 01/10', 'Fri 02/10', 'Sat 03/10', 'Sun 04/10']
    );
    assert.equal(en.fmtDayMonth(new Date(2026, 9, 1)), '01/10');
    assert.equal(en.fmtMonthShort(9), 'Oct');
  });

  it('German keeps the week and month labels it had, and gets German months', () => {
    const de = bauen('de');
    assert.deepEqual(
      WOCHE.map((d) => de.fmtWeekdayDayMonth(d)),
      ['Mo 28.09', 'Di 29.09', 'Mi 30.09', 'Do 01.10', 'Fr 02.10', 'Sa 03.10', 'So 04.10']
    );
    assert.equal(de.fmtDayMonth(new Date(2026, 9, 1)), '01.10');
    assert.equal(de.fmtMonthShort(9), 'Okt');
  });

  it('Portuguese', () => {
    const pt = bauen('pt');
    assert.equal(pt.fmtWeekdayDayMonth(WOCHE[0]), 'seg. 28/09');
    assert.equal(pt.fmtMonthShort(9), 'out.');
  });

  it('the charts draw their labels with these helpers, not with fixed names', () => {
    for (const f of ['renderOverviewCharts', 'renderKpiHistory']) {
      const src = hebeFunktion(f, APP);
      assert.doesNotMatch(src, /'Mo', 'Di'|'Jan', 'Feb'/, f + ' spells out weekdays or months again');
      assert.doesNotMatch(src, /'KW '/, f + ' writes the German calendar week into every language');
      assert.match(src, /fmtWeekdayDayMonth\(/, f + ' no longer labels the week through fmtWeekdayDayMonth');
    }
  });
});
