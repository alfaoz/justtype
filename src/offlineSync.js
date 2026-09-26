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
//   { type: 'started', count, slates, quiet } | { type: 'synced', from, to, slate }
//   for a local slate that got its number | { type: 'flushed', slateNumber }
//   for an edit that landed | { type: 'failed', slateNumber }
//   | { type: 'merged', slateNumber, conflicts, text, ours }
//   | { type: 'finished', failed, quiet }
import { API_URL } from './config';
import { getSlateKey } from './keyStore';
import { decryptContent, encryptContent, encryptTitle, unwrapKey } from './crypto';
import { openDocKey } from './slateLock';
import { isOnline, onConnectivity, reportNetworkFailure } from './connectivity';
import {
  getPending, getPendingFor, queuePending, settlePending, movePending, cacheSlate, renameCachedSlate, addHistory, getCachedSlate, slateKeyOf, fingerprint,
} from './offlineStore';

const listeners = new Set();
export function onSync(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (e) => { for (const l of listeners) l(e); };

export { mergeTexts } from './mergeText';
import { CONFLICT_OURS, mergeTexts } from './mergeText';

// A request that has not answered in this long is given up on. The body it
// carried stays queued and goes again later; its saveRef makes the repeat
// harmless if the first one did land.
const REQUEST_TIMEOUT_MS = 20000;
async function call(url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: 'include', ...opts, signal: ac.signal });
    let data = {};
    try { data = await res.json(); } catch (err) { if (ac.signal.aborted) throw err; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function contentKeyFor(userId, cached, slateNumber) {
  const master = await getSlateKey(userId);
  if (!master) throw new Error('no key');
  if (cached?.data?.is_collab && cached.data.collab_wrapped_key) return unwrapKey(cached.data.collab_wrapped_key, master);
  if (cached?.data?.is_locked) {
    // A locked slate merges only while its lock is open on this device
    const docKey = openDocKey(slateNumber);
    if (!docKey) throw new Error('locked');
    return docKey;
  }
  return master;
}

const fetchCurrent = async (slateNumber) => {
  const res = await call(`${API_URL}/slates/${encodeURIComponent(slateNumber)}`);
  if (!res.ok) throw new Error('fetch current failed');
  return res.data;
};

// Resolve a 409 for `slateNumber`: merge and return the body to send plus
// the new base. Shared by the offline flush and the online save path.
// `current`: the server's slate, when the caller has fetched it already.
export async function mergeWithServer(userId, slateNumber, ourBody, baseEncryptedContent, current = null) {
  const theirs = current || await fetchCurrent(slateNumber);
  const cached = await getCachedSlate(userId, slateNumber);
  const key = await contentKeyFor(userId, cached || { data: theirs }, slateNumber);
  // A lock change queued offline leaves the server's copy under the key the
  // slate had before it, so each text is tried under the other keys too
  const others = [await getSlateKey(userId), openDocKey(slateNumber)].filter(k => k && k !== key);
  const open = async (blob) => {
    try { return await decryptContent(blob, key); } catch (err) {
      for (const k of others) { try { return await decryptContent(blob, k); } catch { /* next */ } }
      throw err;
    }
  };
  const [baseText, ourText, theirText] = await Promise.all([
    baseEncryptedContent ? open(baseEncryptedContent) : Promise.resolve(''),
    open(ourBody.encryptedContent),
    open(theirs.encryptedContent),
  ]);
  // Our text still holds unresolved conflict markers from an earlier merge:
  // merging it again would nest markers inside markers. It already carries
  // both sides, so it goes up as is and the markers stay for the person.
  const { text, conflicts } = ourText.includes(CONFLICT_OURS)
    ? { text: ourText, conflicts: ourText.split(CONFLICT_OURS).length - 1 }
    : mergeTexts(baseText, ourText, theirText);
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
  return { body, text, conflicts, theirs, ours: ourText };
}

// ---- uploads ----------------------------------------------------------------
//
// An edit of an existing slate is saved on this device first and uploaded
// from the queue: by the writer as it saves, by flushPending for whatever an
// earlier session or a failed upload left behind. One queued record, once
// its body is sent:
//
//   2xx, still the body queued  -> the record goes
//   2xx, a newer body queued    -> that body moves onto the version just
//                                  saved and goes next (after a merge its
//                                  base stays behind, so it merges in turn
//                                  instead of overwriting what came from
//                                  elsewhere; a body from another tab keeps
//                                  its base and merges)
//   409 against an earlier body of ours that landed unseen
//                               -> sent again on top of it, no merge
//   409                         -> merged with the server's copy, sent again
//   refused, no answer in 20 s, or no network
//                               -> stays queued; tried again in 5 s, 15 s,
//                                  60 s, then every minute while online, and
//                                  on every reconnect
//
// One upload per slate at a time, whoever asks (the writer, the flush, the
// retry timer, a lock change). Each body carries a saveRef the server
// remembers, so a repeat of a body that did land writes nothing.

// Sends for one slate take turns: an upload, then the next, or a lock
// change in between, never two at once
const sendTurns = new Map();
function onSendTurn(key, fn) {
  const next = (sendTurns.get(key) || Promise.resolve()).then(fn);
  const turn = next.catch(() => {});
  sendTurns.set(key, turn);
  turn.then(() => { if (sendTurns.get(key) === turn) sendTurns.delete(key); });
  return next;
}
// Run `fn` (a lock change) between uploads of this slate
export const withSlateSend = (userId, slateNumber, fn) => onSendTurn(slateKeyOf(userId, slateNumber), fn);

// slate key -> { again, promise } for the upload running now
const pumps = new Map();
// saveRef -> { key, resolve }: the writer waiting on the upload of its body
const waiting = new Map();
const resolveWaiter = (saveRef, outcome) => {
  const w = saveRef && waiting.get(saveRef);
  if (!w) return;
  waiting.delete(saveRef);
  w.resolve(outcome);
};

// Upload what is queued for this slate until nothing newer waits. Resolves
// with the outcome of the last attempt ({ landed: true, data, merged,
// history } or { landed: false, retry }), or null when nothing was queued.
export function uploadQueued(userId, slateNumber) {
  const key = slateKeyOf(userId, slateNumber);
  const running = pumps.get(key);
  if (running) { running.again = true; return running.promise; }
  const state = { again: false };
  state.promise = (async () => {
    let last = null;
    try {
      for (;;) {
        state.again = false;
        for (;;) {
          if (!isOnline()) return { landed: false, retry: true };
          const outcome = await onSendTurn(key, async () => {
            const p = await getPendingFor(userId, slateNumber);
            if (!p) return null;
            const out = p.op === 'post' ? await sendPost(userId, p) : await sendPut(userId, p);
            resolveWaiter(p.saveRef, out);
            return out;
          });
          if (!outcome) break;
          last = outcome;
          // A failure waits for the retry: trying again at once would fail the same way
          if (!outcome.landed) return last;
          // A newer body is waiting: it goes next
          if (outcome.state !== 'rebased' && outcome.state !== 'kept') break;
        }
        // Checked in the same step that ends the upload, so a save that
        // asks while it winds down is never left unsent
        if (!state.again) return last;
      }
    } catch (err) {
      console.warn('upload: queue unreadable', slateNumber, err);
      return { landed: false, retry: true };
    } finally {
      pumps.delete(key);
      // Whoever still waits had a body that never went up this time
      for (const [ref, w] of waiting) if (w.key === key) resolveWaiter(ref, { landed: false, retry: true });
    }
  })();
  pumps.set(key, state);
  return state.promise;
}

// Resolves once no upload for this slate is running
export const uploadSettled = (userId, slateNumber) => pumps.get(slateKeyOf(userId, slateNumber))?.promise ?? Promise.resolve(null);

// The writer's save of an existing slate: into the queue, onto the device
// copy, and up. `base()` is asked once the slate's earlier queue changes are
// done, so an upload that has just landed has moved it on by then. `parent`
// names the body the text was written on. Resolves once the text is on this
// device, with a promise of how its upload went.
export async function saveAndUpload(userId, slateNumber, body, base, parent) {
  const rec = await queuePending(userId, slateNumber, () => {
    const b = base();
    return { op: 'put', body, baseUpdatedAt: b?.updated_at ?? null, baseEncryptedContent: b?.encryptedContent ?? null, parent };
  });
  const uploaded = new Promise((resolve) => waiting.set(rec.saveRef, { key: rec.key, resolve }));
  uploadQueued(userId, slateNumber);
  // The copy is what the slate opens from while its edit waits; the queued
  // record holds the text either way
  await cacheSlate(userId, slateNumber, { encryptedContent: body.encryptedContent, encrypted_title: body.encryptedTitle }, { opened: true }).catch(() => {});
  return { saveRef: rec.saveRef, uploaded };
}

// A refusal another try cannot fix (bad request, gone, too large) waits for
// the next save or reconnect instead of the timer
const retryable = (status) => !status || status >= 500 || status === 408 || status === 409 || status === 429;
function failed(userId, p, err) {
  const status = err?.status ?? null;
  if (!status) reportNetworkFailure();
  emit({ type: 'failed', slateNumber: p.slateNumber });
  console.warn('offline sync: could not flush', p.slateNumber, err);
  const retry = retryable(status);
  if (retry) scheduleRetry(userId);
  return { landed: false, status, retry };
}

async function sendPost(userId, p) {
  try {
    const res = await call(`${API_URL}/slates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // The local number doubles as the create's idempotency key: if the online
      // save that spawned this queue entry did reach the server, this returns
      // that slate instead of a second one.
      body: JSON.stringify({ ...p.body, editorMode: p.editorMode, clientRef: p.slateNumber }),
    });
    if (!res.ok) throw Object.assign(new Error(`post ${res.status}`), { status: res.status });
    const slate = res.data;
    await renameCachedSlate(userId, p.slateNumber, slate.slate_number, { updated_at: slate.updated_at, is_published: 0, share_id: null });
    // Saved again while the create was on its way: that text follows as an
    // edit of the slate just made
    const state = await movePending(userId, p.slateNumber, slate.slate_number, p.saveRef, {
      baseUpdatedAt: slate.updated_at ?? null, baseEncryptedContent: p.body.encryptedContent ?? null,
    });
    emit({ type: 'synced', from: p.slateNumber, to: slate.slate_number, slate });
    if (state === 'moved') uploadQueued(userId, slate.slate_number);
    return { landed: true, state, data: slate };
  } catch (err) {
    return failed(userId, p, err);
  }
}

async function sendPut(userId, p) {
  const n = p.slateNumber;
  const put = (body) => call(`${API_URL}/slates/${encodeURIComponent(n)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    let sent = { ...p.body, baseUpdatedAt: p.baseUpdatedAt, saveRef: p.saveRef };
    let res = await put(sent);
    let merged = null;
    if (res.status === 409) {
      const theirs = await fetchCurrent(n);
      if (p.inDoubt?.includes(fingerprint(theirs.encryptedContent))) {
        // What moved the slate on was an earlier body of ours that landed
        // unseen: this one was written on top of it and simply follows
        sent = { ...sent, baseUpdatedAt: theirs.updated_at };
      } else {
        merged = await mergeWithServer(userId, n, p.body, p.baseEncryptedContent, theirs);
        // The merge goes up under a name of its own: the plain body, retried
        // after this landed, then merges again instead of passing for it
        sent = { ...merged.body, saveRef: p.saveRef ? `${p.saveRef}-m` : undefined };
      }
      res = await put(sent);
    }
    // No room for the version: the text goes up without it
    if (res.status === 413 && sent.history && res.data?.code === 'HISTORY_OVER') {
      const { history, ...rest } = sent;
      sent = rest;
      res = await put(sent);
    }
    if (!res.ok) throw Object.assign(new Error(`put ${res.status}`), { status: res.status });
    const data = res.data || {};
    // The version now on the server, so an open editor can base its next
    // save on it instead of the one it loaded
    const version = { updated_at: data.updated_at ?? null, encryptedContent: sent.encryptedContent };
    // A newer body written on top of this one moves onto the version just
    // saved; one from another line (a second tab) keeps its base and merges
    const rebase = (rec) => {
      if (!rec.inDoubt?.includes(fingerprint(p.body.encryptedContent))) return null;
      return merged
        ? { baseUpdatedAt: p.baseUpdatedAt ?? merged.theirs.updated_at ?? null, baseEncryptedContent: p.body.encryptedContent, inDoubt: [] }
        : { baseUpdatedAt: version.updated_at, baseEncryptedContent: sent.encryptedContent, inDoubt: [] };
    };
    const state = await settlePending(userId, n, p.saveRef, rebase, async (how) => {
      // The device copy keeps the newest text: the one sent, unless a
      // newer one waits in the queue
      const copy = how === 'rebased' || how === 'kept'
        ? { updated_at: version.updated_at }
        : { encryptedContent: sent.encryptedContent, encrypted_title: sent.encryptedTitle, updated_at: version.updated_at };
      await cacheSlate(userId, n, copy).catch(() => {});
      emit({ type: 'flushed', slateNumber: n, saveRef: p.saveRef, ...version });
      if (merged) emit({ type: 'merged', slateNumber: n, conflicts: merged.conflicts, text: merged.text, ours: merged.ours, ...version });
    });
    return { landed: true, state, data, merged, history: Boolean(sent.history) };
  } catch (err) {
    return failed(userId, p, err);
  }
}

// ---- flush and retry ---------------------------------------------------------

// Records are keyed by user, the session by cookie: the queue of an account
// that is not the one signed in here stays where it is
const signedIn = (userId) => {
  try {
    const current = localStorage.getItem('justtype-user-id');
    return current != null && current === String(userId);
  } catch { return true; }
};

let flushing = null;
export function flushPending(userId, { quiet = false } = {}) {
  if (!userId || !isOnline() || !signedIn(userId)) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    const queue = await getPending(userId);
    if (!queue.length) { retryStep = 0; return; }
    // Uploads already on their way (a slate just left) are no news: only
    // edits that were waiting make the flush say it is syncing
    const waited = queue.some(p => !pumps.has(slateKeyOf(userId, p.slateNumber)));
    emit({ type: 'started', count: queue.length, slates: queue.map(p => p.slateNumber), quiet: quiet || !waited });
    let failures = 0;
    for (const p of queue) {
      const outcome = await uploadQueued(userId, p.slateNumber);
      if (outcome && !outcome.landed) {
        failures++;
        if (!isOnline()) break;
      }
    }
    emit({ type: 'finished', failed: failures, quiet: quiet || !waited });
    if (!failures) retryStep = 0;
  })().catch((err) => { console.warn('offline sync: flush failed', err); }).finally(() => { flushing = null; });
  return flushing;
}

// While online and something is queued, the queue goes again on its own
// (5 s, 15 s, 60 s, then every minute), not only when the network returns
const RETRY_AFTER_MS = [5000, 15000, 60000];
let retryTimer = null;
let retryStep = 0;
function scheduleRetry(userId) {
  if (retryTimer || !userId) return;
  const wait = RETRY_AFTER_MS[Math.min(retryStep, RETRY_AFTER_MS.length - 1)];
  retryStep++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (isOnline()) flushPending(userId, { quiet: true });
  }, wait);
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
