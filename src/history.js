// Version history for private slates: one bundle per slate.
//
// The bundle is every retained version of the slate as one JSON list,
// deflated in the browser, then encrypted under the slate's key (the master
// key, or the doc key of a locked slate). It rides on the save request, so
// the server writes content and history in one update; the server holds
// ciphertext and never a version count it could read anything from.
//
// A version is taken when the text changed since the last one and ten
// minutes passed, or the save was explicit, or a merge or restore is about
// to happen. Identical text is skipped. Retention thins by age: everything
// from the last hour, one an hour for a day, one a day for a month, one a
// week beyond, and labelled versions always. The bundle stays under a byte
// cap by dropping the oldest unlabelled versions.
//
// The bundle is fetched lazily, the first time a version is due in a
// session, and kept on the device with the slate's copy for offline use.
import { API_URL } from './config';
import { encryptBytes, decryptBytes } from './crypto';
import { cacheSlate, getCachedSlate } from './offlineStore';
import { isOnline } from './connectivity';

const GAP_MS = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const BUNDLE_CAP = 2 * 1024 * 1024;
export const MAX_LABELED = 10;
const FORMAT_DEFLATE = 1;
const FORMAT_RAW = 0;

// `${userId}:${slateNumber}` -> { entries (oldest first), blob }
const held = new Map();
const keyOf = (userId, n) => `${userId}:${n}`;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ---- bytes ------------------------------------------------------------------

async function pipe(bytes, stream) {
  const w = stream.writable.getWriter();
  w.write(bytes);
  w.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
const canDeflate = typeof CompressionStream !== 'undefined';

async function encode(entries, key) {
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, entries }));
  const body = canDeflate ? await pipe(json, new CompressionStream('deflate-raw')) : json;
  const framed = new Uint8Array(body.length + 1);
  framed[0] = canDeflate ? FORMAT_DEFLATE : FORMAT_RAW;
  framed.set(body, 1);
  const blob = await encryptBytes(framed, key);
  return { blob, bytes: Math.ceil(blob.length * 3 / 4) };
}

async function decode(blob, key) {
  const framed = await decryptBytes(blob, key);
  const body = framed.slice(1);
  const json = framed[0] === FORMAT_DEFLATE ? await pipe(body, new DecompressionStream('deflate-raw')) : body;
  const parsed = JSON.parse(new TextDecoder().decode(json));
  return Array.isArray(parsed?.entries) ? parsed.entries : [];
}

// ---- retention --------------------------------------------------------------

// Newest of each age bucket stays; labelled versions always stay
export function thin(entries, now = Date.now()) {
  const keep = new Set();
  const buckets = new Map();
  for (const e of entries) {
    if (e.label) { keep.add(e.id); continue; }
    const age = now - e.at;
    const bucket = age < HOUR ? `all:${e.id}`
      : age < DAY ? `hour:${Math.floor(e.at / HOUR)}`
      : age < 30 * DAY ? `day:${Math.floor(e.at / DAY)}`
      : `week:${Math.floor(e.at / WEEK)}`;
    buckets.set(bucket, e.id);
  }
  for (const id of buckets.values()) keep.add(id);
  return entries.filter(e => keep.has(e.id));
}

// Encode, and while the bundle is over the cap drop the oldest unlabelled
// version and encode again
async function fit(entries, key) {
  let list = entries;
  for (;;) {
    const out = await encode(list, key);
    if (out.bytes <= BUNDLE_CAP) return { ...out, entries: list };
    const i = list.findIndex(e => !e.label);
    if (i === -1) return null;
    list = list.filter((_, j) => j !== i);
  }
}

// ---- loading ----------------------------------------------------------------

async function fetchBundle(userId, n) {
  const res = await fetch(`${API_URL}/slates/${encodeURIComponent(n)}/history`, { credentials: 'include' });
  if (!res.ok) throw new Error('history unavailable');
  const data = await res.json();
  return data.blob || null;
}

// The slate's versions, oldest first. From memory, else the device copy
// when offline, else the server. Null when they cannot be had right now.
export async function loadHistory(userId, n, key) {
  const k = keyOf(userId, n);
  if (held.has(k)) return held.get(k).entries;
  let blob = null;
  if (isOnline()) {
    try { blob = await fetchBundle(userId, n); } catch { blob = undefined; }
  }
  if (blob === undefined || !isOnline()) {
    const cached = await getCachedSlate(userId, n).catch(() => null);
    if (cached?.data?.history_blob === undefined && blob === undefined) return null;
    blob = cached?.data?.history_blob ?? null;
  }
  let entries = [];
  if (blob) {
    try { entries = await decode(blob, key); } catch { return null; }
  }
  held.set(k, { entries, blob });
  return entries;
}

export const heldHistory = (userId, n) => held.get(keyOf(userId, n))?.entries || null;
export function forgetHistory(userId, n) { held.delete(keyOf(userId, n)); }

// The bundle as saved: memory and the device copy follow
export function commitHistory(userId, n, entries, blob) {
  held.set(keyOf(userId, n), { entries, blob });
  cacheSlate(userId, n, { history_blob: blob }).catch(() => {});
}

// ---- versions ---------------------------------------------------------------

const due = (entries, text, explicit, now) => {
  const last = entries[entries.length - 1];
  if (!last) return true;
  if (last.text === text) return false;
  return explicit || now - last.at >= GAP_MS;
};

// A version of `text`, when one is due, ready to ride on the save:
// { history: { blob, count }, entries, blob } or null.
// `force` takes one whatever the timing (before a merge or a restore).
export async function prepareCheckpoint({ userId, n, text, key, explicit = false, force = false, reason = null }) {
  if (!userId || n == null || !key) return null;
  const entries = await loadHistory(userId, n, key);
  if (!entries) return null;
  const now = Date.now();
  if (!force && !due(entries, text, explicit, now)) return null;
  if (force && entries.length && entries[entries.length - 1].text === text) return null;
  const next = thin([...entries, { id: newId(), at: now, text, ...(reason ? { reason } : {}) }], now);
  const out = await fit(next, key);
  if (!out) return null;
  return { history: { blob: out.blob, count: out.entries.length }, entries: out.entries, blob: out.blob };
}

// Save a bundle on its own, apart from any content save
async function putBundle(userId, n, entries, key) {
  const out = await fit(entries, key);
  if (!out) throw new Error('history too large');
  const res = await fetch(`${API_URL}/slates/${encodeURIComponent(n)}/history`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ history: { blob: out.blob, count: out.entries.length } }),
  });
  if (!res.ok) throw new Error('history save failed');
  commitHistory(userId, n, out.entries, out.blob);
  return out.entries;
}

// The first version: the text as it is, so a slate has a history from the
// moment it exists. Right after a slate is created, and for slates from
// before there were versions, when their history is first looked at. A
// slate with versions already is left alone.
export async function seedHistory({ userId, n, key, text }) {
  if (!userId || n == null || !key || !text.trim()) return null;
  const entries = await loadHistory(userId, n, key);
  if (!entries) return null;
  if (entries.length) return entries;
  return putBundle(userId, n, [{ id: newId(), at: Date.now(), text }], key);
}

// Name a version (or clear its name) and save the bundle on its own
export async function labelVersion({ userId, n, key, id, label }) {
  const entries = await loadHistory(userId, n, key);
  if (!entries) throw new Error('history unavailable');
  const clean = (label || '').trim().slice(0, 60);
  if (clean && entries.filter(e => e.label && e.id !== id).length >= MAX_LABELED) throw new Error('too many named');
  await putBundle(userId, n, entries.map(e => (e.id === id ? { ...e, label: clean || undefined } : e)), key);
  return clean;
}

// The bundle under another key, for a lock change: { blob, count } or null
// when there is nothing to carry over
export async function rekeyHistory({ userId, n, fromKey, toKey }) {
  const entries = await loadHistory(userId, n, fromKey);
  if (!entries || !entries.length) return null;
  const out = await fit(entries, toKey);
  if (!out) return null;
  return { history: { blob: out.blob, count: out.entries.length }, entries: out.entries, blob: out.blob };
}
