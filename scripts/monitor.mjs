// Integrity monitor for justtype.io, run every ~15 minutes by github actions
// (.github/workflows/monitor-integrity.yml) and by hand after a deploy. It
// checks the production origin from infrastructure justtype's servers do not
// control:
//
//   1. /build-manifest.sig validates against the pinned release key
//   2. index.html (the loader) matches the manifest's indexHtmlHash,
//      and / serves the same bytes as /index.html
//   3. every asset in the manifest hashes to its manifest entry
//   4. the manifest matches what github actions built from the public repo
//      (build-hashes.json on github pages), unless a release is mid-rollout
//   5. the running build appears in the public releases log
//
// Any failure exits non-zero, which fails the workflow run (github emails the
// owner) and opens an integrity-alert issue.
//
// Usage: node scripts/monitor.mjs [--origin https://justtype.io]

import { createHash, createPublicKey, verify as cryptoVerify } from 'crypto';

// pinned release-signing public key (base64 SPKI, P-256). also pinned in
// loader/template.html and verify-page/index.html -- keep all three in sync.
const PUBKEY_B64 = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEy7qq+j94vQ2FgDkQQP/57wfPb/pPpoQmzrgNDQBczCS2e1PCNXWduhcfHLrW15RByVrq3AgdocGUuUIXcBU/ow==';

const PAGES = 'https://alfaoz.github.io/justtype';
// grace window after a release ships before github pages must agree with prod
const SKEW_GRACE_MS = 2 * 60 * 60 * 1000;

const argIdx = process.argv.indexOf('--origin');
const ORIGIN = argIdx === -1 ? 'https://justtype.io' : process.argv[argIdx + 1];

const failures = [];
const notes = [];
const sha256 = (buf) => createHash('sha256').update(Buffer.from(buf)).digest('hex');

const get = async (url, as = 'buffer') => {
  const res = await fetch(url, { cache: 'no-store', redirect: 'manual' });
  if (!res.ok) throw new Error(`${url} -> http ${res.status}`);
  return as === 'text' ? res.text() : res.arrayBuffer();
};

try {
  const manifestBytes = await get(`${ORIGIN}/build-manifest.json`);
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  console.log(`prod manifest: v${manifest.version}, ${manifest.files.length} files, built ${manifest.buildDate}`);

  // 1. signature
  try {
    const sigText = await get(`${ORIGIN}/build-manifest.sig`, 'text');
    const pub = createPublicKey({ key: Buffer.from(PUBKEY_B64, 'base64'), format: 'der', type: 'spki' });
    const ok = cryptoVerify('sha256', Buffer.from(manifestBytes), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sigText.trim(), 'base64'));
    if (ok) console.log('signature: valid');
    else failures.push('manifest signature INVALID against the pinned release key');
  } catch (err) {
    failures.push(`manifest signature missing or unfetchable (${err.message})`);
  }

  // 2. loader
  const [indexHtml, rootHtml] = await Promise.all([get(`${ORIGIN}/index.html`), get(`${ORIGIN}/`)]);
  if (sha256(indexHtml) !== manifest.indexHtmlHash) {
    failures.push(`index.html hash ${sha256(indexHtml).slice(0, 16)}... does not match manifest indexHtmlHash ${String(manifest.indexHtmlHash).slice(0, 16)}...`);
  } else console.log('loader: index.html matches manifest');
  if (manifest.swHash) {
    const sw = await get(`${ORIGIN}/sw.js`);
    if (sha256(sw) !== manifest.swHash) failures.push(`sw.js hash ${sha256(sw).slice(0, 16)}... does not match manifest swHash`);
    else console.log('offline shell: sw.js matches manifest');
  }
  if (!Buffer.from(indexHtml).equals(Buffer.from(rootHtml))) {
    failures.push('/ serves different bytes than /index.html (possible per-path split view)');
  }

  // 3. assets
  for (const f of manifest.files) {
    const got = sha256(await get(`${ORIGIN}/assets/${f.file}`));
    if (got !== f.hash) failures.push(`asset ${f.file}: served ${got.slice(0, 16)}... != manifest ${f.hash.slice(0, 16)}...`);
  }
  if (!failures.some(f => f.startsWith('asset '))) console.log(`assets: all ${manifest.files.length} match the manifest`);

  // 4 + 5. cross-check against what github actions built from the public repo
  const releaseAge = Date.now() - new Date(manifest.buildDate).getTime();
  const inGrace = releaseAge < SKEW_GRACE_MS;
  try {
    const pages = JSON.parse(Buffer.from(await get(`${PAGES}/build-hashes.json`)).toString('utf8'));
    if (pages.version === manifest.version) {
      const pagesByFile = new Map((pages.files || []).map(f => [f.file, f.hash]));
      for (const f of manifest.files) {
        if (pagesByFile.get(f.file) !== f.hash) failures.push(`github actions built a different ${f.file} for v${manifest.version}`);
      }
      if (pagesByFile.size !== manifest.files.length) failures.push(`file count differs from the actions build (${pagesByFile.size} vs ${manifest.files.length})`);
      if (pages.indexHtmlHash && pages.indexHtmlHash !== manifest.indexHtmlHash) failures.push('github actions built a different index.html (loader)');
      if (!failures.some(f => f.includes('github actions'))) console.log(`github build: v${pages.version} agrees with prod`);
    } else if (inGrace) {
      notes.push(`version skew inside grace window: prod v${manifest.version} vs pages v${pages.version} (release ${Math.round(releaseAge / 60000)}m old)`);
    } else {
      failures.push(`prod serves v${manifest.version} but github actions last built v${pages.version}, and the build is ${Math.round(releaseAge / 3600000)}h old -- prod is running code not built from public master`);
    }

    const log = JSON.parse(Buffer.from(await get(`${PAGES}/releases.json`)).toString('utf8'));
    const logged = log.some(e => e.version === manifest.version && e.indexHtmlHash === manifest.indexHtmlHash
      && e.files.length === manifest.files.length && e.files.every((f, i) => f.file === manifest.files[i].file && f.hash === manifest.files[i].hash));
    if (logged) console.log('releases log: this build is publicly logged');
    else if (inGrace) notes.push('build not yet in the releases log (inside grace window)');
    else failures.push(`v${manifest.version} as served is NOT in the public releases log`);
  } catch (err) {
    // pages being down is worth knowing but is not evidence of tampering
    notes.push(`github pages unreachable, cross-check skipped (${err.message})`);
  }
} catch (err) {
  failures.push(`monitor could not complete: ${err.message}`);
}

for (const n of notes) console.log(`note: ${n}`);
if (failures.length) {
  console.error('\nINTEGRITY CHECK FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nall integrity checks passed.');
