#!/bin/sh
# Load app/.env into the environment, then exec the rest.
# .env is gitignored; copy from .env.example.
set -e
root="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
if [ -f "$root/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$root/.env"
  set +a
  # Tauri treats a set-but-empty APPLE_ID as "please notarize".
  for v in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_SIGNING_IDENTITY \
    APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD \
    APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH \
    APPLE_PROVIDER_SHORT_NAME; do
    eval "val=\${$v-}"
    if [ -z "$val" ]; then
      unset "$v"
    fi
  done
fi
exec "$@"
