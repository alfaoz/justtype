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
// Every slate gets a copy on the device (see copyPlan); copies the app made
// on its own are evicted, least recently opened first, only past this budget.
// Kept slates and slates with a queued write are never evicted.
export const DEVICE_COPY_BUDGET = 64 * 1024 * 1024;
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

// The app hands us the user id as a string (from local storage) or a number
// (from the server) depending on when it asks. IndexedDB indexes compare by
// type, so every record is stored and every index query made with the string
// form; reads also check the number form so records written before this
// stay visible.
const uid = (userId) => String(userId);
const byUser = (index, userId) => Promise.all([all(index, uid(userId)), all(index, Number(userId))])
  .then(([a, b]) => { const seen = new Set(a.map(r => r.key)); return [...a, ...b.filter(r => !seen.has(r.key))]; });

export const slateKeyOf = (userId, slateNumber) => `${uid(userId)}:${slateNumber}`;
export const isLocalSlateNumber = (n) => typeof n === 'string' && n.startsWith('local-');
export const newLocalSlateNumber = () => `local-${Math.random().toString(36).slice(2, 10)}`;

// ---- slates ----------------------------------------------------------------

// `data` is the server's single-slate payload (encryptedContent, encrypted_title,
// editor_mode, updated_at, is_published, share_id, is_collab, collab_wrapped_key...)
export async function cacheSlate(userId, slateNumber, data, { opened = false } = {}) {
  const key = slateKeyOf(userId, slateNumber);
  const prev = await tx('slates', 'readonly', s => s.get(key));
  const rec = {
    key, userId: uid(userId), slateNumber,
    data: { ...(prev?.data || {}), ...data },
    keep: prev?.keep || false,
    cachedAt: Date.now(),
    lastOpenedAt: opened ? Date.now() : (prev?.lastOpenedAt || 0),
  };
  await tx('slates', 'readwrite', s => s.put(rec));
  return rec;
}
export const getCachedSlate = (userId, slateNumber) => tx('slates', 'readonly', s => s.get(slateKeyOf(userId, slateNumber)));
export const getCachedSlates = (userId) => openDB().then(db => byUser(db.transaction('slates').objectStore('slates').index('user'), userId));
export const deleteCachedSlate = (userId, slateNumber) => tx('slates', 'readwrite', s => s.delete(slateKeyOf(userId, slateNumber)));

export async function setKeepOffline(userId, slateNumber, keep) {
  const key = slateKeyOf(userId, slateNumber);
  const prev = await tx('slates', 'readonly', s => s.get(key));
  const rec = prev || { key, userId: uid(userId), slateNumber, data: {}, cachedAt: 0, lastOpenedAt: 0 };
  rec.userId = uid(userId);
  rec.keep = keep;
  await tx('slates', 'readwrite', s => s.put(rec));
}

// A synced slate replaces its local stand-in under the real number
export async function renameCachedSlate(userId, fromNumber, toNumber, data) {
  const prev = await getCachedSlate(userId, fromNumber);
  await deleteCachedSlate(userId, fromNumber);
  await cacheSlate(userId, toNumber, { ...(prev?.data || {}), ...data, slate_number: toNumber, local: false }, { opened: true });
}

const copySize = (rec) => (rec?.data?.encryptedContent?.length || 0);

// Drop the app's own copies, least recently opened first, until the device
// is back under budget. Kept slates and slates with a queued write stay.
export async function pruneCache(userId) {
  const [slates, pending] = await Promise.all([getCachedSlates(userId), getPending(userId)]);
  const pendingKeys = new Set(pending.map(p => p.key));
  let total = slates.reduce((n, s) => n + copySize(s), 0);
  const candidates = slates
    .filter(s => !s.keep && !pendingKeys.has(s.key) && !isLocalSlateNumber(s.slateNumber))
    .sort((a, b) => (a.lastOpenedAt || a.cachedAt) - (b.lastOpenedAt || b.cachedAt));
  const drop = [];
  for (const s of candidates) {
    if (total <= DEVICE_COPY_BUDGET) break;
    drop.push(s);
    total -= copySize(s);
  }
  if (drop.length) await tx('slates', 'readwrite', s => { for (const d of drop) s.delete(d.key); });
}

// Copies of slates the server no longer lists (deleted elsewhere) go, unless
// a queued write still refers to them. Local slates are not the server's.
export async function dropStaleCopies(userId, listedNumbers) {
  const listed = new Set(listedNumbers);
  const [slates, pending] = await Promise.all([getCachedSlates(userId), getPending(userId)]);
  const pendingKeys = new Set(pending.map(p => p.key));
  const stale = slates.filter(s => !isLocalSlateNumber(s.slateNumber) && !listed.has(s.slateNumber) && !pendingKeys.has(s.key));
  if (stale.length) await tx('slates', 'readwrite', st => { for (const d of stale) st.delete(d.key); });
}

// Which slates from the server list this device should fetch: kept slates
// whose copy is behind, then everything missing or behind, newest first,
// while the list fits the budget. Rows are the server's list entries.
export function copyPlan(rows, cached) {
  const byNumber = new Map(cached.map(c => [c.slateNumber, c]));
  const needs = (row) => {
    const c = byNumber.get(row.slate_number);
    return !c?.data?.encryptedContent || (row.updated_at && c.data.updated_at !== row.updated_at);
  };
  const eligible = rows.filter(r => !r.local && !r.shared && !isLocalSlateNumber(r.slate_number));
  const kept = eligible.filter(r => byNumber.get(r.slate_number)?.keep);
  const rest = eligible.filter(r => !byNumber.get(r.slate_number)?.keep)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  let total = kept.reduce((n, r) => n + (r.size_bytes || 0), 0);
  const within = [];
  for (const r of rest) {
    total += r.size_bytes || 0;
    if (total > DEVICE_COPY_BUDGET) break;
    within.push(r);
  }
  return [...kept, ...within].filter(needs).map(r => r.slate_number);
}

// ---- list ------------------------------------------------------------------

export const cacheList = (userId, rows) => tx('lists', 'readwrite', s => s.put({ userId: uid(userId), rows, cachedAt: Date.now() }));
export const getCachedList = (userId) => tx('lists', 'readonly', s => s.get(uid(userId)));

// ---- pending writes --------------------------------------------------------

// record: { op: 'post' | 'put', body, baseUpdatedAt, baseEncryptedContent, editorMode }
// A second offline save of the same slate replaces the body but keeps the
// base the first edit started from, so the eventual merge is against the
// version the person actually saw.
export async function queuePending(userId, slateNumber, record) {
  const key = slateKeyOf(userId, slateNumber);
  const prev = await tx('pending', 'readonly', s => s.get(key));
  const rec = {
    key, userId: uid(userId), slateNumber,
    ...record,
    // A slate that has not been created on the server yet stays a POST no
    // matter how many times it is saved again offline
    op: prev?.op === 'post' ? 'post' : record.op,
    editorMode: record.editorMode ?? prev?.editorMode,
    baseUpdatedAt: prev?.baseUpdatedAt ?? record.baseUpdatedAt ?? null,
    baseEncryptedContent: prev?.baseEncryptedContent ?? record.baseEncryptedContent ?? null,
    createdAt: prev?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await tx('pending', 'readwrite', s => s.put(rec));
  return rec;
}
export const getPending = (userId) => openDB().then(db => byUser(db.transaction('pending').objectStore('pending').index('user'), userId)).then(r => r.sort((a, b) => a.createdAt - b.createdAt));
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
