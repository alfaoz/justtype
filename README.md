# justtype

start typing, we'll handle the rest.

live at **[justtype.io](https://justtype.io)**

## why open source?

transparency + sweet community support.

## what it offers

a simple writing interface with cloud saved slates, shareable urls, export to txt, and zero-knowledge encryption. your writing is yours.

## how encryption works

your password is never sent to the server in plaintext. on signup, a unique salt is generated and stored. your password is derived into a 256-bit encryption key using pbkdf2 with 100k iterations of sha-256.

every private slate is encrypted client-side with aes-256-gcm before upload. the encrypted payload is structured as `iv (16 bytes) + auth tag (16 bytes) + ciphertext`, stored on backblaze b2. the server only ever handles ciphertext. decryption happens in your browser when you load a slate.

this is zero-knowledge: the server cannot read your slates because it never possesses the key. if you forget your password and lose your 12-word bip39 recovery key, your data is unrecoverable by design.

published slates are the exception. publishing stores a separate unencrypted copy on b2 with a public share id. unpublishing deletes the public copy.

you can verify all of this yourself. the source is right here, and the [/verify](https://justtype.io/verify) page lets you confirm the code running in your browser matches this repo through three-way hash comparison (server, github actions, browser-computed). for a deeper dive on the encryption architecture, key management, and recovery system, see the [encryption deep dive](docs/encryption.md).

> don't trust me? i wouldn't either. check `server/index.js`, `server/b2Storage.js`, and `src/crypto.js`.

## tech stack

react, tailwind css, node.js, express, sqlite, backblaze b2, resend.

## self-hosting

you can run your own instance. clone the repo, configure your environment, and you're up.

```bash
git clone https://github.com/alfaoz/justtype.git
cd justtype
npm install
cp .env.example .env
```

fill in your `.env` with backblaze b2 credentials, a jwt secret, and a resend api key for emails. then build and start:

```bash
npm run build
npm run server
```

requires node 20+.

## system documentation

the `/terms`, `/privacy`, `/limits`, and `/project` pages are hosted as published slates by a system user. this dogfoods justtype's own publishing feature for our documentation.

to set up system documentation (optional for self-hosting):

```bash
node setup-system-docs.js
```

this creates:
- a `systemalfaoz` system user (displays as "alfaoz")
- 4 published slates with share_ids: `terms`, `privacy`, `limits`, `project`
- redirects from `/terms` → `/s/terms`, etc.

the system slates are protected from deletion but can be edited by logging in as the system user. you can also keep the documentation as plain text files. both approaches work.

## contributing

found a bug? security issue? want to add a feature? need a friend?

- **security issues:** email security@justtype.io (not github issues)
- **bugs/features:** open an issue or pr
- **style guide:** see CONTRIBUTING.md
- **friend:** alfa.ozaltin@gmail.com

we welcome thoughtful contributions to the ux.

## license

mit
