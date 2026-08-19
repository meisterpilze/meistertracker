# 📱 Mobile Redesign — Design Doc

> **Status:** Phase 0 shipped · **Author:** design pass with Claude · **Date:** 2026-08-19
> **Measurements** taken against `main` @ `e656fbd`. Where building Phase 0 proved a
> number or a claim wrong, the correction is in place and flagged **[corrected]** — the
> original reasoning is kept where it explains why the wrong thing looked right.

The lab walks. Workers carry a phone in one hand and a bag in the other, wear gloves, and
work in a room that is warm and humid. The phone layout they get today is the desktop
layout with the padding turned down — at ≤480px the primary button is **smaller** than it is
on a 27" monitor.

This document proposes the opposite direction for the screens that are actually used on
foot, and a "don't break it" floor for the rest.

---

## 1. Goals / Non-goals

**Goals**

- Every screen a worker uses **standing up, gloved, one-handed, at arm's length** works:
  ≥56px touch targets, ≥17px body text, one column, one primary action per screen.
- A real **token layer** for size / space / type — **mobile-first**, desktop as the override.
  This replaces the current 38 hand-rolled media queries in four different dialects.
- **No horizontal scroll anywhere.** 29 tables become cards on phone; 34 sub-tab pills
  become drill-downs.
- Restore a **persistent scan affordance** — the app is barcode-first and currently has no
  always-reachable scanner entry on a phone.
- Every phase is **independently shippable and revertible**. No phase leaves the app in a
  half-migrated state.

**Non-goals**

- **No second render path.** No mobile stylesheet, no mobile template tree, no framework.
  One DOM, one `styles.css`. Two render paths in a 910 KB `app.js` drift within weeks.
- **No desktop redesign.** Desktop pixels must not move — see §8 for how that is enforced.
- **Not a facelift for the Büro screens** (§3). They get a floor, not a redesign.
- Not offline/PWA work, not the scanner decode engine, not i18n.
- Not a component library. Classes, not components.

---

## 2. Measured state

Everything below was counted against the working tree, not recalled.

| What | Count | Where |
|---|---:|---|
| Top-level pages | 12 | `#p-work` … `#p-pickups`, [index.html:2098](index.html:2098)ff |
| Sidebar entries | 16 | `#n-*`, [index.html:1211](index.html:1211) |
| Admin sub-entries | 13 | `#sn-settings-*`, [index.html:1469](index.html:1469) |
| Sub-tab pills | 34 | 6 `.stabs` strips; Settings alone has 13 |
| `<table>` elements | 29 | 16 static + 13 built by string concat in `app.js` |
| Media queries | 38 | `max-width`, `pointer: coarse`, `hover: none`, `min-width: 769` — mixed |
| **Inline `font-size` below the 13px floor** | **495** | 242 in `index.html`, 253 in `app.js` |
| …of those, fractional | 11 | `10.5px`, `11.5px`, `9.5px`, `12.5px` — all in `app.js` |
| Inline `font-size` at exactly 13px | 65 | at the floor, so not the bridge's problem |
| Inline `style="` attributes | 1335 | 766 in `index.html`, 569 in `app.js` |
| Size / space / type tokens | **0** → 11 | was: `:root` had only colours, 2 radii, 2 shadows |

> **[corrected]** This table first said 549 inline sizes ≤13px. The survey behind it used a
> shell pattern with no decimal point in it, so eleven fractional sizes never appeared —
> and the first version of the bridge, built from the same list, silently missed exactly
> those eleven. `scripts/mobile-audit.js` and `test/mobile-tokens.test.js` both exist
> partly so the next omission is caught by a number instead of by someone squinting at a
> phone.

### 2.1 The direction is inverted

The base stylesheet is the desktop, and the phone is derived from it by subtraction:

```css
/* styles.css:1541 — base */
.btn { padding: 9px 16px; font-size: 13px; }

/* styles.css:3627 — @media (max-width: 480px) */
.btn { padding: 8px 12px; font-size: 12px; }
```

Same story at [styles.css:3536](styles.css:3536): `table { font-size: 12px }` on phones.
[styles.css:3627](styles.css:3627): `.main { padding: 8px }`.

The intent to do better exists — [styles.css:185](styles.css:185) lifts `.sb-btn` to a 48px
minimum under `pointer: coarse`, and the calendar toolbar gets 44px targets at
[styles.css:3482](styles.css:3482). But it is applied component-by-component, after the
fact, wherever someone noticed. That is the thing worth rebuilding: not the look, the
**direction**.

### 2.2 What is already right

[`#p-work`](index.html:2098) — "Was hast du gemacht?" — is the target paradigm, already
built and already the default landing page:

- Seven large illustrated tiles, one per job.
- Each carries a *when do I use this* line: **Körnerbrut ansetzen** — *wenn eine
  Flüssigkultur fertig ist*.
- [styles.css:5166](styles.css:5166) already drops to one column below 520px.

This doc does not invent a design language. It generalises this one.

Even here the type is desktop-sized: `.wk-tile-t` is `14.5px` and `.wk-tile-when` is
`11.5px` ([styles.css:5231](styles.css:5231)). At arm's length through a face shield,
11.5px is not a subtitle, it is a rumour.

### 2.3 Two defects found while measuring

- **`.scan-float` was dead CSS.** Styled twice — once with `env(safe-area-inset-*)`
  handling, once to hide it in print — carried by **no element in the source**, with
  `scan.fabLabel` still translated in all three language files.

  > **[corrected]** The conclusion drawn from this — "on a phone there is no way to the
  > scanner" — was **wrong**, and Phase 0 shipped a duplicate button before a screenshot
  > showed `#cam-fab` already sitting there doing the job. The dead CSS was the corpse of
  > a button that had been *replaced*, not removed. It is now deleted and the duplicate
  > reverted. Worth keeping as a lesson: three independent traces (CSS, print rule, i18n
  > keys) all agreed with each other, and all three were evidence about the past.

- **Three floating controls sat on top of the bottom nav.** The genuine defect, found by
  looking at the screen rather than at the source: `.cam-fab` sits at `bottom: 24px` and
  `.undo-bar` at `20px`, both under the 56px bottom nav, so the "Scannen" pill covers
  *Chargen*, *Labor* and *Kalender* on a 375px screen. `.action-fab-wrap` already used
  `72px` — the right value was in the file, applied to one of the three. Fixed in Phase 0.

  > **[corrected]** Measured after the fact, the pill covered **three** nav entries, not
  > two. `.action-fab-wrap` no longer exists — see Phase 1, which deleted it.
- **The bottom nav's comment disagreed with the bottom nav** — "4 most-used pages" above
  five buttons. Fixed.

---

## 3. Two kinds of screen

The single most important decision in this plan is **where the redesign stops**.

A large-target layout costs vertical space. It pays for itself where the choices are few
and the hands are busy. It is pure tax where the task is "fill in twelve fields once a
year" — a Rentnertelefon Settings page would need thirteen taps to reach the DuckDNS token.

| | **Feld** — redesigned | **Büro** — floor only |
|---|---|---|
| Pages | `p-work`, `p-batch`, `p-lab`, `p-cal`, `p-inv` (Bestand), `p-zones`, scan overlay | `p-settings` (+13 admin), `p-orders` (5), `p-print`, `p-strains`, `p-pickups`, `p-dash` |
| Posture | standing, gloved, one hand | sitting, two hands, no gloves |
| Target | ≥56px, one column, one primary action | ≥44px, no horizontal scroll, readable |
| Work | Phases 2–3 | Phase 4 |

`p-dash` sits in Büro deliberately: it is charts and KPIs, a thing you *read*, and the
"what do I do now" job it used to serve moved to `p-work` and the Chargen page already
(see the routing comments at [app.js:1059](app.js:1059)).

> **Naming:** call this *Handschuh-Modus* or *Werkbank-Layout* internally. "Rentnertelefon"
> is a useful metaphor for the people designing it and an insult to the people using it.

---

## 4. The token layer

The whole architectural idea is one inversion: **the phone is the base, the desktop is the
override.** Everything else follows.

```css
:root {
  /* Type — phone values. */
  --fs-xs: 13px;      /* the floor. nothing user-facing goes below this. */
  --fs-sm: 15px;
  --fs-base: 17px;
  /* Sketched, deliberately NOT shipped in Phase 0 — see the note below. */
  --fs-lg: 20px;
  --fs-xl: 26px;

  /* Touch. 44px is WCAG 2.5.5 AAA; 56 is the deliberate step beyond it for gloves. */
  --tap: 56px;
  --tap-sm: 48px;

  /* Space — also sketched, also not shipped yet. */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;
  --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;
  --pad-page: 16px;
  --pad-card: 16px;
}

@media (min-width: 769px) and (hover: hover) {
  :root {
    --fs-xs: 11px; --fs-sm: 13px; --fs-base: 15px;
    --tap: auto;   --tap-sm: auto;
    --pad-page: 24px; --pad-card: 20px;
    --pad-btn: 9px 16px; --pad-stab: 7px 16px; --pad-sb: 9px 12px; --pad-modal: 28px;
  }
}
```

> **[corrected]** Two changes from the sketch, both made while building it.
>
> **`and (hover: hover)`.** Width alone hands a coarse-pointer tablet the desk's numbers
> at 1024px. The reason for a big target is the input device, so the query asks about the
> device. This also absorbs the old `@media (pointer: coarse)` `.sb-btn` block, which was
> reaching for the same thing one component at a time.
>
> **`--tap: auto`, not `36px`.** A desktop number would have *added* a minimum where
> there was none and moved the desktop by a pixel or two. `auto` means "intrinsic height,
> exactly as before" — which is what "the desktop must not move" actually requires.
>
> Padding tokens carry paired values rather than sitting on a 4/8/12/16 scale, for the
> same reason: `.btn` is `9px 16px` today, 9 is not on any sane scale, and rounding it to
> 12 would have been a redesign of the desktop disguised as a refactor.

Then every rule that hard-codes a size consumes a token instead:

```css
body { font-size: var(--fs-base); }
.btn { padding: var(--pad-btn); font-size: var(--fs-sm); min-height: var(--tap); }
.main { padding: var(--pad-page); }
.card { padding: var(--pad-card); }
```

> **[corrected]** Phase 0 shipped **11 tokens**, and the `--sp-*` scale, `--fs-lg` and
> `--fs-xl` are **not among them** — nothing consumed them, and a token nobody reads is
> just a number in a different place. The `.btn` line above originally read
> `padding: var(--sp-3) var(--sp-4)`, which would have been `12px 16px` on a desktop
> where `.btn` is `9px 16px` — a desktop redesign smuggled in as a refactor. Paired
> `--pad-*` tokens exist precisely because today's values are not on any scale.
>
> This is a real open question, not a settled one: with no scale, every new component
> gets a bespoke token **by default rather than by decision**. Whoever lands Phase 2
> should either introduce `--sp-*` at the point something actually consumes it, or say
> plainly that per-component padding tokens are the house style.

…and **every `max-width` rule that only shrinks something gets deleted**, because the
desktop override now does that job in one place.

**Why this is safe for the desktop:** the `min-width: 769px` block restores today's exact
values. A rule that reads `font-size: var(--fs-sm)` resolves to `13px` on a desktop, which
is what `.btn` says today. Desktop output is unchanged by construction, and §8 proves it.

---

## 5. The four patterns

Four rules cover almost every Feld screen. Anything not covered by them is a genuine design
question, not a mechanical conversion.

### 5.1 The touch floor

Every interactive element gets `min-height: var(--tap)`. No exceptions on Feld screens; on
Büro screens `var(--tap-sm)`. Icon-only buttons get `min-width` too — a 24px icon in a 56px
box, not a 24px hit area.

### 5.2 One column, one primary action

Below 769px every grid collapses (`.g2`…`.g5` already do at 480px — move it up to 769 and
delete the 480 rule). Each screen names exactly **one** primary action and puts it in the
bottom third, in thumb reach, full width. Secondary actions go below the fold or into an
overflow. Today several screens present four equal-weight buttons in a row that wraps.

### 5.3 Drill-down instead of tab strips

Thirteen pills in a horizontal strip is the worst interaction in the app. The current
mitigations — wrap for work pages ([styles.css:3536](styles.css:3536)), sideways scroll with
a fade edge for Settings ([styles.css:5703](styles.css:5703)) — are both treating the
symptom.

Below 769px, a `.stabs` strip renders as a **full-width list**: label, count badge, chevron.
Choosing one swaps in that sub-page with a back row at the top. This is one CSS block plus
one small JS helper shared by all six strips — the strips are already wired through
`openStab()`, so the routing exists.

Desktop keeps the pills, untouched.

### 5.4 Table → card

The mechanism, chosen because it needs no change to how rows are built:

```css
@media (max-width: 768px) {
  .t-cards thead { position: absolute; left: -9999px; }   /* not display:none — keeps AT */
  .t-cards tr {
    display: block; padding: 12px; margin-bottom: 12px;
    border: 1px solid var(--c-border); border-radius: var(--radius);
  }
  .t-cards td {
    display: flex; justify-content: space-between; gap: 12px;
    border: none; padding: 8px 0; font-size: var(--fs-sm);
  }
  .t-cards td::before { content: attr(data-l); font-weight: 600; color: var(--c-text-muted); }
}
```

Per-table cost: add `class="t-cards"` to the table and `data-l="…"` to each `<td>` emitter,
once. The DOM shape, the JS, the sort/filter logic and the desktop rendering are all
untouched, and a `<td>` that is missed simply renders without its label rather than breaking.

29 tables. This is where most of the hours in this plan actually go — budget accordingly,
and see §7 for how they are sliced.

**There is prior art in the file already.** Four tables — including `#t-log` and
`#t-harvest` — have a hand-rolled card mode on mobile, using a `flex: 0 0 84px` label
column and a promoted date header. The pattern was invented, applied four times, and never
generalised. Read those rules before writing new ones; the generalisation should absorb
them rather than sit beside them.

The existing `overflow-x: auto` wrappers ([app.js:7567](app.js:7567), [app.js:10444](app.js:10444),
[app.js:11170](app.js:11170), [app.js:11505](app.js:11505), [app.js:11597](app.js:11597))
come out as each table converts. Sideways scroll inside a page is the thing being removed,
not the fallback.

---

## 6. The blocker: 549 inline font sizes

A token layer has no power over `style="font-size:10px"`. There are **549** of those at
≤13px across `index.html` and `app.js`, plus 1335 inline `style` attributes overall. This is
already a known wound — [styles.css:3463](styles.css:3463) carries the scar:

```css
/* !important is required to override inline style="font-size:12px" that several
   compact filter/search inputs still carry from desktop layout work. */
input, select, textarea { font-size: 16px !important; }
```

Two moves, and they must both happen.

**The bridge (Phase 0, ships day one).** Generalise that existing workaround into one
deliberate, documented block: a narrow-viewport floor that lifts any inline size below
`--fs-xs`.

```css
@media (max-width: 768px) {
  [style*='font-size:8px'],  [style*='font-size:9px'],
  [style*='font-size:10px'], [style*='font-size:11px'],
  [style*='font-size:12px'] { font-size: var(--fs-xs) !important; }
}
```

This is a hack. It is written down as a hack, with an exit condition, and it buys legible
text across the entire app in one commit instead of in twenty.

**The real fix (folded into Phases 2–4).** As each page is touched, its inline sizes move
into classes. Not as one 549-site sweep — a sweep that large across 1.2 MB of source, with
no browser test to catch a regression, is exactly the change that breaks things invisibly.
Per page, reviewable, revertible.

**The exit.** The bridge block is deleted when the count reaches zero. The count is
ratcheted in CI (§8) so it can only ever go down — the same technique `npm run lint`
already uses with `--max-warnings 73`.

---

## 7. Phases

Each phase is a PR. Each is shippable on its own and does something visible.

### Phase 0 — Tokens, inversion, bridge · **shipped**

- ✅ `:root` token block — **11 tokens**, not the full §4 sketch — plus the
  `min-width: 769px and (hover: hover)` override.
- ✅ Converted to tokens: `body`, `.btn`, `.stab`, `.card`, `.main`, `.sb-btn`, `.modal`.
- ✅ **Deleted** the shrink-only rules — `.btn` and `.main`/`.card` at 480, `.main`/`.card`
  and `table { font-size: 12px }` at 768, `.modal` at both — plus the size half of the
  `pointer: coarse` `.sb-btn` block, which the tokens now say once instead of three times.
- ✅ The §6 bridge, covering both spellings **and** the eleven fractional sizes.
- ✅ Deleted dead `.scan-float`; lifted `.cam-fab` and `.undo-bar` clear of the bottom nav
  (see §2.3 — this replaced the "re-attach the scan button" item, which rested on a
  wrong premise).
- ✅ Bottom-nav comment says five.
- ➖ **`th`/`td` deliberately untouched.** Raising table type widens tables, and the payoff
  only arrives in Phase 3 when they stop being tables. The 12px shrink is gone, so phone
  tables read at the 13px base.

*Measured result at 375px: `body` 15→17px, `.main` padding 8→16px, `.btn` from 12px/8px/12px
with no minimum to 15px/13px/18px with a 56px floor, every inline sub-floor size lifted to
13px, no horizontal overflow. At 1440px all 31 baseline selectors are byte-identical.*

**What Phase 0 did not reach.** The smallest text on the landing page is now 11.5px, on
`.wk-tile-when` — the *when do I use this* line under each tile. It is a base-rule size, so
neither the bridge (inline only) nor the ratchet (`max-width` blocks only) touches it, and
the same is true of `th` at 11px, `.sec` at 12px and `.bottom-nav-btn` at 11px. These are
legitimate *desktop* sizes living in rules that serve both; tokenising them is per-component
work, and it is the first thing Phase 2 does.

> **[corrected]** Four here, one more in Phase 1's notes, and the tone of both reads as
> though five was roughly the size of it. Counted rather than sampled, it is **104**.
> `scripts/mobile-audit.js` grew a third dimension, BASE, to hold the number, because the
> reason nobody had it is that nothing could see this layer: the bridge reaches inline
> styles only and the old count read `max-width` blocks only. The calendar holds fourteen
> of them, Arbeitsgänge fifteen, the scan overlay eight.

### Phase 1 — Navigation chrome

- ✅ **Deleted the `+` speed-dial FAB.** All three of its items resolved to the same
  function references the Arbeitsgänge tiles already use — `msQuickChargeNew` =
  `wk-t-batch`, `msQuickLaborNew` = `wk-t-lab`, `wkfOpen('harvest')` = `wk-t-harvest` —
  making it a strict subset of the first bottom-nav entry, one tap from anywhere. On the
  dashboard it also repeated two buttons visible on the same screen. Two comments in the
  source already claimed this redundancy had been removed; it had not. Gone with it: the
  markup, ~90 lines of CSS including a keyframe animation, the open/close state, the
  now-unreachable `dashGoHarvest`, and the `aria.actionSpeedDial` / `dash.actionHarvest`
  keys in all three language files. The left thumb zone is free and one floating control
  remains.
- ✅ **`.stabs` → drill-down list below 769px** (§5.3). Both mitigations deleted: the wrap
  rule on the work pages and the sideways-scroll-with-fade on Admin. A page below 769px is
  now in one of two states, carried by `stab-drilled` on the `.page` element — its index
  (full-width rows, 56px, chevron) or one sub-page with a back row above it. Above 769px
  nothing reads the class and the pills are untouched, proven against the baseline.

  Two things fell out of the design rather than being decided per page. **Landing goes
  straight to the sub-page a page defaults to**, so Chargen still opens on the batch list
  at no extra tap — and the one page that opens on its index instead, Admin, does so
  because its default tab is `display: none`, not because it is named anywhere. And
  **`openStab()` is the only place that sets the class**, because every route into a
  sub-page already ran through it: the strip, the admin drawer, and the dozen
  `openStab(…)` calls that land somewhere after a save.

  *Measured at 375px: Admin went from 13 pills behind a sideways scroll to 10 visible rows
  on one screen with no horizontal overflow. `test/mobile-nav.test.js` (9 assertions, CI
  step "Mobile navigation") holds the four files that cannot see each other in step.*

  ➖ **No count badges.** §5.3 asks for "label, count badge, chevron". There is no count
  behind any of these tabs today, so a badge would need a data source per tab before it
  could show a number. Label and chevron shipped; the badge is not a deferred detail but
  unbuilt work, and it should be decided per tab rather than as a row of zeros.
- ✅ **Admin stops commandeering the drawer on a phone.** This was the concrete half of
  "the drawer becomes the everything-else door rather than the main route", and the
  drill-down is what made it possible. Entering Admin used to leave the drawer open with
  its list swapped to the 13 sub-tabs, because closing it left the section with nothing to
  navigate by. The section now carries that list on the page, so the swap would only lay
  thirteen entries over thirteen — and take the screen with them. Below 769px the drawer
  keeps the main navigation and closes on arrival like every other page; the swap is
  behind a `min-width: 769px`, where the sidebar is still Admin's only navigation.

  ➖ **The drawer still repeats the bottom nav.** Measured at 375px: 19 rows, 868px of
  content in a 655px viewport, so 5 of 14 destinations sit below the fold — and the five
  the bottom bar already shows permanently (Arbeitsgänge, Dashboard, Chargen, Labor,
  Kalender) are among them. Hiding those five below 769px would fit the rest on one screen
  without scrolling. Not done, and deliberately: the only way to identify them in CSS is
  by id, one group ("Arbeiten") would lose all three of its entries and leave an orphaned
  heading, and the coupling rots silently the day the bottom nav changes. It is worth
  doing with a real mechanism — the bottom nav emitting the list it owns — not with five
  hardcoded selectors.

  ➖ **`.sb-group-label` is 10px**, the smallest text in the app and three below the floor,
  on all five drawer headings. Left alone on purpose: it is a base-rule size serving both
  devices, and 10px is a deliberate desktop value, so lifting it needs its own token — the
  per-component work §7 files under Phase 2. Noted here because the drawer is navigation
  chrome and this is the one thing in it Phase 1 did not fix.

### Phase 2 — Feld pages, one PR each

**104 base-rule sub-floor sizes**, each needing its own paired token so the desktop value
survives. That is the phase's real shape and its real cost — not a sweep, and not the half
day the first item below was budgeted at before the layer was counted. `npm run mobile-audit`
holds the number; it may only fall.

In this order, cheapest and highest-traffic first:

0. ✅ **The two floors, first, because everything else stands on them.** `--fs-min` (13px
   phone / 0px desktop) and `--tap-min` (56px / 0px), each applied as
   `max(<today's number>, var(--floor))` so the desktop literal is never replaced and
   therefore cannot move. 104 type rules and six tap-target rules. The smallest rendered
   text on the landing page goes 10px → 13px. See §4 and §8's `[corrected]` note for why
   this beat five paired tokens.

1. ✅ **`p-work`** — three commits: the touch floor across the guided flow, the tiles'
   type, and the flow's layout.

   The doc's own prescription here was wrong, and worth recording rather than quietly
   fixing: `.wk-tile-t → --fs-base` and `.wk-tile-when → --fs-xs` would both have failed
   `--compare`. `--fs-base` is 15px on a desktop against the frozen 14.5, `--fs-xs` is 11px
   against 11.5. The title got its own pair (`--fs-tile`, 17/14.5) with `--pad-tile` beside
   it; the when-line stayed where the floor put it, because 13px under a 17px title is a
   clearer hierarchy than 15 and one fewer token.

   The flow behind the tiles turned out to be the larger half. Its fields were **smaller**
   than every other field in the app — `.wkf-field input` sets 44px and outranks the global
   `input { min-height: 64px }` on specificity — on the one screen that is filled in
   wearing gloves. Its three breakpoints (460 / 520 / 560) became one at 768. Its footer
   became a column so the primary action is full width in thumb reach (§5.2). Its bag rows
   keep the "bereits 340 g · Flush 2" line the old 560px rule hid, which is the number that
   decides whether a bag is worth weighing at all. And its two scrolling lists moved from
   `vh` to `dvh`, so the keyboard no longer pushes the footer off the bottom.

   *Not half a day.*

   Found while measuring, fixed separately: `#cam-fab` (z-index 850) floats over every
   dialog backdrop (200) and `elementFromPoint` returns **the button**, so a thumb aiming
   at the bottom of a form opened the scanner. One `:has()` rule covers all 25 dialogs.
2. ✅ **Scan overlay** — the one screen that is *always* used gloved, and six of its
   controls were under the floor. `.scan-modal-close` and `.cam-hud-btn` at 44×44;
   `.scan-success-undo` with no size at all, so the button that takes back a wrong scan was
   as tall as its own text; `.scan-tab` with no minimum and a 12px shrink inside a
   `max-width` block; `#chip-to` / `#cam-chip-to` carrying `cursor: pointer` and nothing
   else — a mouse affordance on the control whose entire purpose is the case where the
   barcode would not scan and a gloved hand has to pick the zone by hand.

   ➖ **Not done here:** the zone picker's rows are built in `app.js` with inline
   `style="padding:8px 10px;font-size:..."` (three emitters around `_openZonePicker`), so
   the floor cannot reach them and the ratchet counts them under INLINE. They are a markup
   change, not a stylesheet one, and belong with the rest of the de-inlining.
3. **`p-batch`** — 4 sub-tabs, tables `t-batches` + `t-harvest`.
4. **`p-lab`** — 5 sub-tabs, tables `t-grain` + `t-cultures`.
5. **`p-cal`** — the month grid at `min-height: 60px` per cell is unusable on a phone;
   below 769px it should be an agenda list, not a grid.
6. **`p-inv`**, **`p-zones`**.

Each PR: de-inline that page's font sizes, apply §5.1–5.2, convert its tables per §5.4.

### Phase 3 — Remaining tables

The 13 `app.js`-generated tables not covered by Phase 2, converted in 3–4 batched PRs.

### Phase 4 — Büro floor

No redesign. Per page, only: no horizontal scroll, ≥44px targets, ≥13px text, forms one
column. Settings, Orders, Print, Strains, Pickups, Dash.

### Phase 5 — Remove the bridge

When the inline-size ratchet hits zero, delete the §6 block. If it does not hit zero within
a release or two, that is data: the remaining sites are the ones nobody wants to touch, and
they should be listed and decided on rather than left implicit.

---

## 8. How we verify

**The constraint:** there is no browser test and no jsdom in this repo. `test/*.test.js`
lift functions out of `app.js` with regexes and run them against mocks
([test/arbeitsgaenge-ui.test.js:26](test/arbeitsgaenge-ui.test.js:26)). That harness cannot
see CSS at all. So the verification has to be static and manual, and it has to be honest
about which is which.

**Static — `test/mobile-tokens.test.js`, wired into CI as its own step. ✅ built.** The repo already
does exactly this for translations, and for the stated reason: a missing translation is
invisible in review, so the check is made loud in the checks list
([.github/workflows/ci.yml:46](.github/workflows/ci.yml:46)). Small type is invisible in
review the same way. The test reads `styles.css` as text and asserts:

1. No `font-size` below 13px inside any `max-width` block.
2. Every rule matching a known interactive class carries a `min-height`.
3. No `px` literal for size/space/type outside the two `:root` blocks — tokens only.

> **[corrected]** Assertion 3 was never implemented, and Phase 2 decided against it. The
> base layer holds 104 sub-floor sizes across six distinct desktop values, and every one of
> those numbers is a considered desktop value that may not move. Tokenising them meant five
> hand-written pairs — five chances to type the wrong desktop number, watched by a fixture
> that covers 31 of the 104 rules. Instead each keeps its literal and gains a floor:
> `font-size: max(12px, var(--fs-min))`, where `--fs-min` is 13px on a phone and `0px` on a
> desktop. The desktop value is never replaced, so it *cannot* move — a stronger guarantee
> than the tripwire that would have checked the alternative.
>
> What the test asserts instead, since the literal now carries meaning: `--fs-min` equals
> `--fs-xs` on the phone, is `0px` on the desktop, and no `font-size: max()` anywhere floors
> against a different token. That last one matters because `max(12px, var(--fs-sm))` reads
> as deliberate and passes the ratchet, which only looks for a bare `px`.

**Ratchet — `scripts/mobile-audit.js`. ✅ built, wired into CI.** Three ceilings, all allowed
only to fall: **500** inline sub-floor sizes, **11** sub-floor `font-size` declarations
inside `max-width` blocks, and **0** in base rules outside every `@media` — that last one
started at 104 and Phase 2 emptied it in one commit. `--list` locates them, `--update` moves
the ceilings after a phase and marks a rise `↑ RAISED` rather than describing it as a fall.
Sibling to the existing `scripts/i18n-hardcoded.js`.

**Desktop-unchanged proof — `scripts/capture-desktop-baseline.js` + `test/desktop-baseline.json`.
✅ built.** 31 selectors at 1440px, captured before Phase 0 touched anything; `--compare`
re-measures and diffs. It serves `index.html` with every `<script src>` stripped, so only
the cascade decides the numbers.

> **[corrected]** This **cannot run in CI** — computing CSS needs a browser engine and this
> repo has none. Calling it "a test" in the first draft implied a gate that does not exist.
> It is a dev-time tool; the CI gates are the static assertions and the ratchet above.
>
> It also needs `Cache-Control: no-store`, which is load-bearing rather than hygiene: the
> stylesheet URL never changes between runs, so a browser will happily re-measure an older
> `styles.css`. During Phase 0 that produced one "the desktop moved" report for a rule that
> had not moved, and one "the phone is unchanged" report for a rule that had.

**Phone measurement — `scripts/measure-mobile.js`. ✅ built.** The mirror of the baseline
tool, and it exists because everything above proves the desktop did not move while nothing
proved the phone did. Every phone claim on this branch up to it was *the rule is written*,
never *it renders*. Served at 375px with the scripts stripped, it walks every element and
reports computed `font-size` under `--fs-xs` and rendered height under the touch floor.

Two touch bands, not one, and that is load-bearing rather than tidy: `--tap-min` is 56px for
a gloved hand and `--tap-sm` is 48px for a desk, and §9 chose both. Measuring everything
against 56 reports 76 sidebar buttons sitting exactly where they were put as failures, which
teaches a reader to ignore the tool. The gate is **44px** — the floor WCAG 2.5.5 AAA,
Apple's HIG and Material all agree on — and the 44→56 gap is listed but never counted.

*First run, against everything this branch had already shipped: 8 sub-floor type and 14
controls under 44px, in markup four phases had passed over.* The type is the calendar legend
at 11px; the touch list is Phase 1 chrome (`#sb-toggle` 26px, `#undo-btn` 31.5px,
`#n-notif-m` 36px, two `<summary>` rows at 19.5px) plus Büro pages Phase 4 has not reached.

**Manual, per phase.** A real phone, in the lab, with gloves on: the phase's screens, the
scan flow end to end, and one pass in landscape. Checklist lives in the PR body. Narrowed by
the tool above but not replaced by it: what a stripped page cannot show is everything
`app.js` renders — every table row, every list, every dialog body — and it cannot show
whether a target is *reachable*, only whether it is *big*. That part cannot be automated and
should not be claimed as automated.

> **[corrected]** The preview note here said the Browser pane cannot reach this app from a
> worktree — self-signed cert plus login wall — and concluded "visual checks are device-only
> until that changes". The premise is true of the *app* server and false of the measurement
> ones: both tools serve plain HTTP with every `<script src>` stripped, so there is no cert
> to reject and no login to pass. The conclusion had been standing since Phase 0 and cost
> this branch four phases of unmeasured work.

---

## 9. Decisions needed

1. **Is the Feld/Büro split in §3 right?** Specifically `p-dash` and `p-strains` in Büro,
   and `p-inv` split across both (Bestand ansehen is Feld, Bestandspflege is Büro) — that
   page may need to be cut in two rather than assigned.
2. **56px or 48px** as the Feld target? 56 is better with gloves and costs roughly one list
   row per screen. Recommend 56 for Feld, 48 for Büro; it is one token either way.
3. **Calendar on phone** — agenda list (recommended) or keep the month grid with a bigger
   cell minimum? The grid is the more expensive option and the less useful one on foot.
4. **Bridge lifetime.** Is "gone by the end of Phase 5" a commitment or an aspiration? It
   changes whether Phase 3 is one batch or three.
5. **Phase 0 alone is worth shipping.** It is roughly a day and fixes text size, target
   size and the missing scan button app-wide. Ship it before the rest is agreed?

---

## 10. What this plan does not do

Named so it is not mistaken for an oversight:

- It does not touch the 1335 inline `style` attributes beyond the font sizes. Colours,
  widths and margins stay inline. That is a bigger cleanup with a worse risk/reward ratio,
  and the token layer does not need it.
- It does not add dark mode, gestures, haptics, or an offline UI shell.
- It does not restructure `app.js`. Every change here is additive to it.
