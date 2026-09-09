#!/usr/bin/env bash
#
# DarkRoute -- one-shot development setup.
#
# Idempotent: safe to run any number of times. It installs the pinned pnpm
# workspace and never touches configuration or git state.
#
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '\033[0;36m[fwm]\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m[fwm] %s\033[0m\n' "$*" >&2; exit 1; }

log "repository: ${REPO_ROOT}"

command -v node >/dev/null 2>&1 \
  || die "node not found. DarkRoute requires Node.js 22.12 or newer."
command -v pnpm >/dev/null 2>&1 \
  || die "pnpm not found. This repo is pnpm-only (npm/yarn will create a second lockfile). Install: corepack enable && corepack prepare pnpm@9.15.9 --activate"
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)" \
  || die "node $(node --version) is unsupported. DarkRoute requires Node.js 22.12 or newer."
log "pnpm: $(pnpm --version)"
log "installing node workspace"
( cd "${REPO_ROOT}" && pnpm install --frozen-lockfile )

cat <<'USAGE'

[fwm] setup complete.

  develop
    pnpm dev                  PWA dev server on http://127.0.0.1:5173
    pnpm dev:pwa              the same, explicitly

  test
    pnpm test                 all unit, script, Function and gateway tests
    pnpm test:gateway         submission gateway tests only
    pnpm test:e2e             playwright
                              first time only: pnpm exec playwright install chromium

  check
    pnpm lint                 eslint + design-token check
    pnpm check:design         design-token check on its own
    pnpm typecheck            tsc --noEmit, strict, across the workspace
    pnpm format               prettier --write

  build
    pnpm build                production PWA build
    pnpm build:pwa            the same, explicitly

  curation tooling

USAGE
