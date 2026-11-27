'use strict';
// Abholorte stand on the page Abholungen.
//
// What belongs to a pickup was in three places: the page Abholungen (what may
// be sold, who is coming), the calendar (the appointment picks a place), and
// Admin › Abholorte (the places themselves). The places are the reason the
// other two can name one, and they were the furthest away.
//
// The card now stands at the end of Abholungen. Who may change a place has not
// changed: the server lets only an admin write, so only an admin sees the card.
// Text and lifted functions, no browser.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function hebe(name) {
  const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
  assert.ok(m, name + '() not found in app.js');
  return m[1];
}
function seite(id) {
  const von = HTML.indexOf('<div class="page" id="p-' + id + '"');
  assert.ok(von >= 0, 'no page p-' + id);
  const bis = HTML.indexOf('<div class="page" id="p-', von + 1);
  return HTML.slice(von, bis < 0 ? undefined : bis);
}

const ABHOLUNGEN = seite('pickups');
const ADMIN = seite('settings');

describe('Abholorte: where they stand', () => {
  it('are a card on Abholungen, under the list of pickups', () => {
    const karte = ABHOLUNGEN.indexOf('id="pickuploc-card"');
    assert.ok(karte > 0, 'no #pickuploc-card on Abholungen');
    assert.ok(ABHOLUNGEN.indexOf('id="pickups-body"') < karte, 'under the pickups, not above them');
    for (const id of ['pickuploc-add-btn', 'pickuploc-list']) {
      assert.ok(ABHOLUNGEN.indexOf('id="' + id + '"') > karte, `#${id} is not in the card`);
    }
  });

  it('left Admin: no tab, no panel, no entry in the Admin list of the sidebar', () => {
    assert.doesNotMatch(ADMIN, /id="pickuploc-(list|add-btn|card)"/);
    assert.doesNotMatch(HTML, /id="(st|sp|sn)-settings-pickuplocations"/);
    assert.doesNotMatch(APP, /settings-pickuplocations|openStab\('settings', 'pickuplocations'\)/);
  });

  it('are still wired where they are now', () => {
    assert.ok(APP.includes("$('pickuploc-add-btn').addEventListener('click', () => editPickupLocation());"));
    assert.match(hebe('renderPickups'), /showPickupLocations\(\);/);
  });
});

describe('Abholorte: who sees the card', () => {
  it('is nobody, as far as the markup goes', () => {
    assert.match(ABHOLUNGEN, /<div class="card" id="pickuploc-card" style="display: none">/);
  });

  const zeige = (currentUser) => {
    const card = { style: { display: 'none' } };
    let gezeichnet = 0;
    new Function(
      'document',
      'currentUser',
      'renderPickupLocations',
      hebe('showPickupLocations') + '\nshowPickupLocations();'
    )({ getElementById: (id) => (id === 'pickuploc-card' ? card : null) }, currentUser, () => gezeichnet++);
    return [card.style.display, gezeichnet];
  };

  it('is an admin, and the list is drawn for them', () => {
    assert.deepEqual(zeige({ username: 'erika', role: 'admin' }), ['', 1]);
  });

  it('is not a user who is no admin, and nothing is drawn', () => {
    assert.deepEqual(zeige({ username: 'max', role: 'user' }), ['none', 0]);
    assert.deepEqual(zeige(null), ['none', 0]);
  });

  it('matches the server, which lets only an admin write', () => {
    assert.match(
      SERVER,
      /if \(req\.method === 'POST' && req\.url === '\/api\/pickup-locations'\) \{\s*if \(requireAdmin\(req, res\)\) return;/
    );
  });
});

describe('Abholorte: texts that say where they are', () => {
  it('name Abholungen, in every language, and no longer Admin', () => {
    const erwartet = {
      de: 'Abholungen → Abholorte',
      en: 'Pickups → Pickup locations',
      pt: 'Levantamentos → Locais de levantamento'
    };
    for (const lang of Object.keys(erwartet)) {
      const window = {};
      new Function('window', fs.readFileSync(path.join(ROOT, 'lang', lang + '.js'), 'utf8'))(window);
      const hint = window.LANG[lang]['harvestFeed.siteHint'];
      assert.ok(hint.includes(erwartet[lang]), lang + ': the hint does not name the new place');
      assert.doesNotMatch(hint, /Admin →/);
      assert.equal(
        window.LANG[lang]['nav.pickups'],
        erwartet[lang].split(' → ')[0],
        lang + ': the page is called otherwise'
      );
      assert.equal(
        window.LANG[lang]['pickupLoc.title'],
        erwartet[lang].split(' → ')[1],
        lang + ': the card is called otherwise'
      );
    }
  });
});
