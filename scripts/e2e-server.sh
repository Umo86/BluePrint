#!/usr/bin/env bash
# Starts BluePrint for end-to-end tests on a fresh, seeded local database.
#   E2E_PORT=3200 scripts/e2e-server.sh            (development server)
#   E2E_MODE=production scripts/e2e-server.sh      (after `npm run build`)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${E2E_PORT:-3200}"
export PGLITE_DIR=".data/pglite-e2e"
export SEED_TOTP_SECRET="${E2E_TOTP_SECRET:-JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP}"
rm -rf "$PGLITE_DIR"
npx tsx --conditions=react-server scripts/seed.ts
if [ "${E2E_MODE:-dev}" = "production" ]; then
  # Vercel's functions cannot require() ES modules, so neither can this server: a package that
  # only works because Node can do that here fails these tests instead of the live site.
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--no-experimental-require-module"
  export BLUEPRINT_ALLOW_LOCAL_PRODUCTION=true
  export APP_URL="http://localhost:$PORT"
  exec npx next start -p "$PORT"
else
  exec npx next dev -p "$PORT"
fi
