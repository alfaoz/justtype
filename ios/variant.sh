#!/bin/sh
# Switch the shell between its variants and sync the web assets.
#   sh variant.sh live      the web view loads beta.justtype.io as it is
#   sh variant.sh bundled   the web view runs ../repo/dist-app from the app bundle
#   sh variant.sh prod      the same, answering to justtype.io (testflight.sh)
set -e
cd "$(dirname "$0")"
case "$1" in
  live)
    cp capacitor.live.json capacitor.config.json
    rm -rf www && mkdir www && printf '<!doctype html><meta charset="utf-8"><title>justtype</title><body style="background:#050505"></body>' > www/index.html ;;
  bundled)
    cp capacitor.bundled.json capacitor.config.json
    rm -rf www && cp -R ../repo/dist-app www ;;
  prod)
    cp capacitor.prod.json capacitor.config.json
    rm -rf www && cp -R ../repo/dist-app www ;;
  *) echo "usage: sh variant.sh live|bundled|prod"; exit 1 ;;
esac
npx cap copy ios
echo "variant: $1"
