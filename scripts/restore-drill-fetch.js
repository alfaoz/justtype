// Downloads the newest nightly database snapshot for scripts/restore-drill.sh,
// from the place scripts/backup-target.js names. It lists only under that
// snapshot prefix and only reads: nothing remote is written, hidden or
// deleted. Usage: node scripts/restore-drill-fetch.js <out-file>
// On success prints "<fileName> <uploadTimestampMs> <bytes>", once the copy
// is on disk and matches the SHA-1 B2 recorded at upload.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const B2 = require('backblaze-b2');
const { backupTarget } = require('./backup-target');

const SNAPSHOT = /^justtype_backup_\d{8}_\d{6}\.db$/;

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error('usage: node scripts/restore-drill-fetch.js <out-file>');

  const target = backupTarget();
  if (!target) throw new Error('no B2 credentials for the backup location');
  if (target.warning) console.error(`warning: ${target.warning}`);

  const b2 = new B2({ applicationKeyId: target.applicationKeyId, applicationKey: target.applicationKey });
  await b2.authorize();

  let newest = null;
  let startFileName;
  do {
    const r = await b2.listFileNames({ bucketId: target.bucketId, prefix: target.prefix, maxFileCount: 1000, startFileName });
    for (const f of r.data.files) {
      if (f.action !== 'upload' || !SNAPSHOT.test(f.fileName.slice(target.prefix.length))) continue;
      if (!newest || f.uploadTimestamp > newest.uploadTimestamp) newest = f;
    }
    startFileName = r.data.nextFileName;
  } while (startFileName);
  if (!newest) throw new Error(`no snapshot under ${target.prefix} in the ${target.label}`);

  const hash = crypto.createHash('sha1');
  let bytes = 0;
  const tally = new Transform({
    transform(chunk, _enc, done) { hash.update(chunk); bytes += chunk.length; done(null, chunk); },
  });
  const r = await b2.downloadFileById({ fileId: newest.fileId, responseType: 'stream' });
  await pipeline(r.data, tally, fs.createWriteStream(out, { flags: 'wx', mode: 0o600 }));

  const want = String(newest.contentSha1 || '').replace(/^unverified:/, '');
  const got = hash.digest('hex');
  if (/^[0-9a-f]{40}$/.test(want) && want !== got) {
    throw new Error(`${newest.fileName} arrived with sha1 ${got}, B2 recorded ${want}`);
  }
  console.log(`${newest.fileName} ${newest.uploadTimestamp} ${bytes}`);
})().catch((err) => {
  // Only B2's own error body or the message: an axios error object carries
  // the request's authorization header and must never be printed whole.
  const data = err.response && err.response.data;
  const detail = data && typeof data === 'object' && typeof data.pipe !== 'function'
    ? JSON.stringify(data)
    : err.message;
  console.error(`error: ${detail}`);
  process.exit(1);
});
