// Where the nightly database snapshots live offsite. backup-offsite.js
// writes them there and scripts/restore-drill-fetch.js reads the newest one
// back, so both take the place from here and can never disagree.
//
// Once B2_BACKUP_KEY_ID, B2_BACKUP_KEY and B2_BACKUP_BUCKET_ID are set, that
// is the separate backup bucket under db/, reached with its own key; the
// bucket's lifecycle rule does the pruning. Until then it stays the app's
// bucket under backups/db/, as before, so nothing breaks while the new
// bucket and key do not exist yet.
const BACKUP_VARS = ['B2_BACKUP_KEY_ID', 'B2_BACKUP_KEY', 'B2_BACKUP_BUCKET_ID'];

function backupTarget(env = process.env) {
  const missing = BACKUP_VARS.filter((k) => !env[k]);
  if (missing.length === 0) {
    return {
      label: `backup bucket ${env.B2_BACKUP_BUCKET_NAME || env.B2_BACKUP_BUCKET_ID}`,
      applicationKeyId: env.B2_BACKUP_KEY_ID,
      applicationKey: env.B2_BACKUP_KEY,
      bucketId: env.B2_BACKUP_BUCKET_ID,
      prefix: 'db/',
    };
  }
  if (!env.B2_APPLICATION_KEY_ID || !env.B2_APPLICATION_KEY || !env.B2_BUCKET_ID) return null;
  return {
    label: 'app bucket',
    applicationKeyId: env.B2_APPLICATION_KEY_ID,
    applicationKey: env.B2_APPLICATION_KEY,
    bucketId: env.B2_BUCKET_ID,
    prefix: 'backups/db/',
    // Half a backup bucket setup is a mistake worth hearing about, but the
    // snapshot still goes offsite to the old place rather than nowhere.
    warning: missing.length < BACKUP_VARS.length
      ? `${missing.join(', ')} not set, so the snapshot goes to the app bucket as before`
      : null,
  };
}

module.exports = { backupTarget };
