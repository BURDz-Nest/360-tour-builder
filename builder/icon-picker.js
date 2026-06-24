/**
 * icon-picker.js — inline grid picker for marker icons.
 *
 * Pure factory. Given a marker type and current icon id, builds a DOM widget:
 *   - a "current icon" button (the swatch)
 *   - a grid that pops out below it on click, listing icons of that type
 *   - calls onChange(newIconId) when a tile is clicked
 *
 * The grid uses the same renderMarkerHtml() as the live preview/player so
 * authors see exactly what their pick will look like (animation and all).
 *
 * SOLID: knows nothing about scenes, markers, or persistence \u2014 callers wire
 * onChange to whatever update path they own (e.g. updateMarker in builder.js).
 */

import { listIcons, renderMarkerHtml, getIcon } from "../player-template/js/marker-icons.js";

/**
 * @param {object} cfg
 * @param {"link"|"info"} cfg.type
 * @param {string} cfg.iconId        current icon id (or "" for default)
 * @param {(id:string)=>void} cfg.onChange
 * @returns {HTMLElement}            the field wrapper
 */
export function createIconPicker({ type, iconId, onChange }) {
  const wrap = document.createElement("div");
  wrap.className = "field icon-picker";

  const label = document.createElement("span");
  label.className = "field__label";
  label.textContent = "Icon";
  wrap.append(label);

  const row = document.createElement("div");
  row.className = "icon-picker__row";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "icon-picker__trigger";
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");
  trigger.title = "Choose icon";

  const triggerLabel = document.createElement("span");
  triggerLabel.className = "icon-picker__current-label";

  const caret = document.createElement("span");
  caret.className = "icon-picker__caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = "\u25BE";

  row.append(trigger, triggerLabel, caret);
  wrap.append(row);

  const grid = document.createElement("div");
  grid.className = "icon-picker__grid";
  grid.hidden = true;
  wrap.append(grid);

  /** Repaint the trigger swatch + label for the currently-selected icon. */
  function paintTrigger(currentId) {
    const icon = getIcon(type, currentId);
    trigger.innerHTML = renderMarkerHtml({
      type,
      iconId: icon.id,
      size: 28,
      variant: type === "link" ? "nav" : "info",
    });
    triggerLabel.textContent = icon.label;
  }

  /** Build the popup grid once, lazily on first open. */
  let gridBuilt = false;
  function buildGrid(currentId) {
    grid.innerHTML = "";
    for (const icon of listIcons(type)) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "icon-picker__tile" + (icon.id === currentId ? " is-active" : "");
      tile.setAttribute("aria-label", icon.label);
      tile.title = icon.label;
      tile.dataset.iconId = icon.id;
      tile.innerHTML = renderMarkerHtml({
        type,
        iconId: icon.id,
        size: 28,
        variant: type === "link" ? "nav" : "info",
      });
      tile.addEventListener("click", () => {
        selectIcon(icon.id);
      });
      grid.append(tile);
    }
    gridBuilt = true;
  }

  function selectIcon(newId) {
    paintTrigger(newId);
    onChange(newId);
    closeGrid();
  }

  function openGrid() {
    if (!gridBuilt) buildGrid(iconId);
    // Refresh the active tile in case state moved since last open.
    grid.querySelectorAll(".icon-picker__tile").forEach((tile) => {
      tile.classList.toggle("is-active", tile.dataset.iconId === currentIconId());
    });
    grid.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
  }

  function closeGrid() {
    grid.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey);
  }

  function onDocClick(e) {
    if (!wrap.contains(e.target)) closeGrid();
  }
  function onKey(e) {
    if (e.key === "Escape") closeGrid();
  }

  function currentIconId() {
    // The trigger swatch is the source of truth between calls.
    const tile = trigger.querySelector(".tour-marker");
    return tile?.dataset.icon || iconId || "";
  }

  trigger.addEventListener("click", () => {
    if (grid.hidden) openGrid();
    else closeGrid();
  });

  paintTrigger(iconId);
  return wrap;
}
