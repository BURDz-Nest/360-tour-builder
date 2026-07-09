# Spherio Studio

A **zero-backend** toolkit for authoring interactive 360° virtual tours and
shipping them to static hosting (GitHub Pages, Azure Blob, any plain web server).
Built on [Photo-Sphere-Viewer](https://photo-sphere-viewer.js.org/) (WebGL),
fully vendored — **no runtime CDN, no build step** — so it works offline and
behind corporate proxies.

You author tours in a local **builder** app (drag in photos, drop hotspots,
capture views). Each tour is exported as a self-contained folder you can publish
anywhere — the **player** runtime travels with it.

> **Working on the code (dev or AI agent)?** Start with
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the full file-by-file
> breakdown, data model, key flows, conventions, and roadmap.
>
> **Just making tours?** See [`docs/USER-GUIDE.html`](docs/USER-GUIDE.html) for a
> click-by-click manual.

## Features

- **Project-based workflow** — the builder opens to a Welcome screen with
  **New project / Open project / Recent projects** (a project = a tour folder).
  Recents persist across sessions via IndexedDB.
- **Drag-and-drop images** — drop your 360° photos into the **Images** dialog and
  each one is web-optimized (downscaled to 4096px JPEG + thumbnail) **and becomes
  a new scene** automatically. No hand-typed paths anywhere.
- **Click-to-place hotspots** — add **Navigation** links (scene-to-scene) and
  **Info** popups by clicking in the live preview. Drag a placed hotspot to
  reposition it; click empty space to deselect.
- **Icon library** — choose from ~28 built-in marker glyphs (waypoints, arrows,
  chevrons, footsteps, doors, stairs, elevator, info, star, phone, cart…) per
  hotspot, or fall back to the sensible default for its type.
- **Scene management** — thumbnails and hotspot-count badges in the scene list,
  reorder by drag, **duplicate a scene**, and **copy hotspots** from one scene to
  another.
- **Scene areas (groups)** — organize scenes into named, color-coded **areas**
  (e.g. Front End, Back Room). The builder shows collapsible area sections with a
  color picker and a per-area **entry scene**; the player gets an **Areas**
  dropdown for fast travel plus `?area=<id>` deep-linking.
- **Info Zones** — Storyline-style transparent polygon hotspots (in addition to
  icon pins), with a per-tour **Show Info Zones** toggle for the player's reveal
  button.
- **Guided experience (opt-in)** — flip a tour into a linear "find the hotspots"
  mode: navigation pins are hidden, the learner must open every **required** info
  hotspot in a scene before a **Continue** prompt appears, ending on a custom
  **completion screen**. Disabled by default; a normal tour is unaffected.
- **Live preview** — a real Photo-Sphere-Viewer panorama with capture-current-view
  for each scene's default camera angle, plus a chosen start scene.
- **Dark mode** — builder theme toggle, remembered across sessions.
- **Player niceties** — URL deep-linking (`?scene=<id>` / `?area=<id>`) so any
  view is shareable. *(A Share/QR button exists in the code but is temporarily
  hidden pending a revamp.)*
- **One-click publish guidance** — an in-app **Help & publishing** modal covers
  the GitHub Pages + Azure steps (including the all-important CORS bit).

## Folder structure

```
360-tour-builder/              project root (the workshop; dev-only, not deployed)
├── README.md                  you are here
├── docs/
│   ├── ARCHITECTURE.md        full dev/AI onboarding (read this first)
│   ├── USER-GUIDE.html        end-user manual (self-contained, no CDN)
│   ├── DEPLOY.md              GitHub Pages + Azure Blob (CORS) instructions
│   └── SECURITY.md            data-classification + hosting safety
├── builder/                   the authoring tool (run locally, never shipped)
│   ├── index.html             DOM + import map (cache-busted ?v=N)
│   ├── builder.js             controller: state, render, wiring
│   ├── builder-viewer.js      BuilderViewer — PSV preview, place-mode, drag-to-move
│   ├── preview.js             what the center viewport shows (image vs. empty)
│   ├── workspace.js           New/Open/Recent + image flows
│   ├── overlays.js            Welcome + Images modal chrome
│   ├── scene-list.js          grouped scene list (areas + thumbnails + hotspot badges + drag)
│   ├── scene-actions.js       duplicate scene + copy-hotspots menu
│   ├── group-actions.js       scene AREA (group) CRUD: add/rename/delete/recolor/entry
│   ├── marker-row.js          hotspot editor row factory
│   ├── icon-picker.js         marker icon library picker
│   ├── tabs.js                accessible tab controller (Scenes | Tour settings)
│   ├── theme.js               dark/light theme toggle + persistence
│   ├── project-store.js       IndexedDB "recent projects"
│   ├── fs-workspace.js        File System Access: read/write/optimize files
│   ├── ui-dom.js              small DOM helpers
│   └── *.css                  builder-only styling (welcome, help-modal)
├── player-template/           the runtime, copied into every new tour
│   ├── player.html
│   ├── manifest.json          list of runtime files to copy into a tour
│   ├── css/                   app.css (shared) · markers.css · player.css
│   ├── js/
│   │   ├── tour-model.js      tour.json schema authority (pure data)
│   │   ├── marker-icons.js    the marker icon registry (SVGs)
│   │   ├── psv-adapter.js     maps tour-model → Photo-Sphere-Viewer
│   │   ├── areas-menu.js      player Areas dropdown + current-area breadcrumb
│   │   ├── guided.js          opt-in guided 'find the hotspots' runtime (lazy)
│   │   ├── player.js          read-only viewer controller
│   │   └── share.js           Share button + QR modal (currently hidden)
│   └── vendor/                vendored PSV 5.11.5 + three 0.169.0 + qrcode (no CDN)
├── tours/                     your tours live here locally (git-ignored)
│   └── .gitkeep               each tours/<name>/ is a complete, deployable site
├── scripts/
│   ├── launch.command         double-click: start server + open builder (mac)
│   ├── new-tour.sh            scaffold a tours/<name>/ folder (CLI alternative)
│   ├── resize-360.sh          web-optimize raw 360 photos (CLI alternative)
│   └── sync-runtime.sh        push runtime fixes into all existing tours
└── source-photos/             raw camera files (git-ignored staging area)
```

**Why a copy of the runtime per tour?** Each `tours/<name>/` is fully
self-contained, so you can push *just that folder* to its own repo / Pages site.
The runtime is tiny (~1.6 MB vendored), so the duplication is cheap and the
portability is worth it. After changing anything in `player-template/`, run
`./scripts/sync-runtime.sh` to propagate it into existing tours.

> **Tours are local-only.** The `tours/` folder is **git-ignored** — your tours
> (often real-facility imagery) stay on your machine and are **not** committed to
> this repo. Author them here, then publish each `tours/<name>/` folder to its
> own hosting target. See `docs/SECURITY.md` before publishing real facilities.

## Quick start

ES modules must be served over HTTP (not `file://`). Serve the project root with
any static server — for example Python's built-in one on port **8124**:

```bash
# from this project root:
python3 -m http.server 8124
```

- **Builder:** http://localhost:8124/builder/index.html
- **A tour you've made:** http://localhost:8124/tours/<your-tour>/player.html

On macOS you can also just double-click `scripts/launch.command`, which starts
the server and opens the builder for you.

> The builder needs **Chrome or Edge** — it uses the File System Access API to
> read/write your tour folder. Any modern browser can still *view* published tours.

## Workflow (build → ship)

1. **New project:** in the Welcome screen click **New project**, name it, and
   pick (or create) a folder under `tours/`. The runtime is copied in for you.
2. **Add images:** click **Images…**, then drag your 360° photos in. Each is
   auto-optimized (4096px JPEG + thumbnail) and **becomes a new scene**.
   *(Finder-first? Drop files in `tours/<name>/images/`, Open the folder, then
   use "Optimize images" + "Add all as scenes".)*
3. **Author:** select a scene, add **Navigation** / **Info** hotspots by clicking
   in the preview, pick an icon, set captions, capture a default view, and choose
   the start scene. Use the **Scenes** / **Tour settings** tabs to keep the panel
   tidy on larger tours.
4. **Save:** click **Save tour** — on Chrome/Edge it writes `tour.json` straight
   into your `tours/<name>/` folder.
5. **Preview:** click **Preview in player** (opens the read-only tour in a tab).
6. **Ship:** push `tours/<name>/` to GitHub Pages or Azure. See
   **docs/DEPLOY.md** (and **docs/SECURITY.md** before publishing real facilities).

The **Help & publishing** button in the builder summarizes the GitHub/Azure
requirements without leaving the app.

## tour.json schema (version 2)

```jsonc
{
  "version": 2,
  "meta": {
    "title": "",
    "description": "",
    "author": "",
    "startSceneId": "s1",
    "showThumbnails": true,         // image thumbnails in nav popups
    "showWaypointShadows": true,    // floating ground shadow under nav waypoints
    "showInfoZones": true,          // show the player's Info Zones reveal button
    "showHotspotHints": false,      // opt-in magnifier glyph on info zones (mobile)
    "experience": {                 // opt-in guided mode (disabled by default)
      "enabled": false,
      "showStartScreen": true,      // welcome/instructions screen before the run
      "completionTitle": "Great job!",
      "completionMessage": "You've found everything."
    },
    "createdAt": "ISO-8601"
  },
  "groups": [                        // scene AREAS (optional; [] or omitted = none)
    { "id": "g1", "name": "Front End", "color": "#0071dc", "entrySceneId": "s1" }
  ],
  "scenes": [
    {
      "id": "s1",
      "name": "Frontend",                         // shown in nav popups
      "groupId": "g1",                            // area membership (null = Uncategorized)
      "panorama": "images/front.jpg",             // local path OR full Azure URL
      "thumbnail": "images/thumbs/front.jpg",     // auto-generated; defaults to panorama
      "caption": "Checkout area",
      "initialView": { "yaw": 0, "pitch": 0, "zoom": 50 }, // degrees, zoom 0-100
      "markers": [
        { "id": "m1", "type": "link", "yaw": 60, "pitch": -5,
          "icon": "arrow",                        // "" = default for this type
          "label": "To Backroom", "targetSceneId": "backroom" },
        { "id": "m2", "type": "info", "yaw": -90, "pitch": 0,
          "icon": "",                             // info default
          "required": true,                       // guided mode: must be opened to progress
          "label": "Service Desk", "html": "<p>Open 8a-9p</p>" }
      ]
    }
  ]
}
```

- **Back-compatible with v1:** older files (no `groups`, no `scene.groupId`) load
  fine — the schema back-fills them and the `show*` meta flags default to `true`.
- **Areas:** `groups[]` = `{id, name, color, entrySceneId}`; each scene's
  `groupId` links it to an area (or `null` = Uncategorized). `entrySceneId` is
  the scene you land on when picking that area in the player.
- Angles are stored as human-friendly **degrees**; the player converts them for WebGL.
- `marker.icon` is an id from the icon registry (e.g. `waypoint`, `arrow`, `door`,
  `info`, `star`). An empty string means "use the default icon for this marker
  type" — keeping saved files small and letting defaults change later.
- The schema authority is `player-template/js/tour-model.js`; the icon registry is
  `player-template/js/marker-icons.js`.

## Tech / versions

- Photo-Sphere-Viewer **5.11.5** + plugins (virtual-tour, markers)
- three **0.169.0** (matched to PSV's dependency)
- qrcode-generator **1.4.4** (vendored, for the player's Share/QR feature)
- Everything vendored in `player-template/vendor/` — no runtime CDN. To upgrade,
  re-download matching files and keep `three` matched to PSV's dependency.
