// Slate locks: a second secret for private notes.
//
// A locked slate keeps its content under its own doc key, wrapped to the
// account's lock key. The lock key is wrapped to a key derived from a pin or
// passphrase; that wrapped form lives on the server, the secret and the
// unwrapped lock key never leave the device, and the unwrapped key lives only
// in this module's memory. Unlike the master key it is never written to
// IndexedDB: a device that holds the account still needs the secret. It is
// forgotten after a stretch of no activity, and on logout.
import { API_URL } from './config';
import { deriveKey, generateSalt, generateSlateKey, wrapKey, unwrapKey } from './crypto';

export const MIN_SECRET_LENGTH = 4;
const IDLE_MS = 5 * 60 * 1000;
const TOUCH_EVERY_MS = 20 * 1000;

let lockKey = null;
let idleTimer = null;
let lastTouch = 0;
const listeners = new Set();

const emit = () => { for (const l of listeners) l(!!lockKey); };

export const isUnlocked = () => !!lockKey;

export function onLockChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Forget the lock key: locked slates ask for the secret again
export function relock() {
  clearTimeout(idleTimer);
  idleTimer = null;
  if (!lockKey) return;
  lockKey = null;
  emit();
}

// Activity keeps the key; silence lets it go
export function touchLock() {
  if (!lockKey) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(relock, IDLE_MS);
}

if (typeof window !== 'undefined') {
  const onActivity = () => {
    const now = Date.now();
    if (now - lastTouch < TOUCH_EVERY_MS) return;
    lastTouch = now;
    touchLock();
  };
  for (const ev of ['keydown', 'pointerdown', 'pointermove', 'wheel']) {
    window.addEventListener(ev, onActivity, { passive: true });
  }
}

export const normalizeSecret = (s) => (s || '').trim();

export async function fetchLockData() {
  const res = await fetch(`${API_URL}/account/lock`, { credentials: 'include' });
  if (!res.ok) throw new Error('lock data unavailable');
  return res.json();
}

// First lock on the account: a fresh lock key, wrapped to the secret
export async function setupLock(secret) {
  const key = await generateSlateKey();
  const salt = generateSalt();
  const wrapping = await deriveKey(secret, salt, { pin: true });
  const wrapped = await wrapKey(key, wrapping);
  const res = await fetch(`${API_URL}/account/lock`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ lockSalt: salt, lockWrappedKey: wrapped }),
  });
  if (!res.ok) throw new Error('lock setup failed');
  lockKey = key;
  touchLock();
  emit();
}

// Open the lock with the secret. Throws 'wrong' when the unwrap fails.
export async function unlock(secret, data = null) {
  const d = data || await fetchLockData();
  if (!d.hasLock) throw new Error('no lock');
  const wrapping = await deriveKey(secret, d.lockSalt, { pin: true });
  let key;
  try {
    key = await unwrapKey(d.lockWrappedKey, wrapping);
  } catch {
    throw new Error('wrong');
  }
  lockKey = key;
  touchLock();
  emit();
}

export async function wrapDocKey(docKey) {
  if (!lockKey) throw new Error('locked');
  return wrapKey(docKey, lockKey);
}

// The doc key of a locked slate, or null while the lock is closed
export async function unwrapDocKey(wrapped) {
  if (!lockKey || !wrapped) return null;
  try {
    return await unwrapKey(wrapped, lockKey);
  } catch {
    return null;
  }
}
