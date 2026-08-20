// Serves index.html with every external <script> stripped, plus styles.css, on
// 127.0.0.1 — and waits for the page to POST a measurement back.
//
// Extracted from scripts/capture-desktop-baseline.js when a second tool needed
// the same page. Same reason scripts/mobile-size-scan.js exists: two copies of
// "serve the app with nothing but its cascade running" would drift, and the
// drift would be invisible — both tools would still print numbers, just not
// comparable ones.
//
// Stripping the scripts is what makes the measurement mean anything: no auth
// flow, no fetch, no app state, so only the CSS decides. The cost is stated
// plainly because it bounds what either tool can claim: everything app.js
// renders at runtime is absent from the page. What is measured here is
// index.html's own markup under the real stylesheet.

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');

function build() {
  return {
    'index.html': fs
      .readFileSync(path.join(ROOT, 'index.html'), 'utf8')
      .replace(/<script[^>]*\ssrc="[^"]*"[^>]*>\s*<\/script>/gi, ''),
    'styles.css': fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8')
  };
}

// Only the two files in `files` are reachable — the exact-name lookup below is
// what rules out path traversal, so nothing else in the repo is exposed.
function serve(files, onCapture, port) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(204).end();
        onCapture(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        server.close();
      });
      return;
    }
    const clean = req.url.split('?')[0];
    const name = clean === '/' || clean.startsWith('/index.html') ? 'index.html' : path.basename(clean);
    const body = Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null;
    if (body === null) return res.writeHead(404).end();
    // no-store is load-bearing, not hygiene. Without it the browser reuses
    // styles.css across runs — the stylesheet URL never changes — and you
    // measure an edit you made two commits ago. That produced a "the desktop
    // moved" report for a rule that had not moved, and a "the phone did not
    // change" report for one that had.
    res.writeHead(200, {
      'Content-Type': name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate'
    });
    res.end(body);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { ROOT, build, serve };
