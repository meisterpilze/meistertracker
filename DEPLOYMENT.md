# Meisterpilze Lab Tracker — Deployment Guide

## Prerequisites

- **Node.js** (v20+) — [nodejs.org](https://nodejs.org)
- **Git** — repo must be cloned (not just copied)

## Quick Start (any platform)

```bash
# Clone the repo
git clone https://github.com/loewenmaehne/meistertracker.git
cd meistertracker

# Run the setup/update/start script
bash update_server.sh
```

On Windows, double-click `START.bat` instead.

The script will:
1. Check for Node.js
2. Install PM2 (process manager) if not already present
3. Pull latest code from GitHub
4. Back up `data.json`
5. Start or restart the server via PM2

Once running, open **http://localhost:3000** in your browser.
For other devices on the same network, use **http://\<your-ip\>:3000**.

## Server Management

`update_server.sh` supports the following commands:

```bash
bash update_server.sh            # Update code from GitHub, back up data, restart server
bash update_server.sh start      # Start the server (without pulling updates)
bash update_server.sh stop       # Stop the server
bash update_server.sh status     # Show PM2 process status
bash update_server.sh help       # Show usage info
```

## Updating

Run the script without arguments:

```bash
bash update_server.sh
```

It pulls the latest code and restarts the server. Data in `data.json` is backed up automatically before each update.

## Useful PM2 Commands

```bash
pm2 logs meisterpilze     # show live logs
```

## Raspberry Pi — First-Time Setup

For a dedicated always-on server (Pi 4 or 5 recommended):

### 1. Flash the SD card

- Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
- Choose **Raspberry Pi OS Lite (64-bit)**
- In settings: enable SSH, set username `pi`, set hostname `meisterpilze`, configure WiFi

### 2. SSH in and install Node.js

```bash
ssh pi@meisterpilze.local

sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 3. Clone and run

```bash
git clone https://github.com/loewenmaehne/meistertracker.git
cd meistertracker
bash update_server.sh
```

### 4. Enable autostart on boot

```bash
pm2 startup systemd
# Run the command it prints, then:
pm2 save
```

The server now starts automatically after every reboot or power outage.

### 5. Static IP (recommended)

Assign a fixed IP to the Pi in your router's DHCP settings so the address never changes. Then bookmark `http://<pi-ip>:3000` on all devices.

## Backing Up Data

Data lives in `data.json`. The update script backs it up automatically to `backups/`.

Manual backup from another machine:
```bash
scp pi@meisterpilze.local:~/meistertracker/data.json ./backup_data.json
```

Or use the Backup tab in the app to export directly from the browser.

## Label Printing (GK420d)

The app supports direct printing to a Zebra GK420d via Zebra Browser Print.

1. Install [Zebra Browser Print](https://www.zebra.com/us/en/support-downloads/printer-software/browser-print.html)
2. Connect GK420d via USB
3. In the app, go to Print Labels — it shows "Connected: GK420d" when ready

Labels are 60×30mm, Code 128 barcode, optimised for 203dpi.
