// Shares that keep the zero-knowledge promise.
//
// A public link is what publishing always was: a plaintext copy at /s/:id.
// A private link encrypts title and text under a fresh share key that
// travels in the URL fragment, which never reaches the server; the key is
// also kept wrapped under the master key so later edits re-encrypt under
// it. A passphrase wraps the share key under a key derived from the phrase
// (the server holds only that wrap), and the URL carries nothing.
import { generateSlateKey, generateSalt, deriveKey, wrapKey, unwrapKey, encryptContent, decryptContent } from './crypto';

export const makeShareKey = () => generateSlateKey();

const toUrl = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrl = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};

export const fragmentOf = (key) => `k=${toUrl(key)}`;
export function keyFromFragment(hash = window.location.hash) {
  const m = (hash || '').match(/(?:^#|&)k=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try { const k = fromUrl(m[1]); return k.length === 32 ? k : null; } catch { return null; }
}

// The shared copy: title, text and the byline as one encrypted payload,
// so the server holds nothing readable about a private link at all
export const encryptShare = ({ title, text, author, updatedAt, editorMode }, key) => encryptContent(JSON.stringify({ title, text, author, updatedAt, editorMode }), key);
export async function decryptShare(blob, key) {
  const parsed = JSON.parse(await decryptContent(blob, key));
  return { title: parsed.title || '', text: parsed.text || '', author: parsed.author || null, updatedAt: parsed.updatedAt || null, editorMode: parsed.editorMode || null };
}

export async function wrapForPassphrase(key, phrase) {
  const salt = generateSalt();
  return { salt, wrappedKey: await wrapKey(key, await deriveKey(phrase.trim(), salt)) };
}
export async function unwrapWithPassphrase(wrappedKey, salt, phrase) {
  try { return await unwrapKey(wrappedKey, await deriveKey(phrase.trim(), salt)); }
  catch { throw new Error('wrong'); }
}

export const EXPIRY_CHOICES = ['never', 'day', 'week', 'month'];
const SPANS = { day: 86400, week: 7 * 86400, month: 30 * 86400 };
export const expiryAt = (choice) => (SPANS[choice] ? Math.floor(Date.now() / 1000) + SPANS[choice] : null);
// The nearest choice for an expiry already set, for the row to show
export function expiryChoice(expiresAt) {
  if (!expiresAt) return 'never';
  const left = expiresAt - Math.floor(Date.now() / 1000);
  if (left <= SPANS.day) return 'day';
  if (left <= SPANS.week) return 'week';
  return 'month';
}
