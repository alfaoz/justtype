#!/bin/bash

# one-shot safe deploy: local preflight + git push + remote deploy
# default target is justtype production VPS

set -euo pipefail

DEPLOY_SSH_TARGET="${DEPLOY_SSH_TARGET:-justtype-vps}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/root/justtype}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-master}"
REMOTE_APP_NAME="${REMOTE_APP_NAME:-justtype}"
REMOTE_HEALTH_URL="${REMOTE_HEALTH_URL:-http://localhost:3003/build-manifest.json}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

fail() {
  echo "error: $1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

echo "[1/7] local preflight..."
require_cmd git
require_cmd node
require_cmd npm
require_cmd ssh

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "not in a git repository"

CURRENT_BRANCH="$(git branch --show-current)"
[ "$CURRENT_BRANCH" = "$DEPLOY_BRANCH" ] || fail "current branch is '$CURRENT_BRANCH' (expected '$DEPLOY_BRANCH')"

if [ -n "$(git status --porcelain)" ]; then
  git status --short
  fail "working tree is dirty; commit or stash first"
fi

echo "[2/7] version consistency check..."
PKG_VERSION="$(node -p "require('./package.json').version")"
LOCK_VERSION="$(node -p "require('./package-lock.json').version")"
APP_VERSION="$(node -e "const fs=require('fs');const s=fs.readFileSync('src/version.js','utf8');const m=s.match(/VERSION\\s*=\\s*['\\\"]([^'\\\"]+)['\\\"]/);if(!m){process.exit(1)}process.stdout.write(m[1])")" || fail "could not read version from src/version.js"

echo "      package.json:      $PKG_VERSION"
echo "      package-lock.json: $LOCK_VERSION"
echo "      src/version.js:    $APP_VERSION"

[ "$PKG_VERSION" = "$LOCK_VERSION" ] || fail "package.json and package-lock.json versions differ"
[ "$PKG_VERSION" = "$APP_VERSION" ] || fail "package.json and src/version.js versions differ"

echo "[3/7] sync check with origin/$DEPLOY_BRANCH..."
git fetch origin "$DEPLOY_BRANCH"

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "origin/$DEPLOY_BRANCH")"
MERGE_BASE="$(git merge-base HEAD "origin/$DEPLOY_BRANCH")"

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  echo "      local is already at origin/$DEPLOY_BRANCH"
elif [ "$LOCAL_HEAD" = "$MERGE_BASE" ]; then
  fail "local is behind origin/$DEPLOY_BRANCH; pull/rebase first"
elif [ "$REMOTE_HEAD" != "$MERGE_BASE" ]; then
  fail "local and origin/$DEPLOY_BRANCH diverged; rebase first"
else
  echo "      local has commits to push"
fi

echo "[4/7] local build verification..."
npm run build

echo "[5/7] push to origin/$DEPLOY_BRANCH..."
git push origin "$DEPLOY_BRANCH"

echo "[6/7] remote deploy on $DEPLOY_SSH_TARGET..."
ssh -p "$DEPLOY_PORT" "$DEPLOY_SSH_TARGET" \
  "DEPLOY_PATH='$DEPLOY_PATH' DEPLOY_BRANCH='$DEPLOY_BRANCH' REMOTE_APP_NAME='$REMOTE_APP_NAME' REMOTE_HEALTH_URL='$REMOTE_HEALTH_URL' bash -s" <<'EOF'
set -euo pipefail

cd "$DEPLOY_PATH"
export TERM=dumb
export GIT_PAGER=cat

CURRENT_BRANCH="$(git branch --show-current)"
[ "$CURRENT_BRANCH" = "$DEPLOY_BRANCH" ] || { echo "error: remote branch '$CURRENT_BRANCH' != '$DEPLOY_BRANCH'"; exit 1; }

if [ -n "$(git status --porcelain)" ]; then
  echo "error: remote working tree is dirty"
  git status --short
  exit 1
fi

ts="$(date +%Y%m%d_%H%M%S)"
cp -f data/justtype.db "backups/manual_before_deploy_${ts}.db"
echo "manual db backup: backups/manual_before_deploy_${ts}.db"

./deploy.sh

echo ""
echo "remote post-check:"
git status -sb
echo "HEAD: $(git rev-parse --short HEAD)"
echo "origin/$DEPLOY_BRANCH: $(git rev-parse --short "origin/$DEPLOY_BRANCH")"
pm2 describe "$REMOTE_APP_NAME" | sed -n '1,35p'
curl -fsS "$REMOTE_HEALTH_URL"
echo ""
EOF

echo "[7/7] complete."
echo "safe deploy finished successfully."
