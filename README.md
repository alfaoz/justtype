# justtype

minimalist writing app with cloud storage and sharing.

## features

- distraction-free writing interface
- cloud-synced slates
- publish and share with unique urls
- end-to-end encryption (aes-256-gcm)
- auto-save
- export to txt/pdf

## setup

```bash
npm install
cp .env.example .env
# configure backblaze b2 credentials in .env
npm run server
```

## tech

- react + tailwind css
- node.js + express
- sqlite + backblaze b2
- per-user encryption (pbkdf2 + aes-256-gcm)

## env vars

```
PORT=3001
JWT_SECRET=your-secret
B2_APPLICATION_KEY_ID=your-key
B2_APPLICATION_KEY=your-secret
B2_BUCKET_ID=your-bucket
```

## security

- per-user encryption keys derived from passwords
- aes-256-gcm authenticated encryption
- published slates use unencrypted public copies
- private slates remain encrypted at rest

## license

mit
