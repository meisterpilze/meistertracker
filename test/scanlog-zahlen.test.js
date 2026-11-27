'use strict';
// The Scan-Log is a view of Zahlen, for everyone.
//
// It stood under Admin. Admin is where things are set once, and only admins
// can open it; the log of scans is read every day, by whoever wants to know
// what was scanned when and by whom. It is now the fourth view of Zahlen.
//
// Moving it in front of everyone must not widen what anyone may do. Two
// things in the view delete:
//   - "Leeren" deletes every scan. The server allows that to admins only, so
//     the button is shown to admins only.
//   - The cross on a row deletes that scan. The server allows it to an admin
//     and to the user who wrote the row, so the cross is drawn for those. A
//     cross the server refuses would take the row away here and bring it back
//     with the next sync.
//
// Text and lifted functions, no browser. Names are invented.

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

const DASH = seite('dash');
const ADMIN = seite('settings');

describe('Scan-Log: where it stands', () => {
  it('is a view of Zahlen, with its panel and everything the panel draws into', () => {
    assert.match(DASH, /<button class="stab" id="st-dash-log" data-i18n="settings\.scanLog">/);
    assert.match(DASH, /<div class="sp" id="sp-dash-log">/);
    for (const id of ['log-action-filter', 'log-date-from', 'log-date-to', 'log-q', 'log-count', 't-log', 'log-body']) {
      assert.ok(DASH.includes('id="' + id + '"'), `#${id} is not on Zahlen`);
    }
  });

  it('left Admin: no tab, no panel, no entry in the Admin list of the sidebar', () => {
    assert.doesNotMatch(ADMIN, /id="(log-body|t-log)"/);
    assert.doesNotMatch(HTML, /id="(st|sp|sn)-settings-log"/);
    assert.doesNotMatch(APP, /settings-log|openStab\('settings', 'log'\)/);
  });

  it('is drawn when its tab is opened', () => {
    assert.match(hebe('openStab'), /if \(page === 'dash' && sub === 'log'\) renderLog\(\);/);
    assert.ok(APP.includes("$('st-dash-log').addEventListener('click', () => openStab('dash', 'log'));"));
  });
});

describe('Scan-Log: who may delete a row', () => {
  const darf = (currentUser, e) =>
    new Function('currentUser', hebe('logDarfLoeschen') + '\nreturn logDarfLoeschen;')(currentUser)(e);

  it('lets an admin delete any row', () => {
    assert.equal(darf({ username: 'erika', role: 'admin' }, { user: 'max' }), true);
    assert.equal(darf({ username: 'erika', role: 'admin' }, { user: null }), true);
  });

  it('lets a user delete a row of their own, and no other', () => {
    assert.equal(darf({ username: 'max', role: 'user' }, { user: 'max' }), true);
    assert.equal(darf({ username: 'max', role: 'user' }, { user: 'erika' }), false);
  });

  it('lets a user delete no row whose author is not known', () => {
    assert.equal(darf({ username: 'max', role: 'user' }, { user: null }), false);
    assert.equal(darf({ username: 'max', role: 'user' }, {}), false);
  });

  it('lets nobody delete before the user is known', () => {
    assert.equal(darf(null, { user: 'max' }), false);
  });

  it('draws the cross only where that is true', () => {
    assert.match(hebe('renderLog'), /\$\{isRecent && logDarfLoeschen\(e\) \? '<button class="btn-xs lg-del/);
  });

  it('agrees with the server, which decides', () => {
    const i = SERVER.indexOf('const scanIdMatch = req.url.match(/^\\/api\\/scan-log\\/(\\d+)$/);');
    assert.ok(i > 0, 'the route for one scan was not found');
    const route = SERVER.slice(i, i + 1600);
    assert.match(route, /const isOwner = ownerKnown && req\.authUser && entry\.user_id === req\.authUser\.user_id;/);
    assert.match(route, /if \(!isAdmin && ownerKnown && !isOwner\) \{\s*jsonErr\(res, 403/);
    assert.match(route, /if \(!isAdmin && !ownerKnown\) \{\s*jsonErr\(res, 403/);
  });
});

describe('Scan-Log: who may empty it', () => {
  it('hides "Leeren" in the markup', () => {
    assert.match(
      DASH,
      /<button id="btn-37" class="btn btn-sm btn-r" style="display: none" data-i18n="settings\.clear">/
    );
  });

  const zeige = (currentUser) => {
    const btn = { style: { display: 'none' } };
    new Function('document', 'currentUser', hebe('showLogClear') + '\nshowLogClear();')(
      { getElementById: (id) => (id === 'btn-37' ? btn : null) },
      currentUser
    );
    return btn.style.display;
  };

  it('shows it to an admin and to nobody else', () => {
    assert.equal(zeige({ username: 'erika', role: 'admin' }), '');
    assert.equal(zeige({ username: 'max', role: 'user' }), 'none');
    assert.equal(zeige(null), 'none');
  });

  it('decides that when the user is loaded', () => {
    assert.match(hebe('loadCurrentUser'), /showLogClear\(\);/);
  });

  it('is still refused by the server for anyone who is not an admin', () => {
    assert.match(
      SERVER,
      /if \(req\.method === 'DELETE' && req\.url === '\/api\/scan-log'\) \{\s*if \(requireAdmin\(req, res\)\) return;/
    );
  });
});
