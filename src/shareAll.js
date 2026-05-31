// Shared "allow all private slates" logic, used by the Account → connected apps
// share modal (ShareSlates) and the reconcile sweep (when an app registers a new
// install). All crypto runs in the browser: each private slate is decrypted with
// the user's master key, re-encrypted under a fresh content key, and that key is
// wrapped to EACH of the app's per-installation device keys (so every install can
// read) plus the user's master key (so app edits sync back). The server only ever
// stores opaque blobs.

import { API_URL } from './config';
import { getSlateKey } from './keyStore';
import { decryptContent, decryptTitle, reencryptForApp } from './crypto';

// Concurrency scales with library size — 25% of the user's slates wrapped at once,
// capped at 32 (and floored at 1 so tiny libraries still make progress). Bigger
// libraries fan out wider; small ones don't open needless parallel requests.
const concurrencyFor = (total) => Math.min(32, Math.max(1, Math.ceil(total * 0.25)));

// Fetch one slate, decrypt with the master key, re-encrypt for the app's installs
// (+ owner). Returns the grant payload (incl. device_wraps[]) without uploading,
// so callers can batch. deviceKeys is [{device_id, public_key}].
async function wrapOne(n, deviceKeys, masterKey) {
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
  const grant = await reencryptForApp(content, title, deviceKeys, masterKey);
  return { slate_number: n, ...grant };
}

// Enable blanket access for a client and wrap every private slate to each of its
// registered installation keys. Records the share-all flag (idempotent), then
// wraps existing slates in small concurrent batches, uploading each batch in one
// request. Returns { shared, total, devices }. If the app has not registered any
// device key yet, only the intent is recorded (devices = 0) and the client wraps
// later, once an install connects (driven by reconcileDeviceWraps on the next
// unlock / 'reconcile' SSE). Throws 'locked' if the master key isn't on this device.
export async function enableShareAll(clientId, userId, { onProgress } = {}) {
  const masterKey = userId ? await getSlateKey(userId) : null;
  if (!masterKey) throw new Error('locked');

  // device keys + which slates are already shared
  const grantRes = await fetch(`${API_URL}/account/slate-grants/${encodeURIComponent(clientId)}`, { credentials: 'include' });
  const grantData = await grantRes.json();
  if (!grantRes.ok) throw new Error(grantData.error || 'not grantable');
  const deviceKeys = grantData.device_keys || [];

  // record intent so future slates auto-share (idempotent server-side)
  await fetch(`${API_URL}/account/slate-grants/share-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ client_id: clientId })
  });

  // Nothing to wrap to yet — the app hasn't connected an install. Intent is saved;
  // the reconcile sweep will wrap everything once a device key appears.
  if (deviceKeys.length === 0) return { shared: 0, total: 0, devices: 0 };

  const already = new Set((grantData.shared || []).map((g) => g.slate_number));

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
      try { return await wrapOne(n, deviceKeys, masterKey); } catch (e) { console.warn('wrap failed for', n, e); return null; }
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
  return { shared: total, total, devices: deviceKeys.length };
}

// Reconcile per-device wraps for every connected app: when a NEW install registers
// its key, slates already shared with that app (whether via "share all" or a
// per-slate / adopted create-delegated grant) have no wrap for the new install
// yet. This sweeps each app whose registered device keys don't fully cover its
// existing grants and re-wraps only the gaps. Idempotent and best-effort. Called
// on unlock and on the SSE 'reconcile' ping. Returns total (slate × device) wraps.
export async function reconcileDeviceWraps(userId, { onProgress } = {}) {
  const masterKey = userId ? await getSlateKey(userId) : null;
  if (!masterKey) return 0;
  let appsRes;
  try {
    appsRes = await fetch(`${API_URL}/account/connected-apps`, { credentials: 'include' });
  } catch { return 0; }
  if (!appsRes.ok) return 0;
  const apps = await appsRes.json();
  // Any app with the private scope + at least one registered install can have gaps.
  const candidates = (Array.isArray(apps) ? apps : []).filter((a) => a.can_share && a.device_count > 0);
  let wrappedTotal = 0;
  for (const app of candidates) {
    try {
      const gRes = await fetch(`${API_URL}/account/slate-grants/${encodeURIComponent(app.client_id)}`, { credentials: 'include' });
      if (!gRes.ok) continue;
      const g = await gRes.json();
      const deviceKeys = g.device_keys || [];
      if (deviceKeys.length === 0) continue;
      const allIds = deviceKeys.map((d) => d.device_id);
      const coverage = new Map((g.shared || []).map((s) => [s.slate_number, new Set(s.device_ids || [])]));

      // Determine which slates this app SHOULD have. For a share-all app that is the
      // whole private library (so brand-new intent with no grants yet still wraps);
      // otherwise only the slates already shared per-slate.
      let candidateNumbers;
      if (app.share_all) {
        const listRes = await fetch(`${API_URL}/slates`, { credentials: 'include' });
        if (!listRes.ok) continue;
        const list = await listRes.json();
        candidateNumbers = (Array.isArray(list) ? list : []).filter((m) => !m.is_published).map((m) => m.slate_number);
      } else {
        candidateNumbers = [...coverage.keys()];
      }

      // A slate needs (re)wrapping if it lacks a wrap for any current device, or has
      // no grant yet at all (not in coverage).
      const gaps = candidateNumbers.filter((n) => {
        const have = coverage.get(n);
        return !have || allIds.some((id) => !have.has(id));
      });
      if (gaps.length === 0) continue;
      onProgress?.({ client_id: app.client_id, total: gaps.length });
      const concurrency = concurrencyFor(gaps.length);
      for (let i = 0; i < gaps.length; i += concurrency) {
        const chunk = gaps.slice(i, i + concurrency);
        const wrapped = (await Promise.all(chunk.map(async (n) => {
          try { return await wrapOne(n, deviceKeys, masterKey); } catch { return null; }
        }))).filter(Boolean);
        if (wrapped.length) {
          await fetch(`${API_URL}/account/slate-grants/batch`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ client_id: app.client_id, grants: wrapped })
          });
          wrappedTotal += wrapped.length;
        }
      }
    } catch (e) { console.warn('reconcile failed for', app.client_id, e); }
  }
  return wrappedTotal;
}
