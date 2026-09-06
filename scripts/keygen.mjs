// Generates the P-256 release-signing keypair for the verified bootstrap.
//
// Run ONCE on the dev machine (never on the VPS -- the whole point is that the
// server cannot sign releases). Prints the base64 SPKI public key, which is
// pinned in three places (keep them in sync):
//   loader/template.html          (the loader served as index.html)
//   verify-page/index.html        (the github-pages verifier)
//   scripts/monitor.mjs           (the actions integrity monitor)
//
// Rotating the key = rerun this, update the three pins, ship a release.
// Losing the key = prod deploys are blocked until the pins are rotated, so
// keep an offline copy somewhere safe.
//
// Usage: node scripts/keygen.mjs [output-path]
//        default output: ~/.config/justtype/manifest-signing-key.pem

import { generateKeyPairSync } from 'crypto';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const out = process.argv[2] || join(homedir(), '.config', 'justtype', 'manifest-signing-key.pem');

if (existsSync(out)) {
  console.error(`refusing to overwrite existing key at ${out}`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

console.log(`private key written to ${out}`);
console.log('');
console.log('public key (base64 SPKI) -- pin this in loader/template.html,');
console.log('verify-page/index.html and scripts/monitor.mjs:');
console.log('');
console.log(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
