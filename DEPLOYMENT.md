# MeisterTracker Deployment Guide

This guide walks through setting up MeisterTracker on a fresh Debian server. It has been verified end-to-end on Debian Trixie.

> **TL;DR:** SSH-clone the repo, install Node 22 + PM2, generate a self-signed cert, start. Optionally configure DuckDNS + Let's Encrypt via the admin UI for a real cert and public access.

## 1. System Requirements & Dependencies

Run the following commands as `root` or with `sudo`.

### Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### Install Core Dependencies
MeisterTracker requires **Node.js 22+** and uses SQLite via the built-in `node:sqlite` module (no external SQLite installation needed).

```bash
sudo apt install -y curl ca-certificates git openssl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify the Node.js version:
```bash
node --version   # must be v22.0.0 or higher
```

> **Nginx is NOT installed by default.** Only install it if you choose Path B (Section 7) — the app has its own HTTPS and Let's Encrypt integration that does not need a reverse proxy.

### Install Process Manager
PM2 keeps the server running and auto-restarts on crashes. Global npm installs require `sudo` — without it you'll get `EACCES` errors trying to write to `/usr/lib/node_modules`.
```bash
sudo npm install -g pm2
```

## 2. Project Setup

### Option A — Clone via SSH (recommended)

If you already have an SSH key registered with GitHub, skip the keygen. Otherwise:

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
cat ~/.ssh/id_ed25519.pub
# Copy the printed key, then add it at https://github.com/settings/keys
ssh -T git@github.com   # should greet you by username
```

Prepare the directory and clone:
```bash
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www
git clone git@github.com:meisterpilze/meistertracker.git /var/www/meistertracker
cd /var/www/meistertracker
```

### Option B — Clone via HTTPS

GitHub no longer accepts password authentication for git operations. You'll need a **Personal Access Token** (https://github.com/settings/tokens) — paste the token when git prompts for a password.

```bash
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www
git clone https://github.com/meisterpilze/meistertracker.git /var/www/meistertracker
cd /var/www/meistertracker
```

### Install Dependencies
```bash
npm install --production
```

## 3. Environment Configuration (Optional)

Create a `.env` file in the project root (`nano .env`) — every variable has a sensible default, so an empty file is fine:

```ini
# Server port (default: 3000)
PORT=3000

# Log format: "json" (default) or "text"
LOG_FORMAT=json

# Port for HTTP -> HTTPS redirect. Default: 80.
# Binding port 80 needs root; if it fails the server logs a warning and
# stays in HTTPS-only mode. The same-port redirect on PORT keeps working.
HTTP_REDIRECT_PORT=80

# Set to true ONLY when behind a reverse proxy (e.g. Nginx, Section 7).
# DO NOT set to true without a proxy — it allows clients to spoof their
# IP via X-Forwarded-For headers.
# TRUST_PROXY=false

# Windows-only: printer name for label printing (no effect on Linux)
# PRINTER_NAME=ZDesigner GK420d

# Windows print bridge — see Section 10. When set, the server forwards
# label prints + status checks to scripts/print-bridge.ps1 running on a
# Windows PC. Leave unset to use the ZPL-download fallback instead.
# PRINT_BRIDGE_URL=https://<windows-pc-ip>:9100
# PRINT_BRIDGE_TOKEN=<long-random-string>

# Outbound harvest feed — see Section 15. Unset means off.
# HARVEST_WEBHOOK_URL=https://example.org/harvest
# HARVEST_WEBHOOK_SECRET=<long-random-string>
```

## 4. TLS Certificate Setup

HTTPS is required for camera-based QR scanning (iOS Safari enforces this). Generate a self-signed certificate:

```bash
bash gen-cert.sh
```

This creates `certs/server.key` and `certs/server.crt`, valid for 365 days, covering `localhost`, your LAN IP, and `127.0.0.1`. That's enough for LAN access.

To include a custom domain in the cert, pass it as an argument — replace the placeholder with your real domain:
```bash
bash gen-cert.sh <your-domain>
```

> **Note:** If you'll use Path A below (DuckDNS + Let's Encrypt), skip the domain argument here. The app will obtain a real Let's Encrypt cert that overrides this self-signed one.

## 5. Start the Server

The recommended way to manage the server is the `update_server.sh` script:

```bash
# First start
bash update_server.sh start

# Update from GitHub, back up data, and restart
bash update_server.sh

# Stop the server
bash update_server.sh stop

# Check status
bash update_server.sh status

# Regenerate TLS certificate
bash update_server.sh gen-cert
```

This starts the server as a PM2 process named `meisterpilze`.

### Enable PM2 Startup on Boot

`pm2 startup` only **prints** the command — you have to run it as root yourself:

```bash
pm2 startup
# Copy the printed `sudo env PATH=...` command and run it. Example output
# (yours will differ — use what your machine prints):
#   sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u <your-user> --hp /home/<your-user>
pm2 save
```

### PM2 Log Rotation (REQUIRED)

PM2 writes stdout/stderr to `~/.pm2/logs/meisterpilze-out.log` and
`meisterpilze-error.log`. Without rotation those files grow forever and
eventually fill the disk. Install the official rotation module once during
setup:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
```

What each setting does:

- `max_size 50M` — rotate the active log when it crosses 50 MB.
- `retain 14` — keep 14 rotated archives, then delete the oldest. With our
  log volume that's roughly 2–4 weeks of history; bump higher if you need
  longer audit retention.
- `compress true` — gzip rotated archives so 50 MB shrinks to a few MB on
  disk.
- `dateFormat YYYY-MM-DD_HH-mm-ss` — readable filenames sorted naturally.

These settings persist across reboots once `pm2 save` has been run.

### Verify
```bash
pm2 logs meisterpilze    # view server logs (Ctrl+C to exit)
curl -k https://localhost:3000/api/health
```

The first health check returns `{"error":"setup_required"}` because no admin exists yet. Open the app in a browser and the login screen will switch to setup mode automatically:

```
https://<server-ip>:3000
```

Accept the self-signed cert warning, create the first admin, log in.

---

# Public Access — Choose ONE

To reach the server from outside your LAN with a real (browser-trusted) TLS cert, pick **one** of the two paths below. They don't combine — Path B replaces Path A.

## 6. Path A — Built-in DuckDNS + Let's Encrypt (recommended)

The app has built-in DuckDNS dynamic DNS and Let's Encrypt certificate management. No extra software is needed on the server.

**What you get:**
- Public hostname like `<your-name>.duckdns.org`
- Real Let's Encrypt cert, auto-renewed
- DNS-01 challenge — port 80 is **not** required to be reachable
- URL: `https://<your-name>.duckdns.org:3000` (port stays in URL)

### Setup steps

1. **Register a DuckDNS subdomain** at https://www.duckdns.org/ and copy your token.
2. **Forward port 3000** from your router/firewall to the server.
3. **In the MeisterTracker admin UI** (Settings → DuckDNS):
   - Subdomain prefix only (without `.duckdns.org`)
   - Token from DuckDNS
   - Enable
   - Wait a few minutes for DNS propagation
4. **Enable Let's Encrypt** in the same admin section. The server obtains the cert via DNS-01 (using DuckDNS TXT records) and renews automatically.

That's it — no Nginx, no Certbot, no system-level services beyond what you've already set up.

### The gap the server cannot cover itself (recommended)

The server keeps the DuckDNS record current while it runs, retries when an
update fails, and checks against the authoritative nameservers that the record
it wrote is the record being served.

None of that happens while the server is **down**. A failed deploy, a reboot
where PM2 never came back, a crash nobody saw — the address changes anyway, and
the name goes on pointing at wherever the line used to be. By the time somebody
starts the server again, the address it advertises belongs to somebody else. The
symptom is a server that is unreachable for a reason unrelated to whether it is
running.

`scripts/duckdns-fallback.js` closes that. It runs from the system scheduler
rather than from the server, so it is still there when the server is not.

**It does not double the updates.** The server records the time of each
successful update; the fallback reads that timestamp and stands down while it is
fresh, without opening a socket. Only a gap of more than twelve minutes makes it
act.

**Linux (systemd):**

```bash
sudo bash scripts/install-duckdns-fallback.sh
```

That installs and starts `meistertracker-duckdns.timer` — every five minutes,
and two minutes after boot. Check it took:

```bash
systemctl list-timers meistertracker-duckdns.timer
```

Prove it works without waiting for a real outage (`--force` skips the
stand-down check):

```bash
sudo -u <the-user-that-owns-the-db> node scripts/duckdns-fallback.js --force
```

Read what it has been doing:

```bash
journalctl -u meistertracker-duckdns.service --since today
```

Remove it again with `sudo bash scripts/install-duckdns-fallback.sh --uninstall`.

`update_server.sh` checks after each deploy whether the timer is there, and
prints the command if it is not — but only on a machine where DuckDNS is
actually configured and systemd is present. It never installs anything itself:
it runs as the application user, and writing to `/etc/systemd/system` needs
root. This is the same shape as `pm2 startup` above, for the same reason.

**Windows (Task Scheduler):** double-click `install-duckdns-fallback.bat` and
answer the UAC prompt. That is the whole installation — the script asks Windows
for administrator rights itself, so it does not matter which shell you start it
from.

Administrator is needed for one thing and nothing else: a task registered by an
ordinary user only runs while that user is signed in, which misses the case this
exists for — the machine rebooted and nobody logged in. Running without a
session needs S4U, and registering S4U needs elevation. The job itself runs
unprivileged; it reads a database file and makes one HTTPS request.

This is separate from `install-autostart.ps1` and does not replace it: that one
starts the server, this one covers the times it is not started. Check with
`Get-ScheduledTaskInfo -TaskName MeisterTrackerDuckDNS` — last result `0` is
good. Remove it with `install-duckdns-fallback.bat -Uninstall`.

> **Both installers refuse to run from a git worktree,** and so does the script
> itself. A worktree usually carries a copy of the same token, and a timer
> inside one would quietly fight the real instance over the same record.

**How you tell it is working:** Settings → DuckDNS. The banner is green only
when the nameservers have confirmed the record; it goes red when the last
successful update is too old, when the updater is not running, or when something
else keeps overwriting the record — and it says which.

## 7. Path B — Nginx Reverse Proxy + Certbot (alternative)

Use this path **only if** you need:
- Clean URLs without `:3000` (port 443)
- Multiple services on the same server
- Advanced HTTP features (rate limiting, caching, header manipulation)

> **Important:** With Nginx in front, **disable** the app's built-in DuckDNS/Let's Encrypt (Path A) — they conflict on cert handling.

Install Nginx and Certbot:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create a configuration file at `/etc/nginx/sites-available/meistertracker` — replace `<your-domain>` with your actual domain:

```nginx
server {
    listen 80;
    server_name <your-domain>;

    # Deny access to hidden files (except .well-known for SSL challenges)
    location ~ /\.(?!well-known) {
        deny all;
        access_log off;
        log_not_found off;
    }

    # Security headers
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    # Health check endpoint
    location /api/health {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Server-Sent Events (real-time sync)
    location /api/events {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        chunked_transfer_encoding off;
    }

    # All other requests proxied to Node.js
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site, fetch SSL cert, restart:
```bash
sudo ln -s /etc/nginx/sites-available/meistertracker /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo certbot --nginx -d <your-domain>
```

Set `TRUST_PROXY=true` in your `.env` so the server reads client IPs from `X-Forwarded-For` headers, then restart:
```bash
bash update_server.sh
```

---

## 8. Security Hardening (Recommended)

### Prevent Brute Force Attacks (Fail2Ban)
```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```
Works automatically out of the box for SSH.

### Use SSH Keys
On your **local** machine (laptop/desktop, not the server):
```bash
ssh-keygen -t ed25519
ssh-copy-id -p <ssh-port> <user>@<server-ip>
```

Verify key-based login works (`ssh -p <ssh-port> <user>@<server-ip>` should not prompt for a password). Then optionally disable password auth on the server:
```bash
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart ssh
```

> ⚠️ Verify key-based login works **before** disabling password auth, or you'll lock yourself out.

### Firewall
If your server isn't already firewalled at the network/hypervisor level (e.g. Proxmox host iptables), install UFW:
```bash
sudo apt install -y ufw
sudo ufw allow ssh
sudo ufw allow 3000/tcp     # Path A: app's HTTPS
# OR for Path B:
# sudo ufw allow "Nginx Full"
sudo ufw enable
```

## 9. Backups

MeisterTracker automatically creates daily SQLite backups at midnight:
- Stored in the `backups/` directory
- Uses `VACUUM INTO` for WAL-consistent snapshots
- Keeps the last 30 days
- Filename pattern: `meisterpilze_backup_YYYY-MM-DD.db`

`update_server.sh` and `START.bat` also create a one-off snapshot before pulling new code, with the pattern `meistertracker_YYYYMMDD_HHMMSS.db`. These are NOT rotated — they accumulate until you remove them manually. Both prefixes are recognised by the health check below.

### Verify Backup Health
```bash
# Quick check — exits 0 if healthy, 1 if degraded, 2 if critical.
node scripts/check-backup-health.js

# Full restore test of a specific file (uses the same openDb path as
# /api/backup/restore, so any schema-ordering bug surfaces here).
node scripts/verify-backup.js --restore-test backups/meisterpilze_backup_2026-04-29.db

# Full restore test of the most recent file in the backup dir — what an
# operator should run nightly from cron.
node scripts/verify-backup.js --latest

# Round-trip: take a fresh backup of the live DB and re-open it.
node scripts/verify-backup.js
```

## 10. Off-site backups (REQUIRED)

Backups stored on the same machine as the database are not enough — if the server fails, the backups go with it. The recommended pattern is `rsync` over SSH to a separate host:

```bash
# /etc/cron.d/meisterpilze-offsite
30 0 * * * meisterpilze /usr/local/bin/meisterpilze-offsite-sync.sh
```

```bash
#!/bin/bash
# /usr/local/bin/meisterpilze-offsite-sync.sh
set -e
SRC=/var/www/meistertracker/backups/
DST=backup-host:/srv/meisterpilze-offsite/
TARGET="backup-host:/srv/meisterpilze-offsite/"
START=$(date +%s)
rsync -az --delete "$SRC" "$DST"
END=$(date +%s)
BYTES=$(du -bs "$SRC" | awk '{print $1}')
# Write a marker so /api/health and check-backup-health.js know this
# script ran. Without the marker, off-site failure is silent.
cat > /var/www/meistertracker/backups/.offsite-sync.json <<EOF
{ "time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "bytes": ${BYTES}, "target": "${TARGET}", "durationSeconds": $((END-START)) }
EOF
```

### SSH key for the cron user
```bash
sudo -u meisterpilze ssh-keygen -t ed25519 -f /home/meisterpilze/.ssh/id_ed25519 -N ""
sudo -u meisterpilze ssh-copy-id backup-host
sudo -u meisterpilze ssh backup-host true   # confirm passwordless login works
```

### Marker file
The marker (`backups/.offsite-sync.json`) lets the server expose `/api/health → backup.offSite` with `lastSync`, `ageMinutes`, and `target`, and lets `check-backup-health.js` exit 1 (degraded) when the off-site sync hasn't run in `--max-offsite-age-hours` (default: 26). Any cron script in any language can update the marker — see the bash example above.

### Alternative: OneDrive on Windows
If the project lives under a OneDrive-synced folder, the `backups/` directory cloud-syncs automatically. This is convenient but **platform-specific and not portable** — on a Linux server you must use rsync (or another off-site tool that touches the marker file).

## 11. Restoring from a backup

Three scenarios in increasing severity:

### A. Encrypted `.enc` restore via the admin UI

If you downloaded a password-encrypted archive from **Settings → Backup → Download**, restore it the same way:

1. Log in as admin.
2. Open **Settings → Backup → Restore** and pick the `.enc` file.
3. Enter the password used at download time.
4. The server validates, swaps in the new database atomically (with a `.pre-restore.bak` rollback safety net), and broadcasts the change to all connected clients.

This is the preferred path when the server is still reachable.

### B. Manual file swap (admin UI unreachable)

When the database is corrupt or the admin UI can't load:

```bash
# 1. Stop the server
pm2 stop meisterpilze        # Linux
# Or close START.bat            # Windows

# 2. Move the broken DB aside (KEEP it — never delete a corrupt DB; you may
#    need it for forensics or partial recovery later)
mv meistertracker.db meistertracker.db.broken
rm -f meistertracker.db-wal meistertracker.db-shm

# 3. Pick a backup. Auto-backups: backups/meisterpilze_backup_YYYY-MM-DD.db
#    Manual backups: backups/meistertracker_YYYYMMDD_HHMMSS.db
ls -la backups/

# 4. Verify the chosen file BEFORE swapping it in (catches a corrupt file
#    early, avoids a second outage on restart):
node scripts/verify-backup.js --restore-test backups/meisterpilze_backup_2026-04-29.db

# 5. Copy the backup into place
cp backups/meisterpilze_backup_2026-04-29.db meistertracker.db

# 6. Restart
pm2 start meisterpilze       # Linux
# Or double-click START.bat     # Windows
```

After restart, log in and confirm batches/harvests/users are present. If anything is missing, stop again and try an older backup.

### C. WAL-only recovery (last resort)

If `meistertracker.db` is gone but `meistertracker.db-wal` and `meistertracker.db-shm` survive, **you cannot recover from WAL alone** — SQLite's write-ahead log is meaningless without the original DB file it amends. Treat this as scenario B and accept the loss of whatever was sitting in WAL since the last backup.

To minimise this loss in the future, lower `wal_autocheckpoint` (currently 1000 pages) or run `PRAGMA wal_checkpoint(TRUNCATE)` from a cron, but **the off-site backup (Section 10) is the real defence** — it captures the consistent on-disk state every night.

For background on the encrypted-archive format and the admin restore endpoint, see README.md → Restoring from a backup.

## 12. Label Printing on Linux

The label-printing endpoint (`/api/print`) needs the Windows print spooler to talk to a Zebra GK420d. On Linux you have two practical options:

### Option A — ZPL download fallback (works out of the box, no setup)

If `PRINT_BRIDGE_URL` is unset, every print button on the Linux server falls back to producing a ZPL file the browser downloads. The user sends the file to a Windows PC that has the Zebra driver and prints it from there (double-clicking the `.zpl` typically works).

Pros: zero setup, works from any browser device.
Cons: extra click per print, no live printer-status indication.

### Option B — Windows print bridge (recommended for daily lab use)

Run [`scripts/print-bridge.ps1`](scripts/print-bridge.ps1) on a Windows PC that has the Zebra GK420d attached. The Linux server forwards `/api/print` and `/api/printer-status` calls to the bridge over **HTTPS** (with a self-signed cert the installer generates automatically), so print buttons go straight to the printer like the Windows-native install used to and the LAN traffic is encrypted.

The Print tab's status banner reflects the bridge state in real time:
- **Green** "Printer ready" — bridge reachable, printer online
- **Yellow** "Printer disconnected" — bridge reachable, but the GK420d is unplugged or off
- **Red** "Print bridge unreachable" — Windows PC off or service not started
- **Blue** "ZPL download mode" — no bridge configured, buttons download instead

#### One-time Windows setup

The script ships with a self-installer that handles the TLS certificate, URL ACL, firewall rule, scheduled task, and immediate start in one step.

1. **Download** `print-bridge.ps1` from the running server's **Settings → Drucker** tab (or directly from `scripts/print-bridge.ps1` in the repo) and save it to e.g. `C:\meistertracker-bridge\print-bridge.ps1`.

2. **Install** by running this from any PowerShell (the installer auto-elevates via UAC if needed):
   ```powershell
   powershell -ExecutionPolicy Bypass -File "C:\meistertracker-bridge\print-bridge.ps1" -Install
   ```

   The installer:
   - Generates a self-signed TLS cert (10-year validity) into `cert:\LocalMachine\My`
   - Binds it to the listener port via `netsh http add sslcert`
   - Adds the HTTPS URL ACL and the inbound firewall rule
   - Registers the "MeisterTracker Print Bridge" scheduled task (At Logon)
   - Starts the task immediately

That's it — the bridge is now serving HTTPS on port 9100 and will start automatically at every logon.

#### Management commands

```powershell
# What's installed and running?
print-bridge.ps1 -Status

# Stop the bridge but keep it installed (Settings → Drucker on the server can still
# show "configured" — switch the server to local PowerShell printing while
# you do hardware maintenance, etc.)
print-bridge.ps1 -Disable
print-bridge.ps1 -Enable

# Remove TLS cert, SSL binding, URL ACL, firewall rule, scheduled task,
# and stop any running instance
print-bridge.ps1 -Uninstall
```

All four commands auto-elevate.

#### Server-side configuration

The Linux server's **Settings → Drucker** tab is the recommended place to enter the bridge URL + token — values are stored in the database and take effect immediately, no server restart needed.

For headless deployments or backwards-compatibility, the same values can also be set in `.env` (UI values take precedence when present):
```ini
PRINT_BRIDGE_URL=https://<windows-pc-ip>:9100
PRINT_BRIDGE_TOKEN=<a-long-random-string>
```

#### Token auth (optional, recommended)

The HTTPS channel encrypts the token in transit, but token auth is still recommended on shared LANs to prevent unauthorized prints. Without a token, anyone who can reach `https://<windows-ip>:9100` can print to your Zebra. To require a token, set the same value on both sides.

On the Linux server: enter the token in **Settings → Drucker** (or `PRINT_BRIDGE_TOKEN` in `.env`).

On Windows: pass `-Token` when installing, e.g.:
```powershell
powershell -ExecutionPolicy Bypass -File "C:\meistertracker-bridge\print-bridge.ps1" -Install -Token "your-long-random-string"
```

The installer persists the token into the scheduled-task arguments, so it survives logoffs / reboots.

#### App passwords for calendar clients

CalDAV authenticates with HTTP Basic against the app's own accounts, so
subscribing a phone used to mean typing the password that also opens the web UI
into iOS or Thunderbird — where the client keeps it, in a keychain that syncs to
a cloud backup and outlives the device.

Under **Settings → CalDAV** each user can now create an app password per device.
It opens calendars and nothing else, it is shown once at creation and stored
only as a hash, and it can be revoked on its own without changing the account
password. The account password still works, so existing subscriptions keep
running — but there is no longer a reason to hand one to a calendar client.

Changing or resetting an account password deletes that user's app passwords,
along with their sessions and OAuth grants. A password change is the answer to
"this account may be compromised", and somebody who had the account could have
created one; the cost is re-adding the calendar on each device.

#### Certificate pinning

The bridge's certificate is self-signed, so there is no chain for the server to
validate. Instead it pins the certificate: the **first** connection to a bridge
address records that certificate's SHA-256 fingerprint (you will see
`Pinned print bridge certificate on first connection` in the log, with the
fingerprint), and every connection after that is refused unless the certificate
matches. That is what stops somebody on the same LAN from answering for the
bridge's address, collecting your `PRINT_BRIDGE_TOKEN` and printing whatever
they like.

Consequence: **re-running `print-bridge.ps1 -Install` issues a new certificate**,
and printing will then fail with *"Bridge certificate changed"* until you tell
the server to trust it. To re-pin, open **Settings → Drucker** and save — any
save clears the pin, and the next print records the new certificate. Pointing
the server at a different bridge address re-pins by itself; only a changed
certificate at the *same* address is treated as a problem.

If you see that error and you did not just re-install the bridge, do not save
the settings — find out who else is answering on that address first.

## 13. Updating

To update a running installation:
```bash
cd /var/www/meistertracker
bash update_server.sh
```

This will:
1. Pull the latest code from `origin/main`
2. Install updated dependencies
3. Back up the database
4. Ensure TLS certificates are present
5. Restart the server via PM2

## 14. Docker Deployment (Alternative)

MeisterTracker includes a Dockerfile for containerized deployment:

```bash
docker build -t meistertracker .
docker run -d \
  --name meistertracker \
  -p 3000:3000 \
  -v meistertracker-data:/app/meistertracker.db \
  -v meistertracker-backups:/app/backups \
  -v meistertracker-calendars:/app/calendars \
  meistertracker
```

The container uses Node.js 22 Alpine, runs as a non-root user, and includes a health check on `/api/health`.

## 15. Outbound Harvest Feed (Optional)

Pushes a signed summary of recorded harvests and upcoming batches to a URL you choose, so a shop, listing page or chat bot can answer "what's available today?" without this machine being reachable from the internet. See **README.md → Harvest feed** for the payload shape and what it deliberately leaves out.

**Nothing is opened up.** No inbound endpoint, no port, no dependency on your public IP. The server dials out; that is the whole surface.

The receiver may, however, answer — the reply can carry pickups back, and withdraw them again, which lands on the **Pickups** page. Data from the far end therefore does reach the database, over a socket this side opened and is still holding. The body is validated as untrusted input (JSON only, 64 KB cap applied before it is read, every field bounded, unknown fields dropped), and a malformed reply never turns a delivered push into a failed one. See **README.md → Pickups** for the shape.

### Setup — in the browser

**Settings → Harvest feed.** No shell, no file, no restart.

1. **Receiver URL.** HTTPS; plain HTTP is accepted for `localhost` only, so you can try it against a local receiver first.
2. **Generate** a secret and give the same value to the receiving side. It is stored write-only — the page never reads it back, so copy it before saving.
3. **Show what would be sent.** This builds the payload from the database and displays it, sending nothing. Do this before enabling: "does this leak anything?" is a question to answer by looking, not by trusting the description.
4. **Save**, then **Send one now.** The result says whether the receiver accepted it, which is the difference between saved and working — a wrong secret or a typo in the host looks exactly like a correct setup until something is actually delivered.

The timer restarts on save. The last outcome stays visible at the top of the page, so a feed that quietly stopped delivering shows up instead of failing in silence.

### If a shop sells from this

The feed never reports a harvest total as sellable. What a shop may sell is always a **release**: an amount somebody set aside by hand, on the **Pickups** page, per species, with a date it stops counting. Put that amount in its own crate and sell everything else from the rest — then a walk-in customer or a busy market Saturday cannot make the published number wrong, and there is nothing to keep up to date between harvests.

The harvest totals still travel, in `harvested`. They are production data — what came off the racks — and a receiver that publishes them as stock is reading the wrong field.

Two consequences worth knowing:

- **The payload is version 2.** A receiver built for version 1 should reject it, because ignoring the release list means publishing produce you kept back. Check the receiver before pointing this at one.
- **Nothing is released until you say so.** A fresh install reports an empty release list, and a shop reading it shows nothing. That is the safe direction: an empty list is a statement, not a gap.

**In what portions it is sold** is the second half of the same question, and it is answered in *Settings → Harvest feed → Amounts handed out*: tick the sizes you pack in — 250 g, 500 g, a kilo — or add one the list does not offer. They go out as `packSizes`, one list for every species, because portioning follows the packing bench and not the mushroom. A shop offers those amounts for each listing and leaves out whatever the release no longer covers.

Ticking nothing leaves the field out of the payload entirely, and a receiver then has no portions to sell produce in. ⚠️ **Expect that to mean no orders at all** — the shop this was built with shows the listing and its price, and offers no order button until sizes are set. It deliberately does not fall back on sizes of its own: a ladder nobody decided looks, in a shop window, exactly like one somebody did.

> **Until 2026-08-14 this was a switch** (`HARVEST_WEBHOOK_RELEASE_MODE`, "Only report what is released for sale"), off by default. It is gone. Off, the feed published harvest totals — a number that stops being true the moment something is sold at a stall — and because it was also the quiet option, a lab that never found the checkbox published raw stock and looked fine doing it. A setting whose wrong value produces plausible-looking numbers is not a setting worth keeping. The database column stays and is always 1, so an older build reading the same file does not fall back.

### Setup — from a file instead

For installs where configuration is baked into an image or handled by whatever starts the process, the same settings exist as environment variables. They apply whenever the stored config is **off**; enabling it in Settings takes over, and the page says which of the two is in charge. The two are never merged — a URL from one place and a secret from the other is a configuration nobody can read off a single screen.

1. **Generate a secret** and give the same value to the receiving side:

   ```bash
   openssl rand -hex 32
   ```

2. **Add both values to `.env`:**

   ```ini
   HARVEST_WEBHOOK_URL=https://example.org/harvest
   HARVEST_WEBHOOK_SECRET=<the value from step 1>
   ```

3. **Look at the payload before you turn it on.** This reads the database and prints what would be sent, without sending it:

   ```bash
   node harvest-feed.js --dry-run
   ```

4. **Send one for real**, to check the receiver accepts the signature:

   ```bash
   node harvest-feed.js --once
   ```

5. **Restart the server.** The feed then runs on its own timer.

   ```bash
   bash update_server.sh
   ```

### Tuning

| Variable | Default | What it does |
|---|---|---|
| `HARVEST_WEBHOOK_URL` | — | Where to POST. Unset means the feature is off. HTTPS required (plain HTTP only for `localhost`, so you can try it against a local receiver). |
| `HARVEST_WEBHOOK_SECRET` | — | HMAC key. Required — the feed refuses to start without one. |
| `HARVEST_WEBHOOK_INTERVAL_MIN` | `15` | How often to post. Minimum 1. |
| `HARVEST_WEBHOOK_FRESH_DAYS` | `3` | How far back a harvest still counts as on offer. Set it to what your product actually keeps. |
| `HARVEST_WEBHOOK_PLANNED_DAYS` | `28` | How far ahead to report upcoming block batches. `0` drops the planned block entirely. |
| `HARVEST_WEBHOOK_LEAD_DAYS` | `0` | Days between a batch's due date (end of incubation) and the first expected flush. Species-dependent — yours is whatever your records show. |
| `HARVEST_WEBHOOK_STRAIN` | `1` | `0` sends species only, no strain names. |
| `HARVEST_WEBHOOK_SITE` | — | Free-form label, passed through untouched. Useful when several sites post to one receiver. |
| `HARVEST_WEBHOOK_PACK_SIZES` | — | The portions a release is handed out in, in grams: `250,500,1000`. One list for every species. Whole numbers from 25 to 25000, at most eight; anything else in the list is dropped. Unset means the field is absent — and a receiving shop has nothing to sell produce in, so expect no orders until it is set. |
| `HARVEST_WEBHOOK_TIMEOUT_MS` | `15000` | Per attempt. Three attempts with backoff; a 4xx other than 408/429 stops immediately, because a wrong secret does not fix itself. |

### Verifying the signature on the receiving side

```js
const crypto = require('crypto');
// `raw` must be the exact request body, before any JSON parsing.
const ts = Number(req.headers['x-meistertracker-timestamp']);
if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) reject(); // replay window
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
const got = String(req.headers['x-meistertracker-signature'] || '');
// Compare in constant time, and check the length first — timingSafeEqual throws
// on a length mismatch, and the caller controls that header.
const ok = got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
```

The timestamp check is the half that stops replays; without it a captured request stays valid forever.

### Troubleshooting

| Symptom | Cause |
|---|---|
| `Harvest feed misconfigured — not started` in the log | The URL is set but the secret is not, or the URL is not HTTPS. The message names which. |
| `Harvest feed skipped {reason: worktree mode}` | `WORKTREE_MODE=1`. Deliberate — two servers posting contradictory snapshots to one receiver is worse than one posting none. |
| Receiver gets a 401 back from your own check | Verify over the **raw** body, not a re-serialized object; `JSON.stringify` of a parsed payload will not byte-match. |
| `harvested` is empty but you harvested today | Check `HARVEST_WEBHOOK_FRESH_DAYS`, and that the harvest rows carry a species. |
| `planned` is empty | Only `block` batches with bags, a due date inside the window, and no harvest recorded yet appear there. |
| `Harvest feed reply not usable` in the log | The receiver answered, and the body did not survive validation. The message says why — `reply is text/html, not JSON` is usually a proxy in front of the receiver returning an error page. *Send one now* in Settings shows the same detail. |
| The Pickups page stays empty although the receiver sends some | Look at *Send one now*: it reports both the reply error and how many entries were dropped. Dropped entries usually mean no usable `id`, or a `from`/`to` carrying an offset — those must be local wall-clock, with the zone in `zone`. |
| The receiver keeps resending a pickup it was told about | It is only confirmed after a push that succeeded. Check the feed is actually delivering; a failed push deliberately confirms nothing. |
| A cancelled pickup is still on the Pickups page | The receiver has to name it in `pickupsCancelled` — there is no route into this machine for it to delete anything. It should repeat that until the id comes back in `pickupsDone`. |

## Quick Reference

| Command | Description |
|---------|-------------|
| `bash update_server.sh` | Update & restart |
| `bash update_server.sh start` | Start server |
| `bash update_server.sh stop` | Stop server |
| `bash update_server.sh status` | PM2 process status |
| `pm2 logs meisterpilze` | View server logs |
| `pm2 monit` | Real-time monitoring dashboard |
| `curl -k https://localhost:3000/api/health` | Health check |
