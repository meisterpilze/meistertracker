'use strict';
// Who gets to decide what a log line says.
//
// log() built its JSON record by spreading the caller's meta object last:
//
//   JSON.stringify({ time: ts, level: level.toUpperCase(), msg, ...meta })
//
// so meta won every collision. That is harmless for the 200-odd internal call
// sites, none of which pass time/level/msg — but /api/csp-reports handed the
// parsed request body straight through:
//
//   log('warn', 'CSP violation', report['csp-report'] || report);
//
// A POST of {"time":"1999-01-01T00:00:00.000Z","level":"INFO","msg":"nothing to
// see here","user":"admin"} therefore became exactly that line in the JSON
// stream DEPLOYMENT.md tells operators to feed to pm2/journald. Enough to
// fabricate an audit trail, or to bury a real event under lines that a log
// search filters out. The endpoint was already rate-limited and body-capped, so
// the volume was bounded — the problem was the override, not the volume.
//
// Two changes, tested separately: the record's own fields are no longer
// overridable by any caller, and the CSP endpoint logs a fixed field set rather
// than whatever object arrived.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// server.js listens on require, so log() is lifted with its reserved-key set
// and given a console of our own.
function buildLog(format) {
  const reserved = SRC.match(/const LOG_RESERVED = new Set\(\[[^\]]*\]\);/);
  const fn = SRC.match(/function log\(level, msg, meta\) \{[\s\S]*?\n\}/);
  assert.ok(reserved && fn, 'log() has been rewritten — this test needs updating with it');
  const lines = [];
  const console = { log: (...a) => lines.push(a), error: (...a) => lines.push(a) };
  const log = new Function('LOG_FORMAT', 'console', reserved[0] + '\n' + fn[0] + '\nreturn log;')(format, console);
  return { log, lines };
}

function liftCspFields() {
  const fields = SRC.match(/const CSP_REPORT_FIELDS = \[[\s\S]*?\];/);
  const fn = SRC.match(/function cspReportFields\(report\) \{[\s\S]*?\n\}/);
  assert.ok(fields && fn, 'cspReportFields is gone from server.js');
  return new Function(fields[0] + '\n' + fn[0] + '\nreturn cspReportFields;')();
}

describe('log() framing fields cannot be overridden', () => {
  it('keeps its own time, level and msg', () => {
    const { log, lines } = buildLog('json');
    log('warn', 'CSP violation', {
      time: '1999-01-01T00:00:00.000Z',
      level: 'INFO',
      msg: 'nothing to see here'
    });
    const rec = JSON.parse(lines[0][0]);
    assert.equal(rec.level, 'WARN');
    assert.equal(rec.msg, 'CSP violation');
    assert.notEqual(rec.time, '1999-01-01T00:00:00.000Z');
    assert.match(rec.time, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('still carries the fields a caller legitimately adds', () => {
    const { log, lines } = buildLog('json');
    log('info', 'Batch created', { batchId: 'B-1', qty: 12 });
    const rec = JSON.parse(lines[0][0]);
    assert.equal(rec.batchId, 'B-1');
    assert.equal(rec.qty, 12);
  });

  it('puts time, level and msg first, so the format did not change', () => {
    const { log, lines } = buildLog('json');
    log('info', 'x', { a: 1 });
    assert.deepEqual(Object.keys(JSON.parse(lines[0][0])), ['time', 'level', 'msg', 'a']);
  });

  it('survives a meta that is not an object', () => {
    const { log, lines } = buildLog('json');
    for (const meta of [undefined, null, 'string', 42]) log('info', 'x', meta);
    for (const [line] of lines) assert.equal(JSON.parse(line).msg, 'x');
  });

  it('is not tricked by a "__proto__" key either', () => {
    const { log, lines } = buildLog('json');
    // JSON.parse creates a real own "__proto__" property, so Object.keys sees
    // it. Copying it across with record[k] = ... would reparent the record.
    log('warn', 'x', JSON.parse('{"__proto__":{"level":"INFO"},"ok":1}'));
    const rec = JSON.parse(lines[0][0]);
    assert.equal(rec.level, 'WARN', 'level must come from the call, never from meta');
    assert.equal(rec.ok, 1);
    assert.equal('level' in {}, false, 'and nothing leaked onto Object.prototype');
  });

  it('routes errors to stderr and everything else to stdout', () => {
    const errs = [];
    const outs = [];
    const reserved = SRC.match(/const LOG_RESERVED = new Set\(\[[^\]]*\]\);/)[0];
    const fn = SRC.match(/function log\(level, msg, meta\) \{[\s\S]*?\n\}/)[0];
    const log = new Function('LOG_FORMAT', 'console', reserved + '\n' + fn + '\nreturn log;')('json', {
      log: (l) => outs.push(l),
      error: (l) => errs.push(l)
    });
    log('error', 'boom');
    log('info', 'fine');
    assert.equal(errs.length, 1);
    assert.equal(outs.length, 1);
  });
});

describe('cspReportFields', () => {
  const cspReportFields = liftCspFields();

  it('keeps the fields a report is read for', () => {
    const out = cspReportFields({
      'document-uri': 'https://app/x',
      'violated-directive': "script-src 'self'",
      'blocked-uri': 'inline',
      'line-number': 42
    });
    assert.deepEqual(out, {
      'document-uri': 'https://app/x',
      'violated-directive': "script-src 'self'",
      'blocked-uri': 'inline',
      'line-number': 42
    });
  });

  it('drops everything the client made up', () => {
    const out = cspReportFields({
      time: '1999-01-01T00:00:00.000Z',
      level: 'INFO',
      msg: 'nothing to see here',
      user: 'admin',
      'original-policy': 'x'.repeat(5000)
    });
    assert.deepEqual(out, {});
  });

  it('truncates long strings and coerces non-strings', () => {
    const out = cspReportFields({
      'blocked-uri': 'x'.repeat(5000),
      'document-uri': { toString: () => 'coerced' },
      'line-number': Infinity
    });
    assert.equal(out['blocked-uri'].length, 300);
    assert.equal(out['document-uri'], 'coerced');
    assert.equal(out['line-number'], null);
  });

  it('handles a body that is not an object at all', () => {
    for (const v of [null, undefined, 'string', 7, []]) {
      assert.deepEqual(cspReportFields(v), {});
    }
  });

  it('is what the endpoint actually calls', () => {
    assert.match(SRC, /log\('warn', 'CSP violation', cspReportFields\(report\['csp-report'\] \|\| report\)\)/);
  });
});
