/**
 * marker-row.js - renders one marker's editor card (the chunk between the
 * marker list header and the next marker). Extracted from builder.js to keep
 * it under 600 lines while staying cohesive: this module knows the marker
 * card's DOM shape, builder.js wires the actions.
 *
 * Pure factory: callers pass the scene + marker + a small `actions` bag, and
 * get back a fully-wired <div>. No module-level state - every render is a
 * fresh DOM tree.
 */

import { MARKER_TYPES, isZone } from "../player-template/js/tour-model.js";
import {
  miniBtn,
  labeledInput,
  labeledTextarea,
  labeledColor,
  labeledCheckbox,
} from "./ui-dom.js";
import { createIconPicker } from "./icon-picker.js";

/**
 * @param {object} cfg
 * @param {object} cfg.scene     the scene that owns this marker
 * @param {object} cfg.marker    the marker being edited
 * @param {string|null} cfg.selectedMarkerId  for the .is-selected class
 * @param {object[]} cfg.scenes  all scenes (for the link target dropdown)
 * @param {object} cfg.actions   { onReplace, onDelete, onUpdate(patch), onSelect }
 * @returns {HTMLElement}
 */
export function renderMarkerRow({ scene, marker: m, selectedMarkerId, scenes, actions }) {
  // Info zones get a different card (no icon/position; shape + style controls).
  if (isZone(m)) return renderZoneRow({ m, selectedMarkerId, actions });

  const row = document.createElement("div");
  row.className = "marker-row" + (m.id === selectedMarkerId ? " is-selected" : "");

  const head = document.createElement("div");
  head.className = "marker-row__head";
  const badge = document.createElement("span");
  badge.className = `marker-badge marker-badge--${m.type}`;
  badge.textContent = m.type === MARKER_TYPES.LINK ? "Navigation" : "Info";
  head.append(badge);
  head.append(miniBtn("Move", "Re-place on sphere", () => actions.onReplace(m.id)));
  head.append(miniBtn("Delete", "Delete hotspot", () => actions.onDelete(m.id)));

  const label = labeledInput("Label", m.label, (v) => actions.onUpdate(m.id, { label: v }));

  const iconPicker = createIconPicker({
    type: m.type,
    iconId: m.icon,
    onChange: (id) => actions.onUpdate(m.id, { icon: id }),
  });

  row.append(head, label, iconPicker);

  if (m.type === MARKER_TYPES.LINK) {
    row.append(linkTargetSelect(scene, m, scenes, actions));
  } else {
    row.append(
      labeledTextarea("Info content (HTML allowed)", m.html, (v) =>
        actions.onUpdate(m.id, { html: v })
      )
    );
  }

  const pos = document.createElement("p");
  pos.className = "marker-row__pos muted";
  pos.textContent = `Position: yaw ${m.yaw} deg, pitch ${m.pitch} deg`;
  row.append(pos);
  wireSelect(row, m.id, actions.onSelect);
  return row;
}

/**
 * Make a whole card act as its own "select me" affordance: clicking anywhere
 * on the card (or focusing any field inside it) selects the marker - which
 * highlights it in the preview and, for zones, shows the corner handles.
 * Buttons are excluded so the mini-btns (Move/Delete) still do their own job.
 */
function wireSelect(row, id, onSelect) {
  if (!onSelect) return;
  row.dataset.markerId = id;
  row.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    onSelect(id);
  });
  row.addEventListener("focusin", () => onSelect(id));
}

/**
 * Editor card for an INFO ZONE (polygon hotspot). No icon or single position;
 * instead: label + info content + idle-outline toggle + hover color. Selecting
 * the card (click anywhere / focus a field) shows the corner handles in the
 * preview so you can drag them to reshape the region.
 */
function renderZoneRow({ m, selectedMarkerId, actions }) {
  const row = document.createElement("div");
  row.className =
    "marker-row marker-row--zone" + (m.id === selectedMarkerId ? " is-selected" : "");

  const head = document.createElement("div");
  head.className = "marker-row__head";
  const badge = document.createElement("span");
  badge.className = "marker-badge marker-badge--zone";
  badge.textContent = "Info zone";
  head.append(badge);
  head.append(miniBtn("Delete", "Delete hotspot", () => actions.onDelete(m.id)));

  const label = labeledInput("Label", m.label, (v) => actions.onUpdate(m.id, { label: v }));
  const html = labeledTextarea("Info content (HTML allowed)", m.html, (v) =>
    actions.onUpdate(m.id, { html: v })
  );
  const outline = labeledCheckbox(
    "Faint outline when idle (otherwise invisible until hover)",
    m.idleStroke,
    (on) => actions.onUpdate(m.id, { idleStroke: on })
  );
  const color = labeledColor("Hover color", m.hoverColor, (v) =>
    actions.onUpdate(m.id, { hoverColor: v })
  );

  const hint = document.createElement("p");
  hint.className = "marker-row__pos muted";
  hint.textContent =
    "Selected: drag the corner dots in the preview to fit the region.";

  row.append(head, label, html, outline, color, hint);
  wireSelect(row, m.id, actions.onSelect);
  return row;
}

function linkTargetSelect(scene, m, scenes, actions) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  wrap.innerHTML = "<span class='field__label'>Go to scene</span>";
  const select = document.createElement("select");
  select.className = "field__input";
  select.append(new Option("-- choose target --", ""));
  scenes
    .filter((s) => s.id !== scene.id)
    .forEach((s) => select.append(new Option(s.name || s.id, s.id)));
  select.value = m.targetSceneId || "";
  select.addEventListener("change", () =>
    actions.onUpdate(m.id, { targetSceneId: select.value })
  );
  wrap.append(select);
  return wrap;
}
