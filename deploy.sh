#!/bin/bash

# deploy script for justtype
# pulls latest changes and rebuilds the app

echo "🚀 deploying justtype..."

# pull latest changes
echo "📥 pulling from git..."
git pull origin master

if [ $? -ne 0 ]; then
  echo "❌ git pull failed"
  exit 1
fi

# install/update dependencies
echo "📦 updating dependencies..."
npm install

if [ $? -ne 0 ]; then
  echo "❌ npm install failed"
  exit 1
fi

# rebuild better-sqlite3 for Node 18 (server runtime)
echo "🔧 rebuilding better-sqlite3 for Node 18..."
npm rebuild better-sqlite3

if [ $? -ne 0 ]; then
  echo "❌ better-sqlite3 rebuild failed"
  exit 1
fi

# switch to node 20 and build frontend
echo "🔨 building frontend with Node 20..."
source ~/.nvm/nvm.sh
nvm use 20
npm run build

if [ $? -ne 0 ]; then
  echo "❌ frontend build failed"
  exit 1
fi

# restart pm2 if running
if command -v pm2 &> /dev/null; then
  echo "🔄 restarting pm2..."
  pm2 restart justtype 2>/dev/null || echo "⚠️  pm2 process not found, skipping restart"
  pm2 save
else
  echo "⚠️  pm2 not found, skipping restart"
fi

echo "✅ deployment complete!"
echo ""
echo "📊 Status:"
pm2 list 2>/dev/null || echo "pm2 not running"
