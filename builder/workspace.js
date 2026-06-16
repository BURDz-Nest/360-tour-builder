// workspace.js — File System Access workspace orchestration for the builder.
//
// Owns the "New tour / Open folder / add images / image grid / add-all-as-
// scenes" flows. Built as a factory that receives the bits of builder state +
// behaviour it needs (dependency injection), so the file-system UI lives in one
// cohesive place instead of bloating builder.js.

import * as fs from "./fs-workspace.js";

export function createWorkspace(ctx) {
  const {
    state, $, toast, getScene,
    createEmptyTour, createScene, createMarker, MARKER_TYPES,
    updateScene, renderAll, selectScene, loadCurrentPreview, cancelPlacing,
  } = ctx;

  /** Adopt a tour folder: remember handles, auto-set preview base, refresh grid. */
  function adoptWorkspace(dirHandle, name) {
    state.dirHandle = dirHandle;
    state.fileHandle = null; // we now save via the directory handle instead
    $("preview-base").value = `../tours/${fs.slugify(name)}/`;
    if (name && !state.tour.meta.title) {
      state.tour.meta.title = name;
      $("meta-title").value = name;
    }
    refreshImageGrid();
  }

  /** Clear all in-memory tour state (fresh slate for a new/opened folder). */
  function resetTour() {
    state.tour = createEmptyTour();
    state.currentSceneId = null;
    state.selectedMarkerId = null;
    cancelPlacing();
    renderAll();
  }

  async function handleNewTour() {
    const name = (prompt("Name your new tour (e.g. \u201cStore 1234 Frontend\u201d):") || "").trim();
    if (!name) return;
    try {
      toast("Creating tour folder + copying runtime\u2026");
      const { dirHandle } = await fs.newTour(name, (d, t) => toast(`Copying runtime ${d}/${t}\u2026`));
      resetTour();
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
      resetTour();
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
    const note = $("bind-folder-note");
    const panel = $("image-panel");
    // No folder bound yet (e.g. tour was imported) -> offer to link one.
    if (!state.dirHandle) {
      if (note) note.hidden = false;
      if (panel) panel.hidden = true;
      return;
    }
    if (note) note.hidden = true;
    if (panel) panel.hidden = false;
    try {
      const made = await fs.ensureThumbnails(state.dirHandle);
      if (made) toast(`Generated ${made} snapshot thumbnail(s).`);
    } catch (e) {
      console.warn("[workspace] ensureThumbnails failed", e);
    }
    const names = await fs.listImageNames(state.dirHandle);
    fs.renderImageGrid($("image-grid"), names, $("preview-base").value, assignImageToScene);
  }

  /** Link an EXISTING tour's folder without wiping the in-memory tour. */
  async function bindFolder() {
    try {
      const { dirHandle, name } = await fs.openTour();
      adoptWorkspace(dirHandle, name);
      toast(`Linked folder \u201c${name}\u201d \u2014 you can manage images now.`);
    } catch (e) {
      if (e.name === "AbortError") return;
      toast(e.message, true);
    }
  }

  /** Click a thumbnail -> set the current scene's panorama to that image. */
  function assignImageToScene(name) {
    const scene = getScene(state.tour, state.currentSceneId);
    if (!scene) return toast("Add or select a scene first, then click an image.", true);
    updateScene({ panorama: `images/${name}`, thumbnail: `images/thumbs/${fs.thumbName(name)}` });
    $("scene-panorama").value = `images/${name}`;
    loadCurrentPreview(scene);
    toast(`Scene \u201c${scene.name}\u201d now uses ${name}.`);
  }

  /** One click: a scene per image in the folder, auto-linked Next/Back. */
  async function addAllImagesAsScenes() {
    if (!state.dirHandle) return toast("Create or open a tour folder first.", true);
    const names = await fs.listImageNames(state.dirHandle);
    if (!names.length) return toast("No images in this tour yet \u2014 add some first.", true);
    const scenes = names.map((n, i) => {
      const s = createScene({ name: `Scene ${i + 1}`, panorama: `images/${n}` });
      s.thumbnail = `images/thumbs/${fs.thumbName(n)}`;
      return s;
    });
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

  return { handleNewTour, handleOpenTour, handleAddImages, addAllImagesAsScenes, bindFolder, refreshImageGrid };
}
