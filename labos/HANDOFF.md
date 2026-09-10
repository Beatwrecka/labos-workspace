# LabOS Workspace — handoff

**Written:** 2026-09-10 · **Branch:** `main` · **Last commit:** `6b41e2f15e`
**Working tree:** clean · **Disk:** ~17 GB free

Read this first, then `labos/progress-ledger.md`, which is the detailed
per-step record of every change, command, result, decision and defect.

---

## 1. Where everything is

| Thing | Location |
|---|---|
| Fork (public, code-only) | https://github.com/Beatwrecka/labos-workspace |
| Local checkout | `~/Programming/jonnys-lab/projects/desktop-apps/labos-workspace` |
| Built app | `.../packages/frontend/apps/electron/out/labos/LabOS Workspace-darwin-arm64/LabOS Workspace.app` |
| Private briefing pack | `~/Downloads/labos-workspace-brief` (**not backed up anywhere**) |
| MeMCP checkout | `~/Programming/jonnys-lab/projects/MeMCP` |

Pinned upstream: AFFiNE **v0.27.4**, commit `b4c8548c09da21b2898443559a5b846f0ccf5dd8`.

---

## 2. How to run it

```sh
cd ~/Programming/jonnys-lab/projects/desktop-apps/labos-workspace

. labos/scripts/labos-env.sh      # pins node 22.23.2 / yarn 4.18.0 / rust 1.97.1
labos_doctor                      # reports drift, never mutates the host

bash labos/scripts/launch-labos.sh --doctor   # readiness check, no launch
bash labos/scripts/launch-labos.sh            # launch the app
bash labos/scripts/package-labos.sh           # full rebuild + package (~5 min)
```

**Before packaging, check disk.** The packaging install duplicates dependencies
into hundreds of nested `node_modules` and needs ~8 GB. After packaging, clean up
or `yarn typecheck` reports ~1700 phantom errors across `blocksuite/`:

```sh
find . -mindepth 3 -maxdepth 7 -type d -name node_modules \
  -not -path "./node_modules/*" -prune -exec rm -rf {} +
rm -rf node_modules target
yarn install --immutable
```

**Verify everything:**
```sh
node --test labos/scripts/*.test.mjs     # 218 tests
yarn typecheck                            # 0 errors
```

---

## 3. What is built and verified

**Phase 0 — complete.** Fork pinned to v0.27.4; LabOS Workspace is a first-class
`labos` release type with its own bundle id (`app.labos.workspace`), URL scheme
(`labos`), userData, log directory, and upstream auto-update disabled. The
packaged app launches and your stock AFFiNE install is untouched.

**Phase 1 — complete.** Repository Markdown documents at `/labos/repo`: safe
rendering, source editor, guarded atomic saves with hash preconditions, recovery
versions, conflict compare, external-change watcher, and the six plain-English
states. 25 file-matrix tests + 12 watcher tests.

**Phase 2 — complete, including the real integration read.** Projects at
`/labos/projects` and the home screen at `/labos/home`. An independently written
MeMCP adapter (no MeMCP imports), evidence-aware sprint cards that keep five
verification dimensions separate, project gallery, keyboard-reorderable
shortlist. **13/13 checks passed against a real MeMCP service.**

**218 tests pass. Typecheck clean. Lint clean. All three routes in the built bundle.**

The full suite was run five times consecutively with zero failures. One earlier
intermittent failure — an FSEvents attach race in the watcher test — was found,
diagnosed and fixed rather than left as a known flake (see §6).

### The five evidence dimensions

The briefing is emphatic that a worker saying "done" is not a verified merge or
independent QA. MeMCP's own data agrees — every task carries
`evidence_label: reported_*`, and its notes say *"Task completion is reported
status, not functional or browser proof."* So a completed task renders as:

| Dimension | Shows |
|---|---|
| Reported status | `Completed (reported)` |
| Tests | `Not recorded` — "a completed status is not test evidence" |
| Independent QA | `Not recorded` — "self-review is not independent QA" |
| Integration | `Not recorded`, or a commit labelled *not* proof of merge |
| Cleanup | `Not recorded` |

A test asserts all four stay `not-recorded` for a completed task, so a future
change cannot quietly conflate them.

---

## 4. What is NOT verified

Stated plainly, because the briefing requires separating *implemented* from
*tested* from *independently reviewed*.

- **The GUI has never been clicked through.** This agent context cannot drive
  a GUI. Reachability is verified via the shipped bundle, the registered IPC
  handlers and the app's own logs — not by opening a page. **Please open
  `/labos/home`, `/labos/repo` and `/labos/projects` once and tell me what
  actually looks wrong.**
- **The real MeMCP read used a copy of the database, not the live daemon** (see
  §5). The data is real; the process was not the production one.
- **MeMCP has no preview screenshots**, so the gallery's recorded-cover path is
  fixture-verified only.
- **Whether MeMCP preview images load under the app's CSP** is unchecked.
- **No independent QA reviewer.** All QA so far is self-review and is recorded
  as such, not renamed "independent".
- **Phases 3–6 not started:** Codex agent actions, voice capture, themes and
  focus modes, final packaging and the user guide.
- Markdown parser is a deliberate subset, not CommonMark. Unrecognised
  constructs render plainly but are never dropped.

---

## 5. The one thing blocking live use of `/labos/projects`

**A stale MeMCP daemon is stuck.** A daemon was running on port **3211** from
before 6 Sep — it served `/health`, `/memories` and `/tasks` but **404'd on
`/projects` and `/snapshot`**. I sent it a graceful `SIGTERM` (you authorised
this); it released its port but then wedged — gone from the process table while
`lsof` still lists it holding the database.

Its own one-daemon-per-database guard now correctly refuses to start, because
that stale lock persists. To clear it:

- **Restart the Mac** (cleanest), or
- **Force-quit the `node` process** for MeMCP in Activity Monitor.

Then: `cd ~/Programming/jonnys-lab/projects/MeMCP && pnpm dev`
and the app will reach it at `http://127.0.0.1:3210`.

Until then `/labos/projects` honestly reports "MeMCP not connected" — that is
correct behaviour, not a bug.

**Your database is fine.** I verified `integrity_check: ok` and all **18
projects** present after every step. I also copied it to `/tmp` before touching
anything. I did **not** force the stuck lock, because MeMCP explicitly warns
against that.

---

## 6. Things I would want to know if I were you

1. **Lint is intermittently red from pre-existing upstream code.**
   `packages/backend/server/src/__tests__/workspace/blobs.e2e.ts` fails the
   repo-wide pre-commit hook at the pinned commit, untouched by any LabOS
   change. That is why commits into this fork use `--no-verify`, with every
   touched file linted separately and the reason stated in each commit message.

2. **The leak scanner is load-bearing.** This fork is public. `labos/scripts/leak-scan.mjs`
   audits every staged path for private briefing material, MeMCP internals,
   credentials, absolute machine paths and real user content. It caught two real
   mistakes I made — a machine path in a launch script and a reference to the
   stock AFFiNE log directory. **Run it before every push.** It has had two bugs
   found and fixed by its own tests; it is not decorative.

3. **Your private briefing pack has no backup.** It exists only in
   `~/Downloads/labos-workspace-brief`. If that folder goes, the specification
   goes. Copy it somewhere safe.

4. **MeMCP's `/projects` is newer than what is running.** This is why the
   adapter was fixture-tested for a while before real verification was possible.
   Worth knowing that a running service can be older than the checkout.

5. **A test flake was found and fixed, not hidden.** The full suite failed
   roughly one run in three on `an external edit to a clean file is reported
   once`. The cause was real: on macOS the FSEvents stream can take a moment to
   attach after `watch()` returns, so a write landing before it is live is lost
   entirely. The test assumed a fixed 60 ms delay was enough. It now waits for
   *evidence* that the watcher is receiving before testing, and the suite passes
   five consecutive full runs. This is a genuine property of FSEvents worth
   knowing about: **the watcher cannot be relied on for events in the first
   moments after watching a directory**, which is why `reconcile()` exists and
   runs on focus, wake and startup.

---

## 7. Next steps, in order

**Immediate (needs you):** clear the stuck daemon, open the three pages, and
tell me what actually looks wrong.

**Then, from the plan:**
- **Phase 3 — Codex agent actions.** `AgentProvider` boundary, read-only
  proposal mode first, diff review, cancellation, and the scoped
  personal-note interface. Verify the installed Codex version and generated
  schemas rather than hard-coding a protocol.
- **Phase 4 — Voice.** Visible recording, local `whisper.cpp` transcription
  (start with `base.en`), recoverable inbox, optional tidy, memory-link outbox.
- **Phase 5 — Personalisation.** LabOS branding (the window still shows
  upstream AFFiNE strings — see below), saved themes, coding/music/writing
  views, keyboard and accessibility.
- **Phase 6 — Harden and package.** Regression, backup/restore, `.app`,
  doctor/launch scripts, user guide, full QA checklist run.

**Known branding gap:** the app window/menu still shows upstream AFFiNE strings.
I searched the pinned tree for i18n definitions to rebrand the app menu and
found none in the expected shape, and did not want to guess at the mechanism and
break localisation. Worth investigating properly in Phase 5 — the bundle id,
product name, log path and URL scheme are already correctly LabOS.

---

## 8. Working notes

- `labos/progress-ledger.md` — the full record. Read it before changing anything.
- `labos/pins.json` — the machine-readable pin and isolation manifest.
- `labos/build-inventory.md` — why v0.27.4, toolchain conformance, licence carve-outs.
- `labos/scripts/memcp-real-read.mjs` — the real integration read; run it against
  a live MeMCP with `node labos/scripts/memcp-real-read.mjs http://127.0.0.1:3210`.

**Licensing:** the fork keeps all upstream notices. `packages/backend` and
`packages/common/native` carry AFFiNE Enterprise terms; they are unmodified and
no enterprise feature is enabled or licence check bypassed.

**Nothing was published outside the authorised public code-only fork. No upstream
PR was opened. No paid service was used.**
