#!/bin/sh
# A release of justtype for the Mac: the app signed with Developer ID and
# the hardened runtime, then a DMG around it (dmg/: the drawn background
# and the window Finder lays out), the DMG signed, notarized by Apple and stapled, so it
# opens on any Mac without a warning, online or not.
#
# Then what Sparkle reads (the app looks at justtype.io/mac/appcast.xml):
# the DMG signed with the update key, the feed naming it, and latest.json
# for /mac/download and the page. With --publish they go up to
# justtype.io/mac, the DMG first, then what points at it.
#
# Notarization reads the "justtype" profile from the keychain. Once, by hand:
#   xcrun notarytool store-credentials justtype --apple-id <apple id> --team-id TMF25D4TR4
# The update key is ~/.config/justtype/sparkle-ed25519.key (and the login
# keychain, account justtype); its public half is in build.sh.
# --critical marks it as one that can't be skipped or put off: the app asks
# at once, and at every launch until it is in (UpdatePanel.swift).
# --whats-new gives the update window a "what's new" button to
# justtype.io/whats-new (--whats-new=<url> for another page).
# Usage: sh release.sh [--no-notarize] [--publish] [--critical] [--whats-new[=url]]
set -e
cd "$(dirname "$0")"
NOTARIZE=1; PUBLISH=0; CRITICAL=""; NOTES=""
for arg in "$@"; do
  [ "$arg" = "--no-notarize" ] && NOTARIZE=0
  [ "$arg" = "--publish" ] && PUBLISH=1
  [ "$arg" = "--critical" ] && CRITICAL="
      <sparkle:criticalUpdate></sparkle:criticalUpdate>"
  case "$arg" in
    --whats-new) NOTES="
      <sparkle:fullReleaseNotesLink>https://justtype.io/whats-new</sparkle:fullReleaseNotesLink>" ;;
    --whats-new=*) NOTES="
      <sparkle:fullReleaseNotesLink>${arg#--whats-new=}</sparkle:fullReleaseNotesLink>" ;;
  esac
done
KEY="$HOME/.config/justtype/sparkle-ed25519.key"
[ -f "$KEY" ] || { echo "no update key at $KEY"; exit 1; }
PY=/Library/Frameworks/Python.framework/Versions/3.13/bin/python3   # has Pillow
"$PY" -c "import PIL" 2>/dev/null || { echo "needs Pillow for $PY"; exit 1; }

sh build.sh --release
APP=build/release/justtype.app
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist")"
DMG="build/release/justtype-$VERSION.dmg"

# The background at both sizes, as one image Finder picks the right one of
WORK="$(mktemp -d)"
"$PY" dmg/background.py "$WORK" > /dev/null
mkdir -p "$WORK/stage/.background"
tiffutil -cathidpicheck "$WORK/background.png" "$WORK/background@2x.png" -out "$WORK/stage/.background/background.tiff" 2>/dev/null
ditto "$APP" "$WORK/stage/justtype.app"
ln -s /Applications "$WORK/stage/Applications"

# Finder lays the window out itself (a .DS_Store written by any other tool
# is ignored by this Finder: the icons came out huge and the window wide);
# dmg/layout.applescript says how
hdiutil detach /Volumes/justtype -quiet 2>/dev/null || true
hdiutil create -quiet -srcfolder "$WORK/stage" -volname justtype -fs HFS+ -format UDRW -ov "$WORK/rw.dmg"
hdiutil attach -quiet -readwrite -noverify -noautoopen "$WORK/rw.dmg"
cp "$APP/Contents/Resources/JT_ICON.icns" /Volumes/justtype/.VolumeIcon.icns
SetFile -c icnC /Volumes/justtype/.VolumeIcon.icns 2>/dev/null || true
SetFile -a C /Volumes/justtype 2>/dev/null || true
osascript dmg/layout.applescript justtype
chmod -Rf go-w /Volumes/justtype 2>/dev/null || true
sync
hdiutil detach -quiet /Volumes/justtype
rm -f "$DMG"
hdiutil convert -quiet "$WORK/rw.dmg" -format ULFO -o "$DMG"
rm -rf "${WORK:?}"

ID="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -1)"
codesign --force --timestamp -s "$ID" "$DMG"
echo "dmg: $DMG ($(du -h "$DMG" | cut -f1), $VERSION build $BUILD)"

if [ "$NOTARIZE" = 1 ]; then
  if ! xcrun notarytool history --keychain-profile justtype > /dev/null 2>&1; then
    echo "not notarized: no \"justtype\" notarization profile in the keychain (see the top of this file)"
    exit 0
  fi
  echo "notarizing (a few minutes)..."
  xcrun notarytool submit "$DMG" --keychain-profile justtype --wait | tee /tmp/jt-mac-notary.log | grep -E "status:|id:" | head -3
  grep -q "status: Accepted" /tmp/jt-mac-notary.log || { echo "notarization did not pass (xcrun notarytool log <id> --keychain-profile justtype)"; exit 1; }
  xcrun stapler staple "$DMG" > /dev/null && echo "stapled"
  spctl -a -t open --context context:primary-signature -v "$DMG" 2>&1 | head -2
fi

# What Sparkle and the site read. On the server the DMG keeps its build in
# its name, so every release has its own address
[ "$NOTARIZE" = 1 ] || { echo "not notarized: nothing for the feed"; exit 0; }
NAME="justtype-$VERSION-$BUILD.dmg"
SIGNED="$(.build/artifacts/sparkle/Sparkle/bin/sign_update --ed-key-file "$KEY" "$DMG")"
BYTES="$(stat -f %z "$DMG")"
cat > build/release/appcast.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>justtype</title>
    <link>https://justtype.io/mac</link>
    <item>
      <title>$VERSION</title>
      <pubDate>$(LC_ALL=C date -u "+%a, %d %b %Y %H:%M:%S +0000")</pubDate>
      <sparkle:version>$BUILD</sparkle:version>
      <sparkle:shortVersionString>$VERSION</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>$CRITICAL$NOTES
      <enclosure url="https://justtype.io/mac/download/$NAME" type="application/octet-stream" $SIGNED/>
    </item>
  </channel>
</rss>
XML
printf '{\n  "version": "%s",\n  "build": "%s",\n  "file": "%s",\n  "bytes": %s,\n  "system": "13"\n}\n' "$VERSION" "$BUILD" "$NAME" "$BYTES" > build/release/latest.json
echo "feed: $VERSION build $BUILD, $SIGNED"

if [ "$PUBLISH" = 1 ]; then
  ssh justtype-vps "mkdir -p /root/justtype/downloads/mac"
  scp -q "$DMG" "justtype-vps:/root/justtype/downloads/mac/$NAME"
  [ "$(ssh justtype-vps "shasum -a 256 /root/justtype/downloads/mac/$NAME" | cut -d' ' -f1)" = "$(shasum -a 256 "$DMG" | cut -d' ' -f1)" ] \
    || { echo "the uploaded DMG does not match"; exit 1; }
  scp -q build/release/latest.json build/release/appcast.xml justtype-vps:/root/justtype/downloads/mac/
  echo "published: https://justtype.io/mac/download/$NAME"
fi
