# 🧭 Übersichtlichkeit — Design Doc

> **Status:** proposed · **Author:** design pass with Claude · **Date:** 2026-08-20
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

### Phase 1 — Give the sidebar back its floor · §3.1

Fold the five `#n-orders-*` entries into one **Verkauf** entry that opens `p-orders` on its
default sub-view, and un-hide `p-orders`'s own `.stabs` strip. Both halves already exist:
the strip is in the DOM, and below 769px `.stabs` is already the drill-down list Phase 1 of
the mobile redesign built. Nothing new is invented; a hidden thing is shown and five
buttons become one.

*Expected: 15 entries → 11. `.sb-nav` needs ~560px, fits at 720px with the group labels.
Abholungen stays top-level — it is a different page, not an orders sub-view.*

### Phase 2 — One "what now", not two · §3.2

- Delete the two duplicate primary buttons from the Dashboard.
- Move the *today* list — `#dash-batch-tasks` and `#dash-alerts` — to the top of `p-work`,
  above the tiles, replacing the "Weißt du nicht, was ansteht?" strip with the answer
  itself.
- The Dashboard keeps what only it has: KPIs, history, charts.

### Phase 3 — Field-level validation and a toast · §3.5

One `toast(msg, kind)` and one `fieldError(input, msg)`, then convert the 77 sites:

| Kind | Count | Becomes |
|---|---:|---|
| "you left a field empty / wrong" | ~45 | `fieldError()` — red hint under the field, focus moves there |
| "that worked" | ~10 | `toast(…, 'ok')`, auto-dismiss |
| "the server said no" | 22 | `toast(…, 'err')`, sticky until tapped, raw text mapped to a sentence |
| destructive `confirm()` | 9 | the existing `.modal` with a named danger button |

Convertible page by page; the helper lands first with two call sites.

### Phase 4 — Find by name · §3.3

`Ctrl/Cmd + K` and a search row in the mobile topbar. One index over batches, cultures,
strains, zones, orders and customers; type-ahead; Enter opens the record. Pages are results
too, so it doubles as the jump-to the 11-entry sidebar still cannot make instant.

### Phase 5 — Say where you are · §3.4

`go()` writes the current page's `nav.*` label into the mobile topbar, replacing the
wordmark below 769px. Free on the desktop, which has the sidebar.

### Phase 6 — Fit the seven tiles on one phone screen · §3.6

Not a reorder — chain order is the right order and frequency order would be a guess. Take
the height instead: on a phone the art is decoration inside a 156px box, and a 96–104px
tile with a smaller drawing puts all seven above 812px. Measured, not assumed.

---

## 5. How this is verified

Same two tools, same rules as `MOBILE_REDESIGN.md` §8:

- `node scripts/capture-desktop-baseline.js --compare` — desktop pixels must not move,
  except where a phase says which selector moves and why.
- `node scripts/measure-mobile.js 375` and `320` — type, touch and overflow stay at zero.
- `npm run mobile-audit` — the ratchet may only fall.
- `npm test` — plus one new file per phase that pins the thing that would silently rot:
  Phase 1, that no stylesheet hides a sidebar entry by id; Phase 3, that no `alert(` or
  `confirm(` survives in a converted region.

---

## 6. Non-goals

- **No new pages, no new framework, no component library.** Every phase removes a surface
  or reuses one that exists.
- **No desktop redesign.** Phases 1, 2 and 3 change what is on the screen, not how it is
  drawn.
- **No reordering of the seven Arbeitsgänge tiles.**
- **Not offline, not the scanner engine, not i18n coverage** — although Phase 3 adds keys.
