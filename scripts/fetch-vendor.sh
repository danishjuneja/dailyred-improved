#!/usr/bin/env bash
# Downloads the website's third-party files into web/vendor/ so the site is
# fully self-hosted (no CDN at runtime). Versions and checksums are pinned.
#
#   - Nostalgist.js (MIT): small JS API around RetroArch's Emscripten build
#   - mGBA libretro core compiled to WebAssembly (GPL-3.0 / MPL-2.0),
#     from https://github.com/arianrhodsandlot/retroarch-emscripten-build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/web/vendor"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

NOSTALGIST_VER="0.22.0"
NOSTALGIST_SHA="e0bb4a7c0adefd4399034c4931dcc13720ff87aaedd6e1f20d88db3564da5876"
CORE_REL="v1.22.2"
CORE_SHA="d195371c3ea626c9246e9d3ab82ded4d93f3f99f85634af1588724cc44d47644"

check() { # file sha
  local actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$1" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$1" | awk '{print $1}')"
  fi
  [ "$actual" = "$2" ] || { echo "Checksum mismatch: $1 ($actual)"; exit 1; }
}

mkdir -p "$VENDOR"

echo ">> Nostalgist $NOSTALGIST_VER"
curl -fsSL -o "$TMP/nostalgist.tgz" "https://registry.npmjs.org/nostalgist/-/nostalgist-$NOSTALGIST_VER.tgz"
check "$TMP/nostalgist.tgz" "$NOSTALGIST_SHA"
tar -xzf "$TMP/nostalgist.tgz" -C "$TMP"
cp "$TMP/package/dist/nostalgist.js" "$VENDOR/nostalgist.js"
cp "$TMP/package/license" "$VENDOR/nostalgist.LICENSE.txt"

echo ">> mGBA core ($CORE_REL)"
curl -fsSL -o "$TMP/mgba.zip" \
  "https://cdn.jsdelivr.net/gh/arianrhodsandlot/retroarch-emscripten-build@$CORE_REL/retroarch/mgba_libretro.zip"
check "$TMP/mgba.zip" "$CORE_SHA"
unzip -oq "$TMP/mgba.zip" -d "$VENDOR"

ls -la "$VENDOR"
