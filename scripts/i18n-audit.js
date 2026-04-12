// One-shot i18n audit for app.js.
// Parses the LANG object literal, extracts every key per locale, then cross-checks
// against all t()/tp()/data-i18n* references across the repo.
// Output: a single markdown-ish report to stdout.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(ROOT, 'app.js');
const src = fs.readFileSync(APP_JS, 'utf8');
const lines = src.split('\n');

// ---------- 1. Parse LANG object ----------
// Locale blocks start at `  en: {`, `  de: {`, `  pt: {`
function localeBlock(locale) {
  const start = lines.findIndex(l => new RegExp('^\\s{2}' + locale + ':\\s*\\{').test(l));
  if (start < 0) return { keys: new Map(), start: -1, end: -1 };
  let depth = 0;
  let end = -1;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end >= 0) break;
  }
  const keys = new Map(); // key -> { value, line }
  // Match: 'key': 'value' or "key": "value" — key may contain \uXXXX escapes which we decode.
  const re = /^\s*['"]((?:[^'"\\]|\\u[0-9a-fA-F]{4})+)['"]\s*:\s*(.+?),?\s*$/;
  const decode = s => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(re);
    if (m && !m[2].startsWith('{')) {
      keys.set(decode(m[1]), { value: m[2], line: i + 1 });
    }
  }
  return { keys, start: start + 1, end: end + 1 };
}

const en = localeBlock('en');
const de = localeBlock('de');
const pt = localeBlock('pt');

// ---------- 2. Coverage matrix ----------
const allKeys = new Set([...en.keys.keys(), ...de.keys.keys(), ...pt.keys.keys()]);
const missing = { en: [], de: [], pt: [] };
for (const k of allKeys) {
  if (!en.keys.has(k)) missing.en.push(k);
  if (!de.keys.has(k)) missing.de.push(k);
  if (!pt.keys.has(k)) missing.pt.push(k);
}

// ---------- 3. Collect references ----------
const files = [
  'app.js', 'index.html', 'login.html', 'login.js', 'sw.js'
].map(f => path.join(ROOT, f)).filter(fs.existsSync);

const refs = new Map(); // key -> [{file, line}]
// tp() base keys are handled separately via tpCalls; use lookbehind so `tp(` doesn't match the t() regex.
const refRegexes = [
  /(?<![\w$])t\(\s*['"`]([^'"`]+)['"`]/g,
  /data-i18n(?:-placeholder|-title|-html|-aria-label)?\s*=\s*['"]([^'"]+)['"]/g,
  /setAttribute\(\s*['"]data-i18n(?:-placeholder|-title|-html|-aria-label)?['"]\s*,\s*['"]([^'"]+)['"]/g,
  /dataset\.i18n(?:Placeholder|Title|Html|AriaLabel)?\s*=\s*['"`]([^'"`]+)['"`]/g,
];
const tpCalls = new Map(); // key (without .one/.other) -> [{file, line}]

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const flines = text.split('\n');
  for (let i = 0; i < flines.length; i++) {
    const line = flines[i];
    // Skip LANG object definition lines in app.js
    if (f === APP_JS && i + 1 >= en.start && i + 1 <= pt.end) continue;
    for (const re of refRegexes) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const key = m[1];
        if (!refs.has(key)) refs.set(key, []);
        refs.get(key).push({ file: path.basename(f), line: i + 1 });
      }
    }
    // tp() calls separately — we verify .one/.other later
    const tpRe = /\btp\(\s*['"`]([^'"`]+)['"`]/g;
    let tm;
    while ((tm = tpRe.exec(line)) !== null) {
      const k = tm[1];
      if (!tpCalls.has(k)) tpCalls.set(k, []);
      tpCalls.get(k).push({ file: path.basename(f), line: i + 1 });
    }
  }
}

// ---------- 4. Orphan keys: in LANG.en but never referenced ----------
const orphans = [];
for (const k of en.keys.keys()) {
  // plural keys are referenced as bare key via tp(); check .one/.other specially
  if (k.endsWith('.one') || k.endsWith('.other')) {
    const base = k.replace(/\.(one|other)$/, '');
    if (!tpCalls.has(base) && !refs.has(k)) orphans.push(k);
    continue;
  }
  if (!refs.has(k)) orphans.push(k);
}

// ---------- 5. Unknown keys: referenced but not in LANG.en ----------
const unknown = [];
for (const [k, locs] of refs.entries()) {
  if (!en.keys.has(k)) unknown.push({ key: k, locs });
}
// tp() base keys — verify .one and .other exist
const pluralIssues = [];
for (const [k, locs] of tpCalls.entries()) {
  for (const loc of ['en', 'de', 'pt']) {
    const set = { en: en.keys, de: de.keys, pt: pt.keys }[loc];
    if (!set.has(k + '.one')) pluralIssues.push({ key: k + '.one', locale: loc, locs });
    if (!set.has(k + '.other')) pluralIssues.push({ key: k + '.other', locale: loc, locs });
  }
}

// ---------- 6. Interpolation mismatches ----------
function placeholders(v) {
  const out = new Set();
  if (!v) return out;
  const re = /\{(\w+)\}/g;
  let m;
  while ((m = re.exec(v)) !== null) out.add(m[1]);
  return out;
}
const interpIssues = [];
for (const k of en.keys.keys()) {
  const pEn = placeholders(en.keys.get(k).value);
  if (pEn.size === 0) continue;
  for (const loc of ['de', 'pt']) {
    const set = { de: de.keys, pt: pt.keys }[loc];
    if (!set.has(k)) continue;
    const pOther = placeholders(set.get(k).value);
    const missingPh = [...pEn].filter(x => !pOther.has(x));
    const extraPh = [...pOther].filter(x => !pEn.has(x));
    if (missingPh.length || extraPh.length) {
      interpIssues.push({ key: k, locale: loc, missing: missingPh, extra: extraPh });
    }
  }
}

// ---------- Report ----------
function section(title) { console.log('\n## ' + title + '\n'); }
console.log('# i18n audit report');
console.log(`\nLANG.en: ${en.keys.size} keys | LANG.de: ${de.keys.size} keys | LANG.pt: ${pt.keys.size} keys`);
console.log(`Total distinct keys: ${allKeys.size}`);

section('1. Coverage matrix — missing keys');
for (const loc of ['en', 'de', 'pt']) {
  console.log(`\n### Missing from ${loc.toUpperCase()} (${missing[loc].length})`);
  if (missing[loc].length === 0) { console.log('  (none)'); continue; }
  for (const k of missing[loc].sort()) {
    const source = en.keys.get(k) || de.keys.get(k) || pt.keys.get(k);
    console.log(`  - ${k}  →  ${source.value}`);
  }
}

section(`2. Orphan keys (defined in LANG.en, zero references) — ${orphans.length}`);
for (const k of orphans.sort()) console.log(`  - ${k}`);

section(`3. Unknown keys (referenced, not in LANG.en) — ${unknown.length}`);
for (const { key, locs } of unknown.sort((a, b) => a.key.localeCompare(b.key))) {
  console.log(`  - ${key}`);
  for (const l of locs.slice(0, 3)) console.log(`      ${l.file}:${l.line}`);
}

section(`4. Plural pair issues (tp() base missing .one/.other) — ${pluralIssues.length}`);
for (const p of pluralIssues) {
  console.log(`  - [${p.locale}] ${p.key}  (used at ${p.locs[0].file}:${p.locs[0].line})`);
}

section(`5. Interpolation mismatches — ${interpIssues.length}`);
for (const i of interpIssues) {
  console.log(`  - [${i.locale}] ${i.key}  missing={${i.missing.join(',')}} extra={${i.extra.join(',')}}`);
}
