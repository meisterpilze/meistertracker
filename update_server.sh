#!/bin/bash

# exit immediately if a command exits with a non-zero status
set -e

# Configuration
PM2_PROCESS_NAME="meisterpilze"

echo "==== Starting Meisterpilze Server Update ===="

# 0. Check for PM2
if ! command -v pm2 &> /dev/null; then
    echo "Error: pm2 is not installed or not in PATH."
    echo "This script is intended for the production server environment."
    exit 1
fi

# 1. Sync to latest remote main (force server to match GitHub)
echo "[1/3] Updating code from git (reset to origin/main)..."

if ! git fetch origin; then
    echo "Error: git fetch failed."
    exit 1
fi

if ! git reset --hard origin/main; then
    echo "Error: git reset --hard origin/main failed."
    exit 1
fi

# 2. Back up data.json before restart (safety measure)
echo "[2/3] Backing up data..."
BACKUP_DIR="backups"
mkdir -p "$BACKUP_DIR"
if [ -f data.json ]; then
    cp data.json "$BACKUP_DIR/data_$(date +%Y%m%d_%H%M%S).json"
    echo "  -> data.json backed up."
else
    echo "  -> No data.json found, skipping backup."
fi

# 3. Restart Server Process
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
