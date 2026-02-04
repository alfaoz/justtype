# contributing

thanks for wanting to make justtype better!

## what we're looking for

- bug fixes (especially security/encryption related)
- ux improvements
- performance optimizations
- code cleanup/refactoring

## what we're not looking for

- major feature rewrites without discussion first
- ui redesigns
- tracking/analytics (privacy-first, always)

## development setup

```bash
# clone repo
git clone https://github.com/alfaoz/justtype.git
cd justtype

# install dependencies
npm install

# configure environment (get your own b2 + resend keys)
cp .env.example .env
# edit .env with your credentials

# start dev server
npm run dev
```

## project structure

```
src/
├── App.jsx              # main app, routing
├── components/
│   ├── Writer.jsx       # writing interface
│   ├── SlateManager.jsx # slate list/management
│   ├── Account.jsx      # account settings
│   ├── AuthModal.jsx    # login/signup
│   ├── AdminConsole.jsx # admin dashboard
│   └── PublicViewer.jsx # public slate viewer
└── version.js           # version tracking

server/
├── index.js             # express api
├── database.js          # sqlite setup
├── b2Storage.js         # backblaze integration
├── emailService.js      # resend integration
└── emailValidator.js    # email validation
```

## making changes

1. open an issue first for big changes (let's discuss before you spend precious time!)
2. create a new branch (`fix/thing` or `feature/thing`)
3. make your changes
4. test thoroughly (build, run, verify it works)
5. commit with clear message (explanatory, imperative: "fix encryption bug" not "Fixed bug")
6. push and create pull request

## version numbering (c'mon...)

semantic versioning (MAJOR.MINOR.PATCH):
- MAJOR: breaking changes
- MINOR: new features (backward compatible)
- PATCH: bug fixes/hotfixes

update in both:
- `package.json`
- `src/version.js`

## code style

- lowercase for ui strings
- functional react components with hooks
- async/await for promises

## testing

```bash
# build frontend
npm run build

# start server
npm run server

# test endpoints
curl http://localhost:3001/api/health
```

## security rules

- never commit `.env`, database files, or real credentials
- all user inputs must be sanitized/validated
- encryption changes need extra scrutiny
- if you find a vulnerability, email security@justtype.io first (not github)

## pull request checklist

- [ ] focused on one thing (not 5 unrelated changes)
- [ ] tested locally (works on your machine)
- [ ] code style matches existing code (lowercase ui text, etc.)
- [ ] documentation updated if needed
- [ ] no merge commits (squash or rebase)

## getting help

- stuck? open a draft pr and ask questions
- not sure if something is worth doing? open an issue first
- want to chat? open a discussion

,,don't fret, we're friendly.'' - justtype dev, alfaoz
