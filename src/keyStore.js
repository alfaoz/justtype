// Where this device keeps the account's slate key.
//
// In a browser: IndexedDB. In the iOS app: the phone's keychain
// (ShellKeychainPlugin, this device only, never in a backup), so the app's
// files alone do not hold it; a key an older build left in IndexedDB moves
// over the first time it is read, and the IndexedDB copy is deleted.
import { inShell } from './shell';

const cap = inShell ? window.Capacitor : null;
const inKeychain = Boolean(cap?.isPluginAvailable?.('ShellKeychain'));
const keychain = (method, data) => cap.nativePromise('ShellKeychain', method, data);
const account = (userId) => `user-${userId}`;
const toB64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
// Read once per launch, then held in memory like the open page holds it anyway
const held = new Map();

const DB_NAME = 'justtype-keys';
const STORE_NAME = 'keys';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSave(userId, keyBytes) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(keyBytes, `user-${userId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(userId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(`user-${userId}`);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function idbDelete(userId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(`user-${userId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// True once the keychain holds it
async function keychainSave(userId, keyBytes) {
  const bytes = new Uint8Array(keyBytes);
  try { await keychain('keySet', { account: account(userId), value: toB64(bytes) }); } catch { return false; }
  held.set(String(userId), bytes);
  return true;
}

export async function saveSlateKey(userId, keyBytes) {
  // A keychain that refuses leaves the key where the browser keeps it
  if (!inKeychain || !(await keychainSave(userId, keyBytes))) return idbSave(userId, keyBytes);
  await idbDelete(userId).catch(() => {});
}

// One keychain read at a time per account: a caller arriving while it runs
// waits for the same answer (main.jsx starts it before the first slate asks)
const reading = new Map();
export async function getSlateKey(userId) {
  if (!inKeychain) return idbGet(userId);
  const id = String(userId);
  if (held.has(id)) return held.get(id);
  if (!reading.has(id)) reading.set(id, readKeychainKey(userId).finally(() => reading.delete(id)));
  return reading.get(id);
}

async function readKeychainKey(userId) {
  const id = String(userId);
  const r = await keychain('keyGet', { account: account(userId) }).catch(() => null);
  if (r?.value) { const bytes = fromB64(r.value); held.set(id, bytes); return bytes; }
  // Left by an older build: into the keychain, out of IndexedDB
  const old = await idbGet(userId).catch(() => null);
  if (!old) return null;
  if (await keychainSave(userId, old)) await idbDelete(userId).catch(() => {});
  return old;
}

export async function deleteSlateKey(userId) {
  if (inKeychain) {
    held.delete(String(userId));
    await keychain('keyDelete', { account: account(userId) }).catch(() => {});
  }
  // A copy an older build left there goes too
  return idbDelete(userId);
}

export async function hasSlateKey(userId) {
  const key = await getSlateKey(userId);
  return key !== null;
}
