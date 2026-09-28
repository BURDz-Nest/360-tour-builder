# ATLAS Explore — Architecture

A dependency-free, build-step-free **static** web app for authoring and viewing
360° virtual tours. Two cooperating apps share one data model. No backend, no
bundler, no framework — just ES modules served as files.

> **Naming:** the product is branded **ATLAS Explore** (previously ATLAS 360,
> and originally Spherio). The deploy folder was renamed from `Spherio360Tours/`
> to `ATLAS-Explore/` in August 2026 to align with the current product name and
> the sibling `ATLAS-Coach/` convention.

---

## The two apps

```
ATLAS-Explore/  builder/           # ATLAS Explore authoring tool  (open builder/index.html)
  player-template/   # the read-only tour player runtime (MUST be a sibling)
  templates/         # copy-paste HTML snippets for info-hotspot content
  dev/               # LOCAL-ONLY dev server (gitignored — never deployed)
  DEPLOY-INSTRUCTIONS.md
  ARCHITECTURE.md    # this file
  AGENTS.md          # Code Puppy working guide
```

- **builder/** — where authors build tours: manage scenes/areas, place
  navigation + info hotspots on a live Photo-Sphere-Viewer, and save to disk.
- **player-template/** — the runtime that renders a finished `tour.json` for
  viewers. Also used for the builder's "Preview in player".

**Why they must stay siblings:** the builder imports the shared model, the PSV
adapter, and all vendored libs from `../player-template/…` via **relative
paths**, and "Preview in player" opens `../player-template/player.html`. Rename
or separate them and everything 404s. There are **no absolute (`/…`) paths**, so
the whole folder is portable and works under any base URL.

---

## The shared brain: `player-template/js/tour-model.js`

The single source of truth for the **`tour.json` schema** and all pure
data/logic (create/validate/normalize/lookup). It has **no DOM and no PSV
imports** — that's deliberate (SRP), so both apps import it and it stays
testable. If you change the tour shape, change it *here* and nowhere else.

### `tour.json` shape (schema version 2)
```jsonc
{
  "version": 2,
  "meta": {
    "title", "description", "author", "startSceneId", "createdAt",
    "showThumbnails", "showWaypointShadows", "showInfoZones", "showHotspotHints",
    "experience": { enabled, showStartScreen, allowSkipping,
                    completionTitle, completionMessage }   // guided mode (opt-in)
  },
  "groups": [ { "id", "name", "color", "entrySceneId" } ], // "areas" for big tours
  "scenes": [
    {
      "id", "name", "panorama", "thumbnail", "caption",
      "groupId",                                    // null = ungrouped
      "initialView": { "yaw", "pitch", "zoom" },    // yaw/pitch DEGREES, zoom 0-100
      "markers": [
        // ICON pin:
        { "id", "type": "link"|"info", "yaw", "pitch", "label", "icon",
          "targetSceneId"/*link*/, "html"/*info*/ },
        // INFO ZONE (polygon hotspot):
        { "id", "type": "info", "shape": "zone", "label", "html",
          "points": [{yaw,pitch}, …], "idleStroke", "hoverColor" }
      ]
    }
  ]
}
```
Key rules:
- **Angles are DEGREES** in storage; `psv-adapter.js` converts to the `"<n>deg"`
  strings Photo-Sphere-Viewer wants.
- **`validateTour()` repairs what it safely can** (defaults, dedup ids, dropped
  bad refs → warnings) and only errors on the unrecoverable (e.g. no scenes).
- **Back-compat:** v1 files (no `groups`/`groupId`) load fine — everything is
  "Ungrouped". Blank `icon` means "use the type's default".

---

## Data flow

### Saving (builder → disk)
`builder.js` holds in-memory `state.tour`. The **File System Access API**
(`fs-workspace.js`) writes `tour.json` + `images/` straight into the folder the
user picked. Recent folders are remembered as directory *handles* in **IndexedDB**
(`project-store.js`) so the Welcome screen's "Recent projects" can reopen them
(with a permission prompt).

- **Autosave** (`autosave.js`): a debounced dirty-check loop persists `tour.json`
  whenever the in-memory tour changes (and flushes on tab-hide). A top-bar
  "All changes saved" readout reflects status. Baseline is reset on load so a
  freshly-opened tour can't autosave a blank over the real file.
- **Write verification:** `fs-workspace.saveTourJson` reads the file back after
  writing and throws if the bytes don't match — this exposes cloud-sync folders
  (OneDrive/iCloud) that silently swallow File-System-Access writes. **Author in
  a plain local folder, not inside OneDrive/iCloud.**
- **Undo/redo** (`history.js`): whole-tour JSON snapshots on a debounce, driven
  by `renderAll()` + broad input/pointer listeners (no per-mutation hooks).
  Toolbar buttons + Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z (native undo wins inside a
  focused text field).

### Preview (builder → player, cross-tab)
"Preview in player" clones the tour, resolves each image path to a `blob:` URL
(`asset-resolver.js` reads files from the folder handle — works no matter where
the folder lives), stashes it in `localStorage["tour-preview-config"]`, and opens
`player.html?config=__preview__`. The player detects the `__preview__` sentinel
and loads from `localStorage` instead of fetching a file.

### Playing (player renders a tour)
`player.js`: parse `?config=` → fetch/validate JSON → `psv-adapter.toViewerNodes`
→ init PSV `Viewer` with VirtualTour + Markers (+ Gallery) plugins → wire info
popups, the Areas fast-travel menu, "reveal zones", and (lazily) guided mode.
Non-`__preview__` configs must be **same-origin** (image URLs inside may be
remote, but the config document must be local).

---

## Guided experience (opt-in linear mode)
A tour can turn on `meta.experience.enabled` to become a **guided, linear**
experience instead of free-roam. When on:
- All navigation pins are suppressed (`toViewerNodes({ guided:true })`); the
  learner advances only via the guided controller's **Continue** prompt.
- Each scene has **required** info hotspots; opening one marks it "found".
  Finding all required hotspots in a scene reveals Continue; the final scene
  shows **Finish** then the completion screen (author's `completionTitle` /
  `completionMessage`).
- The welcome/start screen's title, body, and Start button label are also
  author-editable content -- `welcomeTitle` (blank = auto-localized "Welcome
  to {tour title}", see below), `welcomeBody` (a tiny markdown dialect, see
  below), `startButtonLabel` -- edited in the same Tour settings panel as the
  completion fields. This matters for multi-language: they're ordinary tour
  content, so they translate for free when an author ships a
  `tour-<code>.json` sibling (see "Multi-language" below), no separate
  chrome-string plumbing needed.
- The blank-field FALLBACKS ("Welcome to {title}" / "Welcome!" / "Start")
  are themselves localized via `i18n.js#tFor(activeLanguage, key)` -- e.g. a
  Spanish sibling that leaves `welcomeTitle`/`startButtonLabel` blank still
  gets "Bienvenido a {title}" / "Comenzar" instead of silently leaking
  English boilerplate into an otherwise-translated screen. This is the ONE
  spot guided.js reaches into the free-roam player's i18n dictionary --
  `tFor()` takes an explicit language code rather than reading the module's
  `active` singleton, since guided.js tracks its own per-boot language
  independent of any header toggle. Author-set `welcomeTitle`/
  `startButtonLabel` always wins outright over this fallback. Both fields
  are deliberately left BLANK by `createExperience()`'s normalizer (never
  hard-defaulted to an English literal there) specifically so this fallback
  has an empty string to detect and localize -- an earlier version of
  `startButtonLabel` defaulted to the literal `"Start"` at normalize time,
  which silently defeated `tFor()` for every tour that didn't explicitly set
  it (guided.js only ever saw a non-empty string, never blank).
- `welcomeBody` supports exactly two formatting affordances, authored via a
  tiny toolbar above the textarea (`builder/meta-bindings.js`) and rendered
  by `guided.js#renderWelcomeBody`/`#appendFormatted`: lines starting with
  `"- "` render as an arrow-bullet list item (consecutive bullet lines group
  into one list; a blank line ends the run), everything else renders as a
  plain paragraph, and `**bold**` spans render as `<strong>` inside either.
  Deliberately NOT a general rich-text/WYSIWYG editor -- just enough to match
  what the welcome screen already needed. Built with real DOM nodes (never
  `innerHTML`), so authored/translated content can never inject markup.
- The controller (`js/guided.js`) is **lazy-loaded** -- normal tours never
  fetch a byte of it. It owns its own namespaced (`.guided-*`) DOM and talks to
  PSV only through the handles `player.js` passes in.

**Known scope cut:** guided tours don't have a persistent HEADER language
toggle like free-roam tours do -- instead, the guided **welcome screen**
itself grows a language DROPDOWN (top-right of the card, above the title)
only rendered when >1 language exists. It's the exact same reusable
component as the free-roam header toggle (`js/language-toggle.js`), just
restyled for a light card via `.guided-start__langhost` scoping in
`guided.css` -- so the interaction pattern matches everywhere in the app,
only the surrounding chrome differs. Picking a language fully tears down and
remounts `guided.js` (`player.js#bootTour` destroys the previous `guided`
controller via its `destroy()` before building a new one) against the new
language's tour, landing back on ITS OWN welcome screen at scene 1 with a
clean (empty) found-set -- so a language switch is always a full, clean
restart, never a half-translated mid-run swap. There's still no way to
change language ONCE a guided run has started (Start clicked) short of
reloading the page; that's intentional -- switching languages after a
learner has found hotspots would need to somehow re-render already-completed
progress in a language that wasn't loaded yet.

## Multi-language
A tour can ship translated content as sibling files living **next to**
`tour.json`: `tour-es.json`, `tour-fr.json`, etc. (two-letter-ish codes,
see `LANG_FILE_RE` in `fs-workspace.js`). `tour.json` itself always declares
which codes exist via a top-level `languages` array (`["en", ...]`), kept in
sync automatically -- authors never hand-edit it.

**Authoring flow:** translate `tour.json` -> `tour-es.json` (e.g. via a
Code Puppy agent), drop it in the same folder, reopen/refocus the builder.
The **Tour settings** panel's language chip re-scans the folder
(`builder/language-manifest.js` + `fs-workspace.js#listLanguageSiblings`) on
tour load and on `window.focus`, and shows a popover listing every variant.
There's no per-field translation UI -- the WHOLE sibling file is the unit of
translation, same as ATLAS Coach.

**Runtime:** if `languages` has more than one entry, `player.js` fetches
every sibling alongside the primary (`language-config.js#fetchAlternates`,
parallel, fail-open -- a broken/missing sibling just doesn't show up) and
mounts a dropdown toggle (`language-toggle.js`) in the header. Picking a
language rebuilds the PSV viewer against that tour's data while keeping the
current scene (`player.js#bootTour`/`switchLanguage`). A small chrome
dictionary (`i18n.js`) translates the handful of UI strings that survive a
switch (Info Zones button, Mark-complete button, Areas menu, info-popup
defaults) -- scene names/captions/marker text are tour CONTENT and come
straight from the translated JSON, no chrome plumbing needed.

**Guided tours** get language switching too, but on the **welcome screen**
rather than a persistent header toggle (see "Guided experience" above for
the full story) -- picking a language there is always a clean full restart,
never a mid-run swap. `guided.js`'s own chrome (Continue/Finish/Start over/
HUD text) is still hardcoded English regardless of language -- only the
welcome screen + completion screen + tour content translate today; treat the
rest as a known follow-up if it's needed.

**Preview + SCORM:** `builder-io.js#previewInPlayer()` stages every sibling
in `localStorage` (`tour-preview-config-<code>`) so "Preview in player"
behaves identically to the deployed player. `scorm-export.js` bundles every
`tour-<code>.json` as an ordinary loose file in the zip (re-scanned fresh at
export time) -- no inline `<script>` trick needed, since the SCORM package's
files all live at the same origin/root as `player.html` anyway.

## SCORM export & LMS completion
ATLAS Explore tours can be packaged as **SCORM 1.2** and uploaded to an LMS (Moodle)
to track learner completion. Nothing about the tour changes -- the SAME
`player.html` runs as a plain web tour, a builder preview, AND a SCORM SCO.

**Runtime glue -- `player-template/js/scorm-api.js`:**
- `createScorm()` walks the parent/opener window chain for the LMS `API` object
  and drives LMSInitialize -> LMSSetValue(cmi.core.lesson_status) -> LMSCommit
  -> LMSFinish. **No LMS found means every method is a silent no-op**, so
  non-LMS use is completely unaffected.
- `fitToLmsFrame()` stretches the SCO out of an LMS's centered, max-width
  content column (Moodle Boost gutters). Safe because the package is unzipped
  onto the LMS's own origin (same-origin with the parent page); fully defensive
  (no-op when top window, try/catch around all DOM access).

**Completion triggers (all funnel to one idempotent `scorm.complete()`):**
- **Guided mode:** clicking **Finish** on the last scene reports completion --
  *before* the completion screen appears, so the screen's button triggers
  nothing SCORM-related. In an LMS the button becomes "Close window" plus a
  "completion recorded" note (never "Start over").
- **Free-roam:** completes when every scene has been visited, OR via the manual
  **Mark complete** button (shown only when an LMS is present).

**Packaging -- `builder/scorm-export.js` + `builder/zip-writer.js`:**
The builder's **Export SCORM** button gathers the runtime (via
`player-template/manifest.json`), clones `tour.json`, generates a SCORM 1.2
`imsmanifest.xml`, and zips it with a hand-rolled, dependency-free ZIP writer
(STORE method -- keeps the no-CDN/no-build rule). Two image modes:
- **Bundle** -- images read from the tour folder and included in the zip
  (self-contained; watch the LMS size cap).
- **Remote** -- image paths rewritten to an absolute base URL (e.g. Azure
  Blob); images uploaded separately. **Remote images need CORS (GET/HEAD,
  allow the LMS origin) and HTTPS**, or WebGL textures fail.

## Vendored dependencies (no CDN, no build)
`player-template/vendor/` holds Photo-Sphere-Viewer v5.11.5, `three` 0.169.0,
and `qrcode-generator` 1.4.4 — committed as files so everything works behind
corporate proxies/CSP with zero build step. Both HTML files declare an ES-module
**importmap** pointing at these. Don't add runtime CDN calls.

`player-template/manifest.json` lists the runtime files the builder copies into a
new tour folder (so a saved tour is self-contained and portable).

---

## Cache-busting convention (IMPORTANT)
Because files are served raw with no hashing, we cache-bust with `?v=NN` query
tags. **ES-module import URLs are the cache key, and a parent's `?v=` does NOT
cascade to its imports** — so when you edit a module you must bump the `?v=` on
*every* import that points at it.

- `builder/index.html`: bump `builder.js?v=NN` + any changed `*.css?v=NN`.
- `builder/builder.js`: bump the `BUILDER_BUILD` constant (the DevTools
  breadcrumb) **and** the `?v=NN` on any sibling import you changed
  (e.g. `marker-row.js?v=NN`).
- `player-template/player.html`: bump `player.js?v=NN` + changed `css/*?v=NN`.
- Deeper chains too (e.g. `marker-row.js` imports `icon-picker.js?v=NN`).

See `AGENTS.md` for the exact "before you ship" checklist.

---

## Hard requirements & constraints
- **Chromium only** (Edge/Chrome) — the File System Access API doesn't exist in
  Safari/Firefox. The builder detects this and shows a "use Edge" message.
- **Secure context required** for save-to-disk: `https://…` **or**
  `http://localhost…`. That's why local dev works (`dev/launch.sh`) and the
  deployed https site works, but a plain-http hostname would not.
- **Static only.** Served by the Spring Boot app in this repo straight out of
  `src/main/resources/public/`. No server-side code touches tours.
- **Keep files < 600 lines**; follow SOLID/DRY/YAGNI. `builder.js` is
  intentionally lean — it's the controller (state + wiring + rendering), and
  feature logic lives in focused modules: `builder-viewer` (Photo-Sphere-Viewer
  wrapper + hotspot/zone authoring), `fs-workspace` (File System Access + tour
  create/open/save), `builder-io` (save/import/preview), `image-quality`
  (quality picker), `marker-actions`, `scene-actions`, `group-actions`,
  `workspace`, `overlays`, `panel-resize` (drag-resize the side columns),
  `autosave`, `history`, `scorm-export`, `zip-writer`, `asset-resolver`,
  `preview`, `scene-list`, `icon-picker`, `marker-row`, `tabs`, `theme`,
  `ui-dom`, `project-store`.
  > `builder.js` currently sits at ~599 lines — right at the ceiling. The next
  > feature that touches it should extract a cohesive chunk into a new module
  > rather than growing the controller past 600.
