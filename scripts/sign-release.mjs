// Signs a production build manifest with the release key held on the dev
// machine. The VPS never sees the key: it builds, then this script pulls the
// manifest bytes, signs them, and pushes build-manifest.sig back up. Until the
// sig lands, the loader refuses to boot the new release, so run this
// immediately after a prod build.
//
// Release order that keeps the monitor green:
//   1. push master to github (actions rebuilds and publishes hashes + verifier)
//   2. build on the VPS (nvm use 20 first)
//   3. node scripts/sign-release.mjs        <- this, from the Mac
//   4. pm2 restart (with the nvm guard) -- restart AFTER signing so the boot
//      CSP hashes are computed from the new manifest
//   5. node scripts/monitor.mjs             <- post-deploy check
//
// Betas are not signed; the beta loader verifies the manifest without a
// signature, so beta deploys are unchanged.
//
// Usage:
//   node scripts/sign-release.mjs                     sign live prod over ssh
//   node scripts/sign-release.mjs --local dist        sign a local build (testing)
//   options: --key <pem>   (default ~/.config/justtype/manifest-signing-key.pem)
//            --host <ssh>  (default justtype-vps)
//            --path <dir>  (default /root/justtype)

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { createPrivateKey, sign as cryptoSign } from 'crypto';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const keyPath = opt('--key', join(homedir(), '.config', 'justtype', 'manifest-signing-key.pem'));
const localDist = opt('--local', null);
const host = opt('--host', 'justtype-vps');
const remotePath = opt('--path', '/root/justtype');

const key = createPrivateKey(readFileSync(keyPath));

const signBytes = (bytes) =>
  // ieee-p1363 (raw r||s) is what WebCrypto's ECDSA verify expects
  cryptoSign('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }).toString('base64');

if (localDist) {
  const manifestPath = join(localDist, 'build-manifest.json');
  const bytes = readFileSync(manifestPath);
  writeFileSync(join(localDist, 'build-manifest.sig'), signBytes(bytes) + '\n');
  console.log(`signed ${manifestPath} -> ${join(localDist, 'build-manifest.sig')}`);
  process.exit(0);
}

console.log(`fetching ${remotePath}/dist/build-manifest.json from ${host}...`);
const bytes = execFileSync('ssh', [host, `cat ${remotePath}/dist/build-manifest.json`]);
const manifest = JSON.parse(bytes.toString('utf8'));
console.log(`  version ${manifest.version}, ${manifest.files.length} files, built ${manifest.buildDate}`);

const sig = signBytes(bytes);
const tmp = join(tmpdir(), `build-manifest-${Date.now()}.sig`);
writeFileSync(tmp, sig + '\n');
execFileSync('scp', ['-q', tmp, `${host}:${remotePath}/dist/build-manifest.sig`]);
console.log('signature uploaded.');

// post-check: the live pair must validate together (catches a rebuild that
// raced the signing, and a sig that did not land)
const origin = remotePath.includes('beta') ? 'https://beta.justtype.io' : 'https://justtype.io';
const [liveManifest, liveSig] = await Promise.all([
  fetch(`${origin}/build-manifest.json`, { cache: 'no-store' }).then(r => r.arrayBuffer()),
  fetch(`${origin}/build-manifest.sig`, { cache: 'no-store' }).then(r => r.text()),
]);
const { verify: cryptoVerify, createPublicKey } = await import('crypto');
const pub = createPublicKey(key);
const ok = cryptoVerify('sha256', Buffer.from(liveManifest), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(liveSig.trim(), 'base64'));
if (!ok) {
  console.error(`LIVE CHECK FAILED: ${origin}/build-manifest.sig does not validate against the live manifest.`);
  console.error('did the server rebuild after signing? re-run this script.');
  process.exit(1);
}
console.log(`live check ok: ${origin} is serving a validly signed manifest.`);
