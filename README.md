# justtype

minimalist writing app with cloud storage and sharing.

currently live at **[type.alfaoz.dev](https://type.alfaoz.dev)**

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

## contributing

found a bug? security issue? want to add a feature? need a friend?

- **security issues:** email security@alfaoz.dev (not github issues)
- **bugs/features:** open an issue or pr
- **style guide:** see CONTRIBUTING.md
- **friend:** alfa.ozaltin@gmail.com

we're (i am) picky about ux but welcome thoughtful contributions.

## license

mit
