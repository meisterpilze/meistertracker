// One-shot i18n audit for the locale files in lang/.
// Parses each window.LANG['<code>'] = { ... } block, extracts every key,
// then cross-checks against all t()/tp()/data-i18n* references across the repo.
// Output: a single markdown-ish report to stdout.
//
// Note on dynamic keys: this audit only catches STATIC string-literal references.
// Code that builds keys at runtime (e.g. `t(KNOWN_ZONE_I18N[id])` or
// `t('foo.' + variant)`) shows the literal value — for instance `dash.zoneSpawn`
// in `KNOWN_ZONE_I18N` — as a normal string in the source, so we still catch it
// as a reference. Genuinely dynamic concatenation (`'foo.' + x`) cannot be
// statically resolved and may cause false orphan reports.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LANG_DIR = path.join(ROOT, 'lang');

// ---------- 1. Parse a lang/<code>.js file ----------
function parseLocaleFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  // Block starts at `window.LANG['<code>'] = {`
  const start = lines.findIndex((l) => /^window\.LANG\[['"][a-z]+['"]\]\s*=\s*\{/.test(l));
  if (start < 0) return { keys: new Map(), start: -1, end: -1 };
  let depth = 0;
  let end = -1;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end >= 0) break;
  }
  const keys = new Map(); // key -> { value, line }
  // Match: 'key': 'value' or "key": "value" — key may contain \uXXXX escapes which we decode.
  const re = /^\s*['"]((?:[^'"\\]|\\u[0-9a-fA-F]{4})+)['"]\s*:\s*(.+?),?\s*$/;
  const decode = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  let pendingKey = null;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (pendingKey !== null) {
      // Previous line was `'key':` with the value wrapped onto this line.
      keys.set(pendingKey, { value: line.trim().replace(/,\s*$/, ''), line: i + 1 });
      pendingKey = null;
      continue;
    }
    const m = line.match(re);
    if (m && !m[2].startsWith('{')) {
      keys.set(decode(m[1]), { value: m[2], line: i + 1 });
    } else {
      // Two-line case: `'key':` on its own line, value on the next.
      const m2 = line.match(/^\s*['"]((?:[^'"\\]|\\u[0-9a-fA-F]{4})+)['"]\s*:\s*$/);
      if (m2) pendingKey = decode(m2[1]);
    }
  }
  return { keys, start: start + 1, end: end + 1, file: path.basename(file) };
}

const en = parseLocaleFile(path.join(LANG_DIR, 'en.js'));
const de = parseLocaleFile(path.join(LANG_DIR, 'de.js'));
const pt = parseLocaleFile(path.join(LANG_DIR, 'pt.js'));

// ---------- 2. Coverage matrix ----------
const allKeys = new Set([...en.keys.keys(), ...de.keys.keys(), ...pt.keys.keys()]);
const missing = { en: [], de: [], pt: [] };
for (const k of allKeys) {
  if (!en.keys.has(k)) missing.en.push(k);
  if (!de.keys.has(k)) missing.de.push(k);
  if (!pt.keys.has(k)) missing.pt.push(k);
}

// ---------- 3. Collect references ----------
const files = ['app.js', 'index.html', 'login.html', 'login.js', 'sw.js']
  .map((f) => path.join(ROOT, f))
  .filter(fs.existsSync);

const refs = new Map(); // key -> [{file, line}]
const refRegexes = [
  // t('key'), t("key"), t(`key`) — with negative lookbehind so tp( and other names don't match
  /(?<![\w$])t\(\s*['"`]([^'"`]+)['"`]/g,
  // data-i18n="key", data-i18n-placeholder="key", etc.
  /data-i18n(?:-placeholder|-title|-html|-aria-label)?\s*=\s*['"]([^'"]+)['"]/g,
  // setAttribute('data-i18n…', 'key')
  /setAttribute\(\s*['"]data-i18n(?:-placeholder|-title|-html|-aria-label)?['"]\s*,\s*['"]([^'"]+)['"]/g,
  // dataset.i18n = 'key', dataset.i18nPlaceholder = 'key', etc.
  /dataset\.i18n(?:Placeholder|Title|Html|AriaLabel)?\s*=\s*['"`]([^'"`]+)['"`]/g
];
const tpCalls = new Map(); // key (without .one/.other) -> [{file, line}]

// String-literals shaped like an i18n key (foo.bar) — used for objects that
// hold key names as values, e.g. `KNOWN_ZONE_I18N = { SPAWN: 'dash.zoneSpawn' }`.
// Conservative: only flag literals that begin with a known top-level prefix,
// to avoid catching filenames or arbitrary dotted strings.
const KEY_PREFIXES = new Set();
for (const k of allKeys) {
  const top = k.split('.')[0];
  if (top) KEY_PREFIXES.add(top);
}
const literalKeyRe = /['"`]([a-z][a-zA-Z0-9_]*\.[a-zA-Z][a-zA-Z0-9_.]*)['"`]/g;

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const flines = text.split('\n');
  for (let i = 0; i < flines.length; i++) {
    const line = flines[i];
    for (const re of refRegexes) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const key = m[1];
        // Skip concatenation prefixes: t('foo.' + variant) — the regex captures
        // `foo.` as the first arg, but the real key is built at runtime.
        const tail = line.slice(m.index + m[0].length).trimStart();
        if (tail.startsWith('+')) continue;
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
    // Bare-literal references: flag any string literal `'foo.bar'` whose
    // top-level prefix matches an existing locale key namespace. Catches
    // dynamic-dispatch tables (KNOWN_ZONE_I18N, ROLE_LABELS, PRINTER_STATUS_STYLES…).
    literalKeyRe.lastIndex = 0;
    let lm;
    while ((lm = literalKeyRe.exec(line)) !== null) {
      const key = lm[1];
      // Drop trailing-dot fragments like 'contam.res.' — these are concat prefixes, not keys
      if (key.endsWith('.')) continue;
      const top = key.split('.')[0];
      if (!KEY_PREFIXES.has(top)) continue;
      // Skip filenames / mime-y suffixes
      if (/\.(js|css|html|json|png|svg|ico|webm|enc|zpl)$/.test(key)) continue;
      // Skip concatenation prefixes followed by `+`
      const ltail = line.slice(lm.index + lm[0].length).trimStart();
      if (ltail.startsWith('+')) continue;
      if (!refs.has(key)) refs.set(key, []);
      const locs = refs.get(key);
      // Avoid double-counting if already added by a t()/data-i18n match on the same line
      if (!locs.some((l) => l.file === path.basename(f) && l.line === i + 1)) {
        locs.push({ file: path.basename(f), line: i + 1 });
      }
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
  if (en.keys.has(k)) continue;
  // Skip tp() base names — these are referenced as bare keys but resolve to .one/.other
  if (tpCalls.has(k) && (en.keys.has(k + '.one') || en.keys.has(k + '.other'))) continue;
  // Skip concatenation prefixes — `t('contam.' + sev)` captures `contam.` as the
  // literal first arg, but the actual key is built dynamically and can't be
  // verified statically.
  if (k.endsWith('.')) continue;
  unknown.push({ key: k, locs });
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
    const missingPh = [...pEn].filter((x) => !pOther.has(x));
    const extraPh = [...pOther].filter((x) => !pEn.has(x));
    if (missingPh.length || extraPh.length) {
      interpIssues.push({ key: k, locale: loc, missing: missingPh, extra: extraPh });
    }
  }
}

// ---------- Report ----------
function section(title) {
  console.log('\n## ' + title + '\n');
}
console.log('# i18n audit report');
console.log(`\nLANG.en: ${en.keys.size} keys | LANG.de: ${de.keys.size} keys | LANG.pt: ${pt.keys.size} keys`);
console.log(`Total distinct keys: ${allKeys.size}`);

section('1. Coverage matrix — missing keys');
for (const loc of ['en', 'de', 'pt']) {
  console.log(`\n### Missing from ${loc.toUpperCase()} (${missing[loc].length})`);
  if (missing[loc].length === 0) {
    console.log('  (none)');
    continue;
  }
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
