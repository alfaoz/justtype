// Local copies of slates for offline use: IndexedDB in a browser, the app's own files in the iOS app (see "where the records live").
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
import { inApp, nativeHost } from './shell';

const DB_NAME = 'justtype-offline';
const DB_VERSION = 1;
// Every slate gets a copy on the device (see copyPlan); copies the app made
// on its own are evicted, least recently opened first, only past this budget.
// Kept slates and slates with a queued write are never evicted.
// The app keeps its copies in its own files and can afford more
export const DEVICE_COPY_BUDGET = (inApp ? 256 : 64) * 1024 * 1024;
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

// ---- where the records live ------------------------------------------------
//
// In a browser: the IndexedDB above. In the apps: the app's own files
// (ShellStorePlugin.swift on iOS, NativeBridge.swift on the Mac), which are never cleared the way it may clear a web
// view's storage. The first time the app runs this, everything the web
// view's database held moves over (unsynced edits included), is read back,
// and only then is that database deleted. Records are the same objects
// either way; the app keys them by the same fields.
const cap = nativeHost;
const onDevice = Boolean(cap?.isPluginAvailable?.('ShellStore'));
const shellStore = (method, data) => cap.nativePromise('ShellStore', method, data);
const keyOf = { slates: r => r.key, lists: r => r.userId, pending: r => r.key, history: r => String(r.id) };
const parse = (v) => { try { return JSON.parse(v); } catch { return undefined; } };

const MOVED = 'justtype-offline-moved';
let moving = null;
function ready() {
  if (!onDevice) return Promise.resolve();
  if (!moving) moving = moveOut().catch((err) => { moving = null; throw err; });
  return moving;
}
async function moveOut() {
  try { if (localStorage.getItem(MOVED) === '1') return; } catch { /* storage unavailable */ }
  const db = await openDB();
  for (const store of ['slates', 'lists', 'pending', 'history']) {
    const recs = await new Promise((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!recs.length) continue;
    await shellStore('putMany', { store, records: recs.map(r => ({ key: keyOf[store](r), value: JSON.stringify(r) })) });
    const back = await shellStore('all', { store });
    const have = new Set((back?.values || []).map(parse).filter(Boolean).map(keyOf[store]));
    if (recs.some(r => !have.has(keyOf[store](r)))) throw new Error('offline copies did not all move');
  }
  try { localStorage.setItem(MOVED, '1'); } catch { /* storage unavailable */ }
  db.close();
  dbPromise = null;
  indexedDB.deleteDatabase(DB_NAME);
}

const get = async (store, key) => {
  if (!onDevice) return tx(store, 'readonly', s => s.get(key));
  await ready();
  const r = await shellStore('get', { store, key: String(key) });
  return r?.value ? parse(r.value) : undefined;
};
const put = async (store, rec) => {
  if (!onDevice) return tx(store, 'readwrite', s => s.put(rec));
  await ready();
  await shellStore('put', { store, key: keyOf[store](rec), value: JSON.stringify(rec) });
};
const del = async (store, keys) => {
  const list = [].concat(keys);
  if (!onDevice) return tx(store, 'readwrite', s => { for (const k of list) s.delete(k); });
  await ready();
  for (const k of list) await shellStore('remove', { store, key: String(k) });
};
const everything = async (store) => {
  await ready();
  const r = await shellStore('all', { store });
  return (r?.values || []).map(parse).filter(Boolean);
};
const forUser = async (store, userId) => {
  if (!onDevice) return openDB().then(db => byUser(db.transaction(store).objectStore(store).index('user'), userId));
  return (await everything(store)).filter(r => String(r.userId) === uid(userId));
};

export const slateKeyOf = (userId, slateNumber) => `${uid(userId)}:${slateNumber}`;
export const isLocalSlateNumber = (n) => typeof n === 'string' && n.startsWith('local-');
export const newLocalSlateNumber = () => `local-${Math.random().toString(36).slice(2, 10)}`;

// ---- slates ----------------------------------------------------------------

// `data` is the server's single-slate payload (encryptedContent, encrypted_title,
// editor_mode, updated_at, is_published, share_id, is_collab, collab_wrapped_key...)
export async function cacheSlate(userId, slateNumber, data, { opened = false } = {}) {
  const key = slateKeyOf(userId, slateNumber);
  const prev = await get('slates', key);
  // An offloaded slate stays off this device: opening it, saving it or
  // syncing it does not put a copy back. Keep or copy clears the flag first.
  if (prev?.offloaded) return prev;
  const rec = {
    key, userId: uid(userId), slateNumber,
    data: { ...(prev?.data || {}), ...data },
    keep: prev?.keep || false,
    cachedAt: Date.now(),
    lastOpenedAt: opened ? Date.now() : (prev?.lastOpenedAt || 0),
  };
  await put('slates', rec);
  return rec;
}
export const getCachedSlate = (userId, slateNumber) => get('slates', slateKeyOf(userId, slateNumber));
export const getCachedSlates = (userId) => forUser('slates', userId);
export const deleteCachedSlate = (userId, slateNumber) => del('slates', slateKeyOf(userId, slateNumber));

export async function setKeepOffline(userId, slateNumber, keep) {
  const key = slateKeyOf(userId, slateNumber);
  const prev = await get('slates', key);
  const rec = prev || { key, userId: uid(userId), slateNumber, data: {}, cachedAt: 0, lastOpenedAt: 0 };
  rec.userId = uid(userId);
  rec.keep = keep;
  if (keep) rec.offloaded = false;
  await put('slates', rec);
}

// Take the copy off this device and remember that the person asked, so the
// app does not quietly bring it back on the next list load. Opening the
// slate, or clicking its cloud mark, puts a copy back.
export async function offloadSlate(userId, slateNumber) {
  const key = slateKeyOf(userId, slateNumber);
  await put('slates', { key, userId: uid(userId), slateNumber, data: {}, keep: false, offloaded: true, cachedAt: 0, lastOpenedAt: 0 });
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
  if (drop.length) await del('slates', drop.map(d => d.key));
}

// Copies of slates the server no longer lists (deleted elsewhere) go, unless
// a queued write still refers to them. Local slates are not the server's.
export async function dropStaleCopies(userId, listedNumbers) {
  const listed = new Set(listedNumbers);
  const [slates, pending] = await Promise.all([getCachedSlates(userId), getPending(userId)]);
  const pendingKeys = new Set(pending.map(p => p.key));
  const stale = slates.filter(s => !isLocalSlateNumber(s.slateNumber) && !listed.has(s.slateNumber) && !pendingKeys.has(s.key));
  if (stale.length) await del('slates', stale.map(d => d.key));
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
  // Offloaded slates stay off until asked for
  const rest = eligible.filter(r => { const c = byNumber.get(r.slate_number); return !c?.keep && !c?.offloaded; })
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

export const cacheList = (userId, rows) => put('lists', { userId: uid(userId), rows, cachedAt: Date.now() });
export const getCachedList = (userId) => get('lists', uid(userId));

// ---- pending writes --------------------------------------------------------

// Changes to one slate's record happen one at a time: an upload deciding
// what to do with the record it sent must not interleave with a save
// replacing its body
const pendingTurns = new Map();
function onPending(key, fn) {
  const next = (pendingTurns.get(key) || Promise.resolve()).then(fn);
  const turn = next.catch(() => {});
  pendingTurns.set(key, turn);
  turn.then(() => { if (pendingTurns.get(key) === turn) pendingTurns.delete(key); });
  return next;
}

// Names one body in the queue. The server remembers the last one it saved,
// so sending the same body again (a retry after a lost answer) writes nothing.
export const newSaveRef = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

// Tells one encrypted body from another without keeping it: every body
// starts with its own random IV and auth tag
export const fingerprint = (blob) => (typeof blob === 'string' ? `${blob.length}:${blob.slice(0, 48)}` : null);

// record: { op: 'post' | 'put', body, baseUpdatedAt, baseEncryptedContent, editorMode, parent }
// A second offline save of the same slate replaces the body but keeps the
// base the first edit started from, so the eventual merge is against the
// version the person actually saw. `record` may be a function: it is called
// once the slate's earlier queue changes are done, so what it reads is current.
// Every body gets a fresh saveRef. `parent` is the fingerprint of the body
// the new text was written on (another tab's text on the same slate is not).
export function queuePending(userId, slateNumber, record) {
  const key = slateKeyOf(userId, slateNumber);
  return onPending(key, () => writePending(key, userId, slateNumber, typeof record === 'function' ? record() : record));
}
async function writePending(key, userId, slateNumber, record) {
  const prev = await get('pending', key);
  const replaced = fingerprint(prev?.body?.encryptedContent);
  const sameLine = record.parent === undefined || record.parent === replaced;
  // A lock change waiting in the queue rides along under later saves of
  // the same slate: their content is already under the key it switched to
  const carriedLock = record.body && record.body.lock === undefined && prev?.body?.lock !== undefined
    ? { body: { ...record.body, lock: prev.body.lock } }
    : {};
  const rec = {
    key, userId: uid(userId), slateNumber,
    ...record,
    ...carriedLock,
    // A slate that has not been created on the server yet stays a POST no
    // matter how many times it is saved again offline
    op: prev?.op === 'post' ? 'post' : record.op,
    editorMode: record.editorMode ?? prev?.editorMode,
    baseUpdatedAt: prev?.baseUpdatedAt ?? record.baseUpdatedAt ?? null,
    baseEncryptedContent: prev?.baseEncryptedContent ?? record.baseEncryptedContent ?? null,
    // The bodies this one was written on top of, since the server last
    // confirmed one. Any of them may have reached the server unseen (its
    // upload cut off, the tab closed mid-send): a 409 against one of these
    // is our own save, not someone else's. Text from another line (a second
    // tab on the same slate) starts the list again, so it merges instead.
    inDoubt: sameLine ? [...(prev?.inDoubt || []), replaced].filter(Boolean).slice(-32) : [],
    saveRef: newSaveRef(),
    createdAt: prev?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await put('pending', rec);
  return rec;
}
export const getPending = (userId) => forUser('pending', userId).then(r => r.sort((a, b) => a.createdAt - b.createdAt));
export const getPendingFor = (userId, slateNumber) => get('pending', slateKeyOf(userId, slateNumber));
export const deletePending = (userId, slateNumber) => onPending(slateKeyOf(userId, slateNumber), () => del('pending', slateKeyOf(userId, slateNumber)));

// The body named `saveRef` reached the server. Still the body in the queue:
// the record goes. A newer body was queued meanwhile: it stays, on the base
// `rebase(rec)` gives it ('rebased'), or on its own when that is null
// ('kept'). `after` runs in the same turn, so no save for this slate lands
// between the record changing and what follows from it.
// Resolves 'deleted', 'rebased', 'kept' or 'gone' (nothing queued any more).
export function settlePending(userId, slateNumber, saveRef, rebase, after) {
  const key = slateKeyOf(userId, slateNumber);
  return onPending(key, async () => {
    const rec = await get('pending', key);
    let state = 'gone';
    if (rec && rec.saveRef === saveRef) { await del('pending', key); state = 'deleted'; }
    else if (rec) {
      const patch = rebase(rec);
      if (patch) { await put('pending', { ...rec, ...patch }); state = 'rebased'; } else state = 'kept';
    }
    if (after) await after(state);
    return state;
  });
}

// A local slate got its number while a newer body waited under the local
// one: that body moves to the number as an edit of what was just created
export function movePending(userId, fromNumber, toNumber, saveRef, base) {
  const from = slateKeyOf(userId, fromNumber);
  return onPending(from, async () => {
    const rec = await get('pending', from);
    if (!rec) return 'gone';
    await del('pending', from);
    if (rec.saveRef === saveRef) return 'deleted';
    const to = slateKeyOf(userId, toNumber);
    await onPending(to, () => put('pending', { ...rec, key: to, slateNumber: toNumber, op: 'put', ...base }));
    return 'moved';
  });
}

// ---- history ---------------------------------------------------------------

export async function addHistory(userId, slateNumber, encryptedContent, reason) {
  const slateKey = slateKeyOf(userId, slateNumber);
  const rec = { slateKey, encryptedContent, reason, at: Date.now() };
  let rows;
  if (onDevice) {
    // The app's files have no counter: the id is made here
    await put('history', { ...rec, id: `h-${rec.at}-${Math.random().toString(36).slice(2, 8)}` });
    rows = (await everything('history')).filter(r => r.slateKey === slateKey);
  } else {
    await tx('history', 'readwrite', s => s.add(rec));
    rows = await openDB().then(db => all(db.transaction('history').objectStore('history').index('slate'), slateKey));
  }
  if (rows.length > HISTORY_PER_SLATE) {
    const extra = rows.sort((a, b) => a.at - b.at).slice(0, rows.length - HISTORY_PER_SLATE);
    await del('history', extra.map(r => r.id));
  }
}
