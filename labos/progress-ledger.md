# LabOS Workspace — progress ledger

One entry per completed step. Each records the phase, the changed paths, the
commands and their real results, any blocker, the decisions taken, the next step
and the exact tested commit. Public evidence only: no private paths, notes,
screenshots or credentials.

---

## 2026-09-10 — Phase 0, step 1: pin the upstream baseline

**Status:** complete

**Changed paths**

- `labos/pins.json`
- `labos/build-inventory.md`
- `labos/scripts/labos-env.sh`
- `labos/scripts/check-pins.mjs`
- `labos/scripts/pins.test.mjs`

**Commands and results**

- `gh release view v0.27.4 --repo toeverything/AFFiNE` → `isPrerelease: false`,
  published 2026-08-18. Selected over the moving `canary` line.
- `git checkout -B main b4c8548c09da21b2898443559a5b846f0ccf5dd8`
- `node --test labos/scripts/pins.test.mjs` → 5/5 pass.

**Decisions**

- Pinned `v0.27.4`, the newest non-prerelease release, rather than tracking
  `canary`. It also matches the AFFiNE desktop version already installed on this
  machine, which lowers migration risk later.
- Node `22.23.2` (`.nvmrc`) over the `>=22.12.0 <23.0.0` engine range, because
  `.nvmrc` is the stricter, more specific pin.
- Runtimes were installed rather than the repo being built with mismatched ones.

**Host gaps closed**

- No `rustup` shims were on `PATH`; a bare `~/.rustup/toolchains/1.95.0` tree
  existed. Installed `rustup` and provisioned the pinned `1.97.1`.
- Node `22.22.2` was active, one patch behind `.nvmrc`. Installed `22.23.2`.

**Next step:** create the fork and isolated checkout.

---

## 2026-09-10 — Phase 0, step 2: fork and isolated checkout

**Status:** complete

**Changed paths**

- `labos/.gitignore-public-fork`, `labos/README.md`
- `labos/scripts/leak-scan.mjs`, `labos/scripts/leak-scan.test.mjs`
- commit `c5cf735859311c9e9f0a60cbc2fe9e56d3ec3523`, pushed to `origin/main`

**Commands and results**

- `gh api -X POST repos/toeverything/AFFiNE/forks -f name=labos-workspace` →
  created `Beatwrecka/labos-workspace`, `fork: true`, `visibility: public`.
- Clone placed at the briefing's default path, `upstream` added pointing at
  `toeverything/AFFiNE`, `main` created from the pinned commit.
- `gh api -X PATCH repos/Beatwrecka/labos-workspace -f default_branch=main`
- `node --test labos/scripts/leak-scan.test.mjs labos/scripts/pins.test.mjs` →
  11/11 pass.
- `node labos/scripts/leak-scan.mjs` → clean over the 9 LabOS-authored paths.

**Decisions**

- The fork was created with `default_branch=canary` by GitHub; changed to `main`
  to match the brief's integration-branch requirement.
- No history rewrite and no force-push anywhere: `main` is a new branch pointing
  at the pinned upstream commit, with the full 11,460-commit history intact.

**Blocker found and fixed — the leak scanner went silent**

The first scanner classified a candidate path as "inherited from upstream" purely
from commit history. A brand-new file has no history, so it was skipped: the
scanner went quiet on precisely the content it exists to catch, and it passed a
real `START_HERE.md` probe. Two further defects surfaced on the way to the fix:

- `.env.example` was rejected as a credential file, though upstream tracks such
  templates on purpose — a false positive that erodes trust in the tool.
- Per-path `git log` took minutes over the 10k-file tree, so the tree scan timed
  out. Replaced with one batched `git log` and one batched `git ls-files`.

The classifier now fails towards inspection: a path is inherited only when it is
still tracked _and_ its newest commit is reachable from the pin. Everything else
is audited. `leak-scan.test.mjs` locks the behaviour in.

**Next step:** apply app isolation and build the baseline desktop app.

---

## 2026-09-10 — Phase 0, step 3: app isolation

**Status:** complete

**Changed paths**

- `packages/frontend/apps/electron/scripts/make-env.ts`
- `packages/frontend/apps/electron/forge.config.mjs`
- `packages/frontend/apps/electron/src/main/config.ts`
- `packages/frontend/apps/electron/src/main/index.ts`
- `packages/frontend/apps/electron/src/main/deep-link.ts`
- `packages/frontend/apps/electron/src/main/updater/electron-updater.ts`
- `packages/frontend/apps/electron/src/main/protocol.ts`
- `packages/frontend/apps/electron/src/main/security/redirect-proxy.ts`
- `packages/frontend/apps/electron/src/preload/electron-api.ts`
- `packages/frontend/core/src/utils/channel.ts`
- `packages/frontend/core/src/modules/cloud/constant.ts`
- `packages/frontend/admin/src/modules/about/about.tsx`
- `tools/utils/src/build-config.ts`, `tools/@types/build-config/__all.d.ts`
- `tools/cli/src/rspack/index.ts`
- `packages/common/nbstore/src/telemetry/types.ts`
- `labos/scripts/isolation.test.mjs`, `labos/scripts/packaged-app.test.mjs`
- `labos/scripts/package-contents.mjs`, `labos/scripts/package-labos.sh`

**Commands and results**

- `yarn typecheck` → clean across the monorepo.
- `node --test labos/scripts/isolation.test.mjs` → 11/11 pass.
- `node --test labos/scripts/packaged-app.test.mjs` → 5/5 pass.
- `yarn vitest run packages/frontend/apps/electron/test/` → 87/87 pass.
- `yarn affine @affine/native build` → native module built in 2m18s.
- `bash labos/scripts/package-labos.sh` → runnable `.app` produced and launched.

**Decisions**

- Isolation is modelled as a new `labos` release type inside the existing
  upstream `buildType` mechanism rather than a parallel code path. One flag,
  `isLabosBuild`, is the single place that answers "is this the LabOS build?".
- Every stock AFFiNE identity is preserved, so building plain
  `stable`/`canary` from this fork still behaves exactly as upstream.
- Updates are disabled for LabOS through the existing `disabled` gate rather
  than by deleting the update provider, keeping the path intact for a future
  deliberate LabOS channel.
- LabOS inherits the **stable** build preset, not canary's aggressive feature
  flags: the point is to keep AFFiNE's editor behaviour.
- The app is never signed as TOEVERYTHING. `LABOS_SIGN_IDENTITY` selects the
  identity and the default for `labos` is ad-hoc.

**Defects found and fixed**

1. **`BUILD_TYPE labos is not supported`** — a release type must be declared in
   six registries (`tools/utils`, `tools/@types`, `tools/cli`, `main/config`,
   `make-env`, `preload`). Missing one fails the build; the typechecker found the
   rest as `Record<Channel, …>` violations in `channel.ts`, `cloud/constant.ts`
   and `admin/about.tsx`.
2. **`SIGKILL (Code Signature Invalid)` at launch** — packaging signed the bundle
   as TOEVERYTHING, an identity not present here. With the embedded
   asar-integrity fuse enabled, the invalid signature makes macOS kill the app.
   Fixed by making the identity configurable and signing locally.
3. **LabOS wrote into the stock AFFiNE log directory** — `electron-log` resolves
   its path from `app.getName()` at import time, so redirecting only `userData`
   left LabOS logging into `~/Library/Logs/AFFiNE`. Fixed by calling
   `app.setName()` before any path is derived, and redirecting `logs` too.
4. **`Cannot find module 'electron-updater'`** — esbuild marks that module
   external, so it is `require`d at runtime. With `nmHoistingLimits` unset,
   electron-forge found no workspace `node_modules` and bundled nothing.
   Reproduced upstream CI's two-phase install (default hoisting to build the web
   renderer, `nmHoistingLimits workspaces` to package) and confirmed the module
   ships inside `app.asar`.
5. **Window opened but loaded nothing** — `assets://./shell.html` failed with
   `ERR_UNEXPECTED` because `resources/web-static` was empty. `generate-assets`
   MOVES the renderer's `dist` (`fs.move`), so an earlier `SKIP_WEB_BUILD=1` run
   consumed the output. The packaging script now builds and stages in one pass.
6. **URL scheme registered as `labos workspace`** — upstream derives the scheme
   as `productName.toLowerCase()`, which is invalid once the name contains a
   space. The scheme is now stated explicitly as `labos`.

**Isolation confirmed on the packaged app**

| Concern                | Stock AFFiNE                        | LabOS Workspace        |
| ---------------------- | ----------------------------------- | ---------------------- |
| Release type           | `stable`/`canary`/`beta`/`internal` | `labos`                |
| Product name           | `AFFiNE`                            | `LabOS Workspace`      |
| Bundle identifier      | `pro.affine.app`                    | `app.labos.workspace`  |
| Deep-link scheme       | `affine`                            | `labos`                |
| userData / sessionData | `AFFiNE`                            | `LabOS Workspace`      |
| Log directory          | `Logs/AFFiNE`                       | `Logs/LabOS Workspace` |
| Upstream auto-update   | enabled                             | disabled               |

LabOS keeps its own `global-state.json`, `window-state.json`, storages and
single-instance lock. The stock AFFiNE bundle, application-support directory and
log file were confirmed unchanged across every LabOS launch.

## 2026-09-10 — Phase 1, step A: repository file service

**Status:** complete

**Changed paths**

- `packages/frontend/apps/electron/src/main/labos/repo-file-service.ts`
- `labos/scripts/repo-file-service.test.mjs`

**Commands and results**

- `node --test labos/scripts/repo-file-service.test.mjs` → 25/25 pass.

**What it does**

The service is main-process only and treats a repository `.md` file as owned by
its checkout, not by LabOS. Reads return exact bytes plus a sha256; writes take
an `expectedHash` precondition and go through a same-directory temp file, `fsync`
and rename; every accepted write stores a recovery version first.

**Decisions**

- Recovery versions are written to LabOS's own state directory, never beside the
  user's document. Dropping stray `.bak` files into a repository would appear as
  untracked changes in the user's Git status.
- Symlinked documents are refused rather than followed, so a document's identity
  is never ambiguous and a link cannot reach content outside the trusted root.
- Exclusions are hard-coded by class (VCS, dependency, build, cache, secret
  material, databases) rather than relying on `.gitignore` alone, because
  `.gitignore` is a convenience file, not a security boundary.
- Limits (2 MiB per document, 5000 documents per root) are configurable so tests
  can exercise the boundaries cheaply.

**Defects found and fixed while testing**

1. **Deleted files reported as `io-error`** rather than `file-missing`. The
   resolver threw before the reachable missing-file branch, so the UI would have
   shown a vague failure where it should say "File moved/missing". The write path
   now inspects the error code.
2. A test created a service without registering its root, which the suite caught
   immediately — recorded because it shows the tests fail loudly rather than
   passing vacuously.

**Stated limitation, carried forward honestly**

An atomic rename is not a compare-and-swap against an unrelated writer. The hash
precondition narrows the window but cannot close it: another process can write
between the check and the rename. Filesystem locking is advisory. The contested-
write test asserts the practical guarantee (the external version is never
clobbered, the stale writer fails safely), not perfect exclusivity, and the
service documents this rather than claiming a guarantee it cannot keep.

**Next step:** the Repo document UI.

---

## 2026-09-10 — Phase 1, step B: repository watcher

**Status:** complete

**Changed paths**

- `packages/frontend/apps/electron/src/main/labos/repo-watcher.ts`
- `labos/scripts/repo-watcher.test.mjs`

**Commands and results**

- `node --test labos/scripts/repo-watcher.test.mjs` → 12/12 pass, stable across
  repeated runs.

**Design decisions, each from a specific failure mode**

- **Watch the directory, not the file.** Agents and editors write a temp file and
  rename it over the target, which orphans a file-level watch. A directory watch
  survives atomic replacement and also sees rename and delete. Asserted by the
  "agent write via temp file plus rename" test.
- **Suppress self-writes by content hash, not by timing.** The service reports the
  hash it just wrote and the watcher ignores an event whose current hash matches.
  A time-based guard is a race; this is not. Asserted by both the "self save is
  not reported" and the "a genuine external change after a self-write is still
  reported" tests, so suppression cannot swallow a real change.
- **Debounce and coalesce.** A 10-write burst must produce a bounded number of
  notifications, or the UI flickers and a save loop becomes possible.
- **Treat events as advisory.** Events can be dropped or missed across sleep/wake,
  so `reconcile()` is a required peer, tested by injecting a change the event
  stream never sees.

**Defects found and fixed**

1. `[...this.#roots.keys()]` in `close()` — the linter flagged an unnecessary
   spread, but the underlying requirement is real: `unwatchRoot` mutates the map
   being iterated, so the ids must be snapshotted first. Kept the snapshot, made
   the intent explicit.
2. An unawaited promise in the debounce timer would have surfaced as an unhandled
   rejection on a transient filesystem error. Now caught explicitly, with the
   change left to reconciliation.

**Next step:** the Repo document UI.

---

## 2026-09-10 — Phase 1, steps C–E: IPC, rendering safety, document view

**Status:** complete

**Changed paths**

- `packages/frontend/apps/electron/src/shared/labos-repo.ts` (contract)
- `packages/frontend/apps/electron/src/main/labos/handlers.ts`, `events.ts`,
  `root-store.ts`
- `packages/frontend/apps/electron/src/main/{handlers,events,index}.ts`
- `packages/frontend/core/src/modules/labos-repo/`: `markdown.ts`,
  `editor-state.ts`, `styles.css.ts`, `rendered-document.tsx`,
  `document-view.tsx`
- `labos/scripts/`: `root-store.test.mjs`, `markdown-security.test.mjs`,
  `editor-state.test.mjs`

**Commands and results**

- `node --test labos/scripts/*.test.mjs` → **120/120 pass**
- `yarn typecheck` → clean
- `oxlint` on the new modules → 0 errors

**What it does**

The contract is dependency-free because it is imported by main, preload and
renderer alike. The renderer never receives an absolute path: roots are opaque
ids and documents are repository-relative paths.

Markdown renders into a structured block list, never an HTML string, so "no code
execution" is structural. Rendering safety is tested from the attacker's side:
script tags, `img onerror`, `javascript:`/`data:`/`file:` links, remote tracking
pixels, iframe/object/embed/form/base and MDX are each asserted to become inert
data with the reason recorded.

The view exposes the six agreed states and blocks Save exactly when saving would
be unsafe (conflict unresolved, or the on-disk hash not yet confirmed).

**Defects found and fixed**

1. **Inline HTML mid-sentence was not escaped.** Raw-HTML handling ran only when
   a line *started* with a tag, so `<img onerror>` hidden inside ordinary prose
   passed through untouched — the likelier attack, since it does not look like
   markup. Inline tags are now neutralised anywhere in a paragraph.
2. **The table block shape was ambiguous**, which let a duplicated `index += 2`
   slip through: the parser read the header from the delimiter row and silently
   dropped a body row, producing a table that looked plausible but was wrong.
   The shape is now unambiguous and a test asserts header-from-first-row plus
   every body row in order.
3. **`pickAndRegisterRoot` never passed its `absolutePath`**, so a folder chosen
   in the picker would have failed to register. Caught by the typechecker.
4. **Wrong theme token** (`fontFamilyCode` for `fontCodeFamily`).
5. **Three floating promises** in the view, now handled explicitly rather than
   left to surface as unhandled rejections.

**Honest limits**

- The renderer is not yet wired to a route, so it is not yet reachable by
  clicking in the app. The services, contract and components are complete and
  tested; the remaining work is route registration and a sidebar entry.
- Markdown coverage is deliberately a small hand-written subset, not CommonMark.
  Anything unrecognised is preserved as text rather than dropped, so no content
  is lost, but some constructs will look plain.

**Next step:** wire the view to a route so it is reachable in the running app.

---

## Environment hazard: packaging leaves a nested-node_modules typecheck

**Found:** 2026-09-10, while re-verifying the Phase 0 isolation commit.

`labos/scripts/package-labos.sh` sets `nmHoistingLimits workspaces` for the
packaging phase, because electron-forge needs per-workspace `node_modules` to
bundle the runtime dependencies esbuild leaves external. That install leaves
**602 nested `node_modules` directories** behind. With duplicates of `rxjs`,
`zod` and similar on disk, `yarn typecheck` reports ~1753 errors across **1091
files** entirely inside `blocksuite/` — mostly `TS2883` ("inferred type cannot
be named without a reference to … node_modules/rxjs"), plus `TS2339`, `TS7006`
and `TS2305`.

**It is not a real regression.** Two checks establish that:

- None of the 1091 files reporting errors appears in the commit's changed-file
  list (`comm` of the two sorted lists is empty).
- Removing the 602 nested `node_modules` and reinstalling cleanly returns
  `yarn typecheck` to **0 errors**.

**Action:** after packaging, restore the default layout before trusting a
typecheck:

```sh
find . -mindepth 3 -maxdepth 6 -type d -name node_modules \
  -not -path "./node_modules/*" -exec rm -rf {} +
rm -rf node_modules
yarn install --immutable
```

This is recorded because the failure is loud and looks like a broken change. A
future session that sees 1753 errors in `blocksuite/` after packaging should
clean the install rather than start debugging upstream source.
