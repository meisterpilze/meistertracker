# Meisterpilze — Project Context for Claude Code

> Read this first before touching any code. This document captures the full business and technical context from an ongoing planning session so you can continue work intelligently.

---

## The Business

**Meisterpilze UG** — gourmet mushroom farm in Erlangen, Germany.
- Website: meisterpilze.de
- Instagram: @meisterpilze
- Two scientist founders
- Growing 13 species, ~300m² operation, active scaling phase
- ~1 year operating, makeshift setup, new equipment incoming
- Government research grant (~€260,000 over 3 years) in final stages

**Sales channels:**
- Weekly farmers market (Erlangen)
- One restaurant account
- Farmers cooperative contract
- Etsy + eBay (primary: CVG substrate, all-in-one bags, grow blocks)
- Own webshop (meisterpilze.de/shop)

**Pricing:** 25–40€/kg fresh mushrooms (premium positioning)

**Revenue goal:** Path to €1M/year — farming is the "show", value-added products (dried, powder, extract) do the heavy lifting long-term. Lion's mane is the hero species for this.

---

## Existing Tech Stack (Lab Tracker — "Meisterpilze Lab Tracker")

Local Node.js full-stack application. Key features already built:
- Batch / bag / harvest tracking
- Barcode scanning via Datalogic Gryphon GD4100 (underscore-based codes — German HID keyboard remapping issue was resolved this way)
- ZPL label printing to Zebra GK420d
- Chart.js visualizations
- Local network access at fixed IP
- Biological efficiency (BE) tracking — dry weight basis (~50% BE for lion's mane)

There is also a visual project management app ("Projekt Here") with Kanban, dependency map, and calendar views built previously.

---

## What Was Built This Session

### 1. KPI Dashboard Module (`meisterpilze-kpi.jsx`)

A React component to be integrated into the lab tracker as a new module/route. It tracks the 90-day marketing sprint with 4 tabs:

- **Overview** — progress on 3 priorities, post streak, days remaining, 90-day progress bar
- **Weekly Log** — Monday check-in (posts, direct orders, email list size, restaurant contact)
- **Restaurants** — pipeline tracker: Identified → Sampled → Followed Up → Signed
- **Tracking Links** — displays the 3 Bitly links with usage instructions

State persists via `localStorage` under key `meisterpilze_kpi_v1`.

**Design:** Dark theme (`#0f1410` background), green accent (`#8bc34a`), fonts: DM Sans + Space Mono. Consistent with a farm/science aesthetic.

**To integrate:** Add as a route in the lab tracker frontend. Suggested nav label: "Growth" or "Marketing KPIs".

### 2. Bitly Tracking Links (live, created this session)

| Link | Destination | Placement |
|---|---|---|
| `bit.ly/paket` | meisterpilze.de/shop | Package flyer insert (Etsy/eBay orders) |
| `bit.ly/mpmarkt` | meisterpilze.de/shop | Farmers market stand QR code |
| `bit.ly/mpio` | instagram.com/meisterpilze | Instagram bio link |

These are live in the connected Bitly account. Check analytics weekly in app.bitly.com. QR code generation for mpmarkt requires a paid Bitly plan — generate free QR from the short URL via qr-code-generator.com or similar.

---

## 90-Day Marketing Strategy (the plan behind the dashboard)

**Three priorities only — nothing else gets added:**

### Priority 1: Own Lion's Mane online
- 1 SEO blog post per week on meisterpilze.de (German)
- Recommended first 4 articles:
  1. "Igelstachelbart Rezept: Lion's Mane Steak Schritt für Schritt"
  2. "Lion's Mane selber züchten: Anleitung in 21 Tagen"
  3. "Frische Edelpilze in Erlangen — Wo Sie Meisterpilze kaufen"
  4. "Hericium oder Lion's Mane: Ein Pilz, vier Namen"
- Repurpose each article into 2–3 Instagram posts
- Content integrated into existing daily work (harvest clips, autoclave loads, contamination catches — 30 sec phone shots, no extra production time)

### Priority 2: Build email list to 200 direct subscribers
- Add email capture to homepage — one field, incentive: free Lion's Mane growing guide PDF
- Optimise package flyer: specific % discount, 30-day expiry, QR code to dedicated landing page
- Use Brevo or Mailerlite (GDPR-native, free under 1,000 contacts)
- Set up 4 automations once: welcome series (3 emails/7 days), post-purchase grow guide (days 0/3/10/21), cart abandonment, seasonal harvest broadcast

### Priority 3: Land 1 trophy restaurant account by Day 60
- Build list of 20–30 chef-led restaurants in 50km radius (Erlangen, Nürnberg, Fürth, Bamberg)
- Priority: Michelin/Gault&Millau properties, vegetarian fine-dining, Greentable-listed
- Approach: Tuesday/Wednesday 10–11am between services, sample tray, no sales pitch
- Follow up by SMS (not email — German UWG §7 risk), 48 hours later
- Track in the restaurant pipeline (dashboard Restaurants tab)

**Content rhythm (zero extra time):**

| Daily trigger | Content | Time |
|---|---|---|
| Harvest | Weight + flush photo/clip | 30 sec |
| Autoclave load | Batch size caption | 20 sec |
| Contamination catch | Honest explanation | 1 min |
| Saturday market | Setup + sellout post | 2 min |

**Weekly KPIs to track (Monday, 2 minutes):**
1. Posts published (target ≥3/week)
2. Email list size (growing?)
3. Restaurant contacted (yes/no)
4. Direct website orders
5. Restaurants signed (target: 1 by Day 60)
6. Email list size (target: 200 by Day 90)

---

## Key Context for Future Development

**Operator constraints:**
- Solo/small team operation — no time for dedicated content production
- Strong preference for visual/interactive interfaces over plain text
- Data-driven, precise — corrects assumptions with real numbers
- Dislikes over-optimistic framing

**Regulatory notes (important for product development):**
- Fresh Hericium fruiting body: NOT novel food in EU — sell freely
- Mycelium powder: classified as novel food — requires EFSA authorisation (avoid)
- Health/cognitive claims for Lion's Mane: NOT authorised under EU Reg 1924/2006 — do not use in copy

**Existing regional registrations to complete (not yet done):**
- Original Regional Metropolregion Nürnberg (free listing, ~2,000 producers network)
- Erlangen-Höchstadt Direktvermarkter-Broschüre (free)
- Greentable nachhaltige-Lieferanten directory (free, B2B restaurant leads)

**Competitor reference:**
- Pilzling (Köln) — closest German peer, VC-backed, same dual fresh+growkit model
- Sunday Natural — German supplement brand playbook: Google-led D2C, no Amazon, deep product range
- Bears with Benefits — started Amazon → Douglas/dm/Rossmann, Instagram/Facebook/Google mix

---

## Suggested Next Dev Tasks

In priority order:

1. **Integrate `meisterpilze-kpi.jsx` into lab tracker** as a new route/module with nav entry
2. **Add email list size as a tracked field** — currently manual input in the dashboard; could auto-pull from Brevo/Mailerlite API if connected
3. **Weekly summary push notification or reminder** — Monday morning trigger to open the KPI check-in
4. **Bitly analytics panel** — embed click data from the 3 tracking links directly into the dashboard using Bitly API (already connected via MCP)
5. **Restaurant pipeline export** — simple CSV export of the pipeline for use in email outreach tracking

---

*Generated from claude.ai session, May 2026. Continue in Claude Code by dropping this file in the repo root and referencing it at session start.*
