// Capture the app's computed *desktop* styles into test/desktop-baseline.json.
//
// Why this exists: the mobile redesign (MOBILE_REDESIGN.md) moves the CSS base
// from desktop to phone and restores the desktop values through a
// `min-width: 769px` override. "The desktop must not move" is easy to promise
// and hard to keep, so this turns it into a diff.
//
// It cannot run in CI — computing CSS needs a browser engine, and this repo has
// none. It is a dev-time tool. The checks that DO run in CI are the static
// styles.css assertions and the inline-size ratchet.
//
//   node scripts/capture-desktop-baseline.js            # write the fixture
//   node scripts/capture-desktop-baseline.js --compare  # diff against it
//
// It drives the browser itself. It used to print a snippet and wait for a human
// to paste it into a console at exactly the right window width, which meant the
// two things it exists to compare were taken by hand, twice, by whoever
// remembered to. puppeteer-core is a devDependency since the measuring stand
// needed it; the printed snippet stays as the fallback for a machine without
// Chrome, and it is the same string either way, so before and after are
// provably the same measurement.
//
// The page is served with every <script src> stripped, so nothing but the CSS
// cascade decides the numbers — no auth flow, no fetch, no app state. See
// scripts/static-page-server.js, and scripts/measure-mobile.js for the same
// page measured from the other end.

const fs = require('fs');
const path = require('path');
const { ROOT, build, serve } = require('./static-page-server.js');

const FIXTURE = path.join(ROOT, 'test', 'desktop-baseline.json');
const PORT = Number(process.env.BASELINE_PORT || 8901);
const WIDTH = 1440;

// Paste this into the browser console on the served page. Kept here rather than
// in a comment so "before" and "after" are provably the same measurement.
const SNIPPET = `(function(){
  var SEL = ['body','.main','.card','.sec','.btn','.btn.btn-sm','.btn-xs','.stab','.stabs','.sb-btn','.sb-group-label','table','th','td','.modal','.modal h3','.modal p','.bottom-nav-btn','.wk-tile','.wk-tile-t','.wk-tile-when','.wk-head','.mobile-topbar','.sidebar','.chip','.sb-header','.scan-tab','input','select','textarea'];
  var PROPS = ['fontSize','lineHeight','paddingTop','paddingRight','paddingBottom','paddingLeft','minHeight','minWidth','borderRadius','marginBottom','fontWeight','gap'];
  var styles = {};
  SEL.forEach(function(s){
    var el = document.querySelector(s); if (!el) return;
    var cs = getComputedStyle(el), o = {};
    PROPS.forEach(function(p){ o[p] = cs[p]; });
    styles[s] = o;
  });
  fetch('/', { method: 'POST', body: JSON.stringify({ viewport: innerWidth, styles: styles }, null, 2) });
})();`;

function diff(before, after) {
  const rows = [];
  for (const sel of Object.keys(before.styles)) {
    const a = before.styles[sel];
    const b = after.styles[sel];
    if (!b) {
      rows.push(`${sel} — GONE (selector no longer matches anything)`);
      continue;
    }
    for (const prop of Object.keys(a)) {
      if (a[prop] !== b[prop]) rows.push(`${sel} { ${prop}: ${a[prop]} -> ${b[prop]} }`);
    }
  }
  return rows;
}

const compare = process.argv.includes('--compare');

serve(
  build(),
  (captured) => {
    if (captured.viewport !== WIDTH) {
      console.error(`\n✗ captured at ${captured.viewport}px, expected ${WIDTH}px — resize the window and retry.`);
      process.exit(1);
    }
    if (!compare) {
      const readme =
        'Computed desktop styles at 1440px with a fine pointer that hovers. Regenerate with ' +
        'scripts/capture-desktop-baseline.js and diff to prove the desktop did not move. ' +
        'See MOBILE_REDESIGN.md section 8. Recaptured 2026-08-22 for package P1 (darstellung/PLAN.md): ' +
        'six selectors gained min-height 24px on the desk, .btn .btn.btn-sm .btn-xs .stab .sb-btn ' +
        '.scan-tab, because the desktop half of the token layer had no floor of its own and 24px is ' +
        'WCAG 2.5.8 level AA, which knows nothing about input devices. minWidth joined the captured ' +
        'properties in the same pass: a tap target has two measurements.';
      fs.writeFileSync(FIXTURE, JSON.stringify({ _readme: readme, ...captured }, null, 2) + '\n');
      console.log(`\n✓ wrote ${path.relative(ROOT, FIXTURE)} — ${Object.keys(captured.styles).length} selectors`);
      return;
    }
    const rows = diff(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')), captured);
    if (!rows.length) {
      console.log(`\n✓ desktop unchanged — ${Object.keys(captured.styles).length} selectors match the fixture`);
      return;
    }
    console.error(`\n✗ desktop moved in ${rows.length} place(s):\n`);
    rows.forEach((r) => console.error('  ' + r));
    process.exit(1);
  },
  PORT
);

// The browser, if there is one. Nothing about the measurement changes: the same
// SNIPPET runs, and it POSTs back to the same handler the console paste would.
async function selberFahren(port) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    return false;
  }
  const CHROME =
    process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(CHROME)) return false;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--no-sandbox', '--hide-scrollbars']
  });
  try {
    const page = await browser.newPage();
    // Size first, then load — a resize after loading can leave stale computed
    // styles, and that reported .sb-btn as "moved" three times during Phase 0.
    await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: 1 });
    // The desk is a fine pointer that hovers. Without this the emulator's
    // defaults decide which half of the token layer applies, and the fixture
    // would be a coarse-pointer capture wearing a desktop label.
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-color-scheme', value: 'light' },
        { name: 'pointer', value: 'fine' },
        { name: 'any-pointer', value: 'fine' },
        { name: 'hover', value: 'hover' },
        { name: 'any-hover', value: 'hover' }
      ]
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
    await page.evaluate(SNIPPET);
    // The POST is what finishes the run; give it a moment to arrive.
    await new Promise((ok) => setTimeout(ok, 400));
  } finally {
    await browser.close();
  }
  return true;
}

selberFahren(PORT).then((gefahren) => {
  if (gefahren) return;
  console.log(`\nServing on http://127.0.0.1:${PORT}/index.html`);
// Size first, then load. Resizing a page that is already open can leave
// elements holding computed styles from the old width — during Phase 0 that
// reported .sb-btn as "moved" three separate times when it had not.
console.log(`Size the viewport to exactly ${WIDTH}px wide FIRST, then open it (a resize after`);
console.log(`loading can leave stale computed styles), and run this in the console:\n`);
console.log(SNIPPET);
  console.log(`\nWaiting for the capture${compare ? ' (compare mode)' : ''}…`);
});
