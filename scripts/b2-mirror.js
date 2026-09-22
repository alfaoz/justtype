// Copies every live prod slate file out of B2 into a dated folder: names,
// ids and bytes, read only, nothing on B2 is touched. Run from the app root
// before a prod deploy: `node scripts/b2-mirror.js`, then keep a copy off
// the VPS.
require('dotenv').config();
process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const B2 = require('backblaze-b2');
(async () => {
  const b2 = new B2({ applicationKeyId: process.env.B2_APPLICATION_KEY_ID, applicationKey: process.env.B2_APPLICATION_KEY });
  await b2.authorize();
  const bucketId = process.env.B2_BUCKET_ID;
  const prefix = `${process.env.B2_PREFIX || ''}slates/`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const dir = path.join('backups', `b2-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  let startFileName;
  do {
    const r = await b2.listFileNames({ bucketId, prefix, maxFileCount: 1000, startFileName });
    files.push(...r.data.files);
    startFileName = r.data.nextFileName;
  } while (startFileName);
  let bytes = 0;
  const manifest = [];
  // A file deleted between the listing and its download is noted and
  // skipped: one object going is not a reason to have no backup
  const missing = [];
  for (const f of files) {
    let buf;
    try {
      const r = await b2.downloadFileById({ fileId: f.fileId, responseType: 'arraybuffer' });
      buf = Buffer.from(r.data);
    } catch (e) {
      missing.push({ fileName: f.fileName, fileId: f.fileId, why: e.response?.status || e.message });
      continue;
    }
    const out = path.join(dir, f.fileName.replace(/\//g, '__'));
    fs.writeFileSync(out, buf);
    bytes += buf.length;
    manifest.push({ fileName: f.fileName, fileId: f.fileId, size: buf.length, sha1: crypto.createHash('sha1').update(buf).digest('hex'), uploadTimestamp: f.uploadTimestamp });
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ takenAt: new Date().toISOString(), prefix, count: manifest.length, bytes, missing, files: manifest }, null, 2));
  console.log(`${dir}: ${manifest.length} files, ${bytes} bytes${missing.length ? `, ${missing.length} gone while copying` : ''}`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
