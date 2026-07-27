/**
 * builder.js — controller for the local tour-authoring dashboard.
 *
 * Responsibilities: hold tour state, render the meta/scene/marker UI, wire
 * user actions, place hotspots via the live preview, and export/import
 * tour.json. PSV specifics live in BuilderViewer (SRP).
 */

import {
  createEmptyTour,
  createScene,
  createMarker,
  createExperience,
  getScene,
  validateTour,
  MARKER_TYPES,
  MARKER_SHAPES,
} from "../player-template/js/tour-model.js?v=7";
// NOTE on cache: ES module imports use the URL as the cache key, so adding
// ?v= here forces a fresh fetch when builder-viewer.js changes. The parent
// <script src="builder.js?v=NN"> tag's version does NOT cascade to sibling
// imports. Bump the BUILDER_BUILD constant whenever a builder/*.js file ships
// behaviour-changing edits so users don't run stale modules from cache.
const BUILDER_BUILD = "60";
import { BuilderViewer } from "./builder-viewer.js?v=39";
import { renderMarkerRow } from "./marker-row.js?v=47";
import { createMarkerActions } from "./marker-actions.js?v=43";
import * as fs from "./fs-workspace.js?v=3";
import { createWorkspace } from "./workspace.js?v=4";
import { mountOverlays } from "./overlays.js?v=2";
import { createPreview } from "./preview.js?v=2";
import { createAssetResolver } from "./asset-resolver.js?v=1";
import { createSceneList } from "./scene-list.js?v=9";
import { createGroupActions } from "./group-actions.js?v=4";
import { duplicateScene, copyHotspots, openSceneCopyMenu } from "./scene-actions.js";
import { resolveInitialTheme, applyTheme, bindThemeToggle } from "./theme.js";
import { mountTabs } from "./tabs.js?v=1";
import { bindDismissibleModal } from "./ui-dom.js?v=2";

// Apply theme BEFORE first paint to avoid the flash-of-light-mode dance.
applyTheme(resolveInitialTheme());

const state = {
  tour: createEmptyTour(),
  currentSceneId: null,
  selectedMarkerId: null,
  placing: null, // null | { type, markerId? }
  fileHandle: null, // File System Access handle for one-click re-saving
  dirHandle: null, // tour folder handle (FS workspace mode)
  previewBase: "", // authoring-only base for resolving relative image paths
};

const $ = (id) => document.getElementById(id);
const QUALITY_STORAGE_KEY = "tour-builder.imageQualityPreset";
let viewer;
let resolver; // blob-URL asset resolver (reads images from the folder handle)
let preview;
let sceneList;
let groupActions;
let overlays;
let ws; // File System workspace (undefined on non-FS browsers)
let markerActions;
let editorTabs; // top-level right-panel tabs (Scene settings | Hotspots)
let toastTimer; // declared up-front to avoid a TDZ error when init() toasts.

init();

function init() {
  // Build breadcrumb: if DevTools shows an old number, hard-refresh (stale cache).
  console.log(`[builder] init - BUILDER_BUILD ${BUILDER_BUILD}`);
  viewer = new BuilderViewer($("preview"), {
    onPlace: (yaw, pitch) => markerActions.handlePlace(yaw, pitch),
    onMarkerClick: (id) => markerActions.selectMarker(id),
    onMarkerMove: (id, yaw, pitch) => {
      markerActions.updateMarker(id, { yaw, pitch });
      markerActions.selectMarker(id); // surface the moved marker in the side panel
    },
    onMarkerDeselect: () => markerActions.selectMarker(null), // click empty -> deselect
    onZoneCornerMove: (id, idx, yaw, pitch) => markerActions.moveZoneCorner(id, idx, yaw, pitch),
    onZoneMove: (id, points) => {
      markerActions.moveZone(id, points);
      markerActions.selectMarker(id); // keep it selected + surfaced in the panel
    },
  });
  markerActions = createMarkerActions({
    state, viewer, $, toast, getScene, createMarker,
    refresh: renderMarkerList,
    highlight: highlightSelectedMarker,
  });
  resolver = createAssetResolver({ state, fs });
  preview = createPreview({ state, $, toast, getScene, viewer, resolver });
  sceneList = createSceneList({
    listEl: $("scene-list"),
    countEl: $("scene-count"),
    getTour: () => state.tour,
    getCurrentSceneId: () => state.currentSceneId,
    resolveThumbUrl: (p) => preview.resolvePreviewUrl(p),
    actions: {
      onSelect: selectScene,
      onAddScene: (groupId) => addSceneToGroup(groupId),
      onAddGroup: () => groupActions.addGroup(),
      onRenameGroup: (id, name) => groupActions.renameGroup(id, name),
      onDeleteGroup: (id) => groupActions.deleteGroup(id),
      onSetColor: (id, color) => groupActions.setGroupColor(id, color),
      onMoveToGroup: (sid, gid, before) => groupActions.moveSceneToGroup(sid, gid, before),
      onSetEntry: (gid, sid) => groupActions.setGroupEntry(gid, sid),
    },
  });
  groupActions = createGroupActions({
    state,
    refresh: renderSceneList,
    selectScene,
    toast,
  });
  bindThemeToggle($("btn-theme"), $("btn-theme-icon"));

  // Left-panel tabs: Scenes | Tour settings (remembers your last choice).
  mountTabs({
    pairs: [
      { tab: $("tab-scenes"), panel: $("panel-scenes") },
      { tab: $("tab-settings"), panel: $("panel-settings") },
    ],
    storageKey: "builder-left-tab",
  });

  // Meta inputs
  bindInput("meta-title", (v) => (state.tour.meta.title = v));
  bindInput("meta-description", (v) => (state.tour.meta.description = v));
  bindInput("meta-author", (v) => (state.tour.meta.author = v));
  $("meta-show-thumbnails").addEventListener("change", (e) => (state.tour.meta.showThumbnails = e.target.checked));
  $("meta-show-waypoint-shadows").addEventListener("change", (e) => {
    state.tour.meta.showWaypointShadows = e.target.checked;
    applyShadowPref();
  });
  $("meta-show-info-zones").addEventListener("change", (e) => (state.tour.meta.showInfoZones = e.target.checked));
  $("meta-show-hints").addEventListener("change", (e) => (state.tour.meta.showHotspotHints = e.target.checked));

  // Guided experience (opt-in linear mode).
  $("meta-exp-enabled").addEventListener("change", (e) => {
    ensureExperience();
    state.tour.meta.experience.enabled = e.target.checked;
    reflectExperience();
    renderMarkerList(); // "required" checkboxes appear/disappear with the mode
  });
  $("meta-exp-startscreen").addEventListener("change", (e) => { ensureExperience(); state.tour.meta.experience.showStartScreen = e.target.checked; });
  $("meta-exp-skipping").addEventListener("change", (e) => { ensureExperience(); state.tour.meta.experience.allowSkipping = e.target.checked; });
  bindInput("meta-exp-title", (v) => { ensureExperience(); state.tour.meta.experience.completionTitle = v; });
  bindInput("meta-exp-message", (v) => { ensureExperience(); state.tour.meta.experience.completionMessage = v; });

  // Image quality preset (authoring preference, persisted to localStorage).
  populateQualityPicker();

  // Toolbar
  $("btn-new-group").addEventListener("click", () => groupActions.addGroup());
  $("btn-download").addEventListener("click", saveTour);
  $("btn-import").addEventListener("click", () => $("file-import").click());
  $("file-import").addEventListener("change", importTour);
  $("btn-preview").addEventListener("click", previewInPlayer);

  // Help & publishing modal (static content — always available).
  const helpModal = bindDismissibleModal($("help-modal"), $("help-modal-close"));
  $("btn-help").addEventListener("click", helpModal.open);

  // Workspace (File System Access — Chrome/Edge). Hide if unsupported.
  if (fs.fsSupported()) {
    ws = createWorkspace({
      state, $, toast, getScene, validateTour,
      createEmptyTour, createScene,
      updateScene, renderAll, selectScene, updatePreview: preview.updatePreview,
      cancelPlacing: () => markerActions.cancelPlacing(),
      resolver,
    });
    // Topbar shortcuts (same actions as the Welcome screen).
    $("btn-new-tour").addEventListener("click", ws.handleNewTour);
    $("btn-open-tour").addEventListener("click", ws.handleOpenTour);
    $("btn-add-images").addEventListener("click", () => $("file-images").click());
    $("file-images").addEventListener("change", (e) => ws.handleAddImages([...e.target.files]));
    $("btn-add-all-scenes").addEventListener("click", async () => {
      await ws.addAllImagesAsScenes();
      overlays.closeImageModal();
    });
    $("btn-bind-folder").addEventListener("click", ws.bindFolder);
    $("btn-optimize").addEventListener("click", ws.handleOptimize);
    fs.setupDropZone($("image-panel"), ws.handleAddImages);

    // Welcome / Help / Images overlays (all dialog chrome lives in overlays.js).
    overlays = mountOverlays($, {
      onNew: ws.handleNewTour,
      onOpen: ws.handleOpenTour,
      onOpenRecent: ws.openRecent,
      onImport: () => $("file-import").click(),
      refreshImageGrid: ws.refreshImageGrid,
      setAssignMode: ws.setAssignMode,
    });
    overlays.showWelcome();
  } else {
    $("workspace-bar").hidden = true;
  }

  // Scene editor
  bindInput("scene-name", (v) => updateScene({ name: v }, { relistScene: true }));
  bindInput("scene-caption", (v) => updateScene({ caption: v }));
  $("btn-capture-view").addEventListener("click", captureView);
  $("btn-set-start").addEventListener("click", setStartScene);
  $("btn-duplicate-scene").addEventListener("click", duplicateCurrentScene);
  $("btn-delete-scene").addEventListener("click", deleteScene);

  // Marker buttons (tabbed: Navigation | Info; Info splits into Icon vs Zone).
  $("btn-add-link").addEventListener("click", () => markerActions.beginPlacing(MARKER_TYPES.LINK));
  $("btn-add-info").addEventListener("click", () => markerActions.beginPlacing(MARKER_TYPES.INFO));
  $("btn-add-info-zone").addEventListener("click", () =>
    markerActions.beginPlacing(MARKER_TYPES.INFO, MARKER_SHAPES.ZONE)
  );
  $("btn-copy-hotspots").addEventListener("click", openCopyHotspotsMenu);

  // Top-level editor tabs (Scene settings | Hotspots). No storageKey: we want
  // selecting a scene to always land on Scene settings (see selectScene).
  editorTabs = mountTabs({
    pairs: [
      { tab: $("tab-scene-settings"), panel: $("panel-scene-settings") },
      { tab: $("tab-scene-hotspots"), panel: $("panel-scene-hotspots") },
    ],
  });

  // Hotspots sub-tabs (Navigation | Info), styled like the left-panel tabs.
  mountTabs({
    pairs: [
      { tab: $("tab-hs-nav"), panel: $("panel-hs-nav") },
      { tab: $("tab-hs-info"), panel: $("panel-hs-info") },
    ],
    storageKey: "builder-hotspot-tab",
  });

  renderAll();
  preview.updatePreview();
  toast("New tour started. Add a scene to begin.");
}

/* ===================== Scenes ===================== */

/**
 * A group's "+ Add scene": open the images picker targeted at that group so the
 * author picks/uploads images (Panoee-style). Falls back to a blank scene on
 * non-FS browsers or when no folder is bound yet (nothing to pick from).
 */
function addSceneToGroup(groupId) {
  if (ws && ws.hasFolder()) {
    ws.setAddTarget(groupId);
    overlays.openImageModal();
  } else {
    groupActions.addSceneToGroup(groupId);
  }
}

function selectScene(id) {
  state.currentSceneId = id;
  state.selectedMarkerId = null;
  viewer?.setSelectedMarker(null);
  markerActions?.cancelPlacing();
  editorTabs?.show("tab-scene-settings"); // always land on settings for a new scene
  renderSceneList();
  renderSceneEditor();
  preview.updatePreview();
}

function deleteScene() {
  const id = state.currentSceneId;
  if (!id) return;
  if (!confirm("Delete this scene? Links pointing to it will be left dangling.")) return;
  state.tour.scenes = state.tour.scenes.filter((s) => s.id !== id);
  if (state.tour.meta.startSceneId === id) {
    state.tour.meta.startSceneId = state.tour.scenes[0]?.id || "";
  }
  state.currentSceneId = state.tour.scenes[0]?.id || null;
  selectScene(state.currentSceneId);
  renderSceneList();
}

/**
 * Clone the current scene and place the copy right after it. Marker target
 * ids are preserved (you probably want the same nav layout in the copy).
 */
function duplicateCurrentScene() {
  const src = getScene(state.tour, state.currentSceneId);
  if (!src) return;
  const copy = duplicateScene(state.tour, src);
  selectScene(copy.id);
  toast(`Duplicated \u201c${src.name}\u201d \u2014 edit the copy as needed.`);
}

/** Show the scene-picker popover; selected scene's hotspots append onto current. */
function openCopyHotspotsMenu() {
  const current = getScene(state.tour, state.currentSceneId);
  if (!current) return;
  openSceneCopyMenu({
    anchor: $("btn-copy-hotspots"),
    scenes: state.tour.scenes,
    current,
    onEmpty: (msg) => toast(msg),
    onPick: (source) => {
      const n = copyHotspots(current, source);
      renderAll();
      selectScene(current.id);
      toast(`Copied ${n} hotspot${n === 1 ? "" : "s"} from \u201c${source.name}\u201d.`);
    },
  });
}

function setStartScene() {
  if (!state.currentSceneId) return;
  state.tour.meta.startSceneId = state.currentSceneId;
  renderSceneList();
  renderSceneEditor();
  toast("Set as the starting scene.");
}

function updateScene(patch, opts = {}) {
  const scene = getScene(state.tour, state.currentSceneId);
  if (!scene) return;
  Object.assign(scene, patch);
  if ("name" in patch) {
    $("editor-scene-title").textContent = scene.name || "(unnamed scene)";
  }
  if (opts.relistScene) renderSceneList();
}

function captureView() {
  const scene = getScene(state.tour, state.currentSceneId);
  if (!scene) return;
  scene.initialView = viewer.getCurrentView();
  renderViewReadout(scene);
  toast("Saved this camera angle as the scene's default view.");
}

/* ===================== Import / Export ===================== */

/**
 * Save tour.json. Prefers the File System Access API (Chrome/Edge) so it writes
 * straight into the tour's folder (e.g. tours/<name>/tour.json) and remembers
 * the location for one-click re-saves. Falls back to a classic download.
 */
async function saveTour() {
  const err = preExportCheck();
  if (err) return toast(err, true);
  await prepareThumbnails();
  const json = JSON.stringify(serializeTour(), null, 2);

  // Workspace mode: write straight into the bound tour folder, no dialog.
  if (state.dirHandle) {
    try {
      await fs.saveTourJson(state.dirHandle, json);
      return toast("Saved tour.json into your tour folder.");
    } catch (e) {
      toast(`Couldn't save to folder: ${e.message}`, true);
      // fall through to picker/download as a backup
    }
  }

  if (window.showSaveFilePicker) {
    try {
      if (!state.fileHandle) {
        state.fileHandle = await window.showSaveFilePicker({
          suggestedName: "tour.json",
          types: [{ description: "Tour config", accept: { "application/json": [".json"] } }],
        });
      }
      const writable = await state.fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      return toast(`Saved ${state.fileHandle.name} into your tour folder.`);
    } catch (e) {
      if (e.name === "AbortError") return; // user cancelled the picker
      console.warn("[builder] FS save failed; falling back to download", e);
    }
  }

  // Fallback: classic download to ~/Downloads.
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tour.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Downloaded tour.json. Move it into your tour folder next to player.html.");
}

async function previewInPlayer() {
  const err = preExportCheck();
  if (err) return toast(err, true);
  // Generate snapshot files AND point each scene at its thumbnail BEFORE we
  // stage the preview — awaited so we never open the player before the thumbs
  // exist (that race caused broken-image icons).
  await prepareThumbnails();
  // Build a preview config whose image paths are resolved to blob: URLs read
  // straight from the tour folder. This makes preview work no matter WHERE the
  // folder lives (even outside the repo) and lets us always open the repo's
  // template player, which is guaranteed to be served + same-origin. We clone
  // first so the real tour keeps its portable relative paths.
  let config;
  try {
    config = JSON.parse(JSON.stringify(serializeTour()));
    for (const s of config.scenes || []) {
      if (s.panorama) s.panorama = await resolver.resolve(s.panorama);
      if (s.thumbnail) s.thumbnail = await resolver.resolve(s.thumbnail);
    }
    localStorage.setItem("tour-preview-config", JSON.stringify(config));
  } catch (e) {
    return toast(`Couldn't stage preview: ${e.message}`, true);
  }
  // Always open the repo's template player (served by the dev server + same
  // origin, so the blob: image URLs created above are reachable). Cache-bust so
  // fresh ?v= pins for player.js/css are always picked up.
  const bust = `&_=${Date.now()}`;
  window.open("../player-template/player.html?config=__preview__" + bust, "_blank");
}

async function importTour(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const { ok, tour, errors, warnings } = validateTour(JSON.parse(text));
    if (!ok) throw new Error(errors.join("; "));
    state.tour = tour;
    state.currentSceneId = tour.scenes[0]?.id || null;
    state.selectedMarkerId = null;
    state.fileHandle = null; // imported a different file; next Save asks where
    renderAll();
    selectScene(state.currentSceneId);
    overlays?.hideWelcome();
    toast(` Loaded "${tour.meta.title}".${warnings.length ? ` (${warnings.length} warning(s) — see console)` : ""}`);
    warnings.forEach((w) => console.warn("[import]", w));
  } catch (err) {
    toast(` Import failed: ${err.message}`, true);
  } finally {
    e.target.value = "";
  }
}

function serializeTour() {
  // Return a clean copy; meta.createdAt refreshed on export.
  return {
    ...state.tour,
    meta: { ...state.tour.meta, createdAt: new Date().toISOString() },
  };
}

/**
 * Make sure snapshot thumbnails exist on disk AND that every local-image scene
 * references one. Backfills `thumbnail` for scenes whose panorama is a local
 * "images/<file>" path (covers old tours that predate the thumbnail feature).
 */
async function prepareThumbnails() {
  if (state.dirHandle) {
    try {
      await fs.ensureThumbnails(state.dirHandle);
    } catch (e) {
      console.warn("[builder] ensureThumbnails failed", e);
    }
  }
  for (const s of state.tour.scenes) {
    if (s.thumbnail) continue;
    const m = /^images\/(.+)$/.exec(s.panorama || "");
    if (m) s.thumbnail = `images/thumbs/${fs.thumbName(m[1])}`;
  }
}

function preExportCheck() {
  if (!state.tour.scenes.length) return "Add at least one scene first.";
  const missing = state.tour.scenes.filter((s) => !s.panorama);
  if (missing.length) return `${missing.length} scene(s) are missing a panorama URL.`;
  return null;
}

/* ---- Guided experience helpers ---- */

// Lazily ensure meta.experience exists (older in-memory tours may predate it).
function ensureExperience() {
  if (!state.tour.meta.experience) state.tour.meta.experience = createExperience();
  return state.tour.meta.experience;
}

// Push meta.experience into the settings inputs + show/hide the config block.
function reflectExperience() {
  const exp = ensureExperience();
  $("meta-exp-enabled").checked = !!exp.enabled;
  $("meta-exp-startscreen").checked = exp.showStartScreen !== false;
  $("meta-exp-skipping").checked = !!exp.allowSkipping;
  $("meta-exp-title").value = exp.completionTitle || "";
  $("meta-exp-message").value = exp.completionMessage || "";
  $("exp-config").hidden = !exp.enabled;
}

// True when the tour is in guided-authoring mode (drives required checkboxes).
function guidedMode() {
  return !!state.tour.meta.experience?.enabled;
}

/* ===================== Rendering ===================== */

function renderAll() {
  $("meta-title").value = state.tour.meta.title;
  $("meta-description").value = state.tour.meta.description;
  $("meta-author").value = state.tour.meta.author;
  $("meta-show-thumbnails").checked = state.tour.meta.showThumbnails !== false;
  $("meta-show-waypoint-shadows").checked = state.tour.meta.showWaypointShadows !== false;
  $("meta-show-info-zones").checked = state.tour.meta.showInfoZones !== false;
  $("meta-show-hints").checked = state.tour.meta.showHotspotHints === true;
  reflectExperience();
  applyShadowPref();
  renderSceneList();
  renderSceneEditor();
}

function renderSceneList() {
  sceneList.render();
}

function renderSceneEditor() {
  const scene = getScene(state.tour, state.currentSceneId);
  $("no-scene").hidden = !!scene;
  $("scene-editor").hidden = !scene;
  if (!scene) return;

  $("scene-name").value = scene.name;
  $("editor-scene-title").textContent = scene.name || "(unnamed scene)";
  $("scene-panorama").value = scene.panorama || "";
  $("scene-caption").value = scene.caption;
  $("start-badge").hidden = scene.id !== state.tour.meta.startSceneId;
  renderViewReadout(scene);
  renderMarkerList();
}

function renderViewReadout(scene) {
  const v = scene.initialView;
  $("view-readout").textContent = `yaw ${v.yaw}° · pitch ${v.pitch}° · zoom ${v.zoom}`;
}

function renderMarkerList() {
  const scene = getScene(state.tour, state.currentSceneId);
  const navList = $("marker-list-nav");
  const infoList = $("marker-list-info");
  navList.innerHTML = "";
  infoList.innerHTML = "";
  if (!scene) return;

  const nav = scene.markers.filter((m) => m.type === MARKER_TYPES.LINK);
  const info = scene.markers.filter((m) => m.type === MARKER_TYPES.INFO);
  fillMarkerList(navList, nav, scene, "No navigation hotspots yet.");
  fillMarkerList(infoList, info, scene, "No info hotspots or zones yet.");
}

/** Cheap re-highlight of the selected card (no DOM rebuild -> keeps input focus).
 * Used by selectMarker so clicking/focusing a card doesn't nuke what you type. */
function highlightSelectedMarker() {
  document.querySelectorAll("#marker-list-nav .marker-row, #marker-list-info .marker-row")
    .forEach((el) => {
      const on = el.dataset.markerId === state.selectedMarkerId;
      el.classList.toggle("is-selected", on);
      el.querySelector(".marker-row__summary")
        ?.setAttribute("aria-expanded", on ? "true" : "false");
      if (on) el.scrollIntoView({ block: "nearest" });
    });
}

/** Render one filtered set of marker cards into a container (or an empty note). */
function fillMarkerList(container, markers, scene, emptyMsg) {
  if (!markers.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = emptyMsg;
    container.append(empty);
    return;
  }
  markers.forEach((m) =>
    container.append(
      renderMarkerRow({
        scene,
        marker: m,
        selectedMarkerId: state.selectedMarkerId,
        scenes: state.tour.scenes,
        guided: guidedMode(), // show the "required to find" toggle in guided mode
        actions: {
          onReplace: (id) => markerActions.replaceMarker(id),
          onDelete: (id) => markerActions.deleteMarker(id),
          onUpdate: (id, patch) => markerActions.updateMarker(id, patch),
          onSelect: (id) => markerActions.selectMarker(id),
          onToggle: (id) => markerActions.toggleMarker(id),
        },
      })
    )
  );
}

/* ===================== Small DOM helpers ===================== */

function bindInput(id, onInput) {
  $(id).addEventListener("input", (e) => onInput(e.target.value));
}

/** Toggle the floating-shadow CSS on the preview viewport based on meta pref. */
function applyShadowPref() {
  const on = state.tour.meta.showWaypointShadows !== false;
  $("preview").classList.toggle("tour-shadows-off", !on);
}

/** Build the quality dropdown options from fs.QUALITY_PRESETS and restore
 *  the user's saved choice (or the registry default). Persists on change. */
function populateQualityPicker() {
  const sel = $("image-quality");
  if (!sel) return; // workspace-bar hidden (browser without FS API) — no-op
  sel.innerHTML = "";
  for (const [key, preset] of Object.entries(fs.QUALITY_PRESETS)) {
    const opt = new Option(preset.label, key);
    sel.append(opt);
  }
  const saved = localStorage.getItem(QUALITY_STORAGE_KEY);
  if (saved && fs.setQualityPreset(saved)) {
    sel.value = saved;
  } else {
    sel.value = fs.getQualityPreset().key;
  }
  sel.addEventListener("change", () => {
    if (fs.setQualityPreset(sel.value)) {
      localStorage.setItem(QUALITY_STORAGE_KEY, sel.value);
      const p = fs.getQualityPreset();
      toast(`Image quality set to "${p.label}" (${p.maxWidth}px, q=${p.quality}).`);
    }
  });
}

function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = "toast is-visible" + (isError ? " is-error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), 4000);
}

// Global Esc cancels placing mode.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.placing) markerActions.cancelPlacing();
});
