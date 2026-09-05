// Local copies of slates for offline use, in IndexedDB.
//
// Everything stored here is exactly what the server holds: encrypted content
// and titles under the user's keys, never plaintext. The keys already live in
// IndexedDB (keyStore.js), so this adds no new exposure at rest.
//
// Stores:
//   slates   one cached slate per `${userId}:${slateNumber}`: the GET payload
//            plus bookkeeping (lastOpenedAt, keep). Local slates created
//            offline use a `local-…` number until they sync.
//   lists    the last slate list per user, as the server returned it.
//   pending  one queued write per slate: a POST for a local slate, or a PUT
//            with the base the edits started from, for three-way merging.
//   history  safety copies taken before a merge overwrites local work.
const DB_NAME = 'justtype-offline';
const DB_VERSION = 1;
const KEEP_MAX_CACHED = 50;        // opened-but-not-kept slates retained
const KEEP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const HISTORY_PER_SLATE = 20;

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const slates = db.createObjectStore('slates', { keyPath: 'key' });
      slates.createIndex('user', 'userId');
      db.createObjectStore('lists', { keyPath: 'userId' });
      const pending = db.createObjectStore('pending', { keyPath: 'key' });
      pending.createIndex('user', 'userId');
      const history = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
      history.createIndex('slate', 'slateKey');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

const tx = (store, mode, fn) => openDB().then(db => new Promise((resolve, reject) => {
  const t = db.transaction(store, mode);
  const result = fn(t.objectStore(store));
  t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error);
}));
const all = (index, value) => new Promise((resolve, reject) => {
  const req = index.getAll(value);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const slateKeyOf = (userId, slateNumber) => `${userId}:${slateNumber}`;
export const isLocalSlateNumber = (n) => typeof n === 'string' && n.startsWith('local-');
export const newLocalSlateNumber = () => `local-${Math.random().toString(36).slice(2, 10)}`;

// ---- slates ----------------------------------------------------------------

// `data` is the server's single-slate payload (encryptedContent, encrypted_title,
// editor_mode, updated_at, is_published, share_id, is_collab, collab_wrapped_key...)
export async function cacheSlate(userId, slateNumber, data, { opened = false } = {}) {
  const key = slateKeyOf(userId, slateNumber);
  const prev = await tx('slates', 'readonly', s => s.get(key));
  const rec = {
    key, userId, slateNumber,
    data: { ...(prev?.data || {}), ...data },
    keep: prev?.keep || false,
    cachedAt: Date.now(),
    lastOpenedAt: opened ? Date.now() : (prev?.lastOpenedAt || 0),
  };
  await tx('slates', 'readwrite', s => s.put(rec));
  return rec;
}
export const getCachedSlate = (userId, slateNumber) => tx('slates', 'readonly', s => s.get(slateKeyOf(userId, slateNumber)));
export const getCachedSlates = (userId) => openDB().then(db => all(db.transaction('slates').objectStore('slates').index('user'), userId));
export const deleteCachedSlate = (userId, slateNumber) => tx('slates', 'readwrite', s => s.delete(slateKeyOf(userId, slateNumber)));

export async function setKeepOffline(userId, slateNumber, keep) {
  const key = slateKeyOf(userId, slateNumber);
  const prev = await tx('slates', 'readonly', s => s.get(key));
  const rec = prev || { key, userId, slateNumber, data: {}, cachedAt: 0, lastOpenedAt: 0 };
  rec.keep = keep;
  await tx('slates', 'readwrite', s => s.put(rec));
}

// A synced slate replaces its local stand-in under the real number
export async function renameCachedSlate(userId, fromNumber, toNumber, data) {
  const prev = await getCachedSlate(userId, fromNumber);
  await deleteCachedSlate(userId, fromNumber);
  await cacheSlate(userId, toNumber, { ...(prev?.data || {}), ...data, slate_number: toNumber, local: false }, { opened: true });
}

// Drop opened-but-not-kept slates beyond the cap or age. Kept slates and
// slates with a queued write are never pruned.
export async function pruneCache(userId) {
  const [slates, pending] = await Promise.all([getCachedSlates(userId), getPending(userId)]);
  const pendingKeys = new Set(pending.map(p => p.key));
  const candidates = slates
    .filter(s => !s.keep && !pendingKeys.has(s.key) && !isLocalSlateNumber(s.slateNumber))
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const now = Date.now();
  const drop = candidates.filter((s, i) => i >= KEEP_MAX_CACHED || now - (s.lastOpenedAt || s.cachedAt) > KEEP_MAX_AGE_MS);
  if (drop.length) await tx('slates', 'readwrite', s => { for (const d of drop) s.delete(d.key); });
}

// ---- list ------------------------------------------------------------------

export const cacheList = (userId, rows) => tx('lists', 'readwrite', s => s.put({ userId, rows, cachedAt: Date.now() }));
export const getCachedList = (userId) => tx('lists', 'readonly', s => s.get(userId));

// ---- pending writes --------------------------------------------------------

// record: { op: 'post' | 'put', body, baseUpdatedAt, baseEncryptedContent, editorMode }
// A second offline save of the same slate replaces the body but keeps the
// base the first edit started from, so the eventual merge is against the
// version the person actually saw.
export async function queuePending(userId, slateNumber, record) {
  const key = slateKeyOf(userId, slateNumber);
  const prev = await tx('pending', 'readonly', s => s.get(key));
  const rec = {
    key, userId, slateNumber,
    ...record,
    baseUpdatedAt: prev?.baseUpdatedAt ?? record.baseUpdatedAt ?? null,
    baseEncryptedContent: prev?.baseEncryptedContent ?? record.baseEncryptedContent ?? null,
    createdAt: prev?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await tx('pending', 'readwrite', s => s.put(rec));
  return rec;
}
export const getPending = (userId) => openDB().then(db => all(db.transaction('pending').objectStore('pending').index('user'), userId)).then(r => r.sort((a, b) => a.createdAt - b.createdAt));
export const getPendingFor = (userId, slateNumber) => tx('pending', 'readonly', s => s.get(slateKeyOf(userId, slateNumber)));
export const deletePending = (userId, slateNumber) => tx('pending', 'readwrite', s => s.delete(slateKeyOf(userId, slateNumber)));

// ---- history ---------------------------------------------------------------

export async function addHistory(userId, slateNumber, encryptedContent, reason) {
  const slateKey = slateKeyOf(userId, slateNumber);
  await tx('history', 'readwrite', s => s.add({ slateKey, encryptedContent, reason, at: Date.now() }));
  const rows = await openDB().then(db => all(db.transaction('history').objectStore('history').index('slate'), slateKey));
  if (rows.length > HISTORY_PER_SLATE) {
    const extra = rows.sort((a, b) => a.at - b.at).slice(0, rows.length - HISTORY_PER_SLATE);
    await tx('history', 'readwrite', s => { for (const r of extra) s.delete(r.id); });
  }
}
