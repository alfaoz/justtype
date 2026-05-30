// Drop inbox: pulls app-created "drops" (new private slates an app encrypted to
// the user's public key) and adopts each as a normal master-key-encrypted slate.
// After adoption a drop is indistinguishable from a slate the user typed, and it
// survives the app being removed. Runs on unlock, on SSE/push wake, and on slate
// list open. All crypto is client-side; the server only moves opaque blobs.

import { API_URL } from './config';
import { encryptContent, encryptTitle, decryptDrop } from './crypto';
import { getUserPrivateKey } from './userKeys';

let sweeping = false;

// Decrypt one drop with the user's private key, re-encrypt under the master key,
// and adopt it server-side (which creates the slate and deletes the drop). The
// content key the app used is discarded — the adopted slate is keyed to the
// user's master key like every other slate. Returns true on success.
async function adoptOne(drop, userPrivateKey, masterKey) {
  const { content, title } = await decryptDrop(drop, userPrivateKey);
  const safeTitle = (title && title.trim()) || (content.split('\n')[0].trim() || 'untitled slate');
  const encryptedContent = await encryptContent(content, masterKey);
  const encryptedTitle = await encryptTitle(safeTitle, masterKey);
  const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
  const charCount = content.length;
  const sizeBytes = new TextEncoder().encode(content).length;
  const res = await fetch(`${API_URL}/account/slate-drops/${encodeURIComponent(drop.id)}/adopt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ encryptedContent, encryptedTitle, wordCount, charCount, sizeBytes })
  });
  return res.ok;
}

// Sweep all pending drops and adopt them. Returns the number adopted. Safe to
// call often; a single in-flight sweep is enforced. Best-effort and non-throwing.
// Pass onAdopted (optional) to refresh UI after at least one slate was created.
export async function sweepDrops(userId, masterKey, onAdopted) {
  if (!masterKey || sweeping) return 0;
  sweeping = true;
  let adopted = 0;
  try {
    const res = await fetch(`${API_URL}/account/slate-drops`, { credentials: 'include' });
    if (!res.ok) return 0;
    const drops = await res.json();
    if (!Array.isArray(drops) || drops.length === 0) return 0;

    const priv = await getUserPrivateKey(userId, masterKey);
    if (!priv) return 0; // keys not available; try again next unlock

    for (const drop of drops) {
      try {
        if (await adoptOne(drop, priv, masterKey)) adopted++;
      } catch (e) {
        console.warn('adopt drop failed', drop.id, e);
      }
    }
    if (adopted > 0 && typeof onAdopted === 'function') {
      try { onAdopted(adopted); } catch {}
    }
    return adopted;
  } catch (e) {
    console.warn('sweepDrops failed', e);
    return adopted;
  } finally {
    sweeping = false;
  }
}
