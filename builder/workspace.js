// workspace.js — File System Access workspace orchestration for the builder.
//
// Owns the "New tour / Open folder / add images / image grid / add-all-as-
// scenes" flows. Built as a factory that receives the bits of builder state +
// behaviour it needs (dependency injection), so the file-system UI lives in one
// cohesive place instead of bloating builder.js.

import * as fs from "./fs-workspace.js?v=2";
import { rememberProject } from "./project-store.js";

export function createWorkspace(ctx) {
  const {
    state, $, toast, getScene, validateTour,
    createEmptyTour, createScene,
    updateScene, renderAll, selectScene, updatePreview, cancelPlacing,
    resolver,
  } = ctx;

  // Image-modal mode. ASSIGN (default, opened via "Images…") = clicking a
  // thumbnail sets the CURRENT scene's panorama. Otherwise we're in "add to
  // group" mode (opened via a group's + Add scene): clicking / uploading images
  // creates NEW scenes in `imageTarget` (a group id, or null = Uncategorized).
  const ASSIGN = Symbol("assign");
  let imageTarget = ASSIGN;
  let originalHint;
  const inAddMode = () => imageTarget !== ASSIGN;
  function setAssignMode() { imageTarget = ASSIGN; }
  function setAddTarget(groupId) { imageTarget = groupId ?? null; }

  /** Adopt a tour folder: remember handles, auto-load tour.json, set preview
   *  base, refresh grid. Async because it reads the folder's tour.json. */
  async function adoptWorkspace(dirHandle, name) {
    state.dirHandle = dirHandle;
    state.fileHandle = null; // we now save via the directory handle instead
    state.previewBase = `../tours/${dirHandle.name}/`;
    // Pull in an existing tour.json if the folder already has one.
    try {
      const raw = await fs.readTourJson(dirHandle);
      if (raw) {
        const { ok, tour } = validateTour(raw);
        if (ok) {
          state.tour = tour;
          state.currentSceneId = tour.scenes[0]?.id || null;
        }
      }
    } catch (e) {
      toast(`Folder opened, but its tour.json looks invalid: ${e.message}`, true);
    }
    if (name && !state.tour.meta.title) state.tour.meta.title = name;
    renderAll();
    selectScene(state.currentSceneId); // null is fine — blanks viewer + shows empty message
    rememberProject(dirHandle.name, dirHandle);
    refreshImageGrid();
  }

  /** Clear all in-memory tour state (fresh slate for a new/opened folder). */
  function resetTour() {
    state.tour = createEmptyTour();
    state.currentSceneId = null;
    state.selectedMarkerId = null;
    cancelPlacing();
    renderAll();
    updatePreview(); // blank the viewfinder + show "Add images" message
  }

  async function handleNewTour() {
    const name = (prompt("Name your new tour (e.g. \u201cStore 1234 Frontend\u201d):") || "").trim();
    if (!name) return false;
    try {
      toast("Creating tour folder + copying runtime\u2026");
      const { dirHandle } = await fs.newTour(name, (d, t) => toast(`Copying runtime ${d}/${t}\u2026`));
      resetTour();
      await adoptWorkspace(dirHandle, name);
      toast(`Created \u201c${name}\u201d. Drag your 360 photos into the Images panel.`);
      return true;
    } catch (e) {
      if (e.name === "AbortError") return false;
      toast(e.message, true);
      return false;
    }
  }

  async function handleOpenTour() {
    try {
      const { dirHandle, name } = await fs.openTour();
      resetTour();
      await adoptWorkspace(dirHandle, name);
      toast(`Opened \u201c${name}\u201d.`);
      return true;
    } catch (e) {
      if (e.name === "AbortError") return false;
      toast(e.message, true);
      return false;
    }
  }

  /** Reopen a remembered project (from the Welcome recents list). */
  async function openRecent(project) {
    try {
      const granted = await fs.verifyPermission(project.dirHandle);
      if (!granted) {
        toast("Permission denied for that folder.", true);
        return false;
      }
      resetTour();
      await adoptWorkspace(project.dirHandle, project.name);
      toast(`Reopened \u201c${project.name}\u201d.`);
      return true;
    } catch (e) {
      toast(`Couldn't reopen \u201c${project.name}\u201d: ${e.message}`, true);
      return false;
    }
  }

  async function handleAddImages(files) {
    if (!state.dirHandle) return toast("Create or open a tour folder first.", true);
    try {
      const added = await fs.addImages(state.dirHandle, files);
      if (!added.length) return toast("No image files found to add.", true);
      resolver.invalidate(); // in case any filenames were replaced on disk
      const targetGroup = inAddMode() ? imageTarget : null;
      const { created, firstId } = appendScenesForImages(added, targetGroup);
      renderAll();
      if (firstId) selectScene(firstId);
      await refreshImageGrid();
      toast(`Added ${added.length} image(s) as ${created} new scene(s) at the bottom.`);
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
    updateModalChrome();
    const onClick = inAddMode()
      ? (name) => addImageAsScene(name, imageTarget)
      : assignImageToScene;
    fs.renderImageGrid($("image-grid"), names, (p) => resolver.resolve(p), onClick);
  }

  /** Re-title the images modal + swap its hint depending on the mode. */
  function updateModalChrome() {
    const title = $("image-modal-title");
    const hint = document.querySelector(".image-panel__hint");
    if (hint && originalHint === undefined) originalHint = hint.innerHTML;
    if (inAddMode()) {
      const g = (state.tour.groups || []).find((x) => x.id === imageTarget);
      const where = g ? `\u201c${g.name}\u201d` : "Uncategorized";
      if (title) title.textContent = `Add scenes to ${where}`;
      if (hint) hint.textContent =
        `Click an image (or use \u201cAdd images\u2026\u201d) to add it as a new scene in ${where}.`;
    } else {
      if (title) title.textContent = "Images";
      if (hint && originalHint !== undefined) hint.innerHTML = originalHint;
    }
  }

  /** Add-to-group mode: turn an existing folder image into a new scene. */
  function addImageAsScene(name, groupId) {
    const s = createScene({
      name: `Scene ${state.tour.scenes.length + 1}`,
      panorama: `images/${name}`,
      groupId: groupId ?? null,
    });
    s.thumbnail = `images/thumbs/${fs.thumbName(name)}`;
    state.tour.scenes.push(s);
    if (!state.tour.meta.startSceneId) state.tour.meta.startSceneId = s.id;
    renderAll();
    toast(`Added ${name} as a new scene.`); // modal stays open for multi-add
  }
  /** Re-encode every image in the folder at the current quality preset. */
  async function handleOptimize() {
    if (!state.dirHandle) return toast("Open or bind a tour folder first.", true);
    const p = fs.getQualityPreset();
    if (!confirm(
      `Re-encode every image in this tour at "${p.label}"\n` +
      `(max ${p.maxWidth}px, JPEG quality ${p.quality})?\n\n` +
      `This will overwrite existing files. Larger tours can take a minute.`
    )) return;
    try {
      toast("Optimizing images\u2026 this can take a moment.");
      const { optimized, renames } = await fs.optimizeFolder(state.dirHandle);
      resolver.invalidate(); // files were overwritten — drop stale blob URLs
      // Repoint any scenes whose image was renamed (e.g. .png -> .jpg).
      for (const s of state.tour.scenes) {
        const m = /^images\/(.+)$/.exec(s.panorama || "");
        if (m && renames[m[1]]) {
          s.panorama = `images/${renames[m[1]]}`;
          s.thumbnail = `images/thumbs/${fs.thumbName(renames[m[1]])}`;
        }
      }
      renderAll();
      await refreshImageGrid();
      toast(optimized
        ? `Re-encoded ${optimized} image(s) at "${p.label}".`
        : "No images found to optimize.");
    } catch (e) {
      toast(`Couldn't optimize: ${e.message}`, true);
    }
  }

  /** Link an EXISTING tour's folder without wiping the in-memory tour. */
  async function bindFolder() {
    try {
      const { dirHandle, name } = await fs.openTour();
      await adoptWorkspace(dirHandle, name);
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
    updatePreview();
    toast(`Scene \u201c${scene.name}\u201d now uses ${name}.`);
  }

  /** Image filenames already used as a scene's panorama ("images/<name>"). */
  function usedImageNames() {
    const used = new Set();
    for (const s of state.tour.scenes) {
      const m = /^images\/(.+)$/.exec(s.panorama || "");
      if (m) used.add(m[1]);
    }
    return used;
  }

  /** Append a new scene (at the bottom) for each image not already used. */
  function appendScenesForImages(names, groupId = null) {
    const used = usedImageNames();
    const fresh = names.filter((n) => !used.has(n));
    let firstId = null;
    fresh.forEach((n, i) => {
      const s = createScene({
        name: `Scene ${state.tour.scenes.length + 1}`,
        panorama: `images/${n}`,
        groupId: groupId ?? null,
      });
      s.thumbnail = `images/thumbs/${fs.thumbName(n)}`;
      state.tour.scenes.push(s);
      if (i === 0) firstId = s.id;
    });
    if (fresh.length && !state.tour.meta.startSceneId) {
      state.tour.meta.startSceneId = state.tour.scenes[0].id;
    }
    return { created: fresh.length, firstId };
  }

  /** Create scenes for any folder images that aren't used yet (non-destructive). */
  async function addAllImagesAsScenes() {
    if (!state.dirHandle) return toast("Create or open a tour folder first.", true);
    const names = await fs.listImageNames(state.dirHandle);
    if (!names.length) return toast("No images in this tour yet \u2014 add some first.", true);
    const { created, firstId } = appendScenesForImages(names, inAddMode() ? imageTarget : null);
    if (!created) return toast("All images are already used by scenes.");
    renderAll();
    if (firstId) selectScene(firstId);
    toast(`Created ${created} new scene(s) from images.`);
  }

  return {
    handleNewTour, handleOpenTour, openRecent, handleAddImages,
    addAllImagesAsScenes, bindFolder, refreshImageGrid, handleOptimize,
    setAssignMode, setAddTarget, hasFolder: () => !!state.dirHandle,
  };
}
