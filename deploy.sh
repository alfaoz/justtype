#!/bin/bash

# deploy script for justtype
# uses Node 20 for both build and runtime

set -e  # exit on any error

echo "deploying justtype..."

# setup nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# use node 20
echo "using Node 20..."
nvm use 20

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

# restart pm2 with Node 20
if command -v pm2 &> /dev/null; then
  echo "restarting pm2..."

  # delete existing process
  pm2 delete justtype 2>/dev/null || echo "no existing process to delete"

  # start with Node 20 interpreter
  NODE_PATH=$(which node)
  pm2 start server/index.js --name justtype --interpreter $NODE_PATH
  pm2 save
else
  echo "warning: pm2 not found, skipping restart"
fi

echo ""
echo "deployment complete"
echo ""
echo "status:"
pm2 list 2>/dev/null || echo "pm2 not running"
