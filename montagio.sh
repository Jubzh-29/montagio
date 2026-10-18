#!/usr/bin/env bash
# Montagio on Linux: ./montagio.sh install | start | stop | status | help
# Guide: docs/INSTALL.md. The installer itself is infra/local/src/cli.ts;
# this script only checks that Node.js can run it.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

version=$(node --version 2>/dev/null || true)
if [[ ! $version =~ ^v([0-9]+)\.([0-9]+) ]]; then
  echo "Node.js is missing: Montagio needs Node.js 22.18 or newer. Install it from https://nodejs.org (or: nvm install 22), then run this again." >&2
  exit 1
fi
major=${BASH_REMATCH[1]}
minor=${BASH_REMATCH[2]}
if ((major < 22 || (major == 22 && minor < 18))); then
  echo "Node.js $version is too old: Montagio needs 22.18 or newer. Update it from https://nodejs.org (or: nvm install 22), then run this again." >&2
  exit 1
fi

exec node "$ROOT/infra/local/src/cli.ts" "$@"
