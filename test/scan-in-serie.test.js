'use strict';
// Vier Knöpfe in der Kamera, und Meldungen, die sagen, was los ist.
//
// Am Telefon gab es keinen Weg, viele Beutel hintereinander umzuziehen, zu
// ernten oder zu entsorgen, ohne für jeden Beutel das Beutel-Fenster zu öffnen.
// Der Scanner konnte es — ein gesetzter Vorgang bleibt stehen —, nur lag die
// Tür hinter gedruckten Etiketten (MOVE, HARVEST, REMOVE) oder dem kleinen
// "Nach"-Feld, und dessen Liste ging HINTER dem Kamerabild auf. Jetzt: Knopf
// antippen, Beutel für Beutel scannen, bis der Knopf wieder aus ist. So einfach
// muss es sein, sonst benutzt es niemand.
//
// Die zweite Hälfte ist die Meldung, mit der das anfing: "Unbekannter Barcode:
// <Nummer>" über einem Etikett, das der Server kannte. Das Telefon hatte eine
// leere Liste — eine Abfrage ohne Netz hatte ihren 503 als Stand übernommen.
// Unbekanntes heißt jetzt erst nachfragen, und dann in Worten sagen, was los
// ist und was hilft.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quelle, hebeFunktion: _hf } = require('./helpers/quelle');

const APP = quelle();
const HTML = quelle('index.html');
const CSS = quelle('styles.css');
const hebe = (n) => _hf(n, APP);

// processScan() mit Attrappen für alles, was es sonst anfasst. Die Zeitgeber
// sind Attrappen, damit ein "nochmal scannen"-Fenster den Testlauf nicht acht
// Sekunden aufhält.
function werkbank(stand) {
  return new Function(
    'stand',
    `
    const fb = [];
    const gepostet = [];
    const nachgefragt = [];
    const beutelFenster = [];
    const geerntet = [];
    const setTimeout = () => 0;
    const clearTimeout = () => {};
    const t = (k, p) => (p ? k + ' ' + JSON.stringify(p) : k);
    const setFb = (type, msg) => fb.push({ type, msg });
    const _scanBeep = () => {};
    const updateSD = () => {};
    const rememberDest = () => {};
    const ACTIONS = ['ADD', 'MOVE', 'MOVE_BATCH', 'REMOVE', 'HARVEST', 'CONTAM'];
    const zones = [
      { id: 'INC', racks: [{ id: 'INC_R1' }] },
      { id: 'TENT1', racks: [] },
      { id: 'TENT2', racks: [] }
    ];
    const LOCS = zones.flatMap((z) => [z.id, ...z.racks.map((r) => r.id)]);
    const NAMEN = { TENT1: 'Zelt 1', TENT2: 'Zelt 2', INC: 'Inkubation', INC_R1: 'Inkubation/R1' };
    const zoneDisplayName = (id) => (id ? NAMEN[id] || id : id);
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
    const CONFIRM_SCAN_MS = 8000;
    const _zcScanMode = false;
    const _zcMode = null;
    const labCheckScanned = () => {};
    const zoneCheckScanned = () => {};
    const _inocScanPrefix = null;
    const inocAdd = () => null;
    const inocRender = () => {};
    const closeCamScan = () => {};
    const go = () => {};
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
    const showHarvestPanel = (bag) => geerntet.push(bag);
    const _crTargets = [];
    const crToggleTarget = () => ({ added: true, count: 1 });
    const _crRenderTargets = () => {};
    const openContamReport = () => {};
    const moveBatchTo = () => {};
    const armScanAction = (v) => { scan.action = v; };
    const scanAfterSync = (raw) => nachgefragt.push(raw);
    ${hebe('modeRunTally')}
    ${hebe('armMode')}
    ${hebe('armMoveRun')}
    ${hebe('scanActionName')}
    ${hebe('cultureRefusal')}
    ${hebe('processScan')}
    return {
      scan: (raw, o) => processScan(raw, o),
      fb,
      letzte: () => fb[fb.length - 1],
      gepostet,
      nachgefragt,
      beutelFenster,
      geerntet,
      zustand: () => scan,
      lauf: () => _modeRun
    };
  `
  )(stand);
}

const CHARGE = { batchId: 'LM-160926-01', species: 'Lions Mane', strain: 'X', bags: [] };
const umzug = (to) => ({ action: 'MOVE', to: to, from: null, count: 0, harvestBag: null });
const neutral = () => ({ action: null, to: null, from: null, count: 0, harvestBag: null });
const vorgang = (action) => ({ ...neutral(), action });
const liegt = (bag, to, action) => ({ action: action || 'ADD', batch: 'LM-160926-01', bag, to });

describe('Umziehen — der Scan', () => {
  it('zieht jeden Beutel ans gewählte Ziel, zählt mit und bleibt dabei', () => {
    const w = werkbank({
      scan: umzug('TENT1'),
      batches: [CHARGE],
      barcodes: [
        [1000001, { type: 'bag', id: 'LM-160926-01-01' }],
        [1000002, { type: 'bag', id: 'LM-160926-01-02' }]
      ],
      scanLog: [liegt('LM-160926-01-01', 'INC_R1'), liegt('LM-160926-01-02', 'INC_R1')]
    });
    w.scan('1000001');
    w.scan('1000002');
    assert.equal(w.gepostet.length, 2);
    for (const e of w.gepostet) {
      assert.equal(e.action, 'MOVE');
      assert.equal(e.from, 'INC_R1');
      assert.equal(e.to, 'TENT1');
    }
    assert.equal(w.lauf().n, 2);
    // Die Meldung nennt die Plätze beim Namen, nicht beim Kürzel.
    assert.match(w.letzte().msg, /^scanFb\.moveLogged /);
    assert.match(w.letzte().msg, /"from":"Inkubation\/R1"/);
    assert.match(w.letzte().msg, /"to":"Zelt 1"/);
    // Das ist der ganze Sinn: der Vorgang steht nach dem Scan noch.
    assert.equal(w.zustand().action, 'MOVE');
    assert.equal(w.zustand().to, 'TENT1');
  });

  it('sagt "schon da" statt eines Fehlers, wenn der Beutel schon am Ziel steht', () => {
    const w = werkbank({
      scan: umzug('TENT1'),
      batches: [CHARGE],
      scanLog: [liegt('LM-160926-01-01', 'TENT1')]
    });
    w.scan('LM-160926-01-01');
    assert.equal(w.gepostet.length, 0);
    assert.equal(w.letzte().type, 'warn');
    assert.match(w.letzte().msg, /^scanFb\.bagAlreadyAt .*"loc":"Zelt 1"/);
  });

  it('lagert einen Beutel ohne Platz beim zweiten Scan am Ziel ein', () => {
    // Vorher: "erst mit ADD platzieren" — einen Weg, den es am Telefon nicht
    // gibt, und die Reihe blieb an diesem Beutel hängen.
    const w = werkbank({ scan: umzug('TENT1'), batches: [CHARGE], scanLog: [] });
    w.scan('LM-160926-01-03');
    assert.equal(w.gepostet.length, 0, 'ein einzelner Scan bucht nichts');
    assert.equal(w.letzte().type, 'warn');
    assert.match(w.letzte().msg, /^scanFb\.bagNotPlacedPlace .*"loc":"Zelt 1"/);
    w.scan('LM-160926-01-03');
    assert.equal(w.gepostet.length, 1);
    assert.equal(w.gepostet[0].action, 'ADD');
    assert.equal(w.gepostet[0].from, null);
    assert.equal(w.gepostet[0].to, 'TENT1');
    assert.equal(w.lauf().n, 1, 'eingelagert ist auch angekommen');
    assert.match(w.letzte().msg, /^scanFb\.placedLogged /);
    assert.equal(w.zustand().action, 'MOVE', 'der Umzug läuft weiter');
  });

  it('dasselbe für einen Beutel, der als entsorgt gebucht ist', () => {
    const w = werkbank({
      scan: umzug('TENT1'),
      batches: [CHARGE],
      scanLog: [liegt('LM-160926-01-04', 'INC_R1'), liegt('LM-160926-01-04', null, 'REMOVE')]
    });
    w.scan('LM-160926-01-04');
    assert.match(w.letzte().msg, /^scanFb\.bagRemovedPlace /);
    w.scan('LM-160926-01-04');
    assert.equal(w.gepostet.length, 1);
    assert.equal(w.gepostet[0].action, 'ADD');
  });

  it('wechselt mit einem Platz-Etikett mitten im Umzug das Ziel', () => {
    // Vorher ein Fehler, der verlangte, erst einen Vorgang zu scannen.
    const w = werkbank({ scan: umzug('TENT1'), lauf: { action: 'MOVE', to: 'TENT1', n: 4, at: Date.now() } });
    w.scan('TENT2');
    assert.equal(w.zustand().action, 'MOVE');
    assert.equal(w.zustand().to, 'TENT2');
    assert.equal(w.lauf().n, 0, 'ein neues Ziel zählt von vorn');
    assert.match(w.letzte().msg, /^cam\.moveArmed /);
  });

  it('zählt weiter, wenn das Platz-Etikett des laufenden Ziels gescannt wird', () => {
    // Ein Griff an das Regal-Etikett mitten in der Reihe löschte sonst die Zahl
    // auf dem Knopf — die einzige Rückmeldung, wieviele schon drüben sind.
    const w = werkbank({ scan: umzug('TENT1'), lauf: { action: 'MOVE', to: 'TENT1', n: 4, at: Date.now() } });
    w.scan('TENT1');
    assert.equal(w.lauf().n, 4);
    assert.equal(w.zustand().to, 'TENT1');
  });

  it('startet mit einem Platz-Etikett ohne Vorgang denselben Umzug', () => {
    const w = werkbank({ scan: neutral() });
    w.scan('TENT1');
    assert.equal(w.zustand().action, 'MOVE');
    assert.equal(w.zustand().to, 'TENT1');
    assert.equal(w.lauf().to, 'TENT1');
  });

  it('sagt beim Ernten, warum ein Platz-Etikett nichts tut', () => {
    const w = werkbank({ scan: vorgang('HARVEST') });
    w.scan('TENT1');
    assert.equal(w.letzte().type, 'err');
    assert.match(w.letzte().msg, /^scanFb\.locNotNeeded .*"loc":"Zelt 1"/);
    assert.equal(w.zustand().action, 'HARVEST', 'nichts umgestellt');
  });

  it('öffnet ohne Vorgang weiter das Beutel-Fenster', () => {
    const w = werkbank({ scan: neutral(), batches: [CHARGE], scanLog: [liegt('LM-160926-01-01', 'INC_R1')] });
    w.scan('LM-160926-01-01');
    assert.deepEqual(w.beutelFenster, ['LM-160926-01-01']);
    assert.equal(w.gepostet.length, 0);
  });
});

describe('Entsorgen und Ernten — der Scan', () => {
  it('entsorgt jeden Beutel mit einem einzigen Scan und zählt mit', () => {
    // Vorher musste jeder Beutel zweimal gescannt werden, mit drei Sekunden
    // dazwischen — für eine Reihe verschimmelter Beutel benutzt das niemand.
    const w = werkbank({
      scan: vorgang('REMOVE'),
      batches: [CHARGE],
      scanLog: [liegt('LM-160926-01-01', 'INC_R1'), liegt('LM-160926-01-02', 'TENT1')]
    });
    w.scan('LM-160926-01-01');
    w.scan('LM-160926-01-02');
    assert.equal(w.gepostet.length, 2);
    assert.deepEqual(
      w.gepostet.map((e) => [e.action, e.bag, e.from]),
      [
        ['REMOVE', 'LM-160926-01-01', 'INC_R1'],
        ['REMOVE', 'LM-160926-01-02', 'TENT1']
      ]
    );
    assert.equal(w.lauf().action, 'REMOVE');
    assert.equal(w.lauf().n, 2);
    assert.match(w.letzte().msg, /^scanFb\.trashLogged .*"n":2/);
    assert.equal(w.zustand().action, 'REMOVE', 'Entsorgen bleibt an');
  });

  it('bucht einen schon entsorgten Beutel nicht ein zweites Mal', () => {
    const w = werkbank({
      scan: vorgang('REMOVE'),
      batches: [CHARGE],
      scanLog: [liegt('LM-160926-01-01', 'INC_R1'), liegt('LM-160926-01-01', null, 'REMOVE')]
    });
    w.scan('LM-160926-01-01');
    assert.equal(w.gepostet.length, 0);
    assert.equal(w.letzte().type, 'warn');
    assert.match(w.letzte().msg, /^scanFb\.alreadyRemoved /);
  });

  it('öffnet beim Ernten für jeden Beutel das Gewicht', () => {
    const w = werkbank({ scan: vorgang('HARVEST'), batches: [CHARGE] });
    w.scan('LM-160926-01-05');
    assert.deepEqual(w.geerntet, ['LM-160926-01-05']);
    assert.equal(w.zustand().action, 'HARVEST');
  });
});

describe('Unbekannt heißt: erst nachfragen, dann sagen, was los ist', () => {
  it('fragt beim Server nach, bevor ein Etikett "unbekannt" heißt', () => {
    const w = werkbank({ scan: neutral(), barcodes: [] });
    w.scan('1000001');
    assert.deepEqual(w.nachgefragt, ['1000001']);
    assert.equal(
      w.fb.filter((m) => m.type === 'err').length,
      0,
      'eine Liste von gestern ist kein Grund, dem Etikett zu misstrauen'
    );
  });

  it('sagt nach dem Nachfragen, dass es das Etikett im System nicht gibt', () => {
    const w = werkbank({ scan: neutral(), barcodes: [] });
    w.scan('1000001', { synced: true });
    assert.deepEqual(w.nachgefragt, [], 'nur einmal nachfragen');
    assert.equal(w.letzte().type, 'err');
    assert.equal(w.letzte().msg, 'scanFb.labelNotInSystem');
    assert.doesNotMatch(w.letzte().msg, /1000001/, 'die Nummer sagt niemandem etwas');
  });

  it('erkennt einen Produkt-Barcode als das, was er ist', () => {
    const w = werkbank({ scan: neutral(), barcodes: [] });
    w.scan('4006381333931', { synced: true });
    assert.equal(w.letzte().msg, 'scanFb.notOurLabel');
  });

  it('fragt auch nach, wenn das Telefon die Charge eines Beutels nicht kennt', () => {
    // Vorher lief so ein Beutel in die Vorgänge und kam als "hat keinen
    // bekannten Standort — erst mit ADD platzieren" heraus.
    const w = werkbank({ scan: umzug('TENT1'), batches: [] });
    w.scan('LM-160926-01-01');
    assert.deepEqual(w.nachgefragt, ['LM-160926-01-01']);
    const danach = werkbank({ scan: umzug('TENT1'), batches: [] });
    danach.scan('LM-160926-01-01', { synced: true });
    assert.match(danach.letzte().msg, /^scanFb\.batchNotInSystem .*"batch":"LM-160926-01"/);
    assert.equal(danach.gepostet.length, 0);
  });

  it('nennt eine unbekannte Kultur eine Kultur, keine Charge', () => {
    const w = werkbank({ scan: neutral(), cultures: [] });
    w.scan('MC-LM-160926-01');
    assert.deepEqual(w.nachgefragt, ['MC-LM-160926-01']);
    const danach = werkbank({ scan: neutral(), cultures: [] });
    danach.scan('MC-LM-160926-01', { synced: true });
    assert.match(danach.letzte().msg, /^scanFb\.cultureNotInSystem /);
  });

  it('sagt bei einer aufgebrauchten Kultur "aufgebraucht", nicht "used"', () => {
    const w = werkbank({ scan: neutral(), cultures: [{ id: 'MC-LM-160926-01', status: 'used' }] });
    w.scan('MC-LM-160926-01');
    assert.match(w.letzte().msg, /^scanFb\.cultureUsed /);
  });

  it('fragt bei ganz Fremdem nach und nennt es dann kein Etikett aus diesem System', () => {
    const w = werkbank({ scan: neutral() });
    w.scan('HELLO');
    assert.deepEqual(w.nachgefragt, ['HELLO']);
    const danach = werkbank({ scan: neutral() });
    danach.scan('HELLO', { synced: true });
    assert.match(danach.letzte().msg, /^scanFb\.unknown /);
  });
});

describe('scanAfterSync()', () => {
  function nachfrage(antwort) {
    return new Function(
      'antwort',
      `
      const fb = [];
      const zweiter = [];
      const t = (k) => k;
      const setFb = (type, msg) => fb.push({ type, msg });
      const syncNow = () => Promise.resolve(antwort);
      const processScan = (raw, o) => zweiter.push({ raw, o });
      ${hebe('scanAfterSync')}
      return { lauf: (raw) => scanAfterSync(raw), fb, zweiter };
    `
    )(antwort);
  }

  it('lässt denselben Scan nach frischem Stand noch einmal laufen', async () => {
    const n = nachfrage(true);
    n.lauf('1000001');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(n.zweiter, [{ raw: '1000001', o: { synced: true } }]);
  });

  it('sagt ohne Server, woran es liegt und was hilft', async () => {
    const n = nachfrage(false);
    n.lauf('1000001');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(n.zweiter, []);
    assert.deepEqual(n.fb[n.fb.length - 1], { type: 'err', msg: 'scanFb.unknownOffline' });
  });

  it('die Meldung dazu nennt WLAN und den Neustart', () => {
    for (const [lang, muster] of [
      ['de', /WLAN.*neu starten/],
      ['en', /Wi-Fi.*restart the app/],
      ['pt', /Wi-Fi.*reinicie o aplicativo/]
    ]) {
      // \s*: Prettier bricht lange Einträge nach dem Doppelpunkt um.
      const zeile = quelle('lang/' + lang + '.js').match(/'scanFb\.unknownOffline':\s*'([^']*)'/);
      assert.ok(zeile, lang + ': scanFb.unknownOffline fehlt');
      assert.match(zeile[1], muster, lang + ': die Meldung sagt nicht, was hilft');
    }
  });
});

describe('Abfrage: ein Fehler ist kein Stand', () => {
  // pollSync() mit einer Attrappe für den Server. `antworten` ist eine Liste von
  // Antworten in der Reihenfolge der Abfragen; eine Funktion statt einer
  // Antwort wird aufgerufen und darf ein Promise liefern.
  function abfrage(antworten, vorher) {
    return new Function(
      'antworten',
      'vorher',
      `
      const angewandt = [];
      let lastHash = '';
      let lastSyncTime = null;
      let _mutating = (vorher && vorher.mutating) || 0;
      const t = (k) => k;
      const setSyncStatus = () => {};
      const formatRelativeTime = () => '';
      const refresh = () => {};
      const applyData = (d) => angewandt.push(d);
      const authFetch = async () => {
        const a = antworten.shift();
        return typeof a === 'function' ? a() : a;
      };
      ${hebe('dataResponse')}
      let _polling = false;
      let _lastEtag = null;
      const _pollWaiters = [];
      const POLL_TIMEOUT_MS = 60000;
      ${hebe('pollSync')}
      return { poll: (o) => pollSync(o), angewandt };
    `
    )(antworten, vorher);
  }
  const antwort = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body
  });

  it('übernimmt die 503-Antwort des Service Workers nicht als Stand', async () => {
    // Genau das leerte das Barcode-Register: {error:'offline'} ist gültiges
    // JSON, und applyData() machte daraus lauter leere Listen.
    const a = abfrage([antwort(503, { error: 'offline', reason: 'no network connection' })]);
    assert.equal(await a.poll(), false);
    assert.deepEqual(a.angewandt, []);
  });

  it('übernimmt einen echten Stand und meldet Erfolg', async () => {
    const a = abfrage([antwort(200, { batches: [], barcodes: [] })]);
    assert.equal(await a.poll(), true);
    assert.equal(a.angewandt.length, 1);
  });

  it('meldet "nichts Neues" als Erfolg', async () => {
    const a = abfrage([antwort(304)]);
    assert.equal(await a.poll(), true);
    assert.deepEqual(a.angewandt, []);
  });

  it('lässt sich während einer Speicherung nur mit force blicken', async () => {
    const a = abfrage([antwort(304)], { mutating: 1 });
    assert.equal(await a.poll(), null);
    assert.equal(await a.poll({ force: true }), true);
  });

  it('wer auf eine laufende Abfrage trifft, bekommt deren Antwort', async () => {
    let los;
    const langsam = () => new Promise((r) => (los = () => r(antwort(304))));
    const a = abfrage([langsam]);
    const erste = a.poll();
    const zweite = a.poll();
    await new Promise((r) => setImmediate(r));
    los();
    assert.equal(await erste, true);
    assert.equal(await zweite, true, 'ohne das sähe syncNow() "ausgelassen" statt einer Antwort');
  });

  it('eine Abfrage hat eine Frist, damit keine hängende alle weiteren sperrt', () => {
    assert.match(hebe('pollSync'), /AbortSignal\.timeout\(POLL_TIMEOUT_MS\)/);
  });

  it('auch der erste Stand beim Laden prüft die Antwort', () => {
    assert.match(hebe('loadData'), /\.then\(dataResponse\)/);
  });
});

// Die drei Knöpfe, die updateCamModeBtns() zeichnet, und was ein Tipp auf sie
// tut. Kontamination hat ihren eigenen Test (kontamination-sammeln).
function knoepfe(scanZustand, lauf, ziele) {
  return new Function(
    'scan',
    '_modeRun',
    '_crTargets',
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
    for (const n of ['move', 'harvest', 'trash']) {
      els['btn-cam-' + n] = mk();
      els['cam-' + n + '-count'] = mk();
    }
    els['cam-move-idle'] = mk();
    els['cam-move-to'] = mk();
    const document = { getElementById: (id) => els[id] || null };
    const NAMEN = { TENT1: 'Zelt 1', CONTAM: 'Kontaminiert' };
    const zoneDisplayName = (id) => NAMEN[id] || id;
    const t = (k, p) => (p ? k + ' ' + JSON.stringify(p) : k);
    const fb = [];
    const setFb = (type, msg) => fb.push({ type, msg });
    const updateSD = () => updateCamModeBtns();
    let picker = null;
    const _openZonePicker = (title, onPick) => (picker = { title, onPick });
    const rememberDest = () => {};
    let _pendingDupe = null, _pendingPlace = null;
    let _pendingDupeTimer = null, _pendingPlaceTimer = null;
    ${hebe('modeRunCount')}
    ${hebe('updateCamModeBtns')}
    ${hebe('armMode')}
    ${hebe('armMoveRun')}
    ${hebe('endModeRun')}
    ${hebe('contamPending')}
    ${hebe('toggleMoveScan')}
    ${hebe('toggleModeScan')}
    updateCamModeBtns();
    return {
      els,
      fb,
      letzte: () => fb[fb.length - 1],
      umziehen: () => toggleMoveScan(),
      tippen: (a) => toggleModeScan(a),
      picker: () => picker,
      zustand: () => scan,
      lauf: () => _modeRun
    };
  `
  )(scanZustand, lauf, ziele || []);
}

describe('Der Umziehen-Knopf', () => {
  it('ist an, solange ein Umzug mit Ziel läuft, und zeigt Ziel und Zahl', () => {
    const k = knoepfe(umzug('TENT1'), { action: 'MOVE', to: 'TENT1', n: 3, at: Date.now() });
    assert.ok(k.els['btn-cam-move'].classList.has('on'));
    assert.equal(k.els['btn-cam-move'].attrs['aria-pressed'], 'true');
    assert.equal(k.els['cam-move-idle'].hidden, true);
    assert.equal(k.els['cam-move-to'].hidden, false);
    // Nur der Name — der Pfeil davor ist das Zeichen des Knopfs, ein zweiter
    // im Text las sich als "→ → Zelt 1".
    assert.equal(k.els['cam-move-to'].textContent, 'Zelt 1');
    assert.equal(k.els['cam-move-count'].textContent, '3');
    assert.equal(k.els['cam-move-count'].hidden, false);
  });

  it('ist aus ohne Umzug — und auch bei MOVE ohne Ziel', () => {
    for (const z of [neutral(), vorgang('MOVE')]) {
      const k = knoepfe(z, null);
      assert.ok(!k.els['btn-cam-move'].classList.has('on'));
      assert.equal(k.els['cam-move-idle'].hidden, false);
      assert.equal(k.els['cam-move-to'].hidden, true);
      assert.equal(k.els['cam-move-count'].hidden, true);
    }
  });

  it('öffnet aus die Zielliste, und die Wahl stellt den Umzug scharf', () => {
    const k = knoepfe(neutral(), null);
    k.umziehen();
    assert.ok(k.picker(), 'die Zielliste ging nicht auf');
    assert.equal(k.picker().title, 'cam.movePick');
    k.picker().onPick('TENT1');
    assert.equal(k.zustand().action, 'MOVE');
    assert.equal(k.zustand().to, 'TENT1');
    assert.deepEqual(
      { action: k.lauf().action, to: k.lauf().to, n: k.lauf().n },
      { action: 'MOVE', to: 'TENT1', n: 0 }
    );
    assert.ok(k.els['btn-cam-move'].classList.has('on'));
    assert.match(k.letzte().msg, /^cam\.moveArmed .*"loc":"Zelt 1"/);
  });

  it('beendet an den Umzug und sagt, wieviele angekommen sind', () => {
    const k = knoepfe(umzug('TENT1'), { action: 'MOVE', to: 'TENT1', n: 7, at: Date.now() });
    k.umziehen();
    assert.equal(k.zustand().action, null);
    assert.equal(k.zustand().to, null);
    assert.equal(k.lauf(), null);
    assert.equal(k.picker(), null, 'ausschalten fragt nicht nach einem Ziel');
    assert.match(k.letzte().msg, /^cam\.moveEnded .*"n":7/);
  });

  it('wirft gesammelte Kontaminations-Beutel nicht still weg', () => {
    const k = knoepfe(vorgang('CONTAM'), null, [{ bag: 'LM-160926-01-01' }]);
    k.umziehen();
    assert.equal(k.picker(), null);
    assert.equal(k.zustand().action, 'CONTAM');
    assert.equal(k.letzte().type, 'err');
    assert.match(k.letzte().msg, /^cam\.moveContamPending /);
  });
});

describe('Die Knöpfe Ernten und Entsorgen', () => {
  for (const [action, name, an, aus] of [
    ['HARVEST', 'harvest', 'cam.harvestArmed', 'cam.harvestEnded'],
    ['REMOVE', 'trash', 'cam.trashArmed', 'cam.trashEnded']
  ]) {
    it(name + ': ein Tipp stellt scharf, ohne nach etwas zu fragen', () => {
      const k = knoepfe(neutral(), null);
      k.tippen(action);
      assert.equal(k.zustand().action, action);
      assert.equal(k.zustand().to, null);
      assert.equal(k.picker(), null);
      assert.ok(k.els['btn-cam-' + name].classList.has('on'));
      assert.equal(k.els['btn-cam-' + name].attrs['aria-pressed'], 'true');
      assert.equal(k.letzte().msg, an);
    });

    it(name + ': der zweite Tipp beendet und sagt, wieviele es waren', () => {
      const k = knoepfe(vorgang(action), { action, to: null, n: 5, at: Date.now() });
      assert.equal(k.els['cam-' + name + '-count'].textContent, '5');
      assert.equal(k.els['cam-' + name + '-count'].hidden, false);
      k.tippen(action);
      assert.equal(k.zustand().action, null);
      assert.equal(k.lauf(), null);
      assert.ok(!k.els['btn-cam-' + name].classList.has('on'));
      assert.match(k.letzte().msg, new RegExp('^' + aus.replace('.', '\\.') + ' .*"n":5'));
    });

    it(name + ': löst einen laufenden Umzug ab', () => {
      const k = knoepfe(umzug('TENT1'), { action: 'MOVE', to: 'TENT1', n: 2, at: Date.now() });
      k.tippen(action);
      assert.equal(k.zustand().action, action);
      assert.equal(k.zustand().to, null);
      assert.ok(!k.els['btn-cam-move'].classList.has('on'));
      assert.equal(k.lauf().n, 0);
    });
  }

  it('lässt gesammelte Kontaminations-Beutel auch hier nicht fallen', () => {
    const k = knoepfe(vorgang('CONTAM'), null, [{ bag: 'LM-160926-01-01' }]);
    k.tippen('REMOVE');
    assert.equal(k.zustand().action, 'CONTAM');
    assert.match(k.letzte().msg, /^cam\.moveContamPending /);
  });
});

describe('Ein Vorgang überlebt die geschlossene Kamera — eine Weile', () => {
  function weiter(scanZustand, lauf) {
    return new Function(
      'scan',
      '_modeRun',
      `
      const MODE_RUN_KEEP_MS = 15 * 60 * 1000;
      ${hebe('modeRunResumable')}
      return modeRunResumable();
    `
    )(scanZustand, lauf);
  }
  const vor = (min) => Date.now() - min * 60 * 1000;

  it('nimmt einen Umzug von eben wieder auf', () => {
    assert.equal(weiter(umzug('TENT1'), { action: 'MOVE', to: 'TENT1', n: 5, at: vor(3) }), true);
  });

  it('nimmt eine Ernte von eben wieder auf', () => {
    assert.equal(weiter(vorgang('HARVEST'), { action: 'HARVEST', to: null, n: 2, at: vor(3) }), true);
  });

  it('nimmt Entsorgen nie wieder auf', () => {
    // Wer die Kamera später aufmacht, um nach einem Beutel zu sehen, darf ihn
    // nicht versehentlich wegbuchen.
    assert.equal(weiter(vorgang('REMOVE'), { action: 'REMOVE', to: null, n: 2, at: vor(1) }), false);
  });

  it('macht nach einer Pause neutral auf, wie bisher', () => {
    assert.equal(weiter(umzug('TENT1'), { action: 'MOVE', to: 'TENT1', n: 5, at: vor(20) }), false);
  });

  it('nimmt nichts auf, was kein laufender Vorgang mehr ist', () => {
    assert.equal(weiter(neutral(), { action: 'MOVE', to: 'TENT1', n: 5, at: vor(1) }), false);
    assert.equal(weiter(umzug('TENT2'), { action: 'MOVE', to: 'TENT1', n: 5, at: vor(1) }), false);
    assert.equal(weiter(umzug('TENT1'), null), false);
  });

  it('der Scannen-Knopf fragt, bevor er neutral stellt', () => {
    const fab = APP.slice(APP.indexOf("const fab = document.getElementById('cam-fab');"));
    const rumpf = fab.slice(0, fab.indexOf('openCamScan();') + 400);
    assert.match(rumpf, /const weiter = modeRunResumable\(\);\s*if \(!weiter\) \{/);
    assert.match(rumpf, /t\('cam\.moveResumed'/);
    assert.match(rumpf, /t\('cam\.harvestResumed'\)/);
  });

  it('zählt Rückgängig und abgelehnte Buchungen wieder ab', () => {
    const z = new Function(`
      let _modeRun = null;
      ${hebe('modeRunTally')}
      ${hebe('modeRunUntally')}
      const a = { to: 'TENT1' }, b = { to: 'TENT1' }, fremd = { to: 'TENT1' };
      modeRunTally('MOVE', 'TENT1', a);
      modeRunTally('MOVE', 'TENT1', b);
      modeRunUntally(a);
      modeRunUntally(fremd);
      return _modeRun.n;
    `)();
    assert.equal(z, 1, 'nur was gezählt wurde, wird abgezogen');
  });
});

describe('Ernten aus der Kamera geht in die Kamera zurück', () => {
  // confirmHarvest() gegen Attrappen. Vorher öffnete "Speichern & weiter" die
  // grüne Scan-Hülle für den Handscanner — am Telefon hieß das, für jeden Beutel
  // die Kamera neu aufzumachen.
  function ernte(ausKamera, weiterScannen) {
    return new Function(
      'ausKamera',
      'weiterScannen',
      `
      const wege = [];
      const felder = { 'hp-grams': { value: '250' }, 'hp-flush': { value: '1' }, 'hp-release': { value: '' } };
      const panel = { style: { display: 'block' } };
      const document = { getElementById: (id) => felder[id] || (id === 'harvest-panel' ? panel : null) };
      const parseDecimal = (v) => parseFloat(v);
      const fieldError = () => {};
      const harvestRelease = { on: false };
      let scan = { action: 'HARVEST', harvestBag: { bagId: 'LM-160926-01-01', batchId: 'LM-160926-01' }, count: 0 };
      let _scanTempIdCounter = 0;
      const harvests = [];
      const apiPost = () => Promise.resolve({ ok: true });
      const setFb = () => {};
      const renderHarvests = () => {};
      const updateSD = () => {};
      let sessionStartTime = null;
      const sessionEntries = [];
      let _modeRun = null;
      const t = (k) => k;
      const openCamScan = () => wege.push('kamera');
      const openScanModal = () => wege.push('huelle');
      let _hpFromCam = ausKamera;
      ${hebe('modeRunTally')}
      ${hebe('confirmHarvest')}
      confirmHarvest(weiterScannen);
      return { wege, lauf: _modeRun, action: scan.action, panel: panel.style.display };
    `
    )(ausKamera, weiterScannen);
  }

  it('Enter und beide Knöpfe führen aus der Kamera in die Kamera zurück', () => {
    for (const weiterScannen of [false, true]) {
      const e = ernte(true, weiterScannen);
      assert.deepEqual(e.wege, ['kamera']);
      assert.equal(e.action, 'HARVEST', 'Ernten bleibt an');
      assert.equal(e.lauf.n, 1, 'und zählt den Beutel');
      assert.equal(e.panel, 'none');
    }
  });

  it('am Handscanner bleibt es, wie es war', () => {
    assert.deepEqual(ernte(false, true).wege, ['huelle']);
    assert.deepEqual(ernte(false, false).wege, []);
  });

  it('merkt sich, ob die Kamera offen war, als der Beutel kam', () => {
    assert.match(
      hebe('showHarvestPanel'),
      /_hpFromCam = document\.getElementById\('m-camscan'\)\.classList\.contains\('open'\);[\s\S]*closeCamScan\(\);/
    );
  });
});

describe('Kamera-Leiste: Aufbau und Stil', () => {
  const leiste = HTML.slice(HTML.indexOf('id="cam-scan-hud"'), HTML.indexOf('<!-- Sidebar -->'));

  it('hat vier beschriftete Knöpfe in einer eigenen Reihe', () => {
    const modi = leiste.slice(leiste.indexOf('id="cam-hud-modes"'), leiste.indexOf('class="cam-hud-btns"'));
    const ids = [...modi.matchAll(/id="(btn-cam-[a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ['btn-cam-move', 'btn-cam-harvest', 'btn-cam-contam', 'btn-cam-trash']);
    for (const k of ['cam.move', 'cam.harvest', 'cam.contam', 'cam.trash']) {
      assert.match(modi, new RegExp('data-i18n="' + k.replace('.', '\\.') + '"'), k + ' ohne Wort');
    }
  });

  it('lässt der Werkzeugreihe Platz auf einem Telefon', () => {
    // Sechs runde Knöpfe zu 56px mit 10px Abstand brauchen 386px; ein 390px
    // breites Telefon hat nach dem Rand 358px. Fünf passen.
    const reihe = leiste.slice(leiste.indexOf('class="cam-hud-btns"'));
    const n = (reihe.match(/<button\b/g) || []).length;
    assert.ok(n >= 4, 'die Werkzeugreihe ist nicht mehr zu finden');
    assert.ok(n * 56 + (n - 1) * 10 <= 358, n + ' Knöpfe passen nicht in 358px');
  });

  it('legt die Zielliste über die Kamera, nicht dahinter', () => {
    const m = CSS.match(/body:has\(#m-camscan\.open\) #m-move-batch \{\s*z-index:\s*(\d+);/);
    assert.ok(m, 'ohne die Regel geht die Liste hinter dem Kamerabild auf (beide z-index 200)');
    assert.ok(Number(m[1]) > 200 && Number(m[1]) < 210, 'über der Kamera (200), unter m-confirm (210)');
  });

  it('liest nichts, solange die Zielliste offen ist', () => {
    const start = APP.indexOf('function (decoded) {');
    const rumpf = APP.slice(start, APP.indexOf('processScan(decoded);', start));
    assert.match(rumpf, /getElementById\('m-move-batch'\)\.classList\.contains\('open'\)\) return;/);
  });

  it('versteckt die Taschenlampe wirklich, wo es keine gibt', () => {
    assert.match(CSS, /\.cam-hud-btn\[hidden\] \{\s*display: none;/);
  });

  it('fragt nach, sobald die App aus dem Hintergrund zurückkommt', () => {
    const i = APP.indexOf(
      "document.addEventListener('visibilitychange', function () {\n  if (document.hidden) return;"
    );
    assert.ok(i > 0, 'kein Handler, der beim Zurückkommen nachfragt');
    assert.match(APP.slice(i, i + 200), /pollSync\(\);/);
  });
});
