#!/usr/bin/env bash
# Builds an installable Debian package: velac plus the Vela runtime.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(cat "$ROOT/VERSION")"
ARCH="$(dpkg --print-architecture)"
OUT="$ROOT/dist"
PKG="$OUT/deb/vela_${VERSION}_${ARCH}"

rm -rf "$PKG"
mkdir -p "$PKG/DEBIAN" \
         "$PKG/usr/bin" \
         "$PKG/usr/lib/vela/runtime" \
         "$PKG/usr/share/doc/vela"

cc -std=c11 -O2 -DVELA_VERSION="\"$VERSION\"" -o "$PKG/usr/bin/velac" "$ROOT/src/velac.c"

install -m 644 "$ROOT/runtime/vela_runtime.h" \
               "$ROOT/runtime/vela_runtime.c" \
               "$ROOT/runtime/vela_main.c" \
               "$PKG/usr/lib/vela/runtime/"

install -m 644 "$ROOT/README.md" "$ROOT/LICENSE" "$PKG/usr/share/doc/vela/"

SIZE="$(du -sk "$PKG" | cut -f1)"

{
  echo "Package: vela"
  echo "Version: $VERSION"
  echo "Section: devel"
  echo "Priority: optional"
  echo "Architecture: $ARCH"
  echo "Depends: libc6, gcc | clang"
  echo "Maintainer: Vela contributors <noreply@localhost>"
  echo "Installed-Size: $SIZE"
  echo "Description: Vela programming language compiler"
  echo " Vela is a small language that compiles to portable C and then to a"
  echo " native binary with the host C compiler. This package installs velac"
  echo " together with the runtime sources it needs to build programs."
} > "$PKG/DEBIAN/control"

dpkg-deb --build --root-owner-group "$PKG" "$OUT/vela_${VERSION}_${ARCH}.deb"
echo "built $OUT/vela_${VERSION}_${ARCH}.deb"
