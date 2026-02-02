# encryption deep dive

a technical walkthrough of justtype's zero-knowledge encryption system.

## overview

justtype is designed so the server never has access to plaintext slate content. all encryption and decryption happens client-side. the server stores ciphertext, salts, and wrapped keys, but never the raw encryption key or your password.

## key derivation

when a user signs up with a password, the server generates a random 32-byte `encryption_salt` and stores it in the `users` table. the encryption key is derived as:

```
password + encryption_salt -> PBKDF2-SHA256 (100,000 iterations) -> 256-bit key
```

this key is used directly for aes-256-gcm encryption of slate content. the derived key is cached server-side in memory for 24 hours (`encryptionKeyCache` in `server/index.js`) to avoid re-deriving on every request. the cache is keyed by user id and cleared on logout or server restart.

the key is derived server-side during login, used for encrypt/decrypt operations on that server instance, and never persisted to disk or transmitted to any external service.

## encryption format

each encrypted slate is stored as a single binary blob on backblaze b2:

```
| IV (16 bytes) | Auth Tag (16 bytes) | Ciphertext (variable) |
```

- **iv**: random 16-byte initialization vector, unique per encryption operation
- **auth tag**: 16-byte gcm authentication tag, ensures integrity and authenticity
- **ciphertext**: aes-256-gcm encrypted slate content (utf-8 encoded)

encryption and decryption are implemented in `server/b2Storage.js` using node's `crypto` module.

## three-state publishing

slates have three publish states tracked by `is_published` in the database:

| state | `is_published` | behavior |
|-------|----------------|----------|
| private | `0` | encrypted blob on b2, requires auth to access |
| published | `1` | encrypted blob (private) + separate unencrypted blob (public) with a `share_id` |
| republish pending | `2` | public copy deleted, needs re-upload on next publish |

when you publish a slate, the server decrypts it using your cached key, then uploads a plaintext copy to a separate b2 file (`b2_public_file_id`). this public copy is served at `/s/:shareId` without authentication.

unpublishing deletes the public b2 file and sets `is_published = 0`. the encrypted private copy is untouched.

## recovery key system

since the encryption key is derived from your password, forgetting your password means losing access to your slates. the recovery key system provides a backup path.

### how it works

1. on signup (or password change), a 12-word mnemonic is generated from the bip39 wordlist (`src/bip39-wordlist.js`)
2. the raw 256-bit encryption key (the "slate key") is wrapped (encrypted) using a key derived from the recovery phrase
3. the wrapped key is stored server-side in the `users` table as `wrapped_slate_key`
4. the recovery phrase is shown to the user once and never stored

### key wrapping

```
recovery phrase -> PBKDF2-SHA256 (100,000 iterations, recovery-specific salt) -> wrapping key
slate key -> AES-256-GCM encrypt with wrapping key -> wrapped_slate_key (stored in db)
```

the wrapping salt (`recovery_salt`) is stored alongside the wrapped key.

### password reset with recovery

when a user resets their password with their recovery key:

1. the wrapped key is decrypted using the recovery phrase to recover the original slate key
2. a new encryption salt is generated for the new password
3. the slate key is re-wrapped with a new recovery phrase
4. all existing encrypted slates remain readable because the underlying slate key hasn't changed

### password reset without recovery

if the user has no recovery key, password reset deletes all encrypted slates. there is no backdoor. the old key is gone.

## google oauth users

google oauth users don't have a password to derive a key from. instead:

1. on first login, a random slate key is generated
2. the user sets a 6-digit pin
3. the pin is used (via pbkdf2) to wrap the slate key, stored as `wrapped_slate_key`
4. on subsequent logins, the user enters their pin to unwrap the key
5. the pin can be recovered using the 12-word recovery phrase (same system as password users)

the pin is never stored. only the wrapped key and pin salt are persisted.

## client-side key management

on the client side (`src/crypto.js` and `src/keyStore.js`):

- `crypto.js` handles key derivation (`deriveKey`), key wrapping/unwrapping (`wrapKey`/`unwrapKey`), and recovery phrase generation using the web crypto api
- `keyStore.js` manages storing/retrieving the raw slate key in the browser's indexeddb, so users don't need to re-enter their password on every page load
- the key in indexeddb is scoped per user id and cleared on logout

## build verification

the [/verify](https://justtype.io/verify) page lets users confirm the code running in their browser matches the public repo. it compares sha-256 hashes from three independent sources:

1. **server**: `build-manifest.json` served by justtype's server
2. **github actions**: `build-hashes.json` built by a [public workflow](https://github.com/alfaoz/justtype/blob/master/.github/workflows/publish-hashes.yml) and published to github pages
3. **browser-computed**: hashes calculated from the actual js/css files the browser received

if all three match, the served code is the open-source code. users can also clone the repo, build it themselves, and compare hashes for full zero-trust verification.

the github actions workflow is auditable: it runs `npm ci && npm run build` on the public repo with no modifications. the hashes are published to [alfaoz.github.io/justtype/build-hashes.json](https://alfaoz.github.io/justtype/build-hashes.json).

## relevant source files

| file | what it does |
|------|-------------|
| `server/index.js` | key derivation, encryption key cache, api routes |
| `server/b2Storage.js` | aes-256-gcm encrypt/decrypt, b2 upload/download |
| `server/database.js` | schema with encryption_salt, wrapped_slate_key columns |
| `src/crypto.js` | client-side web crypto api: deriveKey, wrapKey, unwrapKey |
| `src/keyStore.js` | indexeddb key storage |
| `src/bip39-wordlist.js` | bip39 wordlist for recovery phrase generation |
| `src/components/Verify.jsx` | three-way hash verification ui |
| `.github/workflows/publish-hashes.yml` | ci workflow that builds and publishes hashes |
