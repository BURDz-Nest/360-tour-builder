# 360 Virtual Tour Builder (v2)

A **zero-backend** toolkit for authoring interactive 360 virtual tours and
shipping them to static hosting (GitHub Pages, Azure, any plain web server).
Built on [Photo-Sphere-Viewer](https://photo-sphere-viewer.js.org/) (WebGL),
fully vendored — no runtime CDN, no build step, works offline and behind
corporate proxies.

> **Picking this project back up (dev or AI agent)?** Read
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — it's the full
> file-by-file breakdown, data model, key flows, conventions, and roadmap.
>
> **End user?** See [`docs/USER-GUIDE.html`](docs/USER-GUIDE.html) for a
> click-by-click manual.

## What's new in v2

- **Welcome screen** — the builder opens to **New project / Open project /
  Recent projects** (a project = a tour folder). Recents persist across sessions
  (IndexedDB).
- **Foolproof editing** — no more hand-typed paths. The panorama field is
  read-only (set by clicking a photo in the Images dialog); the preview-base and
  thumbnail fields are gone (auto-derived/computed).
- **Auto-everything for images** — drag photos into the **Images** dialog and
  each one is web-optimized (downscaled to 4096px JPEG + thumbnail) **and becomes
  a new scene** automatically.
- **Auto-load on open** — opening a tour folder loads its `tour.json` instantly.
- **Help & publishing modal** — in-app guidance for GitHub Pages + Azure
  (including the all-important CORS step).
- **Friendly empty state** — a new/empty tour shows "Add images to get started!"
  instead of a stale panorama.

## Folder structure

```
360TourAp-v2/                  the workshop (dev-only; not deployed)
├── README.md                  you are here
├── docs/
│   ├── ARCHITECTURE.md        full dev/AI onboarding (read this first)
│   ├── USER-GUIDE.html        end-user manual (self-contained, no CDN)
│   ├── DEPLOY.md              GitHub Pages + Azure Blob (CORS) instructions
│   └── SECURITY.md            data-classification + hosting safety
├── builder/                   the authoring tool (run locally, never shipped)
│   ├── index.html             DOM + import map (cache-busted ?v=N)
│   ├── builder.js             controller: state, render, wiring
│   ├── builder-viewer.js      BuilderViewer — PSV preview + place-mode
│   ├── preview.js             what the center viewport shows (image vs. empty)
│   ├── workspace.js           New/Open/Recent + image flows
│   ├── overlays.js            Welcome + Images modal chrome
│   ├── project-store.js       IndexedDB "recent projects"
│   ├── fs-workspace.js        File System Access: read/write/optimize files
│   └── ui-dom.js              small DOM helpers
├── player-template/           the runtime, copied into every new tour
│   ├── player.html
│   ├── css/app.css            shared styling (builder + player)
│   ├── js/                    tour-model.js · psv-adapter.js · player.js
│   └── vendor/                vendored PSV 5.11.5 + three 0.169.0 (no CDN)
├── tours/                     your tours — each a complete, deployable site
│   ├── Sams-Office-Tour/      the real tour (player.html + css/ js/ vendor/ + tour.json + images/)
│   └── sams-office/           reference/sample tour
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

## Quick start

ES modules must be served over HTTP (not `file://`). v2 runs on port **8124**
(v1 lives in the sibling `360TourAp/` folder on 8123 — see "Versioning" below):

```bash
# from this project root:
python3 -m http.server 8124
```

- **Builder:** http://localhost:8124/builder/index.html
- **Sample tour:** http://localhost:8124/tours/sams-office/player.html

> The builder needs **Chrome or Edge** (it uses the File System Access API to
> read/write your tour folder). Firefox/Safari can still view tours.

## Workflow (build → ship)

1. **New project:** in the Welcome screen click **New project**, name it, and
   pick (or create) a folder under `tours/`. The runtime is copied in for you.
2. **Add images:** click **Images…**, then drag your 360 photos in. Each is
   auto-optimized (4096px JPEG + thumbnail) and **becomes a new scene**.
   *(Finder-first? Drop files in `tours/<name>/images/`, Open the folder, then
   use "Optimize images" + "Add all as scenes".)*
3. **Author:** select a scene, add **Navigation** / **Info** hotspots by clicking
   in the preview, set captions, capture a default view, choose the start scene.
4. **Save:** click **Save tour** — on Chrome/Edge it writes `tour.json` straight
   into your `tours/<name>/` folder.
5. **Preview:** click **Preview in player** (opens the read-only tour in a tab).
6. **Ship:** push `tours/<name>/` to GitHub Pages or Azure. See
   **docs/DEPLOY.md** (and **docs/SECURITY.md** before publishing real facilities).

The **Help & publishing** button in the builder summarizes the GitHub/Azure
requirements without leaving the app.

## tour.json schema (version 1)

```jsonc
{
  "version": 1,
  "meta": { "title": "", "description": "", "author": "",
            "startSceneId": "s1", "showThumbnails": true, "createdAt": "ISO-8601" },
  "scenes": [
    {
      "id": "s1",
      "name": "Frontend",                       // shown in nav popups
      "panorama": "images/front.jpg",           // local path OR full Azure URL
      "thumbnail": "images/thumbs/front.jpg",   // auto-generated; defaults to panorama
      "caption": "Checkout area",
      "initialView": { "yaw": 0, "pitch": 0, "zoom": 50 }, // degrees, zoom 0-100
      "markers": [
        { "id": "m1", "type": "link", "yaw": 60, "pitch": -5,
          "label": "To Backroom", "targetSceneId": "backroom" },
        { "id": "m2", "type": "info", "yaw": -90, "pitch": 0,
          "label": "Service Desk", "html": "<p>Open 8a-9p</p>" }
      ]
    }
  ]
}
```

Angles are **degrees** (human-friendly); the player converts them for WebGL.
The schema authority is `player-template/js/tour-model.js`.

## Versioning (v1 vs v2)

This is the **v2** worktree. The original, stable **v1** lives in the sibling
folder `360TourAp/` (git tag `v1.0`, served on port 8123) and the team can keep
using it while v2 is developed here on port 8124. Both are git worktrees of the
same repo and can run side-by-side.

## Tech / versions

- Photo-Sphere-Viewer **5.11.5** + plugins (virtual-tour, markers)
- three **0.169.0** (matched to PSV's dependency)
- Vendored in `player-template/vendor/` — no runtime CDN. To upgrade, re-download
  matching files and keep `three` matched to PSV's dependency.
