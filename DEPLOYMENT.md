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
git clone git@github.com:loewenmaehne/meistertracker.git /var/www/meistertracker
cd /var/www/meistertracker
```

### Option B — Clone via HTTPS

GitHub no longer accepts password authentication for git operations. You'll need a **Personal Access Token** (https://github.com/settings/tokens) — paste the token when git prompts for a password.

```bash
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www
git clone https://github.com/loewenmaehne/meistertracker.git /var/www/meistertracker
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
# PRINT_BRIDGE_URL=http://<windows-pc-ip>:9100
# PRINT_BRIDGE_TOKEN=<long-random-string>
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
#   sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u julian --hp /home/julian
pm2 save
```

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

### Verify Backup Health
```bash
node scripts/check-backup-health.js    # quick check, exits 0 if OK
node scripts/verify-backup.js          # full restore test
```

### Off-Site Backups (recommended)
Backups on the same server are not enough — if the server fails, the backups go with it. Add a cron job to copy them off-site:
```bash
crontab -e
```
```
0 2 * * * rsync -a /var/www/meistertracker/backups/ <user>@<backup-server>:/backups/meistertracker/
```

## 10. Label Printing on Linux

The label-printing endpoint (`/api/print`) needs the Windows print spooler to talk to a Zebra GK420d. On Linux you have two practical options:

### Option A — ZPL download fallback (works out of the box, no setup)

If `PRINT_BRIDGE_URL` is unset, every print button on the Linux server falls back to producing a ZPL file the browser downloads. The user sends the file to a Windows PC that has the Zebra driver and prints it from there (double-clicking the `.zpl` typically works).

Pros: zero setup, works from any browser device.
Cons: extra click per print, no live printer-status indication.

### Option B — Windows print bridge (recommended for daily lab use)

Run [`scripts/print-bridge.ps1`](scripts/print-bridge.ps1) on a Windows PC that has the Zebra GK420d attached. The Linux server forwards `/api/print` and `/api/printer-status` calls to the bridge over HTTP, so print buttons go straight to the printer like the Windows-native install used to.

The Print tab's status banner reflects the bridge state in real time:
- **Green** "Printer ready" — bridge reachable, printer online
- **Yellow** "Printer disconnected" — bridge reachable, but the GK420d is unplugged or off
- **Red** "Print bridge unreachable" — Windows PC off or service not started
- **Blue** "ZPL download mode" — no bridge configured, buttons download instead

#### One-time Windows setup

The script ships with a self-installer that handles URL ACL, firewall rule, scheduled task, and immediate start in one step.

1. **Download** `print-bridge.ps1` from the running server's **Settings → Drucker** tab (or directly from `scripts/print-bridge.ps1` in the repo) and save it to e.g. `C:\meistertracker-bridge\print-bridge.ps1`.

2. **Install** by running this from any PowerShell (the installer auto-elevates via UAC if needed):
   ```powershell
   powershell -ExecutionPolicy Bypass -File "C:\meistertracker-bridge\print-bridge.ps1" -Install
   ```

That's it — the bridge is now running and will start automatically at every logon.

#### Management commands

```powershell
# What's installed and running?
print-bridge.ps1 -Status

# Stop the bridge but keep it installed (Settings → Drucker on the server can still
# show "configured" — switch the server to local PowerShell printing while
# you do hardware maintenance, etc.)
print-bridge.ps1 -Disable
print-bridge.ps1 -Enable

# Remove URL ACL, firewall rule, scheduled task, and stop any running instance
print-bridge.ps1 -Uninstall
```

All four commands auto-elevate.

#### Server-side configuration

The Linux server's **Settings → Drucker** tab is the recommended place to enter the bridge URL + token — values are stored in the database and take effect immediately, no server restart needed.

For headless deployments or backwards-compatibility, the same values can also be set in `.env` (UI values take precedence when present):
```ini
PRINT_BRIDGE_URL=http://<windows-pc-ip>:9100
PRINT_BRIDGE_TOKEN=<a-long-random-string>
```

#### Token auth (optional, recommended)

Without a token, anyone on the LAN can print to your Zebra. To require a token, set the same value on both sides.

On the Linux server: enter the token in **Settings → Drucker** (or `PRINT_BRIDGE_TOKEN` in `.env`).

On Windows: pass `-Token` when installing, e.g.:
```powershell
powershell -ExecutionPolicy Bypass -File "C:\meistertracker-bridge\print-bridge.ps1" -Install -Token "your-long-random-string"
```

The installer persists the token into the scheduled-task arguments, so it survives logoffs / reboots.

## 11. Updating

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

## 12. Docker Deployment (Alternative)

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
