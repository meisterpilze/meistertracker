'use strict';
// The name a calendar file is allowed to have.
//
// Every writeIcsFile call builds it as `uid + '.ics'`, and on POST
// /api/caldav/push-one and /push-event that uid is task.caldavUid straight out
// of the request body — checkAuth only, no role. path.join() follows a "../"
// chain out of the calendar directory without complaint, so any logged-in
// worker could place an .ics carrying their own SUMMARY and DESCRIPTION
// wherever the server process can write. On the Windows lab machine that runs
// as the signed-in user, which includes its Startup folder.
//
// The charset was never invented for this fix: the sync-back paths in server.js
// have always demanded /^[A-Za-z0-9\-_.@]+$/ of a uid read *out* of a file.
// There was simply no counterpart on the way in. It now lives in db.js as one
// definition, because the file writer and the two rows that store the value all
// need it and two copies is how one of them stops matching.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const db = require('../db.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

describe('what a caldav uid may be', () => {
  it('accepts the uids the app actually generates', () => {
    for (const uid of ['abc123', 'task-1.2', 'a_b@c', 'MP-2026-08-19T10-00-00', 'x'.repeat(200)]) {
      assert.ok(db.isValidCaldavUid(uid), 'should accept ' + uid);
    }
  });

  it('refuses anything that could name a second path component', () => {
    for (const uid of [
      '../../../../Users/Public/pwn',
      '..\\..\\Windows\\Temp\\pwn',
      'a/b',
      'a\\b',
      'a\0b',
      '',
      'x'.repeat(201),
      null,
      undefined,
      42,
      {}
    ]) {
      assert.equal(db.isValidCaldavUid(uid), false, 'should refuse ' + JSON.stringify(uid));
    }
  });

  it('is no narrower than the read side, because a difference is a fail-open', () => {
    // ⚠️ The cap was 120 while the sync-back's own regex has none. A
    // 150-character uid was therefore refused here — and caldavRecordAllowed
    // read that refusal as "cannot name a row" and waved the request through,
    // while the sync-back resolved the row and wrote it. Every difference
    // between two spellings of one rule is a value one accepts and the other
    // refuses; this one was an ownership bypass.
    const lang = 'x'.repeat(150);
    assert.equal(db.isValidCaldavUid(lang), true);
    assert.equal(/^[A-Za-z0-9\-_.@]+$/.test(lang), true, 'the read side accepts it, so this must too');
    // The cap that remains is a filesystem fact, not a rule: `uid + '.ics'`
    // has to fit a 255-byte name.
    assert.equal(db.isValidCaldavUid('x'.repeat(201)), false);
  });

  it('is what makes traversal impossible, rather than a hunt for ".."', () => {
    // Stated as a property, not as a list of blocked strings: with the
    // separators and NUL gone there is no way left to address a second
    // component, so a uid that merely *contains* dots stays legal.
    assert.ok(db.isValidCaldavUid('a..b'), 'dots alone are not the danger');
    const escaped = path.join('/app/calendars/meisterpilze', '../../../../Users/Public/pwn.ics');
    assert.ok(!escaped.startsWith('/app/calendars'), 'premise: path.join does leave the directory');
    assert.equal(db.isValidCaldavUid('../../../../Users/Public/pwn'), false, 'and the rule stops it');
  });
});

describe('where the rule is applied', () => {
  it('sits inside writeIcsFile, so all fourteen callers inherit it', () => {
    const fn = SRC.match(/function writeIcsFile\([\s\S]*?\n\}/);
    assert.ok(fn, 'writeIcsFile has moved');
    assert.ok(fn[0].indexOf('icsFileName(') < fn[0].indexOf('fs.writeFileSync'), 'checked before the write');
  });

  it('sits inside deleteIcsFile too', () => {
    const fn = SRC.match(/function deleteIcsFile\([\s\S]*?\n\}/);
    assert.ok(fn, 'deleteIcsFile has moved');
    assert.ok(fn[0].indexOf('icsFileName(') < fn[0].indexOf('path.join'), 'checked before the path is built');
  });

  it('answers 400 rather than 500 — the caller is wrong, not us', () => {
    const fn = SRC.match(/function icsFileName\([\s\S]*?\n\}/);
    assert.ok(fn, 'icsFileName has moved');
    assert.match(fn[0], /caldav:/, "the 'caldav:' prefix is what db.isSafeError turns into a 400");
    assert.ok(db.isSafeError('caldav: rejected calendar file name'), 'and it really is on that list');
  });

  it('rejects a name that is not .ics at all', () => {
    const icsFileName = new Function(
      'db',
      SRC.match(/function icsFileName\([\s\S]*?\n\}/)[0] + '\nreturn icsFileName;'
    )(db);
    assert.throws(() => icsFileName('pwn.exe'), /caldav:/);
    assert.throws(() => icsFileName('../../pwn.ics'), /caldav:/);
    assert.throws(() => icsFileName('.ics'), /caldav:/);
    assert.equal(icsFileName('abc123.ics'), 'abc123.ics');
  });
});

describe('a uid we would not write is not stored either', () => {
  it('is dropped on insert rather than left as a row that can never sync', () => {
    const ins = SRC.length && fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
    const fn = ins.match(/function insertTask\(db, t\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'insertTask has moved');
    assert.match(fn[0], /cleanCaldavUid\(t\.caldavUid\)/, 'the stored value goes through the same rule');
  });

  it('goes through the rule at all four stores, not two', () => {
    // The commit that introduced this claimed "the file writer and both places
    // that store the value". There are four: insertTask, writeAll,
    // updateTaskCaldavUid and updateTaskById's field map. The last two wrote
    // the raw string, and updateTaskCaldavUid is reached by push-one's
    // private+unassigned branch — where writeIcsFile never runs and so never
    // had a chance to object.
    const dbSrc = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
    for (const fn of ['insertTask', 'updateTaskCaldavUid', 'updateTaskById']) {
      const m = dbSrc.match(new RegExp('function ' + fn + '\\([\\s\\S]*?\\n\\}'));
      assert.ok(m, fn + ' has moved');
      assert.match(m[0], /cleanCaldavUid\(/, fn + ' still stores the raw string');
    }
  });

  it('and on the bulk replace-all path', () => {
    const dbSrc = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
    assert.equal((dbSrc.match(/cleanCaldavUid\(/g) || []).length >= 3, true, 'defined and used at both stores');
  });
});
