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
import { BuilderViewer } from "./builder-viewer.js";
import { miniBtn, labeledInput, labeledTextarea } from "./ui-dom.js";
import * as fs from "./fs-workspace.js";

const state = {
  tour: createEmptyTour(),
  currentSceneId: null,
  selectedMarkerId: null,
  placing: null, // null | { type, markerId? }
  fileHandle: null, // File System Access handle for one-click re-saving
  dirHandle: null, // tour folder handle (FS workspace mode)
};

const $ = (id) => document.getElementById(id);
let viewer;
let toastTimer; // declared up-front to avoid a TDZ error when init() toasts.

init();

function init() {
  viewer = new BuilderViewer($("preview"), {
    onPlace: handlePlace,
    onMarkerClick: (id) => selectMarker(id),
  });

  // Meta inputs
  bindInput("meta-title", (v) => (state.tour.meta.title = v));
  bindInput("meta-description", (v) => (state.tour.meta.description = v));
  bindInput("meta-author", (v) => (state.tour.meta.author = v));

  // Preview base path (authoring-only; reload current scene when it changes)
  $("preview-base").addEventListener("input", () => {
    const scene = getScene(state.tour, state.currentSceneId);
    if (scene) loadCurrentPreview(scene);
  });

  // Toolbar
  $("btn-add-scene").addEventListener("click", addScene);
  $("btn-download").addEventListener("click", saveTour);
  $("btn-import").addEventListener("click", () => $("file-import").click());
  $("file-import").addEventListener("change", importTour);
  $("btn-preview").addEventListener("click", previewInPlayer);

  // Workspace (File System Access — Chrome/Edge). Hide if unsupported.
  if (fs.fsSupported()) {
    $("btn-new-tour").addEventListener("click", handleNewTour);
    $("btn-open-tour").addEventListener("click", handleOpenTour);
    $("btn-add-images").addEventListener("click", () => $("file-images").click());
    $("file-images").addEventListener("change", (e) => handleAddImages([...e.target.files]));
    $("btn-add-all-scenes").addEventListener("click", addAllImagesAsScenes);
    fs.setupDropZone($("image-panel"), handleAddImages);
  } else {
    $("workspace-bar").hidden = true;
    $("image-panel-wrap").hidden = true;
  }

  // Scene editor
  bindInput("scene-name", (v) => updateScene({ name: v }, { relistScene: true }));
  bindInput("scene-panorama", (v) => updateScene({ panorama: v }, { reloadPreview: true }));
  bindInput("scene-thumbnail", (v) => updateScene({ thumbnail: v }));
  bindInput("scene-caption", (v) => updateScene({ caption: v }));
  $("btn-capture-view").addEventListener("click", captureView);
  $("btn-set-start").addEventListener("click", setStartScene);
  $("btn-delete-scene").addEventListener("click", deleteScene);

  // Marker buttons
  $("btn-add-link").addEventListener("click", () => beginPlacing(MARKER_TYPES.LINK));
  $("btn-add-info").addEventListener("click", () => beginPlacing(MARKER_TYPES.INFO));

  renderAll();
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

/**
 * Resolve a panorama path for the LIVE PREVIEW only. Absolute URLs (http,
 * data, blob) and root-relative paths pass through untouched. Relative paths
 * get the "Preview image base" prepended so the builder (served from /builder/)
 * can find images that live in /tours/<name>/. This base is never written to
 * tour.json — the saved paths stay clean and portable.
 */
function resolvePreviewUrl(path) {
  if (!path) return "";
  if (/^(https?:|data:|blob:|\/)/i.test(path)) return path;
  const base = ($("preview-base")?.value || "").trim();
  if (!base) return path;
  return base.replace(/\/?$/, "/") + path.replace(/^\.?\//, "");
}

/** Load a scene into the preview viewer using the resolved preview URL. */
function loadCurrentPreview(scene) {
  viewer
    .loadScene(scene, resolvePreviewUrl(scene.panorama))
    .catch(() => toast("Couldn't load that panorama URL (check the path / preview base).", true));
}

function selectScene(id) {
  state.currentSceneId = id;
  state.selectedMarkerId = null;
  cancelPlacing();
  const scene = getScene(state.tour, id);
  renderSceneList();
  renderSceneEditor();
  if (scene) loadCurrentPreview(scene);
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
  if (opts.reloadPreview) {
    viewer.loadScene(scene, resolvePreviewUrl(scene.panorama)).catch(() =>
      toast("Couldn't load that panorama URL.", true)
    );
  }
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
    scene.markers.push(marker);
    state.selectedMarkerId = marker.id;
  }
  cancelPlacing();
  viewer.renderMarkers(scene.markers);
  renderMarkerList();
}

function selectMarker(id) {
  state.selectedMarkerId = id;
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
  if ("label" in patch) viewer.renderMarkers(scene.markers);
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

function previewInPlayer() {
  const err = preExportCheck();
  if (err) return toast(err, true);
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
  const base = ($("preview-base")?.value || "").trim();
  const playerUrl = base
    ? base.replace(/\/?$/, "/") + "player.html?config=__preview__"
    : "../player-template/player.html?config=__preview__";
  window.open(playerUrl, "_blank");
}

// ---- Workspace (File System Access) handlers --------------------------------

/** Adopt a tour folder: remember handles, auto-set preview base, refresh grid. */
function adoptWorkspace(dirHandle, name) {
  state.dirHandle = dirHandle;
  state.fileHandle = null; // we now save via the directory handle instead
  // Tours live under tours/<slug>/; the running server serves them there.
  $("preview-base").value = `../tours/${fs.slugify(name)}/`;
  if (name && !state.tour.meta.title) {
    state.tour.meta.title = name;
    $("meta-title").value = name;
  }
  refreshImageGrid();
}

async function handleNewTour() {
  const name = (prompt("Name your new tour (e.g. \u201cStore 1234 Frontend\u201d):") || "").trim();
  if (!name) return;
  try {
    toast("Creating tour folder + copying runtime\u2026");
    const { dirHandle } = await fs.newTour(name, (d, t) =>
      toast(`Copying runtime ${d}/${t}\u2026`)
    );
    adoptWorkspace(dirHandle, name);
    toast(`Created \u201c${name}\u201d. Drag your 360 photos into the Images panel.`);
  } catch (e) {
    if (e.name === "AbortError") return;
    toast(e.message, true);
  }
}

async function handleOpenTour() {
  try {
    const { dirHandle, name } = await fs.openTour();
    adoptWorkspace(dirHandle, name);
    toast(`Opened \u201c${name}\u201d. Import its tour.json if you have one.`);
  } catch (e) {
    if (e.name === "AbortError") return;
    toast(e.message, true);
  }
}

async function handleAddImages(files) {
  if (!state.dirHandle) return toast("Create or open a tour folder first.", true);
  try {
    const added = await fs.addImages(state.dirHandle, files);
    if (!added.length) return toast("No image files found to add.", true);
    await refreshImageGrid();
    toast(`Added ${added.length} image(s). Click a thumbnail to use it in a scene.`);
  } catch (e) {
    toast(`Couldn't add images: ${e.message}`, true);
  }
}

async function refreshImageGrid() {
  if (!state.dirHandle) return;
  const names = await fs.listImageNames(state.dirHandle);
  $("image-panel-wrap").hidden = false;
  fs.renderImageGrid($("image-grid"), names, $("preview-base").value, assignImageToScene);
}

/** Click a thumbnail -> set the current scene's panorama to that image. */
function assignImageToScene(name) {
  const scene = getScene(state.tour, state.currentSceneId);
  if (!scene) return toast("Add or select a scene first, then click an image.", true);
  updateScene({ panorama: `images/${name}` });
  $("scene-panorama").value = `images/${name}`;
  loadCurrentPreview(scene);
  toast(`Scene \u201c${scene.name}\u201d now uses ${name}.`);
}

/** One click: a scene per image in the folder, auto-linked Next/Back. */
async function addAllImagesAsScenes() {
  if (!state.dirHandle) return toast("Create or open a tour folder first.", true);
  const names = await fs.listImageNames(state.dirHandle);
  if (!names.length) return toast("No images in this tour yet \u2014 add some first.", true);
  const scenes = names.map((n, i) =>
    createScene({ name: `Scene ${i + 1}`, panorama: `images/${n}` })
  );
  // Auto-link sequentially.
  scenes.forEach((s, i) => {
    if (i < scenes.length - 1)
      s.markers.push(createMarker({ type: MARKER_TYPES.LINK, yaw: 90, label: "Next", targetSceneId: scenes[i + 1].id }));
    if (i > 0)
      s.markers.push(createMarker({ type: MARKER_TYPES.LINK, yaw: -90, label: "Back", targetSceneId: scenes[i - 1].id }));
  });
  state.tour.scenes = scenes;
  state.tour.meta.startSceneId = scenes[0].id;
  state.currentSceneId = scenes[0].id;
  renderAll();
  selectScene(scenes[0].id);
  toast(`Created ${scenes.length} auto-linked scenes. Tweak names + nudge hotspots, then Save.`);
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
  renderSceneList();
  renderSceneEditor();
}

function renderSceneList() {
  const list = $("scene-list");
  list.innerHTML = "";
  $("scene-count").textContent = String(state.tour.scenes.length);

  state.tour.scenes.forEach((scene, idx) => {
    const li = document.createElement("li");
    li.className = "scene-item" + (scene.id === state.currentSceneId ? " is-active" : "");

    const isStart = scene.id === state.tour.meta.startSceneId;
    const name = document.createElement("button");
    name.type = "button";
    name.className = "scene-item__name";
    name.textContent = (isStart ? "[start] " : "") + (scene.name || "(unnamed)");
    name.addEventListener("click", () => selectScene(scene.id));

    const up = miniBtn("Up", "Move up", () => moveScene(scene.id, -1), idx === 0);
    const down = miniBtn("Down", "Move down", () => moveScene(scene.id, 1), idx === state.tour.scenes.length - 1);

    const controls = document.createElement("span");
    controls.className = "scene-item__controls";
    controls.append(up, down);

    li.append(name, controls);
    list.append(li);
  });
}

function renderSceneEditor() {
  const scene = getScene(state.tour, state.currentSceneId);
  $("no-scene").hidden = !!scene;
  $("scene-editor").hidden = !scene;
  if (!scene) return;

  $("scene-name").value = scene.name;
  $("scene-panorama").value = scene.panorama;
  $("scene-thumbnail").value = scene.thumbnail;
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

  scene.markers.forEach((m) => list.append(renderMarkerRow(scene, m)));
}

function renderMarkerRow(scene, m) {
  const row = document.createElement("div");
  row.className = "marker-row" + (m.id === state.selectedMarkerId ? " is-selected" : "");

  const head = document.createElement("div");
  head.className = "marker-row__head";
  const badge = document.createElement("span");
  badge.className = `marker-badge marker-badge--${m.type}`;
  badge.textContent = m.type === MARKER_TYPES.LINK ? "Navigation" : "Info";
  head.append(badge);
  head.append(miniBtn("Move", "Re-place on sphere", () => replaceMarker(m.id)));
  head.append(miniBtn("Delete", "Delete hotspot", () => deleteMarker(m.id)));

  const label = labeledInput("Label", m.label, (v) => updateMarker(m.id, { label: v }));

  row.append(head, label);

  if (m.type === MARKER_TYPES.LINK) {
    row.append(linkTargetSelect(scene, m));
  } else {
    row.append(
      labeledTextarea("Info content (HTML allowed)", m.html, (v) =>
        updateMarker(m.id, { html: v })
      )
    );
  }

  const pos = document.createElement("p");
  pos.className = "marker-row__pos muted";
  pos.textContent = `Position: yaw ${m.yaw}° · pitch ${m.pitch}°`;
  row.append(pos);
  return row;
}

function linkTargetSelect(scene, m) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  wrap.innerHTML = "<span class='field__label'>Go to scene</span>";
  const select = document.createElement("select");
  select.className = "field__input";
  const blank = new Option("— choose target —", "");
  select.append(blank);
  state.tour.scenes
    .filter((s) => s.id !== scene.id)
    .forEach((s) => select.append(new Option(s.name || s.id, s.id)));
  select.value = m.targetSceneId || "";
  select.addEventListener("change", () => updateMarker(m.id, { targetSceneId: select.value }));
  wrap.append(select);
  return wrap;
}

/* ===================== Small DOM helpers ===================== */

function bindInput(id, onInput) {
  $(id).addEventListener("input", (e) => onInput(e.target.value));
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
