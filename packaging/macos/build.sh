#!/usr/bin/env bash
# Builds a universal (arm64 + x86_64) macOS toolchain disk image.
# The image is not signed: Gatekeeper asks for a right-click > Open the first
# time, or run:  xattr -d com.apple.quarantine /path/to/velac
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(cat "$ROOT/VERSION")"
OUT="$ROOT/dist"
STAGE="$OUT/stage/Vela-$VERSION"
SDK="$(xcrun --show-sdk-path)"

rm -rf "$OUT/stage"
mkdir -p "$STAGE/bin" "$STAGE/lib/vela/runtime" "$STAGE/share/doc/vela"

for arch in arm64 x86_64; do
  clang -std=c11 -O2 -isysroot "$SDK" -arch "$arch" \
        -DVELA_VERSION="\"$VERSION\"" \
        -o "$OUT/velac-$arch" "$ROOT/src/velac.c"
done

lipo -create -output "$STAGE/bin/velac" "$OUT/velac-arm64" "$OUT/velac-x86_64"
chmod +x "$STAGE/bin/velac"

install -m 644 "$ROOT/runtime/vela_runtime.h" \
               "$ROOT/runtime/vela_runtime.c" \
               "$ROOT/runtime/vela_main.c" \
               "$STAGE/lib/vela/runtime/"

install -m 644 "$ROOT/README.md" "$ROOT/LICENSE" "$STAGE/share/doc/vela/"

cat > "$STAGE/INSTALL.txt" <<'EOF'
Vela for macOS
==============

This disk image holds the Vela compiler (velac) for Apple silicon and Intel
Macs, the Vela runtime it links programs against, and the documentation.

Try it without installing anything:

    cd /Volumes/Vela*/Vela-*/bin
    ./velac --version

Install into /usr/local (so "velac" works from anywhere):

    /Volumes/Vela*/Vela-*/install.sh

This build is unsigned. If macOS refuses to run it, either right-click the
binary and choose Open, or clear the quarantine flag:

    xattr -dr com.apple.quarantine /usr/local/bin/velac /usr/local/lib/vela

velac looks for the runtime in ../lib/vela/runtime relative to itself, which
is why velac and lib/vela must be installed side by side (as above).
EOF

cat > "$STAGE/install.sh" <<'EOF'
#!/bin/bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
prefix="${1:-/usr/local}"
install -d "$prefix/bin" "$prefix/lib/vela/runtime"
install -m 755 "$here/bin/velac" "$prefix/bin/velac"
install -m 644 "$here/lib/vela/runtime/"* "$prefix/lib/vela/runtime/"
echo "installed velac into $prefix/bin"
EOF
chmod +x "$STAGE/install.sh"

hdiutil create -volname "Vela $VERSION" -srcfolder "$STAGE" -ov \
               -format UDZO "$OUT/Vela-$VERSION-macos-universal-unsigned.dmg"

echo "built $OUT/Vela-$VERSION-macos-universal-unsigned.dmg"
