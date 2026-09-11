// Slate locks: a second secret for private notes, one per slate.
//
// A locked slate keeps its content under its own doc key. That key is wrapped
// to a key derived from the slate's pin or passphrase (a salt per slate), and
// wrapped again to the account's lock-recovery public key, whose private key
// is wrapped to the key the 12-word recovery phrase derives. The server holds
// ciphertext and public keys only. The title stays under the master key so
// the list and title search keep reading.
//
// Opened doc keys live only in this module's memory, never in IndexedDB: a
// device that holds the account still needs the secret. They are forgotten
// after a stretch of no activity, when the writer moves to another slate,
// and on logout.
import { API_URL } from './config';
import {
  deriveKey, generateSalt, generateSlateKey, wrapKey, unwrapKey, encryptContent, encryptTitle,
  generateUserKeypair, importAppPublicKey, wrapKeyToAppKey, unwrapKeyRsa,
} from './crypto';
import { cacheSlate } from './offlineStore';

export const MIN_SECRET_LENGTH = 4;
const IDLE_MS = 5 * 60 * 1000;
const TOUCH_EVERY_MS = 20 * 1000;

const openKeys = new Map(); // slateNumber -> doc key bytes
let idleTimer = null;
let lastTouch = 0;
const listeners = new Set();

// Events: { type: 'open' | 'close' | 'locked' | 'unlocked', slateNumber, ... }
const emit = (event) => { for (const l of listeners) l(event); };

export const openDocKey = (slateNumber) => openKeys.get(String(slateNumber)) || null;
export const isOpen = (slateNumber) => openKeys.has(String(slateNumber));
export const anyOpen = () => openKeys.size > 0;

export function onLockChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function hold(slateNumber, docKey) {
  openKeys.set(String(slateNumber), docKey);
  touchLock();
  emit({ type: 'open', slateNumber });
}

// Forget one slate's doc key: it asks for its secret again
export function forgetDocKey(slateNumber) {
  if (!openKeys.delete(String(slateNumber))) return;
  emit({ type: 'close', slateNumber });
}

// Forget every open doc key (idle, logout, moving to another slate)
export function relock() {
  clearTimeout(idleTimer);
  idleTimer = null;
  if (!openKeys.size) return;
  const numbers = [...openKeys.keys()];
  openKeys.clear();
  for (const n of numbers) emit({ type: 'close', slateNumber: n });
}

// Activity keeps the keys; silence lets them go
export function touchLock() {
  if (!openKeys.size) return;
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
export const normalizePhrase = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

const lockKeyFor = (secret, salt) => deriveKey(secret, salt, { pin: true });

// Open a locked slate with its secret. Throws 'wrong' when it does not fit.
export async function unlockSlate(slateNumber, secret, slate) {
  if (!slate?.lock_wrapped_key || !slate?.lock_salt) throw new Error('not locked');
  const wrapping = await lockKeyFor(secret, slate.lock_salt);
  let docKey;
  try {
    docKey = await unwrapKey(slate.lock_wrapped_key, wrapping);
  } catch {
    throw new Error('wrong');
  }
  hold(slateNumber, docKey);
  return docKey;
}

// ---- recovery keypair -----------------------------------------------------

export async function fetchLockRecovery() {
  const res = await fetch(`${API_URL}/account/lock-recovery`, { credentials: 'include' });
  if (!res.ok) throw new Error('lock recovery unavailable');
  return res.json();
}

// The keypair that matches the account's current recovery phrase, or null
// when there is none yet (or the phrase changed since it was made)
export const currentRecoveryKey = (info) =>
  (info?.keys || []).find(k => k && k.salt && k.salt === info.recoverySalt) || null;

// Make the recovery keypair for the current phrase. The phrase is checked
// first by opening the master key's recovery wrap with it, so a typo cannot
// leave the account with a keypair nothing can open.
export async function registerRecoveryKey(phrase, info = null) {
  const d = info || await fetchLockRecovery();
  if (!d.recoverySalt || !d.recoveryWrappedKey) throw new Error('no recovery');
  const derived = await deriveKey(normalizePhrase(phrase), d.recoverySalt);
  try {
    await unwrapKey(d.recoveryWrappedKey, derived);
  } catch {
    throw new Error('wrong phrase');
  }
  const kp = await generateUserKeypair();
  const entry = {
    id: d.recoverySalt,
    publicKey: kp.publicKeySpkiBase64,
    wrappedPrivateKey: await wrapKey(kp.privateKeyPkcs8, derived),
    salt: d.recoverySalt,
  };
  const res = await fetch(`${API_URL}/account/lock-recovery`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error('lock recovery failed');
  return entry;
}

// Open a locked slate with the recovery phrase instead of its secret.
// Throws 'wrong phrase' when the phrase does not open the keypair the slate
// was wrapped to.
export async function recoverSlate(slateNumber, phrase, slate, info = null) {
  const d = info || await fetchLockRecovery();
  const entry = (d.keys || []).find(k => k && k.id === slate.lock_recovery_key_id);
  if (!entry || !slate.lock_recovery_wrapped_key) throw new Error('no recovery');
  const derived = await deriveKey(normalizePhrase(phrase), entry.salt);
  let privateKey;
  try {
    const pkcs8 = await unwrapKey(entry.wrappedPrivateKey, derived);
    privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  } catch {
    throw new Error('wrong phrase');
  }
  const docKey = await unwrapKeyRsa(slate.lock_recovery_wrapped_key, privateKey);
  hold(slateNumber, docKey);
  return docKey;
}

// ---- the save -------------------------------------------------------------

// Lock, re-key or unlock one slate and save it. Locking with `secret` wraps
// the doc key (a fresh one, or `docKey` when only the secret changes) to the
// secret and to `recoveryKey`; unlocking puts the content back under the
// master key. The title stays under the master key either way. Returns what
// the caller needs to update its own view of the slate.
export async function saveLockChange({ userId, slateNumber, content, masterKey, lockOn, secret = null, recoveryKey = null, docKey = null, baseUpdatedAt = null }) {
  const firstLine = content.split('\n')[0].trim().replace(/^#{1,6}\s+/, '');
  const key = lockOn ? (docKey || await generateSlateKey()) : null;
  let lock = { locked: false };
  if (lockOn) {
    if (!secret) throw new Error('secret required');
    const salt = generateSalt();
    lock = { locked: true, salt, wrappedKey: await wrapKey(key, await lockKeyFor(secret, salt)) };
    if (recoveryKey) {
      lock.recoveryWrappedKey = await wrapKeyToAppKey(key, await importAppPublicKey(recoveryKey.publicKey));
      lock.recoveryKeyId = recoveryKey.id;
    }
  }
  const body = {
    encryptedContent: await encryptContent(content, key || masterKey),
    encryptedTitle: await encryptTitle(firstLine || 'untitled slate', masterKey),
    wordCount: content.trim() === '' ? 0 : content.trim().split(/\s+/).length,
    charCount: content.length,
    sizeBytes: new TextEncoder().encode(content).length,
    lock,
  };
  if (baseUpdatedAt != null) body.baseUpdatedAt = baseUpdatedAt;
  const response = await fetch(`${API_URL}/slates/${slateNumber}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'lock failed');
  const lockFields = {
    is_locked: lockOn ? 1 : 0,
    lock_wrapped_key: lock.wrappedKey || null,
    lock_salt: lock.salt || null,
    lock_recovery_wrapped_key: lock.recoveryWrappedKey || null,
    lock_recovery_key_id: lock.recoveryKeyId || null,
  };
  cacheSlate(userId, slateNumber, {
    encryptedContent: body.encryptedContent, encrypted_title: body.encryptedTitle,
    ...lockFields, updated_at: data.updated_at ?? null,
  }).catch(() => {});
  if (lockOn) openKeys.set(String(slateNumber), key); else openKeys.delete(String(slateNumber));
  touchLock();
  emit({ type: lockOn ? 'locked' : 'unlocked', slateNumber, updatedAt: data.updated_at ?? null, encryptedContent: body.encryptedContent, lockFields });
  return { body, data, docKey: key, lockFields };
}
