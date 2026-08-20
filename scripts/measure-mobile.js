// Measure the app at phone width and report everything still under the floors.
//
// The other half of scripts/capture-desktop-baseline.js. That one proves the
// desktop did not move; this one proves the phone actually moved — which until
// now nothing could. MOBILE_REDESIGN.md §8 called the phone side device-only,
// and for the app's *rendered* screens it still is. But the cascade is not
// device-only: served with every script stripped, index.html's own markup lays
// out under the real stylesheet, and a computed 10px is a computed 10px.
//
//   node scripts/measure-mobile.js            # 375px, the common phone
//   node scripts/measure-mobile.js 320        # the smallest one still sold
//
// What it cannot see, stated so the output is not read as more than it is:
// everything app.js renders at runtime — every table row, every list, every
// dialog body. Those are the ratchet's INLINE count and the device pass. What
// it does see is every rule in styles.css that index.html's markup can reach,
// which is the layer the token work is actually editing.
//
// OVERFLOW is the third thing every phase promises and none of them measured:
// "no horizontal scroll". It is reported as the elements whose right edge is
// past the viewport, minus anything sitting inside a container that scrolls
// sideways on purpose — a wide table in an overflow-x wrapper is the fix, not
// the defect, and counting it would bury the real ones.
//
// It is measured one page at a time, and that is not tidiness. Revealing every
// page at once — which the two floors below need, since a hidden element has
// no height — stacks fourteen screens into one document and the widths stop
// being the widths a user gets. Measured that way the bottom nav reported five
// buttons overflowing by 93px; measured a page at a time it is 375px wide with
// its last button ending at 375. The first version of this file believed the
// first number.
//
// TYPE is one floor, read from :root rather than restated: computed font-size
// below --fs-xs, on elements that carry their own text.
//
// TOUCH is two, and conflating them makes the report lie. --tap-min (56px) is
// the *Feld* floor, chosen for a gloved hand; --tap-sm (48px) is the Büro one,
// and §9 of MOBILE_REDESIGN.md picked both deliberately. Measuring everything
// against 56 reports 76 sidebar buttons sitting exactly on their intended 48px
// as failures, which trains you to ignore the output. So the gate is the
// universal minimum every guideline agrees on — 44px, WCAG 2.5.5 AA at 24px,
// AAA and Apple's HIG at 44, Material at 48dp — and the gap between that and
// the Feld floor is reported separately, because whether it matters depends on
// which kind of screen the control is on.

const { build, serve } = require('./static-page-server.js');
const { floor, tapFloor } = require('./mobile-size-scan.js');

const WIDTH = Number(process.argv.find((a) => /^\d+$/.test(a)) || 375);
const PORT = Number(process.env.MEASURE_PORT || 8902);
const TYPE_FLOOR = floor();
const TOUCH_FELD = tapFloor();
// Not a token, because it is not this app's decision — it is the floor below
// which a control is too small on any device, for anyone. Kept separate from
// --tap-min so that lowering the Feld floor could never lower this.
const TOUCH_MIN = 44;

// Every page and sub-panel is display:none except the one that opens, and the
// dialogs are hidden too. Revealing them is the whole trick: computed styles
// resolve for hidden elements, but a *height* does not, and the touch floor is
// a height. Stacking them changes what the page looks like and not what any
// element computes to, because width — the only thing the cascade keys on — is
// unchanged.
const SNIPPET = (typeFloor, touchFloor) => `(function(){
  var reveal = document.createElement('style');
  reveal.textContent = '.page,.sp,.modal-bg,details>*{display:block !important}.modal-bg{position:static !important}';
  document.head.appendChild(reveal);
  var TOUCH = 'button,.btn,input,select,textarea,summary,[role="button"],.stab,.sb-btn,.chip,.bottom-nav-btn,a[onclick],[onclick]';
  var where = function(el){
    var p = el.tagName.toLowerCase();
    if (el.id) p += '#' + el.id;
    else if (el.className && typeof el.className === 'string' && el.className.trim()) p += '.' + el.className.trim().split(/\\s+/)[0];
    var page = el.closest('.page');
    return (page && page.id ? page.id + ' ' : '') + p;
  };
  var ownText = function(el){
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) return n.nodeValue.trim();
    return '';
  };
  // An ancestor that scrolls sideways on purpose absorbs its children's width.
  // Without this every cell of every wide table reports separately and the
  // list is thousands long, all of it describing one wrapper working correctly.
  var scrolls = function(el){
    for (var a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      var ox = getComputedStyle(a).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
    }
    return false;
  };
  var type = [], touch = [], over = [], hidden = 0;
  var vw = document.documentElement.clientWidth;
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.closest('#login-screen,noscript,template')) continue;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') { hidden++; continue; }
    var fs = parseFloat(cs.fontSize);
    var txt = ownText(el);
    if (txt && fs < ${typeFloor}) type.push({ at: where(el), px: fs, text: txt.slice(0, 40) });
    var rect = el.getBoundingClientRect();
    if (el.matches(TOUCH)) {
      if (rect.height > 0 && rect.height < ${touchFloor}) touch.push({ at: where(el), px: Math.round(rect.height * 10) / 10, text: (el.value || txt || el.getAttribute('placeholder') || '').slice(0, 40) });
    }
  }
  reveal.remove();
  // Second pass: one page shown at a time, its own sub-panels opened, exactly
  // as a user meets it. 1px of slack, because sub-pixel layout routinely lands
  // a full-width box at 375.004 and a report full of those is a report nobody
  // reads.
  var pages = [...document.querySelectorAll('.page')];
  var wasPage = pages.map(function(p){ return p.style.display; });
  var widest = 0;
  pages.forEach(function(page){
    pages.forEach(function(p){ p.style.display = 'none'; });
    page.style.display = 'block';
    var sps = [...page.querySelectorAll('.sp')];
    var wasSp = sps.map(function(x){ return x.style.display; });
    sps.forEach(function(x){ x.style.display = 'block'; });
    var pvw = document.documentElement.clientWidth;
    widest = Math.max(widest, document.documentElement.scrollWidth);
    [...page.querySelectorAll('*')].forEach(function(el){
      var c = getComputedStyle(el);
      if (c.display === 'none' || c.visibility === 'hidden' || c.position === 'fixed') return;
      var r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > pvw + 1 && !scrolls(el)) {
        over.push({ at: (page.id ? page.id + ' ' : '') + where(el), px: Math.round(r.right - pvw), text: ownText(el).slice(0, 40) });
      }
    });
    sps.forEach(function(x, j){ x.style.display = wasSp[j]; });
  });
  pages.forEach(function(p, j){ p.style.display = wasPage[j]; });
  fetch('/', { method: 'POST', body: JSON.stringify({ viewport: innerWidth, type: type, touch: touch, over: over, hidden: hidden, scanned: all.length, pageWidth: widest }) });
})();`;

// Grouped by value, smallest first: seventy-six rows at exactly 48px are one
// decision, not seventy-six findings, and a flat list buries that.
function group(rows) {
  const byPx = new Map();
  for (const r of rows) {
    if (!byPx.has(r.px)) byPx.set(r.px, []);
    byPx.get(r.px).push(r);
  }
  for (const px of [...byPx.keys()].sort((a, b) => a - b)) {
    const g = byPx.get(px);
    console.log(`\n  ${px}px — ${g.length}`);
    g.forEach((r) => console.log(`    ${r.at}${r.text ? '  "' + r.text + '"' : ''}`));
  }
}

function report(label, rows, floorPx) {
  if (!rows.length) {
    console.log(`\n✓ ${label}: nothing under ${floorPx}px`);
    return 0;
  }
  console.log(`\n✗ ${label}: ${rows.length} under ${floorPx}px`);
  group(rows);
  return rows.length;
}

serve(
  build(),
  (m) => {
    if (m.viewport !== WIDTH) {
      console.error(`\n✗ captured at ${m.viewport}px, expected ${WIDTH}px — resize the window and retry.`);
      process.exit(1);
    }
    console.log(`\nMeasured at ${m.viewport}px — ${m.scanned} elements, ${m.hidden} still hidden.`);
    const tooSmall = m.touch.filter((r) => r.px < TOUCH_MIN);
    const belowFeld = m.touch.filter((r) => r.px >= TOUCH_MIN);
    let bad = report('TYPE', m.type, TYPE_FLOOR) + report('TOUCH', tooSmall, TOUCH_MIN);
    const over = m.over || [];
    if (over.length) {
      // Only the outermost offender per branch: a div 40px too wide reports its
      // heading, its text and its buttons too, and they are all the one fix.
      const outer = over.filter((r, i) => !over.some((o, j) => j !== i && r.at.startsWith(o.at + ' ')));
      console.log(`\n✗ OVERFLOW: widest page is ${m.pageWidth}px at ${m.viewport}px — ${over.length} element(s) past the edge`);
      group(outer.length ? outer : over);
      bad += over.length;
    } else {
      console.log(`\n✓ OVERFLOW: nothing past the edge — no page is wider than ${m.viewport}px`);
    }
    if (belowFeld.length) {
      // Reported, never counted. A Büro control at 48px is where §9 put it.
      console.log(`\n· ${belowFeld.length} more between ${TOUCH_MIN}px and the ${TOUCH_FELD}px Feld floor —`);
      console.log(`  correct on a Büro screen, too small on one used with gloves.`);
      group(belowFeld);
    }
    console.log(
      bad
        ? `\n${bad} under the floor. This is index.html's markup only — what app.js renders is the ratchet's INLINE count.`
        : `\nBoth floors hold for every element index.html renders at ${WIDTH}px.`
    );
    process.exit(bad ? 1 : 0);
  },
  PORT
);

console.log(`\nServing on http://127.0.0.1:${PORT}/index.html`);
console.log(`Size the viewport to exactly ${WIDTH}px wide FIRST, then open it, and run:\n`);
console.log(SNIPPET(TYPE_FLOOR, TOUCH_FELD));
console.log(`\nWaiting for the measurement…`);
