# 🛒 Order Hub — Design Doc

> **Status:** Draft for review · **Author:** design pass with Claude · **Date:** 2026-06-08
> **Scope decision:** design only — no code yet. eBay is greenfield (no API application filed).

A central place where orders from **Wix, Etsy, and eBay** land in one inbox, resolve to your
own products, and roll up into the one question that matters in the lab:

> **"Given everything that's unfulfilled, what do I actually need to grow / make, and by when?"**

---

## 1. Goals / Non-goals

**Goals**
- One `orders` inbox, deduplicated, across all three channels.
- A product catalog that maps each platform's listing/SKU → one internal product.
- A **production-demand engine**: open orders → "make 12 shiitake blocks + 8 grain bags;
  net of what's already incubating, start 5 this week by Tuesday."
- **Customer intelligence**: dedup buyers across channels for repeat-customer, channel-attribution,
  and lifetime-value stats — for free, out of the orders you're already ingesting.
- Fit existing conventions: `node:sqlite` migrations, single-row config tables, `setInterval`
  jobs, SSE live updates, worker/admin roles, the PWA Orders tab.
- A zero-API bridge (CSV import + manual add) so the hub is useful on **day one**, before any
  channel API is live.

**Non-goals (v1)**
- **No fresh-mushroom / fresh-produce orders** — mail-order side only (grow-kits, spawn, supplies).
  The `harvest` fulfillment path is designed-for but deferred.
- Shipping labels + tracking write-back are **Phase 4, not v1** — fully planned in §11, but the
  order→production core (Phases 0–3) ships first.
- Not accounting / invoicing / VAT (you have DATEV-style asset bookkeeping already; orders stay
  operational).
- Not a replacement for the channels' own storefronts — read-mostly ingestion.

---

## 2. Where this fits today

Meistertracker is currently **100% production-side**. Confirmed against the schema — there is
no `orders`, `products`, `customers`, or `sku` concept anywhere. What exists and what we'll
connect to:

| Existing table        | Role in the order hub                                                            |
| --------------------- | ------------------------------------------------------------------------------- |
| `batches`             | A "produce" demand line becomes / links to a batch (species, strain, qty, substrate, `due`). |
| `recipes`             | Substrate formula (`hardwood_pct`/`wheatbran_pct`/`gypsum_pct`/`rh_pct`) a product's block uses. |
| `inventory`           | Raw-material rollup target (do we have the hardwood/grain to make the blocks?). |
| `harvests`            | (Deferred) fresh-mushroom lines would allocate against harvest grams — not in v1.             |
| `manual_tasks`        | Optional: a demand line can spawn a "start batch X" task with a `due_date`.      |
| `duckdns_config` / `print_bridge_config` | The **single-row config-table pattern** the channel credentials copy. |
| SSE broadcast         | New order → live badge on the Orders tab, same channel the app already uses.     |
| `setInterval` jobs    | The order poller is one more job (DuckDNS already polls every 5 min — same shape).|

---

## 3. Data model

All new tables ship as **migrations v42+** (latest is v41), same style as `db.js`
(`node:sqlite`, ISO-8601 `TEXT` timestamps, `INTEGER` booleans, single-row config with
`CHECK (id = 1)`).

### 3.1 Channel credentials — `sales_channel_config`

One row per channel. Mirrors `duckdns_config` (single-row, `enabled` flag, secret columns).

```sql
CREATE TABLE IF NOT EXISTS sales_channel_config (
  channel        TEXT PRIMARY KEY,            -- 'wix' | 'etsy' | 'ebay'
  enabled        INTEGER DEFAULT 0,
  -- generic credential bag; not every field used by every channel
  api_key        TEXT DEFAULT '',             -- Wix API key
  site_id        TEXT DEFAULT '',             -- Wix site id / Etsy shop id / eBay marketplace
  client_id      TEXT DEFAULT '',             -- Etsy keystring / eBay App ID
  client_secret  TEXT DEFAULT '',             -- eBay Cert ID, etc.
  access_token   TEXT DEFAULT '',             -- OAuth access token (Etsy/eBay)
  refresh_token  TEXT DEFAULT '',             -- OAuth refresh token (Etsy/eBay)
  token_expires  TEXT,                        -- ISO ts; refresh proactively before this
  webhook_secret TEXT DEFAULT '',             -- Wix webhook JWT / signature verification
  last_sync      TEXT,                        -- watermark: last successful poll
  last_cursor    TEXT,                        -- updated_min / pagination cursor
  last_error     TEXT,                        -- surfaced in the admin UI
  created        TEXT NOT NULL
);
```

> **Secrets at rest.** These are higher-value than the DuckDNS token (they read customer PII and
> can act on your shops). Two options — see §10. Recommendation: encrypt `*_token`/`*_secret`
> columns with a key derived from an env var, decrypt only in memory.

### 3.2 Product catalog — `products`

```sql
CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sku             TEXT UNIQUE,                 -- your internal SKU (nullable for ad-hoc)
  name            TEXT NOT NULL,
  category        TEXT,                        -- 'growkit' | 'spawn' | 'culture' | 'fresh' | 'supply'
  species         TEXT,                        -- nullable; for grow kits / fresh
  strain          TEXT,
  active          INTEGER DEFAULT 1,
  notes           TEXT DEFAULT '',
  created         TEXT NOT NULL
);
```

### 3.3 Channel ↔ product mapping — `product_channel_map`

The linchpin. The same grow kit has a different listing id on each platform, so an order only
becomes useful once it resolves to a shared `product_id`.

```sql
CREATE TABLE IF NOT EXISTS product_channel_map (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel     TEXT NOT NULL,                   -- 'wix' | 'etsy' | 'ebay'
  channel_sku TEXT,                            -- platform SKU if present
  listing_id  TEXT,                            -- platform listing/variation id
  product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
  created      TEXT NOT NULL,
  UNIQUE (channel, channel_sku, listing_id)
);
```

Unmapped incoming lines resolve to `product_id = NULL` → they appear in a **"needs mapping"**
queue in the UI (one click to bind to a product, remembered forever).

### 3.4 What it takes to fulfill — `product_components` (the BOM)

This is what turns an order into "what to make." Lead-time-aware, and supports **bundles**
(a starter kit = 1 block + 1 spawn bag + a printed guide).

```sql
CREATE TABLE IF NOT EXISTS product_components (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  fulfill_type  TEXT NOT NULL,                 -- 'produce' | 'harvest' | 'stock'
  -- produce: make a batch
  batch_type    TEXT,                          -- 'block' | 'grain'  (matches batches.batch_type)
  species       TEXT,
  strain        TEXT,
  recipe_id     INTEGER REFERENCES recipes(id),-- substrate formula for the block
  lead_days     INTEGER DEFAULT 0,             -- colonisation time → start_by = ship_by - lead_days
  -- harvest: allocate fresh grams
  grams         REAL,
  -- common
  qty_per_unit  REAL NOT NULL DEFAULT 1,       -- components per 1 ordered unit
  notes         TEXT DEFAULT ''
);
```

- **grow kit** → one `produce`/`block` row, `lead_days ≈ 21`, `recipe_id` = its substrate.
- **grain spawn** → one `produce`/`grain` row.
- **fresh mushrooms** → one `harvest` row, `grams` set.
- **eBay supplies** (the cultivation gear) → one `stock` row, no production.

> v1 can collapse this to a 1:1 "one product = one component" if you'd rather not model bundles
> yet — the engine query is identical, just fewer rows. Recommendation: keep the table,
> it's the same effort and bundles are inevitable.

### 3.5 Orders — `orders` + `order_items`

```sql
CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  channel         TEXT NOT NULL,               -- 'wix' | 'etsy' | 'ebay' | 'manual'
  channel_order_id TEXT NOT NULL,              -- platform order id (or generated for manual)
  status          TEXT NOT NULL DEFAULT 'new', -- new|in_production|ready|shipped|cancelled
  order_date      TEXT,
  ship_by         TEXT,                        -- channel SLA / promised date → drives urgency
  customer_id     INTEGER REFERENCES customers(id), -- deduped aggregate (§3.7)
  customer_name   TEXT,                        -- snapshot at order time
  customer_email  TEXT,
  ship_country    TEXT,
  total_amount    REAL,
  currency        TEXT,
  raw_json        TEXT,                        -- full payload for re-parsing / audit
  imported        TEXT NOT NULL,
  updated         TEXT NOT NULL,
  UNIQUE (channel, channel_order_id)           -- idempotency: re-sync never duplicates
);

CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  channel_sku  TEXT,
  listing_id   TEXT,
  title        TEXT,                            -- platform line title (for the mapping UI)
  qty          INTEGER NOT NULL DEFAULT 1,
  product_id   INTEGER REFERENCES products(id), -- NULL = needs mapping
  unit_price   REAL
);
CREATE INDEX IF NOT EXISTS idx_orderitems_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
```

The `UNIQUE (channel, channel_order_id)` constraint is the whole idempotency story — the same
pattern you already rely on with `scan_log.client_uuid` (the I-11 index). Polls upsert; webhooks
upsert; CSV re-imports upsert. No doubles, ever.

### 3.6 Sync audit — `order_sync_log` (optional but cheap)

```sql
CREATE TABLE IF NOT EXISTS order_sync_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  time      TEXT NOT NULL,
  channel   TEXT NOT NULL,
  ok        INTEGER NOT NULL,
  fetched   INTEGER DEFAULT 0,                  -- orders seen
  upserted  INTEGER DEFAULT 0,                  -- new/changed
  message   TEXT
);
```

Surfaces "last sync 4 min ago, 3 new" and errors in the admin UI — same spirit as
`backups/.backup-status.json`.

### 3.7 Customers — `customers` + `customer_identities`

A deduped buyer record so repeat-customer, channel, and lifetime-value stats fall out of orders
you already ingest. The `orders` row keeps its own PII snapshot; `customers` is the rolled-up
aggregate.

```sql
CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT,                          -- lowercased; primary dedup key when present
  name          TEXT,
  country       TEXT,
  first_channel TEXT,                          -- where we first saw them
  first_order   TEXT,
  last_order    TEXT,
  order_count   INTEGER DEFAULT 0,             -- maintained on every import
  total_spent   REAL DEFAULT 0,
  currency      TEXT,
  notes         TEXT DEFAULT '',
  created       TEXT NOT NULL,
  UNIQUE (email)
);

-- eBay masks buyer email, and one person may buy on several channels → match on a per-channel
-- handle, with manual merge to fold identities into one customer.
CREATE TABLE IF NOT EXISTS customer_identities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,                   -- 'wix' | 'etsy' | 'ebay'
  handle      TEXT NOT NULL,                   -- email, eBay username, Etsy buyer id…
  created     TEXT NOT NULL,
  UNIQUE (channel, handle)
);
```

Import resolution: lookup `(channel, handle)` in `customer_identities` → if found, use that
customer; else if `email` matches an existing customer, link + add the identity; else create.
Then bump `order_count` / `total_spent` / `last_order`. Cross-channel matches that aren't certain
stay separate until you **manually merge** them in the UI.

### 3.8 Reservation — `order_allocations`

When you commit to producing for an order, this links the order line to the batch making it, so it
**drops off the make-list** (your "reserve for customer" choice).

```sql
CREATE TABLE IF NOT EXISTS order_allocations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  batch_id      TEXT REFERENCES batches(batch_id) ON DELETE SET NULL,  -- the producing batch
  qty           REAL NOT NULL,                 -- component units reserved for this line
  status        TEXT NOT NULL DEFAULT 'reserved', -- reserved | produced | shipped
  created       TEXT NOT NULL,
  UNIQUE (order_item_id, batch_id)
);
CREATE INDEX IF NOT EXISTS idx_alloc_batch ON order_allocations(batch_id);
```

A batch's `qty` is its capacity; allocations consume it, so one batch can be reserved across
several orders up to that capacity (the UI shows "#B-241: 7 blocks, 5 reserved, 2 free").
Manual override = add/edit/remove allocations by hand.

---

## 4. The production-demand engine (the payoff)

A single derived view, recomputed on demand (cheap at your volumes). It is **reservation-aware**:
once you commit to making something for an order, that order stops asking for it.

```
1. Take order_items on orders with status IN ('new','in_production'),
   component.fulfill_type = 'produce'      (stock = pick & pack; harvest = deferred in v1)
2. reserved   = Σ order_allocations.qty already linking those items to a batch
3. gross_need = Σ (item.qty × component.qty_per_unit) − reserved
   grouped by (batch_type, species, strain, recipe_id)
4. free_pipe  = open batches matching (species, strain, batch_type),
                capacity minus what's already allocated to other orders
5. net_to_start = max(0, gross_need − free_pipe)
6. start_by     = min(order.ship_by) − component.lead_days     ← urgency / sort key
```

**Clicking "Create batch" on a row reserves it** — it writes `order_allocations` (status
`reserved`) for the contributing lines, so they drop out of `gross_need` on the next recompute and
the order moves to `in_production`. Manual override = edit or remove those allocations.

**Worked example**

| Need (component)               | Gross | Free pipeline         | **Net to start**    | Start by |
| ------------------------------ | ----- | --------------------- | ------------------- | -------- |
| Shiitake block (recipe "HW-S") | 12    | 7 free (batch #B-241) | **5**               | Jun 14   |
| Oyster grain bag               | 8     | 3 free (#B-238)       | **5**               | Jun 11   |
| Cultivation supplies           | 6     | — (stock)             | **0 — pick & pack** | —        |

From a net-to-start row, one click → **pre-filled "Create batch"** (species/strain/qty/recipe/
`due = start_by + lead_days`) which also reserves it against the orders that drove it — or a
**manual_task** "Start 5× shiitake blocks by Jun 14". That's the bridge from sales back into the
production tracker you already run.

### 4.1 Customers — repeat buyers & channel attribution

Every import upserts a `customers` row (§3.7): dedup by lowercased email, falling back to
`customer_identities` (eBay masks buyer email) with manual merge to fold one person's eBay + Etsy +
Wix identities together. Maintained automatically per customer — order count, total spent,
first/last order, first channel. With zero extra data entry you get:

- **Repeat customers** — who has ordered more than once, and how often.
- **Channel attribution** — which channel each customer came from and buys most on.
- **Lifetime value** — total spent, average order, recency — the inputs for rewarding regulars.

---

## 5. Sync architecture

Two ingestion modes, one normalizer per channel writing the same `orders`/`order_items` shape:

- **Webhook (push)** — Wix only. `POST /api/orders/webhook/wix`, verify signature, upsert,
  SSE-broadcast. Near-real-time.
- **Poll (pull)** — Etsy + eBay. A `setInterval` job (model it on `updateDuckdnsIP`'s 5-min
  timer) walks each enabled channel using the `last_sync` / `last_cursor` watermark, fetches
  orders changed since, upserts, advances the watermark, writes `order_sync_log`.

Cross-cutting:
- **Idempotent upsert** keyed on `(channel, channel_order_id)` — webhook and poll can both see the
  same order, only one row results.
- **Token refresh** — before each Etsy/eBay call, if `token_expires` is within ~5 min, refresh and
  persist. (Etsy access token ~1 h, eBay ~2 h — verify at build time.)
- **Backoff** — on 429/5xx, exponential backoff; record `last_error`; never crash the timer.
- **PII minimization** — store only what fulfillment needs (name, ship country, email for contact);
  keep the raw payload in `raw_json` with a retention cap (§10).

---

## 6. Per-channel integration plans

### 6.1 Wix — *easiest, do first*

- **Auth:** API Key + Site ID (header `Authorization: <API key>` + `wix-site-id: <site id>`).
  Simplest for a single site you own; no OAuth dance.
- **Read orders:** Wix eCommerce **Orders** API — `Search/Query Orders` + `Get Order`.
- **Push:** Wix webhooks (e.g. *Order Paid / Order Created*) → your `/api/orders/webhook/wix`,
  payload signed as a JWT you verify against Wix's public key (`webhook_secret`).
- **Why first:** confirmed available to you, supports real-time push, exercises the full
  catalog → mapping → demand path end-to-end on one channel.

### 6.2 Etsy — *already approved, poll-based*

- **Auth:** OAuth 2.0 **Authorization Code + PKCE** (you've already implemented PKCE — as an MCP
  *provider*; here you're the *client*, mirror image but same concepts). Scope `transactions_r`
  (read receipts); add `transactions_w` later for marking shipped.
- **Read orders:** orders = **Shop Receipts** → `getShopReceipts` (filter `was_paid=true`,
  paginate, use `min_last_modified` as the watermark).
- **No webhooks** → poll every few minutes. Access token ~1 h → auto-refresh with the refresh
  token (good ~90 days). Rate limits ~10/s, ~10k/day — a 5-min poll is nowhere near.

### 6.3 eBay — *greenfield; here's the exact runway*

You haven't applied, so the plan includes onboarding. The important correction up front:

> For **your own sales** you need the **Sell → Fulfillment API** (`getOrders`). That is
> **generally available** — it is *not* the rejection-prone gate. The gate everyone means when
> they say "eBay is hard" is the **Buy API**, which you do **not** need.

**Onboarding checklist**
1. Create an eBay **developer account** → an application → get **Sandbox + Production keysets**
   (App ID / Cert ID / Dev ID).
2. **Marketplace Account Deletion/Closure notification endpoint** — eBay will not fully activate
   production keys until your app exposes a public HTTPS endpoint that:
   - answers a **GET verification challenge**: compute `SHA-256(challengeCode + verificationToken +
     endpointURL)` and return it as JSON; and
   - **acks POST** account-deletion notifications with `200`.
   You already run public HTTPS (DuckDNS + Let's Encrypt) → meistertracker can host this at e.g.
   `/api/orders/webhook/ebay-deletion`. **This is usually the entire blocker** — it's ~30 lines.
3. **OAuth user token:** Authorization Code grant; you (the seller) consent once. Scope
   `https://api.ebay.com/oauth/api_scope/sell.fulfillment` (read). Access token ~2 h, refresh
   token ~18 months → auto-refresh + persist.
4. **Read orders:** Sell **Fulfillment** `getOrders` (filter on `lastmodifieddate`, paginate).

**Interim bridge (works now, zero API):** Seller Hub → Orders → **CSV export** → drop into a
`POST /api/orders/import` (channel `ebay`, same upsert path), plus a **manual add** form. So eBay
is in the hub from day one and the API just makes it automatic later.

---

## 7. REST API surface (matches your `/api/*` style)

| Method & path                          | Role   | Purpose                                  |
| -------------------------------------- | ------ | ---------------------------------------- |
| `GET  /api/orders`                     | worker | List/filter orders (status, channel)     |
| `GET  /api/orders/:id`                 | worker | Order detail + items                     |
| `PATCH /api/orders/:id`                | worker | Set status (in_production/ready/shipped)  |
| `POST /api/orders/import`              | admin  | CSV/manual import (any channel)          |
| `GET  /api/orders/demand`             | worker | The §4 production-demand rollup          |
| `POST /api/orders/demand/:row/batch`  | worker | Create a pre-filled batch from a demand row |
| `GET  /api/products` · `POST/PATCH`    | admin  | Catalog CRUD                             |
| `GET  /api/products/unmapped`         | admin  | Lines needing a product mapping          |
| `POST /api/products/map`              | admin  | Bind a channel listing → product         |
| `GET/POST /api/channels/:c/config`    | admin  | Channel credentials + enable/disable     |
| `POST /api/channels/:c/sync`          | admin  | Force a sync now                         |
| `POST /api/orders/webhook/wix`         | public | Signed Wix webhook                       |
| `GET/POST /api/orders/webhook/ebay-deletion` | public | eBay account-deletion compliance   |

Role gating follows your README matrix: viewing demand = worker; editing catalog/credentials =
admin (like inventory thresholds & suppliers).

---

## 8. UI — new "Orders" tab (PWA)

Three screens, consistent with the existing tabbed SPA + SSE live updates:

1. **Inbox** — orders across channels, channel badge, status chips, `ship_by` urgency colouring,
   a **"needs mapping (N)"** banner. Offline-friendly like the rest of the PWA.
2. **Mapping** — unresolved listing lines on the left, product picker on the right; bind once,
   remembered. Catalog + components editor lives here too.
3. **To-Make board** — the §4 table: net-to-start per component, sorted by start-by date, each row
   with **"Create batch"** / **"Add task"**. This is the screen you'd actually open each morning.
4. **Customers** — repeat buyers, channel attribution, lifetime value (reads the §4.1 aggregates),
   with a one-click "erase customer" for deletion requests.

---

## 9. MCP additions (optional, you already have the surface)

Natural new tools on `mcp-server.js`: `list_orders`, `get_production_demand`,
`map_listing_to_product`. Then *"Claude, what do I need to grow this week?"* answers from live
order data. Cheap once the REST layer exists.

---

## 10. Security, PII & data protection

- **Customer data is retained for analytics (your call).** You want repeat-customer and
  channel-attribution stats, so customer records **persist** rather than being purged. That's a
  legitimate use — just keep it clean under GDPR (you're in DE): document a **legitimate-interest**
  basis for retaining purchase history, offer **access / deletion** on request (a one-click "erase
  customer" that nulls PII but can keep the anonymized aggregates so your totals don't break), and
  cap only the bulky raw payloads — e.g. drop `orders.raw_json` after ~12 months while the parsed
  stats live on. The meistertracker.com legal/privacy notice already exists to point buyers at.
- **Secrets at rest.** Existing config tables store tokens in **plaintext** (DuckDNS token, print
  bridge token). Channel refresh tokens are more sensitive. **Recommendation:** encrypt
  `access_token`/`refresh_token`/`client_secret` with AES-GCM using a key from an env var
  (`ORDERS_SECRET_KEY`), decrypt only in memory. Falls back to plaintext if unset, matching
  current behavior. Either way, the credentials API is **admin-only** and the encrypted DB backup
  already covers exfil-via-backup.
- **Webhook auth.** Verify Wix JWT signatures and the eBay challenge token — public endpoints must
  reject forged payloads.

---

## 11. Versand & Tracking — Labels kaufen + Tracking-Rückkanal (Phase 4)

The fulfillment time-sink is hopping between carrier portals and three channel backends. This phase
collapses it to **one "Pack & Ship" action** inside Meistertracker. It's the most involved module,
but one decision removes most of the complexity.

### 11.1 Principle: one aggregator API, not per-carrier

Integrating **DHL + DPD + Hermes** each directly = three contracts + three uneven APIs + slow
onboarding. Instead use **one shipping-aggregator API** that fronts all of them (and usually offers
better-than-retail rates). Candidates for Germany: **Shipcloud** (API-first, German),
**Sendcloud** (more turnkey, has marketplace connectors), **Billbee** (covers more of the order
side too). *Provider choice is a separate comparison — the design below stays provider-agnostic
behind a thin `shipping/provider.js` adapter, so swapping later is cheap.*

> **Division of labour:** Meistertracker stays the **brain** (orders → production → pack-ready);
> the aggregator is only the **arm** (label + tracking). One API call between them.

### 11.2 Data model

Add package data to products, plus two new tables (migrations continue after the v42+ block):

```sql
-- products gain shipping defaults → one-click label buying
ALTER TABLE products ADD COLUMN weight_g        INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN length_cm       REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN width_cm        REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN height_cm       REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN default_carrier TEXT;   -- 'dhl' | 'dpd' | 'hermes'
ALTER TABLE products ADD COLUMN default_service TEXT;   -- carrier service code

-- aggregator credentials (single-row, like duckdns_config)
CREATE TABLE IF NOT EXISTS shipping_config (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  enabled         INTEGER DEFAULT 0,
  provider        TEXT DEFAULT '',              -- 'shipcloud' | 'sendcloud' | …
  api_key         TEXT DEFAULT '',
  api_secret      TEXT DEFAULT '',
  sender_json     TEXT DEFAULT '',              -- your Absender address
  default_carrier TEXT DEFAULT 'dhl',
  test_mode       INTEGER DEFAULT 1
);

-- one row per parcel
CREATE TABLE IF NOT EXISTS shipments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier           TEXT,                       -- 'dhl' | 'dpd' | 'hermes'
  service           TEXT,
  weight_g          INTEGER,
  tracking_number   TEXT,
  tracking_url      TEXT,
  label_format      TEXT,                       -- 'pdf' | 'zpl'
  label_ref         TEXT,                       -- stored label file / blob
  cost              REAL,
  currency          TEXT,
  provider          TEXT,                       -- aggregator used
  provider_ref      TEXT,                       -- aggregator shipment id (cancel/refund)
  status            TEXT NOT NULL DEFAULT 'created', -- created|purchased|handed_over|in_transit|delivered|cancelled
  pushed_to_channel INTEGER DEFAULT 0,          -- tracking written back yet?
  push_error        TEXT,
  created           TEXT NOT NULL,
  updated           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
```

Encrypt `shipping_config.api_key`/`api_secret` with the same `ORDERS_SECRET_KEY` scheme as the
channel tokens (§10).

### 11.3 The "Pack & Ship" flow (the actual time-saver)

From an order that's produced/ready, **one screen**:

```
Order (address + items known)
  → weight/size auto-filled from products  (override if needed)
  → pick carrier/service                   (default per product; rules e.g. >2 kg → DPD)
  → "Label kaufen"   → aggregator returns label (PDF/ZPL) + tracking number
  → print to the 100×150 printer           (existing print pipeline / print-bridge)
  → tracking written back to the channel   → order = "Versandt", allocations = "shipped"
```

No portal-hopping, no retyping tracking into three backends. **Batch mode:** select N orders →
buy + print all labels in one pick/pack run.

### 11.4 Label printing — already solved

You can print **100×150 mm** labels → no new hardware. Aggregators return either **PDF** (send
straight to that printer) or **ZPL** (reuse the existing **print-bridge** that already drives the
Zebra). The 50×30 product/bag labels stay on the GK420d; parcels go to the 100×150.

### 11.5 Tracking write-back — supported on all three channels

| Channel | Call | Effect |
| ------- | ---- | ------ |
| **Wix** | Create **Fulfillment** (trackingNumber + shippingProvider) | order → fulfilled, buyer notified |
| **Etsy** | `createReceiptShipment` (tracking_code + carrier_name) | marks shipped, buyer email |
| **eBay** | `createShippingFulfillment` (trackingNumber + shippingCarrierCode) | marks shipped — *same Fulfillment API used to read orders* |

Caveat: each channel has its **own carrier-name list**, so keep a small `carrier_map`
(`dhl`/`dpd`/`hermes` → each platform's exact code). eBay write-back rides on the Phase 3 eBay
auth, so **Wix + Etsy tracking can go live before eBay**.

### 11.6 Delivery status (nice-to-have)

Aggregators emit **tracking webhooks** → `POST /api/shipping/webhook/:provider` updates
`shipments.status` (in_transit → delivered). Gives you a "Sendungsverfolgung" column with no manual
checking, and closes the loop on "where is order X".

### 11.7 REST surface (Phase 4)

| Method & path | Role | Purpose |
| ------------- | ---- | ------- |
| `POST /api/orders/:id/shipment/rates` | worker | (optional) live rate/service options |
| `POST /api/orders/:id/shipment` | worker | buy label → returns label + tracking |
| `POST /api/shipments/:id/print` | worker | send label to printer / print-bridge |
| `POST /api/shipments/:id/push` | worker | write tracking back to the channel (or automatic) |
| `POST /api/shipping/webhook/:provider` | public | delivery-status updates |
| `GET/POST /api/shipping/config` | admin | aggregator credentials + sender address |

UI: a 5th Orders sub-screen **"Versand"** (pack queue → buy → print → done), plus a "Label kaufen"
button on each ready order.

---

## 12. Phased rollout

| Phase | Deliverable                                                                 | Rough effort |
| ----- | --------------------------------------------------------------------------- | ------------ |
| **0** | Migrations v42+ (all tables), catalog CRUD, **manual add + CSV import**, mapping UI, **reservation-aware To-Make board**, **customers view**. Useful with zero APIs. | ~3 days |
| **1** | **Wix** live (API key + Order webhook + poll fallback).                      | ~1–2 days |
| **2** | **Etsy** live (OAuth+PKCE client, `getShopReceipts` poller, token refresh).  | ~2 days |
| **3** | **eBay**: account-deletion endpoint → keyset activation → OAuth user token → `getOrders` poller. (You do the eBay-portal steps; I build the endpoints.) | ~2 days + your portal time |
| **4a** | **Versand**: shipping-aggregator adapter → buy label, print (100×150 PDF/ZPL), store tracking (§11). DHL + DPD + Hermes via one API. | ~2–3 days\* |
| **4b** | **Tracking-Rückkanal**: push tracking to Wix / Etsy / eBay (reuses channel auth from Phases 1–3); delivery-status webhook; MCP tools. | ~2 days |

\* plus provider selection + aggregator account/contract setup (see the provider comparison).

Phase 0 alone delivers the core value — every order in one place and a real "what to make"
list — even before a single API is connected.

---

## 13. Decisions

**Resolved (this round)**
- ✅ **No fresh-mushroom orders in v1** — mail-order only (grow-kits / spawn / supplies);
  `harvest` fulfillment deferred.
- ✅ **Reserve on batch creation** — making a batch from a demand row reserves it against the
  driving orders so it drops off the make-list (§3.8, §4); manual override supported.
- ✅ **Retain customer data for analytics** — keep repeat-customer / channel / LTV stats long-term
  (§3.7, §4.1, §10), with a deletion-request path rather than a blanket purge.

**Still open**
1. **Bundles now or later?** Keep `product_components` (supports kits) vs. 1:1 product=recipe.
   *(Recommend: keep it — same effort.)*
2. **Encrypt channel secrets at rest?** *(Recommend: yes, env-keyed, plaintext fallback.)*
3. **Cross-channel customer identity.** Auto-merge a buyer across channels when email matches, and
   leave manual merge for the rest (eBay masks email)? *(Recommend: yes — auto on email,
   `customer_identities` + manual merge otherwise.)*
4. **Shipping provider + tariffs (Phase 4).** Which aggregator (Shipcloud / Sendcloud / Billbee …),
   and bring-your-own carrier contracts vs. the aggregator's negotiated rates? *(Pending the
   provider comparison — research in progress.)*

---

*Next step once you've reviewed: I turn Phase 0 into a PR (migrations + catalog + manual/CSV +
reservation-aware To-Make board + customers view), and we iterate channels from there.*
