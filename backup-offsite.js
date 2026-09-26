// Uploads the nightly database snapshot to B2, to the place
// scripts/backup-target.js names: the separate backup bucket once its keys
// are set, the app's bucket until then. Invoked by backup-db.sh; reads its
// inputs from the environment.
const fs = require('fs');
const path = require('path');
const B2 = require('backblaze-b2');
const { backupTarget } = require('./scripts/backup-target');

const file = process.env.B2_BACKUP_FILE;
const retainDays = parseInt(process.env.B2_OFFSITE_RETAIN_DAYS || '30', 10);

(async () => {
  if (!file || !fs.existsSync(file)) throw new Error(`backup file missing: ${file}`);

  const target = backupTarget();
  if (!target) throw new Error('no B2 credentials for the offsite copy');
  if (target.warning) console.log(`Offsite: WARNING ${target.warning}`);
  // Same name as the local copy: db/justtype_backup_<ts>.db in the backup
  // bucket, backups/db/justtype_backup_<ts>.db in the app bucket.
  const remoteName = `${target.prefix}${path.basename(file)}`;

  const b2 = new B2({
    applicationKeyId: target.applicationKeyId,
    applicationKey: target.applicationKey,
  });
  await b2.authorize();

  const data = fs.readFileSync(file);
  const uploadUrl = await b2.getUploadUrl({ bucketId: target.bucketId });
  await b2.uploadFile({
    uploadUrl: uploadUrl.data.uploadUrl,
    uploadAuthToken: uploadUrl.data.authorizationToken,
    fileName: remoteName,
    data,
    mime: 'application/octet-stream',
  });
  console.log(`Offsite: uploaded ${remoteName} to the ${target.label} (${(data.length / 1024 / 1024).toFixed(2)} MB)`);

  // Offsite retention pruning is intentionally not implemented. If it is ever
  // added, the file listing MUST be scoped to the backups/db/ prefix (db/ in
  // the backup bucket) and every delete guarded by an explicit
  // fileName.startsWith() check; a bucket-wide listing would treat unrelated
  // objects as expired backups. The backup bucket is pruned by its own
  // lifecycle rule instead, and its key should not be able to delete.

})().catch((err) => {
  const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
  console.error(`Offsite: ERROR ${detail}`);
  process.exit(1);
});
