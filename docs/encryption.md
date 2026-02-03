# encryption deep dive

a technical walkthrough of justtype's encryption system.

## overview

justtype has two encryption modes: a legacy server-side mode and a newer end-to-end (e2e) mode where the server never sees plaintext. new accounts are created in e2e mode by default. legacy users are migrated to e2e on their next login.

in e2e mode, all encryption and decryption happens in the browser using the web crypto api. the server only ever stores and shuttles opaque ciphertext. it never sees your password-derived key or your plaintext content.

in legacy mode, the server derives the encryption key and handles encrypt/decrypt operations. this is encrypted-at-rest, not zero-knowledge. it protects against database or storage breaches, but not against a compromised server or a nosy operator. legacy mode exists only as a transitional state for users who haven't logged in since the e2e migration was shipped.

the user base is 5 people, so the "migration" is less of a migration and more of a group chat message saying "hey log in again."

## e2e mode (current)

### how it works

1. on signup, the client generates a random 32-byte slate key and a random encryption salt
2. the client derives a wrapping key from the user's password via pbkdf2 (600,000 iterations, sha-256)
3. the slate key is wrapped (encrypted) with the wrapping key using aes-256-gcm
4. only the wrapped key, encryption salt, and recovery data are sent to the server
5. the server never sees the raw slate key or the password-derived wrapping key

```
password + encryption_salt -> PBKDF2-SHA256 (600k iterations) -> wrapping key
random slate key -> AES-256-GCM encrypt with wrapping key -> wrapped_key (stored in db)
```

### saving a slate

1. client encrypts content with the slate key using aes-256-gcm (web crypto api)
2. client sends the encrypted blob (base64) to the server
3. server uploads the opaque blob to b2 via `uploadRawSlate()`, never touching the plaintext
4. server rejects plaintext content from e2e users (`E2E_PLAINTEXT_REJECTED`)

### loading a slate

1. server downloads the raw encrypted blob from b2 via `downloadRawFile()`
2. server sends the blob (base64) to the client
3. client decrypts locally with the slate key

### client-side key storage

the raw slate key is stored in the browser's indexeddb (`src/keyStore.js`), scoped per user id and cleared on logout. this means users don't need to re-enter their password on every page load, just on first login in a new browser.

`src/crypto.js` handles all cryptographic operations client-side: key derivation (`deriveKey`), key wrapping/unwrapping (`wrapKey`/`unwrapKey`), content encryption/decryption (`encryptContent`/`decryptContent`), and recovery phrase generation. all using the web crypto api.

## legacy mode (deprecated)

in legacy mode, the server derives the encryption key from the user's password during login:

```
password + encryption_salt -> PBKDF2-SHA256 (100k iterations) -> 256-bit encryption key
```

the derived key is cached server-side in memory for 24 hours (`encryptionKeyCache` in `server/index.js`). encryption and decryption happen in `server/b2Storage.js` using node's `crypto` module. the server sees plaintext content during every save and load.

this is **not zero-knowledge**. it's encrypted-at-rest. legacy mode will be removed once all users have migrated to e2e.

## encryption format

both modes use the same binary format for encrypted blobs on b2:

```
| IV (16 bytes) | Auth Tag (16 bytes) | Ciphertext (variable) |
```

- **iv**: random 16-byte initialization vector, unique per encryption operation
- **auth tag**: 16-byte gcm authentication tag, ensures integrity and authenticity
- **ciphertext**: aes-256-gcm encrypted content (utf-8 encoded)

the format is identical between client and server implementations so that migrated slates don't need to be re-encrypted.

## three-state publishing

slates have three publish states tracked by `is_published` in the database:

| state | `is_published` | behavior |
|-------|----------------|----------|
| private | `0` | encrypted blob on b2, requires auth to access |
| published | `1` | encrypted blob (private) + separate unencrypted blob (public) with a `share_id` |
| republish pending | `2` | public copy deleted, needs re-upload on next publish |

publishing inherently means making content readable, so a plaintext copy is created:

- **e2e users**: the client decrypts locally, then sends the plaintext `publicContent` to the server for the public copy
- **legacy users**: the server decrypts using the cached key

unpublishing deletes the public b2 file and sets `is_published = 0`. the encrypted private copy is untouched.

## recovery key system

since the encryption key is ultimately protected by your password (or pin), forgetting it means losing access to your slates. the recovery key system provides a backup path.

### how it works

1. on signup (or password change), a 12-word mnemonic is generated from the bip39 wordlist (`src/bip39-wordlist.js`)
2. the raw slate key is wrapped using a key derived from the recovery phrase
3. the wrapped recovery key is stored server-side as `recovery_wrapped_key`
4. the recovery phrase is shown to the user once and never stored

### key wrapping

```
recovery phrase -> PBKDF2-SHA256 (600k iterations, recovery-specific salt) -> wrapping key
slate key -> AES-256-GCM encrypt with wrapping key -> recovery_wrapped_key (stored in db)
```

the wrapping salt (`recovery_salt`) is stored alongside the wrapped key.

### password reset with recovery

when a user resets their password with their recovery key:

1. the recovery wrapped key is decrypted using the recovery phrase to recover the original slate key
2. a new wrapping key is derived from the new password
3. the slate key is re-wrapped with the new password key and a new recovery phrase
4. all existing encrypted slates remain readable because the underlying slate key hasn't changed

### password reset without recovery

if the user has no recovery key, password reset deletes all encrypted slates. there is no backdoor. the old key is gone.

## google oauth users

google oauth users don't have a password to derive a key from. instead:

1. on first login, a random slate key is generated
2. the user sets a 6-digit pin
3. the pin is used (via pbkdf2) to wrap the slate key, stored as `wrapped_key`
4. on subsequent logins, the user enters their pin to unwrap the key
5. the pin can be recovered using the 12-word recovery phrase (same system as password users)

the pin is never stored. only the wrapped key and pin salt are persisted.

## build verification

the [/verify](https://justtype.io/verify) page lets users confirm the code running in their browser matches the public repo. it compares sha-256 hashes from three independent sources:

1. **server**: `build-manifest.json` served by justtype's server
2. **github actions**: `build-hashes.json` built by a [public workflow](https://github.com/alfaoz/justtype/blob/master/.github/workflows/publish-hashes.yml) and published to github pages
3. **browser-computed**: hashes calculated from the actual js/css files the browser received

if all three match, the served code is the open-source code. users can also clone the repo, build it themselves, and compare hashes for full zero-trust verification.

this matters specifically because of e2e encryption. since the client does all the crypto, verifying that the client code hasn't been tampered with is the most important thing to verify. a malicious client could exfiltrate keys or plaintext before encryption. build verification closes that gap.

the github actions workflow is auditable: it runs `npm ci && npm run build` on the public repo with no modifications. the hashes are published to [alfaoz.github.io/justtype/build-hashes.json](https://alfaoz.github.io/justtype/build-hashes.json).

## relevant source files

| file | what it does |
|------|-------------|
| `server/index.js` | api routes, e2e/legacy routing, encryption key cache (legacy) |
| `server/b2Storage.js` | b2 upload/download, server-side aes-256-gcm (legacy), raw blob passthrough (e2e) |
| `server/database.js` | schema with encryption_salt, wrapped_key, e2e_migrated columns |
| `src/crypto.js` | client-side web crypto api: deriveKey, wrapKey, unwrapKey, encryptContent, decryptContent |
| `src/keyStore.js` | indexeddb key storage for slate keys |
| `src/bip39-wordlist.js` | bip39 wordlist for recovery phrase generation |
| `src/components/Verify.jsx` | three-way hash verification ui |
| `.github/workflows/publish-hashes.yml` | ci workflow that builds and publishes hashes |
