#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 || ( "$1" != arm64 && "$1" != x86_64 ) ]]; then
  echo 'Usage: bash scripts/smoke-macos-package.sh <arm64|x86_64> <package.dmg>' >&2
  exit 1
fi
arch="$1"
dmg="$2"
stage=$(mktemp -d "${TMPDIR:-/tmp}/fm-savelens-dmg.XXXXXX")
stage=$(cd "$stage" && pwd -P)
mount="$stage/mount"
mkdir -p "$mount"
cleanup() {
  local status=$?
  trap - EXIT
  # Also handle a partially successful attach. Never remove a mounted volume.
  if mount | grep -Fq " on $mount ("; then
    if ! hdiutil detach "$mount"; then
      if ! hdiutil detach -force "$mount"; then
        echo "Could not detach $mount; leaving temporary files in place." >&2
        exit 1
      fi
    fi
  fi
  rm -rf "$stage"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

hdiutil verify "$dmg"
hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mount"
app="$stage/FM SaveLens 24.app"
ditto "$mount/FM SaveLens 24.app" "$app"
hdiutil detach "$mount"

binary="$app/Contents/MacOS/fm-savelens-24"
test -x "$binary"
actual_arch=$(lipo -archs "$binary")
if [[ "$actual_arch" != "$arch" ]]; then
  echo "Expected $arch executable, found $actual_arch" >&2
  exit 1
fi
codesign --verify --deep --strict --verbose=2 "$app"
signature=$(codesign --display --verbose=4 "$app" 2>&1)
printf '%s\n' "$signature"
printf '%s\n' "$signature" | grep -q '^Signature=adhoc$'

# smoke-package owns and stops the browser process group, including on failure.
# This verifies packaged assets and APIs; it does not validate the native window.
node scripts/smoke-package.mjs "$binary" --browser
