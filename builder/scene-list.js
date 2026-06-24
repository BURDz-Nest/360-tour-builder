/**
 * scene-list.js - renders the left-rail scene list with thumbnails,
 * marker-count badges, drag-to-reorder, and up/down controls.
 *
 * Pure factory taking a small `actions` bag plus a `resolveThumbUrl` callback
 * (we don't want this module to know about preview.js or previewBase).
 *
 * Returns { render } - call render() any time the tour or selection changes.
 */

import { miniBtn } from "./ui-dom.js";

/**
 * @param {object} cfg
 * @param {HTMLElement} cfg.listEl     the <ul> to fill
 * @param {HTMLElement} cfg.countEl    element whose textContent becomes "N"
 * @param {() => object} cfg.getTour   returns current tour (to read scenes/meta)
 * @param {() => string|null} cfg.getCurrentSceneId
 * @param {(path: string) => string} cfg.resolveThumbUrl  scene.thumbnail -> URL
 * @param {object} cfg.actions    { onSelect, onMove(id, delta), onReorder(from, to) }
 */
export function createSceneList({
  listEl, countEl, getTour, getCurrentSceneId, resolveThumbUrl, actions,
}) {
  function render() {
    const tour = getTour();
    const currentId = getCurrentSceneId();
    listEl.innerHTML = "";
    countEl.textContent = String(tour.scenes.length);

    tour.scenes.forEach((scene, idx) => {
      listEl.append(renderRow(scene, idx, tour, currentId));
    });
  }

  function renderRow(scene, idx, tour, currentId) {
    const li = document.createElement("li");
    li.className = "scene-item" + (scene.id === currentId ? " is-active" : "");
    wireDrag(li, idx);

    const handle = document.createElement("span");
    handle.className = "scene-item__handle";
    handle.setAttribute("aria-hidden", "true");
    handle.title = "Drag to reorder";
    handle.textContent = "\u2630"; // grip glyph

    li.append(handle, renderThumb(scene), renderBody(scene, tour), renderControls(scene, idx, tour));
    return li;
  }

  function renderThumb(scene) {
    const thumb = document.createElement("span");
    thumb.className = "scene-item__thumb";
    thumb.setAttribute("aria-hidden", "true");
    if (scene.thumbnail) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = resolveThumbUrl(scene.thumbnail);
      img.addEventListener("error", () => thumb.classList.add("is-broken"));
      thumb.append(img);
    } else {
      thumb.classList.add("is-empty");
    }
    return thumb;
  }

  function renderBody(scene, tour) {
    const isStart = scene.id === tour.meta.startSceneId;
    const body = document.createElement("button");
    body.type = "button";
    body.className = "scene-item__body";

    const nameLine = document.createElement("span");
    nameLine.className = "scene-item__name";
    nameLine.textContent = (isStart ? "[start] " : "") + (scene.name || "(unnamed)");

    const meta = document.createElement("span");
    meta.className = "scene-item__meta";
    const n = scene.markers?.length || 0;
    meta.textContent = n === 0 ? "No hotspots" : `${n} hotspot${n === 1 ? "" : "s"}`;

    body.append(nameLine, meta);
    body.addEventListener("click", () => actions.onSelect(scene.id));
    return body;
  }

  function renderControls(scene, idx, tour) {
    const up = miniBtn("Up", "Move up", () => actions.onMove(scene.id, -1), idx === 0);
    const down = miniBtn(
      "Down", "Move down",
      () => actions.onMove(scene.id, 1),
      idx === tour.scenes.length - 1
    );
    const controls = document.createElement("span");
    controls.className = "scene-item__controls";
    controls.append(up, down);
    return controls;
  }

  function wireDrag(li, idx) {
    li.draggable = true;
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(idx));
      li.classList.add("is-dragging");
    });
    li.addEventListener("dragend", () => li.classList.remove("is-dragging"));
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      li.classList.add("is-drop-target");
    });
    li.addEventListener("dragleave", () => li.classList.remove("is-drop-target"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("is-drop-target");
      actions.onReorder(Number(e.dataTransfer.getData("text/plain")), idx);
    });
  }

  return { render };
}
