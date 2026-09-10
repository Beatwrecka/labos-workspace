#!/usr/bin/env bash
# LabOS Workspace — build and package a runnable local .app.
#
#   bash labos/scripts/package-labos.sh
#
# Why this script is not a one-liner: the two phases need DIFFERENT node_modules
# layouts, and getting that wrong fails in confusing ways.
#
#   1. The web renderer is built with Yarn's default hoisting. rspack resolves
#      loaders such as `swc-loader` from the hoisted root; under
#      nmHoistingLimits=workspaces that loader lives only in tools/cli and the
#      build dies with "Unable to resolve loader swc-loader".
#   2. electron-forge packages with nmHoistingLimits=workspaces so each
#      workspace keeps its own node_modules where forge can find and bundle the
#      runtime dependencies that esbuild leaves external. Without this the
#      packaged app starts and immediately dies with
#      "Cannot find module 'electron-updater'".
#
# Upstream CI splits these across two jobs for the same reason.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck disable=SC1091
. "$REPO_ROOT/labos/scripts/labos-env.sh"

: "${BUILD_TYPE:=labos}"
export BUILD_TYPE

# Signing: this is a personal local build. It is never signed as upstream, and
# Gatekeeper/SIP are never disabled. LABOS_SIGN_IDENTITY selects an identity;
# the default keeps whatever forge.config.mjs chooses.
export HOIST_NODE_MODULES=1
export SKIP_BUNDLE="${SKIP_BUNDLE:-1}"

log() { printf '\n==> %s\n' "$*"; }

labos_doctor

log "Phase 1/3: build web renderer (default hoisting)"
yarn config set nmHoistingLimits none >/dev/null
yarn config set nmMode hardlinks-local >/dev/null
yarn install --immutable
# Build the renderer and stage it in one pass. `generate-assets` MOVES the
# renderer's dist into resources/web-static (fs.move), so running it with
# SKIP_WEB_BUILD=1 consumes the already-built output and leaves nothing for a
# later packaging step to pick up.
yarn affine @affine/electron generate-assets

log "Phase 2/3: build electron layers"
yarn affine @affine/electron build

log "Phase 3/3: package (workspace hoisting)"
# generate-assets MOVED the renderer output into resources/web-static; packaging
# must not try to rebuild it, or it will find an empty dist.
yarn config set nmHoistingLimits workspaces >/dev/null
yarn config set nmMode classic >/dev/null
yarn install --immutable
SKIP_WEB_BUILD=1 SKIP_GENERATE_ASSETS=1 yarn affine @affine/electron package

OUT_DIR="$REPO_ROOT/packages/frontend/apps/electron/out/$BUILD_TYPE"
log "packaged output"
find "$OUT_DIR" -maxdepth 2 -name "*.app" -print 2>/dev/null || true
