#!/bin/sh
# Build the app against justtype.io (prod) and upload it to TestFlight.
# Signs with the team's distribution certificate through the Xcode account
# on this Mac. The build number is the UTC time, so every upload is newer.
# Usage: sh testflight.sh   (then sh build.sh or device.sh go back to beta)
set -e
TEAM="${TEAM:-TMF25D4TR4}"
cd "$(dirname "$0")"
OUT=build-release
LOG=/tmp/jt-testflight.log

# Prod's Turnstile site key (public: it ships in every page), from prod's .env
K="$(ssh justtype-vps "grep '^VITE_TURNSTILE_SITE_KEY=' /root/justtype/.env | cut -d= -f2-" | tr -d "\"' ")"
[ -n "$K" ] || { echo "could not read prod's turnstile site key"; exit 1; }
( cd ../repo && node scripts/check-jsx-bindings.cjs && VITE_TURNSTILE_SITE_KEY="$K" VITE_APP=1 \
  VITE_API_URL=https://justtype.io/api VITE_PUBLIC_URL=https://justtype.io npm run build > /tmp/jt-app-build.log 2>&1 ) \
  || { echo "web build failed"; tail -20 /tmp/jt-app-build.log; exit 1; }
grep -q 'beta.justtype.io' ../repo/dist-app/assets/*.js && { echo "the prod build still names beta.justtype.io"; exit 1; }
sh variant.sh prod | tail -1

BUILD="$(date -u +%Y%m%d%H%M)"
rm -rf "$OUT"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUT/justtype.xcarchive" -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION="$BUILD" archive > "$LOG" 2>&1 || { grep -E "error:" "$LOG" | head; echo "archive failed ($LOG)"; exit 1; }
echo "archived build $BUILD"

cat > "$OUT/export.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
EOF
xcodebuild -exportArchive -archivePath "$OUT/justtype.xcarchive" -exportOptionsPlist "$OUT/export.plist" \
  -exportPath "$OUT/export" -allowProvisioningUpdates >> "$LOG" 2>&1 || {
  # The command line upload can fail on the account lookup (providerId) while
  # Xcode's own window uploads fine: hand the archive to Organizer instead
  grep -E "^error" "$LOG" | tail -3
  open "$OUT/justtype.xcarchive"
  echo "upload it from Organizer: Distribute App > App Store Connect > Distribute"; exit 0; }
echo "uploaded build $BUILD: it shows in TestFlight once Apple has processed it"
