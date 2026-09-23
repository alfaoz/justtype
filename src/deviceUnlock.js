// Face id (or touch id) for locked slates, in the iOS shell only. A lock
// always has its pin or passphrase; the phone keeps a copy of it in the
// keychain (ios/App/App/ShellKeychainPlugin.swift), readable only behind
// the owner's face, and types it for them. Nothing here changes what opens a
// slate or what the server sees. In a browser every call is a no-op.
//
// It is one choice per phone (deviceUnlockPref), asked the first time a lock
// is set or opened here and kept in account > security; turning it on takes
// the owner's face. While on, the copy is made whenever the secret is typed
// or set on this phone, and dropped when the lock comes off or the copy stops
// fitting (the secret was changed on another device). Turned off, every copy
// goes.
import { inShell } from './shell';
import { makePref } from './pref';

const cap = inShell ? window.Capacitor : null;
const available = Boolean(cap?.isPluginAvailable?.('ShellKeychain'));
const call = (method, data = {}) => cap.nativePromise('ShellKeychain', method, data);

// Nothing stored yet means never asked on this phone
export const deviceUnlockPref = makePref({ key: 'justtype-device-unlock', values: ['off', 'on'], fallback: 'off' });
const on = () => deviceUnlockPref.get() === 'on';
export const deviceUnlockAsked = () => deviceUnlockPref.stored() !== null;

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
  if (!available || !secret || !on() || (await biometry()) === 'none') return;
  await call('save', { account: account(slateNumber), secret }).catch(() => {});
}

// On, after the owner's face says yes; false when they looked away
export async function turnOnDeviceUnlock(reason) {
  if (!available || (await biometry()) === 'none') return false;
  const ok = await call('confirm', { reason }).then(r => Boolean(r?.ok)).catch(() => false);
  if (ok) deviceUnlockPref.set('on');
  return ok;
}

export async function turnOffDeviceUnlock() {
  deviceUnlockPref.set('off');
  if (available) await call('forgetAll').catch(() => {});
}

export async function hasSecret(slateNumber) {
  if (!available || !on() || (await biometry()) === 'none') return false;
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
