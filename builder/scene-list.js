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
import { resolveGroupEntryScene } from "../player-template/js/tour-model.js?v=4";

const COLLAPSE_KEY = "builder-collapsed-groups";
const UNGROUPED = "__ungrouped__";

// Inline SVG glyphs for the per-bubble controls. SVG (not emoji/font glyphs) so
// they render identically everywhere, theme via currentColor, and survive the
// repo's no-emoji rule. viewBox 24 unless noted.
const ICON = {
  pencil:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  gear:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
};

/** Build an icon-only control button used inside a scene bubble. */
function iconBtn(svg, title, onClick, { extraClass = "", disabled = false } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "scene-item__ctl" + (extraClass ? " " + extraClass : "");
  b.title = title;
  b.setAttribute("aria-label", title);
  b.innerHTML = svg;
  b.disabled = disabled;
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });
  return b;
}

/**
 * @param {object} cfg
 * @param {HTMLElement} cfg.listEl     outer container (a <div>) to fill
 * @param {HTMLElement} cfg.countEl    element whose textContent becomes "N"
 * @param {() => object} cfg.getTour
 * @param {() => string|null} cfg.getCurrentSceneId
 * @param {(path: string) => string} cfg.resolveThumbUrl
 * @param {object} cfg.actions  {
 *   onSelect, onAddScene(groupId), onAddGroup,
 *   onRenameGroup(id, name), onDeleteGroup(id), onSetColor(id, color),
 *   onMoveToGroup(sceneId, groupId, beforeSceneId), onSetEntry(groupId, sceneId),
 *   onRenameScene(sceneId, name), onOpenSettings(sceneId),
 *   onSetStart(sceneId), onDeleteScene(sceneId)
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
    const hasGroups = tour.groups.length > 0;

    const section = document.createElement("div");
    section.className = "scene-group" + (isOpen ? "" : " is-collapsed");
    if (group) section.dataset.groupId = group.id;

    section.append(renderHead(group, key, isOpen, members.length));

    const body = document.createElement("div");
    body.className = "scene-group__body";
    body.hidden = !isOpen;
    // Dropping onto empty section space appends the scene to this group.
    wireSectionDrop(body, group ? group.id : null);

    // Group tools (Rename / Delete) live at the top of the OPEN body - not in
    // the header - so the header stays readable and the rename input can never
    // sit inside the toggle button (which caused clicks to collapse the group).
    if (group) body.append(renderActionRow(group));

    const add = document.createElement("button");
    add.type = "button";
    add.className = "scene-group__add";
    add.textContent = "+ Add scene";
    add.addEventListener("click", () => actions.onAddScene(group ? group.id : null));
    body.append(add);

    // Once the tour uses groups, uncategorized scenes aren't shown to visitors,
    // so their "start scene" star is meaningless - warn + disable it.
    if (!group && hasGroups && members.length) {
      const warn = document.createElement("p");
      warn.className = "scene-group__warn";
      warn.textContent = "Uncategorized scenes aren\u2019t used in grouped tours.";
      body.append(warn);
    }

    // Entry star has two states so it survives reordering:
    //   explicitId - the scene the author PINNED (gold star, sticks to that
    //                scene through any reorder because it's keyed by id)
    //   defaultId  - the auto fallback (first member) shown only when nothing is
    //                pinned; a faint marker, moves with whatever is on top.
    const explicitId =
      group && group.entrySceneId && members.some((m) => m.id === group.entrySceneId)
        ? group.entrySceneId
        : "";
    const defaultId = group && !explicitId ? resolveGroupEntryScene(tour, group.id)?.id : null;
    const entry = { explicitId, defaultId };
    members.forEach((scene) =>
      body.append(renderRow(scene, tour, currentId, group, entry, hasGroups))
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

  /** The whole header is one toggle button: chevron + color dot + name + count. */
  function renderHead(group, key, isOpen, count) {
    const head = document.createElement("button");
    head.type = "button";
    head.className = "scene-group__head";
    head.setAttribute("aria-expanded", isOpen ? "true" : "false");
    head.addEventListener("click", () => toggleCollapse(key));

    const chevron = document.createElement("span");
    chevron.className = "scene-group__chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "\u203A";
    head.append(chevron);

    if (group && group.color) {
      const dot = document.createElement("span");
      dot.className = "scene-group__dot";
      dot.style.background = group.color;
      dot.setAttribute("aria-hidden", "true");
      head.append(dot);
    }

    const nameEl = document.createElement("span");
    nameEl.className = "scene-group__name";
    nameEl.textContent = group ? group.name : "Uncategorized";
    head.append(nameEl);

    const meta = document.createElement("span");
    meta.className = "scene-group__count";
    meta.textContent = String(count);
    head.append(meta);
    return head;
  }

  /** Rename / Delete row at the top of an open group; Rename swaps to an input. */
  function renderActionRow(group) {
    const row = document.createElement("div");
    row.className = "scene-group__actions";

    // Color swatch: native picker keeps it accessible + zero-dep. Live-updates
    // the dot + every scene row's accent on change.
    const color = document.createElement("input");
    color.type = "color";
    color.className = "scene-group__color";
    color.value = group.color || "#0071dc";
    color.title = "Area color";
    color.setAttribute("aria-label", `Color for area ${group.name}`);
    // Live-update the data + visuals IN PLACE. A full re-render here would
    // destroy this <input> and slam the native picker shut on the first click.
    color.addEventListener("input", () => {
      actions.onSetColor(group.id, color.value); // data only (no refresh)
      applyColorLive(group.id, color.value);
    });

    row.append(
      color,
      miniBtn("Rename", "Rename area", () => beginRename(row, group)),
      miniBtn("Delete", "Delete area", () => actions.onDeleteGroup(group.id))
    );
    return row;
  }

  /** Repaint a group's dot + its member rows' accents without re-rendering. */
  function applyColorLive(groupId, color) {
    const section = listEl.querySelector(`.scene-group[data-group-id="${groupId}"]`);
    if (!section) return;
    const dot = section.querySelector(".scene-group__dot");
    if (dot) dot.style.background = color;
    section
      .querySelectorAll(".scene-item.has-accent")
      .forEach((row) => row.style.setProperty("--group-accent", color));
  }

  /** Inline-edit a group name inside its action row; Enter/blur save, Esc cancels. */
  function beginRename(row, group) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "scene-group__rename field__input";
    input.value = group.name;
    row.replaceChildren(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (save) => {
      if (done) return; // guard the Enter-then-blur double fire
      done = true;
      if (save) actions.onRenameGroup(group.id, input.value); // re-renders the list
      else render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
  }

  function renderRow(scene, tour, currentId, group, entry, hasGroups) {
    const row = document.createElement("div");
    row.className = "scene-item" + (scene.id === currentId ? " is-active" : "");
    row.dataset.sceneId = scene.id;
    // Tint each row with its area's color (left accent) for at-a-glance grouping.
    if (group && group.color) {
      row.classList.add("has-accent");
      row.style.setProperty("--group-accent", group.color);
    }
    wireDrag(row, scene.id);

    const handle = document.createElement("span");
    handle.className = "scene-item__handle";
    handle.setAttribute("aria-hidden", "true");
    handle.title = "Drag to reorder / move between areas";
    handle.textContent = "\u2630";

    // Compact top line: handle + thumb + name, then the star and a chevron on
    // the far right. The chevron expands the pencil/gear/trash row below.
    const main = document.createElement("div");
    main.className = "scene-item__main";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "scene-item__toggle";
    toggle.title = "Scene options";
    toggle.setAttribute("aria-label", "Scene options");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = ICON.chevron;
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = row.classList.toggle("is-expanded");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    main.append(
      handle,
      renderThumb(scene),
      renderBody(scene),
      renderStar(scene, tour, group, entry, hasGroups),
      toggle
    );

    row.append(main, renderControls(scene));
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
      img.addEventListener("error", () => thumb.classList.add("is-broken"));
      // resolveThumbUrl is async (may read the file from the folder handle).
      Promise.resolve(resolveThumbUrl(scene.thumbnail))
        .then((url) => { if (url) img.src = url; else thumb.classList.add("is-broken"); })
        .catch(() => thumb.classList.add("is-broken"));
      thumb.append(img);
    } else {
      thumb.classList.add("is-empty");
    }
    return thumb;
  }

function renderBody(scene) {
    const body = document.createElement("button");
    body.type = "button";
    body.className = "scene-item__body";

    const nameLine = document.createElement("span");
    nameLine.className = "scene-item__name";
    nameLine.textContent = scene.name || "(unnamed)";

    const meta = document.createElement("span");
    meta.className = "scene-item__meta";
    const n = scene.markers?.length || 0;
    meta.textContent = n === 0 ? "No hotspots" : `${n} hotspot${n === 1 ? "" : "s"}`;

    body.append(nameLine, meta);
    body.addEventListener("click", () => actions.onSelect(scene.id));
    return body;
  }

  /** The collapsible action row (revealed by the chevron): pencil / gear / trash. */
  function renderControls(scene) {
    const controls = document.createElement("div");
    controls.className = "scene-item__controls";
    controls.append(
      iconBtn(ICON.pencil, "Rename scene", () => beginSceneRename(scene)),
      iconBtn(ICON.gear, "Scene settings", () => actions.onOpenSettings(scene.id)),
      iconBtn(ICON.trash, "Delete scene", () => actions.onDeleteScene(scene.id), {
        extraClass: "scene-item__ctl--danger",
      })
    );
    return controls;
  }

  /** The star button - area-entry for grouped scenes, start-scene for ungrouped. */
  function renderStar(scene, tour, group, entry, hasGroups) {
    const star = document.createElement("button");
    star.type = "button";

    if (group) {
      // ---- existing area-entry logic (untouched) ----
      const isPinned = entry.explicitId && scene.id === entry.explicitId;
      const isDefault = !entry.explicitId && scene.id === entry.defaultId;
      star.className =
        "scene-item__star" +
        (isPinned ? " is-entry" : "") +
        (isDefault ? " is-default" : "");
      star.textContent = isPinned || isDefault ? "\u2605" : "\u2606";
      star.title = isPinned
        ? "Entry scene for this area (click to unpin \u2192 auto)"
        : isDefault
          ? "Default entry (first scene). Click to pin this scene so it stays the entry when you reorder."
          : "Set as this area's entry scene";
      star.setAttribute("aria-pressed", isPinned ? "true" : "false");
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        actions.onSetEntry(group.id, scene.id === group.entrySceneId ? "" : scene.id);
      });
      return star;
    }

    // ---- ungrouped: global start-scene toggle ----
    const isStart = scene.id === tour.meta.startSceneId;
    star.className = "scene-item__star" + (isStart ? " is-entry" : "");
    star.textContent = isStart ? "\u2605" : "\u2606";
    star.setAttribute("aria-pressed", isStart ? "true" : "false");
    if (hasGroups) {
      star.disabled = true;
      star.title = "Uncategorized scenes aren\u2019t used in grouped tours";
    } else {
      star.title = isStart ? "This is the start scene" : "Set as the tour's start scene";
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        actions.onSetStart(scene.id);
      });
    }
    return star;
  }

  /** Swap a scene bubble's body for an inline text input; Enter/blur save, Esc cancels. */
  function beginSceneRename(scene) {
    const row = listEl.querySelector(`.scene-item[data-scene-id="${scene.id}"]`);
    const body = row?.querySelector(".scene-item__body");
    if (!body) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "scene-item__rename field__input";
    input.value = scene.name || "";
    body.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (save) => {
      if (done) return; // guard the Enter-then-blur double fire
      done = true;
      if (save) actions.onRenameScene(scene.id, input.value); // re-renders the list
      else render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
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
