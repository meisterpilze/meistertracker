// Measure the app across the whole width band, on both pointer axes, and
// report everything still under the floors.
//
//   node scripts/measure-mobile.js               # the band, both pointers
//   node scripts/measure-mobile.js --quick       # 320 / 375 / 768 / 1440 only
//   node scripts/measure-mobile.js --width 375   # one width
//   node scripts/measure-mobile.js --pointer coarse
//   node scripts/measure-mobile.js --all         # no 40-line cap on the report
//   node scripts/measure-mobile.js --strict      # exit 1 on anything unratcheted
//   node scripts/measure-mobile.js --app         # with app.js running on real data
//
// ⚠️ **This used to be hand-driven, and that is the change.** The old version
// printed a snippet, told you to size a window to exactly 375px, and waited for
// you to paste it. Everything downstream of that inherited its two limits: it
// happened once, at one width, when somebody remembered. So MOBILE_REDESIGN.md
// could call the phone side device-only and be right, and both mobile rounds
// could report green while the band from 415 to 1069px went unmeasured. Chrome
// is on the machine and puppeteer-core can drive it; there was never a reason
// for a human to be the loop.
//
// ⚠️ **The widths come from styles.css.** A range, 320 to 1920 in steps of 20,
// plus G-1, G, G+1 around every breakpoint the stylesheet declares, and the run
// refuses to report anything at all while one of them is uncovered. See
// scripts/mobile-size-scan.js and test/breakpoint-coverage.test.js.
//
// ⚠️ **Both pointer axes at every width.** Rule R1 of the responsive plan:
// space and input are two axes and are never mixed. 31px of height is fine
// under a mouse and too small under a finger, and both happen at 1024px — an
// iPad, a Surface, a split window. The floor follows the pointer, not the
// width: 24px is WCAG 2.5.8 Target Size (Minimum), level AA, and applies to
// every pointer; 44px is Apple's HIG and WCAG 2.5.5, level AAA.
//
// ⚠️ **Two modes, and the second one is the point.** Without --app this
// measures index.html's own markup under the real stylesheet, with every script
// stripped: no auth, no fetch, no state, so only the CSS decides. That is the
// layer the token work edits, and it is cheap and honest, but it cannot see a
// single generated table row. Both previous plans called that half device-only
// and stopped there.
//
// --app is the other half. It builds a throwaway database, seeds it through
// db.js (scripts/measure-fixture.js), starts the real server in WORKTREE_MODE,
// creates a session with db.createSession() and hands the cookie to Chrome, and
// then walks the sidebar clicking every entry. What gets measured there is what
// app.js actually rendered: the batch table, the lab list, the calendar, the
// dialogs. It removes the database again afterwards and refuses to start if one
// it did not create is already there.
//
// ZOOMED OUT and AFTER A JUMP are two findings, and keeping them apart is
// the difference between a number and a wrong number. The first run of this
// mode conflated them and claimed the dashboard renders at 53% on a phone; it
// renders at 89%. The 53% was measured after opening the page at 1920px and
// dragging the window to 320, which is a real situation (it is Julian's split
// screen) but not the one the line said.
//
// ZOOMED OUT is the finding neither previous round could have produced, and it
// only exists in --app under a coarse pointer. On a phone a page whose content
// is wider than the screen does not get a sideways scrollbar: the browser
// honours the meta viewport, widens the LAYOUT viewport, and renders the whole
// page smaller. Asked for 320 and told 391 means a phone shows that page at
// 82%, with the type shrunk to match. `body{overflow-x:hidden}` does not
// prevent it, which is measured rather than assumed: the widening happened with
// that rule in place.
//
// OVERFLOW is the third thing every phase promised and none of them measured:
// "no horizontal scroll". Reported as the elements whose right edge is past the
// viewport, minus anything inside a container that scrolls sideways on purpose
// — a wide table in an overflow-x wrapper is the fix, not the defect, and
// counting it would bury the real ones.
//
// It is measured one page at a time, and that is not tidiness. Revealing every
// page at once — which the two floors below need, since a hidden element has no
// height — stacks fourteen screens into one document and the widths stop being
// the widths a user gets. Measured that way the bottom nav reported five
// buttons overflowing by 93px; measured a page at a time it is 375px wide with
// its last button ending at 375. The first version of this file believed the
// first number.
//
// TYPE is one floor, read from :root rather than restated: computed font-size
// below --fs-xs, on elements that carry their own text. It is counted on the
// COARSE axis only, and that is rule R1 again rather than leniency. The floor
// exists because of reading distance and gloves, not because of pixels: an 11px
// table header on a monitor at arm's reach is a deliberate density choice, and
// mobile-size-scan.js says so in its own header ("11px there is the correct
// answer, not debt"). What the run then finds is the real defect: styles.css
// raises type below 1024px by WIDTH, so a tablet at 1440px in landscape gets
// the 9px chip labels meant for a desk. Same page, same width, two answers.
// Fine-pointer hits are printed under the count, never added to it.

const fs = require('fs');
const path = require('path');
const { build, serve } = require('./static-page-server.js');
const { floor, tapFloor, breakpoints, widthBand, uncovered, POINTERS } = require('./mobile-size-scan.js');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THRESHOLDS = path.join(__dirname, 'mobile-thresholds.json');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const STRICT = args.includes('--strict');
const ALL = args.includes('--all');
const QUICK = args.includes('--quick');
const APP = args.includes('--app');
const ONE_WIDTH = Number(flag('--width') || 0) || null;
const ONE_POINTER = flag('--pointer');

const TYPE_FLOOR = floor();
// The Feld floor (--tap-min, 56px) is a gloved hand's number and is reported
// rather than counted: §9 of MOBILE_REDESIGN.md put the Büro controls at 48
// deliberately, and measuring everything against 56 reports 76 sidebar buttons
// sitting exactly where they were put. Counting those trains you to ignore the
// output.
const TOUCH_FELD = tapFloor();

// The jumps the second --app pass tests. Each one is a thing that happens to a
// real window in one step rather than an arbitrary pair of numbers: a phone or
// tablet rotating, a split view snapping, a desktop window being maximised.
// Only `to` widths that are in the band get measured against what opening the
// page there gives.
const JUMPS = [
  { name: '(desk→phone)', from: 1920, to: 320 },
  { name: '(desk→phone)', from: 1440, to: 390 },
  { name: '(tablet rotate)', from: 1024, to: 768 },
  { name: '(split view)', from: 1440, to: 760 },
  { name: '(phone rotate)', from: 844, to: 390 }
];

const GRENZEN = breakpoints();
const BAND = ONE_WIDTH ? [ONE_WIDTH] : QUICK ? [320, 375, 768, 1440] : widthBand(GRENZEN.list);
const POINTS = ONE_POINTER ? POINTERS.filter((p) => p.name === ONE_POINTER) : POINTERS;
if (!POINTS.length) {
  console.error(`--pointer takes ${POINTERS.map((p) => p.name).join(' or ')}`);
  process.exit(2);
}

// ── The gate ───────────────────────────────────────────────────────────────
// A function, not module-level statements: this file is importable (see
// module.exports at the bottom), and a require() must not print a report or
// call process.exit.
function gate() {
  const viewportBreaks = GRENZEN.list.filter((g) => g.axis === 'viewport');
  console.log(`Breakpoints in styles.css: ${viewportBreaks.map((g) => g.px).join(', ')}`);
  const containerBreaks = GRENZEN.list.filter((g) => g.axis === 'container');
  if (containerBreaks.length) {
    console.log(`Container breakpoints (box axis, not window): ${containerBreaks.map((g) => g.px).join(', ')}`);
  }
  console.log(
    `Switches without a width: ${GRENZEN.nonWidth.map((n) => `${n.feature}:${n.value}`).join(', ') || 'none'}`
  );
  console.log(
    `Widths: ${BAND.length} (${BAND[0]} to ${BAND[BAND.length - 1]}), pointers: ${POINTS.map((p) => p.name).join(' and ')}`
  );

  const gaps = uncovered(GRENZEN.list, BAND);
  if (gaps.length && !QUICK && !ONE_WIDTH) {
    console.log(`\n✗ COVERAGE: ${gaps.length} breakpoint(s) without a triple`);
    for (const g of gaps) console.log(`  ${g.px}px (${[...g.from].join('/')}): ${g.missing.join(', ')} missing`);
    console.log('\nNothing else is reported while a breakpoint is unmeasured: it would not be worth');
    console.log('anything. This is the exact defect both previous mobile rounds shipped green.');
    process.exit(1);
  }
  if (gaps.length) {
    console.log(
      `  (a narrowed run measures ${BAND.length} width(s) on purpose; run without --quick/--width for acceptance)`
    );
  } else {
    console.log('✓ COVERAGE: every breakpoint measured at G-1, G, G+1');
  }
}

// ── The measurement, run inside the page ───────────────────────────────────
// Was a string pasted by hand; it is a function now, and the reason it survived
// almost unchanged is that the logic was never the problem. The delivery was.
//
// Everything from here to the end of measure() executes in the BROWSER, not in
// node: puppeteer serialises the function and evaluates it in the page. It may
// not close over anything in this file, and it may only return plain data.
/* global document, window, getComputedStyle */
function measure(typeFloor, touchFloor) {
  const reveal = document.createElement('style');
  reveal.textContent = '.page,.sp,.modal-bg,details>*{display:block !important}.modal-bg{position:static !important}';
  document.head.appendChild(reveal);
  const TOUCH =
    'button,.btn,input,select,textarea,summary,[role="button"],.stab,.sb-btn,.chip,.bottom-nav-btn,a[onclick],[onclick]';
  const where = function (el) {
    let p = el.tagName.toLowerCase();
    if (el.id) p += '#' + el.id;
    else if (el.className && typeof el.className === 'string' && el.className.trim())
      p += '.' + el.className.trim().split(/\s+/)[0];
    const page = el.closest('.page');
    return (page && page.id ? page.id + ' ' : '') + p;
  };
  const ownText = function (el) {
    for (let n = el.firstChild; n; n = n.nextSibling)
      if (n.nodeType === 3 && n.nodeValue.trim()) return n.nodeValue.trim();
    return '';
  };
  // An ancestor that scrolls sideways on purpose absorbs its children's width.
  // Without this every cell of every wide table reports separately and the list
  // is thousands long, all of it describing one wrapper working correctly.
  const scrolls = function (el) {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
    }
    return false;
  };
  const type = [];
  const touch = [];
  const over = [];
  let hidden = 0;
  let unfilled = 0;
  // An element whose label arrives from the dictionary at runtime is empty
  // here, and an empty button is its padding: #mcp-save-btn measures 12px tall
  // and reports as a touch-target defect that does not exist. Its markup is
  // `<button class="btn btn-sm btn-p" data-i18n="mcp.save"></button>`.
  //
  // Skipped rather than guessed at, and counted so the limit stays visible in
  // the output. Filling them in here would mean a second implementation of
  // app.js's dictionary pass, which would agree with the real one exactly until
  // somebody changed one of them. --app runs the real one.
  const awaitingText = function (el) {
    return el.hasAttribute('data-i18n') && !el.textContent.trim();
  };
  const all = document.querySelectorAll('body *');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.closest('#login-screen,noscript,template')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') {
      hidden++;
      continue;
    }
    const fs2 = parseFloat(cs.fontSize);
    const txt = ownText(el);
    if (txt && fs2 < typeFloor) type.push({ at: where(el), px: fs2, text: txt.slice(0, 40) });
    const rect = el.getBoundingClientRect();
    if (el.matches(TOUCH) && awaitingText(el)) {
      unfilled++;
      continue;
    }
    if (el.matches(TOUCH) && rect.height > 0 && rect.height < touchFloor) {
      touch.push({
        at: where(el),
        px: Math.round(rect.height * 10) / 10,
        text: (el.value || txt || el.getAttribute('placeholder') || '').slice(0, 40)
      });
    }
  }
  reveal.remove();
  // Second pass: one page shown at a time, its own sub-panels opened, exactly
  // as a user meets it. 1px of slack, because sub-pixel layout routinely lands a
  // full-width box at 375.004 and a report full of those is a report nobody
  // reads.
  const pages = [...document.querySelectorAll('.page')];
  const wasPage = pages.map((p) => p.style.display);
  const wasAdmin = document.body.classList.contains('admin-mode');
  let widest = 0;
  pages.forEach((page) => {
    pages.forEach((p) => {
      p.style.display = 'none';
    });
    page.style.display = 'block';
    // Showing a page is not only display:block — app.js:1026 does
    // `classList.toggle('admin-mode', page === 'settings')`, and a stylesheet
    // rule hangs off it: above 769px the settings tab strip is hidden and the
    // sidebar carries that navigation instead. Without this line the strip is
    // visible in a place it never is, and the run reported 122 overflow
    // findings for fourteen pills that no user ever sees in a row. This is the
    // seam --app closes properly: there, app.js sets its own classes.
    document.body.classList.toggle('admin-mode', page.id === 'p-settings');
    const sps = [...page.querySelectorAll('.sp')];
    const wasSp = sps.map((x) => x.style.display);
    sps.forEach((x) => {
      x.style.display = 'block';
    });
    const pvw = document.documentElement.clientWidth;
    widest = Math.max(widest, document.documentElement.scrollWidth);
    [...page.querySelectorAll('*')].forEach((el) => {
      const c = getComputedStyle(el);
      if (c.display === 'none' || c.visibility === 'hidden' || c.position === 'fixed') return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > pvw + 1 && !scrolls(el)) {
        over.push({
          // where() already prefixes the page id; the caller used to add it a
          // second time, so every overflow line read "p-settings p-settings …".
          at: where(el),
          px: Math.round(r.right - pvw),
          text: ownText(el).slice(0, 40)
        });
      }
    });
    sps.forEach((x, j) => {
      x.style.display = wasSp[j];
    });
  });
  pages.forEach((p, j) => {
    p.style.display = wasPage[j];
  });
  document.body.classList.toggle('admin-mode', wasAdmin);
  return {
    viewport: window.innerWidth,
    type,
    touch,
    over,
    hidden,
    unfilled,
    scanned: all.length,
    pageWidth: widest
  };
}

// ── The live measurement, run inside the page with app.js running ──────────
// Deliberately NOT the reveal trick above. With app.js running, the app decides
// what is visible, and forcing every page to display:block would stack fourteen
// screens into one document and measure widths nobody gets. Here exactly one
// page is open, because a nav entry was clicked, exactly as a user meets it.
/* global document, window, getComputedStyle */
function measureLive(typeFloor, touchFloor) {
  const TOUCH =
    'button,.btn,input,select,textarea,summary,[role="button"],.stab,.sb-btn,.chip,.bottom-nav-btn,a[onclick],[onclick]';
  const where = function (el) {
    let p = el.tagName.toLowerCase();
    if (el.id) p += '#' + el.id;
    else if (el.className && typeof el.className === 'string' && el.className.trim())
      p += '.' + el.className.trim().split(/\s+/)[0];
    const page = el.closest('.page');
    return (page && page.id ? page.id + ' ' : '') + p;
  };
  const ownText = function (el) {
    for (let n = el.firstChild; n; n = n.nextSibling)
      if (n.nodeType === 3 && n.nodeValue.trim()) return n.nodeValue.trim();
    return '';
  };
  const scrolls = function (el) {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
    }
    return false;
  };
  const type = [];
  const touch = [];
  const over = [];
  const vw = document.documentElement.clientWidth;
  const all = document.querySelectorAll('body *');
  let visible = 0;
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.closest('#login-screen,noscript,template')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    visible++;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const fs2 = parseFloat(cs.fontSize);
    const txt = ownText(el);
    if (txt && fs2 < typeFloor) type.push({ at: where(el), px: fs2, text: txt.slice(0, 40) });
    if (el.matches(TOUCH) && r.height > 0 && r.height < touchFloor) {
      touch.push({
        at: where(el),
        px: Math.round(r.height * 10) / 10,
        text: (el.value || txt || el.getAttribute('placeholder') || '').slice(0, 40)
      });
    }
    if (cs.position !== 'fixed' && r.width > 0 && r.right > vw + 1 && !scrolls(el)) {
      over.push({ at: where(el), px: Math.round(r.right - vw), text: txt.slice(0, 40) });
    }
  }
  return {
    viewport: window.innerWidth,
    type,
    touch,
    over,
    hidden: all.length - visible,
    scanned: all.length,
    unfilled: 0,
    pageWidth: document.documentElement.scrollWidth
  };
}

// ── The throwaway instance --app runs against ──────────────────────────────
const DB_FILE = path.join(ROOT, 'meistertracker.db');
const MARKER = DB_FILE + '.throwaway';
const MADE = [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm', MARKER];
const MADE_DIRS = [path.join(ROOT, 'backups'), path.join(ROOT, 'data'), path.join(ROOT, 'calendars')];

// server.js takes its database path from __dirname and nothing overrides it, so
// --app writes into the checkout it runs from. That is fine in a worktree and
// would be a catastrophe in one somebody works in: a seeded fixture landing on
// top of real records. The marker file is the whole safety, so it has to name
// WHICH database it vouches for.
//
// The first version only asked whether a marker existed. That is not the same
// question. The marker was written before openDb created the file, so a crash
// in between left a marker with no database; no error path removed it either.
// Once a stale marker sat in a checkout that later acquired a real database,
// the existence test passed and the real database was deleted -- the exact
// accident the marker was introduced to prevent.
function markerPasst() {
  if (!fs.existsSync(MARKER) || !fs.existsSync(DB_FILE)) return false;
  try {
    const m = JSON.parse(fs.readFileSync(MARKER, 'utf8'));
    const st = fs.statSync(DB_FILE);
    return m.ino === st.ino && m.dev === st.dev && m.geboren === st.birthtimeMs;
  } catch {
    return false;
  }
}

function claimThrowaway() {
  if (fs.existsSync(DB_FILE) && !markerPasst()) {
    const warum = fs.existsSync(MARKER)
      ? 'there is a marker, but it names a different database'
      : 'it was not created by this script';
    console.error(`\n✗ ${DB_FILE} already exists and ${warum}.`);
    console.error('  --app seeds a fixture and deletes the database afterwards; it will not touch');
    console.error('  one it does not own. Run it in a worktree, or move that file aside first.');
    process.exit(2);
  }
  for (const f of MADE) if (fs.existsSync(f)) fs.rmSync(f, { force: true });
}

// Written only once the database exists, and stamped with which one it is.
function stampThrowaway() {
  const st = fs.statSync(DB_FILE);
  fs.writeFileSync(
    MARKER,
    JSON.stringify({ ino: st.ino, dev: st.dev, geboren: st.birthtimeMs, wer: 'scripts/measure-mobile.js --app' }, null, 1)
  );
}

function dropThrowaway(dirsExistedBefore) {
  for (const f of MADE) if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  for (const d of MADE_DIRS) {
    if (!dirsExistedBefore.has(d) && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
}

// Everything a run opens, in one place, so one function can close it from any
// path. Cleanup used to live only on the happy path: a thrown page.evaluate, a
// timed-out waitForFunction or a Ctrl-C left server.js alive on its port,
// writing into the checkout, and left the database and its marker behind.
const OFFEN = { browser: null, server: null, child: null, dirsBefore: new Set(), app: false };
let aufgeraeumt = false;

// The last word, and synchronous on purpose. An async handler racing an
// interrupt loses: measured here, the handler deleted the fixture while main()
// carried on and spawned the server, which created it again, and only then did
// process.exit fire. `exit` handlers run with everything else stopped, so this
// one cannot be overtaken, and fs.rmSync and kill both work there.
function aufraeumenSync() {
  if (aufgeraeumt) return;
  aufgeraeumt = true;
  if (OFFEN.child) {
    try {
      OFFEN.child.kill('SIGKILL');
    } catch {}
  }
  if (OFFEN.app) {
    try {
      dropThrowaway(OFFEN.dirsBefore);
    } catch {}
  }
}

// The tidy version for the path that has time to be tidy.
async function aufraeumen() {
  if (aufgeraeumt) return;
  // Each step guarded on its own: a browser that already died must not stop us
  // from killing the server, and neither must stop us deleting the fixture.
  try {
    if (OFFEN.browser) await OFFEN.browser.close();
  } catch {}
  try {
    if (OFFEN.server) OFFEN.server.close();
  } catch {}
  if (OFFEN.child) {
    try {
      OFFEN.child.kill();
    } catch {}
    await new Promise((ok) => setTimeout(ok, 400));
  }
  aufraeumenSync();
}

async function freePort() {
  const net = require('net');
  return new Promise((ok) => {
    const s2 = net.createServer();
    s2.listen(0, '127.0.0.1', () => {
      const p2 = s2.address().port;
      s2.close(() => ok(p2));
    });
  });
}

// ── The ratchet ────────────────────────────────────────────────────────────
// Findings that are open today, each with the package that closes it. The run
// is green on today's state and every package takes lines out. A line that
// stops matching is reported as removable, so the file shrinks instead of
// growing. Anything a line does not cover is new and counts.
function readThresholds() {
  if (!fs.existsSync(THRESHOLDS)) return { ratchet: [] };
  return JSON.parse(fs.readFileSync(THRESHOLDS, 'utf8'));
}

function ratchet(findings, lines, mode) {
  const used = new Set();
  for (const f of findings) {
    f.covered = null;
    for (let i = 0; i < lines.length; i++) {
      const r = lines[i];
      // A line says which mode it describes, and it only covers findings from
      // that mode. Without this the broad app-mode line for fine-pointer
      // controls above 769px also swallowed the markup-mode <summary> finding,
      // and the <summary>'s own line was then reported as dead: a green run
      // quietly suggesting that a real finding be deleted from the file.
      if (r.mode && mode && r.mode !== mode) continue;
      if (r.kind !== f.kind) continue;
      if (r.pointer && r.pointer !== f.pointer) continue;
      if (r.at && !f.at.includes(r.at)) continue;
      if (r.text && !(f.text || '').includes(r.text)) continue;
      if (r.maxPx != null && f.pxMax > r.maxPx) continue;
      // Wholly inside the stated band, not merely overlapping it. Otherwise a
      // line written for 769 and up would also cover a finding that starts at
      // 320, and the ratchet would be a blanket rather than a line.
      if (r.from != null && f.widths.some((w) => w < r.from)) continue;
      if (r.to != null && f.widths.some((w) => w > r.to)) continue;
      used.add(i);
      f.covered = r;
      break;
    }
  }
  return used;
}

// Consecutive widths collapse into a span: a finding that stands from 769 to
// 1920 is one finding, not sixty lines.
function span(widths, band) {
  const idx = new Map(band.map((w, i) => [w, i]));
  const sorted = [...new Set(widths)].sort((a, b) => a - b);
  const parts = [];
  let from = null;
  let lastIdx = null;
  let last = null;
  for (const w of sorted) {
    const i = idx.get(w);
    if (from === null) from = w;
    else if (i !== lastIdx + 1) {
      parts.push(from === last ? `${from}` : `${from}-${last}`);
      from = w;
    }
    lastIdx = i;
    last = w;
  }
  if (from !== null) parts.push(from === last ? `${from}` : `${from}-${last}`);
  return parts.join(', ');
}

function report(title, findings, band) {
  const open = findings.filter((f) => !f.covered);
  const held = findings.length - open.length;
  console.log(`\n${open.length ? '✗' : '✓'} ${title}: ${open.length} open${held ? `, ${held} ratcheted` : ''}`);
  if (!findings.length) {
    console.log('  none');
    return 0;
  }
  if (!open.length) {
    console.log('  none open');
    return 0;
  }
  const lines = open
    .sort((a, b) => b.widths.length - a.widths.length || a.pxMin - b.pxMin)
    .map((f) => {
      const px = f.pxMin === f.pxMax ? `${f.pxMin}px` : `${f.pxMin}-${f.pxMax}px`;
      const head = `[${f.pointer}] ${span(f.widths, band)}px  ${px}  ${f.at}${f.text ? `  "${f.text}"` : ''}`;
      if (!f.details || !f.details.size) return head;
      const ws = [...f.details.keys()].sort((a, b) => a - b);
      const ends = ws.length > 1 ? [ws[0], ws[ws.length - 1]] : [ws[0]];
      return head + ends.map((w) => `\n        at ${w}px: ${f.details.get(w)}`).join('');
    });
  const cap = ALL ? lines.length : 40;
  for (const l of lines.slice(0, cap)) console.log('  ' + l);
  if (lines.length > cap) console.log(`  … and ${lines.length - cap} more (--all shows every line)`);
  return open.length;
}

// ── Run ────────────────────────────────────────────────────────────────────
async function main() {
  gate();
  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    console.error('\npuppeteer-core is missing. Run `npm install` — it is a devDependency now,');
    console.error('and Chrome itself is not downloaded, the one on the machine is used.');
    process.exit(2);
  }
  if (!fs.existsSync(CHROME)) {
    console.error(`\nChrome not found at ${CHROME}. Set CHROME to its path.`);
    process.exit(2);
  }

  // Either a two-file static server, or a real one with a database behind it.
  let server = null;
  let child = null;
  let port;
  let cookie = null;
  let dirsBefore = new Set();
  if (APP) {
    const dbApi = require('./../db.js');
    const { seed } = require('./measure-fixture.js');
    dirsBefore = new Set(MADE_DIRS.filter((d) => fs.existsSync(d)));
    OFFEN.dirsBefore = dirsBefore;
    OFFEN.app = true;
    claimThrowaway();
    const database = dbApi.openDb(DB_FILE);
    stampThrowaway();
    seed(database);
    // Never typed and never needed: the run signs in by planting the session
    // cookie below, and createUser just insists on a password. A literal one
    // would be a working admin password for a live instance, published in a
    // repo anybody can read.
    const wegwerfPasswort = require('crypto').randomBytes(24).toString('base64url');
    dbApi.createUser(database, 'messstand', wegwerfPasswort, 'admin');
    const user = database.prepare('SELECT id FROM users WHERE username = ?').get('messstand');
    cookie = dbApi.createSession(database, user.id);
    port = await freePort();
    child = OFFEN.child = require('child_process').spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      // HOST is the point: server.js defaults to 0.0.0.0 for the phones in the
      // growing rooms, and this instance has a seeded fixture whose only
      // account is an admin. On loopback the run is nobody's business but this
      // machine's.
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', WORKTREE_MODE: '1', LOG_FORMAT: 'text' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const log = [];
    child.stdout.on('data', (c) => log.push(String(c)));
    child.stderr.on('data', (c) => log.push(String(c)));
    const http2 = require('http');
    const up = async () =>
      new Promise((ok) => {
        http2
          .get({ host: '127.0.0.1', port, path: '/api/health' }, (r) => {
            r.resume();
            ok(r.statusCode === 200);
          })
          .on('error', () => ok(false));
      });
    let waited = 0;
    while (!(await up())) {
      await new Promise((ok) => setTimeout(ok, 250));
      waited += 250;
      if (waited > 30000) {
        console.error('\n✗ the server did not come up in 30s:\n' + log.join('').slice(-2000));
        await aufraeumen();
        process.exit(1);
      }
    }
    console.log(`\nReal server on 127.0.0.1:${port}, seeded database, signed in as messstand.`);
  } else {
    server = OFFEN.server = serve(build(), null, 0);
    await new Promise((ok) => server.on('listening', ok));
    port = server.address().port;
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1']
  });

  const started = Date.now();
  const rows = [];
  let scanned = 0;
  let hiddenCount = 0;
  let unfilledCount = 0;
  let stops = 0;
  // Was Durchgang 1 an jeder Stelle gemessen hat, damit Durchgang 2 etwas hat,
  // wogegen er vergleichen kann.
  const geoeffnet = new Map();
  for (const point of POINTS) {
    const page = await browser.newPage();
    if (cookie) {
      // The session cookie is HttpOnly and, over plain http, plainly named
      // `session` (server.js:1210 picks __Host-session only under https).
      // puppeteer sets HttpOnly cookies fine; a browser handed the login form
      // could not, which is why this route exists at all.
      await page.setCookie({ name: 'session', value: cookie, domain: '127.0.0.1', path: '/', httpOnly: true });
    }
    const cdp = await page.createCDPSession();
    // Over CDP because puppeteer's emulateMediaFeatures knows
    // prefers-color-scheme and prefers-reduced-motion but not pointer or hover,
    // and `@media (hover: hover)` is exactly the rule that leaves a control on
    // a tablet nobody can trigger.
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-color-scheme', value: 'light' },
        { name: 'pointer', value: point.pointer },
        { name: 'any-pointer', value: point.pointer },
        { name: 'hover', value: point.hover },
        { name: 'any-hover', value: point.hover }
      ]
    });
    const coarse = point.name === 'coarse';
    await page.setViewport({ width: BAND[0], height: 900, deviceScaleFactor: 1, isMobile: coarse, hasTouch: coarse });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });

    // Where a measurement is taken. Statically that is the whole document once,
    // and measure() walks the pages itself. With app.js running it is one
    // sidebar entry at a time, clicked, because the app decides what is visible
    // and forcing it would measure widths nobody gets.
    let stations = [{ name: '(markup)', open: null }];
    if (APP) {
      await page.waitForFunction(() => document.querySelector('#p-dash.active, .page.active'), { timeout: 20000 });
      // Every sidebar entry, whether or not it is on screen right now. The
      // first version filtered on offsetParent, which at 320px means "not in
      // the closed drawer" — so it walked 7 of the 12 pages and the report
      // looked complete. A button in a closed drawer still clicks, and the page
      // it opens is still a page.
      const ids = await page.evaluate(() =>
        [...document.querySelectorAll('.sb-nav .sb-btn, .sb-footer .sb-btn')].filter((b) => b.id).map((b) => b.id)
      );
      stations = ids.map((id) => ({ name: id, open: id }));
    }
    stops = stations.length;

    // Width outside, station inside, and that order is the whole correctness of
    // the --app mode.
    //
    // The first version had it the other way round: open a page, then sweep the
    // widths. That opens the page at 1920px and measures it at 320, and what
    // comes back is not what a phone sees. app.js sizes some things once, when
    // it renders — a chart sized for a 1920px column keeps that width when the
    // window shrinks — so the dashboard reported a 600px layout viewport at
    // 320px and the run claimed the page renders at 53%. Measured properly it
    // is 360px and 89%. The 53% was real in its own way, but it was a finding
    // about resizing after render, not about a phone, and it was reported as
    // the second.
    //
    // Opening the page AT the width costs 12 clicks per width instead of 12 per
    // pointer. That is the price of the number meaning what it says.
    for (const width of BAND) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: coarse, hasTouch: coarse });
      for (const stop of stations) {
        if (stop.open) {
          // Escape first: a station may have left a panel or drawer open, and
          // the next page would then be measured underneath it.
          await page.keyboard.press('Escape');
          await page.evaluate((id) => document.getElementById(id).click(), stop.open);
          await new Promise((ok) => setTimeout(ok, 60));
        }
        const m = await page.evaluate(APP ? measureLive : measure, TYPE_FLOOR, point.tapFloor);
        scanned = m.scanned;
        hiddenCount = m.hidden;
        unfilledCount = m.unfilled;
        if (APP) geoeffnet.set(`${point.name}|${stop.name}|${width}`, m.viewport);
        if (m.viewport !== width) {
          // Not an error in the stand: the finding. Under a coarse pointer
          // Chrome honours the page's meta viewport, and a page whose content
          // is wider than the screen does not get a sideways scrollbar there,
          // it gets a WIDER LAYOUT VIEWPORT and renders zoomed out. The window
          // was set to 320 and the page reports 391, so a phone shows the whole
          // thing at 82% and the type shrinks with it.
          //
          // Nothing else on this page at this width is worth reporting, because
          // every rectangle was laid out against a width nobody has. Hence the
          // `continue`: one finding, not a hundred derived ones.
          rows.push({
            kind: 'widened',
            pointer: point.name,
            width,
            at: stop.name,
            px: m.viewport - width,
            text: '',
            detail: `${width} → ${m.viewport}px, renders at ${Math.round((width / m.viewport) * 100)}%`
          });
          continue;
        }
        for (const r of m.type) rows.push({ kind: 'type', pointer: point.name, width, ...r });
        for (const r of m.touch) rows.push({ kind: 'touch', pointer: point.name, width, ...r });
        // Only the outermost offender per branch: a div 40px too wide reports
        // its heading, its text and its buttons too, and they are all one fix.
        const outer = m.over.filter((r, i) => !m.over.some((o, j) => j !== i && r.at.startsWith(o.at + ' ')));
        for (const r of outer) rows.push({ kind: 'over', pointer: point.name, width, ...r });
      }
    }

    // ── Second pass: the window jumps, and nothing re-renders ────────────
    //
    // A named list of jumps rather than a sweep, and that is a correction of
    // this file's own first attempt twice over.
    //
    // The first version swept the widths inside a station and so measured every
    // page as if it had been opened at 1920 and dragged to 320. That is not
    // what a phone sees, and it made the run claim the dashboard renders at 53%
    // when opening it there gives 89%.
    //
    // The second version fixed that and then re-tested the drag by stepping
    // down 20px at a time, measuring at each step. It found nothing, and the
    // reason is that measuring IS a layout flush: stepped through with a
    // measurement between each step, the page reflows correctly the whole way.
    // A real device does not step. It rotates, or a split view snaps, and the
    // window changes in one go.
    //
    // Measured by hand on 2026-08-21 at 320px: opened there the dashboard's
    // layout viewport is 360px, jumped there from 1920 it is 600px. Same page,
    // same width, and the difference is a chart that was sized once for the
    // column it was born in. Julian's screenshot is this case.
    if (APP) {
      for (const jump of JUMPS) {
        for (const stop of stations) {
          await page.setViewport({
            width: jump.from,
            height: 900,
            deviceScaleFactor: 1,
            isMobile: coarse,
            hasTouch: coarse
          });
          await page.keyboard.press('Escape');
          await page.evaluate((id) => document.getElementById(id).click(), stop.open);
          await new Promise((ok) => setTimeout(ok, 80));
          await page.setViewport({
            width: jump.to,
            height: 900,
            deviceScaleFactor: 1,
            isMobile: coarse,
            hasTouch: coarse
          });
          const m = await page.evaluate(measureLive, TYPE_FLOOR, point.tapFloor);
          const opened = geoeffnet.get(`${point.name}|${stop.name}|${jump.to}`) ?? jump.to;
          if (m.viewport > opened) {
            rows.push({
              kind: 'jumped',
              pointer: point.name,
              width: jump.to,
              at: `${stop.name} ${jump.name}`,
              px: m.viewport - opened,
              text: '',
              detail: `${jump.from} → ${jump.to}px: layout viewport ${m.viewport}px, opened there it is ${opened}px`
            });
          }
        }
      }
    }
    await page.close();
  }
  await aufraeumen();
  console.log(
    `\n${BAND.length} widths × ${POINTS.length} pointers × ${stops} ${APP ? 'pages' : 'pass'} = ` +
      `${BAND.length * POINTS.length * stops} measurements ` +
      `in ${Math.round((Date.now() - started) / 1000)}s — ${scanned} elements, ${hiddenCount} still hidden, ` +
      `${unfilledCount} controls still waiting for their label (--app fills them).`
  );

  // Group over widths: the same button under the same floor at sixty widths is
  // one finding.
  // Grouped without the pixel value. For TYPE and TOUCH it is constant anyway,
  // but an OVERFLOW overhang changes with every width, and keeping it in the key
  // turned one settings tab strip into 122 findings. The number is still the
  // point, so it comes back as a range.
  const grouped = new Map();
  for (const r of rows) {
    const key = `${r.kind}|${r.pointer}|${r.at}|${r.text || ''}`;
    if (!grouped.has(key)) grouped.set(key, { ...r, widths: [], pxMin: r.px, pxMax: r.px, details: new Map() });
    const g = grouped.get(key);
    g.widths.push(r.width);
    g.pxMin = Math.min(g.pxMin, r.px);
    g.pxMax = Math.max(g.pxMax, r.px);
    // `detail` carries the numbers for one particular width and is deliberately
    // NOT part of the key: with it in, the dashboard being zoomed out from 320
    // to 460px is seven findings instead of one. The numbers are still the
    // point, so both ends of the span are printed under the line.
    if (r.detail) g.details.set(r.width, r.detail);
  }
  const findings = [...grouped.values()];

  const thresholds = readThresholds();
  const here = APP ? 'app' : 'markup';
  const used = ratchet(findings, thresholds.ratchet || [], here);

  const type = findings.filter((f) => f.kind === 'type' && f.pointer === 'coarse');
  const typeFine = findings.filter((f) => f.kind === 'type' && f.pointer === 'fine');
  const over = findings.filter((f) => f.kind === 'over');
  const tapFloorOf = (f) => POINTERS.find((p) => p.name === f.pointer).tapFloor;
  const tooSmall = findings.filter((f) => f.kind === 'touch' && f.pxMin < tapFloorOf(f));
  const belowFeld = findings.filter((f) => f.kind === 'touch' && f.pxMin >= tapFloorOf(f));

  let bad = 0;
  bad += report(`TYPE: under ${TYPE_FLOOR}px with a coarse pointer, at any width`, type, BAND);
  bad += report(
    `TOUCH: under the floor for its pointer (${POINTERS.map((p) => `${p.name} ${p.tapFloor}`).join(', ')})`,
    tooSmall,
    BAND
  );
  bad += report('OVERFLOW: past the right edge, outside any sideways-scrolling box', over, BAND);
  bad += report(
    'ZOOMED OUT: opened at this width, the page is still wider, so the phone shrinks it',
    findings.filter((f) => f.kind === 'widened'),
    BAND
  );
  bad += report(
    'AFTER A JUMP: the window changed in one step and the page did not follow',
    findings.filter((f) => f.kind === 'jumped'),
    BAND
  );

  if (typeFine.length) {
    // Reported, never counted, and the distinction is load-bearing: without it
    // the run reports 617 findings, most of them table headers on a monitor
    // sitting exactly where somebody put them, and a report like that trains
    // you to stop reading it.
    const widest = typeFine.reduce((m, f) => Math.min(m, f.pxMin), Infinity);
    console.log(`\n· ${typeFine.length} more under ${TYPE_FLOOR}px with a MOUSE (smallest ${widest}px) —`);
    console.log('  density on a desk, not a floor anybody set for a finger. Not counted.');
  }

  if (belowFeld.length) {
    // Reported, never counted. A Büro control at 48px is where §9 put it.
    console.log(`\n· ${belowFeld.length} more between their pointer's floor and the ${TOUCH_FELD}px Feld floor —`);
    console.log('  correct on a Büro screen, too small on one used with gloves.');
  }

  // Only lines this mode could have matched. A markup-mode line reported as
  // dead by the app run would be a lie in both directions: the app run cannot
  // see #nb-sub-section's <summary> because the form it sits in is collapsed,
  // and saying "the package is done" about it would take a real finding out of
  // the file.
  const dead = (thresholds.ratchet || []).filter((r, i) => !used.has(i) && (!r.mode || r.mode === here));
  if (dead.length && !QUICK && !ONE_WIDTH && !ONE_POINTER) {
    console.log(`\n══ ratchet lines matching nothing ══  ${dead.length}`);
    for (const r of dead) {
      console.log(
        `  ${r.kind} ${r.pointer || 'both'} ${r.at || '*'}: nothing matches it any more` +
          `${r.package ? ` (${r.package})` : ''}, line can go`
      );
    }
  }

  const held = findings.filter((f) => f.covered).length;
  console.log(
    bad
      ? `\n${bad} open, ${held} ratcheted.` +
          (APP ? '' : " This is index.html's markup only; what app.js renders needs --app.")
      : `\nEvery floor holds across ${BAND.length} widths and ${POINTS.length} pointers` +
          (APP ? ` on ${stops} pages with real data.` : '.') +
          ` ${held} ratcheted with a reason and a package.`
  );
  process.exit(STRICT && bad ? 1 : 0);
}

// Every way out of this process, tidy or not, goes past aufraeumenSync.
process.on('exit', aufraeumenSync);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

// Only when run as a program. `module.exports` below says this file can be
// imported, and until now importing it started a browser and swept the whole
// band before returning anything.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1); // the exit handler does the rest
  });
}

module.exports = { ROOT, span, markerPasst, stampThrowaway, MARKER, DB_FILE };
