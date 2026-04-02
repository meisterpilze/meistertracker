#!/bin/bash

# exit immediately if a command exits with a non-zero status
set -e

# Configuration
PM2_PROCESS_NAME="meisterpilze"

echo "==== Starting Meisterpilze Server Setup & Update ===="

# 0. Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed or not in PATH."
    echo "Install it from https://nodejs.org/ or via your package manager."
    exit 1
fi
echo "  -> Node.js $(node --version) found."

# 1. Install PM2 if not present
if ! command -v pm2 &> /dev/null; then
    echo "[0/3] PM2 not found, installing globally..."
    npm install -g pm2
fi
echo "  -> PM2 $(pm2 --version) found."

# 2. Sync to latest remote main (force local to match GitHub)
echo "[1/3] Updating code from git (reset to origin/main)..."

if ! git fetch origin; then
    echo "Error: git fetch failed."
    exit 1
fi

if ! git reset --hard origin/main; then
    echo "Error: git reset --hard origin/main failed."
    exit 1
fi

# 3. Back up data.json before restart (safety measure)
echo "[2/3] Backing up data..."
BACKUP_DIR="backups"
mkdir -p "$BACKUP_DIR"
if [ -f data.json ]; then
    cp data.json "$BACKUP_DIR/data_$(date +%Y%m%d_%H%M%S).json"
    echo "  -> data.json backed up."
else
    echo "  -> No data.json found, skipping backup."
fi

# 4. Restart or Start Server Process
echo "[3/3] Restarting Server Process..."
if pm2 describe "$PM2_PROCESS_NAME" > /dev/null 2>&1; then
    echo "  -> Process found, attempting reload..."
    pm2 reload "$PM2_PROCESS_NAME" || pm2 restart "$PM2_PROCESS_NAME"
else
    echo "  -> Process not found in PM2, starting new instance..."
    pm2 start server.js --name "$PM2_PROCESS_NAME"
    pm2 save
fi

echo "==== Update Completed Successfully ===="
echo "The server is now running the latest version."
echo "Run 'pm2 logs $PM2_PROCESS_NAME' to see output."
