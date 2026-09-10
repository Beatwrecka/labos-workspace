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
| `scripts/labos-env.sh` | Activates the pinned Node/Yarn/Rust toolchain; `labos_doctor` reports drift. |
| `scripts/check-pins.mjs` | Cross-checks `pins.json` against `.nvmrc`, `rust-toolchain.toml` and `package.json`. |
| `scripts/leak-scan.mjs` | Rejects private content on paths a commit would publish. |
| `.gitignore-public-fork` | Safety net for private material, real user content and machine-local paths. |

## Verifying the baseline

```sh
. labos/scripts/labos-env.sh   # pin the toolchain
labos_doctor                   # report any drift, never mutates the host
node --test labos/scripts/pins.test.mjs labos/scripts/leak-scan.test.mjs
node labos/scripts/leak-scan.mjs          # audit staged changes
```

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
