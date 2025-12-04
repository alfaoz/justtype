#!/bin/bash

# JustType Database Backup Script
# Backs up SQLite database daily and keeps 7 days of history

# Configuration
DB_PATH="/root/justtype/data/justtype.db"
BACKUP_DIR="/root/justtype/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/justtype_backup_$TIMESTAMP.db"
LOG_FILE="$BACKUP_DIR/backup.log"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Log backup start
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting database backup..." >> "$LOG_FILE"

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Database not found at $DB_PATH" >> "$LOG_FILE"
    exit 1
fi

# Create backup (using cp - safe for SQLite in WAL mode)
cp "$DB_PATH" "$BACKUP_FILE"

# Check if backup was successful
if [ $? -eq 0 ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS: Backup created - $BACKUP_FILE ($BACKUP_SIZE)" >> "$LOG_FILE"

    # Remove backups older than 7 days
    find "$BACKUP_DIR" -name "justtype_backup_*.db" -mtime +7 -delete

    # Count remaining backups
    BACKUP_COUNT=$(find "$BACKUP_DIR" -name "justtype_backup_*.db" | wc -l)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backups retained: $BACKUP_COUNT" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Backup failed" >> "$LOG_FILE"
    exit 1
fi

exit 0
