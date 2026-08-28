// Uploads the nightly database snapshot to B2 and prunes old offsite copies.
// Invoked by backup-db.sh; reads its inputs from the environment.
const fs = require('fs');
const path = require('path');
const B2 = require('backblaze-b2');

const file = process.env.B2_BACKUP_FILE;
const remoteName = process.env.B2_BACKUP_NAME;
const retainDays = parseInt(process.env.B2_OFFSITE_RETAIN_DAYS || '30', 10);

(async () => {
  if (!file || !fs.existsSync(file)) throw new Error(`backup file missing: ${file}`);

  const b2 = new B2({
    applicationKeyId: process.env.B2_APPLICATION_KEY_ID,
    applicationKey: process.env.B2_APPLICATION_KEY,
  });
  await b2.authorize();

  const data = fs.readFileSync(file);
  const uploadUrl = await b2.getUploadUrl({ bucketId: process.env.B2_BUCKET_ID });
  await b2.uploadFile({
    uploadUrl: uploadUrl.data.uploadUrl,
    uploadAuthToken: uploadUrl.data.authorizationToken,
    fileName: remoteName,
    data,
    mime: 'application/octet-stream',
  });
  console.log(`Offsite: uploaded ${remoteName} (${(data.length / 1024 / 1024).toFixed(2)} MB)`);

  // Offsite retention pruning is intentionally not implemented. If it is ever
  // added, the file listing MUST be scoped to the backups/db/ prefix and every
  // delete guarded by an explicit fileName.startsWith() check; a bucket-wide
  // listing would treat unrelated objects as expired backups.

})().catch((err) => {
  const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
  console.error(`Offsite: ERROR ${detail}`);
  process.exit(1);
});
