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
│   ├── builder.js             controller: state, render, wiring (593 lines - near the 600 cap)
│   ├── builder-viewer.js      BuilderViewer class - PSV preview, place-mode, drag, zone editing
│   ├── marker-actions.js      marker CRUD + placement glue (factory; incl. zones)
│   ├── marker-row.js          one marker's editor card (icon row OR zone settings)
│   ├── icon-picker.js         createIconPicker() - inline grid picker for marker icons
│   ├── scene-list.js          GROUPED scene list (collapsible areas + thumbnails + hotspot badges + drag reorder)
│   ├── scene-actions.js       Duplicate scene + Copy hotspots helpers
│   ├── group-actions.js       createGroupActions() - area (group) CRUD: add/rename/delete/recolor/set-entry
│   ├── tabs.js                mountTabs() - accessible WAI-ARIA tab controller (reused)
│   ├── theme.js               dark/light theme toggle + persistence
│   ├── preview.js             createPreview() - what the center viewport shows
│   ├── workspace.js           createWorkspace() - New/Open/Recent/images flows
│   ├── overlays.js            mountOverlays() - Welcome + Images modal chrome
│   ├── project-store.js       IndexedDB "recent projects" (dir handles)
│   ├── fs-workspace.js        File System Access API: read/write/optimize files
│   ├── ui-dom.js              tiny DOM builder helpers (miniBtn, labeledInput/Color/Checkbox, modal)
│   ├── builder-ui.css         builder chrome/layout (builder-only; NOT synced to tours)
│   ├── builder-panels.css     builder side-panel + scene-list/areas styling (builder-only)
│   ├── welcome.css            Welcome-screen styles (builder-only; NOT synced to tours)
│   └── help-modal.css         Help/publish modal styles (builder-only)
│
├── player-template/           THE RUNTIME (copied into every tour)
│   ├── player.html            player DOM + import map
│   ├── manifest.json
│   ├── css/
│   │   ├── app.css            SHARED app chrome (builder + player). Cache-busted ?v=N
│   │   ├── markers.css        SHARED marker library + animations + icon-picker + ZONES
│   │   └── player.css         player-only chrome (.player-*, info overlay, share, spinner, areas menu)
│   ├── js/
│   │   ├── tour-model.js      tour.json schema (v2), validate, factories, group helpers (PURE, shared)
│   │   ├── marker-icons.js    Icon registry (NAV/INFO sets + animations). PURE, shared.
│   │   ├── psv-adapter.js     tour.json -> PSV config (the ONLY PSV-shape file, shared)
│   │   ├── share.js           player Share button + QR modal + ?scene= deep-linking (button currently hidden)
│   │   ├── areas-menu.js      mountAreasMenu() - player Areas dropdown + current-area breadcrumb
│   │   └── player.js          player bootstrap (fetch config -> init Viewer)
│   └── vendor/                VENDORED libs (list_files hides this - it exists!)
│       ├── three.module.js                 (three 0.169.0)
│       ├── psv-core.module.js / .css       (PSV 5.11.5)
│       ├── psv-markers.module.js / .css
│       ├── psv-virtual-tour.module.js / .css
│       ├── psv-gallery.module.js / .css    (vendored but NOT enabled in player.js yet)
│       └── qrcode.js                       (qrcode-generator 1.4.4, for Share/QR)
│
├── tours/                     YOUR TOURS - local working data, GIT-IGNORED
│   └── .gitkeep               (each tours/<name>/ is a complete deployable site)
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

### `builder.js` (controller, ~560 lines — **keep under 600**)
- Holds the single `state` object: `{ tour, currentSceneId, selectedMarkerId,
  placing, fileHandle, dirHandle, previewBase }`.
- Owns rendering: `renderAll`, `renderSceneList`, `renderSceneEditor`,
  `renderMarkerList`, `renderViewReadout`.
- Owns scene actions: `addScene`, `deleteScene`, `selectScene`,
  `updateScene`, `captureView`, `setStartScene`. **Marker** actions live in
  `marker-actions.js` (injected as `markerActions`).
- Owns import/export: `importTour`, `saveTour`, `serializeTour`,
  `prepareThumbnails`, `previewInPlayer` (stages tour to `localStorage` under
  `tour-preview-config`, opens player with `?config=__preview__`).
- `init()` wires everything (incl. the left-panel tabs AND the Hotspots
  Navigation/Info sub-tabs via `mountTabs`). Help modal is wired at **top
  level**; File-System features only `if (fs.fsSupported())`.

### `marker-actions.js` — `createMarkerActions(ctx)`
- The marker CRUD + placement glue, extracted to keep `builder.js` under 600.
  Returns `{ beginPlacing, cancelPlacing, handlePlace, selectMarker,
  deleteMarker, replaceMarker, updateMarker, moveZoneCorner }`. Handles both
  icon markers and info zones (zone placement drops a default quad;
  `moveZoneCorner` commits a dragged corner).

### `scene-list.js` + `group-actions.js` — scene AREAS (groups)
- `scene-list.js` renders the left scene list **grouped into collapsible areas**
  (schema v2). Each area shows a color dot + name + scene count; scenes are
  drag-reorderable and drag-movable between areas. Per-scene row: thumbnail,
  name + hotspot-count badge, and an **entry star** for grouped scenes
  (gold = author-pinned area entry, keyed by scene id so it survives reorder;
  faint = the auto default first scene when nothing is pinned). It's a pure
  factory that takes an `actions` bag; the open area's action row also holds a
  native `<input type=color>` swatch (recolor is applied live in-place via
  `applyColorLive` — NEVER re-render on the color `input` event or the OS
  picker slams shut).
- `group-actions.js` — `createGroupActions(ctx)`: the area CRUD, returns
  `{ addGroup, renameGroup, deleteGroup, setGroupColor, setGroupEntry,
  addSceneToGroup, moveSceneToGroup }`. `setGroupColor` mutates data only (no
  refresh — see above); deleting an area re-homes its scenes to Uncategorized.

### `builder-viewer.js` — `class BuilderViewer`
- Wraps ONE PSV `Viewer` + `MarkersPlugin` for the live preview.
- `loadScene(scene, url)`, `clear()`, `renderMarkers()` (icons AND zone
  polygons + draggable corner handles), `setPlaceMode()`, `getCurrentView()`,
  `applyView()`. Drag: selected icon pins reposition; selected zones expose
  per-corner handles (`onZoneCornerMove`).
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
- The schema authority. `SCHEMA_VERSION = 2`, `MARKER_TYPES`, `MARKER_SHAPES`,
  `createEmptyTour/Scene/Marker/Group`, `getScene`, `resolveStartScene`, and
  `validateTour(raw)` which **repairs what it safely can** (incl. back-filling
  v1 tours: no `groups` -> `[]`, missing `scene.groupId` -> `null`) and returns
  `{ok, tour, errors, warnings}`. Change the schema HERE first.
- **Scene AREAS (v2):** `tour.groups[]` = `{id, name, color, entrySceneId}` and
  each `scene.groupId` points at a group (or `null` = Uncategorized). Group
  helpers: `createGroup`, `getGroup`, `scenesInGroup`, `listAreas`,
  `resolveGroupEntryScene` (explicit `entrySceneId` else first member). Default
  group color is `#0071dc`. Old v1 tours load unchanged (no groups).
- New `meta` display flags (all default **on** for back-compat, validated via
  `!== false`): `showThumbnails`, `showWaypointShadows`, `showInfoZones`.

### `psv-adapter.js` — **shared**, the ONLY other PSV-aware file
- `toViewerNodes(tour)` → VirtualTour nodes. **Both** `link` and `info` markers
  become PSV `markers` (not VirtualTour `links`) so each can carry a unique
  icon from `marker-icons.js`. VirtualTour still owns the node graph (its
  `links` array is built for reachability), but its built-in arrow rendering
  is disabled (`arrowsRenderer: () => null` in player.js).
- `sceneInitialView`, `degStr` (degrees → PSV `"<n>deg"`), `escapeHtml`.

### `marker-icons.js` — **shared**, pure (no DOM, no PSV)
- The icon library: `NAV_ICONS` (waypoint, arrow, chevrons, footsteps, door,
  stairs up/down, elevator, exit, compass, parking, …) and `INFO_ICONS` (info,
  question, star, sparkles, eye, phone, email, camera, video, audio, clock,
  warning, cart, location). Each entry: `{ id, label, body, anim }`.
- `ANIMATIONS` tokens: `pulse | ring | bob | spin | twinkle` map to
  `.tour-anim--<token>` CSS classes in `markers.css`.
- `getIcon(type, id)` resolves to the chosen icon OR the type's default
  (`DEFAULT_ICON_ID = { link: "waypoint", info: "info" }`) so blank/missing
  `marker.icon` always renders something sane (back-compat for old tour.json).
- `renderMarkerHtml({ type, iconId, size, variant })` is what builder preview,
  builder picker, and player runtime ALL call — single source of truth.

### `areas-menu.js` — **player-only**
- `mountAreasMenu({mountEl, tour, onPickArea}) -> {update(sceneId)}`. Renders the
  player's **Areas dropdown** (fast-travel between groups) + a current-area
  breadcrumb on the button. Pure UI: it calls `onPickArea(groupId)` and never
  navigates itself; `player.js` resolves the group's entry scene and drives the
  VirtualTour. Mounts only when ≥1 group actually contains scenes. It floats
  over the panorama just under the title bar (moved out of the top bar).

### `player.js` (player bootstrap)
- `?config=` → fetch (or `__preview__` from localStorage) → `validateTour` →
  `toViewerNodes` → init `Viewer` with VirtualTour + Markers.
- **Transition behavior:** `transitionOptions` does `{effect:"fade",
  rotation:false, rotateTo:savedView, zoomTo}` so navigation cross-fades and
  always lands on each scene's saved view with **no spin**.
- **Marker click router:** info markers open the accessible overlay panel;
  link markers call `virtualTour.setCurrentNode(targetSceneId)` for navigation.
- **Deep-linking:** boot precedence is `?scene=<id>` > `?area=<groupId>` (jumps
  to that area's entry scene) > tour default; `writeSceneToUrl` keeps `?scene=`
  in sync on every `node-changed` (via `history.replaceState`).
- **Areas dropdown:** mounts `areas-menu.js`, resolves picks through
  `resolveGroupEntryScene`, and calls `.update()` on `node-changed` to keep the
  breadcrumb current. Also gates the **Info Zones** reveal button behind
  `meta.showInfoZones` (and the presence of zones). The **Share** button is
  currently hidden (see §8) though `share.js` stays wired for a quick re-enable.
- **Child imports are version-pinned** (`./tour-model.js?v=N`, etc.) so a bumped
  module actually reloads — see §8.
- Surfaces `panorama-error` (the CORS/black-image case) with a clear message.

---

## 6. Data model — `tour.json` (version 2)

```jsonc
{
  "version": 2,
  "meta": { "title": "", "description": "", "author": "",
            "startSceneId": "s1",
            "showThumbnails": true,       // image thumbs in nav popups (default on)
            "showWaypointShadows": true,  // ground shadow under nav pins (default on)
            "showInfoZones": true,        // show the Info Zones reveal button (default on)
            "createdAt": "ISO" },
  "groups": [                            // v2: scene AREAS (optional; [] = none)
    { "id":"g1", "name":"Front End", "color":"#0071dc", "entrySceneId":"s1" }
  ],
  "scenes": [{
    "id": "s1",
    "name": "Frontend",                 // gallery label
    "groupId": "g1",                    // v2: area membership (null = Uncategorized)
    "panorama": "images/front.jpg",     // local path OR full Azure URL
    "thumbnail": "images/thumbs/front.jpg",
    "caption": "Checkout area",
    "initialView": { "yaw": 0, "pitch": 0, "zoom": 50 },  // DEGREES, zoom 0-100
    "markers": [
      { "id":"m1","type":"link","yaw":60,"pitch":-5,"label":"To Backroom","icon":"door","targetSceneId":"backroom" },
      { "id":"m2","type":"info","yaw":-90,"pitch":0,"label":"Desk","icon":"clock","html":"<p>Open 8-9</p>" },
      { "id":"m3","type":"info","shape":"zone","label":"Vase","html":"<p>Ming dynasty</p>",
        "points":[{"yaw":8,"pitch":14},{"yaw":32,"pitch":14},{"yaw":32,"pitch":-4},{"yaw":8,"pitch":-4}],
        "idleStroke":false,"hoverColor":"#0071dc" }
    ]
  }]
}
```

- **v1 -> v2 is back-compatible.** `validateTour` back-fills `groups: []` and
  `scene.groupId: null` for old files; the three `show*` meta flags default to
  `true`. A v2 tour with no groups behaves exactly like a v1 tour did.
- **AREAS (groups):** `tour.groups[]` = `{id, name, color, entrySceneId}` and
  `scene.groupId` links a scene to one (or `null` = Uncategorized). The builder
  shows collapsible areas (color dot + entry star); the player shows an Areas
  dropdown. `entrySceneId` is where picking that area lands you (falls back to
  the first member). **Uncategorized is a staging bucket — NOT a player-facing
  jumpable area** (deliberate product decision).
- **Angles are DEGREES** everywhere in our data; `psv-adapter` converts to PSV
  strings. Don't leak `"deg"` strings into the model.
- **Paths**: relative (`images/x.jpg`) for local/self-contained, OR absolute
  (Azure) URLs. Both work in the player. The builder's read-only "Panorama"
  field shows whichever it is; you change it via the **Images** dialog, not by
  typing.
- **`icon`** (optional, per-marker): id from `marker-icons.js` — `NAV_ICONS`
  for `type:"link"`, `INFO_ICONS` for `type:"info"`. Blank/missing/unknown
  ids fall back to the type's default (`waypoint` / `info`). Add new icons in
  `marker-icons.js`; the picker grid populates automatically.
- **INFO ZONES** (Storyline-style hotspots): an `info` marker with
  `shape:"zone"`. Instead of a single `yaw`/`pitch` it carries `points` (an
  array of 3+ `{yaw,pitch}` corners in DEGREES — the builder authors a
  draggable 4-corner quad). `idleStroke` (bool) = faint always-on outline vs
  fully transparent until hover; `hoverColor` = the tint shown on hover/reveal.
  `shape` defaults to `"icon"` and is only stored for zones, so old tour.json
  files are unaffected. Zones open the SAME info popup as icon info markers
  (`data.kind="info"`). The player offers a **"Reveal zones"** toggle (shown
  only when a tour has zones) for keyboard/touch discoverability (a11y).
  Helpers: `isZone(marker)`, `defaultZonePoints()` in `tour-model.js`;
  `zoneMarkerToConfig()` in `psv-adapter.js`.

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
   hard-refresh (Cmd+Shift+R). **Also bump the pinned import pins** — e.g.
   `player.js` imports `./tour-model.js?v=3`, and `psv-adapter.js` imports it at
   the same pin. A bare `import "./x.js"` will serve a STALE cached copy even
   after you edit x.js; that exact bug silently dropped a new meta flag once.
   Keep the import's `?v=` and any `<script src>`/`<link href>` version in lockstep.
10. **`[hidden]` vs `display`:** the `hidden` HTML attribute does NOT hide an
   element whose class sets `display` (e.g. `.player-bar__share { display:
   inline-flex }`) — an author `display` rule beats the UA `[hidden]{display:none}`
   rule. `player.css` now has a defensive `[hidden]{display:none !important;}`.
   When verifying visibility headlessly, check `getComputedStyle(el).display`,
   NOT just `el.hidden` (the property can be true while the element still shows).
11. **Preview freshness:** `previewInPlayer` appends `&_=<timestamp>` to the
   `player.html` URL so the preview tab always fetches the current HTML (which
   carries fresh `?v=` pins) — no more hard-refreshing the preview every time.
2. **600-line rule:** keep each file under 600 lines. If `builder.js` creeps
   over, extract a cohesive chunk into a new `createX()` module (that's how
   `preview.js`/`overlays.js`/`workspace.js`/`group-actions.js` were born).
   Heads-up: **`builder.js` is at 593 lines** — the next feature that touches it
   should extract, not append.
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

## 9. Repository / branch state

- This project lives on a **single `main` branch** (GitHub:
  `BURDz-Nest/360-tour-builder`). `main` is the current, canonical version
  (formerly the "v2" line). The old original build is preserved as the **`v1`
  git tag** for history only - we do not develop on it.
- The earlier v1/v2 **git-worktree** setup has been retired: this folder is now
  a normal standalone clone. (An archived copy of the old v1 working folder may
  exist locally as `360TourAp-ARCHIVE-v1/` - it is independent and untouched.)
- Serve locally on **port 8124** (see `scripts/launch.command`):

```bash
cd <this folder> && python3 -m http.server 8124
```

- **`tours/` is git-ignored** - tours are local working data (often
  real-facility imagery) and are NOT committed. A tracked `tours/.gitkeep`
  keeps the folder present. Author tours locally; publish each `tours/<name>/`
  folder to its own hosting target. See `docs/SECURITY.md`.
- Active branches: **`main`** (canonical) and **`feature/scene-groups`** (kept
  around post-merge as a checkpoint — do not develop on it; all scene-groups work
  is already in `main`).

---

## 10. Roadmap / not-yet-built (planned next steps)

**Recently shipped (for context):** scene AREAS/groups (schema v2) — builder
collapsible areas with color + entry star, player Areas dropdown + breadcrumb,
`?area=` deep-linking; the `showInfoZones` tour setting; drag-to-reorder scenes.
The player **Share** button is temporarily hidden (code retained) pending a
later revamp.

- **Icon LIBRARY expansion / custom icons** (next up per product): a larger,
  categorized picker and/or user-supplied glyphs for nav waypoints + info pins.
  Today icons come from the fixed registry in `marker-icons.js` (§5).
- **PSV GalleryPlugin** is vendored + import-mapped but NOT enabled in
  `player.js` (only referenced in a comment). Enabling a per-area gallery is a
  candidate once areas mature.
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
- **Add a marker icon:** add an entry to `NAV_ICONS` or `INFO_ICONS` in
  `marker-icons.js` (id, label, body=inner SVG, anim=animation token). The
  picker, preview, and player all pick it up — no other edits needed unless
  you also need a brand-new animation, in which case add a `@keyframes` + a
  `.tour-anim--<token>` rule in `markers.css` and an entry in `ANIMATIONS`.
- **Add a tour-level display toggle** (like `showInfoZones`): add the flag to
  `createEmptyTour` + validate it (`!== false`) in `tour-model.js`; add the
  checkbox to `index.html` Display section; bind + reflect-on-load in
  `builder.js`; read `tour.meta.<flag>` in `player.js`.
- **Change area (group) behavior:** data + helpers in `tour-model.js`; builder
  CRUD in `group-actions.js` + list UI in `scene-list.js`; player dropdown in
  `areas-menu.js` wired from `player.js`.
- **Restyle anything:** `player-template/css/app.css` (shared). Bump `?v=N`.
- **Add a builder dialog:** follow the `overlays.js` pattern; mount in
  `builder.js` `init()`.
- **Tweak image optimization:** `fs-workspace.js` (`MAX_PANO_WIDTH`,
  `optimizeToWeb`, `makeSnapshotThumbnail`).

When done: bump cache versions, `node --check` the JS, run a headless load to
confirm no *new* console errors (compare against v1), and tell the user exactly
what to hard-refresh and click-test.
```
