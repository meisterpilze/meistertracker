'use strict';
// Abmelden, for everyone.
//
// The only logout button stood under Admin › Benutzer. The Admin entry is
// revealed by showAdminNav() for admins alone, so a user who is not one had no
// way out of the app: not on a desk, not on a phone. On a phone that is handed
// from one person to the next, that means the next person works under the
// first one's name.
//
// The button now also stands at the bottom of the menu, which is the sidebar on
// a desk and the sheet behind "Mehr" on a phone, with the name of whoever is
// signed in beside it. This file holds where it is, that nothing hides it, and
// what a tap does. Text and lifted functions, no browser.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function hebe(name) {
  const m = APP.match(new RegExp('\\n((?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\})'));
  assert.ok(m, name + '() not found in app.js');
  return m[1];
}

const FUSS = HTML.slice(HTML.indexOf('<div class="sb-footer">'), HTML.indexOf('</aside>'));
const KNOPF = (FUSS.match(/<button[^>]*id="sb-logout"[^>]*>/) || [''])[0];

describe('Abmelden: where it stands', () => {
  it('is in the foot of the menu, which every layout shows', () => {
    assert.ok(FUSS.length > 0, 'the foot of the sidebar was not found');
    assert.ok(KNOPF, 'no #sb-logout in the foot of the menu');
  });

  it('is there for everyone: nothing in the markup hides it', () => {
    // #n-settings beside it starts with display:none and is revealed for admins.
    assert.doesNotMatch(KNOPF, /display:\s*none|hidden/);
  });

  it('is not a page: it carries no data-page and no id of a nav entry', () => {
    // The search lists every .sb-btn[data-page] as a page, and the router clears
    // and sets "active" on entries by their page.
    assert.doesNotMatch(KNOPF, /data-page=|id="n-/);
  });

  it('says "Abmelden" in every language, and leaves room for the name', () => {
    assert.match(
      FUSS,
      /<span data-i18n="users\.logout">Abmelden<\/span\s*><span class="sb-logout-user" id="sb-logout-user"><\/span>/
    );
    for (const lang of ['de', 'en', 'pt']) {
      const window = {};
      new Function('window', fs.readFileSync(path.join(ROOT, 'lang', lang + '.js'), 'utf8'))(window);
      assert.ok(window.LANG[lang]['users.logout'], lang + ': users.logout is missing');
    }
  });

  it('is not hidden by the stylesheet, on a desk or on a phone', () => {
    const hidden = [...CSS.matchAll(/([^{}]*\.sb-(?:footer|logout)\b[^{}]*)\{([^}]*)\}/g)].filter(
      (m) => !/sb-logout-user/.test(m[1]) && /display:\s*none/.test(m[2])
    );
    assert.deepEqual(
      hidden.map((m) => m[1].trim()),
      []
    );
  });

  it('keeps the button under Admin › Benutzer', () => {
    assert.match(HTML, /<button id="btn-43"[^>]*data-i18n="users\.logout"/);
  });
});

describe('Abmelden: what a tap does', () => {
  it('asks about unsaved work first, then signs out', () => {
    assert.match(
      APP,
      /\$\('sb-logout'\)\.addEventListener\('click', \(\) => \{\s*if \(mayLeavePage\(\)\) doLogout\(\);\s*\}\);/
    );
  });

  it('signs out on the server and goes to the login page', () => {
    const src = hebe('doLogout');
    assert.match(src, /authFetch\('\/api\/auth\/logout', \{ method: 'POST' \}\)/);
    assert.match(src, /window\.location\.href = '\/login\.html'/);
  });
});

describe('Abmelden: who is signed in', () => {
  const zeige = (currentUser) => {
    const el = { textContent: 'vorher' };
    new Function('document', 'currentUser', hebe('showLogoutName') + '\nshowLogoutName();')(
      { getElementById: (id) => (id === 'sb-logout-user' ? el : null) },
      currentUser
    );
    return el.textContent;
  };

  it('writes the name beside the button', () => {
    assert.equal(zeige({ username: 'erika', role: 'user' }), 'erika');
  });

  it('writes nothing before anyone is known', () => {
    assert.equal(zeige(null), '');
  });

  it('is filled when the user is loaded', () => {
    assert.match(hebe('loadCurrentUser'), /showAdminNav\(\);\s*showLogoutName\(\);/);
  });
});
