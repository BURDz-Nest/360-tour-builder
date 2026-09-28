# AGENTS.md — Code Puppy working guide for the ATLAS Explore pipeline

Read this first when making changes anywhere under `ATLAS-Explore/` — the
ATLAS Explore codebase (a 360° tour authoring tool + player), organized as a
three-stage pipeline instead of a single live folder.

> **Where this came from.** This pipeline was set up on 2026-09-08. Unlike the
> `COACH/` pipeline (which was seeded from a separately-named, still-live
> legacy folder), `ATLAS-Explore/` **was already the live deployment itself**.
> Reorganizing in place means the old flat live URL
> (`.../WebAppTools/ATLAS-Explore/builder/index.html`) no longer resolves —
> the app now lives at `.../ATLAS-Explore/Prod/builder/index.html` instead.
> That URL change was accepted deliberately as part of this reorg; re-share
> the new link with anyone who had the old one bookmarked.

> **One AGENTS.md, not four.** This file lives ONLY at `ATLAS-Explore/AGENTS.md`
> because the *working process* is identical no matter which stage you're in.
> Everything else — `ARCHITECTURE.md`, `DEPLOY-INSTRUCTIONS.md`, `README.md` —
> lives **inside each stage folder** (`Dev/`, `Staged/`, `Prod/`) because those
> describe that stage's *actual current code*, which can legitimately differ
> between stages while a feature is mid-flight. Promotion (see below) must
> never copy an `AGENTS.md` into a stage folder — if one ever shows up there,
> delete it; this file is the only source of truth for process.

---

## The pipeline: Dev → Staged → Prod

| Stage | Purpose | Who edits it | Deploy status |
|---|---|---|---|
| `ATLAS-Explore/Dev/` | Fork sandbox for new features / architecture changes. Break things freely. | You + Code Puppy, directly | Not live by default. Push to git only when you want a real URL for device/team testing. |
| `ATLAS-Explore/Staged/` | Validated Dev work, staged for real-user testing without risking Prod | **Promoted from Dev only** — never edited directly | Semi-live: pushed to git so real testers can hit its URL |
| `ATLAS-Explore/Prod/` | Current source of truth for the app. | **Promoted from Staged only** — never edited directly | Fully live — this is the URL teammates should be using now |

**Promotion is one-directional and copy-based, never a merge:**
`Dev → Staged → Prod`. If a bug is found in Staged or Prod, fix it in Dev and
re-promote — don't patch downstream stages directly, or Dev silently drifts out
of sync with what's actually deployed.

**Git push is a separate action from promotion.** Promotion (copying files
between stage folders) happens locally, in whichever session/terminal is
folder-scoped. Pushing to git (from the WebGLHostRepo root — see below) is what
actually makes a stage's current contents reachable at a URL. You can push Dev
early just to eyeball something on a real device; that doesn't count as
"promoting" it.

---

## What this is (30-second orientation)
- **`builder/`** = the authoring tool. Desktop **Chromium** (Edge/Chrome). An
  author picks a folder on their disk; the app autosaves `tour.json` + media
  there via the File System Access API.
- **`player-template/`** = the learner/viewer runtime — the 360° tour player
  (image spheres, hotspots, guided flow). Runs anywhere modern.
- **`templates/`** = starter interaction-block HTML snippets authors can drop
  into a scene (image+caption, checklist, callout, policy link, video embed,
  spec table).
- **`scripts/launch.sh`** = one-command local dev server, per stage (own
  default port so you can run more than one stage side-by-side).
- Zero build, no framework, no CDN. Raw ES modules + plain CSS. **Relative
  paths only** so the folder is portable under any base URL.

This structure is identical in every stage folder (`Dev/`, `Staged/`,
`Prod/`) — it's the same app, just at different points in its promotion
journey.

---

## Two working contexts (important)

We split work into two places so nothing outside the active stage folder gets
touched by accident:

1. **Edit + local test = a session/terminal scoped to the stage folder you're
   actively working in** (almost always `ATLAS-Explore/Dev/`). All editing,
   self-testing, local serving, and `?v=` bumps happen here. **Do not run git
   from here.**
2. **Git = the WebGLHostRepo *root*.** The ONLY place to run git: `pull`
   upstream, then `commit` + `push`. Pushing to `main` triggers KITT to build +
   auto-deploy — including whichever `ATLAS-Explore/<stage>` folders you've
   changed.

Handoff: Code Puppy (folder context) prepares + verifies the change and bumps
cache-bust tags → Franky switches to the repo root to pull, commit, push.

---

## The golden workflow: edit → self-test → LOCAL test → promote

1. **Edit** — changes **inside `ATLAS-Explore/Dev/` only** (see Guardrails).
   Never edit `Staged/` or `Prod/` directly.
2. **Self-test what you can (REQUIRED before handing off):**
   - `node --check` every JS file you touched (catch syntax errors).
   - Start a local server (`./scripts/launch.sh` from `Dev/`, or
     `python3 -m http.server` from `Dev/`), **curl the changed assets and
     confirm HTTP 200** — including any dependency, e.g. `builder/index.html`
     and `player-template/js/psv-adapter.js`.
   - **grep the served file** to confirm your change is actually present (not a
     stale cache / wrong file).
   - Confirm no file you edited exceeds **600 lines**.
   - If it's a schema/model change, sanity-check `tour-model.js`'s validation
     still parses a minimal tour (a tiny node one-liner is fine). If the schema
     changed, update `Dev/ARCHITECTURE.md` in the same pass — it should always
     describe Dev's *current* reality.
3. **Hand off for local testing.** Only after step 2 passes, tell Franky:
   *"Verified what I can — ready for you to test at
   `http://localhost:5173/builder/index.html` in Edge/Chrome."* A human
   confirms the UX in a real browser before it goes anywhere near Staged.
4. **Prepare to promote (after Franky approves), still in the `Dev/` context.**
   - **Bump the `?v=` cache-bust tags** for everything you changed (see
     checklist below and `Dev/ARCHITECTURE.md`).
5. **Promote `Dev/` → `Staged/`** using the Promotion Checklist below, then ship
   from the **repo root**: `git pull --rebase` → `add` the `ATLAS-Explore/Staged/`
   diff → `commit` → `push`. Verify live at Staged's URL, then let real users
   bang on it.
6. **Promote `Staged/` → `Prod/`** the same way, once Staged testing is
   satisfied. `Prod/` is the live URL teammates should be using.

---

## Promotion checklist (Dev → Staged, and Staged → Prod)

Promotion is a full-folder copy, never a partial patch — this keeps every stage
internally consistent (no half-updated code from two different points in time).

1. From a **repo-root-adjacent shell** (not inside either stage folder), copy
   the entire source stage into the destination:
   ```
   cp -R ATLAS-Explore/Dev/. ATLAS-Explore/Staged/
   ```
   (or `ATLAS-Explore/Staged/.` → `ATLAS-Explore/Prod/` for the second hop).
   Always `cp -R`, never `mv` — the source stage must survive untouched so you
   can keep iterating in it.
2. **Immediately verify with a diff**, don't just trust the copy:
   ```
   diff -rq ATLAS-Explore/Dev ATLAS-Explore/Staged
   ```
   Exit code `0` = clean copy modulo the expected per-stage differences
   (`DEPLOY-INSTRUCTIONS.md`, `README.md`, `scripts/launch.sh` intentionally
   carry a different stage name/URL/port — that's fine). Anything else means
   investigate before moving on.
3. **Do not copy `AGENTS.md` into the destination.** If `cp -R` pulls one in
   because a stage folder somehow acquired one, delete it — there's exactly one
   copy of this file, at `ATLAS-Explore/AGENTS.md`.
4. **Re-apply the per-stage swaps** the diff just flagged: stage name + live
   URL in `DEPLOY-INSTRUCTIONS.md`, stage name + port in `README.md` and
   `scripts/launch.sh` (see the existing destination files for the exact
   strings to keep — promotion should only touch app code, not these three).
5. Only after the diff is clean (aside from the expected per-stage lines):
   commit + push from the repo root, and verify live via the build breadcrumb
   pattern in `DEPLOY-INSTRUCTIONS.md`.

---

## Cache-bust checklist (do this at promotion time, not during local dev)
- Edited `builder/*.js`? Bump `builder.js?v=NN` in `index.html`, and bump the
  `?v=NN` on any sibling import you changed (ES-module import URLs are the
  cache key — parent `?v=` does NOT cascade).
- Edited a module that another module imports (e.g. `icon-picker.js` imported by
  `marker-row.js`)? Bump the `?v=NN` in the **importing** file too.
- Edited any CSS? Bump its `?v=NN` in the `<link>` (`index.html` and/or
  `player.html`).
- Edited `player-template/js/*`? Bump `player.js?v=NN` in `player.html` and the
  relevant import `?v=`.
- You do **not** need to bump versions while iterating locally in `Dev/` —
  only when promoting/shipping (so deployed teammates don't get stale cache).

---

## Guardrails
- **Stay inside the stage folder you're actively working in** (usually
  `ATLAS-Explore/Dev/`). Never reach into a sibling stage except via the
  explicit, diff-verified Promotion Checklist above.
- **Never edit `ATLAS-Explore/Staged/` or `ATLAS-Explore/Prod/` directly.**
  They only change via promotion from the stage below them.
- **Never duplicate `AGENTS.md` into a stage folder.** One copy, at
  `ATLAS-Explore/AGENTS.md`.
- Do not edit repo-level build config (`pom.xml`, `kitt.yml`, root `AGENTS.md`,
  the Java app) unless Franky explicitly asks — that's repo-owner territory and
  can break the whole service.
- **No CDN / no build step.** Third-party libs stay vendored. Don't introduce a
  bundler or runtime CDN fetch.
- **Keep it static & portable.** Relative paths only (no leading `/`); keep
  `builder/`, `player-template/`, and `templates/` as siblings within a stage.
- **Chromium + secure context** are hard requirements for the builder (see
  `ARCHITECTURE.md`). Don't "fix" a File-System-API absence by faking it —
  fail loudly instead.
- Follow SOLID / DRY / YAGNI and the Zen of Python. Keep files **< 600 lines**;
  split into focused modules over bloating `builder.js`.

---

## Known gotchas (learned the hard way)
- **"Empty builder, dead buttons"** = the browser lacks `showDirectoryPicker`
  (non-Chromium, or Chrome blocked by IT policy). Handled: the welcome screen
  shows a "use Edge" message instead of failing silently.
- **"Can't open this folder — system files"** = the browser's blocklist. The
  user picked Desktop/Documents/Downloads/drive-root/home-root. Fix is
  user-side: pick a normal sub-folder (e.g. `~/ATLAS-Explore/my-tour`). The
  welcome screen hints this.
- **Transient KITT build failures** (`Docker COPY: no source files specified`)
  can happen with `useArtifactory: true` even when nothing relevant changed —
  identical config building fine one commit earlier is the tell. Re-trigger with
  an empty commit; only suspect real breakage if it fails again on identical
  input.
- **Icon picker / popovers** must escape the scrollable editor panel — use a
  fixed-position popover that flips above when there's no room below (see
  `icon-picker.js`), not an in-flow element that gets clipped.
- **Case-insensitive filesystem gotcha:** on macOS (APFS default), folder names
  are case-preserving but case-*insensitive* — `Dev/` and a stray lowercase
  `dev/` are the SAME directory on disk. Never create a differently-cased
  sibling of an existing folder name without checking `ls` first; it silently
  merges instead of erroring.
