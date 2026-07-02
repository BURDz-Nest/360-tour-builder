/**
 * scene-actions.js - "Duplicate scene" + "Copy hotspots" helpers.
 *
 * Pulled out of builder.js so the main file stays under the 600-line
 * guideline. These operations are pure transforms on a tour object plus
 * a tiny popover UI; they don't own selection, rendering, or persistence
 * (callers do that via the actions bag).
 */

import { createScene, createMarker } from "../player-template/js/tour-model.js?v=2";

/** Deep-copy a marker but assign a fresh id (so the copy can coexist). */
export function cloneMarkerWithNewId(m) {
  return createMarker({
    type: m.type,
    shape: m.shape,
    yaw: m.yaw,
    pitch: m.pitch,
    label: m.label,
    targetSceneId: m.targetSceneId,
    html: m.html,
    icon: m.icon,
    // Zone fields (ignored for icon markers): clone the polygon + styling.
    points: Array.isArray(m.points) ? m.points.map((p) => ({ ...p })) : null,
    idleStroke: m.idleStroke,
    hoverColor: m.hoverColor,
  });
}

/**
 * Clone `src` and insert the copy right after it in `tour.scenes`. Returns
 * the new scene (caller usually wants to select it). Everything is deep-
 * copied; ids regenerated for the scene and every marker. Link-target ids
 * inside copied markers are PRESERVED - users duplicating a similar room
 * almost always want the same nav layout pointing at the same destinations.
 */
export function duplicateScene(tour, src) {
  const copy = createScene({ name: `${src.name} (copy)`, panorama: src.panorama });
  copy.thumbnail = src.thumbnail;
  copy.caption = src.caption;
  copy.initialView = { ...src.initialView };
  copy.markers = src.markers.map(cloneMarkerWithNewId);

  const idx = tour.scenes.findIndex((s) => s.id === src.id);
  tour.scenes.splice(idx + 1, 0, copy);
  return copy;
}

/** Append cloned markers from `source` onto `target`. Returns count copied. */
export function copyHotspots(target, source) {
  const cloned = source.markers.map(cloneMarkerWithNewId);
  target.markers.push(...cloned);
  return cloned.length;
}

/**
 * Show a small popover menu listing scenes (other than `current`) that have
 * any hotspots. Selecting one calls `onPick(scene)`.
 *
 * @param {object} cfg
 * @param {HTMLElement} cfg.anchor      button the menu is anchored under
 * @param {Array}       cfg.scenes      tour.scenes
 * @param {object}      cfg.current     the current scene (excluded from list)
 * @param {(s:object)=>void} cfg.onPick called with the chosen scene
 * @param {(msg:string)=>void} cfg.onEmpty  called instead of opening when nothing to pick
 */
export function openSceneCopyMenu({ anchor, scenes, current, onPick, onEmpty }) {
  const others = scenes.filter((s) => s.id !== current.id && (s.markers?.length || 0) > 0);
  if (!others.length) {
    onEmpty?.("No other scenes have hotspots to copy yet.");
    return;
  }

  // Close any previously-open menu.
  document.querySelector(".copy-menu")?.remove();

  const menu = document.createElement("div");
  menu.className = "copy-menu";
  menu.setAttribute("role", "menu");
  others.forEach((s) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "copy-menu__item";
    item.setAttribute("role", "menuitem");
    const n = s.markers.length;
    item.textContent = `${s.name || "(unnamed)"} \u2014 ${n} hotspot${n === 1 ? "" : "s"}`;
    item.addEventListener("click", () => {
      onPick(s);
      menu.remove();
    });
    menu.append(item);
  });

  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + window.scrollY + 4}px`;
  menu.style.left = `${r.left + window.scrollX}px`;
  document.body.append(menu);

  const close = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    if (e.type === "click" && (menu.contains(e.target) || e.target === anchor)) return;
    menu.remove();
    document.removeEventListener("click", close, true);
    document.removeEventListener("keydown", close);
  };
  setTimeout(() => {
    document.addEventListener("click", close, true);
    document.addEventListener("keydown", close);
  }, 0);
}
