# 360 Virtual Tour Builder

A **zero-backend** toolkit for building interactive 360 virtual tours that run
on static hosting (GitHub Pages, Azure Static Web Apps, any plain web server).
Built on [Photo-Sphere-Viewer](https://photo-sphere-viewer.js.org/) (WebGL).

| File | Role | Where it runs |
|------|------|----------------|
| `index.html` | **Builder** dashboard — author scenes, drop hotspots, export `tour.json` | Locally on your machine |
| `player.html` | **Player** — reads `?config=<url>`, fetches it, renders the tour | Shipped to GitHub Pages |
| `tour.json` | The tour config you export from the builder | Next to `player.html` |
| 360 images | Your equirectangular `.jpg` panoramas | **External URLs** (e.g. Azure Blob) or in the repo |

The builder, player, schema, and PSV-mapping code are split so each piece does
one job (and the schema lives in exactly one place — `js/tour-model.js`).

---

## Quick start (local)

You can't just double-click the HTML — ES modules need to be served over HTTP.

```bash
# from this folder:
python3 -m http.server 8123
```

- **Builder:** http://localhost:8123/index.html
- **Sample tour:** http://localhost:8123/player.html?config=examples/tour.json
- **Default player:** http://localhost:8123/player.html  (loads `tour.json` at the root)

### Authoring a tour
1. Open the **builder**, fill in the tour title.
2. **+ Add scene**, paste a panorama URL (your Azure Blob URL).
3. Drag to look around; **Capture current view** to set the scene's default angle.
4. **+ Navigation** then click in the preview to drop a hotspot that jumps to
   another scene. **+ Info** drops a clickable info popup.
5. Repeat for all scenes; pick a **start scene**.
6. **Preview in player** to test, then **Download tour.json**.
7. Ship `player.html`, the `css/` + `js/` folders, and `tour.json` to your host.

> The builder also **imports** an existing `tour.json` so you can keep editing.

---

## Hosting on GitHub Pages

Commit `player.html`, `css/`, `js/`, and your `tour.json` (the builder
`index.html` is optional — it's an authoring tool, not part of the experience).

Share a link like:

```
https://<org>.github.io/<repo>/player.html?config=tour.json
https://<org>.github.io/<repo>/player.html?config=tours/store-1234.json
```

You can host **many** tours from one deployment — just point `?config=` at
different JSON files. The player only accepts **same-origin** config URLs (the
config file must live on the same site as the player); the big image URLs inside
it can still be remote (Azure).

---

## Putting 360 images on Azure Blob Storage

The player fetches images **cross-origin**, so the browser enforces CORS. Two things to set up:

### 1. Make the blobs reachable
Either set the container access level to **Blob (anonymous read)**, or generate
**SAS** URLs. (This toolkit just stores whatever URL you paste — start with
public-read for simplicity; see the security note below.)

### 2. Add a CORS rule (required)
Azure Portal → Storage account → **Settings → Resource sharing (CORS)** →
**Blob service** tab:

| Field | Value |
|-------|-------|
| Allowed origins | `https://<org>.github.io` (or `*` while testing) |
| Allowed methods | `GET, HEAD` |
| Allowed headers | `*` |
| Exposed headers | `*` |
| Max age | `3600` |

Or via CLI:

```bash
az storage cors add --services b --methods GET HEAD \
  --origins "https://<org>.github.io" --allowed-headers "*" \
  --exposed-headers "*" --max-age 3600 \
  --account-name <account>
```

Without a CORS rule the panoramas will fail to load with a CORS error in the console.

> **Tip:** equirectangular JPGs are big (2-8 MB each). Resize to ~4096x2048 or
> 6144x3072 for a good quality/size balance. Hosting images on Azure keeps your
> GitHub repo small and avoids Pages' bandwidth limits.

---

## SECURITY & data classification — read before you publish

These 360 photos may show store / DC / facility interiors. Depending on the
content, that can reveal floor layouts, cash office locations, exits, restricted
areas, or camera positions.

- **Public-read blobs + public GitHub Pages = anyone on the internet** who has
  (or guesses) the URL can view the images and the tour. There is no login.
- **Before publishing sensitive interiors**, confirm the data classification
  with your leadership and Information Security / data-governance contacts.
- Prefer **internal GitHub Enterprise Pages** + access-controlled storage for
  anything non-public.
- **Never** commit SAS tokens, connection strings, or `.env` files (the
  `.gitignore` already blocks the common ones).

This tool is storage-agnostic: it only records the URLs you give it. **You** own
the hosting and access decisions.

---

## tour.json schema (version 1)

```jsonc
{
  "version": 1,
  "meta": {
    "title": "Store 1234 Tour",
    "description": "",
    "author": "",
    "startSceneId": "frontend",   // which scene opens first
    "createdAt": "ISO-8601"
  },
  "scenes": [
    {
      "id": "frontend",
      "name": "Frontend",                 // shown in the gallery sidebar
      "panorama": "https://.../front.jpg", // equirectangular image URL
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
The schema validator repairs what it safely can and logs warnings to the console.

---

## Accessibility

- Keyboard panning is enabled (`arrow keys`) in both builder and player.
- Info popups are a focusable, Esc-closable dialog.
- Non-WebGL devices get a friendly fallback message.
- Add meaningful `caption` text per scene and `label`/`html` on markers so the
  tour conveys information beyond the visuals.

Note: immersive WebGL is inherently visual. For full inclusivity, pair tours
with a text/transcript description of each area where possible.

---

## Tech / versions

- Photo-Sphere-Viewer **5.11.5** + plugins (virtual-tour, markers, gallery)
- three **0.169.0** (matched to PSV's dependency)
- Loaded via an ES-module **import map** from jsDelivr — no build step, no npm install.

To pin different versions, update the `<script type="importmap">` and the CSS
`<link>` tags in both `index.html` and `player.html` together.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Blank viewer, CORS error in console | Missing/incorrect Azure CORS rule |
| "Couldn't load the tour config" | Wrong `?config=` path, or config is cross-origin |
| Image 403 | Blob isn't public / SAS token expired |
| Nothing loads when double-clicking the file | Must be served over HTTP, not `file://` |
| Hotspot in wrong spot | Re-place it in the builder; yaw/pitch are in degrees |
