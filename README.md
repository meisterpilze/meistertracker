# 🔬 Meistertracker

[![Website](https://img.shields.io/badge/web-meistertracker.com-2ea44f.svg)](https://meistertracker.com)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![CI](https://github.com/meisterpilze/meistertracker/actions/workflows/ci.yml/badge.svg)](https://github.com/meisterpilze/meistertracker/actions/workflows/ci.yml)
[![Built at Meisterpilze](https://img.shields.io/badge/built%20at-meisterpilze.de-2ea44f.svg)](https://www.meisterpilze.de)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-339933.svg)](https://nodejs.org)

**Meistertracker is a self-hosted lab management system for mushroom cultivation.** Workers walk the lab with phones or tablets, scan barcodes on bags and cultures with the device camera, and the software tracks every fruiting block from inoculation to harvest — across the four phases of the cultivation cycle (spawn run → incubation → fruiting → contamination triage).

Print barcode and QR labels at the workbench, file contamination reports with photos, weigh harvests against KPI dashboards, manage cultures and inventory, and sync tasks and due dates to any CalDAV calendar (Apple Calendar, Google Calendar, Thunderbird, DAVx5). Multi-user with role-based access (worker / admin), MCP integration for Claude Desktop and other LLM clients, offline-capable as a PWA. One Node.js process, SQLite database, no cloud dependencies — runs on **Windows, macOS, or Linux** (including a Raspberry Pi).

Meistertracker is the operational backbone of **[Meisterpilze](https://www.meisterpilze.de)**, an urban mushroom farm in Erlangen, Germany, growing shiitake, oyster, king oyster, lion's mane, and blue oyster mushrooms for restaurants, retail, and home growers. Every fruiting block, every culture transfer, and every harvest gram in the lab is tracked through this software — released under **AGPL-3.0-or-later** so other labs can run, modify, and self-host it freely.

## 🍄‍🟫 About

Meistertracker is developed and maintained at **[Meisterpilze UG](https://www.meisterpilze.de)** in Erlangen, Germany — an urban specialty-mushroom farm founded in June 2024 by **Dr. Jonas Hahn** (research, biologist) and **Luis Veloso** (production, chemist). In their own words: *„Eine Verbindung von Wissenschaft und Natur"* — a blend of science and nature in service of better food.

The software was built in-house because no off-the-shelf tool fit how a real mushroom lab actually works: barcode scanning over typing, lifecycle phases that match the fungal biology, and a label printer right at the workbench. It runs daily in our lab and is published under **AGPL-3.0-or-later** so other labs can build on it freely.

The software is provided **without warranty of any kind** and the authors accept no liability for damages arising from its use.

> **AGPL §13 reminder**: if you operate this software as a network service for users other than yourself, you must offer them the corresponding source code (including any modifications). The unmodified upstream is at <https://github.com/meisterpilze/meistertracker> — linking back is usually enough to comply.

See [`LICENSE`](LICENSE) for the full terms.

**Legal notice:** the [meistertracker.com](https://meistertracker.com) domain that redirects to this repository is operated privately by Julian Zienert (Netherlands). See its [imprint & privacy notice](https://meistertracker.com/legal) for how visits to the domain and emails to `@meistertracker.com` addresses are handled.

## ✨ Features

### Core lab workflow

- **Barcode scanning** — ADD, MOVE, REMOVE, HARVEST actions via USB-keyboard scanner or phone camera
- **Batch management** — fruiting blocks and grain spawn bags with full lifecycle tracking
- **Culture library** — mother cultures, petri dishes, liquid cultures, grain-to-grain spawn with lineage tracing
- **Harvest logging** — per-bag weight tracking with flush numbers and yield analytics
- **Inventory ledger** — substrate stock, delivery logging, low-stock alerts, audit trail per change
- **Contamination reports** — photo upload + on-screen annotations, optional auto-MOVE to CONTAM zone, follow-up tasks
- **Task management** — auto-generated batch tasks plus manual tasks with team assignment
- **CalDAV calendar sync** — built-in CalDAV server consumed by Apple Calendar, Thunderbird, DAVx5
- **Dashboard** — KPIs, production pipeline chart, harvest analytics, rack occupancy, contamination rate
- **Label printing** — Code 128 + QR labels for Zebra GK420d (50×30 mm, 203 dpi)
- **PWA** — installable on phones / tablets, offline scan queue replays on reconnect
- **Multi-language UI** — German, English, Portuguese

### Optional modules

- **MCP integration** — expose batches, cultures, scans, harvests, and maintenance to Claude Desktop via the Model Context Protocol with OAuth + PKCE
- **Camera AI** *(in active development)* ([`mushroom_camera/`](mushroom_camera/)) — Python sidecar for RTSP-based fruiting and incubation monitoring, writing hourly snapshots back to the same SQLite database
- **Print bridge** — HTTPS-secured Windows service that forwards label prints from a Linux server to a USB-attached Zebra GK420d
- **DuckDNS + Let's Encrypt** — built-in dynamic DNS and automatic free TLS for self-hosted public access (no Nginx required)
- **Harvest feed** — signed, outbound-only push of what you harvested and what is coming, to a URL you choose, so a shop or listing page can answer "what's available today?" without the lab machine being reachable

## 👥 Who is this for?

- **Specialty mushroom farms** with 5-50 fruiting tents who have outgrown spreadsheets
- **University and commercial fungal labs** that need traceable culture lineage, contamination logs, and audit trails
- **Mushroom growkit producers** doing per-bag QC and harvest analytics
- **Fungal R&D labs** experimenting with substrates, strain crosses, and yield optimisation

You probably do not need this if you are hobby-growing one or two bags at home — a notebook is fine. If you are tracking 100+ bags across multiple zones with multiple workers, label printers, and offline phone scanners, this is built for you.

## 🚀 Quick Start

```bash
git clone https://github.com/meisterpilze/meistertracker.git
cd meistertracker
bash update_server.sh
```

On Windows, double-click `START.bat` instead.

Open **https://localhost:3000** in your browser. The server upgrades plain HTTP automatically and (best-effort) binds port 80 for the redirect. For other devices on the same WiFi, use **https://\<your-ip\>:3000** and accept the self-signed certificate warning on first connect.

### Prerequisites

- **Node.js** v22+ — [nodejs.org](https://nodejs.org)
- **Git** — repo must be cloned (not just copied)

> **Setting up a fresh Linux server?** See [DEPLOYMENT.md](DEPLOYMENT.md) for a step-by-step guide covering Node install, PM2, TLS, DuckDNS + Let's Encrypt, and security hardening.

## ⚙️ Configuration

Create a `.env` file in the project root to override defaults:

```
PORT=3000
PRINTER_NAME=ZDesigner GK420d
```

## 🖥️ Server Management

### Linux / macOS

```bash
bash update_server.sh            # Update code, back up data, restart
bash update_server.sh start      # Start (without pulling updates)
bash update_server.sh stop       # Stop the server
bash update_server.sh status     # Show PM2 process status
```

Both scripts use [PM2](https://pm2.keymetrics.io/) for process management and auto-restart, so commands like `pm2 logs meisterpilze`, `pm2 monit`, and `pm2 list` work identically on either platform.

### Windows

`START.bat` does the same job as `update_server.sh`: it pulls the latest code, installs deps, backs up the DB (using `sqlite3 .backup` if available, otherwise a file copy), generates a TLS cert if missing, and (re-)starts the PM2 process. Double-click it or run it from a terminal.

### Auto-start on boot

**Linux** — `pm2 startup systemd` generates a systemd unit, then `pm2 save` freezes the current process list:
```bash
pm2 startup
# copy and run the printed `sudo env PATH=...` line
pm2 save
```

**Windows** — two equally valid options:

1. **Startup folder shortcut** (per-user, runs at logon)
   - `Win + R` → `shell:startup` → Enter
   - Right-click in the folder → New → Shortcut → point at `C:\path\to\meistertracker\START.bat`
   - Optional: in the shortcut Properties, set "Run" to **Minimized** so the console window doesn't pop into focus.

2. **Task Scheduler** (more robust — works even without an interactive logon)
   - Open Task Scheduler → Create Basic Task
   - Trigger: At log on (or At startup, if you want it before login)
   - Action: Start a program
     - Program: `C:\path\to\meistertracker\START.bat`
     - "Start in": `C:\path\to\meistertracker`
   - Optional: in the task's Settings tab, enable "Run task as soon as possible after a scheduled start is missed".

After either setup, PM2 needs to know the process list to restore. Run once after starting the server normally:
```cmd
pm2 save
```
PM2 then writes `%USERPROFILE%\.pm2\dump.pm2` and `START.bat` reads it on the next launch to restore the meisterpilze process.

## 📷 Scanning Workflow

1. Print the **Reference Barcodes** page (Print tab) and hang it at your station
2. Scan **ADD** → scan a **location** (INC, TENT1, etc.) → scan **bag barcodes**
3. Scan **MOVE** → scan **FROM** → scan **TO** → scan bags
4. Scan **REMOVE** → scan bags
5. Scan **HARVEST** → scan a bag → enter weight

The scan bar works on every tab. Scanners must be in USB Keyboard mode.

## 📍 Where things are — zones, racks, and the scan that records it

Locations are two levels deep. A **zone** is a room or a tent (`SPAWN`, `INC`, `TENT1…3`, `CONTAM` out of the box, renameable in Settings → Zones). A **rack** belongs to a zone and is whatever shelving unit you can point at and name. Both get a numeric barcode automatically, from the same registry that numbers bags and cultures — you never invent a code by hand.

**Scan the rack, not the zone.** A zone answers "which tent", which is rarely the question you have at 7 a.m. with a crate in your arms. The app nudges you: scan a zone that has racks under it and the feedback turns amber and names one of its racks as an example. Zone-level scans still work — for a tent you deliberately do not shelf-sort, that is the right granularity.

### The labels you need already print themselves

Print tab → **Reference barcodes** renders every action, zone and rack as Code 128 or QR (one toggle) on ordinary paper:

- Hang the **action** codes (ADD, MOVE, MOVE_BATCH, REMOVE, HARVEST, CONTAM) at each station.
- Cut out the **rack** codes and tape one to each rack end, at the height a hand passes.
- Bag and culture labels come off the Zebra when the batch is created; they are the other half of every scan.

That is the whole hardware requirement for location tracking: paper, tape, and a printer you already own.

### The truth is in the database, and a human puts it there

There is no automatic localization in Meistertracker, and that is a deliberate limit rather than a missing feature. A block's position changes when someone picks it up, so the moment of handling is the only moment at which anything reliable is known — and it is already the moment a hand is on the block. Radio and camera approaches were evaluated for this lab and do not survive the conditions: dense metal racking puts neighbouring racks inside each other's read range, the fruiting rooms run at ~90 % humidity with active fogging, and blocks behind other blocks are invisible to any fixed lens. Commercial systems in this industry that do track single units track them the same way this one does — a scan on contact, against a location hierarchy.

The practical consequence is worth stating plainly: **a move nobody scans did not happen**, as far as every dashboard, rack-occupancy chart and MCP answer is concerned. And for multi-row racks, blocks reachable only by moving other blocks are realistically tracked *per rack*, not per slot.

### Making the scan cheap enough that it always happens

The scan bar is a plain text field with focus, so anything that types is a scanner. That leaves three options, in ascending order of how well they survive a real shift:

| | Good for | Costs you |
|---|---|---|
| **Phone/tablet camera** | starting today, occasional corrections | a free hand, decent light, and a second or two of aiming per code |
| **Corded USB scanner** | a fixed station — packing bench, harvest scale | tethers the workflow to one spot |
| **Wearable ring / back-of-hand scanner** (Bluetooth HID) | walking the racks, both hands full | a few hundred euros, once |

The wearable is the one that changes the day. It pairs to the phone or tablet as a keyboard, needs no app and no integration work, and reads the same paper labels you already printed — the block code and the rack code, one trigger each, without putting the crate down. When location data drifts in a lab, the cause is almost never that the software could not represent the position; it is that recording it cost more attention than the worker had free.

Where paper labels genuinely stop working — soaked, fogged over, or scuffed past reading in the fruiting rooms — NFC tags on the racks are the next step up, because a tap tolerates wet and dark. Reach for that only once you have watched paper fail, not before.

## 🏷️ Label Printing (Zebra ZPL · 50×30 mm · 203 dpi)

The server sends ZPL directly to the printer via the Windows print spooler — no browser dialog needed.

1. Connect a ZPL-compatible Zebra (GK420d, ZD420, ZD230, …) via USB and ensure it is powered on
2. Labels are **50 × 30 mm**, Code 128 / QR, designed for **203 dpi** (`^PW400 ^LL240`)

On non-Windows systems, use the "Download ZPL" fallback to send labels manually.

> **Compatibility:** the layout is tuned for ZPL II at 203 dpi with 50×30 mm landscape labels. Different Zebras at the same dpi/label size work as-is; different label sizes, 300 dpi printers, or non-ZPL printers (Brother QL, Dymo LabelWriter, …) need either a layout refactor or a new print backend. See [FORKING.md §2](FORKING.md#2-hardware-assumptions) for the full breakdown.

## 🔐 Authorization

The app has two user roles: **worker** and **admin**.

**Workers can:**

- Create batches, harvests, scans, cultures, and calendar events
- Log lab work and inventory consumption from batch creation
- Create and complete their own tasks
- Modify/delete tasks they are assigned to, or tasks with no assignee

**Admins can:**

- Everything workers can
- Delete calendar events and suppliers
- Manage users (create/delete/reset password)
- Adjust inventory manually (thresholds, composition config)
- Manage zones, racks, OAuth clients, CalDAV config
- Download/restore the encrypted database backup

Tasks belong to the people listed in their `assignee` field. An unassigned task (empty assignee) is considered "for everyone" and any authenticated worker may modify or delete it.

## 💾 Data & Backups

All data is stored in `meistertracker.db` (SQLite) on the server (shared by all devices automatically). Connected clients receive changes in near-real-time via Server-Sent Events; offline scans queue inside the service worker and replay automatically on reconnect.

- **Auto-backup**: daily at midnight to `backups/` (keeps last 30 days). Uses SQLite `VACUUM INTO` so the backup is WAL-consistent even while the server is writing. Each run writes `backups/.backup-status.json` with success/failure and size, and the latest file is verified to have a valid SQLite header before the status is marked successful.
- **Manual backup**: use the Backup tab in the app to export/import an encrypted archive (requires admin).
- **Remote backup**: `scp user@host:~/meistertracker/meistertracker.db ./backup.db`
- **Off-machine** (REQUIRED on production): set up an `rsync`-over-SSH cron that touches `backups/.offsite-sync.json` on each successful run — the marker is read by `/api/health` and `scripts/check-backup-health.js`. See **DEPLOYMENT.md → Off-site backups (REQUIRED)** for the canonical setup. As a Windows-only convenience, placing the project folder under a cloud-synced directory (OneDrive, Dropbox, iCloud Drive, etc.) cloud-syncs `backups/` automatically.

### Monitoring backup health

Two commands check that the daily backup is actually running and producing valid output:

```bash
# Quick health check — exits 0 if OK, 1 if stale / missing / corrupt
node scripts/check-backup-health.js

# Full end-to-end verification — takes a fresh backup into a scratch dir,
# re-opens it, compares row counts, runs PRAGMA integrity_check, then deletes.
node scripts/verify-backup.js
```

The authenticated `/api/health` endpoint also includes a `backup` section with `status`, `ageHours`, and the last success / failure / attempt timestamps so any uptime monitor can watch it.

### Restoring from a backup

1. **Stop the server** so nothing writes to the DB during the swap:
   ```bash
   bash update_server.sh stop       # Linux / macOS
   # Windows: close the START.bat window
   ```
2. **Pick the backup** you want to restore. Files are in `backups/meisterpilze_backup_YYYY-MM-DD.db`. Pick the most recent one that predates the corruption or data loss.
3. **Move the current DB aside** (keep it — do not delete):
   ```bash
   mv meistertracker.db meistertracker.db.broken
   rm -f meistertracker.db-wal meistertracker.db-shm
   ```
4. **Copy the backup into place**:
   ```bash
   cp backups/meisterpilze_backup_YYYY-MM-DD.db meistertracker.db
   ```
5. **Start the server** and log in to confirm data is present:
   ```bash
   bash update_server.sh start      # Linux / macOS
   # Windows: double-click START.bat
   ```
6. **Verify the restore** by opening the app and checking recent batches, harvests, and users. If anything is missing, stop the server and repeat step 3 onwards with an older backup.
7. Once you have confirmed the restore is good, you can delete `meistertracker.db.broken`.

For encrypted restores initiated from the admin UI, use **Settings → Backup → Restore** and provide the password that was used when the backup was downloaded.

> For full deployment context (off-site backups, WAL-only recovery, manual file swap on a server with no UI access), see **DEPLOYMENT.md → Restoring from a backup** and **→ Off-site backups (REQUIRED)**.

## 🥧 Raspberry Pi Deployment

For a dedicated always-on server (Pi 4/5 recommended):

1. Flash **Raspberry Pi OS Lite (64-bit)** with SSH enabled
2. Install Node.js:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
3. Clone and start:
   ```bash
   git clone https://github.com/meisterpilze/meistertracker.git
   cd meistertracker && bash update_server.sh
   ```
4. Enable autostart:
   ```bash
   pm2 startup systemd   # run the command it prints
   pm2 save
   ```
5. Assign a static IP in your router's DHCP settings

## 🧩 Optional Modules

The Core features above are everything you need to run a lab. The three pieces below are entirely optional — none of them is required for the main app to work, and any combination of them can be enabled per deployment.

### MCP integration (Claude Desktop)

[`mcp-server.js`](mcp-server.js) exposes the lab state as a Model Context Protocol tool surface so an LLM client (Claude Desktop, Claude Code, …) can read and mutate batches, cultures, scans, harvests, inventory, tasks, contamination reports, zones, racks, and maintenance schedules.

- **Transport** — HTTPS, OAuth 2.0 with PKCE; clients register dynamically per RFC 7591.
- **Auth** — every tool call carries the OAuth-derived user identity; admin-only operations are gated server-side.
- **Setup** — open `Settings → MCP` in the admin UI and paste the connection URL into your MCP client. A legacy static-token transport remains available for headless integrations under the same tab.

For the full tool list see [`mcp-server.js`](mcp-server.js); the OAuth flow is documented in [`openapi.yaml`](openapi.yaml).

### Camera AI module — `mushroom_camera/` *(in active development)*

A Python sidecar that watches RTSP cameras placed in the fruiting tents and incubation room and writes hourly snapshots back to the same SQLite database. The main Node.js app reads those tables to surface a live camera dashboard at `Settings → Camera`. The detection pipeline is still being trained on real lab data — current results should be treated as experimental.

```bash
cd mushroom_camera
pip install -r requirements.txt
export CAM1_RTSP="rtsp://user:pass@camera.lan/stream1"
python -m mushroom_camera        # APScheduler daemon — runs every hour
python -m mushroom_camera --now  # one-shot cycle (good for cron)
```

The sidecar is independent: the main app keeps working fine if `mushroom_camera/` is never started — the Camera tab simply reports "no measurements yet". Tuning thresholds live in [`mushroom_camera/config.py`](mushroom_camera/config.py); see **DEPLOYMENT.md** for deploying it as a systemd service alongside the main process.

### Print bridge (Windows)

If your Linux server can't talk to the Zebra directly (very common when the printer is in a different room from the server), run [`scripts/print-bridge.ps1`](scripts/print-bridge.ps1) on a Windows PC that has the GK420d attached via USB. The Linux server forwards `/api/print` and `/api/printer-status` calls to the bridge over HTTPS with token authentication, so labels go straight to the printer with live status feedback.

```powershell
# On the Windows PC — one-time setup (auto-elevates via UAC):
powershell -ExecutionPolicy Bypass -File print-bridge.ps1 -Install -Token "long-random-string"
```

The installer handles TLS certificate, URL ACL, inbound firewall rule, scheduled task, and immediate start in one step. Then enter the URL + token in the admin UI under `Settings → Drucker`. Without a print bridge configured, the app falls back to a "Download ZPL" workflow — no driver setup needed but one extra click per print.

Full setup walkthrough plus troubleshooting in **DEPLOYMENT.md → Section 10**.

### Harvest feed (outbound)

[`harvest-feed.js`](harvest-feed.js) posts a small, signed summary of your harvest situation to a URL you configure. The problem it solves: the numbers already live in this database, but the systems that need them — your own website, a CSA or box scheme, a co-op listing, a chat bot answering *"what do you have today?"* — live elsewhere. Copying them by hand goes stale within a day, and pointing those systems at the lab machine means exposing it to the internet.

**This machine opens the connection; nothing can reach it unbidden.** No inbound endpoint is added, no port needs opening, and a changing home IP does not matter. If the lab machine is off, the receiver keeps the last payload — its consumers see older numbers rather than an outage.

What the receiver *can* do is answer. The reply to that POST may carry pickups back (see **Pickups** below), which means data from the far end does reach this database — over a socket this side opened and is still holding, but reaching it all the same. That makes the reply body a trust boundary, and it is treated as one.

```json
{
  "version": 1,
  "generatedAt": "2026-07-30T16:00:00.000Z",
  "freshDays": 3,
  "harvested": [{ "species": "Oyster", "strain": "Blue", "grams": 4700, "lastHarvest": "2026-07-30T07:30:00" }],
  "planned": [{ "species": "Lion's Mane", "strain": "LM1", "expectedFrom": "2026-08-05" }]
}
```

Species, strain, gram totals and dates. **No batch ids, no bag ids, no customers, no scan history, no notes** — a summary is far easier to reason about than a dump, and everything that leaves is something you have to reason about.

Two things it deliberately does not do:

- **It does not estimate yields.** Planned entries carry a species and a date, never an amount. How much a block gives varies too much between flushes, and a number that reaches a customer becomes a promise. Recorded harvests are measured, so those do carry grams.
- **It does not subtract reservations.** If half of Thursday's harvest is already promised to a restaurant, publish the remainder — but what counts as promised differs per lab and is not tracked here. Do that subtraction in the receiving system, where the commitments live, or use release mode below, which asks the question the other way round.

#### Release mode: what may be sold, not what was harvested

`harvested` is a production fact, and it only ever grows. That makes it the wrong number for a shop the moment you sell anything anywhere else: three kilos over the counter on Saturday, and the feed still reports Friday's harvest until it ages out of the window. Recording every sale would fix the arithmetic and will not happen — a market stand takes cash, not keystrokes.

Release mode publishes a **set-aside** instead. In *Settings → Harvest feed → Released for sale* you enter, per species, how much a shop may sell and until when. Put that amount in its own crate and sell everything else from the rest, and no walk-in customer can make the published figure wrong — there is nothing to keep up to date. The payload then calls itself version 2 and carries a second list:

```json
{
  "version": 2,
  "harvested": [{ "species": "Oyster", "grams": 6200 }],
  "released": [{ "species": "Oyster", "grams": 2000, "validUntil": "2026-08-02" }]
}
```

The version bump is the point: a receiver that publishes `harvested` and ignores `released` would offer produce you deliberately kept back. That is a change of meaning, not a new optional field, so a receiver built for version 1 is expected to reject it rather than guess. Labs that leave release mode off keep sending version 1 and their receivers notice nothing.

`validUntil` is optional and worth setting. Fresh produce does not keep, and the realistic mistake is not a wrong number but a forgotten one — last week's release quietly selling mushrooms that were eaten days ago. An expired release counts as zero here; a receiver holding an old payload should apply the same rule at serving time, since the lab machine may simply be switched off.

A release outlives its harvest window on purpose. Set two kilos aside on Monday for Saturday's market and by Thursday the harvest has dropped out of `freshDays` while the crate is still standing there. The person who put it there is the better source than the window arithmetic.

#### Pickups: what the receiver may report back

The receiver is the side that took the booking, so it is the side that knows when a customer said they would collect. It reports that in the reply to a push this end already makes — no open port, no certificate, no route into the lab:

```json
{
  "ok": true,
  "pickups": [
    {
      "id": "p_2026-08-15-0900_1042",
      "order": "#1042",
      "slot": "2026-08-15-0900",
      "slotText": "Sa 15.08., 9–10 Uhr",
      "place": "Marktstand",
      "from": "2026-08-15T09:00",
      "to": "2026-08-15T10:00",
      "zone": "Europe/Berlin",
      "items": [{ "kind": "Austernpilz", "grams": 2000 }],
      "overbooked": false
    }
  ]
}
```

`id` is yours to assign and is the only required field. It is the primary key here, so **repeat every open pickup in every reply until it is confirmed** — storing the same one twice leaves one row. That is the delivery guarantee, and it is the only one either side gets.

#### Withdrawing one again

A customer cancels after the pickup was already stored here. You cannot reach in and delete it — there is no route to the lab machine, which is the whole point — so name the id in the same reply:

```json
{ "ok": true, "pickupsCancelled": ["p_2026-08-15-0900_1042"] }
```

A plain list of ids, present only when there are any. The pickup is removed here, and the withdrawal is then confirmed through the same `pickupsDone` list a booking uses — so **repeat a withdrawal in every reply until you see its id come back**, exactly as with a booking.

Send it whether or not you think the booking arrived. An id this end never held costs nothing: it removes nothing, is not an error, and is still confirmed so you can stop repeating it. That is deliberate, because you cannot tell whether your earlier reply got through.

Two orderings are fixed, so you can rely on them: if one reply names the same id in both lists, the **withdrawal wins**; and a booking in a *later* reply **reopens** an id that was withdrawn earlier, because the newest statement about an id is the one that holds.

#### Confirmation

Both kinds come back on the next push, in a field that appears only when there is something to confirm:

```json
{ "version": 1, "generatedAt": "…", "harvested": [], "planned": [], "pickupsDone": ["p_2026-08-15-0900_1042"] }
```

An id in `pickupsDone` has been stored — or removed — here durably, and only a push that actually succeeded sets that flag, so a lost request costs a repeat and never a pickup. Once you see an id there you can stop sending it. If you keep sending it, it stays confirmed on every round; nothing breaks, it is just noise.

`from` and `to` are **local wall-clock at the pickup place** — no offset, no `Z` — which is why `zone` travels beside them. Meistertracker stores and displays them exactly as they arrive and never converts them; a value carrying its own offset is rejected rather than reinterpreted. "9–10" is what the customer was told, and it should still say that on a screen in another timezone.

Everything else is optional and bounded. The reply body must be `application/json` and at most 64 KB, at most 200 pickups and 200 withdrawals, at most 50 items per pickup; strings are truncated; unknown fields are dropped; a pickup or withdrawal without a usable `id` is discarded. The two lists are read independently, so a garbled `pickupsCancelled` never costs you the bookings beside it, or the other way round. A reply that is malformed, oversized or not JSON at all is logged and ignored — **it never turns a delivered push into a failed one**. The numbers are out; the reply is a second, separate question.

They appear under **Pickups** in the sidebar and at `GET /api/pickups`. The list is read-only: the receiver owns it, and an edit here would be overwritten by the next reply that repeats the same id.

Every request is signed: `X-Meistertracker-Signature: sha256=<HMAC-SHA256 of "<timestamp>.<body>">` plus `X-Meistertracker-Timestamp`. Signing the timestamp together with the body is what makes a captured request useless later — reject anything outside your tolerance window and it cannot be replayed. The secret is not optional; the feed refuses to start without one, because a forged *"we have 40 kg"* is worse than no feed at all.

**Set it up in Settings → Harvest feed.** Receiver URL, a generated secret, how often, and how long a harvest counts as fresh. Two buttons that matter: *Show what would be sent* builds the payload and displays it without sending — the answer to "is this going to leak something?" is to look at it, not to trust the description above. *Send one now* delivers it and reports what came back, which is the difference between saved and working. The last outcome stays on the screen, so a feed that quietly stopped delivering is visible instead of silent.

The same knobs exist as environment variables (`HARVEST_WEBHOOK_URL`, `HARVEST_WEBHOOK_SECRET`, …) for installs that bake configuration into an image — see **DEPLOYMENT.md → Section 15**. The stored settings win when enabled; environment variables apply otherwise, and Settings says which of the two is in charge. Off is the default, and an upgrade never starts sending on its own.

```bash
node harvest-feed.js --dry-run   # print exactly what would be posted, post nothing
node harvest-feed.js --once      # build, sign, POST, report the result
```

## 🔌 API

The full REST surface (40+ operations covering auth, scanning, batches, cultures, harvests, inventory, tasks, contamination reports, photos, users, OAuth, MCP, CalDAV, DuckDNS, Let's Encrypt, backups, health, and webhook auto-deploy) is specified in [`openapi.yaml`](openapi.yaml).

Notable surfaces worth knowing about:

| Path                   | Description                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| `GET /api/health`      | Public liveness + uptime                                         |
| `GET /api/health/full` | Admin-only ops view (disk, printer, DuckDNS, LE expiry, backup …) |
| `POST /api/data`       | Full-state save (admin) — used by the SPA                        |
| `POST /api/print`      | Send ZPL to printer (or print bridge)                            |
| `/caldav/calendars/`   | CalDAV endpoint for Apple Calendar / Thunderbird / DAVx5         |
| `/oauth/authorize`     | OAuth 2.0 with PKCE for MCP clients                              |
| `/mcp`                 | Model Context Protocol transport                                 |

## 📁 Project Structure

```
server.js              HTTP+HTTPS server, CalDAV, OAuth, printer integration
db.js                  SQLite schema, migrations, queries, sessions, KPI snapshots
mcp-server.js          Model Context Protocol tool surface
harvest-feed.js        Outbound-only signed harvest summary (optional)
index.html             SPA shell
app.js                 Frontend application logic
styles.css             Stylesheet
sw.js                  Service worker (PWA, offline scan queue)
manifest.json          PWA manifest
login.html, login.js   Login + first-admin setup page
openapi.yaml           REST API specification

lang/                  Language packs (de, en, pt)
lib/                   Vendored libraries (Chart.js, JsBarcode, html5-qrcode, qrcode)
mushroom_camera/       Optional Python AI camera module — see DEPLOYMENT.md
scripts/               Utilities: backup health, photo capture, print bridge, i18n audits
test/                  Test suite (db, mcp-server, backup, perf, photo-cap)

update_server.sh       Linux / macOS setup, update, and process management
START.bat              Windows launcher (mirrors update_server.sh)
gen-cert.sh, .ps1      Self-signed TLS certificate generators
Dockerfile             Containerized deployment
```

## 🍴 Running it for your own lab?

Meistertracker was built for one specific operator and a few rough edges still reflect that — a fixed inventory schema, a CalDAV slug baked in for compatibility, and a print pipeline tuned for Zebra ZPL at 203 dpi with 50×30 mm labels. Most of these are configurable via env vars; some need a small fork. Read [FORKING.md](FORKING.md) for the full inventory of what's tuned to Meisterpilze vs. what's generic, and the env-var matrix for the configurable bits.

## 🤝 Contributing

Issues and pull requests are welcome at <https://github.com/meisterpilze/meistertracker/issues>. By submitting a contribution you agree that your code is licensed under the AGPL-3.0-or-later — the same terms as the rest of the project.

Local development:

```bash
git clone https://github.com/meisterpilze/meistertracker.git
cd meistertracker
npm install
npm test            # ~211 unit tests
npm run lint        # eslint
npm run format      # prettier --write
```

The CI workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs lint, format check, and tests on every PR against `main`.

## 📜 License

Released under the [GNU Affero General Public License v3.0 or later](LICENSE).

Copyright © 2026 Meisterpilze UG and contributors.

Vendored third-party libraries in `lib/` ship under their own permissive licenses (Chart.js — MIT, JsBarcode — MIT, html5-qrcode — Apache-2.0, qrcode-generator — MIT). See [NOTICE](NOTICE) for full attribution and license texts.
