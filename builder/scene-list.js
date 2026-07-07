/**
 * scene-list.js - the left-rail scene browser, organized into collapsible
 * "areas" (groups): an always-present Uncategorized section on top, then each
 * group in order. Each section has its own + Add, and groups also get inline
 * rename + delete. Scenes drag between/within sections; grouped scenes show an
 * "area entry" star (the scene a visitor lands on when jumping to that area).
 *
 * Pure-ish factory: takes a small `actions` bag + a `resolveThumbUrl` callback.
 * Returns { render } - call it whenever the tour or selection changes.
 */

import { miniBtn } from "./ui-dom.js";
import { resolveGroupEntryScene } from "../player-template/js/tour-model.js?v=2";

const COLLAPSE_KEY = "builder-collapsed-groups";
const UNGROUPED = "__ungrouped__";

/**
 * @param {object} cfg
 * @param {HTMLElement} cfg.listEl     outer container (a <div>) to fill
 * @param {HTMLElement} cfg.countEl    element whose textContent becomes "N"
 * @param {() => object} cfg.getTour
 * @param {() => string|null} cfg.getCurrentSceneId
 * @param {(path: string) => string} cfg.resolveThumbUrl
 * @param {object} cfg.actions  {
 *   onSelect, onMove(id, delta), onAddScene(groupId),
 *   onAddGroup, onRenameGroup(id, name), onDeleteGroup(id),
 *   onMoveToGroup(sceneId, groupId, beforeSceneId), onSetEntry(groupId, sceneId)
 * }
 */
export function createSceneList({
  listEl, countEl, getTour, getCurrentSceneId, resolveThumbUrl, actions,
}) {
  const collapsed = loadCollapsed();

  function render() {
    const tour = getTour();
    const currentId = getCurrentSceneId();
    listEl.innerHTML = "";
    countEl.textContent = String(tour.scenes.length);

    // Uncategorized always first, then each group in its stored order.
    const ungrouped = tour.scenes.filter((s) => !s.groupId);
    listEl.append(renderSection(null, ungrouped, tour, currentId));
    tour.groups.forEach((group) => {
      const members = tour.scenes.filter((s) => (s.groupId || null) === group.id);
      listEl.append(renderSection(group, members, tour, currentId));
    });
  }

  /** One collapsible section. group === null renders the Uncategorized bucket. */
  function renderSection(group, members, tour, currentId) {
    const key = group ? group.id : UNGROUPED;
    const isOpen = !collapsed.has(key);

    const section = document.createElement("div");
    section.className = "scene-group" + (isOpen ? "" : " is-collapsed");
    if (group) section.dataset.groupId = group.id;

    section.append(renderHead(group, key, isOpen, members.length));

    const body = document.createElement("div");
    body.className = "scene-group__body";
    body.hidden = !isOpen;
    // Dropping onto empty section space appends the scene to this group.
    wireSectionDrop(body, group ? group.id : null);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "scene-group__add";
    add.textContent = "+ Add scene";
    add.addEventListener("click", () => actions.onAddScene(group ? group.id : null));
    body.append(add);

    const entryId = group ? resolveGroupEntryScene(tour, group.id)?.id : null;
    members.forEach((scene) =>
      body.append(renderRow(scene, tour, currentId, group, entryId))
    );
    if (group && !members.length) {
      const empty = document.createElement("p");
      empty.className = "scene-group__empty muted";
      empty.textContent = "Empty \u2014 add a scene or drag one here.";
      body.append(empty);
    }

    section.append(body);
    return section;
  }

  function renderHead(group, key, isOpen, count) {
    const head = document.createElement("div");
    head.className = "scene-group__head";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "scene-group__toggle";
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggle.innerHTML = "<span class='scene-group__chevron' aria-hidden='true'>\u203A</span>";
    const nameEl = document.createElement("span");
    nameEl.className = "scene-group__name";
    nameEl.textContent = group ? group.name : "Uncategorized";
    toggle.append(nameEl);
    toggle.addEventListener("click", () => toggleCollapse(key));
    head.append(toggle);

    const meta = document.createElement("span");
    meta.className = "scene-group__count";
    meta.textContent = String(count);
    head.append(meta);

    if (group) {
      if (group.color) {
        const dot = document.createElement("span");
        dot.className = "scene-group__dot";
        dot.style.background = group.color;
        dot.setAttribute("aria-hidden", "true");
        // The name lives inside the toggle button, so insert the dot there
        // (right before the label), not on `head` (nameEl isn't head's child).
        toggle.insertBefore(dot, nameEl);
      }
      head.append(
        miniBtn("Rename", "Rename area", () => beginRename(head, nameEl, group)),
        miniBtn("Delete", "Delete area", () => actions.onDeleteGroup(group.id))
      );
    }
    return head;
  }

  /** Swap the group name for an input; commit on Enter/blur, cancel on Esc. */
  function beginRename(head, nameEl, group) {
    if (head.querySelector(".scene-group__rename")) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "scene-group__rename field__input";
    input.value = group.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = (save) => {
      if (save) actions.onRenameGroup(group.id, input.value);
      else render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
  }

  function renderRow(scene, tour, currentId, group, entryId) {
    const row = document.createElement("div");
    row.className = "scene-item" + (scene.id === currentId ? " is-active" : "");
    wireDrag(row, scene.id);

    const handle = document.createElement("span");
    handle.className = "scene-item__handle";
    handle.setAttribute("aria-hidden", "true");
    handle.title = "Drag to reorder / move between areas";
    handle.textContent = "\u2630";

    row.append(
      handle,
      renderThumb(scene),
      renderBody(scene, tour),
      renderControls(scene, group, entryId)
    );
    return row;
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

  function renderControls(scene, group, entryId) {
    const controls = document.createElement("span");
    controls.className = "scene-item__controls";
    // Area entry star (grouped scenes only): filled = the landing scene.
    if (group) {
      const isEntry = scene.id === entryId;
      const star = document.createElement("button");
      star.type = "button";
      star.className = "scene-item__star" + (isEntry ? " is-entry" : "");
      star.textContent = isEntry ? "\u2605" : "\u2606"; //  / 
      star.title = isEntry
        ? "This is the area's entry scene (click to reset to first)"
        : "Set as this area's entry scene";
      star.setAttribute("aria-pressed", isEntry ? "true" : "false");
      star.addEventListener("click", () =>
        actions.onSetEntry(group.id, scene.id === group.entrySceneId ? "" : scene.id)
      );
      controls.append(star);
    }
    controls.append(
      miniBtn("Up", "Move up", () => actions.onMove(scene.id, -1)),
      miniBtn("Down", "Move down", () => actions.onMove(scene.id, 1))
    );
    return controls;
  }

  /* ---- drag & drop (scene id based; works across sections) ---- */
  function wireDrag(row, sceneId) {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", sceneId);
      row.classList.add("is-dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation(); // let the row (insert-before) win over the section
      row.classList.add("is-drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("is-drop-target");
      const dragged = e.dataTransfer.getData("text/plain");
      const groupId = groupIdOfRow(row);
      actions.onMoveToGroup(dragged, groupId, sceneId); // insert before this row
    });
  }

  function wireSectionDrop(body, groupId) {
    body.addEventListener("dragover", (e) => {
      e.preventDefault();
      body.classList.add("is-drop-target");
    });
    body.addEventListener("dragleave", () => body.classList.remove("is-drop-target"));
    body.addEventListener("drop", (e) => {
      e.preventDefault();
      body.classList.remove("is-drop-target");
      const dragged = e.dataTransfer.getData("text/plain");
      actions.onMoveToGroup(dragged, groupId, null); // append to this group
    });
  }

  /** Which group a rendered row lives in (null for Uncategorized). */
  function groupIdOfRow(row) {
    const section = row.closest(".scene-group");
    const tour = getTour();
    // Position of this section among [ungrouped, ...groups] tells us its group.
    const sections = [...listEl.querySelectorAll(".scene-group")];
    const idx = sections.indexOf(section);
    return idx <= 0 ? null : tour.groups[idx - 1]?.id ?? null;
  }

  /* ---- collapse state (persisted) ---- */
  function toggleCollapse(key) {
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    saveCollapsed(collapsed);
    render();
  }

  return { render };
}

function loadCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveCollapsed(set) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
  } catch {
    /* private mode */
  }
}
