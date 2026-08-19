# 📱 Mobile Redesign — Design Doc

> **Status:** Draft for review · **Author:** design pass with Claude · **Date:** 2026-08-19
> **Scope decision:** design only — no code in this document. Measurements taken against
> `main` @ `e656fbd`.

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
| **Inline `font-size` ≤13px** | **549** | 275 in `index.html`, 274 in `app.js` |
| Inline `style="` attributes | 1335 | 766 in `index.html`, 569 in `app.js` |
| Size / space / type tokens | **0** | `:root` has colours, 2 radii, 2 shadows, sidebar widths |

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

- **`.scan-float` is dead CSS.** Styled twice — [styles.css:3476](styles.css:3476) with
  `env(safe-area-inset-*)` handling, [styles.css:3722](styles.css:3722) to hide it in
  print — and carried by **no element in the source**. `openScanModal()`
  ([app.js:16107](app.js:16107)) is only reached from inside individual flows and the PWA
  shortcut `/?action=scan`. On a phone, mid-task, there is no way to the scanner.
- **The bottom nav's comment disagrees with the bottom nav.** [index.html:1785](index.html:1785)
  says "4 most-used pages"; five buttons follow.

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
  --fs-lg: 20px;
  --fs-xl: 26px;

  /* Touch. 44px is WCAG 2.5.5 AAA; 56 is the deliberate step beyond it for gloves. */
  --tap: 56px;
  --tap-sm: 48px;

  /* Space */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;
  --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;
  --pad-page: 16px;
  --pad-card: 16px;
}

@media (min-width: 769px) {
  :root {
    --fs-xs: 11px; --fs-sm: 13px; --fs-base: 15px; --fs-lg: 17px; --fs-xl: 22px;
    --tap: 36px;   --tap-sm: 32px;
    --pad-page: 24px; --pad-card: 20px;
  }
}
```

Then every rule that hard-codes a size consumes a token instead:

```css
body { font-size: var(--fs-base); }
.btn { padding: var(--sp-3) var(--sp-4); font-size: var(--fs-sm); min-height: var(--tap); }
.main { padding: var(--pad-page); }
.card { padding: var(--pad-card); }
```

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
    display: block; padding: var(--sp-3); margin-bottom: var(--sp-3);
    border: 1px solid var(--c-border); border-radius: var(--radius);
  }
  .t-cards td {
    display: flex; justify-content: space-between; gap: var(--sp-3);
    border: none; padding: var(--sp-2) 0; font-size: var(--fs-sm);
  }
  .t-cards td::before { content: attr(data-l); font-weight: 600; color: var(--c-text-muted); }
}
```

Per-table cost: add `class="t-cards"` to the table and `data-l="…"` to each `<td>` emitter,
once. The DOM shape, the JS, the sort/filter logic and the desktop rendering are all
untouched, and a `<td>` that is missed simply renders without its label rather than breaking.

29 tables. This is where most of the hours in this plan actually go — budget accordingly,
and see §7 for how they are sliced.

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

### Phase 0 — Tokens, inversion, bridge

- Add the `:root` token block and the `min-width: 769px` override (§4).
- Convert the class-based rules to tokens: `.btn`, `.stab`, `.card`, `.main`, `.sb-btn`,
  `table`/`th`/`td`, `.modal`.
- **Delete** the shrink-only rules: `.btn` at 480, `table { font-size: 12px }` at 768,
  `.main { padding: 8px }`, `.card { padding: 12px }`.
- Add the §6 bridge block, with the comment naming its exit condition.
- Re-attach `.scan-float` — a persistent scan button on Feld pages. The CSS is already
  written and correct; it needs an element and a click handler calling `openScanModal()`.
- Fix the bottom-nav comment to say five.

*Visible result: nothing on the phone is smaller than 13px, everything tappable is at least
48px, and the scanner is one thumb away from anywhere.*

### Phase 1 — Navigation chrome

- `.stabs` → drill-down list below 769px (§5.3); delete the wrap rule and the
  scroll-with-fade rule.
- Bottom nav becomes the primary phone navigation; the hamburger drawer becomes the
  "everything else" door rather than the main route.
- Admin drawer: the 13-entry `sb-admin-nav` gets the same drill-down treatment.

### Phase 2 — Feld pages, one PR each

In this order, cheapest and highest-traffic first:

1. **`p-work`** — mostly a type bump; `.wk-tile-t` → `--fs-base`, `.wk-tile-when` → `--fs-xs`,
   `min-height` up. Half a day.
2. **Scan overlay** — the one screen that is *always* used gloved.
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

**Static — `test/mobile-tokens.test.js`, wired into CI as its own step.** The repo already
does exactly this for translations, and for the stated reason: a missing translation is
invisible in review, so the check is made loud in the checks list
([.github/workflows/ci.yml:46](.github/workflows/ci.yml:46)). Small type is invisible in
review the same way. The test reads `styles.css` as text and asserts:

1. No `font-size` below 13px inside any `max-width` block.
2. Every rule matching a known interactive class carries a `min-height`.
3. No `px` literal for size/space/type outside the two `:root` blocks — tokens only.

**Ratchet — `scripts/mobile-audit.js`.** Counts inline `font-size` ≤13px in `index.html` and
`app.js` and fails when the number rises above the committed baseline. Starts at **549**,
and the number in the assertion goes down with each phase. Sibling to the existing
`scripts/i18n-hardcoded.js`.

**Desktop-unchanged proof.** Before Phase 0, capture the computed values of a fixed list of
~30 selectors at 1440px (font-size, padding, min-height) into a committed JSON fixture. A
test re-reads it after the token conversion. This is what makes "no desktop redesign" a
check rather than a promise.

**Manual, per phase.** A real phone, in the lab, with gloves on: the phase's screens, the
scan flow end to end, and one pass in landscape. Checklist lives in the PR body. This part
cannot be automated and should not be claimed as automated.

> **Preview note:** the Browser pane cannot reach this app from a worktree — self-signed
> cert plus login wall. Visual checks are device-only until that changes.

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
