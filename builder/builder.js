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
  getScene,
  validateTour,
  MARKER_TYPES,
} from "../player-template/js/tour-model.js";
// NOTE on cache: ES module imports use the URL as the cache key, so adding
// ?v= here forces a fresh fetch when builder-viewer.js changes. The parent
// <script src="builder.js?v=NN"> tag's version does NOT cascade to sibling
// imports. Bump the BUILDER_BUILD constant whenever a builder/*.js file ships
// behaviour-changing edits so users don't run stale modules from cache.
const BUILDER_BUILD = "33";
import { BuilderViewer } from "./builder-viewer.js?v=33";
import { renderMarkerRow } from "./marker-row.js";
import * as fs from "./fs-workspace.js";
import { createWorkspace } from "./workspace.js";
import { mountOverlays } from "./overlays.js";
import { createPreview } from "./preview.js";
import { createSceneList } from "./scene-list.js";
import { duplicateScene, copyHotspots, openSceneCopyMenu } from "./scene-actions.js";
import { resolveInitialTheme, applyTheme, bindThemeToggle } from "./theme.js";

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
let preview;
let sceneList;
let overlays;
let toastTimer; // declared up-front to avoid a TDZ error when init() toasts.

init();

function init() {
  // Loud breadcrumb so you can confirm in DevTools which build is actually
  // running. If you see an older number here after editing, the browser is
  // serving stale modules from cache - hard refresh (Cmd+Shift+R / Ctrl+F5).
  console.log(`[builder] init - BUILDER_BUILD ${BUILDER_BUILD}`);
  viewer = new BuilderViewer($("preview"), {
    onPlace: handlePlace,
    onMarkerClick: (id) => selectMarker(id),
    onMarkerMove: (id, yaw, pitch) => {
      updateMarker(id, { yaw, pitch });
      selectMarker(id); // surface the moved marker in the side panel
    },
  });
  preview = createPreview({ state, $, toast, getScene, viewer });
  sceneList = createSceneList({
    listEl: $("scene-list"),
    countEl: $("scene-count"),
    getTour: () => state.tour,
    getCurrentSceneId: () => state.currentSceneId,
    resolveThumbUrl: (p) => preview.resolvePreviewUrl(p),
    actions: {
      onSelect: selectScene,
      onMove: moveScene,
      onReorder: reorderScenes,
    },
  });
  bindThemeToggle($("btn-theme"), $("btn-theme-icon"));

  // Meta inputs
  bindInput("meta-title", (v) => (state.tour.meta.title = v));
  bindInput("meta-description", (v) => (state.tour.meta.description = v));
  bindInput("meta-author", (v) => (state.tour.meta.author = v));
  $("meta-show-thumbnails").addEventListener("change", (e) => {
    state.tour.meta.showThumbnails = e.target.checked;
  });
  $("meta-show-waypoint-shadows").addEventListener("change", (e) => {
    state.tour.meta.showWaypointShadows = e.target.checked;
    applyShadowPref();
  });

  // Image quality preset (authoring preference, persisted to localStorage —
  // it's about how you import images, not about a specific tour).
  populateQualityPicker();

  // Toolbar
  $("btn-add-scene").addEventListener("click", addScene);
  $("btn-download").addEventListener("click", saveTour);
  $("btn-import").addEventListener("click", () => $("file-import").click());
  $("file-import").addEventListener("change", importTour);
  $("btn-preview").addEventListener("click", previewInPlayer);

  // Help & publishing modal (static content — always available).
  $("btn-help").addEventListener("click", () => ($("help-modal").hidden = false));
  $("help-modal-close").addEventListener("click", () => ($("help-modal").hidden = true));
  $("help-modal").addEventListener("click", (e) => {
    if (e.target === $("help-modal")) $("help-modal").hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("help-modal").hidden) $("help-modal").hidden = true;
  });

  // Workspace (File System Access — Chrome/Edge). Hide if unsupported.
  if (fs.fsSupported()) {
    const ws = createWorkspace({
      state, $, toast, getScene, validateTour,
      createEmptyTour, createScene,
      updateScene, renderAll, selectScene, updatePreview: preview.updatePreview, cancelPlacing,
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

  // Marker buttons
  $("btn-add-link").addEventListener("click", () => beginPlacing(MARKER_TYPES.LINK));
  $("btn-add-info").addEventListener("click", () => beginPlacing(MARKER_TYPES.INFO));
  $("btn-copy-hotspots").addEventListener("click", openCopyHotspotsMenu);

  renderAll();
  preview.updatePreview();
  toast("New tour started. Add a scene to begin.");
}

/* ===================== Scenes ===================== */

function addScene() {
  const scene = createScene({ name: `Scene ${state.tour.scenes.length + 1}` });
  state.tour.scenes.push(scene);
  if (!state.tour.meta.startSceneId) state.tour.meta.startSceneId = scene.id;
  selectScene(scene.id);
  renderSceneList();
}

function selectScene(id) {
  state.currentSceneId = id;
  state.selectedMarkerId = null;
  viewer?.setSelectedMarker(null);
  cancelPlacing();
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

function moveScene(id, delta) {
  const i = state.tour.scenes.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= state.tour.scenes.length) return;
  const arr = state.tour.scenes;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  renderSceneList();
}

function updateScene(patch, opts = {}) {
  const scene = getScene(state.tour, state.currentSceneId);
  if (!scene) return;
  Object.assign(scene, patch);
  if (opts.relistScene) renderSceneList();
}

function captureView() {
  const scene = getScene(state.tour, state.currentSceneId);
  if (!scene) return;
  scene.initialView = viewer.getCurrentView();
  renderViewReadout(scene);
  toast("Saved this camera angle as the scene's default view.");
}

/* ===================== Markers ===================== */

function beginPlacing(type) {
  if (!state.currentSceneId) return toast("Select a scene first.", true);
  state.placing = { type };
  viewer.setPlaceMode(true);
  const label = type === MARKER_TYPES.LINK ? "navigation" : "info";
  $("place-hint").textContent = ` Click in the preview to drop a ${label} hotspot. (Esc to cancel)`;
  $("place-hint").hidden = false;
}

function cancelPlacing() {
  state.placing = null;
  viewer.setPlaceMode(false);
  $("place-hint").hidden = true;
}

function handlePlace(yaw, pitch) {
  if (!state.placing) return;
  const scene = getScene(state.tour, state.currentSceneId);
  if (!scene) return;

  if (state.placing.markerId) {
    const m = scene.markers.find((x) => x.id === state.placing.markerId);
    if (m) {
      m.yaw = yaw;
      m.pitch = pitch;
    }
  } else {
    const marker = createMarker({ type: state.placing.type, yaw, pitch });
    scene.markers.unshift(marker); // newest card on top of the list
    state.selectedMarkerId = marker.id;
  }
  cancelPlacing();
  viewer.renderMarkers(scene.markers);
  renderMarkerList();
}

function selectMarker(id) {
  state.selectedMarkerId = id;
  viewer?.setSelectedMarker(id);
  renderMarkerList();
}

function deleteMarker(id) {
  const scene = getScene(state.tour, state.currentSceneId);
  if (!scene) return;
  scene.markers = scene.markers.filter((m) => m.id !== id);
  if (state.selectedMarkerId === id) state.selectedMarkerId = null;
  viewer.renderMarkers(scene.markers);
  renderMarkerList();
}

function replaceMarker(id) {
  const scene = getScene(state.tour, state.currentSceneId);
  const m = scene?.markers.find((x) => x.id === id);
  if (!m) return;
  state.placing = { type: m.type, markerId: id };
  viewer.setPlaceMode(true);
  $("place-hint").textContent = " Click to reposition this hotspot. (Esc to cancel)";
  $("place-hint").hidden = false;
}

function updateMarker(id, patch) {
  const scene = getScene(state.tour, state.currentSceneId);
  const m = scene?.markers.find((x) => x.id === id);
  if (!m) return;
  Object.assign(m, patch);
  // Anything that changes how the pin looks on the sphere triggers a re-render.
  if ("label" in patch || "icon" in patch) viewer.renderMarkers(scene.markers);
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
  // Hand the in-progress tour to the player via localStorage (shared across
  // tabs, instant, and no flaky blob-URL fetching).
  try {
    localStorage.setItem("tour-preview-config", JSON.stringify(serializeTour()));
  } catch (e) {
    return toast(`Couldn't stage preview: ${e.message}`, true);
  }
  // Open the player that lives in the SAME folder as the images (the Preview
  // base), so relative panorama paths resolve. Fall back to the template
  // player when no base is set (only works with absolute/Azure image URLs).
  const base = (state.previewBase || "").trim();
  const playerUrl = base
    ? base.replace(/\/?$/, "/") + "player.html?config=__preview__"
    : "../player-template/player.html?config=__preview__";
  window.open(playerUrl, "_blank");
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

/* ===================== Rendering ===================== */

function renderAll() {
  $("meta-title").value = state.tour.meta.title;
  $("meta-description").value = state.tour.meta.description;
  $("meta-author").value = state.tour.meta.author;
  $("meta-show-thumbnails").checked = state.tour.meta.showThumbnails !== false;
  $("meta-show-waypoint-shadows").checked = state.tour.meta.showWaypointShadows !== false;
  applyShadowPref();
  renderSceneList();
  renderSceneEditor();
}

function renderSceneList() {
  sceneList.render();
}

/** Reorder scenes via drag-and-drop (keeps selection + start scene intact). */
function reorderScenes(from, to) {
  const scenes = state.tour.scenes;
  if (
    !Number.isInteger(from) || !Number.isInteger(to) || from === to ||
    from < 0 || to < 0 || from >= scenes.length || to >= scenes.length
  ) {
    return;
  }
  const [moved] = scenes.splice(from, 1);
  scenes.splice(to, 0, moved);
  renderSceneList();
}

function renderSceneEditor() {
  const scene = getScene(state.tour, state.currentSceneId);
  $("no-scene").hidden = !!scene;
  $("scene-editor").hidden = !scene;
  if (!scene) return;

  $("scene-name").value = scene.name;
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
  const list = $("marker-list");
  list.innerHTML = "";
  if (!scene) return;

  if (!scene.markers.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No hotspots yet. Add a navigation or info hotspot above.";
    list.append(empty);
    return;
  }

  scene.markers.forEach((m) =>
    list.append(
      renderMarkerRow({
        scene,
        marker: m,
        selectedMarkerId: state.selectedMarkerId,
        scenes: state.tour.scenes,
        actions: {
          onReplace: replaceMarker,
          onDelete: deleteMarker,
          onUpdate: updateMarker,
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
  if (e.key === "Escape" && state.placing) cancelPlacing();
});
