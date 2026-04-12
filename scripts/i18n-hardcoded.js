// Scan index.html and app.js for likely user-facing strings that bypass t().
// This is a heuristic scanner: aims for high-signal hits, tolerates some false positives.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const findings = [];
function add(file, line, kind, text, hint) {
  findings.push({ file, line, kind, text, hint: hint || '' });
}

// ---------- index.html ----------
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').split('\n');
// Tags that commonly hold visible text
const TEXT_TAGS = ['button', 'label', 'option', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                   'legend', 'summary', 'caption', 'figcaption', 'a', 'span', 'div', 'p', 'li', 'strong', 'em', 'small'];

// crude single-line tag+text scanner: <tag ...>text</tag>
const openClose = new RegExp(
  '<(' + TEXT_TAGS.join('|') + ')([^>]*)>([^<]+)<\\/\\1>',
  'gi'
);

function hasI18nAttr(attrs) {
  return /\bdata-i18n(?:-placeholder|-title|-html|-aria-label)?\s*=/.test(attrs);
}
function textLooksLikeUi(t) {
  const trimmed = t.trim();
  if (!trimmed) return false;
  if (trimmed.length < 2) return false;
  // ignore numbers, punctuation, icons, variables
  if (/^[\d\s\.,:;—\-\+\*\/\\\|\(\)\[\]\{\}#&•·✔✖→←↑↓×●○\?\!%]+$/.test(trimmed)) return false;
  // ignore pure HTML entity references (&mdash; etc.)
  if (/^&[a-z#0-9]+;$/.test(trimmed)) return false;
  // ignore pure placeholders like {value}
  if (/^\{[^}]+\}$/.test(trimmed)) return false;
  // need at least one letter
  if (!/[a-zA-ZäöüÄÖÜßáéíóúãõàâêôç]/.test(trimmed)) return false;
  // single-word ALL_CAPS or short uppercase tokens (scan commands, locale codes)
  if (/^[A-Z_]{1,12}$/.test(trimmed)) return false;
  // single short word with no spaces — likely a code, unit, class, or identifier
  if (!/[\s:!?.,;—]/.test(trimmed) && trimmed.length < 12) return false;
  return true;
}

// Attribute-only scan for placeholder / title / aria-label / alt without data-i18n*.
// Negative lookbehind skips data-i18n-placeholder=, data-i18n-title=, data-i18n-aria-label=, etc.
const attrRe = /(?<!data-i18n-)\b(placeholder|title|aria-label|alt)\s*=\s*"([^"]+)"/g;

// Build a set of line numbers that are "inside a data-i18n-html block"
// so child tags within those blocks don't trigger false positives.
const inI18nHtmlLines = new Set();
{
  let depth = 0;
  for (let i = 0; i < html.length; i++) {
    const line = html[i];
    const openI18nHtml = /data-i18n-html\s*=/.test(line);
    if (openI18nHtml) depth++;
    if (depth > 0) inI18nHtmlLines.add(i);
    // crude close detection: count open vs close tags on the line
    const opens = (line.match(/<[a-zA-Z]/g) || []).length;
    const closes = (line.match(/<\/[a-zA-Z]|\/>/g) || []).length;
    if (depth > 0 && !openI18nHtml) {
      depth = Math.max(0, depth - Math.max(0, closes - opens));
    }
  }
}

html.forEach((line, i) => {
  // Tag with text between open/close
  openClose.lastIndex = 0;
  let m;
  while ((m = openClose.exec(line)) !== null) {
    const [, tag, attrs, text] = m;
    if (hasI18nAttr(attrs)) continue;
    if (!textLooksLikeUi(text)) continue;
    // skip <script> and <style>
    if (/^(script|style)$/i.test(tag)) continue;
    // skip content already covered by an ancestor data-i18n-html
    if (inI18nHtmlLines.has(i) && !hasI18nAttr(attrs)) continue;
    // skip lines that are obvious template source like options being populated by JS with German default
    add('index.html', i + 1, 'tag-text', text.trim(), `<${tag}>`);
  }
  // attributes — only if the element on the same line has no corresponding data-i18n-* for that attr
  attrRe.lastIndex = 0;
  let am;
  while ((am = attrRe.exec(line)) !== null) {
    const [, attr, val] = am;
    if (!textLooksLikeUi(val)) continue;
    // ignore selectors like placeholder="..." for CSS?  no — these are HTML attrs
    // Skip if a data-i18n-* covers it on the same line
    if (attr === 'placeholder' && /data-i18n-placeholder\s*=/.test(line)) continue;
    if (attr === 'title' && /data-i18n-title\s*=/.test(line)) continue;
    if (attr === 'aria-label' && /data-i18n-aria-label\s*=/.test(line)) continue;
    add('index.html', i + 1, `attr:${attr}`, val, '');
  }
});

// ---------- app.js ----------
// We scan only outside the LANG block (dynamically detected)
const appLines = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').split('\n');
const LANG_START = appLines.findIndex(l => /^const LANG\s*=\s*\{/.test(l));
let _langDepth = 0, LANG_END = appLines.length;
for (let _i = LANG_START; _i < appLines.length; _i++) {
  for (const ch of appLines[_i]) {
    if (ch === '{') _langDepth++;
    else if (ch === '}') { _langDepth--; if (_langDepth === 0) { LANG_END = _i; break; } }
  }
  if (LANG_END < appLines.length) break;
}

// Strings written into UI: .innerHTML, .textContent, .innerText, .placeholder, .title, .value
// AND alert/confirm/prompt/showToast/showModal/setError with string literal
const uiAssign = /\.(innerHTML|textContent|innerText|placeholder|title|value)\s*=\s*(['"`])([^'"`]+?)\2/g;
const uiCall = /\b(alert|confirm|prompt|showToast|toast|notify|showModal|setError)\s*\(\s*(['"`])([^'"`]+?)\2/g;
// innerHTML with template literals containing German/English sentences
const tplHtml = /\.(innerHTML|textContent|innerText)\s*=\s*`([^`]+)`/g;

function looksLikeUiText(s) {
  if (!s) return false;
  const t = s.trim();
  if (t.length < 3) return false;
  if (!/[a-zA-ZäöüÄÖÜßáéíóúãõàâêôç]/.test(t)) return false;
  // ignore CSS values, class lists, selectors, ids, event names, HTTP methods, URLs
  if (/^(GET|POST|PATCH|DELETE|PUT|OPTIONS)$/i.test(t)) return false;
  if (/^https?:\/\//.test(t)) return false;
  if (/^[a-z-]+$/i.test(t) && t.length < 15) return false; // likely class/id
  if (/^[#\.]/.test(t)) return false;
  // ignore single identifiers
  if (/^\w+$/.test(t)) return false;
  // must have space or punctuation — real sentence/phrase
  if (!/\s|[:!?.,;—]/.test(t)) return false;
  return true;
}

appLines.forEach((line, i) => {
  if (i >= LANG_START && i < LANG_END) return;
  // skip lines that already use t(
  const hasT = /\bt\(['"`]/.test(line) || /\btp\(['"`]/.test(line);

  let m;
  uiAssign.lastIndex = 0;
  while ((m = uiAssign.exec(line)) !== null) {
    if (hasT) continue;
    const [, prop, , val] = m;
    if (!looksLikeUiText(val)) continue;
    add('app.js', i + 1, `assign:${prop}`, val, '');
  }
  uiCall.lastIndex = 0;
  while ((m = uiCall.exec(line)) !== null) {
    if (hasT) continue;
    const [, fn, , val] = m;
    if (!looksLikeUiText(val)) continue;
    add('app.js', i + 1, `call:${fn}`, val, '');
  }
  tplHtml.lastIndex = 0;
  while ((m = tplHtml.exec(line)) !== null) {
    const [, prop, val] = m;
    // only complain about the static literal parts
    const staticParts = val.split(/\$\{[^}]+\}/);
    for (const sp of staticParts) {
      if (looksLikeUiText(sp) && !hasT) {
        add('app.js', i + 1, `tpl:${prop}`, sp.slice(0, 80), '');
        break;
      }
    }
  }
});

// ---------- Report ----------
const byFile = { 'index.html': [], 'app.js': [] };
for (const f of findings) byFile[f.file].push(f);

function dedupe(arr) {
  const seen = new Set();
  return arr.filter(x => {
    const k = x.file + '|' + x.line + '|' + x.kind + '|' + x.text;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

console.log('# Hard-coded user-facing string audit\n');
for (const f of ['index.html', 'app.js']) {
  const rows = dedupe(byFile[f]);
  console.log(`\n## ${f} — ${rows.length} hits\n`);
  for (const r of rows) {
    console.log(`  ${f}:${r.line}  [${r.kind}]  "${r.text}"`);
  }
}
