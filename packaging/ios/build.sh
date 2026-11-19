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
IPA="$OUT/Vela-$VERSION-ios-unsigned.ipa"

# ---------------------------------------------------------------- toolchain

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun not found. This script needs macOS with Xcode (or the" >&2
  echo "       Command Line Tools plus the iOS SDK)." >&2
  exit 1
fi

if ! SDK="$(xcrun --sdk iphoneos --show-sdk-path 2>/dev/null)"; then
  echo "error: the iOS SDK is not installed." >&2
  echo "       Open Xcode > Settings > Platforms and install iOS, or run:" >&2
  echo "       xcodebuild -downloadPlatform iOS" >&2
  exit 1
fi

if [ ! -x "$ROOT/build/velac" ]; then
  echo "error: build/velac is missing - run 'make' first" >&2
  exit 1
fi

echo "== toolchain =="
xcodebuild -version 2>/dev/null || true
echo "sdk:     $SDK"
echo "version: $VERSION"

# ---------------------------------------------------------------- build

rm -rf "$STAGE" "$OUT/ipa" "$IPA"
mkdir -p "$APP"

echo "== 1. Vela -> C =="
"$ROOT/build/velac" "$ROOT/examples/ios_demo.vela" --emit-c -o "$STAGE/ios_demo.c"

echo "== 2. C + UIKit shell -> arm64 executable =="
xcrun --sdk iphoneos clang \
  -target arm64-apple-ios15.0 \
  -isysroot "$SDK" \
  -fobjc-arc \
  -O2 \
  -Wall \
  -I "$ROOT/runtime" \
  "$ROOT/ios/main.m" \
  "$STAGE/ios_demo.c" \
  "$ROOT/runtime/vela_runtime.c" \
  -framework UIKit \
  -framework Foundation \
  -framework CoreGraphics \
  -o "$APP/Vela"

# ---------------------------------------------------------------- bundle

echo "== 3. bundle =="
cp "$ROOT/ios/Info.plist" "$APP/Info.plist"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$APP/Info.plist"
plutil -lint "$APP/Info.plist"
printf 'APPL????' > "$APP/PkgInfo"

if [ ! -x "$APP/Vela" ]; then
  echo "error: the app binary was not produced" >&2
  exit 1
fi

lipo -info "$APP/Vela"
file "$APP/Vela"
ls -l "$APP"

# A signed app is the user's job, but an obviously broken Mach-O is ours.
if ! otool -l "$APP/Vela" | grep -q "LC_BUILD_VERSION\|LC_VERSION_MIN_IPHONEOS"; then
  echo "error: the binary does not declare an iOS platform load command" >&2
  exit 1
fi

# ---------------------------------------------------------------- ipa

echo "== 4. ipa =="
mkdir -p "$OUT/ipa/Payload"
cp -R "$APP" "$OUT/ipa/Payload/"
(cd "$OUT/ipa" && zip -qry "$IPA" Payload)

unzip -l "$IPA" | head -20
if ! unzip -l "$IPA" | grep -q "Payload/Vela.app/Vela"; then
  echo "error: the ipa does not contain Payload/Vela.app/Vela" >&2
  exit 1
fi

echo ""
echo "built $IPA ($(du -h "$IPA" | cut -f1))"
echo "this build is unsigned: use Sideloadly, AltStore or TrollStore to sign it."
