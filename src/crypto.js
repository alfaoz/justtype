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

// --- Key delegation (re-wrapping a slate for a third-party app) ---
// A third-party app holds an RSA-OAEP keypair and registers its public key.
// To grant the app read access to a private slate, the browser re-encrypts the
// slate under a fresh random content key and wraps that key to the app's public
// key. justtype only ever stores the opaque results; it cannot read them.

// Generate an RSA-OAEP 2048 keypair for an app. Returns base64 SPKI public key
// (for registration / browser import) and a PKCS8 PEM private key (for the app).
export async function generateAppKeyPair() {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt']
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  return {
    publicKeySpkiBase64: bufToBase64(spki),
    publicKeyPem: pemEncode(spki, 'PUBLIC KEY'),
    privateKeyPem: pemEncode(pkcs8, 'PRIVATE KEY')
  };
}

// Import an app's public key (base64 SPKI DER) for wrapping.
export async function importAppPublicKey(spkiBase64) {
  const der = base64ToBuf(spkiBase64);
  return crypto.subtle.importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
}

// Wrap raw key bytes to an app's RSA-OAEP public key. Returns base64.
export async function wrapKeyToAppKey(keyBytes, appPublicKey) {
  const out = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, appPublicKey, keyBytes);
  return bufToBase64(new Uint8Array(out));
}

// Re-encrypt a slate's plaintext for an app. Generates a fresh content key,
// encrypts content + title under it (justtype's own blob format), and wraps the
// content key to the app's public key. Returns base64 blobs ready to upload.
export async function reencryptForApp(plainContent, plainTitle, appPublicKey) {
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const enc_content = await encryptContent(plainContent || '', contentKey);
  const enc_title = (plainTitle != null && plainTitle !== '') ? await encryptTitle(plainTitle, contentKey) : null;
  const wrapped_key = await wrapKeyToAppKey(contentKey, appPublicKey);
  return { wrapped_key, enc_content, enc_title };
}

function pemEncode(bytes, label) {
  const b64 = bufToBase64(bytes);
  const lines = (b64.match(/.{1,64}/g) || []).join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
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
