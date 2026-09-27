#!/bin/sh
# Build the shell for the simulator, install it on a booted iPhone, launch it,
# and drop a screenshot. Usage: sh run-sim.sh [device name]   (default: first iPhone)
set -e
cd "$(dirname "$0")"
DEV="${1:-}"
if [ -z "$DEV" ]; then
  DEV=$(xcrun simctl list devices available | grep -o 'iPhone [^(]*' | head -1 | sed 's/ *$//')
fi
[ -n "$DEV" ] || { echo "no iPhone simulator available"; exit 1; }
echo "device: $DEV"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination "platform=iOS Simulator,name=$DEV" \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)" || true
APP=build/Build/Products/Debug-iphonesimulator/App.app
[ -d "$APP" ] || { echo "no build product"; exit 1; }
xcrun simctl boot "$DEV" 2>/dev/null || true
open -a Simulator >/dev/null 2>&1 || true
xcrun simctl bootstatus "$DEV" -b >/dev/null
xcrun simctl install "$DEV" "$APP"
xcrun simctl launch "$DEV" io.justtype.app >/dev/null
sleep 6
mkdir -p shots
OUT="shots/$(date +%H%M%S).png"
xcrun simctl io "$DEV" screenshot "$OUT" >/dev/null
echo "screenshot: $OUT"
