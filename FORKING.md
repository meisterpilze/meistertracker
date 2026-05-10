# Forking Meistertracker for your own lab

Meistertracker was built for [Meisterpilze](https://www.meisterpilze.de) — a
mushroom cultivation farm in Erlangen, Germany — and a few rough edges still
reflect that. None of these block running it as-is, but if you fork or
self-host you should know what's tuned to a specific operator vs. what's
generic.

If you only want to **run** Meistertracker (not modify it), follow
[DEPLOYMENT.md](DEPLOYMENT.md) — none of this is required to start the
server.

---

## 1. Branding & visible names

By default the user-facing UI says `Meistertracker` (the product name).
The text `Meisterpilze` is the original operator's brand and only appears
in places where renaming would break compatibility with existing CalDAV
clients:

| File | What stays as `meisterpilze` | Why |
|---|---|---|
| `server.js` | `PRODID:-//Meisterpilze Lab Tracker//EN` in generated iCal | Some clients cache this and re-issuing breaks sync |
| `server.js` | `X-MEISTERPILZE-TYPE`, `X-MEISTERPILZE-ASSIGNEE`, `X-MEISTERPILZE-BATCH` custom iCal properties | Used to round-trip task / batch metadata with subscribed clients |
| `server.js` | UID suffix `@meisterpilze` (`batch-XYZ@meisterpilze`, `cev-NN@meisterpilze`) | iCal RFC 5545 — UIDs must remain stable across edits |
| `server.js` | CalDAV shared-calendar slug `meisterpilze` (in URL `/caldav/calendars/.../meisterpilze`) | Apple Calendar / Thunderbird subscribe by URL; renaming forces every client to re-subscribe |
| `server.js` | CalDAV `WWW-Authenticate: Basic realm="Meisterpilze CalDAV"` | Cosmetic |

If you're starting **fresh** (no CalDAV clients yet) you can grep+replace
these freely. If you're migrating from an existing instance, change them
only with a synchronised re-subscribe across all calendar clients.

The PWA cache name (`sw.js` — `meistertracker-v22`) is bumped on rebrand
so existing clients re-fetch the shell.

## 2. Hardware assumptions

### Label printer — **read this carefully before forking the print code**

The print pipeline is built tightly around one specific setup:

> **ZPL II · 203 dpi · 50×30 mm landscape · Zebra GK420d (or compatible)**

Everything else needs varying amounts of work.

#### What works out of the box

Any ZPL-II thermal printer at 203 dpi with 50×30 mm label stock.
Verified models include the Zebra **GK420d / GK420t / GX420d / ZD220 /
ZD230 / ZD420 / ZD500 / ZD620**. ZPL-clone printers (Argox CP-2140,
Bixolon SLP-TX400 in ZPL mode) at the same dpi/label size also work.

Set `PRINTER_NAME=<exact Windows printer name>` (env or `.env`) so the
print bridge can find it.

#### What "slightly different" labels can do

The env vars `LABEL_WIDTH_DOTS` and `LABEL_HEIGHT_DOTS` only change the
`^PW` / `^LL` headers the printer reads — they do **not** change the
field layout inside the label. So they're useful when:

- ✅ Your label feeder reports slightly different dots (e.g. 408×244 vs. 400×240)
- ✅ You print the same 50×30mm content on slightly larger stock and accept blank margin

They're **not** enough when:

- ❌ Your labels are a different physical size (e.g. 40×20mm or 75×50mm) — text and barcodes will overflow or sit in the corner
- ❌ Your printer is 300 dpi — every font and coordinate would need to double
- ❌ Your labels are portrait-oriented

#### What needs a layout refactor (~200 LOC)

The 50×30mm canvas is the single source of truth. The layout assumes
`width=400` everywhere — the comment at `app.js:9493` says so explicitly.
Hard-coded coordinates live in:

| File | Where | What |
|---|---|---|
| `app.js` | `bagLabelItems()` ~9673 | Bag label fields (y=155/185/215, blockW=400, fontH=28/24/24) |
| `app.js` | `labLabelItems()` ~9743 | Lab/culture label fields (same scheme) |
| `app.js` | `bcParams()` ~9482 | Barcode width + centering, hardcoded `> 400` and `(400 - w) / 2` |
| `app.js` | Asset-print template ~7677 | `^FB400`, `^A0N,30,30` etc. inline in ZPL strings |
| `app.js` | `buildPreviewCell()` UI preview | `viewBox="0 0 400 240"` — the in-app preview is also pinned to 400×240 |
| `mcp-server.js` | `itemsToZPL()` and `bagLabelItems()` ~121 | Mirror of the client logic for MCP-driven printing |

Forking for a different label size means editing all six places (or
introducing a label-template abstraction) and updating the preview
viewBox. Not impossible, but more than a config tweak.

#### What needs a new print backend (much bigger scope)

Brother QL-series, Dymo LabelWriter, Citizen CL-S, and most non-Zebra
thermal printers don't speak ZPL at all. To support them you'd add a
new pipeline that emits raster bitmaps (PNG/PDF) and a corresponding
print-bridge for those drivers. That's a separate project, not a
config swap.

#### Print bridge

`scripts/print-bridge.ps1` is **Windows-only**. Linux/macOS hosts fall
back to "ZPL download" — the UI emits a `.zpl` file the operator
forwards to a print queue manually. Documented in
[DEPLOYMENT.md §12](DEPLOYMENT.md#12-windows-print-bridge-optional).

### Cameras (optional `mushroom_camera/` module)

Generic RTSP — works with any ONVIF camera (Reolink, Hikvision, generic).
URLs are env-only (`CAM1_RTSP`, `CAM2_RTSP`, …). YOLOv8 + HSV thresholds
are exposed as env vars; defaults work for the typical fruiting-tent
lighting Meisterpilze runs.

The Python module is **AGPL-3.0** (because Ultralytics YOLOv8 is). If
you embed it in a non-AGPL project you need an Ultralytics commercial
licence.

## 3. Geography / locale

| Default | Where | How to change |
|---|---|---|
| UI language `de` | `app.js:59` `localStorage.mp-lang \|\| 'de'` | User picks via the language selector in the sidebar; default is per-browser |
| Date format `DD.MM.YY` | `app.js` `fmtDt()` | Hardcoded — change in `app.js` if you need ISO or US format |
| Server timezone | KPI snapshots, "due today" buckets are based on the **server's local timezone** at midnight | Run with `TZ=Europe/Berlin` (or your zone) in the service env |
| Currency `€`, locale `de-DE` | `app.js:7305` `formatEur()` (asset register only) | Hardcoded — see "Asset register" below |

## 4. Workflow / business-logic assumptions

### Default zones

Migration v7 seeds `SPAWN`, `INC`, `TENT1`, `TENT2`, `TENT3`, `CONTAM`
with English names. The dashboard maps the canonical IDs to localised
display names via `KNOWN_ZONE_I18N` in `app.js`. Rename in **Settings →
Zones** if your physical layout is different (e.g. greenhouse-A,
greenhouse-B). The localisation falls away once your name no longer
matches the i18n key.

### Inventory schema

The `inventory` table has fixed columns for substrate stock:
`stock_hardwood`, `stock_wheatbran`, `stock_gypsum`, `stock_grain`. Same
for `batches.sub_*`. A lab that tracks straw pellets, coffee grounds,
millet, or soy hulls **cannot** add those without a schema migration in
`db.js:118-133` and corresponding column additions in `batches`. Display
names ARE translatable; the underlying schema is not.

### Asset register (`app.js:7305+`)

Built for **German Anlagebilanzierung**:

- GWG threshold €800 (Geringwertige Wirtschaftsgüter, §6 Abs. 2 EStG)
- AfA depreciation method
- Currency formatted as `1.234,56 €` (de-DE)
- CSV export headers in German (`Inventar-Nr`, `Anschaffungsdatum`, `Buchwert`, …)
- Asset ID format `INV-NNNN`

If you're not in DE/AT/CH, treat this as an "equipment list" and ignore
the depreciation columns. Or fork the asset-register section.

## 5. External services

| Service | Status | Required? |
|---|---|---|
| **DuckDNS** | Hardcoded in `server.js:1023+` for built-in DDNS + Let's Encrypt DNS-01 | Optional — only if you want a public hostname with a real cert. For other DNS providers (Cloudflare, Route53, etc.), use the Nginx-reverse-proxy path in DEPLOYMENT.md §7 |
| **Let's Encrypt** | Built-in via DuckDNS | Optional — self-signed cert works for LAN-only |
| **GitHub webhook auto-deploy** | `/api/webhook/github` calls `git pull && pm2 restart` | Optional — set `GITHUB_WEBHOOK_SECRET` to enable |

## 6. Deployment defaults

| Variable | Default | Override |
|---|---|---|
| `PORT` | `3000` | env |
| `DB_FILE` | `meistertracker.db` next to `server.js` | env |
| `PRINTER_NAME` | `ZDesigner GK420d` | env |
| `LABEL_WIDTH_DOTS` / `LABEL_HEIGHT_DOTS` | `400` / `240` | env |
| `PM2_PROCESS_NAME` | `meisterpilze` | env (also `update_server.sh` and `START.bat`) |
| `BACKUP_FILENAME_PREFIX` | `meisterpilze_backup_` | env — pick a fork-specific value **before** the first auto-backup, otherwise existing files won't match the rotation regex |
| `PUBLIC_HOSTNAME` | derived from `Host:` header | env — recommended in production behind a proxy |
| `TRUST_PROXY` | `false` | env — set to `true` when behind an nginx/cloudflare/traefik proxy so rate limits track the real client IP |
| `GITHUB_WEBHOOK_SECRET` | unset → webhook disabled | env |

## 7. Documentation references

These docs assume the original repo URL (`github.com/meisterpilze/meistertracker`):

- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- `package.json` (`homepage`, `repository`, `bugs`)
- `.github/ISSUE_TEMPLATE/config.yml`

Forks should rewrite these links to point at their own repository — the
upstream issue tracker only handles upstream bugs.

## 8. Trademark

`Meistertracker`, `Meisterpilze`, and the Meisterpilze logo are
trademarks of Meisterpilze UG. The AGPL-3.0 licence covers the source
code only and does **not** grant rights to use these names or marks for
your fork. Please pick your own name (and your own logo via
`scripts/make_icons.py`) before publishing a fork.
