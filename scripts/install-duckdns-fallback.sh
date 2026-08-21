#!/bin/bash
#
# Install the DuckDNS fallback timer (Linux, systemd).
#
# The server keeps its own DuckDNS record current while it runs. This installs
# the one thing it cannot do for itself: an updater that is still there when the
# server is not. See scripts/duckdns-fallback.js for why that gap matters and
# how the two stay out of each other's way.
#
#   sudo bash scripts/install-duckdns-fallback.sh
#
# Uninstall:
#
#   sudo bash scripts/install-duckdns-fallback.sh --uninstall

set -eu

UNIT_NAME="meistertracker-duckdns"
UNIT_DIR="/etc/systemd/system"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATES="$DIR/scripts/systemd"

die() { echo "Error: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo — it writes to $UNIT_DIR."
command -v systemctl >/dev/null 2>&1 || die "systemctl not found. This machine does not use systemd; see DEPLOYMENT.md for the Windows path."

if [ "${1:-}" = "--uninstall" ]; then
    systemctl disable --now "$UNIT_NAME.timer" 2>/dev/null || true
    rm -f "$UNIT_DIR/$UNIT_NAME.timer" "$UNIT_DIR/$UNIT_NAME.service"
    systemctl daemon-reload
    echo "  -> Removed $UNIT_NAME.timer and $UNIT_NAME.service."
    exit 0
fi

# A worktree carries the same token and would fight the real instance for the
# record. The script refuses to run from one; refuse to install it there too, so
# the mistake is caught now rather than in a journal nobody reads.
[ -f "$DIR/.git" ] && die "$DIR is a git worktree. Install this from the deployment checkout."

# The units run as whoever owns the database, because that is what the job has
# to write. Deriving it beats asking: under sudo, $SUDO_USER is the human who
# typed the command, and the file itself is the authority when it exists.
if [ -f "$DIR/meistertracker.db" ]; then
    MT_USER="$(stat -c '%U' "$DIR/meistertracker.db")"
    MT_GROUP="$(stat -c '%G' "$DIR/meistertracker.db")"
else
    MT_USER="${SUDO_USER:-root}"
    MT_GROUP="$(id -gn "$MT_USER")"
    echo "  -> No database yet; using $MT_USER. Start the server once, then re-run this."
fi
id "$MT_USER" >/dev/null 2>&1 || die "user '$MT_USER' does not exist."

MT_NODE="$(command -v node || true)"
[ -n "$MT_NODE" ] || die "node not found in PATH. systemd units need an absolute path to it."
# Units cannot resolve PATH, so an absolute path is not optional here.
case "$MT_NODE" in /*) ;; *) die "node resolved to a relative path ($MT_NODE)." ;; esac

for f in "$UNIT_NAME.service" "$UNIT_NAME.timer"; do
    [ -f "$TEMPLATES/$f" ] || die "template missing: $TEMPLATES/$f"
done

echo "==== MeisterTracker DuckDNS fallback ===="
echo "  -> Directory: $DIR"
echo "  -> Runs as:   $MT_USER:$MT_GROUP"
echo "  -> Node:      $MT_NODE"

for f in "$UNIT_NAME.service" "$UNIT_NAME.timer"; do
    sed -e "s|__MT_DIR__|$DIR|g" \
        -e "s|__MT_USER__|$MT_USER|g" \
        -e "s|__MT_GROUP__|$MT_GROUP|g" \
        -e "s|__MT_NODE__|$MT_NODE|g" \
        "$TEMPLATES/$f" > "$UNIT_DIR/$f"
    chmod 0644 "$UNIT_DIR/$f"
done

# Nothing should reach the installed units still carrying a placeholder — a
# unit with a literal __MT_DIR__ in it starts, fails, and looks like a DuckDNS
# problem rather than an installation one.
if grep -l '__MT_[A-Z]*__' "$UNIT_DIR/$UNIT_NAME.service" "$UNIT_DIR/$UNIT_NAME.timer" 2>/dev/null; then
    die "a placeholder survived substitution in the file(s) above — units not enabled."
fi

systemctl daemon-reload
systemctl enable --now "$UNIT_NAME.timer"

echo ""
echo "  -> Installed and started $UNIT_NAME.timer."
echo ""
echo "  It does nothing while the server is updating the record itself."
echo "  Check it took:"
echo "      systemctl list-timers $UNIT_NAME.timer"
echo "  Prove it works without waiting for a real outage:"
echo "      sudo -u $MT_USER $MT_NODE $DIR/scripts/duckdns-fallback.js --force"
echo "  Read what it has been doing:"
echo "      journalctl -u $UNIT_NAME.service --since today"
echo ""
