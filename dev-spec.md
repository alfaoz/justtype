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

Apps can also **create** brand-new private slates for a user without ever holding
the user's master key — the "drop box" (see §7). Each user publishes an RSA-OAEP
public key; an app encrypts a new slate to it and drops it in. The user's client
decrypts it on next unlock and adopts it as a normal private slate. This is the
**only** way an app authors end-to-end-encrypted content; `slates:write` only
produces plaintext slates.

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
| `slates:create` | drop **new private (E2E) slates** into the user's account (§7). Does not grant read of anything. |
| `slates:delete` | delete slates |
| `slates:publish` | publish/unpublish slates |

Note: the **delegated write** of an *existing* private slate (§6) is authorized by
`slates:read:private`, NOT `slates:write`. **Creating** a new private slate (§7) is
authorized by `slates:create`. `slates:write` is only for plaintext/published
slates — it can never produce or edit E2E content.

The two private-slate capabilities are independent: `slates:read:private` lets you
read/edit slates the user shares **with you**; `slates:create` lets you add **new**
encrypted slates **to the user**. An app can hold either, both, or neither.

### Recommended: a full justtype integration

If you are building a real justtype client — something that behaves the way justtype
itself does, with full access to a user's writing — request this bundle:

```
identity slates:read:meta slates:read:private slates:create slates:delete slates:publish
```

| scope | what it lets your client do |
|---|---|
| `identity` | know who the user is |
| `slates:read:meta` | list the user's slates (counts, dates) to build a library view |
| `slates:read:private` | read **and edit** the private slates the user shares with you (also covers all published content) |
| `slates:create` | add brand-new **end-to-end-encrypted** slates to the user (the drop box) |
| `slates:delete` | delete slates on the user's behalf |
| `slates:publish` | publish / unpublish slates |

This is the **intended** shape of a justtype integration: end-to-end-encrypted by
default (`read:private` + `create`), with full lifecycle control (`delete`,
`publish`). The user approves it on **one** consent screen, and — because you
requested `read:private` with a registered public key — that same screen offers a
one-tap **"allow full access to all my private slates (current + future)"** toggle,
so the user can hand your client their whole library in a single step (see §6).

Add `slates:write` **only** if you also need to create/edit *plaintext, published*
slates directly (e.g. a blog-style publishing tool). An E2E-first client does not
need it: new private notes go through `slates:create`, and edits to shared private
notes go through the delegated write (§6) under `slates:read:private`.

Request `email` only if you actually need the address — fewer scopes, more trust.

---

## 4. Endpoints

| method | path | scope | notes |
|---|---|---|---|
| GET | `/oauth/authorize` | — | start the flow (browser redirect) |
| POST | `/oauth/token` | — | exchange code, or refresh (rotates both tokens) |
| POST | `/oauth/revoke` | — | revoke an access or refresh token |
| GET | `/api/oauth/userinfo` | identity | `{ id, username, email?, email_verified?, public_key? }` (public_key present with `slates:create`) |
| GET | `/api/oauth/users/me/public-key` | slates:create | the user's RSA-OAEP public key to wrap a drop to (`null` if not generated yet) |
| POST | `/api/oauth/slates/drop` | slates:create | create a new private (E2E) slate for the user (§7) |
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
  { id, username, email?, email_verified?,
    public_key?, key_scheme? }            // public_key + key_scheme only with slates:create

GET /api/oauth/users/me/public-key         (scope slates:create)
  { public_key: "<base64 SPKI>" | null, key_scheme: "rsa-oaep-sha256" }

POST /api/oauth/slates/drop                 (scope slates:create)
  request:  { wrapped_key, enc_content, enc_title? }
  success:  { success: true, drop_id, status: "pending_adoption" }
  409:      { error: "keypair_unavailable" }   // user has no published key yet; retry later

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
- `409 keypair_unavailable` on `POST /api/oauth/slates/drop` — the user has not
  generated an encryption keypair yet (they will on next unlock). Retry later.
- `413` — content over 5 MB, or a grant/drop blob over 8 MB per field.
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

### 5.6 Creating private slates (drop crypto)
Delegation (§5.1–5.5) wraps a content key to **your app's** public key — that is for
reading/editing slates the user shares with you. Creating a **new** private slate is
the mirror image: you wrap to the **user's** public key instead. Same blob format,
same algorithms (§5.1, §5.2) — only the wrap target changes.

To drop a new slate:
1. Fetch the user's public key (`GET /api/oauth/users/me/public-key`, or the
   `public_key` field of `userinfo`). If it is `null`, the user has not generated a
   keypair yet — retry after they next open justtype.
2. Generate a fresh 32-byte content key.
3. `enc_content` = AES-256-GCM of `{ "content": "<text>", "uploadedAt": "<ISO>" }`
   under the content key; `enc_title` = AES-256-GCM of the raw title string (optional).
4. `wrapped_key` = the content key, RSA-OAEP-SHA256 encrypted to the **user's** public
   key (base64 SPKI you fetched in step 1).
5. `POST /api/oauth/slates/drop` with `{ wrapped_key, enc_content, enc_title? }`.

You never see the user's master key, and justtype never sees your plaintext. After the
user's client adopts the drop it is re-keyed to their master key; the content key you
used is discarded. See §7 for the full flow, timing, and what the user experiences.

---

## 6. Delegated private slates — read & write

### Setup
Register your app at `https://justtype.io/dev` with the `slates:read:private` scope.
The page generates an RSA-2048 keypair, registers the public half, and shows you the
private key PEM **once** — store it (e.g. an env var). (Advanced: you may instead
supply your own `public_key` (base64 SPKI) to `POST /api/oauth/clients`, or rotate it
via `PUT /api/oauth/clients/:clientId/public-key`.)

There are two ways the user grants you slates, and you don't have to do anything
different for either — you just read whatever ends up shared:
- **On the consent screen (one tap):** because you requested `slates:read:private`
  and registered a public key, the authorize screen shows an **"allow full access to
  all my private slates (current + future)"** toggle. If the user ticks it, justtype
  wraps their entire library to your key during authorization, before redirecting
  back to you — so by the time you exchange your code for a token, the grants are
  already there.
- **Later, anytime:** in **justtype account → connected apps → manage slate access**,
  the user can allow-all, or pick specific slates, or revoke.

Either way, call `GET /api/oauth/shared` to see which slates you can read, and
`GET /api/oauth/slates/:n` to read each.

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

## 7. The drop box — creating private slates for a user

`slates:create` lets your app deposit **new end-to-end-encrypted slates** into a
user's account. You encrypt to the user's published public key; their client decrypts
on next unlock and adopts the note as a normal private slate. Neither justtype nor
your server ever sees the plaintext, and you never touch the user's master key.

### Create (Node)
```js
const { publicEncrypt, createCipheriv, randomBytes, constants } = require('crypto');
const b64 = (s) => Buffer.from(s, 'base64');

function aesGcmEncrypt(plaintext, key) {
  const iv = randomBytes(16);                         // 16-byte IV (not 12)
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');  // IV||tag||ct
}

// 1. fetch the USER's public key (base64 SPKI). null => user has no keypair yet.
const { public_key } = await (await fetch(
  'https://justtype.io/api/oauth/users/me/public-key',
  { headers: { Authorization: 'Bearer ' + accessToken } })).json();
if (!public_key) throw new Error('keypair_unavailable — retry after the user opens justtype');

// 2. fresh content key, 3. encrypt content + title under it
const contentKey = randomBytes(32);
const enc_content = aesGcmEncrypt(
  JSON.stringify({ content: text, uploadedAt: new Date().toISOString() }), contentKey);
const enc_title = title ? aesGcmEncrypt(title, contentKey) : null;

// 4. wrap the content key to the USER's RSA-OAEP-SHA256 public key
const userPub = `-----BEGIN PUBLIC KEY-----\n${public_key.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
const wrapped_key = publicEncrypt(
  { key: userPub, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
  contentKey).toString('base64');

// 5. drop it
await fetch('https://justtype.io/api/oauth/slates/drop', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
  body: JSON.stringify({ wrapped_key, enc_content, enc_title })
});
```

### Create (Python)
```python
import os, json, base64, requests
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

tok = {"Authorization": "Bearer " + access_token}
pub_b64 = requests.get("https://justtype.io/api/oauth/users/me/public-key", headers=tok).json()["public_key"]
if not pub_b64:
    raise SystemExit("keypair_unavailable — retry after the user opens justtype")
user_pub = serialization.load_der_public_key(base64.b64decode(pub_b64))

content_key = os.urandom(32)
def gcm(plaintext):
    iv = os.urandom(16)                                  # 16-byte IV
    out = AESGCM(content_key).encrypt(iv, plaintext.encode(), None)  # returns ct||tag
    ct, tag = out[:-16], out[-16:]
    return base64.b64encode(iv + tag + ct).decode()      # reorder to IV||tag||ct

enc_content = gcm(json.dumps({"content": text, "uploadedAt": "2026-01-01T00:00:00Z"}))
enc_title = gcm(title) if title else None
wrapped_key = base64.b64encode(user_pub.encrypt(content_key,
    padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))).decode()

requests.post("https://justtype.io/api/oauth/slates/drop", headers=tok,
    json={"wrapped_key": wrapped_key, "enc_content": enc_content, "enc_title": enc_title})
```

### When does the note appear? (timing — set user expectations)
A drop can only be **decrypted on a device that holds the user's key** — that is the
zero-knowledge guarantee, so the server can never adopt it for them. What the server
*can* do is signal instantly. In practice:

| user's state | when the note appears |
|---|---|
| justtype open in a tab | ~1 second (server pushes a live event; the client adopts immediately) |
| installed/PWA, no tab, push allowed | seconds — a service worker is woken to import (except where the OS throttles background workers, e.g. iOS Safari) |
| all their devices closed | the moment they next open/unlock justtype; the server still notifies them right away |

So: **don't promise users an instant appearance** unless justtype is already open.
The honest phrasing is "shows up next time you open justtype." The note is never lost
in the meantime — it waits, encrypted to the user, until a device can open it.

### What the user sees, and what happens to the note long-term
- Adopted slates are **tagged with your app's name** ("from <app>") in the user's slate
  list, and the user is notified. It is not a silent insertion.
- Once adopted, the note is **re-encrypted to the user's own master key** and is
  indistinguishable from one they wrote. **It is theirs permanently** — it stays even
  if the user later removes your app, and your app has no further claim on it.
- A drop the user has **not yet adopted** survives your app being revoked too (it is
  encrypted to the user, not to your app), so the user never loses a note by
  disconnecting you. They can also discard a pending drop without adopting it.

This behavior is disclosed on the consent screen when you request `slates:create`, so
users approve with the timing and permanence in mind.

---

## 8. Native apps (iOS/Android/desktop)

- Use a private-use redirect scheme (`com.example.app://callback`) or a claimed
  HTTPS universal/app link. Both are accepted; register the exact URI at `/dev`.
- Drive the browser step with the platform's OAuth view (`ASWebAuthenticationSession`
  on iOS, Custom Tabs on Android).
- The OAuth/identity half needs no crypto. Only private-slate read/write does — see §5,
  and mind the 16-byte IV note for CryptoKit.

---

## 9. Integration checklist (end to end)

A full justtype client, in order. Each step links to the section that specifies it.

1. **Register** your app at `https://justtype.io/dev` (or `POST /api/oauth/clients`).
   Request the full bundle from §3: `identity slates:read:meta slates:read:private
   slates:create slates:delete slates:publish`. Registering with `slates:read:private`
   generates your RSA-2048 keypair — **store the private key PEM** (shown once).
2. **Implement the OAuth flow** (§2): PKCE S256, exchange code at `/oauth/token`,
   store + rotate refresh tokens, always verify `state`.
3. **Read the user's library:** `GET /api/oauth/slates` (meta list, §4) and
   `GET /api/oauth/slates/:n` per slate. Published → plaintext; delegated private →
   decrypt per §5/§6; not-shared private → opaque (ask the user to share).
4. **Get private slates shared with you** (§6): the user can grant all of them in one
   tap on the consent screen, or later in their account. Poll `GET /api/oauth/shared`.
5. **Edit a shared private slate** (§6): GET it for the current `wrapped_key`,
   re-encrypt under that same content key, `PATCH .../delegated`.
6. **Create new private slates** (§7): fetch the user's public key, wrap a fresh
   content key to it, `POST /api/oauth/slates/drop`. Handle `409 keypair_unavailable`
   by retrying later.
7. **Manage lifecycle:** `DELETE /api/oauth/slates/:n` (§4) and
   `PATCH /api/oauth/slates/:n/publish` (§4).
8. **Respect the model:** never expect the server to reveal plaintext of a private
   slate or any key; surface drop timing honestly ("shows up next time you open
   justtype"); tell users that `slates:write` content is plaintext-on-server, while
   `slates:create` content is end-to-end encrypted.

If you implement steps 1–7 correctly, your client is a first-class justtype app:
end-to-end encrypted, two-way syncing, with full lifecycle control — exactly how
justtype itself treats a user's writing.
