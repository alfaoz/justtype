#!/bin/bash
# Monthly restore drill. Fetches the newest nightly database snapshot from
# offsite (scripts/restore-drill-fetch.js) and, when Litestream is set up,
# restores its replica too; checks that each copy passes SQLite's integrity
# check, holds at least 90% of the live users and slates, and (for the
# snapshot) is under 36 hours old. One line per run goes to the log; a mail
# goes out only when something is wrong. Nothing remote is changed, and the
# restored copies are deleted when it ends. For root's crontab, early on the
# 3rd of each month, after that night's backup:
#   40 4 3 * * /bin/bash /root/justtype/scripts/restore-drill.sh
# Overrides: JUSTTYPE_DB_PATH, RESTORE_DRILL_LOG, RESTORE_DRILL_MAX_AGE_H,
# RESTORE_DRILL_MIN_PCT, RESTORE_DRILL_LITESTREAM_CONFIG, RESTORE_DRILL_LITESTREAM_ENV.

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
HERE="$(cd "$(dirname "$SELF")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$HERE/.." && pwd)}"
. "$HERE/ops-mail.sh"

DB_PATH="${JUSTTYPE_DB_PATH:-$APP_DIR/data/justtype.db}"
LOG_FILE="${RESTORE_DRILL_LOG:-$APP_DIR/backups/restore-drill.log}"
MAX_AGE_H="${RESTORE_DRILL_MAX_AGE_H:-36}"
MIN_PCT="${RESTORE_DRILL_MIN_PCT:-90}"
LITESTREAM_CONFIG="${RESTORE_DRILL_LITESTREAM_CONFIG:-/etc/litestream.yml}"
LITESTREAM_ENV="${RESTORE_DRILL_LITESTREAM_ENV:-/etc/litestream.env}"
COUNTS_SQL="SELECT (SELECT COUNT(*) FROM users) || ' ' || (SELECT COUNT(*) FROM slates);"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/justtype-drill.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT
trap 'exit 1' INT TERM HUP

PROBLEMS=()
REPORT=()
problem() { PROBLEMS+=("$1"); }
joined() { local out="" item; for item in "$@"; do out+="${out:+; }$item"; done; printf '%s' "$out"; }

# check_copy LABEL FILE: integrity, then users and slates against live.
check_copy() {
    local label="$1" file="$2" ok counts users slates
    ok="$(sqlite3 "$file" 'PRAGMA integrity_check;' 2>&1 | head -n 5 | tr '\n' ' ' | sed 's/ *$//')"
    if [ "$ok" != "ok" ]; then
        problem "$label fails the integrity check: $ok"
        REPORT+=("$label integrity FAILED")
        return
    fi
    counts="$(sqlite3 "$file" "$COUNTS_SQL" 2>/dev/null)"
    read -r users slates <<< "$counts"
    if ! [[ "$users" =~ ^[0-9]+$ && "$slates" =~ ^[0-9]+$ ]]; then
        problem "$label opens but its users and slates could not be counted"
        REPORT+=("$label integrity ok, counts unreadable")
        return
    fi
    REPORT+=("$label integrity ok, users $users/${LIVE_USERS:-?}, slates $slates/${LIVE_SLATES:-?}")
    if [ -n "$LIVE_USERS" ]; then
        [ $((users * 100)) -lt $((LIVE_USERS * MIN_PCT)) ] && problem "$label has $users users, live has $LIVE_USERS"
        [ $((slates * 100)) -lt $((LIVE_SLATES * MIN_PCT)) ] && problem "$label has $slates slates, live has $LIVE_SLATES"
    fi
}

# Live counts, read only, waiting out a writer rather than failing on it.
LIVE_USERS=""
LIVE_SLATES=""
if [ -f "$DB_PATH" ]; then
    read -r LIVE_USERS LIVE_SLATES <<< "$(sqlite3 -readonly -cmd '.timeout 5000' "$DB_PATH" "$COUNTS_SQL" 2>/dev/null)"
fi
if ! [[ "$LIVE_USERS" =~ ^[0-9]+$ && "$LIVE_SLATES" =~ ^[0-9]+$ ]]; then
    problem "could not count users and slates in the live database at $DB_PATH"
    LIVE_USERS=""
    LIVE_SLATES=""
fi

# The newest nightly snapshot, from offsite.
FETCH_OUT="$( ([ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 && nvm use 20 >/dev/null 2>&1; \
    node "$HERE/restore-drill-fetch.js" "$TMP/snapshot.db") 2>"$TMP/fetch.err")"
FETCH_RC=$?
while IFS= read -r line; do
    case "$line" in warning:*) problem "offsite ${line#warning: }" ;; esac
done < "$TMP/fetch.err"
if [ $FETCH_RC -ne 0 ] || [ ! -s "$TMP/snapshot.db" ]; then
    problem "offsite snapshot could not be fetched: $(grep -v '^warning:' "$TMP/fetch.err" | tail -n 3 | tr '\n' ' ')"
    REPORT+=("offsite fetch FAILED")
else
    read -r SNAP_NAME SNAP_MS SNAP_BYTES <<< "$(printf '%s\n' "$FETCH_OUT" | tail -n 1)"
    if [[ "$SNAP_MS" =~ ^[0-9]+$ ]]; then
        AGE_S=$(( $(date +%s) - SNAP_MS / 1000 ))
        AGE_H="$(awk -v s="$AGE_S" 'BEGIN { printf "%.1f", s / 3600 }')"
        REPORT+=("offsite $SNAP_NAME ${AGE_H}h old, $SNAP_BYTES bytes")
        [ "$AGE_S" -gt $((MAX_AGE_H * 3600)) ] && problem "the newest offsite snapshot $SNAP_NAME is ${AGE_H}h old"
    else
        problem "the offsite fetch did not say which snapshot it got"
    fi
    check_copy "offsite snapshot" "$TMP/snapshot.db"
fi

# The Litestream replica, when Litestream runs here. Its credentials go to
# litestream through its environment, read from the root-only file the
# service uses, never through the command line or this log.
if command -v litestream >/dev/null 2>&1 && [ -f "$LITESTREAM_CONFIG" ]; then
    if (
        export LITESTREAM_ACCESS_KEY_ID="$(env_get LITESTREAM_ACCESS_KEY_ID "$LITESTREAM_ENV")"
        export LITESTREAM_SECRET_ACCESS_KEY="$(env_get LITESTREAM_SECRET_ACCESS_KEY "$LITESTREAM_ENV")"
        litestream restore -config "$LITESTREAM_CONFIG" -o "$TMP/litestream.db" "$DB_PATH"
    ) >"$TMP/litestream.out" 2>&1 && [ -s "$TMP/litestream.db" ]; then
        check_copy "litestream" "$TMP/litestream.db"
    else
        problem "litestream restore failed: $(tail -n 3 "$TMP/litestream.out" | tr '\n' ' ')"
        REPORT+=("litestream restore FAILED")
    fi
fi

STATUS=OK
[ ${#PROBLEMS[@]} -gt 0 ] && STATUS=FAIL
LINE="$STATUS $(joined "${REPORT[@]}")"
[ ${#PROBLEMS[@]} -gt 0 ] && LINE="$LINE | problems: $(joined "${PROBLEMS[@]}")"
mkdir -p "$(dirname "$LOG_FILE")"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] $LINE" | tee -a "$LOG_FILE"

if [ "$STATUS" != OK ]; then
    send_mail "justtype: restore drill failed on $(hostname)" "The monthly restore drill found a problem with the backups of $DB_PATH:

$(printf -- '- %s\n' "${PROBLEMS[@]}")

Checked: $(joined "${REPORT[@]}")

Log: $LOG_FILE" || echo "the failure mail could not be sent" >&2
    exit 1
fi
exit 0
