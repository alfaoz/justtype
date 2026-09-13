// The scratch slate: one per device, never synced, never counted.
//
// It lives in the offline store's list bucket under the account, encrypted
// under the master key like every device copy, and it has no number on the
// server. The writer opens it like a slate; the list shows it as a fixed
// row with the device mark and no cloud. Clear empties it; make it a slate
// moves the text into a real slate and empties it.
import { cacheList, getCachedList } from './offlineStore';
import { encryptContent, decryptContent } from './crypto';

export const SCRATCH_NUMBER = 'scratch';
export const isScratchNumber = (n) => n === SCRATCH_NUMBER;
export const scratchSlate = () => ({ slate_number: SCRATCH_NUMBER, scratch: true });
const keyOf = (userId) => `${userId}:scratch`;

export async function readScratch(userId, key) {
  if (!userId || !key) return { text: '', updatedAt: null };
  const rec = await getCachedList(keyOf(userId)).catch(() => null);
  const rows = rec?.rows;
  if (!rows?.encryptedContent) return { text: '', updatedAt: rows?.updatedAt || null };
  try {
    return { text: await decryptContent(rows.encryptedContent, key), updatedAt: rows.updatedAt || null };
  } catch {
    return { text: '', updatedAt: null };
  }
}

export async function writeScratch(userId, key, text) {
  if (!userId || !key) return;
  const encryptedContent = text ? await encryptContent(text, key) : null;
  await cacheList(keyOf(userId), { encryptedContent, updatedAt: Date.now() });
}

export const clearScratch = (userId) => cacheList(keyOf(userId), { encryptedContent: null, updatedAt: Date.now() });
