#!/bin/bash
# Build the Calliope ML data program for mini 1/2 (DAL) and mini 3 (CODAL).
# Runs in WSL/Linux. Both toolchains are borrowed from an existing
# calliope-dev checkout, so the build works offline:
#   - DAL:   yotta via Docker (pext/yotta:update-yotta3) with yotta_modules +
#            yotta_targets taken from a staged DAL build dir
#            ($DAL_MODULES, the Blocks runtime's staged dir by default).
#   - CODAL: build.py + libraries/ from calliope-dev's codal blocks-runtime
#            ($CODAL_BASE), with arm-none-eabi-gcc and cmake on the PATH.
# The sources are copied into scratch dirs under $WORK (native Linux FS, so
# make never sees Windows mtimes); outputs land in ./out/.
#
# Usage: ./build.sh [dal|codal|all]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WHAT="${1:-all}"
WORK="${WORK:-$HOME/ml-fw}"
DAL_MODULES="${DAL_MODULES:-$HOME/cdev-build-blocks-dal}"
CODAL_BASE="${CODAL_BASE:-/mnt/d/GIT/calliope-dev/firmware/codal/blocks-runtime}"
OUT="$HERE/out"
mkdir -p "$OUT" "$WORK"

build_dal() {
  local D="$WORK/dal"
  mkdir -p "$D"
  [ -d "$D/yotta_modules" ] || cp -a "$DAL_MODULES/yotta_modules" "$D/"
  [ -d "$D/yotta_targets" ] || cp -a "$DAL_MODULES/yotta_targets" "$D/"
  rm -rf "$D/source"
  cp -a "$HERE/source" "$D/source"
  cp "$HERE/dal/module.json" "$HERE/dal/config.json" "$HERE/dal/.yotta.json" "$D/"
  (cd "$D" && docker run --rm -v "$D":/src pext/yotta:update-yotta3 \
    bash -lc "cd /src && git config --global --add safe.directory /src 2>/dev/null; yotta build 2>&1 | tail -30")
  cp "$D/build/calliope-mini-classic-gcc/source/calliope-ml-data-combined.hex" "$OUT/ml-data-dal.hex"
  echo "DAL -> $OUT/ml-data-dal.hex"
}

build_codal() {
  local D="$WORK/codal"
  mkdir -p "$D"
  if [ ! -d "$D/libraries" ]; then
    for f in build.py CMakeLists.txt utils patches libraries; do
      cp -a "$CODAL_BASE/$f" "$D/"
    done
  fi
  rm -rf "$D/source"
  cp -a "$HERE/source" "$D/source"
  cp "$HERE/codal/codal.json" "$D/codal.json"
  (cd "$D" && rm -rf build && python3 build.py 2>&1 | tail -30)
  # Ship the bootloader the previous data collection program carried (see README).
  local BOOT="$WORK/old-mini3.hex"
  python3 "$HERE/tools/split_universal.py" "$HERE/../../src/device/firmware/universal-hex.hex" 9900 "$BOOT"
  python3 "$HERE/tools/swap_bootloader.py" "$D/MICROBIT.hex" "$BOOT" "$OUT/ml-data-codal.hex"
  echo "CODAL -> $OUT/ml-data-codal.hex"
}

case "$WHAT" in
  dal) build_dal ;;
  codal) build_codal ;;
  all) build_dal; build_codal ;;
  *) echo "usage: $0 [dal|codal|all]" >&2; exit 2 ;;
esac
