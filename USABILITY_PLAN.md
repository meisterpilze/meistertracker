# 🧭 Übersichtlichkeit — Design Doc

> **Status:** all six phases shipped · **Author:** design pass with Claude · **Date:** 2026-08-20
> **Measured against** `main` @ `d3c1c66`, at 1366×768, 1280×720 and 375×812, through
> `scripts/static-page-server.js` — the same stripped page the mobile tooling measures.

`MOBILE_REDESIGN.md` fixed the **floor**: type, touch targets, overflow, tables. That work
is finished and its ratchet reads zero on all three dimensions. What it deliberately did
not touch is the layer above — *how many places there are, which one answers a given
question, and what happens when you get something wrong.* That is what this document is
about, and unlike the floor it is not a phone problem: four of the six findings below hurt
the desk more than the hand.

---

## 1. What is already right

Stated first because the plan below must not undo it.

- **The floors hold.** `npm run mobile-audit` → `inline: 0 · declared: 0 · base: 0`.
- **One DOM, one stylesheet.** No second render path was introduced, and none is proposed.
- **Landing is a launcher, not a dashboard.** `p-work` asks "was hast du gemacht?" and
  offers seven jobs. That is the right idea and the plan keeps it.
- **Admin's thirteen sub-tabs are already solved twice** — grouped vertically in the
  sidebar above 769px, a drill-down list below it. That mechanism is the one §4.1 reuses.
- **Destructive actions are undoable** (`#undo-bar`) and the scanner is always reachable
  (`#cam-fab`).

---

## 2. Measured state

| What | Count | Where |
|---|---:|---|
| Top-level pages | 12 | `#p-work` … `#p-pickups` |
| Sidebar entries | 15 + Admin | `.sb-nav .sb-btn`, [index.html:1170](index.html:1170) |
| …of those, sub-views of **one** page (`p-orders`) | **5** | `#n-orders-*`, [app.js:20535](app.js:20535) |
| Sidebar height needed vs. available at 1366×768 | **778px / 611px** | 167px, 4 entries, below the fold |
| Same at 1280×720 | 688px / 563px | 125px, 3 entries |
| Static dialogs | 23 | `div.modal` in `index.html` |
| Sub-tab strips | 6 | `.stabs`; Admin 13, Orders 5 (hidden), 4 others |
| Page-local search boxes | 4 | `dash.search` ×3 + `harvest.searchBatch` |
| Global search / jump-to | **0** | — |
| Native `alert()` | **77** | `app.js` |
| …of those, raw server text (`res.error`, `e.message`) | 22 | e.g. [app.js:17320](app.js:17320) |
| Native `confirm()` / `prompt()` | 9 / 1 | `app.js` |
| Mobile topbar page title | **none** | `go()` never writes one, [app.js](app.js) |
| `p-work` scroll height at 375px | 1595px | viewport 812px — two screens |

---

## 3. Findings

### 3.1 The sidebar does not fit a laptop — and the reason is an IA inconsistency

At 1366×768, the most common business-laptop viewport, `.sb-nav` needs 778px and has 611.
**Kunden and Versand are not on the screen and nothing says they exist**: the list simply
stops after Produkte, and there is no fade, shadow or scrollbar to contradict it. At
1280×720 three entries are gone the same way.

The cause is not that the app has too many pages. It is that **five of the fifteen entries
are sub-views of a single page**. `#n-orders-inbox`, `-demand`, `-mapping`, `-customers`
and `-versand` all call `go('orders', …)` and then `openStab()` — `p-orders`'s own strip is
still in the DOM at [index.html:3179](index.html:3179) with `display: none` and a comment
explaining that it was promoted.

So the app applies two opposite rules to the same shape: Admin's **thirteen** sub-tabs live
behind one entry, Orders' **five** are all top-level. Applying Admin's rule to Orders takes
the sidebar to 11 entries — it fits at 720px with room left — and costs one click on the
four secondary views while making Bestellungen itself *closer*, because it moves up.

### 3.2 Two landing pages that point at each other

`p-work` carries a strip reading "Weißt du nicht, was ansteht?" whose button goes to the
Dashboard ([app.js:21845](app.js:21845)). The Dashboard opens with two full-width primary
buttons, **+ Neue Charge** and **+ Laborarbeit**, which are `wk-t-batch` and `wk-t-lab` —
two of the seven tiles the user just left.

That is a loop, and it is the same defect Phase 1 of the mobile redesign deleted the speed-
dial FAB for: *an entry point whose every item is a strict subset of another screen's.* The
FAB went; these two survived because they are on a different page.

Neither screen answers "what now" on its own. `p-work` knows the seven **verbs** and
nothing about today; the Dashboard knows today (`#dash-batch-tasks`, `#dash-alerts`) and
repeats two verbs. The answer is not a third screen — it is to put the *today* list where
the verbs already are.

### 3.3 There is no way to find a thing by name

Four search boxes exist, each scoped to the list it sits above. There is no way to type
`BHA-1` and get to it, from anywhere. With 12 pages, 34 sub-tabs and roughly 50
destinations, every lookup is a navigation problem the user has to solve first: *which page
holds cultures again — Labor or Chargen?*

This is a desk problem more than a phone one. The desk has a keyboard and no scanner; the
phone has a scanner and the barcode **is** the search box. That asymmetry is the design:
`Ctrl/Cmd + K` on the desk, the scan button on the phone, both landing on the same record.

### 3.4 The phone never says which page it is on

The mobile topbar is hamburger · **Meistertracker** · bell · sync dot, and `go()` does not
touch it. The bottom nav covers five pages, so for the other seven — Zonen, Drucken,
Pilzsorten, Abholungen, Bestellungen, Lager, Admin — there is **nothing on screen that
names where you are**. Open the drawer, tap Abholungen, drawer closes, and the only
evidence of what happened is the content itself.

### 3.5 Validation speaks through an OS dialog, 77 times

`alert(t('batch.fillQty'))`, `alert(t('harvest.enterWeight'))`,
`alert(t('print.selectBatchFirst'))` — the app's entire form-validation vocabulary is the
browser's modal. It is the wrong control for the job in four distinct ways:

1. **The message is detached from the field.** It names a problem; the user dismisses it,
   then has to re-find which of nine inputs it meant.
2. **It blocks.** A gloved thumb has to hit one small OK before anything else can happen.
3. **It is not the app.** On a phone it renders as `192.168.x.x sagt:` above the text, in
   the OS font, ignoring both the theme and the 56px touch floor the rest of the app now
   guarantees.
4. **Twenty-two of them show raw server text** — `alert(res.error)`, `alert(e.message)` —
   so an internal string reaches a worker unedited.

The nine `confirm()`s have a fifth problem: the destructive choice is labelled **OK**.
"Kamera löschen?" answered with *OK* is a worse button than one that says *Löschen*.

### 3.6 The phone landing page is two screens tall

Seven tiles at `min-height: 156px` plus gaps: `p-work` is 1595px tall in an 812px viewport,
and **`wk-t-harvest` starts at y=1115**. Logging a harvest — the most repeated job in the
building — begins with a scroll past four tiles that are not it.

The tiles are in production-chain order (Labor → Korn → Charge → Substrat → Umziehen →
Ernte → Kontamination). That order teaches the process, which is worth something on day
one and nothing on day two hundred.

---

## 4. Phases

Each is a PR, shippable and revertible on its own, and each is checked against
`scripts/capture-desktop-baseline.js --compare` and `scripts/measure-mobile.js`.

### Phase 1 — Give the sidebar back its floor · §3.1 · **shipped**

Fold the five `#n-orders-*` entries into one **Verkauf** entry that opens `p-orders` on its
default sub-view, and un-hide `p-orders`'s own `.stabs` strip. Both halves already exist:
the strip is in the DOM, and below 769px `.stabs` is already the drill-down list Phase 1 of
the mobile redesign built. Nothing new is invented; a hidden thing is shown and five
buttons become one.

*Measured: 15 entries → 11, `.sb-nav` 778px → 611px at 1366×768 and 563px at 1280×720 —
in both cases exactly what is available, nothing below the fold. Abholungen stayed
top-level: it is a different page, not an orders sub-view.*

Two things fell out rather than being decided. `go()` lands on the strip's active pill the
way Admin already does, instead of calling `renderOrders()` and letting the four other
views draw over it. And `go('orders', 'n-orders')` at [app.js:792](app.js:792) — the eBay
account-closure notification — had been naming a button that did not exist; `go()`
dereferences `btnId` with no guard, so that link threw and the admin landed nowhere.

➖ **The first sub-tab and the section share a name.** "Bestellungen › Bestellungen", the
same shape as "Admin › Server". Renaming the tab (*Eingang*?) is a domain call, not a
layout one, and is left open deliberately.

### Phase 2 — One "what now", not two · §3.2 · **shipped, and it emptied a mode**

- Delete the two duplicate primary buttons from the Dashboard.
- Move the *today* list — `#dash-batch-tasks` and `#dash-alerts` — to the top of `p-work`,
  above the tiles, replacing the "Weißt du nicht, was ansteht?" strip with the answer
  itself.
- The Dashboard keeps what only it has: KPIs, history, charts.

*What was not foreseen: `#dash-farm-section` held nothing but those two buttons and that
row, so moving them emptied the Dashboard's Farm mode entirely. The Farm/Overview toggle
went with it — a toggle to a blank screen is worse than no toggle — and the page is the
Übersicht it used to be half of. `dashMode` retired with them, and took a coupling nobody
could have guessed at: two `dashMode === 'farm' &&` conditions in `renderStatus()` decided
whether the location sections on the **Chargen** page opened, so switching the Dashboard to
Übersicht once left every zone on a different page collapsed with no visible cause.*

*Two phone defects had been latent behind the mode and are fixed with it: the tasks/alerts
row carried `align-items: flex-start` inline, which outranks every rule in the stylesheet —
so the phone block could stack the cards and could not stop them shrinking to the width of
their own text (137px inside a 343px page); and the Übersicht toolbar is 382px wide at
375px, invisible to `measure-mobile.js` for as long as the section around it was hidden.*

### Phase 3 — Field-level validation and a toast · §3.5 · **shipped**

One `toast(msg, kind)` and one `fieldError(input, msg)`, then convert the 77 sites:

| Kind | Count | Becomes |
|---|---:|---|
| "you left a field empty / wrong" | ~45 | `fieldError()` — red hint under the field, focus moves there |
| "that worked" | ~10 | `toast(…, 'ok')`, auto-dismiss |
| "the server said no" | 22 | `toast(…, 'err')`, sticky until tapped, raw text mapped to a sentence |
| destructive `confirm()` | 9 | the existing `.modal` with a named danger button |

**3a — shipped, and it was not page by page.** The bar already existed: `flashUndoBar()` is
the undo snackbar with its button hidden, positioned clear of the bottom nav and the scan
button by Phase 0 of the mobile redesign. `toast(msg, kind)` is that bar with an error skin,
`role="alert"` and six seconds instead of two and a half; a tap dismisses it. All 77 sites
converted in one sweep, because the shape was uniform — and checked before rather than
after: only four are not immediately followed by a `return`, and all four are followed by a
re-render, which is what should happen while the message is up. Nothing depended on the
blocking. `test/toast.test.js` holds the three cleanups that would rot silently (a receipt
inheriting the error colour, a message leaving `role="alert"` behind, an undo offer keeping
the tap-to-dismiss handler) and fails if a 78th `alert(` appears.

**3b — shipped, on machinery that was already there.** `confirm2()` has taken a named
button since it was written and deleting a pickup location already used it; the eight had
never been moved onto it. `askConfirm()` is that dialog as a promise, so each call site
keeps `if (!(await askConfirm(…))) return;`. The buttons read *Löschen*, *Entfernen*,
*Stilllegen*, *Schlüssel widerrufen*, *Trotzdem fortfahren*. The ninth, `mayLeavePage()`,
stays native and always will: `beforeunload` is synchronous by specification.

*Two bugs fell out. Escape took the class off `#m-confirm` rather than calling
`closeConfirm()` — already wrong, since the callback stayed set for the next caller, and
with a promise behind it the caller would have been suspended for the life of the page.
And `#m-confirm3` was not in the Escape list at all, so the recurring-event delete dialog
was the one modal in the app Escape could not dismiss.*

**3c — shipped smaller than it was written.** Twenty checks call `fieldError(id, msg)`,
which gives the field a red ring, the focus and a scroll while the bar keeps the words.
The words are **not** under the input, as §3.5 asked: those twenty fields sit in grid
cells, plain blocks and non-wrapping flex rows, and a block inserted after the input lands
differently in each. Marking and focusing answers *which one* identically everywhere, and
that was the complaint. Three checks choose between two fields — a ring on an empty box
explains nothing.

### Phase 4 — Find by name · §3.3 · **shipped**

`Ctrl/Cmd + K`, a field at the top of the sidebar, and a magnifier in the phone topbar. One
index over batches, cultures, strains, zones, orders and customers; type-ahead; Enter opens
the record. Pages and sub-pages are results too, so it doubles as the jump-to the 12-entry
sidebar cannot make instant.

*Ranking is by where the match landed, not by type: an id typed out in full, then an id
that starts with the query, then a record whose id is a **prefix** of the query — which is
how a scanned bag code (`AUS-190826-02-07`) finds the batch that owns it. Single bags are
not indexed; twenty per batch would outnumber every other record four to one for a case
that rule already covers. The four-character floor on that rank is what keeps a
three-letter zone id (`FRU`) from claiming every query beginning F-R-U.*

*A scanner types the whole code, and the field says so — "Suchen oder scannen". A printed
label is a number that appears in no index, so it goes through `barcodeRegistry` first, the
same lookup `processScan()` does; a German HID scanner sends underscores where a bag id has
hyphens, so that reading is tried second, never first, because zone barcodes carry real
underscores. When the query is answered by exactly one record the palette opens it without
waiting for a keypress the scanner may not send — after the typing stops, because the batch
id is a **prefix** of the bag code and jumping at the prefix left the last three characters
to land in whatever had focus next.*

*Orders and customers are the only two sources not already in memory. The palette fetches
them on the way in and redraws when they land, rather than making the fast path wait for
the slow one — and on every open rather than once per page load, because a latch set before
the request went out could not be retried and a customer erased on another machine stayed
searchable for ever.*

*A result goes to its destination the way a user would: by clicking the nav entry and the
sub-tab pill, not by calling `go()` and `openStab()` past them. Seven pills load their own
panel from their own handler, and the nav entries clear filters and reset state, so the
short cut opened panels blank and lists still filtered. `mayLeavePage()` is asked before
anything closes, or its "cancel" arrives too late to stop the steps behind it.*

*A result lands on its record: the page, scrolled to, flashed. Batches reuse `goToBatch()`,
which already did this for the dashboard's "Zur Charge" button; the other five got a
`data-find` hook on their row, and `test/global-search.test.js` asks the reverse question —
for every type `gsGoto()` flashes, is there still a renderer emitting the hook? Losing one
is silent: right page, no flash.*

*On a phone the footer goes: "↑↓ wählen · ↵ öffnen" describes a keyboard that is not there,
and it was 40px of a screen with an on-screen keyboard over half of it. The box is bounded
in `dvh` and the list scrolls inside it, because with the keyboard up there is room for
three rows — and `vh`, which is what `max-height: 100%` of a `position: fixed` backdrop
comes to, does not know the keyboard is there. `.wkf-list` says the same thing at length.*

*One table describes a kind of result — heading, monospace, destination filter, route,
flash. It used to be four, and forgetting one of them failed quietly and differently each
time.*

### Phase 5 — Say where you are · §3.4 · **shipped**

`go()` writes the current page's `nav.*` label into the mobile topbar, replacing the
wordmark below 769px. Free on the desktop, which has the sidebar.

*The label is read off the nav entry `go()` was already handed, not from a second table of
page names. `data-i18n` travels with the text, so a language switch reaches it through
`translatePage()`. Measured at 320px: pt `nav.workSteps` — "Etapas de trabalho" — is 4px
over the bar and now ellipsises instead of pushing the bell and the sync dot off the edge;
every other label in all three languages fits.*

### Phase 6 — Fit the seven tiles on one phone screen · §3.6 · **shipped**

Not a reorder — chain order is the right order and frequency order would be a guess. Take
the height instead.

*And the height was not the tile's to keep: `min-height: 156px` is a good proportion for a
tile 261px wide on a desk and pure air at full phone width. The measurement that says so —
every tile reported its when-line **box** at 88px for one to three lines of 13px text,
because `grid-template-rows: auto 1fr` hands the second row whatever the min-height left
spare. Below 768px the tile is as tall as its content, floored at `--tap` rather than at a
literal, and the drawing goes 134px → 96px or it swallows the smaller box.*

*Tiles 156px → 76–95px. The page 1368px → 866px. `wk-t-harvest` 1117 → 774. Five tiles on
the first screen instead of two and a half. The rules had to be moved **below** the base
`.wk-tile` block to take effect at all — a media query adds no specificity, so the first
version read correctly and changed nothing.*

### Beyond the six findings — what the sweeps turned up

The `.dash-top-row` bug in Phase 2 was not a one-off, so both of its shapes were looked for
systematically rather than waited for.

**An inline style against a media query that means to change it** — walked in a browser,
190 media rules against 748 inline styles. Two real, both silent: five `.btn-sm`/`.btn-xs`
whose inline padding beat `(pointer: coarse) { padding: 10px 14px }`, and eight fields
whose inline `max-width` beat the `max-width: 100%` rule written for exactly them. The cap
is data now — `--w-cap` read by `.w-cap` — the same device as `.fs-floor` and `--fs-own`.
Two more the sweep raised and checking dismissed: `@media print` resets `.card` against
seven inline paddings, but the same block hides every `.page`, so none of those cards is
ever printed; and a short-landscape `.modal h3` wants 6px against an inline 4px, which is
already tighter than the block is asking for.

**An element lookup for an id that does not exist** — the shape behind the `n-orders`
crash. Four, in two groups, both code whose UI was removed without it: `exportKpiCSV()`
with its `#kpi-csv-period`, and the team-member editor, whose `addMember()` dereferenced
`#member-name` unguarded. `teamMembers` itself stays — it is loaded, saved, and read by
`getSelectableAssignees()`.

`test/inline-overrides.test.js` and `test/sidebar-entries.test.js` forbid both shapes as
greps. Neither is the full check — that needs a browser, and both files say so rather than
implying otherwise.

---

## 5. How this is verified

Same two tools, same rules as `MOBILE_REDESIGN.md` §8:

- `node scripts/capture-desktop-baseline.js --compare` — desktop pixels must not move,
  except where a phase says which selector moves and why.
- `node scripts/measure-mobile.js 375` and `320` — type, touch and overflow stay at zero.
- `npm run mobile-audit` — the ratchet may only fall.
- `npm test` — plus one new file per phase that pins the thing that would silently rot.
  **1236 tests**, and each new assertion was run against the tree as it stood and fails
  there; a test that passes before the fix is checking nothing.
  - `test/sidebar-entries.test.js` — one entry per page, and no `go()` naming a button
    that is not in the markup.
  - `test/toast.test.js` — the bar's three jobs cleaning up after each other, the dialog
    settling on every way out, no `alert(` back, and every `fieldError()` id existing.
  - `test/inline-overrides.test.js` — the two shapes where an inline style outranks the
    rule written to change it.
  - `test/mobile-nav.test.js` — the topbar title derived from the nav entry, and
    truncating rather than shoving the bell off the bar.
  - `test/global-search.test.js` — the ranking run for real; the census that asks whether
    a renderer still emits the `data-find` hook `gsGoto()` flashes; the census of
    full-screen overlays the palette must not open on top of, held against `index.html`;
    and `gsZoneCounts()` checked against `getZoneBags()` on four hundred random scan logs
    from a fixed seed, because the fast version has to give the same number as the zone
    card, not a reasonable one.
- `npm run lint` — the warning ceiling is a ratchet too: **73 → 65** as the unreachable
  code went.

---

## 6. Non-goals

- **No new pages, no new framework, no component library.** Every phase removes a surface
  or reuses one that exists.
- **No desktop redesign.** Phases 1, 2 and 3 change what is on the screen, not how it is
  drawn.
- **No reordering of the seven Arbeitsgänge tiles.**
- **Not offline, not the scanner engine, not i18n coverage** — although Phase 3 adds keys.
