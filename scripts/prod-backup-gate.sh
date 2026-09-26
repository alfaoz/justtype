#!/bin/sh
# Refuses unless scripts/prod-backup.sh ran in the last 45 minutes and its
# snapshot is still there. Called by the prod repo's pre-push hook for
# master and by scripts/sign-release.mjs before it signs live prod.
cd "$(dirname "$0")/.."
M=backups/.last-prod-backup
[ -f "$M" ] || { echo "no prod backup on record: run sh scripts/prod-backup.sh first" >&2; exit 1; }
read -r AT DB SHA B2 < "$M"
NOW="$(date -u +%s)"
AGE=$(( (NOW - AT) / 60 ))
[ "$AGE" -le 45 ] || { echo "the last prod backup is ${AGE} minutes old ($DB): run sh scripts/prod-backup.sh again" >&2; exit 1; }
[ -f "$DB" ] || { echo "the recorded backup $DB is gone: run sh scripts/prod-backup.sh again" >&2; exit 1; }
echo "prod backup ${AGE} min old: $DB ($SHA), $B2"
