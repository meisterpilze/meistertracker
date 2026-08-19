'use strict';
// What /api/print is allowed to say to the printer.
//
// The endpoint took the `zpl` field out of the request and handed it to the
// printer untouched. The label layout is generated in the browser, so "the
// client" means anybody with a login — and ZPL is a command language, not a
// document format. It reaches a long way past drawing: ^JU and ~JS persist
// configuration, ~DY and ^DF write files onto the printer's file system, the ^W*
// family reconfigures the wireless interface, ^KP sets a panel password, ~JR
// reboots it. A Link-OS printer on the lab network is a small networked
// computer, and this was a shell on it for anyone the app had let through the
// front door.
//
// The fix is an allowlist of the commands the label layouts actually emit. It
// has to be an allowlist: the command set is large, firmware adds to it, and
// ^CC / ~CC redefine the command character itself, so a blocklist written
// against `^` can be walked straight around.
//
// Every ^ and ~ in the payload counts as introducing a command, which is how the
// printer reads it. Legitimate labels never carry a bare one — zplText() strips
// both out of every data field in app.js and mcp-server.js before the string is
// assembled — so one inside ^FD data means the sender is not the client we ship.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mcp = require('../mcp-server.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const checkZpl = (() => {
  const pieces = [
    SRC.match(/const ZPL_ALLOWED_COMMANDS = new Set\(\[[\s\S]*?\]\);/),
    SRC.match(/const ZPL_FONT_RE = .*;/),
    SRC.match(/const ZPL_MAX_CHARS = .*;/),
    SRC.match(/const ZPL_MAX_LABELS = .*;/),
    SRC.match(/function checkZpl\(zpl\) \{[\s\S]*?\n\}/)
  ];
  assert.ok(pieces.every(Boolean), 'the ZPL allowlist has been rewritten — this test needs updating with it');
  return new Function(pieces.map((m) => m[0]).join('\n') + '\nreturn checkZpl;')();
})();

const batch = {
  batchId: 'FB-260101-01',
  species: 'Pleurotus ostreatus',
  strain: 'HK35',
  due: '2026-02-01T00:00:00Z',
  bagKg: 3
};

describe('the labels this app prints still print', () => {
  // The half of the fix that matters most: an allowlist that rejects a real
  // label is a broken printer, not a security improvement.
  it('accepts a bag label', () => {
    const zpl = mcp.itemsToZPL(mcp.bagLabelItems('FB-260101-01-01', batch, 'Detail', 123456, 'MT:bag', 3));
    assert.equal(checkZpl(zpl), null, 'rejected a bag label:\n' + zpl);
  });

  it('accepts a lab label', () => {
    const culture = { species: 'Pleurotus ostreatus', strain: 'HK35', type: 'MC', created: '2026-01-01' };
    const zpl = mcp.itemsToZPL(mcp.labLabelItems('MC-KINGS-250301-01', culture, 'Detail', 99, 'MT:culture'));
    assert.equal(checkZpl(zpl), null, 'rejected a lab label:\n' + zpl);
  });

  it('accepts the print-bridge self-test payload', () => {
    const testZpl = SRC.slice(SRC.indexOf('const testZpl ='), SRC.indexOf("'^XZ';", SRC.indexOf('const testZpl =')) + 6)
      .replace(/^const testZpl =/, '')
      .replace(/\+ new Date\(\)[\s\S]*?\.slice\(0, 19\) \+/, "+ '2026-01-01 10:00:00' +");
    const payload = new Function('return (' + testZpl.trim().replace(/;$/, '') + ')')();
    assert.equal(checkZpl(payload), null, 'the server refuses its own bridge test');
  });

  it('accepts every command the layout code can emit', () => {
    // Scanned out of the two generators rather than listed here, so adding a new
    // command to a label fails this test instead of failing at the printer.
    for (const file of ['app.js', 'mcp-server.js']) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      // Only inside single-quoted string literals — comments in app.js talk
      // about "~X bags" and similar.
      for (const lit of src.match(/'[^'\n]*'/g) || []) {
        if (!lit.includes('^X') && !/\^[A-Z]{2}/.test(lit)) continue;
        for (const m of lit.matchAll(/[\^~]([A-Z][A-Z0-9])/g)) {
          const probe = '^XA' + m[0] + '^XZ';
          assert.equal(checkZpl(probe), null, file + ' emits ' + m[0] + ' but the allowlist rejects it');
        }
      }
    }
  });
});

describe('and the ones it does not', () => {
  const hostile = {
    '^JU — persist configuration': '^XA^JUS^XZ',
    '^JS — persist print settings': '^XA^JSA^XZ',
    '~DY — write a file to the printer': '^XA^FD~DYE:EVIL,B,P,10,,data^FS^XZ',
    '^DF — store a format on the printer': '^XA^DFE:EVIL.ZPL^FS^XZ',
    '^XF — recall a stored format': '^XA^XFE:EVIL.ZPL^FS^XZ',
    '~JR — reboot': '^XA^FDx^FS^XZ~JR',
    '^WI — reconfigure the network interface': '^XA^WIA,192.168.1.1^XZ',
    '^KP — set the panel password': '^XA^KP1234^XZ',
    '^CC — redefine the command character': '^XA^CC#^XZ',
    '~CC — redefine it with a tilde': '^XA~CC#^XZ',
    '^MC — map clear': '^XA^MCN^XZ',
    '^A@ — load a font off the file system': '^XA^A@N,30,30,E:FONT.FNT^FDx^FS^XZ',
    '~HS — host status query': '^XA^FDx^FS^XZ~HS'
  };

  for (const [label, payload] of Object.entries(hostile)) {
    it('refuses ' + label, () => {
      const reason = checkZpl(payload);
      assert.ok(reason, payload + ' was accepted');
      assert.match(reason, /not allowed/);
    });
  }

  it('names what it refused, so a false positive is diagnosable', () => {
    assert.match(checkZpl('^XA^JUS^XZ'), /\^JU/);
  });

  it('is not fooled by lower case', () => {
    assert.ok(checkZpl('^XA^juS^XZ'), 'ZPL commands are case-insensitive to the printer');
  });

  it('catches a command hidden in what looks like field data', () => {
    // The printer does not know ^FD data from anything else; neither does this.
    assert.ok(checkZpl('^XA^FO0,0^FDharmless^JUS^FS^XZ'));
  });
});

describe('shape and size', () => {
  it('rejects an empty or non-string payload', () => {
    for (const v of ['', '   ', null, undefined, 42, {}, []]) {
      assert.ok(checkZpl(v), JSON.stringify(v) + ' was accepted');
    }
  });

  it('requires a format to start and end', () => {
    assert.match(checkZpl('^FO0,0^FDx^FS'), /\^XA and \^XZ/);
    assert.match(checkZpl('^XA^FDx^FS'), /\^XA and \^XZ/);
  });

  it('caps the size, well above a real job', () => {
    const one = '^XA^FO0,0^A0N,20,20^FDlabel^FS^XZ';
    assert.equal(checkZpl(one.repeat(100)), null, '100 labels is an ordinary batch');
    assert.match(checkZpl(one.repeat(3000)), /too many labels/);
    assert.match(checkZpl('^XA^FD' + 'x'.repeat(2 * 1024 * 1024) + '^FS^XZ'), /too large/);
  });
});

describe('the gate sits under printZPL, not in one route', () => {
  it('so /api/print, the bridge self-test and the MCP tools are all covered', () => {
    const fn = SRC.match(/function printZPL\(zplData, callback\) \{[\s\S]*?\n\}/)[0];
    assert.match(fn, /checkZpl\(zplData\)/);
    assert.ok(fn.indexOf('checkZpl') < fn.indexOf('_printViaBridge'), 'the check has to run before either transport');
    assert.match(fn, /return callback\('Refused: ' \+ bad\);/);
  });

  it('and printZPL is what the MCP server is handed', () => {
    assert.match(SRC, /createMcpServer\(database, \(\) => broadcastSSE\(null\), \{\s*\n?\s*printZPL,/);
  });
});
