#!/bin/sh
# Build justtype.app: the web build for the Mac (the desktop layout, API
# relayed through the app, against justtype.io), the Swift executable with
# Sparkle beside it, the icon, and the bundle around them. Signs with the Apple Development
# identity when it is there (a stable signature), else ad hoc; with
# --release, with Developer ID and a timestamp, as notarization needs
# (release.sh does that and makes the DMG).
# Usage: sh build.sh [--run] [--selftest] [--no-web] [--release] [--shots]
set -e
cd "$(dirname "$0")"
REPO=../repo
OUT=build
APP="$OUT/justtype.app"
RUN=0; SELFTEST=0; WEB=1; RELEASE=0; SHOTS=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    --selftest) SELFTEST=1 ;;
    --no-web) WEB=0 ;;
    --release) RELEASE=1 ;;
    --shots) SHOTS=1 ;;
  esac
done
# A release is built beside the everyday app, never over the one running
if [ "$RELEASE" = 1 ]; then OUT=build/release; APP="$OUT/justtype.app"; fi
# So is the copy that takes the site's pictures (site-shots.sh)
if [ "$SHOTS" = 1 ]; then OUT=build/shots; APP="$OUT/justtype.app"; fi

if [ "$WEB" = 1 ]; then
  # Prod's Turnstile site key (public: it ships in every page), as ios/testflight.sh reads it
  K="${VITE_TURNSTILE_SITE_KEY:-$(ssh justtype-vps "grep '^VITE_TURNSTILE_SITE_KEY=' /root/justtype/.env | cut -d= -f2-" | tr -d "\"' ")}"
  [ -n "$K" ] || { echo "could not read prod's turnstile site key"; exit 1; }
  # NODE_ENV: the repo's .env says development (for the local server), and
  # Vite would build a development bundle calling localhost:3001 from it
  ( cd "$REPO" && node scripts/check-jsx-bindings.cjs > /dev/null && NODE_ENV=production VITE_APP=1 VITE_OUT_DIR=dist-mac \
    VITE_TURNSTILE_SITE_KEY="$K" VITE_PUBLIC_URL=https://justtype.io npm run build > /tmp/jt-mac-web.log 2>&1 ) \
    || { echo "web build failed"; tail -20 /tmp/jt-mac-web.log; exit 1; }
  grep -q 'beta.justtype.io' "$REPO"/dist-mac/assets/*.js && { echo "the build still names beta.justtype.io"; exit 1; }
  grep -q 'localhost:3001' "$REPO"/dist-mac/assets/*.js && { echo "the build is a development build (calls localhost)"; exit 1; }
  echo "web built ($(du -sh "$REPO/dist-mac" | cut -f1))"
fi

# A release runs on Apple silicon and Intel alike; the everyday build on this Mac
if [ "$RELEASE" = 1 ]; then
  swift build -c release --arch arm64 --arch x86_64 2>&1 | grep -E "error:|Build complete" | tail -3
  BIN=.build/apple/Products/Release
else
  swift build -c release 2>&1 | grep -E "error|warning: unre|Compiling|Build complete" | grep -v "^\s*$" | tail -5
  BIN=.build/release
fi
VERSION="$(sed -n "s/.*VERSION = '\([^']*\)'.*/\1/p" "$REPO/src/version.js" | sed 's/-beta.*//')"
BUILD="$(date -u +%Y%m%d%H%M)"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Frameworks"
cp "$BIN/Justtype" "$APP/Contents/MacOS/justtype"
# Sparkle, where the executable looks for it
ditto "$BIN/Sparkle.framework" "$APP/Contents/Frameworks/Sparkle.framework"
install_name_tool -add_rpath @executable_path/../Frameworks "$APP/Contents/MacOS/justtype"
cp -R "$REPO/dist-mac" "$APP/Contents/Resources/web"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" Resources/Info.plist > "$APP/Contents/Info.plist"
# Only a release looks for updates: where, the key they are signed with
# (the private half: the login keychain, account justtype, and
# ~/.config/justtype/sparkle-ed25519.key), and quietly, installed on quit
if [ "$RELEASE" = 1 ]; then
  P=/usr/libexec/PlistBuddy
  $P -c "Add :SUFeedURL string https://justtype.io/mac/appcast.xml" \
     -c "Add :SUPublicEDKey string 6W/h9VCCoAJbWnb2jLAk2gXbioz2qw2XAeHXodZPlcI=" \
     -c "Add :SUEnableAutomaticChecks bool true" \
     -c "Add :SUAutomaticallyUpdate bool true" "$APP/Contents/Info.plist"
fi
# IBM Plex Mono, the page's font, for what the app draws itself (the glass controls)
cp -R Resources/Fonts "$APP/Contents/Resources/Fonts"

# The icon, from the same Icon Composer file the iOS app uses
xcrun actool ../ios/ios/App/App/JT_ICON.icon --compile "$APP/Contents/Resources" --platform macosx \
  --minimum-deployment-target 13.0 --app-icon JT_ICON --output-partial-info-plist /tmp/jt-mac-icon.plist \
  > /tmp/jt-mac-actool.log 2>&1 || echo "icon not compiled (see /tmp/jt-mac-actool.log)"

# Signed from the inside out, as Sparkle's guide has it: its helpers, the
# framework, then the app around them. $2 is the timestamp option.
sign() {
  FW="$APP/Contents/Frameworks/Sparkle.framework"
  codesign -f -s "$1" -o runtime $2 "$FW/Versions/B/XPCServices/Installer.xpc" &&
  codesign -f -s "$1" -o runtime $2 --preserve-metadata=entitlements "$FW/Versions/B/XPCServices/Downloader.xpc" &&
  codesign -f -s "$1" -o runtime $2 "$FW/Versions/B/Autoupdate" &&
  codesign -f -s "$1" -o runtime $2 "$FW/Versions/B/Updater.app" &&
  codesign -f -s "$1" -o runtime $2 "$FW" &&
  codesign -f -s "$1" -o runtime $2 "$APP"
}

if [ "$RELEASE" = 1 ]; then
  ID="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -1)"
  [ -n "$ID" ] || { echo "no Developer ID Application identity in the keychain"; exit 1; }
  sign "$ID" --timestamp 2>/tmp/jt-mac-sign.log || { echo "release signing failed"; cat /tmp/jt-mac-sign.log; exit 1; }
  codesign --verify --strict --deep "$APP" || { echo "the release signature does not verify"; exit 1; }
  echo "signed for release: $ID"
  echo "built $APP ($(du -sh "$APP" | cut -f1), version $VERSION build $BUILD)"
  exit 0
fi
ID="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' | head -1)"
if [ -n "$ID" ] && sign "$ID" --timestamp=none 2>/tmp/jt-mac-sign.log; then
  echo "signed: $ID"
else
  codesign --force --deep -s - "$APP" && echo "signed ad hoc"
fi
echo "built $APP ($(du -sh "$APP" | cut -f1), version $VERSION build $BUILD)"

if [ "$SELFTEST" = 1 ]; then
  JUSTTYPE_SELFTEST=1 "$APP/Contents/MacOS/justtype" 2>/dev/null | grep SELFTEST
elif [ "$RUN" = 1 ]; then
  open "$APP"
fi
