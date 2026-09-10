# LabOS Workspace — Phase 0 build inventory

**Revision:** v0.27.4 · **Pinned commit:** `b4c8548c09da21b2898443559a5b846f0ccf5dd8`
**Fork:** https://github.com/Beatwrecka/labos-workspace (public, code-only)
**Recorded:** 2026-09-10 · **Host:** macOS 26.5.2, arm64

This is the sanitised, implementation-only derivative of the private briefing
pack. It contains no private integration details, paths, credentials or notes.

## 1. Upstream release selection

AFFiNE ships two release lines. The moving `canary` branch publishes dated
prereleases continuously (`2026.9.9-canary.909` was the newest at selection
time). The stable release line is authoritative for a pinned build.

| Field | Value |
|---|---|
| Release tag | `v0.27.4` |
| Release name | `0.27.4` |
| Published | 2026-08-18T16:51:39Z |
| Prerelease | no |
| Tag object | light tag → commit `b4c8548c09da21b2898443559a5b846f0ccf5dd8` |
| Commit date | 2026-08-17T12:01:30+08:00 |
| Integration branch in fork | `main` (created from the pinned commit; no history rewrite) |
| `upstream` remote | `https://github.com/toeverything/AFFiNE.git` |
| `origin` remote | `https://github.com/Beatwrecka/labos-workspace.git` |

`v0.27.4` is the newest non-prerelease release at selection time and matches the
AFFiNE desktop version already installed on this host (0.27.4), which reduces the
chance of a local-store incompatibility during later migration work.

## 2. Toolchain conformance

Every pinned tool was verified against the pinned commit's own manifests rather
than against the briefing document.

| Tool | Required by pinned commit | Source of truth | Observed |
|---|---|---|---|
| Node.js | `22.23.2` | `.nvmrc` | 22.23.2 (installed via nvm) |
| Yarn | `4.18.0` | `package.json#packageManager` | 4.18.0 (`.yarn/releases/yarn-4.18.0.cjs`) |
| Rust | `1.97.1` | `rust-toolchain.toml#toolchain.channel` | 1.97.1 (8bab26f4f 2026-07-14) |
| Electron | `^39.0.0` | `packages/frontend/apps/electron/package.json` | resolved by Yarn |
| Xcode CLT | required for native modules | `docs/BUILDING.md` | Xcode.app, Apple clang 21.0.0 |

`package.json#engines.node` is `>=22.12.0 <23.0.0`; `.nvmrc` is the stricter
value and was adopted.

**Toolchain gaps found and closed on this host**

- No `rustup` shims on `PATH`; only a bare `~/.rustup/toolchains/1.95.0` tree.
  Resolved by installing `rustup` and provisioning the pinned `1.97.1` toolchain.
- Node `22.22.2` was active, one patch behind `.nvmrc`. Resolved by installing
  `22.23.2` via nvm.
- `cargo`/`rustc`/`go` reported as "not found" by a non-login shell probe simply
  because `~/.cargo/bin` is absent from the default `PATH`. Builds must export
  `PATH="$HOME/.cargo/bin:$PATH"` and select nvm Node `22.23.2` first; see
  `labos/scripts/labos-env.sh`.

## 3. Build shape (from the pinned commit, not the aged docs)

`docs/building-desktop-client-app.md` carries an upstream warning that it may be
out of date. The pinned commit's manifests and CI were treated as authoritative.

Build order, per the pinned `docs/building-desktop-client-app.md` and
`.github/actions/build-rust/action.yml`:

1. `packages/frontend/native` — Rust NAPI bindings (`@affine/native`).
2. `packages/frontend/core` — the web application.
3. `packages/frontend/apps/electron` — Electron main/helper plus the
   `electron-renderer` entry, assembled by electron-forge.

Third-party mirrors (`external/tools`, Yarn `approvedGitRepositories`) are
bypassed for mirror-only failures with `SKIP_MIRROR_CHECK=1` and proxied via
`https://github.com/...` before `https://npmjs.com/...`, which the pinned
`tools/cli` already supports.

**Backend scope.** `packages/backend/server` and `packages/backend/native` are
not built. The desktop client's local features do not require the AFFiNE server,
Postgres, Redis or Docker. If a baseline launch is later found to demand a
hosted login for local notes, that is treated as a defect to investigate rather
than a reason to purchase a subscription.

## 4. Licence inventory

`LICENSE` at the pinned commit states:

- Content outside the carve-out directories is **MIT** (`LICENSE-MIT`).
- Content under `packages/backend` and `packages/common/native` is licensed under
  `packages/backend/server/LICENSE` — AFFiNE Enterprise Edition terms, with a
  Community Edition / client-side MPL-2.0 carve-out for parts served client-side.

**Position taken by LabOS.** The carve-out directories are not modified and no
enterprise-only feature is enabled or unlocked by editing licence checks. LabOS
is exercised for personal, local use. Upstream licence files are retained
unmodified and legal attribution remains in the application's About surface.
This is a component-scoping record, not a legal opinion.

## 5. Isolation decisions (applied before first launch)

Recorded in `labos/pins.json#isolation` and implemented by the LabOS isolation
patch. Stock AFFiNE and LabOS Workspace must coexist:

| Concern | Stock AFFiNE | LabOS Workspace |
|---|---|---|
| Product name | AFFiNE | LabOS Workspace |
| Bundle identifier | `pro.affine.app` | `app.labos.workspace` |
| URL scheme | `affine` | `labos` |
| userData / cache / logs | `AFFiNE` | `LabOS Workspace` |
| Update channel | upstream | disabled pending a deliberate LabOS channel |

The userData/cache/log directory names are resolved by Electron under the
platform's standard application-support location. This document deliberately
does not spell out the absolute location: an absolute machine path is a private
configuration detail, and the leak scanner rejects one appearing in source.

The stock AFFiNE store is never opened as the LabOS live database. LabOS never
writes to the stock AFFiNE application-support directory.

## 6. Known limitations carried into Phase 1

- Native build and desktop launch evidence is recorded in
  `labos/progress-ledger.md`, not asserted here.
- No signing, notarisation or public distribution is in scope.
- Gatekeeper and SIP are never disabled and the installed AFFiNE app is never
  modified.
