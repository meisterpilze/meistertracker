# MeisterTracker Deployment Guide

This guide details the steps to set up MeisterTracker on a fresh Debian server.

## 1. System Requirements & Dependencies

Run the following commands as `root` or with `sudo`.

### Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### Install Core Dependencies
MeisterTracker requires **Node.js 22+** and uses SQLite via the built-in `node:sqlite` module (no external SQLite installation needed).
```bash
sudo apt install -y curl git openssl nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify the Node.js version:
```bash
node --version   # Must be v22.0.0 or higher
```

### Install Process Manager
Install PM2 to keep the server running and auto-restart on crashes.
```bash
sudo npm install -g pm2
```

## 2. Project Setup

```bash
# Clone to /var/www/meistertracker
sudo git clone https://github.com/Meisterpilze/meistertracker.git /var/www/meistertracker

# Fix permissions so your user owns it
sudo chown -R $USER:$USER /var/www/meistertracker

# Enter directory
cd /var/www/meistertracker
```

### Install Dependencies
```bash
npm install --production
```

## 3. Environment Configuration (Optional)

Create a `.env` file in the project root (`nano .env`):
```ini
# Server port (default: 3000)
PORT=3000

# Set to true when behind a reverse proxy (Nginx) to trust X-Forwarded-For headers
TRUST_PROXY=true

# Log format: "json" (default) or "text"
LOG_FORMAT=json

# Port for HTTP -> HTTPS redirect (only used when TLS certs are present)
HTTP_REDIRECT_PORT=80

# Windows-only: printer name for label printing
# PRINTER_NAME=ZDesigner GK420d
```

All variables are optional. The server runs with sensible defaults without a `.env` file.

## 4. TLS Certificate Setup

HTTPS is required for camera-based QR code scanning (iOS Safari enforces this). The included script generates a self-signed certificate:

```bash
bash gen-cert.sh
```

This creates `certs/server.key` and `certs/server.crt`, valid for 365 days, covering `localhost`, your LAN IP, and an optional domain.

To include a custom domain:
```bash
bash gen-cert.sh your-domain.com
```

> **Note:** When using Nginx as a reverse proxy with its own SSL (see Section 6), the self-signed cert is still useful for direct LAN access (e.g. tablets on the shop floor).

## 5. Start the Server

The recommended way to manage the server is via the included `update_server.sh` script:

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
```bash
pm2 startup
# Follow the instructions PM2 outputs, then:
pm2 save
```

### Verify
```bash
pm2 logs meisterpilze    # View server logs
curl http://localhost:3000/api/health   # Should return OK
```

## 6. Nginx Configuration

Create a new configuration file:
```bash
sudo nano /etc/nginx/sites-available/meistertracker
```

Paste the following configuration (replace `your-domain.com`):

```nginx
server {
    listen 80;
    server_name your-domain.com;

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

> **Important:** When using Nginx as a reverse proxy, set `TRUST_PROXY=true` in your `.env` so the server correctly reads client IPs from `X-Forwarded-For` headers.

Enable the site and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/meistertracker /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 7. SSL Setup (Recommended)

Install Certbot for free Let's Encrypt certificates:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot automatically configures Nginx for HTTPS and sets up auto-renewal.

## 8. Firewall Setup (UFW)

```bash
# Install UFW
sudo apt install ufw

# ALLOW SSH FIRST (critical — otherwise you lock yourself out!)
sudo ufw allow ssh

# Allow web traffic (HTTP & HTTPS)
sudo ufw allow "Nginx Full"

# Enable firewall
sudo ufw enable

# Verify
sudo ufw status
```

## 9. Security Hardening (Recommended)

### Prevent Brute Force Attacks (Fail2Ban)
```bash
sudo apt install fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```
Works automatically out of the box for SSH.

### Use SSH Keys (Best Practice)
1. Generate a key on your local machine: `ssh-keygen -t ed25519`
2. Copy it to the server: `ssh-copy-id user@your-server-ip`
3. Once verified, disable `PasswordAuthentication` in `/etc/ssh/sshd_config`

## 10. Backups

MeisterTracker automatically creates daily SQLite backups at midnight:
- Stored in the `backups/` directory
- Uses `VACUUM INTO` for WAL-consistent snapshots
- Keeps the last 30 days

### Verify Backup Health
```bash
node scripts/check-backup-health.js    # Quick check
node scripts/verify-backup.js          # Full restore test
```

### Off-Site Backups (Recommended)
Add a cron job to copy backups to a remote location:
```bash
crontab -e
```
```
0 2 * * * rsync -a /var/www/meistertracker/backups/ user@backup-server:/backups/meistertracker/
```

## 11. Docker Deployment (Alternative)

MeisterTracker includes a Dockerfile for containerized deployment:

```bash
# Build image
docker build -t meistertracker .

# Run container
docker run -d \
  --name meistertracker \
  -p 3000:3000 \
  -v meistertracker-data:/app/meistertracker.db \
  -v meistertracker-backups:/app/backups \
  -v meistertracker-calendars:/app/calendars \
  meistertracker
```

The container uses Node.js 22 Alpine, runs as a non-root user, and includes a health check on `/api/health`.

## 12. Updating

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

## Quick Reference

| Command | Description |
|---------|-------------|
| `bash update_server.sh` | Update & restart |
| `bash update_server.sh start` | Start server |
| `bash update_server.sh stop` | Stop server |
| `bash update_server.sh status` | PM2 process status |
| `pm2 logs meisterpilze` | View server logs |
| `pm2 monit` | Real-time monitoring dashboard |
| `curl localhost:3000/api/health` | Health check |
