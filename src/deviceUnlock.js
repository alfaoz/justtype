// Face id (or touch id) for locked slates, in the iOS shell only. A lock
// always has its pin or passphrase; the phone keeps a copy of it in the
// keychain (ios/App/App/ShellKeychainPlugin.swift), readable only behind
// the owner's face, and types it for them. Nothing here changes what opens a
// slate or what the server sees. In a browser every call is a no-op.
//
// The copy is made whenever the secret is typed or set on this phone, and
// dropped when the lock comes off or the copy stops fitting (the secret was
// changed on another device).
import { inShell } from './shell';

const cap = inShell ? window.Capacitor : null;
const available = Boolean(cap?.isPluginAvailable?.('ShellKeychain'));
const call = (method, data = {}) => cap.nativePromise('ShellKeychain', method, data);

// One copy per account and slate, so two accounts on one phone never mix
const account = (slateNumber) => `${localStorage.getItem('justtype-username') || ''}:${slateNumber}`;

let kind = null;
// 'face', 'touch', or 'none' (no biometrics set up, or not the app)
export function biometry() {
  if (!available) return Promise.resolve('none');
  if (!kind) kind = call('biometry').then(r => r?.kind || 'none').catch(() => 'none');
  return kind;
}

export async function rememberSecret(slateNumber, secret) {
  if (!available || !secret || (await biometry()) === 'none') return;
  await call('save', { account: account(slateNumber), secret }).catch(() => {});
}

export async function hasSecret(slateNumber) {
  if (!available || (await biometry()) === 'none') return false;
  return call('has', { account: account(slateNumber) }).then(r => Boolean(r?.has)).catch(() => false);
}

// The secret, after the phone has seen the owner's face; null when they
// looked away or cancelled
export async function readSecret(slateNumber, reason) {
  if (!available) return null;
  return call('read', { account: account(slateNumber), reason }).then(r => r?.secret || null).catch(() => null);
}

export function forgetSecret(slateNumber) {
  if (!available) return Promise.resolve();
  return call('forget', { account: account(slateNumber) }).catch(() => {});
}
