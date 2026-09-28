'use strict';
// Körnerbrut, die in Blöcke gegangen ist, geht aus dem Bestand — und bleibt mit
// der Charge verbunden, die aus ihr wurde.
//
// Zwei Wünsche. Erstens: Wird ein Körnerbeutel benutzt, soll er sich scannen
// und als 'verbraucht' buchen lassen, damit er aus dem Bestand geht — mit
// einem Knopf im Scan-Fenster. Bis dahin blieb nur Entsorgen, und
// dann zählte ein verbrauchter Beutel als weggeworfen. Zweitens: beim Anlegen
// einer Charge die Körnerbrut fotografieren (scannen), was es schon gab —
// das lange Formular und der Schnelldialog konnten es, der geführte Ablauf, der
// seit den Kacheln der einzige Weg ist, nicht.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { quelle, hebeFunktion, hebeKonstante } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const SERVER = quelle('server.js');
const hebe = (n) => hebeFunktion(n, APP);

const G = 'G-CHUT-070926-01';
const BRUT = {
  batchId: G,
  batchType: 'grain',
  species: 'Chestnut (CHUT)',
  strain: 'CHUT',
  strainId: 6,
  strainName: 'Chestnut',
  strainText: 'CHEKQ07',
  bags: [G + '-01', G + '-02', G + '-03', G + '-04']
};
const BLOCK = {
  batchId: 'CHUT-280926-01',
  batchType: 'block',
  species: 'Chestnut (CHUT)',
  strainId: 6,
  bags: ['CHUT-280926-01-01', 'CHUT-280926-01-02']
};
const RESH = {
  batchId: 'G-RESH-170926-01',
  batchType: 'grain',
  species: 'Reishi (RESH)',
  strainId: 8,
  strainName: 'Reishi',
  strainText: '',
  bags: ['G-RESH-170926-01-01']
};
const liegt = (bag, to, action, reason) => ({
  action: action || 'ADD',
  batch: bag.split('-').slice(0, -1).join('-'),
  bag,
  to: to === undefined ? 'SPAWN_R1' : to,
  reason: reason || null
});
const aus = () => ({ action: null, to: null, from: null, count: 0, harvestBag: null });
const verbraucht = () => ({ ...aus(), action: 'USED' });

// processScan() gegen Attrappen, wie in scan-in-serie.test.js — dazu, was
// "Verbraucht" bucht.
function werkbank(stand) {
  return new Function(
    'stand',
    `
    const fb = [];
    const gepostet = [];
    const beutelFenster = [];
    const kameraZu = [];
    const wege = [];
    const setTimeout = () => 0;
    const clearTimeout = () => {};
    const t = (k, p) => (p ? k + ' ' + JSON.stringify(p) : k);
    const setFb = (type, msg) => fb.push({ type, msg });
    const _scanBeep = () => {};
    const updateSD = () => {};
    const rememberDest = () => {};
    ${hebeKonstante('ACTIONS', APP)}
    const zones = [
      { id: 'INC', racks: [{ id: 'INC_R1' }], role: 'incubation' },
      { id: 'SPAWN', racks: [{ id: 'SPAWN_R1' }], role: 'spawn' },
      { id: 'CONTAM', racks: [], role: 'contaminated' }
    ];
    const LOCS = zones.flatMap((z) => [z.id, ...z.racks.map((r) => r.id)]);
    const zoneDisplayName = (id) => id;
    const toZone = (loc) => String(loc).split('_')[0];
    const barcodeRegistry = new Map(stand.barcodes || []);
    const batches = stand.batches || [];
    const cultures = stand.cultures || [];
    const scanLog = stand.scanLog || [];
    const movements = [];
    const sessionEntries = [];
    let sessionStartTime = null;
    const scanChannel = null;
    const currentUser = { username: 'test' };
    let _scanTempIdCounter = 0;
    let uuid = 0;
    const newScanUuid = () => 'uuid-' + ++uuid;
    const postScanEntries = (e) => gepostet.push(...e);
    let _lastScanVal = null;
    let scan = stand.scan;
    let _modeRun = stand.lauf || null;
    let _pendingDupe = null;
    let _pendingDupeTimer = null;
    let _pendingPlace = null;
    let _pendingPlaceTimer = null;
    let _statusByBatch = 'alt';
    let _placementByBag = 'alt';
    let _rhythmIndex = 'alt';
    const CONFIRM_SCAN_MS = 8000;
    const _zcScanMode = false;
    const _zcMode = null;
    const labCheckScanned = () => {};
    const zoneCheckScanned = () => {};
    const _inocScanPrefix = null;
    const inocAdd = () => null;
    const inocRender = () => {};
    const closeCamScan = () => kameraZu.push(true);
    const go = (...a) => wege.push(a);
    const openStab = () => {};
    const renderLineage = () => {};
    const renderNbGrainBanner = () => {};
    const lwPreview = () => {};
    const el = { classList: { contains: () => false, add() {}, remove() {}, toggle() {} }, style: {}, value: '' };
    const document = { getElementById: () => el };
    const bsBatchId = null;
    const bsToggleBag = () => ({ toggled: false });
    const spAbbrev = () => '';
    const openBagInfo = (bag) => beutelFenster.push(bag);
    const showHarvestPanel = () => {};
    const _crTargets = [];
    const crToggleTarget = () => ({ added: true, count: 1 });
    const _crRenderTargets = () => {};
    const openContamReport = () => {};
    const moveBatchTo = () => {};
    const armScanAction = (v) => { scan.action = v; };
    const scanAfterSync = () => {};
    ${hebe('modeRunTally')}
    ${hebe('scanActionName')}
    ${hebe('cultureRefusal')}
    ${hebe('buildLastPlacementByBag')}
    ${hebe('istVerbraucht')}
    ${hebe('spawnBuchen')}
    ${hebe('verbrauchtScan')}
    ${hebe('processScan')}
    return {
      scan: (raw) => processScan(raw, { synced: true }),
      fb,
      letzte: () => fb[fb.length - 1],
      gepostet,
      runde: sessionEntries,
      beutelFenster,
      kameraZu,
      wege,
      zustand: () => scan,
      lauf: () => _modeRun,
      caches: () => [_statusByBatch, _placementByBag, _rhythmIndex]
    };
  `
  )(stand);
}

describe('Verbraucht — der Scan', () => {
  it('bucht jeden Körnerbeutel mit einem Scan aus, als verbraucht, nicht als entsorgt', () => {
    const w = werkbank({
      scan: verbraucht(),
      batches: [BRUT],
      scanLog: [liegt(G + '-01'), liegt(G + '-02', 'INC_R1')]
    });
    w.scan(G + '-01');
    w.scan(G + '-02');
    assert.deepEqual(
      w.gepostet.map((e) => [e.action, e.bag, e.from, e.to, e.reason, e.batch]),
      [
        ['REMOVE', G + '-01', 'SPAWN_R1', null, 'spawn', G],
        ['REMOVE', G + '-02', 'INC_R1', null, 'spawn', G]
      ]
    );
    assert.equal(w.lauf().action, 'USED');
    assert.equal(w.lauf().n, 2);
    assert.match(w.letzte().msg, /^scanFb\.usedLogged .*"n":2/);
    assert.equal(w.zustand().action, 'USED', 'Verbraucht bleibt an');
    assert.equal(w.runde.length, 2, 'beide stehen in der Runde, ↩ nimmt sie zurück');
    assert.deepEqual(w.caches(), [null, null, null], 'der Bestand auf dem Telefon rechnet neu');
  });

  it('nimmt auch einen Beutel, der nie eingelagert wurde — der zählt im Bestand mit', () => {
    const w = werkbank({ scan: verbraucht(), batches: [BRUT], scanLog: [] });
    w.scan(G + '-03');
    assert.equal(w.gepostet.length, 1);
    assert.equal(w.gepostet[0].from, null);
    assert.equal(w.gepostet[0].reason, 'spawn');
  });

  it('nimmt keinen Block: dafür gibt es Entsorgen', () => {
    const w = werkbank({ scan: verbraucht(), batches: [BLOCK], scanLog: [liegt('CHUT-280926-01-01', 'INC_R1')] });
    w.scan('CHUT-280926-01-01');
    assert.equal(w.gepostet.length, 0);
    assert.equal(w.letzte().type, 'err');
    assert.match(w.letzte().msg, /^scanFb\.usedNotGrain /);
  });

  it('will den einzelnen Beutel, nicht die ganze Charge', () => {
    // Eine Chargen-Nummer ohne Beutelnummer dahinter. Die heutigen enden auf
    // -01 und lesen sich darum schon als Beutel; ältere tun das nicht.
    const alt = { ...BRUT, batchId: 'G-OLD-2025-001', bags: ['G-OLD-2025-001-01'] };
    const w = werkbank({ scan: verbraucht(), batches: [alt], scanLog: [] });
    w.scan('G-OLD-2025-001');
    assert.equal(w.gepostet.length, 0);
    assert.match(w.letzte().msg, /^scanFb\.usedNeedsBag /);
  });

  it('bucht einen schon verbrauchten Beutel nicht ein zweites Mal', () => {
    const w = werkbank({
      scan: verbraucht(),
      batches: [BRUT],
      scanLog: [liegt(G + '-01'), liegt(G + '-01', null, 'REMOVE', 'spawn:CHUT-280926-01')]
    });
    w.scan(G + '-01');
    assert.equal(w.gepostet.length, 0);
    assert.equal(w.letzte().type, 'warn');
    assert.match(w.letzte().msg, /^scanFb\.alreadyUsed /);
  });

  it('sagt bei einem entsorgten Beutel "entsorgt", nicht "verbraucht"', () => {
    const w = werkbank({
      scan: verbraucht(),
      batches: [BRUT],
      scanLog: [liegt(G + '-01'), liegt(G + '-01', null, 'REMOVE')]
    });
    w.scan(G + '-01');
    assert.equal(w.gepostet.length, 0);
    assert.match(w.letzte().msg, /^scanFb\.alreadyRemoved /);
  });

  it('eine Kultur unterbricht die Reihe nicht: Meldung statt Stammbaum', () => {
    const w = werkbank({
      scan: verbraucht(),
      cultures: [{ id: 'LC-CHUT-200926-01', status: 'active' }]
    });
    w.scan('LC-CHUT-200926-01');
    assert.equal(w.letzte().type, 'err');
    assert.match(w.letzte().msg, /^scanFb\.usedNotCulture /);
    assert.deepEqual(w.kameraZu, [], 'die Kamera bleibt offen');
    assert.deepEqual(w.wege, [], 'und springt nicht ins Labor');
    assert.equal(w.zustand().action, 'USED');
  });

  it('ohne Vorgang öffnet ein Körnerbeutel weiter sein Beutel-Fenster', () => {
    const w = werkbank({ scan: aus(), batches: [BRUT], scanLog: [liegt(G + '-01')] });
    w.scan(G + '-01');
    assert.deepEqual(w.beutelFenster, [G + '-01']);
    assert.equal(w.gepostet.length, 0);
  });

  it('das gedruckte Etikett USED stellt Verbraucht scharf wie der Knopf', () => {
    assert.match(APP, /const ACTIONS = \[[^\]]*'USED'\]/);
    assert.match(APP, /items: \['ADD', 'MOVE', 'MOVE_BATCH', 'REMOVE', 'HARVEST', 'CONTAM', 'USED'\]/);
    assert.match(hebe('armScanAction'), /USED: t\('cam\.usedArmed'\)/);
  });
});

// Der Knopf selbst: an, aus, Zahl — wie Ernten und Entsorgen.
function knopf(scanZustand, lauf) {
  return new Function(
    'scan',
    '_modeRun',
    `
    const els = {};
    const mk = () => {
      const cls = new Set();
      return {
        hidden: false,
        textContent: '',
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        classList: { toggle(c, an) { if (an) cls.add(c); else cls.delete(c); }, has: (c) => cls.has(c) }
      };
    };
    for (const n of ['move', 'harvest', 'trash', 'used']) {
      els['btn-cam-' + n] = mk();
      els['cam-' + n + '-count'] = mk();
    }
    els['cam-move-idle'] = mk();
    els['cam-move-to'] = mk();
    const document = { getElementById: (id) => els[id] || null };
    const zoneDisplayName = (id) => id;
    const t = (k, p) => (p ? k + ' ' + JSON.stringify(p) : k);
    const fb = [];
    const setFb = (type, msg) => fb.push({ type, msg });
    const updateSD = () => updateCamModeBtns();
    const _crTargets = [];
    let _pendingDupe = null, _pendingPlace = null;
    let _pendingDupeTimer = null, _pendingPlaceTimer = null;
    const MODE_RUN_KEEP_MS = 15 * 60 * 1000;
    ${hebe('modeRunCount')}
    ${hebe('updateCamModeBtns')}
    ${hebe('armMode')}
    ${hebe('endModeRun')}
    ${hebe('contamPending')}
    ${hebe('toggleModeScan')}
    ${hebe('modeRunResumable')}
    updateCamModeBtns();
    return {
      els,
      letzte: () => fb[fb.length - 1],
      tippen: () => toggleModeScan('USED'),
      zustand: () => scan,
      lauf: () => _modeRun,
      weiter: () => modeRunResumable()
    };
  `
  )(scanZustand, lauf);
}

describe('Der Knopf Verbraucht', () => {
  it('ein Tipp stellt scharf und sagt, was jetzt passiert', () => {
    const k = knopf(aus(), null);
    k.tippen();
    assert.equal(k.zustand().action, 'USED');
    assert.ok(k.els['btn-cam-used'].classList.has('on'));
    assert.equal(k.els['btn-cam-used'].attrs['aria-pressed'], 'true');
    assert.equal(k.letzte().msg, 'cam.usedArmed');
  });

  it('zeigt, wieviele es schon waren, und der zweite Tipp sagt es noch einmal', () => {
    const k = knopf(verbraucht(), { action: 'USED', to: null, n: 3, at: Date.now() });
    assert.equal(k.els['cam-used-count'].textContent, '3');
    assert.equal(k.els['cam-used-count'].hidden, false);
    k.tippen();
    assert.equal(k.zustand().action, null);
    assert.ok(!k.els['btn-cam-used'].classList.has('on'));
    assert.match(k.letzte().msg, /^cam\.usedEnded .*"n":3/);
  });

  it('überlebt die geschlossene Kamera nie — wie Entsorgen', () => {
    const k = knopf(verbraucht(), { action: 'USED', to: null, n: 2, at: Date.now() - 60 * 1000 });
    assert.equal(k.weiter(), false);
  });

  it('steht als fünfte Kachel in der Kamera und ist verdrahtet', () => {
    const modi = HTML.slice(HTML.indexOf('id="cam-hud-modes"'), HTML.indexOf('class="cam-hud-btns"'));
    assert.match(modi, /id="btn-cam-used"[\s\S]*data-i18n="cam\.used"[\s\S]*id="cam-used-count"/);
    assert.match(APP, /\['btn-cam-used', \(\) => toggleModeScan\('USED'\)\]/);
  });
});

describe('↩ in der Kamera', () => {
  it('nimmt den letzten Eintrag zurück, auch ohne seine Zeile im Verlauf', () => {
    // Mehrere Beutel auf einmal (Beutel-Fenster, "Ganze Charge") schreiben eine
    // Meldung, keine Zeile je Beutel. ↩ suchte vorher die Zeile und tat ohne
    // sie nichts.
    const r = new Function(`
      const a = { _tempId: 's1', action: 'REMOVE', bag: 'G-1', _serverId: 11, _run: 'USED' };
      const b = { _tempId: 's2', action: 'REMOVE', bag: 'G-2', _serverId: 12, _run: 'USED' };
      const sessionEntries = [a, b];
      const scanLog = [a, b];
      const movements = [a, b];
      const scan = { count: 2 };
      let _modeRun = { action: 'USED', to: null, n: 2 };
      const geloescht = [];
      const apiDelete = (u) => geloescht.push(u);
      const dropQueuedScanEntry = () => false;
      const document = { querySelector: () => null };
      const _showCamHudToast = () => {};
      const _scanBeep = () => {};
      const fb = [];
      const setFb = (type, msg) => fb.push(msg);
      const updateSD = () => {};
      const renderStatus = () => {};
      const t = (k, p) => k + ' ' + JSON.stringify(p);
      const zoneDisplayName = (x) => x;
      ${hebe('modeRunUntally')}
      ${hebe('undoneMsg')}
      ${hebe('scanEintragZuruecknehmen')}
      ${hebe('scanRueckgaengig')}
      ${hebe('camUndoLastScan')}
      camUndoLastScan();
      return { geloescht, runde: sessionEntries.length, log: scanLog.length, n: _modeRun.n, count: scan.count, fb };
    `)();
    assert.deepEqual(r.geloescht, ['/api/scan-log/12']);
    assert.equal(r.runde, 1);
    assert.equal(r.log, 1);
    assert.equal(r.n, 1, 'der Zähler auf dem Knopf geht mit zurück');
    assert.equal(r.count, 1);
    assert.match(r.fb[0], /^scanFb\.undone /);
  });
});

describe('Was im Bestand zählt, kann man verbrauchen', () => {
  function verfuegbar(scanLog) {
    return new Function(
      'scanLog',
      'batches',
      `
      const ZONE_BY_ID = { SPAWN: { role: 'spawn' }, INC: { role: 'incubation' }, CONTAM: { role: 'contaminated' } };
      const toZone = (loc) => String(loc).split('_')[0];
      ${hebe('buildLastPlacementByBag')}
      ${hebe('nbAvailableSpawnBags')}
      return nbAvailableSpawnBags().map((b) => b.bag + '@' + b.loc + '#' + b.strainId);
    `
    )(scanLog, [BRUT, BLOCK]);
  }

  it('dieselbe Regel wie _grainKgOf: kein REMOVE, nicht kontaminiert — eingelagert oder nicht', () => {
    const liste = verfuegbar([
      liegt(G + '-01'),
      liegt(G + '-02'),
      liegt(G + '-02', null, 'REMOVE', 'spawn'),
      liegt(G + '-03', 'CONTAM'),
      liegt('CHUT-280926-01-01', 'INC_R1')
    ]);
    assert.deepEqual(liste, [G + '-01@SPAWN_R1#6', G + '-04@null#6']);
  });
});

describe('Beim Anlegen: Körnerbrut, deren Antwort feststeht, ohne Frage ausbuchen', () => {
  function anlegen(liste, scanLog) {
    return new Function(
      'liste',
      'scanLogIn',
      `
      const batches = [${JSON.stringify(BRUT)}];
      const scanLog = scanLogIn;
      const movements = [];
      const sessionEntries = [];
      let sessionStartTime = null;
      const scan = { count: 0 };
      const cultures = [{ id: 'LC-CHUT-1', status: 'active' }];
      const currentUser = { username: 'test' };
      let _scanTempIdCounter = 0;
      let uuid = 0;
      const newScanUuid = () => 'u' + ++uuid;
      const gepostet = [];
      const postScanEntries = (e) => gepostet.push(...e);
      let _statusByBatch = null, _placementByBag = null, _rhythmIndex = null;
      const gefragt = [];
      const confirm2 = (titel, text) => gefragt.push(text);
      const toasts = [];
      const toast = (m) => toasts.push(m);
      const status = [];
      const setCultureStatus = (id, s) => status.push(id + '=' + s);
      const nbConsumeSpawnBags = () => { throw new Error('nicht der Weg mit Frage'); };
      const t = (k, p) => k + ' ' + JSON.stringify(p);
      ${hebe('buildLastPlacementByBag')}
      ${hebe('spawnBuchen')}
      ${hebe('inocVerbrauchtBuchen')}
      ${hebe('inocConsume')}
      ${hebe('inocAskConsume')}
      inocAskConsume({ batchId: 'CHUT-280926-01' }, liste);
      return { gepostet, gefragt, toasts, status };
    `
    )(liste, scanLog);
  }

  it('bucht die Körnerbeutel mit der neuen Charge als Grund, fragt nicht, verbraucht die Kultur nicht', () => {
    const r = anlegen(
      [
        { kind: 'bag', id: G + '-01', spent: true },
        { kind: 'bag', id: G + '-02', spent: true },
        { kind: 'culture', id: 'LC-CHUT-1', spent: false }
      ],
      [liegt(G + '-01'), liegt(G + '-02')]
    );
    assert.deepEqual(
      r.gepostet.map((e) => [e.bag, e.reason, e.from]),
      [
        [G + '-01', 'spawn:CHUT-280926-01', 'SPAWN_R1'],
        [G + '-02', 'spawn:CHUT-280926-01', 'SPAWN_R1']
      ]
    );
    assert.deepEqual(r.gefragt, []);
    assert.deepEqual(r.status, [], 'eine Kultur hält meist für mehr als eine Charge');
    assert.match(r.toasts[0], /^batch\.spawnConsumed .*"n":2/);
  });

  it('ein Körnerbeutel ist immer verbraucht, auch ohne Antwort (langes Formular, Schnelldialog)', () => {
    // Ein Körnerbeutel gilt beim Beimpfen als ganz verbraucht — gefragt wird nicht mehr.
    const r = anlegen([{ kind: 'bag', id: G + '-01' }], [liegt(G + '-01')]);
    assert.deepEqual(
      r.gepostet.map((e) => [e.bag, e.reason]),
      [[G + '-01', 'spawn:CHUT-280926-01']]
    );
    assert.deepEqual(r.gefragt, []);
  });

  it('gefragt wird nur noch nach einer Kultur', () => {
    const r = anlegen(
      [
        { kind: 'bag', id: G + '-01' },
        { kind: 'culture', id: 'LC-CHUT-1' }
      ],
      [liegt(G + '-01')]
    );
    assert.equal(r.gepostet.length, 1, 'der Beutel geht gleich');
    assert.equal(r.gefragt.length, 1);
    assert.match(r.gefragt[0], /"names":"LC-CHUT-1"/, 'die Frage nennt nur die Kultur');
  });
});

describe('Der Schnelldialog gibt seine Beimpf-Liste weiter', () => {
  const q = hebe('msQuickConfirm');

  it('an die Körnerbrut, auf beiden Wegen dorthin', () => {
    // msQuickClose() leert die Liste. Vorher ging sie auf dem Weg zur
    // Körnerbrut verloren: kein Elternteil, kein verbrauchter Körnerbeutel.
    const wege = q.split('createGrainBatch();').slice(0, -1);
    assert.equal(wege.length, 2, 'zwei Wege zu createGrainBatch');
    for (const w of wege) assert.match(w.slice(-200), /msQuickClose\(\);[\s\S]*_inoc = inocMit;\s*$/);
  });

  it('an die Charge Blöcke, wie bisher', () => {
    assert.match(q, /nbFillFromStrain\(ms, \{[^}]*inoc: inocMit/);
  });

  it('und nimmt die gescannte Kultur als Herkunft, wo das versteckte Feld leer ist', () => {
    assert.match(q, /\.value\) \|\| inocCultureId\(\);/);
    assert.ok(q.indexOf('const inocMit = _inoc.slice();') < q.indexOf('msQuickClose();'));
  });
});

describe('Beimpft mit, im geführten Ablauf', () => {
  function ablauf(inocStart, strainId) {
    return new Function(
      'inocStart',
      'strainIdStart',
      `
      const batches = ${JSON.stringify([BRUT, RESH])};
      const cultures = [{ id: 'LC-CHUT-1', status: 'active', strainId: 6, type: 'LC', strainName: 'Chestnut' }];
      const scanLog = [];
      const mushroomStrains = [{ id: 6, name: 'Chestnut' }, { id: 8, name: 'Reishi' }, { id: 1, name: 'Lions Mane' }];
      const staemme = [{ strainId: 6, name: 'CHEKQ07' }];
      const staemmeFor = (id) => staemme.filter((s) => s.strainId === id);
      const stammGleich = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
      const ZONE_BY_ID = {};
      const toZone = (x) => x;
      const zoneDisplayName = (x) => x;
      const t = (k, p) => (p ? k + ' ' + JSON.stringify(p) : k);
      const WKB = { step: 1, strainId: strainIdStart };
      let _inoc = inocStart;
      let gezeichnet = 0;
      const wkbReadStep = () => {};
      const wkbRender = () => gezeichnet++;
      ${hebeKonstante('STAMM', APP)}
      ${hebe('stammState')}
      ${hebe('wkbStrain')}
      ${hebe('buildLastPlacementByBag')}
      ${hebe('nbAvailableSpawnBags')}
      ${hebe('inocAvailable')}
      ${hebe('inocAdd')}
      ${hebe('wkbInocAdd')}
      return {
        add: (id) => wkbInocAdd(id),
        liste: () => _inoc.map((x) => x.kind + ':' + x.id),
        sorte: () => WKB.strainId,
        stamm: () => stammState('wkb').wert,
        gezeichnet: () => gezeichnet
      };
    `
    )(inocStart, strainId);
  }

  it('der erste Körnerbeutel bringt Sorte und Stamm mit', () => {
    const a = ablauf([], 1);
    assert.equal(a.add(G + '-02'), null);
    assert.equal(a.sorte(), 6, 'Chestnut statt Lions Mane');
    assert.equal(a.stamm(), 'CHEKQ07');
    assert.deepEqual(a.liste(), ['bag:' + G + '-02']);
    assert.ok(a.gezeichnet() > 0, 'der Ablauf zeigt es gleich');
  });

  it('nimmt keine Brut einer anderen Sorte dazu', () => {
    const a = ablauf([{ kind: 'bag', id: G + '-01' }], 6);
    assert.match(a.add('G-RESH-170926-01-01'), /^work\.bInocOtherSorte .*"sorte":"Reishi".*"charge":"Chestnut"/);
    assert.deepEqual(a.liste(), ['bag:' + G + '-01']);
  });

  it('eine Kultur ändert die Sorte nicht', () => {
    const a = ablauf([], 8);
    assert.equal(a.add('LC-CHUT-1'), null);
    assert.equal(a.sorte(), 8);
    assert.deepEqual(a.liste(), ['culture:LC-CHUT-1']);
  });

  it('der erste Schritt hat den Scan-Knopf und die Auswahl, ganz oben', () => {
    const r = hebe('wkbRender');
    const eins = r.slice(r.indexOf('if (WKB.step === 1) {'), r.indexOf('} else if (WKB.step === 2) {'));
    assert.ok(eins.indexOf('data-wkb="inoc-scan"') > 0);
    assert.ok(eins.indexOf('data-wkb="inoc-scan"') < eins.indexOf('id="wkb-strain"'), 'vor der Sorte');
    assert.match(eins, /id="wkb-inoc-pick"/);
    assert.match(eins, /id="wkb-inoc-chips"/);
    assert.match(r, /inocRender\('wkb'\)/);
    assert.match(r, /wkbInocZeile\(\)/, 'und die Zusammenfassung sagt, was ausgebucht wird');
  });

  it('beide Wege des Anlegens nehmen die Liste mit', () => {
    const c = hebe('wkbCreate');
    assert.ok(
      c.indexOf('const inoc = wkbInocListe();') < c.indexOf('await stammFertig'),
      'kopiert, bevor der Ablauf zugeht'
    );
    assert.match(c, /wkbCreateFromShelf\(stamm, angesetzt, inoc\)/);
    assert.match(c, /sourceId: kultur \? kultur\.id : undefined/);
    assert.match(c, /inocVerbrauchtBuchen\(neu, inoc\)/);
    assert.match(hebe('wkbCreateFromShelf'), /inoc: inoc \|\| \[\]/);
    assert.match(hebe('createBatchFromSubstrate'), /opts\.sourceId \? \{ sourceId: opts\.sourceId \}/);
    assert.match(hebe('wkbInocListe'), /spent: x\.kind === 'bag'/);
  });

  it('der Scan-Knopf öffnet die Kamera für den Ablauf', () => {
    assert.match(APP, /if \(a === 'inoc-scan'\) \{[\s\S]{0,400}msqOpenScan\('wkb'\);/);
    const p = hebe('processScan');
    assert.match(p, /_inocScanPrefix === 'wkb' \? wkbInocAdd\(val\) : inocAdd\(val\)/);
    assert.match(p, /_inocScanPrefix === 'wkb' \? wkbInocAdd\(hit\.id\) : inocAdd\(hit\.id\)/);
  });

  it('wer den Ablauf verlässt, nimmt die Liste nicht in die nächste Charge mit', () => {
    assert.match(hebe('wkfClose'), /if \(WKF\.kind === 'batch'\) _inoc = \[\];/);
    assert.match(hebe('wkbOpen'), /_inoc = \[\];/);
  });
});

describe('Das Beutel-Fenster eines Körnerbeutels', () => {
  function knoepfe(batch, scanLog) {
    return new Function(
      'batch',
      'scanLog',
      `
      const out = { innerHTML: '' };
      const document = { getElementById: (id) => (id === 'bi-actions' ? out : null) };
      const batches = [batch];
      const biBatchId = batch.batchId;
      const biBagId = batch.bags[0];
      const biWholeBatch = false;
      const ZONE_BY_ID = { SPAWN: { role: 'spawn' }, INC: { role: 'incubation' }, TENT1: { role: 'fruiting' } };
      const toZone = (loc) => String(loc).split('_')[0];
      const _fruitingDest = () => 'TENT1';
      const esc = (s) => String(s);
      const t = (k) => k;
      ${hebe('_biBagCurrentLoc')}
      ${hebe('renderBiActions')}
      renderBiActions();
      return out.innerHTML;
    `
    )(batch, scanLog);
  }

  it('bietet "Verbraucht" als großen Knopf an, nicht "→ Fruchtung"', () => {
    const html = knoepfe(BRUT, [liegt(G + '-01')]);
    assert.match(html, /data-bi="used"/);
    assert.doesNotMatch(html, /data-bi="fruchtung"/);
  });

  it('ein Block im Spawn-Zelt bekommt weiter "→ Fruchtung"', () => {
    const html = knoepfe(BLOCK, [liegt('CHUT-280926-01-01', 'SPAWN_R1')]);
    assert.match(html, /data-bi="fruchtung"/);
    assert.doesNotMatch(html, /data-bi="used"/);
  });

  it('der Knopf bucht aus und führt zurück in die Kamera, mit Rückgängig', () => {
    assert.match(APP, /if \(a === 'used'\) return biMarkUsed\(\);/);
    const f = hebe('biMarkUsed');
    assert.match(
      f,
      /biRearmScanner\(\);[\s\S]*spawnBuchen\(biWholeBatch \? b\.bags \|\| \[\] : \[biBagId\], 'spawn', \{ sitzung: true \}\)/
    );
    assert.match(f, /showUndoBar\(msg, \(\) => spawnZuruecknehmen\(entries\)\)/);
  });
});

describe('Verbrauchte Körnerbrut ist keine Kontamination', () => {
  it('der Bericht zählt "spawn" und "spawn:<Charge>" nicht mit', () => {
    const db = require('../db.js');
    const p = path.join(os.tmpdir(), 'mt_kb_test_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db');
    const d = db.openDb(p);
    try {
      const zeit = '2026-09-28T09:00:00.000Z';
      db.appendScanEntries(
        d,
        [
          {
            time: zeit,
            action: 'REMOVE',
            batch: G,
            bag: G + '-01',
            from: 'SPAWN_R1',
            reason: 'spawn',
            client_uuid: 'k1'
          },
          {
            time: zeit,
            action: 'REMOVE',
            batch: G,
            bag: G + '-02',
            from: 'SPAWN_R1',
            reason: 'spawn:CHUT-280926-01',
            client_uuid: 'k2'
          },
          {
            time: zeit,
            action: 'MOVE',
            batch: 'CHUT-280926-01',
            bag: 'CHUT-280926-01-01',
            from: 'INC_R1',
            to: 'CONTAM',
            reason: 'contam_tricho',
            client_uuid: 'k3'
          }
        ],
        null
      );
      const bericht = db.getContaminationReport(d, 'month');
      assert.equal(bericht.totalContam, 1);
    } finally {
      d.close();
      fs.unlinkSync(p);
    }
  });

  it('der Server nimmt die Herkunft nur als kurzen Text an', () => {
    const i = SERVER.indexOf("req.url === '/api/batches/from-substrate'");
    const route = SERVER.slice(i, i + 2500);
    assert.match(route, /sourceId: 'string'/);
    assert.match(route, /sourceId: 100/);
  });
});
