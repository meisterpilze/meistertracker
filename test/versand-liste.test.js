'use strict';
// Versand shows its list of orders only where a label can be bought. Without
// shipping set up the notice stands alone. The setup is readable by an admin
// only, so for somebody who may ship without being one it is unknown, and they
// keep the list: hiding it would take the labels away from the people who buy
// them. Run for real, against stubs of the page.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function lift(name) {
  const m = APP.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`, 'm'));
  assert.ok(m, `${name} not found in app.js — this file is testing nothing`);
  return m[0];
}

async function versand(answer) {
  const table = { hidden: false };
  const body = { innerHTML: '', closest: () => table };
  const warn = { style: { display: '' } };
  let listed = 0;
  const render = new Function(
    '$',
    '_ohEmpty',
    't',
    'authFetch',
    '_versandOrders',
    `${lift('renderOrdersVersand')}\nreturn renderOrdersVersand;`
  )(
    (id) => ({ 'versand-orders-body': body, 'versand-config-warn': warn })[id] || null,
    () => '<tr>…</tr>',
    (k) => k,
    () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)),
    () => listed++
  );
  render();
  await new Promise((ok) => setTimeout(ok, 0));
  return { listed, hidden: table.hidden, warn: warn.style.display };
}
const ok = (cfg) => ({ ok: true, json: () => Promise.resolve(cfg) });

describe('Versand: the list where a label can be bought', () => {
  it('lists the orders when shipping is set up, without the notice', async () => {
    assert.deepEqual(await versand(ok({ enabled: true, publicKey: 'pk' })), { listed: 1, hidden: false, warn: 'none' });
  });

  it('shows the notice alone when an admin reads that it is not set up', async () => {
    assert.deepEqual(await versand(ok({ enabled: false, publicKey: '' })), { listed: 0, hidden: true, warn: 'block' });
  });

  it('keeps the list for somebody who may ship but cannot read the setup', async () => {
    const r = await versand({ ok: false, status: 403, json: () => Promise.resolve({ error: 'admin' }) });
    assert.equal(r.listed, 1);
    assert.equal(r.hidden, false);
  });

  it('keeps the list when the setup cannot be fetched at all', async () => {
    assert.equal((await versand(new Error('offline'))).listed, 1);
  });
});
