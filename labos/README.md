# LabOS Workspace — implementation notes

This directory holds the sanitised, code-only LabOS additions to this fork of
[toeverything/AFFiNE](https://github.com/toeverything/AFFiNE). It is written for
someone reading the source, so it describes the implementation and its limits.

**This is a public repository.** Do not put private briefing material, real user
content, screenshots, credentials or MeMCP internals here. `labos/scripts/leak-scan.mjs`
audits staged changes for exactly those classes before a push.

| File | Purpose |
|---|---|
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
. labos/scripts/labos-env.sh   # pin the toolchain
labos_doctor                   # report any drift, never mutates the host
node --test labos/scripts/pins.test.mjs labos/scripts/leak-scan.test.mjs \
           labos/scripts/isolation.test.mjs labos/scripts/packaged-app.test.mjs
node labos/scripts/leak-scan.mjs          # audit staged changes
bash labos/scripts/launch-labos.sh --doctor
```

## Building and launching

```sh
bash labos/scripts/package-labos.sh       # build + package (several minutes)
bash labos/scripts/launch-labos.sh        # launch
bash labos/scripts/launch-labos.sh --doctor
```

`package-labos.sh` runs in three phases because the two halves of the build need
**different dependency layouts**, which is easy to get wrong and fails in
confusing ways:

1. The web renderer is built with Yarn's default hoisting. rspack resolves
   loaders such as `swc-loader` from the hoisted root.
2. The Electron layers are bundled.
3. electron-forge packages with `nmHoistingLimits=workspaces`, so each workspace
   keeps its own `node_modules` where forge can find the runtime dependencies
   that esbuild leaves external (`electron-updater`, `yjs`, …).

**After packaging**, restore the default layout before trusting a typecheck:

```sh
find . -mindepth 3 -maxdepth 6 -type d -name node_modules \
  -not -path "./node_modules/*" -exec rm -rf {} +
rm -rf node_modules && yarn install --immutable
```

The packaging install leaves ~600 nested `node_modules` directories behind. With
those duplicates present, `yarn typecheck` reports ~1750 errors across ~1090
files in `blocksuite/` — none of them real. See `progress-ledger.md`.

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
