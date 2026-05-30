# justtype developer api — full reference & crypto contract

This is the complete, plain-text reference for integrating with justtype's OAuth 2.0
API, including the end-to-end-encryption contract third-party apps must follow to
read and write private slates. It is served as static markdown (no JavaScript
required) so tools, AI agents, and `curl` can read it directly.

- Base URL: `https://justtype.io`
- This document: `https://justtype.io/dev/spec.md`
- Interactive version (human): `https://justtype.io/dev`

justtype is zero-knowledge: the server never sees the plaintext of a private slate.
Identity and published content are normal REST. Private slates require a small amount
of client-side cryptography, fully specified below.

---

## 1. Concepts

A **slate** is a document. It is one of:

- **published** — world-public. Stored unencrypted (it is served to anonymous
  viewers at `/s/:shareId`). An app reads its plaintext directly.
- **private** — end-to-end encrypted under the user's master key. The server only
  holds ciphertext. An app can read/write a private slate **only** if the user
  delegates it (see §6), via per-slate key wrapping.

There is one read endpoint for individual slates (`GET /api/oauth/slates/:n`); it
returns plaintext for published slates, a decryptable blob for delegated private
slates, and opaque ciphertext for private slates not shared with you.

---

## 2. OAuth 2.0 flow (authorization code + PKCE)

Standard PKCE flow, S256 only. Public clients need no secret.

1. Generate a PKCE `code_verifier` (random) and `code_challenge = base64url(sha256(verifier))`.
2. Redirect the user to `GET /oauth/authorize` with query params:
   `response_type=code`, `client_id`, `redirect_uri`, `scope` (space-separated),
   `state`, `code_challenge`, `code_challenge_method=S256`.
3. The user approves on a justtype consent screen; you receive `?code=...` (and your
   `state`) at your `redirect_uri`. Codes are single-use and expire in 60 seconds.
4. Exchange the code at `POST /oauth/token`.

Always verify `state`. Tokens go in the `Authorization: Bearer <token>` header (never
cookies). Access tokens last 1 hour; refresh tokens last 90 days and rotate on every
refresh (use the new one each time).

### Redirect URIs
Registered redirect URIs are matched exactly. Allowed forms:
- `https://...` (web apps)
- `http://localhost/...` or `http://127.0.0.1/...` (desktop/dev loopback)
- Private-use URI schemes for native apps, e.g. `com.example.app://callback`
  (reverse-domain recommended, RFC 8252). `javascript:`, `data:`, `file:`,
  `blob:`, and `vbscript:` are rejected.

---

## 3. Scopes

| scope | grants |
|---|---|
| `identity` | username (and user id) |
| `email` | verified email address |
| `slates:read:public` | read published slates (title + full text) |
| `slates:read:meta` | list slates with counts/dates (private titles stay encrypted) |
| `slates:read:private` | read private slates the user shares with you (per-slate, revocable). **Also satisfies `slates:read:public`** — it is the full-read scope. Does NOT include `slates:read:meta`. |
| `slates:write` | create/edit **published** (plaintext) slates |
| `slates:delete` | delete slates |
| `slates:publish` | publish/unpublish slates |

Note: the **delegated write** of a private slate (§6) is authorized by
`slates:read:private`, NOT `slates:write`. `slates:write` is only for
plaintext/published slates.

---

## 4. Endpoints

| method | path | scope | notes |
|---|---|---|---|
| GET | `/oauth/authorize` | — | start the flow (browser redirect) |
| POST | `/oauth/token` | — | exchange code, or refresh (rotates both tokens) |
| POST | `/oauth/revoke` | — | revoke an access or refresh token |
| GET | `/api/oauth/userinfo` | identity | `{ id, username, email?, email_verified? }` |
| GET | `/api/oauth/slates` | slates:read:meta | slate list + counts |
| GET | `/api/oauth/slates/published` | slates:read:public | all published slates with full text |
| GET | `/api/oauth/slates/:n` | slates:read:private | published→plaintext, delegated→decryptable, else ciphertext |
| GET | `/api/oauth/shared` | slates:read:private | slates delegated to your app |
| POST | `/api/oauth/slates` | slates:write | create a slate (published by default) |
| PUT | `/api/oauth/slates/:n` | slates:write | update a plaintext slate |
| PATCH | `/api/oauth/slates/:n/delegated` | slates:read:private | write back a delegated private slate |
| PATCH | `/api/oauth/slates/:n/publish` | slates:publish | publish/unpublish |
| DELETE | `/api/oauth/slates/:n` | slates:delete | delete |
| GET | `/api/oauth/scopes` | — | scope catalogue |

### Response shapes (real field names)

```
POST /oauth/token
  { access_token, token_type: "Bearer", expires_in, refresh_token, scope }

GET /api/oauth/userinfo
  { id, username, email?, email_verified? }

GET /api/oauth/slates                      (scope slates:read:meta)
  [ { slate_number, is_published, share_id, title|null, title_encrypted,
      word_count, char_count, created_at, updated_at, published_at } ]

GET /api/oauth/slates/published            (scope slates:read:public)
  [ { slate_number, title, share_id, content, word_count, char_count,
      created_at, updated_at, published_at } ]

GET /api/oauth/slates/:n  — published
  { slate_number, delegated: false, published: true, title, content }   // plaintext

GET /api/oauth/slates/:n  — delegated private
  { slate_number, delegated: true, key_scheme: "rsa-oaep-sha256",
    content_scheme: "aes-256-gcm", wrapped_key, enc_content, enc_title, shared_at }

GET /api/oauth/slates/:n  — private, not shared with you
  { slate_number, delegated: false, encrypted: true, encrypted_content, note }

GET /api/oauth/shared                      (scope slates:read:private)
  [ { slate_number, shared_at, word_count, char_count, created_at, updated_at } ]
  // the field is slate_number

PATCH /api/oauth/slates/:n/delegated  ->  { success: true }
POST  /oauth/revoke                   ->  { success: true }   // body { token }, JSON or form; always 200
```

### Errors
- `400 invalid_request` / `invalid_grant` — bad/expired code, PKCE mismatch, missing params.
- `401 invalid_client` — wrong client_id/secret. `401 invalid_token` — missing/expired/revoked bearer token.
- `403 insufficient_scope` — token lacks the required scope (`error_description` names it).
- `403` on a delegated slate — the user has not shared that slate with you.
- `413` — content over 5 MB, or a grant blob over 8 MB per field.
- A GCM "unable to authenticate data" error on decrypt is a **client-side** condition,
  not a server error — see §5.4.

---

## 5. The crypto contract

This is the exact, language-agnostic specification for private-slate content. Implement
it the same way in every language.

### 5.1 Blob format
Every encrypted blob (`enc_content`, `enc_title`, `wrapped_key`) is base64 of:

```
IV (16 bytes) || AuthTag (16 bytes) || Ciphertext
```

**The IV is 16 bytes, not the conventional 12.** This matters: some libraries
(notably Apple CryptoKit) default to or enforce a 12-byte GCM nonce and will reject
these blobs. Use an API that accepts a 16-byte nonce, or assemble the GCM call manually.

### 5.2 Algorithms
- Content/title symmetric encryption: **AES-256-GCM**, 16-byte IV, 16-byte tag.
- Per-slate content key: **32 random bytes**.
- Key wrapping to an app: **RSA-OAEP** with **SHA-256** (`oaepHash: "sha256"`).
  Note: many RSA libraries default OAEP to SHA-1 — you must set SHA-256 explicitly
  or decryption silently produces garbage.
- App keypair: **RSA 2048**, public key registered as base64 SPKI (DER).

### 5.3 Plaintext encoding (after AES-GCM decryption)
- **Content** decrypts to JSON: `{ "content": "<the text>", "uploadedAt": "<ISO8601>" }`.
  Read `.content`. When you write, set `uploadedAt` to an ISO timestamp (informational).
- **Title** decrypts to a **raw string** (not JSON), or is absent (`null`) for untitled.

### 5.4 Key rotation (read this before writing)
The per-slate content key is **rotated whenever the user edits the slate in justtype**.
A content key you cached earlier will then fail to decrypt the latest blob, surfacing
as a GCM auth-tag failure (e.g. "unable to authenticate data"). This is **expected**,
not a bug. Always `GET /api/oauth/slates/:n` immediately before writing to obtain the
current `wrapped_key`, and use that key for the write.

### 5.5 Two-way sync
When you `PATCH .../delegated`, justtype stores your re-encrypted blob and marks the
slate as app-edited. The next time the user opens that slate in justtype, their client
decrypts your edit with their master key and merges it into their canonical copy. The
content key is stored wrapped to both your app key and the user's master key, so the
round-trip works without the server ever seeing plaintext.

---

## 6. Delegated private slates — read & write

### Setup
Register your app at `https://justtype.io/dev` with the `slates:read:private` scope.
The page generates an RSA-2048 keypair, registers the public half, and shows you the
private key PEM **once** — store it (e.g. an env var). (Advanced: you may instead
supply your own `public_key` (base64 SPKI) to `POST /api/oauth/clients`, or rotate it
via `PUT /api/oauth/clients/:clientId/public-key`.)

After the user authorizes your app, they choose what to share in
**justtype account → connected apps → manage slate access** — either "allow all
private slates" (current + future) or specific ones.

### Read (Node)
```js
const { privateDecrypt, createDecipheriv, constants } = require('crypto');
const PRIVATE_KEY = process.env.JT_PRIVATE_KEY;     // the PEM justtype showed once
const b64 = (s) => Buffer.from(s, 'base64');

function aesGcmDecrypt(blob, key) {
  const d = b64(blob);
  const iv = d.subarray(0, 16), tag = d.subarray(16, 32), ct = d.subarray(32);
  const dec = createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
}

const slate = await (await fetch(`https://justtype.io/api/oauth/slates/${n}`, {
  headers: { Authorization: 'Bearer ' + accessToken }
})).json();
if (!slate.delegated) throw new Error('not shared with this app');

const contentKey = privateDecrypt(
  { key: PRIVATE_KEY, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
  b64(slate.wrapped_key));
const content = JSON.parse(aesGcmDecrypt(slate.enc_content, contentKey)).content;
const title = slate.enc_title ? aesGcmDecrypt(slate.enc_title, contentKey) : null;
```

### Write back (Node)
```js
const { privateDecrypt, createCipheriv, randomBytes, constants } = require('crypto');

function aesGcmEncrypt(plaintext, key) {
  const iv = randomBytes(16);                       // 16-byte IV (not 12)
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');  // IV||tag||ct
}

// GET first to obtain the CURRENT key (it rotates on the user's edits)
const slate = await (await fetch(`https://justtype.io/api/oauth/slates/${n}`, {
  headers: { Authorization: 'Bearer ' + accessToken }})).json();
const contentKey = privateDecrypt(
  { key: PRIVATE_KEY, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
  b64(slate.wrapped_key));

const enc_content = aesGcmEncrypt(
  JSON.stringify({ content: newText, uploadedAt: new Date().toISOString() }), contentKey);
const enc_title = newTitle ? aesGcmEncrypt(newTitle, contentKey) : null;

await fetch(`https://justtype.io/api/oauth/slates/${n}/delegated`, {
  method: 'PATCH',
  headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
  body: JSON.stringify({ enc_content, enc_title,
    word_count: newText.trim().split(/\s+/).length, char_count: newText.length })
});
```

### Read (Python)
```python
import base64, json, requests
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

priv = serialization.load_pem_private_key(os.environ["JT_PRIVATE_KEY"].encode(), None)
b64 = base64.b64decode

slate = requests.get(f"https://justtype.io/api/oauth/slates/{n}",
    headers={"Authorization": "Bearer " + access_token}).json()
assert slate["delegated"]

content_key = priv.decrypt(b64(slate["wrapped_key"]),
    padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))

def gcm_decrypt(blob):
    d = b64(blob); iv, tag, ct = d[:16], d[16:32], d[32:]
    return AESGCM(content_key).decrypt(iv, ct + tag, None).decode()  # cryptography wants ct||tag

content = json.loads(gcm_decrypt(slate["enc_content"]))["content"]
title = gcm_decrypt(slate["enc_title"]) if slate.get("enc_title") else None
```

### Read (Swift / iOS)
```swift
import Foundation
import Security
import CryptoKit

// RSA-OAEP-SHA256 unwrap via the Security framework (CryptoKit has no RSA).
func unwrapKey(_ wrapped: Data, privateKey: SecKey) -> Data? {
    var err: Unmanaged<CFError>?
    return SecKeyCreateDecryptedData(privateKey, .rsaEncryptionOAEPSHA256,
        wrapped as CFData, &err) as Data?
}

// AES-256-GCM with justtype's 16-byte IV layout: IV(16) || tag(16) || ciphertext.
// NOTE: CryptoKit's AES.GCM.Nonce is built for 12-byte nonces. On OS versions where
// AES.GCM.Nonce(data:) rejects a 16-byte nonce, use a BoringSSL/CommonCrypto GCM
// path instead — this is the most common iOS integration snag.
func gcmDecrypt(_ blob: Data, key: SymmetricKey) throws -> Data {
    let iv = blob.prefix(16)
    let tag = blob.dropFirst(16).prefix(16)
    let ct  = blob.dropFirst(32)
    let box = try AES.GCM.SealedBox(nonce: try AES.GCM.Nonce(data: iv),
                                    ciphertext: ct, tag: tag)
    return try AES.GCM.open(box, using: key)
}
// content -> JSON { content, uploadedAt }; title -> raw string.
```

### curl (auth + read)
```sh
# after exchanging the code for a token:
curl https://justtype.io/api/oauth/slates/3 -H "Authorization: Bearer $ACCESS_TOKEN"
# -> { "delegated": true, "wrapped_key": "...", "enc_content": "...", ... }
# decrypt wrapped_key (RSA-OAEP-SHA256) then enc_content (AES-256-GCM) per §5.
```

---

## 7. Native apps (iOS/Android/desktop)

- Use a private-use redirect scheme (`com.example.app://callback`) or a claimed
  HTTPS universal/app link. Both are accepted; register the exact URI at `/dev`.
- Drive the browser step with the platform's OAuth view (`ASWebAuthenticationSession`
  on iOS, Custom Tabs on Android).
- The OAuth/identity half needs no crypto. Only private-slate read/write does — see §5,
  and mind the 16-byte IV note for CryptoKit.
