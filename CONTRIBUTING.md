# contributing

thanks for considering contributing to justtype!

## development setup

```bash
# clone repo
git clone https://github.com/alfaoz/justtype.git
cd justtype

# install dependencies
npm install

# configure environment
cp .env.example .env
# edit .env with your credentials

# start server
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

1. create a new branch
2. make your changes
3. test thoroughly
4. update version in `src/version.js` if needed
5. commit with clear message
6. push and create pull request

## version numbering

semantic versioning (MAJOR.MINOR.PATCH):
- MAJOR: breaking changes
- MINOR: new features (backward compatible)
- PATCH: bug fixes/hotfixes

update in both:
- `package.json`
- `src/version.js`

## code style

- lowercase for all ui text
- functional react components with hooks
- async/await for promises
- clear variable names
- comments for complex logic only

## testing

```bash
# build frontend
npm run build

# start server
npm run server

# test endpoints
curl http://localhost:3001/api/health
```

## security

- never commit `.env` file
- never commit database files
- sanitize user inputs
- use bcrypt for passwords
- validate all api inputs

## pull requests

- keep changes focused
- update documentation if needed
- test on clean install
- no merge commits (squash or rebase)
