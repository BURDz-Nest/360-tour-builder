# ATLAS Explore — Deploy & Team-Test Guide

ATLAS Explore (the 360-tour authoring tool) is served from this repo as
**static content**. Teammates open a URL, save tours to their **own disk**,
and nothing tour-related is ever stored on the server.

> **This is the `Dev/` stage of the three-stage `ATLAS-Explore/` pipeline**
> (`Dev → Staged → Prod` — see `../AGENTS.md`). This file's "live URL"
> describes what you'd get if `Dev/` itself is pushed to git for quick
> device/team testing — which is allowed, but is NOT the same as promoting.
> `Staged/` and `Prod/` each carry their own copy of this exact file with
> their own stage's URL swapped in — that's the one deliberate line that's
> expected to differ between otherwise-identical promoted copies.

> New here? Read `ARCHITECTURE.md` for how it works and `../AGENTS.md` for the
> dev → test → ship / promotion workflow. `README.md` has the local-launch
> quick start.

---

## Live URL (Dev stage)
```
https://gtl-webgl-host.dev.walmart.com/WebAppTools/ATLAS-Explore/Dev/builder/index.html
```
- Requires **Walmart VPN or Eagle WiFi**.
- Open in **Microsoft Edge or Google Chrome** — Safari/Firefox can't save to disk.

Deployment is automatic: **push to `main` → KITT builds → deploys to dev** in
~10–15 min. Verify with the build-number check in `../AGENTS.md`.

---

## How "hosted remotely, saved locally" works
- The app is *served* from WCNP, but `showDirectoryPicker()` runs **in the
  visitor's browser** and picks a folder on **their own computer**.
- The app writes `tour.json` + images straight into that local folder. **The
  server never receives or stores tour data.**
- "Preview in player" hands the in-progress tour to the player tab via
  `localStorage` + in-browser `blob:` URLs — no server round-trip.
- Each user gets a **one-time permission prompt** per folder per session.

---

## Team-test checklist
Smoke-test yourself first, then invite one teammate to repeat on their machine.
- [ ] URL loads over **https**; you see the **ATLAS Explore** welcome screen.
- [ ] **New project** (on the welcome screen) → folder picker appears → pick/allow
      a local folder. **Pick a plain local sub-folder** like `~/ATLAS-Explore/my-first-tour`, and
      **NOT** inside OneDrive/iCloud, nor Desktop/Documents/Downloads/drive-root
      (browsers block those; cloud-sync folders silently eat saves).
- [ ] **Images…** → drag in a 360 photo → it becomes a scene, preview renders.
- [ ] Add a Navigation hotspot + an Info hotspot; both show in the preview.
- [ ] Edit something → the top bar shows **"All changes saved"** (autosave), and
      **Save tour** confirms `tour.json` on disk. Undo/redo (**Undo** / **Redo** or Cmd/Ctrl+Z)
      steps your edits back and forth.
- [ ] **Preview in player** → player opens; image + hotspots work.
- [ ] **Home** (top bar) reopens the start screen; "Back to tour" returns you.
- [ ] Reopen the URL → **Recent projects** remembers the folder (re-allow when asked).
- [ ] A **second person** repeats it on their machine → saves to *their* disk.

---

## Message to send teammates
> **Try the 360-tour builder (no install!)**
> 1. Get on **VPN or Eagle WiFi**.
> 2. Open in **Edge or Chrome**:
>    `https://gtl-webgl-host.dev.walmart.com/WebAppTools/ATLAS-Explore/Dev/builder/index.html`
> 3. Click **New project**. When asked for a folder, first create a normal folder
>    like `ATLAS-Explore` in your home directory and pick a fresh sub-folder
>    inside it — **not** inside
>    OneDrive/iCloud, and not Desktop/Documents/Downloads. Click **Allow**.
> 4. Drop in a 360 photo, add hotspots. It **autosaves** to *your* PC (and
>    **Save tour** forces a write).
> 5. Ping me with any snags.

---

## Known limitations / expectations
- **No central library.** Tours live on each person's disk. To publish/share a
  finished tour, commit it somewhere (e.g. `ImmersiveLearningPlayground/`) the
  same way the l2o tour is published today.
- **"Recent projects" is per-URL** (browser IndexedDB, keyed to this exact
  origin). Keep everyone on one stable link.
- **Chromium only** (Edge/Chrome). This is by design — the save-to-disk API
  doesn't exist elsewhere. The builder shows a clear "use Edge" message if the
  API is missing.

---

## Feedback worth collecting
Did folder-save work for a second person? Any permission-prompt confusion? Load
speed of the vendored libs over the internal network (that ~1.3 MB `three.js` is
the heaviest asset)? That tells us whether to invest in a Windows launcher / PWA
/ central storage next.
