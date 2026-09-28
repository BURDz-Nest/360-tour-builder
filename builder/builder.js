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
} from "../player-template/js/tour-model.js?v=11";
// NOTE on cache: ES module imports use the URL as the cache key, so adding
// ?v= here forces a fresh fetch when builder-viewer.js changes. The parent
// <script src="builder.js?v=NN"> tag's version does NOT cascade to sibling
// imports. Bump the BUILDER_BUILD constant whenever a builder/*.js file ships
// behaviour-changing edits so users don't run stale modules from cache.
const BUILDER_BUILD = "73";
import { BuilderViewer } from "./builder-viewer.js?v=39";
import { renderMarkerRow } from "./marker-row.js?v=48";
import { createMarkerActions } from "./marker-actions.js?v=43";
import * as fs from "./fs-workspace.js?v=6";
import { createWorkspace } from "./workspace.js?v=7";
import { mountOverlays } from "./overlays.js?v=3";
import { createPreview } from "./preview.js?v=2";
import { createAssetResolver } from "./asset-resolver.js?v=2";
import { createSceneList } from "./scene-list.js?v=12";
import { createGroupActions } from "./group-actions.js?v=4";
import { duplicateScene, copyHotspots, openSceneCopyMenu } from "./scene-actions.js";
import { resolveInitialTheme, applyTheme, bindThemeToggle } from "./theme.js";
import { mountTabs } from "./tabs.js?v=1";
import { mountPanelResizers } from "./panel-resize.js?v=1";
import { bindDismissibleModal, bindDropdownMenu } from "./ui-dom.js?v=3";
import { createAutosave } from "./autosave.js?v=1";
import { createHistory } from "./history.js?v=1";
import { createScormExport } from "./scorm-export.js?v=2";
import { createTourIO } from "./builder-io.js?v=3";
import { mountQualityPicker } from "./image-quality.js?v=2";
import { bindMetaFields } from "./meta-bindings.js?v=1";
import { refreshLanguageSiblings, initLanguageChip } from "./language-manifest.js?v=1";

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
let viewer;
let resolver; // blob-URL asset resolver (reads images from the folder handle)
let preview;
let sceneList;
let groupActions;
let overlays;
let ws; // File System workspace (undefined on non-FS browsers)
let markerActions;
let autosave; // background tour.json persister (FS workspace mode only)
let history; // undo/redo snapshot stack
let io; // tour persistence / import / preview (builder-io.js)
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
    onZoneMove: (id, points) => markerActions.moveZone(id, points), // drag whole zone body
  });
  markerActions = createMarkerActions({
    state, viewer, $, toast, getScene, createMarker,
    refresh: renderMarkerList,
    highlight: highlightSelectedMarker,
  });
  resolver = createAssetResolver({ state, fs });
  preview = createPreview({ state, $, toast, getScene, viewer, resolver });
  // Tour I/O (save / import / preview). Uses late getters for history/autosave/
  // overlays because those are created further down in init().
  io = createTourIO({
    state, $, fs, toast, resolver, validateTour,
    renderAll, selectScene,
    getHistory: () => history,
    getAutosave: () => autosave,
    getOverlays: () => overlays,
  });
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
      // Per-bubble controls (pencil / gear / star / trash):
      onRenameScene: (id, name) => renameSceneById(id, name),
      onOpenSettings: (id) => openSceneSettings(id),
      onSetStart: (id) => setStartScene(id),
      onDeleteScene: (id) => deleteScene(id),
    },
  });
  groupActions = createGroupActions({
    state,
    refresh: renderSceneList,
    selectScene,
    toast,
  });
  bindThemeToggle($("btn-theme"), $("btn-theme-icon"));

  // Undo/redo: debounced snapshots of the whole tour. record() is called from
  // renderAll() (structural edits) and from broad input/pointer listeners
  // (field typing, marker drags) so no mutation site needs a manual hook.
  history = createHistory({
    snapshot: () => { try { return JSON.stringify(state.tour); } catch { return null; } },
    restore: applyRestoredTour,
    onChange: reflectHistoryButtons,
  });
  $("btn-undo").addEventListener("click", () => history.undo());
  $("btn-redo").addEventListener("click", () => history.redo());
  // Catch text/select edits and the tail end of drags (both mutate state.tour).
  document.addEventListener("input", () => history?.record());
  document.addEventListener("change", () => history?.record());
  document.addEventListener("pointerup", () => history?.record());
  document.addEventListener("keydown", (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta || e.key.toLowerCase() !== "z") return;
    // Let native undo win inside a text field the user is actively editing.
    const t = document.activeElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && !t.readOnly) return;
    e.preventDefault();
    if (e.shiftKey) history.redo(); else history.undo();
  });

  // Left-panel tabs: Scenes | Tour settings (remembers your last choice).
  mountTabs({
    pairs: [
      { tab: $("tab-scenes"), panel: $("panel-scenes") },
      { tab: $("tab-settings"), panel: $("panel-settings") },
    ],
    storageKey: "builder-left-tab",
  });

  // Drag-to-resize the left (scenes) + right (editor) columns; widths persist.
  mountPanelResizers();

  // Multi-language chip (Tour settings panel) — wired once; re-rendered on
  // tour load/focus (see below) by language-manifest.js.
  initLanguageChip($);

  // Meta inputs, display toggles, and guided-experience config — extracted to
  // meta-bindings.js (see that file's header) to keep this controller lean.
  bindMetaFields({ $, state, bindInput, ensureExperience, reflectExperience, renderMarkerList, applyShadowPref });

  // Image quality preset (authoring preference, persisted to localStorage).
  mountQualityPicker({ $, fs, toast });

  // Toolbar
  $("btn-new-group").addEventListener("click", () => groupActions.addGroup());
  $("btn-download").addEventListener("click", io.saveTour);
  $("btn-import").addEventListener("click", () => $("file-import").click());
  $("file-import").addEventListener("change", io.importTour);
  $("btn-preview").addEventListener("click", io.previewInPlayer);

  // Burger menu (Home / Add Images / Import). Items keep their own handlers
  // (wired elsewhere); this just toggles the dropdown and closes on pick.
  bindDropdownMenu($("btn-menu"), $("main-menu"));

  // Help & publishing modal (static content — always available).
  const helpModal = bindDismissibleModal($("help-modal"), $("help-modal-close"));
  $("btn-help").addEventListener("click", helpModal.open);

  // Export SCORM modal (the module wires its own dialog controls).
  const scormExport = createScormExport({ $, state, fs, serializeTour: io.serializeTour, toast });
  $("btn-export-scorm").addEventListener("click", async () => {
    const err = io.preExportCheck();
    if (err) return toast(err, true);
    await io.prepareThumbnails(); // bundle mode reads thumbs from disk
    scormExport.open();
  });

  // Workspace (File System Access - Chrome/Edge). Hide if unsupported.
  if (fs.fsSupported()) {
    // Autosave: created first so the workspace can reset its baseline on load.
    autosave = createAutosave({
      serializeTour: io.serializeTour,
      getDirHandle: () => state.dirHandle,
      saveJson: fs.saveTourJson,
      setStatus: io.setSaveStatus,
    });
    ws = createWorkspace({
      state, $, toast, getScene, validateTour,
      createEmptyTour, createScene,
      updateScene, renderAll, selectScene, updatePreview: preview.updatePreview,
      cancelPlacing: () => markerActions.cancelPlacing(),
      resolver,
      onTourLoaded: () => { autosave.markClean(); history.reset(); refreshLanguageSiblings(state, $); }, // fresh baselines on load
    });
    $("btn-add-images").addEventListener("click", () => $("file-images").click());
    $("file-images").addEventListener("change", (e) => ws.handleAddImages([...e.target.files]));
    $("btn-bind-folder").addEventListener("click", ws.bindFolder);
    $("btn-optimize").addEventListener("click", ws.handleOptimize); // now lives in Tour settings
    fs.setupDropZone($("image-panel"), ws.handleAddImages);

    // Welcome / Help / Images overlays (all dialog chrome lives in overlays.js).
    overlays = mountOverlays($, {
      onNew: ws.handleNewTour,
      onOpen: ws.handleOpenTour,
      onOpenRecent: ws.openRecent,
      onImport: () => $("file-import").click(),
      refreshImageGrid: ws.refreshImageGrid,
      setAssignMode: ws.setAssignMode,
      isTourLoaded: () => !!(state.dirHandle || state.tour.scenes.length),
    });
    // Topbar "Home" reopens the start screen; closeable because a tour is loaded.
    $("btn-home").addEventListener("click", () => overlays.showWelcome());
    overlays.showWelcome();
    autosave.start();
  } else {
    // No File System Access API (non-Chromium, or Chrome blocked by IT policy).
    // Fail LOUDLY: hide the folder toolbar and show a "use Edge" message rather
    // than leaving the user with an empty builder and silently dead buttons.
    $("menu-wrap").hidden = true;
    showUnsupportedBrowser();
  }

  // Scene editor
  bindInput("scene-name", (v) => updateScene({ name: v }, { relistScene: true }));
  bindInput("scene-caption", (v) => updateScene({ caption: v }));
  $("btn-capture-view").addEventListener("click", captureView);
  $("btn-duplicate-scene").addEventListener("click", duplicateCurrentScene);
  // Scene settings overlay (opened by a scene's gear icon).
  $("btn-scene-settings-back").addEventListener("click", closeSceneSettings);

  // Marker buttons (tabbed: Navigation | Info; Info splits into Icon vs Zone).
  $("btn-add-link").addEventListener("click", () => markerActions.beginPlacing(MARKER_TYPES.LINK));
  $("btn-add-info").addEventListener("click", () => markerActions.beginPlacing(MARKER_TYPES.INFO));
  $("btn-add-info-zone").addEventListener("click", () =>
    markerActions.beginPlacing(MARKER_TYPES.INFO, MARKER_SHAPES.ZONE)
  );
  $("btn-copy-hotspots").addEventListener("click", openCopyHotspotsMenu);

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
  history?.reset(); // baseline: the empty starting tour (nothing to undo yet)
  // No toast here: Welcome (shown above) always gates the screen on load.

  // Re-scan for language siblings when the author tabs back in (e.g. after
  // dropping a translated tour-es.json into the folder in Finder/Explorer).
  window.addEventListener("focus", () => {
    if (state.dirHandle) refreshLanguageSiblings(state, $);
  });
}

/**
 * Reveal the Welcome dialog in "unsupported browser" mode: swap its normal
 * new/open/recent content for a clear message pointing users to Edge. Called
 * when window.showDirectoryPicker is missing so the tool never appears "broken"
 * with dead buttons.
 */
function showUnsupportedBrowser() {
  const supported = $("welcome-supported");
  const unsupported = $("welcome-unsupported");
  if (supported) supported.hidden = true;
  if (unsupported) unsupported.hidden = false;
  $("welcome").hidden = false;
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
  renderSceneList();
  renderSceneEditor();
  preview.updatePreview();
}

/* ---- Scene settings overlay (left column; opened by a bubble's gear) ---- */
function openSceneSettings(id) {
  selectScene(id); // select first so the overlay's fields reflect this scene
  $("scene-settings-overlay").hidden = false;
}
function closeSceneSettings() {
  $("scene-settings-overlay").hidden = true;
}

/** Rename a scene by id (from the bubble's pencil) without changing selection. */
function renameSceneById(id, name) {
  const scene = getScene(state.tour, id);
  if (!scene) return;
  scene.name = name;
  if (id === state.currentSceneId) $("scene-name").value = name;
  renderSceneList();
  renderSceneEditor();
}

function deleteScene(sceneId) {
  const id = sceneId || state.currentSceneId;
  if (!id) return;
  if (!confirm("Delete this scene? Links pointing to it will be left dangling.")) return;
  state.tour.scenes = state.tour.scenes.filter((s) => s.id !== id);
  if (state.tour.meta.startSceneId === id) {
    state.tour.meta.startSceneId = state.tour.scenes[0]?.id || "";
  }
  if (state.currentSceneId === id) {
    state.currentSceneId = state.tour.scenes[0]?.id || null;
    closeSceneSettings(); // the scene we were editing is gone
    selectScene(state.currentSceneId);
  }
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

function setStartScene(sceneId) {
  const id = sceneId || state.currentSceneId;
  if (!id) return;
  state.tour.meta.startSceneId = id;
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
  $("meta-exp-welcome-title").value = exp.welcomeTitle || "";
  $("meta-exp-welcome-body").value = exp.welcomeBody || "";
  $("meta-exp-start-label").value = exp.startButtonLabel || "";
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

/** Put a tour snapshot (JSON string) back into state + re-render. For undo/redo. */
function applyRestoredTour(json) {
  let obj;
  try { obj = JSON.parse(json); } catch { return; }
  const { ok, tour } = validateTour(obj);
  state.tour = ok ? tour : obj;
  // Keep the current scene if it survived the undo; else fall back to the first.
  if (!getScene(state.tour, state.currentSceneId)) {
    state.currentSceneId = state.tour.scenes[0]?.id || null;
  }
  state.selectedMarkerId = null;
  viewer?.setSelectedMarker(null);
  markerActions?.cancelPlacing();
  renderAll();
  preview.updatePreview();
}

/** Enable/disable the toolbar undo/redo buttons from the history status. */
function reflectHistoryButtons({ canUndo = false, canRedo = false } = {}) {
  const u = $("btn-undo");
  const r = $("btn-redo");
  if (u) u.disabled = !canUndo;
  if (r) r.disabled = !canRedo;
}

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
  history?.record(); // debounced snapshot for undo/redo
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
