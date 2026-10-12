#!/usr/bin/env bash
# Builds the modified FireRed ROM with either the project-local toolchain
# (see scripts/setup-macos.sh) or a system arm-none-eabi toolchain.
#
#   scripts/build-rom.sh            # normal build
#   scripts/build-rom.sh clean      # any extra args are passed to make
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="$ROOT/.toolchain"
GAME="$ROOT/pokefirered"

MAKE_ARGS=()
if [ -x "$TC/arm-none-eabi/bin/arm-none-eabi-gcc" ]; then
  MAKE_ARGS+=("TOOLCHAIN=$TC/arm-none-eabi")
  if [ -f "$TC/libpng/lib/libpng.a" ]; then
    # gbagfx asks pkg-config for libpng. The local library is supplied here.
    export CPATH="$TC/libpng/include${CPATH:+:$CPATH}"
    export LIBRARY_PATH="$TC/libpng/lib${LIBRARY_PATH:+:$LIBRARY_PATH}"
    export PATH="$ROOT/scripts/shims:$PATH"
  fi
elif ! command -v arm-none-eabi-gcc >/dev/null 2>&1; then
  echo "Arm toolchain missing. Run scripts/setup-macos.sh or install arm-none-eabi-gcc."; exit 1
fi

JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)"

if [ "$#" -gt 0 ]; then
  make -C "$GAME" -j"$JOBS" "${MAKE_ARGS[@]}" MODERN=1 "$@"
  exit 0
fi

make -C "$GAME" -j"$JOBS" "${MAKE_ARGS[@]}" MODERN=1

ROM="$GAME/pokefirered_modern.gba"
# The website downloads a gzipped copy (16 MB -> ~5.5 MB, mostly 0xFF padding)
# and unpacks it in the browser, so it stays small on any static host.
mkdir -p "$ROOT/web/game"
rm -f "$ROOT/web/game/dailyred.gba"
gzip -9 -n -c "$ROM" > "$ROOT/web/game/dailyred.gba.gz"
# RED's battle sprite for the site's title card (from the decomp, like the ROM).
cp "$GAME/graphics/trainers/front_pics/red_front_pic.png" "$ROOT/web/game/red.png"
echo
echo "Built $ROM"
echo "Website copy: web/game/dailyred.gba.gz ($(wc -c < "$ROOT/web/game/dailyred.gba.gz" | tr -d ' ') bytes)"
