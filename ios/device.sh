#!/bin/sh
# Build the app for the iPhone on the cable, sign it with the team's
# development certificate, install it and open it. Usage: sh device.sh [--no-web]
# The phone needs Developer Mode on (Settings > Privacy & Security) and to
# trust this Mac. Another team: TEAM=XXXXXXXXXX sh device.sh
set -e
TEAM="${TEAM:-TMF25D4TR4}"
cd "$(dirname "$0")"
[ "$1" = "--no-web" ] || sh build.sh --web-only
# The first paired iPhone that is connected
PHONE=$(xcrun devicectl list devices --json-output /tmp/jt-devices.json >/dev/null 2>&1 && python3 -c "
import json
for d in json.load(open('/tmp/jt-devices.json'))['result']['devices']:
    if d.get('hardwareProperties', {}).get('platform') == 'iOS' and d.get('connectionProperties', {}).get('pairingState') == 'paired' \
       and d.get('connectionProperties', {}).get('tunnelState') != 'unavailable':
        print(d['identifier'], d['hardwareProperties']['udid']); break
")
[ -n "$PHONE" ] || { echo "no connected iPhone (plug it in, unlock it, trust this Mac)"; exit 1; }
UDID=${PHONE#* }
PHONE=${PHONE% *}
# Built for this very phone, so automatic signing registers it on the team
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination "id=$UDID" \
  -derivedDataPath build-device -allowProvisioningUpdates -allowProvisioningDeviceRegistration DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic build 2>&1 \
  | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
APP=build-device/Build/Products/Debug-iphoneos/App.app
[ -d "$APP" ] || exit 1
xcrun devicectl device install app --device "$PHONE" "$APP" | tail -1
xcrun devicectl device process launch --device "$PHONE" io.justtype.app | tail -1
