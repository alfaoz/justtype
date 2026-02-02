#!/bin/bash

# deploy script for justtype
# builds, restarts, waits for github actions, and verifies hash match

set -e

echo "deploying justtype..."
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

# pull latest changes
echo "pulling from git..."
git pull origin master

# clean install dependencies
echo "installing dependencies..."
rm -rf node_modules
npm install --include=dev

# build frontend
echo "building frontend..."
npm run build

# show local hashes
echo ""
echo "local build hashes:"
cat dist/build-manifest.json
echo ""

# restart pm2 with Node 20
if command -v pm2 &> /dev/null; then
  echo "restarting pm2..."
  pm2 delete justtype 2>/dev/null || echo "no existing process to delete"
  NODE_PATH=$(which node)
  pm2 start server/index.js --name justtype --interpreter $NODE_PATH
  pm2 save
else
  echo "warning: pm2 not found, skipping restart"
fi

# wait for server to be ready
echo ""
echo "waiting for server..."
sleep 3

# verify server is responding
SERVER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3003/build-manifest.json)
if [ "$SERVER_STATUS" != "200" ]; then
  echo "warning: server returned $SERVER_STATUS for build-manifest.json"
else
  echo "server is up and serving build manifest"
fi

# wait for github actions to build and publish hashes
echo ""
echo "waiting for github actions to build and publish hashes..."
echo "this checks every 15s for up to 3 minutes"

GITHUB_HASHES_URL="https://alfaoz.github.io/justtype/build-hashes.json"
LOCAL_JS_HASH=$(node -e "const m = require('./dist/build-manifest.json'); console.log(m.jsHash)")
LOCAL_CSS_HASH=$(node -e "const m = require('./dist/build-manifest.json'); console.log(m.cssHash)")

MATCH=false
for i in $(seq 1 12); do
  sleep 15
  GH_RESPONSE=$(curl -s "$GITHUB_HASHES_URL" 2>/dev/null || echo "{}")
  GH_JS_HASH=$(echo "$GH_RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).jsHash||'')}catch{console.log('')}})" 2>/dev/null)
  GH_CSS_HASH=$(echo "$GH_RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).cssHash||'')}catch{console.log('')}})" 2>/dev/null)

  if [ "$GH_JS_HASH" = "$LOCAL_JS_HASH" ] && [ "$GH_CSS_HASH" = "$LOCAL_CSS_HASH" ]; then
    MATCH=true
    break
  fi
  echo "  attempt $i/12 - hashes don't match yet..."
done

echo ""
if [ "$MATCH" = true ]; then
  echo "VERIFIED: local and github hashes match"
  echo "  js:  $LOCAL_JS_HASH"
  echo "  css: $LOCAL_CSS_HASH"
else
  echo "WARNING: hashes did NOT match after 3 minutes"
  echo ""
  echo "  local js:  $LOCAL_JS_HASH"
  echo "  github js: $GH_JS_HASH"
  echo ""
  echo "  local css: $LOCAL_CSS_HASH"
  echo "  github css: $GH_CSS_HASH"
  echo ""
  echo "possible causes:"
  echo "  - github actions workflow hasn't finished yet (check github.com/alfaoz/justtype/actions)"
  echo "  - VITE_TURNSTILE_SITE_KEY secret in github doesn't match local .env"
  echo "  - different node/npm versions between local and CI"
fi

echo ""
echo "deployment complete"
echo ""
pm2 list 2>/dev/null || echo "pm2 not running"
