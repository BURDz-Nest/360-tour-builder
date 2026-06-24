# ARCHITECTURE — 360 Tour Builder (v2)

> **Read this first if you're an AI agent or developer picking up this project.**
> It explains the philosophy, the file-by-file layout, the data model, the key
> flows, and the gotchas. After reading this you should be able to make changes
> confidently from a single prompt.

---

## 1. What this project is

A **zero-backend** toolkit for authoring interactive 360° photo tours and
shipping them to static hosting (GitHub Pages, Azure, any plain web server).

- **No build step.** Plain ES modules served over HTTP.
- **No runtime CDN.** Photo-Sphere-Viewer (PSV) + three.js are **vendored** in
  `player-template/vendor/` so it works offline / behind corporate proxies.
- **No framework.** Vanilla JS, factory-function modules, dependency injection.
- **Two halves:** a **builder** (authoring, local only) and a **player**
  (read-only runtime, shipped inside each tour).

The whole thing leans hard on **SOLID/SRP** — each module owns one concern, and
PSV-specific knowledge is quarantined to two files. Keep it that way.

---

## 2. The two halves

| Half | Lives in | Purpose | Shipped to users? |
|------|----------|---------|-------------------|
| **Builder** | `builder/` | Author tours: add scenes/images/markers, save `tour.json` |  No — local tool |
| **Player** | `player-template/` → copied into each `tours/<name>/` | Render a tour read-only in WebGL |  Yes |

**Critical concept — self-contained tours:** every `tours/<name>/` folder is a
*complete, deployable website*: it has its own copy of the player runtime
(`player.html`, `css/`, `js/`, `vendor/`) **plus** `tour.json` + `images/`. You
can push *just that folder* to its own GitHub repo / Pages site. The runtime
duplication (~1.6 MB) is the price of portability — it's intentional.

Because the runtime is copied per-tour, **runtime fixes must be propagated** with
`scripts/sync-runtime.sh` (copies `player-template/{css,js,vendor,player.html}`
into every `tours/*/`). The builder also does an equivalent copy when creating a
new tour.

---

## 3. Directory map

```
360TourAp-v2/                  (this is the v2 worktree — see §9)
├── README.md                  user-facing quick start + schema
├── docs/
│   ├── ARCHITECTURE.md        ← you are here (dev/AI onboarding)
│   ├── USER-GUIDE.html        end-user manual (self-contained, no CDN)
│   ├── DEPLOY.md              GitHub Pages + Azure Blob (CORS) steps
│   └── SECURITY.md            data-classification / PII guidance
│
├── builder/                   THE AUTHORING TOOL (local only)
│   ├── index.html             builder DOM + import map (cache-busted ?v=N)
│   ├── builder.js             controller: state, render, wiring (keep <600 lines)
│   ├── builder-viewer.js      BuilderViewer class — PSV preview + place-mode
│   ├── preview.js             createPreview() — what the center viewport shows
│   ├── workspace.js           createWorkspace() — New/Open/Recent/images flows
│   ├── overlays.js            mountOverlays() — Welcome + Images modal chrome
│   ├── project-store.js       IndexedDB "recent projects" (dir handles)
│   ├── fs-workspace.js        File System Access API: read/write/optimize files
│   └── ui-dom.js              tiny DOM builder helpers (miniBtn, labeledInput…)
│
├── player-template/           THE RUNTIME (copied into every tour)
│   ├── player.html            player DOM + import map
│   ├── manifest.json
│   ├── css/app.css            SHARED styling (builder + player). Cache-busted ?v=N
│   ├── js/
│   │   ├── tour-model.js      tour.json schema, validate, factories (PURE, shared)
│   │   ├── psv-adapter.js     tour.json → PSV config (the ONLY PSV-shape file, shared)
│   │   └── player.js          player bootstrap (fetch config → init Viewer)
│   └── vendor/                VENDORED libs (list_files hides this — it exists!)
│       ├── three.module.js                 (three 0.169.0)
│       ├── psv-core.module.js / .css       (PSV 5.11.5)
│       ├── psv-markers.module.js / .css
│       ├── psv-virtual-tour.module.js / .css
│       └── psv-gallery.module.js / .css
│
├── tours/                     YOUR TOURS — each a complete deployable site
│   ├── Sams-Office-Tour/      the real 16-scene tour (images + runtime + tour.json)
│   └── sams-office/           reference/sample tour
│
├── scripts/
│   ├── launch.command         double-click: start server + open builder (mac)
│   ├── new-tour.sh            scaffold tours/<name>/ from the template
│   ├── resize-360.sh          batch web-optimize raw 360s (CLI alternative)
│   └── sync-runtime.sh        push runtime fixes into all existing tours
│
└── source-photos/            raw camera files (git-ignored staging area)
```

---

## 4. Module-by-module (builder)

The builder is a small MVC-ish app. `builder.js` is the controller; the other
modules are injected collaborators (factory functions receiving a `ctx` object).

### `builder.js` (controller, ~572 lines — **keep under 600**)
- Holds the single `state` object: `{ tour, currentSceneId, selectedMarkerId,
  placing, fileHandle, dirHandle, previewBase }`.
- Owns rendering: `renderAll`, `renderSceneList`, `renderSceneEditor`,
  `renderMarkerList`, `renderViewReadout`.
- Owns scene/marker actions: `addScene`, `deleteScene`, `selectScene`,
  `updateScene`, `beginPlacing`/`handlePlace`, `captureView`, `setStartScene`.
- Owns import/export: `importTour`, `saveTour`, `serializeTour`,
  `prepareThumbnails`, `previewInPlayer` (stages tour to `localStorage` under
  `tour-preview-config`, opens player with `?config=__preview__`).
- `init()` wires everything. Help modal is wired at **top level** (always
  available); the File-System features are wired only `if (fs.fsSupported())`.

### `builder-viewer.js` — `class BuilderViewer`
- Wraps ONE PSV `Viewer` + `MarkersPlugin` for the live preview.
- `loadScene(scene, url)`, `clear()` (blank/transparent), `renderMarkers()`,
  `setPlaceMode()`, `getCurrentView()` (yaw/pitch deg + zoom), `applyView()`.
- **This is one of only two files that import PSV directly.**

### `preview.js` — `createPreview({state,$,toast,getScene,viewer})`
- Single source of truth for the center viewport. `updatePreview()` decides:
  scene-with-image → render; scene-without-image → "no image yet" card;
  no-scene → "Add images to get started!" card (over a blank viewer).
- `resolvePreviewUrl()` prepends `state.previewBase` to relative paths **for
  preview only** (never written to tour.json).

### `workspace.js` — `createWorkspace(ctx)`
- The File-System workflows: `handleNewTour`, `handleOpenTour`, `openRecent`,
  `bindFolder`, `handleAddImages`, `addAllImagesAsScenes`, `handleOptimize`,
  `refreshImageGrid`, `assignImageToScene`.
- `adoptWorkspace(dirHandle, name)` is the hub: sets `previewBase`,
  **auto-loads the folder's `tour.json`**, renders, remembers the project in
  IndexedDB, refreshes the image grid.
- **New images auto-append as scenes** (each photo → a new scene at the bottom).

### `overlays.js` — `mountOverlays($, handlers)`
- The Welcome screen (New/Open/Recent list from IndexedDB) and the Images modal
  open/close/Escape behavior. Returns `{showWelcome, hideWelcome, renderRecent,
  closeImageModal}`. (Help modal is NOT here — it's top-level in builder.js.)

### `project-store.js`
- IndexedDB (`tour-builder` db, `recent-projects` store). Persists directory
  **handles** so "Recent projects" can reopen folders across sessions (with a
  permission prompt). `rememberProject`, `listRecent`, `forgetProject`.

### `fs-workspace.js` (File System Access API — Chrome/Edge only)
- `fsSupported()`, `newTour()`, `openTour()`, `readTourJson()`,
  `verifyPermission()`, `saveTourJson()`, `listImageNames()`,
  `setupDropZone()`, `renderImageGrid()`.
- **Image pipeline:** `addImages()` web-optimizes on import → downscale to
  `MAX_PANO_WIDTH = 4096` px, re-encode JPEG (`webName()`), generate a
  center-crop snapshot `thumbName()` in `images/thumbs/`. `optimizeFolder()`
  re-processes Finder-copied files and returns a rename map so scene paths get
  fixed. `ensureThumbnails()` backfills missing thumbs.

### `ui-dom.js`
- Trivial DOM construction helpers used by the marker editor.

---

## 5. Module-by-module (player / shared)

### `tour-model.js` (PURE — no DOM, no PSV) — **shared by builder + player**
- The schema authority. `SCHEMA_VERSION = 1`, `MARKER_TYPES`,
  `createEmptyTour/Scene/Marker`, `getScene`, `resolveStartScene`, and
  `validateTour(raw)` which **repairs what it safely can** and returns
  `{ok, tour, errors, warnings}`. Change the schema HERE first.

### `psv-adapter.js` — **shared**, the ONLY other PSV-aware file
- `toViewerNodes(tour)` → VirtualTour nodes (`link` markers → node `links`,
  `info` markers → node `markers`). `sceneInitialView`, `waypointArrowStyle`
  (the floor pin), `degStr` (degrees → PSV `"<n>deg"`), `escapeHtml`.

### `player.js` (player bootstrap)
- `?config=` → fetch (or `__preview__` from localStorage) → `validateTour` →
  `toViewerNodes` → init `Viewer` with VirtualTour + Markers.
- **Transition behavior:** `transitionOptions` does `{effect:"fade",
  rotation:false, rotateTo:savedView, zoomTo}` so navigation cross-fades and
  always lands on each scene's saved view with **no spin**.
- Info markers open an accessible overlay panel. Surfaces `panorama-error`
  (the CORS/black-image case) with a clear message.

---

## 6. Data model — `tour.json` (version 1)

```jsonc
{
  "version": 1,
  "meta": { "title": "", "description": "", "author": "",
            "startSceneId": "s1", "showThumbnails": true, "createdAt": "ISO" },
  "scenes": [{
    "id": "s1",
    "name": "Frontend",                 // gallery label
    "panorama": "images/front.jpg",     // local path OR full Azure URL
    "thumbnail": "images/thumbs/front.jpg",
    "caption": "Checkout area",
    "initialView": { "yaw": 0, "pitch": 0, "zoom": 50 },  // DEGREES, zoom 0-100
    "markers": [
      { "id":"m1","type":"link","yaw":60,"pitch":-5,"label":"To Backroom","targetSceneId":"backroom" },
      { "id":"m2","type":"info","yaw":-90,"pitch":0,"label":"Desk","html":"<p>Open 8-9</p>" }
    ]
  }]
}
```

- **Angles are DEGREES** everywhere in our data; `psv-adapter` converts to PSV
  strings. Don't leak `"deg"` strings into the model.
- **Paths**: relative (`images/x.jpg`) for local/self-contained, OR absolute
  (Azure) URLs. Both work in the player. The builder's read-only "Panorama"
  field shows whichever it is; you change it via the **Images** dialog, not by
  typing.

---

## 7. Key flows

- **New project:** Welcome → New → prompt name → `fs.newTour` (creates folder,
  copies runtime) → `adoptWorkspace` → blank viewer + "Add images" card.
- **Open project:** Welcome → Open → folder picker → `adoptWorkspace`
  **auto-loads `tour.json`** → scenes appear.
- **Recent:** Welcome list → `openRecent` → `verifyPermission` on stored handle
  → `adoptWorkspace`.
- **Add image:** Images modal → drag/select → `addImages` (optimize + thumb) →
  **each becomes a new scene**.
- **Place marker:** select scene → `+ Navigation`/`+ Info` → click in preview →
  `handlePlace` writes yaw/pitch → marker card lets you pick target / text.
- **Save:** `saveTour` → `prepareThumbnails` → `fs.saveTourJson` writes
  `tour.json` into the folder (no dialog on Chrome/Edge).
- **Preview:** `previewInPlayer` → stage to localStorage → open
  `tours/<name>/player.html?config=__preview__`.
- **Publish:** push `tours/<name>/` to GitHub Pages; live link is
  `https://<user>.github.io/<repo>/tours/<name>/player.html`. (Azure for big
  image sets — see DEPLOY.md; CORS is the gotcha.)

---

## 8. Conventions & gotchas (READ BEFORE EDITING)

1. **Cache-busting:** the browser caches modules hard. After editing
   `builder.js` or `app.css`, **bump the `?v=N`** in `builder/index.html`
   (and `player-template/player.html` for player/css changes). Tell the user to
   hard-refresh (Cmd+Shift+R).
2. **600-line rule:** keep each file under 600 lines. If `builder.js` creeps
   over, extract a cohesive chunk into a new `createX()` module (that's how
   `preview.js`/`overlays.js`/`workspace.js` were born).
3. **PSV isolation:** only `builder-viewer.js`, `psv-adapter.js`, and
   `player.js` may import PSV. Everything else stays PSV-agnostic.
4. **z-index / stacking:** modals are `z-index 50`, Welcome `60`. `.builder-main`
   owns its own stacking context (`position:relative; z-index:0`) so nothing
   inside it can paint over the modals. Don't give builder children huge z-index.
5. **File System Access API = Chrome/Edge only.** Firefox/Safari hide the
   workspace bar. `fsSupported()` gates all of it.
6. **Headless testing caveat:** headless Chrome (swiftshader) has no real WebGL,
   so `BuilderViewer`'s constructor throws at `builder-viewer.js:46` and the
   player shows "no WebGL". This is a **headless artifact, not a bug** — verify
   by confirming v1 produces the *same* error. Real Chrome works.
7. **Degrees, not radians**, in our model (see §6).
8. **Emoji filter:** this environment strips emoji from file writes — don't put
   emoji in code/files.
9. **Runtime duplication:** after changing anything in `player-template/`, run
   `scripts/sync-runtime.sh` to push it into existing `tours/*`.

---

## 9. Versioning: v1 vs v2 (git branches + worktrees)

- **`main` = v1** (tagged `v1.0`): the original working web builder. Stable;
  the team uses it. Lives in the `360TourAp/` folder, served on **port 8123**.
- **`v2` branch**: this folder (`360TourAp-v2/`), served on **port 8124**. Adds
  the Welcome screen, footgun cleanup (read-only panorama, removed preview-base
  & thumbnail fields), auto-load tour.json, Help/publishing modal, empty-state
  viewport.
- Both are **git worktrees** of the same repo, so they run side-by-side.
  `git worktree list` shows them.
- **AI agents — the golden rule:** check your CWD first (`pwd`).
  - If your terminal/CWD is **`360TourAp-v2/`** (the normal case for v2 work),
    relative file paths stay inside v2 — you're safe, just work normally.
  - If your CWD is the **main `360TourAp/`** folder, file tools default there, so
    you must use absolute `…/360TourAp-v2/…` paths or you'll edit v1 by accident.
  - Either way: confirm `git branch --show-current` says **`v2`** before editing.

To start a server for whichever you're working on:
```bash
cd <the folder> && python3 -m http.server 8124   # 8123 for v1
```

---

## 10. Roadmap / not-yet-built (planned next steps)

- **Azure image upload mode** (for big tours): an "Upload to Azure" action that
  pushes `images/` to Blob storage and rewrites scene paths to the Azure URLs —
  *app-managed, user never types a URL*. Needs the container's **CORS** set for
  the Pages domain. Help modal already documents the requirements.
- **"Publish to GitHub" button**: commit + push + (optionally) enable Pages via
  the GitHub API, returning the live link. Currently guided-not-automated.
- **Electron desktop app** (Mac + Windows): wrap the existing UI, swap
  `fs-workspace.js` for a Node `fs` layer (kills the Chrome/Edge requirement and
  the folder-permission dance), use `sharp` for faster image optimization, add
  auto-update. The clean fs-isolation means this is mostly a one-file swap.

---

## 11. How to make common changes (recipes)

- **Add a field to a scene:** edit `createScene` + `validateTour` in
  `tour-model.js`; render it in `renderSceneEditor` (builder.js) + an input in
  `index.html`; consume it in `psv-adapter.js`/`player.js` if it affects display.
- **Change marker behavior:** `psv-adapter.js` (mapping) + `player.js`
  (interaction) + `builder-viewer.js` (preview pins).
- **Restyle anything:** `player-template/css/app.css` (shared). Bump `?v=N`.
- **Add a builder dialog:** follow the `overlays.js` pattern; mount in
  `builder.js` `init()`.
- **Tweak image optimization:** `fs-workspace.js` (`MAX_PANO_WIDTH`,
  `optimizeToWeb`, `makeSnapshotThumbnail`).

When done: bump cache versions, `node --check` the JS, run a headless load to
confirm no *new* console errors (compare against v1), and tell the user exactly
what to hard-refresh and click-test.
```
