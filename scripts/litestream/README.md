# Litestream

Litestream streams every change to prod's and beta's databases to a B2
bucket about a second after it is written, so losing the VPS loses seconds
rather than everything since the nightly snapshot. The nightly snapshot
(`backup-db.sh`) stays as it is.

The files here are written for Litestream 0.5 (0.5.14 when this was
written). 0.5 gives each database one `replica:` block; the `replicas:`
list is the 0.3 form and is deprecated there. On 0.3.x the same setup reads:

```yaml
dbs:
  - path: /root/justtype/data/justtype.db
    replicas:
      - type: s3
        bucket: justtype-litestream
        path: prod
        endpoint: https://s3.eu-central-003.backblazeb2.com
        region: eu-central-003
        force-path-style: true
        snapshot-interval: 24h
        retention: 168h
```

## Install (as root on the VPS)

1. In B2 (eu-central-003): a bucket for Litestream alone, and an
   application key limited to that bucket with read and write. Litestream
   deletes its own old files to keep to the 7-day retention, so this key
   must not be the backup bucket's key.
2. Install the binary and check it:

   ```sh
   wget https://github.com/benbjohnson/litestream/releases/download/v0.5.14/litestream-0.5.14-linux-x86_64.deb
   dpkg -i litestream-0.5.14-linux-x86_64.deb
   litestream version && command -v litestream   # the unit expects /usr/bin/litestream
   ```

3. Config, key and unit:

   ```sh
   cp /root/justtype/scripts/litestream/litestream.yml.example /etc/litestream.yml
   nano /etc/litestream.yml        # the bucket's name, in both replica blocks
   install -m 600 /dev/null /etc/litestream.env
   nano /etc/litestream.env        # LITESTREAM_ACCESS_KEY_ID=<keyID> and LITESTREAM_SECRET_ACCESS_KEY=<applicationKey>, one per line
   cp /root/justtype/scripts/litestream/litestream.service /etc/systemd/system/litestream.service
   systemctl daemon-reload
   systemctl enable --now litestream
   ```

## Verify

```sh
systemctl status litestream
journalctl -u litestream -n 50 --no-pager
litestream databases
litestream ltx /root/justtype/data/justtype.db     # 0.3: litestream snapshots <db>
```

A test restore to a scratch file, the same one `scripts/restore-drill.sh`
runs every month:

```sh
set -a; . /etc/litestream.env; set +a
litestream restore -o /root/ls-check.db /root/justtype/data/justtype.db
sqlite3 /root/ls-check.db 'PRAGMA integrity_check; SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM slates;'
rm -f /root/ls-check.db /root/ls-check.db-*
```

## Restore for real

Stop the app and Litestream first: nothing may write to the database, and
Litestream must not see its files swapped underneath it.

```sh
. ~/.nvm/nvm.sh && nvm use 20 && pm2 stop justtype
systemctl stop litestream
cd /root/justtype/data
mkdir -p ../backups/before-restore && mv justtype.db justtype.db-wal justtype.db-shm ../backups/before-restore/ 2>/dev/null
set -a; . /etc/litestream.env; set +a
litestream restore /root/justtype/data/justtype.db     # add -timestamp 2026-09-26T10:00:00Z for a point in time
sqlite3 justtype.db 'PRAGMA integrity_check;'
systemctl start litestream
pm2 start justtype
```

Beta is the same with `/root/justtype-beta` and `justtype-beta`.

## What the app must keep doing

`server/database.js` sets `journal_mode=WAL`, `busy_timeout=5000` and
`synchronous=NORMAL`, which is what Litestream needs. SQLite's automatic
checkpoints are fine. The app must not run its own
`PRAGMA wal_checkpoint(TRUNCATE)` (or `RESTART`): it holds writers back
while it waits on Litestream's read lock, and when it does reset the WAL
before Litestream has copied it, Litestream has to start over from a fresh
snapshot. Nothing may
delete or replace the database, `-wal` or `-shm` files while Litestream
runs. `sqlite3 .backup`, which the nightly backup and `prod-backup.sh` use,
only reads and is fine.
