#!/bin/sh
# Pick simulators from a list (cmd-click for several), then build the app once
# and install it on each. Usage: sh pick.sh [--no-web]
#   --no-web   skip rebuilding the web bundle (Swift-only changes)
set -e
cd "$(dirname "$0")"

# "iPhone 17 Pro (iOS 26.3)|UDID" for every available iPhone and iPad
LIST=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
data = json.load(sys.stdin)["devices"]
for runtime, devices in data.items():
    if "iOS" not in runtime: continue
    version = runtime.split("iOS-")[-1].replace("-", ".")
    for d in devices:
        print(d["name"] + " (iOS " + version + ")|" + d["udid"])
')
[ -n "$LIST" ] || { echo "no simulators: add some in Xcode > Window > Devices and Simulators"; exit 1; }

NAMES=$(printf '%s\n' "$LIST" | cut -d'|' -f1 | python3 -c '
import sys; print(", ".join("\"" + l.strip() + "\"" for l in sys.stdin if l.strip()))')
PICKED=$(osascript \
  -e "set picked to (choose from list {$NAMES} with title \"justtype\" with prompt \"Install on which simulators?\" with multiple selections allowed)" \
  -e 'if picked is false then return ""' \
  -e 'set AppleScript'"'"'s text item delimiters to linefeed' \
  -e 'return picked as text')
[ -n "$PICKED" ] || { echo "nothing picked"; exit 0; }

if [ "$1" != "--no-web" ]; then
  ( cd ../repo && node scripts/check-jsx-bindings.cjs && K="$(grep '^TURNSTILE_SITE_KEY=' .env | cut -d= -f2- | tr -d '"'"'"' ')" \
    && VITE_TURNSTILE_SITE_KEY="$K" VITE_APP=1 VITE_BETA=1 VITE_API_URL=https://beta.justtype.io/api VITE_PUBLIC_URL=https://beta.justtype.io npm run build > /tmp/jt-app-build.log 2>&1 ) || { echo "web build failed"; tail -20 /tmp/jt-app-build.log; exit 1; }
  sh variant.sh bundled | tail -1
fi

# One simulator build serves every simulator
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator \
  -destination "generic/platform=iOS Simulator" -derivedDataPath build CODE_SIGNING_ALLOWED=NO build 2>&1 \
  | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
APP=build/Build/Products/Debug-iphonesimulator/App.app

open -a Simulator
printf '%s\n' "$PICKED" | while IFS= read -r name; do
  [ -n "$name" ] || continue
  udid=$(printf '%s\n' "$LIST" | grep -F "$name|" | head -1 | cut -d'|' -f2)
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl terminate "$udid" io.justtype.app 2>/dev/null || true
  xcrun simctl install "$udid" "$APP"
  xcrun simctl launch "$udid" io.justtype.app >/dev/null
  echo "installed: $name"
done
