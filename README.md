# 360 Virtual Tour Builder

A **zero-backend** toolkit for authoring interactive 360 virtual tours and
shipping them to static hosting (GitHub Pages, Azure Static Web Apps, any plain
web server). Built on [Photo-Sphere-Viewer](https://photo-sphere-viewer.js.org/)
(WebGL), fully vendored — no runtime CDN, no build step, works offline and
behind corporate proxies.

## Folder structure

```
360TourAp/                 the workshop (dev-only; not deployed)
├── README.md              you are here
├── docs/
│   ├── DEPLOY.md          GitHub Pages + Azure Blob (CORS) instructions
│   └── SECURITY.md        data-classification + hosting safety
├── builder/               the authoring tool (run locally, never shipped)
│   ├── index.html
│   ├── builder.js
│   └── builder-viewer.js
├── player-template/       the runtime, copied into every new tour
│   ├── player.html
│   ├── css/  js/  vendor/
├── tours/                 your tours — each is a complete, deployable site
│   └── sams-office/       player.html + css/ + js/ + vendor/ + tour.json + images/
├── scripts/
│   ├── new-tour.sh        scaffold a new tours/<name>/ folder
│   └── resize-360.sh      web-optimize raw 360 photos
└── source-photos/         raw camera files (git-ignored staging area)
```

**Why a copy of the runtime per tour?** Each `tours/<name>/` is fully
self-contained, so you can push *just that folder* to its own repo / Pages site.
The runtime is tiny (~1.6 MB vendored), so the duplication is cheap and the
portability is worth it.

## Quick start

ES modules must be served over HTTP (not `file://`):

```bash
# from the project root:
python3 -m http.server 8123
```

- **Builder:** http://localhost:8123/builder/index.html
- **Sample tour:** http://localhost:8123/tours/sams-office/player.html?config=tour.json

## Workflow (local → GitHub/Azure)

1. **Scaffold a tour:** `./scripts/new-tour.sh "Backroom Walkthrough"`
   → creates `tours/backroom-walkthrough/` (runtime + empty `images/` + starter `tour.json`).
2. **Prep images:** `./scripts/resize-360.sh "source-photos/raw"` then copy the
   `*_web.jpg` into `tours/<name>/images/`. (Or host them on Azure — see DEPLOY.md.)
3. **Author:** open the builder, add scenes (point panorama URLs at
   `images/yourfile.jpg`), drop hotspots, set the start scene.
4. **Save:** click **Save tour** — on Chrome/Edge it writes `tour.json` straight
   into your `tours/<name>/` folder (File System Access API). Other browsers fall
   back to a download you move into the folder.
5. **Test:** `http://localhost:8123/tours/<name>/player.html?config=tour.json`
6. **Ship:** push `tours/<name>/` to GitHub Pages or Azure. See **docs/DEPLOY.md**.

> Before publishing photos of real facilities, read **docs/SECURITY.md**.

## tour.json schema (version 1)

```jsonc
{
  "version": 1,
  "meta": { "title": "", "description": "", "author": "",
            "startSceneId": "s1", "createdAt": "ISO-8601" },
  "scenes": [
    {
      "id": "s1",
      "name": "Frontend",                 // shown in the gallery sidebar
      "panorama": "images/front.jpg",     // local path OR full Azure URL
      "thumbnail": "",                     // optional; defaults to panorama
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

## Tech / versions

- Photo-Sphere-Viewer **5.11.5** + plugins (virtual-tour, markers, gallery)
- three **0.169.0** (matched to PSV's dependency)
- Vendored in `player-template/vendor/` — no runtime CDN. To upgrade, re-download
  matching files and keep `three` matched to PSV's dependency.
