# Meisterpilze Lab Tracker

Lab management system for mushroom cultivation — track batches, cultures, harvests, and inventory with a barcode-driven scanning workflow and label printing.

## Features

- **Barcode scanning workflow** — ADD, MOVE, REMOVE, HARVEST actions via scanner
- **Batch management** — fruiting blocks and grain spawn bags with lifecycle tracking
- **Culture library** — mother cultures, petri dishes, liquid cultures with lineage tracing
- **Harvest logging** — per-bag weight tracking with flush numbers and analytics
- **Inventory** — substrate stock levels, delivery logging, low-stock alerts
- **Label printing** — Code 128 barcodes and QR codes for Zebra GK420d (60x30mm)
- **Task management** — auto-generated batch tasks + manual tasks with team assignment
- **CalDAV calendar sync** — built-in CalDAV server for Apple Calendar, Thunderbird, DAVx5
- **PWA** — installable on phones/tablets with offline support
- **Dashboard** — KPIs, pipeline chart, harvest analytics, rack occupancy

## Quick Start

```bash
git clone https://github.com/loewenmaehne/meistertracker.git
cd meistertracker
bash update_server.sh
```

On Windows, double-click `START.bat` instead.

Open **http://localhost:3000** in your browser. For other devices on the same WiFi, use **http://\<your-ip\>:3000**.

### Prerequisites

- **Node.js** v22+ — [nodejs.org](https://nodejs.org)
- **Git** — repo must be cloned (not just copied)

> **Setting up a fresh Linux server?** See [DEPLOYMENT.md](DEPLOYMENT.md) for a step-by-step guide covering Node install, PM2, TLS, DuckDNS + Let's Encrypt, and security hardening.

## Configuration

Create a `.env` file in the project root to override defaults:

```
PORT=3000
PRINTER_NAME=ZDesigner GK420d
```

## Server Management

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

## Scanning Workflow

1. Print the **Reference Barcodes** page (Print tab) and hang it at your station
2. Scan **ADD** → scan a **location** (INC, TENT1, etc.) → scan **bag barcodes**
3. Scan **MOVE** → scan **FROM** → scan **TO** → scan bags
4. Scan **REMOVE** → scan bags
5. Scan **HARVEST** → scan a bag → enter weight

The scan bar works on every tab. Scanners must be in USB Keyboard mode.

## Label Printing (Zebra GK420d)

The server sends ZPL directly to the printer via the Windows print spooler — no browser dialog needed.

1. Connect GK420d via USB and ensure it is powered on
2. Labels are 60x30mm, Code 128, optimised for 203dpi

On non-Windows systems, use the "Download ZPL" fallback to send labels manually.

## Authorization

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

## Data & Backups

All data is stored in `meistertracker.db` (SQLite) on the server (shared by all devices automatically). Changes sync every 5 seconds.

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

## Raspberry Pi Deployment

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

## API

| Endpoint              | Method | Description                            |
| --------------------- | ------ | -------------------------------------- |
| `/api/data`           | GET    | Fetch all data                         |
| `/api/data`           | POST   | Save all data (with safety checks)     |
| `/api/health`         | GET    | Health check (status, uptime, version) |
| `/api/print`          | POST   | Send ZPL to printer                    |
| `/api/printer-status` | GET    | Check printer connection               |
| `/api/caldav/sync`    | POST   | Sync all tasks to CalDAV               |
| `/caldav/calendars/`  | CalDAV | CalDAV endpoint for calendar clients   |

## Project Structure

```
server.js         Node.js HTTP server + CalDAV + printer integration
index.html        SPA shell (HTML only)
app.js            Frontend application logic
styles.css        Stylesheet
sw.js             Service worker for offline/PWA support
manifest.json     PWA manifest
lib/              Third-party libraries (JsBarcode, QRCode, Chart.js)
update_server.sh  Setup, update, and management script
START.bat         Windows launcher
```
