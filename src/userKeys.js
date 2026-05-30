// User keypair lifecycle for the "drop box" feature: ensures the logged-in user
// has a published RSA-OAEP public key (so apps can encrypt new slates to them)
// and a master-key-wrapped private key (so the user can decrypt drops on any
// device). The server only ever stores the public key + the wrapped private key
// — never the usable private key. All crypto happens here, client-side.

import { API_URL } from './config';
import {
  generateUserKeypair, wrapPrivateKey, unwrapPrivateKey, importUserPrivateKey
} from './crypto';

// In-memory cache of the imported private CryptoKey, per user id. Lives for the
// session only; recovered from the server-stored wrapped key on demand.
const privateKeyCache = new Map();

// Ensure the user has a keypair. If the server has none, generate one, wrap the
// private key under the master key, and publish. Either way, leaves the imported
// private key in the in-memory cache. Returns true if a key is available.
// masterKey is the raw 32-byte slate/master key (from keyStore). Non-throwing.
export async function ensureUserKeypair(userId, masterKey) {
  if (!masterKey) return false;
  if (privateKeyCache.has(userId)) return true;
  try {
    const res = await fetch(`${API_URL}/account/keypair`, { credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();

    if (data.has_keypair && data.enc_private_key) {
      // Recover the existing private key from the wrapped copy.
      const priv = await unwrapPrivateKey(data.enc_private_key, masterKey);
      privateKeyCache.set(userId, priv);
      return true;
    }

    // No keypair yet — generate, wrap, publish.
    const { publicKeySpkiBase64, privateKeyPkcs8 } = await generateUserKeypair();
    const enc_private_key = await wrapPrivateKey(privateKeyPkcs8, masterKey);
    const pub = await fetch(`${API_URL}/account/keypair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ public_key: publicKeySpkiBase64, enc_private_key })
    });
    if (!pub.ok) return false;
    const priv = await importUserPrivateKey(privateKeyPkcs8);
    privateKeyCache.set(userId, priv);
    return true;
  } catch (e) {
    console.warn('ensureUserKeypair failed', e);
    return false;
  }
}

// Get the cached private CryptoKey, recovering it from the server if needed.
export async function getUserPrivateKey(userId, masterKey) {
  if (privateKeyCache.has(userId)) return privateKeyCache.get(userId);
  const ok = await ensureUserKeypair(userId, masterKey);
  return ok ? privateKeyCache.get(userId) : null;
}

// Clear the cached private key (on logout).
export function clearUserPrivateKey(userId) {
  if (userId == null) privateKeyCache.clear();
  else privateKeyCache.delete(userId);
}
