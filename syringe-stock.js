'use strict';
// Liquid-culture syringes and petri dishes: the lab's count, reported to Billbee,
// which passes it on to every shop it runs (Shopify, Etsy, eBay — whichever have
// Billbee's stock sync switched on at Billbee's end). A petri dish is counted and
// reported exactly like a syringe, as one more article per species.
//
// ── Why a count and not "+3 / −1" ───────────────────────────────────────────
// Billbee only takes an absolute stock figure; its change field is documented as
// ignored. That turns out to be the right shape anyway. A syringe that sells is
// taken off by Billbee the moment the order comes in, and taken off *again* if
// the lab later reported "−1" when it was scanned out for shipping. Reporting
// what is on the shelf, and letting Billbee subtract what is sold but not yet
// shipped (AutosubtractReservedAmount), counts every sale exactly once.
//
// The consequence to know: **a shipped syringe has to be scanned out.** Until it
// is, the lab still counts it, and once Billbee marks the order shipped it stops
// subtracting it — so the shops would offer it again.
//
// ── Why recount instead of hooking every write ──────────────────────────────
// Syringes change through a dozen paths: the lab form, the beimpfen window, a
// scan "raus", undo, stocktake, delete, the bulk import, the MCP tools. Hooking
// each would miss the next one somebody adds. Instead every data change asks for
// a recount a few seconds later (debounced), and a species is only reported when
// its count differs from the one Billbee last accepted. Cheap: one GROUP BY.
//
// Skipped in worktree mode for the same reason as the channel poll: a second
// copy of the server carries the same credentials.

const DEBOUNCE_MS = 5000;
const RETRY_MS = 15 * 60 * 1000;
// How often every figure goes out again, changed or not, with Billbee told to
// pass it on to the shops. Billbee forwards only changes, so a shop edited by
// hand stayed wrong until the next sale — nobody should have to press a button
// to find that out. Six SKUs every six hours is nothing against Billbee's
// limits. The first run after a start does it too, a quarter of an hour in.
const RESEND_MS = 6 * 60 * 60 * 1000;

// getDatabase, not the handle: a backup restore reopens the database and the
// old handle is closed.
function createSyringeStockSync({ getDatabase, dbApi, channels, log, skip }) {
  let timer = null;
  let interval = null;
  let inFlight = false;
  let again = false;
  let lastResend = 0;

  /**
   * Report every species whose count moved. Never throws; the outcome is the
   * return value and the per-species rows (last_error), which the settings card
   * shows.
   *
   * `force` reports every mapped species regardless — the "Jetzt melden" button,
   * and the way to confirm a drop the guard below held back.
   *
   * `resend` also reports every mapped species and has Billbee pass them on to
   * the shops, but unlike `force` it does not override that guard: it runs on
   * its own, and a timer must never empty the shops on a reset.
   */
  async function runOnce({ force = false, resend = false } = {}) {
    if (skip) return { skipped: 'worktree' };
    const database = getDatabase();
    if (!dbApi.syringeStockSyncEnabled(database)) return { skipped: 'off' };
    const cfg = dbApi.getChannelConfig(database, 'billbee');
    if (!cfg.enabled || !cfg.apiKey || !cfg.clientId || !cfg.clientSecret) return { skipped: 'billbee' };

    const rows = dbApi.listSyringeStock(database).filter((r) => r.sku);
    const due = rows.filter((r) => force || resend || r.pushedCount !== r.count || r.lastError);
    if (!due.length) return { pushed: 0, errors: [] };

    // Every mapped species dropping to zero at once is not a run on syringes, it
    // is a reset of the lab data (resetOperationalData wipes cultures) or a bad
    // import. Sending that would empty the shops while the fridge is full. Held
    // back and said so; "Jetzt melden" sends it if it is true.
    const before = rows.reduce((s, r) => s + (r.pushedCount || 0), 0);
    if (!force && before > 0 && rows.every((r) => r.count === 0)) {
      const msg =
        'Nicht gemeldet: alle Spritzen sind auf einmal weg. Das sieht nach Zurücksetzen oder Import aus. Stimmt es, „Jetzt an Billbee melden" drücken.';
      for (const r of due) dbApi.recordSyringePush(database, r.strainId, r.slot, { error: msg });
      log('warn', 'Syringe stock: all species dropped to zero at once, held back', { before });
      return { pushed: 0, errors: [msg], held: true };
    }

    const prov = channels.getChannelProvider('billbee');
    let pushed = 0;
    let inARow = 0;
    const errors = [];
    for (const r of due) {
      try {
        const res = await prov.setStock(cfg, {
          sku: r.sku,
          count: r.count,
          reason:
            'Meistertracker: ' +
            r.count +
            (r.type === 'PD' ? ' Petrischalen ' : ' Spritzen ' + r.ml + ' ml ') +
            r.name +
            ' im Labor',
          // A change Billbee forwards on its own; the button and the periodic
          // resend make it pass unchanged figures on as well.
          resend: force || resend
        });
        dbApi.recordSyringePush(database, r.strainId, r.slot, { count: r.count, billbeeStock: res.currentStock });
        pushed++;
        inARow = 0;
      } catch (e) {
        const msg = e.message || 'Billbee hat nicht geantwortet';
        dbApi.recordSyringePush(database, r.strainId, r.slot, { error: msg });
        errors.push(msg);
        log('warn', 'Syringe stock push failed', { sku: r.sku, error: msg });
        // Three in a row is a key or a Billbee that is down, not three bad SKUs.
        // The rest stay due and go with the next run.
        if (++inARow >= 3) break;
      }
    }
    if (pushed) log('info', 'Syringe stock reported to Billbee', { pushed });
    return { pushed, errors };
  }

  /** One run at a time; a request during a run folds into one more run after it. */
  async function run(opts) {
    if (inFlight) {
      again = true;
      return { busy: true };
    }
    inFlight = true;
    try {
      let r = await runOnce(opts);
      while (again) {
        again = false;
        r = await runOnce();
      }
      return r;
    } catch (e) {
      log('warn', 'Syringe stock sync errored', { error: e.message });
      return { error: e.message };
    } finally {
      inFlight = false;
    }
  }

  /** Something changed somewhere; recount shortly. Cheap to call on every write. */
  function schedule() {
    if (skip) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      run();
    }, DEBOUNCE_MS);
    if (timer.unref) timer.unref();
  }

  /** The retry loop: whatever failed, or changed by a path that did not ask. */
  function start() {
    if (skip) return false;
    if (interval) clearInterval(interval);
    interval = setInterval(() => {
      const due = Date.now() - lastResend >= RESEND_MS;
      run(due ? { resend: true } : undefined).then((r) => {
        // Counted as done only when it went through, so a Billbee that was down
        // gets the resend on the next tick instead of six hours later.
        if (due && r && !r.skipped && !r.busy && !r.error && !r.held && !(r.errors && r.errors.length)) {
          lastResend = Date.now();
        }
      });
    }, RETRY_MS);
    if (interval.unref) interval.unref();
    return true;
  }

  function stop() {
    if (timer) clearTimeout(timer);
    if (interval) clearInterval(interval);
    timer = null;
    interval = null;
  }

  return { run, runOnce, schedule, start, stop };
}

module.exports = { createSyringeStockSync, DEBOUNCE_MS, RETRY_MS, RESEND_MS };
