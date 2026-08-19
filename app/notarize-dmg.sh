#!/bin/sh
# Tauri notarizes the .app, then wraps it in a signed DMG and stops.
# Gatekeeper on a downloaded disk image checks the wrapper, so an unstapled
# .dmg still trips "Apple could not verify…" even though the app inside is
# fine. Submit and staple each .dmg when Apple credentials are in the env
# (with-env.sh loads them). No-op otherwise, so CI and ad-hoc local builds
# still succeed.
set -e
root="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
dmg_dir="$root/src-tauri/target/release/bundle/dmg"

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

use_api=
use_id=
if [ -n "${APPLE_API_KEY-}" ] && [ -n "${APPLE_API_ISSUER-}" ] && [ -n "${APPLE_API_KEY_PATH-}" ]; then
  use_api=1
elif [ -n "${APPLE_ID-}" ] && [ -n "${APPLE_PASSWORD-}" ] && [ -n "${APPLE_TEAM_ID-}" ]; then
  use_id=1
else
  echo "notarize-dmg: no Apple credentials; skipping"
  exit 0
fi

if [ ! -d "$dmg_dir" ]; then
  echo "notarize-dmg: no $dmg_dir" >&2
  exit 1
fi

found=
for dmg in "$dmg_dir"/*.dmg; do
  [ -e "$dmg" ] || continue
  found=1
  if xcrun stapler validate "$dmg" >/dev/null 2>&1; then
    echo "notarize-dmg: already stapled $(basename "$dmg")"
    continue
  fi
  echo "notarize-dmg: submitting $(basename "$dmg")"
  if [ -n "$use_api" ]; then
    xcrun notarytool submit "$dmg" \
      --key "$APPLE_API_KEY_PATH" \
      --key-id "$APPLE_API_KEY" \
      --issuer "$APPLE_API_ISSUER" \
      --wait --timeout 20m
  else
    xcrun notarytool submit "$dmg" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" \
      --wait --timeout 20m
  fi
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
done

if [ -z "$found" ]; then
  echo "notarize-dmg: no .dmg in $dmg_dir" >&2
  exit 1
fi
