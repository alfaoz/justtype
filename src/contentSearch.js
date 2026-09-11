// Content search. Slates are end-to-end encrypted, so the only place their
// text can be searched is on the device, after decrypting the copies it
// already holds. Plaintext lives in memory for the session and never touches
// storage. Slates that are not here can be fetched on request, one at a
// time, and become device copies the way opening them would.
import { API_URL } from './config';
import { decryptContent, unwrapKey } from './crypto';
import { getCachedSlates, cacheSlate, pruneCache } from './offlineStore';
import { getSlateKey } from './keyStore';

const texts = new Map(); // `${userId}:${slateNumber}` -> { updated_at, text }
const keyOf = (userId, n) => `${userId}:${n}`;

async function decryptCopy(data, masterKey) {
  if (!data?.encryptedContent) return null;
  const contentKey = data.is_collab && data.collab_wrapped_key
    ? await unwrapKey(data.collab_wrapped_key, masterKey)
    : masterKey;
  return decryptContent(data.encryptedContent, contentKey);
}

// Keep this version's text; the same version already in memory is not
// decrypted twice
async function remember(userId, n, data, masterKey) {
  const have = texts.get(keyOf(userId, n));
  const version = data?.updated_at ?? null;
  if (have && have.updated_at === version) return true;
  try {
    const text = await decryptCopy(data, masterKey);
    if (text == null) return false;
    texts.set(keyOf(userId, n), { updated_at: version, text });
    return true;
  } catch {
    return false;
  }
}

// Every copy on this device, decrypted into memory. Returns the numbers that
// can be searched.
export async function indexDevice(userId) {
  const masterKey = await getSlateKey(userId);
  if (!masterKey) return new Set();
  const rows = await getCachedSlates(userId).catch(() => []);
  const ok = new Set();
  for (const r of rows) {
    if (await remember(userId, r.slateNumber, r.data, masterKey)) ok.add(r.slateNumber);
  }
  return ok;
}

// The slates that are not here: two lanes, a breath between requests, a 429
// ends it. `onEach(n, ok)` fires as each one lands so results stream in.
export async function indexDeeper(userId, numbers, onEach) {
  const masterKey = await getSlateKey(userId);
  if (!masterKey) return;
  const queue = [...numbers];
  const lane = async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      const started = Date.now();
      try {
        const r = await fetch(`${API_URL}/slates/${n}`, { credentials: 'include' });
        if (r.status === 429) { queue.length = 0; onEach(n, false); break; }
        const data = r.ok ? await r.json() : null;
        const ok = data ? await remember(userId, n, data, masterKey) : false;
        if (data) cacheSlate(userId, n, data).catch(() => {});
        onEach(n, ok);
      } catch {
        onEach(n, false);
      }
      const wait = 250 - (Date.now() - started);
      if (wait > 0 && queue.length) await new Promise(res => setTimeout(res, wait));
    }
  };
  await Promise.all([lane(), lane()]);
  pruneCache(userId).catch(() => {});
}

// The first line holding the query, cut to fit a row, and how often the
// query appears. `q` is already lower-cased.
export function findIn(userId, n, q) {
  const rec = texts.get(keyOf(userId, n));
  if (!rec || !q) return null;
  const text = rec.text;
  const hay = text.toLowerCase();
  const at = hay.indexOf(q);
  if (at < 0) return null;
  let count = 0;
  for (let i = at; i >= 0; i = hay.indexOf(q, i + q.length)) count++;
  const lineStart = hay.lastIndexOf('\n', at) + 1;
  const lineEndRaw = hay.indexOf('\n', at);
  const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
  const from = Math.max(lineStart, at - 48);
  const to = Math.min(lineEnd, at + q.length + 72);
  let before = text.slice(from, at);
  if (from === lineStart) before = before.replace(/^#{1,6}\s+/, '');
  else before = '…' + before;
  const after = text.slice(at + q.length, to) + (to < lineEnd ? '…' : '');
  return { count, before, hit: text.slice(at, at + q.length), after };
}
