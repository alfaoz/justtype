#!/bin/sh
# Mails the admin when free space on / runs low: once when it drops under
# the threshold, again every 6 hours while it stays there, and once when it
# is back. Meant for root's crontab, every 15 minutes:
#   */15 * * * * /bin/sh /root/justtype/scripts/disk-alert.sh >> /var/log/justtype-disk-alert.log 2>&1
# DISK_ALERT_MIN_GB (default 3) is the threshold in GB. RESEND_API_KEY,
# FROM_EMAIL and ADMIN_EMAIL come from the app's .env.

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
HERE="$(cd "$(dirname "$SELF")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$HERE/.." && pwd)}"
. "$HERE/ops-mail.sh"

MIN_GB="${DISK_ALERT_MIN_GB:-3}"
MOUNT="${DISK_ALERT_MOUNT:-/}"
# The stamp's presence means an alert is standing; its mtime is when the
# last one went out. Touching it needs no free blocks, so it still works on
# a disk that is completely full.
STAMP="${DISK_ALERT_STAMP:-$APP_DIR/backups/.disk-alert}"
HOST="$(hostname)"

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

case "$MIN_GB" in
  ''|*[!0-9.]*) echo "[$(stamp)] DISK_ALERT_MIN_GB must be a number of GB, got '$MIN_GB'" >&2; exit 2 ;;
esac

# df -P gives one line per filesystem in 1K blocks; column 4 is what a
# non-root process can still write, which is what the app has to work with.
AVAIL_KB="$(df -Pk "$MOUNT" 2>/dev/null | awk 'NR == 2 { print $4 }')"
case "$AVAIL_KB" in
  ''|*[!0-9]*) echo "[$(stamp)] could not read free space on $MOUNT" >&2; exit 1 ;;
esac
MIN_KB="$(awk -v g="$MIN_GB" 'BEGIN { printf "%d", g * 1048576 }')"
# Clearing takes half a GB over the threshold, so a disk hovering right at
# it does not send an alert and an all-clear every 15 minutes.
CLEAR_KB=$((MIN_KB + 524288))
FREE="$(awk -v k="$AVAIL_KB" 'BEGIN { printf "%.1f GB", k / 1048576 }')"

mkdir -p "$(dirname "$STAMP")"

if [ "$AVAIL_KB" -lt "$MIN_KB" ]; then
  # Still inside the 6 hours since the last alert: stay quiet.
  if [ -f "$STAMP" ] && [ -z "$(find "$STAMP" -mmin +358 2>/dev/null)" ]; then
    exit 0
  fi
  if send_mail "justtype: $FREE free on $HOST" "Free space on $MOUNT on $HOST is down to $FREE, under the $MIN_GB GB threshold.

$(df -hP "$MOUNT")

This repeats every 6 hours while it stays low, and one mail follows when it recovers."; then
    touch "$STAMP"
    echo "[$(stamp)] alert sent: $FREE free on $MOUNT"
  else
    echo "[$(stamp)] $FREE free on $MOUNT, and the alert could not be sent" >&2
    exit 1
  fi
elif [ -f "$STAMP" ] && [ "$AVAIL_KB" -ge "$CLEAR_KB" ]; then
  if send_mail "justtype: disk space back to normal on $HOST" "Free space on $MOUNT on $HOST is back to $FREE.

$(df -hP "$MOUNT")"; then
    rm -f "$STAMP"
    echo "[$(stamp)] all-clear sent: $FREE free on $MOUNT"
  else
    echo "[$(stamp)] $FREE free on $MOUNT, and the all-clear could not be sent" >&2
    exit 1
  fi
fi

exit 0
