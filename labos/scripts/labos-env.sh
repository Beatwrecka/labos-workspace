#!/usr/bin/env bash
# LabOS Workspace — pinned toolchain activation.
#
# Source this before any build, test or dev command so the pinned Node, Yarn and
# Rust versions from the selected upstream commit are the ones in play:
#
#   . labos/scripts/labos-env.sh
#
# Values come from <repo>/.nvmrc, package.json#packageManager and
# rust-toolchain.toml at the pinned commit. Overriding them silently is how a
# build stops matching its own lockfile, so each check reports what it found.

LABOS_ENV_SOURCED=1

_labos_repo_root() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  (cd "$here/../.." && pwd)
}

LABOS_REPO_ROOT="${LABOS_REPO_ROOT:-$(_labos_repo_root)}"
export LABOS_REPO_ROOT

# --- Rust ------------------------------------------------------------------
if [ -d "$HOME/.cargo/bin" ]; then
  case ":$PATH:" in
    *":$HOME/.cargo/bin:"*) ;;
    *) PATH="$HOME/.cargo/bin:$PATH" ;;
  esac
fi
export PATH

# --- Node (nvm) ------------------------------------------------------------
LABOS_NODE_VERSION="$(tr -d '[:space:]' < "$LABOS_REPO_ROOT/.nvmrc" 2>/dev/null)"
if [ -n "$LABOS_NODE_VERSION" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" --no-use
  if [ -d "$NVM_DIR/versions/node/v$LABOS_NODE_VERSION" ]; then
    nvm use "$LABOS_NODE_VERSION" >/dev/null 2>&1
  fi
fi

# --- Yarn (corepack shim on PATH) ------------------------------------------
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi

labos_env_report() {
  local want_node want_rust want_yarn
  want_node="$LABOS_NODE_VERSION"
  want_rust="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$LABOS_REPO_ROOT/rust-toolchain.toml" 2>/dev/null)"
  want_yarn="$(sed -n 's/.*"packageManager": *"yarn@\([^"]*\)".*/\1/p' "$LABOS_REPO_ROOT/package.json" 2>/dev/null)"

  printf 'LabOS Workspace toolchain\n'
  printf '  repo        %s\n' "$LABOS_REPO_ROOT"
  printf '  node        %s (pinned %s)\n' "$(node -v 2>/dev/null || echo missing)" "$want_node"
  printf '  yarn        %s (pinned %s)\n' "$(yarn -v 2>/dev/null || echo missing)" "$want_yarn"
  printf '  rustc       %s (pinned %s)\n' "$(rustc --version 2>/dev/null || echo missing)" "$want_rust"
  printf '  cargo       %s\n' "$(cargo --version 2>/dev/null || echo missing)"
  printf '  xcode       %s\n' "$(xcode-select -p 2>/dev/null || echo missing)"
  printf '  arch        %s\n' "$(uname -m)"
}

# `labos-doctor` reports drift; it never mutates the toolchain.
labos_doctor() {
  local failures=0 want_node want_rust want_yarn got

  want_node="$LABOS_NODE_VERSION"
  want_rust="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$LABOS_REPO_ROOT/rust-toolchain.toml" 2>/dev/null)"
  want_yarn="$(sed -n 's/.*"packageManager": *"yarn@\([^"]*\)".*/\1/p' "$LABOS_REPO_ROOT/package.json" 2>/dev/null)"

  got="$(node -v 2>/dev/null | sed 's/^v//')"
  if [ "$got" != "$want_node" ]; then
    printf 'MISMATCH node: have %s want %s\n' "${got:-missing}" "$want_node"
    failures=$((failures + 1))
  fi

  got="$(rustc --version 2>/dev/null | awk '{print $2}')"
  if [ "$got" != "$want_rust" ]; then
    printf 'MISMATCH rustc: have %s want %s\n' "${got:-missing}" "$want_rust"
    failures=$((failures + 1))
  fi

  got="$(yarn -v 2>/dev/null)"
  if [ "$got" != "$want_yarn" ]; then
    printf 'MISMATCH yarn: have %s want %s\n' "${got:-missing}" "$want_yarn"
    failures=$((failures + 1))
  fi

  if ! xcode-select -p >/dev/null 2>&1; then
    printf 'MISMATCH xcode-select: command line tools not found\n'
    failures=$((failures + 1))
  fi

  if [ "$failures" -eq 0 ]; then
    printf 'toolchain matches the pinned manifests\n'
    return 0
  fi
  printf '%d toolchain mismatch(es)\n' "$failures"
  return 1
}
