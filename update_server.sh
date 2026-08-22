#!/bin/bash

# Pulls latest code, makes a one-off DB snapshot (filename pattern:
# meistertracker_YYYYMMDD_HHMMSS.db) under backups/, regenerates TLS certs
# if missing, and restarts the meisterpilze PM2 process.
#
# To restore from a backup, see DEPLOYMENT.md → "Restoring from a backup".
# For off-site replication of backups/, see DEPLOYMENT.md → "Off-site backups
# (REQUIRED)".

# exit immediately if a command exits with a non-zero status
set -e

# Configuration — override via env to run multiple instances under
# distinct PM2 names, or to match a fork's branding. Must match the
# value the server itself reads from PM2_PROCESS_NAME (server.js).
PM2_PROCESS_NAME="${PM2_PROCESS_NAME:-meisterpilze}"

# ---- Helper functions ----

detect_worktree() {
    IS_WORKTREE=false
    if git rev-parse --is-inside-work-tree &>/dev/null; then
        local git_dir
        git_dir="$(git rev-parse --git-dir 2>/dev/null)"
        if [[ "$git_dir" == */.git/worktrees/* ]]; then
            IS_WORKTREE=true
            # Auto-isolate so a worktree run lives alongside prod:
            #   - different PORT (default 3001) so prod on 3000 keeps serving
            #   - different PM2 name so 'pm2 delete' won't touch prod
            #   - WORKTREE_MODE flag so the server can render a UI warning
            : "${PORT:=3001}"
            export PORT
            # Always append -worktree so forks running with a custom
            # PM2_PROCESS_NAME (e.g. "mytracker") still get isolation —
            # otherwise `pm2 delete $PM2_PROCESS_NAME` later in this script
            # would target the fork's prod process. Skip the rewrite if the
            # suffix is already present (re-entrant runs).
            case "$PM2_PROCESS_NAME" in
                *-worktree) ;;
                *) PM2_PROCESS_NAME="${PM2_PROCESS_NAME}-worktree" ;;
            esac
            export PM2_PROCESS_NAME
            export WORKTREE_MODE=1
            echo "┌──────────────────────────────────────────┐"
            echo "│  Running in git worktree                 │"
            echo "│  Git pull will be skipped                │"
            echo "└──────────────────────────────────────────┘"
            echo "  -> Port:     $PORT"
            echo "  -> PM2 name: $PM2_PROCESS_NAME"
            echo "  -> Production on port 3000 will NOT be touched."
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
    local stamp
    stamp="$(date +%Y%m%d_%H%M%S)"
    if [ -f meistertracker.db ]; then
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
    # Contamination photos (audit Section 2). Only present once the feature is
    # used; tar.gz keeps the backups directory tidy.
    if [ -d data/photos ]; then
        if command -v tar &>/dev/null; then
            tar -czf "$BACKUP_DIR/photos_$stamp.tar.gz" data/photos 2>/dev/null \
                && echo "  -> data/photos archived to $BACKUP_DIR/photos_$stamp.tar.gz" \
                || echo "  -> WARNING: photo archive failed (tar exit $?)"
        else
            cp -r data/photos "$BACKUP_DIR/photos_$stamp" \
                && echo "  -> data/photos copied to $BACKUP_DIR/photos_$stamp" \
                || echo "  -> WARNING: photo copy failed"
        fi
    fi
}

# The DuckDNS fallback timer is a one-time root step, and one-time root steps are
# the ones that get put off and then forgotten. This never installs anything —
# it cannot, it runs as the application user — it just refuses to let the gap
# stay invisible. Every branch bails out quietly rather than failing a deploy
# over a reminder.
check_duckdns_fallback() {
    if [ "$IS_WORKTREE" = true ]; then return 0; fi
    if ! command -v systemctl >/dev/null 2>&1; then return 0; fi
    # Only worth saying on a machine where DuckDNS is actually in use. --check
    # reads one row and makes no request.
    if ! node scripts/duckdns-fallback.js --check --quiet >/dev/null 2>&1; then return 0; fi

    # Ask systemd what the timer is *doing*, not whether a file exists. A unit
    # that has been disabled or masked leaves its file in /etc/systemd/system
    # untouched, so the presence check reported "installed" for a timer that had
    # not run in months — the one state an operator cannot see, and the one that
    # produces exactly the outage this is here to prevent.
    local state=""
    if systemctl is-enabled meistertracker-duckdns.timer >/dev/null 2>&1 \
       && systemctl is-active meistertracker-duckdns.timer >/dev/null 2>&1; then
        # Running. Say so only if the job behind it keeps failing.
        if systemctl is-failed meistertracker-duckdns.service >/dev/null 2>&1; then
            echo ""
            echo "  NOTE: the DuckDNS fallback timer is installed but its last run failed."
            echo "            journalctl -u meistertracker-duckdns.service -n 20"
            echo ""
        fi
        return 0
    fi
    if [ -f /etc/systemd/system/meistertracker-duckdns.timer ]; then
        state="installed but not running"
    else
        state="not installed"
    fi

    echo ""
    echo "  NOTE: DuckDNS is configured, but the fallback timer is $state."
    echo "        Without it nothing updates the address while this server is"
    echo "        down — which is exactly when the address changes. One-time:"
    echo ""
    echo "            sudo bash scripts/install-duckdns-fallback.sh"
    echo ""
}

# Try the new code against a copy of the real database before anything is
# swapped. See scripts/preflight.js: it snapshots the live file with VACUUM INTO
# (which does not write to the source), runs the pending migrations there, checks
# no table lost rows, and loads every module the server loads. A failure here
# costs nothing — the old server is still running and still serving.
run_preflight() {
    if [ ! -f scripts/preflight.js ]; then
        echo "  -> No preflight script in this version; skipping."
        return 0
    fi
    if node scripts/preflight.js; then
        return 0
    fi
    echo ""
    echo "  ABORTED: the new version did not pass the preflight."
    echo "  Nothing was changed. The server is still running the previous code."
    echo "  The working tree is now at the new commit — to go back:"
    echo "      git reset --hard stable && npm install --production"
    exit 1
}

# Put production back on the last commit that was known to start, and start it.
#
# The crash was already being detected; what was missing is that anything
# happened next. Printing a log and exiting left the server down until somebody
# read it, which for an unattended update at night means until morning.
rollback_to_stable() {
    if [ "$IS_WORKTREE" = true ]; then return 0; fi
    if ! git rev-parse --verify stable >/dev/null 2>&1; then
        echo "  No 'stable' tag to fall back to — leaving the tree as it is."
        echo "  Recover by hand with: git reset --hard <a working commit>"
        return 1
    fi
    echo ""
    echo "  Rolling back to the last version that started ('stable')..."
    if ! git reset --hard stable; then
        echo "  Rollback failed. The tree is still on the new commit."
        return 1
    fi
    npm install --production || true
    pm2 delete "$PM2_PROCESS_NAME" >/dev/null 2>&1 || true
    pm2 start server.js --name "$PM2_PROCESS_NAME" --update-env
    pm2 save
    sleep 3
    if pm2 show "$PM2_PROCESS_NAME" 2>/dev/null | grep -qi 'online'; then
        echo "  -> Rolled back. The previous version is running again."
        echo "     The failing commit is still on origin/main; fix it there."
        return 0
    fi
    echo "  -> The previous version did not start either. This needs a person."
    return 1
}

do_update() {
    echo "==== Meisterpilze Server — Update & Restart ===="
    check_node
    ensure_pm2

    if [ "$IS_WORKTREE" = true ]; then
        echo "[1/6] Skipping git pull (worktree mode)."
    else
        echo "[1/6] Updating code from git (reset to origin/main)..."
        if ! git fetch origin; then
            echo "Error: git fetch failed."
            exit 1
        fi
        if ! git reset --hard origin/main; then
            echo "Error: git reset --hard origin/main failed."
            exit 1
        fi
    fi

    echo "[2/6] Installing dependencies..."
    npm install --production

    echo "[3/6] Backing up data..."
    backup_data

    echo "[4/6] Ensuring TLS certificates..."
    ensure_certs

    echo "[5/6] Checking the new version against your data..."
    run_preflight

    echo "[6/6] Restarting server..."
    if pm2 describe "$PM2_PROCESS_NAME" > /dev/null 2>&1; then
        echo "  -> Process found, deleting for clean restart..."
        pm2 delete "$PM2_PROCESS_NAME"
    fi
    echo "  -> Starting instance..."
    pm2 start server.js --name "$PM2_PROCESS_NAME" --update-env
    pm2 save

    # Wait briefly for the process to initialize, then verify it stayed up.
    # Match START.bat's "tag stable on success" behavior so we have a marker
    # of the last known-good deployment on both platforms.
    sleep 3
    if ! pm2 show "$PM2_PROCESS_NAME" 2>/dev/null | grep -qi 'online'; then
        echo ""
        echo "  ERROR: Server process crashed on startup."
        echo "  Recent error log:"
        pm2 logs "$PM2_PROCESS_NAME" --lines 15 --nostream --err 2>/dev/null || true
        rollback_to_stable
        exit 1
    fi
    if [ "$IS_WORKTREE" != true ] && command -v git &>/dev/null; then
        if git tag -f stable HEAD > /dev/null 2>&1; then
            echo "  -> Tagged current commit as 'stable'."
        fi
    fi

    echo "==== Update Completed Successfully ===="
    echo "Run 'pm2 logs $PM2_PROCESS_NAME' to see output."
    check_duckdns_fallback
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
    check_duckdns_fallback
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

# Detect worktree before dispatching so every subcommand (update/start/stop/
# status) sees the isolated PM2 name + port. Otherwise running 'start' or
# 'stop' from a worktree would silently target the prod PM2 process.
detect_worktree

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
