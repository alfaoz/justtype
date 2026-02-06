// Client-side encryption using Web Crypto API
// Format matches server: IV(16) + AuthTag(16) + Ciphertext, AES-256-GCM

const PBKDF2_ITERATIONS = 600000;
const PBKDF2_ITERATIONS_PIN = 600000;
const KEY_LENGTH = 256; // bits
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// Generate a random 32-byte slate key
export async function generateSlateKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

// Generate a random salt as hex string
export function generateSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bufToHex(bytes);
}

// Derive a 32-byte key from password + salt using PBKDF2
export async function deriveKey(password, saltHex, { pin = false } = {}) {
  const enc = new TextEncoder();
  const salt = hexToBuf(saltHex);
  const iterations = pin ? PBKDF2_ITERATIONS_PIN : PBKDF2_ITERATIONS;
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    KEY_LENGTH
  );
  return new Uint8Array(bits);
}

// Wrap (encrypt) a key with a wrapping key. Returns base64 string.
// Output format: IV(16) + AuthTag(16) + Ciphertext  (as base64)
export async function wrapKey(keyToWrap, wrappingKeyBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', wrappingKeyBytes, 'AES-GCM', false, ['encrypt']
  );
  // Web Crypto GCM returns ciphertext + tag concatenated
  const result = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH * 8 },
    cryptoKey,
    keyToWrap
  );
  const resultBytes = new Uint8Array(result);
  // Split: ciphertext is all but last 16 bytes, tag is last 16 bytes
  const ciphertext = resultBytes.slice(0, resultBytes.length - TAG_LENGTH);
  const authTag = resultBytes.slice(resultBytes.length - TAG_LENGTH);
  // Reformat as IV + Tag + Ciphertext to match server format
  const combined = new Uint8Array(IV_LENGTH + TAG_LENGTH + ciphertext.length);
  combined.set(iv, 0);
  combined.set(authTag, IV_LENGTH);
  combined.set(ciphertext, IV_LENGTH + TAG_LENGTH);
  return bufToBase64(combined);
}

// Unwrap (decrypt) a key. Input is base64 string, returns Uint8Array.
export async function unwrapKey(wrappedBase64, wrappingKeyBytes) {
  const data = base64ToBuf(wrappedBase64);
  const iv = data.slice(0, IV_LENGTH);
  const authTag = data.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.slice(IV_LENGTH + TAG_LENGTH);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', wrappingKeyBytes, 'AES-GCM', false, ['decrypt']
  );
  // Web Crypto expects ciphertext + tag concatenated
  const input = new Uint8Array(ciphertext.length + TAG_LENGTH);
  input.set(ciphertext, 0);
  input.set(authTag, ciphertext.length);
  const result = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH * 8 },
    cryptoKey,
    input
  );
  return new Uint8Array(result);
}

// Encrypt content string. Returns base64 blob.
// Wraps as JSON {content, uploadedAt} before encrypting, matching B2 format.
export async function encryptContent(plaintext, slateKeyBytes) {
  const payload = JSON.stringify({ content: plaintext, uploadedAt: new Date().toISOString() });
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', slateKeyBytes, 'AES-GCM', false, ['encrypt']
  );
  const result = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH * 8 },
    cryptoKey,
    enc.encode(payload)
  );
  const resultBytes = new Uint8Array(result);
  const ciphertext = resultBytes.slice(0, resultBytes.length - TAG_LENGTH);
  const authTag = resultBytes.slice(resultBytes.length - TAG_LENGTH);
  const combined = new Uint8Array(IV_LENGTH + TAG_LENGTH + ciphertext.length);
  combined.set(iv, 0);
  combined.set(authTag, IV_LENGTH);
  combined.set(ciphertext, IV_LENGTH + TAG_LENGTH);
  return bufToBase64(combined);
}

// Decrypt content blob. Returns plaintext string.
export async function decryptContent(base64Blob, slateKeyBytes) {
  const data = base64ToBuf(base64Blob);
  const iv = data.slice(0, IV_LENGTH);
  const authTag = data.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.slice(IV_LENGTH + TAG_LENGTH);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', slateKeyBytes, 'AES-GCM', false, ['decrypt']
  );
  const input = new Uint8Array(ciphertext.length + TAG_LENGTH);
  input.set(ciphertext, 0);
  input.set(authTag, ciphertext.length);
  const result = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH * 8 },
    cryptoKey,
    input
  );
  const dec = new TextDecoder();
  const parsed = JSON.parse(dec.decode(result));
  return parsed.content;
}

// Encrypt a title string. Returns base64 blob.
export async function encryptTitle(plaintext, slateKeyBytes) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', slateKeyBytes, 'AES-GCM', false, ['encrypt']
  );
  const result = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH * 8 },
    cryptoKey,
    enc.encode(plaintext)
  );
  const resultBytes = new Uint8Array(result);
  const ciphertext = resultBytes.slice(0, resultBytes.length - TAG_LENGTH);
  const authTag = resultBytes.slice(resultBytes.length - TAG_LENGTH);
  const combined = new Uint8Array(IV_LENGTH + TAG_LENGTH + ciphertext.length);
  combined.set(iv, 0);
  combined.set(authTag, IV_LENGTH);
  combined.set(ciphertext, IV_LENGTH + TAG_LENGTH);
  return bufToBase64(combined);
}

// Decrypt a title blob. Returns plaintext string.
export async function decryptTitle(base64Blob, slateKeyBytes) {
  const data = base64ToBuf(base64Blob);
  const iv = data.slice(0, IV_LENGTH);
  const authTag = data.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.slice(IV_LENGTH + TAG_LENGTH);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', slateKeyBytes, 'AES-GCM', false, ['decrypt']
  );
  const input = new Uint8Array(ciphertext.length + TAG_LENGTH);
  input.set(ciphertext, 0);
  input.set(authTag, ciphertext.length);
  const result = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH * 8 },
    cryptoKey,
    input
  );
  return new TextDecoder().decode(result);
}

// Encrypt an array of tags (strings). Returns base64 blob.
export async function encryptTags(tags, slateKeyBytes) {
  return encryptTitle(JSON.stringify(tags), slateKeyBytes);
}

// Decrypt a tags blob. Returns array of strings (best-effort).
export async function decryptTags(base64Blob, slateKeyBytes) {
  const plaintext = await decryptTitle(base64Blob, slateKeyBytes);
  try {
    const parsed = JSON.parse(plaintext);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(t => typeof t === 'string');
  } catch {
    return [];
  }
}

// Generate a 12-word BIP39 recovery phrase
export function generateRecoveryPhrase(wordlist) {
  const indices = crypto.getRandomValues(new Uint16Array(12));
  const words = [];
  for (let i = 0; i < 12; i++) {
    words.push(wordlist[indices[i] % wordlist.length]);
  }
  return words.join(' ');
}

// --- Helpers ---

function bufToHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bufToBase64(buf) {
  let binary = '';
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
