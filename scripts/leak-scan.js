'use strict';
// Find the address of a live instance before it becomes public.
//
// This exists because of a leak that no file scanner would have caught: the
// address of a live instance went public through pull request prose, while a
// pickaxe over the whole history finds it in no file at all. Prose is the
// surface that leaks, because prose is where you write down what you just
// tested against — `- [ ] Server: https://<the real host>` is an honest
// verification note and a published address at the same time.
//
// So the same matcher runs in four places: the commit-msg hook, the pre-push
// hook, CI over changed files, and a workflow over pull request titles, bodies
// and comments. One module, so the rules cannot drift apart.
//
// Two design rules that are easy to get wrong:
//
//   1. The rules are patterns, never a list of the real names. A denylist file
//      containing the actual hostname would publish the very thing it guards,
//      and this repository is public. `<label>.duckdns.org` is banned as a
//      shape, so the guard never has to know which label is ours.
//
//   2. Findings report a location, never the text that matched. Workflow logs
//      on a public repository are world-readable, so a guard that echoed its
//      match would leak on exactly the runs where it fired.
//
// Escape hatch: a line containing `leak-scan:allow` is skipped.

const ALLOW_MARKER = 'leak-scan' + ':allow';

// A whole file can opt out, which exactly one file needs to: the guard's own
// test fixtures are leak shapes by definition, and a scanner that trips over
// its own tests is a scanner someone switches off. Deliberately file-only —
// prose must not be able to wave the guard through, since prose is written by
// whoever opened the pull request.
const FILE_ALLOW_MARKER = 'leak-scan' + ':allow-file';

// Dynamic-DNS and tunnel suffixes. A bare suffix is fine — the app genuinely
// talks to duckdns.org, and `cfg.domain + '.duckdns.org'` must keep working.
// What is never fine is a concrete label in front of one.
const DYNAMIC_SUFFIXES = [
  'duckdns.org',
  'ddns.net',
  'no-ip.org',
  'no-ip.biz',
  'hopto.org',
  'zapto.org',
  'sytes.net',
  'serveo.net',
  'dynu.net',
  'freemyip.com',
  'loca.lt',
  'localtunnel.me',
  'pagekite.me',
  'ngrok.io',
  'ngrok.app',
  'ngrok-free.app',
  'trycloudflare.com',
  'ts.net',
  'tailscale.net'
];

// Labels that carry no information about a real instance. `www` is the DuckDNS
// API host itself; the rest are the placeholders this repository already uses
// in DEPLOYMENT.md and the gen-cert headers. Note that the angle-bracket form
// `<your-name>.duckdns.org` needs no entry here: `>` cannot be part of a label,
// so the pattern does not match it in the first place.
const GENERIC_LABELS = new Set([
  'www',
  'example',
  'example.com',
  'host',
  'hostname',
  'myhost',
  'yourhost',
  'my-host',
  'your-host',
  'yourname',
  'your-name',
  'yourdomain',
  'your-domain',
  'subdomain',
  'test',
  'demo'
]);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `(?:label\.)+` in front of the suffix. The leading class rejects a preceding
// dot, quote or `>` so that a bare `.duckdns.org` suffix — the concatenation
// form in server.js and the `<span>` in index.html — is not a match.
const DYNAMIC_HOST_RE = new RegExp(
  '(^|[^A-Za-z0-9.-])((?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+)(' +
    DYNAMIC_SUFFIXES.map(escapeRe).join('|') +
    ')(?![A-Za-z0-9.-])',
  'gi'
);

const IPV4_RE = /(^|[^0-9A-Za-z.:-])((?:\d{1,3}\.){3}\d{1,3})(?![0-9A-Za-z.-])/g;

// Credential shapes. The value has to be a long literal, so `token: cfg.token`
// and `password: form.value` stay quiet.
const CREDENTIAL_RE =
  /\b[A-Za-z0-9_]*(?:token|secret|passwd|password|api[_-]?key|apikey|authorization|bearer)\b\s*[=:]\s*(?:bearer\s+|basic\s+|token\s+)?['"`]?([A-Za-z0-9_\-+/]{16,})/gi;

const CREDENTIAL_PLACEHOLDERS =
  /^(?:x{4,}|y{4,}|0{4,}|1{4,}|changeme|redacted|placeholder|your[_-]?\w*|my[_-]?\w*|some[_-]?\w*|example\w*|dummy\w*|sample\w*|test\w*|fake\w*|abcdef\w*|deadbeef\w*)$/i;

function octets(ip) {
  const parts = ip.split('.').map((n) => Number(n));
  return parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

// Everything reserved, documented or otherwise unroutable is uninteresting.
// What is left is an address that points at a real machine somewhere.
function isPublicIpv4(ip) {
  const p = octets(ip);
  if (!p) return false;
  const [a, b] = p;
  if (a === 0 || a === 127 || a >= 224) return false; // this-host, loopback, multicast/reserved
  if (a === 10) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false; // link-local
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT, incl. Tailscale
  if (a === 192 && b === 0 && p[2] <= 2) return false; // IETF protocol assignments + TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && p[2] === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && p[2] === 113) return false; // TEST-NET-3
  return true;
}

function isPrivateIpv4(ip) {
  const p = octets(ip);
  if (!p) return false;
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

// An IPv4-shaped run of digits is not automatically an address. Version quads
// (`Chrome/126.0.0.0`), X.509 object identifiers (`2.5.29.17={text}`) and RFC
// section references (`RFC 5545 §3.8.7.4`) share the shape exactly, and all
// three occur in this repository. The surrounding punctuation is what tells
// them apart, with one exception worth stating: a slash in front means "path
// segment" only when it is a lone slash, because `https://` is two of them and
// that form is the one that actually leaks.
function looksLikeAddress(line, matchIndex, pre, ip) {
  const start = matchIndex + pre.length;
  const before = matchIndex > 0 ? line[matchIndex - 1] : '';
  const after = line[start + ip.length] || '';
  if (pre === 'v' || pre === 'V' || pre === '@' || pre === '§') return false;
  if (pre === '/' && before !== '/') return false;
  if (after === '=') return false;
  return true;
}

// Distinguish a secret from a reference to one. `token: PRINT_BRIDGE_TOKEN_ENV`
// is a constant and `password = generateCaldavAppPassword()` is a call; neither
// is a value anyone can use. Real credentials mix letters and digits.
function looksLikeSecret(value, after) {
  if (CREDENTIAL_PLACEHOLDERS.test(value)) return false;
  if (after === '(') return false;
  if (/^[A-Z][A-Z0-9_]*$/.test(value)) return false;
  if (/[0-9]/.test(value) && /[A-Za-z]/.test(value)) return true;
  return value.length >= 32 && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

const RULES = {
  'dynamic-host': 'a concrete host under a dynamic-DNS or tunnel domain',
  'public-ip': 'a routable IPv4 address',
  'private-ip': 'an internal LAN address',
  credential: 'something shaped like a token, key or password'
};

/**
 * Scan text and return findings. A finding never carries the matched text.
 *
 * @param {string} text
 * @param {{ label?: string, surface?: 'prose'|'file' }} [opts]
 *        `surface: 'prose'` additionally flags LAN addresses, which have no
 *        business in a commit message or a pull request body but appear
 *        legitimately in the deployment docs.
 * @returns {Array<{rule: string, line: number, column: number, label: string, why: string}>}
 */
function scan(text, opts) {
  const options = opts || {};
  const label = options.label || 'input';
  const prose = options.surface === 'prose';
  const findings = [];
  if (typeof text !== 'string' || text === '') return findings;

  if (!prose && text.includes(FILE_ALLOW_MARKER)) return findings;

  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    const at = (index, rule) =>
      findings.push({
        rule,
        line: i + 1,
        column: index + 1,
        label,
        why: RULES[rule]
      });

    DYNAMIC_HOST_RE.lastIndex = 0;
    let m;
    while ((m = DYNAMIC_HOST_RE.exec(line)) !== null) {
      const host = m[2].slice(0, -1).toLowerCase(); // labels without the trailing dot
      if (!GENERIC_LABELS.has(host)) at(m.index + m[1].length, 'dynamic-host');
    }

    IPV4_RE.lastIndex = 0;
    while ((m = IPV4_RE.exec(line)) !== null) {
      const ip = m[2];
      if (!looksLikeAddress(line, m.index, m[1], ip)) continue;
      if (isPublicIpv4(ip)) at(m.index + m[1].length, 'public-ip');
      else if (prose && isPrivateIpv4(ip)) at(m.index + m[1].length, 'private-ip');
    }

    CREDENTIAL_RE.lastIndex = 0;
    while ((m = CREDENTIAL_RE.exec(line)) !== null) {
      if (looksLikeSecret(m[1], line[m.index + m[0].length] || '')) at(m.index, 'credential');
    }
  });

  return findings;
}

/**
 * Replace every match with a placeholder. Used by the pull request workflow to
 * shrink the exposure window from "forever" to "seconds". It does not undo the
 * publication — GitHub keeps an edit history that stays visible — so this is
 * damage control, not a fix.
 */
function redact(text, opts) {
  const prose = (opts || {}).surface === 'prose';
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (line.includes(ALLOW_MARKER)) return line;
      let out = line.replace(DYNAMIC_HOST_RE, (full, pre, labels, suffix) =>
        GENERIC_LABELS.has(labels.slice(0, -1).toLowerCase()) ? full : pre + '<redacted-host>.' + suffix
      );
      out = out.replace(IPV4_RE, (full, pre, ip, offset) => {
        if (!looksLikeAddress(out, offset, pre, ip)) return full;
        if (isPublicIpv4(ip)) return pre + '<redacted-ip>';
        if (prose && isPrivateIpv4(ip)) return pre + '<redacted-ip>';
        return full;
      });
      out = out.replace(CREDENTIAL_RE, (full, value, offset) =>
        looksLikeSecret(value, out[offset + full.length] || '')
          ? full.slice(0, full.length - value.length) + '<redacted>'
          : full
      );
      return out;
    })
    .join('\n');
}

function formatFindings(findings) {
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  const out = [];
  for (const [rule, list] of byRule) {
    out.push('  ' + rule + ' — ' + RULES[rule]);
    for (const f of list) out.push('      ' + f.label + ':' + f.line + ':' + f.column);
  }
  return out.join('\n');
}

module.exports = {
  scan,
  redact,
  formatFindings,
  isPublicIpv4,
  isPrivateIpv4,
  RULES,
  ALLOW_MARKER,
  FILE_ALLOW_MARKER
};

// ---------------------------------------------------------------- CLI --------

const HELP = `Usage:
  node scripts/leak-scan.js --files <path...>     scan file contents
  node scripts/leak-scan.js --stdin [--label L]   scan stdin as prose
  node scripts/leak-scan.js --message <file>      scan a commit message file
  node scripts/leak-scan.js --range <rev-list args>  scan commit messages in a range
  node scripts/leak-scan.js --redact              read stdin, print it redacted

Exit code 1 means something was found. Findings print a location, never the
match: this output ends up in public workflow logs.`;

function readStdin() {
  const fs = require('fs');
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function report(findings, hint) {
  if (findings.length === 0) return 0;
  process.stderr.write('\nleak-scan: refusing to let this become public.\n\n');
  process.stderr.write(formatFindings(findings) + '\n\n');
  process.stderr.write(
    (hint || '') +
      'Use the documented placeholders (<your-name>.duckdns.org, <server-ip>)\n' +
      'instead of a real address. If a hit is genuinely wrong, put ' +
      ALLOW_MARKER +
      '\non that line.\n\n'
  );
  return 1;
}

function main(argv) {
  const fs = require('fs');
  const mode = argv[0];

  if (!mode || mode === '--help' || mode === '-h') {
    process.stdout.write(HELP + '\n');
    return 0;
  }

  if (mode === '--redact') {
    process.stdout.write(redact(readStdin(), { surface: 'prose' }));
    return 0;
  }

  if (mode === '--files') {
    const findings = [];
    for (const file of argv.slice(1)) {
      let text;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue; // deleted in this change, or not a readable text file
      }
      if (text.includes('\0')) continue; // binary
      findings.push(...scan(text, { label: file, surface: 'file' }));
    }
    return report(findings);
  }

  if (mode === '--message') {
    const file = argv[1];
    const text = file ? fs.readFileSync(file, 'utf8') : readStdin();
    return report(scan(text, { label: 'commit message', surface: 'prose' }));
  }

  if (mode === '--stdin') {
    const idx = argv.indexOf('--label');
    const label = idx >= 0 ? argv[idx + 1] : 'input';
    return report(scan(readStdin(), { label, surface: 'prose' }));
  }

  if (mode === '--range') {
    const { execFileSync } = require('child_process');
    // Everything after --range is handed to rev-list verbatim, so the pre-push
    // hook can pass `<sha> --not --remotes=origin` for a brand new branch as
    // easily as a plain `a..b`.
    const range = argv.slice(1).filter(Boolean);
    if (range.length === 0) {
      process.stderr.write('leak-scan: --range needs a revision range\n');
      return 2;
    }
    const shas = execFileSync('git', ['rev-list'].concat(range), { encoding: 'utf8' }).split('\n').filter(Boolean);
    const findings = [];
    for (const sha of shas) {
      const body = execFileSync('git', ['log', '-1', '--format=%B', sha], { encoding: 'utf8' });
      findings.push(...scan(body, { label: 'commit ' + sha.slice(0, 8), surface: 'prose' }));
    }
    return report(
      findings,
      'These are commit messages, so fixing them means rewriting them\n' +
        '(git commit --amend, or git rebase -i) before the push.\n\n'
    );
  }

  process.stderr.write(HELP + '\n');
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
