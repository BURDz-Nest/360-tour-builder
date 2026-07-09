# Deploying a tour

Each `tours/<name>/` folder is a complete, self-contained static site. You can
host it on GitHub Pages, Azure Static Web Apps, or any plain web server. The
**builder** (`builder/`) is a local authoring tool and does **not** get deployed.

---

## Option 1 — GitHub Pages (one repo per tour)

```bash
cd tours/sams-office
git init && git add . && git commit -m "Sam's Office 360 tour"
# create an empty repo (internal GitHub Enterprise recommended — see SECURITY.md)
git remote add origin <your-repo-url>
git push -u origin main
```

Then enable **Pages** on the repo (Settings → Pages → deploy from `main` / root).
Share:

```
https://<org>.github.io/<repo>/player.html?config=tour.json
```

### Hosting many tours from one repo
Prefer one site with many tours? Put each tour under a `tours/` path in a single
repo and link with different configs:

```
https://<org>.github.io/<repo>/tours/sams-office/player.html?config=tour.json
https://<org>.github.io/<repo>/tours/backroom/player.html?config=tour.json
```

(The player only accepts **same-origin** config files; image URLs inside may be
remote/Azure.)

---

## Option 2 — Images on Azure Blob Storage (keep repos tiny)

Instead of bundling images in `tours/<name>/images/`, host them on Azure and put
their full URLs in `tour.json`'s `panorama` fields. Two steps:

### 1. Make the blobs reachable
Set the container access level to **Blob (anonymous read)**, or generate **SAS**
URLs. (Start with public-read for simplicity; weigh the tradeoffs in SECURITY.md.)

### 2. Add a CORS rule (required — the browser fetches images cross-origin)
Azure Portal → Storage account → **Settings → Resource sharing (CORS)** → **Blob service**:

| Field | Value |
|-------|-------|
| Allowed origins | `https://<org>.github.io` (or `*` while testing) |
| Allowed methods | `GET, HEAD` |
| Allowed headers | `*` |
| Exposed headers | `*` |
| Max age | `3600` |

CLI equivalent:

```bash
az storage cors add --services b --methods GET HEAD \
  --origins "https://<org>.github.io" --allowed-headers "*" \
  --exposed-headers "*" --max-age 3600 \
  --account-name <account>
```

Without a CORS rule, panoramas fail to load with a CORS error in the console.

---

## Image tips

- The builder re-encodes on import at the chosen **Image quality** preset. The
  default is **Original (no resize)** — full camera resolution, sharpest text.
  Pick a smaller preset (Web/Balanced 4096px, High 6144px, Maximum 8192px) to
  downscale for smaller files or GPU-safety on locked-down VDI. Optimize can
  only shrink, never sharpen — keep your originals.
- `./scripts/resize-360.sh` is the CLI alternative for batch-processing raw 360s
  outside the builder.
- The aspect ratio must be **2:1** (equirectangular).

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Spinner never stops, JS file never requested in server log | Malformed `<script>` tag in player.html |
| Blank viewer + CORS error | Missing/incorrect Azure CORS rule |
| "Couldn't load the tour config" | Wrong `?config=` path, or config is cross-origin |
| Image 403 | Blob not public / SAS token expired |
| Nothing loads on double-click | Must be served over HTTP, not `file://` |
| Panorama black on some machines | Image wider than the GPU's max texture; resize smaller |
