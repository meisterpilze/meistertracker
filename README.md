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

- **Node.js** v20+ — [nodejs.org](https://nodejs.org)
- **Git** — repo must be cloned (not just copied)

## Configuration

Create a `.env` file in the project root to override defaults:

```
PORT=3000
PRINTER_NAME=ZDesigner GK420d
```

## Server Management

```bash
bash update_server.sh            # Update code, back up data, restart
bash update_server.sh start      # Start (without pulling updates)
bash update_server.sh stop       # Stop the server
bash update_server.sh status     # Show PM2 process status
```

The script uses [PM2](https://pm2.keymetrics.io/) for process management and auto-restart.

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

## Data & Backups

All data is stored in `meistertracker.db` (SQLite) on the server (shared by all devices automatically). Changes sync every 5 seconds.

- **Auto-backup**: daily at midnight to `backups/` (keeps last 30 days)
- **Manual backup**: use the Backup tab in the app to export/import JSON
- **Remote backup**: `scp user@host:~/meistertracker/meistertracker.db ./backup.db`

## Raspberry Pi Deployment

For a dedicated always-on server (Pi 4/5 recommended):

1. Flash **Raspberry Pi OS Lite (64-bit)** with SSH enabled
2. Install Node.js:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
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

| Endpoint | Method | Description |
|---|---|---|
| `/api/data` | GET | Fetch all data |
| `/api/data` | POST | Save all data (with safety checks) |
| `/api/health` | GET | Health check (status, uptime, version) |
| `/api/print` | POST | Send ZPL to printer |
| `/api/printer-status` | GET | Check printer connection |
| `/api/caldav/sync` | POST | Sync all tasks to CalDAV |
| `/caldav/calendars/` | CalDAV | CalDAV endpoint for calendar clients |

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
