# justtype

start typing, we'll handle the rest.

live at **[justtype.io](https://justtype.io)**

## why open source?

transparency + sweet community support.

## what it offers

- a simple writing interface
- cloud saved slates
- publish and share with unique urls
- end-to-end encryption (aes-256-gcm)
- export to txt/pdf

## how encryption works

```
your password → pbkdf2 (100k iterations) → encryption key
your slates → aes-256-gcm → encrypted storage (backblaze b2)
```

- private slates: encrypted at rest, only you can decrypt
- published slates: stored unencrypted for public access
- keys never leave your browser, server never sees plaintext (duh...)

>don't trust me? i wouldn't either. check the implementation: `server/index.js` (lines 23-64)

## tech stack

- frontend: react + tailwind css
- backend: node.js + express
- storage: sqlite + backblaze b2
- encryption: pbkdf2 + aes-256-gcm

## self-hosting

want to run your own justtype instance? we support it, but don't expect optimization for it.

```bash
git clone https://github.com/alfaoz/justtype.git
cd justtype
npm install
cp .env.example .env
# configure your b2 credentials in .env
npm run build
npm run server
```

requires: node 20+, backblaze b2 account, resend api key (for emails)

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

the system slates are protected from deletion but can be edited by logging in as the system user. you can also keep the documentation as plain text files—both approaches work.

## contributing

found a bug? security issue? want to add a feature? need a friend?

- **security issues:** email security@justtype.io (not github issues)
- **bugs/features:** open an issue or pr
- **style guide:** see CONTRIBUTING.md
- **friend:** alfa.ozaltin@gmail.com

we welcome thoughtful contributions to the ux.

## license

mit
