# 🧫 Meistertracker

[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![CI](https://github.com/loewenmaehne/meistertracker/actions/workflows/ci.yml/badge.svg)](https://github.com/loewenmaehne/meistertracker/actions/workflows/ci.yml)
[![Built at Meisterpilze](https://img.shields.io/badge/built%20at-meisterpilze.de-2ea44f.svg)](https://www.meisterpilze.de)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-339933.svg)](https://nodejs.org)

> **The lab management system behind [Meisterpilze](https://www.meisterpilze.de).**
> Barcode-driven scanning, batch / culture / harvest tracking, label printing, calendar sync — a single self-hosted Node.js process that runs a real specialty-mushroom production lab.

Meistertracker is the operational backbone of **[Meisterpilze](https://www.meisterpilze.de)**, an urban mushroom farm in Erlangen, Germany, growing shiitake, oyster, king oyster, lion's mane, and blue oyster mushrooms for restaurants, retail, and home growers. Every fruiting block, every culture transfer, and every harvest gram in the lab is tracked through this software — released under **AGPL-3.0-or-later** so other labs can run, modify, and self-host it freely.

## 🍄‍🟫 About

Meistertracker is developed and maintained at **[Meisterpilze UG](https://www.meisterpilze.de)** in Erlangen, Germany — an urban specialty-mushroom farm founded in June 2024 by **Dr. Jonas Hahn** (research, biologist) and **Luis Veloso** (production, chemist). In their own words: *„Eine Verbindung von Wissenschaft und Natur"* — a blend of science and nature in service of better food.

The software was built in-house because no off-the-shelf tool fit how a real specialty-mushroom lab actually works: barcode scanning over typing, lifecycle phases that match the fungal biology, and a label printer right at the workbench. It runs daily in our lab and is published under **AGPL-3.0-or-later** so other labs can build on it freely.

The software is provided **without warranty of any kind** and the authors accept no liability for damages arising from its use.

> **AGPL §13 reminder**: if you operate this software as a network service for users other than yourself, you must offer them the corresponding source code (including any modifications). The unmodified upstream is at <https://github.com/loewenmaehne/meistertracker> — linking back is usually enough to comply.

See [`LICENSE`](LICENSE) for the full terms.

## ✨ Features

### Core lab workflow

- **Barcode scanning** — ADD, MOVE, REMOVE, HARVEST actions via USB-keyboard scanner or phone camera
- **Batch management** — fruiting blocks and grain spawn bags with full lifecycle tracking
- **Culture library** — mother cultures, petri dishes, liquid cultures, grain-to-grain spawn with lineage tracing
- **Harvest logging** — per-bag weight tracking with flush numbers and yield analytics
- **Inventory ledger** — substrate stock, delivery logging, low-stock alerts, audit trail per change
- **Contamination reports** — photo upload + on-screen annotations, optional auto-MOVE to CONTAM zone, follow-up tasks
- **Asset register** — fixed-asset bookkeeping with depreciation, CSV export, printable labels
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

## 👥 Who is this for?

- **Specialty mushroom farms** with 5-50 fruiting tents who have outgrown spreadsheets
- **University and commercial fungal labs** that need traceable culture lineage, contamination logs, and audit trails
- **Mushroom growkit producers** doing per-bag QC and harvest analytics
- **Fungal R&D labs** experimenting with substrates, strain crosses, and yield optimisation

You probably do not need this if you are hobby-growing one or two bags at home — a notebook is fine. If you are tracking 100+ bags across multiple zones with multiple workers, label printers, and offline phone scanners, this is built for you.

## 🚀 Quick Start

```bash
git clone https://github.com/loewenmaehne/meistertracker.git
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

## 🏷️ Label Printing (Zebra GK420d)

The server sends ZPL directly to the printer via the Windows print spooler — no browser dialog needed.

1. Connect GK420d via USB and ensure it is powered on
2. Labels are 60x30mm, Code 128, optimised for 203dpi

On non-Windows systems, use the "Download ZPL" fallback to send labels manually.

## 🔐 Authorization

The app has two user roles: **worker** and **admin**.

**Workers can:**

- Create batches, harvests, scans, cultures, and calendar events
- Log lab work and inventory consumption from batch creation
- Create and complete their own tasks
- Modify/delete tasks they are assigned to, or tasks with no assignee

**Admins can:**

- Everything workers can
- Delete assets, calendar events, and suppliers
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
   git clone https://github.com/loewenmaehne/meistertracker.git
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

## 🔌 API

The full REST surface (40+ operations covering auth, scanning, batches, cultures, harvests, inventory, tasks, contamination reports, photos, assets, users, OAuth, MCP, CalDAV, DuckDNS, Let's Encrypt, backups, health, and webhook auto-deploy) is specified in [`openapi.yaml`](openapi.yaml).

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

## 🤝 Contributing

Issues and pull requests are welcome at <https://github.com/loewenmaehne/meistertracker/issues>. By submitting a contribution you agree that your code is licensed under the AGPL-3.0-or-later — the same terms as the rest of the project.

Local development:

```bash
git clone https://github.com/loewenmaehne/meistertracker.git
cd meistertracker
npm install
npm test            # ~211 unit tests
npm run lint        # eslint
npm run format      # prettier --write
```

The CI workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs lint, format check, and tests on every PR against `main`.

## 📜 License

Released under the [GNU Affero General Public License v3.0 or later](LICENSE).

Copyright © 2025–2026 Meisterpilze UG and contributors.

Vendored third-party libraries in `lib/` ship under their own permissive licenses (Chart.js — MIT, JsBarcode — MIT, html5-qrcode — Apache-2.0, qrcode-generator — MIT). See each minified file's banner for the full notice.
