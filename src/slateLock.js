// Slate locks: a second secret for private notes, one per slate.
//
// A locked slate keeps its content under its own doc key. That key is wrapped
// to a key derived from the slate's pin or passphrase (a salt per slate), and
// wrapped again to the account's lock-recovery public key. That keypair's
// private key is wrapped to a key derived from the login secret (the
// password, or the account pin of a Google account) and to the key the
// 12-word phrase derives, so a forgotten secret opens with either. The master
// key never wraps it: the master key sits on every signed-in device, and the
// lock is there for exactly that device. The server holds ciphertext and
// public keys only. The title stays under the master key so the list and
// title search keep reading.
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
import { cacheSlate, getCachedSlate, queuePending, cacheList, getCachedList } from './offlineStore';
import { isOnline } from './connectivity';
import { rekeyHistory, commitHistory } from './history';
import { rememberSecret, forgetSecret } from './deviceUnlock';

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

// Moving into a slate shuts every other lock, whichever way it was reached
export function relockOthers(slateNumber) {
  const keep = String(slateNumber);
  for (const n of [...openKeys.keys()]) if (n !== keep) forgetDocKey(n);
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
  // Typed on the phone: face id can type it next time (when it is on)
  rememberSecret(slateNumber, secret);
  return docKey;
}

// ---- recovery keypair -----------------------------------------------------
//
// One RSA keypair per account opens forgotten locks. Its private key is
// wrapped more than once, each wrap { kind, salt, wrappedPrivateKey }:
// `password` or `pin` under the login secret, `phrase` under the 12 words
// (that wrap's salt is the account's recovery salt at the time). Entries
// from before login wraps carry their phrase wrap in the flat fields `salt`
// and `wrappedPrivateKey`. The list is newest first.

const LOGIN_KINDS = ['password', 'pin'];

const cacheKeyFor = (userId) => `${userId}:lock-recovery`;

export async function fetchLockRecovery(userId = null) {
  try {
    const res = await fetch(`${API_URL}/account/lock-recovery`, { credentials: 'include' });
    if (!res.ok) throw new Error('lock recovery unavailable');
    const info = await res.json();
    if (userId) cacheList(cacheKeyFor(userId), info).catch(() => {});
    return info;
  } catch (err) {
    // Offline: the copy from the last time it was fetched on this device
    const cached = userId ? await getCachedList(cacheKeyFor(userId)).catch(() => null) : null;
    if (cached?.rows) return cached.rows;
    throw err;
  }
}

export const wrapsOf = (entry) => {
  if (!entry) return [];
  const list = Array.isArray(entry.wraps)
    ? entry.wraps.filter(w => w && w.kind && w.salt && w.wrappedPrivateKey)
    : [];
  if (entry.salt && entry.wrappedPrivateKey && !list.some(w => w.kind === 'phrase')) {
    list.push({ kind: 'phrase', salt: entry.salt, wrappedPrivateKey: entry.wrappedPrivateKey });
  }
  return list;
};
export const loginKindsOf = (entry) => wrapsOf(entry).filter(w => LOGIN_KINDS.includes(w.kind)).map(w => w.kind);
const hasPhraseWrap = (entry) => wrapsOf(entry).some(w => w.kind === 'phrase');

// The account's login secret on this device: Google accounts unlock with
// their pin, everyone else with the password
export const loginKind = () => (localStorage.getItem('justtype-auth-provider') === 'google' ? 'pin' : 'password');

// The entry new locks wrap to: the newest the login secret opens, else the
// one the current phrase opens, else none
export const currentRecoveryKey = (info) => {
  const keys = info?.keys || [];
  return keys.find(k => k && loginKindsOf(k).length)
    || keys.find(k => k && wrapsOf(k).some(w => w.kind === 'phrase' && w.salt === info.recoverySalt))
    || null;
};

// What can open a locked slate when its secret is forgotten
export function recoveryWaysFor(slate, info) {
  const entry = (info?.keys || []).find(k => k && k.id === slate?.lock_recovery_key_id);
  if (!entry || !slate?.lock_recovery_wrapped_key) return { logins: [], phrase: false };
  return { logins: loginKindsOf(entry), phrase: hasPhraseWrap(entry) };
}
export const waysOf = (entry) => ({ logins: loginKindsOf(entry), phrase: hasPhraseWrap(entry) });

const deriveWrapKey = (kind, secret, salt) =>
  kind === 'phrase' ? deriveKey(normalizePhrase(secret), salt) : deriveKey(secret, salt, { pin: kind === 'pin' });

// The private key (pkcs8 bytes) of `entry`, opened with `via`
// { kind, secret }, or { kinds, secret } to try one typed secret as each
// of several login kinds (an account that signs in both ways)
async function openEntry(entry, via) {
  const kinds = via.kinds || [via.kind];
  const wraps = wrapsOf(entry).filter(w => kinds.includes(w.kind));
  if (!wraps.length) throw new Error('no wrap');
  for (const wrap of wraps) {
    try {
      return await unwrapKey(wrap.wrappedPrivateKey, await deriveWrapKey(wrap.kind, via.secret, wrap.salt));
    } catch { /* the next kind, if any */ }
  }
  throw new Error(kinds.includes('phrase') ? 'wrong phrase' : 'wrong login');
}

async function makeWrap(pkcs8, { kind, secret, salt = null }) {
  const s = salt || generateSalt();
  return { kind, salt: s, wrappedPrivateKey: await wrapKey(pkcs8, await deriveWrapKey(kind, secret, s)) };
}

async function putEntry(entry) {
  const res = await fetch(`${API_URL}/account/lock-recovery`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error('lock recovery failed');
}

// The phrase, checked against the account before it wraps anything, so a
// typo cannot leave a wrap nothing can open. Returns the wrap or null.
async function phraseWrap(pkcs8, phrase, info) {
  if (!phrase || !info?.recoverySalt || !info?.recoveryWrappedKey) return null;
  const p = normalizePhrase(phrase);
  try {
    await unwrapKey(info.recoveryWrappedKey, await deriveKey(p, info.recoverySalt));
  } catch {
    return null;
  }
  return makeWrap(pkcs8, { kind: 'phrase', secret: p, salt: info.recoverySalt });
}

// The login secret, checked against the account's own wrapped master key
// before it wraps anything. Throws 'wrong login'.
export async function verifyLogin({ kind, secret }) {
  const res = await fetch(`${API_URL}/account/wrapped-key?kind=${kind}`, { credentials: 'include' });
  if (!res.ok) throw new Error('no key');
  const d = await res.json();
  try {
    await unwrapKey(d.wrappedKey, await deriveKey(secret, d.encryptionSalt, { pin: kind === 'pin' }));
  } catch {
    throw new Error('wrong login');
  }
}

// Does `via` open the keypair a locked slate was wrapped to? Throws the
// same way recoverSlate does, without opening the slate.
export async function verifyRecoveryWay(slate, via, info = null) {
  const d = info || await fetchLockRecovery();
  const entry = (d.keys || []).find(k => k && k.id === slate.lock_recovery_key_id);
  if (!entry) throw new Error('no recovery');
  await openEntry(entry, via);
}

// Make sure a keypair exists that `login` { kind, secret } opens. Called
// with the secret in hand (sign-in, pin unlock, registration, or the first
// lock of a session that predates login wraps), so the lock panel never
// has to ask for the phrase. The phrase, when it is also in hand, wraps too.
export async function ensureLockRecovery({ login, phrase = null, info = null }) {
  const d = info || await fetchLockRecovery();
  const have = (d.keys || []).find(k => k && loginKindsOf(k).includes(login.kind));
  if (have) return have;
  if (login.verify) await verifyLogin(login);
  const kp = await generateUserKeypair();
  const wraps = [await makeWrap(kp.privateKeyPkcs8, login)];
  const pw = await phraseWrap(kp.privateKeyPkcs8, phrase, d);
  if (pw) wraps.push(pw);
  const entry = { id: generateSalt().slice(0, 32), publicKey: kp.publicKeySpkiBase64, wraps, createdAt: Date.now() };
  await putEntry(entry);
  return entry;
}

// Give every entry that `via` opens the wraps in `add` (replacing wraps of
// the same kind): a password change, a new phrase, a new pin. A phrase wrap
// is checked against the account first; when the phrase is new and not on
// the server yet, `check` carries its { recoverySalt, recoveryWrappedKey }.
// Returns the entries it changed; `save` false leaves the PUT to the caller
// (the reset flow has no session yet and sends them with the reset itself).
export async function rewrapLockRecovery({ via, add, info = null, save = true }) {
  const d = info || await fetchLockRecovery();
  const changed = [];
  for (const entry of d.keys || []) {
    let pkcs8;
    try { pkcs8 = await openEntry(entry, via); } catch { continue; }
    const wraps = wrapsOf(entry).filter(w => !add.some(a => a.kind === w.kind));
    for (const a of add) {
      const w = a.kind === 'phrase' ? await phraseWrap(pkcs8, a.secret, { ...d, ...a.check }) : await makeWrap(pkcs8, a);
      if (w) wraps.push(w);
    }
    const next = { id: entry.id, publicKey: entry.publicKey, wraps, createdAt: entry.createdAt || Date.now() };
    if (save) await putEntry(next);
    changed.push(next);
  }
  return changed;
}

// Open a locked slate without its secret: `via` { kind, secret } is the
// login secret or the recovery phrase. Throws 'wrong login' / 'wrong phrase'
// when it does not open the keypair the slate was wrapped to.
export async function recoverSlate(slateNumber, via, slate, info = null) {
  const d = info || await fetchLockRecovery();
  const entry = (d.keys || []).find(k => k && k.id === slate.lock_recovery_key_id);
  if (!entry || !slate.lock_recovery_wrapped_key) throw new Error('no recovery');
  const pkcs8 = await openEntry(entry, via);
  const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
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
  // The slate's history follows its content to the new key
  let rekeyed = null;
  try {
    const fromKey = lockOn ? (docKey || masterKey) : (openKeys.get(String(slateNumber)) || masterKey);
    rekeyed = await rekeyHistory({ userId, n: slateNumber, fromKey, toKey: key || masterKey });
    if (rekeyed) body.history = rekeyed.history;
  } catch (err) { console.warn('history: not re-keyed with the lock', err); }
  let data = {};
  if (isOnline()) {
    const response = await fetch(`${API_URL}/slates/${slateNumber}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'lock failed');
  } else {
    // Offline: the re-keyed save waits in the queue with its lock change,
    // based on the version this device holds
    const cached = await getCachedSlate(userId, slateNumber);
    await queuePending(userId, slateNumber, {
      op: 'put', body,
      baseUpdatedAt: baseUpdatedAt ?? cached?.data?.updated_at ?? null,
      baseEncryptedContent: cached?.data?.encryptedContent ?? null,
    });
    data = { updated_at: cached?.data?.updated_at ?? null, queued: true };
  }
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
  if (rekeyed) commitHistory(userId, slateNumber, rekeyed.entries, rekeyed.blob);
  if (lockOn) openKeys.set(String(slateNumber), key); else openKeys.delete(String(slateNumber));
  if (lockOn) rememberSecret(slateNumber, secret); else forgetSecret(slateNumber);
  touchLock();
  emit({ type: lockOn ? 'locked' : 'unlocked', slateNumber, updatedAt: data.updated_at ?? null, encryptedContent: body.encryptedContent, lockFields });
  return { body, data, docKey: key, lockFields };
}
