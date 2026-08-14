#!/bin/bash

# deploy script for the justtype beta instance (beta.justtype.io)
# builds from the beta branch and restarts pm2; no github actions hash wait
# (beta builds are not published to github pages - /verify runs in beta mode)

set -e

echo "deploying justtype beta..."
echo ""

# setup nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# use node 20
echo "using Node 20..."
nvm use 20

# check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "error: uncommitted changes detected. commit or stash first."
  git status --short
  exit 1
fi

# pull latest beta branch
echo "pulling from git..."
git pull origin beta

# install dependencies
echo "installing dependencies..."
npm ci --include=dev

# build frontend (VITE_BETA and turnstile key come from .env)
echo "building frontend..."
npm run build

# restart pm2
echo "restarting pm2..."
pm2 restart justtype-beta --update-env

echo ""
echo "beta deployed. check https://beta.justtype.io"
