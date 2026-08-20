'use strict';
// The search palette: what ranks above what, and the hooks it lands on.
//
// The ranking is pure — a record and a string in, a number out — so it is
// lifted out of app.js and run for real. Everything below that line needs a
// DOM, so it is checked as text, the same trade test/sidebar-entries.test.js
// and test/mobile-nav.test.js make and for the same reason: no jsdom here.
//
// The one that earns its place is the data-find census. gsGoto() navigates to a
// page and then looks for `[data-find="culture:LC-…"]` to scroll to and flash.
// If a renderer loses that attribute — reformatted, rewritten, replaced — the
// search still opens the right page and the flash silently never happens. It
// throws nothing and it looks almost right, which is the same failure mode the
// inline-override sweep turned up, in a different disguise.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

// Lift the pure half. GS_ORDER comes with it because gsMatch() sorts by it.
function lift(...names) {
  const src = names
    .map((n) => {
      const re = new RegExp(
        `^(?:const ${n} = \\[[\\s\\S]*?\\];|const ${n} = \\([\\s\\S]*?\\n\\};|function ${n}\\([\\s\\S]*?\\n\\})`,
        'm'
      );
      const m = APP.match(re);
      assert.ok(m, `${n} not found in app.js — this file is testing nothing`);
      return m[0];
    })
    .join('\n');
  return new Function(`${src}\nreturn { ${names.join(', ')} };`)();
}
const { GS_ORDER, gsRank, gsMatch, gsAutoOpen, gsScanned, gsLookup, gsMark, gsGroup } = lift(
  'GS_ORDER',
  'gsRank',
  'gsMatch',
  'gsAutoOpen',
  'gsScanned',
  'gsLookup',
  'esc',
  'gsMark',
  'gsGroup'
);

// A stand-in farm. The ids are the shapes this app really generates: genBatchId
// builds KUERZEL-DDMMYY-NN, cultures prefix that with their type, zone ids are
// the underscore barcodes off the labels.
const CHARGE = { type: 'batch', id: 'AUS-190826-02', sub: 'Austernpilz · FRUITING · Fruchtung/R2' };
const CHARGE2 = { type: 'batch', id: 'AUS-150826-01', sub: 'Austernpilz · INCUBATING · Büro' };
const KULTUR = { type: 'culture', id: 'LC-AUS-260801-01', sub: 'Austernpilz · LC · Aktiv' };
const SORTE = { type: 'strain', id: 'Austernpilz', key: 7, sub: 'AUS · 12 Chargen' };
const ZONE = { type: 'zone', id: 'FRU', sub: 'Fruchtung · 9 Beutel' };
const ZONE2 = { type: 'zone', id: 'INC_BUERO_01', sub: 'Inkubation · 18 Beutel' };
const SEITE = { type: 'page', id: 'Chargen', sub: 'Seiten', page: 'batch', btn: 'n-batch' };
const UNTERSEITE = {
  type: 'page',
  id: 'Chargen › Ernte',
  sub: 'Seiten',
  page: 'batch',
  btn: 'n-batch',
  stab: 'harvest'
};
const INDEX = [CHARGE, CHARGE2, KULTUR, SORTE, ZONE, ZONE2, SEITE, UNTERSEITE];

describe('what the search puts first', () => {
  it('ranks the id it was handed above everything else', () => {
    assert.equal(gsRank(CHARGE, 'aus-190826-02'), 0);
    assert.equal(gsRank(CHARGE, 'aus-19'), 1);
    assert.equal(gsRank(CHARGE, '190826'), 3);
    assert.equal(gsRank(CHARGE, 'fruiting'), 4);
    assert.equal(gsRank(CHARGE, 'shiitake'), -1);
  });

  it('finds the batch a scanned bag belongs to', () => {
    // A bag barcode is its batch's id plus a suffix. Nothing indexes single
    // bags — twenty per batch would outnumber every other record four to one —
    // so the batch answers for them, one rank below a direct hit.
    assert.equal(gsRank(CHARGE, 'aus-190826-02-07'), 2);
    const hits = gsMatch(INDEX, 'AUS-190826-02-07');
    assert.equal(hits[0], CHARGE, 'a scanned bag code did not lead to its batch');
  });

  it('does not let a three-letter zone answer for every query that starts with it', () => {
    // Without the floor, `FRU` (rank 2) would claim "fruiting", "früher",
    // every batch id beginning F-R-U, and sit above all of them.
    assert.equal(gsRank(ZONE, 'fruchtkoerper'), -1);
    assert.equal(gsRank(ZONE2, 'inc_buero_01_r3'), 2, 'a long enough id still answers for its children');
  });

  it('puts a full id above the six things that merely mention it', () => {
    const hits = gsMatch(INDEX, 'Austernpilz');
    assert.equal(hits[0], SORTE, 'the Sorte named exactly that came second to something that mentions it');
    assert.ok(hits.includes(CHARGE) && hits.includes(KULTUR), 'the records carrying it in their subtitle dropped out');
  });

  // Both of these need the two sides to arrive on the same rank. `chargen` used
  // to stand here and did not: the page is called exactly that (rank 0) and the
  // sub-page merely starts with it (rank 1), so the first clause of the
  // comparator settled it and the two clauses under it were never reached.
  // Deleting them left the file green.
  it('breaks a tie by type, so records come before the pages that hold them', () => {
    const SEITE_Z = { type: 'page', id: 'Zonen', sub: 'Seiten', page: 'zones', btn: 'n-zones' };
    const ZONE_Z = { type: 'zone', id: 'ZONEN_R1', sub: 'Inkubation \u00b7 4 Beutel' };
    // Page first in the array, so insertion order alone would keep it first.
    const hits = gsMatch([SEITE_Z, ZONE_Z], 'zone');
    assert.ok(GS_ORDER.indexOf('page') === GS_ORDER.length - 1, 'pages are meant to sort last');
    assert.equal(gsRank(SEITE_Z, 'zone'), gsRank(ZONE_Z, 'zone'), 'the tie this test is about did not happen');
    assert.equal(hits[0], ZONE_Z, 'a page outranked the zone it merely lists');
  });

  it('breaks a tie inside one type by id, so the same query always answers the same way', () => {
    // Two Chargen of the same Sorte, same rank, same type. Without the last
    // clause a stable sort would simply keep whichever order the index was
    // built in — which is creation order, and changes as batches are added.
    const hits = gsMatch(INDEX, 'aus-1');
    assert.equal(gsRank(CHARGE, 'aus-1'), gsRank(CHARGE2, 'aus-1'), 'the tie this test is about did not happen');
    assert.deepEqual(hits.slice(0, 2), [CHARGE2, CHARGE], 'the older id did not sort first');
  });

  it('answers an empty field with the pages, and not with forty sub-pages', () => {
    // Somebody who opened this and typed nothing wants to go somewhere. All
    // forty sub-tabs would bury the twelve entries that answer that.
    const hits = gsMatch(INDEX, '');
    assert.deepEqual(hits, [SEITE]);
    assert.deepEqual(gsMatch(INDEX, '   '), [SEITE], 'a field holding only spaces is an empty field');
  });

  it('is case-blind in both directions', () => {
    assert.equal(gsMatch(INDEX, 'lc-aus-260801-01')[0], KULTUR);
    assert.equal(gsMatch(INDEX, 'AUSTERNPILZ')[0], SORTE);
  });
});

describe('the code a scanner types', () => {
  const jump = (q, isCode) => gsAutoOpen(gsMatch(INDEX, q), q, !!isCode);

  it('opens a unique, complete id without waiting for a keypress', () => {
    assert.equal(jump('LC-AUS-260801-01'), KULTUR);
  });

  it('waits when something is still being typed', () => {
    // Eight characters: every id this app generates is longer, and a human
    // halfway through a word must not be teleported.
    assert.equal(jump('FRU'), null);
    assert.equal(jump('AUS-190'), null);
  });

  it('waits when the code is not unique', () => {
    // Two records can carry one id — an order number that is also a customer
    // reference, a Sorte named after a zone. Jumping would pick one at random.
    const doppelt = [
      { type: 'order', id: 'DOPPELT-01', sub: 'eBay' },
      { type: 'customer', id: 'DOPPELT-01', sub: 'eBay' }
    ];
    assert.equal(gsAutoOpen(gsMatch(doppelt, 'DOPPELT-01'), 'DOPPELT-01', false), null);
  });

  it('never jumps on a prefix, however long', () => {
    assert.equal(jump('LC-AUS-260801-0'), null);
  });

  it('opens the batch a scanned bag belongs to', () => {
    // The code a station actually produces. Nothing indexes single bags, so
    // AUS-190826-02-03 is answered by AUS-190826-02 at rank 2 — and that is
    // the answer, not a shortlist to choose from.
    assert.equal(jump('AUS-190826-02-03', true), CHARGE);
  });

  it('will not do that for a string this app did not issue', () => {
    // Rank 2 is a prefix rule, so without the gate a Sorte called "Austern"
    // would swallow anybody typing "Austernpilze" the moment they paused.
    const sorten = [{ type: 'strain', id: 'Austern', key: 1, sub: 'AUS' }];
    assert.equal(gsAutoOpen(gsMatch(sorten, 'Austernpilze'), 'Austernpilze', false), null);
    // Same query, same records, and only the gate is different.
    assert.equal(gsAutoOpen(gsMatch(sorten, 'Austernpilze'), 'Austernpilze', true), sorten[0]);
  });

  it('does not fire on the way through a bag code', () => {
    // This is why the caller waits for the typing to stop. Mid-scan the query
    // is "AUS-190826-02", which is a complete unique id and would jump — with
    // "-03" still in the scanner's buffer, landing wherever focus went next.
    assert.equal(jump('AUS-190826-02', true), CHARGE, 'the mid-scan prefix is a jump on its own');
    const init = APP.match(/function gsInit\(\) \{[\s\S]*?\n\}/);
    assert.ok(init, 'gsInit moved');
    const handler = init[0].match(/input\.addEventListener\('input'[\s\S]*?\n {2}\}\);/);
    assert.ok(handler, 'the palette input handler moved');
    assert.match(handler[0], /clearTimeout\(gsJumpTimer\)/);
    assert.match(handler[0], /SCAN_MAX_GAP \* 2/, 'the wait is not the one the scan buffer already uses');
    assert.match(APP, /function gsClose\(\)[\s\S]*?clearTimeout\(gsJumpTimer\)/, 'a pending jump outlives the palette');
  });
});

describe('a scanned label is a lookup key, not an id', () => {
  const REGISTRY = new Map([[1234567, { type: 'bag', id: 'AUS-190826-02-03' }]]);

  it('resolves a printed barcode to the id it stands for', () => {
    assert.equal(gsScanned('1234567', REGISTRY), 'AUS-190826-02-03');
    assert.equal(gsLookup(INDEX, '1234567', REGISTRY).hits[0], CHARGE, 'a scanned label did not reach its batch');
  });

  it('leaves a number nobody printed a label for as typed', () => {
    assert.equal(gsScanned('9999999', REGISTRY), null);
    assert.equal(gsLookup(INDEX, '9999999', REGISTRY).q, '9999999', 'the empty result would name something else');
  });

  it('is not fooled by a short number, which is just a query', () => {
    assert.equal(gsScanned('190826', REGISTRY), null);
    assert.equal(gsLookup(INDEX, '190826', REGISTRY).hits[0], CHARGE, 'six digits stopped being a substring search');
  });

  it('reads a German scanner’s underscores as hyphens — but only as a second attempt', () => {
    // Those scanners send an underscore where a bag id has a hyphen.
    assert.equal(gsLookup(INDEX, 'AUS_190826_02', null).hits[0], CHARGE);
    // And zone barcodes really do carry underscores, which is why the typed
    // form is tried first. Rewriting it would make every zone unfindable.
    assert.equal(gsLookup(INDEX, 'INC_BUERO_01', null).hits[0], ZONE2);
    assert.equal(gsLookup(INDEX, 'INC_BUERO_01', null).q, 'INC_BUERO_01', 'the zone id was rewritten anyway');
  });

  it('keeps the field and the answer in step', () => {
    // gsRender() marks the match and names the miss with the resolved query,
    // not the one in the box — otherwise a scan highlights nothing.
    assert.match(
      APP,
      /const found = gsLookup\(gsIndex\(\), document\.getElementById\('gs-q'\)\.value, barcodeRegistry\);/
    );
    assert.match(APP, /gsQ = q;/);
  });
});

describe('the run it marks', () => {
  it('marks the match', () => {
    assert.equal(gsMark('AUS-190826-02', 'aus'), '<mark>AUS</mark>-190826-02');
    assert.equal(gsMark('Austernpilz', ''), 'Austernpilz');
    assert.equal(gsMark('Austernpilz', 'shii'), 'Austernpilz');
  });

  it('escapes what it did not match', () => {
    assert.equal(gsMark('<script>', 'x'), '&lt;script&gt;');
    assert.equal(gsMark(null, 'x'), '');
  });

  it('finds the match in the text rather than in the escaping of it', () => {
    // Customer names reach this, and they carry ampersands. Escaping first
    // turned "Meier & Co" into "Meier &amp; Co" before the search ran, so this
    // query found nothing.
    assert.equal(gsMark('Meier & Co', '& co'), 'Meier <mark>&amp; Co</mark>');
  });

  it('cannot cut an entity in half', () => {
    // The same order, failing the other way: the ampersand the query found was
    // the one that opens `&amp;`, and the tag went in between. The row rendered
    // a literal "amp;" and the highlight was on nothing.
    const out = gsMark('Meier & Co', '&');
    assert.equal(out, 'Meier <mark>&amp;</mark> Co');
    assert.doesNotMatch(out, /&(?!amp;|lt;|gt;|quot;|#39;)/, 'a bare ampersand means an entity was split');
  });
});

describe('where a result lands', () => {
  // gsGoto() reaches for [data-find="<type>:<id>"] after navigating. Batches are
  // the exception, and deliberately: goToBatch() already did this job for the
  // dashboard's "Zur Charge" button, filter field and all.
  const FLASHED = ['culture', 'strain', 'zone', 'order', 'customer'];

  it('has a renderer emitting the hook for every type it flashes', () => {
    const missing = FLASHED.filter((type) => !APP.includes(`data-find="${type}:`));
    assert.deepEqual(
      missing,
      [],
      `gsGoto() looks for a data-find hook no renderer writes, so the search opens the right page and ` +
        `then silently flashes nothing: ${missing.join(', ')}`
    );
  });

  it('sends batches through the one that already existed', () => {
    assert.match(APP, /if \(rec\.type === 'batch'\) return goToBatch\(rec\.id\);/);
  });

  it('names a group for every type it can rank', () => {
    const grouped = [...APP.matchAll(/^\s{2}(\w+): 'search\.g\w+',?$/gm)].map((m) => m[1]);
    assert.deepEqual(
      GS_ORDER.filter((t) => !grouped.includes(t)),
      [],
      'a type with no group heading renders under the previous type’s heading'
    );
  });

  it('opens the sub-page a sub-tab result names', () => {
    assert.match(APP, /if \(rec\.stab\) gsStab\(rec\.page, rec\.stab\);/);
  });
});

describe('the palette is wired to the app around it', () => {
  it('has the elements the module reaches for', () => {
    for (const id of ['m-search', 'gs-q', 'gs-results', 'gs-close', 'gs-hint', 'sb-search-key']) {
      assert.match(HTML, new RegExp(`id="${id}"`), `#${id} is gone — gsRender() or gsInit() reaches for it`);
    }
  });

  it('is opened by both visible entry points as well as the shortcut', () => {
    // data-gs-open rather than two ids in the JS: the sidebar field and the
    // phone topbar magnifier are the same button in two places.
    assert.equal((HTML.match(/data-gs-open/g) || []).length, 2, 'expected exactly the sidebar and the topbar trigger');
    assert.match(APP, /document\.querySelectorAll\('\[data-gs-open\]'\)/);
    assert.match(APP, /e\.metaKey \|\| e\.ctrlKey/);
  });

  it('closes on Escape through its own closer', () => {
    // Stripping the class would leave the focus with the palette, on a page it
    // is no longer over. Same rule the three ask-a-question dialogs follow.
    const list = APP.match(/const modals = \[([\s\S]*?)\];/);
    assert.ok(list, 'the Escape roster moved');
    assert.match(list[1], /'m-search'/, 'the palette is the one modal Escape cannot dismiss');
    assert.match(APP, /else if \(id === 'm-search'\) gsClose\(\);/);
  });

  it('lets go of the keyboard it took', () => {
    assert.match(APP, /gsReturnFocus = document\.activeElement;/);
    assert.match(APP, /gsReturnFocus\.focus\(\)/);
  });

  it('is initialised once the page exists', () => {
    assert.match(APP, /\n {2}gsInit\(\);/, 'gsInit() is never called, so nothing in the palette responds');
  });
});

describe('what the palette refuses to open on top of', () => {
  // gsOpen() used to ask `.modal-bg.open`, which describes how most dialogs in
  // this app open and not all of them: #change-pw-modal is a .modal-bg that
  // opens by writing style.display, #scan-overlay is not a .modal-bg, and
  // #ms-quick-modal and #ship-modal are neither. The palette therefore opened
  // over the scan overlay, where the field is invisible and the station's next
  // Enter commits a bag movement.
  //
  // The guard now asks the screen (getClientRects) rather than the class, but
  // it still needs the right set of elements to ask about. This census is what
  // keeps that set honest.
  const SEL = (() => {
    const m = APP.match(/const GS_OVERLAY_SEL = '([^']+)';/);
    assert.ok(m, 'GS_OVERLAY_SEL is gone — gsCovered() has nothing to look at');
    return m[1].split(',').map((x) => x.trim());
  })();

  // Every element in the markup that covers the whole viewport: the two class
  // conventions, plus anything that places itself inline.
  const OVERLAYS = [...HTML.matchAll(/<div\b[^>]*>/g)]
    .map((m) => {
      const flat = m[0].replace(/\s+/g, ' ');
      return {
        id: (flat.match(/id="([^"]+)"/) || [])[1] || '',
        cls: (flat.match(/class="([^"]+)"/) || [])[1] || '',
        flat
      };
    })
    .filter(
      (o) =>
        /\bmodal-bg\b/.test(o.cls) ||
        /\bscan-overlay\b/.test(o.cls) ||
        (/position: ?fixed/.test(o.flat) && /inset: ?0/.test(o.flat))
    );

  it('finds the overlays — a silent zero would make this block useless', () => {
    assert.ok(OVERLAYS.length >= 25, `expected at least 25 full-screen overlays, found ${OVERLAYS.length}`);
  });

  it('names every one of them', () => {
    const covered = (o) =>
      SEL.some((sel) =>
        sel.startsWith('#')
          ? sel.slice(1) === o.id
          : sel.startsWith('.')
            ? o.cls.split(/\s+/).includes(sel.slice(1))
            : false
      );
    const missing = OVERLAYS.filter((o) => !covered(o)).map((o) => o.id || o.cls);
    assert.deepEqual(missing, [], `the palette would open on top of: ${missing.join(', ')}`);
  });

  it('asks what is on the screen, not how it got there', () => {
    // style.display and the .open class are two routes to the same state, and
    // this app uses both. Client rects are the state.
    assert.match(APP, /function gsCovered\(\)/);
    assert.match(APP, /el\.getClientRects\(\)\.length/);
    assert.match(APP, /if \(gsCovered\(\)\) return;/, 'gsOpen() no longer consults the guard');
  });

  it('does not let one scanned Enter be read twice', () => {
    // The palette's own handler stops the key, and the global scan buffer
    // treats the open palette the way it treats any other search box.
    const handler = APP.match(/input\.addEventListener\('keydown'[\s\S]*?\n {2}\}\);/);
    assert.ok(handler, 'the palette keydown handler moved');
    assert.match(handler[0], /e\.stopPropagation\(\);/);
    assert.match(APP, /const gsOpenNow = document\.getElementById\('m-search'\)\?\.classList\.contains\('open'\);/);
    assert.match(APP, /if \(gsOpenNow \|\| \(!scanOpen && !camOpen\)\)/);
  });
});

describe('what a row says, and under which heading', () => {
  it('gives each kind one heading', () => {
    // gsMatch() sorts by rank first, so a kind can come back after another one.
    // The renderer opens a heading whenever the type changes, so that read
    // "Chargen / Seiten / Chargen" — one kind, two headings, and the second
    // batch filed under the wrong word.
    const gemischt = [
      { type: 'batch', id: 'AUS-190826-02', sub: '' },
      { type: 'page', id: 'Chargen', sub: '' },
      { type: 'batch', id: 'AUS-150826-01', sub: '' }
    ];
    assert.deepEqual(
      gsGroup(gemischt).map((r) => r.type),
      ['batch', 'batch', 'page']
    );
  });

  it('keeps the order the ranking chose', () => {
    // The kind that appears first is the kind with the best hit, so grouping
    // must not sort by GS_ORDER — a page that beat every record still leads.
    const seiteZuerst = [
      { type: 'page', id: 'Zonen', sub: '' },
      { type: 'zone', id: 'ZONEN_R1', sub: '' }
    ];
    assert.deepEqual(
      gsGroup(seiteZuerst).map((r) => r.type),
      ['page', 'zone']
    );
  });

  it('answers an empty field with all the pages, not seven of twelve', () => {
    // The one list the palette offers unprompted, truncated to "+5 more — keep
    // typing", which is the opposite of the offer. The box scrolls.
    const render = APP.match(/function gsRender\(keep\) \{[\s\S]*?\n\}/)[0];
    assert.match(render, /gsHits = gsGroup\(q \? all\.slice\(0, GS_CAP\) : all\);/);
    assert.match(render, /all\.length > gsHits\.length/, 'the "+n more" line still counts against a fixed cap');
  });

  it('does not subtitle a page with the name of its own heading', () => {
    const index = APP.match(/function gsPageIndex\(\) \{[\s\S]*?\n\}/)[0];
    assert.doesNotMatch(
      index,
      /sub: t\('search\.gPages'\)/,
      'every page row reads "Seiten" under a heading reading "Seiten"'
    );
  });

  it('calls a zone what the rest of the app calls it', () => {
    // zoneDisplayName() translates the four zones this app knows by name.
    // Reading z.name made the palette the one place showing the raw column.
    const index = APP.match(/function gsIndex\(\) \{[\s\S]*?\n\}/)[0];
    assert.match(index, /const dn = zoneDisplayName\(z\.id\);/);
    assert.doesNotMatch(index, /z\.name && z\.name !== z\.id/);
  });

  it('says what a customer has three of', () => {
    // join() filters falsy parts, so `c.orderCount || 0` contributed nothing
    // for a customer with none — the right answer by the wrong route — and a
    // bare "3" for one with three.
    const index = APP.match(/function gsIndex\(\) \{[\s\S]*?\n\}/)[0];
    assert.match(index, /c\.orderCount \? c\.orderCount \+ ' ' \+ t\('orders\.th\.orders'\) : ''/);
  });
});

describe('the palette on a phone', () => {
  it('bounds the box against the viewport the keyboard leaves behind', () => {
    // .gs-bg is position:fixed inset:0, so `max-height: 100%` on the box was
    // 100% of the window — and with the keyboard up the window is still the
    // whole window as far as vh and a fixed backdrop are concerned. The bound
    // never applied on the one device it was written for.
    const phone = CSS.slice(CSS.indexOf('@media (max-width: 768px) {', CSS.indexOf('═══ SUCHE')));
    const box = phone.match(/\.gs-box \{[\s\S]*?\n {2}\}/);
    assert.ok(box, 'the phone .gs-box rule is gone');
    assert.match(box[0], /max-height: calc\(100dvh/, 'the bound is still measured against the window');
  });

  it('gives the way out a width as well as a height', () => {
    // On a phone the word "esc" becomes a ✕ and the button stops being a
    // reminder: it is the only dismissal a thumb can reach.
    const esc = CSS.match(/\.gs-esc \{[\s\S]*?\n\}/);
    assert.ok(esc, '.gs-esc is gone');
    assert.match(esc[0], /min-height: max\(24px, var\(--tap-sm-min\)\)/);
    assert.match(esc[0], /min-width: max\(28px, var\(--tap-sm-min\)\)/);
  });

  it('lines the sidebar button up with the entries under it when collapsed', () => {
    // .sb-nav keeps padding: 12px 10px in both states, so an 8px override here
    // moved the button 2px out of line with everything below it.
    assert.doesNotMatch(CSS, /\.sidebar\.sb-collapsed \.sb-search-wrap/);
    assert.match(CSS, /\.sb-search-wrap \{\s*padding: 12px 10px 0;/);
  });

  it('stops its flash for anyone who asked animations to stop', () => {
    // .gs-flash reuses the batch-row-flash keyframes, and .batch-row-flash was
    // already on this list. Reusing the animation without joining the list is
    // how one gets missed.
    const rm = CSS.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none !important;/g);
    assert.ok(rm && rm.length, 'the allowlist block is gone');
    assert.ok(
      rm.some((b) => /\.gs-flash,/.test(b) && /\.gs-flash > td/.test(b)),
      '.gs-flash animates for people who asked animations not to'
    );
  });

  it('lights one row, not two', () => {
    // .gs-on paired with :hover meant an arrow key and a resting pointer could
    // each light a different row while Enter opened only one of them.
    assert.doesNotMatch(CSS, /\.gs-row:hover \{[\s\S]*?background/);
    assert.doesNotMatch(CSS, /\.gs-row:hover,/);
    const init = APP.match(/function gsInit\(\) \{[\s\S]*?\n\}/)[0];
    assert.match(init, /box\.addEventListener\('mousemove'/, 'nothing moves the selection with the pointer');
    // And moving it must not rebuild the rows the pointer is sitting on.
    const move = init.match(/box\.addEventListener\('mousemove'[\s\S]*?\n {2}\}\);/)[0];
    assert.match(move, /gsSelect\(\);/);
    assert.doesNotMatch(move, /gsRender\(/);
  });
});

describe('the bag count beside a zone', () => {
  // gsIndex() used to call getZoneBags() once per zone, and getZoneBags() walks
  // the whole scan log. A dozen zones and fifty thousand entries, on every
  // keystroke. gsZoneCounts() does the same bookkeeping for every zone in one
  // walk — but a subtitle that disagrees with the zone card is worse than a
  // slow one, so what is checked here is that the two agree, case for case,
  // rather than that the new one looks reasonable.
  const build = (log) => {
    const src = [
      APP.match(/^const toZone = \([\s\S]*?\n\};/m)[0],
      APP.match(/^function getZoneBags\([\s\S]*?\n\}/m)[0],
      APP.match(/^function gsZoneCounts\([\s\S]*?\n\}/m)[0]
    ].join('\n');
    return new Function('ZONES', 'RACK_ZONE', 'scanLog', `${src}\nreturn { getZoneBags, gsZoneCounts };`)(
      ZONES,
      RACK_ZONE,
      log
    );
  };
  const ZONES = ['INC', 'FRU', 'SPAWN', 'CONTAM'];
  const RACK_ZONE = { INC_R1: 'INC', FRU_R2: 'FRU' };

  it('agrees with getZoneBags on a move between racks of one zone', () => {
    // The case getZoneBags() carries a paragraph about: toZone() maps INC_R1
    // back to INC, so a naive "leave the old zone" deletes what it just added.
    const { getZoneBags, gsZoneCounts } = build([
      { bag: 'B1', action: 'ADD', from: '', to: 'INC' },
      { bag: 'B1', action: 'MOVE', from: 'INC', to: 'INC_R1' }
    ]);
    assert.equal(Object.keys(getZoneBags('INC')).length, 1);
    assert.equal(gsZoneCounts().INC, 1);
  });

  it('agrees with getZoneBags on four hundred random scan logs', () => {
    // Deterministic, so a failure is reproducible rather than a rumour.
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const AKT = ['ADD', 'MOVE', 'MOVE_BATCH', 'REMOVE', 'HARVEST'];
    const ORTE = ['INC', 'FRU', 'SPAWN', 'CONTAM', 'INC_R1', 'FRU_R2', '', 'NOWHERE', null];
    for (let versuch = 0; versuch < 400; versuch++) {
      const log = [];
      for (let i = 0; i < 60; i++)
        log.push({
          bag: rnd() < 0.05 ? null : 'B' + Math.floor(rnd() * 8),
          batch: 'X-1',
          action: pick(AKT),
          from: pick(ORTE),
          to: pick(ORTE)
        });
      const { getZoneBags, gsZoneCounts } = build(log);
      const counts = gsZoneCounts();
      for (const z of ZONES)
        assert.equal(
          counts[z] || 0,
          Object.keys(getZoneBags(z)).length,
          `zone ${z} disagrees on run ${versuch}: ${JSON.stringify(log)}`
        );
    }
  });

  it('is what the index actually uses', () => {
    assert.match(APP, /const zoneBags = gsZoneCounts\(\);/);
    const index = APP.match(/function gsIndex\(\) \{[\s\S]*?\n\}/)[0];
    assert.doesNotMatch(index, /getZoneBags\(/, 'the per-zone walk is back inside the index');
  });
});

describe('the index is built once, not once per keystroke', () => {
  it('remembers what it built', () => {
    const index = APP.match(/function gsIndex\(\) \{[\s\S]*?\n\}/)[0];
    assert.match(index, /if \(_gsIndex\) return _gsIndex;/);
    assert.match(index, /_gsIndex = out\.concat\(gsPageIndex\(\)\);/);
  });

  it('forgets it everywhere the data underneath it is replaced', () => {
    // The same place and the same reason as _statusByBatch, whose comment says
    // it: scanLog is replaced wholesale. Plus the two sources the palette
    // fetches itself, and the way in — so a search never opens on a picture
    // older than itself.
    const apply = APP.match(/function applyData\(d\) \{[\s\S]*?\n\}/)[0];
    assert.match(apply, /gsIndexInvalidate\(\);/, 'a fresh /api/data leaves a stale index');
    assert.match(APP, /function loadOrders\(\) \{[\s\S]*?gsIndexInvalidate\(\);/);
    assert.match(APP, /function loadCustomers\(\) \{[\s\S]*?gsIndexInvalidate\(\);/);
    assert.match(APP, /function gsOpen\(\) \{[\s\S]*?gsIndexInvalidate\(\);/);
  });
});

describe('the two sources the palette has to fetch', () => {
  it('has one writer for each cache', () => {
    // The page that shows them and the search that indexes them both used to
    // fetch, each writing the module cache from its own .then(). Two answers to
    // the same question, landing in either order.
    const orders = [...APP.matchAll(/^\s*_ordersCache = /gm)];
    const kunden = [...APP.matchAll(/^\s*_ohCustomerCache = /gm)];
    assert.equal(orders.length, 1, 'more than one place writes _ordersCache');
    assert.equal(kunden.length, 1, 'more than one place writes _ohCustomerCache');
    assert.match(APP, /function loadOrders\(\) \{[\s\S]*?_ordersCache = /);
    assert.match(APP, /function loadCustomers\(\) \{[\s\S]*?_ohCustomerCache = /);
  });

  it('asks for every customer, not the first page of them', () => {
    // db.listCustomers defaults to 200 and caps at 1000, ordered by spend. 200
    // is a fine page of a table and a poor thing to search — customer 201
    // downwards did not exist, with nothing on screen to say so.
    assert.match(APP, /apiGet\('\/api\/customers\?limit=1000'\)/);
    assert.doesNotMatch(APP, /apiGet\('\/api\/customers'\)/, 'a caller is still taking the default 200');
  });

  it('can be asked again after it failed', () => {
    // The old latch was set before the request went out and both catches
    // swallowed, so one offline moment made the two sources permanently
    // unsearchable for the life of the tab.
    assert.doesNotMatch(APP, /gsWarmed/, 'the once-only latch is back');
    const warm = APP.match(/function gsWarm\(\) \{[\s\S]*?\n\}/);
    assert.ok(warm, 'gsWarm moved');
    assert.equal((warm[0].match(/\.finally\(/g) || []).length, 2, 'a failed warm does not release its in-flight flag');
  });

  it('does not re-sort the list under somebody already reading it', () => {
    // A late answer arrives while the palette is open and the user may have
    // arrowed down it. Position means a different record by then; identity does
    // not. Typing passes nothing, because typing means "start at the top".
    assert.match(APP, /function gsRender\(keep\)/);
    assert.match(APP, /const wasOn = keep \? gsKey\(gsHits\[gsSel\]\) : null;/);
    assert.match(APP, /if \(gsIsOpen\(\)\) gsRender\(true\);/);
    const init = APP.match(/function gsInit\(\) \{[\s\S]*?\n\}/);
    assert.doesNotMatch(init[0], /gsRender\(true\)/, 'typing keeps the old selection');
  });
});

describe('the route the palette takes to a destination', () => {
  const GOTO = (() => {
    const m = APP.match(/function gsGoto\(rec\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'gsGoto is gone');
    return m[0];
  })();
  // The comments in there name go() and openStab() on purpose — they are about
  // why the code no longer calls them. Read the code.
  const GOTO_CODE = GOTO.replace(/\/\/[^\n]*/g, '');

  // go() and openStab() are the last two steps of arriving somewhere, not all
  // of it. Seven sub-tab pills load their own panel from their own click
  // handler, so calling openStab() past them opens the panel empty; the nav
  // entries carry side effects of the same kind. Clicking is the app's own
  // idiom for this — the bottom nav delegates to its sidebar twin, and go()
  // ends by clicking the active pill for Admin and Bestellungen.
  const HANDLERS = [
    ...APP.matchAll(/\$\('(st-[a-z0-9-]+)'\)\.addEventListener\('click', \(\) => (\{[\s\S]*?\n {2}\}|[^\n]*?)\);/g)
  ];

  it('finds the sub-tab handlers — a silent zero would make this block useless', () => {
    assert.ok(HANDLERS.length >= 25, `expected at least 25 sub-tab handlers, found ${HANDLERS.length}`);
  });

  it('has something to protect: pills that do more than switch the panel', () => {
    const extra = HANDLERS.filter((m) => {
      const body = m[2]
        .replace(/^\{|\}$/g, '')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/openStab\([^)]*\);?/g, '')
        .trim();
      return body.length > 0;
    }).map((m) => m[1]);
    assert.ok(extra.length >= 5, `expected several loader-carrying pills, found ${extra.join(', ') || 'none'}`);
  });

  it('clicks the control instead of calling what the control calls', () => {
    assert.doesNotMatch(
      GOTO_CODE,
      /\bopenStab\(/,
      'gsGoto() calls openStab() directly and skips the pill that loads the panel'
    );
    assert.doesNotMatch(
      GOTO_CODE,
      /\bgo\(/,
      'gsGoto() calls go() directly and skips the nav entry that resets the page'
    );
    assert.match(APP, /function gsNav\(btnId, page\)/);
    assert.match(APP, /function gsStab\(page, sub\)/);
  });

  it('does not land on a list that is filtering the result away', () => {
    // Chargen has had this from the start — goToBatch() clears the attention
    // filter and renderBatches() lets a query past the archive filter, which
    // its own comment says is for exactly this. Kulturen and Bestellungen had
    // nothing of the kind.
    assert.match(APP, /function gsClearFilters\(type\)/);
    assert.match(APP, /gsClearFilters\(rec\.type\);/);
    const clear = APP.match(/function gsClearFilters\(type\) \{[\s\S]*?\n\}/)[0];
    assert.match(clear, /'cult-type'/);
    assert.match(clear, /'cult-stat'/);
    // Through the setter, or one chip stays looking selected over an unfiltered
    // list.
    assert.match(clear, /setOrdersFilter\(''\)/);
    assert.doesNotMatch(clear, /_ordersFilter = /);
    // And before the navigation, because the pill that opens the panel is what
    // renders it.
    assert.ok(
      GOTO_CODE.indexOf('gsClearFilters') < GOTO_CODE.indexOf("gsNav('n-lab'"),
      'the filter is cleared after the render it was meant to affect'
    );
  });

  it('leaves the filters alone when the page itself was the result', () => {
    // Somebody who searched for "Kulturen" asked for the page, and what they
    // last looked at on it is part of the page.
    const seite = GOTO_CODE.match(/if \(rec\.type === 'page'\) \{[\s\S]*?\n {2}\}/);
    assert.ok(seite, 'the page branch moved');
    assert.doesNotMatch(seite[0], /gsClearFilters/);
  });

  it('asks whether it may leave before it closes itself', () => {
    // go() asks as well, and used to be the only one asking — by then the
    // palette had gone and the openStab() and gsFlash() queued behind it ran on
    // a page the user had just refused to leave.
    const bis = GOTO_CODE.indexOf('gsClose();');
    const frage = GOTO_CODE.indexOf('mayLeavePage()');
    assert.ok(frage >= 0, 'gsGoto() no longer asks');
    assert.ok(frage < bis, 'the question comes after the palette has already closed');
  });
});

describe('the page index reads the sidebar rather than repeating it', () => {
  // gsPageIndex() builds the "Seiten" results from .sb-btn[data-page]. An entry
  // without the attribute is simply absent from the search — no error, no
  // symptom, just a page you cannot find by name.
  const MAIN_NAV = HTML.slice(HTML.indexOf('<nav class="sb-nav"'), HTML.indexOf('<nav class="sb-admin-nav"'));
  const ENTRIES = [...MAIN_NAV.matchAll(/<button class="sb-btn[^"]*" id="(n-[a-z0-9-]+)"([^>]*)>/g)];

  it('finds the entries — a silent zero would make this block useless', () => {
    assert.ok(ENTRIES.length >= 8, `expected at least 8 sidebar entries, found ${ENTRIES.length}`);
  });

  it('gives every entry the page it opens', () => {
    const ohne = ENTRIES.filter((m) => !/data-page="/.test(m[2])).map((m) => m[1]);
    assert.deepEqual(ohne, [], `sidebar entries the search cannot name: ${ohne.join(', ')}`);
  });

  it('names pages that exist, and agrees with the router about which', () => {
    const routes = new Map([...APP.matchAll(/go\('([a-z]+)', '(n-[a-z0-9-]+)'\)/g)].map((m) => [m[2], m[1]]));
    const falsch = [];
    for (const m of [...ENTRIES, ...HTML.matchAll(/<button class="sb-btn[^"]*" id="(n-settings)"([^>]*)>/g)]) {
      const page = (m[2].match(/data-page="([a-z]+)"/) || [])[1];
      if (!page) continue;
      if (!HTML.includes(`id="p-${page}"`)) falsch.push(`${m[1]} → #p-${page} does not exist`);
      if (routes.has(m[1]) && routes.get(m[1]) !== page)
        falsch.push(`${m[1]} → go() opens ${routes.get(m[1])}, not ${page}`);
    }
    assert.deepEqual(falsch, [], falsch.join(' | '));
  });
});
