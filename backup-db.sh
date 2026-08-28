#!/bin/bash

# JustType Database Backup Script
# Takes a consistent local snapshot daily (7 days retained) and pushes it
# offsite to B2, so a lost VPS does not take the backups with it.

# Configuration (defaults resolve relative to the app directory this script
# lives in; override via environment)
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="${JUSTTYPE_DB_PATH:-$APP_DIR/data/justtype.db}"
BACKUP_DIR="${JUSTTYPE_BACKUP_DIR:-$APP_DIR/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/justtype_backup_$TIMESTAMP.db"
LOG_FILE="$BACKUP_DIR/backup.log"
OFFSITE_RETAIN_DAYS=30

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"; }

mkdir -p "$BACKUP_DIR"
log "Starting database backup..."

if [ ! -f "$DB_PATH" ]; then
    log "ERROR: Database not found at $DB_PATH"
    exit 1
fi

# sqlite3 .backup takes a crash-consistent snapshot of a live database.
# Plain cp can capture a torn mid-write file, and in WAL mode it also misses
# any committed pages still sitting in the -wal sidecar.
if ! sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'" 2>>"$LOG_FILE"; then
    log "ERROR: Backup failed"
    exit 1
fi

# Verify the snapshot actually opens and passes SQLite's own integrity check
# before it is trusted or uploaded. A backup nobody has verified is a guess.
INTEGRITY=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>>"$LOG_FILE")
if [ "$INTEGRITY" != "ok" ]; then
    log "ERROR: Integrity check failed on $BACKUP_FILE: $INTEGRITY"
    exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "SUCCESS: Backup created - $BACKUP_FILE ($BACKUP_SIZE, integrity ok)"

# Prune local copies (7 days)
find "$BACKUP_DIR" -name "justtype_backup_*.db" -mtime +7 -delete
log "Backups retained locally: $(find "$BACKUP_DIR" -name 'justtype_backup_*.db' | wc -l)"

# Push offsite to B2. Local backups live on the same disk as the database, so
# they are worthless if the VPS is lost; this copy is the one that survives.
if [ -f "$APP_DIR/.env" ]; then
    set -a; . "$APP_DIR/.env"; set +a
fi

if [ -n "$B2_APPLICATION_KEY_ID" ] && [ -n "$B2_APPLICATION_KEY" ]; then
    export B2_BACKUP_FILE="$BACKUP_FILE"
    export B2_BACKUP_NAME="backups/db/justtype_backup_$TIMESTAMP.db"
    export B2_OFFSITE_RETAIN_DAYS="$OFFSITE_RETAIN_DAYS"
    OFFSITE_OUT=$([ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 && nvm use 20 >/dev/null 2>&1; \
        node "$APP_DIR/backup-offsite.js" 2>&1)
    OFFSITE_RC=$?
    while IFS= read -r line; do [ -n "$line" ] && log "$line"; done <<< "$OFFSITE_OUT"
    if [ $OFFSITE_RC -ne 0 ]; then
        log "WARNING: offsite upload failed (local backup is still good)"
    fi
else
    log "WARNING: B2 credentials not found; skipped offsite upload"
fi

exit 0
