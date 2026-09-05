// Flushes writes queued while offline and merges what changed meanwhile.
//
// Order of events for one queued PUT: send it with the base timestamp the
// edits started from. If the server says the slate moved on (409), fetch the
// current version, three-way merge base / ours / theirs, keep a local copy
// of ours, and send the merged text. Regions both sides changed become
// conflict blocks in the document itself (see markdownConflict.js), so
// nothing is lost and the person resolves them in the editor at leisure.
//
// Listeners (Writer, SlateManager) subscribe with onSync(); events:
//   { type: 'started' } | { type: 'synced', from, to, slate } for a local
//   slate that got its number | { type: 'merged', slateNumber, conflicts }
//   | { type: 'finished', failed }
import { API_URL } from './config';
import { getSlateKey } from './keyStore';
import { decryptContent, encryptContent, encryptTitle, unwrapKey } from './crypto';
import { isOnline, onConnectivity, reportNetworkFailure } from './connectivity';
import {
  getPending, deletePending, queuePending, cacheSlate, renameCachedSlate, addHistory, getCachedSlate,
} from './offlineStore';

const listeners = new Set();
export function onSync(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (e) => { for (const l of listeners) l(e); };

export { mergeTexts } from './mergeText';
import { mergeTexts } from './mergeText';

const json = (res) => res.json().catch(() => ({}));

async function contentKeyFor(userId, cached) {
  const master = await getSlateKey(userId);
  if (!master) throw new Error('no key');
  if (cached?.data?.is_collab && cached.data.collab_wrapped_key) return unwrapKey(cached.data.collab_wrapped_key, master);
  return master;
}

// Resolve a 409 for `slateNumber`: merge and return the body to send plus
// the new base. Shared by the offline flush and the online save path.
export async function mergeWithServer(userId, slateNumber, ourBody, baseEncryptedContent) {
  const res = await fetch(`${API_URL}/slates/${encodeURIComponent(slateNumber)}`, { credentials: 'include' });
  if (!res.ok) throw new Error('fetch current failed');
  const theirs = await res.json();
  const cached = await getCachedSlate(userId, slateNumber);
  const key = await contentKeyFor(userId, cached || { data: theirs });
  const [baseText, ourText, theirText] = await Promise.all([
    baseEncryptedContent ? decryptContent(baseEncryptedContent, key) : Promise.resolve(''),
    decryptContent(ourBody.encryptedContent, key),
    decryptContent(theirs.encryptedContent, key),
  ]);
  const { text, conflicts } = mergeTexts(baseText, ourText, theirText);
  await addHistory(userId, slateNumber, ourBody.encryptedContent, 'before merge');
  const firstLine = text.split('\n')[0].trim().replace(/^#{1,6}\s+/, '') || 'untitled slate';
  const body = {
    ...ourBody,
    encryptedContent: await encryptContent(text, key),
    encryptedTitle: await encryptTitle(firstLine, key),
    wordCount: text.trim() === '' ? 0 : text.trim().split(/\s+/).length,
    charCount: text.length,
    sizeBytes: new TextEncoder().encode(text).length,
    baseUpdatedAt: theirs.updated_at,
  };
  return { body, text, conflicts, theirs };
}

let flushing = null;
export function flushPending(userId) {
  if (!userId || !isOnline()) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    const queue = await getPending(userId);
    if (!queue.length) return;
    emit({ type: 'started', count: queue.length });
    let failed = 0;
    for (const p of queue) {
      try {
        if (p.op === 'post') await flushPost(userId, p);
        else await flushPut(userId, p);
      } catch (err) {
        failed++;
        console.warn('offline sync: could not flush', p.slateNumber, err);
        reportNetworkFailure();
        if (!isOnline()) break;
      }
    }
    emit({ type: 'finished', failed });
  })().finally(() => { flushing = null; });
  return flushing;
}

async function flushPost(userId, p) {
  const res = await fetch(`${API_URL}/slates`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ ...p.body, editorMode: p.editorMode }),
  });
  if (!res.ok) throw new Error(`post ${res.status}`);
  const slate = await res.json();
  await renameCachedSlate(userId, p.slateNumber, slate.slate_number, { updated_at: slate.updated_at, is_published: 0, share_id: null });
  await deletePending(userId, p.slateNumber);
  emit({ type: 'synced', from: p.slateNumber, to: slate.slate_number, slate });
}

async function flushPut(userId, p) {
  const send = (body) => fetch(`${API_URL}/slates/${encodeURIComponent(p.slateNumber)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify(body),
  });
  let res = await send({ ...p.body, baseUpdatedAt: p.baseUpdatedAt });
  let merged = null;
  if (res.status === 409) {
    merged = await mergeWithServer(userId, p.slateNumber, p.body, p.baseEncryptedContent);
    res = await send(merged.body);
  }
  if (!res.ok) throw new Error(`put ${res.status}`);
  const data = await json(res);
  const sent = merged ? merged.body : p.body;
  await cacheSlate(userId, p.slateNumber, {
    encryptedContent: sent.encryptedContent, encrypted_title: sent.encryptedTitle, updated_at: data.updated_at,
  });
  await deletePending(userId, p.slateNumber);
  if (merged) emit({ type: 'merged', slateNumber: p.slateNumber, conflicts: merged.conflicts, text: merged.text });
}

// Queue an offline save for `slateNumber` (existing slate). `cached` is the
// slate as loaded, so the base of the edits is the version the person saw.
export async function queueOfflineSave(userId, slateNumber, body, cached) {
  await queuePending(userId, slateNumber, {
    op: 'put', body,
    baseUpdatedAt: cached?.data?.updated_at ?? null,
    baseEncryptedContent: cached?.data?.encryptedContent ?? null,
  });
  await cacheSlate(userId, slateNumber, { encryptedContent: body.encryptedContent, encrypted_title: body.encryptedTitle }, { opened: true });
}

// Start syncing whenever the network comes back
let wiredUser = null;
export function watchConnectivity(userId) {
  wiredUser = userId;
  if (isOnline()) flushPending(userId);
}
onConnectivity((s) => { if (s.online && wiredUser) flushPending(wiredUser); });
