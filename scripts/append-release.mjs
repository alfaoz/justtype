// Appends the current build to the public releases log, published to github
// pages by .github/workflows/publish-hashes.yml. The log is append-only in
// practice: each actions run fetches the live log, adds the new build if its
// hash set is not already present, and republishes. Together with the
// integrity monitor (which requires the served build to appear here) it makes
// serving an unlogged build to anyone a detectable event.
//
// Usage: node scripts/append-release.mjs <manifest> <existing-log> <out>

import { readFileSync, writeFileSync } from 'fs';

const [manifestPath, logPath, outPath] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

let log;
try {
  log = JSON.parse(readFileSync(logPath, 'utf8'));
  if (!Array.isArray(log)) log = [];
} catch {
  log = [];
}

const exists = log.some(e => e.version === manifest.version && e.indexHtmlHash === manifest.indexHtmlHash
  && e.files.length === manifest.files.length && e.files.every((f, i) => f.file === manifest.files[i].file && f.hash === manifest.files[i].hash));

if (!exists) {
  log.push({
    version: manifest.version,
    commit: process.env.GITHUB_SHA || 'unknown',
    date: new Date().toISOString(),
    indexHtmlHash: manifest.indexHtmlHash,
    files: manifest.files,
  });
  console.log(`releases log: appended v${manifest.version} (${log.length} entries)`);
} else {
  console.log(`releases log: v${manifest.version} already present (${log.length} entries)`);
}

writeFileSync(outPath, JSON.stringify(log, null, 2));
