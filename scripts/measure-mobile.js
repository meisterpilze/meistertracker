// Measure the app across the whole width band, on both pointer axes, and
// report everything still under the floors.
//
//   node scripts/measure-mobile.js               # the band, both pointers
//   node scripts/measure-mobile.js --quick       # 320 / 375 / 768 / 1440 only
//   node scripts/measure-mobile.js --width 375   # one width
//   node scripts/measure-mobile.js --pointer coarse
//   node scripts/measure-mobile.js --all         # no 40-line cap on the report
//   node scripts/measure-mobile.js --strict      # exit 1 on anything unratcheted
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
// What it still cannot see, stated so the output is not read as more than it
// is: everything app.js renders at runtime — every table row, every list, every
// dialog body. That is what `--app` exists for, and it is a different mode
// because it needs a database. This mode is index.html's own markup under the
// real stylesheet, which is the layer the token work edits.
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
const ONE_WIDTH = Number(flag('--width') || 0) || null;
const ONE_POINTER = flag('--pointer');

const TYPE_FLOOR = floor();
// The Feld floor (--tap-min, 56px) is a gloved hand's number and is reported
// rather than counted: §9 of MOBILE_REDESIGN.md put the Büro controls at 48
// deliberately, and measuring everything against 56 reports 76 sidebar buttons
// sitting exactly where they were put. Counting those trains you to ignore the
// output.
const TOUCH_FELD = tapFloor();

const GRENZEN = breakpoints();
const BAND = ONE_WIDTH ? [ONE_WIDTH] : QUICK ? [320, 375, 768, 1440] : widthBand(GRENZEN.list);
const POINTS = ONE_POINTER ? POINTERS.filter((p) => p.name === ONE_POINTER) : POINTERS;
if (!POINTS.length) {
  console.error(`--pointer takes ${POINTERS.map((p) => p.name).join(' or ')}`);
  process.exit(2);
}

// ── The gate ───────────────────────────────────────────────────────────────
const viewportBreaks = GRENZEN.list.filter((g) => g.axis === 'viewport');
console.log(`Breakpoints in styles.css: ${viewportBreaks.map((g) => g.px).join(', ')}`);
const containerBreaks = GRENZEN.list.filter((g) => g.axis === 'container');
if (containerBreaks.length) {
  console.log(`Container breakpoints (box axis, not window): ${containerBreaks.map((g) => g.px).join(', ')}`);
}
console.log(`Switches without a width: ${GRENZEN.nonWidth.map((n) => `${n.feature}:${n.value}`).join(', ') || 'none'}`);
console.log(
  `Widths: ${BAND.length} (${BAND[0]} to ${BAND[BAND.length - 1]}), pointers: ${POINTS.map((p) => p.name).join(' and ')}`
);

const GAPS = uncovered(GRENZEN.list, BAND);
if (GAPS.length && !QUICK && !ONE_WIDTH) {
  console.log(`\n✗ COVERAGE: ${GAPS.length} breakpoint(s) without a triple`);
  for (const g of GAPS) console.log(`  ${g.px}px (${[...g.from].join('/')}): ${g.missing.join(', ')} missing`);
  console.log('\nNothing else is reported while a breakpoint is unmeasured: it would not be worth');
  console.log('anything. This is the exact defect both previous mobile rounds shipped green.');
  process.exit(1);
}
if (GAPS.length) {
  console.log(
    `  (a narrowed run measures ${BAND.length} width(s) on purpose; run without --quick/--width for acceptance)`
  );
} else {
  console.log('✓ COVERAGE: every breakpoint measured at G-1, G, G+1');
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

// ── The ratchet ────────────────────────────────────────────────────────────
// Findings that are open today, each with the package that closes it. The run
// is green on today's state and every package takes lines out. A line that
// stops matching is reported as removable, so the file shrinks instead of
// growing. Anything a line does not cover is new and counts.
function readThresholds() {
  if (!fs.existsSync(THRESHOLDS)) return { ratchet: [] };
  return JSON.parse(fs.readFileSync(THRESHOLDS, 'utf8'));
}

function ratchet(findings, lines) {
  const used = new Set();
  for (const f of findings) {
    f.covered = null;
    for (let i = 0; i < lines.length; i++) {
      const r = lines[i];
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
      return `[${f.pointer}] ${span(f.widths, band)}px  ${px}  ${f.at}${f.text ? `  "${f.text}"` : ''}`;
    });
  const cap = ALL ? lines.length : 40;
  for (const l of lines.slice(0, cap)) console.log('  ' + l);
  if (lines.length > cap) console.log(`  … and ${lines.length - cap} more (--all shows every line)`);
  return open.length;
}

// ── Run ────────────────────────────────────────────────────────────────────
async function main() {
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

  const server = serve(build(), null, 0);
  await new Promise((ok) => server.on('listening', ok));
  const port = server.address().port;
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
  for (const point of POINTS) {
    const page = await browser.newPage();
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
    for (const width of BAND) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: coarse, hasTouch: coarse });
      const m = await page.evaluate(measure, TYPE_FLOOR, point.tapFloor);
      scanned = m.scanned;
      hiddenCount = m.hidden;
      unfilledCount = m.unfilled;
      if (m.viewport !== width) {
        console.error(`\n✗ asked for ${width}px, the page reports ${m.viewport}px.`);
        process.exit(1);
      }
      for (const r of m.type) rows.push({ kind: 'type', pointer: point.name, width, ...r });
      for (const r of m.touch) rows.push({ kind: 'touch', pointer: point.name, width, ...r });
      // Only the outermost offender per branch: a div 40px too wide reports its
      // heading, its text and its buttons too, and they are all the one fix.
      const outer = m.over.filter((r, i) => !m.over.some((o, j) => j !== i && r.at.startsWith(o.at + ' ')));
      for (const r of outer) rows.push({ kind: 'over', pointer: point.name, width, ...r });
    }
    await page.close();
  }
  await browser.close();
  server.close();
  console.log(
    `\n${BAND.length} widths × ${POINTS.length} pointers = ${BAND.length * POINTS.length} measurements ` +
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
    if (!grouped.has(key)) grouped.set(key, { ...r, widths: [], pxMin: r.px, pxMax: r.px });
    const g = grouped.get(key);
    g.widths.push(r.width);
    g.pxMin = Math.min(g.pxMin, r.px);
    g.pxMax = Math.max(g.pxMax, r.px);
  }
  const findings = [...grouped.values()];

  const thresholds = readThresholds();
  const used = ratchet(findings, thresholds.ratchet || []);

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

  const dead = (thresholds.ratchet || []).filter((_, i) => !used.has(i));
  if (dead.length && !QUICK && !ONE_WIDTH && !ONE_POINTER) {
    console.log(`\n══ ratchet lines matching nothing ══  ${dead.length}`);
    for (const r of dead) {
      console.log(
        `  ${r.kind} ${r.at || '*'} ${r.text || ''}: ${r.package ? r.package + ' is done, ' : ''}line can go`
      );
    }
  }

  const held = findings.filter((f) => f.covered).length;
  console.log(
    bad
      ? `\n${bad} open, ${held} ratcheted. This is index.html's markup only — what app.js renders needs --app.`
      : `\nEvery floor holds across ${BAND.length} widths and ${POINTS.length} pointers. ${held} ratcheted with a reason and a package.`
  );
  process.exit(STRICT && bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

module.exports = { ROOT, span };
