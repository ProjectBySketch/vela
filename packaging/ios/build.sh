#!/usr/bin/env bash
# Builds an unsigned .ipa of the Vela playground app for arm64 iOS.
#
# The app is real Vela: examples/ios_demo.vela is compiled by velac to C,
# compiled to arm64 by clang against UIKit, and packaged as Payload/Vela.app.
# It is not signed, so a sideloading tool (Sideloadly, AltStore, TrollStore)
# has to sign it with the user's own certificate on install.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(cat "$ROOT/VERSION")"
OUT="$ROOT/dist"
STAGE="$OUT/stage-ios"
APP="$STAGE/Vela.app"
SDK="$(xcrun --sdk iphoneos --show-sdk-path)"

rm -rf "$STAGE"
mkdir -p "$APP"

if [ ! -x "$ROOT/build/velac" ]; then
  echo "build/velac is missing - run 'make' first" >&2
  exit 1
fi

# 1. Vela source -> C
"$ROOT/build/velac" "$ROOT/examples/ios_demo.vela" --emit-c -o "$STAGE/ios_demo.c"

# 2. C + the UIKit shell -> arm64 iOS executable
xcrun --sdk iphoneos clang \
  -target arm64-apple-ios15.0 \
  -isysroot "$SDK" \
  -fobjc-arc -O2 \
  -I "$ROOT/runtime" \
  "$ROOT/ios/main.m" \
  "$STAGE/ios_demo.c" \
  "$ROOT/runtime/vela_runtime.c" \
  -framework UIKit \
  -framework Foundation \
  -framework CoreGraphics \
  -o "$APP/Vela"

# 2.5 the bundle
cp "$ROOT/ios/Info.plist" "$APP/Info.plist"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$APP/Info.plist"
plutil -lint "$APP/Info.plist"
printf 'APPL????' > "$APP/PkgInfo"

lipo -info "$APP/Vela"
ls -l "$APP"

# 3. Payload/ -> unsigned .ipa
rm -rf "$OUT/ipa"
mkdir -p "$OUT/ipa/Payload"
cp -R "$APP" "$OUT/ipa/Payload/"
(cd "$OUT/ipa" && zip -qry "$OUT/Vela-$VERSION-ios-unsigned.ipa" Payload)

unzip -l "$OUT/Vela-$VERSION-ios-unsigned.ipa" | head -20
echo "built $OUT/Vela-$VERSION-ios-unsigned.ipa"
