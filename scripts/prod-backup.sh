#!/bin/sh
# The backup a prod deploy needs, taken on the VPS from the app root:
# a database snapshot (checked), a copy of .env, and every live slate file
# out of B2, all under backups/, read only on the source side. Writes the
# marker backups/.last-prod-backup that the push gate and the signer look
# for. Usage: sh scripts/prod-backup.sh [label]   (label defaults to pre)
set -e
cd "$(dirname "$0")/.."
LABEL="${1:-pre}"
STAMP="$(date -u +%Y%m%d_%H%M%S)"
mkdir -p backups
DB="backups/${LABEL}_${STAMP}.db"
sqlite3 data/justtype.db ".backup '$DB'"
OK="$(sqlite3 "$DB" 'PRAGMA integrity_check')"
[ "$OK" = "ok" ] || { echo "backup integrity check failed: $OK" >&2; exit 1; }
cp .env "backups/${LABEL}_${STAMP}.env"
chmod 400 "$DB" "backups/${LABEL}_${STAMP}.env"
SHA="$(sha256sum "$DB" | cut -c1-16)"
B2="$(node scripts/b2-mirror.js)"
DIR="$(echo "$B2" | sed 's/:.*//')"
tar -czf "$DIR.tgz" -C backups "$(basename "$DIR")" && rm -rf "$DIR" && chmod 400 "$DIR.tgz"
echo "$(date -u +%s) $DB $SHA $DIR.tgz" > backups/.last-prod-backup
echo "db $DB (sha $SHA, users $(sqlite3 "$DB" 'select count(*) from users'), slates $(sqlite3 "$DB" 'select count(*) from slates'))"
echo "b2 $B2 -> $DIR.tgz"
