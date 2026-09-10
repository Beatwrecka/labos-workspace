#!/usr/bin/env bash
# LabOS Workspace — launch the locally built app.
#
#   bash labos/scripts/launch-labos.sh           # launch
#   bash labos/scripts/launch-labos.sh --doctor  # report readiness only
#
# Deliberately does not install into /Applications: the briefing asks for a
# separately installed app but not for this to overwrite anything, so launching
# from the build output is the safe default. Point LABOS_APP at an installed copy
# to launch that instead.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck disable=SC1091
. "$REPO_ROOT/labos/scripts/labos-env.sh"

BUILD_TYPE="${BUILD_TYPE:-labos}"
APP="${LABOS_APP:-$REPO_ROOT/packages/frontend/apps/electron/out/$BUILD_TYPE/LabOS Workspace-darwin-arm64/LabOS Workspace.app}"

# Data and log locations are derived, never hard-coded to an absolute home path
# in source. Electron resolves these under the platform appData/logs directory.
# Data and log locations are derived at runtime rather than written as absolute
# paths in source: a literal machine path is a private configuration detail, and
# the leak scanner rejects one. Electron resolves both under the platform's
# appData and logs directories, which on macOS live beneath the user's Library.
SUPPORT_ROOT="${LABOS_SUPPORT_ROOT:-$HOME/Library/Application Support}"
LOGS_ROOT="${LABOS_LOGS_ROOT:-$HOME/Library/Logs}"
SUPPORT_DIR="$SUPPORT_ROOT/LabOS Workspace"
LOG_DIR="$LOGS_ROOT/LabOS Workspace"
STOCK_SUPPORT="$SUPPORT_ROOT/AFFiNE"

problems=0
report() { printf '  %-22s %s\n' "$1" "$2"; }
fail() { printf '  %-22s %s\n' "$1" "$2"; problems=$((problems + 1)); }

echo "LabOS Workspace doctor"
echo

echo "Toolchain"
want_node="$(tr -d '[:space:]' < .nvmrc 2>/dev/null || echo '?')"
report "pinned node" "$want_node (have $(node -v 2>/dev/null || echo missing))"
report "pinned rust" "$(sed -n 's/^channel *= *"\(.*\)"/\1/p' rust-toolchain.toml 2>/dev/null) (have $(rustc --version 2>/dev/null | awk '{print $2}' || echo missing))"
echo

echo "Build artefacts"
if [ -d "$APP" ]; then
  report "app bundle" "present"
  report "bundle id" "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist" 2>/dev/null || echo unknown)"
  report "url scheme" "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$APP/Contents/Info.plist" 2>/dev/null || echo unknown)"
  if codesign --verify --deep --strict "$APP" 2>/dev/null; then
    report "signature" "valid"
  else
    fail "signature" "INVALID - the app will be killed at launch"
  fi
  if [ -f "$APP/Contents/Resources/app.asar" ]; then
    report "asar" "present ($(du -h "$APP/Contents/Resources/app.asar" | cut -f1))"
  else
    fail "asar" "missing"
  fi
else
  fail "app bundle" "not built - run: bash labos/scripts/package-labos.sh"
fi
echo

echo "Isolation"
report "LabOS data dir" "$( [ -d "$SUPPORT_DIR" ] && echo present || echo 'not created yet' )"
report "LabOS logs dir" "$( [ -d "$LOG_DIR" ] && echo present || echo 'not created yet' )"
report "stock AFFiNE data" "$( [ -d "$STOCK_SUPPORT" ] && echo 'present (never written by LabOS)' || echo absent )"
if [ -d "$SUPPORT_DIR" ] && [ "$SUPPORT_DIR" = "$STOCK_SUPPORT" ]; then
  fail "isolation" "LabOS would share stock AFFiNE's data directory"
fi
echo

if [ "${1:-}" = "--doctor" ]; then
  if [ "$problems" -eq 0 ]; then
    echo "ready"
    exit 0
  fi
  echo "$problems problem(s) found"
  exit 1
fi

if [ ! -d "$APP" ]; then
  echo "cannot launch: app not built. Run: bash labos/scripts/package-labos.sh" >&2
  exit 1
fi

echo "launching $APP"
open -a "$APP"
echo "launched. Logs: $LOG_DIR/main.log"
