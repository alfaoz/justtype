// Shared "allow all private slates" logic, used by both the Account → connected
// apps share modal (ShareSlates) and the inline consent → React handoff
// (AuthorizeShare). All crypto runs in the browser: each private slate is decrypted
// with the user's master key, re-encrypted under a fresh content key, and that key
// is wrapped to BOTH the app's public key (so the app can read) and the user's
// master key (so app edits can sync back). justtype only ever stores opaque blobs.

import { API_URL } from './config';
import { getSlateKey } from './keyStore';
import { decryptContent, decryptTitle, importAppPublicKey, reencryptForApp } from './crypto';

// Concurrency scales with library size — 25% of the user's slates wrapped at once,
// capped at 32 (and floored at 1 so tiny libraries still make progress). Bigger
// libraries fan out wider; small ones don't open needless parallel requests.
const concurrencyFor = (total) => Math.min(32, Math.max(1, Math.ceil(total * 0.25)));

// Fetch one slate, decrypt with the master key, re-encrypt for the app (+ owner).
// Returns the grant payload without uploading, so callers can batch.
async function wrapOne(n, appKey, masterKey) {
  const res = await fetch(`${API_URL}/slates/${encodeURIComponent(n)}`, { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'failed to read slate');
  const content = data.encryptedContent
    ? await decryptContent(data.encryptedContent, masterKey)
    : (typeof data.content === 'string' ? data.content : '');
  let title = (data.title || '').trim();
  if ((!title || title === 'untitled') && data.encrypted_title) {
    try { title = (await decryptTitle(data.encrypted_title, masterKey)).trim(); } catch { title = ''; }
  }
  const grant = await reencryptForApp(content, title, appKey, masterKey);
  return { slate_number: n, ...grant };
}

// Enable blanket access for a client and wrap every private slate to it. Records
// the share-all flag (idempotent), then wraps existing slates in small concurrent
// batches, uploading each batch in one request. Returns { shared, total }.
// Throws 'locked' if the master key isn't available on this device.
export async function enableShareAll(clientId, userId, { onProgress } = {}) {
  const masterKey = userId ? await getSlateKey(userId) : null;
  if (!masterKey) throw new Error('locked');

  // public key + which slates are already shared
  const grantRes = await fetch(`${API_URL}/account/slate-grants/${encodeURIComponent(clientId)}`, { credentials: 'include' });
  const grantData = await grantRes.json();
  if (!grantRes.ok) throw new Error(grantData.error || 'not grantable');
  const appKey = await importAppPublicKey(grantData.public_key);
  const already = new Set((grantData.shared || []).map((g) => g.slate_number));

  // record intent so future slates auto-share (idempotent server-side)
  await fetch(`${API_URL}/account/slate-grants/share-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ client_id: clientId })
  });

  // private (unpublished) slates only — published ones are readable via the public scope
  const listRes = await fetch(`${API_URL}/slates`, { credentials: 'include' });
  const listData = await listRes.json();
  if (!listRes.ok) throw new Error(listData.error || 'failed to load slates');
  const todo = (Array.isArray(listData) ? listData : [])
    .filter((m) => !m.is_published && !already.has(m.slate_number))
    .map((m) => m.slate_number);

  const total = todo.length;
  const concurrency = concurrencyFor(total);
  let done = 0;
  onProgress?.({ done, total });
  for (let i = 0; i < todo.length; i += concurrency) {
    const chunk = todo.slice(i, i + concurrency);
    const wrapped = (await Promise.all(chunk.map(async (n) => {
      try { return await wrapOne(n, appKey, masterKey); } catch (e) { console.warn('wrap failed for', n, e); return null; }
    }))).filter(Boolean);
    if (wrapped.length) {
      await fetch(`${API_URL}/account/slate-grants/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ client_id: clientId, grants: wrapped })
      });
    }
    done += chunk.length;
    onProgress?.({ done, total });
  }
  return { shared: total, total };
}
