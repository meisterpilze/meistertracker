'use strict';
// The message line that replaced alert().
//
// Seventy-seven call sites went through the browser's modal, and the reason
// that was worth changing is not that it looks dated. It is not the app: on a
// phone it renders as `192.168.x.x sagt:` in the OS font, ignoring the theme
// and the 56px touch floor the rest of the app now guarantees; it blocks, so a
// gloved thumb has to find one small OK before anything else can happen; and it
// detaches the message from the field that caused it.
//
// What this file pins is the part that would rot silently. The bar has three
// jobs on one element — an undo offer, a receipt, an error — and each has to
// clean up after the last one. An error that leaves `is-err` behind tints the
// next receipt red; a receipt that leaves `role="alert"` behind makes every
// later message interrupt a screen reader; and an undo offer that keeps the
// tap-to-dismiss handler loses the undo to a stray tap. None of the three
// throws, and none is visible in a diff.
//
// Lifted out of app.js and run against a stub DOM, the same way
// test/harvest-release-ui.test.js does it: the browser is not the thing under
// test, the decisions are.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const TEILE = [
  [/^let _undoTimer = null;/m, '_undoTimer'],
  [/^function showUndoBar\(msg, undoCb\) \{[\s\S]*?\n\}/m, 'showUndoBar()'],
  [/^function toast\(msg, kind\) \{[\s\S]*?\n\}/m, 'toast()'],
  [/^function flashUndoBar\(msg\) \{[\s\S]*?\n\}/m, 'flashUndoBar()'],
  [/^function hideUndoBar\(\) \{[\s\S]*?\n\}/m, 'hideUndoBar()']
];

function laden() {
  const code = TEILE.map(([re, was]) => {
    const m = APP.match(re);
    assert.ok(m, 'could not find ' + was + ' in app.js — has it been renamed?');
    return m[0];
  }).join('\n\n');

  // A class list that records rather than renders, and an attribute bag beside
  // it: between them they are everything the three functions touch.
  const bar = {
    classes: new Set(),
    attrs: {},
    onclick: undefined,
    classList: {
      add(c) {
        bar.classes.add(c);
      },
      remove(c) {
        bar.classes.delete(c);
      },
      toggle(c, on) {
        if (on) bar.classes.add(c);
        else bar.classes.delete(c);
      },
      contains: (c) => bar.classes.has(c)
    },
    setAttribute(k, v) {
      bar.attrs[k] = v;
    }
  };
  const msg = { textContent: '' };
  const btn = { textContent: '', style: {}, onclick: null };

  const stub = `
    const t = (k) => k;
    const document = {
      getElementById: (id) =>
        id === 'undo-bar' ? bar : id === 'undo-msg' ? msg : id === 'undo-btn' ? btn : null
    };
  `;
  const api = new Function(
    'bar',
    'msg',
    'btn',
    'setTimeout',
    'clearTimeout',
    stub + '\n' + code + '\nreturn { toast, flashUndoBar, showUndoBar, hideUndoBar };'
  );
  // Timers are collected, not run: hideUndoBar's own deferred cleanup would
  // otherwise fire mid-assertion, and the point of each test is the state the
  // bar is left in the moment a caller returns.
  const timers = [];
  return {
    bar,
    msg,
    btn,
    timers,
    ...api(
      bar,
      msg,
      btn,
      (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      () => {}
    )
  };
}

describe('the message bar', () => {
  let f;
  beforeEach(() => {
    f = laden();
  });

  it('shows an error in its own skin, read out assertively', () => {
    f.toast('Menge fehlt', 'err');
    assert.equal(f.msg.textContent, 'Menge fehlt');
    assert.ok(f.bar.classes.has('show'), 'the bar never came up');
    assert.ok(f.bar.classes.has('is-err'), 'an error is not marked as one');
    assert.equal(f.bar.attrs.role, 'alert');
    assert.equal(f.bar.attrs['aria-live'], 'assertive');
    assert.equal(f.btn.style.display, 'none', 'an error is not an undo offer — the button must be gone');
  });

  it('leaves the error skin behind for nobody', () => {
    // The failure: a red receipt. `is-err` is set with toggle(), not add(), so
    // this holds without hideUndoBar() having run in between — which matters,
    // because two messages inside six seconds is the normal case.
    f.toast('kaputt', 'err');
    f.toast('gespeichert');
    assert.equal(f.bar.classes.has('is-err'), false, 'the receipt inherited the error colour');
    assert.equal(f.bar.attrs.role, 'status');
    assert.equal(f.bar.attrs['aria-live'], 'polite');
  });

  it('gives an error longer than a receipt', () => {
    // A validation message that leaves before the eye reaches it is one nobody
    // got. The numbers themselves are a judgement; that they differ is not.
    f.toast('kaputt', 'err');
    const err = f.timers.at(-1).ms;
    f.toast('gespeichert');
    const ok = f.timers.at(-1).ms;
    assert.ok(err > ok, `an error (${err}ms) must outlast a receipt (${ok}ms)`);
  });

  it('lets a tap dismiss a message and not an undo offer', () => {
    // An undo offer that vanished under a stray tap would take the undo with it,
    // and the tap that dismissed it is exactly the tap of somebody reaching for
    // the button.
    f.toast('kaputt', 'err');
    assert.equal(typeof f.bar.onclick, 'function', 'a message cannot be tapped away');
    f.showUndoBar('4 Beutel verschoben', () => {});
    assert.equal(f.bar.onclick, null, 'an undo offer can be tapped away by accident');
  });

  it('hands an undo offer a clean bar', () => {
    f.toast('kaputt', 'err');
    f.showUndoBar('4 Beutel verschoben', () => {});
    assert.equal(f.bar.classes.has('is-err'), false, 'the undo offer came up red');
    assert.equal(f.bar.attrs.role, 'status');
    assert.equal(f.btn.style.display, '', 'the undo button stayed hidden from the message before it');
  });
});

describe('nothing speaks through the browser any more', () => {
  it('has no alert() left in app.js', () => {
    // The sweep is only worth as much as the next person not adding a
    // seventy-eighth. Comments are allowed to name it — this file's own
    // reasoning does — so only calls count.
    const calls = [...APP.matchAll(/(^|[^.\w])alert\(/g)]
      .map((m) => APP.slice(0, m.index).split('\n').length)
      .filter((line) => !/^\s*(\/\/|\*)/.test(APP.split('\n')[line - 1]));
    assert.deepEqual(calls, [], `alert() is back at app.js line(s) ${calls.join(', ')} — use toast(msg, 'err')`);
  });

  it('still allows the one confirm() that cannot be a dialog', () => {
    // mayLeavePage() is called from `beforeunload`, which is synchronous by
    // specification: a promise-based dialog there would resolve after the tab
    // is gone. The other eight confirm()s are a separate change and are
    // deliberately not asserted about here — see USABILITY_PLAN.md.
    const fn = APP.match(/function mayLeavePage\(\) \{[\s\S]*?\n\}/m);
    assert.ok(fn, 'mayLeavePage() not found');
    assert.match(fn[0], /window\.confirm\(/, 'the unload guard stopped asking');
  });
});
