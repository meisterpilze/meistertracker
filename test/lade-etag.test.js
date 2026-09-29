'use strict';
// loadData merkt sich das ETag des Standes, den es zeichnet.
//
// Nach Entfernen, Zurueckholen oder einem Foto-Upload laedt die Seite den Stand
// mit loadData neu. Der Server meldet dieselbe Aenderung per SSE, und die
// Abfrage darauf fragte ohne If-None-Match, weil loadData das ETag nicht
// behielt: derselbe volle Stand kam ein zweites Mal. Jetzt antwortet der Server
// darauf mit 304.
//
// Alle Inhalte hier sind ausgedacht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hebeFunktion } = require('./helpers/quelle');

describe('loadData und pollSync', () => {
  it('fragt nach einem loadData mit dessen ETag', async () => {
    const ui = new Function(`
      const anfragen = [];
      const authFetch = async (pfad, init) => {
        anfragen.push((init && init.headers && init.headers['If-None-Match']) || null);
        const aktuell = anfragen.length === 1 || !(init && init.headers);
        return {
          ok: true,
          status: aktuell ? 200 : 304,
          headers: { get: (k) => (k === 'ETag' ? '"v12"' : null) },
          json: async () => ({ build: 'b', experiments: [] })
        };
      };
      let _polling = false;
      let _lastEtag = null;
      const _pollWaiters = [];
      const POLL_TIMEOUT_MS = 1000;
      let _mutating = 0;
      let lastHash = null;
      let lastSyncTime = 0;
      const setSyncStatus = () => {};
      const t = (k) => k;
      const formatRelativeTime = () => '';
      const applyData = () => {};
      const refresh = () => {};
      const restoreAfterUpdate = () => {};
      const noteServerBuild = () => {};
      const refreshSubstrateBatches = () => {};
      ${['dataResponse', 'loadData', 'pollSync'].map((n) => hebeFunktion(n)).join('\n')}
      return { loadData, pollSync, anfragen };`)();
    await ui.loadData();
    await ui.pollSync();
    assert.deepEqual(ui.anfragen, [null, '"v12"'], 'the follow-up poll can be answered with 304');
  });
});
