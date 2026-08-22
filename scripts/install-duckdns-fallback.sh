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

usage() {
    echo "Usage: sudo bash scripts/install-duckdns-fallback.sh [--uninstall]"
}

# An unrecognised argument used to fall through to a full install, so a
# mistyped --uninstall re-enabled the very timer the operator meant to remove.
case "${1:-}" in
    "")
        ;;
    --uninstall)
        systemctl disable --now "$UNIT_NAME.timer" 2>/dev/null || true
        rm -f "$UNIT_DIR/$UNIT_NAME.timer" "$UNIT_DIR/$UNIT_NAME.service"
        systemctl daemon-reload
        echo "  -> Removed $UNIT_NAME.timer and $UNIT_NAME.service."
        exit 0
        ;;
    -h|--help)
        usage
        exit 0
        ;;
    *)
        usage
        die "unknown argument: $1"
        ;;
esac

# A worktree carries the same token and would fight the real instance for the
# record. The script refuses to run from one; refuse to install it there too, so
# the mistake is caught now rather than in a journal nobody reads.
[ -f "$DIR/.git" ] && die "$DIR is a git worktree. Install this from the deployment checkout."

# The units run as whoever owns the database, because that is what the job has
# to write, and the file is the only authority on that. Guessing was worse than
# refusing: the previous version fell back to ${SUDO_USER:-root} when the
# database did not exist yet, printed "start the server once, then re-run this",
# and then enabled the timer anyway. Nothing ever re-derived the user, so a run
# from a root shell installed a permanent User=root timer that later opened the
# app user's database and left root-owned -wal/-shm files it could not reopen.
if [ ! -f "$DIR/meistertracker.db" ]; then
    die "no database at $DIR/meistertracker.db yet.
     The unit has to run as whoever owns that file, and there is nothing to
     read it from. Start the server once, then run this again."
fi
MT_USER="$(stat -c '%U' "$DIR/meistertracker.db")"
MT_GROUP="$(stat -c '%G' "$DIR/meistertracker.db")"
id "$MT_USER" >/dev/null 2>&1 || die "user '$MT_USER' owns the database but does not exist as an account."

# node as the *target* user sees, not as root sees. A pm2 deployment on nvm has
# node under the app user's home and nothing on root's PATH, so resolving it
# here under sudo either fails on a machine where node plainly exists or pins a
# distro binary of a different major version. node:sqlite is unavailable below
# 22.13, so the wrong one throws ERR_UNKNOWN_BUILTIN_MODULE every five minutes
# into a journal nobody reads.
MT_NODE="$(runuser -l "$MT_USER" -c 'command -v node' 2>/dev/null || true)"
[ -n "$MT_NODE" ] || MT_NODE="$(sudo -u "$MT_USER" -i command -v node 2>/dev/null || true)"
[ -n "$MT_NODE" ] || MT_NODE="$(command -v node || true)"
[ -n "$MT_NODE" ] || die "node not found for user '$MT_USER' or for root. A unit needs an absolute path to it."
# Units cannot resolve PATH, so an absolute path is not optional here.
case "$MT_NODE" in /*) ;; *) die "node resolved to a relative path ($MT_NODE)." ;; esac

for f in "$UNIT_NAME.service" "$UNIT_NAME.timer"; do
    [ -f "$TEMPLATES/$f" ] || die "template missing: $TEMPLATES/$f"
done

echo "==== MeisterTracker DuckDNS fallback ===="
echo "  -> Directory: $DIR"
echo "  -> Runs as:   $MT_USER:$MT_GROUP"
echo "  -> Node:      $MT_NODE"

# sed's replacement text is not literal: `&` means "the whole match" and a `\`
# starts an escape, so a deployment path containing either silently corrupts the
# substitution. Escape both, plus the `|` delimiter.
sed_escape() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }
E_DIR="$(sed_escape "$DIR")"
E_USER="$(sed_escape "$MT_USER")"
E_GROUP="$(sed_escape "$MT_GROUP")"
E_NODE="$(sed_escape "$MT_NODE")"

# Build in a temporary directory and move into place only once every check has
# passed. Writing straight to /etc/systemd/system meant a failed check left two
# half-substituted units on disk, so a re-install over a working installation
# could break it.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

for f in "$UNIT_NAME.service" "$UNIT_NAME.timer"; do
    sed -e "s|__MT_DIR__|$E_DIR|g" \
        -e "s|__MT_USER__|$E_USER|g" \
        -e "s|__MT_GROUP__|$E_GROUP|g" \
        -e "s|__MT_NODE__|$E_NODE|g" \
        "$TEMPLATES/$f" > "$STAGE/$f"
done

# Nothing should reach the installed units still carrying a placeholder — a
# unit with a literal placeholder in it starts, fails, and looks like a DuckDNS
# problem rather than an installation one.
if grep -l '__MT_[A-Z]*__' "$STAGE/$UNIT_NAME.service" "$STAGE/$UNIT_NAME.timer" 2>/dev/null; then
    die "a placeholder survived substitution — nothing was installed."
fi

# Prove the interpreter and the script actually work as the chosen user before
# committing to a timer. --check reads one row and makes no request; a non-zero
# exit means DuckDNS is simply not configured yet, which is fine. A *crash* is
# not, and it is what a wrong node produces.
if ! sudo -u "$MT_USER" "$MT_NODE" "$DIR/scripts/duckdns-fallback.js" --check --quiet >/dev/null 2>&1; then
    if ! sudo -u "$MT_USER" "$MT_NODE" --version >/dev/null 2>&1; then
        die "'$MT_NODE' does not run as user '$MT_USER' — nothing was installed."
    fi
    echo "  -> DuckDNS is not configured yet; the timer will stand by until it is."
fi

for f in "$UNIT_NAME.service" "$UNIT_NAME.timer"; do
    install -m 0644 "$STAGE/$f" "$UNIT_DIR/$f"
done

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
