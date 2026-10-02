'use strict';
// The stick backup in the interface: the reminder on the start screen, the card
// in Settings → Backup, the drive list for setting a stick up, and the box that
// shows the recovery key.
//
// app.js has no module boundary, so the functions are lifted out of the source
// and run against a stub DOM, as in harvest-release-ui.test.js. What is under
// test is what each state says and offers, not how a browser draws it.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion } = require('./helpers/quelle');

const SRC = quelle('app.js');
const FUNKTIONEN = [
  'esc',
  'localDateStr',
  'fmtDt',
  'fmtDtTime',
  '_usbAdmin',
  '_usbPct',
  '_usbWhen',
  '_usbSize',
  '_usbErrText',
  '_usbReminderText',
  '_usbBindReminder',
  'renderUsbReminder',
  '_usbConnectId',
  '_usbUsable',
  '_usbStatusLine',
  '_usbProgressHtml',
  'renderUsbCard',
  'renderUsbSetup',
  'renderUsbKey'
];

function codes() {
  const m = SRC.match(/^const USB_ERR_CODES = \[[\s\S]*?\];/m);
  assert.ok(m, 'USB_ERR_CODES is gone from app.js');
  return m[0];
}

function el(id) {
  return {
    id,
    hidden: false,
    innerHTML: '',
    textContent: '',
    className: '',
    dataset: {},
    value: '',
    addEventListener() {}
  };
}

// One page: the elements the functions write to, the user, and the state.
function seite({
  usb = null,
  drives = null,
  key = null,
  setupOpen = false,
  admin = true,
  typed = null,
  focus = null
} = {}) {
  const els = {
    'wk-usb': el('wk-usb'),
    'wk-usb-key': el('wk-usb-key'),
    'usb-body': el('usb-body'),
    'usb-setup': el('usb-setup'),
    'usb-key': el('usb-key')
  };
  // A key half-typed into the field of the stick in E:\.
  if (typed !== null) els['usb-connect-key-E_3A_5C'] = Object.assign(el('usb-connect-key-E_3A_5C'), { value: typed });
  const api = new Function(
    'els',
    'state',
    `
    const document = { getElementById: (id) => els[id] || null, activeElement: state.focus ? els[state.focus] : null };
    const t = (k, p) => (p ? k + '(' + Object.keys(p).map((n) => n + '=' + p[n]).join(',') + ')' : k);
    const tp = (k, n) => k + '.' + (n === 1 ? 'one' : 'other') + '(' + n + ')';
    const loc = () => 'de-DE';
    const go = () => {};
    let currentUser = state.admin ? { role: 'admin' } : { role: 'user' };
    let _usb = state.usb;
    let _usbDrives = state.drives;
    let _usbKey = state.key;
    let _usbSetupOpen = state.setupOpen;
    ${codes()}
    ${FUNKTIONEN.map((n) => hebeFunktion(n, SRC)).join('\n')}
    return { renderUsbReminder, renderUsbCard, renderUsbSetup, renderUsbKey, _usbErrText, _usbPct };`
  )(els, { usb, drives, key, setupOpen, admin, focus });
  return { els, api };
}

const heute = new Date();
heute.setHours(9, 12, 0, 0);

function status(over) {
  return Object.assign(
    {
      configured: true,
      keyConfirmed: true,
      sticks: [],
      present: [],
      run: null,
      lastSuccess: null,
      today: false,
      reminder: 'due'
    },
    over
  );
}

describe('the start screen reminder', () => {
  it('stays hidden with nothing to say', () => {
    const { els, api } = seite({ usb: status({ reminder: null, today: true }) });
    api.renderUsbReminder();
    assert.equal(els['wk-usb'].hidden, true);
  });

  it('asks for the stick, naming when the last backup was', () => {
    const { els, api } = seite({
      usb: status({ lastSuccess: { time: heute.toISOString(), label: 'Stick 1', photosNew: 3 } })
    });
    api.renderUsbReminder();
    assert.equal(els['wk-usb'].hidden, false);
    assert.equal(els['wk-usb'].className, 'wk-usb wk-usb-due');
    assert.equal(els['wk-usb'].textContent, 'usb.remDue(when=usb.today(time=09:12))');
  });

  it('says when there has never been one', () => {
    const { els, api } = seite({ usb: status() });
    api.renderUsbReminder();
    assert.equal(els['wk-usb'].textContent, 'usb.remDueNever');
  });

  it('shows progress, the way out, a failure and the setup in their own colours', () => {
    const cases = [
      [
        { reminder: 'running', run: { state: 'running', bytesDone: 25, bytesTotal: 100 } },
        'wk-usb-running',
        'usb.remRunning(pct=25)'
      ],
      [{ reminder: 'remove', today: true }, 'wk-usb-remove', '✓ usb.remRemove'],
      [{ reminder: 'gaps', today: true }, 'wk-usb-gaps', '⚠ usb.remGaps'],
      [
        { reminder: 'error', run: { state: 'error', error: { code: 'FULL' } } },
        'wk-usb-error',
        '⚠ usb.remError(why=usb.err.FULL)'
      ],
      [{ reminder: 'setup', configured: false }, 'wk-usb-setup', 'usb.remSetup'],
      [{ reminder: 'first', firstRunPending: true }, 'wk-usb-first', 'usb.remFirst'],
      [{ reminder: 'state', stateError: true, configured: false }, 'wk-usb-state', '⚠ usb.err.STATE']
    ];
    for (const [over, cls, text] of cases) {
      const { els, api } = seite({ usb: status(over) });
      api.renderUsbReminder();
      assert.equal(els['wk-usb'].className, 'wk-usb ' + cls);
      assert.equal(els['wk-usb'].textContent, text);
    }
  });

  it('says on a line of its own that the key is not put away, beside what the backup says', () => {
    const { els, api } = seite({
      usb: status({ keyConfirmed: false, reminder: 'error', run: { state: 'error', error: { code: 'FULL' } } })
    });
    api.renderUsbReminder();
    assert.equal(els['wk-usb-key'].hidden, false);
    assert.equal(els['wk-usb-key'].textContent, '⚠ usb.remKey');
    assert.equal(els['wk-usb'].hidden, false);
    assert.equal(els['wk-usb'].textContent, '⚠ usb.remError(why=usb.err.FULL)');
    const ok = seite({ usb: status() });
    ok.api.renderUsbReminder();
    assert.equal(ok.els['wk-usb-key'].hidden, true);
  });

  it('is never shown to someone who is not an admin', () => {
    const { els, api } = seite({ usb: null, admin: false });
    api.renderUsbReminder();
    assert.equal(els['wk-usb'].hidden, true);
  });

  it('translates every code the server can send, and an unknown one as a plain failure', () => {
    const { api } = seite();
    for (const c of ['NOT_A_DRIVE', 'SAME_DISK', 'FULL', 'GONE', 'READ_ONLY', 'WRONG_KEY', 'HELD', 'DAMAGED']) {
      assert.equal(api._usbErrText(c), 'usb.err.' + c);
    }
    assert.equal(api._usbErrText('SOMETHING_NEW'), 'usb.err.FAILED');
    assert.equal(api._usbErrText(undefined), 'usb.err.FAILED');
  });
});

describe('the settings card', () => {
  it('offers setup and nothing else before there is a stick', () => {
    const { els, api } = seite({ usb: status({ configured: false, reminder: 'setup' }) });
    api.renderUsbCard();
    const h = els['usb-body'].innerHTML;
    assert.match(h, /usb\.notSetUp/);
    assert.match(h, /data-usb="setup-open">usb\.setupFirst/);
    assert.doesNotMatch(h, /data-usb="run"/);
    assert.doesNotMatch(h, /data-usb="key"/, 'no key yet, nothing to show');
  });

  it('says first thing that the key is not confirmed as put away, and only then', () => {
    const offen = seite({ usb: status({ keyConfirmed: false }) });
    offen.api.renderUsbCard();
    assert.match(
      offen.els['usb-body'].innerHTML,
      /^<div class="usb-status">[^<]*<\/div><div class="usb-msg usb-msg-err">⚠ usb\.keyUnconfirmed/
    );
    const zu = seite({ usb: status() });
    zu.api.renderUsbCard();
    assert.doesNotMatch(zu.els['usb-body'].innerHTML, /usb\.keyUnconfirmed/);
  });

  it('lists the sticks with their last backup, and offers a backup when one is in', () => {
    const { els, api } = seite({
      usb: status({
        sticks: [
          { id: 'a1', label: 'Stick 1', present: true, lastSuccess: { time: heute.toISOString() }, lastError: null },
          { id: 'b2', label: 'Stick 2', present: false, lastSuccess: null, lastError: { code: 'FULL' } }
        ],
        present: [{ root: 'E:\\', id: 'a1', registered: true, otherKey: false, supported: true }],
        lastSuccess: { time: heute.toISOString(), label: 'Stick 1', photosNew: 1 }
      })
    });
    api.renderUsbCard();
    const h = els['usb-body'].innerHTML;
    assert.match(h, /usb\.lastBackup\(when=usb\.today\(time=09:12\),label=Stick 1\) · usb\.newPhotos\.one\(1\)/);
    assert.match(h, /Stick 1<\/span> <span class="usb-badge">usb\.present/);
    assert.match(h, /usb\.stickNever · ⚠ usb\.err\.FULL/);
    assert.match(h, /data-usb="run"/);
    assert.match(h, /data-usb="setup-open">usb\.setupAnother/);
    assert.match(h, /data-usb="key"/);
  });

  it('says which photos the last backup could not read on the PC', () => {
    const { els, api } = seite({
      usb: status({
        reminder: 'gaps',
        today: true,
        lastSuccess: {
          time: heute.toISOString(),
          label: 'Stick 1',
          photosNew: 4,
          skipped: 2,
          unreadable: 1,
          missing: ['2026/10/a.jpg', '2026/10/b.jpg', '2026/11']
        }
      })
    });
    api.renderUsbCard();
    const h = els['usb-body'].innerHTML;
    assert.match(h, /⚠ usb\.gapsFiles\.other\(2\) usb\.gapsFolders\.one\(1\)/);
    assert.match(h, /usb\.gapsExamples\(list=2026\/10\/a\.jpg, 2026\/10\/b\.jpg, 2026\/11\)/);
    const ok = seite({ usb: status({ lastSuccess: { time: heute.toISOString(), label: 'S', photosNew: 1 } }) });
    ok.api.renderUsbCard();
    assert.doesNotMatch(ok.els['usb-body'].innerHTML, /usb\.gaps/, 'nothing about gaps when there were none');
  });

  it('names a stick folder on the app’s own disk as a copy, and offers no backup to it', () => {
    const { els, api } = seite({
      usb: status({
        sticks: [{ id: 'a1', label: 'Stick 1', present: false, lastSuccess: null, lastError: null }],
        present: [{ root: 'C:\\', id: 'a1', registered: true, otherKey: false, supported: true, sameDisk: true }]
      })
    });
    api.renderUsbCard();
    const h = els['usb-body'].innerHTML;
    assert.match(h, /usb\.copyOnPc\(name=C:\\\)/);
    assert.doesNotMatch(h, /data-usb="run"/);
  });

  it('after connecting on a new PC, says to restore first and offers the first backup', () => {
    const { els, api } = seite({
      usb: status({
        reminder: 'first',
        firstRunPending: true,
        sticks: [{ id: 'a1', label: 'Stick 1', present: true, lastSuccess: null, lastError: null }],
        present: [{ root: 'E:\\', id: 'a1', registered: true, otherKey: false, supported: true, sameDisk: false }]
      })
    });
    api.renderUsbCard();
    const h = els['usb-body'].innerHTML;
    assert.match(h, /usb\.firstPending/);
    assert.match(h, /data-usb="run"/);
  });

  it('names the stick a backup is meant for, with two plugged in', () => {
    const two = [
      { root: 'E:\\', id: 'a1', registered: true, otherKey: false, supported: true, sameDisk: false },
      { root: 'F:\\', id: 'b2', registered: true, otherKey: false, supported: true, sameDisk: false }
    ];
    const { els, api } = seite({
      usb: status({
        reminder: 'error',
        run: { state: 'error', stickId: 'b2', error: { code: 'SHRUNK' } },
        sticks: [
          { id: 'a1', label: 'Stick 1', present: true, lastSuccess: null, lastError: null },
          { id: 'b2', label: 'Stick 2', present: true, lastSuccess: null, lastError: { code: 'SHRUNK' } }
        ],
        present: two
      })
    });
    api.renderUsbCard();
    const h = els['usb-body'].innerHTML;
    assert.match(h, /data-usb="run-force" data-id="b2"/, 'anyway, for the stick that stopped');
    assert.match(h, /data-usb="run" data-id="a1"/);
    assert.match(h, /data-usb="run" data-id="b2"/);
    const one = seite({
      usb: status({
        sticks: [{ id: 'a1', label: 'Stick 1', present: true, lastSuccess: null, lastError: null }],
        present: [two[0]]
      })
    });
    one.api.renderUsbCard();
    assert.equal((one.els['usb-body'].innerHTML.match(/data-usb="run"/g) || []).length, 1);
  });

  it('shows progress while a backup runs, and offers nothing that would interfere', () => {
    const { els, api } = seite({
      usb: status({
        reminder: 'running',
        run: {
          state: 'running',
          label: 'Stick 1',
          phase: 'photos',
          done: 3,
          total: 10,
          bytesDone: 30,
          bytesTotal: 100
        },
        sticks: [{ id: 'a1', label: 'Stick 1', present: true, lastSuccess: null, lastError: null }],
        present: [{ root: 'E:\\', id: 'a1', registered: true, otherKey: false, supported: true }]
      })
    });
    api.renderUsbCard();
    const h = els['usb-body'].innerHTML;
    assert.match(h, /<progress class="usb-bar" max="100" value="30">/);
    assert.match(h, /usb\.progressPhotos\(label=Stick 1,done=3,total=10\)/);
    assert.doesNotMatch(h, /data-usb="run"/);
    assert.doesNotMatch(h, /data-usb="setup-open"/);
    assert.match(h, /data-usb="forget"[^>]*disabled/);
  });

  it('offers to back up anyway after a run stopped for having far less than last time', () => {
    const plugged = [{ root: 'E:\\', id: 'a1', registered: true, otherKey: false, supported: true }];
    const { els, api } = seite({
      usb: status({
        reminder: 'error',
        run: { state: 'error', stickId: 'a1', error: { code: 'SHRUNK' } },
        sticks: [{ id: 'a1', label: 'Stick 1', present: true, lastSuccess: null, lastError: { code: 'SHRUNK' } }],
        present: plugged
      })
    });
    api.renderUsbCard();
    assert.match(els['usb-body'].innerHTML, /usb\.err\.SHRUNK/);
    assert.match(els['usb-body'].innerHTML, /data-usb="run-force" data-id="a1">usb\.forceGo/);
    const anders = seite({
      usb: status({ reminder: 'error', run: { state: 'error', error: { code: 'FULL' } }, present: plugged })
    });
    anders.api.renderUsbCard();
    assert.doesNotMatch(anders.els['usb-body'].innerHTML, /run-force/, 'only for SHRUNK');
  });

  it('offers to connect a stick from an earlier installation, keeping a half-typed key', () => {
    const { els, api } = seite({
      usb: status({
        configured: false,
        reminder: 'setup',
        present: [{ root: 'E:\\', id: 'c3', label: 'Old', registered: false, otherKey: false, supported: true }]
      }),
      typed: 'ABCD-EF'
    });
    api.renderUsbCard();
    const h = els['usb-body'].innerHTML;
    assert.match(h, /usb\.foreignConnect\(name=E:\\ \(Old\)\)/);
    assert.match(h, /id="usb-connect-key-E_3A_5C"[^>]*value="ABCD-EF"/);
    assert.match(h, /data-usb="connect" data-root="E:\\" data-input="usb-connect-key-E_3A_5C"/);
  });

  it('gives every stick from an earlier installation a key field of its own', () => {
    const { els, api } = seite({
      usb: status({
        configured: false,
        reminder: 'setup',
        present: [
          { root: 'E:\\', id: 'c3', label: 'Old A', registered: false, otherKey: false, supported: true },
          { root: 'F:\\', id: 'd4', label: 'Old B', registered: false, otherKey: false, supported: true }
        ]
      }),
      typed: 'ABCD-EF'
    });
    api.renderUsbCard();
    const h = els['usb-body'].innerHTML;
    assert.match(h, /id="usb-connect-key-E_3A_5C"[^>]*value="ABCD-EF"/);
    assert.match(h, /id="usb-connect-key-F_3A_5C"[^>]*value=""/, 'what was typed for E: stays in E:');
    assert.match(h, /data-root="F:\\" data-input="usb-connect-key-F_3A_5C"/);
  });

  it('is not drawn again under someone typing a key into it', () => {
    const { els, api } = seite({
      usb: status({
        configured: false,
        reminder: 'setup',
        present: [{ root: 'E:\\', id: 'c3', label: 'Old', registered: false, otherKey: false, supported: true }]
      }),
      typed: 'ABCD',
      focus: 'usb-connect-key-E_3A_5C'
    });
    els['usb-body'].innerHTML = 'as it was';
    els['usb-body'].contains = (n) => n === els['usb-connect-key-E_3A_5C'];
    api.renderUsbCard();
    assert.equal(els['usb-body'].innerHTML, 'as it was');
  });

  it('says the stick backup is switched off, and offers nothing', () => {
    const { els, api } = seite({
      usb: status({ enabled: false, configured: true, keyConfirmed: false, reminder: null })
    });
    api.renderUsbCard();
    assert.equal(els['usb-body'].innerHTML, '<div class="usb-msg">usb.disabled</div>');
    api.renderUsbReminder();
    assert.equal(els['wk-usb'].hidden, true);
    assert.equal(els['wk-usb-key'].hidden, true);
  });

  it('escapes what comes from a stick or a drive', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { els, api } = seite({
      usb: status({
        sticks: [{ id: 'a1', label: evil, present: false, lastSuccess: null, lastError: null }],
        present: [{ root: evil, id: 'z', label: evil, registered: false, otherKey: true, supported: true }]
      }),
      drives: [{ root: evil, sameDisk: false, free: 1, total: 2, stick: null }],
      setupOpen: true
    });
    api.renderUsbCard();
    api.renderUsbSetup();
    for (const h of [els['usb-body'].innerHTML, els['usb-setup'].innerHTML]) {
      assert.doesNotMatch(h, /<img/);
      assert.match(h, /&lt;img/);
    }
  });
});

describe('setting a stick up', () => {
  it('lets only usable drives be picked, and says why the others cannot', () => {
    const { els, api } = seite({
      usb: status(),
      setupOpen: true,
      drives: [
        { root: 'C:\\', sameDisk: true, free: 1e11, total: 5e11, stick: null },
        { root: 'E:\\', sameDisk: false, free: 6e10, total: 6.4e10, stick: null },
        {
          root: 'F:\\',
          sameDisk: false,
          free: 1,
          total: 2,
          stick: { registered: true, otherKey: false, supported: true }
        },
        {
          root: 'G:\\',
          sameDisk: false,
          free: 1,
          total: 2,
          stick: { registered: false, otherKey: true, supported: true }
        },
        {
          root: 'H:\\',
          sameDisk: false,
          free: 1,
          total: 2,
          stick: { registered: false, otherKey: false, supported: true }
        }
      ]
    });
    api.renderUsbSetup();
    const h = els['usb-setup'].innerHTML;
    const zeile = (root) => h.split('<label').find((l) => l.includes('value="' + root.replace('\\', '\\') + '"'));
    assert.match(zeile('C:\\'), /disabled/);
    assert.match(zeile('C:\\'), /usb\.driveSameDisk/);
    assert.doesNotMatch(zeile('E:\\'), /disabled/);
    assert.match(zeile('E:\\'), /usb\.driveSize\(free=60 GB,total=64 GB\)/);
    assert.match(zeile('F:\\'), /disabled[\s\S]*usb\.driveRegistered/);
    assert.match(zeile('G:\\'), /disabled[\s\S]*usb\.driveOtherKey/);
    assert.doesNotMatch(zeile('H:\\'), /disabled/, 'a forgotten stick of this installation can be taken back');
    assert.match(zeile('H:\\'), /usb\.driveKnown/);
  });

  it('points a stick from an earlier installation to the key field before there is a key', () => {
    const { els, api } = seite({
      usb: status({ configured: false, reminder: 'setup' }),
      setupOpen: true,
      drives: [
        {
          root: 'E:\\',
          sameDisk: false,
          free: 1,
          total: 2,
          stick: { registered: false, otherKey: false, supported: true }
        }
      ]
    });
    api.renderUsbSetup();
    assert.match(els['usb-setup'].innerHTML, /disabled[\s\S]*usb\.driveNeedsKey/);
  });

  it('cannot be confirmed while no drive is found', () => {
    const { els, api } = seite({ usb: status(), setupOpen: true, drives: [] });
    api.renderUsbSetup();
    assert.match(els['usb-setup'].innerHTML, /usb\.noDrives/);
    assert.match(els['usb-setup'].innerHTML, /data-usb="setup-go" disabled/);
  });

  it('is out of the way when closed', () => {
    const { els, api } = seite({ usb: status(), setupOpen: false });
    api.renderUsbSetup();
    assert.equal(els['usb-setup'].hidden, true);
    assert.equal(els['usb-setup'].innerHTML, '');
  });
});

describe('the recovery key box', () => {
  it('the first time, will not close until the key is said to be put away', () => {
    const { els, api } = seite({ key: { key: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789', fresh: true } });
    api.renderUsbKey();
    const h = els['usb-key'].innerHTML;
    assert.equal(els['usb-key'].hidden, false);
    assert.match(h, /<code class="usb-key-code">ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789<\/code>/);
    assert.match(h, /id="usb-key-saved"/);
    assert.match(h, /id="usb-key-done" data-usb="key-done" disabled/);
  });

  it('shown again on request, closes freely', () => {
    const { els, api } = seite({ key: { key: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789', fresh: false } });
    api.renderUsbKey();
    assert.doesNotMatch(els['usb-key'].innerHTML, /usb-key-saved/);
    assert.doesNotMatch(els['usb-key'].innerHTML, /disabled/);
  });

  it('leaves nothing behind once closed', () => {
    const { els, api } = seite({ key: null });
    els['usb-key'].innerHTML = 'old';
    api.renderUsbKey();
    assert.equal(els['usb-key'].hidden, true);
    assert.equal(els['usb-key'].innerHTML, '');
  });
});
