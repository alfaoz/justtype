#!/bin/sh
# Build the web bundle for the app, sync it into the shell, build the shell
# for the simulator and reinstall it. Usage: sh build.sh [--no-web | --web-only]
# Another simulator: DEVICE="iPhone 17 Pro" sh build.sh  (xcrun simctl list devices available)
set -e
DEV="${DEVICE:-iPhone 17}"
cd "$(dirname "$0")"
if [ "$1" != "--no-web" ]; then
  ( cd ../repo && node scripts/check-jsx-bindings.cjs && K="$(grep '^TURNSTILE_SITE_KEY=' .env | cut -d= -f2- | tr -d '"'"'"' ')" \
    && VITE_TURNSTILE_SITE_KEY="$K" VITE_APP=1 VITE_BETA=1 VITE_API_URL=https://beta.justtype.io/api VITE_PUBLIC_URL=https://beta.justtype.io npm run build > /tmp/jt-app-build.log 2>&1 ) || { echo "web build failed"; tail -20 /tmp/jt-app-build.log; exit 1; }
  sh variant.sh bundled | tail -1
fi
[ "$1" = "--web-only" ] && exit 0
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator \
  -destination "platform=iOS Simulator,name=$DEV" -derivedDataPath build CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= build 2>&1 \
  | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
xcrun simctl boot "$DEV" 2>/dev/null || true
xcrun simctl terminate "$DEV" io.justtype.app 2>/dev/null || true
xcrun simctl install "$DEV" build/Build/Products/Debug-iphonesimulator/App.app && echo installed
