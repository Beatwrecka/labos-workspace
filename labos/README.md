# LabOS Workspace — implementation notes

This directory holds the sanitised, code-only LabOS additions to this fork of
[toeverything/AFFiNE](https://github.com/toeverything/AFFiNE). It is written for
someone reading the source, so it describes the implementation and its limits.

**Read `HANDOFF.md` first.** It is the single current status document: what is
built, what is broken, and the next tasks in order. `progress-ledger.md` is the
detailed per-step record behind it.

**This is a public repository.** Do not put private briefing material, real user
content, screenshots, credentials or MeMCP internals here. `labos/scripts/leak-scan.mjs`
audits staged changes for exactly those classes before a push.

| File | Purpose |
|---|---|
| `HANDOFF.md` | **Start here.** Current status, open defects, next tasks in order. |
| `pins.json` | Machine-readable upstream release/commit pin, toolchain pins and app-isolation identity. |
| `build-inventory.md` | Why this release was chosen, verified toolchain conformance, build order, licence carve-outs. |
| `progress-ledger.md` | Per-step record of changes, commands, real results, decisions and defects found. |
| `scripts/labos-env.sh` | Activates the pinned Node/Yarn/Rust toolchain; `labos_doctor` reports drift. |
| `scripts/package-labos.sh` | Builds the web renderer and packages a runnable local `.app`. |
| `scripts/launch-labos.sh` | Launches the built app; `--doctor` reports readiness without launching. |
| `scripts/check-pins.mjs` | Cross-checks `pins.json` against `.nvmrc`, `rust-toolchain.toml` and `package.json`. |
| `scripts/leak-scan.mjs` | Rejects private content on paths a commit would publish. |
| `scripts/package-contents.mjs` | Inspects a packaged `.app` for its runtime dependencies. |
| `.gitignore-public-fork` | Safety net for private material, real user content and machine-local paths. |

## Verifying the baseline

```sh
. labos/scripts/labos-env.sh             # pin the toolchain
labos_doctor                             # report any drift, never mutates the host
node --test labos/scripts/*.test.mjs     # the whole suite
yarn typecheck                           # only meaningful after the cleanup below
node labos/scripts/leak-scan.mjs         # audit staged changes
bash labos/scripts/launch-labos.sh --doctor
```

## Building, packaging and launching

```sh
bash labos/scripts/package-labos.sh      # build + package (several minutes)
bash labos/scripts/launch-labos.sh --doctor
bash labos/scripts/launch-labos.sh
```

**The packaged app is unsigned, and macOS kills it in that state.** There is no
process, no crash dialog and not one line in the log, so it looks as though
nothing happened. `codesign --verify --deep --strict` reports `code has no
resources but signature indicates they must be present`. Ad-hoc signing after
packaging makes it launchable:

```sh
APP="packages/frontend/apps/electron/out/labos/LabOS Workspace-darwin-arm64/LabOS Workspace.app"
codesign --force --deep --sign - "$APP" && open -a "$APP"
```

`launch-labos.sh` reports this in its doctor output and then launches anyway —
the doctor line is a warning, not a block. See `HANDOFF.md` for the open task.

`package-labos.sh` runs in three phases because the two halves of the build need
**different dependency layouts**, which is easy to get wrong and fails in
confusing ways:

1. The web renderer is built with Yarn's default hoisting. rspack resolves
   loaders such as `swc-loader` from the hoisted root.
2. The Electron layers are bundled.
3. electron-forge packages with `nmHoistingLimits=workspaces`, so each workspace
   keeps its own `node_modules` where forge can find the runtime dependencies
   that esbuild leaves external (`electron-updater`, `yjs`, …).

**After packaging, restore the default layout before trusting a typecheck.** Three
parts, all needed: restore the project config (phase 3 leaves
`nmHoistingLimits: workspaces` in it, and an install without this *recreates* every
nested `node_modules` — measured at 834 before the cleanup and 834 after it, versus
2 with the config restored); delete the nested `node_modules`; and delete the
`tsconfig.tsbuildinfo` files, which record those nested paths as inputs and
otherwise leave tsc rebuilding against inputs that no longer exist. Packaging also
leaves the tracked `.yarnrc.yml` modified — restore it with
`git restore --source=HEAD --staged --worktree .yarnrc.yml`, **not**
`git checkout -- .yarnrc.yml`, which restores from the index and silently does
nothing if the change was already staged.

```sh
git restore --source=HEAD --staged --worktree .yarnrc.yml
find . -mindepth 3 -maxdepth 7 -type d -name node_modules \
  -not -path "./node_modules/*" -exec rm -rf {} +
find . -name tsconfig.tsbuildinfo -not -path "./node_modules/*" \
  -not -path "*/node_modules/*" -delete
rm -rf node_modules && yarn install --immutable
```

With those nested duplicates on disk, `yarn typecheck` reports ~1750 errors
across ~1090 files in `blocksuite/` — none of them real. See
`progress-ledger.md`.

## Why the leak scanner only audits some paths

This is a public fork: everything pushed here is world-readable, including the
~10k files inherited from upstream. Flagging an upstream-authored `.npmrc` or an
onboarding `.mp4` as a "leak" would be false, and a scanner that cries wolf is a
scanner people learn to ignore.

So `classifyPaths` splits candidates by authorship: a path whose newest commit is
reachable from the pinned upstream commit was already public before this fork
existed and is skipped; everything else is audited. A brand-new path has no
history, so it is treated as authored and audited — the classifier fails towards
inspection, never towards silence.
