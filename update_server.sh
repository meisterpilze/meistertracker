#!/bin/bash

# exit immediately if a command exits with a non-zero status
set -e

# Configuration
PM2_PROCESS_NAME="meisterpilze"

# ---- Helper functions ----

detect_worktree() {
    IS_WORKTREE=false
    if git rev-parse --is-inside-work-tree &>/dev/null; then
        local git_dir
        git_dir="$(git rev-parse --git-dir 2>/dev/null)"
        if [[ "$git_dir" == */.git/worktrees/* ]]; then
            IS_WORKTREE=true
            echo "┌──────────────────────────────────────────┐"
            echo "│  Running in git worktree                 │"
            echo "│  Git pull will be skipped                │"
            echo "└──────────────────────────────────────────┘"
        fi
    fi
}

check_node() {
    if ! command -v node &> /dev/null; then
        echo "Error: Node.js is not installed or not in PATH."
        echo "Install it from https://nodejs.org/ or via your package manager."
        exit 1
    fi
    echo "  -> Node.js $(node --version) found."
}

ensure_pm2() {
    if ! command -v pm2 &> /dev/null; then
        echo "PM2 not found, installing globally..."
        npm install -g pm2
    fi
    echo "  -> PM2 $(pm2 --version) found."
}

ensure_certs() {
    if [ -f certs/server.key ] && [ -f certs/server.crt ]; then
        echo "  -> TLS certificates found."
        # LE cert renewal is handled by the server on startup.
        return
    fi
    echo "  -> TLS certificates not found, generating..."
    if ! command -v openssl &> /dev/null; then
        echo "  -> WARNING: openssl not installed — skipping HTTPS setup."
        echo "     Camera scanning on iOS Safari requires HTTPS."
        echo "     Install openssl and run: bash update_server.sh gen-cert"
        return
    fi
    if [ -f gen-cert.sh ]; then
        bash gen-cert.sh
    else
        echo "  -> WARNING: gen-cert.sh not found — skipping HTTPS setup."
    fi
}

backup_data() {
    BACKUP_DIR="backups"
    mkdir -p "$BACKUP_DIR"
    chmod u+w "$BACKUP_DIR"
    if [ -f meistertracker.db ]; then
        local stamp
        stamp="$(date +%Y%m%d_%H%M%S)"
        # Use sqlite3 .backup for WAL-consistent snapshot if available,
        # fall back to cp (PM2 is stopped later anyway).
        if command -v sqlite3 &>/dev/null; then
            sqlite3 meistertracker.db ".backup '$BACKUP_DIR/meistertracker_$stamp.db'"
        else
            cp meistertracker.db "$BACKUP_DIR/meistertracker_$stamp.db"
        fi
        echo "  -> meistertracker.db backed up to $BACKUP_DIR/meistertracker_$stamp.db"
    else
        echo "  -> No meistertracker.db found, skipping backup."
    fi
}

do_update() {
    echo "==== Meisterpilze Server — Update & Restart ===="
    detect_worktree
    check_node
    ensure_pm2

    if [ "$IS_WORKTREE" = true ]; then
        echo "[1/5] Skipping git pull (worktree mode)."
    else
        echo "[1/5] Updating code from git (reset to origin/main)..."
        if ! git fetch origin; then
            echo "Error: git fetch failed."
            exit 1
        fi
        if ! git reset --hard origin/main; then
            echo "Error: git reset --hard origin/main failed."
            exit 1
        fi
    fi

    echo "[2/5] Installing dependencies..."
    npm install --production

    echo "[3/5] Backing up data..."
    backup_data

    echo "[4/5] Ensuring TLS certificates..."
    ensure_certs

    echo "[5/5] Restarting server..."
    if pm2 describe "$PM2_PROCESS_NAME" > /dev/null 2>&1; then
        echo "  -> Process found, deleting for clean restart..."
        pm2 delete "$PM2_PROCESS_NAME"
    fi
    echo "  -> Starting instance..."
    pm2 start server.js --name "$PM2_PROCESS_NAME" --update-env
    pm2 save

    echo "==== Update Completed Successfully ===="
    echo "Run 'pm2 logs $PM2_PROCESS_NAME' to see output."
}

do_start() {
    echo "==== Meisterpilze Server — Start ===="
    check_node
    ensure_pm2

    # Ensure dependencies are installed
    if [ -f package.json ] && [ ! -d node_modules ]; then
        echo "Installing dependencies..."
        npm install --production
    fi

    echo "Ensuring TLS certificates..."
    ensure_certs

    if pm2 describe "$PM2_PROCESS_NAME" > /dev/null 2>&1; then
        echo "Process already exists, restarting clean..."
        pm2 delete "$PM2_PROCESS_NAME"
    fi
    echo "Starting instance..."
    pm2 start server.js --name "$PM2_PROCESS_NAME" --update-env
    pm2 save
    echo "==== Server Started ===="
}

do_stop() {
    echo "==== Meisterpilze Server — Stop ===="
    ensure_pm2

    if pm2 describe "$PM2_PROCESS_NAME" > /dev/null 2>&1; then
        pm2 stop "$PM2_PROCESS_NAME"
        pm2 delete "$PM2_PROCESS_NAME"
        echo "Server stopped and removed from PM2."
    else
        echo "Process '$PM2_PROCESS_NAME' not found in PM2 — nothing to stop."
    fi
}

do_status() {
    ensure_pm2
    pm2 status
}

do_gen_cert() {
    echo "==== Generating TLS Certificate ===="
    if ! command -v openssl &> /dev/null; then
        echo "Error: openssl is not installed."
        exit 1
    fi
    if [ -f gen-cert.sh ]; then
        bash gen-cert.sh
        echo ""
        echo "Restart the server for HTTPS to take effect:"
        echo "  bash update_server.sh start"
    else
        echo "Error: gen-cert.sh not found."
        exit 1
    fi
}

show_usage() {
    echo "Usage: bash update_server.sh [command]"
    echo ""
    echo "Commands:"
    echo "  (no command)   Update code from GitHub, back up data, restart server"
    echo "  start          Start the server (without pulling updates)"
    echo "  stop           Stop the server"
    echo "  status         Show PM2 process status"
    echo "  gen-cert       Generate self-signed TLS certificate"
    echo "  help           Show this help message"
}

# ---- Main ----

case "${1:-update}" in
    update)   do_update   ;;
    start)    do_start    ;;
    stop)     do_stop     ;;
    status)   do_status   ;;
    gen-cert) do_gen_cert ;;
    help|-h|--help)  show_usage ;;
    *)
        echo "Unknown command: $1"
        show_usage
        exit 1
        ;;
esac
