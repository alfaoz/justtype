#!/bin/sh
# Rotates the admin console secret once a day: a fresh ADMIN_SECRET in the
# app's .env, the running app told to read it again with SIGHUP instead of
# a restart, and the new secret mailed to ADMIN_EMAIL through Resend. The
# secret itself never goes to stdout, a log or a command line.
# Installed in place of the old /root/admin-token-rotator.sh as a symlink,
# so the existing cron line keeps working:
#   ln -sf /root/justtype/scripts/admin-token-rotator.sh /root/admin-token-rotator.sh
# Plain POSIX sh, so it runs the same however that cron line calls it.
# APP_DIR (default: the app this script lives in) and PM2_APP (default:
# justtype) override.

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
HERE="$(cd "$(dirname "$SELF")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$HERE/.." && pwd)}"
. "$HERE/ops-mail.sh"

ENV_FILE="$APP_DIR/.env"
APP_NAME="${PM2_APP:-justtype}"
umask 077

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

[ -f "$ENV_FILE" ] || { log "no .env at $ENV_FILE; nothing rotated"; exit 1; }

NEW_SECRET="$(openssl rand -hex 32 2>/dev/null)"
case "$NEW_SECRET" in
    *[!0-9a-f]*|'') NEW_SECRET="" ;;
esac
if [ "${#NEW_SECRET}" -ne 64 ]; then
    log "could not generate a new secret; nothing rotated"
    exit 1
fi

# The new .env is written beside the old one and renamed over it, so a
# crash midway never leaves the app a half-written .env. cp -p carries the
# owner and mode across. The secret reaches awk through its environment,
# not its arguments, so it never shows in ps. Every ADMIN_SECRET line
# collapses into one; every other line stays as it was.
TMP_ENV="$(mktemp "$APP_DIR/.env.rotate.XXXXXX")" || exit 1
trap 'rm -f "$TMP_ENV"' EXIT
cp -p "$ENV_FILE" "$TMP_ENV"
TAB="$(printf '\t')"
SECRET_LINE="^[ $TAB]*(export[ $TAB]+)?ADMIN_SECRET[ $TAB]*="
NEW_SECRET="$NEW_SECRET" awk -v re="$SECRET_LINE" '
    $0 ~ re { if (!done) print "ADMIN_SECRET=" ENVIRON["NEW_SECRET"]; done = 1; next }
    { print }
    END { if (!done) print "ADMIN_SECRET=" ENVIRON["NEW_SECRET"] }
' "$ENV_FILE" > "$TMP_ENV"

KEPT_BEFORE="$(grep -Evc "$SECRET_LINE" "$ENV_FILE")"
KEPT_AFTER="$(grep -Evc "$SECRET_LINE" "$TMP_ENV")"
if [ "$KEPT_BEFORE" != "$KEPT_AFTER" ] || [ "$(grep -Ec "$SECRET_LINE" "$TMP_ENV")" != 1 ]; then
    log "the rewritten .env does not match the old one line for line; nothing rotated"
    exit 1
fi
mv -f "$TMP_ENV" "$ENV_FILE" || { log "could not replace $ENV_FILE; nothing rotated"; exit 1; }
log "ADMIN_SECRET rotated in $ENV_FILE"

# pm2 and the node it runs come from nvm; a restart with --update-env under
# the system node is the crash loop from 2026-08-14.
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 && nvm use 20 >/dev/null 2>&1

# The app reads the new secret on SIGHUP only once its handler is deployed;
# before that Node's default for SIGHUP is to exit. So the signal goes only
# to a process that catches it (bit 0 of SigCgt in /proc), and otherwise
# the app restarts as the old rotator did, which reads .env at startup.
catches_hup() {
    _found=0
    for _pid in $(pm2 pid "$APP_NAME" 2>/dev/null); do
        case "$_pid" in ''|0|*[!0-9]*) continue ;; esac
        _mask="$(awk '/^SigCgt:/ { print $2 }' "/proc/$_pid/status" 2>/dev/null)"
        case "$_mask" in ''|*[!0-9a-fA-F]*) return 1 ;; esac
        [ $(( 0x${_mask#"${_mask%?}"} & 1 )) -eq 1 ] || return 1
        _found=1
    done
    [ "$_found" = 1 ]
}

RELOADED=""
if ! command -v pm2 >/dev/null 2>&1; then
    log "pm2 not found; the app keeps the old secret until it next starts"
elif catches_hup; then
    if pm2 sendSignal SIGHUP "$APP_NAME" >/dev/null 2>&1; then
        RELOADED="read again by the running app (SIGHUP)"
    else
        log "pm2 sendSignal SIGHUP $APP_NAME failed; the app keeps the old secret until it next starts"
    fi
elif pm2 restart "$APP_NAME" --update-env >/dev/null 2>&1; then
    RELOADED="picked up by a restart (the app does not handle SIGHUP yet)"
else
    log "pm2 restart $APP_NAME failed; the app keeps the old secret until it next starts"
fi
[ -n "$RELOADED" ] && log "new secret $RELOADED"

NOTE="Live now: $RELOADED."
[ -z "$RELOADED" ] && NOTE="The app could not be told to reload, so the old secret stays live until it next starts."
if send_mail "justtype admin secret rotated" "The admin console secret on $(hostname) was rotated.

New secret: $NEW_SECRET

$NOTE
Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"; then
    log "new secret mailed"
else
    log "the new secret could not be mailed; it is in $ENV_FILE"
    exit 1
fi
[ -n "$RELOADED" ] || exit 1
exit 0
